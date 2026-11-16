#!/usr/bin/env node
/*
 * check-agent-asker.mjs -- the bus carries the asker (documentation/plans/plan-agent-access.md, step 4, decision 9), against
 * real servers on throwaway DATA_DIRs, with the bundled Planner (schedule) and Calendar:
 *   - a request records the asker's key; what a page carrying it out is told has `by` (the name) and `byKey` (the key);
 *   - a page's data write may carry `for: <asker key>, request: <id>` as a HINT. The server holds the request and uses it only
 *     for a PUT that creates a new key, from the person whose page claimed it (not a guest, not their own request) within the
 *     first minute of its claim, in the request's own place, for at most 10 new objects, and naming its actual asker. Any
 *     other `for` is ignored: the write saves as the carrier's own, nobody else is named, nothing is refused. A DELETE and an
 *     overwrite never name an asker; a complete reads no `for`;
 *   - `for` raises nothing: a person with no right to write is refused for that first, and an agent's token still reaches no
 *     bus, claim, complete or data-write route;
 *   - the activity list reads "Claude (agent), carried out by <person>'s page" (and gives askerName, askerAgent and carrierName
 *     apart), the Calendar copy's {by} is the asker's name, a failed request logs no "carried out";
 *   - a person's own request is unchanged; the cap and the first-claim window survive a restart and a re-claim;
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

  // What a saved line says about its write: who it names and who carried it, from the activity list.
  const lineOf = async (what, ww = w) => (await activity(ww)).find((l) => l.what === what);
  const savedAsCarrier = async (key, carrierKey, what, ww = w) => {
    const l = await lineOf(`saved ${key}`, ww);
    assert.ok(l, `${what}: a line for ${key}`);
    assert.equal(l.by, carrierKey, `${what}: names the carrier`);
    assert.equal(l.carriedBy, undefined, `${what}: no asker is named`);
    assert.equal(l.askerAgent, false, `${what}: not the agent`);
  };
  const copyBy = async (title, ww = w) => (await calendarCopies(ww)).find((c) => c.title === title)?.by;

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
    assert.equal(taken.json.action.mine, undefined, 'not the owner\'s own');
    const kept = busFile(single).actions.find((a) => a.id === R1);
    assert.equal(kept.claimedBy, adminKey, 'who took it is kept');
    assert.ok(kept.claimedFirstAt > 0, 'and when it was first taken');
  });

  await test('an agent still reaches no bus, claim, complete or data-write route (the step-1 gate)', async () => {
    for (const [method, url, body] of [
      ['POST', '/api/bus/actions/claim', { module: 'schedule', id: R1, scope: 'space', space: w.space }],
      ['POST', '/api/bus/actions/complete', { module: 'schedule', id: R1, scope: 'space', space: w.space, result: { ok: true } }],
      ['GET', `/api/bus/actions/pending?module=schedule&scope=space&space=${w.space}`],
      ['PUT', `/api/modules/schedule/data/plan%3Ax?${q(w)}`, { value: plan('x'), for: w.agent.key, request: R1 }],
      ['DELETE', `/api/modules/schedule/data/plan%3Ax?${q(w)}&for=${w.agent.key}&request=${R1}`],
    ]) refused(await call(server, method, url, { token: w.token, body }), 403, CANT, `${method} ${url.split('?')[0]}`);
  });

  await test('a `for` that fails any check is ignored: the write is saved as the carrier, nothing is refused and nobody else is named', async () => {
    const tries = [
      ['a person who did not claim it', w.miaCookie, w.mia.key, { for: w.agent.key, request: R1 }],
      ['the wrong asker', admin, adminKey, { for: w.mia.key, request: R1 }],
      ['the carrier named as asker', admin, adminKey, { for: adminKey, request: R1 }],
      ['no request', admin, adminKey, { for: w.agent.key }],
      ['an unknown request', admin, adminKey, { for: w.agent.key, request: 987654 }],
      ['a request that is not a number', admin, adminKey, { for: w.agent.key, request: 'abc' }],
      ['a for that is not text', admin, adminKey, { for: { key: w.agent.key }, request: R1 }],
    ];
    let i = 0;
    for (const [what, cookie, who, extra] of tries) {
      const key = `plan:f${i += 1}`;
      ok(await putPlan(w, cookie, key, plan(what), extra), `${what}: saved`);
      await savedAsCarrier(key, who, what);
      assert.equal(await copyBy(what), who === adminKey ? adminName : 'Mia', `${what}: the copy names the carrier`);
    }
    const r = busFile(single).actions.find((a) => a.id === R1);
    assert.equal(r.status, 'claimed', 'the request is untouched');
    assert.equal(r.carried || 0, 0, 'none counted');
    assert.ok(await lineOf('sent a name for who asked that was not believed and was saved as their own'), 'a probing carrier is seen in the activity list');
  });

  await test('the first repros: a claim in Camp used in another space or at the environment saves as the carrier', async () => {
    const elsewhere = await call(server, 'PUT', `/api/modules/schedule/data/plan%3Aq1?scope=space&space=${w.other}`, { cookie: admin, body: { value: plan('q1'), for: w.agent.key, request: R1 } });
    ok(elsewhere, 'a write in another space');
    const l = await lineOf('saved plan:q1');
    assert.equal(l.by, adminKey);
    assert.equal(l.carriedBy, undefined);
    const copies = await call(server, 'GET', `/api/modules/calendar/data?scope=space&space=${w.other}`, { cookie: admin });
    assert.equal(copies.json.items.find((i) => i.value.title === 'q1').value.by, adminName, 'the copy there names the owner, not the agent');
    const env = await call(server, 'PUT', '/api/modules/schedule/data/plan%3Aq2?scope=environment', { cookie: admin, body: { value: plan('q2'), for: w.agent.key, request: R1 } });
    const bare = await call(server, 'PUT', '/api/modules/schedule/data/plan%3Aq3?scope=environment', { cookie: admin, body: { value: plan('q3') } });
    assert.equal(env.status, bare.status, 'at the environment it answers as the same write without a `for`');
    if (env.status === 200) assert.equal((await lineOf('saved plan:q2')).carriedBy, undefined);
    assert.ok(!(await activity(w)).some((x) => x.by === w.agent.key && x.what.startsWith('saved')), 'the agent is named on nothing yet');
  });

  await test('a DELETE with a `for` deletes as the carrier, and an overwrite saves as the carrier', async () => {
    ok(await putPlan(w, w.miaCookie, 'plan:mine', plan('Mia\'s own'), {}), 'Mia\'s entry');
    ok(await delPlan(w, admin, 'plan:mine', `&for=${w.agent.key}&request=${R1}`), 'deleted');
    assert.ok(!(await planKeys(w)).includes('plan:mine'));
    const gone = await lineOf('deleted plan:mine');
    assert.equal(gone.by, adminKey);
    assert.equal(gone.carriedBy, undefined);
    assert.equal(gone.askerAgent, false);
    ok(await putPlan(w, admin, 'plan:ow', plan('Overwrite me'), {}), 'an entry');
    ok(await putPlan(w, admin, 'plan:ow', plan('Overwritten'), { for: w.agent.key, request: R1 }), 'overwritten');
    assert.equal((await lineOf('saved plan:ow')).carriedBy, undefined);
    assert.notEqual(await copyBy('Overwritten'), 'Claude', 'a copy of an overwrite does not name the agent');
    assert.equal(busFile(single).actions.find((a) => a.id === R1).carried || 0, 0, 'nothing counted');
  });

  await test('creating a new key with a valid `for` names the asker; the owner\'s page is the carrier, and a complete finishes it', async () => {
    const put = await putPlan(w, admin, 'plan:p1', plan('Pitch the tents'), { for: w.agent.key, request: R1 });
    ok(put, 'the owner\'s page writes for the agent');
    assert.equal(put.json.item.by, adminKey, 'what is stored is the carrier\'s own write');
    const done = await complete(w, admin, R1, { for: w.mia.key });
    ok(done, 'complete (a stray `for` on it is not read)');
    assert.equal(done.json.ok, true);
    const stored = busFile(single).actions.find((a) => a.id === R1);
    assert.equal(stored.by, w.agent.key);
    assert.equal(stored.doneBy, adminKey);
    assert.equal(stored.carried, 1);
    const lines = await activity(w);
    const saved = lines.find((l) => l.what === 'saved plan:p1');
    assert.deepEqual([saved.by, saved.carriedBy, saved.byName], [w.agent.key, adminKey, `Claude (agent), carried out by ${adminName}'s page`]);
    assert.equal(lines.find((l) => l.what === 'carried out addMilestone').byName, saved.byName);
    assert.equal(lines.find((l) => l.what.startsWith('asked schedule to addMilestone') && l.by === w.agent.key).byName, 'Claude (agent)');
    assert.equal(await copyBy('Pitch the tents'), 'Claude', 'the copy\'s {by} is the asker');
    const copyLine = lines.find((l) => l.what.startsWith('saved event:') && l.by === w.agent.key);
    assert.equal(copyLine?.carriedBy, adminKey, 'and the activity list names the carrier on the copy');
  });

  await test('an own request carried by its own page saves as theirs in any place, however many writes, and names nobody else', async () => {
    const R = await askByPerson(w, w.miaCookie, 'Own request');
    const taken = await claim(w, w.miaCookie, R);
    ok(taken, 'Mia takes her own');
    assert.equal(taken.json.action.mine, true, 'the claim says it is her own, so the page sends no `for`');
    for (let i = 0; i < 14; i += 1) ok(await putPlan(w, w.miaCookie, `plan:own${i}`, plan(`own ${i}`), { for: w.mia.key, request: R }), `write ${i}`);
    for (const scope of ['scope=environment', 'scope=person']) {
      const withFor = await call(server, 'PUT', `/api/modules/schedule/data/plan%3Aown-${scope.slice(6)}?${scope}`, { cookie: w.miaCookie, body: { value: plan('x'), for: w.mia.key, request: R } });
      const without = await call(server, 'PUT', `/api/modules/schedule/data/plan%3Aown2-${scope.slice(6)}?${scope}`, { cookie: w.miaCookie, body: { value: plan('x') } });
      assert.equal(withFor.status, without.status, `${scope}: the same answer with or without`);
    }
    const lines = await activity(w);
    assert.ok(lines.filter((l) => /^saved plan:own\d/.test(l.what)).every((l) => l.by === w.mia.key && l.carriedBy === undefined));
    ok(await complete(w, w.miaCookie, R), 'complete');
    assert.ok(!(await activity(w)).some((l) => l.what === 'carried out addMilestone' && l.by === w.mia.key));
    assert.equal(await copyBy('own 3'), 'Mia');
  });

  await test('a failed request logs no "carried out"; a complete by someone who did not claim it records no carrier', async () => {
    const R = await askByAgent(w, 'Fails');
    ok(await claim(w, admin, R), 'claim');
    const count = async () => (await activity(w)).filter((l) => l.what === 'carried out addMilestone').length;
    const before = await count();
    ok(await complete(w, admin, R, { result: { ok: false, error: 'It did not work.' } }), 'a failed complete');
    assert.equal(await count(), before, 'no line for it');
    const R2 = await askByAgent(w, 'Other page');
    ok(await claim(w, admin, R2), 'the owner claims');
    ok(await complete(w, w.miaCookie, R2), 'Mia finishes it');
    assert.equal(busFile(single).actions.find((a) => a.id === R2).doneBy, '', 'no carrier recorded');
    assert.equal(await count(), before);
  });

  await test('a name can\'t spoof the composed sentence, and "(agent)" comes only from the agent flag', async () => {
    ok(await call(server, 'PATCH', `/api/users/${w.mia.key}`, { cookie: admin, body: { displayName: 'Mia, carried out by Boss' } }), 'a tricky name');
    const R = await askByPerson(w, w.miaCookie, 'Spoof');
    ok(await claim(w, admin, R), 'the owner claims');
    ok(await putPlan(w, admin, 'plan:sp1', plan('Spoof'), { for: w.mia.key, request: R }), 'carried');
    const l = await lineOf('saved plan:sp1');
    assert.equal(l.askerName, 'Mia, carried out by Boss', 'the separate field is the plain name');
    assert.equal(l.carrierName, adminName);
    assert.equal(l.byName.split('carried out by').length, 2, 'the sentence has its own words once');
    assert.equal(l.askerAgent, false);
    assert.equal((await lineOf('saved plan:p1')).askerAgent, true);
    ok(await complete(w, admin, R), 'complete');
    ok(await call(server, 'PATCH', `/api/users/${w.mia.key}`, { cookie: admin, body: { displayName: 'Mia' } }), 'back');
  });

  await test('the cap is 10 new objects a claim, it holds across a restart, and a re-claim gives no new window', async () => {
    const R = await askByAgent(w, 'Cap check');
    ok(await claim(w, admin, R), 'claim');
    for (let i = 0; i < 6; i += 1) ok(await putPlan(w, admin, `plan:cap${i}`, plan(`cap ${i}`), { for: w.agent.key, request: R }), `write ${i + 1}`);
    await server.stop();
    server = await startServer(single, { ADMIN_PASSWORD: 'admin-password-1', AGENT_TOKENS: 'true' });
    const cookie = await signIn(server, 'admin', 'admin-password-1');
    const w2 = { ...w, server };
    assert.equal(busFile(single).actions.find((a) => a.id === R).carried, 6, 'the count was kept');
    for (let i = 6; i < 10; i += 1) ok(await putPlan(w2, cookie, `plan:cap${i}`, plan(`cap ${i}`), { for: w.agent.key, request: R }), `write ${i + 1}`);
    for (let i = 10; i < 13; i += 1) {
      ok(await putPlan(w2, cookie, `plan:cap${i}`, plan(`cap ${i}`), { for: w.agent.key, request: R }), `write ${i + 1} is saved`);
      assert.equal((await lineOf(`saved plan:cap${i}`, w2)).by, adminKey, 'but as the carrier');
    }
    assert.equal((await lineOf('saved plan:cap9', w2)).by, w.agent.key, 'the tenth was still named');
    assert.equal(busFile(single).actions.find((a) => a.id === R).carried, 10);
    ok(await complete(w2, cookie, R), 'complete');
    // A claim older than its minute, claimed again, has no new window.
    const R9 = await askByAgent(w2, 'Aged claim');
    ok(await claim(w2, cookie, R9), 'claim');
    await server.stop();
    const file = path.join(single, 'modules', 'bus.json');
    const bus = JSON.parse(fs.readFileSync(file, 'utf8'));
    const r9 = bus.actions.find((a) => a.id === R9);
    r9.claimedAt -= 120000;
    r9.claimedFirstAt -= 120000;
    fs.writeFileSync(file, JSON.stringify(bus));
    server = await startServer(single, { ADMIN_PASSWORD: 'admin-password-1', AGENT_TOKENS: 'true' });
    const cookie3 = await signIn(server, 'admin', 'admin-password-1');
    const w3 = { ...w, server };
    const again = await claim(w3, cookie3, R9);
    ok(again, 'claimed again after its minute');
    assert.equal(again.json.ok, true);
    const kept = busFile(single).actions.find((a) => a.id === R9);
    assert.ok(kept.claimedAt > kept.claimedFirstAt + 100000, 'the re-claim is new but the first time is kept');
    ok(await putPlan(w3, cookie3, 'plan:old1', plan('old'), { for: w.agent.key, request: R9 }), 'a write after the minute is saved');
    assert.equal((await lineOf('saved plan:old1', w3)).by, adminKey, 'as the carrier');
    ok(await complete(w3, cookie3, R9, { for: w.agent.key }), 'a complete at that age still finishes it, as the carrier');
    assert.equal(busFile(single).actions.find((a) => a.id === R9).status, 'done');
    const saved = (await call(server, 'GET', '/api/modules/activity', { cookie: cookie3 })).json.activity.find((l) => l.what === 'saved plan:p1');
    assert.equal(saved?.byName, `Claude (agent), carried out by ${adminName}'s page`, 'the earlier lines survive the restarts');
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
  await test('hosted: the asker is carried inside one environment, and an id or a person from another is no use', async () => {
    const A = await askByAgent(acme, 'Acme thing');
    const B = await askByPerson(beta, beta.miaCookie, 'Beta thing');
    ok(await claim(acme, acmeOwner, A), 'acme claims its own');
    ok(await claim(beta, betaOwner, B), 'beta claims its own');
    const lineOf = async (what, ww) => (await activity(ww)).find((l) => l.what === what);
    const betaOwnerName = (await call(server, 'GET', '/api/me', { host: 'beta', cookie: betaOwner })).json.user.displayName;
    // Ignored: saved as the carrier in its own environment, naming nobody from the other.
    ok(await putPlan(beta, betaOwner, 'plan:z1', plan('z1'), { for: acme.agent.key, request: B }), 'an agent of acme named at beta');
    ok(await putPlan(beta, betaOwner, 'plan:z3', plan('z3'), { for: acme.agent.key, request: A + 1000 }), 'an id beta does not have');
    ok(await putPlan(acme, acmeOwner, 'plan:z2', plan('z2'), { for: beta.mia.key, request: A }), 'a person of beta named at acme');
    for (const [ww, key] of [[beta, 'plan:z1'], [beta, 'plan:z3'], [acme, 'plan:z2']]) {
      assert.equal((await lineOf(`saved ${key}`, ww)).carriedBy, undefined, `${key}: nobody else named`);
    }
    const betaCopies = (await calendarCopies(beta)).find((c) => c.title === 'z1');
    assert.equal(betaCopies.by, betaOwnerName);
    ok(await putPlan(acme, acmeOwner, 'plan:a1', plan('Acme thing'), { for: acme.agent.key, request: A }), 'acme writes for its agent');
    ok(await putPlan(beta, betaOwner, 'plan:b1', plan('Beta thing'), { for: beta.mia.key, request: B }), 'beta writes for Mia');
    assert.match((await lineOf('saved plan:a1', acme)).byName, /^Claude \(agent\), carried out by .+'s page$/);
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
