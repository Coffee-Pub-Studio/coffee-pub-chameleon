#!/usr/bin/env node
/*
 * check-whiteboard-strip-phone.mjs -- the tool strip on a phone (whiteboard.css, the max-width 640px rule), in a real browser at 390 pixels wide
 * against a throwaway server (tools/shots.mjs; no LiveKit). Guards: with a note picked the strip is ONE row (not rows stacked over the board) that
 * scrolls sideways (its content is wider than it) and fits the screen. (The wide window's wrapping and the standing column are not covered here.)
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
  console.log('check-whiteboard-strip-phone: SKIPPED. No Chromium found (set CHROME_PATH, or install one: npx playwright install chromium). This is not a pass; nothing was measured.');
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
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-whiteboard-strip-phone-'));
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
  const space = (await call('POST', '/api/spaces', { name: 'Shape remember' })).space.id;
  const now = new Date().toISOString();
  const put = (b) => call('PUT', `/api/modules/whiteboard/data/${encodeURIComponent(`block:main:${b.id}`)}?scope=space&space=${space}`, { value: { by: 'x', at: now, z: 5, ...b } });
  await put({ id: 's1', type: 'rect', x: 100, y: 120, w: 160, h: 100, fill: 'gold', stroke: 'auto', weight: 2, text: '' });
  browser = await launch(bin);
  tab = new Tab(browser.cdp, {});
  await tab.open(390, 'light');
  for (const kv of cookie.split('; ')) { const i2 = kv.indexOf('='); await tab.cdp.send('Network.setCookie', { name: kv.slice(0, i2), value: kv.slice(i2 + 1), url: server.base, httpOnly: true }, tab.sid); }
  await tab.cdp.send('Page.navigate', { url: `${server.base}/modules/whiteboard?space=${space}&popout=1` }, tab.sid);
  await tab.waitFor('#module-frame >>> .wb-block[data-id="s1"]');
  await sleep(1500);
  const Q = (sel) => `__q('#module-frame >>> ${sel}')`;
  const blocks = async () => { const r = await call('GET', `/api/modules/whiteboard/data?scope=space&space=${space}`); return (r.items || []).map((it) => it.value).filter((v) => v && v.type); };
  const press = async (x0, y0, x1, y1) => {
    await tab.mouse('mouseMoved', x0, y0, { button: 'none', clickCount: 0 });
    await tab.mouse('mousePressed', x0, y0);
    for (let k = 1; k <= 6; k += 1) await tab.mouse('mouseMoved', x0 + ((x1 - x0) * k) / 6, y0 + ((y1 - y0) * k) / 6, { button: 'left', clickCount: 0 });
    await tab.mouse('mouseReleased', x1, y1);
    await sleep(900);
  };
  const r = await tab.eval(`(() => { const r = ${Q('.wb-block[data-id="s1"]')}.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
  await tab.mouse('mouseMoved', r.x + r.w / 2, r.y + r.h - 6, { button: 'none', clickCount: 0 });
  await tab.mouse('mousePressed', r.x + r.w / 2, r.y + r.h - 6);
  await tab.mouse('mouseReleased', r.x + r.w / 2, r.y + r.h - 6);
  await sleep(800);
  const strip = () => tab.eval(`(() => { const p = ${Q('#paint')}; const r = p.getBoundingClientRect(); return { h: r.height, w: r.width, scroll: p.scrollWidth, client: p.clientWidth, hidden: p.hidden }; })()`);
  let m = await strip();
  check(!m.hidden && m.h < 60, `on a phone the strip is one row (${m.h} px high)`);
  check(m.scroll > m.client + 20, `and it scrolls sideways (${m.scroll} wide in ${m.client})`);
  check(m.w <= 390, `and it fits the screen (${m.w} px)`);
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
  console.error(`check-whiteboard-strip-phone: ${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`check-whiteboard-strip-phone: OK, ${passed} cases`);
