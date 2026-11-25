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
 * The adapter used throughout is the test stand-in (server/weather-providers/test-standin.js); no real service is registered, and
 * the check asserts the Itinerary offers none but None.
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

await test('the words table, and no service registered', () => {
  assert.deepEqual(Object.keys(WORD_TEXT), WORDS);
  for (const [word, words] of Object.entries(WORD_TEXT)) assert.ok(words && words.length <= 40 && /^[A-Z][a-z ]+$/.test(words), `${word}: plain words`);
  assert.equal(WORDS.length, 8);
  assert.deepEqual(dayAnswer({ code: 'rain', high: 22.4, low: 13.6, rain: 40 }), { code: 'rain', words: 'Rain', high: 22, low: 14, rain: 40 });
  assert.deepEqual(dayAnswer({ code: 'clear', high: 22, low: 0, rain: null }, 'f'), { code: 'clear', words: 'Clear sky', high: 72, low: 32, rain: null });
  // The registry: with the stand-in's variable unset, no adapter is registered at all (a fresh process answers this).
  const out = require('node:child_process').execFileSync(process.execPath, ['-e', "const r=require('./server/weather-providers'); console.log(JSON.stringify(r.list().map(p=>p.id)))"], { cwd: ROOT, env: { PATH: process.env.PATH } }).toString().trim();
  assert.equal(out, '[]', 'no adapter is registered unless the check asks for the stand-in');
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
  assert.ok(!/[A-Za-z]{3,}/.test(raw.replace(/"(days|code|high|low|rain|got|null|clear|partly|cloudy|fog|drizzle|snow|storm)"|"rain"|null/g, '')), 'no name, word or address in the file');
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

// Nothing in the module names a space, a person or an environment.
await test('the module holds no link to a person', () => {
  const src = fs.readFileSync(new URL('../server/weather.js', import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/\b(req|user|login|space|environment|ctx)\b/.test(src), 'no request, user, space or environment in the code');
});

// --- the manifest's declaration ---------------------------------------------------------------------------------------------
await test('the declaration: settings of the right kind, where a day is, registered adapters as choices', () => {
  const { cleanWeather, ModuleError } = require('../server/modules.js');
  const mk = () => [
    { key: 'p', type: 'choice', scope: 'environment', options: [{ value: 'none', label: 'None' }] }, { key: 'u', type: 'choice', scope: 'environment' },
    { key: 't', type: 'text', scope: 'environment' }, { key: 'sp', type: 'choice', scope: 'space' },
  ];
  const settings = mk();
  const good = { provider: 'p', units: 'u', stops: { prefix: 'plan:', day: 'date', time: 'time', order: 'order', place: 'placeRef' }, main: { key: 'trip:main', place: 'destination', from: 'start', to: 'end' } };
  const scope = ['environment', 'space'];
  assert.equal(cleanWeather(undefined, settings, scope), null, 'none by default');
  assert.deepEqual(cleanWeather(good, settings, scope), good);
  // The registered adapter (here the stand-in) is a choice of the provider setting, once however often it is cleaned.
  cleanWeather(good, settings, scope);
  assert.deepEqual(settings[0].options.map((o) => o.value), ['none', 'standin']);
  assert.deepEqual(cleanWeather({ provider: 'p', main: { key: 'trip:main' } }, mk(), scope), { provider: 'p', units: '', stops: null, main: { key: 'trip:main', place: '', from: '', to: '' } });
  const bad = (raw, re, sc = scope) => assert.throws(() => cleanWeather(raw, mk(), sc), (err) => err instanceof ModuleError && re.test(err.message), JSON.stringify(raw).slice(0, 80));
  bad({ ...good, provider: 't' }, /`provider` choice setting/);
  bad({ ...good, provider: 'sp' }, /`provider` choice setting/);
  bad({ ...good, units: 'a' }, /`units` must name a choice setting/);
  bad({ ...good, stops: undefined, main: undefined }, /`stops` or `main`/);
  bad({ ...good, stops: { prefix: 'plan:', day: 'date' } }, /stops `place` must be a field name/);
  bad({ ...good, stops: { ...good.stops, day: '__proto__' } }, /field name/);
  bad({ ...good, main: { key: '../x' } }, /main needs a `key`/);
  bad(good, /"space" scope/, ['environment']);
  // The Itinerary's own declaration reads, none is the default, and no service, address or key is in it.
  const travel = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', 'travel', 'module.json'), 'utf8'));
  const provider = travel.settings.find((d) => d.key === travel.weather.provider);
  assert.equal(provider.default, 'none');
  assert.deepEqual(provider.options.map((o) => o.value), ['none'], 'the Itinerary names no service: the server offers the registered ones');
  assert.deepEqual(Object.keys(travel.weather).sort(), ['main', 'provider', 'stops', 'units']);
  assert.ok(!travel.settings.some((d) => /^weather(Address|Key)$/.test(d.key)), 'no address or key to type');
  assert.ok(!/open-?meteo|apikey|https?:\/\/api\./i.test(JSON.stringify(travel)), 'no service named or addressed');
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
  const features = /lisbon/i.test(q) ? [{ geometry: { type: 'Point', coordinates: [-9.139337, 38.722252] }, properties: { name: 'Lisbon', country: 'Portugal', osm_type: 'R', osm_id: 5400890 } }] : [];
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
const setTravel = (values) => call('PUT', '/api/modules/travel/settings/environment', { token: S.admin, body: { values } });
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

await live('a trip\'s days: the first stop at a saved place, else the main place; only rounded positions and days go out', async () => {
  ok(await setTravel({ weatherProvider: 'standin' }), 'the stand-in is chosen');
  const none = await setTravel({ weatherProvider: 'custom' });
  assert.equal(none.status, 400, 'a service that is not registered is not a choice');
  assert.equal((await setTravel({ weatherAddress: 'https://x.example/' })).status, 400, 'there is no address to type');
  assert.equal((await setTravel({ weatherKey: 'k' })).status, 400, 'there is no key to keep');
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
  ok(await setTravel({ weatherUnits: 'f' }), 'Fahrenheit');
  const f = ok(await weatherOf(S.trip, { token: S.mia }), 'in Fahrenheit').json;
  assert.equal(f.units, 'f');
  assert.deepEqual([f.days[plus(1)].high, f.days[plus(1)].low], [54, 41]);
  assert.equal(wxSeen.length, 0);
  ok(await setTravel({ weatherUnits: 'c' }), 'Celsius again');
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
  const t = await mcp('read_weather', { space: S.trip });
  assert.equal(t.status, 200);
  assert.equal(t.isError, false, t.text);
  assert.deepEqual(t.json, person, 'read_weather answers what the route does');
  assert.equal(await readsToday(), b2 + 2, 'read_weather is one read (and the me one more)');
  const ranged = await mcp('read_weather', { space: S.trip, from: plus(1), to: plus(2) });
  assert.deepEqual(Object.keys(ranged.json.days), [plus(1), plus(2)], 'from and to');
  const far = await mcp('read_weather', { space: S.trip, from: plus(40), to: plus(41) });
  assert.deepEqual(far.json.days, { [plus(40)]: { state: 'outOfRange' }, [plus(41)]: { state: 'outOfRange' } }, 'a day beyond the window carries only its state');
  assert.equal(wxSeen.length + geoSeen.length, 0, 'what is kept is answered, nothing is asked');
  const bad = await mcp('read_weather', { space: S.trip, from: 'tomorrow' });
  assert.equal(bad.isError, true);
  assert.match(bad.text, /YYYY-MM-DD/, 'the route\'s own sentence');
  assert.equal((await mcp('read_weather', { space: S.trip, module: 'maps' })).isError, true, 'the module is fixed');
  // A space it is not in: the gate's 404 "no such space", as for every agent read (it never learns the space exists).
  const notIn = await weatherOf(S.other, { token: S.agent });
  assert.equal(notIn.status, 404, 'a space the agent is not in');
  assert.deepEqual(notIn.json, { error: 'no such space' });
  const tNotIn = await mcp('read_weather', { space: S.other });
  assert.equal(tNotIn.isError, true, 'read_weather in a space it is not in');
  assert.equal(tNotIn.text, 'no such space', 'the route\'s sentence');
  // An unticked view row in the Agent column: 403.
  ok(await call('PATCH', '/api/roles/agent', { token: S.admin, body: { 'module.travel.view': false } }), 'the agent may no longer see the trip');
  const unticked = await weatherOf(S.trip, { token: S.agent });
  assert.equal(unticked.status, 403, 'an agent without the view row');
  assert.equal(unticked.json.days, undefined);
  assert.equal((await mcp('read_weather', { space: S.trip })).isError, true, 'nor through read_weather');
  ok(await call('PATCH', '/api/roles/agent', { token: S.admin, body: { 'module.travel.view': true } }), 'the agent may again');
  // A closed space: refused, and nothing is asked.
  ok(await call('PATCH', `/api/spaces/${S.trip}`, { token: S.admin, body: { closed: true } }), 'the space is closed');
  wxSeen.length = 0; geoSeen.length = 0;
  const shut = await weatherOf(S.trip, { token: S.agent }, `&from=${plus(4)}&to=${plus(6)}`);
  assert.equal(shut.status, 404, 'an agent in a closed space: as a space it is not in');
  assert.deepEqual(shut.json, { error: 'no such space' });
  const tShut = await mcp('read_weather', { space: S.trip, from: plus(4), to: plus(6) });
  assert.equal(tShut.isError, true, 'read_weather in a closed space');
  assert.equal(wxSeen.length + geoSeen.length, 0, 'nothing is asked for a closed space');
  ok(await call('PATCH', `/api/spaces/${S.trip}`, { token: S.admin, body: { closed: false } }), 'the space is open again');
  // Not configured: { configured: false }, said as the route says it.
  ok(await setTravel({ weatherProvider: 'none' }), 'no provider');
  assert.deepEqual((await mcp('read_weather', { space: S.trip })).json, { configured: false });
  ok(await setTravel({ weatherProvider: 'standin' }), 'the stand-in again');
  // The address: never in the answer of either.
  assert.ok(!(await weatherOf(S.trip, { token: S.agent })).text.includes(SECRET), 'the route answers the agent the address');
  assert.ok(!(await mcp('read_weather', { space: S.trip })).raw.includes(SECRET), 'read_weather answers the address');
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
  assert.ok(!ok(await setTravel({ weatherUnits: 'c' }), 'a save').text.includes(SECRET), 'saving answers the address');
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
  assert.ok(!/[A-Za-z]{3,}/.test(raw.replace(/"(days|code|high|low|rain|got|null|clear|partly|cloudy|fog|drizzle|snow|storm)"|"rain"|null/g, '')), 'no name, word or address in the file');
  assert.ok(!raw.includes('41.146938') && !raw.includes('38.787586'), 'no exact position');
});

await stop();
for (const sv of [wx, geo, lk]) sv.close();
server.close();
console.log(`check-weather: OK (${n} groups)`);
