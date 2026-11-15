#!/usr/bin/env node
/*
 * check-starter.mjs -- starter spaces and starter content (documentation/plans/plan-templates-redesign.md, "Starter spaces
 * and starter content"; decisions 17 and 41; step 5 of "Left to build").
 *
 * Part 1, in node (server/starter.js and the store):
 *   - starterBlocks: only a module that opts in (as installed now); a prototype module id or key, a module id that is no
 *     id ("..", "../x"), more than 20 keys, over 64 KB for the template, a starter that is no object: each left out, said
 *     why; every value a copy; nothing else in a template entry is read.
 *   - starterSpacesOf: at most 5, names trimmed, a broken entry left out. starterSpaceCreator: the first owner, else the
 *     admin, else the host admin's stand-in, else nobody.
 *   - Store#claimStarter: true once, then false; never the Lobby or an unknown id; starterDone kept by sanitizeSpace and
 *     by an update, and never set by one.
 *
 * Part 2, the routes on a throwaway single install (PORT=0, DATA_DIR under the system tmpdir, no TEMPLATE): two test
 * modules uploaded as zips, "notes" (starter: true, guards with an owner field and a required title) and "plain" (no
 * starter), and an owner's template with notes' starter content.
 *   - A space made on it gets the starter content once, as its creator (each object's `by` and its owner field), and the
 *     answer says starterDone; another space gets its own, and the first is untouched.
 *   - Never on a change of template (PATCH a space onto the template), never with `starter: false` (the demo loader's), and
 *     `starter` must be true or false (400).
 *   - Ten spaces made at once: each gets exactly its own starter content, once (version 1 each).
 *   - Through the data route's own checks: a value the guards refuse (no title; in someone else's name) and one over the
 *     60 KB value cap are skipped, the rest written, the space still made; a key with ".." stays a key of that space's data
 *     and no file is written outside the module's data folder.
 *   - The template's checks: starter for a module that does not opt in, a bad key, a prototype key (as raw JSON), more
 *     than 20 keys, over 64 KB, a ".." module id: each 400 with its sentence.
 *   - A template that was valid but whose module no longer opts in (a hand edit of app.json) writes nothing; a module the
 *     template lists but that is off is skipped and the space still made.
 *   - A member can't make a space (403), so can't reach starter content for any space; nobody signed in gets 401.
 *
 * Part 3, hosted (BASE_DOMAIN): a host template with starter spaces; an environment made from it gets them once, made by
 * its owner (a member of each); a switch to another template and a restart make none; more than 5 is refused (400).
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
const starter = require('../server/starter.js');
const { Store, LOBBY } = require('../server/store.js');
const { zipFiles } = require('../server/module-build.js');
const templates = require('../server/templates.js');

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`check-starter: ${name}: ${err.stack || err.message}`); }
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-starter-'));

// --- part 1: in node ----------------------------------------------------------------------------------------------------

await test('starterBlocks: only modules that opt in; every hostile shape left out with why; values copied', () => {
  const raw = JSON.parse(`{
    "modules": {
      "notes": { "name": "N", "settings": { "x": 1 }, "starter": { "note:a": { "title": "A" }, "__proto__": { "title": "P" }, "note:b": { "title": "B" } } },
      "plain": { "starter": { "k": 1 } },
      "__proto__": { "starter": { "k": 1 } },
      "..": { "starter": { "k": 1 } },
      "chat": {},
      "odd": { "starter": [1, 2] }
    }
  }`);
  const optedIn = (id) => ['notes', 'odd', '..', '__proto__'].includes(id);
  const { blocks, skipped } = starter.starterBlocks(raw, { optedIn });
  assert.deepEqual(blocks.map((b) => [b.module, b.entries.map(([k]) => k)]), [['notes', ['note:a', 'note:b']]]);
  const why = Object.fromEntries(skipped.map((s) => [`${s.module}${s.key ? `|${s.key}` : ''}`, s.why]));
  assert.equal(why['notes|__proto__'], 'is not a key anything may hold');
  assert.equal(why.plain, 'takes no starter content');
  assert.equal(why.__proto__, 'is not an id');
  assert.equal(why['..'], 'is not an id');
  assert.equal(why.odd, 'its starter content is not data by key');
  assert.equal(Object.getPrototypeOf(blocks[0].entries[0][1]), Object.prototype);
  blocks[0].entries[0][1].title = 'changed';
  assert.equal(raw.modules.notes.starter['note:a'].title, 'A', 'a copy, not the template\'s own value');
  // '*' (the Default template) and no template give nothing.
  assert.deepEqual(starter.starterBlocks({ modules: '*' }, { optedIn: () => true }), { blocks: [], skipped: [] });
  assert.deepEqual(starter.starterBlocks(null), { blocks: [], skipped: [] });
});

await test('starterBlocks: at most 20 keys a module, 64 KB a template', () => {
  const many = Object.fromEntries(Array.from({ length: templates.MAX_STARTER_KEYS + 1 }, (_, i) => [`k${i}`, i]));
  const big = { a: 'x'.repeat(40 * 1024) };
  const big2 = { b: 'y'.repeat(40 * 1024) };
  const { blocks, skipped } = starter.starterBlocks({ modules: { m1: { starter: many }, m2: { starter: big }, m3: { starter: big2 } } }, { optedIn: () => true });
  assert.deepEqual(blocks.map((b) => b.module), ['m2']);
  assert.deepEqual(skipped.map((s) => [s.module, s.why]), [['m1', `its starter content has more than ${templates.MAX_STARTER_KEYS} keys`], ['m3', "the template's starter content is over 64 KB"]]);
});

await test('starterSpacesOf and starterSpaceCreator', () => {
  const list = Array.from({ length: 7 }, (_, i) => ({ name: ` S${i} `, description: i === 0 ? undefined : 'd' }));
  list.splice(1, 0, { name: '' }, 'odd');
  const got = starter.starterSpacesOf({ starterSpaces: list });
  assert.equal(got.length, 3, 'at most 5 looked at, the broken ones left out');
  assert.deepEqual(got[0], { name: 'S0', description: '' });
  assert.deepEqual(starter.starterSpacesOf({}), []);
  const u = (key, role, hostAdmin = false) => ({ key, role, hostAdmin });
  assert.equal(starter.starterSpaceCreator([u('a', 'member'), u('h', 'admin', true), u('s', 'admin'), u('o', 'owner')]).key, 'o');
  assert.equal(starter.starterSpaceCreator([u('h', 'admin', true), u('s', 'admin')]).key, 's');
  assert.equal(starter.starterSpaceCreator([u('h', 'admin', true)]).key, 'h');
  assert.equal(starter.starterSpaceCreator([u('a', 'member'), u('g', 'guest')]), null);
});

await test('Store#claimStarter: once; never the Lobby or an unknown id; kept, never set by an update', () => {
  const store = new Store(fs.mkdtempSync(path.join(tmp, 'store-')));
  const sp = store.addSpace({ name: 'One' });
  assert.equal(sp.starterDone, undefined);
  assert.equal(store.claimStarter(sp.id), true);
  assert.equal(store.claimStarter(sp.id), false);
  assert.equal(store.claimStarter(LOBBY), false);
  assert.equal(store.claimStarter('nosuch1'), false);
  assert.equal(store.spaceById(sp.id).starterDone, true);
  store.updateSpace(sp.id, { name: 'Renamed', starterDone: false });
  assert.equal(store.spaceById(sp.id).starterDone, true, 'an update keeps it');
  const other = store.addSpace({ name: 'Two' });
  store.updateSpace(other.id, { starterDone: true });
  assert.equal(store.spaceById(other.id).starterDone, undefined, 'an update never sets it');
  assert.equal(new Store(store.dir).spaceById(sp.id).starterDone, true, 'read back from app.json');
  assert.equal(store.sanitizeSpace({ id: LOBBY, name: 'Lobby', starterDone: true }).starterDone, undefined);
});

// --- part 2: the routes -------------------------------------------------------------------------------------------------

function startServer(dataDir, env = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, TZ: 'UTC', PRODUCT_NAME: 'Testname', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 20000);
    const onData = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve({ port: Number(m[1]), output: () => out, stop: () => new Promise((r) => { if (child.exitCode !== null) return r(); child.once('exit', r); child.kill('SIGTERM'); }) }); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
}
// `host`: an environment's slug on a hosted server, or null for a single install.
function call(server, host, method, urlPath, { body, cookie, zip } = {}) {
  const payload = zip || (body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
  const name = host ? `${host}.localhost:${server.port}` : `127.0.0.1:${server.port}`;
  const headers = { host: name, accept: 'application/json', origin: `http://${name}` };
  if (payload) { headers['content-type'] = zip ? 'application/zip' : 'application/json'; headers['content-length'] = payload.length; }
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
const cookieOf = (res) => [].concat(res.headers?.['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
const page = Buffer.from('<!doctype html><html><head><meta charset="utf-8"></head><body><script src="/sdk/host.js"></script></body></html>');
const zipOf = (manifest) => zipFiles([['module.json', Buffer.from(JSON.stringify(manifest))], ['page.html', page], ['canvas.html', page]]);
const PERMISSIONS = [
  { key: 'view', label: 'See them', default: { member: true, guest: true, moderator: true } },
  { key: 'edit', label: 'Write them', default: { member: true, guest: false, moderator: true } },
];
const moduleRaw = (id, extra = {}) => ({
  id, name: id[0].toUpperCase() + id.slice(1), version: '1.0.0', scope: ['environment', 'space'],
  surfaces: { page: { entry: 'page.html' }, canvas: { entry: 'canvas.html' } },
  permissions: PERMISSIONS, access: { read: 'view', write: 'edit' }, ...extra,
});
// notes: opts in; its guards hold every object to an owner field and a title, and only its own keys.
const NOTES = moduleRaw('notes', {
  starter: true,
  guards: { clear: 'edit', only: true, keys: [{ key: 'note:{id}', owner: 'byKey', ownerName: 'by', fields: { title: { type: 'string', required: true, maxLength: 100 } } }] },
});
const PLAIN = moduleRaw('plain');
const LATER = moduleRaw('later', { starter: true });
const BRIEF = { 'note:brief': { title: 'Project brief', text: '# Goal' }, 'note:log': { title: 'Meeting log' } };

const servers = [];
try {
  const server = await startServer(path.join(tmp, 'single'), { ADMIN_PASSWORD: 'admin-password-1' });
  servers.push(server);
  const login = async (who, password) => {
    const r = await call(server, null, 'POST', '/api/login', { body: { login: who, password } });
    assert.equal(r.status, 200, r.text);
    const cookie = cookieOf(r);
    return (method, url, body, zip) => call(server, null, method, url, { cookie, body, zip });
  };
  const admin = await login('admin', 'admin-password-1');
  for (const raw of [NOTES, PLAIN, LATER]) {
    const up = await admin('POST', '/api/modules', undefined, zipOf(raw));
    assert.equal(up.status, 201, up.text);
    if (up.json?.module?.needsApproval) await admin('POST', `/api/modules/${raw.id}/approve`, {});
    if (raw.id !== 'later') assert.equal((await admin('PATCH', `/api/modules/${raw.id}`, { enabled: true })).status, 200);
  }
  const makeUser = async (who, role = 'member') => {
    const r = await admin('POST', '/api/users', { login: who, displayName: who, role, password: `${who}-password-1` });
    assert.equal(r.status, 201, r.text);
    return { key: r.json.user.key, as: await login(who, `${who}-password-1`) };
  };
  const owner = await makeUser('olive', 'owner');
  const mia = await makeUser('mia');
  assert.equal((await owner.as('POST', '/api/environment/templates', { from: 'default', id: 'proj', name: 'Proj' })).status, 201);
  const setModules = (id, modules) => owner.as('PATCH', `/api/environment/templates/${id}`, { modules: { ...modules, chat: {}, conference: {} } });
  const edit = await setModules('proj', { notes: { name: 'Notes', starter: BRIEF }, plain: {} });
  assert.equal(edit.status, 200, edit.text);
  const dataOf = async (who, id, sp) => {
    const r = await who('GET', `/api/modules/${id}/data?scope=space&space=${sp}`);
    assert.equal(r.status, 200, r.text);
    return r.json.items;
  };
  const dataDir = path.join(tmp, 'single', 'modules', 'notes', 'data');

  await test('a space made on the template gets its starter content once, as the person who made it', async () => {
    const r = await owner.as('POST', '/api/spaces', { name: 'Alpha', template: 'proj', members: [mia.key] });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.space.starterDone, true);
    const items = await dataOf(owner.as, 'notes', r.json.space.id);
    assert.deepEqual(items.map((i) => i.key), ['note:brief', 'note:log']);
    for (const i of items) {
      assert.equal(i.by, owner.key, 'written as the creator');
      assert.equal(i.value.byKey, owner.key, 'the guards set the owner field to the creator');
      assert.equal(i.value.by, 'olive');
      assert.equal(i.version, 1);
    }
    assert.equal(items[0].value.text, '# Goal');
    assert.deepEqual(await dataOf(mia.as, 'plain', r.json.space.id), [], 'a module without starter content gets nothing');
    // Another space gets its own; the first is untouched.
    const b = (await owner.as('POST', '/api/spaces', { name: 'Beta', template: 'proj' })).json.space;
    assert.equal((await dataOf(owner.as, 'notes', b.id)).length, 2);
    assert.deepEqual((await dataOf(owner.as, 'notes', r.json.space.id)).map((i) => i.version), [1, 1]);
    // Read by a member of the space through the data route, as anything is.
    assert.equal((await dataOf(mia.as, 'notes', r.json.space.id)).length, 2);
  });

  await test('never on a change of template; never with starter: false; starter must be true or false', async () => {
    const plain = (await owner.as('POST', '/api/spaces', { name: 'Gamma' })).json.space;
    assert.equal(plain.starterDone, true, 'claimed when made, though its template (Default) gives none');
    assert.deepEqual(await dataOf(owner.as, 'notes', plain.id), []);
    const sw = await owner.as('PATCH', `/api/spaces/${plain.id}`, { template: 'proj' });
    assert.equal(sw.status, 200, sw.text);
    assert.deepEqual(await dataOf(owner.as, 'notes', plain.id), [], 'a switch onto the template writes nothing');
    const skip = await owner.as('POST', '/api/spaces', { name: 'Demo-like', template: 'proj', starter: false });
    assert.equal(skip.status, 200, skip.text);
    assert.equal(skip.json.space.starterDone, true);
    assert.deepEqual(await dataOf(owner.as, 'notes', skip.json.space.id), []);
    for (const bad of ['no', 0, null, {}]) {
      const r = await owner.as('POST', '/api/spaces', { name: 'Bad', starter: bad });
      assert.deepEqual([r.status, r.json?.error], [400, 'starter must be true or false.'], JSON.stringify(bad));
    }
    // The demo loader asks for none (read from its source: the loader runs against a template's demo file).
    assert.match(fs.readFileSync(path.join(ROOT, 'server', 'demo-loader.js'), 'utf8'), /'POST', '\/api\/spaces', \{ name: file\.name, .*, members, starter: false \}\)\)\.space;/);
  });

  await test('ten spaces made at once: each gets its own starter content exactly once', async () => {
    const made = await Promise.all(Array.from({ length: 10 }, (_, i) => owner.as('POST', '/api/spaces', { name: `Race ${i}`, template: 'proj' })));
    const ids = made.map((r) => { assert.equal(r.status, 200, r.text); return r.json.space.id; });
    assert.equal(new Set(ids).size, 10);
    for (const id of ids) {
      const items = await dataOf(owner.as, 'notes', id);
      assert.deepEqual(items.map((i) => [i.key, i.version]), [['note:brief', 1], ['note:log', 1]]);
    }
  });

  await test("through the data route's checks: refused values skipped, the rest written, the space still made; keys stay keys", async () => {
    const hostile = {
      'note:ok': { title: 'Fine' },
      'note:untitled': { text: 'no title' },
      'note:theirs': { title: 'In her name', byKey: mia.key },
      'note:big': { title: 'Big', text: 'x'.repeat(61 * 1024) },
      'note:..': { title: 'Dots' },
      '../../escape': { title: 'Out' },
      'other:1': { title: 'Not a notes key' },
    };
    const e = await setModules('proj', { notes: { starter: hostile }, plain: {} });
    assert.equal(e.status, 200, e.text);
    const before = fs.readdirSync(path.join(tmp, 'single'));
    const r = await owner.as('POST', '/api/spaces', { name: 'Hostile', template: 'proj' });
    assert.equal(r.status, 200, r.text);
    const items = await dataOf(owner.as, 'notes', r.json.space.id);
    assert.deepEqual(items.map((i) => i.key).sort(), ['note:..', 'note:ok']);
    assert.ok(items.every((i) => i.value.byKey === owner.key && i.by === owner.key));
    assert.deepEqual(fs.readdirSync(path.join(tmp, 'single')).sort(), before.sort(), 'nothing new beside the data');
    assert.ok(fs.readdirSync(dataDir).every((f) => /^space-[a-z0-9]+\.json$/.test(f)), fs.readdirSync(dataDir).join(','));
    assert.match(server.output(), /Starter content for "Hostile": wrote 2, skipped /);
  });

  await test("the template's checks: each refusal with its sentence", async () => {
    const refusedWith = async (modules, sentence) => {
      const r = await setModules('proj', modules);
      assert.deepEqual([r.status, r.json?.error], [400, sentence], JSON.stringify(modules).slice(0, 200));
    };
    await refusedWith({ notes: {}, plain: { starter: { k: 1 } } }, 'modules.plain: the plain module takes no starter content.');
    await refusedWith({ notes: { starter: { 'a b': 1 } } }, 'modules.notes.starter: "a b" is not a data key; a key is 1 to 128 letters, digits and . _ : / -.');
    await refusedWith({ notes: { starter: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`note:n${i}`, { title: 'x' }])) } }, 'modules.notes.starter can hold at most 20 keys.');
    await refusedWith({ notes: { starter: { 'note:a': { title: 'a', text: 'x'.repeat(40 * 1024) }, 'note:b': { title: 'b', text: 'y'.repeat(30 * 1024) } } } }, "A template's starter content can be at most 64 KB.");
    await refusedWith({ notes: {}, '..': { starter: { k: 1 } } }, 'modules: ".." is not a module this server has.');
    const proto = await owner.as('PATCH', '/api/environment/templates/proj', '{"modules":{"notes":{"starter":{"__proto__":{"title":"x"}}},"chat":{}}}');
    assert.deepEqual([proto.status, proto.json?.error], [400, 'A template can\'t hold a key called "__proto__".']);
    const protoModule = await owner.as('PATCH', '/api/environment/templates/proj', '{"modules":{"__proto__":{"starter":{"k":1}},"chat":{}}}');
    assert.deepEqual([protoModule.status, protoModule.json?.error], [400, 'A template can\'t hold a key called "__proto__".']);
  });

  await test('a module that no longer opts in, or is off, gets nothing; the space is still made', async () => {
    assert.equal((await setModules('proj', { notes: { starter: BRIEF }, later: { starter: { 'x:1': { title: 'later' } } } })).status, 200);
    const r = await owner.as('POST', '/api/spaces', { name: 'Off', template: 'proj' });
    assert.equal(r.status, 200, r.text);
    assert.equal((await dataOf(owner.as, 'notes', r.json.space.id)).length, 2);
    assert.equal((await admin('PATCH', '/api/modules/later', { enabled: true })).status, 200);
    assert.deepEqual(await dataOf(owner.as, 'later', r.json.space.id), [], 'off when the space was made: nothing, and nothing later');
    assert.equal((await admin('PATCH', '/api/modules/later', { enabled: false })).status, 200);
    assert.match(server.output(), /Starter content for "Off": wrote 2, skipped later \(is not on\)/);
  });

  await test('a member or guest cannot make a space, so cannot reach starter content for any space', async () => {
    const r = await mia.as('POST', '/api/spaces', { name: 'Mine', template: 'proj' });
    assert.equal(r.status, 403, r.text);
    const nobody = await call(server, null, 'POST', '/api/spaces', { body: { name: 'Nobody', template: 'proj' } });
    assert.equal(nobody.status, 401, nobody.text);
  });
  await server.stop();

  await test('a hand-edited template whose module no longer opts in writes nothing', async () => {
    // The stored template names starter content for "plain", which never opted in: the template is not read at all.
    const file = path.join(tmp, 'single', 'app.json');
    const app = JSON.parse(fs.readFileSync(file, 'utf8'));
    const own = app.templates.find((t) => t.id === 'proj');
    own.modules.plain = { starter: { 'k:1': { title: 'sneaked' } } };
    fs.writeFileSync(file, JSON.stringify(app));
    const again = await startServer(path.join(tmp, 'single'), { ADMIN_PASSWORD: 'admin-password-1' });
    servers.push(again);
    const c = cookieOf(await call(again, null, 'POST', '/api/login', { body: { login: 'olive', password: 'olive-password-1' } }));
    const as = (method, url, body) => call(again, null, method, url, { cookie: c, body });
    const before = (await as('GET', '/api/spaces')).json.spaces.length;
    const r = await as('POST', '/api/spaces', { name: 'Edited' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual((await as('GET', `/api/modules/plain/data?scope=space&space=${r.json.space.id}`)).json.items, []);
    assert.deepEqual((await as('GET', `/api/modules/notes/data?scope=space&space=${r.json.space.id}`)).json.items, []);
    assert.equal((await as('GET', '/api/spaces')).json.spaces.length, before + 1, 'a restart makes no spaces');
    await again.stop();
  });

  // --- part 3: hosted ------------------------------------------------------------------------------------------------------
  const hs = await startServer(path.join(tmp, 'hosted'), { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'boss', ADMIN_PASSWORD: 'host-password-1' });
  servers.push(hs);
  const hostCookie = cookieOf(await call(hs, 'admin', 'POST', '/api/host/login', { body: { login: 'boss', password: 'host-password-1' } }));
  const console_ = (method, url, body) => call(hs, 'admin', method, url, { cookie: hostCookie, body });
  const STARTERS = [{ name: 'Your first project', description: 'A place to try things.' }, { name: 'Second' }];

  await test('hosted: starter spaces are made once, by the owner, when an environment is made; never on a switch or a restart', async () => {
    const six = await console_('POST', '/api/host/templates', { id: 'six', name: 'Six', description: 'Too many.', modules: { chat: {} }, starterSpaces: Array.from({ length: 6 }, (_, i) => ({ name: `S${i}` })) });
    assert.deepEqual([six.status, six.json?.error], [400, '"starterSpaces" must be a list of at most 5 spaces.']);
    const t = await console_('POST', '/api/host/templates', { id: 'starts', name: 'Starts', description: 'With spaces.', modules: { chat: {} }, starterSpaces: STARTERS });
    assert.equal(t.status, 201, t.text);
    const made = await console_('POST', '/api/host/environments', { slug: 'acme', name: 'Acme', template: 'starts', owner: { login: 'owner-acme', password: 'owner-acme-password-1' } });
    assert.equal(made.status, 201, made.text);
    const c = cookieOf(await call(hs, 'acme', 'POST', '/api/login', { body: { login: 'owner-acme', password: 'owner-acme-password-1' } }));
    const as = (method, url, body) => call(hs, 'acme', method, url, { cookie: c, body });
    const named = async () => (await as('GET', '/api/spaces')).json.spaces.filter((s) => s.id !== LOBBY);
    let spaces = [];
    for (let i = 0; i < 100 && spaces.length < 2; i += 1) { spaces = await named(); if (spaces.length < 2) await new Promise((r) => setTimeout(r, 100)); }
    assert.deepEqual(spaces.map((s) => s.name), ['Your first project', 'Second']);
    const me = (await as('GET', '/api/me')).json;
    const key = me.user?.key || me.key;
    for (const s of spaces) {
      const full = (await as('GET', `/api/spaces/${s.id}`)).json.space;
      assert.equal(full.starterDone, true);
      assert.ok(full.members.includes(key), 'made by the owner, who is a member');
      assert.equal(full.template, null, "it reads the environment's template");
    }
    assert.equal((await as('GET', `/api/spaces/${spaces[0].id}`)).json.space.description, 'A place to try things.');
    // A switch to another template, and back, makes none.
    assert.equal((await console_('PATCH', '/api/host/environments/acme', { template: 'default' })).status, 200);
    assert.equal((await console_('PATCH', '/api/host/environments/acme', { template: 'starts' })).status, 200);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await named()).length, 2, 'no starter spaces on a switch');
  });
  await hs.stop();

  await test('hosted: a restart makes no starter spaces', async () => {
    const again = await startServer(path.join(tmp, 'hosted'), { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'boss', ADMIN_PASSWORD: 'host-password-1' });
    servers.push(again);
    const c = cookieOf(await call(again, 'acme', 'POST', '/api/login', { body: { login: 'owner-acme', password: 'owner-acme-password-1' } }));
    const list = async () => (await call(again, 'acme', 'GET', '/api/spaces', { cookie: c })).json.spaces.filter((s) => s.id !== LOBBY);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await list()).length, 2);
    await again.stop();
  });
} finally {
  for (const s of servers) await s.stop().catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failed ? `check-starter: ${failed} failed` : `check-starter: ${n} checks passed`);
process.exit(failed ? 1 : 0);
