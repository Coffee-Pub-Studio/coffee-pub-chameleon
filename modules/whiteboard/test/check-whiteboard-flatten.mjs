#!/usr/bin/env node
/*
 * check-whiteboard-flatten.mjs -- Flatten (whiteboard.js: flatten, placeFlattened; lib-u wbFlattenPlan; lib-l's flat export), in a real browser against
 * a throwaway server (tools/shots.mjs; no LiveKit).
 * Guards: a picture with something to bake offers Flatten, and one with nothing does not; Flatten makes ONE new picture with an upload of its own, in the
 * place of the picture and its marks (both gone from the board and from the stored data), with no crop, blur or holes left in it; what was
 * drawn is in the new file's pixels: its size is the cropped part's, the hole is see-through, the mark is drawn over the picture and the rest is
 * the picture; the new block keeps the old one's box; and one undo brings the picture and its mark back and takes the new picture away. The
 * pixels are read back from the stored upload.
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
  console.log('check-whiteboard-flatten: SKIPPED. No Chromium found (set CHROME_PATH, or install one: npx playwright install chromium). This is not a pass; nothing was measured.');
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
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-whiteboard-flatten-'));
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
  const space = (await call('POST', '/api/spaces', { name: 'Flatten' })).space.id;
  const up = await call('POST', `/api/modules/whiteboard/uploads?scope=space&space=${space}&name=grey.png`, png(200, 120), true);
  const now = new Date().toISOString();
  const put = (b) => call('PUT', `/api/modules/whiteboard/data/${encodeURIComponent(`block:main:${b.id}`)}?scope=space&space=${space}`, { value: { by: 'x', at: now, z: 1, ...b } });
  const read = async (id) => { try { const r = await call('GET', `/api/modules/whiteboard/data/${encodeURIComponent(`block:main:${id}`)}?scope=space&space=${space}`); return (r.item && r.item.value) || null; } catch { return null; } };
  // A plain picture (nothing to bake), and one cropped to its middle half (the box is the part's, at twice its pixels), with a hole at the
  // top left of what is shown and a gold shape on it.
  await put({ id: 'plain', type: 'image', x: 600, y: 60, w: 200, h: 120, upload: up.file.id, alt: '', stroke: 'none', weight: 2 });
  await put({ id: 'pic', type: 'image', x: 60, y: 60, w: 200, h: 240, upload: up.file.id, alt: 'a grey picture', stroke: 'none', weight: 2, crop: { x: 0.25, y: 0, w: 0.5, h: 1 }, cut: [{ x: 0.25, y: 0, w: 0.1, h: 0.4 }] });
  await put({ id: 'mark', type: 'rect', x: 120, y: 160, w: 80, h: 60, z: 5, on: 'pic', stroke: 'none', fill: 'gold', ink: 'ink', weight: 3, size: 'medium', align: 'center', text: '' });

  browser = await launch(bin);
  tab = new Tab(browser.cdp, {});
  await tab.open(1200, 'light');
  for (const kv of cookie.split('; ')) { const i2 = kv.indexOf('='); await tab.cdp.send('Network.setCookie', { name: kv.slice(0, i2), value: kv.slice(i2 + 1), url: server.base, httpOnly: true }, tab.sid); }
  await tab.cdp.send('Page.navigate', { url: `${server.base}/modules/whiteboard?space=${space}&popout=1` }, tab.sid);
  await tab.waitFor('#module-frame >>> .wb-block[data-id="mark"]');
  await sleep(1500);
  const Q = (sel) => `__q('#module-frame >>> ${sel}')`;
  await tab.eval(`(() => { window.__wbErrors = []; window.addEventListener('error', (e) => window.__wbErrors.push(e.message)); return true; })()`);
  const rect = (id) => tab.eval(`(() => { const r = ${Q(`.wb-block[data-id="${id}"]`)}.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const click = async (id, fx = 0.5, fy = 0.5) => { const r = await rect(id); const x = r.x + r.w * fx; const y = r.y + r.h * fy; await tab.mouse('mouseMoved', x, y, { button: 'none', clickCount: 0 }); await tab.mouse('mousePressed', x, y); await tab.mouse('mouseReleased', x, y); await sleep(400); };
  const key = (k, o = {}) => tab.eval(`(() => { const b = ${Q('#board')}; b.focus(); b.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true, cancelable: true, ${Object.entries(o).map(([a, v]) => `${a}: ${v}`).join(', ')} })); return true; })()`);
  const flattenButton = () => tab.eval(`(() => { const b = ${Q('#paint')}.querySelector('button[aria-label="Flatten"]'); return b ? !b.hidden : false; })()`);
  const ids = () => tab.eval(`[...${Q('#world')}.querySelectorAll('.wb-block')].map((e) => e.dataset.id).sort()`);

  // Only a picture with something to bake offers Flatten.
  await click('plain');
  check(!(await flattenButton()), 'a picture with nothing to flatten does not offer Flatten');
  await click('pic', 0.9, 0.9); // low on the picture, clear of the shape and the hole
  check(await flattenButton(), 'a picture with a crop, a hole and a mark offers Flatten');
  const before = await read('pic');

  // Flatten it: its upload goes up and the new picture takes the place of the old one and its mark.
  await tab.eval(`(() => { ${Q('#paint')}.querySelector('button[aria-label="Flatten"]').click(); return true; })()`);
  let after = null;
  for (let i3 = 0; i3 < 40 && !after; i3 += 1) { await sleep(500); const list = await ids(); if (list.includes('plain') && list.length === 2 && !list.includes('pic')) after = list.filter((id) => id !== 'plain')[0]; }
  check(Boolean(after), `Flatten put one new picture in the place of the picture and its mark (the board now: ${(await ids()).join(', ')})`);
  if (after) {
    await sleep(1500);
    const flat = await read(after);
    check(flat && flat.type === 'image' && flat.upload && flat.upload !== before.upload, 'the new picture has an upload of its own');
    check(flat && flat.crop === undefined && flat.blur === undefined && flat.cut === undefined, 'with no crop, blur or holes left in it');
    check(flat && flat.x === 60 && flat.y === 60 && flat.w === 200 && flat.h === 240, `in the old picture's box (got ${flat && `${flat.x},${flat.y} ${flat.w}x${flat.h}`})`);
    check(flat && flat.alt === 'a grey picture', 'and its description');
    check((await read('pic')) === null && (await read('mark')) === null, 'the old picture and its mark are gone from the stored data');
    check((await read('plain')) !== null, 'another picture was not touched');

    // What was drawn is in the new file: read its pixels back.
    const px = await tab.eval(`(async () => {
      const res = await fetch('/api/modules/whiteboard/uploads/${flat.upload}?scope=space&space=${space}');
      const bm = await createImageBitmap(await res.blob());
      const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height;
      const g = c.getContext('2d'); g.drawImage(bm, 0, 0);
      const at = (fx, fy) => Array.from(g.getImageData(Math.min(bm.width - 1, Math.floor(bm.width * fx)), Math.min(bm.height - 1, Math.floor(bm.height * fy)), 1, 1).data);
      return { w: bm.width, h: bm.height, hole: at(0.05, 0.1), grey: at(0.85, 0.2), mark: at(0.5, 0.54) };
    })()`);
    check(px.w === 100 && px.h === 120, `the new file is the cropped part's size, at the picture's own pixels (got ${px.w} x ${px.h})`);
    check(px.hole[3] === 0, `the hole is see-through in it (alpha ${px.hole[3]})`);
    check(px.grey[3] === 255 && Math.abs(px.grey[0] - 0x99) <= 2 && Math.abs(px.grey[1] - 0x99) <= 2, `the rest is the picture (got ${px.grey.join(',')})`);
    check(px.mark[3] === 255 && (Math.abs(px.mark[0] - px.grey[0]) > 4 || Math.abs(px.mark[2] - px.grey[2]) > 4), `the mark is drawn over it (got ${px.mark.join(',')} against ${px.grey.join(',')})`);
  }

  // One undo brings the picture and its mark back, and takes the new one away.
  await key('z', { ctrlKey: true });
  await sleep(2000);
  const back = await ids();
  check(back.join() === ['mark', 'pic', 'plain'].join(), `one undo put the picture and its mark back and took the new picture away (the board: ${back.join(', ')})`);
  const restored = await read('pic');
  const markBack = await read('mark');
  check(restored && restored.crop && restored.cut && restored.upload === before.upload && markBack && markBack.on === 'pic', `as they were, hole and mark on it (${JSON.stringify({ crop: restored && restored.crop, cut: restored && restored.cut, sameUpload: restored && restored.upload === before.upload, on: markBack && markBack.on })})`);

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
  console.error(`check-whiteboard-flatten: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`check-whiteboard-flatten: OK, ${passed} cases`);
