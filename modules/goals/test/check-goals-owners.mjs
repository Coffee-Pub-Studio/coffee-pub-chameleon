#!/usr/bin/env node
/*
 * check-goals-owners.mjs -- owners on Planner - Goals' addGoal: ownersFor in src/goals-lib.js (a key or a display name, any case,
 * a comma-separated text or an array, each person once, the two refusal sentences), that the owners land in the stored goal
 * as the form's own list of keys, the wiring in src/goals.js and the manifest's inputs and inputHints. No page, no host, no network.
 * Usage: node modules/goals/test/check-goals-owners.mjs. Exits 1 on any failure.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const MOD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const L = vm.runInNewContext(`${fs.readFileSync(path.join(MOD, 'src', 'goals-lib.js'), 'utf8')}\nGoalsLib`, {});
const page = fs.readFileSync(path.join(MOD, 'src', 'goals.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(MOD, 'module.json'), 'utf8'));
const plain = (x) => JSON.parse(JSON.stringify(x));

let n = 0;
let failed = 0;
const test = (name, fn) => { try { fn(); n += 1; } catch (err) { failed += 1; console.error(`check-goals-owners: ${name}: ${err.stack || err.message}`); } };

const people = [
  { key: 'u-ana', name: 'Ana Reyes' },
  { key: 'u-bo', name: 'Bo Chen' },
  { key: 'u-sam1', name: 'Sam' },
  { key: 'u-sam2', name: 'sam' },
];
const own = (v) => plain(L.ownersFor(v, people, 'campaign'));

test('by key', () => assert.deepEqual(own('u-ana'), { owners: ['u-ana'], problem: '' }));
test('by name', () => assert.deepEqual(own('Ana Reyes').owners, ['u-ana']));
test('by name in another case, with spaces', () => assert.deepEqual(own('  ana REYES ').owners, ['u-ana']));
test('by key in another case', () => assert.deepEqual(own('U-BO').owners, ['u-bo']));
test('a comma-separated text, keys and names mixed', () => assert.deepEqual(own('u-ana, bo chen').owners, ['u-ana', 'u-bo']));
test('a real array is accepted', () => assert.deepEqual(own(['Bo Chen', 'u-ana']).owners, ['u-bo', 'u-ana']));
test('each person once', () => assert.deepEqual(own('u-ana, Ana Reyes, ANA reyes').owners, ['u-ana']));
test('empty gives no owners', () => { assert.deepEqual(own('').owners, []); assert.deepEqual(own([]).owners, []); });
test('an unknown person is refused', () => assert.equal(own('u-ana, Zed').problem, 'That person is not in this campaign. Use list_members to see who is.'));
test('an ambiguous name is refused, the key works', () => {
  assert.equal(own('Sam').problem, 'Two people are called Sam; use the key.');
  assert.deepEqual(own('u-sam1').owners, ['u-sam1']);
});
test('not text or a list is refused', () => { assert.ok(own(5).problem); assert.ok(own([1]).problem); });
test('the space word defaults', () => assert.match(L.ownersFor('x', [], undefined).problem, /not in this space\./));

test('the owners are stored as the form stores them', () => {
  const v = L.valueOf('goal', { title: 'Ship', owners: own('Ana Reyes, bo chen').owners, parent: null }, { dates: true });
  assert.deepEqual(plain(v.owners), ['u-ana', 'u-bo']);
  assert.equal(L.valueOf('goal', { title: 'Ship', parent: null }, { dates: true }).owners, undefined);
});

test('the actions library checks owners before it adds or changes a goal', () => {
  const lib = fs.readFileSync(path.join(MOD, 'src', 'goals-lib-actions.js'), 'utf8');
  assert.equal((lib.match(/G\.ownersFor\(input\.owners, ctx\.people, ctx\.util\.word\('space'\)\)/g) || []).length, 2, 'addGoal and updateGoal');
  assert.match(page, /host\.actions\.fromLibrary\(/);
});

const acts = Object.fromEntries(manifest.actions.provides.map((a) => [a.name, a]));
test('manifest: owners is an optional text on addGoal only (a step has no owners in the form)', () => {
  assert.equal(acts.addGoal.input.owners, 'text?');
  assert.equal(acts.addStep.input.owners, undefined);
  assert.equal(acts.addNote.input.owners, undefined);
});
test('manifest: hints name real inputs, at most 200 characters; descriptions are one sentence', () => {
  for (const a of manifest.actions.provides) {
    for (const [k, v] of Object.entries(a.inputHints || {})) {
      assert.ok(k in a.input, `${a.name}.${k} is not an input`);
      assert.ok(typeof v === 'string' && v.length > 0 && v.length <= 200, `${a.name}.${k} length`);
    }
    assert.match(a.description, /^[^.]*\.$/, `${a.name} description`);
  }
  for (const [a, k] of [['addGoal', 'owners'], ['addGoal', 'date'], ['addStep', 'goal'], ['addStep', 'date'], ['addNote', 'goal']]) assert.ok(acts[a].inputHints[k], `${a}.${k}`);
});

if (failed) process.exit(1);
console.log(`check-goals-owners: ${n} passed`);
