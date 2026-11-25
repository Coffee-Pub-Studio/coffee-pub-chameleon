'use strict';
// What a server-carried request's handler may answer beside its writes (documentation/plans/plan-agent-server-actions.md,
// section 2, steps 4 and 5): links between objects, schedules and one notice. The handler only names them, as plain data;
// the run's process still has no network, no environment and no way to call back (server/module-actions.js). The server
// does each one here, as the agent that asked, after the writes and in the same synchronous step:
//
//   links:     [{ add: { from, to } } | { remove: { from, to } }]                              at most LIMITS.links
//   schedules: [{ set: { key, at, about, notify?, repeat?, payload? } } | { cancel: { key } }]  at most LIMITS.schedules
//   notify:    [{ title, body?, about?, to? }]                                                   at most LIMITS.notify
//
// `effectsOf` checks the shape (known fields only, counts, sizes, the module's own pointers), for outcomeOf; a wrong shape
// is a fault of the module's code. `createActionEffects(deps).apply` then holds each one to what the routes a page uses
// would allow this agent (POST /api/objects/links, POST and DELETE /api/modules/:id/schedule, POST /api/modules/:id/notify)
// and carries it out. One refusal puts back every link and schedule the request touched, and the caller puts back its
// writes (undoCarried), so a request is done whole or not at all. The notice goes last, once everything else stood: it
// can't be taken back.
const { StoreError } = require('./store');
const { word } = require('./words');

const LIMITS = Object.freeze({
  links: 5, // link changes in one answer
  schedules: 5, // schedules set or cancelled in one answer
  notify: 1, // notices in one answer
  payloadBytes: 4000, // a schedule's payload, as server/module-hooks.js keeps it
  perObject: 20, // links one object holds (server/module-links.js LIMITS.perItem)
});

const plainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const onlyKeys = (v, allowed) => plainObject(v) && Object.keys(v).every((k) => allowed.includes(k));
const POINTER_KEYS = ['module', 'kind', 'id', 'scope', 'space'];
const SCHEDULE_KEY_RE = /^[A-Za-z0-9_.:/-]{1,128}$/;
// A pointer as plain data: its five fields and nothing else, each a short string.
const pointerLike = (r) => onlyKeys(r, POINTER_KEYS) && ['module', 'kind', 'id', 'scope'].every((k) => typeof r[k] === 'string' && r[k] && r[k].length <= 128)
  && (r.space === undefined || (typeof r.space === 'string' && r.space.length <= 128));
const text = (v, max) => v === undefined || v === null || (typeof v === 'string' && v.length <= max);
const noteLike = (v, keys) => onlyKeys(v, keys) && typeof v.title === 'string' && Boolean(v.title.trim()) && v.title.length <= 400 && text(v.body, 2000) && text(v.to, 64);

// The effects in a handler's answer, checked: { fault } | { links, schedules, notify } (each a list, [] when not answered).
// `own(ref)` says whether a pointer is one of the module's own kinds in the request's space. The faults: 'links',
// 'schedules', 'notify' (more than the count), 'linkEnd' (a link not from the module's own object), 'about' (a schedule or
// notice about something not its own), 'result' (any other shape).
function effectsOf(result, { own }) {
  const listOf = (name) => {
    const v = result[name];
    if (v === undefined || v === null) return [];
    return Array.isArray(v) ? v : null;
  };
  const rawLinks = listOf('links');
  const rawSchedules = listOf('schedules');
  const rawNotify = listOf('notify');
  if (!rawLinks || !rawSchedules || !rawNotify) return { fault: 'result' };
  if (rawLinks.length > LIMITS.links) return { fault: 'links' };
  if (rawSchedules.length > LIMITS.schedules) return { fault: 'schedules' };
  if (rawNotify.length > LIMITS.notify) return { fault: 'notify' };

  const links = [];
  for (const l of rawLinks) {
    if (!plainObject(l) || Object.keys(l).length !== 1 || !(Object.hasOwn(l, 'add') || Object.hasOwn(l, 'remove'))) return { fault: 'result' };
    const op = Object.hasOwn(l, 'add') ? 'add' : 'remove';
    const pair = l[op];
    if (!onlyKeys(pair, ['from', 'to']) || !pointerLike(pair.from) || !pointerLike(pair.to)) return { fault: 'result' };
    // The end that says what it points at is the module's own object here, as POST /api/objects/links has it.
    if (!own(pair.from)) return { fault: 'linkEnd' };
    links.push({ op, from: pair.from, to: pair.to });
  }

  const schedules = [];
  const keys = new Set();
  for (const s of rawSchedules) {
    if (!plainObject(s) || Object.keys(s).length !== 1 || !(Object.hasOwn(s, 'set') || Object.hasOwn(s, 'cancel'))) return { fault: 'result' };
    const op = Object.hasOwn(s, 'set') ? 'set' : 'cancel';
    const v = s[op];
    if (!onlyKeys(v, op === 'set' ? ['key', 'at', 'about', 'notify', 'repeat', 'payload'] : ['key'])) return { fault: 'result' };
    if (typeof v.key !== 'string' || !SCHEDULE_KEY_RE.test(v.key) || keys.has(v.key)) return { fault: 'result' };
    keys.add(v.key);
    if (op === 'cancel') { schedules.push({ op, key: v.key }); continue; }
    if (!(typeof v.at === 'number' && Number.isFinite(v.at)) && !(typeof v.at === 'string' && v.at.length <= 64)) return { fault: 'result' };
    if (!pointerLike(v.about) || !own(v.about)) return { fault: 'about' };
    if (v.notify !== undefined && v.notify !== null && !noteLike(v.notify, ['to', 'title', 'body'])) return { fault: 'result' };
    if (v.repeat !== undefined && v.repeat !== null && !(onlyKeys(v.repeat, ['every', 'until', 'tz']) && typeof v.repeat.every === 'string'
      && (v.repeat.until === undefined || v.repeat.until === null || typeof v.repeat.until === 'number' || (typeof v.repeat.until === 'string' && v.repeat.until.length <= 64))
      && text(v.repeat.tz, 64))) return { fault: 'result' };
    if (v.payload !== undefined && JSON.stringify(v.payload).length > LIMITS.payloadBytes) return { fault: 'result' };
    schedules.push({ op, key: v.key, at: v.at, about: v.about, ...(v.notify ? { notify: v.notify } : {}), ...(v.repeat ? { repeat: v.repeat } : {}), ...(v.payload !== undefined ? { payload: v.payload } : {}) });
  }

  const notify = [];
  for (const n of rawNotify) {
    if (!noteLike(n, ['to', 'title', 'body', 'about'])) return { fault: 'result' };
    if (n.about !== undefined && n.about !== null && (!pointerLike(n.about) || !own(n.about))) return { fault: 'about' };
    notify.push({ title: n.title, ...(typeof n.body === 'string' ? { body: n.body } : {}), ...(n.to ? { to: n.to } : {}), ...(n.about ? { about: n.about } : {}) });
  }
  return { links, schedules, notify };
}

// The faults above in words, after "<Module> could not carry that out: " (server/module-actions.js faultWords).
const EFFECT_FAULT_WORDS = {
  links: () => `it tried to change more than ${LIMITS.links} links at once`,
  schedules: () => `it tried to set or cancel more than ${LIMITS.schedules} reminders at once`,
  notify: () => `it tried to send more than ${LIMITS.notify} notice at once`,
  linkEnd: () => `it tried to link from something that is not its own in this ${word('space')}`,
  about: () => `it tried to set a reminder or send a notice about something that is not its own in this ${word('space')}`,
};

// `deps`, all from server/index.js, each the very function or service the routes use (the services its per-environment
// proxies): { moduleLinks, moduleHooks, modules, resolveRef, copySight, copyChangeText, hookGranted, overLimit,
// limitMessage, isLibraryFileRef, refFileSeen, markedForSpace, refShape, plainRef, objectKey }.
function createActionEffects(deps) {
  const { moduleLinks, moduleHooks, modules, resolveRef, copySight, copyChangeText, hookGranted, overLimit, limitMessage, isLibraryFileRef, refFileSeen, markedForSpace, refShape, plainRef, objectKey } = deps;
  // Every refusal is one sentence that starts by saying nothing was changed, then why.
  const sentence = (why) => `Nothing was changed: ${String(why || '').replace(/[.\s]+$/, '')}.`;
  const refuse = (status, why) => ({ refusal: { status, error: sentence(why) } });
  const thrown = (err) => {
    if (!err.status && !(err instanceof StoreError)) throw err;
    return refuse(err.status || 400, err.message);
  };

  // Carries out `effects` (effectsOf's) for the request of `who` (the agent) in `space`, for the module `found` (as it is
  // enabled now) with the write context `ctx` (moduleAccessAt's, as the agent). `changed`: the module's own objects this
  // request's writes changed (not made); a schedule about one was set from the object as it was, so it is taken off first,
  // and the handler answers it again if one should stand. Answers { refusal: { status, error } } with everything here put
  // back, or { done } with what was done, as the request's outcome keeps it:
  //   { links?: { added, removed }, schedules?: { set: [key], cancelled: [key] }, notified?: n }
  function apply({ effects, who, space, found, ctx, changed = [] }) {
    const { manifest } = found;
    const id = manifest.id;
    const scopeKey = ctx.scopeKey;
    const shown = modules.shownName(manifest);
    const sight = copySight(who);
    const wantsNotice = effects.notify.length > 0 || effects.schedules.some((s) => s.op === 'set' && s.notify);
    // The hooks first, before anything is touched: declared in the module's manifest and approved by an admin.
    const hookRefusal = (hook) => (hookGranted(found, hook) ? null
      : refuse(403, manifest.hooks[hook] ? `${shown} is not approved for the ${hook} hook yet` : `${shown} did not ask for the ${hook} hook`));
    const noHook = (effects.schedules.length ? hookRefusal('schedule') : null) || (wantsNotice ? hookRefusal('notify') : null);
    if (noHook) return noHook;
    // Who a notice from an agent's request may go to: this space (its people who may see the module), or one of its members.
    const members = Array.isArray(space.members) ? space.members : [];
    const toOf = (to) => (to === undefined || to === null || to === '' || to === 'space' ? 'space' : members.includes(to) ? to : null);
    const TO_REFUSAL = `a notice from an agent's request goes to this ${word('space')} or to one of its ${word('member', { many: true })}`;
    // One of the module's own objects here, as the agent sees it now (after the writes): there, and not a copy it may not see.
    const ownSeen = (ref) => {
      try { resolveRef(who, ref, id, { skipConsumer: true }); return null; } catch (err) { return thrown(err); }
    };

    const linkUndo = new Map(); // objectKey(from) -> { from, items }: the links it held before this request
    const scheduleUndo = new Map(); // schedule key -> the stored schedule as it was, or null
    const undo = () => {
      try {
        for (const { from, items } of linkUndo.values()) moduleLinks.putBack(from, items);
        if (scheduleUndo.size) moduleHooks.putBack(id, scopeKey, [...scheduleUndo.entries()].map(([key, record]) => ({ key, record })));
      } catch (err) {
        console.error(`${id}: what a refused request did beside its writes could not be put back: ${err.message}`);
      }
    };
    const fail = (r) => { undo(); return r; };
    const remember = (key) => { if (!scheduleUndo.has(key)) scheduleUndo.set(key, moduleHooks.record(id, scopeKey, key)); };

    // A schedule about an object this request changed is taken off (it would fire with the object's old time and words).
    for (const ref of changed) {
      for (const s of moduleHooks.about(id, scopeKey, ref)) remember(s.key);
      moduleHooks.cancelAbout(id, scopeKey, ref);
    }

    // --- links ---------------------------------------------------------------------------------------------------------
    let added = 0;
    let removed = 0;
    for (const l of effects.links) {
      if (!refShape(l.from) || !refShape(l.to)) return fail(refuse(400, `${shown} named ${word('object', { a: true })} to link that is not a valid pointer`));
      const from = plainRef(l.from);
      const to = plainRef(l.to);
      const gone = ownSeen(from);
      if (gone) return fail(gone);
      // A copy of another module's object: its links change only for whoever may change its original.
      const copy = sight.changeRefusal(from);
      if (copy) return fail(refuse(403, copy.manifest ? copyChangeText(copy.manifest) : `that ${word('object')} is a copy of one you can't see`));
      if (to.scope === 'person') return fail(refuse(400, `personal ${word('object', { many: true })} are private, so they are not linked`));
      if (objectKey(from) === objectKey(to)) return fail(refuse(400, `${word('object', { a: true })} is not linked to itself`));
      const fk = objectKey(from);
      if (!linkUndo.has(fk)) linkUndo.set(fk, { from, items: moduleLinks.held(from) });
      const holds = () => moduleLinks.held(from).some((h) => objectKey(h.to) === objectKey(to));
      if (l.op === 'remove') {
        // Taking a link out needs no sight of what it pointed at, except a library file hidden from the agent: passed over
        // as quietly as a link the object doesn't hold, as the route does.
        if (!holds() || (isLibraryFileRef(to) && !refFileSeen(who, to, true))) continue;
        moduleLinks.set(from, [to], ctx.by, to.kind, 'remove');
        if (holds()) return fail(refuse(500, 'the link could not be taken out'));
        removed += 1;
        continue;
      }
      // What it links to is in this space (or the environment's, marked for this space), seen by the agent, and of a kind
      // the module is approved to link to (its own kinds need no approval: server/modules.js cleanRefs refuses a module
      // that lists its own kind in refs.consumes, since it does not need to).
      const here = to.scope === 'space' ? to.space === space.id : to.scope === 'environment' && markedForSpace(to, space.id);
      if (!here) return fail(refuse(403, `a link can only be to ${word('object', { a: true })} in this ${word('space')}`));
      try { resolveRef(who, to, id, to.module === id ? { skipConsumer: true } : {}); } catch (err) { return fail(thrown(err)); }
      if (holds()) continue;
      if (moduleLinks.held(from).length >= LIMITS.perObject) return fail(refuse(413, `${word('object', { a: true })} holds at most ${LIMITS.perObject} links`));
      moduleLinks.set(from, [to], ctx.by, to.kind, 'add');
      if (!holds()) return fail(refuse(507, 'no more links can be kept'));
      added += 1;
    }

    // --- schedules -----------------------------------------------------------------------------------------------------
    const setKeys = [];
    for (const s of effects.schedules) {
      // A schedule about a copy whose original the agent may not see is not there for it: not replaced, not cancelled.
      const had = moduleHooks.record(id, scopeKey, s.key);
      const hidden = Boolean(had && had.ref && sight.hides(had.ref));
      if (s.op === 'cancel') {
        if (!had || hidden) continue;
        remember(s.key);
        moduleHooks.cancel(ctx, s.key);
        continue;
      }
      if (hidden) return fail(refuse(404, 'that reminder is not there'));
      if (!refShape(s.about)) return fail(refuse(400, `${shown} named ${word('object', { a: true })} for a reminder that is not a valid pointer`));
      const about = plainRef(s.about);
      const gone = ownSeen(about);
      if (gone) return fail(gone);
      let notify = null;
      if (s.notify) {
        const to = toOf(s.notify.to);
        if (!to) return fail(refuse(400, TO_REFUSAL));
        notify = { to, title: s.notify.title, body: s.notify.body };
      }
      if (overLimit(id, ctx.by, 'schedule')) return fail({ refusal: { status: 429, error: limitMessage() } });
      remember(s.key);
      try {
        moduleHooks.schedule({ ...ctx, ref: about }, { key: s.key, at: s.at, payload: s.payload, notify, repeat: s.repeat });
      } catch (err) {
        return fail(thrown(err));
      }
      setKeys.push(s.key);
    }

    // --- the notice, last: nothing after it can fail ------------------------------------------------------------------------
    let notified = null;
    for (const n of effects.notify) {
      const to = toOf(n.to);
      if (!to) return fail(refuse(400, TO_REFUSAL));
      let about = null;
      if (n.about) {
        if (!refShape(n.about)) return fail(refuse(400, `${shown} named ${word('object', { a: true })} for a notice that is not a valid pointer`));
        about = plainRef(n.about);
        const gone = ownSeen(about);
        if (gone) return fail(gone);
      }
      if (overLimit(id, ctx.by, 'notify')) return fail({ refusal: { status: 429, error: limitMessage() } });
      try {
        // In the agent's name (`by`), to those who may see the module here (and the object's original, for a copy).
        notified = (notified || 0) + moduleHooks.deliver({ module: id, scopeKey, spaceId: ctx.spaceId, ref: about }, { to, title: n.title, body: n.body }, { by: ctx.by });
      } catch (err) {
        return fail(thrown(err));
      }
    }

    // What the request did, for its outcome. A schedule counts as cancelled when it was there before and is not now
    // (taken off because its object changed, or cancelled by the handler), and as set when the handler set it.
    const cancelled = [...scheduleUndo.entries()].filter(([key, record]) => record && !moduleHooks.record(id, scopeKey, key)).map(([key]) => key);
    const done = {
      ...(added || removed ? { links: { added, removed } } : {}),
      ...(setKeys.length || cancelled.length ? { schedules: { set: setKeys, cancelled } } : {}),
      ...(notified !== null ? { notified } : {}),
    };
    return { done };
  }

  return { apply };
}

module.exports = { effectsOf, createActionEffects, EFFECT_FAULT_WORDS, ACTION_EFFECT_LIMITS: LIMITS };
