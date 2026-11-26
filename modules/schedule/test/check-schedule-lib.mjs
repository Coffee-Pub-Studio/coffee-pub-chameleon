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
const NAMES = ['SC_PREFIX', 'SC_KINDS', 'scIsDay', 'scClean', 'scValue', 'scProblem', 'scOrdered', 'scMilestoneChanges', 'scProgress', 'scMakesLoop', 'scMonday', 'scAddDays', 'scLate', 'scTimeline', 'scFromAction', 'scActionProblem', 'SC_WEEKS_MAX', 'scSetDone', 'scCleanBoard', 'scBoardValue', 'scDefaultBoard', 'scBoardFrom', 'scColumnOf', 'scSetColumn', 'scSetColumnFlag', 'scDeleteColumn', 'scAddColumn', 'scRenameColumn', 'scMoveColumn', 'scColumnId'];
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
    ['columns', "Change the board's columns and fields", false, false, true],
    ['write_out', 'Change it on GitHub', false, false, true],
    ['clear', 'Clear the whole plan', false, false, true],
  ]);
  assert.deepEqual(manifest.access, { read: 'view', write: 'edit' });
  assert.equal(manifest.guards.clear, 'clear');
  assert.equal(manifest.guards.keys.length, 2, 'two rules: the board and the fields');
  assert.equal(manifest.guards.keys[0].key, 'board:{id}');
  assert.equal(manifest.guards.keys[0].need, 'columns', 'a board is written only by whoever has the columns right');
  assert.equal(manifest.guards.keys[1].key, 'field:{id}');
  assert.equal(manifest.guards.keys[1].need, 'columns', 'a field is defined only by whoever has the columns right');
  assert.equal(manifest.uploads, undefined, 'no uploads');
  assert.equal(manifest.starter, true);
  assert.deepEqual(Object.keys(manifest.labels), ['plan', 'milestone', 'work', 'note', 'owner', 'tag', 'board-inbox', 'board-now', 'board-next', 'board-later', 'board-done', 'board-todo', 'board-doing']);
  const marks = Object.fromEntries(manifest.settings.map((s) => [s.key, [s.type, s.scope, s.template, s.default]]));
  assert.deepEqual(marks, {
    datesRequired: ['boolean', 'space', 'driven', true],
    dependencies: ['boolean', 'space', 'driven', true],
    progressBy: ['choice', 'space', 'driven', 'milestones'],
    defaultView: ['choice', 'space', 'default', 'timeline'],
    boardColumns: ['choice', 'space', 'default', 'stages'],
    tags: ['list', 'space', 'default', []],
    githubRepo: ['text', 'space', undefined, ''],
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

const ids = (b) => b.columns.map((c) => c.id).join(',');
const flags = (b) => b.columns.filter((c) => c.done).map((c) => c.id).join(',');
const W = (o = {}) => L.scClean('w1', { kind: 'work', title: 'W', start: '2026-03-01', end: '2026-03-02', ...o });
const roll = (list) => { const r = {}; for (const e of list) if (e.parent) { r[e.parent] = r[e.parent] || { done: 0, total: 0 }; r[e.parent].total += 1; if (e.done) r[e.parent].done += 1; } return r; };

test('the template defaults and the stored board', () => {
  assert.equal(ids(L.scDefaultBoard('priority')), 'inbox,now,next,later,done');
  assert.equal(ids(L.scDefaultBoard('stages')), 'todo,doing,done');
  assert.equal(ids(L.scDefaultBoard(undefined)), 'todo,doing,done', 'stages is the default');
  assert.equal(ids(L.scDefaultBoard('nonsense')), 'todo,doing,done');
  assert.equal(flags(L.scDefaultBoard('priority')), 'done', 'only done carries the flag');
  assert.equal(flags(L.scDefaultBoard('stages')), 'done');
  assert.deepEqual(L.scDefaultBoard('stages'), { id: 'main', name: 'Board', field: 'column', columns: [{ id: 'todo', label: 'To do' }, { id: 'doing', label: 'Doing' }, { id: 'done', label: 'Done', done: true }] });
  const own = { id: 'main', name: 'Mine', field: 'column', columns: [{ id: 'a', label: 'A' }, { id: 'z', label: 'Z', done: true }], rowsBy: 'milestone' };
  assert.deepEqual(L.scBoardFrom(own, 'priority'), own, 'the stored record wins');
  assert.deepEqual(L.scBoardValue(L.scCleanBoard('main', own)), own);
  assert.equal(ids(L.scBoardFrom(null, 'priority')), 'inbox,now,next,later,done');
  for (const bad of [null, 'x', [], {}, { columns: 'x' }, { columns: [] }, { columns: [{ id: 'a', label: 'A', done: true }] }, { columns: [{ id: 'a', label: 'A' }] }, { columns: [{ id: 'A', label: 'A' }, { id: 'b', label: 'B', done: true }] }]) {
    assert.equal(L.scCleanBoard('main', bad), null, JSON.stringify(bad));
    assert.equal(ids(L.scBoardFrom(bad, 'stages')), 'todo,doing,done', 'a stored board that does not read gives way to the default');
  }
  const messy = L.scCleanBoard('main', { name: ' ', rowsBy: 'tag', columns: [{ id: 'a', label: ' A  b ' }, { id: 'a', label: 'dup' }, { id: 'b', label: '' }, { id: 'c', label: 'C', done: 'yes' }, { id: 'd', label: 'D', done: true }] });
  assert.deepEqual(messy, { id: 'main', name: 'Board', field: 'column', columns: [{ id: 'a', label: 'A b' }, { id: 'c', label: 'C' }, { id: 'd', label: 'D', done: true }] });
  const many = L.scCleanBoard('main', { columns: Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, label: `C${i}`, done: i === 0 })) });
  assert.equal(many.columns.length, 12, 'at most 12 columns');
});

test('work has a column; milestones and notes never', () => {
  assert.equal(W({ column: 'doing' }).column, 'doing');
  assert.equal(L.scValue(W({ column: 'doing' })).column, 'doing');
  assert.equal('column' in L.scValue(W()), false, 'written only when set');
  assert.equal(W({ column: 'Bad Id' }).column, undefined);
  assert.equal(W({ column: 4 }).column, undefined);
  for (const kind of ['milestone', 'note']) {
    const e = L.scClean('x', { kind, title: 'x', column: 'doing' });
    assert.equal(e.column, undefined, kind);
    assert.equal('column' in L.scValue(e), false, kind);
  }
});

test('a column for work without one, or one the board lacks', () => {
  for (const set of ['stages', 'priority']) {
    const b = L.scDefaultBoard(set);
    const first = b.columns[0].id;
    assert.equal(L.scColumnOf(W(), b).id, first, `${set}: open work`);
    assert.equal(L.scColumnOf(W({ done: true }), b).id, 'done', `${set}: done work`);
    assert.equal(L.scColumnOf(W({ column: 'gone' }), b).id, first, `${set}: a column that is not on the board`);
    assert.equal(L.scColumnOf(W({ column: 'gone', done: true }), b).id, 'done');
    assert.equal(L.scColumnOf(W({ column: b.columns[1].id }), b).id, b.columns[1].id, `${set}: its own`);
  }
  const b = L.scCleanBoard('main', { columns: [{ id: 'fin', label: 'Fin', done: true }, { id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'fin2', label: 'Fin 2', done: true }] });
  assert.equal(L.scColumnOf(W({ done: true }), b).id, 'fin', 'the first done column');
  assert.equal(L.scColumnOf(W(), b).id, 'a', 'the first column without the flag');
});

test('scSetColumn sets the column and done from its flag; refuses what is not work or not a column', () => {
  const b = L.scDefaultBoard('priority');
  const r = L.scSetColumn(W(), 'now', b);
  assert.deepEqual([r.entry.column, r.entry.done, r.problem], ['now', false, '']);
  const d = L.scSetColumn(W({ column: 'now' }), 'done', b);
  assert.deepEqual([d.entry.column, d.entry.done], ['done', true]);
  const back = L.scSetColumn(d.entry, 'later', b);
  assert.deepEqual([back.entry.column, back.entry.done], ['later', false]);
  assert.equal(L.scSetColumn(L.scClean('m', { kind: 'milestone', title: 'M' }), 'now', b).problem, 'Only work moves on the board.');
  assert.equal(L.scSetColumn(L.scClean('n', { kind: 'note', title: 'N' }), 'now', b).problem, 'Only work moves on the board.');
  assert.equal(L.scSetColumn(W(), 'nowhere', b).problem, 'There is no column called nowhere.');
  assert.equal(L.scSetColumn(W(), 4, b).problem, 'There is no column called that.');
});

test('the tick moves work to the first done column, the untick to the first column without the flag', () => {
  const b = L.scDefaultBoard('priority');
  const up = L.scSetDone(W({ column: 'now' }), true, { board: b }).entry;
  assert.deepEqual([up.column, up.done], ['done', true]);
  const down = L.scSetDone(up, false, { board: b }).entry;
  assert.deepEqual([down.column, down.done], ['inbox', false]);
  const fresh = L.scSetDone(W(), true, { board: b }).entry;
  assert.deepEqual([fresh.column, fresh.done], ['done', true]);
  const two = L.scCleanBoard('main', { columns: [{ id: 'a', label: 'A' }, { id: 'f1', label: 'F1', done: true }, { id: 'f2', label: 'F2', done: true }] });
  assert.equal(L.scSetDone(W({ column: 'f2', done: true }), true, { board: two }).entry.column, 'f2', 'already in a done column: left alone');
  assert.equal(L.scSetDone(W({ column: 'f2', done: true }), false, { board: two }).entry.column, 'a');
  assert.equal(L.scSetDone(W({ column: 'a' }), false, { board: two }).entry.column, 'a', 'unticked work not in a done column stays');
  assert.equal(L.scSetDone(W(), true, { board: two }).entry.column, 'f1');
  assert.equal(L.scSetDone(W({ done: true }), false, { board: two }).entry.column, 'a', 'done work with no column, unticked');
  assert.equal(L.scSetDone(W(), true).entry.column, undefined, 'without a board it is the tick as it was');
  const m = L.scSetDone(L.scClean('m', { kind: 'milestone', title: 'M' }), true, { board: b }).entry;
  assert.deepEqual([m.ticked, m.done, m.column], [true, true, undefined], 'a milestone\'s tick is unchanged');
});

test('a changed flag rewrites done for the work in the column and settles the milestones', () => {
  const b = L.scDefaultBoard('priority');
  const ms = L.scClean('ms', { kind: 'milestone', title: 'M', start: '2026-03-01', done: false, progress: 0 });
  const a = L.scClean('a', { kind: 'work', title: 'A', start: '2026-03-01', end: '2026-03-02', parent: 'ms', column: 'later' });
  const c = L.scClean('c', { kind: 'work', title: 'C', start: '2026-03-01', end: '2026-03-02', parent: 'ms', column: 'done', done: true });
  const nt = L.scClean('nt', { kind: 'note', title: 'N' });
  const entries = [ms, a, c, nt];
  const r = L.scSetColumnFlag(b, entries, 'later', true, { rollup: roll });
  assert.equal(r.problem, undefined);
  assert.equal(flags(r.board), 'later,done');
  const byId = Object.fromEntries(r.entries.map((e) => [e.id, e]));
  assert.deepEqual(Object.keys(byId).sort(), ['a', 'ms'], 'only what changed');
  assert.equal(byId.a.done, true);
  assert.equal(byId.a.column, 'later', 'the column stays');
  assert.deepEqual([byId.ms.done, byId.ms.progress], [true, 100], 'the milestone follows');
  const off = L.scSetColumnFlag(r.board, [byId.ms, byId.a, c], 'later', false, { rollup: roll });
  assert.equal(off.entries.find((e) => e.id === 'a').done, false);
  assert.equal(off.entries.find((e) => e.id === 'ms').done, false);
  assert.deepEqual(L.scSetColumnFlag(b, entries, 'done', true, { rollup: roll }).entries, [], 'no change, no writes');
  const loose = L.scSetColumnFlag(b, [W({ id: 'l' })], 'inbox', true, { rollup: roll });
  assert.equal(loose.entries[0].done, true, 'work with no column is read as the first one');
  assert.equal(L.scSetColumnFlag(b, entries, 'done', false, { rollup: roll }).problem, 'Keep at least one column that counts as done.');
  assert.equal(L.scSetColumnFlag(r.board, entries, 'done', false, { rollup: roll }).problem, undefined, 'a second done column frees the first');
  const lone = L.scDefaultBoard('stages');
  const nearly = L.scSetColumnFlag(lone, [], 'todo', true).board;
  assert.equal(L.scSetColumnFlag(nearly, [], 'doing', true).problem, 'Keep at least one column that does not count as done.');
  assert.equal(L.scSetColumnFlag(b, entries, 'zz', true).problem, 'There is no column called zz.');
});

test('deleting a column moves its work, and keeps the last of each kind', () => {
  const b = L.scDefaultBoard('priority');
  const ms = L.scClean('ms', { kind: 'milestone', title: 'M', start: '2026-03-01' });
  const a = L.scClean('a', { kind: 'work', title: 'A', start: '2026-03-01', end: '2026-03-02', parent: 'ms', column: 'later' });
  const loose = L.scClean('l', { kind: 'work', title: 'L', start: '2026-03-01', end: '2026-03-02', parent: 'ms' });
  const r = L.scDeleteColumn(b, 'later', 'done', [ms, a, loose], { rollup: roll });
  assert.equal(r.problem, undefined);
  assert.equal(ids(r.board), 'inbox,now,next,done');
  const byId = Object.fromEntries(r.entries.map((e) => [e.id, e]));
  assert.deepEqual([byId.a.column, byId.a.done], ['done', true], 'takes the target\'s flag');
  assert.equal(byId.l, undefined, 'work in another column (here none, read as inbox) stays');
  assert.deepEqual([byId.ms.done, byId.ms.progress], [false, 50]);
  const first = L.scDeleteColumn(b, 'inbox', 'now', [loose, a], { rollup: roll });
  assert.equal(first.entries.find((e) => e.id === 'l').column, 'now', 'work with no column reads as the deleted one, and moves');
  assert.equal(L.scDeleteColumn(b, 'later', 'later', []).problem, 'Choose another column to take its work.');
  assert.equal(L.scDeleteColumn(b, 'later', 'zz', []).problem, 'Choose another column to take its work.');
  assert.equal(L.scDeleteColumn(b, 'later', undefined, []).problem, 'Choose another column to take its work.');
  assert.equal(L.scDeleteColumn(b, 'zz', 'now', []).problem, 'There is no column called zz.');
  assert.equal(L.scDeleteColumn(b, 'done', 'now', []).problem, 'Keep at least one column that counts as done.', 'the last done column');
  const open = L.scCleanBoard('main', { columns: [{ id: 'a', label: 'A' }, { id: 'f1', label: 'F1', done: true }, { id: 'f2', label: 'F2', done: true }] });
  assert.equal(L.scDeleteColumn(open, 'a', 'f1', []).problem, 'Keep at least one column that does not count as done.', 'the last column without the flag');
  assert.equal(L.scDeleteColumn(open, 'f1', 'f2', []).problem, undefined, 'one of two done columns');
  const tiny = { id: 'main', name: 'B', field: 'column', columns: [{ id: 'a', label: 'A' }] };
  assert.equal(L.scDeleteColumn(tiny, 'a', 'a', []).problem, 'Keep at least one column.');
});

test('the editor: new ids from the name, rename keeps the id, at most 12, no empty names, order', () => {
  const b = L.scDefaultBoard('stages');
  const r = L.scAddColumn(b, '  Review  ', 'todo');
  assert.equal(ids(r.board), 'todo,review,doing,done');
  assert.deepEqual(r.column, { id: 'review', label: 'Review' });
  assert.equal(L.scAddColumn(r.board, 'Review').column.id, 'review-2', 'a number added when taken');
  assert.equal(ids(L.scAddColumn(b, 'Last').board), 'todo,doing,done,last', 'at the end without an after');
  assert.equal(L.scColumnId('Ready for QA!', b), 'ready-for-qa');
  assert.equal(L.scColumnId('2nd pass', b), 'c-2nd-pass', 'an id starts with a letter');
  assert.equal(L.scColumnId('???', b), 'c', 'a name with no letters or digits');
  assert.ok(/^[a-z][a-z0-9-]{0,40}$/.test(L.scColumnId('x'.repeat(40), b)));
  assert.equal(L.scAddColumn(b, '   ').problem, 'Give the column a name.');
  assert.equal(L.scAddColumn(b, 'x'.repeat(41)).problem, 'A column name is at most 40 characters.');
  let full = b;
  for (let i = 0; full.columns.length < 12; i += 1) full = L.scAddColumn(full, `Col ${i}`).board;
  assert.equal(full.columns.length, 12);
  assert.equal(L.scAddColumn(full, 'One more').problem, 'A board has at most 12 columns.');
  const renamed = L.scRenameColumn(b, 'doing', ' In progress ').board;
  assert.deepEqual(renamed.columns[1], { id: 'doing', label: 'In progress' }, 'the id stays, so every card\'s column does');
  assert.equal(L.scColumnOf(W({ column: 'doing' }), renamed).label, 'In progress');
  assert.equal(L.scAddColumn(renamed, 'Doing').column.id, 'doing-2', 'a renamed column\'s id is not reused');
  assert.equal(L.scRenameColumn(b, 'doing', ' ').problem, 'Give the column a name.');
  assert.equal(L.scRenameColumn(b, 'zz', 'x').problem, 'There is no column called zz.');
  assert.equal(ids(L.scMoveColumn(b, 'done', -1).board), 'todo,done,doing');
  assert.equal(ids(L.scMoveColumn(b, 'todo', 1).board), 'doing,todo,done');
  assert.equal(ids(L.scMoveColumn(b, 'todo', -1).board), 'todo,doing,done', 'at the edge nothing moves');
  assert.equal(L.scMoveColumn(b, 'zz', 1).problem, 'There is no column called zz.');
});

test('pulled work keeps when the service last changed it, and writeOut is the moderator\'s', () => {
  const src = { from: 'github', repo: 'o/r', number: 4, url: 'https://github.com/o/r/issues/4', updated: '2026-11-01T00:00:05.000Z' };
  assert.deepEqual(L.scClean('gh-4', { kind: 'work', title: 'T', source: src }).source, src);
  assert.equal(L.scClean('gh-4', { kind: 'work', title: 'T', source: { ...src, updated: 'yesterday' } }).source.updated, undefined);
  const perm = manifest.permissions.find((p) => p.key === 'write_out');
  assert.deepEqual([perm.label, perm.default], ['Change it on GitHub', { member: false, guest: false, moderator: true }]);
});

if (fails.length) {
  for (const f of fails) console.error(`check-schedule-lib: FAIL ${f}`);
  console.error(`check-schedule-lib: ${passed} passed, ${fails.length} failed`);
  process.exit(1);
}
console.log(`check-schedule-lib: ${passed} passed`);
