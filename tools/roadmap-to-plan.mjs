#!/usr/bin/env node
/*
 * roadmap-to-plan.mjs -- the ONE-TIME import of the GitHub roadmap board's own fields into a followed space's plan
 * (step 7 of documentation/plans/plan-github-two-way.md). Deleted with .github/roadmap-board.csv in the removal step.
 *
 *   node tools/roadmap-to-plan.mjs [--csv file] [--plan file] [--repo owner/name] [--out file] [--dry-run]
 *
 *   --csv      the roadmap (default .github/roadmap-board.csv)
 *   --plan     a project-plan file whose entries are the work the space has (the file tools/issues-to-plan.mjs writes, or a plan's
 *              Export). A row whose gh-<number> is not in it is reported and left out. Without it every row is written and
 *              Update by id skips, and counts, the ids the plan does not have.
 *   --repo     the repository the space follows (default Drowbe/coffee-pub-chameleon); a row for another repository is reported
 *   --out      the file to write (default project-plan-roadmap.json); nothing is written with --dry-run
 *
 * It writes a project-plan file for Planner - Projects' Update by id (modules/schedule/src/FORMAT.md): three fields, Area (id
 * area), Release status (id release) and "Roadmap phase" (id roadmap-phase; named so it does not meet the template's own Phase
 * select), each with the options the CSV holds, and one entry per row: id gh-<Issue>, `fields` by option id, `start` (Start date)
 * and `end` (Target date); an empty date writes nothing. Nothing else is carried: never a title, column or note. A row that
 * matches no work is reported on the error output, never invented. In Planner - Projects: Export and import, Import, choose the
 * file, Check file, then Update by id.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readRows } from './roadmap-board-sync.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_REPO = 'Drowbe/coffee-pub-chameleon';
const LABEL_MAX = 40; // the format's limits (project-plan.schema.json)
const OPTIONS_MAX = 30;
const FIELDS = [
  { id: 'area', label: 'Area', of: (r) => r.area, order: 'seen' },
  { id: 'release', label: 'Release status', of: (r) => r.release, order: 'seen' },
  { id: 'roadmap-phase', label: 'Roadmap phase', of: (r) => r.phase, order: 'number' },
];

// The id of a choice: lower case words joined by dashes, starting with a letter and at most 40 characters.
export function choiceId(label, field) {
  let id = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!/^[a-z]/.test(id)) id = `${field}-${id}`.replace(/-+$/g, '');
  return id.slice(0, 40).replace(/-+$/g, '') || field;
}

// Builds the file. `rows` are readRows' rows; `known` (a Set of numbers, or null) the work the space has. Answers { file, notes,
// counts: { rows, written, unmatched, otherRepo } }.
export function buildFile(rows, { repo = DEFAULT_REPO, known = null } = {}) {
  const notes = [];
  const mine = [];
  let otherRepo = 0;
  let unmatched = 0;
  for (const r of rows) {
    if (r.repo.toLowerCase() !== repo.toLowerCase()) { otherRepo += 1; notes.push(`#${r.issue} is in ${r.repo}, not ${repo}: left out.`); continue; }
    if (known && !known.has(r.issue)) { unmatched += 1; notes.push(`#${r.issue} (${r.title}) is not in the space's work: left out.`); continue; }
    mine.push(r);
  }
  const fields = FIELDS.map((f) => {
    const labels = [...new Set(mine.map(f.of))];
    if (f.order === 'number') labels.sort((a, b) => (parseInt(a, 10) || 1e9) - (parseInt(b, 10) || 1e9) || a.localeCompare(b));
    if (labels.length > OPTIONS_MAX) throw new Error(`${f.label} has ${labels.length} values: a field holds at most ${OPTIONS_MAX}.`);
    const used = new Set();
    const ids = new Map();
    const options = labels.map((text) => {
      let id = choiceId(text, f.id);
      for (let n = 2; used.has(id); n += 1) id = `${choiceId(text, f.id).slice(0, 36)}-${n}`;
      used.add(id);
      ids.set(text, id);
      let label = text;
      if (label.length > LABEL_MAX) { label = `${label.slice(0, LABEL_MAX - 1).trimEnd()}…`; notes.push(`${f.label} "${text}" is cut to ${LABEL_MAX} characters.`); }
      return { id, label };
    });
    return { def: { id: f.id, label: f.label, options }, ids, f };
  });
  const entries = mine.map((r) => {
    const e = { id: `gh-${r.issue}`, fields: Object.fromEntries(fields.map((x) => [x.f.id, x.ids.get(x.f.of(r))])) };
    if (r.start) e.start = r.start;
    if (r.target) e.end = r.target;
    return e;
  });
  return { file: { format: 'project-plan', version: 1, fields: fields.map((x) => x.def), entries }, notes, counts: { rows: rows.length, written: entries.length, unmatched, otherRepo } };
}

// The issue numbers a project-plan file holds as work (ids gh-<number>).
export function knownFrom(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data && data.entries) ? data.entries : [];
  return new Set(list.map((e) => /^gh-([0-9]{1,9})$/.exec(e && e.id)).filter(Boolean).map((m) => Number(m[1])));
}

function parseArgs(argv) {
  const a = { csv: path.join(ROOT, '.github', 'roadmap-board.csv'), plan: '', repo: DEFAULT_REPO, out: 'project-plan-roadmap.json', dry: false };
  const use = 'Use: node tools/roadmap-to-plan.mjs [--csv file] [--plan file] [--repo owner/name] [--out file] [--dry-run]';
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dry-run') a.dry = true;
    else if (['--csv', '--plan', '--repo', '--out'].includes(argv[i]) && argv[i + 1]) a[argv[i].slice(2)] = argv[++i];
    else throw new Error(use);
  }
  return a;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const rows = readRows(fs.readFileSync(a.csv, 'utf8'), a.repo);
  const known = a.plan ? knownFrom(fs.readFileSync(a.plan, 'utf8')) : null;
  const out = buildFile(rows, { repo: a.repo, known });
  console.error('Roadmap import for Planner - Projects, Update by id. Fields: Area (area), Release status (release) and Roadmap phase (roadmap-phase).');
  console.error('The phase field is named "Roadmap phase" so it does not meet the template\'s own Phase select.');
  if (!known) console.error('No --plan given: every row is written, and Update by id skips the ids the plan does not have.');
  for (const n of out.notes) console.error(n);
  const c = out.counts;
  console.log(`${c.rows} rows: ${c.written} written, ${c.unmatched} not in the space's work, ${c.otherRepo} for another repository.`);
  if (a.dry) return;
  if (!out.file.entries.length) throw new Error('No row matches any work, so there is nothing to write.');
  fs.writeFileSync(a.out, `${JSON.stringify(out.file, null, 2)}\n`);
  console.log(`Wrote ${a.out}. In Planner - Projects, open Export and import, Import, choose it, Check file, then Update by id.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (err) { console.error(err.message); process.exit(1); }
}
