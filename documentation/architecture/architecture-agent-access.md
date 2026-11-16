# Agent access architecture

**Audience:** developers changing agent accounts, their tokens, the route gate, the limits or the log (`server/tokens.js`, `server/agent-log.js`, `agentGate` and the agent routes in `server/index.js`, `public/agent-page.js`), and module authors who need to know who asked for an action (`ctx.byKey`).

This is what is built of [plan-agent-access](../plans/plan-agent-access.md): its steps 1 to 4 (the token core, the pages, the Planner's two new actions and the asker carried through the bus). Step 5, Chat reading and posting, is not built; "What is not built" says what that leaves out. The plan is the contract; "Where the code differs from the plan" lists the places it does not follow it. The routes, with their bodies and errors, are in [Agents API](../api/api-agents.md). For the owner's side see [Agents](../userguides/userguide-agents.md).

## What it is

An **agent** is an account that is not a person: Claude, or another assistant, working in the spaces it is added to. It never signs in through a page. Its only way in is a **token**, sent as `Authorization: Bearer agt_...`. The server treats a request with that token as the agent's, and only the agent's: it lets through a short list of routes (the **gate**), counts every call against limits, and writes every call to a log with no content. An owner makes the agent, makes and revokes its token, turns it off and reads its log; nothing the agent holds can do any of that.

An agent has at most a member's rights, in the spaces it is a member of, narrowed further by the gate. It can read what a member reads there and ask a module for a change, and nothing else. It cannot delete, clear, restore, change a setting, role or member, join a call, or make another token.

## The two switches

- **`AGENT_TOKENS`** (the server, default off): `true` turns agents on for the server. Any other value is off, and a value that is neither `true` nor `false` logs a warning. With it off, nothing in the gate runs: an `agt_` token is read as any unknown bearer value, and a server without the variable behaves exactly as before. It is in the compose file as a commented line. See the [Settings reference](../userguides/userguide-settings-reference.md).
- **Agents** (each environment, `settings.agents`, default off): the owner's switch on Manage > Users. `PATCH /api/settings` takes `{ agents: true | false }`; turning it on while the server's variable is off is refused (403 `Agents are off on this server.`), and turning it off always goes through. `GET /api/settings` for owners carries `agentTokens` (the server's variable) and `agents`.

Both must be on to make an agent or a token, and for a token to work. Reading an agent, revoking its token, turning it off and deleting it never need either, so an owner can always stop one.

## The agent account

`store.addAgent` (`server/store.js`) makes a user record with `agent: true`, role `member`, a display name (default "Claude"), a login `agent-<key>` that no door accepts, no password, no personal link and no second factor. `sanitizeUser` enforces this on every load, whatever a stored record or a restored file says: an agent is never the host admin's stand-in, always a member, never a moderator, and carries no password, link, two-step secret, calendar feed, external calendar or first-password record. `off: true` is kept while its owner has turned it off.

- **No door signs it in.** `resolveLoginUser` skips an agent, the personal-link lookup (`server/store.js`) never finds one, and `currentUser` never returns an agent from a cookie session (`req._user` is set to null for it). It is never online, never in the call and never sent a notification (the notification recipients in `server/environment.js` leave agents out).
- **What it can't be or have** is refused with 400 `An agent can't be that.` (`AGENT_CANT_BE`): a role other than `member`, a password, a personal link, a change of login, being made the server's admin, starting two-step enrolment, and the moderator tick in any space.
- **Names.** `store.checkDisplayName` refuses, for every person and agent, a name that ends in `(agent)` (400 `A name can't end in (agent).`) or has `carried out by` in it (400 `A name can't have "carried out by" in it.`). Both are compared as a person reads them, with lookalike letters folded and any white space as one space (`endsWithAgentMark`, `hasCarriedWords` in `server/guest-door.js`). A name stored before the rule is shown plain in the activity list, and one that still reads so is shown as "someone". The "(agent)" mark on a page comes from the account's `agent` flag, never from the name.
- **Spaces.** It is a member of a space only when an owner adds it in Set up, as any member, where it shows as `<name> (agent)` with no moderator tick. `agentWorksIn` is the one test of where an agent works: a member of the space who may enter it (so not while the space is closed for set up, which lets in no ordinary member) and a space that is not the Lobby. The Lobby holds every account and nobody is added to it, so the Lobby is never an agent's space.
- **Deleting** the agent deletes its token. What it added keeps its `by` key.
- `publicUser` carries `agent: true` and `off` for an agent. Its profile page redirects to its page in Manage (`public/profile.js`).

## The token

`server/tokens.js` is general by `kind`; the first kind is `agent`, with the prefix `agt_`. Another kind (a personal token, in [plan-ai-integration](../plans/plan-ai-integration.md)) could reuse it.

- A token is `agt_` and 32 random bytes in base64url (43 characters). It is given out once, by `POST /api/users/:key/token`, and never kept: only its SHA-256 is stored, in `DATA_DIR/tokens.json` of the environment, as `{ id, kind, user, hash, createdAt, expiresAt, lastUsedAt, lastAddress }`. `id` is random and names the token in the log. The file is private to the server's user (mode 0600) and written through a temporary file and a rename.
- **Thirty days, one live token per agent.** Making a new token ends the old one. A record that lives longer than 30 days, was made more than five minutes in the future, is malformed or is a second for the same agent and kind is not read, so a hand-made file can't plant a longer-lived token.
- **Finding a token** checks its shape (`agt_` and exactly 43 base64url characters) before it hashes it, then compares the hash against every record in constant time, so the time taken says nothing about which one matched.
- **Last use.** `lastUsedAt` and `lastAddress` (kept only when it is an IP address, never the free text a client may send in a forwarded header) are held in memory at once and written to the file at most once a minute, and on the way out. A call refused for a limit touches nothing.
- **Never accepted** in a cookie, a query string or a form field: only the `Authorization` header is read (`agentBearer`).

## The gate

`agentGate` runs once, before every route, for a request whose `Authorization: Bearer` value starts with `agt_`. It does nothing when `AGENT_TOKENS` is off, and none of it applies on the product host or the host console, which have no environment.

1. Whatever else the request carries (a cookie session) is never read: `req._user` is set to null first.
2. The token is looked up in this environment's own `tokens.json`, so a token made in one environment is never found in another. It is refused when it is unknown, past its end, its agent is gone, is not an agent or is turned off, or the environment's **Agents** switch is off. Every reason is the same answer: 401 `{ "error": "That agent token is not valid." }` with `WWW-Authenticate: Bearer`. A refusal for a token that is a real agent's, but no longer good, leaves one line a minute in that agent's log; an unknown token names nobody and leaves none.
3. Otherwise the agent is the request's user and the request is matched against the gate's list, with Express's own router, so a path reads as the app reads it (any case, a trailing slash). Only `GET`, `HEAD` and `POST` are on it; every other method is refused without asking the router.
4. The call is counted against the agent's limits first, whatever it is, so a refused call costs as much as any other (below).
5. A body that could not be read is answered 400 as before, after it has been counted and logged.
6. A route not on the list answers 403 `{ "error": "An agent can't do that." }`. A route on it runs its own check of the place the call names: a space the agent is not in answers the unknown space's 404 (`no such <space word>`), and a scope other than `space` answers 403 `An agent can't do that.`

The list (`AGENT_ROUTES`):

| Method | Route | Counts as | Place check |
|---|---|---|---|
| GET | `/api/agent/me` | read | none |
| GET | `/api/modules/:id/context` | read | `scope=space` and a space of the agent's |
| GET | `/api/modules/:id/data` | read | the same |
| GET | `/api/modules/:id/data/:key` | read | the same |
| GET | `/api/objects/search` | read | the same |
| GET | `/api/objects/links` | read | the `ref` is a pointer into one of its spaces |
| GET | `/api/objects/kinds` | read | none |
| POST | `/api/objects/resolve` | read | every pointer (of the first 50) is into one of its spaces |
| GET | `/api/spaces/:id/actions` | read | the space is one of its own |
| POST | `/api/spaces/:id/action` | write | the same |
| GET | `/api/spaces/:id/action/:requestId` | read | the same |

`GET /api/spaces/:id` (the Set up read) is not on the list: it answers a member "owners only" whatever it is asked, so it would give an agent nothing. An agent learns its spaces from `GET /api/agent/me`.

**Beyond the list.** The action route refuses for an agent, with 403 `An agent can't ask for that.`, an action that is `local`, `askerOnly`, `destructive` (no `effect` of `write`) or `ai: false` (`agentMayAsk`), and the actions list leaves those out for it. Every pointer in an action's input must be into one of the agent's own spaces (403 `An agent can't do that.`), so an action can't be used to learn what is elsewhere. `GET /api/objects/links` leaves out a link that goes outside its spaces. An agent reads no data with `scope=environment`, `spaces` or `person`, and does no raw data write: `PUT` and `DELETE` on data, Clear, restore, uploads, settings, roles, members and tokens are all 403, because they are not on the list. A request the agent made is read only by the agent's own `GET /api/spaces/:id/action/:requestId` (the route's existing rule: only the person who asked). The action route also asks for the member role's `chat` permission in the space (**Send chat messages**), and the actions list and a request's status for `chatRead`, as they do for anyone: taking those from the member role on the Roles tab stops an agent's requests as it stops a person's.

## Limits

Per agent, in addition to the module limits every person has (`server/agent-log.js`, `AGENT_LIMITS`):

| | A minute | A day |
|---|---|---|
| Reads | 60 | 3,000 |
| Writes | 20 | 300 |

A write is an action request (`POST /api/spaces/:id/action`); every other call on the list is a read, and so is a refused one. Over a limit the answer is 429 `{ "error": "The agent has done as much as it may for now." }` with `Retry-After` (seconds; to the next UTC midnight for a day's limit). The minute's counts are kept in memory (a restart clears them, which costs at most a minute's worth); the day's counts are read back from the agent's log file for the day the first time it calls that day, so a restart does not reset them. A call answered 429 counts against nothing.

## The log

`server/agent-log.js` writes `DATA_DIR/agent-log/<agent key>/<YYYY-MM-DD>.jsonl` (a folder for each agent, a file for each UTC day), one line a call:

`{ at, agent, token, method, route, space, action, request, message, status, address, kind }`

- `token` is the token's id, never the token. `route` is the gate's pattern (`/api/spaces/:id/action`), never the path asked for, so no key or token in an address lands in it; `(refused)` stands for a route the gate does not allow. `space` is set only when it is one of the agent's own. `action` is `<module>:<action>` for an action request and `request` its id. `address` is an IP address or null. `kind` is `read` or `write`, what the call counted against, or null for a line that counted against nothing.
- **Never** a request body, a message's text, an object's content, the token or a session. `message` is reserved for step 5 and is always null.
- A 429, and a 401 for a token that is a real agent's, are not a line each: the first of each minute for each agent and status is written (`note`), so every file is bounded by the limits.
- Files older than 30 days are deleted whole, on start and once a day. A read of a day's file takes at most its last 8 MB.
- `GET /api/users/:key/agent-log` (owners and the admin) answers the last 100 lines, newest first, with `before` for older ones. Manage's **What it did** is that list in plain words.

## Isolation and copies

- **Per environment.** `tokens.json` and `agent-log/` are in the environment's own data folder, and `Tokens` and `AgentLog` are made for each environment (`server/environment.js`). A token of one is 401 at another. The limits are per environment too, since they are counted from its files.
- **An owner's copy** (`server/environment-export.js`) keeps the agent accounts (`agent` and `off` are on the allow-list of a person's fields) but never `tokens.json` or `agent-log/`, so a restore of it leaves every agent without a token and with no history. A restore **drops** those two names from a copy a person made by hand, compared in lower case with `\` read as `/` and with a name holding a NUL dropped, so a zip can't plant a token it chose or spend a limit. The host's own backup (`?backup=1` on the restore) is kept as written, tokens included.
- **A restored person** is cleaned again as any stored record is (`sanitizeUser`), so a restored agent is still a member with no sign-in.

## The asker, through the bus

A module can't see which agent or person asked for an action, only the person whose page carries it out. So the record of a write by an action used to name the page's person, not the asker, and an action-added Planner entry read "Added by someone" (#869). Now the asker travels with the request (`server/module-bus.js`, `server/index.js`).

- **`byKey`.** The request records the asker's key as `by`. `publicAction` tells the page that takes it `by` (the asker's name) and `byKey` (the key, or null for a guest or a person no longer here).
- **Claiming.** `claim` records who took it (`claimedBy`, the carrier) and the time of the first claim (`claimedFirstAt`), which a later claim by someone else does not move.
- **The hint.** A page's data write (`PUT /api/modules/:id/data/:key`) may send `for` (the asker's key) and `request` (the request's id). The server treats it as a **hint**: it names the asker only when all of these hold, and otherwise ignores it, so the write is saved as the carrier's own, nobody else is named and nothing is refused:
  - the carrier is a signed-in person, not a guest, and the request is this module's, still claimed by them, not their own and not a view (`local`);
  - it is within one minute of the request's **first** claim;
  - the write lands in the request's own place (its object's space when it names one, else the place it waits in);
  - `for` is the request's actual asker;
  - the write **creates** a key that is not there yet: never an overwrite, and never a delete;
  - the claim has named fewer than 10 new objects (`carriedWrites`, kept in the stored request so a restart does not give the claim its share again).
  A hint that is not honest (an unknown request, someone else's claim, a name that did not ask) leaves one line a minute for each person in each environment in the activity list: "sent a name for who asked that was not believed and was saved as their own".
- **`for` raises no right.** The carrier's own rights decide the write, as ever. `POST /api/bus/actions/complete` reads no `for`; it records the carrier (`doneBy`) only when the person completing it is the one who claimed it.
- **What the records say.** `moduleData.put` takes `asker`, and the change event carries it. The activity list (`GET /api/modules/activity`, owners) gives, for each line, `askerName` (an agent's with " (agent)"), `askerAgent` (from the account's flag), `carrierName` and `byName`, so a request carried out for someone reads "Claude (agent), carried out by Thomas's page". A request carried out by another person's page also leaves one line, "carried out <action>", when it succeeded. A Calendar copy that `server/object-sync.js` makes fills its `{by}` from the asker.
- **For module authors.** The handler of `host.actions.provide` is called with `{ from, by, byKey }`: `by` is the asker's name, `byKey` the asker's key (a person's key that you may store and look up), or `null` for a guest. The Planner stores it as the entry's added-by. See [Module SDK](../api/api-module-sdk.md). A module needs no change to have its writes named: the server does it from the hint the SDK sends.

## The Planner's actions

Planner - Projects (`schedule`) 0.1.7 provides two actions for an entry that is there, both `effect: "write"` and named by a `ref` to a `plan`:

- `setDone` `{ ref, done }` ticks a milestone, or marks work done or not done. A note has nothing to tick off.
- `updateEntry` `{ ref, title?, date?, start?, end?, notes? }` changes only the fields given: a milestone has a day (`date`), work has `start` and `end`, and a note has none. A day written empty clears it. There is no `progress` input.

Both run under the rights of the page that carries them, check what they are sent with the editor's own rules (`scSetDone`, `scUpdate` in `modules/schedule/src/schedule-lib.js`) and refuse with the editor's sentences, then save as an edit does. `addMilestone`, `addWork` and `addNote` now store `ctx.byKey` as who added the entry, so "Added by" finds the person. Because they act on an object that exists, `setDone` and `updateEntry` join the AI's catalog, which is now six tools: `maps__setPlacePoint`, `schedule__setDone`, `schedule__updateEntry`, `todo__linkTask`, `todo__setTaskDue` and `travel__addToDay` ([AI architecture](architecture-ai.md), "The catalog of write tools"). `tools/check-catalog.mjs` and `tools/golden/catalog.json` list all six.

## The pages

`public/agent-page.js` and the markup in `public/admin.html`, driven by `public/admin.js`. Everything from the server (a name, an address, a route, an action) goes in as text, never markup. For what an owner sees, see [Agents](../userguides/userguide-agents.md).

- The **Users** tab has an **Agents** section (the server's line when `AGENT_TOKENS` is off, the switch when it is on) and **Add an agent** once the switch is on (`POST /api/users { agent: true, displayName? }`). An agent's row reads `<name> (agent)`, has no sign-in, Mute, Kick, two-step or calendar feed, and **Open** goes to its page, `#agent/<key>`.
- The agent's page: name, **Make token** (the token in a dialog, once, with **Copy**), **Revoke**, **Turn off** and **Turn on**, **Delete** (a typed confirmation) and **What it did**, paged with **Show older**.
- A space's Set up members list shows `<name> (agent)`.

## Checks

All three are in `npm run check`:

- `tools/check-agent-tokens.mjs`: the plan's pen-test list for the token core, on throwaway servers, single and hosted: off by default, no sign-in, the token's life and storage, the gate walked from the app's own router stack (`tools/route-walk-preload.cjs`), the refusals for actions and pointers, the limits and their survival of a restart, the log, isolation between environments, copies and restores, and the shape of what is stored.
- `tools/check-agent-asker.mjs`: the asker through the bus, with the bundled Planner and Calendar: the hint's every condition, the cap and the window across a restart, the activity list's fields, the Calendar copy's `{by}`, hosted isolation.
- `tools/check-agent-pages.mjs`: the pages, live in headless Chromium: Agents with the server's variable off and on, Add an agent, the agent's page, the token shown once, Revoke, Turn off, Delete, What it did, text-only drawing, Set up's members and a phone width.

`tools/check-module-host.mjs` (the flush list) and `tools/check-catalog.mjs` were changed by the Planner's work. On `67998604` this documentation pass ran `check-agent-tokens` (33 passed), `check-agent-asker` (12 passed) and the Planner's `check-schedule-actions` (16) and `check-schedule-layout`, and `check-catalog` (6 tools) and `check-module-host` (72 groups); `check-agent-pages` did not run to the end in the cloud container used (its page never drew), so the pages are read as code.

## What is not built

Step 5 of the plan: **reading and posting in Chat**. Today the gate has no Chat route, an agent has no `chatPost` setting and the agent's page has no **Post in Chat**; a Chat message carries no `agent` flag and `message` in the log is always null. The plan's decisions 13 and 17 to 19 (an agent may read Chat and may post, with posting off for a new agent until the owner turns it on) are decided and wait for that step.

## Where the code differs from the plan

- **`GET /api/spaces/:id` is not on the gate's list.** The plan listed it "as a member reads it"; that route answers a member "owners only", so it is left off and an agent gets its spaces from `GET /api/agent/me`.
- **The asker is a hint**, not a record the server believes. The plan said `/complete` and the data write carry `for`; built, `/complete` and `DELETE` never name an asker, and the data `PUT` carries `for` and `request` under the conditions above.
- **The Lobby is never an agent's space.**
- **`GET /api/users/:key/token`** answers `{ token: { id, createdAt, expiresAt, lastUsedAt, lastAddress } }`, or `{ token: null }`, not the bare object.
- **The log** is a folder of day files, not the one `agent-log.jsonl` the plan named.
- **`updateEntry` has no `progress` input.**
- **`GET /api/agent/me`** has no `chatPost` field, since Chat posting is not built.
- **Display names** can't end in `(agent)` or contain `carried out by`; the plan did not name that rule.
- **Agreements.** An agent is exempt from the agreement gate (`agreementExempt` in `server/index.js`): the gate asks a person to agree to `TERMS_FILE` and `NDA_FILE`, and an agent can't read or agree to a text. The owner who made it has agreed. Whether an agent should be held to the same texts is not decided; it is an open question in the plan.
