#!/usr/bin/env node
/*
 * check-agent-queue.mjs -- an agent's waiting requests end with its right to ask (documentation/plans/plan-agent-access.md,
 * "What a leaked token can do" and the kill switches), against a real server on a throwaway DATA_DIR, with the bundled Planner:
 *   - a request an agent asked for is offered (GET /api/bus/actions/pending), claimed and finished only while the agent may
 *     still ask: AGENT_TOKENS and Agents on, the agent here, not turned off, holding the very token that asked, live, and still
 *     a member of the request's space who may work there;
 *   - Revoke, a new token, Turn off, Agents off, Delete, taking the agent off a space (DELETE /api/spaces/:id/members/:key and
 *     PATCH /api/spaces/:id { members }) end its waiting requests for good: done, failed with one sentence, `cancelled`, with
 *     one line in the activity list; claim and complete then answer { ok: false };
 *   - a path that ends nothing (AGENT_TOKENS off and a restart, a space closed for set up) still holds, by the check at offer,
 *     claim and finish; a space closed for set up only hides the request until it opens again;
 *   - removal from one space ends only that space's requests; a still-live agent's request and a person's are untouched;
 *   - a request claimed just before the agent lost its right: finishing it is refused, and a page's write naming the agent
 *     (`for`) is saved as the carrier's own, with no "not believed" line;
 *   - the agent, with a new token, reads its ended request's status as done, not ok, with the sentence;
 *   - GET /api/presence marks an agent `agent: true`, and nobody else.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENDED = 'The agent that asked for this can no longer ask for it.';

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};

const servers = [];
async function startServer(dataDir, env = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, TZ: 'UTC', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const server = { child, out: '', port: 0 };
  child.stdout.on('data', (d) => { server.out += d; });
  child.stderr.on('data', (d) => { server.out += d; });
  server.port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${server.out}`)); }, 25000);
    const onData = () => { const m = /listening on :(\d+)/.exec(server.out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${server.out}`)); });
  });
  server.stop = () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
  servers.push(server);
  return server;
}

let server = null;
function call(method, urlPath, { body, cookie, token } = {}) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const headers = { host: `127.0.0.1:${server.port}`, accept: 'application/json' };
  if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = payload.length; }
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
        resolve({ status: res.statusCode, json, text });
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
const ok = (r, what, status = 200) => assert.equal(r.status, status, `${what}: ${r.status} ${r.text.slice(0, 300)}`);

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-agent-queue-'));
const dir = path.join(base, 'single');
const ENV = { ADMIN_PASSWORD: 'admin-password-1', AGENT_TOKENS: 'true' };
const busFile = () => JSON.parse(fs.readFileSync(path.join(dir, 'modules', 'bus.json'), 'utf8'));
try {
  server = await startServer(dir, ENV);
  const admin = await signIn('admin', 'admin-password-1');
  ok(await call('PATCH', '/api/settings', { cookie: admin, body: { agents: true } }), 'Agents on');
  const mia = (await call('POST', '/api/users', { cookie: admin, body: { login: 'mia', password: 'mia-password-1', displayName: 'Mia', role: 'member' } })).json.user;
  const agent = (await call('POST', '/api/users', { cookie: admin, body: { agent: true } })).json.user;
  const camp = (await call('POST', '/api/spaces', { cookie: admin, body: { name: 'Camp', members: [agent.key, mia.key] } })).json.space.id;
  const fort = (await call('POST', '/api/spaces', { cookie: admin, body: { name: 'Fort', members: [agent.key, mia.key] } })).json.space.id;
  ok(await call('POST', '/api/modules/bundled/schedule/install', { cookie: admin, body: {} }), 'the Planner installs', 201);
  ok(await call('PATCH', '/api/modules/schedule', { cookie: admin, body: { enabled: true, allSpaces: true } }), 'the Planner on');
  const miaCookie = await signIn('mia', 'mia-password-1');
  let token = null;
  const newToken = async () => {
    const r = await call('POST', `/api/users/${agent.key}/token`, { cookie: admin });
    ok(r, 'a token', 201);
    token = r.json.token;
    return token;
  };
  await newToken();

  const ask = async (space, title, by = { token }) => {
    const r = await call('POST', `/api/spaces/${space}/action`, { ...by, body: { action: 'schedule:addNote', input: { title } } });
    ok(r, `asks for ${title}`);
    return r.json.id;
  };
  const offered = async (space, id, cookie = miaCookie) => {
    const r = await call('GET', `/api/bus/actions/pending?module=schedule&scope=space&space=${space}`, { cookie });
    ok(r, 'pending');
    return r.json.actions.some((a) => a.id === id);
  };
  const claim = (space, id, cookie = miaCookie) => call('POST', '/api/bus/actions/claim', { cookie, body: { module: 'schedule', id, scope: 'space', space } });
  const complete = (space, id, cookie = miaCookie) => call('POST', '/api/bus/actions/complete', { cookie, body: { module: 'schedule', id, scope: 'space', space, result: { ok: true } } });
  const activity = async () => (await call('GET', '/api/modules/activity', { cookie: admin })).json.activity;
  // Not offered, not claimed, not finished, and ended in the file with the sentence.
  const refusedEverywhere = async (space, id, what) => {
    assert.equal(await offered(space, id), false, `${what}: not offered`);
    const c = await claim(space, id);
    ok(c, `${what}: claim answers`);
    assert.equal(c.json.ok, false, `${what}: claim refused`);
    const d = await complete(space, id);
    ok(d, `${what}: complete answers`);
    assert.equal(d.json.ok, false, `${what}: complete refused`);
  };
  const endedInFile = (id, what) => {
    const a = busFile().actions.find((x) => x.id === id);
    assert.ok(a, `${what}: still in the file`);
    assert.equal(a.cancelled, true, `${what}: ended`);
    assert.equal(a.status, 'done', `${what}: done`);
    assert.deepEqual(a.result, { ok: false, error: ENDED }, `${what}: failed with the sentence`);
  };

  await test('a live agent\'s request is offered, claimed and finished, carries its token and names the agent', async () => {
    const id = await ask(camp, 'Live one');
    const stored = busFile().actions.find((a) => a.id === id);
    assert.equal(stored.agent, true, 'marked an agent\'s');
    assert.equal(typeof stored.agentToken, 'string', 'with the token that asked');
    assert.ok(!JSON.stringify(stored).includes(token), 'never the token itself');
    assert.equal(await offered(camp, id), true, 'offered');
    const c = await claim(camp, id);
    assert.equal(c.json.ok, true, 'claimed');
    assert.equal(c.json.action.byKey, agent.key);
    ok(await call('PUT', `/api/modules/schedule/data/plan%3Alive?scope=space&space=${camp}`, { cookie: miaCookie, body: { value: { id: 'live', kind: 'note', title: 'Live one' }, for: agent.key, request: id } }), 'the write');
    const line = (await activity()).find((l) => l.what === 'saved plan:live');
    assert.equal(line.by, agent.key, 'the write names the agent');
    assert.equal(line.carriedBy, mia.key);
    assert.equal((await complete(camp, id)).json.ok, true, 'finished');
  });

  await test('Revoke ends its waiting requests: not offered, claim and complete refused, one activity line', async () => {
    const a = await ask(camp, 'Before revoke 1');
    const b = await ask(camp, 'Before revoke 2');
    ok(await call('DELETE', `/api/users/${agent.key}/token`, { cookie: admin }), 'revoke');
    for (const id of [a, b]) { await refusedEverywhere(camp, id, `revoked ${id}`); endedInFile(id, `revoked ${id}`); }
    const line = (await activity()).find((l) => l.what === 'can no longer ask, so 2 waiting requests were dropped');
    assert.ok(line, 'one line for the two');
    assert.equal(line.by, agent.key);
    assert.equal(line.askerAgent, true);
    await newToken();
    assert.equal(await offered(camp, a), false, 'a new token does not bring it back');
  });

  await test('the agent reads its ended request\'s status with a new token: done, not ok, the sentence', async () => {
    const id = await ask(camp, 'Read after');
    ok(await call('DELETE', `/api/users/${agent.key}/token`, { cookie: admin }), 'revoke');
    await newToken();
    const r = await call('GET', `/api/spaces/${camp}/action/${id}`, { token });
    ok(r, 'status');
    assert.deepEqual(r.json, { id, status: 'done', ok: false, error: ENDED });
  });

  await test('a new token ends what the earlier token asked for; the new token\'s requests stand', async () => {
    const old = await ask(camp, 'Old token');
    await newToken();
    await refusedEverywhere(camp, old, 'old token');
    endedInFile(old, 'old token');
    const fresh = await ask(camp, 'New token');
    assert.equal(await offered(camp, fresh), true, 'the new token\'s request is offered');
    assert.equal((await claim(camp, fresh)).json.ok, true);
    assert.equal((await complete(camp, fresh)).json.ok, true);
  });

  await test('Turn off ends its waiting requests; turning it on again does not bring them back', async () => {
    const id = await ask(camp, 'Before off');
    ok(await call('PATCH', `/api/users/${agent.key}`, { cookie: admin, body: { off: true } }), 'off');
    await refusedEverywhere(camp, id, 'off');
    endedInFile(id, 'off');
    ok(await call('PATCH', `/api/users/${agent.key}`, { cookie: admin, body: { off: false } }), 'on');
    assert.equal(await offered(camp, id), false, 'still ended');
  });

  await test('Agents off ends every agent\'s waiting requests, and a person\'s stand', async () => {
    const id = await ask(camp, 'Before Agents off');
    const mine = await ask(camp, 'Mia asks', { cookie: miaCookie });
    ok(await call('PATCH', '/api/settings', { cookie: admin, body: { agents: false } }), 'Agents off');
    await refusedEverywhere(camp, id, 'Agents off');
    endedInFile(id, 'Agents off');
    assert.equal(await offered(camp, mine, admin), true, 'a person\'s request is still offered');
    ok(await call('PATCH', '/api/settings', { cookie: admin, body: { agents: true } }), 'Agents on');
    assert.equal(await offered(camp, id), false, 'still ended after Agents is on again');
    assert.equal((await claim(camp, mine, admin)).json.ok, true, 'a person\'s request is claimed');
    assert.equal((await complete(camp, mine, admin)).json.ok, true);
  });

  await test('taken off one space: that space\'s requests end, another space\'s stand', async () => {
    const here = await ask(camp, 'In Camp');
    const there = await ask(fort, 'In Fort');
    ok(await call('DELETE', `/api/spaces/${camp}/members/${agent.key}`, { cookie: admin }), 'taken off Camp');
    await refusedEverywhere(camp, here, 'off Camp');
    endedInFile(here, 'off Camp');
    assert.equal(await offered(fort, there), true, 'Fort\'s is still offered');
    assert.equal((await claim(fort, there)).json.ok, true);
    assert.equal((await complete(fort, there)).json.ok, true);
    ok(await call('PATCH', `/api/spaces/${camp}`, { cookie: admin, body: { members: [agent.key, mia.key] } }), 'back in Camp');
  });

  await test('taken off a space\'s members through Set up (PATCH members) ends that space\'s requests', async () => {
    const id = await ask(camp, 'Set up removal');
    ok(await call('PATCH', `/api/spaces/${camp}`, { cookie: admin, body: { members: [mia.key] } }), 'members without the agent');
    await refusedEverywhere(camp, id, 'Set up removal');
    endedInFile(id, 'Set up removal');
    ok(await call('PATCH', `/api/spaces/${camp}`, { cookie: admin, body: { members: [agent.key, mia.key] } }), 'back in Camp');
  });

  await test('a space closed for set up hides the request until it opens, and ends nothing', async () => {
    const id = await ask(camp, 'While closed');
    ok(await call('PATCH', `/api/spaces/${camp}`, { cookie: admin, body: { closed: true, members: [agent.key, mia.key] } }), 'closed');
    assert.equal(await offered(camp, id, admin), false, 'not offered while closed');
    assert.equal((await claim(camp, id, admin)).json.ok, false, 'not claimed while closed');
    assert.equal(busFile().actions.find((a) => a.id === id).cancelled, undefined, 'not ended');
    ok(await call('PATCH', `/api/spaces/${camp}`, { cookie: admin, body: { closed: false } }), 'open');
    assert.equal(await offered(camp, id), true, 'offered again');
    assert.equal((await claim(camp, id)).json.ok, true);
    assert.equal((await complete(camp, id)).json.ok, true);
  });

  await test('claimed just before revoke: finishing is refused and the write is the carrier\'s own, with no "not believed" line', async () => {
    const id = await ask(camp, 'Racing');
    assert.equal((await claim(camp, id)).json.ok, true, 'claimed');
    ok(await call('DELETE', `/api/users/${agent.key}/token`, { cookie: admin }), 'revoke');
    const before = (await activity()).filter((l) => l.what.startsWith('sent a name')).length;
    ok(await call('PUT', `/api/modules/schedule/data/plan%3Arace?scope=space&space=${camp}`, { cookie: miaCookie, body: { value: { id: 'race', kind: 'note', title: 'Racing' }, for: agent.key, request: id } }), 'the write');
    const line = (await activity()).find((l) => l.what === 'saved plan:race');
    assert.equal(line.by, mia.key, 'the carrier\'s own');
    assert.equal(line.carriedBy, undefined, 'nobody else named');
    assert.equal((await activity()).filter((l) => l.what.startsWith('sent a name')).length, before, 'the honest page is not blamed');
    assert.equal((await complete(camp, id)).json.ok, false, 'finishing refused');
    endedInFile(id, 'racing');
    await newToken();
  });

  await test('AGENT_TOKENS off and a restart: nothing ended it, and it is still not offered, claimed or finished', async () => {
    const id = await ask(camp, 'Server off');
    await server.stop();
    server = await startServer(dir, { ADMIN_PASSWORD: 'admin-password-1' });
    const adminAgain = await signIn('admin', 'admin-password-1');
    const miaAgain = await signIn('mia', 'mia-password-1');
    assert.equal(await offered(camp, id, miaAgain), false, 'not offered');
    assert.equal((await claim(camp, id, miaAgain)).json.ok, false, 'not claimed');
    assert.equal((await complete(camp, id, miaAgain)).json.ok, false, 'not finished');
    assert.equal(busFile().actions.find((a) => a.id === id).status, 'pending', 'nothing ended it');
    void adminAgain;
    await server.stop();
    server = await startServer(dir, ENV);
  });

  await test('Delete ends its waiting requests', async () => {
    const adminNow = await signIn('admin', 'admin-password-1');
    const miaNow = await signIn('mia', 'mia-password-1');
    const id = await ask(camp, 'Before delete');
    assert.equal(await offered(camp, id, miaNow), true, 'offered first');
    ok(await call('DELETE', `/api/users/${agent.key}`, { cookie: adminNow }), 'deleted');
    assert.equal(await offered(camp, id, miaNow), false, 'not offered');
    assert.equal((await claim(camp, id, miaNow)).json.ok, false);
    assert.equal((await complete(camp, id, miaNow)).json.ok, false);
    endedInFile(id, 'deleted');
  });

  await test('GET /api/presence marks an agent agent: true, and nobody else', async () => {
    const adminNow = await signIn('admin', 'admin-password-1');
    const other = (await call('POST', '/api/users', { cookie: adminNow, body: { agent: true, displayName: 'Helper' } })).json.user;
    ok(await call('PATCH', `/api/spaces/${camp}`, { cookie: adminNow, body: { members: [other.key, mia.key] } }), 'in Camp');
    const miaNow = await signIn('mia', 'mia-password-1');
    const r = await call('GET', '/api/presence', { cookie: miaNow });
    ok(r, 'presence');
    const users = r.json.users;
    assert.equal(users.find((u) => u.key === other.key)?.agent, true, 'the agent');
    for (const u of users.filter((x) => x.key !== other.key)) assert.equal(Object.hasOwn(u, 'agent'), false, `${u.displayName} carries no agent field`);
  });
  await server.stop();
} finally {
  for (const s of servers) if (s.child.exitCode === null) s.child.kill('SIGTERM');
  fs.rmSync(base, { recursive: true, force: true });
}
if (failed) {
  console.error(`check-agent-queue: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-agent-queue: ok (${n} checks)`);
