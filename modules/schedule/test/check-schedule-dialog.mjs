#!/usr/bin/env node
/*
 * check-schedule-dialog.mjs -- Planner - Projects' "Change this piece of work" window (#1252), read as source:
 *   - the order: Title, Notes, Done, Tags, Phase and the fields first; Owners, Part of, the days and Waits on after;
 *   - Waits on is a short control: a list of the work already chosen, a search that lists at most 8 matches, tick to add and untick to
 *     remove, and the stored `waitsOn` is still the ticked boxes;
 *   - a pulled issue's own view: "Issue #n", an Open on GitHub link, the description (`description`, plan-github-full-sync.md step 1) as plain text (textContent, never markup) above where
 *     Notes were, Kind, the days, Owners, Part of, Waits on, Phase and Notes not shown, and no sentence that says "the rest comes from"
 *     GitHub (GitHub has no days, owners or waits on);
 *   - the same markup and code give own work the full window.
 *   - the one day a pulled issue has: a **Target date** in its view (not Starts and Ends), stored as the work's `end` with `start` left as
 *     the day it was opened, empty or the opened day meaning none, a date before the opened day refused, enabled for someone who may only
 *     set the plan's own fields, never sent to GitHub;
 * No page is run here: the live part is tools/check-schedule-fields.mjs, which opens this window on own work and on a pulled issue.
 * Usage: node modules/schedule/test/check-schedule-dialog.mjs. Exits 1 on failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(dir, ...p), 'utf8');
const html = read('src', 'schedule.html');
const page = read('src', 'schedule.js');
const css = read('src', 'schedule.css');
const form = html.slice(html.indexOf('<form id="form"'), html.indexOf('</form>', html.indexOf('<form id="form"')));

let n = 0;
const test = async (name, fn) => { try { await fn(); n += 1; } catch (e) { process.exitCode = 1; console.error(`FAIL ${name}\n${e.stack || e}`); } };
const at = (id) => { const i = form.indexOf(`id="${id}"`); assert.ok(i >= 0, `${id} is in the form`); return i; };

await test('the window\'s order: what a person reads and changes first, the days and Waits on after', () => {
  const order = ['f-title', 'f-desc-field', 'f-notes-field', 'f-done-field', 'f-tags-field', 'f-phase-field', 'f-fields', 'f-owners-field', 'f-parent-field', 'f-dates', 'f-waits-field'];
  const spots = order.map(at);
  assert.deepEqual([...spots].sort((a, b) => a - b), spots, order.join(' < '));
  assert.ok(at('f-kind') < at('f-title'), 'Kind (own work only) stays first');
  assert.ok(at('f-source') < at('f-title'), 'the issue link sits above the title');
});
await test('Waits on: the chosen work, a search, and at most 8 matches listed', () => {
  assert.match(form, /id="f-waits-chosen"/);
  assert.match(form, /id="f-waits-search" type="search"/);
  assert.match(form, /id="f-waits-found"/);
  assert.match(page, /const WAITS_FOUND_MAX = 8;/);
  assert.match(page, /hits\.slice\(0, WAITS_FOUND_MAX\)/);
  assert.match(page, /\$\{hits\.length\} matches: type more to narrow them\./);
  assert.match(page, /'Nothing matches\.'/);
  assert.match(page, /box\.replaceChildren\(\.\.\.others\.filter\(\(x\) => chosenIds\.has\(x\.id\)\)\.map\(\(x\) => row\(x, true\)\)\)/, 'only the chosen work is listed at the start, not every piece of work');
  assert.match(page, /if \(ev\.target\.checked\) box\.append\(el\); else if \(box\.contains\(el\)\) el\.remove\(\);/, 'tick adds, untick removes');
  assert.match(page, /waitsOn: checked\(\$\('f-waits'\)\),/, 'the stored waitsOn is still the ticked boxes');
  assert.match(page, /checked\(\$\('f-waits'\)\), \$\('f-phase'\)\.value/, 'and the unsaved-changes check still sees them');
  assert.match(page, /!Number\(\$\('f-waits'\)\.dataset\.count\)/, 'Waits on is hidden when there is nothing to wait on');
});
await test('a pulled issue has its own view, not a greyed form', () => {
  assert.match(page, /const issueView = pulled\(shown\) && isIssue\(shown\);/);
  assert.match(page, /\$\('editor-title'\)\.textContent = issueView \? `Issue \$\{sourceNumber\(shown\)\}`/);
  const view = page.match(/function showIssueView\(shown, on\) \{[\s\S]*?\n  \}\n/)[0];
  assert.match(view, /\[\$\('f-kind'\)\.closest\('label'\), \$\('f-notes-field'\)\]/, 'Kind and Notes');
  for (const id of ['f-dates', 'f-owners-field', 'f-parent-field', 'f-waits-field', 'f-phase-field']) assert.ok(view.includes(`'${id}'`), `${id} is not shown for an issue`);
  assert.match(view, /link\.classList\.add\('src-open'\)/);
  assert.match(view, /Open on \$\{shown\.source\.from === 'github' \? 'GitHub' : state\.pull\.name\}/);
  assert.match(view, /\$\('f-desc'\)\.textContent = on \? shown\.description : '';/, 'the description (its own field, never the notes) is text, never markup');
  assert.match(view, /hide\(\$\('f-desc-field'\), !on \|\| !shown\.description\);/);
  assert.doesNotMatch(view, /shown\.notes/, 'a pulled issue\'s notes are never drawn: it has none');
  assert.doesNotMatch(view, /innerHTML|insertAdjacentHTML/);
  assert.match(page, /fitKind\(\);\n\s*showIssueView\(shown, issueView\);/, 'applied after the window\'s own hiding');
  assert.match(css, /\.desc \{[^}]*white-space: pre-wrap;[^}]*overflow-wrap: anywhere;[^}]*max-height:/, 'a long description wraps and scrolls');
  assert.doesNotMatch(css.match(/\.desc \{[^}]*\}/)[0], /#[0-9a-f]{3,6}\b|rgb\(/i, 'no colour of its own');
});
await test('what the window says about a pulled issue is true: the days, owners and waits on are not GitHub\'s', () => {
  assert.doesNotMatch(page, /The rest comes from/);
  assert.match(page, /Only the fields change here\. The title, \$\{label\('tag', \{ many: true \}\)\} and Done come from \$\{state\.pull\.name\}\./);
  assert.match(page, /change on \$\{state\.pull\.name\}\.\$\{state\.fields\.length \? ' The fields stay here\.' : ''\}`/);
});
await test('what is saved for a pulled issue and for own work is unchanged', () => {
  assert.match(page, /if \(ed\.partly\) \{ await savePulled\(ed\); return; \}/);
  assert.match(page, /async function savePulled\(ed\)/);
  assert.match(page, /\$\('f-notes'\)\.value,\n\s*parent,/, 'own work still saves its notes');
  assert.match(html, /<textarea id="f-notes" name="notes" rows="3" maxlength="2000">/);
});

await test('a pulled issue shows one Target date, which is the work\'s end', () => {
  assert.ok(at('f-fields') < at('f-target-field') && at('f-target-field') < at('f-owners-field'), 'after the fields, before the days of own work');
  assert.match(form, /id="f-target-field"[^>]* hidden>/, 'hidden unless it is an issue');
  assert.match(form, /<span class="sdk-label" id="f-target-label">Target date<\/span>/);
  assert.match(page, /const targetOf = \(e\) => \(e\.end && e\.start && e\.end > e\.start \? e\.end : ''\);/, 'empty when end is the day it was opened');
  assert.match(page, /\$\('f-target'\)\.value = on && targetOf\(shown\);/);
  assert.match(page, /hide\(\$\('f-target-field'\), !on\);/);
  assert.match(page, /\$\('f-target-field'\)\.contains\(el\)/, 'enabled with the plan\'s own fields, even where Title, Done and tags are not');
  assert.match(page, /const endOf = \(e\) => \(target \? target : e\.start \|\| e\.end\);/, 'empty goes back to the day it was opened');
  assert.match(page, /return \{ \.\.\.e, fields: fieldsFromForm\(e\.fields\), end: endOf\(e\), \.\.\.owned \};/);
  assert.match(page, /fields: fieldsFromForm\(e\.fields\), end: endOf\(e\), \.\.\.owned, \.\.\.placed \}; \/\/ a tag the plan no longer lists/);
  assert.match(page, /target < was\.start\) \{ editorError\(`The target date is before the day it was opened/, 'a date before it was opened is refused');
  assert.match(page, /dates\.target = host\.ui\.datePicker\(\$\('f-target'\), \{ clearable: true \}\);/);
  assert.match(page, /\[\x27start\x27, \x27end\x27, \x27target\x27\]\) if \(dates\[k\]\)/, 'its picker is destroyed with the others');
  assert.match(page, /\$\('f-end'\)\.value, \$\('f-target'\)\.value, ownersPick/, 'and counts in the unsaved-changes check');
  assert.doesNotMatch(page, /host\.issues\.[a-z]+\([^)]*(target|end)/, 'nothing about a day goes to the issue service');
});

console.log(`check-schedule-dialog: ${n} tests pass`);
