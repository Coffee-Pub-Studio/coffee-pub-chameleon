#!/usr/bin/env node
/*
 * check-demo-console.mjs -- POST /api/host/environments/:slug/demo (the host console's "Add demo space").
 * Boots a throwaway hosted server (BASE_DOMAIN=localhost) and asserts: anonymous, an environment's owner and a cross-site
 * request are refused; a host admin adds the demo (the report has the space, counts and one-time passwords; nothing is
 * stored in the data folder or the log); a second add is refused with the plain sentence; a space with the demo's name
 * but no marker is left alone; an unknown and a suspended environment are refused. GET /api/host/demos lists the five demos by
 * their plain names, host admin only; a body's `demo` picks one (an unknown one is a 400 with a sentence): the games demo sits
 * beside the travel demo in a travel environment, reads the games template, says in a sentence what this environment does not
 * have, and is refused a second time; a games environment gets the games demo with no body. The chat links and the guest
 * link use the environment's own address, never the loopback; an empty name and a list body are refused; a real account with a
 * demo person's login and name is never taken over. No LiveKit and no browser.
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
const HOST = { login: 'boss', password: 'check-demo-console-1' };
const OWNER_PASSWORD = 'owner-password-1234';
const demoName = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'demo', 'travel.json'), 'utf8')).name;
const port = await new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-demo-console-'));
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
  for (const slug of ['alpha', 'beta', 'gamma', 'delta', 'eps']) {
    const made = await call('POST', 'admin', '/api/host/environments', { slug, name: slug, template: slug === 'delta' ? 'games' : 'travel', owner: { login: `own${slug}`, displayName: slug, password: OWNER_PASSWORD } }, admin);
    assert.equal(made.status, 201, made.text);
  }
  const ownerOf = async (slug) => {
    const r = await call('POST', slug, '/api/login', { login: `own${slug}`, password: OWNER_PASSWORD });
    assert.equal(r.status, 200, r.text);
    return { cookie: r.cookie };
  };
  const url = (slug) => `/api/host/environments/${slug}/demo`;

  assert.equal((await call('POST', 'admin', url('alpha'))).status, 401, 'anonymous is refused');
  assert.equal((await call('POST', 'admin', url('alpha'), undefined, await ownerOf('alpha'))).status, 401, 'an owner is refused');
  const cross = await call('POST', 'admin', url('alpha'), undefined, { ...admin, 'sec-fetch-site': 'cross-site' });
  assert.equal(cross.status, 403, 'a cross-site request is refused');
  assert.equal((await call('POST', 'admin', url('nope'), undefined, admin)).status, 404, 'unknown environment');

  // A real account named like the host admin does not stop the demo (the run has its own stand-in, host-demo).
  const real = await call('POST', 'alpha', '/api/users', { login: HOST.login, displayName: 'Real boss', role: 'member', password: OWNER_PASSWORD }, await ownerOf('alpha'));
  assert.ok(real.status < 300, real.text);
  // An ordinary account called host-demo (it has a password) is never reused.
  const fake = await call('POST', 'gamma', '/api/users', { login: 'host-demo', displayName: 'Not the stand-in', role: 'member', password: OWNER_PASSWORD }, await ownerOf('gamma'));
  assert.ok(fake.status < 300, fake.text);
  const refusedFake = await call('POST', 'admin', url('gamma'), undefined, admin);
  assert.equal(refusedFake.status, 409);
  assert.match(refusedFake.json.error, /"host-demo" already has an account/);

  const added = await call('POST', 'admin', url('alpha'), undefined, admin);
  assert.equal(added.status, 200, added.text);
  assert.equal(added.json.demo, true);
  assert.equal(added.json.fellBack, false);
  assert.ok(added.json.space && added.json.space.id, 'the report names the space');
  assert.ok(added.json.people.length && added.json.people.every((p) => p.password && p.password.length >= 12), 'one-time passwords come back');
  assert.ok(Object.values(added.json.created).some((n) => n > 0), 'something was made');
  const owner = await ownerOf('alpha');
  const spaces = (await call('GET', 'alpha', '/api/spaces', undefined, owner)).json.spaces;
  assert.ok(spaces.some((s) => s.name === demoName), 'the demo space is there');

  const again = await call('POST', 'admin', url('alpha'), undefined, admin);
  assert.equal(again.status, 409);
  assert.equal(again.json.error, 'The Travel demo is already there. Delete its trip, then add it again.');
  // The links the demo wrote use the environment's own address, never the loopback the loader's requests went to.
  const travelChat = (await call('GET', 'alpha', `/api/spaces/${added.json.space.id}/chat`, undefined, owner)).json.messages;
  assert.ok(travelChat.some((m) => m.text.includes(`http://alpha.localhost:${port}/modules/travel?space=${added.json.space.id}`)), 'a chat link on the environment\'s own address');
  assert.ok(!travelChat.some((m) => /127\.0\.0\.1/.test(m.text)), 'no loopback address in the chat');
  assert.ok(added.json.guestUrl.startsWith(`http://alpha.localhost:${port}/guest/`), 'the guest link is on the environment\'s own address');
  // The body: an empty name, a list, and null (this template's own demo, here already there).
  const empty = await call('POST', 'admin', url('alpha'), { demo: '' }, admin);
  assert.equal(empty.status, 400);
  assert.equal(empty.json.error, 'Name a demo.');
  const list = await call('POST', 'admin', url('alpha'), ['games'], admin);
  assert.equal(list.status, 400, 'a list is not a body');
  assert.match(list.json.error, /^Send the demo to add as/);
  const none = await call('POST', 'admin', url('alpha'), { demo: null }, admin);
  assert.equal(none.status, 409, 'null is this template\'s own demo');
  assert.equal(none.json.error, 'The Travel demo is already there. Delete its trip, then add it again.');

  // The list of demos, and choosing one.
  assert.equal((await call('GET', 'admin', '/api/host/demos')).status, 401, 'anonymous may not list the demos');
  const listed = await call('GET', 'admin', '/api/host/demos', undefined, admin);
  assert.equal(listed.status, 200, listed.text);
  assert.deepEqual(listed.json.demos.map((d) => d.label), ['Games demo', 'Learning demo', 'Mentoring demo', 'Project demo', 'Travel demo']);
  assert.ok(listed.json.demos.every((d) => d.id && d.name), 'each has its id and its space name');
  const nope = await call('POST', 'admin', url('alpha'), { demo: 'nope' }, admin);
  assert.equal(nope.status, 400);
  assert.equal(nope.json.error, 'There is no demo called nope.');
  const odd = await call('POST', 'admin', url('alpha'), { demo: 7 }, admin);
  assert.equal(odd.status, 400);
  assert.equal(odd.json.error, 'There is no demo called that.');
  const games = await call('POST', 'admin', url('alpha'), { demo: 'games' }, admin);
  assert.equal(games.status, 200, games.text);
  assert.equal(games.json.usedTemplate, 'games');
  assert.equal(games.json.fellBack, false);
  assert.equal(games.json.space.name, 'Demo: The Salt Crown');
  assert.equal(games.json.space.template, 'games', 'the games demo reads the games template in a travel environment');
  // This travel environment's template offer was never applied, so it has no modules on: each is skipped in a sentence.
  assert.deepEqual(games.json.created, { chat: 17 }, 'only the chat, which needs no module');
  assert.ok(games.json.skipped.some((x) => x.module === 'schedule' && x.why === 'Planner - Projects is off in this environment, so the 26 demo campaign entries were not made.'), JSON.stringify(games.json.skipped));
  const alphaMods = (await call('GET', 'alpha', '/api/modules', undefined, owner)).json.modules;
  assert.ok(!alphaMods.some((m) => m.id === 'schedule' && m.enabled), 'Planner - Projects was not turned on');
  const gamesAgain = await call('POST', 'admin', url('alpha'), { demo: 'games' }, admin);
  assert.equal(gamesAgain.status, 409, 'the games demo is there once');
  assert.equal(gamesAgain.json.error, 'The Games demo is already there. Delete its trip, then add it again.');
  const both = (await call('GET', 'alpha', '/api/spaces', undefined, owner)).json.spaces;
  assert.equal(both.filter((x) => x.name === demoName).length, 1, 'the travel demo is still there, once');
  assert.equal(both.filter((x) => x.name === 'Demo: The Salt Crown').length, 1, 'beside one games demo');
  // A games environment whose owner turned on the modules it has gets its own demo with no body, its planner filled.
  const deltaOwner = await ownerOf('delta');
  const deltaMods = (await call('GET', 'delta', '/api/modules', undefined, deltaOwner)).json.modules.map((m) => m.id);
  assert.ok(deltaMods.includes('schedule'), 'a games environment has Planner - Projects');
  for (const id of deltaMods) assert.equal((await call('PATCH', 'delta', `/api/modules/${id}`, { enabled: true }, deltaOwner)).status, 200, `${id} turns on`);
  const own = await call('POST', 'admin', url('delta'), undefined, admin);
  assert.equal(own.status, 200, own.text);
  assert.equal(own.json.usedTemplate, 'games');
  assert.equal(own.json.fellBack, false);
  assert.equal(own.json.created.schedule, 26, 'the Campaign is filled');
  assert.equal(own.json.created.chat, 17);
  for (const id of ['research', 'documents', 'todo', 'calendar', 'budget', 'polls']) assert.ok(own.json.created[id] > 0 || own.json.skipped.some((x) => x.module === id && / is off in this environment, so the \d+ demo /.test(x.why)), `${id} is made or skipped in a sentence`);
  assert.equal(own.json.space.template, undefined, 'a games environment\'s demo needs no template of its own');

  const plain = await call('POST', 'beta', '/api/spaces', { name: demoName, description: 'Mine.' }, await ownerOf('beta'));
  assert.ok(plain.status < 300, plain.text);
  const kept = await call('POST', 'admin', url('beta'), undefined, admin);
  assert.equal(kept.status, 409, 'a space with the name and no marker is refused');
  assert.match(kept.json.error, /not the demo/);
  const after = (await call('GET', 'beta', '/api/spaces', undefined, await ownerOf('beta'))).json.spaces;
  assert.equal(after.filter((s) => s.name === demoName).length, 1, 'it is left alone');

  assert.equal((await call('PATCH', 'admin', '/api/host/environments/beta', { status: 'suspended' }, admin)).status, 200);
  const sus = await call('POST', 'admin', url('beta'), undefined, admin);
  assert.equal(sus.status, 409);
  assert.match(sus.json.error, /suspended/);

  // A real account with a demo person's login and name (here an owner) is never taken over.
  const epsOwner = await ownerOf('eps');
  assert.ok((await call('POST', 'eps', '/api/users', { login: 'noa', displayName: 'Noa Brandt', role: 'owner', password: OWNER_PASSWORD }, epsOwner)).status < 300);
  const takeover = await call('POST', 'admin', url('eps'), { demo: 'project' }, admin);
  assert.equal(takeover.status, 409, takeover.text);
  assert.equal(takeover.json.error, 'An account called "noa" already exists and was not made by a demo, so it is left alone. Rename or remove it first.');
  assert.equal((await call('POST', 'eps', '/api/login', { login: 'noa', password: OWNER_PASSWORD })).status, 200, 'her password still works');
  assert.ok(!(await call('GET', 'eps', '/api/spaces', undefined, epsOwner)).json.spaces.some((x) => x.name === 'Demo: Linden Bakery website'), 'no demo space was made');

  await stop();
  const keep = [...added.json.people, ...games.json.people, ...own.json.people].map((p) => p.password);
  const files = fs.readdirSync(dataDir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
  for (const f of files) { const text = fs.readFileSync(f, 'latin1'); for (const pw of keep) assert.ok(!text.includes(pw), `a demo password is stored in ${f}`); }
  for (const pw of keep) assert.ok(!log.includes(pw), 'a demo password is in the log');
  console.log('check-demo-console: ok');
} catch (err) {
  failed = 1;
  console.error(`check-demo-console: ${err.stack || err.message}`);
} finally {
  await stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
process.exit(failed);
