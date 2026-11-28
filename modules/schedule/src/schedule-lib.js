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
//   notes    up to 2000 characters: the plan's own notes (pulled work has none)
//   description  work pulled from an issue service only: the issue's text as plain text, at most 2000 characters (cut with an
//            ellipsis, then `source.cut`), read only here (documentation/plans/plan-github-full-sync.md, section 1)
//   assignees    work pulled from an issue service only: the logins assigned there that no member has linked, at most 10, read only
//   parent   the id of the entry it sits under (the outline), or absent
//   order    the outline's order key (host.util.order)
//   by       who added it
//   ref      a pointer to the object it was made from, or absent
//   column   work only: the id of its column on the board (see the board below), or absent
//   fields   work only: { <fieldId>: <optionId> }, one choice from each field the work has set (see the fields below), or absent
//
// A board, stored under `board:<id>` (the first and only one is `main`): { id, name, field: 'column', columns: [{ id, label, done? }],
// rowsBy? }. `done` stays stored as it always was and always equals the flag on the work's column (plan-projects-kanban.md).
//
// A field, stored under `field:<id>` (plan-github-two-way.md, "The roadmap fields in the space"): { id, label, options: [{ id, label }], order }.
// One choice each, like a board's columns. The space's own: never sent to a service that follows the plan (Area, Release status, Phase).
const SC_PREFIX = 'plan:';
const SC_BOARD_PREFIX = 'board:';
const SC_FIELD_PREFIX = 'field:';
const SC_FIELDS_MAX = 8;
const SC_SIZE_MAX = 999; // the most a size choice is worth
const SC_ONE_SIZE_SAY = 'A plan has one size field.';
const SC_FIELD_OPTIONS_MAX = 30;
const SC_FIELD_LABEL_MAX = 40;
const SC_ROWS_FIELD = /^field:[a-z][a-z0-9-]{0,40}$/;
const SC_BOARD_ID = /^[a-z][a-z0-9-]{0,40}$/;
const SC_COLOR = /^#[0-9a-f]{6}$/; // a column's colour: strict, lower case (the picker's answer)
const SC_COLUMN_LABEL_MAX = 40;
const SC_COLUMNS_MAX = 12;
const SC_ROWS_BY = ['milestone', 'owners'];
// What a board's `rowsBy` may be: a word above, or `field:<id>` (a row for each choice of that field).
const scRowsByOk = (v) => typeof v === 'string' && (SC_ROWS_BY.includes(v) || SC_ROWS_FIELD.test(v));
// The template's default columns (the `boardColumns` setting). Only `done` carries the flag in either set.
const SC_BOARD_SETS = Object.freeze({
  priority: Object.freeze([['inbox', 'Inbox'], ['now', 'Now'], ['next', 'Next'], ['later', 'Later'], ['done', 'Done', true]]),
  stages: Object.freeze([['todo', 'To do'], ['doing', 'Doing'], ['done', 'Done', true]]),
});
const SC_KINDS = ['milestone', 'work', 'note'];
const SC_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SC_TITLE_MAX = 120;
const SC_NOTES_MAX = 2000;
const SC_DESCRIPTION_MAX = 2000; // characters, as the server cuts it (server/issues.js, DESCRIPTION_MAX)
const SC_ASSIGNEES_MAX = 10;
const SC_SOURCE_LABELS_MAX = 30;
const SC_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/; // a login as GitHub makes them, or a bot's
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
// Text as scText makes it, cut at `n` characters (never inside a surrogate pair), as the server cuts an issue's text.
function scChars(s, n) {
  const t = scText(s, 4 * n);
  return t.length <= n ? t : Array.from(t).slice(0, n).join('');
}
// Logins assigned on an issue service: each once, at most SC_ASSIGNEES_MAX.
function scLogins(list) {
  return [...new Set((Array.isArray(list) ? list : []).filter((x) => typeof x === 'string' && SC_LOGIN.test(x)))].slice(0, SC_ASSIGNEES_MAX);
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

// Where pulled work came from (plan-github-pull.md): { from, repo, number, url, updated, cut?, labels? } for an issue, { from, repo,
// milestone, due? } for a milestone. `cut`: true when the stored description is shorter than the issue's text; `labels`: the issue's
// labels past the `tags` setting's rows, at most 30 names (plan-github-full-sync.md, section 1). Kept as the pull wrote it so a save
// from a page does not drop it; a link is kept only when it is an https address.
function scCleanSource(r) {
  if (!r || typeof r !== 'object' || typeof r.from !== 'string' || typeof r.repo !== 'string' || !r.from || !r.repo) return null;
  const out = { from: r.from.slice(0, 32), repo: r.repo.slice(0, 200) };
  if (Number.isInteger(r.number) && r.number > 0) out.number = r.number;
  if (Number.isInteger(r.milestone) && r.milestone > 0) out.milestone = r.milestone;
  if (typeof r.url === 'string' && /^https:\/\/[^\s]{1,500}$/.test(r.url)) out.url = r.url;
  if (typeof r.due === 'string' && scIsDay(r.due)) out.due = r.due;
  if (typeof r.updated === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]{8,12}Z$/.test(r.updated)) out.updated = r.updated; // when the service last changed it: a pull never writes older data over newer
  if (r.cut === true) out.cut = true;
  if (Array.isArray(r.labels)) {
    const labels = [...new Set(r.labels.filter((x) => typeof x === 'string' && x.length >= 1 && x.length <= 50))].slice(0, SC_SOURCE_LABELS_MAX);
    if (labels.length) out.labels = labels;
  }
  return out;
}
// What a person is told on a pulled entry while the pull is on.
const SC_PULLED_SAY = 'This comes from GitHub. Change it there.';
// What a person is told on pulled work in a space that writes back, for what GitHub cannot delete or change from here.
const SC_NO_DELETE_SAY = "GitHub issues can't be deleted from here. Close it, or delete it on GitHub.";

// The choices a piece of work carries, as { fieldId: optionId }: ids only, at most SC_FIELDS_MAX, anything else dropped.
function scCleanFieldValues(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const k of Object.keys(raw)) {
    if (Object.keys(out).length >= SC_FIELDS_MAX) break;
    if (SC_BOARD_ID.test(k) && typeof raw[k] === 'string' && SC_BOARD_ID.test(raw[k])) out[k] = raw[k];
  }
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
    description: kind === 'work' ? scChars(v.description, SC_DESCRIPTION_MAX) : '',
    assignees: kind === 'work' ? scLogins(v.assignees) : [],
    parent: typeof v.parent === 'string' && SC_ID.test(v.parent) && v.parent !== String(id) ? v.parent : null,
    order: typeof v.order === 'string' && /^[0-9A-Za-z]{1,200}$/.test(v.order) ? v.order : '',
    by: typeof v.by === 'string' ? v.by.slice(0, 200) : '',
    ref: scCleanRef(v.ref),
    source: scCleanSource(v.source),
    rank: typeof v.rank === 'string' && /^[0-9A-Za-z]{1,200}$/.test(v.rank) ? v.rank : '', // the order inside a board column (kept as stored; the order of a column: scCardOrder)
    fields: kind === 'work' ? scCleanFieldValues(v.fields) : {}, // { fieldId: optionId }, kept as stored (a choice the field no longer has is simply not shown)
  };
  if (kind === 'work' && typeof v.column === 'string' && SC_BOARD_ID.test(v.column)) e.column = v.column;
  if (kind === 'work' && e.done && scIsDay(v.doneOn)) e.doneOn = v.doneOn; // the day it became done (the burndown's Done line); only while it is done
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
  if (e.kind === 'work' && e.description) out.description = e.description;
  if (e.kind === 'work' && e.assignees && e.assignees.length) out.assignees = e.assignees.slice();
  if (e.parent) out.parent = e.parent;
  if (e.order) out.order = e.order;
  if (e.by) out.by = e.by;
  if (e.ref) out.ref = { ...e.ref };
  if (e.source) out.source = { ...e.source };
  if (e.rank) out.rank = e.rank;
  if (e.kind === 'work' && e.column) out.column = e.column;
  if (e.kind === 'work' && e.done && e.doneOn) out.doneOn = e.doneOn;
  if (e.kind === 'work' && e.fields && Object.keys(e.fields).length) out.fields = { ...e.fields };
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

// Who an entry made by an action is recorded as added by: the asker's key (a person's key, which "Added by" looks up as a name), else
// the key of the person whose page carries it out. `ctx` is what the bus gave the handler: { from, by, byKey }.
function scAddedBy(ctx, userKey) {
  const k = ctx && typeof ctx.byKey === 'string' ? ctx.byKey.trim() : '';
  return (k && k.length <= 200 ? k : '') || (typeof userKey === 'string' ? userKey : '');
}

// The people keys an `owners` input names: a list (or one text, split at commas) of keys or display names as list_members shows
// them, ignoring case and spaces. A key wins over a name. Each person once. `people`: [{ key, name }]; `o.space`: the space word.
// Answers { owners, problem }: a name two people share, or a person who is not here, is refused with one sentence and nothing is guessed.
function scOwnersFor(value, people, o) {
  const space = (o && o.space) || 'space';
  const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : null;
  if (!list) return { owners: null, problem: 'Name the people as a list, separated by commas.' };
  const folk = (Array.isArray(people) ? people : []).filter((p) => p && typeof p.key === 'string' && p.key);
  const owners = [];
  for (const item of list) {
    if (typeof item !== 'string') return { owners: null, problem: 'Name the people as a list, separated by commas.' };
    const name = item.trim();
    if (!name) continue;
    const low = name.toLowerCase();
    let hit = folk.filter((p) => p.key === name);
    if (!hit.length) hit = folk.filter((p) => p.key.toLowerCase() === low);
    if (!hit.length) hit = folk.filter((p) => typeof p.name === 'string' && p.name.trim().toLowerCase() === low);
    if (hit.length > 1) return { owners: null, problem: `Two people are called ${name}; use the key.` };
    if (!hit.length) return { owners: null, problem: `That person is not in this ${space}. Use list_members to see who is.` };
    if (!owners.includes(hit[0].key)) owners.push(hit[0].key);
  }
  return { owners, problem: '' };
}

// --- the board -----------------------------------------------------------------------------------------------------------------

// A board as stored, cleaned, or null when it can't be used: no columns, or no column with the done flag, or none without it.
function scCleanBoard(id, raw) {
  const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!v || !Array.isArray(v.columns)) return null;
  const seen = new Set();
  const columns = [];
  for (const c of v.columns) {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !SC_BOARD_ID.test(c.id) || seen.has(c.id)) continue;
    const label = scLine(c.label, SC_COLUMN_LABEL_MAX);
    if (!label || columns.length >= SC_COLUMNS_MAX) continue;
    seen.add(c.id);
    const col = c.done === true ? { id: c.id, label, done: true } : { id: c.id, label };
    if (typeof c.color === 'string' && SC_COLOR.test(c.color)) col.color = c.color;
    columns.push(col);
  }
  if (!columns.some((c) => c.done) || !columns.some((c) => !c.done)) return null;
  const board = { id: String(id), name: scLine(v.name, SC_COLUMN_LABEL_MAX) || 'Board', field: 'column', columns };
  if (scRowsByOk(v.rowsBy)) board.rowsBy = v.rowsBy;
  return board;
}
// What is stored for a board: nothing empty.
function scBoardValue(board) {
  const out = { id: board.id, name: board.name, field: 'column', columns: board.columns.map((c) => ({ id: c.id, label: c.label, ...(c.done ? { done: true } : {}), ...(c.color ? { color: c.color } : {}) })) };
  if (board.rowsBy) out.rowsBy = board.rowsBy;
  return out;
}
// The template's default board for a `boardColumns` value (anything else is the default, `stages`).
// `label` (optional) is the module's own word lookup (host.util.label, ctx.util.label): a column's name is the template's word for
// `board-<id>` ("board-inbox") when it has one, else the English name above, so a template can rename the default columns.
function scDefaultBoard(set, label) {
  const rows = SC_BOARD_SETS[set] || SC_BOARD_SETS.stages;
  const name = (id, plain) => {
    const key = `board-${id}`;
    let w = '';
    try { w = typeof label === 'function' ? label(key) : ''; } catch (err) { w = ''; }
    return typeof w === 'string' && w.trim() && w !== key ? scLine(w, SC_COLUMN_LABEL_MAX) || plain : plain;
  };
  return { id: 'main', name: 'Board', field: 'column', columns: rows.map(([id, plain, done]) => (done ? { id, label: name(id, plain), done: true } : { id, label: name(id, plain) })) };
}
// The space's board: the stored `board:main` when it reads, else the template's default. `stored` is the value under `board:main`
// or null/undefined; `set` the `boardColumns` setting.
function scBoardFrom(stored, set, label) {
  return scCleanBoard('main', stored) || scDefaultBoard(set, label);
}
// The column a piece of work is in: its own when the board has it, else the first done column if it is done, else the first
// column without the flag. Nothing is written until the work is next changed.
function scColumnOf(e, board) {
  const cols = board.columns;
  const own = e && e.column ? cols.find((c) => c.id === e.column) : null;
  if (own) return own;
  return (e && e.done ? cols.find((c) => c.done) : cols.find((c) => !c.done)) || cols[0];
}
// Today for an action (a server run has no page clock): the day of `ctx.now` as `ctx.util.ymd` writes it, or '' when it can't be read
// (work then becomes done with no day, which the burndown counts as not yet placed).
function scTodayOf(ctx) {
  try {
    const d = ctx && ctx.now !== undefined ? new Date(ctx.now) : null;
    const day = d && !Number.isNaN(d.getTime()) && ctx.util && typeof ctx.util.ymd === 'function' ? ctx.util.ymd(d) : '';
    return scIsDay(day) ? day : '';
  } catch (err) { return ''; }
}
// The day work became done (`doneOn`), kept with `done`: work that turns done is stamped with `today` (when a day is known, else it has
// none), work that stays done keeps its day, and work that is not done has none. `was` is the work before, `next` after; `next` is returned.
function scDoneOn(was, next, today) {
  if (!next || next.kind !== 'work') return next;
  const out = { ...next };
  if (!out.done) { delete out.doneOn; return out; }
  if (was && was.done && was.doneOn) out.doneOn = was.doneOn;
  else if (scIsDay(today)) out.doneOn = today;
  else delete out.doneOn;
  return out;
}
// Moves work to a column: sets `column`, and `done` to the column's flag. Answers { entry } or { problem }. A milestone's done
// follows from its work (scMilestoneChanges), so the caller settles milestones in the same change.
function scSetColumn(e, columnId, board, o) {
  if (!e || e.kind !== 'work') return { entry: null, problem: 'Only work moves on the board.' };
  const col = typeof columnId === 'string' ? board.columns.find((c) => c.id === columnId.trim()) : null;
  if (!col) return { entry: null, problem: `There is no column called ${scLine(typeof columnId === 'string' ? columnId : '', SC_COLUMN_LABEL_MAX) || 'that'}.` };
  return { entry: scDoneOn(e, { ...e, column: col.id, done: Boolean(col.done) }, o && o.today), problem: '' };
}
// --- the order inside a column (plan-github-two-way.md, build order step 5) ---------------------------------------------------------
// The space's own, never sent to GitHub: each piece of work may hold a `rank`, a short string of digits and letters that sorts as plain
// text (0-9, then A-Z, then a-z), so a move between two cards writes one value.
//  - Order in a column: ranked work first by rank (a tie by id), then work with no rank by the plan's order before ranks: the end day
//    (none last), then its place in the outline. So work nobody has ordered (everything made before, and an issue on its first pull) keeps
//    its old order, and sits below the ranked work, which is the bottom of its column.
//  - A pull gives no rank: it writes none and keeps the one stored (server/issues.js), so a pull never reorders a column or writes for it.
//  - A move puts a card between two (scRankBetween): a rank no longer than SC_RANK_SHORT. A card that has none, above where a card
//    lands, is ranked first, in order, so ranked work always comes first. A column that has run out of room (ranks too long, or two the
//    same) is spread again: every card in it gets an even three-or-four-digit rank (scSpreadRanks). Both are rare and are the only time
//    a move writes more than the one card, and a write of rank alone changes nothing on GitHub.
//  - Into another column: where it was dropped, else (the keyboard, the menu, the tick, setColumn without `before`) the bottom.
const SC_RANK_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const SC_RANK_SHORT = 24;
// A rank after `a` and before `b` ('' for no lower end, null for no upper end); never ends in the lowest digit, so there is always room.
function scRankBetween(a, b) {
  const lo = typeof a === 'string' ? a : '';
  const hi = typeof b === 'string' && b ? b : null;
  if (hi !== null && lo >= hi) return '';
  let n = 0;
  if (hi !== null) { while ((lo[n] || '0') === hi[n]) n += 1; if (n > 0) return hi.slice(0, n) + scRankBetween(lo.slice(n), hi.slice(n)); }
  const da = lo ? SC_RANK_DIGITS.indexOf(lo[0]) : 0;
  const db = hi !== null ? SC_RANK_DIGITS.indexOf(hi[0]) : SC_RANK_DIGITS.length;
  if (da < 0 || db < 0) return '';
  if (db - da > 1) return SC_RANK_DIGITS[Math.round((da + db) / 2)];
  if (hi !== null && hi.length > 1) return hi.slice(0, 1);
  return SC_RANK_DIGITS[da] + scRankBetween(lo.slice(1), null);
}
// n evenly spaced ranks, in order, none ending in the lowest digit.
function scSpreadRanks(n) {
  const out = [];
  const base = SC_RANK_DIGITS.length;
  let width = 3;
  while (Math.pow(base, width) / (n + 1) < base && width < 6) width += 1;
  const step = Math.floor(Math.pow(base, width) / (n + 1));
  for (let i = 1; i <= n; i += 1) {
    let v = i * step;
    if (v % base === 0) v += 1;
    let t = '';
    for (let k = 0; k < width; k += 1) { t = SC_RANK_DIGITS[v % base] + t; v = Math.floor(v / base); }
    out.push(t);
  }
  return out;
}
// The order of work in cards: the compare function of `entries` (ranked first, then the end day, then the outline), the same everywhere.
function scCardOrder(entries) {
  const place = new Map(scOrdered(entries).map((x, i) => [x.entry.id, i]));
  const day = (e) => e.end || e.start || '';
  return (x, y) => {
    if (x.rank || y.rank) {
      if (!x.rank) return 1;
      if (!y.rank) return -1;
      if (x.rank !== y.rank) return x.rank < y.rank ? -1 : 1;
      return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
    }
    const a = day(x);
    const c = day(y);
    if (a !== c) return !a ? 1 : !c ? -1 : a < c ? -1 : 1;
    return (place.get(x.id) || 0) - (place.get(y.id) || 0);
  };
}
// Where work `e` (already set to column `columnId`) goes in that column: at the end, or in front of the work `beforeId`. Answers
// { entry, others }: `e` with its rank, and the other work that needed one or a new one (written with it).
function scPlace(entries, e, columnId, board, beforeId) {
  const cmp = scCardOrder(entries);
  const list = entries.filter((x) => x.kind === 'work' && x.id !== e.id && scColumnOf(x, board).id === columnId).sort(cmp);
  const found = beforeId ? list.findIndex((x) => x.id === beforeId) : -1;
  const at = found >= 0 ? found : list.length;
  const before = list.slice(0, at);
  const unranked = before.filter((x) => !x.rank);
  const lower = before.filter((x) => x.rank).map((x) => x.rank).pop() || '';
  const next = list[at];
  const upper = !unranked.length && next && next.rank ? next.rank : null;
  const ranks = [];
  let last = lower;
  for (let i = 0; i <= unranked.length; i += 1) {
    const r = scRankBetween(last, upper);
    if (!r || r.length > SC_RANK_SHORT || r <= last || (upper !== null && r >= upper)) { ranks.length = 0; break; }
    ranks.push(r);
    last = r;
  }
  if (ranks.length) {
    const others = unranked.map((x, i) => ({ ...x, rank: ranks[i] }));
    return { entry: { ...e, rank: ranks[unranked.length] }, others };
  }
  // No room: every card in the column is ranked again, evenly, with this one at its place.
  const all = list.slice(0, at).concat([e], list.slice(at));
  const spread = scSpreadRanks(all.length);
  const out = all.map((x, i) => (x.rank === spread[i] ? x : { ...x, rank: spread[i] }));
  return { entry: out[at], others: out.filter((x, i) => i !== at && x !== all[i]) };
}
const SC_KEEP_DONE = 'Keep at least one column that counts as done.';
const SC_KEEP_OPEN = 'Keep at least one column that does not count as done.';
// The entries that change when `rewrite(work)` gives their new form (work only), with the milestones' done and progress settled
// after it: [entry, ...] as they would be saved. `o.rollup(entries without notes)` is host.util.rollup's answer.
function scSettled(entries, rewrite, o) {
  const next = entries.map((e) => (e.kind === 'work' ? rewrite(e) : e));
  const changed = new Map();
  next.forEach((e, i) => { if (e !== entries[i]) changed.set(e.id, e); });
  const roll = o && typeof o.rollup === 'function' ? o.rollup(next.filter((x) => x.kind !== 'note')) : {};
  for (const c of scMilestoneChanges(next, roll)) {
    const m = changed.get(c.id) || next.find((x) => x.id === c.id);
    changed.set(c.id, { ...m, done: c.done, progress: c.progress });
  }
  return [...changed.values()];
}
// A column's done flag changed: { board, entries } (the work in it with `done` rewritten, and the milestones that follow), or { problem }.
function scSetColumnFlag(board, entries, columnId, done, o) {
  const col = board.columns.find((c) => c.id === columnId);
  if (!col) return { problem: `There is no column called ${scLine(String(columnId), SC_COLUMN_LABEL_MAX)}.` };
  if (typeof done !== 'boolean') return { problem: 'Say whether the column counts as done: true or false.' };
  if (Boolean(col.done) === done) return { board, entries: [] };
  if (!done && board.columns.filter((c) => c.done).length < 2) return { problem: SC_KEEP_DONE };
  if (done && board.columns.filter((c) => !c.done).length < 2) return { problem: SC_KEEP_OPEN };
  const next = { ...board, columns: board.columns.map((c) => (c.id === columnId ? { id: c.id, label: c.label, ...(done ? { done: true } : {}), ...(c.color ? { color: c.color } : {}) } : c)) };
  const out = scSettled(entries, (e) => (scColumnOf(e, board).id === columnId && e.done !== done ? scDoneOn(e, { ...e, done }, o && o.today) : e), o);
  return { board: next, entries: out };
}
// Deletes a column; its work moves to `toId` and takes that column's flag. { board, entries } or { problem }.
function scDeleteColumn(board, columnId, toId, entries, o) {
  const col = board.columns.find((c) => c.id === columnId);
  if (!col) return { problem: `There is no column called ${scLine(String(columnId), SC_COLUMN_LABEL_MAX)}.` };
  if (board.columns.length < 2) return { problem: 'Keep at least one column.' };
  if (col.done && board.columns.filter((c) => c.done).length < 2) return { problem: SC_KEEP_DONE };
  if (!col.done && board.columns.filter((c) => !c.done).length < 2) return { problem: SC_KEEP_OPEN };
  const to = toId !== columnId ? board.columns.find((c) => c.id === toId) : null;
  if (!to) return { problem: 'Choose another column to take its work.' };
  const next = { ...board, columns: board.columns.filter((c) => c.id !== columnId) };
  const out = scSettled(entries, (e) => (scColumnOf(e, board).id === columnId ? scDoneOn(e, { ...e, column: to.id, done: Boolean(to.done) }, o && o.today) : e), o);
  return { board: next, entries: out };
}
// A fresh id for a column from its name: lower case letters, digits and dashes, a number added when taken.
function scColumnId(label, board) {
  let base = scLine(label, SC_COLUMN_LABEL_MAX).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!/^[a-z]/.test(base)) base = `c-${base}`.replace(/-$/, '');
  base = base.slice(0, 36).replace(/-$/, '') || 'column';
  const taken = new Set(board.columns.map((c) => c.id));
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  return id;
}
// Adds a column after `afterId` (at the end when not given). { board, column } or { problem }.
function scAddColumn(board, label, afterId) {
  const text = scLine(label, 10000);
  if (!text) return { problem: 'Give the column a name.' };
  if ([...text].length > SC_COLUMN_LABEL_MAX) return { problem: `A column name is at most ${SC_COLUMN_LABEL_MAX} characters.` };
  if (board.columns.length >= SC_COLUMNS_MAX) return { problem: `A board has at most ${SC_COLUMNS_MAX} columns.` };
  const column = { id: scColumnId(text, board), label: text };
  const at = board.columns.findIndex((c) => c.id === afterId);
  const columns = board.columns.slice();
  columns.splice(at < 0 ? columns.length : at + 1, 0, column);
  return { board: { ...board, columns }, column };
}
// Renames a column; its id, and so every card's `column`, stays as it was.
function scRenameColumn(board, columnId, label) {
  if (!board.columns.some((c) => c.id === columnId)) return { problem: `There is no column called ${scLine(String(columnId), SC_COLUMN_LABEL_MAX)}.` };
  const text = scLine(label, 10000);
  if (!text) return { problem: 'Give the column a name.' };
  if ([...text].length > SC_COLUMN_LABEL_MAX) return { problem: `A column name is at most ${SC_COLUMN_LABEL_MAX} characters.` };
  return { board: { ...board, columns: board.columns.map((c) => (c.id === columnId ? { ...c, label: text } : c)) } };
}
// Sets a column's colour (a strict lower case #rrggbb, as the picker answers) or takes it off ('' or null). The colour is the space's own
// and changes nothing else about the column. { board } or { problem }.
function scSetColumnColor(board, columnId, color) {
  const col = board.columns.find((c) => c.id === columnId);
  if (!col) return { problem: `There is no column called ${scLine(String(columnId), SC_COLUMN_LABEL_MAX)}.` };
  const off = color === '' || color === null || color === undefined;
  if (!off && !(typeof color === 'string' && SC_COLOR.test(color))) return { problem: 'A colour is a # and six lower case hex digits.' };
  const next = off ? (({ color: gone, ...rest }) => rest)(col) : { ...col, color };
  return { board: { ...board, columns: board.columns.map((c) => (c.id === columnId ? next : c)) } };
}
// The stored board value with one column's colour set or taken off, and nothing else touched: every key, its order and every other column
// exactly as `raw` holds them (a board written by a service's pull is not rebuilt, and the server lets a followed board's colour through
// only when that is all that differs). Answers the new value, or null when `raw` is not a stored board with that column or the colour is
// not '' or a strict #rrggbb.
function scColourBoardValue(raw, columnId, color) {
  const off = color === '' || color === null || color === undefined;
  if (!off && !(typeof color === 'string' && SC_COLOR.test(color))) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.columns)) return null;
  if (!raw.columns.some((c) => c && c.id === columnId)) return null;
  const columns = raw.columns.map((c) => {
    if (!c || c.id !== columnId) return c;
    const { color: was, ...rest } = c;
    return off ? rest : { ...rest, color };
  });
  return { ...raw, columns };
}
// Moves a column `by` places (-1 left, 1 right).
function scMoveColumn(board, columnId, by) {
  const from = board.columns.findIndex((c) => c.id === columnId);
  if (from < 0) return { problem: `There is no column called ${scLine(String(columnId), SC_COLUMN_LABEL_MAX)}.` };
  const to = from + (by < 0 ? -1 : 1);
  if (to < 0 || to >= board.columns.length) return { board };
  const columns = board.columns.slice();
  [columns[from], columns[to]] = [columns[to], columns[from]];
  return { board: { ...board, columns } };
}

// --- the fields (plan-github-two-way.md, "The roadmap fields in the space") -------------------------------------------------------
// Area, Release status and Phase, or whatever a plan needs: each a `field:<id>` record with choices, and each piece of work holds one
// choice per field in `fields`. The space's own, never sent anywhere: in a space that follows a service, a field is not a label.
// Defining one needs the `columns` right (the server's guard on `field:`); setting a choice on work needs `edit`.

// A field as stored, cleaned, or null when it can't be used. `order` places it among the fields.
function scCleanField(id, raw) {
  const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!v || typeof id !== 'string' || !SC_BOARD_ID.test(id)) return null;
  const label = scLine(v.label, SC_FIELD_LABEL_MAX);
  if (!label) return null;
  const seen = new Set();
  const options = [];
  for (const o of Array.isArray(v.options) ? v.options : []) {
    if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !SC_BOARD_ID.test(o.id) || seen.has(o.id)) continue;
    const text = scLine(o.label, SC_FIELD_LABEL_MAX);
    if (!text || options.length >= SC_FIELD_OPTIONS_MAX) continue;
    seen.add(o.id);
    const value = Number.isInteger(o.value) && o.value >= 0 && o.value <= SC_SIZE_MAX ? o.value : null;
    options.push(value === null ? { id: o.id, label: text } : { id: o.id, label: text, value });
  }
  const f = { id, label, options, order: Number.isInteger(v.order) && v.order >= 0 && v.order < 1000 ? v.order : 0 };
  if (v.size === true) f.size = true; // the plan's size field: its choices' numbers are what the burndown counts
  return f;
}
// What is stored for a field.
function scFieldValue(f) {
  const out = { id: f.id, label: f.label, options: f.options.map((o) => (typeof o.value === 'number' ? { id: o.id, label: o.label, value: o.value } : { id: o.id, label: o.label })), order: f.order || 0 };
  if (f.size) out.size = true;
  return out;
}
// The fields the space has, in order, from the rows under `field:` ([{ key, value }]).
function scFieldsFrom(rows) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r.key !== 'string' || !r.key.startsWith(SC_FIELD_PREFIX)) continue;
    const f = scCleanField(r.key.slice(SC_FIELD_PREFIX.length), r.value);
    if (f) out.push(f);
  }
  out.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // A plan has one size field: the first keeps the flag, any other is an ordinary field.
  let sized = false;
  for (const f of out) { if (f.size && sized) delete f.size; else if (f.size) sized = true; }
  return out.slice(0, SC_FIELDS_MAX);
}
// The size field the `sizing` setting stands for while the plan has none stored: points (1, 2, 3, 5, 8, 13) or T-shirt sizes (XS to XL
// worth 1, 2, 3, 5, 8). It is read, not written, until someone edits the fields (as the board's default columns are).
const SC_SIZE_SETS = {
  points: [['p1', '1', 1], ['p2', '2', 2], ['p3', '3', 3], ['p5', '5', 5], ['p8', '8', 8], ['p13', '13', 13]],
  tshirt: [['xs', 'XS', 1], ['s', 'S', 2], ['m', 'M', 3], ['l', 'L', 5], ['xl', 'XL', 8]],
};
function scDefaultSizeField(set) {
  const rows = SC_SIZE_SETS[set];
  return rows ? { id: 'size', label: 'Size', options: rows.map(([id, label, value]) => ({ id, label, value })), order: 999, size: true } : null;
}
// The plan's fields with the setting's size field added when none is stored (and its id is free). `fields` is scFieldsFrom's answer.
function scFieldsWithSize(fields, set) {
  let list = Array.isArray(fields) ? fields : [];
  list = list.filter((f) => !f.virtual);
  if (list.some((f) => f.size)) return list;
  const d = scDefaultSizeField(set);
  return d && !list.some((f) => f.id === d.id) && list.length < SC_FIELDS_MAX ? list.concat([{ ...d, virtual: true }]) : list; // `virtual`: not stored yet
}
// The size field of `fields` (scFieldsWithSize's answer), or null: sizing is on when there is one.
const scSizeFieldOf = (fields) => (Array.isArray(fields) ? fields.find((f) => f.size) || null : null);
// What a piece of work is sized at: the number of its choice in the size field, or 0 when it has none (or the choice has no number).
function scSizeOf(e, field) {
  const oid = field && e && e.fields ? e.fields[field.id] : '';
  const o = oid ? field.options.find((x) => x.id === oid) : null;
  return o && typeof o.value === 'number' ? o.value : 0;
}
// A fresh id from a name: lower case letters, digits and dashes, a number added when taken.
function scSlug(label, taken) {
  let base = scLine(label, SC_FIELD_LABEL_MAX).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!/^[a-z]/.test(base)) base = `f-${base}`.replace(/-$/, '');
  base = base.slice(0, 36).replace(/-$/, '') || 'field';
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  return id;
}
const scFieldName = (text) => {
  const t = scLine(text, 10000);
  if (!t) return { problem: 'Give it a name.' };
  if ([...t].length > SC_FIELD_LABEL_MAX) return { problem: `A name is at most ${SC_FIELD_LABEL_MAX} characters.` };
  return { text: t };
};
// The editing rules, on a list of fields; each answers { fields, ... } or { problem }. Values on work are not touched here: the page
// writes the work these changes leave with a choice that is gone (scFieldsRewrite).
function scAddField(fields, label) {
  const n = scFieldName(label);
  if (n.problem) return n;
  if (fields.length >= SC_FIELDS_MAX) return { problem: `A plan has at most ${SC_FIELDS_MAX} fields.` };
  const field = { id: scSlug(n.text, new Set(fields.map((f) => f.id))), label: n.text, options: [], order: fields.length };
  return { fields: [...fields, field], field };
}
function scRenameField(fields, id, label) {
  if (!fields.some((f) => f.id === id)) return { problem: 'That field is not there.' };
  const n = scFieldName(label);
  if (n.problem) return n;
  return { fields: fields.map((f) => (f.id === id ? { ...f, label: n.text } : f)) };
}
// Makes a field the plan's size field, or not. A plan has one: another field's flag is not taken off here, it is refused.
function scSetFieldSize(fields, id, on) {
  const f = fields.find((x) => x.id === id);
  if (!f) return { problem: 'That field is not there.' };
  if (on && fields.some((x) => x.size && x.id !== id)) return { problem: SC_ONE_SIZE_SAY };
  return { fields: fields.map((x) => { if (x.id !== id) return x; const { size: gone, ...rest } = x; return on ? { ...rest, size: true } : rest; }) };
}
// What a choice of the size field is worth: a whole number from 0 to 999 (text or a number), or '' for nothing.
function scSetOptionValue(fields, id, optionId, value) {
  const f = fields.find((x) => x.id === id);
  if (!f || !f.options.some((o) => o.id === optionId)) return { problem: 'That choice is not there.' };
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  let n = null;
  if (text !== '') {
    if (!/^[0-9]{1,3}$/.test(text)) return { problem: `A size is a whole number from 0 to ${SC_SIZE_MAX}.` };
    n = Number(text);
  }
  return { fields: fields.map((x) => (x.id === id ? { ...x, options: x.options.map((o) => { if (o.id !== optionId) return o; const { value: gone, ...rest } = o; return n === null ? rest : { ...rest, value: n }; }) } : x)) };
}
function scDeleteField(fields, id) {
  if (!fields.some((f) => f.id === id)) return { problem: 'That field is not there.' };
  return { fields: fields.filter((f) => f.id !== id).map((f, i) => ({ ...f, order: i })) };
}
function scMoveField(fields, id, by) {
  const from = fields.findIndex((f) => f.id === id);
  if (from < 0) return { problem: 'That field is not there.' };
  const to = from + (by < 0 ? -1 : 1);
  if (to < 0 || to >= fields.length) return { fields };
  const list = fields.slice();
  [list[from], list[to]] = [list[to], list[from]];
  return { fields: list.map((f, i) => ({ ...f, order: i })) };
}
function scAddOption(fields, id, label) {
  const f = fields.find((x) => x.id === id);
  if (!f) return { problem: 'That field is not there.' };
  const n = scFieldName(label);
  if (n.problem) return n;
  if (f.options.length >= SC_FIELD_OPTIONS_MAX) return { problem: `A field has at most ${SC_FIELD_OPTIONS_MAX} choices.` };
  const option = { id: scSlug(n.text, new Set(f.options.map((o) => o.id))), label: n.text };
  return { fields: fields.map((x) => (x.id === id ? { ...x, options: [...x.options, option] } : x)), option };
}
function scRenameOption(fields, id, optionId, label) {
  const f = fields.find((x) => x.id === id);
  if (!f || !f.options.some((o) => o.id === optionId)) return { problem: 'That choice is not there.' };
  const n = scFieldName(label);
  if (n.problem) return n;
  return { fields: fields.map((x) => (x.id === id ? { ...x, options: x.options.map((o) => (o.id === optionId ? { ...o, label: n.text } : o)) } : x)) };
}
function scDeleteOption(fields, id, optionId) {
  const f = fields.find((x) => x.id === id);
  if (!f || !f.options.some((o) => o.id === optionId)) return { problem: 'That choice is not there.' };
  return { fields: fields.map((x) => (x.id === id ? { ...x, options: x.options.filter((o) => o.id !== optionId) } : x)) };
}
function scMoveOption(fields, id, optionId, by) {
  const f = fields.find((x) => x.id === id);
  const from = f ? f.options.findIndex((o) => o.id === optionId) : -1;
  if (from < 0) return { problem: 'That choice is not there.' };
  const to = from + (by < 0 ? -1 : 1);
  if (to < 0 || to >= f.options.length) return { fields };
  const options = f.options.slice();
  [options[from], options[to]] = [options[to], options[from]];
  return { fields: fields.map((x) => (x.id === id ? { ...x, options } : x)) };
}
// What changes in the store when the fields go from `was` to `now`: { write: [fields to store], remove: [ids to delete] }. Every
// field is written with its place (`order`), so the order is whatever `now` lists.
function scFieldsDiff(was, now) {
  const placed = now.map((f, i) => ({ ...f, order: i }));
  // A field the Sizing setting stands for (`virtual`) is not stored until its words, choices or numbers change, or its place does: it is
  // compared at the place it was listed at, so an edit that leaves it alone writes nothing for it.
  const old = new Map(was.map((f, i) => [f.id, f.virtual ? { ...scFieldValue(f), order: i } : scFieldValue(f)]));
  const write = placed.filter((f) => JSON.stringify(old.get(f.id) || null) !== JSON.stringify(scFieldValue(f)));
  const remove = was.filter((f) => !now.some((x) => x.id === f.id)).map((f) => f.id);
  return { write, remove };
}
// The work that has to change because a choice or a whole field is gone from `now` (it was in `was`): the work with that value
// taken off, as it would be saved. A value for a field `was` never had is left as it is.
function scFieldsRewrite(entries, was, now) {
  const out = [];
  for (const e of entries) {
    if (e.kind !== 'work' || !e.fields) continue;
    let next = null;
    for (const [fid, oid] of Object.entries(e.fields)) {
      const before = was.find((f) => f.id === fid);
      if (!before) continue;
      const after = now.find((f) => f.id === fid);
      if (after && after.options.some((o) => o.id === oid)) continue;
      next = next || { ...e, fields: { ...e.fields } };
      delete next.fields[fid];
    }
    if (next) out.push(next);
  }
  return out;
}
// The choice of a field a person or an agent names: by id or by its words, ignoring case. null when there is none.
function scFieldOf(fields, name) {
  const key = scKey(name);
  return key ? fields.find((f) => f.id === key || scKey(f.label) === key) || null : null;
}
function scOptionOf(field, name) {
  const key = scKey(name);
  return key ? field.options.find((o) => o.id === key || scKey(o.label) === key) || null : null;
}
// What a `fields` input says, as text: "area=core; phase=first" (separated by semicolons or line breaks, so a choice with a comma in
// its name is fine). `field=` clears that field; an empty input clears every field. Answers { values: { fieldId: optionId | '' }, all } or { problem }.
function scFieldsParse(text, defs) {
  const fields = Array.isArray(defs) ? defs : [];
  if (typeof text !== 'string') return { problem: 'The fields must be text, such as area=core; phase=first.' };
  const parts = text.split(/[;\n]/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return { values: {}, all: true };
  const values = {};
  for (const part of parts) {
    const at = part.indexOf('=');
    if (at < 1) return { problem: `Write each field as name=choice, such as area=core. "${scLine(part, 40)}" is not.` };
    const f = scFieldOf(fields, part.slice(0, at));
    if (!f) return { problem: `There is no field called ${scLine(part.slice(0, at), 40)}.${fields.length ? ` The fields are ${fields.map((x) => x.id).join(', ')}.` : ' This plan has no fields yet.'}` };
    const raw = part.slice(at + 1).trim();
    if (!raw) { values[f.id] = ''; continue; }
    const o = scOptionOf(f, raw);
    if (!o) return { problem: `${f.label} has no choice called ${scLine(raw, 40)}.${f.options.length ? ` Its choices are ${f.options.map((x) => x.id).join(', ')}.` : ''}` };
    values[f.id] = o.id;
  }
  return { values, all: false };
}
// The work's choices with `parsed` (scFieldsParse's answer) applied.
function scFieldsApplied(current, parsed) {
  if (parsed.all) return {};
  const out = { ...(current || {}) };
  for (const [k, v] of Object.entries(parsed.values)) { if (v) out[k] = v; else delete out[k]; }
  return out;
}
// What a person reads for each field the work has a choice in: [{ id, field, label }] in the fields' order, only choices the field still has.
function scFieldWords(e, fields) {
  const out = [];
  for (const f of fields) {
    const oid = e && e.fields ? e.fields[f.id] : '';
    const o = oid ? f.options.find((x) => x.id === oid) : null;
    if (o) out.push({ id: f.id, field: f.label, label: o.label });
  }
  return out;
}

// --- the actions on an entry that is there (setDone, updateEntry) ------------------------------------------------------------------
// Each answers { entry, problem }: the entry as it would be saved (from the one stored, `e`, as scClean made it), or the one plain
// sentence it is refused with. Nothing is saved here. They check what the editor and the done tick check (scProblem and the
// editor's own sentences), and a person's guards (who may edit) are the page's.

// Ticks a milestone, or marks work done, as the page's tick does: a milestone's tick is `ticked` (and so `done`); work's is `done`.
// A note has neither.
function scSetDone(e, done, o) {
  const label = (o && o.label) || ((k) => k);
  if (typeof done !== 'boolean') return { entry: null, problem: 'Say whether it is done: true or false.' };
  if (!e || e.kind === 'note') return { entry: null, problem: `A ${label('note')} has nothing to tick off.` };
  const next = { ...e };
  if (e.kind === 'milestone') next.ticked = done;
  next.done = done;
  // Work moves with its tick (`o.board`): ticked into the first done column, unticked into the first column without the flag;
  // work already in a column of the right kind stays where it is.
  if (e.kind === 'work' && o && o.board) {
    const at = scColumnOf(e, o.board);
    if (done !== at.done) next.column = (o.board.columns.find((c) => Boolean(c.done) === done) || at).id;
  }
  return { entry: e.kind === 'work' ? scDoneOn(e, next, o && o.today) : next, problem: '' };
}

// Changes only the fields given: { title, date (a milestone's day), start and end (work's days), notes, owners, fields }. A day written ''
// clears it. The editor's sentences are used where it has them: a day outside 1900 to 2200, an end before its start, a title, and the
// plan's "dates are needed". Text is cut to nothing, never silently shortened: past its length after trimming, it is refused.
function scUpdate(e, input, o) {
  const i = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const label = (o && o.label) || ((k) => k);
  const no = (problem) => ({ entry: null, problem });
  if (!e) return no('That is not there.');
  const given = (k) => i[k] !== undefined && i[k] !== null;
  const fields = ['title', 'date', 'start', 'end', 'notes', 'owners', 'fields'].filter(given);
  if (!fields.length) return no('Say what to change: a title, a day, notes.');
  for (const k of ['title', 'date', 'start', 'end', 'notes']) if (given(k) && typeof i[k] !== 'string') return no(`The ${k} must be text.`);
  let owners = null;
  if (given('owners')) {
    if (e.kind !== 'work') return no(`Only ${label('work')} says who is doing it.`);
    const r = scOwnersFor(i.owners, o && o.people, o);
    if (r.problem) return no(r.problem);
    owners = r.owners;
  }
  let choices = null;
  if (given('fields')) {
    if (e.kind !== 'work') return no(`A ${label(e.kind)} has no fields.`);
    const r = scFieldsParse(i.fields, o && o.fieldDefs);
    if (r.problem) return no(r.problem);
    choices = scFieldsApplied(e.fields, r);
  }
  if (e.kind === 'note' && fields.some((k) => ['date', 'start', 'end'].includes(k))) return no(`A ${label('note')} has no day.`);
  if (e.kind === 'milestone' && (given('start') || given('end'))) return no(`The ${label('milestone')} has a day, not a start and an end.`);
  if (e.kind === 'work' && given('date')) return no(`The ${label('work')} has a start and an end, not a day.`);
  const raw = scValue(e);
  if (given('title')) {
    const title = scLine(i.title, 100000);
    if (!title) return no('Give it a title.');
    if ([...title].length > SC_TITLE_MAX) return no(`The title is at most ${SC_TITLE_MAX} characters.`);
    raw.title = title;
  }
  if (given('notes')) {
    const notes = scText(i.notes, 1000000);
    if ([...notes].length > SC_NOTES_MAX) return no(`The notes are at most ${SC_NOTES_MAX} characters.`);
    if (notes) raw.notes = notes; else delete raw.notes;
  }
  if (owners) { if (owners.length) raw.owners = owners; else delete raw.owners; }
  if (choices) { if (Object.keys(choices).length) raw.fields = choices; else delete raw.fields; }
  const first = e.kind === 'milestone' ? 'date' : 'start';
  const days = { start: e.start || '', end: e.end || '' };
  if (given(first)) days.start = i[first].trim();
  if (e.kind === 'work' && given('end')) days.end = i.end.trim();
  if (days.start && !scIsDay(days.start)) return no('The start is a day from 1900 to 2200, such as 2026-10-14.');
  if (e.kind === 'work' && days.end && !scIsDay(days.end)) return no('The end is a day from 1900 to 2200, such as 2026-10-14.');
  if (e.kind === 'work' && days.start && days.end && days.end < days.start) return no('The end is before the start.');
  if (e.kind !== 'note') { delete raw.start; delete raw.end; if (days.start) raw.start = days.start; if (e.kind === 'work' && days.end) raw.end = days.end; }
  const next = scClean(e.id, raw);
  const problem = scProblem(next, o);
  return problem ? no(problem) : { entry: next, problem: '' };
}

// --- an object taken whole (the objects format's milestone, work and note) --------------------------------------------------------
// A title as it is compared: plain text, one line, lower case.
const scKey = (s) => scLine(s, SC_TITLE_MAX).toLowerCase();

// The entry an `under` title names, as the id to put the new entry under, or null (the top). Only a milestone holds entries (the
// editor's "Part of a milestone"). Of two milestones with the same title the later in `entries` wins; an `under` equal to the
// entry's own title names nothing. The new entry has an id of its own, so this never makes a loop.
function scParentFor(entries, under, ownTitle) {
  const key = scKey(under);
  if (!key || key === scKey(ownTitle)) return null;
  let found = null;
  for (const e of Array.isArray(entries) ? entries : []) if (e && e.kind === 'milestone' && scKey(e.title) === key) found = e.id;
  return found;
}

// The id of the template's phase a name (or an id) names, ignoring case, or ''.
function scPhaseFor(phases, name) {
  const key = scKey(name);
  if (!key) return '';
  for (const p of Array.isArray(phases) ? phases : []) {
    if (p && typeof p.id === 'string' && (p.id.toLowerCase() === key || scKey(p.label) === key || scKey(p.name) === key)) return p.id;
  }
  return '';
}

// The flat fields of an add action's input, from the object it was given (a title, its words as notes, its days), the flat
// fields the sender gave winning over none. { title, date, start, end, notes }.
function scObjectInput(kind, input, object) {
  const i = input && typeof input === 'object' ? input : {};
  const o = object && typeof object === 'object' ? object : {};
  const d = o.details && typeof o.details === 'object' && !Array.isArray(o.details) ? o.details : {};
  const day = (v) => (typeof v === 'string' && v ? v.slice(0, 10) : '');
  const out = { title: typeof o.title === 'string' && o.title.trim() ? o.title : i.title, notes: typeof o.content === 'string' && o.content.trim() ? o.content : i.notes };
  if (kind === 'milestone') out.date = i.date || day(d.start) || day(o.date);
  if (kind === 'work') { out.start = i.start || day(d.start) || day(o.date); out.end = i.end || day(d.end); }
  return out;
}

// A new entry from an object: the add action's rules (scFromAction), then its parent (`details.under`), its phase (a name),
// and done (a milestone's becomes ticked). `o`: { entries, phases, by, ref }.
function scFromObject(kind, input, object, o) {
  const merged = scObjectInput(kind, input, object);
  const d = object && object.details && typeof object.details === 'object' && !Array.isArray(object.details) ? object.details : {};
  const base = scFromAction(kind, merged, (o && o.by) || '');
  const raw = { ...base, ref: (input && input.ref) || base.ref };
  if (kind !== 'note') {
    raw.parent = scParentFor(o && o.entries, d.under, base.title);
    raw.phase = scPhaseFor(o && o.phases, d.phase);
    if (d.done === true) { if (kind === 'milestone') raw.ticked = true; else raw.done = true; }
  }
  return { entry: scClean('new', raw), input: merged };
}

// --- the board's rows and filters (plan-projects-kanban.md, step 5b) --------------------------------------------------------------
// Rows and filters are how the page shows the work, never stored work (no action reads them). `rowsBy` on the board is "milestone",
// "owners" or none (the words people read: Milestone, Person, None).

// The milestone work is in: the nearest milestone above it (its parent, then that one's parent, and so on). '' when it has none.
function scMilestoneOf(e, byId) {
  const seen = new Set();
  let at = e && e.parent ? byId.get(e.parent) : null;
  while (at && !seen.has(at.id)) {
    if (at.kind === 'milestone') return at.id;
    seen.add(at.id);
    at = at.parent ? byId.get(at.parent) : null;
  }
  return '';
}
// The row a piece of work is in: by milestone its milestone's id, by person its first owner's key; '' when it has none.
function scRowOf(e, rowsBy, byId) {
  if (rowsBy === 'milestone') return scMilestoneOf(e, byId);
  if (rowsBy === 'owners') return e && e.owners && e.owners.length ? e.owners[0] : '';
  if (SC_ROWS_FIELD.test(String(rowsBy))) return e && e.fields ? e.fields[rowsBy.slice(6)] || '' : '';
  return '';
}
// The rows for the work shown: [{ id, label }] (milestones in outline order, people by name, a field's choices in its order) for the rows
// that have work, and `of[workId]` its row id ('' for the last row). `nameOf(key)` is a person's name ('' for one who left); `fields`
// the plan's fields, for rows by a field.
function scBoardRows(shown, rowsBy, all, nameOf, goneWord, fields) {
  const field = SC_ROWS_FIELD.test(String(rowsBy)) ? (Array.isArray(fields) ? fields : []).find((f) => f.id === rowsBy.slice(6)) : null;
  if (rowsBy !== 'milestone' && rowsBy !== 'owners' && !field) return { rows: [], of: new Map() };
  const byId = new Map(all.map((e) => [e.id, e]));
  const of = new Map(shown.map((e) => [e.id, scRowOf(e, rowsBy, byId)]));
  const used = new Set(of.values());
  used.delete('');
  let rows;
  if (rowsBy === 'milestone') {
    rows = scOrdered(all).map((x) => x.entry).filter((m) => m.kind === 'milestone' && used.has(m.id)).map((m) => ({ id: m.id, label: m.title }));
  } else if (field) {
    rows = field.options.filter((o) => used.has(o.id)).map((o) => ({ id: o.id, label: o.label }));
  } else {
    rows = [...used].map((k) => ({ id: k, label: nameOf(k) || goneWord || 'Someone who left' }));
    rows.sort((a, b) => a.label.localeCompare(b.label) || (a.id < b.id ? -1 : 1));
  }
  const known = new Set(rows.map((r) => r.id));
  for (const [id, row] of of) if (row && !known.has(row)) of.set(id, '');
  return { rows, of };
}

// The filters, a person's own view of the Board. { who: [keys, and SC_NONE for no one], tags: [ids], phase: id | SC_NONE | '', milestone: same,
// fields: { <fieldId>: optionId | SC_NONE } }.
const SC_NONE = '_none';
function scFilterEmpty() { return { who: [], tags: [], phase: '', milestone: '', fields: {} }; }
function scFilterOn(f) { return Boolean(f && (f.who.length || f.tags.length || f.phase || f.milestone || Object.keys(f.fields || {}).length)); }
// A kept value, read: anything that is not the shape is dropped; `have` ({ who:Set, tags:Set, phases:Set, milestones:Set, fields: Map of
// field id to the Set of its choices }) drops what is gone.
function scFilterClean(raw, have) {
  const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const list = (a, ok) => [...new Set((Array.isArray(a) ? a : []).filter((x) => typeof x === 'string' && ok(x)))];
  const one = (x, ok) => (typeof x === 'string' && x && ok(x) ? x : '');
  const h = have || null;
  return {
    who: list(v.who, (x) => !h || x === SC_NONE || h.who.has(x)),
    tags: list(v.tags, (x) => !h || h.tags.has(x)),
    phase: one(v.phase, (x) => !h || x === SC_NONE || h.phases.has(x)),
    milestone: one(v.milestone, (x) => !h || x === SC_NONE || h.milestones.has(x)),
    fields: (() => {
      const out = {};
      const raw = v.fields && typeof v.fields === 'object' && !Array.isArray(v.fields) ? v.fields : {};
      for (const k of Object.keys(raw)) {
        const x = raw[k];
        if (typeof x !== 'string' || !x || !SC_BOARD_ID.test(k) || (x !== SC_NONE && !SC_BOARD_ID.test(x))) continue;
        if (h && !(x === SC_NONE ? h.fields && h.fields.has(k) : h.fields && h.fields.has(k) && h.fields.get(k).has(x))) continue;
        out[k] = x;
      }
      return out;
    })(),
  };
}
// Does work pass the filter? Groups combine with "and": who (any chosen, or no one), tags (has all), phase, milestone, each field.
function scFilterMatch(e, f, byId) {
  if (!scFilterOn(f)) return true;
  if (f.who.length && !(e.owners.length ? e.owners.some((k) => f.who.includes(k)) : f.who.includes(SC_NONE))) return false;
  if (f.tags.length && !f.tags.every((t) => e.tags.includes(t))) return false;
  if (f.phase && (f.phase === SC_NONE ? e.phase : e.phase !== f.phase)) return false;
  if (f.milestone) { const m = scMilestoneOf(e, byId); if (f.milestone === SC_NONE ? m : m !== f.milestone) return false; }
  for (const [fid, want] of Object.entries(f.fields || {})) { const has = e.fields ? e.fields[fid] : ''; if (want === SC_NONE ? has : has !== want) return false; }
  return true;
}
// What a new piece of work starts with while the filter is on: the chosen milestone and phase, the one person when exactly one is
// chosen, the tags, and the choice of each field that has one.
function scFilterSeed(f) {
  const out = {};
  if (!scFilterOn(f)) return out;
  if (f.milestone && f.milestone !== SC_NONE) out.parent = f.milestone;
  if (f.phase && f.phase !== SC_NONE) out.phase = f.phase;
  const people = f.who.filter((k) => k !== SC_NONE);
  if (people.length === 1 && f.who.length === 1) out.owners = people;
  if (f.tags.length) out.tags = f.tags.slice();
  const chosen = Object.entries(f.fields || {}).filter(([, v]) => v !== SC_NONE);
  if (chosen.length) out.fields = Object.fromEntries(chosen);
  return out;
}
