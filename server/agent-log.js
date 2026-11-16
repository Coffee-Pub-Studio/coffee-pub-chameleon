'use strict';

// What agents did, and how much more they may do (documentation/plans/plan-agent-access.md, "Limits" and "The log").
// One environment's own: DATA_DIR/agent-log.jsonl, one line a call an agent's token was accepted for,
// { at, agent, token, method, route, space, action, request, message, status, address, kind }:
//   token   the token's id (server/tokens.js), never the token;
//   route   the gate's route pattern ("/api/spaces/:id/action"), never the path asked for, so no key or token in an
//           address lands here; "(refused)" for a route the gate does not let an agent use;
//   kind    "read" or "write", what the call counted against.
// Never a request's body, a chat message's text or an object's content. Lines older than 30 days are dropped on start
// and once a day after.
//
// The limits, per agent: 60 reads and 20 writes a minute, 3,000 reads and 300 writes a (UTC) day. The minute's counts are
// in memory only (a restart clears them, which costs at most one more minute's worth). The day's counts are read back
// from the log on start, so a restart does not reset them: every line counts except a 429 (a call over a limit counts
// against nothing).

const fs = require('fs');
const path = require('path');
const { deepFreeze } = require('./deep-freeze');

const AGENT_LIMITS = deepFreeze({
  read: { perMinute: 60, perDay: 3000 },
  write: { perMinute: 20, perDay: 300 },
});
const KEEP_DAYS = 30;
const PAGE = 100;
const KINDS = ['read', 'write'];
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

class AgentLog {
  constructor(dataDir, { now = Date.now } = {}) {
    this.file = path.join(dataDir, 'agent-log.jsonl');
    this.now = now;
    this.minute = new Map(); // "<agent>|<kind>" -> call times in the last minute
    this.today = dayOf(this.now());
    this.counts = new Map(); // agent key -> { read, write } today
    this.prunedOn = null;
    this.lastAt = 0;
    this.prune(true);
  }

  // Every line of the file that reads as a line of this log, oldest first; unreadable lines are passed over.
  lines() {
    let text;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch {
      return [];
    }
    const out = [];
    for (const raw of text.split('\n')) {
      if (!raw) continue;
      let line;
      try { line = JSON.parse(raw); } catch { continue; }
      if (!line || typeof line !== 'object' || Array.isArray(line) || typeof line.at !== 'string' || typeof line.agent !== 'string') continue;
      if (!Number.isFinite(Date.parse(line.at))) continue;
      out.push(line);
    }
    return out;
  }

  // Drops the lines older than KEEP_DAYS (rewriting the file only when some go) and, on start, counts today's calls again.
  prune(counting = false) {
    const now = this.now();
    this.prunedOn = dayOf(now);
    const all = this.lines();
    const since = now - KEEP_DAYS * 86400000;
    const kept = all.filter((l) => Date.parse(l.at) >= since);
    if (counting) {
      this.today = dayOf(now);
      this.counts = new Map();
      for (const l of kept) {
        this.lastAt = Math.max(this.lastAt, Date.parse(l.at));
        if (dayOf(Date.parse(l.at)) !== this.today || !KINDS.includes(l.kind) || l.status === 429) continue;
        const c = this.counts.get(l.agent) || { read: 0, write: 0 };
        c[l.kind] += 1;
        this.counts.set(l.agent, c);
      }
    }
    if (kept.length === all.length) return;
    try {
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, kept.map((l) => `${JSON.stringify(l)}\n`).join(''), { mode: 0o600 });
      fs.chmodSync(tmp, 0o600);
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error(`The agents' log could not be trimmed: ${err.message}`);
    }
  }

  roll(now) {
    const day = dayOf(now);
    if (day !== this.today) {
      this.today = day;
      this.counts = new Map();
    }
  }

  // One more call of `kind` for `agent`: { ok: true } (and counted), or { ok: false, retrySeconds } when a limit is reached.
  take(agent, kind) {
    const now = this.now();
    this.roll(now);
    const limit = AGENT_LIMITS[kind];
    const c = this.counts.get(agent) || { read: 0, write: 0 };
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
    this.counts.set(agent, c);
    return { ok: true };
  }

  // What `agent` has used today: { read, write }.
  usedToday(agent) {
    this.roll(this.now());
    const c = this.counts.get(agent);
    return { read: c ? c.read : 0, write: c ? c.write : 0 };
  }

  // Writes one line. Only the fields named here, each a short plain value, ever reach the file.
  write(entry) {
    // Each line's time is later than the one before, so a page that ends at a time (entriesOf's `before`) never splits two
    // lines of the same millisecond.
    const now = Math.max(this.now(), (this.lastAt || 0) + 1);
    this.lastAt = now;
    if (this.prunedOn !== dayOf(now)) this.prune();
    const text = (v, max) => (typeof v === 'string' && v ? v.slice(0, max) : null);
    const line = {
      at: new Date(now).toISOString(),
      agent: text(entry.agent, 16),
      token: text(entry.token, 32),
      method: text(entry.method, 8),
      route: text(entry.route, 80),
      space: text(entry.space, 16),
      action: text(entry.action, 140),
      request: Number.isInteger(entry.request) ? entry.request : null,
      message: text(entry.message, 40),
      status: Number.isInteger(entry.status) ? entry.status : null,
      address: text(entry.address, 64),
      kind: KINDS.includes(entry.kind) ? entry.kind : null,
    };
    if (!line.agent) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.appendFileSync(this.file, `${JSON.stringify(line)}\n`, { mode: 0o600 });
    } catch (err) {
      console.error(`The agents' log could not be written: ${err.message}`);
    }
  }

  // The last PAGE lines of `agent`'s, newest first, before `before` (a time in ms) when given: { entries, more }.
  entriesOf(agent, { before = null } = {}) {
    const mine = this.lines().filter((l) => l.agent === agent && (before === null || Date.parse(l.at) < before));
    const entries = mine.slice(-PAGE).reverse().map(({ agent: _a, ...rest }) => rest);
    return { entries, more: mine.length > PAGE };
  }
}

module.exports = { AgentLog, AGENT_LIMITS };
