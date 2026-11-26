#!/usr/bin/env node
/*
 * check-schedule-schema.mjs -- src/project-plan.schema.json (JSON Schema, draft 2020-12) against the importer
 * (src/schedule-lib-file.js) so the two cannot drift.
 *   - A small checker for exactly the keywords the schema uses (no dependency) is tried on known-good and known-bad samples.
 *   - The example in FORMAT.md and what Export writes are valid under the schema, and the importer takes them.
 *   - A set of bad files, one fault each: the importer refuses every one; the schema refuses each it can express; and the
 *     ones it cannot (a real day, end before start, links between entries, dates needed...) are named, so a new fault
 *     cannot be left out of either by accident. Whatever the schema refuses the importer refuses too.
 * Usage: node modules/schedule/test/check-schedule-schema.mjs. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => fs.readFileSync(path.join(dir, 'src', f), 'utf8');
const L = new Function(`${src('schedule-lib.js')}\n${src('schedule-lib-file.js')}\nreturn { scClean, scExportFile, scParseFile, scImportEntries };`)();
const schema = JSON.parse(src('project-plan.schema.json'));

// ---- the checker: the keywords the schema uses, nothing more ----
const KEYWORDS = new Set(['$schema', '$comment', '$defs', '$ref', 'title', 'description', 'type', 'const', 'enum', 'pattern', 'maxLength', 'minLength', 'minimum', 'maximum', 'minItems', 'maxItems', 'items', 'properties', 'required', 'allOf', 'if', 'then']);
function unknownKeywords(s, out = []) {
  if (Array.isArray(s)) { s.forEach((x) => unknownKeywords(x, out)); return out; }
  if (!s || typeof s !== 'object') return out;
  for (const [k, v] of Object.entries(s)) {
    if (!KEYWORDS.has(k)) out.push(k);
    if (k === 'properties' || k === '$defs') Object.values(v).forEach((x) => unknownKeywords(x, out));
    else if (['items', 'if', 'then', 'allOf'].includes(k)) unknownKeywords(v, out);
  }
  return out;
}
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
function valid(v, s, root = s) {
  if (s.$ref) { const t = s.$ref.replace('#/', '').split('/').reduce((o, k) => o[k], root); if (!valid(v, t, root)) return false; }
  if (s.type) {
    const ok = [].concat(s.type).some((t) => typeOf(v) === t || (t === 'number' && typeof v === 'number') || (t === 'object' && typeOf(v) === 'object' && !Array.isArray(v)));
    if (!ok) return false;
  }
  if ('const' in s && v !== s.const) return false;
  if (s.enum && !s.enum.includes(v)) return false;
  if (typeof v === 'string') {
    if (s.pattern && !new RegExp(s.pattern).test(v)) return false;
    if (s.maxLength !== undefined && [...v].length > s.maxLength) return false;
    if (s.minLength !== undefined && [...v].length < s.minLength) return false;
  }
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) return false;
    if (s.maximum !== undefined && v > s.maximum) return false;
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) return false;
    if (s.maxItems !== undefined && v.length > s.maxItems) return false;
    if (s.items && !v.every((x) => valid(x, s.items, root))) return false;
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const k of s.required || []) if (!(k in v)) return false;
    for (const [k, sub] of Object.entries(s.properties || {})) if (k in v && !valid(v[k], sub, root)) return false;
  }
  for (const a of s.allOf || []) if (!valid(v, a, root)) return false;
  if (s.if && valid(v, s.if, root) && s.then && !valid(v, s.then, root)) return false;
  return true;
}

let passed = 0;
const fails = [];
function test(name, fn) { try { fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }

test('the schema is draft 2020-12 and uses only the keywords the checker knows', () => {
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.deepEqual(unknownKeywords(schema), []);
  assert.ok(schema.$comment.includes('FORMAT.md') && schema.description.length > 100);
});
test('the checker, on small known samples', () => {
  const t = { type: 'object', required: ['a'], properties: { a: { type: ['string', 'null'], maxLength: 2, pattern: '^[a-z]*$' }, n: { type: 'integer', minimum: 0, maximum: 5 }, l: { type: 'array', maxItems: 2, items: { enum: ['x', 'y'] } }, k: { const: 1 } }, allOf: [{ if: { properties: { k: { const: 1 } }, required: ['k'] }, then: { required: ['n'] } }] };
  for (const good of [{ a: 'ab' }, { a: null }, { a: '', n: 3, l: ['x'] }, { a: 'a', k: 1, n: 0 }]) assert.equal(valid(good, t), true, JSON.stringify(good));
  for (const bad of [{}, { a: 'abc' }, { a: 'A' }, { a: 5 }, { a: 'a', n: 1.5 }, { a: 'a', n: 6 }, { a: 'a', l: ['x', 'y', 'x'] }, { a: 'a', l: ['z'] }, { a: 'a', k: 1 }, [], 'x']) assert.equal(valid(bad, t), false, JSON.stringify(bad));
});

const doc = src('FORMAT.md');
const example = JSON.parse([...doc.matchAll(/```json\n([\s\S]*?)\n```/g)][0][1]);
const opts = { label: (k) => k, datesRequired: true };
const importerTakes = (text) => !L.scParseFile(text, opts).problem;

test('FORMAT.md names the schema', () => assert.ok(doc.includes('project-plan.schema.json')));
test('the FORMAT.md example is valid under the schema and the importer', () => {
  assert.equal(valid(example, schema), true);
  assert.equal(importerTakes(JSON.stringify(example)), true);
});
test('what Export writes is valid under the schema', () => {
  const made = L.scImportEntries(example.entries, { mode: 'replace', existing: [], newId: (() => { let n = 0; return () => `n${(n += 1)}`; })(), orderAfter: (p) => (p ? `${p}V` : 'V'), by: 'me' });
  made[1] = L.scClean(made[1].id, { ...made[1], ref: { module: 'todo', kind: 'task', id: 't1' }, owners: ['u1'], tags: ['t'], phase: 'build' });
  made[3] = L.scClean(made[3].id, { ...made[3], ticked: true });
  const file = JSON.parse(JSON.stringify(L.scExportFile(made, { module: 'schedule' })));
  assert.equal(valid(file, schema), true);
  assert.equal(importerTakes(JSON.stringify(file)), true);
});

// One fault each. inexpressible: why the schema cannot say it (the importer must still refuse it).
const m = (o = {}) => ({ id: 'a', kind: 'milestone', title: 'M', start: '2026-03-01', ...o });
const w = (o = {}) => ({ id: 'b', kind: 'work', title: 'W', start: '2026-03-01', end: '2026-03-05', ...o });
const wrap = (entries, head = {}) => ({ format: 'project-plan', version: 1, entries, ...head });
const BOARD = { id: 'main', name: 'Board', field: 'column', columns: [{ id: 'todo', label: 'To do' }, { id: 'done', label: 'Done', done: true }] };
const BAD = [
  ['not an object at the top', [], null],
  ['wrong format', wrap([m()], { format: 'goal-plan' }), null],
  ['wrong version', wrap([m()], { version: 2 }), null],
  ['no entries key', { format: 'project-plan', version: 1 }, null],
  ['entries not a list', wrap({}), null],
  ['no entries', wrap([]), null],
  ['501 entries', wrap(Array.from({ length: 501 }, (_, i) => ({ kind: 'note', title: `n${i}` }))), null],
  ['an entry that is a number', wrap([5]), null],
  ['bad id', wrap([m({ id: 'bad id' })]), null],
  ['id too long', wrap([m({ id: 'x'.repeat(65) })]), null],
  ['unknown kind', wrap([m({ kind: 'task' })]), null],
  ['no kind', wrap([{ title: 'x' }]), null],
  ['no title', wrap([{ kind: 'note' }]), null],
  ['blank title', wrap([{ kind: 'note', title: '   ' }]), null],
  ['title 121', wrap([m({ title: 'x'.repeat(121) })]), null],
  ['title a number', wrap([m({ title: 4 })]), null],
  ['notes 2001', wrap([m({ notes: 'x'.repeat(2001) })]), null],
  ['notes a number', wrap([m({ notes: 4 })]), null],
  ['start a number', wrap([m({ start: 20260301 })]), null],
  ['start badly written', wrap([m({ start: '26-3-1' })]), null],
  ['end badly written', wrap([w({ end: 'soon' })]), null],
  ['owners not a list', wrap([w({ owners: 'me' })]), null],
  ['owners holds a number', wrap([w({ owners: [1] })]), null],
  ['waitsOn 51', wrap([m({ waitsOn: Array.from({ length: 51 }, (_, i) => `x${i}`) })]), null],
  ['tags not a list', wrap([m({ tags: 'a' })]), null],
  ['done a word', wrap([m({ done: 'yes' })]), null],
  ['ticked a word', wrap([m({ ticked: 'yes' })]), null],
  ['phase in capitals', wrap([m({ phase: 'Bad Phase' })]), null],
  ['order with a dash', wrap([m({ order: 'a-b' })]), null],
  ['by a number', wrap([m({ by: 5 })]), null],
  ['parent a number', wrap([m({ parent: 5 })]), null],
  ['progress 101', wrap([m({ progress: 101 })]), null],
  ['progress 1.5', wrap([m({ progress: 1.5 })]), null],
  ['ref a number', wrap([m({ ref: 4 })]), null],
  ['ref without an id', wrap([m({ ref: { module: 'a', kind: 'b' } })]), null],
  ['day that is not a day', wrap([m({ start: '2026-02-30' })]), 'a real day'],
  ['day before 1900', wrap([m({ start: '1899-12-31' })]), 'the years 1900 to 2200'],
  ['day after 2200', wrap([m({ start: '2201-01-01' })]), 'the years 1900 to 2200'],
  ['end before start', wrap([w({ start: '2026-03-05', end: '2026-03-01' })]), 'comparing two fields'],
  ['id used twice', wrap([m({ id: 'a' }), m({ id: 'a' })]), 'ids that are unique across entries'],
  ['parent not in the file', wrap([m({ parent: 'nowhere' })]), 'names that point into the file'],
  ['part of itself', wrap([m({ parent: 'a' })]), 'names that point into the file'],
  ['parent is work', wrap([w(), m({ id: 'c', parent: 'b' })]), 'the kind of the entry named'],
  ['parents in a loop', wrap([m({ id: 'a', parent: 'b' }), m({ id: 'b', parent: 'a' })]), 'loops'],
  ['waitsOn not in the file', wrap([m({ waitsOn: ['zzz'] })]), 'names that point into the file'],
  ['waits on itself', wrap([m({ waitsOn: ['a'] })]), 'names that point into the file'],
  ['waits on a note', wrap([{ id: 'n', kind: 'note', title: 'N' }, m({ waitsOn: ['n'] })]), 'the kind of the entry named'],
  ['waitsOn loop', wrap([m({ id: 'a', waitsOn: ['b'] }), m({ id: 'b', waitsOn: ['a'] })]), 'loops'],
  ['dates needed, milestone without a day', wrap([{ kind: 'milestone', title: 'M' }]), 'a setting of the plan'],
  ['column in capitals', wrap([w({ column: 'Doing Now' })]), null],
  ['column a number', wrap([w({ column: 4 })]), null],
  ['boards not a list', wrap([m()], { boards: {} }), null],
  ['two boards', wrap([m()], { boards: [BOARD, { ...BOARD, id: 'second' }] }), null],
  ['board without columns', wrap([m()], { boards: [{ id: 'main', name: 'B' }] }), null],
  ['board with one column', wrap([m()], { boards: [{ id: 'main', columns: [{ id: 'done', label: 'Done', done: true }] }] }), null],
  ['board with 13 columns', wrap([m()], { boards: [{ id: 'main', columns: Array.from({ length: 13 }, (_, i) => ({ id: `c${i}`, label: `C${i}`, done: i === 0 })) }] }), null],
  ['board id in capitals', wrap([m()], { boards: [{ ...BOARD, id: 'Main' }] }), null],
  ['board field other', wrap([m()], { boards: [{ ...BOARD, field: 'status' }] }), null],
  ['board rowsBy other', wrap([m()], { boards: [{ ...BOARD, rowsBy: 'tag' }] }), null],
  ['column label empty', wrap([m()], { boards: [{ ...BOARD, columns: [{ id: 'a', label: ' ' }, BOARD.columns[1]] }] }), null],
  ['column label 41', wrap([m()], { boards: [{ ...BOARD, columns: [{ id: 'a', label: 'x'.repeat(41) }, BOARD.columns[1]] }] }), null],
  ['column done a word', wrap([m()], { boards: [{ ...BOARD, columns: [{ id: 'a', label: 'A', done: 'yes' }, BOARD.columns[1]] }] }), null],
  ['column id used twice', wrap([m()], { boards: [{ ...BOARD, columns: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B', done: true }] }] }), 'ids that are unique across entries'],
  ['board with no done column', wrap([m()], { boards: [{ ...BOARD, columns: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }] }), 'a rule across the columns'],
  ['board with only done columns', wrap([m()], { boards: [{ ...BOARD, columns: [{ id: 'a', label: 'A', done: true }, { id: 'b', label: 'B', done: true }] }] }), 'a rule across the columns'],
  ['dates needed, work without days', wrap([{ kind: 'work', title: 'W' }]), 'a setting of the plan'],
];
test('every bad file: the importer refuses it, and the schema refuses what it can express', () => {
  const unexpressed = [];
  for (const [name, file, why] of BAD) {
    const text = JSON.stringify(file);
    assert.equal(importerTakes(text), false, `the importer should refuse: ${name}`);
    const ok = valid(file, schema);
    if (why) { unexpressed.push(name); continue; }
    assert.equal(ok, false, `the schema should refuse: ${name}`);
  }
  assert.ok(unexpressed.length >= 10, 'the faults the schema cannot say are listed');
});
test('what the schema cannot say is accepted by the schema only (it is never stricter than the importer)', () => {
  for (const [name, file, why] of BAD) {
    if (!why) continue;
    assert.equal(valid(file, schema), true, `the schema should leave this to the importer: ${name}`);
  }
});
test('good variants: the schema and the importer agree', () => {
  const GOOD = [
    wrap([{ kind: 'note', title: 'Alone' }]),
    wrap([m({ id: null, notes: null, done: null, phase: '', order: '', parent: null, ref: null })]),
    wrap([m({ start: '1900-01-01' }), m({ id: 'z', start: '2200-12-31' })]),
    wrap([w({ start: undefined, end: '2026-03-05' })]),
    wrap([m({ waitsOn: Array.from({ length: 50 }, (_, i) => `x${i}`) })], { exportedAt: 'now', module: 'schedule', extra: 1 }),
    wrap([m({ extra: 'ignored' })]),
    wrap([w({ column: 'doing' }), w({ id: 'c', column: '' }), w({ id: 'd', column: null })], { boards: [{ ...BOARD, rowsBy: 'milestone' }] }),
    wrap([m()], { boards: null }),
  ];
  for (const g of GOOD) {
    const text = JSON.stringify(g);
    // waitsOn names must exist for the importer: give them
    const parsed = JSON.parse(text);
    for (const e of parsed.entries) if (Array.isArray(e.waitsOn)) e.waitsOn = [];
    assert.equal(valid(parsed, schema), true, text.slice(0, 80));
    assert.equal(importerTakes(JSON.stringify(parsed)), true, text.slice(0, 80));
  }
});
test('the importer lists up to six problems, one for each entry', () => {
  const r = L.scParseFile(JSON.stringify(wrap(Array.from({ length: 9 }, () => ({ kind: 'task', title: 'x' })))), opts);
  assert.equal(r.problems.length, 6);
  assert.equal(r.problem, r.problems[0]);
  assert.ok(r.problems[1].startsWith('Entry 2'));
});

if (fails.length) { console.error(`check-schedule-schema: ${fails.length} failed\n  ${fails.join('\n  ')}`); process.exit(1); }
console.log(`check-schedule-schema: OK (${passed} tests)`);
