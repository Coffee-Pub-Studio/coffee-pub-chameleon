#!/usr/bin/env node
/*
 * check-goals-lib.mjs -- the Goal outline's rules (modules/goals/src/goals-lib.js), run in Node, and its manifest against
 * the contract of plan-templates-redesign.md (step 14) and the phase measure of step 6.
 *
 *   - readEntry: a stored value read as a goal, a step or a note; junk refused; a note never carries `done` (so a phase
 *     measured by goals never counts it).
 *   - treeOf: goals in the outline's order, their steps and notes under them, a step whose goal is gone kept among the loose.
 *   - goalState and goalPatch: by steps, the share of steps done and done when all are; a goal with no steps, or progress
 *     by done, is its own tick; the patch is null when the stored value already says so.
 *   - moveProblem: a goal stays at the top, a step goes under a goal, a note under a goal or at the top; the sentence
 *     uses the module's words.
 *   - cleanLinks: an entry's own pointers kept to the pointer shape, no repeats, at most 20.
 *   - entryPatch: `shownDate` (what the Calendar and the summaries see) is the date while dates are optional, none while off.
 *   - isOwnRef: a pointer to another space's entry is refused even when its id matches one here.
 *   - Hostile lists: a 50,000-long parent chain and far-off dates (0100, 9999) read, index and flatten in one pass each; the
 *     outline gets two levels at most.
 *   - valueOf: a title is needed; dates off keeps the date but shows it nowhere else; a goal is never under anything.
 *   - The manifest is cleaned by the server's own rules (cleanManifest), produces the `plan` kind with `phase`, `done` and
 *     `progress` in its summary (what server/index.js phaseTallyOf looks for), marks `dates` and `progressBy` driven and
 *     `defaultView` default, declares the four labels, opts in to starter content and asks for no uploads.
 *   - The phase measure's own tally (server/phase-measure.js) over summaries made the way the server makes them from
 *     stored goals: a phase is done when every goal naming it is done.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOD = path.resolve(HERE, '..');
const ROOT = path.resolve(MOD, '..', '..');
const require = createRequire(import.meta.url);

const code = fs.readFileSync(path.join(MOD, 'src', 'goals-lib.js'), 'utf8');
const L = vm.runInNewContext(`${code}\nGoalsLib`, {});
// Arrays and objects made in the vm have its own prototypes: compare them as plain data.
const plain = (x) => JSON.parse(JSON.stringify(x));

let n = 0;
let failed = 0;
const test = (name, fn) => { try { fn(); n += 1; } catch (err) { failed += 1; console.error(`check-goals-lib: ${name}: ${err.stack || err.message}`); } };

test('readEntry', () => {
  assert.equal(L.readEntry('a', null), null);
  assert.equal(L.readEntry('bad id!', { kind: 'goal', title: 'x' }), null);
  assert.equal(L.readEntry('a', [1]), null);
  const g = L.readEntry('g1', { kind: 'goal', title: '  Learn Spanish ', phase: 'Bad Phase', progress: 140, owners: ['u1', 'u1', 5], done: 'yes' });
  assert.equal(g.title, 'Learn Spanish');
  assert.equal(g.phase, undefined);
  assert.equal(g.progress, 100);
  assert.deepEqual(plain(g.owners), ['u1']);
  assert.equal(g.done, false);
  const n1 = L.readEntry('n1', { kind: 'note', title: 'Hi', done: true, parent: 'g1' });
  assert.equal('done' in n1, false);
  assert.equal(n1.parent, 'g1');
  assert.equal(L.readEntry('s1', { title: 'No kind', parent: 'g1' }).kind, 'step');
  assert.equal(L.readEntry('g2', { title: 'No kind' }).kind, 'goal');
});

const goal = (id, o = {}) => L.readEntry(id, { kind: 'goal', title: id, ...o });
const step = (id, parent, o = {}) => L.readEntry(id, { kind: 'step', title: id, parent, ...o });
const noteE = (id, parent, o = {}) => L.readEntry(id, { kind: 'note', title: id, parent, ...o });

test('treeOf', () => {
  const t = L.treeOf([goal('b', { order: 'V' }), goal('a', { order: 'U' }), step('s2', 'a', { order: 'V' }), step('s1', 'a', { order: 'U' }), noteE('n', 'a'), step('lost', 'gone'), noteE('top', null), goal('c')]);
  assert.deepEqual(plain(t.goals.map((g) => g.goal.id)), ['a', 'b', 'c']);
  assert.deepEqual(plain(t.goals[0].steps.map((s) => s.id)), ['s1', 's2']);
  assert.deepEqual(plain(t.goals[0].notes.map((s) => s.id)), ['n']);
  assert.deepEqual(plain(t.loose.map((e) => e.id).sort()), ['lost', 'top']);
});

test('goalState and goalPatch', () => {
  const g = goal('g', { done: false, progress: 0 });
  const steps = [step('1', 'g', { done: true }), step('2', 'g'), step('3', 'g', { done: true }), step('4', 'g')];
  const s = L.goalState(g, steps, 'steps');
  assert.deepEqual({ ...s }, { done: false, progress: 50, stepsDone: 2, steps: 4, derived: true });
  assert.deepEqual({ ...L.goalPatch(g, steps, 'steps') }, { done: false, progress: 50 });
  const all = steps.map((x) => ({ ...x, done: true }));
  assert.deepEqual({ ...L.goalPatch(g, all, 'steps') }, { done: true, progress: 100 });
  assert.equal(L.goalPatch(goal('g', { done: true, progress: 100 }), all, 'steps'), null);
  // No steps: the goal's own tick.
  assert.equal(L.goalState(goal('g', { done: true }), [], 'steps').done, true);
  assert.equal(L.goalState(goal('g', { done: true }), [], 'steps').derived, false);
  // By done: the steps do not count.
  const byDone = L.goalState(goal('g', { done: false }), all, 'done');
  assert.equal(byDone.done, false);
  assert.equal(byDone.progress, 0);
  assert.equal(byDone.derived, false);
  assert.equal(L.goalPatch(step('s', 'g'), [], 'steps'), null);
});

test('entryPatch: the shown date follows the dates setting, a goal its steps', () => {
  const dated = step('s', 'g', { date: '2027-01-05', shownDate: '2027-01-05' });
  assert.equal(L.entryPatch(dated, [], 'steps', true), null);
  assert.deepEqual(plain(L.entryPatch(dated, [], 'steps', false)), { shownDate: null });
  const hidden = step('s', 'g', { date: '2027-01-05' });
  assert.deepEqual(plain(L.entryPatch(hidden, [], 'steps', true)), { shownDate: '2027-01-05' });
  assert.equal(L.entryPatch(hidden, [], 'steps', false), null);
  assert.equal(L.entryPatch(step('s', 'g'), [], 'steps', true), null);
  const g = goal('g', { done: false, progress: 0, date: '2027-02-01' });
  assert.deepEqual(plain(L.entryPatch(g, [step('a', 'g', { done: true })], 'steps', false)), { done: true, progress: 100 });
  assert.deepEqual(plain(L.entryPatch(g, [step('a', 'g', { done: true })], 'steps', true)), { done: true, progress: 100, shownDate: '2027-02-01' });
  // A note never shows a date.
  assert.deepEqual(plain(L.entryPatch(L.readEntry('n', { kind: 'note', title: 'n', shownDate: '2027-01-01' }), [], 'steps', true)), { shownDate: null });
});

test('isOwnRef: only this space\'s entries', () => {
  const ref = { module: 'goals', kind: 'plan', id: 'g1', scope: 'space', space: 'here' };
  assert.equal(L.isOwnRef(ref, 'goals', 'here'), true);
  assert.equal(L.isOwnRef({ ...ref, space: 'elsewhere' }, 'goals', 'here'), false, 'another space\'s goal with the same id');
  assert.equal(L.isOwnRef({ ...ref, space: undefined }, 'goals', 'here'), false);
  assert.equal(L.isOwnRef({ ...ref, scope: 'environment' }, 'goals', 'here'), false);
  assert.equal(L.isOwnRef({ ...ref, module: 'travel' }, 'goals', 'here'), false);
  assert.equal(L.isOwnRef({ ...ref, kind: 'trip' }, 'goals', 'here'), false);
  assert.equal(L.isOwnRef({ ...ref, id: '../x' }, 'goals', 'here'), false);
  assert.equal(L.isOwnRef(null, 'goals', 'here'), false);
  assert.equal(L.isOwnRef(ref, 'goals', ''), false);
});

test('moveProblem', () => {
  const byId = new Map([goal('g'), goal('h'), step('s', 'g'), noteE('n', null)].map((e) => [e.id, e]));
  const word = (k, o) => (k === 'goal' ? (o && o.a ? 'an aim' : 'aim') : o && o.a ? `a ${k}` : k);
  assert.equal(L.moveProblem(byId, { id: 'g', parent: null }, word), '');
  assert.equal(L.moveProblem(byId, { id: 'g', parent: 'h' }, word), 'An aim stays at the top of the list.');
  assert.equal(L.moveProblem(byId, { id: 's', parent: 'h' }, word), '');
  assert.equal(L.moveProblem(byId, { id: 's', parent: null }, word), 'A step goes under an aim.');
  assert.equal(L.moveProblem(byId, { id: 'n', parent: 'g' }, word), '');
  assert.equal(L.moveProblem(byId, { id: 'n', parent: null }, word), '');
  assert.equal(L.moveProblem(byId, { id: 'n', parent: 's' }, word), 'A note goes under an aim or at the top.');
  assert.equal(L.moveProblem(byId, { id: 'x', parent: null }, word), 'That is no longer in the plan.');
});

test('valueOf', () => {
  assert.throws(() => L.valueOf('goal', { title: '  ' }), /Give it a title/);
  assert.throws(() => L.valueOf('task', { title: 'x' }), /not something the plan holds/);
  const g = L.valueOf('goal', { title: 'G', parent: 'x', date: '2026-12-01', phase: 'build', owners: ['a'], done: true });
  assert.equal(g.parent, null);
  assert.equal(g.date, '2026-12-01');
  assert.equal(g.progress, 100);
  // Dates off: the date is kept, but nothing outside the plan sees it (no shownDate, so no Calendar copy and no `when`).
  const off = L.valueOf('goal', { title: 'G', date: '2026-12-01' }, { dates: false });
  assert.equal(off.date, '2026-12-01');
  assert.equal(off.shownDate, undefined);
  assert.equal(g.shownDate, '2026-12-01');
  const nt = L.valueOf('note', { title: 'N', date: '2026-12-01', done: true, text: 'body' });
  assert.equal('done' in nt, false);
  assert.equal('date' in nt, false);
  assert.equal(nt.text, 'body');
  const back = L.stored(L.readEntry('g', g));
  assert.deepEqual(JSON.parse(JSON.stringify(back)), JSON.parse(JSON.stringify(g)));
});

test('cleanLinks', () => {
  const r = { module: 'todo', kind: 'task', id: 't1', scope: 'space', space: 'r1' };
  const out = plain(L.cleanLinks([r, { ...r }, { module: 'x', kind: 'y', id: 'z', scope: 'person' }, null, 'x', { ...r, id: '' }, { ...r, id: 't2', extra: 1 }]));
  assert.deepEqual(out, [r, { module: 'todo', kind: 'task', id: 't2', scope: 'space', space: 'r1' }]);
  assert.equal(L.cleanLinks(Array.from({ length: 30 }, (_, i) => ({ ...r, id: `t${i}` }))).length, 20);
  const g = L.readEntry('g', L.valueOf('goal', { title: 'G', links: [r] }));
  assert.deepEqual(plain(L.stored(g).links), [r]);
});

test('hostile lists: a 50,000-long chain and far-off dates stay quick and flat', () => {
  const N = 50000;
  const list = [goal('g0')];
  for (let i = 1; i <= N; i += 1) list.push(step(`s${i}`, i === 1 ? 'g0' : `s${i - 1}`, { date: i % 2 ? '0100-01-01' : '9999-12-31' }));
  const t0 = Date.now();
  const tree = L.treeOf(list);
  const kids = L.childIndex(list);
  const flat = L.outlineEntries(list);
  for (const e of list) L.entryPatch(e, kids.get(e.id) || [], 'steps', true);
  const ms = Date.now() - t0;
  assert.ok(ms < 3000, `took ${ms} ms`);
  assert.equal(tree.goals.length, 1);
  assert.equal(tree.goals[0].steps.length, 1, 'only the first step is under the goal');
  assert.equal(tree.loose.length, N - 1, 'the rest of the chain is loose, not lost');
  const goalsHere = new Set(['g0']);
  assert.ok(flat.every((e) => e.parent === null || goalsHere.has(e.parent)), 'the outline never nests below a goal');
  assert.equal(list[1].date, '0100-01-01');
  assert.equal(list[2].date, '9999-12-31');
});

const raw = JSON.parse(fs.readFileSync(path.join(MOD, 'module.json'), 'utf8'));
test('manifest', () => {
  const { cleanManifest } = require(path.join(ROOT, 'server', 'modules.js'));
  const files = new Set(['module.json', 'page.html', 'canvas.html']);
  const m = cleanManifest(raw, files);
  assert.equal(m.id, 'goals');
  assert.equal(m.name, 'Planner - Goals');
  const plan = m.refs.produces.find((p) => p.kind === 'plan');
  assert.ok(plan && plan.summary.phase && plan.summary.done && plan.summary.progress, 'the plan kind carries phase, done and progress');
  assert.equal(plan.key, 'plan:{id}');
  assert.equal(plan.backlinks, true);
  // The Calendar copy and the summary's `when` read the shown date, which is none while dates are off.
  assert.equal(plan.dated.day, 'shownDate');
  assert.equal(plan.summary.when, 'shownDate');
  const marks = Object.fromEntries(m.settings.map((s) => [s.key, s.template || null]));
  assert.deepEqual(marks, { dates: 'driven', progressBy: 'driven', defaultView: 'default' });
  assert.deepEqual(Object.keys(m.labels).sort(), ['goal', 'note', 'owner', 'step']);
  assert.equal(m.starter, true);
  assert.equal(raw.uploads, undefined);
  assert.deepEqual(m.permissions.map((p) => p.key), ['view', 'edit', 'clear']);
});

test('phase measure over goals', () => {
  const { tallyOf, statesOf } = require(path.join(ROOT, 'server', 'phase-measure.js'));
  const plan = raw.refs.produces.find((p) => p.kind === 'plan');
  // As objectSummary reads a stored value: each summary field from its stored field.
  const summary = (v) => ({ phase: v[plan.summary.phase], done: v[plan.summary.done] });
  const stored = [
    L.valueOf('goal', { title: 'A', phase: 'start', done: true }),
    L.valueOf('goal', { title: 'B', phase: 'build', done: true }),
    L.valueOf('goal', { title: 'C', phase: 'build', done: false }),
    L.valueOf('step', { title: 's', parent: 'x', done: true }),
    L.valueOf('note', { title: 'n' }),
  ];
  const phases = [{ id: 'start', label: 'Start' }, { id: 'build', label: 'Build' }, { id: 'wrap', label: 'Wrap up' }];
  const tally = tallyOf(phases, stored.map(summary));
  assert.deepEqual(plain(tally), { start: { done: 1, total: 1 }, build: { done: 1, total: 2 } });
  const states = statesOf(phases, 'goals', {}, tally);
  assert.deepEqual(states.map((p) => [p.id, p.done, Boolean(p.current)]), [['start', true, false], ['build', false, true], ['wrap', false, false]]);
});

if (failed) { console.error(`check-goals-lib: ${failed} failed, ${n} passed`); process.exit(1); }
console.log(`check-goals-lib: ${n} passed`);
