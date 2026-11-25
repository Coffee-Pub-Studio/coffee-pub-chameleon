// The weather on a day (documentation/plans/plan-itinerary-weather.md, step 1): asked from the server of a registered weather
// service (an adapter in server/weather-providers/, see its index.js for the contract and THE RULE: only a service that is free
// for commercial use is ever registered, never a paid one), and kept for a while so one answer serves every space going to the
// same town.
//
// What goes out: a position rounded to 2 decimals (about 1 km) and a first and a last day, in the address the adapter builds.
// Never a name, an address, a space, an environment, a person or anything a person typed. Nothing goes out when no service is
// chosen: the caller only asks with an adapter.
//
// What is kept: DATA_DIR/weather.json, at the host's level (beside flight-schedule.json; on a single install, beside the
// environment's own files, and never in an environment's copy). An object keyed by rounded position and day, each
// `{ code, high, low, rain, got }`: the weather word (one of WORDS), the high and low in Celsius (one decimal), the chance of rain in
// whole percent or null, and when it was fetched. Never who asked, which space or environment, what was asked for as a whole,
// or the service's address. A forecast day is good for 3 hours, a day before today for 24; a day older than 40 days is
// dropped, and at most 20,000 days are kept, the oldest fetched going first. Kept in memory, written a moment after a change.
// Beside the days, per rounded position only, when the service was last asked and what its answer said about asking again
// (`asks`: { at, until, modified, answer }): the service's Expires (never ask again before it), its Last-Modified (sent back
// as If-Modified-Since, and a 304 keeps what is kept), and the fetch stamp of the days that answer gave. Dropped a day after
// `until`.
'use strict';

const fs = require('fs');
const path = require('path');
const { userAgent } = require('./product-name');
const { publicAddresses, getOnce } = require('./link-preview');

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
const MAX_WAIT_MS = 24 * HOUR; // an Expires further off than this is taken as this
const REFUSED_WAIT_MS = 30 * 60 * 1000; // after a 429 or 403, no ask of that position for this long

// The weather every adapter answers in: one of eight words (what the SDK draws) and the plain words that go with it.
const WORD_TEXT = {
  clear: 'Clear sky', partly: 'Partly cloudy', cloudy: 'Cloudy', fog: 'Fog', drizzle: 'Drizzle', rain: 'Rain', snow: 'Snow', storm: 'Thunderstorm',
};
const WORDS = Object.keys(WORD_TEXT);

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

// The days an adapter's parse gave, as { "YYYY-MM-DD": { code, high, low, rain } }, each checked: a day that is not a real
// day, a word that is not one of WORDS or a temperature that is not a believable number is left out, not guessed.
function cleanDays(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [t, r] of Object.entries(raw).slice(0, 400)) {
    const day = cleanDay(t);
    if (!day || !r || typeof r !== 'object' || !WORDS.includes(r.code)) continue;
    const high = Number(r.high);
    const low = Number(r.low);
    if (r.high === null || r.low === null || !Number.isFinite(high) || !Number.isFinite(low) || Math.abs(high) > 200 || Math.abs(low) > 200) continue;
    const rain = r.rain === null || r.rain === undefined || r.rain === '' ? NaN : Number(r.rain);
    out[day] = { code: r.code, high: round1(high), low: round1(low), rain: Number.isFinite(rain) ? Math.min(100, Math.max(0, Math.round(rain))) : null };
  }
  return out;
}

// A kept day as the page and the agent get it: the short word, the plain words, the high and low as whole degrees in
// `units` ('c' or 'f'), the chance of rain.
function dayAnswer(rec, units = 'c') {
  const code = WORD_TEXT[rec.code] ? rec.code : 'cloudy';
  const words = WORD_TEXT[code];
  const deg = (c) => Math.round(units === 'f' ? (c * 9) / 5 + 32 : c);
  return { code, words, high: deg(rec.high), low: deg(rec.low), rain: Number.isFinite(rec.rain) ? rec.rain : null };
}

// The address asked, from the adapter, a position and a run of days. Throws a WeatherError when it is not one.
function providerUrl(provider, lat, lon, from, to) {
  const pos = positionKey(lat, lon);
  if (!pos) throw new WeatherError('that is not a position', 'range');
  const [la, lo] = pos.split(',');
  let u;
  try { u = new URL(String(provider.request(la, lo, from, to) || '')); } catch { throw new WeatherError('the weather address is not an address', 'blocked'); }
  const httpsOnly = !provider.allowHttp;
  if (httpsOnly ? u.protocol !== 'https:' : !/^https?:$/.test(u.protocol)) throw new WeatherError(httpsOnly ? 'the weather address must be https' : 'the weather address must be http or https', 'blocked');
  if (u.username || u.password) throw new WeatherError('the weather address may not carry a password', 'blocked');
  return u;
}

// Ask the service for one position and one run of days, `from` through `to`, all inside the window (30 days back to 13
// ahead; anything beyond is refused, never asked). `provider` is a registered adapter. Returns its parse, checked (cleanDays).
// Throws a WeatherError.
//
// The adapter's address is asked as it is. A redirect to anywhere else (another host or port) must be https (http too only
// for the test stand-in) and resolve to public addresses only, as a link preview
// is held (server/link-preview.js), and it is then asked at exactly the addresses that were checked (getOnce, which
// connects to them and never looks the name up a second time, so a name cannot answer public to the check and private to
// the ask); at most 3. The user-agent is the product and its version only, with no contact address, as a link preview
// sends, unless the adapter's `headers()` gives the one its service asks for (MET Norway: with the repository's address).
// `ifModifiedSince`: the Last-Modified of the answer that is kept, sent back so an unchanged forecast answers 304 (and then
// the days are {} and `meta.notModified` is true). `meta`, when given, is filled in: `expires` (ms, from the answer's
// Expires, or 0), `modified` (its Last-Modified, or ''), `status` (the status of a refusal). `fetchImpl`, `lookup` and
// `getImpl` are replaced only by tools/check-weather.mjs.
async function askWeather(provider, lat, lon, from, to, { now = Date.now(), fetchImpl = fetch, lookup, getImpl = getOnce, ifModifiedSince = '', meta = {} } = {}) {
  const a = cleanDay(from);
  const b = cleanDay(to);
  if (!a || !b || a > b) throw new WeatherError('those are not days in order', 'range');
  if (dayState(a, now) === 'outOfRange' || dayState(b, now) === 'outOfRange') throw new WeatherError(`weather is only asked from ${BACK_DAYS} days back to ${AHEAD_DAYS} days ahead`, 'range');
  const httpsOnly = !provider.allowHttp;
  const first = providerUrl(provider, lat, lon, a, b);
  const headers = { Accept: 'application/json', 'User-Agent': userAgent(), ...adapterHeaders(provider) };
  const ims = cleanHttpDate(ifModifiedSince);
  if (ims) headers['If-Modified-Since'] = ims;
  meta.expires = 0;
  meta.modified = '';
  meta.notModified = false;
  const deadline = Date.now() + FETCH_MS;
  const signal = AbortSignal.timeout(FETCH_MS);
  let current = first;
  let pinned = null; // the checked addresses of `current`, when it is not the adapter's own address
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    // One ask: { status, location, text }.
    let got;
    if (pinned) {
      let res;
      try {
        res = await getImpl(current, pinned, MAX_BODY, 'application/json', { timeoutMs: FETCH_MS, deadline });
      } catch (err) {
        if (err && err.code === 'timeout') throw new WeatherError('the weather service took too long', 'timeout');
        throw new WeatherError('the weather service could not be reached', 'unreachable');
      }
      if (res.cut) throw new WeatherError('the weather service answered too much', 'big');
      const h = (name) => { const v = res.headers && res.headers[name]; return (Array.isArray(v) ? v[0] : v) || null; };
      got = { status: res.status, location: h('location'), header: h, text: () => res.body.toString('utf8') };
    } else {
      let res;
      try {
        res = await fetchImpl(current.href, { headers, signal, redirect: 'manual' });
      } catch (err) {
        if (signal.aborted || (err && (err.name === 'TimeoutError' || err.name === 'AbortError'))) throw new WeatherError('the weather service took too long', 'timeout');
        throw new WeatherError('the weather service could not be reached', 'unreachable');
      }
      got = {
        status: res.status,
        location: res.headers.get('location'),
        header: (name) => res.headers.get(name),
        text: async () => {
          const declared = Number(res.headers.get('content-length'));
          if (Number.isFinite(declared) && declared > MAX_BODY) throw new WeatherError('the weather service answered too much', 'big');
          try { return await readCapped(res, MAX_BODY); } catch (err) {
            if (err instanceof WeatherError) throw err;
            if (signal.aborted) throw new WeatherError('the weather service took too long', 'timeout');
            throw new WeatherError('the weather service could not be read', 'unreachable');
          }
        },
      };
    }
    if (got.status === 304 && ims) {
      meta.notModified = true;
      readAsks(got, meta, ims);
      return {};
    }
    if (got.status >= 300 && got.status < 400) {
      if (!got.location) throw new WeatherError(`the weather service answered ${got.status}`, 'status');
      if (hop === MAX_REDIRECTS) throw new WeatherError('the weather service sent the ask elsewhere too many times', 'redirects');
      let next;
      try { next = new URL(got.location, current); } catch { throw new WeatherError('the weather service sent the ask to a bad address', 'blocked'); }
      if ((httpsOnly ? next.protocol !== 'https:' : !/^https?:$/.test(next.protocol)) || next.username || next.password) throw new WeatherError('the weather service sent the ask to an address that is not allowed', 'blocked');
      if (next.origin === first.origin) pinned = null;
      else {
        try {
          pinned = await publicAddresses(next.hostname.replace(/^\[|\]$/g, ''), { deadline, tooLong: 'the weather service took too long', ...(lookup ? { lookup } : {}) });
        } catch (err) {
          if (err && err.code === 'timeout') throw new WeatherError('the weather service took too long', 'timeout');
          throw new WeatherError('the weather service sent the ask to an address that is not allowed', 'blocked');
        }
      }
      current = next;
      continue;
    }
    if (got.status < 200 || got.status >= 300) {
      meta.status = got.status;
      throw new WeatherError(`the weather service answered ${got.status}`, 'status');
    }
    // 203: the service says this version of its answer is going away (MET Norway's terms ask for it to be logged).
    if (got.status === 203 && !warned203.has(provider.id)) { warned203.add(provider.id); console.warn(`the weather service (${provider.id}) says its answer is deprecated (203); its adapter needs updating.`); }
    readAsks(got, meta, '');
    const text = await got.text();
    let json;
    try { json = JSON.parse(text); } catch { throw new WeatherError('the weather service did not answer with weather', 'bad'); }
    if (!json || typeof json !== 'object') throw new WeatherError('the weather service did not answer with weather', 'bad');
    let days;
    try { days = cleanDays(provider.parse(json)); } catch { throw new WeatherError('the weather service did not answer with weather', 'bad'); }
    const wanted = {};
    for (const d of daysBetween(a, b)) if (days[d]) wanted[d] = days[d];
    return wanted;
  }
  throw new WeatherError('the weather service sent the ask elsewhere too many times', 'redirects');
}

const warned203 = new Set();

// The headers an adapter asks to send, kept to plain header names and printable values; never a cookie or an authorization.
function adapterHeaders(provider) {
  if (typeof provider.headers !== 'function') return {};
  const out = {};
  let raw;
  try { raw = provider.headers(); } catch { return out; }
  for (const [k, v] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    if (!/^[A-Za-z][A-Za-z0-9-]{0,40}$/.test(k) || /^(cookie|authorization|host|if-modified-since)$/i.test(k)) continue;
    if (typeof v === 'string' && /^[\x20-\x7e]{1,200}$/.test(v)) out[k] = v;
  }
  return out;
}

// An HTTP date as the service gave it, or '' when it is not one.
function cleanHttpDate(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length <= 64 && /^[\x20-\x7e]+$/.test(s) && Number.isFinite(Date.parse(s)) ? s : '';
}

// What an answer says about asking again: its Expires and its Last-Modified (a 304 that gives none keeps the one sent).
function readAsks(got, meta, sent) {
  const header = typeof got.header === 'function' ? got.header : () => null;
  const exp = Date.parse(header('expires') || '');
  meta.expires = Number.isFinite(exp) ? exp : 0;
  meta.modified = cleanHttpDate(header('last-modified')) || sent;
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
    this.asks = new Map(); // Map("lat,lon" -> { at, until, modified, answer }), read with the days
    this.asking = new Map(); // Map("lat,lon" -> the ask under way), in memory only: two asks at once become one
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
    const asks = raw && raw.asks && typeof raw.asks === 'object' && !Array.isArray(raw.asks) ? raw.asks : {};
    for (const [k, a] of Object.entries(asks).slice(0, MAX_DAYS)) {
      const rec = cleanAsk(a);
      if (rec && /^-?\d{1,2}\.\d{2},-?\d{1,3}\.\d{2}$/.test(k)) this.asks.set(k, rec);
    }
    this.prune();
    return this.days;
  }

  // What the last ask of the service for this position said: { at, until, modified, answer }, or null.
  askOf(lat, lon) {
    const pos = positionKey(lat, lon);
    this.all();
    return (pos && this.asks.get(pos)) || null;
  }

  // Whether the service may be asked for this position now: not before the last answer's Expires, nor before `minAskMs`
  // after the last ask, nor within 30 minutes of a refusal.
  mayAsk(lat, lon) {
    const a = this.askOf(lat, lon);
    return !a || this.now() >= a.until;
  }

  // Note an ask of the service for this position. `meta`: askWeather's; `minAskMs`: the adapter's; `answer`: the fetch stamp
  // of the days the answer gave (kept by remember), or the earlier one when the answer was 304.
  noteAsk(lat, lon, meta, minAskMs, answer) {
    const pos = positionKey(lat, lon);
    if (!pos) return;
    const now = this.now();
    let until = now + (Number.isFinite(minAskMs) ? minAskMs : 0);
    if (meta.status === 429 || meta.status === 403) until = Math.max(until, now + REFUSED_WAIT_MS);
    if (Number.isFinite(meta.expires) && meta.expires > until) until = meta.expires;
    until = Math.min(until, now + MAX_WAIT_MS);
    const before = this.askOf(lat, lon);
    const keep = meta.status ? before : null; // a refusal keeps what the last good answer said
    this.asks.delete(pos);
    this.asks.set(pos, { at: now, until, modified: keep ? keep.modified : meta.modified || '', answer: keep ? keep.answer : answer || 0 });
    this.prune();
    this.save();
  }

  // A 304: what the last answer gave for this position is the service's answer still, so it is fresh again from now.
  refresh(lat, lon, answer) {
    const pos = positionKey(lat, lon);
    if (!pos || !answer) return 0;
    const now = this.now();
    for (const [k, rec] of [...this.all()]) {
      if (k.startsWith(`${pos}|`) && rec.got === answer) { this.days.delete(k); this.days.set(k, { ...rec, got: now }); }
    }
    this.save();
    return now;
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
    if (rec.got > now + HOUR) return null;
    if (now - rec.got <= good) return rec;
    // Older, but the service may not be asked again yet and this is what its last answer gave: still its answer.
    const a = this.asks.get(pos);
    return a && now < a.until && a.answer === rec.got ? rec : null;
  }

  // Keep what the service answered for one position (cleanDays's days).
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
    return got;
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
    const now = this.now();
    for (const [k, a] of this.asks) if (a.until + DAY_MS < now) this.asks.delete(k);
    for (const k of this.asks.keys()) {
      if (this.asks.size <= MAX_DAYS) break;
      this.asks.delete(k);
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
      fs.writeFileSync(tmp, JSON.stringify({ days: Object.fromEntries(this.days), asks: Object.fromEntries(this.asks) }));
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
  const code = r.code;
  const high = Number(r.high);
  const low = Number(r.low);
  const got = Number(r.got);
  if (!WORD_TEXT[code] || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(got) || got <= 0) return null;
  const rain = r.rain === null || r.rain === undefined ? null : Number(r.rain);
  return { code, high: round1(high), low: round1(low), rain: Number.isFinite(rain) ? Math.min(100, Math.max(0, Math.round(rain))) : null, got: Math.round(got) };
}

// An ask as kept: { at, until, modified, answer }, each the right kind. Null when it is not one.
function cleanAsk(a) {
  if (!a || typeof a !== 'object') return null;
  const at = Number(a.at);
  const until = Number(a.until);
  const answer = Number(a.answer);
  if (!Number.isFinite(at) || at <= 0 || !Number.isFinite(until) || until <= 0) return null;
  return { at: Math.round(at), until: Math.round(until), modified: cleanHttpDate(a.modified), answer: Number.isFinite(answer) && answer > 0 ? Math.round(answer) : 0 };
}

// The days of a run the service would be asked for: inside the window, not kept, and inside what the adapter gives (a
// forecast-only service is never asked for a past day, nor any service for a day past its `aheadDays`).
function daysToAsk(cache, provider, lat, lon, days) {
  if (!provider) return [];
  const now = cache.now();
  const today = todayOf(now);
  const last = Number.isInteger(provider.aheadDays) ? addDays(today, provider.aheadDays) : null;
  return days.filter((d) => {
    const state = dayState(d, now);
    if (state === 'outOfRange' || cache.get(lat, lon, d)) return false;
    if (state === 'past' && provider.pastDays === false) return false;
    return !(last && d > last);
  });
}

// Whether answering these days would ask the service now (the route counts only an ask against the limit).
function wouldAsk(cache, provider, lat, lon, days) {
  return daysToAsk(cache, provider, lat, lon, days).length > 0 && cache.mayAsk(lat, lon);
}

// The weather for one position over a run of days, from what is kept first and, for the days still wanted inside the
// window, one ask of the service for the run from the first to the last of them. `provider`: a registered adapter or
// null (nothing is chosen: nothing goes out, and the caller answers `configured: false` before getting here). Returns
// { "YYYY-MM-DD": { state, ...dayAnswer } } with `state` one of forecast, past, outOfRange, unavailable (the service failed
// or left the day out, and nothing good is kept). `failed`: the WeatherError, when the service was asked and failed.
async function weatherDays(cache, provider, lat, lon, days, { units = 'c', fetchImpl, lookup, getImpl } = {}) {
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
  const toAsk = daysToAsk(cache, provider, lat, lon, wanted).sort();
  const pos = positionKey(lat, lon);
  if (toAsk.length && pos && (cache.asking.has(pos) || cache.mayAsk(lat, lon))) {
    // One ask at a time for a position: a second asker waits for the first's answer rather than asking again.
    let asking = cache.asking.get(pos);
    if (!asking) {
      asking = (async () => {
        const last = cache.askOf(lat, lon);
        const kept = last && last.modified && last.answer && [...cache.all()].some(([k, r]) => k.startsWith(`${pos}|`) && r.got === last.answer);
        const meta = {};
        try {
          const got = await askWeather(provider, lat, lon, toAsk[0], toAsk[toAsk.length - 1], { now, fetchImpl, lookup, getImpl, ifModifiedSince: kept ? last.modified : '', meta });
          const answer = meta.notModified ? cache.refresh(lat, lon, last.answer) : cache.remember(lat, lon, got);
          cache.noteAsk(lat, lon, meta, provider.minAskMs, answer);
          return null;
        } catch (err) {
          if (meta.status) cache.noteAsk(lat, lon, meta, 0, 0);
          return err instanceof WeatherError ? err : new WeatherError('the weather service could not be read', 'unreachable');
        } finally {
          cache.asking.delete(pos);
        }
      })();
      cache.asking.set(pos, asking);
    }
    failed = await asking;
  }
  for (const d of wanted) {
    const rec = cache.get(lat, lon, d);
    out[d] = rec ? { state: dayState(d, now), ...dayAnswer(rec, units) } : { state: 'unavailable' };
  }
  return { days: out, failed };
}

module.exports = {
  WeatherCache, WeatherError, askWeather, weatherDays, wouldAsk, cleanDays, dayAnswer, dayState, daysBetween, positionKey, providerUrl,
  WORD_TEXT, WORDS, FILE_NAME, BACK_DAYS, AHEAD_DAYS, DROP_DAYS, MAX_DAYS, MAX_BODY, FETCH_MS, FORECAST_GOOD_MS, PAST_GOOD_MS,
};
