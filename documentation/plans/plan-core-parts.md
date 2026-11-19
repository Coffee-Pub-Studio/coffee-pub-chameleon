# Core Parts Plan

**Audience:** Thomas decides. server-development builds the server steps and every check; experience-design builds the SDK and page steps (the canvas steps on the larger model, as layout and canvas work). The project manager runs each step as a try build.

**Status:** draft, 2026-11-19, by product-planner, from GitHub issue #940. Thomas: modules move in focused changes, the core does not, and he wants the core to be "a predictable, reusable framework with reusable components, almost like internal core modules". Nothing below is built. Thomas's three decisions are recorded; everything else marked "lean" is the planner's, taken so the plan is not blocked, and is his to change.

**What was read.** Issue #940; `CLAUDE.md`; [architecture-overview](../architecture/architecture-overview.md), [architecture-canvas](../architecture/architecture-canvas.md), [architecture-navigation](../architecture/architecture-navigation.md), [architecture-module-window](../architecture/architecture-module-window.md) (headings); [plan-module-agents](plan-module-agents.md) ("The fence", the build); [plan-colour-picker](plan-colour-picker.md); [plan-release](plan-release.md) (the freeze). In code: the section banners and route lines of `server/index.js`, its environment seam (`proxyFor`, lines 316 to 400) and `registeredPaths` (line 3699); `server/vault-share.js` (`mountVaultShares`); `tools/route-walk-preload.cjs`; `tools/check-module.mjs`; the section banners of `public/space.js`, `public/canvas.js`, `public/admin.js` and `public/module-host.js`; the page globals at the end of `public/sdk/host.js`; `public/host-menu.js`, `public/colour-field.js`, `public/nav-bar.js` (headers); the headers of `tools/check-host-menu.mjs`, `tools/check-no-colour-input.mjs` and `tools/check-nav.mjs`; a search of `public/*.js` and `public/*.html` for menus, dialogs, date and colour inputs and selects. Read as code only; nothing was run.

## What it is today

- **`server/index.js`, 13,732 lines.** One file holds the environment seam, the middleware chain, 329 `app.*` registrations (136 GET, 90 POST, 44 DELETE, 21 PUT, 17 PATCH, 21 `use`) and two routers (`hostRouter`, 55 registrations; `agentRoutes`). About 80 libraries are already split out (`server/tags.js`, `server/chat-history.js` and the like); what is not split is the routes and the helpers only they use. The biggest sections: a picture map (about 1,200 lines), the first password (720), owners' own templates (600), who may see a library file (580), environments (580), the guest door (580). Services are reached through `proxyFor(name)`, which resolves the current environment's `store`, `chatHistory`, `vault` and some 25 others.
- **One cut already has the shape.** `mountVaultShares(app, deps)` (`server/vault-share.js`, mounted at `index.js` line 4244) takes the app and a list of what it needs. It is the model for a server part.
- **The route table can already be read.** `tools/route-walk-preload.cjs` (used by `check-agent-tokens`) writes every route and middleware in order, with method and path, when the server starts listening.
- **Page scripts.** `public/space.js` 8,834 lines (about 30 banner sections: tiles, chat, the status strip, Set up, layout tabs, the always-on column, join and leave, reactions, Home's chat column...); `public/canvas.js` 3,266 lines, one `createCanvas()` closure with 13 sections; `public/admin.js` 2,970 lines, one section per Manage tab; `public/module-host.js` 2,702 lines. Several pieces are already factories that take what they need: `createSpaceSetup(deps)`, `createWhoHere`, `openLiveStream`, `createLayoutPicker`, `initDashboard`. They are the model for a page part.
- **`public/sdk/host.js`, 5,704 lines.** One file, served as is and put inline in a module's frame, so it cannot be split without a build step. It lends pieces to the host's pages through three globals, each making its own page host: `hostCurrency` (a new host on every call), `hostSwitch` and `hostColour`.
- **Drawing done twice.** The checks of `check-no-colour-input`, `check-host-menu` and a search find these hand-rolled in the host's pages:
  - **Menus: two implementations.** `public/host-menu.js` (484 lines, the page's menu, used by 14 page scripts) and `showMenu()` in the SDK (`host.js` line 2231). The flyout rules are copied word for word into `host.js` between markers, and `check-host-menu` exists to keep the copy equal.
  - **Dates:** native `<input type="date">` in `phase-sheet.js` (3), `space-setup.js` (3) and `chat-input.js` (2), while modules get `host.ui.datePicker`.
  - **Dialog shells:** `confirm.js`, `prompt.js`, `object-pick.js`, `template-choice.js` and `background-picker.js` each build the same head, title, close, body and foot by hand.
  - **Anchored popovers:** the bell list (`brand.js` line 972), Online (`space-people.js`), the call's settings popover (`space.js`), each placing itself.
  - **Already one piece:** the colour picker (`window.hostColour`, `colour-field.js`, fenced by `check-no-colour-input`, theme editor excepted), the nav bars (`nav-bar.js`, "one drawing path", `check-nav`), tooltips (`tooltip.js`, which the SDK loads), confirm and prompt for modules (the page draws them with `confirm.js` and `prompt.js`).
- **Checks.** `npm run check:module -- <id>` gives a module a lane and a fence. The core has none. On a pull request only `design-check.yml` runs.

## Decisions

Thomas, 2026-11-19 (issue #940, through the project manager).

1. **Fix the red checks first.** Done: PR #941, and `check-module-guards` in a follow-up. Reason: a core change needs a reliable "is this safe" signal before anything moves.
2. **The core may change as much as needed; nothing is released.** The aim is a stable platform, and that this stall never happens again.
3. **One plan covers the server, the pages and the SDK, built in order as small try builds, one layer at a time.** Thomas asked whether one plan or one per layer; the project manager recommended one, because the parts share a single contract and separate plans would drift.

## Leans taken (the planner's, not decisions)

Taken so the plan is not blocked; each is Thomas's to change.

- **The word is "part".** Never "module": module is a Name with its own meaning. What stays in `server/index.js` is "the base".
- **A part is a folder with a manifest**, as a module is: `server/parts/<id>/` and `public/parts/<id>/`, each with `part.json`, its code and `test/`. The alternative, one registry file per layer with the scripts left where they are, moves fewer files but gives no folder to fence.
- **A cut changes nothing else.** No fix, rename, new route or new field on the way. A bug found while cutting becomes an issue. This is what makes "the route table is identical" a real test.
- **Layer order: server, then the SDK rule, then the pages.** The server's check is the most mechanical, and page parts check their API calls against the server's route table. The SDK rule comes before the page cuts so each page part is cut already drawing with the shared pieces, not converted twice.
- **The freeze does not stop a cut.** A cut changes no route, API field, stored key or module SDK call ([plan-release](plan-release.md)). A step that would change one is not a cut and waits for Thomas.

## The contract

### A server part

A part owns a set of routes and the helpers only they use. It lives in `server/parts/<id>/`:

- `part.json`, the manifest. Known keys only; any other key fails the check.
  - `id`: letters, digits and hyphens.
  - `routes`: `[["GET", "/api/spaces/:id/tags"], ...]`, every route and `use` the part mounts, in order.
  - `services`: the environment services it reads or writes, by their `proxyFor` name (`store`, `tags`, `chatHistory`, `vault`...). This is the stored data it touches.
  - `files`: the files under `DATA_DIR` it writes, when it writes one directly (`attention.json`). No two parts may claim the same file.
  - `needs`: what it uses from the base (`base:requireOwner`, `base:currentEnvironment`, `base:word`) and from other parts (`part:chat.postSystem`).
  - `provides`: the names it gives other parts.
  - `checks`: the existing `tools/check-*.mjs` that cover it (`check-tags`, `check-tags-sdk`).
- `<id>.js` exports `mount(app, base)` and returns `{ provides }`. `base` is a Proxy that answers only the names in `needs` and the services in `services`; anything else throws when the server starts. A `part:` name is looked up when called, not when mounted, so mount order sets only the route order.
- It requires node, npm packages and the libraries in `server/*.js`. Never `index.js`, never another part's folder.
- `test/*.mjs`: its own checks, node scripts that exit 0 or 1, as a module's.
- The base mounts each part with `mountPart(id)` at the place its routes stood, and marks every router layer the part added with the part's id, so the route walk can say which part owns which route.

**What stays in the base** (`server/index.js`): reading the environment variables, the environment seam (`envContext`, `proxyFor`), the middleware chain (the body timer, same-origin writes, the JSON parser, the door, the agent gate, the agreement gate), sessions and the `require*` guards, plan caps, the LiveKit client, `mountPart` calls in order, the error handler and `listen`. When the last part is cut the base may split into `server/base/*.js` by concern; that is the last server step. The aim, not a gate: the base under 1,000 lines.

**Order to cut**, one part per try build, smallest and least shared first, the central ones last. Lines are today's banner sections; a part takes its routes wherever they are in the file.

| # | Part | Today | Existing checks |
| --- | --- | --- | --- |
| 1 | `tags` | line 6290, 100 lines | check-tags, check-tags-sdk |
| 2 | `attention` | 6185, 50 | check-attention, check-attention-sdk |
| 3 | `facts` | 6238, 50 | check-facts |
| 4 | `markers` | 9382, 280 | check-markers |
| 5 | `destinations` | 10196, 140 | check-destinations |
| 6 | `place-search` | 11270, 130 | check-geocode |
| 7 | `flight-lookup` | 11403, 80 | check-flight-lookup |
| 8 | `region-cut` | 11485, 120 | check-region-cut, check-pmtiles-header |
| 9 | `picture-map` | 11744, 1,200 | check-picture-map, check-picture-map-page |
| 10 | `calendars` | 8299 and 8616, 500 | check-external-calendars, check-feed |
| 11 | `module-live` | 12941, 240 | check-module-live, check-sdk-live |
| 12 | `layouts` | 6392, 370 | check-layouts, check-last-layout, check-restore-layout |
| 13 | `chat` | 6759 to 7827 without the live stream | check-chat-model, check-chat-links, check-chat-attach, check-chat-page |
| 14 | `live` | 7045, 420 | check-live, check-presence |
| 15 | `ai` | 7827 and 10341, 560 | check-ai, check-ai-tools, check-ai-callers, check-ai-admin-only |
| 16 | `library` | 10506 to 11270 and 11607 | check-vault, check-vault-share, check-vault-visibility, check-uploads |
| 17 | `objects` | 8802 and 9126, 580 | check-object-format, check-object-handoff, check-copy-rights |
| 18 | `bus` | 9659 and 10075, 540 | check-hooks |
| 19 | `module-runtime` | 5960, 8219, 10335 | check-module-load, check-module-guards |
| 20 | `agents` | 5604, 360 (the token gate stays in the base) | check-agent-tokens, check-agent-pages |
| 21 | `guest-door` and `access-requests` | 4711 and 5287, 800 | check-guest-door, check-request-access |
| 22 | `host-console` and `first-password` | 2152 and 2309, 870 | check-host-console, check-first-password |
| 23 | `sign-in` | 1672, 370 | check-auth |
| 24 | `templates` and `manage` | 906 and 5517 | check-templates, check-admin-load |
| 25 | `spaces` | 59 routes under `/api/spaces`, spread through the file | check-space-create, check-space-erase, check-canvas |
| 26 | `pages` | 3893 to 4248: pages, images, static files | check-start-page, check-guest-pages |
| 27 | the base into `server/base/` | what is left | all of the above's neighbours |

**How each cut is verified.** `check-route-table` (below) shows the table before and after is identical but for the new part's marks; `npm run check:part -- <id>` passes; the part's `checks` pass. Nothing else runs.

### A page part

A page part owns one piece of a page and the element ids it draws. It lives in `public/parts/<id>/` (served at `/parts/<id>/<id>.js`):

- `part.json`, the manifest. Known keys only.
  - `id`, and `pages`: the pages that load it (`space.html`).
  - `owns`: the element ids it draws or holds (`space-setup`, `status-strip`).
  - `borrows`: ids of the page it reads but does not own (`side-column`).
  - `needs`: the names it takes from the page in `deps`.
  - `uses`: the shared page libraries it imports (`/brand.js`, `/words.js`) and the SDK pieces it draws with (`hostPage.menu`, `hostPage.ui.datePicker`).
  - `calls`: the API routes it calls, as `["GET", "/api/spaces/:id/facts"]`. Each must be in the route table.
  - `checks`: the existing checks that cover it.
- `<id>.js` exports one factory, `create<Name>(deps)`, returning what the page uses and a `destroy()`. Its first statement takes everything from `deps` at once (`const { api, word, onTab } = deps;`); no other `deps.` read.
- It imports only what `uses` lists. Never the page script, never another part.
- `test/*.mjs`: its own checks.

What stays in the page script: reading the page's start state, building `deps`, creating the parts in order, and the wiring between them. The aim, not a gate: `space.js` under 1,500 lines, `admin.js` under 500.

**Order to cut**, along the architecture documents' seams, one part per try build:

1. Admin first (no call, no canvas): one part per Manage tab, `theme`, `modules`, `icons`, `templates` (the Template tab, its pages and the list), `roles`, `spaces`, `invites`, `reactions`. Covered by check-admin-load and each tab's check.
2. The pieces of `space.js` that are already factories move into the part shape: `who-here` (`space-people.js`), `setup` (`space-setup.js`), `live-stream` (`space-live.js`), `phase-sheet`, `layout-picker`, `dashboard`. These prove the shape for little risk.
3. `space.js` by its seams: `status-strip` (line 2373; architecture-canvas "The status strip"), `home` (8192; "Home"), `chat` (4706 to 5711 with `chat-input.js`; Clear and links included), `layout-tabs` (3290 to 4315; "Saved layouts" and the Layout menu's Layouts section), `work-area` (1576 to 2371; "The work area and the always-on column"), and last `call` (tiles, microphone, call events, join and leave, reactions, the floating bar; "The conference and the call").
4. `canvas.js` by its sections: `layout-shapes` and saved layouts (2490), the Layout menu (2845), stacks and columns (584 to 1283), floating and snap (223 to 584), the title bar drag (1283). The closure's shared state becomes one `state` object in `needs`.
5. `module-host.js` is not cut in this plan (see What is not decided).

**How each cut is verified.** `npm run check:part -- <id>`; the part's `checks`; for `space.js` and `canvas.js` also check-canvas and check-conformance (they need Chromium; they say SKIPPED without it). The call part cannot be verified without a real LiveKit call; its step says so.

### The SDK rule

Menus, pickers, dialogs, popovers, toolbars' "..." and the nav are drawn only by the shared pieces, in the host's own pages as in modules. A fix lands once. The colour picker is the model: one piece in the SDK, lent to the pages through a page global, a short page file where a page needs one (`colour-field.js`), and a check that fails on the hand-rolled form with a named exception (`check-no-colour-input`, the theme editor).

Order to convert, one try build each:

1. **One page host.** `host.js` makes one page host and lends it as `window.hostPage` (`hostPage.ui`, `hostPage.menu`). `hostColour`, `hostSwitch` and `hostCurrency` become parts of it and are removed. One picker or menu open at a time on a page.
2. **Menus, the SDK side.** The SDK menu learns what the page menu draws (`checked`, `toggle`, `radio`, `keepOpen`, `badge`, `tag`, `mark`, `more`, `heading`, `element`), page-only for now (open question 2). `check-host-menu` covers both.
3. **Menus, the page side.** `host-menu.js` becomes a short file over `hostPage.menu.show`, as `colour-field.js` is over the colour picker; the flyout copy and `menu-flyout.js` go; the `.host-menu` styles give way to the SDK's. A new check fails on `role="menu"` drawn outside the SDK.
4. **Dates.** `hostPage.ui.datePicker` in `phase-sheet.js`, `space-setup.js` and `chat-input.js`. A check fails on `type="date"` in `public/` outside the SDK, as `check-no-colour-input` does for colour.
5. **Dialog shells.** One shell, `public/dialog.js` (head, title, close, body, foot, Escape, focus back), used by `confirm.js`, `prompt.js`, `object-pick.js`, `template-choice.js` and `background-picker.js`. It stays a page file because the page draws these over everything, for modules too.
6. **Anchored popovers.** The SDK's placing (under, flipped above, kept on screen, right on a scrolled page, as the colour picker's work fixed) lent as `hostPage.ui.popover(anchor, element)`, used by the bell list, Online and the call's settings popover.

Not converted here: the chat's emoji picker ([plan-module-emoji](plan-module-emoji.md) step 3 already moves it onto the SDK); toolbars (a module's are drawn by the host already; the call's toolbar is the page's own, and its "..." uses the one menu after step 3); the nav (already one drawing path); native `<select>` (open question 3).

### The fence check

`npm run check:part -- <id>` (`tools/check-part.mjs`), the part's lane, as `check:module` is a module's. Small: it reads, it does not build.

- **Server part:** `part.json` has known keys only; the routes the walk marks with this part equal `routes`, in order; the server starts (so `base` refused nothing undeclared); no `require` of `index.js` or another part; no file in `files` claimed twice; its `test/*.mjs` and its `checks` pass.
- **Page part:** `part.json` has known keys only; imports only from `uses`; every element id looked up (`getElementById`, `$('...')`, `#id` in a selector) is in `owns` or `borrows`; every API path is in `calls` and in the route table; `deps` read once; the SDK rule's checks (no `role="menu"`, `type="date"`, `type="color"` or own dialog shell) on its folder; its `test/*.mjs` and `checks` pass.
- **`tools/check-route-table.mjs`:** starts the server with `route-walk-preload.cjs` and compares the walk with `tools/route-table.json` (method, path, order, kind, part). Any difference fails and is printed. A step that adds or removes a route updates the file in the same pull request, so the change is seen.

## Left to build, in order

Every step is one try build that leaves `main` green: its own checks pass, GitHub's checks pass, it merges. Steps within a layer run one after another; the next layer starts when the last step of the one before has merged.

**Server** (server-development)

1. `tools/check-route-table.mjs` and `tools/route-table.json`, and a pull request workflow that runs it. No product change. (The same workflow can later run [plan-module-agents](plan-module-agents.md) step 6.)
2. `mountPart`, the `base` Proxy and the layer marks in `server/index.js`; `tools/check-part.mjs` for server parts and `npm run check:part`; the first part, `tags`.
3. to 28. One part each, in the table's order: table row 2 (`attention`) is step 3, and row 27 (the base into `server/base/`) is step 28.

**SDK** (experience-design)

29. One page host (`window.hostPage`).
30. Menus, the SDK side.
31. Menus, the page side, and the no-page-menu check.
32. Dates, and the no-date-input check.
33. Dialog shells.
34. Anchored popovers.

**Pages** (experience-design; the canvas steps on the larger model)

35. `check-part.mjs` learns page parts; the first page part, Manage's `theme` tab.
36. The rest of Manage, one tab each.
37. The six existing factories into the part shape, one each.
38. `space.js` by its seams, one each, `call` last.
39. `canvas.js` by its sections, one each.

## Verify

- **Server steps:** checked by a tool. `check-route-table` shows the same routes in the same order; `check:part` and the part's listed checks pass. Run the listed checks only, not the whole suite.
- **SDK steps:** `check-host-menu`, `check-module-chrome`, `check-colour-picker` and the new no-hand-rolled checks, by a tool; menus and dates on Manage, Set up and the space page looked at in a browser at 1280 and 390 pixels (seen live, when a browser is to hand; else say so).
- **Page steps:** `check:part`, `check-admin-load`, `check-canvas`, `check-conformance` by a tool (the last two need Chromium).
- **Not checkable here:** the `call` part and anything the call drives (tiles, microphone, join and leave, reactions), since there is no LiveKit server locally. Those steps say "read as code only" for the call and wait for the real-call walk in TODO ("Verify in a real call").

## What is not decided

1. **A part lane in `CLAUDE.md`.** Today any change to `server/` or `public/` is core. Should a change confined to one part's folder, with `check:part` and `check-route-table` passing, count as a lane like a module's? Thomas's rule to write; it does not block the build.
2. **The page menu's fields for modules.** After step 30 the SDK menu can draw switches, radios, badges and headings. Lean: page-only. Offering them to modules through `host.menu.show` is an SDK change, and the freeze would stop it once it starts. Blocks nothing.
3. **Native `<select>`.** Used in `admin.js`, `space-setup.js`, `module-settings.js`, `template-fields.js`, `template-pages.js` and `ai-sees.js`. Lean: allowed (the global form rule) and not in this plan. Blocks nothing.
4. **`module-host.js` and the module frame.** Core for modules and 2,700 lines; not cut here. Lean: a later plan once pages are done.
5. **Splitting `public/sdk/host.js`.** It is put inline in a frame and the pages have no build step, so it stays one file. Lean: no split; its drawn pieces become the only ones instead.
6. **The aims** (`space.js` under 1,500 lines, `admin.js` under 500, the base under 1,000) are the planner's guess, not gates.
