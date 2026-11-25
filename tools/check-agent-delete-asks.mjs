#!/usr/bin/env node
/*
 * check-agent-delete-asks.mjs -- an agent's delete asks and a person's approval (documentation/plans/
 * plan-agent-edit-delete.md, step 6 of "Left to build"; "The contract", 2, 3, 6 and 7). A delete is never direct: an agent
 * asks, a person approves each ask.
 *
 * On their own (no server):
 *   - the manifest: `effect: "delete"` takes exactly one required pointer to one of the module's own kinds and nothing else,
 *     one delete action a kind; it is never an agent's `write` (agentMayAsk) and never a tool of the in-app AI;
 *   - the records: a delete ask is one waiting per object, capped at 10 waiting and 30 in a day for each agent, not asked
 *     again for 7 days after a decline, answered once (a second answer is 409), and `undone` after its delete is put back.
 * Against a real server (single install, throwaway DATA_DIR; Polls, To-do and Calendar uploaded with a delete action, since
 * the bundled modules declare theirs in step 8):
 *   - the Roles row agentDelete: off by default, an Agent-column row only; without it an ask is 403 and `me` does not list it;
 *   - list_actions shows the delete action to an agent (effect delete, approval each, may), never to a person; the action
 *     route refuses it (403 for an agent with the sentence, 404 for a person);
 *   - hostile asks: a bad body, another key, another space's object, a space the agent is not in, an environment pointer, a
 *     kind with no delete action, a missing object, a Calendar copy, without the module's write row; each its status and one
 *     sentence, and nothing is deleted by asking;
 *   - the reason is cut at 200; one waiting ask an object (any agent's); the approvers get one bell line and a count;
 *   - the agent's token is 403 on every approve, decline, review and undo route, and another agent's ask is 404;
 *   - approving: a member is 403, another space's moderator is 403, the wrong space's route is 404, no version is 400; an
 *     approver the module's guards refuse is 403 and the ask still waits; a changed object or a wrong version is 409 "That
 *     changed since Claude asked. Nothing was deleted." and the ask ends; approval deletes exactly the asked key and what
 *     belongs to it, and nothing else; a second approval, a decline after it and another ask's version are 409;
 *   - Undo puts the object and its children back and the ask reads undone; a decline holds for 7 days;
 *   - a space closed for set up: no ask, and an approval waits (409, the ask still waiting) until it is open again;
 *   - the right taken away, or the token revoked, ends the ask; the gate's minute limit answers 429;
 *   - MCP: ask_to_delete and ask_status are listed and work; descriptions stay under 600 characters;
 *   - no title, reason or value in the agent's log, the records file, the server's own output or anything the agent is
 *     answered.
 * No network beyond localhost, no LiveKit.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { AgentRecords } = require(path.join(ROOT, 'server', 'agent-records.js'));
const { cleanManifest } = require(path.join(ROOT, 'server', 'modules.js'));
const { buildModule } = require(path.join(ROOT, 'server', 'module-build.js'));
const { agentMayAsk, isDeleteAction, deleteKindOf, deleteActionFor, DELETE_ASK_LIMITS, AGENT_ROUTES, AGENT_DEFAULTS } = require(path.join(ROOT, 'server', 'agent-routes.js'));
const { buildCatalog } = require(path.join(ROOT, 'server', 'action-catalog.js'));
const { TOOLS, SETUP_TOOLS } = require(path.join(ROOT, 'server', 'mcp.js'));

const DAY = 24 * 3600000;
const CANT = "An agent can't do that.";
const OVER = 'The agent has done as much as it may for now.';
const STALE = 'That changed since Claude asked. Nothing was deleted.';
const ANSWERED = 'That ask was answered already.';
const VIA_ASK = 'Ask for that with ask_to_delete; a person must approve it.';
const SECRETS = ['Lunch by the sea', 'Feed the llama', 'Quiet harbour walk', 'because the llama said so'];

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-agent-delete-asks-'));
const quiet = () => {};

// A bundled module's manifest with a delete action for one of its kinds added (what step 8 declares for each module).
const rawOf = (id) => JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', id, 'module.json'), 'utf8'));
const srcFiles = () => ({ has: () => true }); // every file the manifest names is taken as there: only the actions are asked about
const withDelete = (id, action) => {
  const raw = rawOf(id);
  raw.actions.provides = [...raw.actions.provides, action];
  return raw;
};
const DELETE_POLL = { name: 'deletePoll', label: 'Delete a poll', description: 'Deletes a poll and its votes.', effect: 'delete', input: { poll: 'ref:polls:poll' } };

// --- the manifest, on its own -------------------------------------------------------------------------------------------
await test('effect "delete": one required pointer to the module\'s own kind, nothing else, one a kind', () => {
  const clean = (action) => cleanManifest(withDelete('polls', action), srcFiles('polls'));
  const m = clean(DELETE_POLL);
  const def = m.actions.provides.find((a) => a.name === 'deletePoll');
  assert.equal(def.effect, 'delete');
  assert.equal(isDeleteAction(def), true);
  assert.equal(deleteKindOf(def), 'poll');
  assert.equal(deleteActionFor(m, 'poll').name, 'deletePoll');
  assert.equal(deleteActionFor(m, 'vote'), null, 'a kind with no delete action is never deletable');
  assert.equal(agentMayAsk(def), false, 'never asked through the action route');
  assert.ok(!buildCatalog([m]).tools.some((t) => t.action === 'deletePoll'), 'the in-app AI never sees it');
  const bad = (action, what) => assert.throws(() => clean(action), /deletes, so|only one action may delete/, what);
  bad({ ...DELETE_POLL, input: { poll: 'ref:polls:poll?' } }, 'an optional pointer');
  bad({ ...DELETE_POLL, input: { poll: 'ref' } }, 'any pointer');
  bad({ ...DELETE_POLL, input: { poll: 'ref:todo:task' } }, 'another module\'s kind');
  bad({ ...DELETE_POLL, input: { poll: 'ref:polls:vote' } }, 'a kind the module does not make');
  bad({ ...DELETE_POLL, input: { poll: 'ref:polls:poll', why: 'string?' } }, 'a second input');
  bad({ ...DELETE_POLL, input: {} }, 'no input');
  bad({ ...DELETE_POLL, askerOnly: true }, 'askerOnly');
  bad({ ...DELETE_POLL, needs: ['date'] }, 'needs');
  assert.throws(() => clean({ ...DELETE_POLL, local: true }), /local/, 'local');
  const twice = withDelete('polls', DELETE_POLL);
  twice.actions.provides.push({ ...DELETE_POLL, name: 'removePoll' });
  assert.throws(() => cleanManifest(twice, srcFiles('polls')), /only one action may delete the kind "poll"/);
});

await test('the gate\'s list and the row: agentDelete off by default, the ask route needs it, the approve routes are not on it', () => {
  assert.equal(AGENT_DEFAULTS.agentDelete, false);
  const ask = AGENT_ROUTES.find((r) => r.path === '/api/spaces/:id/delete-asks');
  assert.deepEqual([ask.kind, ask.method, ask.counts, ask.place, ask.needs], ['agent', 'post', 'write', 'spaceParam', 'agentDelete']);
  assert.ok(AGENT_ROUTES.some((r) => r.kind === 'agent' && r.method === 'get' && r.path === '/api/agent/asks/:id' && r.needs === 'always'));
  for (const p of ['/api/spaces/:id/asks/:askId', '/api/users/:key/asks/:id', '/api/users/:key/asks', '/api/spaces/:id/agent-review', '/api/spaces/:id/changes/:changeId/undo']) {
    assert.ok(!AGENT_ROUTES.some((r) => r.path === p), `${p} is never an agent's`);
  }
  assert.ok(!AGENT_ROUTES.some((r) => r.kind === 'setup' && /delete/.test(r.path)), 'the set-up agent never asks to delete');
  for (const t of [...TOOLS, ...SETUP_TOOLS]) assert.ok(t.description.length < 600, `${t.name}'s description is ${t.description.length} characters`);
  assert.ok(TOOLS.some((t) => t.name === 'ask_to_delete') && TOOLS.some((t) => t.name === 'ask_status'));
  assert.ok(!SETUP_TOOLS.some((t) => t.name === 'ask_to_delete'));
});

// --- the records, on their own ------------------------------------------------------------------------------------------
await test('records: one waiting ask an object, the caps, the cooldown after a decline, answered once, undone', () => {
  const r = new AgentRecords(path.join(base, 'records'), { log: quiet });
  const object = (i) => ({ module: 'todo', kind: 'task', id: `t${i}`, scope: 'space', key: `task:t${i}` });
  const add = (agent, i, now, extra = {}) => r.addDeleteAsk({ agent, space: 'camp01', object: object(i), version: 1, ...extra }, DELETE_ASK_LIMITS, now);
  const t0 = Date.now();
  const first = add('agent001', 0, t0, { reason: 'x'.repeat(500), title: 'Secret' });
  assert.equal(first.state, 'waiting');
  assert.equal(first.reason.length, 200, 'the reason is cut at 200');
  assert.equal(first.title, undefined, 'nothing but what it keeps');
  assert.throws(() => add('agent001', 0, t0), (e) => e.status === 409 && e.message === 'There is already an ask to delete that.');
  assert.throws(() => add('agent002', 0, t0), (e) => e.status === 409, 'another agent\'s ask for the same object too');
  assert.throws(() => r.addDeleteAsk({ agent: 'agent001', space: 'camp01', object: { ...object(1), scope: 'environment' }, version: 1 }, DELETE_ASK_LIMITS, t0), (e) => e.status === 400, 'only a space object');
  // Answered once.
  let ran = 0;
  assert.equal(r.decide(first.id, 'agent001', 'approve', 'owner001', () => { ran += 1; }, t0).changed, true);
  assert.throws(() => r.decide(first.id, 'agent001', 'approve', 'owner001', () => { ran += 1; }, t0), (e) => e.status === 409 && e.message === ANSWERED, 'a second approval');
  assert.throws(() => r.decide(first.id, 'agent001', 'decline', 'owner001', () => {}, t0), (e) => e.status === 409 && e.message === ANSWERED, 'a decline after it');
  assert.equal(ran, 1, 'the delete ran once');
  assert.throws(() => r.decide(first.id, 'agent002', 'approve', 'owner001', () => {}, t0), (e) => e.status === 404, 'another agent\'s ask is no ask');
  assert.equal(r.markUndone(first.id), true);
  assert.equal(r.ask(first.id).state, 'undone');
  assert.equal(r.markUndone(first.id), false, 'once');
  // A refused approval leaves it waiting.
  const second = add('agent001', 1, t0);
  assert.throws(() => r.decide(second.id, 'agent001', 'approve', 'owner001', () => { throw Object.assign(new Error('no'), { status: 403 }); }, t0));
  assert.equal(r.ask(second.id).state, 'waiting');
  // A decline holds for the cooldown.
  r.decide(second.id, 'agent001', 'decline', 'owner001', () => {}, t0);
  assert.throws(() => add('agent002', 1, t0 + DAY), (e) => e.status === 409 && e.message === 'A person declined deleting that.' && e.until === t0 + DELETE_ASK_LIMITS.cooldownDays * DAY);
  assert.equal(add('agent002', 1, t0 + DELETE_ASK_LIMITS.cooldownDays * DAY + 1).state, 'waiting', 'after the cooldown it may be asked again');
  // At most 10 waiting at once.
  const r2 = new AgentRecords(path.join(base, 'records2'), { log: quiet });
  const add2 = (i, now) => r2.addDeleteAsk({ agent: 'agent001', space: 'camp01', object: object(i), version: 1 }, DELETE_ASK_LIMITS, now);
  for (let i = 0; i < DELETE_ASK_LIMITS.waiting; i += 1) add2(i, t0 + i);
  assert.throws(() => add2(99, t0 + 50), (e) => e.status === 429 && e.message === OVER && e.retrySeconds > 0, 'the eleventh waits');
  assert.equal(r2.addDeleteAsk({ agent: 'agent002', space: 'camp01', object: object(98), version: 1 }, DELETE_ASK_LIMITS, t0 + 51).state, 'waiting', 'each agent its own cap');
  // At most 30 in a day, answered or not.
  for (let i = 0; i < DELETE_ASK_LIMITS.waiting; i += 1) r2.decide(r2.waitingOf('agent001', t0 + 60)[0].id, 'agent001', 'decline', 'owner001', () => {}, t0 + 60);
  for (let i = DELETE_ASK_LIMITS.waiting; i < DELETE_ASK_LIMITS.perDay; i += 1) {
    const a = add2(i, t0 + 100 + i);
    r2.decide(a.id, 'agent001', 'decline', 'owner001', () => {}, t0 + 100 + i);
  }
  assert.throws(() => add2(200, t0 + 1000), (e) => e.status === 429 && e.message === OVER, 'the thirty-first in a day');
  assert.equal(add2(201, t0 + DAY + 1000).state, 'waiting', 'a day later there is room');
  assert.ok(!fs.readFileSync(path.join(base, 'records', 'agent-records.json'), 'utf8').includes('Secret'));
});

// --- against a server ---------------------------------------------------------------------------------------------------
const servers = [];
async function startServer(dataDir) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, TZ: 'UTC', ADMIN_PASSWORD: 'admin-password-1', AGENT_TOKENS: 'true' },
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
  server.stop = () => new Promise((resolve) => { if (child.exitCode !== null || child.signalCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
  servers.push(server);
  return server;
}
let server = null;
function call(method, urlPath, { body, cookie, token, raw, type } = {}) {
  const payload = raw !== undefined ? Buffer.from(raw) : body === undefined ? null : Buffer.from(JSON.stringify(body));
  const headers = { host: `127.0.0.1:${server.port}`, accept: 'application/json' };
  if (payload) { headers['content-type'] = type || 'application/json'; headers['content-length'] = payload.length; }
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
async function signIn(login, password) {
  const r = await call('POST', '/api/login', { body: { login, password } });
  assert.equal(r.status, 200, `${login} signs in`);
  return [].concat(r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
}
const ok = (r, what, status = 200) => assert.equal(r.status, status, `${what}: ${r.status} ${r.text.slice(0, 400)}`);
const refused = (r, status, error, what) => {
  assert.equal(r.status, status, `${what}: ${r.status} ${r.text.slice(0, 400)}`);
  if (error instanceof RegExp) assert.match(r.json?.error || '', error, what);
  else if (error !== null) assert.equal(r.json?.error, error, what);
};

const dir = path.join(base, 'data');
try {
  server = await startServer(dir);
  const admin = await signIn('admin', 'admin-password-1');
  ok(await call('PATCH', '/api/settings', { cookie: admin, body: { agents: true } }), 'Agents on');
  const person = async (login, displayName) => (await call('POST', '/api/users', { cookie: admin, body: { login, password: `${login}-password-1`, displayName, role: 'member' } })).json.user;
  const mia = await person('mia', 'Mia');
  const max = await person('max', 'Max');
  const newAgent = async () => (await call('POST', '/api/users', { cookie: admin, body: { agent: true } })).json.user;
  const agent = await newAgent();
  const other = await newAgent();
  const hammer = await newAgent();
  const probe = await newAgent();
  const late = await newAgent();
  const agents = [agent.key, other.key, hammer.key, late.key, probe.key];
  const camp = (await call('POST', '/api/spaces', { cookie: admin, body: { name: 'Camp', members: [...agents, mia.key, max.key] } })).json.space.id;
  const fort = (await call('POST', '/api/spaces', { cookie: admin, body: { name: 'Fort', members: [agent.key, probe.key, mia.key, max.key] } })).json.space.id;
  const away = (await call('POST', '/api/spaces', { cookie: admin, body: { name: 'Away', members: [mia.key] } })).json.space.id;
  // The bundled modules, then each with a delete action as an upload of the next version (step 8 declares them for real).
  const DELETES = {
    polls: DELETE_POLL,
    todo: { name: 'deleteTask', label: 'Delete a task', description: 'Deletes a task.', effect: 'delete', input: { task: 'ref:todo:task' } },
    calendar: { name: 'deleteEvent', label: 'Delete an event', description: 'Deletes an event.', effect: 'delete', input: { event: 'ref:calendar:event' } },
  };
  for (const id of ['polls', 'todo', 'calendar', 'travel']) {
    ok(await call('POST', `/api/modules/bundled/${id}/install`, { cookie: admin, body: {} }), `${id} installs`, 201);
    ok(await call('PATCH', `/api/modules/${id}`, { cookie: admin, body: { enabled: true, allSpaces: true } }), `${id} on`);
  }
  for (const [id, action] of Object.entries(DELETES)) {
    const src = path.join(base, `upload-${id}`);
    fs.cpSync(path.join(ROOT, 'modules', id), src, { recursive: true });
    const manifest = withDelete(id, action);
    manifest.version = '99.0.0';
    delete manifest.actions.server; // an upload may not declare it
    fs.writeFileSync(path.join(src, 'module.json'), JSON.stringify(manifest));
    const up = await call('POST', '/api/modules', { cookie: admin, raw: buildModule(src).zip, type: 'application/zip' });
    ok(up, `${id} with its delete action uploads`, 201);
    assert.equal(up.json.module.enabled, true, `${id} stays on`);
  }
  ok(await call('PATCH', `/api/users/${max.key}/spaces/${camp}`, { cookie: admin, body: { permissions: { moderator: true } } }), 'Max moderates Camp');
  const tokenOf = async (a) => ({ token: (await call('POST', `/api/users/${a.key}/token`, { cookie: admin })).json.token });
  const T = await tokenOf(agent);
  const T2 = await tokenOf(other);
  const T3 = await tokenOf(hammer);
  const T4 = await tokenOf(late);
  const T5 = await tokenOf(probe); // the hostile asks are its own, so the minute's 20 writes are not spent by the others
  const miaC = await signIn('mia', 'mia-password-1');
  const maxC = await signIn('max', 'max-password-1');
  const column = (body) => call('PATCH', '/api/roles/agent', { cookie: admin, body });
  const data = (id, space = camp, cookie = admin) => call('GET', `/api/modules/${id}/data?scope=space&space=${space}`, { cookie }).then((r) => Object.fromEntries(r.json.items.map((i) => [i.key, i])));
  const put = (id, key, value, cookie, space = camp) => call('PUT', `/api/modules/${id}/data/${encodeURIComponent(key)}?scope=space&space=${space}`, { cookie, body: { value } });
  const ref = (module, kind, id, space = camp) => ({ module, kind, id, scope: 'space', space });
  const askFor = (object, auth = T, extra = {}, space = camp) => call('POST', `/api/spaces/${space}/delete-asks`, { ...auth, body: { object, ...extra } });
  const answer = (cookie, id, body, space = camp) => call('POST', `/api/spaces/${space}/asks/${id}`, { cookie, body });
  const status = (id, auth = T) => call('GET', `/api/agent/asks/${id}`, auth);
  const review = (cookie, space = camp) => call('GET', `/api/spaces/${space}/agent-review`, { cookie });
  const task = async (id, title, cookie = miaC, space = camp) => {
    const who = cookie === miaC ? { byKey: mia.key, by: 'Mia' } : { byKey: 'admin', by: 'Admin' };
    const r = await put('todo', `task:${id}`, { id, title, ...who }, cookie, space);
    ok(r, `the task ${id}`);
    return r.json.version;
  };

  // What is there to ask about: Mia's poll with a vote, another poll, tasks, an itinerary entry with its Calendar copy.
  const poll = (id, question) => ({ id, question, options: [{ id: 'a', label: 'Yes' }, { id: 'b', label: 'No' }], byKey: mia.key, by: 'Mia', multi: false, addable: false, closed: false, closesAt: null });
  ok(await put('polls', 'poll:p1', poll('p1', 'Lunch by the sea'), miaC), 'Mia\'s poll');
  ok(await put('polls', 'poll:p2', poll('p2', 'Dinner'), miaC), 'another poll');
  ok(await put('polls', `vote:p1:${max.key}`, { options: ['a'], name: 'Max' }, maxC), 'Max votes');
  await task('t1', 'Feed the llama');
  await task('t2', 'Water the plants');
  await task('f1', 'A task in Fort', miaC, fort);

  await test('without the row: no ask, `me` does not list it, the action is shown with may false', async () => {
    const roles = (await call('GET', '/api/roles', { cookie: admin })).json;
    const row = roles.permissions.find((p) => p.key === 'agentDelete');
    assert.equal(row.label, 'Ask to delete objects');
    assert.equal(row.agentOnly, true);
    assert.equal(roles.roles.agent.agentDelete, false, 'off by default');
    assert.ok(!('agentDelete' in roles.roles.member), 'a person\'s column has no such row');
    refused(await askFor(ref('todo', 'task', 't1')), 403, CANT, 'an ask without the row');
    assert.ok(!(await call('GET', '/api/agent/me', T)).json.permissions.includes('agentDelete'));
    const shown = (await call('GET', `/api/spaces/${camp}/actions`, T)).json.actions.find((a) => a.action === 'todo:deleteTask');
    assert.deepEqual([shown.effect, shown.approval, shown.may, shown.kind, shown.now], ['delete', 'each', false, 'task', false]);
    assert.equal(shown.description, 'Deletes a task. Use ask_to_delete; a person approves each one.');
    refused(await call('PATCH', '/api/roles/member', { cookie: admin, body: { agentDelete: true } }), 400, /^Only an agent can have "Ask to delete objects"\.$/, 'the member column');
    ok(await column({ agentDelete: true }), 'the owner ticks it');
    assert.ok((await call('GET', '/api/agent/me', T)).json.permissions.includes('agentDelete'));
    assert.equal((await call('GET', `/api/spaces/${camp}/actions`, T)).json.actions.find((a) => a.action === 'todo:deleteTask').may, true);
  });

  await test('a delete action is never a request: 403 for an agent, not offered to a person or to another module', async () => {
    const r = await call('POST', `/api/spaces/${camp}/action`, { ...T, body: { action: 'todo:deleteTask', input: { task: ref('todo', 'task', 't1') } } });
    refused(r, 403, VIA_ASK, 'the action route');
    refused(await call('POST', `/api/spaces/${camp}/action`, { cookie: admin, body: { action: 'todo:deleteTask', input: { task: ref('todo', 'task', 't1') } } }), 404, null, 'a person');
    assert.ok(!(await call('GET', `/api/spaces/${camp}/actions`, { cookie: admin })).json.actions.some((a) => a.name === 'deleteTask'), 'not in a person\'s list');
    const bus = await call('POST', '/api/bus/actions/request', { cookie: admin, body: { from: 'polls', action: 'todo:deleteTask', input: { task: ref('todo', 'task', 't1') }, scope: 'space', space: camp } });
    assert.ok(bus.status >= 400, `the bus refuses it: ${bus.status}`);
    assert.ok((await data('todo'))['task:t1'], 'nothing was deleted');
  });

  await test('hostile asks: each refused with its status and one sentence, and nothing is deleted', async () => {
    const t1 = ref('todo', 'task', 't1');
    refused(await call('POST', `/api/spaces/${camp}/delete-asks`, { ...T5, body: [t1] }), 400, 'Send { object, reason } as JSON.', 'a list');
    refused(await askFor(t1, T5, { approve: true }), 400, 'Only object, reason can be sent.', 'another key');
    refused(await askFor(t1, T5, { version: 1 }), 400, 'Only object, reason can be sent.', 'a version of its own');
    refused(await askFor({ ...t1, key: 'task:t2' }, T5), 400, /^object is a pointer/, 'a key of its own choosing');
    refused(await askFor({ ...t1, id: '../t1' }, T5), 400, /^object is a pointer/, 'an id that is not one');
    refused(await askFor(t1, T5, { reason: { text: 'x' } }), 400, 'reason is plain text, up to 200 characters.', 'a reason that is not text');
    refused(await askFor(ref('todo', 'task', 'f1', fort), T5), 403, 'An agent can only ask to delete an object in the space it asks in.', 'another of its spaces\' objects');
    refused(await askFor({ module: 'todo', kind: 'task', id: 't1', scope: 'environment' }, T5), 403, null, 'an environment pointer');
    refused(await askFor({ module: 'todo', kind: 'task', id: 't1', scope: 'person', space: camp }, T5), 403, null, 'a person-scope pointer');
    refused(await askFor(ref('todo', 'task', 't1', away), T5, {}, away), 404, 'no such space', 'a space it is not in');
    refused(await askFor(ref('todo', 'task', 'f1', fort), T2, {}, fort), 404, 'no such space', 'another agent\'s space');
    refused(await askFor(ref('polls', 'vote', 'p1'), T5), 403, 'An agent can\'t ask to delete that kind of object.', 'a kind with no delete action');
    refused(await askFor(ref('travel', 'plan', 'x1'), T5), 403, 'An agent can\'t ask to delete that kind of object.', 'a module with no delete action');
    refused(await askFor(ref('nothere', 'task', 't1'), T5), 404, 'no such module', 'no such module');
    refused(await askFor(ref('todo', 'task', 'nope'), T5), 404, 'That isn\'t there.', 'a missing object');
    // A Calendar copy of an itinerary entry: the agent asks for the original.
    ok(await put('travel', 'plan:n1', { kind: 'other', id: 'n1', title: 'Quiet harbour walk', date: '2026-12-20', time: '10:00', place: '', category: 'other', done: false }, admin), 'an itinerary entry');
    const copy = Object.values(await data('calendar')).find((i) => i.value?.title === 'Quiet harbour walk');
    assert.ok(copy, 'its Calendar copy is there');
    refused(await askFor(ref('calendar', 'event', copy.key.slice('event:'.length))), 409, /^That is a copy; ask to delete it in .*Itinerary\.$/, 'a Calendar copy');
    // Without the module's write row.
    ok(await column({ 'module.todo.edit': false }), 'To-do\'s write row off');
    refused(await askFor(t1, T5), 403, 'your role can\'t do that in this module', 'without the module\'s write row');
    assert.equal((await call('GET', `/api/spaces/${camp}/actions`, T5)).json.actions.find((a) => a.action === 'todo:deleteTask').may, false);
    ok(await column({ 'module.todo.edit': true }), 'back on');
    const file = path.join(dir, 'agent-records.json');
    assert.equal(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).asks.length : 0, 0, 'no ask was kept');
    assert.ok((await data('todo'))['task:t1'] && (await data('calendar'))[copy.key], 'nothing was deleted');
  });

  let pollAsk = null;
  await test('an ask: 202, nothing changes, the reason cut at 200, one waiting an object, the approvers told', async () => {
    const reason = `because the llama said so ${'x'.repeat(400)}`;
    const r = await askFor(ref('polls', 'poll', 'p1'), T, { reason });
    ok(r, 'the ask', 202);
    assert.deepEqual(Object.keys(r.json.ask).sort(), ['expiresAt', 'id', 'state']);
    assert.equal(r.json.ask.state, 'waiting');
    pollAsk = r.json.ask.id;
    assert.ok((await data('polls'))['poll:p1'] && (await data('polls'))[`vote:p1:${max.key}`], 'the ask deletes nothing');
    refused(await askFor(ref('polls', 'poll', 'p1')), 409, 'There is already an ask to delete that.', 'the same ask');
    refused(await askFor(ref('polls', 'poll', 'p1'), T2), 409, 'There is already an ask to delete that.', 'another agent\'s ask for it');
    const kept = JSON.parse(fs.readFileSync(path.join(dir, 'agent-records.json'), 'utf8')).asks.find((a) => a.id === pollAsk);
    assert.equal(kept.reason.length, 200, 'cut at 200');
    assert.deepEqual(kept.object, { module: 'polls', kind: 'poll', id: 'p1', scope: 'space', space: camp, key: 'poll:p1' });
    assert.equal(kept.version, (await data('polls'))['poll:p1'].version);
    assert.ok(!JSON.stringify(kept).includes('Lunch'), 'keys and ids only');
    // What the agent reads of it: keys and ids, no title, no reason.
    const mine = await status(pollAsk);
    ok(mine, 'its own ask');
    assert.deepEqual(Object.keys(mine.json.ask).sort(), ['ask', 'at', 'expiresAt', 'id', 'object', 'space', 'state']);
    assert.ok(!mine.text.includes('Lunch') && !mine.text.includes('llama'));
    refused(await status(pollAsk, T2), 404, 'No such ask.', 'another agent\'s ask');
    // The bell: owners and the admin, never a member; a count of what waits for them. Max can't delete Mia's poll (the
    // module's guards), but he reviews the space, so it counts for him and his list says why he can't approve it.
    const bell = async (cookie) => (await call('GET', '/api/notifications', { cookie })).json;
    const mine2 = await bell(admin);
    assert.equal(mine2.asks, 1);
    assert.ok(mine2.notifications.some((x) => x.title === 'Claude (agent) asks to delete the poll "Lunch by the sea" in Polls, in Camp.' && x.href === `/?agents=${camp}#ask-${pollAsk}`), JSON.stringify(mine2.notifications.map((x) => x.title)));
    const hers = await bell(miaC);
    assert.equal(hers.asks, 0);
    assert.ok(!hers.notifications.some((x) => /asks to delete/.test(x.title)), 'a member is told nothing');
    assert.equal((await bell(maxC)).asks, 1, 'the space\'s moderator');
  });

  await test('the agent\'s token is 403 on every approve, decline, review and undo route', async () => {
    for (const [method, url, body] of [
      ['POST', `/api/spaces/${camp}/asks/${pollAsk}`, { decision: 'approve', version: 1 }],
      ['POST', `/api/spaces/${camp}/asks/${pollAsk}`, { decision: 'decline' }],
      ['POST', `/api/users/${agent.key}/asks/${pollAsk}`, { decision: 'approve', version: 1 }],
      ['GET', `/api/users/${agent.key}/asks`],
      ['GET', `/api/spaces/${camp}/agent-review`],
      ['POST', `/api/spaces/${camp}/changes/${pollAsk}/undo`, {}],
      ['DELETE', `/api/modules/polls/data/${encodeURIComponent('poll:p1')}?scope=space&space=${camp}`],
      ['GET', '/api/notifications'],
    ]) {
      for (const auth of [T, T2]) refused(await call(method, url, { ...auth, body }), 403, CANT, `${method} ${url}: an agent's token`);
    }
    assert.ok((await data('polls'))['poll:p1'], 'still there');
    assert.equal((await status(pollAsk)).json.ask.state, 'waiting');
  });

  await test('who may answer: never a member or another space\'s moderator; the wrong space is 404; a bad body is 400', async () => {
    const version = (await data('polls'))['poll:p1'].version;
    refused(await answer(miaC, pollAsk, { decision: 'approve', version }), 403, 'Only owners, the admin and this space\'s moderators answer what agents ask here.', 'a member (who made it)');
    refused(await review(miaC), 403, null, 'a member\'s review list');
    refused(await answer(maxC, pollAsk, { decision: 'approve', version }, fort), 403, null, 'not Fort\'s moderator');
    refused(await answer(admin, pollAsk, { decision: 'approve', version }, fort), 404, 'No such ask.', 'the ask is not Fort\'s');
    refused(await answer(admin, 'f'.repeat(16), { decision: 'approve', version }), 404, 'No such ask.', 'no such ask');
    refused(await answer(admin, pollAsk, { decision: 'approve' }), 400, 'Send the version the ask showed with an approval.', 'no version');
    refused(await answer(admin, pollAsk, { decision: 'approve', version: '1' }), 400, null, 'a version that is not a number');
    refused(await answer(admin, pollAsk, { decision: 'yes', version }), 400, 'decision is approve or decline.', 'another decision');
    refused(await answer(admin, pollAsk, { decision: 'approve', version, key: 'poll:p2' }), 400, 'Send { decision, version } as JSON.', 'a key of its own');
    refused(await call('POST', `/api/spaces/${camp}/asks/${pollAsk}`, { body: { decision: 'approve', version } }), 401, null, 'signed out');
    // The moderator reviews the space but may not delete someone else's poll: 403 with the module's sentence, still waiting.
    const asMax = await answer(maxC, pollAsk, { decision: 'approve', version });
    assert.equal(asMax.status, 403, `an approver the guards refuse: ${asMax.status} ${asMax.text}`);
    assert.ok(asMax.json.error && asMax.json.error.length < 200);
    const his = (await review(maxC)).json.waiting.find((a) => a.id === pollAsk);
    assert.equal(his.decidable, false);
    assert.equal(his.why, asMax.json.error, 'his list says why');
    assert.ok((await data('polls'))['poll:p1'], 'nothing was deleted');
    assert.equal((await status(pollAsk)).json.ask.state, 'waiting', 'it still waits for someone who may');
  });

  let deleted = null;
  await test('approving deletes exactly the asked object and what belongs to it; a second answer is 409', async () => {
    const shown = (await review(admin)).json.waiting.find((a) => a.id === pollAsk);
    assert.equal(shown.text, 'Claude (agent) asks to delete the poll "Lunch by the sea" in Polls.');
    assert.equal(shown.title, 'Lunch by the sea');
    assert.equal(shown.kind, 'poll');
    assert.deepEqual(shown.madeBy, { key: mia.key, name: 'Mia' });
    assert.equal(shown.reason.length, 200);
    assert.deepEqual(shown.goesWith, { children: 1, holders: 0 });
    assert.equal(shown.decidable, true);
    const before = Object.keys(await data('polls')).sort();
    const r = await answer(admin, pollAsk, { decision: 'approve', version: shown.version });
    ok(r, 'the admin approves');
    assert.equal(r.json.ask.state, 'approved');
    assert.equal(r.json.change.change, 'deleted');
    assert.equal(r.json.change.text, 'Claude (agent) deleted the poll "Lunch by the sea" in Polls');
    assert.equal(r.json.change.undoable, true);
    deleted = r.json.change;
    const after = Object.keys(await data('polls')).sort();
    assert.deepEqual(after, before.filter((k) => k !== 'poll:p1' && k !== `vote:p1:${max.key}`), 'the poll and its vote went, and nothing else');
    assert.ok(fs.existsSync(path.join(dir, 'modules', 'polls', 'trash', 'agent', `${deleted.id}.json`)), 'what it took is held for the Undo');
    refused(await answer(admin, pollAsk, { decision: 'approve', version: shown.version }), 409, ANSWERED, 'a second approval');
    refused(await answer(admin, pollAsk, { decision: 'decline' }), 409, ANSWERED, 'a decline after it');
    refused(await call('POST', `/api/users/${agent.key}/asks/${pollAsk}`, { cookie: admin, body: { decision: 'approve', version: shown.version } }), 409, ANSWERED, 'on the agent\'s page too');
    assert.equal((await status(pollAsk)).json.ask.state, 'approved');
    const activity = (await call('GET', '/api/modules/activity', { cookie: admin })).json.activity;
    assert.ok(activity.some((a) => a.module === 'polls' && /^deleted a poll, approved by \S/.test(a.what) && a.by === agent.key), `both are named in the activity list: ${JSON.stringify(activity.slice(0, 4).map((a) => [a.what, a.by]))}`);
    assert.equal((await call('GET', '/api/notifications', { cookie: admin })).json.asks, 0);
  });

  await test('Undo puts the object and its children back, and the ask reads undone', async () => {
    ok(await call('POST', `/api/spaces/${camp}/changes/${deleted.id}/undo`, { cookie: admin, body: {} }), 'the admin undoes it');
    const now = await data('polls');
    assert.equal(now['poll:p1'].value.question, 'Lunch by the sea');
    assert.deepEqual(now[`vote:p1:${max.key}`].value.options, ['a'], 'its vote is back');
    assert.equal((await status(pollAsk)).json.ask.state, 'undone');
    const log = (await call('GET', `/api/users/${agent.key}/agent-log`, { cookie: admin })).json.entries.find((e) => e.ask === pollAsk);
    assert.equal(log.route, '/api/spaces/:id/delete-asks');
    assert.equal(log.text, 'Asked to delete a poll in Polls');
    assert.match(log.outcome, /^undone by \S/);
    assert.deepEqual([log.change, log.module, log.status, log.kind], ['ask:delete', 'polls', 202, 'write']);
  });

  await test('a changed object, or a version that is not the ask\'s, refuses and deletes nothing; the ask ends', async () => {
    const first = await askFor(ref('todo', 'task', 't1'));
    ok(first, 'an ask', 202);
    const asked = (await data('todo'))['task:t1'].version;
    await task('t1', 'Feed the llama twice');
    const r = await answer(admin, first.json.ask.id, { decision: 'approve', version: asked });
    refused(r, 409, STALE, 'changed since it was asked');
    refused(await answer(admin, first.json.ask.id, { decision: 'approve', version: asked + 1 }), 409, 'That ask has run out.', 'and not with the new version either: the ask is over');
    assert.equal((await status(first.json.ask.id)).json.ask.state, 'expired');
    assert.ok((await data('todo'))['task:t1'], 'nothing was deleted');
    // Another ask's version sent with this ask.
    const second = await askFor(ref('todo', 'task', 't1'));
    ok(second, 'asked again at the new version', 202);
    const t2 = (await data('todo'))['task:t2'].version;
    assert.notEqual(t2, (await data('todo'))['task:t1'].version);
    refused(await answer(admin, second.json.ask.id, { decision: 'approve', version: t2 }), 409, STALE, 'a version that is not this ask\'s');
    assert.ok((await data('todo'))['task:t1'] && (await data('todo'))['task:t2'], 'nothing was deleted');
    // The object gone before the answer.
    const third = await askFor(ref('todo', 'task', 't2'));
    ok(third, 'an ask', 202);
    ok(await call('DELETE', `/api/modules/todo/data/${encodeURIComponent('task:t2')}?scope=space&space=${camp}`, { cookie: miaC }), 'Mia deletes it herself');
    refused(await answer(admin, third.json.ask.id, { decision: 'approve', version: t2 }), 409, STALE, 'gone already');
  });

  await test('a decline: the moderator may, it deletes nothing, and the object can\'t be asked about for 7 days', async () => {
    await task('t3', 'Sweep the yard');
    const a = await askFor(ref('todo', 'task', 't3'), T2);
    ok(a, 'the other agent asks', 202);
    const r = await answer(maxC, a.json.ask.id, { decision: 'decline' });
    ok(r, 'Max declines');
    assert.equal(r.json.ask.state, 'declined');
    assert.equal(r.json.change, undefined);
    assert.ok((await data('todo'))['task:t3'], 'still there');
    refused(await answer(maxC, a.json.ask.id, { decision: 'decline' }), 409, ANSWERED, 'a second decline');
    refused(await answer(admin, a.json.ask.id, { decision: 'approve', version: 1 }), 409, ANSWERED, 'an approval after a decline');
    assert.equal((await status(a.json.ask.id, T2)).json.ask.state, 'declined');
    const until = new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10);
    for (const auth of [T, T2]) refused(await askFor(ref('todo', 'task', 't3'), auth), 409, `A person declined deleting that. Don't ask again before ${until}.`, 'asked again');
  });

  await test('the moderator approves what they may delete; the owner\'s list on the agent\'s page says it in words', async () => {
    await task('t4', 'Mend the fence');
    const a = await askFor(ref('todo', 'task', 't4'), T2);
    ok(a, 'an ask', 202);
    const list = (await call('GET', `/api/users/${other.key}/asks`, { cookie: admin })).json.asks;
    const mine = list.find((x) => x.id === a.json.ask.id);
    assert.equal(mine.text, 'Claude (agent) asks to delete the task "Mend the fence" in To-do, in Camp.');
    assert.equal(mine.ask, 'delete');
    assert.ok(list.some((x) => x.state === 'declined'), 'answered ones stay on the list');
    const r = await answer(maxC, a.json.ask.id, { decision: 'approve', version: mine.version });
    ok(r, 'Max approves');
    assert.equal((await data('todo'))['task:t4'], undefined, 'deleted');
    assert.equal((await review(maxC)).json.done[0].text, 'Claude (agent) deleted the task "Mend the fence" in To-do');
  });

  await test('a space closed for set up: no ask, and an approval waits until it is open again', async () => {
    await task('t5', 'Paint the gate');
    const a = await askFor(ref('todo', 'task', 't5'), T2);
    ok(a, 'an ask', 202);
    const version = (await data('todo'))['task:t5'].version;
    ok(await call('PATCH', `/api/spaces/${camp}`, { cookie: admin, body: { closed: true } }), 'Camp is closed for set up');
    refused(await askFor(ref('todo', 'task', 't1'), T2), 404, 'no such space', 'an ask in a closed space');
    refused(await answer(admin, a.json.ask.id, { decision: 'approve', version }), 409, 'This space is closed for set up. Answer this when it is open again.', 'an approval while it is closed');
    assert.ok((await data('todo'))['task:t5'], 'nothing was deleted');
    ok(await call('PATCH', `/api/spaces/${camp}`, { cookie: admin, body: { closed: false } }), 'open again');
    assert.equal((await status(a.json.ask.id, T2)).json.ask.state, 'waiting', 'it waited');
    ok(await answer(admin, a.json.ask.id, { decision: 'approve', version }), 'approved once it is open');
    assert.equal((await data('todo'))['task:t5'], undefined);
  });

  await test('the right taken away, or the token revoked, ends the ask', async () => {
    await task('t6', 'Fix the roof');
    await task('t7', 'Oil the hinge');
    const a = await askFor(ref('todo', 'task', 't6'), T4);
    ok(a, 'an ask', 202);
    const b = await askFor(ref('todo', 'task', 't7'), T4);
    ok(b, 'another', 202);
    const version = (await data('todo'))['task:t6'].version;
    ok(await column({ agentDelete: false }), 'the row is unticked');
    refused(await answer(admin, a.json.ask.id, { decision: 'approve', version }), 409, 'Claude (agent) may no longer ask to delete that.', 'approving without the agent\'s right');
    assert.ok((await data('todo'))['task:t6'], 'nothing was deleted');
    ok(await column({ agentDelete: true }), 'ticked again');
    refused(await answer(admin, a.json.ask.id, { decision: 'approve', version }), 409, 'That ask has run out.', 'it ended');
    ok(await call('DELETE', `/api/users/${late.key}/token`, { cookie: admin }), 'Revoke');
    refused(await answer(admin, b.json.ask.id, { decision: 'approve', version: (await data('todo'))['task:t7'].version }), 409, 'That ask has run out.', 'the revoked agent\'s ask');
    assert.ok((await data('todo'))['task:t7'], 'nothing was deleted');
    refused(await status(b.json.ask.id, T4), 401, null, 'the revoked token');
  });

  await test('MCP: ask_to_delete and ask_status are listed and are the routes', async () => {
    const rpc = (method, params, auth = T2) => call('POST', '/mcp', { ...auth, body: { jsonrpc: '2.0', id: 1, method, params } });
    const names = (await rpc('tools/list', {})).json.result.tools.map((t) => t.name);
    for (const name of ['ask_to_delete', 'ask_status', 'object_format']) assert.ok(names.includes(name), `${name} is listed`);
    await task('t8', 'Stack the wood');
    const made = await rpc('tools/call', { name: 'ask_to_delete', arguments: { space: camp, object: ref('todo', 'task', 't8'), reason: 'It is done.' } });
    assert.equal(made.json.result.isError, undefined, made.text);
    const id = JSON.parse(made.json.result.content[0].text).ask.id;
    const how = await rpc('tools/call', { name: 'ask_status', arguments: { id } });
    assert.equal(JSON.parse(how.json.result.content[0].text).ask.state, 'waiting');
    const extra = await rpc('tools/call', { name: 'ask_to_delete', arguments: { space: camp, object: ref('todo', 'task', 't8'), approve: true } });
    assert.ok(extra.json.error || extra.json.result.isError, 'an argument of its own is refused');
    assert.ok((await data('todo'))['task:t8'], 'the tool deletes nothing');
  });

  await test('the gate\'s minute limit answers 429 with the sentence', async () => {
    let last = null;
    for (let i = 0; i < 22; i += 1) last = await askFor(ref('todo', 'task', 'nope'), T3);
    refused(last, 429, OVER, 'past 20 writes a minute');
    assert.ok(Number(last.headers['retry-after']) > 0);
  });

  await test('no title, reason or value in the agent\'s log, the records, or the server\'s own output', async () => {
    const logs = agents.map((key) => path.join(dir, 'agent-log', key)).filter((d) => fs.existsSync(d));
    const text = logs.flatMap((d) => fs.readdirSync(d).map((f) => fs.readFileSync(path.join(d, f), 'utf8'))).join('\n');
    assert.ok(text.includes('"change":"ask:delete"'), 'the asks are in the log');
    const records = fs.readFileSync(path.join(dir, 'agent-records.json'), 'utf8');
    for (const secret of SECRETS) {
      assert.ok(!text.includes(secret), `no "${secret}" in the agents' log`);
      assert.ok(!server.out.includes(secret), `no "${secret}" in the server's output`);
      if (secret !== 'because the llama said so') assert.ok(!records.includes(secret), `no "${secret}" in the records`);
    }
    assert.ok(records.includes('because the llama said so'), 'the reason is the only words the records keep');
  });
} catch (err) {
  failed += 1;
  console.error(`FAIL setting up\n${err.stack || err}`);
} finally {
  for (const s of servers) await s.stop();
  fs.rmSync(base, { recursive: true, force: true });
}

if (failed) {
  console.error(`check-agent-delete-asks: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-agent-delete-asks: ${n} passed`);
