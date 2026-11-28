#!/usr/bin/env node
/*
 * check-travel-airlines.mjs -- the Itinerary's airline list, matching and links (plan-flight-airline-links.md, step 2):
 * travel-lib-airlines.js run on its own. The list is valid (codes, https addresses, no duplicates, statusLink placeholders),
 * a flight finds its airline (number prefix, three-letter prefix, name and alias, the prefix winning, nothing for an unknown
 * airline), no personal data reaches a link, and the 48-hour window. Entries nobody has opened yet (`checked: null`) are
 * listed as a warning, not a failure, until release prep; with --release (or RELEASE_GATE=1) they fail, which is the release gate. Exits 1 on any failure.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = new URL('../src/', import.meta.url);
const read = (n) => fs.readFileSync(new URL(n, src), 'utf8');
const lib = new Function(`${read('travel-lib-object.js').match(/function flightNumberOf[\s\S]*?\n  \}\n/)[0]}\n${read('travel-lib-airlines.js')}\nreturn { AIRLINES, airlineOf, airlineLinks, flightWindow, airlineText };`)();
const { AIRLINES, airlineOf, airlineLinks, flightWindow, airlineText } = lib;

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`ok - ${name}`); } catch (err) { failures += 1; console.log(`not ok - ${name}\n  ${err.message}`); }
};

test('the list is about 50 airlines, frozen', () => {
  assert.ok(AIRLINES.length >= 45 && AIRLINES.length <= 70, `${AIRLINES.length} entries`);
  assert.ok(Object.isFrozen(AIRLINES) && AIRLINES.every((a) => Object.isFrozen(a)));
});

test('every entry is valid', () => {
  const problems = [];
  for (const a of AIRLINES) {
    const at = a.code || '(no code)';
    if (!/^[A-Z0-9]{2}$/.test(a.code || '') || !/[A-Z]/.test(a.code || '')) problems.push(`${at}: code must be two upper case letters or digits with a letter`);
    if (a.icao !== undefined && !/^[A-Z]{3}$/.test(a.icao)) problems.push(`${at}: icao must be three upper case letters`);
    if (typeof a.name !== 'string' || !a.name.trim()) problems.push(`${at}: no name`);
    if (!a.checkIn && !a.status) problems.push(`${at}: needs a check-in or status address`);
    for (const k of ['checkIn', 'status']) {
      if (a[k] === undefined) continue;
      let u = null;
      try { u = new URL(a[k]); } catch { /* reported below */ }
      if (!u || u.protocol !== 'https:' || !u.hostname || u.username || u.password) problems.push(`${at}: ${k} is not an https address (${a[k]})`);
    }
    if (a.checked !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(a.checked)) problems.push(`${at}: checked must be YYYY-MM or null`);
    if (a.statusLink !== undefined) {
      const holes = (a.statusLink.match(/\{[^}]*\}/g) || []).filter((h) => h !== '{number}' && h !== '{date}');
      if (holes.length || /[{}]/.test(a.statusLink.replace(/\{number\}|\{date\}/g, ''))) problems.push(`${at}: statusLink may use only {number} and {date}`);
      let u = null;
      try { u = new URL(a.statusLink.replace('{number}', '2483').replace('{date}', '2026-12-01')); } catch { /* below */ }
      if (!u || u.protocol !== 'https:' || u.username || u.password || /[{}]/.test(u.hostname) || a.statusLink.split('?')[0].split('/')[2].includes('{')) problems.push(`${at}: statusLink is not an https address with a fixed host`);
    }
  }
  assert.deepEqual(problems, []);
});

test('no duplicate code, ICAO code, name or alias', () => {
  const seen = new Map();
  const dupes = [];
  const add = (kind, key, owner) => {
    const k = `${kind}:${key}`;
    if (seen.has(k) && seen.get(k) !== owner) dupes.push(`${kind} "${key}" in ${seen.get(k)} and ${owner}`);
    seen.set(k, owner);
  };
  for (const a of AIRLINES) {
    add('code', a.code, a.code);
    if (a.icao) add('icao', a.icao, a.code);
    add('name', airlineText(a.name), a.code);
    for (const n of a.aliases) add('name', airlineText(n), a.code);
    for (const n of [a.code, a.icao]) if (n) add('name', airlineText(n), a.code); // a code is also a name people type ("BA")
  }
  assert.deepEqual(dupes, []);
});

// A list of two airlines, one with a status template, for the cases the real list has none of.
const small = [
  { code: 'AA', icao: 'AAA', name: 'Alpha Air', aliases: ['Alpha'], checkIn: 'https://alpha.example/check-in', status: 'https://alpha.example/status', statusLink: 'https://alpha.example/status?flight={number}&day={date}', checked: null },
  { code: 'BB', icao: 'BBB', name: 'Bravo Wings', aliases: [], checkIn: 'https://bravo.example/check-in', checked: null },
];

test('a flight number\'s prefix finds the airline', () => {
  assert.equal(airlineOf('WN 2483', '').code, 'WN');
  assert.equal(airlineOf('wn2483', '').code, 'WN');
  assert.equal(airlineOf('6E 204', '').code, '6E');
  assert.equal(airlineOf('BA 117', 'Something else').code, 'BA');
});

test('a three-letter prefix is the ICAO code', () => {
  assert.equal(airlineOf('SWA2483', '').code, 'WN');
  assert.equal(airlineOf('BAW 117', '').code, 'BA');
});

test('the airline as typed finds it, in any case, by name or alias', () => {
  assert.equal(airlineOf('', 'southwest').code, 'WN');
  assert.equal(airlineOf('', 'British Airways').code, 'BA');
  assert.equal(airlineOf('', 'DELTA AIR LINES').code, 'DL');
  assert.equal(airlineOf('', 'Lufthansa German Airlines').code, 'LH');
  assert.equal(airlineOf('', 'Air-France').code, 'AF');
  assert.equal(airlineOf('Southwest 2483', 'Southwest Airlines Co.').code, 'WN');
});

test('the prefix wins when the typed airline is another', () => {
  assert.equal(airlineOf('WN 2483', 'British Airways').code, 'WN');
  assert.equal(airlineOf('', 'British Airways').code, 'BA');
});

test('no match gives nothing', () => {
  assert.equal(airlineOf('', ''), null);
  assert.equal(airlineOf('', 'Acme Skyways'), null);
  assert.equal(airlineOf('QZ 12', 'Acme Skyways'), null);
  assert.equal(airlineOf('ZZ 99', ''), null);
  assert.equal(airlineOf(null, undefined), null);
  assert.equal(airlineOf('Southwest 2483', ''), null, 'a number that is not a flight number has no prefix');
});

const flight = (more = {}) => ({ kind: 'journey', mode: 'flight', operator: 'Southwest Airlines', number: 'WN 2483', date: '2026-12-10', time: '14:00', arrives: '2026-12-10T17:30', ...more });
const at = (d, h, m = 0) => new Date(2026, 11, d, h, m);

test('the plain page by default', () => {
  const l = airlineLinks(flight(), at(1, 9));
  assert.equal(l.name, 'Southwest Airlines');
  assert.equal(l.checkIn, 'https://www.southwest.com/air/check-in/');
  assert.equal(l.status, 'https://www.southwest.com/air/flight-status/');
});

test('not a flight, or an airline not in the list: no links', () => {
  assert.equal(airlineLinks(flight({ mode: 'train' }), at(10, 9)), null);
  assert.equal(airlineLinks(flight({ kind: 'stay' }), at(10, 9)), null);
  assert.equal(airlineLinks(flight({ operator: 'Acme Skyways', number: 'QZ 12' }), at(10, 9)), null);
  assert.equal(airlineLinks(null, at(10, 9)), null);
});

test('a status link carries only the number\'s digits and the day, and only where the entry has a template', () => {
  const l = airlineLinks(flight({ number: 'AA 2483', operator: '' }), at(10, 9), small);
  assert.equal(l.status, 'https://alpha.example/status?flight=2483&day=2026-12-10');
  assert.equal(l.checkIn, 'https://alpha.example/check-in', 'check-in never carries anything');
  assert.equal(airlineLinks(flight(), at(10, 9)).status, 'https://www.southwest.com/air/flight-status/', 'no template, the plain page');
  assert.equal(airlineLinks(flight({ number: 'AA 2483', date: '' }), at(10, 9), small).status, 'https://alpha.example/status', 'no day, the plain page');
});

test('an entry with only one address gives only that one', () => {
  const l = airlineLinks(flight({ number: 'BB 7', operator: '' }), at(10, 12), small);
  assert.equal(l.status, null);
  assert.deepEqual(l.soon, { checkIn: true, status: false });
});

test('no passenger name, booking code or seat reaches a link', () => {
  const secrets = ['Ada Lovelace', 'LOVELACE', 'XK9Q2Z', '14C', 'ref-12345', 'private note'];
  const personal = { people: ['Ada Lovelace'], who: 'Ada Lovelace', reference: 'XK9Q2Z', seat: '14C', class: 'ref-12345', notes: 'private note', title: 'Ada Lovelace to Denver', from: 'Ada Lovelace' };
  for (const list of [AIRLINES, small]) {
    for (const number of ['WN 2483', 'AA 2483']) {
      const l = airlineLinks(flight({ ...personal, number }), at(10, 9), list);
      if (!l) continue;
      const text = JSON.stringify(l).toLowerCase();
      for (const s of secrets) assert.ok(!text.includes(s.toLowerCase()), `"${s}" is in ${text}`);
    }
  }
  for (const l of [airlineLinks(flight(personal), at(10, 9)), airlineLinks(flight({ ...personal, number: 'AA 2483' }), at(10, 9), small)]) {
    for (const k of ['checkIn', 'status']) assert.ok(!new URL(l[k]).search.includes('Ada') && !new URL(l[k]).search.includes('XK9Q2Z'));
  }
});

test('the window: 49, 47 and 0 hours before, and after landing', () => {
  const f = flight(); // leaves 2026-12-10 14:00, lands 17:30 the same day
  const win = (now) => flightWindow(f, now);
  assert.deepEqual(win(new Date(2026, 11, 8, 13, 0)), { checkIn: false, status: false }, '49 hours before');
  assert.deepEqual(win(new Date(2026, 11, 8, 15, 0)), { checkIn: true, status: true }, '47 hours before');
  assert.deepEqual(win(new Date(2026, 11, 8, 14, 0)), { checkIn: true, status: true }, 'exactly 48 hours before');
  assert.deepEqual(win(new Date(2026, 11, 10, 14, 0)), { checkIn: false, status: true }, 'at departure, check-in is over');
  assert.deepEqual(win(new Date(2026, 11, 10, 20, 0)), { checkIn: false, status: true }, 'landed, the day is not over');
  assert.deepEqual(win(new Date(2026, 11, 10, 23, 59)), { checkIn: false, status: true });
  assert.deepEqual(win(new Date(2026, 11, 11, 0, 0)), { checkIn: false, status: false }, 'the day it lands is over');
  const overnight = flight({ time: '22:00', arrives: '2026-12-11T06:00' });
  assert.equal(flightWindow(overnight, new Date(2026, 11, 11, 12, 0)).status, true, 'an overnight flight lasts to the end of its landing day');
  assert.equal(flightWindow(overnight, new Date(2026, 11, 12, 0, 0)).status, false);
  assert.deepEqual(flightWindow(flight({ date: '' }), at(10, 9)), { checkIn: false, status: false }, 'no day, no window');
  assert.deepEqual(flightWindow(flight(), new Date('nope')), { checkIn: false, status: false });
});

test('airlineLinks says which links belong on the card now', () => {
  assert.deepEqual(airlineLinks(flight(), at(5, 9)).soon, { checkIn: false, status: false });
  assert.deepEqual(airlineLinks(flight(), at(9, 9)).soon, { checkIn: true, status: true });
  assert.deepEqual(airlineLinks(flight(), at(10, 18)).soon, { checkIn: false, status: true });
});

test('the Bookings view always puts a flight\'s links in its row; the card keeps its 48-hour rule', () => {
  const js = read('travel.js');
  assert.ok(js.includes("if (kind === 'journey') airlineRowInto(r.querySelector('.decision-main'), i, true);"), 'a journey row gets the links row, always');
  assert.ok(js.includes('const shown = (key) => (always ? !!links[key] : links.soon[key]);'), 'the card still uses the window');
  assert.ok(/function row\(list[\s\S]*?return r;\s*\}/.test(js), 'row hands its element back');
  assert.ok(/\.decision-main > \.card-airline \{/.test(read('travel.css')), 'the links row is styled inside a Bookings row');
});

// The release gate (Thomas, 2026-11-26: "Show all, with the release gate"): the links show for every entry now, and no release ships until
// a person has opened both addresses of every entry and set `checked`. The default run only warns, so the module's lane stays green; with
// `--release` (or RELEASE_GATE=1) an unchecked entry fails. The project manager runs it at release prep:
//   node modules/travel/test/check-travel-airlines.mjs --release
const release = process.argv.includes('--release') || process.env.RELEASE_GATE === '1';
const unchecked = AIRLINES.filter((a) => a.checked === null);
if (unchecked.length) {
  const sentence = `${unchecked.length} of ${AIRLINES.length} airlines have not been opened and confirmed by a person (checked: null): ${unchecked.map((a) => a.code).join(' ')}`;
  if (release) {
    failures += 1;
    console.log(`not ok - release gate: ${sentence}. Open both addresses of each, then set checked to the month (YYYY-MM).`);
  } else console.log(`warning - ${sentence}`);
} else if (release) console.log(`ok - release gate: all ${AIRLINES.length} airlines are confirmed`);

if (failures) { console.log(`${failures} failed`); process.exit(1); }
console.log('all passed');
