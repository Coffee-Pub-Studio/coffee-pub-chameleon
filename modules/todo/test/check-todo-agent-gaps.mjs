#!/usr/bin/env node
/*
 * check-todo-agent-gaps.mjs -- the To-do module's createTask `remind` input and its updateTask action, carried out by the real page code
 * (src/todo.js, run against a recording stand-in host). Covers: createTask with and without remind (remind with no due refused), updateTask for
 * title, notes and remind, nothing-to-change refused, a missing task, a too-long title or notes, a person who may not edit, and the manifest entries.
 * What this does NOT cover: a real request carried out by an open page in a browser (needs a person).
 * Usage: node modules/todo/test/check-todo-agent-gaps.mjs. Exits 1 on any failure.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// Due dates within the year ahead the host schedules (server/module-hooks.js), so a reminder is set.
const dayAhead = (n) => new Date(Date.now() + n * 24 * 3600000).toISOString().slice(0, 10);
const SOON = dayAhead(60);
const SOON2 = dayAhead(61);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dir = path.join(root, 'modules/todo');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'module.json'), 'utf8'));
const code = fs.readFileSync(path.join(dir, 'src/todo.js'), 'utf8').replace('/*__LIB__*/', () => ['todo-lib.js', 'todo-lib-actions.js'].map((f) => fs.readFileSync(path.join(dir, 'src', f), 'utf8')).join('\n'));
// The page's library runs in this check's vm, the adapter here: its answers are copied across, as plain objects of this realm.
const crossRealm = (handlers) => Object.fromEntries(Object.entries(handlers).map(([k, fn]) => [k, (input, ctx) => JSON.parse(JSON.stringify(fn(input, ctx)))]));
// The SDK's page adapter for an actions library (host.actions.fromLibrary), which the page runs its actions through.
const sdk = (() => {
  const win = { addEventListener() {}, removeEventListener() {}, location: { search: '', href: 'http://localhost/' } };
  win.parent = win;
  new Function('window', 'document', fs.readFileSync(path.join(root, 'public/sdk/host.js'), 'utf8'))(win, { createElement: (tag) => ({ tag }), currentScript: null });
  return win.hostActions;
})();

// A stand-in that answers anything: a function that returns itself, reads as '' and is a thenable-free object.
const loose = () => new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : k === 'length' ? 0 : k === Symbol.iterator ? function* () {} : loose()),
  apply: () => loose(),
  construct: () => loose(),
  set: () => true,
});

async function page({ canEdit = true, due = SOON } = {}) {
  const store = new Map();
  const writes = [];
  const cancelled = [];
  const scheduled = [];
  store.set('task:a', { value: { id: 'a', title: 'Buy tape', notes: '', due, remind: true, done: false, doneAt: null, createdAt: 1, by: 'x', links: [] }, version: 1 });
  let provided = null;
  const own = {
    root: { getElementById: () => loose() },
    util: { esc: (v) => String(v), ymd: (d) => d.toISOString().slice(0, 10), parseYmd: (s) => new Date(`${s}T00:00:00`), id: () => 'new', word: () => 'word', label: () => '', objectKey: (r) => `${r.module}:${r.kind}:${r.id}`, hour: () => '', parseWhen: () => ({}) },
    ready: async () => ({ context: { scope: 'environment', environment: { name: 'Env' } } }),
    can: () => canEdit,
    spaces: async () => [],
    locale: () => ({ words: {} }),
    objects: { make: (kind, id) => ({ module: 'todo', kind, id }), kinds: async () => [], setLinks: async () => {}, onOpen: () => {}, resolve: async () => ({}) },
    actions: { list: async () => [], provide: (h) => { provided = h; }, request: async () => ({}), fromLibrary: (handlers, o) => sdk.fromLibrary(host, crossRealm(handlers), { ...(o || {}), module: () => ({ id: 'todo', name: 'To-do' }) }) },
    space: () => null,
    phases: () => [],
    people: async () => [],
    events: { subscribe: () => {} },
    on: () => {},
    storage: {
      list: async (prefix, o) => (o && o.scope === 'spaces' ? [] : [...store].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, value: JSON.parse(JSON.stringify(v.value)), version: v.version }))),
      set: async (key, value, o) => { const v = (store.get(key)?.version || 0) + 1; store.set(key, { value, version: v }); writes.push({ key, value: JSON.parse(JSON.stringify(value)), opts: o }); return { version: v }; },
    },
    cancelSchedule: async (key) => { cancelled.push(key); },
    schedule: async (s) => { scheduled.push(s.key); },
  };
  const host = new Proxy(own, { get: (t, k) => (k in t ? t[k] : loose()) });
  const sandbox = { host, document: { currentScript: { host }, createElement: () => loose() }, window: {}, location: {}, setInterval: () => 0, MutationObserver: class { observe() {} }, ResizeObserver: class { observe() {} }, requestAnimationFrame: () => 0, matchMedia: () => ({ matches: false, addEventListener() {} }), clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, console, Date, JSON, Math, Map, Set, Promise, Object, Array, String, Number, Error, RegExp, Intl, URL };
  sandbox.window = sandbox;
  let died = null;
  Promise.resolve(vm.runInNewContext(code, sandbox, { filename: 'todo.js' })).catch((e) => { died = e; });
  for (let i = 0; i < 50 && !provided && !died; i++) await new Promise((r) => setImmediate(r));
  if (died) throw died;
  assert.ok(provided && typeof provided.updateTask === 'function', 'the page provides updateTask');
  await new Promise((r) => setImmediate(r));
  return { provided, store, writes, cancelled, scheduled };
}
const ref = (id) => ({ module: 'todo', kind: 'task', id });

let passed = 0; const fails = [];
async function test(name, fn) { try { await fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.stack.split('\n').slice(0, 3).join(' | ')}`); } }
const refuses = async (p, re) => { await assert.rejects(p, (e) => { assert.match(e.message, re); assert.ok(/^[A-Za-z]/.test(e.message) && e.message.length < 80, 'a short plain sentence'); return true; }); };
const tick = () => new Promise((r) => setImmediate(r));

await test('the manifest declares updateTask and createTask remind', () => {
  const a = manifest.actions.provides.find((x) => x.name === 'updateTask');
  assert.ok(a, 'declared');
  assert.equal(a.effect, 'write');
  assert.ok(!a.local && !a.askerOnly && a.ai !== false, 'offered to agents');
  assert.deepEqual(a.input, { task: 'ref:todo:task', title: 'string?', notes: 'text?', remind: 'boolean?' });
  assert.equal(a.description, "Change a to-do task's title, notes or reminder.");
  assert.equal(manifest.actions.provides.find((x) => x.name === 'createTask').input.remind, 'boolean?');
  assert.equal(manifest.actions.provides.find((x) => x.name === 'setTaskDue').input.date, 'date?', 'setTaskDue: the date may be left out to clear it');
  assert.ok(!manifest.actions.provides.some((x) => /delete/i.test(x.name) && x.effect !== 'delete'), 'no direct delete action (the delete action only asks)');
});
await test('createTask without remind saves remind false, no reminder', async () => {
  const p = await page();
  await p.provided.createTask({ title: ' Call ', due: SOON2 });
  await tick();
  const w = p.writes.at(-1);
  assert.equal(w.value.remind, false);
  assert.equal(w.value.title, 'Call');
  assert.deepEqual(p.scheduled, []);
});
await test('createTask with remind true and a due date saves it and sets the reminder', async () => {
  const p = await page();
  await p.provided.createTask({ title: 'Call', due: SOON2, remind: true });
  await tick();
  assert.equal(p.writes.at(-1).value.remind, true);
  assert.equal(p.scheduled.length, 1);
  assert.match(p.scheduled[0], /^remind:/);
});
await test('createTask with remind true and no due date is refused, nothing written', async () => {
  const p = await page();
  await refuses(p.provided.createTask({ title: 'Call', remind: true }), /needs a due date/);
  assert.equal(p.writes.length, 0);
});
await test('createTask with remind false is the same as without', async () => {
  const p = await page();
  await p.provided.createTask({ title: 'Call', remind: false });
  assert.equal(p.writes.at(-1).value.remind, false);
});
await test('updateTask changes the title, trimmed, and keeps the rest', async () => {
  const p = await page();
  const answer = await p.provided.updateTask({ task: ref('a'), title: '  Buy gaffer tape  ' });
  assert.equal(answer.ref.id, 'a');
  const w = p.writes.at(-1);
  assert.equal(w.key, 'task:a');
  assert.equal(w.value.title, 'Buy gaffer tape');
  assert.equal(w.value.due, SOON);
  assert.equal(w.value.remind, true);
  assert.equal(w.opts.version, 1);
  await tick();
  assert.deepEqual(p.scheduled, ['remind:a'], 'the reminder follows the new title');
});
await test('updateTask changes the notes, and empty notes clear them', async () => {
  const p = await page();
  await p.provided.updateTask({ task: ref('a'), notes: ' two rolls ' });
  assert.equal(p.writes.at(-1).value.notes, 'two rolls');
  await p.provided.updateTask({ task: ref('a'), notes: '' });
  assert.equal(p.writes.at(-1).value.notes, '');
});
await test('updateTask remind false cancels the reminder, true sets it again', async () => {
  const p = await page();
  await p.provided.updateTask({ task: ref('a'), remind: false });
  assert.equal(p.writes.at(-1).value.remind, false);
  await tick();
  assert.deepEqual(p.cancelled, ['remind:a']);
  await p.provided.updateTask({ task: ref('a'), remind: true });
  assert.equal(p.writes.at(-1).value.remind, true);
  await tick();
  assert.deepEqual(p.scheduled, ['remind:a']);
});
await test('updateTask remind true on a task with no due date is refused', async () => {
  const p = await page({ due: null });
  await refuses(p.provided.updateTask({ task: ref('a'), remind: true }), /needs a due date/);
  assert.equal(p.writes.length, 0);
});
await test('updateTask with nothing to change is refused', async () => {
  const p = await page();
  await refuses(p.provided.updateTask({ task: ref('a') }), /Say what to change/);
  assert.equal(p.writes.length, 0);
});
await test('updateTask refuses a missing task, a blank or too-long title, too-long notes, a non-boolean remind', async () => {
  const p = await page();
  await refuses(p.provided.updateTask({ task: ref('nope'), title: 'x' }), /not here/);
  await refuses(p.provided.updateTask({ task: ref('a'), title: '   ' }), /needs a name/);
  await refuses(p.provided.updateTask({ task: ref('a'), title: 'x'.repeat(201) }), /200/);
  await refuses(p.provided.updateTask({ task: ref('a'), notes: 'x'.repeat(1001) }), /1000/);
  await refuses(p.provided.updateTask({ task: ref('a'), remind: 'yes' }), /true or false/);
  assert.equal(p.writes.length, 0);
  await p.provided.updateTask({ task: ref('a'), title: 'x'.repeat(200) });
  assert.equal(p.writes.length, 1, '200 letters is allowed');
});
await test('a person who may not change the list cannot update a task', async () => {
  const p = await page({ canEdit: false });
  await refuses(p.provided.updateTask({ task: ref('a'), title: 'x' }), /not here/);
  assert.equal(p.writes.length, 0);
});

if (fails.length) { console.error(fails.join('\n')); console.error(`check-todo-agent-gaps: ${fails.length} failed, ${passed} passed`); process.exit(1); }
console.log(`check-todo-agent-gaps: OK (${passed} tests)`);
