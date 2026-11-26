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
 * Not checked here: a real request to api.github.com (no network in a check; the terms must be accepted by a person first), and
 * GitHub's real secondary-limit answers.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'ghp_checkissuestoken0123456789abcdef';
const REPO = 'Drowbe/coffee-pub-chameleon';

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
  const state = { issues: new Map(), once: null, missing: new Set(), clock: Date.parse('2026-11-01T00:00:00Z') };
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
    state.issues.set(number, v);
    return v;
  };
  const label = (name, color = 'ededed') => ({ id: 1, name, color });
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers });
    if (state.once) { const f = state.once; state.once = null; return f(req, res); }
    const u = new URL(req.url, 'http://x');
    const m = /^\/repos\/([^/]+)\/([^/]+)\/issues$/.exec(u.pathname);
    if (!m || state.missing.has(`${m[1]}/${m[2]}`)) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"message":"Not Found"}'); }
    const since = u.searchParams.get('since');
    const per = Number(u.searchParams.get('per_page') || 30);
    const page = Number(u.searchParams.get('page') || 1);
    let list = [...state.issues.values()].sort((a, b) => a.updated_at.localeCompare(b.updated_at));
    if (since) list = list.filter((i) => i.updated_at >= since);
    const slice = list.slice((page - 1) * per, page * per);
    const body = JSON.stringify(slice);
    const etag = `W/"${Buffer.from(`${u.search}|${body}`).toString('base64').slice(-24)}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { etag }); return res.end(); }
    const headers = { 'content-type': 'application/json', etag, 'x-ratelimit-remaining': '4999' };
    if (page * per < list.length) {
      const next = new URL(req.url, `http://${req.headers.host}`);
      next.searchParams.set('page', String(page + 1));
      headers.link = `<${next.href}>; rel="next"`;
    }
    res.writeHead(200, headers);
    res.end(body);
  });
  return { server, seen, state, issue, label };
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
});

await test('only GitHub is registered, unless the check names its stand-in', () => {
  const out = execFileSync(process.execPath, ['-e', "const r=require('./server/issue-providers'); console.log(JSON.stringify(r.list().map(p=>[p.id,p.origin,p.pollMs,p.fullEveryMs,p.tokenEnv])))"], { cwd: ROOT, env: { PATH: process.env.PATH } }).toString().trim();
  assert.deepEqual(JSON.parse(out), [['github', 'https://api.github.com', 600000, 86400000, 'ISSUES_GITHUB_TOKEN']]);
  const { valid } = require('../server/issue-providers');
  assert.equal(valid(STANDIN), true);
  assert.equal(valid({ ...GITHUB, origin: 'http://api.github.com' }), false, 'https unless the stand-in');
  assert.equal(valid({ ...GITHUB, needsToken: true }), false, 'a service that needs a token is not registered');
  assert.equal(valid({ ...GITHUB, terms: '' }), false, 'its terms are named');
  assert.equal(valid({ ...GITHUB, tokenEnv: 'PATH' }), false, 'the token comes only from an ISSUES_ variable');
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
    source: { from: 'github', repo: 'o/r', number: 7, url: 'https://github.com/o/r/issues/1' },
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
  assert.match((await I.askIssues(STANDIN, { repo: REPO })).error, /refused the token/);
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
      /const pulled = pulledRefusal\(ctx, key\);\n  if \(pulled\) return pulled;/.test(fnOf(text, 'function putModuleValue(')), // a person's write refused
      (delText.match(/const pulled = d\.pulledRefusal\(ctx, key\);\n    if \(pulled\) return pulled;/g) || []).length === 2, // a person's delete refused
      (text.match(/const pulled = pulledRefusal\(ctx, null\);/g) || []).length === 2, // a Clear and its Undo refused
      /ctx\.who\.system === 'issues'/.test(refusal) && /if \(!rec \|\| !rec\.on\) return null;/.test(refusal), // only the pull, only while on
      /const inSpace = who\.system \? true :/.test(fnOf(text, 'function moduleSpaceRefusal(')), // the system writer is only issuePullWho
    ].every(Boolean);
  };
  assert.equal(intact(src), true, 'the gate is as the plan says');
  const from = src.indexOf('// --- the issue pull (documentation/plans/plan-github-pull.md');
  const inPull = (cut) => (t) => t.slice(0, from) + cut(t.slice(from));
  for (const [name, cut, delCut] of [
    ['the owner', inPull((t) => t.replace('if (!who.user || who.user.agent || !hasOwnerRights(who.user)) return', 'if (!who.user) return'))],
    ['the terms on turning on', inPull((t) => t.replace('if (!serviceTerms.accepted(adapter)) return res.status(409).json({ error: issuesLib.SAY.terms(adapter.name) });\n  // A pulled', '// A pulled'))],
    ['the empty plan', inPull((t) => t.replace('if (others.length) return', 'if (false) return'))],
    ['the edit for Pull now', inPull((t) => t.replace("issuePullPlace(req, res, 'own')", "issuePullPlace(req, res, 'read')"))],
    ['the terms on a pull', inPull((t) => t.replace("if (!serviceTerms.accepted(adapter)) return issuePulls.set", 'if (false) return issuePulls.set'))],
    ['the refusal of a write', (t) => t.replace('const pulled = pulledRefusal(ctx, key);\n  if (pulled) return pulled;', '')],
    ['the refusal of a delete', null, (t) => t.replace('const pulled = d.pulledRefusal(ctx, key);\n    if (pulled) return pulled;', '')],
    ['the refusal of a Clear', (t) => t.replace('const pulled = pulledRefusal(ctx, null);', 'const pulled = null;')],
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
    ISSUES_TEST_STANDIN: ORIGIN, ISSUES_GITHUB_TOKEN: TOKEN, ISSUES_TEST_GAP_MS: '1000', ISSUES_TEST_FULL_MS: String(FULL_MS), ISSUES_TEST_POLL_MS: String(3600 * 1000), ISSUES_TEST_TICK_MS: '300',
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
  assert.deepEqual(ok(await call('GET', P(S.bugs), { token: S.mia }), 'a member reads the status').json, { on: false, provider: '', name: '', repo: '', last: '', next: '', error: '', counts: null, pulling: false });
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
  assert.deepEqual([full.status, full.json.error], [409, 'Clear the plan first, or use a new space.']);
  ok(await call('DELETE', `/api/modules/schedule/data/plan%3Ahand?scope=space&space=${S.bugs}`, { token: S.mia }), 'gone again');
  assert.equal(gh.seen.length, 0);
});

let first;
await live('on: the board fixed to five columns, every issue once, by the pull', async () => {
  const r = ok(await call('PUT', P(S.bugs), { token: S.admin, body: { on: true, repo: REPO, provider: 'issues-standin' } }), 'the owner turns it on');
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
  assert.deepEqual(first['plan:gh-2'].value.source, { from: 'issues-standin', repo: REPO, number: 2, url: `https://github.com/${REPO}/issues/2` });
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
  ok(await call('PUT', P(S.other), { token: S.admin, body: { on: false } }), 'off');
});

await live('off: the work stays and is editable again', async () => {
  const r = ok(await call('PUT', P(S.bugs), { token: S.admin, body: { on: false } }), 'off').json;
  assert.deepEqual([r.on, r.next, r.error], [false, '', '']);
  ok(await putKey(S.bugs, 'plan:gh-1', { kind: 'work', title: 'mine now', start: '2026-11-01', end: '2026-11-01', done: false }, S.mia), 'a member edits it');
  assert.equal((await call('POST', `${P(S.bugs)}/now`, { token: S.admin, body: {} })).status, 409, 'no pull while off');
  // On again, with a hand-changed pulled entry of this repository: allowed (it is the pull's own) and overwritten by the next pull.
  ok(await call('PUT', P(S.bugs), { token: S.admin, body: { on: true, repo: REPO, provider: 'issues-standin' } }), 'on again');
  await until('the full pull after turning on', async () => (await plan(S.bugs))['plan:gh-1'].value.title === 'Server: open, no priority');
  assert.equal((await plan(S.bugs))['plan:gh-1'].by, 'system:issues', 'the hand change is overwritten');
  assert.equal((await call('PUT', P(S.bugs), { token: S.admin, body: { on: true, repo: 'other/repo', provider: 'issues-standin' } })).status, 409, 'another repository needs an empty plan');
});

await live('the token is never in an answer, the data, the record or the log', async () => {
  await stop();
  assert.ok(answers.every((a) => !a.includes(TOKEN)), 'no answer');
  assert.ok(!serverOut.includes(TOKEN), 'not in the log');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(dataDir)) assert.ok(!fs.readFileSync(f).includes(TOKEN), `not in ${path.relative(dataDir, f)}`);
  const record = JSON.parse(fs.readFileSync(path.join(dataDir, 'issues.json'), 'utf8'));
  assert.deepEqual(Object.keys(record.spaces).sort(), [S.bugs, S.other].sort());
  assert.equal(record.spaces[S.bugs].repo, REPO);
});

await stop();
lk.close();
gh.server.close();
console.log(`check-issues: OK (${n} groups)`);
