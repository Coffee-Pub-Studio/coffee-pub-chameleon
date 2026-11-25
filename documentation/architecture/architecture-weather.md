# Weather architecture

**Audience:** a developer changing how Chameleon gets and shows the weather on a day, and an admin deciding what leaves the server. For the route and its answers see [Modules API](../api/api-modules.md), "Weather"; for the page's pieces see [Module SDK](../api/api-module-sdk.md), "The weather on a day". The plan is [plan-itinerary-weather](../plans/plan-itinerary-weather.md).

## What it is

Each day of a trip in the Itinerary can show a small icon with the day's high and low. The weather comes from a **provider adapter**, a small module in `server/weather-providers/` for one service that is free for commercial use. Chameleon never uses a paid service (Thomas, 2026-11-25). No adapter is registered yet, so the Itinerary's **Weather** setting offers only **None** and nothing goes out. When one is, the admin chooses it, the server asks the service, keeps what it was told for a while and answers the page and agents from that. The page never contacts the service.

## The parts

- **The lookup and the cache** (`server/weather.js`). `WeatherCache` (line 291) keeps `DATA_DIR/weather.json`, keyed `"lat,lon|YYYY-MM-DD"`, each record `{ code, high, low, rain, got }`. It never keeps who asked, which space or what for. A forecast is good for 3 hours and a past day for 24; it holds at most 20,000 days and nothing older than 40 days. `askWeather` (`server/weather.js:191`) asks the chosen adapter's address: it sends only a position rounded to 2 decimals and a run of days, has 6 seconds for the whole ask, cuts the body at 400 KB and follows at most 3 redirects, each to a public address that is then asked at exactly the addresses that were checked (the same guard link previews use). `weatherDays` joins them.
- **The declaration** (`cleanWeather` in `server/modules.js`). A module says in its manifest which `choice` setting picks the provider (the setting carries `"adapters": "weather"`, so the server fills its options from the registered adapters and a manifest may list only `none`), an optional units setting, and where in its own stored data the days' places are, so the core hard-codes no keys. The Itinerary's settings are **Weather** (`None` until an adapter registers) and **Weather temperatures** (Celsius or Fahrenheit). There is no custom address and no key.
- **The provider adapters** (`server/weather-providers/index.js`). An adapter exports `{ id, name, credit, needsKey: false, allowHttp?, request(lat, lon, from, to), parse(json) }`; the contract is in [Modules API](../api/api-modules.md), "Weather". Only a service free for commercial use may be registered; none is yet. A test stand-in is loaded only when `WEATHER_TEST_STANDIN` is set, for `tools/check-weather.mjs`.
- **The route** (`GET /api/modules/:id/weather`, `server/index.js:13512`). It checks the module's read permission, finds each day's place, asks only for days the cache does not hold, and counts only asks that reach an outside service against the limit (30 per person, module and minute). A day's place is the first stop whose place resolves for the asker to an object with a position, else the trip's main place, found by sending the destination text to Maps' chosen place search (the answer is remembered in memory and never written), else none. The key is read here and is in no answer.
- **The SDK** (`host.weather.days`, routed through `'weather.days'` in `public/module-host.js:2256` to the route, and `host.ui.dayWeather`, which draws the button on a day header). A sandboxed frame has an opaque origin and no cookies, which is why the page asks through the host.
- **The Itinerary** (`modules/travel/src/travel-lib-weather.js`). Pure functions inlined into the page: which days to ask for (the plan's days cut to 31 back and 14 ahead, under the route's 60-day limit; a trip far in the past or the future asks nothing), where each day is, and what one day hands the SDK piece. `createWeather` decides when to ask: at most one ask per draw; an answer reused for 5 minutes; a change to the days or places asks again after 0.6 s, so a run of changes asks once; `configured: false` (no service, or a picture map) draws nothing and is not asked again for 10 minutes; a 502, a 429 or any other error draws nothing and waits 60 seconds; an older answer arriving late cannot replace a newer one.
- **Agents** read the same route through the gate and the MCP tool `read_weather` ([Agents API](../api/api-agents.md)). The tool is fixed to the Itinerary.

## What leaves the server

Only when an owner has chosen a service and no picture map is set. To the weather service: what the chosen adapter's `request` builds from a position rounded to 2 decimals and the days. To the place search: the destination text, only when a day has no stop place and the destination is not already saved or remembered. The weather service's `User-Agent` carries no contact. Never who asks, the space, the environment or anything else of the trip.

## Known gaps

- The Itinerary's configuration page has no "Weather is working" test button.
- A failing weather service is asked again on every request, bounded by the limit.
- Every redraw rebuilds the day headers, so the piece's fade-in plays again; reduced motion turns it off.
- `server/geocode.js` still follows redirects with a plain `fetch` and no address check, and sends the repository address in its `User-Agent`.
- A negative temperature prints with a hyphen, not a minus sign.
- Whether weather should be its own route part rather than code in `server/index.js` is open.
- No real service was ever reached: the lookup is checked only against a stand-in service. A MET Norway adapter is in the TODO.
