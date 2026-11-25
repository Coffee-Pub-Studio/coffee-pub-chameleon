#!/usr/bin/env node
/*
 * check-budget-actions.mjs -- Budget's actions library (src/budget-lib-actions.js, ACTION_HANDLERS), run the two ways it is
 * carried out (plan-agent-edit-delete.md, decision 4, step 2): through the server's runner (its worker process and vm, then its
 * outcomeOf check) and through the SDK's page adapter (host.actions.fromLibrary) on a stand-in host, both from
 * tools/module-actions-harness.mjs, expecting the same answer. Then addCost as before and updateCost: only the fields given, the
 * form's sentences, "" clearing, `amount` read as addCost reads it, and the environment's categories (ctx.settings, which the
 * page hands it) naming the cost. Budget declares actions.server: every handler is run both ways, the runner with carrier 'server'. Exits 1 on
 * failure.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { onPage, onRunner, handlersOf, library } from '../../../tools/module-actions-harness.mjs';

let n = 0;
const test = async (name, fn) => { try { await fn(); n += 1; } catch (e) { process.exitCode = 1; console.error(`FAIL ${name}\n${e.stack || e}`); } };
async function same(action, input, world) {
  // The runner as the server's own: carrier 'server', so a handler that leaves work for a page must say so (none may).
  const r = { page: await onPage('budget', action, input, world, { name: 'Budget', kinds: ['cost'] }), runner: await onRunner('budget', action, input, world, { ...{ name: 'Budget', kinds: ['cost'] }, carrier: 'server' }) };
  assert.ok(!r.runner.fault, `${action}: the runner faulted (${r.runner.fault})`);
  if (r.page.refused !== undefined || r.runner.refused !== undefined) {
    assert.equal(r.runner.refused, r.page.refused, `${action}: the same refusal`);
    return r.page;
  }
  assert.deepEqual(r.runner.writes, r.page.writes, `${action}: the same writes`);
  assert.deepEqual(r.runner.ref, r.page.ref, `${action}: the same pointer`);
  assert.deepEqual(r.runner.data, r.page.data, `${action}: the same note`);
  return r.page;
}
const refuses = async (action, input, w, words) => assert.equal((await same(action, input, w)).refused, words);
const written = (r, id) => (r.writes.find((w) => w.key === `cost:${id}`) || {}).value;
const ref = (id) => ({ module: 'budget', kind: 'cost', id, scope: 'space', space: 's1' });
const PEOPLE = [{ key: 'u-ana', name: 'Ana' }, { key: 'u-bo', name: 'Bo' }, { key: 'u-sam1', name: 'Sam' }, { key: 'u-sam2', name: 'sam' }];
const HOTEL = { title: 'Hotel', category: 'lodging', categoryName: 'Lodging', planned: 300, amount: 300, done: false, sharedBy: ['u-ana', 'u-bo'], date: '2027-05-01', notes: 'Two nights', by: 'u-ana' };
const TAXI = { title: 'Taxi', category: 'travel', categoryName: 'Travel', actual: 45, amount: 45, done: true, paidBy: 'u-bo', notes: '', by: 'u-bo' };
const world = (rows = { 'cost:c1': HOTEL, 'cost:c2': TAXI }) => ({ space: { id: 's1', name: 'Lisbon 2027' }, people: PEOPLE, rows });

await test('addCost: the same both ways, credited to the asker\'s key, people by name', async () => {
  const r = await same('addCost', { title: 'Dinner', amount: 80, category: 'food', payer: 'ana', sharedBy: 'Ana, Bo', date: '2027-05-01' }, world());
  assert.deepEqual(written(r, 'n1'), { title: 'Dinner', category: 'food', categoryName: 'Food', actual: 80, amount: 80, done: true, paidBy: 'u-ana', sharedBy: ['u-ana', 'u-bo'], date: '2027-05-01', notes: '', by: 'agent1' });
  assert.deepEqual(r.ref, ref('n1'));
  await refuses('addCost', { title: 'X', payer: 'Zed' }, world(), 'That person is not in this space. Use list_members to see who is.');
  await refuses('addCost', { title: 'X', payer: 'Sam' }, world(), 'Two people are called Sam; use the key.');
  await refuses('addCost', { title: 'X', amount: -2 }, world(), 'the amount must be an amount above zero');
});

await test('updateCost changes only the fields given; who added it stays', async () => {
  const r = await same('updateCost', { cost: ref('c1'), title: 'Hotel Lisboa' }, world());
  assert.deepEqual(written(r, 'c1'), { ...HOTEL, title: 'Hotel Lisboa' });
  const paid = await same('updateCost', { cost: ref('c1'), actual: 280, payer: 'Bo' }, world());
  assert.deepEqual(written(paid, 'c1'), { ...HOTEL, actual: 280, amount: 280, done: true, paidBy: 'u-bo' }, 'paid: its planned amount kept, its shown amount the paid one');
  const cat = await same('updateCost', { cost: ref('c2'), category: 'fees' }, world());
  assert.deepEqual(written(cat, 'c2'), { ...TAXI, category: 'fees', categoryName: 'Fees' });
  const odd = await same('updateCost', { cost: ref('c2'), category: 'Not a category!' }, world());
  assert.deepEqual([written(odd, 'c2').category, written(odd, 'c2').categoryName], ['other', 'Other'], 'anything else counts as other, as addCost has it');
  const shared = await same('updateCost', { cost: ref('c2'), sharedBy: 'Ana, u-bo, ana' }, world());
  assert.deepEqual(written(shared, 'c2').sharedBy, ['u-ana', 'u-bo'], 'the list is replaced, each person once');
  const kept = await same('updateCost', { cost: ref('c1'), title: 'Hotel', planned: 300 }, world());
  assert.deepEqual([kept.writes, kept.data], [[], { note: 'That is already so; nothing changed.' }]);
});
await test('updateCost: amount is what was paid when the cost has a payer or is paid, else what is planned', async () => {
  const planned = await same('updateCost', { cost: ref('c1'), amount: 320 }, world());
  assert.deepEqual([written(planned, 'c1').planned, written(planned, 'c1').actual], [320, undefined]);
  const actual = await same('updateCost', { cost: ref('c2'), amount: 50 }, world());
  assert.deepEqual([written(actual, 'c2').actual, written(actual, 'c2').amount], [50, 50]);
  const withPayer = await same('updateCost', { cost: ref('c1'), amount: 310, payer: 'u-ana' }, world());
  assert.deepEqual([written(withPayer, 'c1').planned, written(withPayer, 'c1').actual, written(withPayer, 'c1').done], [300, 310, true]);
  await refuses('updateCost', { cost: ref('c1'), amount: 10, planned: 20 }, world(), 'Give amount, or planned and actual, not both.');
});
await test('updateCost: "" clears planned, actual, who paid, who shares it, the date or the notes (the manifest\'s clears)', async () => {
  const r = await same('updateCost', { cost: ref('c1'), sharedBy: '', date: '', notes: '' }, world());
  const { sharedBy, date, ...rest } = HOTEL;
  assert.deepEqual(written(r, 'c1'), { ...rest, notes: '' });
  const unpaid = await same('updateCost', { cost: ref('c2'), actual: '', payer: '', planned: 40 }, world());
  const { actual, paidBy, ...taxi } = TAXI;
  assert.deepEqual(written(unpaid, 'c2'), { ...taxi, planned: 40, amount: 40, done: false });
  const m = JSON.parse(fs.readFileSync(new URL('../module.json', import.meta.url), 'utf8'));
  assert.deepEqual(m.actions.provides.find((a) => a.name === 'updateCost').clears, ['planned', 'actual', 'payer', 'sharedBy', 'date', 'notes']);
});
await test('updateCost: the refusals, in the form\'s words', async () => {
  const w = world();
  await refuses('updateCost', { cost: ref('zz'), title: 'x' }, w, "That cost isn't in the budget.");
  await refuses('updateCost', { cost: { ...ref('c1'), space: 's2' }, title: 'x' }, w, "That cost isn't in the budget.");
  await refuses('updateCost', { cost: { ...ref('c1'), module: 'travel', kind: 'plan' }, title: 'x' }, w, "That cost isn't in the budget.");
  await refuses('updateCost', { cost: ref('c1') }, w, 'Say what to change: the title, an amount, planned, actual, the category, who paid, who shares it, the date or the notes. Send "" to clear any but the title, amount and category.');
  await refuses('updateCost', { cost: ref('c1'), title: '   ' }, w, 'Give the cost a title.');
  await refuses('updateCost', { cost: ref('c1'), planned: 0 }, w, 'The planned amount is a number above zero, such as 40 or 12.50.');
  await refuses('updateCost', { cost: ref('c1'), actual: -5 }, w, 'The paid amount is a number above zero, such as 40 or 12.50.');
  await refuses('updateCost', { cost: ref('c1'), amount: 0 }, w, 'The amount is a number above zero, such as 40 or 12.50.');
  await refuses('updateCost', { cost: ref('c1'), date: '2027-02-30' }, w, 'The date is a day, such as 2026-10-14.');
  await refuses('updateCost', { cost: ref('c1'), payer: 'Zed' }, w, 'That person is not in this space. Use list_members to see who is.');
});

await test('on the page: the environment\'s categories name the cost (ctx.settings)', async () => {
  const cats = [{ id: 'travel', label: 'Getting there' }, { id: 'other', label: 'Misc' }];
  const handlers = Object.fromEntries(Object.entries(handlersOf('budget')).map(([k, f]) => [k, (input, ctx) => f(input, { ...ctx, settings: { categories: cats } })]));
  const r = await onPage('budget', 'updateCost', { cost: ref('c2'), notes: 'From the airport' }, world(), { handlers });
  assert.deepEqual([written(r, 'c2').category, written(r, 'c2').categoryName], ['travel', 'Getting there']);
  const a = await onPage('budget', 'addCost', { title: 'Tip', amount: 5, category: 'food' }, world(), { handlers });
  assert.deepEqual([written(a, 'n1').category, written(a, 'n1').categoryName], ['food', 'Misc'], 'a category off the list shows under Other, by its words');
  const page = fs.readFileSync(new URL('../src/budget.js', import.meta.url), 'utf8');
  assert.match(page, /settings: \{ categories: state\.cats \}/);
  assert.match(page, /function afterAction[\s\S]*if \(cost\.ref\) host\.objects\.setLinks\(pointer\(id\), \[cost\.ref\]\)/, 'a cost made from an object points at it');
});

await test('the manifest: updateCost within the caps; actions.server is the library', async () => {
  const m = JSON.parse(fs.readFileSync(new URL('../module.json', import.meta.url), 'utf8'));
  const u = m.actions.provides.find((a) => a.name === 'updateCost');
  assert.deepEqual(u.input, { cost: 'ref:budget:cost', title: 'string?', amount: 'number?', planned: 'number?', actual: 'number?', category: 'string?', payer: 'string?', sharedBy: 'string?', date: 'date?', notes: 'text?' });
  assert.equal(u.effect, 'write');
  for (const a of m.actions.provides) {
    assert.match(a.description, /^[^.]+\.$/, `${a.name}: one sentence`);
    for (const [k, v] of Object.entries(a.inputHints || {})) assert.ok(k in a.input && v.length <= 200, `${a.name}.${k}`);
  }
  assert.equal(m.actions.server, 'src/budget-lib-actions.js', 'carried out on the server too');
  const lib = library('budget').js;
  for (const name of m.actions.provides.filter((a) => !a.local && a.effect !== 'delete').map((a) => a.name)) assert.match(lib, new RegExp(`\\n      ${name}\\(input, ctx\\) \\{`), `${name} is a handler in the library`);
});

if (!process.exitCode) console.log(`check-budget-actions: OK (${n} tests)`);
