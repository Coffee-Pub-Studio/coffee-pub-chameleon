'use strict';

// What agents did, and how much more they may do (documentation/plans/plan-agent-access.md, "Limits" and "The log").
// One environment's own, in DATA_DIR/agent-log/: a folder per agent (its key) and a file per (UTC) day in it,
// agent-log/<agent key>/<YYYY-MM-DD>.jsonl, one line a call,
// { at, agent, token, method, route, space, module, action, request, message, status, address, kind }:
//   token   the token's id (server/tokens.js), never the token;
//   route   the gate's route pattern ("/api/spaces/:id/action"), never the path asked for, so no key or token in an
//           address lands here. For a route the gate does not let an agent use (a refused call) it is that path's fixed shape
//           (refusedRoute below): each segment kept only when it is a word of the API's own, else ":x", never a query;
//   module  the id of the module the call is for (a data or context read: the route's :id; an action: the part before the
//           colon), only when it is a safe id (^[a-z0-9-]{1,40}$) that is an installed module's; else null;
//   kind    "read" or "write", what the call counted against; null for a line that counted against nothing;
//   message a Chat post's message id, or how many messages a Chat read carried (a number); else null. Never text.
// Never a request's body, a chat message's text or an object's content. A day's file older than 30 days is deleted on
// start and once a day after; nothing is ever rewritten.
//
// What a call over a limit (429) or with a token that is the agent's but no longer good (401: turned off, past its end,
// Agents off) leaves: not a line each, but one line a minute per agent and status, the first such call of that minute
// (note). So every file is bounded by the limits: at most 3,000 reads and 300 writes a day, and 1,440 lines a day for
// each of the two notes, and each read of the log is of one agent's files only.
//
// The limits, per agent: 60 reads and 20 writes a minute, 3,000 reads and 300 writes a day. The minute's counts are in
// memory only (a restart clears them, which costs at most one more minute's worth). The day's counts are read back from
// the agent's file for the day the first time it calls that day, so a restart does not reset them: every line with a
// kind counts, except a 429.

const fs = require('fs');
const path = require('path');
const net = require('net');
const { deepFreeze } = require('./deep-freeze');

const AGENT_LIMITS = deepFreeze({
  read: { perMinute: 60, perDay: 3000 },
  write: { perMinute: 20, perDay: 300 },
});
const KEEP_DAYS = 30;
const PAGE = 100;
const KINDS = ['read', 'write'];
const NOTE_MS = 60 * 1000;
// The most of one day's file ever read: its last 8 MB. The limits keep a real file far under it (a few MB at most); a
// bigger one (written by hand) is read from its end, never whole.
const MAX_READ = 8 * 1024 * 1024;
const KEY_RE = /^[a-z0-9]{4,16}$/;
const DAY_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
const MESSAGE_ID_RE = /^[a-f0-9]{12}$/;
const MODULE_RE = /^[a-z0-9-]{1,40}$/;
// The only path words a refused call's route may keep: those of the API's own routes (the gate's list). Any other segment
// (an id, a key, a token, anything a client chose) becomes ":x".
const PATH_WORDS = new Set(['api', 'agent', 'me', 'modules', 'context', 'data', 'objects', 'search', 'links', 'kinds', 'resolve', 'spaces', 'actions', 'action', 'chat']);
const ROUTE_MAX = 80;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

// The route written for a call the gate refuses: the path (never the query) as a fixed shape. Split on "/", empty segments
// dropped, at most 8 kept; a segment (lower-cased) in PATH_WORDS stays, any other becomes ":x"; joined with "/" behind a
// leading "/", cut to 80 characters. "/API/modules/a1b2c3/data?token=x" reads "/api/modules/:x/data".
function refusedRoute(rawPath) {
  const segments = String(rawPath || '').split('?')[0].split('/').filter(Boolean).slice(0, 8);
  const shape = segments.map((s) => { const w = s.toLowerCase(); return PATH_WORDS.has(w) ? w : ':x'; });
  return `/${shape.join('/')}`.slice(0, ROUTE_MAX);
}

// `id` when it is a safe module id that `installed` (a Set of ids) holds, else null.
const safeModule = (id, installed) => (typeof id === 'string' && MODULE_RE.test(id) && installed.has(id) ? id : null);

class AgentLog {
  constructor(dataDir, { now = Date.now } = {}) {
    this.dir = path.join(dataDir, 'agent-log');
    this.now = now;
    this.minute = new Map(); // "<agent>|<kind>" -> call times in the last minute
    this.today = dayOf(this.now());
    this.counts = new Map(); // agent key -> { read, write } today, read from its file the first time it is asked
    this.noted = new Map(); // "<agent>|<status>" -> when its last note was written
    this.lastAt = 0;
    this.prune();
  }

  fileOf(agent, day) {
    return path.join(this.dir, agent, `${day}.jsonl`);
  }

  // The lines of one file, oldest first: at most its last MAX_READ bytes; unreadable lines are passed over.
  readFile(file) {
    let fd;
    try {
      fd = fs.openSync(file, 'r');
    } catch {
      return [];
    }
    let text;
    try {
      const size = fs.fstatSync(fd).size;
      const length = Math.min(size, MAX_READ);
      const buf = Buffer.alloc(length);
      let got = 0;
      while (got < length) {
        const n = fs.readSync(fd, buf, got, length - got, size - length + got);
        if (!n) break;
        got += n;
      }
      text = buf.subarray(0, got).toString('utf8');
      if (size > length) text = text.slice(text.indexOf('\n') + 1); // the first, cut line
    } finally {
      fs.closeSync(fd);
    }
    const out = [];
    for (const raw of text.split('\n')) {
      if (!raw) continue;
      let line;
      try { line = JSON.parse(raw); } catch { continue; }
      if (!line || typeof line !== 'object' || Array.isArray(line) || typeof line.at !== 'string' || !Number.isFinite(Date.parse(line.at))) continue;
      out.push(line);
    }
    return out;
  }

  // The days an agent has a file for, newest first.
  daysOf(agent) {
    if (!KEY_RE.test(String(agent))) return [];
    let names;
    try { names = fs.readdirSync(path.join(this.dir, agent)); } catch { return []; }
    return names.map((n) => DAY_FILE_RE.exec(n)?.[1]).filter(Boolean).sort().reverse();
  }

  // Deletes every day's file older than KEEP_DAYS, and an agent's folder left empty.
  prune() {
    const now = this.now();
    this.prunedOn = dayOf(now);
    const oldest = dayOf(now - KEEP_DAYS * 86400000);
    let agents;
    try { agents = fs.readdirSync(this.dir); } catch { return; }
    for (const agent of agents) {
      if (!KEY_RE.test(agent)) continue;
      const days = this.daysOf(agent);
      for (const day of days) if (day < oldest) { try { fs.rmSync(this.fileOf(agent, day), { force: true }); } catch { /* left for the next day */ } }
      try { if (!fs.readdirSync(path.join(this.dir, agent)).length) fs.rmdirSync(path.join(this.dir, agent)); } catch { /* not empty, or gone */ }
    }
  }

  roll(now) {
    const day = dayOf(now);
    if (day !== this.today) {
      this.today = day;
      this.counts = new Map();
    }
    if (this.prunedOn !== day) this.prune();
  }

  // What `agent` has used today, read from its file the first time it is asked for today.
  countsOf(agent) {
    let c = this.counts.get(agent);
    if (c) return c;
    c = { read: 0, write: 0 };
    if (KEY_RE.test(String(agent))) {
      for (const l of this.readFile(this.fileOf(agent, this.today))) {
        if (KINDS.includes(l.kind) && l.status !== 429 && dayOf(Date.parse(l.at)) === this.today) c[l.kind] += 1;
      }
    }
    this.counts.set(agent, c);
    return c;
  }

  // One more call of `kind` for `agent`: { ok: true } (and counted), or { ok: false, retrySeconds } when a limit is reached.
  take(agent, kind) {
    const now = this.now();
    this.roll(now);
    const limit = AGENT_LIMITS[kind];
    const c = this.countsOf(agent);
    if (c[kind] >= limit.perDay) {
      const midnight = Date.parse(`${this.today}T00:00:00.000Z`) + 86400000;
      return { ok: false, retrySeconds: Math.max(1, Math.ceil((midnight - now) / 1000)) };
    }
    const key = `${agent}|${kind}`;
    const recent = (this.minute.get(key) || []).filter((t) => now - t < 60000);
    if (recent.length >= limit.perMinute) {
      this.minute.set(key, recent);
      return { ok: false, retrySeconds: Math.max(1, Math.ceil((recent[0] + 60000 - now) / 1000)) };
    }
    recent.push(now);
    this.minute.set(key, recent);
    c[kind] += 1;
    return { ok: true };
  }

  // What `agent` has used today: { read, write }.
  usedToday(agent) {
    this.roll(this.now());
    const c = this.countsOf(agent);
    return { read: c.read, write: c.write };
  }

  // Writes one line. Only the fields named here, each a short plain value, ever reach the file.
  write(entry) {
    // Each line's time is later than the one before, so a page that ends at a time (entriesOf's `before`) never splits two
    // lines of the same millisecond.
    const now = Math.max(this.now(), this.lastAt + 1);
    this.lastAt = now;
    const text = (v, max) => (typeof v === 'string' && v ? v.slice(0, max) : null);
    const line = {
      at: new Date(now).toISOString(),
      agent: text(entry.agent, 16),
      token: text(entry.token, 32),
      method: text(entry.method, 8),
      route: text(entry.route, ROUTE_MAX),
      space: text(entry.space, 16),
      module: typeof entry.module === 'string' && MODULE_RE.test(entry.module) ? entry.module : null,
      action: text(entry.action, 140),
      request: Number.isInteger(entry.request) ? entry.request : null,
      // Chat (step 5): a post's message id (12 hex characters), or how many messages a read carried; never any text.
      message: typeof entry.message === 'string' && MESSAGE_ID_RE.test(entry.message) ? entry.message
        : Number.isInteger(entry.message) && entry.message >= 0 && entry.message <= 1000 ? entry.message : null,
      status: Number.isInteger(entry.status) ? entry.status : null,
      address: typeof entry.address === 'string' && net.isIP(entry.address) ? entry.address : null, // an IP address, never free text
      kind: KINDS.includes(entry.kind) ? entry.kind : null,
    };
    if (!line.agent || !KEY_RE.test(line.agent)) return;
    try {
      const file = this.fileOf(line.agent, dayOf(now));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${JSON.stringify(line)}\n`, { mode: 0o600 });
    } catch (err) {
      console.error(`The agents' log could not be written: ${err.message}`);
    }
  }

  // A line for a call that counts against nothing (a 429, or a 401 for one of this agent's tokens): written only when no
  // line of the same agent and status was written in the last minute. True when it was written.
  note(entry) {
    const now = this.now();
    const key = `${entry.agent}|${entry.status}`;
    const last = this.noted.get(key);
    if (last !== undefined && now - last < NOTE_MS) return false;
    this.noted.set(key, now);
    if (this.noted.size > 10000) for (const [k, t] of this.noted) if (now - t >= NOTE_MS) this.noted.delete(k);
    this.write({ ...entry, kind: null });
    return true;
  }

  // The last PAGE lines of `agent`'s, newest first, before `before` (a time in ms) when given: { entries, more }. Reads
  // the agent's own day files from the newest, and stops at the first that fills the page.
  entriesOf(agent, { before = null } = {}) {
    const lastDay = before === null ? null : dayOf(before);
    const found = [];
    for (const day of this.daysOf(agent)) {
      if (lastDay !== null && day > lastDay) continue;
      const lines = this.readFile(this.fileOf(agent, day)).filter((l) => before === null || Date.parse(l.at) < before);
      for (let i = lines.length - 1; i >= 0 && found.length <= PAGE; i -= 1) found.push(lines[i]);
      if (found.length > PAGE) break;
    }
    return { entries: found.slice(0, PAGE).map(({ agent: _a, ...rest }) => rest), more: found.length > PAGE };
  }
}

module.exports = { AgentLog, AGENT_LIMITS, refusedRoute, safeModule };
