#!/usr/bin/env node
/*
 * check-schedule-late.mjs -- when Planner - Projects marks work "Late" (#1209): the page's pageLate (src/schedule.js) with scLate
 * (src/schedule-lib.js), run as written. Own work is late once its end day is past and it is not done. Pulled work is never late
 * while the space only follows the service; where changes go back, it is late only when its end is after its start (a target someone
 * set), never for the one day the pull gives an issue (start and end the day it was opened). No page, no host, no network.
 * Usage: node modules/schedule/test/check-schedule-late.mjs. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lib = fs.readFileSync(path.join(dir, 'src', 'schedule-lib.js'), 'utf8');
const page = fs.readFileSync(path.join(dir, 'src', 'schedule.js'), 'utf8');
const line = page.match(/const pageLate = [^\n]*\n/);
assert.ok(line, 'pageLate is in the page');
const make = (writing) => new Function('writeOn', 'today', `${lib}\n${line[0]}\nreturn pageLate;`)(() => writing, () => '2026-11-28');

let passed = 0;
const fails = [];
function test(name, fn) { try { fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }

const work = (o) => ({ kind: 'work', done: false, start: '2026-01-05', end: '2026-01-05', ...o });
const src = { number: 7 };

test('own work is late when its end is past and it is not done', () => {
  const late = make(false);
  assert.equal(late(work({ end: '2026-11-01' })), true);
  assert.equal(late(work({ end: '2026-11-01', done: true })), false);
  assert.equal(late(work({ end: '2026-12-01' })), false);
});
test('pulled work in a space that only follows is never late', () => {
  assert.equal(make(false)(work({ source: src, end: '2026-11-01' })), false);
});
test('pulled work that writes back: the day it was opened is not late', () => {
  assert.equal(make(true)(work({ source: src, start: '2026-01-05', end: '2026-01-05' })), false);
});
test('pulled work that writes back: a target after the start is late once past, not before, not when done', () => {
  const late = make(true);
  assert.equal(late(work({ source: src, start: '2026-01-05', end: '2026-11-01' })), true);
  assert.equal(late(work({ source: src, start: '2026-01-05', end: '2026-12-01' })), false);
  assert.equal(late(work({ source: src, start: '2026-01-05', end: '2026-11-01', done: true })), false);
});
test('pulled work with no start and an end is a target', () => {
  assert.equal(make(true)(work({ source: src, start: '', end: '2026-11-01' })), true);
});
test('own work is unaffected by writing back, even for one day', () => {
  assert.equal(make(true)(work({ start: '2026-01-05', end: '2026-01-05' })), true);
});

if (fails.length) { console.error(`check-schedule-late: ${fails.length} failed\n  ${fails.join('\n  ')}`); process.exit(1); }
console.log(`check-schedule-late: ${passed} tests pass`);
