#!/usr/bin/env node
/*
 * check-environment-isolation.mjs -- one environment's changes never reach another's (GitHub #872), against a real
 * hosted server (BASE_DOMAIN=localhost) on a throwaway DATA_DIR:
 *   - every store starts from its own copy of the default settings: a role change (member, guest, moderator), an icon,
 *     a reaction and a theme added in acme leave beta's GET /api/roles, /api/settings and /api/themes as they were,
 *     before and after a restart, and beta's own next save does not write acme's change into beta's file;
 *   - each environment's reaction and icon lists start from the built-in set (server/default-lists.js) and stay its own:
 *     acme removing built-in entries, adding and starting again leaves beta's lists the built-in set
 *     (plan-templates-redesign.md, decision 12 as corrected 2026-11-16);
 *   - the shared defaults are frozen, so a write to one throws rather than reaching every environment.
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
const require = createRequire(import.meta.url);
const { DEFAULT_REACTION_LIST, DEFAULT_ICON_LIST } = require('../server/default-lists.js');
let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    n += 1;
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}\n${err.stack || err}`);
  }
};

async function startServer(dataDir, env = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 20000);
    const onData = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
  return { port, stop: () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); }) };
}

function call(server, host, method, urlPath, { body, cookie } = {}) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const headers = { host: `${host}.localhost:${server.port}`, accept: 'application/json' };
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
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const cookieOf = (res) => [].concat(res.headers?.['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
function signIn(server, host, login, password) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify({ login, password }));
    const req = http.request({ host: '127.0.0.1', port: server.port, method: 'POST', path: host === 'admin' ? '/api/host/login' : '/api/login', headers: { host: `${host}.localhost:${server.port}`, 'content-type': 'application/json', 'content-length': payload.length } }, (res) => {
      res.resume();
      res.on('end', () => (res.statusCode === 200 ? resolve(cookieOf(res)) : reject(new Error(`${host}: sign-in answered ${res.statusCode}`))));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

// What the owner of an environment sees of the things that start from a shared default.
async function lookOf(server, host, cookie) {
  const roles = await call(server, host, 'GET', '/api/roles', { cookie });
  const settings = await call(server, host, 'GET', '/api/settings', { cookie });
  const themes = await call(server, host, 'GET', '/api/themes', { cookie });
  for (const r of [roles, settings, themes]) assert.equal(r.status, 200, r.text);
  // A module's own permissions come and go with what each environment has installed (Stream installs itself on start), so
  // only the core permissions are compared.
  const core = Object.fromEntries(Object.entries(roles.json.roles).map(([role, set]) => [role, Object.fromEntries(Object.entries(set).filter(([k]) => !k.startsWith('module.')))]));
  return { roles: core, ownIcons: settings.json.settings.ownIcons, ownReactions: settings.json.settings.ownReactions, themes: themes.json.themes.map((t) => t.id).sort() };
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-environment-isolation-'));
const dataDir = path.join(base, 'hosted');
const hostEnv = { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'boss', ADMIN_PASSWORD: 'host-password-1' };
let server = null;
try {
  await test('the shared defaults are frozen: a write throws instead of reaching every environment', async () => {
    const store = require(path.join(ROOT, 'server', 'store.js'));
    const lists = require(path.join(ROOT, 'server', 'default-lists.js'));
    assert.throws(() => { store.DEFAULT_SETTINGS.roles.member = { chat: false }; }, TypeError);
    assert.throws(() => { store.DEFAULT_SETTINGS.icons.push({ id: 'x' }); }, TypeError);
    assert.throws(() => { store.DEFAULT_SETTINGS.allowAsides = false; }, TypeError);
    assert.throws(() => { store.DEFAULT_THEME.dark['surface-page'] = '#000000'; }, TypeError);
    assert.throws(() => { store.ROLE_PERMISSIONS[0].key = 'x'; }, TypeError);
    assert.throws(() => { lists.DEFAULT_REACTION_LIST[0].glyph = 'x'; }, TypeError);
    assert.throws(() => { lists.DEFAULT_ICON_LIST.pop(); }, TypeError);
    assert.equal(typeof store.DEFAULT_THEME.name, 'string', 'the default theme\'s name is still read live');
  });

  server = await startServer(dataDir, hostEnv);
  const host = await signIn(server, 'admin', 'boss', 'host-password-1');
  for (const slug of ['acme', 'beta']) {
    const made = await call(server, 'admin', 'POST', '/api/host/environments', { cookie: host, body: { slug, name: slug, owner: { login: 'owner', password: 'owner-password-1' } } });
    assert.equal(made.status, 201, made.text);
  }
  let acme = await signIn(server, 'acme', 'owner', 'owner-password-1');
  let beta = await signIn(server, 'beta', 'owner', 'owner-password-1');
  const betaBefore = await lookOf(server, 'beta', beta);
  assert.equal(betaBefore.roles.member.chat, true, 'a member may chat by default');
  assert.deepEqual([betaBefore.ownReactions, betaBefore.ownIcons], [DEFAULT_REACTION_LIST, DEFAULT_ICON_LIST], 'a new environment\'s lists are the built-in set');

  await test('a role change, an icon, a reaction and a theme in acme leave beta as it was', async () => {
    assert.equal((await call(server, 'acme', 'PATCH', '/api/roles/member', { cookie: acme, body: { chat: false } })).status, 200);
    assert.equal((await call(server, 'acme', 'PATCH', '/api/roles/guest', { cookie: acme, body: { react: false } })).status, 200);
    assert.equal((await call(server, 'acme', 'PATCH', '/api/roles/moderator', { cookie: acme, body: { canKick: false } })).status, 200);
    // acme's whole lists: built-in entries removed (Heart, the first icon), one added to each.
    const s = await call(server, 'acme', 'PATCH', '/api/settings', { cookie: acme, body: { icons: [...DEFAULT_ICON_LIST.slice(1), { id: 'anchor', classes: 'fa-solid fa-anchor', label: 'anchor' }], reactions: [{ id: 'owl', glyph: '🦉', label: 'Owl' }, ...DEFAULT_REACTION_LIST.slice(1)] } });
    assert.equal(s.status, 200, s.text);
    const theme = await call(server, 'acme', 'POST', '/api/themes', { cookie: acme, body: { name: 'Acme', mode: 'dark', 'surface-page': '#101010', 'surface-panel': '#202020', 'edge-hairline': '#303030', 'text-primary': '#f0f0f0', 'text-muted': '#a0a0a0', 'accent-fill': '#c08030', 'text-on-accent': '#101010' } });
    assert.equal(theme.status, 200, theme.text);
    const acmeNow = await lookOf(server, 'acme', acme);
    assert.equal(acmeNow.roles.member.chat, false);
    assert.equal(acmeNow.roles.guest.react, false);
    assert.equal(acmeNow.roles.moderator.canKick, false);
    assert.ok(acmeNow.ownIcons.some((i) => i.id === 'anchor'));
    assert.ok(acmeNow.ownReactions.some((r) => r.id === 'owl'));
    assert.equal(acmeNow.ownReactions.some((r) => r.id === 'heart') || acmeNow.ownIcons.some((i) => i.id === DEFAULT_ICON_LIST[0].id), false, 'acme removed built-in ones');
    assert.ok(acmeNow.themes.includes(theme.json.theme.id));
    assert.deepEqual(await lookOf(server, 'beta', beta), betaBefore);
  });

  await test('beta\'s own next save writes none of acme\'s changes into beta\'s file', async () => {
    assert.equal((await call(server, 'beta', 'PATCH', '/api/settings', { cookie: beta, body: { allowAsides: false } })).status, 200);
    assert.equal((await call(server, 'beta', 'PATCH', '/api/roles/member', { cookie: beta, body: { shareScreen: false } })).status, 200);
    const look = await lookOf(server, 'beta', beta);
    assert.equal(look.roles.member.chat, true);
    assert.equal(look.roles.member.shareScreen, false);
    assert.equal(look.roles.guest.react, true);
    assert.equal(look.roles.moderator.canKick, true);
    // acme still has its own, and not beta's.
    assert.equal((await lookOf(server, 'acme', acme)).roles.member.shareScreen, true);
  });

  await server.stop();
  server = await startServer(dataDir, hostEnv);
  acme = await signIn(server, 'acme', 'owner', 'owner-password-1');
  beta = await signIn(server, 'beta', 'owner', 'owner-password-1');

  await test('after a restart each environment has its own roles, icons, reactions and themes', async () => {
    const a = await lookOf(server, 'acme', acme);
    const b = await lookOf(server, 'beta', beta);
    assert.deepEqual([a.roles.member.chat, a.roles.member.shareScreen, a.roles.guest.react, a.roles.moderator.canKick], [false, true, false, false]);
    assert.deepEqual([b.roles.member.chat, b.roles.member.shareScreen, b.roles.guest.react, b.roles.moderator.canKick], [true, false, true, true]);
    assert.deepEqual(b.ownIcons, betaBefore.ownIcons);
    assert.deepEqual(b.ownReactions, betaBefore.ownReactions);
    assert.deepEqual(b.themes, betaBefore.themes);
    assert.ok(a.ownIcons.some((i) => i.id === 'anchor'));
    assert.deepEqual(a.ownReactions.map((r) => r.id).slice(0, 2), ['owl', DEFAULT_REACTION_LIST[1].id], 'acme\'s lists as saved, not filled again');
    assert.deepEqual([b.ownReactions, b.ownIcons], [DEFAULT_REACTION_LIST, DEFAULT_ICON_LIST], 'beta\'s still the built-in set');
  });

  await test('acme starting again from the built-in set changes only acme', async () => {
    assert.equal((await call(server, 'beta', 'PATCH', '/api/settings', { cookie: beta, body: { reactions: DEFAULT_REACTION_LIST.slice(0, 6) } })).status, 200);
    const reset = await call(server, 'acme', 'PATCH', '/api/settings', { cookie: acme, body: { resetLists: true } });
    assert.equal(reset.status, 200, reset.text);
    assert.deepEqual([reset.json.settings.ownReactions, reset.json.settings.ownIcons], [DEFAULT_REACTION_LIST, DEFAULT_ICON_LIST]);
    assert.deepEqual((await lookOf(server, 'beta', beta)).ownReactions, DEFAULT_REACTION_LIST.slice(0, 6), 'beta keeps its own six');
    assert.equal((await call(server, 'beta', 'PATCH', '/api/settings', { cookie: beta, body: { resetLists: true } })).status, 200);
  });

  await test('a third environment made after all that starts from the plain defaults', async () => {
    const made = await call(server, 'admin', 'POST', '/api/host/environments', { cookie: await signIn(server, 'admin', 'boss', 'host-password-1'), body: { slug: 'gamma', name: 'gamma', owner: { login: 'owner', password: 'owner-password-1' } } });
    assert.equal(made.status, 201, made.text);
    const gamma = await signIn(server, 'gamma', 'owner', 'owner-password-1');
    assert.deepEqual(await lookOf(server, 'gamma', gamma), betaBefore);
  });
} catch (err) {
  failed += 1;
  console.error(`FAIL setting up\n${err.stack || err}`);
} finally {
  if (server) await server.stop();
  fs.rmSync(base, { recursive: true, force: true });
}

if (failed) {
  console.error(`check-environment-isolation: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-environment-isolation: ${n} passed`);
