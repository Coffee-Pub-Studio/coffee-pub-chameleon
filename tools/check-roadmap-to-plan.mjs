#!/usr/bin/env node
/*
 * check-roadmap-to-plan.mjs -- tools/roadmap-to-plan.mjs against a small fixture roadmap (tools/fixtures/roadmap-to-plan), no network.
 *   - the file it writes is read by Planner - Projects' own Update by id parser (scParseUpdate, through scParseFile) with no refusal,
 *     in the happy case (every row matches) and with unmatched rows (one not in the space's work, one for another repository);
 *   - the three fields (Area, Release status, "Roadmap phase" with its own id), their options, and the phase numbers' order;
 *   - each entry: id gh-<Issue>, fields by choice id, start and end from Start date and Target date, an empty date writes nothing,
 *     and nothing else (no title, column or note);
 *   - a row that matches no work is reported and left out, never invented; a row of another repository too;
 *   - the real .github/roadmap-board.csv writes a file the parser accepts.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { buildFile, knownFrom, choiceId } from './roadmap-to-plan.mjs';
import { readRows } from './roadmap-board-sync.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => fs.readFileSync(path.join(ROOT, 'modules/schedule/src', f), 'utf8');
const L = new Function(`${src('schedule-lib.js')}\n${src('schedule-lib-file.js')}\nreturn { scParseFile };`)();
const fx = (f) => fs.readFileSync(path.join(ROOT, 'tools/fixtures/roadmap-to-plan', f), 'utf8');
// As Update by id reads it: against a plan with no fields yet (the file defines them), mode 'update'.
const parse = (file) => L.scParseFile(JSON.stringify(file), { label: (k) => k, datesRequired: true, mode: 'update', fields: [] });

let passed = 0;
const fails = [];
async function test(name, fn) { try { await fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }

const rows = readRows(fx('roadmap.csv'));
const everyone = buildFile(rows, { repo: 'Drowbe/coffee-pub-chameleon' });
const known = buildFile(rows, { repo: 'Drowbe/coffee-pub-chameleon', known: knownFrom(fx('plan.json')) });
const by = (b) => Object.fromEntries(b.file.entries.map((e) => [e.id, e]));

await test('the happy case: every row of the repository, read by scParseUpdate with no refusal', () => {
  const r = parse(everyone.file);
  assert.equal(r.problem, undefined, r.problem);
  assert.equal(r.update, true);
  assert.equal(r.entries.length, 5);
  assert.deepEqual(r.fields.map((f) => f.id), ['area', 'release', 'roadmap-phase']);
  assert.equal(everyone.counts.otherRepo, 1);
});
await test('rows that match no work are reported and left out, and the file is still read', () => {
  const r = parse(known.file);
  assert.equal(r.problem, undefined, r.problem);
  assert.deepEqual(known.file.entries.map((e) => e.id), ['gh-2', 'gh-27', 'gh-29', 'gh-31']);
  assert.deepEqual([known.counts.unmatched, known.counts.otherRepo], [1, 1]);
  assert.ok(known.notes.some((n) => /^#40 .* is not in the space's work/.test(n)), 'the unmatched row is named');
  assert.ok(known.notes.some((n) => /^#41 is in Drowbe\/other-repo/.test(n)), 'the other repository is named');
  assert.ok(!by(known)['gh-40'] && !by(known)['gh-41'], 'nothing is invented for them');
});
await test('the three fields and their options', () => {
  const [area, release, phase] = known.file.fields;
  assert.deepEqual([area.label, release.label, phase.label], ['Area', 'Release status', 'Roadmap phase']);
  assert.deepEqual(area.options.map((o) => o.label), ['Home', 'Server', 'Verify']);
  assert.deepEqual(release.options.map((o) => o.label), ['Not gating (proposed)', 'Gating (proposed, high confidence)']);
  assert.deepEqual(phase.options.map((o) => o.label), ['1 Before the freeze', '4 Real-call tests', '5 Later / ideas'], 'by the phase number');
  for (const f of known.file.fields) for (const o of f.options) { assert.match(o.id, /^[a-z][a-z0-9-]{0,40}$/); assert.ok(o.label.length <= 40); }
  assert.equal(choiceId('5 Later / ideas', 'roadmap-phase'), 'roadmap-phase-5-later-ideas');
});
await test('each entry carries only fields, start and end', () => {
  const e = by(known);
  assert.deepEqual(e['gh-27'], { id: 'gh-27', fields: { area: 'server', release: 'gating-proposed-high-confidence', 'roadmap-phase': 'roadmap-phase-1-before-the-freeze' }, start: '2026-11-16', end: '2026-12-18' });
  assert.deepEqual(Object.keys(e['gh-29']).sort(), ['fields', 'id', 'start'], 'an empty Target date writes no end');
  assert.deepEqual(Object.keys(e['gh-31']).sort(), ['fields', 'id'], 'empty dates write nothing');
  for (const x of known.file.entries) assert.deepEqual(Object.keys(x).filter((k) => !['id', 'fields', 'start', 'end'].includes(k)), [], 'nothing else');
});
await test('the real roadmap writes a file the parser accepts', () => {
  const real = readRows(fs.readFileSync(path.join(ROOT, '.github/roadmap-board.csv'), 'utf8'));
  const out = buildFile(real);
  const r = parse(out.file);
  assert.equal(r.problem, undefined, r.problem);
  assert.equal(r.entries.length, real.length);
});
await test('a file that names a title is refused by the parser (the check reads what it should)', () => {
  const bad = { ...known.file, entries: [{ ...known.file.entries[0], title: 'x' }] };
  assert.ok(parse(bad).problem);
});

if (fails.length) {
  console.error(`check-roadmap-to-plan: ${fails.length} failed`);
  for (const f of fails) console.error(`    - ${f}`);
  process.exit(1);
}
console.log(`check-roadmap-to-plan: OK (${passed} groups)`);
