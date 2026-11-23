# Agent Server Actions Plan

**Audience:** Thomas decided that no agent action waits for a page (decision 8 of
[plan-agent-edit-delete](plan-agent-edit-delete.md)); this plan is how every bundled module gets there. server-development
builds the runner's context, its new kinds of answer and the input fixes (`server/`, `public/sdk/`, `tools/`; core, larger
model for the runner and the write scopes, security); experience-design builds each module's move onto the server (module
lane, a patch bump each); quality-assurance reads the runner changes as a security change when Thomas calls a feedback or
production build.

**Status:** Draft, 2026-11-23. Nothing in it is built. The request, Thomas, 2026-11-23: "in general i want to move away
from 'waits until someone [opens the module]...' for the reasons we have already discussed. I do not want this same
decision to come up one module at a time... this is for all things. An agent is not useful if you also have to be in the
app for it to get real-time updates." The gaps below are the ones the builders of steps 1, 2a and 2b of
plan-agent-edit-delete reported, checked against the code on `origin/main` at `244b327d`.

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

### 8. Uploaded modules

Decision 4 of plan-agent-edit-delete keeps uploaded modules on the wait for a page, since their code is not ours. Decision
8 says no action waits. See the one open question.

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

After step 10 every bundled module with agent actions declares `actions.server` and none marks anything for a page. A
check then holds it: `check-module-actions` fails when a bundled module offers an agent action without `actions.server`,
or when a library says `carrier === 'server'` to leave work for a page.

## Verify

Checked by a tool, on throwaway servers: each new answer kind applied and rolled back whole; a link to an object the agent
can't see, a schedule about another module's object, a notify without the hook, an environment write without the space's
mark, a person-scope write, more than the counts: each refused and nothing changed. The place search: the worker's
process still has no network (the permission model and an attempted `fetch` in a test library), and the lookup counts
against the agent's reads. Each module's own test runs its handlers with `carrier: 'server'` and finds no mark left for a
page.

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

## What is not decided

Taken on the planner's lean, not asked; Thomas may change any:

- The place search runs before the handler, from a declared input (section 3), not as a second round trip.
- An agent's person-scope writes are refused rather than stored in the agent's own scope.
- The phase end moves only within the agent's rights, else the note says why.
- Polls' time-close announcement becomes a server schedule for people's polls too, since decision 8 is for all things.
- The counts (5 links, 5 schedules, 1 notify) and the order of the steps.

**Open, for Thomas (does not block steps 1 to 10):** uploaded modules. Decision 4 keeps their wait; decision 8 says no
action waits. Options: (a) offer an uploaded module's actions to agents only when it ships server actions and the admin
approves running them in the same isolated process (its code is not ours; the process has no network and no files, but
it is still code on the server); (b) do not offer an uploaded module's actions to agents at all, so nothing waits; (c)
keep the wait for uploaded modules only, as an exception to decision 8. Lean: (b) until a plan for (a) is agreed, since
it keeps decision 8 without running code that is not ours.
