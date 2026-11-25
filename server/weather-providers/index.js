// The weather services the server knows (documentation/plans/plan-itinerary-weather.md). An adapter is a module in this
// folder that exports:
//   { id, name, credit, needsKey: false, allowHttp?,
//     request(lat, lon, from, to) -> the address to ask, as a string (lat and lon already rounded to 2 decimals; from and
//         to are "YYYY-MM-DD"). It is https unless the adapter says `allowHttp` (only the test stand-in does),
//     parse(json) -> { "YYYY-MM-DD": { code, high, low, rain } } }
// `code` is one of the words in server/weather.js (WORDS), `high` and `low` are in Celsius and `rain` is a percent or null.
// A day the service did not give, or gave in a way the adapter cannot read, is left out, never guessed.
//
// THE RULE (Thomas, 2026-11-25): a registered adapter is for a service that is free for commercial use, with no payment and no
// key. Never a paid service, never one whose free tier forbids commercial use; read its terms before the adapter is written,
// not after. No adapter is registered yet. The only one that can be is the test stand-in, and only when the check sets
// WEATHER_TEST_STANDIN to the address of its own fake service.
'use strict';

const ID = /^[a-z][a-z0-9-]{0,23}$/;

function valid(p) {
  return p && typeof p === 'object' && ID.test(p.id) && typeof p.name === 'string' && p.name && typeof p.credit === 'string'
    && p.needsKey === false && typeof p.request === 'function' && typeof p.parse === 'function';
}

const registered = [];
if (process.env.WEATHER_TEST_STANDIN) registered.push(require('./test-standin'));
for (const p of registered) if (!valid(p)) throw new Error('a weather adapter is not valid');

const providers = Object.fromEntries(registered.map((p) => [p.id, p]));
module.exports = { providers, list: () => registered, valid };
