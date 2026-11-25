#!/usr/bin/env node
/*
 * check-agent-chat.mjs -- an agent in Chat (documentation/plans/plan-agent-access.md, step 5: decisions 13 and 17 to 19, as
 * changed by plan-agent-matrix.md), against real servers on throwaway DATA_DIRs:
 *   - Send chat messages (`chat` in the Roles grid's Agent column, settings.roles.agent) is off for a new environment: a
 *     post is 403 "An agent can't do that." from the gate; an owner ticks it (PATCH /api/roles/agent { chat }), a member
 *     and the agent can't; GET /api/agent/me's `permissions` says so; `chatPost` is gone: sent to PATCH /api/users it does
 *     nothing, and one in app.json is dropped;
 *   - a post lands as an ordinary public message with `agent: true`, set from the account and never from the name or the
 *     request: an agent renamed like a person is still labelled, a person named like the agent (or sending `agent: true`)
 *     is not, and a hand-made chat.json can't label a person's message; the live stream carries the flag;
 *   - { text } only, cleaned as a person's message, at most 1000 characters (refused, not cut);
 *   - a post is a write in the agent's budget (20 a minute), and a read reply a read;
 *   - the log: a post's line keeps its message id, a read's how many messages it carried, never any text;
 *   - reading: public messages only (a private one never), newest first, 100 a reply, older ones by `before`; works with
 *     Send chat messages off; a space it is not in (and the Lobby) is 404; without the Agent column's `chatRead` a read is
 *     403, without its `chat` a post is 403, and the member column no longer changes either;
 *   - no live stream, no deleting, hiding, pictures, Keep, previews or private messages: 403;
 *   - Send chat messages off stops posting only: its action requests still go;
 *   - hosted: a token of acme can't post at beta (401); an owner's copy carries no `chatPost` and keeps the Agent column
 *     (settings.roles.agent), a restore keeps it, and a `chatPost` in a hand-made copy is dropped.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { zipFiles } = require(path.join(ROOT, 'server', 'module-build.js'));
const { readZip } = require(path.join(ROOT, 'server', 'modules.js'));

const CANT = "An agent can't do that.";
const OVER = 'The agent has done as much as it may for now.';
const INVALID = 'That agent token is not valid.';

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
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, json, text, buf, headers: res.headers });
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
const dayToday = () => new Date().toISOString().slice(0, 10);
const logLines = (dir, key) => {
  const file = path.join(dir, 'agent-log', key, `${dayToday()}.jsonl`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const allLogText = (dir) => {
  const out = [];
  const walk = (d) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.push(fs.readFileSync(p, 'utf8')); } };
  walk(path.join(dir, 'agent-log'));
  return out.join('');
};
const hex12 = () => crypto.randomBytes(6).toString('hex');

// Opens a person's live stream of a space and collects its events; `close()` ends it.
function watch(server, urlPath, cookie) {
  const events = [];
  let req;
  const opened = new Promise((resolve, reject) => {
    req = http.get({ host: '127.0.0.1', port: server.port, path: urlPath, headers: { host: `127.0.0.1:${server.port}`, cookie, accept: 'text/event-stream' } }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`the stream answered ${res.statusCode}`));
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        let at;
        while ((at = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, at);
          buf = buf.slice(at + 2);
          const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
          if (data) { try { events.push(JSON.parse(data)); } catch { /* not JSON */ } }
        }
      });
      resolve();
    });
    req.on('error', () => {});
  });
  return { events, opened, close: () => req.destroy() };
}
const waitFor = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); }
  return null;
};

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-agent-chat-'));
const single = path.join(base, 'single');
const onEnv = { ADMIN_PASSWORD: 'admin-password-1', AGENT_TOKENS: 'true' };

try {
  let server = await startServer(single, onEnv);
  let admin = await signIn(server, 'admin', 'admin-password-1');
  ok(await call(server, 'PATCH', '/api/settings', { cookie: admin, body: { agents: true } }), 'Agents on');
  ok(await call(server, 'POST', '/api/modules/bundled/todo/install', { cookie: admin, body: {} }), 'the To-do installs', 201);
  ok(await call(server, 'PATCH', '/api/modules/todo', { cookie: admin, body: { enabled: true } }), 'the To-do is on');
  const mia = (await call(server, 'POST', '/api/users', { cookie: admin, body: { login: 'mia', displayName: 'Mia', password: 'mia-password-1', role: 'member' } })).json.user;
  const lookalike = (await call(server, 'POST', '/api/users', { cookie: admin, body: { login: 'claude', displayName: 'Claude', password: 'claude-password-1', role: 'member' } })).json.user;
  const agent = (await call(server, 'POST', '/api/users', { cookie: admin, body: { agent: true } })).json.user;
  const S1 = (await call(server, 'POST', '/api/spaces', { cookie: admin, body: { name: 'Camp', members: [agent.key, mia.key, lookalike.key] } })).json.space.id;
  const S2 = (await call(server, 'POST', '/api/spaces', { cookie: admin, body: { name: 'Elsewhere', members: [mia.key] } })).json.space.id;
  const token = (await call(server, 'POST', `/api/users/${agent.key}/token`, { cookie: admin })).json.token;
  const A = { token };
  const miaC = await signIn(server, 'mia', 'mia-password-1');
  const claudeC = await signIn(server, 'claude', 'claude-password-1');
  const chat = (id = S1) => `/api/spaces/${id}/chat`;
  // Another agent in Camp, with its own token (Send chat messages is the Agent column's, the same for every agent).
  const poster = async (name) => {
    const w = (await call(server, 'POST', '/api/users', { cookie: admin, body: { agent: true, displayName: name } })).json.user;
    const sp = (await call(server, 'GET', `/api/spaces/${S1}`, { cookie: admin })).json.space;
    ok(await call(server, 'PATCH', `/api/spaces/${S1}`, { cookie: admin, body: { members: [...sp.members, w.key] } }), `${name} joins`);
    return { key: w.key, token: (await call(server, 'POST', `/api/users/${w.key}/token`, { cookie: admin })).json.token };
  };
  const agentColumn = (body, cookie = admin) => call(server, 'PATCH', '/api/roles/agent', { cookie, body });

  await test('Send chat messages is off for a new environment\'s agents: a post is 403, reading works', async () => {
    assert.ok(!('chatPost' in agent), 'the user answer has no chatPost');
    const me = await call(server, 'GET', '/api/agent/me', A);
    ok(me, 'me');
    assert.ok(!('chatPost' in me.json), 'me has no chatPost');
    assert.deepEqual(me.json.permissions, ['agentMembers', 'chatRead'], 'me says it may read Chat and see members, not post');
    refused(await call(server, 'POST', chat(), { ...A, body: { text: 'Hello' } }), 403, CANT, 'a post');
    const read = await call(server, 'GET', chat(), A);
    ok(read, 'a read with Send chat messages off');
    assert.deepEqual(read.json, { messages: [], more: false });
  });

  await test('only an owner ticks Send chat messages for agents; chatPost does nothing', async () => {
    refused(await agentColumn({ chat: true }, miaC), 403, null, 'a member');
    refused(await call(server, 'PATCH', '/api/roles/agent', { ...A, body: { chat: true } }), 403, CANT, 'the agent itself');
    ok(await call(server, 'PATCH', `/api/users/${agent.key}`, { cookie: admin, body: { chatPost: true } }), 'chatPost sent to an agent');
    ok(await call(server, 'PATCH', `/api/users/${mia.key}`, { cookie: admin, body: { chatPost: true } }), 'chatPost sent to a person');
    let stored = JSON.parse(fs.readFileSync(path.join(single, 'app.json'), 'utf8'));
    assert.ok(stored.users.every((u) => !('chatPost' in u)), 'nothing stored');
    assert.ok(!('chatPost' in (await call(server, 'GET', `/api/users/${agent.key}`, { cookie: admin })).json.user), 'no chatPost in the answer');
    refused(await call(server, 'POST', chat(), { ...A, body: { text: 'Hello' } }), 403, CANT, 'still no post');
    const on = await agentColumn({ chat: true });
    ok(on, 'ticked');
    assert.equal(on.json.roles.agent.chat, true);
    assert.deepEqual((await call(server, 'GET', '/api/agent/me', A)).json.permissions, ['agentMembers', 'chatRead', 'chat'], 'me says so');
    stored = JSON.parse(fs.readFileSync(path.join(single, 'app.json'), 'utf8'));
    assert.equal(stored.settings.roles.agent.chat, true, 'stored in the agent column');
  });

  let posted = null;
  await test('a post lands as a public message with agent: true, told to the live stream', async () => {
    const stream = watch(server, `/api/live?space=${S1}`, miaC);
    await stream.opened;
    await waitFor(() => stream.events.length > 0);
    const r = await call(server, 'POST', chat(), { ...A, body: { text: 'Milestone added: Pack the tent' } });
    ok(r, 'the post');
    posted = r.json.message;
    assert.deepEqual(Object.keys(posted).sort(), ['agent', 'at', 'by', 'id', 'text', 'who'], 'the answer\'s shape');
    assert.deepEqual([posted.agent, posted.by, posted.who, posted.text], [true, agent.key, 'Claude', 'Milestone added: Pack the tent']);
    assert.match(posted.id, /^[a-f0-9]{12}$/);
    const told = await waitFor(() => stream.events.find((e) => e.type === 'chat' && e.id === posted.id));
    stream.close();
    assert.ok(told, 'the live stream has it');
    assert.equal(told.agent, true, 'with the flag');
    const seen = (await call(server, 'GET', chat(), { cookie: miaC })).json.messages.find((m) => m.id === posted.id);
    assert.equal(seen.agent, true, 'a person reads the flag');
  });

  await test('the label comes from the account, never the name or the request', async () => {
    const theirs = await call(server, 'POST', chat(), { cookie: claudeC, body: { text: 'I am Claude too', agent: true } });
    ok(theirs, 'a person named Claude posts');
    assert.ok(!('agent' in theirs.json.message), 'no flag for a person');
    ok(await call(server, 'PATCH', `/api/users/${agent.key}`, { cookie: admin, body: { displayName: 'Mia' } }), 'the agent renamed like a person');
    const renamed = await call(server, 'POST', chat(), { ...A, body: { text: 'Still an agent' } });
    ok(renamed, 'posts');
    assert.deepEqual([renamed.json.message.who, renamed.json.message.agent], ['Mia', true]);
    ok(await call(server, 'PATCH', `/api/users/${agent.key}`, { cookie: admin, body: { displayName: 'Claude' } }), 'named back');
    const list = (await call(server, 'GET', chat(), { cookie: miaC })).json.messages;
    assert.equal(list.find((m) => m.id === theirs.json.message.id).agent, undefined);
    assert.equal(list.find((m) => m.id === renamed.json.message.id).agent, true);
  });

  await test('{ text } only, cleaned as a person\'s, at most 1000 characters', async () => {
    const A = { token: (await poster('Checker')).token }; // its own budget: each refusal here is a write too
    refused(await call(server, 'POST', chat(), { ...A, body: { text: 'x', visibility: 'private' } }), 400, 'An agent sends { text } and nothing else.', 'another field');
    refused(await call(server, 'POST', chat(), { ...A, raw: Buffer.from('{"text":"x","__proto__":{"agent":false}}') }), 400, 'An agent sends { text } and nothing else.', 'a __proto__ field');
    refused(await call(server, 'POST', chat(), { ...A, body: { text: { a: 1 } } }), 400, 'text is the message, as text.', 'not text');
    refused(await call(server, 'POST', chat(), { ...A, body: ['x'] }), 400, 'An agent sends { text } and nothing else.', 'a list');
    refused(await call(server, 'POST', chat(), { ...A, body: { text: '  \u0007 ' } }), 400, 'The message is empty.', 'empty');
    refused(await call(server, 'POST', chat(), { ...A, body: { text: 'y'.repeat(1001) } }), 400, 'A message is at most 1000 characters.', 'too long');
    const full = await call(server, 'POST', chat(), { ...A, body: { text: 'z'.repeat(1000) } });
    ok(full, '1000 characters');
    const cleaned = await call(server, 'POST', chat(), { ...A, body: { text: '  a\u0000b\u001bc\nd <b>e</b>  ' } });
    ok(cleaned, 'control characters');
    assert.equal(cleaned.json.message.text, 'abc\nd <b>e</b>', 'cleaned as a person\'s: control characters out, markup kept as text for the page to escape');
  });

  await test('the log: a post keeps its message id, a read the number it carried, never any text', async () => {
    const r = await call(server, 'POST', chat(), { ...A, body: { text: 'Secret words 7731' } });
    ok(r, 'a post');
    const read = await call(server, 'GET', chat(), A);
    ok(read, 'a read');
    // The gate writes a call's line once its answer has gone out, so a line may land just after the client has it: wait for it.
    const post = await waitFor(() => logLines(single, agent.key).find((l) => l.method === 'POST' && l.message === r.json.message.id));
    assert.ok(post, 'the post\'s line');
    assert.deepEqual([post.route, post.space, post.kind, post.status, post.message], ['/api/spaces/:id/chat', S1, 'write', 200, r.json.message.id]);
    const got = await waitFor(() => { const all = logLines(single, agent.key); return all.slice(all.findIndex((l) => l.message === r.json.message.id) + 1).find((l) => l.method === 'GET' && l.route === '/api/spaces/:id/chat'); });
    assert.ok(got, 'the read\'s line');
    assert.deepEqual([got.route, got.space, got.kind, got.status, got.message], ['/api/spaces/:id/chat', S1, 'read', 200, read.json.messages.length]);
    const refusedLine = await waitFor(() => logLines(single, agent.key).find((l) => l.method === 'POST' && l.status === 403));
    assert.ok(refusedLine && refusedLine.message === null && refusedLine.kind === 'write', 'the refused post is a write with no message');
    const text = allLogText(single);
    for (const words of ['Secret words 7731', 'Milestone added', 'Pack the tent', 'zzzzzzzz']) assert.ok(!text.includes(words), `no text in the log (${words})`);
    const page = (await call(server, 'GET', `/api/users/${agent.key}/agent-log`, { cookie: admin })).json.entries; // both lines are on disk by now
    assert.ok(page.some((e) => e.message === r.json.message.id) && page.some((e) => e.message === read.json.messages.length), 'the owner reads them');
  });

  await test('a post is a write and a read reply a read in the agent\'s budget', async () => {
    const m1 = (await call(server, 'GET', '/api/agent/me', A)).json.limits;
    ok(await call(server, 'POST', chat(), { ...A, body: { text: 'one' } }), 'a post');
    const m2 = (await call(server, 'GET', '/api/agent/me', A)).json.limits;
    assert.equal(m2.writes.usedToday, m1.writes.usedToday + 1, 'a write');
    assert.equal(m2.reads.usedToday, m1.reads.usedToday + 1, 'only the me call is a read');
    ok(await call(server, 'GET', chat(), A), 'a read');
    const m3 = (await call(server, 'GET', '/api/agent/me', A)).json.limits;
    assert.equal(m3.reads.usedToday, m2.reads.usedToday + 2, 'one read, and the me call');
    assert.equal(m3.writes.usedToday, m2.writes.usedToday);
  });

  await test('20 writes a minute: posts and action requests together, then 429', async () => {
    const { token: t } = await poster('Writer');
    for (let i = 0; i < 10; i += 1) ok(await call(server, 'POST', chat(), { token: t, body: { text: `post ${i}` } }), `post ${i + 1}`);
    for (let i = 0; i < 10; i += 1) ok(await call(server, 'POST', `/api/spaces/${S1}/action`, { token: t, body: { action: 'todo:createTask', input: { title: `Task ${i}` } } }), `action ${i + 1}`);
    const over = await call(server, 'POST', chat(), { token: t, body: { text: 'one too many' } });
    refused(over, 429, OVER, 'the 21st write');
    assert.ok(Number(over.headers['retry-after']) >= 1, 'Retry-After');
    assert.ok(!(await call(server, 'GET', chat(), { cookie: miaC })).json.messages.some((m) => m.text === 'one too many'), 'not posted');
  });

  await test('Send chat messages off stops posting only: action requests still go', async () => {
    ok(await agentColumn({ chat: false }), 'off');
    refused(await call(server, 'POST', chat(), { ...A, body: { text: 'no' } }), 403, CANT, 'a post');
    ok(await call(server, 'POST', `/api/spaces/${S1}/action`, { ...A, body: { action: 'todo:createTask', input: { title: 'Still works' } } }), 'an action');
    ok(await call(server, 'GET', `/api/spaces/${S1}/actions`, A), 'the actions list');
    ok(await call(server, 'GET', chat(), A), 'a read');
    ok(await agentColumn({ chat: true }), 'on again');
  });

  await test('a space it is not in, the Lobby and an unknown one are 404, for reading and posting', async () => {
    for (const id of [S2, 'lobby', 'zzzz9999']) {
      const r = await call(server, 'GET', chat(id), A);
      assert.equal(r.status, 404, `read ${id}`);
      assert.match(r.json.error, /^no such /);
      const p = await call(server, 'POST', chat(id), { ...A, body: { text: 'hi' } });
      assert.equal(p.status, 404, `post ${id}`);
    }
    assert.ok(!(await call(server, 'GET', chat(S2), { cookie: miaC })).json.messages.some((m) => m.text === 'hi'), 'nothing posted elsewhere');
  });

  await test('no live stream, no deleting, hiding, pictures, Keep, previews, commands or private messages', async () => {
    const id = posted.id;
    for (const [method, url, body] of [
      ['GET', `/api/live?space=${S1}`], ['GET', '/api/live'], ['DELETE', `${chat()}/${id}`], ['PATCH', `${chat()}/${id}`, { visibility: 'private' }],
      ['DELETE', chat()], ['DELETE', `${chat()}/private`], ['DELETE', `${chat()}/messages`, { type: 'chat', scope: 'mine' }],
      ['POST', `${chat()}/pictures?file=a.png`, {}], ['POST', `${chat()}/${id}/keep`, {}], ['POST', `${chat()}/${id}/preview`, {}],
      ['GET', `${chat()}/${id}/image`], ['POST', `/api/spaces/${S1}/command`, { name: 'ai', text: 'hi' }], ['POST', `/api/spaces/${S1}/ai`, { text: 'hi' }],
    ]) refused(await call(server, method, url, { ...A, body }), 403, CANT, `${method} ${url}`);
    assert.ok((await call(server, 'GET', chat(), { cookie: miaC })).json.messages.some((m) => m.id === id), 'its message is still there');
  });

  await test('HEAD on the chat is a read; OPTIONS is 403; a form body is 400', async () => {
    const m1 = (await call(server, 'GET', '/api/agent/me', A)).json.limits;
    const head = await call(server, 'HEAD', chat(), A);
    assert.equal(head.status, 200, 'HEAD answers as GET');
    const m2 = (await call(server, 'GET', '/api/agent/me', A)).json.limits;
    assert.equal(m2.reads.usedToday, m1.reads.usedToday + 2, 'HEAD and the me call are reads');
    assert.equal(m2.writes.usedToday, m1.writes.usedToday, 'no write');
    refused(await call(server, 'OPTIONS', chat(), A), 403, CANT, 'OPTIONS');
    refused(await call(server, 'POST', chat(), { ...A, raw: Buffer.from('text=hello'), headers: { 'content-type': 'application/x-www-form-urlencoded' } }), 400, 'An agent sends { text } as JSON.', 'a form');
    refused(await call(server, 'POST', chat(), A), 400, 'An agent sends { text } as JSON.', 'no body');
    assert.ok(!(await call(server, 'GET', chat(), { cookie: miaC })).json.messages.some((m) => m.text === 'hello' || m.text === 'text=hello'), 'nothing posted');
  });

  await test('the member column no longer changes an agent; without the agent column\'s chatRead a read is 403, without chat a post', async () => {
    ok(await call(server, 'PATCH', '/api/roles/member', { cookie: admin, body: { chat: false, chatRead: false } }), 'members lose chat and chatRead');
    ok(await call(server, 'GET', chat(), A), 'the agent still reads');
    ok(await call(server, 'POST', chat(), { ...A, body: { text: 'still here' } }), 'and posts');
    refused(await call(server, 'POST', chat(), { cookie: miaC, body: { text: 'hi' } }), 403, 'your role cannot do that', 'a member\'s post');
    ok(await call(server, 'PATCH', '/api/roles/member', { cookie: admin, body: { chat: true, chatRead: true } }), 'members back');
    ok(await agentColumn({ chat: false }), 'agents lose chat');
    refused(await call(server, 'POST', chat(), { ...A, body: { text: 'hi' } }), 403, CANT, 'a post');
    ok(await call(server, 'GET', chat(), A), 'reading still goes');
    ok(await agentColumn({ chatRead: false }), 'agents lose chatRead');
    refused(await call(server, 'GET', chat(), A), 403, CANT, 'a read');
    ok(await call(server, 'GET', `/api/spaces/${S1}/actions`, A), 'the actions list still goes');
    assert.deepEqual((await call(server, 'GET', '/api/agent/me', A)).json.permissions, ['agentMembers'], 'me says so');
    ok(await agentColumn({ chat: true, chatRead: true }), 'back');
    ok(await call(server, 'GET', chat(), A), 'a read again');
  });

  // --- pages of 100, private messages, labels in a hand-made chat.json -------------------------------------------------------
  await server.stop();
  const ids = Array.from({ length: 250 }, hex12);
  const forged = hex12();
  const goneAgent = hex12();
  const unflagged = hex12();
  const privateId = hex12();
  const guestForged = hex12();
  {
    const t0 = Date.now() - 3600000;
    const pub = ids.map((id, i) => ({ id, at: t0 + i * 1000, by: mia.key, who: 'Mia', text: `public ${i}` }));
    pub[10] = { ...pub[10], id: forged, agent: true }; // a person's message a hand-made file calls an agent's
    pub[11] = { ...pub[11], id: goneAgent, by: 'gone1234', who: 'Old helper', agent: true }; // an agent since deleted
    pub[12] = { ...pub[12], id: unflagged, by: agent.key, who: 'Claude' }; // an agent's, its flag lost
    pub[13] = { ...pub[13], id: guestForged, by: 'guest', who: 'Visitor', agent: true }; // a guest's, which no account ever posted
    ids[10] = forged; ids[11] = goneAgent; ids[12] = unflagged; ids[13] = guestForged;
    fs.writeFileSync(path.join(single, 'chat.json'), JSON.stringify({ spaces: { [S1]: pub }, cleared: {} }));
    fs.writeFileSync(path.join(single, 'chat-private.json'), JSON.stringify({ spaces: { [S1]: [
      { id: privateId, at: t0 + 500, by: mia.key, who: 'Mia', text: 'mia private words', visibility: 'private' },
      { id: hex12(), at: t0 + 600, by: agent.key, who: 'Claude', text: 'agent private words', visibility: 'private' },
    ] } }));
  }
  server = await startServer(single, onEnv);
  admin = await signIn(server, 'admin', 'admin-password-1');
  const miaC2 = await signIn(server, 'mia', 'mia-password-1');

  await test('reading: 100 a reply, newest first, older ones by before; never a private message', async () => {
    const p1 = await call(server, 'GET', chat(), A);
    ok(p1, 'page 1');
    assert.equal(p1.json.messages.length, 100);
    assert.equal(p1.json.more, true);
    assert.deepEqual(p1.json.messages.map((m) => m.id), ids.slice(150).reverse(), 'the newest 100, newest first');
    const p2 = await call(server, 'GET', `${chat()}?before=${p1.json.messages[99].id}`, A);
    ok(p2, 'page 2');
    assert.deepEqual(p2.json.messages.map((m) => m.id), ids.slice(50, 150).reverse());
    assert.equal(p2.json.more, true);
    const p3 = await call(server, 'GET', `${chat()}?before=${p2.json.messages[99].id}`, A);
    assert.deepEqual(p3.json.messages.map((m) => m.id), ids.slice(0, 50).reverse());
    assert.equal(p3.json.more, false);
    const all = [...p1.json.messages, ...p2.json.messages, ...p3.json.messages];
    assert.ok(all.every((m) => m.visibility !== 'private'), 'no private message');
    assert.ok(!JSON.stringify([p1.json, p2.json, p3.json]).includes('private words'), 'no private text');
    assert.ok(!all.some((m) => m.id === privateId));
    // Mia, a person, still reads hers, and the whole history as before.
    const hers = await call(server, 'GET', chat(), { cookie: miaC2 });
    assert.ok(hers.json.messages.some((m) => m.id === privateId) && 'clearedAt' in hers.json && hers.json.messages.length === 251, 'a person\'s answer is unchanged');
    refused(await call(server, 'GET', `${chat()}?before=nope`, A), 400, 'before is a message id.', 'a bad before');
    refused(await call(server, 'GET', `${chat()}?before=${privateId}`, A), 404, 'no such message', 'a private message as before');
    refused(await call(server, 'GET', `${chat()}?before=${hex12()}`, A), 404, 'no such message', 'an unknown before');
    refused(await call(server, 'GET', `${chat()}?before=${ids[5]}&before=${ids[6]}`, A), 400, 'before is a message id.', 'two befores');
  });

  await test('a hand-made chat.json can\'t label a person\'s message; an agent\'s is labelled from its account', async () => {
    const all = (await call(server, 'GET', chat(), { cookie: miaC2 })).json.messages;
    assert.equal(all.find((m) => m.id === forged).agent, undefined, 'a person\'s message, never');
    assert.equal(all.find((m) => m.id === goneAgent).agent, true, 'a deleted agent\'s keeps its flag');
    assert.equal(all.find((m) => m.id === unflagged).agent, true, 'an agent\'s, from the account');
    assert.equal(all.find((m) => m.id === guestForged).agent, undefined, 'a guest\'s, never');
    const theirs = (await call(server, 'GET', chat(), A)).json.messages;
    assert.equal(theirs.find((m) => m.id === guestForged)?.agent, undefined, 'nor in the agent\'s read');
  });

  await test('the agent column survives a restart; a chatPost in app.json is dropped', async () => {
    assert.ok((await call(server, 'GET', '/api/agent/me', A)).json.permissions.includes('chat'));
    await server.stop();
    const file = path.join(single, 'app.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.users.find((u) => u.key === mia.key).chatPost = true;
    data.users.find((u) => u.key === agent.key).chatPost = false;
    fs.writeFileSync(file, JSON.stringify(data));
    server = await startServer(single, onEnv);
    admin = await signIn(server, 'admin', 'admin-password-1');
    assert.ok(!('chatPost' in (await call(server, 'GET', `/api/users/${mia.key}`, { cookie: admin })).json.user), 'not on a person');
    assert.ok(!('chatPost' in (await call(server, 'GET', `/api/users/${agent.key}`, { cookie: admin })).json.user), 'not on the agent');
    assert.ok((await call(server, 'GET', '/api/agent/me', A)).json.permissions.includes('chat'), 'the column is kept');
    ok(await call(server, 'POST', chat(), { ...A, body: { text: 'after the restart' } }), 'it posts');
  });
  await server.stop();

  // --- hosted: isolation, the owner's copy and a restore ---------------------------------------------------------------------
  const hosted = path.join(base, 'hosted');
  const hostEnv = { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'boss', ADMIN_PASSWORD: 'host-password-1', AGENT_TOKENS: 'true' };
  server = await startServer(hosted, hostEnv);
  const host = await signIn(server, 'boss', 'host-password-1', 'admin');
  for (const slug of ['acme', 'beta']) {
    ok(await call(server, 'POST', '/api/host/environments', { host: 'admin', cookie: host, body: { slug, name: slug, owner: { login: 'owner', password: 'owner-password-1' } } }), `${slug} made`, 201);
  }
  const acme = await signIn(server, 'owner', 'owner-password-1', 'acme');
  const beta = await signIn(server, 'owner', 'owner-password-1', 'beta');
  let hostedAgent = null;
  await test('hosted: a token of acme can\'t read or post at beta', async () => {
    for (const [slug, cookie] of [['acme', acme], ['beta', beta]]) ok(await call(server, 'PATCH', '/api/settings', { host: slug, cookie, body: { agents: true } }), `${slug} Agents on`);
    hostedAgent = (await call(server, 'POST', '/api/users', { host: 'acme', cookie: acme, body: { agent: true } })).json.user;
    ok(await call(server, 'PATCH', '/api/roles/agent', { host: 'acme', cookie: acme, body: { chat: true } }), 'Send chat messages on at acme');
    const betaRoles = (await call(server, 'GET', '/api/roles', { host: 'beta', cookie: beta })).json.roles;
    assert.equal(betaRoles.agent.chat, false, 'not at beta');
    const space = (await call(server, 'POST', '/api/spaces', { host: 'acme', cookie: acme, body: { name: 'Plans', members: [hostedAgent.key] } })).json.space.id;
    const betaSpace = (await call(server, 'POST', '/api/spaces', { host: 'beta', cookie: beta, body: { name: 'Plans' } })).json.space.id;
    const t = (await call(server, 'POST', `/api/users/${hostedAgent.key}/token`, { host: 'acme', cookie: acme })).json.token;
    const r = await call(server, 'POST', chat(space), { host: 'acme', token: t, body: { text: 'Hello acme' } });
    ok(r, 'posts at acme');
    assert.equal(r.json.message.agent, true);
    for (const id of [space, betaSpace]) {
      refused(await call(server, 'POST', chat(id), { host: 'beta', token: t, body: { text: 'Hello beta' } }), 401, INVALID, `a post at beta (${id})`);
      refused(await call(server, 'GET', chat(id), { host: 'beta', token: t }), 401, INVALID, `a read at beta (${id})`);
    }
    assert.ok(!(await call(server, 'GET', chat(betaSpace), { host: 'beta', cookie: beta })).json.messages.length, 'beta\'s chat is empty');
  });
  await test('an owner\'s copy has no chatPost and keeps the agent column; a restore keeps it, and drops a hand-made chatPost', async () => {
    const zipped = await call(server, 'GET', '/api/environment/export', { host: 'acme', cookie: acme });
    ok(zipped, 'the copy');
    const files = await readZip(zipped.buf);
    const app = JSON.parse(files.get('app.json').toString('utf8'));
    assert.ok(app.users.every((u) => !('chatPost' in u)), 'no chatPost in the copy');
    assert.equal(app.settings.roles.agent.chat, true, 'the agent column in the copy');
    const owner = app.users.find((u) => u.login === 'owner');
    owner.chatPost = true; // a hand-made copy gives a person the old field
    app.users.find((u) => u.key === hostedAgent.key).chatPost = true;
    // An owner's copy carries no password; this one is given the owner's back, so the owner can sign in after the restore.
    owner.passwordHash = JSON.parse(fs.readFileSync(path.join(hosted, 'environments', 'acme', 'app.json'), 'utf8')).users.find((u) => u.login === 'owner').passwordHash;
    files.set('app.json', Buffer.from(JSON.stringify(app)));
    const restored = await call(server, 'POST', '/api/host/environments/acme/restore', { host: 'admin', cookie: host, raw: zipFiles([...files.entries()]), headers: { 'content-type': 'application/zip' } });
    ok(restored, 'the restore');
    const again = await signIn(server, 'owner', 'owner-password-1', 'acme');
    const users = (await call(server, 'GET', '/api/users', { host: 'acme', cookie: again })).json.users;
    assert.ok(!('chatPost' in users.find((u) => u.key === hostedAgent.key)), 'not on the agent');
    assert.ok(!('chatPost' in users.find((u) => u.login === 'owner')), 'not on a person');
    assert.equal((await call(server, 'GET', '/api/roles', { host: 'acme', cookie: again })).json.roles.agent.chat, true, 'the agent column kept');
  });
  await server.stop();

  // --- the in-app AI's context: an agent's post labelled, a person's and a guest's never ------------------------------------
  await test('the AI context shows "<name> (agent)" for an agent\'s post, never for a person\'s or a guest\'s', async () => {
    const { ChatHistory } = require(path.join(ROOT, 'server', 'chat-history.js'));
    const { createContextBuilder } = require(path.join(ROOT, 'server', 'ai-context.js'));
    const dir = path.join(base, 'ai-context');
    fs.mkdirSync(dir, { recursive: true });
    const t0 = Date.now() - 60000;
    fs.writeFileSync(path.join(dir, 'chat.json'), JSON.stringify({ spaces: { sp1: [
      { id: hex12(), at: t0, by: 'agnt1234', who: 'Claude', text: 'agent words', agent: true },
      { id: hex12(), at: t0 + 1, by: 'prsn1234', who: 'Claude', text: 'person words', agent: true },
      { id: hex12(), at: t0 + 2, by: 'guest', who: 'Visitor', text: 'guest words', agent: true },
      { id: hex12(), at: t0 + 3, by: 'gone1234', who: 'Old helper', text: 'gone agent words', agent: true },
      { id: hex12(), at: t0 + 4, by: 'agnt1234', who: 'Claude', text: 'unflagged agent words' },
    ] }, cleared: {} }));
    const history = new ChatHistory(dir);
    assert.deepEqual(history.list('sp1').map((m) => m.agent), [true, true, undefined, true, undefined], 'the stored flag is dropped on load from a guest\'s message only');
    const accounts = { agnt1234: { key: 'agnt1234', agent: true }, prsn1234: { key: 'prsn1234' } };
    const builder = createContextBuilder({
      store: { userByKey: (k) => accounts[k] || null }, chatHistory: history, moduleLinks: { from: () => [], to: () => [] },
      policy: { sees: () => ({ chat: true }), secrets: () => [], redact: (t) => t, admit: () => ({ ok: false }) },
      word: (w) => w, listObjects: () => [], roleWordOf: () => 'member', guestsIn: () => [], serverZone: () => 'UTC',
      timelineOf: () => [], templatePhases: () => [], canReadChat: () => true,
    });
    const built = builder.build({ user: { key: 'askr1234', displayName: 'Asker' } }, { id: 'sp1', name: 'Camp', members: [], phases: [] }, {
      template: { inputs: ['context'], budget: { total: 100000, instructions: 0, history: 1000, material: 1000 } },
    });
    const who = Object.fromEntries(built.context.chat.map((c) => [c.text, c.who]));
    assert.deepEqual(who, {
      'agent words': 'Claude (agent)', 'person words': 'Claude', 'guest words': 'Visitor',
      'gone agent words': 'Old helper (agent)', 'unflagged agent words': 'Claude (agent)',
    });
  });
} catch (err) {
  failed += 1;
  console.error(`FAIL setting up\n${err.stack || err}`);
} finally {
  for (const s of servers) await s.stop();
  fs.rmSync(base, { recursive: true, force: true });
}

if (failed) {
  console.error(`check-agent-chat: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-agent-chat: ${n} passed`);
