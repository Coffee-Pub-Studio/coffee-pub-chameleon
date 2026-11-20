#!/usr/bin/env node
/*
 * check-agent-tokens.mjs -- the agent token core (documentation/plans/plan-agent-access.md, step 1), the plan's pen-test
 * list, against real servers on throwaway DATA_DIRs:
 *   - off by default: without AGENT_TOKENS no agent can be made, the Agents switch can't be turned on, and a token made
 *     while it was on is read as an unknown bearer value (401 on a route that needs a sign-in);
 *   - with AGENT_TOKENS=true the owner's Agents switch is off until turned on; an agent is a member with no sign-in, never
 *     an owner, the admin or a moderator, no personal link or password, and no door signs it in;
 *   - its token is shown once, stored only as its SHA-256 (nowhere in DATA_DIR in the clear, in no later answer and in
 *     no line of the server's own log), ends after 30 days (a past end read from tokens.json is refused), and a new one
 *     ends the old; revoke, turn off and the Agents switch each make it 401 with the same sentence;
 *   - the gate: its list answers, every other route the app registers answers 403 "An agent can't do that."; a space it
 *     is not in is the unknown space's 404; scope environment, spaces and person, and no scope, are 403; raw data writes,
 *     Clear and restore are 403; a local, asker-only, destructive or ai:false action is 403 "An agent can't ask for that."
 *     and the actions list leaves them out; it reads only its own requests; the token wins over a cookie session;
 *   - the log's `module` (a data or context read's :id, an action's module; installed ids of a safe shape only, else null) and
 *     the route of a refused call (the path as a fixed shape: only the API's own words kept, every other segment ":x", no
 *     query, at most 80 characters), with a hostile path (../, a 300-character id, proto names, a token, a query) leaving
 *     nothing of itself in the log;
 *   - the limits: 60 reads and 20 writes a minute, counted apart, 429 with Retry-After; the day's counts are read back
 *     from the log, so they survive a restart;
 *   - the log: one line a call, its route pattern and never its token, a request body or the path's own values; owners
 *     read it through GET /api/users/:key/agent-log;
 *   - hosted (BASE_DOMAIN): a token of one environment is 401 at another; the console and the product host answer as before;
 *     an owner's copy restored with a tokens.json, an agent-log/ or an agent-setup.json of its own keeps none, so a planted
 *     token is 401;
 *   - the owner chooses a token's life (POST { expires }: 30d, 60d, 90d, 1y, never; none is 30d; anything else 400); never has
 *     expiresAt null and works for years; a record that lives longer than its chosen life, or is made in the future, is not read;
 *   - calls answered 429 (or 401 for a token the agent no longer may use) leave at most one line a minute in its log;
 *   - tokens.json is written at most once a minute for uses, whatever address each call comes from, and never for a 429;
 *     an address is kept (tokens.json, the log) only when it is an IP address;
 *   - an action's pointer input outside the agent's spaces (the environment's, another space's) is 403;
 *   - a body that is not JSON, with an agent's token, is counted and logged by the gate, then answered 400 as before;
 *   - a server whose ADMIN_LOGIN is an agent's login starts, and says why it made no admin of it;
 *   - the route walk is the app's own router stack (every layer, mounted routers walked into), written at start by
 *     tools/route-walk-preload.cjs: a layer it can't read, a route ahead of the gate it does not know, or a route written in
 *     server/*.js that the walk does not have, fails the check.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { buildModule, zipFiles } = require(path.join(ROOT, 'server', 'module-build.js'));
const { routeTrie, refusedRoute } = require(path.join(ROOT, 'server', 'agent-log.js'));

const INVALID = 'That agent token is not valid.';
const CANT = "An agent can't do that.";
const CANT_ASK = "An agent can't ask for that.";
const CANT_BE = "An agent can't be that.";
const OVER = 'The agent has done as much as it may for now.';
const TOKEN_RE = /^agt_[A-Za-z0-9_-]{43}$/;

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    n += 1;
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}\n${err.stack || err}`);
  }
};

const servers = [];
async function startServer(dataDir, env = {}, nodeArgs = []) {
  const child = spawn(process.execPath, [...nodeArgs, path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, ...env },
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

// Every answer an agent's token made after it was shown is kept, to look for the token in it at the end.
const answers = [];
function call(server, method, urlPath, { body, cookie, token, host, raw, headers: extra } = {}) {
  const payload = raw !== undefined ? raw : body === undefined ? null : Buffer.from(JSON.stringify(body));
  const headers = { host: host ? `${host}.localhost:${server.port}` : `127.0.0.1:${server.port}`, accept: 'application/json', ...(extra || {}) };
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
        answers.push(`${JSON.stringify(res.headers)}\n${text}`);
        resolve({ status: res.statusCode, json, text, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const cookieOf = (res) => [].concat(res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
async function signIn(server, login, password, host) {
  const r = await call(server, 'POST', host === 'admin' ? '/api/host/login' : '/api/login', { body: { login, password }, host });
  assert.equal(r.status, 200, `${login} signs in: ${r.text}`);
  return cookieOf(r);
}
const ok = (r, what, status = 200) => assert.equal(r.status, status, `${what}: ${r.status} ${r.text.slice(0, 300)}`);
const refused = (r, status, error, what) => {
  assert.equal(r.status, status, `${what}: ${r.status} ${r.text.slice(0, 300)}`);
  if (error) assert.equal(r.json?.error, error, `${what}: the sentence`);
};
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
// Every file under `dir`, as text.
function filesUnder(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push([p, fs.readFileSync(p)]);
    }
  };
  walk(dir);
  return out;
}

// A copy of the To-do with three more actions an agent may never ask for: destructive, kept from AI, and asker-only.
function testModuleZip(base) {
  const src = path.join(base, 'todo-agent-check');
  fs.cpSync(path.join(ROOT, 'modules', 'todo'), src, { recursive: true });
  fs.rmSync(path.join(src, 'test'), { recursive: true, force: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(src, 'module.json'), 'utf8'));
  manifest.version = '99.0.0';
  manifest.actions.provides.push(
    { name: 'wipeTasks', label: 'Wipe every task', description: 'Remove every task.', effect: 'destructive', input: {} },
    { name: 'quietTask', label: 'Add a quiet task', description: 'Add a task the AI is never offered.', ai: false, input: { title: 'string' } },
    { name: 'myTask', label: 'Add a task of mine', description: 'Add a task in the asker\'s name.', askerOnly: true, input: { title: 'string' } },
  );
  fs.writeFileSync(path.join(src, 'module.json'), JSON.stringify(manifest, null, 2));
  return buildModule(src).zip;
}

// Every route written in server/*.js with a fixed path ("app.get('/api/...')"), as [method, path]: only to make sure the
// router-stack walk has each of them.
function writtenRoutes() {
  const out = [];
  const dir = path.join(ROOT, 'server');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of text.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) out.push([m[1].toUpperCase(), m[2]]);
  }
  return out;
}
const GATE_LIST = new Set([
  'GET /api/agent/me', 'GET /api/modules/:id/context', 'GET /api/modules/:id/data', 'GET /api/modules/:id/data/:key',
  'GET /api/objects/search', 'GET /api/objects/links', 'GET /api/objects/kinds', 'POST /api/objects/resolve',
  'GET /api/spaces/:id/members', 'GET /api/spaces/:id/actions', 'POST /api/spaces/:id/action', 'GET /api/spaces/:id/action/:requestId',
  // Chat (step 5): reading and posting; tools/check-agent-chat.mjs checks them.
  'GET /api/spaces/:id/chat', 'POST /api/spaces/:id/chat',
  // The MCP door (server/mcp.js): tools/check-mcp.mjs checks it.
  'GET /mcp', 'POST /mcp',
]);

// The only route registered ahead of the agent gate (before the door), so before any session or token is read: the same
// for everyone, signed in or not, and nothing of any environment's. A new one there fails the walk until it is named here.
const PUBLIC_BEFORE_ENVIRONMENTS = new Set(['GET /design-system/module-sources.js']);
const WALK_OUT = path.join(os.tmpdir(), `check-agent-tokens-walk-${process.pid}.json`);
const PRELOAD = ['-r', path.join(ROOT, 'tools', 'route-walk-preload.cjs')];
const lineCount = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0);
const dayToday = () => new Date().toISOString().slice(0, 10);

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-agent-tokens-'));
const single = path.join(base, 'single');
const onEnv = { ADMIN_PASSWORD: 'admin-password-1', AGENT_TOKENS: 'true' };
const offEnv = { ADMIN_PASSWORD: 'admin-password-1' };
let tokenA = null; // the first agent's token, looked for everywhere at the end
const allTokens = [];

try {
  // --- off by default ------------------------------------------------------------------------------------------------
  let server = await startServer(single, offEnv);
  let admin = await signIn(server, 'admin', 'admin-password-1');

  await test('without AGENT_TOKENS no agent can be made and the Agents switch stays off', async () => {
    const s = await call(server, 'GET', '/api/settings', { cookie: admin });
    ok(s, 'settings');
    assert.equal(s.json.settings.agentTokens, false);
    assert.equal(s.json.settings.agents, false);
    refused(await call(server, 'POST', '/api/users', { cookie: admin, body: { agent: true } }), 403, 'Agents are off on this server.', 'an agent');
    refused(await call(server, 'PATCH', '/api/settings', { cookie: admin, body: { agents: true } }), 403, 'Agents are off on this server.', 'the switch');
    assert.ok(!(await call(server, 'GET', '/api/users', { cookie: admin })).json.users.some((u) => u.agent), 'no agent');
  });
  await test('without AGENT_TOKENS a well-formed token is an unknown bearer value: 401 where a sign-in is needed, as before', async () => {
    const fake = `agt_${crypto.randomBytes(32).toString('base64url')}`;
    refused(await call(server, 'GET', '/api/me', { token: fake }), 401, 'sign in first', '/api/me');
    refused(await call(server, 'GET', '/api/agent/me', { token: fake }), 401, 'sign in first', '/api/agent/me');
    ok(await call(server, 'GET', '/api/branding', { token: fake }), 'branding answers as before');
  });
  await server.stop();

  // --- on: the account, the switch and the token ---------------------------------------------------------------------
  server = await startServer(single, { ...onEnv, ROUTE_WALK_OUT: WALK_OUT }, PRELOAD);
  admin = await signIn(server, 'admin', 'admin-password-1');
  const zip = testModuleZip(base);
  const installed = await call(server, 'POST', '/api/modules', { cookie: admin, raw: zip, headers: { 'content-type': 'application/zip' } });
  ok(installed, 'the test To-do installs', 201);
  ok(await call(server, 'PATCH', '/api/modules/todo', { cookie: admin, body: { enabled: true } }), 'the To-do is on');
  // A member to show the agent is not one of "everyone".
  const mia = (await call(server, 'POST', '/api/users', { cookie: admin, body: { login: 'mia', password: 'mia-password-1', role: 'member' } })).json.user;

  let agent = null;
  let S1 = null;
  let S2 = null;
  await test('with AGENT_TOKENS on, the owner\'s Agents switch is off until turned on', async () => {
    const s = await call(server, 'GET', '/api/settings', { cookie: admin });
    assert.equal(s.json.settings.agentTokens, true);
    assert.equal(s.json.settings.agents, false);
    refused(await call(server, 'POST', '/api/users', { cookie: admin, body: { agent: true } }), 403, null, 'an agent with the switch off');
    assert.match((await call(server, 'POST', '/api/users', { cookie: admin, body: { agent: true } })).json.error, /^Agents are off in this .+\. Turn on Agents in Manage first\.$/);
    refused(await call(server, 'PATCH', '/api/settings', { cookie: admin, body: { agents: 'yes' } }), 400, 'agents is true or false', 'not a boolean');
    const on = await call(server, 'PATCH', '/api/settings', { cookie: admin, body: { agents: true } });
    ok(on, 'the switch');
    assert.equal(on.json.settings.agents, true);
  });

  await test('an agent is a member with no sign-in, shown as an agent', async () => {
    refused(await call(server, 'POST', '/api/users', { cookie: admin, body: { agent: true, password: 'x-password-1' } }), 400, CANT_BE, 'with a password');
    refused(await call(server, 'POST', '/api/users', { cookie: admin, body: { agent: true, role: 'owner' } }), 400, CANT_BE, 'as an owner');
    refused(await call(server, 'POST', '/api/users', { cookie: admin, body: { agent: 'yes' } }), 400, 'agent must be true.', 'agent must be true');
    const made = await call(server, 'POST', '/api/users', { cookie: admin, body: { agent: true } });
    ok(made, 'an agent', 201);
    agent = made.json.user;
    assert.equal(agent.agent, true);
    assert.equal(agent.off, false);
    assert.equal(agent.role, 'member');
    assert.equal(agent.displayName, 'Claude', 'named Claude by default');
    assert.equal(agent.hasPassword, false);
    assert.equal(agent.link, null, 'no personal link');
    const named = await call(server, 'POST', '/api/users', { cookie: admin, body: { agent: true, displayName: 'Helper' } });
    ok(named, 'a named agent', 201);
    assert.equal(named.json.user.displayName, 'Helper');
    ok(await call(server, 'DELETE', `/api/users/${named.json.user.key}`, { cookie: admin }), 'deleted');
    S1 = (await call(server, 'POST', '/api/spaces', { cookie: admin, body: { name: 'Camp', members: [agent.key, mia.key] } })).json.space.id;
    S2 = (await call(server, 'POST', '/api/spaces', { cookie: admin, body: { name: 'Elsewhere', members: [mia.key] } })).json.space.id;
    assert.ok(S1 && S2);
  });

  await test('an agent with no picture shows the agent image, not initials; a set picture wins; a person keeps initials', async () => {
    const img = (key, q = '') => call(server, 'GET', `/img/${key}/profile${q}`, { cookie: admin });
    const bot = await img(agent.key);
    ok(bot, 'the agent picture');
    assert.match(bot.headers['content-type'], /^image\/svg\+xml/);
    assert.ok(bot.text.startsWith('<svg') && bot.text.includes('aria-label="Agent"'), 'the agent image');
    const person = await img(mia.key);
    ok(person, 'the initials');
    assert.ok(person.text.startsWith('<svg') && !person.text.includes('aria-label="Agent"'), 'a person keeps initials');
    assert.equal((await img(agent.key, '?fallback=none')).status, 404, 'fallback=none');
    assert.equal((await call(server, 'GET', `/img/${agent.key}/player`, { cookie: admin })).status, 404, 'other slots');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    ok(await call(server, 'PUT', `/api/users/${agent.key}/images/profile`, { cookie: admin, raw: png, headers: { 'content-type': 'image/png' } }), 'a picture for the agent');
    const own = await img(agent.key);
    assert.match(own.headers['content-type'], /^image\/png/, 'the set picture wins');
    ok(await call(server, 'DELETE', `/api/users/${agent.key}/images/profile`, { cookie: admin }), 'removed');
    assert.ok((await img(agent.key)).text.includes('aria-label="Agent"'), 'back to the agent image');
  });

  await test('an agent can\'t be made an owner, the admin or a moderator, or given a password, a link or two-step sign-in', async () => {
    refused(await call(server, 'PATCH', `/api/users/${agent.key}`, { cookie: admin, body: { role: 'owner' } }), 400, CANT_BE, 'owner');
    refused(await call(server, 'PATCH', `/api/users/${agent.key}`, { cookie: admin, body: { role: 'admin' } }), 400, CANT_BE, 'admin');
    refused(await call(server, 'PATCH', `/api/users/${agent.key}`, { cookie: admin, body: { password: 'agent-password-1' } }), 400, CANT_BE, 'a password');
    refused(await call(server, 'POST', `/api/users/${agent.key}/link`, { cookie: admin }), 400, CANT_BE, 'a personal link');
    refused(await call(server, 'PATCH', `/api/users/${agent.key}`, { cookie: admin, body: { login: 'admin2' } }), 400, CANT_BE, 'another login');
    refused(await call(server, 'PATCH', `/api/users/${agent.key}/spaces/${S1}`, { cookie: admin, body: { permissions: { moderator: true } } }), 400, CANT_BE, 'a moderator');
    const after = (await call(server, 'GET', `/api/users/${agent.key}`, { cookie: admin })).json.user;
    assert.deepEqual([after.role, after.hasPassword, after.link, after.spaces[S1].permissions.moderator], ['member', false, null, false]);
    ok(await call(server, 'PATCH', `/api/users/${agent.key}`, { cookie: admin, body: { displayName: 'Claude' } }), 'its name can change');
    refused(await call(server, 'PATCH', `/api/users/${mia.key}`, { cookie: admin, body: { off: true } }), 400, 'Only an agent can be turned off.', 'a person can\'t be turned off');
  });

  await test('no door signs an agent in', async () => {
    const login = (await call(server, 'GET', `/api/users/${agent.key}`, { cookie: admin })).json.user.login;
    refused(await call(server, 'POST', '/api/login', { body: { login, password: '' } }), 401, null, 'the sign-in, no password');
    refused(await call(server, 'POST', '/api/login', { body: { login, password: 'anything-at-all' } }), 401, null, 'the sign-in, a guess');
    const app = JSON.parse(fs.readFileSync(path.join(single, 'app.json'), 'utf8'));
    const stored = app.users.find((u) => u.key === agent.key);
    assert.deepEqual([stored.agent, stored.role, stored.passwordHash, stored.linkToken, stored.mfa], [true, 'member', null, null, null]);
  });

  let made = null;
  await test('a token is shown once, ends in 30 days, and is kept only as its SHA-256', async () => {
    made = await call(server, 'POST', `/api/users/${agent.key}/token`, { cookie: admin });
    ok(made, 'a token', 201);
    tokenA = made.json.token;
    allTokens.push(tokenA);
    assert.match(tokenA, TOKEN_RE);
    assert.equal(made.headers['cache-control'], 'no-store');
    const days = (Date.parse(made.json.expiresAt) - Date.now()) / 86400000;
    assert.ok(days > 29.9 && days <= 30, `30 days (${days})`);
    assert.equal(made.json.lifetime, '30d', 'no body is 30d');
    const view = await call(server, 'GET', `/api/users/${agent.key}/token`, { cookie: admin });
    ok(view, 'its view');
    assert.equal(view.json.token.lifetime, '30d');
    assert.deepEqual(Object.keys(view.json.token).sort(), ['createdAt', 'expiresAt', 'id', 'lastAddress', 'lastUsedAt', 'lifetime']);
    const file = JSON.parse(fs.readFileSync(path.join(single, 'tokens.json'), 'utf8'));
    assert.equal(file.tokens.length, 1);
    assert.equal(file.tokens[0].hash, sha256(tokenA));
    assert.equal(file.tokens[0].kind, 'agent');
    assert.equal(file.tokens[0].user, agent.key);
    assert.equal((fs.statSync(path.join(single, 'tokens.json')).mode & 0o777), 0o600, 'private');
  });

  // --- the gate --------------------------------------------------------------------------------------------------------
  const A = () => ({ token: tokenA });
  // Another agent in the first space, with its own token.
  const agentOf = async (name) => {
    const a = (await call(server, 'POST', '/api/users', { cookie: admin, body: { agent: true, displayName: name } })).json.user;
    const space = (await call(server, 'GET', `/api/spaces/${S1}`, { cookie: admin })).json.space;
    ok(await call(server, 'PATCH', `/api/spaces/${S1}`, { cookie: admin, body: { members: [...space.members, a.key] } }), `${name} joins`);
    const t = (await call(server, 'POST', `/api/users/${a.key}/token`, { cookie: admin })).json.token;
    allTokens.push(t);
    return { key: a.key, token: t };
  };
  // For the long walks, a pool of such agents, each used 55 times at most, so none reaches its 60 reads a minute.
  const pool = { token: null, used: 0, n: 0 };
  const P = async () => {
    if (!pool.token || pool.used >= 55) { pool.token = (await agentOf(`Pool ${pool.n += 1}`)).token; pool.used = 0; }
    pool.used += 1;
    return { token: pool.token };
  };
  let ownRequest = null;
  await test('the gate\'s list answers in the agent\'s space', async () => {
    const me = await call(server, 'GET', '/api/agent/me', A());
    ok(me, '/api/agent/me');
    assert.deepEqual(me.json.agent, { key: agent.key, name: 'Claude' });
    assert.deepEqual(me.json.spaces, [{ id: S1, name: 'Camp' }], 'only its own spaces, never the Lobby');
    assert.deepEqual([me.json.limits.reads.perMinute, me.json.limits.reads.perDay, me.json.limits.writes.perMinute, me.json.limits.writes.perDay], [60, 3000, 20, 300]);
    assert.ok(me.json.limits.reads.usedToday >= 1);
    assert.equal(me.json.expiresAt, made.json.expiresAt);
    // Set up's read is off the list: it answers a member "owners only" whatever it is asked.
    refused(await call(server, 'GET', `/api/spaces/${S1}`, A()), 403, CANT, 'Set up\'s read');
    const putTask = await call(server, 'PUT', `/api/modules/todo/data/task:t1?scope=space&space=${S1}`, { cookie: admin, body: { value: { id: 't1', title: 'Pack the tent', done: false } } });
    ok(putTask, 'the owner adds a task');
    ok(await call(server, 'GET', `/api/modules/todo/context?scope=space&space=${S1}`, A()), 'context');
    const list = await call(server, 'GET', `/api/modules/todo/data?scope=space&space=${S1}`, A());
    ok(list, 'data');
    assert.ok(list.json.items.some((i) => i.key === 'task:t1'));
    ok(await call(server, 'GET', `/api/modules/todo/data/task:t1?scope=space&space=${S1}`, A()), 'one key');
    ok(await call(server, 'GET', `/api/objects/search?from=todo&scope=space&space=${S1}`, A()), 'search');
    ok(await call(server, 'GET', '/api/objects/kinds?from=todo', A()), 'kinds');
    ok(await call(server, 'POST', '/api/objects/resolve', { ...A(), body: { from: 'todo', refs: [{ module: 'todo', kind: 'task', id: 't1', scope: 'space', space: S1 }] } }), 'resolve');
    ok(await call(server, 'GET', `/api/objects/links?from=todo&ref=${encodeURIComponent(JSON.stringify({ module: 'todo', kind: 'task', id: 't1', scope: 'space', space: S1 }))}&dir=from`, A()), 'links');
    const actions = await call(server, 'GET', `/api/spaces/${S1}/actions`, A());
    ok(actions, 'actions');
    const names = actions.json.actions.map((a) => a.action);
    assert.ok(names.includes('todo:createTask'), 'a write is listed');
    for (const no of ['todo:addTask', 'todo:wipeTasks', 'todo:quietTask', 'todo:myTask']) assert.ok(!names.includes(no), `${no} is not listed`);
    const asked = await call(server, 'POST', `/api/spaces/${S1}/action`, { ...A(), body: { action: 'todo:createTask', input: { title: 'Secret title 4417' } } });
    ok(asked, 'a write action');
    ownRequest = asked.json.id;
    ok(await call(server, 'GET', `/api/spaces/${S1}/action/${ownRequest}`, A()), 'its own request');
    // A trailing slash and another case read as the app's routes read them.
    ok(await call(server, 'GET', '/API/Agent/Me/', A()), 'the path as the router reads it');
  });

  await test('GET /api/spaces/:id/members tells an agent the people of its own space: key and name only', async () => {
    const counter = await agentOf('Counter');
    const space = (await call(server, 'GET', `/api/spaces/${S1}`, { cookie: admin })).json.space;
    const nameOf = async (key) => {
      const u = (await call(server, 'GET', `/api/users/${key}`, { cookie: admin })).json.user;
      return u.agent ? `${u.displayName} (agent)` : u.displayName;
    };
    const expected = [];
    for (const key of space.members) expected.push({ key, name: await nameOf(key) });
    const before = (await call(server, 'GET', '/api/agent/me', { token: counter.token })).json.limits;
    const got = await call(server, 'GET', `/api/spaces/${S1}/members`, { token: counter.token });
    ok(got, 'members');
    assert.deepEqual(Object.keys(got.json), ['members'], 'only members');
    assert.deepEqual(got.json.members, expected, 'the space\'s own order, key and name');
    for (const m of got.json.members) assert.deepEqual(Object.keys(m).sort(), ['key', 'name'], 'exactly key and name');
    assert.ok(got.json.members.some((m) => m.key === mia.key && m.name === 'mia'), 'a person by their name');
    assert.ok(got.json.members.some((m) => m.key === counter.key && m.name === 'Counter (agent)'), 'an agent as Name (agent)');
    const after = (await call(server, 'GET', '/api/agent/me', { token: counter.token })).json.limits;
    assert.equal(after.reads.usedToday, before.reads.usedToday + 2, 'one read for members, one for the second me');
    assert.equal(after.writes.usedToday, before.writes.usedToday);
    const lines = fs.readFileSync(path.join(single, 'agent-log', counter.key, `${dayToday()}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const line = lines.find((l) => l.route === '/api/spaces/:id/members');
    assert.ok(line, 'logged as its route');
    assert.deepEqual([line.method, line.kind, line.space, line.status], ['GET', 'read', S1, 200]);
    const raw = JSON.stringify(got.json);
    for (const leak of ['login', 'email', 'role', 'hash', 'token', 'link']) assert.ok(!raw.toLowerCase().includes(`"${leak}`), `no ${leak}`);
  });

  await test('members: another space, the Lobby and an unknown space are 404; a person is refused', async () => {
    for (const id of [S2, 'lobby', 'zzzz9999']) {
      const r = await call(server, 'GET', `/api/spaces/${id}/members`, await P());
      assert.equal(r.status, 404, `members of ${id}: ${r.status}`);
      assert.match(r.json.error, /^no such /);
    }
    refused(await call(server, 'GET', `/api/spaces/${S1}/members`, { cookie: admin }), 403, "This is for an agent's token only.", 'a person');
    refused(await call(server, 'POST', `/api/spaces/${S1}/members`, await P()), 403, CANT, 'POST is not on the list');
  });

  await test('local, asker-only, destructive and ai:false actions are refused', async () => {
    for (const action of ['todo:addTask', 'todo:wipeTasks', 'todo:quietTask', 'todo:myTask']) {
      refused(await call(server, 'POST', `/api/spaces/${S1}/action`, { ...A(), body: { action, input: { title: 'x', text: 'x' } } }), 403, CANT_ASK, action);
    }
  });

  await test('an action\'s pointer input outside the agent\'s spaces is 403', async () => {
    const t1 = { module: 'todo', kind: 'task', id: 't1', scope: 'space', space: S1 };
    for (const target of [
      { module: 'todo', kind: 'task', id: 'envsecret1', scope: 'environment' },
      { module: 'todo', kind: 'task', id: 't1', scope: 'space', space: S2 },
      { module: 'todo', kind: 'task', id: 't1', scope: 'person' },
      { module: 'todo', kind: 'task', id: 't1', scope: 'space', space: 'lobby' },
    ]) {
      refused(await call(server, 'POST', `/api/spaces/${S1}/action`, { ...(await P()), body: { action: 'todo:linkTask', input: { task: t1, target } } }), 403, CANT, `a target at ${target.scope} ${target.space || ''}`);
      refused(await call(server, 'POST', `/api/spaces/${S1}/action`, { ...(await P()), body: { action: 'todo:createTask', input: { title: 'x', ref: target } } }), 403, CANT, `a ref at ${target.scope} ${target.space || ''}`);
    }
    ok(await call(server, 'POST', `/api/spaces/${S1}/action`, { ...(await P()), body: { action: 'todo:createTask', input: { title: 'About t1', ref: t1 } } }), 'a pointer into its own space');
  });

  await test('a body that is not JSON is counted and logged by the gate, then answered 400', async () => {
    const one = await agentOf('Bad body');
    const before = (await call(server, 'GET', '/api/agent/me', { token: one.token })).json.limits;
    const bad = await call(server, 'POST', `/api/spaces/${S1}/action`, { token: one.token, raw: Buffer.from('{bad') });
    refused(bad, 400, 'bad JSON', 'a body that is not JSON');
    const elsewhere = await call(server, 'POST', '/api/users', { token: one.token, raw: Buffer.from('{bad') });
    refused(elsewhere, 400, 'bad JSON', 'off the list too');
    const after = (await call(server, 'GET', '/api/agent/me', { token: one.token })).json.limits;
    assert.equal(after.writes.usedToday, before.writes.usedToday + 1, 'counted as a write');
    assert.equal(after.reads.usedToday, before.reads.usedToday + 2, 'and the other as a read');
    const lines = fs.readFileSync(path.join(single, 'agent-log', one.key, `${dayToday()}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(lines.some((l) => l.status === 400 && l.route === '/api/spaces/:id/action'), 'logged');
    refused(await call(server, 'POST', '/api/users', { cookie: admin, raw: Buffer.from('{bad') }), 400, 'bad JSON', 'a person, as before');
  });

  await test('a space it is not in is the unknown space\'s 404; another scope is 403', async () => {
    const notFound = (r, what) => { assert.equal(r.status, 404, `${what}: ${r.status} ${r.text}`); assert.match(r.json.error, /^no such /); };
    for (const id of [S2, 'lobby', 'zzzz9999']) {
      notFound(await call(server, 'GET', `/api/spaces/${id}/actions`, await P()), `actions in ${id}`);
      notFound(await call(server, 'POST', `/api/spaces/${id}/action`, { ...(await P()), body: { action: 'todo:createTask', input: { title: 'x' } } }), `an action in ${id}`);
      notFound(await call(server, 'GET', `/api/modules/todo/data?scope=space&space=${id}`, await P()), `data in ${id}`);
    }
    notFound(await call(server, 'POST', '/api/objects/resolve', { ...(await P()), body: { from: 'todo', refs: [{ module: 'todo', kind: 'task', id: 't1', scope: 'space', space: S2 }] } }), 'resolve in another space');
    for (const q of ['scope=environment', 'scope=person', 'scope=spaces', '', `scope=environment&space=${S1}`, `scope=space&scope=environment&space=${S1}`]) {
      refused(await call(server, 'GET', `/api/modules/todo/data?${q}`, await P()), 403, CANT, `data ${q || '(no scope)'}`);
      refused(await call(server, 'GET', `/api/modules/todo/context?${q}`, await P()), 403, CANT, `context ${q || '(no scope)'}`);
      refused(await call(server, 'GET', `/api/objects/search?from=todo&${q}`, await P()), 403, CANT, `search ${q || '(no scope)'}`);
    }
    refused(await call(server, 'POST', '/api/objects/resolve', { ...(await P()), body: { from: 'todo', refs: [{ module: 'todo', kind: 'task', id: 't1', scope: 'environment' }] } }), 403, CANT, 'resolve at environment scope');
    refused(await call(server, 'GET', `/api/objects/links?from=todo&ref=${encodeURIComponent(JSON.stringify({ module: 'todo', kind: 'task', id: 't1', scope: 'environment' }))}`, await P()), 403, CANT, 'links at environment scope');
  });

  await test('raw data writes, Clear, restore and everything else off the list are 403', async () => {
    const d = `/api/modules/todo/data/task:t1?scope=space&space=${S1}`;
    refused(await call(server, 'PUT', d, { ...(await P()), body: { value: { id: 't1', title: 'Changed' } } }), 403, CANT, 'a raw write');
    refused(await call(server, 'DELETE', d, await P()), 403, CANT, 'a raw delete');
    refused(await call(server, 'DELETE', `/api/modules/todo/data?scope=space&space=${S1}`, await P()), 403, CANT, 'Clear');
    refused(await call(server, 'POST', `/api/modules/todo/data/restore?scope=space&space=${S1}`, { ...(await P()), body: {} }), 403, CANT, 'restore');
    for (const [method, url, body] of [
      ['GET', '/api/me'], ['GET', '/api/spaces'], ['GET', '/api/live'], ['DELETE', `/api/spaces/${S1}/chat`], ['GET', `/api/spaces/${S1}/chat/x`],
      ['GET', '/api/settings'], ['PATCH', `/api/users/${agent.key}`, { role: 'owner' }], ['POST', `/api/users/${agent.key}/token`],
      ['DELETE', `/api/users/${agent.key}/token`], ['GET', `/api/users/${agent.key}/agent-log`], ['POST', '/api/logout'], ['GET', '/'], ['GET', '/style.css'],
      ['POST', '/api/me/mfa/start'], ['PATCH', `/api/spaces/${S1}`, { name: 'x' }], ['POST', `/api/spaces/${S1}/join`], ['OPTIONS', '/api/agent/me'],
      ['GET', `/api/modules/todo/data/task:t1/x?scope=space&space=${S1}`], ['POST', `/api/spaces/${S1}/command`, { name: 'todo', text: 'x' }],
    ]) {
      refused(await call(server, method, url, { ...(await P()), body }), 403, CANT, `${method} ${url}`);
    }
  });

  await test('every route and mount in the app\'s router stack answers an agent 403, except the gate\'s list', async () => {
    const layers = JSON.parse(fs.readFileSync(WALK_OUT, 'utf8'));
    assert.deepEqual(layers.filter((l) => l.kind === 'unknown'), [], 'every layer of the stack can be read');
    const gate = layers.findIndex((l) => l.kind === 'use' && l.name === 'agentGate');
    assert.ok(gate > 0, 'the gate is in the stack');
    const ahead = layers.slice(0, gate).filter((l) => l.kind === 'route').map((l) => `${l.method} ${l.path}`);
    assert.deepEqual(ahead.filter((r) => !PUBLIC_BEFORE_ENVIRONMENTS.has(r)), [], 'no route ahead of the gate but the known one');
    const routes = layers.slice(gate).filter((l) => l.kind === 'route');
    const mounts = layers.slice(gate).filter((l) => l.kind === 'use' && l.path !== '/');
    assert.ok(routes.length > 300, `the walk found the routes (${routes.length})`);
    const seen = new Set(layers.filter((l) => l.kind === 'route').map((l) => `${l.method} ${l.path}`));
    assert.deepEqual(writtenRoutes().map(([m, p]) => `${m} ${p}`).filter((r) => !seen.has(r)), [], 'the walk has every route written in server/*.js');
    for (const r of GATE_LIST) assert.ok(seen.has(r), `${r} is a route of the app`);
    const urlOf = (pattern) => pattern.replace(/[{}]/g, '').replace(/\*[A-Za-z]+/g, 'a/b').replace(/:([A-Za-z]+)/g, 'x1234');
    let walked = 0;
    for (const { method, path: pattern } of routes) {
      if (GATE_LIST.has(`${method} ${pattern}`)) continue;
      const verb = method === '_all' ? 'GET' : method;
      const r = await call(server, verb, urlOf(pattern), { ...(await P()), body: ['POST', 'PUT', 'PATCH'].includes(verb) ? {} : undefined });
      assert.equal(r.status, 403, `${method} ${pattern} answered ${r.status} ${r.text.slice(0, 200)}`);
      assert.equal(r.json?.error, CANT, `${method} ${pattern}: the sentence`);
      walked += 1;
    }
    for (const { name, path: at } of mounts) {
      const r = await call(server, 'GET', `${urlOf(at)}/x.js`, await P());
      assert.equal(r.status, 403, `${name} at ${at} answered ${r.status} ${r.text.slice(0, 200)}`);
      walked += 1;
    }
    assert.ok(walked > 300 && mounts.length > 5, `walked ${walked}, ${mounts.length} of them mounts`);
    // The log's route words come from the registered routes' own paths: a router mounted with a prefix would hide its prefix
    // from them, so none may be, and no word that is kept may be anything but plain.
    assert.deepEqual(layers.filter((l) => l.kind === 'route' && !['', '/'].includes(l.mount)).map((l) => `${l.method} ${l.path}`), [], 'a router mounted with a path prefix (the log\'s route words cannot see it)');
    const trie = routeTrie(layers.filter((l) => l.kind === 'route').map((l) => l.path));
    const wordsOf = (node) => [...node.words].flatMap(([w, child]) => [w, ...wordsOf(child)]).concat(node.any ? wordsOf(node.any) : []);
    const words = wordsOf(trie);
    assert.ok(words.length > 100 && words.includes('api') && words.includes('agent-log'), 'the trie has the routes\' words');
    assert.deepEqual(words.filter((w) => !/^[a-z0-9._-]+$/.test(w)), [], 'a word outside [a-z0-9._-]');
    assert.equal(refusedRoute('/api/users/abc/agent-log?x=1', trie), '/api/users/:x/agent-log');
  });

  await test('it reads only its own requests', async () => {
    const owners = await call(server, 'POST', `/api/spaces/${S1}/action`, { cookie: admin, body: { action: 'todo:createTask', input: { title: 'Owner task' } } });
    ok(owners, 'the owner asks');
    refused(await call(server, 'GET', `/api/spaces/${S1}/action/${owners.json.id}`, A()), 404, 'no such request', 'another\'s request');
  });

  await test('a cookie session sent with the token: the token wins and the gate applies', async () => {
    refused(await call(server, 'GET', '/api/settings', { ...A(), cookie: admin }), 403, CANT, 'the owner\'s cookie does not help');
    const me = await call(server, 'GET', '/api/agent/me', { ...A(), cookie: admin });
    ok(me, 'still the agent');
    assert.equal(me.json.agent.key, agent.key);
  });

  await test('a token is read only from the Authorization header', async () => {
    refused(await call(server, 'GET', `/api/agent/me?token=${tokenA}`), 401, 'sign in first', 'a query string');
    refused(await call(server, 'GET', '/api/agent/me', { cookie: `app_session=${tokenA}` }), 401, 'sign in first', 'a cookie');
    refused(await call(server, 'GET', '/api/agent/me', { cookie: admin }), 403, "This is for an agent's token only.", 'a person');
  });

  await test('an unknown, revoked, replaced, turned-off or Agents-off token is 401 with the same sentence', async () => {
    const fake = `agt_${crypto.randomBytes(32).toString('base64url')}`;
    for (const t of [fake, 'agt_short', `${tokenA}x`, tokenA.slice(0, -1)]) refused(await call(server, 'GET', '/api/agent/me', { token: t }), 401, INVALID, 'unknown');
    const fresh = await call(server, 'POST', `/api/users/${agent.key}/token`, { cookie: admin });
    ok(fresh, 'a new token', 201);
    allTokens.push(fresh.json.token);
    refused(await call(server, 'GET', '/api/agent/me', A()), 401, INVALID, 'the old one ended');
    tokenA = fresh.json.token;
    ok(await call(server, 'GET', '/api/agent/me', A()), 'the new one');
    ok(await call(server, 'PATCH', `/api/users/${agent.key}`, { cookie: admin, body: { off: true } }), 'turned off');
    refused(await call(server, 'GET', '/api/agent/me', A()), 401, INVALID, 'turned off');
    refused(await call(server, 'POST', `/api/users/${agent.key}/token`, { cookie: admin }), 409, 'This agent is turned off. Turn it on first.', 'a token for one turned off');
    ok(await call(server, 'PATCH', `/api/users/${agent.key}`, { cookie: admin, body: { off: false } }), 'on again');
    ok(await call(server, 'GET', '/api/agent/me', A()), 'on again');
    ok(await call(server, 'PATCH', '/api/settings', { cookie: admin, body: { agents: false } }), 'Agents off');
    refused(await call(server, 'GET', '/api/agent/me', A()), 401, INVALID, 'Agents off');
    refused(await call(server, 'POST', `/api/users/${agent.key}/token`, { cookie: admin }), 403, null, 'no token while Agents is off');
    ok(await call(server, 'PATCH', '/api/settings', { cookie: admin, body: { agents: true } }), 'Agents on');
    ok(await call(server, 'GET', '/api/agent/me', A()), 'Agents on');
    const revoked = await call(server, 'DELETE', `/api/users/${agent.key}/token`, { cookie: admin });
    ok(revoked, 'revoke');
    assert.equal(revoked.json.revoked, true);
    refused(await call(server, 'GET', '/api/agent/me', A()), 401, INVALID, 'revoked');
    assert.equal((await call(server, 'GET', `/api/users/${agent.key}/token`, { cookie: admin })).json.token, null);
    const again = await call(server, 'POST', `/api/users/${agent.key}/token`, { cookie: admin });
    ok(again, 'another', 201);
    allTokens.push(again.json.token);
    tokenA = again.json.token;
    const seen = (await call(server, 'GET', `/api/users/${agent.key}/token`, { cookie: admin })).json.token;
    assert.ok(seen.lastUsedAt === null, 'not used yet');
    ok(await call(server, 'GET', '/api/agent/me', A()), 'used');
    assert.ok((await call(server, 'GET', `/api/users/${agent.key}/token`, { cookie: admin })).json.token.lastUsedAt, 'its last use is shown');
  });

  let neverAgent = null;
  let neverToken = null;
  await test('the owner chooses how long a token lasts: 30d, 60d, 90d, 1y or never', async () => {
    const one = await agentOf('Lifetimes');
    const path_ = `/api/users/${one.key}/token`;
    const sentence = 'expires is one of: 30d, 60d, 90d, 1y, never.';
    const keys = (r) => Object.keys(r.json).sort();
    const aheadDays = (r) => (Date.parse(r.json.expiresAt) - Date.now()) / 86400000;
    const near = (d, want) => assert.ok(Math.abs(d - want) < 0.01, `${want} days (${d})`);
    const plain = await call(server, 'POST', path_, { cookie: admin });
    ok(plain, 'no body', 201);
    allTokens.push(plain.json.token);
    assert.deepEqual([plain.json.lifetime, keys(plain)], ['30d', ['expiresAt', 'lifetime', 'token']]);
    near(aheadDays(plain), 30);
    let lastGood = null;
    const empty = await call(server, 'POST', path_, { cookie: admin, body: {} });
    ok(empty, 'an empty body', 201);
    allTokens.push(empty.json.token);
    assert.equal(empty.json.lifetime, '30d');
    for (const [word, days] of [['30d', 30], ['60d', 60], ['90d', 90], ['1y', 365]]) {
      const r = await call(server, 'POST', path_, { cookie: admin, body: { expires: word } });
      ok(r, word, 201);
      allTokens.push(r.json.token);
      lastGood = r.json.token;
      assert.equal(r.json.lifetime, word);
      near(aheadDays(r), days);
      const view = (await call(server, 'GET', path_, { cookie: admin })).json.token;
      assert.deepEqual([view.lifetime, view.expiresAt], [word, r.json.expiresAt]);
      ok(await call(server, 'GET', '/api/agent/me', { token: r.json.token }), `${word} works`);
      const me = await call(server, 'GET', '/api/agent/me', { token: r.json.token });
      assert.equal(me.json.expiresAt, r.json.expiresAt);
    }
    for (const bad of ['7d', '30D', '', 'forever', 30, null, true, ['30d'], {}]) {
      refused(await call(server, 'POST', path_, { cookie: admin, body: { expires: bad } }), 400, sentence, `expires ${JSON.stringify(bad)}`);
    }
    refused(await call(server, 'POST', path_, { cookie: admin, body: { expires: '30d', extra: 1 } }), 400, 'Only expires can be sent.', 'another key');
    refused(await call(server, 'POST', path_, { cookie: admin, body: { days: 30 } }), 400, 'Only expires can be sent.', 'another key alone');
    refused(await call(server, 'POST', path_, { cookie: admin, body: ['30d'] }), 400, 'Send only expires, like { "expires": "90d" }.', 'an array');
    refused(await call(server, 'POST', path_, { cookie: admin, raw: Buffer.from('"90d"') }), 400, null, 'a string');
    ok(await call(server, 'GET', '/api/agent/me', { token: lastGood }), 'the refusals ended nothing');
    const never = await call(server, 'POST', path_, { cookie: admin, body: { expires: 'never' } });
    ok(never, 'never', 201);
    allTokens.push(never.json.token);
    assert.deepEqual([never.json.lifetime, never.json.expiresAt, keys(never)], ['never', null, ['expiresAt', 'lifetime', 'token']]);
    assert.ok(!never.text.includes(sha256(never.json.token)), 'no hash in the answer');
    refused(await call(server, 'GET', '/api/agent/me', { token: lastGood }), 401, INVALID, 'a new token ends the old');
    const me = await call(server, 'GET', '/api/agent/me', { token: never.json.token });
    ok(me, 'a never token works');
    assert.equal(me.json.expiresAt, null);
    const view = await call(server, 'GET', path_, { cookie: admin });
    assert.deepEqual([view.json.token.lifetime, view.json.token.expiresAt], ['never', null]);
    assert.ok(!view.text.includes(sha256(never.json.token)) && !view.text.includes('hash'), 'no hash in the view');
    const stored = JSON.parse(fs.readFileSync(path.join(single, 'tokens.json'), 'utf8')).tokens.find((t) => t.user === one.key);
    assert.deepEqual([stored.lifetime, stored.expiresAt, stored.hash], ['never', null, sha256(never.json.token)]);
    // Revoke ends it at once; Agents off and turned off end its use as for any token.
    const second = await call(server, 'POST', path_, { cookie: admin, body: { expires: 'never' } });
    ok(second, 'never again', 201);
    allTokens.push(second.json.token);
    ok(await call(server, 'DELETE', path_, { cookie: admin }), 'revoke');
    refused(await call(server, 'GET', '/api/agent/me', { token: second.json.token }), 401, INVALID, 'a revoked never token');
    const third = await call(server, 'POST', path_, { cookie: admin, body: { expires: 'never' } });
    allTokens.push(third.json.token);
    ok(await call(server, 'PATCH', `/api/users/${one.key}`, { cookie: admin, body: { off: true } }), 'turned off');
    refused(await call(server, 'GET', '/api/agent/me', { token: third.json.token }), 401, INVALID, 'a never token of an agent turned off');
    ok(await call(server, 'PATCH', `/api/users/${one.key}`, { cookie: admin, body: { off: false } }), 'on again');
    ok(await call(server, 'GET', '/api/agent/me', { token: third.json.token }), 'works again');
    // Kept for after a restart, made years old below: a never token has no end.
    neverAgent = one.key;
    neverToken = third.json.token;
    // Only an owner or the admin makes one: the agent's own token may not.
    refused(await call(server, 'POST', path_, { token: neverToken, body: { expires: 'never' } }), 403, CANT, 'an agent making a token');
    refused(await call(server, 'POST', path_, { body: { expires: 'never' } }), 401, null, 'nobody');
  });

  await test('the log: one line a call, a route pattern, no token and no content', async () => {
    const log = await call(server, 'GET', `/api/users/${agent.key}/agent-log`, { cookie: admin });
    ok(log, 'the log');
    const entries = log.json.entries;
    assert.ok(entries.length > 20);
    assert.ok(Date.parse(entries[0].at) >= Date.parse(entries[entries.length - 1].at), 'newest first');
    // Every line, page by page, newest first.
    const every = [...entries];
    for (let more = log.json.more; more;) {
      const page = await call(server, 'GET', `/api/users/${agent.key}/agent-log?before=${encodeURIComponent(every[every.length - 1].at)}`, { cookie: admin });
      ok(page, 'an older page');
      every.push(...page.json.entries);
      more = page.json.more && page.json.entries.length > 0;
    }
    const action = every.find((e) => e.route === '/api/spaces/:id/action' && e.status === 200);
    assert.ok(action, 'the action is there');
    assert.deepEqual([action.method, action.space, action.action, action.kind, typeof action.request], ['POST', S1, 'todo:createTask', 'write', 'number']);
    assert.ok(entries.some((e) => e.status === 403 && e.kind !== null && !(e.route === '(refused)') && /^\/[a-z:/-]*$/.test(e.route)), 'a refused call is there, as a route shape without its path\'s values');
    assert.ok(every.every((e) => e.route !== '(refused)'), 'no line reads "(refused)"');
    assert.ok(entries.every((e) => !('agent' in e)));
    refused(await call(server, 'GET', `/api/users/${agent.key}/agent-log?before=soon`, { cookie: admin }), 400, 'before is a time, like 2026-11-16T10:00:00Z.', 'a bad before');
    const older = await call(server, 'GET', `/api/users/${agent.key}/agent-log?before=${encodeURIComponent(entries[entries.length - 1].at)}`, { cookie: admin });
    ok(older, 'older');
    assert.ok(older.json.entries.every((e) => Date.parse(e.at) < Date.parse(entries[entries.length - 1].at)));
    refused(await call(server, 'GET', `/api/users/${mia.key}/agent-log`, { cookie: admin }), 400, 'That account is not an agent.', 'a person has no log');
    const text = filesUnder(path.join(single, 'agent-log')).map(([, b]) => b.toString('utf8')).join('');
    for (const t of allTokens) assert.ok(!text.includes(t), 'no token in the log');
    assert.ok(!text.includes('Secret title 4417'), 'no request body in the log');
    assert.ok(!text.includes('task:t1'), 'no path value in the log');
    assert.ok(!text.includes(tokenA.slice(4, 20)), 'not even part of the token');
  });

  await test('the log: a line names its module (an installed, safe id) and a refused call its route shape, never a value', async () => {
    const f = await agentOf('Fielder');
    const T = { token: f.token };
    const file = path.join(single, 'agent-log', f.key, `${dayToday()}.jsonl`);
    const lines = () => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
    // The line is written when the answer finishes: wait for each call's own line (one more than the last time).
    let seen = 0;
    const last = async () => {
      for (let i = 0; i < 100 && lines().length <= seen; i += 1) await new Promise((r) => setTimeout(r, 20));
      assert.ok(lines().length > seen, 'the call left a line');
      seen = lines().length;
      return lines()[seen - 1];
    };
    // `change`: a set-up agent's change (plan-admin-agent.md); null on every ordinary agent's line.
    const fields = ['at', 'token', 'method', 'route', 'space', 'module', 'action', 'request', 'message', 'status', 'address', 'kind', 'change', 'agent'].sort();
    ok(await call(server, 'GET', `/api/modules/todo/data?scope=space&space=${S1}`, T), 'data read');
    { const l = await last();
      assert.deepEqual(Object.keys(l).sort(), fields, 'the line\'s fields');
      assert.deepEqual([l.route, l.module, l.kind, l.change], ['/api/modules/:id/data', 'todo', 'read', null]); }
    ok(await call(server, 'GET', `/api/modules/todo/data/task:t1?scope=space&space=${S1}`, T), 'data read of a key');
    assert.equal((await last()).module, 'todo');
    ok(await call(server, 'GET', `/api/modules/todo/context?scope=space&space=${S1}`, T), 'context');
    { const l = await last();
      assert.deepEqual([l.route, l.module], ['/api/modules/:id/context', 'todo']); }
    ok(await call(server, 'POST', `/api/spaces/${S1}/action`, { ...T, body: { action: 'todo:createTask', input: { title: 'Field check' } } }), 'action');
    { const l = await last();
      assert.deepEqual([l.route, l.module, l.action, l.kind], ['/api/spaces/:id/action', 'todo', 'todo:createTask', 'write']); }
    // A write to the raw data is not on the gate's list: refused, so no module.
    refused(await call(server, 'PUT', `/api/modules/todo/data/task:t1?scope=space&space=${S1}`, { ...T, body: { value: { id: 't1' } } }), 403, CANT, 'a raw data write');
    { const l = await last();
      assert.deepEqual([l.route, l.module, l.kind], ['/api/modules/:id/data/:key', 'todo', 'read']); }
    refused(await call(server, 'DELETE', `/api/modules/todo/data/task:t1?scope=space&space=${S1}`, T), 403, CANT, 'the wrong method on a listed path');
    { const l = await last();
      assert.deepEqual([l.route, l.module, l.kind, l.status], ['/api/modules/:id/data/:key', 'todo', 'read', 403], 'the gate\'s pattern, not a shape'); }
    ok(await call(server, 'GET', '/api/agent/me', T), 'me');
    assert.equal((await last()).module, null);
    ok(await call(server, 'GET', `/api/spaces/${S1}/actions`, T), 'actions');
    assert.equal((await last()).module, null);
    // A module-looking id that is not an installed module's, or not a safe id at all: asked, answered, never logged.
    const hostile = ['../x', 'a'.repeat(300), '__proto__', 'constructor', 'toString', 'Todo', 'no-such-module', '%2e%2e%2fx'];
    for (const id of hostile) {
      await call(server, 'GET', `/api/modules/${id}/data?scope=space&space=${S1}`, T);
      assert.equal((await last()).module, null, `module for ${id.slice(0, 20)}`);
    }
    await call(server, 'POST', `/api/spaces/${S1}/action`, { ...T, body: { action: '__proto__:x', input: {} } });
    assert.equal((await last()).module, null, 'module for a __proto__ action');
    await call(server, 'POST', `/api/spaces/${S1}/action`, { ...T, body: { action: `${'a'.repeat(300)}:x`, input: {} } });
    assert.equal((await last()).module, null, 'module for a 300-character action');
    assert.ok(lines().every((l) => l.module === null || l.module === 'todo'), 'only todo, an installed module, is ever logged');
    // A refused call to a route that is not on the list: its shape, no values, no query, no token.
    const secret = `${f.token}`;
    const pathy = [
      [`/api/settings?x=${secret}`, '/api/settings'],
      [`/api/users/${f.key}/agent-log?before=${secret}`, '/api/users/:x/agent-log'],
      [`/api/users/${secret}/token`, '/api/users/:x/token'],
      [`/api/spaces/${S1}/Secret-Name-4417?token=${secret}&q=hello`, null],
      ['/API/Modules/Todo/Data/Extra/More', null],
      // Only words of registered routes, in an order no registered route has: not kept word for word.
      // The router does not match an empty segment, so this is not the gate's route: its shape, and no module.
      [`/api//modules/todo/data?scope=space&space=${S1}`, '/api/modules/:x/data'],
      ['/data/modules/api', '/:x/:x/:x'],
      ['/api/data/context/settings', null],
      ['/settings/api/modules', null],
      [`/${'seg/'.repeat(60)}`, null],
    ];
    for (const [url, want] of pathy) {
      const r = await call(server, 'GET', url, T);
      assert.equal(r.status, 403, `${url.slice(0, 40)} is refused`);
      const l = await last();
      assert.equal(l.status, 403, `${url.slice(0, 40)} logged ${l.status} ${l.route}`);
      assert.ok(typeof l.route === 'string' && l.route.length <= 80 && /^\/[a-z:/-]*$/.test(l.route), `route shape ${l.route}`);
      if (want !== null) assert.equal(l.route, want, `the route of ${url.slice(0, 40)}`);
      assert.equal(l.module, null);
    }
    // The shape of a path of allowed words in the wrong places holds nothing in the wrong place.
    for (const url of ['/data/modules/api', '/api/data/context/settings']) {
      await call(server, 'GET', url, T);
      const l = await last();
      assert.ok(!/\/data\/modules\/api|\/api\/data\/context|context\/settings/.test(l.route), `the words of ${url} stayed in order: ${l.route}`);
    }
    const text = fs.readFileSync(file, 'utf8');
    for (const bad of [secret, secret.slice(4, 20), 'Secret-Name-4417', 'hello', '..', 'proto', 'Field check']) assert.ok(!text.includes(bad), `the log holds "${bad.slice(0, 12)}"`);
    assert.ok(!/aaaaaaaaaa/.test(text), 'a 300-character id is in the log');
    assert.ok(!text.includes('(refused)'));
  });

  await test('a 401 note, a 429 note and a refused line on a listed path all write the gate\'s pattern and the module', async () => {
    const off = await agentOf('Turned off');
    ok(await call(server, 'PATCH', `/api/users/${off.key}`, { cookie: admin, body: { off: true } }), 'turned off');
    refused(await call(server, 'DELETE', `/api/modules/todo/data/task:t1?scope=space&space=${S1}`, { token: off.token }), 401, INVALID, 'turned off, a listed path');
    const over = await agentOf('Over the limit');
    for (let i = 0; i < 60; i += 1) ok(await call(server, 'GET', '/api/objects/kinds?from=todo', { token: over.token }), `read ${i + 1}`);
    refused(await call(server, 'GET', `/api/modules/todo/data?scope=space&space=${S1}`, { token: over.token }), 429, OVER, 'over the limit, a listed path');
    const noteOf = async (key, status) => {
      const file = path.join(single, 'agent-log', key, `${dayToday()}.jsonl`);
      for (let i = 0; i < 100; i += 1) {
        const found = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((l) => l.status === status) : null;
        if (found) return found;
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.fail(`no ${status} note`);
    };
    const n401 = await noteOf(off.key, 401);
    const n429 = await noteOf(over.key, 429);
    assert.deepEqual([n401.route, n401.module, n401.kind], ['/api/modules/:id/data/:key', 'todo', null], 'the 401 note');
    assert.deepEqual([n429.route, n429.module, n429.kind], ['/api/modules/:id/data', 'todo', null], 'the 429 note');
  });

  // --- the limits --------------------------------------------------------------------------------------------------------
  const reader = await agentOf('Reader');
  const writer = await agentOf('Writer');
  const daily = await agentOf('Daily');
  await test('60 reads a minute, then 429 with Retry-After', async () => {
    for (let i = 0; i < 60; i += 1) ok(await call(server, 'GET', '/api/objects/kinds?from=todo', { token: reader.token }), `read ${i + 1}`);
    const over = await call(server, 'GET', '/api/agent/me', { token: reader.token });
    refused(over, 429, OVER, 'the 61st read');
    const wait = Number(over.headers['retry-after']);
    assert.ok(wait >= 1 && wait <= 60, `Retry-After ${over.headers['retry-after']}`);
    refused(await call(server, 'GET', '/api/settings', { token: reader.token }), 429, OVER, 'a refused route counts as a read too');
  });
  await test('200 calls answered 429 add at most two lines to the log', async () => {
    const file = path.join(single, 'agent-log', reader.key, `${dayToday()}.jsonl`);
    const before = lineCount(file);
    const answered = await Promise.all(Array.from({ length: 200 }, () => call(server, 'GET', '/api/agent/me', { token: reader.token })));
    assert.ok(answered.every((r) => r.status === 429));
    const grew = lineCount(file) - before;
    assert.ok(grew <= 2, `the log grew by ${grew} lines`);
    const notes = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.status === 429);
    assert.ok(notes.length >= 1 && notes.every((l) => l.kind === null), 'the first of the minute is noted, counting against nothing');
  });
  const tokensFile = path.join(single, 'tokens.json');
  const stamp = () => { const st = fs.statSync(tokensFile); return `${st.ino}:${st.mtimeMs}`; };
  await test('calls over the limit from many addresses write nothing to tokens.json', async () => {
    const before = stamp();
    const answered = await Promise.all(Array.from({ length: 200 }, (_, i) => call(server, 'GET', '/api/agent/me', { token: reader.token, headers: { 'x-forwarded-for': `198.51.100.${i % 250}` } })));
    assert.ok(answered.every((r) => r.status === 429));
    assert.equal(stamp(), before, 'tokens.json untouched');
  });
  await test('uses from many addresses rewrite tokens.json at most once a minute; an address is an IP address or nothing', async () => {
    const one = await agentOf('Roamer');
    let last = stamp();
    let writes = 0;
    for (let i = 0; i < 40; i += 1) {
      ok(await call(server, 'GET', '/api/objects/kinds?from=todo', { token: one.token, headers: { 'x-forwarded-for': `203.0.113.${i + 1}` } }), `use ${i + 1}`);
      const now = stamp();
      if (now !== last) { writes += 1; last = now; }
    }
    assert.ok(writes <= 1, `tokens.json was written ${writes} times`);
    const shown = (await call(server, 'GET', `/api/users/${one.key}/token`, { cookie: admin })).json.token;
    assert.equal(shown.lastAddress, '203.0.113.40', 'the newest address is shown at once');
    ok(await call(server, 'GET', '/api/agent/me', { token: one.token, headers: { 'x-forwarded-for': '<img src=x onerror=alert(1)> "q"' } }), 'a use from no address');
    assert.equal((await call(server, 'GET', `/api/users/${one.key}/token`, { cookie: admin })).json.token.lastAddress, null, 'not an IP address: none kept');
    const entries = (await call(server, 'GET', `/api/users/${one.key}/agent-log`, { cookie: admin })).json.entries;
    assert.ok(entries.length >= 41 && entries.every((e) => e.address === null || net.isIP(e.address)), 'the log keeps only IP addresses');
    assert.equal(entries[0].address, null, 'the free text is not kept');
    assert.ok(!fs.readFileSync(tokensFile, 'utf8').includes('<img'), 'nor in tokens.json');
    for (const [, b] of filesUnder(path.join(single, 'agent-log'))) assert.ok(!b.toString('utf8').includes('<img'), 'nor in the log');
  });
  await test('20 writes a minute, counted apart from reads', async () => {
    for (let i = 0; i < 20; i += 1) ok(await call(server, 'POST', `/api/spaces/${S1}/action`, { token: writer.token, body: { action: 'todo:createTask', input: { title: `Write ${i}` } } }), `write ${i + 1}`);
    const over = await call(server, 'POST', `/api/spaces/${S1}/action`, { token: writer.token, body: { action: 'todo:createTask', input: { title: 'One too many' } } });
    refused(over, 429, OVER, 'the 21st write');
    assert.ok(Number(over.headers['retry-after']) >= 1);
    const me = await call(server, 'GET', '/api/agent/me', { token: writer.token });
    ok(me, 'a read still goes');
    assert.equal(me.json.limits.writes.usedToday, 20);
  });

  // --- a restart: the day's counts, an expired token ---------------------------------------------------------------------
  const usedBefore = (await call(server, 'GET', '/api/agent/me', { token: daily.token })).json.limits;
  await server.stop();
  {
    const today = new Date().toISOString();
    const line = (kind) => `${JSON.stringify({ at: today, agent: daily.key, token: 'x', method: 'GET', route: '/api/agent/me', space: null, action: null, request: null, message: null, status: 200, address: '127.0.0.1', kind })}\n`;
    fs.appendFileSync(path.join(single, 'agent-log', daily.key, `${dayToday()}.jsonl`), line('read').repeat(3000 - usedBefore.reads.usedToday) + line('write').repeat(300));
  }
  server = await startServer(single, onEnv);
  admin = await signIn(server, 'admin', 'admin-password-1');
  await test('the day\'s counts survive a restart: read back from the log', async () => {
    const over = await call(server, 'GET', '/api/agent/me', { token: daily.token });
    refused(over, 429, OVER, 'the day\'s reads are spent');
    assert.ok(Number(over.headers['retry-after']) > 0 && Number(over.headers['retry-after']) <= 86400);
    refused(await call(server, 'POST', `/api/spaces/${S1}/action`, { token: daily.token, body: { action: 'todo:createTask', input: { title: 'x' } } }), 429, OVER, 'the day\'s writes are spent');
    const writerNow = await call(server, 'GET', '/api/agent/me', { token: writer.token });
    ok(writerNow, 'the writer reads again after a restart (the minute is memory only)');
    assert.equal(writerNow.json.limits.writes.usedToday, 20, 'its writes today were read back');
  });
  await server.stop();
  {
    const file = path.join(single, 'tokens.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const mine = data.tokens.find((t) => t.user === agent.key);
    mine.expiresAt = new Date(Date.parse(mine.createdAt) + 1).toISOString(); // made, and ended a millisecond later
    // A record that says it lives longer than 30 days was not written here.
    const long = data.tokens.find((t) => t.user === daily.key);
    long.createdAt = new Date().toISOString();
    long.expiresAt = new Date(Date.now() + 31 * 86400000).toISOString();
    // A never token made two years ago.
    const old = data.tokens.find((t) => t.user === neverAgent);
    old.createdAt = new Date(Date.now() - 730 * 86400000).toISOString();
    assert.equal(old.expiresAt, null);
    fs.writeFileSync(file, JSON.stringify(data));
  }
  server = await startServer(single, onEnv);
  await test('a token past its end is 401, and noted at most once a minute in its agent\'s log', async () => {
    const file = path.join(single, 'agent-log', agent.key, `${dayToday()}.jsonl`);
    const before = lineCount(file);
    for (let i = 0; i < 30; i += 1) refused(await call(server, 'GET', '/api/agent/me', A()), 401, INVALID, 'expired');
    assert.equal(lineCount(file) - before, 1, 'one line for 30 refusals');
    const note = JSON.parse(fs.readFileSync(file, 'utf8').trim().split('\n').pop());
    assert.deepEqual([note.status, note.kind, note.route], [401, null, '/api/agent/me']);
  });
  await test('a never token made two years ago still works, and answers expiresAt null', async () => {
    const me = await call(server, 'GET', '/api/agent/me', { token: neverToken });
    ok(me, 'two years on');
    assert.equal(me.json.expiresAt, null);
    const view = (await call(server, 'GET', `/api/users/${neverAgent}/token`, { cookie: await signIn(server, 'admin', 'admin-password-1') })).json.token;
    assert.deepEqual([view.lifetime, view.expiresAt], ['never', null]);
  });
  await test('a tokens.json record that lives more than 30 days is not read', async () => {
    refused(await call(server, 'GET', '/api/agent/me', { token: daily.token }), 401, INVALID, 'a 31-day record');
    ok(await call(server, 'GET', '/api/agent/me', { token: writer.token }), 'another agent\'s live token');
  });
  await server.stop();

  await test('a server whose ADMIN_LOGIN is an agent\'s login starts, and makes no admin of it', async () => {
    const login = `agent-${writer.key}`;
    const odd = await startServer(single, { ...onEnv, ADMIN_LOGIN: login, ADMIN_PASSWORD: 'other-password-1' });
    assert.match(odd.out, new RegExp(`"${login}" is an agent's login here, so ADMIN_LOGIN cannot make it the server's admin\\.`));
    refused(await call(odd, 'POST', '/api/login', { body: { login, password: 'other-password-1' } }), 401, null, 'no sign-in as it');
    ok(await call(odd, 'GET', '/api/agent/me', { token: writer.token }), 'still an agent');
    await odd.stop();
  });

  // --- off again: nothing reads a token ----------------------------------------------------------------------------------
  server = await startServer(single, offEnv);
  admin = await signIn(server, 'admin', 'admin-password-1');
  await test('with AGENT_TOKENS off again, a live token is read as nobody', async () => {
    refused(await call(server, 'GET', '/api/agent/me', { token: writer.token }), 401, 'sign in first', '/api/agent/me');
    refused(await call(server, 'GET', `/api/modules/todo/data?scope=space&space=${S1}`, { token: writer.token }), 401, 'sign in first', 'data');
    refused(await call(server, 'POST', `/api/spaces/${S1}/action`, { token: writer.token, body: { action: 'todo:createTask', input: { title: 'x' } } }), 401, null, 'an action');
    refused(await call(server, 'POST', `/api/users/${writer.key}/token`, { cookie: admin }), 403, 'Agents are off on this server.', 'a token');
    ok(await call(server, 'DELETE', `/api/users/${writer.key}/token`, { cookie: admin }), 'revoking still works');
    const users = (await call(server, 'GET', '/api/users', { cookie: admin })).json.users;
    assert.ok(users.find((u) => u.key === writer.key).agent, 'the agents are still listed');
    ok(await call(server, 'DELETE', `/api/users/${reader.key}`, { cookie: admin }), 'an agent can be deleted');
    assert.ok(!JSON.parse(fs.readFileSync(path.join(single, 'tokens.json'), 'utf8')).tokens.some((t) => t.user === reader.key), 'its token went with it');
  });
  await server.stop();

  // --- hosted: one environment's token is nobody at another -------------------------------------------------------------
  const hosted = path.join(base, 'hosted');
  const hostEnv = { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'boss', ADMIN_PASSWORD: 'host-password-1', AGENT_TOKENS: 'true' };
  server = await startServer(hosted, hostEnv);
  const host = await signIn(server, 'boss', 'host-password-1', 'admin');
  for (const slug of ['acme', 'beta']) {
    ok(await call(server, 'POST', '/api/host/environments', { host: 'admin', cookie: host, body: { slug, name: slug, owner: { login: 'owner', password: 'owner-password-1' } } }), `${slug} made`, 201);
  }
  const acme = await signIn(server, 'owner', 'owner-password-1', 'acme');
  const beta = await signIn(server, 'owner', 'owner-password-1', 'beta');
  await test('hosted: a token of one environment is 401 at another; the console and the product host answer as before', async () => {
    for (const [slug, cookie] of [['acme', acme], ['beta', beta]]) ok(await call(server, 'PATCH', '/api/settings', { host: slug, cookie, body: { agents: true } }), `${slug} turns Agents on`);
    const a = (await call(server, 'POST', '/api/users', { host: 'acme', cookie: acme, body: { agent: true } })).json.user;
    const t = (await call(server, 'POST', `/api/users/${a.key}/token`, { host: 'acme', cookie: acme })).json.token;
    allTokens.push(t);
    assert.match(t, TOKEN_RE);
    ok(await call(server, 'GET', '/api/agent/me', { host: 'acme', token: t }), 'at acme');
    refused(await call(server, 'GET', '/api/agent/me', { host: 'beta', token: t }), 401, INVALID, 'at beta');
    // The same account key made at beta still does not take acme's token.
    refused(await call(server, 'GET', '/api/users', { host: 'beta', token: t }), 401, INVALID, 'any route at beta');
    refused(await call(server, 'GET', '/api/host/environments', { host: 'admin', token: t }), 401, 'sign in first', 'the console ignores it');
    ok(await call(server, 'GET', '/api/product', { token: t, headers: { host: `localhost:${server.port}` } }), 'the product host ignores it');
    const betaTokens = path.join(hosted, 'environments', 'beta', 'tokens.json');
    assert.ok(!fs.existsSync(betaTokens) || !fs.readFileSync(betaTokens, 'utf8').includes(sha256(t)), 'beta keeps none of acme\'s');
    assert.ok(fs.existsSync(path.join(hosted, 'environments', 'acme', 'agent-log', a.key)), 'acme keeps its own log');
    assert.ok(!fs.existsSync(path.join(hosted, 'environments', 'beta', 'agent-log')), 'beta has none');
  });
  await test('an owner\'s copy restored with a tokens.json, an agent-log/ and an agent-setup.json of its own keeps none: a planted token is 401', async () => {
    const dir = path.join(hosted, 'environments', 'acme');
    const a = (await call(server, 'GET', '/api/users', { host: 'acme', cookie: acme })).json.users.find((u) => u.agent);
    const planted = `agt_${crypto.randomBytes(32).toString('base64url')}`;
    const now = Date.now();
    const record = { id: 'plantedtoken1', kind: 'agent', user: a.key, hash: sha256(planted), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 29 * 86400000).toISOString(), lastUsedAt: null, lastAddress: null };
    const spent = `${JSON.stringify({ at: new Date(now).toISOString(), agent: a.key, token: 'x', method: 'GET', route: '/api/agent/me', status: 200, kind: 'read' })}\n`.repeat(3000);
    const files = filesUnder(dir).map(([f, b]) => [path.relative(dir, f).split(path.sep).join('/'), b])
      .filter(([n]) => n !== 'tokens.json' && !n.startsWith('agent-log/') && n !== 'agent-setup.json');
    // And a set-up agent's asks file (plan-admin-agent.md, step 2): an approved ask or an undo nobody saw made.
    const asks = { asks: [{ id: 'a'.repeat(16), agent: a.key, space: 'zz1', ask: 'add', person: a.key, at: now, state: 'waiting' }], changes: [] };
    files.push(['tokens.json', Buffer.from(JSON.stringify({ tokens: [record] }))], [`agent-log/${a.key}/${dayToday()}.jsonl`, Buffer.from(spent)], ['agent-setup.json', Buffer.from(JSON.stringify(asks))]);
    const restored = await call(server, 'POST', '/api/host/environments/acme/restore', { host: 'admin', cookie: host, raw: zipFiles(files), headers: { 'content-type': 'application/zip' } });
    ok(restored, 'the restore');
    assert.ok(!fs.existsSync(path.join(dir, 'tokens.json')), 'no tokens.json');
    assert.ok(!fs.existsSync(path.join(dir, 'agent-log')), 'no agent-log/');
    assert.ok(!fs.existsSync(path.join(dir, 'agent-setup.json')), 'no agent-setup.json');
    refused(await call(server, 'GET', '/api/agent/me', { host: 'acme', token: planted }), 401, INVALID, 'the planted token');
    const owner = await signIn(server, 'owner', 'owner-password-1', 'acme');
    const fresh = (await call(server, 'POST', `/api/users/${a.key}/token`, { host: 'acme', cookie: owner })).json.token;
    allTokens.push(fresh);
    const me = await call(server, 'GET', '/api/agent/me', { host: 'acme', token: fresh });
    ok(me, 'a token made after the restore');
    assert.equal(me.json.limits.reads.usedToday, 1, 'the planted log set no count');
  });
  await test('an owner\'s copy of the environment carries no tokens.json and no agent-log/; the agent is in it', async () => {
    const again = await signIn(server, 'owner', 'owner-password-1', 'acme'); // the restore made new session keys
    const zipped = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: server.port, path: '/api/environment/export', headers: { host: `acme.localhost:${server.port}`, cookie: again } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      }).on('error', reject);
    });
    assert.equal(zipped.status, 200);
    assert.ok(zipped.body.includes(Buffer.from('app.json')), 'a zip of the environment');
    assert.ok(!zipped.body.includes(Buffer.from('tokens.json')), 'no tokens.json');
    assert.ok(!zipped.body.includes(Buffer.from('agent-log/')), 'no agent-log/');
    assert.ok(!zipped.body.includes(Buffer.from('agent-setup.json')), 'no agent-setup.json');
  });
  await server.stop();

  // --- the token nowhere in the clear ------------------------------------------------------------------------------------
  await test('no token in a later answer, the data folders or the server\'s own log', async () => {
    const shown = new Set(allTokens);
    // Each token was in exactly one answer, the one that made it.
    for (const t of shown) assert.equal(answers.filter((a) => a.includes(t)).length, 1, 'a token is shown once');
    for (const [file, bytes] of filesUnder(base)) {
      if (file.endsWith('.zip') || file.includes('todo-agent-check')) continue;
      const text = bytes.toString('utf8');
      for (const t of shown) assert.ok(!text.includes(t), `${path.relative(base, file)} holds a token`);
    }
    for (const s of servers) for (const t of shown) assert.ok(!s.out.includes(t), 'the server log holds a token');
  });
} catch (err) {
  failed += 1;
  console.error(`FAIL setting up\n${err.stack || err}`);
} finally {
  for (const s of servers) await s.stop();
  fs.rmSync(base, { recursive: true, force: true });
  fs.rmSync(WALK_OUT, { force: true });
}

if (failed) {
  console.error(`check-agent-tokens: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-agent-tokens: ${n} passed`);
