#!/usr/bin/env node
/*
 * check-agent-review.mjs -- the shared delete path, keyed holds and the agents' records with their review list and Undo
 * (documentation/plans/plan-agent-edit-delete.md, steps 4 and 5 of "Left to build"; "The contract", 4). Step 6 (delete asks
 * and approval) has its own check, tools/check-agent-delete-asks.mjs.
 *
 * On their own (no server):
 *   - agent-records.json: written whole through a temporary file, private to the server (0600); a delete ask and the three
 *     object changes round-trip; anything else in the file is dropped; an unreadable file is set aside and a new one begun;
 *     a change past AGENT_UNDO_DAYS goes and its hold is let go (onDrop); undo is once, and only where the route reaches;
 *   - keyed holds: one file per change under trash/agent/, no .tmp left, 0600; over 256 KB is not kept; past 50 MB in the
 *     environment the oldest go first (and are finished); one past its time is finished (onKeyedExpire) and goes; one that
 *     can't be read is set aside as .bad; a deleted space takes its keyed holds;
 *   - the shared delete path: a delete with a hold keeps the object and its children (and their files) first, deletes
 *     them, cancels schedules about them and leaves the files; its Undo puts them back and tells object-sync; an Undo while
 *     something new is at the key is refused with its sentence and changes nothing; a guard's refusal deletes nothing.
 * Against a real server (single install, throwaway DATA_DIR):
 *   - an agent's add and edit carried by the server (To-do) are recorded as added and edited, the edit's earlier value held;
 *     a person's own write is not recorded; the owner's list on the agent's page says each in words, never a raw id;
 *   - a page write tied to the agent's claimed request (Maps, which waits for a page) is recorded; one with no tie is not;
 *   - Undo: edited puts back the held value; added removes the object; a second Undo is 409 "That was undone already.";
 *     an Undo after a later edit is 409 "That has been changed since, so undo would lose that change."; it is named in the
 *     module's activity list;
 *   - who: the space's review list and its Undo for owners, the admin and that space's moderators only (a member 403, the
 *     agent's token 403 on every review and undo route); another space's change is 404 there;
 *   - a person's DELETE through the shared path still deletes and cancels a schedule about the object;
 *   - the records and holds survive a restart; deleting the space takes them; no title is in the agent's log.
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

// Maps uploaded as a module of its own, so a page still carries its agents' requests: the bundled Maps runs them on the server
// (plan-agent-server-actions.md, step 10), and an upload may not declare actions.server, so the copy leaves it out.
const mapsUploadZip = () => {
  const at = fs.mkdtempSync(path.join(os.tmpdir(), 'maps-upload-'));
  try {
    fs.cpSync(path.join(ROOT, 'modules', 'maps'), at, { recursive: true });
    const m = JSON.parse(fs.readFileSync(path.join(at, 'module.json'), 'utf8'));
    delete m.actions.server;
    fs.writeFileSync(path.join(at, 'module.json'), JSON.stringify(m, null, 2));
    return createRequire(import.meta.url)(path.join(ROOT, 'server', 'module-build.js')).buildModule(at).zip;
  } finally {
    fs.rmSync(at, { recursive: true, force: true });
  }
};
const require = createRequire(import.meta.url);
const { AgentRecords, AGENT_RECORDS_FILE } = require(path.join(ROOT, 'server', 'agent-records.js'));
const { ModuleHolds, KEYED_MAX_BYTES, KEYED_TOTAL_BYTES } = require(path.join(ROOT, 'server', 'module-holds.js'));
const { ModuleData } = require(path.join(ROOT, 'server', 'module-data.js'));
const { ModuleLinks } = require(path.join(ROOT, 'server', 'module-links.js'));
const { StoreError } = require(path.join(ROOT, 'server', 'store.js'));
const { createDeletePath, UNDO_WHY } = require(path.join(ROOT, 'server', 'delete-path.js'));
const { AGENT_UNDO_DAYS } = require(path.join(ROOT, 'server', 'agent-routes.js'));

const UNDONE = 'That was undone already.';
const CHANGED = 'That has been changed since, so undo would lose that change.';
const DAY = 24 * 3600000;

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-agent-review-'));
const quiet = () => {};
const mode = (f) => fs.statSync(f).mode & 0o777;

// --- the records, on their own -----------------------------------------------------------------------------------------
await test('agent-records.json: private, whole, and only what it keeps', async () => {
  const dir = path.join(base, 'records');
  const r = new AgentRecords(dir, { log: quiet });
  const id = r.newId();
  const kept = r.noteObject({ id, agent: 'agent001', space: 'camp01', change: 'edited', object: { module: 'todo', kind: 'task', id: 't1', scope: 'space', key: 'task:t1' }, versionAfter: 3, held: true, request: 7 });
  assert.equal(kept.id, id, 'the id taken first (its hold was written first)');
  const file = path.join(dir, AGENT_RECORDS_FILE);
  assert.equal(AGENT_RECORDS_FILE, 'agent-records.json');
  assert.equal(mode(file), 0o600, 'private to the server');
  assert.ok(!fs.existsSync(`${file}.tmp`), 'no temporary file left');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  // A delete ask (step 6 writes them) and junk beside it.
  raw.asks.push({ id: 'a'.repeat(16), agent: 'agent001', space: 'camp01', ask: 'delete', object: { module: 'todo', kind: 'task', id: 't1', scope: 'space', key: 'task:t1' }, version: 3, reason: 'x'.repeat(500), at: Date.now(), state: 'waiting', title: 'Secret' });
  raw.asks.push({ id: 'b'.repeat(16), agent: 'agent001', space: 'camp01', ask: 'delete', object: { module: 'todo', kind: 'task', id: 't1', scope: 'environment', key: 'task:t1' }, version: 3, at: Date.now(), state: 'waiting' });
  raw.changes.push({ id: 'c'.repeat(16), agent: 'agent001', space: 'camp01', change: 'added', object: { module: 'todo', kind: 'task', id: '../x', scope: 'space', key: 'task:x' }, versionAfter: 1, at: Date.now() });
  raw.changes[0].value = { title: 'Secret' };
  fs.writeFileSync(file, JSON.stringify(raw));
  const again = new AgentRecords(dir, { log: quiet });
  assert.equal(again.asks.length, 1, 'the bad delete ask is dropped');
  assert.equal(again.asks[0].reason.length, 200, 'the reason is cut at 200');
  assert.equal(again.asks[0].title, undefined, 'nothing but what it keeps');
  assert.equal(again.changes.length, 1, 'the bad change is dropped');
  assert.equal(again.changes[0].value, undefined, 'never a value');
  assert.deepEqual(again.changes[0].object, { module: 'todo', kind: 'task', id: 't1', scope: 'space', space: 'camp01', key: 'task:t1' });
  fs.writeFileSync(file, '{ not json');
  const logged = [];
  const fresh = new AgentRecords(dir, { log: (l) => logged.push(l) });
  assert.equal(fresh.changes.length, 0);
  assert.ok(fs.readdirSync(dir).some((f) => /^agent-records\.unreadable-\d+\.json$/.test(f)), 'set aside');
  assert.equal(logged.length, 1, 'said once');
});

await test('records: past their days they go and let go of their holds; undo is once and only where the route reaches', async () => {
  const r = new AgentRecords(path.join(base, 'records2'), { log: quiet });
  const dropped = [];
  r.onDrop = (c) => dropped.push(c.id);
  const old = r.noteObject({ agent: 'agent001', space: 'camp01', change: 'added', object: { module: 'todo', kind: 'task', id: 't1', scope: 'space', key: 'task:t1' }, versionAfter: 1, held: false }, Date.now() - AGENT_UNDO_DAYS * DAY - 1000);
  const now = r.noteObject({ agent: 'agent001', space: 'camp01', change: 'added', object: { module: 'todo', kind: 'task', id: 't2', scope: 'space', key: 'task:t2' }, versionAfter: 1, held: false });
  assert.deepEqual(dropped, [old.id], 'the old one went, with its hold');
  assert.equal(r.change(old.id), null);
  assert.throws(() => r.undo(now.id, (c) => c.space === 'other1', 'owner001', () => {}), (e) => e.status === 404, 'another space: no such change');
  r.undo(now.id, (c) => c.space === 'camp01', 'owner001', () => {});
  assert.throws(() => r.undo(now.id, () => true, 'owner001', () => {}), (e) => e.status === 409 && e.message === UNDONE);
  r.forgetSpace('camp01');
  assert.deepEqual(dropped, [old.id, now.id], 'a deleted space lets go of its holds');
});

// --- keyed holds, on their own -----------------------------------------------------------------------------------------
await test('keyed holds: one private file a change, the caps, expiry, an unreadable one, a deleted space', async () => {
  const dir = path.join(base, 'holds', 'modules');
  fs.mkdirSync(path.join(dir, 'todo'), { recursive: true });
  const logged = [];
  const holds = new ModuleHolds(dir, { log: (l) => logged.push(l) });
  const finished = [];
  holds.onKeyedExpire = (h) => finished.push(h.id);
  const item = (key, size = 10) => ({ key, value: { title: 'x'.repeat(size) }, version: 1, updatedAt: new Date().toISOString(), by: 'mia00001' });
  const id1 = '1'.repeat(16);
  assert.ok(holds.holdKeyed('todo', id1, { scopeKey: 'space:camp01', key: 'task:a', kind: 'edited', items: [item('task:a')], days: 7 }));
  const file = path.join(dir, 'todo', 'trash', 'agent', `${id1}.json`);
  assert.ok(fs.existsSync(file));
  assert.equal(mode(file), 0o600);
  assert.ok(!fs.existsSync(`${file}.tmp`));
  assert.equal(holds.readKeyed('todo', id1).items[0].key, 'task:a');
  assert.equal(holds.holdKeyed('todo', '2'.repeat(16), { scopeKey: 'space:camp01', key: 'task:b', kind: 'edited', items: [item('task:b', KEYED_MAX_BYTES)], days: 7 }), null, 'over 256 KB is not kept');
  assert.ok(!fs.existsSync(path.join(dir, 'todo', 'trash', 'agent', `${'2'.repeat(16)}.json`)));
  assert.throws(() => holds.holdKeyed('todo', '../x', { scopeKey: 'space:camp01', key: 'k', kind: 'edited', items: [], days: 7 }), 'a change id is an id');
  // Expiry: a hold written as long ago as its days is finished and goes.
  const id3 = '3'.repeat(16);
  holds.holdKeyed('todo', id3, { scopeKey: 'space:camp01', key: 'task:c', kind: 'deleted', items: [item('task:c')], files: ['f'.repeat(24)], days: 7 }, Date.now() - 8 * DAY);
  assert.ok(holds.holdsFile('todo', 'space:camp01', 'f'.repeat(24)) === false, 'an expired hold keeps no file');
  assert.equal(holds.readKeyed('todo', id3), null);
  assert.ok(finished.includes(id3), 'finished (its files go)');
  const id4 = '4'.repeat(16);
  holds.holdKeyed('todo', id4, { scopeKey: 'space:camp01', key: 'task:d', kind: 'deleted', items: [item('task:d')], files: ['e'.repeat(24)], days: 7 });
  assert.equal(holds.holdsFile('todo', 'space:camp01', 'e'.repeat(24)), true, 'a deleted object\'s file waits for its Undo');
  // Unreadable.
  const id5 = '5'.repeat(16);
  fs.writeFileSync(path.join(dir, 'todo', 'trash', 'agent', `${id5}.json`), '{ nope');
  assert.equal(holds.readKeyed('todo', id5), null);
  assert.ok(fs.existsSync(path.join(dir, 'todo', 'trash', 'agent', `${id5}.json.bad`)), 'set aside');
  assert.ok(logged.some((l) => l.includes('could not be read')));
  // A deleted space.
  holds.forgetSpace('camp01');
  assert.equal(holds.readKeyed('todo', id1), null);
  assert.equal(holds.readKeyed('todo', id4), null);
  // 50 MB: the oldest go first.
  const big = 'y'.repeat(KEYED_MAX_BYTES - 2000);
  const ids = [];
  const count = Math.ceil(KEYED_TOTAL_BYTES / (KEYED_MAX_BYTES - 1500)) + 2;
  for (let i = 0; i < count; i += 1) {
    const cid = (i + 1).toString(16).padStart(16, '0');
    ids.push(cid);
    holds.holdKeyed('todo', cid, { scopeKey: 'space:camp02', key: `task:${i}`, kind: 'edited', items: [{ key: `task:${i}`, value: big, version: 1 }], days: 7 }, Date.now() + i);
  }
  const left = holds.keyedList();
  assert.ok(left.reduce((s, h) => s + h.bytes, 0) <= KEYED_TOTAL_BYTES, 'at most 50 MB held');
  assert.ok(holds.readKeyed('todo', ids[0]) === null, 'the oldest went');
  assert.ok(holds.readKeyed('todo', ids[ids.length - 1]), 'the newest stays');
  holds.stop();
});

// --- the shared delete path, on its own ---------------------------------------------------------------------------------
await test('the shared delete path: held first, deleted with its children, schedules cancelled, files kept; Undo puts it back', async () => {
  const dir = path.join(base, 'path', 'modules');
  fs.mkdirSync(path.join(dir, 'polls'), { recursive: true });
  const moduleData = new ModuleData(dir);
  const moduleHolds = new ModuleHolds(dir, { log: quiet });
  const moduleLinks = new ModuleLinks(dir);
  const synced = [];
  const cancelled = [];
  const removedFiles = [];
  const manifest = { id: 'polls', refs: { produces: [{ kind: 'poll', key: 'poll:{id}' }] } };
  const refuse = { on: false };
  const d = createDeletePath({
    moduleData, moduleHolds, moduleLinks, StoreError,
    moduleUploads: { remove: (id, scopeKey, fid) => removedFiles.push(fid) },
    moduleHooks: { cancelAbout: (id, scopeKey, ref) => cancelled.push(ref.id) },
    moduleGuards: {
      checkDelete: () => (refuse.on ? { status: 403, error: 'Only its maker may delete it.' } : null),
      checkPut: (g, { value }) => ({ value }),
      childrenOf: (g, key, keys) => keys.filter((k) => k.startsWith(`${key}/vote:`)),
      hiddenDeleteRefusal: () => null,
      namesFile: () => false,
    },
    objectSync: { afterWrite: (o) => synced.push(`${o.key}:${o.after === null ? 'gone' : 'back'}`) },
    takesCopies: () => false,
    copyRemoveRefusal: () => null,
    guardsAt: () => ({}),
    personalAt: () => false,
    guardWho: () => ({}),
    storedValue: () => () => null,
    removeFilesOf: (ctx, removed) => removedFiles.push(...removed.map((r) => r.key)),
    filesNamedBy: () => ['f'.repeat(24)],
    ownRefAt: (m, scopeKey, key) => (/^poll:[a-z0-9]+$/.test(key) ? { module: 'polls', kind: 'poll', id: key.slice(5), scope: 'space', space: scopeKey.slice(6) } : null),
    produceOf: () => null,
    enabledModule: () => ({ manifest }),
    putModuleValue: () => ({}),
  });
  const ctx = { manifest, scopeKey: 'space:camp01', by: 'ana00001', hide: null, who: {} };
  moduleData.put('polls', ctx.scopeKey, 'poll:p1', { question: 'Lunch?' }, { by: 'mia00001' });
  moduleData.put('polls', ctx.scopeKey, 'poll:p1/vote:a', { pick: 1 }, { by: 'mia00001' });
  moduleData.put('polls', ctx.scopeKey, 'poll:p2', { question: 'Dinner?' }, { by: 'mia00001' });
  refuse.on = true;
  assert.deepEqual(d.removeObject(ctx, 'poll:p1', { hold: { changeId: '6'.repeat(16), days: 7 } }), { status: 403, error: 'Only its maker may delete it.' });
  assert.ok(moduleData.get('polls', ctx.scopeKey, 'poll:p1') && !moduleHolds.readKeyed('polls', '6'.repeat(16)), 'a refusal deletes and holds nothing');
  refuse.on = false;
  assert.throws(() => d.removeObject(ctx, 'poll:p1', { expected: 9, hold: { changeId: '6'.repeat(16), days: 7 } }), (e) => e.status === 409);
  assert.equal(moduleHolds.readKeyed('polls', '6'.repeat(16)), null, 'a conflict holds nothing');
  const out = d.removeObject(ctx, 'poll:p1', { hold: { changeId: '6'.repeat(16), by: 'ana00001', days: 7 } });
  assert.equal(out.held, true);
  assert.deepEqual(out.children, ['poll:p1/vote:a']);
  assert.equal(moduleData.get('polls', ctx.scopeKey, 'poll:p1'), null);
  assert.equal(moduleData.get('polls', ctx.scopeKey, 'poll:p1/vote:a'), null, 'its votes go with it');
  assert.deepEqual(synced, ['poll:p1:gone', 'poll:p1/vote:a:gone'], 'other modules are told');
  assert.deepEqual(cancelled, ['p1'], 'a schedule about it is cancelled');
  assert.deepEqual(removedFiles, [], 'the files wait with the hold');
  assert.deepEqual(moduleHolds.readKeyed('polls', '6'.repeat(16)).items.map((i) => i.key), ['poll:p1', 'poll:p1/vote:a']);
  const change = { id: '6'.repeat(16), change: 'deleted', space: 'camp01', held: true, object: { module: 'polls', kind: 'poll', id: 'p1', scope: 'space', key: 'poll:p1' }, versionAfter: out.removed.version };
  // Something new at the key: refused, nothing changes.
  moduleData.put('polls', ctx.scopeKey, 'poll:p1', { question: 'Someone else\'s' }, { by: 'mia00001' });
  assert.deepEqual(d.undoChange(ctx, change), { status: 409, error: UNDO_WHY.taken });
  assert.equal(UNDO_WHY.taken, 'Something new is there now.');
  assert.equal(moduleData.get('polls', ctx.scopeKey, 'poll:p1').value.question, 'Someone else\'s');
  moduleData.remove('polls', ctx.scopeKey, 'poll:p1');
  synced.length = 0;
  assert.equal(d.undoChange(ctx, change), null, 'undone');
  assert.equal(moduleData.get('polls', ctx.scopeKey, 'poll:p1').value.question, 'Lunch?');
  assert.equal(moduleData.get('polls', ctx.scopeKey, 'poll:p1/vote:a').value.pick, 1, 'its votes come back');
  assert.deepEqual(synced, ['poll:p1:back', 'poll:p1/vote:a:back'], 'other modules hear it is back (copies are made again)');
  assert.equal(moduleHolds.readKeyed('polls', '6'.repeat(16)), null, 'the hold is taken back once');
  assert.deepEqual(d.undoChange(ctx, change), { status: 409, error: UNDO_WHY.old });
  // A plain delete (no hold): the files go at once.
  d.removeObject(ctx, 'poll:p2');
  assert.deepEqual(removedFiles, ['poll:p2']);
  moduleHolds.stop();
});

// --- against a server ---------------------------------------------------------------------------------------------------
const servers = [];
async function startServer(dataDir) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, TZ: 'UTC', ADMIN_PASSWORD: 'admin-password-1', AGENT_TOKENS: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const server = { child, out: '', port: 0 };
  child.stdout.on('data', (d) => { server.out += d; });
  child.stderr.on('data', (d) => { server.out += d; });
  server.port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${server.out}`)); }, 30000);
    const onData = () => { const m = /listening on :(\d+)/.exec(server.out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${server.out}`)); });
  });
  server.stop = () => new Promise((resolve) => { if (child.exitCode !== null || child.signalCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
  servers.push(server);
  return server;
}
let server = null;
function call(method, urlPath, { body, cookie, token, zip } = {}) {
  const payload = zip ? zip : body === undefined ? null : Buffer.from(JSON.stringify(body));
  const headers = { host: `127.0.0.1:${server.port}`, accept: 'application/json' };
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
        resolve({ status: res.statusCode, json, text, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
async function signIn(login, password) {
  const r = await call('POST', '/api/login', { body: { login, password } });
  assert.equal(r.status, 200, `${login} signs in`);
  return [].concat(r.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
}
const ok = (r, what, status = 200) => assert.equal(r.status, status, `${what}: ${r.status} ${r.text.slice(0, 400)}`);

const dir = path.join(base, 'data');
try {
  server = await startServer(dir);
  const admin = await signIn('admin', 'admin-password-1');
  ok(await call('PATCH', '/api/settings', { cookie: admin, body: { agents: true } }), 'Agents on');
  const mia = (await call('POST', '/api/users', { cookie: admin, body: { login: 'mia', password: 'mia-password-1', displayName: 'Mia', role: 'member' } })).json.user;
  const max = (await call('POST', '/api/users', { cookie: admin, body: { login: 'max', password: 'max-password-1', displayName: 'Max', role: 'member' } })).json.user;
  const agent = (await call('POST', '/api/users', { cookie: admin, body: { agent: true } })).json.user;
  const camp = (await call('POST', '/api/spaces', { cookie: admin, body: { name: 'Camp', members: [agent.key, mia.key, max.key] } })).json.space.id;
  const fort = (await call('POST', '/api/spaces', { cookie: admin, body: { name: 'Fort', members: [agent.key, mia.key, max.key] } })).json.space.id;
  for (const id of ['todo', 'schedule', 'calendar']) ok(await call('POST', `/api/modules/bundled/${id}/install`, { cookie: admin, body: {} }), `${id} installs`, 201);
  ok(await call('POST', '/api/modules', { cookie: admin, zip: mapsUploadZip() }), 'Maps uploads', 201);
  for (const id of ['todo', 'schedule', 'calendar', 'maps']) ok(await call('PATCH', `/api/modules/${id}`, { cookie: admin, body: { enabled: true, allSpaces: true } }), `${id} on`);
  ok(await call('PATCH', `/api/users/${max.key}/spaces/${camp}`, { cookie: admin, body: { permissions: { moderator: true } } }), 'Max moderates Camp');
  const token = (await call('POST', `/api/users/${agent.key}/token`, { cookie: admin })).json.token;
  const T = { token };
  const miaC = await signIn('mia', 'mia-password-1');
  const maxC = await signIn('max', 'max-password-1');
  const todo = async (space = camp) => Object.fromEntries((await call('GET', `/api/modules/todo/data?scope=space&space=${space}`, { cookie: admin })).json.items.map((i) => [i.key, i]));
  const ask = (action, input, space = camp) => call('POST', `/api/spaces/${space}/action`, { ...T, body: { action, input } });
  const review = (cookie, space = camp) => call('GET', `/api/spaces/${space}/agent-review`, { cookie });

  await test('the objects format reaches the agent: the schema route, object_format, objectKinds and the host\'s hint', async () => {
    const schema = await call('GET', '/api/objects/format/schema', T);
    ok(schema, 'the schema through the agent\'s token');
    assert.ok(schema.json.$defs['details-flight'].properties.terminal, 'a flight\'s terminal is in it');
    const rpc = await call('POST', '/mcp', { ...T, body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'object_format', arguments: {} } } });
    ok(rpc, 'object_format');
    assert.ok(JSON.parse(rpc.json.result.content[0].text).$defs['details-task'], 'object_format answers the schema');
    const list = (await call('GET', `/api/spaces/${camp}/actions`, T)).json.actions;
    const create = list.find((a) => a.action === 'todo:createTask');
    assert.equal(create.hints.object, 'A typed object: { kind, title, details }; see objectKinds.', 'the host\'s hint where the manifest gives none');
    assert.deepEqual(create.objectKinds, [{ kind: 'task', details: { due: 'when' } }, { kind: '*' }]);
    const none = list.find((a) => a.action === 'todo:updateTask');
    assert.equal(none.objectKinds, undefined, 'nothing for an action with no object input');
    const person = (await call('GET', `/api/spaces/${camp}/actions`, { cookie: admin })).json.actions.find((a) => a.action === 'todo:createTask');
    assert.equal(person.objectKinds, undefined, 'a person\'s list is as it was');
  });

  let task = null;
  let added = null;
  let edited = null;
  await test('an agent\'s add and edit carried by the server are recorded, the edit\'s earlier value held', async () => {
    const made = await ask('todo:createTask', { title: 'Book the taxi', notes: 'Early' });
    ok(made, 'createTask');
    assert.equal(made.json.ok, true);
    task = made.json.ref;
    const changed = await ask('todo:updateTask', { task, title: 'Book the big taxi' });
    ok(changed, 'updateTask');
    assert.equal(changed.json.ok, true);
    // A person's own write is not recorded.
    const mine = (await todo())[`task:${task.id}`];
    ok(await call('PUT', `/api/modules/todo/data/task%3Amine1?scope=space&space=${camp}`, { cookie: miaC, body: { value: { ...mine.value, id: 'mine1', title: 'Mine', byKey: mia.key, by: 'Mia' } } }), 'Mia writes');
    const list = await review(admin);
    ok(list, 'the review list');
    assert.deepEqual(list.json.waiting, [], 'no asks yet (step 6)');
    assert.deepEqual(list.json.done.map((c) => c.change), ['edited', 'added']);
    [edited, added] = list.json.done;
    assert.deepEqual(added.object, task);
    assert.equal(added.text, 'Claude (agent) added a task "Book the big taxi" in To-do');
    assert.equal(edited.text, 'Claude (agent) changed the task "Book the big taxi" in To-do');
    assert.equal(edited.undoable, true);
    assert.equal(added.undoable, false, 'the add is changed since');
    assert.equal(added.why, CHANGED);
    assert.ok(fs.existsSync(path.join(dir, 'modules', 'todo', 'trash', 'agent', `${edited.id}.json`)), 'the edit\'s earlier value is held beside the data');
    assert.ok(!fs.existsSync(path.join(dir, 'modules', 'todo', 'trash', 'agent', `${added.id}.json`)), 'an add holds nothing');
    const records = JSON.parse(fs.readFileSync(path.join(dir, 'agent-records.json'), 'utf8'));
    assert.ok(!JSON.stringify(records).includes('taxi'), 'the records hold no content');
    const page = await call('GET', `/api/users/${agent.key}/changes`, { cookie: admin });
    ok(page, 'the agent\'s page');
    assert.equal(page.json.days, 7);
    assert.equal(page.json.changes[0].text, 'Claude (agent) changed the task "Book the big taxi" in To-do, in Camp');
  });

  await test('who: owners, the admin and the space\'s moderators; never a member or the agent', async () => {
    const asMia = await review(miaC);
    ok(asMia, 'a member', 403);
    assert.equal(asMia.json.error, 'Only owners, the admin and this space\'s moderators see what agents changed here.');
    ok(await review(maxC), 'Camp\'s moderator');
    ok(await review(maxC, fort), 'not Fort\'s moderator', 403);
    for (const [method, url] of [['GET', `/api/spaces/${camp}/agent-review`], ['POST', `/api/spaces/${camp}/changes/${edited.id}/undo`], ['GET', `/api/users/${agent.key}/changes`], ['POST', `/api/users/${agent.key}/changes/${edited.id}/undo`], ['GET', `/api/users/${agent.key}/asks`]]) {
      const r = await call(method, url, { ...T, body: method === 'POST' ? {} : undefined });
      assert.equal(r.status, 403, `${method} ${url}: the agent's token`);
    }
    ok(await call('POST', `/api/spaces/${camp}/changes/${edited.id}/undo`, { cookie: miaC, body: {} }), 'a member can\'t undo', 403);
    ok(await call('POST', `/api/spaces/${fort}/changes/${edited.id}/undo`, { cookie: admin, body: {} }), 'not this space\'s change', 404);
  });

  await test('Undo: an edit puts back the held value, once; an add after a later edit is refused; then it removes the object', async () => {
    const r = await call('POST', `/api/spaces/${camp}/changes/${edited.id}/undo`, { cookie: maxC, body: {} });
    ok(r, 'Max undoes the edit');
    assert.equal(r.json.change, 'edited');
    assert.equal((await todo())[`task:${task.id}`].value.title, 'Book the taxi', 'the earlier title is back');
    const twice = await call('POST', `/api/spaces/${camp}/changes/${edited.id}/undo`, { cookie: maxC, body: {} });
    ok(twice, 'twice', 409);
    assert.equal(twice.json.error, UNDONE);
    const add = await call('POST', `/api/users/${agent.key}/changes/${added.id}/undo`, { cookie: admin, body: {} });
    ok(add, 'the add is changed since (the undo wrote it)', 409);
    assert.equal(add.json.error, CHANGED);
    const activity = (await call('GET', '/api/modules/activity', { cookie: admin })).json.activity;
    assert.ok(activity.some((a) => a.module === 'todo' && a.what === 'undid Claude (agent)\'s change' && a.by === max.key), 'named in the activity list');
    // A fresh add, undone: the object goes.
    const fresh = await ask('todo:createTask', { title: 'Pack the tent' });
    ok(fresh, 'createTask');
    const c = (await review(admin)).json.done.find((x) => x.change === 'added' && x.object.id === fresh.json.ref.id);
    assert.equal(c.undoable, true);
    ok(await call('POST', `/api/spaces/${camp}/changes/${c.id}/undo`, { cookie: admin, body: {} }), 'undo the add');
    assert.equal((await todo())[`task:${fresh.json.ref.id}`], undefined, 'gone');
  });

  await test('a page write tied to the agent\'s claimed request is recorded; one with no tie is not', async () => {
    const r = await ask('maps:addPlace', { title: 'Plan the walk' });
    ok(r, 'addPlace waits for a page');
    assert.equal(r.json.status, 'pending');
    const claim = await call('POST', '/api/bus/actions/claim', { cookie: admin, body: { module: 'maps', id: r.json.id, scope: 'space', space: camp } });
    assert.equal(claim.json.ok, true, 'the owner\'s page claims it');
    const value = (title) => ({ title, lat: 38.7, lng: -9.1 });
    const put = (title, extra) => call('PUT', `/api/modules/maps/data/place%3Aw1?scope=space&space=${camp}`, { cookie: admin, body: { value: value(title), ...extra } });
    ok(await put('Plan the walk', { for: agent.key, request: r.json.id }), 'the page creates it for the agent');
    ok(await put('Plan the long walk', { for: agent.key, request: r.json.id }), 'and changes it');
    ok(await put('Plan the walk, mine', {}), 'a write with no tie');
    const done = (await review(admin)).json.done.filter((x) => x.object.module === 'maps');
    assert.deepEqual(done.map((x) => x.change), ['edited', 'added'], 'the tied two only');
    assert.equal(done[0].why, CHANGED, 'the untied write since makes the edit not undoable');
  });

  await test('a person\'s DELETE goes through the shared path and cancels a schedule about the object', async () => {
    const mine = await call('PUT', `/api/modules/todo/data/task%3Ad1?scope=space&space=${camp}`, { cookie: admin, body: { value: { id: 'd1', title: 'Go', due: '2026-12-01', byKey: 'admin', by: 'Admin' } } });
    ok(mine, 'a task');
    const ref = { module: 'todo', kind: 'task', id: 'd1', scope: 'space', space: camp };
    const s = await call('POST', `/api/modules/todo/schedule?scope=space&space=${camp}`, { cookie: admin, body: { key: 'remind:d1', at: Date.now() + DAY, ref } });
    ok(s, 'a schedule about it');
    const schedules = () => JSON.parse(fs.readFileSync(path.join(dir, 'modules', 'schedules.json'), 'utf8'));
    assert.ok(schedules().some((x) => x.key === 'remind:d1'));
    const del = await call('DELETE', `/api/modules/todo/data/task%3Ad1?scope=space&space=${camp}`, { cookie: admin });
    ok(del, 'deleted');
    assert.equal(del.json.deleted, true);
    assert.ok(!schedules().some((x) => x.key === 'remind:d1'), 'its schedule is cancelled');
  });

  await test('records and holds survive a restart; the agent\'s log holds no title; a deleted space takes them', async () => {
    const before = (await review(admin)).json.done.map((c) => c.id);
    await server.stop();
    server = await startServer(dir);
    const admin2 = await signIn('admin', 'admin-password-1');
    assert.deepEqual((await review(admin2)).json.done.map((c) => c.id), before, 'the same list after a restart');
    const logs = path.join(dir, 'agent-log', agent.key);
    const text = fs.readdirSync(logs).map((f) => fs.readFileSync(path.join(logs, f), 'utf8')).join('\n');
    for (const title of ['taxi', 'tent', 'walk']) assert.ok(!text.includes(title), `no "${title}" in the log`);
    const holdsDir = path.join(dir, 'modules', 'maps', 'trash', 'agent');
    assert.ok(fs.readdirSync(holdsDir).length > 0, 'a hold is there');
    ok(await call('DELETE', `/api/spaces/${camp}`, { cookie: admin2 }), 'Camp is deleted');
    assert.equal(fs.readdirSync(holdsDir).filter((f) => f.endsWith('.json')).length, 0, 'its holds went');
    const records = JSON.parse(fs.readFileSync(path.join(dir, 'agent-records.json'), 'utf8'));
    assert.equal(records.changes.filter((c) => c.space === camp).length, 0, 'its records went');
  });
} catch (err) {
  failed += 1;
  console.error(`FAIL setting up\n${err.stack || err}`);
} finally {
  for (const s of servers) await s.stop();
  fs.rmSync(base, { recursive: true, force: true });
}

if (failed) {
  console.error(`check-agent-review: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-agent-review: ${n} passed`);
