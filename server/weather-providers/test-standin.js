// Test only: stands in for a weather service so tools/check-weather.mjs can run the whole route. It is not a weather service,
// it is registered only when WEATHER_TEST_STANDIN is set (to the address of the check's own fake service), and it must never
// be offered to a person. Its answer: { days: [{ day, code, high, low, rain }] }.
'use strict';

const WORDS = ['clear', 'partly', 'cloudy', 'fog', 'drizzle', 'rain', 'snow', 'storm'];

module.exports = {
  id: 'standin',
  name: 'Test stand-in (not a weather service)',
  credit: '',
  needsKey: false,
  allowHttp: true,
  request(lat, lon, from, to) {
    const u = new URL(process.env.WEATHER_TEST_STANDIN);
    u.searchParams.set('lat', lat);
    u.searchParams.set('lon', lon);
    u.searchParams.set('from', from);
    u.searchParams.set('to', to);
    return u.href;
  },
  parse(json) {
    if (!json || !Array.isArray(json.days)) throw new Error('not an answer'); // an answer that is not the service's
    const out = {};
    for (const d of json.days.slice(0, 400)) {
      if (!d || typeof d.day !== 'string' || !WORDS.includes(d.code) || !Number.isFinite(d.high) || !Number.isFinite(d.low)) continue;
      out[d.day] = { code: d.code, high: d.high, low: d.low, rain: Number.isFinite(d.rain) ? d.rain : null };
    }
    return out;
  },
};
