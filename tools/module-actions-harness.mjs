// module-actions-harness.mjs: run a bundled module's actions library (src/<id>-lib-actions.js, `const ACTION_HANDLERS`) the two
// ways it is carried out (plan-agent-edit-delete.md, decision 4), so a module's own test can show both give the same answer:
//   - onRunner: through the server's runner (server/module-actions.js run, its worker process and vm, its limits, then its
//     outcomeOf check), with the library as libraryOf builds it;
//   - onPage: through the SDK's page adapter (host.actions.fromLibrary in public/sdk/host.js) on a stand-in host, the writes
//     applied with versions as host.storage.set applies them.
// The facts beside the data (space, people, refs) are what the SDK's adapter reads from a host (hostActions.facts), handed to
// the runner as part of its ctx; `ctx.util` is the SDK's own helpers (plain, localWhen, detailLines from host.js; ymd,
// parseYmd, objectKey, id, word and time as the SDK's are), evaluated in the vm before the library. The server's runner does
// not hand a library these yet (see the step 2a report): this harness is the reference for what it needs to.
// A world is { space: { id, name, budget?, phases?, createdAt? }, phases: [{ id, main? }], bands: [...], people: [{ key,
// name }], summaries: [{ ref, title, subtitle, kind, copy?, twinOf?, module? }], currency?, rows: { key: value } }.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { libraryOf } = require('../server/module-build.js');
const { createModuleActions, outcomeOf } = require('../server/module-actions.js');

const HOST_JS = fs.readFileSync(path.join(ROOT, 'public/sdk/host.js'), 'utf8');
// The SDK in a stand-in window: its hostText (plain, localWhen, detailLines, clockText) and hostActions (the page adapter).
const STUB = "const window = { addEventListener() {}, removeEventListener() {}, location: { search: '', href: 'http://localhost/' } }; window.parent = window; const document = { createElement: (tag) => ({ tag }), currentScript: null };";
// The helpers a handler gets as ctx.util, the same source in Node and in the vm. `id` counts from 1 for each run, so the two
// ways make the same ids.
const UTIL_SRC = `
const ymd = (d) => \`\${d.getFullYear()}-\${String(d.getMonth() + 1).padStart(2, '0')}-\${String(d.getDate()).padStart(2, '0')}\`;
const parseYmd = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
let __actionIds = 0;
const __WORDS = { space: ['space', 'spaces'], object: ['object', 'objects'], module: ['module', 'modules'] };
const __util = Object.freeze({
  plain: window.hostText.plain, localWhen: window.hostText.localWhen, detailLines: window.hostText.detailLines,
  time: (hhmm) => window.hostText.clockText(hhmm, '12') || hhmm || '',
  ymd, parseYmd,
  objectKey: (r) => [r.module, r.kind, r.id, r.scope, r.space || ''].join('|'),
  id: () => 'n' + (++__actionIds),
  word: (key, o) => { const w = __WORDS[key] || [key, key + 's']; const t = o && o.a ? (/^[aeiou]/i.test(w[0]) ? 'an ' : 'a ') + w[0] : o && o.many ? w[1] : w[0]; return o && o.cap ? t.charAt(0).toUpperCase() + t.slice(1) : t; },
});
`;
// After the library: each handler is given ctx.util (the runner's ctx is plain JSON plus read and list).
const POSTLUDE = '\n;for (const __k of Object.keys(ACTION_HANDLERS)) { const __f = ACTION_HANDLERS[__k]; ACTION_HANDLERS[__k] = (input, ctx) => __f(input, Object.assign(ctx, { util: __util })); }\n';

// The SDK in this process, once: hostText and hostActions, and the util a stand-in page host gives (a fresh id count each run).
const sdk = (() => {
  const win = { addEventListener() {}, removeEventListener() {}, location: { search: '', href: 'http://localhost/' } };
  win.parent = win;
  new Function('window', 'document', HOST_JS)(win, { createElement: (tag) => ({ tag }), currentScript: null });
  return win;
})();
const freshUtil = () => new Function('window', `${UTIL_SRC}\nreturn __util;`)(sdk);
const libCache = new Map();
export function library(id) {
  if (!libCache.has(id)) libCache.set(id, libraryOf(path.join(ROOT, 'modules', id), id));
  return libCache.get(id);
}
// The library's handlers in this process (as a page has them), with ymd and parseYmd beside them as the page's are.
export function handlersOf(id) {
  const u = freshUtil();
  return new Function('ymd', 'parseYmd', `${library(id).js}\nreturn ACTION_HANDLERS;`)(u.ymd, u.parseYmd);
}

const objectKey = (r) => [r.module, r.kind, r.id, r.scope, r.space || ''].join('|');
// A stand-in page host over a world: storage with versions (as the server: a version given must be the one stored, 0 when
// none), the space, its phases and timeline, its people, pointer summaries and the util.
export function standInHost(world) {
  const store = new Map(Object.entries(world.rows || {}).map(([k, v]) => [k, { value: v, version: 1 }]));
  const util = { ...freshUtil(), phaseTimeline: () => world.bands || [] };
  const host = {
    util,
    space: () => world.space || null,
    phases: () => world.phases || [],
    people: async () => world.people || [],
    locale: () => ({ currency: world.currency || '' }),
    objects: { resolve: async (refs) => refs.map((r) => (world.summaries || []).find((s) => objectKey(s.ref) === objectKey(r)) || { error: 'gone' }) },
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
  return { host, store };
}

const carried = (credit) => ({ from: 'agent', by: credit.name, byKey: credit.key, credit });

// Through the page adapter: { writes: [{ key, value }], ref, data } or { refused }.
export async function onPage(id, action, input, world, o = {}) {
  const credit = o.credit || { name: 'Claude (agent)', key: 'agent1' };
  const { host, store } = standInHost(world);
  const before = new Map([...store].map(([k, v]) => [k, v.version]));
  const handlers = sdk.hostActions.fromLibrary(host, o.handlers || handlersOf(id), { module: () => ({ id, name: o.name || id }), ...(o.after ? { after: o.after } : {}) });
  if (!handlers[action]) return { fault: 'missing' };
  try {
    const out = await handlers[action](JSON.parse(JSON.stringify(input)), carried(credit));
    const writes = [...store].filter(([k, v]) => before.get(k) !== v.version).map(([key, v]) => ({ key, value: v.value }));
    return { writes, ref: out.ref || null, ...(out.data !== undefined ? { data: out.data } : {}) };
  } catch (err) {
    return { refused: err.message };
  }
}

// Through the server's runner: the same world's data and facts, the same credit. { writes, ref, data } | { refused } | { fault }.
const runner = createModuleActions({ bundledDir: path.join(ROOT, 'modules') });
export async function onRunner(id, action, input, world, o = {}) {
  const credit = o.credit || { name: 'Claude (agent)', key: 'agent1' };
  const { host } = standInHost(world);
  const facts = await sdk.hostActions.facts(host, input);
  const ctx = { from: 'agent', by: credit.name, byKey: credit.key, credit, now: o.now || Date.now(), tz: o.tz || process.env.TZ || 'UTC', ...facts, action };
  const code = `${STUB}\n${HOST_JS}\n${UTIL_SRC}\n${library(id).js}${POSTLUDE}`;
  const answer = await runner.run({ code, filename: `modules/${id}/src/${id}-lib-actions.js`, action, inputText: JSON.stringify(input), ctxText: JSON.stringify(ctx), dataText: JSON.stringify(world.rows || {}) });
  const space = world.space && world.space.id;
  const kinds = o.kinds || null;
  return outcomeOf(answer, { own: (ref) => ref.module === id && ref.scope === 'space' && ref.space === space && (!kinds || kinds.includes(ref.kind)) });
}

// Both ways, for a test to compare: { page, runner }.
export async function both(id, action, input, world, o = {}) {
  return { page: await onPage(id, action, input, world, o), runner: await onRunner(id, action, input, world, o) };
}
