# Agent Server Actions Plan

**Audience:** Thomas decided that no agent action waits for a page (decision 8 of
[plan-agent-edit-delete](plan-agent-edit-delete.md)); this plan is how every bundled module gets there. server-development
builds the runner's context, its new kinds of answer and the input fixes (`server/`, `public/sdk/`, `tools/`; core, larger
model for the runner and the write scopes, security); experience-design builds each module's move onto the server (module
lane, a patch bump each); quality-assurance reads the runner changes as a security change when Thomas calls a feedback or
production build. Step 11 adds the deploy's seccomp profile, the shared module check and the validator (server-development),
the Modules page's approval (experience-design) and the author guide (content-manager).

**Status:** Draft, 2026-11-23, built through step 10 (see Progress). Uploaded modules decided the same day (decision 2); step 11 is not built. Step 11's deploy rule, the stand-alone module validator and the phase-end right decided by Thomas on 2026-11-25 (decisions 3 to 5), and step 11 replanned as steps 11a to 11f. The request, Thomas, 2026-11-23: "in general i want to move away
from 'waits until someone [opens the module]...' for the reasons we have already discussed. I do not want this same
decision to come up one module at a time... this is for all things. An agent is not useful if you also have to be in the
app for it to get real-time updates." The gaps below are the ones the builders of steps 1, 2a and 2b of
plan-agent-edit-delete reported, checked against the code on `origin/main` at `244b327d`.

**Progress (2026-11-25, read against `main` at `fa5ea4bd`).** Steps 1 to 10 are built and merged; step 11 (uploaded modules on the server) is not, and the check at the end of "Left to build" is not yet added. The sections "What it is today" and "The gaps the builders found" below describe `main` at `244b327d`, before these steps.

1. Context: `ctx.settings`, `ctx.util.label`, `order`, `rollup`, `geo`, phases as `{ id, label, main }` (#1086).
2. Data back to the agent (without `note`, at most 8000 bytes), pointer clears and the AI's clears (#1086).
3. Polls, Goals and Budget on the server (#1088).
4 and 5. Links, schedules and a notice in the answer, with exact undo (#1099).
6. Polls close and announce on the server through a `close:<id>` schedule, and Polls declares the `schedule` hook (#1103; Polls 1.15.34); Calendar's and To-do's reminders and links are set by the server at once (#1104; Calendar 1.24.52, To-do 1.15.38).
7. Research and Planner - Projects on the server (#1105; Research 0.4.40, Planner - Projects 0.1.11). The runner has no `URL`, so Research reads addresses with a pure reader (`rsUrl`) that refuses a user name, an unusual numeric host and a host written in another script than Latin, Greek, Cyrillic, Chinese, Japanese or Korean.
8. The Itinerary's last day moves on the server (`phaseEnd`, #1114; Itinerary 0.16.23). It is capped at 366 days a call, on the route too.
9. The sandbox lockdown (GitHub #1100), writes outside the space and the server-side place search (#1115), with `ACTION_RUNNER_NETWORK`.
10. Maps on the server (#1116; Maps 0.10.17), with `actions.pageOnly` and the page adapter carrying environment writes, reads and lookups.

Open after step 10: a request that points at another of the agent's spaces still waits for a page (it should be refused plainly, issue #1117, item 1); an upload that declares `lookups` is not refused at install (step 11c refuses it); and a default Docker deploy has no kernel network boundary, which Thomas decided on 2026-11-25 (decision 3, built in step 11a). The contract as built is in [api-modules](../api/api-modules.md), "Actions the server carries", and [architecture-agent-access](../architecture/architecture-agent-access.md), "The server runner".

## Why

Decision 4 of plan-agent-edit-delete put the server runner in place (`server/module-actions.js`,
`server/module-actions-worker.js`, `carryOnServer` in `server/index.js`), and every bundled module with agent actions now
keeps them in a library (`modules/<id>/src/<id>-lib-actions.js`) that its page also runs. But only three modules turn the
runner on, and those three still leave part of their work for a page. An agent that can't read back what it made, chain a
second step or have a reminder set until someone opens the app is not useful (decision 8).

## What it is today

Read as code on `origin/main` at `244b327d`.

### Which modules the server carries

From each `modules/<id>/module.json` (actions an agent may ask for: not `local`, not `askerOnly`, not `ai: false`).

| Module | Agent actions | `actions.server` | What still waits for a page |
|---|---|---|---|
| Planner - Itinerary (`travel`) | `addStop`, `addToDay`, `acceptSuggestion`, `setStopPlace`, `updatePlan` | yes | the main phase's end, when an entry lands after it (`actStretch`, `travel-lib-actions.js:53`: the note says a person must add days) |
| Calendar (`calendar`) | `createEvent`, `updateEvent` | yes | the reminder (`remindPending`, `calendar-lib-actions.js:17`) |
| To-do (`todo`) | `createTask`, `linkTask`, `unlinkTask`, `setTaskDue`, `updateTask`, `setTaskDone` | yes | the reminder and the links (`remindPending`, `linksPending`, `todo-lib-actions.js:46`) |
| Polls (`polls`) | `createPoll`, `updatePoll` | no | everything; and a poll that closes by time is announced only by an open page (`polls.js:505`) |
| Planner - Goals (`goals`) | `addGoal`, `addStep`, `addNote`, `updateGoal`, `setGoalDone` | no | everything |
| Budget (`budget`) | `addCost`, `updateCost` | no | everything |
| Research (`research`) | `saveNote`, `saveLink`, `updateNote`, `updateLink` | no | everything |
| Planner - Projects (`schedule`) | `addMilestone`, `addWork`, `addNote`, `setDone`, `updateEntry` | no | everything (`SC_PAGE_ONLY`, `schedule-lib-actions.js:15`) |
| Maps (`maps`) | `addPlace`, `updatePlace`, `setPlacePoint` | no, and no actions library: the handlers are in `maps.js` | everything |
| Documents, Whiteboard, Vault, Stream, Assistant | none (Assistant's one action is `local`) | | nothing to carry |

### The gaps the builders found

1. **The module's settings.** The runner's `ctx` has no `settings`. Polls reads `addableByDefault` and `closeAfterDays`,
   Goals `dates` and `progressBy`, Budget `categories`, Planner - Projects `datesRequired`. The page passes
   `host.settings.get()`; the server has the same values (`moduleSettings.effective`, as `GET /api/modules/:id/settings/values`
   answers them).
2. **More of the SDK's pure helpers.** `ctx.util` is `plain`, `localWhen`, `detailLines`, `time`, `ymd`, `parseYmd`,
   `objectKey`, `id`, `word` (`hostActions.util` in `public/sdk/host.js`). Missing: `order` (Goals, Planner - Projects),
   `label` (the template's names for the module's kinds; Goals, Planner - Projects), `rollup` (Planner - Projects) and
   `geo` (Research, Maps). All four are pure and already in `host.js`.
3. **Phase names.** `ctx.space.phases` is `{ id, main }` only. Goals and Planner - Projects match an object's phase by its
   name, so they need each phase's `label`.
4. **A place search.** Maps' `addPlace` with an address and no position needs the module's place search
   (`server/geocode.js`, the module's `geocoder`). The run's process has no network, by design.
5. **Writes outside the space.** A write is `{ key, value }` in the module's data in the request's space and nothing else
   (`outcomeOf`, `module-actions.js:202`). Maps' `addPlace` takes `in`: environment, space or person, and an environment
   place carries marks for the spaces it shows in.
6. **Links.** The runner answers writes only. Research (a note made about another object) and Planner - Projects (an entry
   made from another object), and To-do's `linkTask` and `unlinkTask`, need a link written through the host's links
   (`POST /api/objects/links`).
7. **Schedules and announcements.** Calendar's and To-do's reminders are schedules only a page sets today; the server takes
   the old one off (`moduleHooks.cancelAbout`) and the module marks the object for a page. A poll closed on the server, or
   closing by time, is never announced without a page.
8. **The answer's data.** `carryOnServer` answers `ref` and `note` only; a handler's `data` beyond `data.note` is dropped
   (`end` in `carryOnServer`).
9. **A pointer can't be cleared.** `clears` takes only `string`, `text`, `number` and `date` (`CLEARABLE_TYPES`,
   `server/modules.js:507`), so Goals can't move a note back to the top level (`goal: ""`).
10. **The in-app AI drops a clear.** `checkToolInput` (`server/action-catalog.js:137`) turns an optional "" into no value,
    so a declared clear never reaches the action from the in-app AI.
11. **The Itinerary's main phase end.** A phase is the space's, not the module's data, so the runner can't write it.

## Decisions

Only Thomas's.

1. **No agent action waits for a page; this is decided for every module at once** (Thomas, 2026-11-23, decision 8 of
   plan-agent-edit-delete; quoted under Status). The marks that wait for a page (`remindPending`, `linksPending`, the
   Itinerary's phase-end note) are not the end state either: each is replaced by the server doing the thing.
2. **Uploaded modules run their server actions in the same isolated process, once an admin approves it** (Thomas,
   2026-11-23, option (a) of the question this plan asked; decision 9 of plan-agent-edit-delete). This replaces decision
   4's wait for a page for uploaded modules. Not chosen: (b) never offer an uploaded module's actions to agents; (c) keep
   the wait for uploaded modules as an exception to decision 8.
3. **Uploaded modules' server actions run only where the kernel network wall exists** (Thomas, 2026-11-25, answering the
   deploy question this plan and `TODO.md` left open before step 11). Chameleon ships a seccomp profile, with the lines
   that use it in `docker-compose.yml` and the deploy files, that lets the runner make its network namespace; without
   that wall (`ACTION_RUNNER_NETWORK=namespace`, and a namespace the server could really make) an uploaded module's server
   actions are refused. Bundled modules keep working with the in-process lockdown alone. The rest of decision 2 stands:
   the admin approves per module version, tied to the hash of its library, with the same sandbox limits, and the hostile
   cases are checked. Not chosen: accepting the lockdown alone for uploaded modules too.
4. **A stand-alone module validator, one implementation with the upload check** (Thomas, 2026-11-25). `node
   tools/validate-module.mjs <zip or folder>` is for authors who make modules outside this repository, and knows nothing
   of the environment the module will go to. It runs the manifest, permissions, tokens (no fixed colours), words (no
   hard-coded space, member and the other changeable words; labels come from the SDK), `host.*` reuse and action-library
   (no network, no forbidden APIs) checks, and prints plain pass and fail lines. The upload check and the validator are
   one implementation, so "passes the validator" and "passes upload" mean the same, and the admin's approval screen shows
   the author's same findings. A short "Writing a module" guide for authors is in this plan's scope (in
   `documentation/api/`, written by content-manager).
5. **The Itinerary's phase-end right stays as built** (Thomas, 2026-11-25). Decision 8 of plan-agent-edit-delete stands
   as built in step 8 here: an agent moves the main phase's end on the server within the rights the cover route already
   applies, and there is no separate Roles row for it. This settles the double wording of that decision noted in
   plan-agent-edit-delete's Progress.

## The contract

### 1. The runner's context (core)

- `ctx.settings`: the module's settings as the agent may read them, from `moduleSettings.effective` for the request's
  space and the agent's key, shared and not-offered values applied exactly as `GET /api/modules/:id/settings/values` does
  (one function used by both). A person-scope setting takes its default (an agent has none of its own).
- `ctx.util` gains `order`, `label`, `rollup` and `geo`, built in the worker from `host.js` itself as the others are, so a
  page and the server run one copy. `label` uses the environment's words for the space (the template's names), passed in
  `localeText` beside `words`.
- `ctx.space.phases` entries gain `label` (the phase's name as the space shows it).
- Planner - Projects reads `ctx.util.label`, `ctx.util.order` and `ctx.space.phases` instead of its own `ctx.label`,
  `ctx.order` and `ctx.phases`; its page adapter passes the same shape.

### 2. More than writes in an answer (core)

A handler may answer, beside `writes`, `ref` and `data`:

- `links: [{ add | remove: { from, to } }]`, at most 5, each a pointer pair as `POST /api/objects/links` takes it. Applied
  as that route applies it, as the agent: the agent must see both objects, one end must be this module's object in this
  space.
- `schedules: [{ set: { key, at, notify?, repeat?, about } } | { cancel: { key } }]`, at most 5, as
  `POST /api/modules/:id/schedule` and `DELETE /api/modules/:id/schedule/:key` take them, `about` one of the module's own
  objects in this space. Only for a module whose manifest declares the `schedule` hook and the admin approved it.
- `notify: [{ title, body, about }]`, at most 1, as `POST /api/modules/:id/notify` takes it. Only with the `notify` hook.
- `phaseEnd: { date }` (Itinerary only, by manifest: the action must say so): moves the space's main phase's end to cover
  a new entry, through the same rule a page's `absorb` uses, only if the agent's rights allow that change to the space's
  phases; else the request is done and its note says the plan's last day was not moved and why (a refusal with a reason,
  not a wait).

All of these run in the same synchronous step as the writes, after them, and one refusal puts back everything the request
did (the writes through `undoCarried`, links removed, schedules cancelled). `outcomeOf` checks each the way it checks a
write: known keys only, sizes, counts, own-module pointers.

### 3. A place search before the run (core; security)

- An action may declare `"lookups": { "<input>": "geocode" }` in `module.json`, only in a module that declares
  `geocoder`. Before the run, the server searches that input's text with the module's own place search (saved places
  first, then the service its settings name, the same cache and the admin's keep rule, `geocodeAccess`), as the agent,
  counted against the agent's reads, and hands the handler `ctx.lookups.<input>`: at most 6 `{ title, sub, lat, lng, key }`.
- The run's process never gets network, a fetch function or a callback into the server. The search is the server's, done
  before the handler starts; the handler only reads its answer. No second round trip in this plan.

### 4. Writes outside the space (core; security)

- A write may carry `scope: "environment"` beside `key` and `value`. The server allows it only when the module's
  permission lets the agent write environment data, the key is one of the module's own kinds, and the value marks the
  request's space (the kind's `summary.spaces` holds that space's id). A space write stays the default.
- `scope: "person"` is refused for an agent with "An agent has no places of its own; save it for this {space} or for
  everyone." The agent's person scope is no one's.
- Maps' `in` keeps all three words for a person's page; on the server `person` is refused as above.

### 5. The answer to the agent (core)

`carryOnServer` answers `data` (the handler's, at most 8000 bytes, already checked) beside `ref` and `note`, and
`request_status` and the MCP tool `ask_for_change` pass it on.

### 6. Clearing a pointer, and the AI's clears (core)

- `ref` joins `CLEARABLE_TYPES`; `busInput` already keeps "" for a declared clear, and the agent's pointer check skips "".
- `buildCatalog` puts each tool's `clears` on it, and `checkToolInput` keeps "" for those inputs instead of dropping it.

### 7. Each module (module lane)

Each turns on `actions.server` and drops what waits:

- **Calendar:** answers the reminder's schedule (`set` or `cancel`) instead of `remindPending`; the page's
  `setWaitingReminders` goes.
- **To-do:** the reminder's schedule and the links in the answer; `remindPending`, `linksPending` and `settleWaiting` go.
- **Planner - Itinerary:** `phaseEnd` instead of the note.
- **Polls:** turns on the server; a poll made or changed with a closing time answers a schedule that announces it at that
  time, and one closed now answers `notify`. The manifest gains the `schedule` hook (an admin approves it), and the page's
  announce loop (`polls.js:505`) goes, for people's polls too, so nobody's poll waits for a page to be announced.
- **Planner - Goals, Budget:** turn on the server once section 1 is in.
- **Research:** turns on the server; a note or link made about another object answers its link.
- **Planner - Projects:** reads section 1's shape, answers its link and the milestones' done and progress as writes, and
  turns on the server.
- **Maps:** moves `addPlace`, `updatePlace` and `setPlacePoint` into `src/maps-lib-actions.js` (one copy, the page calls
  it too), declares `lookups` for `address`, writes environment places with marks (section 4), and turns on the server.

### 8. Uploaded modules (core; security)

Decisions 2 and 3. Where this section goes beyond them, it is the planner's lean, chosen as the safest; Thomas may change
any.

- **The declaration.** An uploaded module declares `actions.server` as a bundled one does: one of its own
  `src/<id>-lib*.js` files. Nothing else is new in its manifest. The zip carries the library files themselves under `src/`
  (the set `libraryOf` loads: `src/<id>-lib.js`, then `src/<id>-lib-*.js` and the `src/<id>-lib-*.json` data, without
  `actions.pageOnly`); `tools/build-module.mjs` puts them in when the manifest declares `actions.server` (section 9). The
  refusal at install that exists today ("Only a module that ships with the server can carry out actions on the server.")
  goes.
- **What an upload may not declare.** An action's `lookups`, `skipLookupWhen` and `phaseEnd: true` are refused at install
  for an upload, each with a sentence (for example `module.json: action "addPlace" asks the server to search places, which
  only a module that ships with the server may do`). Today an upload with `lookups` is installed and the field is ignored;
  refusing it says so plainly instead (the planner's lean).
- **The network wall (decision 3).** An uploaded module's request runs only while both hold: `ACTION_RUNNER_NETWORK` is
  `namespace`, and the start-up test made a network namespace (`networkSeal` in `server/module-actions.js`). The run
  itself also goes through the namespace, never the lockdown alone: if the namespace can't be made for that run, the run
  is a fault and nothing is written. Without the wall the module's actions are refused to agents at once (below), and its
  card on the Modules page says why. Section 10 has the deploy half.
- **What `namespace` means changes** (the planner's lean). Today `ACTION_RUNNER_NETWORK=namespace` makes the namespace a
  must for every run, so a server that can't make one runs no module's server action. With decision 3 it becomes the
  switch for uploaded modules: `namespace` lets uploaded modules' server actions run, and only in a namespace; bundled
  modules use a namespace where there is one and run with the lockdown alone where there isn't, under either value. Unset
  or `auto`: bundled modules as today, uploaded modules' server actions never run. The start-up log says which of the
  three holds: "Modules' server actions: bundled modules run in a network namespace; uploaded modules may run, with the
  admin's approval.", "... bundled modules run with the lockdown only; uploaded modules' actions are off, because
  ACTION_RUNNER_NETWORK is not namespace." or "... uploaded modules' actions are off, because this server can't make a
  network namespace (see the seccomp profile in deploy/)."
- **The approval.** The host admin (`admin`), not an owner, approves running it on the server, per module version, on the
  Modules page. The approval is stored in the module's registry entry, so per environment, as `serverRun: { version,
  sha256, by, at }`: the module's version and the SHA-256 of the exact library text the runner would send to the worker
  (`libraryOf` on the installed copy, `actions.pageOnly` left out). It is off by default and can be taken back at any
  time. Routes (the planner's lean for the names): `POST /api/modules/:id/server-run` with body `{ version, sha256 }`, the
  admin only (403 otherwise), 409 "This version changed since you looked at it; look at it again." when the version or the
  hash is not the installed one's now, 400 when the version declares no `actions.server`; `DELETE
  /api/modules/:id/server-run` takes it back. Approving is allowed without the network wall (the card says it won't run
  until the server has the wall), so the admin can approve before changing the deploy.
- **A changed upload needs approval again.** A new version, or the same version with any different byte in the library,
  does not match the stored approval, so it is not run; the admin approves again. The runner hashes the text it is about
  to send to the worker and compares it with the approval on every run, so what runs is exactly what was approved.
- **What the admin sees.** `GET /api/modules` gains, on an uploaded module that declares `actions.server`, `serverRun: {
  sha256, approved, approvedVersion, by, at, wall, why }` (`wall` whether this server runs uploaded actions now, `why` the
  sentence when it doesn't), and on every uploaded module `findings`: what the shared check (section 9) found in the
  installed version, the same lines the author's validator printed. The approval control shows the findings, the hash's
  first 12 characters, and one plain warning: "Its actions for agents will run on this server, in a process with no
  network, files or settings. Approve only code you trust. A new version needs approving again." (words are
  experience-design's to tune within the plain-words rule).
- **Until it is approved, or without the wall,** the module's actions are not offered to agents: `GET
  /api/spaces/:id/actions` shows each with `may: false` and `why` ("Needs the admin's approval to run on the server." or
  "This server doesn't run uploaded modules' actions for agents."), and `POST /api/spaces/:id/action` (`ask_for_change`)
  refuses at once, 409, with that sentence. Nothing waits. The agent's queue for an open page goes, with the `waiting`
  field of the actions list and the pending words for uploaded modules; `wait_for_result` stays only if something else
  still uses it (the builder says which). A person's own requests (Chat's Keep, Send to...) keep the page path, as
  decision 4 of plan-agent-edit-delete left them.
- **The same sandbox limits.** The same worker (`server/module-actions-worker.js`): its own process in its own network
  namespace, Node's permission model with nothing allowed but reading the worker, the lockdown, no environment, no files,
  no child process, code generation from strings off, the heap, time and size limits, killed after the wall-clock limit.
  The answer is checked by `outcomeOf` and every write applied as the agent through `putModuleValue`, exactly as for a
  bundled module.
- **No extra permissions.** An uploaded module's handler may do nothing its manifest and the approvals do not already
  allow a person's page of it: space writes in its own data, links, and `schedules` and `notify` only with hooks approved
  on its card. It gets no `lookups` (no place search), no `scope: "environment"` writes and no `phaseEnd`; `outcomeOf`
  refuses each for an uploaded module even if a manifest slipped past install.
- **Its share of the runner.** At most 2 of the runner's 4 running slots go to uploaded modules at once, so one can't hold
  up the bundled modules.
- **Taken off.** Uninstalling, disabling, rolling back or replacing the module drops its approval.

### 9. The module check and the validator (core)

Decision 4. One implementation decides what an upload is refused for and what the admin is shown, and the validator is
that implementation run on the author's own machine. The details are the planner's leans.

- **One function.** `server/module-check.js` exports `checkModule(files)`: `files` is the map `readZip` returns (name to
  bytes). It answers `{ id, version, refused, findings, library }`: each finding `{ check, grade, file?, line?, text }`,
  `grade` `refuse` or `advise`, and `library` the SHA-256 the runner would hash when the manifest declares
  `actions.server`. It is pure: no `DATA_DIR`, no environment, no environment's words or template, no network, and it never
  runs a module's code (a library is parsed, never run). The server's install calls it for every install, upload and
  bundled alike; `tools/validate-module.mjs` calls it; nothing else decides.
- **The checks**, in the order they print:
  1. `manifest` (refuse): `cleanManifest`, `oldNameIn`, and section 8's upload-only refusals. The first refusal's sentence
     is the one the upload's 400 says today.
  2. `permissions` (refuse for what `cleanManifest` refuses; otherwise a listing): what the module will ask an owner and
     the admin to approve, in words: its permissions with their defaults per role, hooks, uploads, refs it consumes, events
     it hears, actions it asks for, and `actions.server`. Advice when a default gives guests a write ("Guests can change
     this module's data unless an owner turns it off.").
  3. `colours` (advise): a fixed colour outside a token, by the rule of `tools/check-no-raw-colours.mjs` (black and white as
     a shadow or scrim allowed), in every stylesheet, page and script in the zip.
  4. `words` (advise): a changeable word (`space`, `home`, `member` in either form, `CHANGEABLE` in `server/words.js`)
     typed into what a person reads instead of coming from the SDK (`host.util.word`, `data-word`, `{space}`
     placeholders), and the old names (room, table, ...), by the words rule of `tools/check-names.mjs`, in pages, scripts
     and `module.json`'s texts.
  5. `host reuse` (advise): the layout rules of `server/module-layout.js` (a module draws no bar of its own and restyles
     none of the shared classes; the pieces are `host.toolbar.set`, `host.menu.show`, `host.ui.viewSwitch`). This is what
     `layoutWarning` says on upload today; it becomes these findings.
  6. `action library` (refuse; only with `actions.server`): the declared file and the library set are in the zip; each
     file parses (compiled with `vm.Script`, not run); and no file names what the runner does not give: `require`,
     `import`, `process`, `eval`, `Function`, `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator`,
     `Worker`, `WebAssembly`, `globalThis`, `.constructor` (the full list is the builder's, kept in the one file). This
     check is early help for an honest author, never the boundary: the boundary is the worker (section 8).
- **Grades.** A `refuse` finding refuses the install: 400 with its sentence, as today, and the answer carries every
  finding. An `advise` finding never refuses: the install goes on, the findings are kept with the version (at most 50,
  each at most 200 characters) and shown on the card (section 8). So a third-party module with a fixed colour still
  installs, the author and the admin both see the line, and a false hit (a word that is plain English, such as a hotel's
  "double room") costs nothing. Bundled modules get the same findings; their allow-lists stay in the repository's checks
  only, and the card shows findings for uploaded modules only.
- **One rule each.** The colour scanner, the words rule and the layout rules move into `server/` as pure functions (the
  layout rules already are). `check-no-raw-colours`, `check-names` and `check-module-layout` import them and keep their
  allow-lists and repository-wide reach, so a rule changes in one place and the repository's checks and the upload never
  disagree.
- **The validator.** `node tools/validate-module.mjs <zip or folder> [--json]`, from a clone of this repository with its
  dependencies installed (Node 22), with no server, no `DATA_DIR` and no settings:
  - A `.zip` is read with `readZip`, the same limits and file types as an upload.
  - A folder in this repository's layout (`module.json` and `src/<id>.html`) is built in memory exactly as Manage >
    Modules builds a bundled module (`buildModule`), then read with `readZip`. Any other folder is zipped in memory as it
    is, then read with `readZip`. Either way the bytes checked are the bytes an upload would carry.
  - It prints one line for the module, then `pass  <check>` or `fail  <check>` for each check, each finding indented under
    its check as `<file>:<line> <text>`, then one verdict: "Upload would be refused: <n> problem(s)." or "Upload would be
    accepted. The admin will see <n> finding(s).", and with `actions.server` "Its server actions need the admin's
    approval of this exact library (sha256 <first 12>) and a server with the network wall." `--json` prints the result
    object instead.
  - Exit 0 accepted, 1 refused, 2 when the input can't be read.
  - "Passes the validator" means the verdict, exactly as "passes upload" means the install: an `advise` check prints
    `fail` with its findings and the module still passes, because the upload accepts it and shows the same lines.
- **The build carries the library.** `server/module-build.js`'s `buildModule` puts the library set (section 8) under
  `src/` in the zip when the manifest declares `actions.server`, so a built zip can run on the server; a bundled module
  is still loaded from the deployment's own folder.

### 10. The deploy (decision 3)

- **The profile.** `deploy/seccomp-action-runner.json`: Docker's default seccomp profile, taken whole from a named moby
  release, plus one rule: `unshare` (and `clone` where the default masks namespace flags) allowed only when the flags hold
  nothing but `CLONE_NEWUSER` and `CLONE_NEWNET`, which is what the runner's `unshare -rn` needs (a user namespace so a
  process without `CAP_SYS_ADMIN` may make a network namespace). No other namespace, no capability added; `cap_add:
  SYS_ADMIN` and `seccomp=unconfined` are not offered. The moby release it came from is recorded in the plan's step and
  in the check.
- **The image.** The runner looks for `unshare` (`UNSHARE_PATHS`). The builder confirms the `node:22-alpine` image has one
  that takes `-r` and `-n` (busybox's applet, if built in), and adds `util-linux-misc` in the `Dockerfile` if it does
  not.
- **`docker-compose.yml`.** `ACTION_RUNNER_NETWORK: "namespace"` is set (with section 8's meaning it costs bundled modules
  nothing). The `security_opt: ["seccomp=/share/appdata/coffee-pub-chameleon-seccomp.json"]` line is there, commented, in
  one block with a short explanation: copy `deploy/seccomp-action-runner.json` there and uncomment it to let uploaded
  modules' actions run for agents. It is commented because a profile file that is not on the host stops the container
  from starting, and an install with no uploaded modules needs none of it (the planner's lean; Thomas may prefer it on).
- **The deploy guide.** `userguide-getting-started.md` and the settings reference say the same in a few lines, including
  that some hosts' kernels allow no user namespaces at all (then the log says so and uploaded actions stay off).

## Left to build, in order

Each step is a try build unless Thomas names another kind. Core steps leave every check green on `main`.

1. **Context: settings, helpers, phase names** (server-development, core). Section 1. `tools/check-module-actions.mjs`
   extended (a handler sees the settings, `order`, `label`, `rollup`, `geo`, phase labels).
2. **Data back, pointer clears, the AI's clears** (server-development, core, smaller model). Sections 5 and 6.
   `check-module-actions`, `check-mcp`, `check-ai-tools`.
3. **Polls, Goals, Budget on the server** (experience-design, module lane, a bump each). Turn on `actions.server`; Polls'
   announcements wait for step 5. `npm run check:module -- <id>`.
4. **Links in the answer** (server-development, core, larger model; security). Section 2's `links`, with the rollback.
   `check-module-actions`, `check-links`.
5. **Schedules and announcements in the answer** (server-development, core, larger model). Section 2's `schedules` and
   `notify`. `check-module-actions`, `check-hooks`.
6. **Calendar, To-do, Polls drop their waits** (experience-design, module lane, a bump each). Reminders, links and Polls'
   announcements from the answer; the marks and the page-side settling removed; Polls' `schedule` hook.
7. **Research and Planner - Projects on the server** (experience-design, module lane, a bump each).
8. **Itinerary's phase end** (server-development core for `phaseEnd`, then experience-design module lane).
9. **Writes outside the space and the place search** (server-development, core, larger model; security). Sections 3 and 4.
   `check-module-actions` with the hostile cases below; `check-agent-tokens`.
10. **Maps on the server** (experience-design, module lane, a bump). Section 7's Maps line.
11. **Uploaded modules on the server**, in six parts, each built and checked on its own, in this order (decisions 2 to 4;
    sections 8 to 10).
    - **11a. The deploy and the wall** (server-development, core, larger model; security). Section 10's profile, the
      image's `unshare`, the compose block, and section 8's new meaning of `ACTION_RUNNER_NETWORK` with its three start-up
      lines. A new `tools/check-seccomp-profile.mjs`: the profile parses, equals the recorded moby default plus exactly the
      one added rule, and the added rule allows no flag but `CLONE_NEWUSER` and `CLONE_NEWNET`; the compose file names the
      same file. `check-module-actions` extended: with `namespace` and no namespace a bundled module still runs and an
      uploaded one is refused.
    - **11b. The module check** (server-development, core, larger model). Section 9's `server/module-check.js`, the colour
      and words rules moved into `server/` with `check-no-raw-colours`, `check-names` and `check-module-layout` importing
      them, the install calling it (a `refuse` finding refuses, `advise` findings kept with the version), `layoutWarning`
      folded in. `check-modules` runs every bundled module through it and fails on any `refuse` finding; a bundled
      library that trips the action-library list is fixed in that module first (module lane, a bump) or the list is
      narrowed, said in the report. The three moved checks give the same counts as before on `main`.
    - **11c. The validator and the build** (server-development, core, smaller model). Section 9's
      `tools/validate-module.mjs` and the library in a built zip. A new `tools/check-validate-module.mjs`: a set of small
      fixture modules (a clean one, a fixed colour, a typed "space", a bar of its own, a bad manifest, a library naming
      `fetch`, a library that is missing) gives the same verdict, the same findings and the same exit from the validator,
      on the zip and on the folder, as `install()` gives on a throwaway `DATA_DIR`; every bundled module validates as
      accepted.
    - **11d. Uploaded modules run** (server-development, core, larger model; security). Section 8: the upload-only
      refusals and the old refusal removed, `serverRun` and its routes, the hash on every run, the wall, the slot share,
      `may` and `why` in the actions list, the at-once refusal, the agent's queue for uploaded modules removed, the
      approval dropped on uninstall, disable, rollback and replace. The hostile cases in Verify in `check-module-actions`;
      `check-agent-tokens`, `check-mcp`, `check-route-table`.
    - **11e. The Modules page** (experience-design, core page). The findings on an uploaded module's card, the admin's
      approval control with the hash and the warning, the sentence when the server has no wall, and an owner seeing
      "Waiting for the admin to approve running it on the server." with no control. The page's own check
      (`check-module-update-notice` or a new case beside it, the builder's choice), 390 wide.
    - **11f. Documentation** (content-manager). A short "Writing a module" guide for authors outside this repository in
      `documentation/api/` (`api-writing-modules.md`, the planner's lean for the name): the folder, the smallest
      `module.json`, building with `tools/build-module.mjs`, checking with `tools/validate-module.mjs` and what each check
      means, colours from tokens, words from the SDK, the SDK's drawn pieces, an actions library and what the server gives
      it, and what the admin approves. It points to [api-modules](../api/api-modules.md) and
      [api-module-sdk](../api/api-module-sdk.md) for the contract and promises no stability (that is step 12 of
      [plan-release](plan-release.md)). Also: api-modules (the upload rules, `serverRun`, `findings`), api-agents (`may`
      and `why`, no wait), architecture-agent-access and architecture-modules, the deploy guide and settings reference
      (section 10), and known-issues (the Docker line).

After step 10 every bundled module with agent actions declares `actions.server` and none marks anything for a page. A
check then holds it: `check-module-actions` fails when a bundled module offers an agent action without `actions.server`,
or when a library says `carrier === 'server'` to leave work for a page. After step 11 no agent request waits for a page.

## Verify

Checked by a tool, on throwaway servers: each new answer kind applied and rolled back whole; a link to an object the agent
can't see, a schedule about another module's object, a notify without the hook, an environment write without the space's
mark, a person-scope write, more than the counts: each refused and nothing changed. The place search: the worker's
process still has no network (the permission model and an attempted `fetch` in a test library), and the lookup counts
against the agent's reads. Uploaded modules (step 11): an unapproved module's action is refused at once and nothing waits;
an approved one runs; a new version, or one byte changed in its library, is not run until approved again; its handler
can't write environment data, search places or move a phase; a third uploaded run waits for a slot while bundled runs go
on; taking the approval back stops the next run. Each module's own test runs its handlers with `carrier: 'server'` and finds no mark left for a
page.

Step 11, part by part, checked by a tool unless said otherwise:

- **11a.** `check-seccomp-profile` as above. `check-module-actions` with a stand-in for `networkSeal`: `auto` and no
  namespace, bundled runs and uploaded is refused; `namespace` and no namespace, bundled runs (lockdown only) and
  uploaded is refused with the sentence; `namespace` with a namespace, both run, and an uploaded run that can't get its
  namespace is a fault with nothing written. The start-up line for each.
- **11b.** `check-modules`: every bundled module through `checkModule` with no `refuse` finding; each grade's effect on
  `install()` (a `refuse` refuses with its sentence and installs nothing; an `advise` installs and keeps the finding).
  `check-no-raw-colours`, `check-names` and `check-module-layout` pass on `main` with unchanged allow-lists.
- **11c.** `check-validate-module` as above: validator and upload agree on every fixture, zip and folder.
- **11d.** `check-module-actions`'s hostile cases on a throwaway server with a fixture upload: an unapproved module's
  action is refused at once (409, the sentence) and nothing waits or is queued; an approved one runs; a new version, or
  one byte changed in the installed library, is not run until approved again; an owner's approve is 403 and a stale
  version or hash is 409; its handler can't write environment data, search places or move a phase, even with a manifest
  edited on disk past install; a library that reaches for `process`, `require`, `fetch` or a socket at run time gets
  nothing (the worker, not the static check, holds it); a third uploaded run waits for a slot while bundled runs go on;
  taking the approval back, uninstalling, disabling and rolling back each stop the next run. `check-agent-tokens`:
  the router walk with the two new routes refused to an agent's token. `check-mcp`: `list_actions` shows `may: false` and
  `why`. `check-route-table`.
- **11e.** The page check in headless Chromium: the card for the admin and for an owner, with and without the wall.
- **11f.** `npm run check:docs`.

Not checkable here: the seccomp profile in a real Docker container on a real host (the cloud container here runs no
Docker), so whether Thomas's NAS kernel allows the user namespace is first seen in its start-up log; a module written by
a real outside author; a real agent asking an uploaded module.

Not checkable here: a reminder or a poll's announcement reaching a person at its time (needs a page signed in and time
passing; checked by hand); a real agent (Claude, ChatGPT) chaining steps against a real server. No step needs a LiveKit
call.

## Risks, worst first

1. **Network for the place search.** Only the server searches, before the run, through the module's own declared
   geocoder and its settings; the run's process keeps no network and no way to call back. A handler can't choose what is
   searched beyond the declared input's text.
2. **Environment writes.** An agent writing outside its space could reach every space's data. Held by the module's own
   permission, own kinds only, and the space's mark being required in the value.
3. **More side effects to roll back.** Links, schedules and announcements in one step with the writes; a notification
   already sent can't be taken back, so `notify` is applied last, only after everything else stood.
4. **A schedule hook on Polls.** A manifest hook change; the admin approves it as any hook.
5. **Code that is not ours on the server** (step 11). `vm` is no boundary; the boundary is the separate process with
   Node's permission model, no network, no files and no environment, killed on its limits. What is left is a flaw in Node
   or V8 that escapes that process, which would run as the server's own user. The admin's approval of exact bytes is the
   gate, and the answer is checked as if the agent had sent it, so a hostile handler that stays in the box can do no more
   than the agent may. Running the process as a separate system user is not in this plan. Decision 3 adds the kernel's
   network namespace as a second wall for uploaded code: with it, even a flaw that escapes Node finds no network.
6. **The seccomp profile opens user namespaces in the container** (step 11a). Making a user namespace reaches kernel code
   that has had its own flaws, and the profile lets anything in the container do it, the server included. Held to the two
   flags the runner needs, and off unless the admin uncomments the line. This is the price of decision 3's wall.
7. **A static check read as a boundary** (step 11b). The action-library list is easy to slip past on purpose; it is there
   to help an honest author and to make a hostile one obvious, never to keep anything out. The worker and the admin's
   approval of exact bytes are what hold.
8. **The validator and the upload drifting apart.** Held by there being one function, and by `check-validate-module`
   running both on the same fixtures.

## What is not decided

Taken on the planner's lean, not asked; Thomas may change any:

- The place search runs before the handler, from a declared input (section 3), not as a second round trip.
- An agent's person-scope writes are refused rather than stored in the agent's own scope.
- The phase end moves only within the agent's rights, else the note says why.
- Polls' time-close announcement becomes a server schedule for people's polls too, since decision 8 is for all things.
- The counts (5 links, 5 schedules, 1 notify) and the order of the steps.

Step 11 (2026-11-25), taken on the planner's lean, not asked; Thomas may change any:

- `ACTION_RUNNER_NETWORK=namespace` changes meaning (section 8): it becomes the switch for uploaded modules, and bundled
  modules run with the lockdown alone wherever there is no namespace, under either value. This is how "uploaded only
  with the wall" and "bundled keep working with the lockdown alone" both hold with the variable set in the compose file.
- The compose file sets `ACTION_RUNNER_NETWORK` but keeps the `security_opt` line commented, because a missing profile
  file stops the container. The other way: the line on, and copying the file becomes a step of every install.
- The admin approves per environment (the approval is in the environment's registry), and on the environment's Modules
  page; the host console lists nothing.
- Style findings (colours, words, `host.*` reuse) advise and never refuse; only the manifest, the permissions rules and
  the action library refuse. Refusing style would refuse false hits an outside author can't allow-list, and today's
  bundled modules too.
- An upload's `lookups`, `skipLookupWhen` and `phaseEnd` are refused at install rather than ignored.
- The validator runs from a clone of this repository; no published package for now.
- The names: `serverRun`, `/api/modules/:id/server-run`, `server/module-check.js`, `api-writing-modules.md`,
  `deploy/seccomp-action-runner.json`, and the sentences.

No question blocks the build. Uploaded modules were decided by Thomas (decisions 2 and 3), the validator (decision 4) and
the phase-end right (decision 5); the details of sections 8 to 10 are leans.
