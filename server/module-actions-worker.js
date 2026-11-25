'use strict';
// One run of a bundled module's server action (server/module-actions.js; documentation/plans/plan-agent-edit-delete.md,
// "Carrying out agent requests without an open page", E1). Started as a process of its own for each request, by
// server/module-actions.js, with a small heap (--max-old-space-size), code generation from strings off for the whole
// process, Node's permission model with nothing allowed but reading this one file (no other file, no child process, no
// worker, no addon), no environment variables and a temporary folder as its working folder, and killed by its parent after
// a wall-clock limit whatever it does. Before this file, the process loads server/module-actions-lockdown.js (--require),
// which takes Node's socket calls, name lookups and inspector away for good, and where the kernel allows it the process is
// started in a network namespace of its own with no interface (server/module-actions.js networkSeal; GitHub #1100). It
// reads one JSON message on stdin and writes one JSON line on stdout.
//
// Inside it, the module's library runs in a vm context of its own and never in this process's own scope: the context is
// made from an object with no prototype (so `this.constructor.constructor` is the context's own Function, not this
// process's), with code generation from strings and WebAssembly off (no eval, no Function('...'), no new code at run
// time), no dynamic import (no callback is given, so import() is refused), its microtasks drained inside the time limit
// (microtaskMode afterEvaluate, so a promise loop ends with the script), and only JavaScript's own built-ins and the SDK's
// pure helpers (SDK_BEFORE, below: loaded by this worker from the text its parent sends, never by the library): no require,
// process, module, timers, network or console. Nothing of this process's crosses into it: the request, the module's data
// and the handler's context go in as JSON text (strings carry no realm), and the answer comes out the same way, read from
// the context's global as a plain value (getOwnPropertyDescriptor, so no getter of the handler's runs here). Whatever it
// answers is checked again by the parent, which alone writes.
const vm = require('node:vm');

// Built-ins a handler has no use for and that could hold a thread or watch the collector: removed before the library runs.
const PRELUDE = "for (const name of ['console', 'Atomics', 'SharedArrayBuffer', 'WebAssembly', 'FinalizationRegistry', 'WeakRef']) { try { delete globalThis[name]; } catch (e) { /* not there */ } }";

// The SDK's pure helpers (plan-agent-edit-delete.md, decision 4): public/sdk/host.js itself, the file every page loads, run in
// the same context before the library, on a stand-in window that has nothing in it (no network, no page, no storage), so its
// helpers are the context's own functions (their constructor is the context's Function, which makes no code). What the
// library is then left with: `ymd` and `parseYmd` beside it (travel-lib.js and calendar-lib.js call them), and `__util`, the
// frozen helpers RUN hands the handler as ctx.util (hostActions.util: plain, localWhen, detailLines, time, ymd, parseYmd,
// objectKey, id, word, label, order, rollup and geo, with `time` on the environment's clock, `word` from its words and `label`
// from the module's labels, as `__locale` gives them; `geo` is the SDK's frozen place helpers, which reach no network). The
// stand-in window, and with it the rest of the SDK (hostActions, createHost, hostText), is taken away before the library runs.
const SDK_BEFORE = "globalThis.window = { addEventListener() {}, removeEventListener() {}, location: { search: '', href: 'http://localhost/' } }; globalThis.window.parent = globalThis.window; globalThis.document = { createElement: (tag) => ({ tag }), currentScript: null };";
const SDK_AFTER = `
;(function () {
  'use strict';
  const g = globalThis;
  const w = g.window;
  let locale = {};
  try { locale = JSON.parse(g.__locale); } catch (e) { locale = {}; }
  const util = w && w.hostActions && typeof w.hostActions.util === 'function' ? w.hostActions.util(locale) : null;
  delete g.window; delete g.document; delete g.__locale;
  if (!util || !Object.isFrozen(util)) throw new Error('the SDK did not load');
  g.ymd = util.ymd;
  g.parseYmd = util.parseYmd;
  Object.defineProperty(g, '__util', { value: util, writable: false, enumerable: false, configurable: false });
})();
`;

// After the library: find the handler, give it the input and its context, and leave what it answered as JSON text in
// __out. A handler may answer at once or with a promise; either way the answer is read only after the context's own
// microtasks have run, inside the time limit. A throw, or a promise that fails, is a refusal with its own sentence.
const RUN = `
;(function () {
  'use strict';
  const g = globalThis;
  const name = g.__action;
  const inputText = g.__input;
  const ctxText = g.__ctx;
  const dataText = g.__data;
  const sharedText = g.__shared;
  delete g.__action; delete g.__input; delete g.__ctx; delete g.__data; delete g.__shared;
  const parse = JSON.parse;
  const stringify = JSON.stringify;
  const own = Object.prototype.hasOwnProperty;
  const say = (o) => { try { g.__out = stringify(o); } catch (e) { g.__out = '{"fault":"result"}'; } };
  const refuse = (err) => {
    let m = '';
    try { m = typeof err === 'string' ? err : err && typeof err.message === 'string' ? err.message : ''; } catch (e) { m = ''; }
    say({ refused: String(m) });
  };
  const handlers = typeof ACTION_HANDLERS === 'undefined' ? null : ACTION_HANDLERS;
  const fn = handlers !== null && handlers !== undefined && own.call(handlers, name) ? handlers[name] : null;
  if (typeof fn !== 'function') { say({ fault: 'missing' }); return; }
  const data = parse(dataText);
  // The module's environment objects marked for this space (scope 'environment'); the space's own data otherwise.
  const shared = parse(sharedText);
  const from = (scope) => (scope === 'environment' ? shared : data);
  const copy = (v) => (v === undefined ? null : parse(stringify(v)));
  const ctx = parse(ctxText);
  ctx.util = g.__util;
  ctx.read = (key, scope) => (typeof key === 'string' && own.call(from(scope), key) ? copy(from(scope)[key]) : null);
  ctx.list = (prefix, scope) => {
    const p = typeof prefix === 'string' ? prefix : '';
    const rows = from(scope);
    return Object.keys(rows).filter((k) => k.startsWith(p)).map((k) => ({ key: k, value: copy(rows[k]) }));
  };
  let out;
  try { out = fn(parse(inputText), ctx); } catch (err) { refuse(err); return; }
  let thenable = false;
  try { thenable = Boolean(out) && typeof out.then === 'function'; } catch (err) { refuse(err); return; }
  if (thenable) {
    try { out.then((v) => say({ result: v === undefined ? null : v }), refuse); } catch (err) { refuse(err); }
  } else {
    say({ result: out === undefined ? null : out });
  }
})();
`;

const { types } = require('node:util');

// The run, as one answer: { text } (what the handler left, as JSON text) or { fault }.
function run({ code, filename, action, inputText, ctxText, dataText, sharedText, sdk, localeText, timeoutMs }) {
  const sandbox = Object.create(null);
  let context;
  try {
    context = vm.createContext(sandbox, { name: 'actions', codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' });
    vm.runInContext(PRELUDE, context, { timeout: timeoutMs });
  } catch {
    return { fault: 'start' };
  }
  // The SDK's helpers, before the library and in their own time limit (the library keeps its own whole).
  try {
    if (typeof sdk !== 'string' || !sdk) throw new Error('no SDK');
    sandbox.__locale = String(localeText || '{}');
    vm.runInContext(SDK_BEFORE, context, { timeout: timeoutMs });
    vm.runInContext(sdk, context, { filename: 'public/sdk/host.js', timeout: timeoutMs });
    vm.runInContext(SDK_AFTER, context, { timeout: timeoutMs });
  } catch {
    return { fault: 'sdk' };
  }
  let script;
  try {
    script = new vm.Script(`${code}\n${RUN}`, { filename });
  } catch {
    return { fault: 'library' };
  }
  sandbox.__action = String(action);
  sandbox.__input = String(inputText);
  sandbox.__ctx = String(ctxText);
  sandbox.__data = String(dataText);
  sandbox.__shared = typeof sharedText === 'string' && sharedText ? sharedText : '{}';
  try {
    script.runInContext(context, { timeout: timeoutMs, breakOnSigint: false });
  } catch (err) {
    // Only a plain own `code` is read (a timeout's), never through a getter or a proxy's trap, which would run the
    // library's code outside the time limit. (A library that throws a look-alike only names its own fault.)
    const code = !types.isProxy(err) && err !== null && typeof err === 'object' ? Object.getOwnPropertyDescriptor(err, 'code') : null;
    const timedOut = Boolean(code) && code.value === 'ERR_SCRIPT_EXECUTION_TIMEOUT';
    return { fault: timedOut ? 'timeout' : 'library' };
  }
  const out = Object.getOwnPropertyDescriptor(sandbox, '__out');
  return out && typeof out.value === 'string' ? { text: out.value } : { fault: 'unanswered' };
}

// One message in, one line out. A message that does not read is a fault, never a throw.
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let message;
  try { message = JSON.parse(input); } catch { message = null; }
  const answer = message && typeof message === 'object' ? run(message) : { fault: 'start' };
  process.stdout.write(`${JSON.stringify(answer)}\n`, () => process.exit(0));
});
