#!/usr/bin/env node
/*
 * issues-to-plan.mjs -- a STOPGAP until the issues pull (step 1 of documentation/plans/plan-github-pull.md) lands, and thrown
 * away when it does. It reads a repository's issues through GitHub's REST API and writes a Planner - Projects plan file
 * (modules/schedule/src/FORMAT.md, format "project-plan") that a person loads with Import > Replace the plan.
 *
 *   node tools/issues-to-plan.mjs [--repo owner/name] [--out file] [--dry-run]
 *
 *   --repo     default Drowbe/coffee-pub-chameleon
 *   --out      the file to write (default project-plan-issues.json); nothing is written with --dry-run
 *   --dry-run  asks GitHub, writes no file, prints the count in each column
 *
 * What each issue becomes: one piece of work, id gh-<number>, title "#<number> <issue title>" (cut to 120 characters), start the
 * day it was made (UTC), end the day it closed or the start day while open, notes holding only the issue's link, tags from the
 * labels that are not priority labels. Column: closed is done; `priority: now`, `priority: next` or `priority: later` is that
 * column; any other open issue is inbox. Pull requests are skipped; the body, comments, assignees and authors are never read in.
 * The file carries the Inbox, Now, Next, Later, Done board (only done counts as done).
 *
 * Limits of the file (read from the module's parser): at most 500 entries (open issues first, then the most recently closed),
 * tags are ids in the space's Tags setting, which holds at most 20 (the 20 most used labels are tagged; the rest are left off).
 * What was cut or left off is said on the error output. The tag rows themselves (id and label) are printed there too, for the
 * space's Tags setting, which a file cannot carry.
 *
 * Network: one request at a time, 100 issues a page, a User-Agent naming the product and the repository, ISSUES_GITHUB_TOKEN
 * (optional, never printed) in the Authorization header to api.github.com only. 403 or 429 waits for retry-after or
 * x-ratelimit-reset when that is short, else stops. Conditional requests (etag) are not used: one run is one pass.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

export const DEFAULT_REPO = 'Drowbe/coffee-pub-chameleon';
const API = 'https://api.github.com';
const PER_PAGE = 100;
const MAX_ENTRIES = 500; // the file format's limit
const MAX_TAGS = 20; // the Tags setting's limit
const TITLE_MAX = 120;
const MAX_WAIT_S = 120;
const MAX_PAGES = 100;
const PRIORITY = { 'priority: now': 'now', 'priority: next': 'next', 'priority: later': 'later' };
export const BOARD = {
  id: 'main', name: 'Board', field: 'column',
  columns: [{ id: 'inbox', label: 'Inbox' }, { id: 'now', label: 'Now' }, { id: 'next', label: 'Next' }, { id: 'later', label: 'Later' }, { id: 'done', label: 'Done', done: true }],
};

const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));

// Reads every issue of the repository, one request at a time. Answers the raw issue objects (pull requests already skipped).
// `o`: { token, fetchImpl, sleep, userAgent }.
export async function fetchIssues(repo, o = {}) {
  if (!REPO_RE.test(repo)) throw new Error('The repository must be written owner/name.');
  const doFetch = o.fetchImpl || fetch;
  const sleep = o.sleep || sleepReal;
  const ua = o.userAgent || require('../server/product-name').userAgent({ contact: require('../server/product-name').REPOSITORY_URL });
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${API}/repos/${repo}/issues?state=all&per_page=${PER_PAGE}&page=${page}&sort=created&direction=asc`;
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': ua, 'X-GitHub-Api-Version': '2022-11-28' };
    if (o.token) headers.Authorization = `Bearer ${o.token}`;
    let res;
    for (let attempt = 0; ; attempt += 1) {
      res = await doFetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (res.status !== 403 && res.status !== 429) break;
      const wait = waitSeconds(res);
      if (wait === null || wait > MAX_WAIT_S || attempt >= 2) throw new Error('GitHub says to slow down; try again later, or set ISSUES_GITHUB_TOKEN.');
      await sleep(wait * 1000);
    }
    if (res.status === 404) throw new Error('No such repository, or it is private.');
    if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
    const list = await res.json();
    if (!Array.isArray(list)) throw new Error('GitHub answered something that is not a list of issues.');
    for (const x of list) if (x && typeof x === 'object' && !x.pull_request) out.push(x);
    if (list.length < PER_PAGE) return out;
  }
  throw new Error('The repository has more issues than this stopgap reads.');
}

// Seconds to wait before asking again, from retry-after or x-ratelimit-reset; null when the answer says neither.
function waitSeconds(res) {
  const h = (n) => (res.headers && typeof res.headers.get === 'function' ? res.headers.get(n) : null);
  const ra = Number(h('retry-after'));
  if (h('retry-after') !== null && Number.isFinite(ra) && ra >= 0) return ra;
  const reset = Number(h('x-ratelimit-reset'));
  if (h('x-ratelimit-remaining') === '0' && Number.isFinite(reset) && reset > 0) return Math.max(0, reset - Math.floor(Date.now() / 1000)) + 1;
  return null;
}

const day = (iso) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : '');
export function columnOf(issue) {
  if (issue.state === 'closed') return 'done';
  for (const l of Array.isArray(issue.labels) ? issue.labels : []) {
    const name = String(typeof l === 'string' ? l : (l && l.name) || '').toLowerCase();
    if (PRIORITY[name]) return PRIORITY[name];
  }
  return 'inbox';
}
export function tagId(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}
const labelNames = (issue) => (Array.isArray(issue.labels) ? issue.labels : []).map((l) => (typeof l === 'string' ? l : l && l.name)).filter((n) => typeof n === 'string' && n.trim() && !PRIORITY[n.toLowerCase()] && !/^priority\s*:/i.test(n));

// The plan file from the issues. Answers { file, counts: { inbox, now, next, later, done }, tags: [{ id, label }], notes: [sentences] }.
export function buildPlan(issues, o = {}) {
  const notes = [];
  const rows = issues
    .filter((x) => x && !x.pull_request && Number.isInteger(x.number) && day(x.created_at))
    .sort((a, b) => a.number - b.number);
  // At most 500 entries: every open issue, then the most recently closed.
  let keep = rows;
  if (rows.length > MAX_ENTRIES) {
    const open = rows.filter((x) => x.state !== 'closed');
    const closed = rows.filter((x) => x.state === 'closed').sort((a, b) => String(b.closed_at).localeCompare(String(a.closed_at)));
    const spare = Math.max(0, MAX_ENTRIES - open.length);
    const keepSet = new Set([...open, ...closed.slice(0, spare)].slice(0, MAX_ENTRIES));
    keep = rows.filter((x) => keepSet.has(x));
    notes.push(`The repository has ${rows.length} issues and a file holds ${MAX_ENTRIES}: ${rows.length - keep.length} of the oldest closed issues were left out.`);
  }
  // Tags: the labels used most, up to the Tags setting's 20.
  const use = new Map();
  for (const x of keep) for (const n of labelNames(x)) { const id = tagId(n); if (id) { const t = use.get(id) || { id, label: n, n: 0 }; t.n += 1; use.set(id, t); } }
  const ranked = [...use.values()].sort((a, b) => b.n - a.n || a.id.localeCompare(b.id));
  const tags = ranked.slice(0, MAX_TAGS).map(({ id, label }) => ({ id, label }));
  if (ranked.length > MAX_TAGS) notes.push(`The repository has ${ranked.length} labels besides priority; the ${MAX_TAGS} most used are tags and ${ranked.slice(MAX_TAGS).map((t) => t.label).join(', ')} are left off.`);
  const tagSet = new Set(tags.map((t) => t.id));
  const counts = { inbox: 0, now: 0, next: 0, later: 0, done: 0 };
  const entries = keep.map((x) => {
    const column = columnOf(x);
    counts[column] += 1;
    const start = day(x.created_at);
    const end = column === 'done' && day(x.closed_at) && day(x.closed_at) >= start ? day(x.closed_at) : start;
    let title = `#${x.number} ${String(x.title || '').replace(/\s+/g, ' ').trim()}`.trim();
    if (title.length > TITLE_MAX) title = `${title.slice(0, TITLE_MAX - 1).trimEnd()}…`;
    const e = { id: `gh-${x.number}`, kind: 'work', title, start, end, column, done: column === 'done' };
    const t = [...new Set(labelNames(x).map(tagId))].filter((id) => tagSet.has(id));
    if (t.length) e.tags = t;
    if (typeof x.html_url === 'string' && /^https:\/\/github\.com\//.test(x.html_url)) e.notes = x.html_url;
    return e;
  });
  return { file: { format: 'project-plan', version: 1, entries, boards: [BOARD] }, counts, tags, notes };
}

function parseArgs(argv) {
  const a = { repo: DEFAULT_REPO, out: 'project-plan-issues.json', dry: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dry-run') a.dry = true;
    else if (argv[i] === '--repo' && argv[i + 1]) a.repo = argv[++i];
    else if (argv[i] === '--out' && argv[i + 1]) a.out = argv[++i];
    else throw new Error('Use: node tools/issues-to-plan.mjs [--repo owner/name] [--out file] [--dry-run]');
  }
  return a;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const issues = await fetchIssues(a.repo, { token: process.env.ISSUES_GITHUB_TOKEN || '' });
  const plan = buildPlan(issues);
  const c = plan.counts;
  for (const n of plan.notes) console.error(n);
  console.log(`${a.repo}: ${plan.file.entries.length} issues. Inbox ${c.inbox}, Now ${c.now}, Next ${c.next}, Later ${c.later}, Done ${c.done}.`);
  if (plan.tags.length) console.error(`Tags for the space's Tags setting: ${plan.tags.map((t) => `${t.id} (${t.label})`).join(', ')}`);
  if (a.dry) return;
  if (!plan.file.entries.length) throw new Error('There are no issues to write.');
  fs.writeFileSync(a.out, `${JSON.stringify(plan.file, null, 2)}\n`);
  console.log(`Wrote ${a.out}. In Planner - Projects, open Export and import, Import, choose it, then Replace the plan.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
