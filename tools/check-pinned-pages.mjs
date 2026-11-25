#!/usr/bin/env node
/*
 * check-pinned-pages.mjs -- Workspaces, the page half (documentation/plans/plan-templates-redesign.md, step 8; decisions 9,
 * 35 and 36), in a real browser against a throwaway seeded server (tools/shots.mjs; no LiveKit):
 *   - Set up's Layout tab shows what the template opens a new person with (its layout, in plain words) as one read-only line with its reason ("This
 *     comes from the <space>'s template."), no switches, for an owner (the admin) and a moderator, at 1280 and 390
 *   - Set up's Tabs in the bar section marks a shown Fixed Workspace as pinned (the Workspace and a hidden one carry no mark)
 *   - a member's tab bar: a pinned tab wears the pin and has the owner's sentence in its title; the page offers no hide for
 *     it (there are no favorites, plan-workspaces.md decision 44), and the server has no route for one (issue #1091)
 *   - a first visit opens the template's Opens first: that layout is the tab shown, with the template's layout behind it
 *   - a phone (390): the line and the Layouts rows keep 44 px targets and the panel does not scroll sideways
 * Run it under the shared browser lock. With no Chromium it says SKIPPED (set CHROME_PATH); that is not a pass.
 *   - (the Layout menu is gone, plan-workspaces.md decision 44: its pinned row with it)
 * PINNED_PAGES_SHOTS=<dir> writes the screenshots it takes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { stopBrowser } from './browser-launch.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { bootSeeded, stopServer, freePort, findBrowser, launch, Tab, sleep } = await import('./shots.mjs');

const bin = findBrowser();
if (!bin) {
  console.log('check-pinned-pages: SKIPPED. No Chromium found (set CHROME_PATH, or install one: npx playwright install chromium). This is not a pass; nothing was measured.');
  process.exit(0);
}

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};
const SHOTS = process.env.PINNED_PAGES_SHOTS || '';

// What the page says, read as code: the pin and the line are drawn from the server's `pinned` and the template's list.
{
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  const setup = fs.readFileSync(path.join(ROOT, 'public/space-setup.js'), 'utf8');
  const nav = fs.readFileSync(path.join(ROOT, 'public/primary-nav.js'), 'utf8');
  assert.match(nav, /s\.pinned === true \? \{ pinned: true \} : \{\}/, 'a system tab carries the server\'s pinned');
  assert.ok(!/layout-tab-pinned/.test(space), 'the tab draws no pin mark');
  assert.match(space, /Kept in the bar by the/, 'a pinned tab still says so in its title');
  assert.ok(!/setFavorite|function systemRowItems/.test(space), 'nothing on the page hides a tab for oneself (no favorites, plan-workspaces.md decision 44)');
  assert.ok(!/opensWith/.test(setup.slice(setup.indexOf('export function setupPatch'), setup.indexOf('// The tabs with unsaved changes'))), 'Save never sends Opens with');
  assert.ok(!/'opensWith'/.test(setup.match(/export const MODERATOR_FIELDS = [^\n]*/)[0]), 'a moderator\'s fields do not list Opens with');
  assert.match(space, /layoutNote\(err\.message \|\| 'That did not work\. Try again\.'\)/, 'a refused attempt shows the server\'s sentence as it is');
  n += 6;
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-pinned-pages-'));
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
  // The trip's template: the owner's own copy whose layout is Calendar and an empty area, shows Calendar and Documents (Documents first in its tab list).
  for (const m of ['calendar', 'documents']) {
    await call('admin', 'POST', `/api/modules/bundled/${m}/install`, {});
    await call('admin', 'PATCH', `/api/modules/${m}`, { enabled: true });
  }
  assert.equal((await call('admin', 'POST', '/api/environment/templates', { from: 'default', id: 'mine', name: 'Mine' })).status, 201, 'a template of its own');
  assert.equal((await call('admin', 'PATCH', '/api/environment/templates/mine', { workspace: { layout: { shape: 'two-equal', areas: ['calendar', null] }, tabs: [{ id: 'documents', show: true }, { id: 'workspace', show: true }, { id: 'calendar', show: true }, { id: 'map', show: false }, { id: 'conference', show: false }, { id: 'whiteboard', show: false }] } })).status, 200, 'its Default Workspace');
  const tpl = await call('admin', 'PATCH', `/api/spaces/${ctx.trip}`, { template: 'mine' });
  assert.equal(tpl.status, 200, `the trip takes it (${JSON.stringify(tpl.json)})`);
  // The seeded trip already has tabs: the template's tab list is its seed for a new space only, so the owner sets the bar here.
  const set = await call('admin', 'PATCH', `/api/spaces/${ctx.trip}`, { tabs: { order: ['workspace', 'calendar', 'documents', 'map', 'conference', 'whiteboard'], hide: ['map', 'conference', 'whiteboard'] }, defaultLayout: 'documents' });
  assert.equal(set.status, 200, `the owner sets the bar (${JSON.stringify(set.json)})`);

  browser = await launch(bin);
  const open = async (url, as, width) => {
    const tab = new Tab(browser.cdp, ctx);
    await tab.open(width, 'light');
    tabs.push(tab);
    for (const c of cookies[as]) await tab.cdp.send('Network.setCookie', { name: c.name, value: c.value, url: server.base, httpOnly: true }, tab.sid);
    await tab.cdp.send('Page.navigate', { url: server.base + url }, tab.sid);
    return tab;
  };
  const inSpace = async (as, width) => {
    const tab = await open(`/#join=${ctx.trip}`, as, width);
    await tab.waitFor('#setup, #module-chooser, .layout-tabs');
    await sleep(1200);
    return tab;
  };
  const shot = async (tab, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, name), await tab.shoot(false)); } };
  // Set up's Layout tab, by its address (at 390 the six tabs fold some into the "...").
  const settingsTab = async (tab) => {
    await tab.cdp.send('Page.navigate', { url: `${server.base}/?setup=${ctx.trip}#layout` }, tab.sid);
    await tab.waitFor('#setup-content-layout:not([hidden]) #setup-layout-rows');
    await sleep(1500);
  };
  const readLine = (tab) => tab.eval(`({ text: document.getElementById('setup-opens-with')?.textContent || '', tag: document.getElementById('setup-opens-with')?.tagName, controls: document.querySelectorAll('#setup-opens-with input, #setup-opens-with button, #setup-opens-with [role=switch]').length, why: document.getElementById('setup-opens-with-hint')?.textContent || '', oldList: Boolean(document.querySelector('.opens-with-list')), noSideways: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 })`);

  for (const [who, label] of [['admin', 'the owner'], ['mia', 'a moderator']]) {
    for (const width of [1280, 390]) {
      await test(`Set up shows the template's layout as a read-only line for ${label} at ${width}`, async () => {
        const tab = await inSpace(who, width);
        await settingsTab(tab);
        const l = await readLine(tab);
        assert.equal(l.tag, 'P', 'a line of text, not a list of switches');
        assert.equal(l.text, 'Calendar and an empty area open side by side, the same width. Each person chooses what goes in the empty area.', 'what the template opens a new person with: its layout in plain words');
        assert.equal(l.controls, 0, 'nothing to switch');
        assert.equal(l.oldList, false, 'no switch list');
        assert.match(l.why, /^This comes from the .+'s template\.$/, 'and why');
        assert.equal(l.noSideways, true, 'the page does not scroll sideways');
        if (width === 1280) { await tab.eval(`document.getElementById('setup-opens-with').scrollIntoView({ block: 'center' })`); await sleep(300); }
        if (width === 1280) await shot(tab, `set-up-first-visit-${who}-1280.png`);
        if (who === 'admin' && width === 390) await shot(tab, 'set-up-first-visit-390.png');
      });
    }
  }

  await test('the Layouts section marks a shown Fixed Workspace as pinned, 1280', async () => {
    const tab = await inSpace('admin', 1280);
    await settingsTab(tab);
    const rows = await tab.eval(`[...document.querySelectorAll('#setup-layout-rows .setup-layout-row')].map((r) => ({ id: r.dataset.layout, pin: Boolean(r.querySelector('[data-pinned]')), shown: r.querySelector('[data-layout-show]').checked, desc: r.querySelector('.setup-layout-show .sdk-choice-desc')?.textContent || '' }))`);
    for (const r of rows) {
      if (r.id === 'workspace') assert.equal(r.pin, false, 'the Workspace is always there: no pin');
      else if (r.shown) { assert.equal(r.pin, true, `${r.id} is shown: pinned`); assert.equal(r.desc, 'Pinned: kept in the bar for everyone.'); }
      else assert.equal(r.pin, false, `${r.id} is hidden: no pin`);
    }
    assert.ok(rows.some((r) => r.pin), 'at least one pinned row');
    // Hiding one takes the pin off at once, in the draft.
    const id = rows.find((r) => r.pin).id;
    await tab.eval(`document.querySelector('#setup-layout-rows [data-layout="${id}"] [data-layout-show]').click()`);
    await sleep(200);
    assert.equal(await tab.eval(`Boolean(document.querySelector('#setup-layout-rows [data-layout="${id}"] [data-pinned]'))`), false, 'turned off: the pin goes');
    await shot(tab, 'set-up-layouts-1280.png');
  });
  await test('the Layouts section at 390: the pin shows, rows keep 44 px targets, nothing scrolls sideways', async () => {
    const tab = await inSpace('admin', 390);
    await settingsTab(tab);
    const m = await tab.eval(`(() => {
      const rows = [...document.querySelectorAll('#setup-layout-rows .setup-layout-row')];
      const small = [...document.querySelectorAll('#setup-layout-rows button, #setup-layout-rows label, #setup-layout-rows input[type=radio]')].filter((e) => e.getClientRects().length && e.getBoundingClientRect().height < 43 && !e.closest('label:not(.setup-layout-show)') && e.tagName !== 'INPUT').map((e) => e.className + ':' + Math.round(e.getBoundingClientRect().height));
      return { pins: rows.filter((r) => r.querySelector('[data-pinned]')).length, small, sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
    })()`);
    assert.ok(m.pins > 0, 'pinned rows are marked');
    assert.deepEqual(m.small, [], 'every button and switch row is 44 px or taller');
    assert.equal(m.sideways, false);
    await tab.eval(`document.getElementById('setup-layout-rows').scrollIntoView()`);
    await sleep(300);
    await shot(tab, 'set-up-layouts-390.png');
  });

  await test('a member: the first visit opens the template\'s layout, the pinned tabs wear the pin, and no route hides one', async () => {
    const tab = await inSpace('sam', 1280);
    const bar = await tab.eval(`(() => ({
      tabs: [...document.querySelectorAll('.layout-tabs > [data-layout-tab]')].map((b) => ({ id: b.dataset.layoutTab, pin: /Kept in the bar/.test(b.title), title: b.title, current: b.getAttribute('aria-current') === 'page' })),
      pinButtons: document.querySelectorAll('.layout-tabs [data-hide], .layout-tabs .layout-tab-hide').length,
    }))()`);
    assert.deepEqual(bar.tabs.map((t) => t.id), ['workspace', 'calendar', 'documents'], 'the owner\'s bar, in the owner\'s order');
    assert.deepEqual(bar.tabs.map((t) => t.pin), [false, true, true], 'Calendar and Documents are pinned; the Workspace is not marked (by title; no pin is drawn)');
    assert.equal(bar.tabs[1].title, 'Calendar. Kept in the bar by the owner.', 'the tab says why it stays');
    assert.equal(bar.pinButtons, 0, 'no hide control on a tab');
    assert.equal(bar.tabs.find((t) => t.current)?.id, 'documents', 'a first visit opens the template\'s layout');
    // The server side of the same rule: there is no route that hides a tab for oneself (issue #1091).
    for (const who of ['sam', 'mia']) assert.equal((await call(who, 'PATCH', `/api/spaces/${ctx.trip}/layouts/system/calendar`, { tab: false })).status, 404, `${who}: no per-person tab route`);
    const fav = await call('sam', 'DELETE', `/api/spaces/${ctx.trip}/layouts/calendar/favorite`);
    assert.equal(fav.status, 404, 'the favorite routes are gone');
    const seen = (await call('sam', 'GET', `/api/spaces/${ctx.trip}/layouts`)).json;
    assert.deepEqual(seen.system.filter((l) => l.pinned).map((l) => l.id).sort(), ['calendar', 'documents', 'workspace']);
    assert.deepEqual(seen.firstVisit, { layout: 'documents', shape: { shape: 'two-equal', areas: ['calendar', null] } }, 'the first visit is the template\'s layout');
    await shot(tab, 'tab-bar-1280.png');
  });
  await test('a member on a phone: the page does not scroll sideways', async () => {
    const tab = await inSpace('sam', 390);
    assert.equal(await tab.eval(`document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`), true);
    await shot(tab, 'member-390.png');
  });
} finally {
  try { for (const t of tabs) await t.close(); } catch { /* best effort */ }
  try { if (browser) { browser.cdp.ws.close(); await stopBrowser(browser.child, browser.dir); } } catch { /* best effort */ }
  if (server) await stopServer(server);
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
if (failed) { console.error(`check-pinned-pages: ${failed} failed`); process.exit(1); }
console.log(`check-pinned-pages: OK (${n} checks)`);
