# Weather Part Plan

**Audience:** Thomas decides which shape weather takes. server-development and experience-design build the option he picks; content-manager documents it.

**Status:** Decided, 2026-11-25: Thomas chose option B, then refined it: the engine stays core and the options (on or off, service, C or F, icon style) live in a bundled Weather module, because people look for options on a module (Thomas, 2026-11-25). Open questions below take the planner's leans unless he says otherwise. Not yet built. A decision paper; nothing is built from it. Thomas, on the weather work: "Weather as its own part: we need to discuss this and why a module is not the only right answer." It answers the question [plan-itinerary-weather](plan-itinerary-weather.md) left open ("whether weather should be its own route part rather than code in `server/index.js`"). Read against `main` at `8ad63a47` as code only; nothing was run.

**Progress (2026-11-25).** Step 1 is built as a try build: the settings and the switch. The options live in a bundled, service-only **Weather** module (`modules/weather`, `hooks.weather`), the engine stays core. Taken from the paper's leans, since Thomas named none: (2) the terms are accepted by a person in authority once for the host, in `DATA_DIR/weather-terms.json` (module settings cannot be the host's), by the signed-in `admin` on a single install and the host console's admin on a hosted one, with an explicit flag, never an agent; an acceptance counts only for the terms' address it was given for. (3) One switch: no module can hide weather on its own days while it is on. (4) The Weather module's environment settings are the only switch; a space cannot turn it off. A service is used only when the module is installed and on, the service chosen and accepted; anything less answers `configured: false` and nothing leaves the server. The module's on/off is the module's own switch (no second setting); temperatures C or F; no icon-style choice, because one style exists (a note says so, and a choice is added when a second does). The Itinerary dropped `weatherProvider` and `weatherUnits` (0.16.26) and declares only where its days are. `read_weather` takes a `module` and names none. Step 2 is built as a try build (2026-11-25): a **Weather terms** section, shared by both pages in `public/weather-terms.js` (the same way as the flight schedule), with each service's name, credit, a link to its terms, "Accepted by X on <date>" or "Not accepted", and for the administrator a checkbox ("I have read the terms and accept them for this server.") with Accept, and Withdraw after asking. On a single install it sits under the modules list in Manage; owners see the status and that the administrator accepts, no buttons. On the host console it is in Server. Seen live at 1280 and 390, light and dark, on the stand-in. The host's three routes were registered after the host router's 404 catch-all and answered 404; they now come before it, and `check-weather` covers them on a hosted server. Not built: moving the route into a part (step 3).

## What weather is today

Most of it is already shared code that names no module:

- **The lookup and the cache**, `server/weather.js`: the eight weather words, `askWeather` (one position rounded to 2 decimals and a run of days, the redirect guard, the time and size limits), `WeatherCache` (one `DATA_DIR/weather.json` for the whole host, keyed by position and day, never who asked) and `weatherDays`. It knows positions and days, nothing else.
- **The adapters**, `server/weather-providers/`: the adapter contract and the rule in `index.js`; MET Norway (`met-norway.js`, registered, try build); a test stand-in.
- **The declaration**, `cleanWeather` in `server/modules.js` (line 845): a module says where its days' places are in its own stored data (`stops`, `main`), and a `choice` setting marked `"adapters": "weather"` is filled from the registered adapters.
- **The route**, `GET /api/modules/:id/weather` (`server/index.js`, section from line 13382, about 200 lines): generic, it reads the asking module's data through its declaration.
- **The SDK**: `host.weather.days` (`public/sdk/host.js` line 4669, through `'weather.days'` in `public/module-host.js` line 2256) and the drawn piece `host.ui.dayWeather` (`host.js` line 1670), on the Design System pages.
- **The check**, `tools/check-weather.mjs`.

What is the Itinerary's own, or tied to it:

- **The switch and the settings.** `weatherProvider` and `weatherUnits` are settings in `modules/travel/module.json`, and `weatherSetup` (`server/index.js` line 13398) reads the service from the asking module's own settings. So the service is chosen, and MET Norway's terms are in effect accepted, on the Itinerary's Module Configuration page, by each environment's owner.
- **Where a day is**: the `stops` and `main` keys in the Itinerary's `weather` block, and `modules/travel/src/travel-lib-weather.js` (when to ask, which days).
- **The agent tool.** `read_weather` in `server/mcp.js` fixes `WEATHER_MODULE = 'travel'` (line 65). That is the core naming a module, which [architecture-modules](../architecture/architecture-modules.md) ("Objects", the principle) says should not happen.

So the work is mostly shared already. What sits in the wrong place is the switch, the settings and the agent tool.

## Who else could use it

- **The story strip** (`public/space.js`, a host page, not a module). [plan-space-story-strip](plan-space-story-strip.md) step 9 wants a chip, "18° Lisbon", and it is decided that it reuses this lookup. Today it would have to ask the Itinerary's route and read the Itinerary's settings, so a space whose template has no Itinerary, or where it is off, gets no chip.
- **The Calendar** (`modules/calendar`). A day in the month or agenda could carry the same `host.ui.dayWeather`. It gets the Itinerary's stops as dated copies, but its own events have no place. To use weather today it would declare its own `weather` block and its own **Weather** setting: a second choice of service, and a second acceptance of the terms, in the same environment.
- **Maps** (`modules/maps`). A place's summary has a `point`; its card could show the next few days there. Maps has no days, so the declaration (stops by day) does not fit it: it needs "the weather at this place", not "the weather on my days".
- **Agents.** `read_weather` can only ask the Itinerary.
- **A later module**, such as a dashboard widget for the next trip or a day of outdoor work in Schedule: the same as the Calendar.

## Decisions

Only Thomas's.

1. **The Itinerary shows the weather on each day** (Thomas, 2026-11-23; plan-itinerary-weather).
2. **No paid services** (Thomas, 2026-11-25): never a paid service, never one whose free tier forbids commercial use, and a service's terms are read before its adapter is written. This holds for every option below. For MET Norway it means: CC BY 4.0 credit shown, an identifying User-Agent, its caching rules, and terms a person in authority accepts; software cannot accept them.
3. **The story strip reuses the lookup** through the registered adapters (Thomas, 2026-11-25; plan-space-story-strip).

## The options

### A. Leave it as core code used by the Itinerary

- **Another module's author:** declares a `weather` block and its own provider and units settings, keeps its days and places in the shape `stops` and `main` read, calls `host.weather.days` and draws with `host.ui.dayWeather`. A module without days (Maps) needs a new kind of declaration first. The strip cannot use it without reading the Itinerary's settings.
- **The admin sees:** a **Weather** choice on the Module Configuration page of each module that uses weather (None, MET Norway), the terms link beside it, the credit in the popover. Two modules mean two choices that can disagree. On a host with several environments each owner chooses, while the requests leave the host's server under the host's User-Agent.
- **Off:** per module, by choosing None. There is no single off.
- **Changes:** none now. The open question closes as "no"; `read_weather` stays fixed to the Itinerary.
- **Cost:** nothing now; each new user pays later (its own settings, its own declaration).
- **Risks:** settings that drift apart; terms accepted by the wrong person; the core keeps naming a module; the route stays in `server/index.js`, outside [plan-core-parts](plan-core-parts.md).

### B. A named core part with a contract

One part, `weather`, in the shape [plan-core-parts](plan-core-parts.md) gives a server part: `server/parts/weather/` with its `part.json` (its routes, `files: ["weather.json"]`, `checks: ["check-weather"]`). Core-parts step 2 (`mountPart`) is not built, so until it is, the code is shaped as a part the way [plan-mcp-oauth](plan-mcp-oauth.md) shapes `server/oauth.js`, and moves in when the machinery lands. Place search and the flight lookup are already rows 6 and 7 of that plan; weather sits beside them.

The part owns the adapters, the cache, the routes, the switch and its settings, and the agent tool. The SDK pieces stay in `public/sdk/host.js` (core-parts decision 7: that file is not split).

- **Settings, two levels.** The admin, once for the host: which registered services may be used, each with its terms link and an acceptance (who and when). On a hosted install this is on the host console; on a single-environment install, in Manage. The owner, per environment: weather on or off, which accepted service, Celsius or Fahrenheit, in a **Weather** section of Manage.
- **Another module's author:** declares only where its days are (the `weather` block keeps `stops` and `main`; `provider` and `units` go), calls `host.weather.days` and draws with `host.ui.dayWeather`. No setting of its own. Maps would later ask by a pointer to a place (resolved on the server as the asker, so a page never sends a free position).
- **The strip:** a space-level answer for the space's main place, so a host page does not go through a module.
- **The agent tool:** `read_weather` takes a space and, optionally, a module or a place; nothing fixed to the Itinerary.
- **The admin sees:** one Weather page; the terms accepted once by the person running the server; the credit in every popover and on that page.
- **Off:** the owner's switch off means every module's route answers `configured: false`, the strip draws no chip, `read_weather` answers `configured: false`, nothing leaves the server and nothing is cached. No service accepted on the host means off everywhere. Modules keep working, without weather.
- **Changes in code:** the route and its helpers leave `server/index.js`; `weatherSetup` reads the part's settings, not a module's; `cleanWeather` loses `provider` and `units`; the Itinerary loses two settings (a patch bump; the saved choice goes with them, which CLAUDE.md allows before release); `server/mcp.js` stops naming `travel`; a new settings page; later, a space-level answer and the place pointer ask.
- **Changes in docs:** [architecture-weather](../architecture/architecture-weather.md) rewritten as the part; [Modules API](../api/api-modules.md) "Weather"; the Module SDK and Agents API entries; the Itinerary's user guide; a Manage user guide section.
- **Cost:** about four try builds, each small to medium. The settings page is the largest new piece.
- **Risks:** a core change, so `main` must stay green after each; a new Manage page; a part with settings of its own is new to the core-parts plan, which needs a line on where a part's settings live; built before `mountPart`, it moves twice.

### C. A bundled module

There are two forms, and only the second can be built today.

**C1. A real module that does the work.** Not workable today, for four reasons:

- **A module runs no code on the server.** Nothing in a zip is run by the server ([architecture-modules](../architecture/architecture-modules.md), "Model"). A module's frame has a content security policy of `default-src 'none'`, so its page cannot reach MET Norway either, and a browser cannot set the User-Agent MET asks for or share one cache between people.
- **The one place module code runs on the server has no network.** The action runner runs bundled modules' agent actions with no network, by design ([plan-agent-server-actions](plan-agent-server-actions.md)).
- **A module cannot offer a service to other modules.** Modules share pointers to objects (with summaries the server builds from stored values), events, and actions. An action is queued until the provider's page or the locked-down runner carries it out, and the asker polls its status; it is not a read another module can make each time it draws a day.
- **A module cannot draw in another module's frame.** A day header is the Itinerary's own. Only the SDK's shared pieces draw in every module, and those are core.

For C1 to work the core would need: server-run module code with outbound network behind a per-module allow-list; a request-and-answer call from one module to another, with its own approval; and either drawing across frames or the drawn piece staying in the core SDK (which it does anyway). That is a new module platform, larger than weather, and it moves the security boundary the module model rests on.

**C2. A service-only module over core code, as the AI Assistant is.** The `assistant` module has no window and an `ai` hook; its setup is its Manage tab; the core names it (`server/ai.js` line 37, `ai.moduleOn` in `server/environment.js` line 237), and `hooks.ai: true` requires it. For weather: a bundled `weather` module with no surface whose manifest holds the service and units settings; the code stays core, as in B; a module that uses weather declares `hooks.weather: "optional"`.

- **Another module's author:** declares the hook and its days; the same SDK calls as B.
- **The admin sees:** **Manage**, **Modules**, **Weather**; its Module Configuration page is the settings page with no new page to build; on and off is the module's own switch and the template's offering.
- **Off:** the module off, or not offered in a space's template, means `configured: false` everywhere it is off.
- **Changes:** as B, without the new settings page; plus a module folder, a new hook, and the core naming `weather`.
- **Cost:** about three try builds; the cheapest way to one switch.
- **Risks:** the core names a module a second time; a "module" whose code is all core, that cannot be replaced or meaningfully uninstalled; module settings are the environment owner's, so the host-level acceptance of the terms has no home and stays with each owner.

### Side by side

| | A | B | C2 |
|---|---|---|---|
| One switch for the environment | No | Yes | Yes |
| Terms accepted once for the host | No | Yes | No |
| The strip, Calendar and Maps can use it without settings of their own | No | Yes | Yes |
| The core names a module | Yes (`read_weather`) | No | Yes (`weather`) |
| New settings page to build | No | Yes | No |
| Try builds | 0 | about 4 | about 3 |

## The planner's lean

A suggestion, not a decision: **B**. Weather is already shared code; only the switch, the settings and the agent tool are in the wrong place. Accepting a service's terms belongs to whoever runs the server, which a module's settings cannot express. The strip is a host page and needs a space's answer, not a module's. And it follows the rule that new core work is built as parts with a contract. C2 is the cheaper alternative if Thomas wants weather switched on where the AI is; its price is another module that is really core. C1 is not workable without a new module platform.

## Left to build, in order (if B is chosen)

Each is a try build that leaves `main` green.

1. **The settings and the switch** (server-development, core, M). Weather settings kept by the core (host: accepted services, who and when; environment: on, service, units) and their routes for the admin and the owner; `weatherSetup` reads them; `cleanWeather` drops `provider` and `units`; the Itinerary drops `weatherProvider` and `weatherUnits` (module lane, patch bump). `check-weather` grows the cases.
2. **The settings page** (experience-design, core, M). The Weather section in Manage with the terms link and acceptance and the credit; the host console's section on a hosted install.
3. **The part** (server-development, core, S to M). The route and its helpers out of `server/index.js` into the part's shape; `read_weather` no longer fixed to the Itinerary.
4. **Later, when asked for:** the space-level answer when story strip step 9 is built; the place pointer ask when a Maps step needs it.

## Verify

- Step 1: `node tools/check-weather.mjs`, `node tools/check-modules.mjs`, `npm run check:module -- travel`, against the test stand-in.
- Step 2: the page at a desktop width, a phone width and a light theme, in a browser; `check-no-raw-colours`.
- Step 3: `node tools/check-route-table.mjs` (the same routes, marked with the part), `node tools/check-mcp.mjs`, `check-weather`.
- **Not checkable here:** a real MET Norway request (a person must accept the terms first, and the container has no route out); a real phone.

## What is not decided

1. **A, B or C2.** Blocks everything.
2. **Who accepts a service's terms:** the admin once for the host (lean), or each owner as today. Settled by 1 if A or C2.
3. **Can a single module still hide weather** on its own days while weather is on? Lean: no, one switch.
4. **Per space:** is the environment's switch enough, or may a space turn weather off? Lean: the environment's switch only.
5. **Place search and the flight lookup** follow the same module-declares shape today (`geocoder` on Maps, `lookups` on the Itinerary). Whatever is decided here may later apply to them; not part of this paper.
