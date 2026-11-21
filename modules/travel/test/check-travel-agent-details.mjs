#!/usr/bin/env node
/*
 * check-travel-agent-details.mjs -- the optional details a flat addStop / acceptSuggestion request may carry (time, minutes,
 * endTime, cost, reference), against the plan with a small stand-in for the SDK. Exits 1 on any failure.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = new URL('../src/', import.meta.url);
const read = (n) => fs.readFileSync(new URL(n, src), 'utf8');
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const lib = new Function('ymd', 'parseYmd', `${read('travel-lib.js')}\n${read('travel-lib-object.js')}\n${read('travel-lib-plan.js')}\nreturn { createPlan };`)(ymd, parseYmd);
const hostText = (() => {
  const win = { addEventListener() {}, location: { search: '' } };
  win.parent = win;
  new Function('window', 'document', fs.readFileSync(new URL('../../../public/sdk/host.js', import.meta.url), 'utf8'))(win, { createElement: (tag) => ({ tag }) });
  return win.hostText;
})();

function fakeHost() {
  const store = new Map();
  const provided = {};
  let clock = 0;
  const objectKey = (r) => [r.module, r.kind, r.id, r.scope, r.space || ''].join('|');
  const host = {
    user: { key: 'u1', name: 'Ann' },
    phases: () => [],
    space: () => null,
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
    actions: { provide: (h) => Object.assign(provided, h) },
  };
  return { host, provided };
}

const f = fakeHost();
const plan = lib.createPlan(f.host);
await plan.load();
await plan.saveTrip({ title: 'Cabin', start: '2026-10-01', end: '2026-10-03' });
plan.provide();
const { addStop, acceptSuggestion } = f.provided;
const find = (title) => plan.list().find((i) => i.title === title);
const refused = (fn, words) => assert.rejects(fn, (e) => new RegExp(words, 'i').test(e.message));

// no new inputs: as before
await addStop({ title: 'Plain', date: '2026-10-01', notes: 'n' });
await acceptSuggestion({ title: 'Plain flight', kind: 'flight', date: '2026-10-01', content: 'window' });
{
  const s = find('Plain');
  assert.equal(s.kind, 'stop'); assert.equal(s.time, null); assert.equal(s.minutes, null); assert.equal(s.estimate, null); assert.equal(s.notes, 'n');
  const fl = find('Plain flight');
  assert.equal(fl.mode, 'flight'); assert.equal(fl.time, null); assert.equal(fl.estimate, null); assert.equal(fl.notes, 'window');
}

// time only; time with minutes; end time
await addStop({ title: 'Walk', date: '2026-10-01', time: '14:30' });
assert.equal(find('Walk').time, '14:30'); assert.equal(find('Walk').minutes, null);
await addStop({ title: 'Tour', date: '2026-10-01', time: '09:00', minutes: 90 });
assert.equal(find('Tour').time, '09:00'); assert.equal(find('Tour').minutes, 90);
await addStop({ title: 'Lunch', date: '2026-10-01', time: '12:00', endTime: '13:15' });
assert.equal(find('Lunch').minutes, 75);
await addStop({ title: 'Night', date: '2026-10-01', time: '23:00', endTime: '01:00' });
assert.equal(find('Night').minutes, 120);

// cost: stored as the form's Estimated cost, not as the paid amount
await addStop({ title: 'Tickets', date: '2026-10-02', cost: 120.5 });
assert.equal(find('Tickets').estimate, 120.5); assert.equal(find('Tickets').cost, null);
await acceptSuggestion({ title: 'Free walk', kind: 'sight', date: '2026-10-02', cost: 0 });
assert.equal(find('Free walk').estimate, null);

// a transport kind, a stay, a kind the plan treats as a stop
await acceptSuggestion({ title: 'LIS to FAO', kind: 'flight', date: '2026-10-01', time: '14:30', minutes: 150, cost: 89, reference: 'ABC123', content: 'window seat', place: 'Lisbon' });
{
  const fl = find('LIS to FAO');
  assert.equal(fl.kind, 'journey'); assert.equal(fl.mode, 'flight'); assert.equal(fl.category, 'travel');
  assert.equal(fl.time, '14:30'); assert.equal(fl.minutes, 150); assert.equal(fl.estimate, 89); assert.equal(fl.confirm, 'ABC123');
  assert.equal(fl.notes, 'window seat'); assert.equal(fl.place, 'Lisbon');
  // the same fields the form (objectFields) fills for a flight
  const viaObject = plan.fromObject({ title: 'x', kind: 'flight', date: '2026-10-01', details: { departs: '14:30', minutes: 150, reference: 'ABC123' } });
  for (const k of ['kind', 'mode', 'category', 'time', 'minutes', 'confirm']) assert.equal(fl[k], viaObject[k], k);
}
await acceptSuggestion({ title: 'Inn', kind: 'hotel', date: '2026-10-01', time: '15:00', cost: 200 });
assert.equal(find('Inn').kind, 'stay'); assert.equal(find('Inn').time, '15:00'); assert.equal(find('Inn').estimate, 200);
await acceptSuggestion({ title: 'Remember', kind: 'note', date: '2026-10-01', time: '08:00' });
assert.equal(find('Remember').time, '08:00');

// each refusal, with nothing added
const before = plan.list().length;
await refused(() => addStop({ title: 'x', time: '25:00' }), 'HH:MM');
await refused(() => addStop({ title: 'x', time: '2:30pm' }), 'HH:MM');
await refused(() => addStop({ title: 'x', time: 1430 }), 'HH:MM');
await refused(() => addStop({ title: 'x', cost: -5 }), 'cost');
await refused(() => addStop({ title: 'x', cost: '12' }), 'cost');
await refused(() => addStop({ title: 'x', minutes: 12.5 }), 'whole number');
await refused(() => addStop({ title: 'x', minutes: 0 }), 'whole number');
await refused(() => addStop({ title: 'x', minutes: 1e6 }), 'whole number');
await refused(() => addStop({ title: 'x', time: '10:00', minutes: 30, endTime: '11:00' }), 'not both');
await refused(() => addStop({ title: 'x', endTime: '11:00' }), 'start time');
await refused(() => addStop({ title: 'x', time: '10:00', endTime: '10:00' }), 'different');
await refused(() => addStop({ title: 'x', time: '10:00', endTime: '9am' }), 'HH:MM');
await refused(() => acceptSuggestion({ title: 'x', kind: 'hotel', minutes: 30 }), 'no length');
assert.equal(plan.list().length, before);

// an object's booking details (plan-assistant-reboot.md, decision 3): the trip's currency (the budget's, else the plan's, else
// the server's) and the space's people, read when it is handed in
{
  const g = fakeHost();
  let budget = null;
  g.host.space = () => (budget ? { budget: { currency: budget } } : null);
  g.host.locale = () => ({ currency: 'USD' });
  g.host.people = async () => [{ key: 'ana', name: 'Ana Lima' }, { key: 'ben', name: 'Ben' }];
  const p2 = lib.createPlan(g.host);
  await p2.load();
  await p2.saveTrip({ title: 'Lisbon', start: '2026-10-01', end: '2026-10-03' });
  p2.provide();
  const hand = (title, details) => g.provided.acceptSuggestion({ title, object: { kind: 'hotel', title, date: '2026-10-01', details } });
  const got = (title) => p2.list().find((i) => i.title === title);
  await hand('In dollars', { cost: 412.8, currency: 'USD', travellers: ['Ana Lima', 'Cleo Park'] });
  assert.deepEqual([got('In dollars').estimate, got('In dollars').owners, got('In dollars').notes], [412.8, ['ana'], 'Travellers: Cleo Park'], 'the server\'s currency when the trip names none');
  budget = 'eur';
  await hand('In euros', { cost: 99, currency: 'EUR', travellers: ['Ben'] });
  await hand('Still dollars', { cost: 50, currency: 'USD' });
  assert.deepEqual([got('In euros').estimate, got('In euros').owners], [99, ['ben']], 'the budget\'s currency');
  assert.deepEqual([got('Still dollars').estimate, got('Still dollars').notes], [null, 'Cost: 50 USD']);
  g.host.people = async () => { throw new Error('offline'); };
  await hand('No people', { travellers: ['Ben'] });
  assert.deepEqual([got('No people').owners, got('No people').notes], [[], 'Travellers: Ben'], 'the people unknown: a notes line');
}

// the manifest declares the inputs, within the host's ten-field limit
const manifest = JSON.parse(read('../module.json'));
const act = (name) => manifest.actions.provides.find((a) => a.name === name);
for (const k of ['time', 'minutes', 'endTime', 'cost']) assert.ok(act('addStop').input[k], `addStop ${k}`);
for (const k of ['time', 'minutes', 'cost', 'reference']) assert.ok(act('acceptSuggestion').input[k], `acceptSuggestion ${k}`);
for (const name of ['addStop', 'acceptSuggestion']) {
  assert.ok(Object.keys(act(name).input).length <= 10, `${name} has at most 10 inputs`);
  assert.match(act(name).inputHints.time, /HH:MM, 24-hour/);
  for (const k of Object.keys(act(name).inputHints)) assert.ok(act(name).input[k], `${name} hint ${k} is a declared input`);
}
for (const k of ['title', 'date', 'notes', 'ref']) assert.ok(act('addStop').input[k], `addStop keeps ${k}`);
for (const k of ['title', 'kind', 'content', 'place', 'date', 'object']) assert.ok(act('acceptSuggestion').input[k], `acceptSuggestion keeps ${k}`);

console.log('check-travel-agent-details: OK');
