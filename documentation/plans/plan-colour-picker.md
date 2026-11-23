# Colour Picker Plan

**Audience:** Thomas decides. If he approves, experience-design builds the picker in the SDK, the host pages' use of it and its entry on the design-system Pickers page; server-development writes its check. This is a core change (`public/sdk/host.js`, `public/sdk/system.css`, and the host pages that draw a colour field today), so each step is held for an independent read, and the full `npm run check` covers it at release prep, run by the project manager. content-manager documents it afterwards. The Whiteboard's colours (#544) are a module-lane follow-up once step 2 lands, not part of this build.

**Status:** Being built on the branch `claude/colour-picker-933`, not merged (2026-11-19). Steps 1 to 4 are built. Each step had its independent reads: step 1 twice; step 2 three times, the last with no must-fix; steps 3 and 4 once, with no must-fix. The fixes from every read are in. The check holds them: `tools/check-colour-picker.mjs`, 1196 checks, 235 in Node and 961 in Chromium. Nothing is merged; the work is on the draft pull request #934. Step 5, the documents, is written (content-manager, 2026-11-19). Decisions 1 to 33 are below; decisions 8 and 11 are replaced by decision 20 (2026-11-22), and decision 12 (the palette of three groups) by decisions 22 and 24 (2026-11-22). Decisions 22 to 26 (the palette becomes the person's own grid) are not built yet; their contract is "The person's colour grid" and they are steps 6 and 7. Thomas added decisions 12 to 17 on 2026-11-19 ("merge the colour picker when green"). Open questions 3 to 8 were built with the plan's suggestions. On 2026-11-23 Thomas added decisions 30 (space Tags open the picker) and 31 (a Maps place's own colour opens the picker); neither is built. Thomas added decision 32 the same day (a phase has its own colour, set with the picker), which answers open question 14; it is not built. It replaces his first answer that day, "phases keep their colour by order". Thomas added decision 33 the same day (the colour field is a square colour chip, inline on its row, everywhere); it is not built.

**Progress notes (content-manager, 2026-11-19, from the code on the branch).** Built as the contract says, with these differences: `host.ui.colorPalette()` is not built, since Thomas decided it is not built now (decision 17; the host's pages read the palette as `window.hostColour.palette`); the default palette is built as proposed. `profile.html` and `module-config.html` load the SDK; `host.html` does not, because the host console's template editor draws no colour field. A new list row takes the Strong group's colours by its place in the list. The picker answers on a press outside only when something changed (else `null`), and Enter in Hex is always a choice (open question 6, built so). Also fixed on the way: a sandboxed frame now gets every theme role the page writes, so popovers have their surface there; a frame drops a role the page no longer sends; and menus, the tags picker and the colour picker are placed right on a scrolled page or frame. Gaps are in [known-issues](../known-issues.md), "The colour picker: gaps", and what is left in [TODO](../TODO.md).

Drafted for Thomas, 2026-11-19, by product-planner. It comes from GitHub issue #933 ("Design: A reusable colour picker (`host.ui.colorPicker`)"), which Thomas asked for because it blocks #544. Thomas answered the first draft on 2026-11-19 (decisions 1 to 5 below), including "We can scrap all previous pickers and colour palettes", and then four more the same day (decisions 8 to 11: the opacity slider is always shown, the call is two calls, the picker lands before the freeze whatever else slips, and a colour stored without its opacity gets a switched-off slider). His earlier words in #544 (2026-11-10) still bind it: "No native colour input as a stopgap", and a colour a person picks "may be stored as `#rrggbb` in module data; validate strictly" (decisions 6 and 7). Seven questions are still open, listed at the end; one of them, the default palette, blocks nothing now, since step 1 is built with the proposal.

**What was read.** `CLAUDE.md`; GitHub issues #933, #544 (with its two comments) and #480 (with its comment), read through the GitHub REST API; [plan-layout-picker](plan-layout-picker.md) for the format; [plan-release](plan-release.md) ("The freeze", the gating list); [plan-templates-redesign](plan-templates-redesign.md) (the freeze window); [design-theme](../designsystem/design-theme.md) (the tokens, the rules, Selected states, Tints, The kind picker); [api-module-sdk](../api/api-module-sdk.md) ("Settings", "Shared tools", "The module frame", "Theme", "Running in the page", "The sandbox"); `documentation/TODO.md` and `documentation/known-issues.md` (searched). In code: `public/colour-pick.js` (all of it); `public/sdk/host.js` (the `ui` block, lines 2599 to 3130; `showMenu()` and its placing, lines 2097 to 2330; `host.menu`, lines 4203 to 4240; the page globals at the end, lines 4890 to 4921); `public/module-host.js` (`createFrameBands()`, lines 1163 to 1255; the `ui.toast`, `ui.confirm` and `ui.prompt` handlers, lines 1605 to 1619; the lift's header, lines 1057 to 1073); `public/module-frame.js` (searched for colour: nothing); the Pickers block of `public/sdk/system.css` (lines 4540 to 4700); `public/design-system/components.js` (the `pickers` entry, lines 82 to 92) and the approved family in `public/design-system/legacy/system-v1/proposed-pickers.js` (searched); `public/theme-colour.js` (lines 1 to 118); `public/list-rows.js`, `public/module-settings.js`, `public/template-pages.js` (their colour lines); `server/modules.js` (`SETTING_TYPES`, line 612; the `color` setting, line 798); the Whiteboard's `whiteboard.css` (the fixed colours, lines 35 to 75), `whiteboard-lib-a-core.js` (lines 40 to 110) and `whiteboard.js` (lines 1120 to 1160); the headers of `tools/check-no-raw-colours.mjs`, `tools/check-system-css.mjs` (line 172), `tools/check-sdk-pick.mjs`, `tools/check-module-host.mjs` and `tools/check-template-pages-b.mjs` (line 45). **Not read:** `public/admin.js`'s theme editor, the kind picker's own code (`createKindPicker`) beyond its comment, how the kind picker keeps its recent choices in a sandboxed frame, and `tools/check-module-window.mjs` beyond a search. The proposed palette's contrast figures were worked out with a short script using the WCAG 2 formula (the same as `theme-colour.js`); nothing in the product was run.

## Why

There is no real colour picker in the product, and a module cannot get even the one there is. The host's own pages have a 16-swatch popover whose last choice, "Custom", is the browser's own colour input, so there is no saturation and brightness area, no hue slider, no hex field, no opacity and no eyedropper. A module has nothing: the Whiteboard's **Custom** background row and its **Custom colour** row in the block colour menus are switched off until a picker exists, and Thomas ruled out the browser's input as a stopgap (#544).

Several places want one picker: the Whiteboard's block fills, borders, words and lines, its custom background, its grid colour and a transparency for fills (#544); module settings of type `color` ([plan-stream-module](plan-stream-module.md)); and the colour fields in template pages and list settings. Issue #933 asks for one component for the whole system, not one per module.

## What it is today

All of this is replaced by the picker; decision 5 says none of it needs to be kept.

- **`public/colour-pick.js`.** A page piece, not part of the SDK. `upgradeColourInputs(root)` finds every `<input type="color">` under `root` and calls `colourPicker(input)`, which hides the input and puts a trigger button before it (`.sdk-picker`: a swatch, the hex in words and a chevron). The button opens a popover (`role="dialog"`) holding a radio group of 16 named swatches (`PALETTE`: Amber, Orange, Red, Gold, Green, Teal, Cyan, Sky, Blue, Purple, Magenta, Pink, Stone, Brown, Sand, Ink) in rows of 8, and under them a label "Custom" around a native `<input type="color">`. A choice sets the hidden input and sends `input` and `change` from it, so the page reads and saves as before. Keys: arrows move between swatches, Enter or Space chooses, Escape closes and puts focus back on the trigger. The popover is placed under the trigger, flipped above it when it does not fit below, and kept inside the window. The chosen swatch shows a check on a neutral disc, never an accent border. The trigger's accessible name is "<name>, <palette name>, <hex>. Change it". It only reads `#rrggbb` (anything else reads as `#000000`). Read in code.
- **Who calls it.** `public/module-settings.js` (a module setting of type `color`, and the list settings' rows) calls `upgradeColourInputs` on its container; `public/list-rows.js` draws each list row's colour as a native input, with its own list of colours for new rows (`ROW_COLORS`); `public/template-pages.js` upgrades the colour fields of template pages. Through these it reaches Manage, the host console's template editor, a person's Profile and a space's settings. Read in code: the imports in `module-settings.js`, `list-rows.js` and `template-pages.js`; the pages that import those (`admin.js`, `host-templates.js`, `module-config.js`, `profile.js`, `space.js`) were found by a search, not read.
- **The theme editor is not one of them.** Its colour fields in `public/admin.html` (line 227 on) are plain native inputs, and `public/admin.js` does not import `colour-pick.js`. `tools/check-no-raw-colours.mjs` names them as holding a colour the person picks. Read by a search.
- **A `color` setting exists already.** `SETTING_TYPES` in `server/modules.js` (line 612) holds `color`; its default must match `COLOR_RE` and is stored lower case, else `#000000` (line 799). So the Stream plan's "new setting type `color`" is built. Read in code.
- **The SDK's pickers.** `host.ui.datePicker`, `host.ui.kindPicker`, `host.ui.currencySelect`, `host.ui.timeField` and `host.ui.peoplePicker` are drawn **inside the module's own page**, by the SDK, so they work the same in a sandboxed frame and in the page. `host.ui.confirm`, `host.ui.prompt` and `host.ui.toast` are the other kind: the SDK sends a call (`ui.confirm`, `ui.prompt`, `ui.toast`) and the page draws them over everything (`module-host.js`, lines 1605 to 1619). Each call is described in a comment in `host.js` and in a bullet under "Shared tools" in [api-module-sdk](../api/api-module-sdk.md). Read in code and in the document.
- **Sharing an SDK piece with the pages.** The SDK already lends pieces to pages that are not modules: `window.hostCurrency` (Manage's currency list, the same list a module's `currencySelect` draws) and `window.hostSwitch` (the view switch) are set at the end of `host.js` (lines 4890 to 4921). The pages that load `/sdk/host.js` are `admin.html`, `space.html`, `module.html`, `destination.html`, `keyed.html` and `shared.html`. `host.html` (the host console) and `profile.html` do not, and both reach `colour-pick.js`. Read by a search.
- **How the Whiteboard picks colours now.** Through `host.menu.show`: a menu of rows, each with a round icon coloured by `iconColor`, in groups. The board background menu has Default, a switched-off "Custom colour (coming with the colour picker)" row, Light backgrounds, Dark backgrounds and Tinted backgrounds. The block colour menus (fill, border, words, line) have the same groups since 0.1.34 (`wbColourMenuModel()`), with the same switched-off Custom row last. A fixed colour is stored as an id (`light-white`, `dark-slate` ...) and drawn from a custom property in `whiteboard.css` (`--wb-fixed-*`, under the comment "Move to core design-system tokens when the colour picker lands"); a tinted colour is stored as a palette id and follows the theme. No colour is stored as a hex today. The Whiteboard is at 0.1.66. Read in code.
- **How popovers are anchored today.** Inside a module, `host.menu.show` (and the date picker and the tag picker) places by an `anchor` element in the module's own page (under it, flipped above when it does not fit below) or by an `at` point, always clamped inside the module's own box (`placeMenu()`, `host.js` line 2312). A button the host draws for a module (a toolbar button or a title-bar action) gives the module only an `x`, measured from the module's own area (`createFrameBands()`, `xOf()`, `module-host.js` line 1184), and the document says to open a menu with `at: { x, y: 4 }`. Under a toolbar button that lands right; under a title-bar action it lands at the top of the content, below the toolbar, not under the button. A sandboxed module's editor window escapes its frame only through the host's lift (`module-host.js`, line 1057). Read in code.
- **#480.** An idea, not a plan, raised by the Whiteboard session: (1) swatches on toolbar buttons, (2) module buttons in the toolbar's right zone, (3) a menu under a title-bar button ("the click carries the button's rectangle, or the host opens menus at the button"). Its 2026-11-10 comment says (2) is built (`zone: 'end'`, PR #516) and (1) and (3) are still open. `documentation/TODO.md` lists it: "#480 Toolbar additions for modules. Not planned yet". Read in the issue.
- **Contrast maths exists, for the pages only.** `public/theme-colour.js` (a plain script, `window.ThemeColour`, also `require`d by the server) has the WCAG contrast ratio (`contrast(a, b)`) and `pickOn(fill)`, which picks white or near-black on a fill and says whether it reaches 4.5:1. The SDK has none; `tools/lib/contrast.mjs` is the checks' own copy. Read in code.
- **The design system.** The Pickers family was approved on 2026-10-21 ("One colour picker where there are three looks today": a trigger with a 22 px swatch and the hex in words, a grid of 24 px swatches, 44 px targets on a phone, the native input as "Custom"). The trigger is replaced by the colour chip of decision 33. The Design System page's `pickers` entry (`public/design-system/components.js`, line 83) draws the trigger and the swatch grid with the native Custom row. The styles are the Pickers block of `public/sdk/system.css` (`--pk-sw` 24 px, `--pk-sw-cell` 28 px and 44 px at 640 px and below, `--pk-lead` 22 px). `tools/check-system-css.mjs` allows `--sw` as the one per-swatch colour, set from the palette as data. Read in code.

## Decisions

Thomas, 2026-11-19 (his answers to the first draft's questions 1 to 4, and a further decision).

1. **The picker opens at an element in the module or at a point (option N1).** The main use is from the toolbar, but it must also open in context: where a person clicked, or at a control in the module's page. So the call takes an `anchor` (an element of the module's own page) or `at` (a point in the module's area), as `host.menu.show` does. The host's button rectangle (#480 point 3, the first draft's step 5 and option N2) is not taken. Reason: it covers the toolbar and every place a module opens colours from today, with no change to the module frame.
2. **The picker has an opacity slider.** Opacity is a whole-number percent from 0 to 100 beside `#rrggbb` in the answer, never inside it (option B1, not B2). Decision 8 shows it always (replaced by decision 20). Reason: #544 wants a transparency for fills, and the colour stays seven characters (decision 7).
3. **A contrast helper in the SDK, with no picker UI (option C2).** `host.util.contrast(a, b)` and `host.util.readableOn(fill)`, the same maths as the theme editor's; no warning inside the picker. Reason: #544 needs words on a fill to pick light or dark at 4.5:1, which this answers, and a warning in the picker is not needed for it.
4. **A core default palette, and a module may replace it with its own named groups (option D2).** Reason: one palette everywhere by default, and a module with colours of its own (the Whiteboard) can still offer them in the same picker.
5. **"We can scrap all previous pickers and colour palettes."** Nothing of today's colour choosing is kept: the native "Custom" input in `public/colour-pick.js`, its popover and its 16 named swatches, `list-rows.js`'s own colours for new rows, and the Whiteboard's fixed colours and their ids are not binding. Reason: the product is unreleased (`CLAUDE.md`: no compatibility layers; test data may be reset).

Thomas, 2026-11-10, in #544. Still true.

6. **No native colour input as a stopgap.** No page or module draws `<input type="color">` for a person to use.
7. **A colour a person picks is stored as `#rrggbb`, checked strictly:** exactly 7 characters, hex digits only, and never an unchecked string in CSS. So the picker answers `#rrggbb` and nothing else, and a module checks it again before it stores or uses it.

Thomas, 2026-11-19 (his answers to the second draft's questions 2, 3 and 4).

8. **The opacity slider is always shown.** Not only when a module asks; this replaces the planner's suggestion. So every answer carries an opacity. What a colour that is stored as `#rrggbb` alone (a `color` setting, a list row's colour) does with it is decision 11. Reason: one picker that looks the same everywhere. *Replaced by decision 20 (2026-11-22): where an opacity isn't kept, no slider is shown. Text kept as the record.*
9. **The SDK call is two calls: `host.ui.colorPicker(options)` and `host.ui.colorField(input, options)` (option S3).** The first opens the picker and resolves the answer; the second puts a colour trigger on an input in a form, and is what the host's own pages use. Reason: a choice from the toolbar or in context and a value in a form are different uses.
10. **The colour picker lands before the freeze, whatever else slips.** Steps 1 to 4 are merged, with their reads, QA and documentation, by Thursday 2026-12-10. If the builders can't do everything before the freeze, other work moves, not this. Reason: #544 and the module settings wait on it, and a new SDK call can't be added once the freeze starts.

Thomas, 2026-11-19 (open question 2).

11. **A colour stored without its opacity shows the slider switched off (option O2).** For a value that keeps `#rrggbb` only (a `color` setting, a list row's colour), the opacity slider is shown at 100 and switched off, with the line "Opacity isn't kept here." The host's colour-only fields pass `opacity: false`. Reason: it keeps the slider always shown (decision 8), tells the person plainly where opacity does not stick, and changes no stored format before the freeze. O3 (a setting that keeps an opacity) is not taken. *Replaced by decision 20 (2026-11-22): no switched-off slider and no line. Text kept as the record.*

Thomas, 2026-11-19 ("merge when green").

12. **The default palette is accepted as built:** 24 colours in three groups of 8, Light, Dark and Strong. This answers open question 1. *Replaced by decisions 22 and 24 (2026-11-22): one grid sorted by colour, with 24 new starting colours. Text kept as the record.*
13. **New list rows start on the Strong colours in turn, Red first,** not the whole palette in order. This replaces "in order" in the contract. Reason: Strong is the group for marks and bold fills. *Decision 22 removes the Strong group, so which colours a new list row takes is open again (open question 9).*
14. **In dark mode 16 of the 24 swatches get the stronger edge,** as built.
15. **At 360 px wide the swatch cells narrow to about 42 px wide and stay 44 px tall,** as built.
16. **`host.html` does not load the SDK, and `module-config.html` does,** as built. Reason: the host console draws no colour field there.
17. **`host.ui.colorPalette()` is not built now.** A module does not read the default palette for the time being.

Thomas, 2026-11-22 (the Whiteboard, #544).

18. **The Whiteboard's colour menus drop their preset groups.** Seeing Whiteboard 0.1.83's fill menu, Thomas said: "we do not need all of the legacy choices. This is no longer 'custom' color... it is just 'Color'." So Light, Dark, Tinted and the named tinted rows go. Each menu has one "Colour" row that opens the picker, and keeps None, Default and Pattern where they belong. The word is "Colour", the product's spelling wherever a person reads it; Thomas wrote "Color", and if he meant the US spelling it is a one-word change. Saved boards with fixed or tinted ids still draw as before. Reason: the picker (decision 5) replaces the old palettes, so the menus need no copy of them.
19. **The fill pattern (#544) is None, Dots, Stripes, Grid and Crosshatch,** drawn faintly in the fill's readable words colour. Thomas asked for the fill pattern on 2026-11-22. The project manager chose this set as its lean, pending his view; it stands unless he says otherwise.

Thomas, 2026-11-22 (after trying Whiteboard 0.1.84).

20. **Where a colour can't keep an opacity, the picker shows no Opacity slider and no line.** Thomas: "'opacity isn't kept here' makes no sense to the user. if you can't set it, don't show it." So with `opacity: false` the picker draws no slider and no line, and the answer's opacity is always 100. This replaces decision 8 (the slider always shown) and decision 11 (O2, shown switched off). Reason: a control or a line a person can't use only confuses.
21. **The Whiteboard's Colour row and the picker's starting colour are the colour the block shows as drawn, not its stored base tint.** Thomas: "i want to honor what is in the color picker, so i think that means show the shade as drawn." So the picker opens on the shade the block is drawn in, and anything picked draws exactly as picked. Reason: what a person sees in the picker and on the board must be the same colour.

Thomas, 2026-11-22 (the palette becomes the person's own grid).

22. **The picker's palette is one grid, organised by colour.** Thomas: "get rid of these categories. just show a grid of colors, organized by color. we do not need the previous ones." So there are no Light, Dark or Strong headings. The palette is one grid sorted by hue: whites, greys and black first, then red through purple. Recent stays as it is. This replaces decision 12. Reason: one grid by colour is easier to scan than three named groups.
23. **The person edits the grid.** Thomas: "we should be able to drag a current one into the grid. right click to remove one." The grid is kept per person, on any device (his choice): it is stored on the person's account, not in the browser. These are the project manager's leans, not Thomas's words, and stand unless he says otherwise:
    - a right-click on a swatch opens a small menu with "Remove";
    - the Delete key on a focused swatch removes it too;
    - a "+" at the end of the grid adds the current colour, for keyboard and touch;
    - the grid holds at most 48 colours;
    - a colour already in the grid is not added twice;
    - a colour a person adds keeps its opacity.
24. **The starting grid is 24 new colours, a traditional palette, all fully opaque.** Thomas: "ignore the colors from before. go with 24 but make them a traditional palette. include white and black. for the preconfigured, all are fully opaque." So the Light, Dark and Strong colours of decision 12 are gone. The 24 are the planner's proposal under "The starting grid (proposed)", for Thomas to see as a chart; until he changes them they are what is built.
25. **No theme colours: colours stay fixed.** Thomas chose "No, colours stay fixed". The theme's tints and its text colour are not offered in the picker or the grid. His question was whether colours that follow the theme were offered before the picker. The answer, from the code before the picker: the Whiteboard offered the 8 theme tints and the theme's text colour, which followed the theme, and a background "Default" that follows the theme; its Light and Dark families and the host pages' 16 named swatches (`colour-pick.js`) were fixed. Reason: a picked colour is data and looks the same in every theme and mode (decision 7).
26. **A module's own palette replaces the grid in that picker, and is not editable there.** This is the project manager's lean, standing unless Thomas says otherwise. A picker opened with `palette` shows the module's colours in place of the person's grid, with no "+", no Remove and no drop. Reason: the module's colours are the module's, and editing them in one picker would not reach the module.

Thomas, 2026-11-22 (Recent).

27. **Recent is kept with the person's account, like the grid.** Thomas: "yes, keep recent with my account too". Recent follows the person to any device and works in every module, sandboxed ones included. It is stored and reached the same way as the grid. Before this, Recent was kept in the browser per module, so it was empty on another device and not kept at all in a sandboxed module. This replaces the per-browser Recent of decision 22 ("Recent stays as it is"). These are the project manager's leans, not Thomas's words, and stand unless he says otherwise:
    - one Recent list per person across all modules, not one per module;
    - the last 8 colours chosen, newest first, each with its opacity, `{ color, opacity }`;
    - not shown while empty;
    - a module's own `palette` doesn't change Recent;
    - a choice adds to the front, and drops an older copy of the same colour and opacity.

Thomas, 2026-11-23 (module access to the grid).

28. **In an uploaded (sandboxed) module the grid and Recent are read-only.** The question: the picker runs inside the module's own page (the A1 reading of decision 1), so an uploaded module can send the same host calls the SDK sends and could read or change the person's grid and Recent. Thomas's answer: "Read-only in uploaded modules". It means:
    - in a sandboxed module frame, the page answers the grid and Recent as not editable and refuses their writes;
    - the picker there shows the grid and Recent with no "+", no drag-in and no Remove;
    - a pick there doesn't update Recent;
    - bundled modules running in the page, the host pages' own pickers and Manage stay editable;
    - reading the colours stays allowed everywhere.

    Options he did not take: the page draws the picker over everything for uploaded modules (A2), which closes it fully but is a larger change; and one-step calls only, which limits harm but doesn't close it. This replaces the acceptance of a hostile module rewriting the grid in the contract and in risk 10.

Thomas, 2026-11-22 (the picker everywhere).

29. **The new colour picker is the only way a colour is set, everywhere.** Thomas's answer, relayed by the project manager, was "Yes, all of it". It means:
    - Manage's theme editor moves onto the picker (this answers open question 5);
    - the `theme-` exemption is removed from `check-no-colour-input`;
    - the check scans `modules/` too;
    - every place a colour is set is listed under "Where a colour is set", each opening the picker or with a reason it doesn't.

    The earlier reason is kept as the record: a theme's colours are design, not data, and the theme editor has its own contrast panel. Thomas chose one picker over that.

    Built as a try build on branch `claude/colour-picker-everywhere`: Manage > Theme's 48 colours open the picker, with no opacity and live preview while dragging; `host.ui.colorField` gained an `onInput` option, for showing only; Documents 0.11.37 opens the picker for Page colour; `check-no-colour-input` scans `modules/`, with one precise rule for MapLibre's style specification.

Thomas, 2026-11-23 (Tags and Maps places), relayed by the project manager.

30. **Space Tags' colour moves to the colour picker.** Thomas looked at Set up's Tags section (a name box and a colour dropdown: Plain, Gold, Blue, Green, Teal, Purple, Red, Orange, Pink) and said: "we replace it with our tool". This answers open question 12. It replaces plan-tags' rule that a tag's colour is a tone name from the fixed set, never a free colour (`cleanColor` and `TONES` in `server/tags.js`). So tags no longer follow the theme; a picked colour is data (decisions 7 and 25). Tags stored with a tone name may be reset: no migration and no alias (the product is unreleased).

    The planner's leans for the small choices, which stand unless Thomas changes them:
    - the stored `color` is `#rrggbb`, lower case, checked strictly (decision 7), with no opacity (`opacity: false`);
    - "Plain" becomes no colour: `color` absent or empty, drawn as the plain chip is today. The picker has no "none", so a "No colour" control sits beside it as the way back;
    - a chip's words take their colour from `host.util.readableOn(color)` (decision 3).

    The build waits for pull request #1052 (Set up in six tabs) to merge, since it changes the same Tags section.

31. **A Maps place's own colour opens the picker.** This answers open question 13. The place summary's `color` takes a strict `#rrggbb` as well as a tint name (today only a tint passes `SUMMARY_TINTS`, `server/index.js`). "Same as the category" stays as the way back.

32. **A phase has its own colour, set with the colour picker.** Thomas, 2026-11-23: "that is a horrible experience and makes phases an exception. it gets a color chooser." This answers open question 14 and replaces his first answer the same day ("phases keep their colour by order"). The picker sits beside the phase's name on the template's Phases page (Manage > Template > <template> > Phases). Thomas, the same day: "anywhere you can add or edit a phase gets a color chooser." So the colour field is on the template's Phases page and on every other place where a phase is added or its name is edited; a place that only sets a phase's dates does not get one. The colour is stored per phase in the template as `#rrggbb`, lowercase, with no opacity. Every space that uses the template draws that phase in that colour everywhere a phase is drawn: the phase sheet, Set up's Phases tab, the status strip, the journey layout and `host.util.phaseTimeline`. A phase's colour no longer follows the theme (`Phases.tintOf` goes) and no longer changes when phases are reordered.
    - Planner's lean, not decided: a phase with no stored colour (the shipped templates, a newly added phase) gets a starting colour from a fixed default sequence, taken from the starting grid in the old tint order so today's look is kept: Blue `#1e5fd0`, Green `#2e9e3e`, Teal `#008080`, Purple `#7b3fb5`, Orange `#f28c28`, Pink `#f48fb1`, Yellow `#ffe135`, Red `#d62828`, then round again. The default is filled in when the phase is read, saved when the owner saves the template, and can be changed. No migration.
    - Planner's lean, not decided: a phase's colour is a template setting, not set per space.
33. **The colour field is a colour chip.** Thomas, 2026-11-23, looking at the template's Phases page, where the field was a full-width button like a select (a swatch, the hex and a chevron) on a row of its own: "why do we have a dropdown? why isn't it the color chip and it opens the chooser?" and "it is on a giant row of its own too? no good. they all better not be like this." So everywhere a colour is set:
    - the field is a square swatch chip filled with the picked colour, and pressing it opens the picker;
    - it has no chevron and no hex text;
    - it sits inline, on the same row as what it colours (a phase's name, a tag's name, a setting's label), never on a row of its own. On a phone it may wrap only when the row cannot fit;
    - it is the shared SDK field, `host.ui.colorField`, fixed once there and not per page (the core rule in `CLAUDE.md`).
    - Planner's lean, not decided: the hex stays in the picker, in the chip's accessible name and in its tooltip.
    - Swatches show exactly their colour. Thomas saw them washed out on the template's Phases page; that is a bug, being fixed. A swatch's fill is the colour as stored, with nothing laid over it (no tint, no opacity, no filter).
    Reason: a dropdown look says "pick from a list", and a full row for one colour wastes room; a chip is the colour itself and opens the chooser. This replaces the trigger of the Pickers family approved on 2026-10-21 (a swatch and the hex in words) and the trigger shape in the contract ("The SDK calls", `colorField`).

**What decision 5 lets the plan drop.**

- **Keeping `colour-pick.js`'s exports.** The first draft kept `upgradeColourInputs` and `colourPicker` so their users would not change. Now `colour-pick.js` is removed, and `module-settings.js`, `list-rows.js` and `template-pages.js` call the SDK's colour field directly. `tools/check-template-pages-b.mjs`, which stubs the old import line, changes with them.
- **The `id` round trip.** The first draft answered a palette entry's `id` so the Whiteboard could keep storing `light-white`. Now the answer is a colour (and an opacity) only. A module's own palette entries are a name and a colour, and the module stores `#rrggbb`. The Whiteboard's saved boards with fixed or tinted ids may be reset (test data), in #544's own build.
- **The Whiteboard's fixed colours as a separate set.** #544's "move to core design-system tokens when the colour picker lands" is met by the core default palette, kept as data in the SDK, not as theme tokens, because a picked colour must not follow the theme (the planner's reading; the proposal is open question 1).
- **Today's 16 swatches as the default.** The new default palette is proposed below for Thomas to confirm.

**Rules from `CLAUDE.md` that apply** (not decisions of this plan): the picker itself is drawn in theme tokens only, while the colours inside it are data; reuse the SDK's pieces (the popover, the radio group of swatches, the Pickers block); the SDK is core, so each core step has an independent read and the full `npm run check` runs at release prep; and a new SDK call is one of the things the freeze stops (plan-release, "The freeze").

## Where a colour is set

Decision 29 makes the picker the only way a colour is set; this is every place a colour is set today and what it does.

| Place | Opens the picker | Notes |
|---|---|---|
| Manage > Theme, 48 colours | Yes (from this build) | No opacity: the store keeps `#rrggbb` only. Live preview while dragging. |
| Module `color` settings (Manage, a module's settings page, Profile) | Yes | Through `colour-field.js`, no opacity. |
| Template pages' `color` settings | Yes | Same. |
| List rows' colours (Budget categories, Maps categories and place types, Planner markers, Research tags, Planner tags) | Yes | Every manifest list setting goes through `list-rows.js`. |
| Whiteboard: fill, border, words, line, background, grid | Yes | The grid's other swatches are theme tokens by design. |
| Documents page colour | Yes (from this build) | Old named colours still draw. |
| Space Tags colour | Yes, to build (decision 30) | Stored as `#rrggbb`, no opacity; "No colour" beside the picker is the plain chip. Today a tone name from a dropdown (`TONES`, `server/tags.js`). Waits for #1052. |
| Maps: a place's own colour | Yes, to build (decision 31) | Needs the server: the summary's `color` takes `#rrggbb` as well as a tint name (`SUMMARY_TINTS`, `server/index.js`). "Same as the category" is the way back. |
| Phases | Yes, to build (decision 32) | Today a phase's colour comes from its order: the 8 theme tints in turn (`tintOf`, `public/phases.js` and `public/phase-sheet.js`; "Templates carry no colour"). Decision 32 replaces that: the picker sits beside the phase's name on the template's Phases page, and the colour is stored per phase in the template. |
| Calendar, To-do, Goals, Polls, Vault, Profile's own fields, space settings, host console | Nothing to set | Labels are space Tags; tints come from order or the module. |
| A module's tint (manifest `color`) | Not set by a person | Chosen by the module author from the 8 tints. |

The planner's lean, not a decision: Documents' page colours follow decision 18 (the person's grid, no preset list). The alternative was passing the 7 page colours as the module's own palette (decision 26).

## Options for Thomas

Decided: B by decisions 2 and 8, C by 3, D by 4, N by 1, S by 9. Their options stay below as the record of what was weighed. O by 11. A was not asked on its own; the contract is drafted on A1, the planner's reading of decision 1 (open question 3).

### A. Where the picker is drawn

Not asked separately. Decision 1 (an element in the module or a point, and no host button rectangle) fits A1. A2 was the route to opening at the host's own button, which decision 1 does not take.

| Option | What it is | Cost | Rules out |
|---|---|---|---|
| **A1. In the module's own page, by the SDK (lean)** | Like the date and kind pickers and `host.menu.show`: the SDK draws the popover in the module's page, placed by an element of the module's or a point, clamped inside the module's box. The host's pages get the same code through a page global, as `hostCurrency` does | `host.html` and `profile.html` must load `/sdk/host.js`. In a small docked module the picker has only the module's box. The eyedropper in a sandboxed frame is unproven (see Risks) | A picker that sits under a title-bar button (it opens at the top of the content, as menus do today) |
| A2. Over the page, by the page | Like `host.ui.confirm` and `host.ui.prompt`: the SDK sends a `ui.colorPicker` call with where to open it, and the page draws the picker over everything | Every change while the person drags must reach the module as it happens: a new kind of call that sends many answers. The SDK must turn an element in the module into a place on the page. A new handler in `module-host.js` | Nothing |

### B. Opacity

Decided: B1 (decision 2), with the slider always shown (decision 8).

| Option | What it is | Cost |
|---|---|---|
| **B1. Part of the answer** | An **Opacity** slider (0 to 100 percent, whole numbers); the answer is `{ color: '#rrggbb', opacity: 80 }` | One more control and one more field. The module stores the two apart |
| B2. Inside the colour, as `#rrggbbaa` | One string | Breaks decision 7 and the `color` setting's format |
| B3. A separate control | The picker does colour only; a module draws its own transparency control | Each module that wants it builds it again |

### C. A contrast helper

Decided: C2 (decision 3).

| Option | What it is | Cost |
|---|---|---|
| C1. None; the module's job | The picker answers a colour; a module works out readable words itself | The Whiteboard writes contrast maths that `theme-colour.js` already has |
| **C2. A small helper in the SDK, no picker UI** | `host.util.contrast(a, b)` and `host.util.readableOn(fill)`, the same maths as `pickOn()` in `theme-colour.js`, with a check that the two agree | Two copies of a few lines, held together by a check |
| C3. C2, plus a warning in the picker | The module passes `contrastWith` and the picker says "Hard to read" under the colour | More words and a rule for what "on" means |

### D. The default palette, and a module's own

Decided: D2 (decision 4); the colours themselves are proposed under "The default palette (proposed)" and are open question 1.

| Option | What it is | Cost |
|---|---|---|
| D1. One core palette, no module palette | One palette everywhere | A module with colours of its own can't offer them in the picker |
| **D2. A core default, and a module may replace it with its own groups** | A module may pass `palette: [{ heading, colours: [{ name, color }] }]` to show its own groups instead | A palette check (shape, names, `#rrggbb`, limits) |
| D3. A core default a module may add to but not remove | | Every picker shows the core colours, even where they don't fit |

### N. Anchoring the popover

Decided: N1 (decision 1). N2 is not taken, and #480 point 3 stays its own issue.

| Option | What it is | Cost |
|---|---|---|
| **N1. At an element in the module, or a point** | `anchor` or `at`, as `host.menu.show` | Nothing new. A title-bar button opens at the top of the content |
| N2. N1, plus the host button's rectangle | The `toolbar` event carries the button's rectangle and `anchor` takes it | A change to `createFrameBands()` and a new SDK field |
| N3. N1 now, #480 point 3 later | As N1 | Nothing here |

### S. The SDK call's shape

Decided: S3 (decision 9).

| Option | What it is | Fits | Cost |
|---|---|---|---|
| S1. A field, like `datePicker` | `host.ui.colorPicker(input, options)` upgrades an input the module has: the trigger, then the popover | A form in an editor window | The Whiteboard opens colours from its toolbar and in context, with no field |
| S2. A popover that answers, like `host.menu.show` | `host.ui.colorPicker({ anchor?, at?, value, ... })` opens it and resolves the answer, or `null` | The toolbar, menus, a click on the board | A form draws its own trigger |
| **S3. Both, as two calls** | `host.ui.colorPicker(options)` is S2. `host.ui.colorField(input, options)` is S1, built on it, and is what the host's pages use | Both | Two names where #933 named one |

### O. A colour stored without its opacity

Decided: O2 (decision 11), then replaced on 2026-11-22 by decision 20: where the opacity is not kept, no slider and no line are shown, and the answer's opacity is 100. What follows is the record of what was weighed. The slider was always shown (decision 8), so every answer carried an opacity. But a `color` setting stores `#rrggbb` only (`server/modules.js`, line 798), and so does a list row's colour (`list-rows.js`). As drafted, a person could move the slider there and the opacity would be thrown away when the setting is saved, with nothing saying so. The same holds for a module that stores a colour alone.

| Option | What it is | Cost | Rules out |
|---|---|---|---|
| O1. Shown, and ignored where it is not kept | The answer carries `opacity`; a `color` setting and a list row keep the colour only. The slider works but has no lasting effect there | Nothing to build. A person is shown a control that does nothing after saving, which the release's "done" contract forbids ("A person is never offered a control that does nothing", plan-release) | Nothing |
| **O2. Shown, but held at 100 and switched off where it is not kept (decided, decision 11)** | `colorField` and `colorPicker` take `opacity: false` for a value that keeps the colour only: the slider is drawn, at 100 percent and disabled, with one line under it, "Opacity isn't kept here." The host's `color` settings and list rows pass it. A module that keeps an opacity leaves it out | One option and one line of words. The slider is still always shown (decision 8) | A transparent colour in a module setting, until O3 is chosen for it |
| O3. The setting keeps the opacity | A `color` setting may declare `"opacity": true` in the manifest and then stores `{ color, opacity }` (or a second value beside the colour); a list row likewise | A new manifest field and a change to a stored format: a server half in `server/modules.js` and the forms, more for the independent read, and both fall under the freeze, so they must also land by 2026-12-10 (decision 10) | Nothing |

Why O2 (decision 11): it keeps the slider always shown, tells the person plainly where opacity does not stick, and changes no stored format before the freeze. O3 can follow for a setting that needs a transparent colour, after the release if need be. No module setting asks for one today.

## The starting grid (proposed)

Decision 24: 24 new colours, a traditional palette with white and black, all at opacity 100. This is the planner's proposal, for Thomas to see as a chart and change. It is what a person sees until they first edit their grid (decision 23), and it is not stored on their account until then.

A crayon-box set: white, three greys and black, then each hue with a lighter and a darker step where a box has one, in the order the grid draws them (the rule is under "The person's colour grid", "The order"). In rows of 8 that is: the neutrals and the reds; the browns, orange, yellow and the greens; the blue-greens, the blues, the purples, pink and magenta.

| # | Name | Colour | Opacity |
|---|---|---|---|
| 1 | White | `#ffffff` | 100 |
| 2 | Light grey | `#c0c0c0` | 100 |
| 3 | Grey | `#808080` | 100 |
| 4 | Dark grey | `#404040` | 100 |
| 5 | Black | `#000000` | 100 |
| 6 | Light red | `#f28b82` | 100 |
| 7 | Red | `#d62828` | 100 |
| 8 | Dark red | `#8b1a1a` | 100 |
| 9 | Light brown | `#d2b48c` | 100 |
| 10 | Orange | `#f28c28` | 100 |
| 11 | Brown | `#8b5a2b` | 100 |
| 12 | Yellow | `#ffe135` | 100 |
| 13 | Light green | `#90ee90` | 100 |
| 14 | Green | `#2e9e3e` | 100 |
| 15 | Dark green | `#1b5e20` | 100 |
| 16 | Cyan | `#00bcd4` | 100 |
| 17 | Teal | `#008080` | 100 |
| 18 | Light blue | `#87ceeb` | 100 |
| 19 | Blue | `#1e5fd0` | 100 |
| 20 | Dark blue | `#1a237e` | 100 |
| 21 | Light purple | `#c3a6e8` | 100 |
| 22 | Purple | `#7b3fb5` | 100 |
| 23 | Pink | `#f48fb1` | 100 |
| 24 | Magenta | `#d81b9c` | 100 |

- **Why these.** Each is a colour a person can name at a glance, as in a paint or crayon box, and each name is plain words; Cyan, Teal and Magenta are the box's own names. Brown sits with orange because its hue is orange's.
- **Not worked out yet.** Unlike the first palette, these carry no contrast figures: they are fills and marks a person chooses, not words. White on a light menu and Black on a dark one still get the stronger edge (decision 14's rule, worked out when drawn). The order was worked out with a short script using the rule under "The order"; nothing was tried in a browser.
- **Theme tokens.** None (decision 25): the colours are data and the same in every theme and mode. Everything around them is tokens, as before.

## The default palette (as first proposed; replaced)

Replaced by decisions 22 and 24 on 2026-11-22: the three groups are gone, and so are their colours. Kept as the record of what was built under decision 12.

Decision 4 asks for a core default; decision 5 frees it from today's 16. This is the planner's proposal, for Thomas to confirm or change (open question 1).

**Three named groups of 8, 24 colours**, each a row of the swatch grid under its heading:

| Group | Colours (name, `#rrggbb`) | What it is for | Contrast, worked out |
|---|---|---|---|
| **Light** | White `#ffffff`, Cream `#f5eedb`, Light grey `#e4e6ea`, Light blue `#dce9f6`, Light green `#ddeedd`, Light yellow `#fbf4c8`, Light pink `#f8e0e9`, Light purple `#e8e0f5` | Pale fills and backgrounds | Dark words `#1c2024` on each reach 12.8:1 or more |
| **Dark** | Black `#000000`, Slate `#2b3440`, Dark grey `#34373c`, Navy `#14274b`, Forest `#163a2b`, Wine `#4a1b2b`, Plum `#2f2050`, Brown `#3d2b1f` | Dark fills and backgrounds, and words on a light ground | Light words `#eceff3` on each reach 10.3:1 or more; each reaches 11.9:1 or more as words on white |
| **Strong** | Red `#c0392b`, Orange `#b8560f`, Gold `#8a6a00`, Green `#2e7d32`, Teal `#00796b`, Blue `#2f6cbf`, Purple `#7c55c8`, Pink `#b23f7f` | Marks, lines, borders and bold fills | White words on each reach 4.8:1 or more; each reaches 3:1 or more against both a white surface and the default dark ground `#0e1a2b`, so it reads as a mark in either mode |

- **Where the values come from.** The Light and Dark groups take the Whiteboard's fixed colours as they are today (`whiteboard.css`), which Thomas has already seen, plus Light purple and Brown so each group fills a row. Strong takes the light values of the eight tints (design-theme, "Tints") where they pass, and lightens Blue, Purple and Pink slightly so they also pass 3:1 on the dark ground. Not tried in a browser.
- **Theme tokens where possible.** The colours inside the palette can't be theme tokens: a picked colour is data and must look the same in every theme and mode (decision 7; `colour-pick.js`'s own rule). Everything around them is tokens: the popover, the headings, the edges, the check disc, the focus ring. The eight theme tints, which change with the mode, are not in the palette.
- **Swatches on both themes.** A pale swatch on a light menu, or a dark one on a dark menu, has less than 3:1 against the surface (White on white is 1:1). Every swatch whose colour has less than 3:1 against the menu's surface gets a stronger edge, worked out when it is drawn with the contrast helper (see "What a person sees"). So all 24 can be seen in either mode.
- **Where it lives.** One list in the SDK, with each colour's name. Whether a module can read it (so its own menus can offer the same colours) is part of open question 1; suggested: yes, read only, as `host.ui.colorPalette()` (a suggested name), answering the groups as the picker shows them.

## The contract

Drafted on decisions 1 to 26 (decision 20: no slider and no line where the opacity is not kept; decisions 22 to 26: the person's own grid, under "The person's colour grid") and the planner's reading A1 (open question 3). A different answer to an open question changes only the part that names it.

### The SDK calls (experience-design; core)

```js
// Opens the picker; resolves the answer, or null when the person cancels.
host.ui.colorPicker({
  anchor,      // an element of the module's own page to open under; or
  at,          // { x, y } in the module's area, as host.menu.show takes it
  value,       // '#rrggbb' to start from (anything else starts from the grid's or palette's first colour)
  opacity,     // 0 to 100 to start the slider at (default 100); false where the opacity is not kept: no slider and no line are shown, and the answer's opacity is 100 (decision 20)
  palette,     // [{ heading, colours: [{ name, color }] }] in place of the person's grid, not editable there (decisions 4 and 26)
  recent,      // false to leave out the recent colours (default: shown)
  label,       // what the dialog is called for a screen reader ("Fill colour"); default "Colour"
  onInput,     // (answer) => {} on each change while it is open, to show it live; never stored by the SDK
}) // -> Promise<{ color: '#rrggbb', opacity: 0..100 } | null>

host.ui.colorField(input, { palette, opacity, recent, label, onChange })
// -> { value, set(hex), open(), close(), destroy() }
```

- **Where it opens (decision 1).**
  - **From the toolbar**, the main use: a `host.ui.toolbarButton` (or a `button` of `host.toolbar.set`) whose `onClick` gets the `toolbar` event with `x`, and opens `host.ui.colorPicker({ at: { x: e.x, y: 4 }, ... })`, so the picker sits under the toolbar at the button. Where the host gives no `x`, `{ x: 100000, y: 4 }` puts it at the top right of the module, as for menus.
  - **In context:** at a control in the module's page with `anchor` (a swatch in the Whiteboard's strip, a row's colour), under it and flipped above when it does not fit below; or where the person clicked with `at` (the click's point in the module's area, as a right-click menu is placed today). From a menu row (the Whiteboard's "Custom colour"), at the point the menu was opened.
  - **From a title-bar action:** at the top of the content, at the button's `x`, as menus do today. The host's button rectangle (#480 point 3) is not part of this plan.
  - In every case it is clamped inside the module's box.
- **The answer.** `color` is always exactly `#` and six lower-case hex digits (decision 7). `opacity` is always there, a whole number from 0 to 100 (decisions 2 and 8); with `opacity: false` it is always 100. `null` means nothing changed: Escape, or the same call again while it is open (a toggle, as `host.menu.show` does). There is no `id`: a colour from a module's own palette answers its `color` like any other (decision 5).
- **When it answers.** A swatch or a recent colour answers and closes. Dragging in the area or on a slider, typing a hex or using the eyedropper sends `onInput` and leaves it open; Enter in the hex field, or a press outside the picker, answers with what is showing and closes. Escape answers `null`, and the module puts back what it showed before. Suggested; open question 6.
- **Refused, thrown at once** (as `kindPicker` and `timeField` do): no `anchor` and no `at` ("host.ui.colorPicker needs an anchor or a point"); a `palette` that is not groups of `{ name, color }` with a plain-text name and a `#rrggbb` colour, at most 6 groups and 48 colours ("host.ui.colorPicker: a palette colour needs a name and a #rrggbb colour"). A `value` that is not `#rrggbb` is not refused; it is ignored.
- **One at a time.** Opening one closes any menu or picker the module has open, as `host.menu.show` does.
- **`colorField`.** A colour chip (decision 33): a square swatch filled with the colour, with no hex text and no chevron, inline on the row of what it colours, never on a row of its own (a phone may wrap it only when the row cannot fit). Its tooltip is the hex. It sits on an `<input type="color">` or `<input type="text">` the module or page has. The input stays, hidden, and holds the colour; a choice sets it and sends `input` and `change`. `onChange({ color, opacity })` gives both; the input never holds the opacity. A field whose value keeps the colour only passes `opacity: false` (option O2, decision 11). It follows a disabled input. It never shows the browser's own colour input (decision 6).
- **What it costs a module.** Nothing to declare: no permission, no manifest key and no route. It is an interface piece like `datePicker`. The host stores nothing for the module; the person's grid is the person's, reached through the page (see "The person's colour grid"), and a module never reads or writes it itself. The recent colours are kept in this browser for this module, the way the kind picker's `recent` is (the builder reads how that works in a sandboxed frame and does the same). A module that starts using it bumps its own version.

### The contrast helper (experience-design; core; decision 3)

- `host.util.contrast(a, b)`: the WCAG 2 contrast ratio of two `#rrggbb` colours, a number. Anything else throws "host.util.contrast takes two #rrggbb colours".
- `host.util.readableOn(fill)`: `{ color, ratio, ok }`. `color` is `#ffffff` or `#0a0a0a`, whichever has more contrast with `fill`; `ok` is true at 4.5:1 or more. The same maths and the same two colours as `pickOn()` in `public/theme-colour.js`; the check holds them equal.
- No warning or contrast readout inside the picker.

### What a person sees (experience-design)

The popover, top down, in the Pickers family's dense popover (`.sdk-popover .sdk-popover-dense .sdk-picker-pop`), on `--surface-menu` with the theme's edge and radius. Suggested words, all Thomas's to change (open question 7):

1. **The area**: a square of the current hue, white to the left, black at the bottom; a round handle shows the colour. Drag or tap to choose.
2. **Hue**: a slider across the colours.
3. **Opacity** (decisions 2 and 8: always shown): a slider from clear to solid, over a checked ground so clear is visible. Where the opacity is not kept (`opacity: false`), there is no slider and no line, and the answer's opacity is 100 (decision 20, which replaces decisions 8 and 11).
4. **A row**: a swatch of the chosen colour (half over a checked ground when opacity is below 100), the **Hex** field (`#2f6cbf`; it takes `2f6cbf` or `#2F6CBF` and shows it lower case), and **Pick from the screen** (the eyedropper button), shown only where the browser has it and it works here.
5. **The palette**: the person's grid, one grid of swatches in rows of 8 with no headings, sorted by colour, and a "+" at its end (decisions 22 and 23; "The person's colour grid"). With a module's `palette`, the module's own groups instead, not editable (decision 26). *Before 2026-11-22: the default's three groups (Light, Dark, Strong), each a row of 8 under its heading; replaced by decision 22.*
6. **Recent**: the last 8 colours the person chose, in any module, newest first, each with its opacity; not shown when empty; kept on their account (decision 27). *Before 2026-11-22: the last 8 chosen with this picker in this browser; replaced by decision 27.*

- **Theme tokens only** for the picker itself: surface, edges, words, focus ring, the check disc. The colours inside the area, the sliders and the swatches are data, set as custom properties (`--sw` as today, and one or two more for the hue and the chosen colour), never as declarations in a stylesheet. The checked ground behind opacity is drawn from tokens (two mixes of `--text-primary` over the surface).
- **Selected** is a check on a neutral disc over a swatch, never an accent border (design-theme, "Selected states"; `check-nav`).
- **Pale and dark swatches.** Every swatch keeps its hairline edge, and a swatch whose colour has less than 3:1 against the menu's surface gets a stronger edge (`--text-muted` mixed in), worked out with the contrast helper when drawn. This answers the swatch half of #544's "outlined swatch for pale colours" for the picker; the same option for `host.menu.show` rows stays #544's core follow-up.

### Keyboard and screen reader

- The colour chip (`colorField`, decision 33) is a button with `aria-haspopup="dialog"` and `aria-expanded`, named "<label>, <colour name if any>, <hex>. Change it". The hex is read out here and shown in its tooltip, not drawn as text.
- The popover is `role="dialog"` named by `label`. Focus goes to the chosen swatch, else the hex field. Tab moves: the area, Hue, Opacity, the hex field, Pick from the screen, the palette (one Tab stop, arrows inside), Recent (one Tab stop). Escape closes and puts focus back on what opened it (the anchor, or the module's toolbar button through the host, as menus do).
- **The area** is one focusable element, `role="slider"`, named "Saturation and brightness", with `aria-valuetext` such as "Saturation 40 percent, brightness 70 percent". Left and Right change saturation, Up and Down brightness, by 1; with Shift by 10; Home and End go to the ends of saturation.
- **Hue** and **Opacity** are `role="slider"` (`aria-valuetext` "Hue 210 degrees", "Opacity 80 percent"), arrows by 1, Shift by 10, Page Up and Page Down by 10, Home and End to the ends. Where the opacity is not kept there is no Opacity slider, so nothing for it is in the Tab order or read out (decision 20).
- **Hex** is a text field labelled "Hex". On Enter or leaving it, a good value is taken; a bad one gets `aria-invalid` and one line under it, "Type six hex digits, like #2f6cbf", and the colour does not change.
- **Swatches** are a radio group: each is a radio named by its colour's name; a recent colour, or a colour a person added, with no name is named by its hex (and its opacity when below 100: "#2f6cbf, 60 percent"). The grid's keys for editing are under "The person's colour grid".
- A live region says the chosen colour once it settles (not on every drag step): "Teal, #00796b" or "#2f6cbf".
- Reduced motion: nothing animates beyond the menus' own opening.

### The phone (640 px and below)

- Swatch cells are 44 px (`--pk-sw-cell` already is). The sliders and their handles, the hex field and the eyedropper button are 44 px tall, and the hex field is 16 px text so the phone does not zoom (`check-phone-targets`).
- 8 cells of 44 px are 352 px, which fits a 390 px screen with the popover's 8 px around it. The area takes the popover's width and about 160 px of height.
- In a module, the picker is clamped to the module's box as menus are. Where that box is too short for the whole picker, the popover scrolls inside itself (the Menus family's scroll cue). Suggested; open question 8 asks whether a phone should get a bottom sheet instead.
- The area and the sliders take touch dragging without scrolling the page (`touch-action: none` on them only).

### The host's own pages (experience-design; core)

- `public/colour-pick.js` is removed (decision 5). `module-settings.js`, `list-rows.js` and `template-pages.js` call the SDK's `colorField` through a page global set at the end of `host.js` (as `hostCurrency`), so there is one picker. No native colour input is drawn for a person to use (decision 6).
- `list-rows.js`'s own colours for new rows (`ROW_COLORS`) are replaced by the Strong group's colours, taken in turn, Red first (decisions 5 and 13).
- `host.html` and `profile.html` load `/sdk/host.js`.
- `tools/check-template-pages-b.mjs` stubs the old `colour-pick.js` import; it changes with the new call.
- A `color` setting and a list row's colour keep `#rrggbb` only, so their fields pass `opacity: false` (option O2, decision 11). O3, which would add a server half (a manifest field and a stored opacity in `server/modules.js`), is not taken.
- Colours already stored by the host's pages are `#rrggbb` and stay valid. Nothing is converted; test data may be reset.
- The theme editor's colour fields are not changed in this plan (open question 5).

### The design-system Pickers page (experience-design)

- The `pickers` entry in `public/design-system/components.js` draws the new popover in place of the native Custom row: the area, Hue, Opacity, the hex row, the three palette groups and Recent, with its states (focus on the area, a bad hex, a pale swatch with its stronger edge, the eyedropper hidden). It shows the picker without the Opacity slider (`opacity: false`) as one more state. Its description names `host.ui.colorPicker` and `host.ui.colorField` (decision 9).
- A live one under Live SDK pieces (`components-3.js`), opened from a colour chip (decision 33), as the date and kind pickers are there. The entry draws the field as the chip, inline beside a label, not as a swatch with the hex and a chevron.
- `tools/check-design-system-catalog.mjs` holds every class the entry draws to a real rule.

### The person's colour grid (server-development and experience-design; core; decisions 22 to 28)

This is a core change: `server/` (a route and the account's stored data), `public/sdk/host.js` and `public/module-host.js`. Thomas named no kind of build for it, so it is a try build: one builder per half, its own checks, no independent read and no QA, and every check green on `main` before it merges (`CLAUDE.md`, "Core stability"). What follows is the planner's proposal where Thomas's words don't settle it.

**What was read for it.** `public/sdk/host.js`: `COLOUR_PALETTE` (line 1164), `showColourPicker()` (line 2554) and its recent colours, kept in `localStorage` under `app:colour:<moduleId>` (lines 2595 to 2597), and the page global `hostColour` with its own page host whose `call` refuses everything but `hello` (lines 5694 to 5710; the page host at line 5697). `public/module-host.js`: the `ui.toast`, `ui.confirm` and `ui.prompt` handlers (lines 1618 to 1631). `server/index.js`: `GET /api/me` (line 4594), `PATCH /api/me` with `ME_FIELDS` (lines 4614 to 4637; `ME_FIELDS` at line 4619), `GET /api/me/themes` (line 4641) and `PATCH /api/me/call-prefs` (line 5149). `server/store.js`: the account's `themeMode` and `theme` keys in the account's normaliser (lines 1083 to 1087), `setThemeMode()`, `personTheme()` and `setPersonTheme()` (lines 1890 to 1918), and `setCallPrefs()` (line 1140). `tools/check-person-theme.mjs` (its header) and `tools/route-table.json` (searched). Read in code; nothing was run.

**Where it is stored.** On the person's account, as the key `colorGrid`, beside `theme` and `themeMode` in `server/store.js` (lines 1083 to 1087), so it follows them to any device and rides with the environment's copy, as a person's theme does. The key is left off the account while the person has never edited their grid. The account's normaliser keeps it only when it passes the same check as the route (below), and otherwise drops it, as it does `theme`. Setter: `store.setColorGrid(key, list)`, modelled on `setPersonTheme()` (line 1909): it checks, keeps, saves and answers the list kept.

**The shape.** A list of `{ color: '#rrggbb', opacity: 0..100 }`, at most 48. No name is stored: the 24 starting colours carry their names in the SDK, and a colour a person adds is named by its hex. The order stored is the order sent; the SDK sorts when it draws (see "The order"), so the order rule can change without touching stored data.

**The routes.** Their own path, beside `GET /api/me/themes` in `server/index.js` (line 4641), and not a field of `PATCH /api/me`, because that route answers about themes and tells the person's other pages about their mode (lines 4621 to 4637).

| Route | Answers | Refused |
|---|---|---|
| `GET /api/me/color-grid` | `200 { colors: [...] }`, or `200 { colors: null }` while the person has never edited it. `Cache-Control: no-store` | No session: 401. A guest (no account): 403 |
| `PUT /api/me/color-grid`, body `{ colors: [...] }` | Replaces the whole list. `200 { colors: [...] }`, the list kept. An empty list is kept as empty (the person removed everything), which is not the same as never edited | No session: 401. A guest: 403. A bad body: 400 with one sentence, and nothing changes |

- **Checked strictly on the server**, every entry before anything is kept: the body is a plain object whose only key is `colors`; `colors` is an array of at most 48; each entry is a plain object whose own keys are exactly `color` and `opacity`; `color` matches `^#[0-9a-f]{6}$` (lower case only: the SDK cleans before it sends); `opacity` is a whole number from 0 to 100 (`Number.isInteger`); no two entries have the same `color` and `opacity`. A prototype key, a string opacity, `#RRGGBB`, `#rrggbbaa`, a CSS name, `url(...)` and a 49th entry are each refused. Suggested sentences: "Send the colours as a list, such as {"colors":[{"color":"#d62828","opacity":100}]}.", "The grid holds at most 48 colours.", "Each colour is #rrggbb in lower case, with an opacity from 0 to 100.", "That colour is in the list twice."
- **Only the caller's own.** No route sets another person's grid; an owner's `PATCH /api/users/:key` does not take it, and the owner's view of a person and the listing of people don't show it.
- **Not for an agent.** The routes are not added to the agent gate's list (`server/agent-routes.js`, `AGENT_ROUTES`), so an agent's token can't reach them.
- **Two devices at once.** A `PUT` replaces the list, so the last save wins. Acceptable for a list a person edits by hand; said in known-issues when built.
- **The route-table check.** Both routes go into `tools/route-table.json`.

**When the person has never edited it.** `GET` answers `colors: null`, and the picker shows the 24 starting colours (decision 24), which live in the SDK in place of `COLOUR_PALETTE`'s three groups. They are not stored. The first edit (an add or a remove) sends the whole list, starting colours included, and from then on the account holds it.

**How the picker reaches it.** The picker never fetches the route itself, because a sandboxed module's frame has no session. It asks through the page, the way `ui.confirm` does (`module-host.js`, line 1624):

- `call('ui.colorGrid')` answers `{ colors: [...] | null, editable: true | false }`. `editable` is false for a guest or where the route can't be reached; the picker then shows the starting colours with no "+", no Remove and no drop.
- `call('ui.colorGrid.set', { colors })` sends the whole new list; the page `PUT`s it and answers the list kept, or throws the server's sentence.
- **In `module-host.js`**, two new handlers beside `ui.confirm`. The page keeps one copy of the grid for all its modules: read from the route on the first ask, replaced by each `set`'s answer, so two modules on one page see the same grid. A handler checks the list's shape before it sends it, and the server checks it again.
- **On the host's own pages** (`hostColour`, `host.js` lines 5694 to 5710), the page host's `call` answers the same two methods by fetching the route itself, with its own copy for that page. A page that has both (a space's page, with its settings and its modules) may hold two copies until it reloads; a known gap, said in known-issues when built.
- The picker asks each time it opens and draws the grid once the answer is there (from the page's copy, so after the first open there is no network wait).
- **Uploaded modules are read-only (decision 28).** A module's own code can send these calls, as the SDK does, so the page decides by where the call comes from. For a call from a sandboxed module frame, `ui.colorGrid` and the Recent read answer `editable: false`, and `ui.colorGrid.set` and the Recent write are refused with one plain sentence and change nothing. The picker in that frame shows the grid and Recent with no "+", no drag-in and no Remove, and a pick there doesn't update Recent. Bundled modules running in the page, the host pages' own pickers (`hostColour`) and Manage stay editable. Reading stays allowed everywhere. The checks for this must cover a refused write from a sandboxed frame.
- A module never reads or writes the grid by any route of its own: it has no session and reaches the grid only through these page calls, under the rule above.

**What a person sees and does.**

- **Add by dragging.** The chosen colour's swatch in the row under the sliders (item 4 of "What a person sees") can be dragged onto the grid. Dropped anywhere on the grid, the colour, with its opacity (decision 23), takes its place by the order below; the drop position does not set it.
- **Add with "+".** A button at the grid's end, named "Add the current colour to your colours". Enter, Space, a click or a tap adds the colour showing, with its opacity. Where the picker has no opacity (`opacity: false`), it adds at 100.
- **Already there.** A colour with the same `color` and `opacity` is not added again: the focus moves to that swatch and the live region says "Already in your colours".
- **Full.** At 48 the "+" is not shown, and a drop adds nothing; the live region says "Your colours are full. Remove one first." Suggested, following decision 20 (a control that can't be used is not shown).
- **Remove.** A right-click on a swatch, the context-menu key or Shift+F10 opens a small menu with one row, "Remove", in the Menus family's look and drawn by the picker so the picker stays open. The Delete key (and Backspace) on a focused swatch removes it at once. After a remove, the focus goes to the next swatch, else the previous, else the "+". The live region says "Removed Red" (or the hex).
- **Choosing** a grid colour answers its `color` and its `opacity`, as a swatch does now; with `opacity: false` it answers the colour at 100.
- **A swatch below 100** is drawn half over the checked ground, as the chosen-colour swatch is.
- **Saving.** Each add or remove is saved at once; there is no Save button. If the save is refused, the grid goes back to what it was and the picker shows the server's sentence in its line under the grid.
- **Recent** is kept on the account (decision 27). The last 8 colours chosen, newest first, each `{ color, opacity }`, one list per person across all modules. A choice adds to the front and drops an older copy of the same colour and opacity. It is not shown while empty, and a module's own `palette` doesn't change it. It is stored beside the grid as `colorRecent` on the account, and read and written through the same page calls as the grid. The route is the server builder's to name. It is checked as strictly as the grid, with a limit of 8. *Before 2026-11-22: "stays as built: the last 8 picked with this module in this browser", kept in `localStorage` under `app:colour:<moduleId>`; replaced by decision 27, and kept here as the record.*
- **A module's palette** replaces the grid and is not editable: no "+", no drag target, no Remove (decision 26).
- **No reset.** There is no "Back to the starting colours" in version 1 (open question 10).

**The order.** Neutrals first, light to dark: any colour whose HSL saturation is under 10 percent. Then the rest by hue in twelve bands of 30 degrees, the first centred on red (0 degrees), so red, orange and brown, yellow, the greens, the blue-greens, the blues, the purples, magenta and pink; within a band, lighter first; two colours that tie keep the order they were stored in. This is the rule the 24 starting colours were sorted by.

**The keys, in the grid.** The grid stays one Tab stop with arrows inside (a radio group, as now); the "+" is the next Tab stop. Delete or Backspace removes the focused swatch. The context-menu key or Shift+F10 opens its Remove menu; in it, Enter removes and Escape closes the menu only, back to the swatch. Escape in the picker still answers `null`; an add or a remove already saved is not undone by it.

**The check: `tools/check-colour-grid.mjs`** (server-development), modelled on `tools/check-person-theme.mjs`, on a real server with a throwaway `DATA_DIR`:

- `GET` answers `colors: null` for a new person; a `PUT` keeps the list, `GET` answers it, and a store reload keeps it; an empty list is kept as empty.
- Hostile: each refused body above is 400 with one sentence and changes nothing; another person's grid can't be set (an unknown field, an owner's `PATCH /api/users/:key`) or read (the owner's view of a person, the listing of people); a guest gets 403 and no session 401; an agent's token can't reach it; a stored grid that fails the check is dropped when the store loads.
- `tools/check-colour-picker.mjs` changes with it (experience-design's half, checked by server-development): the 24 starting colours and their order; the order rule on a set of added colours; no headings; "+", drag, Delete and the Remove menu each add or remove and send `ui.colorGrid.set`; a duplicate is not added; at 48 the "+" is gone; a module palette shows no "+" and takes no drop; a guest (`editable: false`) shows no editing; and in a sandboxed frame the picker reaches the grid through `module-host.js`. The old palette's contrast figures (Light, Dark, Strong) go from the check.
- `npm run check:docs` for this plan; `check-route-table` for the two routes.

### The stored format

- A module stores what the answer gives: `color` as `#rrggbb`, lower case, and, if it keeps it, `opacity` apart, as a whole number from 0 to 100. It checks them again before storing or drawing (decision 7). A module that keeps the colour only passes `opacity: false`.
- A `color` setting stays `#rrggbb` as `server/modules.js` checks it now (decision 11).
- The host stores one new thing: the person's grid, `colorGrid` on their account, under "The person's colour grid" (decision 23). *Before 2026-11-22 this said the host stores nothing new and no stored format, route or key changes; decision 23 changes that.*

## Not in version 1

- Theme tints (which follow the theme) as choices in the picker or the grid. Thomas decided they stay out (decision 25).
- Colours other than `#rrggbb` (no `rgb()`, `hsl()`, names or `#rrggbbaa` in or out), and other colour spaces (no OKLCH, no P3).
- Gradients, patterns (#544's "pattern option" for fills is the Whiteboard's own), and palettes that a person or an environment names and shares with others. A person's own grid, kept on their account, is in (decision 23); it has no name and is never shared. *Before 2026-11-22 this line also kept out any saved palette a person keeps; decision 23 brings their own grid in.*
- Several grids per person, names for colours a person adds, and a way back to the starting colours (open question 10).
- Recent colours shared between people. *Before 2026-11-22 this also kept Recent off the server and off other devices; decision 27 brings it onto the person's account.*
- A contrast warning inside the picker (decision 3).
- The host's button rectangle for a toolbar or title-bar button (#480 point 3; decision 1), and swatches on toolbar buttons (#480 point 1).
- The theme editor's colour fields (open question 5).
- An opacity kept by a `color` setting or a list row (O3 is not taken). Those fields show no Opacity slider and no line (decision 20).
- An outlined-swatch option for `host.menu.show` rows (#544 lists it as a core menu option for later).

## Left to build, in order

Each step is one build, leaves the app working and can be checked on its own. Size: S is about a short sitting, M about half a day, L a day or more.

| Step | Job | Agent | Files | Size | Risk |
|---|---|---|---|---|---|
| 1 | **The pure parts.** In `host.js`, between markers: cleaning a hex, hex to hue, saturation and brightness and back, the default palette as one named list (as open question 1 settles it), the palette check, the answer's shape, and the contrast helper (decision 3). The check runs them in node, holds the contrast maths equal to `pickOn()` in `theme-colour.js`, and holds the palette to its contrast figures | experience-design; the check by server-development | `public/sdk/host.js`, `tools/check-colour-picker.mjs` | S | Low. Core: independent read |
| 2 | **The picker in the SDK.** `host.ui.colorPicker` and `host.ui.colorField` (decision 9): the popover (area, Hue, the Opacity slider, left out with its line where `opacity: false` (decision 20), hex row, eyedropper where it works, palette groups, Recent), placing by `anchor` or `at` (decision 1), the keys, the names and the live region, the phone sizes, and the styles in the Pickers block. The check's browser half | experience-design; the check by server-development | `public/sdk/host.js`, `public/sdk/system.css`, `tools/check-colour-picker.mjs` | L | Medium. Core: independent read |
| 3 | **The host's pages use it.** `colour-pick.js` is removed; `module-settings.js`, `list-rows.js` and `template-pages.js` use the SDK's field, with `opacity: false` where only `#rrggbb` is kept (decision 11); `list-rows.js`'s own colours go; `host.html` and `profile.html` load the SDK; the checks that stub or name `colour-pick.js` (`check-template-pages-b`, the comment in `check-system-css`) change with it | experience-design; the checks by server-development | `public/colour-pick.js` (removed), `public/module-settings.js`, `public/list-rows.js`, `public/template-pages.js`, `public/host.html`, `public/profile.html`, `tools/check-template-pages-b.mjs`, `tools/check-system-css.mjs` | M | Medium. Core: independent read |
| 4 | **The design-system Pickers page.** The entry and its states, and the live piece | experience-design | `public/design-system/components.js`, `public/design-system/components-3.js` | S | Low |
| 6 | **The person's grid on the server (decision 23).** `colorGrid` on the account, its normaliser and `store.setColorGrid()`; `GET` and `PUT /api/me/color-grid` with the strict check; the two routes in `tools/route-table.json`; the new check | server-development | `server/store.js`, `server/index.js`, `tools/route-table.json`, `tools/check-colour-grid.mjs` | S | Low. Core, try build: no independent read |
| 7 | **The grid in the picker (decisions 22 to 26).** The 24 starting colours in place of `COLOUR_PALETTE`'s groups; one grid sorted by the order rule, no headings; "+", the drag, Delete and the Remove menu; the `ui.colorGrid` and `ui.colorGrid.set` handlers in `module-host.js` and the same two on the page host of `hostColour`; a module's palette not editable; the Pickers entry's states (step 4's page) and the check's changes | experience-design; the check by server-development | `public/sdk/host.js`, `public/sdk/system.css`, `public/module-host.js`, `public/design-system/components.js`, `tools/check-colour-picker.mjs` | M | Medium. Core, try build: no independent read |
| 5 | **The documents.** api-module-sdk ("Shared tools": the two calls and the helper), design-theme (a section "The colour picker" with the default palette), the user guides where a colour is chosen, `known-issues.md` (the eyedropper where it is hidden), and the CHANGELOG | content-manager | `documentation/`, `CHANGELOG.md` | S | Low |

Order: 1, then 2, then 3 and 4 side by side; 5 with each step and a summary at the end. Then 6, then 7 (it needs the route); 7 can be built against a stub of the two calls while 6 is built. Steps 6 and 7 are a try build: Thomas named no kind of build for them, so each is one builder, one pass and its own checks, merged when every check on `main` is green; the paragraph on the kind of build below is about steps 1 to 5.

In step 3, a new list row takes the Strong group's colours in turn, Red first (decision 13), not the default palette in order.

**What changed from the first draft.** The first draft's step 5 (the host button's rectangle) is gone (decision 1). Step 3 now removes `colour-pick.js` and `list-rows.js`'s own colours instead of keeping their exports, so it is M, not S to M, and touches two more checks (decision 5). Step 1 carries the new default palette and its contrast figures. Nothing carries an `id` through the answer. After decisions 8 to 11: step 2 builds both calls and the always-shown slider with its switched-off state; step 3 passes `opacity: false` on the host's colour-only fields; and the steps have latest start dates (below), not a condition.

**The Whiteboard (#544) is a module-lane follow-up after step 2 is merged,** with its own version bump, not part of this build. With decision 5 it may drop its fixed colour ids, its `--wb-fixed-*` properties and the raw-colour allowance they need, store `#rrggbb` (and an opacity for fills) from the picker, open the picker from its toolbar and in context (decision 1), use `host.util.readableOn` for words on a fill (decision 3), and reset its test boards. Whether it keeps a theme-following Tinted group in its own menus is #544's question, not this plan's. Built so far: Whiteboard 0.1.83 (#1024) has the picker in its colour menus, fill transparency, a grid colour and patterns, and the 2026-11-22 change (decision 18) leaves one Colour row and no preset groups.

**Agents and the kind of build.** Thomas names the kind of build. This plan assumes a production build: each step gets its independent read (steps 1, 2 and 3 are core), a QA pass and its documentation before it is committed (`CLAUDE.md`). quality-assurance reads and tries each step without changing code.

**The freeze (decision 10).** A new SDK call is one of the things the freeze stops (plan-release, "The freeze"), and the freeze starts in the window 2026-12-11 to 2026-12-18 (plan-templates-redesign, "The earliest freeze"). Thomas decided the picker lands before it, whatever else slips: steps 1 to 4 are merged, with their reads, QA and documentation, by the end of Thursday 2026-12-10. Where the same builders are needed for plan-templates-redesign or plan-layout-picker, which must also land before the freeze, those move, not this. The latest start for each step, counting back from 2026-12-10 along the order above (calendar days, weekends counted as working days, since the builders are agents, as in plan-layout-picker):

| Step | Latest start | Build | Read, QA and documentation | Merged by | Waits for |
|---|---|---|---|---|---|
| 1 | Wednesday 2026-12-02 | 12-02 | 12-03 (independent read) | 12-03 | Open question 1 (see below) |
| 2 | Friday 2026-12-04 | 12-04 to 12-05 | 12-06 to 12-07 (independent read) | 12-07 | Step 1 |
| 3 | Tuesday 2026-12-08 | 12-08 | 12-09 to 12-10 (independent read) | 12-10 | Step 2 |
| 4 | Wednesday 2026-12-09 | 12-09 | 12-10 | 12-10 | Step 2 |
| 5 | With each step | | | 12-10 for the summary pass | Each step |

What that means for the schedule:

- From today (2026-11-19) there are about 13 days before step 1's latest start. After the latest starts there is no slack: the critical path is step 1, then step 2, then step 3, and a slip in step 2 (the L step) moves step 3 day for day toward the freeze.
- If no work happens on weekends, steps 1 and 2 start two days earlier: Monday 2026-11-30 and Wednesday 2026-12-02.
- O3 is not taken (decision 11), so step 3 has no server half and the dates above stand.
- Open question 1 (the palette) need not hold up step 1: if it is not answered by step 1's latest start, step 1 builds with the proposed palette, and Thomas's changes are an edit to one list and its figures in the check before step 2 is merged.
- The planner's suggestion: have the project manager start step 1 as soon as builders are free rather than at its latest start, and report to Thomas at once on any step that has not started by its date.

**The full check.** `npm run check` (every check) runs once, at release prep, by the project manager. Each step runs only its own checks and their direct neighbours.

## Verify

- **Step 1, checked by a tool** (`tools/check-colour-picker.mjs`, node half). A hex is cleaned (`#2F6CBF`, `2f6cbf` and ` #2f6cbf ` become `#2f6cbf`; `#2f6cb`, `#2f6cbfff`, `red` and `url(x)` are refused). Every palette colour, black, white and a grid of colours round-trip through hue, saturation and brightness and back to the same hex. The palette check takes a good palette and refuses each bad shape with its sentence. `host.util.contrast` and `readableOn` agree with `pickOn()` in `theme-colour.js` on every palette colour. The default palette holds its figures: dark words on each Light colour and light words on each Dark colour at 4.5:1 or more; white words on each Strong colour at 4.5:1 or more, and each Strong colour at 3:1 or more against white and against `#0e1a2b`.
- **Step 2, checked by a tool** (the check's browser half, in headless Chromium; skipped and said so when there is none). Light and dark, at 1280 and at a 390 touch screen: the popover opens under an anchor, at a point, and at `{ x, y: 4 }` from a toolbar button's event, always inside the module's box; keyboard only, every control is reached in the order above and changes the colour by the keys listed; a typed hex is taken and a bad one is marked with its line; Escape answers `null` and puts focus back; a swatch answers and closes; `onInput` fires while dragging and the answer comes once; the opacity slider is shown, the answer always carries the percent, and with `opacity: false` there is no slider and no line and the answer's opacity is 100 (decision 20); `colorField` and `colorPicker` both work in a form and from a toolbar button; a module palette is drawn in place of the default and answers its colour; at 390 px every target is 44 px; the picker's own words reach 4.5:1 on its surface; White on a light menu and Black on a dark one have the stronger edge; the accessibility tree names the dialog, the area, the sliders, the field and each radio. `check-system-css`, `check-no-raw-colours`, `check-radius`, `check-nav` (selected states) and `check-phone-targets` pass. **Live, by the builder:** a bundled module in the page and an uploaded module in a sandboxed frame, each opening the picker from a toolbar button and from a click in its page, in Chromium, with the eyedropper tried in both.
- **Step 3, checked by a tool:** `check-template-pages-b`, `check-admin-load` and the module settings' check open the pages with a colour field and no page error; no file in `public/` draws `<input type="color">` for a person to use except the theme editor's, and `colour-pick.js` is gone. **Live in Chromium:** a module setting of type `color` in Manage, a list row's colour (and a new row's first colour from the default palette), a colour field in the host console's template editor and one on Profile each open the new picker with no Opacity slider and no line, save, and show the saved colour after a reload.
- **Step 6, checked by a tool:** `tools/check-colour-grid.mjs` (the cases under "The person's colour grid", "The check") and `check-route-table`. Neighbours: `check-person-theme`, which reads the same account record.
- **Step 7, checked by a tool:** `tools/check-colour-picker.mjs` with its changes, in node and in headless Chromium, and `check-module-host` for the two handlers. **Live, by the builder, in Chromium:** the grid in a bundled module in the page and in an uploaded module in a sandboxed frame; an add by dragging and by "+", a remove by right-click and by Delete; the grid the same after a reload and in a second browser signed in as the same person. Not checkable here: touch dragging on a real phone (the "+" is the way in on touch), and a screen reader on the Remove menu.
- **Step 4, checked by a tool:** `check-design-system-catalog` and `check-design-system`. **Live:** the Pickers entry shows the popover and its states in light and dark.
- **Not checked by any step:** a real screen reader (only the accessibility tree is read), a real phone, Safari and Firefox (where there is no eyedropper: it must be hidden there; to be tried by a person), the eyedropper in a sandboxed frame outside Chromium, and the palette's look on a theme other than the default. A real LiveKit call is not involved: nothing here touches the call.
- **Always:** `npm run check:docs` for the documents.

## Risks, ranked

1. **The freeze, with no fallback (decision 10).** Steps 1 to 4 must be merged by 2026-12-10, and the latest starts leave no slack on the critical path (steps 1, 2 and 3). The same builders are building plan-templates-redesign and plan-layout-picker for the same freeze. Mitigation: Thomas has put this first, so other work moves; start step 1 early; the project manager reports a missed start to Thomas at once.
2. **A slider that does nothing.** A field that keeps the colour only must not offer a control whose value is thrown away, which plan-release's "done" contract forbids. Mitigation: with `opacity: false` the slider and its line are not shown at all (decision 20, which replaced the switched-off slider of decision 11).
3. **The eyedropper in a sandboxed frame.** The browser's EyeDropper exists in Chromium only, and whether it works inside a sandboxed frame with an opaque origin has not been checked here. Mitigation: feature-detect by trying it, hide the button where it fails, and say so in `known-issues.md`. Open question 4 asks whether it is in version 1 at all.
4. **A narrow module.** The picker is clamped to the module's box (A1, the reading of decision 1; open question 3). A docked module narrower than about 260 px, or a short one, can't show it whole, and the slider always shown (decision 8) makes the picker one row taller. Mitigation: the popover scrolls inside itself; the lift or drawing over the page (A2) is the larger fix, not in this plan.
5. **The raw-colour check.** The hue slider is a run of colours. Written as a gradient of hex stops in a stylesheet or a style string, it is a raw colour (`check-no-raw-colours`). The default palette in `host.js` is plain data and is not read. Mitigation: draw the hue from data (a custom property set from a list, as `--sw` is, or a `<canvas>`), and if a stylesheet still needs it, an explicit allow entry with its reason, which Thomas decides.
6. **The palette on other themes.** The contrast figures are worked out against white and the default dark ground. A theme with a mid-tone surface can make some swatches faint. Mitigation: the stronger edge is worked out against the real surface when drawn; words a module puts on a fill use `readableOn`, which does not depend on the theme.
7. **Two copies of the contrast maths.** `theme-colour.js` and the SDK's helper could drift. Mitigation: step 1's check holds them equal.
8. **Removing a page piece everyone uses.** `colour-pick.js` reaches Manage, the host console, Profile and a space's settings, and two checks name it. Mitigation: step 3 changes its three users and the checks in one step, and its live checks open each page.
9. **Undo and saves while dragging.** A module that saves on every `onInput` floods its saves and its undo history. Mitigation: the SDK document says `onInput` is for showing only, and the answer is the one change to save.
10. **A module rewriting a person's grid.** The picker runs in the module's frame (A1), so a module can send the same host calls as the picker. Closed for uploaded modules by decision 28: the page answers the grid and Recent as not editable in a sandboxed frame and refuses their writes. Bundled modules run in the page and are trusted. The server still takes only checked colours, at most 48.
    - **Known: reading remains possible.** An uploaded module can still read the person's grid and Recent, because reading stays allowed everywhere (decision 28). They hold no secrets.
11. **Two copies on one page.** A space's page may hold the module host's copy and the page host's copy of the grid, which can differ until a reload. Mitigation: each set answers the stored list; named in known-issues.

## Rollback

There is no setting. Each step is its own commit. Reverting step 3 brings back `colour-pick.js` with its native Custom row, against decisions 5 and 6, so only as a stopgap Thomas allows. Reverting step 2 removes the two SDK calls; any module that has started using it must be reverted first. Steps 1 to 5 change nothing the host stores. Step 6 adds `colorGrid` to the account; reverting it leaves the key on accounts, where nothing reads it, and the normaliser of the reverted code drops it on the next save. Revert step 7 before step 6, or the picker asks for a route that is gone and shows the starting colours with no editing. A revert after the freeze starts is a change in the freeze, which only Thomas allows.

## Open questions for Thomas

Each has the planner's suggestion. The first draft's questions on anchoring, opacity, a contrast helper and the palette are answered (decisions 1 to 4); the second draft's questions on the opacity slider, the call's shape and the freeze are answered (decisions 8 to 10), and so is question 2 (decision 11). Decision 5 added question 1.

1. **Answered (decisions 12 and 17), then replaced (decisions 22 and 24, 2026-11-22): one grid sorted by colour, starting on 24 new colours, which the person edits (decision 23).** The proposal below is the record; the 24 now proposed are under "The starting grid (proposed)". **Answered (decisions 12 and 17): the palette is accepted as built, and `host.ui.colorPalette()` is not built now.** **The new default palette.** Proposed under "The default palette (proposed)": three named groups of 8, Light, Dark and Strong, 24 colours, with the contrast each reaches. Confirm the groups, the names and the values, or change them. Within this: whether a module can read the default palette (suggested: yes, read only). Blocks nothing now: step 1 is built with the proposal and changed before step 2 is merged (see "The freeze").
2. **Answered (decision 11): O2.** **A colour stored without its opacity.** The slider is always shown (decision 8), but a `color` setting and a list row's colour keep `#rrggbb` only, so as drafted their opacity would be thrown away. The options are under "O. A colour stored without its opacity": O1, shown and ignored; O2, shown at 100 and switched off with the line "Opacity isn't kept here."; O3, the setting declares and keeps an opacity (a new manifest field and stored format, before the freeze). Thomas chose O2 on 2026-11-19; O3 can follow later if a setting needs it. Blocks nothing.
3. **Drawn in the module's page (A1).** The planner's reading of decision 1, which the contract is drafted on. Confirm, or say if the picker should be drawn over the page. Does not block unless changed.
4. **The eyedropper in version 1?** Suggested: yes, shown only where it works, hidden elsewhere and named in `known-issues.md`. Does not block.
5. **Answered (decision 29, 2026-11-22): the theme editor moves onto the picker.** The earlier suggestion and its reason are kept as the record. **The theme editor's colour fields.** They are native inputs today. Decision 5 may already cover them ("all previous pickers"). Suggested: leave them out of this plan, since a theme's colours are design, not data, and the theme editor has its own contrast panel; give them the picker in a later step if Thomas wants it. Does not block.
6. **What ends a pick.** Suggested: a swatch, Enter in the hex field, or a press outside the picker keeps the colour; Escape puts back the colour it opened with. Does not block step 1.
7. **The words a person reads.** "Hue", "Opacity", "Hex", "Pick from the screen", "Recent", the group names "Light", "Dark", "Strong", "Saturation and brightness" (for a screen reader), and the hex line "Type six hex digits, like #2f6cbf". Suggested as written. Does not block.
8. **The phone: popover or bottom sheet?** Suggested: the popover, as the approved Pickers family says for a grid, scrolling inside itself in a short module. Does not block step 1.
9. **New list rows' colours.** Decision 13 gave new list rows the Strong colours in turn, Red first; decision 22 removes the Strong group. Suggested: the starting grid's colours that are neither neutral nor light, in grid order from Red (Red, Dark red, Orange, Brown, Yellow, Green, Dark green, Cyan, Teal, Blue, Dark blue, Purple, Magenta), fixed and not the person's own grid, so a list looks the same for everyone. Blocks step 7 only for `list-rows.js`; until answered, `list-rows.js` keeps the old Strong eight as its own list.
10. **A way back to the starting colours.** Not asked. Suggested: none in version 1; a person who wants one back adds it. Does not block.
11. **The 24 starting colours.** The planner's proposal (decision 24), for Thomas to see as a chart. Does not block: step 7 builds with them and a change is an edit to one list and the check.
12. **Answered (decision 30, 2026-11-23): yes, Tags move to the picker.** **Should space Tags move to the picker?** Today a tag's colour is a tone name from the theme's fixed set (plan-tags). Moving it changes plan-tags, the server and `host.tags`. Does not block.
13. **Answered (decision 31, 2026-11-23): yes, with `#rrggbb` in the summary.** **Should a Maps place's own colour move to the picker?** It needs a server change so a summary's colour can be a strict `#rrggbb` (today only a tint name passes `SUMMARY_TINTS`). Does not block.
14. **Answered (decision 32, 2026-11-23): yes, a phase gets its own colour, set with the picker on the template's Phases page.** **Should a phase get its own colour?** Thomas said phases have a colour chooser; read in code, they do not. A phase's colour comes from its order only (`tintOf` in `public/phases.js` and `public/phase-sheet.js`, the 8 theme tints in turn), and Set up's phase rows show the tint with no control. The choice: each phase gets a colour set with the picker and stored with the phase (it then stops following the theme, decision 25), or phases stay coloured by order. Decided by decision 32. Does not block decisions 30 and 31.

## What the issues say that this plan could not confirm

- #544's comment of 2026-11-10 says the core picker's "plan approved, building next cycle". No colour picker plan existed in `documentation/plans/` before this one, so what was approved then could not be found in the repository.
