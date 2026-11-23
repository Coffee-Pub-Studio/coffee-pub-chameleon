#!/usr/bin/env node
/*
 * check-colour-grid.mjs -- each person's own colour grid (plan-colour-picker.md, decision 23, "The person's colour grid"),
 * on a real server with a throwaway DATA_DIR:
 *   - GET /api/me/color-grid answers { colors: null } before the person has edited it; PUT { colors } replaces the list,
 *     GET answers it, an empty list is kept as empty, and a restarted server (and a store reload) keeps it;
 *   - hostile: each bad body (not a list, 49 entries, a bad hex, upper case, three digits, eight digits, a CSS name,
 *     url(x), opacity 101, -1, 1.5 or a string, an extra key in the body or in an entry, a missing key, a prototype key,
 *     duplicates) is 400 with one sentence and changes nothing;
 *   - only the caller's own: another person's grid is neither set (an unknown body key, an owner's PATCH /api/users/:key)
 *     nor read (the owner's view of a person, the listing of people);
 *   - no session gets 401, a guest 403, and an agent's token can't reach it;
 *   - a stored grid that fails the check is dropped when the store loads.
 * And each person's Recent colours (Thomas, 2026-11-22), kept the same way at GET/PUT /api/me/color-recent: null before the
 * first write, the round trip, at most 8, each bad entry and a duplicate refused, one person's not another's, 401 and 403,
 * kept across a restart, and a bad stored list dropped on load.
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

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-colour-grid-'));
let child = null;
let port = 0;
async function startServer() {
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, PRODUCT_NAME: 'Testname', ADMIN_PASSWORD: 'testpass1234', AGENT_TOKENS: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 20000);
    const onData = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
}
const stopServer = () => new Promise((resolve) => {
  if (!child || child.exitCode !== null) return resolve();
  child.removeAllListeners('exit');
  child.once('exit', () => resolve());
  child.kill('SIGTERM');
});
async function call(method, urlPath, { body, token, bearer, raw } = {}) {
  const headers = { accept: 'application/json', ...(token ? { cookie: `app_session=${token}` } : {}), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) };
  const payload = raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body);
  if (payload !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text, headers: res.headers };
}
const signIn = async (login, password) => {
  const r = await call('POST', '/api/login', { body: { login, password } });
  assert.equal(r.status, 200, r.text);
  return r.json.token;
};
const storedUser = (login) => JSON.parse(fs.readFileSync(path.join(dataDir, 'app.json'), 'utf8')).users.find((u) => u.login === login);

const GRID = [
  { color: '#ffffff', opacity: 100 },
  { color: '#d62828', opacity: 100 },
  { color: '#d62828', opacity: 60 },
  { color: '#2f6cbf', opacity: 0 },
];
const LIST = 'Send the colours as a list, such as {"colors":[{"color":"#d62828","opacity":100}]}.';
const AT_MOST = 'The grid holds at most 48 colours.';
const EACH = 'Each colour is #rrggbb in lower case, with an opacity from 0 to 100.';
const TWICE = 'That colour is in the list twice.';
const RECENT = [
  { color: '#2f6cbf', opacity: 100 },
  { color: '#d62828', opacity: 40 },
  { color: '#d62828', opacity: 100 },
];
const RECENT_AT_MOST = 'Recent holds at most 8 colours.';
const many = (count) => Array.from({ length: count }, (_, i) => ({ color: `#0000${i.toString(16).padStart(2, '0')}`, opacity: 100 }));

let annToken = null;
try {
  await startServer();
  const admin = await signIn('admin', 'testpass1234');
  for (const login of ['ann', 'ben']) {
    const r = await call('POST', '/api/users', { token: admin, body: { login, displayName: login, role: 'member', password: 'memberpass1234' } });
    assert.equal(r.status, 201, r.text);
  }
  const ann = await signIn('ann', 'memberpass1234');
  annToken = ann;
  const ben = await signIn('ben', 'memberpass1234');
  const userKey = async (login) => (await call('GET', '/api/users', { token: admin })).json.users.find((u) => u.login === login).key;
  const annKey = await userKey('ann');
  const benKey = await userKey('ben');
  const gridOf = async (token) => (await call('GET', '/api/me/color-grid', { token })).json.colors;

  await test('before any edit: null, not stored, and not cached', async () => {
    const r = await call('GET', '/api/me/color-grid', { token: ann });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, { colors: null });
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal('colorGrid' in storedUser('ann'), false, 'the key is left off the account');
  });

  await test('PUT replaces the whole list and GET answers it, in the order sent', async () => {
    const r = await call('PUT', '/api/me/color-grid', { token: ann, body: { colors: GRID } });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, { colors: GRID });
    assert.deepEqual(await gridOf(ann), GRID);
    assert.deepEqual(storedUser('ann').colorGrid, GRID);
    const shorter = GRID.slice(1).reverse();
    assert.deepEqual((await call('PUT', '/api/me/color-grid', { token: ann, body: { colors: shorter } })).json.colors, shorter);
    assert.deepEqual(await gridOf(ann), shorter, 'replaced, not merged');
    // 48 is the most, and fits.
    assert.equal((await call('PUT', '/api/me/color-grid', { token: ann, body: { colors: many(48) } })).status, 200);
    assert.equal((await gridOf(ann)).length, 48);
  });

  await test('an empty list is kept as empty, which is not the same as never edited', async () => {
    const r = await call('PUT', '/api/me/color-grid', { token: ann, body: { colors: [] } });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.colors, []);
    assert.deepEqual(await gridOf(ann), []);
    assert.deepEqual(storedUser('ann').colorGrid, []);
    assert.equal((await call('PUT', '/api/me/color-grid', { token: ann, body: { colors: GRID } })).status, 200);
  });

  await test('every bad body is 400 with one sentence and changes nothing', async () => {
    const entry = (over) => [{ color: '#d62828', opacity: 100, ...over }];
    const bad = [
      [{}, LIST], [{ colors: null }, LIST], [{ colors: 'red' }, LIST], [{ colors: { color: '#d62828', opacity: 100 } }, LIST], [{ colors: 5 }, LIST],
      [[], LIST], [[{ color: '#d62828', opacity: 100 }], LIST],
      [{ colors: GRID, extra: 1 }, LIST], [{ colors: GRID, key: benKey }, LIST], [{ colours: GRID }, LIST],
      [JSON.parse(`{"colors":${JSON.stringify(GRID)},"__proto__":{"x":1}}`), LIST],
      [{ colors: many(49) }, AT_MOST],
      [{ colors: entry({ color: '#d6282' }) }, EACH], [{ colors: entry({ color: '#D62828' }) }, EACH], [{ colors: entry({ color: '#d6282G' }) }, EACH],
      [{ colors: entry({ color: '#abc' }) }, EACH], [{ colors: entry({ color: '#d62828ff' }) }, EACH], [{ colors: entry({ color: 'red' }) }, EACH],
      [{ colors: entry({ color: 'url(x)' }) }, EACH], [{ colors: entry({ color: ' #d62828' }) }, EACH], [{ colors: entry({ color: 'd62828' }) }, EACH],
      [{ colors: entry({ color: 13994024 }) }, EACH], [{ colors: entry({ color: null }) }, EACH],
      [{ colors: entry({ opacity: 101 }) }, EACH], [{ colors: entry({ opacity: -1 }) }, EACH], [{ colors: entry({ opacity: 1.5 }) }, EACH],
      [{ colors: entry({ opacity: '100' }) }, EACH], [{ colors: entry({ opacity: null }) }, EACH], [{ colors: entry({ opacity: true }) }, EACH],
      [{ colors: entry({ name: 'Red' }) }, EACH], [{ colors: [{ color: '#d62828' }] }, EACH], [{ colors: [{ opacity: 100 }] }, EACH],
      [{ colors: ['#d62828'] }, EACH], [{ colors: [null] }, EACH], [{ colors: [[]] }, EACH],
      [{ colors: [JSON.parse('{"color":"#d62828","opacity":100,"__proto__":{"x":1}}')] }, EACH],
      [{ colors: [...GRID, { color: '#d62828', opacity: 100 }] }, TWICE],
    ];
    for (const [body, sentence] of bad) {
      const r = await call('PUT', '/api/me/color-grid', { token: ann, body });
      assert.equal(r.status, 400, `${JSON.stringify(body).slice(0, 80)}: ${r.text.slice(0, 120)}`);
      assert.equal(r.json?.error, sentence, JSON.stringify(body).slice(0, 80));
    }
    // A body that isn't JSON at all is refused by the parser.
    assert.equal((await call('PUT', '/api/me/color-grid', { token: ann, raw: '{"colors":' })).status, 400);
    assert.deepEqual(await gridOf(ann), GRID, 'nothing changed');
    assert.deepEqual(storedUser('ann').colorGrid, GRID);
    // The same colour at another opacity is not a duplicate.
    assert.equal((await call('PUT', '/api/me/color-grid', { token: ann, body: { colors: [{ color: '#d62828', opacity: 100 }, { color: '#d62828', opacity: 99 }] } })).status, 200);
    assert.equal((await call('PUT', '/api/me/color-grid', { token: ann, body: { colors: GRID } })).status, 200);
  });

  await test('one person\'s grid is not another\'s, and nobody else can set or read it', async () => {
    assert.equal(await gridOf(ben), null, 'ben has never edited his');
    const mine = [{ color: '#000000', opacity: 50 }];
    assert.equal((await call('PUT', '/api/me/color-grid', { token: ben, body: { colors: mine } })).status, 200);
    assert.deepEqual(await gridOf(ben), mine);
    assert.deepEqual(await gridOf(ann), GRID, 'ann\'s is untouched');
    // The owner's route for a person doesn't take it, whatever is sent.
    const r = await call('PATCH', `/api/users/${benKey}`, { token: admin, body: { colorGrid: GRID, displayName: 'ben' } });
    assert.ok(r.status === 200 || r.status === 400, r.text);
    assert.deepEqual(await gridOf(ben), mine, 'the owner can\'t set it');
    // PATCH /api/me doesn't take it either.
    await call('PATCH', '/api/me', { token: ben, body: { colorGrid: GRID } });
    assert.deepEqual(await gridOf(ben), mine);
    // Nobody reads it: not the owner, not a member listing people, not the person's own /api/me.
    for (const [token, where] of [[admin, '/api/users'], [admin, `/api/users/${annKey}`], [ben, '/api/users'], [ben, `/api/users/${annKey}`], [ann, '/api/me']]) {
      const got = await call('GET', where, { token });
      if (got.status !== 200) continue;
      assert.equal(/colorGrid|#d62828/.test(got.text), false, `${where} leaks a grid`);
    }
  });

  await test('no session gets 401 and a guest 403, and nothing changes', async () => {
    for (const [method, body] of [['GET'], ['PUT', { colors: [] }]]) {
      const r = await call(method, '/api/me/color-grid', { body });
      assert.equal(r.status, 401, `${method}: ${r.text}`);
      assert.equal(r.json.error, 'sign in first');
    }
    const sp = await call('POST', '/api/spaces', { token: admin, body: { name: 'Door' } });
    assert.equal(sp.status, 200, sp.text);
    const link = (await call('POST', `/api/spaces/${sp.json.space.id}/guest-link`, { token: admin, body: {} })).json.space.guestToken;
    for (const [method, body] of [['GET'], ['PUT', { colors: [] }], ['PUT', { colors: GRID }]]) {
      const r = await call(method, `/api/me/color-grid?guest=${link}`, { body });
      assert.equal(r.status, 403, `${method}: ${r.text}`);
      assert.equal(r.json.error, 'Guests can\'t keep their own colours.');
    }
    assert.deepEqual(await gridOf(ann), GRID);
  });

  const recentOf = async (token) => (await call('GET', '/api/me/color-recent', { token })).json.colors;

  await test('Recent: null before the first write, not stored, and not cached', async () => {
    const r = await call('GET', '/api/me/color-recent', { token: ann });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, { colors: null });
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal('colorRecent' in storedUser('ann'), false, 'the key is left off the account');
  });

  await test('Recent: PUT replaces the list, GET answers it in the order sent, and the grid is untouched', async () => {
    const r = await call('PUT', '/api/me/color-recent', { token: ann, body: { colors: RECENT } });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, { colors: RECENT });
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await recentOf(ann), RECENT);
    assert.deepEqual(storedUser('ann').colorRecent, RECENT);
    assert.deepEqual(await gridOf(ann), GRID, 'the grid is its own list');
    assert.equal((await call('PUT', '/api/me/color-recent', { token: ann, body: { colors: many(8) } })).status, 200, '8 fits');
    assert.deepEqual(await recentOf(ann), many(8));
    assert.equal((await call('PUT', '/api/me/color-recent', { token: ann, body: { colors: [] } })).status, 200);
    assert.deepEqual(await recentOf(ann), [], 'an empty list is kept');
    assert.equal((await call('PUT', '/api/me/color-recent', { token: ann, body: { colors: RECENT } })).status, 200);
  });

  await test('Recent: every bad body is 400 with one sentence and changes nothing', async () => {
    const entry = (over) => [{ color: '#d62828', opacity: 100, ...over }];
    const bad = [
      [{}, LIST], [{ colors: null }, LIST], [{ colors: 'red' }, LIST], [{ colors: { color: '#d62828', opacity: 100 } }, LIST],
      [[], LIST], [{ colors: RECENT, extra: 1 }, LIST], [{ recent: RECENT }, LIST],
      [JSON.parse(`{"colors":${JSON.stringify(RECENT)},"__proto__":{"x":1}}`), LIST],
      [{ colors: many(9) }, RECENT_AT_MOST],
      [{ colors: entry({ color: '#D62828' }) }, EACH], [{ colors: entry({ color: '#abc' }) }, EACH], [{ colors: entry({ color: '#d62828ff' }) }, EACH],
      [{ colors: entry({ color: 'red' }) }, EACH], [{ colors: entry({ color: 'url(x)' }) }, EACH], [{ colors: entry({ color: null }) }, EACH],
      [{ colors: entry({ opacity: 101 }) }, EACH], [{ colors: entry({ opacity: -1 }) }, EACH], [{ colors: entry({ opacity: 1.5 }) }, EACH],
      [{ colors: entry({ opacity: '100' }) }, EACH], [{ colors: entry({ name: 'Red' }) }, EACH], [{ colors: [{ color: '#d62828' }] }, EACH],
      [{ colors: ['#d62828'] }, EACH], [{ colors: [null] }, EACH],
      [{ colors: [JSON.parse('{"color":"#d62828","opacity":100,"__proto__":{"x":1}}')] }, EACH],
      [{ colors: [...RECENT, { color: '#2f6cbf', opacity: 100 }] }, TWICE],
    ];
    for (const [body, sentence] of bad) {
      const r = await call('PUT', '/api/me/color-recent', { token: ann, body });
      assert.equal(r.status, 400, `${JSON.stringify(body).slice(0, 80)}: ${r.text.slice(0, 120)}`);
      assert.equal(r.json?.error, sentence, JSON.stringify(body).slice(0, 80));
    }
    assert.equal((await call('PUT', '/api/me/color-recent', { token: ann, raw: '{"colors":' })).status, 400);
    assert.deepEqual(await recentOf(ann), RECENT, 'nothing changed');
    assert.deepEqual(storedUser('ann').colorRecent, RECENT);
  });

  await test('Recent: one person\'s is not another\'s, and nobody else can set or read it', async () => {
    assert.equal(await recentOf(ben), null, 'ben has never written his');
    const mine = [{ color: '#000000', opacity: 50 }];
    assert.equal((await call('PUT', '/api/me/color-recent', { token: ben, body: { colors: mine } })).status, 200);
    assert.deepEqual(await recentOf(ben), mine);
    assert.deepEqual(await recentOf(ann), RECENT, 'ann\'s is untouched');
    await call('PATCH', `/api/users/${benKey}`, { token: admin, body: { colorRecent: RECENT, displayName: 'ben' } });
    await call('PATCH', '/api/me', { token: ben, body: { colorRecent: RECENT } });
    assert.deepEqual(await recentOf(ben), mine, 'neither the owner nor PATCH /api/me sets it');
    for (const [token, where] of [[admin, '/api/users'], [admin, `/api/users/${annKey}`], [ben, '/api/users'], [ann, '/api/me']]) {
      const got = await call('GET', where, { token });
      if (got.status !== 200) continue;
      assert.equal(/colorRecent|#2f6cbf/.test(got.text), false, `${where} leaks Recent`);
    }
  });

  await test('Recent: no session gets 401 and a guest 403, and nothing changes', async () => {
    for (const [method, body] of [['GET'], ['PUT', { colors: [] }]]) {
      const r = await call(method, '/api/me/color-recent', { body });
      assert.equal(r.status, 401, `${method}: ${r.text}`);
      assert.equal(r.json.error, 'sign in first');
    }
    const sp = await call('POST', '/api/spaces', { token: admin, body: { name: 'Porch' } });
    assert.equal(sp.status, 200, sp.text);
    const link = (await call('POST', `/api/spaces/${sp.json.space.id}/guest-link`, { token: admin, body: {} })).json.space.guestToken;
    for (const [method, body] of [['GET'], ['PUT', { colors: [] }]]) {
      const r = await call(method, `/api/me/color-recent?guest=${link}`, { body });
      assert.equal(r.status, 403, `${method}: ${r.text}`);
      assert.equal(r.json.error, 'Guests can\'t keep their own colours.');
    }
    assert.deepEqual(await recentOf(ann), RECENT);
  });

  await test('an agent\'s token can\'t reach it', async () => {
    assert.equal((await call('PATCH', '/api/settings', { token: admin, body: { agents: true } })).status, 200);
    const made = await call('POST', '/api/users', { token: admin, body: { agent: true } });
    assert.equal(made.status, 201, made.text);
    const tok = await call('POST', `/api/users/${made.json.user.key}/token`, { token: admin });
    assert.equal(tok.status, 201, tok.text);
    assert.equal((await call('GET', '/api/agent/me', { bearer: tok.json.token })).status, 200, 'the token works where an agent may go');
    for (const where of ['/api/me/color-grid', '/api/me/color-recent']) {
      for (const [method, body] of [['GET'], ['PUT', { colors: RECENT }]]) {
        const r = await call(method, where, { bearer: tok.json.token, body });
        assert.equal(r.status, 403, `${method} ${where}: ${r.text}`);
        assert.equal(r.json.error, 'An agent can\'t do that.');
      }
    }
    assert.equal('colorGrid' in storedUser(made.json.user.login), false);
    assert.equal('colorRecent' in storedUser(made.json.user.login), false);
  });
} catch (err) {
  failed += 1;
  console.error(err.stack || err);
} finally {
  await stopServer();
}

await test('a restarted server keeps it', async () => {
  await startServer();
  try {
    const r = await call('GET', '/api/me/color-grid', { token: annToken });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.colors, GRID);
    const recent = await call('GET', '/api/me/color-recent', { token: annToken });
    assert.equal(recent.status, 200, recent.text);
    assert.deepEqual(recent.json.colors, RECENT, 'Recent is kept too');
  } finally {
    await stopServer();
  }
});

await test('stored on the account: a reload keeps it, and a stored grid that fails the check is dropped', async () => {
  const store = new Store(dataDir);
  const ann = store.users.find((u) => u.login === 'ann');
  assert.deepEqual(ann.colorGrid, GRID);
  assert.deepEqual(store.colorGrid(ann), GRID);
  assert.equal(store.colorGrid(store.users.find((u) => u.login === 'admin')), null);
  for (const colorGrid of ['#d62828', { color: '#d62828', opacity: 100 }, [{ color: '#D62828', opacity: 100 }], [{ color: '#d62828', opacity: 100, name: 'x' }],
    [{ color: 'url(x)', opacity: 100 }], [{ color: '#d62828', opacity: 1.5 }], [{ color: '#d62828', opacity: 100 }, { color: '#d62828', opacity: 100 }], many(49)]) {
    assert.equal('colorGrid' in store.sanitizeUser({ key: 'key1abc', login: 'x', colorGrid }), false, JSON.stringify(colorGrid).slice(0, 60));
  }
  assert.deepEqual(store.sanitizeUser({ key: 'key2abc', login: 'y', colorGrid: [] }).colorGrid, []);
  assert.throws(() => store.setColorGrid('nope', []), /no such user/);
  assert.throws(() => store.setColorGrid(ann.key, many(49)), /at most 48/);
  assert.deepEqual(store.colorGrid(store.users.find((u) => u.login === 'ann')), GRID, 'a refusal changes nothing');
});

await test('Recent on the account: a reload keeps it, and a stored list that fails the check is dropped', async () => {
  const store = new Store(dataDir);
  const ann = store.users.find((u) => u.login === 'ann');
  assert.deepEqual(ann.colorRecent, RECENT);
  assert.deepEqual(store.colorRecent(ann), RECENT);
  assert.equal(store.colorRecent(store.users.find((u) => u.login === 'admin')), null);
  for (const colorRecent of ['#d62828', { color: '#d62828', opacity: 100 }, [{ color: '#D62828', opacity: 100 }], [{ color: '#d62828', opacity: 100, name: 'x' }],
    [{ color: 'url(x)', opacity: 100 }], [{ color: '#d62828', opacity: 1.5 }], [{ color: '#d62828', opacity: 100 }, { color: '#d62828', opacity: 100 }], many(9)]) {
    assert.equal('colorRecent' in store.sanitizeUser({ key: 'key1abc', login: 'x', colorRecent }), false, JSON.stringify(colorRecent).slice(0, 60));
  }
  assert.deepEqual(store.sanitizeUser({ key: 'key2abc', login: 'y', colorRecent: many(8) }).colorRecent, many(8));
  assert.throws(() => store.setColorRecent('nope', []), /no such user/);
  assert.throws(() => store.setColorRecent(ann.key, many(9)), /at most 8/);
  assert.deepEqual(store.colorRecent(store.users.find((u) => u.login === 'ann')), RECENT, 'a refusal changes nothing');
});

fs.rmSync(dataDir, { recursive: true, force: true });
if (failed) {
  console.error(`check-colour-grid: ${failed} failed`);
  process.exit(1);
}
console.log(`check-colour-grid: ${n} groups ok`);
