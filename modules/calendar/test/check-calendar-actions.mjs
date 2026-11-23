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
  await refuses('updateEvent', { event: ref('e1') }, w, 'Say what to change: a title, a day, a time, an end, all day, a repeat, a reminder or the notes.');
  await refuses('updateEvent', { event: ref('e1'), endTime: '18:00' }, w, 'The end is before the start.');
  await refuses('updateEvent', { event: ref('e1'), allDay: true, time: '10:00' }, w, 'An all-day event has no times. Leave allDay out, or leave the times out.');
  await refuses('updateEvent', { event: ref('e2'), allDay: false }, w, 'An event that is not all day needs a start time (time), as HH:MM.');
  await refuses('updateEvent', { event: ref('e1'), remind: 40321 }, w, 'Say remind as the minutes before it starts: a whole number from 0 (when it starts) to 40320 (28 days).');
  await refuses('updateEvent', { event: ref('e1'), time: '7pm' }, w, 'Say the time as HH:MM, for example 10:00.');
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
  assert.deepEqual(act('updateEvent').input, { event: 'ref:calendar:event', title: 'string?', date: 'date?', time: 'string?', endTime: 'string?', endDate: 'date?', allDay: 'boolean?', repeat: 'string?', remind: 'number?', notes: 'text?' });
  assert.equal(act('createEvent').input.notes, 'text?');
  for (const name of ['createEvent', 'updateEvent']) assert.match(act(name).inputHints.remind, /40320/);
  const lib2 = library('calendar').js;
  for (const name of m.actions.provides.filter((a) => !a.local).map((a) => a.name)) assert.match(lib2, new RegExp(`\\n    ${name}\\(input, ctx\\) \\{`), `${name} is a handler in the library`);
});

if (!process.exitCode) console.log(`check-calendar-actions: OK (${n} tests)`);
