#!/usr/bin/env node
/*
 * check-goals-takes.mjs -- Planner - Goals takes the objects format's goal, step and note whole (plan-object-handoff.md;
 * fromObject, goalFor and phaseFor in src/goals-lib.js): the manifest's `takes`, a goal's why (cut at 2000), day and phase by
 * name, a step's day and done, `details.under` matched to a goal by title (ignoring case, the most recently made of two wins,
 * its own title and no match mean no goal), a hostile title. No page, no host, no network.
 * Usage: node modules/goals/test/check-goals-takes.mjs. Exits 1 on any failure.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const MOD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(MOD, '..', '..');
const require = createRequire(import.meta.url);
const L = vm.runInNewContext(`${fs.readFileSync(path.join(MOD, 'src', 'goals-lib.js'), 'utf8')}\nGoalsLib`, {});
const fileCode = fs.readFileSync(path.join(MOD, 'src', 'goals-lib-file.js'), 'utf8');
const F = vm.runInNewContext(`${fs.readFileSync(path.join(MOD, 'src', 'goals-lib.js'), 'utf8')}\n${fileCode}\nGoalsFile`, {});
const schema = JSON.parse(fs.readFileSync(path.join(MOD, 'src', 'goal-plan.schema.json'), 'utf8'));
const plain = (x) => JSON.parse(JSON.stringify(x));

let n = 0;
let failed = 0;
const test = (name, fn) => { try { fn(); n += 1; } catch (err) { failed += 1; console.error(`check-goals-takes: ${name}: ${err.stack || err.message}`); } };

const phases = [{ id: 'start', label: 'Start' }, { id: 'build', label: 'Build the thing' }];
const have = [
  { id: 'g1', kind: 'goal', title: 'Run a marathon', createdAt: 100 },
  { id: 'g2', kind: 'goal', title: 'RUN a  marathon', createdAt: 200 },
  { id: 's1', kind: 'step', title: 'Buy shoes', parent: 'g1', createdAt: 300 },
];
// What the action stores for an object: the fields mapped, then valueOf as `add` does.
const take = (kind, object, entries = have) => {
  const raw = L.fromObject(kind, object, { entries, phases });
  return L.valueOf(kind, { ...raw, parent: kind === 'goal' ? null : raw.parent }, { dates: true });
};

test('the manifest takes the plan kinds, and a step needs no pointer when it is sent whole', () => {
  const { cleanManifest } = require(path.join(ROOT, 'server', 'modules.js'));
  const m = cleanManifest(JSON.parse(fs.readFileSync(path.join(MOD, 'module.json'), 'utf8')), new Set(['module.json', 'page.html', 'canvas.html']));
  const by = Object.fromEntries(m.actions.provides.map((a) => [a.name, a]));
  assert.deepEqual(by.addGoal.takes.map((t) => [t.kinds, t.as]), [[['goal'], 'a goal']]);
  assert.deepEqual(by.addStep.takes.map((t) => [t.kinds, t.as]), [[['step'], 'a step']]);
  assert.deepEqual(by.addNote.takes.map((t) => [t.kinds, t.as]), [[['note'], 'a note']]);
  assert.equal(by.addStep.input.goal, 'ref:goals:plan?');
  for (const a of [by.addGoal, by.addStep, by.addNote]) assert.equal(a.input.object, 'object?');
  for (const a of [by.updateGoal, by.setGoalDone]) assert.equal(a.input.object, undefined, `${a.name} takes no object`);
});

test('a goal: why from the details or the words, cut at 2000; day; phase by name', () => {
  const v = take('goal', { title: 'Ship it', content: 'Because', details: { date: '2027-03-01', phase: 'BUILD THE THING' } });
  assert.deepEqual(plain([v.kind, v.why, v.date, v.phase, v.parent]), ['goal', 'Because', '2027-03-01', 'build', null]);
  assert.equal(take('goal', { title: 'G', content: 'c', details: { why: 'Own why' } }).why, 'Own why');
  assert.equal(take('goal', { title: 'G', content: 'x'.repeat(5000) }).why.length, 2000);
  assert.equal(take('goal', { title: 'G', details: { phase: 'Nowhere' } }).phase, undefined);
  assert.equal(take('goal', { title: 'G', date: '2027-01-02' }).date, '2027-01-02', 'the day chosen in Chat');
});

test('a step under a goal by title, the most recently made of two wins', () => {
  const v = take('step', { title: 'Run 5k', details: { under: 'run a marathon', date: '2026-12-05', done: true } });
  assert.deepEqual(plain([v.kind, v.parent, v.date, v.done]), ['step', 'g2', '2026-12-05', true]);
  assert.equal(L.goalFor(have.slice().reverse(), 'run a marathon', 'x'), 'g2', 'whatever the list order');
});

test('no match, its own title, or a step named as under: no goal', () => {
  assert.equal(take('step', { title: 'S', details: { under: 'Nothing here' } }).parent, null);
  assert.equal(take('step', { title: 'S', details: {} }).parent, null);
  assert.equal(take('step', { title: 'run a marathon', details: { under: 'Run a Marathon' } }).parent, null);
  assert.equal(take('step', { title: 'S', details: { under: 'Buy shoes' } }).parent, null, 'a step holds nothing');
});

test('a note keeps its words as text', () => {
  const v = take('note', { title: 'N', content: 'Some words' });
  assert.deepEqual(plain([v.kind, v.text, v.parent]), ['note', 'Some words', null]);
});

test('a hostile title stays text and is cut; control characters go; __proto__ matches nothing', () => {
  const t = '<script>alert(1)</script>\u0000\u0007 ' + 'y'.repeat(400);
  const v = take('step', { title: t, details: { under: '__proto__' } });
  assert.ok(v.title.startsWith('<script>alert(1)</script>') && v.title.length <= 200 && !/[\u0000-\u001f]/.test(v.title));
  assert.equal(v.parent, null);
  assert.equal(L.goalFor([{ id: 'x', kind: 'goal', title: '__proto__' }], '__PROTO__', 'a'), 'x');
  assert.equal(take('goal', { title: 'G', date: '2500-01-01' }).date, undefined, 'a day outside 1900 to 2200 is no day');
});

test('an object with no title is refused by valueOf', () => {
  assert.throws(() => take('goal', { content: 'no title' }), /title/);
});

// The schema's own keywords, checked as check-schedule-schema.mjs does (no dependency).
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
function valid(v, s, root = s) {
  if (s.$ref) { const t = s.$ref.replace('#/', '').split('/').reduce((o, k) => o[k], root); if (!valid(v, t, root)) return false; }
  if (s.type && ![].concat(s.type).some((t) => typeOf(v) === t || (t === 'number' && typeof v === 'number'))) return false;
  if ('const' in s && v !== s.const) return false;
  if (s.enum && !s.enum.includes(v)) return false;
  if (typeof v === 'string') {
    if (s.pattern && !new RegExp(s.pattern).test(v)) return false;
    if (s.maxLength !== undefined && [...v].length > s.maxLength) return false;
    if (s.minLength !== undefined && [...v].length < s.minLength) return false;
  }
  if (typeof v === 'number' && ((s.minimum !== undefined && v < s.minimum) || (s.maximum !== undefined && v > s.maximum))) return false;
  if (Array.isArray(v)) {
    if ((s.minItems !== undefined && v.length < s.minItems) || (s.maxItems !== undefined && v.length > s.maxItems)) return false;
    if (s.items && !v.every((x) => valid(x, s.items, root))) return false;
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const k of s.required || []) if (!(k in v)) return false;
    for (const [k, sub] of Object.entries(s.properties || {})) if (k in v && !valid(v[k], sub, root)) return false;
  }
  for (const sub of s.allOf || []) if (!valid(v, sub, root)) return false;
  if (s.if && valid(v, s.if, root) && s.then && !valid(v, s.then, root)) return false;
  return true;
}

test('what taken objects write is valid under the file schema and the importer takes it', () => {
  const stored = [];
  const add = (kind, object) => {
    const raw = L.fromObject(kind, object, { entries: stored, phases });
    const v = L.valueOf(kind, { ...raw, parent: kind === 'goal' ? null : raw.parent, order: 'V' + 'W'.repeat(stored.length) }, { dates: true });
    stored.push(L.readEntry(`n${stored.length + 1}`, { ...v, createdAt: stored.length + 1 }));
  };
  add('goal', { title: 'Run a marathon', content: 'To feel strong.', details: { date: '2027-04-18', phase: 'start' } });
  add('step', { title: 'Run 5k', details: { under: 'run a marathon', date: '2026-12-05', done: true } });
  add('note', { title: 'N', content: 'words' });
  assert.equal(stored[1].parent, stored[0].id);
  const file = JSON.parse(JSON.stringify(F.exportFile(stored, { module: 'goals' })));
  assert.equal(valid(file, schema), true);
  const read = F.parseFile(JSON.stringify(file), {});
  assert.ok(!read.problem, read.problem);
});

if (failed) { console.error(`check-goals-takes: ${failed} failed, ${n} passed`); process.exit(1); }
console.log(`check-goals-takes: ${n} passed`);
