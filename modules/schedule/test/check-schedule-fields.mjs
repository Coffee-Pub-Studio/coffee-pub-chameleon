#!/usr/bin/env node
/*
 * check-schedule-fields.mjs -- Planner - Projects' fields (plan-github-two-way.md, build order step 6): Area, Release status, Phase and
 * the like, each a `field:<id>` record with choices, each piece of work holding `fields: { fieldId: optionId }`.
 *   - the rules (src/schedule-lib.js): a field and a work's choices cleaned and stored, the limits (8 fields, 30 choices, 40 characters),
 *     adding, renaming, moving and deleting a field or a choice, a deleted choice taking its value off the work that had it and nothing
 *     else, the order of the fields kept, the words a card and the List show;
 *   - the Board: a filter for each field (and no one, and what is gone dropped), the rows by a field in its order, `rowsBy` kept;
 *   - the actions (src/schedule-lib-actions.js), run on the page and on the server's runner: updateEntry and addWork take `fields` by id or
 *     by name, only the fields named change, `name=` clears one, an empty input clears all, and each refusal has its sentence;
 *   - the manifest: the guard on `field:` (the columns right), the input, the hint, the clears;
 *   - the page: the editor's choices, the card, the List's columns, the filters, the rows, Edit fields with one write and Undo, Update by id,
 *     and that a choice is the space's own and is never sent anywhere.
 * The live part is tools/check-schedule-fields.mjs. Exits 1 on failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { onPage, onRunner } from '../../../tools/module-actions-harness.mjs';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(dir, ...p), 'utf8');
const L = new Function(`${read('src', 'schedule-lib.js')}\nreturn { scClean, scValue, scCleanField, scFieldValue, scFieldsFrom, scAddField, scRenameField, scDeleteField, scMoveField, scAddOption, scRenameOption, scDeleteOption, scMoveOption, scFieldsDiff, scFieldsRewrite, scFieldsParse, scFieldsApplied, scFieldWords, scBoardRows, scRowOf, scFilterEmpty, scFilterOn, scFilterClean, scFilterMatch, scFilterSeed, SC_NONE, scCleanBoard, scBoardValue, scUpdate, SC_FIELDS_MAX, SC_FIELD_OPTIONS_MAX };`)();
const manifest = JSON.parse(read('module.json'));
const page = read('src', 'schedule.js');
const html = read('src', 'schedule.html');

let n = 0;
const test = async (name, fn) => { try { await fn(); n += 1; } catch (e) { process.exitCode = 1; console.error(`FAIL ${name}\n${e.stack || e}`); } };
const E = (id, o) => L.scClean(id, o);
const PHASE = { id: 'phase', label: 'Phase', order: 1, options: [{ id: 'first', label: 'First' }, { id: 'second', label: 'Second' }] };
const AREA = { id: 'area', label: 'Area', order: 0, options: [{ id: 'core', label: 'Core' }, { id: 'planner', label: 'Planner' }] };
const FIELDS = [AREA, PHASE];

await test('a field is cleaned and stored with its choices, its place and its limits', () => {
  assert.deepEqual(L.scCleanField('phase', { label: ' Phase ', options: [{ id: 'a', label: 'A' }, { id: 'a', label: 'dup' }, { id: 'B', label: 'bad id' }, { id: 'c', label: ' ' }, { id: 'd', label: 'D' }], order: 2 }), { id: 'phase', label: 'Phase', options: [{ id: 'a', label: 'A' }, { id: 'd', label: 'D' }], order: 2 });
  assert.equal(L.scCleanField('Bad Id', { label: 'x' }), null, 'a bad id');
  assert.equal(L.scCleanField('phase', { label: ' ' }), null, 'no label');
  assert.equal(L.scCleanField('phase', 'x'), null);
  assert.equal(L.scCleanField('phase', { label: 'x'.repeat(60) }).label.length, 40, 'a label is cut at 40');
  assert.equal(L.scCleanField('phase', { label: 'P', options: Array.from({ length: 40 }, (_, i) => ({ id: `o${i}`, label: `O${i}` })) }).options.length, 30, '30 choices at most');
  assert.deepEqual(L.scFieldValue(PHASE), { id: 'phase', label: 'Phase', options: PHASE.options, order: 1 });
  const rows = [{ key: 'field:phase', value: PHASE }, { key: 'field:area', value: AREA }, { key: 'board:main', value: {} }, { key: 'field:Bad Id', value: AREA }, { key: 'field:x', value: 'no' }];
  assert.deepEqual(L.scFieldsFrom(rows).map((f) => f.id), ['area', 'phase'], 'in their order, not the order the rows came in');
  assert.equal(L.scFieldsFrom(Array.from({ length: 12 }, (_, i) => ({ key: `field:f${i}`, value: { label: `F${i}`, order: i } }))).length, 8, 'at most 8');
});

await test('work holds its choices; a note and a milestone hold none; only ids are kept', () => {
  const w = E('w', { kind: 'work', title: 'W', fields: { phase: 'first', area: 'core', Bad: 'x', n: 4, bad2: 'Bad Value' } });
  assert.deepEqual(w.fields, { phase: 'first', area: 'core' });
  assert.deepEqual(L.scValue(w).fields, { phase: 'first', area: 'core' });
  assert.equal('fields' in L.scValue(E('w', { kind: 'work', title: 'W' })), false, 'nothing empty is stored');
  assert.deepEqual(E('m', { kind: 'milestone', title: 'M', fields: { phase: 'first' } }).fields, {});
  assert.deepEqual(E('n', { kind: 'note', title: 'N', fields: { phase: 'first' } }).fields, {});
  assert.deepEqual(E('w', { kind: 'work', title: 'W', fields: 'phase=first' }).fields, {});
  const nine = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i}`, 'x']));
  assert.equal(Object.keys(E('w', { kind: 'work', title: 'W', fields: nine }).fields).length, 8);
  assert.deepEqual(L.scFieldWords(w, FIELDS), [{ id: 'area', field: 'Area', label: 'Core' }, { id: 'phase', field: 'Phase', label: 'First' }], 'in the fields\' order');
  assert.deepEqual(L.scFieldWords(E('w', { kind: 'work', title: 'W', fields: { phase: 'gone' } }), FIELDS), [], 'a choice the field no longer has is not shown');
});

await test('adding, renaming, moving and deleting a field and its choices', () => {
  let f = [];
  let r = L.scAddField(f, 'Release status'); f = r.fields;
  assert.equal(r.field.id, 'release-status');
  assert.equal(L.scAddField(f, 'Release status').field.id, 'release-status-2', 'a number is added when the id is taken');
  assert.equal(L.scAddField(f, ' ').problem, 'Give it a name.');
  assert.equal(L.scAddField(f, 'x'.repeat(41)).problem, 'A name is at most 40 characters.');
  r = L.scAddField(f, 'Phase'); f = r.fields;
  assert.deepEqual(f.map((x) => [x.id, x.order]), [['release-status', 0], ['phase', 1]]);
  f = L.scMoveField(f, 'phase', -1).fields;
  assert.deepEqual(f.map((x) => [x.id, x.order]), [['phase', 0], ['release-status', 1]], 'the place is rewritten');
  assert.deepEqual(L.scMoveField(f, 'phase', -1).fields.map((x) => x.id), ['phase', 'release-status'], 'at the edge nothing moves');
  f = L.scRenameField(f, 'phase', 'Stage').fields;
  assert.equal(f[0].label, 'Stage');
  assert.equal(f[0].id, 'phase', 'the id stays, so every work keeps its choice');
  f = L.scAddOption(f, 'phase', 'After first release (Thomas, 2026-11-15)').fields;
  assert.equal(f[0].options[0].label.length, 40, 'the longest label there is');
  assert.equal(L.scAddOption(f, 'phase', 'x'.repeat(41)).problem, 'A name is at most 40 characters.');
  assert.equal(L.scAddOption(f, 'zz', 'x').problem, 'That field is not there.');
  f = L.scAddOption(f, 'phase', 'Second').fields;
  f = L.scMoveOption(f, 'phase', 'second', -1).fields;
  assert.deepEqual(f[0].options.map((o) => o.id), ['second', f[0].options[1].id]);
  f = L.scRenameOption(f, 'phase', 'second', 'Next').fields;
  assert.equal(f[0].options[0].label, 'Next');
  f = L.scDeleteOption(f, 'phase', 'second').fields;
  assert.equal(f[0].options.length, 1);
  assert.equal(L.scDeleteOption(f, 'phase', 'second').problem, 'That choice is not there.');
  assert.deepEqual(L.scDeleteField(f, 'phase').fields.map((x) => [x.id, x.order]), [['release-status', 0]]);
  let big = [];
  for (let i = 0; i < 8; i += 1) big = L.scAddField(big, `F${i}`).fields;
  assert.equal(L.scAddField(big, 'Ninth').problem, 'A plan has at most 8 fields.');
  let opts = L.scAddField([], 'P').fields;
  for (let i = 0; i < 30; i += 1) opts = L.scAddOption(opts, 'p', `O${i}`).fields;
  assert.equal(L.scAddOption(opts, 'p', 'One more').problem, 'A field has at most 30 choices.');
});

await test('a deleted choice or field takes its value off the work that had it, and nothing else', () => {
  const a = E('a', { kind: 'work', title: 'A', fields: { phase: 'first', area: 'core' } });
  const b = E('b', { kind: 'work', title: 'B', fields: { phase: 'second' } });
  const c = E('c', { kind: 'work', title: 'C', fields: { other: 'x' } });
  const m = E('m', { kind: 'milestone', title: 'M' });
  const noFirst = L.scDeleteOption(FIELDS, 'phase', 'first').fields;
  const r = L.scFieldsRewrite([a, b, c, m], FIELDS, noFirst);
  assert.deepEqual(r.map((e) => [e.id, e.fields]), [['a', { area: 'core' }]], 'only the work that had it');
  assert.deepEqual(a.fields, { phase: 'first', area: 'core' }, 'the entry it was given is not changed');
  const noArea = L.scDeleteField(FIELDS, 'area').fields;
  assert.deepEqual(L.scFieldsRewrite([a, b, c], FIELDS, noArea).map((e) => [e.id, e.fields]), [['a', { phase: 'first' }]]);
  assert.deepEqual(L.scFieldsRewrite([a, b, c], FIELDS, FIELDS), [], 'nothing changed, nothing to write');
  assert.deepEqual(L.scFieldsRewrite([c], FIELDS, noArea), [], 'a value for a field the plan never had is left as it is');
});

await test('what Save writes: the fields that changed, their place, the ones that went', () => {
  const same = L.scFieldsDiff(FIELDS, FIELDS);
  assert.deepEqual([same.write, same.remove], [[], []]);
  const added = L.scAddField(FIELDS, 'Release status').fields;
  const d = L.scFieldsDiff(FIELDS, added);
  assert.deepEqual(d.write.map((f) => [f.id, f.order]), [['release-status', 2]]);
  const moved = L.scMoveField(FIELDS, 'phase', -1).fields;
  assert.deepEqual(L.scFieldsDiff(FIELDS, moved).write.map((f) => [f.id, f.order]), [['phase', 0], ['area', 1]], 'both places are written');
  const gone = L.scDeleteField(FIELDS, 'area').fields;
  const g = L.scFieldsDiff(FIELDS, gone);
  assert.deepEqual([g.remove, g.write.map((f) => [f.id, f.order])], [['area'], [['phase', 0]]]);
});

await test('a fields input: by id or by name, only those named, name= clears one, empty clears all, each refusal says why', () => {
  const p = (t) => L.scFieldsParse(t, FIELDS);
  assert.deepEqual(p('area=core; phase=First'), { values: { area: 'core', phase: 'first' }, all: false }, 'a name works as well as an id');
  assert.deepEqual(p('Area = Planner\nphase=second').values, { area: 'planner', phase: 'second' });
  assert.deepEqual(p('phase='), { values: { phase: '' }, all: false });
  assert.deepEqual(p(''), { values: {}, all: true });
  assert.equal(p('area').problem, 'Write each field as name=choice, such as area=core. "area" is not.');
  assert.equal(p('shape=round').problem, 'There is no field called shape. The fields are area, phase.');
  assert.equal(p('phase=third').problem, 'Phase has no choice called third. Its choices are first, second.');
  assert.equal(L.scFieldsParse('area=core', []).problem, 'There is no field called area. This plan has no fields yet.');
  assert.equal(p(4).problem, 'The fields must be text, such as area=core; phase=first.');
  assert.deepEqual(L.scFieldsApplied({ area: 'core', phase: 'first' }, p('phase=second')), { area: 'core', phase: 'second' });
  assert.deepEqual(L.scFieldsApplied({ area: 'core', phase: 'first' }, p('area=')), { phase: 'first' });
  assert.deepEqual(L.scFieldsApplied({ area: 'core' }, p('')), {});
  const w = E('w', { kind: 'work', title: 'W', start: '2026-11-01', end: '2026-11-02', fields: { area: 'core' } });
  const u = L.scUpdate(w, { fields: 'phase=first' }, { fieldDefs: FIELDS, label: (k) => k });
  assert.deepEqual(u.entry.fields, { area: 'core', phase: 'first' });
  assert.equal(L.scUpdate(E('m', { kind: 'milestone', title: 'M', start: '2026-11-01' }), { fields: 'phase=first' }, { fieldDefs: FIELDS, label: (k) => k }).problem, 'A milestone has no fields.');
});

await test('the Board filter has one choice for each field, and what is gone is dropped', () => {
  const w1 = E('w1', { kind: 'work', title: 'One', fields: { phase: 'first', area: 'core' } });
  const w2 = E('w2', { kind: 'work', title: 'Two', fields: { phase: 'second' } });
  const w3 = E('w3', { kind: 'work', title: 'Three' });
  const by = new Map();
  const f = (o) => ({ ...L.scFilterEmpty(), ...o });
  assert.deepEqual(L.scFilterEmpty().fields, {});
  assert.equal(L.scFilterOn(f({ fields: { phase: 'first' } })), true);
  const pass = (fl) => [w1, w2, w3].filter((e) => L.scFilterMatch(e, fl, by)).map((e) => e.id);
  assert.deepEqual(pass(f({ fields: { phase: 'first' } })), ['w1']);
  assert.deepEqual(pass(f({ fields: { phase: L.SC_NONE } })), ['w3'], 'no choice');
  assert.deepEqual(pass(f({ fields: { phase: 'second', area: L.SC_NONE } })), ['w2'], 'fields combine with and');
  assert.deepEqual(pass(f({ fields: { phase: 'first' }, who: [L.SC_NONE] })), ['w1'], 'and with the rest');
  const have = { who: new Set(), tags: new Set(), phases: new Set(), milestones: new Set(), fields: new Map([['phase', new Set(['first', 'second'])]]) };
  assert.deepEqual(L.scFilterClean({ fields: { phase: 'first', area: 'core', gone: 'x', p2: 4 } }, have).fields, { phase: 'first' }, 'a field or choice that is gone is dropped');
  assert.deepEqual(L.scFilterClean({ fields: { phase: L.SC_NONE } }, have).fields, { phase: L.SC_NONE });
  assert.deepEqual(L.scFilterClean({ fields: { phase: 'first' } }, null).fields, { phase: 'first' }, 'read from the browser as it was');
  assert.deepEqual(L.scFilterClean({ fields: ['x'] }, null).fields, {}, 'not the shape');
  assert.deepEqual(L.scFilterSeed(f({ fields: { phase: 'first', area: L.SC_NONE } })).fields, { phase: 'first' }, 'new work starts with the choice it is filtered by');
  assert.equal('fields' in L.scFilterSeed(f({ fields: { area: L.SC_NONE } })), false);
});

await test('the Board has a row for each choice of a field, in the field\'s order, none for a choice nobody has', () => {
  const works = [E('w1', { kind: 'work', title: 'One', fields: { phase: 'second' } }), E('w2', { kind: 'work', title: 'Two', fields: { phase: 'first' } }), E('w3', { kind: 'work', title: 'Three' }), E('w4', { kind: 'work', title: 'Four', fields: { phase: 'gone' } })];
  const r = L.scBoardRows(works, 'field:phase', works, () => '', '', FIELDS);
  assert.deepEqual(r.rows, [{ id: 'first', label: 'First' }, { id: 'second', label: 'Second' }]);
  assert.equal(r.of.get('w1'), 'second');
  assert.equal(r.of.get('w3'), '', 'no choice: the last row');
  assert.equal(r.of.get('w4'), '', 'a choice the field no longer has: the last row');
  assert.deepEqual(L.scBoardRows(works, 'field:nothing', works, () => '', '', FIELDS), { rows: [], of: new Map() }, 'a field that is not there draws no rows');
  assert.equal(L.scRowOf(works[0], 'field:phase', new Map()), 'second');
  const board = { id: 'main', name: 'B', columns: [{ id: 'todo', label: 'To do' }, { id: 'done', label: 'Done', done: true }], rowsBy: 'field:phase' };
  assert.equal(L.scCleanBoard('main', board).rowsBy, 'field:phase', 'kept');
  assert.equal(L.scBoardValue(L.scCleanBoard('main', board)).rowsBy, 'field:phase');
  assert.equal(L.scCleanBoard('main', { ...board, rowsBy: 'field:Bad Id' }).rowsBy, undefined);
  assert.equal(L.scCleanBoard('main', { ...board, rowsBy: 'tag' }).rowsBy, undefined);
});

// ---- the actions, on the page and on the server's runner ----
const sorted = (writes) => (writes || []).slice().sort((a, b) => (a.key < b.key ? -1 : 1));
async function same(action, input, world) {
  const r = { page: await onPage('schedule', action, input, world, { name: 'Planner - Projects' }), runner: await onRunner('schedule', action, input, world, { kinds: ['plan'], carrier: 'server' }) };
  assert.ok(!r.runner.fault, `${action}: the runner faulted (${r.runner.fault})`);
  if (r.page.refused !== undefined || r.runner.refused !== undefined) { assert.equal(r.runner.refused, r.page.refused, `${action}: the same refusal`); return r.page; }
  assert.deepEqual(sorted(r.runner.writes), sorted(r.page.writes), `${action}: the same writes`);
  return r.page;
}
const SPACE = { id: 's1', name: 'Launch' };
const world = (rows) => ({ space: SPACE, rows, people: [], settings: { datesRequired: true }, phases: [] });
const ref = (id) => ({ module: 'schedule', kind: 'plan', id, scope: 'space', space: 's1' });
const WK = { kind: 'work', title: 'Write docs', start: '2026-11-01', end: '2026-11-10', done: false, order: 'm', by: 'u-ana', fields: { area: 'core' } };
const rows = () => ({ 'plan:wk': WK, 'field:area': AREA, 'field:phase': PHASE });

await test('updateEntry sets fields by id or by name, changes only those named, and says why when it cannot', async () => {
  const r = await same('updateEntry', { ref: ref('wk'), fields: 'Phase=first' }, world(rows()));
  assert.deepEqual(r.writes.find((w) => w.key === 'plan:wk').value.fields, { area: 'core', phase: 'first' });
  const clear = await same('updateEntry', { ref: ref('wk'), fields: 'area=' }, world(rows()));
  assert.equal('fields' in clear.writes.find((w) => w.key === 'plan:wk').value, false, 'the last choice cleared: nothing stored');
  const all = await same('updateEntry', { ref: ref('wk'), fields: '' }, world(rows()));
  assert.equal('fields' in all.writes.find((w) => w.key === 'plan:wk').value, false, 'an empty input clears all');
  const bad = await same('updateEntry', { ref: ref('wk'), fields: 'phase=third' }, world(rows()));
  assert.equal(bad.refused, 'Phase has no choice called third. Its choices are first, second.');
  const none = await same('updateEntry', { ref: ref('wk'), fields: 'phase=first' }, world({ 'plan:wk': WK }));
  assert.equal(none.refused, 'There is no field called phase. This plan has no fields yet.');
  const ms = await same('updateEntry', { ref: ref('ms'), fields: 'phase=first' }, world({ ...rows(), 'plan:ms': { kind: 'milestone', title: 'Ship', start: '2026-12-01', done: false, order: 'a' } }));
  assert.equal(ms.refused, 'A milestone has no fields.');
});

await test('addWork may carry fields, checked first', async () => {
  const r = await same('addWork', { title: 'Test', start: '2026-11-02', fields: 'area=planner; phase=Second' }, world(rows()));
  assert.deepEqual(r.writes.find((w) => w.key === 'plan:n1').value.fields, { area: 'planner', phase: 'second' });
  const bad = await same('addWork', { title: 'Test', start: '2026-11-02', fields: 'area=zzz' }, world(rows()));
  assert.equal(bad.refused, 'Area has no choice called zzz. Its choices are core, planner.');
});

await test('the manifest: the field guard needs the columns right, the input is text and can be cleared', () => {
  const g = manifest.guards.keys.find((k) => k.key === 'field:{id}');
  assert.equal(g.need, 'columns');
  assert.deepEqual(Object.keys(g.fields), ['id', 'label', 'options', 'order', 'size']);
  assert.equal(g.fields.options.maxLength, 30);
  assert.equal(g.fields.label.maxLength, 40);
  assert.equal(manifest.guards.keys.find((k) => k.key === 'board:{id}').fields.rowsBy.maxLength, 48, 'room for field: and an id');
  const by = Object.fromEntries(manifest.actions.provides.map((a) => [a.name, a]));
  assert.equal(by.updateEntry.input.fields, 'text?');
  assert.ok(by.updateEntry.clears.includes('fields'));
  assert.equal(by.addWork.input.fields, 'text?');
  for (const a of ['updateEntry', 'addWork']) assert.ok(by[a].inputHints.fields.length <= 200 && by[a].inputHints.fields.includes('name=choice'), a);
  assert.equal(manifest.permissions.find((p) => p.key === 'columns').label, "Change the board's columns and fields");
  assert.equal(manifest.permissions.find((p) => p.key === 'edit').default.member, true, 'setting a choice needs edit');
});

await test('the page: the editor, the card, the List, the filters, the rows', () => {
  assert.match(html, /id="f-fields"/);
  assert.match(page, /sel\.dataset\.field = fd\.id/, 'one select for each field');
  assert.match(page, /\$\('f-fields'\)\.querySelectorAll\('select\[data-field\]'\)/);
  assert.match(page, /fields: kind === 'work' \? fieldsFromForm\(/, 'a save carries the choices');
  assert.match(page, /scFieldWords\(e, state\.fields\)/);
  assert.match(page, /className = 'bd-fields'/, 'the card shows them, quietly');
  assert.match(html, /data-slot="fields-wrap"/);
  assert.match(page, /className = 'fcell'/, 'a cell for each field in the List');
  assert.match(page, /id: `f-field-\$\{i\}`/, 'a filter for each field');
  assert.match(page, /scBoardRows\(v\.shown, rowsBy, list\(\), nameOf, 'Someone who left', state\.fields\)/);
  assert.match(html, /id="rows-field"/);
  assert.match(page, /\$\('rows-field'\)\.addEventListener\('change'/);
  assert.match(page, /function rowsNow\(b\)/);
});

await test('the page: Edit fields is for the columns right, one write with Undo, and a gone choice is taken off the work', () => {
  assert.match(page, /const canFields = \(\) => host\.can\('columns'\)/);
  assert.match(page, /hide\(\$\('fields-edit'\), !canFields\(\)\)/);
  assert.match(page, /function openFieldsEditor\(\) \{\s*if \(!canFields\(\)\) return;/);
  const save = page.slice(page.indexOf("$('fields-form').addEventListener('submit'"), page.indexOf('async function writeField'));
  assert.ok(save.indexOf('await writeField(') < save.indexOf('await write(e,'), 'the fields are written first, then the work');
  assert.match(save, /scFieldsRewrite\(list\(\), state\.fields, draft\)/);
  assert.match(save, /putBack\(plan\)/, 'a failure puts it back');
  assert.match(save, /offerUndo\(plan, 'Changed the fields\.'\)/);
  assert.match(page, /for \(const f of plan\.fields \|\| \[\]\)/, 'Undo puts the fields back');
});

await test('the page: a choice is the space\'s own, set with edit, never sent to GitHub, and a followed plan\'s days can be late', () => {
  assert.match(page, /const canSetFields = \(e\) => canEdit && \(!pulled\(e\) \|\| \(writeOn\(\) && isIssue\(e\)\)\)/);
  assert.match(page, /if \(ed\.fieldsOnly\) return \{ \.\.\.e, fields: fieldsFromForm\(e\.fields\), end: endOf\(e\), \.\.\.owned \}/, 'someone who may not change GitHub still sets the choices (and the target date, the space\'s own, and Owners)');
  assert.match(page, /const pageLate = \(e\) => !\(e\.source && \(!writeOn\(\) \|\| !\(e\.end > e\.start\)\)\) && scLate\(e, today\(\)\)/, 'followed days are late only where changes go back, and only past a target after the start (check-schedule-late.mjs runs it)');
  assert.doesNotMatch(page, /host\.issues\.[a-z]+\([^)]*fields/, 'no call to the service names a field');
});

await test('the page: Update by id is its own mode, for edit, with the file\'s fields stored first and Undo', () => {
  assert.match(page, /id: 'import-update', label: 'Import JSON: update by id'/);
  assert.match(page, /if \(canEdit\) items\.push\(\{ id: 'import-update'/);
  assert.match(page, /scParseFile\(text, \{[^}]*fields: state\.fields, mode \}\)/);
  assert.match(page, /if \(mode === 'update'\) \{ await updateById\(file, parsed\); return; \}/);
  assert.match(page, /scApplyUpdate\(parsed\.entries, list\(\)\)/);
  assert.match(page, /applyImport\(r\.entries, 'update', null, parsed\.fields\)/);
  assert.match(page, /offerUndo\(plan, `Updated \$\{n\}/);
  assert.match(page, /if \(canEdit\) items\.push\(\{ id: 'check', label: 'Check file'/, 'Check file reads such a file in a followed plan too');
  const apply = page.slice(page.indexOf('async function applyImport'), page.indexOf('function offerUndo'));
  assert.ok(apply.indexOf('writeField(f.id') < apply.indexOf('() => write(e,'), 'the fields before the entries');
});

if (process.exitCode) process.exit(1);
console.log(`check-schedule-fields: OK (${n} checks)`);
