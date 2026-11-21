#!/usr/bin/env node
/*
 * check-ai-extract.mjs -- bookings read out of pasted text (plan-assistant-reboot.md, step 2: extract@1, POST
 * /api/spaces/:id/ai/extract, host.ai.extract), against the stand-in model (tools/fake-model.mjs) only. No outside service:
 * nothing here shows how well a real model reads a booking (that is tools/eval-extract.mjs, step 3, run by Thomas).
 *
 *   - The schema: one shape per kind joined with anyOf, no provenance, strict (every property required, nothing else).
 *   - Reading an answer: structured, text, fenced, inside other words, cut off mid-object, a bare list, nothing readable.
 *   - The server's checks (server/ai-extract.js): a reference, number or time not in the text left blank and said; a year not
 *     written worked out from the trip, else the next one from today, else left blank and said; a flight's times against both
 *     airports' zones (server/airports.json), its time in the air filled in; check-out before check-in and a day far from the
 *     trip said; a kind not offered, no title and a field in the wrong shape dropped or blanked and listed for the repair; at
 *     most 20 kept; nothing invented.
 *   - The call (server/ai.js extract): one call with no tools and no history; one repair with the problems listed, then the
 *     second answer; a second answer that does not read keeps the first; neither reading is a 502; prompt-then-parse for a
 *     service that refuses the schema; one call in the usage, every round's tokens; a record with counts and no text.
 *   - Through a throwaway server: the request and response shapes, every refusal sentence (sign-in, guest, role, not in the
 *     space, another space, AI off in the space, AI not set up, the allowance, the rate limit, the text's size, the trip, the
 *     kinds, a module without the ai hook), an agent refused, and the text kept nowhere: not in Chat, the call records, the
 *     usage, the server's output or any file under DATA_DIR.
 *   - The golden set (step 3): every sample in tools/golden/extract/ is well formed, and one with a stand-in answer reads back as
 *     its expected objects. The folder may be empty until step 3 adds samples.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startFakeModel } from './fake-model.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const prompts = require('../server/prompts');
const { extractSchema } = require('../server/prompts/object-rule.js');
const { readExtract } = require('../server/prompts/parse.js');
const { reviewExtract, yearFor } = require('../server/ai-extract.js');
const { TRAVEL_KINDS, cleanObject } = require('../server/object-format.js');
const { Ai: RealAi, AiError, EXTRACT_UNREADABLE } = require('../server/ai.js');
const TEST_SECRETS_KEY = require('node:crypto').randomBytes(32);
class Ai extends RealAi {
  constructor(dir, env, hosts, managed, secretsKey = () => TEST_SECRETS_KEY, secrets) { super(dir, env, hosts, managed, secretsKey, secrets); }
}

let count = 0;
const failures = [];
const test = async (name, fn) => {
  try { await fn(); count += 1; } catch (err) { failures.push(`${name}: ${err.stack || err.message}`); }
};
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `check-ai-extract-${name}-`));
const WORDS = { object: 'object', objects: 'objects', space: 'trip' };
const TRIP = { name: 'London', first: '2027-03-14', last: '2027-03-21', timeZone: 'Europe/London', currency: 'GBP' };
const TODAY = { date: '2026-11-21', weekday: 'Saturday', timeZone: 'Europe/Lisbon' };
const ctx = (text, extra = {}) => ({ text, trip: TRIP, today: TODAY.date, kinds: TRAVEL_KINDS, words: WORDS, ...extra });
const review = (objects, text, extra) => reviewExtract({ read: true, objects, unread: [], cut: false }, ctx(text, extra));
const FLIGHT_TEXT = 'Your booking QX7RTB is confirmed.\nTAP Air Portugal TP 1350, Lisbon (LIS) 07:05 to London Heathrow (LHR) 09:50, 14 Mar 2027.\nPassenger: Ana Silva. Total 412.80 EUR.';
const flight = (details = {}, extra = {}) => ({ icon: 'plane', kind: 'flight', title: 'TP 1350 Lisbon to London', date: '2027-03-14', details: { airline: 'TAP Air Portugal', number: 'TP 1350', from: { code: 'LIS', name: 'Lisbon' }, to: { code: 'LHR', name: 'London Heathrow' }, departs: '2027-03-14T07:05', arrives: '2027-03-14T09:50', reference: 'QX7RTB', cost: 412.8, currency: 'EUR', travellers: ['Ana Silva'], ...details }, ...extra });

// --- the schema ----------------------------------------------------------------------------------------------------------
await test('the schema is { objects, unread }, one shape per kind joined with anyOf, no provenance, strict', () => {
  const s = extractSchema(TRAVEL_KINDS);
  assert.deepEqual(s.required, ['objects', 'unread']);
  assert.equal(s.additionalProperties, false);
  const shapes = s.properties.objects.items.anyOf;
  assert.ok(shapes.length > 5, 'one shape per group of kinds');
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'object' && node.properties) {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), 'every property required (strict)');
    }
    for (const v of Object.values(node)) walk(v);
  };
  walk(s);
  for (const shape of shapes) {
    assert.ok(!shape.properties.basis && !shape.properties.sources, 'no basis or sources');
    const kinds = shape.properties.kind.enum || [];
    if (kinds.includes('flight')) assert.ok(shape.properties.details.anyOf[0].properties.airline && !shape.properties.details.anyOf[0].properties.checkIn, 'a flight carries only its own fields');
  }
  assert.deepEqual(prompts.render(prompts.template('extract'), { text: 'x', trip: { name: 'T' }, today: TODAY, kinds: ['hotel'], words: WORDS }, { structured: true }).schema, extractSchema(['hotel']));
  assert.ok(!prompts.TASKS.includes('extract'), 'not a task a module names on POST /api/modules/:id/ai');
});

// --- reading an answer ---------------------------------------------------------------------------------------------------
await test('an answer is read from structured output, plain JSON, a fence, other words, a cut list or a bare list', () => {
  const o = { title: 'A', kind: 'hotel', details: { checkIn: null }, tags: null };
  assert.deepEqual(readExtract({ structured: { objects: [o], unread: ['One line.', 7, '<b>Two</b>'] }, text: '' }), { read: true, objects: [{ title: 'A', kind: 'hotel', details: {} }], unread: ['One line.', 'Two'], cut: false });
  assert.equal(readExtract({ text: JSON.stringify({ objects: [o], unread: [] }) }).objects.length, 1);
  assert.equal(readExtract({ text: `Here:\n\`\`\`json\n${JSON.stringify({ objects: [o, o], unread: [] })}\n\`\`\`` }).objects.length, 2);
  assert.equal(readExtract({ text: `Sure. ${JSON.stringify({ objects: [o], unread: [] })} Done.` }).objects.length, 1);
  const cut = readExtract({ text: '{"objects":[{"title":"A","content":"x"},{"title":"B","con', finish: 'length' });
  assert.deepEqual([cut.read, cut.objects.length, cut.cut], [true, 1, true]);
  assert.equal(readExtract({ text: JSON.stringify([o]) }).objects.length, 1);
  for (const bad of [{ text: 'No bookings, sorry.' }, { text: '' }, { structured: { answer: 'x' }, text: '{"answer":"x"}' }, { text: '[1,2' }]) assert.equal(readExtract(bad).read, false, JSON.stringify(bad));
});

// --- the server's checks -------------------------------------------------------------------------------------------------
await test('a flight as written is kept whole, with its time in the air worked out from both airports\' zones', () => {
  const r = review([flight()], FLIGHT_TEXT);
  assert.deepEqual([r.readable, r.dropped, r.problems], [true, 0, []]);
  assert.equal(r.objects.length, 1);
  assert.deepEqual(r.notes, [[]]);
  const d = r.objects[0].details;
  assert.equal(r.objects[0].basis, 'imported');
  assert.deepEqual([d.number, d.reference, d.departs, d.arrives, d.minutes, d.cost, d.currency], ['TP 1350', 'QX7RTB', '2027-03-14T07:05', '2027-03-14T09:50', 165, 412.8, 'EUR']);
  assert.ok(!('seat' in d) && !('gate' in d), 'a field the text does not give stays blank');
});

await test('a reference, number or time not in the text is left blank and said; spaces, dashes and case are ignored', () => {
  let r = review([flight({ reference: 'ZZ9ZZZ', number: 'BA 999' })], FLIGHT_TEXT);
  const d = r.objects[0].details;
  assert.ok(!('reference' in d) && !('number' in d));
  assert.deepEqual(r.notes[0], ['The confirmation number was not in the text, so it is left blank.', 'The flight number was not in the text, so it is left blank.']);
  r = review([flight({ reference: 'qx7-rtb', number: 'TP1350' })], FLIGHT_TEXT);
  assert.deepEqual([r.objects[0].details.reference, r.objects[0].details.number, r.notes[0]], ['qx7-rtb', 'TP1350', []]);
  r = review([flight({ departs: '2027-03-14T08:05' })], FLIGHT_TEXT);
  assert.equal(r.objects[0].details.departs, '2027-03-14', 'the day stays, the time goes');
  assert.ok(r.notes[0].includes('The departure time was not in the text, so it is left blank.'));
  // Times written the other common ways.
  for (const written of ['7:05am', '7.05 a.m.', '07h05', '0705']) {
    const t = FLIGHT_TEXT.replace('07:05', written);
    assert.equal(review([flight()], t).objects[0].details.departs, '2027-03-14T07:05', written);
  }
  assert.equal(review([flight({ arrives: '2027-03-14T21:50' })], FLIGHT_TEXT.replace('09:50', '9:50pm')).objects[0].details.arrives, '2027-03-14T21:50');
  // A train's number and a restaurant's reference are checked the same way.
  r = review([{ kind: 'train', title: 'Eurostar 9014', details: { number: '9014', reference: 'NOPE11' } }], 'Eurostar 9014, booking ZKP4QD');
  assert.deepEqual([r.objects[0].details.number, r.objects[0].details.reference], ['9014', undefined]);
});

await test('a year not written is worked out from the trip, else the next one from today, else left blank and said', () => {
  const text = 'Eurostar 9014, 17 March, 08:01 to 11:20. Booking ZKP4QD.';
  const train = (d, date) => ({ kind: 'train', title: 'Eurostar 9014', date, details: { number: '9014', departs: d, arrives: d.slice(0, 10) + 'T11:20', reference: 'ZKP4QD' } });
  // 0000, as the model is told to write it.
  let r = review([train('0000-03-17T08:01', '0000-03-17')], text);
  assert.deepEqual([r.objects[0].date, r.objects[0].details.departs, r.objects[0].details.arrives], ['2027-03-17', '2027-03-17T08:01', '2027-03-17T11:20']);
  // A year the model wrote that the text does not hold is treated as not written.
  r = review([train('2026-03-17T08:01', '2026-03-17')], text);
  assert.equal(r.objects[0].date, '2027-03-17');
  // A year the text writes is kept, even outside the trip (and said, the day being far from it).
  r = review([train('2025-03-17T08:01', '2025-03-17')], text.replace('17 March', '17 March 2025'));
  assert.equal(r.objects[0].date, '2025-03-17');
  assert.ok(r.notes[0].includes("This is more than 60 days from the trip's dates."));
  // Written as two digits.
  assert.equal(review([train('2025-03-17T08:01', '2025-03-17')], text.replace('17 March', '17/03/25')).objects[0].date, '2025-03-17');
  // No trip dates: the next one from today.
  r = review([train('0000-03-17T08:01', '0000-03-17')], text, { trip: { name: 'London' } });
  assert.equal(r.objects[0].date, '2027-03-17');
  assert.equal(yearFor('12', '01', { name: 'x' }, '2026-11-21'), '2026');
  assert.equal(yearFor('11', '20', { name: 'x' }, '2026-11-21'), '2027');
  // Not clear: a day that is in no year it could be (29 February in a year without one).
  r = review([{ kind: 'hotel', title: 'Hotel Marlow', date: '0000-02-29', details: { checkIn: '0000-02-29T15:00', reference: '88412093' } }], 'Hotel Marlow, 29 February, 15:00, booking 88412093', { trip: { name: 'x' } });
  assert.ok(!('date' in r.objects[0]) && !('checkIn' in r.objects[0].details));
  assert.ok(r.notes[0].includes('The year of the check-in was not in the text and could not be worked out, so it is left blank.'));
  assert.ok(r.notes[0].includes('The year of the date was not in the text and could not be worked out, so it is left blank.'));
});

await test("a flight's arrival is checked in both airports' zones: impossible times leave it blank and are said", () => {
  // A red-eye across midnight, New York to London in November: 22:00 EST to 10:00 GMT the next day is 7 hours.
  const text = 'BA 178 JFK 22:00 10 Nov 2027 - LHR 10:00 11 Nov 2027. Ref ABC123';
  const ba = (arrives) => ({ kind: 'flight', title: 'BA 178', details: { number: 'BA 178', from: { code: 'JFK' }, to: { code: 'LHR' }, departs: '2027-11-10T22:00', arrives, reference: 'ABC123' } });
  let r = review([ba('2027-11-11T10:00')], text, { trip: { name: 'x', first: '2027-11-10', last: '2027-11-20' } });
  assert.deepEqual([r.objects[0].details.arrives, r.objects[0].details.minutes, r.notes[0]], ['2027-11-11T10:00', 420, []]);
  // The arrival written on the departure day: before it leaves.
  r = review([ba('2027-11-10T10:00')], text, { trip: { name: 'x', first: '2027-11-10', last: '2027-11-20' } });
  assert.ok(!('arrives' in r.objects[0].details) && !('minutes' in r.objects[0].details));
  assert.deepEqual(r.notes[0], ['The arrival time does not fit the departure in JFK and LHR time, so it is left blank.']);
  // Over 20 hours.
  r = review([ba('2027-11-12T10:00')], text.replace('11 Nov', '12 Nov'), { trip: { name: 'x', first: '2027-11-10', last: '2027-11-20' } });
  assert.ok(!('arrives' in r.objects[0].details));
  // A time in the air the model gave is kept; an unknown airport is not checked.
  r = review([{ ...ba('2027-11-11T10:00'), details: { ...ba('2027-11-11T10:00').details, minutes: 425, to: { code: 'QQQ' } } }], text, { trip: { name: 'x', first: '2027-11-10', last: '2027-11-20' } });
  assert.deepEqual([r.objects[0].details.minutes, r.objects[0].details.arrives], [425, '2027-11-11T10:00']);
});

await test('check-out before check-in and a day far from the trip are said on the row', () => {
  const text = 'Hotel Marlow, check-in 20 March 2027 15:00, check-out 14 March 2027 11:00. Booking 88412093.';
  const r = review([{ kind: 'hotel', title: 'Hotel Marlow', date: '2027-03-20', details: { checkIn: '2027-03-20T15:00', checkOut: '2027-03-14T11:00', reference: '88412093' } }], text);
  assert.deepEqual(r.notes[0], ['Check-out is before check-in.']);
  const far = review([{ kind: 'hotel', title: 'Hotel Marlow', date: '2027-08-20', details: { checkIn: '2027-08-20T15:00', reference: '88412093' } }], text.replace('20 March 2027', '20 August 2027'));
  assert.deepEqual(far.notes[0], ["This is more than 60 days from the trip's dates."]);
});

await test('what does not read is dropped or blanked, said, and listed for the repair; nothing is invented', () => {
  const r = review([
    { kind: 'hotel', details: { checkIn: '2027-03-14' } },
    { kind: 'spaceship', title: 'Moon', content: 'x' },
    'just a string',
    { kind: 'hotel', title: 'No details' },
    { kind: 'hotel', title: 'Hotel Marlow', details: { checkIn: '14 March', reference: '88412093', guests: 'two' } },
  ], 'Hotel Marlow 88412093, 14 March 2027');
  assert.equal(r.objects.length, 1);
  assert.equal(r.dropped, 4);
  assert.deepEqual(r.reasons, [
    'A booking was left out: it has no title.',
    '"Moon" was left out: its kind "spaceship" is not one of flight, train, bus, ferry, car, hotel, restaurant, cafe, bar, sight, museum, attraction, tour, show.',
    'A booking was left out: it is not an object.',
    '"No details" was left out: nothing in it could be read.',
  ]);
  assert.deepEqual(r.problems, [
    'Object 1: it has no title.',
    'Object 2: its kind "spaceship" is not one of flight, train, bus, ferry, car, hotel, restaurant, cafe, bar, sight, museum, attraction, tour, show.',
    'Object 3: it is not an object.',
    'Object 4: it has neither "content" nor any "details" field in the shape asked for.',
    'Object 5: "checkIn" is not in the shape asked for.',
    'Object 5: "guests" is not in the shape asked for.',
  ]);
  assert.deepEqual(r.objects[0].details, { reference: '88412093' });
  assert.deepEqual(r.notes[0], ['Check-in could not be read, so it is left blank.', 'Guests could not be read, so it is left blank.']);
  // An object whose only details were not in the text, and has no content, is left out.
  const gone = review([{ kind: 'hotel', title: 'Hotel X', details: { reference: 'NOTHERE' } }], 'Hotel X');
  assert.deepEqual([gone.objects.length, gone.dropped, gone.reasons], [0, 1, ['"Hotel X" was left out: nothing in it was in the text.']]);
  // Not read at all.
  assert.deepEqual(reviewExtract({ read: false }, ctx('x')).problems, ['The answer was not one JSON object with "objects" and "unread".']);
});

await test('at most 20 objects are kept from one paste; the rest are counted and said once', () => {
  const many = Array.from({ length: 23 }, (_, i) => ({ kind: 'restaurant', title: `Dinner ${i + 1}`, content: 'Booked.' }));
  const r = review(many, 'dinners');
  assert.deepEqual([r.objects.length, r.dropped], [20, 3]);
  assert.deepEqual(r.reasons, ['Only the first 20 bookings are read from one paste; paste the rest on their own.']);
});

// --- the call, in process ----------------------------------------------------------------------------------------------
const fake = await startFakeModel();
const aiAt = (dir) => {
  fs.mkdirSync(path.join(dir, 'modules', 'assistant'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'modules', 'assistant', 'ai.json'), JSON.stringify({ source: 'custom', provider: 'compatible', address: `${fake.url}/v1`, model: 'fake-1' }));
  return new Ai(dir, {});
};
const INPUTS = { text: FLIGHT_TEXT, trip: TRIP, today: TODAY, kinds: TRAVEL_KINDS, words: WORDS };
const reviewer = (r) => reviewExtract(r, ctx(FLIGHT_TEXT));
const records = (dir) => { try { return fs.readFileSync(path.join(dir, 'modules', 'assistant', 'ai-log.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const GOOD = { objects: [flight()], unread: [] };

await test('one call, no tools, no history: the system part, then the data with the pasted text', async () => {
  const dir = tmp('call');
  const ai = aiAt(dir);
  fake.clear();
  fake.next({ json: GOOD, tokens: [300, 120] });
  const out = await ai.extract(INPUTS, { purpose: 'chat', person: 'p1', space: 's1', counts: { characters: FLIGHT_TEXT.length } }, { review: reviewer });
  assert.equal(fake.seen.length, 1);
  const body = fake.seen[0].body;
  assert.ok(!body.tools, 'no tools');
  assert.deepEqual(body.messages.map((m) => m.role), ['system', 'user']);
  assert.equal(JSON.parse(body.messages[1].content).pastedText, FLIGHT_TEXT);
  assert.ok(body.response_format && body.response_format.json_schema.name === 'extract_1');
  assert.deepEqual([out.review.objects.length, out.tokens, out.rounds, out.prompt], [1, 420, 1, 'extract@1']);
  assert.deepEqual([ai.usage.calls, ai.usage.tokens, ai.usage.byTask.extract], [1, 420, 420]);
  const rec = records(dir).at(-1);
  assert.deepEqual([rec.outcome, rec.template, rec.rounds, rec.objects, rec.dropped, rec.sent.characters], ['answered', 'extract@1', 1, 1, 0, FLIGHT_TEXT.length]);
  assert.ok(!JSON.stringify(records(dir)).includes('QX7RTB'), 'no text in the records');
});

await test('one repair: the problems listed after the first answer; the second answer used; one call, both rounds counted', async () => {
  const dir = tmp('repair');
  const ai = aiAt(dir);
  fake.clear();
  fake.next({ json: { objects: [{ kind: 'flight', details: { number: 'TP 1350' } }], unread: [] }, tokens: [300, 20] });
  fake.next({ json: GOOD, tokens: [400, 120] });
  const out = await ai.extract(INPUTS, { purpose: 'chat', person: 'p1' }, { review: reviewer });
  assert.equal(fake.seen.length, 2);
  const second = fake.seen[1].body.messages;
  assert.deepEqual(second.map((m) => m.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(JSON.parse(second[2].content).objects[0].details.number, 'TP 1350', 'the first answer, as it was');
  assert.ok(second[3].content.includes('- Object 1: it has no title.') && second[3].content.includes('Write the whole answer again'));
  assert.deepEqual([out.review.objects.length, out.rounds, out.tokens], [1, 2, 840]);
  assert.deepEqual([ai.usage.calls, ai.usage.tokens], [1, 840]);
  assert.equal(records(dir).length, 1, 'one record for the extraction');
  assert.equal(records(dir)[0].rounds, 2);
  // No problems: no repair.
  fake.clear();
  fake.next({ json: GOOD });
  await ai.extract(INPUTS, { purpose: 'chat', person: 'p1' }, { review: reviewer });
  assert.equal(fake.seen.length, 1);
  // Text-check drops are not repaired (the model can't put a number into the text).
  fake.clear();
  fake.next({ json: { objects: [flight({ reference: 'ZZ9ZZZ' })], unread: [] } });
  const kept = await ai.extract(INPUTS, { purpose: 'chat', person: 'p1' }, { review: reviewer });
  assert.equal(fake.seen.length, 1);
  assert.deepEqual(kept.review.notes[0], ['The confirmation number was not in the text, so it is left blank.']);
});

await test('a second answer that does not read keeps the first; neither reading is a 502 with its sentence', async () => {
  const dir = tmp('unread');
  const ai = aiAt(dir);
  fake.clear();
  fake.next({ json: { objects: [flight(), { kind: 'hotel' }], unread: [] } });
  fake.next({ text: 'not json at all' });
  const out = await ai.extract(INPUTS, { purpose: 'chat', person: 'p1' }, { review: reviewer });
  assert.deepEqual([out.review.objects.length, out.review.dropped, out.rounds], [1, 1, 2]);
  fake.clear();
  fake.next({ text: 'Sorry, I cannot.' });
  fake.next({ text: 'Still no JSON.' });
  await assert.rejects(ai.extract(INPUTS, { purpose: 'chat', person: 'p1' }, { review: reviewer }), (e) => e instanceof AiError && e.status === 502 && e.message === EXTRACT_UNREADABLE && e.paid === true);
  assert.equal(fake.seen.length, 2);
  assert.equal(records(dir).at(-1).error, 'unreadable');
  assert.equal(ai.usage.calls, 2, 'each extraction one call, the failed one too (it was billed)');
});

await test('a service that refuses the schema is asked for the same JSON as text, and it is read back', async () => {
  const dir = tmp('text');
  const ai = aiAt(dir);
  fake.clear();
  fake.refuseSchema = true;
  fake.next({ text: `Here you go:\n${JSON.stringify(GOOD)}` });
  const out = await ai.extract(INPUTS, { purpose: 'chat', person: 'p1' }, { review: reviewer });
  fake.refuseSchema = false;
  assert.equal(out.mode, 'text');
  assert.equal(out.review.objects.length, 1);
  assert.ok(fake.seen.at(-1).body.messages[0].content.includes('Answer with one JSON object and nothing else'));
});

await test('refused before anything is sent: not set up, the allowance', async () => {
  const dir = tmp('refused');
  const ai = new Ai(dir, {});
  await assert.rejects(ai.extract(INPUTS, {}, { review: reviewer }), (e) => e.status === 503 && e.message === 'AI is not set up here.' && e.refund);
  const capped = aiAt(tmp('cap'));
  capped.config.monthlyTokens = 100;
  fake.clear();
  await assert.rejects(capped.extract(INPUTS, {}, { review: reviewer }), (e) => e.status === 429 && e.refund);
  assert.equal(fake.seen.length, 0);
});

// --- the golden set (step 3) ---------------------------------------------------------------------------------------------
// A sample: { mark: 'written' | 'real-anonymised', kind, text, trip?, today?, expected: [objects], standIn?: { objects, unread } }.
// `expected` is what a right reading keeps (the objects format, as cleanObject keeps it). With `standIn`, that answer is read and
// checked here and must come back as `expected`; without, the sample is for tools/eval-extract.mjs's real-model run only.
const MARKS = ['written', 'real-anonymised'];
function checkSamples(dir) {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  let read = 0;
  for (const f of files) {
    const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.ok(MARKS.includes(s.mark), `${f}: mark is written or real-anonymised`);
    assert.ok(typeof s.text === 'string' && s.text.trim() && [...s.text].length <= prompts.MAX_PASTED, `${f}: text`);
    assert.ok(Array.isArray(s.expected), `${f}: expected is a list`);
    for (const o of s.expected) assert.deepEqual(cleanObject(o, { imported: true }), o, `${f}: each expected object is as the format keeps it`);
    if (s.standIn) {
      const trip = s.trip || { name: 'Trip' };
      const r = reviewExtract(readExtract({ structured: s.standIn, text: JSON.stringify(s.standIn) }), { text: s.text, trip, today: (s.today || TODAY).date, kinds: TRAVEL_KINDS, words: WORDS });
      assert.deepEqual(r.objects, s.expected, `${f}: the stand-in answer reads back as expected`);
      read += 1;
    }
  }
  return { files: files.length, read };
}
await test('the golden set: every sample is well formed, and a stand-in answer reads back as expected', () => {
  // The loader itself, on a sample written here.
  const dir = tmp('golden');
  const expected = review([flight()], FLIGHT_TEXT).objects;
  fs.writeFileSync(path.join(dir, 'flight-one-way.json'), JSON.stringify({ mark: 'written', kind: 'flight', text: FLIGHT_TEXT, trip: TRIP, expected, standIn: { objects: [flight()], unread: [] } }));
  assert.deepEqual(checkSamples(dir), { files: 1, read: 1 });
  fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify({ mark: 'guessed', text: 'x', expected: [] }));
  assert.throws(() => checkSamples(dir), /mark is written or real-anonymised/);
  // The committed set (tools/golden/extract/, step 3).
  checkSamples(path.join(ROOT, 'tools', 'golden', 'extract'));
});

// --- through a throwaway server --------------------------------------------------------------------------------------------
const dataDir = tmp('server');
fs.mkdirSync(path.join(dataDir, 'modules', 'assistant'), { recursive: true });
fs.writeFileSync(path.join(dataDir, 'modules', 'assistant', 'ai.json'), JSON.stringify({ source: 'custom', provider: 'compatible', address: `${fake.url}/v1`, model: 'fake-1' }));
const out = { text: '' };
const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { cwd: ROOT, env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, ADMIN_PASSWORD: 'testpass1234', AGENT_TOKENS: 'true', TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', (d) => { out.text += d; });
child.stderr.on('data', (d) => { out.text += d; });
try {
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start:\n${out.text}`)); }, 25000);
    const look = () => { const m = /listening on :(\d+)/.exec(out.text); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', look);
    child.stderr.on('data', look);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out.text}`)); });
  });
  const call = async (method, urlPath, { body, cookie, token, raw } = {}) => {
    const headers = { accept: 'application/json' };
    if (cookie) headers.cookie = `app_session=${cookie}`;
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined || raw !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  const login = async (name, password) => (await call('POST', '/api/login', { body: { login: name, password } })).json.token;
  const owner = await login('admin', 'testpass1234');
  for (const id of ['assistant', 'travel', 'research']) {
    assert.equal((await call('POST', `/api/modules/bundled/${id}/install`, { cookie: owner, body: {} })).status, 201, id);
    assert.equal((await call('PATCH', `/api/modules/${id}`, { cookie: owner, body: { enabled: true, allSpaces: true } })).status, 200, id);
  }
  const people = {};
  const NAMES = ['pat', 'mo', 'nora', 'rae', 'sid', 'ivy', 'lou', 'kit', 'ada'];
  for (const name of NAMES) people[name] = (await call('POST', '/api/users', { cookie: owner, body: { login: name, displayName: name[0].toUpperCase() + name.slice(1), role: 'member', password: 'memberpass1234' } })).json.user;
  const tok = { owner };
  for (const name of NAMES) tok[name] = await login(name, 'memberpass1234');
  const space = (await call('POST', '/api/spaces', { cookie: owner, body: { name: 'London', members: NAMES.filter((n) => n !== 'ada').map((n) => people[n].key) } })).json.space;
  const other = (await call('POST', '/api/spaces', { cookie: owner, body: { name: 'Porto', members: [people.ada.key] } })).json.space;
  const guestToken = (await call('POST', `/api/spaces/${space.id}/guest-link`, { cookie: owner, body: {} })).json.space.guestToken;
  const E = (id = space.id) => `/api/spaces/${id}/ai/extract`;
  const extract = (who, body, id) => call('POST', E(id), { cookie: tok[who], body });
  const refused = (r, status, error, what) => { assert.equal(r.status, status, `${what}: ${r.status} ${r.text.slice(0, 300)}`); assert.equal(r.json && r.json.error, error, `${what}: the sentence`); };
  const recordsHere = () => records(dataDir);
  const MARK = 'PRIVATEMARKER7Q';
  const PASTE = `${FLIGHT_TEXT}\nNote: ${MARK}\n`;

  await test('server: a paste is read: { objects, notes, unread, dropped, cut, tokens, prompt }, nothing written', async () => {
    const chatBefore = (await call('GET', `/api/spaces/${space.id}/chat`, { cookie: tok.pat })).json.messages.length;
    fake.clear();
    fake.next({ json: { objects: [flight(), { kind: 'hotel' }], unread: ['A car hire could not be read.'] } });
    fake.next({ json: { objects: [flight(), { kind: 'hotel', title: 'Hotel Y', details: { reference: 'NOTHERE' } }], unread: ['A car hire could not be read.'] } });
    const r = await extract('pat', { text: PASTE, trip: { first: TRIP.first, last: TRIP.last, timeZone: TRIP.timeZone, currency: 'gbp' }, tz: 'Europe/Lisbon' });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(Object.keys(r.json).sort(), ['cut', 'dropped', 'notes', 'objects', 'prompt', 'tokens', 'unread']);
    assert.deepEqual([r.json.objects.length, r.json.dropped, r.json.prompt, r.json.cut], [1, 1, 'extract@1', false]);
    assert.deepEqual(r.json.notes, [[]]);
    assert.deepEqual(r.json.unread, ['A car hire could not be read.', '"Hotel Y" was left out: nothing in it was in the text.']);
    assert.equal(r.json.objects[0].details.minutes, 165);
    // The data the model was given: the trip (named after the space, its currency in capitals), today, the text; no history, no tools.
    const doc = JSON.parse(fake.seen[0].body.messages[1].content);
    assert.deepEqual(doc.trip, { name: 'London', first: TRIP.first, last: TRIP.last, timeZone: TRIP.timeZone, currency: 'GBP' });
    assert.equal(doc.today.timeZone, 'Europe/Lisbon');
    assert.ok(doc.pastedText.includes(MARK));
    assert.deepEqual(fake.seen[0].body.messages.map((m) => m.role), ['system', 'user']);
    assert.ok(!fake.seen[0].body.tools);
    assert.equal((await call('GET', `/api/spaces/${space.id}/chat`, { cookie: tok.pat })).json.messages.length, chatBefore, 'nothing in Chat');
    const rec = recordsHere().at(-1);
    assert.deepEqual([rec.template, rec.purpose, rec.outcome, rec.rounds, rec.objects, rec.dropped, rec.sent.characters], ['extract@1', 'chat', 'answered', 2, 1, 1, PASTE.trim().length]);
  });

  await test('server: no question history is sent, even after an ask here', async () => {
    fake.clear();
    assert.equal((await call('POST', `/api/spaces/${space.id}/ai`, { cookie: tok.mo, body: { question: 'What should we pack?' } })).status, 200);
    fake.clear();
    fake.next({ json: GOOD });
    assert.equal((await extract('mo', { text: FLIGHT_TEXT })).status, 200);
    assert.deepEqual(fake.seen[0].body.messages.map((m) => m.role), ['system', 'user']);
  });

  await test('server: the 1,000-character limit of a question does not apply; 30,000 is the most, then a plain refusal', async () => {
    fake.clear();
    const long = `${FLIGHT_TEXT}\n${'Terms and conditions apply. '.repeat(1100)}`.slice(0, prompts.MAX_PASTED);
    fake.next({ json: GOOD });
    let r = await extract('nora', { text: long });
    assert.equal(r.status, 200, r.text);
    r = await extract('nora', { text: `${long}x` });
    refused(r, 413, 'That text is longer than 30,000 characters; paste one email at a time.', 'over 30,000');
    // A body over what the route reads at all says the same.
    r = await call('POST', E(), { cookie: tok.nora, raw: JSON.stringify({ text: 'é'.repeat(140000) }) });
    refused(r, 413, 'That text is longer than 30,000 characters; paste one email at a time.', 'over the body limit');
    // Characters, not bytes: 30,000 in a script of two-byte letters is read.
    fake.next({ json: { objects: [], unread: [] } });
    r = await extract('nora', { text: 'é'.repeat(30000) });
    refused(r, 422, 'There is no booking in this text.', 'no booking');
    assert.deepEqual(r.json.unread, []);
  });

  await test('server: the request refused, each with its status and sentence', async () => {
    refused(await call('POST', E(), { body: { text: 'x' } }), 401, 'Sign in first.', 'signed out');
    refused(await call('POST', `${E()}?guest=${guestToken}`, { body: { text: 'x' } }), 403, "Guests can't use AI.", 'a guest');
    refused(await extract('rae', { text: 'x' }, 'nosuchspace'), 404, 'No such space.', 'no such space');
    refused(await extract('rae', { text: 'x' }, other.id), 404, 'No such space.', 'another space (told as none, as the ask is)');
    refused(await extract('rae', {}), 400, 'Paste the text to read.', 'no text');
    refused(await extract('rae', { text: '   \n ' }), 400, 'Paste the text to read.', 'blank text');
    refused(await extract('rae', { text: 'x', trip: 'London' }), 400, 'The space must be sent as its name, days, time zone and currency.', 'trip not an object');
    refused(await extract('rae', { text: 'x', trip: { first: '14 March' } }), 400, "The space's first day must be a date written YYYY-MM-DD.", 'trip first');
    refused(await extract('rae', { text: 'x', trip: { last: '2027-02-30' } }), 400, "The space's last day must be a date written YYYY-MM-DD.", 'trip last');
    refused(await extract('rae', { text: 'x', trip: { first: '2027-03-21', last: '2027-03-14' } }), 400, "The space's last day is before its first day.", 'trip order');
    refused(await extract('rae', { text: 'x', trip: { timeZone: 'Mars/Olympus' } }), 400, "The space's time zone is not one this server knows.", 'trip zone');
    refused(await extract('rae', { text: 'x', trip: { currency: 'euro' } }), 400, "The space's currency must be a three-letter code, such as EUR.", 'trip currency');
    refused(await extract('rae', { text: 'x', kinds: 'flight' }), 400, 'The kinds must be a list of kinds.', 'kinds not a list');
    refused(await extract('rae', { text: 'x', kinds: ['spaceship'] }), 400, 'spaceship is not a kind this server knows.', 'an unknown kind');
    refused(await extract('rae', { text: 'x', kinds: ['poll'] }), 400, 'No module here can keep bookings.', 'no kind taken here');
    refused(await extract('rae', { text: 'x', from: 'travel' }), 403, 'this module did not ask for the ai hook', 'a module without the ai hook');
    refused(await extract('rae', { text: 'x', from: 'nosuchmodule' }), 404, 'no such module', 'no such module');
    // None of those used a turn: six real asks still go through for rae.
  });

  await test('server: a module asks with its ai hook and its write access; the kinds it names narrow what is read', async () => {
    fake.clear();
    fake.next({ json: GOOD });
    const r = await extract('rae', { text: FLIGHT_TEXT, from: 'research', kinds: ['flight', 'hotel'] });
    assert.equal(r.status, 200, r.text);
    assert.equal(recordsHere().at(-1).purpose, 'module');
    const shapes = fake.seen[0].body.response_format.json_schema.schema.properties.objects.items.anyOf.map((s) => s.properties.kind.enum || s.properties.kind.type);
    assert.deepEqual(shapes, [['flight'], ['hotel'], 'null']);
  });

  await test('server: AI off in the space, a role without Use AI, AI not set up', async () => {
    await call('PATCH', `/api/spaces/${space.id}`, { cookie: owner, body: { aiOff: true } });
    refused(await extract('sid', { text: 'x' }), 403, 'AI is turned off in this space.', 'AI off here');
    await call('PATCH', `/api/spaces/${space.id}`, { cookie: owner, body: { aiOff: false } });
    assert.equal((await call('PATCH', '/api/roles/member', { cookie: owner, body: { useAi: false } })).status, 200);
    refused(await extract('sid', { text: 'x' }), 403, "Your role can't use AI.", 'role');
    await call('PATCH', '/api/roles/member', { cookie: owner, body: { useAi: true } });
    assert.equal((await call('PUT', '/api/ai', { cookie: owner, body: { provider: 'none' } })).status, 200);
    refused(await extract('sid', { text: 'x' }), 503, 'No AI service is chosen for this environment yet. Ask the owner.', 'not set up');
    assert.equal((await call('PUT', '/api/ai', { cookie: owner, body: { provider: 'compatible', address: `${fake.url}/v1`, model: 'fake-1' } })).status, 200);
  });

  await test('server: the rate limit counts only asks carried out, six a minute for all AI together', async () => {
    fake.clear();
    for (let i = 0; i < 6; i += 1) { fake.next({ json: GOOD }); assert.equal((await extract('ivy', { text: FLIGHT_TEXT })).status, 200, `ask ${i + 1}`); }
    const r = await extract('ivy', { text: FLIGHT_TEXT });
    refused(r, 429, 'You have asked the AI too many times in a minute. Try again in a moment.', 'the seventh');
    assert.ok(Number(r.headers.get('retry-after')) > 0);
    assert.equal(fake.seen.length, 6);
  });

  await test("server: an unreadable answer is a 502 with its sentence; the month's allowance refuses before anything is sent", async () => {
    fake.clear();
    fake.next({ text: 'nope' });
    fake.next({ text: 'still nope' });
    refused(await extract('lou', { text: FLIGHT_TEXT }), 502, "The AI Assistant's answer could not be read, so nothing was added. Try again.", 'unreadable');
    const used = (await call('GET', '/api/ai/usage', { cookie: owner })).json.usage.tokens;
    assert.equal((await call('PUT', '/api/ai', { cookie: owner, body: { monthlyTokens: used } })).status, 200);
    fake.clear();
    refused(await extract('lou', { text: FLIGHT_TEXT }), 429, 'This environment has used its AI allowance for the month.', 'allowance');
    assert.equal(fake.seen.length, 0);
    await call('PUT', '/api/ai', { cookie: owner, body: { monthlyTokens: 0 } });
  });

  await test('server: an agent is refused the route', async () => {
    assert.equal((await call('PATCH', '/api/settings', { cookie: owner, body: { agents: true } })).status, 200);
    const agent = (await call('POST', '/api/users', { cookie: owner, body: { agent: true } })).json.user;
    await call('PATCH', `/api/spaces/${space.id}`, { cookie: owner, body: { members: [...space.members, agent.key] } });
    const token = (await call('POST', `/api/users/${agent.key}/token`, { cookie: owner })).json.token;
    fake.clear();
    refused(await call('POST', E(), { token, body: { text: FLIGHT_TEXT } }), 403, "An agent can't do that.", 'an agent');
    assert.equal(fake.seen.length, 0);
  });

  await test('server: the pasted text is kept nowhere: not in the records, the usage, the output or any file', async () => {
    assert.ok(!out.text.includes(MARK), 'not in the server output');
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    await new Promise((r) => setTimeout(r, 3500)); // the usage is written a few seconds after a call
    for (const f of walk(dataDir)) assert.ok(!fs.readFileSync(f).includes(MARK), `not in ${path.relative(dataDir, f)}`);
    assert.ok(recordsHere().some((r) => r.template === 'extract@1'));
  });
} finally {
  child.kill('SIGTERM');
  await fake.close?.();
}

if (failures.length) {
  console.error(`check-ai-extract: ${failures.length} failed`);
  for (const f of failures) console.error(f);
  process.exit(1);
}
console.log(`check-ai-extract: OK (${count} groups)`);
process.exit(0);
