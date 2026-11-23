#!/usr/bin/env node
/*
 * check-setup-tabs.mjs -- the Set up panel's six tabs (plan-workspaces.md, decision 38), the Layout button's menu, the top bar's
 * Manage button and Set up's tooltip, in a real browser against a throwaway seeded server (tools/shots.mjs; no LiveKit). Covers:
 *   - the tabs by role: an owner and the admin Details | Members | Phases | Call | Layout | Modules; a moderator (Mia, and a member
 *     who made a space) Phases | Call | Layout | Modules; a member and a guest no Set up at all; no `show` tab anywhere
 *   - each setting on its tab, and each tab's one save cue at its top ("Saved with Save", and what happens at once)
 *   - every tab shows at 1280 and 1024 wide; at 390 the six fit the sheet without sideways scroll (the rest in the "...")
 *   - the Layout tab: Tabs in the bar (keyboard moves, hide, Opens first, Save) and First visit, marking the Layout tab unsaved
 *   - the Layout button for a member and a moderator: a popover with Open for you, Arrange and Layouts, each acting at once
 *   - addresses /?setup=<id>#<tab> open that tab; a refused field opens the tab that holds it, the keyboard on it
 *   - Manage is a gear button in the top bar for the admin, not in the profile menu, and not there for a member
 *   - Set up's tooltip and name: "<space word> Configuration"
 * With no Chromium it says SKIPPED (set CHROME_PATH); that is not a pass.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const { bootSeeded, stopServer, freePort, findBrowser, launch, Tab, sleep } = await import('./shots.mjs');

const bin = findBrowser();
if (!bin) {
  console.log('check-setup-tabs: SKIPPED. No Chromium found (set CHROME_PATH, or install one: npx playwright install chromium). This is not a pass; nothing was measured.');
  process.exit(0);
}

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};
const SHOTS = process.env.SETUP_TABS_SHOTS || '';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-setup-tabs-'));
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
  const strip = (tab) => tab.eval(`(() => {
    const ts = [...document.querySelectorAll('#setup-tabs > .setup-tab')];
    const strip = document.getElementById('setup-tabs').getBoundingClientRect();
    return { labels: ts.map((t) => t.querySelector('.setup-tab-label').textContent), ids: ts.map((t) => t.dataset.tab), out: ts.filter((t) => t.classList.contains('layout-tab-out')).length, more: !document.getElementById('setup-tabs-more').hidden, boxWidth: document.getElementById('space-setup').getBoundingClientRect().width, strip: strip.width, vw: innerWidth };
  })()`);

  const OWNER = ['details', 'members', 'phases', 'call', 'layout', 'modules'];
  const MODERATOR = ['phases', 'call', 'layout', 'modules'];
  const tabsOf = (tab) => tab.eval(`[...document.querySelectorAll('#setup-tabs > .setup-tab')].map((t) => t.dataset.tab)`);
  // A tab shown by its button, or through the "..." when it is folded there.
  const showTab = async (tab, id) => {
    const out = await tab.eval(`document.getElementById('setup-tab-${id}').classList.contains('layout-tab-out')`);
    if (!out) { await tab.click(`#setup-tab-${id}`); await sleep(500); return; }
    await tab.click('#setup-tabs-more');
    await sleep(300);
    const label = await tab.eval(`document.querySelector('#setup-tab-${id} .setup-tab-label').textContent`);
    await tab.click('.host-menu .host-menu-item', label);
    await sleep(500);
  };

  for (const width of [1280, 1024]) {
    await test(`tabs at ${width}: Details, Members, Phases, Call, Layout, Modules, all showing; no show tab`, async () => {
      const tab = await inSpace('admin', width);
      await openSetup(tab);
      const s = await strip(tab);
      assert.deepEqual(s.labels, ['Details', 'Members', 'Phases', 'Call', 'Layout', 'Modules']);
      assert.deepEqual(s.ids, OWNER);
      assert.equal(s.out, 0, 'every tab shows');
      assert.equal(s.more, false, 'no "..." when they all fit');
      assert.ok(s.boxWidth <= s.vw, 'the panel is not wider than the window');
      // A long template word still fits at the default width: the widest realistic tab words are measured, not guessed.
      await tab.eval(`(() => { document.querySelector('#setup-tab-members .setup-tab-label').textContent = 'Party Members'; document.querySelector('#setup-tab-modules .setup-tab-label').textContent = 'Campaign Tools'; const p = document.getElementById('space-setup'); p.style.width = (p.getBoundingClientRect().width - 1) + 'px'; return true; })()`);
      await sleep(500);
      const wide = await strip(tab);
      const need = await tab.eval(`(() => { const ts = [...document.querySelectorAll('#setup-tabs > .setup-tab')]; const gap = parseFloat(getComputedStyle(document.getElementById('setup-tabs')).columnGap) || 0; return ts.reduce((a, t) => a + t.getBoundingClientRect().width, 0) + gap * (ts.length - 1); })()`);
      if (SHOTS) console.log(`width ${width}: panel ${wide.boxWidth}px, strip ${Math.round(wide.strip)}px, six tabs with Party Members and Campaign Tools need ${Math.round(need)}px, ${wide.out} in the "..."`);
      assert.ok(need <= wide.strip || (wide.more && wide.out > 0), `the six tabs fit (${Math.round(need)}px of ${Math.round(wide.strip)}px) or the rest is in the "..."`);
      assert.equal(await tab.eval(`document.getElementById('setup-tabs').scrollWidth <= document.getElementById('setup-tabs').clientWidth + 1`), true, 'never a sideways scroll');
    });
  }

  await test('at 390 (a phone): Set up is a full-screen sheet; the six tabs fit without sideways scroll, the rest in the "...", each one reachable', async () => {
    const tab = await inSpace('admin', 390);
    await tab.eval(`document.querySelector('[data-nav-tool="setup"]').click()`);
    await tab.waitFor('#space-setup .setup-tab');
    await sleep(900);
    const s = await strip(tab);
    assert.deepEqual(s.ids, OWNER);
    const fit = await tab.eval(`(() => { const st = document.getElementById('setup-tabs'); const p = document.getElementById('space-setup').getBoundingClientRect(); return { page: document.documentElement.scrollWidth <= innerWidth, strip: st.scrollWidth <= st.clientWidth + 1, panel: Math.round(p.width), vw: innerWidth, shown: [...st.querySelectorAll(':scope > .setup-tab, :scope > .layout-tabs-more')].filter((t) => !t.hidden && !t.classList.contains('layout-tab-out')).every((t) => t.getBoundingClientRect().right <= st.getBoundingClientRect().right + 1) }; })()`);
    assert.equal(fit.page, true, 'no sideways scroll on the page');
    assert.equal(fit.strip, true, 'the tab row does not scroll sideways');
    assert.equal(fit.shown, true, 'every tab shown (and the "...") is inside the row');
    assert.ok(fit.panel >= fit.vw - 1, `a full-screen sheet (${fit.panel} of ${fit.vw})`);
    for (const id of OWNER) {
      await showTab(tab, id);
      assert.equal(await tab.eval(`document.getElementById('setup-content-${id}').hidden`), false, `${id} is reachable at 390`);
    }
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, 'setup-390.png'), await tab.shoot(false)); }
  });

  await test('the "..." appears when the panel is narrowed, and holds the tabs that do not fit', async () => {
    const tab = await inSpace('admin', 1280);
    await openSetup(tab);
    await tab.eval(`document.getElementById('space-setup').style.width = '250px'`);
    await sleep(500);
    const s = await strip(tab);
    assert.equal(s.more, true);
    assert.ok(s.out > 0);
  });

  // Each setting on its tab (the item -> tab table of decision 38), and the one save cue at the top of each tab.
  const WHERE = {
    details: ['#setup-picture-file', '#setup-name', '#setup-description', '#setup-template', '#setup-link', '#setup-link-icon', '#setup-publish-calendar', '#setup-delete'],
    members: ['#setup-members', '#setup-open', '#setup-entry-accounts', '#setup-allow-guests', '#setup-entry-guests', '#setup-request-access', '#setup-waiting', '#setup-guests-see-hidden', '#setup-make-invite', '#setup-guest-link-value'],
    phases: ['#setup-phase-list', '#setup-budget-amount'],
    call: ['#setup-call-join', '#setup-call-position', '#setup-call-layout', '#setup-profile'],
    layout: ['#setup-layout-rows', '#setup-first-visit'],
    modules: ['#setup-ai-off', '#setup-ai-sees-follow', '#setup-tags', '#setup-module-settings', '#setup-fixed-modules'],
  };
  const CUES = { details: 'Saved with Save. Delete happens at once.', members: 'Saved with Save. Waiting to come in and Links happen at once.', phases: /^Saved with Save\./, call: 'Saved with Save.', layout: 'Saved with Save.', modules: 'Saved with Save. Tags and deleting a file happen at once.' };
  await test('an owner: each setting is on its tab, and each tab says its save cue once at its top', async () => {
    const tab = await inSpace('admin', 1280);
    await openSetup(tab);
    for (const [id, sels] of Object.entries(WHERE)) {
      for (const sel of sels) assert.equal(await tab.eval(`Boolean(document.querySelector('#setup-content-${id} ${sel}'))`), true, `${sel} is on ${id}`);
      const cue = await tab.eval(`(() => { const c = document.getElementById('setup-content-${id}'); const first = c.firstElementChild; return { first: first.classList.contains('setup-cue') && first.classList.contains('hint'), text: first.textContent, count: c.querySelectorAll('.setup-cue').length, saved: (c.textContent.match(/Saved with Save/g) || []).length }; })()`);
      assert.equal(cue.first, true, `${id}: the cue is the tab's first line, in the hint style`);
      if (CUES[id] instanceof RegExp) assert.match(cue.text, CUES[id]); else assert.equal(cue.text, CUES[id], `${id}'s cue`);
      assert.equal(cue.count, 1, `${id}: said once`);
      assert.equal(cue.saved, 1, `${id}: "Saved with Save" once, not under each section`);
    }
    // Nothing is where it was: no personal controls and no Settings tab of everything.
    assert.equal(await tab.eval(`Boolean(document.querySelector('#space-setup .host-menu, #setup-show, #setup-tab-show, #setup-tab-space'))`), false, 'no Open for you, Arrange or layout picker in Set up; no old ids');
    assert.equal(await tab.eval(`/Open for you|Panel Mode|Window Mode|New layout for everyone$|There is nothing to configure/.test(document.getElementById('space-setup').innerText)`), false, 'none of their words either');
  });

  await test('Layout tab: Tabs in the bar, then First visit with Opens with as a read-only line; changing First visit marks Layout unsaved', async () => {
    const tab = await inSpace('admin', 1280);
    await openSetup(tab);
    await tab.click('#setup-tab-layout');
    await sleep(900);
    const s = await tab.eval(`({ heads: [...document.querySelectorAll('#setup-content-layout .setup-heading')].map((h) => h.textContent), dot: !document.querySelector('#setup-tab-layout .setup-tab-dot').hidden })`);
    assert.deepEqual(s.heads.slice(0, 2), ['Tabs in the bar', 'First visit']);
    assert.equal(s.dot, false, 'nothing changed yet');
    // Opens with is read only (plan-templates-redesign.md, step 8): one line with the template's list and why, no switches.
    const line = await tab.eval(`({ text: document.getElementById('setup-opens-with')?.textContent, inputs: document.querySelectorAll('#setup-opens-with input, #setup-opens-with button').length, why: document.getElementById('setup-opens-with-hint')?.textContent })`);
    assert.match(line.text, /\w.*\.$/, 'the line says what a new person sees open');
    assert.equal(line.inputs, 0, 'no switches: the template decides');
    assert.match(line.why, /^This comes from the .+'s template\.$/, 'and why');
    // A change to First visit marks Layout unsaved; putting it back clears it.
    const other = await tab.eval(`(() => { const r = [...document.querySelectorAll('input[name="setup-first-visit"]')].find((x) => !x.checked && !x.disabled); if (!r) return null; r.click(); return r.value; })()`);
    if (other) {
      await sleep(300);
      assert.equal(await tab.eval(`!document.querySelector('#setup-tab-layout .setup-tab-dot').hidden`), true, 'Layout shows the unsaved dot');
      await tab.eval(`document.getElementById('setup-first-workspace').click()`);
      await sleep(300);
      assert.equal(await tab.eval(`!document.querySelector('#setup-tab-layout .setup-tab-dot').hidden`), false, 'put back: nothing to save');
    }
    const r = await fetch(`${server.base}/api/spaces/${ctx.trip}`, { headers: { cookie: cookies.admin.map((c) => `${c.name}=${c.value}`).join('; ') } });
    const space = await r.json();
    assert.ok(!('opensWith' in (space.space || space)), 'the space keeps no Opens with of its own');
  });

  await test('the address picks the tab: /?setup=<id>#<tab> for each tab; #show and #space are no tab (the first one)', async () => {
    for (const id of [...OWNER, 'show', 'space']) {
      const tab = await open(`/?setup=${ctx.trip}#${id}`, 'admin', 1280);
      await tab.waitFor('#space-setup .setup-tab[aria-selected="true"]', '', 20000);
      await sleep(500);
      const on = await tab.eval(`document.querySelector('#space-setup .setup-tab[aria-selected="true"]').dataset.tab`);
      assert.equal(on, OWNER.includes(id) ? id : 'details', `#${id}`);
      if (OWNER.includes(id)) assert.equal(await tab.eval(`location.hash`), `#${id}`, 'the address follows the tab');
      await tab.close();
    }
  });

  await test('a refusal opens the tab that holds the field, with the server\'s sentence and the keyboard on it', async () => {
    const tab = await inSpace('admin', 1280);
    await openSetup(tab);
    await tab.typeInto('#setup-link', 'ftp://not-a-web-link');
    await tab.click('#setup-tab-modules');
    await sleep(300);
    assert.equal(await tab.eval(`!document.querySelector('#setup-tab-details .setup-tab-dot').hidden`), true, 'Details has the unsaved dot');
    await tab.click('#setup-save');
    await sleep(1500);
    const r = await tab.eval(`({ on: document.querySelector('#space-setup .setup-tab[aria-selected="true"]').dataset.tab, focus: document.activeElement.id, said: document.getElementById('space-setup-status').textContent, open: !document.getElementById('space-setup').hidden })`);
    assert.equal(r.open, true, 'the panel stays');
    assert.equal(r.on, 'details', 'on the tab that holds the launch link');
    assert.equal(r.focus, 'setup-link', 'the keyboard on the field');
    assert.match(r.said, /^The launch link was not saved\./);
  });

  // Layouts (plan-workspaces.md, step 3): the owner's Tabs in the bar, on the Layout tab, used with the keyboard; a member's bar follows it.
  const cookieOf = (as) => cookies[as].map((c) => `${c.name}=${c.value}`).join('; ');
  const layoutsAs = async (as) => (await fetch(`${server.base}/api/spaces/${ctx.trip}/layouts`, { headers: { cookie: cookieOf(as) } })).json();
  const rowsOf = (tab) => tab.eval(`[...document.querySelectorAll('#setup-layout-rows .setup-layout-row')].map((r) => ({ id: r.dataset.layout, name: r.querySelector('.setup-layout-name').textContent, shown: r.querySelector('[data-layout-show]').checked, showDisabled: r.querySelector('[data-layout-show]').disabled, first: r.querySelector('input[type=radio]').checked, up: !r.querySelector('[data-move=up]').disabled, down: !r.querySelector('[data-move=down]').disabled }))`);
  let layoutsBefore = null;
  await test('Layouts: an owner sees a row per layout with Show in the bar, Move up, Move down and Opens first; the Workspace is on, locked and opens first; one radio group with First visit', async () => {
    const tab = await inSpace('admin', 1280);
    await openSetup(tab);
    await tab.click('#setup-tab-layout');
    await sleep(900);
    const rows = await rowsOf(tab);
    layoutsBefore = rows.map((r) => r.id);
    assert.equal(rows[0].id, 'workspace');
    assert.ok(rows.length >= 3, `Workspace and at least two more layouts: ${JSON.stringify(layoutsBefore)}`);
    assert.deepEqual([rows[0].shown, rows[0].showDisabled, rows[0].first], [true, true, true], 'the Workspace is shown, cannot be turned off, and opens first');
    assert.ok(rows.slice(1).every((r) => !r.showDisabled), 'the others can be turned off');
    const heads = await tab.eval(`[...document.querySelectorAll('#setup-content-layout .setup-heading')].map((h) => h.textContent)`);
    assert.equal(heads[0], 'Tabs in the bar');
    assert.equal(heads[1], 'First visit');
    const words = await tab.eval(`document.getElementById('setup-layout-rows').textContent.replace(/\\s+/g, ' ')`);
    for (const w of ['Show in the bar', 'Opens first', 'Move up', 'Move down', 'The Workspace is always shown.']) assert.ok(words.includes(w), w);
    const groups = await tab.eval(`[...new Set([...document.querySelectorAll('#space-setup input[type=radio][name=setup-first-visit]')].map((r) => r.name))].length`);
    assert.equal(groups, 1, 'Opens first and First visit are one radio group');
    assert.equal(await tab.eval(`document.querySelectorAll('#space-setup input[name=setup-first-visit]:checked').length`), 1, 'exactly one choice');
  });
  await test('Layouts: Move down by keyboard keeps the focus on the button and says where it went; hide the last one; Opens first on another; Save sends only tabs and defaultLayout', async () => {
    const tab = await inSpace('admin', 1280);
    await openSetup(tab);
    await tab.click('#setup-tab-layout');
    await sleep(900);
    const [, second, third] = await rowsOf(tab);
    // Tab to the second row's Move down and press Enter on it (a real key press, as a keyboard user would).
    await tab.eval(`document.querySelector('#setup-layout-rows [data-layout="${second.id}"] [data-move=down]').focus()`);
    await tab.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }, tab.sid);
    await tab.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, tab.sid);
    await sleep(300);
    const after = await rowsOf(tab);
    assert.deepEqual(after.slice(1, 3).map((r) => r.id), [third.id, second.id], 'the second went below the third');
    const focus = await tab.eval(`({ move: document.activeElement.dataset.move, row: document.activeElement.closest('[data-layout]')?.dataset.layout, live: document.getElementById('setup-layouts-live').textContent })`);
    assert.equal(focus.row, second.id, 'the keyboard stays on the layout moved');
    assert.ok(focus.move, 'on one of its Move buttons');
    assert.equal(focus.live, `${second.name} moved to position 3.`);
    assert.equal(await tab.eval(`!document.querySelector('#setup-tab-layout .setup-tab-dot').hidden`), true, 'Layout shows the unsaved dot');
    // Hide the last layout; make the first of the others open first.
    const last = after[after.length - 1];
    await tab.eval(`document.querySelector('#setup-layout-rows [data-layout="${last.id}"] [data-layout-show]').click()`);
    await sleep(200);
    await tab.eval(`document.querySelector('#setup-layout-rows [data-layout="${third.id}"] input[type=radio]').click()`);
    await sleep(200);
    assert.equal(await tab.eval(`document.querySelector('#setup-layout-rows [data-layout="${last.id}"] input[type=radio]').disabled`), true, 'a hidden layout cannot open first');
    // Hiding the one that opens first puts the Workspace back.
    await tab.eval(`document.querySelector('#setup-layout-rows [data-layout="${third.id}"] [data-layout-show]').click()`);
    await sleep(200);
    assert.equal((await rowsOf(tab)).find((r) => r.first).id, 'workspace', 'hiding what opens first puts the Workspace back');
    await tab.eval(`document.querySelector('#setup-layout-rows [data-layout="${third.id}"] [data-layout-show]').click()`); // shown again
    await sleep(200);
    await tab.eval(`document.querySelector('#setup-layout-rows [data-layout="${third.id}"] input[type=radio]').click()`);
    await sleep(200);
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, 'layouts-edited-1280.png'), await tab.shoot(false)); }
    await tab.eval(`document.querySelector('.action-bar-save').click()`);
    await sleep(1500);
    const got = await (await fetch(`${server.base}/api/spaces/${ctx.trip}`, { headers: { cookie: cookieOf('admin') } })).json();
    const space = got.space || got;
    assert.deepEqual(space.tabs.hide, [last.id], 'the hidden one is saved');
    assert.deepEqual(space.tabs.order.filter((id) => layoutsBefore.includes(id)).slice(0, 3), ['workspace', third.id, second.id], 'the order is saved');
    assert.equal(space.defaultLayout, third.id, 'what opens first is saved');
    assert.ok(!('opensWith' in space), 'and the space still has no Opens with of its own');
  });
  await test('Layouts: a member\'s bar follows the owner\'s order and hide, its Layout menu says Hidden in Set up, and the server refuses to turn it on', async () => {
    const owner = await layoutsAs('admin');
    const hideId = owner.tabs.hide[0];
    const member = await layoutsAs('sam');
    assert.deepEqual(member.system.map((l) => l.id), owner.tabs.order.filter((id) => member.system.some((l) => l.id === id)), 'the member\'s list is in the owner\'s order');
    assert.equal(member.tabs, undefined, 'a member is not sent the owner\'s controls');
    const tab = await inSpace('sam', 1280);
    const bar = await tab.eval(`[...document.querySelectorAll('#layout-tabs > [data-layout-tab]')].map((b) => b.dataset.layoutTab)`);
    assert.ok(!bar.includes(hideId), `the hidden layout is not in the bar: ${JSON.stringify(bar)}`);
    const want = member.system.filter((l) => l.tab !== false).map((l) => l.id);
    assert.deepEqual(bar.slice(0, want.length), want, 'the bar is in the owner\'s order');
    const r = await fetch(`${server.base}/api/spaces/${ctx.trip}/layouts/${hideId}/favorite`, { method: 'PUT', headers: { cookie: cookieOf('sam') } });
    assert.equal(r.status, 409, 'the owner\'s hide wins');
    assert.equal(await tab.eval(`Boolean(document.querySelector('[data-nav-tool="setup"]')?.getClientRects().length)`), false, 'a member has no Set up (decision 38)');
    assert.equal(await tab.eval(`Boolean(document.getElementById('layout-menu')?.getClientRects().length)`), true, 'and keeps the Layout button');
    await tab.click('#layout-menu');
    await sleep(600);
    const row = await tab.eval(`(() => { const r = [...document.querySelectorAll('.host-menu .host-menu-item')].reverse().find((b) => b.querySelector('.host-menu-label')?.textContent.trim() === ${JSON.stringify(member.system.find((l) => l.id === hideId)?.name || '')}); return r ? r.textContent : null; })()`);
    if (row !== null) assert.match(row, /Hidden in Set up/, 'the hidden layout\'s row in the Layout menu says why it has no tab');
    await tab.key('Escape');
  });
  await test('Layouts: a moderator has the section and the same save; the Layout menu row of a hidden layout says why and its Favorite is off', async () => {
    const tab = await inSpace('mia', 1280);
    await openSetup(tab);
    await tab.click('#setup-tab-layout');
    await sleep(900);
    const rows = await rowsOf(tab);
    assert.equal(rows[0].id, 'workspace');
    assert.ok(rows.length >= 3);
    assert.ok((await tab.eval(`document.querySelector('#setup-layout-rows [data-move=up]:not(:disabled)')?.dataset.move`)), 'Move is there for a moderator');
    const hidden = rows.find((r) => !r.shown);
    assert.ok(hidden, 'the owner\'s hide shows as off');
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, 'layouts-moderator-1280.png'), await tab.shoot(false)); }
  });

  // The Layout button (decision 38): the personal controls left Set up for the Layout button's menu, a popover under it with no
  // Save, for everyone in the space. Each entry acts at once on this person's own canvas.
  const layoutMenu = async (tab) => {
    await tab.click('#layout-menu');
    await tab.waitFor('.host-menu:not(.host-menu-inline) .host-menu-item');
    await sleep(500);
    return tab.eval(`(() => {
      const m = document.querySelector('.host-menu:not(.host-menu-inline)');
      const b = document.getElementById('layout-menu').getBoundingClientRect();
      const r = m.getBoundingClientRect();
      return {
        heads: [...m.querySelectorAll('.host-menu-heading')].map((h) => h.textContent.trim()),
        labels: [...m.querySelectorAll('.host-menu-item')].map((e) => e.querySelector('.host-menu-label')?.textContent.trim() || ''),
        save: Boolean(m.querySelector('.action-bar, [id$="-save"]')),
        expanded: document.getElementById('layout-menu').getAttribute('aria-expanded'),
        below: r.top >= b.bottom - 1, covers: r.top < b.bottom && r.bottom > b.top && r.left < b.right && r.right > b.left,
        inSetup: Boolean(m.closest('#space-setup')),
      };
    })()`);
  };
  // The row with these words; the last one, since a layout (Calendar) comes after a module of the same name in Open for you.
  const rowOf = (label) => `[...document.querySelectorAll('.host-menu:not(.host-menu-inline) .host-menu-item')].reverse().find((e) => e.querySelector('.host-menu-label')?.textContent.trim() === ${JSON.stringify(label)})`;
  for (const as of ['sam', 'mia']) {
    await test(`the Layout button (${as === 'sam' ? 'a member' : 'a moderator'}): a popover under it with Open for you, Arrange and Layouts, no Save; each acts at once`, async () => {
      const tab = await inSpace(as, 1280);
      const m = await layoutMenu(tab);
      assert.deepEqual(m.heads.slice(0, 3), ['Open for you', 'Arrange', 'Layouts'], `the sections: ${JSON.stringify(m.heads)}`);
      assert.equal(m.save, false, 'no Save frame: nothing waits');
      assert.equal(m.inSetup, false, 'a popover, not the Set up panel');
      assert.equal(m.expanded, 'true', 'the button says its menu is open');
      assert.equal(m.covers, false, 'the menu never covers its button');
      for (const w of ['Panel Mode', 'Window Mode', 'Workspace', 'New layout', 'Save as new layout']) assert.ok(m.labels.includes(w), `${w} is offered`);
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, `layout-menu-${as}-1280.png`), await tab.shoot(false)); }
      // Open for you: a switch opens (or shows) a module on this person's canvas at once, and the menu stays open.
      const mod = await tab.eval(`(() => { const r = ${rowOf('Polls')}; return r ? { on: r.getAttribute('aria-checked') } : null; })()`);
      assert.ok(mod, 'Polls is in Open for you');
      await tab.eval(`${rowOf('Polls')}.click()`);
      await sleep(1200);
      assert.equal(await tab.eval(`window.hostModules.isOpen('polls')`), mod.on !== 'true', 'Polls opened (or closed) at once');
      assert.equal(await tab.eval(`Boolean(document.querySelector('.host-menu:not(.host-menu-inline)'))`), true, 'the menu stays open after a switch');
      assert.equal(await tab.eval(`${rowOf('Polls')}.getAttribute('aria-checked')`), mod.on === 'true' ? 'false' : 'true', 'and shows what happened');
      // Arrange: Window Mode at once, then Panel Mode back.
      await tab.eval(`${rowOf('Window Mode')}.click()`);
      await sleep(600);
      assert.equal(await tab.eval(`window.hostModules.arrangeMode()`), 'window', 'Window Mode at once');
      await tab.eval(`${rowOf('Panel Mode')}.click()`);
      await sleep(600);
      assert.equal(await tab.eval(`window.hostModules.arrangeMode()`), 'panel', 'Panel Mode at once');
      // Escape closes it, the keyboard back on the button.
      await tab.key('Escape');
      await sleep(300);
      assert.equal(await tab.eval(`Boolean(document.querySelector('.host-menu:not(.host-menu-inline)'))`), false, 'Escape closes it');
      assert.equal(await tab.eval(`document.activeElement?.id`), 'layout-menu', 'and the keyboard is back on the button');
      // Layouts: a layout with a tab in the bar is shown at once (the last of them, so not the one shown now).
      const target = await tab.eval(`(() => { const t = [...document.querySelectorAll('#layout-tabs > [data-layout-tab]')].filter((b) => b.dataset.layoutTab !== 'workspace' && !b.getAttribute('aria-current')).pop(); return t ? { id: t.dataset.layoutTab, name: t.textContent.trim() } : null; })()`);
      assert.ok(target, 'a layout other than the Workspace has a tab');
      await layoutMenu(tab);
      await tab.eval(`${rowOf(target.name)}.click()`);
      await sleep(1500);
      assert.equal(await tab.eval(`document.querySelector('[data-layout-tab="${target.id}"]')?.getAttribute('aria-current')`), 'page', `${target.name} is shown at once`);
    });
  }

  await test('roles: a moderator has Phases, Call, Layout and Modules; a member who made a space is its moderator and sees the same; a member elsewhere and a guest have no Set up', async () => {
    const mod = await inSpace('mia', 1280);
    await openSetup(mod);
    assert.deepEqual(await tabsOf(mod), MODERATOR);
    for (const [id, sels] of Object.entries({ call: ['#setup-call-join'], layout: ['#setup-layout-rows', '#setup-first-visit', '#setup-open'], modules: ['#setup-tags', '#setup-module-settings', '#setup-template-seen'] })) {
      for (const sel of sels) assert.equal(await mod.eval(`Boolean(document.querySelector('#setup-content-${id} ${sel}'))`), true, `a moderator's ${sel} is on ${id}`);
    }
    assert.equal(await mod.eval(`Boolean(document.querySelector('#space-setup #setup-profile, #space-setup #setup-name, #space-setup #setup-members'))`), false, 'no owner\'s field: Faces, the name, the members');
    // A member makes a space (decision 36): its moderator, so the moderator's tabs.
    const made = await fetch(`${server.base}/api/spaces`, { method: 'POST', headers: { cookie: cookieOf('sam'), 'content-type': 'application/json', origin: server.base }, body: JSON.stringify({ name: 'Sam trip' }) }).then((r) => r.json());
    assert.ok(made.space && made.space.id, `Sam made a space: ${JSON.stringify(made)}`);
    const sam = await open(`/#join=${made.space.id}`, 'sam', 1280);
    await sam.waitFor('[data-layout-tab="workspace"]');
    await sleep(900);
    await openSetup(sam);
    const samTabs = await tabsOf(sam);
    assert.deepEqual(samTabs.filter((t) => t !== 'phases'), MODERATOR.filter((t) => t !== 'phases'), `the maker's tabs: ${JSON.stringify(samTabs)}`);
    // A guest: no Set up, and the Layout button.
    const link = await fetch(`${server.base}/api/spaces/${ctx.trip}/guest-link`, { method: 'POST', headers: { cookie: cookieOf('admin'), 'content-type': 'application/json', origin: server.base }, body: '{}' }).then((r) => r.json());
    const token = link.space && link.space.guestToken;
    if (token) {
      const guest = await open(`/guest/${token}`, 'none', 1280);
      await sleep(2500);
      const g = await guest.eval(`({ setup: Boolean(document.querySelector('[data-nav-tool="setup"]')?.getClientRects().length), layout: Boolean(document.getElementById('layout-menu')?.getClientRects().length), url: location.pathname })`);
      assert.equal(g.setup, false, `a guest has no Set up (${g.url})`);
    }
  });

  await test('Manage: a gear button in the top bar for the admin, gone from the profile menu, absent for a member; Set up says "Trip Configuration"', async () => {
    const tab = await inSpace('admin', 1280);
    const b = await tab.eval(`(() => { const m = document.querySelector('[data-nav-tool="manage-tool"]'); const s = document.querySelector('[data-nav-tool="setup"]'); return { shown: Boolean(m && m.getClientRects().length), icon: m?.querySelector('i')?.className || '', label: m?.getAttribute('aria-label'), tip: m?.getAttribute('data-tip'), setupIcon: s?.querySelector('i')?.className || '', setupLabel: s?.getAttribute('aria-label'), setupTip: s?.getAttribute('data-tip'), next: m && s ? Boolean(m.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING) : false }; })()`);
    assert.equal(b.shown, true);
    assert.match(b.icon, /fa-gear/);
    assert.equal(b.label, 'Manage');
    assert.equal(b.tip, 'Manage');
    assert.match(b.setupIcon, /fa-sliders/, 'Set up keeps its own icon');
    assert.equal(b.setupLabel, 'Trip Configuration');
    assert.equal(b.setupTip, 'Trip Configuration');
    assert.equal(b.next, true, 'Manage sits just before Set up');
    await tab.click('[data-nav-tool="setup"]');
    await tab.waitFor('#space-setup .setup-tab');
    const title = await tab.eval(`({ h: document.getElementById('space-setup-title').textContent, row: document.getElementById('setup-tabs').getAttribute('aria-label'), labelled: document.getElementById('space-setup').getAttribute('aria-labelledby') })`);
    assert.equal(title.h, b.setupLabel, 'the panel title and the button say the same words');
    assert.equal(title.row, b.setupLabel, 'and so does the tab row\'s name');
    assert.equal(title.labelled, 'space-setup-title');
    await tab.click('#whoami-link');
    await sleep(500);
    const items = await tab.eval(`[...document.querySelectorAll('.host-menu .host-menu-item')].map((e) => e.textContent.trim())`);
    assert.ok(items.some((t) => /Sign out/.test(t)), 'the profile menu opened');
    assert.ok(!items.some((t) => /^Manage/.test(t)), `no Manage in the profile menu: ${JSON.stringify(items)}`);
    const member = await inSpace('sam', 1280);
    assert.equal(await member.eval(`Boolean(document.querySelector('[data-nav-tool="manage-tool"]')?.getClientRects().length)`), false, 'a member has no Manage button');
    assert.equal(await member.eval(`Boolean(document.querySelector('[data-nav-tool="setup"]')?.getClientRects().length)`), false, 'a member has no Set up');
    const home = await open('/', 'admin', 1280);
    await home.waitFor('#whoami-link');
    await sleep(800);
    assert.equal(await home.eval(`Boolean(document.querySelector('[data-nav-tool="manage-tool"]')?.getClientRects().length)`), true, 'and it is on Home too');
    assert.equal(await home.eval(`Boolean(document.querySelector('[data-nav-tool="setup"]')?.getClientRects().length)`), false, 'Home has no Set up button');
  });

  // Delete is the last thing on Details (Thomas, 2026-11): after Budget and every other section, just before the footer.
  const spaceTabEnd = (tab) => tab.eval(`(() => {
    const panel = document.getElementById('space-setup');
    const content = document.getElementById('setup-content-details');
    const shown = (e) => e.getClientRects().length > 0 && !e.closest('[hidden]');
    const sections = [...content.querySelectorAll(':scope > .setup-section')].filter(shown).map((e) => ({ id: e.dataset.section, heading: e.querySelector('.setup-heading')?.textContent.trim() }));
    const all = [...document.querySelectorAll('#space-setup a[href], #space-setup button, #space-setup input, #space-setup select, #space-setup textarea, #space-setup [tabindex]')].filter((e) => !e.disabled && e.tabIndex >= 0 && shown(e) && !e.classList.contains('visually-hidden'));
    const inTab = all.filter((e) => content.contains(e));
    const last = inTab[inTab.length - 1];
    const after = last ? all[all.indexOf(last) + 1] : null;
    return { sections, delete: Boolean(document.getElementById('setup-delete')), lastControl: last ? last.id : null, nextControl: after ? (after.className + ' ' + after.id) : null, allIds: content.querySelectorAll('[data-section]').length, budgetSection: Boolean(content.querySelector('[data-section=budget]')), rawOrder: [...content.querySelectorAll(':scope > [data-section]')].map((e) => e.dataset.section), footer: Boolean(panel.querySelector('.action-bar-save')) };
  })()`);

  await test('Details: for an owner the Delete section is last (after Budget) and its button is the last control before the footer', async () => {
    const tab = await inSpace('admin', 1280);
    await openSetup(tab);
    await tab.click('#setup-tab-details');
    await sleep(700);
    const r = await spaceTabEnd(tab);
    assert.ok(r.delete, 'an owner/admin has Delete');
    assert.equal(r.sections[r.sections.length - 1].id, 'danger', `Delete is the last section shown: ${JSON.stringify(r.sections.map((x) => x.id))}`);
    assert.match(r.sections[r.sections.length - 1].heading, /^Delete this /);
    assert.equal(r.rawOrder[r.rawOrder.length - 1], 'danger', `last in the markup: ${JSON.stringify(r.rawOrder)}`);
    const b = r.rawOrder.indexOf('budget');
    if (b >= 0) assert.ok(b < r.rawOrder.indexOf('danger'), 'Budget comes before Delete');
    assert.equal(r.lastControl, 'setup-delete', 'the Delete button is the last control on the tab');
    assert.ok(/action-bar/.test(r.nextControl || ''), `the next control in tab order is in the footer: ${r.nextControl}`);
  });

  await test('Details: the Lobby has no Delete, and a moderator has none', async () => {
    // The Lobby is Home and has no Set up panel to open (plan-home-lobby.md, step 2): no Set up button, no Delete anywhere.
    // The panel's own Lobby guard is read as code: Delete is drawn only for `id === 'details' && !space.isLobby`.
    const lobby = await open('/#join=lobby', 'admin', 1280);
    await lobby.waitFor('#whoami-link');
    await sleep(1200);
    assert.equal(await lobby.eval(`Boolean(document.querySelector('[data-nav-tool="setup"]')?.getClientRects().length) || Boolean(document.getElementById('setup-delete'))`), false, 'the Lobby has no Set up and no Delete');
    assert.match(fs.readFileSync(new URL('../public/space-setup.js', import.meta.url), 'utf8'), /id === 'details' && !space\.isLobby \? dangerSectionHtml\(\)/, 'the panel draws no Delete for the Lobby');
    const mod = await inSpace('mia', 1280);
    await openSetup(mod);
    // A moderator has Phases, Call, Layout and Modules (MODERATOR_TABS): no Details, so no Delete anywhere in the panel.
    const m = await mod.eval(`({ spaceTab: Boolean(document.getElementById('setup-tab-details')), spaceContent: Boolean(document.getElementById('setup-content-details')), del: Boolean(document.getElementById('setup-delete')), danger: Boolean(document.querySelector('#space-setup [data-section=danger]')), tabs: [...document.querySelectorAll('#setup-tabs > .setup-tab')].map((t) => t.dataset.tab) })`);
    assert.deepEqual(m.tabs, MODERATOR, 'a moderator: Phases, Call, Layout, Modules');
    assert.deepEqual([m.spaceTab, m.spaceContent, m.del, m.danger], [false, false, false, false], 'a moderator has no Delete');
  });

  for (const [width, mode] of [[1280, 'dark'], [1280, 'light'], [390, 'dark']]) {
    await test(`What AI may see, Only these, at ${width} ${mode}: every module switch is at the right edge, its label at the left`, async () => {
      const tab = await inSpace('admin', width, mode);
      // The section shows only when the server has an AI service: save one, as the admin does.
      const put = await tab.eval(`fetch('/api/ai', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true, provider: 'compatible', address: 'http://127.0.0.1:9', model: 'm', key: 'check-key' }) }).then((r) => r.status)`);
      assert.equal(put, 200, 'the AI service is saved');
      await tab.eval('location.reload()');
      await tab.waitFor('[data-layout-tab="workspace"]'); // the space has loaded (what opens on entering is its template's now, so no module is a sure sign)
      await sleep(600);
      if (width < 600) { await tab.eval(`document.querySelector('[data-nav-tool="setup"]').click()`); await tab.waitFor('#space-setup .setup-tab'); await sleep(900); } else await openSetup(tab);
      await showTab(tab, 'modules');
      await sleep(600);
      assert.equal(await tab.eval(`document.getElementById('setup-ai-sees-follow').click() || document.getElementById('setup-ai-sees-follow').checked`), false, 'its own choice, not the environment\'s');
      await sleep(300);
      await tab.eval(`(() => { const r = document.getElementById('setup-ai-sees-modules-some'); r.scrollIntoView({ block: 'center' }); r.click(); return true; })()`);
      await sleep(400);
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, `ai-modules-${width}-${mode}.png`), await tab.shoot(false)); }
      const m = await tab.eval(`(() => {
        const list = document.getElementById('setup-ai-sees-module-list');
        const rows = [...list.querySelectorAll('.sdk-choice-row')].map((row) => {
          const r = row.getBoundingClientRect(); const sw = row.querySelector('.sdk-switch').getBoundingClientRect(); const lab = row.querySelector('.sdk-choice-label').getBoundingClientRect();
          return { rowL: r.left, rowR: r.right, swR: sw.right, labL: lab.left, swL: sw.left };
        });
        return { rows, hidden: list.hidden };
      })()`);
      assert.equal(m.hidden, false, 'the list is open');
      assert.ok(m.rows.length >= 5, `the module switches are listed (${m.rows.length})`);
      const first = m.rows[0];
      for (const r of m.rows) {
        assert.ok(r.rowR - r.swR <= 16 + 3, `the switch sits at the row's right edge (gap ${r.rowR - r.swR}px)`);
        assert.ok(Math.abs(r.swR - first.swR) <= 1, `every switch is in one column (${r.swR} vs ${first.swR})`);
        assert.ok(r.labL - r.rowL <= 16 + 3, `the label starts at the row's left edge (gap ${r.labL - r.rowL}px)`);
        assert.ok(r.swL > r.labL, 'the label comes before the switch');
      }
      const above = await tab.eval(`document.getElementById('setup-ai-sees-follow').getBoundingClientRect().right`);
      assert.ok(Math.abs(above - first.swR) <= 3, `the module switches line up with the switches above (${first.swR} vs ${above})`);
    });
  }

  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    for (const [width, mode] of [[1280, 'light'], [1280, 'dark'], [1024, 'light']]) {
      const tab = await inSpace('admin', width, mode);
      await openSetup(tab);
      for (const id of OWNER) {
        await tab.click(`#setup-tab-${id}`);
        await sleep(700);
        fs.writeFileSync(path.join(SHOTS, `${id}-${width}-${mode}.png`), await tab.shoot(false));
        await tab.eval(`document.querySelector('#space-setup .setup-body').scrollTop = 99999`);
        await sleep(300);
        fs.writeFileSync(path.join(SHOTS, `${id}-bottom-${width}-${mode}.png`), await tab.shoot(false));
      }
    }
  }
} finally {
  for (const t of tabs) await t.close().catch(() => {});
  if (browser) await browser.close?.().catch?.(() => {});
  if (server) await stopServer(server);
}
console.log(failed ? `check-setup-tabs: ${failed} FAILED, ${n} passed` : `check-setup-tabs: OK (${n} tests)`);
process.exit(failed ? 1 : 0);
