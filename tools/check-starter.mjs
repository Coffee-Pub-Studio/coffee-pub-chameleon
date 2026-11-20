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
 *   - A switch of the environment's template to one with starter spaces makes none and offers them, unticked
 *     (offer.starterSpaces, offer.version, offer.offerId; every confirm sends offerId and version back); confirming one ticked makes exactly that space, once, with its starter content
 *     written as the owner who confirmed; a repeat is 409 and makes none; a member is refused (403).
 *
 * Also: a starter space name over the store's limit (40) is refused; a restore whose template record says it was never
 * applied makes no starter spaces; every addSpace caller is POST /api/spaces, POST /api/agent/spaces (the set-up agent's,
 * which fills the starter content too) or makeStarterSpaces (a source scan).
 *
 * Part 3, hosted (BASE_DOMAIN): a host template with starter spaces; an environment made from it gets them once, made by
 * its owner (a member of each), each recorded as using that template, so a switch of the environment's template leaves
 * them on it (a space made later, naming none, follows the environment); a switch to another template and a restart make
 * none; more than 5 is refused (400). An environment made from the shipped Learning template: a new space's starter
 * document (the real Documents module and record) carries the creator as by, editedBy and editedByName and the time it
 * was made as at and editedAt (starter.asCreator, also checked in node on Games' records), the rest as the template has it.
 * The switch offer, hosted: all five offered and none made by the switch; a member and a member who moderates a space
 * refused (403) on the confirm and the switch; each bad confirm refused with its sentence (not a list of numbers, a
 * repeat, more than 5, a number not in the offer, no offerId or version, either malformed, a changed one; an array or a
 * string body, on both routes) and nothing made, the offer still open; a stale confirm after the host switched to another
 * template at the same version: 409, nothing made; the first offer replayed after a switch away and back: 409; the
 * template edited after the offer: 409, the new one offered; ticking two makes exactly those (the 40-character name
 * whole), each on its template, made by the owner; a repeat 409; none ticked makes none; two confirms at once make one;
 * two confirms at once naming different modules turn on only the winner's; the host's confirm makes it by the first
 * owner; the host's stand-in confirming on the environment's route makes it as itself, without joining; another
 * environment untouched; deleting the owner's own template in use while its offer is confirmed: the two take turns
 * (a refused confirm turned nothing on) and the environment ends on the Default template; a confirm without offerId and
 * version (the body the pages sent before) is refused.
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
const { Store, LOBBY, SPACE_NAME_MAX } = require('../server/store.js');
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

await test('asCreator: an authored record (any of by, editedBy, editedByName) has its author and time fields made the creator\'s and now; nothing else', () => {
  const real = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'games.json'), 'utf8')).modules.documents.starter;
  const olive = { key: 'k-olive', displayName: 'Olive', login: 'olive' };
  const now = '2026-11-15T10:00:00.000Z';
  const doc = starter.asCreator(real['doc:sessionnotes'], olive, now);
  assert.deepEqual([doc.by, doc.at, doc.editedBy, doc.editedByName, doc.editedAt], ['k-olive', now, 'k-olive', 'Olive', now]);
  assert.deepEqual({ ...doc, by: 0, at: 0, editedBy: 0, editedByName: 0, editedAt: 0 }, { ...real['doc:sessionnotes'], by: 0, at: 0, editedBy: 0, editedByName: 0, editedAt: 0 });
  assert.equal(real['doc:sessionnotes'].by, 'template', 'a copy: the template\'s own record is unchanged');
  assert.equal(starter.asCreator(real['text:sessionnotes:notesch1'], olive, now), real['text:sessionnotes:notesch1'], 'no `by`: as it is');
  assert.deepEqual(starter.asCreator({ at: '2027-05-01', title: 'A day' }, olive, now), { at: '2027-05-01', title: 'A day' }, 'a time in a record with no author is its own (a day), never now');
  assert.deepEqual(starter.asCreator({ kind: 'work', title: 'Plan', by: '' }, olive, now), { kind: 'work', title: 'Plan', by: 'k-olive' }, 'a Schedule entry: `by` only, nothing added');
  assert.deepEqual(starter.asCreator({ by: 'x', editedByName: 'T' }, { key: 'k', login: 'kim' }, now), { by: 'k', editedByName: 'kim' }, 'no display name: the login');
  for (const v of [null, 'text', 5, ['by'], { by: 'x' }]) assert.deepEqual(starter.asCreator(v, null, now), v, 'nobody: unchanged');
  // Any author field makes a record authored: no `by`, but a forged editor, is the creator's too (nothing added).
  assert.deepEqual(starter.asCreator({ title: 'T', editedBy: 'k-mia', editedByName: 'Mia', editedAt: '2026-01-01T00:00:00.000Z' }, olive, now), { title: 'T', editedBy: 'k-olive', editedByName: 'Olive', editedAt: now });
  assert.deepEqual(starter.asCreator({ title: 'T', editedByName: 'Mia' }, olive, now), { title: 'T', editedByName: 'Olive' });
  // A `by` that is not text is replaced all the same.
  for (const by of [null, 5, { key: 'k-mia' }, ['k-mia'], true]) assert.deepEqual(starter.asCreator({ by, title: 'T' }, olive, now), { by: 'k-olive', title: 'T' }, JSON.stringify(by));
  // Prototype keys (as raw JSON makes them) stay the record's own data keys; nothing is polluted.
  const raw = JSON.parse('{"by":"k-mia","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"title":"T"}');
  const out = starter.asCreator(raw, olive, now);
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.deepEqual(Object.keys(out), ['by', '__proto__', 'constructor', 'title']);
  assert.deepEqual([out.by, Object.getOwnPropertyDescriptor(out, '__proto__').value, out.constructor], ['k-olive', { polluted: true }, { prototype: { polluted: true } }]);
  assert.equal(JSON.stringify(out), '{"by":"k-olive","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"title":"T"}');
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

await test('starterSpacesOf and starterSpaceCreator', () => {
  const list = Array.from({ length: 7 }, (_, i) => ({ name: ` S${i} `, description: i === 0 ? undefined : 'd' }));
  list.splice(1, 0, { name: '' }, 'odd');
  const got = starter.starterSpacesOf({ starterSpaces: list });
  assert.equal(got.length, 3, 'at most 5 looked at, the broken ones left out');
  assert.deepEqual(got[0], { name: 'S0', description: '' });
  assert.deepEqual(starter.starterSpacesOf({}), []);
  // A name over the store's limit (a stored template edited by hand) is left out, never cut; one at the limit is kept.
  const edge = starter.starterSpacesOf({ starterSpaces: [{ name: 'x'.repeat(SPACE_NAME_MAX + 1) }, { name: 'y'.repeat(SPACE_NAME_MAX) }] });
  assert.deepEqual(edge.map((sp) => sp.name.length), [SPACE_NAME_MAX]);
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

// Every place that makes a space: POST /api/spaces (which gives it its starter content) and makeStarterSpaces (a template's
// starter spaces). Anything else would be a space made outside the starter rules, so a new caller must be added here on purpose.
await test('source scan: every addSpace caller is POST /api/spaces, POST /api/agent/spaces or makeStarterSpaces', async () => {
  const dir = path.join(ROOT, 'server');
  const found = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/\.addSpace\(/.test(line) || /^\s*\/\//.test(line)) return;
      let j = i;
      while (j > 0 && !/^(app\.\w+\(|async function |function )/.test(lines[j])) j -= 1;
      found.push(`${file}: ${lines[j].slice(0, 60)}`);
    });
  }
  // The third: the set-up agent's own route (plan-admin-agent.md), which fills the starter content as POST /api/spaces does.
  assert.equal(found.length, 3, `three callers: ${found.join(' | ')}`);
  assert.ok(found.some((f) => /^index\.js: app\.post\('\/api\/spaces',/.test(f)), found.join(' | '));
  assert.ok(found.some((f) => /^index\.js: app\.post\('\/api\/agent\/spaces',/.test(f)), found.join(' | '));
  const src = fs.readFileSync(path.join(dir, 'index.js'), 'utf8');
  const route = src.slice(src.indexOf("app.post('/api/agent/spaces',"), src.indexOf("app.patch('/api/agent/spaces/:id',"));
  assert.match(route, /fillStarter\(made, agent, \{ templateRights: true \}\)/, 'the set-up agent\'s route fills the starter content');
  assert.ok(found.some((f) => /^index\.js: function makeStarterSpaces\(/.test(f)), found.join(' | '));
});

test('log safety: a newline or control character in a module id or key never reaches a log line', () => {
  assert.equal(starter.shown('a\nWARN forged\r\u2028x\u0000'), 'a WARN forged  x ');
  const { skipped } = starter.starterBlocks({ modules: { 'bad\nforged line': { starter: { k: 1 } } } }, { optedIn: () => true });
  assert.deepEqual(skipped, [{ module: 'bad forged line', why: 'is not an id' }]);
  const none = (v) => !/[\n\r]/.test(v);
  assert.ok(none(starter.shown('x\n\ry')));
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
function call(server, host, method, urlPath, { body, cookie, zip, token } = {}) {
  const payload = zip || (body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
  const name = host ? `${host}.localhost:${server.port}` : `127.0.0.1:${server.port}`;
  const headers = { host: name, accept: 'application/json', origin: `http://${name}` };
  if (payload) { headers['content-type'] = zip ? 'application/zip' : 'application/json'; headers['content-length'] = payload.length; }
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
        resolve({ status: res.statusCode, json, text, headers: res.headers, raw: Buffer.concat(chunks) });
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
  // With set-up agents on (plan-admin-agent.md), so one can make a space here too.
  const server = await startServer(path.join(tmp, 'single'), { ADMIN_PASSWORD: 'admin-password-1', AGENT_TOKENS: 'true', AGENT_SETUP: 'true' });
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

  await test('a space a set-up agent makes on the template gets its starter content, as the agent, though its column has no module row', async () => {
    assert.equal((await admin('PATCH', '/api/settings', { agents: true, setupAgents: true })).status, 200);
    assert.equal((await admin('PATCH', '/api/roles/setup', { agentMakeSpaces: true })).status, 200);
    const agent = (await admin('POST', '/api/users', { agent: true, kind: 'setup' })).json.user;
    const token = (await admin('POST', `/api/users/${agent.key}/token`)).json.token;
    const r = await call(server, null, 'POST', '/api/agent/spaces', { token, body: { name: 'Made by an agent', template: 'proj' } });
    assert.equal(r.status, 200, r.text);
    const items = await dataOf(owner.as, 'notes', r.json.space.id);
    assert.deepEqual(items.map((i) => i.key), ['note:brief', 'note:log']);
    for (const i of items) assert.deepEqual([i.by, i.value.byKey], [agent.key, agent.key], 'written as the agent');
    assert.equal((await call(server, null, 'GET', `/api/modules/notes/data?scope=space&space=${r.json.space.id}`, { token })).status, 403, 'which still reads none of it');
  });

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
    await refusedWith({ notes: {}, plain: { starter: { k: 1 } } }, 'modules.plain: the Plain module takes no starter content.');
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

  await test('a switch offers the template\'s starter spaces, unticked; only the ticked ones are made, once, with their starter content', async () => {
    const e = await owner.as('PATCH', '/api/environment/templates/proj', { modules: { notes: { starter: BRIEF }, chat: {}, conference: {} }, starterSpaces: [{ name: 'Kickoff', description: 'Start here.' }, { name: 'Backlog' }] });
    assert.equal(e.status, 200, e.text);
    const version = e.json.template.version;
    let offerId;
    const count = async () => (await owner.as('GET', '/api/spaces')).json.spaces.length;
    const before = await count();
    const sw = await owner.as('PATCH', '/api/settings', { template: 'proj' });
    assert.equal(sw.status, 200, sw.text);
    assert.deepEqual(sw.json.offer.starterSpaces, [{ index: 0, name: 'Kickoff', description: 'Start here.' }, { index: 1, name: 'Backlog', description: '' }]);
    assert.equal(sw.json.offer.version, version);
    ({ offerId } = sw.json.offer);
    assert.match(offerId, /^[0-9a-f]{16}$/);
    assert.equal(await count(), before, 'the switch itself makes none');
    assert.deepEqual((await owner.as('GET', '/api/environment/template')).json.offer.starterSpaces.map((sp) => sp.index), [0, 1], 'the Template tab reads the same offer');
    // A member is refused, and nothing is made (a member who moderates a space: the hosted part).
    assert.equal((await mia.as('POST', '/api/environment/template/apply', { starterSpaces: [0], version, offerId })).status, 403);
    for (const bad of [[0], '"x"', '5', 'null']) {
      const r = await owner.as('POST', '/api/environment/template/apply', bad);
      assert.equal(r.status, 400, `${JSON.stringify(bad)}: ${r.text}`);
      assert.equal(typeof r.json?.error, 'string');
    }
    assert.equal((await owner.as('GET', '/api/environment/template')).json.template.offerOpen, true, 'a refused body leaves the offer open');
    const r = await owner.as('POST', '/api/environment/template/apply', { starterSpaces: [0], version, offerId });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.made.length, 1);
    assert.equal(r.json.offer, null, 'the offer is closed');
    assert.equal(await count(), before + 1);
    const made = (await owner.as('GET', `/api/spaces/${r.json.made[0]}`)).json.space;
    assert.deepEqual([made.name, made.description, made.starterDone], ['Kickoff', 'Start here.', true]);
    const items = await dataOf(owner.as, 'notes', made.id);
    assert.deepEqual(items.map((i) => [i.key, i.version, i.by]), [['note:brief', 1, owner.key], ['note:log', 1, owner.key]], 'its starter content, once, as the owner who confirmed');
    const again = await owner.as('POST', '/api/environment/template/apply', { starterSpaces: [0], version, offerId });
    assert.deepEqual([again.status, again.json?.error], [409, 'This template has already been applied.']);
    assert.equal(await count(), before + 1, 'a repeat makes none');
    assert.equal((await owner.as('PATCH', '/api/settings', { template: 'default' })).status, 200);
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
    const t = await console_('POST', '/api/host/templates', { id: 'starts', name: 'Starts', description: 'With spaces.', words: { space: { one: 'venture', many: 'ventures' } }, modules: { chat: {} }, starterSpaces: STARTERS });
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
      assert.equal(full.template, 'starts', 'each uses the template that made it, recorded as its own (as POST /api/spaces records one)');
    }
    assert.equal((await as('GET', `/api/spaces/${spaces[0].id}`)).json.space.description, 'A place to try things.');
    // A space the owner makes later, naming none, reads the environment's template, as any does.
    const later = await as('POST', '/api/spaces', { name: 'Later' });
    assert.equal(later.status, 200, later.text);
    assert.equal((await as('GET', `/api/spaces/${later.json.space.id}`)).json.space.template, null);
    // A switch to another template, and back, makes none; the starter spaces stay on the template that made them.
    assert.equal((await console_('PATCH', '/api/host/environments/acme', { template: 'default' })).status, 200);
    for (const s of spaces) {
      assert.equal((await as('GET', `/api/spaces/${s.id}`)).json.space.template, 'starts', 'a switch of the environment\'s template leaves a starter space on its own');
      assert.equal((await as('GET', `/api/spaces/${s.id}/look`)).json.look.words.space.one, 'venture', 'and it reads it');
    }
    assert.equal((await as('GET', `/api/spaces/${later.json.space.id}/look`)).json.look.words.space.one, 'space', 'the later space follows the environment');
    assert.equal((await as('DELETE', `/api/spaces/${later.json.space.id}`)).status, 200);
    assert.equal((await console_('PATCH', '/api/host/environments/acme', { template: 'starts' })).status, 200);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await named()).length, 2, 'no starter spaces on a switch');
    const tab = (await as('GET', '/api/environment/template')).json;
    assert.deepEqual(tab.offer.starterSpaces, [{ index: 0, name: 'Your first project', description: 'A place to try things.' }, { index: 1, name: 'Second', description: '' }], 'offered instead, unticked');
  });

  await test('hosted: a starter space name over the limit is refused; one at the limit is kept whole', async () => {
    const limit = SPACE_NAME_MAX;
    const long = await console_('POST', '/api/host/templates', { id: 'longname', name: 'Long', description: 'A long name.', modules: { chat: {} }, starterSpaces: [{ name: 'x'.repeat(limit + 1) }] });
    assert.deepEqual([long.status, long.json?.error], [400, `starterSpaces[0]: a name is plain text of 1 to ${limit} characters.`]);
    const ok = await console_('POST', '/api/host/templates', { id: 'fitname', name: 'Fit', description: 'A name that fits.', modules: { chat: {} }, starterSpaces: [{ name: 'y'.repeat(limit) }] });
    assert.equal(ok.status, 201, ok.text);
    assert.equal(starter.starterSpacesOf({ starterSpaces: [{ name: 'y'.repeat(limit) }] })[0].name.length, limit, 'what the store keeps is what the template said');
    assert.equal(new Store(fs.mkdtempSync(path.join(tmp, 'name-'))).sanitizeSpace({ id: 'abcd1234', name: 'y'.repeat(limit) }).name.length, limit);
  });

  await test('hosted: a restore whose template record was never applied makes no starter spaces', async () => {
    const backup = await console_('POST', '/api/host/environments/acme/backup');
    assert.equal(backup.status, 200);
    const appFile = path.join(tmp, 'hosted', 'environments', 'acme', 'app.json');
    const app = JSON.parse(fs.readFileSync(appFile, 'utf8'));
    assert.equal(app.template.id, 'starts');
    app.template.appliedAt = null;
    delete app.template.switchedAt;
    const restore = await call(hs, 'admin', 'POST', '/api/host/environments/acme/restore?backup=1', { cookie: hostCookie, zip: zipFiles([['app.json', Buffer.from(JSON.stringify(app))]]) });
    assert.equal(restore.status, 200, restore.text);
    const c = cookieOf(await call(hs, 'acme', 'POST', '/api/login', { body: { login: 'owner-acme', password: 'owner-acme-password-1' } }));
    // The environment is rebuilt (its template applied again, as before); wait for that, then count.
    let record = null;
    for (let i = 0; i < 100 && !record?.appliedAt; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      record = JSON.parse(fs.readFileSync(appFile, 'utf8')).template;
    }
    assert.ok(record?.appliedAt, 'the template was applied again');
    await new Promise((r) => setTimeout(r, 300));
    const list = (await call(hs, 'acme', 'GET', '/api/spaces', { cookie: c })).json.spaces.filter((sp) => sp.id !== LOBBY);
    assert.equal(list.length, 2, `a restore makes no starter spaces: ${list.map((sp) => sp.name).join(', ')}`);
  });
  await test('hosted: a shipped template\'s starter document reads as written by the person who made the space, now (the real Documents module and record)', async () => {
    const shipped = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'learning.json'), 'utf8')).modules.documents.starter;
    const made = await console_('POST', '/api/host/environments', { slug: 'learn', name: 'Learn', template: 'learning', owner: { login: 'owner-learn', password: 'owner-learn-password-1' } });
    assert.equal(made.status, 201, made.text);
    const c = cookieOf(await call(hs, 'learn', 'POST', '/api/login', { body: { login: 'owner-learn', password: 'owner-learn-password-1' } }));
    const as = (method, url, body) => call(hs, 'learn', method, url, { cookie: c, body });
    // The template applies (and installs Documents) after the environment is made: wait for that.
    const appFile = path.join(tmp, 'hosted', 'environments', 'learn', 'app.json');
    for (let i = 0; i < 300 && !JSON.parse(fs.readFileSync(appFile, 'utf8')).template?.appliedAt; i += 1) await new Promise((r) => setTimeout(r, 100));
    const me = (await as('GET', '/api/me')).json;
    const user = me.user || me;
    const before = Date.now();
    const r = await as('POST', '/api/spaces', { name: 'Study' });
    assert.equal(r.status, 200, r.text);
    const got = await as('GET', `/api/modules/documents/data?scope=space&space=${r.json.space.id}`);
    assert.equal(got.status, 200, got.text);
    const byKey = Object.fromEntries(got.json.items.map((i) => [i.key, i]));
    assert.deepEqual(Object.keys(byKey).sort(), Object.keys(shipped).sort(), 'every starter key written');
    const doc = byKey['doc:learnjournal'];
    assert.equal(doc.by, user.key, 'the row: written as the creator');
    assert.deepEqual([doc.value.by, doc.value.editedBy, doc.value.editedByName], [user.key, user.key, user.displayName], 'the record\'s own author fields: the creator, not "template"');
    for (const k of ['at', 'editedAt']) {
      const t = Date.parse(doc.value[k]);
      assert.ok(t >= before - 1000 && t <= Date.now() + 1000, `${k} is the time the space was made: ${doc.value[k]}`);
    }
    const { by, at, editedBy, editedByName, editedAt, ...rest } = doc.value;
    const { by: b2, at: a2, editedBy: e2, editedByName: n2, editedAt: t2, ...shippedRest } = shipped['doc:learnjournal'];
    assert.deepEqual(rest, shippedRest, 'nothing else in the record changes');
    assert.deepEqual(byKey['text:learnjournal:journalc'].value, shipped['text:learnjournal:journalc'], 'a record with no author (the text) is written as the template has it');
    assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'learning.json'), 'utf8')).modules.documents.starter['doc:learnjournal'].by, 'template', 'the template itself is untouched');
  });
  await test('hosted: the switch offer and its confirm; each refusal; exactly the ticked ones, once; another environment untouched', async () => {
    const FIVE = [{ name: 'One', description: 'First.' }, { name: 'Two' }, { name: 'z'.repeat(SPACE_NAME_MAX) }, { name: 'Four' }, { name: 'Five' }];
    const t = await console_('POST', '/api/host/templates', { id: 'five', name: 'Five', description: 'Five spaces.', modules: { chat: {} }, starterSpaces: FIVE });
    assert.equal(t.status, 201, t.text);
    for (const slug of ['offer', 'quiet']) {
      const m = await console_('POST', '/api/host/environments', { slug, name: slug, owner: { login: `owner-${slug}`, password: `owner-${slug}-password-1` } });
      assert.equal(m.status, 201, m.text);
    }
    const signIn = async (slug, who, password) => {
      const c = cookieOf(await call(hs, slug, 'POST', '/api/login', { body: { login: who, password } }));
      return (method, url, body) => call(hs, slug, method, url, { cookie: c, body });
    };
    const as = await signIn('offer', 'owner-offer', 'owner-offer-password-1');
    const quiet = await signIn('quiet', 'owner-quiet', 'owner-quiet-password-1');
    const ownerKey = ((await as('GET', '/api/me')).json.user || {}).key;
    const named = async (who = as) => (await who('GET', '/api/spaces')).json.spaces.filter((sp) => sp.id !== LOBBY);
    const quietBefore = (await named(quiet)).map((sp) => sp.id);
    // A member, and a member who moderates a space.
    const side = (await as('POST', '/api/spaces', { name: 'Side' })).json.space.id;
    const mk = async (login) => {
      const u = await as('POST', '/api/users', { login, displayName: login, role: 'member', password: `${login}-password-1` });
      assert.equal(u.status, 201, u.text);
      assert.equal((await as('PATCH', `/api/spaces/${side}`, { members: [...(await as('GET', `/api/spaces/${side}`)).json.space.members, u.json.user.key] })).status, 200);
      return { key: u.json.user.key, as: await signIn('offer', login, `${login}-password-1`) };
    };
    const memb = await mk('offer-member');
    const mod = await mk('offer-moderator');
    assert.equal((await as('PATCH', `/api/users/${mod.key}/spaces/${side}`, { permissions: { moderator: true } })).status, 200);

    const before = (await named()).length;
    const sw = await as('PATCH', '/api/settings', { template: 'five' });
    assert.equal(sw.status, 200, sw.text);
    assert.deepEqual(sw.json.offer.starterSpaces, FIVE.map((sp, index) => ({ index, name: sp.name, description: sp.description || '' })), 'all five offered, unticked');
    const { version, offerId } = sw.json.offer;
    assert.equal(version, 1);
    assert.equal((await named()).length, before, 'the switch makes none');
    const offerNow = async () => { const o = (await as('GET', '/api/environment/template')).json.offer; return { version: o.version, offerId: o.offerId }; };

    for (const who of [memb, mod]) {
      assert.equal((await who.as('POST', '/api/environment/template/apply', { starterSpaces: [0], version, offerId })).status, 403);
      assert.equal((await who.as('PATCH', '/api/settings', { template: 'default' })).status, 403);
    }
    const CHANGED = 'This template changed since it was offered; look at the offer again.';
    const refused = [
      [[0], 400, 'A confirm is sent as named fields, not as a list or a single value.'],
      [{ starterSpaces: 'all', version, offerId }, 400, 'Name the starter spaces to make as a list of their numbers from the offer.'],
      [{ starterSpaces: ['0'], version, offerId }, 400, 'Name the starter spaces to make as a list of their numbers from the offer.'],
      [{ starterSpaces: [-1], version, offerId }, 400, 'Name the starter spaces to make as a list of their numbers from the offer.'],
      [{ starterSpaces: [1.5], version, offerId }, 400, 'Name the starter spaces to make as a list of their numbers from the offer.'],
      [{ starterSpaces: [0, 0], version, offerId }, 400, 'Each starter space is named once.'],
      [{ starterSpaces: [0, 1, 2, 3, 4, 5], version, offerId }, 400, 'At most 5 starter spaces can be made.'],
      [{ starterSpaces: [5], version, offerId }, 400, 'This offer has no starter space 5.'],
      [{ starterSpaces: [0], offerId }, 400, "Send the offer's offerId and version."],
      [{ starterSpaces: [0], version }, 400, "Send the offer's offerId and version."],
      [{}, 400, "Send the offer's offerId and version."],
      [{ modules: [], lobby: true, spaceDefaults: true }, 400, "Send the offer's offerId and version.", 'the body the pages sent before offerId'],
      [{ starterSpaces: [0], version: '1', offerId }, 400, "version is the template's version from the offer."],
      [{ starterSpaces: [0], version, offerId: 5 }, 400, "offerId is the offer's own, as the offer gave it."],
      [{ starterSpaces: [0], version: 7, offerId }, 409, CHANGED],
      [{ starterSpaces: [0], version, offerId: '0123456789abcdef' }, 409, CHANGED],
      [{ modules: [], version, offerId: '0123456789abcdef' }, 409, CHANGED],
    ];
    for (const [body, status, error] of refused) {
      const r = await as('POST', '/api/environment/template/apply', body);
      assert.deepEqual([r.status, r.json?.error], [status, error], JSON.stringify(body));
    }
    for (const body of ['"five"', 'null']) {
      const r = await as('POST', '/api/environment/template/apply', body);
      assert.equal(r.status, 400, `a string or null body: ${body}`);
    }
    for (const body of [[0], '"five"']) {
      const r = await console_('POST', '/api/host/environments/offer/template/apply', body);
      assert.equal(r.status, 400, `the host's confirm too: ${JSON.stringify(body)}`);
    }
    assert.equal((await named()).length, before, 'a refusal makes none');
    assert.equal((await as('GET', '/api/environment/template')).json.template.offerOpen, true, 'and leaves the offer open');

    // Another template at the same version: the host switches to it after the owner read the offer of five; the owner's
    // stale confirm is refused, nothing made, and two's offer stays open.
    const two = await console_('POST', '/api/host/templates', { id: 'two', name: 'Two', description: 'Two spaces.', modules: { chat: {} }, starterSpaces: [{ name: 'Alpha' }, { name: 'Beta' }] });
    assert.equal(two.status, 201, two.text);
    assert.equal((await console_('PATCH', '/api/host/environments/offer', { template: 'two' })).status, 200);
    const other = await as('POST', '/api/environment/template/apply', { starterSpaces: [1], version, offerId });
    assert.deepEqual([other.status, other.json?.error], [409, CHANGED]);
    assert.equal((await named()).length, before, 'nothing made from the other template');
    assert.equal((await as('GET', '/api/environment/template')).json.template.offerOpen, true);
    // Back to five: the first offer replayed is refused (a switch away and back is another offer).
    assert.equal((await as('PATCH', '/api/settings', { template: 'five' })).status, 200);
    const replay = await as('POST', '/api/environment/template/apply', { starterSpaces: [1], version, offerId });
    assert.deepEqual([replay.status, replay.json?.error], [409, CHANGED]);
    assert.notEqual((await offerNow()).offerId, offerId);

    // The template changes after the offer: the old one is refused, the new one offered.
    const beforeEdit = await offerNow();
    assert.equal((await console_('PATCH', '/api/host/templates/five', { description: 'Five spaces, edited.' })).status, 200);
    const stale = await as('POST', '/api/environment/template/apply', { starterSpaces: [1], ...beforeEdit });
    assert.deepEqual([stale.status, stale.json?.error], [409, CHANGED]);
    const fresh = await offerNow();
    assert.equal(fresh.version, 2);

    // Ticking makes exactly those, once, each on its template, made by the owner; the 40-character name whole.
    const ok = await as('POST', '/api/environment/template/apply', { starterSpaces: [2, 4], ...fresh });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.made.length, 2);
    const list = await named();
    assert.equal(list.length, before + 2);
    for (const id of ok.json.made) {
      const full = (await as('GET', `/api/spaces/${id}`)).json.space;
      assert.deepEqual([full.template, full.starterDone, full.members.includes(ownerKey)], ['five', true, true]);
    }
    assert.deepEqual(ok.json.made.map((id) => list.find((sp) => sp.id === id).name), ['z'.repeat(SPACE_NAME_MAX), 'Five']);
    const repeat = await as('POST', '/api/environment/template/apply', { starterSpaces: [2, 4], ...fresh });
    assert.deepEqual([repeat.status, repeat.json?.error], [409, 'This template has already been applied.']);
    assert.equal((await named()).length, before + 2, 'a repeat makes none');

    // A new switch offers again; a confirm with none ticked makes none.
    assert.equal((await as('PATCH', '/api/settings', { template: 'default' })).status, 200);
    assert.equal((await as('PATCH', '/api/settings', { template: 'five' })).status, 200);
    const none = await as('POST', '/api/environment/template/apply', await offerNow());
    assert.deepEqual([none.status, none.json?.made], [200, []]);
    assert.equal((await named()).length, before + 2, 'none ticked: none made');

    // Two confirms of one offer at once: one makes its space, the other is refused.
    assert.equal((await as('PATCH', '/api/settings', { template: 'default' })).status, 200);
    assert.equal((await as('PATCH', '/api/settings', { template: 'five' })).status, 200);
    const once = await offerNow();
    const both = await Promise.all([0, 1].map(() => as('POST', '/api/environment/template/apply', { starterSpaces: [0], ...once })));
    assert.deepEqual(both.map((r) => r.status).sort(), [200, 409], both.map((r) => r.text).join(' | '));
    assert.equal((await named()).filter((sp) => sp.name === 'One').length, 1, 'made once');

    // Two confirms at once naming different modules: only the winner's is turned on.
    const mods = await console_('POST', '/api/host/templates', { id: 'mods', name: 'Mods', description: 'Two modules.', modules: { chat: {}, polls: {}, budget: {} } });
    assert.equal(mods.status, 201, mods.text);
    const sw2 = await as('PATCH', '/api/settings', { template: 'mods' });
    assert.deepEqual(sw2.json.offer.modules.map((m) => m.id).sort(), ['budget', 'polls']);
    const modsOffer = { offerId: sw2.json.offer.offerId, version: sw2.json.offer.version };
    const race = await Promise.all([['polls'], ['budget']].map((m) => as('POST', '/api/environment/template/apply', { modules: m, ...modsOffer })));
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 409], race.map((r) => r.text).join(' | '));
    const winner = race[0].status === 200 ? 'polls' : 'budget';
    const on = (await as('GET', '/api/modules')).json.modules.filter((m) => ['polls', 'budget'].includes(m.id) && m.enabled).map((m) => m.id);
    assert.deepEqual(on, [winner], 'only the winner\'s module is on');

    // The host's confirm: made by the environment's first owner.
    assert.equal((await console_('PATCH', '/api/host/environments/offer', { template: 'five' })).status, 200);
    const hostOffer = (await console_('GET', '/api/host/environments/offer/template')).json.offer;
    assert.deepEqual(hostOffer.starterSpaces.map((sp) => sp.index), [0, 1, 2, 3, 4]);
    const hostApply = await console_('POST', '/api/host/environments/offer/template/apply', { starterSpaces: [3], version: hostOffer.version, offerId: hostOffer.offerId });
    assert.equal(hostApply.status, 200, hostApply.text);
    assert.equal(hostApply.json.environment.made.length, 1);
    const four = (await as('GET', `/api/spaces/${hostApply.json.environment.made[0]}`)).json.space;
    assert.deepEqual([four.name, four.template, four.members.includes(ownerKey)], ['Four', 'five', true]);
    const hostBad = await console_('POST', '/api/host/environments/offer/template/apply', { starterSpaces: [3], version: hostOffer.version, offerId: hostOffer.offerId });
    assert.deepEqual([hostBad.status, hostBad.json?.error], [409, 'This template has already been applied.']);

    // The host signed in to the environment as its stand-in confirms on the environment's own route: the stand-in makes
    // the space (as with POST /api/spaces) and, as it does there, does not join it.
    assert.equal((await console_('PATCH', '/api/host/environments/offer', { template: 'default' })).status, 200);
    assert.equal((await console_('PATCH', '/api/host/environments/offer', { template: 'five' })).status, 200);
    const standIn = await signIn('offer', 'boss', 'host-password-1');
    const standInKey = ((await standIn('GET', '/api/me')).json.user || {}).key;
    assert.ok(standInKey);
    const sOffer = (await standIn('GET', '/api/environment/template')).json.offer;
    const byStandIn = await standIn('POST', '/api/environment/template/apply', { starterSpaces: [1], version: sOffer.version, offerId: sOffer.offerId });
    assert.equal(byStandIn.status, 200, byStandIn.text);
    const twoMade = (await as('GET', `/api/spaces/${byStandIn.json.made[0]}`)).json.space;
    assert.deepEqual([twoMade.name, twoMade.starterDone, twoMade.members.includes(standInKey), twoMade.members.includes(ownerKey)], ['Two', true, false, false]);

    // Deleting the owner's own template in use while its offer is confirmed: the two take turns, so either the confirm
    // goes first (200, its module on) and the delete after it, or the delete goes first and the confirm is refused with
    // nothing turned on; the environment ends on the Default template either way.
    const td = await console_('POST', '/api/host/templates', { id: 'todos', name: 'Todos', description: 'To-do.', modules: { chat: {}, todo: {} } });
    assert.equal(td.status, 201, td.text);
    for (let round = 0; round < 3; round += 1) {
      const id = `mine${round}`;
      assert.equal((await as('POST', '/api/environment/templates', { from: 'todos', id, name: `Mine ${round}` })).status, 201);
      if ((await as('GET', '/api/modules')).json.modules.some((m) => m.id === 'todo' && m.enabled)) assert.equal((await as('PATCH', '/api/modules/todo', { enabled: false })).status, 200);
      const swm = await as('PATCH', '/api/settings', { template: id });
      assert.deepEqual(swm.json.offer.modules.map((m) => m.id), ['todo'], swm.text);
      const [conf, del] = await Promise.all([
        as('POST', '/api/environment/template/apply', { modules: ['todo'], offerId: swm.json.offer.offerId, version: swm.json.offer.version }),
        as('DELETE', `/api/environment/templates/${id}`),
      ]);
      assert.equal(del.status, 200, del.text);
      const todoOn = (await as('GET', '/api/modules')).json.modules.some((m) => m.id === 'todo' && m.enabled);
      if (conf.status === 200) assert.equal(todoOn, true, 'the confirm went first: its module on');
      else assert.deepEqual([conf.status, todoOn], [409, false], `the delete went first: nothing turned on (${conf.text})`);
      assert.equal((await as('GET', '/api/environment/template')).json.template.id, 'default', 'never left on a deleted template');
    }

    assert.deepEqual((await named(quiet)).map((sp) => sp.id), quietBefore, 'another environment is untouched');
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
