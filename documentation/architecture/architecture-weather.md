# Weather architecture

**Audience:** a developer changing how Chameleon gets and shows the weather on a day, and an admin deciding what leaves the server. For the route and its answers see [Modules API](../api/api-modules.md), "Weather"; for the page's pieces see [Module SDK](../api/api-module-sdk.md), "The weather on a day". The plan is [plan-itinerary-weather](../plans/plan-itinerary-weather.md).

## What it is

Each day of a trip in the Itinerary can show a small icon with the day's high and low. The weather comes from a service the admin chooses; Chameleon bundles no paid service, and nothing goes out until an admin supplies the address of one. The server asks it, keeps what it was told for a while, and answers the page and agents from that. The page never contacts the service.

## The parts

- **The lookup and the cache** (`server/weather.js`). `WeatherCache` (line 291) keeps `DATA_DIR/weather.json`, keyed `"lat,lon|YYYY-MM-DD"`, each record `{ code, high, low, rain, got }`. It never keeps who asked, which space or what for. A forecast is good for 3 hours and a past day for 24; it holds at most 20,000 days and nothing older than 40 days. `askWeather` (line 191) speaks to an Open-Meteo-compatible service: it sends only a position rounded to 2 decimals and a run of days, has 6 seconds for the whole ask, cuts the body at 400 KB and follows at most 3 redirects, each to a public address that is then asked at exactly the addresses that were checked (the same guard link previews use). `weatherDays` (line 414) joins them.
- **The declaration** (`cleanWeather` in `server/modules.js`). A module says in its manifest which of its settings choose the service, and where in its own stored data the days' places are, so the core hard-codes no keys. The Itinerary's settings are **Weather** (`None` by default, or the address of a service), **Weather address**, **Weather key** (a secret) and **Weather temperatures** (Celsius or Fahrenheit), all of the environment scope.
- **The route** (`GET /api/modules/:id/weather`, `server/index.js:13512`). It checks the module's read permission, finds each day's place, asks only for days the cache does not hold, and counts only asks that reach an outside service against the limit (30 per person, module and minute). A day's place is the first stop whose place resolves for the asker to an object with a position, else the trip's main place, found by sending the destination text to Maps' chosen place search (the answer is remembered in memory and never written), else none. The key is read here and is in no answer.
- **The SDK** (`host.weather.days`, routed through `'weather.days'` in `public/module-host.js:2256` to the route, and `host.ui.dayWeather`, which draws the button on a day header). A sandboxed frame has an opaque origin and no cookies, which is why the page asks through the host.
- **The Itinerary** (`modules/travel/src/travel-lib-weather.js`). Pure functions inlined into the page: which days to ask for (the plan's days cut to 31 back and 14 ahead, under the route's 60-day limit; a trip far in the past or the future asks nothing), where each day is, and what one day hands the SDK piece. `createWeather` decides when to ask: at most one ask per draw; an answer reused for 5 minutes; a change to the days or places asks again after 0.6 s, so a run of changes asks once; `configured: false` (no service, or a picture map) draws nothing and is not asked again for 10 minutes; a 502, a 429 or any other error draws nothing and waits 60 seconds; an older answer arriving late cannot replace a newer one.
- **Agents** read the same route through the gate and the MCP tool `read_weather` ([Agents API](../api/api-agents.md)). The tool is fixed to the Itinerary.

## What leaves the server

Only when an owner has chosen a service and no picture map is set. To the weather service: a position rounded to 2 decimals, the daily fields, `timezone=auto`, the days, and `apikey` only when a key is kept. To the place search: the destination text, only when a day has no stop place and the destination is not already saved or remembered. The weather service's `User-Agent` carries no contact. Never who asks, the space, the environment or anything else of the trip.

## Known gaps

- The Itinerary's configuration page has no "Weather is working" test button.
- A failing weather service is asked again on every request, bounded by the limit.
- Every redraw rebuilds the day headers, so the piece's fade-in plays again; reduced motion turns it off.
- `server/geocode.js` still follows redirects with a plain `fetch` and no address check, and sends the repository address in its `User-Agent`.
- A negative temperature prints with a hyphen, not a minus sign.
- Whether weather should be its own route part rather than code in `server/index.js` is open.
- The real service's terms and field names were not read, and the real service was never reached (no network in the builder's environment): the lookup is checked only against a stand-in service.
