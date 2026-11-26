# Projects Board Plan

**Audience:** Thomas, who decides whether Planner - Projects gets a board and how it works; experience-design, which builds the view (and the shared board piece, if he wants one); server-development, which builds the rule, the action and the checks.

**Status:** For Thomas to decide, 2026-11-26. Nothing decided, nothing built. From GitHub issue #1144, Thomas, 2026-11-26: "another ask for Planner - Projects, a kanban view (a board of columns, one per status, with the work as cards to move between them)." The issue's own leans are answered below, and one of them (columns from [plan-object-status](plan-object-status.md)) is recommended against, with the reason.

## What it is today

- **Planner - Projects** is `modules/schedule` (0.1.12). It holds milestones, work and notes (`SC_KINDS`), each stored under `SC_PREFIX` in the module's own data. Its two views are **Timeline** and **List**, on the module's toolbar through `host.ui.viewSwitch` (`schedule.js:213-224`), and the view a person picks is kept in their browser (`schedule-view:<space>`). The `defaultView` setting offers Timeline or List; a phone opens on the List.
- **Work has no status, only `done`** (a boolean, `scClean` and `scValue` in `schedule-lib.js:65-108`). A milestone's `done` follows from what is under it, or its tick. A note has none. The summary maps `done` and `progress`, and the phase measure, the Calendar and the title bar's count ("2 of 4 milestones done") all read `done`.
- **Object status is not built anywhere.** [plan-object-status](plan-object-status.md) (approved 2026-09-24) gives an object `action`, `tentative` or `confirmed`, says status is separate from `done` (decision 6) and changes only the Itinerary (decision 10). No code has it: there is no `host.objects.statuses` or `host.ui.status`, and the Itinerary has no `status` field.
- **The List already moves things by drag, menu and keyboard** through the shared `host.ui.outline` piece (`public/sdk/host.js`, `createOutline`): a handle to drag, the handle's menu through `host.menu.show`, **Alt** with the arrows on the focused handle, no dragging on a phone (the handle is "..."), and a polite live line that announces a move. Its rules are in [api-module-sdk](../api/api-module-sdk.md), "The shared outline pieces", and its look in [design-theme](../designsystem/design-theme.md). No module has a board; Research's Cards view is a grid, not columns. The Design System's panel picture already shows a **Board** view option with the `table-columns` icon (`public/design-system/components-2.js`).
- **Agents.** The module's actions (`addMilestone`, `addWork`, `addNote`, `setDone`, `updateEntry`) are one library, `schedule-lib-actions.js`, run by the server for an agent and by the page through `host.actions.fromLibrary` for a person's request, with the same answer ([plan-agent-server-actions](plan-agent-server-actions.md), step 7, Planner - Projects 0.1.11). An agent's change is listed under **What it changed** with **Undo** ([plan-agent-edit-delete](plan-agent-edit-delete.md), decisions 3 and 6). A person's tick and the List's moves are written by the page directly (`toggleDone`, `moveEntry`), not through an action.
- **Permissions:** `view`, `edit`, `clear`. Changing the plan needs `edit`.

## Decisions

None yet. Each question below has a recommendation; the contract is written on the recommendations so it can be built as soon as Thomas agrees or changes them.

## The questions, with a recommendation each

### 1. The columns

| Option | What it costs | What it rules out |
|---|---|---|
| **A. Two columns from `done`** (To do, Done) | Nothing new stored; agents already have `setDone` | Not much of a board: no "in progress" |
| **B. Three fixed columns: To do, Doing, Done** | One new optional field on work, one rule and one action; Done stays `done`, so every reader of `done` is unchanged | Custom columns (Review, Blocked) until a later change |
| **C. Custom columns per space** (a list setting like Tags, the last one meaning done) | A setting, a stored column id, a rule for a removed column, a template default, more checks | Nothing, but the most to build and to explain |
| **D. The object status values** (Action required, Tentative, Confirmed), the issue's lean | The whole of [plan-object-status](plan-object-status.md) steps 1 and 2 first, which are core and unbuilt | Reads wrong: those values say how settled something is, not how far along; Done would sit outside them (decision 6 there) |

**Recommended: B.** It keeps the board and the List agreeing by construction (Done is `done`), touches nothing that reads `done`, and is small. D is recommended against: it would extend plan-object-status past decision 10 (that plan changes only the Itinerary; other modules "may map it later") before any of it is built, it cannot hold Done because of decision 6 there (status is separate from `done`), and its words don't describe work moving forward. If object status is built later, its chip can go on a card without changing the columns.

- **Work with nothing set** sits in **To do**. Every piece of work is in exactly one column; nothing is left out.
- **Who may change the set:** nobody under B (fixed). A template may rename the three words through the module's `labels` (the Gaming template could say "Planned", "Prepping", "Ready"). Under C it would be an owner, through the module's settings.
- **Milestones and notes are not cards.** A milestone's done follows from its work, so moving it would fight that rule; a note has no done. A card says which milestone it is under (question 4), and the board can be filtered by milestone (question 5).
- **Waits on** is not a column. A card whose work waits on something not done shows a small "Waits on" mark.

### 2. Moving a card

- **Drag** a card to another column. On a phone or a touch screen there is no dragging, as in the outline.
- **Without dragging:** the card's "..." (`host.ui.moreButton`) opens `host.menu.show` with **Move to To do**, **Move to Doing**, **Move to Done** (the current one left out), then **Edit** and **Delete**, as the List's row menu has.
- **Keyboard,** on a focused card: **Up** and **Down** walk the column, **Left** and **Right** go to the next column's nearest card, **Alt+Left** and **Alt+Right** move the card one column (the outline's Alt arrows, so one habit serves both), **Enter** opens it.
- **At 390 wide:** three columns do not fit. Options: (a) the columns stacked as sections, each with its heading and count, Done folded by default; (b) one column at a time with sideways swipe and snap; (c) a switch above choosing one column. **Recommended: (a).** Everything is visible by scrolling down, there is no gesture to discover, and the move is the "..." menu, as the List's is on a phone. The board is never the phone's first view unless the person chose it.
- **Order inside a column:** options are (i) not stored, sorted by the work's end day (none last), then its place in the outline; (ii) a stored board order of its own; (iii) dropping reorders the outline. **Recommended: (i).** A second stored order would disagree with the outline, and (iii) would move things in the List by surprise. Dropping a card places it by its column only, and the drop shows the column, not a slot.

### 3. Where it lives

A third option, **Board** (icon `table-columns`), on the existing view switch, not a new module. **Recommended: yes,** as the issue says. The `defaultView` setting gains Board as a third choice. The view a person picks is kept as the others are.

A word on names: "card" here means only the drawn box on the board, as Research's Cards view uses it. What it shows is a piece of work, an object; code and words a person reads say "work" (the template's word), never "card" or "item" for the thing itself (CLAUDE.md, Names).

### 4. What a card shows

Small and readable at 390 wide, in this order:

- the title (two lines at most, then cut with an ellipsis; the full title is the card's name for a screen reader);
- one line: the end day (or "No date"), "Late" when it is late, and who is doing it (names, "and N more" after two);
- the tags as the List's chips, two at most and "and N more";
- the milestone it is under, in quieter words, and the "Waits on" mark when it applies.

Not on a card: notes, linked objects, the phase (unless a filter needs it). **Recommended** as listed. Clicking a card opens the editor, as a row does.

### 5. Filters, grouping and swimlanes

- **Filters:** one **Filter** button in the toolbar (`host.ui.toolbarButton` and `host.menu.show`, as Research's Tags) with **Who** (Everyone, Mine, each person, No one), **Tag**, **Phase** and **Milestone**. Kept per person in the browser, as the view is. They apply to the Board only; the List and Timeline have none today, and adding them is a separate ask.
- **Grouping and swimlanes:** **recommended: left out.** Rows across the columns (by person, phase or milestone) double the layout work, do not fit at 390, and the filters answer the same question ("what is Ana doing?"). They can be a later change if the board is used.

### 6. Agents

- **One rule, one action.** A new action `setColumn` (`{ ref, column: "todo" | "doing" | "done" }`, label "Move it on the plan's board") in `schedule-lib-actions.js`, carried out by the server for an agent, as the others are. Nothing waits for a page.
- **A person's move uses the same handler.** The board calls the library's handler in the page (as `host.actions.fromLibrary` does), so a drag, the menu, the keyboard and an agent give the same writes and the same refusals. The module's tests already require the page and the server to answer alike.
- **Undo:** an agent's move is listed under **What it changed** with **Undo**, with no new work, because it goes through the runner. A person's move has no Undo bar; moving it back is the undo, as the tick is today.
- An open board shows another person's or an agent's move live, as the List does.

**Recommended** as listed. This extends the earlier pattern: today a person's tick does not go through an action; the board's moves would, and the List's tick could follow later.

### 7. Permissions and version

- Moving a card needs **Add and change the plan** (`edit`). No new permission. Someone without it sees the board, cannot drag and gets no Move choices in the menu.
- Each try build that changes the module bumps its patch version (0.1.12 to 0.1.13 and so on) in `modules/schedule/module.json` and `tools/module-versions.json`.

### 8. Accessibility

- The board is a set of lists, one per column, each named by its heading and count ("Doing, 3"). Each card is one tab stop at a time (roving focus), so Tab leaves the board in one step.
- A move is announced in a polite live line: "Moved "Write the brief" to Doing." The focus stays on the moved card.
- Never colour alone: the column is in words, Late is a word, Done carries the check icon.
- 44 px touch targets on a phone, the motion stops under reduced motion, and every colour is a theme token ([design-theme](../designsystem/design-theme.md)), including the drop highlight (the "Drag targets" rule there).

### 9. Where the board itself is drawn

| Option | Cost | What it rules out |
|---|---|---|
| **A. A shared SDK piece, `host.ui.board`,** beside `host.ui.outline` | Core work: the piece, its styles in `/sdk/system.css`, its own check and a Design System entry | Nothing; To-do or Research could use it later |
| **B. Drawn inside `modules/schedule`** | Module lane only, smaller | A second board elsewhere would copy it, against the rule that a drawn piece lives in the SDK once |

**Recommended: A,** because the core rule (Thomas, 2026-11-19) is that shared drawn pieces live in the SDK, and the outline set the pattern. If Thomas wants the board sooner and cheaper, B is a fair try build, lifted into the SDK if a second module wants it.

## The contract (on the recommendations)

### The data and the rule (`modules/schedule/src/schedule-lib.js`)

- Work gains `doing`: `true` or absent. `scClean` keeps it only on work that is not done; `scValue` writes it only when true. A milestone or a note never has it.
- `scColumnOf(e)`: `done` for done work, `doing` when `doing` is set, else `todo`.
- `scSetColumn(e, column, { label })`: answers `{ entry }` or `{ problem }`. `done` sets `done: true` and drops `doing`; `doing` sets `done: false, doing: true`; `todo` sets `done: false` and drops `doing`. A milestone or a note is refused with one sentence ("Only work moves on the board."); an unknown column is refused.
- `setDone(true)` drops `doing`; `setDone(false)` leaves the work in To do.
- `FORMAT.md` and `project-plan.schema.json` gain the optional `doing` field; the format stays version 1 (nothing is released).

### The action (`schedule-lib-actions.js`, `module.json`)

- `ACTION_HANDLERS.setColumn: (input, ctx) => scChange(input, ctx, (e, f) => scSetColumn(e, input.column, { label: f.label }))`, so the milestones' done and progress follow in the same answer.
- The manifest's `actions.provides` gains `setColumn`, `effect: "write"`, input `{ ref: "ref:schedule:plan", column: "string" }`, with an input hint naming the three values.

### The SDK piece (`public/sdk/host.js`, `/sdk/system.css`)

`host.ui.board(el, { columns: [{ id, label, icon? }], entries, columnOf(entry), card(entry, el), menu?(entry), canEdit?, name?, labels?, onOpen?(entry), onMove({ id, column }) })` returns `{ set(entries), focus(id), destroy() }`. It draws the columns, the cards' frames, the drag (its own drag type, as the outline's), the keyboard, the "..." menu with the Move choices first and the module's own after, the stacked phone layout at 640 px and narrower or a coarse pointer, and the live line. It writes nothing: the module writes on `onMove` and calls `set()`. Words it says itself are replaceable through `labels`, as the outline's.

### The view (`modules/schedule/src/schedule.js`, `schedule.html`, `schedule.css`)

- **Board** on the view switch; `defaultView` gains `board`.
- The columns' words come from `labels` (`todo`, `doing`, `done`, defaults "To do", "Doing", "Done").
- Cards are work only, sorted as question 2 says, drawn as question 4 says.
- `onMove` and the menu run the `setColumn` handler in the page and redraw from its writes.
- The **Filter** button and its four groups (question 5), kept under `schedule-board-filter:<space>`.
- The List and Timeline show "Doing" in an entry's words under its title, so all three views agree.

## Left to build, in order

Each is a try build unless Thomas calls another kind.

1. **The rule and the action** (server-development; module lane; small). `doing`, `scColumnOf`, `scSetColumn`, `setColumn` in the library and the manifest, `setDone` dropping `doing`, `FORMAT.md` and the schema, and the tests: the rule's cases in `check-schedule-lib.mjs`, the action both ways (page and server alike) in `check-schedule-lib-actions.mjs`, the manifest in `check-schedule-actions.mjs`, the file field in `check-schedule-file.mjs` and `check-schedule-schema.mjs`. Version bump.
2. **The shared board piece** (experience-design; core; medium to large; skipped under option 9B). `host.ui.board`, its styles, `tools/check-board.mjs` (the pure parts in node, the drawn piece in a browser, as `check-outline.mjs`), and the Design System's component entry. The API lines go to content-manager in the report.
3. **The Board view** (experience-design; module lane; medium). The view switch option, the setting's third choice, the labels, the cards, the moves through `setColumn`, "Doing" in the List and Timeline. Version bump.
4. **The filters** (experience-design; module lane; small). The Filter button and its four groups, remembered per person. Version bump.

Documentation, when Thomas calls a feedback or production build (content-manager): the Planner - Projects user guide (the Board, the filters, the agents line, which still says an agent's change waits for an open page, out of date since 0.1.11), [api-module-sdk](../api/api-module-sdk.md) for `host.ui.board`, and design-theme for its look.

## Verify

- **Step 1.** Checked by a tool: `npm run check:module -- schedule`.
- **Step 2.** Checked by a tool: `node tools/check-board.mjs`, `node tools/check-switches.mjs`, `node tools/check-radius.mjs` and the Design System's own check; and live in headless Chromium on the Design System page at 1280 and 390, light and dark: drag, the menu, the keys and the announcement.
- **Steps 3 and 4.** `npm run check:module -- schedule`, then live on a local server in the module's own page, in headless Chromium at 1280 and 390 wide, light and dark: drag a card between columns, move one from its menu and by the keys, the live line, Done folded at 390, the filters remembered after a reload, the List showing "Doing", and a second browser seeing the move. An agent's `setColumn` through an agent token on the same local server: the card moves on the open board, and **What it changed** offers Undo that puts it back.
- **Not checkable here:** the board inside a space's canvas during a call (no LiveKit server locally; read as code only), a real phone's touch, and a real screen reader (the live line is checked by reading its text, not by hearing it).

## What is not decided

1. **The columns:** B (To do, Doing, Done) as recommended, or A, C or D. This blocks every step.
2. **Where the board is drawn:** the shared SDK piece (9A) or inside the module (9B). Blocks step 2 and the shape of step 3.
3. **The phone layout:** stacked sections, as recommended, or one column at a time. Blocks step 3.
4. **Order inside a column:** not stored, sorted by end day, as recommended. Blocks step 3.
5. **A person's move through the action** (question 6): the board's moves run the `setColumn` handler. Thomas may also want the List's tick moved onto `setDone` the same way; that is a separate small change and blocks nothing here.
6. **Filters on the Board only**, as recommended, or on all three views. Blocks step 4 only.
7. **The column words for the Gaming template,** if it should rename them. Blocks nothing; the defaults serve until then.
