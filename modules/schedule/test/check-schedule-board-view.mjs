#!/usr/bin/env node
/*
 * check-schedule-board-view.mjs -- Planner - Projects' Board view, the parts that need no browser (plan-projects-kanban.md, step 3):
 *   - the default columns take the template's words (`board-<id>` labels) in the page and on the server alike, a blank or unknown
 *     word keeps the English one, and a stored board's own labels win;
 *   - the manifest names a label for every default column, offers Board in "Opens on", and says no more than the plan asks;
 *   - the Gaming template sets boardColumns: priority;
 *   - the page: the view switch, the Board section, the card inside as text (no innerHTML from a person's words), the tick and the
 *     editor's Done box go through scSetDone with the board, a move runs the setColumn handler, the import writes the file's board
 *     and hands it to scImportEntries, and the column "..." menu is given to the board (its items are check-schedule-board-editor.mjs, step 4).
 * The live part (drag, menus, the List agreeing, the member, the agent, the phone) is tools/check-schedule-board.mjs.
 * Usage: node modules/schedule/test/check-schedule-board-view.mjs. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { onPage, onRunner } from '../../../tools/module-actions-harness.mjs';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(dir, '..', '..');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const code = read(dir, 'src', 'schedule-lib.js');
const L = new Function(`${code}\nreturn { scDefaultBoard, scBoardFrom, scColumnOf, scClean };`)();
const manifest = JSON.parse(read(dir, 'module.json'));
const page = read(dir, 'src', 'schedule.js');
const html = read(dir, 'src', 'schedule.html');

let passed = 0;
const fails = [];
async function test(name, fn) { try { await fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }
const names = (b) => b.columns.map((c) => c.label).join(',');

await test('the default columns take the template\'s words, else the English ones', () => {
  const words = { 'board-inbox': 'Ideas', 'board-done': 'Shipped' };
  const label = (k) => words[k] || k; // as host.util.label answers a word it has not: the key itself
  assert.equal(names(L.scDefaultBoard('priority', label)), 'Ideas,Now,Next,Later,Shipped');
  assert.equal(names(L.scDefaultBoard('priority')), 'Inbox,Now,Next,Later,Done');
  assert.equal(names(L.scDefaultBoard('stages', (k) => (k === 'board-doing' ? 'Under way' : ''))), 'To do,Under way,Done', 'a blank word keeps the English one');
  assert.equal(names(L.scDefaultBoard('stages', () => { throw new Error('no'); })), 'To do,Doing,Done', 'a lookup that throws keeps the English ones');
  const ids = L.scDefaultBoard('priority', label).columns.map((c) => c.id).join(',');
  assert.equal(ids, 'inbox,now,next,later,done', 'a rename never touches an id');
  const stored = { id: 'main', name: 'Board', columns: [{ id: 'a', label: 'Mine' }, { id: 'b', label: 'Fin', done: true }] };
  assert.equal(names(L.scBoardFrom(stored, 'priority', label)), 'Mine,Fin', 'a stored board keeps its own labels');
  assert.equal(names(L.scBoardFrom(null, 'priority', label)), 'Ideas,Now,Next,Later,Shipped');
});
await test('the manifest: a label for every default column, Board in "Opens on", the view\'s words', () => {
  for (const id of ['inbox', 'now', 'next', 'later', 'done', 'todo', 'doing']) {
    const w = manifest.labels[`board-${id}`];
    assert.ok(w && w.one && w.many && w.a, `a label for board-${id}`);
  }
  const view = manifest.settings.find((s) => s.key === 'defaultView');
  assert.deepEqual(view.options.map((o) => o.value), ['timeline', 'list', 'board']);
  assert.equal(view.options[2].label, 'Board');
  assert.equal(manifest.settings.find((s) => s.key === 'boardColumns').default, 'stages');
});
await test('the Gaming template sets boardColumns: priority, the others leave it', () => {
  const games = JSON.parse(read(root, 'templates', 'games.json'));
  assert.equal(games.modules.schedule.settings.boardColumns, 'priority');
  for (const f of fs.readdirSync(path.join(root, 'templates')).filter((x) => x.endsWith('.json') && x !== 'games.json')) {
    const t = JSON.parse(read(root, 'templates', f));
    const s = t.modules && t.modules.schedule && t.modules.schedule.settings;
    assert.ok(!s || s.boardColumns === undefined, `${f} leaves boardColumns to the default`);
  }
});
await test('the page: the Board is a view, drawn by host.ui.board, a card is text', () => {
  assert.match(page, /\{ id: 'board', label: 'Board', icon: 'table-columns' \}/, 'the third view');
  assert.match(html, /id="view-board"/);
  assert.match(page, /host\.ui\.board\(\$\('board'\)/);
  const draw = page.slice(page.indexOf('function drawCard'), page.indexOf('function cardMenu'));
  assert.ok(draw.length > 200, 'drawCard found');
  assert.doesNotMatch(draw, /innerHTML|insertAdjacentHTML/, 'a card\'s words are set as text');
  assert.match(draw, /'Late'/);
  assert.match(draw, /tags\.slice\(0, 2\)/, 'two tags');
  assert.match(draw, /Waits on/);
  const cards = page.slice(page.indexOf('function boardCards'), page.indexOf('// What a card says inside'));
  assert.match(cards, /e\.kind === 'work'/, 'cards are work only');
  assert.match(page, /onAdd: \(columnId\) => openEditor\(null, \{ kind: 'work', column: columnId \}\)/, 'a "+" adds work in its column');
  assert.match(page, /columnMenu,/, 'the column menu carries the module\'s items (the editor, step 4)');
});
await test('the page: the tick and the Done box go through scSetDone with the board; a move runs setColumn', () => {
  const tick = page.slice(page.indexOf('async function toggleDone'), page.indexOf('async function moveEntry'));
  assert.match(tick, /scSetDone\(had\.e, !had\.e\.done, \{[^}]*board: currentBoard\(\)/);
  const form = page.slice(page.indexOf("$('form').addEventListener('submit'"), page.indexOf("$('f-delete').addEventListener"));
  assert.match(form, /scSetDone\(draft, \$\('f-done'\)\.checked, \{[^}]*board: currentBoard\(\)/);
  assert.match(page, /carried\.setColumn\(\{ ref: pointer\(m\.id\), column: m\.column \}/);
  assert.match(page, /canMove: \(\) => canEdit/, 'a move needs edit only');
  assert.doesNotMatch(page.slice(page.indexOf('function renderBoard'), page.indexOf('async function moveCard')), /host\.can\('columns'\)/);
});
await test('the page: Import stores the file\'s board first and gives it to scImportEntries; Export carries the board', () => {
  assert.match(page, /parsed\.boards && parsed\.boards\[0\]/);
  assert.match(page, /board: newBoard \|\| currentBoard\(\)/);
  assert.match(page, /scExportFile\(list\(\), \{ module: info\.module\.id, boards: \[currentBoard\(\)\] \}\)/);
  const apply = page.slice(page.indexOf('async function applyImport'), page.indexOf('function offerUndo'));
  assert.ok(apply.indexOf('writeBoard(scBoardValue(newBoard))') < apply.indexOf('await write(e,'), 'the board is written before any entry');
  assert.match(page, /plan\.board\.was/, 'Undo puts the board back too');
});
await test('setColumn gives the same answer on the page and on the server with a template\'s column words', async () => {
  const SP = { id: 's1', name: 'Launch' };
  const world = { space: SP, rows: { 'plan:w': { kind: 'work', title: 'W', start: '2026-11-01', end: '2026-11-02', order: 'm', by: 'u', done: false } }, people: [], settings: { boardColumns: 'priority' }, phases: [] };
  const input = { ref: { module: 'schedule', kind: 'plan', id: 'w', scope: 'space', space: 's1' }, column: 'now' };
  const a = await onPage('schedule', 'setColumn', input, world, { name: 'Planner - Projects' });
  const b = await onRunner('schedule', 'setColumn', input, world, { kinds: ['plan'], carrier: 'server' });
  assert.deepEqual(a.writes, b.writes);
  assert.equal(a.writes[0].value.column, 'now');
  const bad = await onPage('schedule', 'setColumn', { ...input, column: 'doing' }, world, { name: 'Planner - Projects' });
  assert.match(bad.refused, /There is no column called doing/, 'the priority set has no doing');
});

if (fails.length) { console.error(`check-schedule-board-view: ${fails.length} failed\n  ${fails.join('\n  ')}`); process.exit(1); }
console.log(`check-schedule-board-view: ${passed} tests pass`);
