'use strict';
// The day the space's weather is for (documentation/plans/plan-weather-users.md, "Taken on the leans"): pure, so
// tools/check-weather.mjs runs it without a server. Days are YYYY-MM-DD strings; a person, a space or a place is never
// in here.
//
// Today while the space's main phase is under way; before it, the main phase's first day; after it, none. With no dated
// main phase, the place module's own first and last day (`main`: { from, to }, either '') by the same rule; with no dates
// at all, today. `bands` are the timeline's bands ({ main, dated, start, end }), [] without phases.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDay = (v) => (typeof v === 'string' && DAY.test(v) ? v : '');

function weatherSpaceDay(bands, main, today) {
  const band = Array.isArray(bands) ? bands.find((b) => b && b.main && b.dated && asDay(b.start)) : null;
  let start = band ? asDay(band.start) : '';
  let end = band ? asDay(band.end) || start : '';
  if (!start) {
    start = asDay(main && main.from);
    end = asDay(main && main.to) || start;
  }
  if (!start) return today;
  if (end < start) end = start;
  if (today < start) return start;
  if (today > end) return null;
  return today;
}

module.exports = { weatherSpaceDay };
