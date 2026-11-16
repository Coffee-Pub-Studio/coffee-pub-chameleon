# Product Pages for the Template Types Plan

**Audience:** Thomas, who decides where the product pages live, how they split and what they may claim; content-manager, who writes the words for each type; server-development, who builds the tool that rebuilds every screenshot from the demos; experience-design, who builds the in-repository parts and judges the pictures; quality-assurance, who checks the words against the not-claim list; and the website session, which owns the Chameleon page on `coffeepubstudio.com`, outside this repository.

**Status:** draft, awaiting Thomas's decisions (marked 2026-11-16; the content is unchanged). Drafted 2026-11-15, nothing decided beyond the three requests below. Thomas, 2026-11-15, tonight's needs: "screenshots for the product pages. We will need to adapt our product pages to support our current types of templates." And, about the demos: "we will need [a demo] of each for the other types we are supporting." A builder is making one demo per type (Travel, Games, Project, Learning, Mentoring); those demo files are not on `main` yet (`templates/demo/` holds only `travel.json` at `275f11a9`). Everything below is a proposal for Thomas to decide.

**Where the pages live (read this first).** There are no product pages in this repository any more. [plan-product-site](plan-product-site.md) moved them to the website's page, `https://coffeepubstudio.com/products/chameleon`, which the website session builds and Thomas approves; the pages here were deleted in slice 5 (PR #447) and [plan-product-pages](plan-product-pages.md) is superseded. What this repository still owes the website is facts and pictures: the product sheet and the screenshots (product-site decision 4). So "adapt the product pages" means two things: change what this repository hands over (a section per type, and a screenshot set per type), and tell the website session what the page must now say. Open question 1 asks Thomas whether that is what he wants.

## What it is today

Read on `origin/main` at `275f11a9`, and the live page read over the network on 2026-11-15 (public HTML only).

**In this repository**

- **The start page** (`public/start.html`, `start.js`, `start.css`) is a doorway: recent environments, a typed address, sign-up, a link to the website. It has no use cards and no screenshots. Its **Try the demo** (`#demo`) is not built (product-site slice 6).
- **The product sheet** (product-site slice 1) is **not written**: there is no `documentation/userguides/userguide-product-sheet.md` and no `tools/check-product-sheet.mjs`.
- **The `product` screenshot tier** (product-site slice 1) is **not built**. `tools/shots.mjs` has two seeds in `tools/shots-seed.mjs`, `travel` (the default) and `games` (`--seed=games`). Both are the regression baseline's own data, not the demo files. The tool starts a throwaway server with a fixed clock (2026-10-15, `tools/shots-clock.cjs`), drives headless Chromium, and writes outside git (`--out`, `--dir`, `tools/.shots/`). Its screens are rows in `tools/shots-screens.json`; the tiers set sizes (core: 1280, 700 and 390, light and dark) and a row may name a `seed`, `steps`, `hide` and `call` (the call drawn with a stand-in, `tools/shots-livekit-stub.mjs`). Two rows name the games seed: `games-planner-timeline` and `games-obs-character`.
- **The demo loader** (`server/demo-loader.js`, `tools/seed-demo.mjs`) reads `templates/demo/<template id>.json`, with dates as offsets from today, and writes through the server's own routes as the demo people `mia`, `lee` and `sam`. It never installs a module or switches a template, and skips a module that is off. Only the travel file exists on `main`. See [architecture-demo-site](../architecture/architecture-demo-site.md) and [plan-demo-space](plan-demo-space.md).
- **The five types** are the bundled templates `travel` (version 13), `games` (6), `project` (2), `learning` (2) and `mentoring` (2), read from `templates/*.json`, and the Default template. The planners are `Planner - Itinerary` (module id `travel`, 0.16.8), `Planner - Projects` (`schedule`, 0.1.0) and `Planner - Goals` (`goals`, 0.1.0). Import and export of a planner as JSON is being added and is not claimed here until it is merged and checked.

**On the website's page (outside this repository, read 2026-11-15)**

- Its "What it is for" has six cards: Travel (private beta), Gaming (private beta), Projects (coming soon), Mentoring (coming soon), Real estate (coming soon) and Anything imaginable (coming soon). There is no Learning card.
- Its Planner blurb says "In a trip it is the Itinerary, in a campaign the Campaign planner." That was true before the three planners; today Campaign is `Planner - Projects` under the games template's word, and Projects and Learning and Mentoring have their own.
- Its Mentoring card promises "Polls to choose what to cover next". The `mentoring` template turns Polls on in no space (its modules are Planner - Goals, To-do, Calendar, Documents, Research, Budget, Vault, chat and the call). The Projects card says "coming soon" though `project` ships.
- I found no screenshot image in the page's HTML (the only image reference is the Open Graph picture), so the pictures are either drawn by script or not yet placed. I could not read the website's code; its repository is not here.

## Decisions

Thomas's, 2026-11-15, in chat:

1. **The product pages need screenshots.** Reason: they are how a visitor sees what a type is.
2. **The pages are adapted to the types now shipped,** not only travel and games.
3. **Each type gets a demo** (Travel, Games, Project, Learning, Mentoring), made by a builder; the screenshots come from them.

Carried over from earlier plans and still binding: the website session owns and builds the page and Thomas approves its words, product facts reach the website through the product sheet and `GET /api/product`, and screenshots are handed over and never committed to `main` (product-site decision 4); "Try the demo" opens the demo environment's own sign-in with `?login=demo`, one demo per template, since one environment holds one template (product-site decision 5); the chat is the core and the call is optional (product-pages decision 1).

Nothing else is decided. Each section below that says "proposed" is a suggestion.

## The type sheet (proposed)

One block of facts and words per type, written by content-manager into the product sheet, that the website renders however it is laid out. It is the unit that does not change whether the answer to question 2 is one page or five. The facts below are read from the template files; content-manager checks them again when writing, since a template can change.

| Type | Page name | Space word, other words | Planner as a person sees it | Modules turned on, as named | Phases |
| --- | --- | --- | --- | --- | --- |
| Travel | Travel | trip, trips | Itinerary (`Planner - Itinerary`) | Maps, Research, Vault, AI Assistant, Calendar, Budget, Polls, To-do, Documents, Whiteboard, chat, call | Planning, Booking, Buffer, Pre-trip, Trip, Post-trip |
| Games | Games | campaign, campaigns; player, players | Campaign (`Planner - Projects`; sessions, scenes, story threads) | Sessions (Calendar), Quests (To-do), Lore (Research), Costs (Budget), Documents, Maps, Polls, Vault, AI Assistant, chat, call | none |
| Project | Projects | project, projects | Project plan (`Planner - Projects`; dates required, waits-on) | To-do, Calendar (meetings), Effort (Budget), Documents (a brief), Maps, Research, Polls, Whiteboard, Vault, chat, call | Start, Build, Wrap up |
| Learning | Learning | course, courses; learner, learners | Learning plan (`Planner - Goals`; progress by steps) | Exercises (To-do), Reading (Research), Sessions (Calendar), Time (Budget), Documents (a learning journal), Maps, Vault, chat, call | Explore, Practice, Review |
| Mentoring | Mentoring | mentorship, mentorships; the goal's owner is a mentee | Development plan (`Planner - Goals`; progress by steps) | Next steps (To-do), Check-ins (Calendar), Documents (a meeting log), Research, Time (Budget), Vault, chat, call | Getting started, Growing, Review |

Each type's block also holds: a **what it is for** paragraph (two or three sentences, plain, the group first); **who it suits** (one sentence); a **what it is not** line (see the not-claim list); the **words** it uses (as above, from the template); the **planner** it shows and what that planner does today (from its user guide); the **modules** it turns on, "and more you can turn on" for the rest; the **demo** (its name, what it holds, and, once built, its address); the **shot ids** (below), each with a one-sentence caption and alt text; and a **claim line** per feature, each linking the user guide that describes it (product-site decision 4).

## What the pages must not claim (proposed)

Applies to the website, the product sheet, captions, alt text, the demo content and the start page. Content-manager keeps the list; quality-assurance checks the words against it. The grounds are the scaffolding briefing (the research note of 2026-11-15; plain words, not legal advice) and the rule that a page claims only what is built.

- **No "IEP tool", "IEP", "special education", "accommodations", "diagnosis", "therapy", "treatment" or "clinical".** The product is a planning tool in which a person writes their own goals. The briefing's advice: say what it is, and say it does not replace a school's plan.
- **No "compliant", "FERPA", "HIPAA", "COPPA", "GDPR ready" or "secure for children".** Self-hosting keeps the data on the group's own server; it does not make a school's duties go away. The page may say where the data lives, in the words already used ("Yours, and private"), and no more.
- **No scaffolding features that are not built.** Support levels, fading, mastery rules, attempt records, a now-and-next view and a learner's own login are options in the briefing, not features. Learning and Mentoring both run on `Planner - Goals`: goals with steps and progress, dates optional. The words "practice" and "support" may appear as ordinary words; "mastery" and "fading" may not describe the product.
- **No promise to a child or about children.** No "for kids", no ages, no pictures or demo content of a child. The Learning demo is an ordinary course for a study group or adult learners.
- **No call claims the screenshots cannot back.** The call's screens are drawn with a stand-in (no LiveKit locally), so a shot shows the call's controls with one person; the caption never says "live" or shows a group on a call. The call is "optional" everywhere.
- **No module on a type that its template does not turn on** (the Mentoring card's Polls is the live example), and no feature named as shipped that is not on `main` (planner import and export JSON until merged). The product sheet check (product-site slice 1) enforces the module part by tool: every module a type names is in that template's `modules`.
- **No AI claims in the demo.** The Assistant is off in the demo; no shot shows an AI answer unless the type's seed made one with a stand-in, and the caption says so if it does.
- **Names:** the words a person sees follow `CLAUDE.md`'s Names. "Space", "module", "object" and "canvas" in prose, never the old words; a type's own word ("trip", "campaign") where the page speaks of that type.

## The shot list (proposed)

Eight views per type, in light and dark, so 16 pictures per type and 80 in all. The website has its own mode switch, so both modes are handed over for every view; the cost is the tool's render time, not new work. Sizes: **1280** (a 1280 by 800 window) for six views, **390** (390 by 844) for two phone views; one device scale (question 5). Every shot is taken as a demo person in the type's own demo space, on the shots clock's fixed day, with `PRODUCT_NAME`'s value in the page's title and bar.

Names: `<type>/<view>-<size>-<mode>.png`, for example `games/campaign-1280-dark.png`. Types in the folder are the template ids: `travel`, `games`, `project`, `learning`, `mentoring`. Views are short lower-case words. The id used by the shot list, the caption and the manifest is `<type>-<view>`.

The first view of each type is its **hero**: the canvas with the chat and the type's planner side by side, the picture a page leads with.

| Type | Desktop views (1280) | Phone views (390) |
| --- | --- | --- |
| Travel | `hero` chat, Itinerary and the map side by side; `days` the Itinerary's Days view on a day with a flight, a stay and a meal; `bookings` the Bookings view with confirmations; `map` Maps with the places as pins; `budget` Budget with who owes whom; `home` Home, listing the trips | `chat`, `days` |
| Games | `hero` chat and the Campaign planner; `campaign` the Campaign's timeline with sessions, scenes and story threads (today's `games-planner-timeline`); `sessions` the Calendar named Sessions; `quests` To-do named Quests; `lore` Research named Lore with tags; `obs` a player as an OBS source on a clear background (today's `games-obs-character`) | `chat`, `quests` |
| Project | `hero` chat and the Project plan; `plan` the Project plan with dates and what waits on what; `tasks` To-do with owners and due dates; `effort` Budget named Effort, in hours; `brief` the project brief in Documents; `home` Home, listing projects with the phases Start, Build and Wrap up | `chat`, `tasks` |
| Learning | `hero` chat and the Learning plan; `plan` the Learning plan with steps and progress; `exercises` To-do named Exercises; `journal` the Learning journal in Documents; `reading` Research named Reading with tags; `sessions` Calendar named Sessions | `plan`, `exercises` |
| Mentoring | `hero` chat and the Development plan; `plan` the Development plan with a mentee's goals, steps and progress; `next` To-do named Next steps; `checkins` Calendar named Check-ins; `log` the meeting log in Documents; `home` Home, listing mentorships with Getting started, Growing and Review | `chat`, `plan` |

The views follow what the builder's demos hold; if a demo has no content for a view, the row is dropped or replaced, never faked. Shared pictures that belong to no type (Home on a phone, the call's controls, a theme choice) are left out of this plan; a type's `home` and `hero` cover them.

**What each demo must hold for the shots** (the builder's brief, proposed): at least three people with invented names and no real photographs; chat with a link card and a reply; the planner filled across the type's phases with several kinds of entry; a calendar with entries this month and next; To-do with both done and open; at least one poll open and one closed (not on Mentoring); nothing from a real person, company or address; the Learning and Mentoring content is a general course and a general mentoring pair (a language, a craft, a career goal), with no child, no diagnosis, no school and no IEP. The Learning and Mentoring demos are read by quality-assurance against the not-claim list before any shot is taken.

**Captions** are one plain sentence that says what is on the screen, written by content-manager into the type sheet beside each shot id, with separate alt text. No caption makes a claim the not-claim list forbids. A check (below) fails if a shot has no caption or a caption has no shot.

## How the screenshots are made again (proposed)

**The command.** `npm run shots:product`, a script over `tools/shots.mjs`, not a copy of it. It runs the shots tool's own browser, clock, determinism and settling rules, and it reads a second screen file, `tools/shots-product.json`, so the regression baseline's `tools/shots-screens.json` is untouched. The regression seeds stay as they are: their job (prove a change altered nothing) is not the product pictures' job.

**What one run does, per type** (one throwaway server per type, since one environment holds one template):

1. Start a throwaway server with the shots clock, as `shots.mjs` does.
2. Do what `tools/seed-demo.mjs` does for a throwaway environment: apply the type's template, install and turn on the modules it names, turn on the calendar and map options it sets. The demo loader never does this part itself.
3. Run the loader on `templates/demo/<type>.json` with `today` fixed to the clock's day, so every offset lands on the same dates in every run.
4. Sign in as the demo person each screen names (how is a detail for server-development; the loader's people have random passwords, so the tool either signs a session for them the way the host's demo stand-in does, or sets known passwords on its own throwaway server).
5. Photograph each row of `tools/shots-product.json` for the type, at the sizes and in the modes the row names, with the call's stand-in where a row names the call.
6. Write `<out>/<type>/<view>-<size>-<mode>.png` and one `manifest.json`: the product's version, each type's template id and version, each module's version, Chromium's version, and per image its file, size, mode, sha and shot id.

**Options.** `--out=<folder>` (required; never inside the repository), `--only=<type or shot id>` (one type, or a few views), `--compare=<earlier folder>` (list which images differ, by `shots.mjs`'s own difference tool), `--stale=<earlier folder>` (list which types' templates or modules changed version since that folder's manifest, without opening a browser). The run says SKIPPED with no Chromium, never a pass.

**When it runs.** By hand: at release prep, and when Thomas or the project manager asks. Not on a schedule and not in `npm run check` (the testing rule of 2026-11-15, [architecture-demo-site](../architecture/architecture-demo-site.md)). `--stale` is the answer to "are the pictures current": it reports, it does not fail a build.

**The check that is in `npm run check`** (node only, no browser): every shot id in `tools/shots-product.json` has a caption and alt text in the type sheet and the reverse; every type has a demo file at `templates/demo/<template id>.json` and a bundled template; every module a shot names is turned on by its type's template; the screen rows use only names that exist in the shots tool. It cannot say the pictures look right.

**Output format.** PNG, lossless, at one scale. The website's build turns them into the formats it wants (the earlier pictures on this host were webp). This keeps the run deterministic and the compare simple (the tool decodes PNG itself). Question 5 asks about it.

## Where the pictures live (proposed)

- **Here:** nowhere in git. They are written to a folder outside the repository and handed over, as product-site decision 4 says; `main` never holds them. The project manager passes the folder to the website session with its `manifest.json`.
- **On the website:** the website session chooses the paths. The convention proposed here is `assets/chameleon/<type>/<view>-<size>-<mode>.png`, mirroring the folder so a handover is one copy. The website's older folder `/assets/collaborator/` holds copies of the retired product's pictures under the old name (product-site, "The website already has a stale copy") and should be removed when the new set lands. The website currently uses `assets/og/chameleon.png` for its sharing card; that one picture is the website's, not part of this set.
- **Naming rule:** by kind and view, never by product (the identifiers rule in `CLAUDE.md`); the picture shows `PRODUCT_NAME`'s value inside it.

## The contract

### Content (content-manager)

- Write the type sheet (five blocks) into the product sheet that product-site slice 1 calls for, `documentation/userguides/userguide-product-sheet.md` (content-manager chooses the final name), with each claim linking a user guide. The user guides to cite exist: `userguide-templates`, `userguide-planner` (Itinerary), `userguide-planner-projects`, `userguide-planner-goals`, `userguide-todo`, `userguide-calendar`, `userguide-budget`, `userguide-documents`, `userguide-research`, `userguide-polls`, `userguide-maps`, `userguide-places`, `userguide-call`, `userguide-chat`, `userguide-obs`.
- Write the "what it is not" notice, the not-claim list as a short published paragraph, and the captions and alt text per shot id.
- A **Not built** line per type, honest and short (for Learning and Mentoring: no attempt records, no support levels, no learner's own simplified view, no planner import or export until merged).
- Correct the product sheet when a template or module changes a claim; the sheet's date changes then, so the website session knows to look.

### Server (server-development)

- `tools/shots-product.json` and the `shots:product` command above; the loader and seeder pieces it reuses; `manifest.json`; `--only`, `--compare`, `--stale`.
- The check described above, in `npm run check`, and the product sheet check from product-site slice 1 extended to the per-type module rule.
- `GET /api/product` gains `demos`: a list of `{ template, address }` for each type whose demo environment exists (product-site slice 6 had a single `demo`; this replaces it). Question 4.

### Pages in this repository (experience-design)

- **The start page's Try the demo** (`#demo`, product-site slice 6), one entry per type that has a demo, each opening that environment's sign-in with `?login=demo` and showing the public demo password beside it. Not drawn when `demos` is empty. This is the only product-facing page left in the repository.
- **The by-eye pass:** look at every picture at 1280 and 390, light and dark, and report any view that looks wrong (clipped text, an empty region, a stand-in artefact) as a defect against the module, not a retouch. Fix defects in the app where they are real.

### The website's page (the website session, outside this repository)

This is the list the website session is given; Thomas approves its words (product-site decision 4).

- Read the type sheet and `GET /api/product` at build time.
- Present the five types (question 2 decides the shape), with each type's what-it-is-for, its words, its planner, its modules, its pictures and its demo.
- Remove or mark what no template backs: the Mentoring card's Polls, the Planner blurb's "In a campaign the Campaign planner", and "coming soon" on a type that ships. Real estate has no template (question 3).
- Add a Learning card.
- Say the same not-claim list.

## Left to build, in order

Sizes are builder-days, one builder, rough.

| Step | What | Who | Size | Blocked by |
| --- | --- | --- | --- | --- |
| 1 | The demos for the five types (the builder's work in hand) | the demo builder | in hand | Not counted here |
| 2 | The not-claim list, the type sheet (five blocks), captions and alt text | content-manager | 3 d | Step 1 for the demo descriptions; Thomas's answers to questions 1 to 3; the shot list for the caption ids |
| 3 | `tools/shots-product.json`, `npm run shots:product`, the manifest, `--compare` and `--stale` | server-development | 3 d | Step 1 for the real views; can start on travel, which has a demo today |
| 4 | The check for captions, demos and modules; the product sheet check's per-type rule | server-development | 1 d | Steps 2 and 3 |
| 5 | `demos` in `GET /api/product`, and the start page's Try the demo per type | server-development, experience-design | 0.5 d and 1 d | Product-site slice 6's own blockers (the demo flag and nightly reset); not needed for the pictures |
| 6 | The first full run, the by-eye pass at 1280 and 390, defects raised | experience-design | 1 d | Steps 1 and 3 |
| 7 | Read the words, the captions and the demo content against the not-claim list; read the pictures by eye | quality-assurance | 1 d | Steps 2 and 6 |
| 8 | The handover: the folder and the manifest to the website session, and the page brought up to date | project manager, then the website session; Thomas approves the words | the website's own, not counted (I would expect 3 to 5 d) | Steps 2, 6 and 7 |
| 9 | The documentation (the architecture note for the command, the user guide for the demo) | content-manager | 0.5 d | Steps 3 and 5 |

**Total in this repository:** about 11 builder-days (3 + 3 + 1 + 1.5 + 1 + 1 + 0.5), of which about 6 are on the critical path to the first checked set of pictures (steps 3, 4, 6 and 7, with step 2 beside them). The estimate rests on the shots tool already holding the browser, the clock and the settling rules; if the loader cannot be signed in as a demo person without a change, add 1 d to step 3.

## Verify

- **Step 2 and 7:** read by a person against the not-claim list; the product sheet check by tool (every module a type names is on in its template; every claim has a link to a guide that exists). A planted claim of "IEP" or "compliant" is caught by a text search in the check, so the not-claim words are also a short list the check refuses in the sheet, the captions and the demo files. That is a text rule, not a judgement, and it will not catch a claim in other words.
- **Step 3:** by tool: two runs of `shots:product -- --only=travel` give identical images (`--compare`); the manifest's shas match the files; `--stale` reports a changed module version on a faked manifest. Live, on a throwaway server in headless Chromium, which this session cannot run for the other four types until their demo files exist.
- **Step 4:** the check passes on the real files and fails on a caption with no shot, a shot with no caption, a demo file with no template and a shot naming a module the template does not turn on.
- **Step 6:** by eye, Thomas or experience-design, on the first full set: 80 pictures. By tool: none can say a picture is good.
- **Step 5:** by tool, `demos` is empty with no demo flag and lists the flagged environments; live, the button reaches the demo's signed-in Home. A real hosted address across `.com` and `.live` cannot be verified here (product-site, Verify).
- **Cannot be checked without a real LiveKit call:** the call's own screens. The pictures that show the call's controls are drawn with the stand-in and say so in their manifest row.
- **Cannot be checked here at all:** the website's page, its images in its own build and the demo site's public traffic.

## Divergences to record

1. **The brief says experience-design builds the product pages; the product-site plan says the website session does, outside this repository.** This plan follows the product-site plan (decision 4, slice 2) and gives experience-design only the parts that are in this repository. Question 1 offers the other direction. If Thomas wants the pages built here again, product-site decisions 4 and 8, slice 5 (the pages removed) and the `OWN_PALETTE` decision 7 are what it reverses.
2. **[plan-product-pages](plan-product-pages.md)** (superseded) held one page per use at `/travel`, `/games`, `/projects`, a gaming template first, and "Itinerary" as the Planner's name. Its addresses, its pages and its decision 10 (a page exists only while its template is offered) are gone from the code. Its decision 2 ("the Planner's copy is travel-only") is out of date: there are three planners. Its decision 15 (the games word "Campaign") still holds and the games template still uses it.
3. **[plan-product-site](plan-product-site.md), "Screenshots for the website"** names files `planner-1280-light.webp` and describes one tier of `tools/shots.mjs`. This plan names them by type and view (`travel/days-1280-light.png`), writes PNG, and builds the tier as a command of its own over the shots tool. It also puts the demo into the pictures per type, which that plan's travel-only tier did not need.
4. **Product-site decision 5 and slice 6** give `GET /api/product` one `demo`. With a demo per type that becomes a list, `demos`. The "one demo per template later" intent is unchanged; the field's shape changes.
5. **[plan-demo-space](plan-demo-space.md)** describes the games template's Campaign planner as the `travel` module with no trip, Quests as `todo`, and decision 4's games demo with "campaign, sessions, quests, lore, polls, handouts". The games template is now version 6 and its Campaign is `Planner - Projects` (`schedule`); that plan's decision 4, slice 3 and its open question 3 (the games demo's content) read from an older template. Content-manager or product-planner should bring that plan's text up to date when the demos land.
6. **The website's current page** names a Mentoring module (Polls) the template does not turn on, a Planner blurb from before the three planners, "coming soon" on shipped types, no Learning card and two cards (Real estate, Anything imaginable) without a template of their own. These are claims on a page outside this repository; they are listed so the website session can fix them (question 3).
7. **`documentation/TODO.md`'s "Templates redesign" line says "Nothing built yet"** while [plan-templates-redesign](plan-templates-redesign.md) records most of its steps merged. Content-manager's to bring up to date; noted, not changed here.

## What is not decided

### Open questions

Each has a recommendation first.

1. **Who builds the pages, and where do they live?**
   - **A (recommended): the website's page, built by the website session, as the product-site plan decided.** This repository supplies the type sheet, the pictures and the demo list; experience-design builds only the start page's demo entries and judges the pictures. Cost: the pages' schedule is outside this repository's control. Rules out: per-type pages with the app's design system.
   - **B: bring product pages back into this repository,** one per type, for experience-design to build. Cost: reverses product-site decisions 4 and 8 and slice 5, brings back an own-palette exception or the app's design system on marketing pages, and doubles the places the words live (the drift this plan was meant to stop). Rules out: the website being the one product page.
   - **C: the website's page plus a plain "types" page on the wiki** built from the type sheet, so there is a published copy in the repository. Cost: a second copy to keep. Rules out nothing.
2. **One page or one per type?** Blocks the website's work, not the pictures.
   - **A (recommended): the Chameleon page's "What it is for" keeps its cards, now five (Travel, Games, Projects, Learning, Mentoring) plus Anything imaginable, and each card opens its own page** (the type sheet's block, its hero, its gallery of the other views, its planner and modules, its demo). Reason: Learning and Mentoring need their "what it is not" wording close to their claims, a page per type can be linked and printed (as product-pages decision 7 wanted), and the type sheet makes five pages the same work as one. Cost: five pages to keep current.
   - **B: one page, a section per type** with its own anchor (`#travel` and so on). Cheapest and one place to read. Cost: a long page; the not-claim wording is far from its claims; the hero pictures compete.
   - **C: one page with a switch** between types, like the mode switch. Compact. Cost: the content is hidden from search and from a printed page, and it needs script on the website.
3. **Which cards stay?** Learning is new; Real estate has no template; Anything imaginable is the Default template.
   - **A (recommended): five type cards and Anything imaginable (Default); drop Real estate until a template exists,** and fix the Mentoring card to what its template turns on.
   - **B:** keep Real estate as a "coming soon" card. Cost: it advertises something with no template, which the not-claim list rules out.
   - **C:** also hold Learning back until Thomas has decided how to word it, given the scaffolding briefing. Cost: a shipped type is missing from the page. The briefing's own advice is to ship the Goals-based type now and say what it is; that is the recommendation's basis.
4. **One Try the demo or one per type?**
   - **A (recommended): one per type, listed under `#demo`,** each opening its own environment's sign-in. One environment holds one template, so five demo environments exist (product-site decision 5). Cost: five environments to reset nightly (each a run of the reset script).
   - **B:** one demo (travel) and a picture-only tour of the rest. Cost: Thomas asked for a demo of each.
   - **Either way** this waits on product-site slice 6 (the demo flag, the shared login and the nightly reset), so the pictures do not.
5. **Picture format and scale.**
   - **A (recommended): PNG at one scale (1280 and 390 wide), converted by the website's build.** Deterministic; the compare tool needs no encoder.
   - **B:** webp from the tool. Smaller files; needs an encoder or Chromium's webp capture, and the output must be shown stable across runs.
   - **C:** also 2x for the phone shots, for sharp edges on a phone. Doubles those files.
6. **A text refusal in the check for the not-claim words?**
   - **A (recommended): yes, a short list the check refuses in the sheet, captions and demo files.** It catches a slip, not a rewording.
   - **B:** no; reading by quality-assurance only. Cost: a slip is found late.
7. **How much of the call to show?** The recommended answer is none beyond the controls with one person (the stand-in's limit). The alternative is no call picture at all. Thomas may want a real call picture later, taken by hand.

None of these blocks the demos or the first pictures except question 2's effect on the type sheet's shape: the block above holds for every answer.
