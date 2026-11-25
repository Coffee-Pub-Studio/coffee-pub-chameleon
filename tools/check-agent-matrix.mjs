#!/usr/bin/env node
/*
 * check-agent-matrix.mjs -- the gate's one list and the Roles grid's Agent column (documentation/plans/plan-agent-matrix.md,
 * "Verify").
 *
 * Without a server (the list, server/agent-routes.js, read as code):
 *   - every entry has a kind (agent, or setup for the set-up agent of plan-admin-agent.md), a method, a path, counts, a
 *     place check and a `needs` of a permission key of its kind's column, `module` (never the set-up agent's) or `always`;
 *     a list with an entry missing `needs`, or crossing the kinds, is refused, naming the entry (the server stops at start);
 *   - every key an entry needs is a row its kind's column may tick, and every built-in row that column may tick is needed by
 *     some entry (module rows by a `module` entry);
 *   - every entry's method and path is in tools/route-table.json, and none is a sign-in route (server/oauth.js);
 *   - the agent's page's own copy of the list (ROUTE_METHODS and READS in public/agent-page.js) agrees with it.
 * Live, on throwaway servers:
 *   - with AGENT_TOKENS on, GET /api/roles has `columns` (the four, then agent), `never` (guest, agent) and the "Agents"
 *     rows with agentOnly; the Agent column's defaults are today's (read Chat and see members on, Send chat messages off,
 *     module rows at their member default, every never row off); a never row on PATCH is 400 with its sentence; an
 *     agent-only row on a person's column is 400;
 *   - the defaults give today's behaviour; unticking chat makes a post 403 and leaves actions working; unticking chatRead
 *     makes a Chat read 403; unticking a module's read row hides its data and its actions; unticking agentMembers makes the
 *     members read 403; `me`'s `permissions` follows the column; the member column changing no longer changes the agent's;
 *   - with AGENT_TOKENS off, the answer is as before plus `columns` and `never`, with no agent column and no agent rows,
 *     and PATCH /api/roles/agent is 404.
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
const { buildModule } = require(path.join(ROOT, 'server', 'module-build.js'));
const routes = require(path.join(ROOT, 'server', 'agent-routes.js'));
const { AGENT_ROUTES, AGENT_BUILT_IN, SETUP_BUILT_IN, AGENT_ONLY_PERMISSIONS, agentRouteProblems, assertAgentRoutes } = routes;
// The built-in rows each kind's column may tick (the set-up agent's: plan-admin-agent.md; its live cases are in
// tools/check-agent-setup.mjs).
const TICKABLE = { agent: AGENT_BUILT_IN, setup: SETUP_BUILT_IN };

const CANT = "An agent can't do that.";

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

// --- the list, read as code --------------------------------------------------------------------------------------------
await test('every entry has a kind, counts, a place and a needs of a key, module or always', () => {
  assert.deepEqual(agentRouteProblems(), [], 'the list is sound');
  for (const e of AGENT_ROUTES) {
    assert.ok(['agent', 'setup'].includes(e.kind), `${e.method} ${e.path}: kind`);
    assert.ok(['read', 'write', 'mcp'].includes(e.counts), `${e.method} ${e.path}: counts`);
    assert.ok(typeof e.place === 'string' && e.place, `${e.method} ${e.path}: place`);
    assert.ok(e.needs === 'module' || e.needs === 'always' || TICKABLE[e.kind].includes(e.needs), `${e.method} ${e.path}: needs "${e.needs}"`);
    if (e.kind === 'setup') assert.notEqual(e.needs, 'module', `${e.method} ${e.path}: a set-up agent reads no module`);
  }
});

await test('an entry without needs, or needing a row the column can never tick, is refused at start, by name', () => {
  const bad = [...AGENT_ROUTES, { kind: 'agent', method: 'get', path: '/api/spaces/:id/whatever', counts: 'read', place: 'spaceParam' }];
  assert.throws(() => assertAgentRoutes(bad), /GET \/api\/spaces\/:id\/whatever has no needs/);
  const never = [...AGENT_ROUTES, { kind: 'agent', method: 'get', path: '/api/x', counts: 'read', place: 'none', needs: 'conference' }];
  assert.throws(() => assertAgentRoutes(never), /needs "conference", which is not a row the agent column may tick/);
  const twice = [...AGENT_ROUTES, AGENT_ROUTES[0]];
  assert.throws(() => assertAgentRoutes(twice), /on the list twice/);
  // A kind's key on the other kind's entry, a module read for the set-up agent, a made-space check for the ordinary agent.
  const crossed = [...AGENT_ROUTES, { kind: 'agent', method: 'post', path: '/api/x', counts: 'write', place: 'none', needs: 'agentMakeSpaces' }];
  assert.throws(() => assertAgentRoutes(crossed), /needs "agentMakeSpaces", which is not a row the agent column may tick/);
  const setupReads = [...AGENT_ROUTES, { kind: 'setup', method: 'get', path: '/api/modules/:id/data', counts: 'read', place: 'spaceScope', needs: 'module' }];
  assert.throws(() => assertAgentRoutes(setupReads), /which the set-up agent never has/);
  const setupChat = [...AGENT_ROUTES, { kind: 'setup', method: 'get', path: '/api/spaces/:id/chat', counts: 'read', place: 'spaceParam', needs: 'chatRead' }];
  assert.throws(() => assertAgentRoutes(setupChat), /needs "chatRead", which is not a row the set-up agent column may tick/);
  const made = [...AGENT_ROUTES, { kind: 'agent', method: 'get', path: '/api/y/:id', counts: 'read', place: 'madeParam', needs: 'always' }];
  assert.throws(() => assertAgentRoutes(made), /only a set-up agent does/);
});

await test('every row an agent column may tick is needed by some entry of its kind; module rows by a module entry', () => {
  for (const kind of ['agent', 'setup']) {
    const needed = new Set(AGENT_ROUTES.filter((e) => e.kind === kind).map((e) => e.needs));
    for (const key of TICKABLE[kind]) assert.ok(needed.has(key), `${key} is tickable in the ${kind} column but no route of that kind needs it`);
  }
  assert.ok(AGENT_ROUTES.some((e) => e.kind === 'agent' && e.needs === 'module'), 'no entry leaves a module\'s own row to the route');
  for (const p of AGENT_ONLY_PERMISSIONS) {
    assert.ok(p.agentOnly === true && ['agent', 'setup'].includes(p.column), `${p.key}: an agent-only row naming its column`);
    assert.ok(TICKABLE[p.column].includes(p.key), `${p.key}: a row its column may tick`);
  }
  assert.deepEqual(AGENT_BUILT_IN.filter((k) => SETUP_BUILT_IN.includes(k)), [], 'the two kinds share no tickable row (plan-agent-matrix.md, decision 3)');
});

await test('the set-up column is plan-agent-matrix.md\'s: three rows, all off, and what each set-up route needs', () => {
  assert.deepEqual([...SETUP_BUILT_IN], ['agentMakeSpaces', 'agentChangeSpaces', 'agentAskPeople']);
  assert.deepEqual({ ...routes.SETUP_DEFAULTS }, { agentMakeSpaces: false, agentChangeSpaces: false, agentAskPeople: false }, 'nothing until an owner ticks it (decision 5)');
  assert.equal(AGENT_ONLY_PERMISSIONS.find((p) => p.key === 'agentAskPeople')?.label, 'Ask to add people');
  const needs = Object.fromEntries(AGENT_ROUTES.filter((e) => e.kind === 'setup').map((e) => [`${e.method.toUpperCase()} ${e.path}`, e.needs]));
  assert.deepEqual(needs, {
    'GET /api/agent/me': 'always', 'GET /api/agent/templates': 'always', 'GET /api/agent/icons': 'always', 'GET /api/agent/asks/:id': 'always',
    'POST /api/agent/spaces': 'agentMakeSpaces', 'PATCH /api/agent/spaces/:id': 'agentChangeSpaces',
    'GET /api/agent/people': 'agentAskPeople', 'POST /api/agent/spaces/:id/asks': 'agentAskPeople',
    // The MCP door (plan-admin-agent.md, step 3): its tool calls come back as the routes above and need what they need.
    'POST /mcp': 'always', 'GET /mcp': 'always',
  });
  // An ask names a space it made (the gate's madeParam), as a change does.
  assert.equal(AGENT_ROUTES.find((e) => e.kind === 'setup' && e.path === '/api/agent/spaces/:id/asks').place, 'madeParam');
});

await test('every entry is a route the app registers (tools/route-table.json)', () => {
  const mounted = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'route-table.json'), 'utf8'));
  const registered = new Set(mounted.rows.filter((r) => r.kind === 'route').map((r) => `${r.method} ${r.path}`));
  for (const e of AGENT_ROUTES) assert.ok(registered.has(`${e.method.toUpperCase()} ${e.path}`), `${e.method.toUpperCase()} ${e.path} is not in the route table`);
});

// The sign-in server's routes (server/oauth.js, plan-mcp-oauth.md) are never an agent's: an app gets its token there, and the
// approval page is a person's. An access token reaches only /mcp and the routes its tool calls wrap (tools/check-oauth.mjs).
await test('no sign-in route is on the list', () => {
  for (const e of AGENT_ROUTES) assert.ok(!/^\/(oauth|\.well-known|api\/oauth)(\/|$)/.test(e.path), `${e.method.toUpperCase()} ${e.path} is a sign-in route`);
});

await test('the agent page\'s ROUTE_METHODS and READS agree with the list', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'agent-page.js'), 'utf8');
  const chatRoute = /const CHAT_ROUTE = '([^']+)';/.exec(src)?.[1];
  assert.equal(chatRoute, '/api/spaces/:id/chat', 'CHAT_ROUTE');
  const readsAt = src.indexOf('const READS = {');
  assert.ok(readsAt >= 0, 'READS is in the page');
  const readsBody = src.slice(readsAt, src.indexOf('\n};', readsAt));
  const reads = new Set([...readsBody.matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]));
  const methodsLine = /const ROUTE_METHODS = (\{[^\n]*\});/.exec(src)?.[1];
  assert.ok(methodsLine, 'ROUTE_METHODS is in the page');
  const routeMethods = new Function('CHAT_ROUTE', `return (${methodsLine});`)(chatRoute);
  const listed = new Map();
  for (const e of AGENT_ROUTES) {
    if (!listed.has(e.path)) listed.set(e.path, new Set());
    listed.get(e.path).add(e.method.toUpperCase());
  }
  for (const [p, methods] of listed) {
    const page = new Set((routeMethods[p] || ['GET', 'HEAD']).filter((m) => m !== 'HEAD'));
    assert.deepEqual([...page].sort(), [...methods].sort(), `${p}: the page lets ${[...page].join(',')} but the list ${[...methods].join(',')}`);
    // Every route but the chat (worded by method) and the action route (worded by its action) reads as a line of READS.
    if (p !== chatRoute && p !== '/api/spaces/:id/action') assert.ok(reads.has(p), `${p} has no line in READS`);
  }
  for (const p of Object.keys(routeMethods)) assert.ok(listed.has(p), `ROUTE_METHODS names ${p}, which is not on the list`);
  for (const p of reads) assert.ok(listed.has(p), `READS names ${p}, which is not on the list`);
});

// --- live ----------------------------------------------------------------------------------------------------------------
const servers = [];
async function startServer(dataDir, env = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
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
function call(server, method, urlPath, { body, cookie, token, raw, headers: extra } = {}) {
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
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const cookieOf = (res) => [].concat(res.headers?.['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
async function signIn(server, login, password) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify({ login, password }));
    const req = http.request({ host: '127.0.0.1', port: server.port, method: 'POST', path: '/api/login', headers: { host: `127.0.0.1:${server.port}`, 'content-type': 'application/json', 'content-length': payload.length } }, (res) => {
      res.resume();
      res.on('end', () => (res.statusCode === 200 ? resolve(cookieOf(res)) : reject(new Error(`${login} could not sign in: ${res.statusCode}`))));
    });
    req.on('error', reject);
    req.end(payload);
  });
}
const ok = (r, what, status = 200) => assert.equal(r.status, status, `${what}: ${r.status} ${r.text.slice(0, 300)}`);
const refused = (r, status, error, what) => {
  assert.equal(r.status, status, `${what}: ${r.status} ${r.text.slice(0, 300)}`);
  if (error) assert.equal(r.json?.error, error, `${what}: the sentence`);
};

// A bundled module uploaded as a module of its own: an upload may not declare actions.server (server/module-actions.js; it would
// be refused), so the copy leaves it out and its agents' requests wait for a page, as an uploaded module's do.
const uploadZipOf = (id) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `upload-${id}-`));
  fs.cpSync(path.join(ROOT, 'modules', id), dir, { recursive: true });
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'module.json'), 'utf8'));
  if (m.actions) delete m.actions.server;
  fs.writeFileSync(path.join(dir, 'module.json'), JSON.stringify(m, null, 2));
  return buildModule(dir).zip;
};
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-agent-matrix-'));
try {
  // AGENT_TOKENS on.
  let server = await startServer(path.join(base, 'on'), { ADMIN_PASSWORD: 'admin-password-1', AGENT_TOKENS: 'true' });
  const admin = await signIn(server, 'admin', 'admin-password-1');
  ok(await call(server, 'PATCH', '/api/settings', { cookie: admin, body: { agents: true } }), 'Agents on');
  for (const id of ['todo', 'vault']) {
    ok(await call(server, 'POST', '/api/modules', { cookie: admin, raw: uploadZipOf(id), headers: { 'content-type': 'application/zip' } }), `${id} installs`, 201);
    ok(await call(server, 'PATCH', `/api/modules/${id}`, { cookie: admin, body: { enabled: true } }), `${id} is on`);
  }
  const mia = (await call(server, 'POST', '/api/users', { cookie: admin, body: { login: 'mia', displayName: 'Mia', password: 'mia-password-1', role: 'member' } })).json.user;
  const agent = (await call(server, 'POST', '/api/users', { cookie: admin, body: { agent: true } })).json.user;
  const S1 = (await call(server, 'POST', '/api/spaces', { cookie: admin, body: { name: 'Camp', members: [agent.key, mia.key] } })).json.space.id;
  const A = { token: (await call(server, 'POST', `/api/users/${agent.key}/token`, { cookie: admin })).json.token };
  const miaC = await signIn(server, 'mia', 'mia-password-1');
  const column = (body) => call(server, 'PATCH', '/api/roles/agent', { cookie: admin, body });
  const chat = `/api/spaces/${S1}/chat`;
  const todoData = `/api/modules/todo/data?scope=space&space=${S1}`;
  const todoActions = async () => ((await call(server, 'GET', `/api/spaces/${S1}/actions`, A)).json?.actions || []).filter((a) => a.module === 'todo');

  let roles = null;
  await test('GET /api/roles: columns, never and the Agents rows', async () => {
    const r = await call(server, 'GET', '/api/roles', { cookie: admin });
    ok(r, 'roles');
    roles = r.json;
    assert.deepEqual(roles.columns, ['owner', 'moderator', 'member', 'guest', 'agent']);
    assert.deepEqual(Object.keys(roles.roles), roles.columns);
    assert.deepEqual(Object.keys(roles.never).sort(), ['agent', 'guest']);
    const keys = roles.permissions.map((p) => p.key);
    for (const k of roles.never.agent) assert.ok(keys.includes(k), `never names ${k}, which is no row`);
    for (const k of ['conference', 'sendPictures', 'react', 'shareScreen', 'privateCall', 'startAside', 'canMute', 'canKick', 'canInvite', 'manageTags', 'useAi', 'image_profile', 'module.vault.see_all', 'module.todo.clear']) {
      if (keys.includes(k)) assert.ok(roles.never.agent.includes(k), `${k} is never an agent's`);
    }
    for (const k of ['chatRead', 'chat', 'agentMembers', 'module.todo.view', 'module.todo.edit', 'module.vault.view']) assert.ok(!roles.never.agent.includes(k), `${k} is tickable for an agent`);
    assert.ok(roles.never.guest.includes('module.vault.see_all') && roles.never.guest.includes('manageTags'), 'the guest\'s locked rows');
    const members = roles.permissions.find((p) => p.key === 'agentMembers');
    assert.ok(members && members.agentOnly === true && members.group === 'Agents', 'the Agents row');
    assert.match(members.label, /^See who is in /);
    // Ask to delete (plan-agent-edit-delete.md, decision 2): an Agent-column row, off by default, no box for the set-up agent.
    const del = roles.permissions.find((p) => p.key === 'agentDelete');
    assert.ok(del && del.agentOnly === true && del.group === 'Agents', 'the Ask to delete row');
    assert.match(del.label, /^Ask to delete /);
    assert.equal(roles.roles.agent.agentDelete, false, 'off by default');
    assert.ok(!roles.never.agent.includes('agentDelete'), 'tickable for an agent');
    if (roles.never.setup) assert.ok(roles.never.setup.includes('agentDelete'), 'never the set-up agent\'s');
    for (const p of roles.permissions.filter((x) => x.key !== 'agentMembers' && x.key !== 'agentDelete')) assert.ok(!p.agentOnly, `${p.key} is not agent-only`);
  });

  await test('the Agent column starts as agents work today', async () => {
    const a = roles.roles.agent;
    const m = roles.roles.member;
    assert.deepEqual([a.chatRead, a.chat, a.agentMembers], [true, false, true]);
    for (const k of ['module.todo.view', 'module.todo.edit', 'module.vault.view', 'module.vault.add']) assert.equal(a[k], m[k], `${k} at the member default`);
    for (const k of roles.never.agent) assert.equal(a[k], false, `${k} is off`);
    assert.ok(!('agentMembers' in m), 'a person\'s column has no agent row');
    const me = await call(server, 'GET', '/api/agent/me', A);
    assert.deepEqual(me.json.permissions, ['agentMembers', 'chatRead']);
    ok(await call(server, 'GET', chat, A), 'reads Chat');
    refused(await call(server, 'POST', chat, { ...A, body: { text: 'hi' } }), 403, CANT, 'no post');
    ok(await call(server, 'GET', `/api/spaces/${S1}/members`, A), 'reads the members');
    ok(await call(server, 'GET', todoData, A), 'reads the To-do');
    assert.ok((await todoActions()).length > 0, 'lists the To-do\'s actions');
    ok(await call(server, 'POST', `/api/spaces/${S1}/action`, { ...A, body: { action: 'todo:createTask', input: { title: 'A task' } } }), 'asks for a change');
  });

  await test('a never row on PATCH is 400; an agent-only row on a person\'s column is 400; nothing is stored', async () => {
    refused(await column({ conference: true }), 400, 'An agent can never have "See and join the conference".', 'the call');
    refused(await column({ useAi: false }), 400, 'An agent can never have "Use AI (needs an AI service set up)".', 'AI, even off');
    refused(await column({ 'module.vault.see_all': true }), 400, null, 'a library\'s see every file');
    refused(await column({ chat: true, canKick: true }), 400, 'An agent can never have "Kick other people".', 'one never row among good ones');
    refused(await call(server, 'PATCH', '/api/roles/member', { cookie: admin, body: { agentMembers: false } }), 400, null, 'agentMembers on the member column');
    assert.match((await call(server, 'PATCH', '/api/roles/guest', { cookie: admin, body: { agentMembers: true } })).json.error, /^Only an agent can have "See who is in .+"\.$/);
    refused(await call(server, 'PATCH', '/api/roles/agent', { cookie: miaC, body: { chat: true } }), 403, null, 'a member');
    const after = (await call(server, 'GET', '/api/roles', { cookie: admin })).json.roles;
    assert.equal(after.agent.chat, false, 'the refused patch changed nothing');
    assert.ok(!('agentMembers' in after.member) && !('agentMembers' in after.guest));
  });

  await test('unticking chat stops posting and leaves actions; unticking chatRead stops reading Chat', async () => {
    ok(await column({ chat: true }), 'chat on');
    ok(await call(server, 'POST', chat, { ...A, body: { text: 'hello' } }), 'a post');
    ok(await column({ chat: false }), 'chat off');
    refused(await call(server, 'POST', chat, { ...A, body: { text: 'hello' } }), 403, CANT, 'a post');
    ok(await call(server, 'POST', `/api/spaces/${S1}/action`, { ...A, body: { action: 'todo:createTask', input: { title: 'Still' } } }), 'an action');
    ok(await column({ chatRead: false }), 'chatRead off');
    refused(await call(server, 'GET', chat, A), 403, CANT, 'a read');
    assert.ok((await todoActions()).length > 0, 'the actions list still goes');
    assert.deepEqual((await call(server, 'GET', '/api/agent/me', A)).json.permissions, ['agentMembers']);
    ok(await column({ chatRead: true }), 'back');
  });

  await test('unticking a module\'s read row hides its data and its actions', async () => {
    ok(await column({ 'module.todo.view': false }), 'todo view off');
    assert.equal((await call(server, 'GET', todoData, A)).status, 403, 'its data');
    assert.equal((await todoActions()).length, 0, 'its actions');
    assert.equal((await call(server, 'POST', `/api/spaces/${S1}/action`, { ...A, body: { action: 'todo:createTask', input: { title: 'No' } } })).status, 403, 'asking');
    ok(await column({ 'module.todo.view': true }), 'back');
    ok(await call(server, 'GET', todoData, A), 'its data again');
  });

  await test('unticking agentMembers makes the members read 403', async () => {
    ok(await column({ agentMembers: false }), 'off');
    refused(await call(server, 'GET', `/api/spaces/${S1}/members`, A), 403, CANT, 'members');
    ok(await column({ agentMembers: true }), 'back');
  });

  await test('the member column changing no longer changes the agent\'s', async () => {
    ok(await call(server, 'PATCH', '/api/roles/member', { cookie: admin, body: { chatRead: false, 'module.todo.view': false } }), 'members lose Chat and the To-do');
    ok(await call(server, 'GET', chat, A), 'the agent still reads Chat');
    ok(await call(server, 'GET', todoData, A), 'and the To-do');
    assert.equal((await call(server, 'GET', todoData, { cookie: miaC })).status, 403, 'a member does not');
    ok(await call(server, 'PATCH', '/api/roles/member', { cookie: admin, body: { chatRead: true, 'module.todo.view': true } }), 'members back');
  });
  await server.stop();

  // AGENT_TOKENS off.
  server = await startServer(path.join(base, 'off'), { ADMIN_PASSWORD: 'admin-password-1' });
  const admin2 = await signIn(server, 'admin', 'admin-password-1');
  await test('with AGENT_TOKENS off: no agent column, no agent rows, and PATCH /api/roles/agent is 404', async () => {
    const r = await call(server, 'GET', '/api/roles', { cookie: admin2 });
    ok(r, 'roles');
    assert.deepEqual(Object.keys(r.json).sort(), ['columns', 'never', 'permissions', 'roles']);
    assert.deepEqual(r.json.columns, ['owner', 'moderator', 'member', 'guest']);
    assert.deepEqual(Object.keys(r.json.roles), r.json.columns);
    assert.deepEqual(Object.keys(r.json.never), ['guest']);
    assert.ok(!r.json.permissions.some((p) => p.agentOnly || p.key === 'agentMembers'), 'no agent rows');
    refused(await call(server, 'PATCH', '/api/roles/agent', { cookie: admin2, body: { chat: true } }), 404, 'no such role', 'the agent column');
    ok(await call(server, 'PATCH', '/api/roles/member', { cookie: admin2, body: { chat: false } }), 'a person\'s column as before');
  });
  await server.stop();
} catch (err) {
  failed += 1;
  console.error(`FAIL setting up\n${err.stack || err}`);
} finally {
  for (const s of servers) await s.stop();
  fs.rmSync(base, { recursive: true, force: true });
}

if (failed) {
  console.error(`check-agent-matrix: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-agent-matrix: ${n} passed`);
