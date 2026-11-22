#!/usr/bin/env node
/*
 * check-whiteboard-format-strip.mjs -- the strip's Format group and the editing bar's Text size (whiteboard.js: runFormat, updateFormat, sizeFor; lib-j
 * wbFormatAll and wbFormatOn; lib-d wbFormatBar), in a real browser against a throwaway server (tools/shots.mjs; no LiveKit).
 * Guards: with a note picked the strip offers Bold, Italic, Code, Bulleted list, Numbered list, Heading and Link, and Bold changes all its words
 * (stored as **words**, the button pressed, and pressing again takes it off); two notes picked are both changed, in one undo step; a note with no words
 * is left alone (no empty pair of marks); Link asks for an address and a cancel changes nothing; while the words are being edited, a press on the strip's Bold
 * changes only the selection and the box stays open; and the editing bar has a Text size button that goes to the next size and keeps the editing.
 * With no Chromium it says SKIPPED (set CHROME_PATH); that is not a pass.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const { startServer, stopServer, freePort, findBrowser, launch, Tab, sleep } = await import('../../../tools/shots.mjs');
const { PASSWORD } = await import('../../../tools/shots-seed.mjs');

const bin = findBrowser();
if (!bin) {
  console.log('check-whiteboard-format-strip: SKIPPED. No Chromium found (set CHROME_PATH, or install one: npx playwright install chromium). This is not a pass; nothing was measured.');
  process.exit(0);
}

// A PNG of 200 by 120 pixels, a plain grey: made here so the check needs no file.
function png(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([len, body, sum]); };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x99)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

let failed = 0;
let passed = 0;
const check = (ok, what) => { if (ok) passed += 1; else { failed += 1; console.error(`FAIL ${what}`); } };
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-whiteboard-format-strip-'));
let server;
let browser;
let tab;
try {
  server = await startServer(dataDir, await freePort(), 'first');
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(server.base + url, { method, headers: { 'content-type': 'application/json', accept: 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.getSetCookie();
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    let json = null; try { json = await r.json(); } catch { /* none */ }
    if (r.status >= 300) throw new Error(`${method} ${url}: ${r.status} ${JSON.stringify(json)}`);
    return json;
  };
  await call('POST', '/api/login', { login: 'admin', password: PASSWORD });
  await call('POST', '/api/modules/bundled/whiteboard/install');
  await call('PATCH', '/api/modules/whiteboard', { enabled: true });
  const space = (await call('POST', '/api/spaces', { name: 'Format strip' })).space.id;
  const now = new Date().toISOString();
  const put = (b) => call('PUT', `/api/modules/whiteboard/data/${encodeURIComponent(`block:main:${b.id}`)}?scope=space&space=${space}`, { value: { by: 'x', at: now, z: 5, ...b } });
  const read = async (id) => { try { const r = await call('GET', `/api/modules/whiteboard/data/${encodeURIComponent(`block:main:${id}`)}?scope=space&space=${space}`); return (r.item && r.item.value) || null; } catch { return null; } };
  const note = { type: 'note', w: 220, h: 120, pointer: null, fill: 'gold', stroke: 'auto', ink: 'ink', weight: 1, size: 'medium', align: 'left' };
  await put({ id: 'n1', x: 100, y: 120, text: 'Hello there', ...note });
  await put({ id: 'n2', x: 420, y: 120, text: 'Second note', ...note });
  await put({ id: 'n3', x: 100, y: 320, text: '', ...note });

  browser = await launch(bin);
  tab = new Tab(browser.cdp, {});
  await tab.open(1200, 'light');
  for (const kv of cookie.split('; ')) { const i2 = kv.indexOf('='); await tab.cdp.send('Network.setCookie', { name: kv.slice(0, i2), value: kv.slice(i2 + 1), url: server.base, httpOnly: true }, tab.sid); }
  await tab.cdp.send('Page.navigate', { url: `${server.base}/modules/whiteboard?space=${space}&popout=1` }, tab.sid);
  await tab.waitFor('#module-frame >>> .wb-block[data-id="n3"]');
  await sleep(1500);
  const Q = (sel) => `__q('#module-frame >>> ${sel}')`;
  await tab.eval(`(() => { window.__wbErrors = []; window.addEventListener('error', (e) => window.__wbErrors.push(e.message)); return true; })()`);
  const rect = (id) => tab.eval(`(() => { const r = ${Q(`.wb-block[data-id="${id}"]`)}.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const click = async (id, fx = 0.5, fy = 0.9, extra = {}) => { const r = await rect(id); const x = r.x + r.w * fx; const y = r.y + r.h * fy; await tab.mouse('mouseMoved', x, y, { button: 'none', clickCount: 0 }); await tab.mouse('mousePressed', x, y, extra); await tab.mouse('mouseReleased', x, y, extra); await sleep(450); };
  const key = (k, o = {}) => tab.eval(`(() => { const b = ${Q('#board')}; b.focus(); b.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true, cancelable: true, ${Object.entries(o).map(([a, v]) => `${a}: ${v}`).join(', ')} })); return true; })()`);
  const button = (label) => `#module-frame >>> #paint button[aria-label="${label}"]`;
  const visible = (label) => tab.eval(`(() => { const b = ${Q(`#paint button[aria-label="${label}"]`)}; return Boolean(b) && !b.hidden && b.offsetParent !== null; })()`);
  const pressed = (label) => tab.eval(`${Q(`#paint button[aria-label="${label}"]`)}.getAttribute('aria-pressed')`);
  const textOf = async (id) => (await read(id)).text;
  const editors = () => tab.eval(`${Q('#world')}.querySelectorAll('.wb-text-edit').length`);

  // A picked note: the strip offers the formatting buttons.
  await click('n1', 0.5, 0.9);
  for (const label of ['Bold', 'Italic', 'Code', 'Bulleted list', 'Numbered list', 'Heading', 'Link']) check(await visible(label), `the strip has ${label} with a note picked`);

  // Bold changes all its words; pressed while on; pressing again takes it off.
  await tab.click(button('Bold'));
  await sleep(900);
  check((await textOf('n1')) === '**Hello there**', `Bold wraps all the words of the picked note (${await textOf('n1')})`);
  check((await pressed('Bold')) === 'true', 'and the Bold button shows it is on');
  await tab.click(button('Bold'));
  await sleep(900);
  check((await textOf('n1')) === 'Hello there' && (await pressed('Bold')) === 'false', 'pressing Bold again takes it off');

  // Heading goes round; a list goes on every line.
  await tab.click(button('Heading'));
  await sleep(900);
  check((await textOf('n1')) === '# Hello there', 'Heading makes the words a large heading');
  await tab.click(button('Heading'));
  await tab.click(button('Heading'));
  await tab.click(button('Heading'));
  await sleep(900);
  check((await textOf('n1')) === 'Hello there', 'and three more presses go round to none');

  // One undo takes a format back.
  await tab.click(button('Italic'));
  await sleep(900);
  check((await textOf('n1')) === '*Hello there*', 'Italic wraps the words');
  await key('z', { ctrlKey: true });
  await sleep(1500);
  check((await textOf('n1')) === 'Hello there', 'one undo takes it back');

  // Link asks for an address: a cancel changes nothing.
  await tab.click(button('Link'));
  await sleep(800);
  const asked = await tab.eval(`(() => { const d = [...document.querySelectorAll('dialog, [role=dialog]')].find((x) => /Web address/.test(x.textContent || '')); return Boolean(d); })()`);
  check(asked, 'Link asks for the web address');
  await tab.eval(`(() => { const d = [...document.querySelectorAll('dialog, [role=dialog]')].find((x) => /Web address/.test(x.textContent || '')); const c = d && [...d.querySelectorAll('button')].find((b) => /cancel/i.test(b.textContent || '')); if (c) c.click(); return true; })()`);
  await sleep(600);
  check((await textOf('n1')) === 'Hello there', 'cancelling the address changes nothing');

  // Two notes picked: both are changed, in one undo step. A note with no words is left alone.
  await click('n2', 0.5, 0.9, {});
  await tab.eval(`(() => { return true; })()`);
  await click('n1', 0.5, 0.9, { modifiers: 8 }); // Shift: add the first note
  await sleep(300);
  await tab.click(button('Bold'));
  await sleep(1000);
  check((await textOf('n1')) === '**Hello there**' && (await textOf('n2')) === '**Second note**', `two picked notes are both made bold (${await textOf('n1')} | ${await textOf('n2')})`);
  await key('z', { ctrlKey: true });
  await sleep(1500);
  check((await textOf('n1')) === 'Hello there' && (await textOf('n2')) === 'Second note', 'one undo takes both back');
  await key('Escape');
  await click('n3', 0.5, 0.9);
  await tab.click(button('Bold'));
  await sleep(900);
  check((await textOf('n3')) === '', 'a note with no words is left alone (no empty pair of marks)');

  // While the words are edited, the strip's Bold changes the selection and the box stays open.
  await click('n1', 0.5, 0.9);
  await key('Enter');
  await sleep(600);
  check((await editors()) === 1, 'Enter opens the words of the picked note for editing');
  await tab.eval(`(() => { const t = ${Q('.wb-text-edit')}; t.focus(); t.setSelectionRange(6, 11); return true; })()`);
  await tab.click(button('Bold'));
  await sleep(500);
  check((await editors()) === 1, 'a press on the strip\'s Bold keeps the box open');
  check((await tab.eval(`${Q('.wb-text-edit')}.value`)) === 'Hello **there**', `and makes only the selection bold (${await tab.eval(`${Q('.wb-text-edit')}.value`)})`);

  // The editing bar has a Text size button that goes to the next size and keeps the editing.
  const sizeBefore = (await read('n1')).size;
  const hasSize = await tab.eval(`Boolean(${Q('.wb-format [data-format="size"]')})`);
  check(hasSize, 'the editing bar has a Text size button');
  if (hasSize) {
    await tab.click('#module-frame >>> .wb-format [data-format="size"]');
    await sleep(1000);
    const sizeAfter = (await read('n1')).size;
    check(sizeBefore === 'medium' && sizeAfter === 'large', `pressing it goes to the next size (${sizeBefore} to ${sizeAfter})`);
    check((await editors()) === 1, 'and the box stays open');
  }
  // Keep the words: Ctrl+Enter.
  await tab.eval(`(() => { const t = ${Q('.wb-text-edit')}; t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })); return true; })()`);
  await sleep(1200);
  check((await textOf('n1')) === 'Hello **there**', `ending the editing keeps the words (${await textOf('n1')})`);

  const errors = await tab.eval('window.__wbErrors');
  check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
} catch (err) {
  failed += 1;
  console.error(`FAIL ${err.stack || err}`);
} finally {
  if (tab) await tab.close().catch(() => {});
  if (browser) { try { browser.child.kill(); } catch { /* gone */ } }
  if (server) await stopServer(server);
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
if (failed) {
  console.error(`check-whiteboard-format-strip: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`check-whiteboard-format-strip: OK, ${passed} cases`);
