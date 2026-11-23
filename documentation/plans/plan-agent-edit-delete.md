# Agent Edit and Delete Plan

**Audience:** Thomas decided that an agent may delete with permission that comes from a person, how that permission is
given, and that an ordinary agent's changes get a review list with Undo (Decisions). He decides the open questions.
server-development builds the shared delete and undo path, the records, the gate's rows, the routes, the MCP tools and the
checks (`server/`, `tools/`, larger model; security); experience-design builds the shared review piece, the approval
dialog, the Roles row and each module's edit and delete actions (module lane, one bump each); quality-assurance reads the
server half as a security change; content-manager documents.

**Status:** draft, 2026-11-23. Not approved; nothing built. Thomas, 2026-11-23: "i no longer agree with "never delete".
I think "never delete without permission to do so which comes from the user"". Asked how an agent gets that permission,
he chose the option **Right plus approval for each delete**. Asked whether ordinary agents should also get a visible
review list, he answered "yes, add the review list with undo". The request behind it is a real-work test (ChatGPT as an
agent, sandbox "Agent: All Modules"): asked to "clean up the itinerary so the fields are corrected and not in notes, then
add a reminder", it found no action to edit an existing Itinerary entry, added new typed flights and a Calendar event
beside the old entry, and reported that it could not set terminal, gate, airline or airport codes and that a reminder
offers only 0, 15, 60 minutes or 1 day. The project manager's rule "Fix the structure, not the symptom" applies: this
plan is the whole fix, one contract for editing and deleting, not a stopgap. It changes decision 7 of
[plan-agent-access](plan-agent-access.md) and decision 4 of [plan-agent-matrix](plan-agent-matrix.md) (pointer notes are
on both).

## Decisions

Only what Thomas decided. The planner's leans are under "Options" and "What is not decided".

1. **"Never delete" becomes "never delete without permission from a person"** (Thomas, 2026-11-23: "i no longer agree
   with "never delete". I think "never delete without permission to do so which comes from the user""). This replaces
   decision 7 of plan-agent-access for module objects.
2. **The permission is a right plus an approval for each delete** (Thomas, 2026-11-23, the option "Right plus approval
   for each delete"). An owner grants agents a **Delete** right on the Roles grid, off by default, per environment. With
   the right an agent may *ask* to delete one object; nothing is deleted until a person approves that one request
   (**Approve** or **Decline**, reached from the bell, with **Undo** after), as the set-up agent's asks work. Without the
   right it cannot even ask.
3. **Ordinary agents get a review list with Undo** (Thomas, 2026-11-23: "yes, add the review list with undo"). What an
   ordinary agent added, changed or (with approval) deleted is listed in words, each with **Undo** for a few days, and its
   delete asks wait in the same **Waiting for you** list the set-up agent's asks use. One place for what waits, one for
   what was done and can be undone.

## What it is today

Read as code on `origin/main` at `3652c8e5` (2026-11-23), unless said otherwise.

### What an agent may ask for

- The gate's list is `AGENT_ROUTES` in `server/agent-routes.js`; each entry declares `needs` (a Roles row, `module` or
  `always`). The ordinary agent changes things only through `POST /api/spaces/:id/action` (MCP `ask_for_change`), and only
  actions for which `agentMayAsk` holds: `effect: "write"`, not `local`, not `askerOnly`, not `ai: false`
  (`server/agent-routes.js:110`). `effect` is `write` or `destructive` (`server/action-catalog.js:20`); no bundled module
  declares `destructive`.
- A request waits on the bus until a person with write access has the module open; their page claims it and carries it
  out (`host.actions.provide`, `public/sdk/host.js:5076`), with `ctx.credit` naming the asker.
- The server names the asker on a write only as a hint, and only when the write **creates** a key
  (`carriedFor`, `server/index.js:10600`). An overwrite or a delete made for an agent is recorded as the carrier's own.
- The agent's page in Manage > Users has only **What it did** (the log, no content) for an ordinary agent. The set-up agent
  alone has **Waiting for you** and **Changes you can undo** (`public/agent-page.js` `loadAsks`, `loadChanges`;
  `public/admin.html` `data-agent-asks-section`, `data-agent-changes-section`), backed by `server/setup-records.js`
  (`agent-setup.json`: asks and changes, 7 days) and `GET /api/users/:key/asks`, `POST .../asks/:id`,
  `GET /api/users/:key/changes`, `POST .../changes/:id/undo`, all owners and the admin only. A new set-up ask reaches the
  owners as one bell line linking to the agent's page (`moduleHooks.announce`, `server/index.js:6307`).
- The Roles grid's sentence under the grid says an agent never deletes or clears anything (plan-agent-matrix decision 4).

### Edit and delete actions, module by module

From each `modules/<id>/module.json` (non-local actions only; `local` actions are views an agent never gets).

| Module | What an agent can make | Edit today | Delete today |
|---|---|---|---|
| Planner - Projects (`schedule`) | milestone, work, note (`plan`) | `setDone`, `updateEntry` (`title`, `date`, `start`, `end`, `owners`, `notes`) | none |
| Planner - Itinerary (`travel`) | stop, journey, stay, note (`plan`) via `addStop`, `acceptSuggestion` | `setStopPlace` only | none |
| Calendar (`calendar`) | event via `createEvent` | none | none |
| To-do (`todo`) | task via `createTask` | `updateTask` (`title`, `notes`, `remind`), `setTaskDue` (a date is required, so a due date can't be cleared), `setTaskDone`, `linkTask` | none |
| Polls (`polls`) | poll via `createPoll` | none | none |
| Goals (`goals`) | goal, step, note (`plan`) | none (no edit, no done) | none |
| Budget (`budget`) | cost via `addCost` | none | none |
| Maps (`maps`) | place via `addPlace` | `updatePlace`, `setPlacePoint` | none |
| Research (`research`) | note, link via `saveNote`, `saveLink` (`savePhoto` is `askerOnly`, never an agent's) | none | none |
| Documents, Whiteboard, Vault, Stream, Assistant | nothing (no agent action) | none | none |

Calendar's `createEvent` also has no notes input, though the form has a description.

### Deleting and Undo for people

- A person's page deletes one object with `DELETE /api/modules/:id/data/:key` (`server/index.js:13278`): the module's
  guards (`checkDelete`), what belongs to it (a poll's votes, `childrenOf`), hidden fields, Calendar copies (`copyRemoveRefusal`,
  #857), and `objectSync.afterWrite`, which removes or marks objects in other modules that hold it (`holds.onDelete`,
  `server/object-sync.js:90`). There is no undo for one object.
- **Clear** and its **Undo** (`server/module-holds.js`, `tools/check-clear-undo.mjs`): a Clear holds what it took on disk in
  `DATA_DIR/modules/<id>/trash/<scope>.json` for `CLEAR_UNDO_SECONDS` (default 30, at most 600), one hold per module and
  scope, survives a restart, and Undo puts back exactly that, Calendar copies included.
- A Calendar reminder is a host schedule the Calendar page sets and cancels (`remind:<id>`, `modules/calendar/src/calendar.js:1059`).
  A delete done without the page open does not cancel it today.

### Typed fields for a flight, and reminders

- The objects format already carries every flight field (`DETAILS.flight` in `server/object-format.js:68`): `airline`,
  `number`, `from` and `to` (each `{ code, name }`), `departs`, `arrives`, `minutes`, `terminal`, `gate`, `seat`, `class`,
  `reference`, `cost`, `currency`, `travellers`.
- `acceptSuggestion`'s `object` input maps them onto the Itinerary's own typed fields (`objectFields`,
  `modules/travel/src/travel-lib-object.js:39`): airline to `operator`, `number`, `fromCode`/`from`, `toCode`/`to`, the
  departure and arrival, `terminal`, `gate`, `seat`, `class` to `travelClass`, `reference` to `confirm`, the cost to the
  Estimated in the trip's currency, and `travellers` to the people it is for when a name matches a member exactly (any
  other name is a notes line). Read as code only; not run against a real agent.
- So an agent *can* make a fully typed flight today, but has no way to know it: `list_actions` shows the input as
  `"object": "object?"` with no hint and no schema, `acceptSuggestion` has no hint for `object`, and
  `GET /api/objects/format/schema` is not on the gate's list. And there is no way to change an existing entry.
- There is one seat per booking (`seat`, text), not one per passenger.
- Calendar's reminder is minutes before the start, one of 0, 15, 60 or 1440, in the person's form
  (`modules/calendar/src/calendar.html:46`) and in `createEvent` alike (`EVENT_REMINDS`,
  `modules/calendar/src/calendar-lib.js:283`); the notification's words are fixed per value (`calendar.js:1073`). The
  agent is held to exactly what a person can choose. To-do's reminder is a yes or no at 9:00 on the due day. The
  Itinerary has no reminder of its own; its dated entries show in Calendar as copies (`mirror: "out"`).

### Related plans

- [plan-assistant-reboot](plan-assistant-reboot.md), steps 6 and 7 (planned, not approved): an MCP tool `object_format`
  and an Itinerary action that "changes only the fields the object gives". Its decision 7 puts Update after its steps 1 to
  4. This plan uses the same tool and the same action (see Open question 7).
- [plan-admin-agent](plan-admin-agent.md): the asks, Approve, Decline, Undo, 7 days, caps and `madeBy` this plan reuses.

## Options

### A. How an approved delete is carried out

| Option | Cost | Rules out |
|---|---|---|
| **A1. The server deletes it, at the moment of approval**, through the same path a person's page delete takes, as the approver, and holds a copy for Undo. | One shared delete function (extracted from `DELETE /api/modules/:id/data/:key`), keyed holds. No page needs to be open. | A module's own delete code (the Itinerary's "Delete both legs" menu); one ask deletes one object. |
| A2. The approval puts a request on the bus, and the module's page deletes it with its own code. | A delete handler and an undo per module; waits for an open page after the approval. | A server-side tie between the approval and the exact key; the page could delete something else. |

Lean: **A1**. The approval is tied to one key at one version on the server, nothing waits after a person said yes, and
Undo is one piece for every module. The modules already cope with one object going: a round trip's return becomes
one-way when its outbound goes, a poll's votes go with it by its guards, and object-sync handles copies and holders.

### B. How a module declares that an agent may ask to delete

| Option | Cost | Rules out |
|---|---|---|
| **B1. An action with `effect: "delete"`** and exactly one required input, a pointer to the module's own kind (`"entry": "ref:travel:plan"`), no handler. | Manifest validation; listed by `list_actions` like any action, with its label and description. | Nothing; a module that does not declare one is never deletable by an agent. |
| B2. A flag on a kind in `refs.produces` (`"agentDelete": true`). | No action entry. | The agent's "what I can ask for" list shows nothing about it unless a second list is added. |

Lean: **B1**: one list (`list_actions`) says everything an agent may ask for, and the module opts in per kind.
`destructive` stays as it is and stays refused.

### C. Edits: direct or approved

| Option | Cost | Rules out |
|---|---|---|
| **C1. Direct, as any write** (plan-agent-access decision 6), each edit in the review list with Undo (decision 3). | The earlier value kept per edit for the undo days. | Nothing. |
| C2. Every edit waits for approval, like a delete. | A click per change; Planner work stalls. | "Runs the real project without a click per change", the reason for decision 6. |

Lean: **C1**. Undo answers the harm an edit can do, and decision 6 stands.

### D. Where the review list shows

| Option | Cost | Rules out |
|---|---|---|
| **D1. On the agent's page (owners and the admin, every space) and in each space (that space's approvers), one shared piece.** | One drawn piece used in two places, plus the set-up agent's two lists moved onto it. | A member sees no list. |
| D2. On the agent's page only. | Least work. | A moderator, who may approve a delete in their space, has nowhere to see or undo. |

Lean: **D1**.

## Carrying out agent requests without an open page

Thomas, 2026-11-23, asked why an agent's request is not carried out until someone opens the space, and observed: "if the
user was asking the agent to do several things, the data would be stale because it would not have been created yet". He
chose "Yes, add it to that plan", so it is analysed here for him to decide with the rest (Open question 1). It changes
decision 14 of plan-agent-access ("The wait for an open page: accepted", 2026-11-16) only if he chooses so.

### Today

- **Modules run no server code** (plan-agent-access, "Changing a space"). A request waits in the module's queue (up to 7
  days) until a person with write access has the module open; that page claims it, carries it out with the module's own
  code and reports back (`/api/bus/actions/pending`, `claim`, `complete`). `ctx.by` and `ctx.credit` come from that page.
- A bundled module runs in the page; an uploaded one runs in a sandboxed frame with no network but the host bridge
  (`runModeOf`, [architecture-modules](../architecture/architecture-modules.md)).
- Each bundled module already keeps its model in plain libraries with no page in them (`src/<id>-lib*.js`, inlined into
  the page at build; `tools/check-travel.mjs` runs the Itinerary's on its own in Node). The action handlers themselves
  live in the page scripts (`travel.js`, `calendar.js` and so on), mixed with the page.
- The server already holds every module to its declared rules on every write, whoever writes: permissions, `guards`
  (owner fields, `need`, `others`, `parent`, hidden fields, `exclusive`), object-sync (copies, holders). What it does not
  hold is each module's own form rules (an end after its start, a round trip's legs, a phase), which live in the libraries.
- **What it costs, seen in real tests:** an agent can't read back what it made or get the new object's pointer until a
  page carries the request out; it can't chain steps (make a hotel, then link a cost or a reminder to it); three requests
  sat `pending` until the space was opened. GitHub #980 noted "a server-side way to carry them out would remove this and is
  still a decision" (as reported to the planner; the issue was not read from here).

### The options

**E1. The server carries out requests to bundled modules, with each module's own code** (lean).

- **How:** a bundled module may declare `"server": "src/<id>-lib-actions.js"` in `actions`: a plain library, no page, no
  `require`, exporting one pure function per action, `(input, { read, credit, now, tz }) => ({ writes, ref?, data? })`,
  that uses the module's existing libraries (the same functions the page's editor uses, moved there once, and the page then
  calls them too, so there is one copy of each rule). A small shared runner in the server (`server/module-actions.js`)
  loads it in a Node `vm` context with only those inputs, a time limit (1 second) and a size limit, and applies its
  `writes` through the same internal write and delete path the data routes use: the module's permissions, `guards`,
  object-sync, limits, the live `changes` event so open pages refresh, and the review list's records (section 4).
- **Who carries it:** the agent itself, with its Agent column's rights, as the asker. `by` and `credit` are the agent's,
  honestly, with no hint. A request the agent's own rights do not allow is refused at once, with the module's sentence.
- **Uploaded modules keep the wait.** Their code is not ours, and `vm` is not a security boundary, so it never runs in the
  server process. Their requests wait for a page, as today.
- **Fixes:** reads after writes (the request is `done` with the new pointer in the same call), chaining, offline spaces,
  and stale data, for every bundled module. **Does not fix:** uploaded modules.
- **Cost:** L in all: the runner M; each module's handlers moved into a library S to M (ten modules; the edit actions of
  step 1 are written there from the start, so they are not written twice).
- **Risks, security first:** module code in the server process (bundled only, shipped with the product and tracked in
  `tools/module-versions.json`; the `vm` context gets no `require`, `process` or network, only data the runner reads for
  it, and the runner checks every write as if the agent had sent it, so a faulty handler cannot write more than the agent
  may); a handler that loops (the time limit); a request carried twice (the bus's claim is the one state change, the server
  claims as the carrier, so a page can't also claim it). An approved delete is unchanged: the server already carries it out
  (option A1) with the approver's checks.
- **With edit, delete, the review list and Undo:** simpler. The server writes, so it knows each value before and after
  and records `added` and `edited` directly, with no tie through `carriedFor`; the SDK runner's tagging (step 4) is then
  needed only for uploaded modules. Delete approval and Undo are unchanged.

**E2. A headless carrier.** The server runs a hidden browser page per space that opens the modules and carries out waiting
requests with their unchanged page code.

- **Fixes:** the same as E1, for uploaded modules too, without moving any code.
- **Cost:** L, and a running cost: a headless Chromium in the server image (about 300 MB) and a page per busy space (about
  100 to 300 MB of memory each); on a hosted server with many environments, many of them. Start-up of a page is seconds, so
  "done in the same call" still needs a wait.
- **Risks, security first:** the page needs a signed-in identity. As the agent, it breaks decision 1 of plan-agent-access
  (an agent never signs in through any page); as a service person, it carries a person's rights that nobody chose. An
  uploaded module's code then runs with that session in a real browser on the server. Credit, undo records and the
  approval tie all go through a page again.
- Lean: no. It is the heaviest way to keep code that E1 moves once.

**E3. A softer fix: say exactly what waits, and let the agent wait well.**

- **How:** `ask_for_change` answers whether a page is open to carry it ("waiting for someone to open <module> in
  <space>"); `request_status` gives the new object's pointer once done (today it gives `ref` when the page returns one);
  a `wait_for_result { space, request, seconds }` tool holds up to 30 seconds for the result; open pages of that module in
  that space are woken by the live stream (they already are, by `action` events, when open).
- **Fixes:** the agent knows what is pending and stops guessing. **Does not fix:** reads after writes, chaining or offline
  spaces when nobody has the module open, which is the case Thomas saw.
- **Cost:** S. **Risks:** none new; a waiting call holds a connection, so it counts as a read and is capped.
- Lean: build it as part of E1, for uploaded modules, which keep the wait.

**E4. Leave decision 14 as it is.** Costs nothing; fixes nothing of what Thomas saw. Every edit this plan adds would also
wait for a page, so "clean up the itinerary, then add a reminder" still could not chain.

**Lean: E1 with E3 for uploaded modules.** It is the structural fix: one copy of each module's rules, run where the
request lands, by the agent with its own rights, and it makes the review list's records exact. It changes decision 14 for
bundled modules, so it is Thomas's to decide.

### What it changes in the build order

Yes, if E1 is chosen. The runner comes first (new step 1), the edit actions are written as server handlers from the start
(step 2, so they are not written twice), and each module's existing handlers move into its actions library in the same
module-lane step. Step 4 then records server writes directly, and keeps the SDK runner's tagging only for uploaded modules.
If Thomas keeps decision 14, the runner step is dropped, E3 is built alone, and the rest stands as written.

## The contract

### 1. Editing (every module whose objects an agent can make)

- **Rule:** every module that offers an agent an add action offers an edit action for that kind, taking the object's
  pointer and only the fields given, with the same fields the add takes and the same checks and refusal sentences as the
  module's own editor. An empty text field clears it; a field left out is kept. Each is `effect: "write"`, so it is direct
  and labelled (option C1), and recorded for the review list (section 4).
- **An edit acts on the original.** A Calendar copy of another module's object refuses an edit with "That is a copy;
  change it in <module name>." (copies follow their originals, #857).

| Module | Add (action, input) | Purpose |
|---|---|---|
| Itinerary | `updatePlan { entry: "ref:travel:plan", object: "object?", title, date, time, minutes, endTime, cost, notes, placeRef }` (all but `entry` optional), `takes` as `acceptSuggestion` | Any entry's fields, typed fields through `object` as a patch (section 5). This is plan-assistant-reboot's step 7 action. |
| Calendar | `updateEvent { event: "ref:calendar:event", title, date, time, endTime, endDate, allDay, repeat, remind, notes }`; `notes` also joins `createEvent` | An event, including its reminder (section 5) |
| To-do | `setTaskDue`'s `date` becomes optional (left out clears the due date); `unlinkTask { task, target }` | The two gaps |
| Polls | `updatePoll { poll: "ref:polls:poll", question, closes, closed }`; options only while nobody has voted, as the form allows (to confirm in the build) | A poll |
| Goals | `updateGoal { entry: "ref:goals:plan", title, why, date, owners, text, goal }`, `setGoalDone { entry, done }` | A goal, step or note |
| Budget | `updateCost { cost: "ref:budget:cost", title, amount, planned, actual, category, payer, sharedBy, date, notes }` | A cost |
| Research | `updateNote { note: "ref:research:note", title, body, tags, icon, kind }`, `updateLink { link: "ref:research:link", title, excerpt }` | A note or a link |
| Planner - Projects, Maps | none: `updateEntry`, `setDone`, `updatePlace`, `setPlacePoint` already cover them | |

Each stays within the host's caps (20 inputs an action, 16 actions a module; Maps goes to 13 with its delete).

### 2. Deleting: the declaration and the gate

- **Manifest** (option B1): `{ "name": "deletePlan", "label": "Delete an itinerary entry", "description": "...", "effect":
  "delete", "input": { "entry": "ref:travel:plan" } }`. Validation (`server/modules.js`): `effect: "delete"` needs exactly
  one input, required, of type `ref:<this module>:<one of its kinds>`; no `takes`, `local`, `askerOnly` or `needs`; at most
  one delete action a kind. The in-app AI's catalog leaves `delete` out, as it leaves out `destructive`.
- **Every module in section 1's list declares one delete action for each kind an agent can make**: `schedule:deleteEntry`,
  `travel:deletePlan`, `calendar:deleteEvent` (the whole event, a series included), `todo:deleteTask`, `polls:deletePoll`
  (its votes go with it), `goals:deleteEntry`, `budget:deleteCost`, `maps:deletePlace` (space places only),
  `research:deleteNote`, `research:deleteLink`. No handler code: the server carries them out (option A1).
- **The Roles grid:** a new row in the Agent column's "Agents" group, key `agentDelete`, worded "Ask to delete
  {objects}", `agentOnly`, default **off**, ticked only by owners and the admin (the Roles grid is theirs today). No box in
  the set-up agent's column. Asking also needs the module's own write row ticked in the Agent column.
- **The gate:** a new entry `{ kind: "agent", method: "post", path: "/api/spaces/:id/delete-asks", counts: "write",
  place: "spaceParam", needs: "agentDelete" }`, and `GET /api/agent/asks/:id` joins the ordinary agent's kind (`always`).
  `agentMayAsk` stays `write` only, so `POST /api/spaces/:id/action` refuses a delete action with 403 "Ask for that with
  ask_to_delete; a person must approve it."
- **What the agent can never delete or ask to delete,** whatever is ticked: a space, a member, any account, another agent
  or itself, a token, the environment, a setting, a role, a template, a module or a whole module's data (Clear), anything
  in Chat (anyone's message, its own included), environment or person-scope data (an environment place marked for its
  space included), a Calendar copy (it asks for the original), an uploaded file directly, Documents, Whiteboard and Vault
  content, and any kind whose module declares no delete action. The sentence under the Roles grid changes to say so:
  "An agent never deletes without a person's approval, and never deletes {spaces}, people, Chat messages, settings or
  roles; ..." (the rest as today).

### 3. A delete ask

- **What the agent sends:** `POST /api/spaces/:id/delete-asks { object: { module, kind, id, scope: "space", space },
  reason? }`. `reason` is plain text, at most 200 characters, shown to the approver as the agent's own words. Any other
  key is 400.
- **What the server checks, in order:** the gate (token, `agentDelete`, the space is the agent's); the module is on there
  and the Agent column has its write row; the module declares a delete action for that kind; the pointer maps to a key
  that exists in that space's scope (else 404 "That isn't there."); not a copy; no waiting ask for the same object (409
  "There is already an ask to delete that."); not declined in the last 7 days (409 "A person declined deleting that.
  Don't ask again before <date>."); the caps (429).
- **What it stores:** an ask `{ id, agent, space, ask: "delete", object: { module, kind, id, scope, key }, version,
  reason, at, state }` where `version` is the key's version at the moment of asking. Keys and ids only, never the
  object's content.
- **What it answers:** 202 `{ ask: { id, state: "waiting", expiresAt } }`. `GET /api/agent/asks/:id` answers `waiting`,
  `approved`, `declined`, `expired` or `undone`.
- **Expiry and caps:** an ask not answered in 7 days expires; Turn off or Revoke expires the agent's waiting asks; at most
  10 delete asks waiting at once per agent and 30 a day, each also a write against the agent's 20 a minute and 300 a day.
  Over: 429 with the existing sentence.
- **The log:** one line, `{ kind: "write", route: "/api/spaces/:id/delete-asks", module, request: <ask id>, status }`,
  never the reason or a title.

### 4. Records, review list and Undo (one store, one drawn piece)

- **One store for agents' asks and changes.** `server/setup-records.js` becomes `server/agent-records.js`, its file
  `agent-records.json` per environment (a clean rename; no migration, per the rule before release). It keeps today's
  set-up asks (`add`, `remove`, `moderator`) and changes (`made`, `changed`), and adds the ask `delete` and three object
  changes: `added`, `edited`, `deleted`, each `{ id, agent, space, change, object: { module, kind, id, scope, key },
  request?, ask?, at, versionAfter, held?, undoneBy?, undoneAt? }`. Ids and keys only.
- **The earlier values live beside the module's data, not in the record.** `ModuleHolds` (`server/module-holds.js`) gains
  keyed holds: one file per change in `DATA_DIR/modules/<id>/trash/agent/<change id>.json`, holding the object's value
  before an edit, or the object and what went with it (children, holders object-sync removed) before a delete. Same
  disk rules as Clear's holds (written before the change, survives a restart, an unreadable file set aside). Kept for the
  undo days, then removed with its record. An added object holds nothing (Undo removes it).
- **How an add or an edit is recorded.** When the server carries the request (option E1), it writes, so it holds the
  earlier value and records the change itself. When a page carries it (an uploaded module, or every module if Thomas keeps
  decision 14): the SDK's `host.actions.provide` runner sends `for` and `request` on every data write a
  handler makes while it carries out a request (one change in the shared path, so every module is covered). The server's
  `carriedFor` keeps naming the asker only for a create, as decision 9 of plan-agent-access says, but for any write it
  can tie to an agent's claimed request (same checks: this module, claimed by this carrier, within the minute, the same
  place, at most 10 objects) it records the change and, for an overwrite, holds the earlier value first. A write it can't
  tie is the carrier's own and is not in the list.
- **How a delete is recorded:** by the approval (section 6), as `deleted` with its hold.
- **Undo, by change:**
  - `added`: removes the object through the shared delete path, only while its version is still `versionAfter`.
  - `edited`: puts back the held earlier value, only while the version is still `versionAfter`.
  - `deleted`: puts back the object and what went with it under the same keys, only while those keys are still empty;
    object-sync makes the Calendar copies again, as Clear's Undo does. A Calendar reminder is not set again until someone
    opens the Calendar (to confirm in the build; if the page does not re-apply it, the Undo says "The reminder is off;
    set it again in Calendar.").
  - Set-up `made` and `changed`: unchanged.
- **Refusals, one plain sentence each** (the `why` the set-up agent's undo already gives): "That has been changed since, so
  undo would lose that change.", "Something new is there now.", "That was undone already.", "That is too old to undo.",
  "That is gone." Undo answers 409 with it; the list shows it greyed in place of **Undo**.
- **Who may undo:** owners and the admin, anywhere; a person who may approve in that space (section 6); and in either case
  only if that person may make that change in the module themselves (its write permission and guards, checked as them).
  The agent never undoes. The undo is written as that person and named in the module's activity list ("Undid Claude
  (agent)'s change").
- **How long:** 7 days (`SETUP_UNDO_DAYS`, renamed `AGENT_UNDO_DAYS`, one number for both kinds).
- **Caps on what is held:** a held value over 256 KB is not kept (the change is listed with "Too large to undo"); the held
  values of one environment are at most 50 MB, the oldest dropped first (its change then reads "That is too old to
  undo."). A deleted space drops its records and holds (`server/space-erase.js`).

**The routes** (people only; an agent token gets 403 on all of them, as off the gate's list):

| Method | Route | Who | Answer |
|---|---|---|---|
| GET | `/api/users/:key/asks`, `/api/users/:key/changes` | owners, admin (as today) | now for both kinds; each entry with `text` in words |
| GET | `/api/spaces/:id/agent-review` | that space's approvers | `{ waiting: [...], done: [...] }`, that space's asks and changes, every agent |
| POST | `/api/spaces/:id/asks/:askId` | that space's approvers | `{ decision: "approve" \| "decline", version }` (section 6) |
| POST | `/api/spaces/:id/changes/:changeId/undo` | as "Who may undo" | 200 `{ ok, change }`, or 409 with the sentence |

`POST /api/users/:key/changes/:id/undo` covers object changes too.

**The shared piece (experience-design).** One drawn piece, `public/agent-review.js`, draws both lists: **Waiting for you**
(each ask in words with **Approve** and **Decline**) and **What it changed** (each change in words with **Undo**, or its
`why`). It is used on the agent's page for both kinds (replacing the set-up agent's own `loadAsks` and `loadChanges`)
and in the space (its "Agents" view, opened from the bell line and from the space's menu for that space's approvers).
An entry's words come from the server, from the object's summary through the module's `refs.produces`, never a raw id:
"Claude (agent) changed the flight "Flight to Lisbon" in Itinerary, in Lisbon 2027, 2 hours ago", "added a task
"Book the taxi" in To-do", "deleted the stop "Old flight notes" in Itinerary, approved by Ana". An object that is gone
shows its title as it was when held.

**The bell and the badge.** Each new delete ask sends one bell line to each person who may approve it: "Claude (agent)
asks to delete the stop "Old flight notes" in Itinerary, in Lisbon 2027.", opening the space's review view at that ask.
The count of waiting asks a person may decide joins the bell's count and Manage's badge (which counts updates only today).
An agent's edits and adds send no bell line.

**The activity log.** The agent log keeps its shape and holds no content. **What it did** reads a delete ask as "Asked to
delete a stop in Itinerary in Lisbon 2027" and adds the outcome from the record ("approved by Ana", "declined", "undone
by Thomas"). The module activity list (`noteActivity`) names both people on a delete: "Claude (agent), approved by Ana".

### 5. Typed fields and reminders

- **The objects format reaches the agent (shared path, core).** `GET /api/objects/format/schema` joins the gate's list
  (`always`), and an MCP tool `object_format` answers it (plan-assistant-reboot step 6, the same tool). `list_actions`
  gives, for each action with an `object` input, `objectKinds`: the kinds it takes, each with its `details` fields and
  types from `DETAILS`, and the host adds a hint for the `object` input when the manifest gives none ("A typed object:
  { kind, title, details }; see objectKinds."). One change in `GET /api/spaces/:id/actions`, so every module that takes
  objects is covered at once.
- **Itinerary's `updatePlan` takes `object` as a patch.** `travel-lib-object.js` gains `objectPatch(object, entry)`:
  only the details given change, the title is not required, and the kind may change as the person's editor allows (a
  plain stop with the flight in its notes becomes a typed flight). Notes lines that a field now holds are left to the
  agent to rewrite through `notes`.
- **Passengers and seats:** `travellers` already sets the people a booking is for; one `seat` text holds several seats
  ("12A, 12B"). No per-passenger seats in this plan (see Open question 8).
- **Reminder lead times (Calendar):** see Open question 6. Lean: `remind` becomes any whole number of minutes from 0 to
  40320 (28 days), in `createEvent`, `updateEvent` and the person's form alike (the form keeps its presets and adds
  "Other" with a number and minutes, hours or days), and the notification's words are worked out from the number ("Starts
  in 2 hours"). The agent stays held to exactly what a person can set.

### 6. Approving a delete

- **Who:** see Open question 2. Lean: owners and the admin, and that space's moderators; each only for an object they
  could delete themselves in that module (its write permission and `checkDelete` guards, as them). Nothing an agent sends
  is a yes.
- **What the approver sees** (the shared piece's dialog): the agent's name with its mark, the space, the module, the
  object as the server resolves it now (kind, title, day, who made it), what goes with it ("and its 12 votes", "and 1
  Itinerary entry that shows it"), how many objects link to it, the agent's reason as a quote headed "Claude (agent)
  says:", and **Delete** (danger) and **Decline**.
- **Tied to one object.** The dialog sends back the `version` it showed. The server, in one synchronous step from its
  check to its write: the ask is `waiting` and this space's; the key is the ask's key; its version equals both the ask's
  `version` and the one sent (else the ask ends as expired, 409 "That changed since Claude asked. Nothing was deleted.");
  the approver passes the module's checks. Then it holds a copy, deletes through the shared path as the approver, records
  `deleted`, and sets the ask `approved`. A second answer is 409 (the same answer twice changes nothing, as today).
- **After:** a toast "Deleted. Undo" and the change in **What it changed** with **Undo** for 7 days.
- **Decline:** the ask ends `declined`; the same object can't be asked again for 7 days.

### 7. MCP and what the agent is told

- `list_actions` lists delete actions with `effect: "delete"`, `approval: "each"` and `may` (true only with the Delete
  row and the module's write row), and their description says "Use ask_to_delete; a person approves each one."
- New tools for the ordinary agent: `ask_to_delete { space, object, reason? }` and `ask_status { ask }` (the set-up
  agent's, now both kinds'), and `object_format`. `me` lists `agentDelete` in `permissions` when ticked.
- `ask_for_change`'s description says edits are direct and a person may undo them for 7 days.

### 8. The kinds of agent

- **Ordinary agents, pasted token or a signed-in app** (plan-mcp-oauth makes an app an agent): all of the above, the same
  column, the same right.
- **The set-up agent:** unchanged. It never deletes; an owner's Undo of a space it made stays as plan-admin-agent says.
  Its lists move onto the shared piece.
- **The in-app AI:** unchanged; it never sees `delete` actions.

## Left to build, in order

Each step is built and checked on its own. Thomas names the kind of build. This order assumes the lean on Open
question 1 (E1); if he keeps decision 14, step 1 becomes E3 alone and step 2's handlers stay in the pages.

1. **The server runner** (server-development, larger model; security). `server/module-actions.js`: the `actions.server`
   declaration (bundled modules only), the `vm` context and its limits, writes through the shared write path as the agent,
   the bus claim by the server, `request_status` with the pointer, and E3's `wait_for_result` and pending words for
   uploaded modules. New `tools/check-module-actions.mjs`; `check-agent-tokens`, `check-mcp`.
2. **The edit actions, and each module's handlers moved into its actions library** (experience-design, module lane, one
   patch bump each). Section 1's list, To-do's two gaps, Calendar's `notes`, each with the editor's checks and sentences,
   shared by the page and the server; `objectPatch` for the Itinerary. Each module's own test runs its handlers in Node.
   (Calendar's reminder change waits for Open question 6.)
3. **The objects format reaches the agent** (server-development, core). The schema route on the gate, `object_format`,
   `objectKinds` and the host's hint in the actions list. `check-mcp`, `check-agent-matrix`, `check-route-table`.
4. **The shared delete path and keyed holds** (server-development, larger model; security). One delete function used by
   `DELETE /api/modules/:id/data/:key`, the runner and the approval; keyed holds in `ModuleHolds`; restore; schedules about
   a deleted object cancelled. `check-clear-undo` extended; a new `tools/check-agent-review.mjs` begun.
5. **One store and the change records** (server-development, larger model; security). `agent-records.js`; `added` and
   `edited` recorded with holds from the runner's writes, and, for uploaded modules only, from page writes the SDK runner
   tags with `for` and `request`; Undo for both; the caps; the review routes. `check-agent-setup` moved onto the new
   store; `check-agent-review`.
6. **Delete asks and approval** (server-development, larger model; security). `effect: "delete"` validation,
   `agentDelete` row, the gate entry, `delete-asks`, the approve and decline route, the bell line and count, the log
   words, `ask_to_delete`, `ask_status` for both kinds, `list_actions`' `approval`. `check-agent-matrix`, `check-mcp`,
   `check-agent-tokens`, `check-route-table`, `check-agent-review`.
7. **The pages** (experience-design). `public/agent-review.js` on the agent's page (both kinds) and the space's review
   view, the approval dialog, the Roles row and sentence, the bell count. `check-agent-pages`.
8. **The delete actions** (experience-design, module lane, a patch bump each). One per kind, as section 2 lists.
9. **QA** (quality-assurance): the security read and the pen-test cases below. **Documentation** (content-manager).

## Verify

Checked by a tool on throwaway servers (single install and `BASE_DOMAIN` with two environments):

- **`tools/check-agent-review.mjs`** (new): without the row an ask is 403; with it but without the module's write row,
  403; a kind with no delete action, a copy, an environment place, a person-scope key, a missing key are refused with
  their sentences; an ask changes nothing; the agent token gets 403 on every approve, decline, review and undo route;
  approving deletes exactly the asked key and nothing else; a changed version refuses and deletes nothing; a second
  approval, a decline after approval and a replayed approve body against another ask are 409; an approver who may not
  delete that object is 403; Undo restores the object, its children and its Calendar copies; Undo after a later edit
  refuses with the sentence; an agent's create and edit appear as `added` and `edited` and undo cleanly; a write the
  server can't tie to a request is not recorded; holds survive a restart; caps (waiting, per day, decline cooldown,
  256 KB, 50 MB) give their answers; records and holds go with a deleted space; no title, reason or value in a log line.
- **`tools/check-module-actions.mjs`** (new, step 1): a request to a bundled module with a server handler is `done` in
  the same call with its pointer, and a second request can link to it; the write carries the agent's key and is refused
  where the Agent column or the module's guards refuse the agent; a handler that throws, loops past the time limit or
  writes outside its module and place changes nothing; a page can't claim a request the server carried; an uploaded
  module's request still waits and `wait_for_result` returns when a page carries it or at its time limit; the vm context
  has no `require`, `process` or network.
- **`check-agent-matrix`:** `agentDelete` is an Agent-column row, off by default, no box for `setup`; every list entry
  still has its `needs`.
- **`check-mcp`:** `ask_to_delete`, `ask_status`, `object_format` listed for the ordinary agent; `list_actions` shows
  `approval: "each"` and `objectKinds`.
- **`check-agent-tokens`:** the router walk with the new routes; the action route refuses `effect: "delete"`.
- **`check-agent-setup`:** unchanged behaviour on the new store.
- **`check-clear-undo`:** Clear and its Undo unchanged by the shared delete path.
- **`check-agent-pages`** (headless Chromium): both lists on the agent's page for both kinds, the space's review view, the
  dialog, a refused Undo's sentence, 390 wide.
- **`check-route-table`:** the new routes in `tools/route-table.json`.
- Each module's own test (`npm run check:module -- <id>`) for its edit and delete actions.

Not checkable here: a real agent (Claude, ChatGPT) reading `list_actions` and choosing `ask_to_delete` or
`object_format`, and the bell line as a person sees it. A Calendar reminder firing after an Undo needs a page and time;
it is checked by hand. No step needs a LiveKit call.

## Risks, worst first

1. **A delete without both the right and an approval.** The only code that deletes for an agent is the approve route,
   run by a person's session; the agent's token never reaches it (not on the gate's list, and the route refuses
   `req.agent`). Proven by the router walk.
2. **An approval not tied to the exact object.** The ask holds module, scope, space, key and version; approval deletes
   that key at that version and nothing else; the dialog shows what the server resolves now, not what the agent said.
3. **Replay.** Each ask moves once, synchronously from check to write, as `setup-records` does; an approved ask can't be
   approved again or pointed at another key; a hold is undone once.
4. **A misleading ask.** The reason and the title are the agent's or a person's words; the dialog labels the reason as the
   agent's, shows who made the object and what goes with it, and caps the reason. Text read from Chat can still steer an
   agent into asking; the approval is the check.
5. **Module code in the server process** (option E1). Bundled modules only; no `require`, `process` or network in the
   context; a time limit; every write checked as if the agent sent it, so a faulty handler can do no more than the agent
   may. An uploaded module never runs there.
6. **Approval fatigue.** One object an ask, no "approve all", 10 waiting and 30 a day, a 7-day cooldown after Decline.
7. **An edit or a recorded write named wrongly.** With E1 the server writes and knows; for uploaded modules recording
   reuses `carriedFor`'s conditions, and a write it can't tie is the carrier's own. Undo is only offered while nothing
   changed since.
8. **Side effects of a server-side delete.** Holders in other modules, Calendar copies, votes and reminders. object-sync
   and the guards cover the first three; the reminder needs the schedule cancelled (step 4).
9. **Held values grow.** The 256 KB and 50 MB caps and the 7 days bound them; a space's delete drops them.

## What is not decided

Most important first. Each has the planner's lean; none is decided.

1. **Should the server carry out agent requests to bundled modules, without waiting for an open page?** (See "Carrying
   out agent requests without an open page".) Lean: yes, option E1, with E3 for uploaded modules: the agent's request is
   carried out at once by the module's own code, as the agent, so it can read back and chain; uploaded modules keep the
   wait. It changes decision 14 of plan-agent-access for bundled modules. Blocks step 1 and the shape of step 2.
   Not in this lean: people's own requests (Chat's Keep, Send to...) would keep the page path; whether they should use the
   runner too is a later question.
2. **Who may approve a delete?** Lean: owners, the admin, and that space's moderators, each only for an object they could
   delete themselves. ("As the set-up agent's asks work" could be read as owners and the admin only, which leaves a
   moderator unable to answer in their own space.) Blocks step 6.
3. **Who sees the review list in a space, and who may undo there?** Lean: that space's approvers (as question 2) see the
   whole list; Undo by them, only for a change they could make themselves; members see no list. Blocks step 7.
4. **How long Undo lasts.** Lean: 7 days, the set-up agent's number, one number for both kinds. Small; taken unless
   Thomas says otherwise.
5. **Edits direct or approved?** Lean: direct with Undo (option C1), as plan-agent-access decision 6. Blocks nothing if
   the lean stands.
6. **Reminder lead times.** Lean: any whole minutes from 0 to 28 days in the form and the action alike (section 5).
   Alternatives: more presets only (5, 30, 120 minutes, 2 days, a week), or keep the four. To-do's 9:00 reminder and an
   Itinerary entry's reminder (set on its Calendar copy, not confirmed possible today) stay as they are under this lean.
   Blocks Calendar's part of step 2.
7. **Order against plan-assistant-reboot.** Its decision 7 puts the Itinerary's Update after its steps 1 to 4. Lean:
   build `updatePlan` here in step 2, since agents need it now, and let the reboot's step 7 add only the preview's
   **Update** rows on the same action. Blocks the Itinerary's part of step 2.
8. **Per-passenger seats.** Lean: not in this plan; several seats as one text. A model change for people too.
9. **May an agent ask to delete objects others made?** Lean: yes, the approval is the check, and the real case (an old
   entry a person made) needs it.
10. **An agent's own Chat messages.** Lean: stay out; Chat is not a module object and decision 7's Chat part stands.
11. **The reason text.** Lean: allowed, 200 characters, labelled as the agent's words.

Small choices this draft takes at the planner's lean, for Thomas to change: the route and tool names, the caps (10
waiting, 30 a day, 256 KB, 50 MB), the 7-day decline cooldown, one waiting ask per object, and options A1, B1 and D1.
