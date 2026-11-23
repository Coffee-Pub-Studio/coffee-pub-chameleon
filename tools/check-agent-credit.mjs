#!/usr/bin/env node
/*
 * check-agent-credit.mjs -- who an object made by a request is credited to (Drowbe/coffee-pub-chameleon#980, "uneven credit").
 * An agent asks, a person's open page carries it out. The SDK hands every provider handler `ctx.credit` ({ name, key }): the
 * asker when the server knows them (an agent, or a person), else the person whose page carries it out. Every module that
 * stamps an author on what a request makes reads `ctx.credit`, never the page's own user.
 *   1. The real `host.actions.provide` of public/sdk/host.js is run on stand-ins: an agent's request gives the agent, a person's
 *      own request gives that person, a guest asker (no key) gives the page's person, and `by`/`byKey` are as before.
 *   2. Read as code, each module that stamps an author on a request's object (travel, calendar, polls, goals, budget, maps, research,
 *      to-do, planner) reads `credit` at that stamp and none stamps the page's user there. A real page carrying out a real
 *      request needs a browser and is not run here.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let n = 0;
const test = async (name, fn) => { try { await fn(); n += 1; } catch (e) { process.exitCode = 1; console.error(`FAIL ${name}\n${e.stack || e}`); } };

// 1. The SDK's provide, cut out of host.js and run.
const sdk = read('public/sdk/host.js');
const start = sdk.indexOf('      provide: (handlers) => {');
const end = sdk.indexOf('\n      },\n    },', start);
assert.ok(start > 0 && end > start, 'could not find host.actions.provide in the SDK');
const makeProvide = new Function('call', 'host', 'info', `return { ${sdk.slice(start, end)}\n      } };`.replace(/^return \{ /, 'return { '));

async function carry(info, action) {
  const seen = [];
  let listener = null;
  const calls = [];
  const call = async (name, arg) => {
    calls.push(name);
    if (name === 'actions.pending') return [];
    if (name === 'actions.claim') return { ok: true, action };
    return {};
  };
  const { provide } = makeProvide(call, { on: (ev, fn) => { listener = fn; } }, info);
  provide({ make: async (input, ctx) => { seen.push(ctx); return {}; } });
  await new Promise((r) => setTimeout(r, 5));
  listener({ id: 1, name: 'make' });
  await new Promise((r) => setTimeout(r, 20));
  return seen[0];
}
const page = { user: { key: 'ann', name: 'Ann' } };
await test('an agent asks, Ann\'s page carries it out: the credit is the agent', async () => {
  const ctx = await carry(page, { id: 1, from: 'chat', input: {}, by: 'Claude', byKey: 'agent1' });
  assert.deepEqual(ctx.credit, { name: 'Claude', key: 'agent1' });
  assert.equal(ctx.by, 'Claude');
  assert.equal(ctx.byKey, 'agent1');
});
await test('Ann asks and her own page carries it out: the credit is Ann', async () => {
  const ctx = await carry(page, { id: 1, from: 'chat', input: {}, by: 'Ann', byKey: 'ann' });
  assert.deepEqual(ctx.credit, { name: 'Ann', key: 'ann' });
});
await test('Bob asks and Ann\'s page carries it out: the credit is Bob, never Ann', async () => {
  const ctx = await carry(page, { id: 1, from: 'chat', input: {}, by: 'Bob', byKey: 'bob' });
  assert.deepEqual(ctx.credit, { name: 'Bob', key: 'bob' });
});
await test('a guest or departed asker (no key) is credited to the page\'s person, as before', async () => {
  const ctx = await carry(page, { id: 1, from: 'chat', input: {}, by: 'someone', byKey: null });
  assert.deepEqual(ctx.credit, { name: 'Ann', key: 'ann' });
});

// 3. The page adapter for an actions library (host.actions.fromLibrary) hands the handler exactly the credit provide gave it, so a
// page and the server's runner (which gives the agent's own) credit alike.
await test('fromLibrary hands the library handler provide\'s credit, unchanged', async () => {
  const win = { addEventListener() {}, location: { search: '' } };
  win.parent = win;
  new Function('window', 'document', sdk)(win, { createElement: (tag) => ({ tag }) });
  const seen = [];
  const stand = { util: {}, space: () => ({ id: 's1' }), phases: () => [], storage: { list: async () => [], set: async () => ({ version: 1 }) } };
  const h = win.hostActions.fromLibrary(stand, { make: (input, ctx) => { seen.push(ctx); return {}; } }, { module: () => ({ id: 'x', name: 'X' }) });
  await h.make({}, { from: 'chat', by: 'Claude', byKey: 'agent1', credit: { name: 'Claude', key: 'agent1' } });
  assert.deepEqual(seen[0].credit, { name: 'Claude', key: 'agent1' });
  assert.deepEqual([seen[0].by, seen[0].byKey], ['Claude', 'agent1']);
});

// 2. Each module's stamp reads the credit.
const has = (file, re, what) => test(what, () => assert.match(read(file), re, `${file}: ${what}`));
const lacks = (file, re, what) => test(what, () => assert.doesNotMatch(read(file), re, `${file}: ${what}`));
await has('modules/travel/src/travel-lib-plan.js', /by: by \|\| host\.user\.name/, 'travel: addItem stamps the given credit, else the page person');
// Travel and Calendar keep their action rules in an actions library (plan-agent-edit-delete.md, step 2): the page runs it through
// host.actions.fromLibrary, which hands it provide's credit (3. below), and the server's runner hands it the agent's.
await has('modules/travel/src/travel-lib-actions.js', /function actAddHandedIn\(plan, fields, ctx\) \{\s*const by = ctx\.credit\.name;/, 'travel: acceptSuggestion\'s entry is the credit\'s');
await has('modules/travel/src/travel-lib-actions.js', /function actAddPlain\(plan, fields, ctx\) \{\s*const made = actNew\(plan, fields, ctx\.credit\.name, ctx\);/, 'travel: addStop and addToDay credit the asker');
await has('modules/travel/src/travel-lib-plan.js', /host\.actions\.fromLibrary\(ACTION_HANDLERS/, 'travel: the page carries the library\'s handlers');
await has('modules/calendar/src/calendar-lib-actions.js', /createEvent\(input, ctx\)[\s\S]*by: ctx\.credit\.name/, 'calendar: createEvent stamps the credit');
await has('modules/calendar/src/calendar.js', /host\.actions\.fromLibrary\(ACTION_HANDLERS/, 'calendar: the page carries the library\'s handlers');
await has('modules/polls/src/polls-lib-actions.js', /createPoll\(input, ctx\)[\s\S]*by: ctx\.credit\.name, byKey: ctx\.credit\.key/, 'polls: createPoll stamps name and key from the credit');
await has('modules/polls/src/polls.js', /host\.actions\.fromLibrary\(actionHandlers\(\)/, 'polls: the page carries the library\'s handlers');
await has('modules/goals/src/goals.js', /value\.by = by \|\| me/, 'goals: add stamps the given credit');
await has('modules/goals/src/goals-lib-actions.js', /function add\(kind, raw, ctx\) \{[\s\S]*value\.by = ctx\.credit\.key;/, 'goals: addGoal, addStep and addNote stamp the credit key');
await has('modules/goals/src/goals.js', /host\.actions\.fromLibrary\(/, 'goals: the page carries the library\'s handlers');
await has('modules/budget/src/budget-lib-actions.js', /costFromRequest\(input, ctx\.credit\.key, ctx\.people/, 'budget: addCost stamps the credit key');
await has('modules/budget/src/budget.js', /host\.actions\.fromLibrary\(/, 'budget: the page carries the library\'s handlers');
await has('modules/maps/src/maps-lib-g-list-view.js', /placeWhere\(ticks, input, \(ctx && ctx\.credit && ctx\.credit\.key\)/, 'maps: addPlace stamps the credit key');
await has('modules/maps/src/maps-lib-g-list-view.js', /placeChanged\(p, input, \(ctx && ctx\.credit && ctx\.credit\.key\)/, 'maps: updatePlace stamps the credit key');
await has('modules/research/src/research-lib.js', /byOf = \(ctx\) => \(ctx && ctx\.credit && ctx\.credit\.name\)/, 'research: byOf reads the credit');
await has('modules/todo/src/todo.js', /by: \(meta && meta\.credit && meta\.credit\.name\)/, 'to-do: createTask reads the credit');
await has('modules/schedule/src/schedule-lib.js', /ctx\.byKey/, 'planner: scAddedBy reads the asker key');
await lacks('modules/maps/src/maps-lib-g-list-view.js', /info\.user\.key \|\| \(ctx/, 'maps: the page person no longer comes before the asker');
await lacks('modules/budget/src/budget.js', /\(ctx && ctx\.by\) \|\| info\.user\.key/, 'budget: the asker\'s name is no longer stored where a key belongs');

if (process.exitCode) console.error('check-agent-credit: FAILED'); else console.log(`check-agent-credit: ok (${n} checks)`);
