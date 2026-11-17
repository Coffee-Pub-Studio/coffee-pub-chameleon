# Templates Redesign Plan

**Audience:** Thomas has decided everything under "Decisions", including questions A to E of the 2026-11-16 correction
(decisions 53 to 66); one reading and the known issues are under "Open questions". server-development builds the
template format, the resolution per space, the module manifest fields, the shared outline pieces of the SDK and the
checks; experience-design builds the Manage pages, Set up, the host console pages and the two
new planner modules; each existing module's change is its own module-lane build with a version bump. Steps marked
**core** touch `server/`, `public/sdk/`, `public/module-host.js`, `public/module-frame.js`, `tools/`, the stored data
format or a manifest's permissions, uploads or refs, and are held for an independent read. quality-assurance reads and
walks the result; content-manager documents it after.

**Status:** Approved for build as a production build (Thomas, 2026-11-15, decision 48); decisions complete, none open.
Amended 2026-11-15 (decision 50): the pages come first. Step 11 is split into 11a and 11b, and the planners wait for 11a.
Built, as of 2026-11-15 (read from `git log origin/main` and the code): steps 1 to 10 (#838 to #847, #836, #837), 11a and
11b (#838, #851), 12 (#850), 13 (#858), 14 (#859), 15 (#853) and 15b (#860) are merged. Step 16, QA, is closed (updated 2026-11-16). The
documentation of batches 9 and 10 landed (#861 and after). Several things differ from this plan or are not built; each is under "Built
differently than planned", marked **Divergence called out**.
**Corrected 2026-11-16** (Thomas, GitHub issues #920 and #921; see decision 12 and decision 52): the core reactions and
icons belong to the environment, as a whole list its owner edits, starting from today's built-in 105 reactions and 113
icons; a template only adds to it. The built state (an owner adds on top of a fixed set held in code) is wrong and is
rebuilt by steps 18 to 23. The host console's template editor becomes tabs, one part per screen (decision 52, step 22).
Thomas answered the correction's questions A to D on 2026-11-16 (decisions 53 to 56), each as recommended, and gave his
own answer to E (decision 57), which is decided on one stated reading. Decisions 58 to 66 record what the build and QA of
steps 18 to 23 added. **As of 2026-11-17:** steps 18 to 22 are built and independently read (the server read once plus one
fix round, the pages and the call page twice, and a short read of the presence route, the Save bar and the list refusals);
step 23's QA is done as described under decision 66; the documentation is being written. Nothing is merged to `main` or
pushed: the work is on branch `step22b` of the build container.
Revised 2026-11-15 by product-planner. The first draft (#831) suggested
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
| **Environment** | The catalog: the modules available, the environment's own list of reactions and of icons (the whole list, which the owner edits, starting from the built-in set; corrected 2026-11-16, decision 12), the default theme, the environment's default template | The owner, in Manage |
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
| Documents (`documents`, 0.11.33) | `coediting` (boolean, environment; on by default since 0.11.33, Thomas 2026-11-17). The Markdown box or the rich editor is each person's own choice, kept in the browser (`documents-rich`, `modules/documents/src/documents.js:849`) | Starter documents, labels, the default editor |
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
- *Updated 2026-11-16 (read at `65d1473f`):* as built by step 7, the 105 reactions and 113 icons are a fixed set in code
  (`server/default-lists.js`, "Every environment and every space has all of them and nothing removes one").
  `settings.reactions` and `settings.icons` hold only the owner's additions: `ownReactions()` and `ownIcons()`
  (`server/store.js`) drop anything that repeats the built-in set, at load and on every save. `lookOf()` reads the
  built-in set, then the owner's additions, then the template's; `allIcons()` does the same for icons. Manage >
  Environment > Reactions and Icons (`public/admin.html`, `public/admin.js` `renderFixed`) shows the built-in set read
  only, folded as **Built in (<n>)**, and edits only the additions. `server/templates.js` refuses a template addition
  that repeats the built-in set ("is in the core set already; a template only adds"). Decision 12's correction replaces
  all of this.
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
- *Corrected 2026-11-16 (decision 52):* the console's template editor becomes tabs. Its nine parts (Environment Basics,
  Experience Labels, Modules, Default Workspace, Call, Phases, Reactions, Icons, Starter spaces) are each one screen,
  chosen from a row of tabs, with one **Save template** for the whole template; the same pattern as Manage's tabs, two
  levels of navigation (the console's sections, then the template's parts), not three. As built at `65d1473f` it is one
  long form with a jump list (`#te-jump`) that scrolls to each part. The template list and the console's top list do not
  change.
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
2. **What a template does:** renames the labels people may rename, adds reactions and icons on top of the environment's
   own lists (corrected 2026-11-16; this said "a fixed core set", see decision 12),
   offers a subset of the catalog's modules and renames them, sets the default space (read here as what a new space
   starts with) and starter spaces.
3. **A fixed, uneditable Default template.** A real template nobody can edit: the core words, and no reactions or icons
   of its own, so it reads the environment's lists as they are (corrected 2026-11-16; this said "the core words,
   reactions and icons").
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
12. **Reactions and icons belong to the environment; a template only adds** (Thomas, corrected 2026-11-16, GitHub
    issues #920 and #921). The environment holds the whole list of reactions and the whole list of icons. Its owner
    edits each list in full under Manage > Environment > Reactions and Icons: add, remove and reorder. A new
    environment's lists start as today's built-in 105 reactions and 113 icons (`server/default-lists.js`); from then on
    they are the environment's, not code's. A template can only add to them, never remove. A space has none of its own.
    The template pages say, for both reactions and icons, that what the template lists is "added on top of the
    environment's set". Reason (Thomas): the core set was always meant to move to the environment level and be the
    owner's to edit; it was never meant to live only in code.

    **Correction, 2026-11-16.** The text this decision carried until now was wrong, kept here struck for the record:

    ~~Reactions and icons: the environment level owns the owner's own reactions and icons for every template (Manage >
    Environment > Reactions and Icons, merged as #852); a template only adds; a space has none of its own. Manage >
    Template > Additional Reactions and Icons shows only the template's additions (Thomas, 2026-11-15).~~ Its divergence
    note of 2026-11-15 said the same: the owner's additions on the Environment page, after a fixed main set.

    Why it was wrong: the plan recorded "built-in set fixed" because Thomas's clickable answer "built-in set: fixed" was
    taken as agreement to a fixed set held in code, which contradicted what he had said repeatedly, that the set belongs
    to the environment and its owner edits it. What was built from it (step 7, #844, #852, #901) holds the 105 reactions
    and 113 icons in code, lets the owner only add after them, and refuses a template addition that repeats one. Steps 18
    to 23 rebuild it; see "Built differently than planned", item 32.
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
    **Divergence called out (2026-11-16):** Thomas named it "Planner - Itinerary" instead (2026-11-15; his "Travel" was a typo, corrected). The name "Planner - Travel" is not used; the manifest says "Planner - Itinerary".
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
52. **The host console's template editor is tabs** (Thomas, 2026-11-16, with the correction under decision 12). It stops
    being one long form. Its nine parts (Environment Basics, Experience Labels, Modules, Default Workspace, Call, Phases,
    Reactions, Icons, Starter spaces) are real tabs, one part per screen, with one **Save template** for the whole
    template. It is the same pattern as Manage's tabs: two levels of navigation (the console's sections, then the
    template's parts), not three. The template list and the console's top list do not change.
53. **An owner may remove any entry that came from the built-in set** (Thomas, 2026-11-16, by clickable answer; was
    question A). Once copied, the list is the environment's, and decision 12 says the owner edits the whole list. The
    cost, accepted: an owner can remove Heart or Thumbs up, and the keys 1 to 6 follow whatever is first.
54. **One way back to the built-in lists** (Thomas, 2026-11-16, by clickable answer; was question B): a single **Start
    again from the built-in set** button under both lists, with a confirm, replacing both lists. It is the only way
    back after a removal.
55. **A template's addition that repeats an entry in the environment's list is dropped where the lists are joined**
    (Thomas, 2026-11-16, by clickable answer; was question C). A template's save is never refused for it, because a
    template is written once and read by many environments whose lists differ.
56. **What the template pages show of the environment's set** (Thomas, 2026-11-16, by clickable answer; was question
    D): the environment's current lists, read only and folded, so the author sees what the template adds to. On the
    host console, which belongs to no environment, the built-in lists, labelled as what an environment's set starts as.
57. **The additions owners saved under the old rule** (Thomas, 2026-11-16, typed in the answer box; was question E). The box offered "refill
    from the built-in set, drop old additions (no migration)" or "keep old additions after the built-ins (one-time
    rewrite)". Thomas picked neither and wrote: "you need to get me a list of existing I can migrate." **Reading
    (product-planner's, not confirmed by Thomas):** the code carries nothing over, as `CLAUDE.md` says (no data
    migration); a list of each environment's stored additions is produced for him before the change reaches his server,
    and he adds again by hand what he wants. If he meant a code migration, he will say so, and step 18 changes. See
    "Open questions".
58. **The caps of 300 reactions and 400 icons on an environment's lists stay** (Thomas, 2026-11-16, by clickable
    answer; this answers the cap question). The build added them (`MAX_ENV_REACTIONS` and `MAX_ENV_ICONS`,
    `server/store.js`): a save over a cap is refused, and a stored list is cut to it. A template's caps are 40 and 60, as
    before.
59. **The signed-out `/api/branding` may list the bare ids of the icons in use** (Thomas, 2026-11-16, by clickable
    answer). An icon someone chose privately for a layout or a module becomes visible by its id, with no name, person or
    space. Solid Font Awesome Free icons only, at most 200 (`MAX_IN_USE_ICONS`).
60. **The Environment page's long lists are folded** (Thomas, 2026-11-16 and 2026-11-17, by clickable answer): Reactions
    open, Icons shut; rows compact; each list in a scroll box; the Save bar stays on screen.
61. **A template addition the environment's set already has is marked on the template page** (Thomas, 2026-11-16, by
    clickable answer): "Already in the environment's set, not added again." Manage only; the console has no
    environment.
62. **The call's reaction button hides when the list is empty** (Thomas, 2026-11-16, by clickable answer).
63. **The call's tray, the chat emoji list and the keys 1 to 6 read the space's own resolved list** (Thomas, 2026-11-17,
    by clickable answer). This was a defect on `main`, found by QA: they read only the environment's list.
64. **The OBS and stream views read the space's resolved list** (Thomas, 2026-11-17, by clickable answer): presence takes
    `?space=`, `host.presence.get` takes an optional `{ space }`, Stream 0.1.16.
65. **Icons repeat only by id** (Thomas, 2026-11-16, by clickable answer; the plan as written). A repeat that draws under
    another id is not dropped.
66. **The plan's two QA rounds were extended by one fix round** (Thomas, yes, 2026-11-17). It fixed: F1 the console
    could not add a reaction, F2 the Save bar hid keyboard focus, F3 focus after a console save, F6 the dropped-addition
    note, F8 a list of which nothing can be read, F4 and F5 the OBS views.

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
- **`reactions`** and **`iconSet`** are additions only (decision 12): added on top of the environment's lists, never
  removing from them. *Corrected 2026-11-16:* this said "a repeat of the core set is refused". The built-in set is now
  only the starting content of an environment's lists, so a template's save is checked for its own shape and its own
  repeats only; an addition that repeats an entry of the environment's list is dropped where the lists are joined
  (decision 55).
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
- **Reactions and icons:** the environment's own list, then the template's additions, with any repeat of an entry
  before it dropped (a reaction by id or by glyph, an icon by id). *Corrected 2026-11-16:* this said "the core set
  (`server/default-lists.js`), then the template's additions"; `server/default-lists.js` is now only what a new
  environment's lists start as (decision 12).

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

- *Corrected 2026-11-16 (decision 12).* The environment's lists are its own, held in its settings, the whole list and
  in its order; `server/default-lists.js` is only what a new environment's lists start as. Additions come from the
  space's template, after the environment's list. `allowReactions` stays the environment's switch. The owner edits the
  whole lists on Manage > Environment > Reactions and Icons and they apply to every template; Manage > Template >
  Additional Reactions and Icons edits only the template's additions. The contract for the rebuild is under "The
  correction of 2026-11-16: the environment's reactions and icons" below.
- This item said, until the correction: "The core set is read from `server/default-lists.js`; additions come from the
  space's template", with the owner's own on the Environment page after it. That is what is built, and it is wrong.
- The environment's default theme stays. Each person gains `theme: <theme id> | null` on their account, chosen in
  Profile among the environment's themes; light and dark stay as today.

### The correction of 2026-11-16: the environment's reactions and icons (server-development, then experience-design; core)

Decision 12 as corrected. Where a rule below rests on one of Thomas's answers to the correction's questions, it names the decision (53 to 57).

**Server** (server-development; core):

- **What the environment holds.** `settings.reactions` is the environment's whole reaction list, `{ id, glyph, label }`
  in order; `settings.icons` its whole icon list, `{ id, classes, label }` in order. Nothing in them is an "addition"
  any more, and nothing is taken out of them for repeating `server/default-lists.js`: `ownReactions()` and `ownIcons()`
  stop filtering against the built-in set, at load and on save. The lists are cleaned for shape as today
  (`cleanReactions()`, `cleanIcons()`), with repeats inside a list dropped.
- **The built-in lists are starting content only.** `server/default-lists.js` keeps the 105 reactions and 113 icons as
  they are, read in two places only: when an environment's lists are first filled, and for **Start again from the
  built-in set** (decision 54). Its header comment says so instead of "nothing removes one".
- **A new environment** (a single-environment install's first start, or a hosted environment made by the host) copies
  the built-in lists into its settings when its store is made.
- **An existing environment whose lists were never filled from the built-in set** reads as not yet edited, and gets the
  built-in lists, once, when its store loads, as themes are seeded today. How "filled" is marked is the builder's (a
  flag such as `homeIconChoiceSeeded` is today). What the old rule stored there, the owner's additions only, is not
  carried over: the product is not released, there is no data migration, and test data may be reset (`CLAUDE.md`).
  Thomas adds them again by hand if he wants them (decision 57, on its stated reading; a list of what was stored is
  produced for him first).
- **A save** (`PATCH` of the environment's settings with `reactions` or `icons`) stores the list as sent, in its order,
  cleaned for shape. Removing an entry that came from the built-in set is allowed (decision 53). An empty
  reaction list is stored as empty; `allowReactions` stays the switch that turns reactions off.
- **Resolution** (`lookOf()`, `allIcons()`, `iconIdsFor()`, `spaceIconIds()`, `displayIconIds()`): the environment's
  list first, in its order, then the template's additions (`reactions`; for icons `iconSet`, its home icon and its
  modules' icons, as `templateIconIds()` reads today), with any entry that repeats one before it dropped (a reaction by
  id or by glyph, an icon by id). No step reads `server/default-lists.js`. The first six reactions of the resolved
  list are the call's keys 1 to 6, so reordering or removing the first six changes the keys.
- **A template's save** (`server/templates.js`): `reactions` and `iconSet` keep their caps (40 and 60), their shape
  rules and the refusal of a repeat inside the template's own list. The refusal of a repeat of the built-in set
  (`CORE_REACTIONS`, `CORE_ICONS`, "is in the core set already; a template only adds.") is removed: a template does
  not know which environment will read it, so a repeat is dropped where the lists are joined instead (decision 55).
- **Branding and the look:** `/api/branding` and a space's `/look` answer `reactions` and `icons` from the resolution
  above, in the same shape as today, so the pages, the call's tray, the OBS views, chat and every icon picker read
  them unchanged.
- **Icons in use** (`inUseIcons`, `inUseIconIds()`): an owner may now remove an icon that is in use. Nothing stored
  changes when they do; the icon stays drawn wherever it is used and is not offered in any picker again, nor taken by a
  new save (the rule today). `inUseIconIds()` covers the home icon and each space's link icon today; it must grow to
  every stored choice that can name a removed icon (a module's display icon, saved layouts' and system layouts' icons),
  so nothing in use stops drawing. server-development confirms the full list when building.
- **The owner's settings answer** (`ownerSettings()`, `server/index.js`): `ownReactions` and `ownIcons` answer the
  environment's whole lists. It also answers the built-in lists (for example `builtIn: { reactions, icons }`) so the
  page can offer **Start again from the built-in set** without a new route; the field's name is the builder's.

**Pages** (experience-design):

- **Manage > Environment > Reactions and Icons** edits the whole lists. Hint: "Yours, for this whole {environment} and
  every template. A template can add to them, never take one away." The folded **Built in (<n>)**, "You have added none
  yet." and "is already built in" go. Reactions: every row editable (emoji and label), **Remove**, a way to reorder
  that reuses a list pattern Manage already has, **Add reaction**, **Save**; the hint keeps "The first six are keys 1 to
  6." Icons: the same rows, with the pasted HTML and its preview as today. Below both, **Start again from the built-in
  set** with a confirm (decision 54): "Replace your reactions and icons with the built-in set? Your changes to
  them are lost." Words follow the Names section; colours come from the theme tokens.
- **Manage > Template > Additional Reactions and Icons** and **the console's Reactions and Icons tabs** edit only the
  template's additions, and say for both lists: "Added on top of the {environment}'s set." (the console, which has no
  environment, says "Added on top of an environment's set."). The console's Icons text today lacks it. "The core set"
  heading, its "Always there, in every template. Nobody removes them." and "On top of the core set" go.
- **What a template page shows of the environment's set** (decision 56): the environment's current lists, read
  only, folded, headed "The {environment}'s set (<n>)". The console, which edits templates for every environment,
  shows the built-in lists instead, headed "An environment's set starts as these (<n>)".

### The console's template editor as tabs (experience-design; pages)

Decision 52.

- The editor (`#template-editor`, `public/host.html`; `public/host-templates.js`) shows one part at a time. The row
  `#te-jump` becomes real tabs (the console's `subtabs` pattern, as Manage's), one per part: Environment Basics,
  Experience Labels, Modules, Default Workspace, Call, Phases, Reactions, Icons, Starter spaces. Choosing one shows
  that part and hides the others; nothing scrolls to it.
- Each tab has its own address, as Manage's template pages do (for example `#templates/<id>/<part>`); opening a
  template with no part shows Environment Basics. Back and forward move between tabs.
- One **Save template** and one **Cancel** for the whole template, in the editor's head, on every tab. Switching tabs
  keeps what was typed (it is still one form). A save sends every part.
- A problem the server answers is shown in its part's list (`data-problems`, as today) and its tab is marked, so a
  problem on a tab not shown is still seen; the save's status line says how many parts have problems.
- On a phone (390 pixels), the tabs are a strip that scrolls sideways, as Manage's are, with no sideways scroll of the
  page.
- The template list (`#templates`) and the console's top list do not change.

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
  - **Additional Reactions and Icons:** only the template's additions, each list headed "added on top of the
    environment's set" (for reactions and for icons alike). The environment's own lists are on Manage > Environment >
    Reactions and Icons, where its owner edits them whole (decision 12, corrected 2026-11-16).
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
  Its template editor is tabs, one part per screen, with one **Save template** (decision 52).
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
- **What steps 15 and 15b shipped:** Travel, Games, Project, Learning and Mentoring, each in the new shape (step 15, #853),
  and then their planners (step 15b, #860). Project and Games list the Schedule outline (`schedule`); Games names it
  "Campaign" (decision 42), with `milestone` reading "session", `work` "scene" and `tag` "story thread". Learning and
  Mentoring list the Goal outline (`goals`). Travel keeps `travel`. Each template's Vault is named Vault (decision 51).
  The interim `travel` planner step 15 gave Games is gone. Games' starter tags, and the words, names and seeded
  categories of Project, Learning and Mentoring, were chosen by the builder; see "Built differently than planned".

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
| **An aside** | Its origin space's words; no modules; the environment's reactions plus the origin's template's additions |
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
- **The correction (steps 18 to 22), checked by a tool:** `check-reactions-icons` on a real server with a throwaway
  `DATA_DIR`: a new environment's `/api/branding` reads the 105 and 113 in order; an owner's save that removes a
  built-in reaction and a built-in icon, reorders and adds, is read back exactly, in `/api/branding`, a space's `/look`
  and the owner's settings; the first six of the new order are the keys; an empty reaction list is kept; a template's
  additions come after the environment's list, a repeat of an entry in it dropped and the template's save not refused;
  **Start again from the built-in set** restores the 105 and 113; a removed icon still in use (home icon, a link icon, a
  module's display icon, a layout's icon) is drawn from `inUseIcons`, never offered, and a new pick of it refused; a
  hosted second environment's lists are its own. `check-host-console`: each tab opens at its address and shows only its
  part, one save sends every part, a problem on a hidden tab marks that tab; at 1280 and 390.
- **The correction, verified live** on a local server: the Environment page's lists edited, reordered, emptied and
  started again, in light and dark, at 1280 and 390; the console's template editor tab by tab with one save.
- **The correction, not checkable here:** the call's reaction tray in a new order, and keys 1 to 6 after a reorder, in a
  real call. There is no LiveKit server here; they join the real-call list.
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
- The correction of 2026-11-16 (steps 18 to 22): `tools/check-reactions-icons.mjs`, `check-defaults`,
  `check-template-lens`, `check-templates`, `check-template-switch`, `check-environment-isolation`,
  `check-template-pages-b`, `check-admin-load` and `check-host-console` change, as step 19, step 21, step 22 and
  "Verify" say.
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

## Built differently than planned

Recorded 2026-11-15 from the content manager's reading of the code on main (steps 1 to 15b merged), and matched to
`documentation/known-issues.md` and `documentation/TODO.md`. Nothing here changes a decision. Each item is a
**Divergence called out**: what the plan said, what is built, and, where the choice is Thomas's, **Thomas decides**.
None was seen in a browser by product-planner.

### Core and pages

1. **Divergence called out: the Outline's keys.** The plan said (the SDK table, `host.ui.outline`) that the keyboard
   moves an entry with Tab and Shift+Tab to indent and outdent. Built: Alt+Up, Alt+Down, Alt+Right and Alt+Left (Tab
   and Shift+Tab are left to move focus). Thomas decides whether the keys stay.
2. **Divergence called out: the Planner's catalog name.** Decision 45 and the module table say `modules/travel` is
   named "Planner - Travel" (a words-only patch bump). Built: its manifest still says "Planner" at 0.16.7. Thomas
   decides when it is renamed; the rename is not done. *Updated 2026-11-16: done, as "Planner - Itinerary" (item 28).*
3. **Divergence called out: the change-of-template confirm.** "What happens to an existing space when its template
   changes" wanted the confirm to name the modules that turn off and on and to say the old planner keeps its plan
   (decision 31, risk 6). Built: "Its words, phases and <module> names change now. Nothing is removed." Nothing is
   lost; the confirm is short. Thomas decides whether the longer confirm is built.
4. **Divergence called out: settings the templates are meant to drive that do not exist.** Step 12 and the module table
   listed Budget's `unit` (driven) and `split` (default), To-do's `owners` (with `host.ui.peoplePicker`), Documents'
   `defaultEditor`, and Maps' real map and picture map switches. Built: none of them (Budget 0.1.26, To-do 1.15.31,
   Documents 0.11.32, Maps 0.10.4). Project's "Effort", Learning's and Mentoring's "Time" and Games' maps are names and
   categories only. Thomas decides whether they are built and when.
5. **Divergence called out: labels declared and not read.** The plan said each module reads its labels through
   `host.util.label`. Built: Maps (`place`), Research (`note`) and Whiteboard (`board`) declare theirs and their pages
   do not read them, so a template renaming one changes nothing there. Thomas decides whether they are wired.
6. **Divergence called out: the host console.** Decision 39 said the host edits templates on the same pages as Manage.
   Built: the console edits one form with a jump list; it cannot edit a module's settings, labels or starter content
   (they are kept as they are), and its starter space name box takes 60 characters where the server refuses over 40.
   Thomas decides whether the console gets the Manage pages.
7. **Divergence called out: no Manage page for a template's call settings or starter spaces.** The pages table listed
   them. Built: an owner's copy keeps those of the template it was copied from, and the host console edits them.
   Thomas decides whether Manage gets the pages.
8. **Divergence called out: "Driven in N spaces" is not built.** The plan's "Pages" wanted a module's page to show how
   many spaces a driven setting reaches. Built: nothing; the console's **Used by** counts environments and spaces
   only. Thomas decides whether it is built.
9. **Divergence called out: planners accept no drop of an object.** The plan's refs and actions said an add action per
   kind so a drop, Chat and the AI Assistant can add to a planner, as the Itinerary's `addStop`. Built: the add actions
   exist; neither new planner takes a drop of an object from another module (links are made in the entry's form).
   Thomas decides whether drops are built.
10. **Divergence called out: starter writes skip the data route's rate limit.** Decision 41 and the starter contract
    said the server writes starter content through the data route's own checks. Built: every check except the
    per-person rate limit (`putModuleValue` is below it); the 20 keys and 64 KB caps and the once-only rule are the
    bound. Thomas decides whether the limit applies.
11. **Divergence called out: `templateValue` and `templateName`.** The plan said `GET /api/module-settings/:scope` adds
    `template`, `templateValue` and `locked` per setting. Built: `templateValue` (and `templateName`, which is not in
    the plan) is present only while the template gives a value for that setting. Thomas decides whether the shape
    stays.

### Planner - Projects (`schedule`, the Schedule outline)

12. **Divergence called out: a milestone's day is stored in `start`, with no `end`.** The plan's kinds said a milestone
    has "a date". Built: one day in `start`; work has `start` and `end`.
13. **Divergence called out: notes stay off the Timeline.** The plan's Timeline drew work, milestones and "waits on"
    lines and put undated entries in "Not scheduled". Built: notes appear in the List only. Thomas decides.
14. **Divergence called out: the add actions refuse with a sentence** when `datesRequired` is on and a day is missing,
    where the plan only said dates are needed. Thomas decides whether that stays.
15. **Divergence called out: day limits.** Not in the plan: a day is from 1900 to 2200, and at most 104 weeks are drawn on
    the Timeline. Thomas decides whether the limits stay.
16. **Divergence called out: no phase bands on the Timeline.** Not built, and no drag on the Timeline. Thomas decides.

### Planner - Goals (`goals`, the Goal outline)

17. **Divergence called out: object links added.** The plan had To-do tasks, Documents, Research and Calendar sessions
    link to a goal or a step from their own side. Built: the goal's own form also has **Link something**. Thomas
    decides whether it stays.
18. **Divergence called out: `shownDate`.** Not in the plan: a stored field, so that no dates reach the Calendar
    while the `dates` setting is off.
19. **Divergence called out: `defaultView` is per person.** The plan marked it `default` (an owner's or a template's
    value, the person's own choice winning). Built: it is each person's own setting. Thomas decides.
20. **Divergence called out: the kind words are fixed.** The plan listed `goal`, `step`, `note` and `owner` as labels a
    template may rename (Mentoring's `owner` reads "mentee"). The content manager found the kind words fixed in the
    module; the manifest declares the four labels, and product-planner did not trace where the pages ignore them.
    Thomas decides.
21. **Divergence called out: two caps.** Not in the plan: 500 loose entries, and 200 writes per load. Thomas decides.

### The shipped templates

22. **Divergence called out: words chosen by the builder.** Games' starter tags, and the words, names and seeded
    categories of Project, Learning and Mentoring, were chosen by the builder and wait for Thomas's review. Thomas
    decides each.

### Added 2026-11-16 (read from `git log origin/main` at `a19d7d34`)

Each is a **Divergence called out**; none changes a decision unless it says so.

23. **Divergence called out: module labels moved, list settings as rows (#881).** Module words and labels moved to
    Manage > Experience Labels, and a module's list settings are edited as rows on the Modules page. This is what the
    plan's Pages section said. A verbs row is absent because locked rows hold no verbs.
24. **Divergence called out: the host console still cannot edit module words or labels.** The server's
    shipped-module list for the console carries no labels, so the console cannot show them. It has no **Remove demo**
    and no demo picker yet (see [plan-demo-space](plan-demo-space.md)). This adds to item 6.
25. **Divergence called out: Additional Reactions and Icons keeps the read-only core grid** (Thomas, 2026-11-15).
    This departs from the note under decision 12, which said the page shows only the template's additions.
    *Superseded in part, 2026-11-16:* the grid it shows is the built-in set from code; after the correction it shows the
    environment's current lists, read only (decision 56), see item 32.
26. **Divergence called out: `inUseIcons`.** Not in the plan: the resolver's look also carries the icons in use (the
    home icon and each space's link icon) that the lists do not hold, for drawing only; no picker offers them.
    Template icons are never copied into the owner's own lists.
27. **Divergence called out: five demos, and demo marks.** Not in the plan: one demo for each template (Travel,
    Games, Project, Learning, Mentoring), each space made from one carrying a stored demo mark. See
    [plan-demo-space](plan-demo-space.md).
28. **Divergence called out: the Planner's name is "Planner - Itinerary".** It replaces decision 45's "Planner -
    Travel" (Thomas, 2026-11-15, who corrected his own typo). This supersedes item 2, which said the rename was not
    done and used the old name.
29. **Divergence called out: the Vault is Vault everywhere** (decision 51, built in #855). Decision 40's "Files" for
    Travel's Vault is not used, as the notes under decisions 40 and 51 record.
30. **Divergence called out: the starter-space offer on a switch** (Thomas chose "build the offer", 2026-11-15, #889).
    The confirm now requires `offerId` and `version`; starter spaces are picked by index, once per offer; a single
    space's own template offers nothing; and starter writes skip the per-person rate limit, as in item 10. See
    [plan-environment-templates](plan-environment-templates.md). The hidden-character and icon rules of the objects
    format are not for this plan.

31. **Progress note: the built-in set is shown on the Environment page (#901, 2026-11-16).** Manage > Environment >
    Reactions and Icons now shows the built-in reactions and icons read only, folded as **Built in (<n>)**, with "You
    have added none yet." while the owner's own list is empty; a save that repeats a built-in leaves it out and says
    "<emoji> is already built in" (icons, by label or name: "<a>, <b> are already built in"); and the Template page's
    Additional Reactions and Icons text links to it. This belongs with decision 12's divergence: the owner's own
    reactions and icons live on the Environment page, and a template only adds.
    *Superseded 2026-11-16:* built on the wrong reading of decision 12. The folded **Built in (<n>)**, "You have added
    none yet." and "is already built in" go when the Environment page edits the whole lists (step 20); see item 32.

### Added 2026-11-16: the correction

32. **Divergence called out: the core reactions and icons were built fixed in code; they belong to the environment**
    (Thomas, 2026-11-16, GitHub issues #920 and #921; decision 12 as corrected). The plan said the environment holds the
    reactions and icons; it then recorded "built-in set fixed", and step 7 (#844, #852) and #901 built that reading:
    `server/default-lists.js` holds 105 reactions and 113 icons that "nothing removes"; `settings.reactions` and
    `settings.icons` keep only the owner's additions (`ownReactions()`, `ownIcons()`, `server/store.js`, which drop
    any repeat of the built-in set at load and on save); `lookOf()` and `allIcons()` read the built-in set first;
    `server/templates.js` refuses a template addition that repeats it; Manage > Environment shows it folded and read
    only; the Template page and the console say "Added to the core set". What Thomas wants: the environment owner edits
    the whole list (add, remove, reorder), starting from the built-in set as its first content; a template only adds;
    the template pages say "added on top of the environment's set" for both reactions and icons (the console's Icons
    text, "added to an environment's icon list", and the Manage page's lack it today). Steps 18 to 23 rebuild it. This
    one is not Thomas's to decide again: it is a defect against his decision.

### Added 2026-11-17: steps 18 to 23 as built (read from `git diff origin/main..step22b`, head `d4d6875`)

Each is a **Divergence called out**; none changes a decision. Read from the code, not from a browser or a call.

33. **Divergence called out: caps** (decision 58). The plan gave none. `server/store.js` has `MAX_ENV_REACTIONS = 300` and
    `MAX_ENV_ICONS = 400`; `updateSettings` refuses a longer list, and `ownReactions` and `ownIcons` cut a stored one.
34. **Divergence called out: the 256 KB limit is for `PATCH /api/settings` only.** `server/index.js` gives that route its
    own `settingsJson` (`limit: '256kb'`), placed after `requireOwner`, and the general `jsonBody` (64 KB) skips it, so
    only an owner's request is read to that size. The reason in the code: both lists at their caps are about 95 KB.
35. **Divergence called out: `resetLists: true`** is a settings action beside `builtIn`. `updateSettings` replaces both
    lists with `server/default-lists.js` and refuses it sent together with `reactions` or `icons`. The owner's `GET
    /api/settings` and the console's `GET /api/host/settings` carry `builtIn: { reactions, icons }`.
36. **Divergence called out: refusals answer 400.** In `updateSettings`: a `reactions` or `icons` that is not a list; a
    non-empty reactions list of which nothing can be read ("None of those reactions could be read."); a non-empty icons
    list with no entry that is an object; and an icon whose classes name no Font Awesome icon (only a style or size),
    refused by its place ("Icon 3 names no Font Awesome icon..."). An empty list is kept: the owner may have none. The
    same save also clears the module frame's inline-icon cache (`iconSvgs`).
37. **Divergence called out: an icon in use stays drawn.** The owner's module display icon, when the owner has since
    removed it from the environment's list, is still drawn if it is a Font Awesome Free solid icon (`lookOf`, the `ownIcon`
    test). `inUseIconIds` also reads every module display icon (`settings.moduleIcons`) and every saved and system
    layout's icon, besides the home icon and each space's link icon.
38. **Divergence called out: a cache for the layouts' icon ids.** `Layouts#iconIds` (`server/layouts.js`) is remembered
    until the next change, because the signed-out `/api/branding` reads it on every call.
39. **Divergence called out: unsafe characters.** The environment's lists strip them on save and at load (`cleanGlyph`,
    `cleanListLabel`; a glyph keeps the zero-width joiner and the variation selectors that emoji are built from, a label
    keeps neither). A template's text refuses them instead (`plainText` in `server/templates.js`, a glyph again allowed
    the joiner). The two differ on purpose: a list that was stored earlier must still load, so load cleans as save does.
40. **Divergence called out: the lists are filled once.** `Store#load` fills `settings.reactions` and `settings.icons`
    from the built-in lists when `builtinListsSeeded` is not true, then sets it (it is in the environment export's
    settings fields). What an older environment stored there is not carried over (decision 57). After that, nothing
    reads `server/default-lists.js` except **Start again**.
41. **Divergence called out: the Environment page has two Saves.** `public/admin.html`: **Save reactions** and **Save
    icons** in one sticky bar (`.save-bar`, `public/style.css`), because the page saves the two lists in two requests,
    each with its own status line. **Start again from the built-in set** sits above both lists, not below them, with its
    confirm. Each list is a fold with a count (`Reactions (n)`, `Icons (n)`), Reactions open and Icons shut, in a scroll
    box of at most 70% of the screen height. A row's buttons are icon buttons that name the row for a screen reader ("Move
    Heart earlier"), and a moved or removed row leaves the focus on a button.
42. **Divergence called out: the template pages have one fold under each list**, not one for both. On Manage it is "the
    <environment>'s set (n)" (`setFoldHtml`, `public/template-pages.js`); on the console it is "An environment's set starts
    as these (n)" from `builtIn`. The sentence under each list is "Added on top of <whose>'s set." A row whose addition
    the set already has shows the note (`markDup`), by id or emoji for a reaction and by name for an icon.
43. **Divergence called out: the host console's editor tabs reuse the console's own tab strip** (`.subtabs`, now
    `role="tablist"`, with arrow, Home and End keys). Each tab has its address, `#templates/<id>/<part>`; a count badge
    (`.sdk-tab-badge[data-problems]`) marks a tab whose part has problems, and **Save template** reports "n parts have
    problems, marked on their tabs". An unknown part opens Environment Basics and leaves the address as typed
    (`selectPart`). The same template with another part changes only the tab, so what was typed stays. The console's new
    reaction rows get an id from their label, else their emoji, else a random one (F1).
44. **Divergence called out: the console has no dropped-addition note** (decision 61 is Manage only): `markDup` runs only in
    `additionsHtml`, which the console does not use.
45. **Divergence called out: the presence route and the SDK.** `GET /api/presence?space=<id>` answers the reactions that
    space reads, only for a space the viewer may enter (all spaces for the access key); the Lobby, an unknown space and no
    space keep the environment's list. `host.presence.get({ space })` passes it on (`public/sdk/host.js`,
    `public/module-host.js`, which keeps the guest token).
46. **Divergence called out: how the Stream module reads it.** `modules/stream/src/stream-keyed.js` (0.1.16) asks for the
    list of the space its box shows (`imageSpace`; the Lobby reads the environment's), keeps ids in a `Map` so an id such
    as "toString" is none, and when the request fails asks again at the next presence change.
47. **Divergence called out: the call page.** `public/space.js` draws the environment's list first and the space's own
    resolved list once its look is known; the reaction button, the tray and the keys 1 to 6 follow the same list, and an
    empty list hides the button and closes the tray (decisions 62 and 63). `public/brand.js` tells "the list is not read
    yet" from "the list is empty" (`ICONS_LOADED`), so an empty icon list draws the link icon.
48. **Divergence called out: new check files** beyond the ones step 19 named: `tools/check-reaction-tray.mjs` and
    `tools/check-obs-reactions.mjs`; `check-reactions-icons`, `check-defaults`, `check-templates`, `check-template-lens`,
    `check-template-pages-b`, `check-host-console` and others were rewritten or grown.
49. **Divergence called out: a third fix round** (decision 66), beyond the two QA rounds.

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
| 7 | **Reactions, icons and theme.** The core set plus additions; the person's theme (the reactions and icons part is rebuilt by step 18, decision 12 corrected) | server-development, then experience-design | M | Core |
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
| 18 | **The environment's lists, server** (decision 12 corrected). The whole lists in `settings.reactions` and `settings.icons`; the built-in lists as a new environment's content and, once, an existing one's; saves keep the whole list; resolution: the environment's list, then the template's additions, repeats dropped; the template save's refusal of a built-in repeat removed; `inUseIconIds()` grown to every stored icon choice; the built-in lists in the owner's settings answer | server-development | M | Core |
| 19 | **The checks for step 18.** `check-reactions-icons` rewritten (as under "Verify"); `check-defaults` (the built-in lists as starting content, not fixed); `check-template-lens` (resolution from the environment's list); `check-templates` (the "core set" refusal cases become cases that pass); `check-template-switch` (the order it reads); `check-environment-isolation` (a second environment's lists start from the built-in set and stay its own) | server-development | M | Core (tools) |
| 20 | **Manage > Environment > Reactions and Icons** edits the whole lists: rows, remove, reorder, **Start again from the built-in set**; the built-in fold and its sentences gone | experience-design | M | Pages |
| 21 | **The template pages' words and read-only set.** Manage's Additional Reactions and Icons and the console's Reactions and Icons: "Added on top of the {environment}'s set." for both; the environment's set read only and folded (the console: the built-in lists); `check-template-pages-b` and `check-admin-load` follow | experience-design | S | Pages |
| 22 | **The console's template editor as tabs** (decision 52): one part per screen, its own address, one **Save template**, problems marked on their tab; `check-host-console` grown | experience-design | M | Pages |
| 23 | **QA** of steps 18 to 22: the independent read of 18 and 19, the walk under "Verify" for the correction | quality-assurance | S | |

Steps 1 to 3 go in order. Steps 9 and 10 can start at once, beside step 1. Step 11a starts as soon as step 1 merges,
beside step 2, because it needs only the new template format and catalog. Steps 4 to 8 run beside each other after 3.
Step 11b follows steps 2 to 8 (each of its pages starts when the step it needs has merged). Step 12 runs beside 11b,
after 3. Steps 13 and 14 start when 9 lands and 11a is merged and seen (see the priority rule) and add their `template`
marks after 3. Step 15 after 12 to 14 have their settings; 16 and 17 last. Steps 18 to 23, the correction of
2026-11-16, are ordered under "The correction's order" below.

**Priority** (decision 50): steps 1 to 3, then 11a and 11b, have priority over the planners. Steps 13 and 14, the two new
planner modules, do not start until 11a is merged and Thomas has seen it, unless a builder is free. The existing modules
(step 12) run beside 11b.

**Approved order** (decision 48): steps 1 to 3 first, in order, with steps 9 and 10 beside step 1.

**The correction's order** (2026-11-16): step 18 first, with 19 in the same change (the checks must agree with the
rule). Steps 20 and 21 follow 18. Step 22 does not depend on 18 and can start at once, beside it; it touches the same
console Reactions and Icons parts as 21, so 21's console text lands after 22 or in the same change. Step 23 last, then
content-manager updates the guides (the environment settings guide's Reactions and Icons, the templates guide's
Additional Reactions and Icons and the console's editor) and the architecture's templates section. Questions A to
E are decided (decisions 53 to 57). **State (2026-11-17):** steps 18 to 22 are built and independently read, and step 23's
QA is done; the documentation (the environment settings guide, the templates guide, the console's editor, the
architecture's templates section) is being written; nothing is merged or pushed. Before step 18 reaches Thomas's server, the stored
additions of each environment are listed for him (decision 57); the list is a task for server-development beside step
18, read from each environment's `settings.reactions` and `settings.icons` as they are now, and it changes no data.

## Open questions

Thomas answered the first draft's thirteen on 2026-11-15 (decisions 35 to 47). The correction of 2026-11-16 raised
questions A to E; he answered them the same day (decisions 53 to 57), and the cap question by decision 58. What is left:

- **E, the one open reading.** Thomas's answer to E is his own words, not either offered choice: "you need to get me a
  list of existing I can migrate." This plan reads it as: the code migrates nothing; a list of each environment's stored
  additions is produced for him before the change reaches his server, and he re-adds what he wants by hand. If he
  meant that the code should carry the old additions over (the built-in lists followed by the old additions, a
  one-time rewrite of stored data), the no-migration rule in `CLAUDE.md` needs his word to allow it, and the code, which
  now drops them, changes. Not confirmed. The built code follows the reading above.
- **Known issues the documents list** (not built; none blocks the merge): a console reaction row with an emoji and no
  label cannot be saved; a new reaction whose label matches a built-in id is silently dropped as a repeat; the stream
  view does not retry a failed list request until presence changes; an icon that draws the same under another id is not
  dropped (decision 65).
- **Not verified:** a real call, reactions over the data channel, the keys 1 to 6 in a live call and a real OBS source.
  The build container has no LiveKit server.

Where this plan differs from what Thomas said: nowhere for A to D and 58 to 65. For E it records his words and adds the
reading above, which is ours. The third fix round (decision 66) is recorded as his yes.

**Where the steps stand (2026-11-15):** merged: 1 and 11a (#838), 2 and 3 (#840), 4 (#846), 5 (#845), 6 (#843), 7 (#844,
#852), 8 (#847), 9 (#837), 10 (#836), 11b (#851), 12 (#850), 13 (#858), 14 (#859), 15 (#853) and 15b (#860). Also merged
after the plan: Vault in every template (#855), the phase id fix (#856). Step 16, QA: closed (2026-11-16). Step 17, the
documentation of batches 9 and 10: landed (#861 and after), with the gaps under "Built differently than planned" recorded in
`documentation/known-issues.md`.

**The correction (2026-11-16):** as of 2026-11-17, steps 18 to 22 are built and independently read, and step 23's QA is done (the server read once plus one fix round, the pages and call page twice, a short read of the presence route, the Save bar and the list refusals). The documentation is being written. Nothing is merged to `main` or pushed; the work is on branch `step22b` of the build container. Questions A to D are decided (decisions 53 to 56); E is decided on a stated reading that Thomas has not yet confirmed (decision 57, "Open questions").
