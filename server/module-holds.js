// Clear's Undo: what a Clear (DELETE /api/modules/:id/data) took from one module in one scope is held here for 30 seconds,
// plus a few seconds' grace for a slow network, instead of going for good. The values leave the module's data at once; the
// uploaded files they name stay on disk, and what the clear would do to other modules (their dated copies, their pointers)
// waits. Undo (POST .../data/restore) takes the hold back whole; when the time is over, onExpire finishes the clear.
//
// One hold per module and scope (a space, the environment, one person): a second Clear there is refused while it waits
// (index.js says how long). Holds live on disk, DATA_DIR/modules/<id>/trash/<scope>.json (environment.json, space-<id>.json,
// person-<key>.json), so a page closed mid-undo or a restart loses nothing: the server re-arms each hold when it starts,
// and finishes those whose time ran out while it was down; a hold file it can't read is logged and set aside as
// <name>.bad, so nothing waits on it for ever. Only the timers, and what became of recent tokens (so a refused Undo
// can say why), are in memory. A hold is never bigger than
// what the module could store (its data cap, 5 MB), and holds go in the order they were made.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { moduleFolders } = require('./module-data');

const HOLD_SECONDS = 30;
const GRACE_MS = 5000;
const SPACE_RE = /^[a-z0-9]{4,16}$/;
const PERSON_RE = /^[a-z0-9]{4,40}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const KEPT_ENDS = 500; // how many finished tokens are remembered, for why()

function nameOfScope(scopeKey) {
  if (scopeKey === 'environment') return 'environment.json';
  const s = /^space:(.+)$/.exec(scopeKey);
  if (s && SPACE_RE.test(s[1])) return `space-${s[1]}.json`;
  const p = /^person:(.+)$/.exec(scopeKey);
  if (p && PERSON_RE.test(p[1])) return `person-${p[1]}.json`;
  return null;
}
function scopeOfName(name) {
  if (name === 'environment.json') return 'environment';
  const s = /^space-(.+)\.json$/.exec(name);
  if (s && SPACE_RE.test(s[1])) return `space:${s[1]}`;
  const p = /^person-(.+)\.json$/.exec(name);
  if (p && PERSON_RE.test(p[1])) return `person:${p[1]}`;
  return null;
}

class ModuleHolds {
  constructor(modulesDir, { holdSeconds = HOLD_SECONDS, graceMs = GRACE_MS, log = console.error } = {}) {
    this.dir = modulesDir;
    this.seconds = holdSeconds; // how long a Clear can be undone (CLEAR_UNDO_SECONDS)
    this.holdMs = holdSeconds * 1000;
    this.graceMs = graceMs;
    this.log = log;
    this.timers = new Map(); // "id|scopeKey" -> timeout
    this.ends = new Map(); // "id|scopeKey|token" -> 'undone' or 'over': what became of a hold, newest last
    this.stopped = false;
    // Set by the server: runIn(fn) runs a timer's work in this environment; onExpire(hold) finishes a clear whose time is over.
    this.runIn = (fn) => fn();
    this.onExpire = null;
    // Set by the server: onKeyedExpire(hold) finishes an agent's change whose undo time is over (its files).
    this.onKeyedExpire = null;
    this.sweep();
    // Keyed holds past their time are swept once the server has set onKeyedExpire (it calls sweepKeyed), then hourly.
    this.keyedTimer = setInterval(() => { if (!this.stopped) this.runIn(() => this.sweepKeyed()); }, 3600000);
    if (this.keyedTimer.unref) this.keyedTimer.unref();
  }

  fileFor(id, scopeKey) {
    const name = ID_RE.test(String(id)) ? nameOfScope(scopeKey) : null;
    return name ? path.join(this.dir, id, 'trash', name) : null;
  }

  read(id, scopeKey) {
    const file = this.fileFor(id, scopeKey);
    if (!file) return null;
    try {
      const h = JSON.parse(fs.readFileSync(file, 'utf8'));
      return h && typeof h === 'object' && Array.isArray(h.items) ? { ...h, files: Array.isArray(h.files) ? h.files : [] } : null;
    } catch {
      return null;
    }
  }

  // The hold here while its time runs (the grace included), else null; one whose time is over is finished now.
  peek(id, scopeKey) {
    const h = this.read(id, scopeKey);
    if (!h) return null;
    if (Date.parse(h.expiresAt) <= Date.now()) { this.expire(id, scopeKey); return null; }
    return h;
  }

  // Holds what a clear took: items ({ key, value, version, updatedAt, by }, as stored), the upload ids they name, who
  // cleared and their zone. Never over a hold still waiting here (the caller refuses that clear: peek first); one whose
  // time is over is finished first. Answers { token, undoUntil, expiresAt, seconds }.
  hold(id, scopeKey, { items, files = [], by = '', tz = null }) {
    const file = this.fileFor(id, scopeKey);
    if (!file) throw new Error('bad scope for a hold');
    if (this.peek(id, scopeKey)) throw new Error('a hold is already waiting here');
    const now = Date.now();
    const h = {
      token: crypto.randomBytes(16).toString('hex'),
      module: id,
      scopeKey,
      by: String(by).slice(0, 40),
      tz: typeof tz === 'string' ? tz.slice(0, 64) : null,
      at: new Date(now).toISOString(),
      undoUntil: new Date(now + this.holdMs).toISOString(),
      expiresAt: new Date(now + this.holdMs + this.graceMs).toISOString(),
      files: [...new Set(files)],
      items,
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(h));
    fs.renameSync(`${file}.tmp`, file);
    this.arm(id, scopeKey, now + this.holdMs + this.graceMs);
    return { token: h.token, undoUntil: h.undoUntil, expiresAt: h.expiresAt, seconds: this.seconds };
  }

  // The hold, taken out of here for an Undo, when `token` is the one its clear answered and its time is not over; else null.
  take(id, scopeKey, token) {
    const h = this.peek(id, scopeKey);
    if (!h || typeof token !== 'string' || token !== h.token) return null;
    this.drop(id, scopeKey, 'undone');
    return h;
  }

  // Why `token` no longer undoes anything here: 'undone' (its Undo was done), 'replaced' (another clear's hold is here
  // now) or 'over' (its time ran out, or it is not known: a restart forgets what became of a token).
  why(id, scopeKey, token) {
    const end = this.ends.get(`${id}|${scopeKey}|${token}`);
    if (end) return end;
    const h = this.read(id, scopeKey);
    return h && h.token !== token ? 'replaced' : 'over';
  }

  noteEnd(id, scopeKey, token, end) {
    if (typeof token !== 'string' || !token) return;
    const key = `${id}|${scopeKey}|${token}`;
    this.ends.delete(key);
    this.ends.set(key, end);
    while (this.ends.size > KEPT_ENDS) this.ends.delete(this.ends.keys().next().value);
  }

  // Whether a hold here keeps this upload (the upload sweeps and a file's delete leave it alone).
  holdsFile(id, scopeKey, fid) {
    const h = this.read(id, scopeKey);
    return Boolean(h && h.files.includes(fid)) || this.keyedHoldsFile(id, scopeKey, fid);
  }

  // The hold goes, and the clear is finished (onExpire): its files, what other modules kept of its objects.
  expire(id, scopeKey) {
    const h = this.read(id, scopeKey);
    this.drop(id, scopeKey, 'over');
    if (h && typeof this.onExpire === 'function') {
      try { this.onExpire(h); } catch (err) { console.error(`A cleared ${id} could not be finished: ${err.stack || err.message}`); }
    }
  }

  // The hold goes, unfinished; `end` ('undone', 'over') is remembered against its token for why().
  drop(id, scopeKey, end = null) {
    const key = `${id}|${scopeKey}`;
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    if (end) { const h = this.read(id, scopeKey); if (h) this.noteEnd(id, scopeKey, h.token, end); }
    const file = this.fileFor(id, scopeKey);
    if (file) { fs.rmSync(file, { force: true }); fs.rmSync(`${file}.tmp`, { force: true }); }
  }

  // Every timer stops (the environment is set aside: deleted, or replaced by a backup). The holds stay on disk as they
  // are; whoever reads this folder next (a new ModuleHolds) finishes them.
  stop() {
    this.stopped = true;
    clearInterval(this.keyedTimer);
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  arm(id, scopeKey, at) {
    if (this.stopped) return;
    const key = `${id}|${scopeKey}`;
    clearTimeout(this.timers.get(key));
    const t = setTimeout(() => {
      this.timers.delete(key);
      if (this.stopped) return;
      this.runIn(() => { if (this.read(id, scopeKey)) this.expire(id, scopeKey); });
    }, Math.max(0, at - Date.now()));
    if (t.unref) t.unref();
    this.timers.set(key, t);
  }

  // Every module's holds as found on disk: each is armed for the time it has left, or for now when that is over. One
  // that can't be read is logged and renamed <name>.bad: it is never finished, and the files it may name are left.
  sweep() {
    for (const id of moduleFolders(this.dir)) {
      let names = [];
      try { names = fs.readdirSync(path.join(this.dir, id, 'trash')); } catch { continue; }
      for (const n of names) {
        if (n.endsWith('.json.tmp') && scopeOfName(n.slice(0, -4))) { fs.rmSync(path.join(this.dir, id, 'trash', n), { force: true }); continue; }
        const scopeKey = scopeOfName(n);
        if (!scopeKey) continue;
        const h = this.read(id, scopeKey);
        if (!h) { this.quarantine(id, n); continue; }
        this.arm(id, scopeKey, Date.parse(h.expiresAt) || 0);
      }
    }
  }

  quarantine(id, name) {
    const file = path.join(this.dir, id, 'trash', name);
    try {
      fs.renameSync(file, `${file}.bad`);
      this.log(`A held clear of ${id} (${name}) could not be read, so it was renamed ${name}.bad. What it took does not come back, and any files it named are left where they are.`);
    } catch (err) {
      this.log(`A held clear of ${id} (${name}) could not be read or renamed: ${err.message}`);
    }
  }

  // Every hold of one module, finished now (the module is being removed or turned off).
  expireModule(id) {
    let names = [];
    try { names = fs.readdirSync(path.join(this.dir, id, 'trash')); } catch { return; }
    for (const n of names) {
      const scopeKey = scopeOfName(n);
      if (scopeKey) this.expire(id, scopeKey);
    }
  }

  // A deleted space's holds go with it, unfinished (its data, files and links go by their own steps), its keyed holds too.
  // Answers how many.
  forgetSpace(spaceId) {
    if (!SPACE_RE.test(spaceId)) return 0;
    let gone = 0;
    for (const id of moduleFolders(this.dir)) {
      if (!this.fileFor(id, `space:${spaceId}`)) continue;
      if (fs.existsSync(this.fileFor(id, `space:${spaceId}`))) gone += 1;
      this.drop(id, `space:${spaceId}`);
    }
    for (const h of this.keyedList()) {
      if (h.scopeKey !== `space:${spaceId}`) continue;
      this.dropKeyed(h.module, h.id);
      gone += 1;
    }
    return gone;
  }

  // --- keyed holds (plan-agent-edit-delete.md, "The contract", 4) ---------------------------------------------------
  // What one agent's change to one object took, held for its Undo for AGENT_UNDO_DAYS: the object's value before an edit,
  // or the object and what went with it (its children, the holders in other modules that object-sync removed or marked)
  // before a delete. One file per change, DATA_DIR/modules/<id>/trash/agent/<change id>.json:
  //   { id, module, scopeKey, key, kind: 'edited' | 'deleted', by, tz, at, expiresAt, items: [{ key, value, version,
  //     updatedAt, by }], holders: [{ module, scopeKey, key, value, version, updatedAt, by, removed, links? }], files: [] }
  // Written before the change (a temporary file, then a rename), so a stop between the two leaves the object as it was and
  // an Undo with nothing to undo; it survives a restart; one that can't be read is set aside as <name>.bad and said once.
  // A hold past its time goes (onKeyedExpire is told, so the files only it kept go too). A hold bigger than KEYED_MAX_BYTES
  // is not kept (holdKeyed answers null: the change can't be undone); past KEYED_TOTAL_BYTES in the environment, the oldest
  // go first.

  keyedFile(id, changeId) {
    return ID_RE.test(String(id)) && KEYED_ID_RE.test(String(changeId)) ? path.join(this.dir, id, 'trash', 'agent', `${changeId}.json`) : null;
  }

  // Holds what a change will take. `days` is how long. Answers { bytes } when held, null when too big to keep.
  holdKeyed(id, changeId, { scopeKey, key, kind, items, holders = [], files = [], by = '', tz = null, days }, now = Date.now()) {
    const file = this.keyedFile(id, changeId);
    if (!file || !nameOfScope(scopeKey)) throw new Error('bad place for a hold');
    const h = {
      id: changeId,
      module: id,
      scopeKey,
      key: String(key),
      kind,
      by: String(by).slice(0, 40),
      tz: typeof tz === 'string' ? tz.slice(0, 64) : null,
      at: new Date(now).toISOString(),
      expiresAt: new Date(now + days * 24 * 3600000).toISOString(),
      files: [...new Set(files)],
      items,
      holders,
    };
    const text = JSON.stringify(h);
    if (Buffer.byteLength(text) > KEYED_MAX_BYTES) return null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, text, { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
    this.trimKeyed(changeId);
    return { bytes: Buffer.byteLength(text) };
  }

  // The keyed hold of a change, or null (none, past its time, or unreadable).
  readKeyed(id, changeId, now = Date.now()) {
    const file = this.keyedFile(id, changeId);
    if (!file) return null;
    let h;
    try { h = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) {
      if (err.code !== 'ENOENT') this.quarantineKeyed(file);
      return null;
    }
    if (!h || typeof h !== 'object' || !Array.isArray(h.items) || h.id !== changeId || !nameOfScope(h.scopeKey)) { this.quarantineKeyed(file); return null; }
    if (!(Date.parse(h.expiresAt) > now)) { this.expireKeyed(id, changeId, h); return null; }
    return { ...h, files: Array.isArray(h.files) ? h.files : [], holders: Array.isArray(h.holders) ? h.holders : [] };
  }

  // The hold goes (an Undo took it back, or its change went), and nothing more is done.
  dropKeyed(id, changeId) {
    const file = this.keyedFile(id, changeId);
    if (file) { fs.rmSync(file, { force: true }); fs.rmSync(`${file}.tmp`, { force: true }); }
  }

  // The hold goes because its time is over: onKeyedExpire(hold) finishes what it kept waiting (its files).
  expireKeyed(id, changeId, h) {
    this.dropKeyed(id, changeId);
    if (h && typeof this.onKeyedExpire === 'function') {
      try { this.onKeyedExpire(h); } catch (err) { this.log(`A held change of ${id} could not be finished: ${err.message}`); }
    }
  }

  quarantineKeyed(file) {
    try {
      fs.renameSync(file, `${file}.bad`);
      this.log(`A held agent's change (${file}) could not be read, so it was renamed .bad. It can't be undone, and any files it named are left where they are.`);
    } catch (err) {
      this.log(`A held agent's change (${file}) could not be read or renamed: ${err.message}`);
    }
  }

  // Every keyed hold on disk, as { module, id, scopeKey, at, expiresAt, bytes, files }, oldest first; those past their
  // time go on the way (onKeyedExpire), unreadable ones are set aside.
  keyedList(now = Date.now()) {
    const out = [];
    for (const id of moduleFolders(this.dir)) {
      const dir = path.join(this.dir, id, 'trash', 'agent');
      let names = [];
      try { names = fs.readdirSync(dir); } catch { continue; }
      for (const n of names) {
        if (n.endsWith('.json.tmp')) { fs.rmSync(path.join(dir, n), { force: true }); continue; }
        const m = /^([a-f0-9]{16})\.json$/.exec(n);
        if (!m) continue;
        let bytes = 0;
        try { bytes = fs.statSync(path.join(dir, n)).size; } catch { continue; }
        const h = this.readKeyed(id, m[1], now);
        if (h) out.push({ module: id, id: m[1], scopeKey: h.scopeKey, at: h.at, expiresAt: h.expiresAt, bytes, files: h.files });
      }
    }
    return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  }

  // Past KEYED_TOTAL_BYTES, the oldest holds go (never `keep`, the one just written), unfinished: their changes then read
  // as too old to undo, and their files go as when a hold runs out.
  trimKeyed(keep = null) {
    const list = this.keyedList();
    let total = list.reduce((n, h) => n + h.bytes, 0);
    for (const h of list) {
      if (total <= KEYED_TOTAL_BYTES) break;
      if (h.id === keep) continue;
      const held = this.readKeyed(h.module, h.id);
      this.expireKeyed(h.module, h.id, held);
      total -= h.bytes;
    }
  }

  // Whether a keyed hold in this place keeps this upload (a deleted object's file waits for its Undo).
  keyedHoldsFile(id, scopeKey, fid) {
    return this.keyedList().some((h) => h.module === id && h.scopeKey === scopeKey && h.files.includes(fid));
  }

  // Every keyed hold past its time goes (at start, and once an hour while the server runs).
  sweepKeyed(now = Date.now()) {
    this.keyedList(now);
  }
}

// A keyed hold's file name is its change's id (server/agent-records.js); the caps on what is held (the plan's 256 KB a
// change, 50 MB an environment).
const KEYED_ID_RE = /^[a-f0-9]{16}$/;
const KEYED_MAX_BYTES = 256 * 1024;
const KEYED_TOTAL_BYTES = 50 * 1024 * 1024;

module.exports = { ModuleHolds, HOLD_SECONDS, KEYED_MAX_BYTES, KEYED_TOTAL_BYTES };
