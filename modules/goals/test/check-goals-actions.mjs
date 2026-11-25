#!/usr/bin/env node
/*
 * check-goals-actions.mjs -- Planner - Goals' actions library (src/goals-lib-actions.js, ACTION_HANDLERS), run the two ways it is
 * carried out (plan-agent-edit-delete.md, decision 4, step 2): through the server's runner (its worker process and vm, then its
 * outcomeOf check) and through the SDK's page adapter (host.actions.fromLibrary) on a stand-in host, both from
 * tools/module-actions-harness.mjs, expecting the same answer. Then addGoal, addStep and addNote as before (a step moves its
 * goal's progress in the same request), updateGoal (only the fields given, "" clears, a step moved under another goal) and
 * setGoalDone (a goal whose progress is its steps has no tick of its own), and what the page hands beside the runner's ctx:
 * the plan's settings, host.util's order and label, the phases' names. The runner's ctx has them too now (plan-agent-server-
 * actions.md, step 1: ctx.settings, ctx.util.order and label), and Goals declares actions.server: every handler is run both ways, the runner with carrier 'server', and gives the same answer. Exits 1 on failure.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { onPage, onRunner, handlersOf, library } from '../../../tools/module-actions-harness.mjs';

let n = 0;
const test = async (name, fn) => { try { await fn(); n += 1; } catch (e) { process.exitCode = 1; console.error(`FAIL ${name}\n${e.stack || e}`); } };
const timeless = (writes) => (writes || []).slice().sort((a, b) => (a.key < b.key ? -1 : 1)).map((w) => ({ key: w.key, value: { ...w.value, createdAt: typeof w.value.createdAt } }));
async function same(action, input, world) {
  // The runner as the server's own: carrier 'server', so a handler that leaves work for a page must say so (none may).
  const r = { page: await onPage('goals', action, input, world, { name: 'Planner - Goals', kinds: ['plan'] }), runner: await onRunner('goals', action, input, world, { ...{ name: 'Planner - Goals', kinds: ['plan'] }, carrier: 'server' }) };
  assert.ok(!r.runner.fault, `${action}: the runner faulted (${r.runner.fault})`);
  if (r.page.refused !== undefined || r.runner.refused !== undefined) {
    assert.equal(r.runner.refused, r.page.refused, `${action}: the same refusal`);
    return r.page;
  }
  assert.deepEqual(timeless(r.runner.writes), timeless(r.page.writes), `${action}: the same writes`);
  assert.deepEqual(r.runner.ref, r.page.ref, `${action}: the same pointer`);
  assert.deepEqual(r.runner.data, r.page.data, `${action}: the same note`);
  return r.page;
}
const refuses = async (action, input, w, words) => assert.equal((await same(action, input, w)).refused, words);
const written = (r, id) => (r.writes.find((w) => w.key === `plan:${id}`) || {}).value;
const keys = (r) => r.writes.map((w) => w.key).sort();
const ref = (id) => ({ module: 'goals', kind: 'plan', id, scope: 'space', space: 's1' });
const PEOPLE = [{ key: 'u-ana', name: 'Ana Reyes' }, { key: 'u-bo', name: 'Bo Chen' }];
const G1 = { kind: 'goal', title: 'Run a marathon', parent: null, order: 'V', date: '2027-04-18', shownDate: '2027-04-18', why: 'To feel strong', owners: ['u-ana'], done: false, progress: 50, createdAt: 1, by: 'u-ana' };
const G2 = { kind: 'goal', title: 'Learn Portuguese', parent: null, order: 'W', done: false, progress: 0, createdAt: 2, by: 'u-bo' };
const ST1 = { kind: 'step', title: 'Buy shoes', parent: 'g1', order: 'V', date: '2026-12-05', shownDate: '2026-12-05', done: false, createdAt: 3, by: 'u-ana' };
const ST2 = { kind: 'step', title: 'Run 5k', parent: 'g1', order: 'W', done: true, createdAt: 4, by: 'u-ana' };
const NT1 = { kind: 'note', title: 'Shoe sizes', parent: 'g1', order: 'X', text: '42 EU', createdAt: 5, by: 'u-bo' };
const ROWS = { 'plan:g1': G1, 'plan:g2': G2, 'plan:st1': ST1, 'plan:st2': ST2, 'plan:nt1': NT1 };
const world = (rows = ROWS) => ({ space: { id: 's1', name: 'Team' }, phases: [{ id: 'build', main: false }], people: PEOPLE, rows });
// As goals.js hands them: settings, host.util's order and label, phases with their names.
const pageHandlers = ({ settings = {}, label, order } = {}) => Object.fromEntries(Object.entries(handlersOf('goals')).map(([k, f]) => [k, (input, ctx) => f(input, {
  ...ctx, settings, util: Object.freeze({ ...ctx.util, ...(order ? { order } : {}), ...(label ? { label } : {}) }), space: { ...ctx.space, phases: [{ id: 'build', main: false, label: 'Build the thing' }] },
})]));
const onThePage = (action, input, o, rows = ROWS) => onPage('goals', action, input, world(rows), { handlers: pageHandlers(o) });

await test('addGoal: the same both ways, credited to the asker\'s key, owners by name', async () => {
  const r = await same('addGoal', { title: 'Ship it', why: 'Because', date: '2027-01-02', owners: 'ana reyes, u-bo' }, world());
  assert.deepEqual(keys(r), ['plan:n1']);
  assert.deepEqual({ ...written(r, 'n1'), createdAt: 0 }, { kind: 'goal', title: 'Ship it', parent: null, order: 'X', date: '2027-01-02', shownDate: '2027-01-02', why: 'Because', owners: ['u-ana', 'u-bo'], done: false, progress: 0, createdAt: 0, by: 'agent1' }, 'ctx.util.order both ways: after its last sibling (W)');
  assert.deepEqual(r.ref, ref('n1'));
  await refuses('addGoal', { title: 'Ship it', owners: 'Zed' }, world(), 'That person is not in this space. Use list_members to see who is.');
  await refuses('addGoal', { title: ' ' }, world(), 'Give it a title.');
});
await test('addStep: under its goal, and the goal\'s progress moves in the same request', async () => {
  const r = await same('addStep', { title: 'Run 10k', goal: ref('g1'), date: '2027-01-10' }, world());
  assert.deepEqual(keys(r), ['plan:g1', 'plan:n1']);
  assert.deepEqual([written(r, 'n1').parent, written(r, 'n1').done, written(r, 'n1').by], ['g1', false, 'agent1']);
  assert.deepEqual([written(r, 'g1').progress, written(r, 'g1').done], [33, false], 'one of three done');
  const named = await same('addStep', { title: 'Taper', object: { kind: 'step', title: 'Taper', details: { under: 'run a marathon' } } }, world());
  assert.equal(written(named, 'n1').parent, 'g1', 'details.under names the goal');
  await refuses('addStep', { title: 'Taper' }, world(), 'Say which goal it goes under.');
  await refuses('addStep', { title: 'Taper', goal: ref('st1') }, world(), 'That is not a goal of this plan.');
  await refuses('addStep', { title: 'Taper', goal: { ...ref('g1'), space: 's2' } }, world(), 'That is not a goal of this plan.');
  await refuses('addStep', { title: 'T', object: { kind: 'step', title: 'T', details: { under: 'Nothing' } } }, world(), 'Add a goal first: no goal here is named "Nothing".');
});
await test('addNote: under a goal or at the top; a note is never counted', async () => {
  const r = await same('addNote', { title: 'Idea', text: 'Line one\nLine two', goal: ref('g1') }, world());
  assert.deepEqual(keys(r), ['plan:n1'], 'its goal says the same as before: not written');
  assert.deepEqual([written(r, 'n1').parent, written(r, 'n1').text], ['g1', 'Line one\nLine two']);
  const top = await same('addNote', { title: 'Idea' }, world());
  assert.equal(written(top, 'n1').parent, null);
});

await test('updateGoal changes only the fields given, and keeps who made it and when', async () => {
  const r = await same('updateGoal', { entry: ref('g1'), title: 'Run the Lisbon marathon' }, world());
  assert.deepEqual(keys(r), ['plan:g1']);
  assert.deepEqual(written(r, 'g1'), { ...G1, title: 'Run the Lisbon marathon' });
  const owners = await same('updateGoal', { entry: ref('g1'), owners: 'Bo Chen' }, world());
  assert.deepEqual(written(owners, 'g1').owners, ['u-bo'], 'the list is replaced');
  const step = await same('updateGoal', { entry: ref('st1'), date: '2026-12-06' }, world());
  assert.deepEqual(written(step, 'st1'), { ...ST1, date: '2026-12-06', shownDate: '2026-12-06' });
  const note = await same('updateGoal', { entry: ref('nt1'), text: '43 EU' }, world());
  assert.deepEqual(written(note, 'nt1'), { ...NT1, text: '43 EU' });
  const kept = await same('updateGoal', { entry: ref('g1'), title: 'Run a marathon' }, world());
  assert.deepEqual([kept.writes, kept.data], [[], { note: 'That is already so; nothing changed.' }]);
});
await test('updateGoal: "" clears why, the date, the owners or the text (the manifest\'s clears)', async () => {
  const r = await same('updateGoal', { entry: ref('g1'), why: '', date: '', owners: '' }, world());
  const { why, date, shownDate, owners, ...rest } = G1;
  assert.deepEqual(written(r, 'g1'), rest);
  const t = await same('updateGoal', { entry: ref('nt1'), text: '' }, world());
  const { text, ...noText } = NT1;
  assert.deepEqual(written(t, 'nt1'), noText);
  const m = JSON.parse(fs.readFileSync(new URL('../module.json', import.meta.url), 'utf8'));
  assert.deepEqual(m.actions.provides.find((a) => a.name === 'updateGoal').clears, ['why', 'date', 'owners', 'text']);
});
await test('updateGoal: a step moved under another goal goes to its end, and both goals say what their steps say', async () => {
  const r = await same('updateGoal', { entry: ref('st1'), goal: ref('g2') }, world());
  assert.deepEqual(keys(r), ['plan:g1', 'plan:st1'], 'the goal it went under already says 0 of 1: not written');
  assert.equal(written(r, 'st1').parent, 'g2');
  assert.deepEqual([written(r, 'g1').done, written(r, 'g1').progress], [true, 100], 'the goal it left: its one step left is done');
  const done = await same('updateGoal', { entry: ref('st2'), goal: ref('g2') }, world());
  assert.deepEqual(keys(done), ['plan:g1', 'plan:g2', 'plan:st2']);
  assert.deepEqual([written(done, 'g2').done, written(done, 'g2').progress, written(done, 'g1').progress], [true, 100, 0], 'a done step moved: both goals follow');
  const note = await same('updateGoal', { entry: ref('nt1'), goal: ref('g2') }, world());
  assert.deepEqual(keys(note), ['plan:nt1'], 'a note counts for nothing');
});
await test('updateGoal: the refusals, in the form\'s words', async () => {
  const w = world();
  await refuses('updateGoal', { entry: ref('zz'), title: 'x' }, w, 'That is no longer in the plan.');
  await refuses('updateGoal', { entry: { ...ref('g1'), space: 's2' }, title: 'x' }, w, 'That is no longer in the plan.');
  await refuses('updateGoal', { entry: ref('g1') }, w, 'Say what to change: the title, why, the date, the owners, the text or the goal it is under. Send "" to clear why, the date, the owners or the text.');
  await refuses('updateGoal', { entry: ref('st1'), why: 'x' }, w, 'Only a goal has a why.');
  await refuses('updateGoal', { entry: ref('st1'), owners: 'u-ana' }, w, 'Only a goal has owners.');
  await refuses('updateGoal', { entry: ref('g1'), text: 'x' }, w, 'Only a note has text.');
  await refuses('updateGoal', { entry: ref('nt1'), date: '2027-01-01' }, w, 'A note has no date.');
  await refuses('updateGoal', { entry: ref('g1'), goal: ref('g2') }, w, 'A goal stays at the top of the list.');
  await refuses('updateGoal', { entry: ref('st1'), goal: ref('st2') }, w, 'That is not a goal of this plan.');
  await refuses('updateGoal', { entry: ref('g1'), owners: 'Zed' }, w, 'That person is not in this space. Use list_members to see who is.');
});

await test('setGoalDone: a step, then its goal follows; a goal with no steps is its own tick', async () => {
  const r = await same('setGoalDone', { entry: ref('st1'), done: true }, world());
  assert.deepEqual(keys(r), ['plan:g1', 'plan:st1']);
  assert.equal(written(r, 'st1').done, true);
  assert.deepEqual([written(r, 'g1').done, written(r, 'g1').progress], [true, 100]);
  const open = await same('setGoalDone', { entry: ref('st2'), done: false }, world());
  assert.deepEqual([written(open, 'g1').done, written(open, 'g1').progress], [false, 0]);
  const g2 = await same('setGoalDone', { entry: ref('g2'), done: true }, world());
  assert.deepEqual(written(g2, 'g2'), { ...G2, done: true, progress: 100 });
  const kept = await same('setGoalDone', { entry: ref('st2'), done: true }, world());
  assert.deepEqual(kept.data, { note: 'That is already so; nothing changed.' });
  await refuses('setGoalDone', { entry: ref('g1'), done: true }, world(), 'That goal is done when every step is done; mark its steps instead.');
  await refuses('setGoalDone', { entry: ref('nt1'), done: true }, world(), 'A note is never done; only goals and steps are.');
  await refuses('setGoalDone', { entry: ref('zz'), done: true }, world(), 'That is no longer in the plan.');
});

await test('on the page: the plan\'s settings, host.util\'s order and label, and the phases\' names', async () => {
  const byDone = await onThePage('setGoalDone', { entry: ref('g1'), done: true }, { settings: { progressBy: 'done' } });
  assert.deepEqual([written(byDone, 'g1').done, written(byDone, 'g1').progress], [true, 100], 'progress by its own tick');
  const off = await onThePage('addGoal', { title: 'Later', date: '2027-02-02' }, { settings: { dates: 'off' } });
  assert.deepEqual([written(off, 'n1').date, written(off, 'n1').shownDate], ['2027-02-02', undefined], 'dates off: kept, shown nowhere');
  const ordered = await onThePage('addStep', { title: 'Taper', goal: ref('g1') }, { order: (a, b) => `${a || ''}V` });
  assert.equal(written(ordered, 'n1').order, 'XV', 'after the last of its siblings (its goal\'s steps and notes)');
  const words = { goal: ['aim', 'aims', 'an aim'], step: ['task', 'tasks', 'a task'] };
  const label = (k, o) => { const w = words[k] || [k, `${k}s`, `a ${k}`]; const t = o && o.a ? w[2] : o && o.many ? w[1] : w[0]; return o && o.cap ? t[0].toUpperCase() + t.slice(1) : t; };
  assert.equal((await onThePage('addStep', { title: 'T' }, { label })).refused, 'Say which aim it goes under.');
  assert.equal((await onThePage('setGoalDone', { entry: ref('g1'), done: true }, { label })).refused, 'That aim is done when every task is done; mark its tasks instead.');
  const phased = await onThePage('addGoal', { title: 'G', object: { kind: 'goal', title: 'G', details: { phase: 'build the thing' } } }, {});
  assert.equal(written(phased, 'n1').phase, 'build', 'a phase matched by its name');
  const page = fs.readFileSync(new URL('../src/goals.js', import.meta.url), 'utf8');
  assert.match(page, /settings: \{ dates: prefs\.dates, progressBy: prefs\.progressBy \}/);
  assert.match(page, /util: Object\.freeze\(\{ \.\.\.ctx\.util, order: host\.util\.order, label \}\)/);
  assert.match(page, /phases: phases\(\)\.map\(\(p\) => \(\{ id: p\.id, main: Boolean\(p\.main\), label: p\.label \}\)\)/);
});

await test('the manifest: updateGoal and setGoalDone, within the caps; actions.server is the library', async () => {
  const m = JSON.parse(fs.readFileSync(new URL('../module.json', import.meta.url), 'utf8'));
  const act = (name) => m.actions.provides.find((a) => a.name === name);
  assert.deepEqual(act('updateGoal').input, { entry: 'ref:goals:plan', title: 'string?', why: 'text?', date: 'date?', owners: 'text?', text: 'text?', goal: 'ref:goals:plan?' });
  assert.deepEqual(act('setGoalDone').input, { entry: 'ref:goals:plan', done: 'boolean' });
  for (const a of m.actions.provides) {
    assert.match(a.description, /^[^.]+\.$/, `${a.name}: one sentence`);
    for (const [k, v] of Object.entries(a.inputHints || {})) assert.ok(k in a.input && v.length <= 200, `${a.name}.${k}`);
  }
  assert.equal(m.actions.server, 'src/goals-lib-actions.js', 'carried out on the server too');
  const lib = library('goals').js;
  for (const name of m.actions.provides.filter((a) => !a.local).map((a) => a.name)) assert.match(lib, new RegExp(`\\n    ${name}\\(input, ctx\\) \\{`), `${name} is a handler in the library`);
});

if (!process.exitCode) console.log(`check-goals-actions: OK (${n} tests)`);
