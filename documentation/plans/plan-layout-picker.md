# Layout Picker Plan

**Audience:** Thomas decides. If he approves, server-development builds the shape list, the stored shapes (in templates and in shared layouts), the maker's notice data and the checks. experience-design builds the picker, placing a shape on the canvas, and the picker's two entry points: the template editors and a space's Layouts. This is a core change (`server/`, `public/`, `tools/` and the stored data format), so each core step is held for an independent read, and the full `npm run check` covers it at release prep. content-manager documents it afterwards.

**Status:** Draft for Thomas, 2026-11-18, by product-planner. Step 1 is built and independently read (commits `3694ab37`, `c5bebda8`, `fd946e56`). Step 2 is built and independently read (commits `044d8954`, `d6af7f2d`, `7a1b4753`). Steps 3 to 7 are not built. It comes from Thomas's sketch of six layouts and his answers on 2026-11-18 (four rounds, plus a further decision on telling a layout's maker), recorded under "Decisions". Everything else here is a suggestion until he answers. The idea, in short: a visual way to set a layout in two steps. (1) Pick a layout shape. (2) Map modules to its areas. The chat and call column on the left stays fixed and can't be mapped.

**What was read.** `CLAUDE.md`; [plan-workspaces](plan-workspaces.md) (the decisions, the contract and the draft section "Draft: shared and personal workspaces"); [plan-layout-views](plan-layout-views.md); [plan-templates-redesign](plan-templates-redesign.md) (the head, "What it is today", decisions 1 to 12, the template's stored form, "Workspaces", "What happens to an existing space when its template changes" and "What this does to the release"); [plan-release](plan-release.md) (the freeze); [architecture-canvas](../architecture/architecture-canvas.md) (the grid, how many columns fit, remembered layouts, saved layouts and stacks); [architecture-navigation](../architecture/architecture-navigation.md) (the module chooser, favorite layouts); [architecture-modules](../architecture/architecture-modules.md) and [architecture-environments](../architecture/architecture-environments.md) (module access and the Roles grid, in part); `documentation/TODO.md` (searched for layouts and workspaces). In code: `server/templates.js` (the `workspace` keys and their check, lines 42 to 62 and 312 to 331), `server/layouts.js` (the header, `LAYOUT_LIMITS`, `cleanStacks()`, `cleanLayout()`), `server/fixed-workspaces.js`, `server/index.js` (`layoutSpaceFor()` and the layouts answer, lines 6360 to 6504, read in part; `GET /api/roles`, line 13099), `server/modules.js` (`permissionList()`, line 1325), `server/environment.js` (line 130, who in a space can read a module), `public/space.js` (`mayChangeLayout`, line 3317), `public/host-templates.js` (the Default Workspace part, lines 360 to 380 and 550 to 553), `public/composites.js` (line 18), and the `workspace` block of every file in `templates/`. **Not read:** `public/canvas.js` beyond a search, `public/layouts.js`, `public/snap-grid.js`, the Manage pages for an owner's own template, and the host console's page scripts beyond the template editor. Nothing here was run.

## Why

A template can say which modules the Workspace opens with, but not how they are arranged. An owner who wants everyone to start from the same arrangement must build it by hand on the canvas (dock, resize, stack), then save it as a shared layout. Thomas wants one plain, visual way to do both: pick a shape, then put a module in each area.

His sketch shows six shapes. Each sits beside the fixed chat and call column on the left (pink in the sketch). The green areas are the ones you map.

| Shape | What it looks like | Areas | Id |
|---|---|---|---|
| 1 | One large area | 1 | `one` |
| 2 | Two equal areas side by side | 2 | `two-equal` |
| 3 | A large area on the left, a narrow one on the right | 2 | `wide-narrow` |
| 4 | Three equal columns | 3 | `three-equal` |
| 5 | A tall area on the left; the right column split top and bottom | 3 | `tall-split` |
| 6 | A large area on the left; a narrow right column split top and bottom | 3 | `wide-split` |

Thomas confirmed these six as the set, and the reading of shapes 5 and 6: in 5 the two columns are equal widths, and in 6 the right column is narrow (decision 9).

## What it is today

- **A template's workspace.** A template can set only `workspace.opensWith` (a list of module ids, at most 20), `workspace.show` (the Fixed Workspaces a new space shows) and `workspace.opensFirst` (a system layout id). `WORKSPACE_KEYS` at `server/templates.js:61`. The check at line 313 refuses any other key: "\"workspace\" takes only opensWith, show and opensFirst." No template defines an arrangement. Read in code. The shipped files: Games opens `chat`, `calendar`. Learning and Mentoring open `goals`, `todo`, `documents`, `chat`. Project opens `schedule`, `todo`, `chat`. Travel opens `travel`, `chat`. Default has no `workspace` block.
- **What the Workspace opens.** On entering, the order is: a fresh request, then the person's remembered arrangement (`__open`, in the browser), then the template's `workspace.opensWith`, then the product default (`whatOpens()` in `public/opens-with.js`; architecture-canvas, "Remembered layouts"). So a template's list is already only a **starting** point: after the first visit, the person's own arrangement wins. Read in the architecture document. The code was searched, not read line by line.
- **Saved layouts are free-form.** A saved layout is `{ id, name, by, at, modules, snap?, arrange?, icon? }`. Each entry in `modules` is `{ id, mode: 'dock' | 'float', dockW?, box?, snap?, stack?, at?, h?, folded? }` (`server/layouts.js:26` and `cleanLayout()`). `dockW` is a width in **pixels** (160 to 2000). `box` is a floating module's place as fractions of the canvas. Up to 10 personal layouts per person per space and 10 shared ones per space. Read in code.
- **Columns and stacks already exist.** Docked modules are columns of the canvas grid. The first one (or the conference, when it is docked) is the flexible column, and the others have fixed widths. Two or three docked modules can share one column as a stack, each with a share of its height (`stack`, `at`, `h`). The conference, the chat and the composites (`dest:calendar`, `dest:map`) **never stack**: the server's `stackable()` (`server/layouts.js:55`) refuses only `conference`, `chat` and any `dest:` id. Wherever the Calendar is on in a space, a stored `calendar` or `todo` reads as `dest:calendar` (`aliasesFor()` and `composeList()` in `public/composites.js`), so a saved layout naming `todo` opens the Calendar; `maps` reads as `dest:map` where the Map is shown (plan-layout-views). `public/composites.js` never reads To-do's `inCalendar` setting ("Show in the Calendar"), so To-do stands alone on the canvas only where the Calendar is off in the space. There is no `places` module. Read in code, and checked by a read-only QA pass on 2026-11-18.
- **To-do's own window is not built.** What is built is only the `inCalendar` setting and the panel rule (`panelsOf` on the server; To-do 1.15.31). The dedicated To-do window is the unbuilt part of [plan-todo-list](plan-todo-list.md) (step J5 and its question 5; that plan's status line, "Nothing is built", is out of date). Checked by the QA pass, not read here.
- **Chat and the call are not canvas modules** wider than a phone. They sit in the left column (`placeBuiltins` in `public/canvas.js`). The call's position choices are Top, Bottom, Left of the chat, Right of the chat, Floating window, In the workspace and Its own window; the Conference layout has its own set. Neither can stack or be saved in a layout's arrangement. Checked by the QA pass.
- **Opens first.** A template's `workspace.opensFirst` may be any of `workspace`, `calendar`, `map`, `conference`, `whiteboard`, `documents` (`SYSTEM_IDS`, `server/layouts.js:61`; checked at `server/templates.js:331`). Read in code.
- **How many columns fit.** `dockLimit(width)` in `public/snap-grid.js`: 2 columns from 641 to 759px, 3 from 760, and more beyond. A module with no column waits as a floating one (plan-docked-limit). At 640px and below there are no columns and one view shows at a time. Read in the architecture document.
- **Shared layouts.** An owner, the admin or the space's moderator can save one "For everyone in this space" (`canShare`, `server/index.js:6367`). Anyone can load it. A person who may not change it can still move things and keeps working in a changed copy. The shared one stays as it was (`mayChangeLayout`, `public/space.js:3317`). Read in code.
- **No empty column.** Every entry in a saved layout must name a module, so a layout can't hold an empty place. Read in code (`cleanLayout()`).
- **Who can open a module.** A module is open to a person in a space when it is on there and the person's permissions in that space include the module's read permission (the manifest's `access.read`, a `module.<id>.<key>` permission on the Roles grid; `moduleAccess` in `server/index.js`, `store.spacePermissions(key, spaceId)`, which adds a moderator's own grant for that space). Each permission has defaults per role from the manifest (`permissionList()`, `server/modules.js:1325`), and an owner changes them in Roles. `GET /api/roles` is owner-only (`requireOwner`, `server/index.js:13099`). `server/environment.js:130` already lists the people of a space who can read a module, with `moduleCan(manifest, store.spacePermissions(k, spaceId), 'read')`. A moderator's own grant for a space can only add permissions, never remove one: `store.spacePermissions()` (`server/store.js`, about line 2956) starts from the person's role and merges in the Moderator role's ticks that are on, and `SPACE_PERMISSIONS` holds only `moderator`. So who can open a module in a space follows from roles alone. A template can't reach a module's permissions (`server/templates.js:14`). Read in code and the architecture documents.
- **The template editors.** The host console's template editor has a **Default Workspace** part (`public/host-templates.js:370` to `373`): the Opens with list, the **Show** checkboxes and **Opens first**. Owners edit their own templates in Manage, using the same parts (plan-templates-redesign decision 7). Read in code for the console. Manage's page was not read.
- **The draft in plan-workspaces.** "Draft: shared and personal workspaces" (2026-11-17) is under discussion, and nothing in it is decided. It touches this idea at three points: workspaces a template defines (its point 3 and open question 8), workspaces a moderator makes for others (point 4), and how shared saved layouts fit a "Personal" tab (open question 7). This plan does not answer those questions. It says under "How this meets the draft" where it would touch them.

So most of the canvas side exists. The six shapes can almost be drawn with today's columns and stacks. What's missing: a shape as a thing you can name and store, widths as proportions rather than pixels, an empty area, a template key, and the picker itself.

## Decisions

Thomas, 2026-11-18.

1. **The left column is the chat and call column.** It is always there and can't be mapped. Chat and the call sit there, not on the canvas, at any width above a phone (`placeBuiltins`, `public/canvas.js`). The call moves only by the person's call position (Top, Bottom, Left of the chat, Right of the chat, Floating window, In the workspace, Its own window); the Conference layout has its own set. Neither can stack or be saved in a layout's arrangement. Reason: it is the always-on column every layout already has (plan-one-bar decision 2), and a layout arranges only the canvas beside it.
2. **A template's layout is the starting arrangement for a person's first visit.** After that, the person's own remembered arrangement wins, as it does today. Reason: it keeps today's rule for `opensWith` (the template starts it, the person owns it after that).
3. **Each area holds one module and may be empty.** An empty area shows the module chooser. Reason: an owner can leave an area open for people to choose for themselves.
4. **One picker serves both templates and owners saving a shared layout in a space, from the start.** Reason: one way to set a layout, wherever it is set.

Thomas, 2026-11-18 (his answers to the first draft's open questions 3, 5, 6 and 8).

5. **Shared layouts are shapes only (option B1).** An owner makes a shared layout only with the picker. Stored free-form shared layouts are dropped and test data is reset. There are no two kinds side by side. Personal layouts stay free-form. Reason: the product is unreleased, so no compatibility layer and no second kind of shared layout.
6. **A shape is only a starting arrangement (option E1).** It opens as ordinary columns and stacks, and after the first visit the person's own arrangement takes over, as today. Reason: it matches decision 2.
7. **Widths are fixed per shape (option D1).** Each shape has set proportions in code. The picker has no drag handles and nothing about widths is stored. Reason: the shapes are set proportions, not something dragged in the picker.
8. **Calendar and Map are left out of the stacked areas.** In shapes 5 and 6 (`tall-split` and `wide-split`), areas 2 and 3 do not offer Calendar or Map (nor any id that reads as a composite), and the shape check refuses them there. To-do reads as a composite only where the Calendar is on, so it is refused there and only there (see "To-do in a stacked area"). The stacking rule (`NEVER_STACKED` in `server/layouts.js`) does not change. Reason: changing the stacking rule is separate canvas work.

Thomas, 2026-11-18 (round three: his answers to the second draft's open questions 1 to 6 and 9).

9. **The six shapes as sketched are the set.** The readings of shapes 5 and 6 are right: in 5 the two columns are equal, and in 6 the right column is narrow. Reason: it is his sketch, and he wants no more shapes and no fewer.
10. **A shape is stored as a shape and its areas (option A1).** Thomas asked why the stored views (today's saved layouts) are not reused. The answer, recorded: an entry in a saved layout must name a module, so it can't hold an empty area (decision 3); and its widths are pixels (`dockW`), so "equal" is equal only at the window width it was saved at. The shape record turns into today's ordinary columns and stacks when it loads (decision 6), so the stored views are reused at that end. Reason: the record holds what was chosen, and only that.
11. **Widths are percentages of the view, on a grid of full, halves and thirds, held in one code list.** So a full area is 100 percent, equal halves are 50 each, a large area is two-thirds and a narrow one one-third, three equal columns are a third each, and each stacked area is half its column's height. "The view" is the canvas beside the chat column. Reason: a percentage keeps a shape's proportions at any window width, which pixels do not.
12. **`workspace.layout` replaces `workspace.opensWith` (option C1).** `opensWith` leaves the template format, and the six shipped templates are rewritten. Reason: one way to say how the Workspace starts.
13. **An area whose module a person can't open is closed up for everyone who can't open it (option F2).** It is not drawn as empty and offers no chooser, for members as for guests. This replaces the planner's earlier lean (F1: empty with the chooser for members, closed for guests). Only a blocked module's area closes up: an area left empty on purpose still shows the chooser (decision 3). Reason: a person is not shown a place for a module they can't open. How the other areas take the space is under "Placing a shape on the canvas"; where this meets decision 3 is decision 18.
14. **The Default template opens `one` with an empty area showing the chooser.** Reason: a space on the Default template starts with one open area, and the person chooses what goes in it.
15. **No personal layouts from the picker, for now.** Personal layouts stay free-form. Reason: decision 4 names templates and the people who save shared layouts.
16. **No fallback for the freeze.** Both halves, templates and the space half (step 6), land before the freeze starts on 2026-12-11. The space half is not held back. Reason: decision 4 holds for the release.

Thomas, 2026-11-18 (a further decision, through the project manager).

17. **The layout's maker is told when someone can't see part of it.** Whoever made the layout (the owner, admin or moderator who saved it) sees a notice in the picker and on the layout itself, for each area whose module a role can't open, for example "Guests can't open this." It is seen when looking at or editing the layout. It is not a message or a notification sent when it happens. Reason: with decision 13 a blocked area closes up silently for those people, so the person who designed the layout must be able to see it.

Thomas, 2026-11-18 (round four: his answers to the third draft's open questions 4 and 5).

18. **Decision 13 stands: a blocked area closes up for everyone who can't open its module, and the left-out note stays.** The chooser is not offered in a closed-up area, for members as for guests. A person who wants another module opens it from the Modules tab. Decision 3 (an empty area shows the chooser) applies only to areas the maker left empty. Reason: a person is not shown a place for a module they can't open, and the left-out note still says what was left out.
19. **The notice shows to anyone who may edit the layout.** That is the owner, the admin and the space's moderators (`canShare`), not only the person who saved it (`by`). So `cantOpen` is answered to everyone who may edit the layout. Reason: anyone who may change the layout needs to see who it closes up for.
20. **"On the layout itself" means the picker and the layout's row in Layouts.** Nothing appears on the canvas: no notice for ordinary people, and no mark on the canvas for those who may edit. Reason: the notice is for whoever is looking at or editing the layout, not for using it.

Thomas, 2026-11-19 (his answers to the fourth draft's open question 5, through the project manager).

21. **Education gets the Whiteboard.** `whiteboard` is added to the Education template's `modules` (`templates/learning.json`), so its layout `tall-split` with Whiteboard, Goals and Documents is allowed. Reason: a template's layout may name only the template's own modules, and the template check reads that list.
22. **Projects opens `wide-narrow`: Project plan large, To-do narrow.** The record is `{ "shape": "wide-narrow", "areas": ["schedule", "todo"] }`. `wide-narrow` has no stacked area, so To-do in area 2 is allowed. Reason: it keeps today's two modules in the shape that matches them.

Thomas, 2026-11-19 (his answers to the fifth draft's open question 5, and a confirmation, through the project manager).

23. **The Default template is confirmed.** A space on the Default template opens `one` with its one area empty, showing the chooser. Decision 14 stands. Reason: Thomas confirmed it.
24. **Mentoring and Travel get a layout without To-do for now.** Mentoring opens `wide-narrow` with Documents large and Development plan (`goals`) narrow: `{ "shape": "wide-narrow", "areas": ["documents", "goals"] }`. Travel opens `wide-narrow` with Itinerary (`travel`) large and Vault narrow: `{ "shape": "wide-narrow", "areas": ["travel", "vault"] }`. Reason: step 3 removes `opensWith`, and this way no old key is left behind in either file while To-do waits for its own window.

## Options for Thomas

The options below are all decided now (A by decision 10, B by 5, C by 12, D by 7 and 11, E by 6, F by 13). Their tables stay as the record of what was weighed.

### A. How a shape is stored

Decided: A1 (decision 10).

| Option | What it is | Cost | Rules out |
|---|---|---|---|
| **A1. A shape and its areas (lean)** | A small record: `{ "shape": "wide-split", "areas": ["documents", "todo", null] }`. The proportions of each shape live in one code list. The page turns the record into columns and stacks when it loads it | One new shape check. One code list, with a copy for the page and a check that the two agree (as for `SYSTEM_IDS`). The page needs a new "place a shape" function | Nothing. A person's own free-form arrangement after the first visit is untouched |
| A2. Today's layout, written by the picker | The picker writes ordinary `modules` entries (docked columns, `dockW`, stack keys), plus a `shape` marker so it can be reopened | No new placing code | Empty areas (a layout entry must name a module), so decision 3 needs a new kind of entry anyway. Widths are pixels, so "equal" is only equal at the width the layout was made at. A template would carry pixel widths |
| A3. A grid description | Rows and columns with spans, so any shape can be described | The most flexible | A larger check and a larger picker for six shapes. It goes beyond the sketch |

Why A1: it stores what the person chose (a shape and a module per area) and nothing else. It is the same record in a template and in a space. It is small enough for the shape check to refuse anything wrong in one sentence.

### B. Shared layouts: coexist with free-form, or replace them

Decided: B1 (decision 5).

Today a shared layout is a free-form arrangement, saved from the canvas (floating boxes, snap, any number of columns). Decision 4 makes the picker the way an owner saves a shared layout. The product is unreleased, so there is no compatibility layer either way.

| Option | What it is | Cost | Rules out |
|---|---|---|---|
| **B1. Shared layouts are shapes only (lean)** | An owner makes a shared layout only with the picker. **For everyone in this space** goes from the free-form save. Stored free-form shared layouts are dropped (test data is reset). Personal saved layouts stay free-form | Owners lose floating, snapped and many-column shared layouts. The Layouts section loses one save path | A shared layout that floats a module over a map |
| B2. Both kinds, side by side | A shared layout is either free-form (saved from the canvas, as today) or a shape (from the picker). Both show in the list | Two kinds of shared layout to explain, check and load. A free-form one can't be opened in the picker. Only Replace works on it | Nothing, but "one way to set a layout" holds only for new ones |
| B3. The picker writes free-form layouts | The picker is only a front end. What it saves is an ordinary free-form layout | Needs A2, with its costs | Empty areas, and reopening the picker on a layout someone later changed |

Why B1: Thomas's concern in the draft is cohesion, with everyone seeing the same thing. A shared layout that is one shape with one module per area is what everyone sees at the same proportions. A free-form one depends on each person's window. A person who wants a free-form arrangement still saves their own. The cost is real: an owner who used floating shared layouts loses them. Thomas chose B1 with that cost (decision 5).

### C. The template key: replace `opensWith`, or sit beside it

Decided: C1 (decision 12).

| Option | What it is | Cost | Rules out |
|---|---|---|---|
| **C1. `workspace.layout` replaces `workspace.opensWith` (lean)** | A template says how the Workspace starts with one shape. `opensWith` is removed from the template format and from the six shipped files | All six files rewritten. The Default Workspace part of the editors redrawn. `whatOpens()` step 3 and Set up's read-only "opens with" line change. A template can't open more than three modules | Starting with more than three modules. Today's templates open at most three plus the chat, so none loses anything |
| C2. Both, `layout` wins | `layout` when set, else `opensWith` | Two ways to say one thing. The editor needs both | Nothing |
| C3. `layout` only for new templates | | A second path kept for old ones | Not allowed: the product is unreleased, so no legacy path |

Why C1: two ways to say how the Workspace starts would be the "five lists that read alike" problem again (plan-templates-redesign, #774). Chat leaves the list because the chat column is always there (decision 1).

### D. Widths

Decided: D1 (decision 7), with the shares as percentages on a grid of full, halves and thirds (decision 11).

| Option | What it is | Cost |
|---|---|---|
| **D1. Fixed proportions per shape, in code (lean)** | "Equal" is equal. "Large" and "narrow" are fixed shares (large two-thirds, narrow one-third, and each stacked area half the column's height). Nothing about widths is stored | The picker can't make a column a little wider. People resize afterwards in their own arrangement, as today |
| D2. The picker sets each split | A drag handle between areas in the picker, stored as shares | A larger picker, a larger stored record, and more to check |

### E. After the first visit: does the shape stay?

Decided: E1 (decision 6).

Decision 2 says the person's own arrangement wins after the first visit. This choice was whether the areas stay as a structure.

| Option | What it is | Cost |
|---|---|---|
| **E1. The shape is only a start (lean)** | The shape opens as ordinary columns and stacks. From then on it is today's canvas: closing a module closes its column, and dragging and stacking work as now. An empty area shows the chooser only until a module is chosen or the area is closed | The empty area with the chooser is a new thing on the canvas, but it lasts only until it is used |
| E2. The shape stays as a frame | Closing a module leaves its area empty, with the chooser. The person changes the shape only by picking another | A new canvas mode beside Panel Mode and Window Mode. Larger, riskier canvas work. It conflicts with decision 2's "their own remembered arrangement wins" |

### F. A mapped module the person can't open

Decided: F2 (decision 13), not the planner's lean F1.

This covers a module that is off in the space, not installed, or not readable by this person.

| Option | What it is | Cost |
|---|---|---|
| F1. The area shows as empty, with the chooser (the planner's lean) | The same as decision 3: the area offers what this person can open. For a guest, who has no chooser, the area closes up and its neighbours take its width | The chooser must list only what this person can open. It already does |
| **F2. The area closes up for everyone (decided)** | Its neighbours take its width | A shape can turn into a different shape without anyone choosing it. Decisions 17 and 19 answer this for those who may edit the layout: they see which areas close up for whom |

## The six shapes

Shape ids are plain words, named by kind, not by the product. Areas are counted left to right, then top to bottom. Widths are percentages of the view (decision 11).

| Id | Shape | Areas | Column widths | Stacked areas |
|---|---|---|---|---|
| `one` | One large area | 1 | 100 | none |
| `two-equal` | Two equal areas | 2 | 50, 50 | none |
| `wide-narrow` | Large left, narrow right | 2 | two-thirds, one-third | none |
| `three-equal` | Three equal columns | 3 | a third each | none |
| `tall-split` | Left tall; right split top and bottom | 3 | 50, 50 | areas 2 and 3, half the column's height each |
| `wide-split` | Large left; narrow right split top and bottom | 3 | two-thirds, one-third | areas 2 and 3, half the column's height each |

**A limit from today's code.** A stacked area can't hold the conference, the chat or a composite (`NEVER_STACKED`). So in `tall-split` and `wide-split`, areas 2 and 3 refuse Calendar, Maps and any `dest:` id, and To-do where the Calendar is on (`calendar`, `todo`, `maps` are `COMPOSITE_PARTS` in `server/layout-shapes.js`, matching `parts` in `public/composites.js`). Per decision 8 the picker leaves them out of the chooser for those areas, the shape check refuses them, and the stacking rule stays as it is.

**To-do in a stacked area.** To-do reads as the Calendar composite only where the Calendar is on (`aliasesFor()`, `public/composites.js`; it does not read `inCalendar`). Where the Calendar is off, To-do is an ordinary module and may stack. The rule, set through the project manager on 2026-11-18: `cleanShape()` takes the modules that are on (a template's `modules`, or the modules on in the space) and refuses `todo` in areas 2 and 3 of `tall-split` and `wide-split` only when `calendar` is among them. This is built (step 1, `fd946e56`): `cleanShape()` refuses Calendar and Maps in a stacked area every time, and `todo` where `calendar` is on, or where it is not told what is on. To-do's own window, which would let To-do stand alone where the Calendar is on, is a separate item (plan-todo-list, step J5); this plan depends on it only for the Mentoring and Travel layouts (see "The shipped templates").

## The contract

This is drafted on decisions 1 to 24 and Thomas's template picks. Open questions 1 to 4 would change only the parts that name them.

### The shape list (server-development; core)

Built in step 1 (commit `3694ab37`). The page copy is `public/layout-shapes.js`, and `tools/check-layout-shapes.mjs` is the check.

- One code list in the host, `server/layout-shapes.js`, beside `server/fixed-workspaces.js`. Each entry: `{ id, areas, columns: [percent...], stacked: [area numbers] }`, as in the list above. `columns` holds each column's width as a percentage of the view, on the grid of full, halves and thirds (100, 50, two-thirds, one-third; decision 11). A stacked area always takes half its column's height. The builder may hold thirds as exact fractions (`200 / 3`, `100 / 3`) so a shape's columns add up to exactly 100.
- The page gets its own copy, `public/layout-shapes.js`, and a check fails when the two differ (the same pattern as the system layout ids). The check also fails when a share is off the grid or a shape's columns do not add up to 100.
- The shares are fixed in the list (decision 7). There are no width settings, in the list or in a stored shape.
- Adding a shape later is one entry in each copy, plus its drawing in the picker.

### The stored shape (server-development; core)

The same record in a template and in a shared layout:

```json
{ "shape": "wide-split", "areas": ["documents", "todo", null] }
```

- `shape`: an id from the shape list.
- `areas`: a list exactly as long as the shape has areas. Each entry is a module id (the rule `MODULE_ID`, `^[a-z][a-z0-9-]{0,31}$`) or `null` for an empty area.
- Refused, each with one sentence: an unknown shape ("Pick a shape from the list."); a list of the wrong length ("This shape has 3 areas."); a module listed twice ("\"todo\" is in two areas; a module can be in one area only."); `chat` or `conference` in an area ("The chat and the call are in the column on the left; they can't go in an area."); an id that can't stack in a stacked area ("\"calendar\" can't share a column; put it in area 1."; decision 8; `calendar`, `maps` and any `dest:` id always, and `todo` where `calendar` is on, see "To-do in a stacked area"). The record holds no widths (decisions 7 and 11).
- Pure: `cleanShape(input, { modules })` in `server/layout-shapes.js`, where `modules` is the list an area may name (below), and the same list tells it whether `calendar` is on. It returns `{ shape }` or `{ error }`, as `cleanLayout()` does.

### In a template (server-development; core)

- `workspace.layout` holds the record. It **replaces** `workspace.opensWith` (decision 12): `WORKSPACE_KEYS` becomes `['layout', 'show', 'opensFirst']`, and a template with `opensWith` is refused with the unknown-key sentence.
- Every module in `areas` must be one of this template's `modules` (the rule `opensWith` follows today, `server/templates.js:322`). With the Default template's `"*"`, any module in the catalog may be named.
- A template with no `layout` (an owner's template saved without one) opens the product default, as a template with no `opensWith` does today. The Default template is not one of these: it ships with a layout (decision 14).
- The six shipped files get a `layout` in place of `opensWith` (decision 12). The Default file's is decided (decision 14). The others are under "The shipped templates" below.

- The resolver (`store.lookOf`) and `GET /api/modules/for-space` serve `layout` where they serve `opensWith` today. Nothing else reads a template.
- A space's template changing: the new template's layout applies on the next first visit, as for the Default Workspace today (plan-templates-redesign, "What happens to an existing space when its template changes").

### The shipped templates

Thomas, 2026-11-18. The chat is in the fixed column on the left (decision 1), so it drops out of the areas. A rename changes only the template's `name`, the word a person reads (see "Renaming a template" below).

| Template (today's `name`, id) | Today's `workspace` | Thomas's pick | Record |
|---|---|---|---|
| Default (`default`) | no `workspace` block | Left as is: `one`, its area empty (decision 14) | `{ "shape": "one", "areas": [null] }` |
| Games (`games`) | `opensWith` `chat`, `calendar`; `show` `calendar`, `map`; `opensFirst` `workspace` | Renamed **Gaming**. `opensFirst` becomes `conference`. No layout shape | none |
| Learning (`learning`) | `opensWith` `goals`, `todo`, `documents`, `chat`; `show` `calendar`, `documents`; `opensFirst` `workspace` | Renamed **Education**. `whiteboard` added to its `modules` (decision 21). `tall-split`: Whiteboard large; Goals and Documents stacked on the right | `{ "shape": "tall-split", "areas": ["whiteboard", "goals", "documents"] }` |
| Mentoring (`mentoring`) | the same as Learning | `wide-narrow`: Documents large, Development plan (`goals`) narrow (decision 24) | `{ "shape": "wide-narrow", "areas": ["documents", "goals"] }` |
| Project (`project`) | `opensWith` `schedule`, `todo`, `chat`; `show` `calendar`, `documents`; `opensFirst` `workspace` | Renamed **Projects**. Everything else as today. `wide-narrow`: Project plan (`schedule`) large, To-do narrow (decision 22) | `{ "shape": "wide-narrow", "areas": ["schedule", "todo"] }` |
| Travel (`travel`) | `opensWith` `travel`, `chat`; no `show` or `opensFirst` | `wide-narrow`: Itinerary (`travel`) large, Vault narrow (decision 24) | `{ "shape": "wide-narrow", "areas": ["travel", "vault"] }` |

What follows from the picks, read in the template files and in code:

- **Gaming** has no `layout`, so under the contract its Workspace opens the product default (as a template with no `opensWith` does today), and a new space opens on the Conference layout first. Its `show` is not changed by the pick.
- **Education** names `whiteboard`, which is not in `learning.json`'s `modules` today, so `whiteboard` is added there (decision 21). Read in the files: Projects and Travel list it as `"whiteboard": {}` (`templates/project.json:134`, `templates/travel.json:32`), an empty entry with no name, labels or settings, placed before `chat` and `conference`. Its permissions (`view` and `edit`) come from the module's own manifest (`modules/whiteboard/module.json`), not from a template, so nothing else is needed for the layout to pass. Learning's `workspace.show` (`calendar`, `documents`) does not include the Whiteboards Fixed Workspace and is not changed by the decision. No check found by a search asserts Learning's exact module list (`tools/check-templates.mjs` asserts Travel's at line 136); not run.
- **Projects**: `todo` is in area 2 of a two-area shape, not a stacked area, so it is allowed. Projects has the Calendar on, so `todo` there opens the Calendar, as today's `opensWith` does.
- **All six can be done in step 3.** Mentoring and Travel carry no To-do for now (decision 24).

**Note: To-do joins Mentoring and Travel later.** Thomas's stacked picks were `tall-split` `["documents", "todo", "goals"]` for Mentoring and `tall-split` `["travel", "vault", "todo"]` for Travel. Both templates have the Calendar on (`mentoring.json` and `travel.json` both list `calendar` in `modules`), and today the Calendar folds To-do in wherever it is on, so `todo` in a stacked area reads as the Calendar composite, which can't stack, and the check refuses it. To-do joins those two layouts, in the stacked picks, when To-do has its own window (plan-todo-list, step J5). That is a later change to the two files, not part of this plan's build.

**Renaming a template.** Only `name` changes. The ids (`games`, `learning`, `project`) and the files (`templates/games.json`, `learning.json`, `project.json`) stay, and so does every stored key: a space stores its template's id (`template`), and the name a moderator reads is taken from the template when it is answered (`templateName`; asserted in `tools/check-space-templates.mjs:386`). Read in code; not run. The checks name the template files and ids (`tools/check-starter.mjs`, `tools/check-vault-module.mjs`, `tools/check-demo-console.mjs`), not the names. `tools/check-space-templates.mjs` uses the word `Games` only to assert it is absent from an answer or refused as an id, which a rename does not break. `tools/check-template-pages-b.mjs:64` passes `'Project'` as a literal to `changeQuestion()`; whether it must match the shipped name is not verified. The design-system prototype `public/design-system/prototype-start-page.js:24` carries the label `Games`. Each template's own `words`, `description` and `home` were not checked for the old names. In `documentation/`, 28 files contain the word Games or Learning (a word search, not each read); updating them is content-manager's.

### In a shared layout (server-development; core)

- A shared layout becomes `{ id, name, by, at, shape, areas, icon? }`. A shared layout has **no** `modules`, `snap` or `arrange` (decision 5): `cleanLayout()` refuses them for a shared layout ("A layout for everyone is a shape; pick one with the picker."). A personal layout keeps today's free-form shape and can't take `shape` (decision 15).
- An area of a shared layout may name any module on in the space (`onInSpace`). One that later goes off, or that a person can't read, is handled when the layout is loaded (decision 13), and the stored layout is not changed. This is today's left-out rule.
- Who may make, replace, rename or delete one: unchanged, the owner, the admin and the space's moderators (`canShare`). Limits unchanged: 10 shared layouts per space.
- `defaultLayout` (Opens first), favorites and the person's `last` work on a shared shape as they do on any shared layout.
- Stored free-form shared layouts are dropped, not converted (decision 5). Test data is reset: the builder clears `shared` in a test `layouts.json`, and the server reads a free-form shared entry as invalid and leaves it out of the answer. That is not a migration, and nothing is rewritten.
- Routes: unchanged in path. `POST /api/spaces/:id/layouts` and `PUT .../layouts/:layoutId` take `{ name, shared: true, shape, areas }` for a shared one. `GET /api/spaces/:id/layouts` answers `shape` and `areas` on a shared entry in place of `modules`, and `cantOpen` to everyone who may edit a shared layout (below; decision 19). `400` with the sentences above. `403` for a member or guest making a shared one (as today). `404` for an Aside.

### Telling the maker (server-development, then experience-design; core)

Decisions 17, 19 and 20. The notice is worked out on the server, because the page can't work it out: `GET /api/roles` is owner-only, so a moderator who edits a shared layout can't read the Roles grid, and the page does not know each module's read permission key.

- **The field.** `cantOpen`, a map from module id to who can't open it. Each entry is one of two forms, and a module everyone can open is not in the map:
  - `{ "roles": ["guest"] }`: the roles whose permissions lack the module's read permission, in the order `moderator`, `member`, `guest`. An owner and the admin open everything and are never listed.
  - `{ "off": true }`: the module is off in the space or no longer installed. It closes up for everyone.
  - There is no list of people. A moderator's own grant for a space can only add permissions, never remove one (`store.spacePermissions()`, `server/store.js`, about line 2956; `SPACE_PERMISSIONS` holds only `moderator`), so who can't open a module follows from roles alone.
- **In a space.** `GET /api/spaces/:id/layouts` answers `cantOpen` for every module on in the space, and for any module a shared layout names that is now off, to everyone who may edit a shared layout: the owner, the admin and the space's moderators (`canShare`; decision 19), whether or not they saved it. It covers every module, not only the saved ones, so the picker can show the notice while an area is being chosen, before saving. A member or guest gets no `cantOpen`.
- **In a template.** A template has no people, so the notice names roles only. In the host console the server works it out from each module's manifest defaults (`permissionList()`, `server/modules.js:1325`), and the notice says so ("Guests can't open this by default."). On Manage's own-template page it is worked out from that environment's Roles grid. The route that serves each editor its module list answers the same `cantOpen` (the builder names the route). An environment can change its Roles later, so the template notice is a guide and the space notice is the real one.
- **Pure:** `whoCantOpen(moduleIds, { manifests, rolePermissions, off })` in `server/layout-shapes.js` (built in step 1), so the check can run it in node. `rolePermissions` is `{ moderator, member, guest }` as the Roles grid holds them; `off` lists the modules off in the place asked about.
- **What a person sees.** Everyone who may edit the layout sees it in the picker (step 2 of the picker) and on the layout's row in the Layouts section (decisions 19 and 20). Nothing appears on the canvas, for ordinary people or for those who may edit (decision 20). Nobody else sees it, and nothing is sent: no message, no notification (decision 17). The words are below under "The picker".

### Placing a shape on the canvas (experience-design; risky, layout and canvas work)

- One pure function in `public/layouts.js`, `placeShape(record, width, canOpen)`. It answers the columns (each module docked, with its width worked out from the shape's percentages for this canvas width), the stacks (`stack`, `at`, equal `h`), the empty areas, the areas closed up for this person, and the ids left out for this person. It runs in node for `tools/check-canvas.mjs`.
- **Loading.** `canvas.loadLayout()` takes a shape record as it takes a free-form layout. It closes what the shape does not name (except the conference while the person is on the call, as today) and opens and docks the rest. The result becomes the person's remembered arrangement (decisions 2 and 6).
- **First visit.** `whatOpens()` step 3 reads the template's `layout` in place of `opensWith`. Step 2 (the person's own arrangement) still comes first.
- **An empty area** (`null` in the record, an area the maker left empty) is a placeholder column (or stack section) with the module chooser drawn into it: the same shared menu the Modules tab mounts (`mountHostMenu()`, `public/host-menu.js`), listing only the modules this person can open here that are not already open. Choosing one puts it in that area. The placeholder has a close button, and closing it closes up the area (decision 6). A placeholder is never saved: in a person's remembered arrangement an empty area is simply not there. A guest, who has no chooser, gets no placeholder: the empty area closes up for them.
- **A module this person can't open** (off in the space, not installed, or not readable by them) closes up its area for this person (decisions 13 and 18). It is not drawn as a placeholder and offers no chooser, for a member as for a guest. How the others take the space (the planner's reading of decision 13, suggested):
  - A closed column is left out before widths are worked out, and the columns left share the view in the proportion of their percentages. In `wide-narrow` with area 2 closed, area 1 takes the whole view. In `three-equal` with one area closed, the other two take half each. In `tall-split` or `wide-split` with area 1 closed, the right column is the only one and takes the whole view, with its stack kept.
  - A closed section of a stack leaves the other section the whole height of its column. The column itself keeps its width.
  - If every area closes, the canvas opens with nothing in it, as today when nothing is open.
  - Today's left-out note (`leftOutNote()`) still says which modules were left out (decision 18).
- **Opening another module.** A member whose area closed up opens another module from the Modules tab (decision 18). It docks by today's rules (`fitDock()`), not into the closed area: under decision 6 the shape is only a start, and there is no area left to fill. A guest has no chooser, as today. Only an area the maker left empty (decision 3) shows the chooser.
- **Nothing for the notice on the canvas.** Loading a shared shape draws no notice and no mark on the canvas, for anyone, including those who may edit it (decision 20).
- **Too narrow for the shape.** `fitDock()` decides as it does now: a column the window has no width for waits floating, with today's note ("The window is too narrow for another column, so Polls is floating."). `three-equal` needs 760px of canvas. Below that, area 3 waits.
- **The call "In the workspace".** The person's own call position puts the call in the canvas area. With a shape it takes its own column first (the flexible one, as today), and the areas share the rest (suggested; open question 1).

### The picker (experience-design)

One piece, `public/layout-picker.js`, drawn the same in both places. It is a page piece and doesn't use the SDK's module surface. It reuses the shared menu (`host.menu.show` / `openHostMenu()`), the shared action bar locked to the bottom (Thomas's rule for edit surfaces), the switch and radio patterns already in Set up, and theme tokens only (`documentation/designsystem/design-theme.md`; `check-no-raw-colours`).

**Step 1, Pick a shape.** A row of six small drawings, a radio group (`role="radiogroup"`; the arrow keys move, Space picks). Each drawing shows the chat column in a muted surface token and the areas in the card surface, at the shape's percentages, with a plain label under it ("One", "Two equal", "Large and narrow", "Three equal", "Two, right split", "Large, right split"; the words are Thomas's to change). The chosen one has the accent border.

**Step 2, Choose modules.** The chosen shape drawn large. Each area is a button showing the module's icon and name, or "Empty". Pressing it opens the shared menu with **Empty** first, then the modules this area may hold, each with its icon. A module already in another area shows with a note and moving it there empties its old area, so one module is never in two areas. The areas are reached with Tab in area order. A screen reader hears "Area 2 of 3: To-do" for each.

**The maker's notice (decisions 17, 19 and 20).** Shown to everyone who may edit the layout, not only the person who saved it. Under each area whose module is in `cantOpen`, one line in the muted text token with a warning icon, read by a screen reader with the area ("Area 2 of 3: To-do. Guests can't open this."). Suggested words:
- One role: "Guests can't open this. For them, this area closes up."
- More than one: "Members and guests can't open this. For them, this area closes up."
- Off in the space: "Off in this space. This area closes up for everyone."
- In the host console's template editor: "Guests can't open this by default."

The line shows as soon as a module is chosen for the area, and when the picker opens on a saved layout. It does not stop saving. On a fixed (shipped) template drawn read-only it shows too.

**The bar.** **Save** and **Cancel**, plus **Back** to change the shape. Changing the shape keeps the modules in order and empties areas that no longer exist. Refusals from the server show under the shape in one line, in the server's own words.

**Where it opens.**
- **Templates:** the **Default Workspace** part of the host console's template editor and of Manage's own-template page. It replaces the Opens with list there (decision 12). On a fixed (shipped) template it is drawn read-only, as the other parts are. What the area chooser offers there: this template's modules.
- **A space:** the Layouts section of Set up's Modules tab gains **New layout for everyone**, shown only to those who may share (`canShare`). A shared shape row's **⋮** gains **Edit** (opens the picker on it), beside Rename, Change icon, Replace and Delete as today. **For everyone in this space** goes from the free-form save (decision 5). What the area chooser offers there: the modules on in the space. For everyone who may edit it (`canShare`; decision 19), a shared shape's row carries one line when any of its areas closes up for someone ("Guests won't see To-do."; suggested words). The picker and this row are the notice "on the layout itself" (decision 20); nothing is drawn on the canvas.

**Phones (640px and below).**
- On the canvas there are no columns, so the areas become the narrow layout's module tabs, in area order. An empty area is no tab, and neither is a closed-up one. This is today's rule for an arrangement on a phone.
- The picker itself works on a phone. The six drawings wrap to two rows, and step 2 is a list with one row per area ("Area 1", the module, the maker's notice under it, and a button to change it) in place of the large drawing. Every target is at least 44px (`check-phone-targets`). Today the Layouts section isn't drawn at 640px and below, so in a space the picker is reached on a phone only if that changes (open question 2).

**Guests.** No picker, as today. A guest loads a shared shape like any shared layout. An area they can't open closes up, and so does an empty one, since they have no chooser (decision 13).

## How this meets the draft in plan-workspaces

- **Template-defined workspaces (draft point 3, open question 8).** This plan gives a template one arrangement, the Workspace's starting one. It does not make template workspaces that are locked. If Thomas later decides templates list their own workspaces, the stored shape here is a likely form for each one, and that is the reason to keep it small and the same everywhere.
- **Moderator-made workspaces (draft point 4).** With decision 5 a shared layout is a shape that everyone sees at the same proportions, except where an area closes up for someone (decisions 13 and 18), which everyone who may edit it is told (decisions 17 and 19). It is still not locked: a person who moves things works in their own copy, as today. Whether a shared shape becomes locked is the draft's question, not this plan's.
- **Saved layouts and a Personal tab (draft open question 7).** Personal layouts stay free-form here (decision 15). Nothing here depends on how the draft settles them.

## Left to build, in order

Each step is one build, leaves the app working, and can be checked on its own. Size: S is about a short sitting, M about half a day, L a day or more.

| Step | Job | Agent | Files | Size | Risk |
|---|---|---|---|---|---|
| 1 | **Built and independently read** (commits `3694ab37`, `c5bebda8`, `fd946e56`). **The shape list and the stored shape.** `server/layout-shapes.js` with the six shapes, their percentage shares on the grid (decision 11; no width settings, decision 7), `cleanShape()`, which refuses Calendar, To-do, Maps and `dest:` ids in a stacked area (decision 8; To-do every time, which the rule in "To-do in a stacked area" narrows), and the pure `whoCantOpen()` (decision 17), answering `{ roles }` or `{ off: true }`, whose answer later goes to everyone who may edit a layout (decision 19). The page copy `public/layout-shapes.js`, and the check that the two agree and that the shares are on the grid. Nothing uses them yet | server-development | `server/layout-shapes.js`, `public/layout-shapes.js`, `tools/check-layout-shapes.mjs` | S | Low. Core: independent read |
| 2 | **Built and independently read** (commits `044d8954`, `d6af7f2d`, `7a1b4753`). **Placing a shape.** The pure `placeShape()` with widths from percentages, `loadLayout()` taking a shape, the empty-area placeholder with the chooser for areas the maker left empty only (decisions 3 and 18), closing up an area a person can't open, with no chooser in it and today's left-out note kept, and sharing out its space (decisions 13 and 18), no notice or mark on the canvas (decision 20), the narrow-layout order, and the too-narrow rule. Tried with a shape given by hand (a test hook or the console), since nothing stores one yet | experience-design | `public/layouts.js`, `public/canvas.js`, `public/space.js`, `public/style.css`, `tools/check-canvas.mjs` | L | **High:** layout and canvas work |
| 3 | **The template key.** `workspace.layout` in `server/templates.js` with `opensWith` removed (decision 12), the resolver and `for-space` serving it, the shipped files rewritten to Thomas's picks: `templates/default.json` gets `workspace.layout` `one` with its area empty (decision 14) and nothing else; `templates/games.json` is renamed Gaming (`name`), `workspace.opensFirst` becomes `conference`, `opensWith` is removed and it gets no `layout`; `templates/learning.json` is renamed Education, gains `"whiteboard": {}` in `modules` (decision 21) and gets `layout` `tall-split` `["whiteboard", "goals", "documents"]`; `templates/project.json` is renamed Projects and gets `layout` `wide-narrow` `["schedule", "todo"]` (decision 22); `templates/mentoring.json` gets `layout` `wide-narrow` `["documents", "goals"]` and `templates/travel.json` gets `layout` `wide-narrow` `["travel", "vault"]` (decision 24), each with `opensWith` removed, `cantOpen` on the routes that serve the template editors their modules, and `whatOpens()` step 3 reading the layout | server-development, then experience-design for `whatOpens()` and Set up's read-only line | `server/templates.js`, `server/store.js`, `server/index.js`, `templates/*.json`, `public/opens-with.js`, `public/space-setup.js`, `tools/check-templates*.mjs`, `tools/check-canvas.mjs` | M | Medium. Core (the stored template format): independent read |
| 4 | **The picker.** `public/layout-picker.js`: the two steps, the maker's notice under each area drawn from a given `cantOpen` (decision 17), the bar, the keyboard and screen-reader rules, the phone list. Its pure parts (what an area may hold, keeping modules across a shape change, the notice's words) run in node | experience-design | `public/layout-picker.js`, `public/style.css`, `tools/check-canvas.mjs` or a new `tools/check-layout-picker.mjs` | M | Medium |
| 5 | **The picker in the template editors.** The Default Workspace part of the host console's editor and of Manage's own-template page draws the picker in place of the Opens with list, with the notice from step 3's `cantOpen` ("by default" in the host console) | experience-design | `public/host-templates.js`, `public/host.html`, the Manage template page, `tools/check-admin-load.mjs` | S to M | Low |
| 6 | **Shared layouts as shapes.** Server half: `cleanLayout()` and the routes take `shape` and `areas` for a shared layout, refuse `modules` for one, and answer them in `GET .../layouts`, with `cantOpen` for everyone who may edit a shared layout, the owner, the admin and the space's moderators (decisions 17 and 19); stored free-form shared layouts dropped and test data reset (decision 5). Pages half: **New layout for everyone** and **Edit** in the Layouts section, the notice in the picker and on the shared row for everyone who may edit, and nothing on the canvas (decisions 19 and 20), the free-form shared save removed, and loading a shared shape through step 2 | server-development, then experience-design | `server/layouts.js`, `server/layout-shapes.js`, `server/index.js`, `tools/check-layouts.mjs`; `public/space.js`, `tools/check-nav.mjs` | M | Medium. Core (the stored layout format): independent read |
| 7 | **The documents.** architecture-canvas (placing a shape, the empty area, the closed-up area), architecture-navigation (the Layouts section and the maker's notice), api-modules (saved layouts and `cantOpen`), the template format in the API document, userguide-spaces and the template guide, and the CHANGELOG | content-manager | `documentation/` | S to M | Low |

Order: step 1 first. Steps 2 and 3 follow and can be built side by side. Step 4 needs step 1 only. Step 5 needs 3 and 4. Step 6 needs 1, 2 and 4. The full `npm run check` runs once at release prep, by the project manager. The core steps (1, 3 and the server half of 6) each get an independent read. This is a production build, so each step also gets its QA pass and its documentation before it is committed (`CLAUDE.md`); step 7 is the summary pass at the end.

**The freeze (decision 16).** The freeze starts on Friday 2026-12-11 (plan-templates-redesign, "What this does to the release"; plan-release, "The freeze"). It stops new routes, new stored keys and changes to a stored format, and this plan adds all three. Steps 1 to 6 must all be merged, with their reads, QA and documentation, by the end of Thursday 2026-12-10. There is no fallback: the space half (step 6) is not held back. Steps 1 to 6 are about three to four days of building, plus a day for each step's read or QA. The latest start for each step, counting back from 2026-12-10 along the order above (calendar days, weekends counted, since the builders are agents; if no work happens on weekends, every date before a weekend moves two days earlier):

| Step | Latest start | Build | Read, QA and documentation | Merged by | Waits for |
|---|---|---|---|---|---|
| 1 | Built 2026-11-18 (`3694ab37`, `c5bebda8`, `fd946e56`) | done | read done | done | Nothing |
| 2 | Built 2026-11-18 (`044d8954`, `d6af7f2d`, `7a1b4753`) | done | read done | done | Step 1 |
| 4 | Saturday 2026-12-05 | 12-05 to 12-06 | 12-07 | 12-07 | Step 1 |
| 3 | Monday 2026-12-07 | 12-07 | 12-08 (independent read) | 12-08 | Step 1 |
| 6 | Tuesday 2026-12-08 | 12-08 (server half), 12-09 (pages half) | the server half's read on 12-08 or 12-09; QA 12-10 | 12-10 | Steps 1, 2 and 4 |
| 5 | Wednesday 2026-12-09 | 12-09 | 12-10 | 12-10 | Steps 3 and 4 |
| 7 | With each step | | | 12-10 for the summary pass | Each step |

What that means for the schedule: the critical path is step 1, then step 2, then step 6, and these latest starts leave no slack on it. A slip in step 2 (the high-risk canvas step) moves step 6 day for day into the freeze, and nothing absorbs it. The same builders are also building plan-templates-redesign, which must land before the same freeze and changes the same template format (`server/templates.js`, `templates/*.json`). Step 1 is built (`3694ab37`). The planner's suggestion: have the project manager report to Thomas on any step that has not started by its latest start date, since what then happens is his call.

## Verify

- **Step 1, checked by a tool** (`tools/check-layout-shapes.mjs`). Every shape's area count matches its columns and stacks. Every share is on the grid (100, 50, two-thirds, one-third), and each shape's columns add up to 100. The two copies of the list agree. `cleanShape()` accepts each shape with modules and with `null`s, and refuses an unknown shape, a wrong length, a module twice, `chat` or `conference` in an area, and a composite in a stacked area. Each refusal is one sentence. `whoCantOpen()` lists the right roles for a module from manifest defaults and from a changed set of role permissions, never lists the owner or admin, and marks a module that is off.
- **Step 2, checked by a tool:** `placeShape()` in node, for each shape at 1600, 1000, 800, 700 and 390px: the column widths from the percentages, the stacks, an empty area, a closed-up area and how its space is shared out (each case under "Placing a shape on the canvas"), every area closed, and area 3 of `three-equal` waiting below 760px. **Live in headless Chromium** (by the builder), light and dark, at 1280, 900, 700 and 390px: each shape opens as drawn; the chat column is unchanged; an empty area shows the chooser, and choosing fills it; closing a placeholder closes up the area; an area whose module this person can't open is closed up, not shown empty and with no chooser, and the left-out note names the module; a member can still open another module from the Modules tab; no notice or mark is drawn on the canvas; after a reload the person's own arrangement opens, not the shape again (decision 2). **Can't be checked without a real LiveKit call:** a shape with the call **In the workspace** and real tiles, and loading a shape while on a call (the conference kept).
- **What the independent reads of steps 1 and 2 found** (2026-11-18, as reported by the project manager; not repeated here). Maps and Calendar are never placed in a stacked area. The page's rules and the server's agree on 1,680 cases. Where the Calendar is on, a `todo` that can't be placed is named in the note "To-do is part of the Calendar here, so it was left out." Two minor items are left open from the read: the sentence saying an empty area waits is always singular, even when more than one waits; and the note can name a Calendar that is off in the space.
- **Step 3, checked by a tool.** A template with `layout` is accepted and one with `opensWith` refused (decision 12). An area naming a module outside the template is refused. Each shipped file passes, and Default's is `one` with its area empty. `cleanShape()` accepts `todo` in a stacked area when `calendar` is not on, and refuses it when it is. `for-space` serves the layout. The template editor's route answers `cantOpen` from manifest defaults in the host console and from the environment's Roles in Manage. `whatOpens()` opens the layout on a first visit and not after. **Live in Chromium:** a new space of each template opens its shape on the first visit, and a Default space opens one empty area with the chooser.
- **Step 4, checked by a tool** for the pure parts, including the notice's words for one role, several roles and a module that is off. **Live in Chromium:** keyboard only (arrows on the shapes, Tab through the areas, the menu by Enter), light and dark, at 1280 and 390px, the notice shown under an area given a `cantOpen` entry, and an accessibility-tree read of the radio group, the area labels and the notice. A real screen reader: not checked here.
- **Step 5, checked by a tool:** `check-admin-load` opens the template pages at 1280 and 390px with no page error. **Live in Chromium:** the host console edits a copy's layout, saves, and the space opens with it. A module with guest access off by default shows "Guests can't open this by default." A shipped template shows the picker read-only, with its notices.
- **Step 6, checked by a tool:** `check-layouts` round-trips a shared shape. It refuses `modules` on a shared layout (decision 5), and `shape` on a personal one. A stored free-form shared entry is left out of the answer. A member and a guest get `403` making one, and no `cantOpen` in the answer; an owner and a moderator get `cantOpen`. An Aside gets `404`. A shape naming a module later turned off is answered unchanged, with that module marked `off`. **Live in Chromium,** as owner, moderator, member and guest: the owner turns off guest access to To-do in Roles, makes a shared layout with To-do in area 2, and sees "Guests can't open this" under that area in the picker and a line on the layout's row; a moderator who did not save it sees the same notice and line; the owner loads it and sees nothing about it on the canvas; the member loads it and sees the whole shape; the guest loads it and area 2 is closed up, with area 1 taking its width. Nobody gets a message or notification.
- **Always:** `npm run check:docs` for the documents. The full `npm run check` runs at release prep. Not checked by any step: a real phone, a real screen reader, Firefox, Safari, a real call.

## Risks, ranked

1. **Both halves before the freeze, with no fallback (decisions 4 and 16).** Two stored formats (template and shared layout), two entry points, the maker's notice and the canvas work all land by 2026-12-10, with no slack on the critical path (steps 1, 2 and 6). Mitigation: step 1 is built; build the shared parts once (steps 1, 2 and 4), keep to the latest starts under "The freeze", and have the project manager report a missed start to Thomas at once.
2. **Canvas work (step 2).** An empty area, a closed-up area and placing by percentages touch the column rules (`fitDock()`, the flexible column, stacks). A wrong change squeezes the chat column or leaves a dead column. Mitigation: a pure `placeShape()` checked in node, the existing column rules left to decide fit, and live checks at four widths.
3. **The same files as plan-templates-redesign, before the same freeze.** Step 3 changes the template format and the six shipped files that plan-templates-redesign is also changing. Mitigation: the project manager orders the two so step 3 is built on top of that plan's template changes, not beside them.
4. **A shared layout can look different to different people (decision 13).** An area closes up for those who can't open its module, so the shape changes for them without anyone choosing it. Mitigation: the notice to everyone who may edit the layout (decisions 17 and 19). Two members can see different shapes from one shared layout; Thomas accepted this (decision 18).
5. **Losing free-form shared layouts (decision 5).** Stored free-form shared layouts are dropped, and an owner who floats a module over the map for everyone can't do so any more. Thomas accepted this. Mitigation: personal layouts stay free-form.
6. **Composites can't stack (decision 8).** In shapes 5 and 6 (`tall-split`, `wide-split`), Calendar and Maps can only go in area 1, and To-do too where the Calendar is on. The picker doesn't offer them in areas 2 and 3, and the check refuses them. This is why Mentoring and Travel wait for To-do's own window. The stacking rule is not changed.
7. **A shape larger than the window.** `three-equal` below 760px of canvas shows two columns and one module floating. Mitigation: today's note says why. The picker could say "Needs a wide window" under shape 4 (suggested).

## Rollback

There is no setting. Each step is its own commit. Reverting step 6 returns shared layouts to free-form only (with test data reset again; the dropped free-form shared layouts do not come back). Reverting steps 3 and 5 together returns templates to `opensWith`. Step 2 can stay unused. Any revert after 2026-12-10 is a change during the freeze, which only Thomas allows (plan-release decision 20).

## Not in this plan

- Locked workspaces from a template or a moderator (the draft in plan-workspaces).
- Putting the chat or the call in an area (decision 1).
- Floating modules in a shape. A person floats things afterwards in their own arrangement.
- Shapes for the Fixed Workspaces (Calendar, Map, Conference, Whiteboards, Documents). They stay as they are.
- A personal layout made with the picker (decision 15).
- Width settings or drag handles in the picker (decision 7).
- Changing the rule that composites never stack (decision 8).
- A message or notification to the maker when someone can't open part of a layout (decision 17: the notice is seen only when looking at the layout).
- A notice or mark on the canvas, for anyone (decision 20).
- A chooser in an area that closed up (decision 18).

## Open questions for Thomas

Each has the planner's suggestion. The second draft's questions on the shapes, how a shape is stored, the template key, a module a person can't open, the Default template, personal layouts and the freeze are answered (decisions 9 to 16). The third draft's questions on a closed-up area beside decision 3 and on who sees the maker's notice are answered (decisions 18 to 20). Thomas answered the fourth draft's question 5 (decisions 21 and 22) and the fifth draft's question 5 (decisions 23 and 24). None of the four left blocks a step.

1. **The call "In the workspace" with a shape.** Suggested: the call takes its own column first and the areas share the rest. Does not block.
2. **The picker on a phone in a space.** Today the Layouts section isn't drawn at 640px and below. Should an owner be able to make a shared layout on a phone? Suggested: no; the picker on a phone is for the template editors. Does not block.
3. **The words a person reads.** "Area", "Pick a shape", "Choose modules", "New layout for everyone", "Empty", the six shape labels, and the maker's notice ("Guests can't open this. For them, this area closes up.", "Off in this space. This area closes up for everyone.", "Guests won't see To-do."). Suggested as written; "area" is a new word, and it does not collide with the Names. Does not block.
4. **The Calendar turned on after To-do was stacked.** With the rule in "To-do in a stacked area", a shared shape may stack `todo` in a space where the Calendar is off. If the Calendar is later turned on there, `todo` reads as the Calendar composite, which can't stack. Step 2 as built closes that area up and the left-out note says "To-do is part of the Calendar here, so it was left out."; the stored layout is not changed. Suggested: keep that. Does not block.
