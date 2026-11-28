#!/usr/bin/env node
/*
 * check-schedule-board-editor.mjs -- Planner - Projects' column menu and editor, the parts that need no browser (plan-projects-kanban.md,
 * step 4):
 *   - the rules the page runs in order (add, rename, move, flag, delete) keep ids stable, settle milestones and say the plan's
 *     refusal sentences;
 *   - the page: the column menu has Rename, Move left, Move right, Counts as done and Delete, only for someone with `columns`; the board
 *     has an "Add a column" control; every change is one board write then the work it rewrites, offered for Undo; the delete chooser is
 *     a dialog with the columns that are left.
 * The live part (the menus, the dialogs, the member refused, Undo, the phone) is tools/check-schedule-board-editor.mjs.
 * Usage: node modules/schedule/test/check-schedule-board-editor.mjs. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(dir, ...p), 'utf8');
const L = new Function(`${read('src', 'schedule-lib.js')}\nreturn { scDefaultBoard, scClean, scSetColumnFlag, scDeleteColumn, scAddColumn, scRenameColumn, scMoveColumn, scColumnOf, scBoardValue, scBoardFrom };`)();
const page = read('src', 'schedule.js');
const html = read('src', 'schedule.html');

let passed = 0;
const fails = [];
async function test(name, fn) { try { await fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }
const rollup = (entries) => {
  const out = {};
  for (const e of entries) if (e.parent) { const r = out[e.parent] || (out[e.parent] = { done: 0, total: 0 }); r.total += 1; if (e.done) r.done += 1; }
  return out;
};
const plan = () => [
  L.scClean('m', { kind: 'milestone', title: 'Launch', order: 'a' }),
  L.scClean('a', { kind: 'work', title: 'A', parent: 'm', column: 'doing', order: 'a' }),
  L.scClean('b', { kind: 'work', title: 'B', parent: 'm', column: 'done', done: true, order: 'b' }),
];
const stages = () => L.scDefaultBoard('stages');

await test('a template board edited in turn: add, rename, move keep ids and the work', () => {
  let b = stages();
  b = L.scAddColumn(b, 'Review', 'doing').board;
  assert.deepEqual(b.columns.map((c) => c.id), ['todo', 'doing', 'review', 'done']);
  b = L.scRenameColumn(b, 'doing', 'Under way').board;
  assert.deepEqual(b.columns.map((c) => c.id), ['todo', 'doing', 'review', 'done'], 'a rename never changes an id');
  assert.equal(b.columns[1].label, 'Under way');
  b = L.scMoveColumn(b, 'review', -1).board;
  assert.deepEqual(b.columns.map((c) => c.id), ['todo', 'review', 'doing', 'done']);
  assert.equal(L.scColumnOf(plan()[1], b).id, 'doing', 'work stays in its column across a rename and a move');
  assert.deepEqual(L.scBoardValue(b).columns[2], { id: 'doing', label: 'Under way' }, 'the stored label is the person\'s');
});
await test('the flag rewrites done on the column\'s work and settles the milestone', () => {
  const b = L.scAddColumn(stages(), 'Shipped').board;
  const on = L.scSetColumnFlag(b, plan(), 'doing', true, { rollup });
  assert.ok(!on.problem, on.problem);
  assert.equal(on.entries.find((e) => e.id === 'a').done, true);
  const m = on.entries.find((e) => e.id === 'm');
  assert.ok(m && m.done === true, 'the milestone settles done');
  const off = L.scSetColumnFlag(on.board, plan().map((e) => (e.id === 'a' ? { ...e, done: true } : e)), 'doing', false, { rollup });
  assert.equal(off.entries.find((e) => e.id === 'a').done, false);
});
await test('delete moves the work and takes the target\'s flag; the refusals are the plan\'s sentences', () => {
  const b = stages();
  const r = L.scDeleteColumn(b, 'doing', 'done', plan(), { rollup });
  assert.ok(!r.problem);
  assert.equal(r.entries.find((e) => e.id === 'a').column, 'done');
  assert.equal(r.entries.find((e) => e.id === 'a').done, true);
  assert.equal(L.scDeleteColumn(b, 'done', 'todo', plan(), { rollup }).problem, 'Keep at least one column that counts as done.');
  assert.equal(L.scDeleteColumn({ ...b, columns: [b.columns[0]] }, 'todo', 'x', [], { rollup }).problem, 'Keep at least one column.');
  assert.equal(L.scAddColumn(b, '   ').problem, 'Give the column a name.');
  assert.equal(L.scAddColumn(b, 'x'.repeat(41)).problem, 'A column name is at most 40 characters.');
  const twelve = { ...b, columns: Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, label: `C${i}`, ...(i === 0 ? { done: true } : {}) })) };
  assert.equal(L.scAddColumn(twelve, 'More').problem, 'A board has at most 12 columns.');
});
await test('the page: the column menu, its right, the Add control, one write with Undo', () => {
  const menu = page.slice(page.indexOf('function columnMenu'), page.indexOf('function columnMenu') + 1400);
  assert.match(menu, /if \(!canColumns\(\)\) return \[\.\.\.keepItem\(c\), \.\.\.\(canColour\(\) && pullOn\(\) \? colourItems\(c\) : \[\]\)\];/, 'no column items without the columns right; a followed plan gives someone with it Colour and anyone the closed-issues link on the Done column, and nothing else');
  for (const w of ["'Rename'", "'Move left'", "'Move right'", "'Counts as done'", "'Delete'"]) assert.ok(menu.includes(w), w);
  assert.match(page, /const canColumns = \(\) => host\.can\('columns'\)/);
  assert.match(page, /hide\(\$\('col-add'\), !canColumns\(\)\)/, 'Add a column is hidden without the right');
  const change = page.slice(page.indexOf('async function changeColumns'), page.indexOf('const rollup ='));
  assert.ok(change.indexOf('writeBoard(scBoardValue(next))') < change.indexOf('await write(e,'), 'the board is written first, then the work');
  assert.match(change, /offerUndo\(plan, text\)/, 'Undo is offered');
  assert.match(change, /board: \{ was: state\.boardRaw \}/, 'Undo puts the board (or its absence) back');
  assert.match(page, /host\.ui\.prompt\(\{ title: 'Rename the column'[^]*?validate/, 'rename asks through the prompt, with the rules\' sentences');
  assert.match(page, /host\.ui\.prompt\(\{ title: 'Add a column'[^]*?validate/);
  assert.doesNotMatch(page, /window\.(prompt|confirm)\(/);
});
await test('the page: the delete chooser is a dialog of the other columns', () => {
  assert.match(html, /<dialog id="col-delete"[^]*?<select id="col-to"/);
  assert.match(html, /id="col-add"[^]*Add a column/);
  const del = page.slice(page.indexOf('function deleteColumn'), page.indexOf("$('col-cancel')"));
  assert.match(del, /filter\(\(x\) => x\.id !== c\.id\)/, 'the column itself is not offered');
  assert.match(del, /probe\.problem/, 'the refusals that do not depend on the target are said at once');
});

if (fails.length) { console.error(`check-schedule-board-editor: ${fails.length} failed\n${fails.map((f) => `  - ${f}`).join('\n')}`); process.exit(1); }
console.log(`check-schedule-board-editor: ${passed} checks passed`);
