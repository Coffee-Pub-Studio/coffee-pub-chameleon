
// Planner - Goals' actions: what an agent or another module may ask of it (plan-agent-edit-delete.md, decision 4 and step 2).
// One copy of each rule, run on the page (host.actions.fromLibrary, goals.js) and by the
// server's runner (server/module-actions.js). No page in it: each handler reads the plan through `ctx` and answers what to
// write, the entry itself and the goal whose progress it moves (as goals.js add, update and syncEntry write them). A throw is
// the refusal; its message is the sentence the asker reads. It expects goals-lib.js (GoalsLib) in scope.
//
// Beside the runner's ctx it reads what the page hands it (goals.js); the server's runner gives each of them too:
//   ctx.settings      the plan's settings as host.settings.get() gives them ({ dates, progressBy }): whether dates show
//                     (shownDate) and whether a goal's progress is its steps or its own tick;
//   ctx.util.order    host.util.order, a new entry's place after its siblings (without it an entry has no order: it sorts last);
//   ctx.util.label    host.util.label, the module's words as the template renames them (without it, the manifest's);
//   ctx.space.phases  with each phase's `label`, so an object's phase is matched by name.
const GoalsActions = (() => {
  'use strict';
  const G = GoalsLib;
  const PREFIX = 'plan:';
  const WORDS = { goal: ['goal', 'goals', 'a goal'], step: ['step', 'steps', 'a step'], note: ['note', 'notes', 'a note'], owner: ['owner', 'owners', 'an owner'] };
  const cap = (s) => s.charAt(0).toLocaleUpperCase('en') + s.slice(1);
  const labelOf = (ctx) => (key, o) => {
    if (ctx.util && typeof ctx.util.label === 'function') return ctx.util.label(key, o);
    const w = WORDS[key] || [key, `${key}s`, `a ${key}`];
    const text = o && o.a ? w[2] : o && o.many ? w[1] : w[0];
    return o && o.cap ? cap(text) : text;
  };
  const prefsOf = (ctx) => {
    const s = ctx.settings && typeof ctx.settings === 'object' ? ctx.settings : {};
    return { datesOn: s.dates !== 'off', progressBy: s.progressBy === 'done' ? 'done' : 'steps' };
  };
  const given = (v) => v !== undefined && v !== null;
  const refOf = (ctx, id) => ({ module: 'goals', kind: 'plan', id, scope: 'space', space: ctx.space.id });
  // A value as text whatever the order of its fields, to tell whether a write changes anything.
  const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

  // The plan as it is now: { byId: Map(id -> entry), values: Map(id -> stored value) }, entries read as goals.js reads them.
  function planOf(ctx) {
    const byId = new Map();
    const values = new Map();
    for (const row of ctx.list(PREFIX)) {
      const id = row.key.slice(PREFIX.length);
      const e = row.value ? G.readEntry(id, row.value) : null;
      if (e) { byId.set(id, e); values.set(id, row.value); }
    }
    return { byId, values };
  }
  const kidsOf = (byId, id) => [...byId.values()].filter((e) => e.parent === id).sort(G.compare);
  // A new entry's order: after the last of its siblings (goals.js orderAtEnd).
  function orderAtEnd(byId, parent, ctx) {
    if (!ctx.util || typeof ctx.util.order !== 'function') return undefined;
    const sibs = [...byId.values()].filter((e) => (e.parent || null) === (parent || null) && (parent ? true : e.kind !== 'step')).sort(G.compare);
    const last = [...sibs].reverse().find((e) => typeof e.order === 'string' && !e.order.endsWith('0'));
    try { return ctx.util.order(last ? last.order : null, null); } catch (err) { return undefined; }
  }
  // What a value with `patch` (entryPatch) applied is: shownDate null takes it away.
  const patched = (value, patch) => {
    const v = { ...value, ...patch };
    if (v.shownDate === null) delete v.shownDate;
    return v;
  };
  // The writes for a plan whose entries `changed` (id -> stored value) were written: those values, then each goal they
  // touch made to say what its steps say (goals.js syncEntry), so the summary and a phase measured by goals read it.
  function writesFor(plan, changed, goals, ctx) {
    const p = prefsOf(ctx);
    const byId = new Map(plan.byId);
    for (const [id, v] of changed) byId.set(id, G.readEntry(id, v));
    const out = new Map(changed);
    for (const gid of goals) {
      const e = gid && byId.get(gid);
      if (!e || e.kind !== 'goal') continue;
      const patch = G.entryPatch(e, kidsOf(byId, gid), p.progressBy, p.datesOn);
      if (!patch) continue;
      out.set(gid, patched(out.get(gid) || G.stored(e), patch));
    }
    return [...out].map(([id, value]) => ({ key: PREFIX + id, value }));
  }
  // A new entry, as goals.js add makes it: credited to the asker's key, after its siblings, its goal's progress moved.
  function add(kind, raw, ctx) {
    const plan = planOf(ctx);
    const parent = kind === 'goal' ? null : raw.parent || null;
    const value = G.valueOf(kind, { ...raw, parent, order: orderAtEnd(plan.byId, parent, ctx) }, { dates: prefsOf(ctx).datesOn });
    value.createdAt = ctx.now;
    value.by = ctx.credit.key;
    const id = ctx.util.id();
    return { writes: writesFor(plan, new Map([[id, value]]), [value.parent], ctx), ref: refOf(ctx, id) };
  }
  const obj = (input) => (input && input.object && typeof input.object === 'object' ? input.object : null);
  // The goal a pointer names, of this plan: its entry, or the refusal.
  function ownGoal(ref, plan, ctx) {
    const e = G.isOwnRef(ref, 'goals', ctx.space.id) ? plan.byId.get(ref.id) : null;
    if (!e || e.kind !== 'goal') throw new Error(`That is not ${labelOf(ctx)('goal', { a: true })} of this plan.`);
    return e;
  }
  // The entry a pointer names, of this plan, or the refusal (goals.js update's own sentence).
  function ownEntry(ref, plan, ctx) {
    const e = G.isOwnRef(ref, 'goals', ctx.space.id) ? plan.byId.get(ref.id) : null;
    if (!e) throw new Error('That is no longer in the plan.');
    return e;
  }
  // The entry `e` written again with `changes`, as goals.js update does: its own fields clean (valueOf), who made it and when
  // kept, then the goals it touches (itself, the one it left, the one it went under) made to say what their steps say.
  function update(plan, e, changes, ctx) {
    const value = G.valueOf(e.kind, { ...G.stored(e), ...changes }, { dates: prefsOf(ctx).datesOn });
    if (e.createdAt) value.createdAt = e.createdAt;
    if (e.by) value.by = e.by;
    const writes = writesFor(plan, new Map([[e.id, value]]), [e.kind === 'goal' ? e.id : null, e.parent, value.parent], ctx)
      .filter((w) => canon(w.value) !== canon(plan.values.get(w.key.slice(PREFIX.length))));
    if (!writes.length) return { ref: refOf(ctx, e.id), data: { note: 'That is already so; nothing changed.' } };
    return { writes, ref: refOf(ctx, e.id) };
  }

  const handlers = {
    // With `object` (a goal, a step or a note in the objects format), its fields are mapped (GoalsLib.fromObject): the goal a
    // step sits under is the one `details.under` names, else the pointer given; a phase is named, so it is matched to the template's.
    addGoal(input, ctx) {
      const o = obj(input);
      const raw = o ? G.fromObject('goal', o, { phases: ctx.space.phases }) : { title: input.title, why: input.why, date: input.date };
      // Owners are checked before anything is made; a person is named by key or by name (the form's own owners: a list of keys).
      let owners;
      if (given(input.owners)) {
        const r = G.ownersFor(input.owners, ctx.people, ctx.util.word('space'));
        if (r.problem) throw new Error(r.problem);
        owners = r.owners;
      }
      return add('goal', { ...raw, date: raw.date || input.date, ...(owners && owners.length ? { owners } : {}) }, ctx);
    },
    addStep(input, ctx) {
      const label = labelOf(ctx);
      const plan = planOf(ctx);
      const o = obj(input);
      const raw = o ? G.fromObject('step', o, { entries: [...plan.byId.values()] }) : { title: input.title };
      const parent = input.goal ? ownGoal(input.goal, plan, ctx).id : raw.parent;
      if (!parent) throw new Error(o ? `Add ${label('goal', { a: true })} first: no ${label('goal')} here is named "${String(raw.under || '').slice(0, 60)}".` : `Say which ${label('goal')} it goes under.`);
      return add('step', { ...raw, date: raw.date || input.date, parent }, ctx);
    },
    addNote(input, ctx) {
      const plan = planOf(ctx);
      const o = obj(input);
      const parent = input.goal ? ownGoal(input.goal, plan, ctx).id : null;
      const raw = o ? G.fromObject('note', o) : { title: input.title, text: input.text };
      return add('note', { ...raw, text: raw.text || input.text, parent }, ctx);
    },
    // Change a goal, a step or a note: only the fields given, with the form's own checks and sentences. A goal has why and
    // owners, a goal and a step a date, a note its text; a step or a note moves under another goal with `goal` (to the end of
    // it, as the form moves one). An input sent as "" (the manifest's `clears`: why, date, owners, text) clears it, as
    // emptying it in the form does. Done is setGoalDone's.
    updateGoal(input, ctx) {
      const label = labelOf(ctx);
      const plan = planOf(ctx);
      const e = ownEntry(input.entry, plan, ctx);
      const fields = ['title', 'why', 'date', 'owners', 'text', 'goal'];
      if (!fields.some((f) => given(input[f]))) throw new Error(`Say what to change: the title, why, the date, the ${label('owner', { many: true })}, the text or the goal it is under. Send "" to clear why, the date, the ${label('owner', { many: true })} or the text.`);
      const A = (k) => cap(label(k, { a: true }));
      if (given(input.why) && e.kind !== 'goal') throw new Error(`Only ${label('goal', { a: true })} has a why.`);
      if (given(input.owners) && e.kind !== 'goal') throw new Error(`Only ${label('goal', { a: true })} has ${label('owner', { many: true })}.`);
      if (given(input.text) && e.kind !== 'note') throw new Error(`Only ${label('note', { a: true })} has text.`);
      if (given(input.date) && e.kind === 'note') throw new Error(`${A('note')} has no date.`);
      const changes = {};
      if (given(input.title)) {
        if (!String(input.title).trim()) throw new Error('Give it a title.');
        changes.title = input.title;
      }
      if (given(input.why)) changes.why = input.why;
      if (given(input.text)) changes.text = input.text;
      if (input.date === '') changes.date = '';
      else if (given(input.date)) changes.date = input.date;
      if (input.owners === '') changes.owners = [];
      else if (given(input.owners)) {
        const r = G.ownersFor(input.owners, ctx.people, ctx.util.word('space'));
        if (r.problem) throw new Error(r.problem);
        changes.owners = r.owners;
      }
      if (given(input.goal)) {
        const g = ownGoal(input.goal, plan, ctx);
        const problem = G.moveProblem(plan.byId, { id: e.id, parent: g.id }, label);
        if (problem) throw new Error(problem);
        if (g.id !== e.parent) { changes.parent = g.id; changes.order = orderAtEnd(plan.byId, g.id, ctx); }
      }
      return update(plan, e, changes, ctx);
    },
    // Mark a goal or a step done, or open again, as its tick in the plan does. A goal whose progress is its steps (the plan's
    // "A goal's progress" setting, and it has steps) is done when they all are, so it has no tick of its own.
    setGoalDone(input, ctx) {
      const label = labelOf(ctx);
      const plan = planOf(ctx);
      const e = ownEntry(input.entry, plan, ctx);
      if (typeof input.done !== 'boolean') throw new Error('Say done as true or false.');
      if (e.kind === 'note') throw new Error(`${cap(label('note', { a: true }))} is never done; only ${label('goal', { many: true })} and ${label('step', { many: true })} are.`);
      if (e.kind === 'goal' && G.goalState(e, kidsOf(plan.byId, e.id), prefsOf(ctx).progressBy).derived) {
        throw new Error(`That ${label('goal')} is done when every ${label('step')} is done; mark its ${label('step', { many: true })} instead.`);
      }
      return update(plan, e, { done: input.done }, ctx);
    },
  };
  return { handlers };
})();
const ACTION_HANDLERS = GoalsActions.handlers;
