#!/usr/bin/env node
/*
 * check-whiteboard-area-keys.mjs -- Copy and Cut of an area of a picture on the keys (modules/whiteboard/src/whiteboard.js:
 * clipKey, onCopyEvent, copyArea), in a real browser against a throwaway server (tools/shots.mjs; no LiveKit).
 * Guards: with a picture picked and the Select area tool on, Ctrl+C hands the clipboard a picture of just the area and leaves the
 * board as it is; Ctrl+X does that and leaves a hole in the picture, and the picture stays: the key's fallback (clipKey, which cuts
 * what is picked a moment after the key when the browser sends no cut event) must not run as well, or the whole picture goes.
 * Each key is sent as the browser does: the key press, then the copy or cut event. The browser's own clipboard is not read (a
 * headless browser refuses): what the page hands to navigator.clipboard.write is taken instead.
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
  console.log('check-whiteboard-area-keys: SKIPPED. No Chromium found (set CHROME_PATH, or install one: npx playwright install chromium). This is not a pass; nothing was measured.');
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
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-whiteboard-area-keys-'));
let server;
let browser;
let tab;
try {
  server = await startServer(dataDir, await freePort(), 'first');
  let cookie = '';
  const call = async (method, url, body, raw) => {
    const r = await fetch(server.base + url, { method, headers: { 'content-type': raw ? 'image/png' : 'application/json', accept: 'application/json', cookie }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
    const set = r.headers.getSetCookie();
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    let json = null; try { json = await r.json(); } catch { /* none */ }
    if (r.status >= 300) throw new Error(`${method} ${url}: ${r.status} ${JSON.stringify(json)}`);
    return json;
  };
  await call('POST', '/api/login', { login: 'admin', password: PASSWORD });
  await call('POST', '/api/modules/bundled/whiteboard/install');
  await call('PATCH', '/api/modules/whiteboard', { enabled: true });
  const space = (await call('POST', '/api/spaces', { name: 'Area keys' })).space.id;
  const up = await call('POST', `/api/modules/whiteboard/uploads?scope=space&space=${space}&name=grey.png`, png(200, 120), true);
  const block = { id: 'p1', type: 'image', x: 60, y: 60, z: 1, w: 400, h: 240, upload: up.file.id, alt: '', stroke: 'none', weight: 2, by: 'x', at: new Date().toISOString() };
  await call('PUT', `/api/modules/whiteboard/data/${encodeURIComponent('block:main:p1')}?scope=space&space=${space}`, { value: block });

  browser = await launch(bin);
  tab = new Tab(browser.cdp, {});
  await tab.open(1200, 'light');
  for (const kv of cookie.split('; ')) { const i = kv.indexOf('='); await tab.cdp.send('Network.setCookie', { name: kv.slice(0, i), value: kv.slice(i + 1), url: server.base, httpOnly: true }, tab.sid); }
  await tab.cdp.send('Page.navigate', { url: `${server.base}/modules/whiteboard?space=${space}&popout=1` }, tab.sid);
  await tab.waitFor('#module-frame >>> .wb-block[data-id="p1"]');
  await sleep(1200);
  const Q = (sel) => `__q('#module-frame >>> ${sel}')`;
  await tab.eval(`(() => { window.__wbErrors = []; window.addEventListener('error', (e) => window.__wbErrors.push(e.message)); window.__clip = []; navigator.clipboard.write = async (items) => { for (const it of items) for (const t of it.types) { const b = await it.getType(t); const bm = await createImageBitmap(b); window.__clip.push({ type: t, w: bm.width, h: bm.height }); } }; return true; })()`);
  const rect = () => tab.eval(`(() => { const r = ${Q('.wb-block[data-id="p1"]')}.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const press = async (x0, y0, x1, y1) => {
    await tab.mouse('mouseMoved', x0, y0, { button: 'none', clickCount: 0 });
    await tab.mouse('mousePressed', x0, y0);
    for (let i = 1; i <= 8; i += 1) await tab.mouse('mouseMoved', x0 + ((x1 - x0) * i) / 8, y0 + ((y1 - y0) * i) / 8, { button: 'left', clickCount: 0 });
    await tab.mouse('mouseReleased', x1, y1);
    await sleep(400);
  };
  // As the browser sends them: the key press first, then the copy or the cut.
  const key = (letter, event) => tab.eval(`(() => { const b = ${Q('#board')}; b.focus(); b.dispatchEvent(new KeyboardEvent('keydown', { key: '${letter}', code: 'Key${letter.toUpperCase()}', ctrlKey: true, bubbles: true, cancelable: true })); b.dispatchEvent(new ClipboardEvent('${event}', { bubbles: true, cancelable: true })); return true; })()`);
  const state = () => tab.eval(`(() => { const b = ${Q('.wb-block[data-id="p1"]')}; return { there: Boolean(b), hole: Boolean(b && b.querySelector('.wb-picture').style.getPropertyValue('mask-image')), blocks: ${Q('#world')}.querySelectorAll('.wb-block').length }; })()`);

  // Picture tool, the picture picked, then the Select area kind and an area dragged over the middle of it.
  await tab.click('.mf-toolbar button, button', 'Picture');
  await sleep(300);
  let r = await rect();
  await tab.mouse('mouseMoved', r.x + r.w / 2, r.y + 20, { button: 'none', clickCount: 0 });
  await tab.mouse('mousePressed', r.x + r.w / 2, r.y + 20);
  await tab.mouse('mouseReleased', r.x + r.w / 2, r.y + 20);
  await sleep(300);
  check(await tab.eval(`${Q('.wb-block[data-id="p1"]')}.classList.contains('wb-picked')`), 'the picture is picked before the area is');
  await tab.click('#module-frame >>> button[data-kind="area"]');
  await sleep(300);
  r = await rect();
  await press(r.x + r.w * 0.25, r.y + r.h * 0.25, r.x + r.w * 0.75, r.y + r.h * 0.5);

  await key('c', 'copy');
  await sleep(900); // past the key's own fallback (150 ms), so a second copy or cut would have run
  let s = await state();
  const clip = await tab.eval('window.__clip');
  check(s.there && !s.hole && s.blocks === 1, `Ctrl+C leaves the picture as it was (${JSON.stringify(s)})`);
  check(clip.length === 1 && clip[0].type === 'image/png' && clip[0].w === 100 && clip[0].h === 30, `Ctrl+C puts the area on the clipboard as a picture of 100 by 30 (${JSON.stringify(clip)})`);

  await key('x', 'cut');
  await sleep(900);
  s = await state();
  check(s.there && s.blocks === 1, `Ctrl+X does not remove the picture (${JSON.stringify(s)})`);
  check(s.hole, 'Ctrl+X leaves a hole in the picture');
  check((await tab.eval('window.__clip')).length === 2, 'Ctrl+X puts the area on the clipboard too');

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
  console.error(`check-whiteboard-area-keys: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`check-whiteboard-area-keys: OK, ${passed} cases`);
