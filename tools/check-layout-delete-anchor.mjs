#!/usr/bin/env node
/*
 * check-layout-delete-anchor.mjs -- Set up > Modules > Layouts: Delete on a saved layout asks "Delete <name>?" in the
 * shared confirm menu (openConfirmMenu) beside the layout's own "..." that was pressed, not under the Set up button in
 * the top bar. In a real browser against a throwaway seeded server (tools/shots.mjs; no LiveKit), at 1280 and 390 wide.
 * Keep it closes the confirm and keeps the layout; Delete deletes it. Run it under the browser lock:
 *   flock /tmp/browser-checks.lock node tools/check-layout-delete-anchor.mjs
 * LAYOUT_DELETE_SHOTS=<dir> also writes a picture of each step there. With no Chromium it says SKIPPED (not a pass).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const { bootSeeded, stopServer, freePort, findBrowser, launch, Tab, sleep } = await import('./shots.mjs');

const bin = findBrowser();
if (!bin) {
  console.log('check-layout-delete-anchor: SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.');
  process.exit(0);
}

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};
const SHOTS = process.env.LAYOUT_DELETE_SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-layout-delete-anchor-'));
let server;
let browser;
const tabs = [];
try {
  const port = await freePort();
  const boot = await bootSeeded('travel', dataDir, port);
  server = boot.server;
  const { ctx, cookies } = boot;
  browser = await launch(bin);
  const cookieOf = (as) => cookies[as].map((c) => `${c.name}=${c.value}`).join('; ');
  const saved = async () => {
    const r = await (await fetch(`${server.base}/api/spaces/${ctx.trip}/layouts`, { headers: { cookie: cookieOf('admin') } })).json();
    return [...(r.mine || []), ...(r.shared || [])];
  };
  for (const name of ['Whiteboard', 'Game night', 'Planning']) {
    const r = await fetch(`${server.base}/api/spaces/${ctx.trip}/layouts`, { method: 'POST', headers: { cookie: cookieOf('admin'), 'content-type': 'application/json' }, body: JSON.stringify({ name, shared: true, modules: [{ id: 'calendar', mode: 'dock', dockW: 360 }], snap: { all: false, pitch: 130 } }) });
    assert.equal(r.status, 201, `seed ${name}`);
  }
  const start = await saved();
  assert.ok(start.length >= 2, `the seeded space has saved layouts: ${JSON.stringify(start.map((l) => l.name))}`);

  const WORDS = process.env.LAYOUT_DELETE_LABEL || 'shot';
  // A phone has no Layouts list: Set up shows no Modules tab there (the Layout menu is empty when the canvas is narrow).
  await test('at 390: Set up has no Layouts list, so there is no layout row to confirm from', async () => {
    const tab = new Tab(browser.cdp, ctx);
    await tab.open(390, 'dark');
    tabs.push(tab);
    for (const c of cookies.admin) await tab.cdp.send('Network.setCookie', { name: c.name, value: c.value, url: server.base, httpOnly: true }, tab.sid);
    await tab.cdp.send('Page.navigate', { url: `${server.base}/#join=${ctx.trip}` }, tab.sid);
    await tab.waitFor('#nav-toggle');
    await sleep(900);
    await tab.click('#nav-toggle');
    await sleep(300);
    await tab.click('#setup');
    await tab.waitFor('#space-setup .setup-tab');
    await sleep(900);
    assert.equal(await tab.eval(`document.querySelectorAll('#setup-show .host-menu-more').length`), 0, 'no layout rows on a phone');
    if (SHOTS) fs.writeFileSync(path.join(SHOTS, `${WORDS}-390-setup.png`), await tab.shoot(false));
  });
  for (const [width, mode] of [[1280, 'dark']]) {
    await test(`at ${width}: Delete's confirm opens by the layout's "..." row, Keep it closes it, Delete deletes`, async () => {
      const tab = new Tab(browser.cdp, ctx);
      await tab.open(width, mode);
      tabs.push(tab);
      for (const c of cookies.admin) await tab.cdp.send('Network.setCookie', { name: c.name, value: c.value, url: server.base, httpOnly: true }, tab.sid);
      await tab.cdp.send('Page.navigate', { url: `${server.base}/#join=${ctx.trip}` }, tab.sid);
      await tab.waitFor('#setup');
      await sleep(900);
      await tab.click('#setup');
      await tab.waitFor('#space-setup .setup-tab');
      await sleep(900);
      const list = await saved();
      const target = list[list.length - 1]; // the last one: the farthest from the top bar
      const rowSel = `#setup-show .host-menu-pair`;
      const find = (name) => `(() => { const m = [...document.querySelectorAll('#setup-show .host-menu-more')].find((b) => b.getAttribute('aria-label') === ${JSON.stringify('More for ' + name)}); return m || null; })()`;
      const more = await tab.eval(`(() => { const b = ${find(target.name)}; if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
      assert.ok(more, `a "..." for ${target.name}`);
      const moreSel = `#setup-show .host-menu-more[aria-label="More for ${target.name.replace(/"/g, '\\"')}"]`;
      await tab.click(moreSel);
      await sleep(400);
      if (SHOTS) fs.writeFileSync(path.join(SHOTS, `${WORDS}-${width}-1-row-menu.png`), await tab.shoot(false));
      await tab.click('.host-menu-flyout .host-menu-item.danger, .host-menu .host-menu-item.danger', 'Delete');
      await sleep(500);
      const seen = await tab.eval(`(() => {
        const confirm = [...document.querySelectorAll('.host-menu')].find((m) => m.textContent.includes(${JSON.stringify('Delete ' + target.name + '?')}));
        if (!confirm) return null;
        const c = confirm.getBoundingClientRect();
        const row = document.querySelector(${JSON.stringify(`#setup-show .host-menu-more[aria-label="More for ${target.name.replace(/"/g, '\\"')}"]`)});
        const r = row ? row.getBoundingClientRect() : null;
        const t = document.getElementById('setup').getBoundingClientRect();
        return { c: { top: c.top, bottom: c.bottom, left: c.left, right: c.right }, row: r && { top: r.top, bottom: r.bottom }, setup: { top: t.top, bottom: t.bottom }, keep: confirm.textContent.includes('Keep it') };
      })()`);
      assert.ok(seen, 'the confirm menu "Delete <name>?" is open');
      assert.ok(seen.keep, 'it offers Keep it');
      if (SHOTS) fs.writeFileSync(path.join(SHOTS, `${WORDS}-${width}-2-confirm.png`), await tab.shoot(false));
      if (seen.row) {
        const gap = Math.min(Math.abs(seen.c.top - seen.row.bottom), Math.abs(seen.c.bottom - seen.row.top), Math.abs(seen.c.top - seen.row.top), Math.abs(seen.c.bottom - seen.row.bottom));
        const overlap = seen.c.top < seen.row.bottom && seen.c.bottom > seen.row.top;
        assert.ok(overlap || gap <= 120, `the confirm (${Math.round(seen.c.top)}-${Math.round(seen.c.bottom)}) is within 120px of the row (${Math.round(seen.row.top)}-${Math.round(seen.row.bottom)})`);
      } else {
        // The row's "..." is gone while the confirm shows (a phone drills in): the confirm must still not be under Set up.
        assert.ok(seen.c.top > seen.setup.bottom + 20 || seen.c.bottom < seen.setup.top, 'not under the Set up button');
      }
      assert.ok(!(seen.c.top <= seen.setup.bottom + 8 && seen.c.top >= seen.setup.top - 8) || seen.row && Math.abs(seen.row.top - seen.setup.top) < 120, 'not under the top bar Set up icon');
      // Keep it: closes the confirm, the layout stays.
      await tab.click('.host-menu .host-menu-item', 'Keep it');
      await sleep(500);
      assert.equal(await tab.eval(`[...document.querySelectorAll('.host-menu')].some((m) => m.textContent.includes('Keep it'))`), false, 'Keep it closes the confirm');
      assert.ok((await saved()).some((l) => l.id === target.id), 'Keep it keeps the layout');
      // Delete: ask again, then confirm.
      await tab.click(moreSel);
      await sleep(300);
      await tab.click('.host-menu .host-menu-item.danger', 'Delete');
      await sleep(400);
      await tab.click('.host-menu .host-menu-item.danger', `Delete ${target.name}?`);
      await sleep(900);
      assert.ok(!(await saved()).some((l) => l.id === target.id), 'Delete deleted the layout');
      if (SHOTS) fs.writeFileSync(path.join(SHOTS, `${WORDS}-${width}-3-deleted.png`), await tab.shoot(false));
    });
  }
} finally {
  for (const t of tabs) await t.close().catch(() => {});
  if (browser) await browser.close?.().catch?.(() => {});
  if (server) await stopServer(server);
  fs.rmSync(dataDir, { recursive: true, force: true });
}
console.log(failed ? `check-layout-delete-anchor: ${failed} FAILED, ${n} passed` : `check-layout-delete-anchor: ok (${n} passed)`);
process.exit(failed ? 1 : 0);
