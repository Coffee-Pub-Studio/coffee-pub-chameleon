'use strict';
// One run of a bundled module's server action (server/module-actions.js; documentation/plans/plan-agent-edit-delete.md,
// "Carrying out agent requests without an open page", E1). Started as a process of its own for each request, by
// server/module-actions.js, with a small heap (--max-old-space-size), code generation from strings off for the whole
// process, Node's permission model with nothing allowed but reading this one file (no other file, no child process, no
// worker, no addon), no environment variables and a temporary folder as its working folder, and killed by its parent after
// a wall-clock limit whatever it does. It reads one JSON message on stdin and writes one JSON line on stdout.
//
// Inside it, the module's library runs in a vm context of its own and never in this process's own scope: the context is
// made from an object with no prototype (so `this.constructor.constructor` is the context's own Function, not this
// process's), with code generation from strings and WebAssembly off (no eval, no Function('...'), no new code at run
// time), no dynamic import (no callback is given, so import() is refused), its microtasks drained inside the time limit
// (microtaskMode afterEvaluate, so a promise loop ends with the script), and only JavaScript's own built-ins: no require,
// process, module, timers, network or console. Nothing of this process's crosses into it: the request, the module's data
// and the handler's context go in as JSON text (strings carry no realm), and the answer comes out the same way, read from
// the context's global as a plain value (getOwnPropertyDescriptor, so no getter of the handler's runs here). Whatever it
// answers is checked again by the parent, which alone writes.
const vm = require('node:vm');

// Built-ins a handler has no use for and that could hold a thread or watch the collector: removed before the library runs.
const PRELUDE = "for (const name of ['console', 'Atomics', 'SharedArrayBuffer', 'WebAssembly', 'FinalizationRegistry', 'WeakRef']) { try { delete globalThis[name]; } catch (e) { /* not there */ } }";

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
  delete g.__action; delete g.__input; delete g.__ctx; delete g.__data;
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
  const copy = (v) => (v === undefined ? null : parse(stringify(v)));
  const ctx = parse(ctxText);
  ctx.read = (key) => (typeof key === 'string' && own.call(data, key) ? copy(data[key]) : null);
  ctx.list = (prefix) => {
    const p = typeof prefix === 'string' ? prefix : '';
    return Object.keys(data).filter((k) => k.startsWith(p)).map((k) => ({ key: k, value: copy(data[k]) }));
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
function run({ code, filename, action, inputText, ctxText, dataText, timeoutMs }) {
  const sandbox = Object.create(null);
  let context;
  try {
    context = vm.createContext(sandbox, { name: 'actions', codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' });
    vm.runInContext(PRELUDE, context, { timeout: timeoutMs });
  } catch {
    return { fault: 'start' };
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
