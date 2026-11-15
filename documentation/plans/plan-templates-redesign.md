# Templates Redesign Plan

**Audience:** Thomas decides the open questions at the end; everything under "Decisions" is already his. If he approves,
server-development builds the template format, the resolution per space, the module manifest fields and the checks;
experience-design builds the Manage pages, Set up and the host console pages; each module's change is its own module-lane
build with a version bump. Steps marked **core** touch `server/`, `public/sdk/`, `public/module-host.js`,
`public/module-frame.js`, `tools/`, the stored data format or the module manifest, and are held for an independent read.
quality-assurance reads and walks the result; content-manager documents it after.

**Status:** Draft for Thomas, 2026-11-15, by product-planner. Nothing is built. Every decision below is Thomas's, from
the discussion of 2026-11-15 (four batches of decisions, a correction, and a module-by-module review). The mechanism that
makes a module change with its template is **not** decided: "schema driven" was Thomas's wording of the want, not a
chosen mechanism (his correction). This plan compares the candidates and recommends one (question 1). Timing, in
Thomas's words: "BEFORE THE FREEZE". This moves the freeze; see "What this does to the release".

Thomas, 2026-11-15, the outcome he wants: a template changes what a module is, how it behaves and what it is called, so
a space feels like a trip, a project, a course or a mentoring relationship, without separate code per template. His
four tests: (1) today's travel behaviour is unchanged; (2) a new kind of template is mostly configuration, not code;
(3) a third-party module can take part without widening its own access; (4) people in a space always see the same thing.

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

All facts below were read in the code on `main` at `be5b137d` (2026-11-15). None of it was run. The GitHub issues
(#307, #291, #214, #774, #202, #351, #325, #730) could not be opened from this session (the API is closed to it); their
titles come from `.github/roadmap-board.csv` and their substance from Thomas's notes of 2026-11-15.

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
  on), Set up's Template choice, and `GET /api/spaces/:id/look` (`server/index.js:4628`). That plan's status line still
  says "Nothing is built" (content-manager's to correct). Its decision 1 keeps modules, settings, reactions, icons and
  the theme out of a space's template.

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
  template's, then the environment's template's, then the manifest's. `displayIconIds()` (line 1191) says which icons
  can be drawn.
- **Settings** are declared in each manifest with a `scope` of `environment`, `space` or `person`
  (`server/module-settings.js`). `effective()` (line 140) merges the three scopes over each setting's `default`. A
  template cannot set any module setting today (#291, "Templates seed module settings").
- **Each module's templateable surface today**, from its `module.json`:

| Module (id, version) | Settings today | What Thomas's review asks for |
|---|---|---|
| Planner (`travel`, 0.16.7) | `markers` (list, environment), `suggestFlights` (boolean, environment). Entries are stops, stays, journeys, notes and links; views Days, Decisions, Bookings, Money (`modules/travel/src/CONTRACT.md`); refs kinds `trip` and `plan` | A different plan per template (decision 19) |
| To-do (`todo`, 1.15.30) | `inCalendar` (boolean, environment, default on), with `needsModule: calendar` | Per template; the Calendar switch a template default; a task can link to a Planner goal |
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

**The call, reactions, icons and theme**

- Joining on entry is one environment switch, `autoJoinCall` (`server/store.js:332`). The call's position (Top, Bottom,
  Left, Right of the chat, Floating, In the workspace, Its own window) and the Conference layout's choices are each
  person's own, kept in the browser per space (`columnPref`, `public/space.js:72`). The tile layout (`layout: 'grid'`,
  line 1166) is a browser preference.
- Reactions are one environment list, `settings.reactions`, seeded from the 105 of `server/default-lists.js` and
  edited freely by the owner (Manage > Template > Reactions, `public/admin.html:550`). Icons likewise
  (`settings.icons`, line 562).
- A theme is the environment's (`activeThemeId`, `themeMode`); a template may carry one. Each person already picks
  light or dark for themselves (`public/theme-mode.js`, kept on the account); nobody can pick a theme of their own.

**Workspaces** ([plan-workspaces](plan-workspaces.md), built through steps 1 to 12)

- The Workspace is the one Customizable Workspace; Conference, Calendar, Map, Whiteboards and Documents are Fixed
  Workspaces. The owner sets which show, their order and which opens first (`tabs`, `defaultLayout` on the space); a
  person may hide more for themselves (decision 13). What the Workspace opens with is the space's `opensWith`, set in
  Set up and seeded from the template's `spaceDefaults.opensWith`.
- A Fixed Workspace's switches come from one list in our software (`server/fixed-workspaces.js`).

**Manage and the console**

- Manage's Template tab (`public/admin.html:475` to `572`) is one long page: the template and its switch, the offer,
  files, the space templates switch, Words, module names and icons, Home icon, Reactions and Icons. Theme is its own tab.
- The console's template editor (`public/host.html:337` to `452`, `public/host-templates.js`) is one form of nine parts:
  Basics, Words and verbs, Home icon, Modules, New environments, Phases, Reactions, Theme, Icons.
- `tools/check-admin-load.mjs` (#828) opens every Manage tab at 1280 and 390 pixels and fails on any page error, a
  `console.error` or an API answer of 400 or more.
- Modules appear in five lists that read alike (#774, #202): installed (Manage > Modules), offered by the template, the
  template's names, on in a space, and Opens with.

**Starter content and demo data**

- Nothing creates objects for a new space. The demo loader (`server/demo-loader.js`) fills one marked space from
  `templates/demo/<template id>.json`, writing each module's data in that module's own format, as a signed-in person,
  so every module's own rules run. Only `travel` has a demo file.

## What this replaces

The product is not released, so these are replaced cleanly, with no compatibility layer and no data migration.

- [plan-environment-templates](plan-environment-templates.md): decision 3 ("Defaults, never locks": a driven setting is
  a lock, set by the template), decision 7 (a template's modules on in every space), decision 18 (owners and templates
  change every word but two), and addendum 2 decision 2 (reactions, icon set and theme applied once from a template).
- [plan-space-templates](plan-space-templates.md) decision 1 (a space's template does not change modules, settings,
  reactions or icons).
- [plan-layout-views](plan-layout-views.md) decision 16 (an enabled module is on in every space).
- [plan-workspaces](plan-workspaces.md) decision 13, in part: a person can no longer hide a Fixed Workspace the owner
  turned on (decision 9 below). Renaming and re-icon for oneself stay.
- `CLAUDE.md` (Names) says the word a person reads "can change, per environment template". Decision 5 locks it for
  seven names. The Names section is Thomas's to update; this plan does not edit it.

## Decisions

Thomas, 2026-11-15. Numbered here; the plan cites them as "decision N".

1. **Three tiers.** The environment is the catalog; a template is a lens over it; Manage picks the environment's
   default template and whether a space may use its own (on by default). Reason: one place for what exists, one for how
   it reads and behaves.
2. **What a template does:** renames the labels people may rename, adds reactions and icons on top of a fixed core set,
   offers a subset of the catalog's modules and renames them, sets the default space (read here as what a new space
   starts with) and starter spaces.
3. **A fixed, uneditable Default template.** A real template nobody can edit: the core words, reactions and icons, and
   no extra modules. "Same as the environment" resolves to it when nothing else is chosen, and it is the fallback when a
   template is deleted.
4. **Owners copy and edit their own templates.** Shipped templates stay fixed.
5. **Locked words.** Environment, Canvas, Module, Object, Owner, Moderator, Guest and the canvas-layout button's word
   (the `layout` verb) read the same everywhere. No "game master". Reason (Thomas): the flexibility is not worth it.
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
11. **Phases stay independent of the Planner.** The template defines the set, the space's Set up holds the dates,
    modules read them. A phase set gains a **measure**: `dates`, `goals` or `progress`.
12. **Reactions and icons:** the environment holds the fixed main set, which nobody removes; templates only add; a
    space has none of its own.
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
18. **Before the freeze.** The roadmap board's dates are re-estimated after this plan is sized; they are not changed
    until then.

**Module by module** (Thomas's answers in the review, 2026-11-15):

19. **Planner** adapts per template. Travel: the day-by-day itinerary, as today. Project: a project plan of tasks,
    milestones and owners (draws in To-do and Calendar). Learning: a learning plan of goals, steps and progress, with no
    required dates (reads Research and Documents). Games: a campaign plan of sessions, scenes and story threads (dates
    optional; draws in Maps and Research). Mentoring: a development plan of goals, sessions and progress (reads
    Documents and Research; dates optional).
20. **To-do** per template. Project: the task list the project plan draws from (owners, due dates, status; Calendar
    shows due dates). Learning and Mentoring: exercises and next steps tied to a goal, checked off, optional dates; in
    Mentoring the mentee owns them. Games: the game master's preparation and follow-ups, optional due dates. Travel: as
    today. **Show To-do in the Calendar** is a template default the owner can change. A task may link to a Planner goal
    or milestone in every template.
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

## How a module changes with its template (the mechanism)

Thomas's correction: solve for the outcome. Four candidates, judged against his four tests.

**A. A plan schema in the template, read by the Planner.** The template carries a description of the plan: kinds of
entry and their fields, the measure, the views, labels, links. The Planner becomes an engine that draws any schema.

- Test 1: at risk. Today's itinerary (5,163 lines in `modules/travel/src/*.js`, day-based, with stays across nights,
  journeys, bookings and conflicts) would have to be expressed in, and redrawn from, a general schema.
- Test 2: passes in principle, but any author can write a schema the engine draws badly, and the combinations cannot
  all be tested.
- Test 3: a third-party module would have to learn the core's schema language.
- Test 4: passes.
- Cost: the largest build, for one module. Why not: it moves behaviour into data that template authors write and the
  module must survive.

**B. A separate module per kind of plan** (Itinerary, Project plan, Learning plan, Campaign plan, Development plan).

- Test 1: passes (the Planner is untouched). Test 2: fails, a new kind is a new module. Tests 3 and 4: pass.
- Cost: five codebases of overlapping code; a space that changes template keeps its data in a module it no longer has.
  Why not: it is "separate code per template", which is what Thomas asked to avoid.

**C. Modes the module ships, chosen by the template (suggested).** A module declares a `choice` setting marked
`driven` (for the Planner, `mode`: `itinerary`, `project`, `learning`, `campaign`, `development`). What each mode
means (its kinds of entry, fields, measure, views and labels) is the module's own code and data. The template only picks
a mode, sets other templateable settings and maps declared labels. It is the same mechanism for every module: Budget's
unit is a driven `choice` too, Documents' default editor a `default` one. It answers #307 ("Planner modes").

- Test 1: passes by construction. `itinerary` is today's code path, its views and kinds untouched; the acceptance test
  is that every existing Planner test and the travel demo read the same.
- Test 2: passes for templates. A new kind of template (a wedding, a renovation) picks existing modes, sets units,
  seeds categories, maps labels and adds starter content: configuration only. A new kind of *plan* is a new mode, which
  is work in one module, not in the core.
- Test 3: passes. A third-party module offers modes and labels the same way, through its own manifest. Core reads only
  the `template` marks and `labels`; it never passes a template anything about permissions, uploads, refs or access
  (decision 15).
- Test 4: passes. A driven or seeded value resolves on the server, per space, before any page reads it. Only `person`
  scope settings may differ between people, and the plan allows those only as `default` (a person's view, such as the
  Calendar's month or week), never as what a module is.
- Cost: a manifest change (the marks and labels, core), one resolver, and each module's own modes.

**D. Code supplied by a template** (a template ships scripts a module runs). Rejected outright: it fails test 3 and
puts an owner's code into every member's browser.

**The Planner under C.** Two engines, five modes. The day engine stays for `itinerary`, unchanged. One new outline
engine serves the four other modes: entries with a kind, an optional parent (a goal over its steps), an optional date,
owners, and done or progress. Each mode is a small description the outline engine reads (which kinds, which fields,
which views, which measure), shipped inside the module. The modes:

| Mode | Kinds of entry | Measure | Views | Draws in |
|---|---|---|---|---|
| `itinerary` (Travel) | stop, stay, journey, note, link (today) | dates | Days, Decisions, Bookings, Money (today) | Maps, Budget, Calendar (today) |
| `project` | milestone, task, note | dates | Timeline, List | To-do, Calendar |
| `learning` | goal, step, note | goals | Goals, List | Research, Documents |
| `campaign` (Games) | session, scene, thread | dates, optional | Sessions, Threads | Maps, Research |
| `development` (Mentoring) | goal, session, note | progress | Goals, Sessions | Documents, Research |

Every entry stays the refs kind `plan` (its `name` is already `{name}`), so links, holds, backlinks and the Calendar
mirror keep working in every mode; the builder confirms it in the report or says why not. The head object, kind `trip`,
reads its name from a label. A To-do task links to a goal or a milestone with the existing `linkTask` action: no new
core relation.

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
    "travel": { "name": "Project plan", "icon": "diagram-project", "settings": { "mode": "project" } },
    "todo": { "settings": { "inCalendar": true }, "labels": { "task": { "one": "task", "many": "tasks" } } },
    "budget": { "name": "Effort", "settings": { "unit": "effort" } },
    "documents": {
      "settings": { "defaultEditor": "markdown" },
      "starter": { "doc:brief": { "title": "Project brief", "text": "# Project brief\n\n## Goal\n\n## Who\n\n## When\n" } }
    },
    "calendar": { "labels": { "event": { "one": "meeting", "many": "meetings" } } },
    "chat": {},
    "conference": {}
  },
  "call": { "joinOnEntry": false, "position": "top", "layout": "grid" },
  "workspace": { "opensWith": ["travel", "todo", "chat"], "show": ["calendar", "documents"], "opensFirst": "workspace" },
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
Documents step writes the real one.)

- **`modules`** becomes one object by module id, in display order: `{ name?, icon?, settings?, labels?, starter? }`.
  It replaces `modules` (the list), `moduleNames` and `moduleIcons`. Any other key is refused: "modules.<id>: a
  template sets only name, icon, settings, labels and starter." That sentence is how decision 15 is enforced; there is
  no field through which a template could name a permission, an upload, a ref or an access rule. `chat` must be listed
  (as today).
- **`settings`** inside a module entry: only keys the module's manifest marks `driven` or `default` (below), each
  checked by the module's own setting rules (`cleanValue`, `server/module-settings.js:28`). A key marked own, unknown,
  or of a refused type fails with one sentence naming the module and the key.
- **`labels`** inside a module entry: only keys the manifest declares in `labels`, each `{ one, many, a? }` by the word
  rules of `words.cleanWord`.
- **`starter`**: the module's own data keys and values, written once when a space is made (see "Starter spaces and
  starter content").
- **`words`** takes only `space` and `member` (decision 6). **`home`** (the Home plural) and **`lobby`** are read only
  when the template is the environment's default (decision 6). A template naming a locked word is refused: "words:
  "owner" reads the same everywhere, so a template can't change it."
- **`verbs`**: removed. The `layout` verb is locked (decision 5); the `enter` verb is question 2.
- **`call`**: the three core call settings (decision 16). `joinOnEntry` true or false; `position` one of the column
  positions (`top`, `bottom`, `left`, `right`, `float`, `workspace`, `window`); `layout` one of the call's tile layouts.
  Each is marked by the core (question 6).
- **`workspace`**: the Default Workspace (decision 8): `opensWith` (module ids, at most 20, each in this template's
  `modules`), `show` (the Fixed Workspaces a new space shows, question 5), `opensFirst` (a fixed layout id, default
  `workspace`).
- **`phases`** as today (at most 12), plus **`phaseMeasure`**: `dates` (the default), `goals` or `progress` (decision
  11).
- **`reactions`** and **`iconSet`** are additions only (decision 12): a reaction whose glyph is already in the core set,
  or an icon already in the core list, is refused as a repeat.
- **`theme`**: removed (decision 13). A template file that has it is refused with the unknown-field sentence.
- **`settings`** (the environment-wide allow-list, `SETTINGS` in `server/templates.js`) stays, applied once when an
  environment is made from the template, without the theme keys (`activeThemeId`, `themeMode`).
- **`spaceDefaults`** keeps `profile` only; `opensWith` moves to `workspace`.
- **`starterSpaces`**: at most 5 spaces `{ name, description }`, made once when an environment is made from the template
  (or offered, unticked, on a switch), each using this template.

### The Default template

- Id `default`, name "Default", shipped as `templates/default.json`, `version` 1. Words: none (the defaults). Modules:
  question 3. Reactions and icons: none added. Phases: none. Call: `joinOnEntry` false, `position` `top`, `layout`
  `grid`. No starter spaces or content.
- Nobody can edit, hide or delete it, the host included: `PATCH` answers 403 "The Default template can't be changed;
  copy it to make your own.", `DELETE` 403. It can be copied.
- An environment always has a template: one with none recorded reads `default`. `TEMPLATE=` unset means `default`.

### Owners' own templates (decision 4)

- Stored in `app.json` as `templates: [{ ...template, version, createdAt, updatedAt, copiedFrom: { id, version } }]`, on
  hosted and single installs alike (today only a single install keeps imported templates there).
- **Copy:** `POST /api/environment/templates { from, id, name }` copies any template the owner may choose (shipped, the
  host's, or their own) at version 1. 201 `{ template }`; 409 "There is already a template called <id>."; 400 with the
  problems.
- **Edit:** `PATCH /api/environment/templates/:id`, owner or host admin, the same checks as every template; the version
  goes up. 403 for a shipped or a host template: "Shipped templates stay as they are; copy one to change it."
- **Delete:** `DELETE /api/environment/templates/:id`, allowed while in use (decision 3): spaces that used it read the
  environment's default template; if it was the environment's default, the environment reads `default`. The answer
  lists what moved: `{ spaces: [names], environment: true | false }`. The page confirms first and names them.
- Ids stay unique across every source an environment sees (the rule of addendum 2).
- The host keeps its console templates (`host.json`) and its edits of bundled ones (addendum 3), in the new shape.

### Resolution per space (server-development; core)

One resolver, `store.lookOf(spaceId)`, grown to answer everything a template gives a space: `{ template, words, verbs,
phases, phaseMeasure, modules, labels, settings, call, reactions, icons }`. Every route, page and module reads through
it; no other code reads a template. The rules:

- **Which template:** the space's (`space.template`, while `settings.spaceTemplates` is on and the id exists), else the
  environment's default template, else `default`. The Lobby and Home always read the environment's default template.
  An aside reads its origin space's (as built).
- **Words:** the owner's own words for `space` and `member` (environment-wide, the rule plan-space-templates suggested in
  its question 10), then the template's, then the defaults. Locked keys always read the defaults.
- **Modules on in a space:** `ModuleManager.onInSpace()` takes the space's module set: a module is on when it is enabled
  in the catalog, listed in the space's template's `modules`, and, in the Lobby, allowed there. It is the one check, so
  every route that asks it (data, settings, actions, destinations, widgets, the AI's context) follows at once. A module
  off in a space answers there as a module that is off does today; its data stays, untouched.
- **Module display names and icons:** the owner's own (as today, `settings.moduleNames`), then the template's
  `modules.<id>.name` and `.icon`, then the manifest's.
- **Labels:** the template's `modules.<id>.labels`, then the manifest's own default words.
- **Settings:** see the manifest section below.
- **Reactions and icons:** the core set (`server/default-lists.js`), then the template's additions.
- **Call:** see "Core call settings".

### The module manifest (server-development and experience-design; core, security-sensitive)

Two additions to `module.json`, checked at install (`server/modules.js`) and documented in
[api-modules](../api/api-modules.md):

**1. A `template` mark on a setting:** `"template": "driven"` or `"template": "default"`. Absent means own.

- Allowed on `boolean`, `choice`, `number`, `text`, `color` and `list` settings, in any scope, with one rule: a
  `person` setting may be `default` only (a person's own view), never `driven`.
- Refused on `secret`, `file`, `files`, `url` and `note`, with "module.json: setting "<key>" is a <type>, so a template
  can't set it." Reason: a template must never set a key, a file, or an outside address a module would contact.
- **Driven:** while the space's template gives a value, that value applies and the setting is read-only: the forms show
  it with "Set by the <template name> template." A write of it answers 409 "<label> is set by the <template name>
  template." When the template gives none, the setting behaves as own.
- **Default:** the template's value replaces the manifest's `default`. A stored value at the setting's scope wins
  (question 4 for the environment scope). The form marks it "From the template" with **Reset**, as words are marked
  today.
- `ModuleSettings#effective(manifest, { spaceId, userKey, template })` takes the template layer (the resolved
  `modules.<id>.settings`), so `GET /api/modules/:id/settings/values` and the SDK's `host.settings.get()` answer the
  resolved values. `GET /api/module-settings/:scope` adds, per setting, `template: "driven" | "default" | null`,
  `templateValue` and `locked`.

**2. `labels`:** up to 20 renameable words a module shows, each `"<key>": { "one", "many", "a"? }` (keys lowercase
letters, digits and dashes, starting with a letter, up to 30 characters). The module reads them from
`host.locale().labels` (resolved for the space) and through `host.util.label(key, { many, cap, a })`, the twin of
`host.util.word`. A label is a word a person reads, held by `check-names --words` like any other. Manifest text
(setting labels, action labels) keeps the default words in version 1.

**3. `starter: true`** (optional): the module accepts starter content (see below).

Example: Documents' default editor, a `default` choice. A person's own choice in the browser still wins.

```json
{
  "key": "defaultEditor",
  "label": "Documents open in",
  "type": "choice",
  "scope": "space",
  "template": "default",
  "default": "markdown",
  "options": [
    { "value": "markdown", "label": "The Markdown box" },
    { "value": "rich", "label": "The page as it will look" }
  ],
  "help": "What a person gets when they edit. Anyone can still switch for themselves."
}
```

Example: Budget's unit (`driven`) and splitting (`default`, shown only with money):

```json
[
  { "key": "unit", "label": "Counts", "type": "choice", "scope": "space", "template": "driven", "default": "money",
    "options": [ { "value": "money", "label": "Money" }, { "value": "hours", "label": "Hours" }, { "value": "effort", "label": "Effort points" } ] },
  { "key": "split", "label": "Who owes whom", "type": "boolean", "scope": "space", "template": "default", "default": true,
    "showWhen": { "key": "unit", "value": "money" } }
]
```

with `"labels": { "cost": { "one": "cost", "many": "costs" } }`, which Project could map to "entry" and Learning to
"session".

**What core never passes a template** (decision 15): permissions, access, guards, uploads, refs, actions, hooks,
events, destinations, secrets and files. A template's module entry has no field for any of them, and the resolver copies
only `name`, `icon`, `settings` (filtered by the marks), `labels` (filtered by the declared keys) and `starter` (only for
a module that opts in). A third-party module therefore gains nothing it did not declare and the owner did not approve.

### Core call settings (server-development, then experience-design; core)

- A space record gains `call: { joinOnEntry?, position?, layout? }`; a missing key means the template's. The
  environment's `autoJoinCall` is removed (replaced, unreleased).
- The marks are the core's (question 6). `PATCH /api/spaces/:id { call }`: owners, the admin and moderators (as
  `defaultLayout`). 400 with a sentence for an unknown position or layout.
- **The browser's prompt** (decision 16): joining on entry joins with the microphone and camera off, as joining does
  today ("You join with your camera off"), so entering asks for nothing until the person turns one on. Where a browser
  will not start sound without a tap (a space page reloaded with no tap, on an iPhone or iPad), the page shows **Join the
  call** instead of joining by itself, and says why once. This cannot be checked without a real call.

### Starter spaces and starter content (server-development; core, security-sensitive)

- **Where it lives:** in the template: `starterSpaces` (whole spaces, for a new environment) and
  `modules.<id>.starter` (objects, for a new space). Starter content is in the module's own data format, the same block
  the demo loader writes (`server/demo-loader.js`): `{ "<key>": <value> }`.
- **Who may receive it:** only a module whose manifest says `"starter": true`. A template naming any other module's
  starter is refused by the check. Bundled modules opt in as each module's step lands (Documents first).
- **When:** once, when a space is made (`POST /api/spaces`, Home's Add, a starter space), after the space exists, as the
  person who made it, through the same path and checks as `PUT /api/modules/:id/data/:key` (the module's guards, limits
  and scope; space scope only). The space records `starterDone: true` whether or not every write passed, so it is never
  tried again. A write that fails is logged and skipped; the space is still made.
- **Never** on a change of template, a restore, or a demo load. Changing back and forth creates nothing.
- **Limits:** at most 20 keys per module and 64 KB of starter content per template.
- The alternative, each module writing its own starter on its first open, is in question 11.

### Phases and their measure (server-development, then experience-design; core)

- `dates`: as today; the space's Set up holds each phase's dates.
- `progress`: Set up shows a **Done** switch per phase, stored as `space.phases.<id>.done`; the current phase is the
  first not done.
- `goals`: how a phase counts its goals is question 7.
- `host.phases()` gains `measure` and each phase's `done`. The phase chip reads "<phase> · 2 of 4" for `progress` and
  `goals`, and the date as today for `dates`.

### Reactions, icons and theme (server-development, then experience-design; core)

- `settings.reactions` and `settings.icons` stop being the owner's lists. The core set is read from
  `server/default-lists.js`; additions come from the space's template. `allowReactions` stays the environment's switch.
  Manage's Reactions and Icons panels move to the template's Additional Reactions and Icons page.
- The theme: the environment's default stays (`activeThemeId`, `themeMode`). Each person gains a theme on their account
  (`theme: <theme id> | null`, null for the environment's), chosen in Profile among the environment's themes; light and
  dark stay as today. A theme that is deleted reads as the environment's default.

### Workspaces (server-development, then experience-design; core)

- **The Default Workspace** (decision 8): a space's Workspace opens with its template's `workspace.opensWith`. Set up's
  **Opens with** becomes read-only, naming the template ("From the Project template"). The space's own `opensWith` key
  is removed.
- **The pin rule** (decision 9): a Fixed Workspace the owner shows (`tabs`) is shown for everyone. A person's own hide
  of it is refused (409 "The owner keeps this one in the bar.") and a stored hide is ignored. Renaming and re-icon for
  oneself stay. People still save and favorite layouts of their own.
- A new space's `tabs` start from the template's `workspace.show` and `opensFirst` (question 5).

### What happens to an existing space when its template changes

Shown before the change, in the confirm: "Change this {space} to Project? Its words, {modules} and how they work change
now. Nothing is deleted.", then the modules that turn off and on.

| Part | After the change |
|---|---|
| Words, labels, module names and icons, phases, added reactions and icons | Follow the new template at once |
| Modules | The new template's set is on; a module that leaves the set turns off here and keeps its data; it comes back with its data if a template brings it back |
| Driven settings | Follow at once (the Planner's mode, Budget's unit) |
| Default settings | A value someone stored is kept; otherwise the new template's |
| Planner entries | All kept. Entries of a kind the new mode lacks are listed together under "From another plan", never deleted; changing back shows them as before |
| Budget entries | Each entry keeps the unit it was written in; totals count the current unit only; the rest are listed under "In another unit" |
| Phase dates | Kept; ids the new template lacks are ignored and dropped from a save (as built) |
| Default Workspace | The new template's on the next entry; each person's remembered arrangement and last layout are kept and fall through as today when a module is gone |
| Starter content | Never created on a change |
| Call settings | A value someone stored is kept; otherwise the new template's |

When a template **is edited** (the host's or an owner's own), every space using it follows on the next read, as above.

### Pages (experience-design)

- **Manage's Template tab** becomes a short page: the environment's default template (the choice and the offer), **Let
  {a space} use its own template**, and the templates this environment may use, each with **Open**, **Copy** and, for
  the owner's own, **Delete**. Opening one goes to its pages, each at its own address (`/admin#template/<id>/basics`
  and so on), with a jump list (a strip on a phone):
  - **Environment Basics:** name, description, Home icon, the default profile pictures ("New spaces use").
  - **Experience Labels:** Space and Member; then each module's renameable labels; then, for the environment's default
    template, the Home plural and the Lobby's name and description (question 9). Only words people see; the locked
    words are not listed.
  - **Default Workspace:** what the Workspace opens with, and which Fixed Workspaces a new space shows.
  - **Phases:** the list and the measure.
  - **Additional Reactions and Icons:** the core set, read-only, then the template's additions.
  - **Modules:** one row per catalog module: whether this template offers it, its display name and icon, its driven and
    default settings, and its starter content (keep or remove only, in version 1).
  - A shipped template's pages are read-only, with **Copy to change it**.
- **Manage > Modules** is the catalog only: installed, enabled, and the module's own settings. The template's names and
  the per-space lists leave it (#774, #202).
- **Theme** tab: the environment's themes and default; no template part.
- **Set up** in a space: the Template choice (as built); the Modules tab lists the modules the template gives, with no
  on and off switches, driven settings read-only and default ones editable; Opens with read-only; the call's three
  settings.
- **Profile:** the theme choice.
- **The host console:** the same pages for the host's templates and its edits of bundled ones (question 8).
- Words people read are plain and short; every colour comes from the theme tokens; menus use `host.menu.show`.

### SDK (both; core)

- `host.locale().labels` and `host.util.label(key, { many, cap, a })`.
- `host.settings.get()` answers values with the template layer (no change of shape).
- `host.phases()` gains `measure` and each phase's `done`.
- No template id or name reaches a module (the conduit rule, plan-environment-templates decision 12).

### Module changes (module lane, each with its own version bump)

| Module | Change |
|---|---|
| Planner (`travel`) | `mode` (driven choice, space scope, default `itinerary`); the outline engine and the four other modes; labels; the head object's name from a label; a test that `itinerary` reads the same as before |
| Budget | `unit` (driven) and `split` (default, money only); categories marked default; each entry keeps its unit; labels |
| Documents | `defaultEditor` (default; Markdown in every shipped template at release, #687); `starter: true`; labels |
| To-do | `inCalendar` marked default; labels |
| Maps | `categories` marked default; real map and picture map switches (driven booleans); the Place label |
| Calendar | `defaultView` marked default; labels |
| Research | `tags` marked default; labels |
| Polls, Vault, Whiteboard | labels; Polls' `addableByDefault` and the Vault's limits marked default |
| Stream, AI Assistant | none |

The Calendar destination and the To-do panel in it live at the environment's level: there, a setting resolves with the
environment's default template.

### The shipped templates (server-development; files in `templates/`)

- **Default** (new); **Travel** rewritten in the new shape with no change of behaviour (`itinerary`, `money`, today's
  settings and modules); **Games** rewritten (its environment, owner and aside words removed; Planner `campaign`; Maps
  with picture maps; starter session notes and a handout); **Project**, **Learning** and **Mentoring** new, from
  decisions 19 to 26. `tools/template-versions.json` records each.

## Behaviour by role and surface

| Who and where | What they see and do |
|---|---|
| **Admin (host)** | Everything an owner can, in every environment. On the console, the host's templates and its edits of bundled ones, on the same pages. Cannot edit Default |
| **Owner** | Chooses the environment's default template and whether spaces may choose their own; copies any template, edits and deletes their own; chooses a space's template in Set up and in Add; changes default-marked settings |
| **Moderator** | Sees the space's template named; changes the space's default-marked space settings and its call settings; cannot choose a template or change a driven setting |
| **Member** | Reads the space through its template; picks their own theme, call position and views; cannot hide a Fixed Workspace the owner shows |
| **Guest** | Reads the space through its template, as a member does; no Set up, no Manage, no theme choice (the environment's) |
| **Home** | The environment's default template: its words, Home plural and icon, and Home's modules |
| **The Lobby** | The environment's default template, under the Lobby rule (only modules that declare the Lobby) |
| **An aside** | Its origin space's words; no modules; the core reactions plus the origin's additions |
| **The call** | Joins on entry when the space says so; position and layout from the space, then the person's own choice |

## Asides and the Lobby

- An aside has no template; it reads its origin's words and reactions (as built for words). It has no modules, so the
  module set does not apply.
- The Lobby reads the environment's default template: its Lobby name and description, its reactions, and only the
  modules that template lists and the Lobby allows. A template never puts a module in the Lobby that does not declare it
  (the rule of [plan-modules](plan-modules.md), #63).

## Phones

- Every Manage template page is its own page, the jump list a strip, at 390 pixels with no sideways scroll; on the
  Modules page each module's settings fold under its row.
- Set up's read-only parts read as plain lines, not as disabled controls.
- The Planner's outline views work at 390 pixels with the existing view switch; the narrow layout's module tabs follow
  the space's module set.
- Joining on entry on an iPhone or iPad follows the tap rule above. Not checkable without a real device.

## Guests

- A guest reads the space's labels, modules and settings as a member does: the same thing for everyone (test 4).
- A template never changes who may enter, the guest door, guest links or what guests may see (`guestsSeeHidden`): that
  is access, and decision 15 keeps it out.
- A module off in a space by its template is off for a guest there too.

## Verify

- **Checked by a tool:** the template shape and every refusal; the Default template's refusals; an owner's copy, edit
  and delete with the fallback; resolution per space for words, modules, labels, settings, reactions and call settings;
  the manifest marks and their install refusals; driven writes refused; starter content written once and never again;
  the phase measure; the pin rule; a module off by template answering as off on its data route.
- **Verified live** on a local server with a throwaway `DATA_DIR`: one environment with a Travel, a Project, a Learning,
  a Games and a Mentoring space; each space's modules, words and Planner mode; a Travel space against the previous build,
  page by page (test 1); a template change and back; an owner's copy edited and deleted; every Manage template page at
  1280 and 390 pixels, light and dark; a guest link into a Project space; a hosted second environment never reading the
  first's templates.
- **Not checkable here:** joining on entry and the browser's prompts, the call's position and layout in a real call,
  and the tap rule on an iPhone or iPad. They join the release's real-call list (plan-release decision 16).

## Tests and checks to add

- `tools/check-templates.mjs`: the new shape; module entries limited to name, icon, settings, labels and starter;
  settings only where the manifest marks them; labels only where declared; starter only for modules that opt in;
  locked words refused; reactions and icons as additions only; `phaseMeasure`; `theme` refused; the Default template's
  refusals; every shipped template valid against the real manifests.
- `tools/check-template-lens.mjs` (new): the resolver for a space, the Lobby and an aside; the module set through
  `onInSpace`; driven, default and own; a template change and every row of the change list above; delete with its
  fallback; a hosted second environment.
- `tools/check-modules.mjs`: the `template` mark, `labels` and `starter` at install, with each refusal.
- `tools/check-starter.mjs` (new): once only, never on a change, as the creator, through the data route's checks, the
  size limits, a failed write skipped, a module without `"starter": true` refused.
- `tools/check-admin-load.mjs`: opens every new template page (`#template/<id>/<page>`) for a shipped and an owner's
  template, the Profile theme choice and the console's template pages, at 1280 and 390, failing on any page error. A
  smoke check for every Manage page is the lesson of #828.
- `tools/check-layouts.mjs`: the pin rule. `tools/check-phases.mjs`: the measure. `tools/check-canvas.mjs`: joining on
  entry from the space's setting.
- `tools/check-names.mjs --words`: labels held like words; no locked word in a template.
- Module tests in `modules/<id>/test/`: the Planner's `itinerary` reads the travel demo exactly as before, each mode's
  kinds, a mode change keeps every entry; Budget's unit and split; Documents' default editor under a person's own
  choice.

## Risks, ranked

1. **The Planner changes under travel.** The largest module, and test 1. Mitigation: `itinerary` is today's code path;
   the new modes are a second engine beside it; the travel demo and every Planner test must read the same.
2. **The freeze slips further than sized.** This touches every part of templates and every module. Mitigation: the
   order below lands every format, field and route first, and question 10 lets Thomas move the new Planner modes if the
   date matters more.
3. **A module off in a space still answering there** (data, actions, widgets, the AI's context). It would show data the
   template meant to leave out. Mitigation: `onInSpace` is already the one check; the new check walks every route that
   asks it; an independent read.
4. **A third-party module widened by a template.** Mitigation: a module entry in a template has five keys and no
   others; refused setting types; an independent read of the manifest change.
5. **Different people seeing different things** (test 4): a code path that resolves per environment, not per space.
   Mitigation: one resolver; a check that reads every value for two spaces with two templates.
6. **Starter writes by the server:** a double creation, or a write that skips the module's rules. Mitigation: the data
   route's own path, `starterDone`, the opt-in, the limits.
7. **Joining on entry** surprises people or fails on phones. Mitigation: microphone and camera off, the tap rule, the
   real-call list.
8. **A template change turns modules off** that people were using. Mitigation: the confirm names them; data is kept and
   comes back.
9. **A blank Manage page** after the Template tab is split (#828). Mitigation: `check-admin-load` opens every page.
10. **Owners lose free editing of reactions and icons.** By design (decision 12); test data may be reset.

## Rollback and off switch

- **Off switch for space templates** (built): `settings.spaceTemplates` off makes every space read the environment's
  default template at once.
- **The safe floor:** the Default template (with question 3's suggestion, every catalog module) behaves as an
  environment does today.
- **Each step** is its own commit and reverts alone. The product is not released and test data may be reset, so there
  is no data rollback to plan.

## Not in version 1

- Writing new starter content in Manage (an owner's copy may keep or remove the template's starter content only).
- Labels inside manifest text (setting and action labels keep their default words).
- Stream border styles per template.
- A template for an aside, or words an owner types for one space.
- A mark on Home's list of spaces or in the switcher naming the template.
- The call as a module (plan-release decision 7); the call settings move when it becomes one.
- A schema language for plans (candidate A), and modes contributed from outside a module.

## What this does to the release

- [plan-release](plan-release.md)'s freeze stops new features, routes, stored keys, manifest fields, SDK calls and
  changes to a stored format. This plan adds all of them (the template shape, the manifest's `template`, `labels` and
  `starter`, `host.util.label`, `space.call`, owners' templates, `starterDone`), so it lands before the freeze starts,
  as Thomas decided.
- **The freeze date moves.** The roadmap board (`.github/roadmap-board.csv`) puts every "1 Before the freeze" row at
  2026-11-16 to 2026-11-25, so the freeze would start about 2026-11-26. With this plan it cannot start before about
  **2026-12-14 to 2026-12-21** at the board's fast pace (the estimate below). The phases after it ("3 Before the first
  customer", "4 Real-call tests") move by the same three to four weeks. The board is re-estimated after Thomas answers
  questions 1 and 10; until then its dates stand, as decided.
- **The "verified" bar** (plan-release decision 16) gains joining on entry, and the call's position and layout set by a
  template, in the real two-person call on each of the four devices. A Travel space is also walked against the previous
  build (test 1) before the freeze.
- **The per-module done lists** (plan-release step 4) are best written after this plan's module contract is agreed,
  because each module's "done" now includes its templateable settings, labels and modes.

## Doc facts

What content-manager documents once each step lands:

- [architecture-environments](../architecture/architecture-environments.md) ("Templates"): the three tiers, the new
  shape, the Default template, owners' own templates, resolution per space, the fallback on delete.
- [architecture-modules](../architecture/architecture-modules.md) and [api-modules](../api/api-modules.md): the
  `template` mark, `labels`, `starter: true`, what a template can never set, the module set per space.
- [api-module-sdk](../api/api-module-sdk.md): `host.locale().labels`, `host.util.label`, the measure in `host.phases()`.
- [architecture-overview](../architecture/architecture-overview.md) ("Words"): the locked words.
- User guides: templates (the pages, copying, deleting), spaces (Set up), environment settings (the Template tab,
  Modules as the catalog), Profile (theme), the call (joining on entry), the Planner (modes), Budget (unit), Documents
  (starter documents, the default editor).
- Status lines: [plan-space-templates](plan-space-templates.md) says "Nothing is built" though steps 1 to 3 are built;
  it, plan-environment-templates, plan-layout-views and plan-workspaces each get a pointer to "What this replaces".
- For Thomas: the Names section of `CLAUDE.md` says the word a person reads changes per template; decision 5 locks
  seven names. It also still lacks Customizable Workspace and Fixed Workspace (plan-workspaces decision 33).

## Left to build, in order

Sizes: S under a day, M a day or two, L several days. **Core** steps are held for an independent read;
**security-sensitive** ones also get a security read.

| Step | What | Agent | Size | Kind |
|---|---|---|---|---|
| 1 | **The template format and catalog.** The new shape, the Default template, locked words, owners' own templates (copy, edit, delete with the fallback), the console's and Manage's routes, `check-templates` | server-development | L | Core |
| 2 | **The resolver.** `lookOf` grown; `onInSpace` with the space's module set; names, labels, reactions and icons per space; `check-template-lens` | server-development | M | Core, security-sensitive |
| 3 | **The manifest marks and labels.** `template`, `labels` and `starter` at install; the settings layer; driven writes refused; the forms' marks; `host.locale().labels` and `host.util.label` | server-development, then experience-design for the forms | L | Core, security-sensitive |
| 4 | **Core call settings.** `space.call`, joining on entry with the tap rule, position and layout seeds | server-development, then experience-design | M | Core |
| 5 | **Starter spaces and content.** `starterSpaces`, the once-only write, `check-starter` | server-development | M | Core, security-sensitive |
| 6 | **The phases' measure.** `phaseMeasure`, `done`, the chip, `host.phases()` | server-development, then experience-design | M | Core |
| 7 | **Reactions, icons and theme.** The core set plus additions; the person's theme | server-development, then experience-design | M | Core |
| 8 | **Workspaces.** The Default Workspace from the template, Opens with read-only, the pin rule | server-development, then experience-design | S | Core |
| 9 | **The Manage pages and the console's.** The short Template tab, the six template pages, Modules as the catalog, Set up's read-only parts, Profile's theme; `check-admin-load` for every page | experience-design | L | Pages |
| 10 | **Modules, each in its own lane:** Documents, Budget, To-do, Maps, Calendar, Research, Polls, Vault, Whiteboard | each module's builder | M to L in all | Module lane |
| 11 | **The Planner's modes.** `mode`, the outline engine, `project`, `learning`, `campaign`, `development`; `itinerary` unchanged and tested | experience-design | L, then L | Module lane |
| 12 | **The shipped templates.** Default, Travel and Games rewritten; Project, Learning and Mentoring new; the versions file | server-development | M | Data, checked by `check-templates` |
| 13 | **QA:** the independent and security reads of steps 1 to 8, and the live walk under "Verify" | quality-assurance | M | |
| 14 | **Documentation:** "Doc facts" | content-manager | M | |

Steps 1 to 3 go in order; 4 to 8 can run beside each other after 3; 9, 10 and 11 after 3; 12 after 10 and 11 have their
settings; 13 and 14 last. Steps 1, 2, 3, 5, 9 and 11 wait on the questions marked "blocks".

**Size estimate.** About 45 builder-days: the core steps 1 to 8 about 17, the pages about 5, the modules about 8, the
Planner about 10, the templates 2, QA and documents about 4. With two or three builders at once and the core reads in
series, three to four weeks of calendar time.

## Open questions for Thomas

My suggestion is first in each. "Blocks" names the step that waits for the answer.

**1. How a module changes with its template. Blocks steps 3 and 11.**
- **Suggested: C, modes a module ships, chosen through a driven setting**, with the Planner's five modes on two
  engines. It passes all four tests and is one mechanism for every module.
- A, a plan schema in the template: one Planner engine for any plan, but the largest build, test 1 at risk, and authors
  can write plans the engine draws badly.
- B, a module per kind of plan: no risk to travel, but five codebases and a new module for every new kind.

**2. The `aside` word and the `enter` verb. Blocks step 1.** Neither is on the locked or the editable list.
- **Suggested: lock both.** One word everywhere is the reason for decision 5; "whisper" for an aside is the same kind of
  flexibility as "game master".
- Keep both editable: Games keeps "whisper", at the cost of one more word that differs.

**3. Which modules the Default template offers. Blocks steps 1 and 2.**
- **Suggested: every module in the catalog.** An environment that never picks a template then works exactly as today,
  and the Default template is the safe floor.
- Only the chat and the call: a truly bare baseline, but every environment without a template loses its modules.

**4. An owner's change to a setting a template seeds, at the environment's scope. Blocks step 3.**
- **Suggested: the owner's own value wins in every space, as their own words do today.** To differ by kind of space,
  the owner copies the template and changes it there. One rule for words, names and settings.
- The owner's change is kept per template ("for every Project space"): more precise, but a second place where values
  live, beside the template copy.

**5. Does the template seed which Fixed Workspaces a new space shows? Does not block.**
- **Suggested: yes, as a default the owner changes in Set up.** A Games space then starts with Conference shown.
- No: every new space shows them all, as today.

**6. The marks of the three call settings. Does not block step 4's server half.**
- **Suggested: all three default.** The template seeds joining on entry, the position and the layout; the owner or a
  moderator may change joining for the space; a person's own position and layout win once picked.
- Joining on entry driven: a Games space always joins, and no owner can turn it off without copying the template.

**7. How a phase measured by goals counts them. Blocks the `goals` part of step 6.**
- **Suggested: a phase is done when every object that names it is done.** A module names the phase on its objects
  through its refs summary (a `phase` field beside `done`); the Planner's goals do. A phase with none falls back to a
  **Done** switch.
- The owner ticks each phase done, as with `progress`: nothing to build in modules, but goals and phases never meet.

**8. Where the host edits templates. Blocks step 9.**
- **Suggested: the same pages in both places.** Manage shows the owner's templates; the console shows the host's, with
  the same six pages and one code.
- Keep the console's one form and build Manage's pages beside it: two editors to keep in step.

**9. Two points of wording. Does not block.**
- The Lobby's words: Thomas's notes put them on Experience Labels; the brief for this plan put them on Environment
  Basics. **Suggested: Experience Labels**, with the other words.
- Travel calls the Vault "Documents", which is also a module's name. **Suggested: "Files".**

**10. What may follow the release if the date matters more. Does not block the build; blocks the board's new dates.**
- **Suggested: nothing.** All of it before the freeze, as decided, with the freeze about 2026-12-14 to 2026-12-21.
- Every format, field, route and SDK call before the freeze; the Planner's `learning`, `campaign` and `development`
  modes, which change only the Planner's own code, after the release. Saves about a week.

**11. Who writes starter content. Blocks step 5.**
- **Suggested: the server, once, when the space is made**, through the data route's own checks, as the person who made
  it, for modules that opt in. It happens exactly once and does not depend on anyone opening the module.
- Each module writes its own on its first open: no server writes, but it needs someone who may write to open it, and
  two people opening it at once must not both write.
