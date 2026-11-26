#!/usr/bin/env node
/*
 * check-schedule-board-editor.mjs -- the column menu and editor of Planner - Projects, live (documentation/plans/plan-projects-kanban.md, step 4).
 *
 * A throwaway server (its own DATA_DIR and port, stopped at the end) with the `project` template, one space, an owner and a member
 * (who has `edit` but not `columns`). Then headless Chromium, at 1280 and 390 wide, light and dark:
 *   - a board still on the template's columns has no stored record; the first edit stores `board:main`; Undo takes it away again;
 *   - Rename (labels only, ids and cards stay), Move left and right, Add a column, "Counts as done" (the work in it ticks, a
 *     milestone settles, Undo puts both back), Delete with the column that takes its work (the work moves);
 *   - the refusals in the library's sentences: a blank name, 41 characters, 12 columns, the last done column, the last open column;
 *   - a member without `columns` sees Fold only and no "Add a column", and a forced write is the server's 403 sentence;
 *   - at 390 the column menu works by tap and the stacked layout stays.
 * With no Chromium it says SKIPPED and exits 0 (a skip, never a pass). SHOTS=<folder> keeps a screenshot of each screen.
 * Usage: node tools/check-schedule-board-editor.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, Tab, startServer, stopServer, freePort, findBrowser, sleep } from './shots.mjs';
import { stopBrowser } from './browser-launch.mjs';

const say = (...a) => console.log('check-schedule-board-editor:', ...a);
let n = 0;
const problems = [];
const ok = (cond, msg) => { n += 1; if (!cond) problems.push(msg); };
const same = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const bin = findBrowser();
if (!bin) { say('SKIPPED: no Chromium (set CHROME_PATH). This is a skip, not a pass.'); process.exit(0); }
const SHOTS = process.env.SHOTS ? path.resolve(process.env.SHOTS) : '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const PASSWORD = 'testpass1234';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-schedule-board-editor-'));
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
  await put('ms1', { kind: 'milestone', title: 'Launch day', start: '2026-10-30', order: 'a', by: admin });
  await put('ms2', { kind: 'milestone', title: 'Later on', start: '2026-12-01', order: 'b', by: admin });
  await put('w1', { kind: 'work', title: 'Write the brief', start: '2026-10-12', end: '2026-10-20', parent: 'ms1', order: 'a', by: admin });
  await put('w2', { kind: 'work', title: 'Book the venue', start: '2026-10-01', end: '2026-10-10', parent: 'ms2', column: 'doing', order: 'b', by: admin });
  await put('w4', { kind: 'work', title: 'Print flyers', start: '2026-10-05', end: '2026-10-08', done: true, column: 'done', parent: 'ms1', order: 'd', by: admin });
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

  // ---- 1280 light: the first edit stores the board; Undo takes it away; rename, add, move ----
  tab = await open(1280, 'light', 'admin');
  ok(await viewSwitch(tab, 'Board'), 'Board');
  await tab.waitFor(F + '.sdk-board-col');
  await sleep(500);
  same((await boardNow()).status, 404, 'a template-default board has no stored record');
  ok(await ev(tab, `!__all(${JSON.stringify(F + '#board-bar')})[0].hidden`), 'an owner sees "Add a column"');
  await colMenu(tab, 'doing');
  same(await items(tab), ['Fold', 'Rename', 'Move left', 'Move right', 'Counts as done', 'Delete'], 'the column menu for someone with columns');
  await shot(tab, 'editor-1280-light-menu');
  await menuItem(tab, 'Rename');
  await promptDo(tab, '   ');
  same(await promptError(tab), 'Give the column a name.', 'a blank name is refused in the library\'s sentence');
  await promptDo(tab, 'x'.repeat(41));
  same(await promptError(tab), 'A column name is at most 40 characters.', '41 characters are refused');
  await shot(tab, 'editor-1280-light-prompt-error');
  await promptDo(tab, 'Under way');
  await waitFor(async () => (await boardNow()).status === 200, 'the first edit stores board:main');
  same(await ids(), ['todo', 'doing', 'done'], 'a rename never changes an id');
  same(await labels(), ['To do', 'Under way', 'Done'], 'the stored board holds the person\'s label');
  same(await labelsShown(tab), ['To do', 'Under way', 'Done'], 'and the board shows it');
  same((await stored('w2')).column, 'doing', 'the work stays in its column (same id)');
  ok(await ev(tab, `!__all(${JSON.stringify(F + '#undo')})[0].hidden`), 'Undo is offered');
  await clickUndo(tab);
  same((await boardNow()).status, 404, 'Undo takes the stored board away again (the template columns return)');
  same(await labelsShown(tab), ['To do', 'Doing', 'Done'], 'and the board shows the template\'s words');
  // Add
  await ev(tab, `__all(${JSON.stringify(F + '#col-add')})[0].click()`);
  await promptDo(tab, '');
  same(await promptError(tab), 'Give the column a name.', 'Add: a blank name is refused');
  await promptDo(tab, 'Review');
  await waitFor(async () => (await boardNow()).status === 200 && (await ids()).length === 4, 'Add a column stores a four-column board');
  same(await ids(), ['todo', 'doing', 'done', 'review'], 'a new column is last, with an id from its name');
  same((await stored('w4')).column, 'done', 'the work is where it was');
  // Move left twice: Review before Done, then before Doing
  await toggleDo(tab, 'review', 'Move left');
  await waitFor(async () => (await ids()).join() === 'todo,doing,review,done', 'Move left');
  await toggleDo(tab, 'review', 'Move left');
  await waitFor(async () => (await ids()).join() === 'todo,review,doing,done', 'Move left again');
  same(await colsShown(tab), ['todo', 'review', 'doing', 'done'], 'the board shows the new order');
  await colMenu(tab, 'todo');
  ok((await items(tab)).includes('Move left (off)'), 'the first column cannot move left');
  await tab.key('Escape');
  await colMenu(tab, 'done');
  ok((await items(tab)).includes('Move right (off)'), 'the last column cannot move right');
  await tab.key('Escape');
  await shot(tab, 'editor-1280-light-moved');

  // ---- the flag: work in the column ticks, the milestone settles, Undo restores both ----
  same([Boolean((await stored('w2')).done), Boolean((await stored('ms2')).done)], [false, false], 'before: not done');
  await toggleDo(tab, 'doing', 'Counts as done');
  await waitFor(async () => (await stored('w2')).done === true, 'the flag ticks the work in the column');
  await waitFor(async () => (await stored('ms2')).done === true, 'and the milestone settles');
  same((await boardNow()).json.item.value.columns.find((c) => c.id === 'doing').done, true, 'the board stores the flag');
  await clickUndo(tab);
  same([(await stored('w2')).done, (await stored('ms2')).done], [false, false], 'Undo unticks the work and the milestone');
  same((await boardNow()).json.item.value.columns.find((c) => c.id === 'doing').done, undefined, 'and the flag');
  // Done's flag cannot go (the last done column)
  await toggleDo(tab, 'done', 'Counts as done');
  await sleep(500);
  ok((await toasts(tab)).some((x) => x.includes('Keep at least one column that counts as done.')), `the last done column keeps its flag: ${JSON.stringify(await toasts(tab))}`);
  // flag on, then off: the work unticks
  await toggleDo(tab, 'doing', 'Counts as done');
  await waitFor(async () => (await stored('w2')).done === true, 'flag on');
  await toggleDo(tab, 'doing', 'Counts as done');
  await waitFor(async () => (await stored('w2')).done === false, 'flag off unticks the work');
  await waitFor(async () => (await stored('ms2')).done === false, 'and the milestone is open again');

  // ---- delete: which column takes the work ----
  await toggleDo(tab, 'doing', 'Delete');
  await tab.waitFor(F + '#col-to');
  same(await ev(tab, `__all(${JSON.stringify(F + '#col-to option')}).map((o) => o.value)`), ['todo', 'review', 'done'], 'the chooser offers the other columns');
  ok(/^1 .* will move there/.test(await ev(tab, `__all(${JSON.stringify(F + '#col-to-hint')})[0].textContent`)), 'and says how much work moves');
  await shot(tab, 'editor-1280-light-delete');
  await ev(tab, `(() => { const s = __all(${JSON.stringify(F + '#col-to')})[0]; s.value = 'review'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await ev(tab, `__all(${JSON.stringify(F + '#col-go')})[0].click()`);
  await waitFor(async () => (await ids()).join() === 'todo,review,done', 'the column is gone');
  await waitFor(async () => (await stored('w2')).column === 'review', 'its work moved to the chosen column');
  await clickUndo(tab);
  await waitFor(async () => (await stored('w2')).column === 'doing', 'Undo moves the work back');
  same([(await ids()).join(), (await stored('w2')).column], ['todo,review,doing,done', 'doing'], 'Undo brings the column and its work back');
  // the last done column cannot be deleted
  await toggleDo(tab, 'done', 'Delete');
  await sleep(500);
  ok((await toasts(tab)).filter((x) => x.includes('Keep at least one column that counts as done.')).length >= 1, 'deleting the last done column is refused');
  await tab.close();
  tab = null;

  // ---- 12 columns, and the last open column ----
  const board12 = { id: 'main', name: 'Board', field: 'column', columns: Array.from({ length: 12 }, (_, i) => (i === 11 ? { id: 'done', label: 'Done', done: true } : { id: i === 0 ? 'todo' : `c${i}`, label: `C${i}` })) };
  must(await call('PUT', `/api/modules/schedule/data/${encodeURIComponent('board:main')}?scope=space&space=${SP}`, { value: board12, version: (await boardNow()).json.item.version }), 'twelve columns');
  tab = await open(1280, 'dark', 'admin');
  ok(await viewSwitch(tab, 'Board'), 'Board');
  await tab.waitFor(F + '.sdk-board-col');
  await sleep(500);
  await ev(tab, `__all(${JSON.stringify(F + '#col-add')})[0].click()`);
  await promptDo(tab, 'One too many');
  same(await promptError(tab), 'A board has at most 12 columns.', 'a thirteenth column is refused');
  await promptClose(tab);
  await shot(tab, 'editor-1280-dark-twelve');
  await tab.close();
  tab = null;
  const two = { id: 'main', name: 'Board', field: 'column', columns: [{ id: 'todo', label: 'To do' }, { id: 'done', label: 'Done', done: true }] };
  must(await call('PUT', `/api/modules/schedule/data/${encodeURIComponent('board:main')}?scope=space&space=${SP}`, { value: two, version: (await boardNow()).json.item.version }), 'two columns');
  tab = await open(1280, 'dark', 'admin');
  ok(await viewSwitch(tab, 'Board'), 'Board');
  await tab.waitFor(F + '.sdk-board-col');
  await sleep(500);
  await toggleDo(tab, 'todo', 'Delete');
  await sleep(500);
  ok((await toasts(tab)).some((x) => x.includes('Keep at least one column that does not count as done.')), `the last open column cannot be deleted: ${JSON.stringify(await toasts(tab))}`);
  await shot(tab, 'editor-1280-dark-refused');
  await tab.close();
  tab = null;

  // ---- a member without `columns`: Fold only, no Add, and a forced write is the server's sentence ----
  tab = await open(1280, 'light', 'mia');
  ok(await viewSwitch(tab, 'Board'), 'mia: Board');
  await tab.waitFor(F + '.sdk-board-col');
  await sleep(500);
  ok(await ev(tab, `__all(${JSON.stringify(F + '#board-bar')})[0].hidden`), 'a member does not see "Add a column"');
  await colMenu(tab, 'todo');
  same(await items(tab), ['Fold'], 'a member\'s column menu is Fold only');
  await tab.key('Escape');
  await shot(tab, 'editor-1280-light-member');
  const forced = await call('PUT', `/api/modules/schedule/data/${encodeURIComponent('board:main')}?scope=space&space=${SP}`, { value: { ...two, columns: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', done: true }] }, version: (await boardNow('mia')).json.item.version }, 'mia');
  same([forced.status, forced.json && forced.json.error], [403, "Your role can't do that in this module."], 'a forced write is refused in the server\'s sentence');
  await tab.close();
  tab = null;

  // ---- the phone: the column menu by tap, the stacked layout stays ----
  for (const mode of ['light', 'dark']) {
    tab = await open(390, mode, 'admin');
    const tag = `390 ${mode}`;
    ok(await viewSwitch(tab, 'Board'), `${tag}: Board`);
    await tab.waitFor(F + '.sdk-board-col');
    await sleep(500);
    ok(await ev(tab, `!__all(${JSON.stringify(F + '#board-bar')})[0].hidden`), `${tag}: Add a column is there`);
    const r = await ev(tab, `(() => { const b = __all(${JSON.stringify(F + '.sdk-board-colmore')})[0].getBoundingClientRect(); const a = __all(${JSON.stringify(F + '#col-add')})[0].getBoundingClientRect(); return { colmore: [b.width, b.height], add: a.height }; })()`);
    ok(r.colmore[0] >= 44 && r.colmore[1] >= 44 && r.add >= 44, `${tag}: touch targets are 44 px: ${JSON.stringify(r)}`);
    await tab.click(F + '.sdk-board-colmore');
    await sleep(350);
    ok((await items(tab)).includes('Rename'), `${tag}: a tap opens the column menu with the editor items`);
    await shot(tab, `editor-390-${mode}-menu`);
    await menuItem(tab, 'Rename');
    await tab.waitFor('dialog.sdk-dialog-prompt input');
    await shot(tab, `editor-390-${mode}-prompt`);
    await promptClose(tab);
    const lay = await ev(tab, `(() => { const cols = __all(${JSON.stringify(F + '.sdk-board-col')}); const r = cols.map((c) => c.getBoundingClientRect()); const body = document.scrollingElement; return { stacked: r.every((x, i) => i === 0 || x.top > r[i - 1].top), wide: body.scrollWidth > body.clientWidth + 1 }; })()`);
    ok(lay.stacked && !lay.wide, `${tag}: still stacked, nothing scrolls sideways`);
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
if (problems.length) { console.error(`check-schedule-board-editor: ${problems.length} problem(s) in ${n} checks`); for (const p of problems) console.error(`  - ${p}`); process.exit(1); }
say(`${n} checks pass`);
