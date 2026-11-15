#!/usr/bin/env node
/*
 * check-phase-measure.mjs -- the phases' measure (documentation/plans/plan-templates-redesign.md, step 6, decisions 37 and 38).
 * The pure rule in server/phase-measure.js (the Done switches cleaned, the goals counted from refs summaries, each phase's
 * state under dates, progress and goals, the current phase), then a throwaway server (its own copy of the app with a stand-in
 * planner that produces the refs kind `plan` with a `phase` and a `done`): the template's phaseMeasure on /look and the
 * context, the Done switch's routes and every refusal (who, which measure, which phase, which value), a goal-measured phase
 * following its entries live, a phase no entry names using the switch, the stored key kept apart from the dates, and a
 * hostile body or id that changes nothing.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const M = require('../server/phase-measure.js');

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`check-phase-measure: ${name}: ${err.stack || err.message}`); }
};

const PHASES = [{ id: 'start', label: 'Start' }, { id: 'build', label: 'Build', main: true }, { id: 'wrap', label: 'Wrap up', icon: 'flag' }];

// --- the pure rule ------------------------------------------------------------------------------------------------

await test('cleanDone keeps only true switches under a phase id, and no more than 50', () => {
  assert.deepEqual(M.cleanDone({ start: true, build: false, wrap: 1, 'Bad Id': true, '': true, x: 'yes' }), { start: true });
  assert.deepEqual(M.cleanDone(null), {});
  assert.deepEqual(M.cleanDone([true]), {});
  assert.deepEqual(M.cleanDone('start'), {});
  const many = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`p${i}`, true]));
  assert.equal(Object.keys(M.cleanDone(many)).length, 50);
});

await test('tallyOf counts only entries that name a known phase and say done or not done', () => {
  const t = M.tallyOf(PHASES, [
    { phase: 'build', done: true }, { phase: 'build', done: false }, { phase: 'build' }, // no done: not a goal to finish
    { phase: 'nope', done: true }, { done: true }, { phase: 5, done: true }, null, 'x', { phase: 'start', done: 'yes' },
    { phase: 'wrap', done: true },
  ]);
  assert.deepEqual(t, { build: { done: 1, total: 2 }, wrap: { done: 1, total: 1 } });
  assert.deepEqual(M.tallyOf(PHASES, null), {});
  assert.deepEqual(M.tallyOf(null, [{ phase: 'build', done: true }]), {});
});

await test('dates: the phases as they are, no state', () => {
  assert.deepEqual(M.statesOf(PHASES, 'dates', { start: true }, null), PHASES);
  assert.deepEqual(M.statesOf(PHASES, undefined, { start: true }, null), PHASES);
  assert.deepEqual(M.statesOf(null, 'progress', {}, null), []);
});

await test('progress: the switch decides, the first phase not done is current', () => {
  assert.deepEqual(M.statesOf(PHASES, 'progress', {}, null).map((p) => [p.id, p.done, p.current]), [['start', false, true], ['build', false, undefined], ['wrap', false, undefined]]);
  assert.deepEqual(M.statesOf(PHASES, 'progress', { start: true }, null).map((p) => [p.id, p.done, p.current]), [['start', true, undefined], ['build', false, true], ['wrap', false, undefined]]);
  assert.deepEqual(M.statesOf(PHASES, 'progress', { wrap: true }, null).map((p) => [p.id, p.done, p.current]), [['start', false, true], ['build', false, undefined], ['wrap', true, undefined]], 'a later one done does not move current');
  assert.deepEqual(M.statesOf(PHASES, 'progress', { start: true, build: true, wrap: true }, null).filter((p) => p.current), [], 'all done: none is current');
  assert.deepEqual(M.statesOf(PHASES, 'progress', { start: true }, { start: { done: 0, total: 3 } })[0].goals, undefined, 'progress never counts goals');
  assert.equal(M.statesOf(PHASES, 'progress', {}, null)[2].icon, 'flag', 'the rest of a phase is kept');
});

await test('goals: done when every entry that names it is done; with none, the switch', () => {
  const tally = { build: { done: 2, total: 3 }, wrap: { done: 1, total: 1 } };
  const s = M.statesOf(PHASES, 'goals', { start: true, build: true }, tally);
  assert.deepEqual(s.map((p) => [p.id, p.done, p.goals, p.current]), [
    ['start', true, undefined, undefined], // no entry names it: the switch
    ['build', false, { done: 2, total: 3 }, true], // entries decide; the switch does not
    ['wrap', true, { done: 1, total: 1 }, undefined],
  ]);
  const all = M.statesOf(PHASES, 'goals', {}, { build: { done: 3, total: 3 } });
  assert.deepEqual(all.map((p) => [p.id, p.done]), [['start', false], ['build', true], ['wrap', false]]);
  assert.equal(M.statesOf(PHASES, 'goals', {}, { build: { done: 0, total: 0 } })[1].done, false, 'no entries counted: not "all done"');
});

await test('a manifest may name the stored fields that fill a summary\'s phase and progress, and no others', () => {
  const { cleanManifest } = require('../server/modules.js');
  const files = new Set(['page.html']);
  const manifest = (summary) => ({ id: 'thing', name: 'Thing', version: '1.0.0', scope: ['environment'], surfaces: { page: { entry: 'page.html' } }, refs: { produces: [{ kind: 'plan', key: 'plan:{id}', summary }] } });
  assert.deepEqual(cleanManifest(manifest({ title: 'title', done: 'done', phase: 'inPhase', progress: 'pct' }), files).refs.produces[0].summary, { title: 'title', done: 'done', phase: 'inPhase', progress: 'pct' });
  assert.throws(() => cleanManifest(manifest({ title: 'title', phase: 'a b' }), files), { message: 'module.json: refs "plan" summary.phase must name a stored field' });
  assert.deepEqual(cleanManifest(manifest({ title: 'title', unknown: 'x' }), files).refs.produces[0].summary, { title: 'title' }, 'an unknown field is left out');
});

await test('the memo keeps an answer until a write, a different sig or its time; it is bounded', () => {
  const { ModuleData } = require('../server/module-data.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-phase-memo-'));
  try {
    const data = new ModuleData(dir);
    let runs = 0;
    const ask = (sig = 'a', ttl = 5000) => data.memo('x', sig, ttl, () => { runs += 1; return { runs }; });
    for (let i = 0; i < 50; i += 1) ask();
    assert.equal(runs, 1, 'fifty asks, one read');
    ask('b');
    assert.equal(runs, 2, 'another sig reads again');
    const before = data.stampOf('m', 'space:abcd1');
    data.put('m', 'space:abcd1', 'plan:a', { title: 't' });
    assert.equal(data.stampOf('m', 'space:abcd1'), before + 1, 'a write moves the stamp');
    assert.equal(data.stampOf('m', 'space:abcd2'), 0, 'another scope does not move');
    ask('b', 0);
    assert.equal(runs, 3, 'a ttl that has passed reads again');
    for (let i = 0; i < 700; i += 1) data.memo(`n${i}`, 's', 5000, () => i);
    assert.ok(data.memos.size <= 500, `bounded: ${data.memos.size}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- the routes -----------------------------------------------------------------------------------------------------

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-phase-measure-'));
const root = path.join(base, 'app');
fs.mkdirSync(path.join(root, 'modules', 'pm-plans', 'src'), { recursive: true });
fs.cpSync(path.join(ROOT, 'server'), path.join(root, 'server'), { recursive: true });
for (const link of ['public', 'templates', 'node_modules', 'package.json']) fs.symlinkSync(path.join(ROOT, link), path.join(root, link));
for (const m of fs.readdirSync(path.join(ROOT, 'modules'))) fs.symlinkSync(path.join(ROOT, 'modules', m), path.join(root, 'modules', m));
fs.writeFileSync(path.join(root, 'modules', 'pm-plans', 'module.json'), JSON.stringify({
  id: 'pm-plans', name: 'Plans', version: '1.0.0', scope: ['space'], icon: 'circle', description: 'A stand-in planner for check-phase-measure.',
  surfaces: { page: { entry: 'pm-plans.html' }, canvas: { entry: 'pm-plans.html' } },
  permissions: [
    { key: 'view', label: 'See it', default: { member: true, moderator: true, guest: true } },
    { key: 'edit', label: 'Change it', default: { member: true, moderator: true, guest: false } },
  ],
  access: { read: 'view', write: 'edit' },
  refs: { produces: [
    { kind: 'plan', name: 'Goal', key: 'plan:{id}', summary: { title: 'title', done: 'done', phase: 'phase', progress: 'progress' } },
    { kind: 'note', name: 'Note', key: 'note:{id}', summary: { title: 'title', done: 'done', phase: 'phase' } }, // not a planner's kind: never counted
  ] },
}, null, 2));
fs.writeFileSync(path.join(root, 'modules', 'pm-plans', 'src', 'pm-plans.html'), '<!DOCTYPE html><html><head><style>/*__CSS__*/</style></head><body><script>/*__JS__*/</script></body></html>');
fs.writeFileSync(path.join(root, 'modules', 'pm-plans', 'src', 'pm-plans.css'), '');
fs.writeFileSync(path.join(root, 'modules', 'pm-plans', 'src', 'pm-plans.js'), '');

let child = null;
function startServer() {
  child = spawn(process.execPath, [path.join(root, 'server', 'index.js')], {
    cwd: root,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: path.join(root, 'data'), TZ: 'UTC', ADMIN_PASSWORD: 'admin-password-1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 20000);
    const onData = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve({ port: Number(m[1]) }); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
}
const stopServer = () => new Promise((resolve) => { if (!child || child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
function call(server, method, urlPath, { body, cookie } = {}) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const headers = { host: `127.0.0.1:${server.port}`, accept: 'application/json' };
  if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = payload.length; }
  if (cookie) headers.cookie = cookie;
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
const answer = (r) => [r.status, r.json];

try {
  const server = await startServer();
  const admin = cookieOf(await call(server, 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } }));
  const asAdmin = (method, url, body) => call(server, method, url, { cookie: admin, body });
  const makeUser = async (login) => {
    const made = await asAdmin('POST', '/api/users', { login, displayName: login, role: 'member', password: `${login}-password-1` });
    assert.equal(made.status, 201, made.text);
    return { key: made.json.user.key, cookie: cookieOf(await call(server, 'POST', '/api/login', { body: { login, password: `${login}-password-1` } })) };
  };
  const mia = await makeUser('mia'); // a member
  const mo = await makeUser('mo'); // a member who moderates the space
  const ola = await makeUser('ola'); // not in the space
  const as = (who) => (method, url, body) => call(server, method, url, { cookie: who.cookie, body });
  const made = await asAdmin('POST', '/api/spaces', { name: 'Launch', members: [mia.key, mo.key] });
  assert.equal(made.status, 200, made.text);
  const space = made.json.space;
  assert.equal((await asAdmin('PATCH', `/api/users/${mo.key}/spaces/${space.id}`, { permissions: { moderator: true } })).status, 200);
  const other = (await asAdmin('POST', '/api/spaces', { name: 'Other', members: [mia.key] })).json.space;
  { const r = await asAdmin('POST', '/api/modules/bundled/pm-plans/install'); assert.equal(r.status, 201, r.text); }
  assert.equal((await asAdmin('PATCH', '/api/modules/pm-plans', { enabled: true, spaces: [space.id, other.id] })).status, 200);
  // The template: a copy of the Default (it lists the modules on here, the stand-in among them), with three phases.
  assert.equal((await asAdmin('POST', '/api/environment/templates', { from: 'default', id: 'plain', name: 'Plain' })).status, 201);
  const setTemplate = async (patch) => {
    const r = await asAdmin('PATCH', '/api/environment/templates/plain', patch);
    assert.equal(r.status, 200, r.text);
  };
  await setTemplate({ phases: PHASES, phaseMeasure: 'progress' });
  assert.equal((await asAdmin('PATCH', '/api/settings', { template: 'plain' })).status, 200);
  const phasesUrl = `/api/spaces/${space.id}/phases`;
  const stored = () => JSON.parse(fs.readFileSync(path.join(root, 'data', 'app.json'), 'utf8')).spaces.find((s) => s.id === space.id);
  const states = async (who = asAdmin) => (await who('GET', phasesUrl)).json;
  const put = async (key, value, spaceId = space.id) => {
    const r = await asAdmin('PUT', `/api/modules/pm-plans/data/${encodeURIComponent(key)}?scope=space&space=${spaceId}`, { value });
    assert.equal(r.status, 200, r.text);
  };

  await test('progress: GET lists the phases with done and current; /look and the context carry the measure', async () => {
    const got = await states(as(mia));
    assert.equal(got.measure, 'progress');
    assert.deepEqual(got.phases.map((p) => [p.id, p.label, p.done, p.current, p.main, p.icon]), [['start', 'Start', false, true, undefined, undefined], ['build', 'Build', false, undefined, true, undefined], ['wrap', 'Wrap up', false, undefined, undefined, 'flag']]);
    assert.equal((await as(mia)('GET', `/api/spaces/${space.id}/look`)).json.look.phaseMeasure, 'progress');
    const ctx = (await as(mia)('GET', `/api/modules/pm-plans/context?scope=space&space=${space.id}`)).json;
    assert.equal(ctx.phaseMeasure, 'progress');
    assert.deepEqual(ctx.phases.map((p) => [p.id, p.done, p.current]), [['start', false, true], ['build', false, undefined], ['wrap', false, undefined]]);
  });

  await test('the switch: an owner and a moderator flip it, it is stored apart from the dates, the first phase not done moves on', async () => {
    assert.deepEqual(answer(await asAdmin('PUT', `${phasesUrl}/start/done`, { done: true })).map((x, i) => (i ? x.phases.map((p) => [p.id, p.done, p.current]) : x)), [200, [['start', true, undefined], ['build', false, true], ['wrap', false, undefined]]]);
    assert.deepEqual(stored().phaseDone, { start: true });
    assert.equal((await as(mo)('PUT', `${phasesUrl}/build/done`, { done: true })).status, 200, 'a moderator');
    assert.deepEqual(stored().phaseDone, { start: true, build: true });
    assert.deepEqual((await states(as(mia))).phases.map((p) => [p.id, p.done, p.current]), [['start', true, undefined], ['build', true, undefined], ['wrap', false, true]], 'a member reads it');
    // a save of the dates does not touch the switches, and a switch does not touch the dates
    assert.equal((await asAdmin('PATCH', `/api/spaces/${space.id}`, { phases: { build: { start: '2026-12-01' } } })).status, 200);
    assert.deepEqual(stored().phaseDone, { start: true, build: true });
    assert.equal((await asAdmin('PUT', `${phasesUrl}/build/done`, { done: false })).status, 200);
    assert.deepEqual([stored().phaseDone, stored().phases], [{ start: true }, { build: { start: '2026-12-01' } }]);
    assert.equal((await asAdmin('PUT', `${phasesUrl}/start/done`, { done: false })).status, 200);
    assert.equal('phaseDone' in stored(), false, 'the last one off stores nothing');
    assert.equal((await asAdmin('PATCH', `/api/spaces/${space.id}`, { phases: null })).status, 200);
  });

  await test('refusals, each with its status and one sentence, and nothing changed', async () => {
    const before = JSON.stringify(stored());
    assert.deepEqual(answer(await as(mia)('PUT', `${phasesUrl}/start/done`, { done: true })), [403, { error: 'owners only' }], 'a member');
    assert.equal((await as(ola)('PUT', `${phasesUrl}/start/done`, { done: true })).status, 404, 'someone outside the space');
    assert.equal((await call(server, 'PUT', `${phasesUrl}/start/done`, { body: { done: true } })).status, 401, 'no sign-in');
    assert.deepEqual(answer(await asAdmin('PUT', `${phasesUrl}/nope/done`, { done: true })), [404, { error: 'There is no phase called "nope".' }]);
    assert.deepEqual(answer(await asAdmin('PUT', `${phasesUrl}/__proto__/done`, { done: true })), [404, { error: 'There is no phase called "__proto__".' }]);
    assert.deepEqual(answer(await asAdmin('PUT', `${phasesUrl}/constructor/done`, { done: true })), [404, { error: 'There is no phase called "constructor".' }]);
    for (const body of [{ done: 'true' }, { done: 1 }, { done: null }, {}, { done: [true] }]) {
      assert.deepEqual(answer(await asAdmin('PUT', `${phasesUrl}/start/done`, body)), [400, { error: 'Send done as true or false.' }], JSON.stringify(body));
    }
    assert.equal((await asAdmin('PUT', '/api/spaces/nope/phases/start/done', { done: true })).status, 404);
    assert.equal(JSON.stringify(stored()), before, 'nothing changed');
    // a moderator of another space may not
    assert.equal((await as(mo)('PUT', `/api/spaces/${other.id}/phases/start/done`, { done: true })).status, 404, 'a space they are not in');
    // the switch is not on PATCH: a hostile field there changes nothing
    assert.equal((await asAdmin('PATCH', `/api/spaces/${space.id}`, { phaseDone: { start: true } })).status, 200);
    assert.equal('phaseDone' in stored(), false, 'PATCH does not take it');
    assert.equal((await as(mo)('PATCH', `/api/spaces/${space.id}`, { phaseDone: { start: true } })).status, 403);
  });

  await test('dates: no state and no switch', async () => {
    await setTemplate({ phaseMeasure: 'dates' });
    const got = await states(as(mia));
    assert.deepEqual([got.measure, got.phases], ['dates', PHASES]);
    assert.deepEqual(answer(await asAdmin('PUT', `${phasesUrl}/start/done`, { done: true })), [409, { error: 'Phases here are measured by their dates, so Start has no Done switch.' }]);
    assert.equal('phaseDone' in stored(), false);
    assert.equal((await as(mia)('GET', `/api/modules/pm-plans/context?scope=space&space=${space.id}`)).json.phaseMeasure, 'dates');
  });

  await test('goals: entries decide, live; a phase no entry names uses the switch; only planner entries that name a known phase count', async () => {
    await setTemplate({ phaseMeasure: 'goals' });
    assert.deepEqual((await states(as(mia))).phases.map((p) => [p.id, p.done, p.goals, p.current]), [['start', false, undefined, true], ['build', false, undefined, undefined], ['wrap', false, undefined, undefined]], 'nothing names a phase yet: the switches');
    await put('plan:g1', { title: 'Ship it', phase: 'build', done: true, progress: 100 });
    await put('plan:g2', { title: 'Test it', phase: 'build', done: false, progress: 40 });
    await put('plan:g3', { title: 'Loose', done: false }); // names no phase
    await put('plan:g4', { title: 'Stale', phase: 'gone', done: false }); // a phase the template does not have
    await put('plan:g5', { title: 'Just a line', phase: 'build' }); // no done: not counted
    await put('note:n1', { title: 'A note', phase: 'build', done: false }); // not a `plan`
    await put('plan:o1', { title: 'Elsewhere', phase: 'build', done: false }, other.id); // another space
    let got = await states(as(mia));
    assert.deepEqual(got.phases.map((p) => [p.id, p.done, p.goals, p.current]), [['start', false, undefined, true], ['build', false, { done: 1, total: 2 }, undefined], ['wrap', false, undefined, undefined]]);
    // Decision 38, as accepted: whoever may write an entry decides the goals. A raw entry naming Build with done: false keeps it not
    // done, and the owner's switch cannot say otherwise.
    assert.deepEqual(answer(await asAdmin('PUT', `${phasesUrl}/build/done`, { done: true })), [409, { error: 'Build is done when every goal that names it is done, so it has no Done switch.' }]);
    assert.equal(got.phases[1].done, false);
    assert.equal('phaseDone' in stored(), false, 'the refused switch stored nothing');
    // Anyone who may enter reads the counts, a link guest too; someone who may not gets the same 404 as an unknown id.
    const link = (await asAdmin('POST', `/api/spaces/${space.id}/guest-link`, {})).json.space.guestToken;
    assert.ok(link, 'a guest link');
    const viaLink = await call(server, 'GET', `${phasesUrl}?guest=${link}`);
    assert.deepEqual([viaLink.status, viaLink.json.measure, viaLink.json.phases[1].goals], [200, 'goals', { done: 1, total: 2 }]);
    assert.equal((await call(server, 'GET', `/api/spaces/${other.id}/phases?guest=${link}`)).status, 404, 'that link, another space');
    assert.equal((await call(server, 'GET', phasesUrl)).status, 404, 'no sign-in and no link');
    await put('plan:g2', { title: 'Test it', phase: 'build', done: true });
    got = await states(as(mia));
    assert.deepEqual(got.phases[1], { id: 'build', label: 'Build', main: true, done: true, goals: { done: 2, total: 2 } }, 'the entries all done');
    const ctx = (await as(mia)('GET', `/api/modules/pm-plans/context?scope=space&space=${space.id}`)).json;
    assert.deepEqual(ctx.phases[1], got.phases[1], 'the same in the context');
    // the switch of a phase with entries is refused; of a phase with none it works and is read
    assert.deepEqual(answer(await asAdmin('PUT', `${phasesUrl}/build/done`, { done: false })), [409, { error: 'Build is done when every goal that names it is done, so it has no Done switch.' }]);
    assert.equal((await asAdmin('PUT', `${phasesUrl}/start/done`, { done: true })).status, 200);
    got = await states(as(mia));
    assert.deepEqual(got.phases.map((p) => [p.id, p.done, p.current]), [['start', true, undefined], ['build', true, undefined], ['wrap', false, true]]);
    // a planner the template does not offer is off in the space and is not read
    const whole = (await asAdmin('GET', '/api/environment/templates/plain')).json.template.modules;
    const { 'pm-plans': _off, ...without } = whole;
    await setTemplate({ modules: without });
    assert.deepEqual((await states(as(mia))).phases[1].goals, undefined, 'off in this space: its entries name nothing');
    await setTemplate({ modules: whole });
    assert.deepEqual((await states(as(mia))).phases[1].goals, { done: 2, total: 2 });
  });

  await test('a phase named in a way that is not a phase id counts for nothing', async () => {
    await put('plan:h1', { title: 'Odd', phase: 'Build Phase!', done: false, progress: 250 });
    await put('plan:h2', { title: 'Odd2', phase: 'wrap', done: false, progress: -5 });
    await put('plan:h3', { title: 'Odd3', phase: 'wrap', done: false, progress: 'lots' });
    // a stored phase that is not a phase id never counts, whatever it holds
    assert.equal((await states(as(mia))).phases[2].goals.total, 2, 'wrap counts the two with a real id');
  });

  await test('a stale switch stays when the template drops the phase; the owner still reads the rest', async () => {
    await setTemplate({ phaseMeasure: 'progress' });
    assert.equal((await asAdmin('PUT', `${phasesUrl}/wrap/done`, { done: true })).status, 200);
    await setTemplate({ phases: PHASES.filter((p) => p.id !== 'wrap') });
    assert.deepEqual(stored().phaseDone, { start: true, wrap: true }, 'kept as stored');
    assert.deepEqual((await states(as(mia))).phases.map((p) => [p.id, p.done]), [['start', true], ['build', false]]);
    assert.equal((await asAdmin('PUT', `${phasesUrl}/wrap/done`, { done: false })).status, 404, 'a phase the template lacks is refused');
    assert.deepEqual(stored().phaseDone, { start: true, wrap: true });
  });

  await test('a big planner: 5,000 entries answer warm inside the budget, and a write shows on the next ask', async () => {
    await setTemplate({ phaseMeasure: 'goals' });
    await stopServer();
    const file = path.join(root, 'data', 'modules', 'pm-plans', 'data', `space-${space.id}.json`);
    const rows = {};
    const at = new Date().toISOString();
    for (let i = 0; i < 5000; i += 1) rows[`plan:b${i}`] = { value: { title: `Goal ${i}`, phase: 'build', done: i % 2 === 0 }, version: 1, updatedAt: at, by: 'seed' };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(rows));
    const big = await startServer();
    const cookie = cookieOf(await call(big, 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } }));
    const get = () => call(big, 'GET', phasesUrl, { cookie });
    const cold = await get();
    assert.deepEqual(cold.json.phases[1].goals, { done: 2500, total: 5000 });
    const t0 = process.hrtime.bigint();
    const warm = await get();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.deepEqual(warm.json.phases[1].goals, { done: 2500, total: 5000 });
    assert.ok(ms < 50, `a warm ask took ${ms.toFixed(1)} ms`);
    const t1 = process.hrtime.bigint();
    const many = await Promise.all(Array.from({ length: 50 }, () => get()));
    const total = Number(process.hrtime.bigint() - t1) / 1e6;
    assert.ok(many.every((r) => r.json.phases[1].goals.total === 5000));
    assert.ok(total < 1000, `fifty asks took ${total.toFixed(0)} ms`);
    const w = await call(big, 'PUT', `/api/modules/pm-plans/data/plan%3Ab1?scope=space&space=${space.id}`, { cookie, body: { value: { title: 'Goal 1', phase: 'build', done: true } } });
    assert.equal(w.status, 200, w.text);
    assert.deepEqual((await get()).json.phases[1].goals, { done: 2501, total: 5000 }, 'the next ask sees the write');
    const del = await call(big, 'DELETE', `/api/modules/pm-plans/data/plan%3Ab3?scope=space&space=${space.id}`, { cookie });
    assert.equal(del.status, 200, del.text);
    assert.deepEqual((await get()).json.phases[1].goals, { done: 2501, total: 4999 }, 'and a delete');
    await stopServer();
    fs.rmSync(file);
    await startServer();
  });

  await test('the server keeps working after a restart: the switches are read from the file', async () => {
    await stopServer();
    const again = await startServer();
    const cookie = cookieOf(await call(again, 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } }));
    const got = (await call(again, 'GET', phasesUrl, { cookie })).json;
    assert.deepEqual(got.phases.map((p) => [p.id, p.done, p.current]), [['start', true, undefined], ['build', false, true]]);
  });
} finally {
  await stopServer();
  fs.rmSync(base, { recursive: true, force: true });
}

if (failed) { console.error(`check-phase-measure: ${failed} failed, ${n} passed`); process.exit(1); }
console.log(`check-phase-measure: ${n} checks passed`);
