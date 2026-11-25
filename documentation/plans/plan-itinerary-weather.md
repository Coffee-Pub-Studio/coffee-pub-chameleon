# Itinerary Weather Plan

**Audience:** Thomas decides; server-development builds the weather lookup, its route and the agent read (`server/`, `tools/`;
core); experience-design builds the day header's weather piece in the SDK and the Itinerary's use of it (core for the SDK piece,
module lane for the Itinerary, a patch bump each); quality-assurance reads the server half as a privacy change when Thomas calls a
feedback or production build; content-manager documents.

**Status:** Draft, 2026-11-25; steps 1 to 5 are built (see Progress). From GitHub issue #1080 (Planner: Show the weather on each itinerary
day). Thomas, 2026-11-23: "add itinerary enhancement: map the weather to the days." Thomas has decided only that this is wanted;
everything else below is a recommendation he has not yet seen, so it is listed under "Recommendations", not "Decisions".

**Progress (2026-11-25, read against `main` at `fa5ea4bd`).** Steps 1 to 5 are built and merged; step 6 is not part of this plan.

1. The lookup and its cache, `server/weather.js` and `tools/check-weather.mjs` (#1096).
2. The declaration, the route and the Itinerary's settings (#1101; Itinerary 0.16.21). The redirect gap named in step 1's review is closed: a hop off the admin's origin is checked and asked at exactly the addresses checked.
3. `host.ui.dayWeather` (#1106), on the Design System page.
4. The Itinerary draws it, with `host.weather.days` (#1110; Itinerary 0.16.22).
5. The agent read, `read_weather` (#1109).

Built as Thomas decided on 2026-11-25 (never a paid service): provider adapters in `server/weather-providers/` replace the Open-Meteo preset, the custom address and the key (#1118). The MET Norway adapter is built (`met-norway.js`, try build, 2026-11-25; terms read that day): registered by default, offered beside **None**, which stays the default. It sends its own User-Agent (product, version and the repository's address) through a per-adapter header hook, never asks one position again before the answer's Expires or 3 hours (whichever is later), sends If-Modified-Since and keeps a 304 as fresh, and is never asked for a past day (past days answer `unavailable`). Days are cut at the place's own midnight from its longitude; a part day at the end is dropped. The compact answer has no chance of rain, so `rain` is null. Not built: the owner's "Weather is working" test button. Open: whether weather should be its own route part rather than code in `server/index.js`. No real service was ever reached: MET's terms must be accepted by a person in authority first (see TODO).

## What it is today

- **The Itinerary** (`modules/travel`, 0.16.20) draws one `section.day` per day. A day's header is the `tpl-day-head` template in
  `modules/travel/src/travel.html`: the date, `position` ("Day 3 of 7"), a `summary` line, a row of labels (`.sdk-day-labels`: the
  phase, today, whole-day markers) and the add and more buttons. It is built in `buildDay` in `modules/travel/src/travel.js`.
  `modules/travel/src/CONTRACT.md` is the markup agreement.
- **Where a day is.** A stop has `place` (a name), `address` and, when the person picked one from Maps, `placeRef` (a pointer to a
  Maps place, `travel-lib.js`). The Itinerary already reads the summaries of the objects it points at (`plan.summaries`,
  `refreshSummaries` in `travel-lib-plan.js`); a Maps place's summary carries `place: point` (the `refs.produces` entry in
  `modules/maps/module.json`), its position. The trip has a `destination`, which is plain text of up to 80 characters
  (`cleanTrip` in `travel-lib.js`), not a position. A stay and a journey carry names, not positions.
- **An outside service the admin chooses already exists once.** A module that declares `geocoder` in `module.json` has its place
  searches answered by the server (`server/geocode.js`, `geocodeSetup` and `GET /api/modules/:id/geocode` in `server/index.js`,
  declared by Maps): the module's settings name a provider (Photon, or a custom address), the server asks, with a time and size
  limit and a User-Agent, only when it has too few saved places, and with none chosen nothing goes out. What is kept is a fact
  about a place, never what was searched for, who or which space. Calls count against the module's `search` limit
  (`server/module-limits.js`). The flight lookup (`lookups: ["flight"]`, `LOOKUP_KINDS` in `server/modules.js`) is the other
  server-asked lookup.
- **The story strip plan already wanted weather.** [plan-space-story-strip](plan-space-story-strip.md), step 9, plans a
  host-level weather lookup (`server/weather.js`, `WEATHER_ADDRESS` and `WEATHER_KEY` in environment variables, a cache in
  `DATA_DIR/weather.json`, a forecast within 7 days) for one chip at the destination. Nothing of it is built. This plan and that
  one need the same lookup; see recommendation 1.
- **Agents read module data through `read_data` and the objects routes** (`documentation/api/api-agents.md`, "The tools"). There
  is no weather to read. Decision 8 of [plan-agent-edit-delete](plan-agent-edit-delete.md): nothing waits for a page.
- Nothing in the code or in `TODO.md` shows weather on a day.

## Decisions

Only Thomas's.

1. **The Itinerary shows the weather on each day** (Thomas, 2026-11-23, quoted under Status).

## Recommendations

Each is a suggestion for Thomas. Unless he says otherwise they are taken as the plan's contract below (CLAUDE.md: for a small
choice, take the planner's lean and say so). Two or three options are given only where the choice is large.

1. **Where the lookup and its setting live.**
   - (a) The Itinerary declares a `weather` lookup in its manifest, as Maps declares `geocoder`: a provider choice setting
     (None, then each registered service), a unit setting. The admin chooses in Module
     Configuration, per environment. Costs: a second declaration kind beside `geocoder`. Rules out: environment variables for the
     address.
   - (b) Environment variables `WEATHER_ADDRESS` and `WEATHER_KEY`, as the story strip plan suggested. Costs: an admin edits
     server configuration, not a page, and every environment on a host shares one choice. Rules out: the admin choosing in settings,
     which is how the place search works and what the issue asks.
   - **Lean: (a).** The story strip's step 9 then asks the same lookup (`server/weather.js`) and takes its provider from the
     Itinerary's settings, so there is one weather service, one cache and one credit line. The strip's two variables are not
     built; that plan's open question 1 is settled by this one if Thomas agrees.
2. **The service.** Decided (Thomas, 2026-11-25): never a paid service, never one whose free tier forbids commercial use; check the
   terms before planning, not after. Open-Meteo is not free for commercial use, so nothing of it is built, and no admin-typed
   address or key exists: a service is an adapter in `server/weather-providers/<id>.js` that the server registers, and the provider
   setting offers `none` and each registered adapter. The contract: `{ id, name, credit, needsKey: false, request(lat, lon, from,
   to) -> an https address, parse(json) -> { 'YYYY-MM-DD': { code, high, low, rain } } }`, `code` one of eight words (clear, partly,
   cloudy, fog, drizzle, rain, snow, storm), `high` and `low` in Celsius, `rain` a percent or null. The lookup, its cache, limits,
   redirect guard and privacy do not depend on any one service. Only a test stand-in is registered so far (and only when the check
   sets `WEATHER_TEST_STANDIN`); no real service yet.
   - **Next build, the first adapter: MET Norway Locationforecast.** Free including commercial use under CC BY 4.0, attribution
     required (the adapter's `credit`), and it must identify itself in the User-Agent (so the adapter or the lookup needs to send
     a contact the terms accept, which today's product-and-version User-Agent does not). It gives forecasts only, so past days
     draw nothing (`unavailable`). Its terms were revised 2026-11-05: read the current terms on the build day, before the build.
3. **Where a day's weather comes from.** Lean, in this order: the first stop of the day (by time, then by order) whose saved Maps
   place has a position; else the first stop of the day with a position that a person set; else the trip's main place; else
   nothing. A stay and a journey do not give a place (they carry names only, and a flight's two ends are not "where the day is").
   The trip's main place is the `destination` text resolved to a position by Maps' place search (saved places first, then Maps'
   chosen service), only when Maps is on and has a service chosen. It is resolved on the server, never by a page, and a trip
   whose destination cannot be found shows nothing on days with no stop position. Rejected: asking the weather service itself to
   find a place from text (a second kind of outside call that sends what a person typed).
4. **How far ahead, and how far back.** Lean: from 30 days ago through 13 days ahead (today and the 13 after), because the
   service's forecast reaches 16 days but its last days are weak and the issue says "about two weeks". A day further out shows
   nothing, not a guess and not a usual range (a usual-range line is a later idea; it is not planned here). A day more than 30
   days back shows nothing.
5. **Units.** Lean: an environment setting, Celsius or Fahrenheit, default Celsius. The server always asks and keeps Celsius, so one
   cache serves both; the page converts and rounds. A per-person choice is later work.
6. **Who reads it.** Lean: anyone who may see the Itinerary (its `view` permission), guests included, as they see the days.
7. **Credit.** Lean: the service's credit text is part of every answer and is shown in the small popover a tap on the weather
   opens, as Maps shows its search credit. A service's licence may need its name shown.
8. **The agent read.** Lean: a read route and an MCP tool `read_weather` (`space`, `from?`, `to?`), counted as one read, answering
   what the page gets. Reasons under "Agents".
9. **A quiet failure.** Lean: when the service fails, days draw nothing and the page asks again the next time it draws; no error on
   a day header, because a row of eight failures is noise. The answer says `unavailable` so an agent can tell.
10. **Weather is not saved with the trip.** Lean: it is read each time, never written into the Itinerary's data, a Calendar copy
    or an export, so no stored key changes and a person never edits it.

## The contract

### The admin setting and the manifest (core for the declaration, module lane for the Itinerary's manifest)

`modules/travel/module.json` gains settings, all `scope: "environment"`, shown on the Itinerary's Module Configuration page under a
heading "Weather":

| Key | Type | Help (plain words) |
|---|---|---|
| `weatherProvider` | `choice`: `none` (default), then each registered service (the server adds them) | "Where the weather on each day comes from. None: no weather is shown and nothing is sent out. Only services that are free for commercial use are offered." |
| `weatherUnits` | `choice`: `c` (default), `f` | "Show temperatures in Celsius or Fahrenheit." |

The manifest declares `"weather": { "provider": "weatherProvider", "units": "weatherUnits", "stops": {...}, "main": {...} }`, cleaned in `server/modules.js` by a `cleanWeather` beside `cleanGeocoder` (each name must be a setting of the right type; the registered adapters are added to the provider setting as choices). Nothing is sent when the provider is `none` or when the environment has a picture map (an invented world has no real weather: the route answers `configured: false, pictureMap: true`, as the place search does).

### What goes out, what is kept (server)

- **Sent to the service:** a position rounded to 2 decimals (about 1 km), a first and a last day, and nothing else, in the address the adapter builds. Never a name,
  an address, a space, an environment, a person or the trip's text. A User-Agent as `server/geocode.js` sends
  (`userAgent({ contact: REPOSITORY_URL })`). Time limit 6 seconds, body at most 400 KB, redirects followed (each checked), `https` only (the test stand-in alone may use `http`).
- **Kept:** `DATA_DIR/weather.json`, at the host's level (one answer serves every space going to the same town), an object keyed by
  rounded position and day: `{ code, high, low, rain, got }` with `got` the time it was fetched. A forecast day is good for 3
  hours; a day before today for 24 hours (it no longer changes much); a day dropped once older than 40 days. A cap of 20,000 days,
  the oldest going first. Kept in memory and written a moment after a change, as `GeocodeCache` is. **Never kept:** what a person
  or an agent asked for, who asked, which space or environment, the destination text, the trip's dates as a whole, or the
  service's address. The cache is not exported with an environment and holds no link to a person.
- A request to the service covers one position and one run of days, so a trip with several distinct day places makes one call
  for each, at most 8 places per request; days beyond those use the trip's main place.

### The route (core)

`GET /api/modules/:id/weather?scope=space&space=<id>&from=<date>&to=<date>`, for a module that declares `weather` (404 "this
module has no weather" otherwise, in the environment's words). Needs the module's `read` permission. `from` and `to` default to
the trip's first and last day and span at most 60 days (400 with a sentence otherwise). The server works out each day's place
(recommendation 3) from the module's own data and the saved places, so a page and an agent get the same answer from one rule.
Answer:

```text
{ configured, credit, units, days: { "2026-12-03": { state, code, words, high, low, rain }, ... } }
```

`state` is one of `forecast`, `past`, `outOfRange`, `noPlace`, `unavailable`; `code` is a short word the SDK knows (`clear`,
`partly`, `cloudy`, `fog`, `drizzle`, `rain`, `snow`, `storm`), mapped from the service's weather code in one table in
`server/weather.js`; `words` is the plain sentence ("Light rain"); `high` and `low` are whole degrees in `units`; `rain` is a
whole percent or null. With no provider chosen: `{ configured: false }` and no `days`. 429 over the limit (a new `weather` limit in
`LIMITS`, `server/module-limits.js`, lean 30 per window per person); 502 "weather is not available right now" when the service
fails and nothing fresh is kept (the page treats it as the `unavailable` state). A day with a kept answer that is not too old is
served without asking.

If the server cannot read the Itinerary's data the way the route needs (the day's stops and their places), the fallback is that the
page sends the days and their positions in a `POST` body (`{ days: [{ date, lat, lon }] }`, at most 60) and the agent read waits
for a later step; the builder of step 2 says which, with the reason. The recommendation is the server reading it, so an agent never
depends on a page.

### What a person sees: the day header (core SDK piece, module lane use)

A new SDK drawn piece, `host.ui.dayWeather` (markup and styles in `public/sdk/system.css`, a `.sdk-day-weather` block with its entry
on the Design System pages), made once and used by the Itinerary:

- A small icon (`host.ui.icon`, one per `code`) and the high and low as "22 / 14" with the unit sign once ("22 / 14 C" is not
  repeated; the degree sign stands in). It sits at the end of the day's label row (`.sdk-day-labels`), the same size as a label, in
  the dim text colour, on the day-date side on a phone. The icon is never the only carrier: its `aria-label` and the popover say the
  words ("Light rain, high 22, low 14, 40 percent chance of rain").
- Colours come only from the theme tokens (`--text`, `--text-dim`, `--bg-card`, `--border`); no fixed colour, so a light theme
  works. Nothing has a fixed height. It is a button (a touch target of 44 px on a phone, `check-phone-targets`); a tap opens a small
  `host.menu.show` popover with the words, high and low, the chance of rain, "Forecast" or "What it was", and the credit line.
- On a phone (under the narrow breakpoint) the piece shows the icon and the high only; the low is in the popover. It wraps to its
  own line under the labels rather than pushing the add button off.
- A day's weather is not drawn while the page is waiting: the header is complete without it and the piece fades in when the answer
  arrives, so the page never jumps.

| State | What the header shows | What the popover says |
|---|---|---|
| `forecast` (today and the next 13 days, a place known) | Icon and high / low | The words, high and low, chance of rain, "Forecast", the credit |
| `past` (up to 30 days back) | Icon and high / low, a little dimmer, with "was" in the aria-label | The words, high and low, "What it was", the credit |
| `outOfRange` (further ahead than 13 days, or further back than 30) | Nothing | None |
| `noPlace` (no stop with a position and no main place that resolves) | Nothing | None |
| service off (`configured: false`, or a picture map) | Nothing, and no hint to members | None; the Itinerary's Module Configuration page says weather is off |
| `unavailable` (the service failed, nothing kept) | Nothing | None; the next draw asks again |

An owner who has turned on weather and sees nothing on a trip can find out why in the Itinerary's Module Configuration page: the
Weather section shows the chosen provider and a one-line check ("Weather is working" or "The service did not answer") from a test
call of one fixed position, run only when the owner presses it.

### Agents (core)

- The route above, called as the agent, answers the same days. A new MCP tool `read_weather` (`space`, `module` fixed to the
  Itinerary's id, `from?`, `to?`) wraps it, counted as one read, returned narrowed to the agent's spaces and permission like the
  other reads (`server/mcp.js`, `documentation/api/api-agents.md`). It shows nothing when the provider is `none`
  (`configured: false`) and does not ask the outside service for a day no one could see.
- No action writes weather, so no action is added and nothing waits for a page (decision 8 of plan-agent-edit-delete).
- The agent's call goes through the same limit and the same log as any read; the log holds the route and the agent, never the
  weather.

## Left to build, in order

Each step is a try build (one builder, one pass, its own checks; if it changes a module, that module's patch bump). Sizes are
S (an hour or less), M (a few hours), L (a day).

1. **The lookup and its cache** (server-development, core, M). `server/weather.js`: the weather words table and `cleanDays` over an adapter's parse
   (a stand-in is the test, no network), `askWeather(provider, lat, lon, from, to)` with the limits above,
   `WeatherCache` (memory, `DATA_DIR/weather.json`, ages, cap, no names, flush on shutdown like `GeocodeCache`), and
   `tools/check-weather.mjs` (parse, the table, the ages, the cap, nothing identifying in the saved file, a failing service,
   an oversized body, a redirect to a private address refused as `link-preview` refuses it). Add the check to the `check` script.
2. **The declaration and the route** (server-development, core, M; security read of what leaves). `cleanWeather` in
   `server/modules.js` (and the same in `server/index.js` where `cleanGeocoder` is reloaded for uploaded modules, `server/modules.js:1300`),
   `weatherSetup`, `GET /api/modules/:id/weather`, the `weather` limit, the picture-map refusal, the day-place rule
   (recommendation 3) and the answer's `state`s; the Itinerary's manifest settings and `weather` block (module lane edit of
   `modules/travel/module.json`, a patch bump; the route-table check). The check from step 1 grows a route case (a stand-in
   service, a trip with stops, a destination, none; the exact request the stand-in received is checked to hold only a rounded
   position and days).
3. **The drawn piece** (experience-design, core SDK, M). `host.ui.dayWeather` and its CSS in `public/sdk/system.css`, the icons
   (the builder checks each icon name against the icon set `check-icons` reads and adds the missing ones through the same route
   other icons take), its entry on the Design System pages with every state and a phone width, the popover through
   `host.menu.show`. Checks: `check-design-system-catalog`, `check-no-raw-colours`, `check-phone-targets`, `check-icons`,
   `check-narrow`.
4. **The Itinerary draws it** (experience-design, module lane, S to M). `travel.js` asks the route once per draw for the trip's
   visible days (not per day), puts the piece in each day's header by the states above, keeps nothing, and updates `CONTRACT.md`
   and `design/itinerary.html` for the new element. A patch bump. Checks: `npm run check:module -- travel`.
5. **The agent read** (server-development, core, S). `read_weather` in `server/mcp.js`, its entry in `documentation/api/api-agents.md`
   by content-manager at documentation time, and the check in `tools/check-mcp.mjs`.
6. **The story strip reuses it** (later, only when plan-space-story-strip step 9 is built; not part of this plan). That step takes
   its provider and cache from step 1, asks for one position, the trip's main place.

## Verify

- Step 1: `node tools/check-weather.mjs` against a stand-in service in the script; its saved file is read back and searched for
  any name, space or person (it must hold none).
- Step 2: `node tools/check-weather.mjs` (route cases), `node tools/check-modules.mjs` and `node tools/check-route-table.mjs`;
  `npm run check:module -- travel` for the manifest. By hand on `npm run dev` (command in `CLAUDE.md`): a stand-in service on
  another port, the stand-in registered, then the Itinerary's days answer; the provider `none` answers `configured: false` and the
  stand-in sees no request.
- Step 3: `check-design-system-catalog`, `check-no-raw-colours`, `check-phone-targets`, `check-narrow` and a look at the Design
  System page at a phone width and in a light theme.
- Step 4: `npm run check:module -- travel`, and a look in the browser at a trip with forecast, past, far-out, no-place days at a
  phone width.
- Step 5: `node tools/check-mcp.mjs`.
- **Not checkable here:** a real weather service (the container has no route to it, and its current terms and field names are the
  builder's to read on the day); how the day header reads on a real phone and with a screen reader; a real call. A built step says
  which of these it did not do.

## Risks

- **Privacy.** A trip's day places go to a third party from the server. Rounded to about 1 km, no names, no space, no person,
  and off until the admin chooses. The Itinerary's Module Configuration page says plainly who is asked.
- **Terms.** Some weather services are not free for commercial use. No paid service is bundled; the admin supplies the address and checks its terms.
- **Cost of a long trip.** Several places and 60 days is a few calls, cached for hours; a limit and the 8-place cap hold it.
- **Wrong place.** A stop's position that the person never meant for weather (a far-off sight) gives that day another town's
  weather. This is correct for where the day is, and the popover is the only place that says it is a forecast for somewhere.

## What is not decided

- Everything under "Recommendations" is Thomas's to change; none of it blocks building step 1.
- **Usual weather for far-out days** ("Usually 14 to 22"): left out. Left for a later plan if he wants it.
- **A per-person unit choice** and a language for the words: later.
- **Showing weather in the Calendar or on the strip's chip:** the strip is plan-space-story-strip step 9, which is the next consumer
  of this lookup. Not planned here.
- **Whether Manage says weather is on and who provides it:** lean yes, one line in the Itinerary's Module Configuration page (in
  this plan); a line in Manage is the strip plan's open question.
