#!/usr/bin/env node
/*
 * check-workspaces.mjs -- personal workspaces (documentation/plans/plan-workspaces.md, decisions 39 and 49): each person's
 * own workspaces in a space and the arrangement each keeps, in DATA_DIR/workspaces.json (server/workspaces.js).
 *   GET    /api/spaces/:id/workspaces                           200 { workspaces: [the Workspace, then those added], limits }
 *   POST   /api/spaces/:id/workspaces { name, shape? }          201 { workspace }
 *   PATCH  /api/spaces/:id/workspaces/:workspaceId { name?, shape? }  200 { workspace }
 *   DELETE /api/spaces/:id/workspaces/:workspaceId              204
 *   PUT    /api/spaces/:id/workspaces/:workspaceId/arrangement { arrangement }  200 { id, at, arrangement }
 * In-process: the arrangement check (every key, bad values, the caps), the Workspaces class (round trip, limits, names,
 * hand-edited and odd keys, clean-up when a person or a space goes, an unreadable file), the routes' own refusal of an
 * agent, the environment copy leaving the file out, and the page's toWire/fromWire round trip. Over HTTP, against a
 * throwaway server: every kind of viewer, nobody reads or writes another's, guests, an aside, a closed space, the caps.
 * Every refusal is checked for its status and one plain sentence.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { Workspaces, WorkspaceError, cleanArrangement, mountWorkspaces, WORKSPACE_LIMITS } = require('../server/workspaces.js');
const { exportEntries } = require('../server/environment-export.js');

let n = 0;
const ok = (cond, label) => { assert.ok(cond, label); n += 1; };
const same = (got, want, label) => { assert.deepEqual(got, want, label); n += 1; };
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `check-workspaces-${name}-`));
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const SENTENCE = /^[A-Z"][^\n]*\.$/;

// A full arrangement, as the page writes one.
const FULL = {
  open: ['chat', 'budget', 'dest:calendar'],
  placed: true,
  mode: 'panel',
  snap: { all: false, pitch: 130 },
  stacks: [{ ids: ['budget', 'polls'], width: 360, h: [0.5, null], folded: [false, true], ownW: [null, 300] }],
  modules: {
    budget: { mode: 'dock', dockW: 360, stack: 's1', at: 0, h: 0.5, folded: false, ownW: 320 },
    'dest:calendar': { mode: 'float', box: { x: 10, y: 20, w: 400, h: 300 }, cell: { col: 1, row: 0, cols: 3, rows: 2 }, placed: { x: 0, y: 0, w: 400, h: 300 }, layout: 'user' },
    chat: { mode: 'window', win: { w: 380, h: 520 } },
  },
};

// Over the size cap while inside every other one: 59 full records under the longest ids.
const FAT = { mode: 'float', dockW: 360.123456789, ownW: 320.123456789, box: { x: 1.123456789012345, y: 2.123456789012345, w: 3.123456789012345, h: 4.123456789012345 }, placed: { x: 1.123456789012345, y: 2.123456789012345, w: 3.123456789012345, h: 4.123456789012345 }, win: { w: 1.123456789012345, h: 2.123456789012345 }, cell: { col: 1, row: 2, cols: 3, rows: 4 }, layout: 'user', stack: 's1', at: 0, h: 0.5, folded: false };
const BIG = { modules: Object.fromEntries(Array.from({ length: 59 }, (_, i) => [`m${i}`.padEnd(32, 'x'), FAT])) };

// --- the arrangement check -------------------------------------------------------------------------------------------------
{
  same(cleanArrangement(FULL).arrangement, FULL, 'a full arrangement is kept as sent');
  same(cleanArrangement(null).arrangement, null, 'null forgets it');
  same(cleanArrangement({}).arrangement, {}, 'every key is optional');
  ok(cleanArrangement(FULL).arrangement !== FULL, 'a copy');
  const bad = [
    ['a list', []], ['text', 'x'], ['a number', 3],
    ['an unknown key', { ...FULL, extra: 1 }],
    ['open not a list', { open: 'chat' }], ['open with a bad id', { open: ['Chat!'] }], ['too many open', { open: Array.from({ length: WORKSPACE_LIMITS.open + 1 }, (_, i) => `m${i}`) }],
    ['placed not a boolean', { placed: 1 }], ['an unknown mode', { mode: 'popped' }],
    ['snap not an object', { snap: true }], ['snap with an unknown key', { snap: { all: true, x: 1 } }], ['pitch too small', { snap: { pitch: 10 } }], ['pitch too large', { snap: { pitch: 999 } }], ['all not a boolean', { snap: { all: 'yes' } }],
    ['stacks not a list', { stacks: {} }], ['a stack of one', { stacks: [{ ids: ['a'] }] }], ['a stack of four', { stacks: [{ ids: ['a', 'b', 'c', 'd'] }] }], ['stack h of the wrong length', { stacks: [{ ids: ['a', 'b'], h: [0.5] }] }], ['too many stacks', { stacks: Array.from({ length: WORKSPACE_LIMITS.stacks + 1 }, () => ({ ids: ['a', 'b'] })) }],
    ['modules a list', { modules: [] }], ['a bad module id', { modules: { 'Bad Id': {} } }], ['a record not an object', { modules: { a: 1 } }], ['an unknown record key', { modules: { a: { colour: 'red' } } }],
    ['a bad record mode', { modules: { a: { mode: 'x' } } }], ['dockW negative', { modules: { a: { dockW: -1 } } }], ['dockW huge', { modules: { a: { dockW: 1e9 } } }], ['a box missing h', { modules: { a: { box: { x: 0, y: 0, w: 1 } } } }],
    ['a box with text', { modules: { a: { box: { x: '0', y: 0, w: 1, h: 1 } } } }], ['a cell with a fraction', { modules: { a: { cell: { col: 0.5, row: 0, cols: 1, rows: 1 } } } }], ['a bad layout', { modules: { a: { layout: 'free' } } }],
    ['a bad stack id', { modules: { a: { stack: 'S 1' } } }], ['at 3', { modules: { a: { at: 3 } } }], ['h above 1', { modules: { a: { h: 2 } } }], ['folded not a boolean', { modules: { a: { folded: 'no' } } }], ['win with x', { modules: { a: { win: { w: 1, h: 1, x: 1 } } } }],
    ['too many records', { modules: Object.fromEntries(Array.from({ length: WORKSPACE_LIMITS.modules + 1 }, (_, i) => [`m${i}`, {}])) }],
    ['too large', BIG],
  ];
  for (const [label, value] of bad) {
    const out = cleanArrangement(value);
    ok(typeof out.error === 'string' && SENTENCE.test(out.error) && !('arrangement' in out), `${label}: refused with one sentence (${out.error})`);
  }
  ok(/at most 16 KB/.test(cleanArrangement(bad.at(-1)[1]).error), 'the size cap names the limit');
}

// --- the page's side: toWire and fromWire (public/canvas.js) ----------------------------------------------------------------
{
  const src = fs.readFileSync(path.join(ROOT, 'public', 'canvas.js'), 'utf8');
  const cut = (name) => { const i = src.indexOf(`export function ${name}(`); const j = src.indexOf('\n}\n', i); assert.ok(i >= 0 && j > i, `canvas.js has ${name}`); return src.slice(i, j + 2).replace('export ', ''); };
  const head = ["const WIRE_RECORD = ['mode', 'dockW', 'box', 'cell', 'placed', 'layout', 'stack', 'at', 'h', 'folded', 'ownW', 'win'];", 'const WIRE_ID = /^(dest:)?[a-z][a-z0-9-]{0,31}$/;', 'const WIRE_MODULES = 60;', "const finite = (v) => typeof v === 'number' && Number.isFinite(v);", 'const orNull = (v) => (finite(v) ? v : null);'];
  for (const line of head) ok(src.includes(line), `canvas.js: ${line.slice(0, 40)}...`);
  const { toWire, fromWire } = new Function(`${head.join('\n')}\n${cut('toWire')}\n${cut('fromWire')}\nreturn { toWire, fromWire };`)();
  const saved = { __open: ['chat', 'budget'], __placed: true, __mode: 'window', __snap: { all: true, pitch: 140 }, __stacks: [{ ids: ['budget', 'polls'], width: 300, h: [0.4, 0.6], folded: [false, false], ownW: [null, null] }], budget: { mode: 'dock', dockW: 360, h: NaN, snap: true, was: 'float', box: { x: 1, y: NaN, w: 2, h: 3 } }, 'Not an id': { mode: 'dock' }, __future: 1 };
  const wire = toWire(saved);
  same(wire, { open: ['chat', 'budget'], placed: true, mode: 'window', snap: { all: true, pitch: 140 }, stacks: [{ ids: ['budget', 'polls'], width: 300, h: [0.4, 0.6], folded: [false, false], ownW: [null, null] }], modules: { budget: { mode: 'dock', dockW: 360 } } }, 'toWire keeps known keys and finite numbers only');
  same(cleanArrangement(wire).arrangement, wire, 'what the page sends passes the server\'s check');
  same(fromWire(wire), { __open: ['chat', 'budget'], __placed: true, __mode: 'window', __snap: { all: true, pitch: 140 }, __stacks: wire.stacks, budget: { mode: 'dock', dockW: 360 } }, 'fromWire gives the page its own shape back');
  same(fromWire(null), {}, 'none reads as {}');
  same(toWire(fromWire(FULL)), FULL, 'a round trip loses nothing the server keeps');
  // The page reads and writes through the routes, and keeps nothing in the browser for a signed-in person.
  ok(/api\('GET', `\/api\/spaces\/\$\{encodeURIComponent\(id\)\}\/workspaces`\)/.test(src), 'the page reads its workspaces from the server');
  ok(src.includes('/workspaces/workspace/arrangement`') && /keepalive: true/.test(src), 'and writes the Workspace\'s arrangement, the last change kept as the page goes');
  ok(/if \(guest\) \{\n\s*try \{\n\s*localStorage\.setItem\(GUEST_KEY\(spaceId\)/.test(src) && (src.match(/localStorage\.setItem/g) || []).length === 1, 'only a guest\'s arrangement is kept in the browser');
}

// --- the Workspaces class -----------------------------------------------------------------------------------------------------
{
  const dir = tmp('class');
  const file = path.join(dir, 'workspaces.json');
  const ws = new Workspaces(dir);
  same(ws.list('s1', 'pat'), [{ id: 'workspace', at: 0, arrangement: null }], 'the Workspace is always there, unarranged at first');
  ok(!fs.existsSync(file), 'reading writes nothing');
  const a = ws.add('s1', 'pat', { name: 'Planning', shape: { shape: 'one', areas: [null] } });
  ok(/^w[a-z0-9]{6}$/.test(a.id) && a.name === 'Planning' && a.arrangement === null && a.at > 1e12, 'added: an id, the name, no arrangement yet, `at` by the server');
  assert.throws(() => ws.add('s1', 'pat', { name: 'planning' }), (e) => e instanceof WorkspaceError && e.status === 409 && SENTENCE.test(e.message)); n += 1;
  same(ws.list('s1', 'sam').length, 1, "another person sees none of pat's");
  ws.arrange('s1', 'pat', 'workspace', FULL);
  ws.arrange('s1', 'pat', a.id, { open: ['budget'] });
  const back = new Workspaces(dir).list('s1', 'pat');
  same(back.map((w) => [w.id, w.arrangement]), [['workspace', FULL], [a.id, { open: ['budget'] }]], 'each workspace keeps its own arrangement, read back by a new instance');
  assert.throws(() => ws.arrange('s1', 'pat', 'wnosuch', {}), (e) => e.status === 404); n += 1;
  assert.throws(() => ws.arrange('s1', 'sam', a.id, {}), (e) => e.status === 404); n += 1; // not sam's
  same(ws.change('s1', 'pat', a.id, { name: 'Plans' }).name, 'Plans', 'renamed');
  assert.throws(() => ws.change('s1', 'pat', 'workspace', { name: 'X' }), (e) => e.status === 404); n += 1;
  for (let i = 1; i < WORKSPACE_LIMITS.added; i++) ws.add('s1', 'pat', { name: `W${i}` });
  assert.throws(() => ws.add('s1', 'pat', { name: 'One more' }), (e) => e.status === 409 && /at most 10/.test(e.message)); n += 1;
  ws.remove('s1', 'pat', a.id);
  ok(!ws.find('s1', 'pat', a.id), 'deleted');
  assert.throws(() => ws.remove('s1', 'pat', 'workspace'), (e) => e.status === 404); n += 1;
  ws.arrange('s1', 'pat', 'workspace', null);
  same(ws.find('s1', 'pat', 'workspace').arrangement, null, 'the Workspace\'s arrangement forgotten');
  ok(!readJson(file).spaces.s1.pat.some((w) => w.id === 'workspace'), 'and its record dropped');
  ws.arrange('s2', 'pat', 'workspace', {});
  ws.arrange('s2', 'bob', 'workspace', {});
  ws.forgetPerson('pat');
  same(Object.keys(readJson(file).spaces), ['s2'], 'a removed person takes theirs in every space');
  ws.forgetSpace('s2');
  same(readJson(file), { spaces: {} }, 'a removed space takes the rest');
  // Hand-edited, odd keys and junk: dropped on read, never a crash.
  fs.writeFileSync(file, JSON.stringify({ spaces: { s3: { constructor: [{ id: 'workspace', at: 1, arrangement: { placed: true } }], toString: 'junk', pat: [{ id: 'wabcdef', name: '', shape: null }, { id: 'wabcdeg', name: 'Ok', shape: null, arrangement: { bad: 1 } }, { id: 'nope', name: 'X' }, { id: 'wabcdeh', name: 'Kept', shape: { shape: 'nosuch' } }, { id: 'wabcdei', name: 'Good', shape: null, at: 5 }, { id: 'wabcdei', name: 'Twice' }] }, __proto__: { x: [] } } }));
  const odd = new Workspaces(dir);
  same(odd.list('s3', 'constructor')[0].arrangement, { placed: true }, 'a key named constructor is just a person');
  same(odd.list('s3', 'toString'), [{ id: 'workspace', at: 0, arrangement: null }], 'junk reads as none');
  same(odd.list('s3', 'pat').map((w) => w.id), ['workspace', 'wabcdei'], 'a nameless, malformed, unknown-shaped or repeated workspace is dropped');
  same(odd.list('s3', 'hasOwnProperty').length, 1, 'any key name reads');
  fs.writeFileSync(file, '{not json');
  const broken = new Workspaces(dir);
  assert.throws(() => broken.arrange('s1', 'pat', 'workspace', {}), (e) => e instanceof WorkspaceError && e.status === 500); n += 1;
  same(fs.readFileSync(file, 'utf8'), '{not json', 'an unreadable file is never written over');
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- the environment copy leaves the file out ----------------------------------------------------------------------------------
{
  const entries = exportEntries([['workspaces.json', Buffer.from('{"spaces":{}}')], ['layouts.json', Buffer.from('{"spaces":{}}')]], { settings: {}, users: [], spaces: [] });
  ok(!entries.some(([name]) => name === 'workspaces.json'), "personal workspaces are not in an owner's copy");
}

// --- the routes refuse an agent themselves (the agent gate refuses it first in a running server) ------------------------------
{
  const routes = [];
  const app = Object.fromEntries(['get', 'post', 'patch', 'delete', 'put'].map((m) => [m, (p, h) => routes.push({ m, p, h })]));
  mountWorkspaces(app, { store: () => ({}), spaceFor: () => ({ who: { user: { key: 'a1', agent: true } }, space: { id: 's1' } }), shapeOptions: () => ({}), word: (k, o) => (o?.many ? `${o.cap ? k[0].toUpperCase() + k.slice(1) : k}s` : k) });
  same(routes.map((r) => `${r.m.toUpperCase()} ${r.p}`), ['GET /api/spaces/:id/workspaces', 'POST /api/spaces/:id/workspaces', 'PATCH /api/spaces/:id/workspaces/:workspaceId', 'DELETE /api/spaces/:id/workspaces/:workspaceId', 'PUT /api/spaces/:id/workspaces/:workspaceId/arrangement'], 'the five routes, in order');
  for (const r of routes) {
    let status = 0; let body = null;
    const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; }, end() { return this; } };
    r.h({ params: { id: 's1', workspaceId: 'workspace' }, body: {} }, res);
    same([status, body.error], [403, "Agents don't keep workspaces of their own."], `${r.m} refuses an agent`);
  }
}

// --- the routes, against a throwaway server ------------------------------------------------------------------------------------
const dir = tmp('server');
const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  cwd: ROOT,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dir, ADMIN_PASSWORD: 'testpass1234', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ENABLE_GUEST_DOOR: 'true' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
const stop = () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
try {
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 25000);
    const onData = (d) => { out += d; const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
  const call = async (method, urlPath, { body, token, cookie } = {}) => {
    const headers = { accept: 'application/json' };
    let payload;
    if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    if (token) headers.authorization = `Bearer ${token}`;
    if (cookie) headers.cookie = cookie;
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body: payload });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
  };
  const expect = async (label, status, method, urlPath, options) => {
    const r = await call(method, urlPath, options);
    assert.equal(r.status, status, `${label}: ${method} ${urlPath} answered ${r.status} ${r.text}`);
    if (status >= 400) assert.match(r.json?.error || '', SENTENCE, `${label}: one plain sentence (${r.text})`);
    n += 1;
    return r;
  };
  const admin = (await call('POST', '/api/login', { body: { login: 'admin', password: 'testpass1234' } })).json.token;
  const mk = async (login, role = 'member') => (await expect(`make ${login}`, 201, 'POST', '/api/users', { token: admin, body: { login, displayName: login, role, password: 'memberpass1234' } })).json.user.key;
  const keys = { owner: await mk('olive', 'owner'), mod: await mk('mona'), member: await mk('mia'), other: await mk('otto') };
  const A = (await expect('space Alpha', 200, 'POST', '/api/spaces', { token: admin, body: { name: 'Alpha', members: [keys.mod, keys.member] } })).json.space.id;
  await expect('members', 200, 'PATCH', `/api/spaces/${A}`, { token: admin, body: { members: [keys.mod, keys.member], entry: 'guests' } });
  await expect('mona moderates Alpha', 200, 'PATCH', `/api/users/${keys.mod}/spaces/${A}`, { token: admin, body: { permissions: { moderator: true } } });
  const T = { admin };
  for (const [who, login] of [['owner', 'olive'], ['mod', 'mona'], ['member', 'mia'], ['other', 'otto']]) T[who] = (await call('POST', '/api/login', { body: { login, password: 'memberpass1234' } })).json.token;
  const link = (await expect('guest link', 200, 'POST', `/api/spaces/${A}/guest-link`, { token: admin, body: {} })).json.space.guestToken;
  const doorCookie = (await expect('door guest', 201, 'POST', '/api/guest-door', { body: { name: 'Sam' } })).cookie;
  const W = (id = A) => `/api/spaces/${id}/workspaces`;
  const ARR = (wid, id = A) => `${W(id)}/${wid}/arrangement`;
  const file = path.join(dir, 'workspaces.json');
  const stored = () => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');

  // Every person in the space keeps their own.
  for (const who of ['admin', 'owner', 'mod', 'member']) {
    const r = await expect(`${who} reads theirs`, 200, 'GET', W(), { token: T[who] });
    same(r.json, { workspaces: [{ id: 'workspace', at: 0, arrangement: null }], limits: { added: 10, name: 40 } }, `${who}: the Workspace, unarranged`);
    const put = await expect(`${who} arranges the Workspace`, 200, 'PUT', ARR('workspace'), { token: T[who], body: { arrangement: { open: [who === 'mod' ? 'polls' : 'chat'], placed: true } } });
    ok(put.json.id === 'workspace' && put.json.at > 1e12, `${who}: 200 { id, at, arrangement }`);
  }
  same((await call('GET', W(), { token: T.mod })).json.workspaces[0].arrangement, { open: ['polls'], placed: true }, 'each reads back their own');
  same((await call('GET', W(), { token: T.member })).json.workspaces[0].arrangement, { open: ['chat'], placed: true }, "and nobody else's");
  const mine = (await expect('the member adds one', 201, 'POST', W(), { token: T.member, body: { name: '  Planning   desk ', shape: { shape: 'one', areas: [null] } } })).json.workspace;
  same([mine.name, mine.shape, mine.arrangement], ['Planning desk', { shape: 'one', areas: [null] }, null], 'the name cleaned, the shape kept, no arrangement yet');
  await expect('arranged', 200, 'PUT', ARR(mine.id), { token: T.member, body: { arrangement: FULL } });
  same((await call('GET', W(), { token: T.member })).json.workspaces.map((w) => w.id), ['workspace', mine.id], 'the Workspace first, then those added');
  ok(!(await call('GET', W(), { token: T.mod })).text.includes(mine.id), "another person never sees it");
  await expect("the moderator can't arrange the member's", 404, 'PUT', ARR(mine.id), { token: T.mod, body: { arrangement: {} } });
  await expect("nor rename it", 404, 'PATCH', `${W()}/${mine.id}`, { token: T.mod, body: { name: 'Mine now' } });
  await expect("nor delete it", 404, 'DELETE', `${W()}/${mine.id}`, { token: T.owner });
  await expect('renamed', 200, 'PATCH', `${W()}/${mine.id}`, { token: T.member, body: { name: 'Desk' } });
  await expect('a free canvas', 200, 'PATCH', `${W()}/${mine.id}`, { token: T.member, body: { shape: null } });
  // Refusals, each with its status and one sentence, nothing changed.
  const before = stored();
  for (const [label, status, method, url, body, token = T.member] of [
    ['no name', 400, 'POST', W(), { shape: null }], ['a long name', 400, 'POST', W(), { name: 'x'.repeat(41) }], ['an unknown key', 400, 'POST', W(), { name: 'X', colour: 'red' }],
    ['a name taken', 409, 'POST', W(), { name: 'desk' }], ['an unknown shape', 400, 'POST', W(), { name: 'Y', shape: { shape: 'nosuch', areas: [] } }],
    ['a module that is not on here', 400, 'POST', W(), { name: 'Y', shape: { shape: 'one', areas: ['nosuchmodule'] } }],
    ['rename the Workspace', 403, 'PATCH', `${W()}/workspace`, { name: 'Mine' }], ['delete the Workspace', 403, 'DELETE', `${W()}/workspace`, undefined],
    ['patch nothing', 400, 'PATCH', `${W()}/${mine.id}`, {}], ['patch a bad name', 400, 'PATCH', `${W()}/${mine.id}`, { name: ' ' }],
    ['no such workspace', 404, 'PATCH', `${W()}/wzzzzzz`, { name: 'X' }], ['delete no such', 404, 'DELETE', `${W()}/wzzzzzz`, undefined],
    ['arrange no such', 404, 'PUT', ARR('wzzzzzz'), { arrangement: {} }], ['arrange without the key', 400, 'PUT', ARR('workspace'), { open: [] }],
    ['arrange with more keys', 400, 'PUT', ARR('workspace'), { arrangement: {}, other: 1 }], ['a bad arrangement', 400, 'PUT', ARR('workspace'), { arrangement: { mode: 'popped' } }],
    ['too large an arrangement', 400, 'PUT', ARR('workspace'), { arrangement: BIG }],
    ['someone outside the space', 403, 'GET', W(), undefined, T.other], ['someone outside writes', 403, 'PUT', ARR('workspace'), { arrangement: {} }, T.other],
    ['nobody signed in', 401, 'GET', W(), undefined, null], ['an aside id', 404, 'GET', W('zzzz9999'), undefined], ['a space that is not there', 404, 'PUT', ARR('workspace', 'nosuchsp'), { arrangement: {} }],
  ]) await expect(label, status, method, url, { body, token: token || undefined });
  same(stored(), before, 'none of them changed anything');
  // Guests keep none.
  for (const [who, url, opts] of [['a guest link', `${W()}?guest=${encodeURIComponent(link)}`, {}], ['a door guest', `${W()}?space=${A}`, { cookie: doorCookie }]]) {
    const r = await expect(`${who} reads`, 403, 'GET', url, opts);
    same(r.json.error, "Guests don't keep workspaces of their own.", `${who}: the sentence`);
    await expect(`${who} writes`, 403, 'PUT', url.replace('/workspaces', '/workspaces/workspace/arrangement'), { ...opts, body: { arrangement: {} } });
    await expect(`${who} adds`, 403, 'POST', url, { ...opts, body: { name: 'X' } });
  }
  // The cap on added workspaces.
  for (let i = 1; i < 10; i++) await expect(`add ${i}`, 201, 'POST', W(), { token: T.owner, body: { name: `W${i}` } });
  await expect('the tenth', 201, 'POST', W(), { token: T.owner, body: { name: 'W10' } });
  const capped = await expect('one past the cap', 409, 'POST', W(), { token: T.owner, body: { name: 'W11' } });
  same(capped.json.error, 'You can add at most 10 workspaces here; delete one first.', 'the cap sentence');
  // A closed space: the people it is closed to are refused as on every layouts route; its moderator still reaches theirs.
  await expect('close Alpha', 200, 'PATCH', `/api/spaces/${A}`, { token: T.mod, body: { closed: true } });
  const closedBefore = stored();
  const r = await call('PUT', ARR('workspace'), { token: T.member, body: { arrangement: { placed: false } } });
  ok((r.status === 403 || r.status === 404) && SENTENCE.test(r.json?.error || ''), `a member of a closed space is refused (${r.status} ${r.json?.error})`);
  same(stored(), closedBefore, 'and nothing changed');
  await expect('its moderator still reaches theirs', 200, 'GET', W(), { token: T.mod });
  await expect('reopen', 200, 'PATCH', `/api/spaces/${A}`, { token: T.mod, body: { closed: false } });
  // Removing a person and a space takes theirs.
  await expect('remove the member', 200, 'DELETE', `/api/users/${keys.member}`, { token: admin }).catch(async () => expect('remove the member', 204, 'DELETE', `/api/users/${keys.member}`, { token: admin }));
  ok(!stored().includes(keys.member), "the removed person's workspaces are gone");
  const del = await call('DELETE', `/api/spaces/${A}`, { token: admin });
  ok(del.status === 200 || del.status === 204, `the space deleted (${del.status})`);
  ok(!stored().includes(`"${A}"`), "and the space's workspaces with it");
  // Small: about the arrangement's size per workspace, and no history.
  ok(stored().length < 4096, 'the file stays small');
} finally {
  await stop();
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`check-workspaces: OK (${n} checks)`);
