#!/usr/bin/env node
/*
 * check-schedule-owners.mjs -- owners on Planner - Projects' actions (addWork, updateEntry): scOwnersFor in src/schedule-lib.js
 * (a key or a display name, any case, a comma-separated text or an array, each person once, the two refusal sentences), how
 * updateEntry replaces them, the wiring in src/schedule.js and the manifest's inputs and inputHints. No page, no host, no network.
 * Usage: node modules/schedule/test/check-schedule-owners.mjs. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const code = fs.readFileSync(path.join(dir, 'src', 'schedule-lib.js'), 'utf8');
const page = fs.readFileSync(path.join(dir, 'src', 'schedule.js'), 'utf8');
const L = new Function(`${code}\nreturn { scClean, scValue, scUpdate, scOwnersFor };`)();
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'module.json'), 'utf8'));

let passed = 0;
const fails = [];
function test(name, fn) { try { fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }

const people = [
  { key: 'u-ana', name: 'Ana Reyes' },
  { key: 'u-bo', name: 'Bo Chen' },
  { key: 'u-sam1', name: 'Sam' },
  { key: 'u-sam2', name: 'sam' },
];
const own = (v) => L.scOwnersFor(v, people, { space: 'trip' });
const wk = () => L.scClean('w1', { kind: 'work', title: 'Write docs', start: '2026-11-01', end: '2026-11-10', owners: ['u-bo'] });
const ms = () => L.scClean('m1', { kind: 'milestone', title: 'Launch', start: '2026-12-01' });
const upd = (e, input) => L.scUpdate(e, input, { datesRequired: true, people, space: 'trip' });

test('by key', () => assert.deepEqual(own('u-ana'), { owners: ['u-ana'], problem: '' }));
test('by name', () => assert.deepEqual(own('Ana Reyes').owners, ['u-ana']));
test('by name in another case, with spaces', () => assert.deepEqual(own('  ana REYES ').owners, ['u-ana']));
test('by key in another case', () => assert.deepEqual(own('U-BO').owners, ['u-bo']));
test('a comma-separated text, keys and names mixed', () => assert.deepEqual(own('u-ana, bo chen').owners, ['u-ana', 'u-bo']));
test('a real array is accepted', () => assert.deepEqual(own(['Bo Chen', 'u-ana']).owners, ['u-bo', 'u-ana']));
test('each person once', () => assert.deepEqual(own('u-ana, Ana Reyes, ANA reyes').owners, ['u-ana']));
test('empty gives no owners', () => { assert.deepEqual(own('').owners, []); assert.deepEqual(own([]).owners, []); assert.deepEqual(own(' , ').owners, []); });
test('an unknown person is refused', () => assert.equal(own('u-ana, Zed').problem, 'That person is not in this trip. Use list_members to see who is.'));
test('an ambiguous name is refused, the key works', () => {
  assert.equal(own('Sam').problem, 'Two people are called Sam; use the key.');
  assert.deepEqual(own('u-sam1').owners, ['u-sam1']);
});
test('not text or a list is refused', () => { assert.ok(own(5).problem); assert.ok(own([1]).problem); assert.ok(own({}).problem); });
test('the space word defaults', () => assert.match(L.scOwnersFor('x', [], {}).problem, /not in this space\./));

test('updateEntry replaces the owners', () => {
  const r = upd(wk(), { owners: 'Ana Reyes' });
  assert.equal(r.problem, '');
  assert.deepEqual(r.entry.owners, ['u-ana']);
  assert.equal(r.entry.title, 'Write docs');
});
test('updateEntry with empty owners clears them', () => {
  const r = upd(wk(), { owners: '' });
  assert.equal(r.problem, '');
  assert.deepEqual(r.entry.owners, []);
  assert.equal(L.scValue(r.entry).owners, undefined);
});
test('updateEntry without owners leaves them', () => {
  const r = upd(wk(), { title: 'New title' });
  assert.deepEqual(r.entry.owners, ['u-bo']);
});
test('updateEntry with only owners is a change', () => assert.equal(upd(wk(), { owners: 'u-ana' }).entry.kind, 'work'));
test('updateEntry refuses an unknown or ambiguous person and changes nothing', () => {
  assert.equal(upd(wk(), { owners: 'Zed' }).entry, null);
  assert.equal(upd(wk(), { owners: 'sam' }).problem, 'Two people are called sam; use the key.');
});
test('updateEntry refuses owners on a milestone', () => assert.equal(upd(ms(), { owners: 'u-ana' }).problem, 'Only work says who is doing it.'));
test('updateEntry with nothing at all still says what to change', () => assert.match(upd(wk(), {}).problem, /Say what to change/));

test('the page checks owners before it adds, and passes people to updateEntry', () => {
  assert.match(page, /scOwnersFor\(input\.owners, state\.people/);
  assert.match(page, /people: state\.people/);
});

const acts = Object.fromEntries(manifest.actions.provides.map((a) => [a.name, a]));
test('manifest: owners is an optional text on addWork and updateEntry', () => {
  assert.equal(acts.addWork.input.owners, 'text?');
  assert.equal(acts.updateEntry.input.owners, 'text?');
  assert.equal(acts.addMilestone.input.owners, undefined);
});
test('manifest: hints name real inputs, at most 200 characters; descriptions are one sentence', () => {
  for (const a of manifest.actions.provides) {
    for (const [k, v] of Object.entries(a.inputHints || {})) {
      assert.ok(k in a.input, `${a.name}.${k} is not an input`);
      assert.ok(typeof v === 'string' && v.length > 0 && v.length <= 200, `${a.name}.${k} length`);
    }
    assert.match(a.description, /^[^.]*\.$/, `${a.name} description`);
  }
  for (const [n, k] of [['addWork', 'owners'], ['addWork', 'start'], ['addWork', 'end'], ['addMilestone', 'date'], ['updateEntry', 'owners'], ['updateEntry', 'date']]) assert.ok(acts[n].inputHints[k], `${n}.${k}`);
});

if (fails.length) { for (const f of fails) console.error(`check-schedule-owners: ${f}`); process.exit(1); }
console.log(`check-schedule-owners: ${passed} passed`);
