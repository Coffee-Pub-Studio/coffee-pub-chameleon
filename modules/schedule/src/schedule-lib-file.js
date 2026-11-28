// The plan as a JSON file (Planner - Projects): what Export writes and what Import reads back. Pure rules with no host and no
// page (schedule.js draws the menu and does the writing; test/check-schedule-file.mjs runs these in Node). The format a person
// or an AI follows to make a file is written out in src/FORMAT.md; that file's example is run through the importer by the test.
//
//   { "format": "project-plan", "version": 1, "exportedAt": "<ISO time>", "module": "schedule", "entries": [ <entry>, ... ],
//     "boards": [ <board>, ... ] }
//
// `boards` is optional: the plan's board (id, name, field "column", columns [{ id, label, done?, color? }], rowsBy?), one at first.
// `fields` is optional: the plan's fields ([{ id, label, options: [{ id, label }] }], at most 8, 30 choices each); a work entry may carry
// `fields: { <fieldId>: <optionId> }`. A file that defines fields adds them to the plan's, by id (a field the plan has gains the
// choices it lacks).
//
// A third way to read a file is Update by id (scParseUpdate): its entries carry an `id` and only what the space owns, `fields`, `start`,
// `end`, `owners` and `rank`; each sets that on the entry of the same id in the plan, and nothing else about it.
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
    ...(o && Array.isArray(o.boards) && o.boards.length ? { boards: o.boards.map(scBoardValue) } : {}),
    ...(o && Array.isArray(o.fields) && o.fields.length ? { fields: o.fields.map(scFieldValue) } : {}),
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


// The fields a file defines, checked: { fields: [cleaned] } or { problem }.
function scParseFieldDefs(list) {
  if (list === undefined || list === null) return { fields: [] };
  if (!Array.isArray(list)) return { problem: 'The "fields" must be a list.' };
  if (list.length > SC_FIELDS_MAX) return { problem: `The file has ${list.length} fields: at most ${SC_FIELDS_MAX}.` };
  const ids = new Set();
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const f = list[i];
    const w = `Field ${i + 1}`;
    if (!f || typeof f !== 'object' || Array.isArray(f)) return { problem: `${w} must be written like { "id": "phase", "label": "Phase", "options": [ ... ] }.` };
    if (typeof f.id !== 'string' || !SC_BOARD_ID.test(f.id)) return { problem: `${w}: "id" must be lower case letters, digits and dashes.` };
    if (ids.has(f.id)) return { problem: `${w}: the id "${f.id}" is used twice.` };
    ids.add(f.id);
    if (typeof f.label !== 'string' || !scLine(f.label, 1)) return { problem: `${w}: "label" is needed.` };
    if (f.label.trim().length > SC_FIELD_LABEL_MAX) return { problem: `${w}: "label" is over ${SC_FIELD_LABEL_MAX} characters.` };
    const opts = f.options === undefined || f.options === null ? [] : f.options;
    if (!Array.isArray(opts)) return { problem: `${w}: "options" must be a list.` };
    if (opts.length > SC_FIELD_OPTIONS_MAX) return { problem: `${w}: at most ${SC_FIELD_OPTIONS_MAX} options.` };
    const oids = new Set();
    for (let j = 0; j < opts.length; j += 1) {
      const o = opts[j];
      const ow = `${w}, option ${j + 1}`;
      if (!o || typeof o !== 'object' || Array.isArray(o)) return { problem: `${ow} must be written like { "id": "first", "label": "First" }.` };
      if (typeof o.id !== 'string' || !SC_BOARD_ID.test(o.id)) return { problem: `${ow}: "id" must be lower case letters, digits and dashes.` };
      if (oids.has(o.id)) return { problem: `${ow}: the id "${o.id}" is used twice.` };
      oids.add(o.id);
      if (typeof o.label !== 'string' || !scLine(o.label, 1)) return { problem: `${ow}: "label" is needed.` };
      if (o.label.trim().length > SC_FIELD_LABEL_MAX) return { problem: `${ow}: "label" is over ${SC_FIELD_LABEL_MAX} characters.` };
      if (o.value !== undefined && !(Number.isInteger(o.value) && o.value >= 0 && o.value <= SC_SIZE_MAX)) return { problem: `${ow}: "value" must be a whole number from 0 to ${SC_SIZE_MAX}.` };
    }
    if (f.size !== undefined && typeof f.size !== 'boolean') return { problem: `${w}: "size" must be true or false.` };
    if (f.size === true && out.some((x) => x.size)) return { problem: SC_ONE_SIZE_SAY };
    out.push(scCleanField(f.id, { label: f.label, options: opts, order: i, size: f.size === true }));
  }
  return { fields: out };
}
// The file's fields joined to the plan's by id: a new field is added after the plan's; a field the plan has gains the choices it lacks
// (its words and order stay). { fields: all of them, in order } or { problem }.
function scMergeFields(existing, fromFile) {
  let all = existing.map((f) => ({ ...f, options: f.options.slice() }));
  for (const f of fromFile) {
    const at = all.findIndex((x) => x.id === f.id);
    if (at < 0) {
      if (all.length >= SC_FIELDS_MAX) return { problem: `A plan has at most ${SC_FIELDS_MAX} fields.` };
      if (f.size && all.some((x) => x.size)) return { problem: SC_ONE_SIZE_SAY };
      all.push({ ...f, order: all.length });
      continue;
    }
    if (f.size && !all[at].size) {
      if (all.some((x) => x.size)) return { problem: SC_ONE_SIZE_SAY };
      all[at].size = true;
    }
    const have = new Set(all[at].options.map((o) => o.id));
    for (const o of f.options) if (!have.has(o.id)) all[at].options.push({ ...o });
    if (all[at].options.length > SC_FIELD_OPTIONS_MAX) return { problem: `${all[at].label} would have more than ${SC_FIELD_OPTIONS_MAX} choices.` };
  }
  all = all.map((f, i) => ({ ...f, order: i }));
  return { fields: all };
}
// What is wrong with an entry's `fields` against the fields the plan will have, as one sentence, or ''.
function scFileFieldsProblem(v, defs, w) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'object' || Array.isArray(v)) return `${w}: "fields" must be written like { "phase": "first" }.`;
  const keys = Object.keys(v);
  if (keys.length > SC_FIELDS_MAX) return `${w}: "fields" has more than ${SC_FIELDS_MAX}.`;
  for (const k of keys) {
    const f = defs.find((x) => x.id === k);
    if (!f) return `${w}: "fields" names "${k}", which is not a field of the plan or the file.`;
    const val = v[k];
    if (val === '' || val === null) continue; // empty: nothing chosen
    if (typeof val !== 'string' || !f.options.some((o) => o.id === val)) return `${w}: "fields" gives ${f.label} the choice "${scLine(String(val), 40)}", which it does not have.`;
  }
  return '';
}

// What Update by id may carry on an entry: the space's own. Anything else the entry names is refused, so a file made to fill in
// fields can't change a title, a column or anything a followed service owns.
const SC_UPDATE_OWN = ['id', 'fields', 'start', 'end', 'owners', 'rank'];
const SC_UPDATE_REFUSED = ['kind', 'title', 'notes', 'column', 'done', 'ticked', 'parent', 'waitsOn', 'phase', 'tags', 'order', 'by', 'ref', 'source', 'progress'];
// Whether a file is written for Update by id: every entry has an id and neither a kind nor a title.
const scLooksUpdate = (entries) => Array.isArray(entries) && entries.length > 0 && entries.every((v) => v && typeof v === 'object' && !Array.isArray(v) && v.kind === undefined && v.title === undefined && typeof v.id === 'string');

// Reads a file for Update by id. `data` is the parsed file, `o`: { fields: the plan's fields now }. Answers { update: true, entries: [raw
// entries], fields: [the fields to store], all: [every field the plan will have] } or { problem, problems }. Nothing here writes.
function scParseUpdate(data, o) {
  const existing = o && Array.isArray(o.fields) ? o.fields : [];
  if (data.boards !== undefined && data.boards !== null) return { problem: 'Update by id does not change the board. Take "boards" out of the file.' };
  const defs = scParseFieldDefs(data.fields);
  if (defs.problem) return { problem: defs.problem };
  const merged = scMergeFields(existing, defs.fields);
  if (merged.problem) return { problem: merged.problem };
  if (data.entries.length > SC_FILE.maxEntries) return { problem: `The file has ${data.entries.length} entries: at most ${SC_FILE.maxEntries}.` };
  const list = data.entries;
  const seen = new Set();
  const problems = [];
  const MAXP = 6;
  for (let i = 0; i < list.length && problems.length < MAXP; i += 1) {
    const v = list[i];
    const w = `Entry ${i + 1}`;
    const p = (() => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return `${w} must be written like { "id": "gh-12", "fields": { "phase": "first" } }.`;
      if (typeof v.id !== 'string' || !SC_ID.test(v.id)) return `${w}: "id" is needed, the id of an entry in the plan.`;
      if (seen.has(v.id)) return `${w}: the id "${v.id}" is used twice.`;
      seen.add(v.id);
      for (const k of SC_UPDATE_REFUSED) {
        if (v[k] !== undefined) return `${w} ("${v.id}"): Update by id does not change "${k}". It sets only ${SC_UPDATE_OWN.filter((x) => x !== 'id').map((x) => `"${x}"`).join(', ').replace(/, ("rank")$/, ' and $1')}.`;
      }
      for (const f of ['start', 'end']) {
        const d = v[f];
        if (d !== undefined && d !== null && d !== '' && !scIsDay(d)) return `${w} ("${v.id}"): "${f}" must be a day like 2026-10-14, from ${SC_YEAR_MIN} to ${SC_YEAR_MAX}.`;
      }
      if (v.start && v.end && v.end < v.start) return `${w} ("${v.id}"): "end" is before "start".`;
      if (v.owners !== undefined && v.owners !== null) {
        if (!Array.isArray(v.owners) || v.owners.some((x) => typeof x !== 'string')) return `${w} ("${v.id}"): "owners" must be a list of text.`;
        if (v.owners.length > SC_LIST_MAX) return `${w} ("${v.id}"): "owners" has more than ${SC_LIST_MAX}.`;
      }
      if (v.rank !== undefined && v.rank !== null && v.rank !== '' && !(typeof v.rank === 'string' && /^[0-9A-Za-z]{1,200}$/.test(v.rank))) return `${w} ("${v.id}"): "rank" must be letters and digits.`;
      return scFileFieldsProblem(v.fields, merged.fields, `${w} ("${v.id}")`);
    })();
    if (p) problems.push(p);
  }
  if (problems.length) return { problem: problems[0], problems };
  const diff = scFieldsDiff(existing, merged.fields);
  return { update: true, entries: list, fields: diff.write, all: merged.fields };
}
// The entries Update by id writes: for each file entry whose id is in `existing` (cleaned entries), the plan's own entry with only
// what the file carries changed (`fields` choice by choice, `start`, `end`, `owners`, `rank`). Answers { entries: [the ones that change],
// missing: how many ids the plan does not have, same: how many it has that would not change }.
function scApplyUpdate(raws, existing) {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const entries = [];
  let missing = 0;
  let same = 0;
  for (const v of raws) {
    const had = byId.get(v.id);
    if (!had) { missing += 1; continue; }
    const raw = scValue(had);
    if (v.fields && typeof v.fields === 'object') {
      const merged = { ...(had.fields || {}) };
      for (const [k, val] of Object.entries(v.fields)) { if (val) merged[k] = val; else delete merged[k]; }
      if (Object.keys(merged).length) raw.fields = merged; else delete raw.fields;
    }
    if (typeof v.start === 'string' && v.start) raw.start = v.start;
    if (typeof v.end === 'string' && v.end) raw.end = v.end;
    if (Array.isArray(v.owners)) { if (v.owners.length) raw.owners = v.owners; else delete raw.owners; }
    if (typeof v.rank === 'string' && v.rank) raw.rank = v.rank;
    const next = scClean(had.id, raw);
    if (JSON.stringify(scValue(next)) === JSON.stringify(scValue(had))) same += 1; else entries.push(next);
  }
  return { entries, missing, same };
}

// Reads the text of a file. Answers { entries: [raw entries, each checked], boards, fields } or { problem: 'one plain sentence' }. Nothing here
// writes. `o`: { label(key), datesRequired, fields: the plan's fields now, mode }. With `o.mode` 'update', or 'check' for a file written
// for it (scLooksUpdate), the file is read for Update by id instead (scParseUpdate) and the answer has `update: true`.
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
  const mode = o && o.mode;
  if (mode === 'update' || (mode === 'check' && scLooksUpdate(data.entries))) return scParseUpdate(data, o);
  const defs = scParseFieldDefs(data.fields);
  if (defs.problem) return { problem: defs.problem };
  const known = scMergeFields((o && Array.isArray(o.fields)) ? o.fields : [], defs.fields);
  if (known.problem) return { problem: known.problem };
  const boards = [];
  if (data.boards !== undefined && data.boards !== null) {
    if (!Array.isArray(data.boards)) return { problem: 'The "boards" must be a list.' };
    if (data.boards.length > 1) return { problem: 'The file has more than one board: at most 1.' };
    const ids = new Set();
    for (let i = 0; i < data.boards.length; i += 1) {
      const b = data.boards[i];
      const w = `Board ${i + 1}`;
      if (!b || typeof b !== 'object' || Array.isArray(b)) return { problem: `${w} must be written like { "id": "main", "name": "Board", "columns": [ ... ] }.` };
      if (typeof b.id !== 'string' || !SC_BOARD_ID.test(b.id)) return { problem: `${w}: "id" must be lower case letters, digits and dashes.` };
      if (ids.has(b.id)) return { problem: `${w}: the id "${b.id}" is used twice.` };
      ids.add(b.id);
      if (b.field !== undefined && b.field !== 'column') return { problem: `${w}: "field" must be "column".` };
      if (b.rowsBy !== undefined && b.rowsBy !== null && !scRowsByOk(b.rowsBy)) return { problem: `${w}: "rowsBy" must be ${SC_ROWS_BY.map((x) => `"${x}"`).join(', ')} or "field:" and a field's id.` };
      if (b.name !== undefined && b.name !== null && typeof b.name !== 'string') return { problem: `${w}: "name" must be text.` };
      if (!Array.isArray(b.columns) || !b.columns.length) return { problem: `${w}: "columns" must be a list of columns.` };
      if (b.columns.length > SC_COLUMNS_MAX) return { problem: `${w}: at most ${SC_COLUMNS_MAX} columns.` };
      const colIds = new Set();
      for (let j = 0; j < b.columns.length; j += 1) {
        const c = b.columns[j];
        const cw = `${w}, column ${j + 1}`;
        if (!c || typeof c !== 'object' || Array.isArray(c)) return { problem: `${cw} must be written like { "id": "todo", "label": "To do" }.` };
        if (typeof c.id !== 'string' || !SC_BOARD_ID.test(c.id)) return { problem: `${cw}: "id" must be lower case letters, digits and dashes.` };
        if (colIds.has(c.id)) return { problem: `${cw}: the id "${c.id}" is used twice.` };
        colIds.add(c.id);
        if (typeof c.label !== 'string' || !scLine(c.label, 1)) return { problem: `${cw}: "label" is needed.` };
        if (c.label.trim().length > SC_COLUMN_LABEL_MAX) return { problem: `${cw}: "label" is over ${SC_COLUMN_LABEL_MAX} characters.` };
        if (c.done !== undefined && c.done !== null && typeof c.done !== 'boolean') return { problem: `${cw}: "done" must be true or false.` };
        if (c.color !== undefined && c.color !== null && !(typeof c.color === 'string' && /^#[0-9a-f]{6}$/.test(c.color))) return { problem: `${cw}: "color" must be a # and six lower case hex digits.` };
      }
      const clean = scCleanBoard(b.id, b);
      if (!clean) return { problem: `${w}: keep at least one column that counts as done and one that does not.` };
      boards.push(clean);
    }
  }
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
      if (v.column !== undefined && v.column !== null && v.column !== '' && !(typeof v.column === 'string' && SC_BOARD_ID.test(v.column))) return `${w}: "column" must be lower case letters, digits and dashes.`;
      for (const f of ['done', 'ticked']) if (v[f] !== undefined && v[f] !== null && typeof v[f] !== 'boolean') return `${w}: "${f}" must be true or false.`;
      if (v.phase !== undefined && v.phase !== null && v.phase !== '' && !(typeof v.phase === 'string' && /^[a-z][a-z0-9-]{0,40}$/.test(v.phase))) return `${w}: "phase" must be lower case letters, digits and dashes.`;
      if (v.order !== undefined && v.order !== null && v.order !== '' && !(typeof v.order === 'string' && /^[0-9A-Za-z]{1,200}$/.test(v.order))) return `${w}: "order" must be letters and digits.`;
      if (v.by !== undefined && v.by !== null && typeof v.by !== 'string') return `${w}: "by" must be text.`;
      if (v.ref !== undefined && v.ref !== null && !scCleanRef(v.ref)) return `${w}: "ref" must be a pointer as Export writes it.`;
      if (v.parent !== undefined && v.parent !== null && v.parent !== '' && typeof v.parent !== 'string') return `${w}: "parent" must be the id of another entry.`;
      const fieldsProblem = scFileFieldsProblem(v.fields, known.fields, w);
      if (fieldsProblem) return fieldsProblem;
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
  const diff = scFieldsDiff((o && Array.isArray(o.fields)) ? o.fields : [], known.fields);
  return { entries: list, boards, fields: diff.write, all: known.fields };
}

// The entries to write, from what scParseFile answered. `o`: { mode: 'add' | 'replace', existing: [entries now in the plan],
// newId(), orderAfter(key|null) -> the order key after it, by: the person's key }. Add gives every entry a new id and puts them
// after what is there; Replace keeps the file's ids (new ones for those with none) and its order keys when all are usable.
// `parent` and `waitsOn` follow the ids. Answers cleaned entries, ready for scValue. With `o.board` (the board the plan will have),
// work in a column that board has takes that column's flag as its `done`, so the two agree; the caller then settles the milestones.
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
  if (o && o.board) {
    for (const e of out) {
      const col = e.kind === 'work' && e.column ? o.board.columns.find((c) => c.id === e.column) : null;
      if (col) e.done = Boolean(col.done);
    }
  }
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
