// The weather services the server knows (documentation/plans/plan-itinerary-weather.md). An adapter is a module in this
// folder that exports:
//   { id, name, credit, needsKey: false, allowHttp?, terms?, headers?, pastDays?, aheadDays?, minAskMs?,
//     request(lat, lon, from, to) -> the address to ask, as a string (lat and lon already rounded to 2 decimals; from and
//         to are "YYYY-MM-DD"). It is https unless the adapter says `allowHttp` (only the test stand-in does),
//     parse(json) -> { "YYYY-MM-DD": { code, high, low, rain } } }
// The optional parts: `terms`, the address of the service's terms, shown with the choice in the module's settings;
// `headers()` -> request headers the service asks for (the User-Agent it wants; never a key, a cookie or anything of a person);
// `pastDays: false` for a service that gives forecasts only (a past day is then never asked for); `aheadDays`, how many days
// after today it reaches (a day further out is never asked for); `minAskMs`, the least time between two asks for one
// position, on top of the answer's own Expires (server/weather.js). `credit` is at most 120 characters (the popover's room).
// `code` is one of the words in server/weather.js (WORDS), `high` and `low` are in Celsius and `rain` is a percent or null.
// A day the service did not give, or gave in a way the adapter cannot read, is left out, never guessed.
//
// THE RULE (Thomas, 2026-11-25): a registered adapter is for a service that is free for commercial use, with no payment and no
// key. Never a paid service, never one whose free tier forbids commercial use; read its terms before the adapter is written,
// not after, and write down in the adapter's header where they are and the day they were read.
// Registered: MET Norway (met-norway.js; free for any use under CC BY 4.0, terms read 2026-11-25). Registering is not choosing:
// the Itinerary's provider setting starts at None, and nothing is asked until an admin chooses a service. The test stand-in
// is registered only when the check sets WEATHER_TEST_STANDIN to the address of its own fake service.
'use strict';

const ID = /^[a-z][a-z0-9-]{0,23}$/;

function valid(p) {
  return p && typeof p === 'object' && ID.test(p.id) && typeof p.name === 'string' && p.name && typeof p.credit === 'string'
    && p.credit.length <= 120 && p.needsKey === false && typeof p.request === 'function' && typeof p.parse === 'function'
    && (p.headers === undefined || typeof p.headers === 'function') && (p.terms === undefined || /^https:\/\//.test(p.terms))
    && (p.aheadDays === undefined || (Number.isInteger(p.aheadDays) && p.aheadDays >= 0))
    && (p.minAskMs === undefined || (Number.isFinite(p.minAskMs) && p.minAskMs >= 0));
}

const registered = [require('./met-norway')];
if (process.env.WEATHER_TEST_STANDIN) registered.push(require('./test-standin'));
for (const p of registered) if (!valid(p)) throw new Error('a weather adapter is not valid');

const providers = Object.fromEntries(registered.map((p) => [p.id, p]));
module.exports = { providers, list: () => registered, valid };
