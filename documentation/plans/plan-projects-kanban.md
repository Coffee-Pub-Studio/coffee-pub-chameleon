# Projects Board Plan

**Audience:** Thomas, who decided how the board works; experience-design, which builds the shared board piece and the view; server-development, which builds the rule, the action and the checks.

**Status:** Decided by Thomas, 2026-11-26; not yet built. From GitHub issue #1144, Thomas, 2026-11-26: "another ask for Planner - Projects, a kanban view (a board of columns, one per status, with the work as cards to move between them)." The columns were then discussed the same day as "foundational and bigger than a 'choose one'", against two references: Thomas's own board (Inbox, Now, Next, Later, Done: a priority horizon, with a count per column, a "..." menu and a "+" to add into a column) and a friend's dense board (columns as stages, swimlanes by epic, filters, WIP counts, density zoom, a time axis), which is not to be copied whole. The earlier recommendation of three fixed columns (To do, Doing, Done) is replaced by the decisions below.

**Progress:** Step 2 is built (try build, 2026-11-26): `host.ui.board` in `public/sdk/host.js`, its `board` block in `public/sdk/system.css`, `tools/check-board.mjs` (in `npm run check`) and a Board entry with a live piece on the Design System page. It takes cards as `{ id, column, title? }` and draws each card's inside through `card(card, contentEl)`; `set(cards, columns?)` redraws; a move into a folded column opens it; the stacked layout starts every done column folded and does not keep that choice. Rows are accepted and not drawn. Steps 1, 3, 4 and 5 are not built.

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

## Left to build, in order

Each is a try build unless Thomas calls another kind. Each module change bumps the module's patch version in `modules/schedule/module.json` and `tools/module-versions.json`.

1. **The rule, the stored board and the action** (server-development; core, because it adds a permission and a stored format; medium). `column`, `board:` records, `boardColumns`, `scBoardOf`, `scColumnOf`, `scSetColumn`, the tick rule, the flag rewrite, `scDeleteColumn` and the editor rules, `setColumn`, the `columns` permission and its server check, `FORMAT.md`, the schema and the file's `boards`. Tests in `check-schedule-lib.mjs`, `check-schedule-lib-actions.mjs` (page and server alike, Undo restoring `column` and `done`), `check-schedule-actions.mjs`, `check-schedule-file.mjs` and `check-schedule-schema.mjs`.
2. **The shared board piece** (experience-design; core; large). `host.ui.board` with columns, counts, fold, "+", the column and card menus, drag, keys, live line and the stacked phone layout; rows accepted and ignored. Its styles, `tools/check-board.mjs` (pure parts in node, the drawn piece in a browser, as `check-outline.mjs`) and a Design System entry. Needs step 1 only for the demo data shape, so it can run beside it.
3. **The Board view** (experience-design; module lane; medium). The view option and `defaultView`, the cards, "+", moves through `setColumn`, the column name in List and Timeline, the Gaming template's `boardColumns`. Needs steps 1 and 2.
4. **The column menu and editor** (experience-design; module lane; medium). Rename, done flag, order, add, delete with its chooser, all gated by `columns`. Can be split from step 3 if step 3 runs long (decision 10's "if it fits").
5. **Second build: swimlanes and filters** (experience-design, with core for rows in `host.ui.board`; medium each). Rows by milestone or person from `rowsBy`, and a Filter button (who, tag, phase, milestone) kept per person. To be planned in detail when the first build is used.

Documentation when Thomas calls a feedback or production build (content-manager): the Planner - Projects user guide, [api-module-sdk](../api/api-module-sdk.md) for `host.ui.board`, design-theme for its look, and the Roles page's new right.

## Verify

- **Step 1.** Checked by a tool: `npm run check:module -- schedule` and the server's storage-route check for the `columns` refusal. Cases: work without a column on each board default; tick and untick moving between columns; a flag change rewriting `done` and the milestones; each delete refusal; a rename leaving every card's `column` as it was; `setColumn` on page and server giving the same writes; an agent's move undone.
- **Step 2.** Checked by a tool: `node tools/check-board.mjs`, `node tools/check-switches.mjs`, `node tools/check-radius.mjs` and the Design System check; live in headless Chromium on the Design System page at 1280 and 390, light and dark: drag, the menus, the keys, fold, "+" and the announcement.
- **Steps 3 and 4.** `npm run check:module -- schedule`, then live on a local server in headless Chromium at 1280 and 390, light and dark: both templates' default columns, a move by drag, menu and keys, the List's tick moving the card and the board's Done unticking it in the List, done columns folded at 390, a second browser seeing a move, a member refused the column editor while a moderator has it, and an agent's `setColumn` through an agent token moving the card on an open board with Undo putting it back.
- **Not checkable here:** the board inside a space's canvas during a call (no LiveKit server locally; read as code only), a real phone's touch, and a real screen reader (the live line is checked by its text).

## Open questions

None of these blocks the first build; each has a lean that the build takes unless Thomas says otherwise.

1. **The Roles right's name and defaults:** `columns`, "Change the board's columns", moderator yes and member no. Lean: as written.
2. **The phone's Done fold:** every done column folded, or only the last. Lean: every done column, since a done column is finished work.
3. **Several boards later:** decision 4 keeps columns in each board's record, so a second board with its own columns needs its own field on work. Lean: each board names its `field` (the first is `column`), so a second board adds a field and board one's data never changes. Blocks only the "several boards" step, which is later and only if asked.
4. **Order inside a column:** not stored, by end day (lean, taken). A stored board order would be a later change if the board is used for priority within a column, as Thomas's own Now column may want.
