#!/usr/bin/env node
/*
 * check-schedule-file.mjs -- Planner - Projects' plan file (src/schedule-lib-file.js, written out in src/FORMAT.md), run in Node.
 *   - The example in FORMAT.md, taken from its code block as it stands, is read and imported (Add and Replace), so the document and
 *     the module cannot drift apart. Every field and limit the document names is tried.
 *   - Export then Import (Replace) gives the same entries; Add gives new ids and parent and waitsOn follow them.
 *   - Refused, with one plain sentence and nothing to write: not JSON, wrong format or version, no entries, too many, too big, a
 *     bad kind, no title, a day outside 1900 to 2200 or not a day, an end before its start, a parent or a waitsOn that is not in
 *     the file, a loop, a repeated id, dates needed and missing.
 * No page, no host, no network. Usage: node modules/schedule/test/check-schedule-file.mjs. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => fs.readFileSync(path.join(dir, 'src', f), 'utf8');
const NAMES = ['SC_FILE', 'scClean', 'scValue', 'scExportFile', 'scExportName', 'scParseFile', 'scImportEntries', 'scOrdered', 'scDefaultBoard', 'scCleanBoard'];
const L = new Function(`${src('schedule-lib.js')}\n${src('schedule-lib-file.js')}\nreturn { ${NAMES.join(', ')} };`)();
const plain = (x) => JSON.parse(JSON.stringify(x));

let passed = 0;
const fails = [];
function test(name, fn) { try { fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }

const doc = src('FORMAT.md');
const blocks = [...doc.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]);
const label = (k) => k;
const opts = { label, datesRequired: true };
let n = 0;
const impl = (mode, existing = []) => ({ mode, existing, newId: () => `n${(n += 1)}`, orderAfter: (p) => (p ? `${p}V` : 'V'), by: 'me' });
const file = (entries, extra = {}) => JSON.stringify({ format: 'project-plan', version: 1, entries, ...extra });
const refused = (text, part, o = opts) => { const r = L.scParseFile(text, o); assert.ok(r.problem, `should be refused: ${part}`); assert.ok(r.problem.includes(part), `${r.problem} should say ${part}`); assert.ok(/[.]$/.test(r.problem) && !r.problem.includes('\n')); assert.equal(r.entries, undefined); };

test('FORMAT.md has one example', () => assert.equal(blocks.length, 1));
test('the example is accepted as it stands', () => {
  const r = L.scParseFile(blocks[0], opts);
  assert.equal(r.problem, undefined);
  assert.equal(r.entries.length, 8);
  assert.equal(r.entries.filter((e) => e.kind === 'milestone').length, 3);
  assert.equal(r.entries.filter((e) => e.kind === 'note').length, 1);
});
test('the example, added: new ids, the links follow', () => {
  const r = L.scParseFile(blocks[0], opts);
  const have = [L.scClean('old', { kind: 'milestone', title: 'Old', start: '2026-01-01', order: 'M' })];
  const out = L.scImportEntries(r.entries, impl('add', have));
  assert.equal(new Set(out.map((e) => e.id)).size, 8);
  assert.ok(out.every((e) => /^n\d+$/.test(e.id)));
  const w3 = out.find((e) => e.title === 'Draw the plans');
  const m2 = out.find((e) => e.title === 'Design approved');
  assert.equal(w3.parent, m2.id);
  assert.deepEqual(plain(w3.waitsOn), [out.find((e) => e.title === 'Write the brief').id, out.find((e) => e.title === 'Choose the venue').id]);
  assert.equal(out.find((e) => e.title === 'Choose the venue').done, true);
  assert.ok(out.every((e) => e.by === 'me'));
  const roots = out.filter((e) => !e.parent).map((e) => e.order);
  assert.ok(roots.every((o) => o > 'M'), 'after what is there');
  assert.equal(new Set(roots).size, roots.length);
});
test('the example, replacing: the ids are kept, the ones without get new', () => {
  const r = L.scParseFile(blocks[0], opts);
  const out = L.scImportEntries(r.entries, impl('replace', [L.scClean('m1', { kind: 'note', title: 'x' })]));
  assert.deepEqual(plain(out.slice(0, 4).map((e) => e.id)), ['m1', 'w1', 'w2', 'm2']);
  assert.ok(/^n\d+$/.test(out[7].id));
  assert.equal(out[1].parent, 'm1');
});
test('Export then Import (replace) gives the same entries', () => {
  const r = L.scParseFile(blocks[0], opts);
  const made = L.scImportEntries(r.entries, impl('replace'));
  made[1].ref = { module: 'todo', kind: 'task', id: 't1' };
  made[1].owners = ['u1'];
  made[3] = L.scClean(made[3].id, { ...made[3], ticked: true });
  const exported = L.scExportFile(made, { now: '2026-11-15T10:00:00.000Z', module: 'schedule' });
  assert.equal(exported.format, 'project-plan');
  assert.equal(exported.version, 1);
  assert.equal(exported.exportedAt, '2026-11-15T10:00:00.000Z');
  const text = JSON.stringify(exported, null, 2);
  const back = L.scParseFile(text, opts);
  assert.equal(back.problem, undefined);
  const again = L.scImportEntries(back.entries, impl('replace'));
  const key = (list) => plain(list.map((e) => ({ id: e.id, ...L.scValue(e) })).sort((a, b) => (a.id < b.id ? -1 : 1)));
  assert.deepEqual(key(again), key(made));
});
test('Export names the file by kind', () => assert.equal(L.scExportName('2026-11-15'), 'project-plan-2026-11-15.json'));
test('no id: nothing can name it, and it still comes in', () => {
  const r = L.scParseFile(file([{ kind: 'note', title: 'Alone' }]), opts);
  assert.equal(L.scImportEntries(r.entries, impl('add'))[0].title, 'Alone');
});
test('a BOM and a milestone with only a day', () => {
  const r = L.scParseFile(`﻿${file([{ kind: 'milestone', title: 'M', start: '1900-01-01' }, { kind: 'milestone', title: 'N', start: '2200-12-31' }])}`, opts);
  assert.equal(r.problem, undefined);
});

test('refused: the file', () => {
  refused('', 'empty');
  refused('{ nope', 'not valid JSON');
  assert.ok(L.scParseFile('{\n"a": 1,\n nope }', opts).problem.includes('line 3'));
  refused('[]', 'must be written like');
  refused('null', 'must be written like');
  refused(JSON.stringify({ format: 'goal-plan', version: 1, entries: [] }), 'not a project plan file');
  refused(JSON.stringify({ format: 'project-plan', version: 2, entries: [] }), '"version" must be 1');
  refused(JSON.stringify({ format: 'project-plan', version: 1 }), '"entries" list');
  refused(file([]), 'no entries');
  refused(file(Array.from({ length: 501 }, (_, i) => ({ kind: 'note', title: `n${i}` }))), '501 entries');
  assert.equal(L.scParseFile(file(Array.from({ length: 500 }, (_, i) => ({ kind: 'note', title: `n${i}` }))), opts).problem, undefined);
  refused(file([{ kind: 'note', title: 'x'.repeat(L.SC_FILE.maxBytes) }]), 'too big');
});
test('refused: an entry, by number and title', () => {
  refused(file([{ kind: 'note', title: 'ok' }, 5]), 'Entry 2 must be written like');
  refused(file([{ kind: 'task', title: 'x' }]), 'Entry 1 ("x"): "kind" must be "milestone", "work" or "note"');
  refused(file([{ kind: 'note' }]), 'Entry 1: "title" is needed');
  refused(file([{ kind: 'note', title: '   ' }]), '"title" is needed');
  refused(file([{ kind: 'note', title: 'x'.repeat(121) }]), 'over 120');
  refused(file([{ kind: 'note', title: 'x', notes: 'y'.repeat(2001) }]), 'over 2000');
  refused(file([{ kind: 'note', title: 'x', notes: 4 }]), '"notes" must be text');
  refused(file([{ id: 'bad id', kind: 'note', title: 'x' }]), '"id" must be');
  refused(file([{ id: 'a', kind: 'note', title: 'x' }, { id: 'a', kind: 'note', title: 'y' }]), 'used twice');
  refused(file([{ kind: 'work', title: 'x', start: '2026-02-30', end: '2026-03-01' }]), '"start" must be a day');
  refused(file([{ kind: 'work', title: 'x', start: '26-1-1', end: '2026-03-01' }]), '"start" must be a day');
  refused(file([{ kind: 'milestone', title: 'x', start: '1899-12-31' }]), 'from 1900 to 2200');
  refused(file([{ kind: 'milestone', title: 'x', start: '2201-01-01' }]), 'from 1900 to 2200');
  refused(file([{ kind: 'milestone', title: 'x', start: 20261015 }]), '"start" must be a day');
  refused(file([{ kind: 'work', title: 'x', start: '2026-03-05', end: '2026-03-01' }]), '"end" is before "start"');
  refused(file([{ kind: 'milestone', title: 'x', start: '2026-03-05', owners: 'me' }]), '"owners" must be a list');
  refused(file([{ kind: 'milestone', title: 'x', start: '2026-03-05', tags: Array.from({ length: 51 }, (_, i) => `t${i}`) }]), 'more than 50');
  refused(file([{ kind: 'milestone', title: 'x', start: '2026-03-05', done: 'yes' }]), '"done" must be true or false');
  refused(file([{ kind: 'milestone', title: 'x', start: '2026-03-05', phase: 'Bad Phase' }]), '"phase"');
  refused(file([{ kind: 'milestone', title: 'x', start: '2026-03-05', ref: 4 }]), '"ref"');
});
test('refused: dates needed, and not when they are not', () => {
  refused(file([{ kind: 'milestone', title: 'M' }]), 'needs dates');
  refused(file([{ kind: 'work', title: 'W' }]), 'needs dates');
  assert.equal(L.scParseFile(file([{ kind: 'milestone', title: 'M' }, { kind: 'work', title: 'W' }]), { label, datesRequired: false }).problem, undefined);
});
test('refused: links that do not hold', () => {
  const m = (o) => ({ kind: 'milestone', title: 'M', start: '2026-03-01', ...o });
  refused(file([m({ parent: 'nowhere' })]), 'not an id in the file');
  refused(file([m({ id: 'a', parent: 'a' })]), 'part of itself');
  refused(file([m({ id: 'a' }), { kind: 'note', title: 'N', id: 'n', parent: 'n' }]), 'part of itself');
  refused(file([{ id: 'w', kind: 'work', title: 'W', start: '2026-03-01', end: '2026-03-02' }, m({ parent: 'w' })]), 'must be a milestone');
  refused(file([m({ id: 'a', parent: 'b' }), m({ id: 'b', parent: 'a' })]), 'in a loop');
  refused(file([m({ waitsOn: ['zzz'] })]), 'not an id in the file');
  refused(file([m({ id: 'a', waitsOn: ['a'] })]), 'wait on itself');
  refused(file([{ id: 'n', kind: 'note', title: 'N' }, m({ waitsOn: ['n'] })]), 'a note');
  refused(file([m({ id: 'a', waitsOn: ['b'] }), m({ id: 'b', waitsOn: ['c'] }), m({ id: 'c', waitsOn: ['a'] })]), 'wait on each other');
});
test('hostile: a long chain and a lot of text read in one pass', () => {
  const chain = Array.from({ length: 500 }, (_, i) => ({ id: `e${i}`, kind: 'milestone', title: `e${i}`, start: '2026-03-01', ...(i ? { parent: `e${i - 1}` } : {}), ...(i ? { waitsOn: [`e${i - 1}`] } : {}) }));
  const t = Date.now();
  const r = L.scParseFile(file(chain), opts);
  assert.equal(r.problem, undefined);
  assert.ok(L.scImportEntries(r.entries, impl('add')).length === 500);
  assert.ok(Date.now() - t < 5000);
  refused(file([{ kind: 'note', title: 'x', __proto__: null, parent: '__proto__' }]), 'not an id');
  const r2 = L.scParseFile('{"format":"project-plan","version":1,"entries":[{"kind":"note","title":"x","__proto__":{"kind":"work"}}]}', opts);
  assert.equal(L.scImportEntries(r2.entries, impl('add'))[0].kind, 'note');
});
test('a plan file the module wrote stays inside the data route\'s limits', () => {
  const big = L.scClean('a', { kind: 'work', title: 't'.repeat(120), notes: 'n'.repeat(2000), start: '2026-01-01', end: '2026-01-02', owners: Array.from({ length: 50 }, (_, i) => `o${i}`.padEnd(200, 'x')), waitsOn: Array.from({ length: 50 }, (_, i) => `id${i}`.padEnd(64, 'x')), tags: Array.from({ length: 50 }, (_, i) => `t${i}`.padEnd(64, 'x')) });
  assert.ok(JSON.stringify(L.scValue(big)).length < 60 * 1024, 'one entry is under 60 KB');
});

test('the board in the file: Export writes it, Import reads it back, and work\'s column rides along', () => {
  const board = L.scDefaultBoard('priority');
  const made = L.scImportEntries(L.scParseFile(file([{ id: 'a', kind: 'work', title: 'A', start: '2026-03-01', end: '2026-03-02', column: 'now' }, { id: 'b', kind: 'work', title: 'B', start: '2026-03-01', end: '2026-03-02', column: 'done', done: false }, { id: 'm', kind: 'milestone', title: 'M', start: '2026-03-01', column: 'now' }]), opts).entries, { ...impl('replace'), board });
  assert.equal(made[0].column, 'now');
  assert.equal(made[1].done, true, 'a column the board has gives the work its flag');
  assert.equal(made[2].column, undefined, 'a milestone never has one');
  const out = plain(L.scExportFile(made, { module: 'schedule', boards: [board] }));
  assert.deepEqual(out.boards, [board]);
  assert.equal(out.entries[0].column, 'now');
  assert.equal(L.scExportFile(made, {}).boards, undefined, 'no board, no key');
  const back = L.scParseFile(JSON.stringify(out), opts);
  assert.equal(back.problem, undefined);
  assert.deepEqual(back.boards, [board]);
  assert.deepEqual(L.scParseFile(file([{ kind: 'note', title: 'x' }]), opts).boards, [], 'a file with none leaves the board alone');
  const unknown = L.scImportEntries([{ kind: 'work', title: 'U', start: '2026-03-01', end: '2026-03-02', column: 'gone', done: true }], { ...impl('add'), board });
  assert.deepEqual([unknown[0].column, unknown[0].done], ['gone', true], 'a column the board lacks is kept, read as the default, done as it was');
});
test('a bad board or column is refused with one sentence', () => {
  const ok = { id: 'main', name: 'B', columns: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', done: true }] };
  const f = (b, entries = [{ kind: 'note', title: 'x' }]) => JSON.stringify({ format: 'project-plan', version: 1, entries, boards: b });
  assert.equal(L.scParseFile(f([ok]), opts).problem, undefined);
  refused(f({}), 'must be a list');
  refused(f([ok, { ...ok, id: 'two' }]), 'more than one board');
  refused(f([5]), 'Board 1 must be written like');
  refused(f([{ ...ok, id: 'Main' }]), '"id" must be lower case');
  refused(f([{ ...ok, field: 'status' }]), '"field" must be "column"');
  refused(f([{ ...ok, rowsBy: 'tag' }]), '"rowsBy" must be');
  refused(f([{ ...ok, columns: [] }]), '"columns" must be a list');
  refused(f([{ ...ok, columns: Array.from({ length: 13 }, (_, i) => ({ id: `c${i}`, label: 'C', done: i === 0 })) }]), 'at most 12 columns');
  refused(f([{ ...ok, columns: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B', done: true }] }]), 'the id "a" is used twice');
  refused(f([{ ...ok, columns: [{ id: 'a', label: ' ' }, ok.columns[1]] }]), '"label" is needed');
  refused(f([{ ...ok, columns: [{ id: 'a', label: 'x'.repeat(41) }, ok.columns[1]] }]), 'over 40 characters');
  refused(f([{ ...ok, columns: [{ id: 'a', label: 'A', done: 'yes' }, ok.columns[1]] }]), '"done" must be true or false');
  refused(f([{ ...ok, columns: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }]), 'keep at least one column that counts as done and one that does not');
  refused(f([{ ...ok, columns: [{ id: 'a', label: 'A', done: true }, { id: 'b', label: 'B', done: true }] }]), 'keep at least one column that counts as done and one that does not');
  refused(f([ok], [{ kind: 'work', title: 'W', start: '2026-03-01', end: '2026-03-01', column: 'Bad Id' }]), '"column" must be lower case');
});

if (fails.length) { console.error(`check-schedule-file: ${fails.length} failed\n  ${fails.join('\n  ')}`); process.exit(1); }
console.log(`check-schedule-file: OK (${passed} tests)`);
