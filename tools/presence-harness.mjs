// What check-layout-presence.mjs and check-bring-everyone.mjs share: a throwaway server (no LiveKit needed), requests as
// a session cookie, a bearer token (an agent) or a guest link, live streams read as they arrive, and one space with every
// kind of viewer in it. Not a check of its own.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const quiet = (ms = 300) => new Promise((r) => setTimeout(r, ms));

// Starts the server with its own data folder; `env` adds to what every run has. Answers { port, dir, stop }.
export async function startServer(name, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dir, ADMIN_PASSWORD: 'testpass1234', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', AGENT_TOKENS: 'true', ...env },
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
  const stop = () => new Promise((resolve) => {
    const done = () => { fs.rmSync(dir, { recursive: true, force: true }); resolve(); };
    if (child.exitCode !== null) return done();
    child.once('exit', done);
    child.kill('SIGTERM');
  });
  return { port, dir, stop, log: () => out };
}

// `who` is a session token (sent as the cookie), { bearer } (an agent's token), or null.
export function client(port) {
  const headersOf = (who) => {
    const h = { accept: 'application/json' };
    if (typeof who === 'string') h.cookie = `app_session=${who}`;
    else if (who && who.bearer) h.authorization = `Bearer ${who.bearer}`;
    return h;
  };
  async function call(method, urlPath, { body, who, raw } = {}) {
    const headers = headersOf(who);
    if (body !== undefined || raw !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text, retryAfter: res.headers.get('retry-after') };
  }
  // An open live stream: `events` collects each event; `until(pred)` waits for one; `ready` is its first event.
  async function openStream(urlPath, who) {
    const ctl = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { headers: headersOf(who), signal: ctl.signal });
    const stream = { status: res.status, events: [], close: () => ctl.abort() };
    if (res.status !== 200) { stream.text = await res.text(); return stream; }
    const waiters = [];
    (async () => {
      const decoder = new TextDecoder();
      let buf = '';
      try {
        for await (const chunk of res.body) {
          buf += decoder.decode(chunk, { stream: true });
          let at;
          while ((at = buf.indexOf('\n\n')) >= 0) {
            const line = buf.slice(0, at).split('\n').find((l) => l.startsWith('data: '));
            buf = buf.slice(at + 2);
            if (!line) continue;
            stream.events.push(JSON.parse(line.slice(6)));
            for (const w of [...waiters]) w();
          }
        }
      } catch { /* closed */ }
    })();
    stream.until = (pred, ms = 5000) => new Promise((resolve, reject) => {
      const look = () => { const e = [...stream.events].reverse().find(pred); if (e) { clearTimeout(timer); waiters.splice(waiters.indexOf(look), 1); resolve(e); } };
      const timer = setTimeout(() => { waiters.splice(waiters.indexOf(look), 1); reject(new Error(`no such event; got ${JSON.stringify(stream.events).slice(0, 2000)}`)); }, ms);
      waiters.push(look);
      look();
    });
    stream.ready = await stream.until((e) => e.type === 'ready');
    return stream;
  }
  return { call, openStream };
}

// One space, Alpha, with the admin, an owner, a moderator, two members, an agent and a guest link; Beta, another space
// with its own moderator; someone outside both. Calendar and Documents on. Answers the tokens, keys, ids and the counter.
export async function seedSpace(call, count) {
  const expect = async (label, status, method, urlPath, opts) => {
    const r = await call(method, urlPath, opts);
    assert.equal(r.status, status, `${label}: ${method} ${urlPath} answered ${r.status} ${r.text}`);
    count();
    return r;
  };
  const admin = (await expect('admin signs in', 200, 'POST', '/api/login', { body: { login: 'admin', password: 'testpass1234' } })).json.token;
  for (const m of ['calendar', 'documents']) {
    await expect(`${m} installs`, 201, 'POST', `/api/modules/bundled/${m}/install`, { who: admin, body: {} });
    await expect(`${m} on`, 200, 'PATCH', `/api/modules/${m}`, { who: admin, body: { enabled: true } });
  }
  const mk = async (login, displayName, role = 'member') => (await expect(`make ${login}`, 201, 'POST', '/api/users', { who: admin, body: { login, displayName, role, password: 'memberpass1234' } })).json.user.key;
  const keys = { owner: await mk('olive', 'Olive', 'owner'), mod: await mk('mona', 'Mona'), member: await mk('mia', 'Mia'), member2: await mk('sam', 'Sam'), other: await mk('otto', 'Otto'), modB: await mk('mox', 'Mox') };
  await expect('agents on', 200, 'PATCH', '/api/settings', { who: admin, body: { agents: true } });
  keys.agent = (await expect('an agent', 201, 'POST', '/api/users', { who: admin, body: { agent: true } })).json.user.key;
  const space = async (name, members) => {
    const id = (await expect(`space ${name}`, 200, 'POST', '/api/spaces', { who: admin, body: { name, members } })).json.space.id;
    await expect('members', 200, 'PATCH', `/api/spaces/${id}`, { who: admin, body: { members } });
    return id;
  };
  const A = await space('Alpha', [keys.mod, keys.member, keys.member2, keys.agent]);
  const B = await space('Beta', [keys.modB, keys.member]);
  await expect('Alpha takes guests', 200, 'PATCH', `/api/spaces/${A}`, { who: admin, body: { entry: 'guests' } });
  await expect('mona moderates Alpha', 200, 'PATCH', `/api/users/${keys.mod}/spaces/${A}`, { who: admin, body: { permissions: { moderator: true } } });
  await expect('mox moderates Beta', 200, 'PATCH', `/api/users/${keys.modB}/spaces/${B}`, { who: admin, body: { permissions: { moderator: true } } });
  const T = { admin };
  for (const [who, login] of [['owner', 'olive'], ['mod', 'mona'], ['member', 'mia'], ['member2', 'sam'], ['other', 'otto'], ['modB', 'mox']]) T[who] = (await expect(`${login} signs in`, 200, 'POST', '/api/login', { body: { login, password: 'memberpass1234' } })).json.token;
  T.agent = { bearer: (await expect('the agent\'s token', 201, 'POST', `/api/users/${keys.agent}/token`, { who: admin })).json.token };
  const link = (await expect('a guest link', 200, 'POST', `/api/spaces/${A}/guest-link`, { who: admin, body: {} })).json.space.guestToken;
  const pass = (await expect('a guest enters', 200, 'POST', '/api/guest-join', { body: { token: link, name: 'Gil' } })).json.guest.pass;
  return { T, keys, A, B, link, pass, expect };
}
