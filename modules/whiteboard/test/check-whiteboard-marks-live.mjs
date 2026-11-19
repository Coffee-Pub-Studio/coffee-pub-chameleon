#!/usr/bin/env node
/*
 * check-whiteboard-marks-live.mjs -- marks that travel with a picture (whiteboard.js: persist, scaleMarks; lib-u), in a real browser
 * against a throwaway server (tools/shots.mjs; no LiveKit).
 * Guards, on what is stored (read back from the server): a mark saved on a picture is on it (`on`), and one saved off it is on none;
 * the arrow keys on a picked picture move its marks by the same amount, and not a mark that is on none; a resize of the picture scales its
 * marks' places and sizes in one save (one undo step); Duplicate makes a picture and marks that are on the copy, not on the first;
 * Delete takes the picture's marks and no other block. Keys are sent as the browser sends them; the resize is a real mouse drag on a handle.
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
  console.log('check-whiteboard-marks-live: SKIPPED. No Chromium found (set CHROME_PATH, or install one: npx playwright install chromium). This is not a pass; nothing was measured.');
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
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-whiteboard-marks-live-'));
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
  const space = (await call('POST', '/api/spaces', { name: 'Marks' })).space.id;
  const up = await call('POST', `/api/modules/whiteboard/uploads?scope=space&space=${space}&name=grey.png`, png(200, 120), true);
  const now = new Date().toISOString();
  const put = (b) => call('PUT', `/api/modules/whiteboard/data/${encodeURIComponent(`block:main:${b.id}`)}?scope=space&space=${space}`, { value: { by: 'x', at: now, z: 1, ...b } });
  const read = async (id) => { try { const r = await call('GET', `/api/modules/whiteboard/data/${encodeURIComponent(`block:main:${id}`)}?scope=space&space=${space}`); return (r.item && r.item.value) || null; } catch { return null; } };
  const box = { stroke: 'ink', fill: 'gold', ink: 'ink', weight: 3, size: 'medium', align: 'center', text: '' };
  await put({ id: 'pic', type: 'image', x: 60, y: 60, w: 400, h: 240, upload: up.file.id, alt: '', stroke: 'none', weight: 2 });
  await put({ id: 'inside', type: 'rect', x: 120, y: 120, w: 100, h: 60, z: 5, ...box });
  await put({ id: 'note', type: 'note', x: 300, y: 180, w: 120, h: 100, z: 6, text: '', pointer: null, fill: 'gold', stroke: 'auto', ink: 'ink', weight: 1, size: 'medium', align: 'left' });
  await put({ id: 'outside', type: 'rect', x: 600, y: 120, w: 100, h: 60, z: 5, ...box });

  browser = await launch(bin);
  tab = new Tab(browser.cdp, {});
  await tab.open(1200, 'light');
  for (const kv of cookie.split('; ')) { const i = kv.indexOf('='); await tab.cdp.send('Network.setCookie', { name: kv.slice(0, i), value: kv.slice(i + 1), url: server.base, httpOnly: true }, tab.sid); }
  await tab.cdp.send('Page.navigate', { url: `${server.base}/modules/whiteboard?space=${space}&popout=1` }, tab.sid);
  await tab.waitFor('#module-frame >>> .wb-block[data-id="outside"]');
  await sleep(1500);
  const Q = (sel) => `__q('#module-frame >>> ${sel}')`;
  await tab.eval(`(() => { window.__wbErrors = []; window.addEventListener('error', (e) => window.__wbErrors.push(e.message)); return true; })()`);
  const rect = (id) => tab.eval(`(() => { const r = ${Q(`.wb-block[data-id="${id}"]`)}.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const click = async (id, fx = 0.5, fy = 0.5) => { const r = await rect(id); const x = r.x + r.w * fx; const y = r.y + r.h * fy; await tab.mouse('mouseMoved', x, y, { button: 'none', clickCount: 0 }); await tab.mouse('mousePressed', x, y); await tab.mouse('mouseReleased', x, y); await sleep(300); };
  const key = (k, o = {}) => tab.eval(`(() => { const b = ${Q('#board')}; b.focus(); b.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true, cancelable: true, ${Object.entries(o).map(([a, v]) => `${a}: ${v}`).join(', ')} })); return true; })()`);
  // Pick a block, unless it is picked already: a click on a block that is picked opens its words for editing, and a press while words
  // are edited only ends the editing (so a second click would swallow the press on a handle).
  const pick = async (id, fx, fy) => {
    if (await tab.eval(`${Q(`.wb-block[data-id="${id}"]`)}.classList.contains('wb-picked')`) && (await tab.eval(`${Q('#world')}.querySelectorAll('.wb-picked').length`)) === 1) return;
    await click(id, fx, fy);
  };
  const saved = () => sleep(1800); // a nudge is saved a moment after the key (the page waits so a run of presses is one step)

  // Marks are on a picture once saved there: nudge each (one key) and read what was stored.
  await click('inside');
  await key('ArrowRight');
  await click('note');
  await key('ArrowRight');
  await click('outside');
  await key('ArrowRight');
  await saved();
  check((await read('inside')).on === 'pic', 'a shape nudged on the picture is stored as on it');
  check((await read('note')).on === 'pic', 'a note nudged on the picture is stored as on it');
  check((await read('outside')).on === undefined, 'a shape nudged off the picture is on none');
  const before = { inside: await read('inside'), note: await read('note'), outside: await read('outside'), pic: await read('pic') };

  // The picture moved by the arrow keys takes its marks, and not the one that is on none.
  await pick('pic', 0.05, 0.9);
  for (let i = 0; i < 3; i += 1) await key('ArrowDown');
  await key('ArrowRight', { shiftKey: true });
  await saved();
  const moved = { inside: await read('inside'), note: await read('note'), outside: await read('outside'), pic: await read('pic') };
  const dpic = { x: moved.pic.x - before.pic.x, y: moved.pic.y - before.pic.y };
  check(dpic.x === 1 && dpic.y === 30, `the picture moved by the keys (got ${JSON.stringify(dpic)})`);
  check(moved.inside.x - before.inside.x === dpic.x && moved.inside.y - before.inside.y === dpic.y, 'the shape on it moved by the same amount');
  check(moved.note.x - before.note.x === dpic.x && moved.note.y - before.note.y === dpic.y, 'the note on it moved by the same amount');
  check(moved.outside.x === before.outside.x && moved.outside.y === before.outside.y, 'the shape on none stayed where it was');

  // A resize with the mouse scales the marks (the picture's south-east corner, 100 units out and down).
  await pick('pic', 0.05, 0.9);
  const handle = await tab.eval(`(() => { const h = ${Q('.wb-handle-se')}; if (!h) return null; const r = h.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  check(Boolean(handle), 'the picked picture has a south-east handle');
  if (handle) {
    // Pointer events as the browser sends them (the way the right-drag check does): a press on the handle, then moves and a release on the board.
    await tab.eval(`(async () => {
      const handle = ${Q('.wb-handle-se')};
      const board = ${Q('#board')};
      const ev = (type, x, y) => new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 5, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1 });
      const r = handle.getBoundingClientRect();
      const x0 = r.x + r.width / 2; const y0 = r.y + r.height / 2;
      handle.dispatchEvent(ev('pointerdown', x0, y0));
      for (let i = 1; i <= 10; i += 1) board.dispatchEvent(ev('pointermove', x0 + 10 * i, y0 + 6 * i));
      board.dispatchEvent(ev('pointerup', x0 + 100, y0 + 60));
      return true;
    })()`);
    await sleep(1500);
    const after = { inside: await read('inside'), note: await read('note'), pic: await read('pic'), outside: await read('outside') };
    const sx = after.pic.w / moved.pic.w;
    const sy = after.pic.h / moved.pic.h;
    check(sx > 1.2 && Math.abs(sx - sy) < 0.01, `the picture grew and kept its shape (x${sx.toFixed(3)}, x${sy.toFixed(3)})`);
    const near = (a, b) => Math.abs(a - b) <= 0.6;
    check(near(after.inside.x, after.pic.x + (moved.inside.x - moved.pic.x) * sx) && near(after.inside.y, after.pic.y + (moved.inside.y - moved.pic.y) * sy), 'the shape on it kept its place on the picture (scaled with it)');
    check(near(after.inside.w, moved.inside.w * sx) && near(after.inside.h, moved.inside.h * sy), 'the shape on it scaled in size');
    check(near(after.note.w, moved.note.w * sx) && near(after.note.h, moved.note.h * sy), 'the note on it scaled in size');
    check(after.inside.weight === moved.inside.weight && after.inside.size === moved.inside.size, 'its line width and the size of its words were left alone');
    check(after.outside.x === moved.outside.x && after.outside.w === moved.outside.w, 'the shape on none was not touched');
  }

  // One undo (Ctrl+Z) puts the picture and its marks back as they were before the resize: it was one step.
  await key('z', { ctrlKey: true });
  await sleep(1800);
  const undone = { inside: await read('inside'), note: await read('note'), pic: await read('pic') };
  check(undone.pic.w === moved.pic.w && undone.pic.h === moved.pic.h, `one undo gave the picture its size back (${undone.pic.w} x ${undone.pic.h})`);
  check(undone.inside.x === moved.inside.x && undone.inside.w === moved.inside.w && undone.note.w === moved.note.w && undone.note.x === moved.note.x, 'and the marks theirs, in the same step');
  await key('z', { ctrlKey: true, shiftKey: true });
  await sleep(1800);
  const redone = await read('pic');
  check(redone.w > moved.pic.w, 'redo makes the picture bigger again');
  await key('z', { ctrlKey: true });
  await sleep(1800);

  // Duplicate (Ctrl+D) with the picture picked: the picture and its two marks are copied, the marks onto the copy.
  const blocksBefore = await tab.eval(`${Q('#world')}.querySelectorAll('.wb-block').length`);
  await pick('pic', 0.05, 0.9);
  await key('d', { ctrlKey: true });
  await sleep(1800);
  const blocksAfter = await tab.eval(`${Q('#world')}.querySelectorAll('.wb-block').length`);
  check(blocksAfter === blocksBefore + 3, `Duplicate made a picture and its two marks (blocks ${blocksBefore} -> ${blocksAfter})`);
  const ids = await tab.eval(`[...${Q('#world')}.querySelectorAll('.wb-block')].map((e) => e.dataset.id)`);
  const fresh = ids.filter((id) => !['pic', 'inside', 'note', 'outside'].includes(id));
  const copies = (await Promise.all(fresh.map(read))).filter(Boolean);
  const copyPic = copies.find((b) => b.type === 'image');
  const copyMarks = copies.filter((b) => b.type !== 'image');
  check(copyPic && copyMarks.length === 2 && copyMarks.every((m) => m.on === copyPic.id), 'the duplicated marks are on the duplicated picture');
  check((await read('inside')).on === 'pic' && (await read('note')).on === 'pic', 'the first marks are still on the first picture');

  // Delete the picture it made (picked after the duplicate): its two marks go, nothing else.
  await key('Delete');
  await sleep(1800);
  const left = await tab.eval(`[...${Q('#world')}.querySelectorAll('.wb-block')].map((e) => e.dataset.id).sort().join()`);
  check(left === ['inside', 'note', 'outside', 'pic'].sort().join(), `Delete took the duplicate and its marks and nothing else (left: ${left})`);

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
  console.error(`check-whiteboard-marks-live: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`check-whiteboard-marks-live: OK, ${passed} cases`);
