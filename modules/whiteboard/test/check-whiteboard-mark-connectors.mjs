#!/usr/bin/env node
/*
 * check-whiteboard-mark-connectors.mjs -- connectors and the marks of a picture (a connector is drawn from the blocks it joins: lib-e-block-connector),
 * in a real browser against a throwaway server (tools/shots.mjs; no LiveKit).
 * Guards: a connector joining two marks of a picture moves with them when the picture is moved by the keys, and stretches and shrinks with them
 * when it is resized (it stays joined to each mark's side); a connector from a mark to a block off the picture follows the mark and stays joined to
 * the other block; Duplicate copies the connector between the two marks onto the copied marks (and leaves the one to the outside block with the
 * original); Delete takes both connectors with the picture's marks and leaves the block off the picture. Keys as the browser sends them; the resize
 * is pointer events on the handle, as the other browser checks do it.
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
  console.log('check-whiteboard-mark-connectors: SKIPPED. No Chromium found (set CHROME_PATH, or install one: npx playwright install chromium). This is not a pass; nothing was measured.');
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
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-whiteboard-mark-connectors-'));
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
  const space = (await call('POST', '/api/spaces', { name: 'Mark connectors' })).space.id;
  const up = await call('POST', `/api/modules/whiteboard/uploads?scope=space&space=${space}&name=grey.png`, png(200, 120), true);
  const now = new Date().toISOString();
  const put = (b) => call('PUT', `/api/modules/whiteboard/data/${encodeURIComponent(`block:main:${b.id}`)}?scope=space&space=${space}`, { value: { by: 'x', at: now, z: 1, ...b } });
  const read = async (id) => { try { const r = await call('GET', `/api/modules/whiteboard/data/${encodeURIComponent(`block:main:${id}`)}?scope=space&space=${space}`); return (r.item && r.item.value) || null; } catch { return null; } };
  const box = { stroke: 'ink', fill: 'gold', ink: 'ink', weight: 3, size: 'medium', align: 'center', text: '' };
  await put({ id: 'pic', type: 'image', x: 60, y: 60, w: 400, h: 240, upload: up.file.id, alt: '', stroke: 'none', weight: 2 });
  await put({ id: 'm1', type: 'rect', x: 100, y: 120, w: 80, h: 50, z: 5, on: 'pic', ...box });
  await put({ id: 'm2', type: 'rect', x: 300, y: 200, w: 80, h: 50, z: 5, on: 'pic', ...box });
  await put({ id: 'out', type: 'rect', x: 600, y: 120, w: 80, h: 50, z: 5, ...box });
  const line = { type: 'connector', z: 6, style: 'straight', head: 'end', stroke: 'ink', weight: 2, label: '' };
  await put({ id: 'c1', from: { block: 'm1', side: 'right' }, to: { block: 'm2', side: 'left' }, ...line });
  await put({ id: 'c2', from: { block: 'm1', side: 'right' }, to: { block: 'out', side: 'left' }, ...line });

  browser = await launch(bin);
  tab = new Tab(browser.cdp, {});
  await tab.open(1200, 'light');
  for (const kv of cookie.split('; ')) { const i2 = kv.indexOf('='); await tab.cdp.send('Network.setCookie', { name: kv.slice(0, i2), value: kv.slice(i2 + 1), url: server.base, httpOnly: true }, tab.sid); }
  await tab.cdp.send('Page.navigate', { url: `${server.base}/modules/whiteboard?space=${space}&popout=1` }, tab.sid);
  await tab.waitFor('#module-frame >>> .wb-block[data-id="c2"]');
  await sleep(1500);
  const Q = (sel) => `__q('#module-frame >>> ${sel}')`;
  await tab.eval(`(() => { window.__wbErrors = []; window.addEventListener('error', (e) => window.__wbErrors.push(e.message)); return true; })()`);
  const rect = (id) => tab.eval(`(() => { const e = ${Q(`.wb-block[data-id="${id}"]`)}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  const click = async (id, fx = 0.5, fy = 0.5) => { const r = await rect(id); const x = r.x + r.w * fx; const y = r.y + r.h * fy; await tab.mouse('mouseMoved', x, y, { button: 'none', clickCount: 0 }); await tab.mouse('mousePressed', x, y); await tab.mouse('mouseReleased', x, y); await sleep(400); };
  const key = (k, o = {}) => tab.eval(`(() => { const b = ${Q('#board')}; b.focus(); b.dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true, cancelable: true, ${Object.entries(o).map(([a, v]) => `${a}: ${v}`).join(', ')} })); return true; })()`);
  const ids = () => tab.eval(`[...${Q('#world')}.querySelectorAll('.wb-block')].map((e) => e.dataset.id).sort()`);
  const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;
  const all = async () => ({ pic: await rect('pic'), m1: await rect('m1'), m2: await rect('m2'), out: await rect('out'), c1: await rect('c1'), c2: await rect('c2') });
  // How far a connector's drawn box reaches past the gap between the blocks it joins (its line's padding): the same wherever the blocks are.
  const pad = (c, a, b) => c.w - (b.x - (a.x + a.w));

  const start = await all();
  check(start.c1 && start.c2, 'the two connectors are drawn');
  const pad1 = pad(start.c1, start.m1, start.m2);
  const pad2 = pad(start.c2, start.m1, start.out);

  // The picture moved by the keys: the connectors go with the marks they join, and stay joined to the block off the picture.
  await click('pic', 0.05, 0.9);
  for (let i = 0; i < 3; i += 1) await key('ArrowDown');
  await key('ArrowRight', { shiftKey: true });
  await sleep(1800);
  const moved = await all();
  const dx = moved.pic.x - start.pic.x;
  const dy = moved.pic.y - start.pic.y;
  check(near(dx, 1) && near(dy, 30), `the picture moved by the keys (${dx}, ${dy})`);
  check(near(moved.m1.x - start.m1.x, dx) && near(moved.m2.y - start.m2.y, dy), 'its marks moved with it');
  check(near(pad(moved.c1, moved.m1, moved.m2), pad1) && near(moved.c1.x, start.c1.x + dx) && near(moved.c1.y, start.c1.y + dy), 'the connector joining the two marks moved with them, joined to each');
  check(near(pad(moved.c2, moved.m1, moved.out), pad2) && near(moved.c2.x + moved.c2.w, start.c2.x + start.c2.w), 'the connector to the block off the picture followed its mark and kept its other end on that block');

  // A resize scales the marks, and the connectors stay joined to them (the gap between the two marks scales with the picture).
  const handle = await tab.eval(`(() => { const h = ${Q('.wb-handle-se')}; if (!h) return null; return true; })()`);
  check(Boolean(handle), 'the picked picture has a south-east handle');
  if (handle) {
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
    await sleep(1800);
    const grown = await all();
    const s = grown.pic.w / moved.pic.w;
    check(s > 1.2, `the picture grew (x${s.toFixed(3)})`);
    check(near(pad(grown.c1, grown.m1, grown.m2), pad1) && grown.c1.w > moved.c1.w + 5, 'the connector joining the two marks stretched with them and is still joined to each');
    check(near(pad(grown.c2, grown.m1, grown.out), pad2), 'the connector to the block off the picture is still joined to its mark and to that block');
    check(near(grown.out.x, moved.out.x) && near(grown.out.y, moved.out.y), 'the block off the picture stayed where it was');
  }

  // Duplicate (Ctrl+D) with the picture picked: the connector between the two marks is copied onto the copies; the other stays with the original.
  const before = await ids();
  await key('d', { ctrlKey: true });
  await sleep(1800);
  const after = await ids();
  const fresh = after.filter((id) => !before.includes(id));
  const copies = (await Promise.all(fresh.map(async (id) => ({ id, ...(await read(id)) })))).filter((b) => b.type);
  const copyPic = copies.find((b) => b.type === 'image');
  const copyMarks = copies.filter((b) => b.type === 'rect');
  const copyLines = copies.filter((b) => b.type === 'connector');
  check(copyPic && copyMarks.length === 2, 'Duplicate made a picture and its two marks');
  check(copyLines.length === 1, `and one connector, the one between the two marks (made ${copyLines.length})`);
  check(copyLines.length === 1 && copyLines[0].from.block !== 'm1' && copyLines[0].to.block !== 'm2' && copyMarks.some((m) => m.id === copyLines[0].from.block) && copyMarks.some((m) => m.id === copyLines[0].to.block), 'joined to the copied marks, not the first ones');
  check((await read('c2')) && (await read('c2')).to.block === 'out' && !copies.some((b) => b.type === 'connector' && b.to.block === 'out'), 'the connector to the block off the picture stays with the original');

  // Delete the duplicate (it is picked): its connector goes with its marks, and the first picture's connectors are left.
  await key('Delete');
  await sleep(1800);
  const left = await ids();
  check(left.join() === ['c1', 'c2', 'm1', 'm2', 'out', 'pic'].sort().join(), `Delete took the duplicate, its marks and its connector (left: ${left.join(', ')})`);

  // Delete the first picture: its marks go, and both connectors with them; the block off the picture stays.
  await click('pic', 0.05, 0.9);
  await key('Delete');
  await sleep(1800);
  const gone = await ids();
  check(gone.join() === 'out', `Delete took the picture, its marks and both connectors, and left the block off the picture (left: ${gone.join(', ')})`);

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
  console.error(`check-whiteboard-mark-connectors: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`check-whiteboard-mark-connectors: OK, ${passed} cases`);
