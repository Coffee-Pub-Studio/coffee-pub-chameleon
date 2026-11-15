// How a space's phases are measured (documentation/plans/plan-templates-redesign.md, "Phases and their measure", decisions 37 and 38).
//
// A template's `phaseMeasure` says what a phase is measured by:
//   dates    -- the dates on the space's timeline (public/phases.js). No Done switch, no counts.
//   progress -- the Done switch the owner or a moderator flips per phase (`space.phaseDone`, { <phase id>: true }).
//   goals    -- every planner entry that names the phase (the `phase` of its refs summary, with a `done` beside it) is
//               done; a phase no entry names uses the same switch.
// For progress and goals the first phase that is not done is the current one.
//
// Pure: no store, no module data. server/index.js reads the entries and the switches and calls these.
'use strict';

const PHASE_ID = /^[a-z][a-z0-9-]*$/;
const MAX_SWITCHES = 50; // stale ids are kept (the phase dates rule), so more than the 12 a template has, but not without end

// The switches as stored, cleaned: { <phase id>: true }. Anything else is dropped.
function cleanDone(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw)) {
    if (v === true && PHASE_ID.test(id) && Object.keys(out).length < MAX_SWITCHES) out[id] = true;
  }
  return out;
}

// What the entries say, { <phase id>: { done, total } }, from object summaries (server/index.js objectSummary): only an
// entry that names one of `phases` and says done or not done counts (a note with no done is not a goal to finish).
function tallyOf(phases, summaries) {
  const known = new Set((Array.isArray(phases) ? phases : []).map((p) => p.id));
  const out = {};
  for (const s of Array.isArray(summaries) ? summaries : []) {
    if (!s || typeof s.phase !== 'string' || !known.has(s.phase) || typeof s.done !== 'boolean') continue;
    const t = out[s.phase] || (out[s.phase] = { done: 0, total: 0 });
    t.total += 1;
    if (s.done) t.done += 1;
  }
  return out;
}

// The template's phases ([{ id, label, main?, icon? }]) with their state under `measure`:
//   dates: the phases as they are. progress: each gains `done`. goals: each gains `done`, and `goals: { done, total }`
//   while entries name it (it is done when they all are). Under progress and goals the first phase not done also
//   carries `current: true`. `switches` is the space's { <id>: true }; `tally` is tallyOf's answer (goals only).
function statesOf(phases, measure, switches, tally) {
  const list = Array.isArray(phases) ? phases : [];
  if (measure !== 'progress' && measure !== 'goals') return list.map((p) => ({ ...p }));
  const on = cleanDone(switches);
  let current = false;
  return list.map((p) => {
    const t = measure === 'goals' && tally && tally[p.id] && tally[p.id].total > 0 ? tally[p.id] : null;
    const done = t ? t.done === t.total : on[p.id] === true;
    const out = { ...p, done, ...(t ? { goals: { done: t.done, total: t.total } } : {}) };
    if (!done && !current) { out.current = true; current = true; }
    return out;
  });
}

module.exports = { cleanDone, tallyOf, statesOf, PHASE_ID };
