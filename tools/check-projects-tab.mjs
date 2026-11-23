#!/usr/bin/env node
/*
 * check-projects-tab.mjs -- the Projects tab (Thomas, 2026-11-23, over plan-workspaces.md decision 19): one more Fixed
 * Workspace, id `schedule`, that opens the Planner - Projects module (`schedule`) large, as Whiteboards and Documents open
 * theirs. In a real browser against a throwaway seeded server (tools/shots.mjs; no LiveKit):
 *   - a space made from the Projects template shows the tab second, with the module's name and icon (`diagram-project`)
 *   - pressing it opens the Planner docked, alone, filling the canvas, and the tab is the current one
 *   - a space whose template does not offer the Planner (the seeded Travel trip) has no such tab
 *   - the owner's hide takes it out of the bar; a guest gets no Fixed Workspaces, so no tab
 *   - Set up's Layouts rows list it with Show in the bar, Move up, Move down and Opens first; Move up moves it, a save keeps it
 * Run it under the shared browser lock. With no Chromium it says SKIPPED (set CHROME_PATH); that is not a pass.
 * PROJECTS_TAB_SHOTS=<dir> writes screenshots (1280 and 390, light and dark): the tab bar and the opened tab.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { stopBrowser } from './browser-launch.mjs';

const { bootSeeded, stopServer, freePort, findBrowser, launch, Tab, sleep } = await import('./shots.mjs');

const bin = findBrowser();
if (!bin) {
  console.log('check-projects-tab: SKIPPED. No Chromium found (set CHROME_PATH, or install one: npx playwright install chromium). This is not a pass; nothing was measured.');
  process.exit(0);
}

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};
const SHOTS = process.env.PROJECTS_TAB_SHOTS || '';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-projects-tab-'));
let server;
let browser;
const tabs = [];
try {
  const port = await freePort();
  const boot = await bootSeeded('travel', dataDir, port);
  server = boot.server;
  const { ctx, cookies } = boot;
  const cookieOf = (as) => cookies[as].map((c) => `${c.name}=${c.value}`).join('; ');
  const call = async (as, method, url, body) => {
    const r = await fetch(server.base + url, { method, headers: { cookie: cookieOf(as), 'content-type': 'application/json', accept: 'application/json', origin: server.base }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch { /* none */ }
    return { status: r.status, json };
  };
  // The Planner on in the environment, and a space made from the Projects template (which offers it and shows its tab).
  const installed = await call('admin', 'POST', '/api/modules/bundled/schedule/install', {});
  assert.ok(installed.status < 300 || /already installed/.test(JSON.stringify(installed.json)), `the Planner installs (${installed.status})`);
  assert.equal((await call('admin', 'PATCH', '/api/modules/schedule', { enabled: true })).status, 200, 'and is on');
  assert.equal((await call('admin', 'PATCH', '/api/settings', { spaceTemplates: true })).status, 200, 'spaces may have their own template');
  const made = await call('admin', 'POST', '/api/spaces', { name: 'Launch plan', template: 'project', starter: false, members: [ctx.mia, ctx.sam] });
  assert.equal(made.status, 200, `a Projects space (${JSON.stringify(made.json)})`);
  const P = made.json.space.id;
  assert.equal((await call('admin', 'PATCH', `/api/spaces/${P}`, { entry: 'guests' })).status, 200, 'open to guests');
  const link = (await call('admin', 'POST', `/api/spaces/${P}/guest-link`, {})).json.space.guestToken;

  browser = await launch(bin);
  const open = async (url, as, width, mode = 'light') => {
    const tab = new Tab(browser.cdp, ctx);
    await tab.open(width, mode);
    tabs.push(tab);
    if (as) for (const c of cookies[as]) await tab.cdp.send('Network.setCookie', { name: c.name, value: c.value, url: server.base, httpOnly: true }, tab.sid);
    await tab.cdp.send('Page.navigate', { url: server.base + url }, tab.sid);
    return tab;
  };
  const enter = async (space, as, width = 1280, mode = 'light') => {
    const tab = await open(`/#join=${space}`, as, width, mode);
    await tab.waitFor(width > 700 ? '#layout-tabs [data-layout-tab]' : '#canvas');
    await sleep(1500);
    return tab;
  };
  const shot = async (tab, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, name), await tab.shoot(false)); } };
  const bar = (tab) => tab.eval(`[...document.querySelectorAll('#layout-tabs [data-layout-tab]')].map((b) => ({ id: b.dataset.layoutTab, label: b.querySelector('.core-label')?.textContent || '', icon: [...(b.querySelector('i')?.classList || [])].find((c) => c.startsWith('fa-') && c !== 'fa-solid' && c !== 'fa-fw') || '', current: b.getAttribute('aria-current') === 'page' }))`);
  // A docked section is display: contents; its frame (.mf-docked) is the box that is drawn.
  const docked = (tab) => tab.eval(`(() => { const c = document.getElementById('canvas'); const s = [...document.querySelectorAll('#canvas section.module-docked')]; const f = s[0] && s[0].querySelector('.mf-docked'); const cw = c ? c.getBoundingClientRect().width : 0; return { ids: s.map((x) => x.dataset.module), share: f && cw ? f.getBoundingClientRect().width / cw : 0, debug: { cw, fw: f ? Math.round(f.getBoundingClientRect().width) : -1 }, floats: document.querySelectorAll('#canvas .module-float, #canvas [data-module].floating').length }; })()`);

  await test('a Projects space: the tab is second, with the module\'s name and its own icon, 1280', async () => {
    const tab = await enter(P, 'mia');
    const t = await bar(tab);
    assert.deepEqual(t.map((x) => x.id).slice(0, 2), ['workspace', 'schedule'], 'Projects second, as the template lists it');
    const pj = t.find((x) => x.id === 'schedule');
    assert.equal(pj.label, 'Planner - Projects', 'the module\'s own name, as the environment shows it');
    assert.equal(pj.icon, 'fa-diagram-project', 'the module\'s own icon');
    assert.equal(pj.current, false, 'not open yet: the Workspace opens first');
    for (const mode of ['light', 'dark']) {
      await tab.switchMode(mode);
      await sleep(300);
      await shot(tab, `projects-tab-bar-1280-${mode}.png`);
    }
  });

  await test('pressing it opens the Planner large: docked, alone, filling the canvas', async () => {
    const tab = await enter(P, 'mia');
    await tab.click('[data-layout-tab=schedule]');
    await sleep(2500);
    const t = await bar(tab);
    assert.equal(t.find((x) => x.current)?.id, 'schedule', 'the Projects tab is the current one');
    const d = await docked(tab);
    assert.deepEqual(d.ids, ['schedule'], 'the Planner, docked, and nothing else');
    assert.equal(d.floats, 0, 'no floating module');
    assert.ok(d.share > 0.9, `it fills the canvas (${Math.round(d.share * 100)}% of its width; ${JSON.stringify(d.debug)})`);
    const frame = await tab.eval(`Boolean(document.querySelector('#canvas section.module-docked[data-module=schedule] [data-module-frame=schedule] :is(iframe, .module-root, .module-holder)'))`);
    assert.equal(frame, true, 'the module\'s own frame holds it');
    for (const mode of ['light', 'dark']) {
      await tab.switchMode(mode);
      await sleep(600);
      await shot(tab, `projects-tab-open-1280-${mode}.png`);
    }
  });

  await test('a phone (390): no layout tabs (as for every Fixed Workspace); the Planner is one of the module tabs', async () => {
    for (const mode of ['light', 'dark']) {
      const tab = await enter(P, 'mia', 390, mode);
      const layoutTabs = await tab.eval(`[...document.querySelectorAll('#layout-tabs [data-layout-tab]')].filter((b) => b.offsetParent !== null).length`);
      assert.equal(layoutTabs, 0, 'no layout tabs on a phone');
      const sideways = await tab.eval(`document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`);
      assert.equal(sideways, true, 'the page does not scroll sideways');
      await shot(tab, `projects-tab-390-${mode}.png`);
    }
  });

  await test('a space whose template does not offer the Planner (the Travel trip): no Projects tab', async () => {
    const tab = await enter(ctx.trip, 'mia');
    assert.ok(!(await bar(tab)).some((x) => x.id === 'schedule'), 'no tab where the module is off');
  });

  await test('a guest: no Fixed Workspaces, so no Projects tab', async () => {
    const r = await fetch(`${server.base}/api/spaces/${P}/layouts?guest=${encodeURIComponent(link)}`);
    const j = await r.json();
    assert.deepEqual([r.status, j.system], [200, []], 'the server lists none for a guest');
    const tab = await open(`/?guest=${encodeURIComponent(link)}#join=${P}`, null, 1280);
    await sleep(3000);
    assert.ok(!(await bar(tab)).some((x) => x.id === 'schedule'), 'and the page draws none');
  });

  await test('Set up lists it with Show, Move up, Move down and Opens first; Move up moves it, and the save keeps it', async () => {
    const tab = await enter(P, 'admin');
    await tab.click('#setup');
    await tab.waitFor('.setup-tab');
    await sleep(900);
    await tab.click('#setup-tab-modules');
    await sleep(1200);
    const rows = () => tab.eval(`[...document.querySelectorAll('#setup-layout-rows .setup-layout-row')].map((r) => r.dataset.layout)`);
    const before = await rows();
    assert.equal(before[1], 'schedule', `Projects is the second row (${before.join(', ')})`);
    const parts = await tab.eval(`(() => { const r = document.querySelector('#setup-layout-rows [data-layout=schedule]'); return { name: r.querySelector('.setup-layout-name').textContent, icon: Boolean(r.querySelector('.fa-diagram-project')), show: r.querySelector('[data-layout-show]')?.checked, showOff: r.querySelector('[data-layout-show]')?.disabled, up: !r.querySelector('[data-move=up]').disabled, down: !r.querySelector('[data-move=down]').disabled, first: Boolean(r.querySelector('input[name=setup-first-visit][value=schedule]')) }; })()`);
    assert.deepEqual(parts, { name: 'Planner - Projects', icon: true, show: true, showOff: false, up: true, down: true, first: true }, 'a row like the others');
    await tab.click('#setup-layout-rows [data-layout=schedule] [data-move=up]');
    await sleep(400);
    assert.deepEqual((await rows()).slice(0, 2), ['schedule', 'workspace'], 'moved up, to the top');
    await tab.eval(`document.querySelector('#setup-layout-rows [data-layout=schedule] [data-layout-show]').click()`);
    await sleep(300);
    await tab.click('#setup-save');
    await sleep(1500);
    const space = (await call('admin', 'GET', `/api/spaces/${P}`)).json.space;
    assert.equal(space.tabs.order[0], 'schedule', 'the save keeps the order');
    assert.ok(space.tabs.hide.includes('schedule'), 'and the hide');
  });

  await test('the owner\'s hide takes it out of the bar for a member', async () => {
    const tab = await enter(P, 'mia');
    assert.ok(!(await bar(tab)).some((x) => x.id === 'schedule'), 'hidden by the owner: not in the bar');
    assert.equal((await call('admin', 'PATCH', `/api/spaces/${P}`, { tabs: { order: ['workspace', 'schedule'] } })).status, 200, 'shown again');
    const again = await enter(P, 'mia');
    assert.ok((await bar(again)).some((x) => x.id === 'schedule'), 'and back');
  });
} finally {
  for (const t of tabs) await t.close().catch(() => {});
  try { if (browser) { browser.cdp.ws.close(); await stopBrowser(browser.child, browser.dir); } } catch { /* best effort */ }
  await stopServer(server);
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

if (failed) {
  console.error(`check-projects-tab: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-projects-tab: OK (${n} browser tests)`);
