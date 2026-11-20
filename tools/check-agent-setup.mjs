#!/usr/bin/env node
/*
 * check-agent-setup.mjs -- the set-up agent, step 1 (documentation/plans/plan-admin-agent.md, "Verify"; its column is
 * plan-agent-matrix.md decision 3). On throwaway servers, single and hosted:
 *   - the switches: AGENT_SETUP off, or Set-up agents off, makes the set-up agent's token 401 and leaves an ordinary agent as
 *     it was; no set-up agent can be made then; the Roles grid shows the set-up column only with AGENT_SETUP, and
 *     PATCH /api/roles/setup is 404 without it;
 *   - the account: kind "setup", a member and never anything more, its kind never changes, made only by an owner or the
 *     admin, a name can't end in "(set-up agent)";
 *   - the column: only "Make {spaces}", "Rename and change {spaces}" and "Ask to add people", all off by default; a never
 *     row is 400; the rows are refused on every other column;
 *   - the gate walked from the route table: the set-up agent reaches only its own routes (every other route and mount is
 *     403 "An agent can't do that.", Chat, module data and /api/spaces/:id/members among them), and an ordinary agent gets
 *     403 on every one of the set-up agent's;
 *   - bodies: any other key is 400, an unknown template or icon is 400 with its sentence, the space made has `madeBy` and
 *     the agent as a member, a person's own template list decides;
 *   - reach: a space it did not make is 404, the Lobby too; Keep (an owner's madeBy: null) ends its reach;
 *   - the daily caps (5 spaces, 30 changes) answer 429 and survive a restart (read back from the log);
 *   - the log: one line a call with `space` and `change`, never a name or a description;
 *   - hosted: a set-up agent's token of one environment is 401 at another.
 * Step 2 (asks and undo):
 *   - the people list: the environment's members only (never a guest, an agent, an owner or the admin), only with "Ask to
 *     add people" ticked;
 *   - asks: bodies checked, a person outside the list refused, a space it did not make 404; an ask changes nothing until an
 *     owner approves, the owners get one bell line, the status reads waiting, approved, declined or expired; approving does
 *     it (add, take off, the moderator tick), declining does not; the same answer twice changes nothing, the other is 409;
 *     a member, the agent itself and an ordinary agent can't answer;
 *   - the waiting cap of 10 (429 with Retry-After), 7-day expiry read back after a restart, Turn off and Keep end them;
 *   - undo, by an owner only: a change puts back the earlier values (not one changed again since), a made space is deleted
 *     only while nobody else has written in it and no Keep; past 7 days it is gone; the agent can't undo;
 *   - the log: an ask's line carries `ask:<what>` and the space, never the person, and is not a change against the cap.
 * Not here: the MCP tools (that plan's step 3, tools/check-mcp.mjs); a real Claude client; the bell seen by a person.
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
// The routes only the set-up agent has: not its me, nor the MCP door both kinds have (check-mcp.mjs checks its tools).
const SETUP_OWN = [...SETUP_LIST].filter((r) => r !== 'GET /api/agent/me' && !r.endsWith(' /mcp'));

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

  await test('the column: shown with AGENT_SETUP, only its three rows, all off; never rows are 400; its rows are no one else\'s', async () => {
    const roles = (await call(server, 'GET', '/api/roles', { cookie: admin })).json;
    assert.deepEqual(roles.columns, ['owner', 'moderator', 'member', 'guest', 'agent', 'setup']);
    const rows = roles.permissions.filter((p) => p.column === 'setup');
    assert.deepEqual(rows.map((p) => p.key), ['agentMakeSpaces', 'agentChangeSpaces', 'agentAskPeople']);
    assert.deepEqual(rows.map((p) => p.label), ['Make spaces', 'Rename and change spaces', 'Ask to add people']);
    assert.ok(rows.every((p) => p.agentOnly === true && p.group === 'Agents'));
    const keys = roles.permissions.map((p) => p.key);
    assert.deepEqual(keys.filter((k) => !roles.never.setup.includes(k)).sort(), ['agentAskPeople', 'agentChangeSpaces', 'agentMakeSpaces']);
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
      ['GET', `/api/modules/todo/data?scope=space&space=${made.id}`], ['GET', '/api/objects/kinds'],
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

  // --- step 2: the people list, asks and undo -------------------------------------------------------------------------
  const olgaKey = (await call(server, 'GET', '/api/users', { cookie: admin })).json.users.find((u) => u.login === 'olga').key;
  const adminKey = (await call(server, 'GET', '/api/users', { cookie: admin })).json.users.find((u) => u.role === 'admin').key;
  const ask = (who, spaceId, body) => call(server, 'POST', `/api/agent/spaces/${spaceId}/asks`, { ...who.T, body });
  const answer = (who, id, decision, cookie = olga) => call(server, 'POST', `/api/users/${who.user.key}/asks/${id}`, { cookie, body: { decision } });
  const spaceOf = async (id) => (await call(server, 'GET', `/api/spaces/${id}`, { cookie: admin })).json?.space;
  const madeBy = async (who, name) => (await call(server, 'POST', '/api/agent/spaces', { ...who.T, body: { name, template: templateId } })).json.space;
  const A = await setupOf('Asker');
  let porto = null;

  await test('the people list: only with Ask to add people ticked; the members, never an owner, the admin or an agent', async () => {
    refused(await call(server, 'GET', '/api/agent/people', A.T), 403, CANT, 'unticked');
    porto = await madeBy(A, 'Porto');
    refused(await ask(A, porto.id, { ask: 'add', person: mia.key }), 403, CANT, 'an ask, unticked');
    ok(await column({ agentAskPeople: true }), 'ticked');
    assert.deepEqual((await call(server, 'GET', '/api/agent/me', A.T)).json.permissions, ['agentMakeSpaces', 'agentChangeSpaces', 'agentAskPeople']);
    const r = await call(server, 'GET', '/api/agent/people', A.T);
    ok(r, 'people');
    const users = (await call(server, 'GET', '/api/users', { cookie: admin })).json.users;
    const members = users.filter((u) => u.role === 'member' && !u.agent).map((u) => u.key).sort();
    assert.deepEqual(r.json.people.map((p) => p.key).sort(), members, 'every member account, nothing else');
    assert.ok(r.json.people.every((p) => Object.keys(p).sort().join() === 'key,name'), 'only key and name');
    for (const key of [olgaKey, adminKey, S.user.key, O.user.key, A.user.key]) assert.ok(!r.json.people.some((p) => p.key === key), `${key} is not listed`);
    assert.deepEqual(r.json.people.find((p) => p.key === mia.key), { key: mia.key, name: 'Mia' });
  });

  await test('asking: bodies checked, only members of the environment, only spaces it made', async () => {
    const R = await setupOf('Refused');
    const mine = await madeBy(R, 'Refusals');
    const P = (body, extra = {}) => call(server, 'POST', `/api/agent/spaces/${mine.id}/asks`, { ...R.T, body, ...extra });
    const NOT_MEMBER = 'An agent can only ask to add a member of this environment.';
    refused(await P({ ask: 'add', person: olgaKey }), 400, NOT_MEMBER, 'an owner');
    refused(await P({ ask: 'add', person: adminKey }), 400, NOT_MEMBER, 'the admin');
    refused(await P({ ask: 'add', person: O.user.key }), 400, NOT_MEMBER, 'an agent');
    refused(await P({ ask: 'add', person: R.user.key }), 400, NOT_MEMBER, 'itself');
    refused(await P({ ask: 'add', person: 'zzzz9999' }), 400, NOT_MEMBER, 'nobody');
    refused(await P({ ask: 'remove', person: olgaKey }), 400, 'An agent can only ask about a member of this environment.', 'taking an owner off');
    refused(await P({ ask: 'invite', person: mia.key }), 400, 'ask is one of: add, remove, moderator.', 'another ask');
    refused(await P({ ask: 'add', person: 7 }), 400, "person is a person's key, from the people list.", 'a number');
    refused(await P({ ask: 'add', person: mia.key, on: true }), 400, 'on goes only with the ask that ticks or unticks a moderator.', 'on with add');
    refused(await P({ ask: 'moderator', person: mia.key }), 400, 'on is true or false: tick or untick them as moderator.', 'moderator without on');
    refused(await P({ ask: 'add', person: mia.key, role: 'owner' }), 400, 'Only ask, person, on can be sent.', 'another key');
    refused(await P(null, { raw: Buffer.from('ask=add'), headers: { 'content-type': 'application/x-www-form-urlencoded' } }), 400, 'Send { ask, person, on } as JSON.', 'not JSON');
    refused(await P({ ask: 'remove', person: mia.key }), 409, 'They are not in this space.', 'taking off someone not in it');
    refused(await P({ ask: 'moderator', person: mia.key, on: true }), 409, 'They are not in this space.', 'ticking someone not in it');
    const camp = (await call(server, 'GET', '/api/spaces', { cookie: admin })).json.spaces.find((x) => x.name === 'Camp');
    refused(await call(server, 'POST', `/api/agent/spaces/${camp.id}/asks`, { ...R.T, body: { ask: 'add', person: mia.key } }), 404, 'no such space', 'a space a person made');
    refused(await call(server, 'POST', '/api/agent/spaces/lobby/asks', { ...R.T, body: { ask: 'add', person: mia.key } }), 404, 'no such space', 'the Lobby');
    refused(await call(server, 'POST', `/api/agent/spaces/${porto.id}/asks`, { ...R.T, body: { ask: 'add', person: mia.key } }), 404, 'no such space', 'another set-up agent\'s space');
    assert.equal((await call(server, 'GET', `/api/users/${R.user.key}/asks`, { cookie: admin })).json.asks.length, 0, 'nothing refused was kept');
  });

  let addId = null;
  await test('an ask changes nothing until an owner approves; the owners get one bell line; approving adds them', async () => {
    const r = await ask(A, porto.id, { ask: 'add', person: mia.key });
    ok(r, 'asked', 202);
    assert.deepEqual(Object.keys(r.json.ask).sort(), ['id', 'state']);
    assert.equal(r.json.ask.state, 'waiting');
    addId = r.json.ask.id;
    assert.deepEqual((await spaceOf(porto.id)).members, [A.user.key], 'nobody added yet');
    refused(await ask(A, porto.id, { ask: 'add', person: mia.key }), 409, 'This agent has asked that already. Wait for an answer.', 'the same again');
    const status = await call(server, 'GET', `/api/agent/asks/${addId}`, A.T);
    ok(status, 'its status');
    assert.deepEqual([status.json.ask.state, status.json.ask.ask, status.json.ask.person, status.json.ask.space], ['waiting', 'add', mia.key, porto.id]);
    refused(await call(server, 'GET', `/api/agent/asks/${addId}`, S.T), 404, 'No such ask.', 'another agent\'s ask');
    refused(await call(server, 'GET', '/api/agent/asks/0000000000000000', A.T), 404, 'No such ask.', 'no such ask');
    const me = (await call(server, 'GET', '/api/agent/me', A.T)).json;
    assert.deepEqual(me.asks.map((a) => a.id), [addId], 'me lists it');
    assert.deepEqual(me.limits.asks, { waitingAtOnce: 10, waiting: 1 });
    const text = 'Asker (set-up agent) asks to add Mia to Porto.';
    const bell = (await call(server, 'GET', '/api/notifications', { cookie: olga })).json.notifications;
    assert.equal(bell.filter((x) => x.title === text).length, 1, 'one bell line for an owner');
    assert.ok(bell.find((x) => x.title === text).href === `/admin#agent/${A.user.key}`, 'it opens the agent\'s page');
    assert.ok(!(await call(server, 'GET', '/api/notifications', { cookie: miaC })).json.notifications.some((x) => x.title === text), 'not to a member');
    const listed = (await call(server, 'GET', `/api/users/${A.user.key}/asks`, { cookie: olga })).json.asks;
    assert.deepEqual([listed[0].text, listed[0].person.name, listed[0].space.name, listed[0].state], [text, 'Mia', 'Porto', 'waiting']);
    // Who can't answer: a member, the agent itself, an ordinary agent, nobody.
    refused(await answer(A, addId, 'approve', miaC), 403, null, 'a member');
    refused(await call(server, 'POST', `/api/users/${A.user.key}/asks/${addId}`, { ...A.T, body: { decision: 'approve' } }), 403, CANT, 'the agent itself');
    refused(await call(server, 'POST', `/api/users/${A.user.key}/asks/${addId}`, { ...O.T, body: { decision: 'approve' } }), 403, CANT, 'an ordinary agent');
    refused(await call(server, 'POST', `/api/users/${A.user.key}/asks/${addId}`, { body: { decision: 'approve' } }), 401, null, 'nobody');
    refused(await answer(A, addId, 'yes'), 400, 'decision is approve or decline.', 'another word');
    refused(await answer(S, addId, 'approve'), 404, 'No such ask.', 'under another agent');
    assert.deepEqual((await spaceOf(porto.id)).members, [A.user.key], 'still nobody added');
    const yes = await answer(A, addId, 'approve');
    ok(yes, 'approved');
    assert.deepEqual([yes.json.changed, yes.json.ask.state, yes.json.ask.decidedBy.key], [true, 'approved', olgaKey]);
    assert.deepEqual((await spaceOf(porto.id)).members.sort(), [A.user.key, mia.key].sort(), 'Mia is in');
    const again = await answer(A, addId, 'approve');
    ok(again, 'the same answer again');
    assert.equal(again.json.changed, false);
    refused(await answer(A, addId, 'decline'), 409, 'That ask was answered already.', 'the other answer');
    assert.equal((await call(server, 'GET', `/api/agent/asks/${addId}`, A.T)).json.ask.state, 'approved');
    assert.deepEqual((await call(server, 'GET', '/api/agent/me', A.T)).json.asks, [], 'nothing waiting');
  });

  await test('the moderator tick and taking off: approve does it, decline does not', async () => {
    const tick = (await ask(A, porto.id, { ask: 'moderator', person: mia.key, on: true })).json.ask.id;
    const flag = async () => (await call(server, 'GET', `/api/users/${mia.key}`, { cookie: admin })).json.user.spaces[porto.id].permissions.moderator;
    assert.equal(await flag(), false, 'not yet');
    ok(await answer(A, tick, 'approve'), 'approved');
    assert.equal(await flag(), true, 'Mia moderates Porto');
    refused(await ask(A, porto.id, { ask: 'moderator', person: mia.key, on: true }), 409, 'They are its moderator already.', 'ticked already');
    const off = (await ask(A, porto.id, { ask: 'remove', person: mia.key })).json.ask.id;
    const no = await answer(A, off, 'decline');
    ok(no, 'declined');
    assert.equal(no.json.ask.state, 'declined');
    assert.ok((await spaceOf(porto.id)).members.includes(mia.key), 'declining leaves her in');
    refused(await answer(A, off, 'approve'), 409, 'That ask was answered already.', 'approve after decline');
    assert.equal((await call(server, 'GET', `/api/agent/asks/${off}`, A.T)).json.ask.state, 'declined');
    const untick = (await ask(A, porto.id, { ask: 'moderator', person: mia.key, on: false })).json.ask.id;
    ok(await answer(A, untick, 'approve', admin), 'the admin approves');
    assert.equal(await flag(), false, 'unticked');
    const out = (await ask(A, porto.id, { ask: 'remove', person: mia.key })).json.ask.id;
    ok(await answer(A, out, 'approve'), 'approved');
    assert.ok(!(await spaceOf(porto.id)).members.includes(mia.key), 'taken off');
  });

  let C = null;
  let capFirst = null;
  await test('the waiting cap: 10 at once, then 429 with Retry-After', async () => {
    C = await setupOf('Capper');
    const capSpace = await madeBy(C, 'Lots');
    const keys = [];
    for (let i = 0; i < SETUP_LIMITS.waiting + 1; i += 1) {
      keys.push((await call(server, 'POST', '/api/users', { cookie: admin, body: { login: `cap${i}`, displayName: `Cap ${i}`, password: 'cap-password-1', role: 'member' } })).json.user.key);
    }
    for (let i = 0; i < SETUP_LIMITS.waiting; i += 1) {
      const r = await ask(C, capSpace.id, { ask: 'add', person: keys[i] });
      ok(r, `ask ${i + 1}`, 202);
      if (i === 0) capFirst = r.json.ask.id;
    }
    const over = await ask(C, capSpace.id, { ask: 'add', person: keys[SETUP_LIMITS.waiting] });
    refused(over, 429, OVER, 'the eleventh');
    assert.ok(Number(over.headers['retry-after']) > 6 * 86400, 'Retry-After: until the oldest runs out');
    assert.equal((await call(server, 'GET', '/api/agent/me', C.T)).json.limits.asks.waiting, SETUP_LIMITS.waiting);
    ok(await answer(C, capFirst, 'decline'), 'one answered');
    ok(await ask(C, capSpace.id, { ask: 'add', person: keys[SETUP_LIMITS.waiting] }), 'a place free again', 202);
  });

  await test('Turn off and Keep end its waiting asks; an ended ask can\'t be approved', async () => {
    const T = await setupOf('Stopper');
    const lake = await madeBy(T, 'Lake');
    const first = (await ask(T, lake.id, { ask: 'add', person: mia.key })).json.ask.id;
    ok(await call(server, 'PATCH', `/api/users/${T.user.key}`, { cookie: admin, body: { off: true } }), 'turned off');
    assert.equal((await call(server, 'GET', `/api/users/${T.user.key}/asks`, { cookie: olga })).json.asks[0].state, 'expired');
    ok(await call(server, 'PATCH', `/api/users/${T.user.key}`, { cookie: admin, body: { off: false } }), 'on again');
    refused(await answer(T, first, 'approve'), 409, 'That ask has run out.', 'still ended');
    assert.ok(!(await spaceOf(lake.id)).members.includes(mia.key), 'nobody added');
    const token = (await call(server, 'POST', `/api/users/${T.user.key}/token`, { cookie: admin })).json.token;
    const second = (await call(server, 'POST', `/api/agent/spaces/${lake.id}/asks`, { token, body: { ask: 'add', person: mia.key } })).json.ask.id;
    ok(await call(server, 'PATCH', `/api/spaces/${lake.id}`, { cookie: admin, body: { madeBy: null } }), 'Keep');
    assert.equal((await call(server, 'GET', `/api/agent/asks/${second}`, { token })).json.ask.state, 'expired', 'Keep ended it');
    refused(await answer(T, second, 'approve'), 409, 'That ask has run out.', 'after Keep');
  });

  let U = null;
  const undoRefs = {};
  await test('undo, by an owner: a change puts back the earlier values; not one changed again since; never twice', async () => {
    U = await setupOf('Undoer');
    const icons = (await call(server, 'GET', '/api/agent/icons', U.T)).json.icons;
    const sp = await madeBy(U, 'Rome');
    ok(await call(server, 'PATCH', `/api/agent/spaces/${sp.id}`, { ...U.T, body: { name: 'Rome 2027', description: 'Spring', icon: icons[2] } }), 'changed');
    const listed = (await call(server, 'GET', `/api/users/${U.user.key}/changes`, { cookie: olga })).json;
    assert.equal(listed.days, 7);
    assert.deepEqual(Object.keys(listed.limits).sort(), ['changes', 'made'], 'the changes list carries what it has left today');
    assert.deepEqual([listed.limits.made.perDay, listed.limits.changes.perDay], [5, 30]);
    assert.ok(listed.limits.made.usedToday >= 1 && listed.limits.changes.usedToday >= 1, 'and what it used');
    const [change, made] = listed.changes;
    assert.deepEqual([change.change, made.change], ['changed', 'made']);
    assert.deepEqual(change.before.name, 'Rome');
    assert.deepEqual(change.after, { name: 'Rome 2027', description: 'Spring', icon: icons[2] });
    assert.deepEqual([change.undoable, made.undoable], [true, true], 'both can be undone');
    // Who can't undo: a member, the agent itself (no route of its own does), an ordinary agent.
    refused(await call(server, 'POST', `/api/users/${U.user.key}/changes/${change.id}/undo`, { cookie: miaC }), 403, null, 'a member');
    refused(await call(server, 'POST', `/api/users/${U.user.key}/changes/${change.id}/undo`, U.T), 403, CANT, 'the agent itself');
    refused(await call(server, 'POST', `/api/users/${U.user.key}/changes/${made.id}/undo`, U.T), 403, CANT, 'the agent itself, its space');
    refused(await call(server, 'DELETE', `/api/spaces/${sp.id}`, U.T), 403, CANT, 'the agent deleting');
    const r = await call(server, 'POST', `/api/users/${U.user.key}/changes/${change.id}/undo`, { cookie: olga });
    ok(r, 'undone');
    const back = await spaceOf(sp.id);
    assert.deepEqual([back.name, back.description, back.linkIcon], ['Rome', '', change.before.icon], 'the earlier name, description and icon');
    refused(await call(server, 'POST', `/api/users/${U.user.key}/changes/${change.id}/undo`, { cookie: olga }), 409, 'That was undone already.', 'twice');
    // A rename a person changed again since is not undone over their change.
    ok(await call(server, 'PATCH', `/api/agent/spaces/${sp.id}`, { ...U.T, body: { name: 'Roma' } }), 'renamed again');
    const rename = (await call(server, 'GET', `/api/users/${U.user.key}/changes`, { cookie: olga })).json.changes[0];
    ok(await call(server, 'PATCH', `/api/spaces/${sp.id}`, { cookie: admin, body: { name: 'Rome by Olga' } }), 'a person renames it');
    const after = (await call(server, 'GET', `/api/users/${U.user.key}/changes`, { cookie: olga })).json.changes[0];
    assert.deepEqual([after.undoable, after.why], [false, 'That has been changed again since, so there is nothing to undo.']);
    refused(await call(server, 'POST', `/api/users/${U.user.key}/changes/${rename.id}/undo`, { cookie: olga }), 409, 'That has been changed again since, so there is nothing to undo.', 'over a person\'s change');
    assert.equal((await spaceOf(sp.id)).name, 'Rome by Olga');
    refused(await call(server, 'POST', `/api/users/${U.user.key}/changes/0000000000000000/undo`, { cookie: olga }), 404, 'No such change. A change can be undone for 7 days.', 'no such change');
    undoRefs.rome = sp.id;
  });

  await test('undo of a made space: deleted while untouched; refused once someone wrote in it, or after Keep', async () => {
    const quiet = await madeBy(U, 'Quiet');
    const busy = await madeBy(U, 'Busy');
    const kept = await madeBy(U, 'Kept one');
    const changes = (await call(server, 'GET', `/api/users/${U.user.key}/changes`, { cookie: olga })).json.changes;
    const of = (id) => changes.find((c) => c.change === 'made' && c.space.id === id);
    ok(await call(server, 'POST', `/api/spaces/${busy.id}/chat`, { cookie: admin, body: { text: 'Our plans' } }), 'someone writes in Busy');
    ok(await call(server, 'PATCH', `/api/spaces/${kept.id}`, { cookie: admin, body: { madeBy: null } }), 'Keep');
    refused(await call(server, 'POST', `/api/users/${U.user.key}/changes/${of(busy.id).id}/undo`, { cookie: olga }), 409, 'Someone has written in this space, so undo would lose their work. Delete it in Set up if it should go.', 'written in');
    assert.ok(await spaceOf(busy.id), 'Busy is still there');
    refused(await call(server, 'POST', `/api/users/${U.user.key}/changes/${of(kept.id).id}/undo`, { cookie: olga }), 409, 'An owner chose Keep for this space, so it stays.', 'after Keep');
    const r = await call(server, 'POST', `/api/users/${U.user.key}/changes/${of(quiet.id).id}/undo`, { cookie: olga });
    ok(r, 'undone');
    assert.deepEqual([r.json.change, r.json.space], ['made', null]);
    refused(await call(server, 'GET', `/api/spaces/${quiet.id}`, { cookie: admin }), 404, null, 'Quiet is gone');
    assert.ok(!(await call(server, 'GET', `/api/users/${U.user.key}/changes`, { cookie: olga })).json.changes.some((c) => c.space.id === quiet.id), 'its records went with it');
  });

  await test('the log: an ask is ask:<what> with the space, never the person; it is not a change against the cap', async () => {
    const lines = await waitLines(single, A.user.key, 1);
    const asks = lines.filter((l) => l.route === '/api/agent/spaces/:id/asks' && l.status === 202);
    assert.deepEqual(asks.map((l) => l.change), ['ask:add', 'ask:moderator', 'ask:remove', 'ask:moderator', 'ask:remove']);
    assert.ok(asks.every((l) => l.space === porto.id && l.kind === 'write'), 'the space, counted as a write');
    assert.ok(lines.filter((l) => l.status !== 200 && l.status !== 202).every((l) => l.change === null), 'a refused call names no change');
    const text = fs.readFileSync(path.join(single, 'agent-log', A.user.key, `${dayToday()}.jsonl`), 'utf8');
    for (const words of [mia.key, 'Mia', 'Porto']) assert.ok(!text.includes(words), `"${words}" is not in the log`);
    assert.equal((await call(server, 'GET', '/api/agent/me', A.T)).json.limits.changes.usedToday, 0, 'asks are not changes');
    const stored = fs.readFileSync(path.join(single, 'agent-setup.json'), 'utf8');
    assert.ok(!stored.includes('Mia'), 'the asks file keeps keys, never a person\'s name');
    assert.equal(fs.statSync(path.join(single, 'agent-setup.json')).mode & 0o777, 0o600, 'private to the server');
  });

  await test('Set-up agents off: the set-up agent\'s token is 401 and none can be made, its asks end; an ordinary agent is unchanged', async () => {
    ok(await call(server, 'PATCH', '/api/settings', { cookie: admin, body: { setupAgents: false } }), 'off');
    refused(await call(server, 'GET', '/api/agent/me', S.T), 401, INVALID, 'its token');
    refused(await call(server, 'POST', '/api/agent/spaces', { ...S.T, body: { name: 'X', template: templateId } }), 401, INVALID, 'making');
    refused(await call(server, 'POST', '/api/users', { cookie: admin, body: { agent: true, kind: 'setup' } }), 403, 'Set-up agents are off in this environment. Turn on Set-up agents in Manage first.', 'a new one');
    refused(await call(server, 'POST', `/api/users/${S.user.key}/token`, { cookie: admin }), 403, 'Set-up agents are off in this environment. Turn on Set-up agents in Manage first.', 'a new token');
    ok(await call(server, 'GET', '/api/agent/me', O.T), 'the ordinary agent');
    ok(await call(server, 'GET', `/api/users/${S.user.key}/agent-log`, { cookie: admin }), 'its log is still read');
    const capAsks = (await call(server, 'GET', `/api/users/${C.user.key}/asks`, { cookie: admin })).json.asks;
    assert.ok(capAsks.length >= SETUP_LIMITS.waiting && capAsks.every((x) => x.state !== 'waiting'), 'every waiting ask ended');
    ok(await call(server, 'PATCH', '/api/settings', { cookie: admin, body: { setupAgents: true } }), 'on again');
    assert.ok((await call(server, 'GET', `/api/users/${C.user.key}/asks`, { cookie: admin })).json.asks.every((x) => x.state !== 'waiting'), 'and stay ended');
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
  // Seven days on: an ask still waiting expires, and a change can no longer be undone. Aged in the file, read on a restart.
  await test('7 days: a waiting ask expires (read back after a restart) and frees its place; a change is no longer undoable', async () => {
    // Set-up agents off (above) ended every ask then waiting, as a kill switch does: a fresh one to age.
    const W = await setupOf('Waiter');
    const pond = await madeBy(W, 'Pond');
    ok(await ask(W, pond.id, { ask: 'add', person: mia.key }), 'asked', 202);
    await server.stop();
    const file = path.join(single, 'agent-setup.json');
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    const old = Date.now() - 8 * 86400000;
    const waiting = stored.asks.find((a) => a.agent === W.user.key && a.state === 'waiting');
    waiting.at = old;
    const aged = stored.changes.find((c) => c.agent === U.user.key && c.space === undoRefs.rome && c.change === 'made');
    aged.at = old;
    fs.writeFileSync(file, JSON.stringify(stored));
    server = await startServer(single, ON);
    const owner = await signIn(server, 'olga', 'olga-password-1');
    const status = await call(server, 'GET', `/api/agent/asks/${waiting.id}`, W.T);
    ok(status, 'its status');
    assert.equal(status.json.ask.state, 'expired');
    refused(await call(server, 'POST', `/api/users/${W.user.key}/asks/${waiting.id}`, { cookie: owner, body: { decision: 'approve' } }), 409, 'That ask has run out.', 'approving it');
    assert.equal((await call(server, 'GET', '/api/agent/me', W.T)).json.limits.asks.waiting, 0, 'its place is free');
    assert.ok(!(await call(server, 'GET', `/api/spaces/${pond.id}`, { cookie: owner })).json.space.members.includes(mia.key), 'nobody added');
    const changes = (await call(server, 'GET', `/api/users/${U.user.key}/changes`, { cookie: owner })).json.changes;
    assert.ok(!changes.some((c) => c.id === aged.id), 'not listed after 7 days');
    refused(await call(server, 'POST', `/api/users/${U.user.key}/changes/${aged.id}/undo`, { cookie: owner }), 404, 'No such change. A change can be undone for 7 days.', 'undo after 7 days');
    assert.ok(!fs.readFileSync(file, 'utf8').includes(aged.id), 'the record is dropped');
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
    // Its asks and changes are acme's: beta's owner finds no such agent, and beta keeps no file of them.
    ok(await call(server, 'GET', `/api/users/${a.key}/changes`, { host: 'acme', cookie: acme }), 'acme reads its changes');
    refused(await call(server, 'GET', `/api/users/${a.key}/changes`, { host: 'beta', cookie: beta }), 404, 'no such user', 'beta reads them');
    refused(await call(server, 'GET', `/api/users/${a.key}/asks`, { host: 'beta', cookie: beta }), 404, 'no such user', 'beta reads its asks');
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
