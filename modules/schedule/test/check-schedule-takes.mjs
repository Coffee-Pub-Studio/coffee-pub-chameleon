#!/usr/bin/env node
/*
 * check-schedule-takes.mjs -- Planner - Projects takes the objects format's milestone, work and note whole
 * (plan-object-handoff.md; scObjectInput and scFromObject in src/schedule-lib.js): the manifest's `takes`, the title, the words
 * as notes (cut at 2000), the days, `details.under` matched to a milestone by title (ignoring case, the later of two wins, its
 * own title and no match mean the top), `details.phase` matched to a phase by name, a milestone's done becoming ticked, a
 * hostile title and a day outside 1900 to 2200. No page, no host, no network.
 * Usage: node modules/schedule/test/check-schedule-takes.mjs. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const code = fs.readFileSync(path.join(dir, 'src', 'schedule-lib.js'), 'utf8');
const fileCode = fs.readFileSync(path.join(dir, 'src', 'schedule-lib-file.js'), 'utf8');
const L = new Function(`${code}\n${fileCode}\nreturn { scClean, scValue, scActionProblem, scObjectInput, scFromObject, scParentFor, scPhaseFor, scExportFile, scParseFile };`)();
const schema = JSON.parse(fs.readFileSync(path.join(dir, 'src', 'project-plan.schema.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'module.json'), 'utf8'));

let passed = 0;
const fails = [];
function test(name, fn) { try { fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }

const phases = [{ id: 'plan', label: 'Plan' }, { id: 'build', label: 'Build it' }];
const have = [
  { id: 'm1', kind: 'milestone', title: 'Beta ready', parent: null },
  { id: 'w1', kind: 'work', title: 'Write docs', parent: null },
  { id: 'm2', kind: 'milestone', title: 'beta READY', parent: null },
];
const take = (kind, object, input, entries = have) => {
  const flat = L.scObjectInput(kind, input || { title: object.title }, object);
  const problem = L.scActionProblem(kind, flat, { datesRequired: true });
  if (problem) return { problem };
  return { problem: '', e: L.scFromObject(kind, input || { title: object.title }, object, { entries, phases, by: 'u1' }).entry };
};

test('the manifest takes the plan kinds', () => {
  const { cleanManifest } = require(path.join(dir, '..', '..', 'server', 'modules.js'));
  const files = new Set(['module.json', 'page.html', 'canvas.html']);
  const m = cleanManifest(JSON.parse(JSON.stringify(manifest)), files);
  const by = Object.fromEntries(m.actions.provides.map((a) => [a.name, a]));
  assert.deepEqual(by.addMilestone.takes.map((t) => [t.kinds, t.as]), [[['milestone'], 'a milestone']]);
  assert.deepEqual(by.addWork.takes.map((t) => [t.kinds, t.as]), [[['work'], 'a piece of work']]);
  assert.deepEqual(by.addNote.takes.map((t) => [t.kinds, t.as]), [[['note'], 'a note']]);
  for (const a of Object.values(by)) assert.equal(a.input.object, 'object?');
});

test('a milestone: day, notes, phase by name, done becomes ticked', () => {
  const r = take('milestone', { title: 'Launch', kind: 'milestone', content: 'All hands', details: { start: '2026-12-01', phase: 'BUILD IT', done: true } });
  assert.equal(r.problem, '');
  assert.equal(r.e.kind, 'milestone');
  assert.equal(r.e.start, '2026-12-01');
  assert.equal(r.e.ticked, true);
  assert.equal(r.e.done, true);
  assert.equal(r.e.phase, 'build');
  assert.equal(r.e.notes, 'All hands');
  assert.equal(r.e.by, 'u1');
});

test('work: start and end, under a milestone, the later of two same-titled milestones wins', () => {
  const r = take('work', { title: 'Fix login', kind: 'work', details: { start: '2026-11-20', end: '2026-11-28', under: 'Beta Ready ', phase: 'plan' } });
  assert.equal(r.e.parent, 'm2');
  assert.equal(r.e.start, '2026-11-20');
  assert.equal(r.e.end, '2026-11-28');
  assert.equal(r.e.phase, 'plan');
});

test('work: one day given is a one-day span; the day chosen in Chat (object.date) is the start', () => {
  const a = take('work', { title: 'A', details: { end: '2026-11-22' } });
  assert.deepEqual([a.e.start, a.e.end], ['2026-11-22', '2026-11-22']);
  const b = take('work', { title: 'B', date: '2026-11-23', details: {} });
  assert.deepEqual([b.e.start, b.e.end], ['2026-11-23', '2026-11-23']);
});

test('work is not put under work, and a title that matches nothing is at the top', () => {
  assert.equal(take('work', { title: 'X', details: { start: '2026-11-20', under: 'Write docs' } }).e.parent, null);
  assert.equal(take('work', { title: 'X', details: { start: '2026-11-20', under: 'No such thing' } }).e.parent, null);
  assert.equal(take('work', { title: 'X', details: { start: '2026-11-20' } }).e.parent, null);
});

test('under equal to its own title is the top (never itself)', () => {
  assert.equal(take('milestone', { title: 'Beta ready', details: { start: '2026-11-20', under: 'beta ready' } }).e.parent, null);
  assert.equal(L.scParentFor(have, 'Beta ready', 'Beta ready'), null);
});

test('a phase that matches nothing is left empty; an id matches too', () => {
  assert.equal(take('milestone', { title: 'M', details: { start: '2026-11-20', phase: 'Nope' } }).e.phase, '');
  assert.equal(L.scPhaseFor(phases, 'PLAN'), 'plan');
  assert.equal(L.scPhaseFor(phases, ''), '');
  assert.equal(L.scPhaseFor([], 'plan'), '');
});

test('notes are cut at 2000; a note has no day or parent', () => {
  const r = take('work', { title: 'Long', content: 'x'.repeat(5000), details: { start: '2026-11-20' } });
  assert.equal(r.e.notes.length, 2000);
  const n = L.scFromObject('note', { title: 'N' }, { title: 'N', content: 'words', details: { under: 'Beta ready' } }, { entries: have, phases, by: 'u1' }).entry;
  assert.deepEqual([n.kind, n.notes, n.parent, n.start], ['note', 'words', null, '']);
});

test('days outside 1900 to 2200 are refused, with the plan needing dates', () => {
  assert.match(take('milestone', { title: 'Old', details: { start: '1850-01-01' } }).problem, /1900 to 2200/);
  assert.match(take('work', { title: 'Far', details: { start: '2026-01-01', end: '2500-01-01' } }).problem, /1900 to 2200/);
  assert.match(take('milestone', { title: 'None', details: {} }).problem, /needs a day/);
});

test('a hostile title stays text and is cut; control characters go; a loop cannot be made', () => {
  const t = '<img src=x onerror=alert(1)>\u0000\u0007 ' + 'y'.repeat(300);
  const r = take('milestone', { title: t, details: { start: '2026-11-20', under: '__proto__' } });
  assert.ok(r.e.title.startsWith('<img src=x onerror=alert(1)>'));
  assert.ok(r.e.title.length <= 120 && !/[\u0000-\u001f]/.test(r.e.title));
  assert.equal(r.e.parent, null);
  assert.equal(take('work', { title: 'Z', details: { start: '2026-11-20', under: '__proto__' } }).e.parent, null);
  const v = L.scValue(r.e);
  assert.equal(v.parent, undefined);
  // its own id is fresh: a parent can never be itself
  assert.notEqual(r.e.parent, r.e.id);
});

test('an input with no object keeps the older rules', () => {
  const e = L.scFromObject('work', { title: 'Flat', start: '2026-11-20' }, {}, { entries: have, phases, by: 'u1' });
  assert.equal(e.entry.title, 'Flat');
  assert.equal(e.entry.start, '2026-11-20');
});

// The schema's own keywords, checked as check-schedule-schema.mjs does (no dependency).
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
function valid(v, s, root = s) {
  if (s.$ref) { const t = s.$ref.replace('#/', '').split('/').reduce((o, k) => o[k], root); if (!valid(v, t, root)) return false; }
  if (s.type && ![].concat(s.type).some((t) => typeOf(v) === t || (t === 'number' && typeof v === 'number'))) return false;
  if ('const' in s && v !== s.const) return false;
  if (s.enum && !s.enum.includes(v)) return false;
  if (typeof v === 'string') {
    if (s.pattern && !new RegExp(s.pattern).test(v)) return false;
    if (s.maxLength !== undefined && [...v].length > s.maxLength) return false;
    if (s.minLength !== undefined && [...v].length < s.minLength) return false;
  }
  if (typeof v === 'number' && ((s.minimum !== undefined && v < s.minimum) || (s.maximum !== undefined && v > s.maximum))) return false;
  if (Array.isArray(v)) {
    if ((s.minItems !== undefined && v.length < s.minItems) || (s.maxItems !== undefined && v.length > s.maxItems)) return false;
    if (s.items && !v.every((x) => valid(x, s.items, root))) return false;
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const k of s.required || []) if (!(k in v)) return false;
    for (const [k, sub] of Object.entries(s.properties || {})) if (k in v && !valid(v[k], sub, root)) return false;
  }
  for (const sub of s.allOf || []) if (!valid(v, sub, root)) return false;
  if (s.if && valid(v, s.if, root) && s.then && !valid(v, s.then, root)) return false;
  return true;
}

test('what a taken object writes is valid under the file schema and the importer takes it', () => {
  const entries = [];
  const add = (kind, object) => {
    const e = L.scFromObject(kind, { title: object.title }, object, { entries, phases, by: 'u1' }).entry;
    const made = L.scClean(`n${entries.length + 1}`, { ...e, order: 'V' + 'W'.repeat(entries.length) });
    entries.push(made);
  };
  add('milestone', { title: 'Beta ready', content: 'Blockers closed', details: { start: '2026-11-28', phase: 'Build it', done: true } });
  add('work', { title: 'Fix login', details: { start: '2026-11-20', end: '2026-11-26', under: 'beta ready', phase: 'plan' } });
  add('work', { title: 'Write docs', details: { start: '2026-11-22' } });
  add('note', { title: 'A note', content: 'words' });
  assert.equal(entries[1].parent, entries[0].id);
  const file = JSON.parse(JSON.stringify(L.scExportFile(entries, { module: 'schedule' })));
  assert.equal(valid(file, schema), true);
  const read = L.scParseFile(JSON.stringify(file), { label: (k) => k, datesRequired: true });
  assert.ok(!read.problem, read.problem);
});

if (fails.length) {
  for (const f of fails) console.error(`check-schedule-takes: FAIL ${f}`);
  console.error(`check-schedule-takes: ${passed} passed, ${fails.length} failed`);
  process.exit(1);
}
console.log(`check-schedule-takes: ${passed} passed`);
