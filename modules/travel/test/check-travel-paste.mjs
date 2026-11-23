#!/usr/bin/env node
/*
 * check-travel-paste.mjs -- the Itinerary's "Paste a booking" sheet (plan-assistant-reboot.md, step 4): its pure parts run on
 * their own (the count, the preview rows from a fixed host.ai.extract answer, which rows go on, the words of an error and of what
 * was added), adding only the ticked rows through the plan's own object path (cost, currency and travellers as built), Edit's
 * fields, the sheet's markup and wiring read as code, the manifest's ai hook, and the stand-in answer's shape. The sheet drawn in
 * a browser is tools/check-travel-paste-live.mjs. Exits 1 on any failure.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { ANSWER } from './travel-paste-fixture.mjs';

const src = new URL('../src/', import.meta.url);
const read = (n) => fs.readFileSync(new URL(n, src), 'utf8');
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const lib = new Function('ymd', 'parseYmd', `${read('travel-lib.js')}\n${read('travel-lib-actions.js')}\n${read('travel-lib-object.js')}\n${read('travel-lib-paste.js')}\n${read('travel-lib-plan.js')}\nreturn { createPlan, objectFields, pasteCount, pasteRows, pasteChosen, pasteError, pasteAdded, PASTE_MAX };`)(ymd, parseYmd);
// The SDK's page adapter for an actions library (host.actions.fromLibrary), which the stand-in host hands the plan.
let sdkActions;
const hostText = (() => {
  const win = { addEventListener() {}, location: { search: '' } };
  win.parent = win;
  new Function('window', 'document', fs.readFileSync(new URL('../../../public/sdk/host.js', import.meta.url), 'utf8'))(win, { createElement: (tag) => ({ tag }) });
  sdkActions = win.hostActions;
  return win.hostText;
})();
const fmt = { day: (d) => `D(${d})`, time: (t) => `T(${t})`, money: (n, c) => `${n.toFixed(2)} ${c || 'GBP'}` };

// the count: characters, the limit, empty and over
assert.equal(lib.PASTE_MAX, 30000);
assert.equal(lib.pasteCount('').empty, true);
assert.equal(lib.pasteCount('  \n ').empty, true);
assert.equal(lib.pasteCount('a'.repeat(1204)).text, '1,204 of 30,000');
assert.equal(lib.pasteCount('a'.repeat(30000)).over, false);
assert.equal(lib.pasteCount('a'.repeat(30001)).over, true);
assert.match(lib.pasteCount('a'.repeat(30001)).text, /^30,001 of 30,000: too long\. Paste one email at a time\.$/);
assert.equal(lib.pasteCount('é'.repeat(30000)).over, false, 'a letter counts once');

// the stand-in answer's shape: what host.ai.extract answers and the sheet reads
assert.deepEqual(Object.keys(ANSWER).sort(), ['cut', 'dropped', 'notes', 'objects', 'tokens', 'unread']);
assert.equal(ANSWER.notes.length, ANSWER.objects.length, 'notes[i] is the row i sentences');
assert.ok(ANSWER.objects.every((o) => typeof o.kind === 'string' && typeof o.title === 'string' && o.details && typeof o.details === 'object'));

// the preview rows from the fixed answer
const rows = lib.pasteRows(ANSWER, fmt);
assert.equal(rows.length, 3);
assert.deepEqual(rows.map((r) => r.kind), ['Flight', 'Stay', 'Restaurant']);
assert.deepEqual(rows.map((r) => r.icon), ['plane', 'bed', 'utensils']);
assert.ok(rows.every((r) => r.checked === true && r.done === false), 'every row is ticked at first');
assert.equal(rows[0].title, 'TP 1350 Lisbon to London');
assert.equal(rows[0].when, 'D(2027-03-14), T(07:05) to D(2027-03-14), T(09:50)');
assert.deepEqual(rows[0].route, { from: 'Lisbon (LIS)', to: 'London Heathrow (LHR)' });
assert.equal(rows[0].reference, 'QX7RTB');
assert.equal(rows[0].cost, '412.80 EUR');
assert.equal(rows[0].travellers, 'Ana Silva');
assert.deepEqual(rows[0].notes, []);
assert.equal(rows[1].when, 'D(2027-03-14), T(15:00) to D(2027-03-17), T(11:00)');
assert.equal(rows[1].route, null);
assert.equal(rows[1].reference, '');
assert.equal(rows[1].cost, '540.00 GBP');
assert.deepEqual(rows[1].notes, ['The confirmation number was not in the text, so it is left blank.'], 'the row says what was left blank and why, as the server worded it');
assert.equal(rows[2].when, 'D(2027-03-15), T(19:30)');
assert.equal(rows[2].cost, '');
// a cost with no currency is shown in the trip's
assert.equal(lib.pasteRows({ objects: [{ kind: 'bus', title: 'Bus', details: { cost: 5 } }], notes: [] }, fmt)[0].cost, '5.00 GBP');
// odd answers draw nothing broken
assert.deepEqual(lib.pasteRows(null, fmt), []);
assert.deepEqual(lib.pasteRows({ objects: 'x' }, fmt), []);
assert.equal(lib.pasteRows({ objects: [null, { title: 5 }] }, fmt).length, 2);
assert.deepEqual(lib.pasteRows({ objects: [{ kind: 'flight', title: 'F', details: {} }], notes: ['one sentence'] }, fmt)[0].notes, ['one sentence']);

// only ticked rows that are not added go on
rows[1].checked = false;
assert.deepEqual(lib.pasteChosen(rows).map((r) => r.title), ['TP 1350 Lisbon to London', 'Dinner at Padella']);
rows[0].done = true;
assert.deepEqual(lib.pasteChosen(rows).map((r) => r.title), ['Dinner at Padella'], 'an added row is not added twice');
assert.deepEqual(lib.pasteChosen(null), []);

// the words
assert.equal(lib.pasteAdded(3, 0), '3 bookings added.');
assert.equal(lib.pasteAdded(1, 0), '1 booking added.');
assert.equal(lib.pasteAdded(2, 1), '2 bookings added. 1 booking could not be added.');
assert.deepEqual(lib.pasteError(Object.assign(new Error('There is no booking in this text.'), { status: 422, unread: ['Only an advert.', 5] })), { text: 'There is no booking in this text.', unread: ['Only an advert.'] });
assert.equal(lib.pasteError(Object.assign(new Error('No AI service is chosen for this environment yet. Ask the owner.'), { status: 503 })).text, 'No AI service is chosen for this environment yet. Ask the owner.', 'a refusal is shown as the server worded it');
assert.deepEqual(lib.pasteError(Object.assign(new Error('That text is longer than 30,000 characters; paste one email at a time.'), { status: 413 })).unread, []);
assert.match(lib.pasteError(new Error('')).text, /still in the box/);
assert.match(lib.pasteError(null).text, /still in the box/);

// adding: each ticked row through plan.addObject, cost, currency and travellers as built
function fakeHost(budgetCurrency) {
  const store = new Map();
  const provided = {};
  let clock = 0;
  const objectKey = (r) => [r.module, r.kind, r.id, r.scope, r.space || ''].join('|');
  const host = {
    user: { key: 'u1', name: 'Ann' },
    phases: () => [],
    space: () => ({ budget: { currency: budgetCurrency } }),
    people: async () => [{ key: 'u1', name: 'Ana Silva' }, { key: 'u2', name: 'Ben' }],
    locale: () => ({ currency: 'USD' }),
    phasesCover: async () => null,
    util: { id: () => 'id' + (++clock), objectKey, ymd, parseYmd, word: (k) => k, plain: hostText.plain, localWhen: hostText.localWhen, phaseTimeline: () => [], phaseWords: () => '' },
    storage: {
      get: async (key) => (store.has(key) ? { key, ...store.get(key) } : null),
      list: async (prefix) => [...store].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, ...v })),
      set: async (key, value) => { const version = (store.has(key) ? store.get(key).version : 0) + 1; store.set(key, { value, version }); return { key, value, version }; },
      delete: async (key) => { store.delete(key); },
    },
    on() {},
    objects: { resolve: async () => [], search: async () => [], make: (kind, id) => ({ module: 'travel', kind, id, scope: 'space' }), setLinks: async () => {} },
    files: { link: async () => {}, unlink: async () => {} },
    ui: { toast() {} },
    actions: {
      // As the SDK: provide hands each handler who asked (here the page's own person) and fromLibrary is the real adapter.
      provide: (h) => { for (const [k, fn] of Object.entries(h)) provided[k] = (input, c) => fn(input, c || { from: 'test', by: 'Ann', byKey: 'u1', credit: { name: 'Ann', key: 'u1' } }); },
      fromLibrary: (h, o) => sdkActions.fromLibrary(host, h, { ...o, module: () => ({ id: 'travel', name: 'Planner - Itinerary' }) }),
    },
  };
  return { host, provided };
}
{
  const f = fakeHost('GBP');
  const plan = lib.createPlan(f.host);
  await plan.load();
  await plan.saveTrip({ title: 'London', start: '2027-03-14', end: '2027-03-21', currency: 'GBP' });
  plan.provide();
  const fresh = lib.pasteRows(ANSWER, fmt);
  fresh[1].checked = false; // the stay is left out
  const ids = [];
  for (const r of lib.pasteChosen(fresh)) { const out = await plan.addObject(r.object); ids.push(out.ref.id); r.done = true; }
  const on = plan.list();
  assert.equal(on.length, 2, 'only the ticked rows were added');
  const flight = on.find((i) => i.title === 'TP 1350 Lisbon to London');
  assert.ok(flight && flight.kind === 'journey' && flight.mode === 'flight' && flight.date === '2027-03-14' && flight.time === '07:05');
  assert.equal(flight.confirm, 'QX7RTB');
  assert.equal(flight.estimate, null, 'a cost in another currency is not the Estimated');
  assert.match(flight.notes, /Cost: 412\.8\d? EUR/);
  assert.deepEqual(flight.owners, ['u1'], 'a traveller who is a person of the space becomes one of the people it is for');
  assert.ok(!on.some((i) => i.title === 'The Zetter Townhouse'), 'an unticked row is not added');
  assert.equal(on.find((i) => i.title === 'Dinner at Padella').kind, 'stop');
  // the same path acceptSuggestion's object takes
  const viaAction = await f.provided.acceptSuggestion({ object: ANSWER.objects[1] });
  const stay = plan.list().find((i) => i.title === 'The Zetter Townhouse');
  assert.ok(viaAction.ref && stay && stay.kind === 'stay');
  assert.equal(stay.estimate, 540, 'a cost in the trip\'s currency is the Estimated');
  assert.equal(stay.checkOut, '2027-03-17');
  // Edit: the fields the form is filled with are objectFields' answer for the object, with the trip's currency and people
  const booking = await plan.bookingContext();
  const fields = lib.objectFields(ANSWER.objects[0], f.host.util, undefined, booking);
  assert.equal(fields.title, 'TP 1350 Lisbon to London');
  assert.equal(fields.mode, 'flight');
  assert.equal(fields.confirm, 'QX7RTB');
  assert.deepEqual(fields.owners, ['u1']);
  assert.equal(fields.date, '2027-03-14');
}

// the sheet's markup and wiring, read as code
const html = read('travel.html');
const js = read('travel.js');
for (const id of ['paste-dialog', 'tpl-paste', 'tpl-paste-row', 'paste-text', 'paste-count', 'paste-privacy', 'paste-reading', 'paste-unread', 'paste-rows', 'paste-error', 'paste-done', 'paste-cancel', 'paste-see', 'paste-go']) assert.ok(html.includes(`id="${id}"`), `travel.html has #${id}`);
assert.ok(html.includes('Paste a confirmation email or booking details'), 'the box has its plain label');
assert.ok(html.includes('The text goes only to the AI service the <span data-word="owner"></span> set up. It is not kept.'), 'the privacy line, the owner word from the environment');
assert.ok(!/maxlength/.test(html.slice(html.indexOf('id="paste-text"') - 80, html.indexOf('id="paste-text"') + 200)), 'the box is never cut silently');
assert.ok(js.includes("label: 'Paste a booking'"), 'the add menu offers Paste a booking');
assert.ok(js.includes('host.ai.extract({ text, trip })'), 'Read it calls host.ai.extract with the text and the trip');
assert.ok(js.includes('plan.addObject(r.object)'), 'Add to the trip uses the plan\'s object path');
assert.ok(js.includes("'Add to the trip'") && js.includes("'Read it'"), 'the two buttons');
assert.ok(!/localStorage[^;]*paste|storage\.set[^;]*paste/i.test(js), 'the text is stored nowhere');
const lines = js.split('\n');
const readFn = lines.slice(lines.findIndex((l) => l.includes('async function pasteRead()')), lines.findIndex((l) => l.includes('async function pasteAdd()'))).join('\n');
assert.ok(/catch \(err\) \{[\s\S]*pasteProblem\(err\)[\s\S]*pastePhase\('input'\)/.test(readFn) && !/\.value\s*=/.test(readFn), 'an error goes back to the box and never clears the text');
const sheet = read('travel-lib-paste.css');
assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(sheet), 'the sheet\'s stylesheet has no colour of its own');

// the manifest: the ai hook, optional
const manifest = JSON.parse(fs.readFileSync(new URL('../module.json', import.meta.url), 'utf8'));
assert.deepEqual(manifest.hooks, { ai: 'optional' });

console.log('check-travel-paste: ok');
