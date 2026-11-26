# GitHub Two-Way Plan

**Audience:** Thomas decides whether a space that follows a GitHub repository may also change it, what may flow back, as whom, and whether the GitHub project board is then switched off. server-development builds the write-through, its adapter calls and the checks, and removes the board's workflows; experience-design builds the Planner - Projects side and the board's order; content-manager documents what lands.

**Status:** Decided by Thomas, 2026-11-26 (the five choices, under Decisions); nothing built. Thomas, 2026-11-26, after the one-way pull ([plan-github-pull](plan-github-pull.md)) worked on his server for `Drowbe/coffee-pub-chameleon`: "How do we get to two-way sync?" Later the same day he added the goal: "I would love to kill the github project and work out of my own tool." So the end state of this plan is that the **Bug Squash** space is where Thomas ranks and moves the work, the GitHub project board (`users/Drowbe/projects/8`) and its four workflows are gone, and the issues stay on GitHub as the place agents file work and as its history. Thomas answered the five foundational choices the same day (Decisions, below); every other choice is the planner's lean, taken under his standing rule (CLAUDE.md, "Decisions stick") and marked "taken". Read against `main` at `2f767d31` as code only: nothing was run, and no request of any kind was made to GitHub. GitHub's write endpoints and their limits are described from the planner's knowledge of GitHub's REST documentation, not re-read in this session; under Thomas's rule (a service's terms are read before its adapter is written) server-development re-reads those pages before step 1 and corrects this plan where they differ.

**The author, from now on: a GitHub App** (Thomas, 2026-11-26). The server-wide token and allow list of decision 2 and section 3 suit one person only; Thomas decided that Chameleon is registered once as a GitHub App that each repository's owner installs, and changes show as the app. That is planned in [plan-github-app](plan-github-app.md), a draft. Once Thomas approves it, it supersedes decision 2 ("Thomas's own token now, a GitHub App later") and section 3 here, and `ISSUES_GITHUB_TOKEN` and `ISSUES_GITHUB_WRITE` are replaced as that plan says; the rest of this plan stands.

## What it is today

- **The pull** (`server/issues.js`, `server/issue-providers/`, the routes and the timer in `server/index.js` under "the issue pull"). One way, GitHub to the space. Every 10 minutes `GET /repos/{owner}/{repo}/issues?state=all&since=<last>&sort=updated` with the last etag (a 304 costs nothing with a token), and a full pull once a day to find what is gone. Each issue is work under `plan:gh-<number>`, written by the fixed writer `system:issues` through `putModuleValue` with an owner's module rights (`issuePullWho`), skipped when the value would not change (`sameValue`). The mapping is `workOf`: `column` from `priority: now|next|later` (closed is `done`, any other open issue `inbox`), `title` cut to 120 characters with an ellipsis, other labels as tags (added to the space's `tags` setting while it has room, past 20 named in `notes`), `notes` the link, the milestone and spare labels, `start` the day it was made and `end` the day it closed, `source: { from, repo, number, url }`. GitHub milestones become `plan:ghm-<number>`. Nothing personal is read: no logins, assignees, authors, bodies or comments.
- **Read-only while the pull is on.** `pulledRefusal` (`server/index.js`) refuses any writer other than the pull on a `plan:` or `board:` key, and Clear, with 403 "This comes from GitHub. Change it there." It is called from `putModuleValue` (so the page's `PUT /api/modules/:id/data/:key` and the agent actions' writes), the delete path (`server/delete-path.js`) and Clear and its Undo. Planner - Projects draws pulled work read-only (`locked` in `schedule.js`; `SC_PULLED_SAY` in `schedule-lib.js`) with `#<number>` and **Open on GitHub**. A pulled space owns its plan: the pull turns on only into an empty plan, and nobody adds work by hand.
- **The token.** `ISSUES_GITHUB_TOKEN`, optional, read by the server only when a pull asks, sent only in the `Authorization` header to `https://api.github.com`. Today it needs only **Issues: read**; the repository is public, so it also works without one.
- **The board in Chameleon** ([plan-projects-kanban](plan-projects-kanban.md)). `scSetColumn` sets `column` and `done` together; `setColumn`, `setDone` and `updateEntry` are agent actions run on the server (`modules/schedule/src/schedule-lib-actions.js`). **Order inside a column is not stored** (a lean taken in that plan, not one of Thomas's decisions): cards are ordered by end day, then their place in the outline, and a drop places a card by column only.
- **The GitHub project board and its workflows.** All four use the repository secret `PROJECT_TOKEN` (a classic token with the `project` scope, because fine-grained tokens cannot reach a project owned by a user) and the variables `PROJECT_OWNER`, `PROJECT_NUMBER` and `PROJECT_FIELD`:
  - `.github/workflows/project-priority.yml`: a `priority:` label added moves the card on the board, and keeps one priority label. Checked by `tools/check-project-status.mjs`.
  - `.github/workflows/project-done.yml`: an issue closed moves its card to Done; by hand it sweeps the board.
  - `.github/workflows/project-priority-sync.yml`: hourly at minute 17 and on demand, the labels follow the board (Now, Next, Later set one label; Inbox clears it; Done is left alone), then it reports **the board's order** inside Now, Next and Later as notices ("Now: #157, #165, #160"). `documentation/TODO.md` says "The board is the source of truth for priority: Thomas drags the cards" and "The managing session reads that order before planning work." Checked by `tools/check-project-sync.mjs`.
  - `.github/workflows/project-roadmap-sync.yml` with `tools/roadmap-board-sync.mjs` and `.github/roadmap-board.csv` (about 150 rows): daily and on a change of the file, it sets the board-only fields **Area**, **Release status**, **Phase**, **Start date** and **Target date**. Checked by `tools/check-roadmap-board-sync.mjs`; never run against the real project (TODO.md).
  - The four checks are in `npm run check` in `package.json`; the setup is in `documentation/TODO.md` ("How issues are tracked", "Board setup (once)"); `.claude/agents/project-manager.md` tells the overnight session to work from the `priority: now` label.
- **What two masters do today.** A drag on the GitHub board reaches the labels within the hour, then the space within 10 minutes. With two-way on and the hourly sync still running, a move in Chameleon changes the label, `project-priority.yml` (fired by a label added with a personal token, which does start workflows) moves the card to match, and all is well; but if that run fails or the label is removed rather than added (Inbox), the next hourly sync puts the label back to the board's column and the move is undone. The board and Chameleon cannot both be where priority is decided. That is why the end state below has one place. Until Chameleon writes the labels, though, the hourly sync is Thomas's only way to move a column (he drags on GitHub), so it is switched off right after the step that lets Chameleon write them, not before (step 3).

## Decisions

Thomas, 2026-11-26, answering the five questions this plan put to him. They replace the pull plan's unconfirmed lean "one-way only, two-way not planned".

1. **The end state: work from Bug Squash, delete the GitHub board.** Bug Squash is where priority and order are decided; the issues stay on GitHub; the GitHub project board and its workflows are deleted once two-way is proven. Reason: he wants to "kill the github project and work out of my own tool", and two places deciding priority cannot both be right.
2. **The author is Thomas's own fine-grained token now**: `ISSUES_GITHUB_TOKEN` with **Issues: read and write** on the one repository, so every change shows on GitHub as Thomas. A GitHub App later, if other people come to write. The planner's lean, accepted. To be superseded by [plan-github-app](plan-github-app.md) once approved (Thomas chose the GitHub App, 2026-11-26).
3. **What flows back**: the column (the `priority:` labels), Done (close and reopen), the title, tags as labels and new issues; not the body, comments, assignees or delete. Days, owners and order stay the space's own. The planner's lean, accepted as listed.
4. **Writes are sent at once, with no queue, and GitHub wins a conflict on the same field**, with one line saying why. The planner's lean, accepted.
5. **Carry all the roadmap fields**: Area, Release status, Phase, Start date and Target date all move into the space before the board is removed (not the planner's lean, which dropped Release status). Reason: nothing the board holds is lost with it.

Thomas's standing rules bind every option: never a paid service or one whose free tier forbids commercial use, its terms read first (Thomas, 2026-11-25; GitHub's were read for the pull and pass); a token is a secret in an environment variable, never in chat, a log, a page or a space's data; the server makes the calls and only what is needed leaves it; the product is unreleased, so no compatibility layers or migrations; the Names in CLAUDE.md.

## The shape, with the leans

### 1. What flows each way

Each field of pulled work falls into one of three kinds. The pull already knows the first column; two-way adds the other two.

| Field | GitHub to the space (today) | The space to GitHub (lean) | Kind |
|---|---|---|---|
| Column (Inbox, Now, Next, Later) | from the `priority:` labels | remove the old `priority:` label, add the new one; Inbox removes it | both ways |
| Done | closed is Done | moved into Done: close, `state_reason: completed`; moved out of Done: reopen, then the column's label | both ways |
| Title | cut to 120 characters | `PATCH` the title; refused when GitHub's title was longer than 120 ("This title is longer than the plan holds. Change it on GitHub."), so a cut title is never written back | both ways |
| Tags | from the other labels | add or remove that label; a tag no label has is refused ("GitHub has no label called ...") | both ways |
| A new object | an issue opened appears | **+** in a column opens an issue with the title and that column's label, empty body | both ways |
| Area, Release status, Phase | not on GitHub's issues (today on the GitHub board) | not sent; stored fields in the space (decision 5) | the space's own |
| Order inside a column | not on GitHub's issues | not sent (labels cannot carry it) | the space's own |
| Start and end days | made and closed days | not sent; GitHub issues have no dates | today GitHub's; see below |
| Who is doing it (`owners`) | not pulled | not sent | the space's own |
| Description (`notes`) | the link, milestone and spare labels | not sent; the body is not pulled | GitHub's, read-only |
| Number, link, milestone | from the issue | not sent | GitHub's, read-only |
| Comments | not pulled | not sent | neither |
| Assignees | not pulled | not sent | neither |
| Delete | an issue gone is removed | not offered: GitHub's REST API cannot delete an issue, and GraphQL's `deleteIssue` needs the repository's admin; the menu offers **Close** instead ("GitHub issues can't be deleted from here. Close it, or delete it on GitHub.") | neither |

- *Description, two-way* (not leaned): pulling the body into `notes` and writing it back means bodies (often longer than the 2000 characters `notes` holds, so a write-back would cut them) and the personal information they may carry come into the space. Lean: no; the body stays GitHub's, opened with **Open on GitHub**.
- *Comments and assignees*: logins are personal information under GitHub's Acceptable Use Policies, and nothing links a member to a GitHub login. Lean: neither way.
- *Days* (taken): a space's own fields are kept by the pull. In a two-way space the pull writes `start` and `end` only when it first makes the work (both the day the issue was made); after that the days are the space's own (the roadmap's Start date and Target date, below), and the next pull keeps them, closed or not. `datesRequired` stays as it is. Pulled work can then be "Late" like any other: the page's rule that pulled work is never late (`pageLate` in `schedule.js`) applies only to a space that is pulled one way.
- *New object's title* (taken): not forced into the "Area: title" shape (that is a rule for agents filing issues, CLAUDE.md); the editor's hint reads "Area: what is wrong".

### 2. Who GitHub sees as the author

A write token acts as the account that made it; GitHub shows that account on every label change, close and new issue.

- **(a) Thomas's own fine-grained token** (lean). One token, everything shows as Thomas. No new account, nothing to install. Every member who may write through acts as Thomas on GitHub; Chameleon keeps its own record of who did it (`by` on the work, the agent's review list). Writes with a personal token start workflows (unlike `GITHUB_TOKEN`), which matters only while the board's workflows still run.
- **(b) A machine account** (a second GitHub account owned by Thomas, invited to the repository; the Terms allow one free machine account per person). Writes show as that account, so GitHub's history tells Chameleon's changes from Thomas's own. Costs a second account and its token to renew.
- **(c) A GitHub App** installed on the repository: writes show as "<app>[bot]", its permission is exactly Issues: write on the chosen repositories, and its installation tokens last an hour, so nothing long-lived but the app's private key. Free. Costs the most to build: the private key in an environment variable, a signed request to mint each token, and an App to register.
- **(d) Each person's own GitHub account** (OAuth, a GitHub App's user tokens; the device flow needs no address GitHub can reach). The only way GitHub shows who really did it. Costs: a link between a member and a GitHub login (personal information to keep and secure), a per-person token sealed on the server as the external calendar addresses are, a Connect and Disconnect on the profile, and members without a GitHub account cannot move work. It also means a person with no rights on the repository is refused by GitHub, not by Chameleon.

Decided (decision 2): (a) now, (c) if other people come to write through. (d) is not planned.

### 3. The token

- *Where* (taken): the environment variable that exists, `ISSUES_GITHUB_TOKEN`, now made as a fine-grained token with **Issues: read and write** on the one repository (**Metadata: read** comes with it). No second variable: the token's own permissions decide what it can do, and a space that is only pulled never writes. Never per space: a space's data and settings are readable by its owner and moderators and travel in an environment's export, and the rule says a token never lives there. Not a module `secret` setting either, since that is environment-wide but set by an owner through the page, which is exactly where the rule says a token does not go.
- *Which repositories may be written* (taken): a host has one token but may have several environments, and the repository is public, so any owner on the host could follow it. A second variable, `ISSUES_GITHUB_WRITE`, lists the repositories writes may go to (`owner/name`, comma separated; on a host with environments each as `<environment slug>:owner/name`). Unset means no space on the host writes. A single-environment install without it behaves exactly as today.
- *Never* in chat, a log line, an answer, a page, a space's data, `issues.json` or an export. A refused write logs the status and the issue number, never the header. Expiry: GitHub makes a fine-grained token expire; renewing it is Thomas's, and an expired token shows as "GitHub refused the token set on this server." (`SAY.token`, today's sentence).

### 4. The columns: labels, not GitHub's project board

- **(a) Labels** (lean). A move writes the `priority:` labels with Issues: write. Works with a fine-grained token on one repository. Order inside a column cannot be carried.
- **(b) The project board through GraphQL** (Projects v2: `updateProjectV2ItemFieldValue` for the column, `updateProjectV2ItemPosition` for the order). Carries the order, but needs a classic token with the `project` scope (fine-grained tokens cannot reach a user's project), keeps the board alive, and is the opposite of the goal.

Lean: (a). It is what makes retiring the board possible. Taken, since (b) contradicts Thomas's stated goal.

### 5. Writing: at once, or queued

- **(a) At once** (lean). A change to pulled work is sent to GitHub while the request waits (at most 6 seconds per call, as reads). Only when GitHub accepts it is the work written in the space, mapped from GitHub's own answer. The page draws the move at once and puts it back, with the reason, if it is refused. Nothing is held to send later, so there is nothing to lose on a restart and no "not sent yet" state.
- **(b) Queued.** The space changes at once; an outbox per space (`issues.json`) sends in order and retries with growing waits; each pending piece of work is marked "Not on GitHub yet". Works through an outage, but needs the outbox, a retry rule, a mark, and conflict rules for a change that waits hours.
- **(c) Local first, one try, put back on failure.** (a)'s cost with (b)'s flicker.

Decided (decision 4): (a).

*When GitHub does not answer or refuses* (taken, follows from (a)): nothing changes in the space, and the person reads one line: "GitHub did not answer. Nothing was changed; try again." (no answer or a timeout), "GitHub asked to wait. Try again in 3 minutes." (403 or 429 with a wait, which also rests the pull as today), "GitHub refused the token set on this server." (401), "GitHub refused the change: <its message, cut to one line>." (422), "This server may not change GitHub for this repository." (not in `ISSUES_GITHUB_WRITE`; checked before anything is sent).

### 6. Conflicts

Both sides changed the same issue since the space last pulled it.

- **(a) Last write wins.** Whatever is sent last stands. Simple; a drag in Chameleon can silently undo a close on GitHub made a minute before.
- **(b) GitHub wins on the same field** (lean). Before a write the server asks for that one issue (`GET /repos/{owner}/{repo}/issues/{number}` with its etag; a 304 costs nothing with a token). If the issue changed on GitHub since the person's copy (its `updated` is newer than the work's `source.updated`) **and** the field being changed differs from what the space last saw, the write is refused, the work is updated from GitHub's answer, and the person reads "This changed on GitHub a moment ago. It now shows GitHub's version." If GitHub changed only other fields, the write goes ahead. Labels are added and removed one by one (never the whole set replaced), so a label someone added on GitHub meanwhile is not wiped.
- **(c) Refuse on any change.** Safest and the most annoying: any edit on GitHub, even a new label, refuses the next move.

Decided (decision 4): (b).

### 7. Loops and echoes

- *Our own write coming back* (taken). After GitHub accepts a write, its answer (the whole issue) is mapped through `workOf` and written, with `source.updated` set to the answer's `updated_at`. The next pull returns the same issue (its `updated_at` changed), maps it to the same value, and `sameValue` skips the write. No echo needs a list of "our" changes.
- *A pull already under way* (taken). A pull started before the write can carry the old issue. Rule: the pull never writes an issue whose `updated` is older than the work's `source.updated`. That needs `source.updated` kept by `scCleanSource` (`modules/schedule/src/schedule-lib.js`) and `FORMAT.md`.
- *Writes and pulls* (taken). Writes take their own lane, ahead of the timer's pulls, one at a time across the server (GitHub asks for one request at a time and a pause between writes); a person's write does not wait behind a twelve-page full pull.
- *GitHub's workflows* (taken). While `project-priority.yml` still runs, a label Chameleon adds starts it (a personal token's events do) and it moves the card to match; it never fires back into Chameleon. `project-priority-sync.yml` is the loop that matters (the board overwriting the labels) and its schedule is switched off right after Chameleon can write the labels and before Thomas turns writing on (step 3); until then it is his only way to move a column.

### 8. Rate limits and etags on writes

- The read limits are as the pull plan records: 5,000 requests an hour with a token; a 304 on a conditional request does not count.
- Writes, as recalled (to be re-read): each write is a "mutative" request that costs more of the per-minute secondary limit than a read; content-making requests (a new issue) have their own per-minute and per-hour caps; GitHub asks for a pause of about a second between writes. A move is up to three calls (the conditional read, remove a label, add a label); a close is two. One person dragging is far under every cap.
- Conditional requests do not apply to writes; the etag is used only on the read before a write. GitHub's issue endpoints do not take `If-Match`, so (6b) narrows the window to the time between the read and the write and does not close it.
- A 403 or 429 on a write rests the whole repository (writes and pulls) until `retry-after` or `x-ratelimit-reset`, as a pull's does now (`restUntil`).

### 9. The read-only rule, lifted per field

Taken. Today `pulledRefusal` answers 403 for every write to a `plan:` or `board:` key while the pull is on. In a space where writing through is on (a new `write` flag on the pull's record, set by the owner beside **Follow this repository**):

- A write to `plan:gh-<n>` goes to the write-through first. The server compares the new value with the stored one, field by field: column and done, title and tags are sent to GitHub (section 1); the space's own fields (`owners`, `start`, `end` within the days rule, and the order) are written in the space only; a change to any GitHub-only field (`notes`, `source`, `kind`, `parent`, `id`) is refused with "This comes from GitHub. Change it there." as today.
- A new piece of work in a two-way space is made only through the new-issue route; the plain data write of a new `plan:` key stays refused.
- `board:main` stays the pull's (the five columns), and Delete and Clear stay refused.
- With writing through off, everything is as today.

### 10. Who may write through

- **(a) Anyone with `edit`** on the plan (members by default). The simplest, and every member then acts on GitHub as the token's owner.
- **(b) A new module permission, `writeOut`**, "Change it on GitHub" in the words the page shows: moderator yes, member no, guest no; owners always (lean). Someone with `edit` but not `writeOut` sees pulled work read-only, as today.
- **(c) Owner only.**

Lean: (b), taken: the write acts under one person's GitHub name, so it should be a right someone gives on purpose. An agent is a member narrowed by its gate, so it needs `writeOut` given to it as well as the action allowed in the agent matrix.

### 11. Agents

Taken. `setColumn`, `setDone` and `updateEntry` on pulled work go through the write-through as a person's do, with the same answers; `addWork` in a two-way space makes an issue; `deleteEntry` stays refused. The agent's change shows under **What it changed**, and its **Undo** is another write-through (a close undone is a reopen). The refusals, each a 403 unless said:

- writing through is off in the space: "This comes from GitHub. Change it there." (unchanged)
- the agent lacks `writeOut`: "Only someone allowed to change GitHub can change this."
- a GitHub-only field: "This comes from GitHub. Change it there."
- a cut title: "This title is longer than the plan holds. Change it on GitHub."
- a delete: "GitHub issues can't be deleted from here. Close it, or delete it on GitHub."
- a conflict: 409 "This changed on GitHub a moment ago. It now shows GitHub's version."
- GitHub's own refusal or silence: 502 with the sentences in section 5.

An agent's writes count against its daily limit as now; each also costs GitHub calls under the server's token, so the agent's limit is also the guard against an agent draining GitHub's.

### 12. Webhooks

Skipped, as in the pull plan: they need an address GitHub can reach, which a self-hosted server behind a home connection often lacks. Without them, an issue an agent files on GitHub appears within 10 minutes, or at once with **Pull now**. Lean: keep the 10 minutes.

### 13. What Chameleon sends to GitHub

Only, and only for the repository the space follows and `ISSUES_GITHUB_WRITE` allows: the issue's number, a new title, `state` and `state_reason`, the names of labels to add or remove (the three `priority:` labels and labels the repository already has), and for a new issue its title and one label. The body of a new issue is empty. Never: a member's name or login, who made the change, the space's or environment's name, the work's notes, days, owners, order, roadmap fields (Area, Release status, Phase) or milestone, any other object, or anything from another module. `tools/check-issues.mjs` holds this by recording every request the stand-in receives.

## Switching the GitHub project board off

Thomas's goal: "kill the github project and work out of my own tool."

### What must work two-way first

1. **Moving a card**: Inbox, Now, Next, Later through the `priority:` labels (section 1). This is what the hourly sync carries today.
2. **Done and back**: close on Done, reopen out of it. `project-done.yml` does the GitHub half today; an issue closed by a merged pull request's "Fixes #n" still closes on GitHub and arrives in Done by the pull.
3. **Order inside a column**, which labels cannot carry. Today it lives only on the GitHub board, and the managing session reads it from the hourly sync's notices before planning. To switch the board off, the order must live in Chameleon and the managing session must read it there.
   - *Where*: a stored `rank` on work (a short sortable string, so a move between two cards writes one value), the space's own (section 1). `host.ui.board` (core) gains a drop position and Up and Down moves inside a column (**Alt+Up**, **Alt+Down**; the card menu's **Move up**, **Move down**); `setColumn` gains an optional `before` (a work id). This overturns the kanban plan's lean "order inside a column is not stored", which was a lean, not Thomas's decision. New work arrives at the bottom of its column.
   - *How the managing session reads it*: through its agent account in Chameleon (the plan read in column and rank order), not GitHub. That changes `.claude/agents/project-manager.md` ("work only from the issues in the now column ... in priority order") and the TODO's "How issues are tracked"; those edits are the project manager's and content-manager's, named here so they are not forgotten.
4. **Editing the title** and **tags as labels**, so nothing needs the GitHub page for everyday triage.
5. **A new object** from the board's **+**, since the GitHub board's "Add item" goes away.

### What cannot be matched, and what Thomas would lose

- **The order, on GitHub.** Anyone looking only at GitHub sees issues and labels, never the ranking.
- **The roadmap fields** are not lost: they move into the space (decision 5; "The roadmap fields in the space", below). What is lost is only that GitHub itself no longer shows them.
- **GitHub's board views**: its table and roadmap layouts, its filters by field, and the board on GitHub's phone app. Chameleon has the Board, List and Timeline, rows by milestone or person and filters, and works on a phone browser.
- **Draft items** on the board that are not issues: none are synced today; any that exist are lost unless made into issues first.
- **Pull requests on the board**: the pull skips pull requests, so they are not on the Chameleon board.

### What stays on GitHub

The issues, their labels (including `priority:`), milestones, bodies, comments and history. They stay where agents file work (CLAUDE.md's area-and-colon rule is unchanged), where pull requests link and close them, and where the history lives. `ISSUES_GITHUB_TOKEN` stays; `PROJECT_TOKEN` goes.

### The roadmap fields in the space

Decision 5: Area, Release status, Phase, Start date and Target date are all carried. Where each lives is the planner's lean, taken.

- **Start date and Target date are the work's own `start` and `end`.** They exist on every piece of work already, the Timeline draws them and the List shows them. In a two-way space they are the space's own (the days rule in section 1), so the pull keeps them.
- **Area, Release status and Phase are stored fields on the work, not tags** (taken). A new kind of record in Projects, a field: `field:<id>`, `{ id, label, options: [{ id, label }] }`, one choice each, the same shape as a board's columns; work gains `fields: { <fieldId>: <optionId> }`. Not tags, for three reasons: in a two-way space tags *are* GitHub labels (section 1), so an Area tag would be written to GitHub as a label; the `tags` setting holds 20 rows, and Area alone has 22 values (CLAUDE.md's areas) on top of the 12 labels the pull already brings; and a tag cannot say "exactly one", which a phase is.
  - *Limits* (taken): at most 8 fields, 30 options each, a label of at most 40 characters ("After first release (Thomas, 2026-11-15)" is 40). The ids follow the column id rule; the fields here are `area`, `release` and `phase`.
  - *Who* (taken): defining a field or its options needs `columns` (it is the board's shape, as the columns are; a `guards.keys` rule on `field:` as on `board:`), and the permission's label becomes "Change the board's columns and fields". Setting a value needs `edit` only: it never reaches GitHub, so `writeOut` is not needed.
  - *Shown* (taken): the work editor has a choice for each field; a card shows Phase and Area in quieter words under the title; the List shows them in a column each. The Board's filters gain one per field (the person's own, as the kanban plan's filters are), and `rowsBy` gains `"field:<id>"`, so the Board can have a row per Phase.
  - *Sent nowhere*: the fields are the space's own and never go to GitHub (section 13).
  - *Area on new issues* (taken): when the pull first makes work and the title starts with an area and a colon that names one of the Area field's options, `area` is set from it. After that it is the space's own.
  - *Release status* is carried as it stands. The CSV marks "Gating (proposed ...)" as the project manager's proposal until Thomas confirms the gating table ([plan-release](plan-release.md)); moving it into the space does not confirm it.
  - *Agents*: `updateEntry` gains `fields` (by option id, checked against the field's options), so the project manager can set Phase and Area through its agent account; `addWork` may carry them too.
  - *The file format*: `FORMAT.md` and `project-plan.schema.json` gain the `fields` list and each entry's `fields`; the format stays version 1 (nothing released).
- **The one import** (taken). The CSV is read once and never again:
  - `tools/roadmap-to-plan.mjs` (one-time, deleted in the removal step with the CSV) reads `.github/roadmap-board.csv` and writes a `project-plan` file: the three fields with their options (from the values in the file, in the order the CSV's header comment and Phase numbers give), and one entry per row, id `gh-<Issue>`, carrying only `fields`, `start` and `end` (an empty cell writes nothing). Rows for closed issues, pull requests or numbers not in the space are listed and skipped.
  - Planner - Projects' import gains a third way beside **Add to the plan** and **Replace the plan**: **Update by id**. For each entry in the file whose id is in the plan it sets only the fields the file carries that the space owns (`fields`, `start`, `end`, and later `owners` or `rank`), never the title, column or anything GitHub's; the field definitions are added or merged by id. It is refused for someone without `columns` when the file defines fields, and it has **Undo** as the others do. This stays after the import: it is how a plan's own fields are set in bulk, pulled or not.
  - Thomas (or the project manager, with his say) runs the tool, checks the file with **Check file**, and imports it into Bug Squash with **Update by id** once. From then on the fields are changed in Chameleon.

### The order of steps to get there

Written into "Left to build" below. The hourly board-to-labels sync keeps running while Chameleon cannot yet write the labels, because until then it is Thomas's only way to move a column (he drags on GitHub). Build the writes (steps 1 and 2); switch the sync's schedule off right after step 2, before Thomas turns writing on for Bug Squash (step 3); the agents' side (step 4); the order inside a column (step 5); the roadmap fields and the one import (steps 6 and 7); Thomas works from Bug Squash with the board still visible (step 8); then remove the board and everything that feeds it in one clean step (step 9), which needs steps 5 to 7 done and two-way proven.

### Removing the board cleanly

One try build, no compatibility layer, nothing left switched off "just in case" (the product rule). It starts only when the order (step 5), the fields (step 6) and the import (step 7) are done and Thomas says two-way is proven on his server (decision 1; taken: "proven" is his word after step 8, not a count of days):

- Delete `.github/workflows/project-priority-sync.yml`, `project-priority.yml`, `project-done.yml` and `project-roadmap-sync.yml`.
- Delete `tools/check-project-sync.mjs`, `tools/check-project-status.mjs`, `tools/check-roadmap-board-sync.mjs`, `tools/roadmap-board-sync.mjs`, the one-time `tools/roadmap-to-plan.mjs` and `.github/roadmap-board.csv` (its data now lives in Bug Squash), and their entries in `package.json`'s `check` script. Also `tools/issues-to-plan.mjs` and `tools/check-issues-to-plan.mjs`, which the pull plan already said to remove.
- Any reference left is found with a search for `PROJECT_TOKEN`, `PROJECT_OWNER`, `project-priority`, `project-done`, `roadmap-board` and `check-project-` across the repository, and removed (the documentation by content-manager: `documentation/TODO.md`'s "How issues are tracked" and "Board setup (once)", the architecture and plan pages that name them).
- Thomas's, outside the repository: delete the secret `PROJECT_TOKEN` and the variables `PROJECT_OWNER`, `PROJECT_NUMBER`, `PROJECT_FIELD`; revoke the classic token on GitHub; close or delete project 8.
- The `priority:` labels stay; they are now written by Chameleon.

## The contract

### Server (server-development)

- **The adapter** (`server/issue-providers/index.js`, `github.js`). The contract gains, as optional members an adapter may have: `get({ repo, number, etag, token }, ask)` (one issue, conditional), `update({ repo, number, title?, state?, stateReason?, token }, ask)`, `addLabels({ repo, number, labels, token }, ask)`, `removeLabel({ repo, number, label, token }, ask)` and `create({ repo, title, labels, token }, ask)`, each answering `{ status, record?, wait, message? }` with the neutral record (section "A record" of `index.js`) from GitHub's answer. `ask` is the core's: the pull's `getter` grown to take a method and a JSON body, still only the adapter's origin, 6 seconds, 2 MB, no redirect for a write. An adapter without them cannot be written through.
- **The stand-in** (`test-standin.js`, only under `ISSUES_TEST_STANDIN`) gains the same writes on its fixture, records every request (method, path, body, headers without the token), and can be told to answer 401, 403 with a wait, 422, 429, a timeout, or a changed issue between a read and a write.
- **The record** (`issues.json`, `cleanRecord`): gains `write` (boolean), and `by` and `at` for who turned writing on. Nothing else; no outbox (section 5a).
- **The rules**: `ISSUES_GITHUB_WRITE` read at start (`owner/name` list, or `<slug>:owner/name` on a host with environments); `pulledRefusal` grows the per-field rule of section 9; the write lane ahead of pulls; the pull's "never older than `source.updated`" rule and the days rule (section 1).
- **Routes**:
  - `PUT /api/spaces/:id/issues-pull` takes `write: true|false` as well (the environment's owner, not an agent). Turning it on: 409 "This server may not change GitHub for this repository." when `ISSUES_GITHUB_WRITE` does not allow it; 409 "No token is set on this server." when `ISSUES_GITHUB_TOKEN` is empty. The `GET` answer gains `write` and `canWrite` (whether the server allows it for this repository; never the token).
  - The page's ordinary write, `PUT /api/modules/:id/data/:key`, on `plan:gh-<n>` in a two-way space, awaits the write-through and answers as section 9 and section 5 say (200 with the item, 403, 409, 502, 429 with `Retry-After`).
  - `POST /api/spaces/:id/issues` (someone with Projects' `edit` and `writeOut`): `{ title, column }`, makes the issue and its work, answers the work's item; the same refusals.
  - The agent action runner (`server/index.js`, about line 9930) applies an action's writes to `plan:gh-*` through the same write-through, in order, and stops at the first refusal. Read as code only: the runner is async and applies writes one by one, so it can await; server-development confirms.
- **The roadmap fields**: the `field:` key rule (`guards.keys`, need `columns`) in the manifest; in a two-way space `pulledRefusal`'s per-field rule treats `fields` as the space's own; the pull's first write of new work sets `area` from the title (section above).
- **What leaves the server**: section 13, held by the check.

### Pages (experience-design)

- **Planner - Projects** (patch bump; core, not module lane, because it changes the manifest's permissions and the stored data format): the `writeOut` permission; `source.updated` and `rank` in `scClean`, `scValue`, `FORMAT.md` and the schema; in a two-way space, pulled work is movable and editable for someone with `writeOut` (drag, the card's **Move to**, **Alt+Left/Right**, tick, title, tags), with GitHub-only fields shown read-only in the editor and the sentence beside them; **+** in a column makes an issue; the menu's **Close** in place of **Delete**; a move drawn at once and put back with the server's sentence on a refusal, in the status line (polite live line) and the agent's review list.
- **The follow control** (`wireFollows` in `public/module-settings.js`, core): under **Following owner/name**, a switch **Changes here go to GitHub**, shown when the `GET` says `canWrite`, with one line: "Moves, closes, titles and tags made here change the issues on GitHub, as the account that owns this server's token." Off by default.
- **The roadmap fields** (Projects, core because it changes the stored data format and a manifest guard): the `field:` records and each work's `fields`; the editor's choices, the card's quieter Phase and Area, the List's columns, the Board's filters per field and rows by a field (`rowsBy: "field:<id>"`, which `host.ui.board` already draws as rows); a small field editor under the column editor's menu (**Edit fields**: add a field, rename it, add, rename, reorder and delete options, a deleted option clearing that value on the work that had it, with Undo); **Update by id** in Export and import.
- **The board's order** (`host.ui.board`, core): a drop position inside a column, **Alt+Up** and **Alt+Down**, **Move up** and **Move down** in the card menu, the live line "Moved "<title>" above "<title>"."; the module stores `rank`. Phone (stacked layout, no drag): the menu's moves only.
- **What a person sees** when it fails: one line in the plan's status bar, the sentences in section 5, and the card back where it was.

## Left to build, in order

Each is a try build that leaves `main` green, unless Thomas names another kind.

1. **The write-through and the GitHub writes** (server-development, core, medium; security-relevant: a token that writes). The adapter's writes, the stand-in's, `ISSUES_GITHUB_WRITE`, the `write` flag and its route, the per-field rule in `pulledRefusal`, the conflict read, the write lane, the "never older" rule and the days rule, `POST /api/spaces/:id/issues`, the action runner's path; `tools/check-issues.mjs` extended.
2. **Planner - Projects writes through** (experience-design, core because of the manifest permission and the stored `source.updated`, medium). `writeOut`, `source.updated`, movable and editable pulled work, **+** making an issue, **Close**, the refusals; the follow control's switch (core, small). This is the step that makes Chameleon write the labels.
3. **Switch off the board-to-labels sync's schedule** (server-development, core lane because it is `.github/` and `tools/`, small). Remove the `schedule:` trigger from `project-priority-sync.yml` and its hourly case from `tools/check-project-sync.mjs`, so it runs only when started. It lands right after step 2 (the same day, or in step 2's own pull request), and Thomas turns writing on for Bug Squash only once it is in: before step 2 the sync is his only way to move a column, and after it the sync would undo Chameleon's moves. Not a compatibility step: it ends the second master until step 9 removes the workflow.
4. **The agents' side** (server-development, core, small): the actions on pulled work through the write-through, their refusals and Undo; the agent matrix's entry for `writeOut`.
5. **Order inside a column** (experience-design, core: `host.ui.board` and the stored `rank`, medium). The drop position and the moves in the shared piece; `rank` in Projects; `setColumn`'s `before`.
6. **The roadmap fields** (experience-design with server-development for the guard and the pull's Area, core, medium). The `field:` records and the work's `fields`, the field editor, the editor's choices, the card, the List, the Board's filters and rows by a field, `updateEntry`'s `fields`, the format and the schema, and **Update by id**.
7. **The one import** (server-development for the tool, small; then Thomas). `tools/roadmap-to-plan.mjs` with a check against a copy of the CSV; Thomas imports the file into Bug Squash with **Update by id**. Needs step 6.
8. **Thomas works from Bug Squash** with the GitHub board still there, following the labels through `project-priority.yml`. No build. The project manager moves its reading of the order (and Phase) to Chameleon (its own file, a process rule Thomas confirms).
9. **Remove the GitHub board** (server-development, core lane, small), as "Removing the board cleanly" says. Needs steps 5, 6 and 7 and Thomas's word that two-way is proven. content-manager updates `documentation/TODO.md` and the pages that name the workflows; Thomas removes the secret, the variables, the token and the project.

## Verify

- Step 1: `node tools/check-issues.mjs` against the stand-in, checked by a tool: a move writes exactly the label removal and addition; Inbox only removes; Done closes with `completed`, out of Done reopens and labels; a title over 120 characters is refused before anything is sent; a tag with no label refused; a new issue made and its work written under its number; the echo (a write, then a pull: no second write); a pull carrying an older issue after a write does not overwrite it; the conflict refused with 409 when the same field changed between the read and the write, and let through when another field did; 401, 403 with a wait, 422, 429 and a timeout each change nothing in the space and give their sentence; writes go ahead of a queued pull; a repository not in `ISSUES_GITHUB_WRITE` refused before any request; with writing off, today's 403s unchanged; every request the stand-in saw holds only the fields of section 13, and the token is in no answer, log line or `issues.json`. Also `node tools/check-route-table.mjs`.
- Step 2: `npm run check:module -- schedule`; live on a local server in headless Chromium at 1280 and 390, light and dark, fed by the stand-in: a drag that succeeds, one refused and put back with its line, the switch and its line in the settings.
- Step 3: `node tools/check-project-sync.mjs` (no schedule, `workflow_dispatch` only).
- Step 4: `node tools/check-module-actions.mjs` and `tools/check-agent-matrix.mjs` for the refusals and Undo, against the stand-in.
- Step 5: `node tools/check-board.mjs` for the shared piece (drop position, the keys, the live line), the module's tests for `rank`.
- Step 6: the module's tests (the field record's rules, a deleted option clearing its values, **Update by id** touching only the space's own fields and refusing a file that names the title or column), `node tools/check-board.mjs` for rows by a field, `node tools/check-module-guards.mjs` for the `field:` rule; live on a local server in headless Chromium at 1280 and 390, light and dark: the editor's choices, the filters, rows by Phase.
- Step 7: the tool's check against a copy of the CSV (every row mapped or listed as skipped, empty cells writing nothing, the file passing **Check file** and the schema); live, an import with **Update by id** on a local server fed by the stand-in, then Undo.
- Step 9: the search above finds nothing; `npm run check:docs`; `package.json`'s `check` names no removed file (`node tools/check-syntax.mjs` and a read of the script).
- **Not checked here:** any real write to GitHub. No request may be made to GitHub from this work's sessions; the stand-in with writes is the test seam. A first real write is Thomas's, on his server, once the token has Issues: write, `ISSUES_GITHUB_WRITE` names the repository and he turns writing on for Bug Squash: one move, one close and reopen, one new issue, each seen on GitHub. GitHub's real secondary-limit answers to writes, its exact 422 messages, and whether `project-priority.yml` reacts to Chameleon's labels as expected (step 8) are seen only there, as is the one real import into Bug Squash. The board inside a call is not checkable here (no LiveKit server locally).

## For Thomas

Nothing is waiting on Thomas to start. The five foundational choices are decided (Decisions). Every other choice is the planner's lean, taken and marked; he may overturn any of it. Two things are his to do, not to decide: setting the token's write permission and `ISSUES_GITHUB_WRITE` on his server before step 3's switch-on, and the word that two-way is proven before step 9.

## Small points, taken on the planner's lean

- The order inside a column is Chameleon's only and is not written anywhere on GitHub.
- No "propose a move" for a member without `writeOut`; they see pulled work read-only.
- The `priority:` labels keep their names after the board is gone; renaming them is churn for agents and history.
- Area, Release status and Phase are stored fields, not tags; the dates are the work's own `start` and `end`.
- The field definitions are guarded by `columns`; setting a value needs `edit`.
- The CSV is imported once with **Update by id** and deleted with the board.
- "Proven" (decision 1) is Thomas's word after step 8.
