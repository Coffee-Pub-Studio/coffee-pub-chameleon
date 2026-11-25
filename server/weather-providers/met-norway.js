// MET Norway Locationforecast 2.0 (https://api.met.no/weatherapi/locationforecast/2.0/documentation), the compact form.
//
// THE RULE (server/weather-providers/index.js): a registered adapter is for a service that is free for commercial use, with no
// payment and no key. Terms read on 2026-11-25 (their last revision: 2026-11-05):
//   - Terms of Service: https://api.met.no/doc/TermsOfService
//   - Licence: https://api.met.no/doc/License (CC BY 4.0 and NLOD 2.0); FAQ: https://api.met.no/doc/FAQ ("Is this API free,
//     even for commercial use? Yes!", paid-for apps included). No key, no account, no payment.
//   - CC BY 4.0: credit MET Norway as the source, link the licence and say what was changed, never in a way that suggests MET
//     Norway endorses this app; the FAQ adds that processed data must be marked as derived and not MET Norway's responsibility.
//     Nothing here may look as if it were made by Yr, NRK or MET Norway. `credit` below does all of that: it is attribution only.
//   - The terms are a binding agreement that a person in authority accepts; they cannot be accepted by software. So nothing is
//     asked until an admin chooses this service in the Itinerary's settings (`terms` is shown with the choice).
//   - Identification: a User-Agent with the app's name and version and a way to reach whoever runs it (a link to a GitHub
//     repository where issues can be opened is named as valid). `headers()` sends "<product>/<version> (+<repository>)".
//   - Positions: at most 4 decimals; the lookup sends 2 (server/weather.js, positionKey).
//   - Caching: never repeat a request before its Expires; send If-Modified-Since with the last Last-Modified; for
//     Locationforecast, not more often than every 30 minutes in the Nordic area and every 3 hours elsewhere. server/weather.js
//     keeps Expires and Last-Modified per position and waits for the later of Expires and `minAskMs` (3 hours, which meets both).
//   - Traffic: under 20 requests a second in total for the whole app; https only; redirects and gzip supported (fetch does both).
//
// What it gives: forecasts from now to about ten days ahead, in UTC, hourly for the first two or three days and then every six
// hours. Past days are not in it (`pastDays: false`: they are never asked for and answer `unavailable`). The compact form has
// the air temperature at each time and a symbol for each period (the next 1, 6 or 12 hours); it has no chance of rain, so
// `rain` is null unless a `probability_of_precipitation` is present (it is only in the complete form, in the Nordic area).
//
// How a day is cut: MET's times are UTC. Each is moved to the place's own day by the offset its longitude gives (a whole hour
// for every 15 degrees, the sun's time rounded), read from the answer's own position. That is the place's civil day give or
// take an hour or two (a time zone wider than its longitude, summer time); it is never a day off. A day is kept only when its
// readings cover at least 18 of its 24 hours, so a part day at the end of the forecast is dropped rather than given a wrong
// high and low; the first day (the rest of today) is kept while at least 6 hours of it are left, and its high and low are those
// of the hours left. The high and low are the highest and lowest `air_temperature` of the day's readings (with six-hour steps
// the true high and low can fall between readings). The day's word: when rain, snow, a storm, drizzle or fog fills at least 3
// of the daytime hours (06 to 18 local), the most severe of them; otherwise the sky word that fills most of the daytime
// (a tie going to the cloudier). With no daytime reading left, the whole day is read the same way.
'use strict';

const { userAgent, REPOSITORY_URL } = require('../product-name');

const HOUR = 3600 * 1000;

// Every symbol MET lists (github.com/metno/weathericons, weather/legend.csv: 41 symbols; the ones with variants come with
// _day, _night or _polartwilight, which are dropped before reading). The two spelled with "lights" are MET's own typing.
const SYMBOLS = {
  clearsky: 'clear',
  fair: 'partly',
  partlycloudy: 'partly',
  cloudy: 'cloudy',
  fog: 'fog',
  lightrainshowers: 'drizzle',
  rainshowers: 'rain',
  heavyrainshowers: 'rain',
  lightrainshowersandthunder: 'storm',
  rainshowersandthunder: 'storm',
  heavyrainshowersandthunder: 'storm',
  lightsleetshowers: 'snow',
  sleetshowers: 'snow',
  heavysleetshowers: 'snow',
  lightssleetshowersandthunder: 'storm',
  sleetshowersandthunder: 'storm',
  heavysleetshowersandthunder: 'storm',
  lightsnowshowers: 'snow',
  snowshowers: 'snow',
  heavysnowshowers: 'snow',
  lightssnowshowersandthunder: 'storm',
  snowshowersandthunder: 'storm',
  heavysnowshowersandthunder: 'storm',
  lightrain: 'drizzle',
  rain: 'rain',
  heavyrain: 'rain',
  lightrainandthunder: 'storm',
  rainandthunder: 'storm',
  heavyrainandthunder: 'storm',
  lightsleet: 'snow',
  sleet: 'snow',
  heavysleet: 'snow',
  lightsleetandthunder: 'storm',
  sleetandthunder: 'storm',
  heavysleetandthunder: 'storm',
  lightsnow: 'snow',
  snow: 'snow',
  heavysnow: 'snow',
  lightsnowandthunder: 'storm',
  snowandthunder: 'storm',
  heavysnowandthunder: 'storm',
};

// A MET symbol as one of our words, or null when it is not one MET lists.
function wordOf(symbol) {
  if (typeof symbol !== 'string') return null;
  const base = symbol.replace(/_(day|night|polartwilight)$/, '');
  return Object.hasOwn(SYMBOLS, base) ? SYMBOLS[base] : null;
}

const WET = ['storm', 'snow', 'rain', 'drizzle', 'fog']; // most severe first
const SKY = ['cloudy', 'partly', 'clear']; // cloudier first, for a tie
const MIN_HOURS = 18; // a whole day's readings must cover at least this many of its hours
const MIN_FIRST_HOURS = 6; // the rest of today, at least this much of it
const WET_HOURS = 3; // daytime hours of rain, snow, a storm, drizzle or fog that make the day's word

function dayWord(spans) {
  const day = spans.filter((s) => s.mid >= 6 && s.mid < 18);
  const use = day.length ? day : spans;
  const hours = {};
  for (const s of use) if (s.word) hours[s.word] = (hours[s.word] || 0) + s.hours;
  const wet = WET.find((w) => (hours[w] || 0) >= WET_HOURS);
  if (wet) return wet;
  let best = null;
  for (const w of SKY) if (hours[w] && (!best || hours[w] > hours[best])) best = w;
  if (best) return best;
  return WET.find((w) => hours[w]) || null; // only a little rain or fog, and no sky word at all
}

module.exports = {
  id: 'met-norway',
  name: 'MET Norway',
  // At most 120 characters: the day-weather popover shows no more (public/sdk, host.ui.dayWeather).
  credit: "Based on data from MET Norway, CC BY 4.0 (creativecommons.org/licenses/by/4.0); our daily summary, not MET Norway's.",
  terms: 'https://api.met.no/doc/TermsOfService',
  needsKey: false,
  pastDays: false,
  aheadDays: 10,
  minAskMs: 3 * HOUR,
  request(lat, lon) {
    const u = new URL('https://api.met.no/weatherapi/locationforecast/2.0/compact');
    u.searchParams.set('lat', lat);
    u.searchParams.set('lon', lon);
    return u.href;
  },
  headers() {
    return { 'User-Agent': userAgent({ contact: REPOSITORY_URL }) };
  },
  parse(json) {
    const series = json && json.properties && json.properties.timeseries;
    if (!Array.isArray(series)) throw new Error('not an answer'); // an answer that is not Locationforecast's
    const coords = json.geometry && Array.isArray(json.geometry.coordinates) ? json.geometry.coordinates : [];
    const lon = Number(coords[0]);
    const offset = Number.isFinite(lon) && Math.abs(lon) <= 180 ? Math.round(lon / 15) * HOUR : 0;
    // Each reading: its time, its temperature, and the period its symbol covers.
    const rows = [];
    for (const t of series.slice(0, 400)) {
      const at = Date.parse(t && t.time);
      if (!Number.isFinite(at)) continue;
      const data = t.data || {};
      const temp = data.instant && data.instant.details ? Number(data.instant.details.air_temperature) : NaN;
      const period = data.next_1_hours ? [1, data.next_1_hours] : data.next_6_hours ? [6, data.next_6_hours] : data.next_12_hours ? [12, data.next_12_hours] : [0, null];
      const rain = [data.next_1_hours, data.next_6_hours, data.next_12_hours]
        .map((p) => (p && p.details ? Number(p.details.probability_of_precipitation) : NaN)).filter(Number.isFinite);
      rows.push({ at, temp, length: period[0], word: period[1] && period[1].summary ? wordOf(period[1].summary.symbol_code) : null, rain });
    }
    rows.sort((a, b) => a.at - b.at);
    const days = new Map(); // "YYYY-MM-DD" -> { temps, spans, rain, hours }
    rows.forEach((r, i) => {
      const next = rows[i + 1];
      // The hours this reading stands for: its period, but never past the next reading.
      const hours = Math.max(0, Math.min(r.length, next ? (next.at - r.at) / HOUR : r.length));
      const local = r.at + offset;
      const day = new Date(local).toISOString().slice(0, 10);
      if (!days.has(day)) days.set(day, { temps: [], spans: [], rain: [], hours: 0 });
      const d = days.get(day);
      if (Number.isFinite(r.temp)) d.temps.push(r.temp);
      const startHour = new Date(local).getUTCHours();
      d.spans.push({ word: r.word, hours, mid: startHour + hours / 2 });
      d.rain.push(...r.rain);
      d.hours += Math.min(hours, 24 - startHour); // a period running past midnight counts only its part of this day
    });
    const out = {};
    let first = true;
    for (const [day, d] of days) {
      const enough = d.hours >= (first ? MIN_FIRST_HOURS : MIN_HOURS);
      first = false;
      const code = dayWord(d.spans);
      if (!enough || !d.temps.length || !code) continue;
      out[day] = { code, high: Math.max(...d.temps), low: Math.min(...d.temps), rain: d.rain.length ? Math.max(...d.rain) : null };
    }
    return out;
  },
  SYMBOLS, wordOf,
};
