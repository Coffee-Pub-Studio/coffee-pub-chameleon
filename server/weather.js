// The weather on a day (documentation/plans/plan-itinerary-weather.md, step 1): asked from the server of an
// Open-Meteo-compatible service the admin chose, and kept for a while so one answer serves every space going to the same town.
//
// What goes out: a position rounded to 2 decimals (about 1 km), a first and a last day, the daily fields wanted, the time zone
// left to the service ("auto", so each day is the place's own day) and, when the admin gave one, the service's key. Never a
// name, an address, a space, an environment, a person or anything a person typed. Nothing goes out when no service is chosen:
// the caller only asks with an address.
//
// What is kept: DATA_DIR/weather.json, at the host's level (beside flight-schedule.json; on a single install, beside the
// environment's own files, and never in an environment's copy). An object keyed by rounded position and day, each
// `{ code, high, low, rain, got }`: the service's weather code, the high and low in Celsius (one decimal), the chance of rain in
// whole percent or null, and when it was fetched. Never who asked, which space or environment, what was asked for as a whole,
// or the service's address or key. A forecast day is good for 3 hours, a day before today for 24; a day older than 40 days is
// dropped, and at most 20,000 days are kept, the oldest fetched going first. Kept in memory, written a moment after a change.
'use strict';

const fs = require('fs');
const path = require('path');
const { userAgent, REPOSITORY_URL } = require('./product-name');
const { publicAddresses } = require('./link-preview');

const FILE_NAME = 'weather.json';
const FETCH_MS = 6000; // the whole ask, redirects included
const MAX_BODY = 400 * 1024;
const MAX_REDIRECTS = 3;
const MAX_DAYS = 20000;
const MAX_FILE_BYTES = 8 * 1048576; // 20,000 days of about 90 bytes, with room; a larger file is not ours
const BACK_DAYS = 30; // how far back a day may be asked (today minus 30)
const AHEAD_DAYS = 13; // and how far ahead (today plus 13)
const DROP_DAYS = 40; // a kept day older than this is dropped
const HOUR = 3600 * 1000;
const FORECAST_GOOD_MS = 3 * HOUR;
const PAST_GOOD_MS = 24 * HOUR;
const DAY_MS = 86400000;
const DAILY = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max';

// The service's weather codes (WMO 4677, as Open-Meteo gives them): the short word the SDK draws, and the plain words.
const CODES = {
  0: ['clear', 'Clear sky'],
  1: ['partly', 'Mostly clear'],
  2: ['partly', 'Partly cloudy'],
  3: ['cloudy', 'Cloudy'],
  45: ['fog', 'Fog'],
  48: ['fog', 'Freezing fog'],
  51: ['drizzle', 'Light drizzle'],
  53: ['drizzle', 'Drizzle'],
  55: ['drizzle', 'Heavy drizzle'],
  56: ['drizzle', 'Freezing drizzle'],
  57: ['drizzle', 'Heavy freezing drizzle'],
  61: ['rain', 'Light rain'],
  63: ['rain', 'Rain'],
  65: ['rain', 'Heavy rain'],
  66: ['rain', 'Freezing rain'],
  67: ['rain', 'Heavy freezing rain'],
  71: ['snow', 'Light snow'],
  73: ['snow', 'Snow'],
  75: ['snow', 'Heavy snow'],
  77: ['snow', 'Snow grains'],
  80: ['rain', 'Light showers'],
  81: ['rain', 'Showers'],
  82: ['rain', 'Heavy showers'],
  85: ['snow', 'Snow showers'],
  86: ['snow', 'Heavy snow showers'],
  95: ['storm', 'Thunderstorm'],
  96: ['storm', 'Thunderstorm with hail'],
  99: ['storm', 'Thunderstorm with heavy hail'],
};
const WORDS = ['clear', 'partly', 'cloudy', 'fog', 'drizzle', 'rain', 'snow', 'storm'];

class WeatherError extends Error {
  // `kind`: blocked (an address that may not be asked), range (a day outside the window), timeout, status, big, bad
  // (an answer that is not the service's), redirects, unreachable.
  constructor(message, kind) {
    super(message);
    this.kind = kind;
  }
}

const round2 = (n) => Math.round(n * 100) / 100;
const round1 = (n) => Math.round(n * 10) / 10;
const inRange = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

// A day as "YYYY-MM-DD", or '' when it is not a real day.
function cleanDay(text) {
  const s = String(text == null ? '' : text);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s ? s : '';
}
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (day, n) => dayOf(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS);
// Today, as the server's clock says it in UTC. A place far east or west may already be, or still be, a day off; the window
// is wide enough that this only moves its two ends by a day.
const todayOf = (now) => dayOf(now);

// Where a day sits against today: `forecast` (today and the 13 after), `past` (up to 30 days back) or `outOfRange`.
function dayState(day, now = Date.now()) {
  const d = cleanDay(day);
  if (!d) return 'outOfRange';
  const today = todayOf(now);
  if (d >= today && d <= addDays(today, AHEAD_DAYS)) return 'forecast';
  if (d < today && d >= addDays(today, -BACK_DAYS)) return 'past';
  return 'outOfRange';
}

// The days from `from` through `to` (both "YYYY-MM-DD", in order), or [] when either is not a day or they are the wrong way
// round. At most `max` days.
function daysBetween(from, to, max = 60) {
  const a = cleanDay(from);
  const b = cleanDay(to);
  if (!a || !b || a > b) return [];
  const out = [];
  for (let d = a; d <= b && out.length < max; d = addDays(d, 1)) out.push(d);
  return out;
}

// A position as kept and sent: rounded to 2 decimals, as "lat,lon". Null when it is not a position.
function positionKey(lat, lon) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!inRange(la, lo)) return null;
  return `${round2(la).toFixed(2)},${round2(lo).toFixed(2)}`;
}

// The days in an Open-Meteo-shaped answer, as { "YYYY-MM-DD": { code, high, low, rain } } in Celsius. A day missing its
// code or a temperature is left out, not guessed; an unknown code is left out too.
function parseWeather(json) {
  const daily = json && typeof json === 'object' && json.daily && typeof json.daily === 'object' ? json.daily : null;
  if (!daily || !Array.isArray(daily.time)) return {};
  const units = (json.daily_units && typeof json.daily_units === 'object') ? json.daily_units : {};
  const fahrenheit = /F/.test(String(units.temperature_2m_max || ''));
  const toC = (n) => (fahrenheit ? ((n - 32) * 5) / 9 : n);
  const col = (a, b) => (Array.isArray(daily[a]) ? daily[a] : Array.isArray(daily[b]) ? daily[b] : []);
  const codes = col('weather_code', 'weathercode');
  const highs = col('temperature_2m_max');
  const lows = col('temperature_2m_min');
  const rains = col('precipitation_probability_max');
  const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
  const out = {};
  daily.time.slice(0, 400).forEach((t, i) => {
    const day = cleanDay(t);
    const code = num(codes[i]);
    const high = num(highs[i]);
    const low = num(lows[i]);
    if (!day || !Number.isInteger(code) || !CODES[code] || !Number.isFinite(high) || !Number.isFinite(low)) return;
    if (Math.abs(high) > 200 || Math.abs(low) > 200) return;
    const r = num(rains[i]);
    out[day] = { code, high: round1(toC(high)), low: round1(toC(low)), rain: Number.isFinite(r) ? Math.min(100, Math.max(0, Math.round(r))) : null };
  });
  return out;
}

// A kept day as the page and the agent get it: the short word, the plain words, the high and low as whole degrees in
// `units` ('c' or 'f'), the chance of rain.
function dayAnswer(rec, units = 'c') {
  const [code, words] = CODES[rec.code] || ['cloudy', 'Cloudy'];
  const deg = (c) => Math.round(units === 'f' ? (c * 9) / 5 + 32 : c);
  return { code, words, high: deg(rec.high), low: deg(rec.low), rain: Number.isFinite(rec.rain) ? rec.rain : null };
}

// The address asked, from the admin's address, a position and a run of days. Throws a WeatherError when it is not one.
function serviceUrl(address, key, lat, lon, from, to, { httpsOnly = false } = {}) {
  let u;
  try { u = new URL(String(address || '')); } catch { throw new WeatherError('the weather address is not an address', 'blocked'); }
  if (httpsOnly ? u.protocol !== 'https:' : !/^https?:$/.test(u.protocol)) throw new WeatherError(httpsOnly ? 'the weather address must be https' : 'the weather address must be http or https', 'blocked');
  if (u.username || u.password) throw new WeatherError('the weather address may not carry a password', 'blocked');
  const pos = positionKey(lat, lon);
  if (!pos) throw new WeatherError('that is not a position', 'range');
  const [la, lo] = pos.split(',');
  u.search = '';
  u.searchParams.set('latitude', la);
  u.searchParams.set('longitude', lo);
  u.searchParams.set('daily', DAILY);
  u.searchParams.set('timezone', 'auto');
  u.searchParams.set('start_date', from);
  u.searchParams.set('end_date', to);
  if (key) u.searchParams.set('apikey', String(key));
  return u;
}

// Ask the service for one position and one run of days, `from` through `to`, all inside the window (30 days back to 13
// ahead; anything beyond is refused, never asked). `address` is the admin's (a preset's or the custom one), `key` the
// secret setting's value or ''. `httpsOnly` for a preset. Returns parseWeather's days. Throws a WeatherError.
//
// The address the admin chose is asked as it is (a service run on one's own network is allowed). A redirect to anywhere
// else (another host or port) must be http(s) (https for a preset) and resolve to public addresses only, as a link preview
// is held (server/link-preview.js); at most 3. `fetchImpl` and `lookup` are replaced only by tools/check-weather.mjs.
async function askWeather(address, key, lat, lon, from, to, { httpsOnly = false, now = Date.now(), fetchImpl = fetch, lookup } = {}) {
  const a = cleanDay(from);
  const b = cleanDay(to);
  if (!a || !b || a > b) throw new WeatherError('those are not days in order', 'range');
  if (dayState(a, now) === 'outOfRange' || dayState(b, now) === 'outOfRange') throw new WeatherError(`weather is only asked from ${BACK_DAYS} days back to ${AHEAD_DAYS} days ahead`, 'range');
  const first = serviceUrl(address, key, lat, lon, a, b, { httpsOnly });
  const signal = AbortSignal.timeout(FETCH_MS);
  let current = first;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let res;
    try {
      res = await fetchImpl(current.href, { headers: { Accept: 'application/json', 'User-Agent': userAgent({ contact: REPOSITORY_URL }) }, signal, redirect: 'manual' });
    } catch (err) {
      if (signal.aborted || (err && (err.name === 'TimeoutError' || err.name === 'AbortError'))) throw new WeatherError('the weather service took too long', 'timeout');
      throw new WeatherError('the weather service could not be reached', 'unreachable');
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new WeatherError(`the weather service answered ${res.status}`, 'status');
      if (hop === MAX_REDIRECTS) throw new WeatherError('the weather service sent the ask elsewhere too many times', 'redirects');
      let next;
      try { next = new URL(location, current); } catch { throw new WeatherError('the weather service sent the ask to a bad address', 'blocked'); }
      if ((httpsOnly ? next.protocol !== 'https:' : !/^https?:$/.test(next.protocol)) || next.username || next.password) throw new WeatherError('the weather service sent the ask to an address that is not allowed', 'blocked');
      if (next.origin !== first.origin) {
        try {
          await publicAddresses(next.hostname.replace(/^\[|\]$/g, ''), { deadline: Date.now() + FETCH_MS, tooLong: 'the weather service took too long', ...(lookup ? { lookup } : {}) });
        } catch (err) {
          if (err && err.code === 'timeout') throw new WeatherError('the weather service took too long', 'timeout');
          throw new WeatherError('the weather service sent the ask to an address that is not allowed', 'blocked');
        }
      }
      current = next;
      continue;
    }
    if (!res.ok) throw new WeatherError(`the weather service answered ${res.status}`, 'status');
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BODY) throw new WeatherError('the weather service answered too much', 'big');
    let text;
    try { text = await readCapped(res, MAX_BODY); } catch (err) {
      if (err instanceof WeatherError) throw err;
      if (signal.aborted) throw new WeatherError('the weather service took too long', 'timeout');
      throw new WeatherError('the weather service could not be read', 'unreachable');
    }
    let json;
    try { json = JSON.parse(text); } catch { throw new WeatherError('the weather service did not answer with weather', 'bad'); }
    if (!json || typeof json !== 'object' || !json.daily) throw new WeatherError('the weather service did not answer with weather', 'bad');
    const days = parseWeather(json);
    const wanted = {};
    for (const d of daysBetween(a, b)) if (days[d]) wanted[d] = days[d];
    return wanted;
  }
  throw new WeatherError('the weather service sent the ask elsewhere too many times', 'redirects');
}

// The body as text, given up past `max` bytes.
async function readCapped(res, max) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const t = await res.text();
    if (Buffer.byteLength(t) > max) throw new WeatherError('the weather service answered too much', 'big');
    return t;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      reader.cancel().catch(() => {});
      throw new WeatherError('the weather service answered too much', 'big');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

class WeatherCache {
  // `dataDir`: the root DATA_DIR. `now`: the clock, as ms (the check sets it). `saveMs`: how long after a change it is written.
  constructor(dataDir, { now = () => Date.now(), saveMs = 2000 } = {}) {
    this.file = path.join(dataDir, FILE_NAME);
    this.now = now;
    this.saveMs = saveMs;
    this.days = null; // Map("lat,lon|day" -> record), read on first use
    this.timer = null;
  }

  all() {
    if (this.days) return this.days;
    this.days = new Map();
    let raw = null;
    try {
      if (fs.statSync(this.file).size > MAX_FILE_BYTES) {
        console.error(`${FILE_NAME} is larger than expected; the weather starts empty.`);
        return this.days;
      }
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (err) {
      if (err && err.code !== 'ENOENT') console.error(`could not read ${FILE_NAME}; the weather starts empty:`, err.message);
    }
    const kept = raw && raw.days && typeof raw.days === 'object' && !Array.isArray(raw.days) ? raw.days : {};
    const read = [];
    for (const [k, r] of Object.entries(kept)) {
      const rec = cleanRecord(r);
      if (rec && /^-?\d{1,2}\.\d{2},-?\d{1,3}\.\d{2}\|\d{4}-\d{2}-\d{2}$/.test(k) && cleanDay(k.slice(-10))) read.push([k, rec]);
    }
    read.sort((x, y) => x[1].got - y[1].got); // in the order they were fetched, as prune expects
    for (const [k, rec] of read) this.days.set(k, rec);
    this.prune();
    return this.days;
  }

  // A kept day that is still good, or null. Good: a day before today for 24 hours, today and after for 3.
  get(lat, lon, day) {
    const pos = positionKey(lat, lon);
    const d = cleanDay(day);
    if (!pos || !d) return null;
    const rec = this.all().get(`${pos}|${d}`);
    if (!rec) return null;
    const now = this.now();
    const good = d < todayOf(now) ? PAST_GOOD_MS : FORECAST_GOOD_MS;
    return now - rec.got <= good && rec.got <= now + HOUR ? rec : null;
  }

  // Keep what the service answered for one position (parseWeather's days).
  remember(lat, lon, days) {
    const pos = positionKey(lat, lon);
    if (!pos || !days) return;
    const got = this.now();
    const m = this.all();
    const oldest = addDays(todayOf(got), -DROP_DAYS);
    for (const [d, r] of Object.entries(days)) {
      const rec = cleanRecord({ ...r, got });
      if (rec && cleanDay(d) && d >= oldest) { m.delete(`${pos}|${d}`); m.set(`${pos}|${d}`, rec); }
    }
    this.prune();
    this.save();
  }

  // Drop days older than 40 days (looked for at most once a server day), then the oldest fetched past the cap. The map is in
  // the order the days were fetched (remember puts a day at the end; the file is written and read in that order), so the
  // oldest are its first keys.
  prune() {
    const m = this.days;
    if (!m) return;
    const oldest = addDays(todayOf(this.now()), -DROP_DAYS);
    if (this.prunedFor !== oldest) {
      this.prunedFor = oldest;
      for (const k of [...m.keys()]) if (k.slice(-10) < oldest) m.delete(k);
    }
    for (const k of m.keys()) {
      if (m.size <= MAX_DAYS) break;
      m.delete(k);
    }
  }

  size() {
    return this.all().size;
  }

  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.write(); }, this.saveMs);
    if (this.timer.unref) this.timer.unref();
  }

  write() {
    if (!this.days) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ days: Object.fromEntries(this.days) }));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('could not save the weather:', err.message);
    }
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; this.write(); }
  }
}

// A record as kept: only its five fields, each the right kind. Null when it is not one.
function cleanRecord(r) {
  if (!r || typeof r !== 'object') return null;
  const code = Number(r.code);
  const high = Number(r.high);
  const low = Number(r.low);
  const got = Number(r.got);
  if (!Number.isInteger(code) || !CODES[code] || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(got) || got <= 0) return null;
  const rain = r.rain === null || r.rain === undefined ? null : Number(r.rain);
  return { code, high: round1(high), low: round1(low), rain: Number.isFinite(rain) ? Math.min(100, Math.max(0, Math.round(rain))) : null, got: Math.round(got) };
}

// The weather for one position over a run of days, from what is kept first and, for the days still wanted inside the
// window, one ask of the service for the run from the first to the last of them. `service`: { address, key, httpsOnly } or
// null (nothing is chosen: nothing goes out, and the caller answers `configured: false` before getting here). Returns
// { "YYYY-MM-DD": { state, ...dayAnswer } } with `state` one of forecast, past, outOfRange, unavailable (the service failed
// or left the day out, and nothing good is kept). `failed`: the WeatherError, when the service was asked and failed.
async function weatherDays(cache, service, lat, lon, days, { units = 'c', fetchImpl, lookup } = {}) {
  const now = cache.now();
  const out = {};
  const wanted = [];
  for (const d of days) {
    const state = dayState(d, now);
    if (state === 'outOfRange') { out[d] = { state }; continue; }
    const rec = cache.get(lat, lon, d);
    if (rec) out[d] = { state, ...dayAnswer(rec, units) };
    else wanted.push(d);
  }
  let failed = null;
  if (wanted.length && service && service.address) {
    const sorted = [...wanted].sort();
    try {
      const got = await askWeather(service.address, service.key || '', lat, lon, sorted[0], sorted[sorted.length - 1], { httpsOnly: Boolean(service.httpsOnly), now, fetchImpl, lookup });
      cache.remember(lat, lon, got);
    } catch (err) {
      failed = err instanceof WeatherError ? err : new WeatherError('the weather service could not be read', 'unreachable');
    }
  }
  for (const d of wanted) {
    const rec = cache.get(lat, lon, d);
    out[d] = rec ? { state: dayState(d, now), ...dayAnswer(rec, units) } : { state: 'unavailable' };
  }
  return { days: out, failed };
}

module.exports = {
  WeatherCache, WeatherError, askWeather, weatherDays, parseWeather, dayAnswer, dayState, daysBetween, positionKey, serviceUrl,
  CODES, WORDS, FILE_NAME, BACK_DAYS, AHEAD_DAYS, DROP_DAYS, MAX_DAYS, MAX_BODY, FETCH_MS, FORECAST_GOOD_MS, PAST_GOOD_MS,
};
