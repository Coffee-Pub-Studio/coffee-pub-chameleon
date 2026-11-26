# Weather Users Plan: the story strip and the Calendar

**Audience:** Thomas decides the points in "For Thomas"; server-development builds the space-level answer and the agent tool, experience-design draws the strip's chip and the Calendar's days; content-manager documents them.

**Status:** Planned on the leans, 2026-11-26. Thomas asked to start issue #1143, "Ideas: Use the Weather part in the story strip and the Calendar" (2026-11-26). Under his standing rule the small choices below take the planner's lean and say so; the foundational ones are listed in "For Thomas" and are built on the lean unless he says otherwise. Nothing is built. Read against `main` at `e0722562` as code only; nothing was run.

## What it is today

- **The engine is core** ([plan-weather-part](plan-weather-part.md), [architecture-weather](../architecture/architecture-weather.md)): the lookup and cache (`server/weather.js`), the adapters (`server/weather-providers/`, MET Norway registered), the route `GET /api/modules/:id/weather` (`server/index.js`, from the "the weather on a day" section), `host.weather.days`, `host.ui.dayWeather`, and the agent tool `read_weather` (`server/mcp.js`), which requires a `module`.
- **The switch is the Weather module** (`modules/weather`, 0.1.0): on or off, the service, C or F. `weatherSetup` answers a service only when that module is on, a registered service is chosen and its terms are accepted for the host (`server/weather-terms.js`). One switch: no module can hide weather on its own days, and a space cannot turn it off (taken on the leans of plan-weather-part, which Thomas let stand).
- **A module says where its days are** (`cleanWeather`, `server/modules.js`): `stops` (stored rows with a day and a place pointer) and `main` (one stored value with a place as text and a first and last day). The Itinerary (`modules/travel/module.json`) declares `stops` on `plan:` rows (`date`, `time`, `order`, `placeRef`) and `main` on `trip:main` (`destination`, `start`, `end`). A day's place is its first stop whose pointer resolves for the asker to a Maps place with a position, else the main text found through Maps' place search (`weatherMainPlace`), else none.
- **Only a module can ask.** The route reads the asking module's own declaration; a host page has no route of its own.
- **The story strip** ([plan-space-story-strip](plan-space-story-strip.md)) is a host page (`public/space.js`), not a module. Steps 1 to 7 are built: the bar, the sentence and the facts (`host.facts`, `server/facts.js`, `GET /api/spaces/:id/facts`, guests refused). Steps 8 to 10 (choosing what shows, weather, usual temperatures) are not. The built facts carry no `place`; the drafted `GET /api/spaces/:id/weather?module=&fact=` does not exist. At 760 px and below the chips leave the bar and head the phase sheet.
- **The Calendar** (`modules/calendar`, 1.24.53, environment and space scope): an event is `{ title, allDay, start, end, desc, remind, repeat, tz?, skips? }` under `event:`; `start` is an instant for a timed event and a day for an all-day one. Events have no place. Views: month, week, day and agenda.
- **Maps** (`modules/maps`): places with a `point` (`refs.produces`, kind `place`), the place search (`geocoder`, Photon). No days.

## Decisions

Thomas's only.

1. **Never a paid service** (Thomas, 2026-11-25): never a paid service or one whose free tier forbids commercial use; a service's terms are read before its adapter is written and accepted once for the host by an administrator.
2. **Weather is a core engine with its options in the bundled Weather module** (Thomas, 2026-11-25, plan-weather-part).
3. **The story strip reuses the lookup through the adapters** (Thomas, 2026-11-25, plan-space-story-strip).
4. **Weather's destination on the strip is the place the Planner marks as the destination**; if several are reported, the owner picks one in Set up (Thomas, 2026-10-14, plan-space-story-strip decision 6).
5. **Start #1143** (Thomas, 2026-11-26).

## For Thomas

The foundational choices, built on the lean unless he says otherwise:

1. **The space's place is a module's declared `main`, not a `place` on a reported fact.** The story strip's drafted contract had the Planner report a fact with `{ name, lat, lon }`; that lets a page write any position into the store and goes stale when nobody opens the module. The lean reads the Itinerary's `main` (its destination text, found through Maps' place search) on the server, as the asker, which is how the Itinerary's own days already work. It answers the strip plan's open question 6 ("how the Planner marks the destination") and replaces its drafted weather route.
2. **Calendar events stay without a place.** Every day in a space's Calendar shows the space's place (the trip's destination). A place on an event is a later step, only if wanted (see "Later").
3. **Maps gets no weather of its own now.** It contributes places as the pointer target and the place search; a place card's "next few days here" waits for a request.

## Taken on the leans

Small choices, written down so they are not asked again:

- **Two modules declaring `main` in one space:** the first in the space's module order. No Set up pick until a second bundled module declares `main`; then decision 4's Set up pick is built. Today only the Itinerary does.
- **None declaring `main`, or its text empty or not found:** no place; nothing is drawn.
- **The strip's place is one place for the whole trip** (decision 4), even on a day whose stop is elsewhere; the Itinerary's day headers keep the per-day place.
- **The strip's day:** today while the space's main phase is under way; before it, the main phase's first day; after it, none. Without phases, the declaring module's `from` and `to` by the same rule; with no dates at all, today. A day outside the forecast window draws nothing.
- **The chip is a fact like the others,** after the module facts, counted in the three, and the first to give way.
- **Off, no terms accepted, a picture map or no place:** no chip, no row in the phase sheet, no hint. The Weather module's page and **Weather terms** say why.
- **Access follows the module the place comes from:** a person who may not read the Itinerary in that space gets no place, so the destination never leaks through the strip.
- **Calendar weather only in a space's Calendar,** never in the environment's, and in every view (month in the piece's short form).
- **`read_weather` takes `module` as optional;** without it, it answers the space's weather.
- **No per-module hiding** and no new setting on the Weather module: its switch covers the strip and the Calendar too.

## The contract

### Server: the space's place

- **`cleanWeather`** accepts a third key, `space: true`: "my days have no place of their own; use the space's place". At least one of `stops`, `main`, `space` is needed; `provider` and `units` are still refused. `space` alone is allowed.
- **The space's place** (a helper beside the route, as the asker): the modules enabled in that space that declare `weather.main` with a `place`, in the space's module order; the first the asker may read and whose main text is not empty; that text through `weatherMainPlace` (saved places, the in-memory memo, then the place search). Answers `{ module, name, lat, lon }` or null. Nothing new is stored.
- **The day** is a pure function (`weatherSpaceDay(bands, main, today)`), so `check-weather` runs it without a server.

### Server: `GET /api/spaces/:id/weather`

- **Who may read:** signed in, not a guest, in the space or with owner rights (the same gate as `GET /api/spaces/:id/facts`), and allowed to read the module the place comes from. Agents through the gate (a row in `server/agent-routes.js`, counted as a read). 401, 403 and 404 as the facts route answers them.
- **Query:** none for the strip (the server picks the day), or `from` and `to` (YYYY-MM-DD, at most 60 days) for an agent.
- **Answers:** `{ configured: false }` when `weatherSetup` is null (adds `pictureMap: true` with a picture map); `{ configured: true, credit, units, place: null, days: {} }` with no place; else `{ configured: true, credit, units, place: { module, name }, day, days: { "YYYY-MM-DD": { state, code, words, high, low, rain } } }`. `day` is the strip's day, absent when `from` and `to` are given or no day applies. `name` is the main text cut to 24 characters. 400 for bad days, 429 over the limit, 502 when the service failed and nothing is kept.
- **The limit:** an ask that reaches a service counts against the place module's 30 per person and minute, as now.
- **What leaves the server:** unchanged. To the weather service a position rounded to 2 decimals and the days; to the place search the main text only when not saved or remembered. Never who asked, the space or the environment.

### Server: the module route for `space: true`

`GET /api/modules/:id/weather` for a module declaring `space` gives every asked day the space's place (as the asker), after its own `stops` and `main` if it has them. Its days default to the space's main phase, else the place module's `from` and `to`. The Calendar's declaration is `"weather": { "space": true }`.

### The agent tool

`read_weather({ space, module?, from?, to? })`. With `module`, as now (the Calendar works once it declares). Without it, `/api/spaces/:id/weather`. Its description says so.

### Pages: the strip

- **Asked** when the space loads, on focus and with the facts' slow read, at most once in 30 minutes; an answer is reused for 5 minutes; `configured: false` is not asked again for 10 minutes; an error draws nothing and waits 60 seconds.
- **The chip** (`sdk-strip-chip sdk-strip-fact`): the condition's icon and "18° Lisbon" for today, "Fri 18° Lisbon" for a later day. Icons and words come from the SDK's own `WEATHER_LOOK` and `dayWeatherFacts` in `public/sdk/host.js`, exposed for the host page (`space.html` already loads it), never copied.
- **A press** opens the shared host menu: "Forecast for Friday 12 December", the words, the high and low, the credit, and an item that opens the place's module.
- **At 760 px and below and at 390:** no chip in the bar; one row in the phase sheet's facts, the icon and "18° Lisbon · Partly cloudy", pressing it opening the same menu.
- **Accessibility:** a button named by its words, not in the polite status, so it is not read aloud when it changes.

### Pages: the Calendar

- In a space-scope Calendar only, `host.weather.days({ from, to })` for the days on screen (at most 60), with the Itinerary's timing rules (one ask per draw, 0.6 s after a change, 10 minutes after `configured: false`).
- **Drawn with `host.ui.dayWeather`** on the week view's and day view's day headers and the agenda's day headings; in the month view in the piece's short form (icon and high). If the month cells cannot hold it at 390, the month at phone width draws none and the agenda carries it; experience-design confirms that live.
- Days with no place, out of range or with weather off draw nothing (the piece already does this).

## Core and modules

- **Core:** `server/modules.js` (`cleanWeather`'s `space`); `server/index.js` (the space's place, the day function, the space route, the `space` fallback in the module route); `server/agent-routes.js` and `server/mcp.js` (`read_weather`); `public/sdk/host.js` (expose the weather look for the host page); `public/space.js` and its styles (the chip and the sheet row). `weatherSetup` and `server/weather.js` do not change.
- **Modules:** the Calendar (its declaration and the day pieces, a patch bump each build); the Weather module (its description says it also serves the status strip and the Calendar, a patch bump, 0.1.1). The Itinerary does not change.

## Left to build, in order

Each is a try build that leaves `main` green.

1. **The space's place and route** (server-development, core, M). `cleanWeather`'s `space`; the helper and the day function; `GET /api/spaces/:id/weather`; the module route's `space` fallback; the agent route row and `read_weather`'s optional `module`; `check-weather` and `check-mcp` cases. Not blocked: the strip's facts are built.
2. **The strip's chip** (experience-design, core, S to M). Needs 1. The strip exists (steps 1 to 7), so nothing waits on it; until strip step 8 (choosing what shows) is built, the chip shows wherever there is a place, and step 8 later gives it an entry.
3. **The Weather module's words** (experience-design, module lane `weather`, S). Its description; 0.1.1. Any time after 1.
4. **The Calendar's days** (experience-design, module lane `calendar`, S to M). Needs 1. The declaration and the pieces; a patch bump.

### Later, only if asked

- **A place on a Calendar event,** by a Maps place pointer (`placeRef`, the Itinerary's pattern), not a typed name sent to the place search. Needs either the Calendar storing the event's local day beside `start` or `stops` learning to read an instant in the event's `tz`; core and module, M.
- **Weather on a Maps place's card,** asked by a pointer resolved on the server as the asker, never a free position from a page; core and module, M.
- **Usual temperatures before the forecast** (strip step 10).

## Verify

- **Step 1, checked by a tool:** `node tools/check-weather.mjs` against the stand-in (`WEATHER_TEST_STANDIN`): `space` alone accepted and with `provider` refused; off, no terms and a picture map answer `configured: false`; no declaring module answers `place: null`; two declaring modules take the first in order; a member who may not read the Itinerary gets `place: null`; a guest refused; the day function before, during and after the main phase, without phases and without dates; the `space` fallback on the module route; the limit counted on the place module; nothing sent but the position and the days. `node tools/check-mcp.mjs` (without `module`, the space route), `node tools/check-modules.mjs`, `node tools/check-route-table.mjs`.
- **Step 2, live in headless Chromium** with the stand-in at 1280, 760 and 390, light and dark: the chip, its menu and credit, the sheet row, nothing with weather off; `check-no-raw-colours`.
- **Step 3:** `npm run check:module -- weather`.
- **Step 4:** `npm run check:module -- calendar`; live at 1280 and 390 in each view, a space Calendar showing weather and the environment's showing none.
- **Not checkable here:** a real MET Norway or Photon ask (the terms need an administrator, and the container has no route out); a real phone. None of this needs a LiveKit call; the strip beside a real call is only Thomas's to see.

## What is not decided

- The three points in "For Thomas". None blocks step 1's shape except 1: if Thomas prefers a `place` on a reported fact, step 1 reads the fact instead of the declaration, and steps 2 to 4 are unchanged.
- Whether the story strip plan's drafted weather contract (its "On the server" weather line and open question 6) gets a line pointing here; left for content-manager when step 1 lands.
