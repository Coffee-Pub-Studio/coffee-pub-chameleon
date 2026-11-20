#!/usr/bin/env node
/*
 * check-mcp.mjs -- the MCP door for agents (server/mcp.js; Thomas, 2026-11-20), against real servers on throwaway
 * DATA_DIRs, through real HTTP:
 *   - initialize negotiates 2025-03-26, 2025-06-18 and 2025-11-25 (an unknown version gets the newest), with no session;
 *     notifications/initialized is 202; ping; tools/list has every tool, each with an object inputSchema and words in
 *     the product's names;
 *   - tools/call me answers what GET /api/agent/me answers; a tool call counts once, as the route it wraps (a read, or a
 *     write for ask_for_change and post_chat), and is logged as that route, with the address the call came from; every
 *     other message on /mcp is one read, logged as /mcp;
 *   - a space the agent is not in is refused (the route's own 404 sentence, as a tool error), and so are bad arguments;
 *   - 20 writes a minute, then the gate's 429 sentence as a tool error, every write in the log, no text in it;
 *   - a revoked token, and Agents turned off, are 401 with WWW-Authenticate: Bearer; a person's session (a cookie) is
 *     refused, nobody is 401, and a token in the query string is not read;
 *   - GET /mcp is 405 (Allow: POST); an unknown method -32601, an unknown tool -32602, bad JSON -32700 (counted and logged),
 *     a batch, the wrong content type, an unknown MCP-Protocol-Version, another site's Origin and a body over 64 KB refused;
 *   - with AGENT_TOKENS off, /mcp answers as any unknown path did before;
 *   - hosted (BASE_DOMAIN): a tool call runs in the environment it was sent to; a token of one is 401 at another.
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
const TOOL_NAMES = ['me', 'read_context', 'read_data', 'search_objects', 'object_links', 'object_kinds', 'resolve_objects', 'list_members', 'list_actions', 'ask_for_change', 'request_status', 'read_chat', 'post_chat'];
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

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-mcp-'));
const single = path.join(base, 'single');
const onEnv = { ADMIN_PASSWORD: 'admin-password-1', AGENT_TOKENS: 'true' };

try {
  const server = await startServer(single, onEnv);
  const admin = await signIn(server, 'admin', 'admin-password-1');
  ok(await call(server, 'PATCH', '/api/settings', { cookie: admin, body: { agents: true } }), 'Agents on');
  ok(await call(server, 'POST', '/api/modules', { cookie: admin, raw: buildModule(path.join(ROOT, 'modules', 'todo')).zip, headers: { 'content-type': 'application/zip' } }), 'the To-do installs', 201);
  ok(await call(server, 'PATCH', '/api/modules/todo', { cookie: admin, body: { enabled: true } }), 'the To-do is on');
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
    assert.match(tools.find((t) => t.name === 'ask_for_change').description, /waits/, 'ask_for_change says it waits for a person');
    assert.match(tools.find((t) => t.name === 'post_chat').description, /Post in Chat/, 'post_chat says it needs Post in Chat');
  });

  await test('tools/call me answers what GET /api/agent/me does', async () => {
    const me = result(await tool(server, 'me', {}, T), 'me');
    assert.equal(me.isError, false);
    assert.equal(me.json.agent.key, A.key);
    assert.deepEqual(me.json.spaces, [{ id: S1, name: 'Camp' }]);
    assert.equal(me.json.chatPost, false);
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

  await test('a tool call counts once, as its route, and is logged as that route', async () => {
    const before = await used();
    result(await tool(server, 'read_chat', { space: S1 }, T), 'read_chat');
    result(await tool(server, 'list_actions', { space: S1 }, T), 'list_actions');
    let after = await used();
    assert.equal(after.reads.usedToday, before.reads.usedToday + 3, 'two tool reads and the me');
    assert.equal(after.writes.usedToday, before.writes.usedToday);
    const asked = result(await tool(server, 'ask_for_change', { space: S1, action: 'todo:createTask', input: { title: 'Secret title 5521' } }, T), 'ask_for_change');
    assert.equal(asked.isError, false, asked.text);
    assert.equal(asked.json.status, 'pending');
    const status = result(await tool(server, 'request_status', { space: S1, request: asked.json.id }, T), 'request_status');
    assert.equal(status.json.status, 'pending');
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
    ok(await call(server, 'PATCH', `/api/users/${W.key}`, { cookie: admin, body: { chatPost: true } }), 'Post in Chat on');
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
      assert.equal(r.headers['www-authenticate'], 'Bearer');
    }
    const O = await makeAgent('Off', [S1]);
    ok(await call(server, 'PATCH', `/api/users/${O.key}`, { cookie: admin, body: { off: true } }), 'turned off');
    assert.equal((await tool(server, 'me', {}, { token: O.token })).status, 401, 'a turned-off agent');
    ok(await call(server, 'PATCH', '/api/settings', { cookie: admin, body: { agents: false } }), 'Agents off');
    const r = await tool(server, 'me', {}, T);
    assert.equal(r.status, 401);
    assert.equal(r.json.error, INVALID);
    assert.equal(r.headers['www-authenticate'], 'Bearer');
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
    assert.equal(none.headers['www-authenticate'], 'Bearer');
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

  // --- hosted: each environment its own ------------------------------------------------------------------------------
  await test('hosted: a tool call runs in the environment it was sent to; a token of one is 401 at another', async () => {
    const hosted = await startServer(path.join(base, 'hosted'), { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'boss', ADMIN_PASSWORD: 'host-password-1', AGENT_TOKENS: 'true' });
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
