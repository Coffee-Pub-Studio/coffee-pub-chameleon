// The set-up agent's asks and the undo records of its direct changes (documentation/plans/plan-admin-agent.md, step 2,
// "The safety model"). One file per environment, <its data folder>/agent-setup.json:
//   { asks: [{ id, agent, space, ask, person, on?, at, state, decidedBy?, decidedAt? }],
//     changes: [{ id, agent, space, change, at, before?, after?, undoneBy?, undoneAt? }] }
// An ask (`ask`: add, remove or moderator; `on` for the moderator tick) is about one person (`person`, a key) in a space the
// agent made. `state` is waiting, approved, declined or expired; a waiting ask past SETUP_ASK_DAYS reads as expired, swept or
// not. Nothing in an ask changes anything until an owner or the admin approves it (server/index.js runs the change).
// A change is `made` (the agent made the space) or `changed` (it renamed it, or changed its description or icon): `before`
// holds the fields' earlier values and `after` what the change set, so an owner can put them back. A change is kept for
// SETUP_UNDO_DAYS and then dropped, so the earlier names and descriptions are not held longer than an undo needs them.
// Keys and ids only, never a person's name; the names a change holds are the space's own, as Set up shows them.
// Every method is synchronous from its check to its write, so two answers to one ask cannot both win. Written whole each
// time (a temporary file, then a rename), private to the server's own user; a file that is there and cannot be read is
// set aside, said once, and a new one begun. Never in an owner's copy (server/environment-export.js).
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { moduleFolders } = require('./module-data');
const { SETUP_ASKS, SETUP_ASK_DAYS, SETUP_UNDO_DAYS } = require('./agent-routes');

const DAY = 24 * 3600000;
const KEPT_MS = 30 * DAY; // an answered ask is kept this long, for the agent's page
const MAX_ASKS = 5000;
const MAX_CHANGES = 5000;
const STATES = ['waiting', 'approved', 'declined', 'expired'];
const CHANGES = ['made', 'changed'];
const FIELDS = ['name', 'description', 'linkIcon'];
const ID_RE = /^[a-f0-9]{16}$/;
const KEY_RE = /^[a-z0-9]{4,16}$/;
const SPACE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const when = (v) => typeof v === 'number' && Number.isFinite(v);

class SetupError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function cleanFields(v) {
  if (!isObject(v)) return null;
  const out = {};
  for (const k of FIELDS) if (typeof v[k] === 'string') out[k] = v[k].slice(0, 400);
  return Object.keys(out).length ? out : null;
}
function cleanAsk(a) {
  if (!isObject(a) || typeof a.id !== 'string' || !ID_RE.test(a.id)) return null;
  if (typeof a.agent !== 'string' || !KEY_RE.test(a.agent) || typeof a.person !== 'string' || !KEY_RE.test(a.person)) return null;
  if (typeof a.space !== 'string' || !SPACE_RE.test(a.space) || !SETUP_ASKS.includes(a.ask) || !STATES.includes(a.state) || !when(a.at)) return null;
  if (a.ask === 'moderator' && typeof a.on !== 'boolean') return null;
  const out = { id: a.id, agent: a.agent, space: a.space, ask: a.ask, person: a.person, ...(a.ask === 'moderator' ? { on: a.on } : {}), at: a.at, state: a.state };
  if (typeof a.decidedBy === 'string' && KEY_RE.test(a.decidedBy)) out.decidedBy = a.decidedBy;
  if (when(a.decidedAt)) out.decidedAt = a.decidedAt;
  return out;
}
function cleanChange(c) {
  if (!isObject(c) || typeof c.id !== 'string' || !ID_RE.test(c.id)) return null;
  if (typeof c.agent !== 'string' || !KEY_RE.test(c.agent) || typeof c.space !== 'string' || !SPACE_RE.test(c.space)) return null;
  if (!CHANGES.includes(c.change) || !when(c.at)) return null;
  const out = { id: c.id, agent: c.agent, space: c.space, change: c.change, at: c.at };
  if (c.change === 'changed') {
    const before = cleanFields(c.before);
    const after = cleanFields(c.after);
    if (!before || !after) return null;
    out.before = before;
    out.after = after;
  }
  if (typeof c.undoneBy === 'string' && KEY_RE.test(c.undoneBy)) out.undoneBy = c.undoneBy;
  if (when(c.undoneAt)) out.undoneAt = c.undoneAt;
  return out;
}

class SetupRecords {
  constructor(dir, { log = console.warn } = {}) {
    this.dir = dir;
    this.file = path.join(dir, 'agent-setup.json');
    this.log = log;
    this.asks = [];
    this.changes = [];
    this.load();
  }

  load() {
    let text;
    try { text = fs.readFileSync(this.file, 'utf8'); } catch (err) {
      if (err.code === 'ENOENT') return;
      text = null;
    }
    let raw = null;
    if (text !== null) { try { raw = JSON.parse(text); } catch { raw = null; } }
    if (!isObject(raw) || (raw.asks !== undefined && !Array.isArray(raw.asks)) || (raw.changes !== undefined && !Array.isArray(raw.changes))) {
      const aside = path.join(this.dir, `agent-setup.unreadable-${Date.now()}.json`);
      try { fs.renameSync(this.file, aside); } catch { throw new Error("The set-up agents' asks file could not be read or moved out of the way."); }
      this.log(`${this.file} could not be read as set-up agents' asks, so it was kept as ${aside} and a new one begun.`);
      return;
    }
    const seen = new Set();
    for (const list of ['asks', 'changes']) {
      for (const r of raw[list] || []) {
        const kept = list === 'asks' ? cleanAsk(r) : cleanChange(r);
        if (!kept || seen.has(kept.id)) continue;
        seen.add(kept.id);
        this[list].push(kept);
      }
    }
  }

  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ asks: this.asks, changes: this.changes }, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, this.file);
  }

  // Writes; when the write fails the memory is put back, so nothing is told that the disk does not hold.
  commit(undo) {
    try { this.save(); } catch (err) { undo(); throw err; }
  }

  newId() {
    let id;
    do id = crypto.randomBytes(8).toString('hex');
    while (this.asks.some((a) => a.id === id) || this.changes.some((c) => c.id === id));
    return id;
  }

  // --- asks --------------------------------------------------------------------------------------------------------

  endsAt(a) { return a.at + SETUP_ASK_DAYS * DAY; }

  stateOf(a, now = Date.now()) {
    if (a.state !== 'waiting') return a.state;
    return now >= this.endsAt(a) ? 'expired' : 'waiting';
  }

  // Marks what has run out, drops old answers and changes past their undo. Returns whether anything changed.
  sweep(now = Date.now()) {
    let changed = false;
    for (const a of this.asks) {
      if (a.state === 'waiting' && this.stateOf(a, now) === 'expired') { a.state = 'expired'; a.decidedAt = this.endsAt(a); changed = true; }
    }
    const asks = this.asks.filter((a) => a.state === 'waiting' || now - (a.decidedAt || a.at) < KEPT_MS);
    const changes = this.changes.filter((c) => now - c.at < SETUP_UNDO_DAYS * DAY);
    if (asks.length !== this.asks.length || changes.length !== this.changes.length) changed = true;
    this.asks = asks;
    this.changes = changes;
    return changed;
  }

  tidy(now = Date.now()) {
    if (!this.sweep(now)) return;
    try { this.save(); } catch (err) { this.log(`The set-up agents' asks could not be written: ${err.message}`); }
  }

  // The asks waiting for an answer from `agent`, oldest first.
  waitingOf(agent, now = Date.now()) {
    return this.asks.filter((a) => a.agent === agent && this.stateOf(a, now) === 'waiting').sort((a, b) => a.at - b.at);
  }

  // A new ask: { agent, space, ask, person, on? }. Throws SetupError 409 when the same ask is waiting, 429 when `cap` are
  // waiting already (with `retrySeconds`, until the oldest runs out), 503 when the file is full. Returns a copy.
  addAsk({ agent, space, ask, person, on }, cap, now = Date.now()) {
    this.tidy(now);
    const waiting = this.waitingOf(agent, now);
    const same = waiting.find((a) => a.space === space && a.ask === ask && a.person === person);
    if (same) throw new SetupError('This agent has asked that already. Wait for an answer.', 409);
    if (waiting.length >= cap) {
      const err = new SetupError('The agent has done as much as it may for now.', 429);
      err.retrySeconds = Math.max(1, Math.ceil((this.endsAt(waiting[0]) - now) / 1000));
      throw err;
    }
    if (this.asks.length >= MAX_ASKS) throw new SetupError('Asks cannot be taken right now. Tell whoever runs this server.', 503);
    const a = { id: this.newId(), agent, space, ask, person, ...(ask === 'moderator' ? { on: on === true } : {}), at: now, state: 'waiting' };
    this.asks.push(a);
    this.commit(() => { this.asks.pop(); });
    return { ...a };
  }

  ask(id) {
    const a = this.asks.find((x) => x.id === id);
    return a ? { ...a, state: this.stateOf(a) } : null;
  }

  // Every ask of `agent` kept, newest first, with its state as it reads now.
  asksOf(agent, now = Date.now()) {
    this.tidy(now);
    return this.asks.filter((a) => a.agent === agent).sort((a, b) => b.at - a.at).map((a) => ({ ...a, state: this.stateOf(a, now) }));
  }

  // Answers an ask: `decision` approve or decline, `by` the owner's key. `apply()` runs the change for an approval, in the
  // same step (nothing awaits between them), before anything is written; it throws to refuse, and then nothing changes.
  // The same answer again changes nothing ({ changed: false }); the other answer, or an ask that is over, is a 409.
  decide(id, agent, decision, by, apply = () => {}, now = Date.now()) {
    const a = this.asks.find((x) => x.id === id && x.agent === agent);
    if (!a) throw new SetupError('No such ask.', 404);
    const want = decision === 'approve' ? 'approved' : 'declined';
    if (a.state === want) return { ask: { ...a }, changed: false };
    if (this.stateOf(a, now) === 'expired') {
      this.expire((x) => x === a, now);
      throw new SetupError('That ask has run out.', 409);
    }
    if (a.state !== 'waiting') throw new SetupError('That ask was answered already.', 409);
    if (want === 'approved') apply(a);
    const before = { ...a };
    a.state = want;
    a.decidedBy = by;
    a.decidedAt = now;
    this.commit(() => { Object.keys(a).forEach((k) => delete a[k]); Object.assign(a, before); });
    return { ask: { ...a }, changed: true };
  }

  // Ends every waiting ask `which(ask)` picks (a kill switch, a space gone, an ask that can no longer be done). Returns how
  // many ended.
  expire(which, now = Date.now()) {
    let n = 0;
    for (const a of this.asks) if (a.state === 'waiting' && which(a)) { a.state = 'expired'; a.decidedAt = now; n += 1; }
    if (n) { try { this.save(); } catch (err) { this.log(`The set-up agents' asks could not be written: ${err.message}`); } }
    return n;
  }

  // --- undo records ------------------------------------------------------------------------------------------------

  // A direct change by the agent: { agent, space, change: 'made' } or { agent, space, change: 'changed', before, after }.
  // Never throws: a record that cannot be kept is said once in the server's log, and the change stands.
  noteChange({ agent, space, change, before, after }, now = Date.now()) {
    this.tidy(now);
    if (this.changes.length >= MAX_CHANGES) { this.log('A set-up agent\'s change could not be kept for an undo: too many are kept.'); return null; }
    const c = { id: this.newId(), agent, space, change, at: now, ...(change === 'changed' ? { before: cleanFields(before) || {}, after: cleanFields(after) || {} } : {}) };
    this.changes.push(c);
    try { this.save(); } catch (err) { this.changes.pop(); this.log(`A set-up agent's change could not be kept for an undo: ${err.message}`); return null; }
    return { ...c };
  }

  // Every change of `agent` still kept (SETUP_UNDO_DAYS), newest first.
  changesOf(agent, now = Date.now()) {
    this.tidy(now);
    return this.changes.filter((c) => c.agent === agent).sort((a, b) => b.at - a.at).map((c) => ({ ...c }));
  }

  // Undoes a change: `apply(change)` puts it back, in the same step, and throws to refuse. 404 for no such change (or one
  // past its days), 409 for one undone already.
  undo(id, agent, by, apply, now = Date.now()) {
    this.tidy(now);
    const c = this.changes.find((x) => x.id === id && x.agent === agent);
    if (!c) throw new SetupError(`No such change. A change can be undone for ${SETUP_UNDO_DAYS} days.`, 404);
    if (c.undoneAt) throw new SetupError('That was undone already.', 409);
    apply(c);
    c.undoneBy = by;
    c.undoneAt = now;
    try { this.save(); } catch (err) { this.log(`An undo could not be written: ${err.message}`); }
    return { ...c };
  }

  // A deleted space takes its asks and changes with it. Returns how many went.
  forgetSpace(space) {
    const n = this.asks.length + this.changes.length;
    this.asks = this.asks.filter((a) => a.space !== space);
    this.changes = this.changes.filter((c) => c.space !== space);
    const gone = n - this.asks.length - this.changes.length;
    if (gone) this.save();
    return gone;
  }

  // A deleted agent takes its asks and changes with it.
  forgetAgent(agent) {
    const n = this.asks.length + this.changes.length;
    this.asks = this.asks.filter((a) => a.agent !== agent);
    this.changes = this.changes.filter((c) => c.agent !== agent);
    if (n !== this.asks.length + this.changes.length) this.save();
  }
}

// Whether anybody but `agent` has written in the space (plan-admin-agent.md: "Undo of a made space erases it, only while
// nobody but the agent has written in it"). Read from what is kept for the space, so nothing can be lost by the erase: a
// module record by anyone else (the template's starter content is the agent's own), a Clear held for an undo, an upload,
// a library file, a chat message (the set-up agent never posts), or a shared layout. `env` is the environment.
function writtenByOthers(env, spaceId, agent) {
  const scope = `space:${spaceId}`;
  for (const id of moduleFolders(env.moduleData.dir)) {
    if (env.moduleData.list(id, scope).some((e) => e.by !== agent)) return true;
    if (env.moduleHolds.read(id, scope)) return true;
    const uploads = path.join(env.moduleUploads.dir, id, 'uploads', `space-${spaceId}`);
    try { if (fs.readdirSync(uploads).length) return true; } catch { /* none */ }
  }
  for (const id of env.vault.libraryModules()) if (env.vault.list(id, spaceId).length) return true;
  if (env.chatHistory.holdsAny(spaceId)) return true;
  const layouts = env.store.layouts;
  if (layouts.listOf(spaceId, null).length) return true; // a shared layout
  if (Object.keys(layouts.spaces?.[spaceId]?.people || {}).some((key) => layouts.listOf(spaceId, key).length)) return true; // a person's own
  return false;
}

module.exports = { SetupRecords, SetupError, writtenByOthers, STATES };
