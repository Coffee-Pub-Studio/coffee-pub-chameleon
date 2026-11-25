// The weather on each day of the plan (documentation/plans/plan-itinerary-weather.md, step 4): which days to ask the server
// for, when to ask again, and what one day draws. The page asks host.weather.days({ from, to }) at most once per draw, for the
// plan's dated span cut to the days a weather service can answer (about a month back, two weeks ahead); never once per day. An
// answer is kept in the page for a few minutes, so a redraw does not ask again; a change to the days or to where the stops are
// asks again after a short wait. A service that is off (`configured: false`) is not asked again for a while, and a failure
// (502, 429, anything) draws nothing and waits a minute. Nothing here is saved with the trip. Pure: the page hands in the ask
// and the clock, so tools and tests can run it.
const WEATHER_FRESH_MS = 5 * 60 * 1000; // an answer is reused this long
const WEATHER_OFF_MS = 10 * 60 * 1000; // "no service chosen": not asked again for this long (an owner's change of settings asks at once)
const WEATHER_FAILED_MS = 60 * 1000; // the service failed or the limit was reached: nothing is drawn, and nothing is asked for this long
const WEATHER_WAIT_MS = 600; // a change to the days or the stops' places waits this long, so a run of changes asks once
const WEATHER_BACK_DAYS = 31; // the server answers up to 30 days back and 13 ahead; a day either side is kept for time zones
const WEATHER_AHEAD_DAYS = 14;

// The days to ask for: the plan's first and last day, cut to the days a service can answer. null when none of them can be.
function weatherSpan(days, today) {
  const list = (Array.isArray(days) ? days : []).filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (!list.length || typeof today !== 'string') return null;
  const shift = (n) => { const d = parseYmd(today); d.setDate(d.getDate() + n); return ymd(d); };
  const back = shift(-WEATHER_BACK_DAYS);
  const ahead = shift(WEATHER_AHEAD_DAYS);
  const from = list[0] > back ? list[0] : back;
  const to = list[list.length - 1] < ahead ? list[list.length - 1] : ahead;
  return from <= to ? { from, to } : null;
}

// What decides where each day is, as one string: the trip's main place and each dated stop's day, time, order and place
// pointer. When it changes, the weather is asked again.
function weatherPlaces(items, trip) {
  const stops = (Array.isArray(items) ? items : [])
    .filter((i) => i && i.date && i.placeRef && typeof i.placeRef === 'object')
    .map((i) => [i.date, i.time || '', Number.isFinite(i.order) ? i.order : 0, i.placeRef.module, i.placeRef.kind, i.placeRef.id, i.placeRef.scope || '', i.placeRef.space || ''].join(' '))
    .sort();
  return JSON.stringify([(trip && typeof trip.destination === 'string' && trip.destination.trim()) || '', stops]);
}

// What one day hands host.ui.dayWeather: its day of the answer (null draws nothing), and the answer's units and credit.
function weatherFor(answer, date) {
  const days = answer && answer.days && typeof answer.days === 'object' ? answer.days : null;
  const day = days && Object.prototype.hasOwnProperty.call(days, date) ? days[date] : null;
  return { day: day || null, units: answer && answer.units === 'f' ? 'f' : 'c', credit: answer && typeof answer.credit === 'string' ? answer.credit : '' };
}

// The page's keeper of the answer. `ask({ from, to })` is host.weather.days; `onAnswer(answer)` redraws the days (answer is
// null when there is nothing to draw). `now`, `later` and `cancel` are the clock, for a test.
function createWeather({ ask, onAnswer, now = () => Date.now(), later = (fn, ms) => setTimeout(fn, ms), cancel = (t) => clearTimeout(t) }) {
  let answer = null; // the last answer with a service chosen, or null
  let sig = ''; // what that answer was asked for
  let at = 0; // when it came
  let off = 0; // asked nothing before this time (a service off, or failing)
  let pending = ''; // what is waiting to be asked
  let timer = null;
  let seq = 0;
  let asked = 0;
  async function go(span, s) {
    const mine = ++seq;
    asked += 1;
    let got = null;
    let failed = false;
    try { got = await ask(span); } catch (err) { failed = true; }
    if (mine !== seq) return; // a newer ask was made meanwhile: its answer counts
    pending = '';
    at = now();
    sig = s;
    if (failed) { answer = null; off = at + WEATHER_FAILED_MS; } else if (!got || got.configured !== true) { answer = null; off = at + WEATHER_OFF_MS; } else { answer = got; off = 0; }
    onAnswer(answer);
  }
  return {
    get answer() { return answer; },
    get asked() { return asked; }, // how many times the server was asked (for a test)
    // The page drew these days: ask for them unless the kept answer still serves. True when an ask is waiting.
    want(span, places) {
      if (!span) return false;
      const s = `${span.from}|${span.to}|${places || ''}`;
      const t = now();
      if (t < off) return false;
      if (answer && s === sig && t - at < WEATHER_FRESH_MS) return false;
      if (s === pending) return true;
      if (timer !== null) cancel(timer);
      pending = s;
      timer = later(() => { timer = null; go(span, s); }, at ? WEATHER_WAIT_MS : 0);
      return true;
    },
    // The module's settings changed (an owner chose a service, or another): the next draw asks at once.
    reset() { off = 0; at = 0; sig = ''; pending = ''; if (timer !== null) cancel(timer); timer = null; seq += 1; },
  };
}
