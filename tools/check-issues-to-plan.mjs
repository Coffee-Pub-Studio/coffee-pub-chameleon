#!/usr/bin/env node
/*
 * check-issues-to-plan.mjs -- tools/issues-to-plan.mjs against a small fixture of issues (tools/fixtures/issues-to-plan), no network.
 *   - the file it writes is read by Planner - Projects' own parser (modules/schedule/src/schedule-lib-file.js) with no refusal;
 *   - columns: closed is done, the three priority labels give now, next and later, any other open issue is inbox; pull requests
 *     are skipped; the board is Inbox, Now, Next, Later, Done with only done counting as done;
 *   - title "#<n> <title>" within 120 characters, start the day it was made, end the day it closed (the start while open),
 *     notes only the link, no body, login or comment in the file;
 *   - more labels than the Tags setting holds: the 20 most used are tags and the rest are named;
 *   - more issues than a file holds: every open issue stays, the oldest closed are left out, and it still parses;
 *   - the reader asks one page at a time with a User-Agent, sends the token only when given, skips pull requests, waits for
 *     retry-after, stops when the wait is long, and never puts the token in an error.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { buildPlan, fetchIssues } from './issues-to-plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => fs.readFileSync(path.join(ROOT, 'modules/schedule/src', f), 'utf8');
const L = new Function(`${src('schedule-lib.js')}\n${src('schedule-lib-file.js')}\nreturn { scParseFile };`)();
const issues = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/fixtures/issues-to-plan/issues.json'), 'utf8'));
const parse = (file) => L.scParseFile(JSON.stringify(file), { label: (k) => k, datesRequired: true });

let passed = 0;
const fails = [];
async function test(name, fn) { try { await fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }

const plan = buildPlan(issues);
const by = Object.fromEntries(plan.file.entries.map((e) => [e.id, e]));

await test('the file is read by the module\'s parser with no refusal', () => {
  const r = parse(plan.file);
  assert.equal(r.problem, undefined);
  assert.equal(r.entries.length, plan.file.entries.length);
  assert.equal(r.boards.length, 1);
});
await test('columns', () => {
  assert.equal(by['gh-1'].column, 'now');
  assert.equal(by['gh-2'].column, 'next');
  assert.equal(by['gh-3'].column, 'later');
  assert.equal(by['gh-4'].column, 'inbox');
  assert.equal(by['gh-5'].column, 'done');
  assert.equal(by['gh-5'].done, true);
  assert.equal(by['gh-1'].done, false);
  assert.deepEqual(plan.counts, { inbox: 3, now: 1, next: 1, later: 1, done: 2 });
  assert.equal(plan.counts.inbox + plan.counts.now + plan.counts.next + plan.counts.later + plan.counts.done, plan.file.entries.length);
});
await test('pull requests are skipped', () => assert.equal(by['gh-6'], undefined));
await test('the board', () => {
  const b = plan.file.boards[0];
  assert.deepEqual(b.columns.map((c) => c.id), ['inbox', 'now', 'next', 'later', 'done']);
  assert.deepEqual(b.columns.filter((c) => c.done).map((c) => c.id), ['done']);
});
await test('title, days and notes', () => {
  assert.equal(by['gh-1'].title, '#1 Area: issue 1');
  assert.ok(by['gh-7'].title.length <= 120 && by['gh-7'].title.endsWith('…'));
  assert.equal(by['gh-5'].start, '2026-10-06');
  assert.equal(by['gh-5'].end, '2026-10-20');
  assert.equal(by['gh-1'].end, by['gh-1'].start);
  assert.equal(by['gh-9'].end, by['gh-9'].start);
  assert.equal(by['gh-1'].notes, 'https://github.com/Drowbe/coffee-pub-chameleon/issues/1');
});
await test('nothing personal or of the body is in the file', () => {
  const text = JSON.stringify(plan.file);
  assert.ok(!text.includes('SECRET BODY') && !text.includes('someone'));
});
await test('tags come from non-priority labels, within 20', () => {
  assert.deepEqual(by['gh-1'].tags, ['bug']);
  assert.deepEqual(by['gh-5'].tags, ['good-first-issue']);
  assert.ok(!by['gh-3'].tags);
  assert.ok(plan.tags.length <= 20 && plan.tags.length > 0);
  assert.ok(plan.notes.some((n) => /left off/.test(n)), 'the labels left off are named');
  const set = new Set(plan.tags.map((t) => t.id));
  for (const e of plan.file.entries) for (const t of e.tags || []) assert.ok(set.has(t));
});
await test('more issues than a file holds: open stay, oldest closed go, and it parses', () => {
  const many = [];
  for (let n = 1; n <= 700; n += 1) many.push({ number: n, title: `Area: t${n}`, state: n % 2 ? 'open' : 'closed', created_at: '2026-01-01T00:00:00Z', closed_at: n % 2 ? null : `2026-02-${String(1 + (n % 27)).padStart(2, '0')}T00:00:00Z`, html_url: `https://github.com/o/r/issues/${n}`, labels: [] });
  const p = buildPlan(many);
  assert.equal(p.file.entries.length, 500);
  assert.equal(p.file.entries.filter((e) => e.column !== 'done').length, 350);
  assert.ok(p.notes.some((n) => /left out/.test(n)));
  assert.equal(parse(p.file).problem, undefined);
});

const page = (n, from) => Array.from({ length: n }, (_, i) => ({ number: from + i, title: 't', state: 'open', created_at: '2026-01-01T00:00:00Z', labels: [] }));
const res = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body });
await test('the reader pages one at a time, sends the agent, skips pull requests', async () => {
  const calls = [];
  let busy = 0;
  const fetchImpl = async (url, init) => {
    busy += 1; assert.equal(busy, 1, 'one request at a time');
    calls.push({ url, init }); await new Promise((r) => setImmediate(r)); busy -= 1;
    const p = Number(new URL(url).searchParams.get('page'));
    return res(200, p === 1 ? [...page(99, 1), { number: 100, pull_request: {} }] : page(3, 200));
  };
  const got = await fetchIssues('o/r', { fetchImpl, userAgent: 'Chameleon/1 (+https://example.test)' });
  assert.equal(got.length, 102);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => c.url.startsWith('https://api.github.com/repos/o/r/issues?') && c.url.includes('per_page=100') && c.url.includes('state=all')));
  assert.ok(calls.every((c) => /Chameleon/.test(c.init.headers['User-Agent']) && !c.init.headers.Authorization));
});
await test('the token goes in the header only, and never into an error', async () => {
  let seen;
  await fetchIssues('o/r', { token: 'tok-SECRET', fetchImpl: async (u, init) => { seen = init.headers.Authorization; return res(200, []); } });
  assert.equal(seen, 'Bearer tok-SECRET');
  await assert.rejects(fetchIssues('o/r', { token: 'tok-SECRET', fetchImpl: async () => res(500, {}) }), (e) => !e.message.includes('tok-SECRET'));
  await assert.rejects(fetchIssues('o/r', { fetchImpl: async () => res(404, {}) }), /No such repository, or it is private\./);
  await assert.rejects(fetchIssues('not a repo'), /owner\/name/);
});
await test('retry-after is waited for; a long wait stops', async () => {
  let n = 0; const slept = [];
  const got = await fetchIssues('o/r', { sleep: async (ms) => slept.push(ms), fetchImpl: async () => { n += 1; return n === 1 ? res(429, {}, { 'retry-after': '7' }) : res(200, []); } });
  assert.deepEqual(got, []);
  assert.deepEqual(slept, [7000]);
  const reset = String(Math.floor(Date.now() / 1000) + 5000);
  await assert.rejects(fetchIssues('o/r', { sleep: async () => { throw new Error('slept'); }, fetchImpl: async () => res(403, {}, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }) }), /slow down/);
});

if (fails.length) { console.error(`check-issues-to-plan: ${fails.length} failed\n  ${fails.join('\n  ')}`); process.exit(1); }
console.log(`check-issues-to-plan: ${passed} cases passed`);
