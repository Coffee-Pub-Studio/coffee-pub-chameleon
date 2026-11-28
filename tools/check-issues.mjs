#!/usr/bin/env node
/*
 * check-issues.mjs -- the issue pull (documentation/plans/plan-github-pull.md, step 1): a repository's issues pulled into one
 * space's Planner - Projects, one way.
 *
 * In this process, against a fake GitHub (an http server speaking the REST shape) and the test stand-in adapter
 * (server/issue-providers/test-standin.js, the GitHub adapter at another origin): GitHub's reading (pull requests skipped, no
 * person, no body, labels, milestones, the next page only on its own origin); only GitHub registered without the stand-in's
 * variable; the mapping (closed is done, the `priority: now|next|later` labels are columns, anything else open is the inbox, the
 * title cut at 120, tags from the other labels, the link as the notes, no owners, the board's five columns); the rest after a
 * refusal (retry-after, the limit's reset, else 30 minutes); the ask (pages, a 304, the token only in Authorization, 2 MB,
 * a redirect elsewhere refused); the shared terms record (one file for every service, which starts empty).
 *
 * Then live, against a real server with ISSUES_TEST_STANDIN and a token: who may turn it on (only an owner: a member, a guest,
 * an agent and nobody are refused), the terms first, only into an empty plan, the board fixed to inbox, now, next, later and
 * done, every write by system:issues, a second pull in place (never a copy), a 304 that changes nothing, a label moving work, a
 * close moving it to done, a person's write to the plan or the board refused while it is on, Pull now's gap, the service's 429
 * obeyed and the timer picking up after it, the full pull removing an issue that is gone, a repository that is not there, off
 * leaving the work editable, and the token never in an answer, the data, the record or the server's log.
 *
 * Then writing back (documentation/plans/plan-github-two-way.md, step 1), against the same fake, which now takes writes and
 * records every request it receives (method, path, body, headers): only an owner turns writing on, and only for a repository
 * ISSUES_GITHUB_WRITE names (any other: refused before a request); a move writes exactly the label removal and addition, Inbox
 * only removes, Done closes with `completed`, out of Done reopens and labels, a title is one PATCH, a tag one label; a title that
 * GitHub holds longer than 120 characters, a tag with no label, a GitHub-only field and a member without `writeOut` are
 * refused with nothing sent; the space's own fields are stored here with no request and kept by the next pull; a new issue is
 * made with a title and one label and an empty body; the echo of our own write is skipped by the next pull; a pull carrying an
 * older issue does not overwrite a newer write; a change to the same field on GitHub is refused (409) and the work shows GitHub's
 * version, a change to another field goes ahead and keeps the label someone added; 401, 403 with a wait, 422, 429 and silence
 * each change nothing here and give their sentence, and the wait rests every write; a write is not held behind a pull under way;
 * an agent's setColumn, setDone and updateEntry on pulled work go through the same way (only with `write_out` ticked in the Agent
 * column, which is off to start with; its own sentence without it; GitHub-only fields, a cut title and a delete refused; the conflict
 * rule; writing off as today), and its Undo is another write held to the same rule;
 * every request the fake saw holds only the fields the plan allows, nothing of the space or the people, and the token only in
 * Authorization.
 *
 * Not checked here: a real request to api.github.com (no network in a check; the terms must be accepted by a person first), and
 * GitHub's real secondary-limit answers.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { linkFake, linkThrough, followFrom, doneOf } from './lib/github-link-fake.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'ghs_checkissuesinstallation0123456789abcdef'; // the installation token the fake mints
// The app's credentials, made fresh on each run and never written to the repository: the key pair, a client id and a secret.
const KEYS = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const OTHER_KEYS = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = KEYS.privateKey.export({ type: 'pkcs1', format: 'pem' });
const CLIENT_ID = 'Iv1.checkissuesclient';
const CLIENT_SECRET = 'checkissuesclientsecret0123456789abcdef0123';
// The fake's installations: the repository each one reaches, by id.
const INSTALLS = { 7: { id: 777, name: 'Coffee-Pub-Studio/coffee-pub-chameleon' }, 8: { id: 888, name: 'other/repo' }, 9: { id: 999, name: 'other/repo' }, 10: { id: 1010, name: 'other/repo' } };
const REPO = 'Coffee-Pub-Studio/coffee-pub-chameleon';
// The sign-in half of the fake (tools/lib/github-link-fake.mjs) and what the signed-in GitHub account reaches: the person may write to
// repositories 777 and 999 (push) and only read 888 and 1010 (pull).
const links = linkFake({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
const repoOf = (id, full_name, push, created) => ({ id, full_name, private: false, permissions: { admin: false, maintain: false, push, triage: false, pull: true }, created_at: created });
links.state.person.installations = [
  { id: 7, repositories: [repoOf(777, REPO, true, '2026-01-01T00:00:00Z')] },
  { id: 8, repositories: [repoOf(888, 'other/repo', false, '2026-02-01T00:00:00Z')] },
  { id: 9, repositories: [repoOf(999, 'other/repo', true, '2026-03-01T00:00:00Z')] },
  { id: 10, repositories: [repoOf(1010, 'other/repo', false, '2026-04-01T00:00:00Z')] },
];

let n = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { console.error(`check-issues: ${name}: ${err.stack || err.message}`); process.exit(1); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- a fake GitHub ---------------------------------------------------------------------------------------------------------
// Holds issues (and pull requests) in GitHub's shape; answers GET /repos/:owner/:repo/issues with state, since, per_page and
// page, a Link header to the next page, an etag per answer and a 304 to a matching If-None-Match. `once` replaces the next
// answer (a 429, a 403, a redirect). Every request is kept.
function fakeGitHub() {
  const seen = [];
  const app = []; // every request to the app's endpoints, apart from `seen` (the issues): { method, path, body, jwt, headers }
  const jwts = new Set(); // every JWT the fake received, to look for in the outputs
  const state = {
    mints: [], mintOnce: null, mintTtlMs: 3600 * 1000, mintToken: null, installs: { 7: { mode: 'ok' }, 8: { mode: 'ok' }, 9: { mode: 'ok' }, 10: { mode: 'ok' } }, publicKey: KEYS.publicKey,
    issues: new Map(), once: null, onceWrite: null, slowList: 0, missing: new Set(), clock: Date.parse('2026-11-01T00:00:00Z'),
    labels: new Set(['priority: now', 'priority: next', 'priority: later', 'bug', 'good first issue', 'docs']), created: [],
  };
  const tick = () => { state.clock += 1000; return new Date(state.clock).toISOString(); };
  const issue = (number, o = {}) => {
    const t = tick();
    const had = state.issues.get(number);
    const v = {
      number, title: `Server: issue ${number}`, state: 'open', labels: [], html_url: `https://github.com/${REPO}/issues/${number}`,
      created_at: had ? had.created_at : t, closed_at: null, milestone: null, body: 'A private body', user: { login: 'someone' },
      assignees: [{ login: 'someone' }], ...(had || {}), ...o, updated_at: t,
    };
    if (v.state === 'closed' && !v.closed_at) v.closed_at = t;
    if (v.state === 'open') v.closed_at = null;
    state.issues.set(number, v);
    return v;
  };
  const label = (name, color = 'ededed') => ({ id: 1, name, color });
  const json = (res, status, body, extra = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...extra }); res.end(JSON.stringify(body)); };
  // The app's JWT as GitHub reads it: RS256 signed by the app's key, with iat, exp (at most 10 minutes after iat) and iss.
  const readJwt = (header) => {
    const m = /^Bearer ([\w-]+)\.([\w-]+)\.([\w-]+)$/.exec(header || '');
    if (!m) return null;
    try {
      const head = JSON.parse(Buffer.from(m[1], 'base64url'));
      const claims = JSON.parse(Buffer.from(m[2], 'base64url'));
      jwts.add(header.slice(7));
      const good = crypto.verify('RSA-SHA256', Buffer.from(`${m[1]}.${m[2]}`), state.publicKey, Buffer.from(m[3], 'base64url'));
      return { head, claims, good };
    } catch { return null; }
  };
  const handleApp = (req, res, body) => {
    const u = new URL(req.url, 'http://x');
    const jwt = readJwt(req.headers.authorization);
    app.push({ method: req.method, path: u.pathname, body, jwt, headers: req.headers });
    const nowS = Date.now() / 1000;
    if (!jwt || !jwt.good || jwt.head.alg !== 'RS256' || !(jwt.claims.exp > nowS) || jwt.claims.exp - jwt.claims.iat > 600) return json(res, 401, { message: 'A JSON web token could not be decoded' });
    if (req.method === 'GET' && u.pathname === '/app') return json(res, 200, { id: 1, slug: 'chameleon-check', name: 'Chameleon Check', owner: { login: 'someone' } });
    const info = /^\/app\/installations\/(\d+)$/.exec(u.pathname);
    if (info && req.method === 'GET') {
      const mode = (state.installs[info[1]] || {}).mode;
      return INSTALLS[info[1]] && mode !== 'gone' ? json(res, 200, { id: Number(info[1]), suspended_at: mode === 'suspended' ? '2026-11-20T00:00:00Z' : null }) : json(res, 404, { message: 'Not Found' });
    }
    const m = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(u.pathname);
    if (m && req.method === 'POST') {
      if (state.mintOnce) { const f = state.mintOnce; state.mintOnce = null; return f(req, res); }
      const inst = INSTALLS[m[1]];
      const mode = (state.installs[m[1]] || {}).mode;
      if (!inst || mode === 'gone') return json(res, 404, { message: 'Not Found' });
      // GitHub's own signal is `suspended_at` on the installation (GET /app/installations/{id}), not the mint's words: a suspended
      // installation here answers a mint with words that do not say so, and 'forbidden' answers words that do, with no suspension.
      if (mode === 'suspended') return json(res, 403, { message: 'Resource not accessible by integration' });
      if (mode === 'forbidden') return json(res, 403, { message: 'This installation has been suspended' });
      if (!body || !Array.isArray(body.repository_ids) || !body.repository_ids.includes(inst.id)) return json(res, 422, { message: 'Validation Failed: the repository is not in the installation' });
      state.mints.push(body);
      const at = state.mintTtlMs;
      return json(res, 201, {
        token: state.mintToken || TOKEN, expires_at: new Date(Date.now() + at).toISOString(), permissions: body.permissions,
        repository_selection: 'selected', repositories: [{ id: inst.id, full_name: (state.installs[m[1]] || {}).rename || inst.name }],
      });
    }
    return json(res, 404, { message: 'Not Found' });
  };
  const handle = (req, res, raw) => {
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = '(not json)'; }
    if (req.url === '/app' || req.url.startsWith('/app/')) return handleApp(req, res, body);
    seen.push({ method: req.method, url: req.url, headers: req.headers, body, raw });
    if (state.once) { const f = state.once; state.once = null; return f(req, res); }
    if (req.method !== 'GET' && state.onceWrite) { const f = state.onceWrite; state.onceWrite = null; return f(req, res); }
    const u = new URL(req.url, 'http://x');
    let m = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(u.pathname);
    if (m && !state.missing.has(m[1])) {
      const cur = state.issues.get(Number(m[2]));
      if (!cur) return json(res, 404, { message: 'Not Found' });
      if (req.method === 'PATCH') {
        const o = {};
        if (body.title !== undefined) o.title = body.title;
        if (body.state) { o.state = body.state; if (body.state === 'open') o.closed_at = null; }
        if (body.title === '(reject)') return json(res, 422, { message: 'Validation Failed.' });
        return json(res, 200, issue(cur.number, o));
      }
      const etag = `W/"${cur.updated_at}"`;
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { etag }); return res.end(); }
      return json(res, 200, cur, { etag });
    }
    m = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/labels$/.exec(u.pathname);
    if (m && req.method === 'POST') {
      const cur = state.issues.get(Number(m[2]));
      if (!cur) return json(res, 404, { message: 'Not Found' });
      for (const name of body.labels) if (!state.labels.has(name)) state.created.push(name);
      const labels = [...cur.labels, ...body.labels.filter((n) => !cur.labels.some((l) => l.name === n)).map((n) => label(n))];
      issue(cur.number, { labels });
      return json(res, 200, labels);
    }
    m = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/labels\/(.+)$/.exec(u.pathname);
    if (m && req.method === 'DELETE') {
      const cur = state.issues.get(Number(m[2]));
      const name = decodeURIComponent(m[3]);
      if (!cur || !cur.labels.some((l) => l.name === name)) return json(res, 404, { message: 'Label does not exist' });
      const labels = cur.labels.filter((l) => l.name !== name);
      issue(cur.number, { labels });
      return json(res, 200, labels);
    }
    m = /^\/repos\/([^/]+\/[^/]+)\/labels\/(.+)$/.exec(u.pathname);
    if (m && req.method === 'GET') return state.labels.has(decodeURIComponent(m[2])) ? json(res, 200, { name: decodeURIComponent(m[2]) }) : json(res, 404, { message: 'Not Found' });
    m = /^\/repos\/([^/]+)\/([^/]+)\/issues$/.exec(u.pathname);
    if (m && req.method === 'POST') {
      for (const name of body.labels || []) if (!state.labels.has(name)) state.created.push(name);
      const number = Math.max(0, ...state.issues.keys()) + 1;
      return json(res, 201, issue(number, { title: body.title, labels: (body.labels || []).map((n) => label(n)), ...(body.body !== undefined ? { body: body.body } : { body: null }) }));
    }
    if (!m || state.missing.has(`${m[1]}/${m[2]}`)) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"message":"Not Found"}'); }
    const send = () => {
      const since = u.searchParams.get('since');
      const per = Number(u.searchParams.get('per_page') || 30);
      const page = Number(u.searchParams.get('page') || 1);
      let list = [...state.issues.values()].sort((a, b) => a.updated_at.localeCompare(b.updated_at));
      if (since) list = list.filter((i) => i.updated_at >= since);
      const slice = list.slice((page - 1) * per, page * per);
      const text = JSON.stringify(slice);
      const etag = `W/"${Buffer.from(`${u.search}|${text}`).toString('base64').slice(-24)}"`;
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { etag }); return res.end(); }
      const headers = { 'content-type': 'application/json', etag, 'x-ratelimit-remaining': '4999' };
      if (page * per < list.length) {
        const next = new URL(req.url, `http://${req.headers.host}`);
        next.searchParams.set('page', String(page + 1));
        headers.link = `<${next.href}>; rel="next"`;
      }
      res.writeHead(200, headers);
      res.end(text);
    };
    if (state.slowList) { const ms = state.slowList; state.slowList = 0; return void setTimeout(send, ms); }
    send();
  };
  const server = http.createServer((req, res) => {
    if (links.handle(req, res)) return;
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => handle(req, res, Buffer.concat(chunks).toString('utf8')));
  });
  return { server, seen, app, jwts, state, issue, label };
}

const gh = fakeGitHub();
await new Promise((r) => gh.server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${gh.server.address().port}`;
process.env.ISSUES_TEST_STANDIN = ORIGIN;
const I = require('../server/issues.js');
const GITHUB = require('../server/issue-providers/github.js');
const STANDIN = require('../server/issue-providers/test-standin.js');

// --- GitHub's reading ------------------------------------------------------------------------------------------------------
await test('GitHub\'s answer read as records: pull requests skipped, no person, no body', () => {
  const raw = {
    number: 12, title: '  Chat:\u0007 a title  ', state: 'closed', html_url: 'https://github.com/o/r/issues/12', created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-03T10:00:00Z', closed_at: '2026-10-02T09:00:00Z', labels: [{ name: 'priority: now', color: 'B60205' }, 'bug', { name: '' }],
    milestone: { number: 3, title: 'Release', due_on: '2026-12-01T08:00:00Z', state: 'open' }, body: 'secret body', user: { login: 'who' }, assignees: [{ login: 'who' }],
  };
  const r = GITHUB.record(raw);
  assert.deepEqual(r, {
    number: 12, title: 'Chat:  a title', open: false, labels: [{ name: 'priority: now', color: 'b60205' }, { name: 'bug', color: '' }],
    url: 'https://github.com/o/r/issues/12', created: '2026-10-01T10:00:00.000Z', updated: '2026-10-03T10:00:00.000Z', closed: '2026-10-02T09:00:00.000Z',
    milestone: { number: 3, title: 'Release', due: '2026-12-01', open: true },
  });
  assert.ok(!/who|secret/.test(JSON.stringify(r)), 'no login, no body');
  assert.equal(GITHUB.record({ ...raw, pull_request: { url: 'x' } }), null, 'a pull request is not an issue');
  assert.equal(GITHUB.record({ ...raw, html_url: 'javascript:alert(1)' }).url, '', 'only a github.com link');
  assert.equal(GITHUB.record({ ...raw, number: 'x' }), null);
  assert.equal(GITHUB.nextPage('<https://api.github.com/repos/o/r/issues?page=2>; rel="next", <https://api.github.com/x>; rel="last"', 'https://api.github.com'), 'https://api.github.com/repos/o/r/issues?page=2');
  assert.equal(GITHUB.nextPage('<https://evil.example/repos?page=2>; rel="next"', 'https://api.github.com'), null, 'a next page elsewhere is not followed');
  const h = (o) => (k) => (k in o ? o[k] : null);
  assert.deepEqual(GITHUB.waitOf(h({ 'retry-after': '60' })), { retryAfterMs: 60000 });
  assert.deepEqual(GITHUB.waitOf(h({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000', 'x-poll-interval': '120' })), { resetAt: 1800000000000, pollMs: 120000 });
  assert.equal(GITHUB.validRepo(REPO), true);
  for (const bad of ['', 'nope', 'a/b/c', '-a/b', 'a/..', 'a/.', 'a b/c', 'https://github.com/a/b']) assert.equal(GITHUB.validRepo(bad), false, bad);
  for (const [typed, want] of [
    ['o/r', 'o/r'], ['  o/r  ', 'o/r'], ['https://github.com/o/r', 'o/r'], ['https://www.github.com/o/r', 'o/r'], ['github.com/o/r', 'o/r'],
    ['HTTPS://GitHub.com/o/r', 'o/r'], ['https://github.com/o/r/', 'o/r'], ['https://github.com/o/r.git', 'o/r'],
    ['https://github.com/o/r/issues', 'o/r'], ['https://github.com/o/r/issues/12', 'o/r'], ['https://github.com/o/r/tree/main', 'o/r'],
    ['https://github.com/o/r?tab=readme', 'o/r'], ['https://github.com/o/r#readme', 'o/r'], ['https://github.com/o/r.git/', 'o/r'],
    ['git@github.com:o/r.git', 'o/r'], ['git@github.com:o/r', 'o/r'], ['my-org1/some_repo.js', 'my-org1/some_repo.js'],
  ]) assert.equal(GITHUB.repoFrom(typed), want, typed);
  for (const bad of ['', '   ', 'nope', 'a/b/c', '-a/b', 'a/..', 'a b/c', 'http://github.com/o/r', 'https://gitlab.com/o/r', 'https://github.com.evil.example/o/r',
    'https://evil.example/github.com/o/r', 'https://github.com/o', 'https://github.com/', 'https://github.com', 'github.com', 'git@gitlab.com:o/r.git',
    'ftp://github.com/o/r', '//github.com/o/r', 'https://user@github.com/o/r', 'https://github.com//r', 'https://github.com/o/..', null, 7]) assert.equal(GITHUB.repoFrom(bad), '', String(bad));
  const { cleanRepo } = require('../server/issues.js');
  assert.equal(cleanRepo(GITHUB, 'https://github.com/o/r/issues/3'), 'o/r');
  assert.equal(cleanRepo(GITHUB, 'https://gitlab.com/o/r'), '');
  assert.equal(cleanRepo(null, 'o/r'), '');
});

await test('only GitHub is registered, unless the check names its stand-in', () => {
  const out = execFileSync(process.execPath, ['-e', "const r=require('./server/issue-providers'); console.log(JSON.stringify(r.list().map(p=>[p.id,p.origin,p.pollMs,p.fullEveryMs,p.tokenEnv])))"], { cwd: ROOT, env: { PATH: process.env.PATH } }).toString().trim();
  assert.deepEqual(JSON.parse(out), [['github', 'https://api.github.com', 600000, 86400000, null]]);
  const { valid } = require('../server/issue-providers');
  assert.equal(valid(STANDIN), true);
  assert.equal(valid({ ...GITHUB, origin: 'http://api.github.com' }), false, 'https unless the stand-in');
  assert.equal(valid({ ...GITHUB, needsToken: true }), false, 'a service that needs a token is not registered');
  assert.equal(valid({ ...GITHUB, terms: '' }), false, 'its terms are named');
  assert.equal('tokenEnv' in GITHUB, false, 'an adapter holds no token variable: the token is the installation\'s');
  assert.match(fs.readFileSync(path.join(ROOT, 'server', 'issue-providers', 'github.js'), 'utf8').split("'use strict'")[0], /Terms read on 2026-11-26/);
});

// --- the mapping -----------------------------------------------------------------------------------------------------------
const rec = (o) => ({ number: 1, title: 'Server: a thing', open: true, labels: [], url: 'https://github.com/o/r/issues/1', created: '2026-10-01T10:00:00.000Z', updated: '2026-10-01T10:00:00.000Z', ...o });
await test('closed is done; the priority labels are columns; anything else open is the inbox', () => {
  assert.equal(I.columnOf(rec({ open: false, labels: [{ name: 'priority: now', color: '' }] })), 'done');
  assert.equal(I.columnOf(rec({ labels: [{ name: 'priority: now', color: '' }] })), 'now');
  assert.equal(I.columnOf(rec({ labels: [{ name: 'bug', color: '' }, { name: 'priority: next', color: '' }] })), 'next');
  assert.equal(I.columnOf(rec({ labels: [{ name: 'Priority: Later', color: '' }] })), 'later');
  assert.equal(I.columnOf(rec({ labels: [{ name: 'priority:now', color: '' }] })), 'now');
  assert.equal(I.columnOf(rec({ labels: [{ name: 'priority: someday', color: '' }] })), 'inbox');
  assert.equal(I.columnOf(rec({})), 'inbox');
});

await test('an issue as a piece of work', () => {
  const tagIds = new Set(['bug', 'good-first-issue']);
  const at = { repo: 'o/r', provider: 'github', tagIds };
  const w = I.workOf(rec({ number: 7, title: 'x'.repeat(200), labels: [{ name: 'bug', color: 'd73a4a' }, { name: 'priority: now', color: '' }, { name: 'good first issue', color: '7057ff' }, { name: 'wontfix', color: '' }] }), at);
  assert.equal(w.title.length, 120);
  assert.ok(w.title.endsWith('…'), 'cut with an ellipsis');
  assert.deepEqual({ ...w, title: '' }, {
    kind: 'work', title: '', start: '2026-10-01', end: '2026-10-01', done: false, tags: ['bug', 'good-first-issue'],
    notes: 'https://github.com/o/r/issues/1\nLabels: wontfix', by: 'system:issues', column: 'now',
    source: { from: 'github', repo: 'o/r', number: 7, url: 'https://github.com/o/r/issues/1', updated: '2026-10-01T10:00:00.000Z' },
  });
  assert.ok(!('owners' in w), 'no owners');
  const closed = I.workOf(rec({ open: false, closed: '2026-10-05T23:00:00.000Z', milestone: { number: 2, title: 'M', due: '', open: true } }), at);
  assert.deepEqual([closed.column, closed.done, closed.end, closed.parent, closed.notes], ['done', true, '2026-10-05', 'ghm-2', 'https://github.com/o/r/issues/1\nMilestone: M']);
  const rows = I.tagRowsOf([rec({ labels: [{ name: 'good first issue', color: '7057ff' }, { name: 'priority: now', color: 'aaaaaa' }, { name: 'bug', color: '' }] })]);
  assert.deepEqual([...rows.values()], [{ id: 'good-first-issue', label: 'good first issue', icon: 'tag', color: '#7057ff' }, { id: 'bug', label: 'bug', icon: 'tag', color: '#808080' }]);
  const works = new Map([['plan:gh-1', { ...closed, done: true, start: '2026-10-01' }], ['plan:gh-2', { ...closed, done: false, start: '2026-09-01' }]]);
  const ms = I.milestonesOf(works, new Map([[2, { title: 'M', due: '', open: true }]]), new Map(), at);
  assert.deepEqual(ms.get('plan:ghm-2'), { kind: 'milestone', title: 'M', start: '2026-09-01', done: false, progress: 50, by: 'system:issues', source: { from: 'github', repo: 'o/r', milestone: 2 } });
  assert.deepEqual(I.boardOf(() => '').columns, [{ id: 'inbox', label: 'Inbox' }, { id: 'now', label: 'Now' }, { id: 'next', label: 'Next' }, { id: 'later', label: 'Later' }, { id: 'done', label: 'Done', done: true }]);
  assert.equal(I.boardOf((k) => (k === 'board-inbox' ? 'Triage' : '')).columns[0].label, 'Triage', 'the module\'s words name the columns');
  assert.equal(I.sameValue({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 }), true);
  assert.equal(I.isPulledKey('plan:gh-12'), true);
  assert.equal(I.isPulledKey('plan:hand'), false);
});

await test('the rest after a refusal: retry-after, else the limit\'s reset, else 30 minutes, never more than a day', () => {
  const now = 1_000_000;
  assert.equal(I.restUntil({ retryAfterMs: 5000 }, now), now + 5000);
  assert.equal(I.restUntil({ resetAt: now + 90000 }, now), now + 90000);
  assert.equal(I.restUntil({}, now), now + 30 * 60 * 1000);
  assert.equal(I.restUntil({ retryAfterMs: 9e12 }, now), now + 24 * 3600 * 1000);
});

// --- the ask -----------------------------------------------------------------------------------------------------------------
await test('the ask: every page, a 304, the token only in Authorization, refusals', async () => {
  gh.state.issues.clear();
  for (let i = 1; i <= 230; i += 1) gh.issue(i);
  gh.issue(231, { pull_request: { url: 'x' } });
  gh.seen.length = 0;
  const all = await I.askIssues(STANDIN, { repo: REPO, token: TOKEN, full: true });
  assert.equal(all.ok, true);
  assert.equal(all.records.length, 230, 'three pages, the pull request skipped');
  assert.equal(all.complete, true);
  assert.equal(gh.seen.length, 3, 'one request a page');
  for (const s of gh.seen) {
    assert.equal(s.headers.authorization, `Bearer ${TOKEN}`);
    assert.match(s.headers['user-agent'], /^[^ ]+\/\d+\.\d+\.\d+/);
    assert.equal(s.headers.accept, 'application/vnd.github+json');
  }
  assert.ok(gh.seen.every((s) => !s.url.includes(TOKEN)), 'never in the address');
  const since = all.records[all.records.length - 1].updated;
  const first = await I.askIssues(STANDIN, { repo: REPO, since });
  assert.equal(first.records.length, 1, 'since: only what changed from then');
  assert.equal(gh.seen[gh.seen.length - 1].headers.authorization, undefined, 'no token, no Authorization');
  const again = await I.askIssues(STANDIN, { repo: REPO, since, etag: first.etag });
  assert.deepEqual([again.ok, again.notModified, again.records.length], [true, true, 0], 'the same etag: a 304');
  assert.equal(gh.seen[gh.seen.length - 1].headers['if-none-match'], first.etag);
  gh.state.once = (req, res) => { res.writeHead(429, { 'retry-after': '7' }); res.end(); };
  const t = Date.now();
  const slow = await I.askIssues(STANDIN, { repo: REPO }, { now: t });
  assert.deepEqual([slow.ok, slow.status, slow.error, slow.restUntil], [false, 429, 'Test stand-in (not an issue service) asked to wait.', t + 7000]);
  gh.state.once = (req, res) => { res.writeHead(403); res.end(); };
  assert.equal((await I.askIssues(STANDIN, { repo: REPO }, { now: t })).restUntil, t + 30 * 60 * 1000, 'a 403 that names no time: 30 minutes');
  gh.state.once = (req, res) => { res.writeHead(401); res.end(); };
  assert.match((await I.askIssues(STANDIN, { repo: REPO })).error, /refused this server's access/);
  assert.equal((await I.askIssues(STANDIN, { repo: 'nobody/here' })).ok, true, 'any repository the fake has');
  gh.state.missing.add('nobody/here');
  assert.equal((await I.askIssues(STANDIN, { repo: 'nobody/here' })).error, 'No such repository, or it is private.');
  gh.state.once = (req, res) => { res.writeHead(302, { location: 'http://evil.example/x' }); res.end(); };
  assert.match((await I.askIssues(STANDIN, { repo: REPO })).error, /did not answer/, 'a redirect elsewhere is not followed');
  gh.state.once = (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(`[${'0,'.repeat(1100000)}0]`); };
  assert.match((await I.askIssues(STANDIN, { repo: REPO })).error, /could not be read/, 'more than 2 MB is not read');
  gh.state.once = (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"message":"not a list"}'); };
  assert.match((await I.askIssues(STANDIN, { repo: REPO })).error, /could not be read/);
  await assert.rejects(I.getter(GITHUB)('http://127.0.0.1:1/x', {}), /not the service's address/, 'GitHub\'s adapter asks only api.github.com');
  // github.com is asked for one thing: the sign-in's code exchange, a POST with no query, and never a GET or another path.
  const asked = [];
  const web = I.getter({ origin: 'https://api.example.test', webOrigin: 'https://web.example.test', allowHttp: false }, { fetchImpl: async (href) => { asked.push(href); return new Response('{}', { status: 200 }); } }).ask;
  assert.equal((await web('POST', 'https://web.example.test/login/oauth/access_token', {}, {})).status, 200, 'the exchange');
  for (const [m, u] of [['GET', 'https://web.example.test/login/oauth/access_token'], ['POST', 'https://web.example.test/login/oauth/access_token?x=1'], ['POST', 'https://web.example.test/other'], ['POST', 'http://web.example.test/login/oauth/access_token'], ['POST', 'https://other.example.test/login/oauth/access_token'], ['DELETE', 'https://web.example.test/applications/x/token']]) {
    await assert.rejects(web(m, u, {}, {}), /not the service's address/, `${m} ${u}`);
  }
  assert.deepEqual(asked, ['https://web.example.test/login/oauth/access_token'], 'only the exchange was sent');
});

// --- the GitHub app: credentials, the JWT, installation tokens (documentation/plans/plan-github-app.md, step 1) -----------------
const APP = require('../server/issue-app.js');
const ENV = { ISSUES_GITHUB_APP_CLIENT_ID: CLIENT_ID, ISSUES_GITHUB_APP_CLIENT_SECRET: CLIENT_SECRET, ISSUES_GITHUB_APP_KEY: PEM.replace(/\n/g, '\\n') };
const startApp = (env = ENV) => { const lines = []; APP.start(env, (l) => lines.push(l)); gh.state.installs = { 7: { mode: 'ok' }, 8: { mode: 'ok' }, 9: { mode: 'ok' }, 10: { mode: 'ok' } }; gh.app.length = 0; gh.state.mints.length = 0; gh.state.mintOnce = null; gh.state.mintToken = null; gh.state.mintTtlMs = 3600 * 1000; return lines; };
const MINT = { installation: 7, repositoryId: 777, write: true };

await test('the app\'s variables: the key from a file or from the variable, exactly one, and a clear line when something is wrong', () => {
  const R = APP.readConfig;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issues-key-'));
  const file = path.join(dir, 'app.pem');
  fs.writeFileSync(file, PEM, { mode: 0o600 });
  const base = { ISSUES_GITHUB_APP_CLIENT_ID: CLIENT_ID, ISSUES_GITHUB_APP_CLIENT_SECRET: CLIENT_SECRET };
  const fromFile = R({ ...base, ISSUES_GITHUB_APP_KEY_FILE: file });
  assert.deepEqual([Boolean(fromFile.key), fromFile.problem, fromFile.set], [true, '', true], 'the key read from a file');
  const fromVar = R({ ...base, ISSUES_GITHUB_APP_KEY: PEM.replace(/\n/g, '\\n') });
  assert.deepEqual([Boolean(fromVar.key), fromVar.problem], [true, ''], 'the key read from the variable, \\n for line breaks');
  assert.equal(Boolean(R({ ...base, ISSUES_GITHUB_APP_KEY: PEM }).key), true, 'and with real line breaks');
  assert.equal(typeof fromVar.key, 'object', 'a key object, not text');
  assert.ok(!JSON.stringify(Object.keys(fromVar)).includes('PRIVATE'), 'no text of the key kept');
  const both = R({ ...base, ISSUES_GITHUB_APP_KEY_FILE: file, ISSUES_GITHUB_APP_KEY: PEM });
  assert.deepEqual([both.key, both.problem], [null, 'Set only one of ISSUES_GITHUB_APP_KEY_FILE and ISSUES_GITHUB_APP_KEY. The GitHub app is off.'], 'both set: off with one line');
  const bad = R({ ...base, ISSUES_GITHUB_APP_KEY: '-----BEGIN RSA PRIVATE KEY-----\nnot a key\n-----END RSA PRIVATE KEY-----' });
  assert.deepEqual([bad.key, bad.problem], [null, 'The GitHub app\'s private key could not be read. The GitHub app is off.'], 'an unreadable key');
  assert.ok(!bad.problem.includes('not a key'), 'nothing of it in the line');
  assert.equal(R({ ...base, ISSUES_GITHUB_APP_KEY_FILE: path.join(dir, 'missing.pem') }).problem, 'The GitHub app\'s private key could not be read. The GitHub app is off.');
  const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  assert.equal(R({ ...base, ISSUES_GITHUB_APP_KEY: ec }).key, null, 'only an RSA key signs RS256');
  assert.match(R({ ISSUES_GITHUB_APP_CLIENT_ID: CLIENT_ID, ISSUES_GITHUB_APP_KEY: PEM }).problem, /^The GitHub app needs ISSUES_GITHUB_APP_CLIENT_ID, ISSUES_GITHUB_APP_CLIENT_SECRET and one of ISSUES_GITHUB_APP_KEY_FILE or ISSUES_GITHUB_APP_KEY\. The GitHub app is off\.$/, 'a missing variable');
  assert.deepEqual([R({}).set, R({}).problem], [false, ''], 'none set: the app is simply not there');
  for (const env of [{ ...base, ISSUES_GITHUB_APP_KEY: 'x' }, { ...base, ISSUES_GITHUB_APP_KEY_FILE: file, ISSUES_GITHUB_APP_KEY: PEM }, { ...base }]) {
    const lines = [];
    APP.start(env, (l) => lines.push(l));
    assert.ok(lines.every((l) => !l.includes(CLIENT_SECRET) && !l.includes('BEGIN') && !l.includes(CLIENT_ID)), 'no secret in a start line');
  }
  APP.start({}, () => {});
  assert.equal(APP.refusal(), 'This server has no GitHub app.', 'unset: its own sentence');
  APP.start({ ...base, ISSUES_GITHUB_APP_KEY: 'x' }, () => {});
  assert.equal(APP.refusal(), 'The GitHub app on this server is not working. The administrator checks its settings.', 'set but bad: the other sentence');
  assert.equal(APP.configured(), false);
});

await test('without the app, or with a bad key, a token is refused with the plan\'s sentence and nothing is asked of GitHub', async () => {
  startApp({});
  gh.app.length = 0;
  const none = await APP.token(STANDIN, MINT);
  assert.deepEqual([none.ok, none.kind, none.status, none.error], [false, 'off', 409, 'This server has no GitHub app.']);
  startApp({ ...ENV, ISSUES_GITHUB_APP_KEY: 'not a key' });
  const bad = await APP.token(STANDIN, MINT);
  assert.deepEqual([bad.ok, bad.kind, bad.error], [false, 'broken', 'The GitHub app on this server is not working. The administrator checks its settings.']);
  assert.equal(gh.app.length, 0, 'no request was made');
  assert.equal((await APP.token(GITHUB, { ...MINT })).ok, false, 'GitHub\'s own adapter, with no app, has no token either');
  assert.equal(gh.app.length, 0);
});

await test('the JWT: RS256, the client id, 60 seconds back, under 10 minutes ahead, signed by the app\'s key only', async () => {
  startApp();
  const got = await APP.token(STANDIN, MINT);
  assert.equal(got.ok, true);
  assert.deepEqual(gh.app.map((r) => [r.method, r.path]), [['GET', '/app'], ['POST', '/app/installations/7/access_tokens']]);
  for (const r of gh.app) {
    assert.equal(r.jwt.good, true, 'signed with the run\'s key');
    assert.deepEqual(r.jwt.head, { alg: 'RS256', typ: 'JWT' });
    assert.equal(r.jwt.claims.iss, CLIENT_ID);
    const nowS = Date.now() / 1000;
    assert.ok(Math.abs(r.jwt.claims.iat - (nowS - 60)) < 10, 'iat is 60 seconds back');
    assert.ok(r.jwt.claims.exp > nowS && r.jwt.claims.exp - r.jwt.claims.iat <= 600, 'exp is under 10 minutes after iat');
    assert.deepEqual(Object.keys(r.jwt.claims).sort(), ['exp', 'iat', 'iss']);
    assert.match(r.headers.authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    assert.match(r.headers['user-agent'], /^[^ ]+\/\d+\.\d+\.\d+/);
  }
  const wrong = APP.signJwt(OTHER_KEYS.privateKey, CLIENT_ID, Date.now());
  const refused = await fetch(`${ORIGIN}/app`, { headers: { authorization: `Bearer ${wrong}` } });
  assert.equal(refused.status, 401, 'a JWT signed with another key is refused');
  assert.equal(gh.app[gh.app.length - 1].jwt.good, false);
  assert.equal((await fetch(`${ORIGIN}/app`, { headers: { authorization: `Bearer ${gh.app[0].headers.authorization.slice(7).replace(/\.[^.]+$/, '.AAAA')}` } })).status, 401, 'a changed signature is refused');
  assert.deepEqual(gh.app.slice(0, 2).map((r) => r.body), [null, gh.state.mints[0]]);
});

await test('a token is narrowed to one repository and to issues and metadata, and used by the adapter in Authorization only', async () => {
  startApp();
  const w = await APP.token(STANDIN, { installation: 7, repositoryId: 777, write: true });
  const r = await APP.token(STANDIN, { installation: 7, repositoryId: 777, write: false });
  assert.deepEqual(gh.state.mints, [
    { repository_ids: [777], permissions: { issues: 'write', metadata: 'read' } },
    { repository_ids: [777], permissions: { issues: 'read', metadata: 'read' } },
  ]);
  assert.deepEqual([w.ok, w.token, w.repo, r.token], [true, TOKEN, REPO, TOKEN]);
  assert.ok(gh.app.every((x) => !JSON.stringify(x.body || {}).includes('repositories"')), 'by id, never by name');
  assert.ok(gh.app.every((x) => !x.headers.authorization.includes(TOKEN)), 'the app\'s calls carry the JWT');
});

await test('a token is reused until 5 minutes before it expires, then made again; a 401 drops it; calls at once share one mint', async () => {
  startApp();
  const t0 = Date.now();
  await APP.token(STANDIN, MINT, { now: t0 });
  await APP.token(STANDIN, MINT, { now: t0 + 30 * 60 * 1000 });
  await APP.token(STANDIN, MINT, { now: t0 + 54 * 60 * 1000 });
  assert.equal(gh.state.mints.length, 1, 'within the hour (less 5 minutes): one mint');
  assert.equal(gh.app.filter((x) => x.path === '/app').length, 1, 'the app is asked its name once');
  gh.state.mintToken = `${TOKEN}-again`;
  const late = await APP.token(STANDIN, MINT, { now: t0 + 56 * 60 * 1000 });
  assert.deepEqual([gh.state.mints.length, late.token], [2, `${TOKEN}-again`], '5 minutes before expiry: a new token');
  assert.equal((await APP.token(STANDIN, MINT, { now: t0 + 1000 })).token, `${TOKEN}-again`, 'and the new one is kept');
  assert.equal(gh.state.mints.length, 2);
  APP.dropToken(STANDIN, 7, 777);
  await APP.token(STANDIN, MINT, { now: t0 + 1000 });
  assert.equal(gh.state.mints.length, 3, 'dropped (a 401): made again');
  APP.dropToken(STANDIN, 7, 777);
  gh.state.mintTtlMs = 4 * 60 * 1000;
  await APP.token(STANDIN, MINT);
  await APP.token(STANDIN, MINT);
  assert.equal(gh.state.mints.length, 5, 'a token with under 5 minutes left is never reused');
  APP.dropToken(STANDIN, 7, 777);
  gh.state.mintTtlMs = 3600 * 1000;
  const before = gh.state.mints.length;
  const both = await Promise.all([APP.token(STANDIN, MINT), APP.token(STANDIN, MINT), APP.token(STANDIN, MINT)]);
  assert.deepEqual([gh.state.mints.length - before, both.every((x) => x.ok)], [1, true], 'three at once: one mint');
});

await test('trouble with a mint: not installed, repository out of it, paused, key refused, a limit, a rename, another repository', async () => {
  startApp();
  gh.state.installs[7].mode = 'gone';
  let g = await APP.token(STANDIN, MINT);
  assert.deepEqual([g.ok, g.kind], [false, 'gone'], '404: the app is not installed');
  gh.state.installs[7].mode = 'ok';
  gh.state.mintOnce = (req, res) => { res.writeHead(422, { 'content-type': 'application/json' }); res.end('{"message":"Validation Failed"}'); };
  g = await APP.token(STANDIN, MINT);
  assert.deepEqual([g.ok, g.kind], [false, 'gone'], '422: the repository is not in the installation');
  gh.state.installs[7].mode = 'suspended';
  g = await APP.token(STANDIN, MINT);
  assert.deepEqual([g.ok, g.kind], [false, 'paused'], '403 and the installation\'s own suspended_at');
  gh.state.installs[7].mode = 'forbidden';
  g = await APP.token(STANDIN, MINT);
  assert.deepEqual([g.ok, g.kind], [false, 'silent'], 'a 403 whose words say suspended, but the installation is not: not paused');
  gh.state.installs[7].mode = 'ok';
  gh.state.mintOnce = (req, res) => { res.writeHead(403, { 'content-type': 'application/json', 'retry-after': '90' }); res.end('{"message":"You have exceeded a secondary rate limit"}'); };
  const t = Date.now();
  g = await APP.token(STANDIN, MINT, { now: t });
  assert.deepEqual([g.ok, g.kind, g.restUntil], [false, 'limited', t + 90000], '403 with a wait: a rest');
  assert.equal(APP.refusal(), '', 'a limit is not a broken app');
  gh.state.installs[8].rename = 'other/renamed';
  g = await APP.token(STANDIN, { installation: 8, repositoryId: 888, write: true });
  assert.deepEqual([g.ok, g.repo], [true, 'other/renamed'], 'the mint names the repository as GitHub has it now');
  g = await APP.token(STANDIN, { installation: 7, repositoryId: 778, write: true });
  assert.deepEqual([g.ok, g.kind], [false, 'gone'], 'a mint that does not name the repository asked for');
  assert.equal(gh.state.mints.every((m) => m.repository_ids.length === 1), true);
  gh.state.mintOnce = (req, res) => { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"message":"Bad credentials"}'); };
  g = await APP.token(STANDIN, { installation: 9, repositoryId: 999, write: true });
  assert.deepEqual([g.ok, g.kind, g.error], [false, 'broken', 'The GitHub app on this server is not working. The administrator checks its settings.'], '401: the key or secret is refused');
  const asked = gh.app.length;
  g = await APP.token(STANDIN, { installation: 9, repositoryId: 999, write: true });
  assert.deepEqual([g.kind, gh.app.length], ['broken', asked], 'then the server does not ask again for a while');
  assert.equal(APP.refusal(), 'The GitHub app on this server is not working. The administrator checks its settings.');
  assert.deepEqual(APP.status(STANDIN), { state: 'broken', name: '', slug: '' }, 'a 401 marks the app broken: the pull view says so, with no name');
  startApp();
  assert.equal(APP.refusal(), '', 'a restart reads it again');
  assert.deepEqual(APP.status(STANDIN), { state: 'unchecked', name: '', slug: '' }, 'configured and not yet asked');
  await APP.ensureApp(STANDIN, Date.now());
  assert.deepEqual(APP.status(STANDIN), { state: 'working', name: 'Chameleon Check', slug: 'chameleon-check' }, 'after the app answered');
  APP.start({}, () => {});
  assert.deepEqual(APP.status(STANDIN), { state: 'off', name: '', slug: '' }, 'nothing configured');
  startApp();
});

await test('one service rest for every environment: a repository\'s limit rests every space on it, whichever environment', () => {
  startApp();
  const a = { provider: 'issues-standin', via: 'app', repo: 'o/r', repositoryId: 5 };
  const renamed = { ...a, repo: 'o/renamed' };
  const pub = { provider: 'issues-standin', via: 'public', repo: 'O/R' };
  APP.restSet(a, Date.now() + 60000);
  assert.ok(APP.restLeft(renamed) > 0 && APP.restLeft(renamed) <= 60000, 'by repository id: a rename does not escape it');
  assert.equal(APP.restLeft({ ...a, repositoryId: 6 }), 0, 'another repository');
  assert.equal(APP.restLeft(pub), 0, 'a public read is another limit');
  APP.restSet(pub, Date.now() + 60000);
  assert.ok(APP.restLeft({ ...pub, repo: 'o/r' }) > 0, 'a public repository by name, any case');
  assert.equal(APP.restLeft(a, Date.now() + 120000), 0, 'and it ends');
});

await test('the removed server token and allow list are gone from the source', () => {
  const words = ['ISSUES_GITHUB_' + 'TOKEN', 'ISSUES_GITHUB_' + 'WRITE', 'token' + 'Env', 'issue' + 'Token', 'issueMay' + 'Write', 'write' + 'Allowed', 'writeList' + 'Of', 'SAY.no' + 'Token', 'No token is set on this server', 'issues-to-' + 'plan'];
  const found = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (['node_modules', '.git', '.wiki-build'].includes(e.name) ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = [...walk(path.join(ROOT, 'server')), ...walk(path.join(ROOT, 'tools')), path.join(ROOT, 'package.json'), path.join(ROOT, 'docker-compose.yml'), path.join(ROOT, 'Dockerfile')];
  for (const f of files) {
    if (f === fileURLToPath(import.meta.url) || !fs.existsSync(f) || /\.(png|jpe?g|gif|webp|ico|woff2?|zip|pmtiles|pdf|mp3|mp4)$/i.test(f)) continue;
    const text = fs.readFileSync(f, 'utf8');
    for (const w of words) if (text.includes(w)) found.push(`${path.relative(ROOT, f)}: ${w}`);
  }
  assert.deepEqual(found, [], 'nothing reads, names or answers with the removed variables or the old sentences');
  assert.equal(fs.existsSync(path.join(ROOT, 'tools', 'issues-to-' + 'plan.mjs')), false, 'the stopgap tool is gone');
});

// --- writing back: the pieces ------------------------------------------------------------------------------------------------
await test('the write gaps', () => {
  assert.equal(GITHUB.writeGapMs, 1000, 'GitHub asks for a second between writes');
  assert.equal(STANDIN.writeGapMs, 0);
});

await test('what a change touches: the sent fields, the space\'s own, and GitHub\'s read-only ones', () => {
  const s = { kind: 'work', title: 'A', start: '2026-10-01', end: '2026-10-01', done: false, column: 'next', tags: ['bug'], notes: 'n', by: 'system:issues', source: { from: 'github', repo: 'o/r', number: 1 } };
  const d = (patch) => I.diffWork(s, { ...s, ...patch });
  assert.deepEqual(d({}), { column: null, title: null, tags: { add: [], remove: [] }, own: false, foreign: [] });
  assert.equal(d({ column: 'now' }).column, 'now');
  assert.equal(d({ column: 'done', done: true }).column, 'done');
  assert.equal(d({ done: true }).column, 'done', 'ticked alone is a move to Done');
  assert.equal(I.diffWork({ ...s, column: 'done', done: true }, { ...s, column: undefined, done: false }).column, 'inbox', 'out of Done with no column: the inbox');
  assert.equal(d({ title: 'B' }).title, 'B');
  assert.deepEqual(d({ tags: ['docs'] }).tags, { add: ['docs'], remove: ['bug'] });
  assert.equal(d({ tags: undefined }).tags.remove[0], 'bug');
  const own = d({ owners: ['x'], start: '2026-10-02', rank: 'a', fields: { phase: '1' }, waitsOn: ['gh-2'], by: 'someone' });
  assert.deepEqual([own.own, own.foreign, own.column, own.title], [true, [], null, null]);
  assert.deepEqual(d({ notes: 'other', parent: 'ghm-1', kind: 'note', source: null }).foreign.sort(), ['kind', 'notes', 'parent', 'source']);
  assert.deepEqual(d({ id: 'x' }).foreign, ['id']);
  const rec1 = { number: 1, title: 'A', open: true, labels: [{ name: 'priority: next', color: '' }, { name: 'bug', color: '' }], url: '', created: '', updated: '' };
  assert.deepEqual(I.changePlan(rec1, { column: 'now' }), { patch: {}, remove: ['priority: next'], add: ['priority: now'] });
  assert.deepEqual(I.changePlan(rec1, { column: 'inbox' }), { patch: {}, remove: ['priority: next'], add: [] });
  assert.deepEqual(I.changePlan(rec1, { column: 'done' }), { patch: { state: 'closed', stateReason: 'completed' }, remove: [], add: [] });
  assert.deepEqual(I.changePlan({ ...rec1, open: false }, { column: 'later' }), { patch: { state: 'open', stateReason: 'reopened' }, remove: ['priority: next'], add: ['priority: later'] });
  assert.deepEqual(I.changePlan(rec1, { title: 'B', addNames: ['docs'], removeIds: ['bug'] }), { patch: { title: 'B' }, remove: ['bug'], add: ['docs'] });
  assert.deepEqual(I.changePlan(rec1, { column: 'next' }), { patch: {}, remove: [], add: [] }, 'already there: nothing to send');
});

await test('the pull keeps the space\'s own fields, and never writes older data over newer', () => {
  const stored = { kind: 'work', title: 'Old', start: '2026-10-02', end: '2026-10-09', owners: ['k1'], rank: 'm', fields: { phase: 'a' }, by: 'k9', source: { updated: '2026-11-02T00:00:00.000Z' } };
  const fresh = { kind: 'work', title: 'New', start: '2026-10-01', end: '2026-10-01', by: 'system:issues', column: 'now', source: { updated: '2026-11-03T00:00:00.000Z' } };
  assert.deepEqual(I.keepOwn(stored, fresh), { ...fresh, owners: ['k1'], rank: 'm', fields: { phase: 'a' }, start: '2026-10-02', end: '2026-10-09', by: 'k9' });
  assert.equal(I.keepOwn(undefined, { ...fresh, end: '2026-10-05' }).end, '2026-10-01', 'new work: made and ended the day it was made');
  // Area comes once from the title's words before the colon, when new work is made and the plan has an Area field with that choice.
  const area = { id: 'area', options: [{ id: 'to-do', label: 'To-do' }, { id: 'server', label: 'Server' }] };
  assert.equal(I.areaOf('Server: it breaks', area), 'server');
  assert.equal(I.areaOf('to-do: a thing', area), 'to-do', 'by id or by words, any case');
  assert.equal(I.areaOf('Chat: nope', area), '', 'no such choice');
  assert.equal(I.areaOf('No colon here', area), '');
  assert.equal(I.areaOf(': leading', area), '');
  assert.equal(I.areaOf('Server: x', null), '', 'no Area field');
  assert.deepEqual(I.keepOwn(undefined, { ...fresh, title: 'Server: x' }, { area }).fields, { area: 'server' });
  assert.equal(I.keepOwn(undefined, { ...fresh, title: 'Chat: x' }, { area }).fields, undefined);
  assert.deepEqual(I.keepOwn({ ...stored, fields: undefined }, { ...fresh, title: 'Server: x' }, { area }).fields, undefined, 'work already there keeps its own: Area is not set again');
  assert.equal(I.olderThanStored(stored, { updated: '2026-11-01T00:00:00.000Z' }), true);
  assert.equal(I.olderThanStored(stored, { updated: '2026-11-02T00:00:00.000Z' }), false);
  assert.equal(I.olderThanStored(undefined, { updated: '2026-11-01T00:00:00.000Z' }), false);
  assert.equal(I.olderThanStored({ source: {} }, { updated: '2026-11-01T00:00:00.000Z' }), false);
});

await test('the adapter\'s writes carry only the fields the plan allows', async () => {
  const sent = [];
  const ask = async (method, url, headers, body) => { sent.push({ method, url, headers, body }); return { status: 200, header: () => null, json: { number: 3, title: 'T', state: 'open', created_at: '2026-10-01T00:00:00Z', html_url: 'https://github.com/o/r/issues/3', body: 'secret', labels: [] } }; };
  const a = STANDIN;
  await a.update({ repo: 'o/r', number: 3, title: 'T', state: 'closed', stateReason: 'completed', body: 'no', assignees: ['x'], labels: ['x'], milestone: 1, token: TOKEN }, ask);
  await a.update({ repo: 'o/r', number: 3, state: 'open', stateReason: 'bogus', token: TOKEN }, ask);
  await a.addLabels({ repo: 'o/r', number: 3, labels: ['bug', 'x\u0007y', 5], assignees: ['x'], token: TOKEN }, ask);
  await a.removeLabel({ repo: 'o/r', number: 3, label: 'priority: now', token: TOKEN }, ask);
  await a.hasLabel({ repo: 'o/r', label: 'a/b c', token: TOKEN }, ask);
  await a.create({ repo: 'o/r', title: 'N', labels: ['bug'], body: 'secret', assignees: ['x'], milestone: 1, token: TOKEN }, ask);
  await a.get({ repo: 'o/r', number: 3, etag: 'W/"1"', token: TOKEN }, ask);
  assert.deepEqual(sent.map((s) => [s.method, new URL(s.url).pathname, s.body]), [
    ['PATCH', '/repos/o/r/issues/3', { title: 'T', state: 'closed', state_reason: 'completed' }],
    ['PATCH', '/repos/o/r/issues/3', { state: 'open' }],
    ['POST', '/repos/o/r/issues/3/labels', { labels: ['bug'] }],
    ['DELETE', '/repos/o/r/issues/3/labels/priority%3A%20now', undefined],
    ['GET', '/repos/o/r/labels/a%2Fb%20c', undefined],
    ['POST', '/repos/o/r/issues', { title: 'N', labels: ['bug'] }],
    ['GET', '/repos/o/r/issues/3', undefined],
  ]);
  assert.ok(sent.every((s) => s.headers.Authorization === `Bearer ${TOKEN}` && !s.url.includes(TOKEN)));
  assert.equal(sent[6].headers['If-None-Match'], 'W/"1"');
  const got = await a.get({ repo: 'o/r', number: 3 }, ask);
  assert.ok(!JSON.stringify(got).includes('secret'), 'no body in the record');
  const lim = (status, headers, message) => ({ status, header: (k) => headers[k] ?? null, json: { message } });
  const now = 1_000_000;
  const wc = (g) => I.writeCall(a, (askX) => a.update({ repo: 'o/r', number: 1, title: 'x' }, async () => g), { now });
  assert.equal((await wc(lim(429, { 'retry-after': '5' }, 'slow'))).status, 429);
  assert.equal((await wc(lim(429, { 'retry-after': '5' }, 'slow'))).restUntil, now + 5000);
  assert.equal((await wc(lim(403, {}, 'Resource not accessible by personal access token'))).status, 502, 'a 403 that is not a limit is the token\'s refusal, not a rest');
  assert.match((await wc(lim(403, {}, 'You have exceeded a secondary rate limit.'))).error, /^Test stand-in .* asked to wait\. Try again in \d+ minutes\.$/);
  assert.equal((await wc(lim(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '2000' }, 'API rate limit exceeded'))).status, 429);
  assert.match((await wc(lim(401, {}, 'Bad credentials'))).error, /refused this server's access/);
  assert.equal((await wc(lim(422, {}, 'Validation Failed.'))).error, 'Test stand-in (not an issue service) refused the change: Validation Failed.');
  assert.equal((await wc(lim(404, {}, 'Not Found'))).status, 404);
  assert.match((await wc(lim(502, {}, ''))).error, /did not answer\. Nothing was changed; try again\.$/);
});

// --- the shared terms record -------------------------------------------------------------------------------------------------
await test('the terms: one record for every service, which starts empty', () => {
  const { ServiceTerms } = require('../server/service-terms.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issues-terms-'));
  const met = { id: 'met-norway', name: 'MET', terms: 'https://api.met.no/doc/TermsOfService' };
  const t = new ServiceTerms(dir);
  assert.equal(t.accepted(met), false, 'nothing is accepted by itself');
  assert.equal(t.accepted(GITHUB), false);
  t.accept(met, 'admin');
  t.accept(GITHUB, 'admin');
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'service-terms.json'), 'utf8')).services).sort(), ['github', 'met-norway']);
  assert.deepEqual(t.view([{ kind: 'issues', adapter: GITHUB }]).map((v) => [v.id, v.kind, v.accepted, v.terms]), [['github', 'issues', true, GITHUB.terms]]);
  assert.equal(new ServiceTerms(dir).accepted(GITHUB), true, 'read back from the file');
});

// The gate by mutation: the live part below passes only because the code asks these questions; take any one out of the source
// and the same reading must fail, so a refactor that drops one is caught (a live server for each is not needed).
await test('the gate is read from the code, and each part of it matters', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
  const del = fs.readFileSync(path.join(ROOT, 'server', 'delete-path.js'), 'utf8');
  const fnOf = (text, head) => { const a = text.indexOf(head); assert.ok(a >= 0, `${head} is in the server`); return text.slice(a, text.indexOf('\n}', a) + 2); };
  const routeOf = (text, head) => { const a = text.indexOf(head); assert.ok(a >= 0, `${head} is in the server`); return text.slice(a, text.indexOf('\n});', a) + 4); };
  const intact = (text, delText = del) => {
    const put = routeOf(text, "app.put('/api/spaces/:id/issues-pull'");
    const now = routeOf(text, "app.post('/api/spaces/:id/issues-pull/now'");
    const refusal = fnOf(text, 'function pulledRefusal(');
    return [
      /if \(!who\.user \|\| who\.user\.agent \|\| !hasOwnerRights\(who\.user\)\) return res\.status\(403\)/.test(put), // only an owner, never an agent
      /if \(!serviceTerms\.accepted\(adapter\)\) return res\.status\(409\)/.test(put), // the terms first
      /if \(others\.length\) return res\.status\(409\)/.test(put), // only into an empty plan
      /issuePullPlace\(req, res, 'own'\)/.test(now), // Pull now: the plan's edit
      /if \(!serviceTerms\.accepted\(adapter\)\)/.test(fnOf(text, 'async function pullIssues(')), // no pull without the terms
      /const pulled = pulledRefusal\(ctx, key, given\);\n  if \(pulled\) return pulled;/.test(fnOf(text, 'function putModuleValue(')), // a person's write refused
      (delText.match(/const pulled = d\.pulledRefusal\(ctx, key\);\n    if \(pulled\) return pulled;/g) || []).length === 2, // a person's delete refused
      (text.match(/const pulled = pulledRefusal\(ctx, null\);/g) || []).length === 2, // a Clear and its Undo refused
      /ctx\.who\.system === 'issues'/.test(refusal) && /if \(!rec \|\| !rec\.on\) return null;/.test(refusal), // only the pull, only while on
      /const inSpace = who\.system \? true :/.test(fnOf(text, 'function moduleSpaceRefusal(')), // the system writer is only issuePullWho
      // Writing back: nothing goes out unless the space has it on, the server names the repository, the person holds write_out,
      // the field is one that may go, and the service is read first.
      /if \(pull && pull\.on && pull\.write\) \{\n      const out = await issueWriteThrough\(/.test(routeOf(text, "app.put('/api/modules/:id/data/:key'")),
      /if \(!mayWriteOut && !\(d\.own && !sends && !d\.foreign\.length\)\) return noRight;/.test(fnOf(text, 'async function issueWriteThrough(')) && /const mayWriteOut = Boolean\(ctx\.perms\[`module\.\$\{ctx\.manifest\.id\}\.write_out`\]\);/.test(fnOf(text, 'async function issueWriteThrough(')),
      /if \(d\.foreign\.length\) return fromService;/.test(fnOf(text, 'async function issueWriteThrough(')),
      /const refused = issueWriteRefusal\(rec, adapter\);\n    if \(refused\) return refused;/.test(fnOf(text, 'async function issueWriteThrough(')),
      /const read = await issueRead\(rec, adapter, number\);/.test(fnOf(text, 'async function issueWriteThrough(')),
      /if \(rec\.via !== 'app'\) return \{ status: 409/.test(fnOf(text, 'function issueWriteRefusal(')) && /!rec\.writeOk\) return \{ status: 403/.test(fnOf(text, 'function issueWriteRefusal(')), // only a space linked through the app, by someone who could write there
      /if \(!rec\.write\) return res\.status\(403\)/.test(routeOf(text, "app.post('/api/spaces/:id/issues'")),
      /\.write_out`\]\) return res\.status\(403\)/.test(routeOf(text, "app.post('/api/spaces/:id/issues'")),
      /const refusedWrite = issueWriteRefusal\(rec, adapter\);\n  if \(refusedWrite\) return res\.status/.test(routeOf(text, "app.post('/api/spaces/:id/issues'")),
      /const refused = writeCheck\(had\);\n    if \(refused\)/.test(routeOf(text, "app.put('/api/spaces/:id/issues-pull'")) && /if \(body\.write !== true\) return null;\n    return issueWriteRefusal\(rec, adapter\);/.test(routeOf(text, "app.put('/api/spaces/:id/issues-pull'")),
      /if \(issuesLib\.olderThanStored\(stored\.get\(key\), r\)\) continue;/.test(fnOf(text, 'function writeIssues(')),
      // An agent's side: its request on pulled work waits for the service (and nothing else is written with it), its Undo is a write
      // to the service, and a delete is never asked for.
      /const out = await issueWriteThrough\(ctx, via\.first\.key, via\.first\.value, \{ expected: versions\.get\(via\.first\.key\) \|\| 0 \}\);/.test(text),
      /if \(via\.other\.length \|\| e\.links\.length \|\| e\.schedules\.length \|\| e\.notify\.length \|\| e\.phaseEnd\) return end\(422/.test(text),
      /const out = await issueWriteThrough\(at\.ctx, c\.object\.key, back, \{ expected: c\.versionAfter \}\);/.test(fnOf(text, 'async function undoThrough(')),
      /pull && pull\.on && pull\.write\) \{ const a = issueAdapterOf\(pull\.provider\); return res\.status\(403\)\.json\(\{ error: issuesLib\.SAY\.noDelete/.test(text),
    ].every(Boolean);
  };
  assert.equal(intact(src), true, 'the gate is as the plan says');
  const from = src.indexOf('// --- the issue pull (documentation/plans/plan-github-pull.md');
  const inPull = (cut) => (t) => t.slice(0, from) + cut(t.slice(from));
  for (const [name, cut, delCut] of [
    ['the owner', inPull((t) => t.replace('if (!who.user || who.user.agent || !hasOwnerRights(who.user)) return', 'if (!who.user) return'))],
    ['the terms on turning on', inPull((t) => t.replace('if (!serviceTerms.accepted(adapter)) return res.status(409).json({ error: issuesLib.SAY.terms(adapter.name, word(\'module\', { many: true, cap: true })) });\n  // A pulled', '// A pulled'))],
    ['the empty plan', inPull((t) => t.replace('if (others.length) return', 'if (false) return'))],
    ['the edit for Pull now', inPull((t) => t.replace("issues-pull/now', async (req, res) => {\n  const place = issuePullPlace(req, res, 'own')", "issues-pull/now', async (req, res) => {\n  const place = issuePullPlace(req, res, 'read')"))],
    ['the terms on a pull', inPull((t) => t.replace("if (!serviceTerms.accepted(adapter)) return issuePulls.set", 'if (false) return issuePulls.set'))],
    ['the refusal of a write', (t) => t.replace('const pulled = pulledRefusal(ctx, key, given);\n  if (pulled) return pulled;', '')],
    ['the refusal of a delete', null, (t) => t.replace('const pulled = d.pulledRefusal(ctx, key);\n    if (pulled) return pulled;', '')],
    ['the refusal of a Clear', (t) => t.replace('const pulled = pulledRefusal(ctx, null);', 'const pulled = null;')],
    ['the write-through for a space that writes', (t) => t.replace('if (pull && pull.on && pull.write) {\n      const out = await issueWriteThrough(', 'if (false) {\n      const out = await issueWriteThrough(')],
    ['write_out', inPull((t) => t.replace('if (!mayWriteOut && !(d.own && !sends && !d.foreign.length)) return noRight;', ''))],
    ['write_out, for more than the space\'s own', inPull((t) => t.replace('if (!mayWriteOut && !(d.own && !sends && !d.foreign.length)) return noRight;', 'if (!mayWriteOut && !d.own) return noRight;'))],
    ['the agent\'s one write', (t) => t.replace('if (via.other.length || e.links.length', 'if (false && (via.other.length || e.links.length').replace('|| e.phaseEnd) return end(422', '|| e.phaseEnd)) return end(422')],
    ['the agent\'s write-through', (t) => t.replace('const out = await issueWriteThrough(ctx, via.first.key, via.first.value, { expected: versions.get(via.first.key) || 0 });', 'const out = { item: null };')],
    ['the agent\'s undo through the service', (t) => t.replace('const out = await issueWriteThrough(at.ctx, c.object.key, back, { expected: c.versionAfter });', 'const out = {};')],
    ['no delete of pulled work for an agent', (t) => t.replace('if (pull && pull.on && pull.write) { const a = issueAdapterOf(pull.provider); return res.status(403)', 'if (false) { const a = issueAdapterOf(pull.provider); return res.status(403)')],
    ['the read-only fields', inPull((t) => t.replace('if (d.foreign.length) return fromService;', ''))],
    ['the link of the space', inPull((t) => t.replace("if (rec.via !== 'app') return { status: 409", "if (false) return { status: 409"))],
    ['the linking person\'s own right to write', inPull((t) => t.replace('!rec.writeOk) return { status: 403', 'false) return { status: 403'))],
    ['the refusal in the write-through', inPull((t) => t.replace('const refused = issueWriteRefusal(rec, adapter);\n    if (refused) return refused;', ''))],
    ['the refusal on turning writing on', inPull((t) => t.replace('return issueWriteRefusal(rec, adapter);', 'return null;'))],
    ['the read before a write', inPull((t) => t.replace('const read = await issueRead(rec, adapter, number);', 'const read = { ok: true, record: null };'))],
    ['the new issue\'s write flag', inPull((t) => t.replace('if (!rec.write) return res.status(403)', 'if (false) return res.status(403)'))],
    ['the new issue\'s write_out', inPull((t) => t.replace('.write_out`]) return res.status(403)', '.write_out`] === 1) return res.status(403)'))],
    ['the new issue\'s link', inPull((t) => t.replace('if (refusedWrite) return res.status', 'if (false) return res.status'))],
    ['the pull\'s never-older rule', inPull((t) => t.replace('if (issuesLib.olderThanStored(stored.get(key), r)) continue;', ''))],
    ['only while on', inPull((t) => t.replace('if (!rec || !rec.on) return null;\n  if (key', 'if (!rec) return null;\n  if (key'))],
  ]) {
    const mutated = cut ? cut(src) : src;
    const mutatedDel = delCut ? delCut(del) : del;
    assert.ok(mutated !== src || mutatedDel !== del, `${name}: the mutation changed the code`);
    assert.equal(intact(mutated, mutatedDel), false, `${name}: taking it out is noticed`);
  }
});

// --- live ----------------------------------------------------------------------------------------------------------------------
const FULL_MS = 9000;
const lk = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"participants":[]}'); }); });
await new Promise((r) => lk.listen(0, '127.0.0.1', r));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issues-route-'));
const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  cwd: ROOT,
  env: {
    PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret',
    ADMIN_PASSWORD: 'testpass1234', AGENT_TOKENS: 'true', LIVEKIT_API_URL: `http://127.0.0.1:${lk.address().port}`,
    ISSUES_TEST_STANDIN: ORIGIN, ISSUES_GITHUB_APP_CLIENT_ID: CLIENT_ID, ISSUES_GITHUB_APP_CLIENT_SECRET: CLIENT_SECRET, ISSUES_GITHUB_APP_KEY: PEM.replace(/\n/g, '\\n'), ISSUES_TEST_GAP_MS: '1000', ISSUES_TEST_FULL_MS: String(FULL_MS), ISSUES_TEST_POLL_MS: String(3600 * 1000), ISSUES_TEST_TICK_MS: '300', ISSUES_TEST_LINK_MS: '5000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOut = '';
const stop = () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
const fail = async (name, err) => { console.error(`check-issues: ${name}: ${err.stack || err.message}\n--- server ---\n${serverOut.slice(-3000)}`); await stop(); process.exit(1); };
const live = async (name, fn) => { try { await fn(); n += 1; } catch (err) { await fail(name, err); } };
let base = '';
try {
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the server did not start in time:\n${serverOut}`)), 20000);
    const onData = (d) => { serverOut += d; const m = /listening on :(\d+)/.exec(serverOut); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${serverOut}`)); });
  });
  base = `http://127.0.0.1:${port}`;
} catch (err) { await fail('the server starts', err); }
const answers = [];
const call = async (method, urlPath, { body, token } = {}) => {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(base + urlPath, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  answers.push(text);
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text, headers: res.headers };
};
const ok = (r, what, status = 200) => { assert.equal(r.status, status, `${what}: ${r.status} ${r.text.slice(0, 300)}`); return r; };
const S = {};
// Links a space through the real routes (the owner presses Connect, GitHub's fake signs in, the list is read, the repository picked) and
// answers the PUT's answer. `extra` goes in the PUT (write: true).
const asCall = (token) => (method, urlPath, body) => call(method, urlPath, { token, body });
const linked = async (space, repositoryId, extra = {}, who = S.admin) => {
  const via = asCall(who);
  const t = await linkThrough({ call: via, space });
  assert.equal(t.list && t.list.status, 200, `the link's list: ${t.start.status} ${t.backText || ''} ${t.list ? t.list.text : ''}`);
  return followFrom({ call: via, space, link: t.link, repositoryId, extra });
};
const P = (space) => `/api/spaces/${space}/issues-pull`;
const plan = async (space) => Object.fromEntries((ok(await call('GET', `/api/modules/schedule/data?scope=space&space=${space}`, { token: S.admin }), 'the plan').json.items).map((e) => [e.key, e]));
const status = async (space) => ok(await call('GET', P(space), { token: S.admin }), 'the status').json;
const putKey = (space, key, value, token) => call('PUT', `/api/modules/schedule/data/${encodeURIComponent(key)}?scope=space&space=${space}`, { token, body: { value } });
const until = async (what, fn, ms = 8000) => {
  const end = Date.now() + ms;
  for (;;) {
    const got = await fn();
    if (got) return got;
    if (Date.now() > end) throw new Error(`waited for ${what}`);
    await sleep(100);
  }
};
const pullNow = async (space, token = S.admin) => {
  await until('the gap', async () => { const s = await status(space); return !s.pulling && (!s.last || Date.now() - Date.parse(s.last) > 1100); });
  return call('POST', `${P(space)}/now`, { token, body: {} });
};

await live('set up: Planner - Projects on, a member, an agent and a guest link', async () => {
  S.admin = ok(await call('POST', '/api/login', { body: { login: 'admin', password: 'testpass1234' } }), 'the admin signs in').json.token;
  ok(await call('POST', '/api/modules/bundled/schedule/install', { token: S.admin, body: {} }), 'Projects installs', 201);
  ok(await call('PATCH', '/api/modules/schedule', { token: S.admin, body: { enabled: true, allSpaces: true } }), 'Projects turns on');
  ok(await call('PATCH', '/api/settings', { token: S.admin, body: { agents: true } }), 'agents on');
  const mia = ok(await call('POST', '/api/users', { token: S.admin, body: { login: 'mia', displayName: 'Mia', role: 'member', password: 'memberpass1234' } }), 'mia', 201).json.user.key;
  const agent = ok(await call('POST', '/api/users', { token: S.admin, body: { agent: true } }), 'an agent', 201).json.user;
  S.agent = ok(await call('POST', `/api/users/${agent.key}/token`, { token: S.admin }), 'its token', 201).json.token;
  const make = async (name) => {
    const id = ok(await call('POST', '/api/spaces', { token: S.admin, body: { name, members: [mia, agent.key] } }), name).json.space.id;
    ok(await call('PATCH', `/api/spaces/${id}`, { token: S.admin, body: { members: [mia, agent.key], entry: 'guests' } }), `${name}'s members`);
    return id;
  };
  S.bugs = await make('Bug Squash');
  S.other = await make('Elsewhere');
  S.mia = ok(await call('POST', '/api/login', { body: { login: 'mia', password: 'memberpass1234' } }), 'mia signs in').json.token;
  S.guest = ok(await call('POST', `/api/spaces/${S.bugs}/guest-link`, { token: S.admin, body: {} }), 'a guest link').json.space.guestToken;
  gh.state.issues.clear();
  gh.state.missing.clear();
  const L = gh.label;
  gh.issue(1, { title: 'Server: open, no priority', labels: [L('bug', 'd73a4a')] });
  gh.issue(2, { title: 'Planner: next', labels: [L('priority: next', 'fbca04'), L('good first issue', '7057ff')] });
  gh.issue(3, { title: 'Chat: now', labels: [L('priority: now', 'b60205')] });
  gh.issue(4, { title: 'Docs: closed', state: 'closed', labels: [L('priority: later')] });
  gh.issue(5, { title: 'Maps: later', labels: [L('priority: later')] });
  gh.issue(6, { title: 'A pull request', pull_request: { url: 'x' } });
  gh.seen.length = 0;
});

await live('the gate: only an owner turns it on, the terms first, only into an empty plan', async () => {
  const on = { on: true, repo: REPO, provider: 'issues-standin' };
  assert.deepEqual(ok(await call('GET', P(S.bugs), { token: S.mia }), 'a member reads the status').json, { on: false, provider: '', name: '', repo: '', last: '', next: '', error: '', counts: null, pulling: false, write: false, canWrite: false, via: 'public', writeOk: false, appError: '', appState: 'unchecked', app: null });
  const mia = await call('PUT', P(S.bugs), { token: S.mia, body: on });
  assert.equal(mia.status, 403, 'a member');
  assert.match(mia.json.error, /^Only an owner can turn the pull from .+ on or off\.$/);
  assert.equal((await call('PUT', P(S.bugs), { token: S.agent, body: on })).status, 403, 'an agent');
  assert.equal((await call('GET', P(S.bugs), { token: S.agent })).status, 403, 'an agent reads the plan, not the pull\'s route');
  assert.equal((await call('POST', `${P(S.bugs)}/now`, { token: S.agent, body: {} })).status, 403, 'an agent cannot ask for a pull');
  assert.ok([401, 403].includes((await call('PUT', `${P(S.bugs)}?guest=${encodeURIComponent(S.guest)}`, { body: on })).status), 'a guest');
  assert.equal((await call('POST', `${P(S.bugs)}/now?guest=${encodeURIComponent(S.guest)}`, { body: {} })).status, 403, 'a guest cannot ask for a pull (no edit)');
  assert.equal(ok(await call('GET', `${P(S.bugs)}?guest=${encodeURIComponent(S.guest)}`), 'a guest reads the status').json.on, false);
  assert.equal((await call('PUT', P(S.bugs), { body: on })).status, 401, 'nobody signed in');
  assert.equal((await call('PUT', P(S.bugs), { token: S.admin, body: { ...on, repo: 'not a repo' } })).status, 400);
  assert.equal((await call('PUT', P(S.bugs), { token: S.admin, body: { ...on, on: 'yes' } })).status, 400);
  assert.equal((await call('PUT', P(S.bugs), { token: S.admin, body: { ...on, provider: 'nowhere' } })).status, 400);
  assert.equal((await call('PUT', '/api/spaces/nosuchspace/issues-pull', { token: S.admin, body: on })).status, 404);
  const terms = await call('PUT', P(S.bugs), { token: S.admin, body: on });
  assert.deepEqual([terms.status, terms.json.error], [409, 'Test stand-in (not an issue service)\'s terms are not accepted on this server. The administrator accepts them in Manage, Modules, Service terms.']);
  assert.equal(gh.seen.length, 0, 'nothing asked before the terms are accepted');
  const view = ok(await call('GET', '/api/weather/terms', { token: S.admin }), 'the terms list').json;
  assert.deepEqual(view.services.map((s) => [s.id, s.kind]), [['met-norway', 'weather'], ['github', 'issues'], ['issues-standin', 'issues']]);
  assert.equal(view.services.find((s) => s.id === 'github').terms, GITHUB.terms);
  assert.equal((await call('PUT', '/api/weather/terms/issues-standin', { token: S.mia, body: { accept: true } })).status, 403, 'a member does not accept terms');
  ok(await call('PUT', '/api/weather/terms/issues-standin', { token: S.admin, body: { accept: true } }), 'the admin accepts');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'service-terms.json'), 'utf8')).services['issues-standin'].by, 'admin');
  ok(await putKey(S.bugs, 'plan:hand', { kind: 'work', title: 'By hand', start: '2026-11-01', end: '2026-11-01', done: false }, S.mia), 'work by hand');
  const full = await call('PUT', P(S.bugs), { token: S.admin, body: on });
  assert.deepEqual([full.status, full.json.error], [409, 'Clear the plan first (in Planner - Projects, Export and import, then Clear), or use a new space.']);
  ok(await call('DELETE', `/api/modules/schedule/data/plan%3Ahand?scope=space&space=${S.bugs}`, { token: S.mia }), 'gone again');
  assert.equal(gh.seen.length, 0);
});

let first;
await live('on: the board fixed to five columns, every issue once, by the pull', async () => {
  const r = ok(await linked(S.bugs, 777), 'the owner links and follows it');
  assert.deepEqual([r.json.on, r.json.repo, r.json.provider], [true, REPO, 'issues-standin']);
  const s = await until('the first pull', async () => { const v = await status(S.bugs); return v.last ? v : null; });
  assert.deepEqual(s.counts, { total: 5, open: 4, done: 1, written: 5, removed: 0 });
  assert.equal(s.error, '');
  first = await plan(S.bugs);
  assert.deepEqual(Object.keys(first).sort(), ['board:main', 'plan:gh-1', 'plan:gh-2', 'plan:gh-3', 'plan:gh-4', 'plan:gh-5'], 'one work per issue, the pull request skipped');
  assert.deepEqual(first['board:main'].value.columns.map((c) => c.id), ['inbox', 'now', 'next', 'later', 'done']);
  assert.deepEqual(first['board:main'].value.columns.filter((c) => c.done).map((c) => c.id), ['done']);
  const col = (k) => [first[k].value.column, first[k].value.done];
  assert.deepEqual(['plan:gh-1', 'plan:gh-2', 'plan:gh-3', 'plan:gh-4', 'plan:gh-5'].map(col), [['inbox', false], ['next', false], ['now', false], ['done', true], ['later', false]]);
  for (const e of Object.values(first)) assert.equal(e.by, 'system:issues', `${e.key} is the pull's`);
  assert.deepEqual(first['plan:gh-2'].value.tags, ['good-first-issue']);
  assert.deepEqual(first['plan:gh-2'].value.source, { from: 'issues-standin', repo: REPO, number: 2, url: `https://github.com/${REPO}/issues/2`, updated: gh.state.issues.get(2).updated_at });
  const settings = ok(await call('GET', `/api/modules/schedule/settings/values?scope=space&space=${S.bugs}`, { token: S.admin }), 'the settings').json.values;
  const value = (k) => settings[k];
  assert.equal(value('boardColumns'), 'priority');
  assert.deepEqual(value('tags').map((t) => [t.id, t.color]), [['bug', '#d73a4a'], ['good-first-issue', '#7057ff']]);
  assert.ok(gh.seen.every((x) => x.headers.authorization === `Bearer ${TOKEN}`), 'the token in Authorization');
  assert.ok(gh.seen.every((x) => !/since=/.test(x.url)), 'the first pull is a full one');
});

await live('again: in place, never a copy; then a 304 that costs nothing and changes nothing', async () => {
  ok(await pullNow(S.bugs), 'a second pull');
  const again = await plan(S.bugs);
  assert.deepEqual(Object.keys(again).sort(), Object.keys(first).sort(), 'no copy');
  for (const k of Object.keys(first)) assert.equal(again[k].version, first[k].version, `${k} not written again`);
  assert.match(gh.seen[gh.seen.length - 1].url, /since=/, 'asked only what changed');
  const seen = gh.seen.length;
  const s = ok(await pullNow(S.bugs), 'a third pull').json;
  assert.equal(gh.seen.length, seen + 1, 'one request');
  assert.ok(gh.seen[gh.seen.length - 1].headers['if-none-match'], 'the etag sent back');
  assert.equal(s.counts.written, 0);
  const third = await plan(S.bugs);
  for (const k of Object.keys(first)) assert.equal(third[k].version, first[k].version, `${k} unchanged by the 304`);
});

await live('a label moves work; a close moves it to done', async () => {
  gh.issue(1, { labels: [gh.label('bug', 'd73a4a'), gh.label('priority: now')] });
  gh.issue(3, { state: 'closed' });
  gh.issue(7, { title: 'Call: new', labels: [] });
  const s = ok(await pullNow(S.bugs), 'the pull').json;
  assert.deepEqual([s.counts.total, s.counts.written], [6, 3]);
  const p = await plan(S.bugs);
  assert.deepEqual([p['plan:gh-1'].value.column, p['plan:gh-3'].value.column, p['plan:gh-3'].value.done, p['plan:gh-7'].value.column], ['now', 'done', true, 'inbox']);
  assert.equal(p['plan:gh-2'].version, first['plan:gh-2'].version, 'what did not change is not written');
});

await live('while it is on, a person writes nothing of the plan or the board', async () => {
  const SAID = 'This comes from Test stand-in (not an issue service). Change it there.';
  const tries = [
    ['a member changes pulled work', await putKey(S.bugs, 'plan:gh-1', { kind: 'work', title: 'mine', start: '2026-11-01', end: '2026-11-01', done: false }, S.mia)],
    ['a member adds work', await putKey(S.bugs, 'plan:hand', { kind: 'work', title: 'mine', start: '2026-11-01', end: '2026-11-01', done: false }, S.mia)],
    ['the owner changes the columns', await putKey(S.bugs, 'board:main', { id: 'main', name: 'Board', field: 'column', columns: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', done: true }] }, S.admin)],
    ['a member deletes pulled work', await call('DELETE', `/api/modules/schedule/data/plan%3Agh-1?scope=space&space=${S.bugs}`, { token: S.mia })],
    ['the owner clears the plan', await call('DELETE', `/api/modules/schedule/data?scope=space&space=${S.bugs}`, { token: S.admin })],
  ];
  for (const [what, r] of tries) assert.deepEqual([r.status, r.json && r.json.error], [403, SAID], what);
  const p = await plan(S.bugs);
  assert.ok(!p['plan:hand'] && p['plan:gh-1'].value.title !== 'mine', 'nothing written');
  ok(await putKey(S.other, 'plan:hand', { kind: 'work', title: 'mine', start: '2026-11-01', end: '2026-11-01', done: false }, S.mia), 'another space is not held');
});

await live('while it is on and writing is off, the space\'s own fields change and GitHub\'s do not', async () => {
  const SAID = 'This comes from Test stand-in (not an issue service). Change it there.';
  const before = (await plan(S.bugs))['plan:gh-1'];
  assert.equal((await status(S.bugs)).write, false, 'writing is off');
  const at = gh.seen.length;
  const own = { ...before.value, start: '2026-12-01', end: '2026-12-09', rank: 'a1', owners: ['x'] };
  const r = ok(await putKey(S.bugs, 'plan:gh-1', own, S.mia), 'a member changes only the own fields');
  assert.deepEqual([r.json.item.value.start, r.json.item.value.end, r.json.item.value.title], ['2026-12-01', '2026-12-09', before.value.title]);
  assert.equal(gh.seen.length, at, 'nothing was asked of the service');
  const mixed = [
    ['title', { ...own, title: 'mine' }], ['column', { ...own, column: 'now' }], ['done', { ...own, done: true, column: 'done' }],
    ['tags', { ...own, tags: ['zzz'] }], ['source', { ...own, source: { url: 'x' } }],
  ];
  for (const [what, v] of mixed) {
    const m = await putKey(S.bugs, 'plan:gh-1', v, S.mia);
    assert.deepEqual([m.status, m.json && m.json.error], [403, SAID], `a mixed change (${what}) is refused`);
  }
  const n = await putKey(S.bugs, 'plan:gh-99', { kind: 'work', title: 'new', start: '2026-11-01', end: '2026-11-01', done: false }, S.mia);
  assert.equal(n.status, 403, 'work that is not stored is not made');
  const hand = await putKey(S.bugs, 'plan:hand', { kind: 'work', title: 'mine', start: '2026-11-01', end: '2026-11-01', done: false }, S.mia);
  assert.equal(hand.status, 403, 'a key that is not pulled work is as before');
  assert.equal((await plan(S.bugs))['plan:gh-1'].value.title, before.value.title);
  assert.equal(gh.seen.length, at, 'still nothing asked of the service');
});

await live('Pull now: someone with edit, at most once in the gap', async () => {
  const r = ok(await pullNow(S.bugs, S.mia), 'a member asks');
  assert.equal(r.json.on, true);
  const soon = await call('POST', `${P(S.bugs)}/now`, { token: S.mia, body: {} });
  assert.equal(soon.status, 429);
  assert.match(soon.json.error, /^It was pulled a moment ago\. Try again in \d+ seconds?\.$/);
  assert.ok(Number(soon.headers.get('retry-after')) >= 1);
});

await live('the service asks to wait: obeyed, and the timer pulls once the wait is over', async () => {
  gh.state.once = (req, res) => { res.writeHead(429, { 'retry-after': '2' }); res.end(); };
  const r = await pullNow(S.bugs);
  assert.equal(r.status, 502);
  assert.equal(r.json.error, 'Test stand-in (not an issue service) asked to wait.');
  const at = gh.seen.length;
  await sleep(1100);
  const rest = await call('POST', `${P(S.bugs)}/now`, { token: S.admin, body: {} });
  assert.equal(rest.status, 429, 'not asked again while it waits');
  assert.match(rest.json.error, /asked to wait\. Try again in \d+ seconds\./);
  assert.equal(gh.seen.length, at, 'nothing sent while it waits');
  const s = await until('the timer\'s pull', async () => { const v = await status(S.bugs); return gh.seen.length > at && !v.pulling && !v.error ? v : null; });
  assert.equal(s.on, true);
});

await live('the full pull removes an issue that is gone', async () => {
  gh.state.issues.delete(5);
  const s0 = await status(S.bugs);
  assert.ok((await plan(S.bugs))['plan:gh-5'], 'still there before the full pull');
  await sleep(Math.max(0, FULL_MS - (Date.now() - Date.parse(s0.last)) + 200));
  const r = ok(await pullNow(S.bugs), 'the full pull').json;
  assert.equal(r.counts.removed, 1);
  assert.ok(!/since=/.test(gh.seen[gh.seen.length - 1].url), 'it read every page');
  const p = await plan(S.bugs);
  assert.equal(p['plan:gh-5'], undefined, 'gone');
  assert.equal(Object.keys(p).filter((k) => k.startsWith('plan:')).length, 5);
});

await live('a repository that is not there', async () => {
  ok(await call('DELETE', `/api/modules/schedule/data/plan%3Ahand?scope=space&space=${S.other}`, { token: S.mia }), 'the other plan emptied');
  gh.state.missing.add('nobody/here');
  ok(await call('PUT', P(S.other), { token: S.admin, body: { on: true, repo: 'nobody/here', provider: 'issues-standin' } }), 'on');
  const s = await until('its pull', async () => { const v = await status(S.other); return v.error ? v : null; });
  assert.equal(s.error, 'No such repository, or it is private.');
  const mine = gh.seen.filter((x) => x.url.startsWith('/repos/nobody/here'));
  assert.ok(mine.length > 0 && mine.every((x) => x.headers.authorization === undefined), 'a repository followed with no link is read with no token at all');
  ok(await call('PUT', P(S.other), { token: S.admin, body: { on: false } }), 'off');
});

await live('off: the work stays and is editable again', async () => {
  const r = ok(await call('PUT', P(S.bugs), { token: S.admin, body: { on: false } }), 'off').json;
  assert.deepEqual([r.on, r.next, r.error], [false, '', '']);
  ok(await putKey(S.bugs, 'plan:gh-1', { kind: 'work', title: 'mine now', start: '2026-11-01', end: '2026-11-01', done: false }, S.mia), 'a member edits it');
  assert.equal((await call('POST', `${P(S.bugs)}/now`, { token: S.admin, body: {} })).status, 409, 'no pull while off');
  // On again, with a hand-changed pulled entry of this repository: allowed (it is the pull's own) and overwritten by the next pull.
  ok(await linked(S.bugs, 777), 'on again');
  await until('the full pull after turning on', async () => (await plan(S.bugs))['plan:gh-1'].value.title === 'Server: open, no priority');
  assert.equal((await plan(S.bugs))['plan:gh-1'].by, 'system:issues', 'the hand change is overwritten');
  assert.equal((await call('PUT', P(S.bugs), { token: S.admin, body: { on: true, repo: 'other/repo', provider: 'issues-standin' } })).status, 409, 'another repository needs an empty plan');
});


// --- live: writing back ------------------------------------------------------------------------------------------------------
const mutations = (from = 0) => gh.seen.slice(from).filter((x) => x.method !== 'GET');
const shape = (list) => list.map((x) => [x.method, new URL(x.url, 'http://x').pathname.replace(`/repos/${REPO}`, ''), x.body === null ? undefined : x.body]);
const edit = async (key, patch, token, space = S.bugs) => {
  const cur = (await plan(space))[key];
  return call('PUT', `/api/modules/schedule/data/${encodeURIComponent(key)}?scope=space&space=${space}`, { token, body: { value: { ...cur.value, ...patch }, version: cur.version } });
};
const move = (key, column, token) => edit(key, { column, done: column === 'done' }, token);
const lastLine = async () => (await status(S.bugs)).error;
const FROM_GITHUB = 'This comes from Test stand-in (not an issue service). Change it there.';

await live('writing: only an owner turns it on, and only for a space linked through the app by someone who may write', async () => {
  const view = (r) => [r.json.write, r.json.canWrite];
  assert.deepEqual(view(ok(await call('GET', P(S.bugs), { token: S.mia }), 'a member reads it')), [false, true], 'off, and the space is linked by someone who may write');
  assert.equal((await call('PUT', P(S.bugs), { token: S.mia, body: { write: true } })).status, 403, 'a member');
  assert.equal((await call('PUT', P(S.bugs), { token: S.agent, body: { write: true } })).status, 403, 'an agent');
  assert.equal((await call('PUT', P(S.bugs), { body: { write: true } })).status, 401, 'nobody');
  assert.equal((await call('PUT', P(S.bugs), { token: S.admin, body: { write: 'yes' } })).status, 400);
  assert.equal((await call('PUT', P(S.bugs), { token: S.admin, body: {} })).status, 400, 'on or write must be named');
  // A repository followed with no link (a public one, no token), and one linked by someone who could not write there: refused before
  // anything is sent, on turning on and on turning writing on; and each with its own sentence.
  const before = gh.seen.length;
  ok(await call('DELETE', `/api/modules/schedule/data?scope=space&space=${S.other}`, { token: S.admin }), 'the other plan is empty', 200).status;
  const other = ok(await call('PUT', P(S.other), { token: S.admin, body: { on: true, repo: 'other/repo', provider: 'issues-standin' } }), 'follows another repository, no link');
  assert.deepEqual(view(other), [false, false], 'not linked: no writing');
  assert.deepEqual([other.json.via, other.json.writeOk, other.json.appError, other.json.appState, other.json.app], ['public', false, '', 'working', { name: 'Chameleon Check', slug: 'chameleon-check' }]);
  const no = await call('PUT', P(S.other), { token: S.admin, body: { write: true } });
  assert.deepEqual([no.status, no.json.error], [409, 'Connect this repository through the GitHub app to change it from here.']);
  assert.equal((await call('PUT', P(S.other), { token: S.admin, body: { on: true, repo: 'other/repo', provider: 'issues-standin', write: true } })).status, 409, 'turning both on at once');
  assert.equal((await status(S.other)).write, false);
  ok(await call('PUT', P(S.other), { token: S.admin, body: { on: false } }), 'off');
  const readOnly = ok(await linked(S.other, 888), 'linked by someone who could only read');
  assert.deepEqual([readOnly.json.via, readOnly.json.writeOk, readOnly.json.canWrite, readOnly.json.write], ['app', false, false, false]);
  const may = await call('PUT', P(S.other), { token: S.admin, body: { write: true } });
  assert.deepEqual([may.status, may.json.error], [403, 'The GitHub app may not change this repository.']);
  assert.equal((await linked(S.other, 888, { write: true })).status, 403, 'nor with both at once');
  assert.equal((await status(S.other)).write, false);
  ok(await call('PUT', P(S.other), { token: S.admin, body: { on: false } }), 'off');
  const dropped = JSON.parse(fs.readFileSync(path.join(dataDir, 'issues.json'), 'utf8')).spaces[S.other];
  assert.deepEqual([dropped.via, dropped.installation, dropped.repositoryId, dropped.writeOk, dropped.write, dropped.appError], ['public', 0, 0, false, false, ''], 'stopping drops the link');
  assert.deepEqual(mutations(before), [], 'nothing was sent');
  // Writing alone needs a pull that is on.
  assert.equal((await call('PUT', P(S.other), { token: S.admin, body: { write: true } })).status, 409);
  const on = ok(await call('PUT', P(S.bugs), { token: S.admin, body: { write: true } }), 'the owner turns writing on').json;
  assert.deepEqual([on.on, on.write, on.canWrite, on.repo], [true, true, true, REPO]);
  const rec = JSON.parse(fs.readFileSync(path.join(dataDir, 'issues.json'), 'utf8')).spaces[S.bugs];
  assert.deepEqual([rec.write, typeof rec.writeBy, Boolean(rec.writeAt)], [true, 'string', true]);
});

await live('set up for writes: a moderator, and issues to move', async () => {
  const mod = ok(await call('POST', '/api/users', { token: S.admin, body: { login: 'mod', displayName: 'Mo Derator', role: 'member', password: 'modpass12345678' } }), 'mod', 201).json.user.key;
  ok(await call('PATCH', `/api/spaces/${S.bugs}`, { token: S.admin, body: { members: [(await call('GET', '/api/users', { token: S.admin })).json.users.find((u) => u.login === 'mia').key, mod] } }), 'in the space');
  ok(await call('PATCH', `/api/users/${mod}/spaces/${S.bugs}`, { token: S.admin, body: { permissions: { moderator: true } } }), 'moderates');
  S.mod = ok(await call('POST', '/api/login', { body: { login: 'mod', password: 'modpass12345678' } }), 'mod signs in').json.token;
  S.modKey = mod;
  const L = gh.label;
  gh.issue(10, { title: 'Server: ten', labels: [L('priority: next'), L('bug')] });
  gh.issue(11, { title: 'Chat: eleven', labels: [] });
  gh.issue(12, { title: 'x'.repeat(150), labels: [] });
  gh.issue(13, { title: 'Docs: thirteen', labels: [L('priority: later')] });
  ok(await pullNow(S.bugs), 'pulled');
  const p = await plan(S.bugs);
  assert.deepEqual([10, 11, 12, 13].map((n) => p[`plan:gh-${n}`].value.column), ['next', 'inbox', 'inbox', 'later']);
  assert.equal(p['plan:gh-10'].value.source.updated, gh.state.issues.get(10).updated_at, 'the work holds when GitHub last changed it');
});

await live('without write_out nothing is sent: a member sees pulled work read-only, as today', async () => {
  const before = gh.seen.length;
  const r = await move('plan:gh-10', 'now', S.mia);
  assert.deepEqual([r.status, r.json.error], [403, FROM_GITHUB]);
  assert.equal((await edit('plan:gh-10', { title: 'mine' }, S.mia)).status, 403);
  assert.equal(gh.seen.length, before, 'no request of any kind');
  assert.equal((await plan(S.bugs))['plan:gh-10'].value.column, 'next');
});

await live('a move writes exactly the label removal and the addition; Inbox only removes; Done closes; out of Done reopens', async () => {
  let at = gh.seen.length;
  const r = ok(await move('plan:gh-10', 'now', S.mod), 'a moderator moves it');
  assert.deepEqual(shape(mutations(at)), [
    ['DELETE', '/issues/10/labels/priority%3A%20next', undefined],
    ['POST', '/issues/10/labels', { labels: ['priority: now'] }],
  ]);
  assert.deepEqual(gh.state.issues.get(10).labels.map((l) => l.name), ['bug', 'priority: now'], 'the other label stays');
  const v = r.json.item.value;
  assert.deepEqual([v.column, v.done, v.by, v.source.updated], ['now', false, S.modKey, gh.state.issues.get(10).updated_at], 'written from GitHub\'s own answer, by the person');
  assert.equal(r.json.item.by, 'system:issues');
  at = gh.seen.length;
  ok(await move('plan:gh-10', 'inbox', S.mod), 'to the inbox');
  assert.deepEqual(shape(mutations(at)), [['DELETE', '/issues/10/labels/priority%3A%20now', undefined]], 'the inbox only removes');
  at = gh.seen.length;
  const done = ok(await move('plan:gh-10', 'done', S.mod), 'to done');
  assert.deepEqual(shape(mutations(at)), [['PATCH', '/issues/10', { state: 'closed', state_reason: 'completed' }]]);
  assert.deepEqual([done.json.item.value.column, done.json.item.value.done, gh.state.issues.get(10).state], ['done', true, 'closed']);
  at = gh.seen.length;
  const back = ok(await move('plan:gh-10', 'later', S.mod), 'out of done');
  assert.deepEqual(shape(mutations(at)), [['PATCH', '/issues/10', { state: 'open', state_reason: 'reopened' }], ['POST', '/issues/10/labels', { labels: ['priority: later'] }]]);
  assert.deepEqual([back.json.item.value.column, back.json.item.value.done], ['later', false]);
  assert.deepEqual(gh.state.created, [], 'no label was ever made on GitHub');
  // The owner may too (always), and a plain tick is a move to Done.
  at = gh.seen.length;
  ok(await edit('plan:gh-11', { done: true, column: undefined }, S.admin), 'the owner ticks it');
  assert.deepEqual(shape(mutations(at)), [['PATCH', '/issues/11', { state: 'closed', state_reason: 'completed' }]]);
  ok(await move('plan:gh-11', 'inbox', S.admin), 'and back');
});

await live('a title is one PATCH; a title GitHub holds longer is never written; a bad one is refused before a request', async () => {
  let at = gh.seen.length;
  const r = ok(await edit('plan:gh-11', { title: '  Chat: a new   title ' }, S.mod), 'a new title');
  assert.deepEqual(shape(mutations(at)), [['PATCH', '/issues/11', { title: 'Chat: a new title' }]]);
  assert.equal(r.json.item.value.title, 'Chat: a new title');
  at = gh.seen.length;
  const long = await edit('plan:gh-12', { title: 'Short' }, S.mod);
  assert.deepEqual([long.status, long.json.error], [403, 'This title is longer than the plan holds. Change it on GitHub.']);
  assert.deepEqual(mutations(at), []);
  assert.equal(gh.state.issues.get(12).title.length, 150);
  at = gh.seen.length;
  for (const title of ['', '   ', 'y'.repeat(121)]) {
    const bad = await edit('plan:gh-11', { title }, S.mod);
    assert.deepEqual([bad.status, bad.json.error], [400, 'Give it a title of at most 120 characters.'], JSON.stringify(title));
  }
  assert.equal(gh.seen.length, at, 'nothing sent');
  assert.equal((await edit('plan:gh-11', { column: 'someday' }, S.mod)).status, 400);
});

await live('tags are labels that exist: one added, one removed, a tag with no label refused', async () => {
  let at = gh.seen.length;
  ok(await edit('plan:gh-11', { tags: ['bug'] }, S.mod), 'adds a tag');
  assert.deepEqual(shape(mutations(at)), [['POST', '/issues/11/labels', { labels: ['bug'] }]]);
  assert.deepEqual((await plan(S.bugs))['plan:gh-11'].value.tags, ['bug']);
  at = gh.seen.length;
  ok(await edit('plan:gh-11', { tags: [] }, S.mod), 'removes it');
  assert.deepEqual(shape(mutations(at)), [['DELETE', '/issues/11/labels/bug', undefined]]);
  at = gh.seen.length;
  const none = await edit('plan:gh-11', { tags: ['nosuchtag'] }, S.mod);
  assert.deepEqual([none.status, none.json.error], [422, 'GitHub has no label called nosuchtag.']);
  assert.deepEqual(mutations(at), []);
  // A tag row the space has whose label GitHub does not: checked before anything is sent.
  const rows = ok(await call('GET', `/api/modules/schedule/settings/values?scope=space&space=${S.bugs}`, { token: S.admin }), 'settings').json.values.tags;
  ok(await call('PUT', `/api/modules/schedule/settings/space?space=${S.bugs}`, { token: S.admin, body: { values: { tags: [...rows, { id: 'ghost', label: 'ghost', icon: 'tag', color: '#112233' }] } } }), 'a tag with no label on GitHub');
  const ghost = await edit('plan:gh-11', { tags: ['ghost'] }, S.mod);
  assert.deepEqual([ghost.status, ghost.json.error], [422, 'GitHub has no label called ghost.']);
  assert.deepEqual([mutations(at), gh.state.created], [[], []], 'and no label was made');
});

await live('GitHub-only fields are refused with nothing sent; the space\'s own are stored here with no request', async () => {
  const at = gh.seen.length;
  for (const patch of [{ notes: 'mine' }, { source: null }, { kind: 'note' }, { parent: 'ghm-9' }, { id: 'x' }]) {
    const r = await edit('plan:gh-11', patch, S.mod);
    assert.deepEqual([r.status, r.json.error], [403, FROM_GITHUB], JSON.stringify(patch));
  }
  const newKey = await putKey(S.bugs, 'plan:gh-999', { kind: 'work', title: 'new', start: '2026-11-01', end: '2026-11-01', done: false }, S.mod);
  assert.deepEqual([newKey.status, newKey.json.error], [403, FROM_GITHUB], 'a new object is made only through the new-issue route');
  assert.equal((await putKey(S.bugs, 'board:main', { id: 'main', name: 'Board', field: 'column', columns: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', done: true }] }, S.admin)).status, 403, 'the board stays the pull\'s');
  assert.equal((await call('DELETE', `/api/modules/schedule/data/plan%3Agh-11?scope=space&space=${S.bugs}`, { token: S.mod })).status, 403, 'delete stays refused');
  assert.equal((await call('DELETE', `/api/modules/schedule/data?scope=space&space=${S.bugs}`, { token: S.admin })).status, 403, 'and Clear');
  assert.equal(gh.seen.length, at, 'nothing was sent');
  const r = ok(await edit('plan:gh-11', { owners: [S.modKey], start: '2026-10-05', end: '2026-10-09', rank: 'm', fields: { phase: '2' } }, S.mod), 'the space\'s own fields');
  assert.deepEqual([r.json.item.value.owners, r.json.item.value.start, r.json.item.value.end, r.json.item.value.rank], [[S.modKey], '2026-10-05', '2026-10-09', 'm']);
  assert.equal(gh.seen.length, at, 'no request for the space\'s own');
  gh.issue(11, { title: 'Chat: retitled on GitHub' });
  ok(await pullNow(S.bugs), 'a pull');
  const v = (await plan(S.bugs))['plan:gh-11'].value;
  assert.deepEqual([v.title, v.owners, v.start, v.end, v.rank, v.fields, v.by], ['Chat: retitled on GitHub', [S.modKey], '2026-10-05', '2026-10-09', 'm', { phase: '2' }, S.modKey], 'GitHub\'s title, the space\'s own kept');
});

await live('the echo: our write comes back on the next pull and is skipped', async () => {
  ok(await move('plan:gh-13', 'next', S.mod), 'a move');
  const mine = (await plan(S.bugs))['plan:gh-13'];
  const at = gh.seen.length;
  const s = ok(await pullNow(S.bugs), 'the pull after it').json;
  assert.ok(gh.seen.slice(at).some((x) => x.method === 'GET' && /since=/.test(x.url)), 'the pull asked and GitHub returned the issue');
  assert.deepEqual(mutations(at), [], 'the pull wrote nothing to GitHub');
  assert.equal((await plan(S.bugs))['plan:gh-13'].version, mine.version, 'and nothing here');
  assert.equal(s.counts.written, 0);
});

await live('a pull carrying an older issue does not write over a newer one', async () => {
  const old = JSON.stringify([gh.state.issues.get(13)]);
  ok(await move('plan:gh-13', 'now', S.mod), 'a move');
  const mine = (await plan(S.bugs))['plan:gh-13'];
  assert.equal(mine.value.column, 'now');
  gh.state.once = (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(old); };
  const s = ok(await pullNow(S.bugs), 'the pull that began before').json;
  assert.equal(s.counts.written, 0);
  const after = (await plan(S.bugs))['plan:gh-13'];
  assert.deepEqual([after.value.column, after.version], ['now', mine.version], 'what is newer stays');
});

await live('a new issue: a title and one label, an empty body; the work under its number; only with write_out', async () => {
  const create = (body, token = S.mod) => call('POST', `/api/spaces/${S.bugs}/issues`, { token, body });
  const at = gh.seen.length;
  assert.deepEqual([(await create({ title: 'Call: x', column: 'now' }, S.mia)).status, (await create({ title: 'Call: x', column: 'now' }, S.mia)).json.error], [403, 'Only someone allowed to change Test stand-in (not an issue service) can change this.']);
  assert.equal((await create({ title: 'Call: x', column: 'now' }, S.agent)).status, 403, 'an agent');
  assert.equal((await create({ title: 'Call: x', column: 'now' }, null)).status, 401);
  assert.equal((await call('POST', `/api/spaces/${S.bugs}/issues?guest=${encodeURIComponent(S.guest)}`, { body: { title: 'Call: x', column: 'now' } })).status, 403, 'a guest');
  assert.equal((await create({ title: '', column: 'now' })).status, 400);
  assert.equal((await create({ title: 'z'.repeat(121), column: 'now' })).status, 400);
  assert.equal((await create({ title: 'Call: x', column: 'done' })).status, 400, 'not into Done');
  assert.equal((await create({ title: 'Call: x', column: 'nowhere' })).status, 400);
  assert.deepEqual(mutations(at), [], 'nothing refused sent anything');
  const r = ok(await create({ title: '  Call: a new  one ', column: 'now', body: 'a body', assignees: ['x'], milestone: 3 }), 'a moderator opens one', 201);
  const made = mutations(at);
  assert.deepEqual(shape(made), [['POST', '/issues', { title: 'Call: a new one', labels: ['priority: now'] }]], 'a title and a label, no body, no assignee, no milestone');
  const n = Math.max(...gh.state.issues.keys());
  assert.equal(gh.state.issues.get(n).body, null, 'an empty body');
  assert.equal(r.json.item.key, `plan:gh-${n}`);
  assert.deepEqual([r.json.item.value.column, r.json.item.value.by, r.json.item.value.title, r.json.item.value.source.number], ['now', S.modKey, 'Call: a new one', n]);
  const inbox = ok(await create({ title: 'Call: inbox', column: 'inbox' }), 'one with no label', 201);
  assert.deepEqual(shape(mutations(at).slice(1)), [['POST', '/issues', { title: 'Call: inbox' }]]);
  assert.equal(inbox.json.item.value.column, 'inbox');
  const next = gh.seen.length;
  const s = ok(await pullNow(S.bugs), 'the pull').json;
  assert.deepEqual(mutations(next), []);
  assert.equal((await plan(S.bugs))[`plan:gh-${n}`].version, r.json.item.version, 'the echo is skipped');
  assert.equal(s.counts.written, 0);
  gh.state.labels.delete('priority: now');
  const noLabel = await create({ title: 'Call: y', column: 'now' });
  assert.deepEqual([noLabel.status, noLabel.json.error], [422, 'GitHub has no label called priority: now.']);
  gh.state.labels.add('priority: now');
});

await live('the service changed the same field: refused, GitHub\'s version shown; another field: goes ahead and keeps its label', async () => {
  const L = gh.label;
  gh.issue(13, { labels: [L('priority: later')] });
  let at = gh.seen.length;
  const r = await move('plan:gh-13', 'next', S.mod);
  assert.deepEqual([r.status, r.json.error], [409, 'This changed on GitHub a moment ago. It now shows GitHub\'s version.']);
  assert.deepEqual(mutations(at), [], 'nothing was written to GitHub');
  assert.equal(r.json.current.value.column, 'later', 'the answer carries GitHub\'s version');
  assert.equal((await plan(S.bugs))['plan:gh-13'].value.column, 'later', 'and so does the plan');
  // Only another field changed on GitHub: a label somebody added.
  gh.issue(13, { labels: [L('priority: later'), L('docs')] });
  at = gh.seen.length;
  const ok2 = ok(await move('plan:gh-13', 'next', S.mod), 'goes ahead');
  assert.deepEqual(shape(mutations(at)), [['DELETE', '/issues/13/labels/priority%3A%20later', undefined], ['POST', '/issues/13/labels', { labels: ['priority: next'] }]]);
  assert.deepEqual(gh.state.issues.get(13).labels.map((l) => l.name).sort(), ['docs', 'priority: next'], 'the label someone added is not wiped');
  assert.equal(ok2.json.item.value.column, 'next');
  // A stale copy of the page: its version is old.
  const cur = (await plan(S.bugs))['plan:gh-13'];
  const stale = await call('PUT', `/api/modules/schedule/data/plan%3Agh-13?scope=space&space=${S.bugs}`, { token: S.mod, body: { value: { ...cur.value, column: 'now' }, version: cur.version - 1 } });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error, 'someone changed this since you read it');
});

await live('GitHub does not answer, refuses, or asks to wait: one sentence, and nothing changes here', async () => {
  const key = 'plan:gh-13';
  const same = async () => { const p = (await plan(S.bugs))[key]; return [p.value.column, p.version]; };
  const base = await same();
  const hold = (status, headers, body) => (req, res) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
  const T = 'Test stand-in (not an issue service)';
  gh.state.onceWrite = (req) => req.destroy();
  let r = await move(key, 'now', S.mod);
  assert.deepEqual([r.status, r.json.error], [502, `${T} did not answer. Nothing was changed; try again.`]);
  assert.deepEqual(await same(), base);
  gh.state.onceWrite = hold(401, {}, { message: 'Bad credentials' });
  r = await move(key, 'now', S.mod);
  assert.deepEqual([r.status, r.json.error], [502, `${T} refused this server's access.`]);
  gh.state.onceWrite = hold(422, {}, { message: 'Validation Failed.' });
  r = await move(key, 'now', S.mod);
  assert.deepEqual([r.status, r.json.error], [502, `${T} refused the change: Validation Failed.`]);
  gh.state.onceWrite = hold(403, {}, { message: 'Resource not accessible by personal access token' });
  r = await move(key, 'now', S.mod);
  assert.deepEqual([r.status, r.json.error], [502, `${T} refused the change: Resource not accessible by personal access token.`], 'a 403 that is not a limit does not rest the repository');
  assert.deepEqual((await status(S.bugs)).error, '', 'the pull is not resting');
  assert.deepEqual(await same(), base, 'nothing changed in the space');
  // A limit: 429 with its wait, and every write waits with it, with no request sent.
  gh.state.onceWrite = hold(429, { 'retry-after': '2' }, { message: 'You have exceeded a secondary rate limit.' });
  r = await move(key, 'now', S.mod);
  assert.equal(r.status, 429);
  assert.match(r.json.error, /^Test stand-in \(not an issue service\) asked to wait\. Try again in \d+ seconds\.$/);
  assert.ok(Number(r.headers.get('retry-after')) >= 1);
  const at = gh.seen.length;
  const again = await move(key, 'now', S.mod);
  assert.equal(again.status, 429, 'resting');
  assert.equal((await call('POST', `/api/spaces/${S.bugs}/issues`, { token: S.mod, body: { title: 'Call: z', column: 'inbox' } })).status, 429, 'a new issue rests too');
  assert.equal(gh.seen.length, at, 'no request while it rests');
  assert.deepEqual(await same(), base);
  await until('the rest to end', async () => (await move(key, 'now', S.mod)).status === 200, 6000);
  ok(await move(key, 'next', S.mod), 'put it back');
});

await live('a write is not held behind a pull under way', async () => {
  await until('the gap', async () => { const s = await status(S.bugs); return !s.pulling && (!s.last || Date.now() - Date.parse(s.last) > 1100); });
  gh.state.slowList = 1500;
  const t0 = Date.now();
  const pulled = call('POST', `${P(S.bugs)}/now`, { token: S.admin, body: {} }).then((r) => ({ r, at: Date.now() - t0 }));
  await until('the pull to start', async () => (await status(S.bugs)).pulling, 3000);
  const wrote = await move('plan:gh-13', 'later', S.mod);
  const wroteAt = Date.now() - t0;
  ok(wrote, 'the write answered while the pull was under way');
  const p = await pulled;
  assert.equal(p.r.status, 200);
  assert.ok(wroteAt < p.at, `the write (${wroteAt} ms) finished before the pull (${p.at} ms)`);
  assert.equal((await plan(S.bugs))['plan:gh-13'].value.column, 'later', 'and the pull kept it');
});

// --- live: an agent's side (documentation/plans/plan-github-two-way.md, section 11) -------------------------------------------
const ask = (action, input, token = S.agent) => call('POST', `/api/spaces/${S.bugs}/action`, { token, body: { action: `schedule:${action}`, input } });
const refOf = (n) => ({ module: 'schedule', kind: 'plan', id: `gh-${n}`, scope: 'space', space: S.bugs });
const reviewOf = async (n) => (ok(await call('GET', `/api/spaces/${S.bugs}/agent-review`, { token: S.admin }), 'the review list').json.done).filter((c) => c.object.id === `gh-${n}`);
await live('an agent: without write_out nothing is sent; with it setColumn, setDone and updateEntry go through as a person\'s do', async () => {
  const L = gh.label;
  const users = (await call('GET', '/api/users', { token: S.admin })).json.users;
  ok(await call('PATCH', `/api/spaces/${S.bugs}`, { token: S.admin, body: { members: ['mia', 'mod'].map((l) => users.find((u) => u.login === l).key).concat(users.find((u) => u.agent).key) } }), 'the agent is in the space again');
  gh.issue(20, { title: 'Agent: twenty', labels: [L('priority: next')] });
  gh.issue(21, { title: 'Agent: twenty-one', labels: [] });
  gh.issue(22, { title: 'Agent: twenty-two', labels: [L('priority: later'), L('bug')] });
  ok(await pullNow(S.bugs), 'pulled');
  let at = gh.seen.length;
  // The agent column holds write_out off by default: the plan's own sentence, and not a request.
  const roles = ok(await call('GET', '/api/roles', { token: S.admin }), 'roles').json;
  assert.ok(roles.permissions.some((p) => p.key === 'module.schedule.write_out') && !roles.never.agent.includes('module.schedule.write_out'), 'the Agent column may tick it');
  assert.notEqual(roles.roles.agent['module.schedule.write_out'], true, 'and it is off to start with');
  const no = await ask('setColumn', { ref: refOf(20), column: 'now' });
  assert.deepEqual([no.status, no.json.error], [403, 'Only someone allowed to change Test stand-in (not an issue service) can change this.']);
  assert.equal(gh.seen.length, at, 'no request of any kind');
  assert.equal((await plan(S.bugs))['plan:gh-20'].value.column, 'next');
  ok(await call('PATCH', '/api/roles/agent', { token: S.admin, body: { 'module.schedule.write_out': true } }), 'an owner gives it');
  // setColumn: exactly the label removal and addition.
  at = gh.seen.length;
  const moved = ok(await ask('setColumn', { ref: refOf(20), column: 'now' }), 'moves it');
  assert.equal(moved.json.ok, true);
  assert.deepEqual(shape(mutations(at)), [['DELETE', '/issues/20/labels/priority%3A%20next', undefined], ['POST', '/issues/20/labels', { labels: ['priority: now'] }]]);
  const v = (await plan(S.bugs))['plan:gh-20'].value;
  assert.deepEqual([v.column, v.by === S.modKey, v.source.updated], ['now', false, gh.state.issues.get(20).updated_at], 'written from GitHub\'s answer');
  assert.notEqual(v.by, 'system:issues', 'by the agent');
  // setDone closes with completed; undone it reopens and labels.
  at = gh.seen.length;
  ok(await ask('setDone', { ref: refOf(20), done: true }), 'ticks it');
  assert.deepEqual(shape(mutations(at)), [['PATCH', '/issues/20', { state: 'closed', state_reason: 'completed' }]]);
  at = gh.seen.length;
  ok(await ask('setDone', { ref: refOf(20), done: false }), 'unticks it');
  assert.deepEqual(shape(mutations(at)).map((x) => x[0]), ['PATCH', 'DELETE'], 'it reopens, into the inbox (its label goes)');
  assert.equal(gh.state.issues.get(20).state, 'open');
  // updateEntry: the title is one PATCH; the space's own fields are stored here with no request; the notes are GitHub's.
  at = gh.seen.length;
  ok(await ask('updateEntry', { ref: refOf(21), title: ' Agent: a new   title ' }), 'a title');
  assert.deepEqual(shape(mutations(at)), [['PATCH', '/issues/21', { title: 'Agent: a new title' }]]);
  at = gh.seen.length;
  ok(await ask('updateEntry', { ref: refOf(21), start: '2026-10-05', end: '2026-10-09' }), 'its own days');
  assert.equal(gh.seen.length, at, 'no request for the space\'s own');
  const notes = await ask('updateEntry', { ref: refOf(21), notes: 'mine' });
  assert.deepEqual([notes.status, notes.json.error], [403, FROM_GITHUB]);
  assert.equal(gh.seen.length, at, 'and nothing sent for the body');
  // A title GitHub holds longer is never written.
  const long = await ask('updateEntry', { ref: refOf(12), title: 'Short' });
  assert.deepEqual([long.status, long.json.error], [403, 'This title is longer than the plan holds. Change it on GitHub.']);
  assert.deepEqual(mutations(at), []);
  // A delete is asked for and never made.
  ok(await call('PATCH', '/api/roles/agent', { token: S.admin, body: { agentDelete: true } }), 'an owner lets it ask');
  const del = await call('POST', `/api/spaces/${S.bugs}/delete-asks`, { token: S.agent, body: { object: refOf(21) } });
  assert.deepEqual([del.status, del.json.error], [403, 'Test stand-in (not an issue service) issues can\'t be deleted from here. Close it, or delete it on Test stand-in (not an issue service).']);
});

await live('an agent: the service changed the same field, and a write with writing off', async () => {
  const L = gh.label;
  gh.issue(22, { labels: [L('priority: now')] });
  let at = gh.seen.length;
  const r = await ask('setColumn', { ref: refOf(22), column: 'next' });
  assert.deepEqual([r.status, r.json.error], [409, 'This changed on GitHub a moment ago. It now shows GitHub\'s version.']);
  assert.deepEqual(mutations(at), [], 'nothing written to GitHub');
  assert.equal((await plan(S.bugs))['plan:gh-22'].value.column, 'now', 'the plan shows GitHub\'s');
  // Another field changed on GitHub only: it goes ahead, and the other label stays.
  gh.issue(22, { labels: [L('priority: now'), L('docs')] });
  at = gh.seen.length;
  ok(await ask('setColumn', { ref: refOf(22), column: 'later' }), 'goes ahead');
  assert.deepEqual(gh.state.issues.get(22).labels.map((l) => l.name).sort(), ['docs', 'priority: later']);
  // Writing off in the space: today's refusal, nothing sent. An agent never turns writing on.
  ok(await call('PUT', P(S.bugs), { token: S.admin, body: { write: false } }), 'writing off');
  at = gh.seen.length;
  const off = await ask('setColumn', { ref: refOf(22), column: 'now' });
  assert.deepEqual([off.status, off.json.error], [403, FROM_GITHUB]);
  assert.equal(gh.seen.length, at);
  assert.equal((await call('PUT', P(S.bugs), { token: S.agent, body: { write: true } })).status, 403, 'an agent cannot turn writing on');
  assert.equal((await call('PUT', P(S.bugs), { token: S.agent, body: { on: true, repo: 'other/repo', provider: 'issues-standin' } })).status, 403, 'nor follow a repository');
  ok(await call('PUT', P(S.bugs), { token: S.admin, body: { write: true } }), 'writing on again');
});

await live('an agent: Undo is another write that obeys the same rule', async () => {
  const change = async (n) => { const c = (await reviewOf(n)).filter((x) => !x.undone); assert.ok(c.length, `a change for ${n}`); return c[0]; };
  const undo = (c, token = S.admin) => call('POST', `/api/spaces/${S.bugs}/changes/${c.id}/undo`, { token, body: {} });
  // 22 was moved by the agent while a tag from GitHub was drawn in with it: which change is whose can't be told, so it is refused.
  const c22 = await change(22);
  let at = gh.seen.length;
  const mixed = await undo(c22);
  assert.deepEqual([mixed.status, mixed.json.error], [409, 'This changed on GitHub as well since then, so it can\'t be undone from here.']);
  assert.deepEqual(mutations(at), []);
  // A plain move of 20 undone: back to its earlier column, one removal and one addition.
  ok(await ask('setColumn', { ref: refOf(20), column: 'next' }), 'moves 20');
  const c20a = (await reviewOf(20)).filter((x) => !x.undone)[0];
  assert.equal(c20a.undoable, true);
  at = gh.seen.length;
  ok(await undo(c20a), 'undone');
  assert.equal(mutations(at).length >= 1, true, 'the undo went to GitHub');
  assert.equal((await plan(S.bugs))['plan:gh-20'].value.column, gh.state.issues.get(20).labels.some((l) => l.name === 'priority: now') ? 'now' : 'inbox', 'and the plan shows what GitHub has');
  assert.equal((await undo(c20a)).status, 409, 'once');
  // Changed on GitHub since: the undo is refused with the conflict sentence, nothing sent, and the plan shows GitHub's.
  ok(await ask('updateEntry', { ref: refOf(21), title: 'Agent: second title' }), 'a title');
  const c21 = await change(21);
  gh.issue(21, { title: 'Agent: set on GitHub' });
  at = gh.seen.length;
  const refused = await undo(c21);
  assert.deepEqual([refused.status, refused.json.error], [409, 'This changed on GitHub a moment ago. It now shows GitHub\'s version.']);
  assert.deepEqual(mutations(at), []);
  assert.equal((await plan(S.bugs))['plan:gh-21'].value.title, 'Agent: set on GitHub');
  // Changed here since: the plain sentence of every undo.
  ok(await ask('setColumn', { ref: refOf(20), column: 'later' }), 'moves 20');
  const c20 = await change(20);
  ok(await move('plan:gh-20', 'next', S.admin), 'a person moves it after');
  at = gh.seen.length;
  const late = await undo(c20);
  assert.equal(late.status, 409);
  assert.deepEqual(mutations(at), []);
  // Writing off since: the list says why, and the undo says it, with nothing sent.
  ok(await ask('setColumn', { ref: refOf(21), column: 'next' }), 'moves 21');
  const c21b = await change(21);
  ok(await call('PUT', P(S.bugs), { token: S.admin, body: { write: false } }), 'writing off');
  const listed = (await reviewOf(21)).find((x) => x.id === c21b.id);
  assert.deepEqual([listed.undoable, listed.why], [false, FROM_GITHUB]);
  at = gh.seen.length;
  const off = await undo(c21b);
  assert.deepEqual([off.status, off.json.error], [403, FROM_GITHUB]);
  assert.deepEqual(mutations(at), []);
  ok(await call('PUT', P(S.bugs), { token: S.admin, body: { write: true } }), 'writing on again');
});

await live('the roadmap fields: defining one and setting a choice make no request to GitHub; Area comes once from the title', async () => {
  const at = gh.seen.length;
  const AREA = { id: 'area', label: 'Area', order: 0, options: [{ id: 'server', label: 'Server' }, { id: 'chat', label: 'Chat' }, { id: 'to-do', label: 'To-do' }] };
  const PHASE = { id: 'phase', label: 'Phase', order: 1, options: [{ id: 'first', label: 'First' }, { id: 'second', label: 'After first release (Thomas, 2026-11-15)' }] };
  // Defining a field is the space's own record: not a key the pull holds, so it is allowed in a followed plan and needs `columns`.
  assert.equal((await putKey(S.bugs, 'field:area', AREA, S.mia)).status, 403, 'a member does not have the columns right');
  ok(await putKey(S.bugs, 'field:area', AREA, S.mod), 'a moderator defines Area');
  ok(await putKey(S.bugs, 'field:phase', PHASE, S.admin), 'the owner defines Phase');
  assert.equal((await putKey(S.bugs, 'field:Bad Id', AREA, S.admin)).status >= 400, true, 'a key that is not a field id is refused');
  assert.equal((await putKey(S.bugs, 'field:big', { ...AREA, id: 'big', label: 'x'.repeat(41) }, S.admin)).status, 400, 'a label over 40 characters');
  assert.equal(gh.seen.length, at, 'defining fields sent nothing');
  const had = await plan(S.bugs);
  assert.ok(had['field:area'] && had['field:phase'], 'both are stored beside the plan');
  // A choice on pulled work: the right to edit is enough (a member without write_out), and nothing goes to GitHub.
  const set = ok(await edit('plan:gh-11', { fields: { area: 'chat', phase: 'first' } }, S.mia), 'a member sets the choices');
  assert.deepEqual(set.json.item.value.fields, { area: 'chat', phase: 'first' });
  assert.equal(gh.seen.length, at, 'a field edit made no request of any kind');
  const mixed = await edit('plan:gh-11', { title: 'mine', fields: { area: 'server' } }, S.mia);
  assert.deepEqual([mixed.status, mixed.json.error], [403, FROM_GITHUB], 'a title still needs write_out');
  assert.equal((await edit('plan:gh-11', { column: 'now' }, S.mia)).status, 403, 'and so does a move');
  assert.deepEqual((await plan(S.bugs))['plan:gh-11'].value.fields, { area: 'chat', phase: 'first' }, 'the refused change did not touch the choices');
  assert.equal(gh.seen.length, at, 'still no request');
  const clear = ok(await edit('plan:gh-11', { fields: undefined }, S.mod), 'the moderator clears them');
  assert.equal('fields' in clear.json.item.value, false);
  ok(await edit('plan:gh-11', { fields: { phase: 'second' } }, S.mod), 'and sets one');
  assert.equal(gh.seen.length, at, 'a moderator\'s field edit made no request either');
  // An agent: updateEntry takes `fields` and sends nothing (its write_out is not needed for them).
  const a = ok(await ask('updateEntry', { ref: refOf(11), fields: 'area=to-do; phase=First' }), 'the agent sets them by name');
  assert.equal(a.json.ok, true);
  assert.deepEqual((await plan(S.bugs))['plan:gh-11'].value.fields, { area: 'to-do', phase: 'first' });
  assert.equal(gh.seen.length, at, 'the agent\'s field edit made no request of any kind');
  const bad = await ask('updateEntry', { ref: refOf(11), fields: 'area=nowhere' });
  assert.equal(bad.status, 422);
  assert.match(bad.json.error, /Area has no choice called nowhere\. Its choices are server, chat, to-do\./);
  assert.equal(gh.seen.length, at);
  // New work takes its Area from the title, once; after that Area is the space's own and a pull keeps it.
  gh.issue(30, { title: 'Server: thirty', labels: [] });
  gh.issue(31, { title: 'to-do: thirty-one', labels: [] });
  gh.issue(32, { title: 'Nothing like an area here', labels: [] });
  gh.issue(33, { title: 'Elsewhere: thirty-three', labels: [] });
  ok(await pullNow(S.bugs), 'a pull');
  let p = await plan(S.bugs);
  assert.deepEqual([30, 31, 32, 33].map((n) => p[`plan:gh-${n}`].value.fields), [{ area: 'server' }, { area: 'to-do' }, undefined, undefined], 'Area from the words before the colon, by id or name, none when it names no choice');
  ok(await edit('plan:gh-30', { fields: { area: 'chat', phase: 'second' } }, S.mod), 'then it is the space\'s own');
  gh.issue(30, { title: 'Server: thirty, retitled on GitHub' });
  ok(await pullNow(S.bugs), 'a pull');
  p = await plan(S.bugs);
  assert.deepEqual([p['plan:gh-30'].value.title, p['plan:gh-30'].value.fields], ['Server: thirty, retitled on GitHub', { area: 'chat', phase: 'second' }], 'the pull keeps the choices and the title is GitHub\'s');
  assert.ok(p['field:area'] && p['field:phase'], 'a pull never removes a field');
  const full = gh.seen.length;
  // Nothing about a field was ever sent: every request since the start of this test was a read of issues or labels.
  assert.ok(gh.seen.slice(at, full).every((x) => x.method === 'GET'), 'only reads, for the pulls');
  assert.ok(gh.seen.slice(at, full).every((x) => !/field|area|phase/i.test(`${x.url} ${x.raw || ''}`)), 'no word of a field in any request');
});

// --- live: the app's own troubles (documentation/plans/plan-github-app.md, section 9) -----------------------------------------------
await live('the app is gone, paused or renamed: the sentence, reads without a token, writes refused, and it heals', async () => {
  const GONE = 'The GitHub app is no longer installed on other/repo. Install it again and press Connect to GitHub, or stop following.';
  const PAUSED = 'The GitHub app is paused for other/repo on GitHub.';
  const from = gh.seen.length;
  const follow = (repositoryId, extra = {}) => linked(S.other, repositoryId, extra);
  gh.state.installs[9].mode = 'gone';
  ok(await follow(999, { write: true }), 'linked');
  let s = await until('the first pull', async () => { const v = await status(S.other); return v.appError && v.last ? v : null; });
  assert.deepEqual([s.via, s.appError, s.error, s.write], ['app', GONE, '', true], 'the trouble is on the record; the public repository still reads');
  const read = gh.seen.slice(from).filter((x) => x.url.startsWith('/repos/other/repo'));
  assert.ok(read.length > 0 && read.every((x) => x.headers.authorization === undefined), 'read with no token');
  const create = await call('POST', `/api/spaces/${S.other}/issues`, { token: S.admin, body: { title: 'Server: nope', column: 'now' } });
  assert.deepEqual([create.status, create.json.error], [409, GONE], 'writing is refused with the sentence');
  assert.deepEqual(mutations(from), [], 'nothing sent');
  gh.state.installs[9].mode = 'suspended';
  await sleep(1100);
  ok(await call('POST', `${P(S.other)}/now`, { token: S.admin, body: {} }), 'a pull');
  s = await status(S.other);
  assert.equal(s.appError, PAUSED, 'paused on GitHub: its own sentence');
  assert.equal((await call('POST', `/api/spaces/${S.other}/issues`, { token: S.admin, body: { title: 'Server: nope', column: 'now' } })).json.error, PAUSED);
  gh.state.installs[9].mode = 'ok';
  await sleep(1100);
  ok(await call('POST', `${P(S.other)}/now`, { token: S.admin, body: {} }), 'a pull');
  s = await status(S.other);
  assert.equal(s.appError, '', 'a token made again clears it');
  assert.ok(gh.seen.filter((x) => x.url.startsWith('/repos/other/repo')).slice(-1)[0].headers.authorization === `Bearer ${TOKEN}`, 'and the next read carries the installation token');
  assert.ok(!JSON.stringify(s).includes(TOKEN) && s.via === 'app' && !('installation' in s) && !('repositoryId' in s), 'the status carries no token and no id');
  // A repository GitHub now names differently is followed from the mint.
  gh.state.installs[10].rename = 'other/renamed';
  ok(await follow(1010), 'linked again, through another installation');
  await until('the pull', async () => (await status(S.other)).repo === 'other/renamed');
  s = await status(S.other);
  assert.deepEqual([s.repo, s.appError, s.error], ['other/renamed', '', ''], 'a repository GitHub names differently is followed from the mint');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'issues.json'), 'utf8')).spaces[S.other].repo, 'other/renamed');
  ok(await call('PUT', P(S.other), { token: S.admin, body: { on: false } }), 'off');
});

await live('a write that meets a 301 is made again once, after a new token, and a 401 drops the token', async () => {
  const minted = gh.state.mints.length;
  const before = gh.seen.length;
  const cur = (await plan(S.bugs))['plan:gh-10'];
  gh.state.onceWrite = (req, res) => { res.writeHead(301, { location: `${ORIGIN}/repositories/777/issues/10` }); res.end(); };
  const moved = await call('PUT', `/api/modules/schedule/data/${encodeURIComponent('plan:gh-10')}?scope=space&space=${S.bugs}`, { token: S.admin, body: { value: { ...cur.value, title: 'Server: ten, moved' }, version: cur.version } });
  assert.equal(moved.status, 200, `the write goes through on the second try: ${moved.text.slice(0, 200)}`);
  const patches = gh.seen.slice(before).filter((x) => x.method === 'PATCH');
  assert.equal(patches.length, 2, 'the first met the 301, the second was made');
  assert.ok(patches.every((x) => x.headers.authorization === `Bearer ${TOKEN}`));
  assert.equal(gh.state.mints.length, minted + 1, 'after a fresh token');
  const was = gh.state.mints.length;
  const cur2 = (await plan(S.bugs))['plan:gh-10'];
  gh.state.onceWrite = (req, res) => { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"message":"Bad credentials"}'); };
  const refused = await call('PUT', `/api/modules/schedule/data/${encodeURIComponent('plan:gh-10')}?scope=space&space=${S.bugs}`, { token: S.admin, body: { value: { ...cur2.value, title: 'Server: ten, again' }, version: cur2.version } });
  assert.equal(refused.status, 502, 'a 401 changes nothing');
  const cur3 = (await plan(S.bugs))['plan:gh-10'];
  ok(await call('PUT', `/api/modules/schedule/data/${encodeURIComponent('plan:gh-10')}?scope=space&space=${S.bugs}`, { token: S.admin, body: { value: { ...cur3.value, title: 'Server: ten, third' }, version: cur3.version } }), 'the next write');
  assert.equal(gh.state.mints.length, was + 1, 'the 401 dropped the token: the next call made a new one');
});

await live('what GitHub was sent holds only what the plan allows, and no one\'s name', async () => {
  const sent = mutations();
  assert.ok(sent.length > 20, `${sent.length} writes seen`);
  const ALLOWED = { PATCH: ['title', 'state', 'state_reason'], POST: ['title', 'labels'], DELETE: [] };
  const names = ['Bug Squash', 'Elsewhere', 'Mia', 'Mo Derator', 'mia', 'mod', 'admin', S.bugs, S.other, S.modKey, 'system:issues', 'plan:gh', 'schedule', 'owners', 'rank', 'column'];
  for (const x of sent) {
    const where = `${x.method} ${x.url}`;
    assert.ok(new RegExp(`^/repos/${REPO.replace('/', '\\/')}/(issues|labels)`).test(x.url), `${where}: only the followed repository`);
    assert.ok(ALLOWED[x.method], where);
    const keys = x.body && typeof x.body === 'object' ? Object.keys(x.body) : [];
    assert.ok(keys.every((k) => ALLOWED[x.method].includes(k)), `${where}: only ${ALLOWED[x.method]} (sent ${keys})`);
    assert.ok(x.method !== 'POST' || !/\/issues$/.test(x.url) || x.body.body === undefined, `${where}: an empty body`);
    assert.equal(x.headers.authorization, `Bearer ${TOKEN}`, `${where}: the token in Authorization`);
    assert.ok(!x.url.includes(TOKEN) && !(x.raw || '').includes(TOKEN), `${where}: never elsewhere`);
    for (const word of names) assert.ok(!`${x.url} ${x.raw || ''}`.includes(word), `${where}: nothing of ${word}`);
    for (const [h, v] of Object.entries(x.headers)) if (!['host', 'connection', 'accept', 'user-agent', 'x-github-api-version', 'authorization', 'content-type', 'content-length', 'accept-encoding', 'accept-language', 'sec-fetch-mode'].includes(h)) assert.fail(`${where}: an unexpected header ${h}=${v}`);
  }
  assert.deepEqual(gh.state.created, [], 'no label was made on GitHub');
});

// --- live: the link flow (documentation/plans/plan-github-app.md, step 2) ---------------------------------------------------------
const linkUrls = []; // every address an answer may carry a state in: the authorize address and the install address
const backPages = []; // the plain pages the return answered, scanned with the answers
const linkSecrets = []; // completion secrets of links not kept in doneOf: in the redirect to the returning browser, and in no answer, log or file
await live('the link: Connect, GitHub\'s sign-in with PKCE, the list with the person\'s own right, the revoke, then Follow', async () => {
  const one = (r, q) => new URL(r).searchParams.get(q);
  ok(await call('PUT', P(S.other), { token: S.admin, body: { on: false } }), 'nothing followed in the space');
  await until('the plan cleared (the renamed repository\'s work goes)', async () => (await call('DELETE', `/api/modules/schedule/data?scope=space&space=${S.other}`, { token: S.admin })).status === 200, 15000);
  const before = links.state.requests.length;
  const t = await linkThrough({ call: asCall(S.admin), space: S.other });
  linkUrls.push(t.authorizeUrl);
  assert.equal(t.start.status, 200);
  assert.deepEqual(Object.keys(t.start.json), ['url'], 'Connect answers the address only');
  const u = new URL(t.authorizeUrl);
  assert.equal(u.origin + u.pathname, `${ORIGIN}/login/oauth/authorize`);
  assert.deepEqual([one(t.authorizeUrl, 'client_id'), one(t.authorizeUrl, 'code_challenge_method'), one(t.authorizeUrl, 'redirect_uri')], [CLIENT_ID, 'S256', `${base}/api/issues-link/back`], 'the client id, S256 and the link address');
  assert.match(one(t.authorizeUrl, 'state'), /^[\w-]{43}$/, 'a fresh state');
  assert.match(one(t.authorizeUrl, 'code_challenge'), /^[\w-]{43}$/, 'an S256 challenge');
  assert.ok(![...u.searchParams.keys()].some((k) => /space|user|person|environment/i.test(k)) && !t.authorizeUrl.includes(S.other), 'nothing of the space or the person goes to GitHub');
  assert.equal(t.back.status, 302, `GitHub's return: ${t.backText}`);
  assert.equal(t.to.pathname + t.to.search.replace(/link=[\w-]+/, 'link=X').replace(/done=[\w-]{43}$/, 'done=D'), `/?space=${S.other}&link=X&done=D`, 'back to the space, with the link');
  assert.equal(t.back.headers.get('referrer-policy'), 'no-referrer');
  // The exchange carried the verifier (matching the challenge), the secret and the redirect address; the token was revoked.
  const ex = links.state.exchanges.at(-1);
  assert.deepEqual([ex.clientId, ex.secretOk, ex.verifierOk, ex.redirectUri], [CLIENT_ID, true, true, `${base}/api/issues-link/back`], 'the exchange: secret, verifier, address');
  const made = links.state.requests.slice(before).map((r) => `${r.method} ${r.path}`);
  assert.deepEqual(made.slice(0, 2), ['GET /login/oauth/authorize', 'POST /login/oauth/access_token']);
  assert.equal(made.at(-1), `DELETE /applications/${CLIENT_ID}/token`, 'the user token is revoked last, before the person is sent back');
  assert.equal(links.state.revoked.length, links.state.issuedTokens.length, 'every user token ever made was revoked');
  assert.equal(links.state.revoked.at(-1), links.state.issuedTokens.at(-1));
  assert.ok(links.state.requests.slice(before).filter((r) => r.path.startsWith('/user/')).length > 0);
  // The list: newest first, each with the person's own right, nothing of their account.
  assert.equal(t.list.status, 200, t.list.text);
  const list = t.list.json;
  assert.deepEqual(Object.keys(list).sort(), ['installUrl', 'more', 'repositories']);
  assert.deepEqual(list.repositories, [
    { repositoryId: 1010, repo: 'other/repo', private: false, installation: 10, canWrite: false },
    { repositoryId: 999, repo: 'other/repo', private: false, installation: 9, canWrite: true },
    { repositoryId: 888, repo: 'other/repo', private: false, installation: 8, canWrite: false },
    { repositoryId: 777, repo: REPO, private: false, installation: 7, canWrite: true },
  ], 'newest first, with canWrite from the person\'s permissions');
  assert.equal(list.more, false);
  assert.match(list.installUrl, new RegExp(`^${ORIGIN.replace(/[.]/g, '\\.')}/apps/chameleon-check/installations/new\\?state=[\\w-]{43}$`), 'the install address, from the app\'s slug');
  linkUrls.push(list.installUrl);
  // The record is made by Follow, from the list; the page's own words about the installation or the right are never read.
  const bad = await followFrom({ call: asCall(S.admin), space: S.other, link: t.link, repositoryId: 4242 });
  assert.deepEqual([bad.status, bad.json.error], [400, 'That repository is not in your list. Press Connect to GitHub again.'], 'a repository not in the list');
  const forged = await followFrom({ call: asCall(S.admin), space: S.other, link: t.link, repositoryId: 888, extra: { installation: 7, writeOk: true, repo: REPO, write: false } });
  assert.deepEqual([forged.status, forged.json.repo || forged.json.error, forged.json.via, forged.json.writeOk, forged.json.canWrite], [200, 'other/repo', 'app', false, false], 'a read-only person: writeOk false, whatever the page sends');
  const rec = JSON.parse(fs.readFileSync(path.join(dataDir, 'issues.json'), 'utf8')).spaces[S.other];
  assert.deepEqual([rec.installation, rec.repositoryId, rec.writeOk, rec.via, typeof rec.linkBy, Boolean(rec.linkAt)], [8, 888, false, 'app', 'string', true], 'the record comes from the list');
  const no = await call('PUT', P(S.other), { token: S.admin, body: { write: true } });
  assert.deepEqual([no.status, no.json.error], [403, 'The GitHub app may not change this repository.'], 'no write without the person\'s own right');
  assert.equal((await call('GET', `/api/spaces/${S.other}/issues-link?link=${t.link}&done=${t.done}`, { token: S.admin })).status, 404, 'a link is used up once it has been followed');
  ok(await call('PUT', P(S.other), { token: S.admin, body: { on: false } }), 'off');
  // A person with write access: the switch may go on.
  const w = await linked(S.other, 999, { write: true });
  assert.deepEqual([w.status, w.json.writeOk, w.json.canWrite, w.json.write], [200, true, true, true], 'write allowed only because the person may write');
  ok(await call('PUT', P(S.other), { token: S.admin, body: { on: false } }), 'off');
});

await live('the link: a state works once and for a short time; an unknown one and a replay are refused with a sentence', async () => {
  const ENDED = 'This link has run out. Go back and press Connect to GitHub again.';
  const t = await linkThrough({ call: asCall(S.admin), space: S.other });
  linkUrls.push(t.authorizeUrl);
  assert.equal(t.back.status, 302);
  const again = await fetch(t.backUrl, { redirect: 'manual' });
  const text = await again.text();
  backPages.push(text);
  assert.equal(again.status, 400, 'the same return twice');
  assert.ok(text.includes(ENDED) && !text.includes(one(t.backUrl, 'code')) && !text.includes(one(t.backUrl, 'state')), 'a plain page with the sentence, never the query');
  assert.equal((await fetch(`${base}/api/issues-link/back?code=abc&state=${'x'.repeat(43)}`, { redirect: 'manual' })).status, 400, 'an unknown state');
  assert.equal((await fetch(`${base}/api/issues-link/back?code=abc`, { redirect: 'manual' })).status, 400, 'no state');
  assert.equal((await fetch(`${base}/api/issues-link/back`, { redirect: 'manual' })).status, 400, 'nothing at all');
  function one(href, q) { return new URL(href).searchParams.get(q); }
  // Ended: the link's time runs out (5 seconds in this check), before the return and after it.
  const late = await call('POST', `/api/spaces/${S.other}/issues-link`, { token: S.admin, body: { provider: 'issues-standin' } });
  linkUrls.push(late.json.url);
  const gone = await fetch(late.json.url, { redirect: 'manual' });
  await sleep(5600);
  const expired = await fetch(gone.headers.get('location'), { redirect: 'manual' });
  backPages.push(await expired.text());
  assert.equal(expired.status, 400, 'a return after the link ended');
  const kept = await linkThrough({ call: asCall(S.admin), space: S.other });
  linkUrls.push(kept.authorizeUrl);
  assert.equal(kept.list.status, 200);
  await sleep(5600);
  assert.equal((await call('GET', `/api/spaces/${S.other}/issues-link?link=${kept.link}&done=${kept.done}`, { token: S.admin })).status, 404, 'the list ends too');
  const stale = await followFrom({ call: asCall(S.admin), space: S.other, link: kept.link, repositoryId: 777 });
  assert.deepEqual([stale.status, stale.json.error], [404, ENDED], 'and cannot be followed from');
  assert.equal((await status(S.other)).on, false, 'nothing was followed');
});

await live('the link: only the owner who started it, in that space, reads or follows from it; a member and an agent are refused', async () => {
  const OWNER = /^Only an owner can connect a repository to GitHub\.$/;
  const t = await linkThrough({ call: asCall(S.admin), space: S.other });
  linkUrls.push(t.authorizeUrl);
  assert.equal(t.list.status, 200);
  for (const [who, name] of [[S.mia, 'a member'], [S.agent, 'an agent']]) {
    const start = await call('POST', `/api/spaces/${S.other}/issues-link`, { token: who, body: { provider: 'issues-standin' } });
    assert.equal(start.status, 403, `${name} cannot start`);
    if (name === 'a member') assert.match(start.json.error, OWNER);
    assert.equal((await call('GET', `/api/spaces/${S.other}/issues-link?link=${t.link}&done=${t.done}`, { token: who })).status, 403, `${name} cannot read a list`);
    assert.equal((await followFrom({ call: asCall(who), space: S.other, link: t.link, repositoryId: 777 })).status, 403, `${name} cannot follow`);
  }
  assert.equal((await call('POST', `/api/spaces/${S.other}/issues-link`, { body: { provider: 'issues-standin' } })).status, 401, 'nobody signed in');
  assert.equal((await call('POST', `/api/spaces/${S.other}/issues-link?guest=${encodeURIComponent(S.guest)}`, { body: { provider: 'issues-standin' } })).status, 403, 'a guest');
  assert.equal((await call('GET', `/api/spaces/${S.bugs}/issues-link?link=${t.link}&done=${t.done}`, { token: S.admin })).status, 404, 'the same link in another space');
  assert.equal((await call('GET', `/api/spaces/${S.other}/issues-link`, { token: S.admin })).status, 404, 'no link named');
  assert.equal((await call('GET', `/api/spaces/${S.other}/issues-link?link=nonsense&done=x`, { token: S.admin })).status, 404);
  // Another owner of the environment is another person: the link is not theirs.
  const second = await call('POST', '/api/users', { token: S.admin, body: { login: 'olive', displayName: 'Olive', role: 'owner', password: 'ownerpass1234' } });
  ok(second, 'a second owner', 201);
  const olive = ok(await call('POST', '/api/login', { body: { login: 'olive', password: 'ownerpass1234' } }), 'olive signs in').json.token;
  assert.equal((await call('GET', `/api/spaces/${S.other}/issues-link?link=${t.link}&done=${t.done}`, { token: olive })).status, 404, 'another owner reads nothing of it');
  assert.equal((await followFrom({ call: asCall(olive), space: S.other, link: t.link, repositoryId: 777 })).status, 404, 'nor follows from it');
  assert.equal((await call('GET', `/api/spaces/${S.other}/issues-link?link=${t.link}&done=${t.done}`, { token: S.admin })).status, 200, 'still the starter\'s');
});

await live('the link: the completion secret binds list and follow to the browser GitHub sent back; without it, wrong or used, both are refused alike', async () => {
  const ENDED = 'This link has run out. Go back and press Connect to GitHub again.';
  const t = await linkThrough({ call: asCall(S.admin), space: S.other });
  linkUrls.push(t.authorizeUrl);
  assert.match(t.done, /^[\w-]{43}$/, 'a 256-bit secret, in the redirect');
  assert.equal(t.list.status, 200, 'with it, the list');
  const L = (extra) => call('GET', `/api/spaces/${S.other}/issues-link?link=${t.link}${extra}`, { token: S.admin });
  for (const [what, extra] of [['none', ''], ['an empty one', '&done='], ['a wrong one', `&done=${'A'.repeat(43)}`], ['the link id in its place', `&done=${t.link}`], ['the state in its place', `&done=${new URL(t.authorizeUrl).searchParams.get('state')}`]]) {
    const r = await L(extra);
    assert.deepEqual([r.status, r.json.error], [404, ENDED], `the list with ${what}`);
  }
  for (const [what, done] of [['none', null], ['a wrong one', 'B'.repeat(43)], ['a number', 7], ['an object', { x: 1 }]]) {
    const r = await followFrom({ call: asCall(S.admin), space: S.other, link: t.link, done, repositoryId: 777 });
    assert.deepEqual([r.status, r.json.error], [404, ENDED], `the follow with ${what}: the same sentence, no hint which part failed`);
  }
  assert.equal((await status(S.other)).on, false, 'nothing was followed');
  // The attack: the owner sends their authorize address to someone else; that person's browser is sent back, and holds the secret.
  // The owner, who started the link, has none: they cannot list or follow, whatever they guess.
  const start = await call('POST', `/api/spaces/${S.other}/issues-link`, { token: S.admin, body: { provider: 'issues-standin' } });
  linkUrls.push(start.json.url);
  const victim = await fetch(start.json.url, { redirect: 'manual' });
  const returned = await fetch(victim.headers.get('location'), { redirect: 'manual' });
  assert.equal(returned.status, 302);
  const theirs = new URL(returned.headers.get('location'), base);
  const stolen = { link: theirs.searchParams.get('link'), done: theirs.searchParams.get('done') };
  assert.ok(stolen.done, 'the secret went to the browser that came back');
  const starterSees = await call('GET', `/api/spaces/${S.other}/issues-link?link=${stolen.link}`, { token: S.admin });
  assert.deepEqual([starterSees.status, starterSees.json.error], [404, ENDED], 'the starter never got the secret: no list');
  const starterFollows = await followFrom({ call: asCall(S.admin), space: S.other, link: stolen.link, done: null, repositoryId: 777 });
  assert.equal(starterFollows.status, 404, 'and no follow');
  assert.equal((await status(S.other)).on, false);
  // Whoever holds the secret still has to be the owner who started it, in that space and environment.
  assert.equal((await call('GET', `/api/spaces/${S.other}/issues-link?link=${stolen.link}&done=${stolen.done}`, { token: S.mia })).status, 403, 'a member with the secret');
  assert.equal((await call('GET', `/api/spaces/${S.bugs}/issues-link?link=${stolen.link}&done=${stolen.done}`, { token: S.admin })).status, 404, 'the same secret in another space');
  // Spent when the follow succeeds (a second link of the same owner for the space replaced the first, so this one is made now).
  const t2 = await linkThrough({ call: asCall(S.admin), space: S.other });
  linkUrls.push(t2.authorizeUrl);
  linkSecrets.push(t.done, stolen.done);
  ok(await followFrom({ call: asCall(S.admin), space: S.other, link: t2.link, repositoryId: 999 }), 'with the secret, the follow');
  const used = await followFrom({ call: asCall(S.admin), space: S.other, link: t2.link, repositoryId: 999 });
  assert.deepEqual([used.status, used.json.error], [404, ENDED], 'used once');
  assert.equal((await call('GET', `/api/spaces/${S.other}/issues-link?link=${t2.link}&done=${t2.done}`, { token: S.admin })).status, 404, 'and the list too');
  ok(await call('PUT', P(S.other), { token: S.admin, body: { on: false } }), 'off');
});

await live('the link: a forged installation_id on the setup address changes nothing; only the person\'s own list counts', async () => {
  const mine = links.state.person.installations;
  links.state.person.installations = mine.filter((i) => i.id === 8); // this person reaches installation 8 only
  const before = links.state.requests.length;
  try {
    const t = await linkThrough({ call: asCall(S.admin), space: S.other });
    linkUrls.push(t.authorizeUrl, t.list.json.installUrl);
    assert.deepEqual(t.list.json.repositories.map((r) => r.repositoryId), [888], 'only what this person reaches');
    // GitHub's setup address, with the install state and an installation_id of someone else's (7): it sends the person to sign in
    // again, and never reads the id.
    const setup = new URL(`${base}/api/issues-link/back`);
    setup.searchParams.set('state', new URL(t.list.json.installUrl).searchParams.get('state'));
    setup.searchParams.set('installation_id', '7');
    setup.searchParams.set('setup_action', 'install');
    const r = await fetch(setup, { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.equal(new URL(r.headers.get('location')).origin + new URL(r.headers.get('location')).pathname, `${ORIGIN}/login/oauth/authorize`, 'on to the sign-in, not to a link');
    linkUrls.push(r.headers.get('location'));
    assert.ok(!r.headers.get('location').includes('installation'), 'the id goes nowhere');
    // The install state works once.
    const twice = await fetch(setup, { redirect: 'manual' });
    backPages.push(await twice.text());
    assert.equal(twice.status, 400, 'the setup address twice');
    // An id with no state, and with a state of the wrong kind (the sign-in's own state is not an install state): refused.
    assert.equal((await fetch(`${base}/api/issues-link/back?installation_id=7&setup_action=install`, { redirect: 'manual' })).status, 400, 'a forged id alone');
    assert.equal((await fetch(`${base}/api/issues-link/back?installation_id=7&state=${new URL(t.authorizeUrl).searchParams.get('state')}`, { redirect: 'manual' })).status, 400, 'the sign-in state is not an install state');
    // GitHub sends the person back to the sign-in's address; the list is the same: the installation 7 is not there, whatever was asked.
    const auth = await fetch(r.headers.get('location'), { redirect: 'manual' });
    const back = await fetch(auth.headers.get('location'), { redirect: 'manual' });
    assert.equal(back.status, 302);
    const link = new URL(back.headers.get('location'), base).searchParams.get('link');
    const done = new URL(back.headers.get('location'), base).searchParams.get('done');
    doneOf.set(link, done);
    assert.equal(link, t.link, 'the same link, a fresh list');
    const list = ok(await call('GET', `/api/spaces/${S.other}/issues-link?link=${link}&done=${done}`, { token: S.admin }), 'the list again').json;
    linkUrls.push(list.installUrl);
    assert.deepEqual(list.repositories.map((x) => x.repositoryId), [888]);
    const forged = await followFrom({ call: asCall(S.admin), space: S.other, link, repositoryId: 777, extra: { installation: 7 } });
    assert.deepEqual([forged.status, forged.json.error], [400, 'That repository is not in your list. Press Connect to GitHub again.'], 'a repository of someone else\'s installation cannot be followed');
    assert.equal((await status(S.other)).on, false);
    assert.ok(links.state.requests.slice(before).every((q) => !/\/installations\/7\b/.test(q.path)), 'nothing was ever asked about installation 7 for this person');
    // The person installs the app on another repository and comes back: the list grows by what they reach now.
    links.state.person.installations = mine.filter((i) => [8, 9].includes(i.id));
    const setup2 = new URL(`${base}/api/issues-link/back`);
    setup2.searchParams.set('state', new URL(list.installUrl).searchParams.get('state'));
    setup2.searchParams.set('installation_id', '9');
    const r2 = await fetch(setup2, { redirect: 'manual' });
    const a2 = await fetch(r2.headers.get('location'), { redirect: 'manual' });
    const b2 = await fetch(a2.headers.get('location'), { redirect: 'manual' });
    assert.equal(b2.status, 302);
    const done2 = new URL(b2.headers.get('location'), base).searchParams.get('done');
    assert.notEqual(done2, done, 'a new sign-in, a new completion secret');
    doneOf.set(link, done2);
    assert.equal((await call('GET', `/api/spaces/${S.other}/issues-link?link=${link}&done=${done}`, { token: S.admin })).status, 404, 'the earlier secret is dead');
    const list2 = ok(await call('GET', `/api/spaces/${S.other}/issues-link?link=${link}&done=${done2}`, { token: S.admin }), 'the list after installing').json;
    linkUrls.push(list2.installUrl);
    assert.deepEqual(list2.repositories.map((x) => x.repositoryId), [999, 888], 'the new repository is in the list');
  } finally { links.state.person.installations = mine; }
});

await live('the link: GitHub refused, or failed after the sign-in: a sentence, the link gone, the user token still revoked', async () => {
  const DENIED = 'GitHub was not given access. Go back and press Connect to GitHub again.';
  const FAILED = 'GitHub did not finish connecting. Go back and press Connect to GitHub again.';
  links.state.deny = true;
  let t;
  try { t = await linkThrough({ call: asCall(S.admin), space: S.other }); } finally { links.state.deny = false; }
  linkUrls.push(t.authorizeUrl);
  backPages.push(t.backText);
  assert.equal(t.back.status, 400);
  assert.ok(t.backText.includes(DENIED), 'the person said no on GitHub');
  const made = links.state.issuedTokens.length;
  links.state.breakLists = true;
  try { t = await linkThrough({ call: asCall(S.admin), space: S.other }); } finally { links.state.breakLists = false; }
  linkUrls.push(t.authorizeUrl);
  backPages.push(t.backText);
  assert.equal(t.back.status, 502);
  assert.ok(t.backText.includes(FAILED), 'GitHub failed after the sign-in');
  assert.equal(links.state.issuedTokens.length, made + 1);
  assert.equal(links.state.revoked.length, links.state.issuedTokens.length, 'revoked although the lists failed');
  assert.equal(links.state.tokens.get(links.state.issuedTokens.at(-1)).revoked, true);
  assert.equal((await call('GET', `/api/spaces/${S.other}/issues-link?link=x&done=y`, { token: S.admin })).status, 404);
  // The user token, once revoked, reaches nothing: the fake would answer 401 to a later use.
  const used = await fetch(`${ORIGIN}/user/installations`, { headers: { authorization: `Bearer ${links.state.issuedTokens.at(-1)}` } });
  assert.equal(used.status, 401, 'a revoked user token is dead');
});

await live('the link: refused at the start when the server has no working app, or the terms are not accepted', async () => {
  const sourceOf = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
  assert.ok(/const PRODUCT_HOST_PATHS = \[[^\]]*'\/api\/issues-link\/back'/.test(sourceOf), 'on a host with environments the return is on the product host');
  const was = await call('GET', '/api/weather/terms', { token: S.admin });
  assert.deepEqual([was.json.githubApp.state, was.json.githubApp.name, was.json.githubApp.slug], ['working', 'Chameleon Check', 'chameleon-check'], 'Service terms answers the app\'s state');
  assert.equal(was.json.githubApp.callback, `${base}/api/issues-link/back`, 'and the address to register, for the administrator');
  const mia = await call('GET', '/api/weather/terms', { token: S.mia });
  assert.equal(mia.status === 200 ? mia.json.githubApp.callback : '', '', 'never for anyone else');
  assert.ok(!JSON.stringify(was.json).includes(CLIENT_SECRET));
  const un = await call('DELETE', '/api/weather/terms/issues-standin', { token: S.admin });
  ok(un, 'the terms withdrawn');
  const refused = await call('POST', `/api/spaces/${S.other}/issues-link`, { token: S.admin, body: { provider: 'issues-standin' } });
  assert.deepEqual([refused.status, /not accepted on this server/.test(refused.json.error)], [409, true], 'terms first');
  ok(await call('PUT', '/api/weather/terms/issues-standin', { token: S.admin, body: { accept: true } }), 'accepted again');
  assert.equal((await call('POST', `/api/spaces/${S.other}/issues-link`, { token: S.admin, body: { provider: 'nowhere' } })).status, 400, 'no such service');
});

await live('the pull view tells whether the server has a working GitHub app, with no request to GitHub, and nothing secret', async () => {
  // Before the app was ever asked it said 'unchecked' (the first group); the mints since have asked it: working, with its name.
  const shown = [];
  for (const [who, url] of [['admin', P(S.other)], ['mia', P(S.other)], ['guest', `${P(S.bugs)}?guest=${encodeURIComponent(S.guest)}`]]) {
    const r = ok(await call('GET', url, { token: who === 'admin' ? S.admin : who === 'mia' ? S.mia : undefined }), `${who} reads the view`);
    shown.push(r.json);
    assert.deepEqual([r.json.appState, r.json.app], ['working', { name: 'Chameleon Check', slug: 'chameleon-check' }], `${who}: the state and the app's public name`);
    assert.deepEqual(Object.keys(r.json.app), ['name', 'slug']);
    assert.ok(!('private' in r.json), 'the record does not know if the repository is private');
  }
  assert.ok(shown.every((v) => JSON.stringify(v) === JSON.stringify({ ...v })), 'plain data');
  const before = gh.app.length;
  await call('GET', P(S.other), { token: S.admin });
  assert.equal(gh.app.length, before, 'reading the view asks GitHub nothing');
});
await live('no secret is in an answer, the data, the record, the log or a request but the one that carries it', async () => {
  const jwts = [...gh.jwts];
  await stop();
  const pemBody = PEM.split('\n').filter((l) => l && !l.startsWith('-----'));
  const secrets = { 'the installation token': TOKEN, 'the client secret': CLIENT_SECRET, 'the key': pemBody[1], 'the key\'s first line': pemBody[0], ...Object.fromEntries(jwts.map((j, i) => [`a JWT (${i})`, j])), ...links.secrets() };
  // The states: only the two addresses made for GitHub carry one (the authorize and install addresses); no other answer, page, log or file.
  const stateOf = (href) => new URL(href).searchParams.get('state');
  [...doneOf.values(), ...linkSecrets].forEach((v, i) => { secrets[`a completion secret (${i})`] = v; });
  for (const href of linkUrls) secrets[`a state (${stateOf(href)})`] = stateOf(href);
  const bare = (a) => linkUrls.reduce((t, href) => t.split(href).join(''), a);
  answers.push(...backPages);
  assert.ok(jwts.length > 0 && pemBody.length > 10);
  for (const [what, v] of Object.entries(secrets)) {
    assert.ok(answers.every((a) => !bare(a).includes(v)), `${what}: not in an answer`);
    assert.ok(!serverOut.includes(v), `${what}: not in the log`);
  }
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(dataDir)) for (const [what, v] of Object.entries(secrets)) assert.ok(!fs.readFileSync(f).includes(v), `${what}: not in ${path.relative(dataDir, f)}`);
  const record = JSON.parse(fs.readFileSync(path.join(dataDir, 'issues.json'), 'utf8'));
  assert.deepEqual(Object.keys(record.spaces).sort(), [S.bugs, S.other].sort());
  assert.equal(record.spaces[S.bugs].repo, REPO);
  assert.deepEqual([record.spaces[S.bugs].via, record.spaces[S.bugs].installation, record.spaces[S.bugs].repositoryId, record.spaces[S.bugs].writeOk, typeof record.spaces[S.bugs].linkBy, Boolean(record.spaces[S.bugs].linkAt), record.spaces[S.bugs].appError], ['app', 7, 777, true, 'string', true, '']);
  assert.ok(Object.keys(record.spaces[S.bugs]).every((k) => ['provider', 'repo', 'on', 'since', 'etag', 'last', 'tried', 'fullAt', 'next', 'restUntil', 'error', 'counts', 'by', 'at', 'write', 'writeBy', 'writeAt', 'via', 'installation', 'repositoryId', 'writeOk', 'linkBy', 'linkAt', 'appError'].includes(k)), 'only the fields the plan names');
  // What reached the fake: the repository's requests carry the installation token in Authorization only; the app's carry a JWT only.
  for (const x of gh.seen.filter((r) => /^\/repos\/(Drowbe|other)\//.test(r.url))) {
    assert.ok(!x.url.includes(TOKEN) && !(x.raw || '').includes(TOKEN), `${x.method} ${x.url}: the token only in Authorization`);
    assert.ok([`Bearer ${TOKEN}`, undefined].includes(x.headers.authorization), `${x.method} ${x.url}: the installation token or none`);
  }
  assert.ok(gh.seen.filter((r) => r.url.startsWith(`/repos/${REPO}`)).every((x) => x.headers.authorization === `Bearer ${TOKEN}`), 'the linked repository: read and written with the installation token');
  for (const x of gh.app) {
    assert.ok(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(x.headers.authorization), `${x.method} ${x.path}: a JWT`);
    assert.ok(!JSON.stringify(x.body || {}).includes(CLIENT_SECRET) && !JSON.stringify(x.body || {}).includes(TOKEN) && !x.path.includes(CLIENT_ID), `${x.method} ${x.path}: no secret in the body or the address`);
  }
  assert.ok(gh.app.every((x) => !x.headers.authorization.includes(TOKEN)));
});

await stop();
lk.close();
gh.server.close();
console.log(`check-issues: OK (${n} groups)`);
