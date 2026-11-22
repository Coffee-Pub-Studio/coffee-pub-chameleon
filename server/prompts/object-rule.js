// The objects rule: how a model is told to write the objects worth keeping (plan-object-handoff.md, "The prompt"), and
// the output contract's JSON schema (plan-ai-integration.md, "The prompt registry"). Moved here from
// server/object-format.js, which keeps the catalogue (KINDS, DETAILS, ICONS) and the reader (cleanObject, readObjects)
// this rule describes. The paste template and the in-app templates share these lines so they cannot drift.
'use strict';

const { KINDS, TRAVEL_KINDS, PLAN_KINDS, DETAILS, BOOKING_DETAILS, ICONS, BASES } = require('../object-format');

const listWords = (list, last = 'or') => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} ${last} ${list[list.length - 1]}`);

// The example. Every value is a placeholder in <angle brackets>, never a real-looking one: a model that copies the
// example writes an object whose title is still a placeholder, and the reader drops it (isPlaceholder, in cleanObject).
// A flight's when flights are taken, else a plain object.
const FLIGHT_EXAMPLE = '{"icon":"plane","kind":"flight","title":"<title>","content":"<notes; plain prose, or simple Markdown>","date":"<YYYY-MM-DD>","details":{"airline":"<airline>","number":"<number>","from":{"code":"<code>","name":"<name>"},"to":{"code":"<code>","name":"<name>"},"departs":"<YYYY-MM-DDTHH:MM>","arrives":"<YYYY-MM-DDTHH:MM>","reference":"<reference>","cost":"<number>","currency":"<code>","travellers":["<name>"]},"tags":["<tag>"],"place":{"name":"<name>"},"links":[{"title":"<title>","url":"<url>"}]}';
function promptExample(kinds, withProvenance) {
  const example = kinds.includes('flight')
    ? FLIGHT_EXAMPLE
    : `{"icon":"note",${kinds.length ? `"kind":"${kinds[0]}",` : ''}"title":"<title>","content":"<the text to keep; plain prose, or simple Markdown (headings, **bold**, *italic*, lists, links) if that reads better>","date":"<YYYY-MM-DD>","tags":["<tag>"],"place":{"name":"<name>"},"links":[{"title":"<title>","url":"<url>"}]}`;
  return withProvenance ? `${example.slice(0, -1)},"basis":"<basis>","sources":[<numbers>]}` : example;
}

// What a details field needs said beside its name. A `when` is explained once, in the dates line.
const FIELD_NOTES = {
  'flight.minutes': 'time in the air', 'car.from': 'pick-up', 'car.to': 'drop-off', 'car.departs': 'pick-up', 'car.arrives': 'drop-off', 'restaurant.name': "the booking's name", 'cafe.name': "the booking's name", 'bar.name': "the booking's name", 'winery.name': "the booking's name",
  'milestone.start': 'its day', 'milestone.phase': "the phase's name", 'milestone.under': 'the title of what it sits under',
  'work.start': 'first day', 'work.end': 'last day', 'work.phase': "the phase's name", 'work.under': 'the title of what it sits under',
  'goal.why': 'why it matters', 'goal.date': 'the day it is due', 'goal.phase': "the phase's name",
  'step.date': 'the day it is due', 'step.under': "its goal's title",
};
const TYPE_NOTES = { flag: 'true or false', options: '2 to 10 short answers', money: 'a number, no currency sign', currency: 'three letters, such as EUR', names: 'names as written' };
const BOOKING_FIELDS = Object.keys(BOOKING_DETAILS);
// A kind that takes a booking's fields (cost, currency, travellers): they are said once, on a line of their own.
const isBooking = (kind) => BOOKING_FIELDS.every((name) => Object.hasOwn(DETAILS[kind], name));
const KIND_NOTES = { hotel: 'any stay: hotel, rental, hostel' };

// A plan kind as the prompt's sentences say it, and one small example of each (placeholders only, as above).
const PLAN_WORDS = { milestone: 'milestone', work: 'piece of work', goal: 'goal', step: 'step' };
const PLAN_EXAMPLES = {
  milestone: '{"kind":"milestone","title":"<title>","details":{"start":"<YYYY-MM-DD>","phase":"<phase>"}}',
  work: '{"kind":"work","title":"<title>","content":"<notes>","details":{"start":"<YYYY-MM-DD>","end":"<YYYY-MM-DD>","under":"<title of the milestone>"}}',
  goal: '{"kind":"goal","title":"<title>","details":{"why":"<why it matters>","date":"<YYYY-MM-DD>"}}',
  step: '{"kind":"step","title":"<title>","details":{"done":false,"under":"<title of the goal>"}}',
};

// The lines for a plan's kinds, when any is listed: how a plan is split up, what "under" is, and one example of each.
function planLines(listed, noun) {
  const plan = listed.filter((k) => PLAN_KINDS.includes(k));
  if (!plan.length) return [];
  const under = plan.some((k) => DETAILS[k].under);
  const lines = [`A plan is one ${noun} for each ${listWords(plan.map((k) => PLAN_WORDS[k]), 'and')}.${under ? ' Write each one after what it sits under, and put that one\'s title in "under".' : ''}`];
  const general = listed.filter((k) => k === 'event' || k === 'task');
  if (general.length) lines.push(`For a plan, use ${listWords(plan)} rather than ${listWords(general.map((k) => `"${k}"`))}.`);
  lines.push(`For example: ${plan.map((k) => PLAN_EXAMPLES[k]).join(' ')}`);
  return lines;
}

// One line per kind, or per run of kinds with the same fields ("restaurant, cafe, bar: ..."), for the kinds listed. A
// booking's own fields (cost, currency, travellers) are left off each kind's line and said once, after the last booking's.
function detailsLines(kinds) {
  const lines = [];
  let pointsSaid = false;
  const ownFields = (k) => Object.entries(DETAILS[k]).filter(([name]) => !(isBooking(k) && BOOKING_FIELDS.includes(name)));
  const empty = kinds.filter((k) => !Object.keys(DETAILS[k]).length);
  const groups = [];
  for (const k of kinds.filter((x) => Object.keys(DETAILS[x]).length)) {
    const last = groups[groups.length - 1];
    if (last && JSON.stringify(DETAILS[last[0]]) === JSON.stringify(DETAILS[k])) last.push(k);
    else groups.push([k]);
  }
  const bookings = kinds.filter(isBooking);
  for (const group of groups) {
    const fields = Object.fromEntries(ownFields(group[0]));
    const both = fields.from === 'point' && fields.to === 'point';
    const words = [];
    let merged = false;
    for (const [name, type] of Object.entries(fields)) {
      const note = FIELD_NOTES[`${group[0]}.${name}`] || TYPE_NOTES[type.split(':')[0]];
      if (both && name === 'from' && !pointsSaid) {
        pointsSaid = true;
        merged = true;
        words.push(`from and to ({"code","name"}${note ? `; ${note} and ${FIELD_NOTES[`${group[0]}.to`]}` : ''})`);
      } else if (!(merged && name === 'to')) {
        words.push(note ? `${name} (${note})` : name);
      }
    }
    lines.push(`- ${group.map((k) => (KIND_NOTES[k] ? `${k} (${KIND_NOTES[k]})` : k)).join(', ')}: ${words.join(', ')}`);
    if (bookings.length && group.includes(bookings[bookings.length - 1])) {
      const which = bookings.length === 1 ? bookings[0] : `every booking (${bookings[0]} to ${bookings[bookings.length - 1]})`;
      lines.push(`- ${which} also takes: ${BOOKING_FIELDS.map((name) => `${name} (${TYPE_NOTES[BOOKING_DETAILS[name]]})`).join(', ')}`);
    }
  }
  if (empty.length) {
    const link = empty.includes('link');
    lines.push(`- ${listWords(empty, 'and')}: no details${link ? `; ${empty.length > 1 ? "a link's" : 'its'} address goes in "links"` : ''}.`);
  }
  return lines;
}

// The kinds a rule lists, in the catalogue's order.
const listedKinds = (kinds = TRAVEL_KINDS) => KINDS.filter((k) => kinds.includes(k));

// The lines about each object's fields, after the shape: one per thing, the kinds, dates, details, icons and the rest.
// `withProvenance`: an in-app answer's "basis" and "sources"; it also cannot stop to ask for a date, so it says which it needs.
// `numbers`: what an in-app answer's sources are called (the data's numbers "n").
function fieldLines({ noun, kinds = TRAVEL_KINDS, withProvenance, numbers = 'the item numbers you used' }) {
  const listed = listedKinds(kinds);
  const travel = listed.some((k) => TRAVEL_KINDS.includes(k));
  const hasDetails = listed.some((k) => Object.keys(DETAILS[k]).length);
  const lines = [`One ${noun} per thing.${travel ? ` A whole itinerary is one ${noun} for each flight, train, stay, meal, visit and event, in the order they happen; a return flight is its own ${noun}.` : ''} Never fold several into one ${noun}'s text.`];
  if (listed.length) lines.push(`Set "kind" to what the ${noun} is: ${listWords(listed)}. Leave it out only when none fits.`);
  // A booking at a set time is still its travel kind, so it lands in the trip's plan rather than the calendar.
  const travelListed = listed.filter((k) => TRAVEL_KINDS.includes(k));
  if (travelListed.length && listed.includes('event')) {
    lines.push(`For a booking or a stop on a trip, use its own kind (${listWords(travelListed)}) rather than "event", even when it happens at a set time; use "event" only for anything else on a day, such as an appointment or a party.`);
  }
  const missing = withProvenance
    ? 'If something happens on a day you were not told, leave its date out and say in your answer which dates you still need.'
    : 'If something happens on a day you were not told, ask me for the date before you write the block; if I do not know, leave the date out.';
  lines.push(`Dates and times: copy them from what I gave you; never guess a date or a year. ${missing} ${hasDetails
    ? 'Write a date as YYYY-MM-DD and a date with a time as YYYY-MM-DDTHH:MM, 24-hour, in the local time where it happens, with no time zone. If you know only the time, write HH:MM. Put the day in "date" as well.'
    : 'Write a date as YYYY-MM-DD.'}`);
  if (listed.length) {
    lines.push(hasDetails
      ? `"details" holds what a booking or plan says. Every field is optional; leave out what you do not know, and write nothing in "content" that is already in "details":`
      : 'These kinds take no "details":');
    lines.push(...detailsLines(listed));
    lines.push(...planLines(listed, noun));
  }
  const tail = withProvenance
    ? `"basis" says where the ${noun} comes from: "general" (your own knowledge), "items" (the data) or "both". "sources" are ${numbers}.`
    : 'Keep each title under 80 characters and each content under 6000. Links must start with http:// or https://.';
  const leave = hasDetails
    ? 'Leave out tags, place and links when you have nothing for them, and content when "details" says it all.'
    : 'Leave out tags, place and links when you have nothing for them.';
  lines.push(`The icon is one of: ${ICONS.join(', ')}. ${tail} ${leave} Add no fields other than these.`);
  return lines;
}

// The rule for one fenced objects block, as the paste template writes it (the published instructions): the fence, the
// example inside it, then the field lines.
function fencedRule({ fence, noun, max, kinds = TRAVEL_KINDS }) {
  return [
    `single fenced block (exactly one, never one per ${noun}), at most ${max}:`,
    `\`\`\`${fence}`,
    `[${promptExample(listedKinds(kinds), false)}]`,
    '```',
    'Text in <angle brackets> is a placeholder: write a real value, never the brackets.',
    ...fieldLines({ noun, kinds, withProvenance: false }),
  ].join('\n');
}

// The same rule for an in-app answer read back by prompt-then-parse (a service without structured output). The example
// is never written inside a fence, so a model echoing its instructions gives back no block the parser reads.
function answerRule({ fence, noun, max, kinds = TRAVEL_KINDS, numbers }) {
  return [
    `Put every ${noun} worth keeping in one JSON array inside a single fenced block labelled ${fence} (three backticks and the word ${fence} on its own line before it, three backticks on their own line after it): exactly one block, never one per ${noun}, at most ${max}, after your answer. ${noun.charAt(0).toUpperCase()}${noun.slice(1)}s go only in that block, never inline in your answer text. Each one looks like this:`,
    promptExample(listedKinds(kinds), true),
    'Text in <angle brackets> is a placeholder: write a real value, never the brackets.',
    ...fieldLines({ noun, kinds, withProvenance: true, numbers }),
  ].join('\n');
}

// --- the output contract as a JSON schema (structured output) ---------------------------------------------------------
// Written to the strictest form the providers take (OpenAI's strict mode): every object closed, every property
// required, an unknown value given as null. The reader drops the nulls and checks each object with cleanObject, so the
// schema describes what to write and never decides what is kept. One shape per kind, joined with anyOf on "kind"
// (plan-assistant-reboot.md, decision 2): each carries only its own kind's details, so an object is never written with
// every other kind's fields as null. An object with no kind is its own shape, with no details.
// What every shape shares is written once, in $defs (OBJECT_DEFS), and pointed at.
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const ref = (name) => ({ $ref: `#/$defs/${name}` });
const OBJECT_DEFS = () => ({
  icon: { type: 'string', enum: ICONS.slice() },
  place: nullable({ type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string' } } }),
  links: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'url'], properties: { title: { type: 'string' }, url: { type: 'string' } } } },
  point: { type: 'object', additionalProperties: false, required: ['code', 'name'], properties: { code: nullable({ type: 'string' }), name: nullable({ type: 'string' }) } },
});
function valueSchema(type) {
  switch (type.split(':')[0]) {
    case 'when': return { type: 'string' };
    case 'point': return ref('point');
    case 'count': case 'minutes': return { type: 'integer' };
    case 'money': return { type: 'number' };
    case 'flag': return { type: 'boolean' };
    case 'options': case 'names': return { type: 'array', items: { type: 'string' } };
    default: return { type: 'string' };
  }
}
// One kind's details: its own fields only, each one null when it is not known. Null for a kind with none.
function detailsSchema(kind) {
  const fields = Object.entries(DETAILS[kind]);
  if (!fields.length) return null;
  return nullable({ type: 'object', additionalProperties: false, required: fields.map(([name]) => name), properties: Object.fromEntries(fields.map(([name, type]) => [name, nullable(valueSchema(type))])) });
}
// The shape of an object of the kinds in `group` (which share their details; none: an object with no kind), with the fields
// every object has.
function kindSchema(group, withKind, provenance = true) {
  const kind = group.length ? group[0] : null;
  const properties = {
    icon: ref('icon'),
    ...(withKind ? { kind: kind ? { type: 'string', enum: group.slice() } : { type: 'null' } } : {}),
    title: { type: 'string' },
    content: nullable({ type: 'string' }),
    date: nullable({ type: 'string' }),
    tags: { type: 'array', items: { type: 'string' } },
    place: ref('place'),
    links: ref('links'),
    ...(provenance ? { basis: { type: 'string', enum: BASES.slice() }, sources: { type: 'array', items: { type: 'integer' } } } : {}),
  };
  const details = kind ? detailsSchema(kind) : null;
  if (details) properties.details = details;
  return { type: 'object', additionalProperties: false, required: Object.keys(properties), properties };
}
// One object of any kind listed: one shape per kind (kinds with the same details share one: restaurant, cafe and bar), then
// the one with no kind; a single shape when no kind is listed. `provenance: false` leaves out "basis" and "sources" (an object
// read out of pasted text has neither: extract@1).
function objectSchema(kinds, { provenance = true } = {}) {
  const listed = listedKinds(kinds);
  if (!listed.length) return kindSchema([], false, provenance);
  const groups = [];
  for (const k of listed) {
    const same = groups.find((g) => JSON.stringify(DETAILS[g[0]]) === JSON.stringify(DETAILS[k]));
    if (same) same.push(k);
    else groups.push([k]);
  }
  return { anyOf: [...groups.map((g) => kindSchema(g, true, provenance)), kindSchema([], true, provenance)] };
}
// The shared parts an object schema points at, without the point when no kind listed has a from or a to.
function defsFor(items) {
  const defs = OBJECT_DEFS();
  if (!JSON.stringify(items).includes('"#/$defs/point"')) delete defs.point;
  return defs;
}
// `{ answer, objects, used }` for ask and summarise. The shapes' shared parts are its $defs.
function answerSchema(kinds) {
  const items = objectSchema(kinds);
  const defs = defsFor(items);
  return {
    type: 'object',
    additionalProperties: false,
    required: ['answer', 'objects', 'used'],
    properties: {
      answer: { type: 'string', description: 'The answer, in Markdown.' },
      objects: { type: 'array', items, description: 'The things in the answer worth keeping; empty when there are none.' },
      used: { type: 'array', items: { type: 'integer' }, description: 'The numbers "n" in the data that the answer drew on.' },
    },
    $defs: defs,
  };
}
// `{ objects, unread }` for extract (plan-assistant-reboot.md, "How extraction works"): the bookings read out of pasted text, one
// shape per kind and no provenance, and the plain sentences saying what in the text could not be read.
function extractSchema(kinds) {
  const items = objectSchema(kinds, { provenance: false });
  return {
    type: 'object',
    additionalProperties: false,
    required: ['objects', 'unread'],
    properties: {
      objects: { type: 'array', items, description: 'One for each booking in the pasted text; empty when there is none.' },
      unread: { type: 'array', items: { type: 'string' }, description: 'Short sentences saying what in the text could not be read; empty when everything was.' },
    },
    $defs: defsFor(items),
  };
}
// `{ tags }` for tags.
const TAGS_SCHEMA = Object.freeze({ type: 'object', additionalProperties: false, required: ['tags'], properties: { tags: { type: 'array', items: { type: 'string' } } } });

module.exports = { listWords, promptExample, detailsLines, fieldLines, fencedRule, answerRule, answerSchema, extractSchema, objectSchema, TAGS_SCHEMA, listedKinds };
