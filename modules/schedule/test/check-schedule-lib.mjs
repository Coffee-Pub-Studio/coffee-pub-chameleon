#!/usr/bin/env node
/*
 * check-schedule-lib.mjs -- Planner - Projects' pure rules (modules/schedule/src/schedule-lib.js) and its manifest: the three
 * kinds and their fields, what is stored, the checks before a save under each `datesRequired` value, the outline's order, a
 * milestone's done and progress from what is under it, the plan's progress by milestones and by work, "waits on" loops, the
 * Timeline's weeks, bars and lines (bounded however far apart the days are), the add actions and their refusals, the
 * days the plan holds (1900 to 2200), a 50,000-long chain of parents, and the manifest's marks, labels, starter, permissions and refs summary
 * (the `plan` kind convention, with the `phase` and `done` a phase measured by goals reads). No page, no host, no network.
 * Usage: node modules/schedule/test/check-schedule-lib.mjs. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const code = fs.readFileSync(path.join(dir, 'src', 'schedule-lib.js'), 'utf8');
const NAMES = ['SC_PREFIX', 'SC_KINDS', 'scIsDay', 'scClean', 'scValue', 'scProblem', 'scOrdered', 'scMilestoneChanges', 'scProgress', 'scMakesLoop', 'scMonday', 'scAddDays', 'scLate', 'scTimeline', 'scFromAction', 'scActionProblem', 'SC_WEEKS_MAX'];
const L = new Function(`${code}\nreturn { ${NAMES.join(', ')} };`)();
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'module.json'), 'utf8'));

let passed = 0;
const fails = [];
function test(name, fn) { try { fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }

// host.util.rollup, as the SDK counts it, for the tests: { id: { done, total } } over the leaves under each parent.
function rollup(entries) {
  const kids = new Map();
  for (const e of entries) if (e.parent && entries.some((p) => p.id === e.parent)) { if (!kids.has(e.parent)) kids.set(e.parent, []); kids.get(e.parent).push(e); }
  const out = {};
  const count = (e) => { const k = kids.get(e.id); if (!k) return { done: e.done ? 1 : 0, total: 1 }; let done = 0; let total = 0; for (const c of k) { const t = count(c); done += t.done; total += t.total; } out[e.id] = { done, total }; return { done, total }; };
  for (const e of entries) count(e);
  return out;
}

test('days', () => {
  assert.equal(L.scIsDay('2026-10-15'), true);
  assert.equal(L.scIsDay('2026-02-30'), false);
  assert.equal(L.scIsDay('2026-1-5'), false);
  assert.equal(L.scIsDay(20261015), false);
  assert.equal(L.scMonday('2026-10-15'), '2026-10-12', 'a Thursday goes back to its Monday');
  assert.equal(L.scMonday('2026-10-12'), '2026-10-12', 'a Monday is its own');
  assert.equal(L.scMonday('2026-10-18'), '2026-10-12', 'a Sunday is the end of its week');
  assert.equal(L.scAddDays('2026-12-30', 3), '2027-01-02');
});

test('each kind keeps only its own fields', () => {
  const w = L.scClean('w1', { kind: 'work', title: '  Build \n the  thing ', start: '2026-10-20', end: '2026-10-18', owners: ['u1', 'u1', 'u2', 5], waitsOn: ['m1', 'w1', 'bad id!'], done: true, phase: 'build', tags: ['t1'], notes: 'n', parent: 'm1', order: 'V', by: 'u1', ticked: true, progress: 50 });
  assert.equal(w.title, 'Build the thing');
  assert.deepEqual([w.start, w.end], ['2026-10-20', '2026-10-20'], 'an end before the start becomes the start');
  assert.deepEqual(w.owners, ['u1', 'u2']);
  assert.deepEqual(w.waitsOn, ['m1'], 'never itself, never a bad id');
  assert.equal(w.ticked, false, 'only a milestone is ticked');
  assert.equal(w.progress, null, 'only a milestone has progress');
  const m = L.scClean('m1', { kind: 'milestone', title: 'Launch', start: '2026-11-01', end: '2026-11-05', owners: ['u1'], ticked: true, done: false, progress: 40 });
  assert.equal(m.end, '', 'a milestone is one day');
  assert.deepEqual(m.owners, [], 'a milestone has no owners');
  assert.equal(m.done, true, 'ticked is done');
  assert.equal(m.progress, 40);
  const n = L.scClean('n1', { kind: 'note', title: 'Remember', start: '2026-11-01', done: true, waitsOn: ['m1'] });
  assert.deepEqual([n.start, n.done, n.waitsOn], ['', false, []], 'a note has no day, no done and waits on nothing');
  assert.equal(L.scClean('x', { kind: 'other', title: 'x' }).kind, 'work', 'an unknown kind reads as work');
  assert.equal(L.scClean('x', null).title, '', 'nothing stored reads as an empty entry');
  assert.equal(L.scClean('x', { kind: 'work', title: 'x', end: '2026-10-10' }).start, '2026-10-10', 'an end alone is a one-day span');
  assert.equal(L.scClean('x', { title: 'x', parent: 'x' }).parent, null, 'never its own parent');
  assert.equal(L.scClean('x', { title: 'x'.repeat(500) }).title.length, 120);
});

test('what is stored', () => {
  const n = L.scValue(L.scClean('n1', { kind: 'note', title: 'Remember' }));
  assert.deepEqual(n, { kind: 'note', title: 'Remember' }, 'a note carries no done, so the phase measure never counts it');
  const w = L.scValue(L.scClean('w1', { kind: 'work', title: 'Build', phase: 'build' }));
  assert.equal(w.done, false, 'work always says done or not done');
  assert.equal(w.phase, 'build');
  assert.equal('start' in w, false, 'no day, no start: no Calendar copy');
  const m = L.scValue(L.scClean('m1', { kind: 'milestone', title: 'Launch', start: '2026-11-01', ticked: true, progress: 100 }));
  assert.deepEqual(m, { kind: 'milestone', title: 'Launch', start: '2026-11-01', ticked: true, done: true, progress: 100 });
  const round = L.scClean('w2', L.scValue(L.scClean('w2', { kind: 'work', title: 'A', start: '2026-10-01', end: '2026-10-03', owners: ['u'], waitsOn: ['m1'], tags: ['t'], notes: 'x', parent: 'm1', order: 'V', by: 'u', ref: { module: 'todo', kind: 'task', id: 't1', scope: 'space', space: 's', extra: 1 } })));
  assert.deepEqual(round.ref, { module: 'todo', kind: 'task', id: 't1', scope: 'space', space: 's' });
  assert.equal(round.end, '2026-10-03');
});

test('the checks before a save, with dates needed and not', () => {
  const label = (k) => ({ milestone: 'session', work: 'scene' }[k] || k);
  assert.equal(L.scProblem(L.scClean('a', { title: '' }), { datesRequired: false }), 'Give it a title.');
  assert.equal(L.scProblem(L.scClean('a', { kind: 'milestone', title: 'x' }), { datesRequired: true, label }), 'This plan needs dates: give the session a day.', 'the template\'s word');
  assert.equal(L.scProblem(L.scClean('a', { kind: 'work', title: 'x' }), { datesRequired: true, label }), 'This plan needs dates: give the scene a start and an end.');
  assert.equal(L.scProblem(L.scClean('a', { kind: 'work', title: 'x' }), { datesRequired: false, label }), '', 'dates optional');
  assert.equal(L.scProblem(L.scClean('a', { kind: 'note', title: 'x' }), { datesRequired: true, label }), '', 'a note never needs a day');
  assert.equal(L.scProblem(L.scClean('a', { kind: 'work', title: 'x', start: '2026-10-01', end: '2026-10-02' }), { datesRequired: true }), '');
});

test('the outline\'s order', () => {
  const es = [
    L.scClean('b', { title: 'B', order: 'k' }),
    L.scClean('a', { title: 'A', order: 'V' }),
    L.scClean('a2', { title: 'A2', parent: 'a', order: 'k' }),
    L.scClean('a1', { title: 'A1', parent: 'a', order: 'V' }),
    L.scClean('o', { title: 'Orphan', parent: 'gone', order: 'z' }),
    L.scClean('p', { title: 'P', parent: 'q' }),
    L.scClean('q', { title: 'Q', parent: 'p' }),
  ];
  const got = L.scOrdered(es).map((x) => `${x.entry.id}:${x.level}`);
  assert.deepEqual(got.slice(0, 5), ['a:1', 'a1:2', 'a2:2', 'b:1', 'o:1'], 'parents first, siblings by order, a lost parent at the top');
  assert.equal(got.length, 7, 'a loop of parents still shows every entry');
});

test('a milestone\'s done and progress', () => {
  const es = [
    L.scClean('m', { kind: 'milestone', title: 'M', start: '2026-11-01' }),
    L.scClean('w1', { kind: 'work', title: 'W1', parent: 'm', done: true }),
    L.scClean('w2', { kind: 'work', title: 'W2', parent: 'm', done: false }),
    L.scClean('e', { kind: 'milestone', title: 'Empty', done: false }),
    L.scClean('t', { kind: 'milestone', title: 'Ticked', ticked: true }),
  ];
  const work = es.filter((e) => e.kind !== 'note');
  assert.deepEqual(L.scMilestoneChanges(es, rollup(work)), [{ id: 'm', done: false, progress: 50 }], 'half done; the others are as stored');
  es[2] = L.scClean('w2', { kind: 'work', title: 'W2', parent: 'm', done: true });
  assert.deepEqual(L.scMilestoneChanges(es, rollup(es)), [{ id: 'm', done: true, progress: 100 }], 'all its work done: done');
  const stored = L.scClean('m', { kind: 'milestone', title: 'M', done: true, progress: 100 });
  es[0] = stored;
  es.push(L.scClean('w3', { kind: 'work', title: 'W3', parent: 'm' }));
  assert.deepEqual(L.scMilestoneChanges(es, rollup(es)), [{ id: 'm', done: false, progress: 67 }], 'new work under it: not done again');
  es[0] = L.scClean('m', { kind: 'milestone', title: 'M', ticked: true, progress: 67 });
  assert.deepEqual(L.scMilestoneChanges(es, rollup(es)), [], 'ticked stays done whatever is under it');
});

test('the plan\'s progress', () => {
  const es = [
    L.scClean('m1', { kind: 'milestone', title: 'a', done: true }),
    L.scClean('m2', { kind: 'milestone', title: 'b' }),
    L.scClean('w1', { kind: 'work', title: 'c', done: true }),
    L.scClean('w2', { kind: 'work', title: 'd', done: true }),
    L.scClean('w3', { kind: 'work', title: 'e' }),
    L.scClean('n1', { kind: 'note', title: 'f' }),
  ];
  assert.deepEqual(L.scProgress(es, 'milestones'), { done: 1, total: 2 });
  assert.deepEqual(L.scProgress(es, 'work'), { done: 2, total: 3 });
  assert.deepEqual(L.scProgress([], 'work'), { done: 0, total: 0 });
});

test('waits on: no loops', () => {
  const es = [L.scClean('a', { title: 'a', waitsOn: ['b'] }), L.scClean('b', { title: 'b', waitsOn: ['c'] }), L.scClean('c', { title: 'c' })];
  assert.equal(L.scMakesLoop(es, 'c', 'a'), true, 'c waiting on a would close a loop through b');
  assert.equal(L.scMakesLoop(es, 'a', 'c'), false);
  assert.equal(L.scMakesLoop(es, 'a', 'a'), true, 'never on itself');
});

test('late', () => {
  assert.equal(L.scLate(L.scClean('w', { kind: 'work', title: 'x', start: '2026-10-01', end: '2026-10-10' }), '2026-10-15'), true);
  assert.equal(L.scLate(L.scClean('w', { kind: 'work', title: 'x', start: '2026-10-01', end: '2026-10-10', done: true }), '2026-10-15'), false);
  assert.equal(L.scLate(L.scClean('m', { kind: 'milestone', title: 'x', start: '2026-10-20' }), '2026-10-15'), false);
  assert.equal(L.scLate(L.scClean('w', { kind: 'work', title: 'x' }), '2026-10-15'), false, 'no day is never late');
});

test('the Timeline', () => {
  const es = [
    L.scClean('m', { kind: 'milestone', title: 'Launch', start: '2026-11-02', waitsOn: ['w2'], order: 'k' }),
    L.scClean('w1', { kind: 'work', title: 'Design', start: '2026-10-14', end: '2026-10-20', order: 'V' }),
    L.scClean('w2', { kind: 'work', title: 'Build', start: '2026-10-21', end: '2026-10-30', waitsOn: ['w1', 'u'], order: 'b' }),
    L.scClean('u', { kind: 'work', title: 'Someday', order: 'c' }),
    L.scClean('n', { kind: 'note', title: 'A note', order: 'd' }),
  ];
  const t = L.scTimeline(es, { dayWidth: 10, today: '2026-10-15' });
  assert.equal(t.from, '2026-10-12', 'the Monday before the first day');
  assert.ok(t.days >= 42 && t.days % 7 === 0, 'whole weeks, at least six');
  assert.equal(t.width, t.days * 10);
  assert.deepEqual(t.weeks.slice(0, 2), [{ day: '2026-10-12', x: 0 }, { day: '2026-10-19', x: 70 }]);
  assert.deepEqual(t.rows.map((r) => r.id), ['w1', 'w2', 'm'], 'in the outline\'s order; no note, nothing undated');
  assert.deepEqual(t.rows[0], { id: 'w1', kind: 'work', x: 20, w: 70, row: 0 }, 'a bar from its first to its last day');
  assert.equal(t.rows[2].w, 10, 'a milestone is one day wide');
  assert.deepEqual(t.lines, [{ from: 'w1', to: 'w2' }, { from: 'w2', to: 'm' }], 'only lines between entries on the Timeline');
  assert.deepEqual(t.undated, ['u'], 'Not scheduled: dated entries only on the Timeline');
  assert.equal(t.today, 30);
  const none = L.scTimeline([L.scClean('u', { kind: 'work', title: 'x' })], { dayWidth: 10, today: '2026-10-15' });
  assert.deepEqual([none.rows.length, none.undated], [0, ['u']]);
  const far = L.scTimeline([L.scClean('w', { kind: 'work', title: 'x', start: '2027-06-01', end: '2027-06-02' })], { dayWidth: 10, today: '2026-10-15' });
  assert.equal(far.today, null, 'today far away is not dragged in');
  assert.equal(far.from, '2027-05-31');
});

test('the add actions', () => {
  const m = L.scFromAction('milestone', { title: 'Kick-off', date: '2026-10-20', notes: 'n', ref: { module: 'todo', kind: 'task', id: 't1' } }, 'u1');
  assert.deepEqual([m.kind, m.title, m.start, m.by, m.ref.id], ['milestone', 'Kick-off', '2026-10-20', 'u1', 't1']);
  const w = L.scFromAction('work', { title: 'Build', end: '2026-10-22' }, 'u1');
  assert.deepEqual([w.start, w.end], ['2026-10-22', '2026-10-22'], 'one day given: a one-day span');
  const n = L.scFromAction('note', { title: 'x', date: '2026-10-20' }, 'u1');
  assert.equal(n.start, '', 'a note takes no day');
  for (const name of ['addMilestone', 'addWork', 'addNote']) assert.ok(manifest.actions.provides.some((a) => a.name === name), `${name} is declared`);
});

test('the manifest', () => {
  assert.equal(manifest.id, 'schedule');
  assert.equal(manifest.name, 'Planner - Projects', 'decision 43');
  assert.deepEqual(manifest.scope, ['environment', 'space']);
  assert.deepEqual(Object.keys(manifest.surfaces).sort(), ['canvas', 'page'], 'a page and a canvas, no widget');
  assert.deepEqual(manifest.permissions.map((p) => [p.key, p.label, p.default.member, p.default.guest, p.default.moderator]), [
    ['view', 'See the plan', true, true, true],
    ['edit', 'Add and change the plan', true, false, true],
    ['clear', 'Clear the whole plan', false, false, true],
  ]);
  assert.deepEqual(manifest.access, { read: 'view', write: 'edit' });
  assert.deepEqual(manifest.guards, { clear: 'clear' });
  assert.equal(manifest.uploads, undefined, 'no uploads');
  assert.equal(manifest.starter, true);
  assert.deepEqual(Object.keys(manifest.labels), ['plan', 'milestone', 'work', 'note', 'owner', 'tag']);
  const marks = Object.fromEntries(manifest.settings.map((s) => [s.key, [s.type, s.scope, s.template, s.default]]));
  assert.deepEqual(marks, {
    datesRequired: ['boolean', 'space', 'driven', true],
    dependencies: ['boolean', 'space', 'driven', true],
    progressBy: ['choice', 'space', 'driven', 'milestones'],
    defaultView: ['choice', 'space', 'default', 'timeline'],
    tags: ['list', 'space', 'default', []],
  });
  const [plan] = manifest.refs.produces;
  assert.equal(manifest.refs.produces.length, 1);
  assert.deepEqual([plan.kind, plan.name, plan.key, plan.backlinks, plan.open, plan.mirror], ['plan', '{name}', 'plan:{id}', true, true, 'out'], 'the plan kind convention');
  assert.deepEqual(plan.dated, { title: 'title', day: 'start', endDay: 'end' });
  assert.deepEqual(plan.summary, { title: 'title', when: 'start', end: 'end', done: 'done', phase: 'phase', progress: 'progress' }, 'the phase measure reads phase and done');
  assert.deepEqual(manifest.refs.consumes, ['*']);
  assert.equal(L.SC_PREFIX + '{id}', plan.key, 'the page stores where the refs say');
});

test('the days the plan holds: 1900 to 2200', () => {
  assert.equal(L.scIsDay('1900-01-01'), true);
  assert.equal(L.scIsDay('2200-12-31'), true);
  assert.equal(L.scIsDay('1899-12-31'), false);
  assert.equal(L.scIsDay('2201-01-01'), false);
  assert.equal(L.scIsDay('0100-01-01'), false);
  assert.equal(L.scIsDay('9999-12-31'), false);
  const e = L.scClean('huge', { kind: 'work', title: 'x', start: '0100-01-01', end: '9999-12-31' });
  assert.deepEqual([e.start, e.end], ['', ''], 'a day outside is no day: the entry is undated');
});

test('the Timeline is bounded however far apart the days are', () => {
  const huge = L.scClean('huge', { kind: 'work', title: 'Forever', start: '0100-01-01', end: '9999-12-31' });
  const t0 = L.scTimeline([huge], { dayWidth: 16, today: '2026-10-15' });
  assert.deepEqual([t0.rows.length, t0.undated], [0, ['huge']], 'days outside the window: Not scheduled');
  const wide = [
    L.scClean('a', { kind: 'work', title: 'A', start: '1900-01-01', end: '2200-12-31', order: 'a' }),
    L.scClean('b', { kind: 'milestone', title: 'B', start: '2026-11-01', order: 'b' }),
    L.scClean('c', { kind: 'milestone', title: 'C', start: '1900-06-01', order: 'c' }),
    L.scClean('d', { kind: 'milestone', title: 'D', start: '2200-06-01', order: 'd', waitsOn: ['b'] }),
  ];
  const started = Date.now();
  const t = L.scTimeline(wide, { dayWidth: 16, today: '2026-10-15' });
  assert.ok(Date.now() - started < 200, 'quick');
  assert.equal(t.days, L.SC_WEEKS_MAX * 7, 'at most two years of weeks');
  assert.equal(t.weeks.length, L.SC_WEEKS_MAX);
  assert.equal(t.from, '2026-04-13', 'half a year before today when the first day is earlier still');
  assert.deepEqual(t.rows.map((r) => [r.id, r.cut || '']), [['a', 'both'], ['b', '']], 'a bar past both ends is cut at both');
  assert.deepEqual(t.rows[0], { id: 'a', kind: 'work', x: 0, w: t.width, row: 0, cut: 'both' });
  assert.deepEqual(t.outside, ['c', 'd'], 'wholly outside the weeks drawn: listed under the Timeline');
  assert.deepEqual(t.lines, [], 'no line to an entry that is not drawn');
  assert.ok(t.today !== null);
  const noToday = L.scTimeline(wide, { dayWidth: 16 });
  assert.equal(noToday.from, '1899-12-25', 'with no today, the weeks start at the first day');
  assert.equal(noToday.weeks.length, L.SC_WEEKS_MAX);
});

test('a 50,000-long chain of parents', () => {
  const es = [];
  for (let i = 0; i < 50000; i += 1) es.push(L.scClean(`e${i}`, { title: `E${i}`, parent: i ? `e${i - 1}` : undefined }));
  const got = L.scOrdered(es);
  assert.equal(got.length, 50000);
  assert.deepEqual([got[0].entry.id, got[49999].entry.id, got[49999].level], ['e0', 'e49999', 50000]);
  const t = L.scTimeline(es, { dayWidth: 16, today: '2026-10-15' });
  assert.equal(t.undated.length, 50000);
});

test('the add actions\' refusals', () => {
  const label = (k) => ({ milestone: 'session', work: 'scene' }[k] || k);
  const o = { datesRequired: true, label };
  assert.equal(L.scActionProblem('milestone', { title: 'Kick-off' }, o), 'The session needs a day.');
  assert.equal(L.scActionProblem('work', { title: 'Build' }, o), 'The scene needs a start and an end.');
  assert.equal(L.scActionProblem('work', { title: 'Build', end: '2026-10-22' }, o), '', 'one day is a one-day span');
  assert.equal(L.scActionProblem('note', { title: 'x' }, o), '', 'a note never needs a day');
  assert.equal(L.scActionProblem('milestone', { title: 'Kick-off' }, { datesRequired: false, label }), '', 'dates optional: saved at once');
  assert.equal(L.scActionProblem('milestone', { title: '  ' }, o), 'The session needs a title.');
  assert.equal(L.scActionProblem('milestone', { title: 5 }, o), 'The session needs a title.');
  assert.equal(L.scActionProblem('milestone', { title: 'x', date: '0100-01-01' }, { datesRequired: false }), 'A day must be from 1900 to 2200, written like 2026-10-14.');
  assert.equal(L.scActionProblem('work', { title: 'x', start: '2026-10-01', end: '9999-12-31' }, { datesRequired: false }), 'A day must be from 1900 to 2200, written like 2026-10-14.');
  assert.equal(L.scActionProblem('milestone', { title: 'x', date: '2026-10-20' }, o), '');
});

if (fails.length) {
  for (const f of fails) console.error(`check-schedule-lib: FAIL ${f}`);
  console.error(`check-schedule-lib: ${passed} passed, ${fails.length} failed`);
  process.exit(1);
}
console.log(`check-schedule-lib: ${passed} passed`);
