# Flight Airline Links Plan

**Audience:** Thomas decides; experience-design builds the airline list, the matching and the Itinerary's links (module
lane, `modules/travel/`) and the one-line SDK change (core); quality-assurance checks it when Thomas calls a feedback or
production build; content-manager documents it.

**Status:** Planned on the leans, 2026-11-26. Steps 1 to 4 built (the SDK's `noreferrer`, the list, the menu items and the card's row, shown for all 57 entries under decision 3); step 6, a person confirming every entry, gates the release. From GitHub issue #1126 (Planner: Link a flight to its airline's check-in and
flight status). Thomas, 2026-11-25: when we know a flight and its airline, "we should offer a way to go to that airline for
check-in, flight status and the like." Thomas asked for it to be started on 2026-11-26. Under his standing rule (take the
lean on small choices, write it down, ask only where blocked), every choice below is the planner's lean unless it is listed
under Decisions; none of them is foundational, and nothing blocks the build.

## Why

Ideally check-in and live status would be inside the app. They cannot be under Thomas's rules: the flight lookup plan
([plan-flight-lookup](plan-flight-lookup.md), "The free sources") found no source with free terms that allow commercial
use that answers a flight's future schedule or live status, and reading an airline's own pages by software is forbidden by
their terms (Southwest's, quoted there). So **the airline's own page is the answer**: Chameleon knows the airline and the
flight number, and sends the person to the airline's check-in or flight-status page in a new tab. Nothing is fetched,
nothing is sent from our server, no key exists.

## What it is today

- **A flight** is a plan entry of kind `journey` with `mode: 'flight'`, holding `operator` (the airline as typed, form field
  `f-operator`, label "Airline"), `number` (cleaned to "WN 2483" by `numberToSave` and `flightNumberOf` in
  `modules/travel/src/travel-lib-object.js`), `date`, `time`, `arrives`, the airport codes and the rest. A return leg takes
  the outbound's `operator` and has its own `number` (`travel.js`, the round trip's save).
- **The flight card** is `tpl-card-flight` in `modules/travel/src/travel.html`, filled by `buildCard` in `travel.js`; its
  title is the airline and number. Its menu (the card's "..." button) is `openMenu` in `travel.js`, drawn by `host.menu.show`.
- **Links out.** `host.menu.show` already takes `href` items: a real `<a>`, `target` `_blank` unless given, `rel="noopener"`
  (`public/sdk/host.js`, `addEntry`). It does not set `noreferrer`. The Planner (a bundled module) runs in the page by default
  (`runModeOf` in `server/modules.js`), where no page-wide `Referrer-Policy` is set, so the browser's default
  (`strict-origin-when-cross-origin`) would send the site's origin: on a hosted install the environment's own address.
  The space's id is in the path, which that default does not send.
- **The airport list** (`server/airports.json`, built from `mwgg/Airports`) and the saved schedule are the server's. There is
  no airline list anywhere; the flight lookup plan only mentions the VRS `airlines.csv` (CC0) as a possible name source.
- **The agent's read.** `read_data` answers the stored plan entries, so an agent already reads the airline and number.
  `object_format` is the schema of objects an agent sends in (`DETAILS.flight` in `server/object-format.js`), not a view of
  stored data.

## Decisions

Thomas's, fixed before this plan:

1. **Never a paid service, and never one whose free tier forbids commercial use** (Thomas, 2026-11-25; flight lookup
   decision 1). So no in-app live status or check-in; the airline's page is the answer, recorded here so it is not asked
   again.
2. **Nothing is sent from our server about who or which space**, and **a key never reaches a browser**. This plan uses no
   key and no server call at all.
3. **Show all, with the release gate** (Thomas, 2026-11-26): the airline links show for every entry now, including the ones not
   yet confirmed (`checked: null`), and no release ships until a person has opened both addresses of every entry and set
   `checked`. The gate is a real check: `node modules/travel/test/check-travel-airlines.mjs --release` (or `RELEASE_GATE=1`) fails
   while any entry is unconfirmed, naming how many and which; the default run only warns, so the module's lane stays green. The
   project manager runs the release mode at release prep.

## Leans taken

The planner's, taken under Thomas's rule; he may overrule any.

1. **The list lives in the Planner, not on the server.** A file of the travel module, `modules/travel/src/travel-lib-airlines.js`
   (the build puts every `travel-lib*.js` together, so the page and the server's action runner both have it). No route, no
   server file, so it is module lane and nothing is asked of the server when a flight is drawn. The other way, a host-wide
   `server/airlines.json` with a route like the airport list, costs a core build and a request per page for about 50 rows,
   and buys only admin editing. **No admin editing for now**: a corrected address ships as a Planner patch. If editing is
   wanted later, a host file in `DATA_DIR` that overrides entries by code is the way (its own plan).
2. **Each entry:** `code` (IATA, two letters or digits, upper case), `icao` (optional, three letters), `name` (as the airline
   writes it), `aliases` (optional, other names people type: "Southwest", "BA", "Lufthansa German Airlines"), `checkIn`
   (an https address), `status` (an https address), and `checked` (`YYYY-MM`, the month a person last opened both addresses,
   or `null`). At least one of `checkIn` and `status`. An entry may carry `statusLink`, a template using only `{number}` (the
   digits) and `{date}` (`YYYY-MM-DD`), when a person has seen that the airline's page takes them (lean 6).
3. **The starter list: about 50 major airlines**, chosen by size and by where Chameleon's travel users fly (the large US,
   European, Asian, Middle Eastern and Latin American carriers and the big low-cost ones). **Written by hand from each
   airline's own website**, never copied from a third-party dataset: the addresses are facts about public pages, but a
   compiled list (OpenFlights' `airlines.dat` is ODbL, others have their own terms) can carry a database right or share-alike
   duty. Codes and names may be checked against the VRS `airlines.csv`, which is CC0. Each address is the airline's
   international or English start page for check-in or flight status (most redirect by country). **Every entry must be opened
   and confirmed by a person before release**; a builder in a cloud container cannot do it reliably (airline sites refuse
   automated requests), so the builder writes `checked: null` and the check below lists what is unconfirmed.
4. **An airline not in the list: no links.** The flight looks as it does today. A search link was weighed and left out: it
   would send the airline's name to a search engine we pick, a third party Thomas has not chosen, and the result is often an
   agency's page rather than the airline's.
5. **Matching, in order:** the flight number's prefix against `code` (or `icao` for a three-letter prefix), then the
   `operator` text, lower-cased with punctuation dropped, against `name` and `aliases`. The prefix wins when both match
   different airlines: it is the airline that sold the ticket, whose site handles its codeshares. No match, no links.
6. **What goes in the link: by default nothing.** The plain check-in or flight-status page. Only where an entry has
   `statusLink` does the flight-status link carry the flight number's digits and the departure date. **Never** a passenger's
   name, a booking reference, a seat, or anything from the space. Check-in links never carry anything: an airline's check-in
   needs the name and booking code, which are not ours to send. The starter list ships `statusLink` only for airlines a person
   has seen it work for.
7. **Where it shows:**
   - **Always on the flight's menu** (`openMenu`, both legs): a separator, then **Check in** and **Flight status**, `href`
     items, each with the tip "Opens <airline>'s site in a new tab". An entry without one of the addresses shows only the
     other.
   - **On the flight card from 48 hours before departure until the day it lands ends:** a small row under the stub with
     **Check in** (until departure) and **Flight status** (the whole window), as `<a class="btn btn-small">` links with the
     arrow-up-right-from-square icon. The departure is compared as local wall time with the device's clock; the airport's
     zone is not known on the page, so the window can be off by the zone difference, which a 48-hour window absorbs.
   - **The day:** the Days view draws the same cards, so nothing more. The Trips widget (`travel-widget.js`) is unchanged: it
     shows and opens, never more.
   - **Phone, 390 pixels:** the card's row wraps under the stub; the menu is the SDK's and already fits.
8. **The agent's read: no change.** The links are worked out from the airline and number, which `read_data` already gives;
   they are not stored and not added to `object_format`, which describes what an agent sends, and a link is not a fact of the
   flight. An agent that wants to point a person to check-in can name the airline.
9. **Opening safely:** a new tab, `rel="noopener noreferrer"` and `referrerpolicy="no-referrer"` on the card's links. The
   SDK's menu `href` items gain `noreferrer` for every menu (one line in `addEntry`, core): no menu link out has a reason to
   send where it came from, and a fix to a drawn piece goes into the SDK once. So the airline learns neither the space's
   address nor the environment's.
10. **Words and rules.** "Check in", "Flight status", "Opens Southwest Airlines' site in a new tab." Names as in `CLAUDE.md`
    (a flight is an object; never "item" in words). Colours only from the theme tokens and the existing button classes; no
    airline colours or logos (a logo is a trademark). The travel module gets a patch bump in each step that changes it.

## The contract

### The list and its functions (`travel-lib-airlines.js`)

- `AIRLINES`: the frozen array of entries (lean 2).
- `airlineOf(number, operator)`: the matched entry or `null` (lean 5). Uses `flightNumberOf` for the prefix.
- `airlineLinks(item, now)`: for a flight entry, `null` or `{ name, checkIn, status, soon: { checkIn, status } }`, the
  addresses already built (lean 6, `{number}` from the leg's own number) and `soon` saying which belong on the card at `now`
  (lean 7). Pure, so the module test can run it.

### The page (`travel.js`, `travel.html`, `travel-lib-cards.css`)

- `openMenu`: the two `href` items for a flight with a match, after **Move to unscheduled** and before **Delete**.
- `buildCard`: the card's link row when `soon` has either; hidden otherwise. Redrawn on the page's existing redraws; no
  timer of its own (a card opened before the window shows the row on the next redraw).

### The SDK (`public/sdk/host.js`)

- `addEntry`: `b.rel = 'noopener noreferrer'` for an `href` item. `api-module-sdk.md` says so (content-manager).

## Left to build, in order

Each a try build unless Thomas names another kind.

1. **The menu's `noreferrer`** (experience-design; core; tiny). `public/sdk/host.js`. Checked by `tools/check-host-menu.mjs`
   with one added case.
2. **The list, matching and links** (experience-design; module lane; small to medium, most of it writing and checking the
   entries). `travel-lib-airlines.js`, `modules/travel/test/check-travel-airlines.mjs`, Planner patch bump. Nothing draws it
   yet.
3. **The menu items** (experience-design; module lane; small). `openMenu`, Planner patch bump.
4. **The card's row within 48 hours** (experience-design; module lane; small). `buildCard`, the template and its styles,
   Planner patch bump.
5. **Documentation** (content-manager, when a build kind calls for it): the Planner's user guide (where the links are, that
   nothing is sent, that an airline not listed shows none) and `api-module-sdk.md` (the menu's `rel`).
6. **A person confirms every entry** (Thomas or someone he names) before release, setting `checked`.

## Verify

- **Step 1, checked by a tool:** `check-host-menu` asserts an `href` item has `rel` containing both `noopener` and
  `noreferrer` and `target` `_blank`.
- **Step 2, checked by a tool** (`npm run check:module -- travel`): every entry has a valid `code`, a `name`, at least one
  address, every address parses as `https:` with a host and no credentials; no duplicate `code`, `icao`, name or alias
  across entries; a `statusLink` uses only `{number}` and `{date}`; matching by prefix (`WN 2483`), by three-letter prefix,
  by name and alias in any case ("southwest", "British Airways"), the prefix winning over a different name, and no match
  for an unknown airline; a built link holds no name, reference or seat even when the entry is given them; the window at 49,
  47 and 0 hours and after landing. It prints the count of entries with `checked: null` (a warning, not a failure, until
  release prep).
- **Steps 3 and 4, verified live in headless Chromium** at 1280 and 390 pixels on a local server: a listed flight's menu
  has both links and they carry `target="_blank"` and `rel="noopener noreferrer"`; an unlisted airline shows none; a train
  shows none; the card's row appears for a flight tomorrow and not for one next week; at 390 the row wraps and nothing
  overflows. Opening an airline's page cannot be checked from the container (outside sites); that each address really
  lands on check-in or status is step 6, by a person.
- No LiveKit call is involved.

## What is not decided

Nothing blocks the build. Open for Thomas, each with the lean in force:

1. **Admin editing of the list** (lean 1: no; a Planner patch corrects it).
2. **Which airlines** are in the first 50 (lean 3: the large carriers by traffic). Thomas may name ones his users fly.
3. **A search link for an unlisted airline** (lean 4: none).
4. **A bundled Planner switched to run sandboxed** by an admin: its frame has no `allow-popups`, so a menu link out does not
   open there, for this feature and every other menu `href` today. Not this plan's to fix; worth its own issue if an admin
   ever runs the Planner sandboxed.
5. **In-app live status:** not possible under decision 1. If Thomas ever allows a paid source, it is the flight lookup plan's
   `findFlights`, not this.
