// GitHub's REST API, the issues of one repository: read (GET /repos/{owner}/{repo}/issues, documentation/plans/plan-github-pull.md)
// and, only when a space has writing on (documentation/plans/plan-github-two-way.md, step 1), the few calls that change one:
// PATCH an issue's title and state, POST and DELETE its labels, GET a label (to see it exists, since adding a label GitHub
// does not have would make it), and POST a new issue. Re-read on 2026-11-26 at docs.github.com ("Update an issue", "Create an
// issue", "Add labels to an issue", "Remove a label from an issue", "Get a label", "Rate limits for the REST API"): the token
// needs "Issues" repository permission (write); an update, a label call and a create answer 200 or 201 with JSON, 404 for an
// issue or label that is not there, 410 when issues are off, 422 for a refusal ("Validation failed, or the endpoint has been
// spammed"), 403 or 429 for a limit (retry-after, else x-ratelimit-reset when remaining is 0, else wait a minute); a label or
// assignee change from a token without push access is silently dropped, so the answer is read again after a write; no more
// than 80 content-generating requests a minute and 500 an hour, 900 points a minute for one endpoint (a write costs 5, a read 1),
// and at least a second between two requests that create, update or delete.
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
// What a write may carry is fixed here: a title, a state and its reason, a label's name, and for a new issue its title and
// labels. Never a body, an assignee, a milestone or anything of the space or the person.
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

// What a write's answer says: { status, wait, limited, message, record? }. `limited`: the answer is a limit (429, a wait named, or
// a message that says so), as opposed to a refusal of this token or this change; `message` GitHub's own sentence, on one line.
const LIMIT_WORDS = /rate limit|abuse|secondary|too many requests/i;
function answerOf(got, withRecord) {
  const wait = waitOf(got.header);
  const message = text(got.json && typeof got.json === 'object' && !Array.isArray(got.json) ? got.json.message : '', 150).replace(/[.\s]+$/, '');
  const limited = got.status === 429 || ((got.status === 403) && (wait.retryAfterMs !== undefined || wait.resetAt !== undefined || LIMIT_WORDS.test(message)));
  const out = { status: got.status, wait, limited, message };
  if (withRecord && (got.status === 200 || got.status === 201)) {
    const r = record(got.json);
    if (r) out.record = r; else out.bad = true;
  }
  return out;
}
const writeHeaders = (token) => {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': userAgent(), 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
};
const issuePath = (origin, repo, number) => `${origin}/repos/${repo}/issues/${Number(number)}`;
const labelOk = (n) => typeof n === 'string' && n.length >= 1 && n.length <= 50 && !/[\u0000-\u001f\u007f]/.test(n);

// An adapter for GitHub's REST shape at `origin` (the stand-in reuses it with its own).
function makeAdapter({ id, name, origin, terms, allowHttp = false, pollMs, fullEveryMs, writeGapMs = 1000 }) {
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
    writeGapMs, // the least time between two requests that create, update or delete
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

    // The writes (plan-github-two-way.md, section 13). `ask(method, url, headers, body)` is the core's: this origin only, 6 seconds,
    // 2 MB, no redirect followed for a write. Each answers { status, wait, limited, message, record? }.

    // One issue, as the record. `etag` makes it conditional: a 304 answers { status: 304 } and costs nothing.
    async get({ repo, number, etag = '', token = '' }, ask) {
      const headers = writeHeaders(token);
      if (etag) headers['If-None-Match'] = etag;
      const got = await ask('GET', issuePath(origin, repo, number), headers);
      const out = answerOf(got, true);
      out.etag = text(got.header('etag'), 200);
      if (got.status === 304) out.etag = out.etag || etag;
      return out;
    },
    // The title and the state (with its reason) of one issue; nothing else can be sent.
    async update({ repo, number, title, state, stateReason, token = '' }, ask) {
      const body = {};
      if (typeof title === 'string' && title) body.title = title.slice(0, 256);
      if (state === 'open' || state === 'closed') body.state = state;
      if (body.state && ['completed', 'reopened', 'not_planned'].includes(stateReason)) body.state_reason = stateReason;
      return answerOf(await ask('PATCH', issuePath(origin, repo, number), writeHeaders(token), body), true);
    },
    // Labels to add to one issue (never a replacement of its set).
    async addLabels({ repo, number, labels, token = '' }, ask) {
      const names = (Array.isArray(labels) ? labels : []).filter(labelOk).slice(0, 10);
      if (!names.length) return { status: 0, wait: {}, limited: false, message: '' };
      return answerOf(await ask('POST', `${issuePath(origin, repo, number)}/labels`, writeHeaders(token), { labels: names }), false);
    },
    // One label off one issue. A 404 means it is not on the issue (or not in the repository): nothing to remove.
    async removeLabel({ repo, number, label, token = '' }, ask) {
      if (!labelOk(label)) return { status: 0, wait: {}, limited: false, message: '' };
      return answerOf(await ask('DELETE', `${issuePath(origin, repo, number)}/labels/${encodeURIComponent(label)}`, writeHeaders(token)), false);
    },
    // Whether the repository has a label of this name: 200, or 404 when it has not.
    async hasLabel({ repo, label, token = '' }, ask) {
      if (!labelOk(label)) return { status: 404, wait: {}, limited: false, message: '' };
      return answerOf(await ask('GET', `${origin}/repos/${repo}/labels/${encodeURIComponent(label)}`, writeHeaders(token)), false);
    },
    // A new issue: its title and its labels, an empty body. Answers the record.
    async create({ repo, title, labels, token = '' }, ask) {
      const body = { title: String(title || '').slice(0, 256) };
      const names = (Array.isArray(labels) ? labels : []).filter(labelOk).slice(0, 5);
      if (names.length) body.labels = names;
      return answerOf(await ask('POST', `${origin}/repos/${repo}/issues`, writeHeaders(token), body), true);
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
