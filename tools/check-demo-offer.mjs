#!/usr/bin/env node
/*
 * check-demo-offer.mjs -- the host console's offer of a demo's modules and the moderator refusal
 * (GET /api/host/demos, POST /api/host/environments/:slug/demo; server/demo-loader.js).
 * Boots a throwaway hosted server (BASE_DOMAIN=localhost) and asserts:
 *  (a) the demos answer lists each demo's needed modules ([{ id, name }], never the built-in chat); with ?environment=<slug>
 *      each also says whether it is on; an unknown environment is 404; a stranger is 401;
 *  (b) loading with modules ticked turns exactly those on (and what they need), only modules the demo names, and the answer
 *      says which (`turnedOn`); loading with none ticked, or no list, turns none on;
 *  (c) a ticked module the demo does not need, a value that is not a list of texts, and hostile ids (__proto__, constructor,
 *      a long id) are refused with a 400 and one sentence, and change nothing (no module turned on, no space, no stand-in);
 *      a __proto__ key in the body is only data;
 *  (d) a demo login marked demo that is a moderator of a real space is refused (409) before any change: no module turned on
 *      even when ticked, no space, no stand-in, its old password still signs in; a demo person who moderates a demo space
 *      (its description starts with the marker) is fine.
 * No LiveKit and no browser.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = { login: 'boss', password: 'check-demo-offer-1' };
const OWNER_PASSWORD = 'owner-password-1234';
const port = await new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-demo-offer-'));
let log = '';
const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), DATA_DIR: dataDir, BASE_DOMAIN: 'localhost', ADMIN_LOGIN: HOST.login, ADMIN_PASSWORD: HOST.password, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret' },
});
child.stdout.on('data', (d) => { log += d; });
child.stderr.on('data', (d) => { log += d; });
let ip = 0;
const call = (method, host, urlPath, body, headers = {}) => new Promise((resolve, reject) => {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  ip += 1;
  const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: { host: `${host}.localhost:${port}`, accept: 'application/json', 'x-forwarded-for': `198.51.100.${ip}`, ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}), ...headers } }, (res) => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', (d) => { text += d; });
    res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ } resolve({ status: res.statusCode, json, text, cookie: (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ') }); });
  });
  req.on('error', reject);
  if (payload) req.write(payload);
  req.end();
});
const stop = () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
let failed = 0;
try {
  for (let i = 0; i < 100; i += 1) {
    if (/listening on/.test(log)) break;
    if (child.exitCode !== null) throw new Error(`the server stopped:\n${log}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  const login = await call('POST', 'admin', '/api/host/login', HOST);
  assert.equal(login.status, 200, login.text);
  const admin = { cookie: login.cookie };
  const PLAN_NO_POLLS = { name: 'nopolls', modules: ['travel', 'todo', 'calendar', 'maps', 'budget', 'research', 'documents'], members: null, storageBytes: null, aiCallsPerMonth: null, calls: null };
  const PLAN_TINY = { name: 'tiny', modules: 'all', members: 4, storageBytes: null, aiCallsPerMonth: null, calls: null };
  const SLUGS = ['alpha', 'beta', 'gamma', 'delta', 'eps', 'zeta', 'theta', 'iota'];
  for (const slug of SLUGS) {
    const made = await call('POST', 'admin', '/api/host/environments', { slug, name: slug, template: 'travel', ...(slug === 'theta' ? { plan: PLAN_TINY } : slug === 'iota' ? { plan: PLAN_NO_POLLS } : {}), owner: { login: `own${slug}`, displayName: slug, password: OWNER_PASSWORD } }, admin);
    assert.equal(made.status, 201, made.text);
  }
  const ownerOf = async (slug) => {
    const r = await call('POST', slug, '/api/login', { login: `own${slug}`, password: OWNER_PASSWORD });
    assert.equal(r.status, 200, r.text);
    return { cookie: r.cookie };
  };
  // A template picked at creation turns its modules on in the background: wait until each environment's set stops changing.
  const onIdsOf = async (slug) => (await call('GET', slug, '/api/modules', undefined, await ownerOf(slug))).json.modules.filter((m) => m.enabled).map((m) => m.id).sort();
  for (const slug of SLUGS) {
    let last = '';
    for (let i = 0; i < 40; i += 1) {
      const now = JSON.stringify(await onIdsOf(slug));
      if (now === last) break;
      last = now;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  // A travel environment has them all on: turn off the ones the checks below tick (the owner's own switch).
  for (const slug of SLUGS) {
    const o = await ownerOf(slug);
    for (const id of ['todo', 'polls', 'maps', 'budget']) { const r = await call('PATCH', slug, `/api/modules/${id}`, { enabled: false, force: true }, o); assert.ok(r.status === 200 || (slug === 'iota' && id === 'polls' && r.status === 404), `${id} turns off in ${slug}`); }
  }
  const url = (slug) => `/api/host/environments/${slug}/demo`;
  const ask = (slug, body) => call('POST', 'admin', url(slug), body, admin);
  const onIds = async (slug) => (await call('GET', slug, '/api/modules', undefined, await ownerOf(slug))).json.modules.filter((m) => m.enabled).map((m) => m.id).sort();
  // Nothing was changed: the same modules on, no demo space, no stand-in.
  const unchanged = async (slug, before, why) => {
    const o = await ownerOf(slug);
    assert.deepEqual(await onIds(slug), before, `${why}: no module was turned on`);
    assert.ok(!(await call('GET', slug, '/api/spaces', undefined, o)).json.spaces.some((s) => /^Demo:/.test(s.name)), `${why}: no demo space`);
    assert.ok(!(await call('GET', slug, '/api/users', undefined, o)).json.users.some((u) => u.login === 'host-demo'), `${why}: no stand-in left`);
  };

  // (a) the answer
  assert.equal((await call('GET', 'admin', '/api/host/demos')).status, 401, 'a stranger is refused');
  const plain = await call('GET', 'admin', '/api/host/demos', undefined, admin);
  assert.equal(plain.status, 200, plain.text);
  const travel = plain.json.demos.find((d) => d.id === 'travel');
  assert.deepEqual(travel.modules.map((m) => m.id).sort(), ['budget', 'calendar', 'documents', 'maps', 'polls', 'research', 'todo', 'travel', 'vault', 'whiteboard']);
  for (const d of plain.json.demos) {
    assert.ok(Array.isArray(d.modules) && d.modules.length, `${d.id} lists its modules`);
    for (const m of d.modules) {
      assert.ok(typeof m.id === 'string' && typeof m.name === 'string' && m.name, `${d.id}: ${m.id} has a name`);
      assert.notEqual(m.id, 'chat', 'the built-in chat is never offered');
      assert.ok(!('on' in m), 'no environment asked, no `on`');
    }
  }
  const asked = await call('GET', 'admin', '/api/host/demos?environment=alpha', undefined, admin);
  assert.equal(asked.status, 200, asked.text);
  const alphaOn = await onIdsOf('alpha');
  assert.ok(asked.json.demos.every((d) => d.modules.every((m) => m.on === alphaOn.includes(m.id))), '`on` says what the environment has on');
  assert.ok(asked.json.demos.some((d) => d.modules.some((m) => m.on === false)), 'something is still off to offer');
  assert.equal((await call('GET', 'admin', '/api/host/demos?environment=nope', undefined, admin)).status, 404);
  assert.equal((await call('GET', 'admin', '/api/host/demos?environment=alpha&environment=beta', undefined, admin)).status, 404);

  // (c) refused asks change nothing
  const before = await onIds('alpha');
  const notNeeded = await ask('alpha', { demo: 'learning', modules: ['budget'] });
  assert.equal(notNeeded.status, 400, notNeeded.text);
  assert.equal(notNeeded.json.error, 'The demo does not use "budget", so it can\'t be turned on with it.');
  for (const bad of [{ modules: 'todo' }, { modules: [7] }, { modules: [null] }, { modules: { todo: true } }, { modules: Array.from({ length: 51 }, () => 'todo') }]) {
    const r = await ask('alpha', { demo: 'travel', ...bad });
    assert.equal(r.status, 400, JSON.stringify(bad).slice(0, 60));
    assert.equal(r.json.error, 'Name the modules to turn on as a list of their ids.');
  }
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '../todo', 'x'.repeat(300)]) {
    const r = await ask('alpha', { demo: 'travel', modules: ['todo', id] });
    assert.equal(r.status, 400, `${id.slice(0, 20)} is refused`);
    assert.ok(r.json.error.length < 120 && r.json.error.includes('does not use'), r.json.error);
  }
  await unchanged('alpha', before, 'refused asks');

  // (b) ticked: exactly those (and what they need), only what the demo names. The body carries a __proto__ key: only data.
  const beta = await onIds('beta');
  assert.deepEqual(beta, before, 'a new travel environment starts with the same set');
  const ticked = await ask('beta', JSON.parse('{"demo":"travel","__proto__":{"polluted":1},"modules":["todo","polls","todo"]}'));
  assert.equal(ticked.status, 200, ticked.text);
  assert.equal(({}).polluted, undefined, 'Object.prototype is clean');
  const after = await onIds('beta');
  const turned = ticked.json.turnedOn.map((m) => m.id).sort();
  assert.deepEqual(after.filter((id) => !beta.includes(id)), turned, 'turnedOn is exactly what came on');
  assert.ok(turned.includes('todo') && turned.includes('polls'), `both ticked came on: ${JSON.stringify(ticked.json.turnedOn)} ${JSON.stringify(ticked.json.skipped)} was ${beta} now ${after}`);
  const mods = (await call('GET', 'beta', '/api/modules', undefined, await ownerOf('beta'))).json.modules;
  for (const id of turned) if (id !== 'todo' && id !== 'polls') assert.ok(['todo', 'polls'].some((t) => (mods.find((m) => m.id === t).requires || []).includes(id)), `${id} came on only because a ticked module needs it`);
  assert.ok(ticked.json.turnedOn.every((m) => typeof m.name === 'string' && m.name));
  assert.ok(ticked.json.created.todo > 0 && ticked.json.created.polls > 0, 'the ticked modules were filled');
  assert.ok(!('budget' in ticked.json.created) && ticked.json.skipped.some((x) => x.module === 'budget' && /is off in this environment/.test(x.why)), 'an unticked one stays off and is said so');
  for (const id of ['budget', 'maps']) assert.ok(!after.includes(id), `${id} was not ticked, so it is not on`);

  // none ticked: none on (an empty list, and no list at all)
  const gamma = await onIds('gamma');
  const none = await ask('gamma', { demo: 'travel', modules: [] });
  assert.equal(none.status, 200, none.text);
  assert.deepEqual(none.json.turnedOn, []);
  assert.deepEqual(await onIds('gamma'), gamma, 'nothing was turned on');
  const delta = await onIds('delta');
  const noList = await ask('delta', { demo: 'travel' });
  assert.equal(noList.status, 200, noList.text);
  assert.deepEqual(noList.json.turnedOn, []);
  assert.deepEqual(await onIds('delta'), delta);

  // (d) a demo person who moderates a real space: refused before any change; one who moderates a demo space: fine
  const epsOwner = await ownerOf('eps');
  const epsKey = (await call('GET', 'eps', '/api/me', undefined, epsOwner)).json.user.key;
  const epsBefore = await onIds('eps');
  const mia = await call('POST', 'eps', '/api/users', { login: 'mia', displayName: 'Mia Alvarez', role: 'member', password: OWNER_PASSWORD, demo: true }, epsOwner);
  assert.ok(mia.status < 300, mia.text);
  const real = await call('POST', 'eps', '/api/spaces', { name: 'Real Trip', description: 'Mine.', members: [mia.json.user.key, epsKey], starter: false }, epsOwner);
  assert.ok(real.status < 300, real.text);
  const realId = real.json.space.id;
  assert.equal((await call('PATCH', 'eps', `/api/users/${mia.json.user.key}/spaces/${realId}`, { permissions: { moderator: true } }, epsOwner)).status, 200);
  const refusedMod = await ask('eps', { demo: 'travel', modules: ['todo', 'polls'] });
  assert.equal(refusedMod.status, 409, refusedMod.text);
  assert.equal(refusedMod.json.error, 'The demo person "mia" is a moderator of "Real Trip", a real trip, so the demo is not loaded. Take away their moderator tick there, or remove the account first.');
  await unchanged('eps', epsBefore, 'a moderator of a real space');
  assert.equal((await call('POST', 'eps', '/api/login', { login: 'mia', password: OWNER_PASSWORD })).status, 200, 'her old password still works');
  // Not a moderator of the real space any more, and a moderator of a demo space (the marker): the load goes through.
  assert.equal((await call('PATCH', 'eps', `/api/users/${mia.json.user.key}/spaces/${realId}`, { permissions: { moderator: false } }, epsOwner)).status, 200);
  const marked = await call('POST', 'eps', '/api/spaces', { name: 'An older demo', description: 'A demo with made-up people. Old.', members: [mia.json.user.key, epsKey], starter: false }, epsOwner);
  assert.ok(marked.status < 300, marked.text);
  assert.equal((await call('PATCH', 'eps', `/api/users/${mia.json.user.key}/spaces/${marked.json.space.id}`, { permissions: { moderator: true } }, epsOwner)).status, 200);
  const fine = await ask('eps', { demo: 'travel', modules: ['maps'] });
  assert.equal(fine.status, 200, fine.text);
  assert.ok(fine.json.turnedOn.some((m) => m.id === 'maps'), 'a demo space moderator may be loaded, and the ticked module came on');

  // A tick left on a space the person was taken out of still counts: refused before any change.
  const zOwner = await ownerOf('zeta');
  const zKey = (await call('GET', 'zeta', '/api/me', undefined, zOwner)).json.user.key;
  const zBefore = await onIds('zeta');
  const zmia = await call('POST', 'zeta', '/api/users', { login: 'mia', displayName: 'Mia Alvarez', role: 'member', password: OWNER_PASSWORD, demo: true }, zOwner);
  assert.ok(zmia.status < 300, zmia.text);
  const open = await call('POST', 'zeta', '/api/spaces', { name: 'Open Trip', description: 'Mine.', members: [zmia.json.user.key, zKey], starter: false }, zOwner);
  assert.ok(open.status < 300, open.text);
  const openId = open.json.space.id;
  assert.equal((await call('PATCH', 'zeta', `/api/spaces/${openId}`, { entry: 'accounts' }, zOwner)).status, 200, 'the space is open to accounts');
  assert.equal((await call('PATCH', 'zeta', `/api/users/${zmia.json.user.key}/spaces/${openId}`, { permissions: { moderator: true } }, zOwner)).status, 200);
  assert.equal((await call('DELETE', 'zeta', `/api/spaces/${openId}/members/${zmia.json.user.key}`, undefined, zOwner)).status, 200, 'she is taken out of the space');
  const left = await ask('zeta', { demo: 'travel', modules: ['todo'] });
  assert.equal(left.status, 409, left.text);
  assert.equal(left.json.error, 'The demo person "mia" was a moderator of "Open Trip", a real trip, so the demo is not loaded. Take away their moderator tick there, or remove the account first.');
  await unchanged('zeta', zBefore, 'a tick on a space she left');
  assert.equal((await call('POST', 'zeta', '/api/login', { login: 'mia', password: OWNER_PASSWORD })).status, 200, 'her password was not changed');

  // A member limit smaller than the demo needs: refused before a module comes on or an account is made.
  const tBefore = await onIds('theta');
  const tOwner = await ownerOf('theta');
  const usersBefore = (await call('GET', 'theta', '/api/users', undefined, tOwner)).json.users.map((u) => u.login).sort();
  const tiny = await ask('theta', { demo: 'travel', modules: ['todo'] });
  assert.equal(tiny.status, 409, tiny.text);
  assert.match(tiny.json.error, /^This environment is at its limit of 4 members, and the demo adds 3\.$/);
  assert.ok(!('turnedOn' in tiny.json));
  await unchanged('theta', tBefore, 'over the member limit');
  assert.deepEqual((await call('GET', 'theta', '/api/users', undefined, tOwner)).json.users.map((u) => u.login).sort(), usersBefore, 'no account was made');

  // A module the plan leaves out is not offered, and is refused when asked for; one skipped line per module.
  const offered = await call('GET', 'admin', '/api/host/demos?environment=iota', undefined, admin);
  assert.equal(offered.status, 200, offered.text);
  assert.ok(offered.json.demos.every((d) => d.modules.every((m) => m.id !== 'polls')), 'Polls is not offered where the plan has no Polls');
  assert.ok(offered.json.demos.find((d) => d.id === 'travel').modules.some((m) => m.id === 'todo'), 'what the plan has is offered');
  assert.ok(plain.json.demos.find((d) => d.id === 'travel').modules.some((m) => m.id === 'polls'), 'without an environment the whole list stays');
  const iBefore = await onIds('iota');
  const noPlan = await ask('iota', { demo: 'travel', modules: ['polls'] });
  assert.equal(noPlan.status, 400, noPlan.text);
  assert.equal(noPlan.json.error, "Polls is not in this environment's plan, so it can't be turned on.");
  await unchanged('iota', iBefore, 'a module outside the plan');
  const inPlan = await ask('iota', { demo: 'travel', modules: ['todo'] });
  assert.equal(inPlan.status, 200, inPlan.text);
  for (const id of ['polls', 'budget']) assert.ok(inPlan.json.skipped.filter((x) => x.module === id).length <= 1, `one skipped line for ${id}`);
  assert.equal(inPlan.json.skipped.filter((x) => x.module === 'polls').length, 1, 'Polls is said off once');
  assert.ok(inPlan.json.skipped.every((x) => !/^(todo|polls|budget|maps)\b/.test(x.why)), 'no raw id in a skipped line');

  // Plainer words and clean cuts.
  const chat = await ask('alpha', { demo: 'travel', modules: ['chat'] });
  assert.equal(chat.status, 400);
  assert.equal(chat.json.error, 'Chat is always on, so it is not turned on here.');
  const emoji = await ask('alpha', { demo: 'travel', modules: ['\u{1F600}'.repeat(50)] });
  assert.equal(emoji.status, 400);
  assert.equal(Array.from(emoji.json.error).filter((c) => c === '\u{1F600}').length, 40, 'cut at 40 characters');
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(emoji.json.error), 'no lone surrogate');
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(JSON.stringify(emoji.json)));
  const nullMods = await ask('alpha', { demo: 'travel', modules: null });
  assert.equal(nullMods.status, 400, 'modules: null is refused (a list or nothing); demo: null is this template\'s own demo, as check-demo-console pins');

  console.log('check-demo-offer: ok');
} catch (err) {
  failed = 1;
  console.error(`check-demo-offer: ${err.stack || err.message}`);
} finally {
  await stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
process.exit(failed);
