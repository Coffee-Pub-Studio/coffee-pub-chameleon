# Projects Board Plan

**Audience:** Thomas, who decided how the board works; experience-design, which builds the shared board piece and the view; server-development, which builds the rule, the action and the checks.

**Status:** Decided by Thomas, 2026-11-26; steps 1 to 5 are built (and the order inside a column, below), the second build (rows and filters, step 5) as steps 5a and 5b, all as try builds; documented 2026-11-26. From GitHub issue #1144, Thomas, 2026-11-26: "another ask for Planner - Projects, a kanban view (a board of columns, one per status, with the work as cards to move between them)." The columns were then discussed the same day as "foundational and bigger than a 'choose one'", against two references: Thomas's own board (Inbox, Now, Next, Later, Done: a priority horizon, with a count per column, a "..." menu and a "+" to add into a column) and a friend's dense board (columns as stages, swimlanes by epic, filters, WIP counts, density zoom, a time axis), which is not to be copied whole. The earlier recommendation of three fixed columns (To do, Doing, Done) is replaced by the decisions below.

**Second build:** Thomas, 2026-11-26: "start the second kanban build (swimlanes and filters)." Planned in detail below ("The second build: swimlanes and filters"), on the planner's leans under Thomas's standing rule; the leans taken are listed there.

**Progress:** Step 2 is built (try build, 2026-11-26): `host.ui.board` in `public/sdk/host.js`, its `board` block in `public/sdk/system.css`, `tools/check-board.mjs` (in `npm run check`) and a Board entry with a live piece on the Design System page. It takes cards as `{ id, column, title? }` and draws each card's inside through `card(card, contentEl)`; `set(cards, columns?)` redraws; a move into a folded column opens it; the stacked layout starts every done column folded and does not keep that choice. Rows were accepted and not drawn at step 2; step 5a draws them. Steps 1, 3, 4 and 5 are built (see Progress below). Documented (2026-11-26): [userguide-planner-projects](../userguides/userguide-planner-projects.md) ("The Board", "Rows and filters"), [api-modules](../api/api-modules.md) and [architecture-modules](../architecture/architecture-modules.md) ("The Projects board") and [api-module-sdk](../api/api-module-sdk.md) (`host.ui.board`). Since step 5b, a space that follows a GitHub pull ([plan-github-pull](plan-github-pull.md)) has its board set to the five priority columns and read-only.

## What it is today

- **Planner - Projects** is `modules/schedule` (0.1.12). It holds milestones, work and notes (`SC_KINDS`), each stored under `SC_PREFIX` (`plan:`) in the space's module data. Its views are **Timeline** and **List**, on the toolbar through `host.ui.viewSwitch` (`schedule.js`); the view a person picks is kept in their browser (`schedule-view:<space>`), and the `defaultView` setting offers Timeline or List.
- **Work has no status, only `done`.** `scClean` (`schedule-lib.js`) reads `done` as `v.done === true` for a milestone or work and `false` for a note; `scValue` stores `done` as a boolean on every milestone and work, never on a note. A milestone's `done` is its `ticked`, or every entry under it done (`scMilestoneChanges`, which also writes `progress`). `scSetDone` is the tick: on work it sets `done`, on a milestone `ticked` and `done`. The summary, the phase measure, the Calendar and the title bar's count all read `done`.
- **Object status** ([plan-object-status](plan-object-status.md): action required, tentative, confirmed) is approved and not built anywhere.
- **The List moves things** through the shared `host.ui.outline` piece (`public/sdk/host.js`): a drag handle, the handle's menu through `host.menu.show`, **Alt** with the arrows, no dragging on a phone, and a polite live line. No module has a board.
- **Agents.** The actions (`addMilestone`, `addWork`, `addNote`, `setDone`, `updateEntry`) are one library, `schedule-lib-actions.js`, run by the server for an agent and by the page through `host.actions.fromLibrary`, with the same answer. Each handler reads the plan through `ctx` (`ctx.list`, `ctx.settings`, `ctx.util`). An agent's change is listed under **What it changed** with **Undo**. A person's tick and the List's moves are written by the page directly.
- **Permissions:** `view`, `edit`, `clear`. Owners always hold every module permission (`host.can()`).

## Decisions

Thomas, 2026-11-26:

1. **A board is a view grouped by one single-select field; the field's options are the columns.** Columns are defined per space, with the template supplying the default set (Gaming: Inbox, Now, Next, Later, Done; other templates: To do, Doing, Done). A Roles right lets owners and moderators edit the columns.
2. **Columns have stable ids; the label is only a name.** A rename or a template translation never touches cards. A card stores its column id.
3. **"Counts as done" is a flag on a column, not a rule in code.** The List's tick follows it, and several done-like columns are allowed. The tick stays what it is today; the board never disagrees with the List.
4. **A board is a record in an array per space** (id, name, columns, optional `rowsBy`), though the interface shows one at first. Several boards per space and swimlanes then need no change to the stored data.
5. **`host.ui.board` is a shared SDK piece (core)** and knows nothing about Projects: it is given columns, cards, optional rows and a move callback. Rows are in the contract from the first build; the first build leaves them off.
6. **Deleting a column moves its cards to a column the user chooses.** The last column and the done column can't be deleted.
7. **Certainty** (tentative, confirmed, action required; plan-object-status) **stays a separate field** from the column.
8. **On a phone the board is stacked sections with Done folded,** no drag, as the List behaves.
9. **The board is a view on the module's header** (the view switch), not a new module.
10. **Build order:** first build, custom columns per space with template defaults, the done flag, counts, collapse, a "+" per column, a "..." column menu if it fits, drag, card menu and keyboard moves, the stacked phone layout, one `setColumn`-style action for agents (undone with the change, run on the server, nothing waits for a page), and the column editor with the delete rule. Second build, swimlanes (milestone, person) and filters. Later, only if asked: several boards in the interface, WIP limits, zoom, a time axis.

## Taken on the planner's lean

Small choices the decisions leave, written down so the build has no gaps (CLAUDE.md, "Decisions stick"). Thomas may overturn any of them.

- **Cards are work only.** A milestone's done follows from its work and a note has none; a card names its milestone in quieter words.
- **Order inside a column is not stored:** by the work's end day (none last), then its place in the outline. A drop places a card by column only.
- **There is always at least one column without the done flag as well as one with it,** so a tick and an untick always have somewhere to go.
- **The Roles right** is a new module permission, `columns`, "Change the board's columns": moderator yes, member no, guest no (owners always have it).
- **Moving a card needs `edit`,** as the tick does. Someone without it sees the board, cannot drag and gets no Move choices.
- **A person's move runs the same handler** as the agent's, in the page, so both give the same writes and refusals.
- **Waits on** is a small mark on a card, not a column. Certainty, once built, is a chip on the card (decision 7).

## The contract

### The stored data (`modules/schedule/src/schedule-lib.js`, `FORMAT.md`, `project-plan.schema.json`)

- **Boards** are stored under `board:<id>`, one record each, so `ctx.list('board:')` is the space's array (decision 4): `{ id, name, field: "column", columns: [{ id, label, done? }], rowsBy? }`. `id` matches `^[a-z][a-z0-9-]{0,40}$`, a label is at most 40 characters, `done` is `true` or absent, `rowsBy` is `"milestone"` or `"owners"` or absent. `field` names the work field the board groups by; the first build has one board, `main`, grouping by `column`.
- **Template default.** A new setting `boardColumns` (`type: "choice"`, `scope: "space"`, `template: "default"`) with `priority` (Inbox, Now, Next, Later, Done; ids `inbox`, `now`, `next`, `later`, `done`) and `stages` (To do, Doing, Done; ids `todo`, `doing`, `done`), default `stages`. Only `done` carries the flag in either set. The Gaming template sets `priority`. While no `board:main` is stored, the page and the server read the board from this setting (`scBoardOf(ctx)`); the first edit of the columns stores the record, and from then on the record wins. The labels are the template's words through `labels` (`boardInbox` and so on) until someone renames a column, which stores the label.
- **Work gains `column`:** a column id, kept by `scClean` on work only and written by `scValue` only when set. A milestone or a note never has it.
- **`done` stays stored as today and always equals the column's flag** (decision 3). Every reader of `done` is unchanged.
- **A column for work without one** (written by `addWork`, a template's starter, a file import or a hand edit), and for a `column` naming no column on the board: the first done column if `done`, else the first column without the flag. `scColumnOf(e, board)` answers it; nothing is written until the work is next changed.
- **The format stays version 1** and gains `column` on work and the `boards` array in the file; test data may be reset (nothing is released). No other migration.

### The rules (`schedule-lib.js`)

- `scSetColumn(e, columnId, board, { label })` answers `{ entry }` or `{ problem }`: sets `column`, and `done` to that column's flag. A milestone or a note is refused ("Only work moves on the board."); an unknown column is refused ("There is no column called ...").
- **The tick** (`scSetDone` on work, the List's tick and the `setDone` action): ticking work whose column is not done moves it to the first done column; unticking work in a done column moves it to the first column without the flag; otherwise the column is left alone. A milestone's tick is unchanged.
- **A column's flag changed** rewrites `done` on every piece of work in that column, with the milestones' rollup, in one answer.
- **Deleting a column** (`scDeleteColumn(board, id, toId)`) needs a target column; its work moves there and takes the target's flag. Refused for the last column, the last done column, and the last column without the flag ("Keep at least one column that counts as done."). Removing the flag from the last done column is refused the same way.
- **The column editor's other rules:** a new column gets a fresh id from its name (a number added if taken), never reused after a rename; at most 12 columns; labels need not be unique but must not be empty.

### The actions (`schedule-lib-actions.js`, `module.json`)

- `setColumn`: input `{ ref: "ref:schedule:plan", column: "string" }`, `effect: "write"`, label "Move it on the plan's board", the input hint listing that the column is a column id from the board. Handler `scChange(input, ctx, (e, f) => scSetColumn(e, input.column, scBoardOf(ctx), f))`, so milestones' done and progress follow in the same answer. Run on the server for an agent and in the page for a person; an agent's move shows under **What it changed** with Undo, which puts back `column` and `done` together.
- `setDone` follows the tick rule above.
- No action edits the columns in the first build; the editor writes `board:main` through storage, checked by the `columns` permission (an `access` rule for the `board:` keys, or the page refusing and the server refusing a write by someone without `columns`; server-development picks the mechanism that the storage route already supports and says which).
- The manifest gains the `columns` permission and the `boardColumns` setting; `defaultView` gains `board`.

### The SDK piece (`public/sdk/host.js`, `/sdk/system.css`)

`host.ui.board(el, options)` returns `{ set(cards), focus(id), destroy() }`. It writes nothing and knows nothing about Projects (decision 5). Options:

- `columns: [{ id, label, done?, count? }]`, `cards: [{ id, column, row? }]`, `rows?: [{ id, label }]` (in the contract, ignored by the first build), `card(card, el)` to draw a card's inside, `menu?(card)` for the module's own menu choices, `columnMenu?(column)` for the module's column choices, `canMove?`, `canAdd?`, `name?`, `labels?` (the words it says itself, replaceable as the outline's), `onOpen?(card)`, `onAdd?(columnId)`, `onMove({ id, column })`.
- It draws: each column with its heading, its count (decision 10) and a "+" (`onAdd`); the column's "..." (`host.ui.moreButton`, `host.menu.show`) with **Fold** and the module's own choices; folding a column to a narrow strip with its name and count, kept per person in the browser under a key the module names; the cards' frames; drag with its own drag type; the card's "..." menu with **Move to <column>** for each other column first, then the module's own; the keyboard (on a focused card **Up** and **Down** walk the column, **Left** and **Right** go to the next column's nearest card, **Alt+Left** and **Alt+Right** move it one column, **Enter** opens it); the polite live line ("Moved "Write the brief" to Now."); and, at 640 px and narrower or on a coarse pointer, the stacked sections with every done column folded and no drag (decision 8).
- Accessibility: one list per column named by heading and count ("Now, 3"), roving focus so Tab leaves the board in one step, focus kept on a moved card, never colour alone, 44 px touch targets, no motion under reduced motion, every colour a theme token including the drop highlight.

### The view (`modules/schedule/src/schedule.js`, `schedule.html`, `schedule.css`)

- **Board** (icon `table-columns`) on the view switch; the choice kept as the other views'.
- Columns from `scBoardOf`, counts of the cards in each. Cards are work, drawn small: the title (two lines, then an ellipsis), the end day or "No date" with "Late" and who is doing it, two tags then "and N more", the milestone in quieter words, the "Waits on" mark.
- "+" opens the work editor with that column set (no milestone, at the end of the outline). A move, the card menu and the keys run the `setColumn` handler in the page. Card menu after the moves: **Edit**, **Delete**, as the List's row.
- Column "..." for someone with `columns`: **Rename**, **Counts as done** (on or off), **Move left**, **Move right**, **Add a column after**, **Delete** (asks which column takes its work, refused as the rules say), and **Edit columns**, which opens the column editor: every column with its name, its done flag and its place, add and delete under the same rules.
- The List and Timeline show the column's name under work's title when it is not the first column, so the views agree.

## The second build: swimlanes and filters

Decision 10 names swimlanes (milestone, person) and filters for the second build; decision 4 already stores `rowsBy` on the board record and decision 5 already puts `rows` in the piece's contract. Everything else here is the planner's lean, taken under Thomas's standing rule (CLAUDE.md, "Decisions stick"); he may overturn any of it.

### Leans taken

1. **Rows are the board's, not the person's.** `rowsBy` is on `board:main` (decision 4), so everyone sees the same rows. The stored values stay `"milestone"` and `"owners"` (the work field it reads; no rename), or absent for none; the words a person reads are **Milestone**, **Person** and **None**.
2. **Who may change the rows: the `columns` right,** not `edit`. The rows are the board's shape, as the columns are, and the server's `guards.keys` rule already holds every `board:` write to `columns`, so no new guard is needed.
3. **Where:** a **Rows** switch (None | Milestone | Person) in the Board's own bar beside **Add a column**, drawn as the shared `.mf-switch` (the same form switch as the Planner's "How you get there"). Shown only to someone with `columns`; everyone else sees the rows and no control. Not on the toolbar, which holds the person's own view choices, and not a new settings window.
4. **A change of rows** is one `board:main` write with **Undo** on the bar the column changes use; a board still on the template's columns becomes a stored one on that first change, as with columns.
5. **A move changes the column only, never the row,** in this build. Changing a card's row would change its milestone or who is doing it, which the editor does better. Only the card's own row takes a drop; a drop on another row's cell does nothing and the live line says why (below).
6. **A card is in one row.** By milestone: its nearest milestone above it in the outline. By person: its first owner (the card still names everyone). Cards with no row go in a last row, **No milestone** or **No one**, drawn only when it has cards.
7. **Row order:** milestones in outline order; people by name. A row with no shown cards is not drawn.
8. **Filters are the person's own view,** on the Board only, kept in their browser as the view and the folds are (`schedule-filter:<space>`). The List and the Timeline do not get them in this build; that is a later step if asked, since a filtered outline needs its own rule for parents.
9. **Agents: nothing changes.** Rows and filters are how the page shows the work, not stored work. No action reads or writes `rowsBy`; `setColumn` and the tick are as they are.

### The SDK piece (core): rows in `host.ui.board`

The piece still knows nothing about Projects. Options gain or use:

- `rows?: [{ id, label }]`: drawn only when it is a non-empty array; without it the board is exactly as today. A row id follows the column id rule. A card's `row` names one; a card with no `row`, or a `row` not in `rows`, goes in the piece's own last row, labelled `labels.noRow` (default "No row"; Projects passes "No milestone" or "No one"), drawn only when it has cards.
- `set(cards, columns?, rows?)`: rows may change with the cards.
- `labels.otherRow`: the live line when a card is dropped on another row (default "A card stays in its row."; Projects passes "Change the milestone in Edit." or "Change who is doing it in Edit.").
- `empty`: already in the piece; Projects passes "Nothing matches." while a filter is on.

What it draws with rows:

- **Wide layout:** the column headings once, at the top and held there while the rows scroll (heading, count, "+", "..." as today). Under them, one band per row: a full-width row heading (a fold chevron, the label, the row's count, "Launch, 4") and the row's cells, one per column, lined up under the headings.
- **Folding a row** shows its heading only. Kept per person in the browser under `<foldKey>:rows`, in both layouts. Folding a column narrows it in every row; a folded column's cell shows its own count.
- **Counts:** a column heading counts the cards shown in that column across every row; a row heading counts the cards shown in that row; a cell's count is shown only when its column is folded, and is always in the cell list's name.
- **Stacked layout (640 px and narrower, or a coarse pointer):** each row is a group under its heading, foldable, and inside it the column sections as today (every done column folded, that choice not kept, no drag).
- **Drag:** a card can be dropped only in its own row's cells; only those light up. Another row's cell gives no highlight and a drop there changes nothing and says `labels.otherRow`.
- **Keyboard** (still one Tab stop): **Up** and **Down** walk the column inside the row, then pass through the next row's heading (a stop, where **Left** and **Right** fold and unfold it as the outline does) into that row's nearest card in the same column, else its nearest column with a card. **Left** and **Right** on a card stay in the row: the nearest card of the next column in that row that has one; an empty cell is skipped, and at the row's end focus stays. **Up** from the first row's heading reaches the column headings as today. **Alt+Left** and **Alt+Right** move one column within the row; the card menu's **Move to <column>** is unchanged.
- **Accessibility:** each row is a group named by its heading and count; each cell is a list named "Now in Launch, 2"; the row heading's fold button says Fold or Unfold with `aria-expanded`; the drop highlight and the row bands use theme tokens only; no motion under reduced motion; 44 px touch targets for the row heading.

### The module (`modules/schedule`): the Rows switch, the rows and the filters

- **Rows.** The Rows switch (lean 3) writes `rowsBy`. The page builds `rows` from the board's `rowsBy` (lean 6 and 7), each card's `row`, and passes `noRow` and `otherRow`. A person's name is their display name, else "Someone who left".
- **The Filter button** is the toolbar's own **Filters** (`type: 'chips'` items through `host.toolbar.set`, after the view switch), on the Board view only. Groups, each drawn only when it has options:
  - **Who:** a switch for each person with work on the plan, and **No one**; off by default; shows work with any person chosen. With counts.
  - **Tag:** `host.tags.filterOptions(counts)`; "has all of them", as the SDK says.
  - **Phase** (only when the template has phases): one choice, **Every phase**, each phase, **No phase**.
  - **Milestone:** one choice, **Every milestone**, each milestone in outline order, **No milestone**.
  - Groups combine with "and". A kept value naming something that is gone is dropped on read.
- **What filtered looks like:** the host's Filters button shows how many are applied, and its menu starts with **Clear filters**. The status bar adds "Showing 4 of 12 work" (the template's word) beside the plan's progress, which stays the whole plan's. No pills on the board. An empty cell or column says "Nothing matches."
- **Counts and folding when filtered:** every count is of the shown cards. Folding is unchanged (a done column folded stays folded; its strip shows the shown count).
- **A move cannot hide a card:** no filter reads the column, so a drag, a menu move or a key move keeps the card shown. **"+" while filtered** starts the editor with the filter's milestone and phase when one is chosen, its person when exactly one is, and its tags; if the saved work still does not match, a toast says "Added. The filter hides it."
- **Phone at 390:** the Filters button and the stacked rows as above; the Rows switch wraps under **Add a column** in the bar.

## Progress

Step 1 is built (Planner - Projects 0.1.13, try build, 2026-11-26): the rule, the stored board, `setColumn`, the `columns` permission and the file format. The server refuses a `board:` write by someone without `columns` through a `guards.keys` rule on `board:{id}` with `need: "columns"` (and the board's shape under `fields`), which the storage route already supported. Departures: the `boardColumns` labels are the library's own words, not `labels` entries yet, and `defaultView` has no `board` option yet; both belong to step 3 with the page.

Step 3 is built (Planner - Projects 0.1.14, try build, 2026-11-26): the Board is the third choice of the view switch and of "Opens on", drawn by `host.ui.board` from `board:main` (else the `boardColumns` setting's default). Cards are work only, in a column by end day (end day, else start, none last) then outline order; each says its title, end day or "No date", "Late", who, up to two tags and "and N more", the milestone, and "Waits on <first>" while something it waits on is not done. A move (drag, the card's menu, Alt+Left and Alt+Right) runs the page's `setColumn` handler through `host.actions.fromLibrary`; the List's tick and the editor's Done box use `scSetDone` with the board; "+" opens the editor on new work in that column; a card's menu after the moves is Edit and Delete. The default columns' words are `labels` (`board-inbox`, `board-now`, `board-next`, `board-later`, `board-done`, `board-todo`, `board-doing`; label keys allow only lower case, digits and dashes), read by `scDefaultBoard(set, label)` on the page and the server alike. The Gaming template sets `boardColumns: priority` (`templates/games.json`). The List and the Timeline name the column when it is not the board's first. Import stores the file's board first (always on Replace, on Add only while the plan has none) and gives it to `scImportEntries`; Undo puts it back; Export carries the board. The column "..." menu is Fold and Unfold only. Checked live by `tools/check-schedule-board.mjs`. Steps 4 and 5 are not built.

Step 4 is built (Planner - Projects 0.1.15, try build, 2026-11-26): the column "..." menu has, after Fold or Unfold, **Rename**, **Move left**, **Move right**, **Counts as done** and **Delete**, and the Board has an **Add a column** button above the columns; all of them only for someone with `columns` (a member sees Fold only and no button, and a forced write is the server's 403 sentence). Rename and Add ask through `host.ui.prompt` with the library's sentences as its `validate`; Delete opens a small dialog of the other columns (the SDK has no choice dialog) and says the refusals that do not depend on the target at once as a toast. Each change is one `board:main` write (labels stored on a rename, so the stored record wins) and then the work it rewrites, offered for **Undo** on the bar the import uses (it puts back the board, or removes the record when the board was still the template's, and the work); a board on the template's columns becomes a stored one on the first change. Departure: the column menu has no "Add a column after" and no "Edit columns" window (the brief for step 4 asked for the five items and one Add control). Checked live by `tools/check-schedule-board-editor.mjs`. Step 5 is not built.

Step 5a is built (try build, 2026-11-26): `host.ui.board` takes `rows`, a card's `row`, `labels.noRow`, `labels.otherRow` and `set(cards, columns?, rows?)`. Wide: the column headings are drawn once and held at the top of the board's own scroll (`--board-max-height`, 80vh) while the rows scroll; each row has a full-width heading with its count and fold (kept under `<foldKey>:rows`); a cell shows a count only when its column is folded. Phone: each row is a foldable group of the columns. Keys, the row-bound drop (the spoken line is `labels.otherRow`, also said when a drag is let go over another row, since the browser does not drop there) and the Design System's "Live: board with rows" are as planned. Departures: `labels.cell(column, row, count)` names each cell's list; on a phone a done column's fold is kept per row, not per board. Checked by `tools/check-board.mjs` (216 checks, 411 with `BOARD_MODES=dark,light`). Step 5b is not built.

Step 5b is built (Planner - Projects 0.1.16, try build, 2026-11-26): the Board's bar has a **Rows** switch (None, Milestone, Person; the shared `.mf-switch`) for someone with `columns`, one `board:main` write of `rowsBy` (absent, `"milestone"` or `"owners"`) with Undo as the column changes have it; everyone sees the rows. A card is in the row of its milestone (by milestone) or of its first owner (by person), else in the last row, **No milestone** or **No one**, drawn only when it has cards; the board is drawn again on a change of rows because the piece takes `labels.noRow` and `labels.otherRow` when it is made. The toolbar's **Filters** has Who (any chosen, and No one), Tags (has all), Phase and Milestone (one each) on the Board only, kept per person under `schedule-filter:<space>`; the status bar adds "Showing 4 of 12 pieces of work", the board says "Nothing matches.", "+" starts the new work with the filter's choices and a toast says "Added. The filter hides it." when it still does not match. Departures: the Tags group lists the plan's own tags (its `tags` setting) with `tint`, not `host.tags.filterOptions`, because the plan's tag ids are not the host's tag ids; by milestone a card's milestone is its nearest milestone parent (the same as the editor's "Part of a milestone"), not any milestone merely above it in a flat outline; with every card in the last row the board is drawn without rows (the piece draws rows only when it is given some); "Nothing matches." shows in an empty column on a phone and when nothing is shown, since the wide row layout draws empty cells blank. Checked by `modules/schedule/test/check-schedule-board-rows.mjs` and live by `tools/check-schedule-board-rows.mjs`.

Order inside a column is built (Planner - Projects 0.1.22, try build, 2026-11-26, step 5 of [plan-github-two-way](plan-github-two-way.md)). This overturns this plan's lean that order inside a column is not stored. Work has a stored `rank` (a short sortable string, the space's own), cards run by rank, then end day, then the outline, and new work with no rank sits below the ranked work. `host.ui.board` reports `onMove({ id, column, before? })`, draws a line where a drop would land, and moves a card inside its column with **Alt+Up** and **Alt+Down** and the card menu's **Move up**, **Move down**, **Move to top** and **Move to bottom**, saying "Moved to position 2 of 5 in Now."; **Alt+Left**, **Alt+Right** and **Move to** put a card at the end of the other column. `setColumn` takes an optional `before`. Checked by tool: `tools/check-board.mjs` (259 checks) and the module's tests, run again on 2026-11-26 in the documentation pass. Not verified: the board in a browser by this pass (no screenshots were taken here), a screen reader, and a phone.

## Left to build, in order

Each is a try build unless Thomas calls another kind. Each module change bumps the module's patch version in `modules/schedule/module.json` and `tools/module-versions.json`.

1. **The rule, the stored board and the action** (server-development; core, because it adds a permission and a stored format; medium). `column`, `board:` records, `boardColumns`, `scBoardOf`, `scColumnOf`, `scSetColumn`, the tick rule, the flag rewrite, `scDeleteColumn` and the editor rules, `setColumn`, the `columns` permission and its server check, `FORMAT.md`, the schema and the file's `boards`. Tests in `check-schedule-lib.mjs`, `check-schedule-lib-actions.mjs` (page and server alike, Undo restoring `column` and `done`), `check-schedule-actions.mjs`, `check-schedule-file.mjs` and `check-schedule-schema.mjs`.
2. **The shared board piece** (experience-design; core; large). `host.ui.board` with columns, counts, fold, "+", the column and card menus, drag, keys, live line and the stacked phone layout; rows accepted and ignored. Its styles, `tools/check-board.mjs` (pure parts in node, the drawn piece in a browser, as `check-outline.mjs`) and a Design System entry. Needs step 1 only for the demo data shape, so it can run beside it.
3. **The Board view** (experience-design; module lane; medium). The view option and `defaultView`, the cards, "+", moves through `setColumn`, the column name in List and Timeline, the Gaming template's `boardColumns`. Needs steps 1 and 2.
4. **The column menu and editor** (experience-design; module lane; medium). Rename, done flag, order, add, delete with its chooser, all gated by `columns`. Can be split from step 3 if step 3 runs long (decision 10's "if it fits").
5. **Second build: swimlanes and filters** ("The second build" above), as two try builds:
   - **5a. Rows in the board piece** (experience-design; core; medium). `rows`, `row`, `noRow`, `otherRow` and `set(cards, columns?, rows?)` in `host.ui.board` (`public/sdk/host.js`), the row bands, row folding, the held column headings, the stacked row groups, the row-bound drop, the keyboard through rows and their styles in `public/sdk/system.css`; the pure parts (grouping by row, the no-row row, the walk through rows) and the drawn piece in `tools/check-board.mjs`; the Design System's Board entry gains a rows demo. Without `rows` the board must draw exactly as today.
   - **5b. The Rows switch and the filters** (experience-design; module lane; medium). In `modules/schedule`: the Rows switch and its `rowsBy` write with Undo, the rows and the cards' `row`, the Filters groups and their kept value, the status line, "Nothing matches.", the "+" prefill and its toast; a patch version bump; a new `test/check-schedule-board-rows.mjs` (rows by milestone and person, a member without the switch, a drop on another row refused, the filters, the kept value, the counts). Needs 5a.

Documented 2026-11-26 (content-manager): the user guide, the SDK and module API, the architecture and the design theme cover steps 1 to 4. Documentation when Thomas calls a feedback or production build (content-manager): the Planner - Projects user guide, [api-module-sdk](../api/api-module-sdk.md) for `host.ui.board`, design-theme for its look, and the Roles page's new right.

## Verify

- **Step 1.** Checked by a tool: `npm run check:module -- schedule` and the server's storage-route check for the `columns` refusal. Cases: work without a column on each board default; tick and untick moving between columns; a flag change rewriting `done` and the milestones; each delete refusal; a rename leaving every card's `column` as it was; `setColumn` on page and server giving the same writes; an agent's move undone.
- **Step 2.** Checked by a tool: `node tools/check-board.mjs`, `node tools/check-switches.mjs`, `node tools/check-radius.mjs` and the Design System check; live in headless Chromium on the Design System page at 1280 and 390, light and dark: drag, the menus, the keys, fold, "+" and the announcement.
- **Steps 3 and 4.** `npm run check:module -- schedule`, then live on a local server in headless Chromium at 1280 and 390, light and dark: both templates' default columns, a move by drag, menu and keys, the List's tick moving the card and the board's Done unticking it in the List, done columns folded at 390, a second browser seeing a move, a member refused the column editor while a moderator has it, and an agent's `setColumn` through an agent token moving the card on an open board with Undo putting it back.
- **Step 5a.** Checked by a tool: `node tools/check-board.mjs`, `node tools/check-switches.mjs`, `node tools/check-radius.mjs` and the Design System check; live in headless Chromium on the Design System page at 1280 and 390, light and dark: the rows demo's bands, row and column folding, the counts, the keys through rows, a drop on another row refused with its line, the stacked row groups at 390, and the board without `rows` unchanged.
- **Step 5b.** `npm run check:module -- schedule`, then live on a local server in headless Chromium at 1280 and 390, light and dark: rows by milestone and by person with the "No" rows, a moderator changing the rows and Undo, a member seeing rows and no switch (and a forced `rowsBy` write refused by the server), each filter group alone and together, the Filters count and **Clear filters**, the status line, the filter kept over a reload, "+" while filtered, and a second browser seeing a rows change.
- **Not checkable here:** the board inside a space's canvas during a call (no LiveKit server locally; read as code only), a real phone's touch, and a real screen reader (the live line is checked by its text).

## Open questions

None of these blocks the first build; each has a lean that the build takes unless Thomas says otherwise.

1. **The Roles right's name and defaults:** `columns`, "Change the board's columns", moderator yes and member no. Lean: as written.
2. **The phone's Done fold:** every done column folded, or only the last. Lean: every done column, since a done column is finished work.
3. **Several boards later:** decision 4 keeps columns in each board's record, so a second board with its own columns needs its own field on work. Lean: each board names its `field` (the first is `column`), so a second board adds a field and board one's data never changes. Blocks only the "several boards" step, which is later and only if asked.
4. **Order inside a column:** not stored, by end day (lean, taken). A stored board order would be a later change if the board is used for priority within a column, as Thomas's own Now column may want.

For the second build (none blocks it; each lean is taken):

5. **Rows shared or each person's own.** Decision 4 puts `rowsBy` on the board, so the rows are everyone's and changed under `columns`. If Thomas wants each person to choose their own rows, `rowsBy` would move to the browser like the filters and the stored field would go. Lean: shared, as decision 4 has it.
6. **Work with two people, rows by person:** in its first owner's row only (lean), or in every owner's row. Every owner's row means one piece of work on the board twice, which the piece's one-card-one-place rule (focus, moves, the live line) does not allow today.
7. **Moving between rows** (changing the milestone or the person by dragging) is left out of this build (lean 5). If it is wanted later, `onMove` gains `row` and the module writes the field through `updateEntry`.
8. **Filters on the List and the Timeline:** not in this build (lean 8); a later step if asked.
