// check-calendar-agent-event.mjs: what an agent may ask of createEvent (the fields the add-event form has) and that the
// form and the action share one rule for when an event starts and ends. Read as code with the real lib, run in a fixed zone.
process.env.TZ = 'America/Chicago';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const lib = new Function('ymd', 'parseYmd', `${read('modules/calendar/src/calendar-lib.js')}\nreturn { eventFromInput, eventSpan };`)(() => '', (s) => new Date(s));
const { eventFromInput: make, eventSpan } = lib;
let n = 0;
const test = (name, fn) => { try { fn(); n += 1; } catch (e) { console.error('FAIL', name, '\n ', e.message); process.exitCode = 1; } };
const day = '2026-11-20';
const at = (d, t) => new Date(`${d}T${t}`).toISOString();

test('a date alone is an all-day event, as before', () => {
  assert.deepEqual(make({ title: 'Pick up Michelle\'s car', date: day }), { title: 'Pick up Michelle\'s car', allDay: true, start: day, end: null, desc: '', remind: null, repeat: null });
});
test('a time makes a timed event at that clock time in this zone', () => {
  const e = make({ title: 'Car', date: day, time: '10:00' });
  assert.equal(e.allDay, false);
  assert.equal(e.start, at(day, '10:00'));
  assert.equal(new Date(e.start).getHours(), 10);
  assert.equal(e.end, null);
});
test('a time with an end time', () => {
  const e = make({ title: 'Car', date: day, time: '10:00', endTime: '11:30' });
  assert.equal(e.end, at(day, '11:30'));
});
test('a multi-day timed event, and a multi-day all-day event', () => {
  assert.equal(make({ title: 'T', date: day, time: '22:00', endDate: '2026-11-21', endTime: '01:00' }).end, at('2026-11-21', '01:00'));
  const e = make({ title: 'T', date: day, endDate: '2026-11-23' });
  assert.deepEqual([e.allDay, e.start, e.end], [true, day, '2026-11-23']);
  assert.equal(make({ title: 'T', date: day, endDate: day }).end, null, 'an end on the first day is no end');
});
test('allDay stated: true is all day, false with a time is timed', () => {
  assert.equal(make({ title: 'T', date: day, allDay: true }).allDay, true);
  assert.equal(make({ title: 'T', date: day, allDay: false, time: '09:15' }).allDay, false);
});
test('empty optional fields count as left out', () => {
  assert.equal(make({ title: 'T', date: day, time: '', endTime: null, endDate: '', allDay: null }).allDay, true);
});
test('repeat and remind are the form\'s choices', () => {
  const e = make({ title: 'T', date: day, time: '10:00', repeat: '2weeks', remind: 15 });
  assert.deepEqual([e.repeat, e.remind], [{ every: '2weeks', until: null }, 15]);
  assert.equal(make({ title: 'T', date: day, remind: 0 }).remind, 0);
});
const refuses = (input, words) => { const e = make({ title: 'T', date: day, ...input }); assert.ok(e.error && e.error.includes(words), `${JSON.stringify(input)} -> ${JSON.stringify(e)}`); };
test('each refusal says it in plain words', () => {
  refuses({ time: '10am' }, 'Say the time as HH:MM, for example 10:00.');
  refuses({ time: '24:00' }, 'HH:MM');
  refuses({ time: '9:00' }, 'HH:MM');
  refuses({ time: '10:00', endTime: '5pm' }, 'Say the end time as HH:MM');
  refuses({ time: '10:00', endTime: '09:00' }, 'The end is before the start.');
  refuses({ endDate: '2026-11-19' }, 'The end is before the start.');
  refuses({ time: '10:00', endDate: '2026-11-19' }, 'The end is before the start.');
  refuses({ time: '10:00', allDay: true }, 'all-day event has no times');
  refuses({ endTime: '11:00', allDay: true }, 'all-day event has no times');
  refuses({ endTime: '11:00' }, 'Give the start time');
  refuses({ allDay: false }, 'needs a start time');
  refuses({ endDate: '2026-02-30' }, 'Say the end date as YYYY-MM-DD');
  refuses({ repeat: 'hourly' }, 'Say repeat as');
  refuses({ remind: 5 }, 'Say remind as');
  refuses({ allDay: 'yes' }, 'true or false');
  assert.ok(make({ title: 'T', date: '2026-13-01' }).error.includes('Say the date as YYYY-MM-DD'));
  assert.ok(make({ title: 'T', date: '20 Nov' }).error.includes('Say the date as YYYY-MM-DD'));
  assert.ok(make({ title: '  ', date: day }).error);
});
test('the form and the action share eventSpan', () => {
  const js = read('modules/calendar/src/calendar.js');
  assert.ok(/eventSpan\(\{ date, time: \$\('f-time'\)\.value/.test(js), 'save() uses eventSpan');
  assert.ok(js.includes('eventFromInput(input)') && js.includes('createEventOn(made.title, made.start, input.ref, made)'), 'createEvent uses eventFromInput and createEventOn');
  assert.ok(!/new Date\(`\$\{date\}T\$\{time\}`\)/.test(js), 'no second copy of the start rule in the page');
  assert.deepEqual(eventSpan({ date: day, time: '', endDate: '', endTime: '', allDay: false }), { allDay: false, start: at(day, '19:00'), end: null }, 'the form\'s 19:00 default');
});
test('the manifest declares the inputs, the old ones unchanged', () => {
  const m = JSON.parse(read('modules/calendar/module.json'));
  const a = m.actions.provides.find((x) => x.name === 'createEvent');
  assert.deepEqual(a.input, { title: 'string', date: 'date?', ref: 'ref?', object: 'object?', time: 'string?', endTime: 'string?', endDate: 'date?', allDay: 'boolean?', repeat: 'string?', remind: 'number?' });
  assert.ok(Object.keys(a.input).length <= 10, 'the host reads at most ten inputs');
  assert.deepEqual(a.needs, ['date']);
  assert.ok(a.description.length <= 200 && /HH:MM/.test(a.description) && /all day/.test(a.description));
});
if (!process.exitCode) console.log(`check-calendar-agent-event: OK (${n} tests)`);
