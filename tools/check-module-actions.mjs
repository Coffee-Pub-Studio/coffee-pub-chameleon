#!/usr/bin/env node
/*
 * check-module-actions.mjs -- the server runner for agents' requests to bundled modules (documentation/plans/
 * plan-agent-edit-delete.md, decision 4, "Carrying out agent requests without an open page" E1 and E3, and step 1 of "Left
 * to build"), against a real server on a throwaway DATA_DIR.
 *
 * The server is a copy of this one whose modules/ folder also holds a fixture bundled module, tools/fixtures/
 * module-actions/fixture-notes (`actions.server`: src/fixture-notes-lib-actions.js), so nothing under modules/ ships it.
 * Checked:
 *   - the declaration: a bundled module's actions.server is kept; a path that is not one of its own libraries is refused;
 *     the runner's process can't read a file or start a process (Node's permission model), whatever runs in it;
 *   - an agent's request is done in the same call, as the agent (its key on the object and on the stored write, credit
 *     and ctx.by the agent's), with the new object's pointer; request_status gives the pointer; a second request can
 *     read it back and link to it; it counts as one write; the activity list names the agent;
 *   - it is never offered to a page: not pending, and a page's claim and complete are refused (one-shot, no second write);
 *   - the gate holds first: a space the agent is not in, a module write row the Agent column lacks, a destructive, local
 *     or AI-kept action are refused and no request is made;
 *   - every write is checked as if the agent sent it: a note naming someone else as its maker, a key the module's guards
 *     do not name, a change to a note someone else made, are refused with the guards' sentences and write nothing; one
 *     refused write puts back the ones before it;
 *   - a handler can't escape: no require, process, module, timers, network, console, eval, Function, constructor chains,
 *     stack frames or dynamic import; prototype pollution does not outlive its run; it reads only its own module's data in
 *     its own space;
 *   - a handler that throws gives its sentence (422); one that loops, loops in promises, throws a looping proxy, allocates
 *     without bound, answers non-JSON, too much, too many writes, a write naming another module or space, a delete, a
 *     pointer that is not its own, or no handler at all writes nothing and gives one sentence (500), and the server lives;
 *   - input over the size cap is 413 and makes no request;
 *   - what changed while the handler ran is not overwritten (409); a request ended while it ran (Revoke) writes nothing;
 *   - a request the server was carrying when it stopped reads as done and failed after a restart;
 *   - nothing waits for a page (plan-agent-server-actions.md, step 11d): an uploaded module without server actions (and a
 *     newer upload of the fixture itself) is refused at once, 409 with its sentence, list_actions shows may: false and why,
 *     nothing is queued; there is no wait_for_result and no wait route; a person's own request still goes to a page;
 *   - the richer ctx (step 1b): ctx.util is the SDK's own helpers (public/sdk/host.js, loaded by the worker), frozen, with the
 *     environment's clock and words, and no way out through them (no constructor, stack frame or leftover of the SDK); the
 *     facts (space, people) are exactly the page's shape; refs only for the input's pointers, a pointer into another space or
 *     one the module may not link to resolving to nothing; an input the action `clears` keeps "", every other refusal stands;
 *   - the Itinerary and the Calendar carried by the server: acceptSuggestion with a full flight, updatePlan patching only the
 *     gate and terminal, createEvent with a 90 minute reminder and notes (the reminder marked as waiting for a page, and said),
 *     updateEvent clearing the reminder (the schedule a page set from the old event cancelled), each with the module tests'
 *     writes; an uploaded copy that may move the phase's end is refused at install, and one without server actions is refused
 *     at once to the agent;
 *   - To-do carried by the server (step 2b): createTask with a reminder, then updateTask on its pointer at once (notes cleared
 *     with ""), the reminder marked as waiting for a page and the schedule a page set from the old task cancelled; setTaskDue
 *     clearing the due date; linkTask and unlinkTask on the Calendar's event; the same request through an uploaded copy is refused
 *     at once.
 *   - plan-agent-server-actions.md steps 1 and 2: ctx.settings are what GET settings/values answers (person settings at their
 *     default); ctx.util gains label (the manifest's words, then the template's), order, rollup and geo, frozen and with no way
 *     out; ctx.space.phases carry their labels (the travel template, which this copy's templates let offer the fixture); a
 *     handler's data beyond its note reaches the agent in the answer, request_status and MCP, capped; a ref
 *     input may be declared in `clears`, and "" then clears it through the bus and the gate; checkToolInput keeps "" for a
 *     declared clear.
 *   - plan-agent-server-actions.md steps 4 and 5 (server/action-effects.js): a handler's answer may name links (add, remove),
 *     schedules (set, cancel) and one notice, which the server carries out as the agent in the same step as the writes and
 *     records in the request's outcome (`effects`); more than 5 links, 5 schedules or 1 notice, an unknown field, a link not
 *     from the module's own object here, a schedule or notice about someone else's object are faults; a link to an object
 *     in a space the agent is not in, in another of its spaces, to a kind the module is not approved to link to, to nothing,
 *     a notice to the environment or a stranger, a module without the schedule or notify hook, are each refused with one
 *     sentence; whenever a later effect fails the writes, the links and the schedules before it (those taken off because
 *     their object changed included) are put back exactly; a closed space, or one closed while the handler ran, gets
 *     nothing; the handler still reaches no network.
 *   - plan-agent-server-actions.md step 8 (`phaseEnd`): an action whose manifest says `phaseEnd: true` may answer
 *     `phaseEnd: { date }`, and the server moves the space's main phase's end later to cover that day (the cover route's
 *     own rule, every later boundary with it), in the same step, recorded in `effects`; never earlier, and nothing without
 *     phases; an action that does not say so, any field but `date` (a phase's id, a start, a space), a day that is not a
 *     real day, a day more than 366 days past the end, are refused and nothing changes; a notice that fails after the end
 *     moved puts the dates back exactly with the writes; a space the agent is not in and a closed space get nothing; an
 *     asker whose rights do not let it move the dates keeps its writes and reads why in the note (the effects' own apply,
 *     with the right taken away); the Itinerary's addStop past the plan's last day moves it with no note; the cover route
 *     a page uses answers as before, with the same 366 days.
 *   - plan-agent-server-actions.md step 9 and GitHub #1100. The runner's process opens no socket: a hostile script started
 *     with the runner's own flags (tools/fixtures/module-actions/network-probe.cjs, outside any vm context) tries TCP, a unix
 *     socket, listening, http, fetch, WebSocket, tls, http2, UDP, name lookups, the resolver, the inspector, a signal to
 *     itself, process.binding, a worker, a child process, a descriptor and putting a taken-away call back, against a real
 *     server on 127.0.0.1, and the build fails if one gets through (the same script without the lockdown does connect, so
 *     the probe is real); where this machine gives a network namespace, the kernel alone stops every address too; a server
 *     told to run only in a namespace runs nothing without one.
 *     Writes outside the space: an environment write is made only for the module's own kind that carries space marks, with
 *     a value that marks the request's space, as the agent, and can be read back; without the mark, for another kind,
 *     naming another module, marking or unmarking another space, over an object the space is not marked on, in a module
 *     with no environment data, or past the count, it is refused and nothing changes; a write for the person is refused
 *     with its sentence; a refusal after an environment write puts it back with the rest.
 *     The place search: an action's `lookups` is kept only for a string input of a module with a geocoder; nothing is
 *     asked when no service is chosen; one request leaves the server, carrying the declared input's text and nothing else
 *     of the request, the agent or the space; the handler gets at most 6 small results as plain data, no function to ask
 *     again with, and an action that declares none gets nothing; each search is one of the agent's reads.
 *   - plan-agent-server-actions.md step 10. The same cases on both carriers: environment reads, environment writes and their
 *     refusals (no mark, another space's, another kind, an object not marked here, a pointer it does not write) and a write
 *     for the person give the server's sentences through the SDK's page adapter too (tools/module-actions-harness.mjs onPage),
 *     a person's own request may write their own data and another person's may not, and ctx.lookups on a page is cut as the
 *     server cuts it. actions.pageOnly keeps the module's own library files out of what the runner loads (Maps' map library).
 *     Maps on the server with a stand-in place search: addPlace by address with one clear match sets the position, several
 *     leave it without one and list them, none says so, the search off says so and sends nothing; an environment place
 *     marks the request's space; a place for the person is refused for the agent with its sentence and nothing is written;
 *     updatePlace and setPlacePoint on the environment place by its pointer; every Maps action an agent may ask is done now.
 *   - plan-agent-server-actions.md step 11d, uploaded modules (the hostile cases of its Verify section). The slot share, with a
 *     stand-in worker: at most 2 of the 4 running slots for uploaded modules, a third waits while bundled runs take the free
 *     slots, at most 8 uploaded runs wait, and an uploaded run whose code does not hash to the approved hash never starts.
 *     On a server without the wall, an upload with server actions installs, may be approved, and is refused at once with the
 *     wall's sentence. On a second server with ACTION_RUNNER_NETWORK=namespace (where this machine gives a namespace; else the
 *     start-up line and the refusal are checked and the live part is said to be skipped), with the upload fixture
 *     (tools/fixtures/module-actions/fixture-upload: a library the module check accepts that reaches for everything at run
 *     time): the admin sees the library's hash (the validator's), the wall and no approval; unapproved, its action is refused
 *     at once (409, the sentence) and shown with may: false and why, through MCP too, nothing queued; only the admin approves
 *     (an owner, a member, an agent's token, nobody signed in and another site are refused; another version or hash is 409;
 *     a bundled module is 400); an approval for one module runs no other; approved, it runs as the agent in the namespace;
 *     the library gets no require, process, network, eval, Function or constructor way out, no file through ctx.read and
 *     none of the server's secrets; a long loop, a promise loop, memory, huge output and huge data are faults that write
 *     nothing; it writes no environment or person data and moves no phase's end, even with its manifest edited on disk past
 *     install (a place search declared on disk is refused before anything is searched); one byte changed in its installed
 *     library is not run until approved again; taking the approval back while a run is going writes nothing; three uploaded
 *     runs and a bundled one at once are all done; a new version, disabling, rolling back and uninstalling drop the approval.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const FIXTURE = path.join(ROOT, 'tools', 'fixtures', 'module-actions', 'fixture-notes');
// An uploadable module whose library reaches for everything the server must hold, built from pieces so the module check lets it
// through (plan-agent-server-actions.md, step 11d): only the worker, the wall and the admin's approval hold it.
const UPLOAD_FIXTURE = path.join(ROOT, 'tools', 'fixtures', 'module-actions', 'fixture-upload');
const { buildModule } = require(path.join(ROOT, 'server', 'module-build.js'));
const ENDED = 'The agent that asked for this can no longer ask for it.';
const CHANGED = 'That changed while it was being done, so nothing was changed. Read it again and ask again.';
const STOPPED = 'The server stopped while carrying this out. Read the data to see whether it was done, and ask again if not.';

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The apply step waits for the service when a request names pulled work (plan-github-two-way.md, section 11); its live cases are
// in tools/check-issues.mjs (the stand-in GitHub). Here, as code: the step is async, the one write is awaited, nothing else
// is written with it, and the ordinary loop still writes the rest synchronously.
await test('the apply step awaits a write to pulled work, and writes nothing else with it', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
  const a = src.indexOf('async function carryOnServer(');
  const body = src.slice(a, src.indexOf('\n}\n', a));
  assert.ok(/const after = async \(\) => \{/.test(body), 'the apply step is async');
  assert.ok(/await issueWriteThrough\(ctx, via\.first\.key, via\.first\.value/.test(body), 'the write to pulled work is awaited');
  assert.ok(/for \(const w of via \? \[\] : outcome\.writes\) \{/.test(body), 'the ordinary loop writes none of it');
  assert.ok(/if \(via\.other\.length \|\| e\.links\.length/.test(body) && /error: issuesLib\.SAY\.oneAtATime/.test(body), 'a request with more than that one write or any effect is refused');
  assert.ok(/error: out\.error === SOMEONE_CHANGED \? ACTION_CHANGED : out\.error/.test(body), 'a change meanwhile is the runner\'s own sentence, GitHub\'s sentences are its own');
});

// Projects' addComment (plan-github-full-sync.md, section 8 and step 4): the handler checks and writes nothing; the apply step posts
// the comment through the person's rules (agentIssueComment: writing on, write_out, the limits, the rest), records it for Undo, and
// refuses a handler answer that writes anything or asks for any effect beside it. The live cases are in tools/check-issues.mjs.
await test('an agent\'s comment on an issue: the handler writes nothing, the server posts it with a person\'s rules and records it', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
  const a = src.indexOf('async function carryOnServer(');
  const body = src.slice(a, src.indexOf('\n}\n', a));
  const branch = body.slice(body.indexOf('def.name === ISSUE_COMMENT_ACTION'), body.indexOf('// Writes outside the space'));
  assert.ok(/if \(outcome\.writes\.length \|\| e\.links\.length \|\| e\.schedules\.length \|\| e\.notify\.length \|\| e\.phaseEnd\) return fault\('result'\);/.test(branch), 'a handler that writes or asks for an effect is a fault');
  assert.ok(/await agentIssueComment\(\{ ctx, space: here, found: now, input, agent, request \}\)/.test(branch), 'posted as the agent, after everything is asked again');
  assert.ok(body.indexOf('def.name === ISSUE_COMMENT_ACTION') < body.indexOf('const via = agentThrough('), 'before any write is made');
  const f = src.slice(src.indexOf('async function agentIssueComment('), src.indexOf('\nfunction agentThrough('));
  assert.ok(/const gate = issueWriteGate\(\{ rec, adapter, ctx, found \}, \['addComment'\]\);\n {2}if \(gate\) return gate;/.test(f), 'the gate of a person\'s comment: writing on, write_out, the limit, the rest');
  assert.ok(f.indexOf('issueWriteGate(') < f.indexOf('adapter.addComment('), 'checked before the request');
  assert.ok(/issuePulls\.addPosted\(space\.id, \{ id: c\.id, number, by: ctx\.by,/.test(f) && /change: 'commented'/.test(f), 'remembered as the agent\'s, and recorded for Undo');
  assert.ok(/text: issueText|const text = issueText\(input\.text\)/.test(f) && /adapter\.addComment\(\{ repo: a\.repo, number, text, token: a\.token \}/.test(f), 'the text as written, nothing of the agent');
  // A comment's text is never cut on its way: the route refuses one longer than a request keeps.
  assert.ok(src.includes("def.name === ISSUE_COMMENT_ACTION && typeof given.text === 'string'") && src.includes('.trim().length > ACTION_TEXT_MAX) {'), 'a longer comment is refused, never cut');
  // The handler both ways: it reads the carrier only to refuse on a page, which can't reach GitHub.
  const lib = fs.readFileSync(path.join(ROOT, 'modules', 'schedule', 'src', 'schedule-lib-actions.js'), 'utf8');
  const h = lib.slice(lib.indexOf('  addComment: (input, ctx) => {'), lib.indexOf('\n  },\n', lib.indexOf('  addComment: (input, ctx) => {')));
  assert.ok(/return \{ writes: \[\], ref: scRef\(ctx, e\.id\) \};/.test(h) && /ctx\.carrier !== 'server'/.test(h), 'it writes nothing and is refused on a page');
});

// --- a copy of the app whose modules/ also holds the fixture ------------------------------------------------------------
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-module-actions-'));
const app = path.join(base, 'app');
fs.mkdirSync(path.join(app, 'modules'), { recursive: true });
fs.cpSync(path.join(ROOT, 'server'), path.join(app, 'server'), { recursive: true });
for (const name of ['public', 'node_modules', 'package.json']) fs.symlinkSync(path.join(ROOT, name), path.join(app, name));
// The templates as shipped, but the travel template also offers the fixture and renames its `note` word, so a handler's phase
// names and ctx.util.label can be tried under a template with phases.
fs.cpSync(path.join(ROOT, 'templates'), path.join(app, 'templates'), { recursive: true });
{
  const file = path.join(app, 'templates', 'travel.json');
  const t = JSON.parse(fs.readFileSync(file, 'utf8'));
  t.modules['fixture-notes'] = { labels: { note: { one: 'log', many: 'logs' } } };
  t.modules['fixture-plain'] = {};
  fs.writeFileSync(file, JSON.stringify(t, null, 2));
}
// Every module this server ships (the templates name them), beside the fixture.
for (const id of fs.readdirSync(path.join(ROOT, 'modules'))) {
  if (fs.existsSync(path.join(ROOT, 'modules', id, 'module.json'))) fs.symlinkSync(path.join(ROOT, 'modules', id), path.join(app, 'modules', id));
}
fs.cpSync(FIXTURE, path.join(app, 'modules', 'fixture-notes'), { recursive: true });

const servers = [];
async function startServer(dataDir, env = {}) {
  const child = spawn(process.execPath, [path.join(app, 'server', 'index.js')], {
    cwd: app,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, TZ: 'UTC', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const server = { child, out: '', port: 0 };
  child.stdout.on('data', (d) => { server.out += d; });
  child.stderr.on('data', (d) => { server.out += d; });
  server.port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${server.out}`)); }, 30000);
    const onData = () => { const m = /listening on :(\d+)/.exec(server.out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${server.out}`)); });
  });
  server.stop = (signal = 'SIGTERM') => new Promise((resolve) => { if (child.exitCode !== null || child.signalCode !== null) return resolve(); child.once('exit', resolve); child.kill(signal); });
  servers.push(server);
  return server;
}

let server = null;
function call(method, urlPath, { body, cookie, token, raw, headers: extra } = {}) {
  const payload = raw !== undefined ? raw : body === undefined ? null : Buffer.from(JSON.stringify(body));
  const headers = { host: `127.0.0.1:${server.port}`, accept: 'application/json', ...(extra || {}) };
  if (payload) { headers['content-type'] = headers['content-type'] || 'application/json'; headers['content-length'] = payload.length; }
  if (cookie) headers.cookie = cookie;
  if (token) headers.authorization = `Bearer ${token}`;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.port, method, path: urlPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, json, text, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const cookieOf = (res) => [].concat(res.headers?.['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
async function signIn(login, password) {
  const payload = Buffer.from(JSON.stringify({ login, password }));
  const res = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.port, method: 'POST', path: '/api/login', headers: { host: `127.0.0.1:${server.port}`, 'content-type': 'application/json', 'content-length': payload.length } }, resolve);
    req.on('error', reject);
    req.end(payload);
  });
  res.resume();
  assert.equal(res.statusCode, 200, `${login} signs in`);
  return cookieOf(res);
}
const ok = (r, what, status = 200) => assert.equal(r.status, status, `${what}: ${r.status} ${r.text.slice(0, 400)}`);
const zipOf = (dir) => buildModule(dir).zip;
// A copy of the fixture's source with its manifest changed by `edit`, as a folder buildModule reads.
// A new id renames its files (src/<id>.html, src/<id>-lib*.js) and its server path to match.
function variant(name, edit) {
  const dir = path.join(base, 'variants', name);
  fs.cpSync(FIXTURE, dir, { recursive: true });
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'module.json'), 'utf8'));
  edit(m);
  if (m.id !== 'fixture-notes') {
    for (const f of fs.readdirSync(path.join(dir, 'src'))) {
      if (f.startsWith('fixture-notes')) fs.renameSync(path.join(dir, 'src', f), path.join(dir, 'src', f.replace('fixture-notes', m.id)));
    }
    if (m.actions.server) m.actions.server = m.actions.server.replace('fixture-notes', m.id);
  }
  fs.writeFileSync(path.join(dir, 'module.json'), JSON.stringify(m, null, 2));
  return dir;
}

// The fixture again, bundled under another id, with no hook, no approval to link to anything and no action that may move
// the main phase's end (the effects' refusals).
fs.cpSync(variant('plain', (m) => { m.id = 'fixture-plain'; m.name = 'Fixture plain'; delete m.hooks; m.refs.consumes = []; for (const a of m.actions.provides) delete a.phaseEnd; }), path.join(app, 'modules', 'fixture-plain'), { recursive: true });

// And again as a module with environment data: its notes carry space marks (`spaces`), a second kind (memo) carries none,
// it has a place search (the settings a geocoder needs) and two more actions: `find` (declares a lookup) and `shared`.
fs.cpSync(variant('shared', (m) => {
  m.id = 'fixture-shared'; m.name = 'Fixture shared'; delete m.hooks; m.refs.consumes = [];
  m.scope = ['space', 'environment'];
  m.surfaces.page = { entry: 'canvas.html' };
  m.refs.produces[0].summary.spaces = 'spaces';
  m.refs.produces.push({ kind: 'memo', name: 'Memo', key: 'memo:{id}', summary: { title: 'title' } });
  m.guards.keys.push({ key: 'memo:{id}' });
  m.settings.push({ key: 'searchProvider', label: 'Place search', type: 'choice', scope: 'environment', default: 'none', options: [{ value: 'none', label: 'None' }, { value: 'custom', label: 'My own address' }] });
  m.settings.push({ key: 'search', label: 'Search address', type: 'url', scope: 'environment', default: '' });
  m.settings.push({ key: 'saveResults', label: 'Save places', type: 'boolean', scope: 'environment', default: false });
  m.geocoder = { provider: 'searchProvider', address: 'search', save: 'saveResults', custom: 'custom', providers: {} };
  m.actions.provides.push({ name: 'find', label: 'Find', description: 'Write down the place search the server did.', effect: 'write', input: { address: 'string?', title: 'string?', notes: 'text?' }, lookups: { address: 'geocode' } });
  m.actions.provides.push({ name: 'shared', label: 'Shared', description: 'Write down the environment objects the handler may read.', effect: 'write', input: { key: 'string?', address: 'string?' } });
  // A pointer to its own objects (GitHub #1117): only one in this space or marked for it reaches the runner.
  m.actions.provides.push({ name: 'pointAt', label: 'Point at', description: 'Take a pointer to one of its own objects.', effect: 'write', input: { note: 'ref:fixture-shared:note?', memo: 'ref:fixture-shared:memo?' } });
}), path.join(app, 'modules', 'fixture-shared'), { recursive: true });

const dir = path.join(base, 'data');
const ENV = { ADMIN_PASSWORD: 'admin-password-1', AGENT_TOKENS: 'true' };
const busFile = () => JSON.parse(fs.readFileSync(path.join(dir, 'modules', 'bus.json'), 'utf8'));
const busIds = () => busFile().actions.map((a) => a.id);

try {
  // --- the declaration, and the runner's process, on their own ----------------------------------------------------------
  await test('actions.server: kept for a library of the module, refused for anything else', async () => {
    const { cleanManifest, readZip } = require(path.join(ROOT, 'server', 'modules.js'));
    const files = await readZip(zipOf(FIXTURE));
    const clean = (m) => cleanManifest(m, files);
    const raw = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'module.json'), 'utf8'));
    assert.equal(clean(structuredClone(raw)).actions.server, 'src/fixture-notes-lib-actions.js');
    for (const bad of ['src/other-lib-actions.js', 'src/fixture-notes.js', '../server/index.js', 'src/fixture-notes-lib-actions.mjs', 42]) {
      const m = structuredClone(raw);
      m.actions.server = bad;
      assert.throws(() => clean(m), /actions\.server must name one of the module's own libraries/, `refused: ${bad}`);
    }
  });

  await test('actions.pageOnly: the module\'s own library files the runner leaves out; refused for anything else', async () => {
    const { cleanManifest, readZip } = require(path.join(ROOT, 'server', 'modules.js'));
    const { libraryOf } = require(path.join(ROOT, 'server', 'module-build.js'));
    const files = await readZip(zipOf(FIXTURE));
    const raw = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'module.json'), 'utf8'));
    const withPageOnly = (list) => { const m = structuredClone(raw); m.actions.pageOnly = list; return () => cleanManifest(m, files); };
    assert.deepEqual(withPageOnly(['src/fixture-notes-lib-draw.js'])().actions.pageOnly, ['src/fixture-notes-lib-draw.js']);
    for (const bad of [['src/fixture-notes-lib-actions.js'], ['src/other-lib-draw.js'], ['../x.js'], 'src/fixture-notes-lib-draw.js', [42], Array.from({ length: 13 }, (_, i) => `src/fixture-notes-lib-x${i}.js`)]) {
      assert.throws(withPageOnly(bad), /actions\.pageOnly must list at most 12 of the module's own library files/, `refused: ${JSON.stringify(bad).slice(0, 60)}`);
    }
    // Maps: what the runner loads leaves the map's drawing code out, and every handler is still there.
    const maps = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'maps', 'module.json'), 'utf8'));
    const cut = libraryOf(path.join(ROOT, 'modules', 'maps'), 'maps', { leaveOut: maps.actions.pageOnly });
    assert.deepEqual(cut.files, ['src/maps-lib-actions.js', 'src/maps-lib-f-list-model.js']);
    assert.ok(cut.js.length < 200 * 1024, 'no map library in it');
    assert.ok(libraryOf(path.join(ROOT, 'modules', 'maps'), 'maps').files.includes('src/maps-lib-a-maplibre.js'), 'the page still gets every file');
  });

  await test('the runner\'s process reads no file and starts no process, whatever runs in it', async () => {
    const { MODULE_ACTION_RUN_FLAGS } = require(path.join(ROOT, 'server', 'module-actions.js'));
    const probe = path.join(base, 'probe.cjs');
    fs.writeFileSync(probe, "const out = {}; try { require('fs').readFileSync(process.argv[1]); out.read = 'self'; } catch (e) { out.read = e.code; } try { require('fs').readFileSync('/etc/hostname'); out.other = 'read'; } catch (e) { out.other = e.code; } try { require('fs').writeFileSync(require('os').tmpdir() + '/x', 'x'); out.write = 'wrote'; } catch (e) { out.write = e.code; } try { require('child_process').execFileSync(process.execPath, ['-e', '1']); out.spawn = 'ran'; } catch (e) { out.spawn = e.code; } try { new (require('worker_threads').Worker)('1', { eval: true }); out.worker = 'ran'; } catch (e) { out.worker = e.code; } out.env = Object.keys(process.env).length; out.eval = (() => { try { return eval('1'); } catch (e) { return 'blocked'; } })(); console.log(JSON.stringify(out));");
    const r = spawnSync(process.execPath, MODULE_ACTION_RUN_FLAGS(probe), { env: {}, encoding: 'utf8', cwd: os.tmpdir() });
    const out = JSON.parse(r.stdout.trim());
    assert.equal(out.read, 'self', 'it reads its own script');
    assert.equal(out.other, 'ERR_ACCESS_DENIED', 'no other file');
    assert.equal(out.write, 'ERR_ACCESS_DENIED', 'no write');
    assert.equal(out.spawn, 'ERR_ACCESS_DENIED', 'no process');
    assert.equal(out.worker, 'ERR_ACCESS_DENIED', 'no worker');
    assert.equal(out.env, 0, 'no environment variables');
    assert.equal(out.eval, 'blocked', 'no code from strings');
  });

  // --- the runner's process and the network (GitHub #1100; plan-agent-server-actions.md, step 9) ---------------------------
  const PROBE = path.join(ROOT, 'tools', 'fixtures', 'module-actions', 'network-probe.cjs');
  const PERMISSION = process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission' : '--experimental-permission';
  // A real server on 127.0.0.1 and a real unix socket, and the hostile script run against them: its outcomes, by name.
  const hostile = async (command, args) => {
    const hits = [];
    const web = http.createServer((req, res) => { hits.push(req.url); res.end('reached'); });
    const sock = path.join(base, `probe-${Date.now()}.sock`);
    const unix = (await import('node:net')).createServer((c) => { hits.push('unix'); c.end(); });
    await new Promise((r) => web.listen(0, '127.0.0.1', r));
    await new Promise((r) => unix.listen(sock, r));
    try {
      const child = spawn(command, [...args, String(web.address().port), sock], { env: {}, cwd: os.tmpdir(), stdio: ['pipe', 'pipe', 'pipe'] });
      let text = '';
      let errors = '';
      child.stdout.on('data', (d) => { text += d; });
      child.stderr.on('data', (d) => { errors += d; });
      child.stdin.end();
      await new Promise((r) => child.once('close', r));
      let out = null;
      try { out = JSON.parse(text.trim()); } catch { out = null; }
      assert.ok(out, `the probe answered: ${text.slice(0, 300)} ${errors.slice(0, 600)}`);
      return { out, hits };
    } finally {
      web.closeAllConnections();
      await new Promise((r) => web.close(r));
      await new Promise((r) => unix.close(r));
    }
  };
  const through = (out) => Object.entries(out).filter(([, v]) => v.startsWith('CONNECTED')).map(([k, v]) => `${k}: ${v}`);

  await test('the runner\'s process opens no socket: a hostile script with the runner\'s flags reaches nothing on 127.0.0.1', async () => {
    const { MODULE_ACTION_RUN_FLAGS } = require(path.join(ROOT, 'server', 'module-actions.js'));
    // The probe is real: with the permission model alone (the flags before this step) it connects, listens and looks up.
    const before = await hostile(process.execPath, ['--disallow-code-generation-from-strings', PERMISSION, `--allow-fs-read=${PROBE}`, PROBE]);
    for (const way of ['tcp', 'unix', 'listen', 'http', 'fetch', 'udp', 'lookup']) assert.ok(before.out[way].startsWith('CONNECTED'), `without the lockdown, ${way} gets through (${before.out[way]}): the probe tries what it says`);
    assert.ok(before.hits.length > 0, 'and the listening server saw it');
    // With the runner's flags, nothing does.
    const flags = MODULE_ACTION_RUN_FLAGS(PROBE);
    assert.ok(flags.includes('--require') && flags.some((f) => f.endsWith('module-actions-lockdown.js')), 'the runner\'s flags load the lockdown first');
    const now = await hostile(process.execPath, flags);
    assert.deepEqual(through(now.out), [], 'no way to a socket is left');
    assert.equal(Object.keys(now.out).length, Object.keys(before.out).length, 'every way was tried');
    assert.deepEqual(now.hits, [], 'the listening server saw nothing');
    for (const way of ['tcp', 'unix', 'listen', 'http', 'fetch', 'tls', 'http2', 'udp', 'udpBind', 'lookup', 'lookupPromise', 'resolver', 'inspector', 'signal', 'binding', 'worker', 'child', 'descriptor']) {
      assert.equal(now.out[way], 'stopped:ERR_ACCESS_DENIED', `${way} is refused outright`);
    }
    assert.equal(now.out.restore, 'stopped:fixed', 'a call taken away can\'t be put back');
  });

  await test('where the kernel gives a network namespace, it alone keeps every address out of reach', async () => {
    const { MODULE_ACTION_NETWORK_SEAL } = require(path.join(ROOT, 'server', 'module-actions.js'));
    const seal = MODULE_ACTION_NETWORK_SEAL();
    if (!seal) { console.log('check-module-actions: this machine gives no network namespace (unshare missing or not allowed); the kernel layer was not tried, the lockdown was.'); return; }
    // Without the lockdown, so only the namespace stands between the script and the server.
    const r = await hostile(seal.command, [...seal.args, process.execPath, '--disallow-code-generation-from-strings', PERMISSION, `--allow-fs-read=${PROBE}`, PROBE]);
    for (const way of ['tcp', 'http', 'fetch', 'tls', 'http2', 'udp']) assert.ok(r.out[way].startsWith('stopped:'), `${way} does not reach 127.0.0.1 from the namespace (${r.out[way]})`);
    assert.deepEqual(r.hits.filter((h) => h !== 'unix'), [], 'the listening server saw no request');
  });

  await test('a run uses a namespace where there is one; only `namespace` with a real one lets an uploaded module run', async () => {
    const { createModuleActions, MODULE_ACTION_NETWORK_SEAL } = require(path.join(ROOT, 'server', 'module-actions.js'));
    const real = MODULE_ACTION_NETWORK_SEAL();
    const message = { code: 'const ACTION_HANDLERS = { go: (input, ctx) => ({ writes: [{ key: "a", value: [ctx.read("k"), ctx.read("k", "environment"), ctx.list("", "environment").length] }] }) };', filename: 'x.js', action: 'go', inputText: '{}', ctxText: '{}', dataText: '{"k":1}', sharedText: '{"k":2}' };
    const expected = { result: { writes: [{ key: 'a', value: [1, 2, 1] }] } };
    // A stand-in for the kernel: the real seal where this machine has one, and none at all.
    const cases = [{ name: 'none', seal: null }, ...(real ? [{ name: 'real', seal: real }] : [])];
    for (const { name, seal } of cases) {
      for (const network of ['auto', 'namespace', 'nonsense']) {
        const runner = createModuleActions({ bundledDir: path.join(app, 'modules'), network, sealOf: () => seal });
        assert.equal(runner.network.namespace, Boolean(seal));
        const may = network === 'namespace' && Boolean(seal);
        assert.equal(runner.network.uploadedMayRun, may, `${name}/${network}: uploaded modules may run only with namespace and a real namespace`);
        const bundled = await runner.run(message);
        assert.deepEqual(JSON.parse(bundled.text), expected, `${name}/${network}: a bundled module's handler ran`);
        const uploaded = await runner.run({ ...message, uploaded: true, sha256: createHash('sha256').update(message.code).digest('hex') });
        if (may) assert.deepEqual(JSON.parse(uploaded.text), expected, `${name}/${network}: an uploaded module ran in the namespace`);
        else assert.deepEqual(uploaded, { fault: 'network' }, `${name}/${network}: an uploaded module is refused`);
      }
    }
    const line = (network, seal) => createModuleActions({ bundledDir: path.join(app, 'modules'), network, sealOf: () => seal }).network.line;
    assert.match(line('namespace', { command: process.execPath, args: [] }), /uploaded modules may run, with the admin's approval\.$/);
    assert.match(line('auto', null), /bundled modules run with the lockdown only; uploaded modules' actions are off, because ACTION_RUNNER_NETWORK is not namespace\.$/);
    assert.match(line('namespace', null), /uploaded modules' actions are off, because this server can't make a network namespace \(see the seccomp profile in deploy\/\)\.$/);
    assert.equal(createModuleActions({ bundledDir: path.join(app, 'modules'), network: 'nonsense' }).network.known, false, 'an unknown word is said, and read as auto');
  });

  await test('the slot share: at most 2 of the 4 running slots for uploaded modules, a third waits while bundled runs go on', async () => {
    const { createModuleActions, MODULE_ACTION_LIMITS } = require(path.join(ROOT, 'server', 'module-actions.js'));
    assert.deepEqual([MODULE_ACTION_LIMITS.running, MODULE_ACTION_LIMITS.uploadedRunning, MODULE_ACTION_LIMITS.queued, MODULE_ACTION_LIMITS.uploadedQueued], [4, 2, 16, 8]);
    // A stand-in worker that holds its slot for a while and answers, and a stand-in seal (env, which then runs node), so an
    // uploaded run may start here whatever this machine's kernel allows; the real namespace is tried on a live server below.
    const sleeper = path.join(base, 'sleeper.cjs');
    fs.writeFileSync(sleeper, "let t = ''; process.stdin.on('data', (d) => { t += d; }); process.stdin.on('end', () => setTimeout(() => process.stdout.write(JSON.stringify({ text: JSON.stringify({ result: { writes: [], data: JSON.parse(t).action } }) }) + '\\n'), 900));");
    const runner = createModuleActions({ bundledDir: path.join(app, 'modules'), workerFile: sleeper, network: 'namespace', sealOf: () => ({ command: '/usr/bin/env', args: [] }) });
    assert.equal(runner.network.uploadedMayRun, true);
    const code = 'const ACTION_HANDLERS = {};';
    const sha256 = createHash('sha256').update(code).digest('hex');
    const one = (action, uploaded) => runner.run({ code, filename: 'x.js', action, inputText: '{}', ctxText: '{}', dataText: '{}', uploaded, sha256: uploaded ? sha256 : null });
    const finished = [];
    const go = (action, uploaded) => one(action, uploaded).then((r) => { finished.push(action); return r; });
    const runs = [go('u1', true), go('u2', true), go('u3', true)];
    await sleep(250);
    assert.deepEqual(runner.load(), { running: 2, uploaded: 2, waiting: 1, waitingUploaded: 1 }, 'the third uploaded run waits');
    runs.push(go('b1', false), go('b2', false));
    await sleep(250);
    assert.deepEqual(runner.load(), { running: 4, uploaded: 2, waiting: 1, waitingUploaded: 1 }, 'bundled runs take the free slots past it');
    const out = await Promise.all(runs);
    for (const r of out) assert.ok(typeof r.text === 'string', `ran: ${JSON.stringify(r)}`);
    assert.equal(finished.at(-1), 'u3', 'the third uploaded run went last');
    assert.deepEqual(runner.load(), { running: 0, uploaded: 0, waiting: 0, waitingUploaded: 0 });
    // At most 8 uploaded runs wait: the next is busy at once, and a bundled run still gets a slot.
    const many = Array.from({ length: 11 }, (_, i) => one(`m${i}`, true));
    const busy = await Promise.race([many[10], sleep(500).then(() => 'still waiting')]);
    assert.deepEqual(busy, { fault: 'busy' }, 'the eleventh uploaded run is refused as busy');
    const bundled = one('b3', false);
    await sleep(250);
    assert.equal(runner.load().running, 3, 'a bundled run started beside the two uploaded ones');
    await Promise.all([...many, bundled]);
    // What runs is what was approved: an uploaded run whose code does not hash to the approved hash never starts.
    assert.deepEqual(await runner.run({ code: `${code} `, filename: 'x.js', action: 'a', inputText: '{}', ctxText: '{}', dataText: '{}', uploaded: true, sha256 }), { fault: 'approval' });
    assert.deepEqual(await runner.run({ code, filename: 'x.js', action: 'a', inputText: '{}', ctxText: '{}', dataText: '{}', uploaded: true }), { fault: 'approval' }, 'nor one with no hash');
  });

  await test('an action\'s lookups: kept for a string input of a module with a place search, refused otherwise', async () => {
    const { cleanManifest, readZip } = require(path.join(ROOT, 'server', 'modules.js'));
    const sharedDir = path.join(app, 'modules', 'fixture-shared');
    const files = await readZip(zipOf(sharedDir));
    const raw = JSON.parse(fs.readFileSync(path.join(sharedDir, 'module.json'), 'utf8'));
    const withFind = (edit) => { const m = structuredClone(raw); edit(m, m.actions.provides.find((a) => a.name === 'find')); return () => cleanManifest(m, files); };
    assert.deepEqual(withFind(() => {})().actions.provides.find((a) => a.name === 'find').lookups, { address: 'geocode' });
    assert.throws(withFind((m) => { delete m.geocoder; }), /action "find" looks up a place, so the module needs a "geocoder"/);
    assert.throws(withFind((m, a) => { a.lookups = { nowhere: 'geocode' }; }), /looks up "nowhere", which is not one of its inputs/);
    assert.throws(withFind((m, a) => { a.lookups = { address: 'fetch' }; }), /lookup for "address" must be "geocode"/);
    assert.throws(withFind((m, a) => { a.input.count = 'number?'; a.lookups = { count: 'geocode' }; }), /only a string or text input can be looked up/);
    assert.throws(withFind((m, a) => { a.lookups = ['address']; }), /lookups must be an object of input name to "geocode"/);
    assert.throws(withFind((m, a) => { a.lookups = { address: 'geocode', title: 'geocode', notes: 'geocode' }; }), /looks up more than 2 inputs/);
    assert.throws(withFind((m, a) => { a.local = true; delete a.effect; delete a.description; }), /is local, so it has no lookups/);
  });

  await test('effects on a page: the SDK\'s adapter takes the same answer, makes the same calls in order, and takes them back when one fails', async () => {
    const { onPage } = await import('./module-actions-harness.mjs');
    const { effectsOf } = require(path.join(ROOT, 'server', 'action-effects.js'));
    const own = (id) => ({ module: 'todo', kind: 'task', id, scope: 'space', space: 's1' });
    const other = { module: 'calendar', kind: 'event', id: 'e1', scope: 'space', space: 's1' };
    const answer = {
      writes: [{ key: 'task:t9', value: { title: 'New' } }],
      links: [{ add: { from: own('t9'), to: other } }, { remove: { from: own('t9'), to: own('t1') } }],
      schedules: [{ set: { key: 'remind:t9', at: 4102444800000, about: own('t9'), payload: { id: 't9' }, notify: { title: 'New', body: 'Due today' } } }, { cancel: { key: 'remind:t1' } }],
      notify: [{ title: 'A new task', body: 'New', about: own('t9') }],
    };
    const world = { space: { id: 's1', name: 'Camp' }, rows: { 'task:t1': { title: 'Old' } } };
    const calls = [];
    const page = await onPage('todo', 'go', {}, world, { handlers: { go: () => answer }, calls });
    assert.deepEqual(page.writes, [{ key: 'task:t9', value: { title: 'New' } }]);
    assert.deepEqual(page.effects, effectsOf(answer, { own: (r) => r.module === 'todo' && r.space === 's1' }), 'the page reads the answer exactly as the server does');
    assert.deepEqual(calls, [
      { call: 'setLinks', from: own('t9'), to: [other], kind: 'event', op: 'add' },
      { call: 'setLinks', from: own('t9'), to: [own('t1')], kind: 'task', op: 'remove' },
      { call: 'schedule', key: 'remind:t9', at: 4102444800000, ref: own('t9'), payload: { id: 't9' }, notify: { title: 'New', body: 'Due today' } },
      { call: 'cancelSchedule', key: 'remind:t1' },
      { call: 'notify', title: 'A new task', body: 'New' },
    ], 'links, then schedules, then the notice');
    // The notice refused: the links are taken back out, the schedule it set is cancelled and the write is put back.
    const failed = [];
    const refused = await onPage('todo', 'go', {}, { ...world, refuseEffect: (kind) => kind === 'notify' }, { handlers: { go: () => answer }, calls: failed });
    assert.deepEqual(refused, { refused: 'you may not do this' });
    assert.deepEqual(failed.slice(4).map((c) => [c.call, c.op || c.key]), [['cancelSchedule', 'remind:t9'], ['setLinks', 'add'], ['setLinks', 'remove']], 'undone, newest first');
    // The same caps and the same sentences as the runner's.
    const many = { links: [0, 1, 2, 3, 4, 5].map((i) => ({ add: { from: own('t1'), to: own(`x${i}`) } })) };
    assert.deepEqual(await onPage('todo', 'go', {}, world, { handlers: { go: () => many }, name: 'To-do' }), { refused: 'To-do could not carry that out: it tried to change more than 5 links at once.' });
    const notMine = { schedules: [{ set: { key: 'k', at: 1, about: other } }] };
    assert.deepEqual(await onPage('todo', 'go', {}, world, { handlers: { go: () => notMine }, name: 'To-do' }), { refused: 'To-do could not carry that out: it tried to set a reminder or send a notice about something that is not its own in this space.' });
    const extra = { notify: [{ title: 'x', as: 'admin' }] };
    assert.deepEqual(await onPage('todo', 'go', {}, world, { handlers: { go: () => extra }, name: 'To-do' }), { refused: 'To-do could not carry that out: it answered something the server can\'t use.' });
  });

  server = await startServer(dir, ENV);
  const admin = await signIn('admin', 'admin-password-1');
  ok(await call('PATCH', '/api/settings', { cookie: admin, body: { agents: true } }), 'Agents on');
  const mia = (await call('POST', '/api/users', { cookie: admin, body: { login: 'mia', password: 'mia-password-1', displayName: 'Mia', role: 'member' } })).json.user;
  // Several agents, each with its own 20 writes a minute: the main one, and one for each group of requests below.
  const agents = [];
  for (let i = 0; i < 14; i += 1) agents.push((await call('POST', '/api/users', { cookie: admin, body: { agent: true } })).json.user);
  const agent = agents[0];
  const camp = (await call('POST', '/api/spaces', { cookie: admin, body: { name: 'Camp', members: [...agents.map((a) => a.key), mia.key] } })).json.space.id;
  const fort = (await call('POST', '/api/spaces', { cookie: admin, body: { name: 'Fort', members: [mia.key] } })).json.space.id;
  // Another of the agents' own spaces, for a pointer into a space that is not the request's.
  const lodge = (await call('POST', '/api/spaces', { cookie: admin, body: { name: 'Lodge', members: [...agents.map((a) => a.key), mia.key] } })).json.space.id;
  for (const id of ['fixture-notes', 'todo', 'travel', 'calendar']) {
    ok(await call('POST', `/api/modules/bundled/${id}/install`, { cookie: admin, body: {} }), `${id} installs`, 201);
    ok(await call('PATCH', `/api/modules/${id}`, { cookie: admin, body: { enabled: true, allSpaces: true } }), `${id} on`);
  }
  const miaC = await signIn('mia', 'mia-password-1');
  const tokens = new Map();
  const newToken = async (a) => { tokens.set(a.key, (await call('POST', `/api/users/${a.key}/token`, { cookie: admin })).json.token); };
  for (const a of agents) await newToken(a);
  let as = agent; // whose token the next calls carry
  const T = () => ({ token: tokens.get(as.key) });
  const ask = (action, input, space = camp, by = T()) => call('POST', `/api/spaces/${space}/action`, { ...by, body: { action: `fixture-notes:${action}`, input } });
  const data = async (space = camp) => Object.fromEntries((await call('GET', `/api/modules/fixture-notes/data?scope=space&space=${space}`, { cookie: miaC })).json.items.map((i) => [i.key, i]));
  const used = async () => (await call('GET', '/api/agent/me', T())).json.limits;
  const probe = (what, extra = {}) => ask('probe', { what, ...extra });
  const faultSentence = (r, words, status = 500) => {
    ok(r, words, status);
    assert.equal(r.json.status, 'done');
    assert.equal(r.json.ok, false);
    assert.equal(r.json.error, `Fixture notes could not carry that out: ${words}.`);
  };

  let first = null;
  await test('an agent\'s request is done at once, as the agent, with its pointer, and counts as one write', async () => {
    const before = await used();
    const r = await ask('addNote', { title: '  First note  ' });
    ok(r, 'addNote');
    assert.equal(r.json.status, 'done');
    assert.equal(r.json.ok, true);
    assert.equal(r.json.note, 'Added.');
    const ref = r.json.ref;
    assert.deepEqual(Object.keys(ref).sort(), ['id', 'kind', 'module', 'scope', 'space']);
    assert.equal(ref.module, 'fixture-notes');
    assert.equal(ref.kind, 'note');
    assert.equal(ref.space, camp);
    const item = (await data())[`note:${ref.id}`];
    assert.ok(item, 'the note is stored');
    assert.equal(item.value.title, 'First note', 'the library\'s own rule (fixtureTitle) ran');
    assert.equal(item.value.byKey, agent.key, 'its maker is the agent');
    assert.equal(item.value.by, 'Claude', 'its credit is the agent\'s name');
    assert.equal(item.by, agent.key, 'the write is the agent\'s');
    const after = await used();
    assert.equal(after.writes.usedToday, before.writes.usedToday + 1, 'one write');
    const status = await call('GET', `/api/spaces/${camp}/action/${r.json.id}`, T());
    ok(status, 'request_status');
    assert.deepEqual(status.json, { id: r.json.id, status: 'done', ok: true, note: 'Added.', ref });
    const activity = (await call('GET', '/api/modules/activity', { cookie: admin })).json.activity;
    assert.ok(activity.some((a) => a.module === 'fixture-notes' && a.what === `saved note:${ref.id}` && a.by === agent.key && !a.carriedBy), 'the activity list names the agent');
    first = { id: r.json.id, ref };
  });

  await test('a second request reads it back and chains on its pointer', async () => {
    const renamed = await ask('renameNote', { note: first.ref, title: 'Renamed' });
    ok(renamed, 'renameNote');
    assert.equal(renamed.json.ok, true);
    assert.deepEqual(renamed.json.ref, first.ref);
    assert.equal((await data())[`note:${first.ref.id}`].value.title, 'Renamed');
    const linked = await ask('addNote', { title: 'Second', linkTo: first.ref });
    ok(linked, 'addNote linking');
    assert.deepEqual((await data())[`note:${linked.json.ref.id}`].value.linkTo, first.ref, 'the new note points at the first');
    const ids = busIds();
    const gone = await ask('renameNote', { note: { ...first.ref, id: 'missing1' }, title: 'X' });
    ok(gone, 'a pointer to nothing is refused by the bus before the runner', 404);
    assert.deepEqual(busIds(), ids);
  });

  await test('a request the server carried is never a page\'s: not offered, claim and complete refused', async () => {
    const before = (await data())[`note:${first.ref.id}`];
    const pending = await call('GET', `/api/bus/actions/pending?module=fixture-notes&scope=space&space=${camp}`, { cookie: miaC });
    ok(pending, 'pending');
    assert.ok(!pending.json.actions.some((a) => a.id === first.id), 'not offered');
    const claim = await call('POST', '/api/bus/actions/claim', { cookie: miaC, body: { module: 'fixture-notes', id: first.id, scope: 'space', space: camp } });
    assert.equal(claim.json.ok, false, 'claim refused');
    const complete = await call('POST', '/api/bus/actions/complete', { cookie: miaC, body: { module: 'fixture-notes', id: first.id, scope: 'space', space: camp, result: { ok: false, error: 'replayed' } } });
    assert.equal(complete.json.ok, false, 'complete refused');
    const status = await call('GET', `/api/spaces/${camp}/action/${first.id}`, T());
    assert.equal(status.json.ok, true, 'its result is unchanged');
    assert.equal((await data())[`note:${first.ref.id}`].version, before.version, 'nothing written again');
    const kept = busFile().actions.find((a) => a.id === first.id);
    assert.equal(kept.server, true);
    assert.equal(kept.status, 'done');
    assert.equal(kept.doneBy, '');
  });

  await test('the gate holds before the runner: no request is made', async () => {
    as = agents[1];
    const ids = busIds();
    const notIn = await ask('addNote', { title: 'Fort' }, fort);
    assert.ok(notIn.status === 403 || notIn.status === 404, `a space it is not in: ${notIn.status}`);
    assert.equal(Object.keys(await data(fort)).length, 0, 'nothing in Fort');
    for (const [action, input] of [['wipe', {}], ['show', { note: first.ref }], ['hidden', { title: 'x' }]]) {
      const r = await ask(action, input);
      ok(r, action, 403);
      assert.equal(r.json.error, "An agent can't ask for that.");
    }
    ok(await call('PATCH', '/api/roles/agent', { cookie: admin, body: { 'module.fixture-notes.edit': false } }), 'the write row off');
    const noRow = await ask('addNote', { title: 'No row' });
    ok(noRow, 'without the write row', 403);
    ok(await call('PATCH', '/api/roles/agent', { cookie: admin, body: { 'module.fixture-notes.edit': true } }), 'the write row back');
    assert.deepEqual(busIds(), ids, 'no request was made for any of them');
    assert.ok(!Object.keys(await data()).includes('probe:hidden') && !Object.keys(await data()).includes('probe:wiped'));
  });

  await test('every write is checked as the agent\'s: the guards refuse, nothing is written, a batch is whole or nothing', async () => {
    as = agents[1];
    const keys = Object.keys(await data()).sort();
    const asOther = await probe('asOther', { person: mia.key });
    assert.ok(asOther.status >= 400 && asOther.status < 500, `naming someone else: ${asOther.status} ${asOther.text}`);
    assert.equal(asOther.json.ok, false);
    assert.ok(asOther.json.error && !/could not carry that out/.test(asOther.json.error), 'the guards\' own sentence');
    const unknown = await probe('unknownKey');
    ok(unknown, 'a key the guards do not name', 400);
    const partial = await probe('partial');
    ok(partial, 'a batch with one refused write', 400);
    ok(await call('PUT', `/api/modules/fixture-notes/data/note:miasnote?scope=space&space=${camp}`, { cookie: miaC, body: { value: { title: 'Mia\'s' } } }), 'Mia adds a note');
    const theirs = await ask('renameNote', { note: { module: 'fixture-notes', kind: 'note', id: 'miasnote', scope: 'space', space: camp }, title: 'Taken' });
    assert.ok(theirs.status >= 400 && theirs.status < 500 && theirs.json.ok === false, `someone else's note: ${theirs.status}`);
    const now = await data();
    assert.equal(now['note:miasnote'].value.title, 'Mia\'s', 'Mia\'s note is unchanged');
    assert.deepEqual(Object.keys(now).filter((k) => k !== 'note:miasnote').sort(), keys, 'nothing else was written, the batch\'s first write put back');
  });

  await test('a handler can\'t escape its context', async () => {
    as = agents[2];
    const r = await probe('escape');
    ok(r, 'escape');
    const seen = (await data())['probe:escape'].value;
    for (const [k, v] of Object.entries(seen)) assert.ok(v === 'undefined' || v === 'blocked', `${k}: ${v}`);
    for (const k of ['require', 'process', 'module', 'fetch', 'setTimeout', 'console', 'WebAssembly', 'Atomics']) assert.equal(seen[k], 'undefined', k);
    for (const k of ['globalCtor', 'functionCtor', 'asyncCtor', 'Function', 'eval', 'readCtor', 'stackFrames', 'dynamicImport']) assert.equal(seen[k], 'blocked', k);
    ok(await probe('pollute'), 'pollute');
    ok(await probe('pollute'), 'pollute again');
    assert.equal((await data())['probe:pollute'].value.before, null, 'the next run starts clean');
    const me = await call('GET', '/api/agent/me', T());
    assert.ok(!me.text.includes('polluted'), 'the server is untouched');
  });

  await test('a handler reads only its own module\'s data in its own space', async () => {
    as = agents[2];
    ok(await call('PUT', `/api/modules/fixture-notes/data/note:fortsecret?scope=space&space=${fort}`, { cookie: miaC, body: { value: { title: 'Fort secret' } } }), 'a note in Fort');
    ok(await call('PUT', `/api/modules/todo/data/task:t1?scope=space&space=${camp}`, { cookie: miaC, body: { value: { id: 't1', title: 'A task' } } }), 'a task in Camp');
    ok(await probe('read'), 'read');
    const seen = (await data())['probe:read'].value;
    assert.equal(seen.task, null, 'no other module');
    assert.equal(seen.fort, null, 'no other space');
    assert.ok(seen.keys.length > 0 && seen.keys.every((k) => k.startsWith('note:') || k.startsWith('probe:')), 'only its own keys');
    assert.ok(!seen.keys.includes('note:fortsecret'));
    assert.deepEqual(seen.credit, { name: 'Claude', key: as.key }, 'credit is the agent');
    assert.equal(seen.byKey, as.key);
    assert.equal(seen.by, 'Claude');
  });

  await test('faults write nothing, say one sentence, and the server lives', async () => {
    as = agents[3];
    const keys = Object.keys(await data()).sort();
    const thrown = await probe('throw');
    ok(thrown, 'throw', 422);
    assert.equal(thrown.json.error, 'The fixture says no.');
    const status = await call('GET', `/api/spaces/${camp}/action/${thrown.json.id}`, T());
    assert.equal(status.json.error, 'The fixture says no.', 'request_status gives the refusal');
    let t = Date.now();
    faultSentence(await probe('loop'), 'it took too long');
    assert.ok(Date.now() - t < 6000, 'the loop was stopped in time');
    faultSentence(await probe('microloop'), 'it took too long');
    faultSentence(await probe('throwProxy'), 'it took too long');
    t = Date.now();
    faultSentence(await probe('hog'), 'it used too much memory');
    assert.ok(Date.now() - t < 6000, 'the allocation was stopped in time');
    as = agents[4];
    faultSentence(await probe('notJson'), 'it answered something the server can\'t use');
    faultSentence(await probe('extraField'), 'it answered something the server can\'t use');
    faultSentence(await probe('big'), 'it answered more than the server takes');
    faultSentence(await probe('tooMany'), 'it tried to change more than 10 things at once');
    faultSentence(await probe('elsewhere'), 'it tried to write outside its own data in this space');
    faultSentence(await probe('elsewhereSpace', { person: fort }), 'it tried to write outside its own data in this space');
    faultSentence(await probe('badRef'), 'it pointed at something that is not its own in this space');
    faultSentence(await probe('otherSpaceRef', { person: fort }), 'it pointed at something that is not its own in this space');
    faultSentence(await probe('delete'), 'it tried to delete something, which needs a person\'s approval');
    faultSentence(await ask('noCode', {}), 'it has no server code for that action');
    const nothing = await probe('nothing');
    ok(nothing, 'a handler that changes nothing');
    assert.equal(nothing.json.ok, true);
    assert.deepEqual(Object.keys(await data()).sort(), keys, 'nothing was written by any of them');
    assert.equal(Object.keys(await data(fort)).filter((k) => k !== 'note:fortsecret').length, 0, 'nothing in Fort');
    ok(await call('GET', '/api/agent/me', T()), 'the server still answers');
  });

  await test('input over the size cap is 413 and makes no request', async () => {
    as = agents[5];
    const ids = busIds();
    const big = 'y'.repeat(7999);
    const r = await probe('nothing', { b1: big, b2: big, b3: big, b4: big, b5: big, b6: big, b7: big, b8: big, b9: big });
    // The app's own body limit (64 KB) refuses it first; the runner's cap (MODULE_ACTION_LIMITS.inputBytes) is the same size
    // behind it, so either sentence is right here.
    ok(r, 'too large', 413);
    assert.ok(['that request is over 64 KB', 'That request is too large for Fixture notes to carry out.'].includes(r.json.error), r.json.error);
    assert.deepEqual(busIds(), ids);
  });

  await test('a change made while the handler ran is not overwritten', async () => {
    as = agents[5];
    const asked = ask('slowRename', { note: first.ref, title: 'Slow', ms: 900 });
    await sleep(300);
    const current = (await data())[`note:${first.ref.id}`];
    ok(await call('PUT', `/api/modules/fixture-notes/data/note:${first.ref.id}?scope=space&space=${camp}`, { cookie: admin, body: { value: { ...current.value, title: 'By the admin' }, version: current.version } }), 'the admin changes it meanwhile');
    const r = await asked;
    ok(r, 'the slow rename', 409);
    assert.equal(r.json.error, CHANGED);
    assert.equal((await data())[`note:${first.ref.id}`].value.title, 'By the admin');
  });

  await test('a request ended while it ran (Revoke) writes nothing', async () => {
    as = agent;
    const asked = ask('slowRename', { note: first.ref, title: 'After revoke', ms: 900 });
    await sleep(300);
    ok(await call('DELETE', `/api/users/${as.key}/token`, { cookie: admin }), 'Revoke');
    const r = await asked;
    assert.equal(r.json.ok, false, `ended: ${r.status} ${r.text}`);
    assert.equal(r.json.error, ENDED);
    assert.equal((await data())[`note:${first.ref.id}`].value.title, 'By the admin');
    await newToken(as);
  });

  await test('MCP: no wait_for_result (nothing waits for a page), ask_for_change on the fixture is done at once', async () => {
    as = agents[6];
    const rpc = (method, params) => call('POST', '/mcp', { ...T(), body: { jsonrpc: '2.0', id: 1, method, params } });
    const tools = (await rpc('tools/list', {})).json.result.tools;
    assert.equal(tools.find((t) => t.name === 'wait_for_result'), undefined, 'not listed');
    const r = await rpc('tools/call', { name: 'ask_for_change', arguments: { space: camp, action: 'fixture-notes:addNote', input: { title: 'By MCP' } } });
    const out = JSON.parse(r.json.result.content[0].text);
    assert.equal(out.status, 'done');
    assert.equal(out.ok, true);
    assert.equal(out.ref.kind, 'note');
    const gone = await rpc('tools/call', { name: 'wait_for_result', arguments: { space: camp, request: out.id, seconds: 5 } });
    assert.ok(gone.json.error || gone.json.result?.isError, 'wait_for_result is no tool');
    const noRoute = await call('GET', `/api/spaces/${camp}/action/${out.id}/wait?seconds=1`, T());
    ok(noRoute, 'and no route for an agent', 403);
    assert.equal(noRoute.json.error, 'An agent can\'t do that.');
    const list = JSON.parse((await rpc('tools/call', { name: 'list_actions', arguments: { space: camp } })).json.result.content[0].text).actions;
    assert.equal(list.find((a) => a.action === 'fixture-notes:addNote').now, true, 'list_actions says now');
    assert.equal(list.find((a) => a.action === 'fixture-notes:addNote').waiting, undefined);
    assert.equal(list.find((a) => a.action === 'fixture-notes:addNote').why, undefined);
  });

  // --- the richer ctx: the SDK's helpers, the facts, the refs (step 1b) --------------------------------------------------
  await test('ctx.util is the SDK\'s own helpers, frozen, and none of them is a way out', async () => {
    as = agents[7];
    ok(await probe('escapeUtil'), 'escapeUtil');
    const seen = (await data())['probe:escapeUtil'].value;
    assert.equal(seen.frozen, 'frozen');
    for (const k of ['replaced', 'added', 'swapped']) assert.equal(seen[k], 'kept', k);
    assert.equal(seen.keys, 'detailLines,geo,id,label,localWhen,objectKey,order,parseYmd,plain,rollup,time,word,ymd');
    for (const k of ['window', 'document', 'hostActions', 'hostText', 'createHost', 'hostColour', 'locale']) assert.equal(seen[k], 'undefined', `no ${k}: the rest of the SDK is gone`);
    for (const k of ['plainCtor', 'wordCtor', 'ymdCtor', 'localWhenProto', 'stackFrames']) assert.equal(seen[k], 'blocked', k);
    assert.equal(seen.word, 'Spaces', 'the environment\'s words');
    assert.equal(seen.time, '10:30 PM', 'the environment\'s clock (12-hour)');
    assert.equal(seen.plain, 'Bold');
    assert.equal(seen.sameYmd, 'same', 'ymd and parseYmd beside the library are the SDK\'s');
    ok(await call('PATCH', '/api/settings', { cookie: admin, body: { clock: '24' } }), 'a 24-hour clock');
    ok(await probe('escapeUtil'), 'escapeUtil again');
    assert.equal((await data())['probe:escapeUtil'].value.time, '22:30', 'time follows the environment\'s clock');
    ok(await call('PATCH', '/api/settings', { cookie: admin, body: { clock: '12' } }), 'back to 12-hour');
  });

  await test('the facts: the space, its people, and refs only for the input\'s pointers, as the agent may see them', async () => {
    as = agents[7];
    const lodgeNote = await call('PUT', `/api/modules/fixture-notes/data/note:lodgenote?scope=space&space=${lodge}`, { cookie: miaC, body: { value: { title: 'In the lodge' } } });
    ok(lodgeNote, 'a note in Lodge');
    const own = { module: 'fixture-notes', kind: 'note', id: first.ref.id, scope: 'space', space: camp };
    const elsewhere = { module: 'fixture-notes', kind: 'note', id: 'lodgenote', scope: 'space', space: lodge };
    const task = { module: 'todo', kind: 'task', id: 't1', scope: 'space', space: camp };
    const r = await ask('facts', { own, elsewhere, other: task, cleared: '', count: '', kept: '' });
    ok(r, 'facts');
    assert.equal(r.json.ok, true, r.text);
    const f = (await data())['probe:facts'].value;
    assert.equal(f.carrier, 'server');
    assert.equal(f.tz, 'UTC');
    assert.deepEqual(f.keys, ['action', 'by', 'byKey', 'carrier', 'credit', 'from', 'list', 'now', 'people', 'read', 'refs', 'settings', 'space', 'tz', 'util']);
    assert.deepEqual(Object.keys(f.space).sort(), ['bands', 'currency', 'defaultCurrency', 'id', 'name', 'phases']);
    assert.deepEqual([f.space.id, f.space.name, f.space.currency, f.space.defaultCurrency], [camp, 'Camp', '', 'USD']);
    assert.ok(Array.isArray(f.space.phases) && Array.isArray(f.space.bands));
    assert.ok(f.people.some((p) => p.key === mia.key && p.name === 'Mia'), 'the space\'s people, by name');
    assert.ok(f.people.every((p) => Object.keys(p).sort().join() === 'key,name'), 'nothing else of a person');
    assert.ok(!f.people.some((p) => p.key === 'admin'), 'only the space\'s members');
    const key = (ref) => [ref.module, ref.kind, ref.id, ref.scope, ref.space || ''].join('|');
    assert.deepEqual(Object.keys(f.refs).sort(), [key(own), key(elsewhere), key(task)].sort(), 'only the input\'s pointers');
    assert.deepEqual(f.refs[key(own)], { title: 'By the admin', subtitle: '', kind: 'note' }, 'its own note, as the agent sees it');
    assert.deepEqual(f.refs[key(elsewhere)], { error: 'unavailable' }, 'a pointer into another space resolves to nothing');
    assert.deepEqual(f.refs[key(task)], { error: 'hidden' }, 'what the module may not link to resolves to nothing');
    assert.deepEqual(f.input, { own, elsewhere, other: task, cleared: '', count: '' }, '"" kept for an input the action clears, left out for one it does not');
  });

  await test('busInput: an input that clears keeps "", every other refusal stands', async () => {
    as = agents[7];
    const needed = await ask('addNote', { title: '' });
    ok(needed, 'a required input sent as ""', 400);
    assert.equal(needed.json.error, 'title is needed');
    const spaces = await ask('facts', { cleared: '   ', kept: '   ' });
    ok(spaces, 'only spaces');
    assert.deepEqual((await data())['probe:facts'].value.input, { cleared: '' }, 'only spaces clears where the action clears, else is left out');
    const typed = await ask('facts', { count: 'many' });
    ok(typed, 'a number that is not one', 400);
    assert.equal(typed.json.error, 'count must be a number');
    const list = (await call('GET', `/api/spaces/${camp}/actions`, T())).json.actions;
    assert.deepEqual(list.find((a) => a.action === 'fixture-notes:facts').clears, ['cleared', 'count'], 'list_actions says what clears');
    assert.equal(list.find((a) => a.action === 'travel:updatePlan').patch, true, 'and which object is a patch');
    assert.deepEqual(list.find((a) => a.action === 'calendar:updateEvent').clears, ['endTime', 'endDate', 'repeat', 'remind', 'notes']);
    for (const name of ['travel:acceptSuggestion', 'travel:updatePlan', 'calendar:createEvent', 'calendar:updateEvent']) assert.equal(list.find((a) => a.action === name).now, true, `${name}: carried now`);
  });

  // --- the context's settings, label, order, rollup, geo and phase names; data back; pointer clears (plan-agent-server-actions.md, steps 1 and 2)
  await test('ctx.settings are the module\'s as GET settings/values answers them, each person setting at its default', async () => {
    as = agents[11];
    ok(await call('PUT', `/api/modules/fixture-notes/settings/space?space=${camp}`, { cookie: admin, body: { values: { greeting: 'Ahoy' } } }), 'the space\'s greeting');
    ok(await call('PUT', '/api/modules/fixture-notes/settings/environment', { cookie: admin, body: { values: { tone: 'warm' } } }), 'the environment\'s tone');
    ok(await call('PUT', `/api/modules/fixture-notes/settings/person?space=${camp}`, { cookie: miaC, body: { values: { mine: false } } }), 'Mia\'s own');
    const r = await ask('helpers', {});
    ok(r, 'helpers');
    const h = (await data())['probe:helpers'].value;
    assert.deepEqual(h.settings, { tone: 'warm', greeting: 'Ahoy', mine: true }, 'the environment\'s and the space\'s values, a person setting\'s default');
    // The route a page reads them from, for someone with no person setting of their own (the admin): the same values.
    const page = await call('GET', `/api/modules/fixture-notes/settings/values?scope=space&space=${camp}`, { cookie: admin });
    ok(page, 'settings/values');
    assert.deepEqual(page.json.values, h.settings, 'the route and the runner answer the same (one function)');
    const other = await ask('helpers', {}, lodge);
    ok(other, 'helpers in Lodge');
    assert.deepEqual((await data(lodge))['probe:helpers'].value.settings, { tone: 'warm', greeting: 'Hello', mine: true }, 'another space\'s own (the default)');
  });

  await test('ctx.util gains label, order, rollup and geo, pure and frozen; ctx.space.phases carry their labels', async () => {
    as = agents[11];
    const h = (await data())['probe:helpers'].value;
    assert.equal(h.keys, 'detailLines,geo,id,label,localWhen,objectKey,order,parseYmd,plain,rollup,time,word,ymd');
    assert.equal(h.label, 'Jottings', 'the module\'s own word, as the manifest names it');
    assert.equal(h.labelA, 'a jotting');
    assert.equal(h.labelUnknown, 'thing', 'a key it does not declare answers the fallback');
    assert.ok(/^[0-9A-Za-z]+$/.test(h.order[0]) && h.order[1] > h.order[0] && h.order[2] === 'before', `order: ${h.order}`);
    assert.equal(h.orderBad, 'blocked', 'a before that does not sort first throws, as on a page');
    assert.deepEqual(h.rollup, { a: { done: 2, total: 2 }, c: { done: 1, total: 1 } });
    assert.deepEqual(h.rollupBy, { a: { done: 0, total: 2 }, c: { done: 0, total: 1 } });
    assert.deepEqual(h.point, { lat: 38.7075, lng: -9.1364 });
    assert.equal(h.coords, '38.70750, -9.13640');
    assert.equal(h.link, 'https://www.openstreetmap.org/?mlat=38.7&mlon=-9.1#map=17/38.7/-9.1', 'no navigator: the ordinary web link');
    assert.equal(h.navigator, 'undefined');
    assert.equal(h.geoFrozen, 'frozen');
    assert.equal(h.geoKept, 'kept');
    for (const k of ['geoCtor', 'orderCtor']) assert.equal(h[k], 'blocked', `${k}: no code from strings through a helper`);
    assert.deepEqual(h.phases, [], 'no template phases: none');
    // A template with phases: each carries its label, as the space shows it.
    ok(await call('PATCH', '/api/settings', { cookie: admin, body: { template: 'travel' } }), 'the travel template');
    try {
      const shown = (await call('GET', '/api/branding')).json.phases;
      ok(await ask('helpers', {}), 'helpers under travel');
      const phases = (await data())['probe:helpers'].value.phases;
      assert.ok(phases.length > 0, 'the travel template has phases');
      assert.deepEqual(phases, shown.map((p) => ({ id: p.id, label: p.label, main: Boolean(p.main) })), '{ id, label, main } for each, in order');
      assert.equal((await data())['probe:helpers'].value.label, 'Logs', 'label follows the template\'s renaming');
    } finally {
      ok(await call('PATCH', '/api/settings', { cookie: admin, body: { template: 'default' } }), 'back to the default template');
    }
  });

  await test('a handler\'s data reaches the agent: the answer, request_status and MCP', async () => {
    as = agents[13];
    // `data.note` is the answer's `note`; the rest of the handler's data comes as `data`.
    const want = { count: 3, list: ['a', 'b'], nested: { ok: true } };
    const r = await ask('answerData', {});
    ok(r, 'answerData');
    assert.deepEqual(r.json, { id: r.json.id, status: 'done', ok: true, note: 'Here it is.', data: want });
    const status = await call('GET', `/api/spaces/${camp}/action/${r.json.id}`, T());
    assert.deepEqual(status.json, { id: r.json.id, status: 'done', ok: true, note: 'Here it is.', data: want }, 'request_status');
    const rpc = (method, params) => call('POST', '/mcp', { ...T(), body: { jsonrpc: '2.0', id: 1, method, params } });
    const viaMcp = JSON.parse((await rpc('tools/call', { name: 'ask_for_change', arguments: { space: camp, action: 'fixture-notes:answerData', input: {} } })).json.result.content[0].text);
    assert.deepEqual(viaMcp.data, want, 'ask_for_change');
    const mcpStatus = JSON.parse((await rpc('tools/call', { name: 'request_status', arguments: { space: camp, request: viaMcp.id } })).json.result.content[0].text);
    assert.deepEqual(mcpStatus.data, want, 'request_status through MCP');
    faultSentence(await ask('answerData', { big: true }), 'it answered more than the server takes');
    const failed = await probe('throw');
    assert.equal(failed.json.data, undefined, 'a refusal carries no data');
    const noteOnly = await ask('addNote', { title: 'Note only' });
    assert.equal(noteOnly.json.note, 'Added.');
    assert.equal(noteOnly.json.data, undefined, 'data that is only the note is not repeated');
    // A person's own request reads only the outcome, as it did: no data.
    const mine = await call('POST', `/api/spaces/${camp}/action`, { cookie: miaC, body: { action: 'fixture-notes:answerData', input: {} } });
    ok(mine, 'Mia asks');
    assert.equal(mine.json.data, undefined, 'a person\'s request waits for a page and answers no data');
  });

  await test('a pointer input can be cleared: ref in clears, the bus and the gate keep "" and the handler clears it', async () => {
    as = agents[12];
    const { cleanManifest, readZip } = require(path.join(ROOT, 'server', 'modules.js'));
    const files = await readZip(zipOf(FIXTURE));
    const raw = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'module.json'), 'utf8'));
    assert.deepEqual(cleanManifest(structuredClone(raw), files).actions.provides.find((a) => a.name === 'setLink').clears, ['linkTo', 'body'], 'a ref:<module>:<kind>? input may be cleared');
    const plainRef = structuredClone(raw);
    plainRef.actions.provides.find((a) => a.name === 'facts').clears.push('other');
    assert.deepEqual(cleanManifest(plainRef, files).actions.provides.find((a) => a.name === 'facts').clears, ['cleared', 'count', 'other'], 'a plain ref? input may be cleared');
    const notThat = structuredClone(raw);
    notThat.actions.provides.find((a) => a.name === 'answerData').clears = ['big'];
    assert.throws(() => cleanManifest(notThat, files), /clears "big"; only string, text, number, date, ref inputs can be cleared/);
    const target = (await ask('addNote', { title: 'Target' })).json.ref;
    const holder = (await ask('addNote', { title: 'Holder', linkTo: target, body: 'Some words' })).json.ref;
    assert.deepEqual((await data())[`note:${holder.id}`].value.linkTo, target);
    const cleared = await ask('setLink', { note: holder, linkTo: '', body: '' });
    ok(cleared, 'setLink with ""');
    assert.equal(cleared.json.ok, true, cleared.text);
    assert.equal(cleared.json.note, 'Unlinked.');
    assert.deepEqual(cleared.json.data, { cleared: true });
    const after = (await data())[`note:${holder.id}`].value;
    assert.equal(after.linkTo, undefined, 'the pointer is cleared');
    assert.equal(after.body, undefined, 'and the text');
    const kept = await ask('setLink', { note: holder, linkTo: target });
    ok(kept, 'setLink back');
    assert.deepEqual((await data())[`note:${holder.id}`].value.linkTo, target);
    const left = await ask('setLink', { note: holder });
    ok(left, 'left out');
    assert.deepEqual((await data())[`note:${holder.id}`].value.linkTo, target, 'a pointer left out is kept');
    // The gate still checks a pointer that is given: one into a space that is not the agent's is refused.
    const fortRef = { module: 'fixture-notes', kind: 'note', id: 'fortsecret', scope: 'space', space: fort };
    const outside = await ask('setLink', { note: holder, linkTo: fortRef });
    assert.ok(outside.status === 403 || outside.status === 404, `a pointer outside: ${outside.status}`);
    // A ref the action does not clear: "" is no value, and a required one is still needed.
    const notCleared = await ask('renameNote', { note: '', title: 'X' });
    ok(notCleared, 'a required pointer sent as ""', 400);
    assert.equal(notCleared.json.error, 'note is needed');
    assert.deepEqual((await call('GET', `/api/spaces/${camp}/actions`, T())).json.actions.find((a) => a.action === 'fixture-notes:setLink').clears, ['linkTo', 'body'], 'list_actions says so');
  });

  await test('the in-app AI keeps "" for a declared clear (checkToolInput), and drops it for any other', async () => {
    const { cleanManifest, readZip } = require(path.join(ROOT, 'server', 'modules.js'));
    const { buildCatalog, checkToolInput } = require(path.join(ROOT, 'server', 'action-catalog.js'));
    const files = await readZip(zipOf(FIXTURE));
    const m = cleanManifest(JSON.parse(fs.readFileSync(path.join(FIXTURE, 'module.json'), 'utf8')), files);
    const tool = buildCatalog([m]).tools.find((t) => t.name === 'fixture-notes__setLink');
    assert.ok(tool, 'setLink is a tool');
    assert.deepEqual(tool.clears, ['linkTo', 'body']);
    assert.equal(tool.schema.properties.body.minLength, undefined, 'a cleared text may be ""');
    assert.match(tool.schema.properties.body.description, /Send "" to clear it\./);
    assert.deepEqual([].concat(tool.schema.properties.linkTo.type), ['integer', 'null'], 'a pointer keeps its one real type');
    assert.deepEqual(checkToolInput(tool, { note: 1, linkTo: null, body: '' }), { ok: true, input: { note: 1, body: '' } }, '"" kept for a declared clear');
    assert.deepEqual(checkToolInput(tool, { note: 1, linkTo: '', body: '  ' }), { ok: true, input: { note: 1, linkTo: '', body: '' } }, 'a pointer too, and only spaces is ""');
    assert.deepEqual(checkToolInput(tool, { note: 1, linkTo: null, body: null }), { ok: true, input: { note: 1 } }, 'null is still left out');
    const add = buildCatalog([m]).tools.find((t) => t.name === 'fixture-notes__renameNote');
    assert.deepEqual(add.clears, []);
    assert.equal(checkToolInput(add, { note: '', title: 'X' }).ok, false, 'a required pointer is never cleared');
  });

  // --- the Itinerary and the Calendar, carried by the server ------------------------------------------------------------
  const travelData = async () => Object.fromEntries((await call('GET', `/api/modules/travel/data?scope=space&space=${camp}`, { cookie: admin })).json.items.map((i) => [i.key, i]));
  const calData = async () => Object.fromEntries((await call('GET', `/api/modules/calendar/data?scope=space&space=${camp}`, { cookie: admin })).json.items.map((i) => [i.key, i]));
  const askIn = (action, input) => call('POST', `/api/spaces/${camp}/action`, { ...T(), body: { action, input } });
  const schedules = () => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'modules', 'schedules.json'), 'utf8')); } catch { return []; } };
  let flight = null;
  await test('Itinerary: an agent\'s acceptSuggestion with a full flight is done at once, every field typed, as the page does it', async () => {
    as = agents[8];
    const object = { kind: 'flight', title: 'Home', details: { airline: 'United', number: 'UA945', from: { code: 'LIS', name: 'Lisbon' }, to: { code: 'EWR', name: 'Newark' }, departs: '2026-10-03T11:05', arrives: '2026-10-03T14:20', terminal: '1', gate: '14', seat: '22C, 22D', class: 'Economy', reference: 'QX7Y2', cost: 412.8, travellers: ['Mia', 'Cy'] } };
    const r = await askIn('travel:acceptSuggestion', { title: 'Home', object });
    ok(r, 'acceptSuggestion');
    assert.equal(r.json.status, 'done');
    assert.equal(r.json.ok, true);
    assert.deepEqual(Object.keys(r.json.ref).sort(), ['id', 'kind', 'module', 'scope', 'space']);
    assert.deepEqual([r.json.ref.module, r.json.ref.kind, r.json.ref.space], ['travel', 'plan', camp]);
    const item = (await travelData())[`plan:${r.json.ref.id}`];
    assert.ok(item, 'stored');
    const v = item.value;
    // The module test's expectations (modules/travel/test/check-travel-actions.mjs), with this space's people.
    assert.deepEqual([v.kind, v.mode, v.operator, v.number, v.fromCode, v.from, v.toCode, v.to, v.date, v.time, v.arrives, v.terminal, v.gate, v.seat, v.travelClass, v.confirm, v.estimate, v.owners],
      ['journey', 'flight', 'United', 'UA945', 'LIS', 'Lisbon', 'EWR', 'Newark', '2026-10-03', '11:05', '2026-10-03T14:20', '1', '14', '22C, 22D', 'Economy', 'QX7Y2', 412.8, [mia.key]]);
    assert.equal(v.notes, 'Travellers: Cy', 'a traveller who is not one of the people is a notes line');
    assert.equal(v.by, 'Claude', 'credited to the agent');
    assert.equal(item.by, as.key, 'the write is the agent\'s');
    flight = r.json.ref;
  });

  await test('Itinerary: updatePlan with an object patch changes only the gate and the terminal', async () => {
    as = agents[8];
    const before = (await travelData())[`plan:${flight.id}`].value;
    const r = await askIn('travel:updatePlan', { entry: flight, object: { kind: 'flight', details: { gate: 'B12', terminal: '2' } } });
    ok(r, 'updatePlan');
    assert.equal(r.json.ok, true);
    assert.deepEqual(r.json.ref, flight);
    const after = (await travelData())[`plan:${flight.id}`].value;
    assert.deepEqual([after.gate, after.terminal], ['B12', '2']);
    for (const k of Object.keys(before)) if (!['gate', 'terminal'].includes(k)) assert.deepEqual(after[k], before[k], k);
    const noKind = await askIn('travel:updatePlan', { entry: flight, object: { details: { gate: 'C1' } } });
    ok(noKind, 'a patch with details and no kind', 400);
    assert.equal(noKind.json.error, 'object changes details, so it needs its kind, such as "flight"');
    const titleOnly = await askIn('travel:updatePlan', { entry: flight, object: { title: 'Home, United' } });
    ok(titleOnly, 'a patch with a title and no kind');
    assert.equal((await travelData())[`plan:${flight.id}`].value.title, 'Home, United');
    const notTaken = await askIn('travel:updatePlan', { entry: flight, object: { kind: 'task', details: { due: '2026-10-03' } } });
    ok(notTaken, 'a patch of a kind the action does not take', 400);
    const whole = await askIn('travel:acceptSuggestion', { title: 'X', object: { kind: 'flight', details: { gate: 'C1' } } });
    ok(whole, 'an object that is not a patch still needs its title', 400);
    assert.equal(whole.json.error, 'object needs a title, and content or details');
    const cleared = await askIn('travel:updatePlan', { entry: flight, notes: '', time: '' });
    ok(cleared, 'notes and time cleared');
    const v = (await travelData())[`plan:${flight.id}`].value;
    assert.deepEqual([v.notes, v.time, v.gate], ['', null, 'B12']);
  });

  let event = null;
  // A day within the year ahead the host schedules (server/module-hooks.js), and how the answer names it (the server's zone, UTC).
  const calDay = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const calSays = (() => {
    const d = new Date(`${calDay}T00:00:00Z`);
    return `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()]} ${d.getUTCDate()} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getUTCMonth()]}`;
  })();
  const calRemind = () => schedules().find((x) => x.module === 'calendar' && x.key === `remind:${event.id}`);
  await test('Calendar: an agent\'s createEvent with a 90 minute reminder and notes is done at once, its reminder set by the server', async () => {
    as = agents[9];
    const r = await askIn('calendar:createEvent', { title: 'Car', date: calDay, time: '10:00', endTime: '11:30', remind: 90, notes: 'Pick up at the airport' });
    ok(r, 'createEvent');
    assert.equal(r.json.ok, true);
    assert.equal(r.json.note, `The reminder is for ${calSays}, 8:30 AM, 90 minutes before it starts.`);
    event = r.json.ref;
    assert.deepEqual([event.module, event.kind, event.space], ['calendar', 'event', camp]);
    const v = (await calData())[`event:${event.id}`].value;
    // The module test's expectations (modules/calendar/test/check-calendar-actions.mjs), read in the server's zone (UTC here).
    assert.deepEqual(v, { id: event.id, title: 'Car', allDay: false, start: `${calDay}T10:00:00.000Z`, end: `${calDay}T11:30:00.000Z`, desc: 'Pick up at the airport', remind: 90, repeat: null, by: 'Claude' });
    const s = calRemind();
    assert.ok(s, 'the server set the reminder at once');
    assert.deepEqual([s.at, s.notify.title, s.notify.body, s.payload, s.ref.id], [Date.parse(`${calDay}T08:30:00Z`), 'Car', 'Starts in 1 hour 30 minutes', { id: event.id }, event.id]);
  });

  await test('Calendar: updateEvent clearing the reminder takes it off; a new one is set at once', async () => {
    as = agents[9];
    const at = Date.now() + 3 * 24 * 3600 * 1000;
    ok(await call('POST', `/api/modules/calendar/schedule?scope=space&space=${camp}`, { cookie: miaC, body: { key: 'other-key', at, payload: {} } }), 'some other schedule');
    assert.ok(calRemind());
    const r = await askIn('calendar:updateEvent', { event, remind: '' });
    ok(r, 'updateEvent');
    assert.equal(r.json.ok, true);
    assert.equal(r.json.note, undefined, 'no reminder: nothing said');
    const v = (await calData())[`event:${event.id}`].value;
    assert.equal(v.remind, null);
    assert.deepEqual([v.title, v.desc, v.start], ['Car', 'Pick up at the airport', `${calDay}T10:00:00.000Z`], 'the rest kept');
    assert.ok(!calRemind(), 'the old reminder will not fire');
    assert.ok(schedules().some((x) => x.key === 'other-key'), 'a schedule about nothing it changed stays');
    const back = await askIn('calendar:updateEvent', { event, remind: 30, notes: '' });
    ok(back, 'a reminder again, notes cleared');
    assert.equal(back.json.note, `The reminder is for ${calSays}, 9:30 AM, 30 minutes before it starts.`);
    const w = (await calData())[`event:${event.id}`].value;
    assert.deepEqual([w.remind, w.remindPending, w.desc], [30, undefined, '']);
    assert.equal(calRemind().at, Date.parse(`${calDay}T09:30:00Z`), 'set again, from the event as changed');
  });

  await test('Calendar: an agent\'s createEvent with remindAt is done at once, stores the lead time and says the clock time', async () => {
    as = agents[9];
    // Thomas's case: 11:00 two days before an all-day event, read in the server's zone (UTC here). An all-day event reminds
    // from 9:00 on its day, so it is 46 hours before.
    const r = await askIn('calendar:createEvent', { title: 'Market', date: '2030-11-26', remindAt: '2030-11-24 11:00' });
    ok(r, 'createEvent with remindAt');
    assert.equal(r.json.status, 'done');
    assert.equal(r.json.note, 'The reminder is for Sunday 24 November, 11:00 AM, 46 hours before 9:00 AM on its day (all-day reminders count from 9:00 AM). A reminder can be set at most a year ahead, so this one is not set yet; set it again within the year.');
    const v = (await calData())[`event:${r.json.ref.id}`].value;
    assert.deepEqual([v.allDay, v.start, v.remind, v.remindPending, v.remindAt], [true, '2030-11-26', 2760, undefined, undefined]);
    const timed = await askIn('calendar:updateEvent', { event: r.json.ref, time: '19:00', remindAt: '6pm' });
    ok(timed, 'updateEvent with a time alone');
    assert.equal(timed.json.note, 'The reminder is for Tuesday 26 November, 6:00 PM, 1 hour before it starts. A reminder can be set at most a year ahead, so this one is not set yet; set it again within the year.');
    assert.equal((await calData())[`event:${r.json.ref.id}`].value.remind, 60);
    const both = await askIn('calendar:createEvent', { title: 'Market', date: '2030-11-26', remind: 15, remindAt: '8am' });
    ok(both, 'remind and remindAt', 422);
    assert.equal(both.json.error, 'Give remind or remindAt, not both.');
  });

  await test('Itinerary: an agent\'s addStop after the plan\'s last day moves the main phase\'s end, and nothing waits for a page', async () => {
    as = agents[8];
    const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    const phasesOf = async (id) => (await call('GET', `/api/spaces/${id}`, { cookie: admin })).json.space.phases || {};
    ok(await call('PATCH', '/api/settings', { cookie: admin, body: { template: 'travel' } }), 'the travel template');
    try {
      ok(await call('PATCH', `/api/spaces/${camp}`, { cookie: admin, body: { phases: { trip: { start: day(10), end: day(12) }, 'post-trip': { start: day(13) } } } }), 'the Trip is dated');
      const r = await askIn('travel:addStop', { title: 'Sintra', date: day(14) });
      ok(r, 'addStop past the last day');
      assert.deepEqual([r.json.ok, r.json.note, r.json.effects], [true, undefined, { phaseEnd: { moved: true, end: day(14) } }], r.text);
      assert.deepEqual(await phasesOf(camp), { trip: { start: day(10), end: day(14) }, 'post-trip': { start: day(15) } }, 'the end, and the next phase with it');
      assert.equal((await travelData())[`plan:${r.json.ref.id}`].value.date, day(14));
      assert.equal((await travelData())['trip:main'], undefined, 'the module wrote no dates of its own');
      const inside = await askIn('travel:addStop', { title: 'Castle', date: day(12) });
      ok(inside, 'addStop on the plan');
      assert.deepEqual([inside.json.note, inside.json.effects], [undefined, undefined]);
      // More than the plan's 60 days: the stop is kept, the day said, the end where it was.
      const far = await askIn('travel:addStop', { title: 'Far', date: day(214) });
      ok(far, 'addStop far away');
      assert.deepEqual([far.json.note, far.json.effects], ['A plan can be at most 60 days long, so that day is left off the plan.', undefined]);
      assert.equal((await phasesOf(camp)).trip.end, day(14));
    } finally {
      await call('PATCH', `/api/spaces/${camp}`, { cookie: admin, body: { phases: null } });
      ok(await call('PATCH', '/api/settings', { cookie: admin, body: { template: 'default' } }), 'back to the default template');
    }
  });

  await test('an uploaded copy of the Itinerary: refused at install while it may move a phase\'s end; without, refused at once to an agent', async () => {
    as = agents[10];
    const up = path.join(base, 'variants', 'travel-upload');
    fs.cpSync(path.join(ROOT, 'modules', 'travel'), up, { recursive: true });
    const m = JSON.parse(fs.readFileSync(path.join(up, 'module.json'), 'utf8'));
    m.version = '9.9.9';
    fs.writeFileSync(path.join(up, 'module.json'), JSON.stringify(m, null, 2));
    const mover = m.actions.provides.find((a) => a.phaseEnd === true);
    assert.ok(mover, 'the Itinerary has an action that moves the end');
    const refused = await call('POST', '/api/modules', { cookie: admin, raw: zipOf(up), headers: { 'content-type': 'application/zip' } });
    ok(refused, 'an upload that may move the end is refused', 400);
    assert.equal(refused.json.error, `module.json: action "${mover.name}" asks to move the main phase's end, which only a module that ships with the server may do`);
    // Without it, and without server actions: installed, and an agent's request is refused at once, never queued for a page.
    delete m.actions.server;
    for (const a of m.actions.provides) delete a.phaseEnd;
    fs.writeFileSync(path.join(up, 'module.json'), JSON.stringify(m, null, 2));
    ok(await call('POST', '/api/modules', { cookie: admin, raw: zipOf(up), headers: { 'content-type': 'application/zip' } }), 'the upload installs', 201);
    const before = JSON.stringify(await travelData());
    const ids = busIds();
    const r = await askIn('travel:updatePlan', { entry: flight, object: { kind: 'flight', details: { gate: 'Z9' } } });
    const NONE = 'Planner - Itinerary has no actions that run on the server, so it can\'t do this for an agent.';
    ok(r, 'refused at once', 409);
    assert.deepEqual(r.json, { error: NONE });
    assert.deepEqual(busIds(), ids, 'nothing queued for a page');
    assert.equal(JSON.stringify(await travelData()), before, 'nothing written');
    const listed = (await call('GET', `/api/spaces/${camp}/actions`, T())).json.actions.find((a) => a.action === 'travel:updatePlan');
    assert.deepEqual([listed.may, listed.now, listed.why, listed.waiting], [false, false, NONE, undefined], 'list_actions: may false, with why');
  });

  // --- To-do, carried by the server (plan-agent-edit-delete.md, step 2b) -------------------------------------------------------
  // An agent of its own (its own 20 writes a minute), added to Camp.
  const todoAgent = (await call('POST', '/api/users', { cookie: admin, body: { agent: true } })).json.user;
  const campMembers = (await call('GET', `/api/spaces/${camp}`, { cookie: admin })).json.space.members;
  ok(await call('PATCH', `/api/spaces/${camp}`, { cookie: admin, body: { members: [...campMembers, todoAgent.key] } }), 'the To-do agent joins Camp');
  await newToken(todoAgent);
  const todoData = async () => Object.fromEntries((await call('GET', `/api/modules/todo/data?scope=space&space=${camp}`, { cookie: admin })).json.items.map((i) => [i.key, i]));
  let task = null;
  const soon = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10); // a schedule may be at most a year away
  const todoRemind = () => schedules().find((x) => x.module === 'todo' && x.key === `remind:${task.id}`);
  const linksOf = async (from) => (await call('GET', `/api/objects/links?from=todo&dir=from&ref=${encodeURIComponent(JSON.stringify(from))}`, { cookie: miaC })).json;
  await test('To-do: an agent\'s createTask and updateTask are done at once, the second on the first\'s pointer; the server sets the reminder', async () => {
    as = todoAgent;
    const r = await askIn('todo:createTask', { title: 'Pack the car', due: soon, remind: true, notes: 'Roof box' });
    ok(r, 'createTask');
    assert.equal(r.json.status, 'done');
    assert.equal(r.json.ok, true);
    assert.equal(r.json.note, undefined, 'nothing waits, so nothing to say');
    task = r.json.ref;
    assert.deepEqual([task.module, task.kind, task.space], ['todo', 'task', camp]);
    const item = (await todoData())[`task:${task.id}`];
    // The module test's expectations (modules/todo/test/check-todo-actions.mjs).
    assert.deepEqual({ ...item.value, createdAt: typeof item.value.createdAt }, { id: task.id, title: 'Pack the car', notes: 'Roof box', due: soon, remind: true, done: false, doneAt: null, createdAt: 'number', by: 'Claude', links: [], autoDone: false });
    assert.equal(item.by, todoAgent.key, 'the write is the agent\'s');
    // 9:00 on the due date, in the server's zone (UTC here), as todo.js applyReminder sets it.
    const s = todoRemind();
    assert.ok(s, 'the server set the reminder at once');
    assert.deepEqual([s.at, s.notify.title, s.notify.body, s.ref.id], [Date.parse(`${soon}T09:00:00Z`), 'Pack the car', 'Due today', task.id]);
    ok(await call('POST', `/api/modules/todo/schedule?scope=space&space=${camp}`, { cookie: miaC, body: { key: 'other-key', at: s.at, payload: {} } }), 'and some other schedule');
    const up = await askIn('todo:updateTask', { task, title: 'Pack the car early', notes: '' });
    ok(up, 'updateTask');
    assert.equal(up.json.ok, true);
    assert.deepEqual(up.json.ref, task, 'the pointer back');
    const v = (await todoData())[`task:${task.id}`].value;
    assert.deepEqual([v.title, v.notes, v.due, v.remind, v.remindPending], ['Pack the car early', '', soon, true, undefined], 'only the fields given; "" cleared the notes');
    assert.equal(todoRemind().notify.title, 'Pack the car early', 'the reminder set again from the task as changed');
    assert.ok(schedules().some((x) => x.module === 'todo' && x.key === 'other-key'), 'a schedule about nothing it changed stays');
  });

  await test('To-do: setTaskDue left out clears the due date and the reminder; linkTask and unlinkTask on the Calendar\'s event, linked by the server', async () => {
    as = todoAgent;
    const due = await askIn('todo:setTaskDue', { task });
    ok(due, 'setTaskDue');
    assert.equal(due.json.ok, true);
    assert.equal(due.json.note, 'Its reminder is off, since it has no due date.');
    const v = (await todoData())[`task:${task.id}`].value;
    assert.deepEqual([v.due, v.remind, v.remindPending], [null, false, undefined]);
    assert.ok(!todoRemind(), 'the reminder is off');
    const linked = await askIn('todo:linkTask', { task, target: event });
    ok(linked, 'linkTask');
    assert.equal(linked.json.ok, true, linked.text);
    assert.equal(linked.json.note, undefined);
    const w = (await todoData())[`task:${task.id}`].value;
    assert.deepEqual([w.links, w.linksPending], [[event], undefined]);
    const held = await linksOf(task);
    assert.ok(JSON.stringify(held).includes(event.id), `the host holds the link at once: ${JSON.stringify(held)}`);
    const off = await askIn('todo:unlinkTask', { task, target: event });
    ok(off, 'unlinkTask');
    assert.deepEqual((await todoData())[`task:${task.id}`].value.links, []);
    assert.ok(!JSON.stringify(await linksOf(task)).includes(event.id), 'and lets it go at once');
    const again = await askIn('todo:unlinkTask', { task, target: event });
    ok(again, 'unlinkTask again', 422);
    assert.equal(again.json.error, 'That task is not linked to that.');
  });

  // --- Research and Planner - Projects on the server (plan-agent-server-actions.md, step 7) ----------------------------------
  // Each module's own test runs every handler both ways; here one request each against a real server, as an agent.
  for (const id of ['research', 'schedule']) {
    ok(await call('POST', `/api/modules/bundled/${id}/install`, { cookie: admin, body: {} }), `${id} installs`, 201);
    ok(await call('PATCH', `/api/modules/${id}`, { cookie: admin, body: { enabled: true, allSpaces: true } }), `${id} on`);
  }
  const linksFrom = async (module, ref) => (await call('GET', `/api/objects/links?from=${module}&dir=from&ref=${encodeURIComponent(JSON.stringify(ref))}`, { cookie: miaC })).json;
  await test('Research: a note about an event and a link are done at once, the note linked to the event; the link changed after', async () => {
    as = agents[13];
    const ev = await askIn('calendar:createEvent', { title: 'Tram 28', date: '2030-12-02' });
    ok(ev, 'an event to write about');
    const r = await askIn('research:saveNote', { title: 'Tram 28 tips', body: 'Board at Martim Moniz', ref: ev.json.ref });
    ok(r, 'saveNote');
    assert.deepEqual([r.json.status, r.json.ok], ['done', true]);
    const note = r.json.ref;
    assert.deepEqual([note.module, note.kind, note.space], ['research', 'note', camp]);
    const items = (await call('GET', `/api/modules/research/data?scope=space&space=${camp}`, { cookie: admin })).json.items;
    const v = items.find((i) => i.key === `note:${note.id}`).value;
    assert.deepEqual([v.title, v.body, v.by, v.ref], ['Tram 28 tips', 'Board at Martim Moniz', 'Claude', undefined], 'the note, credited to the agent, keeping no pointer');
    const seen = await linksFrom('research', note);
    assert.equal(JSON.stringify(seen).includes(ev.json.ref.id), true, 'linked to the event');
    const l = await askIn('research:saveLink', { url: 'HTTPS://Example.org/tram 28', excerpt: 'Times' });
    ok(l, 'saveLink');
    const lv = (await call('GET', `/api/modules/research/data?scope=space&space=${camp}`, { cookie: admin })).json.items.find((i) => i.key === `link:${l.json.ref.id}`).value;
    assert.deepEqual([lv.url, lv.title], ['https://example.org/tram%2028', 'example.org'], 'the address read as a browser reads it');
    const u = await askIn('research:updateLink', { link: l.json.ref, title: 'Tram times' });
    ok(u, 'updateLink');
    assert.equal(u.json.ok, true);
  });
  await test('Planner - Projects: work done under a milestone settles the milestone in the same request; an entry from an event is linked', async () => {
    as = agents[13];
    const m = await askIn('schedule:addMilestone', { title: 'Launch', date: '2030-12-10' });
    ok(m, 'addMilestone');
    const w = await askIn('schedule:addWork', { title: 'Docs', object: { kind: 'work', title: 'Docs', details: { start: '2030-12-01', end: '2030-12-02', under: 'Launch' } } });
    ok(w, 'addWork');
    const done = await askIn('schedule:setDone', { ref: w.json.ref, done: true });
    ok(done, 'setDone');
    assert.deepEqual([done.json.status, done.json.ok], ['done', true]);
    const plan = Object.fromEntries((await call('GET', `/api/modules/schedule/data?scope=space&space=${camp}`, { cookie: admin })).json.items.map((i) => [i.key, i.value]));
    assert.deepEqual([plan[`plan:${w.json.ref.id}`].parent, plan[`plan:${w.json.ref.id}`].done], [m.json.ref.id, true]);
    assert.deepEqual([plan[`plan:${m.json.ref.id}`].done, plan[`plan:${m.json.ref.id}`].progress], [true, 100], 'the milestone follows, with no page open');
    const ev = await askIn('calendar:createEvent', { title: 'Review', date: '2030-12-03' });
    const from = await askIn('schedule:addNote', { title: 'Review notes', ref: ev.json.ref });
    ok(from, 'addNote from an event');
    assert.equal(JSON.stringify(await linksFrom('schedule', from.json.ref)).includes(ev.json.ref.id), true, 'linked to the event');
  });

  // --- links, schedules and a notice in the answer (plan-agent-server-actions.md, section 2, steps 4 and 5) -----------------
  // The fixture declares the schedule and notify hooks and may link to the Calendar's events; fixture-plain, the same code
  // bundled under another id, has no hook and may link to nothing. The `effects` action answers whatever its plan names.
  ok(await call('POST', '/api/modules/bundled/fixture-plain/install', { cookie: admin, body: {} }), 'fixture-plain installs', 201);
  ok(await call('PATCH', '/api/modules/fixture-plain', { cookie: admin, body: { enabled: true, allSpaces: true } }), 'fixture-plain on');
  const fxAgents = [];
  for (let i = 0; i < 5; i += 1) {
    const a = (await call('POST', '/api/users', { cookie: admin, body: { agent: true } })).json.user;
    fxAgents.push(a);
    await newToken(a);
  }
  for (const id of [camp, lodge]) {
    const members = (await call('GET', `/api/spaces/${id}`, { cookie: admin })).json.space.members;
    ok(await call('PATCH', `/api/spaces/${id}`, { cookie: admin, body: { members: [...members, ...fxAgents.map((a) => a.key)] } }), 'the effects agents join');
  }
  const fx = (plan, { module = 'fixture-notes', ms, space = camp } = {}) => call('POST', `/api/spaces/${space}/action`, { ...T(), body: { action: `${module}:effects`, input: { plan: JSON.stringify(plan), ...(ms ? { ms } : {}) } } });
  const noteRef = (id, space = camp, module = 'fixture-notes') => ({ module, kind: 'note', id, scope: 'space', space });
  const noteWrite = (id, title = id) => ({ key: `note:${id}`, value: { title, byKey: as.key, by: 'Claude' } });
  const linksNow = () => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'modules', 'links.json'), 'utf8')); } catch { return []; } };
  const sorted = (list, f) => [...list].sort((a, b) => f(a).localeCompare(f(b)));
  const linkKey = (l) => JSON.stringify([l.from, l.to]);
  // Everything a request can touch, to compare before and after a refusal: the notes, the links, the schedules and Mia's notices.
  const everything = async (module = 'fixture-notes') => {
    const items = (await call('GET', `/api/modules/${module}/data?scope=space&space=${camp}`, { cookie: miaC })).json.items;
    return {
      data: Object.fromEntries(items.map((i) => [i.key, i.value])),
      links: sorted(linksNow(), linkKey),
      schedules: sorted(schedules(), (s) => s.id),
      notices: (await call('GET', '/api/notifications', { cookie: miaC })).json.notifications.length,
    };
  };
  const refusedWhole = async (r, status, sentence, before, module) => {
    ok(r, sentence, status);
    assert.equal(r.json.status, 'done');
    assert.equal(r.json.ok, false);
    assert.equal(r.json.error, sentence);
    assert.equal(r.json.effects, undefined, 'no effects are reported');
    assert.deepEqual(await everything(module), before, 'nothing was changed');
  };
  const inAnHour = () => Date.now() + 3600 * 1000;

  await test('effects: links, a schedule and a notice in one answer are done by the server, as the agent, and recorded', async () => {
    as = fxAgents[0];
    const noticesBefore = (await call('GET', '/api/notifications', { cookie: miaC })).json.notifications.length;
    const at = inAnHour();
    const r = await fx({
      writes: [noteWrite('fxa', 'Alpha'), noteWrite('fxb', 'Beta')],
      ref: noteRef('fxa'),
      links: [{ add: { from: noteRef('fxa'), to: noteRef('fxb') } }, { add: { from: noteRef('fxa'), to: event } }],
      schedules: [{ set: { key: 'remind:fxa', at, about: noteRef('fxa'), payload: { id: 'fxa' }, notify: { title: 'Alpha is due', body: 'Soon' } } }],
      notify: [{ title: 'New note', body: 'Alpha', about: noteRef('fxa') }],
    });
    ok(r, 'effects');
    assert.equal(r.json.ok, true);
    assert.deepEqual(r.json.effects, { links: { added: 2, removed: 0 }, schedules: { set: ['remind:fxa'], cancelled: [] }, notified: 2 }, 'the space\'s two people (Mia and the admin who made it) are told, no agent');
    const mine = linksNow().filter((l) => l.from.module === 'fixture-notes' && l.from.id === 'fxa');
    assert.deepEqual(sorted(mine, linkKey).map((l) => [l.to.module, l.to.id, l.by]), sorted([{ k: 'calendar', id: event.id }, { k: 'fixture-notes', id: 'fxb' }], (x) => x.k).map((x) => [x.k, x.id, as.key]), 'both links, in the agent\'s name');
    const s = schedules().find((x) => x.module === 'fixture-notes' && x.key === 'remind:fxa');
    assert.deepEqual([s.at, s.by, s.spaceId, s.scopeKey, s.ref, s.payload, s.notify], [at, as.key, camp, `space:${camp}`, noteRef('fxa'), { id: 'fxa' }, { to: 'space', title: 'Alpha is due', body: 'Soon' }], 'the schedule, about the note, in the agent\'s name');
    const notices = (await call('GET', '/api/notifications', { cookie: miaC })).json.notifications;
    assert.equal(notices.length, noticesBefore + 1, 'Mia is told once');
    assert.deepEqual([notices[0].module, notices[0].title, notices[0].body, notices[0].by, notices[0].spaceId], ['fixture-notes', 'New note', 'Alpha', as.key, camp], 'the notice, in the agent\'s name');
    const status = await call('GET', `/api/spaces/${camp}/action/${r.json.id}`, T());
    assert.deepEqual(status.json.effects, r.json.effects, 'request_status keeps what was done');
    assert.deepEqual(busFile().actions.find((a) => a.id === r.json.id).result.effects, r.json.effects, 'and so does the stored request');
    // Mia's page sees the link as any link.
    const seen = await call('GET', `/api/objects/links?from=fixture-notes&dir=from&ref=${encodeURIComponent(JSON.stringify(noteRef('fxa')))}`, { cookie: miaC });
    ok(seen, 'a page reads the links');
    // Adding a link it already holds, and removing one it does not, change nothing and are not counted.
    const again = await fx({ links: [{ add: { from: noteRef('fxa'), to: noteRef('fxb') } }, { remove: { from: noteRef('fxb'), to: noteRef('fxa') } }] });
    ok(again, 'again');
    assert.equal(again.json.effects, undefined);
    const off = await fx({ links: [{ remove: { from: noteRef('fxa'), to: noteRef('fxb') } }], schedules: [{ cancel: { key: 'remind:fxa' } }, { cancel: { key: 'never-set' } }] });
    ok(off, 'remove and cancel');
    assert.deepEqual(off.json.effects, { links: { added: 0, removed: 1 }, schedules: { set: [], cancelled: ['remind:fxa'] } });
    assert.ok(!schedules().some((x) => x.module === 'fixture-notes' && x.key === 'remind:fxa'));
    assert.deepEqual(linksNow().filter((l) => l.from.module === 'fixture-notes' && l.from.id === 'fxa').map((l) => l.to.module), ['calendar'], 'the other link stays');
  });

  await test('effects: more than 5 links, 5 schedules or 1 notice, or a shape the server does not know, is refused and nothing changes', async () => {
    as = fxAgents[1];
    const before = await everything();
    const w = [noteWrite('fxcap')];
    const link = (i) => ({ add: { from: noteRef('fxa'), to: noteRef(`x${i}`) } });
    const sched = (i) => ({ set: { key: `k${i}`, at: inAnHour(), about: noteRef('fxa') } });
    const cases = [
      [{ writes: w, links: [0, 1, 2, 3, 4, 5].map(link) }, 'it tried to change more than 5 links at once'],
      [{ writes: w, schedules: [0, 1, 2, 3, 4, 5].map(sched) }, 'it tried to set or cancel more than 5 reminders at once'],
      [{ writes: w, notify: [{ title: 'One' }, { title: 'Two' }] }, 'it tried to send more than 1 notice at once'],
      [{ writes: w, links: [{ add: { from: noteRef('fxa'), to: noteRef('fxb'), as: 'admin' } }] }, 'it answered something the server can\'t use'],
      [{ writes: w, links: [{ add: { from: noteRef('fxa'), to: noteRef('fxb') }, remove: { from: noteRef('fxa'), to: event } }] }, 'it answered something the server can\'t use'],
      [{ writes: w, links: [{ add: { from: { ...noteRef('fxa'), by: mia.key }, to: noteRef('fxb') } }] }, 'it answered something the server can\'t use'],
      [{ writes: w, schedules: [{ set: { key: 'k', at: inAnHour(), about: noteRef('fxa'), by: mia.key } }] }, 'it answered something the server can\'t use'],
      [{ writes: w, schedules: [{ set: { key: 'k', at: inAnHour(), about: noteRef('fxa') } }, { cancel: { key: 'k' } }] }, 'it answered something the server can\'t use'],
      [{ writes: w, schedules: [{ set: { key: 'bad key', at: inAnHour(), about: noteRef('fxa') } }] }, 'it answered something the server can\'t use'],
      [{ writes: w, schedules: [{ set: { key: 'k', at: inAnHour(), about: noteRef('fxa'), payload: 'x'.repeat(4100) } }] }, 'it answered something the server can\'t use'],
      [{ writes: w, notify: [{ title: 'One', module: 'todo' }] }, 'it answered something the server can\'t use'],
      [{ writes: w, notify: { title: 'One' } }, 'it answered something the server can\'t use'],
      [{ writes: w, effects: { links: [] } }, 'it answered something the server can\'t use'],
      // Someone else's object: a link from another module's object, or from a note in another space; a schedule or a notice
      // about one.
      [{ writes: w, links: [{ add: { from: task, to: noteRef('fxa') } }] }, 'it tried to link from something that is not its own in this space'],
      [{ writes: w, links: [{ remove: { from: event, to: noteRef('fxa') } }] }, 'it tried to link from something that is not its own in this space'],
      [{ writes: w, links: [{ add: { from: noteRef('lodgenote', lodge), to: noteRef('fxa') } }] }, 'it tried to link from something that is not its own in this space'],
      [{ writes: w, schedules: [{ set: { key: 'k', at: inAnHour(), about: task } }] }, 'it tried to set a reminder or send a notice about something that is not its own in this space'],
      [{ writes: w, schedules: [{ set: { key: 'k', at: inAnHour() } }] }, 'it tried to set a reminder or send a notice about something that is not its own in this space'],
      [{ writes: w, notify: [{ title: 'One', about: noteRef('fortsecret', fort) }] }, 'it tried to set a reminder or send a notice about something that is not its own in this space'],
    ];
    for (const [plan, words] of cases) {
      faultSentence(await fx(plan), words);
      assert.deepEqual(await everything(), before, `nothing was changed: ${words}`);
    }
  });

  await test('effects: what the agent may not see or reach is refused with one sentence, and the writes are put back', async () => {
    as = fxAgents[2];
    ok(await call('PUT', `/api/modules/fixture-notes/data/note:lodgenote?scope=space&space=${lodge}`, { cookie: miaC, body: { value: { title: 'In the Lodge' } } }), 'a note in the Lodge');
    const before = await everything();
    const w = [noteWrite('fxc')];
    const from = noteRef('fxc'); // made by this very request
    const HERE = 'Nothing was changed: a link can only be to an object in this space.';
    await refusedWhole(await fx({ writes: w, links: [{ add: { from, to: noteRef('fortsecret', fort) } }] }), 403, HERE, before);
    await refusedWhole(await fx({ writes: w, links: [{ add: { from, to: noteRef('lodgenote', lodge) } }] }), 403, HERE, before);
    await refusedWhole(await fx({ writes: w, links: [{ add: { from, to: { module: 'fixture-notes', kind: 'note', id: 'fxa', scope: 'environment' } } }] }), 403, HERE, before);
    await refusedWhole(await fx({ writes: w, links: [{ add: { from, to: task } }] }), 403, 'Nothing was changed: that module has not been approved to link to those objects.', before);
    await refusedWhole(await fx({ writes: w, links: [{ add: { from, to: noteRef('nosuchnote') } }] }), 404, 'Nothing was changed: that object is no longer there.', before);
    await refusedWhole(await fx({ links: [{ add: { from: noteRef('nosuchnote'), to: noteRef('fxa') } }] }), 404, 'Nothing was changed: that object is no longer there.', before);
    await refusedWhole(await fx({ writes: w, links: [{ add: { from, to: { module: 'fixture-notes', kind: 'note', id: 'fxa', scope: 'person' } } }] }), 400, 'Nothing was changed: personal objects are private, so they are not linked.', before);
    await refusedWhole(await fx({ writes: w, links: [{ add: { from, to: from } }] }), 400, 'Nothing was changed: an object is not linked to itself.', before);
    await refusedWhole(await fx({ writes: w, links: [{ add: { from, to: { module: 'fixture-notes', kind: 'note', id: '../x y', scope: 'space', space: camp } } }] }), 400, 'Nothing was changed: Fixture notes named an object to link that is not a valid pointer.', before);
    await refusedWhole(await fx({ writes: w, schedules: [{ set: { key: 'k', at: inAnHour(), about: noteRef('nosuchnote') } }] }), 404, 'Nothing was changed: that object is no longer there.', before);
    await refusedWhole(await fx({ writes: w, notify: [{ title: 'One', about: noteRef('nosuchnote') }] }), 404, 'Nothing was changed: that object is no longer there.', before);
    const TO = 'Nothing was changed: a notice from an agent\'s request goes to this space or to one of its members.';
    await refusedWhole(await fx({ writes: w, notify: [{ title: 'To everyone', to: 'environment' }] }), 400, TO, before);
    await refusedWhole(await fx({ writes: w, notify: [{ title: 'To a stranger', to: 'nobody-here' }] }), 400, TO, before);
    await refusedWhole(await fx({ writes: w, schedules: [{ set: { key: 'k', at: inAnHour(), about: from, notify: { title: 'Later', to: 'environment' } } }] }), 400, TO, before);
    await refusedWhole(await fx({ writes: w, schedules: [{ set: { key: 'k', at: 'not a time', about: from } }] }), 400, 'Nothing was changed: "at" must be a time (milliseconds or an ISO date).', before);
    await refusedWhole(await fx({ writes: w, schedules: [{ set: { key: 'k', at: Date.now() + 800 * 24 * 3600 * 1000, about: from } }] }), 400, 'Nothing was changed: that is more than a year away.', before);
    // A notice to one member of the space is theirs alone.
    const one = await fx({ notify: [{ title: 'For Mia', to: mia.key }] });
    ok(one, 'to a member');
    assert.deepEqual(one.json.effects, { notified: 1 });
  });

  await test('effects: a module without the hook, or not approved to link, is refused; a link between its own objects still works', async () => {
    as = fxAgents[4];
    const P = 'fixture-plain';
    const before = await everything(P);
    const w = [noteWrite('pa'), noteWrite('pb')];
    const pa = noteRef('pa', camp, P);
    await refusedWhole(await fx({ writes: w, schedules: [{ set: { key: 'k', at: inAnHour(), about: pa } }] }, { module: P }), 403, 'Nothing was changed: Fixture plain did not ask for the schedule hook.', before, P);
    await refusedWhole(await fx({ writes: w, schedules: [{ cancel: { key: 'k' } }] }, { module: P }), 403, 'Nothing was changed: Fixture plain did not ask for the schedule hook.', before, P);
    await refusedWhole(await fx({ writes: w, notify: [{ title: 'One' }] }, { module: P }), 403, 'Nothing was changed: Fixture plain did not ask for the notify hook.', before, P);
    await refusedWhole(await fx({ writes: w, links: [{ add: { from: pa, to: event } }] }, { module: P }), 403, 'Nothing was changed: that module has not been approved to link to those objects.', before, P);
    await refusedWhole(await fx({ writes: w, links: [{ add: { from: pa, to: noteRef('fxa') } }] }, { module: P }), 403, 'Nothing was changed: that module has not been approved to link to those objects.', before, P);
    // A link between its own objects needs no approval and no hook.
    const r = await fx({ writes: w, links: [{ add: { from: pa, to: noteRef('pb', camp, P) } }] }, { module: P });
    ok(r, 'its own link');
    assert.deepEqual(r.json.effects, { links: { added: 1, removed: 0 } });
  });

  await test('effects: when a later effect fails, the writes, the links and the schedules before it are all put back', async () => {
    as = fxAgents[0]; // Alpha's maker
    // A page's schedule about Alpha, which a change to Alpha takes off; and Alpha's link to the Calendar's event.
    ok(await call('POST', `/api/modules/fixture-notes/schedule?scope=space&space=${camp}`, { cookie: miaC, body: { key: 'page:fxa', at: inAnHour(), payload: { id: 'fxa' }, ref: noteRef('fxa'), notify: { title: 'Alpha', body: 'From a page' } } }), 'a page sets a schedule about Alpha');
    ok(await call('POST', `/api/modules/fixture-notes/schedule?scope=space&space=${camp}`, { cookie: miaC, body: { key: 'page:keep', at: inAnHour(), payload: {} } }), 'and one about nothing');
    const before = await everything();
    assert.ok(before.schedules.some((s) => s.key === 'page:fxa') && before.links.some((l) => l.from.id === 'fxa' && l.to.module === 'calendar'));
    const alpha = { ...before.data['note:fxa'], title: 'Alpha, renamed' };
    const plan = (last) => ({
      writes: [{ key: 'note:fxa', value: alpha }, noteWrite('fxd')],
      links: [{ add: { from: noteRef('fxd'), to: noteRef('fxa') } }, { remove: { from: noteRef('fxa'), to: event } }, { add: { from: noteRef('fxa'), to: noteRef('fxb') } }],
      schedules: [{ set: { key: 'remind:fxd', at: inAnHour(), about: noteRef('fxd') } }, { set: { key: 'page:keep', at: inAnHour() + 5000, about: noteRef('fxd') } }, { cancel: { key: 'page:fxa' } }],
      ...last,
    });
    // The last schedule can't be set (its time has passed); then the notice can't be sent (not to this space).
    const late = plan({});
    late.schedules = [...late.schedules.slice(0, 2), { set: { key: 'remind:late', at: Date.now() - 3600 * 1000, about: noteRef('fxa') } }];
    await refusedWhole(await fx(late), 400, 'Nothing was changed: that time has already passed.', before);
    await refusedWhole(await fx(plan({ notify: [{ title: 'Renamed', to: 'environment' }] })), 400, 'Nothing was changed: a notice from an agent\'s request goes to this space or to one of its members.', before);
    // A write refused by the module's guards, after which no effect is tried.
    const guarded = plan({});
    guarded.writes.push({ key: 'zzz:9', value: {} });
    const g = await fx(guarded);
    ok(g, 'a key the guards do not name', 400);
    assert.deepEqual(await everything(), before, 'nothing was changed');
    // The same plan with nothing wrong is done whole.
    const done = await fx(plan({ notify: [{ title: 'Renamed' }] }));
    ok(done, 'the whole plan');
    assert.deepEqual(done.json.effects, { links: { added: 2, removed: 1 }, schedules: { set: ['remind:fxd', 'page:keep'], cancelled: ['page:fxa'] }, notified: 2 });
    const after = await everything();
    assert.equal(after.data['note:fxa'].title, 'Alpha, renamed');
    assert.deepEqual(sorted(after.schedules.filter((s) => s.module === 'fixture-notes'), (s) => s.key).map((s) => [s.key, s.by, s.ref?.id || null]), [['page:keep', as.key, 'fxd'], ['remind:fxd', as.key, 'fxd']]);
  });

  await test('effects: in a space closed for set up, or closed while the handler ran, nothing is linked, scheduled or sent', async () => {
    as = fxAgents[3];
    const lodgeState = async () => ({
      data: (await call('GET', `/api/modules/fixture-notes/data?scope=space&space=${lodge}`, { cookie: admin })).json.items.map((i) => i.key).sort(),
      links: linksNow().filter((l) => l.from.space === lodge || l.to.space === lodge).length,
      schedules: schedules().filter((s) => s.spaceId === lodge).length,
      notices: (await call('GET', '/api/notifications', { cookie: miaC })).json.notifications.length,
    });
    const plan = { writes: [noteWrite('fxl')], links: [{ add: { from: noteRef('fxl', lodge), to: noteRef('lodgenote', lodge) } }], schedules: [{ set: { key: 'remind:fxl', at: inAnHour(), about: noteRef('fxl', lodge), notify: { title: 'Lodge' } } }], notify: [{ title: 'In the Lodge' }] };
    const before = await lodgeState();
    ok(await call('PATCH', `/api/spaces/${lodge}`, { cookie: admin, body: { closed: true } }), 'the Lodge closes');
    const ids = busIds();
    const shut = await fx(plan, { space: lodge });
    assert.ok(shut.status === 403 || shut.status === 404, `a closed space: ${shut.status} ${shut.text}`);
    assert.deepEqual(busIds(), ids, 'no request was made');
    assert.deepEqual(await lodgeState(), before, 'nothing in the closed space');
    ok(await call('PATCH', `/api/spaces/${lodge}`, { cookie: admin, body: { closed: false } }), 'the Lodge opens');
    const slow = fx(plan, { space: lodge, ms: 700 });
    await sleep(250);
    ok(await call('PATCH', `/api/spaces/${lodge}`, { cookie: admin, body: { closed: true } }), 'the Lodge closes while the handler runs');
    const r = await slow;
    assert.ok(r.status === 403 || r.status === 404, `closed meanwhile: ${r.status} ${r.text}`);
    assert.equal(r.json.ok, false);
    assert.deepEqual(await lodgeState(), before, 'nothing was changed');
    ok(await call('PATCH', `/api/spaces/${lodge}`, { cookie: admin, body: { closed: false } }), 'the Lodge opens again');
    const open = await fx(plan, { space: lodge });
    ok(open, 'open again');
    assert.deepEqual(open.json.effects, { links: { added: 1, removed: 0 }, schedules: { set: ['remind:fxl'], cancelled: [] }, notified: 2 });
  });

  // --- the main phase's end in the answer (plan-agent-server-actions.md, section 2, step 8) --------------------------------
  // The travel template's phases (Planning ... Trip, the main one, Post-trip) for the whole environment, the Camp's and the
  // Lodge's Trip dated, and a space no effects agent is in.
  {
    const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    const DATES = { trip: { start: day(10), end: day(12) }, 'post-trip': { start: day(13) } };
    const phasesOf = async (id) => (await call('GET', `/api/spaces/${id}`, { cookie: admin })).json.space.phases || {};
    const setDates = async (id, phases) => ok(await call('PATCH', `/api/spaces/${id}`, { cookie: admin, body: { phases } }), 'the dates are set');
    ok(await call('PATCH', '/api/settings', { cookie: admin, body: { template: 'travel' } }), 'the travel template');
    const annex = (await call('POST', '/api/spaces', { cookie: admin, body: { name: 'Annex', members: [mia.key] } })).json.space.id;
    // An agent may write 20 times a minute, so these cases have agents of their own and move on to the next in time.
    const peAgents = [];
    for (let i = 0; i < 8; i += 1) {
      const a = (await call('POST', '/api/users', { cookie: admin, body: { agent: true } })).json.user;
      peAgents.push(a);
      await newToken(a);
    }
    for (const id of [camp, lodge]) {
      const members = (await call('GET', `/api/spaces/${id}`, { cookie: admin })).json.space.members;
      ok(await call('PATCH', `/api/spaces/${id}`, { cookie: admin, body: { members: [...members, ...peAgents.map((a) => a.key)] } }), 'the phase agents join');
    }
    let asked = 0;
    const pfx = (plan, o) => {
      as = peAgents[Math.floor(asked / 12) % peAgents.length];
      asked += 1;
      // A note is added in the asker's own name.
      const mine = Array.isArray(plan.writes) ? { ...plan, writes: plan.writes.map((w) => (w.value && w.value.byKey ? { ...w, value: { ...w.value, byKey: as.key } } : w)) } : plan;
      return fx(mine, o);
    };
    try {
      for (const id of [camp, lodge, annex]) await setDates(id, DATES);
      const campDates = await phasesOf(camp);
      assert.deepEqual([campDates.trip, campDates['post-trip']], [DATES.trip, DATES['post-trip']]);
      const still = async (before, what) => {
        assert.deepEqual(await everything(), before.all, `${what}: nothing was changed`);
        for (const id of [camp, lodge, annex]) assert.deepEqual(await phasesOf(id), before.dates[id], `${what}: the dates of ${id} are as they were`);
      };
      const snapshot = async () => ({ all: await everything(), dates: { [camp]: await phasesOf(camp), [lodge]: await phasesOf(lodge), [annex]: await phasesOf(annex) } });
      const faulted = async (r, why, before) => {
        ok(r, why, 500);
        assert.deepEqual([r.json.ok, r.json.error, r.json.effects], [false, `Fixture notes could not carry that out: ${why}.`, undefined]);
        await still(before, why);
      };

      await test('phaseEnd: the main phase\'s end moves to cover the day, every later boundary with it, as the agent, and is recorded', async () => {
        const r = await pfx({ writes: [noteWrite('pe1')], phaseEnd: { date: day(14) } });
        ok(r, 'phaseEnd');
        assert.deepEqual(r.json.effects, { phaseEnd: { moved: true, end: day(14) } });
        assert.equal(r.json.note, 'Planned.', 'no note about the dates');
        const now = await phasesOf(camp);
        assert.deepEqual([now.trip, now['post-trip']], [{ start: day(10), end: day(14) }, { start: day(15) }], 'only the end, and the next phase the same two days later');
        assert.deepEqual([await phasesOf(lodge), await phasesOf(annex)], [campDates, campDates], 'no other space\'s dates');
        assert.deepEqual((await call('GET', `/api/spaces/${camp}/action/${r.json.id}`, T())).json.effects, r.json.effects, 'request_status keeps it');
        // A day already covered, the end itself, a day before the phase: nothing moves, and never earlier.
        for (const d of [day(14), day(11), day(2), '2001-01-01']) {
          const same = await pfx({ phaseEnd: { date: d } });
          ok(same, `covered: ${d}`);
          assert.equal(same.json.effects, undefined, `${d}: nothing moved, nothing reported`);
          assert.deepEqual(await phasesOf(camp), now);
        }
      });

      await test('phaseEnd: only { date }, one real day; a phase\'s id, a start, a space or a list is refused and nothing changes', async () => {
        const before = await snapshot();
        const w = [noteWrite('pe2')];
        const RESULT = 'it answered something the server can\'t use';
        for (const bad of [{ date: day(20), phase: 'post-trip' }, { date: day(20), id: 'planning' }, { date: day(20), space: annex }, { date: day(20), start: day(1) }, { end: day(20) }, { 'post-trip': { start: day(20) } }, {}, [{ date: day(20) }], day(20), 20, true]) {
          await faulted(await pfx({ writes: w, phaseEnd: bad }), RESULT, before);
        }
        await faulted(await pfx({ writes: w, phaseEnd: { date: day(20) }, phases: { trip: { end: day(20) } } }), RESULT, before);
        const DAY = 'it named a last day that is not a day written as YYYY-MM-DD';
        const y = day(20).slice(0, 4);
        for (const bad of ['tomorrow', '', `${y}-02-30`, `${y}-13-01`, `${y}-1-5`, `${day(20)}T00:00:00Z`, ` ${day(20)}`, 20261005, { toString: 'x' }, [day(20)]]) {
          await faulted(await pfx({ writes: w, phaseEnd: { date: bad } }), DAY, before);
        }
      });

      await test('phaseEnd: an action whose manifest does not say so may not move the dates', async () => {
        const P = 'fixture-plain';
        const before = { all: await everything(P), dates: (await snapshot()).dates };
        const r = await pfx({ writes: [noteWrite('pp1')], phaseEnd: { date: day(20) } }, { module: P });
        ok(r, 'not declared', 500);
        assert.equal(r.json.error, 'Fixture plain could not carry that out: it tried to move this trip\'s dates, which that action may not.');
        assert.deepEqual(await everything(P), before.all);
        assert.deepEqual((await snapshot()).dates, before.dates);
        // The manifest's word is true or false, and only on a write that is not local.
        const { cleanManifest } = require(path.join(ROOT, 'server', 'modules.js'));
        const raw = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'module.json'), 'utf8'));
        const withAction = (edit) => { const m = JSON.parse(JSON.stringify(raw)); edit(m.actions.provides.find((a) => a.name === 'effects')); return m; };
        const files = new Set([...Object.values(raw.surfaces || {}).map((x) => x.entry), ...fs.readdirSync(path.join(FIXTURE, 'src')).map((f) => `src/${f}`)]);
        const clean = cleanManifest;
        if (typeof cleanManifest === 'function') {
          assert.equal(clean(raw, files).actions.provides.find((a) => a.name === 'effects').phaseEnd, true);
          assert.throws(() => clean(withAction((a) => { a.phaseEnd = 'trip'; }), files), /phaseEnd must be true or false/);
          assert.throws(() => clean(withAction((a) => { a.local = true; delete a.effect; }), files), /only as a write that is not local/);
          assert.equal('phaseEnd' in clean(withAction((a) => { a.phaseEnd = false; }), files).actions.provides.find((a) => a.name === 'effects'), false);
        } else {
          throw new Error('server/modules.js no longer exports cleanManifest: test the phaseEnd declaration another way');
        }
      });

      await test('phaseEnd: a day more than 366 days past the end is refused whole, for the agent and for a person\'s page', async () => {
        const before = await snapshot();
        const end = before.dates[camp].trip.end;
        const far = new Date(Date.parse(`${end}T00:00:00Z`) + 367 * 86400000).toISOString().slice(0, 10);
        await refusedWhole(await pfx({ writes: [noteWrite('pe3')], phaseEnd: { date: far } }), 400, 'Nothing was changed: Trip can be made at most 366 days longer at once.', before.all);
        await refusedWhole(await pfx({ writes: [noteWrite('pe3')], phaseEnd: { date: '9999-12-31' } }), 400, 'Nothing was changed: Trip can be made at most 366 days longer at once.', before.all);
        await still(before, 'too far');
        const page = await call('POST', `/api/spaces/${camp}/phases/cover`, { cookie: miaC, body: { day: far } });
        ok(page, 'the cover route, too far', 400);
        assert.equal(page.json.error, 'Trip can be made at most 366 days longer at once.');
        await still(before, 'too far, from a page');
      });

      await test('phaseEnd: when the notice after it fails, the dates are put back exactly, with the writes, links and schedules', async () => {
        const before = await snapshot();
        const plan = (notify) => ({
          writes: [noteWrite('pe4'), noteWrite('pe5')],
          links: [{ add: { from: noteRef('pe4'), to: noteRef('pe5') } }],
          schedules: [{ set: { key: 'remind:pe4', at: inAnHour(), about: noteRef('pe4') } }],
          phaseEnd: { date: day(30) },
          notify,
        });
        await refusedWhole(await pfx(plan([{ title: 'Moved', to: 'environment' }])), 400, 'Nothing was changed: a notice from an agent\'s request goes to this trip or to one of its members.', before.all);
        await still(before, 'a notice to the environment');
        await refusedWhole(await pfx(plan([{ title: 'Moved', about: noteRef('nosuchnote') }])), 404, 'Nothing was changed: that object is no longer there.', before.all);
        await still(before, 'a notice about nothing');
        // A write the guards refuse: the end is never tried.
        const g = await pfx({ writes: [noteWrite('pe4'), { key: 'zzz:9', value: {} }], phaseEnd: { date: day(30) } });
        ok(g, 'a refused write', 400);
        await still(before, 'a refused write');
        // The same plan with nothing wrong is done whole.
        const done = await pfx(plan([{ title: 'Moved' }]));
        ok(done, 'the whole plan');
        assert.deepEqual(done.json.effects, { links: { added: 1, removed: 0 }, schedules: { set: ['remind:pe4'], cancelled: [] }, notified: 2, phaseEnd: { moved: true, end: day(30) } });
        assert.equal((await phasesOf(camp)).trip.end, day(30));
      });

      await test('phaseEnd: a space the agent is not in, and a closed space, get nothing', async () => {
        const before = await snapshot();
        const ids = busIds();
        const other = await pfx({ writes: [noteWrite('pe6')], phaseEnd: { date: day(40) } }, { space: annex });
        assert.ok(other.status === 403 || other.status === 404, `someone else's space: ${other.status} ${other.text}`);
        ok(await call('PATCH', `/api/spaces/${lodge}`, { cookie: admin, body: { closed: true } }), 'the Lodge closes');
        const shut = await pfx({ writes: [noteWrite('pe6')], phaseEnd: { date: day(40) } }, { space: lodge });
        assert.ok(shut.status === 403 || shut.status === 404, `a closed space: ${shut.status} ${shut.text}`);
        assert.deepEqual(busIds(), ids, 'no request was made');
        ok(await call('PATCH', `/api/spaces/${lodge}`, { cookie: admin, body: { closed: false } }), 'the Lodge opens');
        const slow = pfx({ writes: [noteWrite('pe6')], phaseEnd: { date: day(40) } }, { space: lodge, ms: 700 });
        await sleep(250);
        ok(await call('PATCH', `/api/spaces/${lodge}`, { cookie: admin, body: { closed: true } }), 'the Lodge closes while the handler runs');
        const r = await slow;
        assert.ok(r.status === 403 || r.status === 404, `closed meanwhile: ${r.status} ${r.text}`);
        ok(await call('PATCH', `/api/spaces/${lodge}`, { cookie: admin, body: { closed: false } }), 'the Lodge opens again');
        assert.deepEqual((await snapshot()).dates, before.dates, 'no space\'s dates moved');
        assert.ok(!(await call('GET', `/api/modules/fixture-notes/data?scope=space&space=${lodge}`, { cookie: admin })).json.items.some((i) => i.key === 'note:pe6'), 'and nothing was written');
      });

      await test('phaseEnd: an asker without the right keeps its writes, the end stays, and the note says why', async () => {
        // On this server an agent that may write in the module may move the dates (the cover route's rule), so the right is
        // taken away where the effects ask for it: server/action-effects.js apply, with every other service a stand-in
        // that must not be reached.
        const { createActionEffects, effectsOf } = require(path.join(ROOT, 'server', 'action-effects.js'));
        const moved = [];
        const never = new Proxy({}, { get: (_, k) => () => { throw new Error(`reached ${String(k)}`); } });
        const fxOf = (refusal) => createActionEffects({
          moduleLinks: never, moduleHooks: { about: () => [], cancelAbout: () => {}, record: () => null }, modules: { shownName: () => 'Fixture notes' },
          copySight: () => ({}), hookGranted: () => true, overLimit: () => false, limitMessage: () => 'slow down',
          phaseCover: { refusal, move: (space, d) => { moved.push(d); return { moved: true, before: {}, label: 'Trip' }; }, putBack: () => { moved.push('back'); } },
        });
        const effects = effectsOf({ phaseEnd: { date: '2027-01-05' } }, { own: () => true, phaseEnd: true });
        const args = { effects, who: { user: { key: 'a1' } }, space: { id: 's1', members: [] }, found: { manifest: { id: 'fixture-notes', hooks: {} } }, ctx: { scopeKey: 'space:s1', by: 'a1' } };
        const SENTENCE = 'Only someone who can write in a module that is on in this space can move its dates.';
        const kept = fxOf(() => SENTENCE).apply(args);
        assert.deepEqual(kept, { done: { phaseEnd: { moved: false, why: SENTENCE } }, note: `The last day was not moved to 2027-01-05: ${SENTENCE}` });
        assert.deepEqual(moved, [], 'nothing was moved, and nothing put back');
        const may = fxOf(() => null).apply(args);
        assert.deepEqual([may, moved], [{ done: { phaseEnd: { moved: true, end: '2027-01-05' } } }, ['2027-01-05']]);
        assert.equal(effectsOf({ phaseEnd: { date: '2027-01-05' } }, { own: () => true }).fault, 'phaseEnd', 'not declared: a fault');
        // The right itself, on this server: a member whose role may write in no module is refused by the cover route, as before.
      });

    } finally {
      for (const id of [camp, lodge, annex]) await call('PATCH', `/api/spaces/${id}`, { cookie: admin, body: { phases: null } });
      ok(await call('PATCH', '/api/settings', { cookie: admin, body: { template: 'default' } }), 'back to the default template');
    }
    await test('phaseEnd: without phases nothing moves and the request is done', async () => {
      const r = await pfx({ writes: [noteWrite('pe9')], phaseEnd: { date: day(50) } });
      ok(r, 'no phases');
      assert.deepEqual([r.json.ok, r.json.effects], [true, undefined]);
      assert.deepEqual(await phasesOf(camp), {});
    });
  }

  await test('effects: the handler still has no network, no environment and no way to load a module', async () => {
    as = fxAgents[1];
    const r = await probe('network');
    ok(r, 'the probe');
    assert.deepEqual((await data())['probe:network'].value, { fetch: 'undefined', XMLHttpRequest: 'undefined', WebSocket: 'undefined', EventSource: 'undefined', navigator: 'undefined', require: 'undefined', process: 'undefined', env: 'blocked', imports: 'blocked,blocked,blocked,blocked,blocked,blocked' });
    // What it answers is data: a function, a getter or a pointer to a service in `links`, `schedules` or `notify` is not carried out.
    const { effectsOf } = require(path.join(ROOT, 'server', 'action-effects.js'));
    const own = (ref) => ref.module === 'fixture-notes' && ref.space === 'here';
    const mine = { module: 'fixture-notes', kind: 'note', id: 'a', scope: 'space', space: 'here' };
    assert.deepEqual(effectsOf({}, { own }), { links: [], schedules: [], notify: [] });
    assert.equal(effectsOf({ links: [{ add: { from: mine, to: Object.create({ module: 'x' }) } }] }, { own }).fault, 'result');
    assert.equal(effectsOf({ links: [{ add: { from: { ...mine, id: 7 }, to: mine } }] }, { own }).fault, 'result');
    assert.equal(effectsOf({ schedules: [{ set: { key: 'k', at: Infinity, about: mine } }] }, { own }).fault, 'result');
    assert.equal(effectsOf({ schedules: [{ set: { key: 'k', at: 1, about: mine, repeat: { every: 'day', run: 'x' } } }] }, { own }).fault, 'result');
    assert.equal(effectsOf({ notify: [{ title: '   ' }] }, { own }).fault, 'result');
    assert.equal(effectsOf({ notify: [{ title: 'x'.repeat(401) }] }, { own }).fault, 'result');
  });

  // GitHub #1117, item 1: a pointer to another of the agent's spaces is refused at once for a module the server carries,
  // and nothing is queued; an uploaded copy keeps the page path for the very same request.
  const OUTSIDE = 'A change here can only point to this space or to things kept for everyone.';
  let lodgeTask = null;
  await test('To-do on the server: a pointer to a task in another of the agent\'s spaces is refused, nothing queued', async () => {
    as = todoAgent;
    const lodgeMembers = (await call('GET', `/api/spaces/${lodge}`, { cookie: admin })).json.space.members;
    ok(await call('PATCH', `/api/spaces/${lodge}`, { cookie: admin, body: { members: [...lodgeMembers, todoAgent.key] } }), 'the To-do agent joins the Lodge');
    const made = await call('POST', `/api/spaces/${lodge}/action`, { ...T(), body: { action: 'todo:createTask', input: { title: 'In the Lodge' } } });
    ok(made, 'a task in the Lodge');
    lodgeTask = made.json.ref;
    assert.equal(lodgeTask.space, lodge);
    const before = JSON.stringify(await todoData());
    const ids = busIds();
    const r = await askIn('todo:updateTask', { task: lodgeTask, title: 'Moved' });
    ok(r, 'refused', 403);
    assert.deepEqual(r.json, { error: OUTSIDE });
    assert.deepEqual(busIds(), ids, 'nothing queued for a page');
    assert.equal(JSON.stringify(await todoData()), before, 'nothing written');
  });

  await test('the same request through an uploaded copy of To-do is refused at once and never reaches the runner or a page', async () => {
    as = todoAgent;
    const up = path.join(base, 'variants', 'todo-upload');
    fs.cpSync(path.join(ROOT, 'modules', 'todo'), up, { recursive: true });
    const m = JSON.parse(fs.readFileSync(path.join(up, 'module.json'), 'utf8'));
    m.version = '9.9.9';
    delete m.actions.server;
    fs.writeFileSync(path.join(up, 'module.json'), JSON.stringify(m, null, 2));
    ok(await call('POST', '/api/modules', { cookie: admin, raw: zipOf(up), headers: { 'content-type': 'application/zip' } }), 'the upload installs', 201);
    const before = JSON.stringify(await todoData());
    const ids = busIds();
    for (const t of [task, lodgeTask]) {
      const r = await askIn('todo:updateTask', { task: t, title: 'Waits' });
      ok(r, 'refused at once', 409);
      assert.deepEqual(r.json, { error: 'To-do has no actions that run on the server, so it can\'t do this for an agent.' });
    }
    assert.deepEqual(busIds(), ids, 'nothing queued for a page');
    assert.equal(JSON.stringify(await todoData()), before, 'nothing written');
  });

  await test('a request the server was carrying when it stopped reads as done and failed after a restart', async () => {
    as = agents[6];
    const asked = ask('probe', { what: 'loop' }).catch(() => null);
    await sleep(300);
    const carrying = busFile().actions.at(-1);
    assert.equal(carrying.server, true, 'the server holds it');
    assert.equal(carrying.status, 'claimed');
    await server.stop('SIGKILL');
    await asked;
    server = await startServer(dir, ENV);
    const status = await call('GET', `/api/spaces/${camp}/action/${carrying.id}`, T());
    ok(status, 'request_status');
    assert.deepEqual(status.json, { id: carrying.id, status: 'done', ok: false, error: STOPPED });
    const claim = await call('POST', '/api/bus/actions/claim', { cookie: miaC, body: { module: 'fixture-notes', id: carrying.id, scope: 'space', space: camp } });
    assert.equal(claim.json.ok, false, 'no page takes it after the restart');
  });

  await test('an uploaded module without server actions: may false with why, refused at once (409), nothing queued, no wait', async () => {
    as = agent;
    const dirUp = variant('upload-plain', (m) => { m.id = 'fixture-upload'; m.name = 'Fixture upload'; delete m.actions.server; for (const a of m.actions.provides) delete a.phaseEnd; });
    ok(await call('POST', '/api/modules', { cookie: admin, raw: zipOf(dirUp), headers: { 'content-type': 'application/zip' } }), 'installs', 201);
    ok(await call('PATCH', '/api/modules/fixture-upload', { cookie: admin, body: { enabled: true, allSpaces: true } }), 'on');
    const NONE = 'Fixture upload has no actions that run on the server, so it can\'t do this for an agent.';
    const entry = (await call('GET', `/api/spaces/${camp}/actions`, T())).json.actions.find((a) => a.action === 'fixture-upload:addNote');
    assert.deepEqual([entry.may, entry.now, entry.why, entry.waiting], [false, false, NONE, undefined]);
    const ids = busIds();
    const r = await call('POST', `/api/spaces/${camp}/action`, { ...T(), body: { action: 'fixture-upload:addNote', input: { title: 'Waits' } } });
    ok(r, 'refused at once', 409);
    assert.deepEqual(r.json, { error: NONE });
    assert.deepEqual(busIds(), ids, 'nothing queued');
    // A person's own request still goes to a page (Chat's Keep, Send to...).
    const mine = await call('POST', `/api/spaces/${camp}/action`, { cookie: miaC, body: { action: 'fixture-upload:addNote', input: { title: 'Mia asks' } } });
    ok(mine, 'a person asks');
    assert.equal(mine.json.status, 'pending');
    assert.equal(mine.json.waiting, undefined);
    ok(await call('DELETE', '/api/modules/fixture-upload?keepData=0', { cookie: admin }), 'uninstalled');
  });

  await test('on a server without the network wall, an uploaded module with server actions installs, may be approved, and is refused at once', async () => {
    as = agent;
    const dirUp = variant('upload-server', (m) => { m.id = 'fixture-upload'; m.name = 'Fixture upload'; for (const a of m.actions.provides) delete a.phaseEnd; });
    // The repository's own probe library names everything on the module check's list on purpose: as an upload it is refused
    // for that. The upload fixture is what an outside author could send.
    const named = await call('POST', '/api/modules', { cookie: admin, raw: zipOf(dirUp), headers: { 'content-type': 'application/zip' } });
    ok(named, 'the probe library as an upload is refused', 400);
    assert.match(named.json.error, /is not given to a module's actions on the server/);
    ok(await call('POST', '/api/modules', { cookie: admin, raw: zipOf(UPLOAD_FIXTURE), headers: { 'content-type': 'application/zip' } }), 'the upload fixture installs', 201);
    ok(await call('PATCH', '/api/modules/fixture-upload', { cookie: admin, body: { enabled: true, allSpaces: true } }), 'on');
    const view = (await call('GET', '/api/modules', { cookie: admin })).json.modules.find((x) => x.id === 'fixture-upload');
    assert.equal(view.serverRun.wall, false, 'no wall here (ACTION_RUNNER_NETWORK is not set)');
    assert.equal(view.serverRun.why, 'This server doesn\'t run uploaded modules\' actions for agents: ACTION_RUNNER_NETWORK is not namespace.');
    assert.equal(view.serverRun.approved, false);
    ok(await call('POST', '/api/modules/fixture-upload/server-run', { cookie: admin, body: { version: '1.0.0', sha256: view.serverRun.sha256 } }), 'the admin may approve before the wall is there');
    const WALL = 'This server doesn\'t run uploaded modules\' actions for agents.';
    const entry = (await call('GET', `/api/spaces/${camp}/actions`, T())).json.actions.find((a) => a.action === 'fixture-upload:addNote');
    assert.deepEqual([entry.may, entry.now, entry.why], [false, false, WALL]);
    const ids = busIds();
    const r = await call('POST', `/api/spaces/${camp}/action`, { ...T(), body: { action: 'fixture-upload:addNote', input: { title: 'No wall' } } });
    ok(r, 'refused at once', 409);
    assert.deepEqual(r.json, { error: WALL });
    assert.deepEqual(busIds(), ids, 'nothing queued');
    ok(await call('DELETE', '/api/modules/fixture-upload?keepData=0', { cookie: admin }), 'uninstalled');
  });

  // --- writes outside the space, and the place search (plan-agent-server-actions.md, sections 3 and 4, step 9) ---------------
  // fixture-shared is the fixture with environment data: its notes carry space marks (`spaces`), its memos carry none.
  ok(await call('POST', '/api/modules/bundled/fixture-shared/install', { cookie: admin, body: {} }), 'fixture-shared installs', 201);
  ok(await call('PATCH', '/api/modules/fixture-shared', { cookie: admin, body: { enabled: true, allSpaces: true } }), 'fixture-shared on');
  const shAgents = [];
  for (let i = 0; i < 8; i += 1) {
    const a = (await call('POST', '/api/users', { cookie: admin, body: { agent: true } })).json.user;
    shAgents.push(a);
    await newToken(a);
  }
  for (const id of [camp, lodge]) {
    const members = (await call('GET', `/api/spaces/${id}`, { cookie: admin })).json.space.members;
    ok(await call('PATCH', `/api/spaces/${id}`, { cookie: admin, body: { members: [...members, ...shAgents.map((a) => a.key)] } }), 'the agents for this part join');
  }
  const SH = 'fixture-shared';
  const SHN = 'Fixture shared could not carry that out: ';
  const sx = (plan, { module = SH, space = camp } = {}) => call('POST', `/api/spaces/${space}/action`, { ...T(), body: { action: `${module}:effects`, input: { plan: JSON.stringify(plan) } } });
  const shItems = async (query) => Object.fromEntries((await call('GET', `/api/modules/${SH}/data?${query}`, { cookie: admin })).json.items.map((i) => [i.key, i]));
  const envItems = () => shItems('scope=environment');
  const shAll = async () => {
    const pick = (items) => Object.fromEntries(Object.entries(items).map(([k, i]) => [k, i.value]));
    return { environment: pick(await envItems()), camp: pick(await shItems(`scope=space&space=${camp}`)), lodge: pick(await shItems(`scope=space&space=${lodge}`)) };
  };
  const envNote = (id, marks, extra = {}) => ({ key: `note:${id}`, scope: 'environment', value: { title: id, byKey: as.key, by: 'Claude', ...(marks ? { spaces: marks } : {}), ...extra } });
  const envRef = (id) => ({ module: SH, kind: 'note', id, scope: 'environment' });
  const nothingChanged = async (r, status, sentence, before) => {
    ok(r, sentence, status);
    assert.equal(r.json.status, 'done');
    assert.equal(r.json.ok, false);
    assert.equal(r.json.error, sentence);
    assert.deepEqual(await shAll(), before, 'nothing was changed, in the environment or the space');
  };
  // An environment note only Fort is marked on, made by the admin: the agents are not in Fort.
  ok(await call('PUT', `/api/modules/${SH}/data/note:fortonly?scope=environment`, { cookie: admin, body: { value: { title: 'Fort only', spaces: [fort] } } }), 'the admin makes an environment note for Fort');

  as = shAgents[0];
  await test('an environment write that marks the request\'s space is made, as the agent, with its pointer, and read back', async () => {
    const r = await sx({ writes: [{ key: 'note:s1', value: { title: 's1', byKey: as.key, by: 'Claude' } }, envNote('e1', [camp])], ref: envRef('e1') });
    ok(r, 'an environment write');
    assert.equal(r.json.ok, true, r.text);
    assert.deepEqual(r.json.ref, envRef('e1'), 'the pointer is the environment object it made');
    const stored = (await envItems())['note:e1'];
    assert.deepEqual(stored.value.spaces, [camp]);
    assert.equal(stored.by, as.key, 'the write is the agent\'s');
    assert.ok((await shItems(`scope=space&space=${camp}`))['note:s1'], 'and the space write beside it');
    // Read back by a handler: what is marked for this space, and nothing else of the environment.
    const read = await call('POST', `/api/spaces/${camp}/action`, { ...T(), body: { action: `${SH}:shared`, input: { key: 'note:e1', address: 'Not searched' } } });
    ok(read, 'shared');
    const seen = (await shItems(`scope=space&space=${camp}`))['probe:shared'].value;
    assert.deepEqual(seen.keys, ['note:e1'], 'only the environment objects marked for this space');
    assert.equal(seen.one.title, 'e1');
    assert.equal(seen.inSpace, null, 'the space\'s own data is another place');
    assert.equal(seen.lookups, false, 'no place search for an action that declares none');
    // Changed, by a second request, with its marks as they were.
    const edit = await sx({ writes: [envNote('e1', [camp], { title: 'e1 again' })], ref: envRef('e1') });
    ok(edit, 'an edit');
    assert.equal(edit.json.ok, true, edit.text);
    const after = (await envItems())['note:e1'];
    assert.equal(after.value.title, 'e1 again');
    assert.equal(after.version, stored.version + 1);
    // From another of the agent's spaces it is not there to read, and a write over it is refused whole.
    const before = await shAll();
    const elsewhere = await call('POST', `/api/spaces/${lodge}/action`, { ...T(), body: { action: `${SH}:shared`, input: { key: 'note:e1' } } });
    ok(elsewhere, 'shared, from Lodge');
    const there = (await shItems(`scope=space&space=${lodge}`))['probe:shared'].value;
    assert.deepEqual(there.keys, [], 'Lodge is not marked on it');
    assert.equal(there.one, null);
    const all = await shAll();
    assert.deepEqual(all.environment, before.environment);
    await nothingChanged(await sx({ writes: [envNote('e1', [camp, lodge])] }, { space: lodge }), 409, CHANGED, all);
  });

  as = shAgents[1];
  await test('hostile environment writes: no mark, another kind, another module, other spaces\' marks, an object of another space, too many', async () => {
    // One the agent made, which the admin then also marks for Fort.
    ok(await sx({ writes: [envNote('e2', [camp])] }), 'e2');
    const e2 = (await envItems())['note:e2'];
    ok(await call('PUT', `/api/modules/${SH}/data/note:e2?scope=environment`, { cookie: admin, body: { value: { ...e2.value, spaces: [camp, fort] }, version: e2.version } }), 'the admin marks it for Fort too');
    const before = await shAll();
    const unmarked = `${SHN}it tried to write environment data that is not marked for this space.`;
    const marks = `${SHN}it tried to change which other spaces environment data is marked for.`;
    const notShared = `${SHN}it tried to write environment data other than its own objects that are marked for spaces.`;
    const place = `${SHN}it tried to write outside its own data in this space.`;
    await nothingChanged(await sx({ writes: [envNote('h1', [])] }), 500, unmarked, before);
    await nothingChanged(await sx({ writes: [envNote('h1', null)] }), 500, unmarked, before);
    await nothingChanged(await sx({ writes: [envNote('h1', [fort])] }), 500, unmarked, before);
    await nothingChanged(await sx({ writes: [envNote('h1', camp)] }), 500, unmarked, before);
    await nothingChanged(await sx({ writes: [{ key: 'note:h1', scope: 'environment', value: 'note' }] }), 500, unmarked, before);
    // A new one may mark this space only; one that is there keeps its other marks exactly.
    await nothingChanged(await sx({ writes: [envNote('h1', [camp, fort])] }), 500, marks, before);
    await nothingChanged(await sx({ writes: [envNote('h1', [camp, lodge])] }), 500, marks, before);
    await nothingChanged(await sx({ writes: [envNote('e2', [camp])] }), 500, marks, before);
    await nothingChanged(await sx({ writes: [envNote('e2', [camp, fort, lodge])] }), 500, marks, before);
    // An object of a space the agent is not in: never taken over by adding this space's mark.
    await nothingChanged(await sx({ writes: [envNote('fortonly', [camp, fort])] }), 409, CHANGED, before);
    await nothingChanged(await sx({ writes: [envNote('fortonly', [camp])] }), 409, CHANGED, before);
    as = shAgents[4]; // the next agent: each has 20 writes a minute
    // Only the module's own kind that carries marks: not its other kind, not a key of no kind, not another module's.
    await nothingChanged(await sx({ writes: [{ key: 'memo:m1', scope: 'environment', value: { title: 'm', spaces: [camp] } }] }), 500, notShared, before);
    await nothingChanged(await sx({ writes: [{ key: 'probe:p1', scope: 'environment', value: { spaces: [camp] } }] }), 500, notShared, before);
    await nothingChanged(await sx({ writes: [{ key: 'place:abc', scope: 'environment', value: { title: 'A place', spaces: [camp] } }] }), 500, notShared, before);
    await nothingChanged(await sx({ writes: [{ key: 'note:../x', scope: 'environment', value: { title: 'x', spaces: [camp] } }] }), 500, notShared, before);
    await nothingChanged(await sx({ writes: [{ ...envNote('h1', [camp]), module: 'maps' }] }), 500, place, before);
    await nothingChanged(await sx({ writes: [{ ...envNote('h1', [camp]), space: fort }] }), 500, place, before);
    await nothingChanged(await sx({ writes: [{ ...envNote('h1', [camp]), scope: 'host' }] }), 500, place, before);
    await nothingChanged(await sx({ writes: [envNote('h1', [camp])], ref: envRef('other') }), 500, `${SHN}it pointed at something that is not its own in this space.`, before);
    // More than the count, across both places.
    const many = [...Array.from({ length: 6 }, (_, i) => envNote(`m${i}`, [camp])), ...Array.from({ length: 5 }, (_, i) => ({ key: `note:n${i}`, value: { title: 'n', byKey: as.key, by: 'Claude' } }))];
    await nothingChanged(await sx({ writes: many }), 500, `${SHN}it tried to change more than 10 things at once.`, before);
  });

  // GitHub #1117, item 1 (decision 8: nothing waits for a page): a pointer to the module's own objects that is not in this
  // space nor an environment object marked for it is refused with one sentence, and no request is made for a page.
  as = shAgents[7];
  await test('hostile pointers to a server-carried module\'s own objects: another space, the environment unmarked, a person\'s, refused and nothing queued', async () => {
    const OUTSIDE = 'A change here can only point to this space or to things kept for everyone.';
    ok(await call('PUT', `/api/modules/${SH}/data/note:lodgeonly?scope=environment`, { cookie: admin, body: { value: { title: 'Lodge only', spaces: [lodge] } } }), 'an environment note for the Lodge only');
    ok(await call('PUT', `/api/modules/${SH}/data/note:bare?scope=environment`, { cookie: admin, body: { value: { title: 'Marked for none' } } }), 'an environment note marked for no space');
    ok(await call('PUT', `/api/modules/${SH}/data/memo:mm?scope=environment`, { cookie: admin, body: { value: { title: 'A memo' } } }), 'an environment memo (a kind with no marks)');
    ok(await call('PUT', `/api/modules/${SH}/data/note:inlodge?scope=space&space=${lodge}`, { cookie: admin, body: { value: { title: 'In the Lodge' } } }), 'a note in the Lodge');
    const pointAt = (input) => call('POST', `/api/spaces/${camp}/action`, { ...T(), body: { action: `${SH}:pointAt`, input } });
    const before = await shAll();
    const cases = [
      ['another of the agent\'s spaces', { note: { module: SH, kind: 'note', id: 'inlodge', scope: 'space', space: lodge } }],
      ['a space the agent is not in', { note: { module: SH, kind: 'note', id: 'x1', scope: 'space', space: fort } }],
      ['an environment note marked for another of its spaces only', { note: envRef('lodgeonly') }],
      ['an environment note marked for a space it is not in', { note: envRef('fortonly') }],
      ['an environment note marked for none', { note: envRef('bare') }],
      ['an environment object of a kind with no marks', { memo: { module: SH, kind: 'memo', id: 'mm', scope: 'environment' } }],
      ['a person\'s own', { note: { module: SH, kind: 'note', id: 'p1', scope: 'person' } }],
      ['the host\'s', { note: { module: SH, kind: 'note', id: 'h1', scope: 'host' } }],
      ['not a pointer', { note: 'note:e1' }],
    ];
    for (const [what, input] of cases) {
      const ids = busIds();
      const r = await pointAt(input);
      ok(r, what, 403);
      assert.deepEqual(r.json, { error: OUTSIDE }, what);
      assert.deepEqual(busIds(), ids, `${what}: nothing queued for a page`);
    }
    assert.deepEqual(await shAll(), before, 'nothing was changed');
    // The control: an environment note marked for this space is the server's to carry (the fixture has no handler for it).
    const ids = busIds();
    const here = await pointAt({ note: envRef('e1') });
    assert.equal(here.json.status, 'done', here.text);
    assert.notEqual(here.json.error, OUTSIDE);
    const carried = busFile().actions.find((a) => a.id === here.json.id);
    assert.ok(carried && carried.server && !ids.includes(carried.id), 'carried by the server, never a page\'s');
  });

  as = shAgents[2];
  await test('a module with no environment data, a write for the person, and the Agent column\'s write row', async () => {
    const before = await shAll();
    const beforeNotes = await data();
    // The fixture itself has only the space scope.
    const plain = await sx({ writes: [{ key: 'note:envx', scope: 'environment', value: { title: 'x', byKey: as.key, by: 'Claude', spaces: [camp] } }] }, { module: 'fixture-notes' });
    faultSentence(plain, 'it tried to write outside its own data in this space');
    assert.deepEqual(Object.keys(await data()).sort(), Object.keys(beforeNotes).sort(), 'nothing written');
    // An agent has no data of its own: the whole request is refused, the space write before it included.
    const person = 'An agent has no places of its own; save it for this space or for everyone.';
    await nothingChanged(await sx({ writes: [{ key: 'note:mine', scope: 'person', value: { title: 'mine', byKey: as.key, by: 'Claude' } }] }), 403, person, before);
    await nothingChanged(await sx({ writes: [{ key: 'note:s9', value: { title: 's9', byKey: as.key, by: 'Claude' } }, envNote('e9', [camp]), { key: 'note:mine', scope: 'person', value: { title: 'mine' } }] }), 403, person, before);
    // Without the module's write permission in the Agent column nothing is asked for at all.
    ok(await call('PATCH', '/api/roles/agent', { cookie: admin, body: { [`module.${SH}.edit`]: false } }), 'the write row off');
    const refused = await sx({ writes: [envNote('e9', [camp])] });
    assert.equal(refused.status, 403, refused.text);
    assert.deepEqual(await shAll(), before, 'nothing was changed');
    ok(await call('PATCH', '/api/roles/agent', { cookie: admin, body: { [`module.${SH}.edit`]: true } }), 'the write row back');
  });

  await test('one refusal puts back the environment writes with everything else', async () => {
    const spaceNote = (id) => ({ key: `note:${id}`, value: { title: id, byKey: as.key, by: 'Claude' } });
    const before = await shAll();
    // A link that can't be made, after a space write and an environment write.
    const link = await sx({ writes: [spaceNote('u1'), envNote('u2', [camp])], links: [{ add: { from: { module: SH, kind: 'note', id: 'u1', scope: 'space', space: camp }, to: { module: SH, kind: 'note', id: 'nowhere', scope: 'space', space: camp } } }] });
    assert.equal(link.json.ok, false, link.text);
    assert.ok(link.status >= 400 && link.status < 500, `refused: ${link.status}`);
    assert.match(link.json.error, /^Nothing was changed: /);
    assert.deepEqual(await shAll(), before, 'both writes are gone');
    // A space write the guards refuse, after an environment write.
    const guards = await sx({ writes: [envNote('u3', [camp]), { key: 'zzz:9', value: {} }] });
    assert.equal(guards.json.ok, false, guards.text);
    assert.deepEqual(await shAll(), before, 'the environment write is gone');
    // An environment write the guards refuse (someone else named as its maker), after a space write.
    const maker = await sx({ writes: [spaceNote('u4'), envNote('u5', [camp], { byKey: mia.key, by: 'Mia' })] });
    assert.equal(maker.json.ok, false, maker.text);
    assert.equal(maker.status, 403, 'the guards hold an environment write as they hold any');
    assert.deepEqual(await shAll(), before, 'the space write is gone');
    // An environment object that was there is put back as it was.
    ok(await sx({ writes: [envNote('u6', [camp])] }), 'u6');
    const made = await shAll();
    const edit = await sx({ writes: [envNote('u6', [camp], { title: 'changed' }), { key: 'zzz:9', value: {} }] });
    assert.equal(edit.json.ok, false, edit.text);
    assert.deepEqual(await shAll(), made, 'its earlier value is back');
  });

  as = shAgents[5];
  await test('the same answers on both carriers: environment reads and writes, their refusals and a write for the person, on the server and through the SDK\'s page adapter', async () => {
    const { onPage } = await import('./module-actions-harness.mjs');
    const { libraryOf } = require(path.join(ROOT, 'server', 'module-build.js'));
    const shDir = path.join(app, 'modules', SH);
    const handlers = new Function(`${libraryOf(shDir, SH).js}\nreturn ACTION_HANDLERS;`)();
    const shManifest = JSON.parse(fs.readFileSync(path.join(shDir, 'module.json'), 'utf8'));
    const produces = shManifest.refs.produces.map((p) => ({ kind: p.kind, key: p.key, ...(p.summary.spaces ? { marks: p.summary.spaces } : {}) }));
    const now = await shAll();
    const versions = Object.fromEntries(Object.entries(await envItems()).map(([k, i]) => [k, i.version]));
    // The page's world is the server's as it is now: this space's data, and every environment object (the adapter reads only
    // those marked here, as the server hands them).
    const world = { space: { id: camp, name: 'Camp' }, rows: now.camp, shared: now.environment };
    const page = (plan, o = {}) => onPage(SH, 'effects', { plan: JSON.stringify(plan) }, world, { handlers, produces, name: 'Fixture shared', credit: { name: 'Claude (agent)', key: as.key }, ...o });
    const cases = [
      ['no mark', { writes: [envNote('p1', [])] }],
      ['another space\'s mark only', { writes: [envNote('p1', [fort])] }],
      ['a new one marking another space', { writes: [envNote('p1', [camp, lodge])] }],
      ['another kind', { writes: [{ key: 'memo:p1', scope: 'environment', value: { title: 'm', spaces: [camp] } }] }],
      ['a key of no kind', { writes: [{ key: 'probe:p1', scope: 'environment', value: { spaces: [camp] } }] }],
      ['an object not marked here', { writes: [envNote('fortonly', [camp, fort])] }],
      ['a write for the person', { writes: [{ key: 'note:mine', scope: 'person', value: { title: 'mine' } }] }],
      ['a pointer to an environment object it does not write', { writes: [envNote('p2', [camp])], ref: envRef('p3') }],
    ];
    for (const [what, plan] of cases) {
      const r = await sx(plan);
      assert.equal(r.json.ok, false, `${what}: refused on the server`);
      const p = await page(plan);
      assert.equal(p.refused, r.json.error, `${what}: the page gives the server's sentence`);
    }
    assert.deepEqual(await shAll(), now, 'nothing was changed by the refusals');
    // The person's own data stays the page person's own: refused for an agent's request (above), made for their own.
    const mine = await page({ writes: [{ key: 'note:mine', scope: 'person', value: { title: 'mine' } }] }, { asker: 'self' });
    assert.deepEqual(mine.writes, [{ key: 'note:mine', value: { title: 'mine' }, scope: 'person' }]);
    const other = await page({ writes: [{ key: 'note:mine', scope: 'person', value: { title: 'mine' } }] }, { asker: 'other', credit: { name: 'Mia', key: mia.key } });
    assert.deepEqual(other, { refused: 'Only that person can save it for themselves.', status: 403 }, 'never from someone else\'s request');
    // A write that stands: the same writes and the same pointer both ways, and what a handler reads back the same.
    const plan = { writes: [envNote('both1', [camp])], ref: envRef('both1') };
    const p = await page(plan);
    const r = await sx(plan);
    ok(r, 'made on the server');
    assert.deepEqual(p.writes, [plan.writes[0]], 'the page writes it with its scope');
    assert.deepEqual(r.json.ref, p.ref, 'the same pointer');
    const reads = await onPage(SH, 'shared', { key: 'note:e1' }, world, { handlers, produces, name: 'Fixture shared' });
    const seenPage = reads.writes.find((w) => w.key === 'probe:shared').value;
    ok(await call('POST', `/api/spaces/${camp}/action`, { ...T(), body: { action: `${SH}:shared`, input: { key: 'note:e1' } } }), 'shared');
    const seenServer = (await shItems(`scope=space&space=${camp}`))['probe:shared'].value;
    assert.deepEqual(seenPage.keys, now && Object.keys(now.environment).filter((k) => /^note:/.test(k) && Array.isArray(now.environment[k].spaces) && now.environment[k].spaces.includes(camp)).sort(), 'the page reads the environment objects marked here');
    assert.deepEqual(seenPage.keys, seenServer.keys.filter((k) => k !== 'note:both1'), 'and the server the same (with the one it made since)');
    assert.deepEqual(seenPage.one, seenServer.one);
    assert.equal(versions['note:e1'] > 0, true);
  });

  as = shAgents[6];
  await test('the place search on both carriers: ctx.lookups from the page\'s host.geocode.search is cut as the server cuts it', async () => {
    const { onPage } = await import('./module-actions-harness.mjs');
    const { libraryOf } = require(path.join(ROOT, 'server', 'module-build.js'));
    const handlers = new Function(`${libraryOf(path.join(app, 'modules', SH), SH).js}\nreturn ACTION_HANDLERS;`)();
    const long = (i) => ({ title: `Cafe ${i} ${'x'.repeat(400)}`, sub: `Rua ${'y'.repeat(400)}`, lat: 38.7 + i / 100, lng: -9.1 - i / 100, key: `osm:${i}`, osm: 'amenity:cafe', source: 'service' });
    const world = { space: { id: camp, name: 'Camp' }, rows: {}, geocode: Array.from({ length: 8 }, (_, i) => long(i)) };
    const got = (await onPage(SH, 'find', { address: 'Rua Augusta 1' }, world, { handlers, lookups: { find: { address: 'geocode' } }, name: 'Fixture shared' })).writes[0].value;
    assert.equal(got.has, true);
    assert.equal(got.lookups.address.length, 6, 'at most 6');
    assert.deepEqual(Object.keys(got.lookups.address[0]), ['title', 'sub', 'lat', 'lng', 'key'], 'only these');
    assert.equal(got.lookups.address[0].title.length, 200);
    assert.equal(got.lookups.address[0].sub.length, 300);
    assert.equal(got.plain, true);
    const short = (await onPage(SH, 'find', { address: 'R' }, world, { handlers, lookups: { find: { address: 'geocode' } }, name: 'Fixture shared' })).writes[0].value;
    assert.deepEqual(short.lookups, { address: [] }, 'one character: nothing searched');
    const none = (await onPage(SH, 'shared', {}, world, { handlers, lookups: { find: { address: 'geocode' } }, name: 'Fixture shared' })).writes[0].value;
    assert.equal(none.lookups, false, 'an action that declares none gets nothing');
  });

  as = shAgents[3];
  await test('the place search: nothing asked with no service; only the declared text leaves; small plain results; no way to ask again', async () => {
    // A stand-in for the outside service, which keeps everything it is sent.
    const asked = [];
    const feature = (i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [-9.1 - i / 100, 38.7 + i / 100] }, properties: { name: `Cafe ${i} ${'x'.repeat(400)}`, street: `Rua ${'y'.repeat(400)}`, city: 'Lisboa', country: 'Portugal', osm_type: 'N', osm_id: 1000 + i, osm_key: 'amenity', osm_value: 'cafe', secret: 'never passed on' } });
    const service = http.createServer((req, res) => {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        asked.push({ method: req.method, url: req.url, headers: req.headers, body });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ features: Array.from({ length: 10 }, (_, i) => feature(i)) }));
      });
    });
    await new Promise((r) => service.listen(0, '127.0.0.1', r));
    const find = (input) => call('POST', `/api/spaces/${camp}/action`, { ...T(), body: { action: `${SH}:find`, input } });
    const found = async () => (await shItems(`scope=space&space=${camp}`))['probe:find'].value;
    const reads = async () => (await used()).reads.usedToday;
    try {
      // No service chosen (the default): nothing leaves, and the handler is told so with an empty list.
      const r0 = await reads();
      ok(await find({ address: 'Rua Augusta 1, Lisboa', title: 'Private title' }), 'find, no service');
      const d0 = (await reads()) - r0;
      let got = await found();
      assert.equal(got.has, true);
      assert.deepEqual(got.lookups, { address: [] });
      assert.equal(asked.length, 0, 'nothing was sent anywhere');
      // A service chosen by the admin.
      ok(await call('PUT', `/api/modules/${SH}/settings/environment`, { cookie: admin, body: { values: { searchProvider: 'custom', search: `http://127.0.0.1:${service.address().port}/api` } } }), 'the admin chooses a service');
      const r1 = await reads();
      ok(await find({ address: '  Rua Augusta\n1,   Lisboa ', title: 'Private title', notes: 'Private notes about the trip' }), 'find');
      const d1 = (await reads()) - r1;
      assert.equal(asked.length, 1, 'one request left the server');
      const sent = asked[0];
      const url = new URL(sent.url, 'http://127.0.0.1');
      assert.equal(sent.method, 'GET');
      assert.equal(url.pathname, '/api');
      assert.deepEqual([...url.searchParams.keys()].sort(), ['limit', 'q'], 'the text and a count, nothing else');
      assert.equal(url.searchParams.get('q'), 'Rua Augusta 1, Lisboa', 'the declared input\'s text, on one line');
      assert.equal(sent.body, '');
      assert.deepEqual(Object.keys(sent.headers).filter((h) => !['accept', 'user-agent', 'host', 'connection', 'accept-language', 'accept-encoding', 'sec-fetch-mode'].includes(h)), [], 'no header beyond a plain fetch\'s');
      const everythingSent = `${sent.url} ${JSON.stringify(sent.headers)}`;
      for (const secret of ['Private', as.key, camp, tokens.get(as.key), 'Claude', SH, 'Camp']) assert.ok(!everythingSent.includes(secret), `nothing of the request, the agent or the space is sent (${String(secret).slice(0, 12)})`);
      assert.equal(d1, d0 + 1, 'the search is one of the agent\'s reads');
      got = await found();
      const list = got.lookups.address;
      assert.equal(list.length, 6, 'at most six results');
      for (const row of list) {
        assert.deepEqual(Object.keys(row).sort(), ['key', 'lat', 'lng', 'sub', 'title'], 'only the five fields');
        assert.ok(row.title.length <= 200 && row.sub.length <= 300 && row.key.length <= 128, 'each short');
        assert.ok(Number.isFinite(row.lat) && Number.isFinite(row.lng));
      }
      assert.ok(JSON.stringify(got.lookups).length <= 6 * 800, 'the whole answer is small');
      assert.ok(!JSON.stringify(got.lookups).includes('never passed on'), 'nothing of the service\'s answer beyond those fields');
      // The handler has plain data and no way to ask for more: no network, and no function but read and list.
      assert.equal(got.plain, true);
      assert.deepEqual(got.functions, ['list', 'read']);
      assert.deepEqual(got.reach, { fetch: 'undefined', XMLHttpRequest: 'undefined', WebSocket: 'undefined', require: 'undefined', process: 'undefined', setTimeout: 'undefined' });
      assert.equal(asked.length, 1, 'and nothing more was sent while it ran');
      // No text, or one character: nothing is asked. An action that declares no lookup: nothing is asked, whatever its input.
      ok(await find({ title: 'No address' }), 'find, no address');
      assert.deepEqual((await found()).lookups, { address: [] });
      ok(await find({ address: 'R' }), 'find, one character');
      ok(await call('POST', `/api/spaces/${camp}/action`, { ...T(), body: { action: `${SH}:shared`, input: { address: 'Rua Augusta 1, Lisboa' } } }), 'shared');
      assert.equal(asked.length, 1, 'still one request');
      // The agent's reads used up are not gone around: nor is a service that does not answer a failure of the request.
      await new Promise((r) => service.close(r));
      service.closeAllConnections?.();
      const down = await find({ address: 'Rua Garrett 5, Lisboa' });
      ok(down, 'find, the service down');
      assert.equal(down.json.ok, true);
      assert.deepEqual((await found()).lookups, { address: [] }, 'no results, and the handler decides what to say');
    } finally {
      if (service.listening) await new Promise((r) => service.close(r));
      ok(await call('PUT', `/api/modules/${SH}/settings/environment`, { cookie: admin, body: { values: { searchProvider: 'none', search: '' } } }), 'no service again');
    }
  });

  // --- Maps on the server (plan-agent-server-actions.md, step 10): its actions library, the place search before the run ------
  ok(await call('POST', '/api/modules/bundled/maps/install', { cookie: admin, body: {} }), 'Maps installs', 201);
  ok(await call('PATCH', '/api/modules/maps', { cookie: admin, body: { enabled: true, allSpaces: true } }), 'Maps on');
  const mapsAgent = (await call('POST', '/api/users', { cookie: admin, body: { agent: true } })).json.user;
  await newToken(mapsAgent);
  {
    const members = (await call('GET', `/api/spaces/${camp}`, { cookie: admin })).json.space.members;
    ok(await call('PATCH', `/api/spaces/${camp}`, { cookie: admin, body: { members: [...members, mapsAgent.key] } }), 'the Maps agent joins Camp');
  }
  as = mapsAgent;
  await test('Maps: addPlace by address on the server, with a stand-in place search: one clear match, several, none, the search off; where it is kept; a place for the person', async () => {
    const asked = [];
    const feature = (name, lat, lng, id) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: { name, street: 'Main Street', city: 'Springfield', country: 'Somewhere', osm_type: 'N', osm_id: id, osm_key: 'amenity', osm_value: 'cafe' } });
    const service = http.createServer((req, res) => {
      const q = new URL(req.url, 'http://127.0.0.1').searchParams.get('q') || '';
      asked.push(q);
      const features = /^One /.test(q) ? [feature('One Cafe', 38.71, -9.13, 1), feature('One Cafe', 38.71002, -9.13002, 2)]
        : /^Many /.test(q) ? [feature('Many Cafe', 39.9, -83.8, 3), feature('Many Cafe', 39.8, -89.6, 4)] : [];
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ features }));
    });
    await new Promise((r) => service.listen(0, '127.0.0.1', r));
    const add = (input) => call('POST', `/api/spaces/${camp}/action`, { ...T(), body: { action: 'maps:addPlace', input } });
    const places = async (scope) => Object.fromEntries((await call('GET', `/api/modules/maps/data?${scope === 'environment' ? 'scope=environment' : `scope=space&space=${camp}`}`, { cookie: admin })).json.items.map((i) => [i.key, i]));
    const placeOf = async (ref) => (await places(ref.scope))[`place:${ref.id}`];
    try {
      // The search off: nothing leaves the server, the place is saved without a position and the note says why.
      const off = await add({ title: 'Off', address: 'One Main Street' });
      ok(off, 'the search off');
      assert.equal(off.json.status, 'done', 'carried by the server: nothing waits for a page');
      assert.equal(off.json.ok, true, off.text);
      assert.equal(off.json.note, 'Saved without a position, since place search is off. An admin chooses one in the Maps settings.');
      assert.equal(asked.length, 0, 'nothing was sent');
      ok(await call('PUT', '/api/modules/maps/settings/environment', { cookie: admin, body: { values: { searchProvider: 'custom', search: `http://127.0.0.1:${service.address().port}/api` } } }), 'the admin chooses a service');
      // One clear match: the position is set, the place is everyone's and marked for this space, made by the agent.
      const one = await add({ title: 'Breakfast', address: 'One Main Street 1' });
      ok(one, 'one match');
      assert.equal(one.json.ok, true, one.text);
      assert.deepEqual(asked, ['One Main Street 1'], 'only the address left the server');
      assert.equal(one.json.ref.scope, 'environment');
      const stored = await placeOf(one.json.ref);
      assert.deepEqual(stored.value.point, { lat: 38.71, lng: -9.13 });
      assert.deepEqual(stored.value.spaces, [camp], 'an environment place marks the request\'s space');
      assert.equal(stored.by, mapsAgent.key, 'written as the agent');
      assert.match(one.json.note, /^Placed at One Cafe/);
      // A position given beside the address (GitHub #1117, item 4: skipLookupWhen): nothing is searched and no read spent.
      const r0 = (await used()).reads.usedToday;
      const reads = (await used()).reads.usedToday;
      const asking = reads - r0; // what reading the count itself costs
      const placed = await add({ title: 'Given', address: 'One Main Street 9', lat: 40.1, lng: -8.2 });
      ok(placed, 'a position given');
      assert.equal(placed.json.ok, true, placed.text);
      assert.deepEqual(asked, ['One Main Street 1'], 'no search for it');
      assert.deepEqual((await placeOf(placed.json.ref)).value.point, { lat: 40.1, lng: -8.2 });
      assert.equal((await used()).reads.usedToday - reads, asking, 'no read spent on a search it would not use');
      // Several: no position, and the note lists them.
      const many = await add({ title: 'Lunch', address: 'Many Main Street 2', in: 'space' });
      ok(many, 'several matches');
      assert.equal(many.json.ref.scope, 'space');
      assert.equal((await placeOf(many.json.ref)).value.point, undefined);
      assert.match(many.json.note, /^Saved without a position: the address matches more than one place\. Give one with setPlacePoint\. 1\. Many Cafe/);
      assert.equal(many.json.data.results.length, 2);
      // None: no pin, and it says so.
      const none = await add({ title: 'Dinner', address: 'Nowhere Lane 3' });
      ok(none, 'no match');
      assert.equal((await placeOf(none.json.ref)).value.point, undefined);
      assert.equal(none.json.note, 'Saved without a position: found nothing for "Nowhere Lane 3". Give one with setPlacePoint.');
      // findPlace: the matches as the note, nothing written.
      const before = { env: await places('environment'), space: await places('space') };
      const find = await call('POST', `/api/spaces/${camp}/action`, { ...T(), body: { action: 'maps:findPlace', input: { q: 'Many Main Street' } } });
      ok(find, 'findPlace');
      assert.match(find.json.note, /^1\. Many Cafe/);
      // A place for the person: refused for an agent with the sentence, and nothing written.
      for (const where of ['person', 'environment person']) {
        const mine = await add({ title: 'Mine', in: where });
        ok(mine, `in: ${where}`, 403);
        assert.equal(mine.json.error, 'An agent has no places of its own; save it for this space or for everyone.');
      }
      assert.deepEqual({ env: await places('environment'), space: await places('space') }, before, 'nothing was written');
      // The environment place it made, changed and given a position through its pointer, its marks as they were.
      const up = await call('POST', `/api/spaces/${camp}/action`, { ...T(), body: { action: 'maps:updatePlace', input: { place: none.json.ref, title: 'Late dinner' } } });
      ok(up, 'updatePlace');
      const pt = await call('POST', `/api/spaces/${camp}/action`, { ...T(), body: { action: 'maps:setPlacePoint', input: { place: none.json.ref, lat: 41.1, lng: -8.6 } } });
      ok(pt, 'setPlacePoint');
      const after = await placeOf(none.json.ref);
      assert.equal(after.value.title, 'Late dinner');
      assert.deepEqual(after.value.point, { lat: 41.1, lng: -8.6 });
      assert.deepEqual(after.value.spaces, [camp]);
      const listed = (await call('GET', `/api/spaces/${camp}/actions`, T())).json.actions.filter((a) => a.module === 'maps' && a.may !== false);
      assert.ok(listed.length && listed.every((a) => a.now !== false), 'list_actions: every Maps action an agent may ask is done now');
    } finally {
      await new Promise((r) => service.close(r));
      ok(await call('PUT', '/api/modules/maps/settings/environment', { cookie: admin, body: { values: { searchProvider: 'none', search: '' } } }), 'no service again');
    }
  });

  await test('a newer upload of the bundled module itself never reaches the runner, and a rollback to the bundled version is an upload\'s', async () => {
    const dirNext = variant('fixture-next', (m) => { m.version = '1.0.1'; delete m.actions.server; for (const a of m.actions.provides) delete a.phaseEnd; });
    ok(await call('POST', '/api/modules', { cookie: admin, raw: zipOf(dirNext), headers: { 'content-type': 'application/zip' } }), 'installs', 201);
    const ids = busIds();
    const r = await ask('addNote', { title: 'Uploaded now' });
    ok(r, 'refused at once', 409);
    assert.deepEqual(r.json, { error: 'Fixture notes has no actions that run on the server, so it can\'t do this for an agent.' });
    const list = (await call('GET', `/api/spaces/${camp}/actions`, T())).json.actions;
    assert.equal(list.find((a) => a.action === 'fixture-notes:addNote').now, false);
    ok(await call('POST', '/api/modules/fixture-notes/rollback', { cookie: admin, body: { version: '1.0.0' } }), 'rolled back to the bundled files');
    // The module is no longer the deployment's own install: version 1.0.0's copy in DATA_DIR is an upload's, which runs only
    // behind the wall and with the admin's approval, neither of which this server has.
    const still = await ask('addNote', { title: 'Rolled back' });
    ok(still, 'still refused', 409);
    assert.deepEqual(still.json, { error: 'This server doesn\'t run uploaded modules\' actions for agents.' });
    assert.deepEqual(busIds(), ids, 'nothing queued');
  });

  // --- uploaded modules on the server (plan-agent-server-actions.md, decisions 2 and 3, section 8, step 11d) ------------------
  // A second server, told ACTION_RUNNER_NETWORK=namespace, with the upload fixture (tools/fixtures/module-actions/fixture-upload):
  // a library that names nothing the module check refuses but reaches for everything at run time.
  {
    const { MODULE_ACTION_NETWORK_SEAL } = require(path.join(ROOT, 'server', 'module-actions.js'));
    const sealHere = MODULE_ACTION_NETWORK_SEAL();
    const mainServer = server;
    const nsDir = path.join(base, 'data-namespace');
    const SECRET = 'lk-secret-for-the-check-7f3a9c';
    const NS_ENV = { ...ENV, ACTION_RUNNER_NETWORK: 'namespace', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: SECRET };
    server = await startServer(nsDir, NS_ENV);
    const nsLine = /Modules' server actions: [^\n]*/.exec(server.out)?.[0] || '';
    const UP = 'fixture-upload';
    const APPROVAL = 'Needs the admin\'s approval to run on the server.';
    const UPN = 'Fixture upload could not carry that out: ';
    const nsAdmin = await signIn('admin', 'admin-password-1');
    ok(await call('PATCH', '/api/settings', { cookie: nsAdmin, body: { agents: true } }), 'Agents on');
    const owner = (await call('POST', '/api/users', { cookie: nsAdmin, body: { login: 'olga', password: 'olga-password-1', displayName: 'Olga', role: 'owner' } })).json.user;
    const nsMia = (await call('POST', '/api/users', { cookie: nsAdmin, body: { login: 'mia', password: 'mia-password-1', displayName: 'Mia', role: 'member' } })).json.user;
    const upAgents = [];
    for (let i = 0; i < 10; i += 1) upAgents.push((await call('POST', '/api/users', { cookie: nsAdmin, body: { agent: true } })).json.user);
    const nsCamp = (await call('POST', '/api/spaces', { cookie: nsAdmin, body: { name: 'Camp', members: [...upAgents.map((a) => a.key), nsMia.key, owner.key] } })).json.space.id;
    const ownerC = await signIn('olga', 'olga-password-1');
    const nsMiaC = await signIn('mia', 'mia-password-1');
    const nsTokens = new Map();
    for (const a of upAgents) nsTokens.set(a.key, (await call('POST', `/api/users/${a.key}/token`, { cookie: nsAdmin })).json.token);
    let upAs = upAgents[0];
    const UT = () => ({ token: nsTokens.get(upAs.key) });
    const upAsk = (action, input = {}) => call('POST', `/api/spaces/${nsCamp}/action`, { ...UT(), body: { action: `${UP}:${action}`, input } });
    const upProbe = (what, extra = {}) => upAsk('probe', { what, ...extra });
    const upData = async () => Object.fromEntries((await call('GET', `/api/modules/${UP}/data?scope=space&space=${nsCamp}`, { cookie: nsAdmin })).json.items.map((i) => [i.key, i.value]));
    const upView = async () => (await call('GET', '/api/modules', { cookie: nsAdmin })).json.modules.find((x) => x.id === UP);
    const approve = (body, cookie = nsAdmin) => call('POST', `/api/modules/${UP}/server-run`, { cookie, body });
    const upZip = (version, edit) => {
      const d = path.join(base, 'variants', `upload-${version}-${Math.random().toString(36).slice(2)}`);
      fs.cpSync(UPLOAD_FIXTURE, d, { recursive: true });
      const m = JSON.parse(fs.readFileSync(path.join(d, 'module.json'), 'utf8'));
      m.version = version;
      if (edit) edit(m, d);
      fs.writeFileSync(path.join(d, 'module.json'), JSON.stringify(m, null, 2));
      return zipOf(d);
    };
    const installUp = async (version, edit) => ok(await call('POST', '/api/modules', { cookie: nsAdmin, raw: upZip(version, edit), headers: { 'content-type': 'application/zip' } }), `${UP} ${version} installs`, 201);
    const nsBus = () => { try { return JSON.parse(fs.readFileSync(path.join(nsDir, 'modules', 'bus.json'), 'utf8')).actions.map((a) => a.id); } catch { return []; } };
    const installedLib = () => path.join(nsDir, 'modules', UP, 'versions', '1.0.0', 'src', `${UP}-lib-actions.js`);
    const restart = async () => { await server.stop(); server = await startServer(nsDir, NS_ENV); };

    try {
      await installUp('1.0.0');
      ok(await call('PATCH', `/api/modules/${UP}`, { cookie: nsAdmin, body: { enabled: true, allSpaces: true } }), 'on');
      ok(await call('POST', '/api/modules/bundled/fixture-notes/install', { cookie: nsAdmin, body: {} }), 'the bundled fixture installs', 201);
      ok(await call('PATCH', '/api/modules/fixture-notes', { cookie: nsAdmin, body: { enabled: true, allSpaces: true } }), 'on');

      if (!sealHere) {
        await test('namespace asked for, and this machine gives none: uploaded modules\' actions stay off', async () => {
          assert.match(nsLine, /uploaded modules' actions are off, because this server can't make a network namespace/);
          const v = await upView();
          assert.equal(v.serverRun.wall, false);
          const r = await upAsk('addNote', { title: 'No wall' });
          ok(r, 'refused', 409);
          console.log('check-module-actions: this machine gives no network namespace, so an uploaded module\'s run behind the wall was not tried.');
        });
      } else {
        await test('the start-up line, and the admin sees the library\'s hash, the wall and no approval', async () => {
          assert.equal(nsLine, 'Modules\' server actions: bundled modules run in a network namespace; uploaded modules may run, with the admin\'s approval.');
          const v = await upView();
          const { checkModule } = require(path.join(ROOT, 'server', 'module-check.js'));
          const { readZip } = require(path.join(ROOT, 'server', 'modules.js'));
          const checked = checkModule(await readZip(upZip('1.0.0')));
          assert.deepEqual(v.serverRun, { sha256: checked.library, approved: false, approvedVersion: null, by: null, at: null, wall: true, why: null }, 'the hash is the one the validator printed');
          assert.deepEqual(v.findings, [], 'the module check found nothing to advise');
          const bundled = (await call('GET', '/api/modules', { cookie: nsAdmin })).json.modules.find((x) => x.id === 'fixture-notes');
          assert.equal(bundled.serverRun, undefined, 'a bundled module has none');
        });

        await test('unapproved: refused at once (409) with the sentence, shown with may false and why, nothing queued or written', async () => {
          const entry = (await call('GET', `/api/spaces/${nsCamp}/actions`, UT())).json.actions.find((a) => a.action === `${UP}:addNote`);
          assert.deepEqual([entry.may, entry.now, entry.why], [false, false, APPROVAL]);
          const ids = nsBus();
          const r = await upAsk('addNote', { title: 'Too soon' });
          ok(r, 'refused', 409);
          assert.deepEqual(r.json, { error: APPROVAL });
          assert.deepEqual(nsBus(), ids, 'no request made');
          assert.deepEqual(await upData(), {}, 'nothing written');
          // MCP says the same.
          const rpc = (method, params) => call('POST', '/mcp', { ...UT(), body: { jsonrpc: '2.0', id: 1, method, params } });
          const listed = JSON.parse((await rpc('tools/call', { name: 'list_actions', arguments: { space: nsCamp } })).json.result.content[0].text).actions.find((a) => a.action === `${UP}:addNote`);
          assert.deepEqual([listed.may, listed.why], [false, APPROVAL], 'list_actions');
          const viaMcp = await rpc('tools/call', { name: 'ask_for_change', arguments: { space: nsCamp, action: `${UP}:addNote`, input: { title: 'Too soon' } } });
          assert.equal(viaMcp.json.result.isError, true);
          assert.equal(viaMcp.json.result.content[0].text, APPROVAL);
        });

        await test('who may approve: the admin only; an owner, a member and an agent are refused; a stale version or hash is 409', async () => {
          const v = await upView();
          const good = { version: '1.0.0', sha256: v.serverRun.sha256 };
          const byOwner = await approve(good, ownerC);
          ok(byOwner, 'an owner', 403);
          assert.equal(byOwner.json.error, 'Only the admin can approve running a module\'s actions on the server.');
          ok(await approve(good, nsMiaC), 'a member', 403);
          const byAgent = await call('POST', `/api/modules/${UP}/server-run`, { ...UT(), body: good });
          ok(byAgent, 'an agent', 403);
          assert.equal(byAgent.json.error, 'An agent can\'t do that.');
          ok(await call('DELETE', `/api/modules/${UP}/server-run`, { ...UT() }), 'an agent takes nothing back', 403);
          ok(await call('DELETE', `/api/modules/${UP}/server-run`, { cookie: ownerC }), 'nor an owner', 403);
          ok(await call('POST', `/api/modules/${UP}/server-run`, { body: good }), 'nobody signed in', 401);
          // Software on another site, with the admin's cookie: the same-origin rule refuses it.
          ok(await call('POST', `/api/modules/${UP}/server-run`, { cookie: nsAdmin, body: good, headers: { origin: 'https://elsewhere.example', 'sec-fetch-site': 'cross-site' } }), 'another site', 403);
          const stale = await approve({ version: '0.9.0', sha256: good.sha256 });
          ok(stale, 'another version', 409);
          assert.equal(stale.json.error, 'This version changed since you looked at it; look at it again.');
          ok(await approve({ version: '1.0.0', sha256: 'a'.repeat(64) }), 'another hash', 409);
          ok(await approve({ version: '1.0.0' }), 'no hash', 400);
          ok(await approve({ version: '1.0.0', sha256: 'NOT-A-HASH' }), 'not a hash', 400);
          const bundled = await call('POST', '/api/modules/fixture-notes/server-run', { cookie: nsAdmin, body: good });
          ok(bundled, 'a bundled module', 400);
          assert.equal(bundled.json.error, 'Fixture notes ships with the server, so its actions run there without an approval.');
          ok(await call('POST', '/api/modules/nothing-here/server-run', { cookie: nsAdmin, body: good }), 'a module that is not installed', 404);
          assert.equal((await upView()).serverRun.approved, false, 'nothing was approved');
        });

        await test('approval for another module or version runs neither', async () => {
          // A second upload whose library is the first's with one byte more: its hash is not the first's.
          const otherZip = upZip('1.0.0', (m, d) => {
            m.id = 'fixture-other'; m.name = 'Fixture other'; m.actions.server = 'src/fixture-other-lib-actions.js';
            m.refs.produces[0].key = 'note:{id}';
            for (const f of fs.readdirSync(path.join(d, 'src'))) fs.renameSync(path.join(d, 'src', f), path.join(d, 'src', f.replace(UP, 'fixture-other')));
            fs.appendFileSync(path.join(d, 'src', 'fixture-other-lib-actions.js'), '\n');
          });
          ok(await call('POST', '/api/modules', { cookie: nsAdmin, raw: otherZip, headers: { 'content-type': 'application/zip' } }), 'another upload', 201);
          ok(await call('PATCH', '/api/modules/fixture-other', { cookie: nsAdmin, body: { enabled: true, allSpaces: true } }), 'on');
          const mine = (await upView()).serverRun.sha256;
          ok(await call('POST', '/api/modules/fixture-other/server-run', { cookie: nsAdmin, body: { version: '1.0.0', sha256: mine } }), 'the first module\'s hash for the other', 409);
          ok(await approve({ version: '1.0.0', sha256: mine }), 'the first approved');
          const other = await call('POST', `/api/spaces/${nsCamp}/action`, { ...UT(), body: { action: 'fixture-other:addNote', input: { title: 'Not approved' } } });
          ok(other, 'the other is still refused', 409);
          assert.deepEqual(other.json, { error: APPROVAL });
          ok(await call('DELETE', '/api/modules/fixture-other?keepData=0', { cookie: nsAdmin }), 'gone');
        });

        let made = null;
        await test('approved: the agent\'s request runs at once, in its own network namespace, as the agent, with its pointer', async () => {
          const v = await upView();
          assert.equal(v.serverRun.approved, true);
          assert.equal(v.serverRun.approvedVersion, '1.0.0');
          assert.equal(v.serverRun.by, 'admin', 'by the admin\'s login');
          assert.ok(Date.parse(v.serverRun.at) > 0);
          const entry = (await call('GET', `/api/spaces/${nsCamp}/actions`, UT())).json.actions.find((a) => a.action === `${UP}:addNote`);
          assert.deepEqual([entry.may, entry.now, entry.why], [true, true, undefined]);
          const r = await upAsk('addNote', { title: 'Approved' });
          ok(r, 'done');
          assert.equal(r.json.status, 'done');
          assert.equal(r.json.ok, true, r.text);
          assert.equal(r.json.note, 'Added.');
          made = r.json.ref;
          assert.equal(made.module, UP);
          const value = (await upData())[`note:${made.id}`];
          assert.equal(value.title, 'Approved');
          assert.equal(value.byKey, upAs.key, 'the agent\'s, as the agent');
          const status = await call('GET', `/api/spaces/${nsCamp}/action/${r.json.id}`, UT());
          assert.deepEqual(status.json, { id: r.json.id, status: 'done', ok: true, note: 'Added.', ref: made }, 'request_status');
        });

        await test('a hostile library that passed the check gets nothing at run time: no require, process, network, eval, Function or constructor way out', async () => {
          upAs = upAgents[1];
          ok(await upProbe('escape'), 'escape');
          const seen = (await upData())['probe:escape'];
          for (const k of ['require', 'process', 'module', 'exports', 'Buffer', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator', 'Worker', 'WebAssembly', 'setTimeout', 'setImmediate', 'console', 'Atomics', 'SharedArrayBuffer', 'window', 'document', '__ctx', '__input', '__data']) assert.equal(seen[k], 'undefined', k);
          for (const k of ['fnCtor', 'asyncCtor', 'genCtor', 'globalCtor', 'readCtor', 'utilCtor', 'protoCtor', 'evalCall', 'reflectCtor', 'stackFrames', 'env']) assert.equal(seen[k], 'blocked', k);
          assert.equal(seen.readOutside, 'null', 'no file through ctx.read');
          ok(await upProbe('given'), 'given');
          const given = (await upData())['probe:given'];
          for (const secret of [SECRET, 'admin-password-1', 'devkey', nsTokens.get(upAs.key)]) {
            assert.ok(!given.ctx.includes(secret) && !given.input.includes(secret) && !given.globals.includes(secret), 'none of the server\'s secrets reaches it');
          }
          let sessionSecret = null;
          try { sessionSecret = JSON.parse(fs.readFileSync(path.join(nsDir, 'app.json'), 'utf8')).sessionSecret || null; } catch { sessionSecret = null; }
          if (typeof sessionSecret === 'string' && sessionSecret) assert.ok(!given.ctx.includes(sessionSecret) && !given.globals.includes(sessionSecret), 'nor the session secret');
          for (const name of ['process', 'require', 'Buffer', 'fetch', 'console']) assert.ok(!given.globals.split(',').includes(name), `no ${name} among its globals`);
        });

        await test('a hostile library\'s faults: a long loop, a promise loop, memory, huge output, a throw; nothing written, the server lives', async () => {
          upAs = upAgents[2];
          const before = JSON.stringify(await upData());
          const fault = async (what, words, status = 500) => {
            const r = await upProbe(what);
            ok(r, what, status);
            assert.equal(r.json.ok, false);
            assert.equal(r.json.error, words);
          };
          await fault('loop', `${UPN}it took too long.`);
          await fault('microloop', `${UPN}it took too long.`);
          await fault('hog', `${UPN}it used too much memory.`);
          await fault('big', `${UPN}it answered more than the server takes.`);
          await fault('flood', `${UPN}it answered more than the server takes.`);
          await fault('throw', 'The upload says no.', 422);
          assert.equal(JSON.stringify(await upData()), before, 'nothing written');
          ok(await call('GET', '/api/agent/me', UT()), 'the server lives');
        });

        await test('no more than a person\'s page of it: no environment data, no person data, no phase\'s end', async () => {
          upAs = upAgents[3];
          const before = JSON.stringify(await upData());
          const env = await upProbe('environment');
          ok(env, 'an environment write', 500);
          assert.equal(env.json.error, `${UPN}it asked for something only a module that ships with the server may do.`);
          const person = await upProbe('person');
          ok(person, 'a write for the person', 403);
          assert.equal(person.json.error, 'An agent has no places of its own; save it for this space or for everyone.');
          const phase = await upProbe('phaseEnd');
          ok(phase, 'a phase\'s end', 500);
          assert.equal(phase.json.error, `${UPN}it asked for something only a module that ships with the server may do.`);
          assert.equal(JSON.stringify(await upData()), before, 'nothing written');
        });

        await test('even with its manifest edited on disk past install: no environment write, no phase\'s end, no place search', async () => {
          upAs = upAgents[4];
          const file = path.join(nsDir, 'modules', UP, 'versions', '1.0.0', 'module.json');
          const original = fs.readFileSync(file, 'utf8');
          try {
            const m = JSON.parse(original);
            m.scope = ['space', 'environment'];
            m.surfaces.page = { entry: 'canvas.html' };
            m.refs.produces[0].summary.spaces = 'spaces';
            m.actions.provides.find((a) => a.name === 'probe').phaseEnd = true;
            fs.writeFileSync(file, JSON.stringify(m, null, 2));
            await restart();
            assert.equal((await upView()).serverRun.approved, true, 'the library is the same, so the approval stands');
            const env = await upProbe('environment');
            ok(env, 'an environment write', 500);
            assert.equal(env.json.error, `${UPN}it asked for something only a module that ships with the server may do.`);
            const phase = await upProbe('phaseEnd');
            ok(phase, 'a phase\'s end', 500);
            assert.equal(phase.json.error, `${UPN}it asked for something only a module that ships with the server may do.`);
            const envData = (await call('GET', `/api/modules/${UP}/data?scope=environment`, { cookie: nsAdmin })).json;
            assert.deepEqual(envData.items || [], [], 'no environment data');
            // A place search declared on disk: refused before anything is searched or run.
            m.settings = [{ key: 'searchProvider', label: 'Place search', type: 'choice', scope: 'environment', default: 'custom', options: [{ value: 'none', label: 'None' }, { value: 'custom', label: 'My own address' }] }, { key: 'search', label: 'Search address', type: 'url', scope: 'environment', default: 'http://127.0.0.1:9/search' }];
            m.geocoder = { provider: 'searchProvider', address: 'search', custom: 'custom', providers: {} };
            m.actions.provides.find((a) => a.name === 'addNote').lookups = { title: 'geocode' };
            fs.writeFileSync(file, JSON.stringify(m, null, 2));
            await restart();
            const before = await call('GET', '/api/agent/me', UT());
            const looked = await upAsk('addNote', { title: 'Lisbon' });
            ok(looked, 'a place search', 500);
            assert.equal(looked.json.error, `${UPN}it asked for something only a module that ships with the server may do.`);
            const after = await call('GET', '/api/agent/me', UT());
            assert.equal(after.json.limits.reads.usedToday, before.json.limits.reads.usedToday + 1, 'no search was counted (only the me between)');
          } finally {
            fs.writeFileSync(file, original);
            await restart();
          }
        });

        await test('one byte changed in the installed library: not run until approved again, and then exactly that runs', async () => {
          upAs = upAgents[5];
          const old = (await upView()).serverRun.sha256;
          fs.appendFileSync(installedLib(), '\n// one more line\n');
          const v = await upView();
          assert.notEqual(v.serverRun.sha256, old, 'the admin sees the new hash');
          assert.equal(v.serverRun.approved, false, 'and that it is not approved');
          assert.equal(v.serverRun.approvedVersion, '1.0.0', 'what was approved before is still named');
          const r = await upAsk('addNote', { title: 'Changed' });
          ok(r, 'refused', 409);
          assert.deepEqual(r.json, { error: APPROVAL });
          ok(await approve({ version: '1.0.0', sha256: old }), 'the old hash is stale', 409);
          ok(await approve({ version: '1.0.0', sha256: v.serverRun.sha256 }), 'approved again');
          ok(await upAsk('addNote', { title: 'Changed and approved' }), 'runs');
        });

        await test('approval taken back while a run is going: the run writes nothing; and the next is refused', async () => {
          upAs = upAgents[6];
          const before = JSON.stringify(await upData());
          const going = upProbe('slow', { ms: 700 });
          await sleep(250);
          ok(await call('DELETE', `/api/modules/${UP}/server-run`, { cookie: nsAdmin }), 'taken back');
          const r = await going;
          ok(r, 'ended', 409);
          assert.equal(r.json.error, CHANGED);
          assert.equal(JSON.stringify(await upData()), before, 'nothing written');
          const next = await upAsk('addNote', { title: 'After' });
          ok(next, 'refused', 409);
          assert.deepEqual(next.json, { error: APPROVAL });
          const v = await upView();
          assert.deepEqual([v.serverRun.approved, v.serverRun.approvedVersion, v.serverRun.by], [false, null, null]);
        });

        await test('three uploaded runs at once and a bundled one: all done (the slots are shared, nothing refused)', async () => {
          ok(await approve({ version: '1.0.0', sha256: (await upView()).serverRun.sha256 }), 'approved');
          const asks = [7, 8, 9].map((i) => call('POST', `/api/spaces/${nsCamp}/action`, { token: nsTokens.get(upAgents[i].key), body: { action: `${UP}:probe`, input: { what: 'slow', ms: 600 } } }));
          asks.push(call('POST', `/api/spaces/${nsCamp}/action`, { token: nsTokens.get(upAgents[0].key), body: { action: 'fixture-notes:addNote', input: { title: 'Bundled beside' } } }));
          for (const r of await Promise.all(asks)) { ok(r, 'done'); assert.equal(r.json.ok, true, r.text); }
        });

        await test('a new version, disabling, rolling back and uninstalling each drop the approval', async () => {
          upAs = upAgents[0];
          const sha = () => upView().then((v) => v.serverRun.sha256);
          const refused = async (what) => { const r = await upAsk('addNote', { title: what }); ok(r, what, 409); assert.deepEqual(r.json, { error: APPROVAL }); };
          const registry = () => JSON.parse(fs.readFileSync(path.join(nsDir, 'modules', 'registry.json'), 'utf8')).modules[UP];
          // A new version (replace).
          await installUp('1.0.1');
          assert.equal(registry().serverRun, undefined, 'replaced: the approval is gone');
          await refused('new version');
          ok(await approve({ version: '1.0.1', sha256: await sha() }), 'approved');
          ok(await upAsk('addNote', { title: 'New version' }), 'runs');
          // Disabled, then on again.
          ok(await call('PATCH', `/api/modules/${UP}`, { cookie: nsAdmin, body: { enabled: false } }), 'off');
          assert.equal(registry().serverRun, undefined, 'off: the approval is gone');
          ok(await call('PATCH', `/api/modules/${UP}`, { cookie: nsAdmin, body: { enabled: true } }), 'on');
          await refused('on again');
          // Rolled back.
          ok(await approve({ version: '1.0.1', sha256: await sha() }), 'approved');
          ok(await call('POST', `/api/modules/${UP}/rollback`, { cookie: nsAdmin, body: { version: '1.0.0' } }), 'rolled back');
          assert.equal(registry().serverRun, undefined, 'rolled back: the approval is gone');
          await refused('rolled back');
          // Uninstalled, then installed again.
          ok(await approve({ version: '1.0.0', sha256: await sha() }), 'approved');
          ok(await call('DELETE', `/api/modules/${UP}?keepData=0`, { cookie: nsAdmin }), 'uninstalled');
          await installUp('1.0.0');
          ok(await call('PATCH', `/api/modules/${UP}`, { cookie: nsAdmin, body: { enabled: true, allSpaces: true } }), 'on');
          assert.equal(registry().serverRun, undefined, 'installed again: no approval');
          await refused('installed again');
        });
      }
    } finally {
      await server.stop();
      server = mainServer;
    }
  }

} finally {
  for (const s of servers) await s.stop();
  if (failed === 0) fs.rmSync(base, { recursive: true, force: true });
}

if (failed) {
  console.error(`check-module-actions: ${failed} failed, ${n} passed.`);
  process.exit(1);
}
console.log(`check-module-actions: OK (${n} checks).`);
