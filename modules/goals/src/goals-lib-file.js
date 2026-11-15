// The plan as a JSON file (Planner - Goals): what Export writes and what Import reads back. Pure rules with no host and no page
// (goals.js draws the menu and does the writing; test/check-goals-file.mjs runs these in Node). The format a person or an AI
// follows to make a file is written out in src/FORMAT.md; that file's example is run through the importer by the test.
//
//   { "format": "goal-plan", "version": 1, "exportedAt": "<ISO time>", "module": "goals", "entries": [ <entry>, ... ] }
//
// An entry has the fields GoalsLib.valueOf stores, plus an optional `id` that the `parent` of other entries of the same file
// names. The file is read whole and checked before anything is written; the first thing wrong is one sentence.
const GoalsFile = (() => {
  'use strict';
  const L = GoalsLib;
  const LIMITS = Object.freeze({
    format: 'goal-plan',
    version: 1,
    maxBytes: 1024 * 1024, // one file
    maxEntries: 500, // in one file
    maxPlan: 1000, // in the plan once the file is added
    yearMin: 1900,
    yearMax: 2200,
  });
  const ID = /^[A-Za-z0-9_-]{1,64}$/;
  const KINDS = L.KINDS;
  const isDay = (s) => {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    if (y < LIMITS.yearMin || y > LIMITS.yearMax) return false;
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  };
  const clean = (s) => (typeof s === 'string' ? s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim() : '');

  // What goes in the file: the goals in the outline's order, each followed by its steps and notes, then what sits under no goal.
  function exportFile(entries, o) {
    const tree = L.treeOf(entries);
    const ordered = [];
    for (const g of tree.goals) ordered.push(g.goal, ...g.children);
    ordered.push(...tree.loose);
    return {
      format: LIMITS.format,
      version: LIMITS.version,
      exportedAt: (o && o.now) || new Date().toISOString(),
      module: (o && o.module) || 'goals',
      entries: ordered.map((e) => ({ id: e.id, ...L.stored(e) })),
    };
  }
  const exportName = (day) => `goal-plan-${typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : 'file'}.json`;

  function syntax(text, err) {
    const msg = String((err && err.message) || '');
    const m = /position (\d+)/.exec(msg);
    const line = m ? text.slice(0, Number(m[1])).split('\n').length : (/line (\d+)/.exec(msg) || [])[1];
    return line ? `The file is not valid JSON (near line ${line}).` : 'The file is not valid JSON.';
  }

  // Reads the text of a file. Answers { entries: [raw entries, each checked] } or { problem: 'one plain sentence' }. Nothing here
  // writes. `o`: { label(key) gives the plan's word for goal, step and note }.
  function parseFile(text, o) {
    const label = (o && o.label) || ((k, a) => (a && a.a ? `a ${k}` : k));
    if (typeof text !== 'string' || !text.trim()) return { problem: 'The file is empty.' };
    if (text.length > LIMITS.maxBytes) return { problem: `The file is too big: at most ${LIMITS.maxBytes / 1024 / 1024} MB.` };
    let data;
    try { data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); } catch (err) { return { problem: syntax(text, err) }; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { problem: `The file must be written like { "format": "${LIMITS.format}", "version": 1, "entries": [ ... ] }.` };
    if (data.format !== LIMITS.format) return { problem: `This is not a goal plan file: its "format" must be "${LIMITS.format}".` };
    if (data.version !== LIMITS.version) return { problem: `The file's "version" must be ${LIMITS.version}.` };
    if (!Array.isArray(data.entries)) return { problem: 'The file needs an "entries" list.' };
    if (!data.entries.length) return { problem: 'The file has no entries.' };
    if (data.entries.length > LIMITS.maxEntries) return { problem: `The file has ${data.entries.length} entries: at most ${LIMITS.maxEntries}.` };

    const list = data.entries;
  const problems = [];
  const MAXP = 6; // the first and up to five more, one for each entry
    const seen = new Map();
    const who = (i, v) => {
      const t = v && typeof v === 'object' && typeof v.title === 'string' ? clean(v.title).replace(/\s+/g, ' ').slice(0, 40) : '';
      return t ? `Entry ${i + 1} ("${t}")` : `Entry ${i + 1}`;
    };
    const text1 = (v, f, max) => {
      if (v[f] === undefined || v[f] === null) return '';
      if (typeof v[f] !== 'string') return `"${f}" must be text.`;
      if (v[f].trim().length > max) return `"${f}" is over ${max} characters.`;
      return '';
    };
    for (let i = 0; i < list.length && problems.length < MAXP; i += 1) {
      const p = (() => {
        const v = list[i];
        const w = who(i, v);
        if (!v || typeof v !== 'object' || Array.isArray(v)) return `${w} must be written like { "kind": "note", "title": "..." }.`;
        if (v.id !== undefined && v.id !== null && v.id !== '') {
          if (typeof v.id !== 'string' || !ID.test(v.id)) return `${w}: "id" must be 1 to 64 letters, digits, dashes or underscores.`;
          if (seen.has(v.id)) return `${w}: the id "${v.id}" is used twice.`;
          seen.set(v.id, v);
        }
        if (!KINDS.includes(v.kind)) return `${w}: "kind" must be "goal", "step" or "note".`;
        if (typeof v.title !== 'string' || !clean(v.title)) return `${w}: "title" is needed.`;
        if (clean(v.title).length > 200) return `${w}: "title" is over 200 characters.`;
        const limits = [['why', 2000], ['text', 8000]];
        for (const [f, max] of limits) { const q = text1(v, f, max); if (q) return `${w}: ${q}`; }
        if (v.date !== undefined && v.date !== null && v.date !== '' && !isDay(v.date)) return `${w}: "date" must be a day like 2026-10-14, from ${LIMITS.yearMin} to ${LIMITS.yearMax}.`;
        for (const f of ['owners']) {
          if (v[f] === undefined || v[f] === null) continue;
          if (!Array.isArray(v[f]) || v[f].some((x) => typeof x !== 'string')) return `${w}: "${f}" must be a list of text.`;
          if (v[f].length > 50) return `${w}: "${f}" has more than 50.`;
        }
        if (v.done !== undefined && v.done !== null && typeof v.done !== 'boolean') return `${w}: "done" must be true or false.`;
        if (v.progress !== undefined && v.progress !== null && !(Number.isFinite(v.progress) && v.progress >= 0 && v.progress <= 100)) return `${w}: "progress" must be a number from 0 to 100.`;
        if (v.phase !== undefined && v.phase !== null && v.phase !== '' && !(typeof v.phase === 'string' && v.phase.length <= 40 && /^[a-z][a-z0-9-]*$/.test(v.phase))) return `${w}: "phase" must be lower case letters, digits and dashes.`;
        if (v.order !== undefined && v.order !== null && v.order !== '' && !(typeof v.order === 'string' && /^[0-9A-Za-z]{1,200}$/.test(v.order))) return `${w}: "order" must be letters and digits.`;
        if (v.by !== undefined && v.by !== null && (typeof v.by !== 'string' || v.by.length > 200)) return `${w}: "by" must be text.`;
        if (v.parent !== undefined && v.parent !== null && v.parent !== '' && typeof v.parent !== 'string') return `${w}: "parent" must be the id of ${label('goal', { a: true })} in the file.`;
        if (v.links !== undefined && v.links !== null) {
          if (!Array.isArray(v.links) || v.links.length > 20) return `${w}: "links" must be a list of at most 20.`;
          if (L.cleanLinks(v.links).length !== v.links.length) return `${w}: each of "links" must be a pointer as Export writes it, and none twice.`;
        }
      return '';
      })();
      if (p) problems.push(p);
    }
    if (problems.length) return { problem: problems[0], problems };
    for (let i = 0; i < list.length && problems.length < MAXP; i += 1) {
      const p = (() => {
        const v = list[i];
        const w = who(i, v);
        if (v.kind === 'goal' && v.parent) return `${w}: ${label('goal', { a: true })} stays at the top, so it has no "parent".`;
        if (v.kind === 'step' && !v.parent) return `${w}: ${label('step', { a: true })} needs a "parent": the id of ${label('goal', { a: true })} in the file.`;
        if (!v.parent) return '';
        if (!seen.has(v.parent)) return `${w}: "parent" names "${v.parent}", which is not an id in the file.`;
        if (seen.get(v.parent).kind !== 'goal') return `${w}: "parent" must be ${label('goal', { a: true })}.`;
      return '';
      })();
      if (p) problems.push(p);
    }
    if (problems.length) return { problem: problems[0], problems };
  return { entries: list };
  }

  // The entries to write, from what parseFile answered, as { id, value } (value: what is stored). `o`: { mode: 'add' | 'replace',
  // existing: [entries now in the plan], newId(), orderAfter(key|null), by, now, dates: whether the plan shows dates }.
  // Add gives every entry a new id and puts the entries after what is there; Replace keeps the file's ids (new ones for those with
  // none) and its order keys when all are usable. `parent` follows the ids.
  function importEntries(raws, o) {
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
    const next = (prev) => { try { return o.orderAfter(prev) || ''; } catch (err) { return ''; } };
    const orders = new Array(raws.length).fill('');
    const groups = new Map();
    raws.forEach((v, i) => { const k = v.kind !== 'goal' && v.parent ? map.get(v.parent) : ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
    for (const [parent, at] of groups) {
      const given = at.map((i) => (typeof raws[i].order === 'string' ? raws[i].order : ''));
      if (replace && given.every((x) => /^[0-9A-Za-z]{1,200}$/.test(x)) && new Set(given).size === given.length) { at.forEach((i, n) => { orders[i] = given[n]; }); continue; }
      let prev = null;
      if (!replace) {
        const sibs = existing.filter((e) => (e.parent || '') === parent && (parent || e.kind !== 'step') && typeof e.order === 'string').sort(L.compare);
        const last = [...sibs].reverse().find((e) => !e.order.endsWith('0'));
        prev = last ? last.order : null;
      }
      for (const i of at) { orders[i] = next(prev); prev = orders[i] || prev; }
    }
    return raws.map((v, i) => {
      const value = L.valueOf(v.kind, { ...v, parent: v.kind !== 'goal' && v.parent ? map.get(v.parent) : null, order: orders[i] }, { dates: !o || o.dates !== false });
      value.createdAt = Number.isFinite(v.createdAt) ? v.createdAt : (o && o.now) || Date.now();
      const by = typeof v.by === 'string' && v.by && v.by.length <= 200 ? v.by : (o && o.by) || '';
      if (by) value.by = by;
      return { id: ids[i], value };
    });
  }

  return { LIMITS, exportFile, exportName, parseFile, importEntries };
})();
