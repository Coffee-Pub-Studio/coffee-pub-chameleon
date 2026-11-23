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
    if (what === 'escapeUtil') {
      // The SDK's helpers (ctx.util, and ymd and parseYmd beside the library) are the context's own: none reaches this process,
      // the rest of the SDK, or code from strings, and ctx.util can't be changed.
      const u = ctx.util;
      const before = u.plain;
      const replaced = fixtureTry(() => { u.plain = () => 'mine'; return u.plain === before ? 'kept' : 'replaced'; });
      const added = fixtureTry(() => { u.extra = 1; return u.extra === 1 ? 'added' : 'kept'; });
      const swapped = fixtureTry(() => { globalThis.__util = {}; return globalThis.__util === u ? 'kept' : 'swapped'; });
      const seen = {
        frozen: Object.isFrozen(u) ? 'frozen' : 'open',
        replaced: replaced === 'blocked' ? 'kept' : replaced,
        added: added === 'blocked' ? 'kept' : added,
        swapped: swapped === 'blocked' ? 'kept' : swapped,
        keys: Object.keys(u).sort().join(','),
        window: typeof window, document: typeof document, hostActions: typeof hostActions, hostText: typeof hostText, createHost: typeof createHost, hostColour: typeof hostColour, locale: typeof __locale,
        plainCtor: fixtureTry(() => u.plain.constructor('return typeof process')()),
        wordCtor: fixtureTry(() => u.word.constructor('return typeof process')()),
        ymdCtor: fixtureTry(() => ymd.constructor('return typeof process')()),
        localWhenProto: fixtureTry(() => Object.getPrototypeOf(u.localWhen).constructor('return typeof process')()),
        stackFrames: fixtureTry(() => {
          Error.prepareStackTrace = (e, frames) => frames.map((f) => { const fn = f.getFunction && f.getFunction(); return fn ? typeof fn.constructor('return typeof process')() : 'none'; }).join(',');
          return u.detailLines({ get airline() { return new Error('x').stack; } }).join('');
        }),
        word: u.word('space', { many: true, cap: true }),
        time: u.time('22:30'),
        plain: u.plain('**Bold**'),
        sameYmd: ymd === u.ymd && parseYmd === u.parseYmd ? 'same' : 'different',
      };
      return { writes: [{ key: 'probe:escapeUtil', value: seen }] };
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
  // What the handler was given beside the data, written down as it came (the input, its facts and its carrier).
  facts(input, ctx) {
    return { writes: [{ key: 'probe:facts', value: { input, space: ctx.space, people: ctx.people, refs: ctx.refs, carrier: ctx.carrier, tz: ctx.tz, keys: Object.keys(ctx).sort() } }] };
  },
  hidden(input) {
    return { writes: [{ key: 'probe:hidden', value: { title: input.title } }] };
  },
  wipe() {
    return { writes: [{ key: 'probe:wiped', value: true }] };
  },
};
