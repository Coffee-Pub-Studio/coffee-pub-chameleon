// Planner - Projects' actions: what an agent or another module may ask of it (plan-agent-edit-delete.md, decision 4 and step 2). One
// copy of each rule, carried out on the server (the manifest's actions.server: the runner) and on the page (host.actions.fromLibrary,
// schedule.js), both giving the same answer. No page in it: each handler reads the plan through `ctx` and answers what to write. A
// throw is the refusal; its message is the sentence the asker reads. It expects schedule-lib.js in scope (the build puts every
// schedule-lib*.js together).
//
// It reads, as both carriers give them (plan-agent-server-actions.md, section 1):
//   ctx.settings      the plan's settings ({ datesRequired, boardColumns, ... })
//   ctx.list          the space's data by key prefix: the plan (`plan:`), its board (`board:`) and its fields (`field:`)
//   ctx.util.label    the plan's words for its kinds (the template's themed "milestone", "work", "plan")
//   ctx.util.order    the outline's order key between two
//   ctx.util.rollup   the outline's done and total under each entry
//   ctx.space.phases  the space's phases with their names, for an object's `phase` given by name
// What an edit's save does after its write is in the answer too, so nothing waits for a page: the link to what an entry was made
// from (`links`, a diff) and the milestones' done and progress (more `writes`), as schedule.js saveEntry does them.

function scFacts(ctx) {
  const settings = ctx.settings && typeof ctx.settings === 'object' ? ctx.settings : {};
  return {
    datesRequired: settings.datesRequired !== false,
    label: (k, o) => ctx.util.label(k, o),
    order: ctx.util.order,
    phases: ctx.space && Array.isArray(ctx.space.phases) ? ctx.space.phases : [],
    people: Array.isArray(ctx.people) ? ctx.people : [],
    space: ctx.util.word('space'),
    fieldDefs: scFieldsFrom(ctx.list(SC_FIELD_PREFIX)),
  };
}
// The plan's entries as the page holds them (schedule.js remember: an entry stored without a title reads as "Untitled").
function scEntriesOf(ctx) {
  const out = [];
  for (const row of ctx.list(SC_PREFIX)) {
    if (!row.value || typeof row.value !== 'object') continue;
    const e = scClean(row.key.slice(SC_PREFIX.length), row.value);
    if (!e.title) e.title = 'Untitled';
    out.push(e);
  }
  return out;
}
// The order key after the last entry under `parent`, with `between` (host.util.order); '' when there is none to be had.
function scOrderAtEnd(entries, parent, between) {
  const sibs = entries.filter((e) => (e.parent || null) === (parent || null) && e.order).map((e) => e.order).sort();
  try { return between(sibs.length ? sibs[sibs.length - 1] : null, null); } catch (err) { return ''; }
}
// The space's board: the stored `board:main` when it reads, else the template's default (the `boardColumns` setting).
function scBoardOf(ctx) {
  const row = ctx.list(SC_BOARD_PREFIX).find((r) => r.key === `${SC_BOARD_PREFIX}main`);
  const settings = ctx.settings && typeof ctx.settings === 'object' ? ctx.settings : {};
  return scBoardFrom(row ? row.value : null, settings.boardColumns, (k) => ctx.util.label(k));
}
const scRef = (ctx, id) => ({ module: 'schedule', kind: 'plan', id, scope: 'space', space: ctx.space.id });
const scWrite = (e) => ({ key: SC_PREFIX + e.id, value: scValue(e) });
// A stored pointer as a link's end takes it: its five fields, or null when it is not a whole pointer.
function scLinkEnd(r) {
  if (!r || typeof r !== 'object' || !r.module || !r.kind || !r.id || typeof r.scope !== 'string' || !r.scope) return null;
  return { module: r.module, kind: r.kind, id: r.id, scope: r.scope, ...(typeof r.space === 'string' ? { space: r.space } : {}) };
}
const scSameEnd = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// The answer for entry `e` written over `had` (null for a new one), from the plan's `entries` before it: e's write, the milestones'
// done and progress as they follow from it (scMilestoneChanges over the outline's rollup, as the page's settleMilestones; a
// change to e itself goes into e's own write), and the link to what it was made from as a diff (the old one out, the new one in).
function scAnswer(ctx, entries, had, e) {
  const next = entries.filter((x) => x.id !== e.id).concat([e]);
  const changes = scMilestoneChanges(next, ctx.util.rollup(next.filter((x) => x.kind !== 'note')));
  let mine = e;
  const others = [];
  for (const c of changes) {
    if (c.id === e.id) { mine = { ...mine, done: c.done, progress: c.progress }; continue; }
    const m = next.find((x) => x.id === c.id);
    if (m) others.push(scWrite({ ...m, done: c.done, progress: c.progress }));
  }
  const from = scRef(ctx, e.id);
  const was = scLinkEnd(had && had.ref);
  const now = scLinkEnd(mine.ref);
  const links = [];
  if (was && !(now && scSameEnd(was, now))) links.push({ remove: { from, to: was } });
  if (now && !(was && scSameEnd(was, now))) links.push({ add: { from, to: now } });
  return { writes: [scWrite(mine), ...others], ref: from, ...(links.length ? { links } : {}) };
}

// An add per kind, saved at once. What it was sent is checked first (scActionProblem): a missing title, a day the plan can't
// hold, or no day when the plan needs dates is refused with one sentence; nothing opens on anyone's screen. Who added it is the
// asker's key (a person's key, so "Added by" finds the name), else the key of the person whose page carries it out.
function scAdd(kind, input, ctx) {
  const f = scFacts(ctx);
  const entries = scEntriesOf(ctx);
  const obj = input && input.object && typeof input.object === 'object' ? input.object : null;
  const flat = obj ? scObjectInput(kind, input, obj) : input;
  const problem = scActionProblem(kind, flat, { datesRequired: f.datesRequired, label: f.label });
  if (problem) throw new Error(problem);
  const by = scAddedBy(ctx, ctx.credit && ctx.credit.key);
  // Owners (work only) are checked before anything is made; a person is named by key or by name.
  let owners = null;
  if (kind === 'work' && input && input.owners !== undefined && input.owners !== null) {
    const r = scOwnersFor(input.owners, f.people, { space: f.space });
    if (r.problem) throw new Error(r.problem);
    owners = r.owners;
  }
  // Fields (work only), by name or id, checked against the plan's fields before anything is made.
  let choices = null;
  if (kind === 'work' && input && input.fields !== undefined && input.fields !== null && input.fields !== '') {
    const r = scFieldsParse(input.fields, f.fieldDefs);
    if (r.problem) throw new Error(r.problem);
    choices = scFieldsApplied({}, r);
  }
  let e = obj ? scFromObject(kind, input, obj, { entries, phases: f.phases, by }).entry : scFromAction(kind, input, by);
  if (owners && owners.length) e = { ...e, owners: scKeys(owners) };
  if (choices && Object.keys(choices).length) e = { ...e, fields: choices };
  e = { ...e, id: ctx.util.id() };
  e.order = scOrderAtEnd(entries, e.parent, f.order);
  return scAnswer(ctx, entries, null, e);
}
// The entry a request names (`ref`, a pointer to one of this plan's), or the sentence.
function scEntryFor(input, ctx, f) {
  const r = input && input.ref;
  const id = r && typeof r === 'object' && r.module === 'schedule' && r.kind === 'plan' && typeof r.id === 'string' && (r.space === undefined || r.space === ctx.space.id) ? r.id : '';
  const e = id ? scEntriesOf(ctx).find((x) => x.id === id) : null;
  if (!e) throw new Error(`That is not on the ${f.label('plan')}.`);
  return e;
}
// setDone and updateEntry act on an entry that is there, checking what they are sent with the editor's own rules (scSetDone,
// scUpdate). Nothing is opened for a person to finish.
function scChange(input, ctx, make) {
  const f = scFacts(ctx);
  const had = scEntryFor(input, ctx, f);
  const out = make(had, f);
  if (out.problem) throw new Error(out.problem);
  const answer = scAnswer(ctx, scEntriesOf(ctx), had, out.entry);
  // Other work whose rank changed with it (setColumn): written after it, no links or milestones of their own.
  if (out.others && out.others.length) answer.writes.push(...out.others.map(scWrite));
  return answer;
}
// setColumn: the move (column and done), then its place in the column: in front of the work `before`, else at the end.
// Pulled work (it has a `source`) is written on its own, one entry at a time, because a change to it may go to GitHub (server/index.js), so
// its placement never needs another entry written: with no `before` it takes no rank and sits with the work nobody has ordered, below the
// ranked work of its column; with `before` it is placed only when the work above it already has ranks.
function scMoveTo(input, ctx, e, f) {
  const board = scBoardOf(ctx);
  const r = scSetColumn(e, input.column, board, { label: f.label });
  if (r.problem) return r;
  const before = typeof input.before === 'string' && input.before ? input.before : '';
  if (e.source && !before) return { entry: { ...r.entry, rank: '' }, others: [], problem: '' };
  const placed = scPlace(scEntriesOf(ctx), r.entry, r.entry.column, board, before);
  if (e.source && placed.others.length) return { entry: null, others: [], problem: SC_PLACE_SAY };
  return { entry: placed.entry, others: placed.others, problem: '' };
}
const SC_PLACE_SAY = 'The work above it has no order yet. Move it without a place, or put it in order on the board.';

const ACTION_HANDLERS = {
  addMilestone: (input, ctx) => scAdd('milestone', input, ctx),
  addWork: (input, ctx) => scAdd('work', input, ctx),
  addNote: (input, ctx) => scAdd('note', input, ctx),
  // The tick moves work with it (scSetDone's board): into the first done column, or out into the first column without the flag.
  setDone: (input, ctx) => scChange(input, ctx, (e, f) => scSetDone(e, input.done, { label: f.label, board: scBoardOf(ctx) })),
  // Moves work to a column by its id, in front of the work `before` (a work id) or at the end; `done` follows the column's flag, and the milestones' done and progress in the same answer.
  setColumn: (input, ctx) => scChange(input, ctx, (e, f) => scMoveTo(input, ctx, e, f)),
  // Only the fields given change. A day sent as "" (the manifest's `clears`) clears it, as emptying it in the editor does; so do
  // the owners and the notes.
  updateEntry: (input, ctx) => scChange(input, ctx, (e, f) => scUpdate(e, input, { datesRequired: f.datesRequired, label: f.label, people: f.people, space: f.space, fieldDefs: f.fieldDefs })),
};
