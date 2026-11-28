# GitHub Full Sync Plan

**Audience:** Thomas decides the forks at the end ("For Thomas"). server-development builds the core: the GitHub adapter's new reads and writes, the stored shape of pulled work, the write-through for each new field, the issue route, a member's linked GitHub account and the checks. experience-design builds the SDK calls, the Profile row and the follow control's line (core). The Planner - Projects module agent builds the issue view, the stored format, the schema, its tests and its guide. content-manager documents what lands.

**Status:** Decided in part, 2026-11-28; nothing is built. Forks 1 to 4 were decided the same day (decisions 5 to 8), so steps 3 (the writes) and 5 (the view words) are unblocked; forks 5 and 6 stay on the planner's lean, not asked. Thomas, 2026-11-28, in the Planner - Projects module session, by clickable answer, recorded on GitHub #1259 ("Planner: Whatever exists on both GitHub and Chameleon syncs both ways (description, comments, assignees, milestone)"): "If I can change it on GitHub, I can change it in Chameleon. The only exceptions are the fields we do not map between them." Telling a person to go to GitHub to read or decide something is the failure; the point of following a repository is that either place works and they sync. He chose four, both ways: **Description**, **Comments**, **Assignees as Owners**, **Milestone**, built **all at once**. The module agent's proposed contract on #1259 is the starting point; it is a proposal, adjusted here where the code or the limits say so (marked). Read against `main` as code only: `server/issues.js`, `server/issue-providers/github.js`, `server/module-data.js` (the size limits), the issue pull and write-through in `server/index.js` (`pulledRefusal`, `writeIssues`, `issueStore`, `issueWriteThrough`, the follow and link routes), `modules/schedule/src/schedule-lib.js` and `schedule.js` (`showIssueView`, `openEditor`). Nothing was run. The issue and comment sizes below were read from GitHub's REST API in this session, read only. GitHub's endpoints are named from the planner's knowledge of its REST documentation, not re-read here; under Thomas's rule (a service's terms and pages are read before its adapter is written) server-development re-reads them before step 1 and corrects this plan where they differ.

## Why

Bug Squash follows `Coffee-Pub-Studio/coffee-pub-chameleon` with writing back on. Since #1255 the issue view shows the issue's text, read only, inside `notes`. Assignees, comments and the milestone cannot be seen or changed there, and the text cannot be edited, so every real decision about an issue still sends the person to GitHub. Thomas wants that to stop for anything both sides have.

## What it is today

- **The pull's record** (`record()` in `github.js`): number, title, open, labels, url, created, updated, closed, milestone `{ number, title, due, open }`, and `body`, cut to 2,000 characters by `bodyText`. No assignees, no comment count, no logins. The adapter's header says no login, assignee, author or comment is read, and no body, assignee or milestone is ever written.
- **The stored work** (`workOf` in `issues.js`): `notes` holds the link, `Milestone: <title>`, spare labels (past the 20 the `tags` setting holds), then the body, all cut to `NOTES_MAX` (2,000). `parent` is `ghm-<n>` for the milestone. Milestones are made by `milestonesOf` only from stored work that names them, so an empty GitHub milestone is not in the plan.
- **Who owns which field** (`issues.js`): `OWN_FIELDS` (`owners`, `waitsOn`, `start`, `end`, `rank`, `fields`) are the space's and never sent; `SENT_FIELDS` (`column`, `done`, `title`, `tags`) go to GitHub; anything else that changes (`notes`, `parent`, `source`, ...) is refused by `issueWriteThrough` and `pulledRefusal` with "This comes from GitHub. Change it there." `diffWork` sorts a change into those three; `changePlan` turns it into calls; `writeCall` maps GitHub's answer to a refusal.
- **The write-through** (`issueWriteThrough`): needs `write_out` for anything sent; reads the issue first (conditional, `issueReads` keeps the last etag in memory), refuses with 409 when GitHub changed the same field since `source.updated`, sends the calls one at a time in the write lane at least a second apart, reads the issue again, and stores it with `issueStore`, which keeps the space's own fields.
- **The issue view** (`showIssueView`, `openEditor` in `schedule.js`): the number and **Open on GitHub**, the title, `notes` drawn as plain text in `f-desc`, Done, tags, the fields and the Target date (`end`). Kind, the days, Owners, **Part of**, Waits on and Phase are hidden ("not an issue's").
- **Connect to GitHub** (`server/issue-app.js`, [plan-github-app](plan-github-app.md) decision 2, section 2): the owner signs in to GitHub once while linking; the server reads that person's installations and repositories, revokes the user token at once, and keeps the list in memory for 15 minutes. It stores nothing of the person's GitHub account: `issues.json` keeps `linkBy` (Chameleon's key), never a login (section 8). So today nothing links a member to a GitHub login.
- **The size limits** (`server/module-data.js`): one stored value at most 60 KB; everything Planner - Projects stores in an environment, every space together, at most 5 MB. A plan holds at most 1,000 entries (`MAX_ENTRIES`, `maxPlan`), counting pulled milestones.
- **What GitHub holds here** (read 2026-11-28, the newest 100 open and 100 closed of the list, pull requests dropped: 111 issues). Bodies average about 1,100 characters; 13 of the 111 are over 2,000, 2 over 4,000, the longest 5,180. 26 comments in all, at most 4 on one issue; the newest 100 comments in the repository average 558 characters, the longest 3,610. No issue has an assignee or a milestone.

## Decisions

1. **Whatever both sides have syncs both ways** (Thomas, 2026-11-28, #1259). "If I can change it on GitHub, I can change it in Chameleon. The only exceptions are the fields we do not map between them." Reason: telling a person to go to GitHub to read or decide something is the failure.
2. **The four, both ways:** the **Description** (the issue's text), **Comments**, **Assignees as Owners**, the **Milestone** (Thomas, 2026-11-28, #1259).
3. **Built all at once**, not one field after another (Thomas, 2026-11-28, #1259).
4. **This replaces** decision 3 of [plan-github-two-way](plan-github-two-way.md) as first written ("not the body, comments, assignees or delete") and the line of [plan-github-pull](plan-github-pull.md) decision 1 that kept the body read only (Thomas, 2026-11-28, #1259). Both plans are rewritten to match.
5. **GitHub logins show to everyone who can see the plan** (Thomas, 2026-11-28, clickable answer, on the planner's recommendation). Comment authors and assignees no member has linked show as their GitHub login, as the issue's text already shows to the space's members. The follow control's line says so (section 7). Reason: the owner chose to follow, and who wrote what is half of reading a thread.
6. **A member links their GitHub login by a verified sign-in on Profile** (Thomas, 2026-11-28, clickable answer, on the planner's recommendation), through the app's existing sign-in (section 4). Reason: it proves the account is theirs, so nobody can show as another person's comments or assign them on GitHub.
7. **A comment made here is posted by the app, text as written** (Thomas, 2026-11-28, clickable answer, on the planner's recommendation). Nothing of the member goes to GitHub: no name and no login in the text. Reason: it follows the app plan's lean for new issues.
8. **A person edits or deletes comments they made here; an owner may delete any comment made here** (Thomas, 2026-11-28, clickable answer, on the planner's recommendation). A comment written on GitHub changes only on GitHub. The server keeps who made each comment (`posted`, section 2). Reason: decision 1 says what can be changed on GitHub can be changed here, without changing other people's words under the app's name.

Unchanged, and not asked again (earlier decisions this plan stands on):

- Writes are sent at once, with no queue, and GitHub wins a conflict on the same field, with one line saying why ([plan-github-two-way](plan-github-two-way.md), decision 4).
- Delete stays refused: GitHub's REST API cannot delete an issue (two-way, section 1).
- The days (the Target date, stored as `end`), Phase, the fields, size and the order are the space's own and never sent (two-way, decisions 3 and 5).
- Writing needs the GitHub app, a space linked by someone who can write on GitHub, and `write_out` in the space ([plan-github-app](plan-github-app.md), decisions 1 and 3; two-way, section 10).
- The issue's text is shown to the space's members, because following is the owner's choice ([plan-github-pull](plan-github-pull.md), decision 1). The text is stored and drawn as plain text, never as markup or a link.
- The done window removes closed work older than its cutoff ([plan-done-window](plan-done-window.md), decisions 1 and 2).
- Thomas's standing rules: no paid service; a secret never in a log, an answer, a page or a space's data; the product is unreleased, so no compatibility path and no migration; the Names in CLAUDE.md.

## The shape, with the leans

Everything in this section that is not a decision above is the planner's lean. Those marked "taken" are small and written down under Thomas's standing rule (CLAUDE.md, "Decisions stick"); he may overturn any. Where a section names decision 5, 6, 7 or 8, Thomas decided it. The forks still open are in "For Thomas" (5 and 6, on the lean).

### 1. Description

- **Stored** (taken, as #1259 proposed): pulled work gains `description`, the issue's body as plain text, cut to 2,000 characters with an ellipsis, the same cap `notes` has today, so the stored size of a plan does not grow. When it was cut, `source.cut` is `true`. Pulled work no longer has `notes`: the link is `source.url`, the milestone is `parent`, and spare labels (past the `tags` setting's 20) move to `source.labels`, a list of at most 30 names, read only. `notes` keeps its meaning, the plan's own notes, on work that is not pulled.
- **Edited from the whole text, read when the issue view opens** (taken; this changes #1259's proposal). The proposal stored the body under a cap and made a longer body read only ("Too long to edit here. Change it on GitHub."). One issue in nine here is longer than 2,000 characters, and raising the stored cap to cover them (about 6,000) costs up to 6 MB for a full plan against the 5 MB every Projects space in an environment shares. So the issue view asks the server for the issue when it opens (section 5), gets the whole body (GitHub's limit is 65,536 characters), and edits that. Nothing is too long to edit, and the stored copy stays small. Cost: opening an issue makes one conditional request to GitHub (free when it has not changed, with a token); if GitHub does not answer, the view shows the stored copy read only with "GitHub did not answer, so this can't be changed now. Try again."
- **Written** with `PATCH /repos/{owner}/{repo}/issues/{n}` and `body`, through the write lane. Empty is allowed (GitHub allows an empty body).
- **The conflict rule** (taken). "The same field" is the description as a whole. The page sends back `base`, a hash the server gave with the text it opened. Before writing, the server reads the issue; if GitHub's body no longer has that hash, nothing is sent, the answer is 409 with GitHub's text and its new `base`, and the person reads "This changed on GitHub a moment ago. It now shows GitHub's version. Your text is kept below; copy what you need." The page keeps what they typed in a read-only box under GitHub's version until the view closes, so nothing typed is lost; it is never stored or sent.

### 2. Comments

- **Read when the issue view opens, not stored** (fork 5 in "For Thomas", not asked, so this is the lean and changes #1259's proposal of a stored `thread:gh-<n>` key family). The proposal's newest 100 comments per issue, each capped at 2,000 characters, is up to 200 KB per issue: over the 60 KB one value may hold, and over the 5 MB limit with about 25 busy issues. Read on open with `GET /repos/{owner}/{repo}/issues/{n}/comments` (conditional, the etag kept in memory), nothing is stored, so the 1,000-entry limit, the 5 MB limit and the done window are untouched (a closed issue that ages out has nothing left behind), an edit or delete on GitHub shows the next time anyone opens the issue, and the pull needs no new request to learn of a comment.
- **What is shown:** the newest 100, oldest first, each with its author, when it was written and its text as plain text (never markup, never a picture: the module frame allows no outside images). Past 100: "48 older comments are on GitHub." with the link (taken; the most here is 4).
- **The author** shows as the member whose linked GitHub account wrote it (section 4); a comment made from Chameleon shows as the member who made it here (the server keeps who, below); any other as its GitHub login. Logins are shown to everyone who sees the plan (decision 5).
- **Add a comment** (as proposed): a box and **Add a comment** under the thread, for someone with `write_out` in a space that writes back. `POST /repos/{owner}/{repo}/issues/{n}/comments` with `body`, at most 65,536 characters (GitHub's). No conflict rule: a comment adds, it changes nothing that is there. GitHub counts it as content made, under its tighter caps (recalled as 80 a minute and 500 an hour); one person writing is far under them.
- **Who GitHub shows as the author** of a comment made here: the app, `<app-slug>[bot]`, as every other write ([plan-github-app](plan-github-app.md), section 10). The text is sent as written, with no name or login added (decision 7).
- **Editing and deleting a comment** (decision 8): a person may edit or delete a comment they made from this space; an owner may delete any comment made from this space; a comment written on GitHub is changed only there. For that the server keeps, on the space's record in `issues.json`, `posted`: `[{ id, number, by, at }]` for the newest 500 comments made from the space (Chameleon's key, never a login).

### 3. Assignees as Owners

- **One list, Owners** (taken; this sharpens #1259's proposal). In the plan a person picks Owners as today. On pulled work:
  - An assignee on GitHub whose GitHub account a member has linked (section 4) is in `owners` as that member.
  - A member with no linked account may be an Owner here only; that is the space's own and never sent.
  - An assignee no member has linked is kept in `assignees`, a list of GitHub logins (at most 10, GitHub's own limit), shown beside Owners read only, and never written by the page.
  - For a member with a linked account, GitHub is the truth: the pull puts them in `owners` exactly when they are assigned, and takes them out when they are not. The cost, stated: someone who was an Owner here before linking, and is not assigned on GitHub, stops being an Owner of that work at the next pull. The Profile row says so when they link.
  - Why one list: the page never learns which member has which login (only the server holds the link), yet the Board's rows by person, the filters and `list_members` keep working unchanged.
- **Written:** adding a linked member to Owners assigns their login (`POST /repos/{owner}/{repo}/issues/{n}/assignees`), removing one unassigns it (`DELETE` the same), one at a time, never the whole set replaced, as labels are. Before assigning, the server asks whether GitHub will take that login (`GET /repos/{owner}/{repo}/assignees/{login}`, 204 or 404), because GitHub silently drops a login it cannot assign; on 404 nothing is sent and the person reads "<name> can't be assigned on GitHub in this repository." After the writes the issue is read again, as today.
- **The conflict rule:** as tags. If GitHub changed the assignees since `source.updated` and the person changed a linked Owner, the write is refused with the usual 409 line. Changing only Owners with no link sends nothing and needs only `edit`.
- **Rights:** a change that assigns or unassigns needs `write_out`, as every write does.

### 4. A member's GitHub account

Nothing links a member to a GitHub login today, so this is new. The way to link is decision 6:

- **A verified sign-in on Profile** (decision 6). Profile gains a **GitHub** row: **Link your GitHub account**. It uses the app's sign-in that **Connect to GitHub** already uses (the same authorize address, the same back address `/api/issues-link/back`, a link record of another kind): the server exchanges the code, reads `GET /user` for the account's id and login, revokes the user token at once, and stores `github: { id, login, at }` on the person's record in that environment. Afterwards the row says "Linked as <login>. Your GitHub assignments show as you in plans that follow GitHub." and **Unlink**. Only the person sees their own link; nobody else reads it, not an owner, not an agent. A GitHub account links to at most one person in an environment: "That GitHub account is linked to someone else here." Guests and agents cannot link. Without a working app on the server the row reads "This server has no GitHub app, so a GitHub account can't be linked."
- **Matched by id, not login** (taken). The pull reads each assignee's and author's id and login; matching is by id, so a renamed GitHub account stays linked, and the stored login is refreshed when the id comes back with a new one.
- **Connect to GitHub** stays as it is and stores nothing new (taken). It could also offer to link the owner's own account while they are signed in to GitHub; not built, to keep that flow as decided.

### 5. Milestone

- **`parent` stays the milestone** (as proposed). **Part of** is shown on a pulled issue and lists the plan's pulled milestones (`plan:ghm-<n>`) and "No milestone". Changing it sends `PATCH /repos/{owner}/{repo}/issues/{n}` with `milestone` (its number, or `null`).
- **Empty milestones** (taken). Today a milestone with no stored work is not in the plan, so it could never be chosen. Each pull also asks for the repository's open milestones (`GET /repos/{owner}/{repo}/milestones?state=open`, conditional: free when nothing changed), and `milestonesOf` keeps every open one, with or without work. They count toward the 1,000 entries, as milestones do today. A closed milestone stays only while stored work names it, as today.
- **The conflict rule:** as the title. If GitHub changed the issue's milestone since `source.updated` and the person changed **Part of**, 409.
- **The milestone itself** (its title, due day, open or closed, a new milestone) is not one of the four fields. "For Thomas" 6.

### 6. What the GitHub app needs

- **No change on GitHub's page** (to be confirmed by server-development before step 1). The app asks for **Issues: read and write** and **Metadata: read** ([plan-github-app](plan-github-app.md), section 1). Recalled from GitHub's documentation: issue bodies, issue comments (list, create, edit, delete), assignees (add, remove, check) and setting an issue's milestone, and listing milestones, are all under Issues. `GET /user` with the user token the sign-in already makes needs no extra permission for the id and login (an e-mail address would; it is not read). The back address is the one already registered. So installers approve nothing new and the owner changes nothing on GitHub. If a re-read shows otherwise, server-development says so before building, and the change and its e-mail to every installer go to Thomas.
- The installation token's narrowing (`issues: write` or `read`) is unchanged.

### 7. Logins and privacy

- **What is stored:** `assignees` on pulled work holds GitHub logins no member has linked; a person's own record holds their linked id and login. Comment authors' logins are sent to the page when an issue is opened and never stored. Nothing else of anyone's GitHub account, and never a picture or an e-mail address.
- **Who sees them:** everyone who can see the plan sees unlinked assignees' logins and comment authors' logins, as they see the issue's text (decision 5). For a public repository these are public on GitHub already; for a private one the follow control's line says so: "This repository is private. Everyone who can see this plan will see its issues: their text, comments and who is assigned." (replacing "its issue titles and labels", [plan-github-app](plan-github-app.md), section 10).
- **GitHub's Acceptable Use Policies** (personal information used only for the purpose the user authorized, kept secure, removed on request): the purpose is showing who wrote and who is assigned, inside the plan that follows the repository; a person's link is removed by **Unlink**; logins leave the plan when the issue does (done window, stop following).

### 8. Agents

Taken. An agent is a member narrowed by its gate ([plan-agent-access](plan-agent-access.md)); it reads what a member reads and writes through as two-way section 11 says, needing `write_out`.

- It reads `description`, `owners` and `assignees` in the plan, as a member does. It does not read comments (they are not stored); a comment read for agents is an open question below.
- `updateEntry` on pulled work takes `description` (replaces the whole text; refused when `source.cut` is `true`, with "This description is longer than the plan holds, so it can't be replaced from here.", since the agent never saw all of it; GitHub wins if the body changed since `source.updated`), `owners` (as today, now assigning linked members) and `parent` (a milestone's id, or empty for none; new for every entry, own work included, checked as the page checks **Part of**).
- A new action, `addComment`: `{ id, text }`, pulled work only, one comment per run.
- **Undo** (as two-way section 11): a description, Owners or milestone change is undone by another write-through, refused with "This changed on GitHub as well since then, so it can't be undone from here." when GitHub changed that field meanwhile; a description change made while the text was cut cannot be undone (the old whole text was never stored). An added comment is undone by deleting it, which decision 8 allows for a comment made from the space.
- An agent never links a GitHub account and never sees anyone's link.

### 9. Rate limits

Taken. With the app, an installation has 5,000 requests an hour and a 304 to a conditional request costs nothing.

- **The pull:** one more request per pull, the open milestones, conditional. The issues list already carries the body, the assignees and the milestone, so nothing else changes.
- **Opening an issue:** two conditional requests (the issue, its comments), answered from the memory cache when asked again within a minute. Opening 200 issues in an hour is under 400 requests, most of them 304.
- **A space without the app** (a public repository read only, 60 requests an hour for the server's whole address): the view reads live too, at most once a minute per issue; a limit shows the stored description and "GitHub asked to wait, so its comments can't be shown now."
- **Writes:** a description is three requests (read, change, read); a milestone three; an assignee four (read, check, change, read); a comment one, then the comments read again. All in the write lane, a second apart. A 403 or 429 rests the repository as today.

## The contract

### Server (server-development, core)

- **The adapter** (`github.js`, the contract in `issue-providers/index.js`, the stand-in):
  - `record()` gains `assignees: [{ id, login }]` (at most 10) and `comments` (the count), and its `body` is the whole text (plain text as `bodyText` makes it, without the 2,000 cut, at most 65,536 characters); the cut moves to `workOf`.
  - `update` also takes `body` (a string) and `milestone` (a number or `null`).
  - New members, each answering `{ status, wait, limited, message, ... }` as the writes do: `comments({ repo, number, etag, token })` (the newest 100: `[{ id, author: { id, login }, at, edited, text }]`, `total`, `etag`), `addComment({ repo, number, text, token })`, `editComment({ repo, id, text, token })`, `deleteComment({ repo, id, token })`, `assign({ repo, number, logins, token })`, `unassign({ repo, number, logins, token })`, `canAssign({ repo, login, token })`, `milestones({ repo, etag, token })`, and for the sign-in `whoAmI({ userToken })` (`{ id, login }`).
  - The header's lines on what is never read or written are rewritten to the new list.
- **The stored work** (`issues.js`):
  - `workOf` writes `description` (cut to `DESCRIPTION_MAX`, 2,000, with an ellipsis), `source.cut`, `source.labels`, `assignees` (logins with no linked member) and `owners` (linked members who are assigned); it writes no `notes`. It takes a map of linked GitHub ids to members' keys from the caller.
  - `keepOwn` keeps stored `owners` who have no link and puts linked ones from the record, as section 3 says.
  - `OWN_FIELDS` and `SENT_FIELDS` change to: own `waitsOn`, `start`, `end`, `rank`, `fields`, and `owners` without a link; sent `column`, `done`, `title`, `tags`, `description`, `parent`, and `owners` with a link. `diffWork` answers the description change, the milestone change and the assignees to add and remove (from a map the caller gives); `changePlan` gains them; `assignees` and `source` stay GitHub-only and are refused.
  - `milestonesOf` keeps open milestones the milestones list names, with or without work.
- **The people:** the person's record gains `github: { id, login, at }`, cleaned by the store; at most one person per GitHub id in an environment. Never in an export of another person's data, an answer to anyone else, a log line, `issues.json` or a space's data.
- **`issues.json`:** the space's record gains `posted` (section 2), newest 500.
- **`pulledRefusal` and `issueWriteThrough`:** the per-field rule above. A change to Owners without a link, by someone with `edit`, is stored with no request; a change that sends needs `write_out` and a space that writes back.
- **Routes:**
  - `GET /api/spaces/:id/issues/:number` (anyone who may read the plan): `{ description, base, comments: [{ id, who: { member } | { login }, at, edited, text, mine }], older, url }`, where `mine` says whether this person may edit or delete it. On GitHub's silence or a limit: 502 or 429 with the sentence, and the page keeps the stored copy.
  - `PUT /api/spaces/:id/issues/:number/description` (`write_out`, writing back on): `{ text, base }`. 200 with the work; 409 with `{ error, description, base }` on a conflict; 400 "GitHub holds at most 65,536 characters." over the limit; the refusals of the write-through otherwise.
  - `POST /api/spaces/:id/issues/:number/comments` (`write_out`, writing back on): `{ text }`, 201 with the comment as the `GET` shows it. `PATCH` and `DELETE /api/spaces/:id/issues/:number/comments/:commentId` as decision 8 says (the author edits or deletes; an owner deletes any comment made here); 403 "Only a comment made here can be changed here." otherwise.
  - `POST /api/me/github` (the person themselves; not a guest, not an agent): `{ url }`, GitHub's authorize address; 409 "This server has no GitHub app." without one. The back address finishes it and sends the person to Profile. `DELETE /api/me/github` unlinks. `GET /api/me` gains `github: { login } | null`.
  - `POST /api/spaces/:id/issues` (the **+**) also takes an optional `description` (taken).
- **Agents:** `updateEntry`'s `description` and `parent`, `addComment`, their refusals and Undo, through the action runner's existing path for pulled work; the agent matrix gains `addComment`.
- **What reaches GitHub:** two-way section 13 as rewritten, plus a body, a comment's text, a milestone's number and a linked Owner's login. `tools/check-issues.mjs` holds the list by recording every request the stand-in receives.

### Pages, core (experience-design)

- **The SDK** (`public/sdk/host.js`, routed through `public/module-host.js`): `host.issues.open(number)`, `host.issues.describe(number, { text, base })`, `host.issues.comment(number, text)`, and the edit and delete calls for a comment (decision 8).
- **Profile** (`public/profile.html`, `profile.js`): the **GitHub** row of section 4, its sentences, and the line that linking makes GitHub's assignments the truth for that person.
- **The follow control** (`public/module-settings.js`): the private-repository line of section 7, and the switch's line "Moves, closes, titles, tags, descriptions, comments, Owners and milestones made here change the issues on GitHub. GitHub shows them as <app-slug>[bot]."

### Planner - Projects (the module agent; core lane, because the stored data format changes)

- `scClean` and `scValue` keep `description` (2,000), `assignees` (at most 10 logins), `source.cut` and `source.labels`; `FORMAT.md` and `project-plan.schema.json` say so; the format stays version 1.
- **The issue view:** **Description** as a text box, filled from `host.issues.open` when the view opens (the stored copy first, then the whole text), editable for someone with `write_out` in a space that writes back, saved with its own **Save description** through `host.issues.describe`, with the conflict line and the kept text of section 1; read only otherwise. **Comments** under it, oldest first, the newest 100, and **Add a comment**. **Owners** shown (the people picker) with the unlinked logins beside it, read only. **Part of** shown with the plan's milestones and "No milestone". The line "Not an issue's" no longer hides Owners and **Part of**; it still hides Kind, the start day, Waits on and Phase.
- The status line and the refusals say the server's sentences; theme tokens only; the SDK's pieces.
- Tests in `modules/schedule/test/`, the guide's section, a patch bump.

## Left to build, in order

All of it is one delivery (decision 3): no field is turned on for people before the others. Each step is a try build that leaves `main` green, unless Thomas names another kind. Steps 1 and 3 change the core and touch who may write to someone's repository, so they are security-relevant. Forks 1 to 4 are decided (decisions 5 to 8), so steps 3 (the writes) and 5 (the view words) are unblocked.

1. **The pull's new shape and the module's reading of it, together** (server-development and the module agent, core, medium). `record()`'s assignees and whole body, `workOf`'s `description`, `source.cut`, `source.labels`, `assignees` and `owners` (no links yet, so every assignee is a login), no `notes` on pulled work, the open milestones list, and in the same pull request the module's `scClean`, `FORMAT.md`, schema and the view drawing `description` instead of `notes`. They land together, or the issue view loses its text in between.
2. **A member's GitHub account** (server-development and experience-design, core, medium). The person's `github`, `POST` and `DELETE /api/me/github`, the sign-in's second kind on the back address, `whoAmI`, the matching by id in the pull, the Profile row.
3. **The writes and the issue route** (server-development, core, large). The adapter's new members, `diffWork`, `changePlan`, `pulledRefusal`, the write-through for the description, Owners and milestone, `GET /api/spaces/:id/issues/:number`, the description and comment routes, `posted`, the stand-in and `tools/check-issues.mjs`. Needs 1 and 2.
4. **Agents** (server-development, core, small). `updateEntry`'s `description` and `parent`, `addComment`, Undo, the agent matrix. Needs 3.
5. **The issue view and the SDK** (experience-design for `host.issues` and the follow control's lines; the module agent for the view; core and module, medium). Needs 3. When this lands, the four fields are on for people, together.
6. **Documentation** (content-manager), with step 5: the Planner - Projects guide, the settings reference (Profile's GitHub row), api-modules and architecture-modules (the issue route, what reaches GitHub, what is read), the status lines of this plan and the two-way and pull plans.

## Verify

- **Step 1**, checked by a tool: `node tools/check-issues.mjs` against the stand-in (a body over 2,000 stored cut with `source.cut`, the whole body in the record, assignees kept as logins, an empty open milestone stored, a closed one dropped when no work names it, no `notes` on pulled work, spare labels in `source.labels`); `npm run check:module -- schedule` for `scClean`, the schema and the view's text. Live on a local server against the stand-in (`ISSUES_TEST_STANDIN`), in headless Chromium at 1280 and 390, light and dark: the issue view shows the description.
- **Step 2**, checked by a tool: the sign-in's second kind against the stand-in (the code exchanged, `GET /user` read, the token revoked before anything is answered, the id and login stored on the person, a second person refused the same id, a guest and an agent refused, nothing of it in any other person's answer, `issues.json`, a space's data or a log line); a renamed login refreshed by id at the next pull. Live: the Profile row, linked and unlinked.
- **Step 3**, checked by a tool: each write sends exactly its call and nothing else; the description's conflict (GitHub's body changed between open and save) answers 409 with GitHub's text and sends nothing; assigning a login GitHub refuses sends nothing and says so; an unlinked Owner change sends nothing and needs only `edit`; a linked one needs `write_out`; a milestone set and cleared; a comment added, and edited or deleted by its author, and deleted by an owner, as decision 8 says; `posted` capped at 500; 401, 403 with a wait, 422, 429 and a timeout change nothing in the space; the token in no answer or log. Also `node tools/check-route-table.mjs`.
- **Step 4:** `node tools/check-module-actions.mjs` and `tools/check-agent-matrix.mjs` for the new fields, `addComment`, the refusals and Undo, against the stand-in.
- **Step 5:** `npm run check:module -- schedule`; live in headless Chromium at 1280 and 390, light and dark, against the stand-in: a description edited and saved, a conflict with the kept text, a comment added, Owners with a linked and an unlinked person, a milestone chosen, the read-only view without `write_out`.
- **Not checked here:** any real request to GitHub. No app is registered on a server this session can reach, and no write may go to GitHub from this work. GitHub's real answers to body, comment, assignee and milestone writes, whether a login it cannot assign is really dropped silently, the content caps on comments, `GET /user` through the app's sign-in, and what GitHub shows for a change made by the app are seen only on Thomas's server, after the app is registered and Bug Squash is connected. Nothing here needs a LiveKit call; the canvas inside a call is read as code only.

## For Thomas

Forks 1 to 4 were decided on 2026-11-28 and are decisions 5 to 8 above. Forks 5 and 6 were not asked; each stays on the planner's recommendation, which is a suggestion and not a decision. Thomas may overturn either.

5. **Comments stored in the plan, or read when the issue is opened.**
   - (a) Read when opened (recommended). Nothing stored, no limit reached, always current. Costs: agents cannot read comments in the plan, comments are not in Export or search, and a view of comments needs GitHub to answer.
   - (b) Stored, as #1259 proposed, but bounded to fit: the newest 10 per issue, 1,000 characters each, open issues only. Agents and Export see them; the plan's size grows by up to 10 MB in the worst case, over the 5 MB limit, unless the bound is tighter still.
6. **Milestones themselves.** Making a milestone, renaming it, its due day and closing it are things GitHub has and Chameleon would show; they are not one of the four fields chosen.
   - (a) Not in this build; a small plan after it (recommended). Keeps "all at once" to the four.
   - (b) In this build. More of the same writes, one more permission check (Issues covers milestones, as recalled).

## Taken on the planner's lean

Thomas may overturn any of these; none blocks the build.

- The stored description is cut to 2,000 characters, the edit uses the whole text read on open, and nothing is too long to edit (section 1).
- Pulled work has no `notes`; spare labels move to `source.labels`.
- One Owners list; linked members follow GitHub's assignees exactly; unlinked members are the space's own; unlinked logins are shown read only (section 3).
- Matching by GitHub id; the stored login refreshed (section 4).
- Open milestones are kept in the plan with or without work (section 5).
- The live read is cached a minute; past 100 comments a line and the link (sections 2, 9).
- Agents' `updateEntry` `description` and `parent`, `addComment`, and their Undo (section 8).
- The **+** takes an optional description.

## Open questions

Nothing blocks the build. Steps 3 (the writes) and 5 (the view words) are unblocked by decisions 5 to 8. Forks 5 and 6 are on the planner's lean and change step 3's size only if Thomas answers against the recommendation.

- A comment read for agents (an action that reads one issue's comments, counted against the agent's limits). Not in this build unless Thomas asks.
- Comments drawn as Markdown rather than plain text. Lean: plain text, as the description is (#1255), until a shared safe Markdown piece exists in the SDK.
- Reactions, locking a conversation and pinning: GitHub has them; not mapped (decision 1's exception).
