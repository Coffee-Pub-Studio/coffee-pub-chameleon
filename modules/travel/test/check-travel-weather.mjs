#!/usr/bin/env node
/*
 * check-travel-weather.mjs -- the weather on each Itinerary day (plan-itinerary-weather.md, step 4): travel-lib-weather.js
 * run on its own with a stand-in host and clock. Which days are asked for, one ask per draw and none while the answer is
 * fresh, a change of days or places asks again after a short wait, `configured: false` is not asked again on every draw, a
 * 502 or 429 draws nothing and waits, and what each day hands host.ui.dayWeather. Then the page's wiring, read from
 * travel.js and the markup contract. Exits 1 on any failure.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = new URL('../src/', import.meta.url);
const read = (n) => fs.readFileSync(new URL(n, src), 'utf8');
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const lib = new Function('ymd', 'parseYmd', `${read('travel-lib-weather.js')}\nreturn { weatherSpan, weatherPlaces, weatherFor, createWeather, WEATHER_WAIT_MS, WEATHER_FRESH_MS, WEATHER_OFF_MS, WEATHER_FAILED_MS };`)(ymd, parseYmd);
const { weatherSpan, weatherPlaces, weatherFor, createWeather } = lib;

let failures = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`ok - ${name}`); } catch (err) { failures += 1; console.log(`not ok - ${name}\n  ${err.message}`); }
};
const settle = () => new Promise((r) => setImmediate(r));

// A clock and timers the test moves by hand.
function clock() {
  let t = 1_000_000;
  const timers = new Map();
  let n = 0;
  return {
    now: () => t,
    later: (fn, ms) => { n += 1; timers.set(n, { at: t + ms, fn }); return n; },
    cancel: (id) => { timers.delete(id); },
    async run(ms = 0) {
      t += ms;
      for (const [id, x] of [...timers].sort((a, b) => a[1].at - b[1].at)) if (x.at <= t) { timers.delete(id); x.fn(); }
      await settle();
    },
    waiting: () => timers.size,
  };
}

// The stand-in host: the route's answers, one per state, and what it was asked.
const DAYS = {
  '2026-11-24': { state: 'past', code: 'rain', words: 'Rain', high: 11, low: 6, rain: null },
  '2026-11-25': { state: 'forecast', code: 'partly', words: 'Partly cloudy', high: 14, low: 7, rain: 20 },
  '2026-11-26': { state: 'noPlace' },
  '2026-12-30': { state: 'outOfRange' },
};
const ANSWERS = {
  on: { configured: true, credit: 'Weather by a stand-in', units: 'c', days: DAYS },
  off: { configured: false },
  picture: { configured: false, pictureMap: true },
  failed: Object.assign(new Error('weather is not available right now'), { status: 502 }),
  limit: Object.assign(new Error('Too many'), { status: 429 }),
};
function standIn(kind) {
  const asked = [];
  const answers = [];
  const c = clock();
  const w = createWeather({
    ask: async (span) => { asked.push(span); const a = ANSWERS[typeof kind === 'function' ? kind() : kind]; if (a instanceof Error) throw a; return a; },
    onAnswer: (a) => answers.push(a),
    now: c.now, later: c.later, cancel: c.cancel,
  });
  return { w, c, asked, answers };
}
const span = { from: '2026-11-24', to: '2026-11-30' };

await test('the span is the plan\'s days, cut to a month back and two weeks ahead', () => {
  assert.deepEqual(weatherSpan(['2026-11-24', '2026-11-25', '2026-11-30'], '2026-11-25'), { from: '2026-11-24', to: '2026-11-30' });
  assert.deepEqual(weatherSpan(['2026-09-01', '2027-03-01'], '2026-11-25'), { from: '2026-10-25', to: '2026-12-09' });
  assert.equal(weatherSpan(['2027-03-01', '2027-03-05'], '2026-11-25'), null, 'a trip far ahead asks nothing');
  assert.equal(weatherSpan(['2026-01-01'], '2026-11-25'), null, 'a trip long past asks nothing');
  assert.equal(weatherSpan([], '2026-11-25'), null);
  const s = weatherSpan(['2026-01-01', '2027-12-31'], '2026-11-25');
  const length = (parseYmd(s.to) - parseYmd(s.from)) / 86400000 + 1;
  assert.ok(length <= 60, `never more than the route's 60 days (${length})`);
});

await test('the places follow the stops\' days, times, order and pointers and the trip\'s main place', () => {
  const ref = { module: 'maps', kind: 'place', id: 'p1', scope: 'space', space: 's1' };
  const a = weatherPlaces([{ date: '2026-11-25', time: '09:00', order: 1000, placeRef: ref }, { date: '2026-11-25', title: 'no place' }], { destination: 'Rome' });
  assert.equal(a, weatherPlaces([{ date: '2026-11-25', time: '09:00', order: 1000, placeRef: ref }], { destination: 'Rome' }), 'a stop with no place changes nothing');
  assert.notEqual(a, weatherPlaces([{ date: '2026-11-26', time: '09:00', order: 1000, placeRef: ref }], { destination: 'Rome' }), 'moved to another day');
  assert.notEqual(a, weatherPlaces([{ date: '2026-11-25', time: '09:00', order: 1000, placeRef: { ...ref, id: 'p2' } }], { destination: 'Rome' }), 'another place');
  assert.notEqual(a, weatherPlaces([{ date: '2026-11-25', time: '09:00', order: 1000, placeRef: ref }], { destination: 'Naples' }), 'another main place');
});

await test('each day hands the piece its own day, the units and the credit', () => {
  const on = ANSWERS.on;
  assert.deepEqual(weatherFor(on, '2026-11-25'), { day: DAYS['2026-11-25'], units: 'c', credit: 'Weather by a stand-in' });
  assert.deepEqual(weatherFor(on, '2026-11-24').day.state, 'past');
  assert.equal(weatherFor(on, '2026-11-26').day.state, 'noPlace', 'the piece draws nothing for it');
  assert.equal(weatherFor(on, '2026-12-01').day, null, 'a day not in the answer');
  assert.equal(weatherFor({ ...on, units: 'f' }, '2026-11-25').units, 'f');
  assert.deepEqual(weatherFor(null, '2026-11-25'), { day: null, units: 'c', credit: '' });
  assert.equal(weatherFor({ configured: false }, '2026-11-25').day, null);
  assert.equal(weatherFor({ days: { constructor: 1 } }, 'toString').day, null, 'only the answer\'s own days');
});

await test('a forecast: asked once at once, and redraws while it is fresh ask nothing', async () => {
  const { w, c, asked, answers } = standIn('on');
  assert.equal(w.want(span, 'p'), true);
  assert.equal(w.want(span, 'p'), true, 'a second draw before the answer waits for the same ask');
  await c.run(0);
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0], span);
  assert.equal(answers.length, 1);
  assert.equal(w.answer, ANSWERS.on);
  for (let i = 0; i < 20; i += 1) assert.equal(w.want(span, 'p'), false);
  await c.run(lib.WEATHER_FRESH_MS - 1);
  assert.equal(asked.length, 1, 'no ask while fresh');
  await c.run(1);
  assert.equal(w.want(span, 'p'), true, 'an old answer is asked again');
  await c.run(lib.WEATHER_WAIT_MS);
  assert.equal(asked.length, 2);
});

await test('a change of days or places asks again once, after a short wait', async () => {
  const { w, c, asked } = standIn('on');
  w.want(span, 'p');
  await c.run(0);
  w.want({ ...span, to: '2026-12-01' }, 'p');
  await c.run(100);
  w.want(span, 'p2');
  await c.run(100);
  w.want(span, 'p3');
  await c.run(lib.WEATHER_WAIT_MS - 1);
  assert.equal(asked.length, 1, 'still waiting');
  await c.run(1);
  assert.equal(asked.length, 2, 'a run of changes asks once');
  assert.equal(c.waiting(), 0);
  assert.equal(w.answer, ANSWERS.on, 'the old answer stays drawn meanwhile');
});

await test('no service chosen draws nothing and is not asked again on every draw', async () => {
  for (const kind of ['off', 'picture']) {
    const { w, c, asked, answers } = standIn(kind);
    w.want(span, 'p');
    await c.run(0);
    assert.equal(answers[0], null);
    assert.equal(w.answer, null);
    for (let i = 0; i < 20; i += 1) assert.equal(w.want({ ...span, to: `2026-12-${pad(i + 1)}` }, `p${i}`), false);
    await c.run(lib.WEATHER_OFF_MS - 1);
    assert.equal(asked.length, 1, `${kind}: one ask for many draws`);
    await c.run(1);
    w.want(span, 'p');
    await c.run(lib.WEATHER_WAIT_MS);
    assert.equal(asked.length, 2, `${kind}: asked again after a while`);
  }
});

await test('an owner\'s change of settings asks at once on the next draw', async () => {
  let kind = 'off';
  const { w, c, asked } = standIn(() => kind);
  w.want(span, 'p');
  await c.run(0);
  assert.equal(w.want(span, 'p'), false);
  kind = 'on';
  w.reset();
  w.want(span, 'p');
  await c.run(0);
  assert.equal(asked.length, 2);
  assert.equal(w.answer, ANSWERS.on);
});

await test('502 and 429 draw nothing, wait a minute, then ask again', async () => {
  for (const kind of ['failed', 'limit']) {
    let now = 'on';
    const { w, c, asked, answers } = standIn(() => now);
    w.want(span, 'p');
    await c.run(0);
    assert.equal(w.answer, ANSWERS.on);
    now = kind;
    w.want(span, 'p2');
    await c.run(lib.WEATHER_WAIT_MS);
    assert.equal(w.answer, null, `${kind}: nothing drawn`);
    assert.equal(answers.at(-1), null);
    assert.equal(w.want(span, 'p3'), false, `${kind}: not asked again at once`);
    await c.run(lib.WEATHER_FAILED_MS);
    now = 'on';
    assert.equal(w.want(span, 'p3'), true);
    await c.run(lib.WEATHER_WAIT_MS);
    assert.equal(asked.length, 3);
    assert.equal(w.answer, ANSWERS.on);
  }
});

await test('an older answer that comes late does not replace a newer one', async () => {
  const resolvers = [];
  const c = clock();
  const answers = [];
  const w = createWeather({ ask: () => new Promise((r) => resolvers.push(r)), onAnswer: (a) => answers.push(a), now: c.now, later: c.later, cancel: c.cancel });
  w.want(span, 'p');
  await c.run(0);
  w.reset();
  w.want(span, 'p2');
  await c.run(0);
  assert.equal(resolvers.length, 2);
  resolvers[1]({ ...ANSWERS.on, credit: 'new' });
  await settle();
  resolvers[0]({ ...ANSWERS.on, credit: 'old' });
  await settle();
  assert.equal(w.answer.credit, 'new');
  assert.equal(answers.length, 1);
});

await test('nothing to ask for asks nothing', async () => {
  const { w, c, asked } = standIn('on');
  assert.equal(w.want(null, 'p'), false);
  await c.run(1000);
  assert.equal(asked.length, 0);
});

await test('the page asks through host.weather.days and draws with host.ui.dayWeather in the day\'s label row', () => {
  const js = read('travel.js');
  assert.ok(js.includes('createWeather({ ask: (span) => host.weather.days(span)'), 'the SDK call');
  assert.ok(js.includes("dayEl.querySelector('.sdk-day-labels')") && js.includes('host.ui.dayWeather(box, o)'), 'the piece in the label row');
  assert.ok(js.includes("if (state.view === 'days') wantWeather();"), 'asked from the draw, once');
  assert.ok(js.includes('weather.reset();'), 'a change of settings asks again');
  assert.ok(js.includes("e.animationName === 'sdk-day-weather-in'") && js.includes("classList.add('weather-faded-in')"), 'the first fade-in marks the page');
  assert.ok(/\.weather-faded-in \.sdk-day-weather \{ animation: none; \}/.test(read('travel.css')), 'a redraw does not replay the fade-in');
  assert.ok(!/fetch\(/.test(read('travel-lib-weather.js')), 'the library asks only through the page\'s ask');
  const html = read('travel.html');
  assert.ok(/class="sdk-day-labels" hidden/.test(html), 'the label row is still in the day header');
  assert.ok(read('CONTRACT.md').includes('.sdk-day-weather'), 'the contract names the piece');
  const sdk = fs.readFileSync(new URL('../../../public/sdk/host.js', import.meta.url), 'utf8');
  assert.ok(sdk.includes("days: (o) => call('weather.days', { from: o && o.from, to: o && o.to })"), 'the SDK has host.weather.days');
  const mh = fs.readFileSync(new URL('../../../public/module-host.js', import.meta.url), 'utf8');
  assert.ok(mh.includes("api('GET', url('/weather', scopeOf('space')"), 'the host asks the route for this space');
});

if (failures) { console.log(`check-travel-weather: ${failures} failed`); process.exit(1); }
console.log('check-travel-weather: OK');
