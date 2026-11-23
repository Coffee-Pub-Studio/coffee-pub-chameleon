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
 *     an uploaded zip that declares it is refused at install with one sentence; the runner's process can't read a file
 *     or start a process (Node's permission model), whatever runs in it;
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
 *   - an uploaded module (and a newer upload of the fixture itself) keeps the wait: pending with its waiting words,
 *     list_actions says now: false, wait_for_result holds until a page carries it or its seconds run out, at most two
 *     waits at once; MCP lists wait_for_result and the fixture's request is done through ask_for_change;
 *   - the richer ctx (step 1b): ctx.util is the SDK's own helpers (public/sdk/host.js, loaded by the worker), frozen, with the
 *     environment's clock and words, and no way out through them (no constructor, stack frame or leftover of the SDK); the
 *     facts (space, people) are exactly the page's shape; refs only for the input's pointers, a pointer into another space or
 *     one the module may not link to resolving to nothing; an input the action `clears` keeps "", every other refusal stands;
 *   - the Itinerary and the Calendar carried by the server: acceptSuggestion with a full flight, updatePlan patching only the
 *     gate and terminal, createEvent with a 90 minute reminder and notes (the reminder marked as waiting for a page, and said),
 *     updateEvent clearing the reminder (the schedule a page set from the old event cancelled), each with the module tests'
 *     writes; the same request through an uploaded copy waits and never reaches the runner.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const FIXTURE = path.join(ROOT, 'tools', 'fixtures', 'module-actions', 'fixture-notes');
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

// --- a copy of the app whose modules/ also holds the fixture ------------------------------------------------------------
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-module-actions-'));
const app = path.join(base, 'app');
fs.mkdirSync(path.join(app, 'modules'), { recursive: true });
fs.cpSync(path.join(ROOT, 'server'), path.join(app, 'server'), { recursive: true });
for (const name of ['public', 'templates', 'node_modules', 'package.json']) fs.symlinkSync(path.join(ROOT, name), path.join(app, name));
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

  server = await startServer(dir, ENV);
  const admin = await signIn('admin', 'admin-password-1');
  ok(await call('PATCH', '/api/settings', { cookie: admin, body: { agents: true } }), 'Agents on');
  const mia = (await call('POST', '/api/users', { cookie: admin, body: { login: 'mia', password: 'mia-password-1', displayName: 'Mia', role: 'member' } })).json.user;
  // Several agents, each with its own 20 writes a minute: the main one, and one for each group of requests below.
  const agents = [];
  for (let i = 0; i < 11; i += 1) agents.push((await call('POST', '/api/users', { cookie: admin, body: { agent: true } })).json.user);
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

  await test('MCP: wait_for_result is listed, ask_for_change on the fixture is done at once', async () => {
    as = agents[6];
    const rpc = (method, params) => call('POST', '/mcp', { ...T(), body: { jsonrpc: '2.0', id: 1, method, params } });
    const tools = (await rpc('tools/list', {})).json.result.tools;
    const wait = tools.find((t) => t.name === 'wait_for_result');
    assert.ok(wait, 'listed');
    assert.deepEqual(wait.inputSchema.required, ['space', 'request']);
    const r = await rpc('tools/call', { name: 'ask_for_change', arguments: { space: camp, action: 'fixture-notes:addNote', input: { title: 'By MCP' } } });
    const out = JSON.parse(r.json.result.content[0].text);
    assert.equal(out.status, 'done');
    assert.equal(out.ok, true);
    assert.equal(out.ref.kind, 'note');
    const bad = await rpc('tools/call', { name: 'wait_for_result', arguments: { space: camp, request: out.id, seconds: 31 } });
    assert.equal(bad.json.result.isError, true);
    assert.equal(bad.json.result.content[0].text, 'seconds is a whole number from 1 to 30.');
    const done = await rpc('tools/call', { name: 'wait_for_result', arguments: { space: camp, request: out.id, seconds: 5 } });
    assert.equal(JSON.parse(done.json.result.content[0].text).ok, true, 'a done request answers at once');
    const list = JSON.parse((await rpc('tools/call', { name: 'list_actions', arguments: { space: camp } })).json.result.content[0].text).actions;
    assert.equal(list.find((a) => a.action === 'fixture-notes:addNote').now, true, 'list_actions says now');
    assert.equal(list.find((a) => a.action === 'fixture-notes:addNote').waiting, undefined);
  });

  // --- the richer ctx: the SDK's helpers, the facts, the refs (step 1b) --------------------------------------------------
  await test('ctx.util is the SDK\'s own helpers, frozen, and none of them is a way out', async () => {
    as = agents[7];
    ok(await probe('escapeUtil'), 'escapeUtil');
    const seen = (await data())['probe:escapeUtil'].value;
    assert.equal(seen.frozen, 'frozen');
    for (const k of ['replaced', 'added', 'swapped']) assert.equal(seen[k], 'kept', k);
    assert.equal(seen.keys, 'detailLines,id,localWhen,objectKey,parseYmd,plain,time,word,ymd');
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
    assert.deepEqual(f.keys, ['action', 'by', 'byKey', 'carrier', 'credit', 'from', 'list', 'now', 'people', 'read', 'refs', 'space', 'tz', 'util']);
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
  await test('Calendar: an agent\'s createEvent with a 90 minute reminder and notes is done at once; its reminder waits for a page, and says so', async () => {
    as = agents[9];
    const r = await askIn('calendar:createEvent', { title: 'Car', date: '2026-11-20', time: '10:00', endTime: '11:30', remind: 90, notes: 'Pick up at the airport' });
    ok(r, 'createEvent');
    assert.equal(r.json.ok, true);
    assert.equal(r.json.note, 'Its reminder is set the next time someone who can change events opens the calendar.');
    event = r.json.ref;
    assert.deepEqual([event.module, event.kind, event.space], ['calendar', 'event', camp]);
    const v = (await calData())[`event:${event.id}`].value;
    // The module test's expectations (modules/calendar/test/check-calendar-actions.mjs), read in the server's zone (UTC here).
    assert.deepEqual(v, { id: event.id, title: 'Car', allDay: false, start: '2026-11-20T10:00:00.000Z', end: '2026-11-20T11:30:00.000Z', desc: 'Pick up at the airport', remind: 90, repeat: null, by: 'Claude', remindPending: true });
    assert.ok(!schedules().some((x) => x.module === 'calendar'), 'no schedule is set by the server');
  });

  await test('Calendar: updateEvent clearing the reminder takes it off, and the schedule a page set from the old event goes', async () => {
    as = agents[9];
    // Mia's page sets the reminder, as calendar.js applyReminder does.
    const at = Date.now() + 3 * 24 * 3600 * 1000;
    ok(await call('POST', `/api/modules/calendar/schedule?scope=space&space=${camp}`, { cookie: miaC, body: { key: `remind:${event.id}`, at, payload: { id: event.id }, ref: { module: 'calendar', kind: 'event', id: event.id, scope: 'space', space: camp }, notify: { title: 'Car', body: 'Starts in 1 hour 30 minutes' } } }), 'a page sets the reminder');
    ok(await call('POST', `/api/modules/calendar/schedule?scope=space&space=${camp}`, { cookie: miaC, body: { key: 'other-key', at, payload: {} } }), 'and some other schedule');
    assert.ok(schedules().some((x) => x.key === `remind:${event.id}`));
    const r = await askIn('calendar:updateEvent', { event, remind: '' });
    ok(r, 'updateEvent');
    assert.equal(r.json.ok, true);
    assert.equal(r.json.note, undefined, 'no reminder: nothing waits');
    const v = (await calData())[`event:${event.id}`].value;
    assert.equal(v.remind, null);
    assert.equal(v.remindPending, undefined);
    assert.deepEqual([v.title, v.desc, v.start], ['Car', 'Pick up at the airport', '2026-11-20T10:00:00.000Z'], 'the rest kept');
    assert.ok(!schedules().some((x) => x.key === `remind:${event.id}`), 'the old reminder will not fire');
    assert.ok(schedules().some((x) => x.key === 'other-key'), 'a schedule about nothing it changed stays');
    const back = await askIn('calendar:updateEvent', { event, remind: 30, notes: '' });
    ok(back, 'a reminder again, notes cleared');
    assert.equal(back.json.note, 'Its reminder is set the next time someone who can change events opens the calendar.');
    const w = (await calData())[`event:${event.id}`].value;
    assert.deepEqual([w.remind, w.remindPending, w.desc], [30, true, '']);
  });

  await test('the same requests through an uploaded copy of the Itinerary wait for a page and never reach the runner', async () => {
    as = agents[10];
    const up = path.join(base, 'variants', 'travel-upload');
    fs.cpSync(path.join(ROOT, 'modules', 'travel'), up, { recursive: true });
    const m = JSON.parse(fs.readFileSync(path.join(up, 'module.json'), 'utf8'));
    m.version = '9.9.9';
    delete m.actions.server;
    fs.writeFileSync(path.join(up, 'module.json'), JSON.stringify(m, null, 2));
    ok(await call('POST', '/api/modules', { cookie: admin, raw: zipOf(up), headers: { 'content-type': 'application/zip' } }), 'the upload installs', 201);
    const before = JSON.stringify(await travelData());
    const r = await askIn('travel:updatePlan', { entry: flight, object: { kind: 'flight', details: { gate: 'Z9' } } });
    ok(r, 'asked');
    assert.equal(r.json.status, 'pending');
    assert.match(r.json.waiting, /^Waiting for someone who may change Planner - Itinerary to open it in "Camp"\./);
    const kept = busFile().actions.find((a) => a.id === r.json.id);
    assert.ok(kept && !kept.server && kept.status === 'pending', 'on the queue for a page, not the server\'s');
    assert.equal(JSON.stringify(await travelData()), before, 'nothing written');
    const list = (await call('GET', `/api/spaces/${camp}/actions`, T())).json.actions;
    assert.equal(list.find((a) => a.action === 'travel:updatePlan').now, false);
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

  await test('an upload that declares actions.server is refused at install', async () => {
    const dirUp = variant('upload-server', (m) => { m.id = 'fixture-upload'; m.name = 'Fixture upload'; });
    const r = await call('POST', '/api/modules', { cookie: admin, raw: zipOf(dirUp), headers: { 'content-type': 'application/zip' } });
    ok(r, 'refused', 400);
    assert.equal(r.json.error, 'Only a module that ships with the server can carry out actions on the server. Remove "server" from "actions" in module.json and upload it again.');
  });

  await test('an uploaded module keeps the wait: waiting words, now false, wait_for_result, at most two waits', async () => {
    as = agent;
    const dirUp = variant('upload-plain', (m) => { m.id = 'fixture-upload'; m.name = 'Fixture upload'; delete m.actions.server; });
    ok(await call('POST', '/api/modules', { cookie: admin, raw: zipOf(dirUp), headers: { 'content-type': 'application/zip' } }), 'installs', 201);
    ok(await call('PATCH', '/api/modules/fixture-upload', { cookie: admin, body: { enabled: true, allSpaces: true } }), 'on');
    const list = (await call('GET', `/api/spaces/${camp}/actions`, T())).json.actions;
    const entry = list.find((a) => a.action === 'fixture-upload:addNote');
    assert.equal(entry.now, false);
    assert.equal(entry.waiting, 'Waiting for someone who may change Fixture upload to open it in "Camp". Nothing has changed yet.');
    const r = await call('POST', `/api/spaces/${camp}/action`, { ...T(), body: { action: 'fixture-upload:addNote', input: { title: 'Waits' } } });
    ok(r, 'asked');
    assert.equal(r.json.status, 'pending');
    assert.equal(r.json.waiting, entry.waiting);
    const status = await call('GET', `/api/spaces/${camp}/action/${r.json.id}`, T());
    assert.deepEqual(status.json, { id: r.json.id, status: 'pending', waiting: entry.waiting });
    let t = Date.now();
    const short = await call('GET', `/api/spaces/${camp}/action/${r.json.id}/wait?seconds=1`, T());
    ok(short, 'a short wait');
    assert.equal(short.json.status, 'pending');
    assert.ok(Date.now() - t >= 900, 'it held about a second');
    ok(await call('GET', `/api/spaces/${camp}/action/${r.json.id}/wait?seconds=0`, T()), 'seconds 0', 400);
    // Two waits held at once; a third is refused.
    t = Date.now();
    const w1 = call('GET', `/api/spaces/${camp}/action/${r.json.id}/wait?seconds=10`, T());
    const w2 = call('GET', `/api/spaces/${camp}/action/${r.json.id}/wait?seconds=10`, T());
    await sleep(300);
    const third = await call('GET', `/api/spaces/${camp}/action/${r.json.id}/wait?seconds=10`, T());
    ok(third, 'a third wait', 429);
    assert.equal(third.json.error, 'You are already waiting on 2 requests. Wait for one of them to finish.');
    // A page carries it: both waits end with its result.
    const claim = await call('POST', '/api/bus/actions/claim', { cookie: miaC, body: { module: 'fixture-upload', id: r.json.id, scope: 'space', space: camp } });
    assert.equal(claim.json.ok, true, 'a page claims it');
    const ref = { module: 'fixture-upload', kind: 'note', id: 'paged', scope: 'space', space: camp };
    ok(await call('POST', '/api/bus/actions/complete', { cookie: miaC, body: { module: 'fixture-upload', id: r.json.id, scope: 'space', space: camp, result: { ok: true, ref } } }), 'and finishes it');
    for (const w of await Promise.all([w1, w2])) {
      ok(w, 'a wait');
      assert.equal(w.json.status, 'done');
      assert.deepEqual(w.json.ref, ref, 'with the page\'s pointer');
    }
    assert.ok(Date.now() - t < 5000, 'the waits ended when it was done');
  });

  await test('a newer upload of the bundled module itself never reaches the runner', async () => {
    const dirNext = variant('fixture-next', (m) => { m.version = '1.0.1'; delete m.actions.server; });
    ok(await call('POST', '/api/modules', { cookie: admin, raw: zipOf(dirNext), headers: { 'content-type': 'application/zip' } }), 'installs', 201);
    const r = await ask('addNote', { title: 'Uploaded now' });
    ok(r, 'asked');
    assert.equal(r.json.status, 'pending', 'it waits for a page');
    const list = (await call('GET', `/api/spaces/${camp}/actions`, T())).json.actions;
    assert.equal(list.find((a) => a.action === 'fixture-notes:addNote').now, false);
    ok(await call('POST', '/api/modules/fixture-notes/rollback', { cookie: admin, body: { version: '1.0.0' } }), 'rolled back to the bundled files');
    const still = await ask('addNote', { title: 'Rolled back' });
    ok(still, 'asked again');
    assert.equal(still.json.status, 'pending', 'still not carried: the module is no longer the deployment\'s own install');
  });

} finally {
  for (const s of servers) await s.stop();
  if (failed === 0) fs.rmSync(base, { recursive: true, force: true });
}

if (failed) {
  console.error(`check-module-actions: ${failed} failed, ${n} passed.`);
  process.exit(1);
}
console.log(`check-module-actions: OK (${n} checks).`);
