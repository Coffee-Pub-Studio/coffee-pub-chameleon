#!/usr/bin/env node
/*
 * check-schedule-order.mjs -- Planner - Projects' order inside a board column (plan-github-two-way.md, build order step 5):
 *   - ranks: scRankBetween gives a rank strictly between two, never ends in the lowest digit, and stays short for the first moves;
 *     scSpreadRanks gives n even ranks in order;
 *   - the order of a column (scCardOrder): ranked work first by rank, then work with no rank in the plan's order before ranks (the end
 *     day, none last, then the outline), so an issue on its first pull sits at the bottom and nothing is reordered by a pull;
 *   - a placement (scPlace): at the end, in front of a card, at the top, with ranks given first to unranked work above it, a spread when
 *     there is no room (ranks too long, or two the same), and only the card (and work that needed a rank) written;
 *   - setColumn with `before` gives the same answer on the page and on the server, moves to another column at the end or in front of a
 *     card, keeps `done` with the column, and a `before` that is not in the column means the end;
 *   - the page: the cards are sorted by scCardOrder, a move sends `before`, a pulled move writes the rank with the card and the others'
 *     ranks alone (no column or done change, so nothing goes to GitHub), the others without a redraw between them and stopping at the
 *     first refusal. These page checks read the source; none runs the page.
 * Usage: node modules/schedule/test/check-schedule-order.mjs. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { onPage, onRunner } from '../../../tools/module-actions-harness.mjs';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(dir, ...p), 'utf8');
const L = new Function(`${read('src', 'schedule-lib.js')}\nreturn { scRankBetween, scSpreadRanks, scCardOrder, scPlace, scClean, scValue, scDefaultBoard, scColumnOf };`)();
const page = read('src', 'schedule.js');

let passed = 0;
const fails = [];
async function test(name, fn) { try { await fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }
const board = L.scDefaultBoard('priority');
const w = (id, o = {}) => L.scClean(id, { kind: 'work', title: id, start: '2026-11-01', end: o.end || '2026-11-05', column: 'now', order: `o${id}`, by: 'u', ...o });
const idsOf = (entries, col) => entries.filter((e) => L.scColumnOf(e, board).id === col).sort(L.scCardOrder(entries)).map((e) => e.id);
const apply = (entries, r) => entries.filter((e) => e.id !== r.entry.id && !r.others.some((o) => o.id === e.id)).concat([r.entry], r.others);

await test('a rank between two sorts between them, ends in no lowest digit, and stays short', () => {
  const cases = [['', null], ['', 'V'], ['V', null], ['V', 'W'], ['a', 'a1'], ['zz', null], ['0V', 'V'], ['A', 'B'], ['a', 'b']];
  for (const [a, b] of cases) {
    const r = L.scRankBetween(a, b);
    assert.ok(r > a && (b === null || r < b), `${a}|${b} -> ${r}`);
    assert.ok(!r.endsWith('0') && /^[0-9A-Za-z]+$/.test(r), `${r} is a valid rank`);
  }
  let lo = '';
  for (let i = 0; i < 12; i += 1) lo = L.scRankBetween(lo, null);
  assert.ok(lo.length <= 3, `twelve appends stay short (${lo})`);
  let hi = 'V';
  for (let i = 0; i < 18; i += 1) { const r = L.scRankBetween('', hi); assert.ok(r < hi && r > ''); hi = r; }
  assert.equal(L.scRankBetween('b', 'a'), '', 'a backwards pair gives nothing');
});
await test('spread ranks are even, in order and valid', () => {
  for (const n of [1, 2, 7, 60, 5000]) {
    const r = L.scSpreadRanks(n);
    assert.equal(r.length, n);
    for (let i = 1; i < n; i += 1) assert.ok(r[i - 1] < r[i]);
    assert.ok(r.every((x) => /^[0-9A-Za-z]{3,6}$/.test(x) && !x.endsWith('0')));
  }
});
await test('a column: ranked work first, then work with no rank by end day (none last) and the outline', () => {
  const es = [w('a', { end: '2026-11-09' }), w('b', { end: '2026-11-02' }), w('c', { end: '' , start: '' }), w('d', { rank: 'M' }), w('e', { rank: 'D' }), w('f', { column: 'next' })];
  assert.deepEqual(idsOf(es, 'now'), ['e', 'd', 'b', 'a', 'c']);
  assert.deepEqual(idsOf(es, 'next'), ['f']);
});
await test('a placement: at the end, at the top, in front of a card; one card written when the others have ranks', () => {
  let es = ['a', 'b', 'c'].map((id, i) => w(id, { rank: ['D', 'M', 'V'][i] }));
  const x = w('x', { column: 'now' });
  let r = L.scPlace(es, x, 'now', board, '');
  assert.deepEqual(r.others, []);
  assert.deepEqual(idsOf(apply(es, r), 'now'), ['a', 'b', 'c', 'x']);
  r = L.scPlace(es, x, 'now', board, 'a');
  assert.deepEqual(idsOf(apply(es, r), 'now'), ['x', 'a', 'b', 'c']);
  assert.deepEqual(r.others, []);
  r = L.scPlace(es, x, 'now', board, 'c');
  assert.deepEqual(idsOf(apply(es, r), 'now'), ['a', 'b', 'x', 'c']);
  const c = es[2];
  r = L.scPlace(es, c, 'now', board, 'b');
  assert.deepEqual(idsOf(apply(es, r), 'now'), ['a', 'c', 'b']);
  assert.equal(r.entry.id, 'c');
  r = L.scPlace(es, c, 'now', board, 'nowhere');
  assert.deepEqual(idsOf(apply(es, r), 'now'), ['a', 'b', 'c'], 'a card not in the column means the end');
});
await test('work with no rank above the drop gets one first, in its old order; below it stays unranked', () => {
  const es = [w('a', { end: '2026-11-01' }), w('b', { end: '2026-11-02' }), w('c', { end: '2026-11-03' }), w('d', { end: '2026-11-04' })];
  const x = w('x', { column: 'now' });
  const r = L.scPlace(es, x, 'now', board, 'c');
  assert.deepEqual(r.others.map((o) => o.id).sort(), ['a', 'b']);
  const after = apply(es, r);
  assert.deepEqual(idsOf(after, 'now'), ['a', 'b', 'x', 'c', 'd']);
  assert.ok(!after.find((e) => e.id === 'c').rank && !after.find((e) => e.id === 'd').rank, 'the cards below stay unranked');
  const top = L.scPlace(es, x, 'now', board, 'a');
  assert.deepEqual(top.others, [], 'at the top writes only the card');
  assert.deepEqual(idsOf(apply(es, top), 'now'), ['x', 'a', 'b', 'c', 'd']);
});
await test('a column with no room is spread again; two ranks the same are told apart', () => {
  const long = 'V'.repeat(30);
  let es = [w('a', { rank: 'V' }), w('b', { rank: 'V' }), w('c', { rank: 'W' })];
  let r = L.scPlace(es, w('x'), 'now', board, 'b');
  let after = apply(es, r);
  assert.deepEqual(idsOf(after, 'now'), ['a', 'x', 'b', 'c']);
  assert.ok(new Set(after.map((e) => e.rank)).size === 4, 'all four have their own rank');
  es = [w('a', { rank: long }), w('b', { rank: long + 'W' })];
  r = L.scPlace(es, w('x'), 'now', board, 'b');
  assert.deepEqual(idsOf(apply(es, r), 'now'), ['a', 'x', 'b']);
  assert.ok(apply(es, r).every((e) => e.rank.length <= 6), 'spread to short ranks');
});
await test('the same cards again and again keep ranks short enough', () => {
  let es = ['a', 'b', 'c', 'd', 'e'].map((id) => w(id));
  const ids = () => idsOf(es, 'now');
  for (let i = 0; i < 80; i += 1) {
    const order = ids();
    const mover = es.find((e) => e.id === order[order.length - 1]);
    const r = L.scPlace(es, mover, 'now', board, order[0]);
    es = apply(es, r);
    assert.equal(ids()[0], mover.id);
  }
  assert.ok(es.every((e) => e.rank.length <= 24), 'no rank is longer than the limit');
});
await test('setColumn with before: the same on the page and the server, done with the column, one write for the card', async () => {
  const SP = { id: 's1', name: 'Launch' };
  const row = (o) => ({ kind: 'work', title: 'W', start: '2026-11-01', end: '2026-11-02', order: 'm', by: 'u', done: false, ...o });
  const world = { space: SP, rows: { 'plan:a': row({ column: 'now', rank: 'D' }), 'plan:b': row({ column: 'now', rank: 'M' }), 'plan:c': row({ column: 'next', rank: 'M' }), 'plan:d': row({ column: 'done', done: true }) }, people: [], settings: { boardColumns: 'priority' }, phases: [] };
  const ref = (id) => ({ module: 'schedule', kind: 'plan', id, scope: 'space', space: 's1' });
  const run = async (input) => {
    const a = await onPage('schedule', 'setColumn', input, world, { name: 'Planner - Projects' });
    const b = await onRunner('schedule', 'setColumn', input, world, { kinds: ['plan'], carrier: 'server' });
    assert.ok(!b.fault, b.fault);
    assert.deepEqual(a.writes, b.writes, 'the same writes');
    return a;
  };
  let r = await run({ ref: ref('c'), column: 'now', before: 'b' });
  assert.equal(r.writes.length, 1, 'one card written');
  assert.equal(r.writes[0].value.column, 'now');
  assert.ok(r.writes[0].value.rank > 'D' && r.writes[0].value.rank < 'M', 'between the two');
  r = await run({ ref: ref('b'), column: 'now', before: 'a' });
  assert.equal(r.writes.length, 1);
  assert.equal(r.writes[0].value.column, 'now');
  assert.ok(r.writes[0].value.rank < 'D');
  r = await run({ ref: ref('c'), column: 'now' });
  assert.ok(r.writes[0].value.rank > 'M', 'no before: the end');
  r = await run({ ref: ref('a'), column: 'done', before: 'zzz' });
  assert.equal(r.writes[0].value.done, true, 'done follows the column');
  assert.ok(r.writes[0].value.rank > '', 'a rank in the done column');
  r = await run({ ref: ref('a'), column: 'now', before: 'a' });
  assert.ok(r.writes[0].value.rank, 'a card in front of itself is taken as the end');
});
await test('setColumn gives unranked work above the drop a rank, written with the card', async () => {
  const SP = { id: 's1', name: 'Launch' };
  const row = (o) => ({ kind: 'work', title: 'W', start: '2026-11-01', order: 'm', by: 'u', done: false, column: 'now', ...o });
  const world = { space: SP, rows: { 'plan:a': row({ end: '2026-11-01' }), 'plan:b': row({ end: '2026-11-02' }), 'plan:c': row({ end: '2026-11-03' }), 'plan:x': row({ column: 'next', end: '2026-11-09' }) }, people: [], settings: { boardColumns: 'priority' }, phases: [] };
  const input = { ref: { module: 'schedule', kind: 'plan', id: 'x', scope: 'space', space: 's1' }, column: 'now', before: 'c' };
  const a = await onPage('schedule', 'setColumn', input, world, { name: 'Planner - Projects' });
  const b = await onRunner('schedule', 'setColumn', input, world, { kinds: ['plan'], carrier: 'server' });
  const byKey = (x) => x.slice().sort((p, q) => (p.key < q.key ? -1 : 1));
  assert.deepEqual(byKey(a.writes), byKey(b.writes));
  assert.deepEqual(a.writes.map((x) => x.key).sort(), ['plan:a', 'plan:b', 'plan:x']);
});
await test('pulled work is placed one entry at a time: no before drops the rank; before only where the work above has ranks', async () => {
  const SP = { id: 's1', name: 'Launch' };
  const src = { from: 'github', repo: 'o/r', number: 1 };
  const row = (o) => ({ kind: 'work', title: 'W', start: '2026-11-01', order: 'm', by: 'u', done: false, column: 'now', ...o });
  const world = { space: SP, rows: { 'plan:g1': row({ end: '2026-11-01', source: src }), 'plan:g2': row({ end: '2026-11-02', source: src }), 'plan:g3': row({ column: 'next', rank: 'M', source: src }), 'plan:r1': row({ end: '2026-11-03', rank: 'D' }), 'plan:r2': row({ end: '2026-11-04', rank: 'M' }) }, people: [], settings: { boardColumns: 'priority' }, phases: [] };
  const ref = (id) => ({ module: 'schedule', kind: 'plan', id, scope: 'space', space: 's1' });
  const run = async (input) => {
    const a = await onPage('schedule', 'setColumn', input, world, { name: 'Planner - Projects' });
    const b = await onRunner('schedule', 'setColumn', input, world, { kinds: ['plan'], carrier: 'server' });
    assert.ok(!b.fault, b.fault);
    assert.equal(a.refused, b.refused, 'the same refusal');
    if (a.refused === undefined) assert.deepEqual(a.writes, b.writes, 'the same writes');
    return a;
  };
  let r = await run({ ref: ref('g3'), column: 'now' });
  assert.deepEqual([r.writes.length, r.writes[0].value.column, r.writes[0].value.rank], [1, 'now', undefined], 'one write, and the old rank of the other column is dropped');
  r = await run({ ref: ref('g3'), column: 'now', before: 'g2' });
  assert.match(r.refused, /has no order yet/, 'work above with no rank would need writing too');
  r = await run({ ref: ref('g3'), column: 'now', before: 'r2' });
  assert.equal(r.refused, undefined);
  assert.equal(r.writes.length, 1);
  assert.ok(r.writes[0].value.rank > 'D' && r.writes[0].value.rank < 'M');
});
await test('the page: sorted by scCardOrder, a move sends before, a pulled move writes ranks alone for the others', () => {
  assert.match(page, /sort\(scCardOrder\(list\(\)\)\)/);
  assert.match(page, /scPlace\(list\(\), moved\.entry, moved\.entry\.column, b, m\.before \|\| ''\)/);
  assert.ok(page.indexOf('for (const o of placed.others)') < page.indexOf('rank: placed.entry.rank'), 'the others are ranked before the card is written');
  assert.match(page, /sendPulled\(o\.id, \(e\) => \(e\.rank === o\.rank \? null : \{ \.\.\.e, rank: o\.rank \}\), true\)/, 'the others change by rank only, quietly');
  assert.match(page, /if \(!r\.ok\) return;\n\s*\}\n\s*await sendPulled\(m\.id,/, 'a refused rank stops the move before the card is written');
  const send = page.match(/function sendPulled\(id, make, quiet\) \{[\s\S]*?\n  \}\n/)[0];
  assert.match(send, /if \(!quiet\) render\(\);\n\s*return \{ ok: true/, 'a quiet write that went through is not drawn');
  assert.match(send.slice(send.indexOf('catch')), /sayWhy\(error\);\n\s*render\(\);/, 'a refusal is always drawn');
  assert.doesNotMatch(read('src', 'schedule-lib.js').match(/function scPlace[\s\S]*?\n}\n/)[0], /column:|done:/, 'a placement never changes a column or done');
});

if (fails.length) { console.error(`check-schedule-order: ${fails.length} failed\n  ${fails.join('\n  ')}`); process.exit(1); }
console.log(`check-schedule-order: ${passed} tests pass`);
