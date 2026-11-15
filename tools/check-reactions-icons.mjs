#!/usr/bin/env node
/*
 * check-reactions-icons.mjs -- the fixed core reactions and icons, the owner's own additions and a template's additions
 * (plan-templates-redesign.md, decision 12), on a real server with a throwaway DATA_DIR:
 *   - /api/branding and a space's /look read the core first, whole and in order (105 reactions, 113 icons), then the
 *     owner's own additions, then the template's, each once;
 *   - nothing removes or changes a core entry: an owner's save that leaves them out, repeats them (by id or by glyph) or
 *     relabels them changes none of it, and what the settings keep is only the owner's own additions;
 *   - a space has none of its own: a space save that carries reactions or icons changes neither list;
 *   - a template's additions (a host template with `reactions` and `iconSet`) show at once in an environment that reads it,
 *     in a space on it and in /look, and never in one that reads another template; a switch offers none of them (they are
 *     not copied), and the owner's own additions stay when the template changes;
 *   - an icon the owner adds draws wherever icons are validated (the home icon), and a core one always does.
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
const { DEFAULT_REACTION_LIST, DEFAULT_ICON_LIST } = require('../server/default-lists.js');

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-reactions-icons-'));
const templatesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-reactions-icons-t-'));
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
let token = '';
async function call(method, urlPath, body) {
  const headers = { accept: 'application/json', ...(token ? { cookie: `app_session=${token}` } : {}) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
const ids = (list) => list.map((x) => x.id);
const { Store } = require('../server/store.js');
const templates = require('../server/templates.js');

try {
  token = (await call('POST', '/api/login', { login: 'admin', password: 'testpass1234' })).json.token;
  const space = (await call('POST', '/api/spaces', { name: 'Trip' })).json.space.id;
  const branding = async () => (await call('GET', '/api/branding')).json;
  const look = async () => (await call('GET', `/api/spaces/${space}/look`)).json.look;

  await test('the core first, whole and in order, in branding and in a space\'s look', async () => {
    for (const read of [branding, look]) {
      const got = await read();
      assert.deepEqual(got.reactions, DEFAULT_REACTION_LIST);
      assert.deepEqual(got.icons, DEFAULT_ICON_LIST);
    }
  });

  await test('the owner\'s own additions come after the core; the core can\'t be left out, repeated or changed', async () => {
    const mine = [{ id: 'yes', glyph: '✅', label: 'Yes' }];
    const myIcons = [{ id: 'my-cat', classes: 'fa-solid fa-cat', label: 'cat' }];
    const saved = await call('PATCH', '/api/settings', { reactions: [...mine, { id: 'heart', glyph: 'x', label: 'Changed' }, { id: 'again', glyph: DEFAULT_REACTION_LIST[0].glyph, label: 'Twice' }], icons: [...myIcons, { ...DEFAULT_ICON_LIST[0], label: 'Changed' }] });
    assert.equal(saved.status, 200, saved.text);
    assert.deepEqual(saved.json.settings.ownReactions, mine, 'the settings keep only what the owner added');
    assert.deepEqual(saved.json.settings.ownIcons, myIcons);
    assert.equal(saved.json.settings.reactions.length, 106, 'and `reactions` is what the call reads: the core and the additions');
    for (const read of [branding, look]) {
      const got = await read();
      assert.deepEqual(got.reactions.slice(0, 105), DEFAULT_REACTION_LIST, 'the core, as it was');
      assert.deepEqual(ids(got.reactions).slice(105), ['yes']);
      assert.deepEqual(got.icons.slice(0, 113), DEFAULT_ICON_LIST);
      assert.deepEqual(ids(got.icons).slice(113), ['my-cat']);
    }
    // Leaving them all out (what a page that lists only the additions, or an empty list, sends) takes none of the core.
    assert.equal((await call('PATCH', '/api/settings', { reactions: [], icons: [] })).status, 200);
    assert.equal((await branding()).reactions.length, 105);
    assert.equal((await branding()).icons.length, 113);
    await call('PATCH', '/api/settings', { reactions: mine, icons: myIcons });
  });

  await test('an icon the owner adds, and every core icon, may be the home icon; one nobody has may not', async () => {
    assert.equal((await call('PATCH', '/api/settings', { homeIcon: 'my-cat' })).status, 200);
    assert.equal((await call('PATCH', '/api/settings', { homeIcon: 'dragon' })).status, 200, 'a core one');
    const bad = await call('PATCH', '/api/settings', { homeIcon: 'not-an-icon' });
    assert.equal(bad.status, 400, bad.text);
    assert.equal((await call('PATCH', '/api/settings', { homeIcon: null })).status, 200);
  });

  await test('a space has none of its own: a space save with reactions or icons changes neither list', async () => {
    const before = [await look(), await branding()].map((x) => [x.reactions, x.icons]);
    const r = await call('PATCH', `/api/spaces/${space}`, { reactions: [{ id: 'boat', glyph: '⛵', label: 'Boat' }], icons: [{ id: 'boat', classes: 'fa-solid fa-ship', label: 'ship' }], iconSet: ['ship'] });
    assert.equal(r.status, 200, r.text);
    for (const key of ['reactions', 'icons', 'iconSet']) assert.equal(key in r.json.space, false, `the space does not keep ${key}`);
    assert.deepEqual([await look(), await branding()].map((x) => [x.reactions, x.icons]), before);
    const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'app.json'), 'utf8'));
    assert.equal(JSON.stringify(stored.spaces).includes('boat'), false);
  });
} catch (err) {
  failed += 1;
  console.error(err.stack || err);
} finally {
  child.kill();
}

await test('a template\'s additions: after the core and the owner\'s own, once each, only where the template is read, never copied or offered', () => {
  const dir = fs.mkdtempSync(path.join(templatesDir, 'store-'));
  const store = new Store(dir);
  const project = templates.cleanTemplate({ id: 'project', name: 'Project', description: 'x', modules: { chat: {} }, reactions: [{ id: 'ship', glyph: '\u{1F680}', label: 'Ship it' }, { id: 'yes2', glyph: '✅', label: 'Twice' }], iconSet: ['diagram-project', 'cat'] });
  store.templateById = (id) => (id === 'project' ? project : templates.get(id) || null);
  store.catalogModuleIds = () => ['chat'];
  store.updateSettings({ reactions: [{ id: 'yes', glyph: '✅', label: 'Yes' }], icons: [{ id: 'cat', classes: 'fa-solid fa-cat', label: 'cat' }] });
  const space = store.addSpace({ name: 'Bridge', template: 'project' });
  const plain = store.addSpace({ name: 'Plain' });
  const mine = store.lookOf(space.id);
  assert.deepEqual(mine.reactions.slice(0, 105), DEFAULT_REACTION_LIST);
  assert.deepEqual(ids(mine.reactions).slice(105), ['yes', 'ship'], 'the owner\'s own, then the template\'s; a glyph the owner has already is not listed twice');
  assert.deepEqual(ids(mine.icons).slice(113), ['cat', 'diagram-project'], 'the same for icons');
  assert.deepEqual(ids(store.lookOf(plain.id).reactions).slice(105), ['yes'], 'a space on no template of its own reads the environment\'s, not project\'s');
  assert.deepEqual(ids(store.lookOf(null).icons).slice(113), ['cat']);
  assert.deepEqual([store.settings.reactions.map((r) => r.id), store.settings.icons.map((i) => i.id)], [['yes'], ['cat']], 'nothing of the template is copied into the settings');
  assert.equal(store.iconIds().includes('diagram-project'), false, 'a template only a space reads is not the environment\'s');
  templates.useLive(store, project);
  assert.equal(store.iconIds().includes('diagram-project'), true, 'the environment\'s own template\'s icons are the environment\'s: its pickers and checks know them');
  assert.deepEqual(ids(store.lookOf(plain.id).reactions).slice(105), ['yes', 'ship'], 'and a space reading it');
  // The core is the same object for no reader: a reader that changes its answer changes nothing.
  mine.reactions[0].glyph = 'x';
  assert.equal(store.lookOf(space.id).reactions[0].glyph, DEFAULT_REACTION_LIST[0].glyph);
  assert.equal(DEFAULT_REACTION_LIST[0].glyph, '❤️');
});

fs.rmSync(dataDir, { recursive: true, force: true });
fs.rmSync(templatesDir, { recursive: true, force: true });
if (failed) {
  console.error(`check-reactions-icons: ${failed} failed`);
  process.exit(1);
}
console.log(`check-reactions-icons: ${n} groups ok`);
