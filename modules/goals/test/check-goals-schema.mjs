#!/usr/bin/env node
/*
 * check-goals-schema.mjs -- src/goal-plan.schema.json (JSON Schema, draft 2020-12) against the importer
 * (src/goals-lib-file.js) so the two cannot drift.
 *   - A small checker for exactly the keywords the schema uses (no dependency) is tried on known-good and known-bad samples.
 *   - The example in FORMAT.md and what Export writes are valid under the schema, and the importer takes them.
 *   - A set of bad files, one fault each: the importer refuses every one; the schema refuses each it can express; and the
 *     ones it cannot (a real day, links between entries...) are named, so a new fault
 *     cannot be left out of either by accident. Whatever the schema refuses the importer refuses too.
 * Usage: node modules/goals/test/check-goals-schema.mjs. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => fs.readFileSync(path.join(dir, 'src', f), 'utf8');
const { GoalsLib: GL, GoalsFile: F } = new Function(`${src('goals-lib.js')}\n${src('goals-lib-file.js')}\nreturn { GoalsLib, GoalsFile };`)();
const schema = JSON.parse(src('goal-plan.schema.json'));

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
const opts = {};
const importerTakes = (text) => !F.parseFile(text, opts).problem;

test('FORMAT.md names the schema', () => assert.ok(doc.includes('goal-plan.schema.json')));
test('the FORMAT.md example is valid under the schema and the importer', () => {
  assert.equal(valid(example, schema), true);
  assert.equal(importerTakes(JSON.stringify(example)), true);
});
test('what Export writes is valid under the schema', () => {
  const made = F.importEntries(example.entries, { mode: 'replace', existing: [], newId: (() => { let n = 0; return () => `n${(n += 1)}`; })(), orderAfter: (p) => (p ? `${p}V` : 'V'), by: 'me', now: 1000, dates: true });
  made[0].value.owners = ['u1'];
  made[0].value.phase = 'learn';
  made[0].value.links = [{ module: 'todo', kind: 'task', id: 't1', scope: 'space', space: 'abcd' }];
  const file = JSON.parse(JSON.stringify(F.exportFile(made.map((x) => GL.readEntry(x.id, x.value)), { module: 'goals' })));
  assert.equal(valid(file, schema), true);
  assert.equal(importerTakes(JSON.stringify(file)), true);
});

const g = (o = {}) => ({ id: 'a', kind: 'goal', title: 'G', ...o });
const st = (o = {}) => ({ kind: 'step', title: 'S', parent: 'a', ...o });
const wrap = (entries, head = {}) => ({ format: 'goal-plan', version: 1, entries, ...head });
const BAD = [
  ['not an object at the top', [], null],
  ['wrong format', wrap([g()], { format: 'project-plan' }), null],
  ['wrong version', wrap([g()], { version: 2 }), null],
  ['no entries key', { format: 'goal-plan', version: 1 }, null],
  ['entries not a list', wrap({}), null],
  ['no entries', wrap([]), null],
  ['501 entries', wrap(Array.from({ length: 501 }, (_, i) => g({ id: undefined, title: `g${i}` }))), null],
  ['an entry that is a number', wrap([5]), null],
  ['bad id', wrap([g({ id: 'bad id' })]), null],
  ['id too long', wrap([g({ id: 'x'.repeat(65) })]), null],
  ['unknown kind', wrap([g({ kind: 'task' })]), null],
  ['no kind', wrap([{ title: 'x' }]), null],
  ['no title', wrap([{ kind: 'goal' }]), null],
  ['blank title', wrap([g({ title: '  ' })]), null],
  ['title 201', wrap([g({ title: 'x'.repeat(201) })]), null],
  ['title a number', wrap([g({ title: 4 })]), null],
  ['why 2001', wrap([g({ why: 'x'.repeat(2001) })]), null],
  ['why a number', wrap([g({ why: 4 })]), null],
  ['text 8001', wrap([{ kind: 'note', title: 'n', text: 'x'.repeat(8001) }]), null],
  ['date a number', wrap([g({ date: 20260301 })]), null],
  ['date badly written', wrap([g({ date: '26-3-1' })]), null],
  ['owners not a list', wrap([g({ owners: 'me' })]), null],
  ['owners 51', wrap([g({ owners: Array.from({ length: 51 }, (_, i) => `u${i}`) })]), null],
  ['done a word', wrap([g({ done: 'yes' })]), null],
  ['phase in capitals', wrap([g({ phase: 'Bad Phase' })]), null],
  ['phase over 40', wrap([g({ phase: 'a'.repeat(41) })]), null],
  ['order with a dash', wrap([g({ order: 'a-b' })]), null],
  ['by over 200', wrap([g({ by: 'x'.repeat(201) })]), null],
  ['parent a number', wrap([g(), st({ parent: 5 })]), null],
  ['progress 101', wrap([g({ progress: 101 })]), null],
  ['links 21', wrap([g({ links: Array.from({ length: 21 }, (_, i) => ({ module: 'm', kind: 'k', id: `i${i}`, scope: 'space' })) })]), null],
  ['link without a scope', wrap([g({ links: [{ module: 'm', kind: 'k', id: 'i' }] })]), null],
  ['link with another scope', wrap([g({ links: [{ module: 'm', kind: 'k', id: 'i', scope: 'host' }] })]), null],
  ['step with no parent', wrap([{ kind: 'step', title: 'S' }]), null],
  ['goal with a parent', wrap([g(), g({ id: 'b', parent: 'a' })]), null],
  ['date that is not a day', wrap([g({ date: '2026-02-30' })]), 'a real day'],
  ['date before 1900', wrap([g({ date: '1899-12-31' })]), 'the years 1900 to 2200'],
  ['date after 2200', wrap([g({ date: '2201-01-01' })]), 'the years 1900 to 2200'],
  ['id used twice', wrap([g({ id: 'a' }), g({ id: 'a' })]), 'ids that are unique across entries'],
  ['parent not in the file', wrap([st({ parent: 'nowhere' })]), 'names that point into the file'],
  ['parent is a step', wrap([g(), st({ id: 's' }), st({ id: 't', parent: 's' })]), 'the kind of the entry named'],
  ['step under itself', wrap([st({ id: 's', parent: 's' })]), 'names that point into the file'],
];
test('every bad file: the importer refuses it, and the schema refuses what it can express', () => {
  const unexpressed = [];
  for (const [name, file, why] of BAD) {
    assert.equal(importerTakes(JSON.stringify(file)), false, `the importer should refuse: ${name}`);
    if (why) { unexpressed.push(name); continue; }
    assert.equal(valid(file, schema), false, `the schema should refuse: ${name}`);
  }
  assert.ok(unexpressed.length >= 5);
});
test('what the schema cannot say is accepted by the schema only (it is never stricter than the importer)', () => {
  for (const [name, file, why] of BAD) if (why) assert.equal(valid(file, schema), true, `the schema should leave this to the importer: ${name}`);
});
test('good variants: the schema and the importer agree', () => {
  const GOOD = [
    wrap([{ kind: 'note', title: 'Alone' }]),
    wrap([g({ id: null, why: null, done: null, phase: '', order: '', parent: null, date: '', links: null })]),
    wrap([g({ date: '1900-01-01' }), g({ id: 'z', date: '2200-12-31' })]),
    wrap([g(), st()], { exportedAt: 'now', module: 'goals', extra: 1 }),
    wrap([g(), { kind: 'note', title: 'N', parent: 'a', done: true, date: '2026-01-01' }]),
    wrap([g({ extra: 'ignored' })]),
  ];
  for (const x of GOOD) {
    const text = JSON.stringify(x);
    assert.equal(valid(x, schema), true, text.slice(0, 80));
    assert.equal(importerTakes(text), true, text.slice(0, 80));
  }
});
test('the importer lists up to six problems, one for each entry', () => {
  const r = F.parseFile(JSON.stringify(wrap(Array.from({ length: 9 }, () => ({ kind: 'task', title: 'x' })))), opts);
  assert.equal(r.problems.length, 6);
  assert.equal(r.problem, r.problems[0]);
  assert.ok(r.problems[1].startsWith('Entry 2'));
});

if (fails.length) { console.error(`check-goals-schema: ${fails.length} failed\n  ${fails.join('\n  ')}`); process.exit(1); }
console.log(`check-goals-schema: OK (${passed} tests)`);
