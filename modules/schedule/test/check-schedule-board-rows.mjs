#!/usr/bin/env node
/*
 * check-schedule-board-rows.mjs -- Planner - Projects' Board rows and filters, the parts that need no browser (plan-projects-kanban.md,
 * step 5b):
 *   - which row a piece of work is in (by milestone: the milestone it is under; by person: its first owner), the no-row row's work,
 *     milestones in outline order and people by name, a row with no shown work left out;
 *   - the filters: who (any, and no one), tags (has all), phase and milestone (one each, or none), groups combined with "and", a
 *     kept value read safely and what is gone dropped, a move that cannot hide work, what "+" starts new work with;
 *   - the stored `rowsBy` survives every column change and the board's own cleaning;
 *   - the page: the Rows switch only for `columns` and one board write with Undo, the rows and filters in the board and the toolbar,
 *     the kept value, "Showing 4 of 12", "Nothing matches.", the toast, the words through `labels`.
 * The live part (the switch, the rows, the drop, the filters, the member, the phone) is tools/check-schedule-board-rows.mjs.
 * Usage: node modules/schedule/test/check-schedule-board-rows.mjs. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(dir, ...p), 'utf8');
const L = new Function(`${read('src', 'schedule-lib.js')}\nreturn { scClean, scBoardRows, scRowOf, scMilestoneOf, scFilterEmpty, scFilterOn, scFilterClean, scFilterMatch, scFilterSeed, SC_NONE, scDefaultBoard, scBoardValue, scBoardFrom, scRenameColumn, scMoveColumn, scAddColumn, scSetColumnFlag, scDeleteColumn };`)();
const page = read('src', 'schedule.js');
const html = read('src', 'schedule.html');

let passed = 0;
const fails = [];
async function test(name, fn) { try { await fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }
const names = { u1: 'Mia', u2: 'Ben', u3: 'Zed' };
const nameOf = (k) => names[k] || '';
const E = (id, o) => L.scClean(id, o);
const plan = () => [
  E('m2', { kind: 'milestone', title: 'Beta', order: 'b' }),
  E('m1', { kind: 'milestone', title: 'Alpha', order: 'a' }),
  E('w1', { kind: 'work', title: 'One', parent: 'm1', owners: ['u2', 'u1'], tags: ['x', 'y'], phase: 'p1', order: 'a' }),
  E('w2', { kind: 'work', title: 'Two', parent: 'm2', owners: ['u1'], tags: ['x'], order: 'a' }),
  E('w3', { kind: 'work', title: 'Three', owners: [], order: 'c' }),
  E('n1', { kind: 'work', title: 'Nested', parent: 'w1', owners: ['u3'], order: 'a' }),
  E('note', { kind: 'note', title: 'A note', parent: 'm1', order: 'b' }),
];
const works = () => plan().filter((e) => e.kind === 'work');
const byId = () => new Map(plan().map((e) => [e.id, e]));
const rowsOf = (shown, by) => L.scBoardRows(shown, by, plan(), nameOf);

await test('by milestone: the milestone it is under, the nearest above, none goes to the last row', () => {
  const r = rowsOf(works(), 'milestone');
  assert.deepEqual(r.rows, [{ id: 'm1', label: 'Alpha' }, { id: 'm2', label: 'Beta' }], 'in outline order, not the order they were made');
  assert.equal(r.of.get('w1'), 'm1');
  assert.equal(r.of.get('w2'), 'm2');
  assert.equal(r.of.get('n1'), 'm1', 'work under work is in its milestone\'s row');
  assert.equal(r.of.get('w3'), '', 'no milestone: the last row');
});
await test('by person: the first owner, people by name, no one goes to the last row', () => {
  const r = rowsOf(works(), 'owners');
  assert.deepEqual(r.rows.map((x) => x.label), ['Ben', 'Mia', 'Zed'], 'by name');
  assert.equal(r.of.get('w1'), 'u2', 'the first owner only');
  assert.equal(r.of.get('w2'), 'u1');
  assert.equal(r.of.get('w3'), '');
});
await test('a person who left is "Someone who left"; none and an unknown value draw no rows', () => {
  const r = L.scBoardRows([E('x', { kind: 'work', title: 'X', owners: ['gone'] })], 'owners', [], () => '', 'Someone who left');
  assert.deepEqual(r.rows, [{ id: 'gone', label: 'Someone who left' }]);
  assert.deepEqual(rowsOf(works(), '').rows, []);
  assert.deepEqual(rowsOf(works(), 'nonsense').rows, []);
});
await test('a row with no shown work is not drawn', () => {
  const shown = works().filter((e) => e.id === 'w2');
  assert.deepEqual(rowsOf(shown, 'milestone').rows, [{ id: 'm2', label: 'Beta' }]);
  assert.deepEqual(rowsOf(shown, 'owners').rows, [{ id: 'u1', label: 'Mia' }]);
});
await test('a loop of parents never hangs a row', () => {
  const a = E('a', { kind: 'work', title: 'A', parent: 'b' });
  const b = E('b', { kind: 'work', title: 'B', parent: 'a' });
  assert.equal(L.scMilestoneOf(a, new Map([['a', a], ['b', b]])), '');
});

const f = (o) => ({ ...L.scFilterEmpty(), ...o });
const pass = (filter) => works().filter((e) => L.scFilterMatch(e, filter, byId())).map((e) => e.id).join();
await test('filter who: any person chosen, and No one', () => {
  assert.equal(pass(f({})), 'w1,w2,w3,n1');
  assert.equal(pass(f({ who: ['u1'] })), 'w1,w2', 'any owner counts, not only the first');
  assert.equal(pass(f({ who: ['u1', 'u3'] })), 'w1,w2,n1', 'any of the people chosen');
  assert.equal(pass(f({ who: [L.SC_NONE] })), 'w3');
  assert.equal(pass(f({ who: ['u3', L.SC_NONE] })), 'w3,n1');
});
await test('filter tag: has all of them', () => {
  assert.equal(pass(f({ tags: ['x'] })), 'w1,w2');
  assert.equal(pass(f({ tags: ['x', 'y'] })), 'w1');
});
await test('filter phase and milestone: one choice, or none', () => {
  assert.equal(pass(f({ phase: 'p1' })), 'w1');
  assert.equal(pass(f({ phase: L.SC_NONE })), 'w2,w3,n1');
  assert.equal(pass(f({ milestone: 'm1' })), 'w1,n1');
  assert.equal(pass(f({ milestone: L.SC_NONE })), 'w3');
});
await test('groups combine with and', () => {
  assert.equal(pass(f({ who: ['u1'], tags: ['x'], milestone: 'm2' })), 'w2');
  assert.equal(pass(f({ who: ['u1'], milestone: L.SC_NONE })), '');
});
await test('no filter filters nothing; a filter reads no column, so a move cannot hide a card', () => {
  assert.equal(L.scFilterOn(f({})), false);
  const moved = { ...works()[0], column: 'done', done: true };
  assert.equal(L.scFilterMatch(moved, f({ who: ['u1'], tags: ['x'], phase: 'p1', milestone: 'm1' }), byId()), true);
  assert.ok(!/column/.test(L.scFilterMatch.toString()), 'scFilterMatch does not read the column');
});
await test('a kept filter is read safely, and what is gone is dropped', () => {
  assert.deepEqual(L.scFilterClean(null, null), f({}));
  assert.deepEqual(L.scFilterClean('x', null), f({}));
  assert.deepEqual(L.scFilterClean({ who: 'u1', tags: [1, 'a', 'a'], phase: 5, milestone: {} }, null), f({ tags: ['a'] }));
  const have = { who: new Set(['u1']), tags: new Set(['x']), phases: new Set(['p1']), milestones: new Set(['m1']) };
  assert.deepEqual(L.scFilterClean({ who: ['u1', 'u9', L.SC_NONE], tags: ['x', 'gone'], phase: 'p9', milestone: L.SC_NONE }, have), f({ who: ['u1', L.SC_NONE], tags: ['x'], milestone: L.SC_NONE }));
});
await test('"+" while filtered starts with the filter\'s choices', () => {
  assert.deepEqual(L.scFilterSeed(f({})), {});
  assert.deepEqual(L.scFilterSeed(f({ milestone: 'm1', phase: 'p1', who: ['u1'], tags: ['x', 'y'] })), { parent: 'm1', phase: 'p1', owners: ['u1'], tags: ['x', 'y'] });
  assert.deepEqual(L.scFilterSeed(f({ who: ['u1', 'u2'] })), {}, 'two people: no one is chosen for it');
  assert.deepEqual(L.scFilterSeed(f({ who: [L.SC_NONE], milestone: L.SC_NONE, phase: L.SC_NONE })), {}, 'no one, no milestone, no phase: nothing to fill in');
});
await test('rowsBy is stored as "milestone" or "owners" or not at all, and every column change keeps it', () => {
  const b = { ...L.scDefaultBoard('stages'), rowsBy: 'owners' };
  const v = L.scBoardValue(b);
  assert.equal(v.rowsBy, 'owners');
  assert.equal(L.scBoardFrom(v, 'stages').rowsBy, 'owners');
  assert.equal(L.scBoardFrom({ ...v, rowsBy: 'person' }, 'stages').rowsBy, undefined, 'any other word is not stored');
  assert.equal('rowsBy' in L.scBoardValue(L.scDefaultBoard('stages')), false);
  assert.equal(L.scRenameColumn(b, 'doing', 'Under way').board.rowsBy, 'owners');
  assert.equal(L.scMoveColumn(b, 'doing', 1).board.rowsBy, 'owners');
  assert.equal(L.scAddColumn(b, 'Review').board.rowsBy, 'owners');
  assert.equal(L.scSetColumnFlag(b, [], 'doing', true, { rollup: () => ({}) }).board.rowsBy, 'owners');
  assert.equal(L.scDeleteColumn(b, 'doing', 'todo', [], { rollup: () => ({}) }).board.rowsBy, 'owners');
});

await test('the page: the Rows switch is the shared one, in the bar the columns right shows, one board write with Undo', () => {
  assert.match(html, /id="rows-switch"[^>]*role="radiogroup"/);
  assert.match(html, /class="mf-switch-btn"[^>]*data-rows="milestone"/);
  assert.match(html, /data-rows="owners"/);
  assert.match(page, /hide\(\$\('board-bar'\), !canColumns\(\)\)/, 'the bar, and so the switch, is for the columns right');
  assert.match(page, /async function setRows\(value\)\s*\{\s*if \(!canColumns\(\)\) return;/);
  assert.match(page, /changeColumns\(board2, \[\], /, 'rows change through the column changes\' one write and Undo');
  assert.match(page, /rowsBy = next/);
  assert.match(page, /delete board2\.rowsBy/, 'None stores nothing');
});
await test('the page: rows and the words people read go to the board', () => {
  assert.match(page, /scBoardRows\(v\.shown, rowsBy, list\(\), nameOf/);
  assert.match(page, /noRow: 'No one', otherRow: 'Change who is doing it in Edit\.'/);
  assert.match(page, /noRow: `No \$\{kindWord\('milestone'\)\}`, otherRow: `Change the \$\{kindWord\('milestone'\)\} in Edit\.`/);
  assert.match(page, /board\.set\(cards, columns, rows\)/);
  assert.match(page, /boardRowsBy !== rowsBy\) \{ board\.destroy\(\)/, 'a change of rows draws the board again: its words are given when it is made');
  assert.doesNotMatch(page, /No milestone|Every milestone/, 'the level words go through labels');
});
await test('the page: the Filters groups, on the Board only, kept per person', () => {
  assert.match(page, /const onBoard = state\.view === 'board'/);
  for (const id of ['f-who', 'f-tags', 'f-phase', 'f-milestone']) assert.match(page, new RegExp(`id: '${id}'`));
  assert.match(page, /type: 'chips', id: 'f-phase', label: 'Phase', single: true/);
  assert.match(page, /schedule-filter:\$\{info\.context\.spaceId/);
  assert.match(page, /localStorage\.setItem\(FILTER_KEY[^\n]*catch/, 'a failed write is harmless');
  assert.match(page, /try \{ state\.filter = scFilterClean\(JSON\.parse\(localStorage\.getItem\(FILTER_KEY\)[^\n]*catch/, 'a failed read is harmless');
  const body = (name) => { const at = page.indexOf(`function ${name}(`); return page.slice(at, page.indexOf('\n  }\n', at)); };
  for (const view of ['renderList', 'renderTimeline']) { assert.ok(body(view).length > 50, `${view} found`); assert.doesNotMatch(body(view), /scFilterMatch|boardWork|currentFilter/, `${view} has no filters`); }
});
await test('the page: the status line, "Nothing matches.", "+" and the toast', () => {
  assert.match(page, /Showing \$\{v\.shown\.length\} of \$\{v\.works\.length\}/);
  assert.match(page, /boardOpts\.empty = 'Nothing matches\.'/);
  assert.match(page, /\.\.\.scFilterSeed\(currentFilter\(\)\)/);
  assert.match(page, /say\('Added\. The filter hides it\.'\)/);
});
await test('no agent action reads rows or filters', () => {
  const actions = read('src', 'schedule-lib-actions.js');
  assert.doesNotMatch(actions, /rowsBy|scFilter|scBoardRows/);
});

console.log(`check-schedule-board-rows: ${passed} passed${fails.length ? `, ${fails.length} failed` : ''}`);
for (const f2 of fails) console.error(`  FAIL ${f2}`);
process.exit(fails.length ? 1 : 0);
