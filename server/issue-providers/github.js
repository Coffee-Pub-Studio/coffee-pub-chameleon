// GitHub's REST API, the issues of one repository (GET /repos/{owner}/{repo}/issues), read only
// (documentation/plans/plan-github-pull.md).
//
// THE RULE (server/issue-providers/index.js): a registered adapter is for a service that costs nothing and allows commercial use.
// Terms read on 2026-11-26 by the planner, at docs.github.com:
//   - GitHub Terms of Service (effective 2026-04-27), section H, API Terms: https://docs.github.com/en/site-policy/github-terms/github-terms-of-service
//     Using the API means agreeing to the Terms and section H. No sharing of tokens to get past the limits; nothing collected
//     for spam or sold. The API costs nothing and nothing forbids commercial use within its limits.
//   - Acceptable Use Policies, sections 7 and 8: personal information collected through the API is used only for what the user
//     authorized. So no login, assignee, author, body or comment is ever read into a record: only what the board needs.
//   - Rate limits: 60 requests an hour without a token, 5,000 with one; a 403 or 429 when over, with retry-after or
//     x-ratelimit-reset to obey; x-poll-interval to honour; conditional requests (an etag sent back as if-none-match: a 304
//     on an authorized request does not count); one request at a time; a User-Agent naming the application.
//   - The issues list returns pull requests too (a `pull_request` key): they are skipped.
// The token, when the server has one (ISSUES_GITHUB_TOKEN), goes only in the Authorization header to this adapter's own origin.
'use strict';

const { userAgent } = require('../product-name');

const ORIGIN = 'https://api.github.com';
const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const PER_PAGE = 100;

// "owner/name" from what a person typed or pasted: owner/name itself, a github.com address (https, or none; with or without www.,
// a trailing slash, .git, or a deeper path, query or hash such as /issues/12 or /tree/main: the first two segments count), or
// git@github.com:owner/name.git. '' for anything else, including any other host and plain http.
const ADDRESS = /^(?:https:\/\/)?(?:www\.)?github\.com\//i;
function repoFrom(raw) {
  const t = typeof raw === 'string' ? raw.trim() : '';
  if (!t || t.length > 300) return '';
  let path = t;
  let address = false;
  const ssh = /^git@github\.com:(.+)$/i.exec(t);
  if (ssh) { path = ssh[1]; address = true; }
  else if (ADDRESS.test(t)) { path = t.replace(ADDRESS, ''); address = true; }
  else if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(t) || /^(?:www\.)?github\.com$/i.test(t)) return '';
  const parts = path.split(/[?#]/)[0].split('/');
  if (!address && parts.length !== 2) return '';
  const [owner, rest] = parts;
  if (!owner || !rest) return '';
  const repo = `${owner}/${rest.replace(/\.git$/i, '')}`;
  return REPO.test(repo) && !/\/\.{1,2}$/.test(repo) ? repo : '';
}

const text = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n) : '');
const stamp = (v) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : '');
const day = (v) => stamp(v).slice(0, 10);

// One issue as the neutral record (server/issue-providers/index.js), or null for a pull request or anything that is not an issue.
function record(raw) {
  if (!raw || typeof raw !== 'object' || raw.pull_request) return null;
  const number = Number(raw.number);
  if (!Number.isInteger(number) || number < 1) return null;
  const url = typeof raw.html_url === 'string' && /^https:\/\/github\.com\//.test(raw.html_url) ? raw.html_url.slice(0, 300) : '';
  const created = stamp(raw.created_at);
  if (!created) return null;
  const labels = (Array.isArray(raw.labels) ? raw.labels : []).slice(0, 50).map((l) => {
    const name = text(typeof l === 'string' ? l : l && l.name, 50);
    const color = l && typeof l.color === 'string' && /^[0-9a-fA-F]{6}$/.test(l.color) ? l.color.toLowerCase() : '';
    return name ? { name, color } : null;
  }).filter(Boolean);
  const m = raw.milestone && typeof raw.milestone === 'object' && Number.isInteger(raw.milestone.number) ? raw.milestone : null;
  const out = {
    number,
    title: text(raw.title, 400),
    open: raw.state !== 'closed',
    labels,
    url,
    created,
    updated: stamp(raw.updated_at) || created,
  };
  if (!out.open) out.closed = stamp(raw.closed_at) || out.updated;
  if (m) out.milestone = { number: m.number, title: text(m.title, 120), due: day(m.due_on), open: m.state !== 'closed' };
  return out;
}

// The next page's address from a Link header, only when it is on `origin`; else null.
function nextPage(link, origin) {
  const m = /<([^>]+)>\s*;\s*rel="next"/.exec(typeof link === 'string' ? link : '');
  if (!m) return null;
  try {
    const u = new URL(m[1]);
    return u.origin === origin ? u.href : null;
  } catch { return null; }
}

// What an answer says about waiting: seconds from retry-after, the reset time when the limit is spent, and x-poll-interval.
function waitOf(header) {
  const n = (v) => { if (v === null || v === undefined || v === '') return null; const x = Number(v); return Number.isFinite(x) && x >= 0 ? x : null; };
  const retryAfter = n(header('retry-after'));
  const remaining = header('x-ratelimit-remaining');
  const reset = n(header('x-ratelimit-reset'));
  const poll = n(header('x-poll-interval'));
  return {
    ...(retryAfter !== null ? { retryAfterMs: retryAfter * 1000 } : {}),
    ...(remaining === '0' && reset !== null ? { resetAt: reset * 1000 } : {}),
    ...(poll !== null ? { pollMs: poll * 1000 } : {}),
  };
}

// An adapter for GitHub's REST shape at `origin` (the stand-in reuses it with its own).
function makeAdapter({ id, name, origin, terms, allowHttp = false, pollMs, fullEveryMs }) {
  return {
    id,
    name,
    terms,
    origin,
    allowHttp,
    needsToken: false,
    tokenEnv: 'ISSUES_GITHUB_TOKEN', // the environment variable the server reads the token from; optional for a public repository
    pollMs,
    fullEveryMs,
    repoFrom,
    validRepo: (repo) => typeof repo === 'string' && REPO.test(repo) && !/\/\.{1,2}$/.test(repo),
    // One page of the list. `page`: the address `more` gave, or null for the first. `etag` is sent only on the first page.
    // `get(url, headers)` is the core's (server/issues.js): it asks only this adapter's origin, caps the answer and the time,
    // and answers { status, header(name), json }.
    async list({ repo, since = '', etag = '', token = '', page = null }, get) {
      let url = page;
      if (!url) {
        const u = new URL(`${origin}/repos/${repo}/issues`);
        u.searchParams.set('state', 'all');
        u.searchParams.set('per_page', String(PER_PAGE));
        u.searchParams.set('sort', 'updated');
        u.searchParams.set('direction', 'asc');
        if (since) u.searchParams.set('since', since);
        url = u.href;
      }
      const headers = { Accept: 'application/vnd.github+json', 'User-Agent': userAgent(), 'X-GitHub-Api-Version': '2022-11-28' };
      if (token) headers.Authorization = `Bearer ${token}`;
      if (etag && !page) headers['If-None-Match'] = etag;
      const got = await get(url, headers);
      const wait = waitOf(got.header);
      const tag = text(got.header('etag'), 200);
      if (got.status === 304) return { status: 304, etag: tag || etag, records: [], more: null, wait };
      if (got.status !== 200) return { status: got.status, etag: '', records: [], more: null, wait };
      if (!Array.isArray(got.json)) return { status: 0, etag: '', records: [], more: null, wait, bad: true };
      const records = got.json.map((r) => record(r)).filter(Boolean);
      return { status: 200, etag: tag, records, more: nextPage(got.header('link'), origin), wait };
    },
  };
}

module.exports = makeAdapter({
  id: 'github',
  name: 'GitHub',
  origin: ORIGIN,
  terms: 'https://docs.github.com/en/site-policy/github-terms/github-terms-of-service',
  pollMs: 10 * 60 * 1000,
  fullEveryMs: 24 * 3600 * 1000,
});
module.exports.makeAdapter = makeAdapter;
module.exports.record = record;
module.exports.repoFrom = repoFrom;
module.exports.nextPage = nextPage;
module.exports.waitOf = waitOf;
