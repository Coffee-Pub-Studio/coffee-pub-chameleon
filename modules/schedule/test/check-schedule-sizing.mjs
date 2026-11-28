#!/usr/bin/env node
/*
 * check-schedule-sizing.mjs -- Planner - Projects' size field and done day (plan-projects-sizing-burndown.md, build order step 1):
 *   - `doneOn`: the day work became done, stamped by every way of marking done (the tick, a move into a done column, a column's flag,
 *     deleting a column into a done one), kept while it stays done, removed when it is not, never on a milestone or a note;
 *   - the size field: a field with `size: true` and a number (`value`, 0 to 999) on each choice, one per plan, read from the `sizing`
 *     setting until the plan stores its own, never sent anywhere; the number a piece of work is sized at;
 *   - a file: export and import keep the flag, the numbers and the day; a second size field and a bad number are refused;
 *   - the actions, on the page and on the server's runner: setDone and setColumn write `doneOn`, addWork and updateEntry take the size by
 *     `fields`, the setting's size field is there with no stored one;
 *   - the manifest: the `sizing` setting and the `size` key the `field:` guard allows.
 * No page is run: the page checks read the source. Usage: node modules/schedule/test/check-schedule-sizing.mjs. Exits 1 on failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { onPage, onRunner } from '../../../tools/module-actions-harness.mjs';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(dir, ...p), 'utf8');
const NAMES = ['scClean', 'scValue', 'scSetDone', 'scSetColumn', 'scSetColumnFlag', 'scDeleteColumn', 'scDefaultBoard', 'scCleanField', 'scFieldValue', 'scFieldsFrom', 'scFieldsWithSize', 'scSizeFieldOf', 'scSizeOf', 'scTodayOf', 'scExportFile', 'scParseFile'];
const L = new Function(`${read('src', 'schedule-lib.js')}\n${read('src', 'schedule-lib-file.js')}\nreturn { ${NAMES.join(', ')} };`)();
const manifest = JSON.parse(read('module.json'));
const page = read('src', 'schedule.js');

let n = 0;
const test = async (name, fn) => { try { await fn(); n += 1; } catch (e) { process.exitCode = 1; console.error(`FAIL ${name}\n${e.stack || e}`); } };

const board = L.scDefaultBoard('priority');
const T = '2026-11-28';
const work = (o = {}) => L.scClean('w1', { kind: 'work', title: 'Write docs', start: '2026-11-01', end: '2026-11-10', column: 'now', ...o });
const fieldRow = (id, o) => ({ key: `field:${id}`, value: o });

await test('done work is stamped with the day, by the tick and by a move into a done column', () => {
  const ticked = L.scSetDone(work(), true, { board, today: T }).entry;
  assert.equal(ticked.done, true);
  assert.equal(ticked.doneOn, T);
  assert.equal(L.scValue(ticked).doneOn, T);
  const moved = L.scSetColumn(work(), 'done', board, { today: T }).entry;
  assert.equal(moved.doneOn, T);
});
await test('the day is kept while it stays done and removed when it is not', () => {
  const was = work({ done: true, column: 'done', doneOn: '2026-11-03' });
  assert.equal(was.doneOn, '2026-11-03');
  assert.equal(L.scSetDone(was, true, { board, today: T }).entry.doneOn, '2026-11-03', 'ticking a done one again keeps its day');
  assert.equal(L.scSetColumn(was, 'done', board, { today: T }).entry.doneOn, '2026-11-03');
  const undone = L.scSetDone(was, false, { board, today: T }).entry;
  assert.equal(undone.done, false);
  assert.equal('doneOn' in undone, false);
  assert.equal('doneOn' in L.scValue(undone), false);
  assert.equal('doneOn' in L.scSetColumn(was, 'now', board, { today: T }).entry, false, 'a move out of done clears it');
});
await test('work that is not done carries no day, a milestone and a note never do, a bad day is dropped', () => {
  assert.equal('doneOn' in work({ doneOn: '2026-11-03' }), false, 'stored on work that is not done: dropped');
  assert.equal(work({ done: true, doneOn: 'soon' }).doneOn, undefined);
  const ms = L.scClean('m', { kind: 'milestone', title: 'M', start: T, ticked: true, doneOn: T });
  assert.equal('doneOn' in ms, false);
  assert.equal('doneOn' in L.scClean('n', { kind: 'note', title: 'N', doneOn: T }), false);
});
await test('with no day known, work still becomes done and has no day', () => {
  const r = L.scSetDone(work(), true, { board }).entry;
  assert.equal(r.done, true);
  assert.equal('doneOn' in r, false);
});
await test('a column that now counts as done stamps its work, and deleting a column into a done one does too', () => {
  const flag = L.scSetColumnFlag(board, [work()], 'now', true, { today: T });
  assert.equal(flag.problem, undefined);
  assert.equal(flag.entries.find((e) => e.id === 'w1').doneOn, T);
  const gone = L.scDeleteColumn(board, 'now', 'done', [work()], { today: T });
  assert.equal(gone.problem, undefined);
  assert.equal(gone.entries.find((e) => e.id === 'w1').doneOn, T);
  const out = L.scSetColumnFlag({ ...board, columns: board.columns.map((c) => (c.id === 'now' ? { ...c, done: true } : c)) }, [work({ done: true, doneOn: '2026-11-03' })], 'now', false, { today: T });
  assert.equal('doneOn' in out.entries.find((e) => e.id === 'w1'), false);
});
await test('scTodayOf reads the day of ctx.now through ctx.util.ymd, and gives nothing it cannot read', () => {
  const ymd = (d) => d.toISOString().slice(0, 10);
  assert.equal(L.scTodayOf({ now: Date.UTC(2026, 10, 28, 12), util: { ymd } }), T);
  assert.equal(L.scTodayOf({ now: '2026-11-28T12:00:00Z', util: { ymd } }), T);
  assert.equal(L.scTodayOf({ now: 'never', util: { ymd } }), '');
  assert.equal(L.scTodayOf({ util: { ymd } }), '');
  assert.equal(L.scTodayOf({ now: 1, util: {} }), '');
});

await test('a size field keeps its flag and the numbers on its choices; one that is not a size has none', () => {
  const f = L.scCleanField('size', { label: 'Size', size: true, options: [{ id: 'a', label: 'A', value: 3 }, { id: 'b', label: 'B', value: 1000 }, { id: 'c', label: 'C', value: 2.5 }, { id: 'd', label: 'D' }] });
  assert.equal(f.size, true);
  assert.deepEqual(f.options, [{ id: 'a', label: 'A', value: 3 }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }, { id: 'd', label: 'D' }], 'a number is a whole number from 0 to 999, else the choice has none');
  assert.deepEqual(L.scFieldValue(f), { id: 'size', label: 'Size', options: f.options, order: 0, size: true });
  const plain = L.scCleanField('area', { label: 'Area', size: 'yes', options: [{ id: 'a', label: 'A' }] });
  assert.equal('size' in plain, false);
  assert.equal('size' in L.scFieldValue(plain), false);
});
await test('a plan has one size field: the first keeps the flag', () => {
  const rows = [fieldRow('b', { label: 'B', size: true, order: 1, options: [] }), fieldRow('a', { label: 'A', size: true, order: 0, options: [] })];
  const fs2 = L.scFieldsFrom(rows);
  assert.deepEqual(fs2.map((f) => [f.id, Boolean(f.size)]), [['a', true], ['b', false]]);
});
await test('the sizing setting stands for a size field until the plan stores its own', () => {
  assert.equal(L.scFieldsWithSize([], 'off').length, 0);
  assert.equal(L.scSizeFieldOf(L.scFieldsWithSize([], 'off')), null);
  const pts = L.scSizeFieldOf(L.scFieldsWithSize([], 'points'));
  assert.deepEqual(pts.options.map((o) => [o.label, o.value]), [['1', 1], ['2', 2], ['3', 3], ['5', 5], ['8', 8], ['13', 13]]);
  const tee = L.scSizeFieldOf(L.scFieldsWithSize([], 'tshirt'));
  assert.deepEqual(tee.options.map((o) => [o.label, o.value]), [['XS', 1], ['S', 2], ['M', 3], ['L', 5], ['XL', 8]]);
  const own = L.scFieldsFrom([fieldRow('effort', { label: 'Effort', size: true, options: [{ id: 'x', label: 'X', value: 4 }] })]);
  assert.equal(L.scSizeFieldOf(L.scFieldsWithSize(own, 'points')).id, 'effort', 'a stored size field wins');
  assert.equal(L.scFieldsWithSize(own, 'points').length, 1);
  const taken = L.scFieldsFrom([fieldRow('size', { label: 'Size of the thing', options: [{ id: 'x', label: 'X' }] })]);
  assert.equal(L.scSizeFieldOf(L.scFieldsWithSize(taken, 'points')), null, 'an id already used by another field is left alone');
  const again = L.scFieldsWithSize(L.scFieldsWithSize([], 'points'), 'tshirt');
  assert.equal(L.scSizeFieldOf(again).options[0].label, 'XS', 'the default is recomputed, not stacked');
  assert.equal(again.length, 1);
});
await test('a piece of work is sized at its choice number, and 0 with no choice or no number', () => {
  const f = L.scSizeFieldOf(L.scFieldsWithSize([], 'points'));
  assert.equal(L.scSizeOf(work({ fields: { size: 'p5' } }), f), 5);
  assert.equal(L.scSizeOf(work(), f), 0);
  assert.equal(L.scSizeOf(work({ fields: { size: 'gone' } }), f), 0);
  assert.equal(L.scSizeOf(work({ fields: { size: 'p5' } }), null), 0);
});

const SIZE = { label: 'Size', size: true, order: 0, options: [{ id: 'one', label: 'One', value: 1 }, { id: 'two', label: 'Two', value: 2 }] };
const label = (k) => k;
await test('export and import keep the flag, the numbers and the day', () => {
  const entries = [work({ done: true, column: 'done', doneOn: '2026-11-03', fields: { size: 'two' } })];
  const out = L.scExportFile(entries, { fields: L.scFieldsFrom([fieldRow('size', SIZE)]) });
  assert.equal(out.entries[0].doneOn, '2026-11-03');
  assert.equal(out.fields[0].size, true);
  assert.deepEqual(out.fields[0].options.map((o) => o.value), [1, 2]);
  const back = L.scParseFile(JSON.stringify(out), { label, datesRequired: true, fields: [] });
  assert.equal(back.problem, undefined);
  assert.equal(back.fields[0].size, true);
  assert.deepEqual(back.fields[0].options.map((o) => o.value), [1, 2]);
  assert.equal(L.scClean('x', back.entries[0]).doneOn, '2026-11-03');
});
await test('a second size field and a bad number are refused with one sentence', () => {
  const file = (fields) => JSON.stringify({ format: 'project-plan', version: 1, entries: [{ kind: 'work', title: 'A', start: '2026-11-01', end: '2026-11-02' }], fields });
  const two = L.scParseFile(file([{ id: 'a', label: 'A', size: true, options: [] }, { id: 'b', label: 'B', size: true, options: [] }]), { label, datesRequired: true, fields: [] });
  assert.equal(two.problem, 'A plan has one size field.');
  const joined = L.scParseFile(file([{ id: 'b', label: 'B', size: true, options: [] }]), { label, datesRequired: true, fields: L.scFieldsFrom([fieldRow('a', { ...SIZE })]) });
  assert.equal(joined.problem, 'A plan has one size field.', 'one the plan already has');
  const bad = L.scParseFile(file([{ id: 'a', label: 'A', size: true, options: [{ id: 'x', label: 'X', value: 1000 }] }]), { label, datesRequired: true, fields: [] });
  assert.match(bad.problem, /"value" must be a whole number from 0 to 999\.$/);
  const flag = L.scParseFile(file([{ id: 'a', label: 'A', size: 'yes', options: [] }]), { label, datesRequired: true, fields: [] });
  assert.match(flag.problem, /"size" must be true or false\.$/);
});

// ---- the actions, on the page and on the server's runner ----
const SPACE = { id: 's1', name: 'Launch' };
const world = (rows, settings = {}) => ({ space: SPACE, rows, people: [], settings: { datesRequired: true, boardColumns: 'priority', ...settings }, phases: [] });
const ref = (id) => ({ module: 'schedule', kind: 'plan', id, scope: 'space', space: 's1' });
const WK = { kind: 'work', title: 'Write docs', start: '2026-11-01', end: '2026-11-10', done: false, column: 'now', order: 'm', by: 'u-ana' };
const both = async (action, input, w) => {
  const page = await onPage('schedule', action, input, w, { name: 'Planner - Projects' });
  const run = await onRunner('schedule', action, input, w, { kinds: ['plan'], carrier: 'server' });
  assert.ok(!run.fault, `${action}: the runner faulted (${run.fault})`);
  assert.equal(run.refused, page.refused, `${action}: the same refusal`);
  return { page, run };
};
const valueOf = (r, key) => r.writes.find((x) => x.key === key).value;
await test('setDone stamps the day on the page and on the runner, and clears it', async () => {
  const { page, run } = await both('setDone', { ref: ref('wk'), done: true }, world({ 'plan:wk': WK }));
  for (const r of [page, run]) {
    assert.equal(valueOf(r, 'plan:wk').done, true);
    assert.match(valueOf(r, 'plan:wk').doneOn, /^\d{4}-\d{2}-\d{2}$/);
  }
  const was = { ...WK, done: true, column: 'done', doneOn: '2026-11-03' };
  const kept = await both('setDone', { ref: ref('wk'), done: true }, world({ 'plan:wk': was }));
  assert.equal(valueOf(kept.run, 'plan:wk').doneOn, '2026-11-03');
  const off = await both('setDone', { ref: ref('wk'), done: false }, world({ 'plan:wk': was }));
  for (const r of [off.page, off.run]) assert.equal('doneOn' in valueOf(r, 'plan:wk'), false);
});
await test('setColumn into a done column stamps the day, out of it clears it', async () => {
  const { page, run } = await both('setColumn', { ref: ref('wk'), column: 'done' }, world({ 'plan:wk': WK }));
  for (const r of [page, run]) assert.match(valueOf(r, 'plan:wk').doneOn, /^\d{4}-\d{2}-\d{2}$/);
  const was = { ...WK, done: true, column: 'done', doneOn: '2026-11-03' };
  const out = await both('setColumn', { ref: ref('wk'), column: 'next' }, world({ 'plan:wk': was }));
  for (const r of [out.page, out.run]) assert.equal('doneOn' in valueOf(r, 'plan:wk'), false);
});
await test('a size is set through `fields`, by name or id, with a stored size field or the setting\'s', async () => {
  const stored = await both('updateEntry', { ref: ref('wk'), fields: 'Size=Two' }, world({ 'plan:wk': WK, 'field:size': SIZE }));
  for (const r of [stored.page, stored.run]) assert.deepEqual(valueOf(r, 'plan:wk').fields, { size: 'two' });
  const set = await both('updateEntry', { ref: ref('wk'), fields: 'size=p8' }, world({ 'plan:wk': WK }, { sizing: 'points' }));
  for (const r of [set.page, set.run]) assert.deepEqual(valueOf(r, 'plan:wk').fields, { size: 'p8' });
  const none = await both('updateEntry', { ref: ref('wk'), fields: 'size=p8' }, world({ 'plan:wk': WK }));
  assert.ok(none.page.refused && none.run.refused, 'sizing off and no stored field: there is no size field to set');
  const add = await both('addWork', { title: 'New thing', start: '2026-11-01', end: '2026-11-05', fields: 'size=xl' }, world({}, { sizing: 'tshirt' }));
  for (const r of [add.page, add.run]) assert.deepEqual(r.writes.find((x) => x.key.startsWith('plan:')).value.fields, { size: 'xl' });
});

await test('the manifest: the sizing setting and the size key the field guard allows', () => {
  const s = manifest.settings.find((x) => x.key === 'sizing');
  assert.ok(s, 'a sizing setting');
  assert.equal(s.type, 'choice');
  assert.equal(s.default, 'off');
  assert.deepEqual(s.options.map((o) => o.value), ['off', 'points', 'tshirt']);
  assert.equal(s.template, 'default');
  const guard = manifest.guards.keys.find((g) => g.key === 'field:{id}');
  assert.deepEqual(guard.fields.size, { type: 'boolean' });
  assert.equal(guard.need, 'columns');
});
await test('the page: the size is the space\'s own, the setting is read, and a done day is stamped with the page\'s today', () => {
  assert.match(page, /sizing: s\.sizing === 'points' \|\| s\.sizing === 'tshirt' \? s\.sizing : 'off'/);
  assert.match(page, /state\.fields = scFieldsWithSize\(scFieldsFrom\(/);
  assert.doesNotMatch(page, /host\.issues\.[a-z]+\([^)]*(size|doneOn)/, 'no call to the service names a size or a done day');
  for (const call of page.match(/scSet(?:Done|Column)\([^\n]*/g) || []) assert.match(call, /today: today\(\)/, `${call.slice(0, 60)} passes today`);
  for (const call of page.match(/scSetColumnFlag\([^\n]*|scDeleteColumn\([^\n]*/g) || []) assert.match(call, /today: today\(\)/);
});

console.log(`check-schedule-sizing: ${n} tests pass`);
