#!/usr/bin/env node
/*
 * check-template-ai.mjs -- the AI is offered in a space on every shipped template.
 *
 * A space's template decides its modules (ModuleManager#onInSpace, store.moduleOffered); a template that leaves out
 * `assistant` makes the AI answer "AI Assistant is not one of this space's modules." (reason not-here) whatever the owner
 * set. The Project, Learning and Mentoring templates did, after the templates redesign. Part 1 reads every
 * templates/*.json: it offers "assistant" ("*" or a listed id), or it is in NO_AI below with a reason (none is). Part 2, per
 * shipped template, on a throwaway server (PORT=0, DATA_DIR under the system tmpdir, AI service a stand-in on a local port,
 * no network): a space on that template (its own, and one reading the environment's) is asked a question through
 * POST /api/spaces/:id/ai, the route the Chat Assistant view uses, and the answer is the stand-in's, never 403 not-here.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// A template that deliberately has no AI: { <template id>: <the reason> }. Adding one is a decision for Thomas.
const NO_AI = {};

const say = (...a) => console.log('check-template-ai:', ...a);
const ids = fs.readdirSync(path.join(ROOT, 'templates')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
assert.ok(ids.length >= 6, `the shipped templates: ${ids}`);

for (const id of ids) {
  const t = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', `${id}.json`), 'utf8'));
  const offers = t.modules === '*' || (t.modules && typeof t.modules === 'object' && Object.prototype.hasOwnProperty.call(t.modules, 'assistant'));
  if (NO_AI[id]) { assert.ok(!offers, `templates/${id}.json is in NO_AI but offers assistant`); continue; }
  assert.ok(offers, `templates/${id}.json does not offer "assistant" in its modules: the AI is refused in every space made from it. Add "assistant": {} (or list it in NO_AI with a reason).`);
}
say(`part 1: ${ids.length} templates, each offers the AI Assistant or says why not`);

const stub = http.createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'stub-model' }] }));
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'A plain stub answer.' }, finish_reason: 'stop' }], usage: { total_tokens: 10 } }));
  });
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
const stubAddress = `http://127.0.0.1:${stub.address().port}`;

function startServer(dataDir, env) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, TZ: 'UTC', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ADMIN_PASSWORD: 'admin-password-1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 20000);
    const onData = (d) => { out += d; const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve({ port: Number(m[1]), stop: () => new Promise((r) => { if (child.exitCode !== null) return r(); child.once('exit', r); child.kill('SIGTERM'); }) }); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
}
async function call(server, method, urlPath, { body, cookie } = {}) {
  const res = await fetch(`http://127.0.0.1:${server.port}${urlPath}`, { method, headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${server.port}`, ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text, res };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-template-ai-'));
let failed = false;
try {
  for (const id of ids.filter((t) => !NO_AI[t])) {
    const server = await startServer(path.join(tmp, id), id === 'default' ? {} : { TEMPLATE: id });
    try {
      const login = await call(server, 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } });
      assert.equal(login.status, 200, login.text);
      const cookie = (login.res.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');
      const as = (method, url, body) => call(server, method, url, { cookie, body });
      const inst = await as('POST', '/api/modules/bundled/assistant/install');
      assert.ok([200, 201].includes(inst.status), `install assistant: ${inst.text}`);
      if (inst.json?.module?.needsApproval) await as('POST', '/api/modules/assistant/approve', {});
      assert.equal((await as('PATCH', '/api/modules/assistant', { enabled: true })).status, 200);
      const set = await as('PUT', '/api/ai', { enabled: true, provider: 'compatible', address: stubAddress, model: 'stub-model', key: 'sk-stub' });
      assert.equal(set.status, 200, set.text);
      const own = await as('POST', '/api/spaces', { name: `On ${id}`, template: id });
      const plain = await as('POST', '/api/spaces', { name: `Plain on ${id}` });
      for (const [label, r] of [['its own template', own], ['the environment template', plain]]) {
        assert.ok([200, 201].includes(r.status), r.text);
        const sp = r.json.space.id;
        const avail = await as('GET', `/api/spaces/${sp}/ai`);
        assert.notEqual(avail.json?.reason, 'not-here', `${id} (${label}): the AI is not offered: ${avail.text}`);
        const ask = await as('POST', `/api/spaces/${sp}/ai`, { question: 'What is next?' });
        assert.equal(ask.status, 200, `${id} (${label}): asking the AI gave ${ask.status} ${ask.text}`);
        assert.match(JSON.stringify(ask.json), /plain stub answer/, `${id} (${label}): not the stand-in's answer`);
      }
      say(`${id}: a space on its own template and one on the environment's both get the stand-in's answer`);
    } finally { await server.stop(); }
  }
} catch (err) { failed = true; console.error(`check-template-ai: FAILED: ${err.message}`); }
finally { stub.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
if (failed) process.exit(1);
say('OK');
process.exit(0);
