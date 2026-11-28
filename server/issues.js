// The issue pull (documentation/plans/plan-github-pull.md, step 1): a repository's issues read from an issue service (an adapter
// in server/issue-providers/, see its index.js for the contract) and kept as Planner - Projects' work in one space, one way only:
// the service is the source of truth, and the next pull overwrites anything changed some other way. The core maps the records
// into the plan (the plan's option a), so this file names the `schedule` module; nothing here knows which service it is.
//
// What goes out: GET requests to the adapter's origin naming the repository, which issues (all, open or closed), a `since` time, a page and the last etag,
// and after each list its open milestones (with that list's last etag), with the
// repository's installation token when the space is linked through the GitHub app (server/issue-app.js, plan-github-app.md) and
// no token otherwise. Nothing of the space, the environment or its people. The issue view and its writes (plan-github-full-sync.md,
// step 3; the routes in server/index.js) also read one issue and its newest comments, and send an issue's text, its milestone, a
// comment's text and the logins of linked Owners, as the adapter's header lists.
//
// What is kept, per environment: issues.json in the environment's data folder,
//   { spaces: { <spaceId>: { provider, repo, on, since, etag, last, tried, fullAt, next, restUntil, error, counts, by, at } } }
// `since` the newest `updated` time a pull saw (the next pull asks only what changed from then), `etag` the first page's last
// etag, `last` when a pull last finished, `tried` when one last started, `fullAt` when every page was last read, `next` when the
// timer pulls next, `restUntil` until when the service asked to be left alone, `error` the last failure as one sentence or '',
// `counts` { total, open, done, written, removed } after the last pull, `by` and `at` who turned it on and when. Never a token.
// Linked through the app (plan-github-app.md, section 8) also `via` ('app' or 'public'), `installation` and `repositoryId` (numbers,
// not secrets), `writeOk` (the linking person could write on the service), `linkBy` and `linkAt` (who linked and when, Chameleon's
// own key) and `appError` (the last trouble with the app as one sentence, or '').
// With two-way on (documentation/plans/plan-github-two-way.md, step 1) also `write` (changes made here go to the service) and
// `writeBy`, `writeAt`, who turned writing on and when. `posted` (plan-github-full-sync.md, section 2 and decision 8): the newest
// POSTED_MAX comments made from this space, [{ id, number, by, at }] (the service's comment id, the issue's number, who made it here
// as Chameleon's own key, never a login, and when), oldest first: who may edit or delete a comment made here.
// The done window (documentation/plans/plan-done-window.md, step 1): `keepDays`, how many days closed issues stay in the plan
// (a whole number from 7 to 365, 30 when absent). Closed work older than the cutoff (cutoffOf) is not stored and is removed.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const phaseRule = require('../public/phases.js');

const FILE_NAME = 'issues.json';
const MODULE_ID = 'schedule'; // Planner - Projects
const SYSTEM_BY = 'system:issues'; // the writer's fixed key: only the puller writes as it
const FETCH_MS = 6000;
const MAX_BODY = 2 * 1048576;
const MAX_REDIRECTS = 3;
const MAX_PAGES = 50; // 5,000 issues and pull requests; the plan holds at most 1,000 entries anyway
const MAX_ENTRIES = 1000; // Projects' maxPlan (modules/schedule/src/schedule-lib-file.js)
const MAX_TAGS = 20; // a list setting's rows (server/setting-list.js)
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 2000; // the stored copy of an issue's text (plan-github-full-sync.md, section 1); the whole text is GitHub's
const SPARE_LABELS_MAX = 30; // labels past the `tags` setting's rows, kept in source.labels
const TEXT_MAX = 65536; // the most characters the service holds in an issue's text or a comment (GitHub's, from memory: not in its REST pages)
const POSTED_MAX = 500; // the comments made from a space that are remembered, newest first (plan-github-full-sync.md, section 2)
const REST_MS = 30 * 60 * 1000; // after a 403 or 429 that names no time
const MAX_REST_MS = 24 * 3600 * 1000;
const NOW_GAP_MS = 60 * 1000; // the least time between two pulls a person asks for
const KEEP_DAYS = Object.freeze({ min: 7, max: 365, start: 30 }); // the done window's days (plan-done-window.md, decision 2)
const COLUMNS = Object.freeze([['inbox', 'Inbox'], ['now', 'Now'], ['next', 'Next'], ['later', 'Later'], ['done', 'Done', true]]);
const PRIORITY = /^priority:\s*(now|next|later)$/i;
const WORK_KEY = /^plan:gh-(\d{1,9})$/;
const MILESTONE_KEY = /^plan:ghm-(\d{1,9})$/;
const SPACE_ID = /^[A-Za-z0-9_-]{1,64}$/;

// The sentences a person reads after a failure. The page adds the time from `next`.
const SAY = Object.freeze({
  terms: (name, modules) => `${name}'s terms are not accepted on this server. The administrator accepts them in Manage, ${modules}, Service terms.`, // `modules`: the template's word for them, from word()
  missing: 'No such repository, or it is private.',
  token: (name) => `${name} refused this server's access.`,
  wait: (name) => `${name} asked to wait.`,
  silent: (name) => `${name} did not answer.`,
  bad: (name) => `${name}'s answer could not be read.`,
  full: `This plan holds at most ${MAX_ENTRIES} entries; the rest are not pulled.`,
  keepDays: `Keep closed issues for ${KEEP_DAYS.min} to ${KEEP_DAYS.max} days.`,
  // Writing (plan-github-two-way.md, section 5): nothing is changed in the space unless the service accepted the change.
  noWrite: 'The GitHub app may not change this repository.',
  noApp: 'Connect this repository through the GitHub app to change it from here.',
  appOff: 'This server has no GitHub app.',
  appBroken: 'The GitHub app on this server is not working. The administrator checks its settings.',
  appGone: (repo) => `The GitHub app is no longer installed on ${repo}. Install it again and press Connect to GitHub, or stop following.`,
  appPaused: (repo) => `The GitHub app is paused for ${repo} on GitHub.`,
  linkOwnerOnly: (owner) => `Only ${owner} can connect a repository to GitHub.`,
  linkEnded: 'This link has run out. Go back and press Connect to GitHub again.',
  linkFailed: 'GitHub did not finish connecting. Go back and press Connect to GitHub again.',
  linkDenied: 'GitHub was not given access. Go back and press Connect to GitHub again.',
  notInList: 'That repository is not in your list. Press Connect to GitHub again.',
  // A person's own GitHub account, linked on Profile (plan-github-full-sync.md, section 4).
  personTaken: 'That GitHub account is linked to someone else here.',
  personEnded: 'This link has run out. Go back to Profile and press Link your GitHub account again.',
  personFailed: 'GitHub did not finish linking. Go back to Profile and press Link your GitHub account again.',
  personDenied: 'GitHub was not given access. Go back to Profile and press Link your GitHub account again.',
  personSignIn: 'Sign in here as the person who pressed Link your GitHub account, then press it again.',
  personAgent: 'An agent can\'t link a GitHub account.',
  personGuest: (guests) => `${guests} can't link a GitHub account.`, // `guests`: the template's word, from word()
  moved: (name) => `${name} says this repository has moved. Try again.`,
  noWriteOut: (name) => `Only someone allowed to change ${name} can change this.`,
  writeSilent: (name) => `${name} did not answer. Nothing was changed; try again.`,
  writeWait: (name, ms) => `${name} asked to wait. Try again in ${ms < 120000 ? `${Math.max(1, Math.ceil(ms / 1000))} seconds` : `${Math.ceil(ms / 60000)} minutes`}.`,
  writeRefused: (name, message) => `${name} refused the change${message ? `: ${message}` : ''}.`,
  gone: (name) => `That issue is not on ${name} any more.`,
  conflict: 'This changed on GitHub a moment ago. It now shows GitHub\'s version.',
  longTitle: 'This title is longer than the plan holds. Change it on GitHub.',
  undoMixed: 'This changed on GitHub as well since then, so it can\'t be undone from here.',
  undoCut: 'This description was longer than the plan holds, so its change can\'t be undone from here.',
  undoOnGitHub: 'That change can only be undone on GitHub.',
  oneAtATime: 'A change to GitHub is made on its own, one entry at a time.',
  noDelete: (name) => `${name} issues can't be deleted from here. Close it, or delete it on ${name}.`,
  fromGitHub: (name) => `This comes from ${name}. Change it there.`,
  noLabel: (name) => `GitHub has no label called ${name}.`,
  badTitle: `Give it a title of at most ${TITLE_MAX} characters.`,
  badColumn: 'That is not a column an issue can start in.',
  // The issue view and its writes (plan-github-full-sync.md, step 3).
  textConflict: 'This changed on GitHub a moment ago. It now shows GitHub\'s version. Your text is kept below; copy what you need.',
  tooLong: `GitHub holds at most ${TEXT_MAX.toLocaleString('en-US')} characters.`,
  badText: 'Send the text as words.',
  noBase: 'Send the base the description was opened with.',
  cutDescription: 'This description is longer than the plan holds, so it can\'t be replaced from here.',
  noAssign: (name) => `${name} can't be assigned on GitHub in this repository.`,
  notMilestone: 'That is not a milestone in this plan.',
  notInPlan: 'That issue is not in this plan.',
  emptyComment: 'Write a comment first.',
  onlyHere: 'Only a comment made here can be changed here.',
  notAuthor: 'Only the person who wrote this comment can change it.',
  notAuthorDelete: (owner) => `Only the person who wrote this comment, or ${owner}, can delete it.`, // `owner`: the template's word, from word()
  commentGone: (name) => `That comment is not on ${name} any more.`,
});

class IssuesError extends Error {
  // `kind`: timeout, unreachable, big, blocked, redirects.
  constructor(message, kind) {
    super(message);
    this.kind = kind;
  }
}

// --- the record --------------------------------------------------------------------------------------------------------------

const iso = (v) => (typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : '');
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
// Whether `v` is a number of days the done window may keep.
const validKeepDays = (v) => Number.isInteger(v) && v >= KEEP_DAYS.min && v <= KEEP_DAYS.max;

function cleanRecord(r) {
  if (!r || typeof r !== 'object') return null;
  const repo = typeof r.repo === 'string' && r.repo.length <= 140 ? r.repo : '';
  const provider = typeof r.provider === 'string' && /^[a-z][a-z0-9-]{0,23}$/.test(r.provider) ? r.provider : '';
  if (!repo || !provider) return null;
  const c = r.counts && typeof r.counts === 'object' ? r.counts : {};
  const id = (v) => (Number.isSafeInteger(v) && v > 0 ? v : 0);
  const app = r.via === 'app' && id(r.installation) > 0 && id(r.repositoryId) > 0;
  const writeOk = r.writeOk === true;
  return {
    provider, repo, on: r.on === true,
    since: iso(r.since), etag: typeof r.etag === 'string' ? r.etag.slice(0, 200) : '',
    last: iso(r.last), tried: iso(r.tried), fullAt: iso(r.fullAt), next: iso(r.next), restUntil: iso(r.restUntil),
    error: typeof r.error === 'string' ? r.error.slice(0, 200) : '',
    counts: { total: count(c.total), open: count(c.open), done: count(c.done), written: count(c.written), removed: count(c.removed) },
    by: typeof r.by === 'string' ? r.by.slice(0, 80) : '', at: iso(r.at),
    write: app && writeOk && r.write === true, writeBy: typeof r.writeBy === 'string' ? r.writeBy.slice(0, 80) : '', writeAt: iso(r.writeAt),
    via: app ? 'app' : 'public', installation: app ? r.installation : 0, repositoryId: app ? r.repositoryId : 0, writeOk: app && writeOk,
    linkBy: app && typeof r.linkBy === 'string' ? r.linkBy.slice(0, 80) : '', linkAt: app ? iso(r.linkAt) : '',
    appError: app && typeof r.appError === 'string' ? r.appError.slice(0, 300) : '',
    keepDays: validKeepDays(r.keepDays) ? r.keepDays : KEEP_DAYS.start,
    posted: cleanPosted(r.posted),
  };
}

// The comments made from a space (`posted`): each { id, number, by, at } with a whole id and number, a key and a time; each id once
// (the later kept), the newest POSTED_MAX, oldest first.
function cleanPosted(list) {
  const byId = new Map();
  for (const p of Array.isArray(list) ? list : []) {
    if (!p || typeof p !== 'object' || !Number.isSafeInteger(p.id) || p.id < 1 || !Number.isInteger(p.number) || p.number < 1 || p.number > 999999999) continue;
    if (typeof p.by !== 'string' || !p.by || p.by.length > 80) continue;
    byId.delete(p.id);
    byId.set(p.id, { id: p.id, number: p.number, by: p.by, at: iso(p.at) });
  }
  return [...byId.values()].slice(-POSTED_MAX);
}

class IssuePulls {
  constructor(dataDir) {
    this.file = path.join(dataDir, FILE_NAME);
    this.spaces = null;
  }

  all() {
    if (this.spaces) return this.spaces;
    this.spaces = new Map();
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [id, r] of Object.entries(raw && raw.spaces && typeof raw.spaces === 'object' ? raw.spaces : {})) {
        const rec = SPACE_ID.test(id) ? cleanRecord(r) : null;
        if (rec) this.spaces.set(id, rec);
      }
    } catch (err) {
      if (err && err.code !== 'ENOENT') console.error(`could not read ${FILE_NAME}; no pulls are on:`, err.message);
    }
    return this.spaces;
  }

  get(spaceId) {
    return this.all().get(spaceId) || null;
  }

  // Whether a pull is on for this space (a person's write to its plan is then refused).
  isOn(spaceId) {
    const r = this.get(spaceId);
    return Boolean(r && r.on);
  }

  // Sets the record (a full one) or changes some of its fields.
  set(spaceId, patch) {
    const had = this.get(spaceId);
    const rec = cleanRecord({ ...(had || {}), ...patch });
    if (!rec) return null;
    this.all().set(spaceId, rec);
    this.save();
    return rec;
  }

  // A comment made from the space: who made it ({ id, number, by, at }) or null.
  postedOf(spaceId, id) {
    const r = this.get(spaceId);
    return (r && r.posted.find((p) => p.id === id)) || null;
  }

  // Remembers a comment made from the space (the newest POSTED_MAX are kept), or forgets one.
  addPosted(spaceId, entry) {
    const r = this.get(spaceId);
    return r ? this.set(spaceId, { posted: [...r.posted, entry] }) : null;
  }

  dropPosted(spaceId, id) {
    const r = this.get(spaceId);
    if (r && r.posted.some((p) => p.id === id)) this.set(spaceId, { posted: r.posted.filter((p) => p.id !== id) });
  }

  forgetSpace(spaceId) {
    const had = this.all().delete(spaceId);
    if (had) this.save();
    return had ? 1 : 0;
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ spaces: Object.fromEntries(this.all()) }, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error(`could not save ${FILE_NAME}:`, err.message);
    }
  }
}

// --- asking the service ------------------------------------------------------------------------------------------------------

// One request on the adapter's own origin: { status, header(name), json }. `get(href, headers)` is a GET: a redirect is followed only
// on that origin (at most 3), a body is read only for a 200. `get.ask(method, href, headers, body)` is any method (a write): never
// a redirect (the answer is the redirect's status), the body of any answer under 500 is read for its message, and the JSON body
// sent is only what the adapter built. The answer is cut at 2 MB and the whole ask at 6 seconds. Throws an IssuesError.
// `fetchImpl` is replaced only by the check.
function getter(adapter, { fetchImpl = fetch } = {}) {
  const allowed = (u) => u.origin === adapter.origin && (adapter.allowHttp ? /^https?:$/.test(u.protocol) : u.protocol === 'https:') && !u.username && !u.password;
  async function send(method, href, headers, body) {
    let current;
    try { current = new URL(href); } catch { throw new IssuesError('not an address', 'blocked'); }
    // The adapter's web origin (github.com) is asked for one thing only: the sign-in's code exchange, a POST.
    const exchange = Boolean(adapter.webOrigin) && method === 'POST' && current.origin === adapter.webOrigin && current.pathname === '/login/oauth/access_token' && !current.search;
    if (!exchange && !allowed(current)) throw new IssuesError('not the service\'s address', 'blocked');
    if (exchange && (!(adapter.allowHttp ? /^https?:$/.test(current.protocol) : current.protocol === 'https:') || current.username || current.password)) throw new IssuesError('not the service\'s address', 'blocked');
    const write = method !== 'GET';
    const signal = AbortSignal.timeout(FETCH_MS);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      let res;
      try {
        const init = { method, headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' }, signal, redirect: 'manual' };
        if (body !== undefined) init.body = JSON.stringify(body);
        res = await fetchImpl(current.href, init);
      } catch (err) {
        if (signal.aborted || (err && (err.name === 'TimeoutError' || err.name === 'AbortError'))) throw new IssuesError('too slow', 'timeout');
        throw new IssuesError('unreachable', 'unreachable');
      }
      const header = (name) => res.headers.get(name);
      if (res.status >= 300 && res.status < 400 && res.status !== 304) {
        if (write) {
          try { await res.body?.cancel(); } catch { /* nothing to read */ }
          return { status: res.status, header, json: null };
        }
        const to = header('location');
        let next = null;
        try { next = to ? new URL(to, current) : null; } catch { next = null; }
        if (!next || !allowed(next)) throw new IssuesError('sent elsewhere', 'blocked');
        if (hop === MAX_REDIRECTS) throw new IssuesError('too many redirects', 'redirects');
        current = next;
        continue;
      }
      if (res.status !== 200 && !(write && res.status < 500 && res.status !== 304)) {
        try { await res.body?.cancel(); } catch { /* nothing to read */ }
        return { status: res.status, header, json: null };
      }
      const declared = Number(header('content-length'));
      if (Number.isFinite(declared) && declared > MAX_BODY) throw new IssuesError('too big', 'big');
      let text;
      try { text = await readCapped(res, MAX_BODY); } catch (err) {
        if (err instanceof IssuesError) throw err;
        if (signal.aborted) throw new IssuesError('too slow', 'timeout');
        throw new IssuesError('unreadable', 'unreachable');
      }
      let json = null;
      try { json = JSON.parse(text); } catch { json = null; }
      return { status: res.status, header, json };
    }
    throw new IssuesError('too many redirects', 'redirects');
  }
  const get = (href, headers) => send('GET', href, headers);
  get.ask = send;
  return get;
}

async function readCapped(res, max) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const t = await res.text();
    if (Buffer.byteLength(t) > max) throw new IssuesError('too big', 'big');
    return t;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) { reader.cancel().catch(() => {}); throw new IssuesError('too big', 'big'); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Until when to leave the service alone after a refusal (403 or 429): its retry-after, else the limit's reset, else 30 minutes;
// never more than a day. `wait` is the adapter's.
function restUntil(wait, now) {
  const w = wait || {};
  let until = now + REST_MS;
  if (Number.isFinite(w.retryAfterMs)) until = now + w.retryAfterMs;
  else if (Number.isFinite(w.resetAt) && w.resetAt > now) until = w.resetAt;
  return Math.min(until, now + MAX_REST_MS);
}

// Two lists of records as one, by issue number: an issue closed between the two asks is in both, and the newer record of it
// (by `updated`; the later list on a tie) wins. Oldest change first, as one list comes.
function mergeByNumber(first, second) {
  const byNumber = new Map();
  for (const r of [...first, ...second]) {
    const had = byNumber.get(r.number);
    if (!had || !(r.updated < had.updated)) byNumber.set(r.number, r);
  }
  return [...byNumber.values()].sort((a, b) => (a.updated < b.updated ? -1 : a.updated > b.updated ? 1 : 0));
}

// Every page of one pull, one request at a time, at most MAX_PAGES in all. `full`: from the start (no since, no etag). A full pull
// with `closedSince` (the done window's cutoff day, cutoffOf; plan-done-window.md step 3) asks twice: every open issue, then the
// closed issues updated since the start of that day, so closed issues older than the window are never read; with no cutoff day it
// asks for every issue as one list. A failure of either list fails the whole pull (nothing is written or removed); when the open
// list stops at the page cap the closed list is not asked and the pull is not complete (so nothing is removed as gone). Answers
//   { ok: true, notModified, records, etag, complete, pollMs } or { ok: false, status, error, restUntil? }.
async function askIssues(adapter, { repo, since = '', etag = '', token = '', full = false, closedSince = '' }, { fetchImpl, now = Date.now() } = {}) {
  const get = getter(adapter, { fetchImpl });
  let pollMs = 0;
  let pages = 0;
  // One list, every page while the page cap allows.
  async function askList({ state, from, tag }) {
    const records = [];
    let page = null;
    let firstEtag = '';
    for (let n = 0; pages < MAX_PAGES; n += 1) {
      pages += 1;
      let got;
      try {
        got = await adapter.list({ repo, since: from, etag: tag, token, page, state }, get);
      } catch (err) {
        return { ok: false, status: 0, error: err instanceof IssuesError && err.kind === 'big' ? SAY.bad(adapter.name) : SAY.silent(adapter.name) };
      }
      if (got.wait && Number.isFinite(got.wait.pollMs)) pollMs = Math.max(pollMs, got.wait.pollMs);
      if (got.status === 304 && n === 0) return { ok: true, notModified: true, records: [], etag: got.etag || tag, complete: false };
      if (got.status === 403 || got.status === 429) {
        // A 403 is a refusal of the token too when the limit is not what is spent; GitHub then names no wait. Either way: rest.
        return { ok: false, status: got.status, error: SAY.wait(adapter.name), restUntil: restUntil(got.wait, now) };
      }
      if (got.status === 401) return { ok: false, status: 401, error: SAY.token(adapter.name) };
      if (got.status === 404 || got.status === 410) return { ok: false, status: got.status, error: SAY.missing };
      if (got.status !== 200 || got.bad) return { ok: false, status: got.status, error: got.bad ? SAY.bad(adapter.name) : SAY.silent(adapter.name) };
      if (n === 0) firstEtag = got.etag || '';
      records.push(...got.records);
      if (!got.more) return { ok: true, notModified: false, records, etag: firstEtag, complete: true };
      page = got.more;
    }
    return { ok: true, notModified: false, records, etag: firstEtag, complete: false };
  }
  const cutoff = full && phaseRule.isDay(closedSince) ? closedSince : '';
  if (!cutoff) {
    const got = await askList({ state: 'all', from: full ? '' : since, tag: full ? '' : etag });
    return got.ok ? { ...got, etag: full ? '' : got.etag, pollMs } : got;
  }
  const open = await askList({ state: 'open', from: '', tag: '' });
  if (!open.ok) return open;
  if (!open.complete) return { ok: true, notModified: false, records: open.records, etag: '', complete: false, pollMs };
  const closed = await askList({ state: 'closed', from: `${cutoff}T00:00:00Z`, tag: '' });
  if (!closed.ok) return closed;
  return { ok: true, notModified: false, records: mergeByNumber(open.records, closed.records), etag: '', complete: closed.complete, pollMs };
}

// The repository's open milestones, after a list (plan-github-full-sync.md, section 5): one conditional request. Answers
//   { ok: true, notModified, milestones, etag } or { ok: false } (any trouble: the pull goes on and keeps the milestones it has).
// A limit here is not rested on: the list just before it answered, and the next list asked will rest if the service says so.
async function askMilestones(adapter, { repo, etag = '', token = '' }, { fetchImpl } = {}) {
  if (typeof adapter.milestones !== 'function') return { ok: false };
  let got;
  try { got = await adapter.milestones({ repo, etag, token }, getter(adapter, { fetchImpl })); } catch { return { ok: false }; }
  if (got.status === 304) return { ok: true, notModified: true, milestones: [], etag: got.etag || etag };
  if (got.status !== 200 || got.bad || !Array.isArray(got.milestones)) return { ok: false };
  return { ok: true, notModified: false, milestones: got.milestones, etag: got.etag || '' };
}

// --- the mapping into the plan -----------------------------------------------------------------------------------------------

const oneLine = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const cut = (s, n) => { const t = oneLine(s, 1000); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const tagId = (name) => oneLine(name, 30).toLowerCase().normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '').slice(0, 30).replace(/-+$/, '');
const dayOf = (t) => (t ? t.slice(0, 10) : '');

// The column an issue is in: closed is done; open with a priority label is that column; any other open issue is the inbox.
function columnOf(rec) {
  if (!rec.open) return 'done';
  for (const l of rec.labels) {
    const m = PRIORITY.exec(l.name);
    if (m) return m[1].toLowerCase();
  }
  return 'inbox';
}

// The tag rows a set of records needs: { id, label, icon, color } for each label that is not a priority one, by id.
function tagRowsOf(records) {
  const rows = new Map();
  for (const rec of records) {
    for (const l of rec.labels) {
      if (PRIORITY.test(l.name)) continue;
      const id = tagId(l.name);
      if (!id || rows.has(id)) continue;
      rows.set(id, { id, label: oneLine(l.name, 30), icon: 'tag', color: `#${l.color || '808080'}` });
    }
  }
  return rows;
}

// An issue's text as the plan stores it: at most DESCRIPTION_MAX characters (never inside a surrogate pair), cut with an ellipsis.
// Answers { description, cut }.
function descriptionOf(body) {
  const t = typeof body === 'string' ? body : '';
  if (t.length <= DESCRIPTION_MAX) return { description: t, cut: false };
  const chars = Array.from(t);
  if (chars.length <= DESCRIPTION_MAX) return { description: t, cut: false };
  return { description: `${chars.slice(0, DESCRIPTION_MAX - 1).join('').trimEnd()}…`, cut: true };
}

// One issue as a piece of work, stored under `plan:gh-<number>`. `tagIds`: the ids the space's `tags` setting holds (a label past
// them is kept in `source.labels` instead, read only). `linked`: Map(the service's account id -> a member's key), the members who
// linked their account (plan-github-full-sync.md, section 4; none until step 2): an assignee who is one is an Owner, any other is
// kept by login in `assignees`. Only the fields Projects keeps (scClean), plus `source`. Pulled work has no `notes`: the link is
// `source.url`, the milestone `parent`, the issue's text `description` (cut, with `source.cut`).
function workOf(rec, { repo, provider, tagIds, linked = null }) {
  const column = columnOf(rec);
  const start = dayOf(rec.created);
  const end = rec.open ? start : dayOf(rec.closed) || start;
  const tags = [];
  const spare = [];
  for (const l of rec.labels) {
    if (PRIORITY.test(l.name)) continue;
    const id = tagId(l.name);
    if (id && tagIds.has(id)) { if (!tags.includes(id)) tags.push(id); } else {
      const name = oneLine(l.name, 50);
      if (name && !spare.includes(name) && spare.length < SPARE_LABELS_MAX) spare.push(name);
    }
  }
  const owners = [];
  const logins = [];
  for (const a of Array.isArray(rec.assignees) ? rec.assignees : []) {
    const key = linked && linked.get(a.id);
    if (key) { if (!owners.includes(key)) owners.push(key); } else if (!logins.includes(a.login)) logins.push(a.login);
  }
  const { description, cut: wasCut } = descriptionOf(rec.body);
  return {
    kind: 'work',
    title: cut(rec.title, TITLE_MAX) || `#${rec.number}`,
    start,
    end: end < start ? start : end,
    done: column === 'done',
    // The day it became done is the day it was closed (plan-projects-sizing-burndown.md, decision 2); open work has none.
    ...(column === 'done' && phaseRule.isDay(dayOf(rec.closed)) ? { doneOn: dayOf(rec.closed) } : {}),
    ...(tags.length ? { tags } : {}),
    ...(owners.length ? { owners } : {}),
    ...(logins.length ? { assignees: logins.slice(0, 10) } : {}),
    ...(description ? { description } : {}),
    ...(rec.milestone ? { parent: `ghm-${rec.milestone.number}` } : {}),
    by: SYSTEM_BY,
    column,
    source: {
      from: provider, repo, number: rec.number, url: rec.url,
      ...(rec.updated ? { updated: rec.updated } : {}),
      ...(wasCut ? { cut: true } : {}),
      ...(spare.length ? { labels: spare } : {}),
    },
  };
}

// The milestones of the plan, each as Projects stores one under `plan:ghm-<number>`: every one the stored work names, and every
// open one the service listed (`open`: Map(number -> { title, due, open }) from askMilestones, plan-github-full-sync.md section 5),
// with or without work. With `open` null (not read this time) a stored milestone with no work is kept as it is. Its title and due
// day from the newest the service said (`open`, then `known`: Map(number -> { title, due, open }) from the records), else from what
// is stored; its start the due day, else its first piece of work's start; done when every piece under it is. `free`: how many
// milestones not stored yet and with no work may be added (the plan's 1,000 entries).
function milestonesOf(works, known, stored, { repo, provider }, { open = null, free = Infinity } = {}) {
  const groups = new Map();
  for (const [, v] of works) {
    const m = typeof v.parent === 'string' ? /^ghm-(\d{1,9})$/.exec(v.parent) : null;
    if (!m) continue;
    const n = Number(m[1]);
    if (!groups.has(n)) groups.set(n, []);
    groups.get(n).push(v);
  }
  let left = free;
  const empty = (n) => {
    if (groups.has(n)) return;
    if (!stored.has(`plan:ghm-${n}`)) { if (left <= 0) return; left -= 1; }
    groups.set(n, []);
  };
  if (open) for (const n of [...open.keys()].sort((a, b) => a - b)) empty(n);
  else for (const key of stored.keys()) { const m = MILESTONE_KEY.exec(key); if (m) empty(Number(m[1])); }
  const out = new Map();
  for (const [n, list] of groups) {
    const had = stored.get(`plan:ghm-${n}`);
    const info = (open && open.get(n)) || known.get(n) || (had ? { title: had.title, due: had.source && had.source.due ? had.source.due : '' } : { title: `#${n}`, due: '' });
    const first = list.map((v) => v.start).filter(Boolean).sort()[0] || '';
    const done = list.filter((v) => v.done).length;
    out.set(`plan:ghm-${n}`, {
      kind: 'milestone',
      title: cut(info.title, TITLE_MAX) || `#${n}`,
      ...(info.due || first ? { start: info.due || first } : {}),
      done: list.length > 0 && done === list.length,
      progress: list.length ? Math.round((done / list.length) * 100) : 0,
      by: SYSTEM_BY,
      source: { from: provider, repo, milestone: n, ...(info.due ? { due: info.due } : {}) },
    });
  }
  return out;
}

// The board a pulled space has: exactly the five columns, named by the module's labels (`label(id)` -> the word or '').
function boardOf(label) {
  return {
    id: 'main',
    name: 'Board',
    field: 'column',
    columns: COLUMNS.map(([id, plain, done]) => {
      const w = oneLine(typeof label === 'function' ? label(`board-${id}`) : '', 40) || plain;
      return done ? { id, label: w, done: true } : { id, label: w };
    }),
  };
}

// The pulled board's key, and a column's colour as stored (plan-board-colour.md: a strict lower-case #rrggbb).
const BOARD_KEY = 'board:main';
const COLUMN_COLOR = /^#[0-9a-f]{6}$/;
// Whether `after` differs from the stored board `before` only in its columns' colours (plan-board-colour.md, decision 2): every
// column's `color` absent or a strict #rrggbb, and everything else (the board's keys, the number of columns, their order, ids,
// labels and done flags) exactly as stored, key order included. Answers false for anything else.
function colourOnly(before, after) {
  const plain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  if (!plain(before) || !plain(after) || !Array.isArray(before.columns) || !Array.isArray(after.columns)) return false;
  if (before.columns.length !== after.columns.length) return false;
  if (!after.columns.every((c) => plain(c) && (!Object.hasOwn(c, 'color') || (typeof c.color === 'string' && COLUMN_COLOR.test(c.color))))) return false;
  if (!before.columns.every(plain)) return false;
  const bare = (board) => ({ ...board, columns: board.columns.map((c) => Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'color'))) });
  return JSON.stringify(bare(before)) === JSON.stringify(bare(after));
}

// A value as text with its keys in order, to tell whether a write would change anything.
function sameValue(a, b) {
  const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

// Whether a key of the plan is the pull's own (a piece of work or a milestone it wrote).
const isPulledKey = (key) => WORK_KEY.test(key) || MILESTONE_KEY.test(key);

// --- the done window (documentation/plans/plan-done-window.md, step 1) --------------------------------------------------------

// The first day the window keeps, YYYY-MM-DD: the earlier of `today` less the record's `keepDays` and the start of the space's
// phase that holds today (decision 2: never shorter than the current phase). `space` is the space record (its `phases` dates and
// `createdAt`), `phases` the template's phases it reads; the phase counts only when the space has phase dates of its own, so a
// space with none keeps `keepDays` days (public/phases.js would otherwise start its first phase on the day the space was made).
// '' when `today` is not a day: then nothing is cut.
function cutoffOf(rec, space, today, phases) {
  if (!phaseRule.isDay(today)) return '';
  const days = rec && validKeepDays(rec.keepDays) ? rec.keepDays : KEEP_DAYS.start;
  let cutoff = phaseRule.addDays(today, -days);
  const dates = space && space.phases ? phaseRule.cleanDates(space.phases) : {};
  if (Array.isArray(phases) && phases.length && Object.keys(dates).length) {
    let bands = [];
    try { bands = phaseRule.timelineOf(phases, dates, { today, created: space.createdAt }) || []; } catch { bands = []; }
    for (const b of bands) if (b.current && phaseRule.isDay(b.start) && b.start < cutoff) cutoff = b.start;
  }
  return cutoff;
}

// Whether a pull's record is closed work the window does not keep: closed on a day before `cutoff`. Never open work.
const closedOutside = (rec, cutoff) => Boolean(cutoff) && Boolean(rec) && rec.open === false && phaseRule.isDay(dayOf(rec.closed)) && dayOf(rec.closed) < cutoff;

// Whether the stored entry at `key` is pulled work that has aged out of the window: a pulled piece of work (`plan:gh-<n>`, never
// a milestone, the board, a field or anything the space made), done, with a `doneOn` day before `cutoff`. Never open work.
const agedOut = (key, value, cutoff) => Boolean(cutoff) && WORK_KEY.test(String(key)) && Boolean(value) && typeof value === 'object'
  && value.done === true && phaseRule.isDay(value.doneOn) && value.doneOn < cutoff;


// --- writing back (documentation/plans/plan-github-two-way.md, step 1) --------------------------------------------------------

// The fields of a piece of work by who owns them when a space writes back (plan-github-full-sync.md, "The stored work"): the
// space's own that stay here (OWN_FIELDS, and Owners with no linked GitHub account), GitHub's own that go out (SENT_FIELDS, and
// Owners with a linked account, assigned or unassigned there), and everything else (assignees, source, kind, notes, id, ...),
// which is GitHub's and read-only: refused, with nothing sent. `by` is set by the write itself.
const OWN_FIELDS = Object.freeze(['waitsOn', 'start', 'end', 'rank', 'fields']);
const SENT_FIELDS = Object.freeze(['column', 'done', 'title', 'tags', 'description', 'parent']);
const OWNERS = 'owners'; // split by the link: see diffWork
const sortedTags = (v) => (Array.isArray(v) ? [...new Set(v.filter((t) => typeof t === 'string'))].sort() : []);
const keysOf = (v) => (Array.isArray(v) ? [...new Set(v.filter((k) => typeof k === 'string'))] : []);
const MILESTONE_ID = /^ghm-(\d{1,9})$/;

// What a person's new value changes of the stored work: { column, title, tags: { add, remove }, description, parent, owners: { add,
// remove }, own, foreign }. `column` is the column asked for (only when column or done changed), `title` the new title (only when
// changed), `tags` the ids added and removed, `description` the new text ('' for none; null when unchanged or not given), `parent`
// null when unchanged, else { milestone, ok } (the milestone's number or null for none; `ok` false for a parent that is not a
// milestone's id), `owners` the members with a linked account (`linked`: their keys) added and removed, `own` whether a space's
// own field changed (Owners with no link among them), `foreign` the names of GitHub-only fields that changed. `doneOn` is not
// read: it follows `done` and is the service's closed day, never sent and never taken from a person's value (keepOwn,
// issueStore; pulledRefusal holds it as stored).
function diffWork(stored, given, { linked = null } = {}) {
  const s = stored && typeof stored === 'object' ? stored : {};
  const g = given && typeof given === 'object' && !Array.isArray(given) ? given : {};
  const keys = linked instanceof Set ? linked : new Set(linked || []);
  const out = { column: null, title: null, tags: { add: [], remove: [] }, description: null, parent: null, owners: { add: [], remove: [] }, own: false, foreign: [] };
  for (const k of new Set([...Object.keys(s), ...Object.keys(g)])) {
    if (k === 'by' || k === 'doneOn' || k === OWNERS || sameValue(s[k], g[k])) continue;
    if (OWN_FIELDS.includes(k)) out.own = true;
    else if (!SENT_FIELDS.includes(k)) out.foreign.push(k);
  }
  const col = (v) => (v.done === true || v.column === 'done' ? 'done' : typeof v.column === 'string' ? v.column : '');
  const before = col(s) || 'inbox';
  const asked = col(g) || (s.column === 'done' ? 'inbox' : before);
  if (asked !== before) out.column = asked;
  if (!sameValue(s.title, g.title)) out.title = g.title;
  const was = sortedTags(s.tags);
  const now = sortedTags(g.tags);
  out.tags.add = now.filter((t) => !was.includes(t));
  out.tags.remove = was.filter((t) => !now.includes(t));
  // A value with no `description` leaves the text as it is (so a writer that does not know the field never empties the issue);
  // '' empties it.
  const text = (v) => (v === undefined || v === null ? '' : v);
  if (g.description !== undefined && !sameValue(text(s.description), text(g.description))) out.description = g.description === null ? '' : g.description;
  const parentOf = (v) => (v === undefined || v === null ? '' : v);
  if (!sameValue(parentOf(s.parent), parentOf(g.parent))) {
    const p = parentOf(g.parent);
    const m = typeof p === 'string' ? MILESTONE_ID.exec(p) : null;
    out.parent = p === '' ? { milestone: null, ok: true } : { milestone: m ? Number(m[1]) : null, ok: Boolean(m) };
  }
  const had = keysOf(s.owners);
  const want = keysOf(g.owners);
  for (const k of want) if (!had.includes(k)) { if (keys.has(k)) out.owners.add.push(k); else out.own = true; }
  for (const k of had) if (!want.includes(k)) { if (keys.has(k)) out.owners.remove.push(k); else out.own = true; }
  if (!Array.isArray(g.owners) && g.owners !== undefined && !sameValue(s.owners, g.owners)) out.foreign.push(OWNERS);
  return out;
}

// The parts of the work a diff changes, by name, in this order: `column` (with done), `title`, `tags`, `description`, `parent` (the
// milestone), `owners` (with a linked account) and `own` (the space's own fields, Owners with no link among them). An agent's change
// to pulled work keeps them (server/index.js issueAskedFields), so its Undo puts back exactly those.
const CHANGED_PARTS = Object.freeze(['column', 'title', 'tags', 'description', 'parent', 'owners', 'own']);
const changedParts = (d) => CHANGED_PARTS.filter((k) => (k === 'tags' ? d.tags.add.length > 0 || d.tags.remove.length > 0
  : k === 'owners' ? d.owners.add.length > 0 || d.owners.remove.length > 0
    : k === 'own' ? d.own : d[k] !== null));

// Whether a diff sends anything to the service.
const diffSends = (d) => d.column !== null || d.title !== null || d.tags.add.length > 0 || d.tags.remove.length > 0
  || d.description !== null || d.parent !== null || d.owners.add.length > 0 || d.owners.remove.length > 0;

const labelOf = (column) => `priority: ${column}`;
// The calls that bring `rec` (the issue as GitHub has it now) to column `column`, a new `title`, the labels named, the text `body`
// (a string; null leaves it), the milestone `milestone` (a number, null for none; undefined leaves it), and the logins to assign
// and unassign: the service's own sentences are not here, only the plan of calls { patch, remove, add, assign, unassign }. Labels
// and assignees are removed and added (never the whole set replaced), so what someone added meanwhile stays; what is already so
// is not sent.
function changePlan(rec, { column = null, title = null, addNames = [], removeIds = [], body = null, milestone, assign = [], unassign = [] }) {
  const patch = {};
  const remove = [];
  const add = [];
  if (title !== null && title !== rec.title) patch.title = title;
  if (column !== null) {
    if (column === 'done') {
      if (rec.open) { patch.state = 'closed'; patch.stateReason = 'completed'; }
    } else {
      if (!rec.open) { patch.state = 'open'; patch.stateReason = 'reopened'; }
      const want = column === 'inbox' ? '' : labelOf(column);
      for (const l of rec.labels) if (PRIORITY.test(l.name) && l.name !== want) remove.push(l.name);
      if (want && !rec.labels.some((l) => l.name === want)) add.push(want);
    }
  }
  for (const l of rec.labels) if (!PRIORITY.test(l.name) && removeIds.includes(tagId(l.name))) remove.push(l.name);
  for (const name of addNames) if (!rec.labels.some((l) => l.name === name) && !add.includes(name)) add.push(name);
  if (typeof body === 'string' && body !== (rec.body || '')) patch.body = body;
  const had = rec.milestone ? rec.milestone.number : null;
  if (milestone !== undefined && milestone !== had) patch.milestone = milestone;
  const on = (login) => (Array.isArray(rec.assignees) ? rec.assignees : []).some((a) => a.login.toLowerCase() === String(login).toLowerCase());
  return {
    patch, remove, add,
    assign: [...new Set(assign)].filter((l) => !on(l)),
    unassign: [...new Set(unassign)].filter((l) => on(l)),
  };
}

// The `base` of an issue's text (plan-github-full-sync.md, section 1): a hash of the text as the record holds it, given with the
// text the issue view opens and sent back with a save; a save whose base is not the service's text now is a conflict.
const baseOf = (text) => crypto.createHash('sha256').update(typeof text === 'string' ? text : '', 'utf8').digest('hex').slice(0, 32);

// A map that keeps at most `maxEntries` values and at most `maxChars` characters of them in all (each value's size from `sizeOf`),
// dropping the oldest first; a value bigger than `maxChars` on its own is not kept. What the server remembers of the service's
// answers (an issue read, an issue's comments) is held in these, so a run of long issues can't fill the memory.
class SizedCache {
  constructor({ maxEntries, maxChars, sizeOf = (v) => JSON.stringify(v).length }) {
    this.maxEntries = maxEntries;
    this.maxChars = maxChars;
    this.sizeOf = sizeOf;
    this.map = new Map(); // key -> { value, size }
    this.chars = 0;
  }
  get size() { return this.map.size; }
  get(key) { const e = this.map.get(key); return e ? e.value : undefined; }
  has(key) { return this.map.has(key); }
  delete(key) {
    const e = this.map.get(key);
    if (!e) return false;
    this.chars -= e.size;
    this.map.delete(key);
    return true;
  }
  set(key, value) {
    this.delete(key);
    let size = 0;
    try { size = Math.max(0, Number(this.sizeOf(value)) || 0); } catch { size = Infinity; }
    if (size > this.maxChars) return this;
    this.map.set(key, { value, size });
    this.chars += size;
    while (this.map.size > this.maxEntries || this.chars > this.maxChars) this.delete(this.map.keys().next().value);
    return this;
  }
}

// The id of the Area choice a title names: the words before its first colon, when the plan's `area` field (`field:area`'s value,
// { options: [{ id, label }] }) has a choice with that id or those words, ignoring case. '' when it names none. Once, when the work
// is first made; after that Area is the space's own.
function areaOf(title, field) {
  if (typeof title !== 'string' || !field || !Array.isArray(field.options)) return '';
  const at = title.indexOf(':');
  if (at < 1) return '';
  const word = title.slice(0, at).trim().toLowerCase();
  const hit = word ? field.options.find((o) => o && typeof o.id === 'string' && (o.id.toLowerCase() === word || (typeof o.label === 'string' && o.label.trim().toLowerCase() === word))) : null;
  return hit ? hit.id : '';
}

// The work the pull writes over the stored one in a space that writes back: GitHub's fields from the new record, the space's own
// (owners, waits, rank, fields, and the days once they exist) and who made the change kept from what is stored; work not stored
// yet starts and ends on the day the issue was made. `doneOn` is always the fresh record's (GitHub's closed day), never stored.
// `linked`: the keys of the members who linked a GitHub account (workOf's map's values; none until plan-github-full-sync.md step 2):
// for them GitHub is the truth, so a stored Owner who is one is kept only when the record assigns them (in `fresh.owners`).
function keepOwn(stored, fresh, { area = null, linked = null } = {}) {
  if (!stored || typeof stored !== 'object') { // the days start as the day it was made, then are the space's; so does the Area, from the title's "Area:"
    const choice = areaOf(fresh.title, area);
    return { ...fresh, end: fresh.start, ...(choice ? { fields: { area: choice } } : {}) };
  }
  const out = { ...fresh };
  for (const k of ['owners', 'waitsOn', 'rank', 'fields']) if (stored[k] !== undefined) out[k] = stored[k];
  const keys = linked ? new Set(linked) : null;
  if (keys && keys.size) {
    const own = (Array.isArray(stored.owners) ? stored.owners : []).filter((k) => !keys.has(k));
    const all = [...new Set([...own, ...(Array.isArray(fresh.owners) ? fresh.owners : [])])];
    if (all.length) out.owners = all; else delete out.owners;
  }
  if (typeof stored.start === 'string') out.start = stored.start;
  if (typeof stored.end === 'string') out.end = stored.end;
  if (typeof stored.by === 'string' && stored.by) out.by = stored.by;
  return out;
}

// Whether a pull's record is older than the work already stored (a pull begun before a write must not put older data back).
function olderThanStored(stored, rec) {
  const had = stored && stored.source && typeof stored.source.updated === 'string' ? stored.source.updated : '';
  return Boolean(had && rec.updated && rec.updated < had);
}

// One write call to the service, its trouble as a refusal: { ok: true, answer } or { ok: false, status, error, restUntil? } where
// `status` is the one this server answers a person with. `call(ask)` is one adapter member bound to its arguments; `ask` is the
// guarded one. Never logs or returns a token.
async function writeCall(adapter, call, { fetchImpl, now = Date.now() } = {}) {
  const ask = getter(adapter, { fetchImpl }).ask;
  let a;
  try { a = await call(ask); } catch (err) {
    return { ok: false, status: 502, error: err instanceof IssuesError && err.kind === 'big' ? SAY.bad(adapter.name) : SAY.writeSilent(adapter.name) };
  }
  if (a.status === 0 && !a.message) return { ok: true, answer: a }; // nothing to send
  if (a.status === 304) return { ok: true, answer: a }; // a conditional read that has not changed
  if (a.status === 200 || a.status === 201) return a.bad ? { ok: false, status: 502, error: SAY.bad(adapter.name) } : { ok: true, answer: a };
  if (a.status === 204) return { ok: true, answer: a }; // done, nothing to read (a comment deleted; a login that can be assigned)
  if (a.limited) {
    const until = restUntil(a.wait, now);
    return { ok: false, status: 429, restUntil: until, served: a, error: SAY.writeWait(adapter.name, Math.max(1000, until - now)) };
  }
  if (a.status === 301) return { ok: false, served: a, status: 502, moved: true, error: SAY.moved(adapter.name) };
  if (a.status === 401) return { ok: false, served: a, status: 502, unauthorized: true, error: SAY.token(adapter.name) };
  if (a.status === 404) return { ok: false, served: a, status: 404, notFound: true, error: SAY.gone(adapter.name) };
  if (a.status >= 500 || a.status === 0) return { ok: false, served: a, status: 502, error: SAY.writeSilent(adapter.name) };
  return { ok: false, served: a, status: 502, error: SAY.writeRefused(adapter.name, a.message) };
}

// The clean "owner/name" from what was typed or pasted (the adapter knows its service's address), or '' when it is not one.
function cleanRepo(adapter, raw) {
  const repo = adapter ? adapter.repoFrom(raw) : '';
  return repo && adapter.validRepo(repo) ? repo : '';
}

module.exports = {
  IssuePulls, IssuesError, askIssues, askMilestones, mergeByNumber, getter, restUntil, columnOf, tagRowsOf, tagId, workOf, milestonesOf, boardOf, sameValue,
  BOARD_KEY, colourOnly, isPulledKey, cleanRepo, SAY, cutoffOf, closedOutside, agedOut, validKeepDays, KEEP_DAYS, diffWork, diffSends, changePlan, keepOwn, areaOf, olderThanStored, writeCall, labelOf, PRIORITY, OWN_FIELDS, SENT_FIELDS, OWNERS,
  baseOf, SizedCache, cleanPosted, TEXT_MAX, POSTED_MAX, CHANGED_PARTS, changedParts,
  FILE_NAME, MODULE_ID, SYSTEM_BY, MAX_ENTRIES, MAX_TAGS, NOW_GAP_MS, REST_MS, COLUMNS, WORK_KEY, MILESTONE_KEY, MAX_BODY, FETCH_MS, TITLE_MAX, DESCRIPTION_MAX, SPARE_LABELS_MAX, descriptionOf, oneLine,
};
