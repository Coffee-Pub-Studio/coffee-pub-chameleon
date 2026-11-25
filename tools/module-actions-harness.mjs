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
// name }], summaries: [{ ref, title, subtitle, kind, copy?, twinOf?, module? }], currency?, settings?, rows: { key: value },
// shared?: { key: value } (the module's environment data), person?: { key: value } (the page person's own), geocode?: [{ title,
// sub, lat, lng, key }] (what the module's place search answers, as GET /api/modules/:id/geocode gives it; the runner's lookups
// are cut from the same list as the server cuts them) }.
// Outside the space (plan-agent-server-actions.md, sections 3 and 4) both ways read the module's own manifest: its kinds that
// carry space marks (refs.produces' summary.spaces) and each action's `lookups`; o.produces ([{ kind, key, marks? }]) and o.lookups stand in for a fixture's.
// The runner's checks of an environment write and its refusal of a write for the person are server/index.js's, made the same
// way here: { fault: 'shared' | 'unmarked' | 'marks' | 'place' } and { refused: <the 403 sentence>, status: 403 }.
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
const localeOf = (id) => {
  let manifest = null;
  try { manifest = id ? JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', id, 'module.json'), 'utf8')) : null; } catch { manifest = null; } // a fixture outside modules/
  return { clock: '12', labels: manifest ? effectiveLabels(manifest) : {} };
};
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
const manifestOf = (id) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', id, 'module.json'), 'utf8')); } catch { return {}; } };
// The library as the runner loads it (without the files only the page needs, actions.pageOnly), both ways.
export function library(id) {
  if (!libCache.has(id)) libCache.set(id, libraryOf(path.join(ROOT, 'modules', id), id, { leaveOut: manifestOf(id).actions?.pageOnly || [] }));
  return libCache.get(id);
}
// The module's kinds as the page adapter takes them (fromLibrary's o.kinds), and its actions' lookups (o.lookups).
export const kindsOf = (id) => ((manifestOf(id).refs || {}).produces || []).map((p) => ({ kind: p.kind, key: p.key, ...(p.summary && p.summary.spaces ? { marks: p.summary.spaces } : {}) }));
export const lookupsOf = (id) => Object.fromEntries(((manifestOf(id).actions || {}).provides || []).filter((a) => a.lookups).map((a) => [a.name, a.lookups]));
const kindAt = (kinds, key) => kinds.find((k) => { const at = k.key.indexOf('{id}'); const pre = k.key.slice(0, at); const suf = k.key.slice(at + 4); return key.startsWith(pre) && key.endsWith(suf) && /^[A-Za-z0-9_-]{1,64}$/.test(key.slice(pre.length, key.length - suf.length)); }) || null;
const PERSON_REFUSED = 'An agent has no places of its own; save it for this space or for everyone.';
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
  const stores = { space: store, environment: new Map(Object.entries(world.shared || {}).map(([k, v]) => [k, { value: v, version: 1 }])), person: new Map(Object.entries(world.person || {}).map(([k, v]) => [k, { value: v, version: 1 }])) };
  const storeOf = (o) => stores[o && (o.scope === 'environment' || o.scope === 'person') ? o.scope : 'space'];
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
    // The main phase's end moved to cover a day (host.phasesCover): written down, and nothing of the world's is moved.
    phasesCover: async (day) => { effect('phasesCover', { day }); return null; },
    objects: { setLinks: async (from, to, o) => { effect('setLinks', { from, to, ...(o || {}) }); return { links: to.length }; }, resolve: async (refs) => refs.map((r) => (world.summaries || []).find((s) => objectKey(s.ref) === objectKey(r)) || { error: 'gone' }) },
    user: world.user || { key: 'me', name: 'Me' },
    // The module's place search: the world's results for any text, as the route answers them.
    geocode: { search: async () => ({ results: JSON.parse(JSON.stringify(world.geocode || [])), configured: Boolean(world.geocode) }) },
    storage: {
      list: async (prefix, o) => [...storeOf(o)].filter(([k]) => k.startsWith(prefix || '')).map(([key, v]) => ({ key, value: JSON.parse(JSON.stringify(v.value)), version: v.version })),
      get: async (key, o) => { const v = storeOf(o).get(key); return v ? { key, value: JSON.parse(JSON.stringify(v.value)), version: v.version } : null; },
      set: async (key, value, o = {}) => {
        if (world.refuseWrite && world.refuseWrite(key, o.scope)) throw Object.assign(new Error('you may not change this'), { status: 403 });
        const at = storeOf(o);
        const cur = at.get(key);
        if (o.version !== undefined && (cur ? cur.version : 0) !== o.version) throw Object.assign(new Error('stale'), { status: 409 });
        const version = (cur ? cur.version : 0) + 1;
        at.set(key, { value: JSON.parse(JSON.stringify(value)), version });
        return { key, value, version };
      },
      delete: async (key, o) => { storeOf(o).delete(key); },
    },
  };
  return { host, store, stores, calls };
}

// An agent's request, as a page is handed it (`agent: true`); o.asker 'self' makes it the page person's own instead, and
// o.asker 'other': another person's (not the page person's own, not an agent's).
const carried = (credit, o = {}) => (o.asker === 'self' ? { from: 'chat', by: credit.name, byKey: credit.key, credit, mine: true }
  : o.asker === 'other' ? { from: 'chat', by: credit.name, byKey: credit.key, credit, mine: false }
    : { from: 'agent', by: credit.name, byKey: credit.key, credit, agent: true });

// Through the page adapter: { writes: [{ key, value }], ref, data, effects } or { refused }. `effects` is what the handler
// answered beside its writes ({ links, schedules, notify, phaseEnd? }, as the runner's outcomeOf gives them), and `o.calls`, when
// given (an array), is filled with the host calls the adapter made for them, in order ({ call: 'setLinks' | 'schedule' | 'cancelSchedule' |
// 'phasesCover' | 'notify', ...what it was given }).
export async function onPage(id, action, input, world, o = {}) {
  const credit = o.credit || { name: 'Claude (agent)', key: 'agent1' };
  const { host, stores, calls } = standInHost(world, id);
  const before = Object.fromEntries(Object.entries(stores).map(([s, m]) => [s, new Map([...m].map(([k, v]) => [k, v.version]))]));
  let effects = { links: [], schedules: [], notify: [] };
  const after = async (done) => { effects = done.effects; if (o.after) await o.after(done); };
  const handlers = sdk.hostActions.fromLibrary(host, o.handlers || handlersOf(id), { module: () => ({ id, name: o.name || id }), after, kinds: o.produces || kindsOf(id), lookups: o.lookups || lookupsOf(id) });
  if (!handlers[action]) return { fault: 'missing' };
  try {
    const out = await handlers[action](JSON.parse(JSON.stringify(input)), carried(credit, o));
    // Every write, in its place: a space write as { key, value }, one elsewhere with its scope.
    const writes = Object.entries(stores).flatMap(([s, m]) => [...m].filter(([k, v]) => before[s].get(k) !== v.version).map(([key, v]) => ({ key, value: v.value, ...(s !== 'space' ? { scope: s } : {}) })));
    if (Array.isArray(o.calls)) o.calls.push(...calls);
    return { writes, ref: out.ref || null, ...(out.data !== undefined ? { data: out.data } : {}), effects };
  } catch (err) {
    if (Array.isArray(o.calls)) o.calls.push(...calls);
    return { refused: err.message, ...(err.status ? { status: err.status } : {}) };
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
  const space = world.space && world.space.id;
  // The place search before the run, as server/index.js actionLookups cuts it: the declared inputs' text, at most 6 results.
  const looks = (o.lookups || lookupsOf(id))[action];
  // Every input the action's skipLookupWhen names given: no search, each list empty.
  const skip = (((manifestOf(id).actions || {}).provides || []).find((a) => a.name === action) || {}).skipLookupWhen;
  const skipped = Array.isArray(skip) && skip.every((f) => input[f] !== undefined && input[f] !== null && input[f] !== '');
  if (looks && skipped) ctx.lookups = Object.fromEntries(Object.keys(looks).map((f) => [f, []]));
  else if (looks) {
    const line = (v, max) => String(v ?? '').replace(/[\p{Cc}\p{Cf}]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
    ctx.lookups = Object.fromEntries(Object.keys(looks).map((f) => [f, typeof input[f] === 'string' && line(input[f], 200).length >= 2 ? (world.geocode || []).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng)).slice(0, 6).map((r) => ({ title: line(r.title, 200), sub: line(r.sub, 300), lat: r.lat, lng: r.lng, key: line(r.key, 128) })) : []]));
  }
  // The module's environment objects marked for this space, as the server hands them.
  const marked = (o.produces || kindsOf(id)).filter((k) => k.marks);
  const shared = Object.fromEntries(Object.entries(world.shared || {}).filter(([k, v]) => { const kind = kindAt(marked, k); return kind && v && Array.isArray(v[kind.marks]) && v[kind.marks].includes(space); }));
  const code = `${library(id).js}${POSTLUDE}`;
  const answer = await runner.run({ code, filename: `modules/${id}/src/${id}-lib-actions.js`, action, inputText: JSON.stringify(input), ctxText: JSON.stringify(ctx), dataText: JSON.stringify(world.rows || {}), sharedText: JSON.stringify(shared), localeText: JSON.stringify(localeOf(id)) });
  const kinds = o.kinds || null;
  // The main phase's end only for an action whose manifest says so (`phaseEnd: true`), as server/index.js holds it.
  const mayEnd = (manifestOf(id).actions?.provides || []).some((a) => a.name === action && a.phaseEnd === true);
  const out = outcomeOf(answer, {
    phaseEnd: mayEnd,
    own: (ref) => ref.module === id && ref.scope === 'space' && ref.space === space && (!kinds || kinds.includes(ref.kind)),
    shared: (ref) => { const k = ref.module === id && ref.scope === 'environment' && !ref.space ? marked.find((x) => x.kind === ref.kind) : null; return k ? k.key.replace('{id}', String(ref.id)) : null; },
  });
  if (out.denied === 'person') return { refused: PERSON_REFUSED, status: 403 };
  // The environment writes, held as server/index.js holds them before anything is written.
  for (const w of out.writes || []) {
    if (w.scope !== 'environment') continue;
    if (!marked.length) return { fault: 'place' };
    const kind = kindAt(marked, w.key);
    if (!kind) return { fault: 'shared' };
    const marksOf = (v) => (v && typeof v === 'object' && !Array.isArray(v) && Array.isArray(v[kind.marks]) ? v[kind.marks] : null);
    const marks = marksOf(w.value);
    if (!marks || marks.some((m) => typeof m !== 'string') || !marks.includes(space)) return { fault: 'unmarked' };
    const others = (list) => [...new Set((list || []).filter((m) => m !== space))].sort().join('\n');
    if (others(marks) !== others(Object.hasOwn(shared, w.key) ? marksOf(shared[w.key]) : [])) return { fault: 'marks' };
  }
  return out;
}

// Both ways, for a test to compare: { page, runner }.
export async function both(id, action, input, world, o = {}) {
  return { page: await onPage(id, action, input, world, o), runner: await onRunner(id, action, input, world, o) };
}
