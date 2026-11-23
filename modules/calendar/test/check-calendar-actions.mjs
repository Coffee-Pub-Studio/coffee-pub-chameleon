#!/usr/bin/env node
/*
 * check-calendar-actions.mjs -- the Calendar's actions library (src/calendar-lib-actions.js, ACTION_HANDLERS), run the two
 * ways it is carried out (plan-agent-edit-delete.md, decision 4, step 2): through the server's runner (its worker process
 * and vm, then its outcomeOf check) and through the SDK's page adapter (host.actions.fromLibrary) on a stand-in host, both
 * from tools/module-actions-harness.mjs, expecting the same answer. Then createEvent with notes, updateEvent (only the fields
 * given, a copy refused), and reminders: any whole number of minutes from 0 to 40320 (28 days), in the action and in the
 * form (its presets, then Other with a number and minutes, hours or days), and the notification's words. Exits 1 on failure.
 */
process.env.TZ = 'America/Chicago';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { both, onRunner, library } from '../../../tools/module-actions-harness.mjs';

let n = 0;
const test = async (name, fn) => { try { await fn(); n += 1; } catch (e) { process.exitCode = 1; console.error(`FAIL ${name}\n${e.stack || e}`); } };
async function same(action, input, world) {
  const r = await both('calendar', action, input, world, { name: 'Calendar', kinds: ['event'] });
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
const refuses = async (action, input, world, words) => assert.equal((await same(action, input, world)).refused, words);
const written = (r, key) => (r.writes.find((w) => w.key === key) || {}).value;
const SPACE = { id: 's1', name: 'Lisbon 2027' };
const world = (rows = {}, extra = {}) => ({ space: SPACE, rows, ...extra });
const ref = (id) => ({ module: 'calendar', kind: 'event', id, scope: 'space', space: 's1' });
const at = (d, t) => new Date(`${d}T${t}`).toISOString(); // in this process's zone, America/Chicago
const TIMED = { id: 'e1', title: 'Dinner', allDay: false, start: at('2026-11-20', '19:00'), end: at('2026-11-20', '21:00'), desc: 'Table for 4', remind: 60, repeat: null, by: 'Ann' };
const ALLDAY = { id: 'e2', title: 'Market', allDay: true, start: '2026-11-21', end: '2026-11-22', desc: '', remind: null, repeat: { every: 'week', until: '2026-12-31' }, skips: ['2026-11-28'], by: 'Ann' };

await test('createEvent: the same both ways, credited to the asker, times read in the request\'s zone', async () => {
  const r = await same('createEvent', { title: 'Car', date: '2026-11-20', time: '10:00', endTime: '11:30', remind: 90, notes: 'Pick up at the airport' }, world());
  const v = written(r, 'event:n1');
  assert.deepEqual(v, { id: 'n1', title: 'Car', allDay: false, start: at('2026-11-20', '10:00'), end: at('2026-11-20', '11:30'), desc: 'Pick up at the airport', remind: 90, repeat: null, by: 'Claude (agent)' });
  assert.deepEqual(r.ref, ref('n1'));
  const day = await same('createEvent', { title: 'Market', date: '2026-11-21', repeat: 'week' }, world());
  assert.deepEqual([written(day, 'event:n1').allDay, written(day, 'event:n1').start, written(day, 'event:n1').repeat], [true, '2026-11-21', { every: 'week', until: null }]);
});
await test('createEvent in another zone: the clock time is the zone\'s (the server reads in its own)', async () => {
  const r = await onRunner('calendar', 'createEvent', { title: 'Call', date: '2026-11-20', time: '10:00' }, world(), { tz: 'Asia/Tokyo', kinds: ['event'] });
  assert.equal(r.writes[0].value.start, '2026-11-20T01:00:00.000Z');
});
await test('createEvent with an object: an event made of it, with notes, a reminder and a repeat', async () => {
  const object = { kind: 'event', title: 'Concert', details: { starts: '2026-11-15T20:00', ends: '2026-11-15T22:30', address: 'Coliseu' } };
  const r = await same('createEvent', { title: 'Concert', object, remind: 120, notes: 'Doors at 19:30' }, world());
  const v = written(r, 'event:n1');
  assert.deepEqual([v.start, v.end, v.desc, v.remind], [at('2026-11-15', '20:00'), at('2026-11-15', '22:30'), 'Doors at 19:30', 120]);
  await refuses('createEvent', { title: 'Idea', object: { title: 'Idea', content: 'no day' } }, world(), 'that needs a day to go on the calendar');
  await refuses('createEvent', { title: 'Idea', object, remind: 40321 }, world(), 'Say remind as the minutes before it starts: a whole number from 0 (when it starts) to 40320 (28 days).');
});
await test('createEvent: reminders from 0 to 40320 minutes, and the form\'s sentences', async () => {
  for (const m of [0, 1, 15, 45, 60, 1440, 40320]) assert.equal(written(await same('createEvent', { title: 'T', date: '2026-11-20', remind: m }, world()), 'event:n1').remind, m, String(m));
  for (const m of [-1, 40321, 1.5]) await refuses('createEvent', { title: 'T', date: '2026-11-20', remind: m }, world(), 'Say remind as the minutes before it starts: a whole number from 0 (when it starts) to 40320 (28 days).');
  await refuses('createEvent', { title: 'T' }, world(), 'that needs a day to go on the calendar');
  await refuses('createEvent', { title: 'T', date: '2026-11-20', time: '10:00', endTime: '09:00' }, world(), 'The end is before the start.');
  await refuses('createEvent', { title: 'T', date: '2026-11-20', repeat: 'hourly' }, world(), 'Say repeat as day, week, 2weeks, month, year.');
});

await test('updateEvent changes only the fields given', async () => {
  const rows = { 'event:e1': TIMED, 'event:e2': ALLDAY };
  const r = await same('updateEvent', { event: ref('e1'), title: 'Dinner at Ramiro' }, world(rows));
  assert.deepEqual(written(r, 'event:e1'), { ...TIMED, title: 'Dinner at Ramiro', by: 'Claude (agent)' });
  const remind = await same('updateEvent', { event: ref('e1'), remind: 2880 }, world(rows));
  assert.deepEqual(written(remind, 'event:e1'), { ...TIMED, remind: 2880, by: 'Claude (agent)' });
  const notes = await same('updateEvent', { event: ref('e2'), notes: 'Bring bags' }, world(rows));
  assert.deepEqual(written(notes, 'event:e2'), { ...ALLDAY, desc: 'Bring bags', by: 'Claude (agent)' }, 'its repeat, Until and skips kept');
});
await test('updateEvent: a new day moves the end with it; times and all day as the form has them', async () => {
  const rows = { 'event:e1': TIMED, 'event:e2': ALLDAY };
  const moved = await same('updateEvent', { event: ref('e1'), date: '2026-11-22' }, world(rows));
  assert.deepEqual([written(moved, 'event:e1').start, written(moved, 'event:e1').end], [at('2026-11-22', '19:00'), at('2026-11-22', '21:00')]);
  const day = await same('updateEvent', { event: ref('e2'), date: '2026-11-24' }, world(rows));
  assert.deepEqual([written(day, 'event:e2').start, written(day, 'event:e2').end], ['2026-11-24', '2026-11-25'], 'an all-day event keeps its length');
  const timed = await same('updateEvent', { event: ref('e2'), time: '09:00', endTime: '12:00', endDate: '2026-11-21' }, world(rows));
  assert.deepEqual([written(timed, 'event:e2').allDay, written(timed, 'event:e2').start, written(timed, 'event:e2').end], [false, at('2026-11-21', '09:00'), at('2026-11-21', '12:00')]);
  const whole = await same('updateEvent', { event: ref('e1'), allDay: true }, world(rows));
  assert.deepEqual([written(whole, 'event:e1').allDay, written(whole, 'event:e1').start, written(whole, 'event:e1').end], [true, '2026-11-20', null]);
  const every = await same('updateEvent', { event: ref('e2'), repeat: 'week' }, world(rows));
  assert.equal(written(every, 'event:e2'), undefined, 'the same repeat: nothing written');
  const month = await same('updateEvent', { event: ref('e2'), repeat: 'month' }, world(rows));
  assert.deepEqual(written(month, 'event:e2').repeat, { every: 'month', until: null }, 'another repeat starts without an Until');
});
await test('updateEvent: the refusals, in the form\'s words', async () => {
  const rows = { 'event:e1': TIMED, 'event:e2': ALLDAY, 'event:c1': { ...TIMED, id: 'c1', title: 'Flight to Faro' } };
  const summaries = [{ ref: ref('c1'), title: 'Flight to Faro', kind: 'event', copy: true, twinOf: { module: 'travel', kind: 'plan', id: 'p1', scope: 'space', space: 's1' } }, { ref: { module: 'travel', kind: 'plan', id: 'p1', scope: 'space', space: 's1' }, title: 'Flight to Faro', module: { id: 'travel', name: 'Planner - Itinerary' } }];
  const w = world(rows, { summaries });
  await refuses('updateEvent', { event: ref('c1'), title: 'x' }, w, 'That is a copy; change it in Planner - Itinerary.');
  await refuses('updateEvent', { event: ref('zz'), title: 'x' }, w, "That event isn't on the calendar.");
  await refuses('updateEvent', { event: { ...ref('e1'), space: 's2' }, title: 'x' }, w, "That event isn't on the calendar.");
  await refuses('updateEvent', { event: ref('e1') }, w, 'Say what to change: a title, a day, a time, an end, all day, a repeat, a reminder or the notes. Send "" to clear the end, the repeat, the reminder or the notes.');
  await refuses('updateEvent', { event: ref('e1'), endTime: '18:00' }, w, 'The end is before the start.');
  await refuses('updateEvent', { event: ref('e1'), allDay: true, time: '10:00' }, w, 'An all-day event has no times. Leave allDay out, or leave the times out.');
  await refuses('updateEvent', { event: ref('e2'), allDay: false }, w, 'An event that is not all day needs a start time (time), as HH:MM.');
  await refuses('updateEvent', { event: ref('e1'), remind: 40321 }, w, 'Say remind as the minutes before it starts: a whole number from 0 (when it starts) to 40320 (28 days).');
  await refuses('updateEvent', { event: ref('e1'), time: '7pm' }, w, 'Say the time as HH:MM, for example 10:00.');
});

await test('updateEvent: "" clears the end, the repeat, the reminder or the notes (the manifest\'s clears)', async () => {
  const rows = { 'event:e1': TIMED, 'event:e2': ALLDAY };
  const r = await same('updateEvent', { event: ref('e1'), remind: '', notes: '' }, world(rows));
  assert.deepEqual(written(r, 'event:e1'), { ...TIMED, remind: null, desc: '', by: 'Claude (agent)' });
  const end = await same('updateEvent', { event: ref('e1'), endTime: '' }, world(rows));
  assert.deepEqual([written(end, 'event:e1').start, written(end, 'event:e1').end], [TIMED.start, null]);
  const once = await same('updateEvent', { event: ref('e2'), repeat: '', endDate: '' }, world(rows));
  const v = written(once, 'event:e2');
  assert.deepEqual([v.repeat, v.end, v.skips], [null, null, undefined], 'no repeat, so no skips; no last day');
  const m = JSON.parse(fs.readFileSync(new URL('../module.json', import.meta.url), 'utf8'));
  assert.deepEqual(m.actions.provides.find((a) => a.name === 'updateEvent').clears, ['endTime', 'endDate', 'repeat', 'remind', 'notes']);
  assert.equal(m.actions.server, 'src/calendar-lib-actions.js');
});
await test('carried on the server, a reminder waits for a page: marked remindPending and said; a page sets it at once', async () => {
  const made = await onRunner('calendar', 'createEvent', { title: 'Car', date: '2026-11-20', time: '10:00', remind: 90 }, world(), { carrier: 'server', kinds: ['event'], now: Date.parse('2026-11-01T12:00Z') });
  assert.equal(made.writes[0].value.remindPending, true);
  assert.equal(made.data.note, 'The reminder is for Friday 20 November, 8:30 AM, 90 minutes before it starts. Its reminder is set the next time someone who can change events opens the calendar.');
  const none = await onRunner('calendar', 'createEvent', { title: 'Car', date: '2026-11-20' }, world(), { carrier: 'server', kinds: ['event'] });
  assert.deepEqual([none.writes[0].value.remindPending, none.data], [undefined, undefined], 'no reminder: no mark, nothing said');
  const rows = { 'event:e1': { ...TIMED, remindPending: true } };
  const off = await onRunner('calendar', 'updateEvent', { event: ref('e1'), remind: '' }, world(rows), { carrier: 'server', kinds: ['event'] });
  assert.deepEqual([off.writes[0].value.remind, off.writes[0].value.remindPending, off.data], [null, undefined, undefined], 'taken off: no mark');
  const page = await same('updateEvent', { event: ref('e1'), title: 'Dinner, later' }, world(rows));
  assert.equal(written(page, 'event:e1').remindPending, undefined, 'a page sets it itself, so the mark goes');
  const js = fs.readFileSync(new URL('../src/calendar.js', import.meta.url), 'utf8');
  assert.ok(/async function setWaitingReminders[\s\S]*remindPending[\s\S]*applyReminder\(x\.id, x\.ev, \{\}, true\)[\s\S]*delete ev\.remindPending/.test(js), 'the page sets a waiting reminder and takes the mark off');
});

// --- remindAt: the reminder as a clock time --------------------------------------------------------------------------------
// Dates from 2030 on, so a reminder is never in the past on either carrier (both read the real time); a past one, a clock
// change in Pacific time and the server's own note are on the runner, whose `now` and zone a test sets.
const SAY_AT = 'Say remindAt as a date and time, for example 2026-11-24 11:00, or a time on the event\'s day, for example 11:00, 11:00 AM or 9am.';
const lead = (r) => written(r, 'event:n1').remind;
const note = (r) => (r.data || {}).note;
await test('remindAt: every accepted form, for an all-day and a timed event, stored as minutes before', async () => {
  // Thomas's case: 11:00 on 24 November for an all-day event on the 26th. An all-day event reminds from 9:00 on its day, so
  // that is 46 hours (2760 minutes), not the 37 hours counted from midnight (which would have come at 20:00 on the 24th).
  const allDay = { title: 'Market', date: '2030-11-26' };
  for (const at of ['2030-11-24 11:00', '2030-11-24T11:00', '2030-11-24T11:00:00', '2030-11-24 11:00 AM', '2030-11-24 11am', ' 2030-11-24   11:00 ']) {
    assert.equal(lead(await same('createEvent', { ...allDay, remindAt: at }, world())), 2760, at);
  }
  const r = await same('createEvent', { ...allDay, remindAt: '2030-11-24 11:00' }, world());
  assert.equal(note(r), 'The reminder is for Sunday 24 November, 11:00 AM, 46 hours before 9:00 AM on its day (all-day reminders count from 9:00 AM).');
  assert.equal(written(r, 'event:n1').remindAt, undefined, 'nothing new is stored: the form shows the minutes');
  for (const [at, m] of [['8:30', 30], ['08:30', 30], ['8:30 AM', 30], ['8:30am', 30], ['8am', 60], ['8 a.m.', 60], ['12am', 540], ['9:00', 0]]) {
    assert.equal(lead(await same('createEvent', { ...allDay, remindAt: at }, world())), m, `${at} on its own day`);
  }
  assert.equal(note(await same('createEvent', { ...allDay, remindAt: '9:00' }, world())), 'The reminder is for Tuesday 26 November, 9:00 AM (all-day reminders count from 9:00 AM on the day).');
  const timed = { title: 'Dinner', date: '2030-11-26', time: '19:00' };
  for (const [at, m] of [['2030-11-24 11:00', 2 * 1440 + 8 * 60], ['2030-11-26T18:15', 45], ['6pm', 60], ['18:00', 60], ['6:59 PM', 1], ['7pm', 0], ['19:00', 0], ['00:00', 1140]]) {
    assert.equal(lead(await same('createEvent', { ...timed, remindAt: at }, world())), m, at);
  }
  assert.equal(note(await same('createEvent', { ...timed, remindAt: '6pm' }, world())), 'The reminder is for Tuesday 26 November, 6:00 PM, 1 hour before it starts.');
  assert.equal(note(await same('createEvent', { ...timed, remindAt: '19:00' }, world())), 'The reminder is for Tuesday 26 November, 7:00 PM, when it starts.');
  assert.equal(note(await same('createEvent', { ...timed, remindAt: '2030-11-24 11:00' }, world())), 'The reminder is for Sunday 24 November, 11:00 AM, 56 hours before it starts.');
  // Exactly 28 days before is the most: real time, so across the clock change of 3 November it is 20:00 on 29 October.
  assert.equal(lead(await same('createEvent', { ...timed, date: '2030-12-26', remindAt: '2030-11-28 19:00' }, world())), 40320);
  assert.equal(lead(await same('createEvent', { ...timed, remindAt: '2030-10-29 20:00' }, world())), 40320);
  // With an object: the event made of it.
  const object = { kind: 'event', title: 'Concert', details: { starts: '2030-11-15T20:00' } };
  assert.equal(lead(await same('createEvent', { title: 'Concert', object, remindAt: '19:30' }, world())), 30);
});
await test('remindAt: every refusal, in plain sentences', async () => {
  const timed = { title: 'Dinner', date: '2030-11-26', time: '19:00' };
  const allDay = { title: 'Market', date: '2030-11-26' };
  for (const bad of ['tomorrow', '2030-11-24', '25:00', '13pm', '0am', '11.00', '2030-02-30 10:00', '24/11/2030 11:00', 'noon', 'x'.repeat(50)]) {
    await refuses('createEvent', { ...timed, remindAt: bad }, world(), SAY_AT);
  }
  await refuses('createEvent', { ...timed, remindAt: 1100 }, world(), SAY_AT);
  for (const zone of ['2030-11-24T11:00Z', '2030-11-24T11:00:00+01:00', '2030-11-24 11:00 -0800', '11:00Z']) {
    await refuses('createEvent', { ...timed, remindAt: zone }, world(), 'Leave the zone out of remindAt (no Z or +01:00): it is read on the event\'s own clock.');
  }
  await refuses('createEvent', { ...timed, remind: 15, remindAt: '18:00' }, world(), 'Give remind or remindAt, not both.');
  await refuses('createEvent', { ...timed, remind: 0, remindAt: '18:00' }, world(), 'Give remind or remindAt, not both.');
  await refuses('createEvent', { ...timed, remindAt: '19:01' }, world(), 'remindAt is after the event starts (Tuesday 26 November, 7:00 PM); give a time at or before its start.');
  await refuses('createEvent', { ...timed, remindAt: '2030-11-27 08:00' }, world(), 'remindAt is after the event starts (Tuesday 26 November, 7:00 PM); give a time at or before its start.');
  await refuses('createEvent', { ...allDay, remindAt: '9:01' }, world(), 'An all-day event\'s reminder can be at 9:00 AM on its day at the latest; give an earlier time.');
  await refuses('createEvent', { ...timed, date: '2030-12-26', remindAt: '2030-11-28 18:59' }, world(), 'remindAt can be at most 28 days before the event starts.');
  await refuses('createEvent', { ...timed, remindAt: '2030-10-29 19:00' }, world(), 'remindAt can be at most 28 days before the event starts.');
  await refuses('createEvent', { ...allDay, date: '2030-12-26', remindAt: '2030-11-28 08:59' }, world(), 'remindAt can be at most 28 days before the event starts.');
  // The event's own checks still come first.
  await refuses('createEvent', { title: 'T', date: '26 Nov', remindAt: '9am' }, world(), 'Say the date as YYYY-MM-DD, for example 2026-11-20.');
});
await test('remindAt with a repeat: on the first occurrence\'s day, the same lead for every one', async () => {
  const r = await same('createEvent', { title: 'Standup', date: '2030-11-25', time: '09:30', repeat: 'week', remindAt: '9am' }, world());
  assert.deepEqual([lead(r), written(r, 'event:n1').repeat], [30, { every: 'week', until: null }]);
  assert.equal(note(r), 'The reminder is for Monday 25 November, 9:00 AM, 30 minutes before it starts. It comes as long before each repeat.');
  const past = await onRunner('calendar', 'createEvent', { title: 'Standup', date: '2026-11-02', time: '09:30', repeat: 'week', remindAt: '9am' }, world(), { kinds: ['event'], now: Date.parse('2026-11-20T12:00Z') });
  assert.equal(past.data.note, 'The reminder is for Monday 2 November, 9:00 AM, 30 minutes before it starts. That time has passed; the first one is before its next repeat.');
  const once = await onRunner('calendar', 'createEvent', { title: 'Dinner', date: '2026-11-02', time: '19:00', remindAt: '6pm' }, world(), { carrier: 'server', kinds: ['event'], now: Date.parse('2026-11-20T12:00Z') });
  assert.equal(once.data.note, 'The reminder is for Monday 2 November, 6:00 PM, 1 hour before it starts. That time has passed, so it will not come.', 'nothing will come, so nothing waits for a page either');
});
await test('remindAt across a clock change: the lead is the real time between, so it comes at the clock time asked', async () => {
  const LA = { kinds: ['event'], tz: 'America/Los_Angeles', now: Date.parse('2026-10-01T12:00Z') };
  // Pacific time falls back on 1 November 2026: 10:00 on 31 October to 10:00 on 2 November is 49 hours, not 48.
  const fall = await onRunner('calendar', 'createEvent', { title: 'Dinner', date: '2026-11-02', time: '10:00', remindAt: '2026-10-31 10:00' }, world(), LA);
  assert.equal(fall.writes[0].value.remind, 49 * 60);
  assert.equal(fall.data.note, 'The reminder is for Saturday 31 October, 10:00 AM, 49 hours before it starts.');
  assert.equal(new Date(Date.parse(fall.writes[0].value.start) - 49 * 3600e3).toISOString(), '2026-10-31T17:00:00.000Z', '10:00 PDT is 17:00 UTC');
  // An all-day event on 2 November: from 9:00 on its day (17:00 UTC), 11:00 on 31 October (18:00 UTC) is 47 hours.
  const fallDay = await onRunner('calendar', 'createEvent', { title: 'Market', date: '2026-11-02', remindAt: '2026-10-31 11:00' }, world(), LA);
  assert.equal(fallDay.writes[0].value.remind, 47 * 60);
  // It springs forward on 14 March 2027: 10:00 on the 13th to 10:00 on the 15th is 47 hours.
  const spring = await onRunner('calendar', 'createEvent', { title: 'Dinner', date: '2027-03-15', time: '10:00', remindAt: '2027-03-13 10:00' }, world(), LA);
  assert.equal(spring.writes[0].value.remind, 47 * 60);
  assert.equal(spring.data.note, 'The reminder is for Saturday 13 March, 10:00 AM, 47 hours before it starts.');
  const springDay = await onRunner('calendar', 'createEvent', { title: 'Market', date: '2027-03-15', remindAt: '2027-03-13 09:00' }, world(), LA);
  assert.equal(springDay.writes[0].value.remind, 47 * 60);
  // The same on a page and on the server, in this process's zone (Chicago changes its clocks on the same days).
  assert.equal(lead(await same('createEvent', { title: 'Dinner', date: '2030-11-04', time: '10:00', remindAt: '2030-11-02 10:00' }, world())), 49 * 60);
  assert.equal(lead(await same('createEvent', { title: 'Dinner', date: '2030-03-11', time: '10:00', remindAt: '2030-03-09 10:00' }, world())), 47 * 60);
});
await test('updateEvent with remindAt: read against the event as changed; a moved event keeps its lead', async () => {
  const LATER = { ...TIMED, id: 'e3', start: at('2030-11-20', '19:00'), end: at('2030-11-20', '21:00'), remind: 60 };
  const DAY = { ...ALLDAY, id: 'e4', start: '2030-11-21', end: null, repeat: null, skips: undefined };
  delete DAY.skips;
  const rows = { 'event:e3': LATER, 'event:e4': DAY };
  const r = await same('updateEvent', { event: ref('e3'), remindAt: '2030-11-19 19:00' }, world(rows));
  assert.deepEqual(written(r, 'event:e3'), { ...LATER, remind: 1440, by: 'Claude (agent)' });
  assert.equal(note(r), 'The reminder is for Tuesday 19 November, 7:00 PM, 1 day before it starts.');
  const moved = await same('updateEvent', { event: ref('e3'), date: '2030-11-22', remindAt: '5pm' }, world(rows));
  assert.equal(written(moved, 'event:e3').remind, 120, 'a time alone is on the event\'s new day');
  const keep = await same('updateEvent', { event: ref('e3'), date: '2030-11-22' }, world(rows));
  assert.equal(written(keep, 'event:e3').remind, 60, 'no remindAt: the lead stays');
  assert.equal(note(keep), 'The reminder is for Friday 22 November, 6:00 PM, 1 hour before it starts.');
  const day = await same('updateEvent', { event: ref('e4'), remindAt: '2030-11-20 21:00' }, world(rows));
  assert.equal(written(day, 'event:e4').remind, 12 * 60);
  const same1 = await same('updateEvent', { event: ref('e3'), remindAt: '18:00' }, world(rows));
  assert.equal(note(same1), 'That is already so; nothing changed.');
  await refuses('updateEvent', { event: ref('e3'), remind: 30, remindAt: '18:00' }, world(rows), 'Give remind or remindAt, not both.');
  await refuses('updateEvent', { event: ref('e3'), remind: '', remindAt: '18:00' }, world(rows), 'Give remind or remindAt, not both.');
  await refuses('updateEvent', { event: ref('e3'), remindAt: '20:00' }, world(rows), 'remindAt is after the event starts (Wednesday 20 November, 7:00 PM); give a time at or before its start.');
  await refuses('updateEvent', { event: ref('e3'), time: '21:00', remindAt: '21:30' }, world(rows), 'remindAt is after the event starts (Wednesday 20 November, 9:00 PM); give a time at or before its start.');
  await refuses('updateEvent', { event: ref('e4'), remindAt: '10:00' }, world(rows), 'An all-day event\'s reminder can be at 9:00 AM on its day at the latest; give an earlier time.');
  await refuses('updateEvent', { event: ref('e3'), remindAt: '2030-10-01 19:00' }, world(rows), 'remindAt can be at most 28 days before the event starts.');
  await refuses('updateEvent', { event: ref('e3'), remindAt: 'soon' }, world(rows), SAY_AT);
  const server = await onRunner('calendar', 'updateEvent', { event: ref('e3'), remindAt: '18:30' }, world(rows), { carrier: 'server', kinds: ['event'] });
  assert.deepEqual([server.writes[0].value.remind, server.writes[0].value.remindPending], [30, true]);
  assert.equal(server.data.note, 'The reminder is for Wednesday 20 November, 6:30 PM, 30 minutes before it starts. Its reminder is set the next time someone who can change events opens the calendar.');
});

// --- reminders in the form and in the notification --------------------------------------------------------------------
const lib = (() => {
  const src = library('calendar').js;
  return new Function('ymd', 'parseYmd', `${src}\nreturn { remindWords, remindForm, remindFromForm, REMIND_MAX };`)(() => '', (s) => new Date(s));
})();
await test('the notification\'s words are worked out from the minutes', async () => {
  const say = lib.remindWords;
  assert.deepEqual([0, 1, 15, 60, 90, 120, 1440, 2880, 1500, 40320].map(say), ['Starting now', 'Starts in 1 minute', 'Starts in 15 minutes', 'Starts in an hour', 'Starts in 1 hour 30 minutes', 'Starts in 2 hours', 'Starts tomorrow', 'Starts in 2 days', 'Starts in 25 hours', 'Starts in 28 days']);
});
await test('the form: the presets first, Other with a number and minutes, hours or days, up to 28 days', async () => {
  assert.deepEqual(lib.remindForm(null), { choice: '', n: '', unit: 1 });
  assert.deepEqual(lib.remindForm(0), { choice: '0', n: '', unit: 1 });
  assert.deepEqual(lib.remindForm(1440), { choice: '1440', n: '', unit: 1 });
  assert.deepEqual(lib.remindForm(2880), { choice: 'other', n: '2', unit: 1440 });
  assert.deepEqual(lib.remindForm(120), { choice: 'other', n: '2', unit: 60 });
  assert.deepEqual(lib.remindForm(45), { choice: 'other', n: '45', unit: 1 });
  assert.deepEqual(lib.remindFromForm('3', 1440), { minutes: 4320 });
  assert.deepEqual(lib.remindFromForm('28', 1440), { minutes: 40320 });
  assert.deepEqual(lib.remindFromForm('29', 1440), { error: 'A reminder can be at most 28 days before it starts.' });
  for (const bad of ['', '0', '-2', '1.5', 'soon']) assert.deepEqual(lib.remindFromForm(bad, 60), { error: 'Say how long before it starts, as a whole number.' }, bad);
  const html = fs.readFileSync(new URL('../src/calendar.html', import.meta.url), 'utf8');
  for (const v of ['', '0', '15', '60', '1440', 'other']) assert.ok(html.includes(`<option value="${v}">`), `the preset ${v || 'none'}`);
  assert.match(html, /id="f-remind-n" type="number" min="1" max="40320"/);
  assert.match(html, /<select id="f-remind-unit"[^>]*><option value="1">minutes<\/option><option value="60">hours<\/option><option value="1440">days<\/option><\/select>/);
  const js = fs.readFileSync(new URL('../src/calendar.js', import.meta.url), 'utf8');
  assert.ok(js.includes('const label = remindWords(ev.remind);'), 'the notification says the lead time');
  assert.ok(/remindFromForm\(\$\('f-remind-n'\)\.value, Number\(\$\('f-remind-unit'\)\.value\)\)/.test(js), 'save reads Other');
  assert.ok(/async function afterAction[\s\S]*applyReminder\(id, ev, \{\}\)/.test(js), 'a page that carries a request sets its reminder');
});
await test('the manifest: updateEvent and notes, within the caps', async () => {
  const m = JSON.parse(fs.readFileSync(new URL('../module.json', import.meta.url), 'utf8'));
  const act = (name) => m.actions.provides.find((a) => a.name === name);
  assert.deepEqual(act('updateEvent').input, { event: 'ref:calendar:event', title: 'string?', date: 'date?', time: 'string?', endTime: 'string?', endDate: 'date?', allDay: 'boolean?', repeat: 'string?', remind: 'number?', remindAt: 'string?', notes: 'text?' });
  for (const name of ['createEvent', 'updateEvent']) {
    const a = act(name);
    assert.equal(a.input.remindAt, 'string?');
    assert.ok(!a.clears || !a.clears.includes('remindAt'), 'remind "" takes a reminder off; remindAt clears nothing');
    for (const [k, v] of Object.entries(a.inputHints)) assert.ok(v.length <= 200, `${name}.${k}: at most 200 characters`);
    assert.match(a.inputHints.remindAt, /Instead of remind.*2026-11-24 11:00.*9am.*Times are the event's own clock time\./);
    assert.match(a.inputHints.remind, /all-day event counts from 9:00/);
    assert.ok(/^[^.]*\.$/.test(a.description), `${name}: one sentence`);
  }
  assert.match(act('updateEvent').inputHints.remindAt, /Moving the event keeps it as long before\./);
  assert.match(act('updateEvent').inputHints.remind, /A new date keeps the minutes\./);
  assert.equal(act('createEvent').input.notes, 'text?');
  for (const name of ['createEvent', 'updateEvent']) assert.match(act(name).inputHints.remind, /40320/);
  const lib2 = library('calendar').js;
  for (const name of m.actions.provides.filter((a) => !a.local).map((a) => a.name)) assert.match(lib2, new RegExp(`\\n    ${name}\\(input, ctx\\) \\{`), `${name} is a handler in the library`);
});

if (!process.exitCode) console.log(`check-calendar-actions: OK (${n} tests)`);
