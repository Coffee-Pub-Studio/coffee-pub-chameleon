#!/usr/bin/env node
/*
 * check-schedule-pulled.mjs -- what Planner - Projects keeps of work pulled from GitHub (documentation/plans/plan-github-full-sync.md,
 * step 1), run in Node:
 *   - scClean and scValue keep `description` (the issue's text, at most 2000 characters counted as characters, never inside a surrogate
 *     pair), `assignees` (at most 10 GitHub logins, each once, anything that is not a login dropped), `source.cut` (only `true`) and
 *     `source.labels` (at most 30 names of 1 to 50 characters, each once); work only, nothing empty stored;
 *   - a value the pull wrote comes back from scClean and scValue exactly as it was, so a save from the page (the own fields) changes
 *     nothing GitHub owns;
 *   - the plan file: Export writes them, Import takes them and refuses a description over 2000 characters and more than 10 assignees,
 *     Update by id refuses both (they are GitHub's), and the schema says the same;
 *   - the issue view draws `description`, never the notes.
 * No page, no host, no network. Usage: node modules/schedule/test/check-schedule-pulled.mjs. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => fs.readFileSync(path.join(dir, 'src', f), 'utf8');
const L = new Function(`${src('schedule-lib.js')}\n${src('schedule-lib-file.js')}\nreturn { scClean, scValue, scParseFile, scExportFile, SC_DESCRIPTION_MAX, SC_ASSIGNEES_MAX };`)();
const schema = JSON.parse(src('project-plan.schema.json'));
const plain = (x) => JSON.parse(JSON.stringify(x));

let passed = 0;
const fails = [];
function test(name, fn) { try { fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }

// A piece of work as the pull writes it (server/issues.js, workOf).
const pulled = {
  kind: 'work', title: 'Server: a thing', start: '2026-10-01', end: '2026-10-01', done: false, tags: ['bug'],
  assignees: ['octo-cat', 'Copilot', 'dependabot[bot]'], description: `First line\n\n\tSecond ${'é'.repeat(10)} line`, parent: 'ghm-2',
  by: 'system:issues', column: 'now',
  source: { from: 'github', repo: 'o/r', number: 7, url: 'https://github.com/o/r/issues/7', updated: '2026-10-01T10:00:00.000Z', cut: true, labels: ['wontfix', 'needs: a look'] },
};

test('a pulled value comes back exactly as the pull wrote it', () => {
  assert.deepEqual(L.scValue(L.scClean('gh-7', pulled)), pulled);
  const astral = { ...pulled, description: `${'y'.repeat(1998)}\u{1F600}…` }; // 2000 characters, 2001 code units: as the server cuts it
  assert.equal(Array.from(astral.description).length, 2000);
  assert.deepEqual(L.scValue(L.scClean('gh-7', astral)), astral, 'counted in characters, as the server counts them');
});

test('description: text, at most 2000 characters, never inside a pair, work only', () => {
  assert.equal(L.SC_DESCRIPTION_MAX, 2000);
  const long = L.scClean('a', { kind: 'work', title: 't', description: `${'x'.repeat(1999)}\u{1F600}\u{1F600}` }).description;
  assert.deepEqual([Array.from(long).length, /[\ud800-\udbff]$/.test(long)], [2000, false]);
  assert.equal(L.scClean('a', { kind: 'work', title: 't', description: '  a\u0007b  ' }).description, 'a b', 'as notes are cleaned');
  assert.equal(L.scClean('a', { kind: 'work', title: 't', description: 5 }).description, '');
  for (const kind of ['milestone', 'note']) assert.equal('description' in L.scValue(L.scClean('a', { kind, title: 't', description: 'x' })), false, kind);
  assert.equal('description' in L.scValue(L.scClean('a', { kind: 'work', title: 't' })), false, 'nothing empty stored');
});

test('assignees: GitHub logins, each once, at most 10, work only', () => {
  assert.equal(L.SC_ASSIGNEES_MAX, 10);
  const many = Array.from({ length: 12 }, (_, i) => `user${i}`);
  assert.deepEqual(L.scClean('a', { kind: 'work', title: 't', assignees: many }).assignees, many.slice(0, 10));
  assert.deepEqual(L.scClean('a', { kind: 'work', title: 't', assignees: ['ok', 'ok', '-bad', 'has space', 'a'.repeat(40), 7, 'x[bot]', '<b>'] }).assignees, ['ok', 'x[bot]']);
  assert.equal('assignees' in L.scValue(L.scClean('a', { kind: 'milestone', title: 't', assignees: ['ok'] })), false);
  assert.equal('assignees' in L.scValue(L.scClean('a', { kind: 'work', title: 't', assignees: [] })), false, 'nothing empty stored');
});

test('source.cut and source.labels', () => {
  const s = (source) => L.scClean('a', { kind: 'work', title: 't', source: { from: 'github', repo: 'o/r', number: 1, ...source } }).source;
  assert.equal(s({ cut: true }).cut, true);
  for (const v of [false, 'true', 1]) assert.equal('cut' in s({ cut: v }), false, String(v));
  const names = Array.from({ length: 32 }, (_, i) => `label ${i}`);
  assert.deepEqual(s({ labels: names }).labels, names.slice(0, 30));
  assert.deepEqual(s({ labels: ['a', 'a', '', 'b'.repeat(51), 3, 'c'] }).labels, ['a', 'c']);
  assert.equal('labels' in s({ labels: [] }), false);
});

test('the plan file: Export writes them, Import takes and checks them, Update by id refuses them', () => {
  const file = L.scExportFile([L.scClean('gh-7', { ...pulled, parent: null })], { now: '2026-10-02T00:00:00.000Z' });
  const text = typeof file === 'string' ? file : JSON.stringify(file);
  const data = JSON.parse(text);
  const out = data.entries[0];
  assert.deepEqual([out.description, out.assignees, out.source.cut, out.source.labels], [pulled.description, pulled.assignees, true, pulled.source.labels]);
  const read = L.scParseFile(text, { label: (k) => k });
  assert.ok(!read.problem, read.problem);
  const one = (entry, mode) => L.scParseFile(JSON.stringify({ format: 'project-plan', version: 1, entries: [entry] }), { label: (k) => k, ...(mode ? { mode } : {}) });
  const base = { kind: 'work', title: 'A', start: '2026-10-01', end: '2026-10-01' };
  assert.equal(one({ ...base, description: 'x'.repeat(2001) }).problem, 'Entry 1 ("A"): "description" is over 2000 characters.');
  assert.ok(!one({ ...base, description: '\u{1F600}'.repeat(2000) }).problem, '2000 characters, counted as characters');
  assert.equal(one({ ...base, description: 5 }).problem, 'Entry 1 ("A"): "description" must be text.');
  assert.equal(one({ ...base, assignees: Array.from({ length: 11 }, (_, i) => `u${i}`) }).problem, 'Entry 1 ("A"): "assignees" has more than 10.');
  assert.equal(one({ ...base, assignees: 'octo' }).problem, 'Entry 1 ("A"): "assignees" must be a list of text.');
  assert.match(one({ id: 'gh-7', description: 'mine' }, 'update').problem, /^Entry 1 \("gh-7"\): Update by id does not change "description"\./);
  assert.match(one({ id: 'gh-7', assignees: ['x'] }, 'update').problem, /^Entry 1 \("gh-7"\): Update by id does not change "assignees"\./);
});

test('the schema and FORMAT.md say so', () => {
  const e = schema.$defs.entry.properties;
  assert.deepEqual([e.description.type, e.description.maxLength], [['string', 'null'], 2000]);
  assert.deepEqual([e.assignees.maxItems, e.assignees.items.type], [10, 'string']);
  assert.deepEqual([e.source.properties.cut.type, e.source.properties.labels.maxItems], [['boolean', 'null'], 30]);
  assert.equal(schema.properties.version.const, 1, 'the format stays version 1');
  const doc = src('FORMAT.md');
  assert.match(doc, /\| `description` \| no \| work pulled from GitHub only/);
  assert.match(doc, /\| `assignees` \| no \| work pulled from GitHub only: a list \(up to 10\)/);
  assert.match(doc, /`source` may also carry `cut`/);
});

test('the issue view draws the description, never the notes', () => {
  const page = src('schedule.js');
  const view = page.match(/function showIssueView\(shown, on\) \{[\s\S]*?\n  \}\n/)[0];
  assert.match(view, /\$\('f-desc'\)\.textContent = on \? shown\.description : '';/);
  assert.doesNotMatch(view, /shown\.notes|innerHTML/);
  assert.equal(plain(L.scClean('gh-7', pulled)).notes, '', 'pulled work has no notes');
});

if (fails.length) { for (const f of fails) console.error(`FAIL ${f}`); process.exit(1); }
console.log(`check-schedule-pulled: ${passed} tests pass`);
