#!/usr/bin/env node
/*
 * check-todo-set-done.mjs -- the To-do module's setTaskDone action (an agent's "tick this task off, or open it again"): declared in the manifest the
 * way setTaskDue is, and carried out by the real page code (src/todo.js, run here against a recording stand-in host and a permissive stand-in page).
 * Covers: done true, done false, both stored as `done` and `doneAt` on task:<id> by the same code a person's tick uses, a missing task refused with a
 * plain sentence, a non-boolean refused, a person who may not edit refused, the reminder cancelled on done, and the manifest entry.
 * What this does NOT cover: a real request carried out by an open page in a browser (needs a person).
 * Usage: node modules/todo/test/check-todo-set-done.mjs. Exits 1 on any failure.
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

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

async function page({ canEdit = true } = {}) {
  const store = new Map();
  const writes = [];
  const cancelled = [];
  const scheduled = [];
  store.set('task:a', { value: { id: 'a', title: 'Buy tape', notes: '', due: '2099-01-01', remind: true, done: false, doneAt: null, createdAt: 1, by: 'x', links: [] }, version: 1 });
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
  assert.ok(provided && typeof provided.setTaskDone === 'function', 'the page provides setTaskDone');
  await new Promise((r) => setImmediate(r));
  return { provided, store, writes, cancelled, scheduled };
}
const ref = (id) => ({ module: 'todo', kind: 'task', id });

let passed = 0; const fails = [];
async function test(name, fn) { try { await fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.stack.split('\n').slice(0, 3).join(' | ')}`); } }
const refuses = async (p, re) => { await assert.rejects(p, (e) => { assert.match(e.message, re); assert.ok(/^[A-Za-z]/.test(e.message) && e.message.length < 80, 'a short plain sentence'); return true; }); };

await test('the manifest offers setTaskDone like its siblings', () => {
  const a = manifest.actions.provides.find((x) => x.name === 'setTaskDone');
  assert.ok(a, 'declared');
  assert.equal(a.effect, 'write');
  assert.ok(!a.local && !a.askerOnly && a.ai !== false, 'offered to agents');
  assert.deepEqual(a.input, { task: 'ref:todo:task', done: 'boolean' });
  assert.equal(a.description, 'Mark a to-do task done, or open it again.');
  const due = manifest.actions.provides.find((x) => x.name === 'setTaskDue');
  assert.equal(a.effect, due.effect);
  assert.equal(a.input.task, due.input.task);
  assert.equal(manifest.actions.provides.filter((x) => /edit|delete/i.test(x.name)).length, 0, 'no edit or delete action');
});
await test('done true stores done and doneAt on task:<id> and cancels the reminder', async () => {
  const p = await page();
  const answer = await p.provided.setTaskDone({ task: ref('a'), done: true });
  assert.equal(answer.ref.id, 'a');
  const w = p.writes.at(-1);
  assert.equal(w.key, 'task:a');
  assert.equal(w.value.done, true);
  assert.ok(typeof w.value.doneAt === 'number');
  assert.equal(w.value.title, 'Buy tape');
  assert.equal(w.opts.version, 1, 'saved against the version it read');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(p.cancelled, ['remind:a']);
});
await test('done false opens it again and sets the reminder', async () => {
  const p = await page();
  await p.provided.setTaskDone({ task: ref('a'), done: true });
  await p.provided.setTaskDone({ task: ref('a'), done: false });
  const w = p.writes.at(-1);
  assert.equal(w.value.done, false);
  assert.equal(w.value.doneAt, null);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(p.scheduled, ['remind:a']);
});
await test('a missing task is refused in a plain sentence, nothing written', async () => {
  const p = await page();
  await refuses(p.provided.setTaskDone({ task: ref('nope'), done: true }), /not here/);
  assert.equal(p.writes.length, 0);
});
await test('a non-boolean done is refused, nothing written', async () => {
  const p = await page();
  for (const bad of ['true', 1, null, undefined]) await refuses(p.provided.setTaskDone({ task: ref('a'), done: bad }), /true or false/);
  assert.equal(p.writes.length, 0);
});
await test('a person who may not change the list cannot have it done', async () => {
  const p = await page({ canEdit: false });
  await refuses(p.provided.setTaskDone({ task: ref('a'), done: true }), /not here/);
  assert.equal(p.writes.length, 0);
});

if (fails.length) { console.error(fails.join('\n')); console.error(`check-todo-set-done: ${fails.length} failed, ${passed} passed`); process.exit(1); }
console.log(`check-todo-set-done: OK (${passed} tests)`);
