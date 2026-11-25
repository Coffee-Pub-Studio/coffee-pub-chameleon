// Agents' asks and the undo records of their changes, one store for both kinds of agent (documentation/plans/
// plan-agent-edit-delete.md, "The contract", 4; the set-up agent's half is plan-admin-agent.md, step 2). One file per
// environment, <its data folder>/agent-records.json:
//   { asks: [{ id, agent, space, ask, at, state, decidedBy?, decidedAt?,
//              person, on?                                  (a set-up ask: add, remove, moderator)
//              object: { module, kind, id, scope, key }, version, reason? }], (an ordinary agent's ask: delete)
//     changes: [{ id, agent, space, change, at, undoneBy?, undoneAt?,
//                 before?, after?                           (a set-up change: made, changed)
//                 object: { module, kind, id, scope, key }, versionAfter, held, request?, ask? }] }  (added, edited, deleted)
// A set-up ask (`ask`: add, remove or moderator; `on` for the moderator tick) is about one person (`person`, a key) in a space
// the agent made. A delete ask (`ask`: delete) is about one object at one version (the key's version when it was asked), with
// the agent's own short reason; keys and ids only, never the object's content. `state` is waiting, approved, declined,
// expired or undone (an approved delete a person undid); a waiting ask past AGENT_ASK_DAYS reads as expired, swept or not. Nothing in an ask changes anything until a person approves it
// (server/index.js runs the change).
// A set-up change is `made` (the agent made the space) or `changed` (it renamed it, or changed its description or icon):
// `before` holds the fields' earlier values and `after` what the change set. An object change is `added`, `edited` or
// `deleted`: the object's pointer and stored key, its version just after the change (`versionAfter`, so an Undo is made only
// while nothing changed since), and whether its earlier value is held for the Undo (`held`): the value itself is never here,
// it is held beside the module's data (server/module-holds.js, keyed holds), named by the change's id. `request` is the bus
// request it was made for; `ask` the delete ask that approved it. A change is kept for AGENT_UNDO_DAYS and then dropped
// (`onDrop(change)` is told, so its hold goes with it).
// Keys and ids only, never a person's name or an object's content; the names a set-up change holds are the space's own, as
// Set up shows them.
// Every method is synchronous from its check to its write, so two answers to one ask cannot both win. Written whole each
// time (a temporary file, then a rename), private to the server's own user; a file that is there and cannot be read is
// set aside, said once, and a new one begun. Never in an owner's copy (server/environment-export.js).
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { moduleFolders } = require('./module-data');
const { SETUP_ASKS, AGENT_ASK_DAYS, AGENT_UNDO_DAYS } = require('./agent-routes');

const DAY = 24 * 3600000;
const KEPT_MS = 30 * DAY; // an answered ask is kept this long, for the agent's page
const MAX_ASKS = 5000;
const MAX_CHANGES = 5000;
const FILE = 'agent-records.json';
const STATES = ['waiting', 'approved', 'declined', 'expired', 'undone'];
const ASKS = [...SETUP_ASKS, 'delete'];
const SETUP_CHANGE_KINDS = ['made', 'changed'];
const OBJECT_CHANGES = ['added', 'edited', 'deleted'];
const CHANGES = [...SETUP_CHANGE_KINDS, ...OBJECT_CHANGES];
const FIELDS = ['name', 'description', 'linkIcon'];
const REASON_MAX = 200;
const ID_RE = /^[a-f0-9]{16}$/;
const KEY_RE = /^[a-z0-9]{4,16}$/;
const SPACE_RE = /^[A-Za-z0-9_-]{1,64}$/;
const MODULE_RE = /^[a-z0-9-]{1,40}$/;
const KIND_RE = /^[a-z][a-z0-9-]{0,39}$/;
const OBJECT_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const DATA_KEY_RE = /^[A-Za-z0-9_.:/-]{1,128}$/;
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const when = (v) => typeof v === 'number' && Number.isFinite(v);
const version = (v) => Number.isSafeInteger(v) && v >= 0;

class RecordsError extends Error {
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
// An object's pointer in a record: a module's object in a space, and the key it is stored at. Null when it is not one.
function cleanPointer(o, space) {
  if (!isObject(o)) return null;
  if (typeof o.module !== 'string' || !MODULE_RE.test(o.module) || typeof o.kind !== 'string' || !KIND_RE.test(o.kind)) return null;
  if (typeof o.id !== 'string' || !OBJECT_ID_RE.test(o.id) || o.scope !== 'space' || typeof o.key !== 'string' || !DATA_KEY_RE.test(o.key)) return null;
  return { module: o.module, kind: o.kind, id: o.id, scope: 'space', space, key: o.key };
}
function cleanAsk(a) {
  if (!isObject(a) || typeof a.id !== 'string' || !ID_RE.test(a.id)) return null;
  if (typeof a.agent !== 'string' || !KEY_RE.test(a.agent)) return null;
  if (typeof a.space !== 'string' || !SPACE_RE.test(a.space) || !ASKS.includes(a.ask) || !STATES.includes(a.state) || !when(a.at)) return null;
  const out = { id: a.id, agent: a.agent, space: a.space, ask: a.ask };
  if (a.ask === 'delete') {
    const object = cleanPointer(a.object, a.space);
    if (!object || !version(a.version)) return null;
    out.object = object;
    out.version = a.version;
    if (typeof a.reason === 'string' && a.reason) out.reason = a.reason.slice(0, REASON_MAX);
  } else {
    if (typeof a.person !== 'string' || !KEY_RE.test(a.person)) return null;
    if (a.ask === 'moderator' && typeof a.on !== 'boolean') return null;
    out.person = a.person;
    if (a.ask === 'moderator') out.on = a.on;
  }
  out.at = a.at;
  out.state = a.state;
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
  if (OBJECT_CHANGES.includes(c.change)) {
    const object = cleanPointer(c.object, c.space);
    if (!object || !version(c.versionAfter)) return null;
    out.object = object;
    out.versionAfter = c.versionAfter;
    out.held = c.held === true;
    if (Number.isSafeInteger(c.request) && c.request > 0) out.request = c.request;
    if (typeof c.ask === 'string' && ID_RE.test(c.ask)) out.ask = c.ask;
  }
  if (typeof c.undoneBy === 'string' && KEY_RE.test(c.undoneBy)) out.undoneBy = c.undoneBy;
  if (when(c.undoneAt)) out.undoneAt = c.undoneAt;
  return out;
}
const copyOf = (r) => (r.object ? { ...r, object: { ...r.object } } : { ...r });

class AgentRecords {
  constructor(dir, { log = console.warn } = {}) {
    this.dir = dir;
    this.file = path.join(dir, FILE);
    this.log = log;
    this.asks = [];
    this.changes = [];
    // Told of each object change that is dropped (past its days, its space or agent gone), so its hold goes with it.
    this.onDrop = null;
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
      const aside = path.join(this.dir, `agent-records.unreadable-${Date.now()}.json`);
      try { fs.renameSync(this.file, aside); } catch { throw new Error("The agents' records file could not be read or moved out of the way."); }
      this.log(`${this.file} could not be read as agents' asks and changes, so it was kept as ${aside} and a new one begun.`);
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

  // A new id, used by no ask or change. A change's id is taken before the change is made (its hold is written first).
  newId() {
    let id;
    do id = crypto.randomBytes(8).toString('hex');
    while (this.asks.some((a) => a.id === id) || this.changes.some((c) => c.id === id));
    return id;
  }

  dropped(list) {
    if (typeof this.onDrop !== 'function') return;
    for (const c of list) {
      if (!c.object) continue;
      try { this.onDrop(c); } catch (err) { this.log(`An agent's change could not let go of what it held: ${err.message}`); }
    }
  }

  // --- asks --------------------------------------------------------------------------------------------------------

  endsAt(a) { return a.at + AGENT_ASK_DAYS * DAY; }

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
    const old = this.changes.filter((c) => now - c.at >= AGENT_UNDO_DAYS * DAY);
    if (asks.length !== this.asks.length || old.length) changed = true;
    this.asks = asks;
    if (old.length) this.changes = this.changes.filter((c) => !old.includes(c));
    this.dropped(old);
    return changed;
  }

  tidy(now = Date.now()) {
    if (!this.sweep(now)) return;
    try { this.save(); } catch (err) { this.log(`The agents' asks and changes could not be written: ${err.message}`); }
  }

  // The asks waiting for an answer from `agent`, oldest first.
  waitingOf(agent, now = Date.now()) {
    return this.asks.filter((a) => a.agent === agent && this.stateOf(a, now) === 'waiting').sort((a, b) => a.at - b.at);
  }

  // A new set-up ask: { agent, space, ask, person, on? }. Throws RecordsError 409 when the same ask is waiting, 429 when
  // `cap` are waiting already (with `retrySeconds`, until the oldest runs out), 503 when the file is full. Returns a copy.
  addAsk({ agent, space, ask, person, on }, cap, now = Date.now()) {
    if (!SETUP_ASKS.includes(ask)) throw new RecordsError('No such ask.', 400);
    this.tidy(now);
    const waiting = this.waitingOf(agent, now);
    const same = waiting.find((a) => a.space === space && a.ask === ask && a.person === person);
    if (same) throw new RecordsError('This agent has asked that already. Wait for an answer.', 409);
    if (waiting.length >= cap) {
      const err = new RecordsError('The agent has done as much as it may for now.', 429);
      err.retrySeconds = Math.max(1, Math.ceil((this.endsAt(waiting[0]) - now) / 1000));
      throw err;
    }
    if (this.asks.length >= MAX_ASKS) throw new RecordsError('Asks cannot be taken right now. Tell whoever runs this server.', 503);
    const a = { id: this.newId(), agent, space, ask, person, ...(ask === 'moderator' ? { on: on === true } : {}), at: now, state: 'waiting' };
    this.asks.push(a);
    this.commit(() => { this.asks.pop(); });
    return { ...a };
  }

  // A new delete ask: { agent, space, object: { module, kind, id, scope: 'space', key }, version, reason? }. Throws
  // RecordsError 409 when an ask to delete that object is waiting (any agent's) or a person declined one in the last
  // `cooldownDays` (with `until`, when it may be asked again), 429 when the agent has `waiting` waiting or has asked `perDay`
  // times in 24 hours (with `retrySeconds`), 503 when the file is full. Returns a copy.
  addDeleteAsk({ agent, space, object, version: at, reason }, { waiting: cap, perDay, cooldownDays }, now = Date.now()) {
    this.tidy(now);
    const made = cleanAsk({ id: this.newId(), agent, space, ask: 'delete', object, version: at, reason, at: now, state: 'waiting' });
    if (!made) throw new RecordsError('No such ask.', 400);
    const same = (a) => a.ask === 'delete' && a.space === space && a.object.module === made.object.module && a.object.key === made.object.key;
    if (this.asks.some((a) => same(a) && this.stateOf(a, now) === 'waiting')) throw new RecordsError('There is already an ask to delete that.', 409);
    const declined = this.asks.filter((a) => same(a) && a.state === 'declined' && now - (a.decidedAt || a.at) < cooldownDays * DAY).sort((a, b) => (b.decidedAt || b.at) - (a.decidedAt || a.at))[0];
    if (declined) {
      const err = new RecordsError('A person declined deleting that.', 409);
      err.until = (declined.decidedAt || declined.at) + cooldownDays * DAY;
      throw err;
    }
    const mine = this.asks.filter((a) => a.ask === 'delete' && a.agent === agent);
    const waiting = mine.filter((a) => this.stateOf(a, now) === 'waiting').sort((a, b) => a.at - b.at);
    const today = mine.filter((a) => now - a.at < DAY).sort((a, b) => a.at - b.at);
    if (waiting.length >= cap || today.length >= perDay) {
      const err = new RecordsError('The agent has done as much as it may for now.', 429);
      const frees = waiting.length >= cap ? this.endsAt(waiting[0]) : today[0].at + DAY;
      err.retrySeconds = Math.max(1, Math.ceil((frees - now) / 1000));
      throw err;
    }
    if (this.asks.length >= MAX_ASKS) throw new RecordsError('Asks cannot be taken right now. Tell whoever runs this server.', 503);
    this.asks.push(made);
    this.commit(() => { this.asks.pop(); });
    return copyOf(made);
  }

  // The delete asks waiting in `space` (every agent's), oldest first.
  deleteAsksWaitingIn(space, now = Date.now()) {
    return this.asks.filter((a) => a.ask === 'delete' && a.space === space && this.stateOf(a, now) === 'waiting').sort((a, b) => a.at - b.at).map(copyOf);
  }

  // An approved delete was undone by a person: its ask reads `undone` from now on.
  markUndone(id) {
    const a = this.asks.find((x) => x.id === id && x.ask === 'delete' && x.state === 'approved');
    if (!a) return false;
    a.state = 'undone';
    try { this.save(); } catch (err) { this.log(`The agents' asks could not be written: ${err.message}`); }
    return true;
  }

  ask(id) {
    const a = this.asks.find((x) => x.id === id);
    return a ? { ...copyOf(a), state: this.stateOf(a) } : null;
  }

  // Every ask of `agent` kept, newest first, with its state as it reads now.
  asksOf(agent, now = Date.now()) {
    this.tidy(now);
    return this.asks.filter((a) => a.agent === agent).sort((a, b) => b.at - a.at).map((a) => ({ ...copyOf(a), state: this.stateOf(a, now) }));
  }

  // Every ask in `space`, of every agent, newest first.
  asksIn(space, now = Date.now()) {
    this.tidy(now);
    return this.asks.filter((a) => a.space === space).sort((a, b) => b.at - a.at).map((a) => ({ ...copyOf(a), state: this.stateOf(a, now) }));
  }

  // Answers an ask: `decision` approve or decline, `by` the person's key. `apply()` runs the change for an approval, in the
  // same step (nothing awaits between them), before anything is written; it throws to refuse, and then nothing changes.
  // The same answer again changes nothing ({ changed: false }); the other answer, or an ask that is over, is a 409. A delete
  // ask is answered once: any second answer, the same one too, is a 409 (plan-agent-edit-delete.md, "The contract", 6).
  decide(id, agent, decision, by, apply = () => {}, now = Date.now()) {
    const a = this.asks.find((x) => x.id === id && x.agent === agent);
    if (!a) throw new RecordsError('No such ask.', 404);
    const want = decision === 'approve' ? 'approved' : 'declined';
    if (a.state === want && a.ask !== 'delete') return { ask: copyOf(a), changed: false };
    if (this.stateOf(a, now) === 'expired') {
      this.expire((x) => x === a, now);
      throw new RecordsError('That ask has run out.', 409);
    }
    if (a.state !== 'waiting') throw new RecordsError('That ask was answered already.', 409);
    if (want === 'approved') apply(a);
    const before = { ...a };
    a.state = want;
    a.decidedBy = by;
    a.decidedAt = now;
    this.commit(() => { Object.keys(a).forEach((k) => delete a[k]); Object.assign(a, before); });
    return { ask: copyOf(a), changed: true };
  }

  // Ends every waiting ask `which(ask)` picks (a kill switch, a space gone, an ask that can no longer be done). Returns how
  // many ended.
  expire(which, now = Date.now()) {
    let n = 0;
    for (const a of this.asks) if (a.state === 'waiting' && which(a)) { a.state = 'expired'; a.decidedAt = now; n += 1; }
    if (n) { try { this.save(); } catch (err) { this.log(`The agents' asks could not be written: ${err.message}`); } }
    return n;
  }

  // --- undo records ------------------------------------------------------------------------------------------------

  // A direct set-up change by the agent: { agent, space, change: 'made' } or { agent, space, change: 'changed', before,
  // after }. Never throws: a record that cannot be kept is said once in the server's log, and the change stands.
  noteChange({ agent, space, change, before, after }, now = Date.now()) {
    if (!SETUP_CHANGE_KINDS.includes(change)) return null;
    this.tidy(now);
    if (this.changes.length >= MAX_CHANGES) { this.log('A set-up agent\'s change could not be kept for an undo: too many are kept.'); return null; }
    const c = { id: this.newId(), agent, space, change, at: now, ...(change === 'changed' ? { before: cleanFields(before) || {}, after: cleanFields(after) || {} } : {}) };
    this.changes.push(c);
    try { this.save(); } catch (err) { this.changes.pop(); this.log(`A set-up agent's change could not be kept for an undo: ${err.message}`); return null; }
    return { ...c };
  }

  // An ordinary agent's change to one object: { id? (taken with newId, when its hold was written first), agent, space,
  // change: added | edited | deleted, object: { module, kind, id, scope: 'space', key }, versionAfter, held, request?, ask? }.
  // Never throws: a record that cannot be kept is said in the server's log and answered null (the caller then lets go of
  // its hold), and the change stands.
  noteObject(given, now = Date.now()) {
    this.tidy(now);
    const id = typeof given.id === 'string' && ID_RE.test(given.id) && !this.changes.some((c) => c.id === given.id) && !this.asks.some((a) => a.id === given.id) ? given.id : this.newId();
    const c = cleanChange({ ...given, id, at: now });
    if (!c || !OBJECT_CHANGES.includes(c.change)) { this.log('An agent\'s change could not be kept for an undo: it was not one this server keeps.'); return null; }
    if (this.changes.length >= MAX_CHANGES) {
      // The oldest change goes first, so the newest can still be undone.
      const oldest = [...this.changes].sort((a, b) => a.at - b.at)[0];
      this.changes = this.changes.filter((x) => x !== oldest);
      this.dropped([oldest]);
    }
    this.changes.push(c);
    try { this.save(); } catch (err) { this.changes.pop(); this.log(`An agent's change could not be kept for an undo: ${err.message}`); return null; }
    return copyOf(c);
  }

  change(id, now = Date.now()) {
    this.tidy(now);
    const c = this.changes.find((x) => x.id === id);
    return c ? copyOf(c) : null;
  }

  // Every change of `agent` still kept (AGENT_UNDO_DAYS), newest first.
  changesOf(agent, now = Date.now()) {
    this.tidy(now);
    return this.changes.filter((c) => c.agent === agent).sort((a, b) => b.at - a.at).map(copyOf);
  }

  // Every object change in `space`, of every agent, newest first.
  changesIn(space, now = Date.now()) {
    this.tidy(now);
    return this.changes.filter((c) => c.space === space && c.object).sort((a, b) => b.at - a.at).map(copyOf);
  }

  // Undoes a change: `match(change)` says whether it is the one this route may reach (its agent, or its space), and
  // `apply(change)` puts it back, in the same step, and throws to refuse. 404 for no such change (or one past its days),
  // 409 for one undone already. The record is marked undone before it is answered; a write that fails is said in the log.
  undo(id, match, by, apply, now = Date.now()) {
    this.tidy(now);
    const c = this.changes.find((x) => x.id === id);
    if (!c || !match(copyOf(c))) throw new RecordsError(`No such change. A change can be undone for ${AGENT_UNDO_DAYS} days.`, 404);
    if (c.undoneAt) throw new RecordsError('That was undone already.', 409);
    apply(copyOf(c));
    c.undoneBy = by;
    c.undoneAt = now;
    try { this.save(); } catch (err) { this.log(`An undo could not be written: ${err.message}`); }
    return copyOf(c);
  }

  // A deleted space takes its asks and changes with it. Returns how many went.
  forgetSpace(space) {
    const n = this.asks.length + this.changes.length;
    const gone = this.changes.filter((c) => c.space === space);
    this.asks = this.asks.filter((a) => a.space !== space);
    this.changes = this.changes.filter((c) => c.space !== space);
    const count = n - this.asks.length - this.changes.length;
    if (count) this.save();
    this.dropped(gone);
    return count;
  }

  // A deleted agent takes its asks and changes with it.
  forgetAgent(agent) {
    const n = this.asks.length + this.changes.length;
    const gone = this.changes.filter((c) => c.agent === agent);
    this.asks = this.asks.filter((a) => a.agent !== agent);
    this.changes = this.changes.filter((c) => c.agent !== agent);
    if (n !== this.asks.length + this.changes.length) this.save();
    this.dropped(gone);
  }
}

// Whether anybody but `agent` has written in the space (plan-admin-agent.md: "Undo of a made space erases it, only while
// nobody but the agent has written in it"). Read from what is kept for the space, so nothing can be lost by the erase: a
// module record by anyone else (the template's starter content is the agent's own), a Clear held for an undo, an upload,
// a library file, a chat message (the set-up agent never posts), a shared layout, or a person's own workspaces. `env` is the environment.
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
  if (layouts.sharedOf(spaceId).length) return true; // a shared layout
  if (Object.keys(env.store.workspaces?.spaces?.[spaceId] || {}).length) return true; // a person's own workspaces
  return false;
}

module.exports = { AgentRecords, RecordsError, writtenByOthers, STATES, OBJECT_CHANGES, REASON_MAX, AGENT_RECORDS_FILE: FILE };
