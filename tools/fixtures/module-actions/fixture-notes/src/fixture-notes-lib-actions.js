// The fixture's server actions (server/module-actions.js): one handler for each action an agent may ask for, plus the
// probes tools/check-module-actions.mjs uses to try the runner's limits. Nothing here is a real module's rule.
const fixtureId = (now) => `n${now.toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
const fixtureNoteOf = (ctx, ref) => {
  const note = ref && ctx.read(`note:${ref.id}`);
  if (!note) throw new Error('That note is not there.');
  return note;
};
const fixtureTry = (f) => {
  try {
    const v = f();
    return v === undefined ? 'undefined' : typeof v === 'string' ? v : typeof v;
  } catch (e) {
    return 'blocked';
  }
};

const ACTION_HANDLERS = {
  addNote(input, ctx) {
    const id = fixtureId(ctx.now);
    const value = { title: fixtureTitle(input.title), byKey: ctx.credit.key, by: ctx.credit.name, at: ctx.now, ...(input.body ? { body: input.body } : {}), ...(input.linkTo ? { linkTo: input.linkTo } : {}) };
    return { writes: [{ key: `note:${id}`, value }], ref: { module: 'fixture-notes', kind: 'note', id, scope: 'space', space: ctx.space.id }, data: { note: 'Added.' } };
  },
  renameNote(input, ctx) {
    const note = fixtureNoteOf(ctx, input.note);
    return { writes: [{ key: `note:${input.note.id}`, value: { ...note, title: fixtureTitle(input.title) } }], ref: input.note };
  },
  slowRename(input, ctx) {
    const until = Date.now() + (typeof input.ms === 'number' ? input.ms : 700);
    while (Date.now() < until) { /* wait */ }
    const note = fixtureNoteOf(ctx, input.note);
    return { writes: [{ key: `note:${input.note.id}`, value: { ...note, title: fixtureTitle(input.title) } }], ref: input.note };
  },
  probe(input, ctx) {
    const what = input.what;
    const here = ctx.space.id;
    if (what === 'escape') {
      const seen = {
        require: typeof require, process: typeof process, module: typeof module, exports: typeof exports, Buffer: typeof Buffer,
        fetch: typeof fetch, XMLHttpRequest: typeof XMLHttpRequest, WebSocket: typeof WebSocket, setTimeout: typeof setTimeout,
        setInterval: typeof setInterval, setImmediate: typeof setImmediate, queueMicrotask: typeof queueMicrotask,
        console: typeof console, WebAssembly: typeof WebAssembly, Atomics: typeof Atomics, SharedArrayBuffer: typeof SharedArrayBuffer,
        globalCtor: fixtureTry(() => globalThis.constructor.constructor('return typeof process')()),
        functionCtor: fixtureTry(() => (function () {}).constructor('return typeof process')()),
        asyncCtor: fixtureTry(() => (async function () {}).constructor('return typeof process')),
        Function: fixtureTry(() => Function('return typeof process')()),
        eval: fixtureTry(() => (0, eval)('typeof process')),
        readCtor: fixtureTry(() => ctx.read.constructor('return typeof process')()),
        stackFrames: fixtureTry(() => {
          Error.prepareStackTrace = (e, frames) => frames.map((f) => { const fn = f.getFunction && f.getFunction(); return fn ? typeof fn.constructor('return typeof process')() : 'none'; }).join(',');
          return new Error('x').stack;
        }),
      };
      return import('node:fs').then(() => 'loaded', () => 'blocked').then((dynamicImport) => ({ writes: [{ key: 'probe:escape', value: { ...seen, dynamicImport } }] }));
    }
    if (what === 'pollute') {
      const before = ({}).polluted;
      Object.prototype.polluted = 'yes';
      Array.prototype.polluted = 'yes';
      return { writes: [{ key: 'probe:pollute', value: { before: before === undefined ? null : before } }] };
    }
    if (what === 'loop') { for (;;) { /* forever */ } }
    if (what === 'hog') { const all = []; for (;;) all.push(new Array(1e6).fill(1)); }
    if (what === 'microloop') return (async () => { for (;;) await 0; })();
    if (what === 'throw') throw new Error('The fixture says no.');
    if (what === 'throwProxy') throw new Proxy({}, { get() { for (;;) { /* forever */ } } });
    if (what === 'notJson') return { writes: [{ key: 'probe:x', value: 10n }] };
    if (what === 'big') return { writes: [{ key: 'probe:big', value: 'x'.repeat(1100000) }] };
    if (what === 'tooMany') return { writes: Array.from({ length: 11 }, (_, i) => ({ key: `probe:many${i}`, value: i })) };
    if (what === 'elsewhere') return { writes: [{ key: 'probe:x', value: 1, module: 'todo' }] };
    if (what === 'elsewhereSpace') return { writes: [{ key: 'probe:x', value: 1, scope: 'space', space: input.person }] };
    if (what === 'badRef') return { ref: { module: 'todo', kind: 'task', id: 'x', scope: 'space', space: here } };
    if (what === 'otherSpaceRef') return { ref: { module: 'fixture-notes', kind: 'note', id: 'x', scope: 'space', space: input.person } };
    if (what === 'delete') return { writes: [{ key: 'probe:x', delete: true }] };
    if (what === 'extraField') return { writes: [], other: 1 };
    if (what === 'asOther') return { writes: [{ key: 'note:asother', value: { title: 'Not mine', byKey: input.person, by: 'Someone' } }] };
    if (what === 'unknownKey') return { writes: [{ key: 'zzz:1', value: {} }] };
    if (what === 'partial') return { writes: [{ key: 'probe:partial', value: { ok: 1 } }, { key: 'zzz:2', value: {} }] };
    if (what === 'read') return { writes: [{ key: 'probe:read', value: { task: ctx.read('task:t1'), fort: ctx.read('note:fortsecret'), keys: ctx.list('').map((x) => x.key), by: ctx.by, byKey: ctx.byKey, credit: ctx.credit } }] };
    if (what === 'nothing') return undefined;
    throw new Error(`No probe called ${what}.`);
  },
  hidden(input) {
    return { writes: [{ key: 'probe:hidden', value: { title: input.title } }] };
  },
  wipe() {
    return { writes: [{ key: 'probe:wiped', value: true }] };
  },
};
