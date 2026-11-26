// The issue pull (documentation/plans/plan-github-pull.md, step 1): a repository's issues read from an issue service (an adapter
// in server/issue-providers/, see its index.js for the contract) and kept as Planner - Projects' work in one space, one way only:
// the service is the source of truth, and the next pull overwrites anything changed some other way. The core maps the records
// into the plan (the plan's option a), so this file names the `schedule` module; nothing here knows which service it is.
//
// What goes out: GET requests to the adapter's origin naming the repository, a `since` time, a page and the last etag, with the
// server's token when it has one (ISSUES_GITHUB_TOKEN). Nothing of the space, the environment or its people.
//
// What is kept, per environment: issues.json in the environment's data folder,
//   { spaces: { <spaceId>: { provider, repo, on, since, etag, last, tried, fullAt, next, restUntil, error, counts, by, at } } }
// `since` the newest `updated` time a pull saw (the next pull asks only what changed from then), `etag` the first page's last
// etag, `last` when a pull last finished, `tried` when one last started, `fullAt` when every page was last read, `next` when the
// timer pulls next, `restUntil` until when the service asked to be left alone, `error` the last failure as one sentence or '',
// `counts` { total, open, done, written, removed } after the last pull, `by` and `at` who turned it on and when. Never the token.
'use strict';

const fs = require('fs');
const path = require('path');

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
const NOTES_MAX = 2000;
const REST_MS = 30 * 60 * 1000; // after a 403 or 429 that names no time
const MAX_REST_MS = 24 * 3600 * 1000;
const NOW_GAP_MS = 60 * 1000; // the least time between two pulls a person asks for
const COLUMNS = Object.freeze([['inbox', 'Inbox'], ['now', 'Now'], ['next', 'Next'], ['later', 'Later'], ['done', 'Done', true]]);
const PRIORITY = /^priority:\s*(now|next|later)$/i;
const WORK_KEY = /^plan:gh-(\d{1,9})$/;
const MILESTONE_KEY = /^plan:ghm-(\d{1,9})$/;
const SPACE_ID = /^[A-Za-z0-9_-]{1,64}$/;

// The sentences a person reads after a failure. The page adds the time from `next`.
const SAY = Object.freeze({
  terms: (name) => `${name}'s terms are not accepted on this server. The administrator accepts them in Manage, Modules, Service terms.`,
  missing: 'No such repository, or it is private.',
  token: (name) => `${name} refused the token set on this server.`,
  wait: (name) => `${name} asked to wait.`,
  silent: (name) => `${name} did not answer.`,
  bad: (name) => `${name}'s answer could not be read.`,
  full: `This plan holds at most ${MAX_ENTRIES} entries; the rest are not pulled.`,
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

function cleanRecord(r) {
  if (!r || typeof r !== 'object') return null;
  const repo = typeof r.repo === 'string' && r.repo.length <= 140 ? r.repo : '';
  const provider = typeof r.provider === 'string' && /^[a-z][a-z0-9-]{0,23}$/.test(r.provider) ? r.provider : '';
  if (!repo || !provider) return null;
  const c = r.counts && typeof r.counts === 'object' ? r.counts : {};
  return {
    provider, repo, on: r.on === true,
    since: iso(r.since), etag: typeof r.etag === 'string' ? r.etag.slice(0, 200) : '',
    last: iso(r.last), tried: iso(r.tried), fullAt: iso(r.fullAt), next: iso(r.next), restUntil: iso(r.restUntil),
    error: typeof r.error === 'string' ? r.error.slice(0, 200) : '',
    counts: { total: count(c.total), open: count(c.open), done: count(c.done), written: count(c.written), removed: count(c.removed) },
    by: typeof r.by === 'string' ? r.by.slice(0, 80) : '', at: iso(r.at),
  };
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

// One GET on the adapter's own origin: { status, header(name), json }. A redirect is followed only on that origin (at most 3);
// the answer is cut at 2 MB and the whole ask at 6 seconds. Throws an IssuesError. `fetchImpl` is replaced only by the check.
function getter(adapter, { fetchImpl = fetch } = {}) {
  return async function get(href, headers) {
    let current;
    try { current = new URL(href); } catch { throw new IssuesError('not an address', 'blocked'); }
    const allowed = (u) => u.origin === adapter.origin && (adapter.allowHttp ? /^https?:$/.test(u.protocol) : u.protocol === 'https:') && !u.username && !u.password;
    if (!allowed(current)) throw new IssuesError('not the service\'s address', 'blocked');
    const signal = AbortSignal.timeout(FETCH_MS);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      let res;
      try {
        res = await fetchImpl(current.href, { headers, signal, redirect: 'manual' });
      } catch (err) {
        if (signal.aborted || (err && (err.name === 'TimeoutError' || err.name === 'AbortError'))) throw new IssuesError('too slow', 'timeout');
        throw new IssuesError('unreachable', 'unreachable');
      }
      const header = (name) => res.headers.get(name);
      if (res.status >= 300 && res.status < 400 && res.status !== 304) {
        const to = header('location');
        let next = null;
        try { next = to ? new URL(to, current) : null; } catch { next = null; }
        if (!next || !allowed(next)) throw new IssuesError('sent elsewhere', 'blocked');
        if (hop === MAX_REDIRECTS) throw new IssuesError('too many redirects', 'redirects');
        current = next;
        continue;
      }
      if (res.status !== 200) {
        try { await res.body?.cancel(); } catch { /* nothing to read */ }
        return { status: res.status, header, json: null };
      }
      const declared = Number(header('content-length'));
      if (Number.isFinite(declared) && declared > MAX_BODY) throw new IssuesError('too big', 'big');
      let body;
      try { body = await readCapped(res, MAX_BODY); } catch (err) {
        if (err instanceof IssuesError) throw err;
        if (signal.aborted) throw new IssuesError('too slow', 'timeout');
        throw new IssuesError('unreadable', 'unreachable');
      }
      let json = null;
      try { json = JSON.parse(body); } catch { json = null; }
      return { status: 200, header, json };
    }
    throw new IssuesError('too many redirects', 'redirects');
  };
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

// Every page of one pull, one request at a time. `full`: from the start (no since, no etag). Answers
//   { ok: true, notModified, records, etag, complete, pollMs } or { ok: false, status, error, restUntil? }.
async function askIssues(adapter, { repo, since = '', etag = '', token = '', full = false }, { fetchImpl, now = Date.now() } = {}) {
  const get = getter(adapter, { fetchImpl });
  const records = [];
  let page = null;
  let firstEtag = '';
  let pollMs = 0;
  for (let n = 0; n < MAX_PAGES; n += 1) {
    let got;
    try {
      got = await adapter.list({ repo, since: full ? '' : since, etag: full ? '' : etag, token, page }, get);
    } catch (err) {
      return { ok: false, status: 0, error: err instanceof IssuesError && err.kind === 'big' ? SAY.bad(adapter.name) : SAY.silent(adapter.name) };
    }
    if (got.wait && Number.isFinite(got.wait.pollMs)) pollMs = Math.max(pollMs, got.wait.pollMs);
    if (got.status === 304 && n === 0) return { ok: true, notModified: true, records: [], etag: got.etag || etag, complete: false, pollMs };
    if (got.status === 403 || got.status === 429) {
      // A 403 is a refusal of the token too when the limit is not what is spent; GitHub then names no wait. Either way: rest.
      return { ok: false, status: got.status, error: SAY.wait(adapter.name), restUntil: restUntil(got.wait, now) };
    }
    if (got.status === 401) return { ok: false, status: 401, error: SAY.token(adapter.name) };
    if (got.status === 404 || got.status === 410) return { ok: false, status: got.status, error: SAY.missing };
    if (got.status !== 200 || got.bad) return { ok: false, status: got.status, error: got.bad ? SAY.bad(adapter.name) : SAY.silent(adapter.name) };
    if (n === 0) firstEtag = got.etag || '';
    records.push(...got.records);
    if (!got.more) return { ok: true, notModified: false, records, etag: full ? '' : firstEtag, complete: true, pollMs };
    page = got.more;
  }
  return { ok: true, notModified: false, records, etag: full ? '' : firstEtag, complete: false, pollMs };
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

// One issue as a piece of work, stored under `plan:gh-<number>`. `tagIds`: the ids the space's `tags` setting holds (a label
// past them is named in the notes instead). Only the fields Projects keeps (scClean), plus `source`.
function workOf(rec, { repo, provider, tagIds }) {
  const column = columnOf(rec);
  const start = dayOf(rec.created);
  const end = rec.open ? start : dayOf(rec.closed) || start;
  const tags = [];
  const spare = [];
  for (const l of rec.labels) {
    if (PRIORITY.test(l.name)) continue;
    const id = tagId(l.name);
    if (id && tagIds.has(id)) { if (!tags.includes(id)) tags.push(id); } else spare.push(oneLine(l.name, 50));
  }
  const lines = [rec.url];
  if (rec.milestone) lines.push(`Milestone: ${oneLine(rec.milestone.title, 120)}`);
  if (spare.length) lines.push(`Labels: ${spare.join(', ')}`);
  const value = {
    kind: 'work',
    title: cut(rec.title, TITLE_MAX) || `#${rec.number}`,
    start,
    end: end < start ? start : end,
    done: column === 'done',
    ...(tags.length ? { tags } : {}),
    notes: lines.filter(Boolean).join('\n').slice(0, NOTES_MAX),
    ...(rec.milestone ? { parent: `ghm-${rec.milestone.number}` } : {}),
    by: SYSTEM_BY,
    column,
    source: { from: provider, repo, number: rec.number, url: rec.url },
  };
  if (!value.notes) delete value.notes;
  return value;
}

// The milestones the stored work names, each as Projects stores one under `plan:ghm-<number>`: its title and due day from the
// newest record that named it (`known`: Map(number -> { title, due, open })), else from what is stored; its start the due day,
// else its first piece of work's start; done when every piece under it is.
function milestonesOf(works, known, stored, { repo, provider }) {
  const groups = new Map();
  for (const [, v] of works) {
    const m = typeof v.parent === 'string' ? /^ghm-(\d{1,9})$/.exec(v.parent) : null;
    if (!m) continue;
    const n = Number(m[1]);
    if (!groups.has(n)) groups.set(n, []);
    groups.get(n).push(v);
  }
  const out = new Map();
  for (const [n, list] of groups) {
    const had = stored.get(`plan:ghm-${n}`);
    const info = known.get(n) || (had ? { title: had.title, due: had.source && had.source.due ? had.source.due : '' } : { title: `#${n}`, due: '' });
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

// A value as text with its keys in order, to tell whether a write would change anything.
function sameValue(a, b) {
  const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}

// Whether a key of the plan is the pull's own (a piece of work or a milestone it wrote).
const isPulledKey = (key) => WORK_KEY.test(key) || MILESTONE_KEY.test(key);

// "owner/name" as typed, trimmed, or '' when it is not one for that adapter.
function cleanRepo(adapter, raw) {
  const t = typeof raw === 'string' ? raw.trim() : '';
  return adapter && adapter.validRepo(t) ? t : '';
}

module.exports = {
  IssuePulls, IssuesError, askIssues, getter, restUntil, columnOf, tagRowsOf, tagId, workOf, milestonesOf, boardOf, sameValue,
  isPulledKey, cleanRepo, SAY,
  FILE_NAME, MODULE_ID, SYSTEM_BY, MAX_ENTRIES, MAX_TAGS, NOW_GAP_MS, REST_MS, COLUMNS, WORK_KEY, MILESTONE_KEY, MAX_BODY, FETCH_MS,
};
