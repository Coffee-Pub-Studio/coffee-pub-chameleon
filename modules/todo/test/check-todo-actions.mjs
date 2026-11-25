#!/usr/bin/env node
/*
 * check-todo-actions.mjs -- To-do's actions library (src/todo-lib-actions.js, ACTION_HANDLERS), run the two ways it is carried
 * out (plan-agent-edit-delete.md, decision 4, step 2): through the server's runner (its worker process and vm, then its
 * outcomeOf check) and through the SDK's page adapter (host.actions.fromLibrary) on a stand-in host, both from
 * tools/module-actions-harness.mjs, expecting the same answer. Then: createTask, updateTask (only the fields given, notes
 * cleared with ""), setTaskDue setting and clearing the due date (the reminder off with it), setTaskDone, linkTask and the new
 * unlinkTask, each refusal with the form's sentence, and the reminder's schedule and the link changes each answers beside its
 * write, which either carrier does at once (nothing is marked for a page). Exits 1 on failure.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { both, onRunner } from '../../../tools/module-actions-harness.mjs';

const manifest = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'module.json'), 'utf8'));
let n = 0;
const test = async (name, fn) => { try { await fn(); n += 1; } catch (e) { process.exitCode = 1; console.error(`FAIL ${name}\n${e.stack || e}`); } };
const NOW = 1790000000000;
async function same(action, input, world) {
  const r = await both('todo', action, input, world, { name: 'To-do', kinds: ['task'], now: NOW });
  assert.ok(!r.runner.fault, `${action}: the runner faulted (${r.runner.fault})`);
  if (r.page.refused !== undefined || r.runner.refused !== undefined) {
    assert.equal(r.runner.refused, r.page.refused, `${action}: the same refusal`);
    return r.page;
  }
  // The page's clock is its own (Date.now()), the runner's the one given: compared without createdAt and doneAt.
  const flat = (ws) => ws.map((w) => ({ key: w.key, value: { ...w.value, createdAt: typeof w.value.createdAt, doneAt: typeof w.value.doneAt } }));
  assert.deepEqual(flat(r.runner.writes), flat(r.page.writes), `${action}: the same writes`);
  assert.deepEqual(r.runner.ref, r.page.ref, `${action}: the same pointer`);
  assert.deepEqual(r.runner.data, r.page.data, `${action}: the same note`);
  assert.deepEqual(r.runner.effects.links, r.page.effects.links, `${action}: the same link changes`);
  return r.page;
}
const server = (action, input, world) => onRunner('todo', action, input, world, { kinds: ['task'], now: NOW, carrier: 'server' });
const refuses = async (action, input, world, words) => assert.equal((await same(action, input, world)).refused, words);
const written = (r, key) => (r.writes.find((w) => w.key === key) || {}).value;
const SPACE = { id: 's1', name: 'Lisbon 2027' };
const EVENT = { module: 'calendar', kind: 'event', id: 'e1', scope: 'space', space: 's1' };
const PLACE = { module: 'maps', kind: 'place', id: 'p1', scope: 'space', space: 's1' };
const key = (r) => [r.module, r.kind, r.id, r.scope, r.space || ''].join('|');
const SUMMARIES = [{ ref: EVENT, title: 'Dinner', subtitle: '', kind: 'event' }, { ref: PLACE, title: 'Belem', subtitle: '', kind: 'place' }];
const world = (rows = {}) => ({ space: SPACE, rows, summaries: SUMMARIES });
const ref = (id) => ({ module: 'todo', kind: 'task', id, scope: 'space', space: 's1' });
const TAPE = { id: 'a', title: 'Buy tape', notes: 'two rolls', due: '2099-01-01', remind: true, done: false, doneAt: null, createdAt: 1, by: 'Ann', links: [EVENT], rules: { [key(EVENT)]: { done: 'tick' } }, autoDone: false };
const rows = () => ({ 'task:a': TAPE });

await test('the manifest: the server carries it, the new and changed actions as the plan has them', () => {
  assert.equal(manifest.actions.server, 'src/todo-lib-actions.js');
  const a = (name) => manifest.actions.provides.find((x) => x.name === name);
  assert.deepEqual(a('unlinkTask').input, { task: 'ref:todo:task', target: 'ref' });
  assert.equal(a('setTaskDue').input.date, 'date?');
  assert.deepEqual(a('setTaskDue').clears, ['date']);
  assert.deepEqual(a('updateTask').clears, ['notes']);
  for (const x of manifest.actions.provides.filter((p) => !p.local)) {
    assert.match(x.description, /^[^.!?]+\.$/, `${x.name}: one sentence`);
    for (const h of Object.values(x.inputHints || {})) assert.ok(h.length <= 200, `${x.name}: a hint of at most 200`);
  }
});

await test('createTask: the same both ways, credited to the asker, linked when the list may link to it', async () => {
  const r = await same('createTask', { title: ' Call ', due: '2099-02-02', remind: true, ref: EVENT }, world());
  const v = written(r, 'task:n1');
  assert.deepEqual({ ...v, createdAt: 0 }, { id: 'n1', title: 'Call', notes: '', due: '2099-02-02', remind: true, done: false, doneAt: null, createdAt: 0, by: 'Claude (agent)', links: [EVENT], autoDone: false });
  assert.deepEqual(r.ref, ref('n1'));
  const gone = await same('createTask', { title: 'Call', ref: { module: 'calendar', kind: 'event', id: 'zz', scope: 'space', space: 's1' } }, world());
  assert.deepEqual(written(gone, 'task:n1').links, [], 'what it may not link to is left off, as before');
  const object = await same('createTask', { title: 'x', object: { kind: 'task', title: 'Pack', details: { due: '2099-03-03T10:00' } } }, world());
  assert.deepEqual([written(object, 'task:n1').title, written(object, 'task:n1').due], ['Pack', '2099-03-03']);
  await refuses('createTask', { title: '  ' }, world(), 'a task needs a title');
  await refuses('createTask', { title: 'Call', remind: true }, world(), 'A reminder needs a due date.');
  await refuses('createTask', { title: 'Call', remind: 'yes' }, world(), 'Say whether to remind with true or false.');
});

await test('updateTask changes only the fields given; "" clears the notes', async () => {
  const t = await same('updateTask', { task: ref('a'), title: '  Buy gaffer tape  ' }, world(rows()));
  assert.deepEqual(written(t, 'task:a'), { ...TAPE, title: 'Buy gaffer tape' });
  const notes = await same('updateTask', { task: ref('a'), notes: '' }, world(rows()));
  assert.deepEqual(written(notes, 'task:a'), { ...TAPE, notes: '' });
  const off = await same('updateTask', { task: ref('a'), remind: false }, world(rows()));
  assert.deepEqual(written(off, 'task:a'), { ...TAPE, remind: false });
  await refuses('updateTask', { task: ref('a') }, world(rows()), 'Say what to change: title, notes or remind.');
  await refuses('updateTask', { task: ref('a'), title: ' ' }, world(rows()), 'A task needs a name.');
  await refuses('updateTask', { task: ref('a'), title: 'x'.repeat(201) }, world(rows()), 'A title can be 200 letters at most.');
  await refuses('updateTask', { task: ref('a'), notes: 'x'.repeat(1001) }, world(rows()), 'Notes can be 1000 letters at most.');
  await refuses('updateTask', { task: ref('a'), remind: 'yes' }, world(rows()), 'Say whether to remind with true or false.');
  await refuses('updateTask', { task: ref('nope'), title: 'x' }, world(rows()), 'that task is not here');
  await refuses('updateTask', { task: { ...ref('a'), space: 's2' }, title: 'x' }, world(rows()), 'that task is not here');
  await refuses('updateTask', { task: ref('a'), remind: true }, world({ 'task:a': { ...TAPE, due: null, remind: false } }), 'A reminder needs a due date.');
});

await test('setTaskDue sets the day, and clears it (left out or "") with its reminder', async () => {
  const set = await same('setTaskDue', { task: ref('a'), date: '2099-05-05' }, world(rows()));
  assert.deepEqual(written(set, 'task:a'), { ...TAPE, due: '2099-05-05' });
  for (const input of [{ task: ref('a') }, { task: ref('a'), date: '' }]) {
    const r = await same('setTaskDue', input, world(rows()));
    assert.deepEqual(written(r, 'task:a'), { ...TAPE, due: null, remind: false });
    assert.equal(r.data.note, 'Its reminder is off, since it has no due date.');
  }
  await refuses('setTaskDue', { task: ref('a'), date: '2099-02-30' }, world(rows()), 'Say the due date as YYYY-MM-DD.');
});

await test('setTaskDone ticks it and opens it again', async () => {
  const done = await same('setTaskDone', { task: ref('a'), done: true }, world(rows()));
  assert.equal(written(done, 'task:a').done, true);
  assert.equal(typeof written(done, 'task:a').doneAt, 'number');
  const open = await same('setTaskDone', { task: ref('a'), done: false }, world({ 'task:a': { ...TAPE, done: true, doneAt: 5 } }));
  assert.deepEqual(written(open, 'task:a'), { ...TAPE, done: false, doneAt: null });
  await refuses('setTaskDone', { task: ref('a'), done: 'true' }, world(rows()), 'Say whether the task is done with true or false.');
});

await test('linkTask and unlinkTask: a link added, taken off with its rule, and the sentences', async () => {
  const linked = await same('linkTask', { task: ref('a'), target: PLACE }, world(rows()));
  assert.deepEqual(written(linked, 'task:a').links, [EVENT, PLACE]);
  const again = await same('linkTask', { task: ref('a'), target: EVENT }, world(rows()));
  assert.deepEqual([again.writes, again.data.note], [[], 'That is already so; nothing changed.']);
  await refuses('linkTask', { task: ref('a'), target: { module: 'calendar', kind: 'event', id: 'zz', scope: 'space', space: 's1' } }, world(rows()), 'this list may not link to that');
  const full = { ...TAPE, links: [1, 2, 3, 4, 5].map((i) => ({ module: 'calendar', kind: 'event', id: `x${i}`, scope: 'space', space: 's1' })) };
  await refuses('linkTask', { task: ref('a'), target: PLACE }, world({ 'task:a': full }), 'A task can link to 5 things.');
  const off = await same('unlinkTask', { task: ref('a'), target: EVENT }, world(rows()));
  assert.deepEqual(written(off, 'task:a'), { ...TAPE, links: [], rules: {} });
  await refuses('unlinkTask', { task: ref('a'), target: PLACE }, world(rows()), 'That task is not linked to that.');
});

await test('the reminder and the links are answered beside the write, so the server does them at once: nothing is marked', async () => {
  const DUE = '2026-12-01'; // within the year ahead of NOW (September 2026)
  const tokyo = (action, input, w) => onRunner('todo', action, input, w, { kinds: ['task'], now: NOW, carrier: 'server', tz: 'Asia/Tokyo' });
  const remindAt = Date.parse('2026-12-01T00:00:00Z'); // 9:00 on the due date in Tokyo
  const set = (id, title) => [{ op: 'set', key: `remind:${id}`, at: remindAt, about: ref(id), payload: { id }, notify: { title, body: 'Due today' } }];
  const due = { ...TAPE, due: DUE };
  const r = await tokyo('updateTask', { task: ref('a'), title: 'Buy more tape' }, world({ 'task:a': due }));
  assert.deepEqual([r.writes[0].value, r.data], [{ ...due, title: 'Buy more tape' }, undefined], 'no mark, nothing said');
  assert.deepEqual([r.effects.schedules, r.effects.links], [set('a', 'Buy more tape'), []], 'the reminder set again with the new title (the server took the old one off)');
  const done = await tokyo('setTaskDone', { task: ref('a'), done: true }, world({ 'task:a': due }));
  assert.deepEqual(done.effects.schedules, [{ op: 'cancel', key: 'remind:a' }], 'done: taken off');
  const off = await tokyo('setTaskDue', { task: ref('a') }, world({ 'task:a': due }));
  assert.deepEqual([off.effects.schedules, off.data.note], [[{ op: 'cancel', key: 'remind:a' }], 'Its reminder is off, since it has no due date.']);
  const passed = await tokyo('updateTask', { task: ref('a'), notes: 'x' }, world({ 'task:a': { ...TAPE, due: '2026-09-01' } }));
  assert.deepEqual(passed.effects.schedules, [{ op: 'cancel', key: 'remind:a' }], 'a reminder already passed is not set');
  const made = await tokyo('createTask', { title: 'Call', due: DUE, remind: true }, world());
  assert.deepEqual(made.effects.schedules, set('n1', 'Call'), 'a new task: set');
  const quiet = await tokyo('createTask', { title: 'Call', due: DUE }, world());
  assert.deepEqual(quiet.effects.schedules, [], 'a new task without a reminder: nothing to cancel');
  // The links: one add or remove each, from the task, to what it is linked to in this space.
  const unlink = await tokyo('unlinkTask', { task: ref('a'), target: EVENT }, world({ 'task:a': due }));
  assert.deepEqual(unlink.effects.links, [{ op: 'remove', from: ref('a'), to: EVENT }]);
  const link = await tokyo('linkTask', { task: ref('a'), target: PLACE }, world({ 'task:a': due }));
  assert.deepEqual(link.effects.links, [{ op: 'add', from: ref('a'), to: PLACE }]);
  const withRef = await tokyo('createTask', { title: 'Call', ref: EVENT }, world());
  assert.deepEqual(withRef.effects.links, [{ op: 'add', from: ref('n1'), to: EVENT }]);
  const elsewhere = { module: 'calendar', kind: 'event', id: 'e9', scope: 'environment' };
  const env = await tokyo('linkTask', { task: ref('a'), target: elsewhere }, { ...world({ 'task:a': due }), summaries: [...SUMMARIES, { ref: elsewhere, title: 'Holiday', kind: 'event' }] });
  assert.deepEqual([env.writes[0].value.links.length, env.effects.links], [2, []], 'outside this space: kept on the task, linked by a page (todo.js syncLinks)');
  // A page carries the same answer through its own host calls; no catch-up is left on it.
  const js = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'todo.js'), 'utf8');
  assert.ok(!/remindPending|linksPending|settleWaiting/.test(js), 'no catch-up on the page');
  assert.ok(js.includes('const at = todoRemindAt(t, undefined, Date.now());'), 'the form sets its reminder by the same rule');
});

if (process.exitCode) { console.error(`check-todo-actions: failed (${n} passed)`); process.exit(1); }
console.log(`check-todo-actions: OK (${n} checks)`);
