// After a module writes or deletes an object, tell the modules that point at it, and keep a held pointer
// true (plan-linked-objects.md). The routes call afterWrite. A write this file makes itself does not, so
// nothing here is sent again. `tz` is the writer's zone, used to turn an instant into a day. A zone Intl
// does not accept falls back to TZ, then UTC, and never refuses the write.
'use strict';

const { EventEmitter } = require('events');

// One bus for the whole process, so every event names the environment it happened in (`env`, from deps.environment())
// and a listener hears only its own.
const bus = new EventEmitter();
bus.setMaxListeners(0);

let deps = null;

// A zone name Intl accepts, else null.
function acceptZone(zone) {
  if (typeof zone !== 'string' || !zone || zone.length > 64) return null;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

function writerZone(tz) {
  return acceptZone(tz) || acceptZone(process.env.TZ) || 'UTC';
}

// The zone a sender's times are written in: the one its space keeps (`dated.zone`: a stored object and the field that holds
// a zone name, the trip's), else the writer's. A copy shows the trip's own wall time, whoever wrote it.
function tripZone(moduleId, produce, scopeKey) {
  const at = produce.dated?.zone;
  if (!at || !deps) return null;
  const stored = deps.read(moduleId, scopeKey, at.key);
  return acceptZone(stored && typeof stored === 'object' ? stored[at.field] : null);
}

// The calendar day of a summary `when` in the writer's zone. A plain date is already a day. An instant
// (anything Date.parse accepts) is the day it falls on in that zone, so a time near midnight can be
// yesterday in one zone and today in another.
function dayInZone(when, tz) {
  if (typeof when !== 'string' || !when) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(when)) return when;
  const ms = Date.parse(when);
  if (Number.isNaN(ms)) return null;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const year = get('year');
  const month = get('month');
  const day = get('day');
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

function configure(next) {
  deps = next;
}

function refOf(moduleId, produce, id, scopeKey) {
  if (scopeKey === 'environment') return { module: moduleId, kind: produce.kind, id, scope: 'environment' };
  if (scopeKey.startsWith('person:')) return { module: moduleId, kind: produce.kind, id, scope: 'person' };
  if (scopeKey.startsWith('space:')) return { module: moduleId, kind: produce.kind, id, scope: 'space', space: scopeKey.slice('space:'.length) };
  return null;
}

function scopeKeyOfHolder(ref) {
  if (ref.scope === 'space' && ref.space) return `space:${ref.space}`;
  if (ref.scope === 'environment') return 'environment';
  return null;
}

function pointsAt(value, field, ref) {
  const got = value?.[field];
  if (!got || typeof got !== 'object') return false;
  return got.module === ref.module && got.kind === ref.kind && String(got.id) === String(ref.id) && got.scope === ref.scope && (ref.scope !== 'space' || got.space === ref.space);
}

// The stored object that `holder` says it is, when that kind declares `holds`. Null when it cannot be read.
function held(holder) {
  const produce = deps.produceOf(holder.module, holder.kind);
  if (!produce?.holds) return null;
  const scopeKey = scopeKeyOfHolder(holder);
  if (!scopeKey) return null;
  const key = produce.key.replace('{id}', holder.id);
  return { produce, scopeKey, key, value: deps.read(holder.module, scopeKey, key) };
}

function applyDelete(holder, ref, by) {
  const loaded = held(holder);
  if (!loaded || !pointsAt(loaded.value, loaded.produce.holds.field, ref)) return;
  const { produce, scopeKey, key, value } = loaded;
  if (produce.holds.onDelete === 'remove') {
    deps.remove(holder.module, scopeKey, key, by);
    deps.dropLinks(holder);
    return;
  }
  const mark = produce.holds.markField;
  if (!mark || !value || typeof value !== 'object' || value[mark] === true) return;
  deps.write(holder.module, scopeKey, key, { ...value, [mark]: true }, by);
}

function applyFollow(holder, ref, beforeSummary, afterSummary, zone, by) {
  const loaded = held(holder);
  const follow = loaded?.produce.holds.follow;
  if (!follow || !loaded.value || typeof loaded.value !== 'object') return;
  if (!pointsAt(loaded.value, loaded.produce.holds.field, ref)) return;
  const next = { ...loaded.value };
  let changed = false;
  if (follow.title && typeof afterSummary?.title === 'string' && next[follow.title] !== afterSummary.title) {
    next[follow.title] = afterSummary.title;
    changed = true;
  }
  // Move a placed holder onto the object's new day only when it was sitting on the old one and is not pinned.
  if (follow.day) {
    const oldDay = dayInZone(beforeSummary?.when, zone);
    const newDay = dayInZone(afterSummary?.when, zone);
    const pinned = follow.pin ? next[follow.pin] === true : false;
    const heldDay = next[follow.day];
    if (typeof heldDay === 'string' && heldDay && !pinned && oldDay && newDay && heldDay === oldDay && newDay !== oldDay) {
      next[follow.day] = newDay;
      changed = true;
    }
  }
  if (changed) deps.write(holder.module, loaded.scopeKey, loaded.key, next, by);
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

function zonedParts(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

// The UTC instant of a wall-clock day and time in `tz`.
function instantOf(day, time, tz) {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  let utc = Date.UTC(y, m - 1, d, hh, mm, 0);
  const shown = zonedParts(new Date(utc), tz);
  const hour = shown.hour === 24 ? 0 : shown.hour;
  const want = Date.UTC(y, m - 1, d, hh, mm);
  const got = Date.UTC(shown.year, shown.month - 1, shown.day, hour, shown.minute);
  return new Date(utc + (want - got)).toISOString();
}

function timeInZone(when, tz) {
  const ms = Date.parse(when);
  if (Number.isNaN(ms)) return null;
  const shown = zonedParts(new Date(ms), tz);
  const hour = shown.hour === 24 ? 0 : shown.hour;
  return `${String(hour).padStart(2, '0')}:${String(shown.minute).padStart(2, '0')}`;
}

function readWall(value, dated) {
  const v = value && typeof value === 'object' ? value : {};
  return {
    title: typeof v[dated.title] === 'string' ? v[dated.title] : '',
    day: YMD.test(v[dated.day]) ? v[dated.day] : null,
    time: dated.time && HM.test(v[dated.time]) ? v[dated.time] : null,
    endDay: dated.endDay && YMD.test(v[dated.endDay]) ? v[dated.endDay] : null,
    endTime: dated.endTime && HM.test(v[dated.endTime]) ? v[dated.endTime] : null,
    minutes: dated.minutes && Number.isFinite(v[dated.minutes]) && v[dated.minutes] > 0 && v[dated.minutes] <= 10080 ? Math.round(v[dated.minutes]) : null,
  };
}

function readInstant(value, dated) {
  const v = value && typeof value === 'object' ? value : {};
  const start = typeof v[dated.start] === 'string' && v[dated.start] ? v[dated.start] : null;
  return {
    title: typeof v[dated.title] === 'string' ? v[dated.title] : '',
    start,
    end: dated.end && typeof v[dated.end] === 'string' && v[dated.end] ? v[dated.end] : null,
    allDay: dated.allDay ? v[dated.allDay] === true : false,
  };
}

function holdsPointer(produce, value) {
  const field = produce.holds?.field;
  if (!field || !value || typeof value !== 'object') return false;
  const got = value[field];
  return Boolean(got && typeof got === 'object' && got.module && got.id);
}

// Wall clock onto an instant twin, read in `tz` (the trip's zone). No time means the whole day, with the end day as its last
// day. A time makes an instant; its end is the check-out (end day and end time, else the start's clock time) or the
// length in minutes, and none when neither is there or the end would not be after the start. A timed twin also keeps
// the zone it was written in (`dated.tz`), so a viewer elsewhere can be told.
function fieldsForTwin(wall, tz, dated) {
  if (!wall.day) return null;
  const patch = { [dated.title]: wall.title };
  if (!wall.time) {
    if (dated.allDay) patch[dated.allDay] = true;
    patch[dated.start] = wall.day;
    if (dated.end) patch[dated.end] = wall.endDay;
    if (dated.tz) patch[dated.tz] = null;
    return patch;
  }
  if (dated.allDay) patch[dated.allDay] = false;
  const start = instantOf(wall.day, wall.time, tz);
  patch[dated.start] = start;
  if (dated.end) {
    let end = null;
    if (wall.endDay && wall.endDay >= wall.day) end = instantOf(wall.endDay, wall.endTime || wall.time, tz);
    else if (wall.minutes) end = new Date(Date.parse(start) + wall.minutes * 60000).toISOString();
    patch[dated.end] = end && Date.parse(end) > Date.parse(start) ? end : null;
  }
  if (dated.tz) patch[dated.tz] = tz;
  return patch;
}

// An instant twin onto a wall-clock sender. A whole day leaves the time empty, unless the sender has a time: ticking
// "All day" on a copy never erases the sender's time or its end day (`current` is the sender as stored). A timed twin
// leaves the end day alone.
function fieldsForSender(instant, tz, dated, current) {
  const patch = { [dated.title]: instant.title };
  const whole = instant.allDay || (instant.start && YMD.test(instant.start));
  if (whole) {
    patch[dated.day] = instant.start && YMD.test(instant.start) ? instant.start : dayInZone(instant.start, tz);
    const timed = dated.time && current && HM.test(current[dated.time]);
    if (timed) return patch;
    if (dated.time) patch[dated.time] = null;
    if (dated.endDay) patch[dated.endDay] = !instant.end ? null : (YMD.test(instant.end) ? instant.end : dayInZone(instant.end, tz));
    return patch;
  }
  patch[dated.day] = instant.start ? dayInZone(instant.start, tz) : null;
  if (dated.time) patch[dated.time] = instant.start ? timeInZone(instant.start, tz) : null;
  return patch;
}

function changed(current, patch) {
  const base = current && typeof current === 'object' ? current : {};
  let diff = false;
  const next = { ...base };
  for (const [name, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (next[name] !== value) { next[name] = value; diff = true; }
  }
  return diff ? next : null;
}

function fillCreate(create, id, name) {
  const value = {};
  for (const [field, template] of Object.entries(create || {})) {
    value[field] = typeof template === 'string' ? template.replaceAll('{id}', id).replaceAll('{by}', name) : template;
  }
  return value;
}

function twinKey(produce, id) {
  return produce.key.replace('{id}', id);
}

function removeTwin(produce, to, scopeKey, by, asker) {
  deps.remove(to.module, scopeKey, twinKey(produce, to.id), by, asker);
}

// The pair is kept before the copy is written, so the copy's first change already reads as a copy and reaches only those who may
// see its original (plan-plan-calendar-sync.md, Permissions). No pair kept (the links are full), no copy; a copy that can't be
// written (413) takes its pair with it.
function createTwin(ref, wall, zone, by, taker, scopeKey, asker) {
  const patch = fieldsForTwin(wall, zone, taker.produce.dated);
  if (!patch) return;
  const id = deps.newId();
  const value = { ...fillCreate(taker.produce.create, id, deps.nameOf(asker || by)), ...patch };
  const to = { module: taker.moduleId, kind: taker.produce.kind, id, scope: ref.scope, space: ref.space };
  if (deps.addPair(ref, to, by) === false) return;
  try {
    deps.write(taker.moduleId, scopeKey, twinKey(taker.produce, id), value, by, asker);
  } catch (err) {
    deps.dropLinks(to);
    throw err;
  }
}

function updateTwin(pair, wall, zone, by, taker, scopeKey, asker) {
  const key = twinKey(taker.produce, pair.to.id);
  const current = deps.read(taker.moduleId, scopeKey, key);
  // A copy that is gone was hidden on purpose (deleting it detaches the pair): it is not made again. One a Clear holds for its
  // Undo is not gone yet: the pair stays as it is (an Undo brings the copy back and brings it up to date, resyncCopy; the end
  // of the hold detaches it), so a copy never comes back as a plain event.
  if (!current) {
    if (deps.isHeld && deps.isHeld(taker.moduleId, scopeKey, key)) return;
    return deps.detachPair(pair.to);
  }
  const patch = fieldsForTwin(wall, zone, taker.produce.dated);
  const next = patch && changed(current, patch);
  if (next) deps.write(taker.moduleId, scopeKey, key, next, by, asker);
}

// A dated sender keeps one twin in each kind that receives them. A sender that holds a pointer sends none.
// Server writes do not come back through afterWrite. A full store (413) skips that twin until the next change.
function mirrorOut(ref, produce, scopeKey, before, after, zone, by, asker) {
  if (produce.mirror !== 'out' || produce.dated?.form !== 'wall' || ref.scope !== 'space' || !deps.takers) return;
  const now = after == null ? { title: '', day: null, time: null, endDay: null } : readWall(after, produce.dated);
  const pairs = deps.pairsFrom(ref) || [];
  if (!now.day) {
    for (const pair of pairs) {
      if (pair.pair !== 'active') continue;
      const twin = deps.produceOf(pair.to.module, pair.to.kind);
      if (twin) removeTwin(twin, pair.to, scopeKey, by, asker);
    }
    // A hidden copy (a detached pair) is remembered while the object itself stays, so a day given back does not bring it back.
    if (pairs.length) deps.removePairs(ref, after != null);
    return;
  }
  if (holdsPointer(produce, after)) return;
  const wrote = tripZone(ref.module, produce, scopeKey) || zone;
  for (const taker of deps.takers(ref.module, produce.kind, ref.space)) {
    const pair = pairs.find((p) => p.to.module === taker.moduleId && p.to.kind === taker.produce.kind);
    try {
      if (!pair) createTwin(ref, now, wrote, by, taker, scopeKey, asker);
      else if (pair.pair === 'detached') continue; // hidden from that module for good (plan-plan-calendar-sync.md)
      else updateTwin(pair, now, wrote, by, taker, scopeKey, asker);
    } catch (err) {
      if (!err || err.status !== 413) throw err;
    }
  }
}

// What a copy's edit writes back to its original: null when `ref` is not an active copy, or its original can't be read; else
// the original (`from`, its produce, scope key and stored key), the original as stored (`current`) and as it would be after
// the edit (`next`, null when nothing mapped changes), and the zone the times are read in.
// The zone the copy's times are read in: the trip's, else the one the copy keeps (`dated.tz`, as stored before this write,
// else as written), and only then the writer's. A flight at 7:40 in Lisbon stays 7:40 when someone in another zone edits
// its copy; the writer's browser zone is the last resort, for a copy that keeps none.
function senderEdit(ref, produce, after, zone, before) {
  if (produce.mirror !== 'in' || produce.dated?.form !== 'instant' || !deps.pairTo) return null;
  const pair = deps.pairTo(ref);
  if (!pair || pair.pair !== 'active') return null;
  const sender = deps.produceOf(pair.from.module, pair.from.kind);
  if (!sender || sender.mirror !== 'out' || sender.dated?.form !== 'wall') return null;
  const senderScope = scopeKeyOfHolder(pair.from);
  if (!senderScope) return null;
  const senderKey = twinKey(sender, pair.from.id);
  const current = deps.read(pair.from.module, senderScope, senderKey);
  if (!current) return null;
  const kept = (v) => (produce.dated.tz && v && typeof v === 'object' ? acceptZone(v[produce.dated.tz]) : null);
  const wrote = tripZone(pair.from.module, sender, senderScope) || kept(before) || kept(after) || zone;
  const next = changed(current, fieldsForSender(readInstant(after, produce.dated), wrote, sender.dated, current));
  return { from: pair.from, sender, senderScope, senderKey, current, next, wrote };
}

// A twin's edit writes the sender. A twin with no pair is left alone. Deleting the twin detaches the pair, which
// stays as the record that it is hidden (it is never made again), and leaves the sender as it was. A repeating twin stays paired; the sender follows its first start.
// Who may make the edit is the route's to decide before the copy is written (writeBack below; GitHub #857).
function mirrorIn(ref, produce, scopeKey, after, zone, by, before = null) {
  if (produce.mirror !== 'in' || produce.dated?.form !== 'instant' || !deps.pairTo) return;
  if (after == null) {
    const pair = deps.pairTo(ref);
    if (pair && pair.pair === 'active') deps.detachPair(ref);
    return;
  }
  const edit = senderEdit(ref, produce, after, zone, before);
  if (!edit) return;
  const { from, sender, senderScope, senderKey, current, next, wrote } = edit;
  const sent = next || current;
  if (next) deps.write(from.module, senderScope, senderKey, next, by);
  // The copy then says what the sender says (its span, its zone, a time "All day" would not erase).
  const copy = changed(after, fieldsForTwin(readWall(sent, sender.dated), wrote, produce.dated));
  if (copy) deps.write(ref.module, scopeKey, twinKey(produce, ref.id), copy, by);
}

// A copy put back (a Clear's Undo) says again what its original says now: its title and dates as the original would send
// them, read in the zone an edit of the original would use (updateTwin: the trip's, else the writer's, here the one who undoes),
// so a copy's time does not depend on a clear in between. Nothing for a key that is not an active copy, or whose original's
// module is off (the copy stays as it was held; the original's next edit brings it up to date). A server write, as every write
// here; it throws what the write throws (413 when the module is full).
function resyncCopy({ module, scopeKey, key, by, tz }) {
  if (!deps) return;
  const found = deps.produceFor(module, key);
  if (!found || found.produce.mirror !== 'in' || found.produce.dated?.form !== 'instant') return;
  const ref = refOf(module, found.produce, found.id, scopeKey);
  const pair = ref && deps.pairTo(ref);
  if (!pair || pair.pair !== 'active') return;
  const sender = deps.produceOf(pair.from.module, pair.from.kind);
  const senderScope = scopeKeyOfHolder(pair.from);
  if (!sender || sender.mirror !== 'out' || sender.dated?.form !== 'wall' || !senderScope) return;
  const original = deps.read(pair.from.module, senderScope, twinKey(sender, pair.from.id));
  const copy = deps.read(module, scopeKey, key);
  if (!original || !copy) return;
  const wrote = tripZone(pair.from.module, sender, senderScope) || writerZone(tz);
  const patch = fieldsForTwin(readWall(original, sender.dated), wrote, found.produce.dated);
  const next = patch && changed(copy, patch);
  if (next) deps.write(module, scopeKey, key, next, by);
}

// What writing `after` at a copy's key would write back to its original, worked out and written nowhere, so a route can
// check the writer's rights on the original first: null when the key is not an active copy; else { original (its
// reference), key (the original's stored key), before (the original as stored), after (as it would be; null when the edit
// changes nothing mapped) }.
function writeBack({ module, scopeKey, key, before, after, tz }) {
  if (!deps || after == null) return null;
  const found = deps.produceFor(module, key);
  if (!found || found.produce.mirror !== 'in') return null;
  const ref = refOf(module, found.produce, found.id, scopeKey);
  if (!ref) return null;
  const edit = senderEdit(ref, found.produce, after, writerZone(tz), before);
  return edit ? { original: edit.from, key: edit.senderKey, before: edit.current, after: edit.next } : null;
}

// { module, scopeKey, key, before, after, by, tz, asker }. `asker` (a person's key) is who asked for the change when a
// page carried out their request (plan-agent-access.md, decision 9): it names the copy's `{by}` and its activity line, and
// raises nothing. `before` and `after` are the stored values; `after` is null
// when the object was deleted. A summary that did not change sends no refchange. A dated sender still updates
// its twin when a mapped field changed and the summary did not.
function afterWrite({ module, scopeKey, key, before, after, by, tz, asker }) {
  const zone = writerZone(tz);
  if (!deps) return;
  const found = deps.produceFor(module, key);
  if (!found) return;
  const ref = refOf(module, found.produce, found.id, scopeKey);
  if (!ref) return;
  const holders = deps.linksTo(ref);
  if (after == null) {
    try { mirrorOut(ref, found.produce, scopeKey, before, null, zone, by, asker); } catch (err) { if (!err || err.status !== 413) throw err; }
    try { mirrorIn(ref, found.produce, scopeKey, null, zone, by); } catch (err) { if (!err || err.status !== 413) throw err; }
    if (!holders.length) return;
    for (const holder of holders) {
      try { applyDelete(holder, ref, by); } catch { /* a holder that cannot be written waits */ }
    }
    bus.emit('refchange', { ref, change: 'deleted', holders, env: deps.environment() });
    return;
  }
  const beforeSummary = deps.summarize(module, found.produce, ref, found.id, before);
  const afterSummary = deps.summarize(module, found.produce, ref, found.id, after);
  if (holders.length && JSON.stringify(beforeSummary) !== JSON.stringify(afterSummary)) {
    for (const holder of holders) {
      try { applyFollow(holder, ref, beforeSummary, afterSummary, zone, by); } catch { /* a holder that cannot be written waits */ }
    }
    bus.emit('refchange', { ref, change: 'updated', holders, env: deps.environment() });
  }
  try { mirrorOut(ref, found.produce, scopeKey, before, after, zone, by, asker); } catch (err) { if (!err || err.status !== 413) throw err; }
  try { mirrorIn(ref, found.produce, scopeKey, after, zone, by, before); } catch (err) { if (!err || err.status !== 413) throw err; }
}

// Dated objects already stored, with no pair yet, get their twin once the kind says it sends them. Running it again
// changes nothing: a pair is the record. Timed values use the server's zone (TZ, then UTC). Personal objects are skipped.
function backfill() {
  if (!deps || !deps.senders) return 0;
  const zone = writerZone(undefined);
  let made = 0;
  for (const sender of deps.senders()) {
    if (sender.produce.mirror !== 'out' || sender.produce.dated?.form !== 'wall') continue;
    for (const scopeKey of sender.scopes) {
      if (!scopeKey.startsWith('space:')) continue;
      for (const row of sender.rows(scopeKey)) {
        const ref = refOf(sender.moduleId, sender.produce, row.id, scopeKey);
        if (!ref) continue;
        const wall = readWall(row.value, sender.produce.dated);
        if (!wall.day || holdsPointer(sender.produce, row.value)) continue;
        if ((deps.pairsFrom(ref) || []).length) continue;
        try { mirrorOut(ref, sender.produce, scopeKey, null, row.value, zone, row.by || ''); } catch (err) { if (!err || err.status !== 413) throw err; }
        if ((deps.pairsFrom(ref) || []).length) made += 1;
      }
    }
  }
  return made;
}

// Hear the refchange events of one environment only. Returns the function that stops listening.
function listen(env, fn) {
  const handler = (ev) => { if (ev.env === env) fn(ev); };
  bus.on('refchange', handler);
  return () => bus.off('refchange', handler);
}

module.exports = {
  writerZone,
  dayInZone,
  configure,
  afterWrite,
  writeBack,
  resyncCopy,
  backfill,
  listen,
};
