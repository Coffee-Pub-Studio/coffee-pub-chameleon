#!/usr/bin/env node
/*
 * check-weather.mjs -- the weather lookup on its own (server/weather.js; documentation/plans/plan-itinerary-weather.md, step 1),
 * against a stand-in HTTP service on this machine (no real network):
 *   - reading an Open-Meteo-shaped answer into day records, and the code table (every code has one of the SDK's words);
 *   - the window: 30 days back to 13 ahead, nothing beyond, and a run outside it is refused before anything is sent;
 *   - what is sent: a position rounded to 2 decimals, the run of days, the fields, the time zone, the key when there is one,
 *     the user-agent, and nothing else (no name, no space, no person);
 *   - the cache: good 3 hours for a forecast day and 24 for a past day, a day older than 40 days dropped, the 20,000-day cap
 *     (the oldest fetched going first), written to DATA_DIR/weather.json and read back, holding nothing identifying;
 *   - a failing service, a slow one, an oversized body, a non-weather answer, a redirect kept on the service, a redirect to a
 *     private address refused (as a link preview refuses it), too many redirects, and https only for a preset.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const W = require('../server/weather.js');
const { REPOSITORY_URL } = require('../server/product-name.js');
const { WeatherCache, WeatherError, askWeather, weatherDays, parseWeather, dayAnswer, dayState, daysBetween, positionKey, CODES, WORDS } = W;

let n = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { console.error(`check-weather: ${name}: ${err.stack || err.message}`); process.exit(1); }
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weather-'));
const NOW = Date.parse('2026-12-01T10:00:00Z');
const answer = (days, extra = {}) => ({
  latitude: 48.86, longitude: 2.29, timezone: 'Europe/Paris',
  daily_units: { time: 'iso8601', weather_code: 'wmo code', temperature_2m_max: '°C', temperature_2m_min: '°C', precipitation_probability_max: '%' },
  daily: {
    time: days.map((d) => d[0]),
    weather_code: days.map((d) => d[1]),
    temperature_2m_max: days.map((d) => d[2]),
    temperature_2m_min: days.map((d) => d[3]),
    precipitation_probability_max: days.map((d) => d[4]),
  },
  ...extra,
});

// The stand-in service: answers by what the test sets, and keeps every request it received.
const seen = [];
let reply = (req, res) => { res.writeHead(500); res.end(); };
const server = http.createServer((req, res) => { seen.push({ url: req.url, headers: req.headers, host: req.headers.host }); reply(req, res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const ADDRESS = `http://127.0.0.1:${port}/v1/forecast`;
const json = (body, status = 200, headers = {}) => (req, res) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
const ask = (from, to, opts = {}) => askWeather(opts.address || ADDRESS, opts.key || '', 48.858372, 2.294481, from, to, { now: NOW, ...opts });
const refused = async (p, kind) => {
  try { await p; } catch (err) { assert.ok(err instanceof WeatherError, `a WeatherError, not ${err && err.message}`); assert.equal(err.kind, kind, err.message); return err; }
  assert.fail(`expected a refusal (${kind})`);
};

await test('reading an answer', () => {
  const days = parseWeather(answer([
    ['2026-12-01', 61, 12.34, 5.06, 40],
    ['2026-12-02', 0, 14, 6, null],
    ['2026-12-03', 1234, 14, 6, 10], // an unknown code: left out
    ['2026-12-04', 3, null, 6, 10], // no high: left out
    ['not a day', 3, 10, 5, 0],
    ['2026-12-05', 95, 20, 15, 140], // a chance past 100 is held at 100
  ]));
  assert.deepEqual(days, {
    '2026-12-01': { code: 61, high: 12.3, low: 5.1, rain: 40 },
    '2026-12-02': { code: 0, high: 14, low: 6, rain: null },
    '2026-12-05': { code: 95, high: 20, low: 15, rain: 100 },
  });
  assert.deepEqual(parseWeather(null), {});
  assert.deepEqual(parseWeather({ daily: { time: 'x' } }), {});
  // The older field name, and an answer in Fahrenheit is kept as Celsius.
  const f = parseWeather({ daily_units: { temperature_2m_max: '°F' }, daily: { time: ['2026-12-01'], weathercode: [2], temperature_2m_max: [50], temperature_2m_min: [32] } });
  assert.deepEqual(f, { '2026-12-01': { code: 2, high: 10, low: 0, rain: null } });
});

await test('the code table', () => {
  for (const [code, [word, words]] of Object.entries(CODES)) {
    assert.ok(WORDS.includes(word), `code ${code}: ${word} is one of the SDK's words`);
    assert.ok(words && words.length <= 40 && /^[A-Z][a-z ]+$/.test(words), `code ${code}: plain words`);
  }
  for (const w of WORDS) assert.ok(Object.values(CODES).some(([x]) => x === w), `${w} is used`);
  assert.deepEqual(dayAnswer({ code: 61, high: 22.4, low: 13.6, rain: 40 }), { code: 'rain', words: 'Light rain', high: 22, low: 14, rain: 40 });
  assert.deepEqual(dayAnswer({ code: 0, high: 22, low: 0, rain: null }, 'f'), { code: 'clear', words: 'Clear sky', high: 72, low: 32, rain: null });
});

await test('the window', () => {
  assert.equal(dayState('2026-12-01', NOW), 'forecast');
  assert.equal(dayState('2026-12-14', NOW), 'forecast'); // today plus 13
  assert.equal(dayState('2026-12-15', NOW), 'outOfRange');
  assert.equal(dayState('2026-11-30', NOW), 'past');
  assert.equal(dayState('2026-11-01', NOW), 'past'); // today minus 30
  assert.equal(dayState('2026-10-31', NOW), 'outOfRange');
  assert.equal(dayState('2026-02-30', NOW), 'outOfRange');
  assert.deepEqual(daysBetween('2026-12-30', '2027-01-02'), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  assert.deepEqual(daysBetween('2026-12-02', '2026-12-01'), []);
  assert.equal(daysBetween('2026-01-01', '2026-12-31').length, 60);
  assert.equal(positionKey(48.858372, 2.294481), '48.86,2.29');
  assert.equal(positionKey(-0.004, -179.996), '0.00,-180.00');
  assert.equal(positionKey(91, 0), null);
  assert.equal(positionKey('x', 0), null);
});

await test('what is sent, and only that', async () => {
  seen.length = 0;
  reply = json(answer([['2026-11-30', 3, 10, 4, 20], ['2026-12-01', 61, 12, 5, 40], ['2026-12-02', 0, 14, 6, 0], ['2026-12-03', 0, 14, 6, 0]]));
  const days = await ask('2026-11-30', '2026-12-02', { key: 'k-123' });
  assert.deepEqual(Object.keys(days), ['2026-11-30', '2026-12-01', '2026-12-02'], 'only the days asked for');
  assert.equal(seen.length, 1);
  const u = new URL(seen[0].url, 'http://x');
  assert.equal(u.pathname, '/v1/forecast');
  assert.deepEqual(Object.fromEntries(u.searchParams), {
    latitude: '48.86', longitude: '2.29', daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto', start_date: '2026-11-30', end_date: '2026-12-02', apikey: 'k-123',
  });
  assert.match(seen[0].headers['user-agent'], new RegExp(`/\\S+ \\(\\+${REPOSITORY_URL.replace(/[.]/g, '\\.')}\\)$`));
  assert.equal(seen[0].headers.cookie, undefined);
  // No key: no key sent. The admin's own query is replaced, never added to.
  seen.length = 0;
  await askWeather(`${ADDRESS}?name=Paris`, '', 48.858372, 2.294481, '2026-12-01', '2026-12-01', { now: NOW });
  const q = new URL(seen[0].url, 'http://x').searchParams;
  assert.equal(q.get('apikey'), null);
  assert.equal(q.get('name'), null);
});

await test('nothing beyond the window is asked', async () => {
  seen.length = 0;
  await refused(ask('2026-12-10', '2026-12-15'), 'range');
  await refused(ask('2026-10-31', '2026-11-02'), 'range');
  await refused(ask('2026-12-02', '2026-12-01'), 'range');
  await refused(askWeather(ADDRESS, '', 95, 0, '2026-12-01', '2026-12-01', { now: NOW }), 'range');
  await refused(ask('2026-12-01', '2026-12-01', { address: 'ftp://127.0.0.1/' }), 'blocked');
  await refused(ask('2026-12-01', '2026-12-01', { address: `http://u:p@127.0.0.1:${port}/` }), 'blocked');
  await refused(ask('2026-12-01', '2026-12-01', { httpsOnly: true }), 'blocked'); // a preset is https only
  assert.equal(seen.length, 0, 'the stand-in saw nothing');
});

await test('a failing service', async () => {
  reply = json({ error: true, reason: 'nope' }, 400);
  await refused(ask('2026-12-01', '2026-12-01'), 'status');
  reply = json('<html>not weather</html>');
  await refused(ask('2026-12-01', '2026-12-01'), 'bad');
  reply = json({ hello: 1 });
  await refused(ask('2026-12-01', '2026-12-01'), 'bad');
  // Too much: declared, and sent without saying.
  reply = json(JSON.stringify({ daily: { time: [] }, pad: 'x'.repeat(W.MAX_BODY) }));
  await refused(ask('2026-12-01', '2026-12-01'), 'big');
  reply = (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write(`{"daily":{"time":[]},"pad":"${'x'.repeat(W.MAX_BODY)}`); res.end('"}'); };
  const chunked = (req, res) => { res.writeHead(200, { 'content-type': 'application/json', 'transfer-encoding': 'chunked' }); for (let i = 0; i < 50; i += 1) res.write('x'.repeat(10 * 1024)); res.end(); };
  await refused(ask('2026-12-01', '2026-12-01'), 'big');
  reply = chunked;
  await refused(ask('2026-12-01', '2026-12-01'), 'big');
  // Nobody there.
  const shut = http.createServer();
  await new Promise((r) => shut.listen(0, '127.0.0.1', r));
  const gone = `http://127.0.0.1:${shut.address().port}/`;
  await new Promise((r) => shut.close(r));
  await refused(ask('2026-12-01', '2026-12-01', { address: gone }), 'unreachable');
  // Too slow: the whole ask is given up (a stand-in fetch, so the check does not wait 6 seconds).
  const slow = (url, opts) => new Promise((_, reject) => { opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('late'), { name: 'TimeoutError' }))); });
  const realTimeout = AbortSignal.timeout;
  AbortSignal.timeout = () => realTimeout.call(AbortSignal, 50);
  try { await refused(ask('2026-12-01', '2026-12-01', { fetchImpl: slow }), 'timeout'); } finally { AbortSignal.timeout = realTimeout; }
  assert.equal(W.FETCH_MS, 6000);
});

await test('redirects', async () => {
  const good = answer([['2026-12-01', 0, 10, 2, 0]]);
  // On the same service: followed.
  reply = (req, res) => (req.url.startsWith('/v1/forecast') ? json('', 302, { location: `/moved${req.url.slice(12)}` })(req, res) : json(good)(req, res));
  assert.deepEqual(await ask('2026-12-01', '2026-12-01'), { '2026-12-01': { code: 0, high: 10, low: 2, rain: 0 } });
  // Elsewhere, to a private address: refused before anything is asked there.
  seen.length = 0;
  reply = json('', 302, { location: `http://127.0.0.2:${port}/v1/forecast` });
  await refused(ask('2026-12-01', '2026-12-01'), 'blocked');
  assert.equal(seen.length, 1, 'only the first ask');
  reply = json('', 302, { location: 'http://169.254.169.254/latest' });
  await refused(ask('2026-12-01', '2026-12-01'), 'blocked');
  // A name that resolves to a private address: refused; to a public one: followed (a stand-in lookup, and a stand-in fetch that
  // takes the public name to the stand-in service).
  reply = json('', 302, { location: 'http://weather.example/v1/other' });
  await refused(ask('2026-12-01', '2026-12-01', { lookup: async () => [{ address: '10.1.2.3', family: 4 }] }), 'blocked');
  const toStandIn = (url, opts) => fetch(url.replace('http://weather.example', `http://127.0.0.1:${port}`), opts);
  reply = (req, res) => (req.url.startsWith('/v1/other') ? json(good)(req, res) : json('', 302, { location: 'http://weather.example/v1/other' })(req, res));
  assert.equal(Object.keys(await ask('2026-12-01', '2026-12-01', { fetchImpl: toStandIn, lookup: async () => [{ address: '93.184.216.34', family: 4 }] })).length, 1);
  // To another kind of address, and for a preset to plain http.
  reply = json('', 302, { location: 'file:///etc/passwd' });
  await refused(ask('2026-12-01', '2026-12-01'), 'blocked');
  // Round and round.
  reply = (req, res) => json('', 302, { location: req.url })(req, res);
  await refused(ask('2026-12-01', '2026-12-01'), 'redirects');
});

await test('the cache: ages, the window, what is kept', async () => {
  let now = NOW;
  const c = new WeatherCache(dir, { now: () => now, saveMs: 10 });
  c.remember(48.858372, 2.294481, { '2026-11-30': { code: 3, high: 9, low: 3, rain: 10 }, '2026-12-01': { code: 61, high: 12, low: 5, rain: 40 } });
  assert.deepEqual(c.get(48.86, 2.29, '2026-12-01'), { code: 61, high: 12, low: 5, rain: 40, got: NOW }, 'kept by the rounded position');
  assert.equal(c.get(48.87, 2.29, '2026-12-01'), null, 'another place');
  now = NOW + 3 * 3600 * 1000 - 1;
  assert.ok(c.get(48.86, 2.29, '2026-12-01'), 'a forecast day is good for 3 hours');
  now = NOW + 3 * 3600 * 1000 + 1;
  assert.equal(c.get(48.86, 2.29, '2026-12-01'), null, 'and no longer');
  assert.ok(c.get(48.86, 2.29, '2026-11-30'), 'a past day is good longer');
  now = NOW + 24 * 3600 * 1000 + 1;
  assert.equal(c.get(48.86, 2.29, '2026-11-30'), null, 'for 24 hours');
  // A day older than 40 days is dropped.
  now = NOW;
  c.remember(10, 10, { '2026-10-23': { code: 0, high: 1, low: 0, rain: 0 }, '2026-10-22': { code: 0, high: 1, low: 0, rain: 0 }, '2026-10-21': { code: 0, high: 1, low: 0, rain: 0 } });
  assert.equal(c.all().has('10.00,10.00|2026-10-21'), false, 'older than 40 days: not kept');
  assert.equal(c.all().has('10.00,10.00|2026-10-22'), true);
  now = NOW + 86400000;
  c.prune();
  assert.equal(c.all().has('10.00,10.00|2026-10-22'), false, 'dropped a day later');
  assert.equal(c.all().has('10.00,10.00|2026-10-23'), true);
  now = NOW;
  c.flush();
  const raw = fs.readFileSync(path.join(dir, 'weather.json'), 'utf8');
  const saved = JSON.parse(raw);
  for (const [k, r] of Object.entries(saved.days)) {
    assert.match(k, /^-?\d+\.\d{2},-?\d+\.\d{2}\|\d{4}-\d{2}-\d{2}$/, 'a key is a rounded position and a day');
    assert.deepEqual(Object.keys(r).sort(), ['code', 'got', 'high', 'low', 'rain'], 'a record holds only its five fields');
  }
  assert.ok(!/[A-Za-z]{3,}/.test(raw.replace(/"(days|code|high|low|rain|got|null)"|null/g, '')), 'no name, word or address in the file');
  // Read back by a new cache.
  const back = new WeatherCache(dir, { now: () => now });
  assert.deepEqual(back.get(48.86, 2.29, '2026-12-01'), { code: 61, high: 12, low: 5, rain: 40, got: NOW });
  // A file that is not ours starts empty and says so; a bad record is skipped.
  fs.writeFileSync(path.join(dir, 'weather.json'), JSON.stringify({ days: { 'Paris|2026-12-01': { code: 0, high: 1, low: 0, rain: 0, got: NOW }, '1.00,1.00|2026-12-01': { code: 0, high: 1, low: 0, got: NOW, name: 'Ann' } } }));
  const odd = new WeatherCache(dir, { now: () => now });
  assert.equal(odd.size(), 1);
  assert.deepEqual(Object.keys(odd.get(1, 1, '2026-12-01')).sort(), ['code', 'got', 'high', 'low', 'rain'], 'a stray field is not kept');
  const errors = [];
  const realError = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    fs.writeFileSync(path.join(dir, 'weather.json'), '{not json');
    assert.equal(new WeatherCache(dir, { now: () => now }).size(), 0);
  } finally { console.error = realError; }
  assert.match(errors.join('\n'), /could not read weather\.json/);
});

await test('the cap', () => {
  let now = NOW;
  const capDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weather-cap-'));
  const c = new WeatherCache(capDir, { now: () => now, saveMs: 10 });
  const day = { '2026-12-01': { code: 0, high: 1, low: 0, rain: 0 } };
  // 20,000 positions, one day each, each fetched a moment later than the one before; then 5 more.
  for (let i = 0; i < W.MAX_DAYS + 5; i += 1) { now = NOW + i; c.remember(Math.floor(i / 300) - 45, (i % 300) / 2 - 75, day); }
  assert.equal(c.size(), W.MAX_DAYS);
  assert.equal(c.get(-45, -75, '2026-12-01'), null, 'the oldest fetched went first');
  assert.ok(c.get(Math.floor((W.MAX_DAYS + 4) / 300) - 45, ((W.MAX_DAYS + 4) % 300) / 2 - 75, '2026-12-01'), 'the newest is kept');
  c.flush();
});

await test('a run of days: kept first, one ask for the rest', async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weather-run-'));
  const c = new WeatherCache(runDir, { now: () => NOW, saveMs: 10 });
  c.remember(48.86, 2.29, { '2026-12-01': { code: 0, high: 20, low: 10, rain: 0 } });
  seen.length = 0;
  reply = json(answer([['2026-12-02', 61, 12, 5, 40], ['2026-12-03', 3, 11, 4, 10]]));
  const days = ['2026-10-01', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-20'];
  const { days: out, failed } = await weatherDays(c, { address: ADDRESS }, 48.858, 2.2945, days, { units: 'c' });
  assert.equal(failed, null);
  assert.deepEqual(out, {
    '2026-10-01': { state: 'outOfRange' },
    '2026-12-01': { state: 'forecast', code: 'clear', words: 'Clear sky', high: 20, low: 10, rain: 0 },
    '2026-12-02': { state: 'forecast', code: 'rain', words: 'Light rain', high: 12, low: 5, rain: 40 },
    '2026-12-03': { state: 'forecast', code: 'cloudy', words: 'Cloudy', high: 11, low: 4, rain: 10 },
    '2026-12-04': { state: 'unavailable' }, // the service left it out
    '2026-12-20': { state: 'outOfRange' },
  });
  assert.equal(seen.length, 1, 'one ask');
  const q = new URL(seen[0].url, 'http://x').searchParams;
  assert.equal(q.get('start_date'), '2026-12-02');
  assert.equal(q.get('end_date'), '2026-12-04');
  // Asked again: all kept, nothing sent. The service failing leaves the kept days and says unavailable for the rest.
  seen.length = 0;
  reply = json({ error: true }, 500);
  const again = await weatherDays(c, { address: ADDRESS }, 48.858, 2.2945, ['2026-12-01', '2026-12-02', '2026-12-05'], { units: 'f' });
  assert.equal(again.days['2026-12-01'].high, 68);
  assert.equal(again.days['2026-12-05'].state, 'unavailable');
  assert.equal(again.failed.kind, 'status');
  assert.equal(seen.length, 1);
  seen.length = 0;
  await weatherDays(c, { address: ADDRESS }, 48.858, 2.2945, ['2026-12-01', '2026-12-02']);
  assert.equal(seen.length, 0, 'all kept: nothing sent');
  // No service: nothing goes out.
  const none = await weatherDays(c, null, 1, 1, ['2026-12-01']);
  assert.deepEqual(none.days, { '2026-12-01': { state: 'unavailable' } });
  assert.equal(seen.length, 0);
  c.flush();
});

// Nothing in the module names a space, a person or an environment.
await test('the module holds no link to a person', () => {
  const src = fs.readFileSync(new URL('../server/weather.js', import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/\b(req|user|login|space|environment|ctx)\b/.test(src), 'no request, user, space or environment in the code');
});

server.close();
console.log(`check-weather: OK (${n} groups)`);
