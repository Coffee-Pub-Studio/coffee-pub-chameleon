// check-calendar-agent-event.mjs: what an agent may ask of createEvent (the fields the add-event form has) and that the
// form and the action share one rule for when an event starts and ends. Read as code with the real lib, run in a fixed zone.
process.env.TZ = 'America/Chicago';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const lib = new Function('ymd', 'parseYmd', `${read('modules/calendar/src/calendar-lib.js')}\nreturn { eventFromInput, eventSpan, remindAnchor, REMIND_ALLDAY_FROM };`)(() => '', (s) => new Date(s));
const { eventFromInput: make, eventSpan, remindAnchor } = lib;
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
test('remind is any whole number of minutes from 0 (when it starts) to 28 days', () => {
  for (const m of [0, 1, 5, 15, 45, 60, 90, 1440, 2880, 40320]) assert.equal(make({ title: 'T', date: day, remind: m }).remind, m, String(m));
});
test('notes become the event\'s details', () => {
  assert.equal(make({ title: 'T', date: day, notes: '  Gate B12\nBring the passports  ' }).desc, 'Gate B12\nBring the passports');
  assert.equal(make({ title: 'T', date: day, notes: 'x'.repeat(700) }).desc.length, 600);
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
  refuses({ remind: -1 }, 'Say remind as the minutes before it starts: a whole number from 0 (when it starts) to 40320 (28 days).');
  refuses({ remind: 40321 }, 'Say remind as');
  refuses({ remind: 2.5 }, 'Say remind as');
  refuses({ allDay: 'yes' }, 'true or false');
  assert.ok(make({ title: 'T', date: '2026-13-01' }).error.includes('Say the date as YYYY-MM-DD'));
  assert.ok(make({ title: 'T', date: '20 Nov' }).error.includes('Say the date as YYYY-MM-DD'));
  assert.ok(make({ title: '  ', date: day }).error);
});
test('the form and the action share eventSpan', () => {
  const js = read('modules/calendar/src/calendar.js');
  assert.ok(/eventSpan\(\{ date, time: \$\('f-time'\)\.value/.test(js), 'save() uses eventSpan');
  const actions = read('modules/calendar/src/calendar-lib-actions.js');
  assert.ok(actions.includes('made = eventFromInput(input, ctx.tz);'), 'createEvent uses eventFromInput, in the request\'s zone');
  assert.ok(js.includes('host.actions.fromLibrary(ACTION_HANDLERS, { after: afterAction })'), 'the page carries the library\'s createEvent');
  assert.ok(!/new Date\(`\$\{date\}T\$\{time\}`\)/.test(js), 'no second copy of the start rule in the page');
  assert.deepEqual(eventSpan({ date: day, time: '', endDate: '', endTime: '', allDay: false }), { allDay: false, start: at(day, '19:00'), end: null }, 'the form\'s 19:00 default');
});
test('the manifest declares the inputs, the old ones unchanged', () => {
  const m = JSON.parse(read('modules/calendar/module.json'));
  const a = m.actions.provides.find((x) => x.name === 'createEvent');
  assert.deepEqual(a.input, { title: 'string', date: 'date?', ref: 'ref?', object: 'object?', time: 'string?', endTime: 'string?', endDate: 'date?', allDay: 'boolean?', repeat: 'string?', remind: 'number?', remindAt: 'string?', notes: 'text?' });
  assert.ok(a.inputHints.remindAt.length <= 200 && /own clock time/.test(a.inputHints.remindAt), 'remindAt says whose clock');
  assert.ok(Object.keys(a.input).length <= 20, 'the host reads at most twenty inputs');
  assert.ok(/40320/.test(a.inputHints.remind), 'the hint gives the range');
  assert.deepEqual(a.needs, ['date']);
  assert.ok(a.description.length <= 200 && /[.]$/.test(a.description));
  assert.deepEqual(Object.keys(a.inputHints).sort(), Object.keys(a.input).filter((k) => k !== 'ref' && k !== 'object').sort());
  assert.ok(/HH:MM/.test(a.inputHints.time) && /all-day/.test(a.inputHints.time));
});
test('one anchor for a lead: a timed event\'s start, an all-day event\'s 9:00, for the page, the form and remindAt', () => {
  assert.equal(lib.REMIND_ALLDAY_FROM, 9 * 3600e3);
  assert.equal(remindAnchor(false, at(day, '19:00')).toISOString(), at(day, '19:00'));
  assert.equal(remindAnchor(true, day).toISOString(), at(day, '09:00'), 'all day: 9:00 in this zone');
  assert.equal(remindAnchor(true, day, 'Asia/Tokyo').toISOString(), '2026-11-20T00:00:00.000Z', 'or in the request\'s zone');
  // On the day the clocks go back (Chicago, 1 November 2026) it is midnight plus nine real hours, as the page has always set it.
  assert.equal(remindAnchor(true, '2026-11-01').toISOString(), '2026-11-01T14:00:00.000Z');
  const js = read('modules/calendar/src/calendar.js');
  assert.ok(js.includes('const nineAm = ev.allDay ? REMIND_ALLDAY_FROM : 0;'), 'the page\'s schedule counts from the same 9:00');
  assert.ok(/function remindWhen\(\)[\s\S]*remindAnchor\(allDay, start\)[\s\S]*`Reminds \$\{/.test(js), 'the form says when it reminds, from the same anchor');
  assert.ok(/\$\('f-remind-hint'\)\.textContent = [^;]*remindWhen|const when = remindWhen\(\);\s*\$\('f-remind-hint'\)\.textContent/.test(js), 'in the reminder\'s own hint line');
  const actions = read('modules/calendar/src/calendar-lib-actions.js');
  assert.ok(/function calRemindAtLead[\s\S]*remindAnchor\(made\.allDay, made\.start/.test(actions), 'remindAt counts from it too');
  assert.ok(/function calReminderNote[\s\S]*remindAnchor\(ev\.allDay, ev\.start/.test(actions), 'and the answer says the moment from it');
});
if (!process.exitCode) console.log(`check-calendar-agent-event: OK (${n} tests)`);
