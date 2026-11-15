#!/usr/bin/env node
/*
 * check-goals-file.mjs -- Planner - Goals' plan file (src/goals-lib-file.js, written out in src/FORMAT.md), run in Node.
 *   - The example in FORMAT.md, taken from its code block as it stands, is read and imported (Add and Replace), so the document and
 *     the module cannot drift apart.
 *   - Export then Import (Replace) gives the same stored entries; Add gives new ids and parents follow them.
 *   - Refused, with one plain sentence and nothing to write: not JSON, wrong format or version, no entries, too many, too big, a
 *     bad kind, no title, a day outside 1900 to 2200 or not a day, a step with no goal, a goal with a parent, a parent that is
 *     not in the file or not a goal, a repeated id, bad links.
 * No page, no host, no network. Usage: node modules/goals/test/check-goals-file.mjs. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => fs.readFileSync(path.join(dir, 'src', f), 'utf8');
const { GoalsLib: L, GoalsFile: F } = new Function(`${src('goals-lib.js')}\n${src('goals-lib-file.js')}\nreturn { GoalsLib, GoalsFile };`)();
const plain = (x) => JSON.parse(JSON.stringify(x));

let passed = 0;
const fails = [];
function test(name, fn) { try { fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }

const blocks = [...src('FORMAT.md').matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]);
let n = 0;
const impl = (mode, existing = []) => ({ mode, existing, newId: () => `n${(n += 1)}`, orderAfter: (p) => (p ? `${p}V` : 'V'), by: 'me', now: 1000, dates: true });
const file = (entries) => JSON.stringify({ format: 'goal-plan', version: 1, entries });
const refused = (text, part) => { const r = F.parseFile(text, {}); assert.ok(r.problem, `should be refused: ${part}`); assert.ok(r.problem.includes(part), `${r.problem} should say ${part}`); assert.ok(/[.]$/.test(r.problem) && !r.problem.includes('\n')); assert.equal(r.entries, undefined); };
const goal = (o = {}) => ({ kind: 'goal', title: 'G', ...o });

test('FORMAT.md has one example', () => assert.equal(blocks.length, 1));
test('the example is accepted as it stands', () => {
  const r = F.parseFile(blocks[0], {});
  assert.equal(r.problem, undefined);
  assert.equal(r.entries.length, 8);
  assert.equal(r.entries.filter((e) => e.kind === 'goal').length, 2);
  assert.equal(r.entries.filter((e) => e.kind === 'step').length, 5);
});
test('the example, added: new ids, parents follow, after what is there', () => {
  const r = F.parseFile(blocks[0], {});
  const have = [L.readEntry('old', { kind: 'goal', title: 'Old', order: 'M' })];
  const out = F.importEntries(r.entries, impl('add', have));
  assert.equal(new Set(out.map((x) => x.id)).size, 8);
  assert.ok(out.every((x) => /^n\d+$/.test(x.id)));
  const g1 = out.find((x) => x.value.title.startsWith('Hold'));
  const steps = out.filter((x) => x.value.kind === 'step' && x.value.parent === g1.id);
  assert.equal(steps.length, 3);
  assert.equal(out.find((x) => x.value.kind === 'note').value.parent, out.find((x) => x.value.title === 'Run a 10 km race').id);
  assert.ok(out.filter((x) => x.value.kind === 'goal').every((x) => x.value.parent === null && x.value.order > 'M'));
  assert.equal(out.find((x) => x.value.title.startsWith('Learn')).value.done, true);
  assert.equal(g1.value.shownDate, '2026-06-30');
  assert.ok(out.every((x) => x.value.by === 'me' && x.value.createdAt === 1000));
});
test('the example, replacing: ids kept, those without get new ones', () => {
  const out = F.importEntries(F.parseFile(blocks[0], {}).entries, impl('replace'));
  assert.equal(out[0].id, 'g1');
  assert.ok(/^n\d+$/.test(out[1].id));
  assert.equal(out[1].value.parent, 'g1');
});
test('dates off: the date is kept and shown nowhere else', () => {
  const out = F.importEntries(F.parseFile(blocks[0], {}).entries, { ...impl('replace'), dates: false });
  assert.equal(out[0].value.date, '2026-06-30');
  assert.equal(out[0].value.shownDate, undefined);
});
test('Export then Import (replace) gives the same stored entries', () => {
  const made = F.importEntries(F.parseFile(blocks[0], {}).entries, impl('replace'));
  made[0].value.owners = ['u1'];
  made[0].value.phase = 'learn';
  made[0].value.links = [{ module: 'todo', kind: 'task', id: 't1', scope: 'space', space: 'abcd' }];
  const entries = made.map((x) => L.readEntry(x.id, x.value));
  const exported = F.exportFile(entries, { now: '2026-11-15T10:00:00.000Z', module: 'goals' });
  assert.equal(exported.format, 'goal-plan');
  assert.equal(exported.version, 1);
  assert.equal(exported.exportedAt, '2026-11-15T10:00:00.000Z');
  assert.equal(exported.entries[0].id, 'g1');
  const back = F.parseFile(JSON.stringify(exported, null, 2), {});
  assert.equal(back.problem, undefined);
  const again = F.importEntries(back.entries, impl('replace'));
  const key = (list) => plain(list.map((x) => ({ id: x.id, value: x.value })).sort((a, b) => (a.id < b.id ? -1 : 1)));
  assert.deepEqual(key(again), key(made));
});
test('Export names the file by kind', () => assert.equal(F.exportName('2026-11-15'), 'goal-plan-2026-11-15.json'));
test('a BOM, and days at the edges', () => {
  assert.equal(F.parseFile(`﻿${file([goal({ date: '1900-01-01' }), goal({ date: '2200-12-31' })])}`, {}).problem, undefined);
});

test('refused: the file', () => {
  refused('', 'empty');
  refused('{ nope', 'not valid JSON');
  assert.ok(F.parseFile('{\n"a": 1,\n nope }', {}).problem.includes('line 3'));
  refused('[]', 'must be written like');
  refused(JSON.stringify({ format: 'project-plan', version: 1, entries: [] }), 'not a goal plan file');
  refused(JSON.stringify({ format: 'goal-plan', version: 2, entries: [] }), '"version" must be 1');
  refused(JSON.stringify({ format: 'goal-plan', version: 1 }), '"entries" list');
  refused(file([]), 'no entries');
  refused(file(Array.from({ length: 501 }, (_, i) => goal({ title: `g${i}` }))), '501 entries');
  assert.equal(F.parseFile(file(Array.from({ length: 500 }, (_, i) => goal({ title: `g${i}` }))), {}).problem, undefined);
  refused(file([goal({ title: 'x'.repeat(F.LIMITS.maxBytes) })]), 'too big');
});
test('refused: an entry, by number and title', () => {
  refused(file([goal(), 7]), 'Entry 2 must be written like');
  refused(file([{ kind: 'task', title: 'x' }]), 'Entry 1 ("x"): "kind" must be "goal", "step" or "note"');
  refused(file([{ kind: 'goal' }]), 'Entry 1: "title" is needed');
  refused(file([goal({ title: '  ' })]), '"title" is needed');
  refused(file([goal({ title: 'x'.repeat(201) })]), 'over 200');
  refused(file([goal({ why: 'y'.repeat(2001) })]), '"why" is over 2000');
  refused(file([{ kind: 'note', title: 'n', text: 't'.repeat(8001) }]), '"text" is over 8000');
  refused(file([goal({ why: 4 })]), '"why" must be text');
  refused(file([goal({ id: 'bad id' })]), '"id" must be');
  refused(file([goal({ id: 'a' }), goal({ id: 'a' })]), 'used twice');
  refused(file([goal({ date: '2026-02-30' })]), '"date" must be a day');
  refused(file([goal({ date: '1899-12-31' })]), 'from 1900 to 2200');
  refused(file([goal({ date: '2201-01-01' })]), 'from 1900 to 2200');
  refused(file([goal({ date: 20260101 })]), '"date" must be a day');
  refused(file([goal({ owners: 'me' })]), '"owners" must be a list');
  refused(file([goal({ owners: Array.from({ length: 51 }, (_, i) => `u${i}`) })]), 'more than 50');
  refused(file([goal({ done: 'yes' })]), '"done" must be true or false');
  refused(file([goal({ phase: 'Bad Phase' })]), '"phase"');
  refused(file([goal({ progress: 101 })]), '"progress"');
  refused(file([goal({ links: [{ module: 'x' }] })]), '"links"');
});
test('refused: parents that do not hold', () => {
  refused(file([{ kind: 'step', title: 'S' }]), 'needs a "parent"');
  refused(file([goal({ id: 'a' }), goal({ parent: 'a' })]), 'stays at the top');
  refused(file([{ kind: 'step', title: 'S', parent: 'zzz' }]), 'not an id in the file');
  refused(file([{ id: 'n', kind: 'note', title: 'N' }, { kind: 'step', title: 'S', parent: 'n' }]), '"parent" must be a goal');
  refused(file([{ id: 's', kind: 'step', title: 'S', parent: 's' }]), '"parent" must be a goal');
  refused(file([{ kind: 'note', title: 'N', parent: 'zzz' }]), 'not an id in the file');
  assert.equal(F.parseFile(file([{ kind: 'note', title: 'N' }]), {}).problem, undefined);
});
test('words follow the plan\'s labels', () => {
  const r = F.parseFile(file([{ kind: 'step', title: 'S' }]), { label: (k, o) => (k === 'goal' ? (o && o.a ? 'a mission' : 'mission') : k === 'step' ? (o && o.a ? 'a task' : 'task') : k) });
  assert.ok(r.problem.includes('a task needs a "parent"') || r.problem.includes('A task') || r.problem.includes('a task'), r.problem);
  assert.ok(r.problem.includes('a mission'), r.problem);
});
test('hostile: 500 steps under one goal, and __proto__ keys', () => {
  const many = [goal({ id: 'g' }), ...Array.from({ length: 499 }, (_, i) => ({ kind: 'step', title: `s${i}`, parent: 'g' }))];
  const r = F.parseFile(file(many), {});
  assert.equal(r.problem, undefined);
  const out = F.importEntries(r.entries, impl('add'));
  assert.equal(out.length, 500);
  assert.equal(new Set(out.slice(1).map((x) => x.value.order)).size, 499);
  const r2 = F.parseFile('{"format":"goal-plan","version":1,"entries":[{"kind":"goal","title":"x","__proto__":{"kind":"step"}}]}', {});
  assert.equal(F.importEntries(r2.entries, impl('add'))[0].value.kind, 'goal');
});
test('one entry stays under the 60 KB a key may hold', () => {
  const big = F.importEntries(F.parseFile(file([goal({ title: 't'.repeat(200), why: 'w'.repeat(2000), owners: Array.from({ length: 50 }, (_, i) => `o${i}`.padEnd(200, 'x')), links: Array.from({ length: 20 }, (_, i) => ({ module: 'm', kind: 'k', id: `i${i}`, scope: 'space', space: 's' })) })]), {}).entries, impl('add'));
  assert.ok(JSON.stringify(big[0].value).length < 60 * 1024);
});

if (fails.length) { console.error(`check-goals-file: ${fails.length} failed\n  ${fails.join('\n  ')}`); process.exit(1); }
console.log(`check-goals-file: OK (${passed} tests)`);
