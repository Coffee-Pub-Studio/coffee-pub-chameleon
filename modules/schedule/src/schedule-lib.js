// The Schedule outline's pure rules (Planner - Projects): an entry's shape, the milestones' done and progress, the plan's
// progress, what may wait on what, and where each entry sits on the Timeline. No host, no page: the page script and
// modules/schedule/test/check-schedule-lib.mjs both run these.
//
// An entry, stored under `plan:<id>` in the space:
//   kind     'milestone' | 'work' | 'note'
//   title    up to 120 characters
//   start    YYYY-MM-DD or absent (a milestone's day; work's first day)
//   end      YYYY-MM-DD or absent (work's last day; never before start)
//   owners   people's keys (work)
//   waitsOn  ids of the entries it waits on (milestone and work)
//   ticked   a milestone ticked done by hand
//   done     milestone and work: true or false (a milestone: ticked, or every entry under it done). A note this page writes
//            has none, so the phase measure (server/phase-measure.js) does not count it; the server does not hold anyone to
//            that, so a note written some other way with a `done` would be counted.
//   progress a milestone with entries under it: how many are done, 0 to 100
//   phase    the id of one of the template's phases, or absent
//   tags     ids from the `tags` setting
//   notes    up to 2000 characters
//   parent   the id of the entry it sits under (the outline), or absent
//   order    the outline's order key (host.util.order)
//   by       who added it
//   ref      a pointer to the object it was made from, or absent
const SC_PREFIX = 'plan:';
const SC_KINDS = ['milestone', 'work', 'note'];
const SC_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SC_TITLE_MAX = 120;
const SC_NOTES_MAX = 2000;
const SC_LIST_MAX = 50;
// The days the plan holds: from 1900 to 2200. A day outside is no day (the entry reads as undated).
const SC_YEAR_MIN = 1900;
const SC_YEAR_MAX = 2200;
// The most weeks the Timeline draws (two years). An entry wholly outside the weeks drawn is listed under the Timeline instead,
// and a bar that runs past either end is cut there.
const SC_WEEKS_MAX = 104;

function scIsDay(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (y < SC_YEAR_MIN || y > SC_YEAR_MAX) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}
function scText(s, n) {
  return typeof s === 'string' ? s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, n) : '';
}
function scLine(s, n) {
  return typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '';
}
function scIds(list) {
  return [...new Set((Array.isArray(list) ? list : []).filter((x) => typeof x === 'string' && SC_ID.test(x)))].slice(0, SC_LIST_MAX);
}
function scKeys(list) {
  return [...new Set((Array.isArray(list) ? list : []).filter((x) => typeof x === 'string' && x && x.length <= 200))].slice(0, SC_LIST_MAX);
}
function scCleanRef(r) {
  if (!r || typeof r !== 'object' || typeof r.module !== 'string' || typeof r.kind !== 'string' || typeof r.id !== 'string') return null;
  const out = { module: r.module.slice(0, 64), kind: r.kind.slice(0, 32), id: r.id.slice(0, 128) };
  if (typeof r.scope === 'string') out.scope = r.scope.slice(0, 16);
  if (typeof r.space === 'string') out.space = r.space.slice(0, 64);
  return out;
}

// One entry as the page uses it, from whatever is stored (another version, a template's starter, a hand edit): never throws.
function scClean(id, raw) {
  const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const kind = SC_KINDS.includes(v.kind) ? v.kind : 'work';
  let start = scIsDay(v.start) ? v.start : '';
  let end = kind === 'work' && scIsDay(v.end) ? v.end : '';
  if (kind === 'note') start = '';
  if (kind === 'work') {
    if (start && !end) end = start;
    if (end && !start) start = end;
    if (start && end && end < start) end = start;
  }
  const e = {
    id: String(id),
    kind,
    title: scLine(v.title, SC_TITLE_MAX),
    start,
    end,
    owners: kind === 'work' ? scKeys(v.owners) : [],
    waitsOn: kind === 'note' ? [] : scIds(v.waitsOn).filter((x) => x !== String(id)),
    ticked: kind === 'milestone' ? v.ticked === true : false,
    done: kind === 'note' ? false : v.done === true,
    progress: kind === 'milestone' && Number.isInteger(v.progress) && v.progress >= 0 && v.progress <= 100 ? v.progress : null,
    phase: typeof v.phase === 'string' && /^[a-z][a-z0-9-]{0,40}$/.test(v.phase) ? v.phase : '',
    tags: scIds(v.tags),
    notes: scText(v.notes, SC_NOTES_MAX),
    parent: typeof v.parent === 'string' && SC_ID.test(v.parent) && v.parent !== String(id) ? v.parent : null,
    order: typeof v.order === 'string' && /^[0-9A-Za-z]{1,200}$/.test(v.order) ? v.order : '',
    by: typeof v.by === 'string' ? v.by.slice(0, 200) : '',
    ref: scCleanRef(v.ref),
  };
  if (kind === 'milestone' && e.ticked) e.done = true;
  return e;
}

// What is stored for an entry: only the fields its kind has, nothing empty, so a note carries no `done` and an entry with
// no day carries no `start` (no Calendar copy is made of it).
function scValue(e) {
  const out = { kind: e.kind, title: e.title };
  if (e.start) out.start = e.start;
  if (e.kind === 'work' && e.end) out.end = e.end;
  if (e.kind === 'work' && e.owners.length) out.owners = e.owners.slice();
  if (e.kind !== 'note' && e.waitsOn.length) out.waitsOn = e.waitsOn.slice();
  if (e.kind === 'milestone' && e.ticked) out.ticked = true;
  if (e.kind !== 'note') out.done = Boolean(e.done);
  if (e.kind === 'milestone' && e.progress !== null && e.progress !== undefined) out.progress = e.progress;
  if (e.phase) out.phase = e.phase;
  if (e.tags.length) out.tags = e.tags.slice();
  if (e.notes) out.notes = e.notes;
  if (e.parent) out.parent = e.parent;
  if (e.order) out.order = e.order;
  if (e.by) out.by = e.by;
  if (e.ref) out.ref = { ...e.ref };
  return out;
}

// What is wrong with an entry about to be saved, as one plain sentence, or ''. `label(key, o)` gives the plan's words.
function scProblem(e, o) {
  const label = (o && o.label) || ((k) => k);
  if (!e.title) return 'Give it a title.';
  if (e.kind === 'note') return '';
  if (o && o.datesRequired) {
    if (e.kind === 'milestone' && !e.start) return `This plan needs dates: give the ${label('milestone')} a day.`;
    if (e.kind === 'work' && (!e.start || !e.end)) return `This plan needs dates: give the ${label('work')} a start and an end.`;
  }
  if (e.kind === 'work' && e.start && e.end && e.end < e.start) return 'The end is before the start.';
  return '';
}

// The entries in the outline's order: each parent before its children, siblings by order key then id. An entry whose parent
// is not there sits at the top.
function scOrdered(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const byId = new Map(list.map((e) => [e.id, e]));
  const kids = new Map();
  const roots = [];
  for (const e of list) {
    const p = e.parent && byId.has(e.parent) && e.parent !== e.id ? e.parent : null;
    if (p) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(e); } else roots.push(e);
  }
  const cmp = (a, b) => (a.order && b.order && a.order !== b.order ? (a.order < b.order ? -1 : 1) : a.order && !b.order ? -1 : !a.order && b.order ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const out = [];
  const seen = new Set();
  // Depth first with a stack of its own, so a very long chain of parents never runs out of call stack.
  const walk = (start) => {
    const stack = [[start, 1]];
    while (stack.length) {
      const [e, level] = stack.pop();
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push({ entry: e, level });
      const cs = (kids.get(e.id) || []).slice().sort(cmp);
      for (let i = cs.length - 1; i >= 0; i -= 1) stack.push([cs[i], level + 1]);
    }
  };
  for (const r of roots.sort(cmp)) walk(r);
  for (const e of list) if (!seen.has(e.id)) walk(e); // a loop of parents: shown at the top, never lost
  return out;
}

// Each milestone's done and progress, from the entries under it (`rollup` is host.util.rollup's answer for the entries that are
// not notes: { <id>: { done, total } } for each that has entries under it). Answers the changes to write: [{ id, done, progress }]
// for each milestone whose stored done or progress is not what it should be.
function scMilestoneChanges(entries, rollup) {
  const out = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    if (e.kind !== 'milestone') continue;
    const r = rollup && rollup[e.id];
    const total = r && r.total > 0 ? r.total : 0;
    const doneUnder = total ? Math.min(r.done, total) : 0;
    const done = e.ticked || (total > 0 && doneUnder === total);
    const progress = total ? Math.round((doneUnder / total) * 100) : null;
    if (done !== e.done || progress !== e.progress) out.push({ id: e.id, done, progress });
  }
  return out;
}

// The plan's progress: { done, total } over its milestones or its work (the `progressBy` setting).
function scProgress(entries, by) {
  const kind = by === 'work' ? 'work' : 'milestone';
  let done = 0;
  let total = 0;
  for (const e of Array.isArray(entries) ? entries : []) {
    if (e.kind !== kind) continue;
    total += 1;
    if (e.done) done += 1;
  }
  return { done, total };
}

// Whether `id` waiting on `other` would make a loop (other already waits on id, however far down).
function scMakesLoop(entries, id, other) {
  if (id === other) return true;
  const byId = new Map((Array.isArray(entries) ? entries : []).map((e) => [e.id, e]));
  const stack = [other];
  const seen = new Set();
  while (stack.length) {
    const at = stack.pop();
    if (at === id) return true;
    if (seen.has(at)) continue;
    seen.add(at);
    const e = byId.get(at);
    if (e) for (const w of e.waitsOn) stack.push(w);
  }
  return false;
}

// Days, as whole days in UTC.
function scDayNumber(day) {
  const [y, m, d] = day.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}
function scDayOf(n) {
  const t = new Date(n * 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}
function scAddDays(day, n) { return scDayOf(scDayNumber(day) + n); }
// The Monday on or before a day.
function scMonday(day) {
  const n = scDayNumber(day);
  const weekday = (n + 3) % 7; // 1970-01-01 was a Thursday: 0 is Monday
  return scDayOf(n - ((weekday + 7) % 7));
}

// Whether an entry is late: not done, and its last day is before today.
function scLate(e, today) {
  if (!e || e.kind === 'note' || e.done) return false;
  const last = e.kind === 'work' ? e.end : e.start;
  return Boolean(last) && scIsDay(today) && last < today;
}

// The Timeline: weeks across, one row per dated milestone and work in the outline's order. `o.dayWidth` is pixels per day.
// Answers { from, days, width, weeks: [{ day, x }], rows: [{ id, kind, x, w, row, cut }], lines: [{ from, to }], undated: [id],
// outside: [id], today: x | null }. The range runs from the Monday before the first day to the Sunday after the last, at least
// six weeks and at most SC_WEEKS_MAX, and takes in today when today is within four weeks of it. When the days span more than
// that, the weeks drawn start at the first day, or half a year before today when the first day is earlier still; an entry
// wholly outside them is in `outside`, and a bar running past an end is cut there (`cut`: 'start', 'end' or 'both').
function scTimeline(entries, o) {
  const dayWidth = o && o.dayWidth > 0 ? o.dayWidth : 16;
  const today = o && scIsDay(o.today) ? o.today : '';
  const ordered = scOrdered(entries).map((x) => x.entry).filter((e) => e.kind !== 'note');
  const dated = ordered.filter((e) => e.start);
  const undated = ordered.filter((e) => !e.start).map((e) => e.id);
  let first = '';
  let last = '';
  for (const e of dated) {
    const a = e.start;
    const b = e.kind === 'work' && e.end ? e.end : e.start;
    if (!first || a < first) first = a;
    if (!last || b > last) last = b;
  }
  if (!first) {
    if (!today) return { from: '', days: 0, width: 0, weeks: [], rows: [], lines: [], undated, outside: [], today: null };
    first = today;
    last = today;
  }
  if (today && scDayNumber(today) >= scDayNumber(first) - 28 && scDayNumber(today) <= scDayNumber(last) + 28) {
    if (today < first) first = today;
    if (today > last) last = today;
  }
  let from = scMonday(scAddDays(first, -1));
  let days = scDayNumber(scAddDays(scMonday(last), 7)) - scDayNumber(from);
  if (days < 42) days = 42;
  if (days > SC_WEEKS_MAX * 7) {
    days = SC_WEEKS_MAX * 7;
    if (today && scDayNumber(today) - 182 > scDayNumber(first)) from = scMonday(scAddDays(today, -182));
  }
  const lo = scDayNumber(from);
  const hi = lo + days - 1; // the last day drawn
  const x = (day) => (scDayNumber(day) - scDayNumber(from)) * dayWidth;
  const weeks = [];
  for (let i = 0; i < days; i += 7) weeks.push({ day: scAddDays(from, i), x: i * dayWidth });
  const outside = [];
  const rows = [];
  for (const e of dated) {
    const a = scDayNumber(e.start);
    const b = scDayNumber(e.kind === 'work' && e.end ? e.end : e.start);
    if (b < lo || a > hi) { outside.push(e.id); continue; }
    const s = Math.max(a, lo);
    const t = Math.min(b, hi);
    const cut = a < lo && b > hi ? 'both' : a < lo ? 'start' : b > hi ? 'end' : '';
    rows.push({ id: e.id, kind: e.kind, x: (s - lo) * dayWidth, w: (t - s + 1) * dayWidth, row: rows.length, ...(cut ? { cut } : {}) });
  }
  const shown = new Set(rows.map((r) => r.id));
  const at = new Set(rows.map((r) => r.id));
  const lines = [];
  for (const e of dated) if (shown.has(e.id)) for (const w of e.waitsOn) if (at.has(w)) lines.push({ from: w, to: e.id });
  const todayX = today && scDayNumber(today) >= scDayNumber(from) && scDayNumber(today) < scDayNumber(from) + days ? x(today) : null;
  return { from, days, width: days * dayWidth, weeks, rows, lines, undated, outside, today: todayX };
}

// What is wrong with what an add action was sent (addMilestone, addWork, addNote), as one plain sentence, or ''. A day given
// must be one the plan holds; when the plan needs dates, a milestone needs its day and work a start or an end (one day given is
// a one-day span). Nothing is opened for a person to finish: the action is refused, with the reason.
function scActionProblem(kind, input, o) {
  const i = input && typeof input === 'object' ? input : {};
  const label = (o && o.label) || ((k) => k);
  const word = label(kind);
  if (typeof i.title !== 'string' || !scLine(i.title, SC_TITLE_MAX)) return `The ${word} needs a title.`;
  const fields = kind === 'milestone' ? ['date'] : kind === 'work' ? ['start', 'end'] : [];
  for (const f of fields) {
    const v = i[f];
    if (v !== undefined && v !== null && v !== '' && !scIsDay(v)) return `A day must be from ${SC_YEAR_MIN} to ${SC_YEAR_MAX}, written like 2026-10-14.`;
  }
  if (o && o.datesRequired) {
    if (kind === 'milestone' && !i.date) return `The ${word} needs a day.`;
    if (kind === 'work' && !i.start && !i.end) return `The ${word} needs a start and an end.`;
  }
  return '';
}

// A new entry from one of the add actions (addMilestone, addWork, addNote), before it is checked.
function scFromAction(kind, input, by) {
  const i = input && typeof input === 'object' ? input : {};
  const raw = { kind, title: i.title, notes: i.notes, by, ref: i.ref };
  if (kind === 'milestone') raw.start = i.date;
  if (kind === 'work') { raw.start = i.start || i.end; raw.end = i.end || i.start; }
  return scClean('new', raw);
}
