#!/usr/bin/env node
/*
 * check-call-settings.mjs -- the core call settings (documentation/plans/plan-templates-redesign.md, step 4, server half,
 * decisions 16 and 37): `space.call` { joinOnEntry?, position?, layout? }, each a template default the space may change.
 *
 * Part 1, in node: the rules (server/call-settings.js); the resolver (template, then the space's own; a missing key is the
 * template's; an aside reads its origin's); a template change keeping what a space holds; load keeping only usable values;
 * the export list; the sentences.
 * Part 2, a throwaway server: who may change it (the admin, an owner, a moderator of that space; never a member, an outsider,
 * a guest or no one), every refusal with its status and one sentence, null clearing, the stored key, the reads (GET
 * /api/spaces/:id, /look), the environment's autoJoinCall gone, hostile bodies.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

process.env.TZ = 'UTC';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { Store } = require('../server/store.js');
const templates = require('../server/templates.js');
const exportLib = require('../server/environment-export.js');
const rules = require('../server/call-settings.js');

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`check-call-settings: ${name}: ${err.stack || err.message}`); }
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-call-settings-'));

// --- part 1: the rules and the store -----------------------------------------------------------------------------------------

await test('the rules: the lists, the defaults, one sentence per refusal', () => {
  assert.deepEqual(rules.CALL_KEYS, ['joinOnEntry', 'position', 'layout']);
  assert.deepEqual(templates.CALL_POSITIONS, rules.CALL_POSITIONS, 'a template and a space use the same lists');
  assert.deepEqual(templates.CALL_LAYOUTS, rules.CALL_LAYOUTS);
  assert.deepEqual(rules.CALL_DEFAULTS, { joinOnEntry: false, position: 'top', layout: 'grid' }, 'the Default template\'s own values');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'default.json'), 'utf8')).call, rules.CALL_DEFAULTS);
  assert.deepEqual(rules.applyCallPatch({}, { position: 'left' }), { call: { position: 'left' } });
  assert.deepEqual(rules.applyCallPatch({ position: 'left', layout: 'strip' }, { layout: null }), { call: { position: 'left' } }, 'null on a key follows the template again');
  assert.deepEqual(rules.applyCallPatch({ position: 'left' }, null), { call: {} }, 'null follows the template for all three');
  assert.deepEqual(rules.applyCallPatch({ position: 'left' }, {}), { call: { position: 'left' } }, 'an empty patch changes nothing');
  for (const bad of [[], 'top', 7, true]) assert.match(rules.applyCallPatch({}, bad).error, /^The call's settings are sent as an object/, JSON.stringify(bad));
  for (const [patch, re] of [
    [{ position: 'sideways' }, /^The call's position must be one of top, bottom, left, right, float, workspace, window\.$/],
    [{ position: 7 }, /^The call's position must be one of/],
    [{ layout: 'wall' }, /^The call's layout must be one of grid, strip, focus, spotlight\.$/],
    [{ joinOnEntry: 'yes' }, /^The call's joinOnEntry must be true or false\.$/],
    [{ joinOnEntry: 1 }, /^The call's joinOnEntry must be true or false\.$/],
    [{ volume: 3 }, /^volume is not a call setting; the call takes only joinOnEntry, position, layout\.$/],
    [{ ['x'.repeat(500)]: 1 }, /^x{40} is not a call setting/],
  ]) assert.match(rules.applyCallPatch({}, patch).error, re, JSON.stringify(patch).slice(0, 60));
  // one bad key refuses the whole patch: nothing of it is applied
  assert.ok(rules.applyCallPatch({ position: 'left' }, { layout: 'strip', position: 'nope' }).error);
  // resolve: later layers win key by key; unusable values and non-objects are skipped
  assert.deepEqual(rules.resolveCall({ position: 'left', layout: 'wall' }, { layout: 'strip' }, null, 'x', []), { position: 'left', layout: 'strip' });
  const hostile = JSON.parse('{"__proto__":{"position":"left"},"position":"top"}');
  assert.deepEqual(rules.resolveCall(hostile), { position: 'top' });
  assert.equal(({}).position, undefined, 'nothing reaches Object.prototype');
});

const PROJECT = templates.cleanTemplate({
  id: 'project', name: 'Project', description: 'A project.', modules: { chat: {} },
  call: { joinOnEntry: true, position: 'left', layout: 'strip' },
}, { manifests: templates.bundledManifests() });
const fresh = (name, env = 'default') => {
  const store = new Store(fs.mkdtempSync(path.join(tmp, `${name}-`)));
  const known = { project: PROJECT };
  store.templateById = (id) => known[id] || templates.get(id) || null;
  templates.useLive(store, store.templateById(env));
  return store;
};

await test('the resolver: the template, then the space; a missing key is the template\'s; the Lobby reads the environment\'s', () => {
  const store = fresh('resolver', 'project');
  const a = store.addSpace({ name: 'A' });
  assert.deepEqual(store.lookOf(a.id).call, { joinOnEntry: true, position: 'left', layout: 'strip' });
  store.updateSpace(a.id, { call: { position: 'bottom' } });
  assert.deepEqual(store.lookOf(a.id).call, { joinOnEntry: true, position: 'bottom', layout: 'strip' });
  assert.deepEqual(store.spaceById(a.id).call, { position: 'bottom' }, 'only what was set is stored');
  store.updateSpace(a.id, { call: { joinOnEntry: false } });
  assert.deepEqual(store.spaceById(a.id).call, { position: 'bottom', joinOnEntry: false }, 'a patch adds to what is held');
  assert.equal(store.lookOf(a.id).call.joinOnEntry, false, 'the space\'s own false beats the template\'s true');
  const b = store.addSpace({ name: 'B' });
  assert.deepEqual(store.lookOf(b.id).call, { joinOnEntry: true, position: 'left', layout: 'strip' }, 'another space is not touched');
  assert.deepEqual(store.lookOf(null).call, { joinOnEntry: true, position: 'left', layout: 'strip' }, 'the Lobby reads the environment\'s template');
  store.updateSpace(a.id, { call: null });
  assert.equal('call' in store.spaceById(a.id), false, 'null stores nothing');
  assert.deepEqual(store.lookOf(a.id).call, { joinOnEntry: true, position: 'left', layout: 'strip' });
  store.updateSpace(a.id, { call: { layout: 'spotlight' } });
  store.updateSpace(a.id, { call: { layout: null } });
  assert.equal('call' in store.spaceById(a.id), false, 'the last key cleared stores nothing');
});

await test('a refused patch changes nothing; the Lobby refuses call and reads only the template\'s', () => {
  const store = fresh('refuse', 'project');
  const a = store.addSpace({ name: 'A' });
  store.updateSpace(a.id, { call: { position: 'right' } });
  assert.throws(() => store.updateSpace(a.id, { name: 'Renamed', call: { position: 'right', layout: 'wall' } }), (e) => e.status === 400 && /layout must be one of/.test(e.message));
  assert.deepEqual([store.spaceById(a.id).name, store.spaceById(a.id).call], ['A', { position: 'right' }]);
  assert.throws(() => store.updateSpace('lobby', { call: { layout: 'focus' } }), (e) => e.status === 400 && e.message === "The Lobby follows the template's call.");
  assert.equal('call' in store.spaceById('lobby'), false, 'nothing stored on the Lobby');
  store.spaceById('lobby').call = { layout: 'focus' }; // a hand-edited record
  assert.equal(store.lookOf('lobby').call.layout, 'strip', 'the Lobby reads only the template\'s call');
});

await test('a template change keeps what a space holds and follows the new template for the rest; an edited template follows at once', () => {
  const store = fresh('change', 'default');
  const a = store.addSpace({ name: 'A' });
  store.updateSpace(a.id, { call: { position: 'window' } });
  store.templateById = (id) => ({ project: PROJECT }[id] || templates.get(id));
  store.updateSpace(a.id, { template: 'project' });
  assert.deepEqual(store.lookOf(a.id).call, { joinOnEntry: true, position: 'window', layout: 'strip' });
  store.updateSpace(a.id, { template: null });
  assert.deepEqual(store.lookOf(a.id).call, { joinOnEntry: false, position: 'window', layout: 'grid' });
});

await test('load keeps only usable values; export and import carry the key', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'load-'));
  const store = new Store(dir);
  const a = store.addSpace({ name: 'A' });
  store.updateSpace(a.id, { call: { position: 'float', joinOnEntry: true } });
  const file = path.join(dir, 'app.json');
  const app = JSON.parse(fs.readFileSync(file, 'utf8'));
  app.spaces.find((s) => s.id === a.id).call = { position: 'sideways', layout: 'focus', joinOnEntry: 'yes', extra: 1 };
  app.spaces.find((s) => s.id === 'lobby').call = 'nope';
  fs.writeFileSync(file, JSON.stringify(app));
  const again = new Store(dir);
  assert.deepEqual(again.spaceById(a.id).call, { layout: 'focus' }, 'a bad value, a wrong type and an unknown key are dropped');
  assert.equal('call' in again.spaceById('lobby'), false);
  assert.ok(exportLib.SPACE_FIELDS.includes('call'), 'a space\'s call travels in an environment export');
});

// --- part 2: the routes ------------------------------------------------------------------------------------------------------

let child = null;
function startServer(dataDir, env = {}) {
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, TZ: 'UTC', PRODUCT_NAME: 'Testname', ADMIN_PASSWORD: 'admin-password-1', TEMPLATE: 'travel', ENABLE_GUEST_DOOR: 'true', ...env },
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
  const payload = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
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

const dataDir = path.join(tmp, 'data');
try {
  const server = await startServer(dataDir);
  const admin = cookieOf(await call(server, 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } }));
  const as = (cookie) => (method, url, body) => call(server, method, url, { cookie, body });
  const asAdmin = as(admin);
  const makeUser = async (login, role = 'member') => {
    const made = await asAdmin('POST', '/api/users', { login, displayName: login, role, password: `${login}-password-1` });
    assert.equal(made.status, 201, made.text);
    return { key: made.json.user.key, as: as(cookieOf(await call(server, 'POST', '/api/login', { body: { login, password: `${login}-password-1` } }))) };
  };
  const owner = await makeUser('olive', 'owner');
  const mia = await makeUser('mia');
  const mo = await makeUser('mo');
  const out = await makeUser('ola');
  const trip = (await asAdmin('POST', '/api/spaces', { name: 'Lisbon', members: [mia.key, mo.key] })).json.space;
  const other = (await asAdmin('POST', '/api/spaces', { name: 'Porto', members: [mia.key, mo.key] })).json.space;
  assert.equal((await asAdmin('PATCH', `/api/users/${mo.key}/spaces/${trip.id}`, { permissions: { moderator: true } })).status, 200);
  const stored = (id) => JSON.parse(fs.readFileSync(path.join(dataDir, 'app.json'), 'utf8')).spaces.find((s) => s.id === id);
  const lookOf = async (who, id) => (await who('GET', `/api/spaces/${id}/look`)).json.look;
  const DEFAULTS = { joinOnEntry: false, position: 'top', layout: 'grid' };

  await test('nothing set: the look carries the template\'s call, whole; no key is stored', async () => {
    assert.deepEqual((await lookOf(mia.as, trip.id)).call, DEFAULTS);
    assert.deepEqual((await asAdmin('GET', `/api/spaces/${trip.id}`)).json.look.call, DEFAULTS);
    assert.equal('call' in stored(trip.id), false);
  });

  await test('the admin, an owner and a moderator of that space change it; the answer and the stored key follow', async () => {
    const a = await asAdmin('PATCH', `/api/spaces/${trip.id}`, { call: { joinOnEntry: true } });
    assert.deepEqual([a.status, a.json.space.call, stored(trip.id).call], [200, { joinOnEntry: true }, { joinOnEntry: true }]);
    const o = await owner.as('PATCH', `/api/spaces/${trip.id}`, { call: { position: 'bottom' } });
    assert.deepEqual([o.status, o.json.space.call], [200, { joinOnEntry: true, position: 'bottom' }]);
    const m = await mo.as('PATCH', `/api/spaces/${trip.id}`, { call: { layout: 'spotlight' } });
    assert.deepEqual([m.status, m.json.space.call], [200, { joinOnEntry: true, position: 'bottom', layout: 'spotlight' }]);
    assert.deepEqual((await lookOf(mia.as, trip.id)).call, { joinOnEntry: true, position: 'bottom', layout: 'spotlight' }, 'a member reads it');
    assert.deepEqual((await mo.as('GET', `/api/spaces/${trip.id}`)).json.space.call, { joinOnEntry: true, position: 'bottom', layout: 'spotlight' }, 'a moderator reads it in Set up');
    assert.deepEqual((await lookOf(mia.as, other.id)).call, DEFAULTS, 'another space is untouched');
    assert.equal('call' in stored(other.id), false);
  });

  await test('refusals: a member, an outsider, no one; a moderator of another space; a moderator mixing a field that is not theirs', async () => {
    const before = JSON.stringify(stored(trip.id));
    const body = { call: { position: 'top' } };
    const owners = { error: 'owners only' };
    assert.deepEqual([(await mia.as('PATCH', `/api/spaces/${trip.id}`, body)).status], [403]);
    assert.deepEqual((await mia.as('PATCH', `/api/spaces/${trip.id}`, body)).json, owners);
    assert.deepEqual((await mo.as('PATCH', `/api/spaces/${other.id}`, body)).json, owners, 'a moderator of another space');
    assert.equal((await mo.as('PATCH', `/api/spaces/${trip.id}`, { call: { position: 'top' }, name: 'Mine' })).status, 403, 'mixed with an owner-only field');
    const o = await out.as('PATCH', `/api/spaces/${trip.id}`, body);
    const unknown = await out.as('PATCH', '/api/spaces/zzzzzzzz', body);
    assert.deepEqual([o.status, o.json], [unknown.status, unknown.json], 'an outsider cannot tell the space from none');
    assert.equal((await call(server, 'PATCH', `/api/spaces/${trip.id}`, { body })).status, 401, 'no one signed in');
    assert.equal(JSON.stringify(stored(trip.id)), before, 'nothing changed');
  });

  await test('bad values: 400 with one sentence, nothing changes', async () => {
    const before = JSON.stringify(stored(trip.id));
    const cases = [
      [{ call: { position: 'sideways' } }, "The call's position must be one of top, bottom, left, right, float, workspace, window."],
      [{ call: { layout: 'wall' } }, "The call's layout must be one of grid, strip, focus, spotlight."],
      [{ call: { joinOnEntry: 'yes' } }, "The call's joinOnEntry must be true or false."],
      [{ call: { volume: 3 } }, 'volume is not a call setting; the call takes only joinOnEntry, position, layout.'],
      [{ call: 'top' }, "The call's settings are sent as an object with joinOnEntry, position, layout, or null to follow the template."],
      [{ call: ['top'] }, "The call's settings are sent as an object with joinOnEntry, position, layout, or null to follow the template."],
      [{ call: { position: { $gt: '' } } }, "The call's position must be one of top, bottom, left, right, float, workspace, window."],
      [{ call: { position: 'left', layout: 'wall' }, name: 'Renamed' }, "The call's layout must be one of grid, strip, focus, spotlight."],
    ];
    for (const [body, sentence] of cases) {
      const r = await asAdmin('PATCH', `/api/spaces/${trip.id}`, body);
      assert.deepEqual([r.status, r.json], [400, { error: sentence }], JSON.stringify(body));
      const mod = await mo.as('PATCH', `/api/spaces/${trip.id}`, { call: body.call });
      assert.equal(mod.status, 400, 'a moderator is held to the same rule');
    }
    const proto = await asAdmin('PATCH', `/api/spaces/${trip.id}`, '{"call":{"__proto__":{"position":"left"}}}');
    assert.equal(proto.status, 400, 'a __proto__ key is no call setting');
    const ctor = await asAdmin('PATCH', `/api/spaces/${trip.id}`, { call: { constructor: 1 } });
    assert.equal(ctor.status, 400);
    assert.equal(JSON.stringify(stored(trip.id)), before, 'nothing changed');
    assert.equal(({}).position, undefined);
  });

  await test('null follows the template again, a key at a time or all of it', async () => {
    const one = await asAdmin('PATCH', `/api/spaces/${trip.id}`, { call: { position: null } });
    assert.deepEqual([one.status, one.json.space.call], [200, { joinOnEntry: true, layout: 'spotlight' }]);
    assert.equal((await lookOf(mia.as, trip.id)).call.position, 'top');
    const all = await mo.as('PATCH', `/api/spaces/${trip.id}`, { call: null });
    assert.equal(all.status, 200);
    assert.equal('call' in all.json.space, false);
    assert.equal('call' in stored(trip.id), false, 'no key stored');
    assert.deepEqual((await lookOf(mia.as, trip.id)).call, DEFAULTS);
  });

  await test('the Lobby refuses call; a door guest and the access key are refused', async () => {
    const l = await asAdmin('PATCH', '/api/spaces/lobby', { call: { position: 'left' } });
    assert.deepEqual([l.status, l.json], [400, { error: "The Lobby follows the template's call." }]);
    assert.equal('call' in stored('lobby'), false);
    const door = await call(server, 'POST', '/api/guest-door', { body: { name: 'Dora' } });
    const dg = cookieOf(door);
    const body = { call: { position: 'left' } };
    const before = JSON.stringify(stored(trip.id));
    for (const [what, cookie] of [['a door guest', dg], ['no one', undefined]]) {
      const r = await call(server, 'PATCH', `/api/spaces/${trip.id}`, { body, cookie });
      assert.ok([401, 403].includes(r.status), `${what}: ${r.status}`);
    }
    const key = (await asAdmin('GET', '/api/settings')).json.streamKey;
    assert.ok(key, 'a stream key exists');
    const k = await call(server, 'PATCH', `/api/spaces/${trip.id}?s=${encodeURIComponent(key)}`, { body });
    assert.ok([401, 403].includes(k.status), `the access key: ${k.status}`);
    assert.equal(JSON.stringify(stored(trip.id)), before, 'nothing changed');
  });

  await test('a link guest reads the space\'s call; the Lobby\'s look stays refused; the environment has no autoJoinCall', async () => {
    await asAdmin('PATCH', `/api/spaces/${trip.id}`, { call: { joinOnEntry: true } });
    const link = (await asAdmin('POST', `/api/spaces/${trip.id}/guest-link`, {})).json.space.guestToken;
    assert.ok(link, 'a guest link exists');
    const g = await call(server, 'GET', `/api/spaces/${trip.id}/look?guest=${encodeURIComponent(link)}`);
    assert.deepEqual([g.status, g.json.look.call.joinOnEntry], [200, true]);
    assert.equal('autoJoinCall' in (await call(server, 'GET', '/api/branding')).json, false);
    assert.equal('autoJoinCall' in (await asAdmin('GET', '/api/settings')).json.settings, false);
  });
} finally {
  await stopServer();
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (failed) { console.error(`check-call-settings: ${failed} failed, ${n} passed`); process.exit(1); }
console.log(`check-call-settings: ${n} passed`);
