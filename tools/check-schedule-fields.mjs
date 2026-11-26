#!/usr/bin/env node
/*
 * check-schedule-fields.mjs -- Planner - Projects' fields, live (documentation/plans/plan-github-two-way.md, build order step 6).
 *
 * Two throwaway servers (their own DATA_DIR and port, stopped at the end), then headless Chromium at 1280 and 390 wide, light and dark
 * (the page's own mode switch):
 *   1. An ordinary space with the `project` template, an owner and a member (who has `edit` but not `columns`):
 *      - Edit fields (only with `columns`): add a field and its choices, one write for each record, Undo takes them back;
 *      - the editor's choice for each field, saved on the work; the card's quiet words, the List's columns;
 *      - the Filters: a group for each field (a choice, No ..., Every ...), the count, "Showing 1 of 5";
 *      - the Board's rows by a field in the field's order, `rowsBy` stored, the no-row row last, Undo;
 *      - a choice deleted in Edit fields takes its value off the work that had it, with Undo;
 *      - Update by id: Check file, the confirmation, only the space's own fields written (a title, a column untouched), an id the plan
 *        does not have skipped, Undo; a file that names a title refused;
 *      - a member sets a choice and has no Edit fields.
 *   2. A space that follows a repository on a stand-in for GitHub (ISSUES_TEST_STANDIN) with writing back on: defining a field and setting
 *      a choice make no request to the stand-in at all, the editor says the fields stay here, the rows by a field are this person's own
 *      (no board record is written), and pulled work can be Late.
 * No request is made to GitHub: the stand-in is a local server. With no Chromium it says SKIPPED and exits 0 (a skip, never a pass).
 * SHOTS=<folder> keeps a screenshot of each screen. Usage: node tools/check-schedule-fields.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { launch, Tab, startServer, stopServer, freePort, findBrowser, sleep } from './shots.mjs';
import { stopBrowser } from './browser-launch.mjs';

const say = (...a) => console.log('check-schedule-fields:', ...a);
let n = 0;
const problems = [];
const ok = (cond, msg) => { n += 1; if (!cond) problems.push(msg); };
const same = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const bin = findBrowser();
if (!bin) { say('SKIPPED: no Chromium (set CHROME_PATH). This is a skip, not a pass.'); process.exit(0); }
const SHOTS = process.env.SHOTS ? path.resolve(process.env.SHOTS) : '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const PASSWORD = 'testpass1234';
const REPO = 'o/r';
const TOKEN = 'ghp_checkfieldstoken0123456789abcdef';

// ---- a small stand-in for GitHub: a list of issues, every request kept ----
const seen = [];
const issues = [
  { number: 1, title: 'Server: slow start', state: 'open', labels: [{ name: 'priority: now' }], created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-03T00:00:00Z' },
  { number: 2, title: 'Chat: no sound', state: 'open', labels: [], created_at: '2026-01-04T00:00:00Z', updated_at: '2026-01-05T00:00:00Z' },
  { number: 3, title: 'Nothing like an area', state: 'closed', labels: [], created_at: '2026-01-06T00:00:00Z', closed_at: '2026-01-07T00:00:00Z', updated_at: '2026-01-07T00:00:00Z' },
].map((i) => ({ closed_at: null, milestone: null, body: 'private', user: { login: 'someone' }, assignees: [], html_url: `https://github.com/${REPO}/issues/${i.number}`, ...i }));
const fake = http.createServer((req, res) => {
  seen.push({ method: req.method, url: req.url });
  req.resume();
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(/\/issues(\?|$)/.test(req.url) ? JSON.stringify(issues) : '[]');
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));

const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'check-schedule-fields-a-'));
const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'check-schedule-fields-b-'));
const serverA = await startServer(dirA, await freePort(), 'first', {});
const serverB = await startServer(dirB, await freePort(), 'first', { ISSUES_TEST_STANDIN: `http://127.0.0.1:${fake.address().port}`, ISSUES_GITHUB_TOKEN: TOKEN, ISSUES_GITHUB_WRITE: REPO, ISSUES_TEST_GAP_MS: '500' });

const jars = new Map();
function api(server) {
  const jar = {};
  jars.set(server, jar);
  const call = async (method, url, body, as = 'admin') => {
    const headers = { 'content-type': 'application/json', accept: 'application/json' };
    if (jar[as]) headers.cookie = jar[as];
    const r = await fetch(server.base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await r.json(); } catch { /* none */ }
    return { status: r.status, json, res: r };
  };
  const login = async (l) => { const r = await call('POST', '/api/login', { login: l, password: PASSWORD }, '__'); if (r.status !== 200) throw new Error(`cannot sign in as ${l}`); jar[l] = r.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '); };
  const must = (r, what) => { if (r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.json)}`); return r.json; };
  return { call, login, must, jar };
}

let browser = null;
let tab = null;
try {
  const A = api(serverA);
  const B = api(serverB);
  const F = '#module-frame >>> ';
  const ev = (t, expr) => t.eval(expr);
  const all = (sel) => `__all(${JSON.stringify(F + sel)})`;
  const waitFor = async (fn, msg, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(150); } ok(false, msg); return false; };
  const shot = async (t, name) => { if (!SHOTS) return; fs.writeFileSync(path.join(SHOTS, `${name}.png`), await t.shoot()); };

  // ================= world A: an ordinary space =================
  await A.login('admin');
  A.must(await A.call('PATCH', '/api/settings', { template: 'project' }), 'template');
  const mia = A.must(await A.call('POST', '/api/users', { login: 'mia', displayName: 'Mia Alvarez', role: 'member', password: PASSWORD }), 'mia').user;
  const inst = await A.call('POST', '/api/modules/bundled/schedule/install');
  if (inst.status >= 300 && !/already installed/.test(JSON.stringify(inst.json))) throw new Error(`install: ${JSON.stringify(inst.json)}`);
  A.must(await A.call('PATCH', '/api/modules/schedule', { enabled: true }), 'enable');
  const SP = A.must(await A.call('POST', '/api/spaces', { name: 'Launch', starter: false, members: [mia.key] }), 'space').space.id;
  const key = (k) => encodeURIComponent(k);
  const put = async (k, value, as = 'admin') => A.call('PUT', `/api/modules/schedule/data/${key(k)}?scope=space&space=${SP}`, { value }, as);
  const read = async (k, as = 'admin') => (await A.call('GET', `/api/modules/schedule/data/${key(k)}?scope=space&space=${SP}`, undefined, as));
  const stored = async (id) => ((await read(`plan:${id}`)).json.item || {}).value;
  const record = async (id) => ((await read(`field:${id}`)).json.item || {}).value;
  const admin = (await A.call('GET', '/api/me')).json.user.key;
  const W = { start: '2026-10-12', end: '2026-10-20', by: admin };
  for (const [id, v] of Object.entries({
    w1: { kind: 'work', title: 'Write the brief', ...W, order: 'a' },
    w2: { kind: 'work', title: 'Book the venue', ...W, column: 'doing', order: 'b' },
    w3: { kind: 'work', title: 'Order cake', ...W, order: 'c' },
    w4: { kind: 'work', title: 'Print flyers', ...W, done: true, column: 'done', order: 'd' },
    w5: { kind: 'work', title: 'Hire a band', ...W, order: 'e' },
  })) A.must(await put(`plan:${id}`, v), `put ${id}`);
  await A.login('mia');

  const b = await launch(bin);
  browser = b;
  const open = async (server, jar, width, mode, as, space, view) => {
    const t = new Tab(b.cdp, null);
    await t.open(width, mode);
    for (const pair of jar[as].split('; ')) { const i = pair.indexOf('='); await t.cdp.send('Network.setCookie', { name: pair.slice(0, i), value: pair.slice(i + 1), url: server.base, httpOnly: true }, t.sid); }
    await t.cdp.send('Page.navigate', { url: `${server.base}/modules/schedule?space=${space}` }, t.sid);
    await t.waitFor('#module-frame >>> #app');
    await t.settle();
    await sleep(600);
    await t.forceMode();
    if (view) {
      ok(await t.eval(`(() => { const e = __all('[role=radio]').find((x) => (x.getAttribute('aria-label') || x.textContent).includes(${JSON.stringify(view)})); if (!e) return false; e.click(); return true; })()`), `${as} ${width} ${mode}: the ${view} view`);
      await sleep(700);
    }
    return t;
  };
  const card = (title) => `${all('.sdk-board-card')}.find((c) => { const t = c.querySelector('.bd-title'); return t && t.textContent.replace(/^#\\d+\\s*/, '') === ${JSON.stringify(title)}; })`;
  const shown = (t) => ev(t, `${all('.sdk-board-card .bd-title')}.map((x) => x.textContent).sort()`);
  const rowsLabels = (t) => ev(t, `${all('.sdk-board-row')}.map((r) => r.querySelector('.sdk-board-label').textContent + ' ' + r.querySelector('.sdk-board-count').textContent)`);
  const cardFields = (t, title) => ev(t, `(() => { const c = ${card(title)}; return c ? [...c.querySelectorAll('.bd-field')].map((x) => x.textContent + (x.title ? ' (' + x.title + ')' : '')) : null; })()`);
  const visible = (t, sel) => ev(t, `(() => { const e = ${all(sel)}[0]; return Boolean(e && !e.hidden && e.getClientRects().length); })()`);
  const click = (t, sel) => ev(t, `(() => { const e = ${all(sel)}[0]; if (!e) return false; e.click(); return true; })()`);
  const setValue = (t, sel, v, type = 'input') => ev(t, `(() => { const e = ${all(sel)}[0]; if (!e) return false; e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event(${JSON.stringify(type)}, { bubbles: true })); if (${JSON.stringify(type)} === 'input') e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  const filtersOpen = async (t) => { await t.click('.mf-filters'); await sleep(350); };
  const filterPick = async (t, text) => {
    const hit = await ev(t, `(() => { const m = [...document.querySelectorAll('[role^=menuitem]')].find((x) => x.textContent.trim().replace(/\\d+$/, '') === ${JSON.stringify(text)}); if (!m) return false; m.click(); return true; })()`);
    ok(hit, `the Filters menu has "${text}"`);
    await sleep(450);
  };
  const menuText = (t) => ev(t, `[...document.querySelectorAll('[role^=menuitem]')].map((x) => x.textContent.trim().replace(/\\d+$/, ''))`);
  const statusText = (t) => ev(t, 'document.body.innerText');
  const clickUndo = async (t) => { await click(t, '#undo-btn'); await sleep(900); };
  const fieldsOpen = async (t) => { await click(t, '#fields-edit'); await waitFor(() => visible(t, '#fields-editor'), 'Edit fields opens'); await sleep(300); };
  const addField = async (t, name) => { await setValue(t, '#fields-new', name); await click(t, '#fields-new-go'); await sleep(250); };
  const addChoice = async (t, fieldId, text) => { await setValue(t, `[data-focus="a:${fieldId}"]`, text); await ev(t, `${all(`[data-focus="a:${fieldId}"]`)}[0].parentElement.querySelector('button').click()`); await sleep(200); };
  const fieldsSave = async (t) => { await click(t, '#fields-save'); await sleep(900); };
  const dragCardMenu = async (t, title, text) => {
    await ev(t, `(() => { const c = ${card(title)}; c.scrollIntoView({ block: 'center' }); c.querySelector('.sdk-board-more').click(); })()`);
    await sleep(300);
    await ev(t, `(() => { const m = [...__all(${JSON.stringify(F + '[role=menuitem]')})].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (m) m.click(); return !!m; })()`);
    await sleep(500);
  };
  const editorOpen = async (t, title) => { await ev(t, `(() => { const c = ${card(title)}; c.scrollIntoView({ block: 'center' }); c.click(); })()`); await t.waitFor(F + '#f-title'); await sleep(300); };
  const editorSave = async (t) => { await click(t, '#f-save'); await sleep(900); };
  const pickChoice = (t, fieldId, optionId) => ev(t, `(() => { const s = ${all(`#f-fields select[data-field="${fieldId}"]`)}[0]; if (!s) return false; s.value = ${JSON.stringify(optionId)}; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);

  // ---- 1280 light: Edit fields, the editor, the card, the List ----
  tab = await open(serverA, A.jar, 1280, 'light', 'admin', SP, 'Board');
  ok(await visible(tab, '#fields-edit'), 'the owner has Edit fields');
  await fieldsOpen(tab);
  same(await ev(tab, `${all('#fields-note')}[0].textContent`), 'No fields yet.', 'an empty plan says so');
  await addField(tab, 'Step');
  await addChoice(tab, 'step', 'One');
  await addChoice(tab, 'step', 'Two');
  await addChoice(tab, 'step', 'Three');
  await addField(tab, 'Area');
  await addChoice(tab, 'area', 'Core');
  await addChoice(tab, 'area', 'Planner');
  same(await ev(tab, `${all('.fe-field')}.map((f) => f.getAttribute('aria-label'))`), ['Step', 'Area'], 'two fields in the editor');
  await shot(tab, 'fields-1280-light-editor');
  await fieldsSave(tab);
  same((await record('step')), { id: 'step', label: 'Step', options: [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }, { id: 'three', label: 'Three' }], order: 0 }, 'field:step is stored');
  same((await record('area')).order, 1, 'Area comes second');
  ok(await visible(tab, '#undo'), 'Undo is offered');
  await clickUndo(tab);
  same([(await read('field:step')).status, (await read('field:area')).status], [404, 404], 'Undo takes both fields away');
  // the same again, through the data route as the owner, so the rest has fields to use
  A.must(await put('field:step', { id: 'step', label: 'Step', order: 0, options: [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }, { id: 'three', label: 'Three' }] }), 'step');
  A.must(await put('field:area', { id: 'area', label: 'Area', order: 1, options: [{ id: 'core', label: 'Core' }, { id: 'planner', label: 'Planner' }] }), 'area');
  await sleep(900);
  ok(await visible(tab, '#rows-field'), 'rows by a field appear once there are fields');
  await tab.close();
  tab = null;

  // the editor and the card
  tab = await open(serverA, A.jar, 1280, 'light', 'admin', SP, 'Board');
  await editorOpen(tab, 'Write the brief');
  same(await ev(tab, `${all('#f-fields .sdk-label')}.map((x) => x.textContent)`), ['Step', 'Area'], 'the editor has a choice for each field');
  same(await ev(tab, `${all('#f-fields select[data-field="step"] option')}.map((o) => o.textContent)`), ['No step', 'One', 'Two', 'Three'], 'the choices, and none');
  ok(await pickChoice(tab, 'step', 'one'), 'Step One');
  ok(await pickChoice(tab, 'area', 'core'), 'Area Core');
  await shot(tab, 'fields-1280-light-work');
  await editorSave(tab);
  same((await stored('w1')).fields, { step: 'one', area: 'core' }, 'saved on the work');
  await waitFor(async () => (await cardFields(tab, 'Write the brief') || []).length === 2, 'the card shows both');
  same(await cardFields(tab, 'Write the brief'), ['One (Step)', 'Core (Area)'], 'the card shows its choices in the fields\' order');
  same(await cardFields(tab, 'Book the venue'), [], 'a card with none shows nothing');
  A.must(await put('plan:w2', { ...(await stored('w2')), fields: { step: 'two' } }), 'w2 step two');
  A.must(await put('plan:w3', { ...(await stored('w3')), fields: { step: 'two', area: 'planner' } }), 'w3');
  await sleep(800);
  await tab.close();
  tab = null;

  // ---- 1280 dark: the Filters, the rows ----
  tab = await open(serverA, A.jar, 1280, 'dark', 'admin', SP, 'Board');
  await filtersOpen(tab);
  const menu = await menuText(tab);
  for (const w of ['Every step', 'One', 'Two', 'Three', 'No step', 'Every area', 'Core', 'Planner', 'No area']) ok(menu.includes(w), `the Filters menu has "${w}": ${JSON.stringify(menu)}`);
  await filterPick(tab, 'Two');
  same(await shown(tab), ['Book the venue', 'Order cake'], 'a Step filter');
  ok((await statusText(tab)).includes('Showing 2 of 5 pieces of work'), 'the status bar says "Showing 2 of 5 pieces of work"');
  await filterPick(tab, 'Planner');
  same(await shown(tab), ['Order cake'], 'fields combine with and');
  await filterPick(tab, 'No area');
  same(await shown(tab), ['Book the venue'], 'No area, within Step Two');
  await filterPick(tab, 'Every step');
  await filterPick(tab, 'Every area');
  same((await shown(tab)).length, 5, 'every choice again: all five');
  await filterPick(tab, 'No step');
  same(await shown(tab), ['Hire a band', 'Print flyers'], 'No step');
  await filterPick(tab, 'Every step');
  await tab.key('Escape');
  await shot(tab, 'fields-1280-dark-filters');
  // rows by a field
  await setValue(tab, '#rows-field', 'field:step', 'change');
  await waitFor(async () => ((await read('board:main')).json.item || {}).value && (await read('board:main')).json.item.value.rowsBy === 'field:step', 'rows by Step are stored');
  await sleep(600);
  same(await rowsLabels(tab), ['One 1', 'Two 2', 'No step 2'], 'a row for each choice that has work, in the field\'s order, then the no-row row');
  same(await ev(tab, `${all('#rows-field')}[0].value`), 'field:step', 'the pick shows it');
  await shot(tab, 'fields-1280-dark-rows');
  await clickUndo(tab);
  same((await read('board:main')).status, 404, 'Undo takes the stored board away');
  same(await rowsLabels(tab), [], 'and the rows go');
  await tab.close();
  tab = null;

  // ---- the List: a column for each field ----
  tab = await open(serverA, A.jar, 1280, 'light', 'admin', SP, 'List');
  same(await ev(tab, `${all('.line')}.filter((l) => l.dataset.kind === 'work').slice(0, 1).map((l) => l.querySelectorAll('.fcell').length)`), [2], 'two cells for each line');
  same(await ev(tab, `${all('.fcell')}.map((x) => x.textContent).filter(Boolean).sort()`), ['Core', 'One', 'Planner', 'Two', 'Two'], 'the choices are in the cells');
  await shot(tab, 'fields-1280-light-list');
  await tab.close();
  tab = null;

  // ---- a choice deleted takes its value off the work, with Undo ----
  tab = await open(serverA, A.jar, 1280, 'light', 'admin', SP, 'Board');
  await fieldsOpen(tab);
  await ev(tab, `${all('button[aria-label="Delete the choice Two"]')}[0].click()`);
  await sleep(300);
  ok((await ev(tab, `${all('#fields-note')}[0].textContent`)).includes('takes a choice off 2 pieces of work'), 'the window says how much work loses a choice');
  await fieldsSave(tab);
  same([(await stored('w2')).fields, (await stored('w3')).fields, (await stored('w1')).fields], [undefined, { area: 'planner' }, { step: 'one', area: 'core' }], 'only the work that had it lost it');
  same((await record('step')).options.map((o) => o.id), ['one', 'three'], 'and the choice is gone');
  await clickUndo(tab);
  same([(await stored('w2')).fields, (await stored('w3')).fields], [{ step: 'two' }, { step: 'two', area: 'planner' }], 'Undo puts the choice and the work back');
  same((await record('step')).options.map((o) => o.id), ['one', 'two', 'three'], 'and the choice');
  await tab.close();
  tab = null;

  // ---- Update by id ----
  tab = await open(serverA, A.jar, 1280, 'light', 'admin', SP, 'Board');
  await tab.eval(`(() => { window.__file = null; HTMLInputElement.prototype.click = function () { if (this.type !== 'file' || !window.__file) return; const dt = new DataTransfer(); dt.items.add(new File([window.__file], 'update.json', { type: 'application/json' })); Object.defineProperty(this, 'files', { value: dt.files, configurable: true }); this.dispatchEvent(new Event('change')); }; return 1; })()`);
  const sendFile = async (t, text, item) => {
    await t.eval(`window.__file = ${JSON.stringify(text)}`);
    await t.click('button', 'Export and import');
    await sleep(350);
    await ev(t, `(() => { const m = [...document.querySelectorAll('[role=menuitem]'), ...__all(${JSON.stringify(F + '[role=menuitem]')})].find((x) => x.textContent.trim() === ${JSON.stringify(item)}); if (m) m.click(); return !!m; })()`);
    await sleep(900);
  };
  const dialogText = (t) => ev(t, `(() => { const d = [...document.querySelectorAll('dialog[open]'), ...__all(${JSON.stringify(F + 'dialog[open]')})].filter((x) => x.id !== 'editor')[0]; return d ? d.textContent.replace(/\\s+/g, ' ').trim() : ''; })()`);
  const dialogDo = async (t, text) => { await ev(t, `(() => { const ds = [...document.querySelectorAll('dialog[open]'), ...__all(${JSON.stringify(F + 'dialog[open]')})]; for (const d of ds) { const b = [...d.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)}); if (b) { b.click(); return true; } } return false; })()`); await sleep(900); };
  const upd = { format: 'project-plan', version: 1, entries: [{ id: 'w2', fields: { step: 'three', area: 'core' }, end: '2026-10-25' }, { id: 'w5', fields: { step: 'one' } }, { id: 'nope', fields: { step: 'one' } }] };
  const before = { w2: await stored('w2'), w5: await stored('w5') };
  await sendFile(tab, JSON.stringify(upd), 'Check file');
  if (process.env.DEBUG) console.log('DEBUG menu/dialog', JSON.stringify(await ev(tab, `[document.querySelectorAll('dialog[open]').length, [...document.querySelectorAll('[role=menuitem]')].map((x) => x.textContent.trim()), [...document.querySelectorAll('dialog')].map((d) => d.open + ':' + d.textContent.trim().slice(0, 80))]`)));
  const checked = await dialogText(tab);
  ok(/Update by id would change 2 entries/.test(checked) && /1 is not in the plan/.test(checked), `Check file reads it: ${checked}`);
  await dialogDo(tab, 'Close');
  same(await stored('w2'), before.w2, 'Check file wrote nothing');
  await sendFile(tab, JSON.stringify(upd), 'Import JSON: update by id');
  const ask = await dialogText(tab);
  ok(/Update 2 entries by id\?/.test(ask) && /only the fields, days/.test(ask) && /1 entry is not in the plan and is skipped/.test(ask), `the confirmation: ${ask}`);
  await shot(tab, 'fields-1280-light-update');
  await dialogDo(tab, 'Update by id');
  const w2 = await stored('w2');
  same([w2.fields, w2.end, w2.title, w2.column, w2.start], [{ step: 'three', area: 'core' }, '2026-10-25', before.w2.title, 'doing', before.w2.start], 'only the fields and the end changed; the title and column did not');
  same((await stored('w5')).fields, { step: 'one' }, 'the other entry too');
  same((await read('plan:nope')).status, 404, 'an id the plan does not have is skipped, not made');
  ok(await visible(tab, '#undo'), 'Undo is offered');
  await clickUndo(tab);
  same([(await stored('w2')).fields, (await stored('w2')).end, (await stored('w5')).fields], [{ step: 'two' }, '2026-10-20', undefined], 'Undo puts them back');
  await sendFile(tab, JSON.stringify({ ...upd, entries: [{ id: 'w2', title: 'New title', fields: { step: 'one' } }] }), 'Import JSON: update by id');
  await sleep(500);
  same((await stored('w2')).title, 'Book the venue', 'a file that names a title changes nothing');
  ok((await ev(tab, `[...document.querySelectorAll('.sdk-toast')].map((x) => x.textContent).join(' ')`)).includes('does not change "title"'), 'and says why');
  await tab.close();
  tab = null;

  // ---- a member: sets a choice, has no Edit fields ----
  tab = await open(serverA, A.jar, 1280, 'light', 'mia', SP, 'Board');
  ok(!(await visible(tab, '#fields-edit')), 'a member has no Edit fields');
  await editorOpen(tab, 'Hire a band');
  ok(await pickChoice(tab, 'step', 'three'), 'a member picks a choice');
  await editorSave(tab);
  same((await stored('w5')).fields, { step: 'three' }, 'and it is saved');
  same((await put('field:evil', { id: 'evil', label: 'Evil', options: [] }, 'mia')).status, 403, 'a forced field write is refused');
  await tab.close();
  tab = null;

  // ---- 390 wide, dark: the editor and the fields window on a phone ----
  tab = await open(serverA, A.jar, 390, 'dark', 'admin', SP, 'Board');
  const bar = await ev(tab, `(() => { const r = ${all('#fields-edit')}[0].getBoundingClientRect(); return { edit: [r.height, r.width], wide: document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth + 1 }; })()`);
  ok(bar.edit[0] >= 44, `Edit fields is a 44 px target at 390: ${bar.edit}`);
  ok(!bar.wide, 'no sideways scroll at 390');
  await fieldsOpen(tab);
  const sizes = await ev(tab, `(() => { const d = ${all('#fields-editor')}[0].getBoundingClientRect(); const bs = ${all('.fe-row .btn, .fe-add .btn')}.map((b) => Math.round(b.getBoundingClientRect().height)); return { w: d.width, bs }; })()`);
  ok(sizes.w <= 390, `the fields window fits the phone: ${sizes.w}`);
  ok(sizes.bs.length > 4 && sizes.bs.every((h) => h >= 44), `every button in it is a 44 px target: ${sizes.bs}`);
  await shot(tab, 'fields-390-dark-editor');
  await click(tab, '#fields-cancel');
  await sleep(400);
  if (process.env.DEBUG) console.log('DEBUG 390', JSON.stringify(await ev(tab, `[${all('.sdk-board-card')}.length, ${all('.sdk-board-col')}.map((c) => c.dataset.col + ':' + c.querySelectorAll('.sdk-board-card').length + ':' + c.className)]`)));
  await editorOpen(tab, 'Write the brief');
  ok(await visible(tab, '#f-fields select[data-field="step"]'), 'the editor has the choices on a phone');
  await shot(tab, 'fields-390-dark-work');
  await tab.switchMode('light');
  await shot(tab, 'fields-390-light-work');
  await tab.close();
  tab = null;

  // ================= world B: a followed repository, writing back on =================
  await B.login('admin');
  const instB = await B.call('POST', '/api/modules/bundled/schedule/install');
  if (instB.status >= 300 && !/already installed/.test(JSON.stringify(instB.json))) throw new Error(`install: ${JSON.stringify(instB.json)}`);
  B.must(await B.call('PATCH', '/api/modules/schedule', { enabled: true, allSpaces: true }), 'enable');
  const SB = B.must(await B.call('POST', '/api/spaces', { name: 'Bug Squash', starter: false }), 'space').space.id;
  B.must(await B.call('PUT', '/api/weather/terms/issues-standin', { accept: true }), 'terms');
  B.must(await B.call('PUT', `/api/spaces/${SB}/issues-pull`, { on: true, repo: REPO, provider: 'issues-standin' }), 'follow');
  const gotPulled = async () => { for (let i = 0; i < 60; i += 1) { const l = (await B.call('GET', `/api/modules/schedule/data?scope=space&space=${SB}`)).json.items.filter((x) => x.key.startsWith('plan:gh-')); if (l.length >= 3) return true; await B.call('POST', `/api/spaces/${SB}/issues-pull/now`, {}); await sleep(700); } return false; };
  ok(await gotPulled(), 'the three issues are pulled');
  B.must(await B.call('PUT', `/api/spaces/${SB}/issues-pull`, { write: true }), 'writing on');
  const putB = (k, value) => B.call('PUT', `/api/modules/schedule/data/${key(k)}?scope=space&space=${SB}`, { value });
  const planB = async (id) => ((await B.call('GET', `/api/modules/schedule/data/${key(`plan:${id}`)}?scope=space&space=${SB}`)).json.item || {}).value;
  B.must(await putB('field:area', { id: 'area', label: 'Area', order: 0, options: [{ id: 'server', label: 'Server' }, { id: 'chat', label: 'Chat' }] }), 'Area, defined in a followed plan');
  const requests = seen.length;

  tab = await open(serverB, B.jar, 1280, 'light', 'admin', SB, 'Board');
  ok(await visible(tab, '#fields-edit'), 'a followed plan has Edit fields');
  await fieldsOpen(tab);
  await addField(tab, 'Phase');
  await addChoice(tab, 'phase', 'First');
  await addChoice(tab, 'phase', 'After first release (Thomas, 2026-11-15)');
  await fieldsSave(tab);
  same(((await B.call('GET', `/api/modules/schedule/data/${key('field:phase')}?scope=space&space=${SB}`)).json.item || {}).value.options.map((o) => o.label), ['First', 'After first release (Thomas, 2026-11-15)'], 'a field is defined in a followed plan, a 40-character choice too');
  await editorOpen(tab, 'Chat: no sound');
  ok((await ev(tab, `${all('#f-readonly')}[0].textContent`)).includes('The title, '), 'the editor says what changes on GitHub');
  ok((await ev(tab, `${all('#f-readonly')}[0].textContent`)).includes('The fields stay here.'), 'and that the fields stay here');
  same(await ev(tab, `${all('#f-fields select')}.map((s) => s.disabled)`), [false, false], 'the choices can be set');
  same(await ev(tab, `${all('#f-notes')}[0].disabled`), true, 'the rest stays GitHub\'s');
  ok(await pickChoice(tab, 'area', 'chat'), 'Area Chat');
  ok(await pickChoice(tab, 'phase', 'first'), 'Phase First');
  await shot(tab, 'fields-1280-light-followed-editor');
  await editorSave(tab);
  same((await planB('gh-2')).fields, { area: 'chat', phase: 'first' }, 'a choice on pulled work is saved');
  same(seen.length, requests, 'defining fields and setting a choice made no request to the stand-in');
  // Area from the title, once: the first pull made gh-1 before Area existed; new work from a pull after it
  issues.push({ number: 4, title: 'Server: fresh', state: 'open', labels: [], created_at: '2026-01-08T00:00:00Z', updated_at: '2026-11-20T00:00:00Z', closed_at: null, milestone: null, body: '', user: { login: 'x' }, assignees: [], html_url: `https://github.com/${REPO}/issues/4` });
  await sleep(700);
  B.must(await B.call('POST', `/api/spaces/${SB}/issues-pull/now`, {}), 'pull now');
  await waitFor(async () => (await planB('gh-4')) !== undefined, 'the new issue is pulled', 9000);
  same((await planB('gh-4')).fields, { area: 'server' }, 'new work takes its Area from the title');
  same((await planB('gh-1')).fields, undefined, 'work from before Area existed is not given one later');
  same(seen.slice(requests).filter((x) => x.method !== 'GET').length, 0, 'nothing but reads reached the stand-in');
  await tab.close();
  tab = null;

  // rows by a field in a followed plan: this person's own, no board record
  tab = await open(serverB, B.jar, 1280, 'dark', 'admin', SB, 'Board');
  await setValue(tab, '#rows-field', 'field:area', 'change');
  await sleep(800);
  same((await rowsLabels(tab)).map((r) => r.replace(/ \d+$/, '')), ['Server', 'Chat', 'No area'], 'rows by Area in the field\'s order');
  same((await B.call('GET', `/api/modules/schedule/data/${key('board:main')}?scope=space&space=${SB}`)).json.item.value.rowsBy, undefined, 'the pull\'s board is not changed');
  same(await ev(tab, `localStorage.getItem('schedule-rows:${SB}')`), 'field:area', 'the choice is kept in this browser');
  await shot(tab, 'fields-1280-dark-followed-rows');
  // a followed plan's days are the space's own, so work can be late
  B.must(await putB('plan:gh-1', { ...(await planB('gh-1')), start: '2026-01-01', end: '2026-01-02' }), 'days');
  await tab.close();
  tab = await open(serverB, B.jar, 1280, 'light', 'admin', SB, 'List');
  ok((await ev(tab, `${all('.line')}.filter((l) => l.classList.contains('late')).length`)) >= 1, 'pulled work with a past end day shows Late');
  await shot(tab, 'fields-1280-light-followed-list');
  await tab.close();
  tab = null;

  // Update by id on a followed plan with writing off: the space's own fields go in, a title is not read, nothing reaches GitHub
  B.must(await B.call('PUT', `/api/spaces/${SB}/issues-pull`, { write: false }), 'writing off');
  tab = await open(serverB, B.jar, 1280, 'light', 'admin', SB, 'Board');
  await tab.eval(`(() => { window.__file = null; HTMLInputElement.prototype.click = function () { if (this.type !== 'file' || !window.__file) return; const dt = new DataTransfer(); dt.items.add(new File([window.__file], 'update.json', { type: 'application/json' })); Object.defineProperty(this, 'files', { value: dt.files, configurable: true }); this.dispatchEvent(new Event('change')); }; return 1; })()`);
  const titleOff = (await planB('gh-2')).title;
  const asked = seen.length;
  await sendFile(tab, JSON.stringify({ format: 'project-plan', version: 1, entries: [{ id: 'gh-2', fields: { area: 'server', phase: 'first' }, start: '2026-12-01', end: '2026-12-09' }, { id: 'gh-999', fields: { area: 'chat' } }] }), 'Import JSON: update by id');
  ok(/Update 1 entry by id\?/.test(await dialogText(tab)), 'the confirmation on a followed plan');
  await dialogDo(tab, 'Update by id');
  const g2 = await planB('gh-2');
  same([g2.fields, g2.start, g2.end, g2.title], [{ area: 'server', phase: 'first' }, '2026-12-01', '2026-12-09', titleOff], 'Update by id on a followed plan with writing off sets the own fields and days, not the title');
  same(seen.length, asked, 'and asks nothing of GitHub');
  await tab.close();
  tab = null;

  // 390 dark, followed
  tab = await open(serverB, B.jar, 390, 'dark', 'admin', SB, 'Board');
  ok(await visible(tab, '#fields-edit'), 'Edit fields at 390 in a followed plan');
  await editorOpen(tab, 'Chat: no sound');
  ok(await visible(tab, '#f-fields select[data-field="area"]'), 'the choices are there at 390');
  await shot(tab, 'fields-390-dark-followed-work');
  await tab.close();
  tab = null;
  same(seen.filter((x) => x.method !== 'GET').length, 0, 'in the whole run the stand-in saw only reads');
} catch (err) {
  problems.push(`the run stopped: ${err.stack || err}`);
} finally {
  if (tab) await tab.close().catch(() => {});
  if (browser) await stopBrowser(browser).catch(() => {});
  await stopServer(serverA);
  await stopServer(serverB);
  fake.closeAllConnections();
  fake.close();
  for (const d of [dirA, dirB]) fs.rmSync(d, { recursive: true, force: true });
}
if (problems.length) {
  console.error(`check-schedule-fields: ${problems.length} problem(s) in ${n} checks`);
  for (const p of problems) console.error(`    - ${p}`);
  process.exit(1);
}
say(`${n} checks pass`);
process.exit(0); // the stand-in's and the browser's sockets may linger
