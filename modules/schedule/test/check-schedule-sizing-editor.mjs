#!/usr/bin/env node
/*
 * check-schedule-sizing-editor.mjs -- Edit fields can make a field the size and say what its choices are worth (plan-projects-sizing-burndown.md,
 * step 1's editor):
 *   - scSetFieldSize: a field becomes the plan's size field or stops being one; a second size field is refused with one sentence and nothing
 *     else changes; scSetOptionValue: a whole number from 0 to 999 (text or a number) or '' for none, anything else refused;
 *   - Save: the size and the numbers are written with the field (scFieldsDiff), the field the Sizing setting stands for is not stored by an
 *     edit that leaves it alone, and is stored once its choices or numbers change, whatever its place;
 *   - the page: the switch and the number box in Edit fields, the setting's field kept and not deletable there, one write with Undo as for any field.
 * No page is run: the page checks read the source. Usage: node modules/schedule/test/check-schedule-sizing-editor.mjs. Exits 1 on failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(dir, ...p), 'utf8');
const NAMES = ['scSetFieldSize', 'scSetOptionValue', 'scFieldsDiff', 'scFieldsWithSize', 'scFieldsFrom', 'scFieldValue', 'scAddField', 'scAddOption', 'scDeleteField', 'scMoveField', 'scSizeFieldOf', 'scSizeOf', 'scClean'];
const L = new Function(`${read('src', 'schedule-lib.js')}\nreturn { ${NAMES.join(', ')} };`)();
const page = read('src', 'schedule.js');
const css = read('src', 'schedule.css');

let n = 0;
const test = async (name, fn) => { try { await fn(); n += 1; } catch (e) { process.exitCode = 1; console.error(`FAIL ${name}\n${e.stack || e}`); } };

const fieldRow = (id, o) => ({ key: `field:${id}`, value: o });
const two = () => L.scFieldsFrom([fieldRow('area', { label: 'Area', order: 0, options: [{ id: 'core', label: 'Core' }] }), fieldRow('effort', { label: 'Effort', order: 1, options: [{ id: 'a', label: 'Small', value: 2 }, { id: 'b', label: 'Big' }] })]);

await test('a field becomes the size and stops being one; the others are left alone', () => {
  const on = L.scSetFieldSize(two(), 'effort', true);
  assert.equal(on.problem, undefined);
  assert.deepEqual(on.fields.map((f) => Boolean(f.size)), [false, true]);
  assert.equal(L.scSizeFieldOf(on.fields).id, 'effort');
  const off = L.scSetFieldSize(on.fields, 'effort', false);
  assert.equal('size' in off.fields[1], false);
  assert.equal(L.scSizeFieldOf(off.fields), null);
  assert.equal(L.scSetFieldSize(two(), 'gone', true).problem, 'That field is not there.');
});
await test('a second size field is refused with one sentence and nothing changes', () => {
  const one = L.scSetFieldSize(two(), 'effort', true).fields;
  const again = L.scSetFieldSize(one, 'area', true);
  assert.equal(again.problem, 'A plan has one size field.');
  assert.equal(again.fields, undefined);
  assert.equal(L.scSetFieldSize(one, 'effort', true).problem, undefined, 'the size field itself can be asked again');
});
await test('a choice is worth a whole number from 0 to 999, or nothing', () => {
  const f = two();
  const set = (v) => L.scSetOptionValue(f, 'effort', 'b', v);
  assert.equal(set('5').fields[1].options[1].value, 5);
  assert.equal(set(8).fields[1].options[1].value, 8);
  assert.equal(set(' 13 ').fields[1].options[1].value, 13);
  assert.equal(set('0').fields[1].options[1].value, 0, 'zero is a number');
  assert.equal(set('999').fields[1].options[1].value, 999);
  assert.equal('value' in L.scSetOptionValue(f, 'effort', 'a', '').fields[1].options[0], false, 'empty takes it off');
  for (const bad of ['1000', '-1', '2.5', 'three', '1e2', '0x10']) assert.equal(set(bad).problem, 'A size is a whole number from 0 to 999.', bad);
  assert.equal(L.scSetOptionValue(f, 'effort', 'gone', '1').problem, 'That choice is not there.');
  assert.equal('value' in f[1].options[1], false, 'the draft it was given is not changed');
});
await test('Save writes the size and the numbers with the field', () => {
  const was = two();
  let now = L.scSetFieldSize(was, 'effort', true).fields;
  now = L.scSetOptionValue(now, 'effort', 'b', '5').fields;
  const diff = L.scFieldsDiff(was, now);
  assert.deepEqual(diff.write.map((f) => f.id), ['effort'], 'only the field that changed');
  assert.deepEqual(L.scFieldValue(diff.write[0]), { id: 'effort', label: 'Effort', options: [{ id: 'a', label: 'Small', value: 2 }, { id: 'b', label: 'Big', value: 5 }], order: 1, size: true });
  assert.deepEqual(diff.remove, []);
  const stored = L.scFieldsFrom([{ key: 'field:effort', value: L.scFieldValue(diff.write[0]) }]);
  assert.equal(L.scSizeOf(L.scClean('w', { kind: 'work', title: 'T', fields: { effort: 'b' } }), L.scSizeFieldOf(stored)), 5);
});
await test('the field the Sizing setting stands for is stored only once it is edited, and then wherever it sits', () => {
  const was = L.scFieldsWithSize(two(), 'points');
  const size = was.find((f) => f.virtual);
  assert.ok(size && size.size);
  assert.deepEqual(L.scFieldsDiff(was, was.map((f) => ({ ...f }))).write, [], 'opened and saved untouched: nothing written');
  const moved = L.scMoveField(was, 'size', -1).fields;
  assert.deepEqual(L.scFieldsDiff(was, moved).write.map((f) => f.id), ['size', 'effort'], 'moving it stores it where it now sits');
  const after = L.scFieldsDiff(was, was.filter((f) => f.id !== 'area').map((f) => ({ ...f })));
  assert.deepEqual(after.write.map((f) => f.id), ['effort', 'size'], 'a field before it going shifts its place, which is kept');
  assert.deepEqual(after.remove, ['area']);
  const fromEnd = L.scFieldsDiff(was, [...was.map((f) => ({ ...f })), { id: 'extra', label: 'Extra', options: [] }]);
  assert.deepEqual(fromEnd.write.map((f) => f.id), ['extra'], 'a field added after it leaves it alone');
  const edited = L.scSetOptionValue(was, 'size', 'p3', '4').fields;
  const w = L.scFieldsDiff(was, edited).write;
  assert.deepEqual(w.map((f) => f.id), ['size'], 'a changed number stores it');
  assert.equal(L.scFieldValue(w[0]).options.find((o) => o.id === 'p3').value, 4);
  assert.equal(L.scFieldValue(w[0]).size, true);
  const added = L.scAddOption(was, 'size', '21').fields;
  assert.deepEqual(L.scFieldsDiff(was, added).write.map((f) => f.id), ['size'], 'a new choice stores it');
});
await test('the page: a Size switch on each field, a number box on a size field\'s choices, the setting\'s field kept', () => {
  assert.match(page, /sizeBox\.addEventListener\('change', \(\) => \{ if \(!changeDraft\(scSetFieldSize\(draft, f\.id, sizeBox\.checked\), `s:\$\{f\.id\}`\)\) sizeBox\.checked = Boolean\(f\.size\); \}\);/);
  assert.match(page, /sizeBox\.disabled = Boolean\(f\.virtual\)/, 'the setting\'s field stays the size');
  assert.match(page, /'trash', \(\) => changeDraft\(scDeleteField\(draft, f\.id\)\), \{ danger: true, disabled: Boolean\(f\.virtual\) \}\)/, 'and is not deleted here');
  assert.match(page, /if \(f\.size\) \{\s*worth = document\.createElement\('input'\);\s*worth\.type = 'number';/);
  assert.match(page, /scSetOptionValue\(draft, f\.id, o\.id, worth\.value\)/);
  assert.match(page, /worth\.setAttribute\('aria-label', `What \$\{o\.label\} is worth`\)/);
  assert.match(page, /const diff = scFieldsDiff\(state\.fields, draft\);/, 'Save is the one write with Undo, as for any field');
  assert.match(css, /\.fe-size \{[^}]*var\(--text-muted\)/);
  assert.match(css, /\.fe-row input\.fe-value \{/);
  assert.doesNotMatch(css.match(/\.fe-size[^\n]*\n/)[0] + css.match(/\.fe-row input\.fe-value[^\n]*\n/)[0], /#[0-9a-f]{3,6}|rgb\(/i, 'no colour of its own');
});

console.log(`check-schedule-sizing-editor: ${n} tests pass`);
