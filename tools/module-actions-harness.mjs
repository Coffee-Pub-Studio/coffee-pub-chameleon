// module-actions-harness.mjs: run a bundled module's actions library (src/<id>-lib-actions.js, `const ACTION_HANDLERS`) the two
// ways it is carried out (plan-agent-edit-delete.md, decision 4), so a module's own test can show both give the same answer:
//   - onRunner: through the server's runner (server/module-actions.js run, its worker process and vm, its limits, then its
//     outcomeOf check), with the library as libraryOf builds it;
//   - onPage: through the SDK's page adapter (host.actions.fromLibrary in public/sdk/host.js) on a stand-in host, the writes
//     applied with versions as host.storage.set applies them.
// The facts beside the data (space, people, refs) are what the SDK's adapter reads from a host (hostActions.facts), handed to
// the runner as part of its ctx. `ctx.util` is the SDK's own helpers on both ways: on the page the stand-in host's util is
// hostActions.util (public/sdk/host.js), and the runner's worker loads host.js itself and hands the library the same (server/
// module-actions-worker.js). Only `id` is made the same both ways here (n1, n2, ... for each run), so the two give the same ids.
// The module's settings (ctx.settings) are the world's `settings` both ways ({} when none), and ctx.util.label reads the module's
// own labels as its manifest names them (server/module-labels.js effectiveLabels with no template), as the server hands them.
// A world is { space: { id, name, budget?, phases?, createdAt? }, phases: [{ id, label?, main? }], bands: [...], people: [{ key,
// name }], summaries: [{ ref, title, subtitle, kind, copy?, twinOf?, module? }], currency?, settings?, rows: { key: value } }.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { libraryOf } = require('../server/module-build.js');
const { createModuleActions, outcomeOf } = require('../server/module-actions.js');
const { effectiveLabels } = require('../server/module-labels.js');

const HOST_JS = fs.readFileSync(path.join(ROOT, 'public/sdk/host.js'), 'utf8');
// The locale both ways: a 12-hour clock, the default words and the module's own labels.
const localeOf = (id) => ({ clock: '12', labels: id ? effectiveLabels(JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', id, 'module.json'), 'utf8'))) : {} });
// After the library, in the runner's vm: each handler's ctx.util is the worker's (the SDK's), with `id` counting from 1 for the run.
const POSTLUDE = '\n;let __actionIds = 0; for (const __k of Object.keys(ACTION_HANDLERS)) { const __f = ACTION_HANDLERS[__k]; ACTION_HANDLERS[__k] = (input, ctx) => __f(input, Object.assign(ctx, { util: Object.freeze(Object.assign({}, ctx.util, { id: () => \'n\' + (++__actionIds) })) })); }\n';

// The SDK in this process, once: hostText and hostActions, and the util a stand-in page host gives (a fresh id count each run).
const sdk = (() => {
  const win = { addEventListener() {}, removeEventListener() {}, location: { search: '', href: 'http://localhost/' } };
  win.parent = win;
  new Function('window', 'document', HOST_JS)(win, { createElement: (tag) => ({ tag }), currentScript: null });
  return win;
})();
const freshUtil = (id) => { let ids = 0; return { ...sdk.hostActions.util(localeOf(id)), id: () => `n${++ids}` }; };
const libCache = new Map();
export function library(id) {
  if (!libCache.has(id)) libCache.set(id, libraryOf(path.join(ROOT, 'modules', id), id));
  return libCache.get(id);
}
// The library's handlers in this process (as a page has them), with ymd and parseYmd beside them as the page's are.
export function handlersOf(id) {
  const u = freshUtil(id);
  return new Function('ymd', 'parseYmd', `${library(id).js}\nreturn ACTION_HANDLERS;`)(u.ymd, u.parseYmd);
}

const objectKey = (r) => [r.module, r.kind, r.id, r.scope, r.space || ''].join('|');
// A stand-in page host over a world: storage with versions (as the server: a version given must be the one stored, 0 when
// none), the space, its phases and timeline, its people, pointer summaries and the util.
export function standInHost(world, id) {
  const store = new Map(Object.entries(world.rows || {}).map(([k, v]) => [k, { value: v, version: 1 }]));
  const util = { ...freshUtil(id), phaseTimeline: () => world.bands || [] };
  const calls = [];
  const effect = (kind, spec) => {
    if (world.refuseEffect && world.refuseEffect(kind, spec)) throw Object.assign(new Error('you may not do this'), { status: 403 });
    calls.push({ call: kind, ...JSON.parse(JSON.stringify(spec)) });
  };
  const host = {
    util,
    space: () => world.space || null,
    phases: () => world.phases || [],
    people: async () => world.people || [],
    locale: () => ({ currency: world.currency || '' }),
    settings: { get: async () => JSON.parse(JSON.stringify(world.settings || {})) },
    // What the adapter does beside the writes, written down as it was called (world.refuseEffect(kind, spec) refuses one).
    schedule: async (spec) => { effect('schedule', spec); return { key: spec.key }; },
    cancelSchedule: async (key) => { effect('cancelSchedule', { key }); return { key, cancelled: true }; },
    notify: async (spec) => { effect('notify', spec); return { delivered: 1 }; },
    objects: { setLinks: async (from, to, o) => { effect('setLinks', { from, to, ...(o || {}) }); return { links: to.length }; }, resolve: async (refs) => refs.map((r) => (world.summaries || []).find((s) => objectKey(s.ref) === objectKey(r)) || { error: 'gone' }) },
    storage: {
      list: async (prefix) => [...store].filter(([k]) => k.startsWith(prefix || '')).map(([key, v]) => ({ key, value: JSON.parse(JSON.stringify(v.value)), version: v.version })),
      set: async (key, value, o = {}) => {
        if (world.refuseWrite && world.refuseWrite(key)) throw Object.assign(new Error('you may not change this'), { status: 403 });
        const cur = store.get(key);
        if (o.version !== undefined && (cur ? cur.version : 0) !== o.version) throw Object.assign(new Error('stale'), { status: 409 });
        const version = (cur ? cur.version : 0) + 1;
        store.set(key, { value: JSON.parse(JSON.stringify(value)), version });
        return { key, value, version };
      },
      delete: async (key) => { store.delete(key); },
    },
  };
  return { host, store, calls };
}

const carried = (credit) => ({ from: 'agent', by: credit.name, byKey: credit.key, credit });

// Through the page adapter: { writes: [{ key, value }], ref, data, effects } or { refused }. `effects` is what the handler
// answered beside its writes ({ links, schedules, notify }, as the runner's outcomeOf gives them), and `o.calls`, when
// given (an array), is filled with the host calls the adapter made for them, in order ({ call: 'setLinks' | 'schedule' | 'cancelSchedule' |
// 'notify', ...what it was given }).
export async function onPage(id, action, input, world, o = {}) {
  const credit = o.credit || { name: 'Claude (agent)', key: 'agent1' };
  const { host, store, calls } = standInHost(world, id);
  const before = new Map([...store].map(([k, v]) => [k, v.version]));
  let effects = { links: [], schedules: [], notify: [] };
  const after = async (done) => { effects = done.effects; if (o.after) await o.after(done); };
  const handlers = sdk.hostActions.fromLibrary(host, o.handlers || handlersOf(id), { module: () => ({ id, name: o.name || id }), after });
  if (!handlers[action]) return { fault: 'missing' };
  try {
    const out = await handlers[action](JSON.parse(JSON.stringify(input)), carried(credit));
    const writes = [...store].filter(([k, v]) => before.get(k) !== v.version).map(([key, v]) => ({ key, value: v.value }));
    if (Array.isArray(o.calls)) o.calls.push(...calls);
    return { writes, ref: out.ref || null, ...(out.data !== undefined ? { data: out.data } : {}), effects };
  } catch (err) {
    if (Array.isArray(o.calls)) o.calls.push(...calls);
    return { refused: err.message };
  }
}

// Through the server's runner: the same world's data and facts, the same credit. { writes, ref, data } | { refused } | { fault }.
const runner = createModuleActions({ bundledDir: path.join(ROOT, 'modules') });
export async function onRunner(id, action, input, world, o = {}) {
  const credit = o.credit || { name: 'Claude (agent)', key: 'agent1' };
  const { host } = standInHost(world, id);
  const facts = await sdk.hostActions.facts(host, input);
  // `o.carrier` 'server': as the server's own ctx says (nothing only a page does is done; a handler says so in its note).
  const ctx = { from: 'agent', by: credit.name, byKey: credit.key, credit, now: o.now || Date.now(), tz: o.tz || process.env.TZ || 'UTC', ...(o.carrier ? { carrier: o.carrier } : {}), ...facts, settings: JSON.parse(JSON.stringify(world.settings || {})), action };
  const code = `${library(id).js}${POSTLUDE}`;
  const answer = await runner.run({ code, filename: `modules/${id}/src/${id}-lib-actions.js`, action, inputText: JSON.stringify(input), ctxText: JSON.stringify(ctx), dataText: JSON.stringify(world.rows || {}), localeText: JSON.stringify(localeOf(id)) });
  const space = world.space && world.space.id;
  const kinds = o.kinds || null;
  return outcomeOf(answer, { own: (ref) => ref.module === id && ref.scope === 'space' && ref.space === space && (!kinds || kinds.includes(ref.kind)) });
}

// Both ways, for a test to compare: { page, runner }.
export async function both(id, action, input, world, o = {}) {
  return { page: await onPage(id, action, input, world, o), runner: await onRunner(id, action, input, world, o) };
}
