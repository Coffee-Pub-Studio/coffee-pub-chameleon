# Agent access architecture

**Audience:** developers changing agent accounts, their tokens, the route gate, the limits or the log (`server/tokens.js`, `server/agent-log.js`, `agentGate` and the agent routes in `server/index.js`, `public/agent-page.js`), and module authors who need to know who asked for an action (`ctx.byKey`).

This is what is built of [plan-agent-access](../plans/plan-agent-access.md): its steps 1 to 5 (the token core, the pages, the Planner's two new actions, the asker carried through the bus, and Chat reading and posting). Steps 6 (the QA pass) and 7 (the Chat documentation) are what is left; "What is not built" says what that leaves out. The server runner and the delete asks, built later by [plan-agent-server-actions](../plans/plan-agent-server-actions.md) and [plan-agent-edit-delete](../plans/plan-agent-edit-delete.md), are described in "The server runner" and "Delete asks and the review of an agent's changes". The plan is the contract; "Where the code differs from the plan" lists the places it does not follow it. The routes, with their bodies and errors, are in [Agents API](../api/api-agents.md). For the owner's side see [Agents](../userguides/userguide-agents.md).

## What it is

An **agent** is an account that is not a person: Claude, or another assistant, working in the spaces it is added to. It never signs in through a page. Its only way in is a **token**, sent as `Authorization: Bearer agt_...`. The server treats a request with that token as the agent's, and only the agent's: it lets through a short list of routes (the **gate**), counts every call against limits, and writes every call to a log with no content. An owner makes the agent, makes and revokes its token, turns it off and reads its log; nothing the agent holds can do any of that.

An agent has at most a member's rights, in the spaces it is a member of, narrowed further by the gate. It can read what a member reads there, read the space's public Chat, ask a module for a change (the server carries it out at once for a bundled module), when its owner has allowed it post in Chat or ask a person to delete one object, and nothing else. It cannot delete itself, clear, restore, change a setting, role or member, join a call, or make another token.

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
- `publicUser` carries `agent: true`, `off` and `chatPost` for an agent. Its profile page redirects to its page in Manage (`public/profile.js`).

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
| GET | `/api/objects/format/schema` | read | none |
| GET | `/api/modules/:id/weather` | read | `scope=space` and a space of the agent's |
| POST | `/api/objects/resolve` | read | every pointer (of the first 50) is into one of its spaces |
| GET | `/api/spaces/:id/actions` | read | the space is one of its own |
| POST | `/api/spaces/:id/action` | write | the same |
| GET | `/api/spaces/:id/action/:requestId` | read | the same |
| GET | `/api/spaces/:id/action/:requestId/wait` | read | the same |
| POST | `/api/spaces/:id/delete-asks` | write | the same; needs `agentDelete` |
| GET | `/api/agent/asks/:id` | read | none |
| GET | `/api/spaces/:id/chat` | read | the same |
| POST | `/api/spaces/:id/chat` | write | the same |

`GET /api/spaces/:id` (the Set up read) is not on the list: it answers a member "owners only" whatever it is asked, so it would give an agent nothing. An agent learns its spaces from `GET /api/agent/me`.

**Beyond the list.** The action route refuses for an agent, with 403 `An agent can't ask for that.`, an action that is `local`, `askerOnly`, `destructive` (no `effect` of `write`) or `ai: false` (`agentMayAsk`), and the actions list leaves those out for it. Every pointer in an action's input must be into one of the agent's own spaces (403 `An agent can't do that.`), so an action can't be used to learn what is elsewhere. `GET /api/objects/links` leaves out a link that goes outside its spaces. An agent reads no data with `scope=environment`, `spaces` or `person`, and does no raw data write: `PUT` and `DELETE` on data, Clear, restore, uploads, settings, roles, members and tokens are all 403, because they are not on the list. A request the agent made is read only by the agent's own `GET /api/spaces/:id/action/:requestId` (the route's existing rule: only the person who asked). The action route also asks for the member role's `chat` permission in the space (**Send chat messages**), and the actions list and a request's status for `chatRead`, as they do for anyone: taking those from the member role on the Roles tab stops an agent's requests as it stops a person's.

## The MCP door

`POST /mcp` (and `GET /mcp`, which is 405) is a remote MCP server in `server/mcp.js`, for a client such as Claude Code. It has no credential of its own: the agent's `Authorization: Bearer agt_...` goes through `agentGate` like any call, so `/mcp` is on the gate's list and every rule above holds. It is stateless and written by hand (JSON-RPC 2.0, no dependency); it is on only with `AGENT_TOKENS`. Its contract is [Agents API](../api/api-agents.md), Part 4.

Each tool is a thin wrapper of one route. A tool call is run as one internal request through the app's own stack, in the same process, carrying the agent's `Authorization` header and the forwarding headers, never a cookie, so the gate, the narrowing, the limits and the log apply to it as to a direct call and it is counted and logged as the wrapped route. The gate does not count the outer `tools/call` envelope (`toolCallOf` in `server/mcp.js` tells it which messages are tool calls, and the gate lets those on uncounted), so a tool call costs one read or one write, never two. Every other message on `/mcp` counts as one read and is logged as `/mcp`. Claude Code and a Claude app both connected and used the tools against a real server (proven by Thomas on 2026-11-20); this page's description of the code is read as code. `tools/check-mcp.mjs` checks the door on throwaway servers: protocol versions, the tool list, counting and logging as the wrapped route, refusals, limits and hosted environments. The agent's log folds a connection's handshake into one line, "Connected through MCP (N messages)". The **Connect Claude** panel (`public/agent-page.js`) is on the agent's page and in the one-time token window; it shows the command, the five steps, a live status and the space line. Agent accounts draw `public/assets/images/brand/agent.svg` unless an image is set. For the owner's side see [Connecting Claude](../userguides/userguide-connecting-claude.md).

## Limits

Per agent, in addition to the module limits every person has (`server/agent-log.js`, `AGENT_LIMITS`):

| | A minute | A day |
|---|---|---|
| Reads | 60 | 3,000 |
| Writes | 20 | 300 |

A write is an action request (`POST /api/spaces/:id/action`) or a Chat post (`POST /api/spaces/:id/chat`), counted when the gate lets the call in, so a post the route then refuses still costs one write; every other call on the list is a read, and so is a refused one. Over a limit the answer is 429 `{ "error": "The agent has done as much as it may for now." }` with `Retry-After` (seconds; to the next UTC midnight for a day's limit). The minute's counts are kept in memory (a restart clears them, which costs at most a minute's worth); the day's counts are read back from the agent's log file for the day the first time it calls that day, so a restart does not reset them. A call answered 429 counts against nothing.

## The log

`server/agent-log.js` writes `DATA_DIR/agent-log/<agent key>/<YYYY-MM-DD>.jsonl` (a folder for each agent, a file for each UTC day), one line a call:

`{ at, agent, token, method, route, space, module, action, request, message, status, address, kind }`

- `token` is the token's id, never the token. `route` is never the path asked for, so no key or token in an address lands in it. When the path matches one of the gate's routes (any method, one trailing slash allowed, an empty segment is no match; `matchRoute` in `server/agent-log.js`) it is that pattern (`/api/spaces/:id/action`), in a let-on line, a refused one, a 401 note and a 429 note alike. Any other path is written as a fixed shape (`refusedRoute`): the app's registered routes are read once, at the first call, into a tree of their fixed words by position (`routeTrie`); a segment stays only where a registered route has that word at that place, every other segment is `:x`, the query is dropped, and it keeps at most 8 segments and 80 characters, in lower case. `module` comes from the `:id` of a module route, or the part of the action before the colon, and only when it is an installed module's safe id (`^[a-z0-9-]{1,40}$`); else null. A 429 on an action route logs `module` null, since the action is not read yet. A line written before the field existed has no `module` key. If reading a route ever throws, the line gets `/:x` and the server logs one error (`agentLogRoute` in `server/index.js`). `space` is set only when it is one of the agent's own. `action` is `<module>:<action>` for an action request and `request` its id. `address` is an IP address or null. `kind` is `read` or `write`, what the call counted against, or null for a line that counted against nothing.
- **Never** a request body, a message's text, an object's content, the token or a session. `message` is the Chat field: a post's message id (12 hex characters) or the number of messages a read carried, else null (`agent-log.js` keeps nothing else there).
- A 429, and a 401 for a token that is a real agent's, are not a line each: the first of each minute for each agent and status is written (`note`), so every file is bounded by the limits.
- Files older than 30 days are deleted whole, on start and once a day. A read of a day's file takes at most its last 8 MB.
- `GET /api/users/:key/agent-log` (owners and the admin) answers the last 100 lines, newest first, with `before` for older ones. Manage's **What it did** is that list in plain words.

## Isolation and copies

- **Per environment.** `tokens.json` and `agent-log/` are in the environment's own data folder, and `Tokens` and `AgentLog` are made for each environment (`server/environment.js`). A token of one is 401 at another. The limits are per environment too, since they are counted from its files.
- **An owner's copy** (`server/environment-export.js`) keeps the agent accounts (`agent`, `off` and `chatPost` are on the allow-list of a person's fields) but never `tokens.json` or `agent-log/`, so a restore of it leaves every agent without a token and with no history. A restore **drops** those two names from a copy a person made by hand, compared in lower case with `\` read as `/` and with a name holding a NUL dropped, so a zip can't plant a token it chose or spend a limit. The host's own backup (`?backup=1` on the restore) is kept as written, tokens included.
- **A restored person** is cleaned again as any stored record is (`sanitizeUser`), so a restored agent is still a member with no sign-in.

## Chat

Step 5 of the plan. Chat is the one place an agent reads what other people wrote and writes where they read it, so it has the most care. The gate decides what is reachable; the routes are the chat's own, with an agent's branch in each.

- **What is on the list.** `GET /api/spaces/:id/chat` (a read) and `POST /api/spaces/:id/chat` (a write). Every other chat route stays 403 `An agent can't do that.`: the live stream, deleting, hiding or changing a message, pictures, **Keep**, link previews, private messages, commands and `/ai`. A `HEAD` is a read; `OPTIONS` is refused by the method rule.
- **Reading** (`agentReadsChat`). The chat's own access check runs first (`chatRead` for the member role, the agent's own space). The reply holds public messages only, newest first, at most 100 (`AGENT_CHAT_PAGE`), and `before` (a 12-hex message id, `CHAT_MESSAGE_ID`) starts at the ones older than that message: 400 `before is a message id.` for another value, 404 `no such message` for an id not among the public ones. `more` is true when older ones remain. A shared AI answer keeps only the pointers the agent may open. A reply is one read, and its log line keeps the count (`res.locals.agentLog = { message: n }`). It needs no **Post in Chat**, and no live stream is opened.
- **Posting** (`agentChatText`). Checked after the chat's own access check (`chat` for the member role) and before the person's post limit, in this order: the account's `chatPost` is on, else 403 `This agent can't post in Chat.`; a JSON body; the body is `{ text }` and nothing else; `text` is a string; it is not empty once cleaned (`cleanChatText`, the cleaning a person's message gets); it is at most 1000 characters (`CHAT_LIMITS.MAX_TEXT`), refused and never cut. The post then takes the same path as a person's: `chatPostLimited` (the same per-account limit and its 429), the first link found for the preview, `chatHistory.add`, the live streams told. Nothing is mentioned or notified. The reply is `{ message }`, and the log line keeps the new message's id, never its text.
- **`chatPost`** is a field on the agent's account (`store.setAgentChatPost`), kept only while on, so it is off for a new agent and for a record that lacks it. `PATCH /api/users/:key { chatPost }` sets it (owners and the admin only; 400 for a person or a non-boolean; turning it on goes through `agentsRefusal`, as making a token does, turning it off never does). It stops posting only: reading, actions and the token are untouched. It is in `publicUser`, `GET /api/agent/me` and an owner's copy. A restore can therefore bring `chatPost: true` on an agent while **Agents** is off; it has no effect until Agents is on, since the token does nothing.
- **The label.** A message by an agent carries `agent: true`, set by `chatHistory.add` only when the chat route passes it, and the route passes it only when the signed-in account is an agent (`Boolean(req.agent) && who.user?.agent === true`), never from the name or the request. Whether a message reads as an agent's is one rule, `postedByAgent` in `server/chat-history.js`, used by the chat routes (`chatLabelled`) and by the AI's context: an ordinary public message by an account (never a guest's, whose `by` is `guest`; never a command or an AI answer) is the agent's when the account is still here and is an agent, else, once the account is gone, when the flag kept on the message says so. So a person's message never carries the label, even in a restored `chat.json` that says it does; a guest's never does; and a deleted agent's messages keep theirs. `ChatHistory` drops a stray `agent` field on load.
- **The AI's context** (`server/ai-context.js`) names an agent's message `<name> (agent)` in the chat it gives the model, by the same rule, so the model does not take it for a person's.
- **The pages.** `public/space.js` draws an `agent` mark after the name on a message with `agent === true` (strict: only the server's flag), in the `sdk-status` style of the activity list. The agent's page has a **Chat** panel with the **Post in Chat** switch (`PATCH /api/users/:key { chatPost }`; a refusal shows the server's sentence and the switch goes back), and **What it did** reads the chat lines.
- **What the log says** (`logLine` in `public/agent-page.js`): a `GET` of the chat route reads "Read Chat in <space>", a `POST` that answered 200 "Posted in Chat in <space>", a `POST` that answered 403 "Refused post in <space>"; any other post status reads "Called POST /api/spaces/:id/chat" with "didn't work (<status>)". A post's id is never shown. A read's count is meant to show as "N messages" (see "Where the code differs").

**The prompt-injection path, plainly.** Whatever people write in Chat, guests included, becomes text in front of the assistant that reads it with its token. The server cannot tell an instruction from a message, and no check on the server closes this. What it holds is the other end: the agent's writes go only through the gate's list, an action runs under a person's page and the module's own rules, a post is labelled and bounded to 1000 characters, writes are limited (20 a minute, 300 a day) and every call is in the log without its text. An owner decides what the assistant may read by choosing which spaces it is a member of.

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

## The server runner

An agent's request to a bundled module is carried out by the server at once, not by a page that happens to be open (decision 8 of [plan-agent-edit-delete](../plans/plan-agent-edit-delete.md), built by [plan-agent-server-actions](../plans/plan-agent-server-actions.md)). The contract a module writes against is in [Modules API](../api/api-modules.md), "Actions the server carries". This section is the shape and the reasons.

**The route of a request.** `POST /api/spaces/:id/action` still checks the agent as before. Then `serverCarries` (`server/index.js:9660`) decides whether the server takes it: the module declares `actions.server`, is the bundled version, and every pointer in the input to the module's own kinds is into this space or an environment object marked for it. If so `carryOnServer` (`server/index.js:9698`) runs the library, applies the answer and finishes the request once; the status route and `wait_for_result` read the outcome (`requestOutcome`, `server/index.js:10068`). Otherwise the request goes to the page queue and waits, as it did. That is the one remaining wait for a bundled module, and issue #1117 asks that it be refused plainly instead. `server/module-bus.js` refuses a server-carried request to a page's claim, complete and pending, so it is never done twice, and a request still claimed at a restart loads as failed.

**The process.** `server/module-actions.js` starts each run as its own child process (`createModuleActions`, line 118), not a worker thread: worker memory limits did not hold on Node 22 (a worker grew to 4.7 GB under a 64 MB limit). The limits are 64 MB of heap, 1 s of handler time, a 4 s hard kill, 4 runs at once and 16 queued. The process runs `server/module-actions-worker.js` with Node's permission model on: no file but its own script, no write, no child process, no worker, no environment variables. The library runs in a `vm` context with code generation off and nothing of the server passed in; `vm` is not a security boundary by itself, which is why the rest is there. The answer is checked again outside (`outcomeOf`, `server/module-actions.js:238`): the agent may still ask, the module version is the same, each key is still at the version read, and only then do the writes go through `putModuleValue` as the agent, with `expected` set, all or nothing.

**What the handler can reach.** Only what the server hands it as plain data: the facts (`actionFacts`, `server/index.js:9893`), a copy of the module's own data in that space as the agent may read it, and `ctx.util`, a frozen set of pure helpers built from `public/sdk/host.js` itself in the run's context, so a page and the server run one copy. Code comes only from the deployment's `modules/<id>/`, never from `DATA_DIR`, and an upload that declares `actions.server` is refused at install. A library that needs the browser is named in `actions.pageOnly` and left out of the runner's copy (`libraryOf` in `server/module-build.js`).

**The sandbox has no network** (the lockdown, GitHub issue #1100). Two layers:

1. `server/module-actions-lockdown.js` is loaded with `--require` before the script. It replaces every method on Node's TCP, pipe (unix socket), UDP and resolver handle classes with a function that throws `ERR_ACCESS_DENIED`, and takes away `dns.lookup` and `lookupService`, `inspector.open`, `process.kill`, `process.binding`, `dlopen` and `v8.setFlagsFromString`. If any of the four handle classes cannot be sealed, the run answers a fault and exits.
2. A network namespace where the kernel allows one: the runner probes once at start (`networkSeal`, `server/module-actions.js:97`, `unshare -rn` then `-n`) and starts each run through it, so every IP address, 127.0.0.1 included, is unreachable. It costs about 7 ms a run.

`ACTION_RUNNER_NETWORK` chooses: unset or `auto` uses a namespace where there is one; `namespace` makes it a must, so without one no server action runs and each request answers 500 "<Module> could not carry that out: the server could not shut its code off from the network." with a start-up warning (a commented line is in `docker-compose.yml`). What this does not give: it is not a kernel boundary, so a flaw in Node or V8 that runs native code is not held; the namespace alone does not stop a path-based unix socket (only the lockdown does, so a mounted `docker.sock` would be reachable if the lockdown were bypassed); a default Docker deploy gets the lockdown only, because Docker's default seccomp profile is believed to refuse new namespaces (not tested in a real container); there is no separate system user, seccomp profile or Landlock. The deploy decision is in [TODO](../TODO.md).

**After the writes.** `server/action-effects.js` checks and carries out `links`, `schedules`, `notify` and `phaseEnd`, as the agent, with the same rules as the routes a page uses (`POST /api/objects/links`, the schedule and notify hooks). One refusal puts everything back (`server/module-links.js` and `server/module-hooks.js` have exact-undo methods), so a request is done whole or not at all; the notice goes last because it cannot be taken back. The phase end uses `phaseCover` (`server/index.js`), shared with `POST /api/spaces/:id/phases/cover`, capped at 366 days a call on both. The right is the cover route's rule (write in a module on in the space, space not closed to the asker), so an agent that may write in the Itinerary always has it; narrowing it (a Roles row) is Thomas's call. A phase move by an agent shows in the request's `effects`, but the review list's Undo records writes only.

**The place search and writes outside the space.** `lookups` has the server make one place search before the run and hand the answer in as `ctx.lookups`, because the sandbox cannot ask. A write with `scope: 'environment'` goes through `putModuleValue` like any other and is held to marks the module's own kinds carry, so a handler can add or change an environment place for this space and never touch another space's marks. Environment-scope changes by an agent are not in the review list's Undo, and links from or schedules about an environment object are refused.

**The page adapter.** `host.actions.fromLibrary` (`public/sdk/host.js:6522`, `libraryOutcome` at 6187, `carryLibrary` at 6343) runs the same library on a page with the same rules and sentences ([Module SDK](../api/api-module-sdk.md), "Carrying out actions from a library"). Each module's test runs every handler both ways and requires identical results; `tools/check-module-actions.mjs` holds the hostile cases against a real server.

**Where it differs from the plan.** A process, not a worker thread, for the memory limit. A fixture bundled module (`tools/fixtures/module-actions/fixture-notes/`) proves the runner, and it never ships. `data` reaches the agent without `note`. The page adapter was not part of the first plan and was built for steps 1b and 10. Uploaded modules (plan step 11) are not built: they keep the wait.

## Delete asks and the review of an agent's changes

An agent never deletes (decision 2 of [plan-agent-edit-delete](../plans/plan-agent-edit-delete.md)). It asks, and a person approves each ask. The routes and sentences are in [Agents API](../api/api-agents.md), "Delete asks".

- **The delete path.** `server/delete-path.js` (`createDeletePath`, line 31) is the one place an object is removed: `removeObject` (line 62), `holdEdit` (144) and `undoChange` (176). `DELETE /api/modules/:id/data/:key` calls it with the same answers it always gave, and an approved ask calls it too, so schedules about the deleted object and its children are cancelled the same way. A delete with a hold keeps the object's files until the hold expires, and a file kept by a held change cannot be removed. Undoing a delete asks the module's delete guard as the person undoing it, not as if they were creating the object.
- **The holds.** `server/module-holds.js` keeps what an agent's edit or delete replaced in `DATA_DIR/modules/<id>/trash/agent/<change id>.json` (0600, written atomically; 256 KB each, 50 MB in all, the oldest dropped first, swept hourly), so Undo works for 7 days.
- **The records.** `server/agent-records.js` (`AgentRecords`, file `agent-records.json`; it was `setup-records.js`, renamed with no migration) keeps both kinds of agent's asks and changes in one store: object changes `added`, `edited` and `deleted` (keys and ids only, never a value), delete asks, and `undone`. It is never in an owner's copy of an environment. Caps: 10 waiting, 30 a day, a 7-day cooldown after a decline (`DELETE_ASK_LIMITS`, `server/agent-routes.js:111`); the caps are held in the store because the gate's 20 writes a minute gets in the way of testing them on a live server.
- **The right.** A delete action is a manifest entry with `effect: "delete"`, one required `ref:<this module>:<own kind>` input and no handler: the server carries out an approved delete itself. Ten of them are declared in nine bundled modules ([Agents API](../api/api-agents.md), "Delete asks"); Documents, Whiteboard, Vault, Stream, Assistant and Research's photo and answer kinds have none. The Roles row is `agentDelete` ("Ask to delete {objects}", in the Agents group, in the Agent column only, off by default). An approver's own right is checked by the module's delete guard, so a moderator the module's guards refuse sees the reason in Approve's place and cannot approve.
- **What a person sees.** `public/agent-review.js` is one shared piece used by the space's **Agents** view, the agent's page and `admin.html`: **Waiting for you** (Approve and Decline, or the server's `why` greyed where Approve would be) and **What it changed** (each change's text with Undo, or its `why`). Approve opens the approval dialog; its Delete sends `{ decision: 'approve', version, tz }`. The bell counts asks from `GET /api/notifications` and one notice goes to each approver, opening the Agents view at that ask (`tellApproversOfDeleteAsk`, `server/index.js:6786`). See [Agents](../userguides/userguide-agents.md).
- **Known edges.** The bell can count an ask twice until the list is opened (once as an unread notice, once as a waiting ask). A Calendar copy is refused ("That is a copy; ask to delete it in <module name>.").

## The pages

`public/agent-page.js` and the markup in `public/admin.html`, driven by `public/admin.js`. Everything from the server (a name, an address, a route, an action) goes in as text, never markup. For what an owner sees, see [Agents](../userguides/userguide-agents.md).

- The **Users** tab has an **Agents** section (the server's line when `AGENT_TOKENS` is off, the switch when it is on) and **Add an agent** once the switch is on (`POST /api/users { agent: true, displayName? }`). An agent's row reads `<name> (agent)`, has no sign-in, Mute, Kick, two-step or calendar feed, and **Open** goes to its page, `#agent/<key>`.
- The agent's page: name, **Make token** (the token in a dialog, once, with **Copy**), **Revoke**, **Turn off** and **Turn on**, **Delete** (a typed confirmation) and **What it did**, paged with **Show older**.
- A space's Set up members list shows `<name> (agent)`.
- **How a log line reads.** A data read says "Read <Module name> data in <space>": the environment's own name for the module, from the Modules list the page already has, and only when that is unknown the id title-cased (`my-notes` is "My Notes"). A line whose method the route does not allow, or whose route is off the gate's list, says "Refused: <METHOD> <route>" with the status. The page decides "does not allow" from a small table, `ROUTE_METHODS` in `public/agent-page.js`, that mirrors the gate's list: a read route is `GET` (and `HEAD`), `/api/objects/resolve` and `/api/spaces/:id/action` are `POST`, and Chat is `GET` or `POST`. **For module and gate authors:** a new route on `AGENT_ROUTES` (`server/index.js`) with any method other than `GET` needs an entry in `ROUTE_METHODS`, or the page shows its lines as refused. A new read route also needs a line in `READS` in the same file.

## Checks

These are in `npm run check`:

- `tools/check-agent-tokens.mjs`: the plan's pen-test list for the token core, on throwaway servers, single and hosted: off by default, no sign-in, the token's life and storage, the gate walked from the app's own router stack (`tools/route-walk-preload.cjs`), the refusals for actions and pointers, the limits and their survival of a restart, the log, isolation between environments, copies and restores, and the shape of what is stored. The log's `module` and the route shape are in it too: installed ids only, a hostile path (`../`, a 300-character id, a token, a query) leaving nothing of itself in the log, no line reading `(refused)`.
- `tools/check-agent-asker.mjs`: the asker through the bus, with the bundled Planner and Calendar: the hint's every condition, the cap and the window across a restart, the activity list's fields, the Calendar copy's `{by}`, hosted isolation.
- `tools/check-agent-pages.mjs`: the pages, live in headless Chromium: Agents with the server's variable off and on, Add an agent, the agent's page, the token shown once, Revoke, Turn off, Delete, What it did (the Chat lines included), the Post in Chat switch, text-only drawing, Set up's members and a phone width.
- `tools/check-agent-chat.mjs`: Chat on throwaway servers: the gate's list for the chat routes, reading (the page of 100, `before`, no private message, no other space), posting (the refusals in order, the 1000-character limit, the person's limit), the label (from the account, never a guest's, a deleted agent's kept), the AI context's `(agent)`, the log's `message` field, and every other chat route, `OPTIONS` and a form body refused.
- `tools/check-agent-chat-page.mjs`: in a browser, the agent mark on a message in Chat, live and loaded, at wide and phone widths, and that only the server's `agent: true` draws it.

`tools/check-module-host.mjs` (the flush list) and `tools/check-catalog.mjs` were changed by the Planner's work. On `67998604` this documentation pass ran `check-agent-tokens` (33 passed), `check-agent-asker` (12 passed) and the Planner's `check-schedule-actions` (16) and `check-schedule-layout`, and `check-catalog` (6 tools) and `check-module-host` (72 groups); `check-agent-pages` did not run to the end in the cloud container used (its page never drew), so the pages are read as code.

## What is not built

- **Uploaded modules on the server** (step 11 of [plan-agent-server-actions](../plans/plan-agent-server-actions.md)): their agent actions still wait for an open page. The sandbox's no-network guarantee is held by the lockdown and, where there is one, a network namespace, which uploaded code needs more of, and a default Docker deploy has no kernel network boundary: a deploy decision comes first ([TODO](../TODO.md)).
- **Step 6, the QA pass,** and the reading of the label in Chat on a wide screen and a phone by a person, as the plan says. Step 7, the Chat documentation, is this page, the API page and the user guides.
- **Whether an agent is held to the terms and the NDA** (below) is not decided.
- **Not tried:** a real cloud session calling a real server. Step 5 was read as code on `4fb7b467`; the checks above did not run in the container used for this page.

## Where the code differs from the plan

- **`GET /api/spaces/:id` is not on the gate's list.** The plan listed it "as a member reads it"; that route answers a member "owners only", so it is left off and an agent gets its spaces from `GET /api/agent/me`.
- **The asker is a hint**, not a record the server believes. The plan said `/complete` and the data write carry `for`; built, `/complete` and `DELETE` never name an asker, and the data `PUT` carries `for` and `request` under the conditions above.
- **The Lobby is never an agent's space.**
- **`GET /api/users/:key/token`** answers `{ token: { id, createdAt, expiresAt, lastUsedAt, lastAddress } }`, or `{ token: null }`, not the bare object.
- **The log** is a folder of day files, not the one `agent-log.jsonl` the plan named.
- **`updateEntry` has no `progress` input.**
- **`GET /api/agent/me`** carries `chatPost`, as the plan said it would once Chat was built.
- **Display names** can't end in `(agent)` or contain `carried out by`; the plan did not name that rule.
- **Agreements.** An agent is exempt from the agreement gate (`agreementExempt` in `server/index.js`): the gate asks a person to agree to `TERMS_FILE` and `NDA_FILE`, and an agent can't read or agree to a text. The owner who made it has agreed. Whether an agent should be held to the same texts is not decided; it is an open question in the plan.
