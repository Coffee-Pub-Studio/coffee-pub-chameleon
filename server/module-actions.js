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
//     space: { id, name, currency, defaultCurrency, phases: [{ id, label, main }], bands }, people: [{ key, name }],
//     refs: { <objectKey>: { title, subtitle, kind, copy?, original?: { module, name } } | { error } }, settings,
//     read(key), list(prefix), util }
// The asker is the agent and so is the credit; read and list see only this module's data in the request's space, as the agent
// may read it; the facts (space, people, refs) are server/index.js actionFacts, refs only for the input's own pointers as the
// agent may see them. `settings` are the module's settings in that space as host.settings.get() gives them (server/index.js
// moduleSettingValues, which GET /api/modules/:id/settings/values answers with), each person setting at its default since an
// agent has none of its own. `util` is the SDK's pure helpers, frozen (hostActions.util: plain, localWhen, detailLines, time,
// ymd, parseYmd, objectKey, id, word, label, order, rollup and geo; `time` on the environment's clock, `word` in its words,
// `label` the module's own words as the space's template renames them, `order` and `rollup` the outline's, `geo` the frozen
// place helpers, which reach no network), and `ymd` and `parseYmd` are
// beside the library as on a page: the worker builds them from public/sdk/host.js itself before the library runs, so a page
// and the server run one copy. `carrier` is 'server' (a page's is 'page'). A handler answers what to write (at most
// LIMITS.writes values, each { key, value }, in the module's own data in that space and nowhere else), the pointer of what
// it made or changed (`ref`, one of the module's own kinds in that space), a little plain data (`data`, with `data.note`
// the line request_status shows) and, as plain data the server then carries out as the agent (server/action-effects.js):
// `links` (at most 5 link changes from its own objects), `schedules` (at most 5 set or cancelled, about its own objects,
// with the module's schedule hook), `notify` (at most 1 notice, with its notify hook) and `phaseEnd` ({ date }: the space's
// main phase's end moved later to cover that day, only for an action whose manifest says `phaseEnd: true`). A throw is a
// refusal, and its message is the sentence the agent reads.
//
// Outside the space (plan-agent-server-actions.md, sections 3 and 4, step 9). A write may say `scope: 'environment'`: the
// server then makes it in the module's environment data, only for one of the module's own kinds that carry space marks
// (refs.produces' summary.spaces), only when its value marks the request's space, and never changing which other spaces
// it is marked for; `read(key, 'environment')` and `list(prefix, 'environment')` give the handler those objects that are
// marked for this space, and nothing else of the environment. `scope: 'person'` refuses the request: an agent has no data
// of its own. And an action may declare `lookups: { <input>: 'geocode' }`: the server searches that input's text with the
// module's place search before the run and the handler reads the answer as ctx.lookups.<input> (at most 6 of { title,
// sub, lat, lng, key }). The run itself has no network and no way to ask for another search.
//
// This file loads the code (only ever from the deployment's own modules/ folder, never from what is installed in
// DATA_DIR, and only while the installed module is that very bundled version), runs it in a process of its own with a
// memory ceiling and Node's permission model, with Node's socket calls taken away (server/module-actions-lockdown.js) and,
// where the kernel allows, in a network namespace of its own (networkSeal, below), in a vm context with a time limit
// (server/module-actions-worker.js), and checks what it answered. It writes
// nothing: server/index.js applies the writes through the same checked write path a person's page uses (putModuleValue),
// as the agent, with the agent's own rights. Uploaded modules never come here: their code is not ours, and vm is no
// security boundary, so they keep the wait for an open page.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { libraryOf } = require('./module-build');
const { word } = require('./words');
const { effectsOf, EFFECT_FAULT_WORDS } = require('./action-effects');

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

// The flags of a run's process: its heap, no code from strings anywhere in it, the permission model reading only its own
// script and the lockdown (the flag's name is --permission from Node 22.13, --experimental-permission before), no inspector
// on a signal where Node has the flag, and the lockdown loaded before the script (server/module-actions-lockdown.js: no
// socket, name lookup or inspector through Node, whatever then runs in the process; GitHub #1100).
const PERMISSION_FLAG = process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission' : '--experimental-permission';
const SIGNAL_FLAGS = process.allowedNodeEnvironmentFlags.has('--disable-sigusr1') ? ['--disable-sigusr1'] : [];
const LOCKDOWN_FILE = path.join(__dirname, 'module-actions-lockdown.js');
const runFlags = (workerFile) => [
  `--max-old-space-size=${LIMITS.heapMb}`, `--max-semi-space-size=${LIMITS.semiMb}`, '--disallow-code-generation-from-strings',
  PERMISSION_FLAG, `--allow-fs-read=${workerFile}`, `--allow-fs-read=${LOCKDOWN_FILE}`, ...SIGNAL_FLAGS, '--no-warnings', '--require', LOCKDOWN_FILE, workerFile,
];

// A network namespace of its own for a run's process, where the kernel gives this server one: { command, args } to start
// the process through (`unshare`, which then becomes the process itself, so it is killed as before), or null. Inside it
// there is no interface but a loopback that is down, so no address is reachable, the server's own 127.0.0.1 included:
// held by the kernel, whatever the process does. Tried once: with a user namespace (-r, what a server that is not root
// needs), then without (root with the right to make namespaces). A usual Docker container allows neither (its default
// seccomp profile refuses new namespaces), and then the lockdown above is what holds. Linux only.
const UNSHARE_PATHS = ['/usr/bin/unshare', '/bin/unshare', '/usr/sbin/unshare', '/sbin/unshare'];
let sealFound;
function networkSeal() {
  if (sealFound !== undefined) return sealFound;
  sealFound = null;
  if (process.platform !== 'linux') return sealFound;
  const command = UNSHARE_PATHS.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
  if (!command) return sealFound;
  for (const flag of ['-rn', '-n']) {
    try {
      const r = spawnSync(command, [flag, process.execPath, '-e', 'process.stdout.write("sealed")'], { env: {}, cwd: os.tmpdir(), encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
      if (r.status === 0 && r.stdout === 'sealed') { sealFound = Object.freeze({ command, args: Object.freeze([flag]) }); break; }
    } catch { /* not this way */ }
  }
  return sealFound;
}
// ACTION_RUNNER_NETWORK: 'namespace' runs nothing without a network namespace; anything else uses one where there is one.
const NETWORK_MODES = ['auto', 'namespace'];

// The SDK every page loads (public/sdk/host.js): its pure helpers are what a library gets as ctx.util, built from this very
// file in the run's own context (server/module-actions-worker.js), so a page and the server run one copy of each.
const SDK_FILE = path.join(__dirname, '..', 'public', 'sdk', 'host.js');

function createModuleActions({ bundledDir, workerFile = path.join(__dirname, 'module-actions-worker.js'), sdkFile = SDK_FILE, network = 'auto' }) {
  // How a run is kept off the network (see networkSeal): { mode, namespace: whether a run gets a network namespace }.
  const mode = NETWORK_MODES.includes(network) ? network : 'auto';
  const seal = networkSeal();
  const networkState = Object.freeze({ mode, namespace: Boolean(seal), known: mode === network || !network });
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

  // One run: { text } (the handler's answer as JSON text) or { fault } (start, sdk, network, library, timeout, memory, crashed,
  // busy, missing, result, size, unanswered). `localeText` is { clock, words, labels } as JSON: the environment's clock and
  // words and the module's labels in the space, for ctx.util's time, word and label. Never throws.
  async function run({ code, filename, action, inputText, ctxText, dataText, sharedText = '{}', localeText = '{}' }) {
    const sdkSource = sdk();
    if (!sdkSource) return { fault: 'sdk' };
    // Asked to run only in a network namespace, and this server has none to give: nothing runs.
    if (mode === 'namespace' && !seal) return { fault: 'network' };
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
          child = spawn(seal ? seal.command : process.execPath, seal ? [...seal.args, process.execPath, ...runFlags(workerFile)] : runFlags(workerFile), { cwd: os.tmpdir(), env: {}, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
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
        child.stdin.end(JSON.stringify({ code, filename, action, inputText, ctxText, dataText, sharedText, sdk: sdkSource, localeText, timeoutMs: LIMITS.timeMs }));
      });
    } finally {
      done();
    }
  }

  return { libraryFor, run, network: networkState };
}

// What a handler answered, checked: { refused: sentence } | { fault } | { denied: 'person' } (a write for the person, which
// an agent has none of) | { writes: [{ key, value, scope?: 'environment' }], ref, data, effects: { links, schedules,
// notify, phaseEnd? } } (the effects as server/action-effects.js effectsOf checks them).
// `own(ref)` says whether a pointer is one of the module's own kinds in the request's space; `shared(ref)` answers the
// stored key of an environment pointer of one of its own kinds that carry space marks, or null; `phaseEnd` whether the
// action may move the main phase's end (its manifest says so). Nothing in the answer is trusted: only these fields, of
// these types, within these sizes.
const plainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const oneLine = (v) => String(v).replace(/[\p{Cc}\p{Cf}]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, LIMITS.sentence);
function outcomeOf(answer, { own, shared = null, phaseEnd = false }) {
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
  for (const k of Object.keys(result)) if (!['writes', 'ref', 'data', 'links', 'schedules', 'notify', 'phaseEnd'].includes(k)) return { fault: 'result' };
  const given = result.writes === undefined || result.writes === null ? [] : result.writes;
  if (!Array.isArray(given) || given.length > LIMITS.writes) return { fault: Array.isArray(given) ? 'writes' : 'result' };
  const writes = [];
  const seen = new Set();
  for (const w of given) {
    if (!plainObject(w)) return { fault: 'result' };
    // Ready for step 4 of the plan, not built: a delete is never a handler's (an approved delete is the server's own path).
    if (Object.hasOwn(w, 'delete')) return { fault: 'delete' };
    // A write names a key and a value, and may name a scope: no module, space or person, so it lands in this module's data
    // in the request's space, or (scope 'environment', plan-agent-server-actions.md section 4) in the module's environment
    // data, which the server then holds to the module's own kinds marked for that space. An agent has no data of its own,
    // so a write for the person (scope 'person') refuses the whole request.
    if (Object.keys(w).some((k) => k !== 'key' && k !== 'value' && k !== 'scope')) return { fault: 'place' };
    const scope = w.scope === undefined || w.scope === null ? 'space' : w.scope;
    if (scope === 'person') return { denied: 'person' };
    if (scope !== 'space' && scope !== 'environment') return { fault: 'place' };
    if (typeof w.key !== 'string' || !w.key || w.key.length > 128 || seen.has(`${scope} ${w.key}`)) return { fault: 'result' };
    if (w.value === undefined) return { fault: 'result' };
    seen.add(`${scope} ${w.key}`);
    // A space write stays exactly { key, value }, as a page's adapter has it; only an environment write says its scope.
    writes.push({ key: w.key, value: w.value, ...(scope === 'environment' ? { scope } : {}) });
  }
  let ref = null;
  if (result.ref !== undefined && result.ref !== null) {
    // The module's own object in the request's space, or the environment object this very answer writes.
    const key = plainObject(result.ref) && !own(result.ref) && shared ? shared(result.ref) : null;
    if (!plainObject(result.ref) || !(own(result.ref) || (key && writes.some((w) => w.scope === 'environment' && w.key === key)))) return { fault: 'ref' };
    ref = result.ref;
  }
  let data;
  if (result.data !== undefined && result.data !== null) {
    const text = JSON.stringify(result.data);
    if (text.length > LIMITS.answerDataBytes) return { fault: 'size' };
    data = JSON.parse(text);
  }
  // What it asks the server to do beside the writes (server/action-effects.js): links, schedules, the main phase's end
  // and one notice.
  const effects = effectsOf(result, { own, phaseEnd });
  if (effects.fault) return { fault: effects.fault };
  return { writes, ref, ...(data !== undefined ? { data } : {}), effects };
}

// A fault in words, after "<Module> could not carry that out: ". Plain, and never the module's own text.
const FAULT_WORDS = {
  busy: () => 'the server is busy with other requests, so try again in a moment',
  timeout: () => 'it took too long',
  memory: () => 'it used too much memory',
  library: () => 'its code did not load',
  sdk: () => 'the helpers its code uses did not load',
  start: () => 'its code could not be started',
  network: () => 'the server could not shut its code off from the network',
  crashed: () => 'its code stopped',
  missing: () => 'it has no server code for that action',
  result: () => 'it answered something the server can\'t use',
  size: () => 'it answered more than the server takes',
  writes: () => `it tried to change more than ${LIMITS.writes} things at once`,
  place: () => `it tried to write outside its own data in this ${word('space')}`,
  shared: () => `it tried to write ${word('environment')} data other than its own ${word('object', { many: true })} that are marked for ${word('space', { many: true })}`,
  unmarked: () => `it tried to write ${word('environment')} data that is not marked for this ${word('space')}`,
  marks: () => `it tried to change which other ${word('space', { many: true })} ${word('environment')} data is marked for`,
  delete: () => 'it tried to delete something, which needs a person\'s approval',
  ref: () => `it pointed at something that is not its own in this ${word('space')}`,
  unanswered: () => 'it gave no answer',
  ...EFFECT_FAULT_WORDS,
};
const faultWords = (fault) => (FAULT_WORDS[fault] || FAULT_WORDS.unanswered)();

module.exports = { createModuleActions, outcomeOf, faultWords, MODULE_ACTION_LIMITS: LIMITS, MODULE_ACTION_RUN_FLAGS: runFlags, MODULE_ACTION_NETWORK_SEAL: networkSeal, SERVER_FILE_RE };
