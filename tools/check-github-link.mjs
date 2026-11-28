#!/usr/bin/env node
/*
 * check-github-link.mjs -- a member's own GitHub account (documentation/plans/plan-github-full-sync.md, section 4 and step 2).
 *
 * In this process: the GitHub adapter's whoAmI reads only the account's id and login from GET /user; the owner's copy of the
 * environment (server/environment-export.js) leaves a person's `github` out.
 *
 * Then live, against a real server with the GitHub app set up and the test stand-in (ISSUES_TEST_STANDIN), whose sign-in half is
 * tools/lib/github-link-fake.mjs (now with GET /user): before GitHub's terms are accepted the row says so and POST /api/me/github is
 * refused; a member presses Link (POST /api/me/github: GitHub's authorize address, with the client id, the one back address, S256
 * and a state), GitHub sends them back to /api/issues-link/back, where the code is exchanged, GET /user read and the user token
 * revoked before anything is answered, and the person is sent on to /api/me/github/back, which stores { id, login, at } on them
 * and sends them to Profile; GET /api/me answers github: { login } to them only; the link works once; only the person who
 * started it finishes it (another member, and nobody signed in, are refused and it still works for them after); a second person is
 * refused the same GitHub id; GitHub refused, GET /user failing and a wrong completion secret store nothing and still revoke the
 * token; a guest, an agent and nobody are refused. Then the pull: the issue assigned to the linked account's id puts that member
 * in `owners` (an unlinked assignee stays a login); a renamed login is refreshed by id at the next pull and the member stays the
 * Owner; in a space that writes back an unlinked Owner set by hand stays and the linked one follows GitHub's assignment. Then
 * nothing of the link (the GitHub id or login) is in any other person's answer, an agent's, the server's log, issues.json, a
 * space's data or any other file; and no code, user token, refresh token, verifier or client secret anywhere. Then Unlink: the
 * link is gone and the next pull shows the login again. A second server with no app: the row's sentence, and 409 "This server has
 * no GitHub app.".
 *
 * Not checked here: GitHub itself (GET /user and the revoke through a registered app are seen only on a server with one).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { linkFake, linkThrough, followFrom } from './lib/github-link-fake.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT_ID = 'Iv1.checkgithublink';
const CLIENT_SECRET = 'checkgithublinkclientsecret0123456789abcd';
const PEM = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
const INSTALLATION_TOKEN = 'ghs_checkgithublinkinstallation0123456789';
const REPO = 'o/linked';
const MIA_ID = 987654321; // the linked account's GitHub id, and its logins before and after a rename: looked for everywhere
const MIA_LOGIN = 'octo-mia-seven';
const MIA_RENAMED = 'octo-mia-renamed';
const OUTSIDER = { id: 5550001, login: 'outside-helper' };
const NO_APP = 'This server has no GitHub app, so a GitHub account can\'t be linked.';

let n = 0;
const say = (...a) => console.log('check-github-link:', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const test = async (name, fn) => { try { await fn(); n += 1; } catch (err) { console.error(`check-github-link: ${name}: ${err.stack || err.message}`); process.exit(1); } };

// --- in this process -----------------------------------------------------------------------------------------------------------
process.env.ISSUES_TEST_STANDIN = 'http://127.0.0.1:9';
const GITHUB = require('../server/issue-providers/github.js');
const EXPORT = require('../server/environment-export.js');

await test('whoAmI reads only the id and the login from GET /user', async () => {
  const asked = [];
  const ask = (answer) => async (method, url, headers) => { asked.push({ method, url, auth: headers.Authorization }); return { status: answer.status, header: () => null, json: answer.json }; };
  const good = await GITHUB.whoAmI({ userToken: 'ghu_x' }, ask({ status: 200, json: { id: 41, login: 'octo-cat', name: 'Octo', email: 'o@c.t', avatar_url: 'https://x/y.png' } }));
  assert.deepEqual([good.status, good.id, good.login, good.bad], [200, 41, 'octo-cat', undefined]);
  assert.ok(!/Octo"|@|png/.test(JSON.stringify(good)), 'no name, e-mail address or picture');
  assert.deepEqual(asked[0], { method: 'GET', url: 'https://api.github.com/user', auth: 'Bearer ghu_x' }, 'GET /user on the API origin, the user token as the bearer');
  for (const json of [{ id: 0, login: 'a' }, { id: 1, login: '-a' }, { id: 1, login: 'bot[bot]' }, { id: '1', login: 'a' }, { login: 'a' }, [], null]) {
    assert.equal((await GITHUB.whoAmI({ userToken: 't' }, ask({ status: 200, json }))).bad, true, JSON.stringify(json));
  }
  const refused = await GITHUB.whoAmI({ userToken: 't' }, ask({ status: 401, json: { message: 'Bad credentials' } }));
  assert.deepEqual([refused.status, refused.id, refused.login], [401, undefined, undefined]);
});

await test('the owner\'s copy of the environment leaves a person\'s github out', () => {
  const data = { users: [{ key: 'abcd1234', login: 'mia', github: { id: 1, login: 'x', at: '2026-11-28T00:00:00.000Z' } }] };
  assert.equal('github' in EXPORT.exportApp(data).users[0], false);
  assert.deepEqual(EXPORT.unclassifiedFields(data), [], 'github is classified (left out)');
});

// --- the fake GitHub -----------------------------------------------------------------------------------------------------------
const links = linkFake({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
links.state.person.account = { id: MIA_ID, login: MIA_LOGIN };
links.state.person.installations = [{ id: 7, repositories: [{ id: 777, full_name: REPO, private: false, permissions: { push: true, pull: true }, created_at: '2026-01-01T00:00:00Z' }] }];
let clock = Date.parse('2026-11-20T00:00:00Z');
const issues = new Map();
const issue = (number, o = {}) => {
  clock += 1000;
  const had = issues.get(number) || {};
  const v = { number, title: `Server: issue ${number}`, state: 'open', labels: [], html_url: `https://github.com/${REPO}/issues/${number}`, created_at: had.created_at || new Date(clock).toISOString(), closed_at: null, milestone: null, body: '', user: { id: 1, login: 'someone' }, assignees: [], comments: 0, ...had, ...o, updated_at: new Date(clock).toISOString() };
  issues.set(number, v);
  return v;
};
const fake = http.createServer((req, res) => {
  if (links.handle(req, res)) return;
  req.resume();
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (u.pathname === '/app') return json(200, { id: 1, slug: 'link-check', name: 'Link check' });
    if (/^\/app\/installations\/\d+\/access_tokens$/.test(u.pathname)) return json(201, { token: INSTALLATION_TOKEN, expires_at: new Date(Date.now() + 3600000).toISOString(), repositories: [{ id: 777, full_name: REPO }] });
    if (/^\/app\/installations\/\d+$/.test(u.pathname)) return json(200, { id: 7, suspended_at: null });
    if (u.pathname === `/repos/${REPO}/milestones`) return json(200, []);
    if (u.pathname === `/repos/${REPO}/issues`) {
      const which = u.searchParams.get('state') || 'open';
      return json(200, [...issues.values()].filter((i) => which === 'all' || i.state === which));
    }
    return json(404, { message: 'Not Found' });
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${fake.address().port}`;

// --- the servers ---------------------------------------------------------------------------------------------------------------
const lk = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"participants":[]}'); }); });
await new Promise((r) => lk.listen(0, '127.0.0.1', r));
const children = [];
let serverOut = '';
async function startServer(dataDir, extra) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret',
      ADMIN_PASSWORD: 'testpass1234', AGENT_TOKENS: 'true', LIVEKIT_API_URL: `http://127.0.0.1:${lk.address().port}`, ISSUES_TEST_STANDIN: ORIGIN,
      ISSUES_TEST_GAP_MS: '200', ISSUES_TEST_POLL_MS: String(3600 * 1000), ISSUES_TEST_FULL_MS: '0', ...extra,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let out = '';
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the server did not start in time:\n${out}`)), 20000);
    const onData = (d) => { out += d; serverOut += d; const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
  return `http://127.0.0.1:${port}`;
}
const stopAll = () => Promise.all(children.map((c) => new Promise((resolve) => { if (c.exitCode !== null) return resolve(); c.once('exit', resolve); c.kill('SIGTERM'); })));
const fail = async (name, err) => { console.error(`check-github-link: ${name}: ${err.stack || err.message}\n--- server ---\n${serverOut.slice(-3000)}`); await stopAll(); process.exit(1); };
const live = async (name, fn) => { try { await fn(); n += 1; } catch (err) { await fail(name, err); } };

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-github-link-'));
const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-github-link-bare-'));
let base = '';
let bare = '';
try {
  base = await startServer(dataDir, { ISSUES_GITHUB_APP_CLIENT_ID: CLIENT_ID, ISSUES_GITHUB_APP_CLIENT_SECRET: CLIENT_SECRET, ISSUES_GITHUB_APP_KEY: PEM.replace(/\n/g, '\\n') });
  bare = await startServer(bareDir, {});
} catch (err) { await fail('the servers start', err); }

// Every answer anyone but the linked person reads, to look for the link in at the end; the person's own are kept apart.
const answers = [];
const own = [];
const call = async (method, urlPath, { body, token, mine = false, at = base } = {}) => {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(at + urlPath, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const text = await res.text();
  (mine ? own : answers).push(text);
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text, headers: res.headers };
};
const ok = (r, what, status = 200) => { assert.equal(r.status, status, `${what}: ${r.status} ${r.text.slice(0, 300)}`); return r; };
const appData = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'app.json'), 'utf8'));
const recordOf = (key) => appData().users.find((u) => u.key === key);
const S = {};

// One whole sign-in of a person's own account through the real routes: Link, GitHub's authorize page (the fake signs in and sends
// the browser back), the back address. Answers { start, back, to } (`to` where the back address sent the browser) and what the fake
// saw meanwhile (`requests`) and whether the token it issued was revoked when the back address answered (`revokedFirst`).
async function signIn(token) {
  const before = links.state.requests.length;
  const tokensBefore = links.state.issuedTokens.length;
  const out = { start: await call('POST', '/api/me/github', { token, body: {}, mine: true }) };
  if (out.start.status !== 200) return out;
  const authorize = await fetch(out.start.json.url, { redirect: 'manual' });
  await authorize.arrayBuffer();
  out.back = await fetch(authorize.headers.get('location'), { redirect: 'manual' });
  out.backText = await out.back.text();
  const issued = links.state.issuedTokens.slice(tokensBefore);
  out.revokedFirst = issued.length > 0 && issued.every((t) => links.state.revoked.includes(t));
  out.issued = issued;
  const loc = out.back.headers.get('location');
  out.to = loc ? new URL(loc, base) : null;
  out.requests = links.state.requests.slice(before).map((r) => `${r.method} ${r.path}`);
  return out;
}
// The browser goes on to the environment, signed in as `token` (or nobody).
const finish = async (to, token) => {
  const r = await fetch(to.href, { redirect: 'manual', headers: token ? { authorization: `Bearer ${token}` } : {} });
  const text = await r.text();
  answers.push(text);
  return { status: r.status, text, location: r.headers.get('location') };
};
const meOf = async (token) => ok(await call('GET', '/api/me', { token, mine: true }), 'me').json;

await live('set up: Projects, two members, an agent, a guest link, a space', async () => {
  S.admin = ok(await call('POST', '/api/login', { body: { login: 'admin', password: 'testpass1234' } }), 'the admin signs in').json.token;
  ok(await call('POST', '/api/modules/bundled/schedule/install', { token: S.admin, body: {} }), 'Projects installs', 201);
  ok(await call('PATCH', '/api/modules/schedule', { token: S.admin, body: { enabled: true, allSpaces: true } }), 'Projects turns on');
  ok(await call('PATCH', '/api/settings', { token: S.admin, body: { agents: true } }), 'agents on');
  S.miaKey = ok(await call('POST', '/api/users', { token: S.admin, body: { login: 'mia', displayName: 'Mia', role: 'member', password: 'memberpass1234' } }), 'mia', 201).json.user.key;
  S.noahKey = ok(await call('POST', '/api/users', { token: S.admin, body: { login: 'noah', displayName: 'Noah', role: 'member', password: 'memberpass1234' } }), 'noah', 201).json.user.key;
  const agent = ok(await call('POST', '/api/users', { token: S.admin, body: { agent: true } }), 'an agent', 201).json.user;
  S.agent = ok(await call('POST', `/api/users/${agent.key}/token`, { token: S.admin }), 'its token', 201).json.token;
  S.space = ok(await call('POST', '/api/spaces', { token: S.admin, body: { name: 'Bug Squash', members: [S.miaKey, S.noahKey, agent.key] } }), 'a space').json.space.id;
  ok(await call('PATCH', `/api/spaces/${S.space}`, { token: S.admin, body: { members: [S.miaKey, S.noahKey, agent.key], entry: 'guests' } }), 'its members');
  S.guest = ok(await call('POST', `/api/spaces/${S.space}/guest-link`, { token: S.admin, body: {} }), 'a guest link').json.space.guestToken;
  S.mia = ok(await call('POST', '/api/login', { body: { login: 'mia', password: 'memberpass1234' } }), 'mia signs in').json.token;
  S.noah = ok(await call('POST', '/api/login', { body: { login: 'noah', password: 'memberpass1234' } }), 'noah signs in').json.token;
});

await live('the terms first: the row says why, and Link is refused', async () => {
  const me = await meOf(S.mia);
  assert.equal(me.github, null);
  assert.equal(me.githubApp.on, false);
  assert.match(me.githubApp.why, /^Test stand-in \(not an issue service\)'s terms are not accepted on this server\./);
  const r = await call('POST', '/api/me/github', { token: S.mia, body: {}, mine: true });
  assert.deepEqual([r.status, r.json.error], [409, me.githubApp.why]);
  assert.equal(links.state.requests.length, 0, 'nothing asked of GitHub');
  ok(await call('PUT', '/api/weather/terms/issues-standin', { token: S.admin, body: { accept: true } }), 'the admin accepts the terms');
  assert.deepEqual((await meOf(S.mia)).githubApp, { on: true, why: '' });
});

await live('a guest, an agent and nobody cannot link', async () => {
  const guest = await call('POST', `/api/me/github?guest=${encodeURIComponent(S.guest)}`, { body: {} });
  assert.deepEqual([guest.status, guest.json.error], [403, 'Guests can\'t link a GitHub account.']);
  const guestOff = await call('DELETE', `/api/me/github?guest=${encodeURIComponent(S.guest)}`);
  assert.equal(guestOff.status, 403, 'nor unlink');
  for (const [m, p] of [['POST', '/api/me/github'], ['DELETE', '/api/me/github'], ['GET', '/api/me']]) {
    const r = await call(m, p, { token: S.agent, body: m === 'POST' ? {} : undefined });
    assert.ok([401, 403, 404].includes(r.status), `an agent: ${m} ${p} answers ${r.status}`);
  }
  assert.equal((await call('POST', '/api/me/github', { body: {} })).status, 401, 'nobody signed in');
  assert.equal(links.state.requests.length, 0, 'nothing asked of GitHub');
});

await live('a member links: the code exchanged, GET /user read, the token revoked before the answer, the account stored', async () => {
  const t = await signIn(S.mia);
  ok(t.start, 'Link');
  const u = new URL(t.start.json.url);
  assert.equal(u.origin + u.pathname, `${ORIGIN}/login/oauth/authorize`);
  assert.deepEqual([u.searchParams.get('client_id'), u.searchParams.get('redirect_uri'), u.searchParams.get('code_challenge_method')], [CLIENT_ID, `${base}/api/issues-link/back`, 'S256'], 'the app\'s client id, the one back address, PKCE');
  assert.ok((u.searchParams.get('state') || '').length >= 40, 'a state');
  assert.deepEqual(t.requests, ['GET /login/oauth/authorize', 'POST /login/oauth/access_token', 'GET /user', `DELETE /applications/${CLIENT_ID}/token`], 'exactly the exchange, GET /user and the revoke, in that order');
  assert.equal(t.revokedFirst, true, 'the user token was revoked before the back address answered');
  assert.equal(t.back.status, 302);
  assert.equal(t.to.origin + t.to.pathname, `${base}/api/me/github/back`, 'on to the environment to finish');
  assert.equal(t.back.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(recordOf(S.miaKey).github, undefined, 'nothing stored before the person finishes it');
  const done = await finish(t.to, S.mia);
  assert.deepEqual([done.status, done.location], [302, '/profile'], 'sent to Profile');
  const rec = recordOf(S.miaKey).github;
  assert.deepEqual([rec.id, rec.login, Object.keys(rec).sort()], [MIA_ID, MIA_LOGIN, ['at', 'id', 'login']], 'only the id, the login and when');
  assert.ok(Math.abs(Date.parse(rec.at) - Date.now()) < 60000);
  assert.deepEqual((await meOf(S.mia)).github, { login: MIA_LOGIN }, 'GET /api/me answers the login to the person');
  assert.equal((await meOf(S.noah)).github, null, 'another person has none');
  const again = await finish(t.to, S.mia);
  assert.equal(again.status, 400, 'the link works once');
  assert.match(again.text, /This link has run out\. Go back to Profile and press Link your GitHub account again\./);
});

await live('only the person who started it finishes it', async () => {
  ok(await call('DELETE', '/api/me/github', { token: S.mia, mine: true }), 'mia unlinks to try again');
  assert.equal(recordOf(S.miaKey).github, undefined);
  const t = await signIn(S.mia);
  const nobody = await finish(t.to, null);
  assert.equal(nobody.status, 401, 'nobody signed in');
  assert.match(nobody.text, /Sign in here as the person who pressed Link your GitHub account, then press it again\./);
  const other = await finish(t.to, S.noah);
  assert.equal(other.status, 400, 'another member');
  assert.equal(recordOf(S.noahKey).github, undefined, 'nothing on the other member');
  const wrong = new URL(t.to.href);
  wrong.searchParams.set('done', 'x'.repeat(43));
  assert.equal((await finish(wrong, S.mia)).status, 400, 'a wrong completion secret');
  const done = await finish(t.to, S.mia);
  assert.equal(done.status, 302, 'still the starter\'s to finish');
  assert.equal(recordOf(S.miaKey).github.id, MIA_ID);
});

await live('a second person is refused the same GitHub account', async () => {
  const t = await signIn(S.noah);
  assert.equal(t.revokedFirst, true);
  const done = await finish(t.to, S.noah);
  assert.equal(done.status, 409);
  assert.match(done.text, /That GitHub account is linked to someone else here\./);
  assert.equal(recordOf(S.noahKey).github, undefined);
  assert.equal(recordOf(S.miaKey).github.id, MIA_ID, 'the first link stays');
});

await live('GitHub refused, GET /user failing: nothing stored, the token still revoked', async () => {
  links.state.deny = true;
  const denied = await signIn(S.noah);
  links.state.deny = false;
  assert.equal(denied.back.status, 400);
  assert.match(denied.backText, /GitHub was not given access\. Go back to Profile and press Link your GitHub account again\./);
  assert.ok(!denied.requests.includes('POST /login/oauth/access_token'), 'no exchange');
  links.state.breakUser = true;
  const broken = await signIn(S.noah);
  links.state.breakUser = false;
  assert.equal(broken.back.status, 502);
  assert.match(broken.backText, /GitHub did not finish linking\./);
  assert.equal(broken.revokedFirst, true, 'revoked all the same, before the answer');
  assert.equal(recordOf(S.noahKey).github, undefined);
});

const plan = async () => Object.fromEntries((ok(await call('GET', `/api/modules/schedule/data?scope=space&space=${S.space}`, { token: S.admin }), 'the plan').json.items).map((e) => [e.key, e.value]));
const status = async () => ok(await call('GET', `/api/spaces/${S.space}/issues-pull`, { token: S.admin }), 'the status').json;
const until = async (what, fn, ms = 8000) => { const end = Date.now() + ms; for (;;) { const got = await fn(); if (got) return got; if (Date.now() > end) throw new Error(`waited for ${what}`); await sleep(100); } };
const pullNow = async () => {
  await until('the gap', async () => { const s = await status(); return !s.pulling && (!s.last || Date.now() - Date.parse(s.last) > 300); });
  const before = (await status()).last;
  ok(await call('POST', `/api/spaces/${S.space}/issues-pull/now`, { token: S.admin, body: {} }), 'pull now');
  return until('the pull', async () => { const s = await status(); return s.last && s.last !== before && !s.pulling ? s : null; });
};

await live('the pull: a linked assignee is an Owner, as the member; an unlinked one stays a login', async () => {
  issue(1, { assignees: [{ id: MIA_ID, login: MIA_LOGIN }, OUTSIDER] });
  issue(2, { assignees: [OUTSIDER] });
  const via = (method, p, body) => call(method, p, { token: S.admin, body });
  const t = await linkThrough({ call: via, space: S.space });
  assert.equal(t.list && t.list.status, 200, 'the space\'s link');
  ok(await followFrom({ call: via, space: S.space, link: t.link, repositoryId: 777 }), 'follow');
  await until('the first pull', async () => (await status()).last);
  const p = await plan();
  assert.deepEqual([p['plan:gh-1'].owners, p['plan:gh-1'].assignees], [[S.miaKey], [OUTSIDER.login]]);
  assert.deepEqual([p['plan:gh-2'].owners, p['plan:gh-2'].assignees], [undefined, [OUTSIDER.login]]);
});

await live('a renamed login is refreshed by id at the next pull', async () => {
  links.state.person.account = { id: MIA_ID, login: MIA_RENAMED };
  issue(1, { assignees: [{ id: MIA_ID, login: MIA_RENAMED }, OUTSIDER] });
  await pullNow();
  assert.equal(recordOf(S.miaKey).github.login, MIA_RENAMED);
  assert.deepEqual((await meOf(S.mia)).github, { login: MIA_RENAMED });
  assert.deepEqual((await plan())['plan:gh-1'].owners, [S.miaKey], 'still the Owner');
});

await live('writing back: an unlinked Owner set here stays; the linked one follows GitHub', async () => {
  ok(await call('PUT', `/api/spaces/${S.space}/issues-pull`, { token: S.admin, body: { write: true } }), 'writing on');
  const had = (await plan())['plan:gh-1'];
  ok(await call('PUT', `/api/modules/schedule/data/${encodeURIComponent('plan:gh-1')}?scope=space&space=${S.space}`, { token: S.admin, body: { value: { ...had, owners: [S.miaKey, S.noahKey] } } }), 'noah added as an Owner here');
  issue(1, { assignees: [OUTSIDER] }); // unassigned on GitHub
  await pullNow();
  assert.deepEqual((await plan())['plan:gh-1'].owners, [S.noahKey], 'mia follows GitHub; noah is the space\'s own');
  issue(1, { assignees: [{ id: MIA_ID, login: MIA_RENAMED }] });
  await pullNow();
  assert.deepEqual([...(await plan())['plan:gh-1'].owners].sort(), [S.miaKey, S.noahKey].sort(), 'assigned again');
});

await live('nothing of the link anywhere but the person\'s own record and answers', async () => {
  // Read by others: the owner's view of the people and of mia, noah's own, the agent's reads, the plan.
  for (const [p, token] of [['/api/users', S.admin], [`/api/users/${S.miaKey}`, S.admin], ['/api/me', S.noah], ['/api/me', S.admin], [`/api/modules/schedule/data?scope=space&space=${S.space}`, S.agent], [`/api/modules/schedule/data?scope=space&space=${S.space}`, S.noah], [`/api/spaces/${S.space}/issues-pull`, S.admin]]) await call('GET', p, { token });
  const marks = { 'the GitHub id': String(MIA_ID), 'the login': MIA_LOGIN, 'the new login': MIA_RENAMED };
  for (const [what, mark] of Object.entries(marks)) {
    answers.forEach((a, i) => assert.ok(!a.includes(mark), `${what} in another person's answer (${i}): ${a.slice(0, 200)}`));
    assert.ok(!serverOut.includes(mark), `${what} in the server's log`);
  }
  // Files: only app.json holds it, and only on mia's record.
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const file of walk(dataDir)) {
    const text = fs.readFileSync(file, 'utf8');
    if (path.relative(dataDir, file) === 'app.json') {
      const users = JSON.parse(text).users;
      assert.deepEqual(users.filter((u) => u.github).map((u) => u.key), [S.miaKey], 'only mia\'s record');
      continue;
    }
    for (const [what, mark] of Object.entries(marks)) assert.ok(!text.includes(mark), `${what} in ${path.relative(dataDir, file)}`);
  }
  assert.ok(fs.existsSync(path.join(dataDir, 'issues.json')) || walk(dataDir).some((f) => f.endsWith('issues.json')), 'issues.json was among the files read');
  // No secret of the sign-in anywhere: every answer (the person's own too), the log, every file.
  const everything = [...answers, ...own, serverOut, ...walk(dataDir).map((f) => fs.readFileSync(f, 'utf8'))];
  for (const [what, secret] of Object.entries(links.secrets())) {
    assert.ok(!everything.some((t) => t.includes(secret)), `${what} leaked`);
  }
});

await live('Unlink: the link is gone and the next pull shows the login again', async () => {
  const r = ok(await call('DELETE', '/api/me/github', { token: S.mia, mine: true }), 'unlink');
  assert.deepEqual(r.json, { github: null });
  assert.equal(recordOf(S.miaKey).github, undefined);
  assert.equal((await meOf(S.mia)).github, null);
  ok(await call('DELETE', '/api/me/github', { token: S.mia, mine: true }), 'unlinking twice is fine');
  issue(1, { assignees: [{ id: MIA_ID, login: MIA_RENAMED }] });
  await pullNow();
  assert.deepEqual((await plan())['plan:gh-1'].assignees, [MIA_RENAMED], 'a login again');
});

await live('a server with no app: the row\'s sentence, and 409', async () => {
  const admin = ok(await call('POST', '/api/login', { at: bare, body: { login: 'admin', password: 'testpass1234' } }), 'sign in').json.token;
  const me = ok(await call('GET', '/api/me', { at: bare, token: admin }), 'me').json;
  assert.deepEqual([me.github, me.githubApp], [null, { on: false, why: NO_APP }]);
  const r = await call('POST', '/api/me/github', { at: bare, token: admin, body: {} });
  assert.deepEqual([r.status, r.json.error], [409, 'This server has no GitHub app.']);
});

await stopAll();
await new Promise((r) => fake.close(r));
await new Promise((r) => lk.close(r));
for (const d of [dataDir, bareDir]) fs.rmSync(d, { recursive: true, force: true });
say(`OK (${n} groups)`);
process.exit(0);
