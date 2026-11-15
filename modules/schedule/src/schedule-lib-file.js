// The plan as a JSON file (Planner - Projects): what Export writes and what Import reads back. Pure rules with no host and no
// page (schedule.js draws the menu and does the writing; test/check-schedule-file.mjs runs these in Node). The format a person
// or an AI follows to make a file is written out in src/FORMAT.md; that file's example is run through the importer by the test.
//
//   { "format": "project-plan", "version": 1, "exportedAt": "<ISO time>", "module": "schedule", "entries": [ <entry>, ... ] }
//
// An entry has the fields scClean reads (see schedule-lib.js), plus an optional `id` that `parent` and `waitsOn` of other entries
// of the same file name. The file is read whole and checked before anything is written; the first thing wrong is one sentence.
const SC_FILE = Object.freeze({
  format: 'project-plan',
  version: 1,
  maxBytes: 1024 * 1024, // one file
  maxEntries: 500, // in one file
  maxPlan: 1000, // in the plan once the file is added
});

// What goes in the file: every entry in the outline's order, each with its id and every field it stores.
function scExportFile(entries, o) {
  const ordered = scOrdered(entries).map((x) => x.entry);
  return {
    format: SC_FILE.format,
    version: SC_FILE.version,
    exportedAt: (o && o.now) || new Date().toISOString(),
    module: (o && o.module) || 'schedule',
    entries: ordered.map((e) => ({ id: e.id, ...scValue(e) })),
  };
}
// The file's name: by kind, with the day.
function scExportName(day) {
  return `project-plan-${typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : 'file'}.json`;
}

function scFileSyntax(text, err) {
  const m = /position (\d+)/.exec(String((err && err.message) || ''));
  const line = m ? text.slice(0, Number(m[1])).split('\n').length : (/line (\d+)/.exec(String((err && err.message) || '')) || [])[1];
  return line ? `The file is not valid JSON (near line ${line}).` : 'The file is not valid JSON.';
}

// Reads the text of a file. Answers { entries: [raw entries, each checked] } or { problem: 'one plain sentence' }. Nothing here
// writes. `o`: { label(key), datesRequired }.
function scParseFile(text, o) {
  const label = (o && o.label) || ((k) => k);
  if (typeof text !== 'string' || !text.trim()) return { problem: 'The file is empty.' };
  if (text.length > SC_FILE.maxBytes) return { problem: `The file is too big: at most ${SC_FILE.maxBytes / 1024 / 1024} MB.` };
  let data;
  try { data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); } catch (err) { return { problem: scFileSyntax(text, err) }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { problem: `The file must be written like { "format": "${SC_FILE.format}", "version": 1, "entries": [ ... ] }.` };
  if (data.format !== SC_FILE.format) return { problem: `This is not a project plan file: its "format" must be "${SC_FILE.format}".` };
  if (data.version !== SC_FILE.version) return { problem: `The file's "version" must be ${SC_FILE.version}.` };
  if (!Array.isArray(data.entries)) return { problem: 'The file needs an "entries" list.' };
  if (!data.entries.length) return { problem: 'The file has no entries.' };
  if (data.entries.length > SC_FILE.maxEntries) return { problem: `The file has ${data.entries.length} entries: at most ${SC_FILE.maxEntries}.` };

  const seen = new Map(); // id -> entry
  const who = (i, v) => {
    const t = v && typeof v === 'object' && typeof v.title === 'string' ? scLine(v.title, 40) : '';
    return t ? `Entry ${i + 1} ("${t}")` : `Entry ${i + 1}`;
  };
  const list = data.entries;
  const problems = [];
  const MAXP = 6; // the first and up to five more, one for each entry
  for (let i = 0; i < list.length && problems.length < MAXP; i += 1) {
    const p = (() => {
      const v = list[i];
      const w = who(i, v);
      if (!v || typeof v !== 'object' || Array.isArray(v)) return `${w} must be written like { "kind": "note", "title": "..." }.`;
      if (v.id !== undefined && v.id !== null && v.id !== '') {
        if (typeof v.id !== 'string' || !SC_ID.test(v.id)) return `${w}: "id" must be 1 to 64 letters, digits, dashes or underscores.`;
        if (seen.has(v.id)) return `${w}: the id "${v.id}" is used twice.`;
        seen.set(v.id, v);
      }
      if (!SC_KINDS.includes(v.kind)) return `${w}: "kind" must be ${SC_KINDS.map((k) => `"${k}"`).join(', ').replace(/, ("note")$/, ' or $1')}.`;
      if (typeof v.title !== 'string' || !scLine(v.title, 1)) return `${w}: "title" is needed.`;
      if (v.title.trim().length > SC_TITLE_MAX) return `${w}: "title" is over ${SC_TITLE_MAX} characters.`;
      if (v.notes !== undefined && v.notes !== null) {
        if (typeof v.notes !== 'string') return `${w}: "notes" must be text.`;
        if (v.notes.trim().length > SC_NOTES_MAX) return `${w}: "notes" is over ${SC_NOTES_MAX} characters.`;
      }
      for (const f of ['start', 'end']) {
        const d = v[f];
        if (d !== undefined && d !== null && d !== '' && !scIsDay(d)) return `${w}: "${f}" must be a day like 2026-10-14, from ${SC_YEAR_MIN} to ${SC_YEAR_MAX}.`;
      }
      if (v.kind === 'work' && v.start && v.end && v.end < v.start) return `${w}: "end" is before "start".`;
      for (const f of ['owners', 'waitsOn', 'tags']) {
        const l = v[f];
        if (l === undefined || l === null) continue;
        if (!Array.isArray(l) || l.some((x) => typeof x !== 'string')) return `${w}: "${f}" must be a list of text.`;
        if (l.length > SC_LIST_MAX) return `${w}: "${f}" has more than ${SC_LIST_MAX}.`;
      }
      for (const f of ['done', 'ticked']) if (v[f] !== undefined && v[f] !== null && typeof v[f] !== 'boolean') return `${w}: "${f}" must be true or false.`;
      if (v.phase !== undefined && v.phase !== null && v.phase !== '' && !(typeof v.phase === 'string' && /^[a-z][a-z0-9-]{0,40}$/.test(v.phase))) return `${w}: "phase" must be lower case letters, digits and dashes.`;
      if (v.order !== undefined && v.order !== null && v.order !== '' && !(typeof v.order === 'string' && /^[0-9A-Za-z]{1,200}$/.test(v.order))) return `${w}: "order" must be letters and digits.`;
      if (v.by !== undefined && v.by !== null && typeof v.by !== 'string') return `${w}: "by" must be text.`;
      if (v.ref !== undefined && v.ref !== null && !scCleanRef(v.ref)) return `${w}: "ref" must be a pointer as Export writes it.`;
      if (v.parent !== undefined && v.parent !== null && v.parent !== '' && typeof v.parent !== 'string') return `${w}: "parent" must be the id of another entry.`;
      if (v.progress !== undefined && v.progress !== null && !(Number.isInteger(v.progress) && v.progress >= 0 && v.progress <= 100)) return `${w}: "progress" must be a whole number from 0 to 100.`;
      const problem = scProblem(scClean('x', v), { datesRequired: Boolean(o && o.datesRequired), label });
      if (problem) return `${w}: ${problem}`;
    return '';
    })();
    if (p) problems.push(p);
  }
  if (problems.length) return { problem: problems[0], problems };

  // Entries that name others: each must be in the file, and none may loop.
  const kindOf = new Map([...seen].map(([id, v]) => [id, v.kind]));
  for (let i = 0; i < list.length && problems.length < MAXP; i += 1) {
    const p = (() => {
      const v = list[i];
      const w = who(i, v);
      if (v.parent) {
        if (!seen.has(v.parent)) return `${w}: "parent" names "${v.parent}", which is not an id in the file.`;
        if (v.parent === v.id) return `${w}: it cannot be part of itself.`;
        if (kindOf.get(v.parent) !== 'milestone') return `${w}: "parent" must be a milestone.`;
        const up = new Set([v.id].filter(Boolean));
        for (let p = v.parent; p; p = seen.get(p).parent) {
          if (up.has(p)) return `${w}: the entries are part of each other in a loop.`;
          up.add(p);
        }
      }
      for (const t of Array.isArray(v.waitsOn) ? v.waitsOn : []) {
        if (!seen.has(t)) return `${w}: "waitsOn" names "${t}", which is not an id in the file.`;
        if (t === v.id) return `${w}: it cannot wait on itself.`;
        if (kindOf.get(t) === 'note') return `${w}: "waitsOn" names "${t}", a note; only milestones and work can be waited on.`;
      }
    return '';
    })();
    if (p) problems.push(p);
  }
  const graph = list.filter((v) => v.id).map((v) => ({ id: v.id, waitsOn: v.kind === 'note' ? [] : (Array.isArray(v.waitsOn) ? v.waitsOn : []) }));
  for (let i = 0; i < list.length && problems.length < MAXP; i += 1) {
    const p = (() => {
      const v = list[i];
      if (!v.id || v.kind === 'note') return '';
      for (const t of Array.isArray(v.waitsOn) ? v.waitsOn : []) {
        if (scMakesLoop(graph, v.id, t) && t !== v.id) return `${who(i, v)}: it and "${t}" wait on each other in a loop.`;
      }
    return '';
    })();
    if (p) problems.push(p);
  }
  if (problems.length) return { problem: problems[0], problems };
  return { entries: list };
}

// The entries to write, from what scParseFile answered. `o`: { mode: 'add' | 'replace', existing: [entries now in the plan],
// newId(), orderAfter(key|null) -> the order key after it, by: the person's key }. Add gives every entry a new id and puts them
// after what is there; Replace keeps the file's ids (new ones for those with none) and its order keys when all are usable.
// `parent` and `waitsOn` follow the ids. Answers cleaned entries, ready for scValue.
function scImportEntries(raws, o) {
  const replace = o && o.mode === 'replace';
  const existing = (o && o.existing) || [];
  const used = new Set(replace ? [] : existing.map((e) => e.id));
  const map = new Map();
  const ids = [];
  for (const v of raws) {
    let id = replace && v.id ? v.id : o.newId();
    while (used.has(id)) id = o.newId();
    used.add(id);
    if (v.id) map.set(v.id, id);
    ids.push(id);
  }
  const out = raws.map((v, i) => scClean(ids[i], {
    ...v,
    parent: v.parent ? map.get(v.parent) : null,
    waitsOn: (Array.isArray(v.waitsOn) ? v.waitsOn : []).map((t) => map.get(t)),
    by: typeof v.by === 'string' && v.by ? v.by : (o && o.by) || '',
    order: '',
  }));
  // Order keys, a group of siblings at a time.
  const groups = new Map();
  out.forEach((e, i) => { const k = e.parent || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
  const next = (prev) => { try { return o.orderAfter(prev) || ''; } catch (err) { return ''; } };
  for (const [parent, at] of groups) {
    const given = at.map((i) => (typeof raws[i].order === 'string' ? raws[i].order : ''));
    if (replace && given.every((x) => /^[0-9A-Za-z]{1,200}$/.test(x)) && new Set(given).size === given.length) { at.forEach((i, n) => { out[i].order = given[n]; }); continue; }
    let prev = null;
    if (!replace && !parent) prev = existing.filter((e) => !e.parent && e.order).map((e) => e.order).sort().pop() || null;
    for (const i of at) { out[i].order = next(prev); prev = out[i].order || prev; }
  }
  return out;
}
