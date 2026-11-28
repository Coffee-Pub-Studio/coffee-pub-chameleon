#!/usr/bin/env node
/*
 * check-schedule-donewindow.mjs -- the done window in Planner - Projects (plan-done-window.md, step 4): while a plan follows GitHub, the
 * status line says "Issues closed before 29 October are on GitHub." and the Done column's menu has "Closed issues on GitHub", a link to
 * the service's own list, both read from the pull view's `keep: { days, from, url }`.
 *   - the pieces run as written: keepOf (what is kept of `keep`: a day and a web address, else nothing), keepDay (the day as a plain
 *     readable day, the year only when it is not this one), keepStatus (the sentence), keepItem (the menu item, on a done column only);
 *   - the wiring, read as source: the sentence is a status item next to the pull's line, the item is in the Done column's menu for
 *     someone who may not change the columns too, a change of `keep` redraws, and nothing is drawn as markup.
 * No page is run: the live part is a run of tools/check-schedule-fields.mjs's followed space (see the pull request).
 * Usage: node modules/schedule/test/check-schedule-donewindow.mjs. Exits 1 on failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(path.join(dir, 'src', 'schedule.js'), 'utf8');

let n = 0;
const test = async (name, fn) => { try { await fn(); n += 1; } catch (e) { process.exitCode = 1; console.error(`FAIL ${name}\n${e.stack || e}`); } };

const grab = (re) => { const m = page.match(re); assert.ok(m, `found ${re}`); return m[0]; };
const pieces = [
  grab(/const keepOf = [^\n]*\n/),
  grab(/const keepDay = [^\n]*\n/),
  grab(/function keepStatus\(\) \{[\s\S]*?\n  \}\n/),
  grab(/const keepItem = [^\n]*\n/),
].join('\n');
const build = (pull, year = 2026) => new Function('state', 'dayDate', 'thisYear', `${pieces}\nreturn { keepOf, keepDay, keepStatus, keepItem };`)({ pull }, (d) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd); }, year);

await test('keepOf keeps a day and a web address, and nothing else', () => {
  const { keepOf } = build({});
  assert.deepEqual(keepOf({ days: 30, from: '2026-10-29', url: 'https://github.com/o/r/issues?q=x' }), { days: 30, from: '2026-10-29', url: 'https://github.com/o/r/issues?q=x' });
  assert.equal(keepOf(null), null);
  assert.equal(keepOf(undefined), null);
  assert.equal(keepOf({ days: 30, from: '2026-10-29', url: '' }), null, 'no address, nothing drawn');
  assert.equal(keepOf({ days: 30, from: '', url: 'https://github.com/o/r' }), null, 'no day, nothing drawn');
  assert.equal(keepOf({ days: 30, from: 'soon', url: 'https://github.com/o/r' }), null);
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', '//evil.example/x', 'github.com/o/r', ' https://github.com/x']) assert.equal(keepOf({ days: 30, from: '2026-10-29', url: bad }), null, bad);
  assert.equal(keepOf({ from: '2026-10-29', url: 'https://github.com/o/r' }).days, 0, 'days that are not a number are 0');
});
await test('keepDay is a plain readable day, with the year only when it is not this one', () => {
  const { keepDay } = build({});
  const same = keepDay('2026-10-29');
  assert.match(same, /29/);
  assert.match(same, /October|Oct/);
  assert.doesNotMatch(same, /2026/, 'this year: no year');
  assert.match(build({}, 2027).keepDay('2026-10-29'), /2026/, 'another year: the year');
});
await test('the sentence, and nothing without `keep`', () => {
  const k = { days: 30, from: '2026-10-29', url: 'https://github.com/o/r/issues?q=x' };
  const s = build({ keep: k, name: 'GitHub' }).keepStatus();
  assert.match(s.text, /^Issues closed before .*29.* are on GitHub\.$/);
  assert.ok(s.text.length <= 60, `a status item holds 60 characters (${s.text.length})`);
  assert.equal(s.icon, 'box-archive');
  assert.match(s.title, /Done column's menu/);
  assert.equal(build({ keep: null, name: 'GitHub' }).keepStatus(), null);
  assert.match(build({ keep: k, name: '' }).keepStatus().text, /on GitHub\.$/, 'no name: GitHub');
});
await test('the menu item is on a done column only, and is a link', () => {
  const k = { days: 30, from: '2026-10-29', url: 'https://github.com/o/r/issues?q=x' };
  const { keepItem } = build({ keep: k, name: 'GitHub' });
  assert.deepEqual(keepItem({ id: 'done', done: true }), [{ id: 'closed', label: 'Closed issues on GitHub', icon: 'arrow-up-right-from-square', href: k.url }]);
  assert.deepEqual(keepItem({ id: 'now', done: false }), [], 'not on a column that is not done');
  assert.deepEqual(build({ keep: null, name: 'GitHub' }).keepItem({ id: 'done', done: true }), [], 'not without `keep`');
});
await test('the wiring: next to the pull\'s line, in the menu for anyone, redrawn when `keep` changes, never markup', () => {
  assert.match(page, /if \(pullOn\(\)\) status\.unshift\(\.\.\.\[pullStatus\(\), keepStatus\(\)\]\.filter\(Boolean\)\);/);
  assert.match(page, /if \(!canColumns\(\)\) return keepItem\(c\);/, 'someone who may not change the columns still gets the link');
  assert.match(page, /keep: v\.on \? keepOf\(v\.keep\) : null \}/, 'the pull view\'s keep is read');
  assert.match(page, /hadKeep !== JSON\.stringify\(state\.pull\.keep\)/, 'a change of keep redraws');
  const mine = grab(/const keepOf = [^\n]*\n/) + grab(/function keepStatus\(\) \{[\s\S]*?\n  \}\n/) + grab(/const keepItem = [^\n]*\n/);
  assert.doesNotMatch(mine, /innerHTML|insertAdjacentHTML/);
  assert.match(grab(/const keepItem = [^\n]*\n/), /href: state\.pull\.keep\.url/);
});

console.log(`check-schedule-donewindow: ${n} tests pass`);
