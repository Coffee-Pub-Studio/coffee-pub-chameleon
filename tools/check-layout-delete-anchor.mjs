#!/usr/bin/env node
/*
 * check-layout-delete-anchor.mjs -- the tab menu's Layouts (the Workspace tab's caret; plan-workspaces.md, decisions 38 and 40):
 * Delete on a layout for everyone asks "Delete <name>?" in the shared confirm menu (openConfirmMenu) where the tab menu was, under
 * the caret it opened from (the menu closes as the row's "..." entry is picked), never under Set up. In a real browser
 * against a throwaway seeded server (tools/shots.mjs; no LiveKit), at 1280 and 390 wide.
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
    return r.shared || [];
  };
  for (const name of ['Whiteboard', 'Game night', 'Planning']) {
    const r = await fetch(`${server.base}/api/spaces/${ctx.trip}/layouts`, { method: 'POST', headers: { cookie: cookieOf('admin'), 'content-type': 'application/json' }, body: JSON.stringify({ name, shared: true, shape: 'one', areas: [null] }) });
    assert.equal(r.status, 201, `seed ${name}`);
  }
  const start = await saved();
  assert.ok(start.length >= 2, `the seeded space has saved layouts: ${JSON.stringify(start.map((l) => l.name))}`);

  const WORDS = process.env.LAYOUT_DELETE_LABEL || 'shot';
  // A phone has no Layouts list: no tab menu there (the tab bar is the list), and Set up holds no layout rows.
  await test('at 390: no tab menu and no Layouts list in Set up, so there is no layout row to confirm from', async () => {
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
    assert.equal(await tab.eval(`document.querySelectorAll('#space-setup .host-menu-more').length`), 0, 'no layout rows in Set up');
    assert.equal(await tab.eval(`Boolean(document.querySelector('[data-tab-menu="workspace"]')?.getClientRects().length)`), false, 'no tab menu on a phone');
    if (SHOTS) fs.writeFileSync(path.join(SHOTS, `${WORDS}-390-setup.png`), await tab.shoot(false));
  });
  for (const [width, mode] of [[1280, 'dark']]) {
    await test(`at ${width}: Delete's confirm opens where the tab menu was, under the Workspace tab's caret; Keep it closes it, Delete deletes`, async () => {
      const tab = new Tab(browser.cdp, ctx);
      await tab.open(width, mode);
      tabs.push(tab);
      for (const c of cookies.admin) await tab.cdp.send('Network.setCookie', { name: c.name, value: c.value, url: server.base, httpOnly: true }, tab.sid);
      await tab.cdp.send('Page.navigate', { url: `${server.base}/#join=${ctx.trip}` }, tab.sid);
      await tab.waitFor('[data-tab-menu="workspace"]');
      await sleep(900);
      const openMenu = async () => { await tab.click('[data-tab-menu="workspace"]'); await tab.waitFor('body > .host-menu .host-menu-more'); await sleep(500); };
      await openMenu();
      const list = await saved();
      const target = list[list.length - 1]; // the last one: the farthest from the top bar
      const find = (name) => `(() => { const m = [...document.querySelectorAll('body > .host-menu .host-menu-more')].find((b) => b.getAttribute('aria-label') === ${JSON.stringify('More for ' + name)}); return m || null; })()`;
      const more = await tab.eval(`(() => { const b = ${find(target.name)}; if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
      assert.ok(more, `a "..." for ${target.name}`);
      const moreSel = `body > .host-menu .host-menu-more[aria-label="More for ${target.name.replace(/"/g, '\\"')}"]`;
      await tab.click(moreSel);
      await sleep(400);
      if (SHOTS) fs.writeFileSync(path.join(SHOTS, `${WORDS}-${width}-1-row-menu.png`), await tab.shoot(false));
      await tab.click('.host-menu-flyout .host-menu-item.danger, .host-menu .host-menu-item.danger', 'Delete');
      await sleep(500);
      const seen = await tab.eval(`(() => {
        const confirm = [...document.querySelectorAll('.host-menu')].find((m) => m.textContent.includes(${JSON.stringify('Delete ' + target.name + '?')}));
        if (!confirm) return null;
        const c = confirm.getBoundingClientRect();
        const t = document.getElementById('setup').getBoundingClientRect();
        const b = document.querySelector('[data-tab-menu="workspace"]').getBoundingClientRect();
        return { c: { top: c.top, bottom: c.bottom, left: c.left, right: c.right }, setup: { left: t.left, right: t.right }, button: { top: b.top, bottom: b.bottom, left: b.left, right: b.right }, keep: confirm.textContent.includes('Keep it'), lists: document.querySelectorAll('.host-menu:not(.host-menu-inline)').length };
      })()`);
      assert.ok(seen, 'the confirm menu "Delete <name>?" is open');
      assert.ok(seen.keep, 'it offers Keep it');
      if (SHOTS) fs.writeFileSync(path.join(SHOTS, `${WORDS}-${width}-2-confirm.png`), await tab.shoot(false));
      assert.equal(seen.lists, 1, 'one menu at a time: the confirm replaced the tab menu');
      assert.ok(seen.c.top >= seen.button.bottom - 1 && seen.c.top <= seen.button.bottom + 12, `the confirm (${Math.round(seen.c.top)}) opens under the caret (${Math.round(seen.button.bottom)}), where the menu was`);
      assert.ok(seen.c.left <= seen.button.right && seen.c.right >= seen.button.left, 'beside it, not across the bar');
      // Keep it: closes the confirm, the layout stays.
      await tab.click('.host-menu .host-menu-item', 'Keep it');
      await sleep(500);
      assert.equal(await tab.eval(`[...document.querySelectorAll('.host-menu')].some((m) => m.textContent.includes('Keep it'))`), false, 'Keep it closes the confirm');
      assert.ok((await saved()).some((l) => l.id === target.id), 'Keep it keeps the layout');
      // Delete: ask again, then confirm.
      await openMenu();
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
