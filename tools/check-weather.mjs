#!/usr/bin/env node
/*
 * check-weather.mjs -- the weather lookup on its own (server/weather.js; documentation/plans/plan-itinerary-weather.md, step 1),
 * against a stand-in HTTP service on this machine (no real network):
 *   - checking what an adapter's parse gave (a day, a word of the SDK's eight, a believable temperature) and the words table;
 *   - the window: 30 days back to 13 ahead, nothing beyond, and a run outside it is refused before anything is sent;
 *   - what is sent: a position rounded to 2 decimals, the run of days,
 *     the user-agent, and nothing else (no name, no space, no person);
 *   - the cache: good 3 hours for a forecast day and 24 for a past day, a day older than 40 days dropped, the 20,000-day cap
 *     (the oldest fetched going first), written to DATA_DIR/weather.json and read back, holding nothing identifying;
 *   - a failing service, a slow one, an oversized body, a non-weather answer, a redirect kept on the service, a redirect to a
 *     private address refused (as a link preview refuses it), a redirect elsewhere asked at exactly the addresses that were
 *     checked (never looked up a second time), too many redirects, and https only for an adapter that does not say otherwise.
 *   - the user-agent: the product and its version only, no contact address.
 * And the route on a real server (step 2), GET /api/modules/:id/weather, with stand-ins for the weather service and the
 * place search: the manifest's declaration; nothing sent with no provider (and the stand-ins see nothing); a day's place (its
 * first stop at a saved place, else the trip's main place, else none); the exact requests the stand-ins received (a rounded
 * position and days; the main place's text to the place search and nothing else); the range; who may read (a member, a
 * guest by the module's view permission, nobody in a closed space, not a person in another space); the limit; a failing service; a picture map is not checked here.
 * And the agent read (step 5): an agent's token reads the route through the gate (the Agent column's view row, its own spaces,
 * never a closed one), the MCP tool read_weather answers the same days, each call one read and one log line naming the route,
 * and neither leaves any service address or key (there is none to leave).
 * The adapter used throughout is the test stand-in (server/weather-providers/test-standin.js).
 * And MET Norway's adapter (server/weather-providers/met-norway.js), never against the real service: its terms kept in the
 * adapter (the credit, the terms' address, no key); every symbol MET lists mapped to one of the eight words; a week in MET's
 * compact shape read into days (clear, rain, snow, storm, fog, drizzle, cloudy, partly), the place's own day from its
 * longitude, a part day at the end dropped; what is sent (a rounded position; the User-Agent with the repository's address);
 * never asked again before Expires or 3 hours, If-Modified-Since on the next ask and a 304 kept as fresh, 30 minutes' rest
 * after a 429, past days never asked for, one ask for two askers; and the Itinerary offering it with None the default.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const W = require('../server/weather.js');
const { getOnce } = require('../server/link-preview.js');
const pkg = require('../package.json');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { WeatherCache, WeatherError, askWeather, weatherDays, cleanDays, dayAnswer, dayState, daysBetween, positionKey, WORD_TEXT, WORDS } = W;

let n = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { console.error(`check-weather: ${name}: ${err.stack || err.message}`); process.exit(1); }
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weather-'));
const NOW = Date.parse('2026-12-01T10:00:00Z');
// The stand-in's answer, from rows of [day, code, high, low, rain]; a number is the check's shorthand for a word.
const NUM = { 0: 'clear', 1: 'partly', 3: 'cloudy', 45: 'fog', 51: 'drizzle', 61: 'rain', 71: 'snow', 95: 'storm' };
const answer = (rows) => ({ days: rows.map(([day, code, high, low, rain]) => ({ day, code: typeof code === 'number' ? NUM[code] || 'bogus' : code, high, low, rain })) });

// The stand-in service: answers by what the test sets, and keeps every request it received.
const seen = [];
let reply = (req, res) => { res.writeHead(500); res.end(); };
const server = http.createServer((req, res) => { seen.push({ url: req.url, headers: req.headers, host: req.headers.host }); reply(req, res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const ADDRESS = `http://127.0.0.1:${port}/v1/forecast`;
const json = (body, status = 200, headers = {}) => (req, res) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
process.env.WEATHER_TEST_STANDIN = ADDRESS;
const STANDIN = require('../server/weather-providers/test-standin.js');
// An adapter asking `address` (the stand-in's way of building it), with `extra` set on it.
const at = (address, extra = {}) => ({ ...STANDIN, ...extra, request: (la, lo, f, t) => { const u = new URL(address); u.search = ''; for (const [k, v] of Object.entries({ lat: la, lon: lo, from: f, to: t })) u.searchParams.set(k, v); return u.href; } });
const ask = (from, to, opts = {}) => askWeather(opts.provider || STANDIN, 48.858372, 2.294481, from, to, { now: NOW, ...opts });
const refused = async (p, kind) => {
  try { await p; } catch (err) { assert.ok(err instanceof WeatherError, `a WeatherError, not ${err && err.message}`); assert.equal(err.kind, kind, err.message); return err; }
  assert.fail(`expected a refusal (${kind})`);
};

await test('checking what an adapter gave', () => {
  const days = cleanDays({
    '2026-12-01': { code: 'rain', high: 12.34, low: 5.06, rain: 40 },
    '2026-12-02': { code: 'clear', high: 14, low: 6, rain: null },
    '2026-12-03': { code: 'bogus', high: 14, low: 6, rain: 10 }, // not one of the words: left out
    '2026-12-04': { code: 'cloudy', high: null, low: 6, rain: 10 }, // no high: left out
    'not a day': { code: 'cloudy', high: 10, low: 5, rain: 0 },
    '2026-12-05': { code: 'storm', high: 20, low: 15, rain: 140 }, // a chance past 100 is held at 100
    '2026-12-06': { code: 'snow', high: 900, low: 1, rain: 1 }, // not a believable temperature
  });
  assert.deepEqual(days, {
    '2026-12-01': { code: 'rain', high: 12.3, low: 5.1, rain: 40 },
    '2026-12-02': { code: 'clear', high: 14, low: 6, rain: null },
    '2026-12-05': { code: 'storm', high: 20, low: 15, rain: 100 },
  });
  assert.deepEqual(cleanDays(null), {});
  assert.deepEqual(cleanDays('x'), {});
  // The stand-in's own reading: a word it does not know is left out; an answer that is not its own throws.
  assert.deepEqual(STANDIN.parse(answer([['2026-12-01', 61, 12, 5, 40], ['2026-12-02', 1234, 1, 1, 1]])), { '2026-12-01': { code: 'rain', high: 12, low: 5, rain: 40 } });
  assert.throws(() => STANDIN.parse({ hello: 1 }));
});

await test('the words table, and only MET Norway registered', () => {
  assert.deepEqual(Object.keys(WORD_TEXT), WORDS);
  for (const [word, words] of Object.entries(WORD_TEXT)) assert.ok(words && words.length <= 40 && /^[A-Z][a-z ]+$/.test(words), `${word}: plain words`);
  assert.equal(WORDS.length, 8);
  assert.deepEqual(dayAnswer({ code: 'rain', high: 22.4, low: 13.6, rain: 40 }), { code: 'rain', words: 'Rain', high: 22, low: 14, rain: 40 });
  assert.deepEqual(dayAnswer({ code: 'clear', high: 22, low: 0, rain: null }, 'f'), { code: 'clear', words: 'Clear sky', high: 72, low: 32, rain: null });
  // The registry: with the stand-in's variable unset, MET Norway is the only adapter (a fresh process answers this), by
  // default, with no environment variable.
  const out = require('node:child_process').execFileSync(process.execPath, ['-e', "const r=require('./server/weather-providers'); console.log(JSON.stringify(r.list().map(p=>p.id)))"], { cwd: ROOT, env: { PATH: process.env.PATH } }).toString().trim();
  assert.equal(out, '["met-norway"]', 'MET Norway, and the stand-in only when the check asks for it');
  assert.ok(STANDIN.name.startsWith('Test') && /not a weather service/.test(STANDIN.name), 'the stand-in does not look like a product');
  const { valid } = require('../server/weather-providers');
  assert.ok(valid(STANDIN));
  assert.ok(!valid({ ...STANDIN, needsKey: true }), 'an adapter needing a key is not registered');
  assert.ok(!valid({ ...STANDIN, parse: null }));
  assert.ok(!valid({ ...STANDIN, id: 'Bad Id' }));
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
  const days = await ask('2026-11-30', '2026-12-02');
  assert.deepEqual(Object.keys(days), ['2026-11-30', '2026-12-01', '2026-12-02'], 'only the days asked for');
  assert.equal(seen.length, 1);
  const u = new URL(seen[0].url, 'http://x');
  assert.equal(u.pathname, '/v1/forecast');
  // The adapter is given a position rounded to 2 decimals and the days, and nothing else.
  assert.deepEqual(Object.fromEntries(u.searchParams), { lat: '48.86', lon: '2.29', from: '2026-11-30', to: '2026-12-02' });
  // The product and its version, and no contact address: nothing that says who runs this server.
  assert.match(seen[0].headers['user-agent'], new RegExp(`^[\\x21-\\x7e]+/${pkg.version.replace(/[.]/g, '\\.')}$`));
  assert.ok(!/https?:|@|\(/.test(seen[0].headers['user-agent']), 'no address in the user-agent');
  assert.equal(seen[0].headers.cookie, undefined);
  // An adapter that is given more than it should is not given it: request gets four arguments, a position and two days.
  assert.equal(STANDIN.request.length, 4);
  const given = [];
  await ask('2026-12-01', '2026-12-01', { provider: { ...STANDIN, request: (...args) => { given.push(args); return STANDIN.request(...args); } } });
  assert.deepEqual(given, [['48.86', '2.29', '2026-12-01', '2026-12-01']]);
});

await test('nothing beyond the window is asked', async () => {
  seen.length = 0;
  await refused(ask('2026-12-10', '2026-12-15'), 'range');
  await refused(ask('2026-10-31', '2026-11-02'), 'range');
  await refused(ask('2026-12-02', '2026-12-01'), 'range');
  await refused(askWeather(STANDIN, 95, 0, '2026-12-01', '2026-12-01', { now: NOW }), 'range');
  await refused(ask('2026-12-01', '2026-12-01', { provider: at('ftp://127.0.0.1/') }), 'blocked');
  await refused(ask('2026-12-01', '2026-12-01', { provider: at(`http://u:p@127.0.0.1:${port}/`) }), 'blocked');
  await refused(ask('2026-12-01', '2026-12-01', { provider: at(ADDRESS, { allowHttp: false }) }), 'blocked'); // an adapter is https only unless it says otherwise
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
  reply = json(JSON.stringify({ days: [], pad: 'x'.repeat(W.MAX_BODY) }));
  await refused(ask('2026-12-01', '2026-12-01'), 'big');
  reply = (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write(`{"days":[],"pad":"${'x'.repeat(W.MAX_BODY)}`); res.end('"}'); };
  const chunked = (req, res) => { res.writeHead(200, { 'content-type': 'application/json', 'transfer-encoding': 'chunked' }); for (let i = 0; i < 50; i += 1) res.write('x'.repeat(10 * 1024)); res.end(); };
  await refused(ask('2026-12-01', '2026-12-01'), 'big');
  reply = chunked;
  await refused(ask('2026-12-01', '2026-12-01'), 'big');
  // Nobody there.
  const shut = http.createServer();
  await new Promise((r) => shut.listen(0, '127.0.0.1', r));
  const gone = `http://127.0.0.1:${shut.address().port}/`;
  await new Promise((r) => shut.close(r));
  await refused(ask('2026-12-01', '2026-12-01', { provider: at(gone) }), 'unreachable');
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
  assert.deepEqual(await ask('2026-12-01', '2026-12-01'), { '2026-12-01': { code: 'clear', high: 10, low: 2, rain: 0 } });
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
  // To a public one: followed, and asked at exactly the addresses that were checked (the name is not looked up again). The
  // stand-in for that ask takes the checked address to the stand-in service, and keeps what it was given.
  const pins = [];
  const toStandIn = (target, addresses, ...rest) => { pins.push({ href: target.href, addresses }); return getOnce(new URL(target.href.replace('http://weather.example', `http://127.0.0.1:${port}`)), ['127.0.0.1'], ...rest); };
  let lookups = 0;
  const publicLookup = async () => { lookups += 1; return [{ address: '93.184.216.34', family: 4 }]; };
  reply = (req, res) => (req.url.startsWith('/v1/other') ? json(good)(req, res) : json('', 302, { location: 'http://weather.example/v1/other' })(req, res));
  seen.length = 0;
  assert.equal(Object.keys(await ask('2026-12-01', '2026-12-01', { getImpl: toStandIn, lookup: publicLookup })).length, 1);
  assert.deepEqual(pins, [{ href: 'http://weather.example/v1/other', addresses: ['93.184.216.34'] }], 'asked at the checked addresses');
  assert.equal(lookups, 1, 'looked up once, by the check');
  assert.match(seen[1].headers['user-agent'], new RegExp(`^[\\x21-\\x7e]+/${pkg.version.replace(/[.]/g, '\\.')}$`));
  // The ask elsewhere never goes through fetch (which would look the name up itself).
  const fetched = [];
  const spy = (url, opts) => { fetched.push(url); return fetch(url, opts); };
  await ask('2026-12-01', '2026-12-01', { fetchImpl: spy, getImpl: toStandIn, lookup: publicLookup });
  assert.ok(fetched.length === 1 && fetched[0].startsWith(ADDRESS), 'only the service itself is asked through fetch');
  // Elsewhere and then on again: each hop is checked and pinned; too much there is refused; a failure there is unreachable.
  reply = (req, res) => (req.url.startsWith('/v1/other') ? json(JSON.stringify({ days: [], pad: 'x'.repeat(W.MAX_BODY) }))(req, res) : json('', 302, { location: 'http://weather.example/v1/other' })(req, res));
  await refused(ask('2026-12-01', '2026-12-01', { getImpl: toStandIn, lookup: publicLookup }), 'big');
  reply = json('', 302, { location: 'http://weather.example/v1/other' });
  await refused(ask('2026-12-01', '2026-12-01', { getImpl: async () => { throw Object.assign(new Error('no'), { code: 'unreachable' }); }, lookup: publicLookup }), 'unreachable');
  reply = (req, res) => (req.url.startsWith('/v1/other') ? json('', 302, { location: 'http://inner.example/x' })(req, res) : json('', 302, { location: 'http://weather.example/v1/other' })(req, res));
  await refused(ask('2026-12-01', '2026-12-01', { getImpl: toStandIn, lookup: async (name) => [{ address: name === 'inner.example' ? '192.168.1.5' : '93.184.216.34', family: 4 }] }), 'blocked');
  // To another kind of address, and for an adapter to plain http.
  reply = json('', 302, { location: 'file:///etc/passwd' });
  await refused(ask('2026-12-01', '2026-12-01'), 'blocked');
  // Round and round.
  reply = (req, res) => json('', 302, { location: req.url })(req, res);
  await refused(ask('2026-12-01', '2026-12-01'), 'redirects');
});

await test('the cache: ages, the window, what is kept', async () => {
  let now = NOW;
  const c = new WeatherCache(dir, { now: () => now, saveMs: 10 });
  c.remember(48.858372, 2.294481, { '2026-11-30': { code: 'cloudy', high: 9, low: 3, rain: 10 }, '2026-12-01': { code: 'rain', high: 12, low: 5, rain: 40 } });
  assert.deepEqual(c.get(48.86, 2.29, '2026-12-01'), { code: 'rain', high: 12, low: 5, rain: 40, got: NOW }, 'kept by the rounded position');
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
  c.remember(10, 10, { '2026-10-23': { code: 'clear', high: 1, low: 0, rain: 0 }, '2026-10-22': { code: 'clear', high: 1, low: 0, rain: 0 }, '2026-10-21': { code: 'clear', high: 1, low: 0, rain: 0 } });
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
  assert.ok(!/[A-Za-z]{3,}/.test(raw.replace(/"(days|asks|code|high|low|rain|got|null|clear|partly|cloudy|fog|drizzle|snow|storm)"|"rain"|null/g, '')), 'no name, word or address in the file');
  // Read back by a new cache.
  const back = new WeatherCache(dir, { now: () => now });
  assert.deepEqual(back.get(48.86, 2.29, '2026-12-01'), { code: 'rain', high: 12, low: 5, rain: 40, got: NOW });
  // A file that is not ours starts empty and says so; a bad record is skipped.
  fs.writeFileSync(path.join(dir, 'weather.json'), JSON.stringify({ days: { 'Paris|2026-12-01': { code: 'clear', high: 1, low: 0, rain: 0, got: NOW }, '1.00,1.00|2026-12-01': { code: 'clear', high: 1, low: 0, got: NOW, name: 'Ann' } } }));
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
  const day = { '2026-12-01': { code: 'clear', high: 1, low: 0, rain: 0 } };
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
  c.remember(48.86, 2.29, { '2026-12-01': { code: 'clear', high: 20, low: 10, rain: 0 } });
  seen.length = 0;
  reply = json(answer([['2026-12-02', 61, 12, 5, 40], ['2026-12-03', 3, 11, 4, 10]]));
  const days = ['2026-10-01', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-20'];
  const { days: out, failed } = await weatherDays(c, STANDIN, 48.858, 2.2945, days, { units: 'c' });
  assert.equal(failed, null);
  assert.deepEqual(out, {
    '2026-10-01': { state: 'outOfRange' },
    '2026-12-01': { state: 'forecast', code: 'clear', words: 'Clear sky', high: 20, low: 10, rain: 0 },
    '2026-12-02': { state: 'forecast', code: 'rain', words: 'Rain', high: 12, low: 5, rain: 40 },
    '2026-12-03': { state: 'forecast', code: 'cloudy', words: 'Cloudy', high: 11, low: 4, rain: 10 },
    '2026-12-04': { state: 'unavailable' }, // the service left it out
    '2026-12-20': { state: 'outOfRange' },
  });
  assert.equal(seen.length, 1, 'one ask');
  const q = new URL(seen[0].url, 'http://x').searchParams;
  assert.equal(q.get('from'), '2026-12-02');
  assert.equal(q.get('to'), '2026-12-04');
  // Asked again: all kept, nothing sent. The service failing leaves the kept days and says unavailable for the rest.
  seen.length = 0;
  reply = json({ error: true }, 500);
  const again = await weatherDays(c, STANDIN, 48.858, 2.2945, ['2026-12-01', '2026-12-02', '2026-12-05'], { units: 'f' });
  assert.equal(again.days['2026-12-01'].high, 68);
  assert.equal(again.days['2026-12-05'].state, 'unavailable');
  assert.equal(again.failed.kind, 'status');
  assert.equal(seen.length, 1);
  seen.length = 0;
  await weatherDays(c, STANDIN, 48.858, 2.2945, ['2026-12-01', '2026-12-02']);
  assert.equal(seen.length, 0, 'all kept: nothing sent');
  // No service: nothing goes out.
  const none = await weatherDays(c, null, 1, 1, ['2026-12-01']);
  assert.deepEqual(none.days, { '2026-12-01': { state: 'unavailable' } });
  assert.equal(seen.length, 0);
  c.flush();
});

// --- MET Norway (server/weather-providers/met-norway.js) ----------------------------------------------------------------------
// Never the real service: its answers here are built in MET's compact shape (a GeoJSON Feature, properties.timeseries of
// { time, data: { instant: { details: { air_temperature } }, next_1_hours | next_6_hours | next_12_hours: { summary:
// { symbol_code }, details } } }), hourly first and then every six hours, as the Locationforecast documentation describes.
const MET = require('../server/weather-providers/met-norway.js');
const { REPOSITORY_URL, userAgent } = require('../server/product-name.js');
// Every symbol MET lists (github.com/metno/weathericons, weather/legend.csv, read 2026-11-25), and whether it comes in
// _day, _night and _polartwilight.
const MET_SYMBOLS = {
  clearsky: 1, fair: 1, partlycloudy: 1, cloudy: 0, lightrainshowers: 1, rainshowers: 1, heavyrainshowers: 1,
  lightrainshowersandthunder: 1, rainshowersandthunder: 1, heavyrainshowersandthunder: 1, lightsleetshowers: 1, sleetshowers: 1,
  heavysleetshowers: 1, lightssleetshowersandthunder: 1, sleetshowersandthunder: 1, heavysleetshowersandthunder: 1,
  lightsnowshowers: 1, snowshowers: 1, heavysnowshowers: 1, lightssnowshowersandthunder: 1, snowshowersandthunder: 1,
  heavysnowshowersandthunder: 1, lightrain: 0, rain: 0, heavyrain: 0, lightrainandthunder: 0, rainandthunder: 0,
  heavyrainandthunder: 0, lightsleet: 0, sleet: 0, heavysleet: 0, lightsleetandthunder: 0, sleetandthunder: 0,
  heavysleetandthunder: 0, lightsnow: 0, snow: 0, heavysnow: 0, lightsnowandthunder: 0, snowandthunder: 0, heavysnowandthunder: 0, fog: 0,
};
// The mapping, written out once more by rule so a slip in the adapter's table shows: thunder is a storm; sleet and snow are
// snow; light rain (and light rain showers) is drizzle; other rain is rain; the sky words as they are named.
const expectWord = (s) => (/thunder/.test(s) ? 'storm' : /sleet|snow/.test(s) ? 'snow' : /^lightrain/.test(s) ? 'drizzle' : /rain/.test(s) ? 'rain'
  : { clearsky: 'clear', fair: 'partly', partlycloudy: 'partly', cloudy: 'cloudy', fog: 'fog' }[s]);
// An answer: `rows` are [ISO time, temperature, symbol, hours (1, 6 or 12; 0 for none), chance of rain?].
const metAnswer = (lon, rows) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, 48.86, 35] },
  properties: {
    meta: { updated_at: '2026-12-01T09:12:00Z', units: { air_temperature: 'celsius', precipitation_amount: 'mm' } },
    timeseries: rows.map(([time, temp, symbol, hours, chance]) => ({
      time,
      data: {
        instant: { details: { air_pressure_at_sea_level: 1010, air_temperature: temp, cloud_area_fraction: 50, relative_humidity: 80, wind_from_direction: 200, wind_speed: 3 } },
        ...(hours ? { [`next_${hours}_hours`]: { summary: { symbol_code: symbol }, details: { precipitation_amount: 0, ...(chance === undefined ? {} : { probability_of_precipitation: chance }) } } } : {}),
      },
    })),
  },
});
const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const H = 3600 * 1000;
// Hourly readings from `from` for `n` hours, each with `symbolAt(i)` and a temperature `tempAt(i)`.
const hourly = (from, n, symbolAt, tempAt = () => 5) => Array.from({ length: n }, (_, i) => [iso(Date.parse(from) + i * H), tempAt(i), symbolAt(i), 1]);
const sixHourly = (day, symbols, temps) => symbols.map((s, i) => [`${day}T${String(i * 6).padStart(2, '0')}:00:00Z`, temps[i], s, 6]);
// A week as the service gives it, from 2026-12-01 10:00 UTC (the check's now): hourly to 2026-12-03 12:00, then six-hourly to
// 2026-12-10 06:00, the last day cut short.
const metWeek = () => metAnswer(2.29, [
  ...hourly('2026-12-01T10:00:00Z', 14, () => 'clearsky_day', (i) => 4 + i * 0.5), // the rest of today: clear, 4 to 10.5
  ...hourly('2026-12-02T00:00:00Z', 24, (i) => (i >= 9 && i < 15 ? 'rain' : 'fair_night'), (i) => (i === 14 ? 11.2 : i === 3 ? -1.4 : 6)),
  ...hourly('2026-12-03T00:00:00Z', 12, () => 'heavysnow', () => -2),
  ['2026-12-03T12:00:00Z', -3, 'heavysnow', 6], ['2026-12-03T18:00:00Z', -6, 'lightsnowshowers_night', 6],
  ...sixHourly('2026-12-04', ['cloudy', 'rainandthunder', 'rainandthunder', 'cloudy'], [8, 12, 15, 9]),
  ...sixHourly('2026-12-05', ['fog', 'fog', 'fog', 'cloudy'], [1, 2, 3, 1]),
  ...sixHourly('2026-12-06', ['cloudy', 'lightrain', 'lightrain', 'cloudy'], [3, 4, 5, 3]),
  ...sixHourly('2026-12-07', ['cloudy', 'cloudy', 'partlycloudy_day', 'cloudy'], [3, 4, 5, 3]),
  ...sixHourly('2026-12-08', ['clearsky_night', 'fair_day', 'fair_day', 'clearsky_night'], [0, 4, 7, 2]),
  ...sixHourly('2026-12-09', ['cloudy', 'lightssleetshowersandthunder_polartwilight', 'cloudy', 'cloudy'], [0, 1, 2, 0]),
  ['2026-12-10T00:00:00Z', 0, 'cloudy', 6], ['2026-12-10T06:00:00Z', 1, 'cloudy', 6], // a part day (12 hours): dropped
]);

await test('MET Norway: the terms are kept in the adapter', () => {
  const { valid } = require('../server/weather-providers');
  assert.ok(valid(MET));
  assert.equal(MET.id, 'met-norway');
  assert.equal(MET.needsKey, false);
  assert.equal(MET.pastDays, false, 'forecasts only');
  assert.ok(MET.minAskMs >= 3 * H, 'not asked again within 3 hours (Locationforecast: 30 minutes in the Nordic area, 3 hours elsewhere)');
  assert.equal(MET.terms, 'https://api.met.no/doc/TermsOfService');
  // CC BY 4.0: the source, the licence and its address, and that the daily summary is a change made here.
  assert.equal(MET.credit, "Based on data from MET Norway, CC BY 4.0 (creativecommons.org/licenses/by/4.0); our daily summary, not MET Norway's.");
  assert.ok(MET.credit.length <= 120, 'the popover shows 120 characters');
  assert.ok(!/\b(Yr|NRK)\b/.test(MET.credit + MET.name), 'never looks made by Yr or NRK');
  // No key anywhere: not in the address, not in a header, not in the code.
  assert.equal(MET.request('48.86', '2.29', '2026-12-01', '2026-12-05'), 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=48.86&lon=2.29');
  assert.deepEqual(Object.keys(MET.headers()), ['User-Agent']);
  const src = fs.readFileSync(path.join(ROOT, 'server', 'weather-providers', 'met-norway.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/api[-_]?key|apikey|token|secret|password|process\.env/i.test(src.replace(/needsKey/g, '')), 'no key, token or setting in the adapter');
  // The header comment names the terms, the day they were read, and the licence.
  const head = fs.readFileSync(path.join(ROOT, 'server', 'weather-providers', 'met-norway.js'), 'utf8').split("'use strict'")[0];
  for (const want of ['https://api.met.no/doc/TermsOfService', 'https://api.met.no/doc/License', 'read on 2026-11-25', 'CC BY 4.0', 'commercial']) assert.ok(head.includes(want), `the header says ${want}`);
});

await test('MET Norway: every symbol it lists', () => {
  assert.deepEqual(Object.keys(MET.SYMBOLS).sort(), Object.keys(MET_SYMBOLS).sort(), 'the adapter knows exactly the 41 symbols MET lists');
  for (const [s, variants] of Object.entries(MET_SYMBOLS)) {
    const want = expectWord(s);
    assert.ok(WORDS.includes(want), s);
    assert.equal(MET.wordOf(s), want, s);
    for (const v of ['day', 'night', 'polartwilight']) assert.equal(MET.wordOf(`${s}_${v}`), variants ? want : want, `${s}_${v}`);
  }
  for (const odd of ['', 'sunny', 'clearsky_noon', 'lightssleetshowersandthunder ', null, 3]) assert.equal(MET.wordOf(odd), null, String(odd));
  // Each of the eight words is reached.
  assert.deepEqual([...new Set(Object.values(MET.SYMBOLS))].sort(), [...WORDS].sort());
});

await test('MET Norway: a week read into days', () => {
  const days = cleanDays(MET.parse(metWeek()));
  assert.deepEqual(days, {
    '2026-12-01': { code: 'clear', high: 10.5, low: 4, rain: null }, // the rest of today
    '2026-12-02': { code: 'rain', high: 11.2, low: -1.4, rain: null }, // six daytime hours of rain
    '2026-12-03': { code: 'snow', high: -2, low: -6, rain: null },
    '2026-12-04': { code: 'storm', high: 15, low: 8, rain: null },
    '2026-12-05': { code: 'fog', high: 3, low: 1, rain: null },
    '2026-12-06': { code: 'drizzle', high: 5, low: 3, rain: null },
    '2026-12-07': { code: 'cloudy', high: 5, low: 3, rain: null }, // 6 cloudy daytime hours against 6 partly: the cloudier
    '2026-12-08': { code: 'partly', high: 7, low: 0, rain: null },
    '2026-12-09': { code: 'storm', high: 2, low: 0, rain: null },
  }, 'the compact form has no chance of rain: null, never guessed; 2026-12-10 is a part day and is dropped');
  // A short wet spell does not make the day: two daytime hours of rain on a clear day is clear, three is rain.
  const spell = (n) => MET.parse(metAnswer(0, hourly('2026-12-02T00:00:00Z', 24, (i) => (i >= 10 && i < 10 + n ? 'lightrain' : 'clearsky_day'))))['2026-12-02'].code;
  assert.equal(spell(2), 'clear');
  assert.equal(spell(3), 'drizzle');
  // A night storm does not make the day either; with no daytime reading left, the whole day is read.
  assert.equal(MET.parse(metAnswer(0, hourly('2026-12-02T00:00:00Z', 24, (i) => (i < 4 ? 'rainandthunder' : 'cloudy'))))['2026-12-02'].code, 'cloudy');
  assert.deepEqual(MET.parse(metAnswer(0, hourly('2026-12-01T18:00:00Z', 6, () => 'snow')))['2026-12-01'].code, 'snow');
  // The chance of rain, where the service gives one (the complete form, Nordic area): the day's highest.
  const chance = MET.parse(metAnswer(0, hourly('2026-12-02T00:00:00Z', 24, () => 'rain').map((r, i) => [...r, i === 13 ? 70 : 20])));
  assert.equal(chance['2026-12-02'].rain, 70);
  // The first day needs 6 hours left; a later day 18 of its hours.
  assert.deepEqual(Object.keys(MET.parse(metAnswer(0, [...hourly('2026-12-01T19:00:00Z', 5, () => 'fog'), ...hourly('2026-12-02T00:00:00Z', 17, () => 'fog')]))), [], 'five hours of today, seventeen of tomorrow: neither');
  assert.deepEqual(Object.keys(MET.parse(metAnswer(0, [...hourly('2026-12-01T18:00:00Z', 6, () => 'fog'), ...hourly('2026-12-02T00:00:00Z', 18, () => 'fog')]))), ['2026-12-01', '2026-12-02']);
  // Not its answer: refused, so the lookup says so.
  assert.throws(() => MET.parse({ properties: {} }));
  assert.throws(() => MET.parse({ days: [] }));
  // A reading with no temperature or no symbol is not invented: a day of them is left out.
  assert.deepEqual(MET.parse(metAnswer(0, hourly('2026-12-02T00:00:00Z', 24, () => 'nonsense'))), {});
});

await test('MET Norway: the place\'s own day, from its longitude', () => {
  // San Francisco, longitude -122.42: 8 hours behind UTC. 2026-12-02 01:00 to 07:00 UTC are still the evening of 2026-12-01
  // there, so that day's low is the 0 of 06:00 UTC, and 2026-12-02 runs from 08:00 UTC.
  const sf = metAnswer(-122.42, [
    ...hourly('2026-12-01T08:00:00Z', 24, (i) => (i < 18 ? 'clearsky_day' : 'rain'), (i) => (i === 22 ? 0 : 10)),
    ...hourly('2026-12-02T08:00:00Z', 24, () => 'cloudy', () => 12),
  ]);
  const got = MET.parse(sf);
  assert.deepEqual(Object.keys(got), ['2026-12-01', '2026-12-02']);
  assert.equal(got['2026-12-01'].low, 0);
  assert.equal(got['2026-12-01'].code, 'clear', 'the rain falls after 18:00 there');
  assert.equal(got['2026-12-02'].high, 12);
  // Read in UTC the same answer would have cut the days 8 hours early.
  const utc = MET.parse({ ...sf, geometry: { type: 'Point', coordinates: [0, 48.86, 35] } });
  assert.equal(utc['2026-12-01'].low, 10, 'in UTC, the evening\'s 0 would fall on the next day');
});

// The service, stood in for by `fetchImpl` (no network): it answers `metReply` and keeps what it was sent.
const metSeen = [];
let metReply = () => new Response('{}', { status: 500 });
const metFetch = async (url, init) => { metSeen.push({ url, headers: { ...init.headers } }); return metReply(url, init); };
const LAST_MODIFIED = 'Tue, 01 Dec 2026 09:12:00 GMT';
const metOk = (expiresAt) => () => new Response(JSON.stringify(metWeek()), { status: 200, headers: { 'content-type': 'application/json', expires: new Date(expiresAt).toUTCString(), 'last-modified': LAST_MODIFIED } });

await test('MET Norway: what is sent, Expires, If-Modified-Since and a 304', async () => {
  let now = NOW;
  const c = new WeatherCache(fs.mkdtempSync(path.join(os.tmpdir(), 'weather-met-')), { now: () => now, saveMs: 10 });
  metSeen.length = 0;
  metReply = metOk(NOW + 20 * 60 * 1000); // Expires in 20 minutes
  const want = ['2026-12-01', '2026-12-02', '2026-12-09', '2026-12-10', '2026-12-11'];
  const first = await weatherDays(c, MET, 48.858372, 2.294481, want, { fetchImpl: metFetch });
  assert.equal(first.failed, null);
  assert.equal(metSeen.length, 1, 'one ask');
  assert.equal(metSeen[0].url, 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=48.86&lon=2.29', 'a rounded position and nothing else');
  // The User-Agent the terms ask for: the app, its version and where to reach whoever runs it (the repository, where issues
  // can be opened), and nothing personal.
  assert.equal(metSeen[0].headers['User-Agent'], `${userAgent()} (+${REPOSITORY_URL})`);
  assert.equal(metSeen[0].headers['User-Agent'], userAgent({ contact: REPOSITORY_URL }));
  assert.match(metSeen[0].headers['User-Agent'], new RegExp(`^[\\x21-\\x7e]+/${pkg.version.replace(/[.]/g, '\\.')} \\(\\+https://github\\.com/Coffee-Pub-Studio/coffee-pub-chameleon\\)$`));
  assert.deepEqual(Object.keys(metSeen[0].headers).sort(), ['Accept', 'User-Agent'], 'no other header the first time');
  assert.equal(first.days['2026-12-02'].code, 'rain');
  assert.equal(first.days['2026-12-10'].state, 'unavailable', 'a part day: nothing drawn');
  assert.equal(first.days['2026-12-11'].state, 'unavailable', 'past the forecast');
  // Before Expires, and before 3 hours: never asked again, even for the days it left out.
  metSeen.length = 0;
  now = NOW + 2 * H;
  assert.equal(W.wouldAsk(c, MET, 48.86, 2.29, want), false, 'the route counts no ask');
  const soon = await weatherDays(c, MET, 48.86, 2.29, want, { fetchImpl: metFetch });
  assert.equal(metSeen.length, 0, 'not asked again before 3 hours, though Expires has passed');
  assert.equal(soon.days['2026-12-11'].state, 'unavailable');
  assert.equal(soon.days['2026-12-02'].code, 'rain');
  // After 3 hours: asked again, with If-Modified-Since the last Last-Modified, exactly; a 304 keeps what is kept, fresh.
  now = NOW + 3 * H + 1;
  assert.equal(c.get(48.86, 2.29, '2026-12-02'), null, 'no longer fresh');
  assert.equal(W.wouldAsk(c, MET, 48.86, 2.29, want), true);
  metReply = () => new Response(null, { status: 304, headers: { expires: new Date(now + 5 * H).toUTCString() } });
  const again = await weatherDays(c, MET, 48.86, 2.29, want, { fetchImpl: metFetch });
  assert.equal(metSeen.length, 1);
  assert.equal(metSeen[0].headers['If-Modified-Since'], LAST_MODIFIED);
  assert.equal(again.failed, null, 'a 304 is not a failure');
  assert.equal(again.days['2026-12-02'].code, 'rain', 'the kept days are the answer still');
  assert.ok(c.get(48.86, 2.29, '2026-12-02'), 'and fresh again from now');
  // That 304 said Expires in 5 hours: nothing is asked before it, though 3 hours pass, and the kept days are still served.
  metSeen.length = 0;
  now += 4 * H;
  const later = await weatherDays(c, MET, 48.86, 2.29, want, { fetchImpl: metFetch });
  assert.equal(metSeen.length, 0, 'never before Expires');
  assert.equal(later.days['2026-12-02'].code, 'rain', 'what the last answer gave is still served until it may be asked again');
  // Past days: not in the answer, so never asked for; they answer unavailable.
  metSeen.length = 0;
  const past = await weatherDays(c, MET, 10, 10, ['2026-11-28', '2026-11-30'], { fetchImpl: metFetch });
  assert.deepEqual(past.days, { '2026-11-28': { state: 'unavailable' }, '2026-11-30': { state: 'unavailable' } });
  assert.equal(metSeen.length, 0, 'a forecast-only service is not asked for a past day');
  assert.equal(W.wouldAsk(c, MET, 10, 10, ['2026-11-30']), false);
  // Two askers at once for one position: one ask.
  metSeen.length = 0;
  metReply = metOk(now + 10 * 60 * 1000);
  await Promise.all([weatherDays(c, MET, 20, 20, ['2026-12-02'], { fetchImpl: metFetch }), weatherDays(c, MET, 20, 20, ['2026-12-02'], { fetchImpl: metFetch })]);
  assert.equal(metSeen.length, 1, 'one ask for two askers');
  // A 429 (or 403): nothing asked for that position for 30 minutes; then asked again, If-Modified-Since kept.
  now += 3 * H + 1;
  metSeen.length = 0;
  metReply = () => new Response('slow down', { status: 429 });
  const throttled = await weatherDays(c, MET, 20, 20, ['2026-12-03'], { fetchImpl: metFetch });
  assert.equal(throttled.failed.kind, 'status');
  await weatherDays(c, MET, 20, 20, ['2026-12-03'], { fetchImpl: metFetch });
  now += 29 * 60 * 1000;
  await weatherDays(c, MET, 20, 20, ['2026-12-03'], { fetchImpl: metFetch });
  assert.equal(metSeen.length, 1, 'not asked again within 30 minutes of a 429');
  now += 2 * 60 * 1000;
  metReply = metOk(now + H);
  await weatherDays(c, MET, 20, 20, ['2026-12-03'], { fetchImpl: metFetch });
  assert.equal(metSeen.length, 2);
  assert.equal(metSeen[1].headers['If-Modified-Since'], LAST_MODIFIED, 'the last good answer\'s Last-Modified, not a refusal\'s');
  // None chosen: nothing goes out.
  metSeen.length = 0;
  await weatherDays(c, null, 30, 30, ['2026-12-02'], { fetchImpl: metFetch });
  assert.equal(metSeen.length, 0);
  // What is kept: positions and times only; the Last-Modified is the service's date, nothing of a person.
  c.flush();
  const saved = JSON.parse(fs.readFileSync(c.file, 'utf8'));
  for (const [k, a] of Object.entries(saved.asks)) {
    assert.match(k, /^-?\d+\.\d{2},-?\d+\.\d{2}$/);
    assert.deepEqual(Object.keys(a).sort(), ['answer', 'at', 'modified', 'until']);
    assert.ok(a.modified === '' || a.modified === LAST_MODIFIED);
  }
  // Read back after a restart: still not asked before the saved Expires.
  const back = new WeatherCache(path.dirname(c.file), { now: () => now });
  assert.equal(back.mayAsk(20, 20), false);
});

await test('MET Norway: the Weather module offers it, None is the default, the Itinerary has no setting for it', () => {
  const { fillWeatherAdapters } = require('../server/modules.js');
  const weather = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'weather', 'module.json'), 'utf8'));
  const settings = JSON.parse(JSON.stringify(weather.settings));
  fillWeatherAdapters(settings);
  const service = settings.find((d) => d.key === 'service');
  assert.equal(service.default, 'none', 'nothing goes out until an admin chooses');
  assert.equal(service.options[0].value, 'none');
  assert.ok(service.options.some((o) => o.value === 'met-norway' && o.label === 'MET Norway'), 'MET Norway is offered');
  assert.match(service.help, /administrator of this server has accepted its terms/, 'the help says how it is accepted');
  assert.deepEqual(settings.find((d) => d.key === 'units').options.map((o) => o.value), ['c', 'f']);
  const style = settings.find((d) => d.key === 'iconStyle');
  assert.equal(style.type, 'note', 'one icon style exists, so it is a note, not a choice');
  assert.equal(weather.hooks.weather, true);
  const travel = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'travel', 'module.json'), 'utf8'));
  assert.ok(!travel.settings.some((d) => /^weather/.test(d.key)), 'the Itinerary keeps no weather setting');
});

await test('the terms: accepted by a person once, for those terms only, kept on disk', () => {
  const { ServiceTerms } = require('../server/service-terms.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wx-terms-'));
  const a = { id: 'svc', name: 'Svc', credit: 'c', terms: 'https://example.test/terms' };
  const t = new ServiceTerms(dir);
  assert.equal(t.accepted(a), false, 'nothing is accepted by itself');
  t.accept(a, 'admin', new Date('2026-11-25T10:00:00Z'));
  assert.equal(t.accepted(a), true);
  assert.deepEqual(t.view([{ kind: 'weather', adapter: a }]), [{ id: 'svc', kind: 'weather', name: 'Svc', credit: 'c', terms: 'https://example.test/terms', accepted: true, by: 'admin', at: '2026-11-25T10:00:00.000Z' }]);
  assert.equal(new ServiceTerms(dir).accepted(a), true, 'read back from the file');
  assert.equal(new ServiceTerms(dir).accepted({ ...a, terms: 'https://example.test/terms-v2' }), false, 'moved terms must be accepted again');
  assert.equal(t.withdraw(a), true);
  assert.equal(new ServiceTerms(dir).accepted(a), false);
  fs.writeFileSync(path.join(dir, 'service-terms.json'), '{ not json');
  assert.equal(new ServiceTerms(dir).accepted(a), false, 'a broken file accepts nothing');
});

// Nothing in the module names a space, a person or an environment.
await test('the module holds no link to a person', () => {
  const src = fs.readFileSync(new URL('../server/weather.js', import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/\b(req|user|login|space|environment|ctx)\b/.test(src), 'no request, user, space or environment in the code');
});

// --- the manifest's declaration ---------------------------------------------------------------------------------------------
await test('the declaration: only where a day is; the service and units are not the module\'s', () => {
  const { cleanWeather, ModuleError } = require('../server/modules.js');
  const good = { stops: { prefix: 'plan:', day: 'date', time: 'time', order: 'order', place: 'placeRef' }, main: { key: 'trip:main', place: 'destination', from: 'start', to: 'end' } };
  const scope = ['environment', 'space'];
  assert.equal(cleanWeather(undefined, scope), null, 'none by default');
  assert.deepEqual(cleanWeather(good, scope), { ...good, space: false });
  assert.deepEqual(cleanWeather({ main: { key: 'trip:main' } }, scope), { stops: null, main: { key: 'trip:main', place: '', from: '', to: '' }, space: false });
  // `space: true`: "my days use the space's place" (plan-weather-users.md); alone it is enough, and it is only ever true.
  assert.deepEqual(cleanWeather({ space: true }, scope), { stops: null, main: null, space: true });
  assert.deepEqual(cleanWeather({ ...good, space: true }, scope), { ...good, space: true });
  const bad = (raw, re, sc = scope) => assert.throws(() => cleanWeather(raw, sc), (err) => err instanceof ModuleError && re.test(err.message), JSON.stringify(raw).slice(0, 80));
  bad({ ...good, provider: 'p' }, /the Weather module's settings/);
  bad({ ...good, units: 'u' }, /the Weather module's settings/);
  bad({ ...good, stops: undefined, main: undefined }, /`stops`, `main` or `space`/);
  bad({ space: false }, /`space` must be true/);
  bad({ space: 'yes' }, /`space` must be true/);
  bad({ space: true, provider: 'p' }, /the Weather module's settings/);
  bad({ space: true }, /"space" scope/, ['environment']);
  bad({ ...good, stops: { prefix: 'plan:', day: 'date' } }, /stops `place` must be a field name/);
  bad({ ...good, stops: { ...good.stops, day: '__proto__' } }, /field name/);
  bad({ ...good, main: { key: '../x' } }, /main needs a `key`/);
  bad(good, /"space" scope/, ['environment']);
  // The Itinerary's own declaration reads, and no service, address or key is in it.
  const travel = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'travel', 'module.json'), 'utf8'));
  assert.deepEqual(Object.keys(travel.weather).sort(), ['main', 'stops']);
  assert.deepEqual(cleanWeather(travel.weather, travel.scope).stops.prefix, 'plan:');
  assert.ok(!/open-?meteo|apikey|https?:\/\/api\./i.test(JSON.stringify(travel)), 'no service named or addressed');
  // The Weather module is a service-only module: no surface, the weather hook.
  const { cleanManifest } = require('../server/modules.js');
  const wm = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'weather', 'module.json'), 'utf8'));
  const files = new Set(fs.readdirSync(path.join(ROOT, 'modules', 'weather', 'src')).map((f) => `src/${f}`));
  const clean = cleanManifest(wm, files);
  assert.deepEqual([clean.hooks.weather, Object.keys(clean.surfaces)], [true, []]);
  assert.deepEqual(clean.settings.find((d) => d.key === 'service').options.map((o) => o.value), ['none', 'met-norway', 'standin']);
});

// --- the space's day: pure (server/weather-space.js, plan-weather-users.md) --------------------------------------------------
await test('the space\'s day: today in the main phase, its first day before, none after; the module\'s own dates; today without dates', () => {
  const { weatherSpaceDay } = require('../server/weather-space.js');
  const bands = [{ main: false, dated: true, start: '2026-11-01', end: '2026-11-30' }, { main: true, dated: true, start: '2026-12-10', end: '2026-12-20' }];
  assert.equal(weatherSpaceDay(bands, null, '2026-12-14'), '2026-12-14', 'during the main phase: today');
  assert.equal(weatherSpaceDay(bands, null, '2026-12-10'), '2026-12-10', 'its first day');
  assert.equal(weatherSpaceDay(bands, null, '2026-12-20'), '2026-12-20', 'its last day');
  assert.equal(weatherSpaceDay(bands, null, '2026-12-01'), '2026-12-10', 'before it: its first day, not an earlier phase\'s');
  assert.equal(weatherSpaceDay(bands, null, '2026-12-21'), null, 'after it: none');
  assert.equal(weatherSpaceDay([{ main: true, dated: true, start: '2026-12-10' }], null, '2026-12-10'), '2026-12-10', 'a one-day phase has no end');
  assert.equal(weatherSpaceDay([{ main: true, dated: true, start: '2026-12-10' }], null, '2026-12-11'), null);
  // The phases win over the module's own dates; a main phase with no dates is not one.
  assert.equal(weatherSpaceDay(bands, { from: '2026-01-01', to: '2026-01-02' }, '2026-12-14'), '2026-12-14');
  assert.equal(weatherSpaceDay([{ main: true, dated: false, start: '', end: '' }], { from: '2026-12-10', to: '2026-12-20' }, '2026-12-01'), '2026-12-10', 'undated phases: the module\'s dates');
  // No phases: the module's own first and last day by the same rule.
  const own = { from: '2026-12-10', to: '2026-12-20' };
  for (const none of [[], null, undefined]) {
    assert.equal(weatherSpaceDay(none, own, '2026-12-01'), '2026-12-10', 'before');
    assert.equal(weatherSpaceDay(none, own, '2026-12-15'), '2026-12-15', 'during');
    assert.equal(weatherSpaceDay(none, own, '2026-12-21'), null, 'after');
  }
  assert.equal(weatherSpaceDay([], { from: '2026-12-10', to: '' }, '2026-12-10'), '2026-12-10', 'a first day alone is one day');
  assert.equal(weatherSpaceDay([], { from: '2026-12-10', to: '' }, '2026-12-11'), null);
  assert.equal(weatherSpaceDay([], { from: '2026-12-10', to: '2026-12-05' }, '2026-12-11'), null, 'a last day before the first is the first day alone');
  // No dates at all: today.
  for (const none of [null, {}, { from: '', to: '' }, { from: 'soon', to: 'later' }, { from: '', to: '2026-12-20' }]) assert.equal(weatherSpaceDay([], none, '2026-12-14'), '2026-12-14', JSON.stringify(none));
});

// The gate by mutation: the check above passes only because the code asks these four questions; take any one out of the
// source and the same reading of it must fail, so a refactor that drops one is caught (a live server for each is not needed).
await test('the space route\'s gate is read from the code, and each part of it matters', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
  const fnOf = (text, head) => { const a = text.indexOf(head); assert.ok(a >= 0, `${head} is in the server`); return text.slice(a, text.indexOf('\n}\n', a) + 3); };
  const intact = (text) => {
    const pick = fnOf(text, 'function weatherSpacePick(');
    const route = fnOf(text, "app.get('/api/spaces/:id/weather'").replace(/\n\}\);?$/, '');
    return [
      /factsFor\(req, res\)/.test(route), // signed in, not a guest, in the space
      /weatherSpacePick\(who, perms, space\)/.test(route), // the place, as this asker
      /moduleSpaceRefusal\(entry, who, space\)/.test(pick), // the module on here, the asker in the space
      /!moduleCan\(manifest, perms, 'read'\)/.test(pick), // allowed to read the module the place comes from
      /hide: hiddenFor\(who, manifest, space\.id\)/.test(pick) && /ctx\.hide\.includes\(mn\.place\)/.test(fnOf(text, 'function weatherMainText(')), // a field hidden from them is not their place
      /weatherMainText\(ctx\)/.test(fnOf(text, "app.get('/api/modules/:id/weather'")) && /ctx\.hide\.includes\(st\.place\)/.test(fnOf(text, 'function weatherStopPlaces(')), // the module route's main place and stops' places, by the same rule
      /overLimit\(moduleId, by, 'weather'\)/.test(fnOf(text, 'function weatherCounter(')) && /weatherCounter\(res, pick\.manifest\.id, who\.user\.key\)/.test(route), // counted on the place's module
    ].every(Boolean);
  };
  assert.equal(intact(src), true, 'the gate is as the plan says');
  for (const [name, cut] of [
    ['the facts gate', (t) => t.replace("const ctx = factsFor(req, res);\n  if (!ctx) return;\n  const { who, space, perms } = ctx;", "const ctx = { who: moduleViewer(req), space: store.spaceById(req.params.id), perms: {} };\n  const { who, space, perms } = ctx;")],
    ['the read permission', (t) => t.replace("|| !moduleCan(manifest, perms, 'read')", '')],
    ['the module being on here', (t) => t.replace('moduleSpaceRefusal(entry, who, space) ||', '')],
    ['the hidden fields', (t) => t.replace(' || ctx.hide.includes(mn.place)', '')],
    ['the hidden fields, from the space route', (t) => t.replace('hide: hiddenFor(who, manifest, space.id)', 'hide: []')],
    ['the hidden stop places', (t) => t.replace(' || ctx.hide.includes(st.place)', '')],
    ['the place module\'s limit', (t) => t.replace('weatherCounter(res, pick.manifest.id, who.user.key)', 'weatherCounter(res, "other", who.user.key)')],
  ]) {
    // Cut only in the weather code: from the weather section on (the first match elsewhere must not stand in for it).
    const from = src.indexOf('// --- the weather on a day, from the server');
    const mutated = src.slice(0, from) + cut(src.slice(from));
    assert.notEqual(mutated, src, `${name}: the mutation changed the code`);
    assert.equal(intact(mutated), false, `${name}: taking it out is noticed`);
  }
});

// --- the route, on a real server ------------------------------------------------------------------------------------------
// Stand-ins: the weather service (answers every day asked, by the clock), the place search (Photon-shaped) and LiveKit.
const wxSeen = [];
let wxFails = false;
const wx = http.createServer((req, res) => {
  wxSeen.push({ url: req.url, headers: req.headers });
  if (wxFails) { res.writeHead(500); return res.end(); }
  const q = new URL(req.url, 'http://x').searchParams;
  json(answer(daysBetween(q.get('from'), q.get('to')).map((d) => [d, 61, 12.4, 5.2, 40])))(req, res);
});
const geoSeen = [];
const geo = http.createServer((req, res) => {
  geoSeen.push({ url: req.url, headers: req.headers });
  const q = new URL(req.url, 'http://x').searchParams.get('q') || '';
  const features = /faro/i.test(q) ? [{ geometry: { type: 'Point', coordinates: [-7.930445, 37.019355] }, properties: { name: 'Faro', country: 'Portugal', osm_type: 'R', osm_id: 5400891 } }] : /lisbon/i.test(q) ? [{ geometry: { type: 'Point', coordinates: [-9.139337, 38.722252] }, properties: { name: 'Lisbon', country: 'Portugal', osm_type: 'R', osm_id: 5400890 } }] : [];
  json({ features })(req, res);
});
const lk = http.createServer((req, res) => { req.resume(); req.on('end', () => json({ participants: [] })(req, res)); });
for (const sv of [wx, geo, lk]) await new Promise((r) => sv.listen(0, '127.0.0.1', r));
const WX = `http://127.0.0.1:${wx.address().port}/v1/forecast`;
const GEO = `http://127.0.0.1:${geo.address().port}/api`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weather-route-'));
const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  cwd: ROOT,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ADMIN_PASSWORD: 'testpass1234', AGENT_TOKENS: 'true', WEATHER_TEST_STANDIN: WX, LIVEKIT_API_URL: `http://127.0.0.1:${lk.address().port}` },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOut = '';
const stop = () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });
const fail = async (name, err) => { console.error(`check-weather: ${name}: ${err.stack || err.message}`); await stop(); process.exit(1); };
const live = async (name, fn) => { try { await fn(); n += 1; } catch (err) { await fail(name, err); } };
let base = '';
try {
  const sPort = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the server did not start in time:\n${serverOut}`)), 20000);
    const onData = (d) => { serverOut += d; const m = /listening on :(\d+)/.exec(serverOut); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${serverOut}`)); });
  });
  base = `http://127.0.0.1:${sPort}`;
} catch (err) { await fail('the server starts', err); }
const call = async (method, urlPath, { body, token, cookie } = {}) => {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
  const res = await fetch(base + urlPath, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json: parsed, text, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
};
const ok = (r, what, status = 200) => { assert.equal(r.status, status, `${what}: ${r.status} ${r.text.slice(0, 300)}`); return r; };
const today = new Date().toISOString().slice(0, 10);
const plus = (k) => new Date(Date.parse(`${today}T00:00:00Z`) + k * 86400000).toISOString().slice(0, 10);
const SECRET = `127.0.0.1:${wx.address().port}`; // the service's address: never answered, never written down
const S = {};
const weatherOf = (space, who, q = '') => call('GET', `/api/modules/travel/weather?scope=space&space=${space}${q}`, who);
const setWeather = (values) => call('PUT', '/api/modules/weather/settings/environment', { token: S.admin, body: { values } });
const put = (module, space, key, value, token = S.admin) => call('PUT', `/api/modules/${module}/data/${encodeURIComponent(key)}?scope=space&space=${space}`, { token, body: { value } });
const params = (r) => Object.fromEntries(new URL(r.url, 'http://x').searchParams);

await live('the route: a trip, its places and the settings', async () => {
  S.admin = ok(await call('POST', '/api/login', { body: { login: 'admin', password: 'testpass1234' } }), 'the admin signs in').json.token;
  for (const m of ['maps', 'travel']) {
    ok(await call('POST', `/api/modules/bundled/${m}/install`, { token: S.admin, body: {} }), `${m} installs`, 201);
    ok(await call('PATCH', `/api/modules/${m}`, { token: S.admin, body: { enabled: true } }), `${m} turns on`);
  }
  ok(await call('PATCH', '/api/settings', { token: S.admin, body: { agents: true } }), 'agents on');
  const mk = async (login) => ok(await call('POST', '/api/users', { token: S.admin, body: { login, displayName: login, role: 'member', password: 'memberpass1234' } }), `${login} is made`, 201).json.user.key;
  const keys = { mia: await mk('mia'), otto: await mk('otto'), lena: await mk('lena') };
  const agent = ok(await call('POST', '/api/users', { token: S.admin, body: { agent: true } }), 'an agent is made', 201).json.user;
  S.agent = ok(await call('POST', `/api/users/${agent.key}/token`, { token: S.admin }), 'the agent gets a token', 201).json.token;
  const make = async (name, members) => {
    const id = ok(await call('POST', '/api/spaces', { token: S.admin, body: { name, members } }), `${name} is made`).json.space.id;
    ok(await call('PATCH', `/api/spaces/${id}`, { token: S.admin, body: { members, entry: 'guests' } }), `${name} takes its members`);
    return id;
  };
  S.trip = await make('Portugal', [keys.mia, keys.lena, agent.key]);
  S.other = await make('Elsewhere', [keys.otto]);
  for (const who of ['mia', 'otto', 'lena']) S[who] = ok(await call('POST', '/api/login', { body: { login: who, password: 'memberpass1234' } }), `${who} signs in`).json.token;
  // The trip: its main place is "Lisbon"; day 1 has two stops at saved places (the earlier one in Porto), day 2 a stop with
  // no saved place, day 3 nothing. The places carry exact positions; only rounded ones may ever go out.
  ok(await put('maps', S.trip, 'place:porto', { title: 'Livraria Lello', category: 'sights', address: 'R. das Carmelitas 144, Porto', point: { lat: 41.146938, lng: -8.614865 }, notes: 'Secret note', owners: [], by: keys.mia }), 'a place in Porto');
  ok(await put('maps', S.trip, 'place:sintra', { title: 'Pena Palace', category: 'sights', address: 'Sintra', point: { lat: 38.787586, lng: -9.390595 }, notes: '', owners: [], by: keys.mia }), 'a place in Sintra');
  ok(await put('maps', S.trip, 'place:nowhere', { title: 'Somewhere', category: 'other', address: '', notes: '', owners: [], by: keys.mia }), 'a place with no position');
  ok(await put('travel', S.trip, 'trip:main', { title: 'Our Portugal trip', destination: 'Lisbon', start: plus(1), end: plus(3), notes: 'Private words', currency: 'EUR', by: keys.mia, v: 2 }), 'the trip');
  const ref = (id) => ({ module: 'maps', kind: 'place', id, scope: 'space', space: S.trip });
  const stop = (id, o) => put('travel', S.trip, `plan:${id}`, { kind: 'stop', title: `Stop ${id}`, category: 'do', place: 'A name a person typed', address: '', notes: '', order: 1000, owners: [], by: keys.mia, ...o });
  ok(await stop('a', { date: plus(1), time: '15:00', placeRef: ref('sintra') }), 'a stop in Sintra, later');
  ok(await stop('b', { date: plus(1), time: '09:30', placeRef: ref('porto') }), 'a stop in Porto, earlier');
  ok(await stop('c', { date: plus(1), time: '08:00', placeRef: ref('nowhere') }), 'a stop at a place with no position, earliest');
  ok(await stop('d', { date: plus(2), time: '10:00' }), 'a stop with no saved place');
  const m = ok(await call('GET', '/api/modules', { token: S.admin }), 'the modules').json;
  const travel = (m.modules || m).find((x) => x.id === 'travel');
  assert.ok(travel, 'the Itinerary is listed');
});

await live('no provider chosen: not configured, and nothing is sent anywhere', async () => {
  wxSeen.length = 0; geoSeen.length = 0;
  const r = ok(await weatherOf(S.trip, { token: S.mia }), 'the weather, none chosen');
  assert.deepEqual(r.json, { configured: false });
  // Not even with a place search chosen: the provider is still none.
  ok(await call('PUT', '/api/modules/maps/settings/environment', { token: S.admin, body: { values: { searchProvider: 'custom', search: GEO } } }), 'the place search is chosen');
    assert.deepEqual(ok(await weatherOf(S.trip, { token: S.mia }), 'still none').json, { configured: false });
  assert.deepEqual(ok(await weatherOf(S.trip, { token: S.mia }, `&from=${plus(0)}&to=${plus(5)}`), 'still none, with days').json, { configured: false });
  assert.equal(wxSeen.length, 0, 'the weather service saw nothing');
  assert.equal(geoSeen.length, 0, 'the place search saw nothing');
  assert.equal(fs.existsSync(path.join(dataDir, 'weather.json')), false, 'nothing is kept');
});

await live('the switch: the Weather module on, a service chosen, its terms accepted by an administrator', async () => {
  const sent = () => wxSeen.length + geoSeen.length;
  wxSeen.length = 0; geoSeen.length = 0;
  // Not installed: nothing to choose, and no weather.
  assert.equal((await setWeather({ service: 'standin' })).status, 404, 'no Weather module yet');
  ok(await call('POST', '/api/modules/bundled/weather/install', { token: S.admin, body: {} }), 'the Weather module installs', 201);
  ok(await call('PATCH', '/api/modules/weather', { token: S.admin, body: { enabled: true, allSpaces: true } }), 'the Weather module turns on');
  assert.deepEqual(ok(await weatherOf(S.trip, { token: S.mia }), 'on, none chosen').json, { configured: false });
  // Chosen, but nobody has accepted its terms: still off, nothing sent.
  ok(await setWeather({ service: 'standin' }), 'the stand-in is chosen');
  assert.deepEqual(ok(await weatherOf(S.trip, { token: S.mia }), 'chosen, not accepted').json, { configured: false });
  assert.equal(sent(), 0, 'nothing leaves the server before the terms are accepted');
  assert.equal(fs.existsSync(path.join(dataDir, 'service-terms.json')), false);
  // Who may accept: only the signed-in administrator, with the explicit flag. Never a member, an agent or a missing flag.
  const terms = (m, who, body) => call(m, '/api/weather/terms/standin', { token: who, body });
  const view = ok(await call('GET', '/api/weather/terms', { token: S.admin }), 'the admin reads the terms').json;
  assert.deepEqual([view.mayAccept, view.services.map((x) => [x.id, x.accepted]), view.services.find((x) => x.id === 'met-norway').terms], [true, [['met-norway', false], ['standin', false], ['github', false]], 'https://api.met.no/doc/TermsOfService']);
  assert.equal((await call('GET', '/api/weather/terms', { token: S.mia })).status, 403, 'a member does not read them');
  assert.equal((await terms('PUT', S.mia, { accept: true })).status, 403, 'a member cannot accept');
  assert.ok([401, 403].includes((await terms('PUT', S.agent, { accept: true })).status), 'an agent cannot accept');
  assert.equal((await terms('PUT', null, { accept: true })).status, 401, 'nobody signed in cannot accept');
  assert.equal((await terms('PUT', S.admin, {})).status, 400, 'no flag, no acceptance');
  assert.equal((await terms('PUT', S.admin, { accept: 'yes' })).status, 400, 'only true accepts');
  assert.equal((await call('PUT', '/api/weather/terms/nowhere', { token: S.admin, body: { accept: true } })).status, 404, 'a service the server has not');
  assert.equal((await terms('DELETE', S.mia)).status, 403, 'a member cannot withdraw');
  assert.equal(fs.existsSync(path.join(dataDir, 'service-terms.json')), false, 'all of that accepted nothing');
  assert.deepEqual(ok(await weatherOf(S.trip, { token: S.mia }), 'still not accepted').json, { configured: false });
  const done = ok(await terms('PUT', S.admin, { accept: true }), 'the admin accepts').json;
  const mine = done.services.find((x) => x.id === 'standin');
  assert.deepEqual([mine.accepted, mine.by], [true, 'admin']);
  assert.ok(!Number.isNaN(Date.parse(mine.at)));
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'service-terms.json'), 'utf8')).services.standin.by, 'admin');
  assert.equal(ok(await weatherOf(S.trip, { token: S.mia }, `&from=${plus(40)}&to=${plus(41)}`), 'accepted').json.configured, true, 'chosen and accepted: on (days out of range, so nothing is asked or kept)');
  // Off again by every switch, each time with nothing asked.
  wxSeen.length = 0; geoSeen.length = 0;
  ok(await terms('DELETE', S.admin), 'the admin withdraws');
  assert.deepEqual(ok(await weatherOf(S.trip, { token: S.mia }), 'withdrawn').json, { configured: false });
  ok(await terms('PUT', S.admin, { accept: true }), 'accepted again');
  ok(await call('PATCH', '/api/modules/weather', { token: S.admin, body: { enabled: false } }), 'the Weather module off');
  assert.deepEqual(ok(await weatherOf(S.trip, { token: S.mia }), 'module off').json, { configured: false });
  ok(await call('PATCH', '/api/modules/weather', { token: S.admin, body: { enabled: true } }), 'the Weather module on again');
  ok(await setWeather({ service: 'none' }), 'service none');
  assert.deepEqual(ok(await weatherOf(S.trip, { token: S.mia }), 'none').json, { configured: false });
  assert.equal(sent(), 0, 'nothing left the server while it was off');
  ok(await setWeather({ service: 'standin' }), 'the stand-in again');
});

await live('a trip\'s days: the first stop at a saved place, else the main place; only rounded positions and days go out', async () => {
  const none = await setWeather({ service: 'custom' });
  assert.equal(none.status, 400, 'a service that is not registered is not a choice');
  assert.equal((await setWeather({ weatherAddress: 'https://x.example/' })).status, 400, 'there is no address to type');
  assert.equal((await setWeather({ weatherKey: 'k' })).status, 400, 'there is no key to keep');
  wxSeen.length = 0; geoSeen.length = 0;
  const r = ok(await weatherOf(S.trip, { token: S.mia }), 'the weather of the trip\'s own days');
  assert.equal(r.json.configured, true);
  assert.equal(r.json.units, 'c');
  assert.equal(r.json.credit, '');
  assert.deepEqual(Object.keys(r.json.days), [plus(1), plus(2), plus(3)], 'the trip\'s first to last day');
  for (const d of Object.values(r.json.days)) assert.deepEqual(d, { state: 'forecast', code: 'rain', words: 'Rain', high: 12, low: 5, rain: 40 });
  // What the weather service received: Porto for day 1 (the earliest stop with a position), the main place for days 2 and 3.
  const sent = wxSeen.map((x) => params(x)).sort((a, b) => a.lat.localeCompare(b.lat));
  assert.deepEqual(sent, [
    { lat: '38.72', lon: '-9.14', from: plus(2), to: plus(3) },
    { lat: '41.15', lon: '-8.61', from: plus(1), to: plus(1) },
  ], 'exactly a rounded position and the days');
  for (const x of wxSeen) {
    assert.deepEqual(Object.keys(x.headers).filter((h) => !['host', 'connection', 'accept', 'user-agent', 'accept-language', 'sec-fetch-mode', 'accept-encoding'].includes(h)), [], 'no other header');
    assert.equal(x.headers.cookie, undefined);
    assert.equal(x.headers.authorization, undefined);
    assert.match(x.headers['user-agent'], new RegExp(`^[\\x21-\\x7e]+/${pkg.version.replace(/[.]/g, '\\.')}$`));
    assert.ok(!/Portugal|Lisbon|Lello|Pena|Sintra|mia|Stop|typed|Private|Secret note/i.test(decodeURIComponent(x.url)), 'no name, text or person in the ask');
    assert.ok(!decodeURIComponent(x.url).includes(S.trip), 'no space in the ask');
  }
  // What the place search received: the main place's text, once, and nothing else of the trip.
  assert.equal(geoSeen.length, 1, 'one search for the main place');
  assert.deepEqual(params(geoSeen[0]), { q: 'Lisbon', limit: '10' });
  assert.equal(geoSeen[0].headers.cookie, undefined);
  // Asked again: all kept, nothing sent to either.
  wxSeen.length = 0; geoSeen.length = 0;
  const again = ok(await weatherOf(S.trip, { token: S.lena }), 'asked again');
  assert.deepEqual(again.json, r.json);
  assert.equal(wxSeen.length + geoSeen.length, 0, 'nothing is asked twice');
  // Fahrenheit is the page's unit only: from what is kept, nothing asked.
  ok(await setWeather({ units: 'f' }), 'Fahrenheit');
  const f = ok(await weatherOf(S.trip, { token: S.mia }), 'in Fahrenheit').json;
  assert.equal(f.units, 'f');
  assert.deepEqual([f.days[plus(1)].high, f.days[plus(1)].low], [54, 41]);
  assert.equal(wxSeen.length, 0);
  ok(await setWeather({ units: 'c' }), 'Celsius again');
});

await live('the range: 30 days back to 13 ahead, at most 60 days, real days', async () => {
  wxSeen.length = 0;
  const r = ok(await weatherOf(S.trip, { token: S.mia }, `&from=${plus(-31)}&to=${plus(14)}`), 'a long run').json;
  assert.equal(Object.keys(r.days).length, 46);
  assert.equal(r.days[plus(-31)].state, 'outOfRange');
  assert.equal(r.days[plus(-30)].state, 'past');
  assert.equal(r.days[plus(-1)].state, 'past');
  assert.equal(r.days[plus(0)].state, 'forecast');
  assert.equal(r.days[plus(13)].state, 'forecast');
  assert.equal(r.days[plus(14)].state, 'outOfRange');
  assert.deepEqual(r.days[plus(14)], { state: 'outOfRange' });
  for (const x of wxSeen.map(params)) {
    assert.ok(x.from >= plus(-30) && x.to <= plus(13), `nothing beyond the window is asked (${x.from} to ${x.to})`);
    assert.deepEqual(Object.keys(x).sort(), ['from', 'lat', 'lon', 'to']);
  }
  wxSeen.length = 0;
  const far = ok(await weatherOf(S.trip, { token: S.mia }, `&from=${plus(40)}&to=${plus(45)}`), 'far ahead').json;
  assert.ok(Object.values(far.days).every((d) => d.state === 'outOfRange'));
  assert.equal(wxSeen.length, 0, 'a day out of range is never asked');
  for (const [q, re] of [[`&from=${plus(0)}&to=${plus(60)}`, /at most 60 days/], [`&from=${plus(3)}&to=${plus(1)}`, /must not be after/], ['&from=2026-02-30', /YYYY-MM-DD/], ['&to=tomorrow', /YYYY-MM-DD/]]) {
    const bad = await weatherOf(S.trip, { token: S.mia }, q);
    assert.equal(bad.status, 400, q);
    assert.match(bad.json.error, re);
  }
  assert.equal(Object.keys(ok(await weatherOf(S.trip, { token: S.mia }, `&from=${plus(0)}&to=${plus(59)}`), '60 days').json.days).length, 60);
});

await live('no place: a trip with no stop at a place and no main place that is found', async () => {
  ok(await put('travel', S.other, 'trip:main', { title: 'A walk', destination: 'Atlantis', start: plus(1), end: plus(2), notes: '', currency: 'EUR', by: '', v: 2 }), 'a trip to nowhere known');
  wxSeen.length = 0; geoSeen.length = 0;
  const r = ok(await weatherOf(S.other, { token: S.otto }), 'its weather').json;
  assert.deepEqual(r.days, { [plus(1)]: { state: 'noPlace' }, [plus(2)]: { state: 'noPlace' } });
  assert.equal(wxSeen.length, 0, 'no place: the weather service is not asked');
  assert.equal(geoSeen.length, 1);
  await weatherOf(S.other, { token: S.otto });
  assert.equal(geoSeen.length, 1, 'a main place that was not found is not searched for again at once');
  // A stop that points at a place in another space gives no position here.
  ok(await put('travel', S.other, 'plan:x', { kind: 'stop', title: 'Borrowed', category: 'do', date: plus(1), order: 1000, owners: [], placeRef: { module: 'maps', kind: 'place', id: 'porto', scope: 'space', space: S.trip } }), 'a stop pointing into another space');
  assert.equal(ok(await weatherOf(S.other, { token: S.otto }), 'its weather').json.days[plus(1)].state, 'noPlace');
  assert.equal(wxSeen.length, 0);
});

await live('who may read: the module\'s view permission, the space', async () => {
  wxSeen.length = 0; geoSeen.length = 0;
  assert.equal((await weatherOf(S.trip, {})).status, 401, 'nobody');
  const notIn = await weatherOf(S.trip, { token: S.otto });
  assert.ok(notIn.status === 403 || notIn.status === 404, `a person who is not in the space: ${notIn.status}`);
  assert.equal(notIn.json.days, undefined);
  assert.equal((await call('GET', `/api/modules/travel/weather?scope=environment`, { token: S.mia })).status, 400, 'not for the environment');
  assert.equal((await call('GET', `/api/modules/maps/weather?scope=space&space=${S.trip}`, { token: S.mia })).status, 404, 'a module with no weather');
  assert.match((await call('GET', `/api/modules/maps/weather?scope=space&space=${S.trip}`, { token: S.mia })).json.error, /has no weather/);
  // A guest sees the days by the module's view permission; with it taken away, nothing.
  const link = ok(await call('POST', `/api/spaces/${S.trip}/guest-link`, { token: S.admin, body: {} }), 'a guest link').json.space.guestToken;
  const guestQ = `&guest=${encodeURIComponent(link)}`;
  const seenByGuest = ok(await weatherOf(S.trip, {}, guestQ), 'the guest reads the weather').json;
  assert.equal(seenByGuest.days[plus(1)].state, 'forecast');
  ok(await call('PATCH', '/api/roles/guest', { token: S.admin, body: { 'module.travel.view': false } }), 'guests may no longer see the trip');
  assert.equal((await weatherOf(S.trip, {}, guestQ)).status, 403, 'a guest without the view permission');
  ok(await call('PATCH', '/api/roles/member', { token: S.admin, body: { 'module.travel.view': false } }), 'members may no longer see the trip');
  assert.equal((await weatherOf(S.trip, { token: S.mia })).status, 403, 'a member without the view permission');
  ok(await call('PATCH', '/api/roles/member', { token: S.admin, body: { 'module.travel.view': true } }), 'members may again');
  // A member who may not see Maps gets no position from a stop's place: the day falls back to the main place.
  ok(await call('PATCH', '/api/roles/member', { token: S.admin, body: { 'module.maps.view': false } }), 'members may no longer see Maps');
  wxSeen.length = 0;
  ok(await weatherOf(S.trip, { token: S.mia }, `&from=${plus(1)}&to=${plus(1)}`), 'a member without Maps');
  assert.ok(wxSeen.every((x) => params(x).lat === '38.72'), 'only the main place is asked for, never the hidden place');
  ok(await call('PATCH', '/api/roles/member', { token: S.admin, body: { 'module.maps.view': true } }), 'members may again');
  // A closed space: a member is refused, and nothing is asked.
  ok(await call('PATCH', `/api/spaces/${S.trip}`, { token: S.admin, body: { closed: true } }), 'the space is closed');
  wxSeen.length = 0; geoSeen.length = 0;
  const shut = await weatherOf(S.trip, { token: S.mia }, `&from=${plus(4)}&to=${plus(6)}`);
  assert.equal(shut.status, 403, 'a member of a closed space');
  assert.match(shut.json.error, /closed for set up/);
  assert.equal(shut.json.days, undefined);
  assert.equal((await weatherOf(S.trip, {}, `&from=${plus(4)}&to=${plus(6)}${guestQ}`)).json.days, undefined, 'nor a guest');
  assert.equal(wxSeen.length + geoSeen.length, 0, 'nothing is asked for a closed space');
  ok(await call('PATCH', `/api/spaces/${S.trip}`, { token: S.admin, body: { closed: false } }), 'the space is open again');
});

// The agent read (plan-itinerary-weather.md, step 5): GET /api/modules/:id/weather is on the gate's list (read, spaceScope,
// module), and the MCP tool read_weather wraps it.
const mcp = (name, args) => fetch(`${base}/mcp`, {
  method: 'POST',
  headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json', authorization: `Bearer ${S.agent}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
}).then(async (r) => { const text = await r.text(); const j = JSON.parse(text); const c = j.result.content[0].text; let json = null; try { json = JSON.parse(c); } catch { /* a sentence */ } return { status: r.status, raw: text, isError: j.result.isError === true, text: c, json }; });
const readsToday = async () => ok(await call('GET', '/api/agent/me', { token: S.agent }), 'the agent\'s own limits').json.limits.reads.usedToday;
const agentLines = () => {
  const d = path.join(dataDir, 'agent-log');
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).flatMap((k) => { const f = path.join(d, k, `${today}.jsonl`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []; });
};

await live('an agent reads the weather through the gate, and through read_weather', async () => {
  wxSeen.length = 0; geoSeen.length = 0;
  const person = ok(await weatherOf(S.trip, { token: S.mia }), 'a member\'s answer').json;
  const before = await readsToday();
  const linesBefore = agentLines().length;
  const direct = ok(await weatherOf(S.trip, { token: S.agent }), 'the agent reads the route').json;
  assert.deepEqual(direct, person, 'the agent gets what a member gets');
  assert.equal(await readsToday(), before + 2, 'the read (and the me that read it) each count once');
  const line = agentLines().slice(linesBefore).find((l) => l.route === '/api/modules/:id/weather');
  assert.ok(line, 'the read is in the owner\'s log as the route');
  assert.deepEqual([line.method, line.module, line.space, line.kind, line.status], ['GET', 'travel', S.trip, 'read', 200]);
  assert.ok(!JSON.stringify(line).includes('Rain') && !JSON.stringify(line).includes('"high"'), 'the log holds no weather');
  // read_weather: the same days, one read (the tool call is counted as the route it wraps, never twice).
  const b2 = await readsToday();
  const t = await mcp('read_weather', { module: 'travel', space: S.trip });
  assert.equal(t.status, 200);
  assert.equal(t.isError, false, t.text);
  assert.deepEqual(t.json, person, 'read_weather answers what the route does');
  assert.equal(await readsToday(), b2 + 2, 'read_weather is one read (and the me one more)');
  const ranged = await mcp('read_weather', { module: 'travel', space: S.trip, from: plus(1), to: plus(2) });
  assert.deepEqual(Object.keys(ranged.json.days), [plus(1), plus(2)], 'from and to');
  const far = await mcp('read_weather', { module: 'travel', space: S.trip, from: plus(40), to: plus(41) });
  assert.deepEqual(far.json.days, { [plus(40)]: { state: 'outOfRange' }, [plus(41)]: { state: 'outOfRange' } }, 'a day beyond the window carries only its state');
  assert.equal(wxSeen.length + geoSeen.length, 0, 'what is kept is answered, nothing is asked');
  const bad = await mcp('read_weather', { module: 'travel', space: S.trip, from: 'tomorrow' });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /YYYY-MM-DD/, 'the route\'s own sentence');
  assert.equal((await mcp('read_weather', { module: 'travel', space: S.trip, module: 'maps' })).isError, true, 'the module is fixed');
  // A space it is not in: the gate's 404 "no such space", as for every agent read (it never learns the space exists).
  const notIn = await weatherOf(S.other, { token: S.agent });
  assert.equal(notIn.status, 404, 'a space the agent is not in');
  assert.deepEqual(notIn.json, { error: 'no such space' });
  const tNotIn = await mcp('read_weather', { module: 'travel', space: S.other });
  assert.equal(tNotIn.isError, true, 'read_weather in a space it is not in');
  assert.equal(tNotIn.text, 'no such space', 'the route\'s sentence');
  // An unticked view row in the Agent column: 403.
  ok(await call('PATCH', '/api/roles/agent', { token: S.admin, body: { 'module.travel.view': false } }), 'the agent may no longer see the trip');
  const unticked = await weatherOf(S.trip, { token: S.agent });
  assert.equal(unticked.status, 403, 'an agent without the view row');
  assert.equal(unticked.json.days, undefined);
  assert.equal((await mcp('read_weather', { module: 'travel', space: S.trip })).isError, true, 'nor through read_weather');
  ok(await call('PATCH', '/api/roles/agent', { token: S.admin, body: { 'module.travel.view': true } }), 'the agent may again');
  // A closed space: refused, and nothing is asked.
  ok(await call('PATCH', `/api/spaces/${S.trip}`, { token: S.admin, body: { closed: true } }), 'the space is closed');
  wxSeen.length = 0; geoSeen.length = 0;
  const shut = await weatherOf(S.trip, { token: S.agent }, `&from=${plus(4)}&to=${plus(6)}`);
  assert.equal(shut.status, 404, 'an agent in a closed space: as a space it is not in');
  assert.deepEqual(shut.json, { error: 'no such space' });
  const tShut = await mcp('read_weather', { module: 'travel', space: S.trip, from: plus(4), to: plus(6) });
  assert.equal(tShut.isError, true, 'read_weather in a closed space');
  assert.equal(wxSeen.length + geoSeen.length, 0, 'nothing is asked for a closed space');
  ok(await call('PATCH', `/api/spaces/${S.trip}`, { token: S.admin, body: { closed: false } }), 'the space is open again');
  // Not configured: { configured: false }, said as the route says it.
  ok(await setWeather({ service: 'none' }), 'no provider');
  assert.deepEqual((await mcp('read_weather', { module: 'travel', space: S.trip })).json, { configured: false });
  ok(await setWeather({ service: 'standin' }), 'the stand-in again');
  // The address: never in the answer of either.
  assert.ok(!(await weatherOf(S.trip, { token: S.agent })).text.includes(SECRET), 'the route answers the agent the address');
  assert.ok(!(await mcp('read_weather', { module: 'travel', space: S.trip })).raw.includes(SECRET), 'read_weather answers the address');
});

// The space's own weather (plan-weather-users.md, step 1): GET /api/spaces/:id/weather, the place the first declaring module's
// `weather.main` gives, and the module route's `space` fallback.
const spaceW = (space, who, q = '') => call('GET', `/api/spaces/${space}/weather${q}`, who);
const TRIP = () => ({ title: 'Our Portugal trip', destination: 'Lisbon', start: plus(1), end: plus(3), notes: 'Private words', currency: 'EUR', by: '', v: 2 });

await live('the space\'s weather: the place, the day, what goes out', async () => {
  // A space whose place nothing has kept yet (Faro), so that what goes out is seen.
  const miaKey = ok(await call('GET', '/api/me', { token: S.mia }), 'mia').json.user.key;
  S.faro = ok(await call('POST', '/api/spaces', { token: S.admin, body: { name: 'Algarve', members: [miaKey] } }), 'the Algarve space').json.space.id;
  ok(await call('PATCH', `/api/spaces/${S.faro}`, { token: S.admin, body: { members: [miaKey], entry: 'guests' } }), 'it takes mia');
  ok(await call('PATCH', '/api/modules/travel', { token: S.admin, body: { enabled: true, allSpaces: true } }), 'the Itinerary is on everywhere');
  ok(await put('travel', S.faro, 'trip:main', { ...TRIP(), destination: 'Faro, a very long name of a town in the south' }), 'a trip to Faro');
  wxSeen.length = 0; geoSeen.length = 0;
  const r = ok(await spaceW(S.faro, { token: S.mia }), 'the space\'s weather');
  // No phases: the trip's own dates, and today is before them: its first day. The name is cut to 24 characters.
  assert.deepEqual(r.json, { configured: true, credit: '', units: 'c', place: { module: 'travel', name: 'Faro, a very long name o' }, day: plus(1), days: { [plus(1)]: { state: 'forecast', code: 'rain', words: 'Rain', high: 12, low: 5, rain: 40 } } });
  assert.equal(r.json.place.name.length, 24);
  assert.deepEqual(wxSeen.map(params), [{ lat: '37.02', lon: '-7.93', from: plus(1), to: plus(1) }], 'a rounded position and the day, nothing else');
  assert.deepEqual(geoSeen.map(params), [{ q: 'Faro, a very long name of a town in the south', limit: '10' }], 'the text alone goes to the place search');
  for (const x of [...wxSeen, ...geoSeen]) {
    assert.equal(x.headers.cookie, undefined);
    assert.equal(x.headers.authorization, undefined);
  }
  for (const x of wxSeen) assert.ok(!/Faro|Algarve|mia|Private/i.test(decodeURIComponent(x.url)) && !decodeURIComponent(x.url).includes(S.faro), 'no name, person or space in the ask');
  assert.ok(!r.text.includes(SECRET), 'the service\'s address is not answered');
  // The place of S.trip (Lisbon), as kept.
  assert.equal(ok(await spaceW(S.trip, { token: S.mia }), 'the trip\'s place').json.place.name, 'Lisbon');
  // Kept: asked again, nothing sent.
  wxSeen.length = 0; geoSeen.length = 0;
  assert.deepEqual(ok(await spaceW(S.faro, { token: S.mia }), 'again').json, r.json);
  assert.equal(geoSeen.length, 0, 'the place is remembered');
  assert.equal(wxSeen.length, 0, 'nothing is asked twice');
  // Days given: both, the server picks nothing, no `day`.
  const g = ok(await spaceW(S.trip, { token: S.mia }, `?from=${plus(2)}&to=${plus(3)}`), 'days given').json;
  assert.deepEqual(Object.keys(g.days), [plus(2), plus(3)]);
  assert.equal(g.day, undefined);
  assert.deepEqual(g.place, { module: 'travel', name: 'Lisbon' });
  const far = ok(await spaceW(S.trip, { token: S.mia }, `?from=${plus(40)}&to=${plus(41)}`), 'far').json;
  assert.deepEqual(far.days, { [plus(40)]: { state: 'outOfRange' }, [plus(41)]: { state: 'outOfRange' } });
  for (const [q, re] of [[`?from=${plus(1)}`, /both the first and the last day/], [`?to=${plus(1)}`, /both the first and the last day/], [`?from=${plus(0)}&to=${plus(60)}`, /at most 60 days/], [`?from=${plus(3)}&to=${plus(1)}`, /must not be after/], ['?from=2026-02-30&to=2026-03-01', /YYYY-MM-DD/], [`?from=${plus(1)}&to=tomorrow`, /YYYY-MM-DD/]]) {
    const bad = await spaceW(S.trip, { token: S.mia }, q);
    assert.equal(bad.status, 400, q);
    assert.match(bad.json.error, re, q);
  }
  assert.equal(Object.keys(ok(await spaceW(S.trip, { token: S.mia }, `?from=${plus(0)}&to=${plus(59)}`), '60 days').json.days).length, 60);
});

await live('the space\'s day by the trip\'s dates, live: during, after, none', async () => {
  const day = async () => ok(await spaceW(S.trip, { token: S.mia }), 'the space\'s weather').json;
  ok(await put('travel', S.trip, 'trip:main', { ...TRIP(), start: plus(-5), end: plus(2) }), 'a trip under way');
  let r = await day();
  assert.equal(r.day, plus(0), 'during: today');
  assert.deepEqual(Object.keys(r.days), [plus(0)]);
  ok(await put('travel', S.trip, 'trip:main', { ...TRIP(), start: plus(-9), end: plus(-3) }), 'a trip that is over');
  wxSeen.length = 0;
  r = await day();
  assert.deepEqual([r.configured, r.place, r.day, r.days], [true, { module: 'travel', name: 'Lisbon' }, undefined, {}], 'after: no day, the place still');
  assert.equal(wxSeen.length, 0);
  ok(await put('travel', S.trip, 'trip:main', { ...TRIP(), start: '', end: '' }), 'a trip with no dates');
  r = await day();
  assert.equal(r.day, plus(0), 'no dates: today');
  ok(await put('travel', S.trip, 'trip:main', TRIP()), 'the trip again');
  assert.equal((await day()).day, plus(1));
});

await live('the space\'s weather: who may ask, and who gets a place', async () => {
  wxSeen.length = 0; geoSeen.length = 0;
  assert.equal((await spaceW(S.trip, {})).status, 401, 'nobody');
  const notIn = await spaceW(S.trip, { token: S.otto });
  assert.equal(notIn.status, 403, 'a person who is not in the space');
  assert.match(notIn.json.error, /not in that space/);
  assert.equal(notIn.json.place, undefined);
  assert.equal((await spaceW('nothing', { token: S.mia })).status, 404, 'no such space');
  const link = ok(await call('POST', `/api/spaces/${S.trip}/guest-link`, { token: S.admin, body: {} }), 'a guest link').json.space.guestToken;
  const guest = await spaceW(S.trip, {}, `?guest=${encodeURIComponent(link)}`);
  assert.equal(guest.status, 403, 'a guest');
  assert.equal(guest.json.place, undefined);
  // Members who may not read the Itinerary here get no place: the destination does not leak, and nothing is asked.
  ok(await call('PATCH', '/api/roles/member', { token: S.admin, body: { 'module.travel.view': false } }), 'members may no longer see the trip');
  const blind = ok(await spaceW(S.trip, { token: S.mia }), 'a member who may not read the module');
  assert.deepEqual(blind.json, { configured: true, credit: '', units: 'c', place: null, days: {} });
  assert.ok(!/Lisbon/.test(blind.text), 'the destination is not in the answer');
  assert.equal(wxSeen.length + geoSeen.length, 0);
  ok(await call('PATCH', '/api/roles/member', { token: S.admin, body: { 'module.travel.view': true } }), 'members may again');
  assert.equal(ok(await spaceW(S.trip, { token: S.mia }), 'a member who may').json.place.name, 'Lisbon');
  // A closed space: refused like the facts route's.
  ok(await call('PATCH', `/api/spaces/${S.trip}`, { token: S.admin, body: { closed: true } }), 'the space is closed');
  assert.equal((await spaceW(S.trip, { token: S.mia })).status, 403);
  ok(await call('PATCH', `/api/spaces/${S.trip}`, { token: S.admin, body: { closed: false } }), 'the space is open again');
});

await live('the space\'s weather: off, no terms, no place, a text not found', async () => {
  wxSeen.length = 0; geoSeen.length = 0;
  const off = { configured: false };
  ok(await setWeather({ service: 'none' }), 'no service');
  assert.deepEqual(ok(await spaceW(S.trip, { token: S.mia }), 'none chosen').json, off);
  ok(await setWeather({ service: 'standin' }), 'the stand-in');
  ok(await call('DELETE', '/api/weather/terms/standin', { token: S.admin }), 'the admin withdraws');
  assert.deepEqual(ok(await spaceW(S.trip, { token: S.mia }), 'no terms').json, off);
  ok(await call('PUT', '/api/weather/terms/standin', { token: S.admin, body: { accept: true } }), 'accepted again');
  ok(await call('PATCH', '/api/modules/weather', { token: S.admin, body: { enabled: false } }), 'the Weather module off');
  assert.deepEqual(ok(await spaceW(S.trip, { token: S.mia }), 'the module off').json, off);
  ok(await call('PATCH', '/api/modules/weather', { token: S.admin, body: { enabled: true } }), 'on again');
  assert.equal(wxSeen.length + geoSeen.length, 0, 'nothing is asked while it is off');
  // No module declares a place in this space: no place, and nothing is asked.
  const bare = ok(await call('POST', '/api/spaces', { token: S.admin, body: { name: 'Bare', members: [] } }), 'a space with no trip').json.space.id;
  const bareWho = { token: S.admin };
  assert.deepEqual(ok(await spaceW(bare, bareWho), 'no place').json, { configured: true, credit: '', units: 'c', place: null, days: {} });
  // A text the place search does not find (S.other: Atlantis): no place.
  const lost = ok(await spaceW(S.other, { token: S.otto }), 'a place not found').json;
  assert.deepEqual(lost, { configured: true, credit: '', units: 'c', place: null, days: {} });
  assert.equal(wxSeen.length, 0, 'the weather service is not asked for it');
});

await live('two modules declare a place: the first in order that may be read and has a text; and the module route\'s `space`', async () => {
  const { zipFiles } = require('../server/module-build.js');
  const page = Buffer.from('<!doctype html><body></body>');
  const make = (id, weather) => zipFiles([['module.json', Buffer.from(JSON.stringify({ id, name: id, version: '1.0.0', scope: ['space'], surfaces: { canvas: { entry: 'page.html', width: 300, height: 300 } }, weather }))], ['page.html', page]]);
  const upload = async (id, weather) => {
    const res = await fetch(`${base}/api/modules`, { method: 'POST', headers: { 'content-type': 'application/zip', authorization: `Bearer ${S.admin}` }, body: make(id, weather) });
    assert.ok(res.status === 201 || res.status === 200, `${id} installs: ${res.status} ${(await res.text()).slice(0, 200)}`);
    ok(await call('PATCH', `/api/modules/${id}`, { token: S.admin, body: { enabled: true, allSpaces: true } }), `${id} turns on`);
  };
  await upload('wxalt', { main: { key: 'trip:main', place: 'dest', from: 'from', to: 'to' } });
  await upload('wxspace', { space: true });
  // Both have a text: the first in order (the Itinerary, installed first) is the place.
  ok(await put('wxalt', S.trip, 'trip:main', { dest: 'Lisbon', from: plus(5), to: plus(6) }), 'the second module\'s place');
  assert.equal(ok(await spaceW(S.trip, { token: S.mia }), 'the first').json.place.module, 'travel');
  // The first has no text here: the second.
  ok(await put('travel', S.trip, 'trip:main', { ...TRIP(), destination: '' }), 'the Itinerary without a destination');
  const second = ok(await spaceW(S.trip, { token: S.mia }), 'the second').json;
  assert.deepEqual([second.place, second.day, Object.keys(second.days)], [{ module: 'wxalt', name: 'Lisbon' }, plus(5), [plus(5)]], 'the second module\'s place and its first day');
  ok(await put('travel', S.trip, 'trip:main', TRIP()), 'the Itinerary again');
  // A module that says `space: true` takes the space's place for its days, which default to the place module's own.
  wxSeen.length = 0;
  const viaModule = ok(await call('GET', `/api/modules/wxspace/weather?scope=space&space=${S.trip}`, { token: S.mia }), 'a module with only `space`').json;
  assert.deepEqual(Object.keys(viaModule.days), [plus(1), plus(2), plus(3)], 'the place module\'s first to last day');
  assert.ok(Object.values(viaModule.days).every((d) => d.state === 'forecast'));
  assert.ok(wxSeen.every((x) => params(x).lat === '38.72'), 'at the space\'s place');
  // As the asker: a member who may not read the Itinerary here does not get its place; the next module's (wxalt's) serves.
  ok(await call('PATCH', '/api/roles/member', { token: S.admin, body: { 'module.travel.view': false } }), 'members may no longer see the trip');
  const blind = ok(await call('GET', `/api/modules/wxspace/weather?scope=space&space=${S.trip}&from=${plus(1)}&to=${plus(2)}`, { token: S.mia }), 'blind').json;
  assert.deepEqual(Object.values(blind.days).map((d) => d.state), ['forecast', 'forecast'], 'the days are those asked, at the next readable place');
  assert.equal(ok(await spaceW(S.trip, { token: S.mia }), 'the space\'s own').json.place.module, 'wxalt');
  ok(await call('PATCH', '/api/roles/member', { token: S.admin, body: { 'module.travel.view': true } }), 'members may again');
  ok(await call('PATCH', '/api/modules/wxalt', { token: S.admin, body: { enabled: false } }), 'the second place module off');
  // A module that has no `space` and no days of its own answers noPlace, never the space's place.
  const own = ok(await call('GET', `/api/modules/travel/weather?scope=space&space=${S.other}&from=${plus(1)}&to=${plus(1)}`, { token: S.otto }), 'a module without space').json;
  assert.equal(own.days[plus(1)].state, 'noPlace');
});

await live('a place field hidden from a person: the module route gives them no place, as the space route gives none (issue 1162)', async () => {
  const { zipFiles } = require('../server/module-build.js');
  const manifest = { id: 'wxhide', name: 'wxhide', version: '1.0.0', scope: ['space'], surfaces: { canvas: { entry: 'page.html', width: 300, height: 300 } }, guards: { hidden: ['dest'] }, weather: { main: { key: 'trip:main', place: 'dest', from: 'from', to: 'to' } } };
  const zip = zipFiles([['module.json', Buffer.from(JSON.stringify(manifest))], ['page.html', Buffer.from('<!doctype html><body></body>')]]);
  const up = await fetch(`${base}/api/modules`, { method: 'POST', headers: { 'content-type': 'application/zip', authorization: `Bearer ${S.admin}` }, body: zip });
  assert.ok(up.status === 201 || up.status === 200, `wxhide installs: ${up.status}`);
  ok(await call('PATCH', '/api/modules/wxhide', { token: S.admin, body: { enabled: true, allSpaces: true } }), 'wxhide turns on');
  ok(await call('PATCH', '/api/roles/guest', { token: S.admin, body: { 'module.wxhide.view': true } }), 'guests may see it');
  ok(await put('wxhide', S.trip, 'trip:main', { dest: 'Lisbon', from: plus(1), to: plus(2) }), 'its place');
  const link = ok(await call('POST', `/api/spaces/${S.trip}/guest-link`, { token: S.admin, body: {} }), 'a guest link').json.space.guestToken;
  const q = `?scope=space&space=${S.trip}&guest=${encodeURIComponent(link)}`;
  const asked = (who, extra = '') => call('GET', `/api/modules/wxhide/weather${who.guest ? q : `?scope=space&space=${S.trip}`}${extra}`, who.guest ? {} : who);
  // Someone it is not hidden from gets the days at the place.
  wxSeen.length = 0;
  const member = ok(await asked({ token: S.mia }), 'a member').json;
  assert.deepEqual(Object.values(member.days).map((d) => d.state), ['forecast', 'forecast'], 'a member gets the days');
  // A guest, the place hidden from them: no place, no weather asked, the answer of a trip with no place.
  wxSeen.length = 0; geoSeen.length = 0;
  const guest = ok(await asked({ guest: true }), 'a guest').json;
  assert.deepEqual(Object.values(guest.days).map((d) => d.state), ['noPlace', 'noPlace'], 'a guest gets no weather for a hidden place');
  assert.equal(wxSeen.length + geoSeen.length, 0, 'nothing is asked for a place they may not see');
  // The same answer as a trip with no place at all.
  ok(await put('wxhide', S.trip, 'trip:main', { dest: '', from: plus(1), to: plus(2) }), 'no place');
  assert.deepEqual(ok(await asked({ guest: true }), 'a guest, no place').json, guest, 'the same answer as when there is no place');
  // Opened to guests by the owner, they get it.
  ok(await put('wxhide', S.trip, 'trip:main', { dest: 'Lisbon', from: plus(1), to: plus(2) }), 'its place again');
  ok(await call('PATCH', `/api/spaces/${S.trip}`, { token: S.admin, body: { guestsSeeHidden: true } }), 'guests may see hidden fields');
  assert.deepEqual(Object.values(ok(await asked({ guest: true }), 'an opened guest').json.days).map((d) => d.state), ['forecast', 'forecast']);
  ok(await call('PATCH', `/api/spaces/${S.trip}`, { token: S.admin, body: { guestsSeeHidden: false } }), 'closed again');
  ok(await call('PATCH', '/api/modules/wxhide', { token: S.admin, body: { enabled: false } }), 'wxhide off');
});

await live('the space\'s weather is the agent\'s too: through the gate and read_weather without a module', async () => {
  wxSeen.length = 0; geoSeen.length = 0;
  const person = ok(await spaceW(S.trip, { token: S.mia }), 'a member\'s answer').json;
  const before = await readsToday();
  const linesBefore = agentLines().length;
  const direct = ok(await spaceW(S.trip, { token: S.agent }), 'the agent reads the route').json;
  assert.deepEqual(direct, person, 'the agent gets what a member gets');
  assert.equal(await readsToday(), before + 2, 'the read (and the me that read it) each count once');
  const line = agentLines().slice(linesBefore).find((l) => l.route === '/api/spaces/:id/weather');
  assert.ok(line, 'the read is in the owner\'s log as the route');
  assert.deepEqual([line.method, line.space, line.kind, line.status], ['GET', S.trip, 'read', 200]);
  assert.ok(!JSON.stringify(line).includes('Lisbon'), 'the log holds no place');
  const b2 = await readsToday();
  const t = await mcp('read_weather', { space: S.trip });
  assert.equal(t.isError, false, t.text);
  assert.deepEqual(t.json, person, 'read_weather without a module answers the space\'s weather');
  assert.equal(await readsToday(), b2 + 2, 'one read');
  const ranged = await mcp('read_weather', { space: S.trip, from: plus(2), to: plus(3) });
  assert.deepEqual(Object.keys(ranged.json.days), [plus(2), plus(3)]);
  assert.equal((await mcp('read_weather', { space: S.trip, from: plus(2) })).isError, true, 'one day alone is refused');
  // With a module, as before.
  assert.deepEqual(Object.keys((await mcp('read_weather', { module: 'travel', space: S.trip })).json.days), [plus(1), plus(2), plus(3)]);
  // A space it is not in; the unticked view row of the place's module gives no place.
  const notIn = await spaceW(S.other, { token: S.agent });
  assert.equal(notIn.status, 404);
  assert.deepEqual(notIn.json, { error: 'no such space' });
  ok(await call('PATCH', '/api/roles/agent', { token: S.admin, body: { 'module.travel.view': false } }), 'the agent may no longer see the trip');
  assert.equal(ok(await spaceW(S.trip, { token: S.agent }), 'an agent without the view row').json.place, null);
  ok(await call('PATCH', '/api/roles/agent', { token: S.admin, body: { 'module.travel.view': true } }), 'the agent may again');
  assert.equal(wxSeen.length + geoSeen.length, 0, 'what is kept is answered');
});

await live('the service\'s address is never answered, and never written in the open', async () => {
  const routes = [
    ['GET', `/api/modules/travel/weather?scope=space&space=${S.trip}`], ['GET', '/api/modules'], ['GET', '/api/modules/travel/settings/values?scope=environment'],
    ['GET', `/api/modules/travel/settings/values?scope=space&space=${S.trip}`], ['GET', `/api/modules/for-space?space=${S.trip}`], ['GET', '/api/modules/activity'], ['GET', '/api/modules/nav'],
    ['GET', `/api/modules/travel/context?scope=space&space=${S.trip}`],
    ['GET', `/api/modules/travel/data?scope=space&space=${S.trip}`], ['GET', '/api/settings'], ['GET', '/api/me'], ['GET', '/api/activity'],
  ];
  let read = 0;
  for (const token of [S.admin, S.mia]) {
    for (const [method, url] of routes) {
      const r = await call(method, url, { token });
      if (r.status === 200) read += 1;
      assert.ok(!r.text.includes(SECRET), `${method} ${url} answers the address`);
    }
  }
  assert.ok(read >= 8, `the routes were really read (${read})`);
  const set = ok(await call('GET', '/api/modules/travel/settings/values?scope=environment', { token: S.admin }), 'the settings').json;
  assert.equal(set.values.weatherKey, undefined, 'there is no key setting');
  assert.equal(set.values.weatherAddress, undefined, 'there is no address setting');
  assert.ok(!ok(await setWeather({ units: 'c' }), 'a save').text.includes(SECRET), 'saving answers the address');
  // On disk: nowhere in the open, and weather.json holds only positions, days and numbers.
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(dataDir)) assert.ok(!fs.readFileSync(f).includes(SECRET), `${path.relative(dataDir, f)} holds the address in the open`);
  assert.ok(!serverOut.includes(SECRET), 'the server\'s output does not hold the address');
});

await live('a failing service: 502 with nothing kept, the kept days otherwise; the limit', async () => {
  // Two days at a place nothing is kept for yet.
  for (const [id, k] of [['e', 8], ['g', 9]]) ok(await put('travel', S.trip, `plan:${id}`, { kind: 'stop', title: 'Later', category: 'do', date: plus(k), order: 1000, owners: [], placeRef: { module: 'maps', kind: 'place', id: 'sintra', scope: 'space', space: S.trip } }), 'a stop in Sintra');
  wxFails = true;
  const none = await weatherOf(S.trip, { token: S.lena }, `&from=${plus(8)}&to=${plus(9)}`);
  assert.equal(none.status, 502);
  assert.deepEqual(none.json, { error: 'weather is not available right now' });
  const some = ok(await weatherOf(S.trip, { token: S.lena }, `&from=${plus(3)}&to=${plus(9)}`), 'some days kept').json;
  assert.equal(some.days[plus(3)].state, 'forecast');
  assert.equal(some.days[plus(9)].state, 'unavailable');
  assert.deepEqual(some.days[plus(9)], { state: 'unavailable' });
  // An answer wholly from what is kept is not counted: 40 of them pass. An ask of the service is: 30 a minute a person.
  for (let i = 0; i < 40; i += 1) assert.equal((await weatherOf(S.trip, { token: S.lena }, `&from=${plus(1)}&to=${plus(3)}`)).status, 200, `kept answer ${i + 1}`);
  ok(await call('POST', '/api/users', { token: S.admin, body: { login: 'nora', displayName: 'nora', role: 'member', password: 'memberpass1234' } }), 'nora is made', 201);
  const nora = ok(await call('POST', '/api/login', { body: { login: 'nora', password: 'memberpass1234' } }), 'nora signs in').json.token;
  const me = ok(await call('GET', '/api/me', { token: nora }), 'nora').json;
  const members = ok(await call('GET', `/api/spaces/${S.trip}`, { token: S.admin }), 'the space').json.space.members;
  ok(await call('PATCH', `/api/spaces/${S.trip}`, { token: S.admin, body: { members: [...members, me.user ? me.user.key : me.key] } }), 'nora joins');
  wxSeen.length = 0;
  const statuses = [];
  for (let i = 0; i < 32; i += 1) statuses.push((await weatherOf(S.trip, { token: nora }, `&from=${plus(9)}&to=${plus(9)}`)).status);
  assert.deepEqual(statuses.slice(0, 30), new Array(30).fill(502), '30 asks pass the limit');
  assert.deepEqual(statuses.slice(30), [429, 429], 'the next are refused');
  assert.equal(wxSeen.length, 30, 'and the service is asked no more');
  const told = await weatherOf(S.trip, { token: nora }, `&from=${plus(9)}&to=${plus(9)}`);
  assert.match(told.json.error, /is busy\. Wait \d+ seconds?/);
  assert.equal((await weatherOf(S.trip, { token: nora }, `&from=${plus(1)}&to=${plus(3)}`)).status, 200, 'what is kept is still answered');
  // The space's weather counts against the same limit, the place module's: nora is over it, so an ask of the service is refused...
  ok(await call('PATCH', `/api/spaces/${S.faro}`, { token: S.admin, body: { members: [...ok(await call('GET', `/api/spaces/${S.faro}`, { token: S.admin }), 'the Algarve space').json.space.members, me.user ? me.user.key : me.key] } }), 'nora joins the Algarve space');
  wxSeen.length = 0;
  const over = await spaceW(S.faro, { token: nora }, `?from=${plus(5)}&to=${plus(5)}`);
  assert.equal(over.status, 429, 'the space route shares the place module\'s limit');
  assert.match(over.json.error, /is busy\. Wait \d+ seconds?/);
  assert.equal(wxSeen.length, 0, 'and the service is not asked');
  // ...and what is kept is still answered.
  assert.equal((await spaceW(S.faro, { token: nora }, '')).status, 200, 'what is kept is answered over the limit');
  wxFails = false;
});

await live('what is kept: positions, days and numbers only', async () => {
  await stop();
  const raw = fs.readFileSync(path.join(dataDir, 'weather.json'), 'utf8');
  const saved = JSON.parse(raw);
  assert.ok(Object.keys(saved.days).length >= 3, 'the days were written when the server stopped');
  for (const [k, r] of Object.entries(saved.days)) {
    assert.match(k, /^-?\d+\.\d{2},-?\d+\.\d{2}\|\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(Object.keys(r).sort(), ['code', 'got', 'high', 'low', 'rain']);
  }
  // Beside them, per rounded position only, when the service was asked and what it said about asking again.
  for (const [k, a] of Object.entries(saved.asks || {})) {
    assert.match(k, /^-?\d+\.\d{2},-?\d+\.\d{2}$/);
    assert.deepEqual(Object.keys(a).sort(), ['answer', 'at', 'modified', 'until']);
    assert.equal(a.modified, '', 'the stand-in gives no Last-Modified');
  }
  assert.ok(!/[A-Za-z]{3,}/.test(raw.replace(/"(days|asks|at|until|modified|answer|code|high|low|rain|got|null|clear|partly|cloudy|fog|drizzle|snow|storm)"|"rain"|null/g, '')), 'no name, word or address in the file');
  assert.ok(!raw.includes('41.146938') && !raw.includes('38.787586'), 'no exact position');
});

await live('a hosted server: the host console accepts and withdraws a service\'s terms, and nobody else does', async () => {
  // The host's three routes once sat after the host router's 404 catch-all, so a hosted server answered 404 and the console's
  // Weather terms section could never load. Here a server with BASE_DOMAIN is asked as the host console (Host: admin.localhost).
  const hostDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weather-host-'));
  const hostChild = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: hostDir, BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'host', ADMIN_PASSWORD: 'host-password-1', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', WEATHER_TEST_STANDIN: WX },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`the hosted server did not start in time:\n${out}`)), 20000);
      const onData = (d) => { out += d; const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
      hostChild.stdout.on('data', onData);
      hostChild.stderr.on('data', onData);
      hostChild.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the hosted server stopped (${code}):\n${out}`)); });
    });
    const asConsole = (method, urlPath, { body, cookie } = {}) => new Promise((resolve, reject) => {
      const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const headers = { host: `admin.localhost:${port}`, origin: `http://admin.localhost:${port}`, accept: 'application/json' };
      if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = payload.length; }
      if (cookie) headers.cookie = cookie;
      const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* not JSON */ } resolve({ status: res.statusCode, headers: res.headers, json }); });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
    const login = await asConsole('POST', '/api/host/login', { body: { login: 'host', password: 'host-password-1' } });
    assert.equal(login.status, 200, 'the host admin signs in');
    const cookie = [].concat(login.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
    const R = '/api/host/weather/terms';
    // Nobody signed in: refused, never 404 (404 would mean the route is not there).
    for (const [m, u, b] of [['GET', R], ['PUT', `${R}/standin`, { accept: true }], ['DELETE', `${R}/standin`]]) {
      assert.equal((await asConsole(m, u, { body: b })).status, 401, `${m} ${u} without the host admin's session is refused`);
    }
    const first = await asConsole('GET', R, { cookie });
    assert.equal(first.status, 200, 'the host admin reads the terms');
    assert.equal(first.json.mayAccept, true);
    assert.ok(first.json.services.some((x) => x.id === 'standin' && x.accepted === false), 'the stand-in is offered, not accepted');
    assert.equal((await asConsole('PUT', `${R}/standin`, { cookie, body: {} })).status, 400, 'an accept without { accept: true } is refused');
    const put = await asConsole('PUT', `${R}/standin`, { cookie, body: { accept: true } });
    assert.equal(put.status, 200, 'the host admin accepts');
    const got = put.json.services.find((x) => x.id === 'standin');
    assert.equal(got.accepted, true);
    assert.equal(got.by, 'host', 'by the host admin who did it');
    assert.equal((await asConsole('DELETE', `${R}/standin`, { cookie })).status, 200, 'the host admin withdraws');
    assert.equal((await asConsole('GET', R, { cookie })).json.services.find((x) => x.id === 'standin').accepted, false, 'and it is not accepted');
    assert.equal((await asConsole('PUT', `${R}/nothing`, { cookie, body: { accept: true } })).status, 404, 'a service this server does not have: 404 from the route, with its own sentence');
  } finally {
    await new Promise((resolve) => { if (hostChild.exitCode !== null) return resolve(); hostChild.once('exit', resolve); hostChild.kill('SIGTERM'); });
  }
});

await stop();
for (const sv of [wx, geo, lk]) sv.close();
server.close();
console.log(`check-weather: OK (${n} groups)`);
