#!/usr/bin/env node
/*
 * check-schedule-board-rows.mjs -- Planner - Projects' Board rows and filters, live (documentation/plans/plan-projects-kanban.md, step 5b).
 *
 * A throwaway server (its own DATA_DIR and port, stopped at the end) with the `project` template, one space, an owner and a member
 * (who has `edit` but not `columns`). Then headless Chromium, at 1280 and 390 wide, light and dark:
 *   - the Rows switch (None, Milestone, Person) in the Board's bar for someone with `columns`, one `board:main` write with `rowsBy`
 *     ("milestone" or "owners", none stored for None), Undo of it, and the "No milestone" and "No one" rows;
 *   - a card dropped in another row stays and the line says "Change the milestone in Edit." or "Change who is doing it in Edit.";
 *     a drop in its own row moves the column only;
 *   - the Filters (Who, Tags, Phase, Milestone) alone and together, the Filters count and Clear filters, "Showing 4 of 12", "Nothing
 *     matches.", the filter kept over a reload, a move that does not hide a card, "+" while filtered and "Added. The filter hides it.";
 *   - a member sees the rows (and a second browser sees a rows change) but has no switch, can filter, and a forced write is refused;
 *   - at 390 the rows are groups and the switch and Filters are there with 44 px targets.
 * With no Chromium it says SKIPPED and exits 0 (a skip, never a pass). SHOTS=<folder> keeps a screenshot of each screen.
 * Usage: node tools/check-schedule-board-rows.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, Tab, startServer, stopServer, freePort, findBrowser, sleep } from './shots.mjs';
import { stopBrowser } from './browser-launch.mjs';

const say = (...a) => console.log('check-schedule-board-rows:', ...a);
let n = 0;
const problems = [];
const ok = (cond, msg) => { n += 1; if (!cond) problems.push(msg); };
const same = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const bin = findBrowser();
if (!bin) { say('SKIPPED: no Chromium (set CHROME_PATH). This is a skip, not a pass.'); process.exit(0); }
const SHOTS = process.env.SHOTS ? path.resolve(process.env.SHOTS) : '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const PASSWORD = 'testpass1234';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-schedule-board-rows-'));
const server = await startServer(dir, await freePort(), 'first', {});
const jar = {};
async function call(method, url, body, as = 'admin', extra = {}) {
  const headers = { 'content-type': 'application/json', accept: 'application/json', ...extra };
  if (jar[as]) headers.cookie = jar[as];
  const r = await fetch(server.base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await r.json(); } catch { /* none */ }
  return { status: r.status, json, res: r };
}
const login = async (l) => { const r = await call('POST', '/api/login', { login: l, password: PASSWORD }, '__'); if (r.status !== 200) throw new Error(`cannot sign in as ${l}`); jar[l] = r.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '); };
const must = (r, what) => { if (r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.json)}`); return r.json; };

let browser = null;
let tab = null;
try {
  // ---- the world ----
  await login('admin');
  must(await call('PATCH', '/api/settings', { template: 'project' }), 'template');
    const mia = must(await call('POST', '/api/users', { login: 'mia', displayName: 'Mia Alvarez', role: 'member', password: PASSWORD }), 'mia').user;
    const inst = await call('POST', '/api/modules/bundled/schedule/install');
  if (inst.status >= 300 && !/already installed/.test(JSON.stringify(inst.json))) throw new Error(`install: ${JSON.stringify(inst.json)}`);
  must(await call('PATCH', '/api/modules/schedule', { enabled: true }), 'enable');
  const space = must(await call('POST', '/api/spaces', { name: 'Launch', starter: false, members: [mia.key] }), 'space').space;
  const SP = space.id;
  must(await call('PUT', `/api/modules/schedule/settings/space?space=${SP}`, { values: { tags: [{ id: 'a', label: 'Alpha', icon: 'flag', color: '#3b82f6' }, { id: 'b', label: 'Beta', icon: 'flag', color: '#3b82f6' }, { id: 'c', label: 'Gamma', icon: 'flag', color: '#3b82f6' }] } }), 'settings');
  const put = async (id, value) => must(await call('PUT', `/api/modules/schedule/data/${encodeURIComponent(`plan:${id}`)}?scope=space&space=${SP}`, { value }), `put ${id}`);
  const read = async (id) => (await call('GET', `/api/modules/schedule/data/${encodeURIComponent(`plan:${id}`)}?scope=space&space=${SP}`)).json.item;
  const admin = (await call('GET', '/api/me')).json.user.key;
  const me = (await call('GET', '/api/me')).json.user;
  const adminName = me.displayName || me.login || 'admin';
  await put('ms1', { kind: 'milestone', title: 'Launch day', start: '2026-10-30', order: 'a', by: admin });
  await put('ms2', { kind: 'milestone', title: 'Later on', start: '2026-12-01', order: 'b', by: admin });
  await put('w1', { kind: 'work', title: 'Write the brief', start: '2026-10-12', end: '2026-10-20', parent: 'ms1', owners: [admin], tags: ['a'], phase: 'start', order: 'a', by: admin });
  await put('w2', { kind: 'work', title: 'Book the venue', start: '2026-10-01', end: '2026-10-10', parent: 'ms2', owners: [mia.key], tags: ['a', 'b'], phase: 'build', column: 'doing', order: 'b', by: admin });
  await put('w3', { kind: 'work', title: 'Order cake', start: '2026-10-02', end: '2026-10-03', order: 'c', by: admin });
  await put('w4', { kind: 'work', title: 'Print flyers', start: '2026-10-05', end: '2026-10-08', done: true, column: 'done', parent: 'ms1', owners: [admin, mia.key], tags: ['b'], order: 'd', by: admin });
  await put('w5', { kind: 'work', title: 'Hire a band', start: '2026-10-06', end: '2026-10-09', parent: 'ms2', owners: [mia.key], order: 'e', by: admin });
  const boardNow = async (as = 'admin') => (await call('GET', `/api/modules/schedule/data/${encodeURIComponent('board:main')}?scope=space&space=${SP}`, undefined, as));
  await login('mia');
  const url = `/modules/schedule?space=${SP}`;

  // ---- the browser ----
  const b = await launch(bin);
  browser = b;
  const open = async (width, mode, as) => {
    const t = new Tab(b.cdp, null);
    await t.open(width, mode);
    for (const pair of jar[as].split('; ')) { const i = pair.indexOf('='); await t.cdp.send('Network.setCookie', { name: pair.slice(0, i), value: pair.slice(i + 1), url: server.base, httpOnly: true }, t.sid); }
    await t.cdp.send('Page.navigate', { url: server.base + url }, t.sid);
    await t.waitFor('#module-frame >>> #app');
    await t.settle();
    await sleep(600);
    await t.forceMode();
    return t;
  };
  const F = '#module-frame >>> ';
  const ev = (t, expr) => t.eval(expr);
  const all = (sel) => `__all(${JSON.stringify(F + sel)})`;
  const card = (title) => `${all('.sdk-board-card')}.find((c) => { const t = c.querySelector('.bd-title'); return t && t.textContent === ${JSON.stringify(title)}; })`;
  const colOf = (t, title) => ev(t, `(() => { const c = ${card(title)}; const s = c && c.closest('.sdk-board-col'); return s ? s.dataset.col : null; })()`);
  const colLabels = (t) => ev(t, `${all('.sdk-board-col')}.map((s) => { const h = s.querySelector('.sdk-board-label'); const c = s.querySelector('.sdk-board-count'); return h.textContent + ' ' + c.textContent; })`);
  const shot = async (t, name) => { if (!SHOTS) return; fs.writeFileSync(path.join(SHOTS, `${name}.png`), await t.shoot()); };
  const pick = async (t, label) => { await t.click('[role=radio]', label).catch(async () => { await t.click('button', label); }); await sleep(500); };
  const viewSwitch = (t, label) => t.eval(`(() => { const e = __all('[role=radio]').find((x) => (x.getAttribute('aria-label') || x.textContent).includes(${JSON.stringify(label)})); if (!e) return false; e.click(); return true; })()`);
  const menuItem = async (t, text) => { await t.waitFor(F + '[role=menuitem]', text); await t.click(F + '[role=menuitem]', text); await sleep(700); };
  const openCardMenu = async (t, title) => {
    await ev(t, `(() => { const c = ${card(title)}; c.scrollIntoView({ block: 'center' }); c.querySelector('.sdk-board-more').click(); })()`);
    await sleep(300);
  };
  const waitFor = async (fn, msg, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(150); } ok(false, msg); return false; };
  const stored = async (id) => (await read(id)).value;


  const ids = async () => ((await boardNow()).json.item.value.columns).map((c) => c.id);
  const labels = async () => ((await boardNow()).json.item.value.columns).map((c) => c.label);
  const colMenu = async (t, colId) => {
    await ev(t, `(() => { const s = __all(${JSON.stringify(F + '.sdk-board-col')}).find((x) => x.dataset.col === ${JSON.stringify(colId)}); s.scrollIntoView({ block: 'center' }); s.querySelector('.sdk-board-colmore').click(); })()`);
    await sleep(350);
  };
  const items = (t) => ev(t, `__all(${JSON.stringify(F + '[role=menuitem]')}).map((m) => m.textContent.trim() + (m.disabled ? ' (off)' : ''))`);
  const promptDo = async (t, text, submit = true) => {
    await t.waitFor('dialog.sdk-dialog-prompt input');
    await ev(t, `(() => { const i = document.querySelector('dialog.sdk-dialog-prompt input'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    if (submit) await ev(t, `document.querySelector('dialog.sdk-dialog-prompt [data-ok]').click()`);
    await sleep(500);
  };
  const promptError = (t) => ev(t, `(() => { const e = document.querySelector('dialog.sdk-dialog-prompt [data-error]'); return e ? e.textContent : null; })()`);
  const promptClose = async (t) => { await ev(t, `(() => { const e = document.querySelector('dialog.sdk-dialog-prompt [data-close]'); if (e) e.click(); })()`); await sleep(300); };
  const toasts = (t) => ev(t, `[...document.querySelectorAll('.sdk-toast')].map((x) => x.textContent.trim())`);
  const clickUndo = async (t) => { await ev(t, `__all(${JSON.stringify(F + '#undo-btn')})[0].click()`); await sleep(900); };
  const toggleDo = async (t, colId, item) => { await colMenu(t, colId); await menuItem(t, item); };
  const colsShown = (t) => ev(t, `${all('.sdk-board-col')}.map((s) => s.dataset.col)`);
  const labelsShown = (t) => ev(t, `${all('.sdk-board-col')}.map((s) => s.querySelector('.sdk-board-label').textContent)`);


  const boardPut = async (value, as = 'admin') => call('PUT', `/api/modules/schedule/data/${encodeURIComponent('board:main')}?scope=space&space=${SP}`, { value, version: (await boardNow(as)).status === 200 ? (await boardNow(as)).json.item.version : undefined }, as);
  const stages = { id: 'main', name: 'Board', field: 'column', columns: [{ id: 'todo', label: 'To do' }, { id: 'doing', label: 'Doing' }, { id: 'done', label: 'Done', done: true }] };
  const rowsLabels = (t) => ev(t, `${all('.sdk-board-row')}.map((r) => r.querySelector('.sdk-board-label').textContent + ' ' + r.querySelector('.sdk-board-count').textContent)`);
  const rowOf = (t, title) => ev(t, `(() => { const c = ${card(title)}; const r = c && c.closest('.sdk-board-row'); return r ? r.querySelector('.sdk-board-label').textContent : null; })()`);
  const shownTitles = (t) => ev(t, `${all('.sdk-board-card .bd-title')}.map((x) => x.textContent).sort()`);
  const rowsSwitch = (t) => ev(t, `${all('#rows-switch .mf-switch-btn')}.map((b) => b.textContent + (b.getAttribute('aria-checked') === 'true' ? '*' : ''))`);
  const clickRows = async (t, word) => { await ev(t, `${all('#rows-switch .mf-switch-btn')}.find((b) => b.textContent === ${JSON.stringify(word)}).click()`); await sleep(700); };
  const live = (t) => ev(t, `${all('.sdk-board-live')}.map((x) => x.textContent).join('')`);
  const dragTo = (t, title, col, row) => ev(t, `(() => {
    const c = ${card(title)}; const cell = ${all('.sdk-board-cell')}.find((x) => x.dataset.col === ${JSON.stringify(col)} && x.dataset.row === ${JSON.stringify(row)});
    if (!c || !cell) return false;
    const dt = new DataTransfer(); const fire = (type, el) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    fire('dragstart', c); fire('dragover', cell); fire('drop', cell); fire('dragend', c); return true;
  })()`);
  // The toolbar's Filters (the host's own, outside the module's frame).
  const filtersOpen = async (t) => { await t.click('.mf-filters'); await sleep(350); };
  const filterPick = async (t, text) => {
    const hit = await ev(t, `(() => { const m = [...document.querySelectorAll('[role^=menuitem]')].find((x) => x.textContent.trim().replace(/\\d+$/, '') === ${JSON.stringify(text)}); if (!m) return false; m.click(); return true; })()`);
    ok(hit, `the Filters menu has "${text}"`);
    await sleep(450);
  };
  const filterMenuText = (t) => ev(t, `[...document.querySelectorAll('[role^=menuitem]')].map((x) => x.textContent.trim())`);
  const filterBadge = (t) => ev(t, `(() => { const b = document.querySelector('.mf-filters .sdk-badge'); return b ? b.textContent : ''; })()`);
  const statusText = (t) => ev(t, `document.body.innerText`);
  const kept = (t) => ev(t, `localStorage.getItem('schedule-filter:${SP}')`);
  const cellEmpty = (t) => ev(t, `${all('.sdk-board-empty')}.map((x) => x.textContent)`);
  const colCounts = (t) => ev(t, `${all('.sdk-board-heads > *')}.map((h) => { const l = h.querySelector('.sdk-board-label'); const c = h.querySelector('.sdk-board-count'); return (l ? l.textContent : '') + ' ' + (c ? c.textContent : ''); })`);
  const openBoard = async (width, mode, as) => {
    const t = await open(width, mode, as);
    ok(await viewSwitch(t, 'Board'), `${as} ${width} ${mode}: Board`);
    await t.waitFor(F + '.sdk-board-card');
    await sleep(600);
    return t;
  };

  // ---- 1280 light: the switch, rows by milestone and by person, Undo ----
  tab = await openBoard(1280, 'light', 'admin');
  same(await rowsSwitch(tab), ['None*', 'Milestone', 'Person'], 'the Rows switch starts on None');
  same(await rowsLabels(tab), [], 'no rows by default');
  same((await boardNow()).status, 404, 'a board still on the template has no record');
  await shot(tab, 'rows-1280-light-none');
  await clickRows(tab, 'Milestone');
  await waitFor(async () => (await boardNow()).status === 200, 'the switch stores board:main');
  same((await boardNow()).json.item.value.rowsBy, 'milestone', 'rowsBy is "milestone"');
  same(await rowsSwitch(tab), ['None', 'Milestone*', 'Person'], 'the switch shows the choice');
  same(await rowsLabels(tab), ['Launch day 2', 'Later on 2', 'No milestone 1'], 'rows by milestone in outline order, the no-row row last');
  same([await rowOf(tab, 'Write the brief'), await rowOf(tab, 'Print flyers'), await rowOf(tab, 'Hire a band'), await rowOf(tab, 'Order cake')], ['Launch day', 'Launch day', 'Later on', 'No milestone'], 'each card is in its milestone\'s row');
  ok(await ev(tab, `!__all(${JSON.stringify(F + '#undo')})[0].hidden`), 'Undo is offered');
  await shot(tab, 'rows-1280-light-milestone');
  await clickUndo(tab);
  same((await boardNow()).status, 404, 'Undo takes the stored board away (it was the template\'s)');
  same(await rowsLabels(tab), [], 'and the rows go');
  same(await rowsSwitch(tab), ['None*', 'Milestone', 'Person'], 'and the switch is back on None');
  await clickRows(tab, 'Person');
  await waitFor(async () => (await boardNow()).status === 200, 'Person stores the board');
  same((await boardNow()).json.item.value.rowsBy, 'owners', 'rowsBy is "owners"');
  const names = [adminName, 'Mia Alvarez'].sort((x, y) => x.localeCompare(y));
  same((await rowsLabels(tab)).map((x) => x.replace(/ \d+$/, '')), [...names, 'No one'], 'rows by person: by name, then No one');
  same([await rowOf(tab, 'Write the brief'), await rowOf(tab, 'Print flyers'), await rowOf(tab, 'Book the venue'), await rowOf(tab, 'Order cake')], [adminName, adminName, 'Mia Alvarez', 'No one'], 'a card is in its first owner\'s row');
  await shot(tab, 'rows-1280-light-person');
  // a card cannot leave its row
  const miaRow = await ev(tab, `${all('.sdk-board-row')}.find((r) => r.querySelector('.sdk-board-label').textContent === 'Mia Alvarez').dataset.row`);
  ok(await dragTo(tab, 'Write the brief', 'doing', miaRow), 'a drag into another person\'s row');
  await sleep(500);
  same(await live(tab), 'Change who is doing it in Edit.', 'the line says why (by person)');
  same((await stored('w1')).column ?? 'todo', 'todo', 'the card did not move');
  same(await rowOf(tab, 'Write the brief'), adminName, 'and stayed in its row');
  await clickRows(tab, 'None');
  await waitFor(async () => !('rowsBy' in (await boardNow()).json.item.value), 'None stores no rowsBy');
  same(await rowsLabels(tab), [], 'None draws no rows');
  await clickRows(tab, 'Milestone');
  await waitFor(async () => (await boardNow()).json.item.value.rowsBy === 'milestone', 'back to milestone');
  // the drop in another milestone's row, then in its own
  const later = 'ms2';
  ok(await dragTo(tab, 'Write the brief', 'doing', later), 'a drag into another milestone\'s row');
  await sleep(500);
  same(await live(tab), 'Change the milestone in Edit.', 'the line says why (by milestone)');
  same([(await stored('w1')).column, (await stored('w1')).parent], [undefined, 'ms1'], 'nothing changed: not the column, not the milestone');
  await shot(tab, 'rows-1280-light-blocked');
  ok(await dragTo(tab, 'Write the brief', 'doing', 'ms1'), 'a drag into its own row');
  await waitFor(async () => (await stored('w1')).column === 'doing', 'a drop in its own row moves the column');
  same([(await stored('w1')).parent, await rowOf(tab, 'Write the brief')], ['ms1', 'Launch day'], 'and the row is the same');
  await tab.close();
  tab = null;

  // ---- 1280 light: the filters, each kind alone ----
  tab = await openBoard(1280, 'light', 'admin');
  same((await statusText(tab)).includes('Showing'), false, 'no filter, no "Showing"');
  await filtersOpen(tab);
  const menu = await filterMenuText(tab);
  for (const w of ['Clear filters', 'No one', 'Alpha', 'Beta', 'Gamma', 'Every phase', 'Start', 'Build', 'Wrap up', 'No phase', 'Every milestone', 'Launch day', 'Later on', 'No milestone']) ok(menu.some((x) => x.replace(/\d+$/, '') === w), `the Filters menu has "${w}": ${JSON.stringify(menu)}`);
  ok(menu.some((x) => x.replace(/\d+$/, '') === adminName), `and the person: ${JSON.stringify(menu)}`);
  await shot(tab, 'filters-1280-light-menu');
  await filterPick(tab, adminName);
  same(await shownTitles(tab), ['Print flyers', 'Write the brief'], 'Who: the person\'s work');
  ok((await statusText(tab)).includes('Showing 2 of 5 pieces of work'), 'the status bar says "Showing 2 of 5 pieces of work"');
  same(await filterBadge(tab), '1', 'the Filters button counts one');
  same(JSON.parse(await kept(tab)).who.length, 1, 'kept in this browser');
  await filterPick(tab, 'No one');
  same(await shownTitles(tab), ['Order cake', 'Print flyers', 'Write the brief'], 'Who: the person or No one');
  await filterPick(tab, adminName);
  await filterPick(tab, 'No one');
  same((await shownTitles(tab)).length, 5, 'both off: everything again');
  await filterPick(tab, 'Beta');
  same(await shownTitles(tab), ['Book the venue', 'Print flyers'], 'Tags: Beta');
  await filterPick(tab, 'Alpha');
  same(await shownTitles(tab), ['Book the venue'], 'Tags: has all of them');
  await filterPick(tab, 'Beta');
  await filterPick(tab, 'Alpha');
  await filterPick(tab, 'Build');
  same(await shownTitles(tab), ['Book the venue'], 'Phase: one choice');
  await filterPick(tab, 'No phase');
  same(await shownTitles(tab), ['Hire a band', 'Order cake', 'Print flyers'], 'Phase: No phase');
  await filterPick(tab, 'Every phase');
  await filterPick(tab, 'Later on');
  same(await shownTitles(tab), ['Book the venue', 'Hire a band'], 'Milestone: one choice');
  await filterPick(tab, 'No milestone');
  same(await shownTitles(tab), ['Order cake'], 'Milestone: No milestone');
  await filterPick(tab, 'Every milestone');
  same((await shownTitles(tab)).length, 5, 'every milestone: all again');
  // together
  await filterPick(tab, 'Alpha');
  await filterPick(tab, 'Later on');
  same(await shownTitles(tab), ['Book the venue'], 'groups combine with and');
  same(await filterBadge(tab), '2', 'the Filters button counts two');
  ok((await statusText(tab)).includes('Showing 1 of 5 pieces of work'), 'Showing 1 of 5');
  same((await colCounts(tab)).join('|').replace(/\s+/g, ' ').includes('Doing 1'), true, 'a column counts the cards shown');
  await shot(tab, 'filters-1280-light-two');
  await filterPick(tab, 'Gamma');
  await sleep(300);
  ok((await cellEmpty(tab)).includes('Nothing matches.'), `an empty cell says "Nothing matches.": ${JSON.stringify(await cellEmpty(tab))}`);
  await shot(tab, 'filters-1280-light-nothing');
  await filterPick(tab, 'Gamma');
  // Clear filters
  await filterPick(tab, 'Clear filters');
  await sleep(400);
  same((await shownTitles(tab)).length, 5, 'Clear filters puts every card back');
  same(await filterBadge(tab), '', 'and the count goes');
  await waitFor(async () => !(await statusText(tab)).includes('Showing'), 'and "Showing" goes');
  await tab.key('Escape');
  await tab.close();
  tab = null;

  // ---- 1280 light: kept over a reload, a move that cannot hide, "+" while filtered ----
  tab = await openBoard(1280, 'light', 'admin');
  await filtersOpen(tab);
  await filterPick(tab, adminName);
  await tab.key('Escape');
  same(await shownTitles(tab), ['Print flyers', 'Write the brief'], 'before reload');
  await tab.cdp.send('Page.reload', {}, tab.sid);
  await tab.waitFor(F + '#app');
  await sleep(900);
  await tab.forceMode();
  same(await shownTitles(tab), ['Print flyers', 'Write the brief'], 'the filter is kept over a reload');
  ok((await statusText(tab)).includes('Showing 2 of 5'), 'and the status bar says so');
  await filtersOpen(tab);
  const on = await ev(tab, `[...document.querySelectorAll('[role^=menuitem]')].filter((x) => x.getAttribute('aria-checked') === 'true').map((x) => x.textContent.trim().replace(/\\d+$/, ''))`);
  ok(on.includes(adminName) && on.includes('Every phase'), `the menu shows what is on: ${JSON.stringify(on)}`);
  await tab.key('Escape');
  // a move cannot hide a card
  ok(await dragTo(tab, 'Write the brief', 'done', 'ms1'), 'a drag in its row');
  await waitFor(async () => (await stored('w1')).column === 'done', 'the drag moved it');
  ok((await shownTitles(tab)).includes('Write the brief'), 'a drag leaves the card shown');
  await ev(tab, `(() => { const c = ${card('Write the brief')}; c.scrollIntoView({ block: 'center' }); c.focus(); })()`);
  await tab.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37, modifiers: 1 }, tab.sid);
  await tab.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37, modifiers: 1 }, tab.sid);
  await sleep(500);
  ok((await shownTitles(tab)).includes('Write the brief'), 'a move leaves the card shown');
  // "+" while filtered: the person and the tags come with it
  await filtersOpen(tab);
  await filterPick(tab, 'Beta');
  await tab.key('Escape');
  await ev(tab, `${all('.sdk-board-col')}.find((s) => s.dataset.col === 'todo').querySelector('.sdk-board-add').click()`);
  await tab.waitFor(F + '#f-title');
  same(await ev(tab, `__all(${JSON.stringify(F + '#f-owners input:checked')}).map((i) => i.value)`), [admin], '"+" starts with the person chosen');
  same(await ev(tab, `__all(${JSON.stringify(F + '#f-tags input:checked')}).map((i) => i.value)`), ['b'], 'and the tag');
  await shot(tab, 'filters-1280-light-plus');
  await tab.typeInto(F + '#f-title', 'Fits the filter');
  await ev(tab, `(() => { for (const [id, v] of [['#f-start', '2026-10-26'], ['#f-end', '2026-10-27']]) { const i = __all(${JSON.stringify(F)} + id)[0]; i.value = v; i.dispatchEvent(new Event('change', { bubbles: true })); } return 1; })()`);
  await ev(tab, `__all(${JSON.stringify(F + '#f-save')})[0].click()`);
  await waitFor(async () => (await shownTitles(tab)).includes('Fits the filter'), 'new work that fits the filter shows');
  ok(!(await toasts(tab)).some((x) => x.includes('The filter hides it')), 'and no toast says it is hidden');
  // work that does not fit: change the person in the editor
  await ev(tab, `${all('.sdk-board-col')}.find((s) => s.dataset.col === 'todo').querySelector('.sdk-board-add').click()`);
  await tab.waitFor(F + '#f-title');
  await tab.typeInto(F + '#f-title', 'Does not fit');
  await ev(tab, `(() => { for (const [id, v] of [['#f-start', '2026-10-26'], ['#f-end', '2026-10-27']]) { const i = __all(${JSON.stringify(F)} + id)[0]; i.value = v; i.dispatchEvent(new Event('change', { bubbles: true })); } return 1; })()`);
  await ev(tab, `(() => { const i = __all(${JSON.stringify(F + '#f-tags input:checked')})[0]; i.click(); })()`);
  await ev(tab, `__all(${JSON.stringify(F + '#f-save')})[0].click()`);
  await waitFor(async () => (await toasts(tab)).some((x) => x.includes('Added. The filter hides it.')), `a toast says the filter hides it: ${JSON.stringify(await toasts(tab))}`);
  ok(!(await shownTitles(tab)).includes('Does not fit'), 'and it is not shown');
  await shot(tab, 'filters-1280-light-hidden-toast');
  await tab.close();
  tab = null;

  // ---- a member: the rows, no switch, the filters; a forced write is refused; a second browser sees a change ----
  must(await boardPut({ ...stages, rowsBy: 'milestone' }), 'rows by milestone for the member');
  tab = await openBoard(1280, 'light', 'mia');
  ok(await ev(tab, `__all(${JSON.stringify(F + '#board-bar')})[0].hidden`), 'a member sees no Rows switch');
  same((await rowsLabels(tab)).map((x) => x.replace(/ \d+$/, '')), ['Launch day', 'Later on', 'No milestone'], 'but sees the rows');
  await filtersOpen(tab);
  await filterPick(tab, 'Later on');
  same((await shownTitles(tab)).sort(), ['Book the venue', 'Hire a band'], 'and can filter');
  await tab.key('Escape');
  await shot(tab, 'rows-1280-light-member');
  const forced = await boardPut({ ...stages, rowsBy: 'owners' }, 'mia');
  same([forced.status, forced.json && forced.json.error], [403, "Your role can't do that in this module."], 'a forced rowsBy write by a member is the server\'s sentence');
  same((await boardNow()).json.item.value.rowsBy, 'milestone', 'and nothing changed');
  // a second browser: the admin changes the rows while the member has the board open
  must(await boardPut({ ...stages, rowsBy: 'owners' }), 'the admin changes the rows');
  await waitFor(async () => (await rowsLabels(tab)).some((x) => x.startsWith('Mia Alvarez')), 'the member\'s open board shows the change to rows by person');
  await tab.close();
  tab = null;

  // ---- dark, and the phone ----
  must(await boardPut({ ...stages, rowsBy: 'milestone' }), 'rows by milestone again');
  for (const [width, mode] of [[1280, 'dark'], [390, 'light'], [390, 'dark']]) {
    const tag = `${width} ${mode}`;
    tab = await openBoard(width, mode, 'admin');
    ok(await ev(tab, `!__all(${JSON.stringify(F + '#board-bar')})[0].hidden`), `${tag}: the switch is there for an owner`);
    same((await rowsLabels(tab)).length, 3, `${tag}: three rows`);
    await shot(tab, `rows-${width}-${mode}`);
    if (width === 390) {
      const r = await ev(tab, `(() => { const q = (s) => __all(${JSON.stringify(F)} + s); const h = (e) => e.getBoundingClientRect(); return { sw: [h(q('#rows-switch')[0]).height], add: h(q('#col-add')[0]).height, bar: h(q('#board-bar')[0]).width, wide: document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth + 1, rowhead: q('.sdk-board-rowfold').map((b) => h(b).height) }; })()`);
      ok(r.sw.every((x) => x >= 44) && r.add >= 44 && r.rowhead.every((x) => x >= 44), `${tag}: touch targets are 44 px (the switch, as every .mf-switch): ${JSON.stringify(r)}`);
      ok(!r.wide, `${tag}: nothing scrolls sideways`);
      const lay = await ev(tab, `(() => { const g = ${all('.sdk-board-row')}; const r = g.map((x) => x.getBoundingClientRect()); return { stacked: r.every((x, i) => i === 0 || x.top > r[i - 1].top), cols: ${all('.sdk-board-rowbody')}.length }; })()`);
      ok(lay.stacked && lay.cols > 0, `${tag}: each row is a group of stacked columns: ${JSON.stringify(lay)}`);
      ok(await ev(tab, `!!document.querySelector('.mf-filters')`), `${tag}: the Filters button is there`);
      await filtersOpen(tab);
      await filterPick(tab, 'Later on');
      same((await shownTitles(tab)).length, 2, `${tag}: a filter works on a phone`);
      await tab.key('Escape');
      await shot(tab, `filters-${width}-${mode}`);
    } else {
      await filtersOpen(tab);
      await filterPick(tab, 'Later on');
      await shot(tab, `filters-${width}-${mode}`);
      await tab.key('Escape');
    }
    await tab.close();
    tab = null;
  }
} catch (err) {
  problems.push(`the run stopped: ${err && err.stack || err}`);
} finally {
  if (tab) await tab.close().catch(() => {});
  if (browser) await stopBrowser(browser.child, browser.dir).catch(() => {});
  await stopServer(server);
  fs.rmSync(dir, { recursive: true, force: true });
}
if (problems.length) { console.error(`check-schedule-board-rows: ${problems.length} problem(s) in ${n} checks`); for (const p of problems) console.error(`  - ${p}`); process.exit(1); }
say(`${n} checks pass`);
