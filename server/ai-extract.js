// What the server checks in the bookings a model read out of pasted text (extract@1, plan-assistant-reboot.md, "How extraction
// works"). Pure: it reads only what it is given and server/airports.json, and keeps nothing.
//
//   - Each object is read with the objects format's own rules (cleanObject, as an import: basis "imported", no sources). One that
//     does not read, or is of a kind the caller did not offer, is dropped and said; a field given in a shape the format does not
//     take is a problem too. Those are the problems a repair ask lists (decision: one repair, then what is valid is shown).
//   - A year the text does not write (the model writes 0000, or a year that is not in the text) is the year that puts the day
//     inside the trip, else the next one from today; when that is not clear the field is left blank and said.
//   - Every reference, flight, train, bus or ferry number and time must appear in the pasted text (spaces, dashes and case
//     ignored); one that does not is left blank and said.
//   - A flight's arrival is checked against its departure with both airports' time zones (server/airports.json); a time in the
//     air under a minute or over 20 hours leaves the arrival blank and is said. When it fits and no time in the air was given,
//     it is filled in from the two zones (worked out, never asked of the model).
//   - A check-out before its check-in, and a day more than 60 days from the trip's dates, are said on the row.
// Anything unknown stays blank: nothing here writes a value the text does not hold, but the year it is told to work out and the
// time in the air worked out from two times the text gives.
'use strict';

const { cleanObject, DETAILS } = require('./object-format');
const airports = require('./airports');
const { MAX_EXTRACT } = require('./prompts/extract');

const FAR_DAYS = 60;
const MAX_FLIGHT_MINUTES = 20 * 60;
const MAX_PROBLEMS = 20;
const JOURNEYS = ['flight', 'train', 'bus', 'ferry'];

// A field as a person reads it in a sentence.
const FIELD_WORDS = {
  reference: 'confirmation number', number: 'number', departs: 'departure', arrives: 'arrival', checkIn: 'check-in', checkOut: 'check-out',
  starts: 'start', ends: 'end', cost: 'cost', currency: 'currency', travellers: 'travellers', date: 'date', minutes: 'time in the air',
  airline: 'airline', operator: 'operator', company: 'company', from: 'from', to: 'to', roomType: 'room type', partySize: 'party size', due: 'due date', closes: 'closing time',
};
const fieldWord = (name) => FIELD_WORDS[name] || name.replace(/([A-Z])/g, ' $1').toLowerCase();
const NUMBER_WORDS = { flight: 'flight number', train: 'train number', bus: 'bus number', ferry: 'ferry number' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// The text as the checks read it: lower case, with every space and dash taken out.
const squash = (s) => String(s == null ? '' : s).toLowerCase().replace(/[\s\-‐-―]+/g, '');
const inText = (value, squashed) => {
  const v = squash(value);
  return Boolean(v) && squashed.includes(v);
};

// Whether a clock time (HH:MM, 24-hour) is written in the text in any common way: 14:05, 14.05, 14h05, 1405, 2:05pm, 2.05 p.m.,
// 2pm (on the hour), noon, midnight.
function timeInText(hh, mm, squashed) {
  const H = Number(hh);
  const h12 = H % 12 || 12;
  const ap = H < 12 ? ['am', 'a.m.'] : ['pm', 'p.m.'];
  const forms = [`${H}:${mm}`, `${hh}:${mm}`, `${H}.${mm}`, `${hh}.${mm}`, `${hh}h${mm}`, `${H}h${mm}`, `${hh}${mm}`];
  for (const a of ap) {
    forms.push(`${h12}:${mm}${a}`, `${h12}.${mm}${a}`);
    if (mm === '00') forms.push(`${h12}${a}`);
  }
  if (H === 12 && mm === '00') forms.push('noon', 'midday');
  if (H === 0 && mm === '00') forms.push('midnight');
  return forms.some((f) => squashed.includes(f));
}

// Whether the text writes this year: as four digits, or as two in a written date (14/03/27, 27-03-14, 14MAR27, March '27).
function yearWritten(year, text) {
  if (new RegExp(`(^|[^0-9])${year}([^0-9]|$)`).test(text)) return true;
  const yy = year.slice(2);
  return new RegExp(`(^|[^0-9])\\d{1,2}[./-]\\d{1,2}[./-]${yy}([^0-9]|$)`).test(text)
    || new RegExp(`(^|[^0-9])${yy}[./-]\\d{1,2}[./-]\\d{1,2}([^0-9]|$)`).test(text)
    || new RegExp(`\\d{1,2}\\s?[A-Za-z]{3,9}\\.?\\s?'?${yy}([^0-9]|$)`).test(text)
    || new RegExp(`'${yy}([^0-9]|$)`).test(text);
}

const realDay = (y, m, d) => {
  const t = new Date(Date.UTC(+y, +m - 1, +d));
  return t.getUTCFullYear() === +y && t.getUTCMonth() === +m - 1 && t.getUTCDate() === +d;
};
const dayMs = (day) => Date.parse(`${day}T00:00:00Z`);

// The year for a day and month the text gives without one: the one that puts it inside the trip (when the trip has dates and
// exactly one year does), else the next one from today. null when that is not clear (two years fit, or the day does not exist).
function yearFor(mm, dd, trip, today) {
  if (trip.first && trip.last) {
    const fits = [];
    for (let y = +trip.first.slice(0, 4); y <= +trip.last.slice(0, 4); y += 1) {
      const day = `${y}-${mm}-${dd}`;
      if (realDay(y, mm, dd) && day >= trip.first && day <= trip.last) fits.push(y);
    }
    if (fits.length === 1) return String(fits[0]);
    if (fits.length > 1) return null;
  }
  const y = +today.slice(0, 4);
  const pick = `${mm}-${dd}` >= today.slice(5) ? y : y + 1;
  return realDay(pick, mm, dd) ? String(pick) : null;
}

const DATED = /^(\d{4})-(\d{2})-(\d{2})(.*)$/;
// The date fields of a raw object: its own "date" and each details field of type when or day.
function datedFields(raw) {
  const kind = typeof raw.kind === 'string' && Object.hasOwn(DETAILS, raw.kind) ? raw.kind : null;
  const fields = kind ? Object.entries(DETAILS[kind]).filter(([, type]) => type === 'when' || type === 'day').map(([name]) => name) : [];
  return fields;
}

// The raw object with every year the text does not write worked out (see yearFor); a field whose year can't be is taken out.
// Answers the notes to show on the row.
function resolveYears(raw, text, trip, today) {
  const notes = [];
  const fix = (value, name) => {
    if (typeof value !== 'string') return value;
    const m = DATED.exec(value.trim());
    if (!m) return value;
    if (m[1] !== '0000' && yearWritten(m[1], text)) return value;
    const year = yearFor(m[2], m[3], trip, today);
    if (!year) { notes.push(`The year of the ${fieldWord(name)} was not in the text and could not be worked out, so it is left blank.`); return undefined; }
    return `${year}-${m[2]}-${m[3]}${m[4]}`;
  };
  const out = { ...raw };
  if (out.date !== undefined) { const v = fix(out.date, 'date'); if (v === undefined) delete out.date; else out.date = v; }
  if (out.details && typeof out.details === 'object' && !Array.isArray(out.details)) {
    const details = { ...out.details };
    for (const name of datedFields(out)) {
      if (details[name] === undefined) continue;
      const v = fix(details[name], name);
      if (v === undefined) delete details[name]; else details[name] = v;
    }
    out.details = details;
  }
  return { raw: out, notes };
}

// Why a raw object can't be kept, in the words a problem list and a row use, or ''.
function whyDropped(raw, kinds) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'it is not an object';
  if (typeof raw.title !== 'string' || !raw.title.trim()) return 'it has no title';
  if (raw.kind !== undefined && !kinds.includes(raw.kind)) return `its kind "${String(raw.kind).slice(0, 30)}" is not one of ${kinds.join(', ')}`;
  return '';
}

// The checks on one cleaned object, against the text: what is left blank and what is said.
function checkAgainstText(object, squashed, notes) {
  const d = object.details;
  if (!d) return;
  if (d.reference !== undefined && !inText(d.reference, squashed)) {
    delete d.reference;
    notes.push('The confirmation number was not in the text, so it is left blank.');
  }
  if (d.number !== undefined && JOURNEYS.includes(object.kind) && !inText(d.number, squashed)) {
    delete d.number;
    notes.push(`The ${NUMBER_WORDS[object.kind]} was not in the text, so it is left blank.`);
  }
  for (const [name, type] of Object.entries(DETAILS[object.kind] || {})) {
    if (type !== 'when' || typeof d[name] !== 'string') continue;
    const m = /(?:^|T)(\d{2}):(\d{2})$/.exec(d[name]);
    if (!m || timeInText(m[1], m[2], squashed)) continue;
    if (d[name].includes('T')) d[name] = d[name].slice(0, 10); else delete d[name];
    notes.push(`The ${fieldWord(name)} time was not in the text, so it is left blank.`);
  }
}

// A flight's times against its two airports' zones.
function checkFlight(object, notes) {
  const d = object.details;
  if (object.kind !== 'flight' || !d) return;
  const from = d.from && d.from.code ? airports.airport(d.from.code) : null;
  const to = d.to && d.to.code ? airports.airport(d.to.code) : null;
  if (!from || !to || !from.tz || !to.tz) return;
  if (typeof d.departs !== 'string' || typeof d.arrives !== 'string' || !d.departs.includes('T') || !d.arrives.includes('T')) return;
  const minutes = airports.minutesBetween(d.departs, from.tz, d.arrives, to.tz);
  if (minutes === null) return;
  if (minutes < 1 || minutes > MAX_FLIGHT_MINUTES) {
    delete d.arrives;
    delete d.minutes;
    notes.push(`The arrival time does not fit the departure in ${from.code} and ${to.code} time, so it is left blank.`);
    return;
  }
  if (d.minutes === undefined) d.minutes = minutes;
}

// What a row says about its days.
function checkDays(object, trip, notes, words) {
  const d = object.details || {};
  if (object.kind === 'hotel' && typeof d.checkIn === 'string' && typeof d.checkOut === 'string' && d.checkOut.slice(0, 10) < d.checkIn.slice(0, 10)) {
    notes.push('Check-out is before check-in.');
  }
  if (!trip.first || !trip.last) return;
  const firstWhen = Object.entries(DETAILS[object.kind] || {}).find(([name, type]) => (type === 'when' || type === 'day') && typeof d[name] === 'string' && /^\d{4}-/.test(d[name]));
  const day = object.date || (firstWhen ? d[firstWhen[0]].slice(0, 10) : '');
  if (!day) return;
  const ms = dayMs(day);
  if (ms < dayMs(trip.first) - FAR_DAYS * 864e5 || ms > dayMs(trip.last) + FAR_DAYS * 864e5) notes.push(`This is more than ${FAR_DAYS} days from the ${words.space}'s dates.`);
}

// The fields of a raw object's details that were given but not kept by the format (a value in a shape it does not take).
function lostFields(raw, cleaned) {
  const given = raw && raw.details && typeof raw.details === 'object' && !Array.isArray(raw.details) ? Object.keys(raw.details) : [];
  const kept = cleaned && cleaned.details ? Object.keys(cleaned.details) : [];
  const fields = DETAILS[cleaned && cleaned.kind] || {};
  return given.filter((k) => Object.hasOwn(fields, k) && !kept.includes(k));
}

// One answer (prompts.parse's readExtract) checked. `ctx`: { text (as sent), trip, today (YYYY-MM-DD), kinds, words }.
// Answers { readable, objects, notes, dropped, reasons, problems }:
//   objects   the objects kept, in the objects format (cleanObject, imported), at most MAX_EXTRACT
//   notes     one list per object kept, the sentences its row shows
//   dropped   how many objects were not kept, and `reasons` the plain sentences saying why ('"Hotel Marlow" was left out: ...')
//   problems  what a repair ask lists (shape problems only: the text checks are not repaired)
function reviewExtract(read, ctx) {
  const { text, trip, today, kinds, words } = ctx;
  if (!read || !read.read) return { readable: false, objects: [], notes: [], dropped: 0, reasons: [], problems: ['The answer was not one JSON object with "objects" and "unread".'] };
  const squashed = squash(text);
  const objects = [];
  const notes = [];
  const reasons = [];
  const problems = [];
  let dropped = 0;
  read.objects.forEach((given, i) => {
    const at = i + 1;
    const title = given && typeof given === 'object' && typeof given.title === 'string' ? given.title.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    const named = title ? `"${title}"` : 'A booking';
    const why = whyDropped(given, kinds);
    if (why) {
      dropped += 1;
      reasons.push(`${named} was left out: ${why}.`);
      problems.push(`${cap(words.object)} ${at}: ${why}.`);
      return;
    }
    const years = resolveYears(given, text, trip, today);
    const cleaned = cleanObject(years.raw, { imported: true });
    if (!cleaned) {
      dropped += 1;
      reasons.push(`${named} was left out: nothing in it could be read.`);
      problems.push(`${cap(words.object)} ${at}: it has neither "content" nor any "details" field in the shape asked for.`);
      return;
    }
    const rowNotes = [...years.notes];
    for (const k of lostFields(years.raw, cleaned)) {
      problems.push(`${cap(words.object)} ${at}: "${k}" is not in the shape asked for.`);
      rowNotes.push(`${cap(fieldWord(k))} could not be read, so it is left blank.`);
    }
    checkAgainstText(cleaned, squashed, rowNotes);
    checkFlight(cleaned, rowNotes);
    if (cleaned.details && !Object.keys(cleaned.details).length) delete cleaned.details;
    if (!cleaned.details && !cleaned.content) {
      dropped += 1;
      reasons.push(`${named} was left out: nothing in it was in the text.`);
      return;
    }
    checkDays(cleaned, trip, rowNotes, words);
    if (objects.length >= MAX_EXTRACT) {
      dropped += 1;
      if (!reasons.some((r) => r.startsWith('Only the first'))) reasons.push(`Only the first ${MAX_EXTRACT} bookings are read from one paste; paste the rest on their own.`);
      return;
    }
    objects.push(cleaned);
    notes.push(rowNotes);
  });
  return { readable: true, objects, notes, dropped, reasons, problems: problems.slice(0, MAX_PROBLEMS) };
}

module.exports = { reviewExtract, resolveYears, yearFor, yearWritten, timeInText, squash, FAR_DAYS, MAX_FLIGHT_MINUTES };
