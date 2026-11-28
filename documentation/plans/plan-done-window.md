# Done Window Plan

**Audience:** Thomas, who decides; server-development, which builds the window in the pull (`server/issues.js`, `server/index.js`, `server/issue-providers/`, core) and its checks; experience-design, which builds the number in the follow control (core) (the Done paging in `host.ui.board` was not chosen); the Planner - Projects module agent, which builds the module's part in its own lane (`modules/schedule/`, patch bump).

**Status:** Decided in part, 2026-11-28; nothing is built. Thomas decided the window, its length, no Done paging and no window for own plans (decisions 1 to 4 below); the smaller choices were taken on the planner's lean and not asked (decision 5). Thomas, 2026-11-28: "Done will be a big drag over time." Relayed by the project manager with its findings about **Bug Squash**, the Planner - Projects space that follows `Coffee-Pub-Studio/coffee-pub-chameleon` through the GitHub app with writing back on. Read against `main` as code only; the issue counts below were read from GitHub's search API in this session (read only, nothing written).

## Decisions

Thomas, 2026-11-28. The decisions are the contract; the options below are kept as the reasons.

1. **A window on closed work is the fix.** A space that follows GitHub keeps its open issues plus recently closed ones. Older closed issues leave the plan and stay on GitHub, one link away. An Archive view (A2) and a bigger limit (A4) were not chosen. This is option A1.
2. **The window is 30 days, never shorter than the current phase.** This is option D1.
3. **Done is not also paged on the Board now.** This is option B1. Revisit only if Done still feels heavy after the window.
4. **Plans that do not follow GitHub keep all their done work.** The window applies only to a space that follows a repository. This is option F1.
5. **Taken on the planner's lean, not asked:** the number is stored as `keepDays` on the pull record and set in the follow control (E1); the full pull asks twice (C2); there is no count of older issues; a reopened old issue comes back as new open work and loses its own fields; milestone progress counts only the work the plan holds; the Burndown's range starts no earlier than the cutoff; no migration. Thomas may overturn any of them.

## Why

Every issue the repository has ever closed is a piece of work in the Done column, forever. The plan grows by every issue filed, the Board draws all of it, and one day the plan's hard limit stops new issues arriving with only a line in the status bar to say so.

## What it is today

- **The pull asks for every issue, open and closed.** The GitHub adapter's `list` sets `state=all`, `sort=updated`, `direction=asc`, 100 a page, and `since` for the 10-minute pull (`server/issue-providers/github.js`, `makeAdapter`). Pull requests are dropped in `record()`. Once a day (`fullEveryMs`, 24 hours) the pull reads every page with no `since` and no etag (`askIssues(..., { full: true })` in `server/issues.js`), and `writeIssues` in `server/index.js` then removes any stored `plan:gh-<n>` whose number was not in the answer. That sweep is how an issue deleted on GitHub leaves the space ([plan-github-pull](plan-github-pull.md); [plan-github-two-way](plan-github-two-way.md), the Delete row: "an issue gone is removed").
- **Closed is Done.** `columnOf` makes a closed issue `done`; `workOf` sets `end` to the closed day. In a space that writes back, `keepOwn` keeps the stored `start`, `end`, `owners`, `waitsOn`, `rank` and `fields` once the work exists, so there `end` is the space's own day, not the closed day.
- **The hard limit.** `MAX_ENTRIES = 1000` (`server/issues.js:33`, the same as Projects' `maxPlan` in `modules/schedule/src/schedule-lib-file.js`). `writeIssues` counts stored pulled keys (work and milestones, `isPulledKey`); a record not yet stored is skipped once the count reaches 1000, and the pull's `error` becomes `SAY.full`, "This plan holds at most 1000 entries; the rest are not pulled." The records are written oldest number first, so it is the newest issues that are skipped. The "+" new-issue route answers 409 with the same sentence (`server/index.js`, about line 14537).
- **How far off the limit is.** Read from GitHub on 2026-11-28, the repository has 403 issues: 167 open, 236 closed (pull requests are not pulled, so they are not in these counts). 193 were made in the last 30 days and 73 in the last 14 (about 5 to 6 a day); 137 were closed in the last 30 days. At that rate the plan reaches 1000 in roughly three to four months, not weeks. The project manager's "weeks away" counted pull requests, which the pull never stores. The limit is still certain to be reached, and the Done column is already the largest column (236 of 403).
- **The Board.** `host.ui.board` (`public/sdk/host.js`) draws every piece of work it is given; since #1222 it redraws only what changed, but the count still grows. On a phone every done column starts folded ([plan-projects-kanban](plan-projects-kanban.md), decision 8); wide, Done is open unless the person folds it. The List and the Timeline draw done work too. The piece already takes a module's own choices for a column's "..." menu (`columnMenu`).
- **The done day.** Projects stores `doneOn` on work while it is done (`schedule-lib.js`, `scClean`; Planner - Projects 0.1.29), the Burndown's Done line. The pull does not write it yet: [plan-projects-sizing-burndown](plan-projects-sizing-burndown.md) step 5 ("the pull writes `doneOn` from an issue's closed day") is not built.
- **The earlier lean.** [plan-github-pull](plan-github-pull.md), "What a person sees" (taken on the planner's lean, not confirmed by Thomas): "Closed issues are all kept, in Done ... a window ('closed in the last 90 days') is a later setting only if the plan nears its 1000 entries." Its step 4 lists "a window for old closed issues" as later, only if asked. This plan is that window, asked for.

## Earlier decisions this plan stands on

- [plan-github-two-way](plan-github-two-way.md), decision 1 (Thomas, 2026-11-26): Bug Squash is where the work is ranked and moved; "the issues stay on GitHub as the place agents file work and as its history." So GitHub, not the space, is the place old closed issues are kept.
- [plan-projects-sizing-burndown](plan-projects-sizing-burndown.md), decision 2 (Thomas, 2026-11-28): the Burndown's Done line counts from `doneOn`, and pulled work takes it from the closed day. So no window may cut into the period the Burndown draws.
- [plan-projects-kanban](plan-projects-kanban.md), decisions 3 and 8: Done is a flag on a column; on a phone Done starts folded.
- CLAUDE.md, Rules: a drawn piece is built once in the shared SDK; nothing released, so no migration and no alias; a change confined to `modules/schedule/` is module lane, and `server/` and `public/sdk/` are core.

## Options

### A. What to do about old closed work

- **A1. Keep only recently closed issues in the plan (lean).** A pulled issue closed before a cutoff day is not stored, and stored work that ages past it is removed. It stays on GitHub, a link away. Costs: a small server change, one number per follow, and the loss of the space's own fields on work that ages out (see "Reopened"). Gains: the plan holds open issues plus a few weeks of closes, so closed work can never fill the limit, the Board, List and Timeline all shrink with no drawing change, and the daily full pull reads fewer pages. Rules out: browsing old closed work inside Chameleon.
- **A2. An Archive view for older Done, still stored.** Old Done is kept but drawn only in a fourth view. Costs: a new view, and either it still counts toward the limit (so it fixes the drawing, not the limit) or it moves into a second store with its own format, Export and Import rules, which is a second plan in all but name. Not leaned: it duplicates what GitHub already keeps (two-way decision 1).
- **A3. Fold and page Done on the Board only.** Done shows its newest N and "Show 40 more" in `host.ui.board`. Costs: a change to the shared piece. Fixes the Board's clutter, not the List, not the limit. Not enough alone; worth having beside A1 (fork B).
- **A4. Raise the limit.** Only moves the date, and every page that reads the plan (the Board, the List, the Timeline, Export, an agent's read) gets slower as it grows. Not leaned.
- **A5. A1 plus a small index of aged-out issues outside the plan.** The pull keeps `{ number, closed, fields, rank }` for each issue it drops, so a reopened issue gets its own fields back and the page can show a count. Costs: a second store that itself grows forever, and its own rules. Not leaned; the case it serves (reopening an old issue) is rare and GitHub keeps the issue itself.

### B. Done paging on the Board, beside A1

With a 30-day window Bug Squash's Done would hold about 140 pieces of work today (137 closed in the last 30 days).

- **B1. Not now (lean).** A1 alone cuts Done from 236 and rising to about 140 and steady, Done folds with one press and stays folded, and a shorter window (14 days, about 60) is the person's choice. Paging can follow if Done still drags.
- **B2. Page done columns in `host.ui.board`.** A done column draws its newest 50 (by the order the module gives) and a "Show 50 more" button; folding is unchanged. Every board user gets it, own plans included. Costs: a core change to the shared piece and `tools/check-board.mjs`.

### C. Where the window is enforced

- **C1. In the pull's write, plus a local trim (lean, required).** `writeIssues` skips a closed record whose closed day is before the cutoff, and removes it if it is stored (an old closed issue that was commented on comes back in the 10-minute pull's `since` list and must not be stored again). After the records, each pull also removes stored pulled work that is done with a `doneOn` before the cutoff, with no request to GitHub, so work ages out within ten minutes of passing the cutoff, not only at the daily full pull.
- **C2. In the daily full pull's request as well (lean, a second step).** The full pull asks twice: `state=open` with every page, then `state=closed&since=<cutoff>`. An issue closed on or after the cutoff was updated on or after it, so the second list holds every closed issue the window keeps, and a few older ones updated since, which C1 filters. The sweep stays as it is: anything stored that neither list names is removed, which also catches stored work that aged out. Costs: the adapter's `list` takes a `state`, the adapter contract and the test stand-in follow. Gains: GitHub's issues list also returns pull requests (dropped only after they arrive), so today's full pull reads about 13 pages of 100 and grows with every issue and pull request; open ones plus a few weeks of closes is a fraction of that and stays flat as the repository grows, and the old closed ones are never read. C2 without C1 is not enough: the 10-minute pull's `since` list still brings old closed issues that were updated.

### D. The cutoff

- **D1. A number of days per follow, never shorter than the current phase (lean).** The cutoff is the earlier of today minus N days and the start of the space's phase that holds today (when the space has phase dates). N defaults to 30, from 7 to 365. So a phase's closed work is never cut while the phase runs, and a space with no phase dates keeps N days. This is Thomas's floated lean (default tied to the phase length, 30 days as the fallback), with 30 days also as the floor for a short phase.
- **D2. A fixed number of days, no phase.** Simpler; a phase longer than N loses the start of its Done line.
- **D3. From the start of the space's first phase.** Keeps the whole Burndown range, but a long-lived space such as Bug Squash keeps everything, which is today's problem.

### E. Where the number is set

- **E1. On the follow, beside "Changes here go to GitHub" (lean, taken).** A number box in the follow control, stored on the pull's record in `issues.json` (`keepDays`). It shows only in a space that follows a repository, which is the only place it means anything, and the server owns it end to end. Set by whoever may change the follow (the environment's owner, [plan-github-app](plan-github-app.md), section on who may link).
- **E2. A Planner - Projects setting (`number`, space scope).** Template defaults are possible and a moderator could change it, but it would show in every Projects space, where it does nothing, and the server would read a module setting by its key.

### F. Own work (a plan that does not follow GitHub)

- **F1. No window (lean).** A person's own done work exists only in the plan; removing it would delete it. Own plans reach the limit only by people adding 1000 entries by hand or by import, which the module already refuses with its own sentence. If own plans' Done drags, B2 is the answer for them.
- **F2. Hide old done work in own plans, still stored.** A view-only filter; fixes the drawing, not the limit. Not leaned.

## Taken on the planner's lean

Small choices, written down so the build has no gaps; Thomas may overturn any of them.

- **What a person sees.** The status line gains a sentence: "From GitHub, pulled 3 minutes ago, 167 open of 304. Issues closed before 29 October are on GitHub." with "on GitHub" a link (a new tab, no referrer) to the repository's closed issues before the cutoff. A done column's "..." menu gains **Closed earlier, on GitHub** (through `columnMenu`, no change to the shared piece), opening the same link. No count of the older issues: with C2 the pull no longer reads them, and a count would cost a search request a day.
- **The link** is the adapter's to make, so the core stays neutral: `closedBefore(repo, day)` answers `https://github.com/<owner>/<name>/issues?q=is%3Aissue+is%3Aclosed+closed%3A%3C<day>`.
- **The follow control's words.** "Keep closed issues for [30] days" and under it "Older closed issues leave this plan and stay on GitHub. The current phase is always kept."
- **A shorter window** takes effect at the next pull (the local trim). **A longer one** brings older issues back at the next daily full pull; the line says "Older issues come back at the next full pull, within a day." Turning the window off is not offered: with no window the limit is reachable again.
- **Reopened.** An issue reopened on GitHub is updated, so the next 10-minute pull sees it open and stores it as new open work, as a brand-new issue is stored: in the Inbox or its `priority:` label's column, its days the day it was made, its Area from its title (`keepOwn` with nothing stored). Its rank, size, fields, owners and waits from before it aged out are gone. A reopen of work still in the window keeps everything, as today.
- **Moved out of Done in Chameleon.** Only work in the plan can be moved, so only work inside the window; a move out of Done reopens it on GitHub as today.
- **Milestones.** A pulled milestone's progress counts the work the plan holds, so a milestone with old closed work shows less done than GitHub does. A milestone all of whose work aged out leaves with it (`milestonesOf` already removes a milestone no stored work names). Accepted for now; Bug Squash has no milestones.
- **Burndown.** In a space with a window, the Burndown's range starts no earlier than the cutoff, and the words under it add "Work closed before 29 October is not counted." With D1 the current phase is always inside. This replaces, for followed spaces only, the sizing plan's lean that the range runs over all the space's phase dates (a lean, not one of Thomas's decisions). Work that aged out leaves both the total and the Done line, so the line is right from the cutoff on.
- **The pull's done day comes first.** The trim reads `doneOn`, so [plan-projects-sizing-burndown](plan-projects-sizing-burndown.md) step 5 (the pull writes `doneOn` from the closed day and removes it on reopen) is built as part of step 1 here. In a two-way space `doneOn` is GitHub's (the closed day), not one of the space's own fields, even though `end` is.
- **Export and Import.** Export writes what the plan holds, so a followed space's file has the window's closed work only; the single-plan file's 1000 is unchanged. **Update by id** treats an aged-out number as any number not in the space (the builder confirms which sentence it says today and keeps it).
- **Links to aged-out work.** A link from another module's object to work that aged out reads as removed, the same as a link to an issue deleted on GitHub. Accepted.
- **No migration.** Nothing is released. The first pull after the build trims stored closed work that has a `doneOn` before the cutoff; work stored before the pull wrote `doneOn` is caught by the next daily full pull (C2's sweep, or C1 filtering the full list). Nothing is renamed and no old key is read.
- **The limit stays.** 1000, `SAY.full` and the "+" route's 409 are unchanged; the window only makes them unreachable by closed work.

## The contract

### Server (core: `server/issues.js`, `server/index.js`, `server/issue-providers/`)

- **The record.** The pull's record in `issues.json` gains `keepDays` (an integer from 7 to 365, default 30 when absent). `cleanRecord` keeps it. The follow route (the one that turns the pull on, the same that sets `write`) takes `keepDays`; outside 7 to 365 answers 400 "Keep closed issues for 7 to 365 days."; only someone who may change the follow may set it, else 403 as for the follow today.
- **The cutoff.** `cutoffOf(rec, space, today)`, in `server/issues.js`: the earlier of `today - keepDays` and the start of the space's phase that holds today, from the space's phase dates as `public/phases.js` reads them. A `YYYY-MM-DD` day.
- **The done day.** `workOf` writes `doneOn` (the closed day) on closed work and none on open work; `keepOwn` takes `doneOn` from the fresh record, never from what is stored.
- **The write.** In `writeIssues`: a closed record whose closed day is before the cutoff is not written, and is removed if stored (counted in `counts.removed`). After the records, stored pulled work with `done` and a `doneOn` before the cutoff is removed. The full pull's sweep is unchanged. The size count for the limit is taken after the removals.
- **The full pull (step 3).** `askIssues` with `full` asks `list({ state: 'open' })` for every page, then `list({ state: 'closed', since: <cutoff>T00:00:00Z })`, and joins them. The adapter contract (`server/issue-providers/index.js`) gains `state` (`'all'` by default, `'open'`, `'closed'`) and `closedBefore(repo, day)`; `github.js` and the test stand-in follow. The 10-minute pull is unchanged (`state=all`, `since`, the etag).
- **The view.** `issuePullView` answers `keep: { days, from, url }`: `days` the setting, `from` the cutoff day, `url` the adapter's `closedBefore` link; `keep: null` when the pull is off.

### The follow control (core, `public/`, experience-design)

- Under the switch **Changes here go to GitHub**, a number box "Keep closed issues for [30] days" and its line (above). Shown while the space follows a repository, for someone who may change the follow; read only otherwise. Saved through the follow route; a refusal is said in the control's status line. Theme tokens only; the SDK's existing form pieces.

### Planner - Projects (`modules/schedule/`, module lane, patch bump)

- **The status line** (`schedule.js`, the pull's line, about line 326) adds the sentence and the link from `keep` when `keep` is set.
- **A done column's "..." menu**, in a followed space, adds **Closed earlier, on GitHub**, opening `keep.url` in a new tab.
- **The Burndown view** (when built, [plan-projects-sizing-burndown](plan-projects-sizing-burndown.md) step 4): with `keep`, `from` is no earlier than `keep.from` and the words add the sentence above.
- Nothing stored changes in the module: `doneOn` is already kept by `scClean`.

### The shared Board piece (core; not built, by decision 3)

Kept only in case Done still feels heavy after the window.

- `host.ui.board` takes `doneLimit` (a number, default none): a done column draws its first `doneLimit` cards and a **Show N more** button that draws the next `doneLimit`; the count in the heading stays the whole column's; a fold is unchanged; keyboard moves reach only drawn cards. `tools/check-board.mjs` covers it.

## Left to build, in order

1. **The window in the pull** (server-development; core; medium). `doneOn` from the closed day (sizing plan step 5, folded in), `keepDays` on the record and the follow route, `cutoffOf`, the skip and the removal in `writeIssues`, the local trim, `keep` in the view. Tests in `tools/check-issues.mjs`.
2. **The number in the follow control** (experience-design; core; small). Needs 1.
3. **The full pull asks open, then closed since the cutoff** (server-development; core; small). The adapter's `state`, `closedBefore`, the contract, the stand-in. Can run beside 2.
4. **The status line and the Done column's link** (the Planner - Projects module agent; module lane; patch bump). Needs 1's `keep` in the view.
5. **The Burndown's range** (the Planner - Projects module agent; module lane; patch bump). Part of sizing plan step 4 if that is not built yet, else its own small change.
6. **Done paging in `host.ui.board`** (experience-design; core). Not built, by decision 3. Revisit only if Done still feels heavy after the window.

## Verify

- Step 1: `node tools/check-issues.mjs` with the test stand-in: a closed record before the cutoff is not stored; a stored one is removed when its record comes back closed before the cutoff; stored done work whose `doneOn` passes the cutoff is removed with no request; a reopened old issue comes back as new open work; the current phase's start wins over `keepDays` when earlier; `doneOn` set on close and cleared on reopen, also in a two-way space where `end` is kept; the limit counted after removals; `keepDays` outside 7 to 365 refused with 400.
- Step 2: live on a local server in headless Chromium at 1280 and 390, light and dark, against the stand-in (`ISSUES_TEST_STANDIN`).
- Step 3: `node tools/check-issues.mjs`: the full pull's two lists, the sweep removing work neither names, the page count.
- Steps 4 and 5: `npm run check:module -- schedule`, then live on a local server against the stand-in.
- Step 6: not built; if it is ever built, `node tools/check-board.mjs`.
- Not checkable here: a real pull from `api.github.com` (GitHub's real `since` behaviour on `state=closed` and its closed search link), seen only on Thomas's server once Bug Squash pulls with the window. Nothing here needs a LiveKit call; the canvas inside a call is read as code only.

## Risks

- **Own fields lost on age-out.** A rank, size, Area or owner set on work is gone once it ages out, and does not come back on reopen. A5 would keep them; not leaned.
- **Open issues still fill the limit.** The window stops closed work reaching 1000; 1000 open issues would still reach it. Today there are 167.
- **`since` is by update, not by close.** The closed list with `since=<cutoff>` is a superset of what the window keeps; correctness rests on C1's filter by the closed day, which step 1's tests cover.
- **Milestone progress** reads lower than GitHub's while some of a milestone's work has aged out.
- **A phase with no end** or overlapping phases: `cutoffOf` takes the earliest start of a phase that holds today; the builder confirms against `public/phases.js`.

## Open questions

None. All four questions are decided (decisions 1 to 4), and none blocks the build. The small choices in decision 5 were taken on the planner's lean and not asked.
