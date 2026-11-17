# Documents Charter

**Audience:** Thomas, who owns it and corrects it; and the Documents module agent, which reads it first, and the project manager, who reads it for cross-module questions.

**Status:** draft 2026-11-17, for Thomas to read and correct. He approved drafting it on a branch: "draft them on a branch for me to read first". Nothing here is decided until he says so. It follows the template in [plan-module-agents](plan-module-agents.md), "The module charter", and is built only from what the repository says; nothing was run for it. Where it lives is proposed under "Where this file lives".

## For

Documents is where the people in a space write notes together and keep them: session notes, handouts, lesson plans and project briefs, as pages with headings, lists, grids and links.

## Not for

- Not a place for research findings, with a place, a date and the AI (Research).
- Not a file store (Vault): Documents keeps its own text and saves a Markdown file; it does not hold uploads, PDFs or pictures yet.
- Not a spatial canvas (Whiteboard), and not a conversation (Chat).
- Not a planner: no dates, owners, status or money.
- Not a word processor in full: no comments, no suggestions, no version history, no fonts, no custom margins (the open ideas in `TODO.md`).

## Used by

Spaces only (`scope: ["space"]`). Members and moderators read and write; guests read, and write only if the owner gave the guest role **Write and change documents** and the guest holds a valid pass. The owner and admin always can, and the owner sets the `coediting` setting. Starter documents come from templates (Project, Games, Learning, Mentoring).

## Neighbours it must not duplicate

- **Research** keeps notes that are research: tags, a place, a date, the AI; one value, about 60 KB. Line: a document is read and written top to bottom by several people; a Research note is a finding the AI and the places can use.
- **Vault** keeps files, Markdown up to 1 MB included. Line: Documents owns text that is edited in the page; the Vault owns files that are stored, shared and opened. There is no door between them today (a document in the Vault, or a Vault Markdown file opened as a document); [plan-documents](plan-documents.md) "The Vault gap" left it out.
- **Whiteboard** has words and notes on a board. Line: a document is linear; a board is spatial. Documents copied the Whiteboard's lock pattern; they stay two modules.
- **Chat** holds messages, not edited text. Line: a document is kept and edited; a message is said once.
- **The planners** (Schedule, Goals, Travel, To-do, Calendar) hold dated and owned objects. Line: a plan written as prose is a document; anything with a date, an owner or a status is the planner's object, and a document may link to it (`refs`).

## Core's, not the module's

The SDK (`host.*`), the module host and its shadow root, storage (compare-and-set, size limits), sync and the live stream (`host.live`, `server/module-live.js`), tags, access and permission checks, the call, the standard Print action, the nav and the title bar. A Documents change calls these; it never changes them.

## What a Documents change may and may not touch

- **May:** `modules/documents/` (`src/`, `test/`, `design/`), its `version`, `description`, `labels`, and the `label`, `help` and `default` of its settings (the `coediting` default is the example), its user guide, its section of `known-issues.md`, its plans' status lines, its entry in `tools/module-versions.json`, one CHANGELOG line.
- **May not (Thomas decides):** the manifest keys that are core's: `permissions`, `access`, `scope`, `surfaces`, `uploads`, `refs`, `actions`, `hooks`, `events`, `commands`, `guards`, `live`, `budget`. Documents declares `permissions`, `access`, `scope`, `surfaces` and `live`; it has no `uploads`, `refs`, `actions`, `hooks`, `commands` or `budget` today.
- **Watch: `live`.** The manifest has `"live": { "publish": "edit", "bytes": 2048, "perSecond": 30 }`. Co-editing relies on four things in core: (1) `host.live` carries the Yjs updates, one topic per document (`ydoc.<id>`); (2) the server refuses a send from a person without `edit` (403) and sets `from`, which the page trusts as identity; (3) the server's limits and their ceilings (`MODULE_LIVE_MAX_BYTES` defaults to 4096, `MODULE_LIVE_MAX_PER_SECOND` to 200), so 2048 and 30 hold only while those allow it; (4) storage, which stays the only truth (the Markdown record is what everything else reads; the `ydoc:` records are the shared state). A change to the module's `src/` can still break any of these (the topic, the update gate, the writer rule), so a `src/` change near `u-coedit-sync`, `t-coedit-gate` or `v-coedit-save` runs the `check-documents-coedit-*` checks and, being the safety path, waits for Thomas.

## Current state

Version 0.11.33 (`modules/documents/module.json`). Built: list and thumbnails, reading, the rich editor with grids, Paper and Fluid layout, page numbers, the Insert menu, tags, Print, Save as and Open Markdown file, the trash, the title-bar document select, and writing together. Co-editing has been **on by default since 0.11.33**, on Thomas's decision after he tried it live (plan-documents-coediting, decision 9); an owner can switch it off, and a stored off stays off. **Untried:** Safari, an iPad, a phone, and two real computers; the independent safety read is not recorded as done. Not built: links to objects and other documents, pictures, other people's cursors.

## Questions that are Thomas's

Mark each one: the agent asks before touching it.

1. **Thomas's:** Which note lives where? A written finding that has a place or a date: Research or Documents? (Today either.)
2. **Thomas's:** Does a document ever live in the Vault, or a Vault Markdown file open as a document? ([plan-documents](plan-documents.md), open question 8.)
3. **Thomas's:** May the Assistant or Research read a document's full text, and who may allow it? (open question 10; today only the excerpt reaches a summary.)
4. **Thomas's:** Who may delete another person's document, and is the seven-day trash enough? (open question 4.)
5. **Thomas's:** Is co-editing safe to leave on without the independent safety read, and without Safari, iPad and phone tried?
6. **Thomas's:** Pictures and links to other documents or objects: in this module, or through the Vault and `refs`?
7. **Thomas's:** Rich text as the default editor, a default editor set by a template, and the open ideas (#687, #803, #800, #690, #666, #688).
8. **Thomas's:** Any change to `live` (the 2048 bytes, 30 a second) or a new manifest key.

## Checks that cover it

`npm run check:module -- documents` (core lint, the module's `test/*.mjs` and its `tools/check-documents-*.mjs`, including the co-editing files); `node tools/check-module-versions.mjs` (a changed module needs a version bump; `test/` and `design/` need none); `npm run check:docs` for this file, the guide and the known issues. A real browser pair, Safari, an iPad and a phone are checked by hand with real people; no check here covers them, and there is no LiveKit server locally (co-editing does not use it).

## Where this file lives

Suggestion, not a decision. `documentation/plans/plan-charter-documents.md`, because `check-docs-structure` allows only the folders in the standard, each with its prefix, and `plans/` with `plan-` is the one that holds a decision-in-progress that Thomas owns; plans are not published, which suits a file for the agent and Thomas. The other option, `modules/documents/CHARTER.md`, sits beside the code but would ship in the module (or need an exclusion in the build), is not covered by the docs check, and sits inside the path the fence lets a module agent edit, so the agent could change its own charter. A file in `documentation/` outside `plans/` is refused by the docs check (the root takes only `home.md`, `known-issues.md` and `TODO.md`).
