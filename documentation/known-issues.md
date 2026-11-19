# Known Issues

**Audience:** anyone running Coffee Pub Chameleon who wants to know what is broken before reporting it
as new.

A defect is recorded here once it has been observed, with a workaround if one exists, and moves to
the CHANGELOG once fixed.

## Whiteboard: limits that are known

These are recorded for the Whiteboard up to 0.1.64 ([userguide-whiteboard](userguides/userguide-whiteboard.md),
[architecture-whiteboard](architecture/architecture-whiteboard.md)); the list was written for 0.1.49 and read again against the code of 0.1.64 on 2026-11-14 (read as code, not by using the board). The open issues are numbered.

- **Same block, same moment.** Two people changing one block at the same moment: the last save wins. There is no conflict check yet.
- **Undo and copied blocks are per page.** They are in the page's memory, so they are gone on reload and are not shared between tabs.
- **Pictures with no block stay.** A picture's file stays when its block is deleted (undo, copies and other people's undo may need it), and it still counts toward the space's 500 files. There is no tidy-up yet. There is no workaround.
- **Sandboxed run.** When an owner runs the module sandboxed, not in the page, a picture shows "Picture not found", because the frame's origin is `null` and the picture's address does not load there. Pasting a picture in that frame was not tried. The bundled module runs in the page.
- **Removed members and pictures.** A member who is removed may still load a picture for up to an hour, from the upload cache.
- **Print and Save as image are not verified in a real browser's print dialog.** Neither was run against the real print dialog, and neither was tried in Safari or Firefox. The export's sums (which blocks, the part of the board, the size, the file name) are checked by a tool; the picture and the printed page are not. **Ctrl+P** (**Cmd+P**) is the browser's own print and does not use the board's Print.
- **Save as image in a sandboxed run.** The SDK has no call to hand over a file a module made yet (the page calls `host.files.save` once it exists, #469), so the page uses a download link. When an owner runs the module sandboxed, a download is blocked and the page says it cannot save.
- **Save as image has one format and one place.** PNG only (no SVG), saved to the computer, not to the Vault.
- **A table cell and Escape.** Escape in a cell being edited puts back only that cell's unfinished words. Cells you already kept stay, and **Undo** takes them back one step at a time. This is by design.
- **Two people in one table.** Two people changing the same cell, or the same table at once outside an edited cell, still lose one change (the last save wins). A cell you edit is written into the newest table, so cells others changed meanwhile stay.
- **Pasting rows from a spreadsheet** is checked by a tool on text and HTML samples, and was not tried with a real clipboard from Excel, Google Sheets or Numbers.
- **The timer's sound** plays only after you have pressed or typed on the page once, as browsers require. It was not heard on a real device. The shared time is checked by a tool with fake clocks, not with two real computers whose clocks differ.
- **The Highlighter and the note pointer do not lock on.** A highlight stays where it was put when the words under it move, and a note's pointer tip stays where it was put; it does not follow a block it points at. Locking on is designed in the code and not built.
- **Connectors go round only their own two blocks,** not other blocks in the way.
- **Brush pressure** was not tried with a real pen or a touch screen that senses force.
- **Toolbar placement.** The colour swatches are not in the toolbar row, because a toolbar button holds only an icon. The magnifier's menu opens at the top of the module's content, not under its button in the title bar.
- **Resizing a group.** Picking a group and dragging a handle to resize it as one selection is not built. Resize the blocks one at a time.
- **Ctrl+L and Ctrl+G** (Cmd on a Mac), the keys for lock and group, were tried with synthetic key events and not in a real browser, where a browser may use them for itself. The same commands are in the right-click menu.
- **Connectors and frames.** A connector with a free end inside a frame does not move when the frame moves. A connector between two blocks inside the frame does, because it follows its blocks.
- **Frames: read as code only.** The glide between frames, the reduced-motion jump, Print with frames on the board and a real long press on a frame were read as code and not tried. Presenting to everyone (0.1.41) is checked by tool with fake clocks and pages, not with two real computers.
- **Pure White swatch on a light menu.** The Pure White choice in the Light backgrounds and fixed colours rows draws a white swatch, which is almost invisible on a light menu. The name beside it is readable. Workaround: read the name, not the swatch.
- **Charcoal on a fixed fill.** Words in **Ink**-coloured or Charcoal choices on a fixed (Light or Dark) fill do not follow the theme, so a dark colour on a dark fill can be hard to read. Pick a different words colour.
- **The Present notes box was checked as code only.** Dragging the speaker notes box and keeping it inside the board, and its layout under 640 pixels, were read from the code and not tried in a browser. Shared presenting, Restart and Jump to Frame were checked by tool, not by hand.
- **Pointers and the resync were not tried with several people** or a real dropped connection.
- **Zoomed out, shapes and lines come out wrong** (#445). Drawing a rectangle or a line at a low zoom (20 percent) can give a size past the 4,000 unit limit, which is then replaced by the default or dropped, so a line stops following the pointer. Zoom in before drawing a large shape. The code still has no clamp in the shape tool's `sized()`; read as code.
- **Stacking and far blocks** (#445). A block whose `z` is at the limit sends every new block and **Bring to front** to the bottom. One block placed very far away makes the board look empty after **Show everything**, because it cannot zoom out past 20 percent. There is no cap on the number of blocks a board holds: a board with tens of thousands of small notes loads and then pans slowly. All four are found by QA and not seen by a person in normal use.
- **The storage limit is shared.** The module's 5 MB of storage is shared by every space's whiteboards in an environment. One editor can fill it with large strokes, after which nobody can save more than a small note. There is no per-block ownership: any editor may change or delete any block, and the host's **Clear** lets any editor wipe the board (with a 30-second undo). Editors can store values that are not blocks; the page ignores them but they count against the limit (#445).
- **Not built, open as issues:** speaker notes feedback (#569) and the Present batch (#561) are partly built (0.1.43 to 0.1.45) and stay open for their rest, Present full screen (#542, needs a core piece), Send to Assistant (#543), fixed colours and a colour chooser for blocks (#544), export and import of a board and copying blocks between boards (#554), a grid button with style, size, colour and opacity (#541), other modules' objects on the board (#501), comments on blocks (#499) and the ideas list (#503). See [TODO](TODO.md).
- **Align, guides and lock keys** were checked by tool (`check-whiteboard-arrange.mjs`), not by hand in a browser.
- **The clipboard.** Copy and cut by key replace what is on the computer's clipboard (with the board's mark). Thomas accepted this.
- **Find and Overview: not verified.** Find was not tried with the formatting bar's link field or a frame's title being edited (the `/` key is meant to type a slash there; this was read as code and checked by a tool on its sums, not by hand). Neither Find nor the overview was tried on a real phone, and neither in a real call.
- **Not verified.** Right-drag with a real mouse on Windows, pasting from another program with a real clipboard (both tested only with synthetic events), wheel and trackpad zoom on a real Mac, and a screen reader. The real print dialog, Print in Safari and Firefox, and a real LiveKit call were not verified either. There is no LiveKit server in the checks, so nothing about a call applies.

## Whiteboard: pictures

Whiteboard 0.1.68 to 0.1.82 ([userguide-whiteboard](userguides/userguide-whiteboard.md), "Edit a picture"). Checked in a browser with the mouse and keys sent as the browser sends them, and by the module's own checks; not tried on a phone, a tablet, Safari or Firefox.

- **Crop, Blur and a cut hide; they do not remove.** The picture's file is not changed, so anyone who can open the space's uploads can still reach what was hidden. A picture with something private in it is not safe to share because it is blurred or cut. Workaround: none that removes the original; **Flatten** hides it from the board for good but keeps the original (next item).
- **Flatten keeps the original file.** It makes a new picture file with the crop, blur, holes and marks baked in, and puts it in the place of the picture. The old file stays with the space, as every picture file does: no part of the board removes one (see the Limits in the guide). It is no redaction of the original.
- **A flatten that had to grow the picture has a square corner.** When a mark hung over the picture's edge, the new picture is bigger and its margin is see-through; the picture's corner on that side comes out square, not rounded. With nothing hanging over, the result is the same as before.
- **Marks drawn on a picture before 0.1.80 are not on it yet.** They join it the next time they are saved (moved or changed). Until then they do not move with it.
- **Connectors do not travel with a picture.** A connector joins blocks and follows them, but it is not a mark, so one joining a mark to something else does not scale when its picture is resized.
- **Holes and blur need a current browser.** They are drawn with a CSS mask. An older browser may show the picture without its holes.
- **Copy and Cut of an area were not tried with the computer's real clipboard.** What the page hands to the clipboard was checked (a picture of exactly the area); pasting it in another program, and Safari's rules for writing a picture to the clipboard, were not.
- **A new shape does not remember the corner radius or shadow you last chose.** They are set on a picked shape.
- **Clicking a picture that is already picked opens its description box.** That is how the board treats a second click on a block with words, and it applies to pictures. Press **Escape** or click elsewhere to close it before pressing a handle.

## Whiteboard: boards, the Eraser and unsent changes

Whiteboard 0.1.50 to 0.1.63 ([userguide-whiteboard](userguides/userguide-whiteboard.md), "Boards" and "Eraser"; [architecture-whiteboard](architecture/architecture-whiteboard.md)). Read from the code and the build reports; Safari, an iPad and a phone were not tried.

- **The board dropdown lists ten boards at most.** It is the host's menu (0.1.60, 0.1.63). It was seen only as code and by tool, not in a real browser, on a phone or in a real call; a drill-in with a Back row is what a phone gets for **Manage boards…**.
- **The board rules are the page's, not the server's.** The limit of 10 boards, the rule that a name is unique and the 40-character name cap are checked by the page. The server takes any key an editor writes, so an editor with a modified page can overwrite or delete any board, forge the time a board went to the trash, or write thousands of records. Anyone who may change the board can already change any block on it.
- **A space whose only record is a trashed `main` board shows it as live.** The first board, `main`, is read as "Board 1" when it has no record; if its only record is a trashed one, the page still shows it.
- **Two people renaming different boards to the same name at once** can leave two boards with one name. The page checks the name when it is typed, not when both saves land.
- **A heavy Undo takes about 115 seconds to settle on the server** (240 saves a minute). It is kept in the browser meanwhile, and survives a reload.
- **The Eraser's ring and the tool icon beside the pointer cost frame time** on a very large board (2000 strokes) with the CPU slowed six times. Nothing fails; the pointer follows later.
- **Last write wins.** A recolour that lands at the instant of another person's erase brings the stroke back (#694). Decided: leave it.
- **Unsent changes** are replayed for every listed or trashed board, for 10 minutes after the first replay; a network error or a 5xx keeps them and retries after 2, 5, 15, then every 60 seconds. Before 0.1.54, writes kept for a reload were stored under an empty space key and could not be found again (fixed).

## Guests and entering: gaps

The access bundle, steps 1 to 7 ([architecture-access](architecture/architecture-access.md)). Read from the code; checked by tools; not tried by a person in a browser, on a phone, or on a hosted server with several environments.

- **The bell labels a request notice "Modules".** A request to enter a space, and its answer, show under the wrong label.
- **Raw requests do not follow an agreement answer** (#684). Only the shared `api()` call sends a 403 with `agreementRequired` to **/agree**; about 47 raw `fetch()` calls in the pages, and the guest page, do not, so a person who has not agreed sees plain errors there.
- **A few routes answer 403 for a space the person may not enter** (#685), where the main routes answer 404. They confirm only that the id exists; the independent reads found no data leak.
- **No module open in a guest's canvas was tested.** A guest from the door sees a space; what a module does for that guest was checked for the guest link only.
- **The guest door's count is in memory.** A restart forgets who is here; a session still in date is counted again when it next asks.
- **The Trips step is not built** (step 8 of the plan): a person who joined a space cannot yet remove it themselves from their profile.

## Documents: Paper, the rich editor and writing together

Documents 0.7 to 0.11.35 ([userguide-documents](userguides/userguide-documents.md), [architecture-documents](architecture/architecture-documents.md)). Read from the code and the build reports; Safari, an iPad and a phone were not tried.

- **The Markdown box is not paged.** In Paper it shows one sheet; the pages appear in reading and in the rich editor.
- **The editor and the reading view can count pages differently** for a very large table: the editor does not split a table between pages, reading does.
- **Writing together is on by default, and not yet tried on Safari, an iPad or a phone** (#665, setting `coediting`, on by default since Documents 0.11.33). Thomas tried it live with several people typing and it worked; the module tests pass. An owner can switch it off in Module Configuration, and an environment that saved it off stays off. Other people's cursors are not drawn. The document lock is kept by the editing pages only: a hostile editor can bypass it.
- **A teal rectangle** can show in the reading sheet where a focus outline is drawn (#778, from its title).
- **Text that does not make the round trip in Rich text.** A run of four or more `$` signs is not kept exactly (#611). A link made at a caret, with no words selected, to a `mailto:` address with square brackets is not kept exactly: the "cannot keep exactly" note shows (#632).
- **The Tags button stays after the edit lock is lost** (#634); the formats and the editor switch go, and whether Tags should go too is undecided.
- **Paste from Word keeps only the words** (#800): its formatting is never read, by design (see the guide); the issue asks for more.
- **Print and Save as Markdown file** were read from the code and not tried in a real print dialog or in Safari or Firefox (0.11.18).

## Checks

These fail on `main` (`67998604`) and none was caused by the work since; a change that touches them should name the failure and move on. Read again for this entry, 2026-11-16.

- **`check-module-guards` fails on main** (#686): 1 of 28 cases fails, "chat's citations resolve as the reader, with or without the Assistant module": for a person who is not in the space it gets `gone` where it expects `hidden`. The cause is open. (Run on a19d7d34, 2026-11-16; not run again.)
- **`check-spacing` fails on main.** `public/style.css` has 59 values of `6px` where `tools/check-spacing-allow.json` allows 56 (lines 511, 534, 548 and others), and 51 of `10px` where it allows 50 (lines 526, 801, 1717). Run on 67998604.
- **`check-conformance` fails on main** (#798): 3 deviations in 3 of 40 windows. The first content in the list view sits 12 px from the frame edge in Research and Budget and 16 px in Documents; the Trip templates panel on Manage's Template page (1280 pixels, light) has 16px of padding above and 24px below, and so has the About tab's **Open-source software** panel (390 pixels, dark). Run on a19d7d34, not run again.
- **`check-destinations` fails on main** (#849): 1 of 45 cases, "travel: with no destination page yet, /calendar goes home and module pages and tiles stay their own": the widgets route answers no tiles under the Travel template and the case expects at least one. Run on a19d7d34, not run again.
- **`check-nav` fails on main**, as the project manager reported on 67998604. The cause was not looked into here. A run of it in a cloud container (with the packages installed) fails the same two cases, "Set up: a right-zone tool after your picture, before the window controls, ..." and "the address opens it once; a reload does not, ...", but the browser checks of the welcome note and the agent pages also failed to draw a page in that container, so that run says nothing about `main`.
- **`check-sources-modules` fails on main** ("public/design-system/sources.js is not what the generator writes"), seen on `origin/main` and on the reactions and icons branch alike, 2026-11-17. The cause was not looked into here.
- **`check-streams` fails on main** (reported by the build of the reactions and icons work, 2026-11-17; the cause was not looked into here). `check-spacing`, `check-module-guards`, `check-conformance`, `check-destinations` and `check-nav` above failed there too, so none of them is from that work.
- **`check-template-pages-b` is not in `npm run check`**, so nothing runs it by default.

Fixed since the last list: `check-catalog` (the catalog is back to four tools, then six with the Planner's two, #896 and #905), the six browser checks that stopped at the Budget chip (#894, #896), and `check-buttons` (buttons size through `--btn-h`, #893; it passed when run on 67998604).

Workaround for all of them: none needed to use the product.

## AI: gaps left after the notice fix

The AI has no switch of its own now (the AI Assistant module's switch is the one), and it says which state it is in when it can't answer. What is left:

- **The hint under the setup still says "Setting a service up does not turn the AI on: use the switch above"** (`public/admin.html`, the line under **Setup**). It is true of the module's switch and reads oddly now that the module and a usable service are all the AI needs.
- **Research says "AI Assistant is not turned on" for every not-set-up case.** `checkAi` in `modules/research/src/research.js` (near line 864) treats `not-set-up` and `module-off` alike, and the line in `research.html` (near line 44) says the module is off. With the module on and no service set up, Research still says so. To see it: turn the AI Assistant on with no service chosen and open Research. This is a module-lane change, left for Thomas to decide.
- **The Refused count in "AI use this month" counts only questions that reach the server.** A page that already knows AI is unavailable stops the send, so nothing is logged for it. This is by design.
- **The cause on one server is not proven.** An assistant said "AI is not set up yet." in an environment with a valid managed OpenAI offer; the AI answers again, and `GET /api/ai` was not read while it failed. The orphaned flag that this fix removes was reproduced on a throwaway hosted server (a new managed environment answered not set up until `enabled: true` was sent; clearing the host key and saving any AI field turned it off for good), but that it was the cause is not shown. If it fails again, read three things first: `GET /api/ai` while it fails (`problem`, `status`), the `[ai] <slug>: ...` line in the server's log, and whether the host's AI page was being saved around then.

A real AI provider was not available for this change, so no real answer was tried; it was checked against the stand-in service.

Workaround for all of them: none needed to use the product.

## A restore with a file name that can't be written leaves the environment empty

**#902.** The host console's restore (`POST /api/host/environments/:slug/restore`) takes the environment's folder away, then writes the zip's files one at a time. A zip with a file name the disk can't write (a name the file system refuses) stops the restore part-way with a 400, after the old data is gone, so the environment is left empty or half restored. Read as code (`server/index.js`, the restore route); not reproduced here. Workaround: take the host's backup of the environment first (`GET /api/host/environments/:slug/backup`), and restore only a zip the product made.

## Agents: what is not there yet

Agent access, steps 1 to 4 ([architecture-agent-access](architecture/architecture-agent-access.md)). Read from the code and the checks' headers; `check-agent-tokens` and `check-agent-asker` pass; `check-agent-pages` was not seen to pass by this entry's author (a browser check that did not run in the container used). A real cloud session calling a real server was not tried.

- **Chat text can steer the assistant.** An agent reads the public Chat of its spaces, and anything people write there, guests included, reaches the assistant's context. No check on the server can close that. What bounds it: the agent's writes go only through gated actions and labelled posts (off until the owner turns on **Post in Chat**), within its limits, all logged. Workaround: add an agent only to spaces whose Chat you are happy for it to read.
- **A restore can carry `chatPost` on an agent while Agents is off.** An owner's copy keeps `chatPost`. The agent then has it on, but its token does nothing until **Agents** is turned on, so it has no effect. Turn **Post in Chat** off on the agent's page if you do not want it on again with Agents.
- **An agent is not held to the terms or the NDA.** On a server with `TERMS_FILE` or `NDA_FILE` set, a person must agree before anything else; an agent is let past (`agreementExempt`), since it can't agree. Whether it should be is not decided. Workaround: none needed; the owner who made the agent has agreed, and the agent reaches only what a member reaches.
- **A request waits for an open page.** What an agent asks for is carried out only when a person who may change that module next has it open (up to seven days). Workaround: open the module.

## Pages and the back-forward cache

- **A call page brought back from the browser's back-forward cache may not say it is in the call again.** Pages now close their live streams as they go and open them again when restored (fixed for #911, in #916). Whether a call page restored this way tells the server it is in a call again needs LiveKit and was not tried. Chrome usually does not keep a page with a live call in its cache, so it may never arise. Workaround: if the call shows wrong after Back, reload the page.

## Templates and the planners: gaps

The templates redesign ([plan-templates-redesign](plans/plan-templates-redesign.md)) is merged through step 15b. These differ from the plan or are not built. Read from the code on 255fd8e3 and again on a19d7d34, 2026-11-16; none was seen in a browser.

- **Some driven settings do not exist.** Budget's unit and split, To-do's owners, Documents' default editor and Maps' real and picture map switches were to be set by templates and are not built. Projects' **Effort**, Education's and Mentoring's **Time** and Gaming's maps are names and categories only. Workaround: none; the names and categories work.
- **Some module words are declared and not wired.** Maps (`place`), Research (`note`) and Whiteboard (`board`) declare their labels, and their pages do not read them, so a template renaming one changes nothing there. Workaround: none.
- **The host console does not have the Manage pages.** Its template editor is one form; it does not edit a module's settings, renamed words or starter content (they are kept as they are). Workaround: edit those in Manage on an owner's copy, or write the template file.
- **Manage has no page for a template's call settings or starter spaces.** An owner's copy keeps those of the template it was copied from. Workaround: the host console edits them.
- **"Driven in N spaces" is not shown** on a module's page, so an owner can't see how many spaces a driven setting reaches.
- **Planner - Projects has no phase bands on its Timeline**, and neither new planner takes a drop of an object from another module (the Itinerary does). Workaround: link from the entry's form.
- **A reminder with no `ref` is not held to a copy's original** (#857, #877). `POST /api/modules/:id/schedule` takes an optional `ref` naming the object a schedule is about; Calendar 1.24.43 sends it, so a reminder of a copy reaches only those who may read the original. A schedule made without one (an older page, another module) reaches everyone who may read its own module. Workaround: none needed for the bundled modules.
- **An owner's edit of their template could race a confirm of its offer** (suspected, not reproduced). Confirms, switches and the delete of a template in use run one at a time, and a confirm checks the record again before it changes anything; a `PATCH /api/environment/templates/:id` of the template whose offer is being confirmed does not take its turn, and what happens then has not been checked. A confirm that finds the template changed is refused ("This template changed since it was offered; look at the offer again.").
- **Starter content skips the module data route's rate limit.** The server writes it through the same checks as a data write except the per-person limit; the 20 keys and 64 KB caps and the once-only rule are the bound.
- **The roadmap sync is checked against a stub only.** It has not run against the real project board, and it needs `PROJECT_TOKEN`, `PROJECT_OWNER` and `PROJECT_NUMBER` set in the repository.
- **A note with a `done` field counts toward a phase.** A phase measured by goals counts any planner entry that names it and has a `done` of true or false; the notes the planners write have none, but one written another way with a `done` would be counted. Workaround: none needed.

## Documents: paths checked as code only

Documents up to 0.6.1 ([userguide-documents](userguides/userguide-documents.md), [architecture-documents](architecture/architecture-documents.md)).

- **Read as code, not tried:** the lock going stale and being taken over from a second page, the save that loses to someone else's save and keeps the text on the screen, bringing a document back from the trash, and catching up after a dropped connection. The pure rules have tests; the pages were not driven by two people.
- **No links to other documents, no pictures, no export and no live co-editing yet.** They are in [plan-documents](plans/plan-documents.md) and the [TODO](TODO.md).
- **Search does not match tag names.** Searching the list matches the text of the list only; use the **Tags** filter for a tag.
- **Documents has no tag control on a row.** A document is tagged from its open page only.

## Shared tags: pieces the SDK does not have yet

- **The picker needs an element to open under.** `host.tags.picker(anchor, ...)` takes an element, not a point. Documents draws its own invisible 1-pixel element for it. A shared picker piece that takes an x and y is missing. Workaround: none needed; the module does it.
- **No shared "tag this" control on a row.** Each module places its own button.
- **No divider or group for action buttons in a toolbar.** A module's toolbar buttons all sit ungrouped; a module that wants a group cannot draw a line between them.

## Stacked modules and the tab order without moveBefore

A stack of docked modules keeps its sections in the page in the order the stack shows them with the browser's
`moveBefore()`, so Tab goes top section, divider, next section ([architecture-canvas](architecture/architecture-canvas.md),
"Stacks"). Browsers that lack `moveBefore()` (those that are not Chromium-based) leave the sections where they were in
the page, to avoid loading them again, so the Tab order of a stack can differ from what is drawn after a **Move up**,
a **Move down** or a drag. What is drawn and what is saved are right. Firefox and Safari, a real tablet's touch on the
divider and a screen reader were not tried.

Workaround: use the keyboard on the divider and the titlebar menus, which work in any order.

## Vault: who can see a file has known gaps

The server decides which Vault files a person may see, and the Vault (0.4.5) has the screens to set it ([plan-vault-privacy](plans/plan-vault-privacy.md), slices 1 to 3 and the share link rule, on main; the rest of slice 4 is not built). [Vault](userguides/userguide-vault.md), "Who can see a file", describes what works. These limits are known and accepted for now:

- **Space full.** The "space is full" refusal and the storage total can tell a person that files they cannot see take space. Thomas decided to accept this and document it.
- **A share link comes back.** A share link holds only the files its maker can still see, checked each time it is opened; a file they cannot see drops out of the link, and a link with none left reads "This link has ended." Nothing is stored, so if the file is shown to its maker again it returns to the link. Decision 8 of the plan reads as if the link ended for good; it is kept as built until Thomas says otherwise. Workaround: to end a link for good, turn it off under **Share links**.
- **The list of links still counts a file its maker lost sight of.** The list of share links, and the number of files a person sees on it, are worked out for the person looking, not for the maker, so a link may show a file that people opening it no longer get. An empty share (all its files hidden from its maker) shows to them as "0 files", and its **Edit** button answers 404. How it should look is for Thomas to decide.
- **Held objects.** When a hidden file is linked to an object, people who can see that object are still told that it changed. They can tell something changed on it, not what.
- **Some words and marks do not show for ordinary people.** The server sends a file's `visibility` only to the person who added it, owners and the admin. So the read-only line "Shared with you and others." in a file window, **Not shared with you** for a moderator who holds **See every file**, and the share sheet's sentence about a restricted file for a person who is on a chosen list, are in the code and are never drawn for them. Owners, the admin and the adder see everything described in the guide. No workaround is needed; nothing is wrongly shown.
- **The question's numbers are an estimate, and there is no dry run.** The server cannot say in advance who would lose sight of a file, so **Change who can see this file?** counts the people who lose sight, the links and the share links from what the page can read. A moderator with **See every file** keeps sight and may still be named.
- **"File removed" is not returned after a restricted file is deleted.** Decision 10 of the plan (only people who could see the file see "File removed") is not built.
- **The people picker shows no role words.** It lists names and avatars and marks owners "Always can"; it does not say who is a moderator or a member.
- **Closing and reopening Add files while files go up.** The choice resets to Everyone and the choices stay off until the queue ends, even though the files still going up keep the choice they were picked with.

## A module's right zone at 110 pixels

A module that puts three or more icon buttons in the toolbar's right zone (`zone: 'end'`) overflows the row by 12 pixels when the module is 110 pixels wide. Only the first two icon-only right-zone buttons are held in place; the rest fold into **More**, but the width the row keeps for them is not enough at that size. Only a switch's name (`label`) is cleaned of direction and zero-width characters; other labels are not. No bundled module puts more than one button in the right zone (the Whiteboard's **Snap to grid**).

Workaround: none needed for the bundled modules.

## The host console is dark only

The host console's address serves no `/theme.css`, so the console always draws in its dark colours, whatever the
person prefers. Light mode needs a server change (GitHub follow-up in the TODO).

Workaround: none.

## The server lets a host admin remove themselves

The console does not offer **Remove** for yourself or for the last host admin, but the server's route does not
refuse either. A call made outside the console could remove the only host admin.

Workaround: leave the host admin list to the console, and keep `ADMIN_LOGIN` and `ADMIN_PASSWORD` set.

## The host console sends no framing headers

The host console's page does not send the headers that stop it being shown inside another site's frame, as the other
sign-in and settings pages do (GitHub #441).

Workaround: none needed for normal use; sign in to the console only from its own address.

## The console's create route adopts a leftover environment folder

If a folder for an address is already on disk with no entry in the registry, the host console's create route takes it
over instead of refusing, as sign-up does (GitHub #442).

Workaround: before creating an environment, make sure no folder is left for that address.

## The demo seeder changes environment-wide settings

The demo loader (`server/demo-loader.js`) never changes an environment-wide setting, and the host console's **Add demo space** calls only it, turning on just the modules the host ticks. The seeder around it does:
`npm run seed:demo` installs and turns on every bundled module, turns on the calendar and map options, sets the
place search to the public Photon service and, on a new environment on the Default template with no space of its own, switches the template to the demo's. Use it only on test and demo
environments ([plan-demo-space](plans/plan-demo-space.md)).

Workaround: run the seeder only on a throwaway environment. See [Getting Started](userguide-getting-started.md), "Try it with demo data".

## The demo loader still resets a demo person who is a member of a real space

A demo person is an account an earlier load made and marked (`demo: true`; #884), and only such an account is ever given a new password. A load refuses an account with a demo person's login that was not made by a demo, one with another name or role, one with two-step sign-in on, and a host admin. A demo person who moderates a real space, by the API or by a stored moderator tick, is refused before any change since #909. But a demo person whom someone has since put in a real space as an ordinary member is still a demo person: the next load resets their password with the rest.

Workaround: do not put a demo person into a real space; make a real account instead.

## There is no Remove demo

The host console's **Add demo space** (#884, #909) has a picker for the five demos and **Turn these on too** for the modules a demo needs. There is no **Remove demo** (#882): to take a demo away, delete its space (and its people, if wanted). The loader turns on only the modules the host ticks; one left off is skipped and said in the report.

Workaround: delete the demo's space by hand.

## The demo space's marker is a public string

The loader knows its space by the first line of the description, "Demo data from npm run seed:demo." Anyone who may
edit a space's description can add or remove it. Slice 4 is to replace this (GitHub #416).

Workaround: leave the first line of the demo space's description alone, and do not copy it to another space.

## Two demo loader runs at once are not safe

Running the loader twice at the same time against one environment can leave the demo half built. The host console's route answers 409 while a run for that environment is going; the seeder and a direct call of the loader have no lock (GitHub #416).

Workaround: run one at a time. A nightly schedule is fine.

## The demo loader's retry has no overall limit

When the server answers 429 (too fast), the loader waits and tries again. There is no limit on the total time, so a
server that keeps refusing keeps the loader waiting (GitHub #416).

Workaround: stop the command and run it again later.

## The demo loader does not check the address it is given

The loader does not validate `base`. The seeder passes the address it was given. Slice 4 must pass the server's own
loopback address (GitHub #416).

Workaround: none is needed for the seeder, which is run by hand. Do not call the loader with an address you do not own.

## The demo seeder prints the demo people's one-time passwords

At the end of a run the seeder prints the one-time passwords of the demo people to the terminal. They are
random and new each run. Anyone who can see the terminal or the container logs can read them.

Workaround: run it where only you can see the output, and rerun it to replace them.

## A call page left open across an update must be reloaded

After the server is updated to the version that renamed "the table" (step 3 of the Names plan), a call page
that was already open still listens for the old messages and asks the old addresses. Until it is reloaded, it
does not follow a pull aside, a recall or a return, and does not show who is online.

Workaround: reload the page once after the update.

## Opening a dashboard object a second time doesn't open the object

On the spaces page, clicking an object on the dashboard (a task, an event, a poll) opens its module and the object
the first time. Clicking it a second time opens the module but not the object.
GitHub #20.

Workaround: find the object in the module itself.

## Reactions and icons: gaps

Found by quality-assurance on the environment-owned lists (Chameleon on branch `step22b`, 2026-11-17), read from the code and run on a throwaway server and in a browser. A real call, reactions over the data channel, keys 1 to 6 in a live call and a real OBS source have not been tried: there is no LiveKit server in the build container.

- **A new reaction with an emoji and no label cannot be saved on the host console.** The template editor refuses it with "a label is plain text of 1 to 40 characters"; Manage leaves an empty label out and saves, but the console sends an empty one. To see it: **Templates**, **New template**, **Reactions** tab, add a row with only an emoji, **Save template**. Workaround: give the reaction a label.
- **A new reaction whose label matches a built-in id is silently dropped.** A heart labelled "Heart" gets the id `heart` and is left out as a repeat where the lists are joined. Manage's "Already in the environment's set, not added again." note does not catch it, because it compares a new row by its emoji only. Workaround: use a different label or emoji.
- **The stream view does not retry a failed list.** If its request for a space's reaction list fails, it asks again only when presence changes; until then reactions from that space may not show in OBS.
- **Start again from the built-in set sits above the lists.** The plan puts it below both. It works the same; only its place differs.
- **On a short phone the lists show about five rows.** At 390 pixels wide the Manage sub-tabs and the sticky header take about 190 px, so a list box of 70vh shows about five rows.
- **The Stream module and the SDK's change poll carry only the environment's list.** `presenceForModule` and the presence change poll (`host.presence.onChange`) answer the environment's reactions, not a space's; only `host.presence.get({ space })` does.
- **A template's drop of an icon is by id only.** An icon that draws the same as an environment icon under another id is not dropped. Thomas chose this on 2026-11-17: icons repeat only by id.

Workaround for the last three: none needed.

## Saving a bundled template reorders its module list

On the host console, saving an edit to a bundled template, such as Travel, rewrites the order of its module list,
even when only the description changed. **Review** then lists **Modules** as changed. Seen on 2026-09-30, when `modules` was a list; it is an object by module id now, and whether it still reorders was not checked.

Workaround: none is needed for owners, since no offer is made to them. Ignore the **Modules** line in **Review**.

## The logo still reads the old name

The logo on the host console's bar reads "COFFEE PUB MAGPIE", the product's old name.
The words on that page say Chameleon. GitHub #110.

Workaround: none.

## The bell's notices don't open what they are about, and there are no mentions

The bell in the top bar lists module notices, but clicking one does nothing: a notice does not carry a link to its
object yet. Nobody is notified when they are mentioned in chat. Both are the notifications step of
[plan-primary-nav](plans/plan-primary-nav.md) (decision 3, step 9), not built yet. Opening the bell marks every
notice read at once; there is no **Mark all read** and no way to keep one unread.

Workaround: open the module named on the notice (from its card on the spaces page, or the space it came from) and find
the object there.

## The Paste button on a picture only gets a PNG

In Chromium, the **Paste** button on a picture box receives a copied picture only as a PNG. A copied animated GIF
arrives as a still picture, and a copied JPEG photo arrives as a PNG, which can be larger than the photo and go over
the 20 MB limit where the same file would not. Where the browser won't let the page read the clipboard (and on a
server not reached over HTTPS, where there is no **Paste** button at all), only the keyboard paste works. Seen on
2026-09-30, in headless Chromium.

Workaround: Tab to the picture box and press Ctrl+V (Cmd+V on a Mac), which keeps a copied file as it is, or click
the box and choose the file.

## The Planner's first open in a space logs three 404s

The first time the Planner opens in a space, the browser's console shows three requests answered 404:
`_cursor:events`, `_moved:plan-keys` and `_moved:phases`. They are the Planner asking whether its stored
markers exist before it writes them, and they are expected; nothing is wrong and nothing is lost. They predate the
kind picker (Planner 0.15.1) and are noise to ignore when reading the console.

Workaround: none needed.

## Phases can look stale for up to 30 seconds, and for an admin who is not a member

The Calendar asks for a space's phases every 30 seconds to notice an edit, because modules are not told when a phase
changes. A phase edited in Set up can take up to 30 seconds to show on the Calendar. An admin who is not a member of
the space does not get the update at all and sees the old phases until the page is reloaded. GitHub #283 (a
phase-change event for modules).

Workaround: reload the page.

## The Calendar's Day view can scroll by itself at narrow width

At 390 pixels wide, the Calendar's Day view can scroll by itself, away from where you were. The phase bar now stays
in sight as you scroll (Calendar 1.24.9). Related: GitHub #287.

Workaround: scroll back to the place you want.

## Narrow bands in the status strip hide their label

A phase that lasts only a few days is a narrow band in the status strip. When the band is too narrow, its name is not
drawn; the band's colour and its icon (when the template gives one) still show.

Workaround: open the phase sheet (choose the chip) to read every phase and its dates.

## The Planner's old "Spent" chip can stay on the strip after Budget is turned on

When Budget is on in a space, the Planner stops showing its **Money** view and its **Spent** chip. The strip keeps what
a module last reported for up to 7 days, and the Planner only clears its report when someone who can change the Planner
opens it. Until then the strip can show the Planner's old figure beside Budget's, and the two can disagree. It goes away
when a Planner editor opens the Planner in that space, or after 7 days.

Workaround: open the Planner once in the space as an owner, an admin or anyone who can change it.

## Budget is up to 30 seconds behind the Planner

Budget reads the Planner's priced bookings by asking again every 30 seconds, and when its window is shown or focused
again, because the SDK has no event that tells a module another module's objects changed. A cost saved in the Planner
can take up to 30 seconds to appear in Budget, and the strip's figure moves with it.

Workaround: switch away from Budget and back, or focus its window, to read again at once.

## Budget's burndown axis labels overlap at very large amounts

On Budget's **Overview**, when a target is very large (many digits), the labels along the burndown's amount axis can run
into each other. Reported by QA on 2026-10-14; not seen on a screen by the person writing this.

Workaround: the figures beside the chart ("Left", "Paid") are not affected; read them there.

## Places saved before a picture map keep their old positions

When an owner sets a picture map, places already saved keep the real-world positions they had. They are not moved, so
they may sit in the wrong place on the picture. Places added after the picture map is set are placed on the picture.

Workaround: edit each place and set its **Position** on the picture with the target button, or clear the picture map.

## A pop-out needs a browser that allows pop-ups

**Its own window** for the call, and **Open in its own window** for a module, use `window.open`. A browser that blocks pop-ups, or an installed app that restricts them, cannot show the window. The call and the module now stay where they were and the status line reads "The browser did not open the window. Allow pop-ups for this site to open it in its own window." (GitHub #288). Only the window itself is missing.

Workaround: allow pop-ups for Chameleon.

## A Calendar or Map editor in a narrow window is a narrow-layout sheet

When the window is narrower than the editor, the editor of a Calendar or Map part opens as the narrow-layout sheet at that width, not as a window the editor's own size. The page behind it keeps its layout.

Workaround: widen the window.

## Floating windows can draw over a lifted editor

While an editor from the Calendar or the Map is open, a floating module window can still be drawn over it.

Workaround: close or move the floating window first.

## Some muted text on tinted surfaces is under 4.5:1 in light mode

Muted text on a plain surface now meets 4.5:1 in Strong Coffee's light mode, but three cases on tinted surfaces do not: the dates on phase-tinted chips (3.85:1), the counts on a poll's voted bar (3.78:1) and the struck-through titles of done objects (3.81:1).

Workaround: none; use a dark theme if the text is hard to read.

## Research's notes, links and answers have no owner on the server

Research's server rules (its `guards`) hold a **photo** to the person who added it: someone else may change its caption,
and only a role with **Remove photos other people added** may remove it or change more. A **note**, a **link** and an
**answer** have no such rule (RS-01 in the health audit of Research). Anyone who may edit in Research can change or delete one that another
person added, by a request to the data route; the server does not refuse it.

Workaround: give **Edit** in Research only to people who may be trusted with each other's notes.

## An Undo refused after a restart says the time is over

A Clear is held on the server for its Undo, and the hold survives a restart. What became of a recent Clear's token (undone, replaced by a later clear) is only remembered in memory. If the server restarts and a page then presses **Undo** on a token that was already undone or replaced, it is refused with "The time to undo that clear is over." rather than the true reason. Nothing is restored or lost by it.

## Some shared pieces are still drawn 28 pixels high on a phone

At 640 pixels and narrower, buttons are 44 pixels and a small button keeps its 30 pixel look with a 44 pixel area to press. The shared title-bar and toolbar buttons, the view switch and the toolbar search are now drawn 44 pixels (GitHub #394). A few other shared pieces are still drawn at 28 pixels on a phone. They can be pressed, but the target is smaller than the 44 pixels the rest of the app gives. Reported by the project manager; the pieces were not listed and are not re-measured here.

Workaround: none needed to use them; they are harder to hit with a thumb.

## The keyboard focus ring can show an inner rectangle

In `public/sdk/system.css`, a control's focus ring can draw an inner rectangle as well as its outline on some pieces. The toolbar search box was fixed (GitHub #394); the other pieces were not listed. Reported by the project manager; the pieces were not listed and this entry's author has not seen it. It does not stop anything from working.

## A second click on Print while one is preparing starts a second print

**Print** in the Vault shows "Preparing to print..." while it gets the file ready, but it does not stop you from choosing **Print** again. A second click starts a second print of the same file. Found when the print was made faster; it has not been fixed.

Workaround: wait for the print dialog before you choose **Print** again.

## Printing a PDF always waits 400 ms

After a PDF is loaded into the hidden print frame, the Vault waits a fixed 400 ms before it opens the print dialog, in case the browser's PDF viewer is not ready. That is a short, fixed delay on every PDF print, and on a slow device it may still be too short. It was kept when printing was made faster because the check browser has no PDF viewer to test removing it. Not seen in a real browser.

## A guest does not see a module turned on or off until a refresh

When a module is turned on or off in **Manage > Modules**, members and others who are signed in see the space bar change at once. A guest has no notifications stream, so a guest's open space keeps the old list.

Workaround: the guest refreshes the page.

## A change to a module's permissions needs a reload

Turning a module on or off updates an open space live, but changing who may use a module does not. An open space keeps the old list until the page is reloaded.

Workaround: reload the page.

## An export blocks the whole hosted server while it builds

An owner's **Download a copy** (and the host's backup) reads and zips the environment's folder in one go, and the server answers nothing else while it does. A large environment makes that long. A fix is planned as its own piece of work: streaming the zip, a size cap, one at a time and a rate limit.

Workaround: ask for a copy when the environment is quiet, and keep the environment small.

## A host admin's password alone opens every environment

A host admin signs in to any environment with the host password, even when that host admin uses a second step at the console. This is read as code only, not tried live. A GitHub issue is to be filed.

Workaround: give the host password only to people you would trust with every environment, and keep it long and unique.

## An owner's copy still carries some personal details

The copy leaves out sign-in secrets and private chat, but it still carries logins and display names, module notifications, counts from the AI log (never the text), module setting values (a typed address can carry a key), a space's link, and the Vault's file records (names and sizes). Treat the zip as private.

Workaround: keep the file private and delete it when it is no longer needed.
