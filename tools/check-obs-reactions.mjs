#!/usr/bin/env node
/*
 * check-obs-reactions.mjs -- the OBS and stream views float the reactions of the space the player is in
 * (plan-templates-redesign.md, "The correction of 2026-11-16": the environment's list, then the template's additions).
 * Against a throwaway seeded server with Kyoto on a template that adds a reaction (a unicorn):
 *   - GET /api/presence with the access key and no space holds the environment's list (what a reader with no space gets);
 *   - the same with ?space=<Kyoto> holds the list with the unicorn after it; the rest of the answer is the same shape;
 *   - ?space= of the Lobby, an unknown id or a space the viewer may not enter keeps the environment's list;
 *   - source: the stream view looks a reaction up in a Map (an id such as "toString" is none), asks for its space's list,
 *     and host.presence.get passes the space on.
 * A real OBS source and a real call need LiveKit and are not checked here.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { bootSeeded, stopServer, freePort } = await import('./shots.mjs');
let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

await test('the stream view looks a reaction up in a Map and reads its space\'s list (source)', () => {
  const s = read('modules', 'stream', 'src', 'stream-keyed.js');
  assert.doesNotMatch(s, /REACTIONS\[/, 'REACTIONS[id] finds toString on a plain object');
  assert.match(s, /REACTIONS = new Map\(/);
  assert.match(s, /host\.presence\.get\(space \? \{ space \}/, 'asks for the space\'s own list');
  assert.match(read('public', 'sdk', 'host.js'), /get: \(o\) => call\('presence\.get', \{ space: o && o\.space \}\)/);
  assert.match(read('public', 'module-host.js'), /p\.set\('space', String\(o\.space\)\)/);
});

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-obs-reactions-'));
let server;
try {
  const port = await freePort();
  const boot = await bootSeeded('travel', dataDir, port, {});
  server = boot.server;
  const { ctx, cookies } = boot;
  const jar = cookies.admin.map((c) => `${c.name}=${c.value}`).join('; ');
  const api = async (method, url, body, headers = { cookie: jar }) => {
    const r = await fetch(server.base + url, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch { /* none */ }
    return { status: r.status, json };
  };
  assert.equal((await api('POST', '/api/environment/templates', { from: 'games', id: 'extra', name: 'Extra' })).status, 201);
  assert.equal((await api('PATCH', '/api/environment/templates/extra', { reactions: [{ id: 'unicorn-x', glyph: '\u{1F984}', label: 'Unicorn' }] })).status, 200);
  assert.equal((await api('PATCH', `/api/spaces/${ctx.second}`, { template: 'extra' })).status, 200);
  const key = (await api('GET', '/api/settings')).json.streamKey;
  const keyed = { 'x-stream-key': key };
  const ids = (r) => r.json.reactions.map((x) => x.id);
  const env = ids(await api('GET', '/api/presence', undefined, keyed));
  const asId = (space) => api('GET', `/api/presence?space=${encodeURIComponent(space)}`, undefined, keyed);

  await test('no space: the environment\'s list', () => assert.equal(env.includes('unicorn-x'), false));
  await test('a space on a template that adds a reaction: the list with the addition after it, the same answer otherwise', async () => {
    const [plain, kyoto] = [await api('GET', '/api/presence', undefined, keyed), await asId(ctx.second)];
    assert.deepEqual(ids(kyoto), [...env, 'unicorn-x']);
    assert.deepEqual(Object.keys(kyoto.json).sort(), Object.keys(plain.json).sort());
  });
  await test('the other space, the Lobby and an unknown id keep the environment\'s list', async () => {
    for (const id of [ctx.trip, 'lobby', 'nope']) assert.deepEqual(ids(await asId(id)), env, id);
  });
} finally {
  if (server) await stopServer(server);
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(failed ? `check-obs-reactions: ${failed} FAILED, ${n} passed` : `check-obs-reactions: OK (${n} tests)`);
process.exit(failed ? 1 : 0);
