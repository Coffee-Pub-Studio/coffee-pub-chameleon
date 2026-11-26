#!/usr/bin/env node
/*
 * check-mcp.mjs -- the MCP door for agents (server/mcp.js; Thomas, 2026-11-20), against real servers on throwaway
 * DATA_DIRs, through real HTTP:
 *   - initialize negotiates 2025-03-26, 2025-06-18 and 2025-11-25 (an unknown version gets the newest), with no session;
 *     notifications/initialized is 202; ping; tools/list has every tool, each with an object inputSchema and words in
 *     the product's names;
 *   - tools/call me answers what GET /api/agent/me answers, `permissions` and no `chatPost`; a tool whose route needs an
 *     unticked row of the Agent column is the gate's 403 as a tool error; a tool call counts once, as the route it wraps (a read, or a
 *     write for ask_for_change and post_chat), and is logged as that route, with the address the call came from; every
 *     other message on /mcp is one read, logged as /mcp;
 *   - a space the agent is not in is refused (the route's own 404 sentence, as a tool error), and so are bad arguments;
 *   - 20 writes a minute, then the gate's 429 sentence as a tool error, every write in the log, no text in it;
 *   - a revoked token, and Agents turned off, are 401 with WWW-Authenticate: Bearer and the sign-in server's resource_metadata; a person's session (a cookie) is
 *     refused, nobody is 401, and a token in the query string is not read;
 *   - GET /mcp is 405 (Allow: POST); an unknown method -32601, an unknown tool -32602, bad JSON -32700 (counted and logged),
 *     a batch, the wrong content type, an unknown MCP-Protocol-Version, another site's Origin and a body over 64 KB refused;
 *   - with AGENT_TOKENS off, /mcp answers as any unknown path did before;
 *   - hosted (BASE_DOMAIN): a tool call runs in the environment it was sent to; a token of one is 401 at another.
 * The set-up agent's tools (plan-admin-agent.md, step 3), on a server with AGENT_SETUP:
 *   - its token lists exactly its own tools (me, list_templates, list_icons, list_people, make_space, change_space,
 *     ask_owner, ask_status), and initialize tells it what it is; an ordinary agent's token lists none of them;
 *   - each tool answers what its route answers, counts as that route (a read, or a write for make_space, change_space and
 *     ask_owner) and is logged as it, with the space and the change, never a name or a description;
 *   - an unticked row of its column is the gate's 403 as a tool error; the route's own sentences come back as tool errors
 *     (an unknown template, a person who is not a member, a bad ask, a space it did not make, nothing to change);
 *   - ask_owner changes nothing and raises one bell line for an owner; ask_status reads it;
 *   - an ordinary agent can't call them, and a set-up agent can't call a module or Chat tool (both -32602, nothing done);
 *   - the daily cap of spaces made is the route's 429 sentence as a tool error; Set-up agents off is 401;
 *   - hosted: a set-up agent's token of one environment is 401 at another.
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

const INVALID = 'That agent token is not valid.';
const OVER = 'The agent has done as much as it may for now.';
const ONLY_AGENTS = "This is for an agent's token only.";
const TOOL_NAMES = ['me', 'read_context', 'read_data', 'read_weather', 'search_objects', 'object_links', 'object_kinds', 'object_format', 'resolve_objects', 'list_members', 'list_actions', 'ask_for_change', 'request_status', 'ask_to_delete', 'ask_status', 'read_chat', 'post_chat'];
const SETUP_TOOL_NAMES = ['me', 'list_templates', 'list_icons', 'list_people', 'make_space', 'change_space', 'ask_owner', 'ask_status'];
const CANT = "An agent can't do that.";
// The 401 on /mcp names the sign-in server's metadata (server/oauth.js, plan-mcp-oauth.md); a REST route's 401 does not.
const CHALLENGE = /^Bearer resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource\/mcp", scope="agent"$/;
const LIVEKIT = { LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret' };

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
async function startServer(dataDir, env = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, ...LIVEKIT, ...env },
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

function call(server, method, urlPath, { body, cookie, token, host, raw, headers: extra } = {}) {
  const payload = raw !== undefined ? raw : body === undefined ? null : Buffer.from(JSON.stringify(body));
  const headers = { host: host ? `${host}.localhost:${server.port}` : `127.0.0.1:${server.port}`, accept: 'application/json, text/event-stream', ...(extra || {}) };
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
const cookieOf = (res) => [].concat(res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
async function signIn(server, login, password, host) {
  const r = await call(server, 'POST', host === 'admin' ? '/api/host/login' : '/api/login', { body: { login, password }, host });
  assert.equal(r.status, 200, `${login} signs in: ${r.text}`);
  return cookieOf(r);
}
const ok = (r, what, status = 200) => assert.equal(r.status, status, `${what}: ${r.status} ${r.text.slice(0, 300)}`);
const dayToday = () => new Date().toISOString().slice(0, 10);
const logLines = (dir, key) => {
  const file = path.join(dir, 'agent-log', key, `${dayToday()}.jsonl`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

// One JSON-RPC message to /mcp.
let nextId = 1;
const rpc = (server, method, params, opts = {}) => call(server, 'POST', '/mcp', { ...opts, body: { jsonrpc: '2.0', id: nextId++, method, ...(params === undefined ? {} : { params }) } });
const tool = (server, name, args, opts) => rpc(server, 'tools/call', { name, arguments: args }, opts);
// A tool's result: { isError, text, json }.
function result(r, what) {
  ok(r, what);
  assert.equal(r.json?.jsonrpc, '2.0', `${what}: JSON-RPC`);
  assert.ok(r.json.result, `${what}: a result: ${r.text.slice(0, 300)}`);
  const content = r.json.result.content;
  assert.ok(Array.isArray(content) && content.length === 1 && content[0].type === 'text', `${what}: one text content`);
  let json = null;
  try { json = JSON.parse(content[0].text); } catch { /* a sentence */ }
  return { isError: r.json.result.isError === true, text: content[0].text, json };
}
const rpcError = (r, status, code, what) => {
  assert.equal(r.status, status, `${what}: ${r.status} ${r.text.slice(0, 300)}`);
  assert.equal(r.json?.jsonrpc, '2.0', `${what}: JSON-RPC`);
  assert.equal(r.json?.error?.code, code, `${what}: the code (${r.text.slice(0, 200)})`);
  assert.equal(typeof r.json.error.message, 'string');
};

// The upload fixture of tools/check-module-actions.mjs: an uploaded module with server actions, which this server (no network
// wall, no approval) does not run for agents (plan-agent-server-actions.md, section 8).
const UPLOAD_FIXTURE = path.join(ROOT, 'tools', 'fixtures', 'module-actions', 'fixture-upload');
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-mcp-'));
const single = path.join(base, 'single');
const onEnv = { ADMIN_PASSWORD: 'admin-password-1', AGENT_TOKENS: 'true' };

try {
  const server = await startServer(single, onEnv);
  const admin = await signIn(server, 'admin', 'admin-password-1');
  ok(await call(server, 'PATCH', '/api/settings', { cookie: admin, body: { agents: true } }), 'Agents on');
  ok(await call(server, 'POST', '/api/modules/bundled/todo/install', { cookie: admin, body: {} }), 'the To-do installs', 201);
  ok(await call(server, 'PATCH', '/api/modules/todo', { cookie: admin, body: { enabled: true } }), 'the To-do is on');
  ok(await call(server, 'POST', '/api/modules', { cookie: admin, raw: buildModule(UPLOAD_FIXTURE).zip, headers: { 'content-type': 'application/zip' } }), 'an uploaded module with server actions installs', 201);
  ok(await call(server, 'PATCH', '/api/modules/fixture-upload', { cookie: admin, body: { enabled: true } }), 'and is on');
  const mia = (await call(server, 'POST', '/api/users', { cookie: admin, body: { login: 'mia', displayName: 'Mia', password: 'mia-password-1', role: 'member' } })).json.user;
  const makeAgent = async (name, spaces) => {
    const agent = (await call(server, 'POST', '/api/users', { cookie: admin, body: { agent: true, displayName: name } })).json.user;
    for (const id of spaces) {
      const sp = (await call(server, 'GET', `/api/spaces/${id}`, { cookie: admin })).json.space;
      ok(await call(server, 'PATCH', `/api/spaces/${id}`, { cookie: admin, body: { members: [...sp.members, agent.key] } }), `${name} joins`);
    }
    const token = (await call(server, 'POST', `/api/users/${agent.key}/token`, { cookie: admin })).json.token;
    return { key: agent.key, token };
  };
  const S1 = (await call(server, 'POST', '/api/spaces', { cookie: admin, body: { name: 'Camp', members: [mia.key] } })).json.space.id;
  const S2 = (await call(server, 'POST', '/api/spaces', { cookie: admin, body: { name: 'Elsewhere', members: [mia.key] } })).json.space.id;
  const A = await makeAgent('Claude', [S1]);
  const T = { token: A.token };
  const used = async (who = A) => (await call(server, 'GET', '/api/agent/me', { token: who.token })).json.limits;

  await test('initialize negotiates the protocol version, statelessly', async () => {
    for (const [asked, answered] of [['2025-03-26', '2025-03-26'], ['2025-06-18', '2025-06-18'], ['2025-11-25', '2025-11-25'], ['2024-11-05', '2025-11-25'], ['nonsense', '2025-11-25']]) {
      const r = await rpc(server, 'initialize', { protocolVersion: asked, capabilities: {}, clientInfo: { name: 'check', version: '1' } }, T);
      ok(r, `initialize ${asked}`);
      assert.equal(r.json.result.protocolVersion, answered, `asked ${asked}`);
      assert.deepEqual(r.json.result.capabilities, { tools: { listChanged: false } });
      assert.equal(typeof r.json.result.serverInfo.name, 'string');
      assert.equal(typeof r.json.result.serverInfo.version, 'string');
      assert.equal(r.headers['mcp-session-id'], undefined, 'no session');
      assert.match(r.headers['content-type'], /^application\/json/);
      assert.equal(r.headers['cache-control'], 'no-store');
    }
    const note = await call(server, 'POST', '/mcp', { ...T, body: { jsonrpc: '2.0', method: 'notifications/initialized' }, headers: { 'mcp-protocol-version': '2025-06-18' } });
    assert.equal(note.status, 202, 'a notification is 202');
    assert.equal(note.text, '', 'with no body');
    const reply = await call(server, 'POST', '/mcp', { ...T, body: { jsonrpc: '2.0', id: 7, result: {} } });
    assert.equal(reply.status, 202, "a client's response is 202");
    const ping = await rpc(server, 'ping', undefined, T);
    ok(ping, 'ping');
    assert.deepEqual(ping.json.result, {});
  });

  await test('tools/list has every tool, each with a schema, in the product\'s words', async () => {
    const r = await rpc(server, 'tools/list', {}, T);
    ok(r, 'tools/list');
    const tools = r.json.result.tools;
    assert.deepEqual(tools.map((t) => t.name), TOOL_NAMES);
    for (const t of tools) {
      assert.match(t.name, /^[a-z]+(_[a-z]+)*$/, `${t.name} is snake_case`);
      assert.equal(t.inputSchema.type, 'object', `${t.name}: inputSchema`);
      assert.equal(t.inputSchema.additionalProperties, false, `${t.name}: no other argument`);
      for (const k of t.inputSchema.required) assert.ok(Object.hasOwn(t.inputSchema.properties, k), `${t.name}: ${k} is a property`);
      assert.ok(t.description.length > 20 && t.description.length < 600, `${t.name}: a short description`);
      assert.equal(typeof t.annotations.readOnlyHint, 'boolean');
      assert.equal('plan' in t, false);
      const words = [t.title, t.description, ...Object.values(t.inputSchema.properties).map((p) => p.description)].join(' ').toLowerCase();
      for (const old of ['room', 'table', 'stage', 'pane', 'tenant', 'item', 'card']) assert.doesNotMatch(words, new RegExp(`\\b${old}s?\\b`), `${t.name} says ${old}`);
    }
    assert.equal(tools.find((t) => t.name === 'ask_for_change').annotations.readOnlyHint, false);
    // plan-agent-server-actions.md, section 8: nothing waits for a page, so there is no wait_for_result, and the words say a
    // change is done at once or refused at once with why.
    assert.equal(tools.find((t) => t.name === 'wait_for_result'), undefined, 'no wait_for_result');
    assert.match(tools.find((t) => t.name === 'ask_for_change').description, /It is done at once/, 'ask_for_change says it is done at once');
    assert.match(tools.find((t) => t.name === 'ask_for_change').description, /may: false it is refused at once with why/, 'and what is refused at once');
    assert.doesNotMatch(tools.find((t) => t.name === 'ask_for_change').description, /wait/, 'and nothing about waiting');
    assert.match(tools.find((t) => t.name === 'list_actions').description, /may: false with why/, 'list_actions says may and why');
    assert.match(tools.find((t) => t.name === 'request_status').description, /claimed while the server is carrying it out/, 'request_status says what claimed means');
    assert.match(tools.find((t) => t.name === 'post_chat').description, /permissions in me includes chat/, 'post_chat says it needs chat in me\'s permissions');
    assert.match(tools.find((t) => t.name === 'me').description, /permissions/, 'me says it carries permissions');
    // plan-itinerary-weather.md, step 5: read_weather names the space and the days only, and says what an empty answer means.
    const weather = tools.find((t) => t.name === 'read_weather');
    assert.deepEqual([Object.keys(weather.inputSchema.properties), weather.inputSchema.required, weather.annotations.readOnlyHint], [['space', 'module', 'from', 'to'], ['space'], true]);
    assert.match(weather.description, /configured: false \} means weather is not configured/, 'read_weather says what configured: false means');
    assert.match(weather.description, /beyond the window .* or with no place carries only its state/, 'read_weather says what a day with only a state is');
    assert.match(weather.description, /one read/, 'read_weather says it is one read');
  });

  await test('tools/call me answers what GET /api/agent/me does', async () => {
    const me = result(await tool(server, 'me', {}, T), 'me');
    assert.equal(me.isError, false);
    assert.equal(me.json.agent.key, A.key);
    assert.deepEqual(me.json.spaces, [{ id: S1, name: 'Camp' }]);
    assert.ok(!('chatPost' in me.json), 'no chatPost');
    assert.deepEqual(me.json.permissions, ['agentMembers', 'chatRead'], 'the Agent column\'s defaults');
    assert.equal(result(await rpc(server, 'tools/call', { name: 'me' }, T), 'me without arguments').isError, false);
  });

  await test('tools/call list_members answers what GET /api/spaces/:id/members does, as one read', async () => {
    const before = await used();
    const out = result(await tool(server, 'list_members', { space: S1 }, T), 'list_members');
    assert.equal(out.isError, false, out.text);
    const direct = await call(server, 'GET', `/api/spaces/${S1}/members`, T);
    assert.deepEqual(out.json, direct.json);
    assert.deepEqual(Object.keys(out.json), ['members']);
    for (const m of out.json.members) assert.deepEqual(Object.keys(m).sort(), ['key', 'name']);
    assert.ok(out.json.members.some((m) => m.key === A.key && m.name === 'Claude (agent)'), 'the agent as Name (agent)');
    assert.ok(out.json.members.some((m) => m.key === mia.key && m.name === 'Mia'), 'a person');
    const after = await used();
    assert.equal(after.reads.usedToday, before.reads.usedToday + 3, 'the tool read, the direct read and the me');
    const listed = (await rpc(server, 'tools/list', {}, T)).json.result.tools.find((t) => t.name === 'list_members');
    assert.match(listed.description, /Paid by/);
  });

  await test('a tool whose route needs an unticked row of the Agent column is the gate\'s 403, as a tool error', async () => {
    const CANT = "An agent can't do that.";
    const column = (body) => call(server, 'PATCH', '/api/roles/agent', { cookie: admin, body });
    ok(await column({ agentMembers: false, chatRead: false }), 'agents lose members and chatRead');
    for (const [name, args] of [['list_members', { space: S1 }], ['read_chat', { space: S1 }], ['post_chat', { space: S1, text: 'hi' }]]) {
      const out = result(await tool(server, name, args, T), name);
      assert.deepEqual([out.isError, out.text], [true, CANT], `${name}: ${out.text}`);
    }
    assert.deepEqual(result(await tool(server, 'me', {}, T), 'me').json.permissions, [], 'me says none');
    assert.equal(result(await tool(server, 'list_actions', { space: S1 }, T), 'list_actions').isError, false, 'list_actions still goes');
    ok(await column({ agentMembers: true, chatRead: true }), 'back');
    assert.equal(result(await tool(server, 'list_members', { space: S1 }, T), 'list_members again').isError, false);
  });

  await test('list_actions carries each action\'s label and description, and says to read them', async () => {
    const list = result(await tool(server, 'list_actions', { space: S1 }, T), 'list_actions');
    const create = list.json.actions.find((x) => x.action === 'todo:createTask');
    assert.equal(create.label, 'Add a task');
    assert.equal(create.description, 'Add a new task.');
    assert.equal(typeof create.input, 'object', 'the existing fields stay');
    for (const x of list.json.actions) assert.ok(x.description === undefined || typeof x.description === 'string');
    const tools = (await rpc(server, 'tools/list', {}, T)).json.result.tools;
    assert.match(tools.find((t) => t.name === 'list_actions').description, /description and hints before you call ask_for_change/);
    assert.match(tools.find((t) => t.name === 'ask_for_change').description, /description and hints in list_actions/);
  });

  await test('list_actions: an uploaded module the server does not run shows may: false and why; ask_for_change is refused at once', async () => {
    const WALL = 'This server doesn\'t run uploaded modules\' actions for agents.';
    const U = { token: (await makeAgent('Uploads', [S1])).token }; // its own log, so the other tests' lines stay as they were
    const listed = result(await tool(server, 'list_actions', { space: S1 }, U), 'list_actions');
    const up = listed.json.actions.find((a) => a.action === 'fixture-upload:addNote');
    assert.ok(up, 'listed');
    assert.deepEqual([up.may, up.now, up.why, up.waiting], [false, false, WALL, undefined]);
    const todo = listed.json.actions.find((a) => a.action === 'todo:createTask');
    assert.deepEqual([todo.may, todo.now, todo.why, todo.waiting], [true, true, undefined, undefined], 'a bundled module\'s action is done at once');
    const asked = result(await tool(server, 'ask_for_change', { space: S1, action: 'fixture-upload:addNote', input: { title: 'No' } }, U), 'ask_for_change');
    assert.deepEqual([asked.isError, asked.text], [true, WALL]);
  });

  await test('a tool call counts once, as its route, and is logged as that route', async () => {
    const before = await used();
    result(await tool(server, 'read_chat', { space: S1 }, T), 'read_chat');
    result(await tool(server, 'list_actions', { space: S1 }, T), 'list_actions');
    let after = await used();
    assert.equal(after.reads.usedToday, before.reads.usedToday + 3, 'two tool reads and the me');
    assert.equal(after.writes.usedToday, before.writes.usedToday);
    const asked = result(await tool(server, 'ask_for_change', { space: S1, action: 'todo:createTask', input: { title: 'Secret title 5521' } }, T), 'ask_for_change');
    assert.equal(asked.isError, false, asked.text);
    assert.deepEqual([asked.json.status, asked.json.ok], ['done', true], 'done at once, on the server');
    const status = result(await tool(server, 'request_status', { space: S1, request: asked.json.id }, T), 'request_status');
    assert.deepEqual([status.json.status, status.json.ok], ['done', true]);
    const before2 = after;
    after = await used();
    assert.equal(after.writes.usedToday, before2.writes.usedToday + 1, 'ask_for_change is one write');
    assert.equal(after.reads.usedToday, before2.reads.usedToday + 2, 'request_status and the me are reads, ask_for_change none');
    const list = await rpc(server, 'tools/list', {}, T);
    ok(list, 'tools/list');
    const before3 = after;
    after = await used();
    assert.equal(after.reads.usedToday, before3.reads.usedToday + 2, 'tools/list is one read');
    const lines = logLines(single, A.key);
    const action = lines.filter((l) => l.route === '/api/spaces/:id/action');
    assert.equal(action.length, 1);
    assert.deepEqual([action[0].method, action[0].kind, action[0].action, action[0].space, action[0].module, action[0].request], ['POST', 'write', 'todo:createTask', S1, 'todo', asked.json.id]);
    assert.ok(lines.some((l) => l.route === '/api/spaces/:id/chat' && l.method === 'GET' && l.kind === 'read' && l.message === 0), 'the chat read');
    assert.ok(lines.some((l) => l.route === '/mcp' && l.method === 'POST' && l.kind === 'read'), 'tools/list as /mcp');
    assert.equal(lines.filter((l) => l.route === '/mcp').length, lines.length - lines.filter((l) => l.route !== '/mcp').length);
    const raw = fs.readFileSync(path.join(single, 'agent-log', A.key, `${dayToday()}.jsonl`), 'utf8');
    assert.ok(!raw.includes('Secret title 5521') && !raw.includes(A.token) && !raw.includes('tools/call'), 'no content, token or message in the log');
  });

  await test('the address the call came from is the one logged', async () => {
    result(await tool(server, 'read_chat', { space: S1 }, { ...T, headers: { 'x-forwarded-for': '203.0.113.7' } }), 'read_chat by a proxy');
    const line = logLines(single, A.key).filter((l) => l.route === '/api/spaces/:id/chat').pop();
    assert.equal(line.address, '203.0.113.7');
  });

  await test('a space the agent is not in is refused, as the route refuses it', async () => {
    for (const [name, args] of [
      ['read_chat', { space: S2 }],
      ['list_actions', { space: S2 }],
      ['list_members', { space: S2 }],
      ['read_data', { space: S2, module: 'todo' }],
      ['read_context', { space: S2, module: 'todo' }],
      ['search_objects', { space: S2, from: 'todo' }],
      ['ask_for_change', { space: S2, action: 'todo:createTask', input: { title: 'x' } }],
      ['object_links', { from: 'todo', ref: { module: 'todo', kind: 'task', id: 't1', scope: 'space', space: S2 } }],
      ['resolve_objects', { from: 'todo', refs: [{ module: 'todo', kind: 'task', id: 't1', scope: 'space', space: S2 }] }],
      ['read_chat', { space: 'nothere1' }],
    ]) {
      const out = result(await tool(server, name, args, T), `${name} elsewhere`);
      assert.equal(out.isError, true, `${name}: an error`);
      assert.equal(out.text, 'no such space', `${name}: the route's sentence`);
    }
    const outside = result(await tool(server, 'resolve_objects', { from: 'todo', refs: [{ module: 'todo', kind: 'task', id: 't1', scope: 'environment' }] }, T), 'an environment pointer');
    assert.deepEqual([outside.isError, outside.text], [true, "An agent can't do that."]);
    const lines = logLines(single, A.key).filter((l) => l.status === 404);
    assert.ok(lines.length >= 8 && lines.every((l) => l.space === null), 'logged, with no space named');
  });

  await test('a read inside the agent\'s space goes through', async () => {
    const ctx = result(await tool(server, 'read_context', { space: S1, module: 'todo' }, T), 'read_context');
    assert.equal(ctx.isError, false, ctx.text);
    assert.equal(ctx.json.module.id, 'todo');
    const data = result(await tool(server, 'read_data', { space: S1, module: 'todo' }, T), 'read_data');
    assert.equal(data.isError, false, data.text);
    assert.ok(Array.isArray(data.json.items));
    const one = result(await tool(server, 'read_data', { space: S1, module: 'todo', key: 'task:none' }, T), 'read_data one key');
    assert.deepEqual([one.isError, one.text], [true, 'not found']);
    const kinds = result(await tool(server, 'object_kinds', { from: 'todo' }, T), 'object_kinds');
    assert.ok(Array.isArray(kinds.json.kinds));
    const search = result(await tool(server, 'search_objects', { space: S1, from: 'todo', q: 'x' }, T), 'search_objects');
    assert.equal(search.isError, false, search.text);
  });

  await test('an agent finds a saved place by name, with its pointer; never a person\'s own list or another space\'s', async () => {
    const C = { token: (await makeAgent('Finder', [S1])).token }; // its own limits, so the other tests' counts stay as they were
    ok(await call(server, 'POST', '/api/modules/bundled/maps/install', { cookie: admin, body: {} }), 'Maps installs', 201);
    ok(await call(server, 'PATCH', '/api/modules/maps', { cookie: admin, body: { enabled: true } }), 'Maps is on');
    const put = async (id, title, where, marks = where.startsWith('scope=environment') ? [S1] : []) => ok(await call(server, 'PUT', `/api/modules/maps/data/place:${id}?${where}`, { cookie: admin, body: { value: { id, title, category: 'food', type: 'winery', status: 'want', ...(marks.length ? { spaces: marks } : {}) } } }), `place ${id}`);
    await put('p1', 'Napa winery', 'scope=environment');
    await put('p2', 'Napa lodge', `scope=space&space=${S1}`);
    await put('p3', 'Napa secret', 'scope=person');
    await put('p4', 'Napa elsewhere', 'scope=environment', []);
    ok(await call(server, 'PUT', '/api/modules/maps/data/place:p5?scope=environment', { cookie: admin, body: { value: { id: 'p5', title: 'Napa for the other space', spaces: [S2] } } }), 'place p5');
    const found = result(await tool(server, 'search_objects', { space: S1, from: 'maps', kind: 'place', q: 'napa' }, C), 'search for a place');
    assert.equal(found.isError, false, found.text);
    assert.deepEqual(found.json.summaries.map((x) => x.title).sort(), ['Napa lodge', 'Napa winery'], 'this space\'s and the everyone place marked for it; not the person\'s, not an unmarked one, not another space\'s');
    const winery = found.json.summaries.find((x) => x.title === 'Napa winery');
    assert.deepEqual([winery.visit, winery.type, winery.category, winery.kind], ['want', 'winery', 'food', 'place']);
    assert.deepEqual(winery.ref, { module: 'maps', kind: 'place', id: 'p1', scope: 'environment' });
    assert.deepEqual(found.json.summaries.find((x) => x.title === 'Napa lodge').ref, { module: 'maps', kind: 'place', id: 'p2', scope: 'space', space: S1 });
    // Another module's name as `from` finds them too once it may link to places.
    const bySpace = result(await tool(server, 'search_objects', { space: S1, from: 'maps', kind: 'place', q: 'secret' }, C), 'the person\'s own');
    assert.deepEqual(bySpace.json.summaries, []);
    // The pointers resolve, and updatePlace takes them as its place: done at once by the server (Maps' actions run there,
    // plan-agent-server-actions.md step 10), the environment place with its mark for this space kept.
    const resolved = result(await tool(server, 'resolve_objects', { from: 'maps', refs: found.json.summaries.map((x) => x.ref) }, C), 'resolve');
    assert.deepEqual(resolved.json.summaries.map((x) => x.title).sort(), ['Napa lodge', 'Napa winery']);
    for (const x of found.json.summaries) {
      const asked = result(await tool(server, 'ask_for_change', { space: S1, action: 'maps:updatePlace', input: { place: x.ref, status: 'booked' } }, C), `updatePlace ${x.ref.id}`);
      assert.equal(asked.isError, false, asked.text);
      assert.deepEqual([asked.json.status, asked.json.ok], ['done', true], asked.text);
      assert.deepEqual(asked.json.ref, x.ref);
    }
    const env = (await call(server, 'GET', '/api/modules/maps/data?scope=environment', { cookie: admin })).json.items.find((i) => i.key === 'place:p1');
    assert.deepEqual([env.value.status, env.value.spaces], ['booked', [S1]]);
    // What is not for this agent's spaces is refused: resolving it as before, and a change pointing at it with the server's
    // sentence (Maps is carried by the server, so it is refused at once, never queued: GitHub #1117).
    for (const ref of [{ module: 'maps', kind: 'place', id: 'p3', scope: 'person' }, { module: 'maps', kind: 'place', id: 'p4', scope: 'environment' }, { module: 'maps', kind: 'place', id: 'p5', scope: 'environment' }]) {
      const out = result(await tool(server, 'resolve_objects', { from: 'maps', refs: [ref] }, C), `resolve ${ref.id}`);
      assert.deepEqual([out.isError, out.text], [true, "An agent can't do that."], ref.id);
      const change = result(await tool(server, 'ask_for_change', { space: S1, action: 'maps:updatePlace', input: { place: ref, status: 'booked' } }, C), `change ${ref.id}`);
      assert.deepEqual([change.isError, change.text], [true, 'A change here can only point to this space or to things kept for everyone.'], `change ${ref.id}`);
    }
    // An agent of another space sees none of them.
    const B = await makeAgent('Other', [S2]);
    assert.deepEqual(result(await tool(server, 'search_objects', { space: S2, from: 'maps', kind: 'place', q: 'napa' }, { token: B.token }), 'other agent').json.summaries.map((x) => x.title), ['Napa for the other space']);
    const there = result(await tool(server, 'search_objects', { space: S1, from: 'maps', kind: 'place' }, { token: B.token }), 'other agent, our space');
    assert.deepEqual([there.isError, there.text], [true, 'no such space']);
    const own = result(await tool(server, 'resolve_objects', { from: 'maps', refs: [winery.ref] }, { token: B.token }), 'other agent resolves');
    assert.deepEqual([own.isError, own.text], [true, "An agent can't do that."]);
  });

  await test('bad arguments are a tool error, and still a read', async () => {
    const before = await used();
    for (const [name, args, sentence] of [
      ['read_chat', {}, 'space is needed.'],
      ['read_chat', { space: 'a/b' }, 'space is not an id this server uses.'],
      ['read_chat', { space: S1, extra: 1 }, 'extra is not an argument of this tool.'],
      ['read_data', { space: S1, module: '../x' }, 'module is not an id this server uses.'],
      ['request_status', { space: S1, request: 'one' }, 'request is a whole number of 1 or more.'],
      ['object_links', { from: 'todo', ref: { scope: 'space', space: S1 }, dir: 'up' }, 'dir is one of: to, from.'],
      ['post_chat', { space: S1, text: 42 }, 'text is text.'],
    ]) {
      const out = result(await tool(server, name, args, T), `${name} ${JSON.stringify(args)}`);
      assert.deepEqual([out.isError, out.text], [true, sentence]);
    }
    const after = await used();
    assert.equal(after.reads.usedToday, before.reads.usedToday + 8, 'each counted as one read');
  });

  await test('20 writes a minute through MCP, then the gate\'s 429, every one logged', async () => {
    const W = await makeAgent('Writer', [S1]);
    ok(await call(server, 'PATCH', '/api/roles/agent', { cookie: admin, body: { chat: true } }), 'Send chat messages on for agents');
    for (let i = 0; i < 20; i += 1) {
      const out = i % 2
        ? result(await tool(server, 'post_chat', { space: S1, text: `Marker text 8812 number ${i}` }, { token: W.token }), `post ${i}`)
        : result(await tool(server, 'ask_for_change', { space: S1, action: 'todo:createTask', input: { title: `Task ${i}` } }, { token: W.token }), `ask ${i}`);
      assert.equal(out.isError, false, `write ${i}: ${out.text}`);
    }
    const over = result(await tool(server, 'post_chat', { space: S1, text: 'one more' }, { token: W.token }), 'the 21st write');
    assert.equal(over.isError, true);
    assert.match(over.text, new RegExp(`^${OVER.replace(/\./g, '\\.')} Try again in \\d+ seconds?\\.$`));
    const lines = logLines(single, W.key);
    assert.equal(lines.filter((l) => l.kind === 'write').length, 20, 'twenty writes logged');
    assert.equal(lines.filter((l) => l.status === 429).length, 1, 'the 429 noted once');
    assert.ok(lines.filter((l) => l.route === '/api/spaces/:id/chat' && l.method === 'POST' && l.status === 200).every((l) => /^[0-9a-f]{12}$/.test(l.message)), 'a post keeps its id');
    assert.ok(!fs.readFileSync(path.join(single, 'agent-log', W.key, `${dayToday()}.jsonl`), 'utf8').includes('Marker text 8812'), 'never its text');
    const chat = (await call(server, 'GET', `/api/spaces/${S1}/chat`, { cookie: admin })).json.messages.filter((m) => m.agent === true);
    assert.equal(chat.length, 10, 'ten posts, each labelled');
  });

  await test('a revoked token and Agents off are 401', async () => {
    const R = await makeAgent('Revoked', [S1]);
    result(await tool(server, 'me', {}, { token: R.token }), 'works first');
    ok(await call(server, 'DELETE', `/api/users/${R.key}/token`, { cookie: admin }), 'revoke');
    for (const r of [await tool(server, 'me', {}, { token: R.token }), await rpc(server, 'initialize', { protocolVersion: '2025-06-18' }, { token: R.token }), await call(server, 'GET', '/mcp', { token: R.token })]) {
      assert.equal(r.status, 401);
      assert.equal(r.json.error, INVALID);
      assert.match(r.headers['www-authenticate'], CHALLENGE);
    }
    const O = await makeAgent('Off', [S1]);
    ok(await call(server, 'PATCH', `/api/users/${O.key}`, { cookie: admin, body: { off: true } }), 'turned off');
    assert.equal((await tool(server, 'me', {}, { token: O.token })).status, 401, 'a turned-off agent');
    ok(await call(server, 'PATCH', '/api/settings', { cookie: admin, body: { agents: false } }), 'Agents off');
    const r = await tool(server, 'me', {}, T);
    assert.equal(r.status, 401);
    assert.equal(r.json.error, INVALID);
    assert.match(r.headers['www-authenticate'], CHALLENGE);
    ok(await call(server, 'PATCH', '/api/settings', { cookie: admin, body: { agents: true } }), 'Agents on again');
    assert.equal(result(await tool(server, 'me', {}, T), 'back').isError, false);
  });

  await test('a person\'s session is refused, nobody is 401, and no other credential is read', async () => {
    const miaC = await signIn(server, 'mia', 'mia-password-1');
    for (const cookie of [admin, miaC]) {
      const r = await tool(server, 'me', {}, { cookie });
      assert.equal(r.status, 403, 'a cookie session');
      assert.equal(r.json.error, ONLY_AGENTS);
      assert.equal((await call(server, 'GET', '/mcp', { cookie })).status, 403, 'GET with a cookie');
    }
    const none = await tool(server, 'me', {});
    assert.equal(none.status, 401);
    assert.equal(none.json.error, ONLY_AGENTS);
    assert.match(none.headers['www-authenticate'], CHALLENGE);
    const query = await call(server, 'POST', `/mcp?token=${A.token}&access_token=${A.token}`, { body: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    assert.equal(query.status, 401, 'a token in the query string');
    const form = await call(server, 'POST', '/mcp', { raw: Buffer.from(`token=${A.token}`), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(form.status, 401, 'a token in a form');
    // The token wins over a cookie: the agent's answer, never the person's.
    const both = result(await tool(server, 'me', {}, { ...T, cookie: admin }), 'token and cookie');
    assert.equal(both.json.agent.key, A.key);
  });

  await test('GET /mcp is 405; protocol errors', async () => {
    const P = await makeAgent('Protocol', [S1]); // its own limits: the agent above has used most of its minute
    const T = { token: P.token };
    const get = await call(server, 'GET', '/mcp', T);
    assert.equal(get.status, 405);
    assert.equal(get.headers.allow, 'POST');
    assert.equal(typeof get.json.error, 'string');
    assert.equal((await call(server, 'DELETE', '/mcp', T)).status, 403, 'DELETE is refused by the gate');
    rpcError(await rpc(server, 'resources/list', {}, T), 200, -32601, 'an unknown method');
    rpcError(await rpc(server, 'tools/call', { name: 'delete_everything', arguments: {} }, T), 200, -32602, 'an unknown tool');
    const before = await used(P);
    const bad = await call(server, 'POST', '/mcp', { ...T, raw: Buffer.from('{"jsonrpc": "2.0", "id": 1, "method": '), headers: { 'content-type': 'application/json' } });
    rpcError(bad, 400, -32700, 'bad JSON');
    assert.equal(bad.json.id, null);
    assert.equal((await used(P)).reads.usedToday, before.reads.usedToday + 2, 'bad JSON is counted');
    assert.ok(logLines(single, P.key).some((l) => l.route === '/mcp' && l.status === 400), `and logged: ${JSON.stringify(logLines(single, P.key).slice(-3))}`);
    rpcError(await call(server, 'POST', '/mcp', { ...T, body: [{ jsonrpc: '2.0', id: 1, method: 'ping' }] }), 400, -32600, 'a batch');
    rpcError(await call(server, 'POST', '/mcp', { ...T, body: { id: 1, method: 'ping' } }), 400, -32600, 'no jsonrpc');
    rpcError(await call(server, 'POST', '/mcp', { ...T, body: { jsonrpc: '2.0', id: { x: 1 }, method: 'ping' } }), 400, -32600, 'an object id');
    rpcError(await call(server, 'POST', '/mcp', { ...T, raw: Buffer.from('{"jsonrpc":"2.0","id":1,"method":"ping"}'), headers: { 'content-type': 'text/plain' } }), 400, -32700, 'not application/json');
    rpcError(await rpc(server, 'ping', undefined, { ...T, headers: { 'mcp-protocol-version': '1999-01-01' } }), 400, -32600, 'an unknown protocol version');
    assert.equal((await rpc(server, 'ping', undefined, { ...T, headers: { 'mcp-protocol-version': '2025-11-25' } })).status, 200, 'a known one');
    const site = await rpc(server, 'ping', undefined, { ...T, headers: { origin: 'https://evil.example' } });
    assert.equal(site.status, 403, 'another site');
    const siteTool = await tool(server, 'me', {}, { ...T, headers: { origin: 'https://evil.example' } });
    assert.equal(siteTool.status, 403, 'another site, a tool call');
    assert.equal((await rpc(server, 'ping', undefined, { ...T, headers: { origin: `http://127.0.0.1:${server.port}` } })).status, 200, 'this site');
    const big = await tool(server, 'post_chat', { space: S1, text: 'x'.repeat(70 * 1024) }, T);
    rpcError(big, 413, -32600, 'a body over 64 KB');
  });

  await test('the console says why a request to /mcp was turned away, once a minute, never with the token', async () => {
    const L = await makeAgent('Logger', [S1]);
    const ua = { 'user-agent': 'mcp-log-check/1 (flood)' };
    const mark = server.out.length;
    const lines = () => server.out.slice(mark).split('\n').filter((l) => l.startsWith('MCP'));
    const ping = { jsonrpc: '2.0', id: 1, method: 'ping' };
    const bad = `${L.token.slice(0, -1)}${L.token.endsWith('x') ? 'y' : 'x'}`;
    const flood = [];
    for (let i = 0; i < 5; i += 1) flood.push((await call(server, 'POST', '/mcp', { body: ping, headers: ua })).status);
    assert.deepEqual(flood, [401, 401, 401, 401, 401]);
    const scheme = await call(server, 'POST', '/mcp', { body: ping, headers: { ...ua, authorization: 'Basic dXNlcjpwYXNz' } });
    assert.equal(scheme.status, 401);
    assert.equal((await call(server, 'POST', '/mcp', { body: ping, token: bad, headers: ua })).status, 401);
    assert.equal((await call(server, 'POST', '/mcp', { body: ping, token: bad, headers: ua })).status, 401);
    // With a good token: a wrong content type, an unknown protocol version, a body that is not JSON-RPC.
    assert.equal((await call(server, 'POST', '/mcp', { token: L.token, raw: Buffer.from('x'), headers: { ...ua, 'content-type': 'text/plain' } })).status, 400);
    assert.equal((await call(server, 'POST', '/mcp', { token: L.token, body: ping, headers: { ...ua, 'mcp-protocol-version': '1999-01-01' } })).status, 400);
    assert.equal((await call(server, 'POST', '/mcp', { token: L.token, body: { hello: 1 }, headers: ua })).status, 400);
    assert.equal((await call(server, 'POST', '/mcp', { token: L.token, raw: Buffer.from('{nope'), headers: ua })).status, 400);
    assert.equal((await call(server, 'GET', '/mcp', { token: L.token, headers: ua })).status, 405);
    assert.equal((await call(server, 'GET', '/mcp', { token: L.token, headers: ua })).status, 405);
    const refusals = lines().filter((l) => l.includes('refused') || l.includes('405'));
    const one = (reason) => {
      const hit = refusals.filter((l) => l.includes(reason));
      assert.equal(hit.length, 1, `one line for "${reason}", got ${hit.length}:\n${refusals.join('\n')}`);
      return hit[0];
    };
    assert.match(one('no Authorization header'), /^MCP: POST \/mcp refused: no Authorization header \(client unknown, User-Agent mcp-log-check\/1 \(flood\), environment single\)\.$/);
    one('Authorization is not a Bearer token');
    one('token is not known or has expired or was turned off');
    one('wrong Content-Type');
    assert.match(one('unsupported protocol version 1999-01-01'), /environment single/);
    one('body is not valid JSON-RPC');
    one('GET /mcp answered 405 (no stream)');
    assert.equal(refusals.length, 7, `seven lines in all:\n${refusals.join('\n')}`);
    // A success note once an hour per client, with the agent's key.
    const hello = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'logcheck\u001b[0m', version: '9.9' } };
    ok(await rpc(server, 'initialize', hello, { token: L.token, headers: ua }), 'initialize');
    ok(await rpc(server, 'initialize', hello, { token: L.token, headers: ua }), 'initialize again');
    const notes = lines().filter((l) => l.includes('connected as an agent'));
    assert.equal(notes.length, 1, `one success note:\n${notes.join('\n')}`);
    assert.match(notes[0], new RegExp(`^MCP client logcheck.\\[0m 9\\.9 connected as an agent \\(agent key ${L.key};`));
    const all = server.out.slice(mark);
    assert.ok(!all.includes(L.token) && !all.includes(bad) && !all.includes('dXNlcjpwYXNz'), 'no token or header value in the output');
    assert.ok(!/[\u0000-\u0008\u001b]/.test(all), 'no control characters');
  });

  await server.stop();

  // --- AGENT_TOKENS off: /mcp is an unknown path, as before ----------------------------------------------------------
  await test('with AGENT_TOKENS off, /mcp answers as any unknown path', async () => {
    const off = await startServer(path.join(base, 'off'), { ADMIN_PASSWORD: 'admin-password-1' });
    const offAdmin = await signIn(off, 'admin', 'admin-password-1');
    for (const [method, body] of [['POST', { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }], ['GET', undefined]]) {
      for (const cookie of [undefined, offAdmin]) {
        const r = await call(off, method, '/mcp', { body, cookie, token: cookie ? undefined : 'agt_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
        const unknown = await call(off, method, '/no-such-path-5521', { body, cookie, token: cookie ? undefined : 'agt_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
        assert.equal(r.status, unknown.status, `${method} ${cookie ? 'signed in' : 'a token'}: ${r.status} ${r.text.slice(0, 100)}`);
        assert.ok(!r.text.includes('jsonrpc'), 'no JSON-RPC answer');
      }
    }
    await off.stop();
  });

  // --- the set-up agent's tools (plan-admin-agent.md, step 3) --------------------------------------------------------
  const setupDir = path.join(base, 'setup');
  const setupServer = await startServer(setupDir, { ...onEnv, AGENT_SETUP: 'true' });
  {
    const server = setupServer;
    const admin = await signIn(server, 'admin', 'admin-password-1');
    ok(await call(server, 'PATCH', '/api/settings', { cookie: admin, body: { agents: true, setupAgents: true } }), 'Agents and Set-up agents on');
    ok(await call(server, 'POST', '/api/users', { cookie: admin, body: { login: 'olga', displayName: 'Olga', password: 'olga-password-1', role: 'owner' } }), 'an owner', 201);
    const olga = await signIn(server, 'olga', 'olga-password-1');
    const olgaKey = (await call(server, 'GET', '/api/users', { cookie: admin })).json.users.find((u) => u.login === 'olga').key;
    const mia = (await call(server, 'POST', '/api/users', { cookie: admin, body: { login: 'mia', displayName: 'Mia', password: 'mia-password-1', role: 'member' } })).json.user;
    const tom = (await call(server, 'POST', '/api/users', { cookie: admin, body: { login: 'tom', displayName: 'Tom', password: 'tom-password-1', role: 'member' } })).json.user;
    const madeAgent = async (body) => {
      const user = (await call(server, 'POST', '/api/users', { cookie: admin, body: { agent: true, ...body } })).json.user;
      const token = (await call(server, 'POST', `/api/users/${user.key}/token`, { cookie: admin })).json.token;
      return { key: user.key, token, T: { token } };
    };
    const S = await madeAgent({ kind: 'setup', displayName: 'Builder' });
    const theirs = (await call(server, 'POST', '/api/spaces', { cookie: admin, body: { name: 'Theirs', members: [mia.key] } })).json.space.id;
    const O = await madeAgent({ displayName: 'Reader' });
    const sp = (await call(server, 'GET', `/api/spaces/${theirs}`, { cookie: admin })).json.space;
    ok(await call(server, 'PATCH', `/api/spaces/${theirs}`, { cookie: admin, body: { members: [...sp.members, O.key] } }), 'the ordinary agent joins');
    const column = (body) => call(server, 'PATCH', '/api/roles/setup', { cookie: admin, body });
    const usedBy = async (who) => (await call(server, 'GET', '/api/agent/me', who.T)).json.limits;
    let made = null;
    let template = null;

    await test('set-up agent: tools/list is exactly its own tools; initialize says what it is', async () => {
      const r = await rpc(server, 'tools/list', {}, S.T);
      ok(r, 'tools/list');
      const tools = r.json.result.tools;
      assert.deepEqual(tools.map((t) => t.name), SETUP_TOOL_NAMES);
      for (const t of tools) {
        assert.equal(t.inputSchema.type, 'object', `${t.name}: inputSchema`);
        assert.equal(t.inputSchema.additionalProperties, false, `${t.name}: no other argument`);
        for (const k of t.inputSchema.required) assert.ok(Object.hasOwn(t.inputSchema.properties, k), `${t.name}: ${k} is a property`);
        assert.ok(t.description.length > 20 && t.description.length < 600, `${t.name}: a short description`);
        assert.equal('plan' in t, false);
        assert.equal('routeChecks' in t, false);
        const words = [t.title, t.description, ...Object.values(t.inputSchema.properties).map((p) => p.description)].join(' ').toLowerCase();
        for (const old of ['room', 'table', 'stage', 'pane', 'tenant', 'item', 'card']) assert.doesNotMatch(words, new RegExp(`\\b${old}s?\\b`), `${t.name} says ${old}`);
      }
      for (const name of ['make_space', 'change_space', 'ask_owner']) assert.equal(tools.find((t) => t.name === name).annotations.readOnlyHint, false, `${name} writes`);
      assert.match(tools.find((t) => t.name === 'ask_owner').description, /until an owner says yes/);
      assert.deepEqual(tools.find((t) => t.name === 'ask_owner').inputSchema.properties.ask.enum, ['add', 'remove', 'moderator']);
      const init = await rpc(server, 'initialize', { protocolVersion: '2025-06-18' }, S.T);
      assert.match(init.json.result.instructions, /^You are a set-up agent/);
      assert.match((await rpc(server, 'initialize', { protocolVersion: '2025-06-18' }, O.T)).json.result.instructions, /^You are an agent/);
      const theirTools = (await rpc(server, 'tools/list', {}, O.T)).json.result.tools.map((t) => t.name);
      assert.deepEqual(theirTools, TOOL_NAMES, 'the ordinary agent\'s tools are unchanged');
      for (const name of SETUP_TOOL_NAMES.filter((x) => x !== 'me' && x !== 'ask_status')) assert.ok(!theirTools.includes(name), `the ordinary agent is not listed ${name}`); // ask_status is both kinds'
    });

    await test('set-up agent: an unticked row is the gate\'s 403 as a tool error; the reads go', async () => {
      for (const [name, args] of [['make_space', { name: 'Nope', template: 'x' }], ['list_people', {}], ['ask_owner', { space: theirs, ask: 'add', person: mia.key }]]) {
        const out = result(await tool(server, name, args, S.T), name);
        assert.deepEqual([out.isError, out.text], [true, name === 'ask_owner' ? 'no such space' : CANT], `${name}: ${out.text}`);
      }
      const me = result(await tool(server, 'me', {}, S.T), 'me');
      assert.deepEqual([me.json.kind, me.json.spaces, me.json.permissions, me.json.asks], ['setup', [], [], []]);
      const direct = (await call(server, 'GET', '/api/agent/me', S.T)).json;
      assert.equal(direct.limits.reads.usedToday, me.json.limits.reads.usedToday + 1, 'me counted as one read');
      const { limits: _a, ...meRest } = me.json;
      const { limits: _b, ...directRest } = direct;
      assert.deepEqual(meRest, directRest, 'me is GET /api/agent/me');
      const templates = result(await tool(server, 'list_templates', {}, S.T), 'list_templates');
      assert.deepEqual(templates.json, (await call(server, 'GET', '/api/agent/templates', S.T)).json);
      template = templates.json.templates[0].id;
      const icons = result(await tool(server, 'list_icons', {}, S.T), 'list_icons');
      assert.ok(Array.isArray(icons.json.icons) && icons.json.icons.length > 0, 'icons');
      assert.ok(!(await call(server, 'GET', '/api/spaces', { cookie: admin })).json.spaces.some((x) => x.name === 'Nope'), 'nothing made');
      ok(await column({ agentMakeSpaces: true, agentChangeSpaces: true, agentAskPeople: true }), 'all three ticked');
    });

    await test('set-up agent: each tool does what its route does, counted and logged as that route', async () => {
      let before = await usedBy(S);
      const out = result(await tool(server, 'make_space', { name: 'Lisbon Secret 7731', template, description: 'Hidden words 4410' }, S.T), 'make_space');
      assert.equal(out.isError, false, out.text);
      made = out.json.space;
      assert.equal(made.name, 'Lisbon Secret 7731');
      const space = (await call(server, 'GET', `/api/spaces/${made.id}`, { cookie: admin })).json.space;
      assert.equal(space.madeBy, S.key, 'marked as made by it');
      assert.ok(space.members.includes(S.key), 'it joins');
      let after = await usedBy(S);
      assert.deepEqual([after.writes.usedToday, after.made.usedToday], [before.writes.usedToday + 1, before.made.usedToday + 1], 'one write, one made');

      const icon = result(await tool(server, 'list_icons', {}, S.T), 'icons').json.icons[0];
      const changed = result(await tool(server, 'change_space', { space: made.id, name: 'Lisbon Secret 7732', icon }, S.T), 'change_space');
      assert.equal(changed.isError, false, changed.text);
      assert.deepEqual([changed.json.space.name, changed.json.space.icon], ['Lisbon Secret 7732', icon]);
      before = after;
      after = await usedBy(S);
      assert.deepEqual([after.writes.usedToday, after.changes.usedToday], [before.writes.usedToday + 1, before.changes.usedToday + 1], 'one write, one change');

      const people = result(await tool(server, 'list_people', {}, S.T), 'list_people');
      assert.deepEqual(people.json, (await call(server, 'GET', '/api/agent/people', S.T)).json);
      assert.deepEqual(people.json.people.map((p) => p.name).sort(), ['Mia', 'Tom'], 'members only');

      const asked = result(await tool(server, 'ask_owner', { space: made.id, ask: 'add', person: mia.key }, S.T), 'ask_owner');
      assert.equal(asked.isError, false, asked.text);
      assert.equal(asked.json.ask.state, 'waiting');
      assert.ok(!(await call(server, 'GET', `/api/spaces/${made.id}`, { cookie: admin })).json.space.members.includes(mia.key), 'nothing changes yet');
      const bell = (await call(server, 'GET', '/api/notifications', { cookie: olga })).json.notifications;
      assert.equal(bell.filter((x) => x.title === 'Builder (set-up agent) asks to add Mia to Lisbon Secret 7732.').length, 1, `one bell line for an owner: ${JSON.stringify(bell.map((x) => x.title))}`);
      const status = result(await tool(server, 'ask_status', { id: asked.json.ask.id }, S.T), 'ask_status');
      assert.deepEqual(status.json, (await call(server, 'GET', `/api/agent/asks/${asked.json.ask.id}`, S.T)).json);
      assert.deepEqual([status.json.ask.state, status.json.ask.person, status.json.ask.space], ['waiting', mia.key, made.id]);
      const mod = result(await tool(server, 'ask_owner', { space: made.id, ask: 'moderator', person: mia.key, on: true }, S.T), 'ask_owner moderator');
      assert.deepEqual([mod.isError, mod.text], [true, 'They are not in this space.'], 'the route\'s own check');
      const me = result(await tool(server, 'me', {}, S.T), 'me');
      assert.deepEqual(me.json.spaces, [{ id: made.id, name: 'Lisbon Secret 7732' }]);
      assert.deepEqual(me.json.asks.map((a) => a.id), [asked.json.ask.id]);

      const lines = logLines(setupDir, S.key);
      const ofRoute = (route, method) => lines.filter((l) => l.route === route && l.method === method && l.status < 300);
      assert.deepEqual(ofRoute('/api/agent/spaces', 'POST').map((l) => [l.kind, l.change, l.space]), [['write', 'made', made.id]]);
      assert.deepEqual(ofRoute('/api/agent/spaces/:id', 'PATCH').map((l) => [l.kind, l.change, l.space]), [['write', 'renamed,icon', made.id]]);
      assert.deepEqual(ofRoute('/api/agent/spaces/:id/asks', 'POST').map((l) => [l.kind, l.change, l.space]), [['write', 'ask:add', made.id]]);
      for (const route of ['/api/agent/templates', '/api/agent/icons', '/api/agent/people', '/api/agent/asks/:id', '/api/agent/me']) assert.ok(ofRoute(route, 'GET').every((l) => l.kind === 'read') && ofRoute(route, 'GET').length > 0, `${route} logged as a read`);
      assert.ok(!lines.some((l) => l.route === '/mcp' && l.status === 200 && l.kind === 'write'), 'no tool call logged twice');
      const raw = fs.readFileSync(path.join(setupDir, 'agent-log', S.key, `${dayToday()}.jsonl`), 'utf8');
      for (const words of ['Lisbon Secret', 'Hidden words', 'Mia', S.token, 'tools/call']) assert.ok(!raw.includes(words), `"${words.slice(0, 20)}" is not in the log`);
    });

    await test('set-up agent: the route\'s sentences come back as tool errors', async () => {
      for (const [name, args, sentence] of [
        ['make_space', { name: 'X', template: 'no-such-template' }, 'That template is not one this environment offers.'],
        ['make_space', { name: 'X', template, icon: 'no-such-icon' }, 'That icon is not one this environment offers.'],
        ['make_space', { name: 42, template }, 'name is text.'],
        ['make_space', { template }, 'A space needs a name.'],
        ['make_space', { name: 'X', template, members: [mia.key] }, 'members is not an argument of this tool.'],
        ['change_space', { space: made.id }, 'Send at least one of name, description or icon.'],
        ['change_space', { space: theirs, name: 'Mine now' }, 'no such space'],
        ['change_space', { space: 'a/b', name: 'x' }, 'space is not an id this server uses.'],
        ['ask_owner', { space: made.id, ask: 'promote', person: tom.key }, 'ask is one of: add, remove, moderator.'],
        ['ask_owner', { space: made.id, ask: 'add', person: 42 }, "person is a person's key, from the people list."],
        ['ask_owner', { space: made.id, ask: 'add', person: olgaKey }, 'An agent can only ask to add a member of this environment.'],
        ['ask_owner', { space: made.id, ask: 'add', person: O.key }, 'An agent can only ask to add a member of this environment.'],
        ['ask_owner', { space: made.id, ask: 'moderator', person: tom.key, on: 'yes' }, 'on is true or false: tick or untick them as moderator.'],
        ['ask_owner', { space: theirs, ask: 'add', person: tom.key }, 'no such space'],
        ['ask_status', { id: 'nosuchask1' }, 'No such ask.'],
      ]) {
        const out = result(await tool(server, name, args, S.T), `${name} ${JSON.stringify(args)}`);
        assert.deepEqual([out.isError, out.text], [true, sentence], `${name} ${JSON.stringify(args)}`);
      }
      assert.equal((await call(server, 'GET', `/api/spaces/${theirs}`, { cookie: admin })).json.space.name, 'Theirs', 'a space it did not make is untouched');
    });

    await test('an ordinary agent can\'t call the set-up tools, nor a set-up agent a module or Chat tool', async () => {
      const spaces = (await call(server, 'GET', '/api/spaces', { cookie: admin })).json.spaces.length;
      for (const [name, args] of [['make_space', { name: 'Sneaky', template }], ['change_space', { space: theirs, name: 'Sneaky' }], ['list_people', {}], ['list_templates', {}], ['ask_owner', { space: theirs, ask: 'add', person: tom.key }]]) {
        rpcError(await tool(server, name, args, O.T), 200, -32602, `the ordinary agent: ${name}`);
      }
      // ask_status is both kinds' (plan-agent-edit-delete.md, step 6): each reads only its own asks.
      const own = result(await tool(server, 'ask_status', { id: 'abc' }, O.T), 'the ordinary agent: ask_status');
      assert.deepEqual([own.isError, own.text], [true, 'No such ask.']);
      rpcError(await tool(server, 'ask_to_delete', { space: made.id, object: { module: 'todo', kind: 'task', id: 'x', scope: 'space', space: made.id } }, S.T), 200, -32602, 'the set-up agent: ask_to_delete');
      for (const [name, args] of [['read_chat', { space: made.id }], ['post_chat', { space: made.id, text: 'hi' }], ['read_data', { space: made.id, module: 'todo' }], ['list_actions', { space: made.id }], ['ask_for_change', { space: made.id, action: 'todo:createTask', input: { title: 'x' } }], ['list_members', { space: made.id }], ['read_context', { space: made.id, module: 'todo' }], ['search_objects', { space: made.id, from: 'todo' }], ['object_kinds', { from: 'todo' }]]) {
        rpcError(await tool(server, name, args, S.T), 200, -32602, `the set-up agent: ${name}`);
      }
      assert.equal((await call(server, 'GET', '/api/spaces', { cookie: admin })).json.spaces.length, spaces, 'no space made');
      assert.ok(!(await call(server, 'GET', `/api/spaces/${made.id}/chat`, { cookie: admin })).json.messages.some((m) => m.text === 'hi'), 'nothing posted');
      assert.equal(result(await tool(server, 'list_members', { space: theirs }, O.T), 'the ordinary agent still has its own').isError, false);
    });

    await test('set-up agent: the daily cap is the route\'s 429 as a tool error; Set-up agents off is 401', async () => {
      const C = await madeAgent({ kind: 'setup', displayName: 'Capped' });
      for (let i = 0; i < 5; i += 1) assert.equal(result(await tool(server, 'make_space', { name: `Cap ${i}`, template }, C.T), `make ${i}`).isError, false);
      const over = result(await tool(server, 'make_space', { name: 'One more', template }, C.T), 'the sixth');
      assert.equal(over.isError, true);
      assert.match(over.text, /^This agent has made as many spaces as it may today\. Try again in \d+ seconds?\.$/);
      assert.equal(logLines(setupDir, C.key).filter((l) => l.route === '/api/agent/spaces' && l.status === 429).length, 1, 'the 429 logged as the route');
      ok(await call(server, 'PATCH', '/api/settings', { cookie: admin, body: { setupAgents: false } }), 'Set-up agents off');
      for (const r of [await tool(server, 'me', {}, S.T), await rpc(server, 'tools/list', {}, S.T)]) {
        assert.equal(r.status, 401);
        assert.equal(r.json.error, INVALID);
        assert.match(r.headers['www-authenticate'], CHALLENGE);
      }
      assert.equal(result(await tool(server, 'me', {}, O.T), 'the ordinary agent is unchanged').isError, false);
      ok(await call(server, 'PATCH', '/api/settings', { cookie: admin, body: { setupAgents: true } }), 'Set-up agents on again');
    });
  }
  await setupServer.stop();

  // --- hosted: each environment its own ------------------------------------------------------------------------------
  await test('hosted: a tool call runs in the environment it was sent to; a token of one is 401 at another', async () => {
    const hosted = await startServer(path.join(base, 'hosted'), { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'boss', ADMIN_PASSWORD: 'host-password-1', AGENT_TOKENS: 'true', AGENT_SETUP: 'true' });
    const host = await signIn(hosted, 'boss', 'host-password-1', 'admin');
    for (const slug of ['acme', 'beta']) ok(await call(hosted, 'POST', '/api/host/environments', { host: 'admin', cookie: host, body: { slug, name: slug, owner: { login: 'owner', password: 'owner-password-1' } } }), `${slug} made`, 201);
    const acme = await signIn(hosted, 'owner', 'owner-password-1', 'acme');
    const beta = await signIn(hosted, 'owner', 'owner-password-1', 'beta');
    for (const [slug, cookie] of [['acme', acme], ['beta', beta]]) ok(await call(hosted, 'PATCH', '/api/settings', { host: slug, cookie, body: { agents: true } }), `${slug} Agents on`);
    const agent = (await call(hosted, 'POST', '/api/users', { host: 'acme', cookie: acme, body: { agent: true } })).json.user;
    const space = (await call(hosted, 'POST', '/api/spaces', { host: 'acme', cookie: acme, body: { name: 'Plans', members: [agent.key] } })).json.space.id;
    const token = (await call(hosted, 'POST', `/api/users/${agent.key}/token`, { host: 'acme', cookie: acme })).json.token;
    const me = result(await tool(hosted, 'me', {}, { host: 'acme', token }), 'me at acme');
    assert.deepEqual(me.json.spaces, [{ id: space, name: 'Plans' }]);
    assert.equal(result(await tool(hosted, 'read_chat', { space }, { host: 'acme', token }), 'read at acme').isError, false);
    assert.equal(logLines(path.join(base, 'hosted', 'environments', 'acme'), agent.key).filter((l) => l.route === '/api/spaces/:id/chat').length, 1, 'logged at acme');
    const there = await tool(hosted, 'read_chat', { space }, { host: 'beta', token });
    assert.equal(there.status, 401);
    assert.equal(there.json.error, INVALID);
    // A set-up agent's token of acme is 401 at beta too, and its tools run at acme.
    ok(await call(hosted, 'PATCH', '/api/settings', { host: 'acme', cookie: acme, body: { setupAgents: true } }), 'acme Set-up agents on');
    ok(await call(hosted, 'PATCH', '/api/settings', { host: 'beta', cookie: beta, body: { setupAgents: true } }), 'beta Set-up agents on');
    const setup = (await call(hosted, 'POST', '/api/users', { host: 'acme', cookie: acme, body: { agent: true, kind: 'setup' } })).json.user;
    const setupToken = (await call(hosted, 'POST', `/api/users/${setup.key}/token`, { host: 'acme', cookie: acme })).json.token;
    assert.deepEqual((await rpc(hosted, 'tools/list', {}, { host: 'acme', token: setupToken })).json.result.tools.map((t) => t.name), SETUP_TOOL_NAMES);
    assert.equal(result(await tool(hosted, 'me', {}, { host: 'acme', token: setupToken }), 'set-up me at acme').json.kind, 'setup');
    for (const r of [await tool(hosted, 'list_templates', {}, { host: 'beta', token: setupToken }), await rpc(hosted, 'tools/list', {}, { host: 'beta', token: setupToken })]) {
      assert.equal(r.status, 401, 'a set-up token of acme at beta');
      assert.equal(r.json.error, INVALID);
    }
    assert.equal((await call(hosted, 'POST', '/mcp', { host: 'admin', token, body: { jsonrpc: '2.0', id: 1, method: 'ping' } })).json?.jsonrpc, undefined, 'the host console has no /mcp');
    await hosted.stop();
  });
} catch (err) {
  failed += 1;
  console.error(err.stack || err);
} finally {
  await Promise.all(servers.map((s) => s.stop()));
  fs.rmSync(base, { recursive: true, force: true });
}

if (failed) {
  console.error(`check-mcp: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-mcp: ${n} passed`);
