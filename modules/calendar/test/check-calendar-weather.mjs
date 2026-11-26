#!/usr/bin/env node
/*
 * check-calendar-weather.mjs -- the weather on the Calendar's days (plan-weather-users.md, step 4): src/calendar-lib-weather.js run on
 * its own with a stand-in clock (which days are asked for: the days on screen cut to what a service answers and to 60, one ask per draw,
 * none while the answer is fresh, `configured: false` and a failure wait, what a day hands host.ui.dayWeather), then the manifest's
 * declaration and the page's wiring read from calendar.js: a space's Calendar only, a slot on every view, the SDK piece and no colour
 * of its own. Exits 1 on any failure.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = new URL('../src/', import.meta.url);
const read = (n) => fs.readFileSync(new URL(n, src), 'utf8');
const lib = new Function(`${read('calendar-lib-weather.js')}\nreturn { calWeatherSpan, calWeatherFor, calWeatherKeeper };`)();
const { calWeatherSpan, calWeatherFor, calWeatherKeeper } = lib;

let failures = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`ok - ${name}`); } catch (err) { failures += 1; console.log(`not ok - ${name}\n  ${err.message}`); }
};
const settle = () => new Promise((r) => setImmediate(r));
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
  };
}
const TODAY = '2026-11-26';

await test('the days asked: the days on screen cut to what a service answers, never more than 60', () => {
  assert.deepEqual(calWeatherSpan('2026-11-22', '2026-11-28', TODAY), { from: '2026-11-22', to: '2026-11-28' }, 'a week in range as it is');
  assert.deepEqual(calWeatherSpan('2026-09-01', '2026-12-31', TODAY), { from: '2026-10-26', to: '2026-12-10' }, 'a long span cut to 31 back and 14 ahead');
  assert.equal(calWeatherSpan('2026-06-01', '2026-06-30', TODAY), null, 'a month long gone asks nothing');
  assert.equal(calWeatherSpan('2027-03-01', '2027-03-31', TODAY), null, 'a month far ahead asks nothing');
  assert.equal(calWeatherSpan('2026-12-05', '2026-12-30', TODAY).to, '2026-12-10', 'the end is cut to 14 days ahead');
  const wide = calWeatherSpan('2026-01-01', '2027-12-31', TODAY);
  assert.ok(wide && (Date.parse(wide.to) - Date.parse(wide.from)) / 86400000 + 1 <= 60, 'at most 60 days');
  assert.equal(calWeatherSpan('2026-11-28', '2026-11-22', TODAY), null, 'first after last');
  assert.equal(calWeatherSpan('nope', '2026-11-22', TODAY), null, 'not a day');
});

await test('what a day hands the piece', () => {
  const answer = { configured: true, units: 'f', credit: 'Weather data: Test', days: { '2026-11-26': { state: 'forecast', code: 'rain', high: 12, low: 5 }, '2026-11-27': { state: 'unavailable' } } };
  assert.deepEqual(calWeatherFor(answer, '2026-11-26'), { day: answer.days['2026-11-26'], units: 'f', credit: 'Weather data: Test' });
  assert.equal(calWeatherFor(answer, '2026-12-30').day, null, 'a day the answer lacks draws nothing');
  assert.deepEqual(calWeatherFor(null, '2026-11-26'), { day: null, units: 'c', credit: '' });
  assert.equal(calWeatherFor({ days: { toString: 1 } }, 'toString').day, 1, 'own keys only are read');
  assert.equal(calWeatherFor({ days: {} }, 'toString').day, null, 'nothing inherited');
});

await test('one ask per draw, reused while fresh, a narrower draw served by a wider answer', async () => {
  const c = clock();
  const asks = [];
  const drawn = [];
  const k = calWeatherKeeper({ ask: async (s) => { asks.push(s); return { configured: true, units: 'c', credit: '', days: {} }; }, onAnswer: (a) => drawn.push(a), now: c.now, later: c.later, cancel: c.cancel });
  const month = { from: '2026-11-01', to: '2026-12-10' };
  assert.equal(k.want(month), true);
  assert.equal(k.want(month), true, 'a second draw before the ask is the same ask');
  await c.run(0);
  assert.equal(asks.length, 1);
  assert.equal(drawn.length, 1);
  assert.equal(k.want(month), false, 'fresh: not asked again');
  assert.equal(k.want({ from: '2026-11-22', to: '2026-11-28' }), false, 'a week inside the month answered is served');
  assert.equal(k.want(null), false, 'no days, no ask');
  await c.run(6 * 60 * 1000);
  assert.equal(k.want(month), true, 'stale: asked again, after a short wait');
  assert.equal(asks.length, 1);
  await c.run(700);
  assert.equal(asks.length, 2);
  assert.equal(k.want({ from: '2026-12-01', to: '2026-12-20' }), true, 'days outside the answer are asked for');
  await c.run(0);
  assert.equal(asks.length, 2, 'a change waits a moment, so a run of changes asks once');
  await c.run(700);
  assert.equal(asks.length, 3);
  assert.deepEqual(asks[2], { from: '2026-12-01', to: '2026-12-20' });
});

await test('a service that is off waits 10 minutes; a failure draws nothing and waits one', async () => {
  const c = clock();
  let mode = 'off';
  const asks = [];
  const drawn = [];
  const k = calWeatherKeeper({ ask: async (s) => { asks.push(s); if (mode === 'fail') throw new Error('502'); return mode === 'off' ? { configured: false } : { configured: true, days: {} }; }, onAnswer: (a) => drawn.push(a), now: c.now, later: c.later, cancel: c.cancel });
  const span = { from: '2026-11-22', to: '2026-11-28' };
  k.want(span); await c.run(0);
  assert.deepEqual([asks.length, drawn[0], k.answer], [1, null, null]);
  assert.equal(k.want(span), false);
  await c.run(9 * 60 * 1000);
  assert.equal(k.want(span), false, 'still resting');
  mode = 'fail';
  await c.run(61 * 1000);
  k.want(span); await c.run(700);
  assert.equal(asks.length, 2);
  assert.equal(k.answer, null, 'a failure draws nothing');
  assert.equal(k.want(span), false, 'and waits');
  mode = 'on';
  await c.run(61 * 1000);
  k.want(span); await c.run(700);
  assert.equal(asks.length, 3);
  assert.ok(k.answer && k.answer.configured === true);
});

await test('the manifest and the page: a space\'s Calendar only, a slot on each view, the SDK piece, no colour of its own', () => {
  const man = JSON.parse(fs.readFileSync(new URL('../module.json', import.meta.url), 'utf8'));
  assert.deepEqual(man.weather, { space: true });
  const js = read('calendar.js');
  const css = read('calendar.css');
  assert.match(js, /const weatherOn = inSpace && /, 'only in a space');
  assert.match(js, /host\.ui\.dayWeather\(box, o\)/, 'the SDK piece');
  assert.match(js, /host\.weather\.days\(span\)/, 'the SDK ask');
  assert.equal((js.match(/\$\{weatherSlot\(/g) || []).length, 4, 'slots: month, week, agenda heading, day view');
  assert.match(js, /closest\('\.cal-wx'\)\) return/, 'a press on the weather is not a press on the day');
  assert.equal((js.match(/wantWeather\(\);/g) || []).length, 2, 'asked after the calendar and the agenda draw');
  assert.doesNotMatch(css.slice(css.indexOf('.cal-wx')), /#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i, 'the weather rules hold no colour');
});

if (failures) { console.log(`${failures} failed`); process.exit(1); }
console.log('check-calendar-weather: OK');
