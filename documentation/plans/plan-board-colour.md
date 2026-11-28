# Board Colour Plan

**Audience:** Thomas, who decides; experience-design, which adds colour to the shared `host.ui.board` piece; the Planner - Projects module agent, which stores the colour and opens the picker in its own lane.

**Status:** Draft for Thomas, 2026-11-28. Nothing is decided and nothing is built. Thomas: "we should consider letting the user set a colour when they define boards." It is not yet clear whether he means the board, its columns or its cards; the options below are those readings.

## What it is today

- **The board** is drawn by the shared piece `host.ui.board` (`public/sdk/host.js`, its block in `public/sdk/system.css`, [plan-projects-kanban](plan-projects-kanban.md)). Only Planner - Projects (`modules/schedule`, 0.1.26) uses it. Every colour is a theme token: a column is `--surface-panel` with a `--edge-hairline` edge, a card `--surface-card`, hover `--fill-hover`, a drop `--fill-selected` and an `--accent-fill` line, and a done column's mark `--status-ok-fill`. Nothing on a board has a colour of its own.
- **What is stored.** A board is `board:main`: `{ id, name, field: "column", columns: [{ id, label, done? }], rowsBy? }`, written under the `columns` right. `scCleanBoard` in `schedule-lib.js` keeps only those keys, so a colour would need adding there, in `FORMAT.md` and in the schema. A space that follows GitHub refuses every write to `board:` (`pulledRefusal`, `server/index.js`), so its board's columns cannot be changed at all.
- **Colours a card already shows.** A card's tags carry their own colour (`#rrggbb`, a tint on the chip), as the plan's `tags` setting holds them. A field's choices (Area, Release status) have no colour.
- **The colour picker is on `main`:** `host.ui.colorPicker` and `host.ui.colorField` in `public/sdk/host.js`, with `host.util.contrast` and `host.util.readableOn` ([plan-colour-picker](plan-colour-picker.md); that plan's status line still says "not merged" and is out of date).
- **Not this:** the Whiteboard's boards already have a background colour (#502, closed); that is a different "board".

## Earlier decisions this rests on

- The picker is the only way a colour is set, everywhere (plan-colour-picker decision 29). No native colour input (decision 6).
- A picked colour is stored as `#rrggbb`, checked strictly (decision 7), and stays fixed in every theme and mode; the theme's tints are not offered (decision 25).
- Where opacity cannot be kept, the picker shows no slider (decision 20). The colour field is a colour chip on its row (decision 33).
- Words on a fill take `host.util.readableOn` (decision 3); tags use this (decision 30).
- "No colored borders" (Thomas, 2026-10-14, design-theme "Phase colours"): a colour is a fill and a dot. Colour never carries meaning alone.
- `host.ui.board` knows nothing about Projects (plan-projects-kanban decision 5), and a drawn fix goes into the shared piece once (CLAUDE.md, core stability).

## Options

- **1. A colour per column (lean).** A column's "..." menu gains **Colour**, which opens the picker with `opacity: false` and a **No colour** choice as the way back. The heading gets a dot in the colour and a light wash of it (`color-mix(in srgb, <colour> 16%, transparent)`) behind the name; the cards stay as they are. Stored as `color` on the column in `board:main`, under the `columns` right, with Undo like the other column changes, and carried by Export and Import. Cost: one optional key in the piece's `columns` and the module's board record. This is what "when they define boards" reads most like, since defining a board is defining its columns.
- **2. A colour for the board.** One colour for the whole board, perhaps its edge or the view switch's icon. Little use while a space has one board (decision 4 allows several, later and only if asked). Cost is small, value small.
- **3. A colour per card.** Two ways: (a) each piece of work picks its own colour, a new key on work and a control in its form; (b) a card takes the colour of one field's choice (Area: Planner is blue), so the choice holds the colour and every card follows. (b) is less to set and stays consistent; (a) is free-form. Either way the card's tags already bring colour, so a card colour competes with them.

## Lean, and why

Option 1, columns, first. It matches "define boards", it touches only the board record and the column menu, and it adds one optional key to the shared piece. Option 3(b) is a later step if cards need colour too, since fields already exist; option 2 waits for several boards.

## The contract (option 1)

### The shared piece (`public/sdk/host.js`, `public/sdk/system.css`, core)

- `columns: [{ id, label, done?, count?, color? }]`: `color` is a `#rrggbb`; anything else is ignored. With no `color` the column draws exactly as today.
- Drawn as a dot (8 px, before the name) and a wash behind the heading only, never a coloured border. In a folded column the dot stays at the top of the strip. In the stacked phone layout, the same dot and wash on the section's heading.
- **Contrast.** The heading's words stay `--text-primary`; the piece checks them with `host.util.contrast` against the washed heading and lowers the wash until they reach 4.5:1 in that mode. A dot with less than 3:1 against its surface gets the stronger edge the picker's faint swatches get (`.sdk-cp-faint`, a mix of `--text-muted` into `--edge-hairline`; plan-colour-picker decision 14). The column's name is always shown, so colour is never the only sign.
- Checked by `tools/check-board.mjs` (with `BOARD_MODES=dark,light`).

### Planner - Projects (`modules/schedule`, module lane)

- `scCleanBoard` keeps `color` on a column when it is a strict `#rrggbb`, lower case; `FORMAT.md` and `project-plan.schema.json` gain it. The format stays version 1.
- The column "..." menu, for someone with `columns`, gains **Colour** (opens `host.ui.colorPicker` at the menu's button, `opacity: false`) and, once a colour is set, **No colour**. One `board:main` write with Undo. A template's default columns have no colours; the first colour stores the board, as a rename does.
- A space that follows GitHub: see question 2.

## Left to build, in order

1. **Colour in `host.ui.board`** (experience-design; core). The `color` key, the dot, the wash, the contrast rule, the Design System's Board entry showing coloured columns, `tools/check-board.mjs`.
2. **Colour on Projects' columns** (Planner - Projects module agent; module lane; patch bump). The stored key, the menu, Undo, Export and Import, a test in `modules/schedule/test/`. Needs 1.

## Verify

- Step 1: `node tools/check-board.mjs` with `BOARD_MODES=dark,light`, `node tools/check-colour-picker.mjs` and the Design System check; live in headless Chromium at 1280 and 390, light and dark, with a pale and a dark colour in each mode.
- Step 2: `npm run check:module -- schedule`, then live on a local server: a moderator colours a column and undoes it, a member sees the colour and no **Colour** choice, a forced write by a member refused, an export and import keeping it.
- Not checkable here: the board inside a space's canvas during a call (no LiveKit server locally; read as code only), and a real screen reader.

## Open questions

1. **Which reading** (blocks the build): columns (lean); cards from a field's choice; each card its own; the board.
2. **A board that follows GitHub** (blocks step 2 only for those spaces): Thomas's own Bug Squash board follows GitHub, whose board is read-only today. Lean: let a column's colour through `pulledRefusal` as the space's own, since nothing about it is sent to GitHub; the other choice is no colours on a followed board.
3. **Template colours:** whether a template may give its default columns colours (Done green, say). Lean: no, not in this build.
