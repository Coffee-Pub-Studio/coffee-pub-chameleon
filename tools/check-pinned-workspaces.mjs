#!/usr/bin/env node
/*
 * check-pinned-workspaces.mjs -- Workspaces, the server half (documentation/plans/plan-templates-redesign.md, step 8;
 * decisions 8, 9 and 36):
 *   1. The Default Workspace is the template's. A space keeps no layout of its own, and what it starts with is read live from its template (store.layoutOf, `layout` on
 *      GET /api/modules/for-space and on a first visit); a template that is deleted or switched changes it at once.
 *   2. A new space's tabs and first visit are seeded from its template's `workspace.show` and `opensFirst` (the
 *      environment's template when the space has none of its own), then the owner owns them.
 *   3. The pin rule. A Fixed Workspace the owner shows is pinned: `pinned` is true on the system layouts, and nobody
 *      hides it for themselves, by any route (PATCH .../layouts/system/:id, DELETE .../layouts/:id/favorite, whoever
 *      asks: a member, a moderator), 409 "The owner keeps this one in the bar."; a stored hide is ignored and never
 *      rewritten; the Workspace is always shown; the owner's own hide still wins and says its own sentence; a pin
 *      survives a template switch and a deleted template; a guest has no layouts to hide.
 *   4. Last layout: a pinned-away (hidden by the owner) layout is passed over, the record stays, and it comes back.
 * Part 1 runs in-process; part 2 against throwaway servers.
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
const { Store } = require('../server/store.js');
const templates = require('../server/templates.js');

let n = 0;
const same = (got, want, label) => { assert.deepEqual(got, want, label); n += 1; };
const ok = (cond, label) => { assert.ok(cond, label); n += 1; };
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `check-pinned-${name}-`));
const PINNED = 'The owner keeps this one in the bar.';
const TAKE_OUT = 'To take this one out of the bar, hide it for everyone in Set up.';

// --- part 1: the store -----------------------------------------------------------------------------------------------
{
  const dir = tmp('store');
  const store = new Store(dir);
  const custom = {
    shows: templates.cleanTemplate({ id: 'shows', name: 'Shows', description: 'x', modules: { chat: {}, calendar: {} }, workspace: { layout: { shape: 'two-equal', areas: ['calendar', null] }, show: ['calendar', 'documents'], opensFirst: 'documents' } }),
    away: templates.cleanTemplate({ id: 'away', name: 'Away', description: 'x', modules: { chat: {} }, workspace: { show: ['calendar'], opensFirst: 'map' } }),
    plain: templates.cleanTemplate({ id: 'plain', name: 'Plain', description: 'x', modules: { chat: {} } }),
    first: templates.cleanTemplate({ id: 'first', name: 'First', description: 'x', modules: { chat: {} }, workspace: { opensFirst: 'conference' } }),
    none: templates.cleanTemplate({ id: 'none', name: 'None', description: 'x', modules: { chat: {} }, workspace: { show: [], opensFirst: 'workspace' } }),
  };
  store.templateById = (id) => custom[id] || templates.get(id) || null;

  // The seed, pure.
  same(store.workspaceSeed(undefined), { tabs: null, defaultLayout: null }, 'nothing given: nothing seeded');
  same(store.workspaceSeed({}), { tabs: null, defaultLayout: null }, 'an empty workspace: nothing seeded');
  same(store.workspaceSeed(custom.shows.workspace), { tabs: { hide: ['map', 'conference', 'whiteboard'] }, defaultLayout: 'documents' }, 'show names the bar; every other fixed one is hidden');
  same(store.workspaceSeed(custom.away.workspace), { tabs: { hide: ['map', 'conference', 'whiteboard', 'documents'] }.hide && { hide: ['map', 'conference', 'whiteboard', 'documents'] }, defaultLayout: null }, 'opens-first a hidden tab is not taken');
  same(store.workspaceSeed(custom.first.workspace), { tabs: null, defaultLayout: 'conference' }, 'opensFirst alone: the bar is the default');
  same(store.workspaceSeed(custom.none.workspace).defaultLayout, null, 'the Workspace is no default layout');
  same(store.workspaceSeed(custom.none.workspace).tabs, { hide: ['calendar', 'map', 'conference', 'whiteboard', 'documents'] }, 'an empty show hides every fixed one but never the Workspace');
  same(store.workspaceSeed({ show: ['workspace', 'nope', 'map'], opensFirst: 'nope' }), { tabs: { hide: ['calendar', 'conference', 'whiteboard', 'documents'] }, defaultLayout: null }, 'unknown ids and the Workspace are ignored');
  same(store.workspaceSeed('x'), { tabs: null, defaultLayout: null }, 'not an object');

  // A new space.
  const g = store.addSpace({ name: 'G', template: 'shows' });
  same([g.tabs, g.defaultLayout], [{ hide: ['map', 'conference', 'whiteboard'] }, 'documents'], 'seeded from its own template');
  ok(!('layout' in g) && !('opensWith' in g), 'no layout on the record');
  same(store.layoutOf(g.id), { shape: 'two-equal', areas: ['calendar', null] }, 'the layout is read from the template');
  same(store.lookOf(g.id).workspace, custom.shows.workspace, 'lookOf carries the workspace');
  const plain = store.addSpace({ name: 'P', template: 'plain' });
  ok(!('tabs' in plain) && !('defaultLayout' in plain), 'a template that gives no show seeds nothing');
  same(store.layoutOf(plain.id), null, 'and opens as the product does');

  // The owner owns them after: a template switch changes what it opens with, never the tabs.
  const switched = store.updateSpace(g.id, { template: 'plain' });
  same([switched.tabs, switched.defaultLayout], [{ hide: ['map', 'conference', 'whiteboard'] }, 'documents'], 'a template switch leaves the owner\'s tabs and first visit');
  same(store.layoutOf(g.id), null, 'the new template decides what it starts with, at once');
  store.updateSpace(g.id, { template: 'shows' });
  custom.shows = { ...custom.shows, workspace: { ...custom.shows.workspace, layout: { shape: 'one', areas: ['calendar'] }, show: ['map'] } };
  same(store.layoutOf(g.id), { shape: 'one', areas: ['calendar'] }, 'an edited template is read at once');
  same(store.spaceById(g.id).tabs, { hide: ['map', 'conference', 'whiteboard'] }, 'and the seeded tabs are not re-seeded');
  delete custom.shows;
  store.templateById = (id) => custom[id] || templates.get(id) || null; // a new lookup, so the catalog is read again
  same([store.layoutOf(g.id), store.spaceById(g.id).tabs], [null, { hide: ['map', 'conference', 'whiteboard'] }], 'a deleted template: the environment\'s, and the tabs stay');

  // The environment's template seeds a space with none of its own.
  const env = new Store(tmp('env'));
  env.templateById = (id) => ({ shows: templates.cleanTemplate({ id: 'shows', name: 'Shows', description: 'x', modules: { chat: {} }, workspace: { show: ['calendar'], opensFirst: 'calendar', layout: { shape: 'one', areas: [null] } } }) })[id] || templates.get(id) || null;
  templates.useLive(env, env.templateById('shows'));
  const e = env.addSpace({ name: 'E' });
  same([e.tabs, e.defaultLayout, env.layoutOf(e.id)], [{ hide: ['map', 'conference', 'whiteboard', 'documents'] }, 'calendar', { shape: 'one', areas: [null] }], 'the environment\'s template seeds a space with none of its own');

  // A stray opensWith on a stored space is not read; the environment's settings take no layout or opensWith.
  ok(!('opensWith' in store.sanitizeSpace({ id: 'abcd', name: 'x', members: [], opensWith: ['chat'] })), 'a stray key on a stored space is not read');
  assert.throws(() => store.updateSettings({ spaceDefaults: { layout: { shape: 'one', areas: [null] } } }), (err) => /takes only profile/.test(err.message));
  n += 1;
}

// --- part 2: the routes ----------------------------------------------------------------------------------------------
const servers = [];
async function startServer(dir) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dir, ADMIN_PASSWORD: 'testpass1234', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 25000);
    const onData = (d) => { out += d; const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
  const srv = { child, dir, port };
  srv.call = async (method, urlPath, { body, token } = {}) => {
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
  srv.expect = async (label, status, method, urlPath, options) => {
    const r = await srv.call(method, urlPath, options);
    assert.equal(r.status, status, `${label}: ${method} ${urlPath} answered ${r.status} ${r.text}`);
    n += 1;
    return r;
  };
  servers.push(srv);
  return srv;
}
const stop = (srv) => new Promise((resolve) => { if (srv.child.exitCode !== null) return resolve(); srv.child.once('exit', resolve); srv.child.kill('SIGTERM'); });

const dir = tmp('server');
try {
  let srv = await startServer(dir);
  let { call, expect } = srv;
  const admin = (await call('POST', '/api/login', { body: { login: 'admin', password: 'testpass1234' } })).json.token;
  for (const m of ['calendar', 'whiteboard', 'documents']) {
    await expect(`${m} installs`, 201, 'POST', `/api/modules/bundled/${m}/install`, { token: admin, body: {} });
    await expect(`${m} turns on`, 200, 'PATCH', `/api/modules/${m}`, { token: admin, body: { enabled: true } });
  }
  const mk = async (login) => (await expect(`make ${login}`, 201, 'POST', '/api/users', { token: admin, body: { login, displayName: login, role: 'member', password: 'memberpass1234' } })).json.user.key;
  const keys = { mod: await mk('mona'), member: await mk('mia'), other: await mk('otto') };
  // An owner's own template that shows two Fixed Workspaces and opens the second first.
  await expect('copy a template', 201, 'POST', '/api/environment/templates', { token: admin, body: { from: 'default', id: 'mine', name: 'Mine' } });
  await expect('set its Default Workspace', 200, 'PATCH', '/api/environment/templates/mine', { token: admin, body: { workspace: { layout: { shape: 'one', areas: ['calendar'] }, show: ['calendar', 'documents'], opensFirst: 'documents' } } });
  const A = (await expect('space A', 200, 'POST', '/api/spaces', { token: admin, body: { name: 'Alpha', members: [keys.mod, keys.member], template: 'mine' } })).json.space;
  const B = (await expect('space B', 200, 'POST', '/api/spaces', { token: admin, body: { name: 'Beta', members: [keys.mod, keys.member] } })).json.space;
  const C = (await expect('space C', 200, 'POST', '/api/spaces', { token: admin, body: { name: 'Gamma', members: [keys.member] } })).json.space;
  await expect('mona moderates Alpha', 200, 'PATCH', `/api/users/${keys.mod}/spaces/${A.id}`, { token: admin, body: { permissions: { moderator: true } } });
  await expect('mona moderates Beta', 200, 'PATCH', `/api/users/${keys.mod}/spaces/${B.id}`, { token: admin, body: { permissions: { moderator: true } } });
  const T = { admin };
  for (const [who, login] of [['mod', 'mona'], ['member', 'mia'], ['other', 'otto']]) T[who] = (await call('POST', '/api/login', { body: { login, password: 'memberpass1234' } })).json.token;
  const L = (id) => `/api/spaces/${id}/layouts`;
  const SYS = (id, layout) => `${L(id)}/system/${layout}`;
  const sysOf = async (id, token) => Object.fromEntries((await expect('read', 200, 'GET', L(id), { token })).json.system.map((l) => [l.id, l]));

  // -- 2. the seed, through the routes
  same([A.tabs, A.defaultLayout], [{ hide: ['map', 'conference', 'whiteboard'] }, 'documents'], 'the record the route answers carries the seed');
  ok(!('tabs' in B) && !('defaultLayout' in B), 'a space with no template and an environment with no show seeds nothing');
  let seen = await sysOf(A.id, T.member);
  same(Object.keys(seen), ['workspace', 'calendar', 'conference', 'whiteboard', 'documents'], 'the member lists what is on here');
  same(Object.values(seen).map((l) => [l.id, l.shown, l.pinned, l.tab]), [['workspace', true, true, true], ['calendar', true, true, true], ['conference', false, false, false], ['whiteboard', false, false, false], ['documents', true, true, true]], 'shown ones are pinned and in the bar; hidden ones are neither');
  same((await expect('first visit', 200, 'GET', L(A.id), { token: T.member })).json.firstVisit, { layout: 'documents', shape: { shape: 'one', areas: ['calendar'] } }, 'opens first on the template\'s choice, with its layout');
  same((await expect('for-space', 200, 'GET', `/api/modules/for-space?space=${A.id}`, { token: T.member })).json.layout, { shape: 'one', areas: ['calendar'] }, 'for-space says what the template starts with');
  same((await expect('look', 200, 'GET', `/api/spaces/${A.id}/look`, { token: T.member })).json.look.workspace, { layout: { shape: 'one', areas: ['calendar'] }, show: ['calendar', 'documents'], opensFirst: 'documents' }, 'look carries the Default Workspace');
  same((await expect('look of B', 200, 'GET', `/api/spaces/${B.id}/look`, { token: T.member })).json.look.workspace, { layout: { shape: 'one', areas: [null] } }, 'the Default template\'s own layout');
  // A layout is the template's, never the space's: the owner's request changes nothing, and no one else may send it.
  for (const [who, status] of [['admin', 200], ['mod', 403], ['member', 403], ['other', 404]]) {
    const r = await call('PATCH', `/api/spaces/${A.id}`, { token: T[who], body: { layout: { shape: 'one', areas: [null] } } });
    ok(r.status === status && !('layout' in (r.json.space || {})), `${who}: a layout sent to the space is not kept (${r.status} ${r.text})`);
  }

  // -- 3. the pin rule: every route a person has to hide a tab
  seen = await sysOf(B.id, T.member);
  same(Object.values(seen).map((l) => [l.id, l.pinned]), [['workspace', true], ['calendar', true], ['conference', true], ['whiteboard', true], ['documents', true]], 'with nothing hidden, every fixed one is pinned');
  for (const who of ['member', 'mod']) {
    for (const id of ['calendar', 'conference', 'whiteboard', 'documents']) {
      const want = who === 'mod' ? TAKE_OUT : PINNED; // those who set the bar are told where; a member is told who keeps it
      const r = await expect(`${who} hides ${id}`, 409, 'PATCH', SYS(B.id, id), { token: T[who], body: { tab: false } });
      assert.equal(r.json.error, want);
      const f = await expect(`${who} unfavorites ${id}`, 409, 'DELETE', `${L(B.id)}/${id}/favorite`, { token: T[who] });
      assert.equal(f.json.error, want);
    }
  }
  // The same refusal with other fields beside it: nothing is written (the name stays), and a malformed tab is a plain 400.
  await expect('hide with a rename', 409, 'PATCH', SYS(B.id, 'calendar'), { token: T.member, body: { tab: false, name: 'Sneaky' } });
  same((await sysOf(B.id, T.member)).calendar.name, 'Calendar', 'a refusal changes nothing');
  for (const bad of ['false', 0, null, [false]]) await expect(`tab ${JSON.stringify(bad)}`, 400, 'PATCH', SYS(B.id, 'calendar'), { token: T.member, body: { tab: bad } });
  same((await sysOf(B.id, T.member)).calendar.pinned, true, 'and it is still pinned');
  assert.equal((await expect('the admin hides one', 409, 'PATCH', SYS(B.id, 'calendar'), { token: admin, body: { tab: false } })).json.error, TAKE_OUT, 'the admin is told where');
  const w = await expect('hide the Workspace', 400, 'PATCH', SYS(B.id, 'workspace'), { token: T.member, body: { tab: false } });
  assert.equal(w.json.error, 'The Workspace is always shown.');
  await expect('unfavorite the Workspace', 400, 'DELETE', `${L(B.id)}/workspace/favorite`, { token: T.member });
  // Turning one on is harmless (it is on).
  same((await expect('tab on', 200, 'PATCH', SYS(B.id, 'calendar'), { token: T.member, body: { tab: true } })).json.layout.tab, true, 'tab true on a pinned one is a 200 that changes nothing');
  await expect('favorite', 200, 'PUT', `${L(B.id)}/calendar/favorite`, { token: T.member });
  // Renames and icons stay the person's own.
  same((await expect('rename', 200, 'PATCH', SYS(B.id, 'calendar'), { token: T.member, body: { name: 'Plans' } })).json.layout.name, 'Plans', 'a person still renames a pinned tab');
  // A space the person is not in, and a guest.
  await expect('someone outside', 404, 'PATCH', SYS(C.id, 'calendar'), { token: T.other, body: { tab: false } });
  await expect('no one signed in', 401, 'PATCH', SYS(B.id, 'calendar'), { body: { tab: false } });
  const link = (await expect('guest link', 200, 'POST', `/api/spaces/${B.id}/guest-link`, { token: admin, body: {} })).json.space.guestToken;
  const asGuest = `?guest=${encodeURIComponent(link)}`;
  await expect('a guest hides one', 403, 'PATCH', `${SYS(B.id, 'calendar')}${asGuest}`, { body: { tab: false } });
  await expect('a guest unfavorites one', 403, 'DELETE', `${L(B.id)}/calendar/favorite${asGuest}`);
  same((await expect('a guest reads', 200, 'GET', `${L(B.id)}${asGuest}`)).json.system, [], 'a guest has no layouts to hide');

  // The owner's own hide wins and says its own sentence; showing it again pins it again.
  await expect('owner hides Documents', 200, 'PATCH', `/api/spaces/${B.id}`, { token: T.mod, body: { tabs: { hide: ['documents'] } } });
  same([(await sysOf(B.id, T.member)).documents.pinned, (await sysOf(B.id, T.member)).documents.tab], [false, false], 'hidden by the owner: not pinned, not in the bar');
  assert.equal((await expect('person hides what the owner hid', 409, 'PATCH', SYS(B.id, 'documents'), { token: T.member, body: { tab: false } })).json.error, 'The owner has hidden this layout.');
  await expect('owner shows it again', 200, 'PATCH', `/api/spaces/${B.id}`, { token: T.mod, body: { tabs: null } });
  same((await sysOf(B.id, T.member)).documents.pinned, true, 'shown again, pinned again');

  // -- a first visit never opens a Fixed Workspace the owner hid
  await expect('owner sets Documents first', 200, 'PATCH', `/api/spaces/${B.id}`, { token: admin, body: { defaultLayout: 'documents' } });
  same((await expect('first visit', 200, 'GET', L(B.id), { token: T.member })).json.firstVisit.layout, 'documents', 'shown: it opens first');
  await expect('owner hides Documents', 200, 'PATCH', `/api/spaces/${B.id}`, { token: admin, body: { tabs: { hide: ['documents'] } } });
  same((await expect('first visit', 200, 'GET', L(B.id), { token: T.member })).json.firstVisit.layout, 'workspace', 'hidden: the Workspace');
  same((await expect('for-space', 200, 'GET', `/api/modules/for-space?space=${B.id}`, { token: T.member })).json.firstVisit.layout, 'workspace', 'for-space says the same');
  await expect('owner clears them', 200, 'PATCH', `/api/spaces/${B.id}`, { token: admin, body: { tabs: null, defaultLayout: null } });

  // -- the pin survives a template switch and a deleted template
  await expect('switch Alpha to another template', 200, 'PATCH', `/api/spaces/${A.id}`, { token: admin, body: { template: 'default' } });
  seen = await sysOf(A.id, T.member);
  same([seen.calendar.pinned, seen.documents.pinned, seen.conference.pinned], [true, true, false], 'a template switch keeps the owner\'s bar');
  await expect('switch back', 200, 'PATCH', `/api/spaces/${A.id}`, { token: admin, body: { template: 'mine' } });
  const gone = await expect('delete the template', 200, 'DELETE', '/api/environment/templates/mine', { token: admin });
  same(gone.json.spaces, ['Alpha'], 'the answer names the space that moved');
  seen = await sysOf(A.id, T.member);
  same([seen.calendar.pinned, seen.documents.pinned, seen.conference.pinned, seen.conference.shown], [true, true, false, false], 'a deleted template keeps the owner\'s bar');
  await expect('a pinned one is still refused', 409, 'PATCH', SYS(A.id, 'calendar'), { token: T.member, body: { tab: false } });
  same((await expect('for-space', 200, 'GET', `/api/modules/for-space?space=${A.id}`, { token: T.member })).json.layout, { shape: 'one', areas: [null] }, 'and it starts as the environment\'s template says (the Default\'s)');

  // -- 4. last layout: a layout the owner hides is passed over, kept, and comes back
  await expect('member sets last', 200, 'PUT', `/api/spaces/${B.id}/last-layout`, { token: T.member, body: { layout: 'whiteboard' } });
  same((await expect('read', 200, 'GET', L(B.id), { token: T.member })).json.last, 'whiteboard', 'restored while shown');
  await expect('owner hides it', 200, 'PATCH', `/api/spaces/${B.id}`, { token: admin, body: { tabs: { hide: ['whiteboard'] } } });
  ok(!('last' in (await expect('read', 200, 'GET', L(B.id), { token: T.member })).json), 'passed over while the owner hides it');
  await expect('owner shows it', 200, 'PATCH', `/api/spaces/${B.id}`, { token: admin, body: { tabs: null } });
  same((await expect('read', 200, 'GET', L(B.id), { token: T.member })).json.last, 'whiteboard', 'and back, the record never rewritten');

  // -- a stored hide is ignored and never rewritten
  const layoutsFile = path.join(dir, 'layouts.json');
  await stop(srv);
  const file = JSON.parse(fs.readFileSync(layoutsFile, 'utf8'));
  file.spaces[B.id].system = { ...(file.spaces[B.id].system || {}), [keys.member]: { ...((file.spaces[B.id].system || {})[keys.member] || {}), documents: { tab: false } } };
  fs.writeFileSync(layoutsFile, JSON.stringify(file));
  srv = await startServer(dir);
  ({ call, expect } = srv);
  const T2 = {};
  for (const [who, login] of [['member', 'mia'], ['admin', 'admin']]) T2[who] = (await call('POST', '/api/login', { body: { login, password: login === 'admin' ? 'testpass1234' : 'memberpass1234' } })).json.token;
  seen = await sysOf(B.id, T2.member);
  same([seen.documents.tab, seen.documents.pinned, seen.documents.shown], [true, true, true], 'a stored hide of a pinned tab is ignored');
  await expect('another write', 200, 'PATCH', SYS(B.id, 'documents'), { token: T2.member, body: { name: 'Papers' } });
  same(JSON.parse(fs.readFileSync(layoutsFile, 'utf8')).spaces[B.id].system[keys.member].documents.tab, false, 'and it is not rewritten');
  await expect('owner hides it', 200, 'PATCH', `/api/spaces/${B.id}`, { token: T2.admin, body: { tabs: { hide: ['documents'] } } });
  same((await sysOf(B.id, T2.member)).documents.tab, false, 'hidden by the owner: out of the bar');
  await expect('owner shows it', 200, 'PATCH', `/api/spaces/${B.id}`, { token: T2.admin, body: { tabs: null } });
  same((await sysOf(B.id, T2.member)).documents.tab, true, 'shown again: in the bar whatever was stored');
} finally {
  await Promise.all(servers.map(stop));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`check-pinned-workspaces: OK (${n} checks)`);
