// check-budget-agent-payer.mjs: addCost names people by key or by name, and has `sharedBy`; the manifest carries hints.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const { costFromRequest: make } = new Function('word', `${read('modules/budget/src/budget-lib.js')}\nreturn { costFromRequest };`)((k) => k);
const people = [{ key: 'u1', name: 'Michelle' }, { key: 'u2', name: 'Thomas' }, { key: 'u3', name: 'Sam' }, { key: 'u4', name: 'sam' }];
let n = 0;
const test = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error('FAIL', name, '\n ', e.message); process.exitCode = 1; } };
const t = (x) => make({ title: 'Taxi', amount: 5, ...x }, 'u9', people);

test('payer by key', () => assert.equal(t({ payer: 'u2' }).paidBy, 'u2'));
test('payer by name, and by name in another case', () => {
  assert.equal(t({ payer: 'Thomas' }).paidBy, 'u2');
  assert.equal(t({ payer: ' tHOMAS ' }).paidBy, 'u2');
  assert.equal(t({ payer: 'Thomas' }).actual, 5);
});
test('an unknown person is refused in plain words', () => {
  assert.throws(() => t({ payer: 'Nobody' }), /^Error: That person is not in this space\. Use list_members to see who is\.$/);
  assert.throws(() => t({ sharedBy: 'u1, Nobody' }), /not in this space/);
});
test('an ambiguous name is refused, its key still works', () => {
  assert.throws(() => t({ payer: 'Sam' }), /Two people are called Sam; use the key\./);
  assert.equal(t({ payer: 'u4' }).paidBy, 'u4');
});
test('sharedBy by keys and names, comma separated or a list', () => {
  assert.deepEqual(t({ sharedBy: 'u1,Thomas' }).sharedBy, ['u1', 'u2']);
  assert.deepEqual(t({ sharedBy: ['michelle', 'u3'] }).sharedBy, ['u1', 'u3']);
});
test('each person is counted once; the payer may or may not be among them', () => {
  assert.deepEqual(t({ sharedBy: 'u1, Michelle, u1' }).sharedBy, ['u1']);
  assert.deepEqual(t({ payer: 'u1', sharedBy: 'u2' }).sharedBy, ['u2']);
  assert.deepEqual(t({ payer: 'u1', sharedBy: 'u1,u2' }).sharedBy, ['u1', 'u2']);
});
test('nothing given is as before', () => {
  assert.deepEqual(t({}).sharedBy, []);
  assert.equal(t({}).paidBy, '');
  assert.deepEqual(t({ sharedBy: ' , ' }).sharedBy, []);
  assert.equal(make({ title: 'x', payer: 'u1', amount: 3 }, 'u9', ['u1', 'u2']).paidBy, 'u1', 'plain keys still work');
});
test('the manifest has sharedBy and a short hint for each input', () => {
  const a = JSON.parse(read('modules/budget/module.json')).actions.provides.find((x) => x.name === 'addCost');
  assert.equal(a.input.sharedBy, 'string?');
  assert.ok(/^[^.]+\.$/.test(a.description), 'one sentence');
  for (const k of ['payer', 'sharedBy', 'planned', 'actual', 'amount', 'category', 'date']) {
    assert.ok(a.inputHints[k] && a.inputHints[k].length <= 200 && a.input[k], `hint for ${k}`);
  }
  assert.match(a.inputHints.amount, /currency/);
});
console.log(`check-budget-agent-payer: ${n} tests`);
