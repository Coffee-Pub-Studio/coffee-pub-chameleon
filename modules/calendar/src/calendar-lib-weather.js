
  // The weather on the days a space's Calendar shows (documentation/plans/plan-weather-users.md, step 4): which days to ask the
  // server for, when to ask again, and what one day draws. The Calendar declares `"weather": { "space": true }`, so every day
  // has the space's place (the trip's destination); an event has no place of its own. The page asks host.weather.days({ from,
  // to }) at most once per draw, for the days on screen (at most 60) cut to the days a weather service can answer; never once
  // per day. An answer is kept in the page for a few minutes, so a redraw does not ask again; a service that is off
  // (`configured: false`) is not asked again for a while; a failure draws nothing and waits a minute. Nothing is saved.
  // Pure: the page hands in the ask and the clock, so a test can run it. (The same rules as the Itinerary's, travel-lib-weather.js.)
  const CAL_WEATHER_FRESH_MS = 5 * 60 * 1000; // an answer is reused this long
  const CAL_WEATHER_OFF_MS = 10 * 60 * 1000; // "no service chosen": not asked again for this long
  const CAL_WEATHER_FAILED_MS = 60 * 1000; // the service failed or the limit was reached: nothing is drawn, nothing is asked for this long
  const CAL_WEATHER_WAIT_MS = 600; // a change of the days waits this long, so a run of changes asks once
  const CAL_WEATHER_BACK_DAYS = 31; // the server answers up to 30 days back and 13 ahead; a day either side is kept for time zones
  const CAL_WEATHER_AHEAD_DAYS = 14;
  const CAL_WEATHER_MAX_DAYS = 60; // the most days one ask may cover

  // The days to ask for: the first and last day on screen, cut to the days a service can answer and to 60 days. null when none
  // of them can be (a month long past, a year ahead). `first` and `last` are YYYY-MM-DD.
  function calWeatherSpan(first, last, today) {
    const ok = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (!ok(first) || !ok(last) || !ok(today) || first > last) return null;
    const at = (s, n) => {
      const [y, m, d] = s.split('-').map(Number);
      const t = new Date(Date.UTC(y, m - 1, d + n));
      return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
    };
    const back = at(today, -CAL_WEATHER_BACK_DAYS);
    const ahead = at(today, CAL_WEATHER_AHEAD_DAYS);
    const from = first > back ? first : back;
    let to = last < ahead ? last : ahead;
    if (from > to) return null;
    const cap = at(from, CAL_WEATHER_MAX_DAYS - 1);
    if (to > cap) to = cap;
    return { from, to };
  }

  // What one day hands host.ui.dayWeather: its day of the answer (null draws nothing), and the answer's units and credit.
  function calWeatherFor(answer, date) {
    const days = answer && answer.days && typeof answer.days === 'object' ? answer.days : null;
    const day = days && Object.prototype.hasOwnProperty.call(days, date) ? days[date] : null;
    return { day: day || null, units: answer && answer.units === 'f' ? 'f' : 'c', credit: answer && typeof answer.credit === 'string' ? answer.credit : '' };
  }

  // The page's keeper of the answer. `ask({ from, to })` is host.weather.days; `onAnswer(answer)` redraws the days (answer is
  // null when there is nothing to draw). `now`, `later` and `cancel` are the clock, for a test.
  function calWeatherKeeper({ ask, onAnswer, now = () => Date.now(), later = (fn, ms) => setTimeout(fn, ms), cancel = (t) => clearTimeout(t) }) {
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
      if (failed) { answer = null; off = at + CAL_WEATHER_FAILED_MS; } else if (!got || got.configured !== true) { answer = null; off = at + CAL_WEATHER_OFF_MS; } else { answer = got; off = 0; }
      onAnswer(answer);
    }
    return {
      get answer() { return answer; },
      get asked() { return asked; }, // how many times the server was asked (for a test)
      // The page drew these days: ask for them unless the kept answer still serves. True when an ask is waiting.
      want(span) {
        if (!span) return false;
        const s = `${span.from}|${span.to}`;
        const t = now();
        if (t < off) return false;
        if (answer && t - at < CAL_WEATHER_FRESH_MS && answer.days && span.from >= sig.split('|')[0] && span.to <= sig.split('|')[1]) return false;
        if (s === pending) return true;
        if (timer !== null) cancel(timer);
        pending = s;
        timer = later(() => { timer = null; go(span, s); }, at ? CAL_WEATHER_WAIT_MS : 0);
        return true;
      },
    };
  }
