# Templates Redesign Plan

**Audience:** Thomas has decided everything under "Decisions"; no question is open. server-development builds the
template format, the resolution per space, the module manifest fields, the shared outline pieces of the SDK and the
checks; experience-design builds the Manage pages, Set up, the host console pages and the two
new planner modules; each existing module's change is its own module-lane build with a version bump. Steps marked
**core** touch `server/`, `public/sdk/`, `public/module-host.js`, `public/module-frame.js`, `tools/`, the stored data
format or a manifest's permissions, uploads or refs, and are held for an independent read. quality-assurance reads and
walks the result; content-manager documents it after.

**Status:** Approved for build as a production build (Thomas, 2026-11-15, decision 48); decisions complete, none open.
Amended 2026-11-15 (decision 50): the pages come first. Step 11 is split into 11a and 11b, and the planners wait for 11a.
Revised 2026-11-15 by product-planner. Nothing is built yet. The first draft (#831) suggested
modes inside one Planner; Thomas decided the other way the same day: **dedicated planners, one module per genuinely
different shape** (decision 28). His test, in his words as recorded: are the variations between the possible planners
bigger than their shared core? He judged yes. He also answered three of the first draft's questions (the `aside` word and
the `enter` verb, the Default template's modules, and what may follow the release); they are decisions 32 to 34. He then
answered the thirteen questions that were left (decisions 35 to 47) and approved the build (decision 48). Timing, in
Thomas's words: "BEFORE THE FREEZE". This moves the freeze; see "What this does to the release".

Thomas, 2026-11-15, the outcome he wants: a template changes what a module is, how it behaves and what it is called, so
a space feels like a trip, a project, a course or a mentoring relationship. His four tests: (1) today's travel behaviour
is unchanged; (2) a new kind of template is mostly configuration, not code; (3) a third-party module can take part
without widening its own access; (4) people in a space always see the same thing.

The templates assumed: **Travel**, **Games**, **Project**, **Learning** and **Mentoring** (#351), plus any a template
author adds.

## Why

A template today is mostly words and a starting kit. It renames levels and modules, picks phases, and turns modules on
once when an environment is made. It does not change how any module works: a Project space would get a day-by-day trip
itinerary called "Project plan", a Learning space a Budget that counts money, and every space in an environment runs
every module the environment has. The same machinery also lets a template rename words that should never move
("environment", "owner"), so two environments read differently in places that matter for support and for the guides.

Thomas's model replaces this with three tiers:

| Tier | What it holds | Who sets it |
|---|---|---|
| **Environment** | The catalog: the modules available, the fixed core reactions and icons, the default theme, the environment's default template | The owner, in Manage |
| **Template** | A lens over the catalog: the words people may rename, more reactions and icons, which modules a space has and what they are called, how each module behaves, the phases, the Default Workspace, what a new space starts with, starter spaces and starter content | Shipped (fixed), the host, or the owner's own copy |
| **Space** | Its template, its dates and its own data | The owner or the admin, choosing among templates |

The rest of this plan is what that model means for the code, part by part.

## What it is today

All facts below were read in the code on `main` at `be5b137d` (2026-11-15), and the planner facts again at `09c174db`.
None of it was run. The GitHub issues (#307, #291, #214, #774, #202, #351, #325, #730) could not be opened from this
session; their titles come from `.github/roadmap-board.csv` and their substance from Thomas's notes of 2026-11-15.

**Templates and their records**

- Two bundled templates, `templates/travel.json` (version 10) and `templates/games.json` (version 3), recorded in
  `tools/template-versions.json`. Travel names the Vault "Documents" (`moduleNames.vault`), though a Documents module
  exists. Games renames `environment` ("group"), `owner` ("game master"), `aside` ("whisper"), `space` and `member`.
- A template's fields are fixed in `FIELDS` (`server/templates.js:29`): `id`, `name`, `description`, `version`,
  `words`, `verbs`, `phases`, `icons`, `moduleNames`, `moduleIcons`, `modules`, `settings`, `lobby`, `spaceDefaults`,
  `reactions`, `theme`, `iconSet`. `problemsOf()` (line 100) checks them; `cleanTemplate()` (line 271) keeps them.
- **Live parts** (words, verbs, phases, home icon, module names and icons) are put on the environment's store by
  `useLive()` (line 327). **Applied once** at creation, or offered on a switch: `settings` (an allow-list, `SETTINGS`,
  lines 73 to 92: language, clock, currency, sign-in text, call features, `showCalendar`, `showMap`, the theme), the
  Lobby, `spaceDefaults`, reactions, icon set, theme and modules (`applyTemplate()`, line 397; `offerFor()`, line 434).
- **Where templates come from:** bundled files; the host's templates and its edits of bundled ones in `host.json` (the
  console); and, on a single install only, files an owner imports into `app.json`. An owner on a hosted server cannot
  make or edit a template; they can only choose one and export it ([plan-environment-templates](plan-environment-templates.md),
  addenda 2 and 3).
- **A space's own template is built** (#810, #813, #816, #818): `space.template` (`sanitizeSpace`, `server/store.js`),
  `spaceTemplateFor()` (line 1086), `lookOf()` (line 1107), the switch `settings.spaceTemplates` (line 1079, absent means
  on), Set up's Template choice, and `GET /api/spaces/:id/look` (`server/index.js:4628`). Its decision 1 keeps modules,
  settings, reactions, icons and the theme out of a space's template.

**Words**

- `server/words.js:17` has thirteen keys; `host` and `admin` are fixed (line 18); the other eleven may be changed by an
  owner or a template (line 23). Inside a space, `SPACE_KEYS` (line 21: `space`, `aside`, `canvas`, `module`, `object`,
  `moderator`, `member`, `guest`) and the `layout` verb follow the space's template. The order: the owner's own words,
  then the space's template, then the environment's template, then the default (`lookOf()`).

**Modules**

- **On in a space** is one check, `ModuleManager.onInSpace()` (`server/modules.js:1394`): an enabled module is on in
  every space; the Lobby takes only a module whose manifest says `surfaces.canvas.lobby`. `server/index.js` calls it in
  twelve places. Which modules are on is the environment's, not the space's ([plan-layout-views](plan-layout-views.md),
  decision 16).
- **Display names and icons**: `store.moduleDisplay(id, spaceId)` (line 1169): the owner's, then the space's
  template's, then the environment's template's, then the manifest's.
- **Settings** are declared in each manifest with a `scope` of `environment`, `space` or `person`
  (`server/module-settings.js`). `effective()` (line 140) merges the three scopes over each setting's `default`. A
  template cannot set any module setting today (#291, "Templates seed module settings").
- **Each module's templateable surface today**, from its `module.json`:

| Module (id, version) | Settings today | What Thomas's review asks for |
|---|---|---|
| Planner (`travel`, 0.16.7) | `markers` (list, environment), `suggestFlights` (boolean, environment). Entries are stops, stays, journeys, notes and links; views Days, Decisions, Bookings, Money (`modules/travel/src/CONTRACT.md`); refs kinds `trip` and `plan` | A different plan per template (decision 19) |
| To-do (`todo`, 1.15.30) | `inCalendar` (boolean, environment, default on), with `needsModule: calendar`. No owners on a task today | Per template; the Calendar switch a template default; a task can link to a goal or a milestone |
| Budget (`budget`, 0.1.25) | `categories` (list, environment) | A unit (money, hours or effort); splitting only with money; seeded categories |
| Maps (`maps`, 0.10.3) | `categories` (list, environment); the picture map through `imageMap` | Seeded categories; real and picture maps on or off; the Place label |
| Calendar (`calendar`, 1.24.40) | `defaultView` (choice, person, default month) | Labels (Session, Meeting, Deadline, Check-in) and the default view |
| Documents (`documents`, 0.11.31) | `coediting` (boolean, environment). The Markdown box or the rich editor is each person's own choice, kept in the browser (`documents-rich`, `modules/documents/src/documents.js:849`) | Starter documents, labels, the default editor |
| Research (`research`, 0.4.35) | `tags` (list, environment), `linkPreviews` | Seeded tags and labels |
| Polls (`polls`, 1.15.29) | `addableByDefault` (space), `closeAfterDays` (environment) | Labels and defaults |
| Vault (`vault`, 0.4.7) | `spaceMaxGb`, `personMaxGb` (environment) | Labels and limits |
| Whiteboard (`whiteboard`, 0.1.64) | none | Labels and defaults |
| Stream (`stream`, 0.1.15) | 15 border and plate settings (environment) | Nothing in version 1 |
| AI Assistant (`assistant`, 0.1.28) | none (service-only, [plan-ai-assistant](plan-ai-assistant.md)) | The template turns it on or off |

**The Planner's shape** (measured for decision 28)

- `modules/travel/src/` holds 5,163 lines of script; `travel.js` alone is 3,264, and it is itinerary-shaped throughout:
  the day strip, the day card, stays across nights, journeys with two ends, bookings, conflicts, the flight look-up. About
  21 in every 100 of its identifiers are travel words, against about 14 that are general. What an outline planner would
  share with it (an ordered list of entries, an editor dialog, a date field, links) is mostly in the SDK already.
- Refs are named by module, kind and id (`host.util.objectKey`: `module|kind|id|scope|space`). No core code reads the
  `plan` kind or the `travel` id specially (`server/` names `travel` only as the demo loader's fallback template). Budget
  reads the Planner's priced bookings through `host.budget` (`"budget": true` in the manifest), not by its id.
- To-do's `linkTask` action (`modules/todo/module.json:99`) takes a task and any `ref` target, so it can link a task to
  an object of any module without a change.

**The SDK pieces a planner uses today** (`public/sdk/host.js`)

- `host.ui`: `editor`, `kindPicker`, `datePicker`, `timeField`, `viewSwitch`, `confirm`, `prompt`, `toast`, `fileChips`,
  `moreButton`, `toolbarButton`. `host.util`: `phaseTimeline`, `phaseWords`, `word`, `ymd`, `parseWhen`.
  `host.menu.show`, `host.toolbar.set`, `host.objects` (drag and drop between modules), `host.phases()`, `host.people()`.
- There is no shared ordered or nested list, no order key helper, no progress bar and no people picker: To-do and the
  Planner each draw and reorder their own lists.

**The call, reactions, icons and theme**

- Joining on entry is one environment switch, `autoJoinCall` (`server/store.js:332`). The call's position and the
  Conference layout's choices are each person's own, kept in the browser per space (`columnPref`, `public/space.js:72`).
- Reactions are one environment list, `settings.reactions`, seeded from the 105 of `server/default-lists.js` and
  edited freely by the owner (Manage > Template > Reactions, `public/admin.html:550`). Icons likewise
  (`settings.icons`, line 562).
- A theme is the environment's (`activeThemeId`, `themeMode`); a template may carry one. Each person already picks
  light or dark for themselves (`public/theme-mode.js`); nobody can pick a theme of their own.

**Workspaces** ([plan-workspaces](plan-workspaces.md))

- The Workspace is the one Customizable Workspace; Conference, Calendar, Map, Whiteboards and Documents are Fixed
  Workspaces. The owner sets which show, their order and which opens first (`tabs`, `defaultLayout` on the space); a
  person may hide more for themselves (decision 13). What the Workspace opens with is the space's `opensWith`, seeded
  from the template's `spaceDefaults.opensWith`. A Fixed Workspace's switches come from `server/fixed-workspaces.js`.

**Manage and the console**

- Manage's Template tab (`public/admin.html:475` to `572`) is one long page. The console's template editor
  (`public/host.html:337` to `452`, `public/host-templates.js`) is one form of nine parts.
- `tools/check-admin-load.mjs` (#828) opens every Manage tab at 1280 and 390 pixels and fails on any page error, a
  `console.error` or an API answer of 400 or more. There is no like check for a module's own pages.
- Modules appear in five lists that read alike (#774, #202): installed (Manage > Modules), offered by the template, the
  template's names, on in a space, and Opens with.

**Starter content and demo data**

- Nothing creates objects for a new space. The demo loader (`server/demo-loader.js`) fills one marked space from
  `templates/demo/<template id>.json`, writing each module's data in that module's own format, as a signed-in person.
  Only `travel` has a demo file.

## What this replaces

The product is not released, so these are replaced cleanly, with no compatibility layer and no data migration.

- [plan-environment-templates](plan-environment-templates.md): decision 3 ("Defaults, never locks"), decision 7 (a
  template's modules on in every space), decision 18 (owners and templates change every word but two), and addendum 2
  decision 2 (reactions, icon set and theme applied once from a template).
- [plan-space-templates](plan-space-templates.md) decision 1 (a space's template does not change modules, settings,
  reactions or icons).
- [plan-layout-views](plan-layout-views.md) decision 16 (an enabled module is on in every space).
- [plan-workspaces](plan-workspaces.md) decision 13, in part: a person can no longer hide a Fixed Workspace the owner
  turned on (decision 9 below). Renaming and re-icon for oneself stay.
- #307 ("Planner modes"): answered by dedicated planner modules, not modes (decision 28).
- This plan's own first draft (#831): option C, modes inside one Planner, and the Planner's outline engine.
- `CLAUDE.md` (Names) says the word a person reads "can change, per environment template". Decisions 5 and 32 lock it
  for eight names and two verbs. The Names section is Thomas's to update; this plan does not edit it.

## Decisions

Thomas, 2026-11-15. Numbered here; the plan cites them as "decision N".

1. **Three tiers.** The environment is the catalog; a template is a lens over it; Manage picks the environment's
   default template and whether a space may use its own (on by default). Reason: one place for what exists, one for how
   it reads and behaves.
2. **What a template does:** renames the labels people may rename, adds reactions and icons on top of a fixed core set,
   offers a subset of the catalog's modules and renames them, sets the default space (read here as what a new space
   starts with) and starter spaces.
3. **A fixed, uneditable Default template.** A real template nobody can edit: the core words, reactions and icons.
   "Same as the environment" resolves to it when nothing else is chosen, and it is the fallback when a template is
   deleted. (Its modules: decision 33.)
4. **Owners copy and edit their own templates.** Shipped templates stay fixed.
5. **Locked words.** Environment, Canvas, Module, Object, Owner, Moderator, Guest and the canvas-layout button's word
   (the `layout` verb) read the same everywhere. No "game master". Reason (Thomas): the flexibility is not worth it.
   (Aside and the `enter` verb: decision 32.)
6. **Editable words:** Member and Space, plus the Home plural and the Lobby's name and description, which belong to the
   environment's default template only (Home and the Lobby are the environment's, not a space's).
7. **Pages for a template**, each its own page, not one long scroll: Environment Basics (template name, description,
   Home icon, and the default profile pictures, today's "New spaces use"), Experience Labels (renamed from Words and
   Verbs; only the mappings people actually see), Default Workspace, Phases, Additional Reactions and Icons, Modules.
   Theme is not a template page.
8. **The Default Workspace is fixed and template-driven.**
9. **Any workspace the owner turns on is pinned for everyone**: nobody can hide it. People still add layouts of their
   own.
10. **The template decides a space's modules.** A space cannot turn a module off on its own; for different modules,
    pick another template.
11. **Phases stay independent of the planners.** The template defines the set, the space's Set up holds the dates,
    modules read them. A phase set gains a **measure**: `dates`, `goals` or `progress`.
12. **Reactions and icons:** the environment level owns the owner's own reactions and icons for every template
    (Manage > Environment > Reactions and Icons, merged as #852); a template only adds; a space has none of its own.
    Manage > Template > Additional Reactions and Icons shows only the template's additions (Thomas, 2026-11-15).
    **Divergence called out (2026-11-15):** the plan said the environment holds a fixed main set and the owner's
    editing of reactions and icons moves to the template's Additional Reactions and Icons page. Thomas said the
    environment level owns the owner's own reactions and icons for every template. What now stands: the owner edits
    them under Manage > Environment > Reactions and Icons; the template page lists only its additions.
13. **Theme leaves templates.** The environment sets the default; each person may choose their own theme.
14. **Templates drive how a module works**, what things are called included. Each module's manifest marks each of its
    settings as **driven** (the template sets it; shown read-only), **default** (the template seeds it; the owner may
    change it) or **own** (the template cannot touch it). The module also declares which of its own labels may be
    renamed; a template maps only those.
15. **Core never lets a template touch a module's permissions, uploads, refs or access.** Reason: a third-party module
    can take part safely.
16. **The call is not a module yet,** so joining on entry, the call's position and the Conference layout become core
    space settings a template can drive. They move to the call's manifest when the call becomes a module. The browser's
    microphone and camera prompt on joining at entry is a constraint to design around.
17. **Starter content** is a template's own idea: objects created once when a space is made, never made again.
18. **Before the freeze.** The roadmap board's dates are re-estimated after this plan is sized and Thomas confirms the
    estimate; they are not changed until then.

**Module by module** (Thomas's answers in the review, 2026-11-15):

19. **The plan adapts per template.** Travel: the day-by-day itinerary, as today. Project: a project plan of tasks,
    milestones and owners (draws in To-do and Calendar). Learning: a learning plan of goals, steps and progress, with no
    required dates (reads Research and Documents). Games: a campaign plan of sessions, scenes and story threads (dates
    optional; draws in Maps and Research). Mentoring: a development plan of goals, sessions and progress (reads
    Documents and Research; dates optional). How: decision 28.
20. **To-do** per template. Project: the task list the project plan draws from (owners, due dates, status; Calendar
    shows due dates). Learning and Mentoring: exercises and next steps tied to a goal, checked off, optional dates; in
    Mentoring the mentee owns them. Games: the game master's preparation and follow-ups, optional due dates. Travel: as
    today. **Show To-do in the Calendar** is a template default the owner can change. A task may link to a goal or a
    milestone in every template.
21. **Budget** has a **unit**, money, hours or effort, set by the template. Splitting (who owes whom) is available when
    the unit is money. Project: time and effort (money optional). Games: the group's real costs. Learning and
    Mentoring: hours. Travel: as today. Categories are seeded per template; the module's name may read Budget, Effort
    or Time.
22. **Maps** stays one module. A template seeds its categories (the owner may add) and turns real maps and picture maps
    on or off. Games has both; Project, Learning and Mentoring use a normal map for clients, meetings, field work or
    visits. Travel as today.
23. **Calendar:** the template drives its labels (Session, Meeting, Deadline, Check-in) and its default view (a default
    the owner can change).
24. **Documents:** starter documents per template, created once when the space is made (Games: session notes and a
    handout; Project: a project brief; Learning: a learning journal; Mentoring: a meeting log), labels, and the default
    editor.
25. **Research:** seeded tag sets (the owner may add) and labels.
26. **Polls, Whiteboard, Vault:** labels, defaults and limits (the Vault's sizes, who may add polls). Nothing structural.
27. **Stream and the AI Assistant** are fixed. A template may turn the AI Assistant on or off (it is in the template's
    modules or not).

**The mechanism and the first draft's questions** (Thomas, 2026-11-15, after the first draft):

28. **Dedicated planners, one module per genuinely different shape**, not modes inside one Planner. Thomas's test: are
    the variations between the possible planners bigger than their shared core? He judged yes. Three shapes:
    - **Itinerary**: the existing Planner module (`travel`), catalog name "Planner - Travel" (decision 45). No change of
      behaviour is the acceptance test.
    - **Schedule outline**: a project plan of milestones, work with owners and dates, and what waits on what.
    - **Goal outline**: a learning or mentoring plan of goals, steps and progress, dates optional.

    The campaign plan uses the Schedule outline (decision 42).
29. **Differences inside a shape are template settings**, marked `driven` or `default` in that module's manifest
    (decision 14): its labels, whether dates are required, what counts as progress, its default view.
30. **The shared parts live in the platform, not in copied code:** phases, refs and the `plan` kind, To-do's `linkTask`,
    and the `host.ui` pieces. Which outline pieces move into the SDK is proposed under "The shared outline pieces".
31. **Plan data does not carry across a template change.** Each planner is its own module with its own data. When a
    space changes template, the old planner turns off there and keeps its data; the new one starts with its own.
    Nothing is deleted, copied or converted.
32. **The `aside` word and the `enter` verb are locked** (the first draft's question 2). Games loses "whisper".
33. **The fixed Default template offers the whole catalog** (question 3). An environment that never picks a template
    works as it does today.
34. **Nothing moves after the release** (question 10). The full scope lands before the freeze.

**The answers to the open questions** (Thomas, 2026-11-15):

35. **An owner's environment-wide change to a setting a template seeds: the owner's value wins everywhere**, as their own
    words do today. To differ by kind of space, the owner copies the template and changes it there. Reason: one place
    where a value lives.
36. **The template seeds which Fixed Workspaces a new space shows**, as a default the owner changes in Set up.
37. **The three call settings (`joinOnEntry`, `position`, `layout`) are all `default`.** The owner or a moderator may
    change joining for the space; a person's own position and layout win once picked.
38. **A phase measured by goals counts from the linked planner entries that name it**: it is done when every entry that
    names it is done. A phase no entry names uses the **Done** switch as the fallback.
39. **The host edits templates on the same pages as Manage and the console**, one code. Shipped templates are editable
    only by the host.
40. **The Lobby's words go on Experience Labels** with the other words. (The second sentence, "Travel's Vault is named
    "Files"", is replaced by decision 51.)
51. **Vault everywhere:** the Vault is called Vault in every shipped template (Thomas, 2026-11-15).
    **Divergence called out (2026-11-15):** decision 40 said Travel's Vault is named "Files", and the shipped-templates
    table said Vault ("Files", decision 40). Thomas said "Vault everywhere". What now stands: no shipped template
    renames the Vault; the name "Files" is not used.
41. **The server writes starter content, once, when the space is made**, through the data route's own checks, as the
    person who made it, for modules that opt in.
42. **The campaign plan uses the Schedule outline, with dates optional.** Sessions are milestones, scenes are work, story
    threads are tags.
43. **Names.** Every planner is named "Planner - <Kind>" in the catalog: the existing `travel` module is "Planner -
    Travel", the Schedule outline is "Planner - Projects" and the Goal outline is "Planner - Goals". The ids stay
    `schedule` and `goals`; the `travel` id is unchanged. A template may still rename a planner in its own labels (Travel
    shows "Itinerary", Project "Project plan").
44. **The Schedule outline holds its own work entries** (spans, owners, what they wait on), with To-do's tasks linked
    under them.
45. **The Planner's catalog name becomes "Planner - Travel"** (answers question 11): words only, a patch version bump and
    no change of behaviour. The Travel template can still show it as it does today.
46. **The Default template keeps the whole catalog**, and the Modules page groups the planners under "Plans".
47. **Third-party planners are allowed by convention.** The shared outline pieces and the `plan` kind are public in the
    SDK guide; a template lists an outside planner as it lists ours. No registry and no core rule for "a planner".
48. **The build is approved as a production build** (Thomas, 2026-11-15). It starts with steps 1 to 3, in order, and
    steps 9 and 10 beside step 1.
49. **The release dates** are the agreed estimate under "What this does to the release".
50. **The template changes come first, and planners must not slow them** (Thomas, 2026-11-15: "I do want to make sure I
    see the template changes happening. We should not slow those down for planners."). Steps 1 to 3, then 11a and 11b,
    have priority over the planners. Steps 13 and 14 do not start until 11a is merged and Thomas has seen it, unless a
    builder is free. Step 12 runs beside 11b.

## How a module changes with its template (the mechanism)

Two kinds of change, two answers:

- **Inside a shape** (labels, units, whether dates are required, what counts as progress, default views): a setting the
  module marks `driven` or `default`, set by the template (decisions 14 and 29). Budget's unit, Documents' default
  editor, the Schedule outline's "dates required" are all this.
- **Between shapes** (a day-by-day itinerary against an outline of goals): a different module (decision 28). The
  template picks which planner a space has by listing it in `modules`, and names it ("Project plan", "Learning plan").

Against Thomas's four tests:

- **Test 1** passes by construction: `travel` is not changed at all. The Travel template lists it and names it as today.
- **Test 2** passes for every template that uses an existing shape: a wedding or a renovation template lists a planner,
  sets its settings, maps its labels and adds starter content. A new shape is a new module, which can ship after the
  freeze without touching a frozen one.
- **Test 3** passes: a third-party planner uses the same SDK pieces and the same `plan` kind convention, and its manifest
  marks its own settings; core reads only the `template` marks and `labels` (decision 15).
- **Test 4** passes: a driven or seeded value resolves on the server, per space, before any page reads it; only
  `person` settings may differ between people, and only as `default`.

### The candidates and why not

- **A. A plan schema in the template**, read by one Planner engine. Why not: today's itinerary would have to be
  redrawn from a general schema (test 1 at risk), template authors could write plans the engine draws badly, and a
  third party would have to learn the core's schema language. The largest build, for one module.
- **C. Modes inside one Planner** (the first draft's suggestion): a driven `mode` choice picks an engine and a
  description inside `travel`. Why not: the itinerary engine and an outline engine share little code, so one package
  would hold two engines; every new mode after the freeze would change a frozen module; and the itinerary, the most
  used module, would be rebuilt around a switch it does not need.
- **B. One module per template** (Itinerary, Project plan, Learning plan, Campaign plan, Development plan). Why not:
  five modules where three shapes do; Learning and Mentoring differ only in labels and settings.
- **D. Code supplied by a template.** Rejected: it fails test 3 and puts an owner's code into every member's browser.

### Alternatives considered: modes against dedicated planners

| | Modes in one Planner (first draft) | Dedicated planners (decided) |
|---|---|---|
| **Effort** | About 10 builder-days: an outline engine and four mode descriptions inside `travel` | About 12: the shared outline pieces in the SDK (3), the Schedule outline (5), the Goal outline (3.5), the campaign fit (0.5). One more module shell (manifest, surfaces, permissions, refs, tests) costs more than a mode |
| **Risk** | The itinerary shares a package, a version and a data key with four new modes; test 1 rests on a test that the old path is untouched | The itinerary is not opened. A defect in a new planner stays in that planner. The new risk is the SDK pieces, which are core and read |
| **The freeze** | The four modes wait on the `mode` setting (step 3) and sit on the critical path; a fifth mode after the freeze changes a frozen module | The planners start as soon as the SDK pieces land, beside the core chain; a new shape after the freeze is a new module and touches nothing frozen |
| **Extensibility by outsiders** | An outsider cannot add a mode to our module | An outsider builds a planner on the same SDK pieces and `plan` kind and is listed by a template like ours |
| **The module list in admin** | One Planner in Manage > Modules | Three planners in the catalog (Planner - Travel, Planner - Projects, Planner - Goals; decision 43). A space sees only its template's one. The Default template shows all three, grouped under "Plans" (decision 46) |

## The contract

### The template, as stored (server-development; core)

One shape for every source (bundled files, the host's, the owner's own). The product is not released: the shape is
replaced, the bundled files are rewritten, `formatVersion` stays 1, and there is no migration. Test data may be reset.

```json
{
  "id": "project",
  "name": "Project",
  "description": "Run a project together: the plan, tasks, effort and a calendar.",
  "version": 1,
  "words": { "space": { "one": "project", "many": "projects" } },
  "home": { "one": "Projects", "many": "Projects" },
  "icons": { "home": "diagram-project" },
  "lobby": { "name": "Front desk", "description": "Everyone on every project." },
  "modules": {
    "schedule": { "name": "Project plan", "settings": { "datesRequired": true, "dependencies": true } },
    "todo": { "settings": { "inCalendar": true, "owners": true } },
    "budget": { "name": "Effort", "settings": { "unit": "effort" } },
    "documents": {
      "settings": { "defaultEditor": "markdown" },
      "starter": { "doc:brief": { "title": "Project brief", "text": "# Project brief\n\n## Goal\n\n## Who\n\n## When\n" } }
    },
    "calendar": { "labels": { "event": { "one": "meeting", "many": "meetings" } } },
    "chat": {}
  },
  "call": { "joinOnEntry": false, "position": "top", "layout": "grid" },
  "workspace": { "opensWith": ["schedule", "todo", "chat"], "show": ["calendar", "documents"], "opensFirst": "workspace" },
  "phases": [{ "id": "start", "label": "Start" }, { "id": "build", "label": "Build", "main": true }, { "id": "wrap", "label": "Wrap up" }],
  "phaseMeasure": "dates",
  "reactions": [{ "id": "ship", "glyph": "\ud83d\ude80", "label": "Ship it" }],
  "iconSet": ["diagram-project"],
  "spaceDefaults": { "profile": "participants" },
  "starterSpaces": [{ "name": "Your first project", "description": "A place to try things." }],
  "settings": { "showMap": false }
}
```

(The Documents key `doc:brief` and its value stand for whatever Documents' own data format is; the builder of the
Documents step writes the real one. The module id `schedule` is decision 43's.)

- **`modules`** becomes one object by module id, in display order: `{ name?, icon?, settings?, labels?, starter? }`.
  It replaces `modules` (the list), `moduleNames` and `moduleIcons`. Any other key is refused: "modules.<id>: a
  template sets only name, icon, settings, labels and starter." That sentence is how decision 15 is enforced. `chat`
  must be listed (as today). A template may list more than one planner; the shipped ones list one each.
- **`settings`** inside a module entry: only keys the module's manifest marks `driven` or `default`, each checked by
  the module's own setting rules (`cleanValue`, `server/module-settings.js:28`). A key marked own, unknown, or of a
  refused type fails with one sentence naming the module and the key.
- **`labels`** inside a module entry: only keys the manifest declares in `labels`, each `{ one, many, a? }` by the word
  rules of `words.cleanWord`.
- **`starter`**: the module's own data keys and values, written once when a space is made.
- **`words`** takes only `space` and `member` (decision 6). **`home`** and **`lobby`** are read only when the template
  is the environment's default. A template naming a locked word is refused: "words: "owner" reads the same everywhere,
  so a template can't change it." `aside` is locked (decision 32).
- **`verbs`**: removed. The `layout` and `enter` verbs are locked (decisions 5 and 32).
- **`call`**: the three core call settings (decision 16). `joinOnEntry` true or false; `position` one of `top`,
  `bottom`, `left`, `right`, `float`, `workspace`, `window`; `layout` one of the call's tile layouts. Their marks are
  decision 37: all three `default`.
- **`workspace`**: the Default Workspace (decision 8): `opensWith` (module ids, at most 20, each in this template's
  `modules`), `show` (the Fixed Workspaces a new space shows, decision 36), `opensFirst` (a fixed layout id, default
  `workspace`).
- **`phases`** as today (at most 12), plus **`phaseMeasure`**: `dates` (the default), `goals` or `progress`.
- **`reactions`** and **`iconSet`** are additions only (decision 12): a repeat of the core set is refused.
- **`theme`**: removed (decision 13); a file that has it is refused with the unknown-field sentence.
- **`settings`** (the environment-wide allow-list) stays, applied once when an environment is made from the template,
  without the theme keys.
- **`spaceDefaults`** keeps `profile` only; `opensWith` moves to `workspace`.
- **`starterSpaces`**: at most 5 spaces `{ name, description }`, made once when an environment is made from the template
  (or offered, unticked, on a switch), each using this template.

### The Default template

- Id `default`, name "Default", shipped as `templates/default.json`, `version` 1. Words: none (the defaults). Modules:
  every module in the catalog (decision 33): `modules` is written as `"*"`, read as every enabled module, the three
  planners included. Reactions and icons: none added. Phases: none. Call: `joinOnEntry` false, `position` `top`,
  `layout` `grid`. No starter spaces or content.
- Nobody can edit, hide or delete it, the host included: `PATCH` answers 403 "The Default template can't be changed;
  copy it to make your own.", `DELETE` 403. It can be copied; the copy lists the catalog's modules by id at the time.
- An environment always has a template: one with none recorded reads `default`. `TEMPLATE=` unset means `default`.

### Owners' own templates (decision 4)

- Stored in `app.json` as `templates: [{ ...template, version, createdAt, updatedAt, copiedFrom: { id, version } }]`, on
  hosted and single installs alike.
- **Copy:** `POST /api/environment/templates { from, id, name }` copies any template the owner may choose at version 1.
  201 `{ template }`; 409 "There is already a template called <id>."; 400 with the problems.
- **Edit:** `PATCH /api/environment/templates/:id`, owner or host admin, the same checks as every template; the version
  goes up. 403 for a shipped or a host template: "Shipped templates stay as they are; copy one to change it."
- **Delete:** `DELETE /api/environment/templates/:id`, allowed while in use (decision 3): spaces that used it read the
  environment's default template; if it was the environment's default, the environment reads `default`. The answer
  lists what moved: `{ spaces: [names], environment: true | false }`. The page confirms first and names them.
- Ids stay unique across every source an environment sees. The host keeps its console templates (`host.json`) and its
  edits of bundled ones, in the new shape.

### Resolution per space (server-development; core)

One resolver, `store.lookOf(spaceId)`, grown to answer everything a template gives a space: `{ template, words, verbs,
phases, phaseMeasure, modules, labels, settings, call, reactions, icons }`. Every route, page and module reads through
it; no other code reads a template.

- **Which template:** the space's (`space.template`, while `settings.spaceTemplates` is on and the id exists), else the
  environment's default template, else `default`. The Lobby and Home always read the environment's default template.
  An aside reads its origin space's (as built).
- **Words:** the owner's own words for `space` and `member`, then the template's, then the defaults. Locked keys always
  read the defaults.
- **Modules on in a space:** `ModuleManager.onInSpace()` takes the space's module set: a module is on when it is enabled
  in the catalog, listed in the space's template's `modules` (or the template says `"*"`), and, in the Lobby, allowed
  there. It is the one check, so every route that asks it (data, settings, actions, destinations, widgets, the AI's
  context) follows at once. A module off in a space answers there as a module that is off does today; its data stays.
- **Module display names and icons:** the owner's own, then the template's `modules.<id>.name` and `.icon`, then the
  manifest's.
- **Labels:** the template's `modules.<id>.labels`, then the manifest's own default words.
- **Reactions and icons:** the core set (`server/default-lists.js`), then the template's additions.

### The module manifest (server-development and experience-design; core, security-sensitive)

Additions to `module.json`, checked at install (`server/modules.js`) and documented in [api-modules](../api/api-modules.md):

**1. A `template` mark on a setting:** `"template": "driven"` or `"template": "default"`. Absent means own.

- Allowed on `boolean`, `choice`, `number`, `text`, `color` and `list` settings, in any scope; a `person` setting may be
  `default` only, never `driven`.
- Refused on `secret`, `file`, `files`, `url` and `note`, with "module.json: setting "<key>" is a <type>, so a template
  can't set it." Reason: a template must never set a key, a file, or an outside address a module would contact.
- **Driven:** while the space's template gives a value, that value applies and the setting is read-only: the forms show
  it with "Set by the <template name> template." A write of it answers 409 "<label> is set by the <template name>
  template." When the template gives none, the setting behaves as own.
- **Default:** the template's value replaces the manifest's `default`. A stored value at the setting's scope wins,
  and the owner's value at the environment's scope wins in every space (decision 35). The form marks it "From the template" with **Reset**.
- `ModuleSettings#effective(manifest, { spaceId, userKey, template })` takes the template layer, so
  `GET /api/modules/:id/settings/values` and `host.settings.get()` answer the resolved values.
  `GET /api/module-settings/:scope` adds, per setting, `template: "driven" | "default" | null`, `templateValue` and
  `locked`.

**2. `labels`:** up to 20 renameable words a module shows, each `"<key>": { "one", "many", "a"? }` (keys lowercase
letters, digits and dashes, starting with a letter, up to 30 characters). The module reads them from
`host.locale().labels` and through `host.util.label(key, { many, cap, a })`, the twin of `host.util.word`. A label is a
word a person reads, held by `check-names --words`. Manifest text (setting and action labels) keeps the default words in
version 1.

**3. `starter: true`** (optional): the module accepts starter content.

Example: Budget's unit (`driven`) and splitting (`default`, shown only with money):

```json
[
  { "key": "unit", "label": "Counts", "type": "choice", "scope": "space", "template": "driven", "default": "money",
    "options": [ { "value": "money", "label": "Money" }, { "value": "hours", "label": "Hours" }, { "value": "effort", "label": "Effort points" } ] },
  { "key": "split", "label": "Who owes whom", "type": "boolean", "scope": "space", "template": "default", "default": true,
    "showWhen": { "key": "unit", "value": "money" } }
]
```

**What core never passes a template** (decision 15): permissions, access, guards, uploads, refs, actions, hooks,
events, destinations, secrets and files. A template's module entry has no field for any of them, and the resolver copies
only `name`, `icon`, `settings` (filtered by the marks), `labels` (filtered by the declared keys) and `starter` (only for
a module that opts in).

### The shared outline pieces (server-development or experience-design; core, held for a read)

Two outline planners would otherwise each build the same ordered, nested list. These move into the SDK, built once and
used by both planners (and open to To-do and to third-party modules). Each draws with theme tokens, uses
`host.menu.show` for its row menu, and works at 390 pixels.

| Piece | What it does | What the module keeps |
|---|---|---|
| `host.ui.outline(el, o)` | Draws an ordered tree of the module's entries (`{ id, parent, order }`), up to `o.depth` levels (default 2). Reorder and nest by dragging; on a phone and by keyboard by **Move up**, **Move down**, **Indent** and **Outdent** in the row menu (and Alt+Up, Alt+Down, Tab, Shift+Tab). Fold and unfold a parent. An empty line in the module's words. Reports `o.onMove({ id, parent, order })`; it never writes data | How a row looks (`o.row(entry, rowEl)`), what a click opens, and writing the move |
| `host.util.order(before, after)` | An order key that sorts between two neighbours, so two people moving entries at once do not renumber the list | Nothing |
| `host.util.rollup(entries)` | A parent's `{ done, total }` from its children's `done`, any depth | What counts as done |
| `host.ui.progress(el, { done, total })` | The small bar and the words "2 of 4" | Where it goes |
| `host.ui.peoplePicker(el, o)` | Picks one or more people of the space (from `host.people()`), for owners | Which field it fills and what owning means |

Stays in each planner: its kinds of entry and their fields, its editor dialogs (on `host.ui.editor`), its views (the
Schedule outline's Timeline and its "waits on" lines; the Goal outline's Goals view), its data format, its actions, its
refs and its settings. The Planner (`travel`) does not adopt these pieces in version 1 (test 1).

Already shared, used as they are: phases (`host.phases()`, `host.util.phaseTimeline`), the Calendar mirror through
`refs.dated` and `mirror`, backlinks, `host.objects` drag and drop, `host.ui.viewSwitch`, `host.toolbar.set`,
`host.ui.editor`, `host.ui.datePicker`.

### The `plan` kind convention

Every planner names its entries with the refs kind `plan`, `name: "{name}"` (each entry reads its own kind word:
"stop", "milestone", "goal"), `key: "plan:{id}"`, with `backlinks` on. Its summary carries `title`, `when`, `done` and,
where the planner has them, `end`, `phase` and `progress`. So To-do's `linkTask`, the Calendar mirror, Chat's links and
the AI Assistant treat any planner's entries alike without knowing which planner it is. It is a convention documented in
[api-modules](../api/api-modules.md), not a new core rule: refs are already named by module, kind and id.

### The planners

**Itinerary: the Planner (`travel`), no change of behaviour.** No code change; only the catalog name and a patch
version. The Travel template lists it and names it as today. Its `markers` and `suggestFlights` stay own settings. Its catalog name becomes
"Planner - Travel" (decision 45): words only, a patch version bump of `travel` and nothing else.

**Schedule outline** (experience-design; module lane, its manifest held for a narrow read). Module id `schedule`, catalog
name "Planner - Projects" (decision 43).

- **Scope** `["environment", "space"]`; data at space scope. **Surfaces:** `page` and `canvas` (`dock`, `float`). No
  widget in version 1.
- **Permissions:** `view` ("See the plan": member, guest, moderator), `edit` ("Add and change the plan": member,
  moderator), `clear` ("Clear the whole plan": moderator). `access: { read: "view", write: "edit" }`, `guards: { clear:
  "clear" }`. No uploads.
- **Kinds of entry:** `milestone` (a title, a date, done when its work is done or when ticked); `work` (a title, start
  and end dates, owners, what it waits on, done); `note`. `work` is its own kind (decision 44); To-do's tasks link under it.
- **Views:** **Timeline** (weeks across, work as bars, milestones as marks, "waits on" lines; entries with no date in a
  "Not scheduled" strip below) and **List** (the outline). `host.ui.viewSwitch`.
- **Refs:** produces `plan` (the convention), `dated` from `start` and `end` with `mirror: "out"` so the Calendar shows
  dated entries; consumes `*`. To-do tasks linked with `linkTask` show under the entry they link to, through backlinks.
- **Actions:** an add action per kind, so a drop, Chat and the AI Assistant can add to it, as the Planner's `addStop`.
- **Settings** (all `space` scope unless said):

| Key | Type | Mark | Default | Use |
|---|---|---|---|---|
| `datesRequired` | boolean | driven | true | A milestone and work need dates. Off: dates optional, the Timeline shows only dated entries |
| `dependencies` | boolean | driven | true | "Waits on" between entries, and its lines |
| `progressBy` | choice `work`, `milestones` | driven | `milestones` | What the plan's chip counts |
| `defaultView` | choice `timeline`, `list` | default | `timeline` | The view a person opens first; their own choice wins |
| `tags` | list | default | none | Tags an entry may carry (Games' story threads, decision 42) |

- **Labels:** `plan`, `milestone`, `work`, `note`, `owner`, `tag`.

**Goal outline** (experience-design; module lane, its manifest held for a narrow read). Module id `goals`, catalog name
"Planner - Goals" (decision 43).

- **Scope, surfaces, permissions, access, guards:** as the Schedule outline, in its own words ("See the goals", "Add and
  change goals", "Clear all goals"). No uploads.
- **Kinds of entry:** `goal` (a title, why, owners, an optional target date, an optional phase, done); `step` (under a
  goal: a title, an optional date, done); `note`.
- **Views:** **Goals** (one card per goal with its progress and its steps) and **List** (the outline).
- **Refs:** produces `plan`, `dated` only for entries with a date, `mirror: "out"`; its summary carries `phase` and
  `progress` (decision 38); consumes `*`. To-do tasks, Documents, Research and Calendar sessions link to a goal or a step
  as any object does.
- **Settings:**

| Key | Type | Mark | Default | Use |
|---|---|---|---|---|
| `dates` | choice `off`, `optional` | driven | `optional` | Whether goals and steps show a date at all |
| `progressBy` | choice `steps`, `done` | driven | `steps` | A goal's progress: the share of its steps done, or done or not |
| `defaultView` | choice `goals`, `list` | default | `goals` | The view a person opens first; their own choice wins |

- **Labels:** `goal`, `step`, `note`, `owner` (Mentoring: "mentee").

### What each template turns on

| Template | Its planner (name shown) | Planner settings | Other modules and their settings |
|---|---|---|---|
| **Travel** | Planner - Travel, `travel` (shown "Itinerary", as today) | none | As today: To-do, Budget (money), Maps, Calendar, Documents, Research, Polls, Vault (named Vault, decision 51), Whiteboard, AI Assistant |
| **Project** | Schedule outline ("Project plan") | `datesRequired` true, `dependencies` true | To-do (owners, `inCalendar` on), Calendar (Meeting, Deadline), Budget ("Effort", unit `effort`, money optional), Documents (a project brief), Maps (a normal map), Research, Polls, Whiteboard, Vault |
| **Learning** | Goal outline ("Learning plan") | `dates` optional, `progressBy` steps | To-do (exercises tied to a goal), Documents (a learning journal), Research, Calendar (Session), Budget ("Time", unit `hours`), Maps (visits) |
| **Mentoring** | Goal outline ("Development plan") | `dates` optional, `progressBy` steps; `owner` reads "mentee" | To-do (the mentee owns tasks), Calendar (Check-in), Documents (a meeting log), Research, Budget ("Time", unit `hours`) |
| **Games** | Schedule outline ("Campaign", decision 42) | `datesRequired` false, `dependencies` false; `milestone` reads "session", `work` "scene", `tag` "story thread" | Maps (real and picture maps), Research, Documents (session notes, a handout), Budget (money), To-do (preparation), Calendar (Session), AI Assistant |
| **Default** | All three (decision 33) | none | Every module in the catalog |

To-do's owners are a new To-do setting (`owners`, boolean, space, `default`, off), using `host.ui.peoplePicker`.

### Core call settings (server-development, then experience-design; core)

- A space record gains `call: { joinOnEntry?, position?, layout? }`; a missing key means the template's. The
  environment's `autoJoinCall` is removed (replaced, unreleased).
- `PATCH /api/spaces/:id { call }`: owners, the admin and moderators. 400 with a sentence for an unknown position or
  layout.
- **The browser's prompt** (decision 16): joining on entry joins with the microphone and camera off, so entering asks
  for nothing until the person turns one on. Where a browser will not start sound without a tap (a reloaded page on an
  iPhone or iPad), the page shows **Join the call** instead, and says why once. Not checkable without a real call.

### Starter spaces and starter content (server-development; core, security-sensitive)

- **Where it lives:** `starterSpaces` (whole spaces, for a new environment) and `modules.<id>.starter` (objects, for a
  new space), in the module's own data format, the same block the demo loader writes.
- **Who may receive it:** only a module whose manifest says `"starter": true`. Documents opts in first; the two new
  planners opt in from their first version.
- **When:** once, when a space is made, as the person who made it, through the same path and checks as
  `PUT /api/modules/:id/data/:key` (space scope only). The space records `starterDone: true` whether or not every write
  passed. A write that fails is logged and skipped; the space is still made. **Never** on a change of template, a
  restore, or a demo load.
- **Limits:** at most 20 keys per module and 64 KB of starter content per template. The server writes it (decision 41).

### Phases and their measure (server-development, then experience-design; core)

- `dates`: as today. `progress`: Set up shows a **Done** switch per phase (stored as `space.phaseDone`, `{ <phase id>: true }`); the current phase
  is the first not done. `goals`: decision 38: a phase is done when every planner entry that names it is done, read from the `phase` and `done` in the refs summary; a phase no entry names uses the same **Done** switch.
- `host.phases()` gains `measure` and each phase's `done`. The phase chip reads "<phase> · 2 of 4" for `progress` and
  `goals`, the date for `dates`.

### Reactions, icons and theme (server-development, then experience-design; core)

- The core set is read from `server/default-lists.js`; additions come from the space's template. `allowReactions` stays
  the environment's switch. The owner's own reactions and icons stay on Manage > Environment > Reactions and Icons
  (#852) and apply to every template; Manage > Template > Additional Reactions and Icons shows only the template's
  additions. (Divergence called out under decision 12.)
- The environment's default theme stays. Each person gains `theme: <theme id> | null` on their account, chosen in
  Profile among the environment's themes; light and dark stay as today.

### Workspaces (server-development, then experience-design; core)

- **The Default Workspace:** a space's Workspace opens with its template's `workspace.opensWith`. Set up's **Opens
  with** becomes read-only, naming the template. The space's own `opensWith` key is removed.
- **The pin rule** (decision 9): a Fixed Workspace the owner shows is shown for everyone. A person's own hide of it is
  refused (409 "The owner keeps this one in the bar.") and a stored hide is ignored.
- A new space's `tabs` start from the template's `workspace.show` and `opensFirst` (decision 36).

### What happens to an existing space when its template changes

Shown before the change, in the confirm: "Change this {space} to Project? Its words, {modules} and how they work change
now. Nothing is deleted.", then the modules that turn off and on, by name. When the planner changes, it adds: "The
{old planner} keeps its plan; it comes back if you change back. The {new planner} starts empty."

| Part | After the change |
|---|---|
| Words, labels, module names and icons, phases, added reactions and icons | Follow the new template at once |
| Modules | The new template's set is on; a module that leaves the set turns off here and keeps its data; it comes back with its data if a template brings it back |
| The plan | Each planner keeps its own data (decision 31). The old planner turns off with its plan kept; the new one starts with its own data, empty unless it had some from before. Nothing is copied, converted or deleted. Changing back shows the old plan as it was |
| Links to plan entries | A To-do task, a document or a Calendar event linked to an entry of a planner now off keeps the link; it reads as an object whose module is off, as any link does today |
| Driven settings | Follow at once (Budget's unit, the Schedule outline's dates) |
| Default settings | A value someone stored is kept; otherwise the new template's |
| Budget entries | Each entry keeps the unit it was written in; totals count the current unit only; the rest are listed under "In another unit" |
| Phase dates | Kept; ids the new template lacks are ignored and dropped from a save (as built) |
| Default Workspace | The new template's on the next entry; each person's remembered arrangement falls through as today when a module is gone |
| Starter content | Never created on a change |
| Call settings | A value someone stored is kept; otherwise the new template's |

When a template **is edited** (the host's or an owner's own), every space using it follows on the next read, as above.

### Pages (experience-design)

The pages are built in two parts (decision 50). **11a** needs only step 1: the short Template tab, the template list,
Environment Basics, Experience Labels (only the editable words; the locked words read-only), and the host's console
versions. **11b** needs the later steps: Modules, Additional Reactions and Icons, Phases, Default Workspace, Set up's
read-only parts and Profile's theme. Each setting is its own page, not one long scroll.

- **Manage's Template tab** becomes a short page: the environment's default template (the choice and the offer), **Let
  {a space} use its own template**, and the templates this environment may use, each with **Open**, **Copy** and, for
  the owner's own, **Delete**. Opening one goes to its pages, each at its own address (`/admin#template/<id>/basics`
  and so on), with a jump list (a strip on a phone):
  - **Environment Basics:** name, description, Home icon, the default profile pictures ("New spaces use").
  - **Experience Labels:** Space and Member; each module's renameable labels; for the environment's default template,
    the Home plural and the Lobby's name and description (decision 40). The locked words are not listed.
  - **Default Workspace:** what the Workspace opens with, and which Fixed Workspaces a new space shows.
  - **Phases:** the list and the measure.
  - **Additional Reactions and Icons:** only the template's additions. The core set and the owner's own reactions and
    icons are on Manage > Environment > Reactions and Icons (decision 12).
  - **Modules:** one row per catalog module: whether this template offers it, its display name and icon, its driven and
    default settings, and its starter content (keep or remove only, in version 1). The planners sit together under
    "Plans", so an owner sees they are alternatives.
  - A shipped template's pages are read-only, with **Copy to change it**.
- **Manage > Modules** is the catalog only: installed, enabled, and the module's own settings (#774, #202).
- **Theme** tab: the environment's themes and default; no template part.
- **Set up** in a space: the Template choice (as built); the Modules tab lists the modules the template gives, with no
  on and off switches, driven settings read-only and default ones editable; Opens with read-only; the call's three
  settings.
- **Profile:** the theme choice.
- **The host console:** the same pages for the host's templates (decision 39). Shipped templates are editable only by the host; an owner copies one to change it.
- Words people read are plain and short; every colour comes from the theme tokens; menus use `host.menu.show`.

### SDK (both; core)

- `host.locale().labels` and `host.util.label(key, { many, cap, a })`.
- `host.settings.get()` answers values with the template layer (no change of shape).
- `host.phases()` gains `measure` and each phase's `done`.
- The shared outline pieces: `host.ui.outline`, `host.util.order`, `host.util.rollup`, `host.ui.progress`,
  `host.ui.peoplePicker`.
- No template id or name reaches a module (the conduit rule, plan-environment-templates decision 12).

### Module changes (module lane, each with its own version bump)

| Module | Change |
|---|---|
| Planner (`travel`) | Catalog name "Planner - Travel" and a patch bump; nothing else (test 1) |
| Schedule outline (new) | The whole module, version 0.1.0, named "Planner - Projects" |
| Goal outline (new) | The whole module, version 0.1.0, named "Planner - Goals" |
| Budget | `unit` (driven) and `split` (default, money only); categories marked default; each entry keeps its unit; labels |
| Documents | `defaultEditor` (default; Markdown in every shipped template at release, #687); `starter: true`; labels |
| To-do | `inCalendar` marked default; `owners` (new, default) with `host.ui.peoplePicker`; labels |
| Maps | `categories` marked default; real map and picture map switches (driven booleans); the Place label |
| Calendar | `defaultView` marked default; labels |
| Research | `tags` marked default; labels |
| Polls, Vault, Whiteboard | labels; Polls' `addableByDefault` and the Vault's limits marked default |
| Stream, AI Assistant | none |

The Calendar destination and the To-do panel in it live at the environment's level: there, a setting resolves with the
environment's default template.

### The shipped templates (server-development; files in `templates/`)

- **Default** (new); **Travel** rewritten in the new shape with no change of behaviour; **Games** rewritten (its
  environment, owner and aside words removed; its planner the Schedule outline (decision 42); Maps with picture maps; starter session notes
  and a handout); **Project**, **Learning** and **Mentoring** new, per "What each template turns on".
  `tools/template-versions.json` records each.
- **What step 15 shipped:** Travel, Games, Project, Learning and Mentoring. Games carries the interim `travel` planner,
  not the Schedule outline of decision 42, and no template has a `schedule` or `goals` planner line until steps 13 and
  14 land (those planners do not exist before then). Each template's Vault is named Vault (decision 51).

## Behaviour by role and surface

| Who and where | What they see and do |
|---|---|
| **Admin (host)** | Everything an owner can, in every environment. On the console, the host's templates and its edits of bundled ones, on the same pages. Cannot edit Default |
| **Owner** | Chooses the environment's default template and whether spaces may choose their own; copies any template, edits and deletes their own; chooses a space's template in Set up and in Add; changes default-marked settings |
| **Moderator** | Sees the space's template named; changes the space's default-marked space settings and its call settings; cannot choose a template or change a driven setting |
| **Member** | Reads the space through its template; picks their own theme, call position and views; cannot hide a Fixed Workspace the owner shows |
| **Guest** | Reads the space through its template, as a member does; sees a planner when its `view` permission allows (as the Planner's does today); no Set up, no Manage, no theme choice |
| **Home** | The environment's default template: its words, Home plural and icon, and Home's modules |
| **The Lobby** | The environment's default template, under the Lobby rule (only modules that declare the Lobby). The new planners do not declare the Lobby |
| **An aside** | Its origin space's words; no modules; the core reactions plus the origin's additions |
| **The call** | Joins on entry when the space says so; position and layout from the space, then the person's own choice |

## Asides and the Lobby

- An aside has no template; it reads its origin's words and reactions. It has no modules.
- The Lobby reads the environment's default template: its Lobby name and description, its reactions, and only the
  modules that template lists and the Lobby allows ([plan-modules](plan-modules.md), #63).

## Phones

- Every Manage template page is its own page, the jump list a strip, at 390 pixels with no sideways scroll; on the
  Modules page each module's settings fold under its row.
- Set up's read-only parts read as plain lines, not as disabled controls.
- The new planners work at 390 pixels: `host.ui.outline` moves entries through the row menu instead of dragging; the
  Schedule outline's Timeline scrolls sideways inside its own frame, and its List is the phone's first view.
- Joining on entry on an iPhone or iPad follows the tap rule above. Not checkable without a real device.

## Guests

- A guest reads the space's labels, modules and settings as a member does (test 4).
- A template never changes who may enter, the guest door, guest links or what guests may see: that is access, and
  decision 15 keeps it out.
- A module off in a space by its template is off for a guest there too.

## Verify

- **Checked by a tool:** the template shape and every refusal; the Default template's refusals and its `"*"`; an owner's
  copy, edit and delete with the fallback; resolution per space for words, modules, labels, settings, reactions and
  call settings; the manifest marks and their install refusals; driven writes refused; starter content written once and
  never again; the phase measure; the pin rule; a module off by template answering as off on its data route; the
  shared outline pieces (order keys, rollup, outline moves by keyboard); each planner's kinds, settings and refs.
- **Test 1, by a tool:** the only change in `modules/travel/` is the catalog name and the patch version (`git diff`
  shows nothing else), and its existing tests and the travel demo pass.
- **`check-admin-load` for every Manage page:** every new template page, for a shipped and an owner's template, the
  Profile theme choice and the console's template pages, at 1280 and 390, failing on any page error, `console.error` or
  API answer of 400 or more. It runs on every change that touches `public/`.
- **A smoke check that each new module loads:** `tools/check-module-load.mjs` (new) opens every bundled module's page
  and canvas surfaces in a space whose template lists it, at 1280 and 390, and fails on any page error,
  `console.error` or API answer of 400 or more. It runs for every module-lane change to a planner.
- **Verified live** on a local server with a throwaway `DATA_DIR`: one environment with a Travel, a Project, a Learning,
  a Games and a Mentoring space; each space's modules, words and planner; a Travel space against the previous build,
  page by page (test 1); a template change from Travel to Project and back, the itinerary still there; an owner's copy
  edited and deleted; every Manage template page at 1280 and 390, light and dark; a guest link into a Project space; a
  hosted second environment never reading the first's templates.
- **Not checkable here:** joining on entry and the browser's prompts, the call's position and layout in a real call,
  and the tap rule on an iPhone or iPad. They join the release's real-call list (plan-release decision 16).

## Tests and checks to add

- `tools/check-templates.mjs`: the new shape; module entries limited to five keys; settings only where marked; labels
  only where declared; starter only for modules that opt in; locked words (with `aside` and `enter`) refused; additions
  only; `phaseMeasure`; `theme` refused; the Default template; every shipped template valid against the real manifests.
- `tools/check-template-lens.mjs` (new): the resolver for a space, the Lobby and an aside; the module set through
  `onInSpace`; driven, default and own; a template change and every row of the change list, the plan row included;
  delete with its fallback; a hosted second environment.
- `tools/check-modules.mjs`: the `template` mark, `labels` and `starter` at install, with each refusal.
- `tools/check-starter.mjs` (new): once only, never on a change, as the creator, through the data route's checks, the
  limits, a failed write skipped, a module without `"starter": true` refused.
- `tools/check-outline.mjs` (new): `host.util.order` (keys between neighbours, many moves, two people at once),
  `host.util.rollup`, and `host.ui.outline` live (drag, keyboard, row menu at 390).
- `tools/check-module-load.mjs` (new) and `tools/check-admin-load.mjs` (grown), as under "Verify".
- `tools/check-layouts.mjs`: the pin rule. `tools/check-phases.mjs`: the measure. `tools/check-canvas.mjs`: joining on
  entry from the space's setting. `tools/check-names.mjs --words`: labels held like words.
- Module tests in `modules/<id>/test/`: each new planner's kinds, moves, progress, settings under each template value
  and its refs summary; Budget's unit and split; Documents' default editor; To-do's owners.

## Risks, ranked

1. **The freeze slips further than sized.** This touches every part of templates, every module, and adds two modules.
   Mitigation: the core chain goes first; the planners start beside it on the SDK pieces.
2. **The shared outline pieces are frozen with the release.** An SDK call is part of the frozen contract. Mitigation:
   two planners use them before the freeze, which settles their shape; an independent read.
3. **A module off in a space still answering there** (data, actions, widgets, the AI's context). Mitigation:
   `onInSpace` is already the one check; the new check walks every route that asks it; an independent read.
4. **A third-party module widened by a template.** Mitigation: five keys and no others; refused setting types; an
   independent read of the manifest change.
5. **Different people seeing different things** (test 4). Mitigation: one resolver; a check that reads every value for
   two spaces with two templates.
6. **People think a plan was lost on a template change** (decision 31). Mitigation: the confirm names the planner that
   turns off and says it keeps its plan; changing back shows it.
7. **Two new modules to finish to the release bar.** Plan-release decided every module has a done list; this makes
   fourteen. Mitigation: their done lists are written with their build, and the Schedule outline is the larger one, so
   it starts first.
8. **The two outlines drift apart** in how they look and move. Mitigation: the shared pieces; one builder for both.
9. **Starter writes by the server:** a double creation, or a write that skips the module's rules. Mitigation: the data
   route's own path, `starterDone`, the opt-in, the limits.
10. **Joining on entry** surprises people or fails on phones. Mitigation: microphone and camera off, the tap rule, the
    real-call list.
11. **A blank Manage page or a planner that does not load** (#828). Mitigation: `check-admin-load` and
    `check-module-load`.
12. **Three planners in a Default environment** read as clutter (decision 33). Mitigation: the Modules page groups them
    under "Plans" (decision 46).

The first draft's top risk, the Planner changing under travel, is gone: `travel`'s code is not touched, only its name.

## Rollback and off switch

- **Off switch for space templates** (built): `settings.spaceTemplates` off makes every space read the environment's
  default template at once.
- **The safe floor:** the Default template, every catalog module, behaves as an environment does today.
- **A new planner** can be disabled in Manage > Modules like any module; no other module depends on it.
- **Each step** is its own commit and reverts alone. The product is not released and test data may be reset.

## Not in version 1

- Writing new starter content in Manage (an owner's copy may keep or remove the template's starter content only).
- Labels inside manifest text (setting and action labels keep their default words).
- Stream border styles per template.
- A template for an aside, or words an owner types for one space.
- A mark on Home's list of spaces or in the switcher naming the template.
- The call as a module (plan-release decision 7).
- A schema language for plans (candidate A), and modes inside one module (candidate C).
- Moving or converting a plan from one planner to another.
- Widgets for the new planners, and the Planner adopting the shared outline pieces.
- A fourth planner for campaigns; the Schedule outline serves (decision 42).

## What this does to the release

- [plan-release](plan-release.md)'s freeze stops new features, routes, stored keys, manifest fields, SDK calls and
  changes to a stored format. This plan adds all of them, and two modules, so it lands before the freeze starts
  (decisions 18 and 34).
- **Size.** About **49 builder-days**, against about 45 in the first draft: core steps about 17, the shared outline
  pieces and the module load check about 3.5, the pages about 5, the existing modules about 8, the two planners about 9,
  the templates 2, QA about 3 and documents about 2. The planners cost a little more than modes did (a second module
  shell, a people picker, pieces built for any module), and the Planner costs only a name and a patch bump.
- **The order change does not move the freeze estimate.** The planners are off the critical path, so holding them back
  for 11a costs no calendar time; the estimate below stands. What Thomas sees, and when: after step 1 and 11a, he can
  open Manage > Template and the new pages (Environment Basics, Experience Labels, the template list). After step 3 and
  11b, the module, reaction, phase and workspace pages. The planners come last.
- **Calendar time at the fast pace** (several builders in parallel, affected checks only, the whole suite only at
  release prep, independent reads only for core and security): the critical path is the core chain, steps 1 to 3 in
  order with their reads (about 13 working days), then the Manage pages (about 5, as 11a and 11b) and the shipped templates, then QA
  (about 3): about **22 working days** from Monday 2026-11-16, with three or four builders busy at the peak. The
  planners and the existing modules run beside the core chain and are not on it, which the first draft's Planner modes
  were (they waited for step 3).
- **The earliest freeze:** about **2026-12-11 to 2026-12-18**, against the first draft's 2026-12-14 to 2026-12-21. In
  plain words: a little more work in total, a few days earlier at best and the same at worst, because the planners left
  the critical path. The blocking questions are now answered (decisions 35 to 47).
- **The board, the agreed estimate** (Thomas, 2026-11-15, decisions 18 and 49). The "Before the freeze" phase, which
  ends 2026-11-25 on `.github/roadmap-board.csv`, moves to end about **2026-12-18**, the late end of the earliest freeze
  above (2026-12-11 to 2026-12-18). The rest of the board follows:

  | Phase | Dates |
  |---|---|
  | Before the freeze | ends about 2026-12-18 |
  | Real-call tests | 2026-12-21 to 2026-12-30 |
  | Before the first customer | 2026-12-21 to 2027-01-22 |
  | After release | 2027-01-25 to 2027-03-05 |
  | Later / ideas | 2027-01-25 to 2027-04-23 |

  These are estimates, not promises. The board file itself is not changed by this plan.
- **The "verified" bar** (plan-release decision 16) gains joining on entry and the call settings a template sets, in the
  real two-person call on each device. A Travel space is walked against the previous build before the freeze.
- **The per-module done lists** (plan-release step 4) gain two, for the Schedule outline and the Goal outline, and each
  existing module's list now includes its templateable settings and labels. They are best written after this plan's
  module contract is agreed.

## Doc facts

What content-manager documents once each step lands:

- [architecture-environments](../architecture/architecture-environments.md) ("Templates"): the three tiers, the new
  shape, the Default template and its `"*"`, owners' own templates, resolution per space, the fallback on delete, what
  a template change does to a plan.
- [architecture-modules](../architecture/architecture-modules.md) and [api-modules](../api/api-modules.md): the
  `template` mark, `labels`, `starter: true`, what a template can never set, the module set per space, the `plan` kind
  convention for planners.
- [api-module-sdk](../api/api-module-sdk.md): `host.locale().labels`, `host.util.label`, the measure in `host.phases()`,
  `host.ui.outline`, `host.util.order`, `host.util.rollup`, `host.ui.progress`, `host.ui.peoplePicker`.
- [architecture-overview](../architecture/architecture-overview.md) ("Words"): the locked words and verbs.
- User guides: templates (the pages, copying, deleting), spaces (Set up, changing template), environment settings (the
  Template tab, Modules as the catalog), Profile (theme), the call (joining on entry), the Schedule outline and the Goal
  outline (new guides), Budget (unit), Documents (starter documents, the default editor), To-do (owners).
- Status lines: plan-space-templates, plan-environment-templates, plan-layout-views and plan-workspaces each get a
  pointer to "What this replaces".
- For Thomas: the Names section of `CLAUDE.md` says the word a person reads changes per template; decisions 5 and 32
  lock eight names and two verbs. It also still lacks Customizable Workspace and Fixed Workspace.

## Left to build, in order

Sizes: S under a day, M a day or two, L several days. **Core** steps are held for an independent read;
**security-sensitive** ones also get a security read. **Module lane** steps run module-scoped checks only and get no
independent read, except a new module's manifest (its permissions and refs are core by `CLAUDE.md`), which gets a narrow
read of the manifest alone.

| Step | What | Agent | Size | Kind |
|---|---|---|---|---|
| 1 | **The template format and catalog.** The new shape, the Default template, locked words, owners' own templates, the console's and Manage's routes, `check-templates` | server-development | L | Core |
| 2 | **The resolver.** `lookOf` grown; `onInSpace` with the space's module set; names, labels, reactions and icons per space; `check-template-lens` | server-development | M | Core, security-sensitive |
| 3 | **The manifest marks and labels.** `template`, `labels` and `starter` at install; the settings layer; driven writes refused; the forms' marks; `host.locale().labels` and `host.util.label` | server-development, then experience-design for the forms | L | Core, security-sensitive |
| 4 | **Core call settings.** `space.call`, joining on entry with the tap rule | server-development, then experience-design | M | Core |
| 5 | **Starter spaces and content.** `starterSpaces`, the once-only write, `check-starter` | server-development | M | Core, security-sensitive |
| 6 | **The phases' measure.** `phaseMeasure`, `done`, the chip, `host.phases()` | server-development, then experience-design | M | Core |
| 7 | **Reactions, icons and theme.** The core set plus additions; the person's theme | server-development, then experience-design | M | Core |
| 8 | **Workspaces.** The Default Workspace from the template, Opens with read-only, the pin rule | server-development, then experience-design | S | Core |
| 9 | **The shared outline pieces.** `host.ui.outline`, `host.util.order`, `host.util.rollup`, `host.ui.progress`, `host.ui.peoplePicker`; `check-outline` | experience-design | M | Core |
| 10 | **The module load check.** `tools/check-module-load.mjs` | server-development | S | Core (tools) |
| 11a | **The first Manage and console pages.** Only what needs step 1's template format and catalog: Environment Basics (Template Name, Template Description, Home Icon, Default Profile Image); Experience Labels (only the editable words: Space, Member, the Home plural, the Lobby's name and description, with the locked words shown read-only); the short Template tab (the default template, **Let a space use its own template**); the template list with the fixed Default template, **Copy**, **Edit** and **Delete** of owners' own templates. The host edits the same pages on the console. One page per setting, not one scroll. `check-admin-load` grown to cover them | experience-design | M | Pages |
| 11b | **The pages that need the later steps.** Modules as the catalog with each module's marks and labels (step 3); Additional Reactions and Icons (7); Phases and their measure (6); the Default Workspace and pins (8); Set up's read-only parts; Profile's theme (7); `check-admin-load` grown again | experience-design | M | Pages |
| 12 | **Existing modules, each in its own lane:** Documents, Budget, To-do (with owners), Maps, Calendar, Research, Polls, Vault, Whiteboard | each module's builder | M to L in all | Module lane |
| 13 | **The Schedule outline.** The module, its views, refs and actions; its `template` marks and labels once step 3 lands | experience-design | L | Module lane; manifest read |
| 14 | **The Goal outline.** As step 13 | experience-design | M to L | Module lane; manifest read |
| 15 | **The shipped templates.** Default, Travel and Games rewritten; Project, Learning and Mentoring new; the versions file | server-development | M | Data, checked by `check-templates` |
| 16 | **QA:** the independent and security reads of steps 1 to 10, the manifest reads of 13 and 14, and the live walk under "Verify" | quality-assurance | M | |
| 17 | **Documentation:** "Doc facts" | content-manager | M | |

Steps 1 to 3 go in order. Steps 9 and 10 can start at once, beside step 1. Step 11a starts as soon as step 1 merges,
beside step 2, because it needs only the new template format and catalog. Steps 4 to 8 run beside each other after 3.
Step 11b follows steps 2 to 8 (each of its pages starts when the step it needs has merged). Step 12 runs beside 11b,
after 3. Steps 13 and 14 start when 9 lands and 11a is merged and seen (see the priority rule) and add their `template`
marks after 3. Step 15 after 12 to 14 have their settings; 16 and 17 last. No question is open, so no step waits on an
answer.

**Priority** (decision 50): steps 1 to 3, then 11a and 11b, have priority over the planners. Steps 13 and 14, the two new
planner modules, do not start until 11a is merged and Thomas has seen it, unless a builder is free. The existing modules
(step 12) run beside 11b.

**Approved order** (decision 48): steps 1 to 3 first, in order, with steps 9 and 10 beside step 1.

## Open questions

None open. Thomas answered all thirteen on 2026-11-15; they are decisions 35 to 47.
