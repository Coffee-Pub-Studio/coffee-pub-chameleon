#!/usr/bin/env node
/*
 * check-agent-setup.mjs -- the set-up agent, step 1 (documentation/plans/plan-admin-agent.md, "Verify"; its column is
 * plan-agent-matrix.md decision 3). On throwaway servers, single and hosted:
 *   - the switches: AGENT_SETUP off, or Set-up agents off, makes the set-up agent's token 401 and leaves an ordinary agent as
 *     it was; no set-up agent can be made then; the Roles grid shows the set-up column only with AGENT_SETUP, and
 *     PATCH /api/roles/setup is 404 without it;
 *   - the account: kind "setup", a member and never anything more, its kind never changes, made only by an owner or the
 *     admin, a name can't end in "(set-up agent)";
 *   - the column: only "Make {spaces}" and "Rename and change {spaces}", both off by default; a never row is 400; the rows
 *     are refused on every other column;
 *   - the gate walked from the route table: the set-up agent reaches only its own routes (every other route and mount is
 *     403 "An agent can't do that.", Chat, module data and /api/spaces/:id/members among them), and an ordinary agent gets
 *     403 on every one of the set-up agent's;
 *   - bodies: any other key is 400, an unknown template or icon is 400 with its sentence, the space made has `madeBy` and
 *     the agent as a member, a person's own template list decides;
 *   - reach: a space it did not make is 404, the Lobby too; Keep (an owner's madeBy: null) ends its reach;
 *   - the daily caps (5 spaces, 30 changes) answer 429 and survive a restart (read back from the log);
 *   - the log: one line a call with `space` and `change`, never a name or a description;
 *   - hosted: a set-up agent's token of one environment is 401 at another.
 * Not here: asks, undo and the MCP tools (that plan's steps 2 and 3); a real Claude client.
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
const { AGENT_ROUTES, SETUP_LIMITS } = require(path.join(ROOT, 'server', 'agent-routes.js'));

const CANT = "An agent can't do that.";
const CANT_BE = "An agent can't be that.";
const INVALID = 'That agent token is not valid.';
const OVER = 'The agent has done as much as it may for now.';
const SETUP_LIST = new Set(AGENT_ROUTES.filter((e) => e.kind === 'setup').map((e) => `${e.method.toUpperCase()} ${e.path}`));
const SETUP_OWN = [...SETUP_LIST].filter((r) => r !== 'GET /api/agent/me'); // the routes only the set-up agent has

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
// The log line of a call is written when its answer finishes: wait until the file has `count` lines.
const waitLines = async (dir, key, count) => {
  for (let i = 0; i < 100 && logLines(dir, key).length < count; i += 1) await new Promise((r) => setTimeout(r, 20));
  return logLines(dir, key);
};

const ON = { ADMIN_PASSWORD: 'admin-password-1', AGENT_TOKENS: 'true', AGENT_SETUP: 'true' };
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-agent-setup-'));
const single = path.join(base, 'single');
try {
  let server = await startServer(single, ON);
  let admin = await signIn(server, 'admin', 'admin-password-1');
  ok(await call(server, 'PATCH', '/api/settings', { cookie: admin, body: { agents: true } }), 'Agents on');
  ok(await call(server, 'POST', '/api/users', { cookie: admin, body: { login: 'olga', displayName: 'Olga', password: 'olga-password-1', role: 'owner' } }), 'an owner', 201);
  const mia = (await call(server, 'POST', '/api/users', { cookie: admin, body: { login: 'mia', displayName: 'Mia', password: 'mia-password-1', role: 'member' } })).json.user;
  const olga = await signIn(server, 'olga', 'olga-password-1');
  const miaC = await signIn(server, 'mia', 'mia-password-1');

  await test('Set-up agents: off until an owner turns them on; then made by an owner or the admin only, kind setup', async () => {
    const settings = (await call(server, 'GET', '/api/settings', { cookie: admin })).json.settings;
    assert.deepEqual([settings.agentSetup, settings.setupAgents], [true, false]);
    refused(await call(server, 'POST', '/api/users', { cookie: admin, body: { agent: true, kind: 'setup' } }), 403, 'Set-up agents are off in this environment. Turn on Set-up agents in Manage first.', 'switch off');
    refused(await call(server, 'PATCH', '/api/settings', { cookie: admin, body: { setupAgents: 'yes' } }), 400, 'setupAgents is true or false', 'not a boolean');
    refused(await call(server, 'PATCH', '/api/settings', { cookie: miaC, body: { setupAgents: true } }), 403, null, 'a member');
    ok(await call(server, 'PATCH', '/api/settings', { cookie: olga, body: { setupAgents: true } }), 'an owner turns it on');
    refused(await call(server, 'POST', '/api/users', { cookie: admin, body: { agent: true, kind: 'admin' } }), 400, 'kind is setup, or left out for an agent that works in spaces.', 'another kind');
    refused(await call(server, 'POST', '/api/users', { cookie: admin, body: { agent: true, kind: 'setup', role: 'owner' } }), 400, CANT_BE, 'with a role');
    refused(await call(server, 'POST', '/api/users', { cookie: miaC, body: { agent: true, kind: 'setup' } }), 403, null, 'a member');
    refused(await call(server, 'POST', '/api/users', { cookie: admin, body: { agent: true, kind: 'setup', displayName: 'Ana (set-up agent)' } }), 400, "A name can't end in (set-up agent).", 'the mark in a name');
    refused(await call(server, 'POST', '/api/users', { cookie: admin, body: { login: 'ana', displayName: 'Ana (Set-Up  Agent)', password: 'ana-password-1' } }), 400, "A name can't end in (set-up agent).", 'a person named with the mark');
    const made = await call(server, 'POST', '/api/users', { cookie: olga, body: { agent: true, kind: 'setup' } });
    ok(made, 'an owner makes one', 201);
    const u = made.json.user;
    assert.deepEqual([u.agent, u.kind, u.role, u.displayName], [true, 'setup', 'member', 'Claude']);
    const ordinary = (await call(server, 'POST', '/api/users', { cookie: admin, body: { agent: true } })).json.user;
    assert.ok(!('kind' in ordinary), 'an ordinary agent has no kind');
  });

  const setupOf = async (name, cookie = admin) => {
    const user = (await call(server, 'POST', '/api/users', { cookie, body: { agent: true, kind: 'setup', displayName: name } })).json.user;
    const token = (await call(server, 'POST', `/api/users/${user.key}/token`, { cookie })).json.token;
    return { user, token, T: { token } };
  };
  const agentOf = async (name) => {
    const user = (await call(server, 'POST', '/api/users', { cookie: admin, body: { agent: true, displayName: name } })).json.user;
    const token = (await call(server, 'POST', `/api/users/${user.key}/token`, { cookie: admin })).json.token;
    return { user, token, T: { token } };
  };
  const S = await setupOf('Builder');
  const O = await agentOf('Reader');
  const column = (body) => call(server, 'PATCH', '/api/roles/setup', { cookie: admin, body });

  await test('the account: never an owner, admin or moderator; its kind never changes', async () => {
    refused(await call(server, 'PATCH', `/api/users/${S.user.key}`, { cookie: admin, body: { role: 'owner' } }), 400, CANT_BE, 'owner');
    refused(await call(server, 'PATCH', `/api/users/${S.user.key}`, { cookie: admin, body: { role: 'admin' } }), 400, CANT_BE, 'admin');
    refused(await call(server, 'PATCH', `/api/users/${S.user.key}`, { cookie: admin, body: { kind: 'agent' } }), 400, "An agent's kind is chosen when it is made and can't change.", 'its kind');
    refused(await call(server, 'PATCH', `/api/users/${O.user.key}`, { cookie: admin, body: { kind: 'setup' } }), 400, "An agent's kind is chosen when it is made and can't change.", 'an ordinary agent made set-up');
    const listed = (await call(server, 'GET', '/api/users', { cookie: admin })).json.users.find((u) => u.key === S.user.key);
    assert.deepEqual([listed.kind, listed.role, listed.agent], ['setup', 'member', true]);
  });

  await test('the column: shown with AGENT_SETUP, only its two rows, both off; never rows are 400; its rows are no one else\'s', async () => {
    const roles = (await call(server, 'GET', '/api/roles', { cookie: admin })).json;
    assert.deepEqual(roles.columns, ['owner', 'moderator', 'member', 'guest', 'agent', 'setup']);
    const rows = roles.permissions.filter((p) => p.column === 'setup');
    assert.deepEqual(rows.map((p) => p.key), ['agentMakeSpaces', 'agentChangeSpaces']);
    assert.deepEqual(rows.map((p) => p.label), ['Make spaces', 'Rename and change spaces']);
    assert.ok(rows.every((p) => p.agentOnly === true && p.group === 'Agents'));
    const keys = roles.permissions.map((p) => p.key);
    assert.deepEqual(keys.filter((k) => !roles.never.setup.includes(k)).sort(), ['agentChangeSpaces', 'agentMakeSpaces']);
    assert.ok(roles.never.agent.includes('agentMakeSpaces') && roles.never.agent.includes('agentChangeSpaces'), 'never the ordinary agent\'s');
    assert.ok(Object.values(roles.roles.setup).every((v) => v === false), 'everything off by default');
    refused(await column({ chatRead: true }), 400, 'A set-up agent can never have "Open and read the chat".', 'Chat');
    refused(await column({ agentMembers: true }), 400, null, 'the agent\'s members row');
    refused(await call(server, 'PATCH', '/api/roles/agent', { cookie: admin, body: { agentMakeSpaces: true } }), 400, 'An agent can never have "Make spaces".', 'on the agent column');
    refused(await call(server, 'PATCH', '/api/roles/member', { cookie: admin, body: { agentChangeSpaces: true } }), 400, 'Only an agent can have "Rename and change spaces".', 'on a person\'s');
    refused(await call(server, 'PATCH', '/api/roles/setup', { cookie: miaC, body: { agentMakeSpaces: true } }), 403, null, 'a member');
  });

  await test('me: kind, no permissions by default, no spaces; making is 403 until the column says so', async () => {
    const me = await call(server, 'GET', '/api/agent/me', S.T);
    ok(me, 'me');
    assert.equal(me.json.kind, 'setup');
    assert.deepEqual(me.json.permissions, []);
    assert.deepEqual(me.json.spaces, []);
    assert.deepEqual([me.json.limits.made.perDay, me.json.limits.changes.perDay], [5, 30]);
    assert.equal((await call(server, 'GET', '/api/agent/me', O.T)).json.kind, 'agent', 'the ordinary agent\'s kind');
    refused(await call(server, 'POST', '/api/agent/spaces', { ...S.T, body: { name: 'X', template: 'default' } }), 403, CANT, 'making, unticked');
    ok(await column({ agentMakeSpaces: true, agentChangeSpaces: true }), 'both ticked');
    assert.deepEqual((await call(server, 'GET', '/api/agent/me', S.T)).json.permissions, ['agentMakeSpaces', 'agentChangeSpaces']);
  });

  let made = null;
  let templateId = null;
  await test('templates and icons; making a space: bodies checked, madeBy and the agent as a member', async () => {
    const t = await call(server, 'GET', '/api/agent/templates', S.T);
    ok(t, 'templates');
    assert.ok(Array.isArray(t.json.templates) && t.json.templates.length > 0, 'some templates');
    assert.ok(t.json.templates.every((x) => Object.keys(x).sort().join() === 'id,name'), 'only id and name');
    templateId = t.json.templates[0].id;
    const icons = await call(server, 'GET', '/api/agent/icons', S.T);
    ok(icons, 'icons');
    assert.ok(icons.json.icons.length > 0 && icons.json.icons.every((i) => typeof i === 'string'));
    // The refused bodies from another set-up agent, so the one under test stays inside its 20 writes a minute.
    const V = await setupOf('Validator');
    const P = (body, extra = {}, who = V) => call(server, 'POST', '/api/agent/spaces', { ...who.T, body, ...extra });
    refused(await P({ name: 'Lisbon', template: templateId, members: [mia.key] }), 400, 'Only name, template, description, icon can be sent.', 'members');
    refused(await P({ name: 'Lisbon', template: templateId, closed: true }), 400, null, 'closed');
    refused(await P({ name: 'Lisbon', template: 'nope' }), 400, 'That template is not one this environment offers.', 'an unknown template');
    refused(await P({ name: 'Lisbon' }), 400, 'That template is not one this environment offers.', 'no template');
    refused(await P({ template: templateId }), 400, 'A space needs a name.', 'no name');
    refused(await P({ name: '   ', template: templateId }), 400, 'A space needs a name.', 'a blank name');
    refused(await P({ name: 7, template: templateId }), 400, 'name is text.', 'a number');
    refused(await P({ name: 'Lisbon', template: templateId, icon: 'not-an-icon-xyz' }), 400, 'That icon is not one this environment offers.', 'an unknown icon');
    refused(await P(null, { raw: Buffer.from('name=x'), headers: { 'content-type': 'application/x-www-form-urlencoded' } }), 400, 'Send { name, template, description, icon } as JSON.', 'not JSON');
    const r = await P({ name: 'Lisbon 2027', template: templateId, description: 'A secret plan', icon: icons.json.icons[0] }, {}, S);
    ok(r, 'made');
    assert.deepEqual(Object.keys(r.json.space).sort(), ['id', 'name']);
    made = r.json.space;
    const space = (await call(server, 'GET', `/api/spaces/${made.id}`, { cookie: admin })).json.space;
    assert.equal(space.madeBy, S.user.key, 'madeBy');
    assert.deepEqual(space.members, [S.user.key], 'the agent is its only member');
    assert.equal(space.template, templateId, 'its template');
    assert.deepEqual([space.name, space.description, space.linkIcon], ['Lisbon 2027', 'A secret plan', icons.json.icons[0]]);
    assert.deepEqual((await call(server, 'GET', '/api/agent/me', S.T)).json.spaces, [{ id: made.id, name: 'Lisbon 2027' }]);
    // A space a person makes carries no mark.
    const theirs = (await call(server, 'POST', '/api/spaces', { cookie: admin, body: { name: 'Camp' } })).json.space;
    assert.ok(!('madeBy' in theirs), 'no mark on a person\'s space');
  });

  await test('changing: only name, description and icon, only spaces it made; never the Lobby; Keep ends its reach', async () => {
    const C = (id, body) => call(server, 'PATCH', `/api/agent/spaces/${id}`, { ...S.T, body });
    ok(await C(made.id, { name: 'Lisbon 2028' }), 'renamed');
    const changed = await C(made.id, { description: 'Spring', icon: (await call(server, 'GET', '/api/agent/icons', S.T)).json.icons[1] });
    ok(changed, 'description and icon');
    assert.deepEqual(Object.keys(changed.json.space).sort(), ['description', 'icon', 'id', 'name']);
    // The refused bodies from another set-up agent, on a space it made, so the one under test stays inside its limits.
    const K = await setupOf('Keyer');
    const kept = (await call(server, 'POST', '/api/agent/spaces', { ...K.T, body: { name: 'Keys', template: templateId } })).json.space;
    const KC = (body) => call(server, 'PATCH', `/api/agent/spaces/${kept.id}`, { ...K.T, body });
    for (const key of ['members', 'closed', 'template', 'allowGuests', 'aiOff', 'madeBy', 'entry', 'call']) refused(await KC({ name: 'x', [key]: null }), 400, 'Only name, description, icon can be sent.', key);
    refused(await KC({}), 400, 'Send at least one of name, description or icon.', 'nothing');
    refused(await KC({ icon: 'not-an-icon-xyz' }), 400, 'That icon is not one this environment offers.', 'an unknown icon');
    assert.equal((await call(server, 'GET', `/api/spaces/${kept.id}`, { cookie: admin })).json.space.name, 'Keys', 'nothing refused changed it');
    const camp = (await call(server, 'GET', '/api/spaces', { cookie: admin })).json.spaces.find((x) => x.name === 'Camp');
    refused(await C(camp.id, { name: 'Mine' }), 404, 'no such space', 'a space a person made');
    ok(await call(server, 'PATCH', `/api/spaces/${camp.id}`, { cookie: admin, body: { members: [S.user.key] } }), 'even with it added as a member');
    refused(await C(camp.id, { name: 'Mine' }), 404, 'no such space', 'still not its own');
    refused(await C('lobby', { name: 'Mine' }), 404, 'no such space', 'the Lobby');
    refused(await C('zzzz9999', { name: 'Mine' }), 404, 'no such space', 'no space');
    const other = await setupOf('Other');
    const theirs = (await call(server, 'POST', '/api/agent/spaces', { ...other.T, body: { name: 'Theirs', template: templateId } })).json.space;
    refused(await C(theirs.id, { name: 'Mine' }), 404, 'no such space', 'another set-up agent\'s space');
    refused(await call(server, 'PATCH', `/api/spaces/${theirs.id}`, { cookie: miaC, body: { madeBy: null } }), 404, 'no such space', 'a member who is not in it can\'t Keep');
    refused(await call(server, 'PATCH', `/api/spaces/${theirs.id}`, { cookie: admin, body: { madeBy: 'abcd1234' } }), 400, 'madeBy can only be cleared, with null.', 'madeBy set by hand');
    ok(await call(server, 'PATCH', `/api/spaces/${theirs.id}`, { cookie: admin, body: { madeBy: null } }), 'Keep');
    assert.ok(!('madeBy' in (await call(server, 'GET', `/api/spaces/${theirs.id}`, { cookie: admin })).json.space), 'the mark is gone');
    refused(await call(server, 'PATCH', `/api/agent/spaces/${theirs.id}`, { ...other.T, body: { name: 'Again' } }), 404, 'no such space', 'its maker after Keep');
    // Taken off its members by an owner: its reach ends too.
    ok(await call(server, 'PATCH', `/api/spaces/${made.id}`, { cookie: admin, body: { members: [mia.key] } }), 'taken off');
    refused(await C(made.id, { name: 'X' }), 404, 'no such space', 'not a member any more');
    ok(await call(server, 'PATCH', `/api/spaces/${made.id}`, { cookie: admin, body: { members: [S.user.key, mia.key] } }), 'back');
    ok(await C(made.id, { name: 'Lisbon 2027' }), 'its own again');
    ok(await call(server, 'PATCH', `/api/users/${mia.key}/spaces/${made.id}`, { cookie: admin, body: { permissions: { moderator: true } } }), 'Mia moderates the one she is added to');
    refused(await call(server, 'PATCH', `/api/spaces/${made.id}`, { cookie: miaC, body: { madeBy: null } }), 403, 'owners only', 'nor a moderator');
  });

  await test('the gate: the set-up agent reads nothing in a space; the ordinary agent reaches none of the set-up routes; a person neither', async () => {
    ok(await call(server, 'PATCH', `/api/spaces/${made.id}`, { cookie: admin, body: { members: [S.user.key, mia.key, O.user.key] } }), 'the ordinary agent joins');
    for (const [method, url, body] of [
      ['GET', `/api/spaces/${made.id}/chat`], ['POST', `/api/spaces/${made.id}/chat`, { text: 'hi' }], ['GET', `/api/spaces/${made.id}/members`],
      ['GET', `/api/spaces/${made.id}/actions`], ['POST', `/api/spaces/${made.id}/action`, { action: 'x:y', input: {} }],
      ['GET', `/api/modules/todo/data?scope=space&space=${made.id}`], ['GET', '/api/objects/kinds'], ['POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize' }],
      ['PATCH', `/api/spaces/${made.id}`, { name: 'x' }], ['DELETE', `/api/spaces/${made.id}`], ['POST', '/api/spaces', { name: 'x' }],
      ['GET', `/api/spaces/${made.id}`], ['PUT', `/api/spaces/${made.id}/image`], ['GET', '/api/users'], ['PATCH', '/api/settings', { setupAgents: true }],
      ['PATCH', `/api/users/${mia.key}/spaces/${made.id}`, { permissions: { moderator: true } }], ['POST', `/api/users/${S.user.key}/token`],
    ]) refused(await call(server, method, url, { ...S.T, body }), 403, CANT, `set-up agent: ${method} ${url}`);
    ok(await call(server, 'GET', `/api/spaces/${made.id}/members`, O.T), 'the ordinary agent still reads members');
    for (const r of SETUP_OWN) {
      const [method, pattern] = r.split(' ');
      refused(await call(server, method, pattern.replace(':id', made.id), { ...O.T, body: method === 'GET' ? undefined : { name: 'x', template: templateId } }), 403, CANT, `ordinary agent: ${r}`);
      const person = await call(server, method, pattern.replace(':id', made.id), { cookie: admin, body: method === 'GET' ? undefined : { name: 'x', template: templateId } });
      refused(person, 403, "This is for a set-up agent's token only.", `a person: ${r}`);
      refused(await call(server, method, pattern.replace(':id', made.id), { body: method === 'GET' ? undefined : {} }), 401, 'sign in first', `nobody: ${r}`);
    }
  });

  await test('the gate walked: every route and mount but the set-up list answers a set-up agent 403', async () => {
    const rows = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'route-table.json'), 'utf8')).rows;
    const gate = rows.findIndex((r) => r.kind === 'use' && r.name === 'agentGate');
    assert.ok(gate > 0, 'the gate is in the table');
    const after = rows.slice(gate);
    for (const r of SETUP_LIST) assert.ok(after.some((x) => x.kind === 'route' && `${x.method} ${x.path}` === r), `${r} is a route after the gate`);
    const urlOf = (pattern) => pattern.replace(/[{}]/g, '').replace(/\*[A-Za-z]+/g, 'a/b').replace(/:([A-Za-z]+)/g, 'x1234');
    // Fresh set-up agents as the walk goes, so no limit is reached (20 writes and 60 reads a minute each).
    const pool = { n: 0, used: 0, token: null };
    const P = async () => {
      if (!pool.token || pool.used >= 15) { pool.token = (await setupOf(`Walker ${pool.n += 1}`)).token; pool.used = 0; }
      pool.used += 1;
      return { token: pool.token };
    };
    let walked = 0;
    for (const { kind, method, path: at, name } of after) {
      if (kind === 'route') {
        if (SETUP_LIST.has(`${method} ${at}`)) continue;
        const verb = method === '_all' ? 'GET' : method;
        const r = await call(server, verb, urlOf(at), { ...(await P()), body: ['POST', 'PUT', 'PATCH'].includes(verb) ? {} : undefined });
        refused(r, 403, CANT, `${method} ${at}`);
      } else {
        if (at === '/') continue;
        refused(await call(server, 'GET', `${urlOf(at)}/x.js`, await P()), 403, CANT, `${name} at ${at}`);
      }
      walked += 1;
    }
    assert.ok(walked > 300, `walked ${walked}`);
  });

  await test('the log: one line a call with space and change, never a name or a description', async () => {
    const lines = await waitLines(single, S.user.key, 1);
    const madeLine = lines.find((l) => l.change === 'made' && l.status === 200);
    assert.ok(madeLine, 'a made line');
    assert.deepEqual([madeLine.route, madeLine.method, madeLine.space, madeLine.kind], ['/api/agent/spaces', 'POST', made.id, 'write']);
    const changes = lines.filter((l) => l.route === '/api/agent/spaces/:id' && l.status === 200).map((l) => l.change);
    assert.deepEqual(changes.slice(0, 2), ['renamed', 'described,icon']);
    assert.ok(lines.filter((l) => l.route === '/api/agent/spaces/:id' && l.status === 200).every((l) => l.space === made.id), 'the space of each change');
    assert.ok(lines.filter((l) => l.status !== 200).every((l) => l.change === null), 'a refused call names no change');
    const text = fs.readFileSync(path.join(single, 'agent-log', S.user.key, `${dayToday()}.jsonl`), 'utf8');
    for (const words of ['Lisbon', 'secret plan', 'Spring', 'Mine']) assert.ok(!text.includes(words), `"${words}" is not in the log`);
  });

  await test('Set-up agents off: the set-up agent\'s token is 401 and none can be made; an ordinary agent is unchanged', async () => {
    ok(await call(server, 'PATCH', '/api/settings', { cookie: admin, body: { setupAgents: false } }), 'off');
    refused(await call(server, 'GET', '/api/agent/me', S.T), 401, INVALID, 'its token');
    refused(await call(server, 'POST', '/api/agent/spaces', { ...S.T, body: { name: 'X', template: templateId } }), 401, INVALID, 'making');
    refused(await call(server, 'POST', '/api/users', { cookie: admin, body: { agent: true, kind: 'setup' } }), 403, 'Set-up agents are off in this environment. Turn on Set-up agents in Manage first.', 'a new one');
    refused(await call(server, 'POST', `/api/users/${S.user.key}/token`, { cookie: admin }), 403, 'Set-up agents are off in this environment. Turn on Set-up agents in Manage first.', 'a new token');
    ok(await call(server, 'GET', '/api/agent/me', O.T), 'the ordinary agent');
    ok(await call(server, 'GET', `/api/users/${S.user.key}/agent-log`, { cookie: admin }), 'its log is still read');
    ok(await call(server, 'PATCH', '/api/settings', { cookie: admin, body: { setupAgents: true } }), 'on again');
    ok(await call(server, 'GET', '/api/agent/me', S.T), 'its token works again');
  });

  // The daily caps, read back from the log after a restart: seed today's file with what it has already done.
  await server.stop();
  await test('the daily caps: 5 spaces and 30 changes give 429, and survive a restart', async () => {
    const file = path.join(single, 'agent-log', S.user.key, `${dayToday()}.jsonl`);
    const at = new Date().toISOString();
    const line = (change, status = 200) => `${JSON.stringify({ at, agent: S.user.key, token: 'x', method: change === 'made' ? 'POST' : 'PATCH', route: change === 'made' ? '/api/agent/spaces' : '/api/agent/spaces/:id', space: null, status, kind: 'write', change })}\n`;
    const madeSoFar = logLines(single, S.user.key).filter((l) => l.change === 'made' && l.status === 200).length;
    const changedSoFar = logLines(single, S.user.key).filter((l) => l.change && l.change !== 'made' && l.status === 200).length;
    // Lines that never count: a refused one, a 429, a made line with a change word it can't have.
    fs.appendFileSync(file, line('made', 403) + line('made', 429) + line('made,renamed') + line('nonsense'));
    fs.appendFileSync(file, line('made').repeat(SETUP_LIMITS.made - madeSoFar - 1) + line('renamed').repeat(SETUP_LIMITS.changes - changedSoFar - 1));
    server = await startServer(single, ON);
    let me = (await call(server, 'GET', '/api/agent/me', S.T)).json;
    assert.deepEqual([me.limits.made.usedToday, me.limits.changes.usedToday], [SETUP_LIMITS.made - 1, SETUP_LIMITS.changes - 1], 'read back from the log');
    ok(await call(server, 'POST', '/api/agent/spaces', { ...S.T, body: { name: 'Last', template: templateId } }), 'the fifth');
    const over = await call(server, 'POST', '/api/agent/spaces', { ...S.T, body: { name: 'One more', template: templateId } });
    refused(over, 429, 'This agent has made as many spaces as it may today.', 'the sixth');
    assert.ok(Number(over.headers['retry-after']) > 0, 'Retry-After');
    ok(await call(server, 'PATCH', `/api/agent/spaces/${made.id}`, { ...S.T, body: { name: 'The 30th' } }), 'the 30th change');
    refused(await call(server, 'PATCH', `/api/agent/spaces/${made.id}`, { ...S.T, body: { name: 'The 31st' } }), 429, OVER, 'the 31st');
    await server.stop();
    server = await startServer(single, ON);
    me = (await call(server, 'GET', '/api/agent/me', S.T)).json;
    assert.deepEqual([me.limits.made.usedToday, me.limits.changes.usedToday], [SETUP_LIMITS.made, SETUP_LIMITS.changes], 'after a restart');
    refused(await call(server, 'POST', '/api/agent/spaces', { ...S.T, body: { name: 'One more', template: templateId } }), 429, 'This agent has made as many spaces as it may today.', 'still over');
  });
  await server.stop();

  // AGENT_SETUP off on the same data: everything as before for people and ordinary agents.
  server = await startServer(single, { ADMIN_PASSWORD: 'admin-password-1', AGENT_TOKENS: 'true' });
  admin = await signIn(server, 'admin', 'admin-password-1');
  await test('AGENT_SETUP off: the set-up agent is 401, no set-up column, nothing can turn it on; an ordinary agent works', async () => {
    refused(await call(server, 'GET', '/api/agent/me', S.T), 401, INVALID, 'its token');
    ok(await call(server, 'GET', '/api/agent/me', O.T), 'the ordinary agent');
    const roles = (await call(server, 'GET', '/api/roles', { cookie: admin })).json;
    assert.deepEqual(roles.columns, ['owner', 'moderator', 'member', 'guest', 'agent']);
    assert.ok(!('setup' in roles.never) && !roles.permissions.some((p) => p.column === 'setup'), 'no set-up rows');
    refused(await call(server, 'PATCH', '/api/roles/setup', { cookie: admin, body: { agentMakeSpaces: true } }), 404, 'no such role', 'the set-up column');
    const settings = (await call(server, 'GET', '/api/settings', { cookie: admin })).json.settings;
    assert.equal(settings.agentSetup, false);
    ok(await call(server, 'PATCH', '/api/settings', { cookie: admin, body: { setupAgents: false } }), 'off always goes through');
    refused(await call(server, 'PATCH', '/api/settings', { cookie: admin, body: { setupAgents: true } }), 403, 'Set-up agents are off on this server.', 'on');
    refused(await call(server, 'POST', '/api/users', { cookie: admin, body: { agent: true, kind: 'setup' } }), 403, 'Set-up agents are off on this server.', 'a new one');
  });
  await server.stop();

  // A server with neither variable: as before.
  server = await startServer(path.join(base, 'plain'), { ADMIN_PASSWORD: 'admin-password-1', AGENT_SETUP: 'true' });
  admin = await signIn(server, 'admin', 'admin-password-1');
  await test('AGENT_SETUP without AGENT_TOKENS: off, and said so at start', async () => {
    assert.match(server.out, /AGENT_SETUP=true needs AGENT_TOKENS=true too/);
    const roles = (await call(server, 'GET', '/api/roles', { cookie: admin })).json;
    assert.deepEqual(roles.columns, ['owner', 'moderator', 'member', 'guest']);
    refused(await call(server, 'POST', '/api/users', { cookie: admin, body: { agent: true, kind: 'setup' } }), 403, 'Agents are off on this server.', 'a set-up agent');
  });
  await server.stop();

  // Hosted: a set-up agent's token of one environment is nobody at another.
  const hosted = path.join(base, 'hosted');
  server = await startServer(hosted, { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'boss', ADMIN_PASSWORD: 'host-password-1', AGENT_TOKENS: 'true', AGENT_SETUP: 'true' });
  const host = await signIn(server, 'boss', 'host-password-1', 'admin');
  for (const slug of ['acme', 'beta']) {
    ok(await call(server, 'POST', '/api/host/environments', { host: 'admin', cookie: host, body: { slug, name: slug, owner: { login: 'owner', password: 'owner-password-1' } } }), `${slug} made`, 201);
  }
  await test('hosted: a set-up agent works in its own environment and is 401 at another', async () => {
    const acme = await signIn(server, 'owner', 'owner-password-1', 'acme');
    const beta = await signIn(server, 'owner', 'owner-password-1', 'beta');
    for (const [slug, cookie] of [['acme', acme], ['beta', beta]]) ok(await call(server, 'PATCH', '/api/settings', { host: slug, cookie, body: { agents: true, setupAgents: true } }), `${slug} turns them on`);
    ok(await call(server, 'PATCH', '/api/roles/setup', { host: 'acme', cookie: acme, body: { agentMakeSpaces: true } }), 'acme ticks Make');
    const a = (await call(server, 'POST', '/api/users', { host: 'acme', cookie: acme, body: { agent: true, kind: 'setup' } })).json.user;
    const t = (await call(server, 'POST', `/api/users/${a.key}/token`, { host: 'acme', cookie: acme })).json.token;
    const tpl = (await call(server, 'GET', '/api/agent/templates', { host: 'acme', token: t })).json.templates[0].id;
    ok(await call(server, 'POST', '/api/agent/spaces', { host: 'acme', token: t, body: { name: 'Acme trip', template: tpl } }), 'makes at acme');
    refused(await call(server, 'GET', '/api/agent/me', { host: 'beta', token: t }), 401, INVALID, 'at beta');
    refused(await call(server, 'POST', '/api/agent/spaces', { host: 'beta', token: t, body: { name: 'Beta trip', template: tpl } }), 401, INVALID, 'making at beta');
    assert.ok(!(await call(server, 'GET', '/api/spaces', { host: 'beta', cookie: beta })).json.spaces.some((s) => s.name === 'Beta trip'), 'nothing made at beta');
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
  console.error(`check-agent-setup: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-agent-setup: ${n} passed`);
