#!/usr/bin/env node
/*
 * check-agent-asker.mjs -- the bus carries the asker (documentation/plans/plan-agent-access.md, step 4, decision 9), against
 * real servers on throwaway DATA_DIRs, with the bundled Planner (schedule) and Calendar:
 *   - a request records the asker's key; what a page carrying it out is told has `by` (the name) and `byKey` (the key);
 *   - a page's data write and its complete may say `for: <asker key>, request: <id>`, and the server believes it only from the
 *     person whose page claimed that very request (still claimed) when it names the actual asker: a forged `for` (the wrong
 *     asker, a person who did not claim it, a request that is someone else's, one not claimed yet, an unknown or a finished
 *     one, no request at all) is 403 with one sentence, and nothing is written;
 *   - `for` raises nothing: a person with no right to write is refused for that first, and an agent's token still reaches no
 *     bus, claim, complete or data-write route;
 *   - the activity list reads "Claude (agent), carried out by <person>'s page", the Calendar copy's {by} is the asker's name,
 *     and an agent's request carried out by an owner's page records the agent as asker and the owner as carrier;
 *   - a person's own request carried out by their own page is unchanged: no carrier, their own name;
 *   - hosted (BASE_DOMAIN): a request of one environment is no use at another.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOT_YOURS = 'That request is not yours to carry out.';
const NOT_ASKER = 'That is not the person who asked.';
const CANT = "An agent can't do that.";

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

function call(server, method, urlPath, { body, cookie, token, host } = {}) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const headers = { host: host ? `${host}.localhost:${server.port}` : `127.0.0.1:${server.port}`, accept: 'application/json' };
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

// One place to work in: a server (or a hosted environment, `host`), the owner's cookie, the Planner and Calendar on in a space.
async function setUp(server, { host, cookie, tag }) {
  const as = (cookieOf2, method, url, body) => call(server, method, url, { host, cookie: cookieOf2, body });
  ok(await as(cookie, 'PATCH', '/api/settings', { agents: true }), `${tag}: Agents on`);
  const person = async (login, name) => {
    const made = await as(cookie, 'POST', '/api/users', { login, password: `${login}-password-1`, displayName: name, role: 'member' });
    ok(made, `${tag}: ${login}`, 201);
    return made.json.user;
  };
  const mia = await person('mia', 'Mia');
  const ben = await person('ben', 'Ben');
  const agent = (await as(cookie, 'POST', '/api/users', { agent: true })).json.user;
  assert.equal(agent.displayName, 'Claude');
  const space = (await as(cookie, 'POST', '/api/spaces', { name: 'Camp', members: [agent.key, mia.key] })).json.space.id;
  const other = (await as(cookie, 'POST', '/api/spaces', { name: 'Elsewhere', members: [ben.key] })).json.space.id;
  for (const id of ['schedule', 'calendar']) ok(await as(cookie, 'POST', `/api/modules/bundled/${id}/install`, {}), `${tag}: ${id} installs`, 201);
  for (const id of ['schedule', 'calendar']) ok(await as(cookie, 'PATCH', `/api/modules/${id}`, { enabled: true, allSpaces: true }), `${tag}: ${id} on`);
  const token = (await as(cookie, 'POST', `/api/users/${agent.key}/token`)).json.token;
  const miaCookie = await signIn(server, 'mia', 'mia-password-1', host);
  const benCookie = await signIn(server, 'ben', 'ben-password-1', host);
  return { server, host, cookie, mia, ben, agent, space, other, token, miaCookie, benCookie, tag };
}

// What a carrying-out page does, as the module host does it: take a request, write while it holds it, finish it.
const q = (w, space = w.space) => `scope=space&space=${space}`;
const claim = (w, who, id, space = w.space) => call(w.server, 'POST', '/api/bus/actions/claim', { host: w.host, cookie: who, body: { module: 'schedule', id, scope: 'space', space } });
const complete = (w, who, id, extra = {}) => call(w.server, 'POST', '/api/bus/actions/complete', { host: w.host, cookie: who, body: { module: 'schedule', id, scope: 'space', space: w.space, result: { ok: true }, ...extra } });
const putPlan = (w, who, key, value, extra = {}) => call(w.server, 'PUT', `/api/modules/schedule/data/${encodeURIComponent(key)}?${q(w)}`, { host: w.host, cookie: who, body: { value, ...extra } });
const delPlan = (w, who, key, extra = '') => call(w.server, 'DELETE', `/api/modules/schedule/data/${encodeURIComponent(key)}?${q(w)}${extra}`, { host: w.host, cookie: who });
const pending = (w, who) => call(w.server, 'GET', `/api/bus/actions/pending?module=schedule&scope=space&space=${w.space}`, { host: w.host, cookie: who });
const activity = async (w) => (await call(w.server, 'GET', '/api/modules/activity', { host: w.host, cookie: w.cookie })).json.activity;
const askByAgent = async (w, title) => {
  const r = await call(w.server, 'POST', `/api/spaces/${w.space}/action`, { host: w.host, token: w.token, body: { action: 'schedule:addMilestone', input: { title, date: '2026-12-01' } } });
  ok(r, 'the agent asks');
  return r.json.id;
};
const askByPerson = async (w, who, title) => {
  const r = await call(w.server, 'POST', `/api/spaces/${w.space}/action`, { host: w.host, cookie: who, body: { action: 'schedule:addMilestone', input: { title, date: '2026-12-01' } } });
  ok(r, 'a person asks');
  return r.json.id;
};
const plan = (title) => ({ id: 'x', kind: 'milestone', title, start: '2026-12-01', end: '2026-12-01' });
const calendarCopies = async (w) => {
  const list = await call(w.server, 'GET', `/api/modules/calendar/data?${q(w)}`, { host: w.host, cookie: w.cookie });
  return list.json.items.map((i) => i.value);
};
const planKeys = async (w) => (await call(w.server, 'GET', `/api/modules/schedule/data?${q(w)}`, { host: w.host, cookie: w.cookie })).json.items.map((i) => i.key);
const busFile = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'modules', 'bus.json'), 'utf8'));

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-agent-asker-'));
try {
  const single = path.join(base, 'single');
  let server = await startServer(single, { ADMIN_PASSWORD: 'admin-password-1', AGENT_TOKENS: 'true' });
  const admin = await signIn(server, 'admin', 'admin-password-1');
  const w = await setUp(server, { cookie: admin, tag: 'single' });
  const adminName = (await call(server, 'GET', '/api/me', { cookie: admin })).json.user.displayName;
  const adminKey = (await call(server, 'GET', '/api/me', { cookie: admin })).json.user.key;

  let R1 = null;
  await test('a request records the asker\'s key; what a page is told has `by` (the name) and `byKey` (the key)', async () => {
    R1 = await askByAgent(w, 'Pitch the tents');
    const stored = busFile(single).actions.find((a) => a.id === R1);
    assert.equal(stored.by, w.agent.key, 'the bus records the key');
    const list = await pending(w, admin);
    ok(list, 'pending');
    const seen = list.json.actions.find((a) => a.id === R1);
    assert.equal(seen.by, 'Claude');
    assert.equal(seen.byKey, w.agent.key);
    const taken = await claim(w, admin, R1);
    ok(taken, 'claim');
    assert.equal(taken.json.action.byKey, w.agent.key);
    assert.equal(taken.json.action.by, 'Claude');
    assert.equal(busFile(single).actions.find((a) => a.id === R1).claimedBy, adminKey, 'who took it is kept');
  });

  await test('an agent still reaches no bus, claim, complete or data-write route (the step-1 gate)', async () => {
    for (const [method, url, body] of [
      ['POST', '/api/bus/actions/claim', { module: 'schedule', id: R1, scope: 'space', space: w.space }],
      ['POST', '/api/bus/actions/complete', { module: 'schedule', id: R1, scope: 'space', space: w.space, result: { ok: true }, for: w.agent.key }],
      ['GET', `/api/bus/actions/pending?module=schedule&scope=space&space=${w.space}`],
      ['PUT', `/api/modules/schedule/data/plan%3Ax?${q(w)}`, { value: plan('x'), for: w.agent.key, request: R1 }],
      ['DELETE', `/api/modules/schedule/data/plan%3Ax?${q(w)}&for=${w.agent.key}&request=${R1}`],
    ]) refused(await call(server, method, url, { token: w.token, body }), 403, CANT, `${method} ${url.split('?')[0]}`);
  });

  await test('a forged `for` is refused, and nothing is written', async () => {
    const before = await planKeys(w);
    // Not the person who claimed it (Mia may write here, but did not take it).
    refused(await putPlan(w, w.miaCookie, 'plan:f1', plan('f1'), { for: w.agent.key, request: R1 }), 403, NOT_YOURS, 'a person who did not claim it');
    refused(await complete(w, w.miaCookie, R1, { for: w.agent.key }), 403, NOT_YOURS, 'a complete by one who did not claim it');
    // The claimer, but the wrong asker.
    refused(await putPlan(w, admin, 'plan:f2', plan('f2'), { for: w.mia.key, request: R1 }), 403, NOT_ASKER, 'the wrong asker');
    refused(await putPlan(w, admin, 'plan:f2', plan('f2'), { for: adminKey, request: R1 }), 403, NOT_ASKER, 'oneself named as the asker of another\'s request');
    refused(await complete(w, admin, R1, { for: w.mia.key }), 403, NOT_ASKER, 'a complete naming the wrong asker');
    // No request, an unknown one, a bad one, a `for` that is not text.
    refused(await putPlan(w, admin, 'plan:f3', plan('f3'), { for: w.agent.key }), 403, NOT_YOURS, 'no request named');
    refused(await putPlan(w, admin, 'plan:f3', plan('f3'), { for: w.agent.key, request: 987654 }), 403, NOT_YOURS, 'an unknown request');
    refused(await putPlan(w, admin, 'plan:f3', plan('f3'), { for: w.agent.key, request: 'abc' }), 403, NOT_YOURS, 'a request that is not a number');
    refused(await putPlan(w, admin, 'plan:f3', plan('f3'), { for: { key: w.agent.key }, request: R1 }), 400, "Say who asked as a person's key.", 'a `for` that is not text');
    refused(await delPlan(w, w.miaCookie, 'plan:p1', `&for=${w.agent.key}&request=${R1}`), 403, NOT_YOURS, 'a delete by one who did not claim it');
    refused(await delPlan(w, admin, 'plan:p1', `&for=${w.mia.key}&request=${R1}`), 403, NOT_ASKER, 'a delete naming the wrong asker');
    assert.deepEqual(await planKeys(w), before, 'nothing was written');
    assert.equal(busFile(single).actions.find((a) => a.id === R1).status, 'claimed', 'and the request is still waiting to be finished');
  });

  await test('a request that is another person\'s, or not claimed yet, can not be named', async () => {
    const R2 = await askByPerson(w, w.miaCookie, 'Mia\'s own');
    refused(await putPlan(w, admin, 'plan:g1', plan('g1'), { for: w.mia.key, request: R2 }), 403, NOT_YOURS, 'not claimed yet');
    ok(await claim(w, w.miaCookie, R2), 'Mia takes her own');
    refused(await putPlan(w, admin, 'plan:g1', plan('g1'), { for: w.mia.key, request: R2 }), 403, NOT_YOURS, 'claimed by someone else');
    refused(await putPlan(w, admin, 'plan:g1', plan('g1'), { for: w.agent.key, request: R2 }), 403, NOT_YOURS, 'someone else\'s, named for another');
    ok(await complete(w, w.miaCookie, R2), 'Mia finishes it');
    // A finished request can not be named again, by its own carrier or anyone.
    refused(await putPlan(w, w.miaCookie, 'plan:g1', plan('g1'), { for: w.mia.key, request: R2 }), 403, NOT_YOURS, 'a request already completed');
    refused(await complete(w, w.miaCookie, R2, { for: w.mia.key }), 403, NOT_YOURS, 'a second complete naming it');
    assert.ok(!(await planKeys(w)).includes('plan:g1'));
  });

  await test('`for` raises nothing: the write is judged on the carrier\'s own rights first', async () => {
    // Ben is not in the space at all: refused for that, never reaching the sentence about the request.
    const r = await putPlan(w, w.benCookie, 'plan:h1', plan('h1'), { for: w.agent.key, request: R1 });
    assert.ok([403, 404].includes(r.status), `refused (${r.status})`);
    assert.ok(![NOT_YOURS, NOT_ASKER].includes(r.json?.error), 'for the person\'s rights, not the request');
    const c = await complete(w, w.benCookie, R1, { for: w.agent.key });
    assert.ok([403, 404].includes(c.status), `a complete too (${c.status})`);
    assert.ok(!(await planKeys(w)).includes('plan:h1'));
  });

  await test('an agent\'s request carried out by an owner\'s page: the agent is the asker, the owner the carrier; the copy names the agent', async () => {
    const put = await putPlan(w, admin, 'plan:p1', plan('Pitch the tents'), { for: w.agent.key, request: R1 });
    ok(put, 'the owner\'s page writes for the agent');
    assert.equal(put.json.item.by, adminKey, 'what is stored is the carrier\'s own write');
    const done = await complete(w, admin, R1, { for: w.agent.key });
    ok(done, 'complete');
    assert.equal(done.json.ok, true);
    const stored = busFile(single).actions.find((a) => a.id === R1);
    assert.equal(stored.by, w.agent.key, 'the asker stays the agent');
    assert.equal(stored.doneBy, adminKey, 'the carrier is the owner');
    const lines = await activity(w);
    const saved = lines.find((l) => l.what === 'saved plan:p1');
    assert.equal(saved.by, w.agent.key);
    assert.equal(saved.carriedBy, adminKey);
    assert.equal(saved.byName, `Claude (agent), carried out by ${adminName}'s page`);
    const done2 = lines.find((l) => l.what === 'carried out addMilestone');
    assert.equal(done2.byName, `Claude (agent), carried out by ${adminName}'s page`);
    const asked = lines.find((l) => l.what.startsWith('asked schedule to addMilestone') && l.by === w.agent.key);
    assert.equal(asked.byName, 'Claude (agent)', 'the request itself names the agent');
    const copy = (await calendarCopies(w)).find((c) => c.title === 'Pitch the tents');
    assert.ok(copy, 'the Calendar copy exists');
    assert.equal(copy.by, 'Claude', 'its {by} is the asker\'s name');
  });

  await test('a person\'s own request carried out by their own page is unchanged: no carrier, their own name', async () => {
    const R3 = await askByPerson(w, w.miaCookie, 'Mia\'s milestone');
    ok(await claim(w, w.miaCookie, R3), 'claim');
    // The page names its own asker or says nothing: the same record either way.
    ok(await putPlan(w, w.miaCookie, 'plan:m1', plan('Mia\'s milestone'), { for: w.mia.key, request: R3 }), 'with a `for` naming herself');
    ok(await putPlan(w, w.miaCookie, 'plan:m2', plan('Mia\'s other'), {}), 'with none');
    ok(await complete(w, w.miaCookie, R3, { for: w.mia.key }), 'complete');
    const lines = await activity(w);
    for (const key of ['plan:m1', 'plan:m2']) {
      const line = lines.find((l) => l.what === `saved ${key}`);
      assert.equal(line.by, w.mia.key);
      assert.equal(line.carriedBy, undefined, 'no carrier');
      assert.equal(line.byName, 'Mia');
    }
    assert.ok(!lines.some((l) => l.what === 'carried out addMilestone' && l.by === w.mia.key), 'no "carried out" line for her own');
    const copies = await calendarCopies(w);
    assert.equal(copies.find((c) => c.title === 'Mia\'s milestone').by, 'Mia');
    assert.equal(copies.find((c) => c.title === 'Mia\'s other').by, 'Mia');
  });

  await test('an owner carrying out a member\'s request names the member as asker; a delete names the asker too', async () => {
    const R4 = await askByPerson(w, w.miaCookie, 'For the owner');
    ok(await claim(w, admin, R4), 'the owner takes it');
    ok(await putPlan(w, admin, 'plan:o1', plan('For the owner'), { for: w.mia.key, request: R4 }), 'write');
    ok(await delPlan(w, admin, 'plan:o1', `&for=${w.mia.key}&request=${R4}`), 'delete');
    ok(await complete(w, admin, R4, { for: w.mia.key }), 'complete');
    const lines = await activity(w);
    const gone = lines.find((l) => l.what === 'deleted plan:o1');
    assert.equal(gone.byName, `Mia, carried out by ${adminName}'s page`);
    assert.equal(gone.carriedBy, adminKey);
  });

  await test('the stored activity keeps the asker and carrier across a restart', async () => {
    await server.stop();
    server = await startServer(single, { ADMIN_PASSWORD: 'admin-password-1', AGENT_TOKENS: 'true' });
    const cookie = await signIn(server, 'admin', 'admin-password-1');
    const lines = (await call(server, 'GET', '/api/modules/activity', { cookie })).json.activity;
    const saved = lines.find((l) => l.what === 'saved plan:p1');
    assert.equal(saved.byName, `Claude (agent), carried out by ${adminName}'s page`);
  });
  await server.stop();

  // --- hosted: a request of one environment is no use at another ----------------------------------------------------------
  const hosted = path.join(base, 'hosted');
  server = await startServer(hosted, { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'boss', ADMIN_PASSWORD: 'host-password-1', AGENT_TOKENS: 'true' });
  const host = await signIn(server, 'boss', 'host-password-1', 'admin');
  for (const slug of ['acme', 'beta']) {
    ok(await call(server, 'POST', '/api/host/environments', { host: 'admin', cookie: host, body: { slug, name: slug, owner: { login: 'owner', password: 'owner-password-1' } } }), `${slug} made`, 201);
  }
  const acmeOwner = await signIn(server, 'owner', 'owner-password-1', 'acme');
  const betaOwner = await signIn(server, 'owner', 'owner-password-1', 'beta');
  const acme = await setUp(server, { host: 'acme', cookie: acmeOwner, tag: 'acme' });
  const beta = await setUp(server, { host: 'beta', cookie: betaOwner, tag: 'beta' });
  await test('hosted: the asker is carried inside one environment, and an id from another is no use', async () => {
    const A = await askByAgent(acme, 'Acme thing');
    const B = await askByPerson(beta, beta.miaCookie, 'Beta thing');
    ok(await claim(acme, acmeOwner, A), 'acme claims its own');
    ok(await claim(beta, betaOwner, B), 'beta claims its own');
    // Acme's owner's request id means nothing at beta unless beta has one: and then it names beta's asker, not acme's agent.
    refused(await putPlan(beta, betaOwner, 'plan:z1', plan('z1'), { for: acme.agent.key, request: B }), 403, NOT_ASKER, 'an agent of acme named at beta');
    refused(await putPlan(beta, betaOwner, 'plan:z1', plan('z1'), { for: acme.agent.key, request: A + 1000 }), 403, NOT_YOURS, 'an id beta does not have');
    refused(await putPlan(acme, acmeOwner, 'plan:z2', plan('z2'), { for: beta.mia.key, request: A }), 403, NOT_ASKER, 'a person of beta named at acme');
    ok(await putPlan(acme, acmeOwner, 'plan:a1', plan('Acme thing'), { for: acme.agent.key, request: A }), 'acme writes for its agent');
    ok(await putPlan(beta, betaOwner, 'plan:b1', plan('Beta thing'), { for: beta.mia.key, request: B }), 'beta writes for Mia');
    const acmeLines = await activity(acme);
    assert.match(acmeLines.find((l) => l.what === 'saved plan:a1').byName, /^Claude \(agent\), carried out by .+'s page$/);
    assert.ok(!(await activity(beta)).some((l) => l.what === 'saved plan:a1'), 'beta\'s list has none of acme\'s');
    assert.equal((await calendarCopies(acme)).find((c) => c.title === 'Acme thing').by, 'Claude');
    assert.equal((await calendarCopies(beta)).find((c) => c.title === 'Beta thing').by, 'Mia');
  });
  await server.stop();
} finally {
  for (const s of servers) if (s.child.exitCode === null) s.child.kill('SIGTERM');
  fs.rmSync(base, { recursive: true, force: true });
}
if (failed) {
  console.error(`check-agent-asker: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-agent-asker: ok (${n} checks)`);
