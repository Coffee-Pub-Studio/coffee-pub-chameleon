#!/usr/bin/env node
/**
 * The route table check (plan-core-parts, step 1).
 *
 * Starts the server with tools/route-walk-preload.cjs, which writes every route and middleware the server mounts, in
 * mount order, and compares that walk with the committed tools/route-table.json. Any route or middleware added, removed,
 * renamed, moved or re-marked fails, and the difference is printed. It needs no LiveKit server and no network: the server
 * only has to start, and it is stopped as soon as the walk is written.
 *
 *   node tools/check-route-table.mjs            compare
 *   node tools/check-route-table.mjs --update   rewrite tools/route-table.json from the server as it is now
 *
 * A row is { kind, method, path, name, part }:
 *   kind    'route' (one row per method) or 'use' (a middleware or a mounted app)
 *   method  the upper-case method, '_all' for app.all, null for a 'use'
 *   path    the full path, a mounted router's prefix included
 *   name    the middleware's name for a 'use', null for a route
 *   part    the id of the part that mounts it; null until the base marks layers (plan-core-parts, step 2)
 * A step that adds or removes a route updates the file in the same pull request, so the change is seen.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TABLE = path.join(ROOT, 'tools', 'route-table.json');
const update = process.argv.includes('--update');

function rowOf(e) {
  if (e.kind === 'route') return { kind: 'route', method: e.method, path: e.path, name: null, part: e.part ?? null };
  return { kind: 'use', method: null, path: e.path, name: e.name, part: e.part ?? null };
}
const show = (r) => `${r.kind === 'route' ? r.method : 'USE'} ${r.path}${r.name ? ` (${r.name})` : ''}${r.part ? ` [${r.part}]` : ''}`;
const key = (r) => JSON.stringify([r.kind, r.method, r.path, r.name, r.part]);

// Ends the child and resolves once the process has exited: SIGTERM, then SIGKILL if it has not gone in 10 seconds.
function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const kill = setTimeout(() => child.kill('SIGKILL'), 10000);
    child.once('exit', () => { clearTimeout(kill); resolve(); });
    child.kill('SIGTERM');
  });
}

async function walkServer() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'check-route-table-'));
  const out = path.join(work, 'walk.json');
  // Only what the server needs to start, set here so the walk is the same on a laptop and in CI.
  const env = {
    PATH: process.env.PATH, HOME: work, PORT: '0', DATA_DIR: path.join(work, 'data'), ROUTE_WALK_OUT: out,
    ADMIN_PASSWORD: 'admin-password-1', AGENT_TOKENS: 'true', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret',
  };
  const child = spawn(process.execPath, ['-r', path.join(ROOT, 'tools', 'route-walk-preload.cjs'), path.join(ROOT, 'server', 'index.js')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`The server did not start in time.\n${log}`)), 30000);
      const onData = (d) => { log += d; if (/listening on :\d+/.test(log)) { clearTimeout(timer); resolve(); } };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`The server stopped (${code}).\n${log}`)); });
    });
    const walk = JSON.parse(fs.readFileSync(out, 'utf8'));
    const unknown = walk.filter((e) => e.kind === 'unknown');
    if (unknown.length) throw new Error(`The walk could not read the path of: ${unknown.map((u) => u.name).join(', ')}.`);
    return walk.map(rowOf);
  } finally {
    // The server is still running here and may be writing into its data folder: stop it, wait for the process to be gone, and only
    // then remove the folder. (Removing it under a live server failed once in CI with ENOTEMPTY.)
    child.removeAllListeners('exit');
    await stopChild(child);
    // Only a backstop (a slow disk); the wait above is the fix.
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

const rows = await walkServer();

if (update) {
  fs.writeFileSync(TABLE, `{\n "rows": [\n${rows.map((r) => `  ${JSON.stringify(r)}`).join(',\n')}\n ]\n}\n`);
  console.log(`check-route-table: wrote ${rows.length} rows to tools/route-table.json`);
  process.exit(0);
}

if (!fs.existsSync(TABLE)) {
  console.error('check-route-table: tools/route-table.json is missing. Run: node tools/check-route-table.mjs --update');
  process.exit(1);
}
const want = JSON.parse(fs.readFileSync(TABLE, 'utf8')).rows;

// Added and removed, by what the row is; then, if the same rows are all there, the first place the order differs.
const wantKeys = want.map(key);
const haveKeys = rows.map(key);
const count = (list) => list.reduce((m, k) => m.set(k, (m.get(k) || 0) + 1), new Map());
const wantCount = count(wantKeys);
const haveCount = count(haveKeys);
const lines = [];
for (const r of rows) if ((haveCount.get(key(r)) || 0) > (wantCount.get(key(r)) || 0)) { lines.push(`  added    ${show(r)}`); haveCount.set(key(r), haveCount.get(key(r)) - 1); }
for (const r of want) if ((wantCount.get(key(r)) || 0) > (count(haveKeys).get(key(r)) || 0)) { lines.push(`  removed  ${show(r)}`); wantCount.set(key(r), wantCount.get(key(r)) - 1); }
if (!lines.length && wantKeys.join('\n') !== haveKeys.join('\n')) {
  const i = wantKeys.findIndex((k, n) => k !== haveKeys[n]);
  lines.push(`  moved    the order differs from row ${i + 1}: the table has ${show(want[i])}, the server mounts ${show(rows[i])}`);
}

if (lines.length) {
  console.error(`check-route-table: the server's routes are not the ones in tools/route-table.json (${want.length} rows there, ${rows.length} now).\n${lines.join('\n')}\nIf the change is meant, run: node tools/check-route-table.mjs --update, and commit the file.`);
  process.exit(1);
}
console.log(`check-route-table: ok (${rows.length} rows)`);
