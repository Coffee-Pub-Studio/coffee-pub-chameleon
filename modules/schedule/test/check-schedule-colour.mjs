#!/usr/bin/env node
/*
 * check-schedule-colour.mjs -- a board column's colour in Planner - Projects (plan-board-colour.md, build order step 2):
 *   - the stored `color` on a column in `board:main`: kept only as a strict lower case #rrggbb, never on anything else, nothing stored
 *     for a column that has none;
 *   - the rule (scSetColumnColor): sets or takes off one column's colour and changes nothing else; renaming, moving, flagging as done and
 *     deleting another column keep it;
 *   - a file: Export writes it, Import reads it back, a colour that is not #rrggbb in lower case is refused with one sentence;
 *   - the page: the column menu has **Colour** (the picker, no opacity) and **No colour**, one board write with Undo (changeColumns), the
 *     colour handed to host.ui.board with each column, and nothing sent to the issue service.
 * No page is run: the page checks read the source. Usage: node modules/schedule/test/check-schedule-colour.mjs. Exits 1 on failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(dir, ...p), 'utf8');
const NAMES = ['scColourBoardValue', 'scCleanBoard', 'scBoardValue', 'scSetColumnColor', 'scRenameColumn', 'scMoveColumn', 'scSetColumnFlag', 'scDeleteColumn', 'scAddColumn', 'scDefaultBoard', 'scClean', 'scExportFile', 'scParseFile'];
const L = new Function(`${read('src', 'schedule-lib.js')}\n${read('src', 'schedule-lib-file.js')}\nreturn { ${NAMES.join(', ')} };`)();
const page = read('src', 'schedule.js');
const manifest = JSON.parse(read('module.json'));

let n = 0;
const test = async (name, fn) => { try { await fn(); n += 1; } catch (e) { process.exitCode = 1; console.error(`FAIL ${name}\n${e.stack || e}`); } };

const raw = (cols) => ({ id: 'main', name: 'Board', field: 'column', columns: cols });
const base = () => raw([{ id: 'todo', label: 'To do' }, { id: 'doing', label: 'Doing', color: '#1a2b3c' }, { id: 'done', label: 'Done', done: true, color: '#00ff7f' }]);
const colours = (b) => b.columns.map((c) => c.color || null);

await test('a column keeps a strict lower case #rrggbb and drops anything else', () => {
  const b = L.scCleanBoard('main', raw([
    { id: 'a', label: 'A', color: '#1a2b3c' }, { id: 'b', label: 'B', color: '#1A2B3C' }, { id: 'c', label: 'C', color: '#abc' },
    { id: 'd', label: 'D', color: 'red' }, { id: 'e', label: 'E', color: 5 }, { id: 'f', label: 'F', done: true, color: '#0a0b0c' },
  ]));
  assert.deepEqual(colours(b), ['#1a2b3c', null, null, null, null, '#0a0b0c']);
  assert.equal('color' in b.columns[1], false, 'nothing stored for a column with none');
});
await test('the stored board holds the colour only where there is one, and reads back the same', () => {
  const b = L.scCleanBoard('main', base());
  const v = L.scBoardValue(b);
  assert.deepEqual(v.columns, [{ id: 'todo', label: 'To do' }, { id: 'doing', label: 'Doing', color: '#1a2b3c' }, { id: 'done', label: 'Done', done: true, color: '#00ff7f' }]);
  assert.deepEqual(L.scCleanBoard('main', v), b);
  assert.ok(!JSON.stringify(L.scBoardValue(L.scDefaultBoard('priority'))).includes('color'), 'a template\'s default columns have no colour');
});
await test('scSetColumnColor sets, changes and takes off one colour and nothing else', () => {
  const b = L.scCleanBoard('main', base());
  const set = L.scSetColumnColor(b, 'todo', '#ff0000');
  assert.equal(set.problem, undefined);
  assert.deepEqual(colours(set.board), ['#ff0000', '#1a2b3c', '#00ff7f']);
  assert.deepEqual(set.board.columns.map((c) => c.label), ['To do', 'Doing', 'Done']);
  assert.equal(set.board.columns[2].done, true);
  assert.deepEqual(colours(b), [null, '#1a2b3c', '#00ff7f'], 'the board it was given is not changed');
  const off = L.scSetColumnColor(set.board, 'doing', '');
  assert.deepEqual(colours(off.board), ['#ff0000', null, '#00ff7f']);
  assert.equal('color' in off.board.columns[1], false);
  assert.deepEqual(colours(L.scSetColumnColor(off.board, 'doing', null).board), ['#ff0000', null, '#00ff7f'], 'taking off a colour it has not got is fine');
});
await test('a colour that is not #rrggbb in lower case, and a column that is not there, are refused with one sentence', () => {
  const b = L.scCleanBoard('main', base());
  for (const bad of ['#FF0000', '#f00', 'red', 'rgb(1,2,3)', '#1234567', 5, {}]) assert.equal(L.scSetColumnColor(b, 'todo', bad).problem, 'A colour is a # and six lower case hex digits.', String(bad));
  assert.match(L.scSetColumnColor(b, 'gone', '#ff0000').problem, /There is no column called gone\.$/);
});
await test('renaming, moving, flagging as done and deleting a column keep the others\' colours and the column\'s own', () => {
  const b = L.scCleanBoard('main', base());
  assert.deepEqual(colours(L.scRenameColumn(b, 'doing', 'In flight').board), [null, '#1a2b3c', '#00ff7f']);
  assert.deepEqual(colours(L.scMoveColumn(b, 'doing', -1).board), ['#1a2b3c', null, '#00ff7f']);
  const flagged = L.scSetColumnFlag(b, [], 'doing', true, {});
  assert.deepEqual(colours(flagged.board), [null, '#1a2b3c', '#00ff7f'], 'now counting as done, still coloured');
  assert.equal(flagged.board.columns[1].done, true);
  const unflagged = L.scSetColumnFlag(flagged.board, [], 'doing', false, {});
  assert.deepEqual(colours(unflagged.board), [null, '#1a2b3c', '#00ff7f']);
  assert.equal('done' in unflagged.board.columns[1], false);
  const gone = L.scDeleteColumn(b, 'todo', 'doing', [], {});
  assert.deepEqual(colours(gone.board), ['#1a2b3c', '#00ff7f']);
  assert.equal('color' in L.scAddColumn(b, 'New').column, false, 'a new column has none');
});
await test('a stored board is patched where it stands: only the colour differs, every key and its order as stored', () => {
  const stored = { name: 'Bug Squash', id: 'main', field: 'column', extra: { x: 1 }, columns: [{ label: 'Inbox', id: 'inbox' }, { id: 'now', label: 'Now', note: 'kept' }, { done: true, id: 'done', label: 'Done' }], rowsBy: 'owners' };
  const before = JSON.stringify(stored);
  const on = L.scColourBoardValue(stored, 'now', '#1a2b3c');
  assert.equal(JSON.stringify(stored), before, 'the stored value is not changed');
  assert.equal(JSON.stringify(on), JSON.stringify({ ...stored, columns: [stored.columns[0], { id: 'now', label: 'Now', note: 'kept', color: '#1a2b3c' }, stored.columns[2]] }));
  assert.deepEqual(Object.keys(on), Object.keys(stored), 'the board\'s keys in their order');
  assert.deepEqual(Object.keys(on.columns[0]), ['label', 'id'], 'another column\'s key order');
  const again = L.scColourBoardValue(on, 'now', '#00ff7f');
  assert.equal(again.columns[1].color, '#00ff7f');
  assert.equal(JSON.stringify(L.scColourBoardValue(on, 'now', '')), JSON.stringify(stored), 'taking it off gives back exactly what was stored');
  assert.equal(L.scColourBoardValue(stored, 'gone', '#1a2b3c'), null);
  assert.equal(L.scColourBoardValue(null, 'now', '#1a2b3c'), null, 'no stored board: the caller stores the default board whole');
  assert.equal(L.scColourBoardValue(stored, 'now', '#1A2B3C'), null);
});
await test('export writes the colour and import reads it back', () => {
  const b = L.scCleanBoard('main', base());
  const out = L.scExportFile([L.scClean('w', { kind: 'work', title: 'T', start: '2026-11-01', end: '2026-11-02' })], { boards: [b] });
  assert.deepEqual(out.boards[0].columns.map((c) => c.color || null), [null, '#1a2b3c', '#00ff7f']);
  const back = L.scParseFile(JSON.stringify(out), { label: (k) => k, datesRequired: true, fields: [] });
  assert.equal(back.problem, undefined);
  assert.deepEqual(colours(back.boards[0]), [null, '#1a2b3c', '#00ff7f']);
});
await test('a file whose column colour is not #rrggbb in lower case is refused with one sentence', () => {
  const file = (color) => JSON.stringify({ format: 'project-plan', version: 1, entries: [{ kind: 'work', title: 'A', start: '2026-11-01', end: '2026-11-02' }], boards: [{ id: 'main', columns: [{ id: 'todo', label: 'To do', color }, { id: 'done', label: 'Done', done: true }] }] });
  for (const bad of ['#FF0000', 'red', '#abc', 7]) {
    const r = L.scParseFile(file(bad), { label: (k) => k, datesRequired: true, fields: [] });
    assert.match(r.problem || '', /Board 1, column 1: "color" must be a # and six lower case hex digits\.$/, String(bad));
  }
  assert.equal(L.scParseFile(file(null), { label: (k) => k, datesRequired: true, fields: [] }).problem, undefined, 'null is no colour');
});
await test('the page: Colour and No colour in the column menu, the picker with no opacity, one board write, the colour handed to the board', () => {
  const menu = page.match(/function columnMenu\(c\) \{[\s\S]*?\n  \}\n/)[0];
  assert.match(menu, /if \(!canColumns\(\)\) return keepItem\(c\);/, 'only someone with the columns right, and not on a followed board, gets Colour (anyone gets the closed-issues link on a followed plan\'s Done column)');
  assert.match(menu, /label: 'Colour'/);
  assert.match(menu, /colourOf\(c\.id\) \? \[\{ id: 'nocolour', label: 'No colour'/, 'No colour only once there is one');
  assert.match(page, /host\.ui\.colorPicker\(\{ at, value: was \|\| undefined, opacity: false, label: 'Column colour' \}\)/);
  assert.match(page, /scSetColumnColor\(currentBoard\(\), c\.id, color\);[\s\S]{0,400}await changeColumns\(r\.board, \[\], [^\n]*scColourBoardValue\(state\.boardRaw, c\.id, color\)/, 'one board write with Undo, patching the stored board');
  assert.match(page, /const columns = b\.columns\.map\(\(c\) => \(\{ id: c\.id, label: c\.label, done: Boolean\(c\.done\), \.\.\.\(c\.color \? \{ color: c\.color \} : \{\}\) \}\)\)/);
  assert.doesNotMatch(page, /host\.issues\.[a-z]+\([^)]*colo/i, 'nothing about a colour goes to the issue service');
});
await test('the manifest: the board guard still allows the columns and the right to change them is `columns`', () => {
  const g = manifest.guards.keys.find((k) => k.key === 'board:{id}');
  assert.ok(g, 'a board guard');
  assert.equal(g.need, 'columns');
  assert.ok(g.fields.columns, 'its columns are checked as a list (a column\'s own keys are the module\'s to clean)');
});

console.log(`check-schedule-colour: ${n} tests pass`);
