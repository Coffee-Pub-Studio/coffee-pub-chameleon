'use strict';
// The server runner for agents' requests to bundled modules (documentation/plans/plan-agent-edit-delete.md, decision 4 and
// "Carrying out agent requests without an open page", E1; step 1 of "Left to build").
//
// A bundled module may declare `"actions": { "server": "src/<id>-lib-actions.js", ... }`: one of its own libraries, which
// its page already carries (server/module-build.js libraryOf puts every src/<id>-lib*.js into the page), defining
//   const ACTION_HANDLERS = { <action name>: (input, ctx) => ({ writes, ref?, data? }) };
// with one handler for every action an agent may ask the module for. `ctx` is the page adapter's (public/sdk/host.js
// host.actions.fromLibrary), as plain data plus three kinds of function:
//   { from, by, byKey, credit: { name, key }, now, tz, carrier: 'server', action,
//     space: { id, name, currency, defaultCurrency, phases: [{ id, main }], bands }, people: [{ key, name }],
//     refs: { <objectKey>: { title, subtitle, kind, copy?, original?: { module, name } } | { error } },
//     read(key), list(prefix), util }
// The asker is the agent and so is the credit; read and list see only this module's data in the request's space, as the agent
// may read it; the facts (space, people, refs) are server/index.js actionFacts, refs only for the input's own pointers as the
// agent may see them. `util` is the SDK's pure helpers, frozen (hostActions.util: plain, localWhen, detailLines, time, ymd,
// parseYmd, objectKey, id, word; `time` on the environment's clock and `word` in its words), and `ymd` and `parseYmd` are
// beside the library as on a page: the worker builds them from public/sdk/host.js itself before the library runs, so a page
// and the server run one copy. `carrier` is 'server' (a page's is 'page'): nothing only a page does is done here (a reminder's
// schedule, a link, a phase's end), and a handler says so in its note. A handler answers what to write (at most
// LIMITS.writes values, each { key, value }, in the module's own data in that space and nowhere else), the pointer of what
// it made or changed (`ref`, one of the module's own kinds in that space) and a little plain data (`data`, with `data.note`
// the line request_status shows); a throw is a refusal, and its message is the sentence the agent reads.
//
// This file loads the code (only ever from the deployment's own modules/ folder, never from what is installed in
// DATA_DIR, and only while the installed module is that very bundled version), runs it in a process of its own with a
// memory ceiling and Node's permission model, in a vm context with a time limit (server/module-actions-worker.js), and
// checks what it answered. It writes
// nothing: server/index.js applies the writes through the same checked write path a person's page uses (putModuleValue),
// as the agent, with the agent's own rights. Uploaded modules never come here: their code is not ours, and vm is no
// security boundary, so they keep the wait for an open page.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { libraryOf } = require('./module-build');
const { word } = require('./words');

const LIMITS = Object.freeze({
  timeMs: 1000, // the handler's own time, the library's loading included (the plan's one second)
  wallMs: 4000, // the whole run, the process's start included; past it the process is killed
  heapMb: 64, // the process's heap (--max-old-space-size); past it the process ends
  semiMb: 4, // its young generation's halves (--max-semi-space-size)
  inputBytes: 64 * 1024, // the request's input, as JSON
  dataBytes: 6 * 1024 * 1024, // the module's data in the space handed to the handler, as JSON (a module holds at most 5 MB)
  resultBytes: 1024 * 1024, // what the handler answers, as JSON
  answerDataBytes: 8000, // its `data`, as the bus keeps a page's (POST /api/bus/actions/complete)
  writes: 10, // values one request may write (as many as a page's claim may name its asker on)
  running: 4, // runs at once on this server; more wait their turn
  queued: 16, // runs waiting their turn; past it the request is refused as busy
  sentence: 200, // a refusal's sentence, as the bus keeps a page's
});

// The library a bundled module's server actions run from: its source folder in the deployment (`bundledDir/<id>`), read
// once per version. `server` must name one of its own library files (cleanBus checks the shape; the file must be among
// what libraryOf puts in the page).
const SERVER_FILE_RE = (id) => new RegExp(`^src/${id.replace(/[^a-z0-9-]/g, '')}-lib(-[a-z0-9-]+)?\\.js$`);

// The flags of a run's process: its heap, no code from strings anywhere in it, and the permission model reading only its
// own script (the flag's name is --permission from Node 22.13, --experimental-permission before).
const PERMISSION_FLAG = process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission' : '--experimental-permission';
const runFlags = (workerFile) => [
  `--max-old-space-size=${LIMITS.heapMb}`, `--max-semi-space-size=${LIMITS.semiMb}`, '--disallow-code-generation-from-strings',
  PERMISSION_FLAG, `--allow-fs-read=${workerFile}`, '--no-warnings', workerFile,
];

// The SDK every page loads (public/sdk/host.js): its pure helpers are what a library gets as ctx.util, built from this very
// file in the run's own context (server/module-actions-worker.js), so a page and the server run one copy of each.
const SDK_FILE = path.join(__dirname, '..', 'public', 'sdk', 'host.js');

function createModuleActions({ bundledDir, workerFile = path.join(__dirname, 'module-actions-worker.js'), sdkFile = SDK_FILE }) {
  const codeCache = new Map(); // `${id}@${version}` -> { code, file } | null
  // Read once: it is the deployment's own file and changes only with a new deployment. Null when it can't be read, and then
  // every run is a fault ('sdk'), never a run without the helpers.
  let sdkText;
  const sdk = () => {
    if (sdkText === undefined) { try { sdkText = fs.readFileSync(sdkFile, 'utf8'); } catch { sdkText = null; } }
    return sdkText;
  };

  // Whether the server carries this module's agent requests, and with what code: { code, filename } or null. Only a module
  // installed from this deployment's own copy (`source: 'bundled'`), whose active version is the version shipped now,
  // declaring `actions.server` both in what is installed and in what is shipped, naming one of its own library files.
  function libraryFor(found) {
    if (!found || !found.entry || !found.manifest) return null;
    const { entry, manifest } = found;
    if (entry.source !== 'bundled') return null;
    const declared = manifest.actions && typeof manifest.actions.server === 'string' ? manifest.actions.server : null;
    if (!declared || !SERVER_FILE_RE(manifest.id).test(declared)) return null;
    const key = `${manifest.id}@${entry.version}`;
    if (codeCache.has(key)) return codeCache.get(key);
    let out = null;
    try {
      const dir = path.join(bundledDir, manifest.id);
      const shipped = JSON.parse(fs.readFileSync(path.join(dir, 'module.json'), 'utf8'));
      if (shipped && shipped.id === manifest.id && shipped.version === entry.version && shipped.version === manifest.version
        && shipped.actions && shipped.actions.server === declared) {
        const lib = libraryOf(dir, manifest.id);
        if (lib.files.includes(declared)) out = { code: lib.js, filename: `modules/${manifest.id}/${declared}` };
      }
    } catch {
      out = null;
    }
    if (codeCache.size > 200) codeCache.clear();
    codeCache.set(key, out);
    return out;
  }

  // At most LIMITS.running processes at once; the rest wait in order, up to LIMITS.queued.
  let running = 0;
  const waiting = [];
  const turn = () => new Promise((resolve, reject) => {
    if (running < LIMITS.running) { running += 1; return resolve(); }
    if (waiting.length >= LIMITS.queued) return reject(Object.assign(new Error('busy'), { busy: true }));
    waiting.push(resolve);
  });
  const done = () => {
    const next = waiting.shift();
    if (next) next(); else running -= 1;
  };

  // One run: { text } (the handler's answer as JSON text) or { fault } (start, sdk, library, timeout, memory, crashed, busy,
  // missing, result, size, unanswered). `localeText` is { clock, words } as JSON: the environment's, for ctx.util's time and
  // word. Never throws.
  async function run({ code, filename, action, inputText, ctxText, dataText, localeText = '{}' }) {
    const sdkSource = sdk();
    if (!sdkSource) return { fault: 'sdk' };
    try { await turn(); } catch { return { fault: 'busy' }; }
    try {
      return await new Promise((resolve) => {
        let settled = false;
        let timer = null;
        let child = null;
        const finish = (v) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
          resolve(v);
        };
        try {
          child = spawn(process.execPath, runFlags(workerFile), { cwd: os.tmpdir(), env: {}, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
        } catch {
          return resolve({ fault: 'start' });
        }
        timer = setTimeout(() => finish({ fault: 'timeout' }), LIMITS.wallMs);
        const chunks = [];
        let size = 0;
        child.stdout.on('data', (chunk) => {
          size += chunk.length;
          if (size > LIMITS.resultBytes + 1024) return finish({ fault: 'size' });
          chunks.push(chunk);
        });
        child.on('error', () => finish({ fault: 'start' }));
        child.on('close', (exitCode, signal) => {
          const line = Buffer.concat(chunks).toString('utf8').trim();
          let m = null;
          try { m = line ? JSON.parse(line) : null; } catch { m = null; }
          if (m && typeof m.text === 'string') return finish({ text: m.text });
          if (m && typeof m.fault === 'string') return finish({ fault: m.fault });
          // No answer: a heap past its limit ends the process with V8's abort (SIGABRT) or a fatal exit code.
          finish({ fault: signal === 'SIGABRT' || exitCode === 134 ? 'memory' : 'crashed' });
        });
        child.stdin.on('error', () => { /* the process ended before it read everything: its exit says why */ });
        child.stdin.end(JSON.stringify({ code, filename, action, inputText, ctxText, dataText, sdk: sdkSource, localeText, timeoutMs: LIMITS.timeMs }));
      });
    } finally {
      done();
    }
  }

  return { libraryFor, run };
}

// What a handler answered, checked: { refused: sentence } | { fault } | { writes: [{ key, value }], ref, data }.
// `own(ref)` says whether a pointer is one of the module's own kinds in the request's space. Nothing in the answer is
// trusted: only these fields, of these types, within these sizes.
const plainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const oneLine = (v) => String(v).replace(/[\p{Cc}\p{Cf}]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, LIMITS.sentence);
function outcomeOf(answer, { own }) {
  if (!answer || typeof answer.text !== 'string') return { fault: answer && answer.fault ? answer.fault : 'unanswered' };
  if (answer.text.length > LIMITS.resultBytes) return { fault: 'size' };
  let parsed;
  try { parsed = JSON.parse(answer.text); } catch { return { fault: 'result' }; }
  if (!plainObject(parsed)) return { fault: 'result' };
  if (typeof parsed.fault === 'string') return { fault: parsed.fault === 'missing' ? 'missing' : 'result' };
  if (Object.hasOwn(parsed, 'refused')) return { refused: oneLine(parsed.refused) };
  // A handler that answers nothing changed nothing.
  const result = parsed.result === null ? {} : parsed.result;
  if (!plainObject(result)) return { fault: 'result' };
  for (const k of Object.keys(result)) if (!['writes', 'ref', 'data'].includes(k)) return { fault: 'result' };
  const given = result.writes === undefined || result.writes === null ? [] : result.writes;
  if (!Array.isArray(given) || given.length > LIMITS.writes) return { fault: Array.isArray(given) ? 'writes' : 'result' };
  const writes = [];
  const seen = new Set();
  for (const w of given) {
    if (!plainObject(w)) return { fault: 'result' };
    // Ready for step 4 of the plan, not built: a delete is never a handler's (an approved delete is the server's own path).
    if (Object.hasOwn(w, 'delete')) return { fault: 'delete' };
    // A write names a key and a value and nothing else: no module, scope, space or person, so it can only ever land in
    // this module's data in the request's space.
    if (Object.keys(w).some((k) => k !== 'key' && k !== 'value')) return { fault: 'place' };
    if (typeof w.key !== 'string' || !w.key || w.key.length > 128 || seen.has(w.key)) return { fault: 'result' };
    if (w.value === undefined) return { fault: 'result' };
    seen.add(w.key);
    writes.push({ key: w.key, value: w.value });
  }
  let ref = null;
  if (result.ref !== undefined && result.ref !== null) {
    if (!plainObject(result.ref) || !own(result.ref)) return { fault: 'ref' };
    ref = result.ref;
  }
  let data;
  if (result.data !== undefined && result.data !== null) {
    const text = JSON.stringify(result.data);
    if (text.length > LIMITS.answerDataBytes) return { fault: 'size' };
    data = JSON.parse(text);
  }
  return { writes, ref, ...(data !== undefined ? { data } : {}) };
}

// A fault in words, after "<Module> could not carry that out: ". Plain, and never the module's own text.
const FAULT_WORDS = {
  busy: () => 'the server is busy with other requests, so try again in a moment',
  timeout: () => 'it took too long',
  memory: () => 'it used too much memory',
  library: () => 'its code did not load',
  sdk: () => 'the helpers its code uses did not load',
  start: () => 'its code could not be started',
  crashed: () => 'its code stopped',
  missing: () => 'it has no server code for that action',
  result: () => 'it answered something the server can\'t use',
  size: () => 'it answered more than the server takes',
  writes: () => `it tried to change more than ${LIMITS.writes} things at once`,
  place: () => `it tried to write outside its own data in this ${word('space')}`,
  delete: () => 'it tried to delete something, which needs a person\'s approval',
  ref: () => `it pointed at something that is not its own in this ${word('space')}`,
  unanswered: () => 'it gave no answer',
};
const faultWords = (fault) => (FAULT_WORDS[fault] || FAULT_WORDS.unanswered)();

module.exports = { createModuleActions, outcomeOf, faultWords, MODULE_ACTION_LIMITS: LIMITS, MODULE_ACTION_RUN_FLAGS: runFlags, SERVER_FILE_RE };
