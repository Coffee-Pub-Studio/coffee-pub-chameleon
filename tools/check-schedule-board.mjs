#!/usr/bin/env node
/*
 * check-schedule-board.mjs -- the Board view of Planner - Projects, live (documentation/plans/plan-projects-kanban.md, step 3).
 *
 * A throwaway server (its own DATA_DIR and port, stopped at the end) with the `project` template, one space with a small plan, an
 * owner, a member (who has `edit` but not `columns`) and an agent. Then headless Chromium, at 1280 and 390 wide, light and dark:
 *   - the Board is the third choice of the view switch and of "Opens on"; its columns are To do, Doing and Done with their counts,
 *     each card says its title, end day, "Late", who, up to two tags, the milestone and "Waits on", as text; cards are work only;
 *   - a move by the card's menu, by Alt+Right and by drag runs setColumn in the page: the List then agrees (the column's name under
 *     the title, the tick), a tick in the List moves the card to Done and untick moves it out, and a milestone settles;
 *   - a member without `columns` still moves cards (only `edit`), and a board write by that member is the server's 403 sentence;
 *   - an agent's setColumn moves the card on an open board, shows under What it changed, and Undo puts it back;
 *   - a space whose boardColumns is "priority" shows Inbox, Now, Next, Later and Done;
 *   - at 390 the columns stack, the done column is folded, nothing scrolls sideways, and a card still moves by its menu.
 * With no Chromium it says SKIPPED and exits 0 (a skip, never a pass). SHOTS=<folder> keeps a screenshot of each screen.
 * Usage: node tools/check-schedule-board.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, Tab, startServer, stopServer, freePort, findBrowser, sleep } from './shots.mjs';
import { stopBrowser } from './browser-launch.mjs';

const say = (...a) => console.log('check-schedule-board:', ...a);
let n = 0;
const problems = [];
const ok = (cond, msg) => { n += 1; if (!cond) problems.push(msg); };
const same = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const bin = findBrowser();
if (!bin) { say('SKIPPED: no Chromium (set CHROME_PATH). This is a skip, not a pass.'); process.exit(0); }
const SHOTS = process.env.SHOTS ? path.resolve(process.env.SHOTS) : '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const PASSWORD = 'testpass1234';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-schedule-board-'));
const server = await startServer(dir, await freePort(), 'first', { AGENT_TOKENS: 'true' });
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
  must(await call('PATCH', '/api/settings', { agents: true }), 'agents on');
  const mia = must(await call('POST', '/api/users', { login: 'mia', displayName: 'Mia Alvarez', role: 'member', password: PASSWORD }), 'mia').user;
  const agent = must(await call('POST', '/api/users', { agent: true }), 'agent').user;
  const inst = await call('POST', '/api/modules/bundled/schedule/install');
  if (inst.status >= 300 && !/already installed/.test(JSON.stringify(inst.json))) throw new Error(`install: ${JSON.stringify(inst.json)}`);
  must(await call('PATCH', '/api/modules/schedule', { enabled: true }), 'enable');
  const space = must(await call('POST', '/api/spaces', { name: 'Launch', starter: false, members: [mia.key, agent.key] }), 'space').space;
  const SP = space.id;
  must(await call('PUT', `/api/modules/schedule/settings/space?space=${SP}`, { values: { tags: [{ id: 'a', label: 'Alpha', icon: 'flag', color: '#3b82f6' }, { id: 'b', label: 'Beta', icon: 'flag', color: '#3b82f6' }, { id: 'c', label: 'Gamma', icon: 'flag', color: '#3b82f6' }] } }), 'settings');
  const put = async (id, value) => must(await call('PUT', `/api/modules/schedule/data/${encodeURIComponent(`plan:${id}`)}?scope=space&space=${SP}`, { value }), `put ${id}`);
  const read = async (id) => (await call('GET', `/api/modules/schedule/data/${encodeURIComponent(`plan:${id}`)}?scope=space&space=${SP}`)).json.item;
  const admin = (await call('GET', '/api/me')).json.user.key;
  await put('ms1', { kind: 'milestone', title: 'Launch day', start: '2026-10-30', order: 'a', by: admin });
  await put('w1', { kind: 'work', title: 'Write the brief', start: '2026-10-12', end: '2026-10-20', parent: 'ms1', owners: [admin], tags: ['a', 'b', 'c'], order: 'a', by: admin });
  await put('w2', { kind: 'work', title: 'Book the venue', start: '2026-10-01', end: '2026-10-10', parent: 'ms1', order: 'b', by: admin });
  await put('w3', { kind: 'work', title: 'Order shirts', order: 'c', by: admin });
  await put('w4', { kind: 'work', title: 'Print flyers', start: '2026-10-05', end: '2026-10-08', done: true, parent: 'ms1', order: 'd', by: admin });
  await put('w5', { kind: 'work', title: 'Pick the menu', start: '2026-10-21', end: '2026-10-25', waitsOn: ['w1'], order: 'e', by: admin });
  await put('n1', { kind: 'note', title: 'A loose note', order: 'f', by: admin });
  await login('mia');
  const tok = must(await call('POST', `/api/users/${agent.key}/token`), 'agent token').token;
  const refOf = (id) => ({ module: 'schedule', kind: 'plan', id, scope: 'space', space: SP });
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

  // ---- 1280: the view switch, the columns, the cards ----
  for (const mode of ['light', 'dark']) {
    tab = await open(1280, mode, 'admin');
    const tag = `1280 ${mode}`;
    ok(await viewSwitch(tab, 'Board'), `${tag}: the view switch has a Board`);
    await tab.waitFor(F + '.sdk-board-col');
    await sleep(500);
    same(await colLabels(tab), ['To do 4', 'Doing 0', 'Done 1'], `${tag}: the columns with their counts (a note and a milestone are not cards)`);
    same(await ev(tab, `${all('.sdk-board-card')}.length`), 5, `${tag}: five cards, all work`);
    const brief = await ev(tab, `${card('Write the brief')}.innerText`);
    ok(/Oct 20/.test(brief) && /Mia|Admin|admin/i.test(brief) || /Oct 20/.test(brief), `${tag}: the brief card says its end day: ${JSON.stringify(brief)}`);
    ok(/Alpha/.test(brief) && /Beta/.test(brief) && !/Gamma/.test(brief) && /and 1 more/.test(brief), `${tag}: up to two tags and "and 1 more": ${JSON.stringify(brief)}`);
    ok(/Launch day/.test(brief), `${tag}: the milestone it is under`);
    const venue = await ev(tab, `${card('Book the venue')}.innerText`);
    ok(/Late/.test(venue), `${tag}: Book the venue is Late: ${JSON.stringify(venue)}`);
    ok(/Waits on Write the brief/.test(await ev(tab, `${card('Pick the menu')}.innerText`)), `${tag}: Pick the menu waits on the brief`);
    ok(/No date/.test(await ev(tab, `${card('Order shirts')}.innerText`)), `${tag}: no date says so`);
    same(await ev(tab, `${all('.sdk-board-card')}.map((c) => c.textContent).filter((t) => /loose note/.test(t)).length`), 0, `${tag}: no note card`);
    // order inside a column: end day, none last
    same(await ev(tab, `${all('.sdk-board-col')}[0] ? __all(${JSON.stringify(F + '.sdk-board-col')})[0].querySelectorAll('.sdk-board-card').length : 0`), 4, `${tag}: four in To do`);
    const order = await ev(tab, `[...__all(${JSON.stringify(F + '.sdk-board-col')})[0].querySelectorAll('.sdk-board-card')].map((c) => c.textContent.match(/Book the venue|Write the brief|Pick the menu|Order shirts/)[0])`);
    same(order, ['Book the venue', 'Write the brief', 'Pick the menu', 'Order shirts'], `${tag}: by end day, no day last`);
    await shot(tab, `board-1280-${mode}`);
    await tab.close();
    tab = null;
  }

  {
    const mode = 'light';
    tab = await open(1280, mode, 'admin');
    const tag = `1280 ${mode}`;
    ok(await viewSwitch(tab, 'Board'), `${tag}: Board`);
    await tab.waitFor(F + '.sdk-board-col');
    await sleep(500);
    {
      // a move by the card's menu
      await openCardMenu(tab, 'Write the brief');
      await menuItem(tab, 'Move to Doing');
      if (process.env.DEBUG) { console.log(await ev(tab, `document.body.innerText.slice(0, 600)`)); console.log(await ev(tab, `${all('.sdk-board-live')}.map((x) => x.textContent)`)); await shot(tab, 'debug-menu'); }
      await waitFor(async () => (await colOf(tab, 'Write the brief')) === 'doing', `${tag}: the menu moves the card to Doing`);
      const s1 = await stored('w1');
      same([s1.column, s1.done], ['doing', false], `${tag}: stored column doing, not done`);
      // the List agrees
      ok(await viewSwitch(tab, 'List'), `${tag}: List`);
      await sleep(600);
      const line = await ev(tab, `${all('.line')}.find((l) => l.querySelector('.title').textContent === 'Write the brief').innerText`);
      ok(/Doing/.test(line), `${tag}: the List names the column under the title: ${JSON.stringify(line)}`);
      await shot(tab, `list-1280-${mode}`);
      // a tick in the List moves the card to Done; Launch day settles when all its work is done
      await ev(tab, `${all('.line')}.find((l) => l.querySelector('.title').textContent === 'Write the brief').querySelector('[data-action=tick]').click()`);
      await waitFor(async () => (await stored('w1')).column === 'done', `${tag}: the List's tick moves the work to the done column`);
      same((await stored('w1')).done, true, `${tag}: and it is done`);
      ok(await viewSwitch(tab, 'Board'), `${tag}: Board again`);
      await sleep(600);
      same(await colOf(tab, 'Write the brief'), 'done', `${tag}: the card is in Done`);
      // unticking from the List puts it in the first open column
      ok(await viewSwitch(tab, 'List'), 'List');
      await sleep(500);
      await ev(tab, `${all('.line')}.find((l) => l.querySelector('.title').textContent === 'Write the brief').querySelector('[data-action=tick]').click()`);
      await waitFor(async () => (await stored('w1')).done === false, `${tag}: untick`);
      same((await stored('w1')).column, 'todo', `${tag}: unticked work goes to the first open column`);
      // the editor's Done box is the tick too
      await ev(tab, `${all('.line')}.find((l) => l.querySelector('.title').textContent === 'Print flyers').querySelector('[data-action=open]').click()`);
      await tab.waitFor(F + '#f-done');
      await ev(tab, `(() => { const d = __all(${JSON.stringify(F + '#f-done')})[0]; d.click(); })()`);
      await ev(tab, `__all(${JSON.stringify(F + '#f-save')})[0].click()`);
      await waitFor(async () => (await stored('w4')).column === 'todo', `${tag}: the editor's Done box (unticked) moves the work out of Done`);
      same((await stored('w4')).done, false, `${tag}: and it is not done`);
      // put the board back: shirts and the brief to To do
      ok(await viewSwitch(tab, 'Board'), 'Board');
      await sleep(600);
      // a move by the keyboard: Alt+Right
      await ev(tab, `(() => { const c = ${card('Order shirts')}; c.scrollIntoView({ block: 'center' }); c.focus(); })()`);
      await tab.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, modifiers: 1 }, tab.sid);
      await tab.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, modifiers: 1 }, tab.sid);
      await waitFor(async () => (await colOf(tab, 'Order shirts')) === 'doing', `${tag}: Alt+Right moves it one column`);
      same((await stored('w3')).done, false, `${tag}: out of Done it is not done`);
      // a move by drag
      await ev(tab, `(() => {
        const c = ${card('Order shirts')}; const t = __all(${JSON.stringify(F + '.sdk-board-col')}).find((s) => s.dataset.col === 'todo');
        const dt = new DataTransfer(); const fire = (type, el) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
        fire('dragstart', c); fire('dragover', t); fire('drop', t); fire('dragend', c);
      })()`);
      await waitFor(async () => (await colOf(tab, 'Order shirts')) === 'todo', `${tag}: a drag moves it to To do`);
      same((await stored('w3')).column, 'todo', `${tag}: the drag is stored`);
      // "+" adds work in that column
      await ev(tab, `__all(${JSON.stringify(F + '.sdk-board-col')}).find((s) => s.dataset.col === 'doing').querySelector('.sdk-board-add').click()`);
      await tab.waitFor(F + '#f-title');
      await tab.typeInto(F + '#f-title', 'Brand new work');
      await ev(tab, `(() => { for (const [id, v] of [['#f-start', '2026-10-26'], ['#f-end', '2026-10-27']]) { const i = __all(${JSON.stringify(F)} + id)[0]; i.value = v; i.dispatchEvent(new Event('change', { bubbles: true })); } return 1; })()`);
      await ev(tab, `__all(${JSON.stringify(F + '#f-save')})[0].click()`);
      await waitFor(async () => (await colOf(tab, 'Brand new work')) === 'doing', `${tag}: "+" in Doing adds work in Doing`);
      // the column menu: Fold, then the module's editor items for an owner (check-schedule-board-editor.mjs drives them)
      await ev(tab, `__all(${JSON.stringify(F + '.sdk-board-col')})[1].querySelector('.sdk-board-colmore').click()`);
      await sleep(300);
      same(await ev(tab, `__all(${JSON.stringify(F + '[role=menuitem]')}).map((m) => m.textContent.trim())`), ['Fold', 'Rename', 'Move left', 'Move right', 'Counts as done', 'Colour', 'Delete'], `${tag}: the column menu for an owner`);
      await tab.key('Escape');
    }
    await tab.close();
    tab = null;
  }

  // ---- a member without `columns` moves cards; a board write is refused in the server's words ----
  must(await call('PUT', `/api/modules/schedule/data/${encodeURIComponent('plan:w2')}?scope=space&space=${SP}`, { value: { ...(await stored('w2')), column: 'todo' }, version: (await read('w2')).version }, 'mia'), 'mia may edit');
  const refused = await call('PUT', `/api/modules/schedule/data/${encodeURIComponent('board:main')}?scope=space&space=${SP}`, { value: { id: 'main', name: 'Board', field: 'column', columns: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', done: true }] } }, 'mia');
  same([refused.status, refused.json && refused.json.error], [403, "Your role can't do that in this module."], 'a member without columns: a board write is refused in the server\'s sentence');
  tab = await open(1280, 'light', 'mia');
  ok(await viewSwitch(tab, 'Board'), 'mia: Board');
  await tab.waitFor(F + '.sdk-board-col');
  await sleep(500);
  await openCardMenu(tab, 'Book the venue');
  await menuItem(tab, 'Move to Doing');
  await waitFor(async () => (await stored('w2')).column === 'doing', 'a member without columns still moves a card');
  await tab.close();
  tab = null;

  // ---- an agent's setColumn: on an open board, under What it changed, and Undo ----
  tab = await open(1280, 'light', 'admin');
  ok(await viewSwitch(tab, 'Board'), 'agent: Board');
  await tab.waitFor(F + '.sdk-board-col');
  await sleep(500);
  const asked = await call('POST', `/api/spaces/${SP}/action`, { action: 'schedule:setColumn', input: { ref: refOf('w5'), column: 'done' } }, '__', { authorization: `Bearer ${tok}` });
  same(asked.status, 200, `the agent's setColumn is carried out at once (${JSON.stringify(asked.json).slice(0, 200)})`);
  await waitFor(async () => (await colOf(tab, 'Pick the menu')) === 'done', 'the agent\'s move shows on the open board');
  await shot(tab, 'board-agent-move');
  const changes = (await call('GET', `/api/users/${agent.key}/changes`)).json;
  const list = Array.isArray(changes) ? changes : changes && (changes.changes || changes.items) || [];
  const mine = list.find((c) => JSON.stringify(c).includes('w5'));
  ok(Boolean(mine), `the agent's move is listed under What it changed (${JSON.stringify(changes).slice(0, 200)})`);
  if (mine) {
    const undone = await call('POST', `/api/users/${agent.key}/changes/${mine.id}/undo`);
    same(undone.status, 200, `Undo answers 200 (${JSON.stringify(undone.json).slice(0, 160)})`);
    await waitFor(async () => (await colOf(tab, 'Pick the menu')) === 'todo', 'Undo puts the card back on the open board');
    const w5 = (await stored('w5')) || {};
    same([w5.column || 'todo', Boolean(w5.done)], ['todo', false], 'and what is stored');
  }
  await tab.close();
  tab = null;

  // ---- the phone: stacked sections, done folded, no sideways scroll ----
  for (const mode of ['light', 'dark']) {
    tab = await open(390, mode, 'admin');
    const tag = `390 ${mode}`;
    ok(await viewSwitch(tab, 'Board'), `${tag}: Board`);
    await tab.waitFor(F + '.sdk-board-col');
    await sleep(500);
    const lay = await ev(tab, `(() => { const cols = __all(${JSON.stringify(F + '.sdk-board-col')}); const r = cols.map((c) => c.getBoundingClientRect()); const body = document.scrollingElement; return { stacked: r.every((x, i) => i === 0 || x.top > r[i - 1].top), same: r.every((x) => Math.abs(x.left - r[0].left) < 2), folded: cols.map((c) => c.classList.contains('is-folded')), draggable: __all(${JSON.stringify(F + '.sdk-board-card')}).some((c) => c.draggable), wide: body.scrollWidth > body.clientWidth + 1 }; })()`);
    ok(lay.stacked && lay.same, `${tag}: the columns stack`);
    same(lay.folded, [false, false, true], `${tag}: the done column is folded`);
    ok(lay.draggable, `${tag}: a card still drags when the board is stacked`);
    ok(!lay.wide, `${tag}: no sideways scroll`);
    await shot(tab, `board-390-${mode}`);
    if (mode === 'light') {
      await openCardMenu(tab, 'Order shirts');
      await menuItem(tab, 'Move to Doing');
      await waitFor(async () => (await stored('w3')).column === 'doing', `${tag}: a card moves by its menu on a phone`);
    }
    await tab.close();
    tab = null;
  }

  // ---- the Gaming template's columns, and "Opens on" ----
  must(await call('PUT', `/api/modules/schedule/settings/space?space=${SP}`, { values: { boardColumns: 'priority', defaultView: 'board' } }), 'settings');
  tab = await open(1280, 'light', 'admin');
  await tab.waitFor(F + '.sdk-board-col');
  await sleep(500);
  same((await colLabels(tab)).map((s) => s.replace(/ \d+$/, '')), ['Inbox', 'Now', 'Next', 'Later', 'Done'], '"Opens on" Board shows Inbox, Now, Next, Later, Done');
  await shot(tab, 'board-priority-1280');
  await tab.close();
  tab = null;

  // The Gaming template sets boardColumns: priority (templates/games.json), so a new space there opens on those columns.
  must(await call('PATCH', '/api/settings', { template: 'games' }), 'the games template');
  const camp = must(await call('POST', '/api/spaces', { name: 'Campaign', starter: false }), 'a games space').space;
  const vals = await call('GET', `/api/modules/schedule/settings/values?space=${camp.id}`);
  ok(JSON.stringify(vals.json).includes('"boardColumns":"priority"'), `a space from the Gaming template has boardColumns priority (${JSON.stringify(vals.json).slice(0, 240)})`);
} catch (err) {
  problems.push(`the run stopped: ${err && err.stack || err}`);
} finally {
  if (tab) await tab.close().catch(() => {});
  if (browser) await stopBrowser(browser.child, browser.dir).catch(() => {});
  await stopServer(server);
  fs.rmSync(dir, { recursive: true, force: true });
}
if (problems.length) { console.error(`check-schedule-board: ${problems.length} problem(s) in ${n} checks`); for (const p of problems) console.error(`  - ${p}`); process.exit(1); }
say(`${n} checks pass`);
