// The Goal outline's rules, with no page and no host: what an entry is, the tree of goals and what sits under them, a goal's
// progress, and which moves the outline may make. goals.js draws from these; test/check-goals-lib.mjs runs them in Node.
//
// Storage: one key per entry, `plan:<id>` (the `plan` kind convention, plan-templates-redesign.md). Every entry is
// { kind, title, parent, order, createdAt?, by? } and, by kind:
//   goal  { why?, owners?, date?, phase?, done, progress }   at the top of the list (parent null)
//   step  { date?, done }                                    under a goal
//   note  { text? }                                          under a goal or at the top; no `done`, so it is never counted
// A goal's `done` and `progress` are stored, so the server's refs summary (and a phase measured by goals, decision 38) reads
// them; goals.js writes them again whenever its steps change (entryPatch).
// `shownDate` is the date the rest of the product sees (the refs summary's `when` and the Calendar's copy through `dated`): the
// entry's `date` while the plan's `dates` setting is optional, none while it is off, so with dates off nothing reaches the
// Calendar and the stored `date` waits, unchanged, for dates to come back on.
const GoalsLib = (() => {
  'use strict';
  const KINDS = ['goal', 'step', 'note'];
  const ID = /^[A-Za-z0-9_-]{1,64}$/;
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const PHASE = /^[a-z][a-z0-9-]*$/;
  const MAX_TITLE = 200;
  const MAX_WHY = 2000;
  const MAX_TEXT = 8000;
  const MAX_OWNERS = 50;
  const MAX_LINKS = 20;

  // The pointers an entry keeps to other modules' objects (host.objects): { module, kind, id, scope, space? }, at most 20, no repeats.
  function cleanLinks(raw) {
    const out = [];
    const seen = new Set();
    for (const r of Array.isArray(raw) ? raw : []) {
      if (!r || typeof r !== 'object') continue;
      const ok = ['module', 'kind', 'id'].every((k) => typeof r[k] === 'string' && r[k] && r[k].length <= 64) && ['environment', 'space'].includes(r.scope);
      if (!ok || (r.space !== undefined && (typeof r.space !== 'string' || r.space.length > 64))) continue;
      const key = `${r.module}:${r.kind}:${r.id}:${r.space || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ module: r.module, kind: r.kind, id: r.id, scope: r.scope, ...(r.space ? { space: r.space } : {}) });
      if (out.length >= MAX_LINKS) break;
    }
    return out;
  }

  const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');

  // A stored value, read as an entry: { id, kind, title, parent, order, ... } or null when it is not one of ours. Starter
  // content and older writes may leave fields out: a missing kind reads as a goal at the top, a missing order sorts last.
  function readEntry(id, v) {
    if (!ID.test(String(id || '')) || !v || typeof v !== 'object' || Array.isArray(v)) return null;
    const kind = KINDS.includes(v.kind) ? v.kind : v.parent ? 'step' : 'goal';
    const e = { id, kind, title: str(v.title, MAX_TITLE), parent: typeof v.parent === 'string' && ID.test(v.parent) ? v.parent : null };
    if (typeof v.order === 'string' && /^[0-9A-Za-z]{1,200}$/.test(v.order)) e.order = v.order;
    if (typeof v.date === 'string' && DAY.test(v.date)) e.date = v.date;
    if (typeof v.shownDate === 'string' && DAY.test(v.shownDate)) e.shownDate = v.shownDate;
    if (Number.isFinite(v.createdAt)) e.createdAt = v.createdAt;
    if (typeof v.by === 'string' && v.by.length <= 200) e.by = v.by;
    const links = cleanLinks(v.links);
    if (links.length) e.links = links;
    if (kind === 'goal') {
      e.why = str(v.why, MAX_WHY);
      e.owners = Array.isArray(v.owners) ? [...new Set(v.owners.filter((k) => typeof k === 'string' && k && k.length <= 200))].slice(0, MAX_OWNERS) : [];
      if (typeof v.phase === 'string' && v.phase.length <= 40 && PHASE.test(v.phase)) e.phase = v.phase;
      e.done = v.done === true;
      e.progress = Number.isFinite(v.progress) ? Math.min(100, Math.max(0, Math.round(v.progress))) : 0;
    } else if (kind === 'step') {
      e.done = v.done === true;
    } else {
      e.text = str(v.text, MAX_TEXT);
    }
    return e;
  }

  // Siblings in the outline's own order: `order` by character code, none last, then by id (host.ui.outline sorts the same).
  function compare(a, b) {
    const ao = typeof a.order === 'string' ? a.order : null;
    const bo = typeof b.order === 'string' ? b.order : null;
    if (ao !== bo) {
      if (ao === null) return 1;
      if (bo === null) return -1;
      return ao < bo ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }

  // The plan as the Goals view shows it: { goals: [{ goal, steps, notes }], loose: [entries at the top or under nothing that
  // is not a goal] }. A step whose goal is gone, or a goal written under something, is shown, never lost: the step among the
  // loose entries, the goal at the top.
  function treeOf(entries) {
    const list = (Array.isArray(entries) ? entries : []).filter(Boolean);
    const goalsById = new Map(list.filter((e) => e.kind === 'goal').map((e) => [e.id, e]));
    const under = new Map();
    const loose = [];
    for (const e of list) {
      if (e.kind === 'goal') continue;
      if (e.parent && goalsById.has(e.parent)) {
        if (!under.has(e.parent)) under.set(e.parent, []);
        under.get(e.parent).push(e);
      } else loose.push(e);
    }
    const goals = [...goalsById.values()].sort(compare).map((goal) => {
      const kids = (under.get(goal.id) || []).sort(compare);
      return { goal, steps: kids.filter((e) => e.kind === 'step'), notes: kids.filter((e) => e.kind === 'note'), children: kids };
    });
    return { goals, loose: loose.sort(compare) };
  }

  // A goal's state under the plan's `progressBy`: { done, progress, stepsDone, steps, derived }. By steps, a goal with steps is
  // as far along as the share of them done, and done when every one is (`derived`: its own tick does not count); a goal with
  // no steps, or any goal when progress is by done, is its own tick.
  function goalState(goal, steps, progressBy) {
    const list = (Array.isArray(steps) ? steps : []).filter((s) => s && s.kind === 'step');
    const stepsDone = list.filter((s) => s.done).length;
    if (progressBy !== 'done' && list.length) {
      return { done: stepsDone === list.length, progress: Math.round((stepsDone / list.length) * 100), stepsDone, steps: list.length, derived: true };
    }
    const done = Boolean(goal && goal.done);
    return { done, progress: done ? 100 : 0, stepsDone, steps: list.length, derived: false };
  }

  // What a goal's stored value must change to so it says what its steps say: { done, progress }, or null when it already does.
  function goalPatch(goal, steps, progressBy) {
    if (!goal || goal.kind !== 'goal') return null;
    const s = goalState(goal, steps, progressBy);
    return s.done === goal.done && s.progress === goal.progress ? null : { done: s.done, progress: s.progress };
  }

  // What an entry's stored value must change to so it says what its steps and the plan's `dates` setting say: { done?, progress?,
  // shownDate? } (shownDate null: take it away), or null when it already does.
  function entryPatch(e, children, progressBy, datesOn) {
    if (!e) return null;
    const out = {};
    const g = e.kind === 'goal' ? goalPatch(e, (children || []).filter((c) => c.kind === 'step'), progressBy) : null;
    if (g) Object.assign(out, g);
    const shown = datesOn && e.kind !== 'note' && e.date ? e.date : null;
    if ((e.shownDate || null) !== shown) out.shownDate = shown;
    return Object.keys(out).length ? out : null;
  }

  // Whether a pointer is to an entry of this plan: this module, the `plan` kind, a space's object and this very space. A pointer
  // to another space's entry is not, even when its id matches one here.
  function isOwnRef(ref, moduleId, spaceId) {
    return Boolean(ref && typeof ref === 'object' && ref.module === moduleId && ref.kind === 'plan' && ref.scope === 'space'
      && typeof ref.space === 'string' && ref.space && ref.space === spaceId && typeof ref.id === 'string' && ID.test(ref.id));
  }

  // The entries under each entry, { <parent id>: [entries in order] }, made in one pass, so asking for the children of every
  // entry costs no more than the list is long, however many entries a writer put in a chain.
  function childIndex(entries) {
    const out = new Map();
    for (const e of Array.isArray(entries) ? entries : []) {
      if (!e || !e.parent) continue;
      if (!out.has(e.parent)) out.set(e.parent, []);
      out.get(e.parent).push(e);
    }
    for (const kids of out.values()) kids.sort(compare);
    return out;
  }

  // The entries as the List view's outline takes them: two levels at most. A goal is at the top; a step or a note is under its
  // goal only when that parent is a goal, else at the top. So a chain of entries each under the last (written through the data
  // route) is drawn flat and never nests deeper than the plan does.
  function outlineEntries(entries) {
    const list = (Array.isArray(entries) ? entries : []).filter(Boolean);
    const goals = new Set(list.filter((e) => e.kind === 'goal').map((e) => e.id));
    return list.map((e) => ({ id: e.id, parent: e.kind !== 'goal' && e.parent && goals.has(e.parent) ? e.parent : null, order: e.order, title: e.title, done: e.done }));
  }

  // Whether the outline may make a move ({ id, parent }): '' when it may, else the one sentence that says why not.
  // `word(key, { a, cap })` gives the module's word for goal, step and note (host.util.label).
  function moveProblem(byId, move, word) {
    const w = typeof word === 'function' ? word : (k, o) => (o && o.a ? `a ${k}` : k);
    const e = byId.get(move && move.id);
    if (!e) return 'That is no longer in the plan.';
    const parent = move.parent ? byId.get(move.parent) : null;
    if (move.parent && !parent) return 'That is no longer in the plan.';
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    if (e.kind === 'goal' && parent) return `${cap(w('goal', { a: true }))} stays at the top of the list.`;
    if (e.kind === 'step' && (!parent || parent.kind !== 'goal')) return `${cap(w('step', { a: true }))} goes under ${w('goal', { a: true })}.`;
    if (e.kind === 'note' && parent && parent.kind !== 'goal') return `${cap(w('note', { a: true }))} goes under ${w('goal', { a: true })} or at the top.`;
    return '';
  }

  // A clean value to store for an entry of `kind` from what a form or an action gave. Throws a plain sentence for a missing
  // title. `dates` false keeps the date but shows it nowhere else (no `shownDate`: the plan's `dates` setting is off).
  function valueOf(kind, raw, { dates = true } = {}) {
    if (!KINDS.includes(kind)) throw new Error('That is not something the plan holds.');
    const title = str(raw && raw.title, MAX_TITLE);
    if (!title) throw new Error('Give it a title.');
    const v = { kind, title, parent: typeof raw.parent === 'string' && ID.test(raw.parent) ? raw.parent : null };
    if (typeof raw.order === 'string' && raw.order) v.order = raw.order;
    const links = cleanLinks(raw.links);
    if (links.length) v.links = links;
    if (kind !== 'note' && typeof raw.date === 'string' && DAY.test(raw.date)) { v.date = raw.date; if (dates) v.shownDate = raw.date; }
    if (kind === 'goal') {
      v.parent = null;
      const why = str(raw.why, MAX_WHY);
      if (why) v.why = why;
      const owners = Array.isArray(raw.owners) ? [...new Set(raw.owners.filter((k) => typeof k === 'string' && k && k.length <= 200))].slice(0, MAX_OWNERS) : [];
      if (owners.length) v.owners = owners;
      if (typeof raw.phase === 'string' && raw.phase.length <= 40 && PHASE.test(raw.phase)) v.phase = raw.phase;
      v.done = raw.done === true;
      v.progress = Number.isFinite(raw.progress) ? Math.min(100, Math.max(0, Math.round(raw.progress))) : v.done ? 100 : 0;
    } else if (kind === 'step') {
      v.done = raw.done === true;
    } else {
      const text = str(raw.text, MAX_TEXT);
      if (text) v.text = text;
    }
    return v;
  }

  // The stored value of an entry as read (readEntry), for writing it back with some fields changed.
  function stored(e) {
    const v = { kind: e.kind, title: e.title, parent: e.parent };
    for (const k of ['order', 'date', 'shownDate', 'why', 'phase', 'text']) if (e[k]) v[k] = e[k];
    if (e.kind === 'goal') { if (e.owners && e.owners.length) v.owners = e.owners.slice(); v.done = Boolean(e.done); v.progress = e.progress || 0; }
    if (e.kind === 'step') v.done = Boolean(e.done);
    if (e.links && e.links.length) v.links = e.links.map((r) => ({ ...r }));
    if (e.createdAt) v.createdAt = e.createdAt;
    if (e.by) v.by = e.by;
    return v;
  }


  // --- an object taken whole (the objects format's goal, step and note) ------------------------------------------------------------
  // A title as it is compared: plain text, one line, lower case.
  const key = (s) => str(s, MAX_TITLE).replace(/\s+/g, ' ').toLowerCase();

  // The goal an `under` title names, as an id, or null. Only a goal holds steps. Of two goals with the same title the most
  // recently made wins (`createdAt`, else the later in `entries`); an `under` equal to the entry's own title names nothing.
  function goalFor(entries, under, ownTitle) {
    const k = key(under);
    if (!k || k === key(ownTitle)) return null;
    let found = null;
    for (const e of Array.isArray(entries) ? entries : []) {
      if (e && e.kind === 'goal' && key(e.title) === k && (!found || (e.createdAt || 0) >= (found.createdAt || 0))) found = e;
    }
    return found ? found.id : null;
  }

  // The id of the template's phase a name (or an id) names, ignoring case, or ''.
  function phaseFor(phases, name) {
    const k = key(name);
    if (!k) return '';
    for (const p of Array.isArray(phases) ? phases : []) {
      if (p && typeof p.id === 'string' && (p.id.toLowerCase() === k || key(p.label) === k || key(p.name) === k)) return p.id;
    }
    return '';
  }

  // The fields addGoal, addStep or addNote would be given, from an object: { title, why | text, date, done, phase, parent, under }; a step with no parent is refused by the caller (a step goes under a goal).
  // `o`: { entries, phases }; `parent` is the goal `details.under` names (the caller's own `goal` pointer wins over it).
  function fromObject(kind, object, o) {
    const obj = object && typeof object === 'object' ? object : {};
    const d = obj.details && typeof obj.details === 'object' && !Array.isArray(obj.details) ? obj.details : {};
    const day = (v) => (typeof v === 'string' && DAY.test(v.slice(0, 10)) && +v.slice(0, 4) >= 1900 && +v.slice(0, 4) <= 2200 ? v.slice(0, 10) : undefined); // the days 1900 to 2200
    const out = { title: obj.title };
    const words = typeof obj.content === 'string' ? obj.content : '';
    if (kind === 'goal') {
      out.why = typeof d.why === 'string' && d.why.trim() ? d.why : words;
      out.date = day(d.date) || day(obj.date);
      out.phase = phaseFor(o && o.phases, d.phase);
    } else if (kind === 'step') {
      out.date = day(d.date) || day(obj.date);
      if (d.done === true) out.done = true;
      out.parent = goalFor(o && o.entries, d.under, obj.title);
      out.under = typeof d.under === 'string' ? d.under : '';
    } else out.text = words;
    return out;
  }

  // The people keys an `owners` input names: a list (or one text, split at commas) of keys or display names as list_members shows
  // them, ignoring case and spaces. A key wins over a name. Each person once. `people`: [{ key, name }]; `space`: the space word.
  // Answers { owners, problem }: a name two people share, or a person who is not here, is refused with one sentence and nothing is guessed.
  function ownersFor(value, people, space) {
    const where = space || 'space';
    const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : null;
    const bad = { owners: null, problem: 'Name the people as a list, separated by commas.' };
    if (!list) return bad;
    const folk = (Array.isArray(people) ? people : []).filter((p) => p && typeof p.key === 'string' && p.key);
    const owners = [];
    for (const item of list) {
      if (typeof item !== 'string') return bad;
      const name = item.trim();
      if (!name) continue;
      const low = name.toLowerCase();
      let hit = folk.filter((p) => p.key === name);
      if (!hit.length) hit = folk.filter((p) => p.key.toLowerCase() === low);
      if (!hit.length) hit = folk.filter((p) => typeof p.name === 'string' && p.name.trim().toLowerCase() === low);
      if (hit.length > 1) return { owners: null, problem: `Two people are called ${name}; use the key.` };
      if (!hit.length) return { owners: null, problem: `That person is not in this ${where}. Use list_members to see who is.` };
      if (!owners.includes(hit[0].key)) owners.push(hit[0].key);
    }
    return { owners: owners.slice(0, MAX_OWNERS), problem: '' };
  }

  return { KINDS, ownersFor, goalFor, phaseFor, fromObject, cleanLinks, readEntry, compare, treeOf, goalState, goalPatch, entryPatch, isOwnRef, childIndex, outlineEntries, moveProblem, valueOf, stored };
})();
