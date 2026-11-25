// check-polls-create.mjs: createPoll (what an agent asks for) makes the poll the form would, and there is no way to vote.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const { pollFromRequest: make } = new Function(`${read('modules/polls/src/polls-lib.js')}\nreturn { pollFromRequest };`)();
const manifest = JSON.parse(read('modules/polls/module.json'));
let n = 0;
const test = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error('FAIL', name, '\n ', e.message); process.exitCode = 1; } };
const NOW = new Date(2026, 10, 20, 10, 0).getTime();
const p = (x) => make({ question: 'Where to eat?', options: ['Pizza', 'Sushi'], ...x }, NOW);

test('a valid poll', () => {
  const r = p({});
  assert.deepEqual(r, { question: 'Where to eat?', options: ['Pizza', 'Sushi'], multi: false, closesAt: null });
});
test('options as a comma or line separated string, trimmed', () => {
  assert.deepEqual(p({ options: ' Pizza , Sushi,, Tacos ' }).options, ['Pizza', 'Sushi', 'Tacos']);
  assert.deepEqual(p({ options: 'Pizza\nSushi\n\nTacos' }).options, ['Pizza', 'Sushi', 'Tacos']);
  assert.deepEqual(p({ options: ['  Pizza', 'Sushi  '] }).options, ['Pizza', 'Sushi']);
});
test('a question is needed, and not too long', () => {
  assert.throws(() => p({ question: '  ' }), /^Error: A poll needs a question\.$/);
  assert.throws(() => make({ options: ['a', 'b'] }, NOW), /needs a question/);
  assert.throws(() => p({ question: 'x'.repeat(201) }), /200 letters/);
});
test('fewer than two options is refused', () => {
  for (const options of [undefined, '', 'Pizza', ['Pizza'], ' , ', []]) assert.throws(() => p({ options }), /^Error: Give at least two options\.$/);
});
test('duplicates are refused, in any case', () => {
  assert.throws(() => p({ options: 'Pizza, pizza' }), /^Error: Two options are the same\.$/);
  assert.throws(() => p({ options: ['Sushi', ' SUSHI '] }), /same/);
});
test('the module maximum: 20 options, 100 letters each', () => {
  const many = (k) => Array.from({ length: k }, (_, i) => `Choice ${i + 1}`);
  assert.equal(p({ options: many(20) }).options.length, 20);
  assert.throws(() => p({ options: many(21) }), /20 options at most/);
  assert.throws(() => p({ options: ['a', 'x'.repeat(101)] }), /100 letters/);
  assert.equal(JSON.parse(read('modules/polls/module.json')).guards.keys[0].fields.options.maxLength, 20);
});
test('multiple: true, false, left out; anything else is refused', () => {
  assert.equal(p({ multiple: true }).multi, true);
  assert.equal(p({ multiple: false }).multi, false);
  assert.equal(p({ multiple: null }).multi, false);
  assert.throws(() => p({ multiple: 'yes' }), /true or false/);
});
test('closes: a day is noon, a day and time is that time, both on the person\'s clock and in the future', () => {
  assert.equal(p({ closes: '2026-11-30' }).closesAt, new Date(2026, 10, 30, 12, 0).getTime());
  assert.equal(p({ closes: '2026-11-30T18:30' }).closesAt, new Date(2026, 10, 30, 18, 30).getTime());
  assert.equal(p({ closes: '2026-11-30 18:30' }).closesAt, new Date(2026, 10, 30, 18, 30).getTime());
  assert.equal(p({ closes: '' }).closesAt, null);
  assert.throws(() => p({ closes: '2026-11-19' }), /^Error: The closing time has to be in the future\.$/);
  assert.throws(() => p({ closes: '2026-11-20T09:00' }), /future/);
  for (const bad of ['soon', '2026-02-31', '2026-11-30T25:00', '30/11/2026', 5]) assert.throws(() => p({ closes: bad }), /Closes needs a day/);
});
test('the manifest: createPoll is a write with hints, a one-sentence description and no ref', () => {
  const a = manifest.actions.provides.find((x) => x.name === 'createPoll');
  assert.ok(a && !a.local, 'not local');
  assert.equal(a.effect, 'write');
  assert.deepEqual(Object.keys(a.input), ['question', 'options', 'multiple', 'closes']);
  assert.ok(/^[^.]+\.$/.test(a.description), 'one sentence');
  for (const k of ['options', 'multiple', 'closes']) assert.ok(a.inputHints[k] && a.inputHints[k].length <= 200, `hint for ${k}`);
});
test('votes stay with people: no action votes, only the delete asks, and the screen-only ones stay local', () => {
  const names = manifest.actions.provides.map((x) => x.name);
  assert.deepEqual(names, ['draftPoll', 'createPoll', 'updatePoll', 'addPoll', 'deletePoll']);
  assert.ok(!names.some((x) => /vote|answer/i.test(x)));
  for (const x of manifest.actions.provides.filter((y) => y.name !== 'createPoll' && y.name !== 'updatePoll' && y.name !== 'deletePoll')) assert.equal(x.local, true, x.name);
  const page = read('modules/polls/src/polls.js');
  const block = page.slice(page.indexOf('host.actions.provide({'), page.indexOf('A poll with a closing time closes'));
  assert.deepEqual([...block.matchAll(/^ {6}(\w+): async/gm)].map((m) => m[1]), ['draftPoll', 'addPoll']);
  assert.match(block, /\.\.\.host\.actions\.fromLibrary\(actionHandlers\(\), \{ after: afterAction \}\)/, 'createPoll and updatePoll are the library\'s');
});
console.log(`check-polls-create: ${n} tests`);
