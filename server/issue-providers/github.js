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
//     authorized. What is read into a record (plan-github-full-sync.md, decisions 1, 2 and 5): the issue's text (its body) as plain
//     text, its assignees as GitHub's account id and login (at most 10, GitHub's own limit; shown to everyone who sees the plan, for
//     the purpose of showing who is assigned), and how many comments it has. Never an author, an e-mail address, a picture, a
//     reaction or a comment's text in a record.
//   - Rate limits: 60 requests an hour without a token, 5,000 with one; a 403 or 429 when over, with retry-after or
//     x-ratelimit-reset to obey; x-poll-interval to honour; conditional requests (an etag sent back as if-none-match: a 304
//     on an authorized request does not count); one request at a time; a User-Agent naming the application.
//   - The issues list returns pull requests too (a `pull_request` key): they are skipped.
// A token (the repository's installation token, server/issue-app.js) goes only in the Authorization header to this adapter's own
// origin; the app's own two calls (GET /app, POST /app/installations/{id}/access_tokens) carry the app's JWT the same way.
// API version: 2022-11-28 is sent. Re-read on 2026-11-26 (docs.github.com, "API Versions", "Breaking changes"): 2026-03-10 is the
// newest; a request with no header gets 2022-11-28; 2022-11-28 is supported for 24 months after 2026-03-10. What 2026-03-10 changes
// that this adapter could meet is the removal of the singular `assignee` from an issue, which no record reads; nothing there is
// needed, so the header is left as it was.
// What a write may carry is fixed here (plan-github-full-sync.md, step 3): a title, a state and its reason, the body (the issue's
// text, as written), the milestone's number or none, a label's name, a comment's text, the logins of linked Owners to assign or
// unassign, and for a new issue its title, labels and body. Never anything of the space or the person: no name, no login a member
// did not link. Read, besides the issues: the repository's open milestones (GET .../milestones?state=open,
// one page of 100, conditional), to keep a milestone with no issue in the plan; an issue's newest 100 comments when the issue view
// opens (GET .../issues/{n}/comments, oldest first, each comment's id, author's id and login, times and text, nothing else); whether
// GitHub will assign a login (GET .../assignees/{login}); and, for a person who links their own GitHub
// account on Profile (plan-github-full-sync.md, section 4), GET /user with their user token, of which only the account's `id` and
// `login` are read (never a name, picture or e-mail address). Re-read on 2026-11-28 at docs.github.com ("Get the authenticated
// user": 200 with `login` and `id`, both required, 304, 401, 403; a token with no scopes still authenticates as its owner; "Delete
// an app token": DELETE /applications/{client_id}/token, Basic auth with the client id and secret and no bearer, `access_token` in
// the body, 204, 422; "Generating a user access token for a GitHub App": `state` must match or the flow is aborted, PKCE's
// `code_verifier` with the exchange).
// Re-read on 2026-11-28 at docs.github.com for step 3 ("REST API endpoints for issue comments", "... for assignees", "... for
// milestones", "Update an issue", "Permissions required for GitHub Apps", "Rate limits for the REST API"): an issue's comments are
// listed in ascending id order with no direction to ask (so the newest 100 are the last page or two, from the issue's count), at
// most 100 a page; create answers 201, edit 200 and delete 204; a comment's `body` is required; "Add assignees" takes up to 10
// logins and answers 201 with the issue, "Remove assignees" answers 200 with it, and both say assignees are "silently ignored"
// without push access; "Check if a user can be assigned" answers 204, else 404; "Update an issue" takes `body` (string or null) and
// `milestone` (a number, or null to remove it), silently dropped without push access; every one of these is under the app's
// "Issues" permission (read for the reads, write for the writes), so the app asks for nothing new. Not in those pages, so from the
// planner's memory and not confirmed: that a login GitHub cannot assign is dropped silently (rather than refused) when the caller may
// push, and the 65,536-character limit of a body or a comment.
'use strict';

const { userAgent } = require('../product-name');

const ORIGIN = 'https://api.github.com';
const WEB_ORIGIN = 'https://github.com';
const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const PER_PAGE = 100;
const STATES = Object.freeze(['all', 'open', 'closed']); // which issues a list asks for

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

// An issue's description as plain text (plan-github-pull.md, decision 1; plan-github-full-sync.md, section 1): only a string; line
// endings as \n; control characters other than newline and tab removed; trimmed. The whole text, at most BODY_MAX characters
// (GitHub's own limit, counted in characters, never inside a surrogate pair). Never markup: it is stored and drawn as text. The
// plan's shorter cut is server/issues.js's (workOf, DESCRIPTION_MAX).
const BODY_MAX = 65536;
function bodyText(v) {
  if (typeof v !== 'string') return '';
  const t = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
  if (t.length <= BODY_MAX) return t;
  return Array.from(t).slice(0, BODY_MAX).join('').trimEnd();
}

// A GitHub login as GitHub makes them (letters, digits and single dashes, at most 39), or a bot's (`name[bot]`); '' for anything else.
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/;
const USER_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/; // a person's own account, as GET /user names it
const ASSIGNEES_MAX = 10;
// An issue's assignees: [{ id, login }], each with GitHub's account id (matching is by id, plan-github-full-sync.md section 4), at
// most ASSIGNEES_MAX, each id once.
function assigneesOf(raw) {
  const out = [];
  for (const a of Array.isArray(raw) ? raw : []) {
    if (out.length >= ASSIGNEES_MAX) break;
    if (!a || typeof a !== 'object' || !Number.isSafeInteger(a.id) || a.id < 1 || typeof a.login !== 'string' || !LOGIN.test(a.login)) continue;
    if (!out.some((x) => x.id === a.id)) out.push({ id: a.id, login: a.login });
  }
  return out;
}

// One milestone as the record's `milestone` and the milestones list name it: { number, title, due, open }, or null.
function milestoneOf(m) {
  if (!m || typeof m !== 'object' || !Number.isInteger(m.number) || m.number < 1) return null;
  return { number: m.number, title: text(m.title, 120), due: day(m.due_on), open: m.state !== 'closed' };
}

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
  const m = milestoneOf(raw.milestone);
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
  if (m) out.milestone = m;
  const body = bodyText(raw.body);
  if (body) out.body = body;
  out.assignees = assigneesOf(raw.assignees);
  out.comments = Number.isSafeInteger(raw.comments) && raw.comments >= 0 ? raw.comments : 0;
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

// --- comments and assignees (plan-github-full-sync.md, sections 2 and 3) ---
const COMMENTS_SHOWN = 100; // the newest this many are read when the issue view opens
// One comment as the issue view reads it: { id, author: { id, login } | null, at, edited, text }, or null. `text` is plain text as
// bodyText makes it (never markup); `author` GitHub's account id and login only (null for a deleted account); `edited` whether it
// was changed after it was written. Nothing else of it (no picture, no e-mail address, no reactions).
function commentOf(raw) {
  if (!raw || typeof raw !== 'object' || !Number.isSafeInteger(raw.id) || raw.id < 1) return null;
  const u = raw.user && typeof raw.user === 'object' ? raw.user : null;
  const author = u && Number.isSafeInteger(u.id) && u.id > 0 && typeof u.login === 'string' && LOGIN.test(u.login) ? { id: u.id, login: u.login } : null;
  const at = stamp(raw.created_at);
  const changed = stamp(raw.updated_at);
  return { id: raw.id, author, at, edited: Boolean(at && changed && changed > at), text: bodyText(raw.body) };
}
// A comment's text may be sent: a string with something in it, at most BODY_MAX characters.
const commentTextOk = (v) => typeof v === 'string' && v.trim().length > 0 && Array.from(v).length <= BODY_MAX;
// The answer to a comment's create or edit, with the comment read from it (`bad` when the answer is not one).
function withComment(got) {
  const out = answerOf(got, false);
  if (got.status === 200 || got.status === 201) {
    const c = commentOf(got.json);
    if (c) out.comment = c; else out.bad = true;
  }
  return out;
}
// Logins to send as assignees: each a person's login, once, at most ASSIGNEES_MAX.
const loginsOf = (v) => [...new Set((Array.isArray(v) ? v : []).filter((l) => typeof l === 'string' && USER_LOGIN.test(l)))].slice(0, ASSIGNEES_MAX);
const labelOk = (n) => typeof n === 'string' && n.length >= 1 && n.length <= 50 && !/[\u0000-\u001f\u007f]/.test(n);

// An adapter for GitHub's REST shape at `origin` (the stand-in reuses it with its own).
function makeAdapter({ id, name, origin, webOrigin = WEB_ORIGIN, terms, allowHttp = false, pollMs, fullEveryMs, writeGapMs = 1000 }) {
  return {
    id,
    name,
    terms,
    origin,
    webOrigin, // where a person signs in and installs (github.com); the core may POST only the code exchange there (server/issues.js, getter)
    allowHttp,
    needsToken: false,
    pollMs,
    fullEveryMs,
    writeGapMs, // the least time between two requests that create, update or delete
    repoFrom,
    validRepo: (repo) => typeof repo === 'string' && REPO.test(repo) && !/\/\.{1,2}$/.test(repo),
    // One page of the list. `page`: the address `more` gave, or null for the first. `etag` is sent only on the first page.
    // `state`: 'all' (the default), 'open' or 'closed'; anything else is 'all'. `get(url, headers)` is the core's
    // (server/issues.js): it asks only this adapter's origin, caps the answer and the time, and answers { status, header(name), json }.
    async list({ repo, since = '', etag = '', token = '', page = null, state = 'all' }, get) {
      let url = page;
      if (!url) {
        const u = new URL(`${origin}/repos/${repo}/issues`);
        u.searchParams.set('state', STATES.includes(state) ? state : 'all');
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

    // The service's own list of the issues closed before `from` (a YYYY-MM-DD day), as an address a person can open
    // (plan-done-window.md, "The link"): {webOrigin}/<owner>/<name>/issues?q=is:issue is:closed closed:<<from>. Only on the web
    // origin, never the API's; '' for a repository or a day that is not one. Asks nothing.
    closedBefore(repo, from) {
      if (typeof repo !== 'string' || !REPO.test(repo) || /\/\.{1,2}$/.test(repo)) return '';
      if (typeof from !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return '';
      const at = Date.parse(`${from}T00:00:00Z`);
      if (!Number.isFinite(at) || new Date(at).toISOString().slice(0, 10) !== from) return '';
      let u;
      try { u = new URL(`/${repo}/issues`, webOrigin); } catch { return ''; }
      if (u.origin !== new URL(webOrigin).origin || u.pathname !== `/${repo}/issues`) return '';
      u.searchParams.set('q', `is:issue is:closed closed:<${from}`);
      return u.href;
    },

    // The repository's open milestones (plan-github-full-sync.md, section 5), one page of 100, in the order GitHub gives them;
    // `get` is the list's (a GET on this origin). `etag` makes it conditional: a 304 costs nothing with a token. Answers { status,
    // etag, milestones: [{ number, title, due, open }], wait, bad? }.
    async milestones({ repo, etag = '', token = '' }, get) {
      const u = new URL(`${origin}/repos/${repo}/milestones`);
      u.searchParams.set('state', 'open');
      u.searchParams.set('per_page', String(PER_PAGE));
      const headers = writeHeaders(token);
      if (etag) headers['If-None-Match'] = etag;
      const got = await get(u.href, headers);
      const wait = waitOf(got.header);
      const tag = text(got.header('etag'), 200);
      if (got.status === 304) return { status: 304, etag: tag || etag, milestones: [], wait };
      if (got.status !== 200) return { status: got.status, etag: '', milestones: [], wait };
      if (!Array.isArray(got.json)) return { status: 0, etag: '', milestones: [], wait, bad: true };
      return { status: 200, etag: tag, milestones: got.json.map(milestoneOf).filter((x) => x && x.open), wait };
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
    // The title, the state (with its reason), the body (the issue's text, a string; '' empties it) and the milestone (its number,
    // or null for none) of one issue; nothing else can be sent, and only what is named is.
    async update({ repo, number, title, state, stateReason, body: text, milestone, token = '' }, ask) {
      const body = {};
      if (typeof title === 'string' && title) body.title = title.slice(0, 256);
      if (state === 'open' || state === 'closed') body.state = state;
      if (body.state && ['completed', 'reopened', 'not_planned'].includes(stateReason)) body.state_reason = stateReason;
      if (typeof text === 'string' && Array.from(text).length <= BODY_MAX) body.body = text;
      if (milestone === null || (Number.isSafeInteger(milestone) && milestone > 0)) body.milestone = milestone;
      if (!Object.keys(body).length) return { status: 0, wait: {}, limited: false, message: '' };
      return answerOf(await ask('PATCH', issuePath(origin, repo, number), writeHeaders(token), body), true);
    },
    // An issue's newest comments (plan-github-full-sync.md, section 2): at most COMMENTS_SHOWN, oldest first. GitHub lists them by
    // ascending id with no way to ask the newest first, so `total` (the issue's own count of comments, from its record) says which
    // page is the last: one page when there are at most 100 (conditional on `etag`: a 304 costs nothing), else the last two pages,
    // asked unconditionally, and the newest 100 of them. Answers { status, etag, comments: [{ id, author: { id, login } | null, at,
    // edited, text }], total, wait, bad? }; `total` how many the issue has, as far as the pages tell.
    async comments({ repo, number, total = 0, etag = '', token = '' }, ask) {
      const count = Number.isSafeInteger(total) && total > 0 ? total : 0;
      const last = Math.max(1, Math.ceil(count / PER_PAGE));
      const pages = last > 1 ? [last - 1, last] : [1];
      const list = [];
      let tag = '';
      let out = null;
      for (const page of pages) {
        const headers = writeHeaders(token);
        if (etag && pages.length === 1) headers['If-None-Match'] = etag;
        const got = await ask('GET', `${issuePath(origin, repo, number)}/comments?per_page=${PER_PAGE}&page=${page}`, headers);
        out = answerOf(got, false);
        if (got.status === 304 && pages.length === 1) return { ...out, etag: text(got.header('etag'), 200) || etag, comments: [], total: count };
        if (got.status !== 200) return { ...out, etag: '', comments: [], total: count };
        if (!Array.isArray(got.json)) return { ...out, status: 0, etag: '', comments: [], total: count, bad: true };
        if (pages.length === 1) tag = text(got.header('etag'), 200);
        list.push(...got.json.map(commentOf).filter(Boolean));
      }
      const seen = new Set();
      const comments = list.filter((c) => (seen.has(c.id) ? false : seen.add(c.id))).sort((a, b) => a.id - b.id).slice(-COMMENTS_SHOWN);
      const shown = pages.length === 1 ? list.length : (last - 1) * PER_PAGE + list.length - PER_PAGE;
      return { ...out, status: 200, etag: tag, comments, total: Math.max(shown, comments.length) };
    },
    // A new comment on one issue: its text as written, nothing added (plan-github-full-sync.md, decision 7). Answers the comment.
    async addComment({ repo, number, text: words, token = '' }, ask) {
      if (!commentTextOk(words)) return { status: 0, wait: {}, limited: false, message: 'empty' };
      const got = await ask('POST', `${issuePath(origin, repo, number)}/comments`, writeHeaders(token), { body: words });
      return withComment(got);
    },
    // A comment's new text (by the comment's id, which GitHub keeps for the whole repository). Answers the comment.
    async editComment({ repo, id, text: words, token = '' }, ask) {
      if (!commentTextOk(words) || !Number.isSafeInteger(id) || id < 1) return { status: 0, wait: {}, limited: false, message: 'empty' };
      const got = await ask('PATCH', `${origin}/repos/${repo}/issues/comments/${id}`, writeHeaders(token), { body: words });
      return withComment(got);
    },
    // One comment off GitHub: 204 when done, 404 when it is not there.
    async deleteComment({ repo, id, token = '' }, ask) {
      if (!Number.isSafeInteger(id) || id < 1) return { status: 0, wait: {}, limited: false, message: 'empty' };
      return answerOf(await ask('DELETE', `${origin}/repos/${repo}/issues/comments/${id}`, writeHeaders(token)), false);
    },
    // Logins to assign to one issue (never a replacement of its set: those assigned stay). Answers the issue.
    async assign({ repo, number, logins, token = '' }, ask) {
      const names = loginsOf(logins);
      if (!names.length) return { status: 0, wait: {}, limited: false, message: '' };
      return answerOf(await ask('POST', `${issuePath(origin, repo, number)}/assignees`, writeHeaders(token), { assignees: names }), true);
    },
    // Logins to take off one issue (the others stay). Answers the issue.
    async unassign({ repo, number, logins, token = '' }, ask) {
      const names = loginsOf(logins);
      if (!names.length) return { status: 0, wait: {}, limited: false, message: '' };
      return answerOf(await ask('DELETE', `${issuePath(origin, repo, number)}/assignees`, writeHeaders(token), { assignees: names }), true);
    },
    // Whether GitHub will assign this login in the repository: 204, or 404 when it will not (asked before assigning, since GitHub
    // drops a login it cannot assign rather than refusing it).
    async canAssign({ repo, login, token = '' }, ask) {
      if (typeof login !== 'string' || !USER_LOGIN.test(login)) return { status: 404, wait: {}, limited: false, message: '' };
      return answerOf(await ask('GET', `${origin}/repos/${repo}/assignees/${encodeURIComponent(login)}`, writeHeaders(token)), false);
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
    // The app's own calls (plan-github-app.md, section 4), each with the app's JWT as the bearer; answers { status, wait, limited,
    // message } and, for a 200 or 201, the fields read. Nothing of a token is returned but the installation token a mint made.
    async appInfo({ jwt }, ask) {
      const got = await ask('GET', `${origin}/app`, writeHeaders(jwt));
      const out = answerOf(got, false);
      const j = got.json && typeof got.json === 'object' ? got.json : {};
      if (got.status === 200) { out.name = text(j.name, 80); out.slug = text(j.slug, 80); if (!out.slug) out.bad = true; }
      return out;
    },
    // An installation token narrowed to one repository (by id) and to `permissions` ({ issues: 'read'|'write', metadata: 'read' }).
    async mintToken({ jwt, installation, repositoryId, permissions }, ask) {
      const body = { repository_ids: [Number(repositoryId)], permissions: { issues: permissions.issues === 'write' ? 'write' : 'read', metadata: 'read' } };
      const got = await ask('POST', `${origin}/app/installations/${Number(installation)}/access_tokens`, writeHeaders(jwt), body);
      const out = answerOf(got, false);
      if (got.status === 201 || got.status === 200) {
        const j = got.json && typeof got.json === 'object' ? got.json : {};
        const repo = Array.isArray(j.repositories) && j.repositories[0] && typeof j.repositories[0] === 'object' ? j.repositories[0] : null;
        const expires = typeof j.expires_at === 'string' ? Date.parse(j.expires_at) : NaN;
        if (typeof j.token !== 'string' || !j.token || !Number.isFinite(expires) || !repo) out.bad = true;
        else { out.token = j.token; out.expiresAt = expires; out.repositoryId = Number(repo.id); out.repo = text(repo.full_name, 140); }
      }
      return out;
    },
    // One installation as the app sees it (the JWT as the bearer): whether it is suspended. GitHub's own signal is `suspended_at`
    // (docs.github.com, "REST API endpoints for GitHub App installations", read 2026-11-26); a mint's 403 message is not one.
    async installationInfo({ jwt, installation }, ask) {
      const got = await ask('GET', `${origin}/app/installations/${Number(installation)}`, writeHeaders(jwt));
      const out = answerOf(got, false);
      if (got.status === 200) {
        const j = got.json && typeof got.json === 'object' ? got.json : {};
        if (!('suspended_at' in j)) out.bad = true;
        out.suspended = typeof j.suspended_at === 'string' && Boolean(j.suspended_at);
      }
      return out;
    },

    // The sign-in while linking (plan-github-app.md, section 2). Web application flow, re-read 2026-11-26 ("Generating a user access
    // token for a GitHub App"): the code is exchanged at {webOrigin}/login/oauth/access_token with the client id and secret, the
    // redirect address and the PKCE verifier; the answer is 200 with `access_token`, or 200 with `error` (a refusal). Never logged.
    async exchangeCode({ clientId, clientSecret, code, redirectUri, verifier }, ask) {
      const headers = { Accept: 'application/json', 'User-Agent': userAgent() };
      const got = await ask('POST', `${webOrigin}/login/oauth/access_token`, headers, { client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri, code_verifier: verifier });
      const out = answerOf(got, false);
      const j = got.json && typeof got.json === 'object' ? got.json : {};
      if (got.status === 200) {
        if (typeof j.access_token === 'string' && j.access_token) out.userToken = j.access_token; else out.bad = true;
      }
      return out;
    },
    // The installations the signed-in person has explicit access to (GET /user/installations, 100 a page): ids and whether suspended.
    async userInstallations({ userToken, page = 1 }, ask) {
      const got = await ask('GET', `${origin}/user/installations?per_page=${PER_PAGE}&page=${Number(page)}`, writeHeaders(userToken));
      const out = answerOf(got, false);
      if (got.status === 200) {
        const j = got.json && typeof got.json === 'object' ? got.json : {};
        if (!Array.isArray(j.installations)) out.bad = true;
        else {
          out.installations = j.installations.filter((i) => i && Number.isSafeInteger(i.id) && i.id > 0).map((i) => ({ id: i.id, suspended: Boolean(i.suspended_at) }));
          out.total = Number.isInteger(j.total_count) ? j.total_count : out.installations.length;
        }
      }
      return out;
    },
    // The repositories one installation reaches for this person (GET /user/installations/{id}/repositories). `permissions` is the
    // repository's `{ admin, maintain, push, triage, pull }` for the person; they may write issues with push or triage or more.
    async userRepositories({ userToken, installation, page = 1 }, ask) {
      const got = await ask('GET', `${origin}/user/installations/${Number(installation)}/repositories?per_page=${PER_PAGE}&page=${Number(page)}`, writeHeaders(userToken));
      const out = answerOf(got, false);
      if (got.status === 200) {
        const j = got.json && typeof got.json === 'object' ? got.json : {};
        if (!Array.isArray(j.repositories)) out.bad = true;
        else {
          out.repositories = j.repositories.map((r) => {
            if (!r || !Number.isSafeInteger(r.id) || r.id < 1) return null;
            const repo = text(r.full_name, 140);
            if (!repo || !REPO.test(repo) || /\/\.{1,2}$/.test(repo)) return null;
            const p = r.permissions && typeof r.permissions === 'object' ? r.permissions : {};
            return { id: r.id, repo, private: r.private === true, canWrite: p.push === true || p.triage === true || p.maintain === true || p.admin === true, created: stamp(r.created_at) };
          }).filter(Boolean);
          out.total = Number.isInteger(j.total_count) ? j.total_count : out.repositories.length;
        }
      }
      return out;
    },
    // Revokes the person's user token (DELETE /applications/{client_id}/token, Basic auth with the client id and secret, the token in
    // the body). 204 when done.
    async revokeUserToken({ clientId, clientSecret, userToken }, ask) {
      const headers = { Accept: 'application/vnd.github+json', 'User-Agent': userAgent(), 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` };
      return answerOf(await ask('DELETE', `${origin}/applications/${encodeURIComponent(clientId)}/token`, headers, { access_token: userToken }), false);
    },
    // The account the user token belongs to (GET /user): { id, login } on a 200, read from GitHub's answer and nothing else of it.
    // A person's login, never a bot's.
    async whoAmI({ userToken }, ask) {
      const got = await ask('GET', `${origin}/user`, writeHeaders(userToken));
      const out = answerOf(got, false);
      if (got.status === 200) {
        const j = got.json && typeof got.json === 'object' && !Array.isArray(got.json) ? got.json : {};
        if (!Number.isSafeInteger(j.id) || j.id < 1 || typeof j.login !== 'string' || !USER_LOGIN.test(j.login)) out.bad = true;
        else { out.id = j.id; out.login = j.login; }
      }
      return out;
    },
    // A new issue: its title, its labels and its body (only when one is given; else an empty body). Answers the record.
    async create({ repo, title, labels, body: text, token = '' }, ask) {
      const body = { title: String(title || '').slice(0, 256) };
      const names = (Array.isArray(labels) ? labels : []).filter(labelOk).slice(0, 5);
      if (names.length) body.labels = names;
      if (typeof text === 'string' && text && Array.from(text).length <= BODY_MAX) body.body = text;
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
module.exports.BODY_MAX = BODY_MAX;
module.exports.ASSIGNEES_MAX = ASSIGNEES_MAX;
module.exports.commentOf = commentOf;
module.exports.COMMENTS_SHOWN = COMMENTS_SHOWN;
