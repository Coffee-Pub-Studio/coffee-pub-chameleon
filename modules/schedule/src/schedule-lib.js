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
//   column   work only: the id of its column on the board (see the board below), or absent
//
// A board, stored under `board:<id>` (the first and only one is `main`): { id, name, field: 'column', columns: [{ id, label, done? }],
// rowsBy? }. `done` stays stored as it always was and always equals the flag on the work's column (plan-projects-kanban.md).
const SC_PREFIX = 'plan:';
const SC_BOARD_PREFIX = 'board:';
const SC_BOARD_ID = /^[a-z][a-z0-9-]{0,40}$/;
const SC_COLUMN_LABEL_MAX = 40;
const SC_COLUMNS_MAX = 12;
const SC_ROWS_BY = ['milestone', 'owners'];
// The template's default columns (the `boardColumns` setting). Only `done` carries the flag in either set.
const SC_BOARD_SETS = Object.freeze({
  priority: Object.freeze([['inbox', 'Inbox'], ['now', 'Now'], ['next', 'Next'], ['later', 'Later'], ['done', 'Done', true]]),
  stages: Object.freeze([['todo', 'To do'], ['doing', 'Doing'], ['done', 'Done', true]]),
});
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

// Where pulled work came from (plan-github-pull.md): { from, repo, number, url, updated } for an issue, { from, repo, milestone, due? } for a
// milestone. Kept as the pull wrote it so a save from a page does not drop it; a link is kept only when it is an https address.
function scCleanSource(r) {
  if (!r || typeof r !== 'object' || typeof r.from !== 'string' || typeof r.repo !== 'string' || !r.from || !r.repo) return null;
  const out = { from: r.from.slice(0, 32), repo: r.repo.slice(0, 200) };
  if (Number.isInteger(r.number) && r.number > 0) out.number = r.number;
  if (Number.isInteger(r.milestone) && r.milestone > 0) out.milestone = r.milestone;
  if (typeof r.url === 'string' && /^https:\/\/[^\s]{1,500}$/.test(r.url)) out.url = r.url;
  if (typeof r.due === 'string' && scIsDay(r.due)) out.due = r.due;
  if (typeof r.updated === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]{8,12}Z$/.test(r.updated)) out.updated = r.updated; // when the service last changed it: a pull never writes older data over newer
  return out;
}
// What a person is told on a pulled entry while the pull is on.
const SC_PULLED_SAY = 'This comes from GitHub. Change it there.';

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
    source: scCleanSource(v.source),
  };
  if (kind === 'work' && typeof v.column === 'string' && SC_BOARD_ID.test(v.column)) e.column = v.column;
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
  if (e.source) out.source = { ...e.source };
  if (e.kind === 'work' && e.column) out.column = e.column;
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
    columns.push(c.done === true ? { id: c.id, label, done: true } : { id: c.id, label });
  }
  if (!columns.some((c) => c.done) || !columns.some((c) => !c.done)) return null;
  const board = { id: String(id), name: scLine(v.name, SC_COLUMN_LABEL_MAX) || 'Board', field: 'column', columns };
  if (SC_ROWS_BY.includes(v.rowsBy)) board.rowsBy = v.rowsBy;
  return board;
}
// What is stored for a board: nothing empty.
function scBoardValue(board) {
  const out = { id: board.id, name: board.name, field: 'column', columns: board.columns.map((c) => (c.done ? { id: c.id, label: c.label, done: true } : { id: c.id, label: c.label })) };
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
// Moves work to a column: sets `column`, and `done` to the column's flag. Answers { entry } or { problem }. A milestone's done
// follows from its work (scMilestoneChanges), so the caller settles milestones in the same change.
function scSetColumn(e, columnId, board, o) {
  if (!e || e.kind !== 'work') return { entry: null, problem: 'Only work moves on the board.' };
  const col = typeof columnId === 'string' ? board.columns.find((c) => c.id === columnId.trim()) : null;
  if (!col) return { entry: null, problem: `There is no column called ${scLine(typeof columnId === 'string' ? columnId : '', SC_COLUMN_LABEL_MAX) || 'that'}.` };
  return { entry: { ...e, column: col.id, done: Boolean(col.done) }, problem: '' };
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
  const next = { ...board, columns: board.columns.map((c) => (c.id === columnId ? (done ? { id: c.id, label: c.label, done: true } : { id: c.id, label: c.label }) : c)) };
  const out = scSettled(entries, (e) => (scColumnOf(e, board).id === columnId && e.done !== done ? { ...e, done } : e), o);
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
  const out = scSettled(entries, (e) => (scColumnOf(e, board).id === columnId ? { ...e, column: to.id, done: Boolean(to.done) } : e), o);
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
  return { entry: next, problem: '' };
}

// Changes only the fields given: { title, date (a milestone's day), start and end (work's days), notes }. A day written ''
// clears it. The editor's sentences are used where it has them: a day outside 1900 to 2200, an end before its start, a title, and the
// plan's "dates are needed". Text is cut to nothing, never silently shortened: past its length after trimming, it is refused.
function scUpdate(e, input, o) {
  const i = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const label = (o && o.label) || ((k) => k);
  const no = (problem) => ({ entry: null, problem });
  if (!e) return no('That is not there.');
  const given = (k) => i[k] !== undefined && i[k] !== null;
  const fields = ['title', 'date', 'start', 'end', 'notes', 'owners'].filter(given);
  if (!fields.length) return no('Say what to change: a title, a day, notes.');
  for (const k of ['title', 'date', 'start', 'end', 'notes']) if (given(k) && typeof i[k] !== 'string') return no(`The ${k} must be text.`);
  let owners = null;
  if (given('owners')) {
    if (e.kind !== 'work') return no(`Only ${label('work')} says who is doing it.`);
    const r = scOwnersFor(i.owners, o && o.people, o);
    if (r.problem) return no(r.problem);
    owners = r.owners;
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
  return '';
}
// The rows for the work shown: [{ id, label }] (milestones in outline order, people by name) for the rows that have work, and
// `of[workId]` its row id ('' for the last row). `nameOf(key)` is a person's name ('' for one who left).
function scBoardRows(shown, rowsBy, all, nameOf, goneWord) {
  if (rowsBy !== 'milestone' && rowsBy !== 'owners') return { rows: [], of: new Map() };
  const byId = new Map(all.map((e) => [e.id, e]));
  const of = new Map(shown.map((e) => [e.id, scRowOf(e, rowsBy, byId)]));
  const used = new Set(of.values());
  used.delete('');
  let rows;
  if (rowsBy === 'milestone') {
    rows = scOrdered(all).map((x) => x.entry).filter((m) => m.kind === 'milestone' && used.has(m.id)).map((m) => ({ id: m.id, label: m.title }));
  } else {
    rows = [...used].map((k) => ({ id: k, label: nameOf(k) || goneWord || 'Someone who left' }));
    rows.sort((a, b) => a.label.localeCompare(b.label) || (a.id < b.id ? -1 : 1));
  }
  const known = new Set(rows.map((r) => r.id));
  for (const [id, row] of of) if (row && !known.has(row)) of.set(id, '');
  return { rows, of };
}

// The filters, a person's own view of the Board. { who: [keys, and SC_NONE for no one], tags: [ids], phase: id | SC_NONE | '', milestone: same }.
const SC_NONE = '_none';
function scFilterEmpty() { return { who: [], tags: [], phase: '', milestone: '' }; }
function scFilterOn(f) { return Boolean(f && (f.who.length || f.tags.length || f.phase || f.milestone)); }
// A kept value, read: anything that is not the shape is dropped; `have` ({ who:Set, tags:Set, phases:Set, milestones:Set }) drops what is gone.
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
  };
}
// Does work pass the filter? Groups combine with "and": who (any chosen, or no one), tags (has all), phase, milestone.
function scFilterMatch(e, f, byId) {
  if (!scFilterOn(f)) return true;
  if (f.who.length && !(e.owners.length ? e.owners.some((k) => f.who.includes(k)) : f.who.includes(SC_NONE))) return false;
  if (f.tags.length && !f.tags.every((t) => e.tags.includes(t))) return false;
  if (f.phase && (f.phase === SC_NONE ? e.phase : e.phase !== f.phase)) return false;
  if (f.milestone) { const m = scMilestoneOf(e, byId); if (f.milestone === SC_NONE ? m : m !== f.milestone) return false; }
  return true;
}
// What a new piece of work starts with while the filter is on: the chosen milestone and phase, the one person when exactly one is
// chosen, and the tags.
function scFilterSeed(f) {
  const out = {};
  if (!scFilterOn(f)) return out;
  if (f.milestone && f.milestone !== SC_NONE) out.parent = f.milestone;
  if (f.phase && f.phase !== SC_NONE) out.phase = f.phase;
  const people = f.who.filter((k) => k !== SC_NONE);
  if (people.length === 1 && f.who.length === 1) out.owners = people;
  if (f.tags.length) out.tags = f.tags.slice();
  return out;
}
