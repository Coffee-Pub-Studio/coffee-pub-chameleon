// What passes between modules besides pointers: events (a module says something happened) and
// actions (a module asks another to do something). The host is only the transport. It does not know
// what any event or action means: modules declare them in module.json, an admin approves who may
// hear and who may ask, and this file keeps them until someone can act on them.
//
// Nothing here runs a module. An event is kept (a short while) for modules that were not open when it happened to catch
// up on; an action request waits in the providing module's queue until a person has that module open, whose page claims
// it, does it under its own rules, and reports back. The one exception is an agent's request to a bundled module that
// declares server actions (plan-agent-edit-delete.md, decision 4): the server carries it out itself at once
// (server/module-actions.js), so it is made already claimed by the server (`server: true`) and no page is ever offered
// it, may claim it or may finish it; only completeServer finishes it. Persists to DATA_DIR/modules/bus.json.

'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const LIMITS = {
  events: 500, // kept in all
  eventAgeMs: 14 * 24 * 60 * 60 * 1000,
  actions: 500,
  actionAgeMs: 7 * 24 * 60 * 60 * 1000,
  claimMs: 60 * 1000, // a claimed request nobody completed can be claimed again after this
  dataBytes: 2000,
  // A request that is only for a page already open (Chat's Keep and Send to... asking a `local` action, such as a poll
  // form) is handed out for this long, then never: it does not wait for the next time the module is opened.
  openOnlyMs: 60 * 1000,
  // How long after a request finished the person who asked can still read how it went (GET /api/spaces/:id/action/:id).
  resultMs: 10 * 60 * 1000,
  // How many data writes one claim may name its asker on (plan-agent-access.md, decision 9): a request is a few writes.
  carriedWrites: 10,
};

// Whether a request with a time limit (`expiresAt`) has passed it without being carried out: no page may take it now. A
// page that claimed it in time and is still within the claim's minute may still finish it.
function expired(a, now) {
  if (!a.expiresAt || a.status === 'done' || now <= a.expiresAt) return false;
  return !(a.status === 'claimed' && now - a.claimedAt <= LIMITS.claimMs);
}

// A stored request read back with the types the rules rely on, whatever the file says: a time or a count that is not a
// number closes the carrying window and its cap (never reads as "none yet"), a name that is not text is empty.
const isTime = (v) => typeof v === 'number' && Number.isFinite(v);
// What a request the server was carrying out reads as when the server stopped before finishing it.
const SERVER_STOPPED = 'The server stopped while carrying this out. Read the data to see whether it was done, and ask again if not.';
function typed(a) {
  const out = { ...a };
  if (a.server !== undefined) out.server = a.server === true;
  // The server stopped part way through one it was carrying out: finished, failed, never offered to a page.
  if (out.server && out.status !== 'done') Object.assign(out, { status: 'done', doneAt: isTime(a.claimedAt) ? a.claimedAt : Date.now(), doneBy: '', result: { ok: false, error: SERVER_STOPPED } });
  out.claimedAt = isTime(a.claimedAt) ? a.claimedAt : 0;
  if (a.claimedFirstAt !== undefined && !isTime(a.claimedFirstAt)) out.claimedFirstAt = 1;
  if (a.carried !== undefined && !(Number.isInteger(a.carried) && a.carried >= 0)) out.carried = LIMITS.carriedWrites;
  for (const field of ['claimedBy', 'doneBy']) if (a[field] !== undefined && typeof a[field] !== 'string') out[field] = '';
  return out;
}

class ModuleBus extends EventEmitter {
  constructor(modulesDir) {
    super();
    this.setMaxListeners(0);
    this.file = path.join(modulesDir, 'bus.json');
    this.state = { seq: 0, events: [], actions: [] };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && Array.isArray(raw.events) && Array.isArray(raw.actions)) this.state = { seq: Number(raw.seq) || 0, events: raw.events, actions: raw.actions.filter((a) => a && typeof a === 'object').map(typed) };
    } catch {
      // nothing yet
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state));
    fs.renameSync(tmp, this.file);
  }

  // Old events and requests go. A request that goes without having been carried out is announced ('actionsDropped'),
  // so what it left behind (a picture uploaded for it) can be removed with it; an expired one goes once its result
  // window is over.
  prune() {
    const now = Date.now();
    this.state.events = this.state.events.filter((e) => now - e.at < LIMITS.eventAgeMs).slice(-LIMITS.events);
    const before = this.state.actions;
    this.state.actions = before
      .filter((a) => now - a.at < LIMITS.actionAgeMs && !(expired(a, now) && now - a.expiresAt > LIMITS.resultMs))
      .slice(-LIMITS.actions);
    if (this.state.actions.length === before.length) return [];
    const kept = new Set(this.state.actions);
    return before.filter((a) => !kept.has(a) && a.status !== 'done');
  }

  // A deleted space: its events and its waiting or finished requests go with it (not announced as dropped: the space is gone).
  forgetSpace(spaceId) {
    const scope = `space:${spaceId}`;
    const inSpace = (x) => x.scopeKey === scope || x.space === spaceId;
    const before = this.state.events.length + this.state.actions.length;
    this.state.events = this.state.events.filter((e) => !inSpace(e));
    this.state.actions = this.state.actions.filter((a) => !inSpace(a));
    const gone = before - this.state.events.length - this.state.actions.length;
    if (gone) this.save();
    return gone;
  }

  // prune(), save, then say which requests went without being carried out.
  pruneAndSave() {
    const dropped = this.prune();
    this.save();
    if (dropped.length) this.emit('actionsDropped', dropped);
  }

  // --- events ---------------------------------------------------------------

  publish({ module, name, ref, data, scopeKey, by }) {
    const text = data === undefined ? '' : JSON.stringify(data);
    if (text.length > LIMITS.dataBytes) return null;
    const event = { id: ++this.state.seq, at: Date.now(), module, name, ref: ref || null, data: text ? JSON.parse(text) : null, scopeKey, by };
    this.state.events.push(event);
    this.pruneAndSave();
    this.emit('event', event);
    return event;
  }

  // What happened in a scope after event `after`, oldest first.
  eventsAfter(scopeKey, after) {
    return this.state.events.filter((e) => e.scopeKey === scopeKey && e.id > after);
  }

  latestEvent(scopeKey) {
    const list = this.state.events.filter((e) => e.scopeKey === scopeKey);
    return list.length ? list[list.length - 1].id : this.state.seq;
  }

  // --- actions --------------------------------------------------------------

  // `space`: for a request from an environment page about one of the provider's own objects in a space, that space.
  // The request still waits in `scopeKey` (where the asking and providing pages are), but only someone who may change
  // the module in that space may take it (plan-calendar-destination, decision 21).
  // `openOnly`: the request is for a page already open, and is handed out for LIMITS.openOnlyMs only (`expiresAt`).
  // `askerOnly`: only the asker's own page may take it (the routes check `by`); it waits for that page as any request does.
  // `agentToken`: for a request an agent asked for through its token (plan-agent-access.md), that token's id. The request is
  // marked `agent: true` and is carried out only while that agent still may ask (the routes check it, server/index.js).
  // `server`: the server carries it out itself (plan-agent-edit-delete.md, decision 4): it is made claimed, by nobody, and
  // stays the server's until completeServer.
  request({ from, provider, action, input, scopeKey, by, local, askerOnly, space, openOnly, agentToken, server }) {
    const at = Date.now();
    const request = { id: ++this.state.seq, at, from, provider, action, input, scopeKey, by, ...(local ? { local: true } : {}), ...(askerOnly ? { askerOnly: true } : {}), ...(space ? { space } : {}), ...(openOnly ? { expiresAt: at + LIMITS.openOnlyMs } : {}), ...(agentToken ? { agent: true, agentToken } : {}), status: 'pending', claimedAt: 0, result: null };
    if (server) Object.assign(request, { server: true, status: 'claimed', claimedAt: at, claimedFirstAt: at, claimedBy: '' });
    this.state.actions.push(request);
    this.pruneAndSave();
    this.emit('action', request);
    return request;
  }

  actionById(id) {
    return this.state.actions.find((a) => a.id === id) || null;
  }

  // Requests waiting for the provider in a scope (or claimed too long ago to be still going).
  pending(provider, scopeKey) {
    const now = Date.now();
    return this.state.actions.filter((a) => a.provider === provider && a.scopeKey === scopeKey && !a.server && !expired(a, now)
      && (a.status === 'pending' || (a.status === 'claimed' && now - a.claimedAt > LIMITS.claimMs)));
  }

  // How a request is going, in the bus's words, with 'expired' for one that passed its time limit unclaimed.
  statusOf(a) {
    return expired(a, Date.now()) ? 'expired' : a.status;
  }

  // One page takes a request; the others that saw it too are told no. Returns the request or null.
  // `by` is the person whose page takes it (the carrier): the data writes it leads to may name the asker only for them.
  claim(id, provider, scopeKey, by) {
    const a = this.actionById(id);
    const now = Date.now();
    if (!a || a.server || a.provider !== provider || a.scopeKey !== scopeKey || expired(a, now)) return null;
    if (!(a.status === 'pending' || (a.status === 'claimed' && now - a.claimedAt > LIMITS.claimMs))) return null;
    a.status = 'claimed';
    a.claimedAt = now;
    if (!a.claimedFirstAt) a.claimedFirstAt = now; // the carrying window runs from here, whoever claims it again
    a.claimedBy = by || '';
    this.save();
    return a;
  }

  // The request `by` holds right now, for a write that names its asker: this module's, still claimed by `by`, within the
  // claim's minute and not past its time limit, and (for a write at `writeScope`) only where the request itself is: its
  // object's space when it names one, else the place it waits in. null otherwise. The rule lives here, with the claim.
  carrying(id, provider, by, writeScope) {
    const a = this.actionById(id);
    const now = Date.now();
    if (!a || a.server || a.provider !== provider || a.status !== 'claimed' || !by || a.claimedBy !== by || expired(a, now) || now - (a.claimedFirstAt || a.claimedAt) > LIMITS.claimMs) return null;
    if (writeScope !== null && writeScope !== undefined && writeScope !== (a.space ? `space:${a.space}` : a.scopeKey)) return null;
    return a;
  }

  // One more carried write on a claim; false once it has had its share (LIMITS.carriedWrites).
  useCarry(a) {
    if ((a.carried || 0) >= LIMITS.carriedWrites) return false;
    a.carried = (a.carried || 0) + 1;
    this.save(); // so a restart does not give the claim its share again
    return true;
  }

  complete(id, provider, scopeKey, result, by) {
    const a = this.actionById(id);
    // Past its time limit, only a page that claimed it in time (and is within the claim's minute) may finish it.
    if (!a || a.server || a.provider !== provider || a.scopeKey !== scopeKey || a.status === 'done' || expired(a, Date.now())) return null;
    a.status = 'done';
    a.doneAt = Date.now();
    a.doneBy = by && a.claimedBy === by ? by : '';
    a.result = result;
    this.save();
    this.emit('actionDone', a);
    return a;
  }

  // The server finishes a request it is carrying out, once: the request must be the server's and still claimed (not ended
  // meanwhile, `cancel`). Returns the request, or null when it may not be finished (nothing is recorded then).
  completeServer(id, result) {
    const a = this.actionById(id);
    if (!a || !a.server || a.status !== 'claimed' || a.cancelled) return null;
    a.status = 'done';
    a.doneAt = Date.now();
    a.doneBy = '';
    a.result = result;
    this.save();
    this.emit('actionDone', a);
    return a;
  }

  // Ends every request not yet carried out for which `test(request)` is true: it is done, failed with `error`, and marked
  // `cancelled`, so no page is offered it, may claim it or finish it, and its asker reads the sentence as its result. A page
  // that claimed it a moment ago is told no when it finishes. Not announced as done (nothing was carried out). Returns the
  // requests ended.
  cancel(test, error) {
    const now = Date.now();
    const ended = this.state.actions.filter((a) => a.status !== 'done' && test(a));
    for (const a of ended) {
      a.status = 'done';
      a.doneAt = now;
      a.doneBy = '';
      a.cancelled = true;
      a.result = { ok: false, error };
    }
    if (ended.length) this.save();
    return ended;
  }

  dropModule(id) {
    this.state.events = this.state.events.filter((e) => e.module !== id);
    this.state.actions = this.state.actions.filter((a) => a.provider !== id && a.from !== id);
    this.save();
  }
}

module.exports = { ModuleBus, BUS_LIMITS: LIMITS };
