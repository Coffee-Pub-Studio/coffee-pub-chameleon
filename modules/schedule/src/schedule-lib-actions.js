// Planner - Projects' actions: what an agent or another module may ask of it (plan-agent-edit-delete.md, decision 4 and step 2). One
// copy of each rule, carried out on the page (host.actions.fromLibrary, schedule.js). No page in it: each handler reads the plan
// through `ctx` and answers what to write. A throw is the refusal; its message is the sentence the asker reads. It expects
// schedule-lib.js in scope (the build puts every schedule-lib*.js together).
//
// Beyond the runner's ctx a handler here reads what only the page has today, which schedule.js adds to ctx for each request:
//   ctx.settings  the plan's settings as the person may read them ({ datesRequired, ... }, host.settings.get())
//   ctx.label     the plan's words for its kinds (host.util.label: the template's themed "milestone", "work", "plan")
//   ctx.order     host.util.order(before, after): the outline's order key between two
//   ctx.phases    the template's phases with their names (host.phases()), for an object's `phase` given by name
// The server's runner gives none of these, so the manifest declares no actions.server; scFacts refuses rather than guess them.
// What only the page does after a write is its own (schedule.js after): the link to what an entry was made from, and settling the
// milestones' done and progress.

const SC_PAGE_ONLY = 'Planner - Projects can only do that with its page open.';
function scFacts(ctx) {
  if (!ctx.settings || typeof ctx.label !== 'function' || typeof ctx.order !== 'function') throw new Error(SC_PAGE_ONLY);
  return {
    datesRequired: ctx.settings.datesRequired !== false,
    label: (k, o) => ctx.label(k, o),
    order: ctx.order,
    phases: Array.isArray(ctx.phases) ? ctx.phases : [],
    people: Array.isArray(ctx.people) ? ctx.people : [],
    space: ctx.util.word('space'),
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
const scRef = (ctx, id) => ({ module: 'schedule', kind: 'plan', id, scope: 'space', space: ctx.space.id });
const scWrite = (e) => ({ key: SC_PREFIX + e.id, value: scValue(e) });

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
  let e = obj ? scFromObject(kind, input, obj, { entries, phases: f.phases, by }).entry : scFromAction(kind, input, by);
  if (owners && owners.length) e = { ...e, owners: scKeys(owners) };
  e = { ...e, id: ctx.util.id() };
  e.order = scOrderAtEnd(entries, e.parent, f.order);
  return { writes: [scWrite(e)], ref: scRef(ctx, e.id) };
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
  const out = make(scEntryFor(input, ctx, f), f);
  if (out.problem) throw new Error(out.problem);
  return { writes: [scWrite(out.entry)], ref: scRef(ctx, out.entry.id) };
}

const ACTION_HANDLERS = {
  addMilestone: (input, ctx) => scAdd('milestone', input, ctx),
  addWork: (input, ctx) => scAdd('work', input, ctx),
  addNote: (input, ctx) => scAdd('note', input, ctx),
  setDone: (input, ctx) => scChange(input, ctx, (e, f) => scSetDone(e, input.done, { label: f.label })),
  // Only the fields given change. A day sent as "" (the manifest's `clears`) clears it, as emptying it in the editor does; so do
  // the owners and the notes.
  updateEntry: (input, ctx) => scChange(input, ctx, (e, f) => scUpdate(e, input, { datesRequired: f.datesRequired, label: f.label, people: f.people, space: f.space })),
};
