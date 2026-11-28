# Projects Sizing and Burndown Plan

**Audience:** Thomas, who decides; server-development, which builds the shared chart piece's check and any server part; experience-design, which builds the shared chart piece and the Projects view; the Planner - Projects module agent, which builds the module's part in its own lane.

**Status:** Draft for Thomas, 2026-11-28. Nothing is decided and nothing is built. Thomas's idea, relayed by the project manager: sizing and a burndown chart in Planner - Projects. The direction he was given and is weighing (not decided): sizing is a field on the work, points or T-shirt sizes per template; the burndown is a view in Projects of size left against time, with the phases as the period; the chart is Budget's "target left over time" made into one shared SDK piece; Budget stays money only; logged hours and timesheets are a possible later module, not now.

## What it is today

- **Fields on work.** Planner - Projects (`modules/schedule`, 0.1.26) already stores fields a plan defines: each is a `field:<id>` record `{ id, label, options: [{ id, label }], order }` (`scCleanField` in `schedule-lib.js`), at most 8 fields and 30 choices, and each piece of work holds one choice per field in `fields` (`FORMAT.md`, "The fields"). Defining a field needs the `columns` right ("Change the board's columns and fields", a `guards.keys` rule on `field:{id}`); setting a choice needs `edit`. The Board's filters and its **Rows** already work by field (`rowsBy: "field:<id>"`). `addWork` already takes `fields` ("area=planner; phase=first"), so an agent can set a choice. A field's choice has no number, and a template cannot seed a field today: a template sets module settings only (the board's default columns come from the `boardColumns` setting until a stored `board:main` wins, the same pattern this plan reuses).
- **Done has no day.** Work stores `done` as a boolean (`scClean`, `scSetDone`, `scSetColumn`); nothing records when it became done. A burndown of what is actually done needs that day.
- **Pulled work.** A space that follows GitHub may change only its own fields on pulled work (`OWN_FIELDS` in `server/issues.js`: owners, waitsOn, start, end, rank, fields), so a size kept in `fields` can be set on pulled work with no new exception. The pull knows an issue's closed day.
- **The chart.** Budget (`modules/budget`, 0.1.33) draws its burndown by hand in `budget.js` (`drawChart`, an SVG): a step line for what is paid, a dashed one for "if all planned is spent", the phase bands behind from `host.util.phaseTimeline()` in each phase's own colour, a Today line, a legend and the same in words under it (`burndownWords`). The numbers come from `burndown(costs, { target, dates })` in `budget-lib.js`. There is no chart piece in `public/sdk/host.js`; `host.ui.board` is a board only.
- **Budget's unit.** [plan-templates-redesign](plan-templates-redesign.md) decision 21 gives Budget a `unit` (money, hours or effort) set by the template, one per space, with Projects as "time and effort (money optional)". It is not built: Budget's manifest has no `unit`, and its user guide says Budget counts money under every template. `templates/project.json` names the module "Budget".

## Why sizing is not Budget's unit

A project may want both what it costs and how much work is left. Budget's unit is one choice per space (decision 21), so a space that counts effort in Budget cannot count money there too, and the other way round. Effort in Budget would also be a second list, kept apart from the work: a cost has a category, a payer and a share, not an owner, a column or a done tick, so each piece of work would be entered twice and the two would drift. A size belongs on the work itself and comes off when the work is done, which is what a burndown counts. So sizing lives in Planner - Projects, and Budget can stay money in every template.

This touches decision 21. If Budget stays money only, its hours and effort units have no use left for Projects; Learning and Mentoring still name "Time" in hours. That is question 2 below.

## Options

### A. Where the size lives

- **A1. A size field: one of the plan's fields, whose choices carry a number (lean).** A field record gains `size: true` (at most one field per plan) and each choice an optional `value` (a number, 0 to 999). Points are choices named 1, 2, 3, 5, 8, 13 with those values; T-shirt sizes are XS, S, M, L, XL with values the plan sets (1, 2, 3, 5, 8 to start). Costs: two optional keys in the field's format, the schema and the guard. Gains for free: the form's field control, the filters, rows by size, `addWork`'s `fields` input, file import and export, and pulled work. Rules out: a size that is not one of a short list (no 2.5).
- **A2. A `size` number on work, with a `sizing` switch.** A new stored key on work, its own form control and its own action input. Costs more and duplicates what fields do; T-shirt sizes still need a number behind each.
- **A3. A free estimate in hours or days.** Rules out T-shirt sizes and drifts into timesheets, which the direction keeps for later.

**Per template (lean, with A1):** a setting `sizing` (`choice`, space scope, `template: "default"`): `off`, `points` or `tshirt`. While no size field is stored, the page and the server read a default size field from this setting, as the board's columns are read from `boardColumns`; the first edit stores the record and from then on the record wins. The Projects template sets `points`; the others leave it `off`.

### B. When size comes off

- **B1. A stored done day, and two lines (lean).** Work gains `doneOn` (a day), written whenever `done` turns true (the tick, a move into a done column, `setDone`, `setColumn`) and removed when it turns false. Pulled work takes the issue's closed day. The chart draws "Done" from `doneOn`, and "Planned" from each piece of work's end day, which is Budget's paid and expected lines in other words. Costs: one stored key and the pull writing it.
- **B2. The end day only.** No new key, but it shows the plan, not what happened: late work still looks burned down.
- **B3. A daily snapshot of what is left.** Shows scope added later, but needs a timer and stored history. Not leaned.

### C. The shared chart piece

- **C1. `host.ui.burndown(el, options)`, a burndown only (lean).** Draws what Budget draws today from data it is given; knows nothing about money or work. Budget moves onto it with no visible change; Projects is its second user.
- **C2. A general line chart.** More than two users need; harder to keep to one contract.
- **C3. Projects copies Budget's chart.** Ruled out by the core rule that a drawn piece is built once in the shared SDK (CLAUDE.md, Rules; [plan-core-parts](plan-core-parts.md)).

### D. Where the burndown shows in Projects

- **D1. A fourth view on the view switch, "Burndown" (lean),** shown only while sizing is on, as the Board is a view ([plan-projects-kanban](plan-projects-kanban.md) decision 9).
- **D2. A panel above the Board.** Crowds the Board on a phone.

## Taken on the planner's lean

Small choices, written down so the build has no gaps; Thomas may overturn any of them.

- Work with no size counts 0 and the view says how many have none ("4 pieces of work have no size."). Milestones and notes have no size.
- The total is the sum of the sizes now; size added later raises the start of the line (no history, option B3 not taken).
- The range runs over the space's phase dates; with none, from the earliest start to the latest end of the work. A `doneOn` outside the range widens it, as Budget's costs do.
- A card shows its size as a small chip; column totals are not drawn in this build.
- A size is the space's own and never sent to GitHub, as every field is.
- Filters on the Board do not change the burndown in this build.

## The contract

### Planner - Projects (`modules/schedule`, module lane)

- **Stored:** a field record may hold `size: true` and each choice `value` (a number from 0 to 999). Only one field per plan may be the size field; a second is refused ("A plan has one size field."). Work gains `doneOn` (`YYYY-MM-DD`), kept by `scClean` on work only, written by `scSetDone` and `scSetColumn` with `done`, and cleared with it. `FORMAT.md`, `project-plan.schema.json` and the `field:{id}` guard follow. The format stays version 1 (nothing is released).
- **Setting:** `sizing` (`off` | `points` | `tshirt`, default `off`, `template: "default"`); `scSizeFieldOf(ctx)` answers the stored size field, else the setting's default (`size`, "Size").
- **View:** **Burndown** (icon `chart-line`) on the view switch while a size field exists. It passes the piece the total, the "Done" series from `doneOn`, the "Planned" series from end days, the phase bands, and its words ("12 of 40 points left").
- **Actions:** none new; `addWork` and `updateEntry` set the size through `fields`; `setDone` and `setColumn` write `doneOn`.

### The shared piece (`public/sdk/host.js`, `public/sdk/system.css`, core)

`host.ui.burndown(el, options)` returns `{ set(options), destroy() }`. Options: `total`, `series: [{ id, label, points: [{ day, left }], kind: "solid" | "dashed" }]`, `from`, `to`, `bands?` (as `host.util.phaseTimeline()` answers), `format(n)` for the numbers, `words` (the sentence under the chart), `empty` (what it says with nothing to draw). It draws Budget's chart as it is today: step lines, the guides, the phase bands in each phase's colour, Today, the legend and the words, every colour a theme token, resized with its box, `role="img"` with the words as its text.

### Server (core)

- The pull writes `doneOn` from an issue's closed day, and removes it when the issue reopens (`server/issues.js`).

## Left to build, in order

1. **The size field and the done day** (Planner - Projects module agent; module lane; patch bump). Stored keys, `sizing`, `scSizeFieldOf`, the card chip, `FORMAT.md` and the schema, tests in `modules/schedule/test/`.
2. **`host.ui.burndown`** (experience-design; core). The piece, its styles, `tools/check-burndown.mjs` (server-development), a Design System entry.
3. **Budget onto the piece** (Budget's module agent; module lane; patch bump). No visible change.
4. **The Burndown view** (Planner - Projects module agent; module lane; patch bump). Needs 1 and 2.
5. **The pull's done day** (server-development; core). Can run beside 4.
6. **The Projects template turns sizing on** (`templates/project.json`; after the builder now editing that file is done).

## Verify

- Step 1: `npm run check:module -- schedule`; cases: one size field only, `doneOn` set and cleared by each way of marking done, a file with sizes, pulled work sized.
- Step 2: `node tools/check-burndown.mjs` in Node and headless Chromium at 1280 and 390, light and dark; the Design System check.
- Step 3: `npm run check:module -- budget`, and the Overview compared by screenshot before and after.
- Step 4: `npm run check:module -- schedule`, then live on a local server in headless Chromium.
- Step 5: `node tools/check-issues.mjs`.
- Not checkable here: the view inside a space's canvas during a call (no LiveKit server locally; read as code only).

## Open questions

1. **Where the size lives** (blocks step 1): A1, a size field (lean); A2, a `size` number; A3, a free estimate.
2. **Budget's unit** (blocks nothing here, but changes decision 21): drop the unit and keep Budget money only everywhere (lean, with hours left to a later timesheets module); keep the unit for Learning and Mentoring only; keep decision 21 as it is.
3. **When size comes off** (blocks step 1): B1, a stored done day and two lines (lean); B2, the end day only.
4. **The chart piece** (blocks step 2): C1, a burndown piece (lean); C2, a general line chart.
5. **The view's name:** "Burndown" (lean), or a plainer word such as "Progress".
