#!/usr/bin/env node
/*
 * check-travel-actions.mjs -- the Itinerary's actions library (src/travel-lib-actions.js, ACTION_HANDLERS), run the two ways
 * it is carried out (plan-agent-edit-delete.md, decision 4, step 2): through the server's runner (its worker process and vm,
 * then its outcomeOf check) and through the SDK's page adapter (host.actions.fromLibrary) on a stand-in host, both from
 * tools/module-actions-harness.mjs. Each case asks both and expects the same answer: the same writes, pointer and note, or
 * the same refusal. Then what each action does: addStop, addToDay, acceptSuggestion (a fully typed flight), setStopPlace and
 * updatePlan (only the fields given, an object as a patch, the editor's checks and sentences). Exits 1 on any failure.
 */
process.env.TZ = 'America/Chicago';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { both, onPage, onRunner } from '../../../tools/module-actions-harness.mjs';

let n = 0;
const test = async (name, fn) => { try { await fn(); n += 1; } catch (e) { process.exitCode = 1; console.error(`FAIL ${name}\n${e.stack || e}`); } };
const byKey = (w) => [...(w || [])].sort((a, b) => a.key.localeCompare(b.key));
// Both ways, the same answer; the page's.
async function same(action, input, world) {
  const r = await both('travel', action, input, world, { name: 'Planner - Itinerary', kinds: ['trip', 'plan'] });
  assert.ok(!r.runner.fault, `${action}: the runner faulted (${r.runner.fault})`);
  if (r.page.refused !== undefined || r.runner.refused !== undefined) {
    assert.equal(r.runner.refused, r.page.refused, `${action}: the same refusal`);
    return r.page;
  }
  assert.deepEqual(byKey(r.runner.writes), byKey(r.page.writes), `${action}: the same writes`);
  assert.deepEqual(r.runner.ref, r.page.ref, `${action}: the same pointer`);
  assert.deepEqual(r.runner.data, r.page.data, `${action}: the same note`);
  return r.page;
}
const refuses = async (action, input, world, words) => {
  const r = await same(action, input, world);
  assert.equal(r.refused, words);
};
const written = (r, key) => (r.writes.find((w) => w.key === key) || {}).value;

const SPACE = { id: 's1', name: 'Lisbon 2027' };
const TRIP = { title: 'Lisbon', start: '2026-10-01', end: '2026-10-03', v: 2 };
const world = (rows = {}, extra = {}) => ({ space: SPACE, rows: { 'trip:main': TRIP, ...rows }, people: [{ key: 'u1', name: 'Ann' }, { key: 'u2', name: 'Bo' }], ...extra });
const entry = (id) => ({ module: 'travel', kind: 'plan', id, scope: 'space', space: 's1' });
const PLACE = { module: 'maps', kind: 'place', id: 'p1', scope: 'space', space: 's1' };
const placeSummary = { ref: PLACE, title: 'Castelo de S. Jorge', subtitle: 'R. de Santa Cruz do Castelo, Lisboa', kind: 'place' };
// A flight already on the plan, typed, and a plain stop with a flight in its notes (the real-work test that started this).
const FLIGHT = { kind: 'journey', mode: 'flight', title: 'To Faro', date: '2026-10-02', time: '09:00', minutes: 60, category: 'travel', operator: 'TAP', number: 'TP 1901', fromCode: 'LIS', toCode: 'FAO', terminal: '1', gate: '', seat: '12A', travelClass: '', confirm: 'ABC123', notes: 'Window', order: 1000, by: 'Ann' };
const NOTE_STOP = { kind: 'stop', title: 'Flight home', date: '2026-10-03', time: null, category: 'do', notes: 'UA 945 LIS to EWR, terminal 1, gate 14, seat 22C', order: 1000, by: 'Ann' };
const STAY = { kind: 'stay', type: 'hotel', title: 'Casa', date: '2026-10-01', checkOut: '2026-10-03', category: 'stay', order: 2000, by: 'Ann' };

await test('addStop: a plain stop, the same both ways, credited to the asker', async () => {
  const r = await same('addStop', { title: 'Castle', date: '2026-10-02', time: '10:00', minutes: 90, cost: 15 }, world());
  const v = written(r, 'plan:n1');
  assert.deepEqual([v.kind, v.title, v.date, v.time, v.minutes, v.estimate, v.by], ['stop', 'Castle', '2026-10-02', '10:00', 90, 15, 'Claude (agent)']);
  assert.deepEqual(r.ref, entry('n1'));
  assert.equal(r.writes.length, 1, 'a day on the trip leaves the trip as it is');
});
await test('addStop: a day after the trip stretches it, in the same request', async () => {
  const r = await same('addStop', { title: 'Sintra', date: '2026-10-05' }, world());
  assert.deepEqual([written(r, 'trip:main').start, written(r, 'trip:main').end], ['2026-10-01', '2026-10-05']);
});
await test('addStop: a day that would make the plan longer than 60 days is said, and the stop kept', async () => {
  const r = await same('addStop', { title: 'Far', date: '2027-03-01' }, world());
  assert.ok(written(r, 'plan:n1'));
  assert.equal(r.data.note, 'A plan can be at most 60 days long, so that day is left off the plan.');
});
await test('addStop at a saved place takes its name and address; the refusals are plain', async () => {
  const r = await same('addStop', { title: 'Castle', date: '2026-10-02', placeRef: PLACE }, world({}, { summaries: [placeSummary] }));
  assert.deepEqual([written(r, 'plan:n1').place, written(r, 'plan:n1').address], ['Castelo de S. Jorge', 'R. de Santa Cruz do Castelo, Lisboa']);
  await refuses('addStop', { title: 'Castle', placeRef: PLACE }, world(), "That place can't be found, or you can't see it.");
  await refuses('addStop', { title: 'Castle', placeRef: PLACE, ref: entry('x') }, world(), 'Give a link or a place, not both.');
  await refuses('addStop', { title: 'Castle', minutes: 0 }, world(), 'Minutes must be a whole number from 1 to 10080.');
  await refuses('addStop', { title: 'Castle', endTime: '16:00' }, world(), 'An end time needs a start time too.');
});
await test('addStop and addToDay with a pointer keep the day given', async () => {
  const ev = { module: 'calendar', kind: 'event', id: 'e1', scope: 'space', space: 's1' };
  const a = await same('addStop', { title: 'Dinner', ref: ev, date: '2026-10-02' }, world());
  assert.deepEqual([written(a, 'plan:n1').kind, written(a, 'plan:n1').date], ['link', '2026-10-02']);
  const b = await same('addToDay', { object: ev, date: '2026-10-03' }, world());
  assert.deepEqual([written(b, 'plan:n1').kind, written(b, 'plan:n1').date, written(b, 'plan:n1').ref.id], ['link', '2026-10-03', 'e1']);
});
await test('acceptSuggestion with an object: every flight field typed, the same both ways', async () => {
  const object = { kind: 'flight', title: 'Home', details: { airline: 'United', number: 'UA945', from: { code: 'LIS', name: 'Lisbon' }, to: { code: 'EWR', name: 'Newark' }, departs: '2026-10-03T11:05', arrives: '2026-10-03T14:20', terminal: '1', gate: '14', seat: '22C, 22D', class: 'Economy', reference: 'QX7Y2', cost: 412.8, travellers: ['Ann', 'Cy'] } };
  const r = await same('acceptSuggestion', { title: 'Home', object }, world());
  const v = written(r, 'plan:n1');
  assert.deepEqual([v.kind, v.mode, v.operator, v.number, v.fromCode, v.from, v.toCode, v.to, v.date, v.time, v.arrives, v.terminal, v.gate, v.seat, v.travelClass, v.confirm, v.estimate, v.owners],
    ['journey', 'flight', 'United', 'UA945', 'LIS', 'Lisbon', 'EWR', 'Newark', '2026-10-03', '11:05', '2026-10-03T14:20', '1', '14', '22C, 22D', 'Economy', 'QX7Y2', 412.8, ['u1']]);
  assert.equal(v.notes, 'Travellers: Cy', 'a traveller who is not one of the people is a notes line');
});
await test('acceptSuggestion: kinds, and the refusal for one it does not take', async () => {
  const r = await same('acceptSuggestion', { title: 'Casa', kind: 'hotel', date: '2026-10-01' }, world());
  assert.deepEqual([written(r, 'plan:n1').kind, written(r, 'plan:n1').type], ['stay', 'hotel']);
  await refuses('acceptSuggestion', { title: 'Odd', kind: 'nonsense' }, world(), 'That kind is not one the itinerary takes. Use flight, train, bus, ferry, car, hotel, restaurant, cafe, bar, winery, sight, museum, attraction, tour, show, event or note.');
  const far = await same('acceptSuggestion', { title: 'Later', kind: 'sight', date: '2027-06-01' }, world());
  assert.equal(written(far, 'plan:n1').date, null, 'outside the plan: under Unscheduled');
  assert.match(far.data.note, /outside the plan's 60 days, so it is under Unscheduled/);
});
await test('setStopPlace: at a place, off it, and the refusals', async () => {
  const rows = { 'plan:s1': { ...NOTE_STOP }, 'plan:f1': { ...FLIGHT } };
  const on = await same('setStopPlace', { stop: entry('s1'), placeRef: PLACE }, world(rows, { summaries: [placeSummary] }));
  assert.deepEqual([written(on, 'plan:s1').placeRef.id, written(on, 'plan:s1').place, written(on, 'plan:s1').address], ['p1', 'Castelo de S. Jorge', 'R. de Santa Cruz do Castelo, Lisboa']);
  const off = await same('setStopPlace', { stop: entry('s1') }, world({ 'plan:s1': written(on, 'plan:s1') }));
  assert.deepEqual([written(off, 'plan:s1').placeRef, written(off, 'plan:s1').place], [null, 'Castelo de S. Jorge'], 'its name stays');
  await refuses('setStopPlace', { stop: entry('f1'), placeRef: PLACE }, world(rows, { summaries: [placeSummary] }), 'Only a stop can be at a place.');
  await refuses('setStopPlace', { stop: entry('zz') }, world(rows), "That stop isn't on the itinerary.");
});

// --- updatePlan -------------------------------------------------------------------------------------------------------
await test('updatePlan changes only the fields given', async () => {
  const rows = { 'plan:f1': { ...FLIGHT } };
  const r = await same('updatePlan', { entry: entry('f1'), title: 'To Faro, early' }, world(rows));
  const after = written(r, 'plan:f1');
  assert.equal(after.title, 'To Faro, early');
  for (const k of Object.keys(FLIGHT)) if (k !== 'title') assert.deepEqual(after[k], FLIGHT[k], k);
  assert.deepEqual(r.ref, entry('f1'));
  assert.equal(r.writes.length, 1);
  const none = await same('updatePlan', { entry: entry('f1'), notes: 'Window' }, world(rows));
  assert.deepEqual([none.writes, none.data.note], [[], 'That is already so; nothing changed.'], 'the same value: nothing written');
});
await test('updatePlan: an object patch sets the typed flight fields it gives, and only those', async () => {
  const rows = { 'plan:f1': { ...FLIGHT } };
  const r = await same('updatePlan', { entry: entry('f1'), object: { kind: 'flight', title: 'To Faro', details: { terminal: '2', gate: 'B12', class: 'Business', to: { code: 'FAO', name: 'Faro' } } } }, world(rows));
  const v = written(r, 'plan:f1');
  assert.deepEqual([v.terminal, v.gate, v.travelClass, v.toCode, v.to], ['2', 'B12', 'Business', 'FAO', 'Faro']);
  for (const k of ['date', 'time', 'minutes', 'operator', 'number', 'fromCode', 'seat', 'confirm', 'notes']) assert.deepEqual(v[k], FLIGHT[k], k);
  // A departure alone (a time) stays on the entry's own day; a later departure day moves the ticket's arrival along.
  const t = await same('updatePlan', { entry: entry('f1'), object: { kind: 'flight', title: 'To Faro', details: { departs: '07:30' } } }, world(rows));
  assert.deepEqual([written(t, 'plan:f1').date, written(t, 'plan:f1').time], ['2026-10-02', '07:30']);
});
await test('updatePlan: a plain stop with a flight in its notes becomes a typed flight (the kind changes as the editor allows)', async () => {
  const rows = { 'plan:s1': { ...NOTE_STOP } };
  const object = { kind: 'flight', title: 'Flight home', details: { airline: 'United', number: 'UA 945', from: { code: 'LIS' }, to: { code: 'EWR' }, departs: '2026-10-03T11:05', terminal: '1', gate: '14', seat: '22C' } };
  const r = await same('updatePlan', { entry: entry('s1'), object, notes: 'Booked by Ann.' }, world(rows));
  const v = written(r, 'plan:s1');
  assert.deepEqual([v.kind, v.mode, v.category, v.operator, v.number, v.fromCode, v.toCode, v.time, v.terminal, v.gate, v.seat, v.notes], ['journey', 'flight', 'travel', 'United', 'UA 945', 'LIS', 'EWR', '11:05', '1', '14', '22C', 'Booked by Ann.']);
  // Without notes, the old notes stay for the agent to rewrite.
  const keep = await same('updatePlan', { entry: entry('s1'), object }, world(rows));
  assert.equal(written(keep, 'plan:s1').notes, NOTE_STOP.notes);
});
await test('updatePlan: details with no field of their own are notes lines; cost and travellers as when added', async () => {
  const rows = { 'plan:f1': { ...FLIGHT } };
  const r = await same('updatePlan', { entry: entry('f1'), object: { kind: 'flight', title: 'To Faro', details: { cabin: 'Front', cost: 99, travellers: ['Bo'] } } }, world(rows));
  const v = written(r, 'plan:f1');
  assert.deepEqual([v.estimate, v.owners, v.notes], [99, ['u2'], 'Window\n\nCabin: Front']);
});
await test('updatePlan: flat fields, a place, and the editor\'s sentences', async () => {
  const rows = { 'plan:f1': { ...FLIGHT }, 'plan:s1': { ...NOTE_STOP }, 'plan:h1': { ...STAY }, 'plan:b1': { ...FLIGHT, title: 'Back', legOf: 'f1', date: '2026-10-03' }, 'plan:l1': { kind: 'link', ref: { module: 'calendar', kind: 'event', id: 'e', scope: 'space', space: 's1' }, title: '', order: 1 } };
  const w = world(rows, { summaries: [placeSummary] });
  const end = await same('updatePlan', { entry: entry('f1'), endTime: '10:30' }, w);
  assert.equal(written(end, 'plan:f1').minutes, 90, 'an end time is measured from the entry\'s own start');
  const moved = await same('updatePlan', { entry: entry('s1'), date: '2026-10-02', time: '18:00', placeRef: PLACE }, w);
  assert.deepEqual([written(moved, 'plan:s1').date, written(moved, 'plan:s1').time, written(moved, 'plan:s1').place], ['2026-10-02', '18:00', 'Castelo de S. Jorge']);
  await refuses('updatePlan', { entry: entry('zz'), title: 'x' }, w, "That object isn't on the itinerary any more.");
  await refuses('updatePlan', { entry: entry('l1'), title: 'x' }, w, 'That entry shows something kept in another module; change it there.');
  await refuses('updatePlan', { entry: entry('f1') }, w, 'Say what to change: a title, a day, a time, the notes, the cost, a place, or an object with its details. Send "" to clear the time, minutes, cost or notes.');
  await refuses('updatePlan', { entry: entry('h1'), minutes: 30 }, w, 'A stay has no length, so leave out minutes and the end time.');
  await refuses('updatePlan', { entry: entry('h1'), date: '2026-10-03' }, w, 'Check out is on or before check in.');
  await refuses('updatePlan', { entry: entry('f1'), placeRef: PLACE }, w, 'Only a stop can be at a place. Leave the place out for a journey, a stay or a note.');
  await refuses('updatePlan', { entry: entry('f1'), object: { kind: 'hotel', title: 'To Faro', details: { roomType: 'Twin' } } }, w, 'Only a journey other than a car can be a round trip. Choose one, or turn off Round trip first.');
  await refuses('updatePlan', { entry: entry('f1'), time: '9am' }, w, 'The time must be a clock time as HH:MM, 24-hour, like 14:30.');
});
await test('updatePlan: "" clears the time, minutes, cost or notes (the manifest\'s clears); a field left out is kept', async () => {
  const rows = { 'plan:f1': { ...FLIGHT, estimate: 80 } };
  const r = await same('updatePlan', { entry: entry('f1'), time: '', notes: '' }, world(rows));
  const v = written(r, 'plan:f1');
  assert.deepEqual([v.time, v.notes, v.minutes, v.estimate, v.terminal], [null, '', 60, 80, '1']);
  const c = await same('updatePlan', { entry: entry('f1'), minutes: '', cost: '' }, world(rows));
  assert.deepEqual([written(c, 'plan:f1').minutes, written(c, 'plan:f1').estimate, written(c, 'plan:f1').time], [null, null, '09:00']);
  await refuses('updatePlan', { entry: entry('f1'), time: '', endTime: '10:30' }, world(rows), 'An end time needs a start time too.');
  const m = JSON.parse(fs.readFileSync(new URL('../module.json', import.meta.url), 'utf8'));
  const act = m.actions.provides.find((a) => a.name === 'updatePlan');
  assert.deepEqual(act.clears, ['time', 'minutes', 'cost', 'notes']);
  assert.equal(act.patch, true);
  assert.equal(m.actions.server, 'src/travel-lib-actions.js');
});
await test('with phases: the main phase\'s end is answered as phaseEnd, the same on a page and on the server, and nothing waits', async () => {
  const phased = world({}, { phases: [{ id: 'trip', main: true }], bands: [{ id: 'trip', label: 'Trip', main: true, start: '2026-10-01', end: '2026-10-03', dated: true }] });
  const calls = [];
  const page = await onPage('travel', 'addStop', { title: 'Sintra', date: '2026-10-05' }, phased, { name: 'Planner - Itinerary', calls });
  assert.deepEqual(page.writes.map((w) => w.key), ['plan:n1'], 'no trip write with phases');
  assert.equal(page.data, undefined, 'nothing to say');
  assert.deepEqual(page.effects.phaseEnd, { date: '2026-10-05' });
  assert.deepEqual(calls, [{ call: 'phasesCover', day: '2026-10-05' }], 'the page\'s adapter moves it through the host');
  for (const carrier of ['server', undefined]) {
    const server = await onRunner('travel', 'addStop', { title: 'Sintra', date: '2026-10-05' }, phased, { carrier, kinds: ['trip', 'plan'] });
    assert.equal(server.fault, undefined, `the runner takes it (${server.fault})`);
    assert.deepEqual(server.writes.map((w) => w.key), ['plan:n1'], 'nothing of the space\'s is written by the module');
    assert.equal(server.data, undefined, 'no note that a person must add days');
    assert.deepEqual(server.effects.phaseEnd, page.effects.phaseEnd, 'the same answer as the page');
  }
  const inside = await both('travel', 'addStop', { title: 'Castle', date: '2026-10-02' }, phased, { name: 'Planner - Itinerary', carrier: 'server', kinds: ['trip', 'plan'] });
  assert.deepEqual([inside.page.effects.phaseEnd, inside.runner.effects.phaseEnd, inside.runner.data], [undefined, undefined, undefined], 'a day on the plan: nothing moves');
  // An edit that moves an entry past the last day, and an object handed in, answer it too; a day past 60 does not.
  const moved = await both('travel', 'updatePlan', { entry: entry('f1'), date: '2026-10-08' }, { ...phased, rows: { ...phased.rows, 'plan:f1': { ...FLIGHT } } }, { name: 'Planner - Itinerary', carrier: 'server', kinds: ['trip', 'plan'] });
  assert.deepEqual([moved.page.effects.phaseEnd, moved.runner.effects.phaseEnd], [{ date: '2026-10-08' }, { date: '2026-10-08' }]);
  const handed = await both('travel', 'acceptSuggestion', { title: 'Museum', kind: 'museum', date: '2026-10-04' }, phased, { name: 'Planner - Itinerary', carrier: 'server', kinds: ['trip', 'plan'] });
  assert.deepEqual([handed.page.effects.phaseEnd, handed.runner.effects.phaseEnd], [{ date: '2026-10-04' }, { date: '2026-10-04' }]);
  const far = await both('travel', 'addStop', { title: 'Far', date: '2027-03-01' }, phased, { name: 'Planner - Itinerary', carrier: 'server', kinds: ['trip', 'plan'] });
  assert.deepEqual([far.page.effects.phaseEnd, far.runner.effects.phaseEnd], [undefined, undefined], 'past the plan\'s 60 days: the end stays');
  assert.equal(far.runner.data.note, far.page.data.note);
  // Without the right to move the space's dates the page's request stands, and its note says why (as the server's does).
  const kept = await onPage('travel', 'addStop', { title: 'Sintra', date: '2026-10-05' }, { ...phased, refuseEffect: (kind) => kind === 'phasesCover' }, { name: 'Planner - Itinerary' });
  assert.deepEqual(kept.writes.map((w) => w.key), ['plan:n1'], 'the stop is kept');
  assert.equal(kept.data.note, 'The last day was not moved to 2026-10-05: you may not do this');
  // The library leaves nothing for a page, and no action that can add or move an entry lacks the manifest's word.
  const lib = fs.readFileSync(new URL('../src/travel-lib-actions.js', import.meta.url), 'utf8');
  assert.ok(!/carrier/.test(lib.replace(/\/\/.*$/gm, '')), 'the library does not ask who carries it');
  const m = JSON.parse(fs.readFileSync(new URL('../module.json', import.meta.url), 'utf8'));
  assert.deepEqual(m.actions.provides.filter((a) => a.phaseEnd).map((a) => a.name), ['addStop', 'addToDay', 'acceptSuggestion', 'updatePlan']);
});
await test('updatePlan: a later day stretches the trip, as an add does', async () => {
  const r = await same('updatePlan', { entry: entry('f1'), date: '2026-10-06' }, world({ 'plan:f1': { ...FLIGHT } }));
  assert.equal(written(r, 'trip:main').end, '2026-10-06');
});

// --- the page adapter's own rules (public/sdk/host.js host.actions.fromLibrary) -----------------------------------------
await test('the page adapter: one refused write puts back the ones before it, and says the server\'s sentence', async () => {
  const w = world({}, { refuseWrite: (key) => key === 'trip:main' });
  const r = await onPage('travel', 'addStop', { title: 'Sintra', date: '2026-10-05' }, w, { name: 'Planner - Itinerary' });
  assert.equal(r.refused, 'you may not change this');
});
await test('the page adapter holds a handler to the runner\'s rules', async () => {
  const handlers = {
    many: () => ({ writes: Array.from({ length: 11 }, (_, i) => ({ key: `plan:${i}`, value: {} })) }),
    del: () => ({ writes: [{ key: 'plan:x', delete: true }] }),
    away: () => ({ writes: [{ key: 'plan:x', value: {}, module: 'todo' }] }),
    notOwn: () => ({ ref: { module: 'todo', kind: 'task', id: 'x', scope: 'space', space: 's1' } }),
    extra: () => ({ writes: [], other: 1 }),
    throws: () => { throw new Error('No.\nReally   no.'); },
  };
  const ask = async (a) => (await onPage('travel', a, {}, world(), { handlers, name: 'Planner - Itinerary' })).refused;
  assert.equal(await ask('many'), 'Planner - Itinerary could not carry that out: it tried to change more than 10 things at once.');
  assert.equal(await ask('del'), 'Planner - Itinerary could not carry that out: it tried to delete something, which needs a person\'s approval.');
  assert.equal(await ask('away'), 'Planner - Itinerary could not carry that out: it tried to write outside its own data here.');
  assert.equal(await ask('notOwn'), 'Planner - Itinerary could not carry that out: it pointed at something that is not its own here.');
  assert.equal(await ask('extra'), 'Planner - Itinerary could not carry that out: it answered something the server can\'t use.');
  assert.equal(await ask('throws'), 'No. Really no.', 'a refusal is one line');
});

// --- the manifest ----------------------------------------------------------------------------------------------------
await test('the manifest: updatePlan, the object hint names the flight fields, within the caps', async () => {
  const m = JSON.parse(fs.readFileSync(new URL('../module.json', import.meta.url), 'utf8'));
  const act = (name) => m.actions.provides.find((a) => a.name === name);
  assert.deepEqual(act('updatePlan').input, { entry: 'ref:travel:plan', object: 'object?', title: 'string?', date: 'date?', time: 'string?', minutes: 'number?', endTime: 'string?', cost: 'number?', notes: 'text?', placeRef: 'ref:maps:place?' });
  assert.equal(act('updatePlan').effect, 'write');
  assert.deepEqual(act('updatePlan').takes, act('acceptSuggestion').takes);
  for (const name of ['acceptSuggestion', 'updatePlan']) for (const f of ['airline', 'number', 'terminal', 'gate', 'seat', 'class', 'reference', 'cost', 'travellers']) assert.match(act(name).inputHints.object, new RegExp(f), `${name}: ${f}`);
  assert.ok(m.actions.provides.length <= 16);
  for (const a of m.actions.provides) assert.ok(Object.keys(a.input).length <= 20);
  const lib = fs.readFileSync(new URL('../src/travel-lib-actions.js', import.meta.url), 'utf8');
  const agentActions = m.actions.provides.filter((a) => !a.local && a.effect !== 'delete').map((a) => a.name).sort();
  assert.deepEqual(agentActions, ['acceptSuggestion', 'addStop', 'addToDay', 'setStopPlace', 'updatePlan']);
  for (const name of agentActions) assert.match(lib, new RegExp(`\\n    ${name}\\(input, ctx\\) \\{`), `${name} is a handler in the library`);
});

if (!process.exitCode) console.log(`check-travel-actions: OK (${n} tests)`);
