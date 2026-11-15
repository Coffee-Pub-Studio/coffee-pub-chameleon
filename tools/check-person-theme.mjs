#!/usr/bin/env node
/*
 * check-person-theme.mjs -- each person's own theme (plan-templates-redesign.md, decision 13), on a real server with a
 * throwaway DATA_DIR:
 *   - PATCH /api/me { theme } keeps an id of the environment's own themes on the person's account, and null follows the
 *     environment's again; GET /api/me/themes lists ids and names and says which is theirs;
 *   - /theme.css for that person (and only that person) is the chosen theme's; everyone else gets the environment's;
 *   - hostile: another person's theme can't be set (an unknown field, an owner's PATCH /api/users/:key) or read (the owner's
 *     view of a person, the listing of people); an id that does not exist, a data URI, CSS, an address, an object, a
 *     number, a prototype key and a long string are each 400 with one sentence and change nothing;
 *   - a guest (a guest link) and no session get 403 and 401; deleting a theme puts everyone who chose it back on the
 *     environment's; the choice is stored (a store reload keeps it) and rides with the environment's copy.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.PRODUCT_NAME = 'Testname';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { Store } = require('../server/store.js');

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-person-theme-'));
const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  cwd: ROOT,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, PRODUCT_NAME: 'Testname', ADMIN_PASSWORD: 'testpass1234' },
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
async function call(method, urlPath, { body, token, raw = false } = {}) {
  const headers = { accept: 'application/json', ...(token ? { cookie: `app_session=${token}` } : {}) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  if (!raw) { try { json = JSON.parse(text); } catch { /* not JSON */ } }
  return { status: res.status, json, text };
}
const signIn = async (login, password) => {
  const r = await call('POST', '/api/login', { body: { login, password } });
  assert.equal(r.status, 200, r.text);
  return r.json.token;
};

try {
  const admin = await signIn('admin', 'testpass1234');
  for (const login of ['ann', 'ben']) {
    const r = await call('POST', '/api/users', { token: admin, body: { login, displayName: login, role: 'member', password: 'memberpass1234' } });
    assert.equal(r.status, 201, r.text);
  }
  const ann = await signIn('ann', 'memberpass1234');
  const ben = await signIn('ben', 'memberpass1234');
  const userKey = async (login) => (await call('GET', '/api/users', { token: admin })).json.users.find((u) => u.login === login).key;
  const annKey = await userKey('ann');
  const benKey = await userKey('ben');
  const cssOf = async (token) => (await call('GET', '/theme.css', { token, raw: true })).text;
  const themeOf = async (token) => (await call('GET', '/api/me', { token })).json.user.theme;
  const baseline = await cssOf(ben);

  await test('the list: ids and names only, nothing chosen yet, the environment\'s theme named', async () => {
    const r = await call('GET', '/api/me/themes', { token: ann });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.themes.map((t) => t.id).sort(), ['staying-blonde', 'strong-coffee', 'willhavebeen']);
    for (const t of r.json.themes) assert.deepEqual(Object.keys(t), ['id', 'name']);
    assert.deepEqual([r.json.theme, r.json.environmentTheme], [null, null]);
    assert.equal(await themeOf(ann), null);
  });

  await test('choosing: the id is kept, /theme.css is theirs, everyone else keeps the environment\'s', async () => {
    const r = await call('PATCH', '/api/me', { token: ann, body: { theme: 'staying-blonde' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.user.theme, 'staying-blonde');
    assert.equal(await themeOf(ann), 'staying-blonde');
    assert.equal((await call('GET', '/api/me/themes', { token: ann })).json.theme, 'staying-blonde');
    const mine = await cssOf(ann);
    assert.notEqual(mine, baseline, 'their stylesheet differs');
    assert.equal(await cssOf(ben), baseline, 'another person\'s does not');
    assert.equal(await cssOf(undefined), baseline, 'and neither does a page with no session');
    const theme = (await call('GET', '/api/themes', { token: admin })).json.themes.find((t) => t.id === 'staying-blonde');
    assert.ok(mine.includes(theme.light['surface-page']) && mine.includes(theme.dark['surface-page']), 'both of the chosen theme\'s sets');
    // Their light or dark stays theirs, beside it.
    const both = await call('PATCH', '/api/me', { token: ann, body: { themeMode: 'light', theme: 'willhavebeen' } });
    assert.deepEqual([both.status, both.json.user.themeMode, both.json.user.theme], [200, 'light', 'willhavebeen']);
    assert.deepEqual((await call('PATCH', '/api/me', { token: ann, body: { themeMode: 'dark' } })).json.user.theme, 'willhavebeen', 'a mode save leaves the theme');
  });

  await test('another person\'s theme can be neither set nor read', async () => {
    // The body names no person; any such field is refused.
    for (const body of [{ theme: 'strong-coffee', key: benKey }, { key: benKey, theme: 'strong-coffee' }, { userKey: benKey, theme: 'strong-coffee' }, { user: benKey, theme: 'strong-coffee' }]) {
      const r = await call('PATCH', '/api/me', { token: ann, body });
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    assert.equal(await themeOf(ben), null);
    // The owner's route for a person doesn't take a theme, whatever is sent.
    const r = await call('PATCH', `/api/users/${benKey}`, { token: admin, body: { theme: 'strong-coffee', displayName: 'ben' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(await themeOf(ben), null, 'the owner can\'t choose it for them');
    // Nobody reads it: not the owner, not a member listing people.
    for (const [token, where] of [[admin, `/api/users`], [admin, `/api/users/${annKey}`], [ben, '/api/users'], [ben, `/api/users/${annKey}`]]) {
      const got = await call('GET', where, { token });
      if (got.status !== 200) continue;
      const people = got.json.users || [got.json.user];
      for (const p of people.filter(Boolean)) assert.equal('theme' in p, false, `${where} leaks a theme`);
    }
    assert.equal((await call('GET', '/api/me/themes', { token: ben })).json.theme, null);
    assert.equal(await cssOf(ben), baseline);
  });

  await test('what is not one of the environment\'s themes is refused with one sentence, and nothing changes', async () => {
    const before = await themeOf(ann);
    const modeBefore = (await call('GET', '/api/me', { token: ann })).json.user.themeMode;
    const bad = ['nope', '', 'default', 'STRONG-COFFEE', ' strong-coffee', 'strong-coffee ', '__proto__', 'constructor', '../strong-coffee', 'x'.repeat(5000),
      'data:text/css;base64,Ym9keXtiYWNrZ3JvdW5kOnJlZH0=', 'data:image/svg+xml,<svg onload=alert(1)>', 'url(data:text/css,a{})', 'red; background: url(x)', 'https://example.com/theme.css',
      'javascript:alert(1)', 0, 1, true, false, [], ['strong-coffee'], {}, { id: 'strong-coffee' }, { light: { 'surface-page': '#ff0000' } }];
    for (const theme of bad) {
      const r = await call('PATCH', '/api/me', { token: ann, body: { theme } });
      assert.equal(r.status, 400, `${JSON.stringify(theme).slice(0, 60)}: ${r.text.slice(0, 120)}`);
      assert.match(r.json.error, /^That theme is not one of this .+'s themes\.$/);
    }
    assert.equal(await themeOf(ann), before);
    // A refused field changes nothing beside it either.
    assert.equal((await call('PATCH', '/api/me', { token: ann, body: { themeMode: 'light', theme: 'nope' } })).status, 400);
    assert.equal((await call('GET', '/api/me', { token: ann })).json.user.themeMode, modeBefore);
    for (const body of [null, [], 'theme', {}, { colour: 'red' }]) assert.equal((await call('PATCH', '/api/me', { token: ann, body })).status, 400, JSON.stringify(body));
    // No colour, CSS or address ever reaches the stylesheet: it is written from the theme's own stored colours.
    const css = await cssOf(ann);
    assert.ok(!/data:|url\(|javascript:|@import/i.test(css));
  });

  await test('null follows the environment\'s again; the key leaves the account', async () => {
    const r = await call('PATCH', '/api/me', { token: ann, body: { theme: null } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.user.theme, null);
    assert.equal(await cssOf(ann), await cssOf(ben), 'the same sheet as the environment\'s');
    const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'app.json'), 'utf8'));
    assert.equal('theme' in stored.users.find((u) => u.login === 'ann'), false);
  });

  await test('the environment\'s own default still moves everyone who has not chosen', async () => {
    await call('PATCH', '/api/me', { token: ann, body: { theme: 'willhavebeen' } });
    assert.equal((await call('PATCH', '/api/settings', { token: admin, body: { activeThemeId: 'staying-blonde' } })).status, 200);
    assert.equal((await call('GET', '/api/me/themes', { token: ben })).json.environmentTheme, 'staying-blonde');
    assert.notEqual(await cssOf(ben), baseline);
    assert.notEqual(await cssOf(ann), await cssOf(ben), 'a person who chose keeps theirs');
    assert.equal((await call('PATCH', '/api/settings', { token: admin, body: { activeThemeId: null } })).status, 200);
  });

  await test('a guest and no session cannot choose or list', async () => {
    const sp = await call('POST', '/api/spaces', { token: admin, body: { name: 'Door' } });
    assert.equal(sp.status, 200, sp.text);
    const link = (await call('POST', `/api/spaces/${sp.json.space.id}/guest-link`, { token: admin, body: {} })).json.space.guestToken;
    for (const [method, url, body] of [['PATCH', `/api/me?guest=${link}`, { theme: 'strong-coffee' }], ['PATCH', `/api/me?guest=${link}`, { theme: null }], ['GET', `/api/me/themes?guest=${link}`]]) {
      const r = await call(method, url, { body });
      assert.equal(r.status, 403, `${method} ${url}: ${r.text}`);
      assert.equal(r.json.error, 'Guests can\'t choose a theme.');
    }
    for (const [method, url, body] of [['PATCH', '/api/me', { theme: 'strong-coffee' }], ['GET', '/api/me/themes']]) {
      assert.equal((await call(method, url, { body })).status, 401, `${method} ${url}`);
    }
    assert.equal(await themeOf(ann), 'willhavebeen');
  });

  await test('deleting a theme puts everyone who chose it back on the environment\'s', async () => {
    const made = await call('POST', '/api/themes', { token: admin, body: { name: 'Mine', mode: 'light', 'surface-page': '#ffffff', 'surface-panel': '#f5f7f8', 'edge-hairline': '#dde3e6', 'text-primary': '#222222', 'text-muted': '#6b7479', 'accent-fill': '#1c7c8c', 'text-on-accent': '#ffffff' } });
    assert.equal(made.status, 200, made.text);
    const id = made.json.theme.id;
    assert.equal((await call('PATCH', '/api/me', { token: ben, body: { theme: id } })).status, 200);
    assert.equal(await themeOf(ben), id);
    assert.equal((await call('DELETE', `/api/themes/${id}`, { token: admin })).status, 200);
    assert.equal(await themeOf(ben), null);
    assert.equal((await call('PATCH', '/api/me', { token: ben, body: { theme: id } })).status, 400, 'and it can\'t be chosen again');
    const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'app.json'), 'utf8'));
    assert.equal('theme' in stored.users.find((u) => u.login === 'ben'), false);
  });
} catch (err) {
  failed += 1;
  console.error(err.stack || err);
} finally {
  child.kill();
}

await test('stored on the account: a reload keeps it, a theme that is gone reads as none, and a bad stored value is dropped', async () => {
  await new Promise((r) => setTimeout(r, 300)); // the server's last write
  const store = new Store(dataDir);
  const ann = store.users.find((u) => u.login === 'ann');
  assert.equal(ann.theme, 'willhavebeen');
  assert.equal(store.personTheme(ann), 'willhavebeen');
  assert.equal(store.activeThemeSets('willhavebeen').dark['surface-page'], store.themes.find((t) => t.id === 'willhavebeen').dark['surface-page']);
  store.removeTheme('willhavebeen');
  assert.equal(store.personTheme(store.users.find((u) => u.login === 'ann')), null);
  assert.equal(store.sanitizeUser({ key: 'key1abc', login: 'x', theme: { id: 'a' } }).theme, undefined);
  assert.equal(store.sanitizeUser({ key: 'key2abc', login: 'y', theme: 'data:text/css,a' }).theme, undefined);
  assert.throws(() => store.setPersonTheme('nope', null), /no such user/);
});

fs.rmSync(dataDir, { recursive: true, force: true });
if (failed) {
  console.error(`check-person-theme: ${failed} failed`);
  process.exit(1);
}
console.log(`check-person-theme: ${n} groups ok`);
