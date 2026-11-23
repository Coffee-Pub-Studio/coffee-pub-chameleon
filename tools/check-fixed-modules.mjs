#!/usr/bin/env node
/**
 * The Fixed Workspaces' switches in Set up (plan-workspaces.md, decisions 35 and 38): the module settings a Fixed Workspace offers
 * (server/fixed-workspaces.js, answered as `settings` in GET /api/spaces/:id/layouts) are on the Modules tab, under their module's
 * section, whatever workspace is shown; the question is no longer asked per workspace, so there is no "nothing to configure".
 *   - pure helpers (no browser): fixedRows, fixedSwitchReason
 *   - live: the owner finds the To-do switch under To-do on the Modules tab, its change is a draft (the tab's dot) that Save
 *     writes (read back from the server); a moderator sees it disabled with the reason; the panel has no `show` tab and no
 *     canvas menu, in the Workspace or in Calendar
 * With no Chromium it says SKIPPED (set CHROME_PATH); that is not a pass. Run it under the browser lock when machines share.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const { bootSeeded, stopServer, freePort, findBrowser, launch, Tab, sleep } = await import('./shots.mjs');

// --- the Fixed Workspaces' switches: the pure helpers (no browser) ---
{
  const setup = await import('../public/space-setup.js');
  const { fixedRows, fixedSwitchReason } = setup;
  for (const gone of ['fixedWorkspaceOf', 'modulesTabView', 'NOTHING_TO_CONFIGURE', 'FIXED_WORKSPACES']) assert.equal(setup[gone], undefined, `${gone} is gone with the old Modules tab`);
  const todo = { module: 'todo', moduleName: 'To-do', key: 'inCalendar', label: 'Show in the Calendar', type: 'boolean', scope: 'environment', value: true, canChange: true, help: 'Also in the side panel.' };
  const system = [
    { id: 'workspace', name: 'Workspace' },
    { id: 'calendar', name: 'Calendar', settings: [todo] },
    ...['map', 'conference', 'whiteboard', 'documents', 'schedule'].map((id) => ({ id, name: id, settings: [] })),
  ];
  const words = (w) => ({ space: 'trip', environment: 'agency' })[w] || w;
  const rows = fixedRows(system, words);
  assert.equal(rows.length, 1, 'one switch: To-do in the Calendar; the others offer none');
  assert.deepEqual([rows[0].id, rows[0].module, rows[0].moduleName, rows[0].label, rows[0].on, rows[0].disabled, rows[0].scope], ['todo:inCalendar', 'todo', 'To-do', 'Show in the Calendar', true, false, 'environment']);
  assert.deepEqual(rows[0].where, ['Calendar'], 'it says which tab shows it');
  assert.equal(rows[0].note, 'Also in the side panel. It applies to every trip in the agency.', 'an environment setting says how far it reaches');
  const cannot = fixedRows([{ ...system[1], settings: [{ ...todo, canChange: false, value: false }] }])[0];
  assert.deepEqual([cannot.on, cannot.disabled], [false, true], 'a person who may not change it sees it as it is, disabled');
  assert.equal(cannot.note, `Also in the side panel. ${fixedSwitchReason('environment')}`, 'the reason follows the help');
  assert.equal(fixedSwitchReason('environment'), 'Only the owner can change this.');
  assert.equal(fixedSwitchReason('space'), 'Only the owner or the moderator can change this.');
  const twice = fixedRows([{ id: 'calendar', name: 'Calendar', settings: [todo] }, { id: 'map', name: 'Map', settings: [todo] }]);
  assert.equal(twice.length, 1, 'a setting two workspaces offer is one switch');
  assert.deepEqual(twice[0].where, ['Calendar', 'Map']);
  assert.equal(fixedRows([{ id: 'workspace', settings: [todo] }]).length, 0, 'the Workspace is no Fixed Workspace');
  assert.equal(fixedRows([{ id: 'calendar', settings: [{ ...todo, type: 'choice' }, { ...todo, module: 5 }, null] }]).length, 0, 'only boolean settings with a module and a key are drawn');
  assert.equal(fixedRows([{ ...system[1], settings: [{ ...todo, label: '<img src=x onerror=alert(1)>' }] }])[0].label, '<img src=x onerror=alert(1)>', 'text stays text here; the page sets it with textContent');
  assert.deepEqual(fixedRows(null), []);
}

const bin = findBrowser();
if (!bin) {
  console.log('check-fixed-modules: SKIPPED. No Chromium found (set CHROME_PATH, or install one: npx playwright install chromium). This is not a pass; nothing was measured.');
  process.exit(0);
}

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};
const SHOTS = process.env.FIXED_MODULES_SHOTS || '';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-fixed-modules-'));
let server;
let browser;
const tabs = [];
try {
  const port = await freePort();
  const boot = await bootSeeded('travel', dataDir, port);
  server = boot.server;
  const { ctx, cookies } = boot;
  browser = await launch(bin);
  const open = async (url, as, width, mode = 'light') => {
    const tab = new Tab(browser.cdp, ctx);
    await tab.open(width, mode);
    tabs.push(tab);
    for (const c of cookies[as]) await tab.cdp.send('Network.setCookie', { name: c.name, value: c.value, url: server.base, httpOnly: true }, tab.sid);
    await tab.cdp.send('Page.navigate', { url: server.base + url }, tab.sid);
    return tab;
  };
  const inSpace = async (as, width, mode) => {
    const tab = await open(`/#join=${ctx.trip}`, as, width, mode);
    await tab.waitFor('[data-layout-tab="workspace"]'); // the space has loaded (what opens on entering is its template's now, so no module is a sure sign)
    await sleep(600);
    return tab;
  };
  const openSetup = async (tab) => {
    await tab.click('#setup');
    await tab.waitFor('#space-setup .setup-tab');
    await sleep(900);
  };

  // --- the Fixed Workspaces' switches on the Modules tab ---
  const cookieOf = (as) => cookies[as].map((c) => `${c.name}=${c.value}`).join('; ');
  const layoutsAs = async (as) => (await fetch(`${server.base}/api/spaces/${ctx.trip}/layouts`, { headers: { cookie: cookieOf(as) } })).json();
  const pressTab = async (tab, id) => {
    await tab.waitFor(`[data-layout-tab="${id}"]`);
    await tab.click(`[data-layout-tab="${id}"]`);
    await sleep(1200);
  };
  const modulesTab = async (tab) => {
    await tab.click('#setup-tab-modules');
    await tab.waitFor('#setup-fixed-modules [data-fixed]', '', 10000);
    return tab.eval(`(() => {
      const box = document.querySelector('[data-fixed="todo:inCalendar"]');
      const row = box.closest('.sdk-choice-row');
      const block = box.closest('[data-fixed-block]');
      return {
        tabs: [...document.querySelectorAll('#space-setup .setup-tab')].map((b) => b.dataset.tab),
        label: row.querySelector('.sdk-choice-label').textContent,
        note: row.querySelector('.sdk-choice-desc')?.textContent || '',
        where: block.querySelector('.setup-subheading')?.textContent || '',
        under: block.closest('.module-settings-card')?.querySelector('.module-settings-name')?.textContent.trim() || '',
        on: box.checked, disabled: box.disabled,
        canvasMenu: Boolean(document.querySelector('#space-setup .host-menu')),
        empty: /nothing to configure/i.test(document.getElementById('space-setup').textContent),
      };
    })()`);
  };
  for (const where of ['workspace', 'calendar']) {
    await test(`${where}: the owner finds the To-do switch under To-do on the Modules tab; no show tab, no canvas menu, no "nothing to configure"`, async () => {
      const tab = await inSpace('admin', 1280);
      if (where !== 'workspace') await pressTab(tab, where);
      await openSetup(tab);
      const m = await modulesTab(tab);
      assert.ok(!m.tabs.includes('show'), `no show tab: ${m.tabs}`);
      assert.equal(m.label, 'Show in the Calendar');
      assert.equal(m.under, 'To-do', 'under its module\'s section');
      assert.equal(m.where, 'In the Calendar tab');
      assert.equal(m.disabled, false);
      assert.equal(m.canvasMenu, false, 'the personal controls are the Layout menu\'s, not Set up\'s');
      assert.equal(m.empty, false);
    });
  }
  await test('the switch is a draft: the Modules tab\'s dot, then Save writes inCalendar; Cancel would drop it', async () => {
    const tab = await inSpace('admin', 1280);
    await openSetup(tab);
    await modulesTab(tab);
    await tab.eval(`document.querySelector('[data-fixed="todo:inCalendar"]').click()`);
    await sleep(300);
    assert.equal(await tab.eval(`!document.querySelector('#setup-tab-modules .setup-tab-dot').hidden`), true, 'the Modules tab shows unsaved changes');
    assert.equal((await layoutsAs('admin')).system.find((l) => l.id === 'calendar').settings[0].value, true, 'nothing is written before Save');
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, 'fixed-modules-owner.png'), await tab.shoot(false)); }
    await tab.click('#setup-save');
    await sleep(1500);
    assert.equal(await tab.eval(`document.getElementById('space-setup').hidden`), true, 'a full save closes the panel');
    assert.equal((await layoutsAs('admin')).system.find((l) => l.id === 'calendar').settings[0].value, false, 'Save wrote it');
    await openSetup(tab);
    const again = await modulesTab(tab);
    assert.equal(again.on, false, 'drawn as saved');
    await tab.eval(`document.querySelector('[data-fixed="todo:inCalendar"]').click()`); // back on, for the next test
    await tab.click('#setup-save');
    await sleep(1500);
    assert.equal((await layoutsAs('admin')).system.find((l) => l.id === 'calendar').settings[0].value, true);
  });
  await test('a moderator sees the switch disabled, with the reason', async () => {
    const tab = await inSpace('mia', 1280);
    await openSetup(tab);
    const m = await modulesTab(tab);
    assert.deepEqual(m.tabs, ['phases', 'call', 'layout', 'modules'], 'a moderator\'s tabs');
    assert.equal(m.disabled, true);
    assert.ok(m.note.endsWith('Only the owner can change this.'), m.note);
    if (SHOTS) fs.writeFileSync(path.join(SHOTS, 'fixed-modules-moderator.png'), await tab.shoot(false));
  });

} finally {
  for (const t of tabs) await t.close?.().catch(() => {});
  await browser?.close?.().catch(() => {});
  if (server) await stopServer(server);
  fs.rmSync(dataDir, { recursive: true, force: true });
}
console.log(failed ? `check-fixed-modules: ${failed} FAILED, ${n} passed` : `check-fixed-modules: OK (${n} live tests)`);
process.exit(failed ? 1 : 0);
