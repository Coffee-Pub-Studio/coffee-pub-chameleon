#!/usr/bin/env node
/*
 * check-schedule-lib-actions.mjs -- Planner - Projects' actions library (src/schedule-lib-actions.js, ACTION_HANDLERS) through the
 * SDK's page adapter (host.actions.fromLibrary) on a stand-in host, from tools/module-actions-harness.mjs, with the facts only the
 * page gives (its settings, words, order keys and phases, as schedule.js withPage adds them): addMilestone, addWork and addNote
 * (the plan's "Dates are needed", owners by name, an object's parent and phase by name, the order key at the end), setDone and
 * updateEntry (only the fields given, "" clearing a day, the owners or the notes), each with the editor's sentence. Then the
 * server's runner on the same library, which refuses plainly: its ctx has none of the page's facts, so the manifest declares no
 * actions.server. Exits 1 on failure.
 */
import assert from 'node:assert/strict';
import { onPage, onRunner, handlersOf } from '../../../tools/module-actions-harness.mjs';

let n = 0;
const test = async (name, fn) => { try { await fn(); n += 1; } catch (e) { process.exitCode = 1; console.error(`FAIL ${name}\n${e.stack || e}`); } };
const WORDS = { plan: 'project', milestone: 'checkpoint', work: 'job', note: 'note' };
// As schedule.js withPage: the page's facts beside the runner's ctx.
const withPage = (settings, phases = []) => Object.fromEntries(Object.entries(handlersOf('schedule')).map(([k, fn]) => [k, (input, ctx) => fn(input, Object.assign(ctx, {
  settings, label: (w) => WORDS[w] || w, order: (a) => (a ? `${a}z` : 'm'), phases,
}))]));
const page = (action, input, world, settings = { datesRequired: true }, phases) => onPage('schedule', action, input, world, { handlers: withPage(settings, phases), name: 'Planner - Projects' });
const refuses = async (action, input, world, words, settings) => assert.equal((await page(action, input, world, settings)).refused, words);
const written = (r, key) => (r.writes.find((w) => w.key === key) || {}).value;
const SPACE = { id: 's1', name: 'Launch' };
const PEOPLE = [{ key: 'u-ana', name: 'Ana' }, { key: 'u-bo', name: 'Bo' }];
const world = (rows = {}) => ({ space: SPACE, rows, people: PEOPLE });
const ref = (id) => ({ module: 'schedule', kind: 'plan', id, scope: 'space', space: 's1' });
const MS = { kind: 'milestone', title: 'Ship', start: '2026-12-01', done: false, order: 'm', by: 'u-ana' };
const WK = { kind: 'work', title: 'Write docs', start: '2026-11-01', end: '2026-11-10', owners: ['u-bo'], done: false, notes: 'Keep it short', parent: 'ms', order: 'm', by: 'u-ana' };
const NT = { kind: 'note', title: 'Idea', notes: 'x', order: 'mz', by: 'u-ana' };
const rows = () => ({ 'plan:ms': MS, 'plan:wk': WK, 'plan:nt': NT });

await test('the adds: the editor\'s rules, the asker\'s key, the order at the end', async () => {
  const m = await page('addMilestone', { title: 'Beta', date: '2026-11-20', notes: 'a\nb' }, world(rows()));
  assert.deepEqual(written(m, 'plan:n1'), { kind: 'milestone', title: 'Beta', start: '2026-11-20', done: false, notes: 'a\nb', order: 'mzz', by: 'agent1' });
  assert.deepEqual(m.ref, ref('n1'));
  const w = await page('addWork', { title: 'Test', start: '2026-11-02', owners: 'Ana, u-bo' }, world(rows()));
  assert.deepEqual(written(w, 'plan:n1'), { kind: 'work', title: 'Test', start: '2026-11-02', end: '2026-11-02', owners: ['u-ana', 'u-bo'], done: false, order: 'mzz', by: 'agent1' });
  const note = await page('addNote', { title: 'Thought' }, world());
  assert.deepEqual(written(note, 'plan:n1'), { kind: 'note', title: 'Thought', order: 'm', by: 'agent1' });
  await refuses('addMilestone', { title: 'Beta' }, world(), 'The checkpoint needs a day.');
  await refuses('addWork', { title: 'Test' }, world(), 'The job needs a start and an end.');
  await refuses('addMilestone', { title: ' ' }, world(), 'The checkpoint needs a title.');
  await refuses('addMilestone', { title: 'Beta', date: '2301-01-01' }, world(), 'A day must be from 1900 to 2200, written like 2026-10-14.');
  await refuses('addWork', { title: 'Test', start: '2026-11-02', owners: 'Zed' }, world(), 'That person is not in this space. Use list_members to see who is.');
  const undated = await page('addMilestone', { title: 'Someday' }, world(), { datesRequired: false });
  assert.equal(written(undated, 'plan:n1').start, undefined, 'dates off: an undated milestone');
});

await test('an object\'s parent and phase by name, its done ticked', async () => {
  const object = { kind: 'work', title: 'Polish', details: { start: '2026-11-03', end: '2026-11-04', under: 'Ship', phase: 'Build it', done: true } };
  const r = await page('addWork', { title: 'Polish', object }, world(rows()), { datesRequired: true }, [{ id: 'build', label: 'Build it' }]);
  const v = written(r, 'plan:n1');
  assert.deepEqual([v.parent, v.phase, v.done, v.start, v.end, v.order], ['ms', 'build', true, '2026-11-03', '2026-11-04', 'mz']);
});

await test('setDone ticks a milestone and marks work done; a note has nothing to tick', async () => {
  const m = await page('setDone', { ref: ref('ms'), done: true }, world(rows()));
  assert.deepEqual(written(m, 'plan:ms'), { ...MS, ticked: true, done: true });
  const w = await page('setDone', { ref: ref('wk'), done: true }, world(rows()));
  assert.deepEqual(written(w, 'plan:wk'), { ...WK, done: true });
  await refuses('setDone', { ref: ref('nt'), done: true }, world(rows()), 'A note has nothing to tick off.');
  await refuses('setDone', { ref: ref('zz'), done: true }, world(rows()), 'That is not on the project.');
  await refuses('setDone', { ref: ref('ms'), done: 'yes' }, world(rows()), 'Say whether it is done: true or false.');
});

await test('updateEntry changes only the fields given; "" clears a day, the owners and the notes', async () => {
  const t = await page('updateEntry', { ref: ref('wk'), title: 'Write the docs' }, world(rows()));
  assert.deepEqual(written(t, 'plan:wk'), { ...WK, title: 'Write the docs' });
  const cleared = await page('updateEntry', { ref: ref('wk'), owners: '', notes: '' }, world(rows()));
  const { owners, notes, ...rest } = WK;
  assert.deepEqual(written(cleared, 'plan:wk'), rest);
  const day = await page('updateEntry', { ref: ref('ms'), date: '' }, world(rows()), { datesRequired: false });
  assert.equal(written(day, 'plan:ms').start, undefined);
  await refuses('updateEntry', { ref: ref('ms'), date: '' }, world(rows()), 'This plan needs dates: give the checkpoint a day.');
  await refuses('updateEntry', { ref: ref('wk'), end: '2026-10-01' }, world(rows()), 'The end is before the start.');
  await refuses('updateEntry', { ref: ref('ms'), start: '2026-11-01' }, world(rows()), 'The checkpoint has a day, not a start and an end.');
  await refuses('updateEntry', { ref: ref('ms'), owners: 'Ana' }, world(rows()), 'Only job says who is doing it.');
  await refuses('updateEntry', { ref: ref('nt'), date: '2026-11-01' }, world(rows()), 'A note has no day.');
  await refuses('updateEntry', { ref: ref('wk') }, world(rows()), 'Say what to change: a title, a day, notes.');
  await refuses('updateEntry', { ref: { ...ref('wk'), space: 's2' }, title: 'x' }, world(rows()), 'That is not on the project.');
});

await test('the server\'s runner refuses plainly: its ctx has none of the page\'s facts', async () => {
  const r = await onRunner('schedule', 'addNote', { title: 'Thought' }, world(), { kinds: ['plan'] });
  assert.equal(r.refused, 'Planner - Projects can only do that with its page open.');
  const p = await onPage('schedule', 'addNote', { title: 'Thought' }, world(), { name: 'Planner - Projects' });
  assert.equal(p.refused, r.refused, 'the same on a page that gives none of them');
});

if (process.exitCode) { console.error(`check-schedule-lib-actions: failed (${n} passed)`); process.exit(1); }
console.log(`check-schedule-lib-actions: OK (${n} checks)`);
