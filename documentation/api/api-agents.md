# Agents API

**Audience:** a developer or an assistant (Claude, or another) that calls the server with an agent's token, and a developer changing the routes that make and manage agents. For the shape of it and the reasons see [Agent access architecture](../architecture/architecture-agent-access.md); for what an owner does see [Agents](../userguides/userguide-agents.md).

An **agent** is an account that is not a person. An owner makes it, adds it to spaces and makes it a **token**. The agent then calls the server with `Authorization: Bearer <token>` and may use the short list of routes below, in the spaces it is a member of, and no other. Everything else answers 403. Agents are off unless the server's `AGENT_TOKENS` is `true` and the environment's owner has turned **Agents** on.

Every error is `{ "error": "<sentence>" }`. A route that names a space or a module uses the environment's own words in its sentences (`no such <space word>`).

## Part 1. What an agent calls

### Sign-in

The token is `agt_` and 43 characters (`agt_` plus 32 random bytes in base64url). Send it only in the `Authorization` header: a cookie, a query string or a form field is never read as a token. A request whose bearer value starts with `agt_` is the agent's or nobody's: any cookie it also carries is ignored.

| Status | Error | When |
|---|---|---|
| 401 | `That agent token is not valid.` (with `WWW-Authenticate: Bearer`) | The token is unknown, past its end, revoked, from another environment, or its agent is turned off or gone; or **Agents** is off in this environment. The same sentence for every reason. With `AGENT_TOKENS` off the token is an unknown bearer value and the server answers as for any request without a session. |
| 403 | `An agent can't do that.` | The route is not on the list below, the method is not `GET`, `HEAD` or `POST`, or the call names a scope other than `space`. |
| 404 | `no such <space word>` | The space is one the agent is not a member of (or the Lobby, or does not exist). |
| 429 | `The agent has done as much as it may for now.` (with `Retry-After`, in seconds) | A limit is reached. |

### Limits

| | A minute | A day (UTC) |
|---|---|---|
| Reads | 60 | 3,000 |
| Writes | 20 | 300 |

A write is `POST /api/spaces/:id/action` or `POST /api/spaces/:id/chat`, and a post counts as one write even when it is refused (the gate counts first). Every other call on the list is a read, and so is a call the gate refuses, so hammering a closed route is bounded too. A 429 counts against nothing. The day's counts survive a restart. Each module's own per-person limits (`overLimit`) apply as well, and the action route's `too many requests in a minute, slow down` (429).

### `GET /api/agent/me`

For an agent's token only (a person's session answers 403 `This is for an agent's token only.`; no sign-in 401).

```json
{
  "agent": { "key": "k3m9x2", "name": "Claude" },
  "chatPost": false,
  "expiresAt": "2026-12-16T10:00:00.000Z",
  "spaces": [{ "id": "a1b2c3d4", "name": "Moving house" }],
  "limits": {
    "reads": { "perMinute": 60, "perDay": 3000, "usedToday": 12 },
    "writes": { "perMinute": 20, "perDay": 300, "usedToday": 3 }
  }
}
```

`spaces` are the spaces the agent is a member of and may enter, never the Lobby. `GET /api/spaces/:id` is not on the list (it answers a member "owners only"); this is how an agent learns its spaces. `name` is the agent's display name as typed, without "(agent)". `chatPost` is whether its owner's **Post in Chat** is on (false for a new agent); see "Chat" below.

### Reading

All of these are `GET` and `POST` routes that exist for modules, with the same answers a member gets, narrowed to the agent's spaces. Their parameters and answers are in [Modules API](api-modules.md); what an agent adds is the narrowing.

| Route | Narrowing for an agent |
|---|---|
| `GET /api/modules/:id/context` | `scope=space&space=<id>` required, a space of the agent's. |
| `GET /api/modules/:id/data` and `/data/:key` | The same. A module's stored values in that space, for the module's `read` permission. |
| `GET /api/objects/search` | The same. Summaries of the objects the asking module `from` may link to. |
| `GET /api/objects/links` | The `ref` (a JSON pointer) must be into one of its spaces (403 `An agent can't do that.` for a pointer with another scope, 404 for a space it is not in). Links that go outside its spaces are left out of the answer. |
| `GET /api/objects/kinds` | None; the kinds of object the modules declare. |
| `GET /api/objects/format/schema` | None; the JSON Schema of a typed object (`{ kind, title, details }`): every kind and the fields and types of its details. Read it before sending an `object` input. |
| `GET /api/modules/:id/weather` | `scope=space&space=<id>` required, a space of the agent's; the module's own `read` permission (403 when the Agent column's view row for it is off). Answers as it does a member ([Weather](api-modules.md#weather)); `{ configured: false }` means weather is not set up. Counts as one read, and only an ask that reaches an outside service counts against the `weather` limit, on the agent's key. A space the agent is not in, or a closed one, is 404 as for every agent read. |
| `GET /api/spaces/:id/weather` | `from` and `to` optional (both or neither); a space of the agent's. The weather of the space's own place, found as the agent ([Weather](api-modules.md#weather)): a place the agent may not read is `place: null`. Counts as one read, and only an ask that reaches an outside service counts against the `weather` limit. A space the agent is not in, or a closed one, is 404. |
| `POST /api/objects/resolve` | Every pointer in `refs` (the first 50 are read) must be into one of its spaces. |
| `GET /api/spaces/:id/actions` | Lists only the actions an agent may ask for (below). Needs the member role's `chatRead` (403 `your role cannot do that` without it). |

A scope of `environment`, `spaces` or `person`, or none, is 403 `An agent can't do that.`. Other modules' data, a person's own data, the environment's, and any space the agent is not in, are out of reach. There is no `PUT`, `DELETE`, Clear, restore or upload.

### Chat

Chat is the one place an agent may read what people wrote and write in the space's own voice. It reaches the public messages of the agent's own spaces and nothing else: not the live stream, not a private message, not deleting, hiding or changing a message, pictures, **Keep**, link previews, commands or `/ai`. Every other chat route answers 403 `An agent can't do that.`, `OPTIONS` included.

**`GET /api/spaces/:id/chat`** (a `HEAD` is a read too). Needs the member role's `chatRead` in the space (403 `your role cannot do that` without it). A space the agent is not in is 404 as everywhere. It works whether **Post in Chat** is on or not.

- `?before=<message id>` gives the messages older than that one. A message id is 12 hex characters; anything else is 400 `before is a message id.`; an id that is not in the space's public messages is 404 `no such message`.
- The answer is `{ "messages": [...], "more": true | false }`: at most 100 messages, **newest first**, public ones only (an agent has no private message and never reads anyone's). `more` is true when older ones remain; ask again with `before` set to the id of the last message you were given.
- A message is as a member reads it, with `agent: true` on an agent's message and no `agent` field on anyone else's. A shared AI answer keeps only the pointers the agent may open, in its own spaces.
- Each reply is **one read** in the agent's limits, however many messages it carries. The log line keeps how many messages came back, never their text.

**`POST /api/spaces/:id/chat`** with `{ "text": "..." }` as JSON. Needs the member role's `chat` permission (403 `your role cannot do that` without it) and the owner's **Post in Chat** on. It is a write. It checks, in this order, after the space and the role:

| Status | Error | When |
|---|---|---|
| 403 | `This agent can't post in Chat.` | **Post in Chat** is off for this agent (the default). |
| 400 | `An agent sends { text } as JSON.` | There is no JSON body, or it is another type (a form, say). |
| 400 | `An agent sends { text } and nothing else.` | The body is not an object, or has a field other than `text`. |
| 400 | `text is the message, as text.` | `text` is not a string. |
| 400 | `The message is empty.` | `text` is empty once control characters are taken out and the ends trimmed. |
| 400 | `A message is at most 1000 characters.` | The cleaned text is over 1000. It is refused, never cut. |
| 429 | `too many messages, slow down` | The per-person post limit that every account has applies to an agent too. |

It answers `{ "message": { "id", "at", "by", "who", "text", "agent": true, "preview"? } }`: `by` is the agent's key, `who` its display name as typed, and `preview` is the first link's `{ url }` when the text has one (nothing is fetched). The message is an ordinary public message: the space's live streams carry it at once, and nobody is mentioned or notified. `agent: true` is set by the server from the account, never from the name or the request; a person's message, and a guest's (`by: "guest"`), never carry it, whatever a stored file says. A message of an agent that was deleted afterwards keeps its label.

**Turning posting on or off** is the owner's: `PATCH /api/users/:key` with `{ "chatPost": true | false }` (below). Turning it off stops posting and nothing else; reading Chat and asking for changes go on.

**What this opens.** Everything people write in Chat, guests included, can reach whatever reads it for the agent, which is Claude's context. No check on the server closes that: text in a message can try to steer the assistant (a prompt injection). What the server holds is what the agent can then do: its writes go only through the gated routes above (an action a module's own rules allow, or a labelled post), within its limits, and every call is in the log. Make an agent a member only of spaces whose Chat you are happy for it to read.

### Asking a module to do something

**`POST /api/spaces/:id/action`** with `{ "action": "<module>:<name>", "input": { ... } }`. For example `{ "action": "schedule:setDone", "input": { "ref": { ... }, "done": true } }`. It answers at once with `{ "id": <request id>, "status": "done", "ok": ... }` (below), or refuses.

An agent's request is never queued for a page. A module that declares `actions.server` has the server carry the request out at once, under the module's own rules and the agent's rights ([Actions the server carries](api-modules.md#actions-the-server-carries)): the answer is `{ "id", "status": "done", "ok": true, ... }` already, with `ref` (the pointer of what it made or changed), `data` and `note` when the module says more. All the bundled modules with agent actions declare it. An **uploaded module** is carried the same way once the admin has approved running its actions on the server and this server has the network wall (the approval and the wall are in [Modules API](api-modules.md#uploaded-modules-and-the-server)); until then the request is refused with 409 and the reason, and nothing is made or kept. A request that points at another space, or at an object outside the space that is not kept for it, is refused with 403. A person's own request (Chat's Keep, **Send to...**) still waits for a page; an agent never takes part in that.

What an agent may ask for is an action that is `effect: "write"` in its module's manifest and is not `local`, not `askerOnly`, not `ai: false`. It checks, in this order:

| Status | Error | When |
|---|---|---|
| 400 | `that <module word> does not offer that action` | `action` is not `<module>:<name>`. |
| 404 | `that <module word> does not offer that action` | The module has no such action. |
| 403, 404 | the place check's sentence | The module is not on in this space, or the agent's role may not read it there. |
| 403 | `An agent can't ask for that.` | The action is `local`, `askerOnly`, destructive, has no `effect` or is kept from AI. |
| 403 | `An agent can't do that.` | A pointer in `input` to another module's object is not into one of the agent's own spaces. |
| 403 | `A change here can only point to this space or to things kept for everyone.` | A pointer in `input` to the module's own objects is neither in this space nor an environment object kept for it. |
| 409 | `Needs the admin's approval to run on the server.` | An uploaded module whose actions the admin has not approved (or approved another version or library). |
| 409 | `This server doesn't run uploaded modules' actions for agents.` | An uploaded module, on a server without the network wall. |
| 409 | `<Module> can't do this for an agent until it is updated.` or `<Module> has no actions that run on the server, so it can't do this for an agent.` | A module whose installed version has no usable server library. |
| 413 | `That request is too large for <Module> to carry out.` | The input is over 64 KB as JSON. |
| 403 | the module's own refusal | The agent's member role may not change that module in this space. |
| 403 | `your role cannot do that` | The member role lacks **Send chat messages** (`chat`) in this space: the action route checks it, so taking it from members stops an agent's requests too. |
| 400, 403 | the module's sentence | `input` fails the action's declared shape (a field missing, an object of the wrong kind). |
| 429 | `too many requests in a minute, slow down` | The action route's own limit. |

The bundled actions an agent can use today are those marked `write` in `modules/*/module.json`; the Planner - Projects ones are `addMilestone`, `addWork`, `addNote`, `setDone` and `updateEntry` (below). The To-do module's `setTaskDone` marks a task done or opens it again; like any action it is carried out by the server at once.

**`GET /api/spaces/:id/action/:requestId`** tells the agent how its own request went, for ten minutes after it finished:

```json
{ "id": 41, "status": "done", "ok": true, "note": "Added." }
```

`status` is `done` for every request an agent makes, since the server carries it at once (`pending`, `claimed` and `expired` belong to a person's request, which waits for a page). When `done`: `ok` is true or false; `error` is the module's one-line sentence when it failed; `note` is a short line the module may send back, both at most 300 characters and one line. For an agent, when `ok`: `ref` is the pointer of what the request made or changed, `data` is what the module says back when it says more (without `note`, at most 8000 bytes), and, for a request the server carried, `effects` says what it did beside the writes (links, schedules, a notice, the phase end). It needs the member role's `chatRead` too. The request is read only by the agent that asked (anyone else's, an unknown one or one from another place is 404 `no such request`); `requestId` is a whole number (400 otherwise).

**What an agent sees of an action.** `GET /api/spaces/:id/actions` gives each action's name, label, description and input. For an agent it also gives `clears` (inputs it may send as `""` to clear them; one left out is kept), `patch: true` (an object input changes only what it gives), `objectKinds` for each object-typed input (the kinds it takes, with their details fields and types, `"*"` for any; see `GET /api/objects/format/schema`) and a default hint, for an action the server carries, `now: true` when it will make it at once, else `now: false` with `may: false` and `why`, one plain sentence (an uploaded module not yet approved, or a server without the network wall; the same sentence the action route refuses with), and, for a delete action, `effect: "delete"` with `approval: "each"`: it is not for the action route, use a delete ask (below). A person's list is unchanged.

### Delete asks

An agent never deletes. With **Ask to delete** ticked in the Agent column of the Roles grid (the `agentDelete` row, off by default; ticked, it applies to every ordinary agent), it may ask a person to delete one object, and nothing goes until an owner, the admin or that space's moderator approves that one ask. A delete action in a module is `effect: "delete"` in its manifest ([Modules API](api-modules.md)); the actions are: Planner - Projects `deleteEntry`, Itinerary `deletePlan`, Calendar `deleteEvent`, To-do `deleteTask`, Polls `deletePoll`, Goals `deleteEntry`, Budget `deleteCost`, Maps `deletePlace` and Research `deleteNote` and `deleteLink`. A set-up agent has no delete asks.

**`POST /api/spaces/:id/delete-asks`** (an ordinary agent's token only) with `{ "object": { "module", "kind", "id", "scope": "space", "space" }, "reason"? }`. `reason` is plain text, cut to 200 characters. It answers 202 `{ "ask": { "id", "state": "waiting", "expiresAt" } }`. Nothing is deleted. An ask waits 7 days. Caps: 10 waiting, 30 a day, a 7-day cooldown on an object after a decline; one waiting ask per object across all agents.

| Status | Error | When |
|---|---|---|
| 400 | `Send { object, reason } as JSON.` | No JSON object body. |
| 400 | `Only object, reason can be sent.` | Another field. |
| 400 | the pointer sentence | `object` is not a pointer with exactly `module`, `kind`, `id`, `scope` and `space`. |
| 400 | `reason is plain text, up to 200 characters.` | `reason` is not text. |
| 403 | `An agent can't do that.` | A set-up agent, or **Ask to delete** is off. |
| 403 | `An agent can only ask to delete <an object> in the <space> it asks in.` | `scope` is not `space`, or `space` is another. |
| 403 | `An agent can't ask to delete that kind of <object>.` | The module has no delete action for that kind, or the agent's role may not. |
| 404 | `That isn't there.` | The object is gone or hidden from the agent. |
| 409 | `That is a copy; ask to delete it in <module name>.` | A Calendar copy. |
| 429, 409 | the records store's sentence | The caps above; a cooldown adds "Don't ask again before <date>." |

**`GET /api/agent/asks/:id`** is the agent's own ask: `{ "ask": { "id", "ask": "delete", "object", "space", "state", "at", "expiresAt", "decidedAt"? } }`. `state` is `waiting`, `approved` (it was deleted), `declined`, `expired` (it ran out, or the object changed after the ask) or `undone` (a person put it back). Never a title, the reason or who answered. Another agent's ask, or none, is 404 `No such ask.` (This route also serves the set-up agent's own asks, with its own shape.)

**A person answers** with `POST /api/spaces/:id/asks/:askId` (owners, the admin and the space's moderators; an agent's token is 403) and `{ "decision": "approve" | "decline", "version"?, "tz"? }`. An approval needs the `version` the ask showed (400 `Send the version the ask showed with an approval.`). `POST /api/users/:key/asks/:id` (owners) answers the same way from the agent's page. An approval carries the delete out through the module's own delete path, as the approver (the module's delete guard checks their right) and with a hold, so Undo works for 7 days. A stale version ends the ask (409 `That changed since <agent name> asked. Nothing was deleted.`); a closed space keeps it waiting; each ask is answered once, the same answer twice changes nothing, the other answer is 409. The module's activity line reads "deleted a poll, approved by <name>". The bell: one line to each owner, the admin and each moderator with the module's write permission, opening the space's Agents view at that ask; `GET /api/notifications` gains `asks`, the count waiting for the person.

**`GET /api/spaces/:id/agent-review`** (owners, the admin, the space's moderators) answers `{ waiting, done, days }`: the delete asks waiting here, oldest first (title, `madeBy`, what goes with it and links only for a person who may read the module there), and every agent's object changes here, newest first, for 7 days, each `{ id, change: "added" | "edited" | "deleted", space, object, moduleName, title, at, text, undone, undoneAt?, undoneBy?, undoable, why? }`. **`POST /api/spaces/:id/changes/:changeId/undo`** (the same people) puts one back, only if they could make that change themselves; 404 for no such change; 409 with one sentence when it cannot be undone now (`That has been changed since, so undo would lose that change.`, `Something new is there now.`, `That was undone already.`, `That is too old to undo.`, `That is gone.`, `Too large to undo.`). Each undo adds an activity line. `GET /api/users/:key/changes` and `.../changes/:id/undo` serve both kinds of agent for owners. The record keeps keys and ids only, never a value, in `agent-records.json`.

### The Planner's actions

Planner - Projects (`schedule`), version 0.1.7, provides:

- **`schedule:setDone`** `{ ref: "ref:schedule:plan", done: boolean }`: ticks a milestone, or marks work done or not done. A note has nothing to tick off.
- **`schedule:updateEntry`** `{ ref: "ref:schedule:plan", title?: string, date?: date, start?: date, end?: date, notes?: text }`: changes only the fields given. A milestone has a day (`date`); work has a `start` and an `end`; a note has no day. A day sent empty clears it. There is no `progress` input.
- **`schedule:addMilestone`**, **`addWork`**, **`addNote`**: add an entry. Each now records the asker's key as who added it.

Both new actions are checked as the editor checks, run under the rights of the page that carries them, and refuse with the editor's sentences (for example `The end is before the start.`, `Give it a title.`, `Say what to change: a title, a day, notes.`, `That is not on the <plan word>.`, `Someone else changed it just now. Try again.`). They are in the AI's catalog ([AI architecture](../architecture/architecture-ai.md)).

## Part 2. What an owner calls

These routes are for owners and the admin (a person's session; an agent's own token is refused by the gate). Not signed in: 401 `sign in first`. A member or moderator: 403 `<Owners> only`, in the environment's word.

### The agent

- **`POST /api/users`** with `{ "agent": true, "displayName": "Claude" }` makes an agent. `displayName` is optional and defaults to "Claude"; nothing else may be sent. Answers 201 `{ user }` (a member in no space). `user` is the same as for a person, with `agent: true`, `off: false`, `hasPassword: false`.

  | Status | Error | When |
  |---|---|---|
  | 400 | `agent must be true.` | `agent` is present and is not `true`. |
  | 403 | `Agents are off on this server.` | `AGENT_TOKENS` is not on. |
  | 403 | `Agents are off in this <environment word>. Turn on Agents in Manage first.` | The environment's **Agents** switch is off. |
  | 400 | `An agent can't be that.` | The body has a field other than `agent` and `displayName`. |
  | 403 | `This <environment word> is at its limit of <n> <member word>.` | The plan's member cap; an agent counts as a member. |
  | 400 | `An agent's name is text.` | `displayName` is not text. |
  | 400 | `A name can't end in (agent).` or `A name can't have "carried out by" in it.` | The name rules, which hold for every account. Other name errors are as for a person. |

- **`GET /api/users`** and **`GET /api/users/:key`** list agents as people, with `agent: true` and `off`.
- **`PATCH /api/users/:key`** renames an agent (`displayName`) and turns it off or on with `{ "off": true | false }`. `off` on a person: 400 `Only an agent can be turned off.`; not a boolean: 400 `off is true or false`. A role other than `member`, a password or a change of login: 400 `An agent can't be that.`
- **`PATCH /api/users/:key`** with `{ "chatPost": true | false }` is the agent's **Post in Chat**. It is off for a new agent, and `chatPost` is in `user` (as `publicUser` shows an agent: `agent`, `off`, `chatPost`) and in the answer. On a person: 400 `Only an agent can have that.`; not a boolean: 400 `chatPost is true or false`. Turning it **on** needs agents on, as making a token does: 403 `Agents are off on this server.` or `Agents are off in this <environment word>. Turn on Agents in Manage first.`; turning it off always goes through. It changes posting only.
- **`POST /api/users/:key/link`** for an agent: 400 `An agent can't be that.` An agent has no personal link, password or two-step sign-in, and can't be an owner, the admin or a space's moderator: each of those answers 400 `An agent can't be that.`
- **`DELETE /api/users/:key`** deletes the agent and its token. What it added keeps its `by` key.
- **`PATCH /api/settings`** with `{ "agents": true | false }` is the environment's **Agents** switch. On, while the server's variable is off: 403 `Agents are off on this server.`; off always works. `GET /api/settings` carries `agentTokens` (the server's variable) and `agents`.

### The token

All three answer 404 `no such user` for an unknown key and 400 `That account is not an agent.` for a person, and are `Cache-Control: no-store`.

- **`GET /api/users/:key/token`** answers `{ "token": { "id", "createdAt", "expiresAt", "lastUsedAt", "lastAddress" } }`, or `{ "token": null }`. Never the token or its hash. `lastAddress` is an IP address or null.
- **`POST /api/users/:key/token`** makes a new token and ends any earlier one. 201 `{ "token": "agt_...", "expiresAt": "<ISO time>" }`: **the only time the token is ever sent.** It lives 30 days. 403 as for `POST /api/users` when agents are off; 409 `This agent is turned off. Turn it on first.`
- **`DELETE /api/users/:key/token`** revokes it at once: `{ "ok": true, "revoked": true | false }` (`false` when there was none). It works while agents are off.

### What it did

**`GET /api/users/:key/agent-log`** answers the agent's last 100 log lines, newest first: `{ "entries": [...], "more": true | false }`. `?before=<ISO time>` gives the 100 before that time (400 `before is a time, like 2026-11-16T10:00:00Z.` for anything else). A line:

| Field | What it holds |
|---|---|
| `at` | When, as an ISO time. |
| `token` | The token's `id`, never the token. |
| `method`, `route` | `GET`, `/api/spaces/:id/action`: never the path asked for. When the path matches a route on the gate's list (any method, any case, one trailing slash allowed; an empty segment is not a match), `route` is that route's pattern, in every kind of line: let on, refused, a 401 note and a 429 note. Any other path is written as a fixed shape: each segment is kept only where one of the app's registered routes has that word at that place (compared in lower case), every other segment is `:x`, there is no query, and it holds at most 8 segments and 80 characters (`/api/users/:x/agent-log`). Nothing the caller chose lands in it. |
| `space` | The space's id, only when it is one of the agent's own. |
| `module` | `string` or `null`. The id of an installed module: a data or context route's `:id`, or the part of an action before the colon. `null` for any other route and for a path off the list. A 429 on an action route has `module` `null`, because the action is not read before the limit answers. Lines written before this field existed have no `module` key. |
| `action` | `<module>:<name>` for an action request. |
| `request` | The request's id for an action request. |
| `message` | For Chat: a post's message id (12 hex characters), or how many messages a read carried (a whole number); else `null`. Never text. |
| `status` | The HTTP status the call got. |
| `address` | An IP address, or `null`. |
| `kind` | `read` or `write`; `null` for a note (a 429, or a 401 for a token that is the agent's but no longer good: written at most once a minute for each). |

A line never holds a request body, a message's text, an object's content or a token. A call with a method the route does not allow (a `DELETE` on a read route) is a line with that route's pattern and status 403. A refused post (403) is a line with the post route and status 403, so the log says it was refused. Lines are kept 30 days.

## Part 3. Who asked, for module authors

A request records its asker. A module's page that carries it out is told, through `host.actions.provide`, `{ from, by, byKey }`: `by` is the asker's name and `byKey` the asker's key (null for a guest or someone no longer here). See [Module SDK](api-module-sdk.md), "Carry out actions".

When the page saves what the request asks for, the SDK sends the asker with the data write, so the server's own records name the asker and not only the page's person:

**`PUT /api/modules/:id/data/:key`** may carry `for` (the asker's key) and `request` (the request's id) beside `value`. It is a **hint**. The server uses it only when all of these hold, and otherwise ignores it, saves the write as the carrier's own and refuses nothing:

- the caller is signed in (not a guest), and is the person whose page claimed that request, which is this module's, still claimed, not their own and not a view (`local`);
- it is within one minute of the request's first claim;
- the write lands in the request's own place;
- `for` is the request's asker;
- the write creates a key that is not there yet (never an overwrite);
- the claim has named fewer than 10 new objects.

`DELETE` on data and `POST /api/bus/actions/complete` never name an asker. `for` raises no right: the carrier's own rights decide the write. What it changes is the record: the activity list (`GET /api/modules/activity`, owners) gives `askerName`, `askerAgent`, `carrierName` and `byName` ("Claude (agent), carried out by Thomas's page"), and a Calendar copy made from the write fills `{by}` with the asker's name. A hint that is not honest leaves one line a minute for each person in the activity list.

## Part 4. The MCP endpoint

`/mcp` is a remote MCP server (Model Context Protocol) for the agent's token: a tool-using client such as Claude Code connects once and gets the routes of Part 1 as tools. It adds no power. Its only credential is the agent's token, read by the same gate, and each tool is a thin wrapper of one route on the gate's list. For the owner's steps see [Connecting Claude](../userguides/userguide-connecting-claude.md). The code is `server/mcp.js`; it is on only while `AGENT_TOKENS` is on (off, `/mcp` is an unknown path).

### Transport

- **Stateless Streamable HTTP, JSON-RPC 2.0.** `POST /mcp` takes one message with `Content-Type: application/json` and answers plain JSON, never an event stream. There is no session and no `Mcp-Session-Id`. A notification (a message with no `id`) or a client's response is answered 202 with no body.
- **`GET /mcp`** answers 405 `This server sends no stream. Send each message with POST.` with `Allow: POST`.
- **Versions.** `2025-11-25`, `2025-06-18` and `2025-03-26`. `initialize` answers the client's own version when it is one of these, else the newest. An `MCP-Protocol-Version` header, when sent, must be one of them.
- **Methods.** `initialize`, `ping`, `tools/list` and `tools/call`. Any other method answers 200 with error -32601. The server offers tools only (`listChanged: false`); no resources, prompts or streams.
- **Credentials.** `Authorization: Bearer agt_...`, as in Part 1, and nothing else. A person's session is 403 `This is for an agent's token only.`; no token is 401 with `WWW-Authenticate: Bearer`; a token that is not good is the gate's 401 (Part 1, "Sign-in").
- **Origin.** A request with an `Origin` that is not this server's own origin is refused (403), to stop a page of another site reaching a server on a private network. A client that is not a browser sends none.

### The tools

All arguments are strict: an argument the tool doesn't list is an error. `space` is a space id from `me`; `module` and `from` are module ids.

| Tool | Arguments | Wraps | Counts as |
|---|---|---|---|
| `me` | none | `GET /api/agent/me` | read |
| `read_context` | `space`, `module` | `GET /api/modules/:id/context?scope=space` | read |
| `read_data` | `space`, `module`, `key?`, `prefix?` | `GET /api/modules/:id/data/:key` with `key`, else `GET /api/modules/:id/data` | read |
| `read_weather` | `space`, `module?`, `from?`, `to?` (a day, `YYYY-MM-DD`, at most 10 characters) | `GET /api/modules/:id/weather?scope=space` with a `module`; `GET /api/spaces/:id/weather` without | read |
| `search_objects` | `space`, `from`, `q?`, `kind?`, `has?` (`place` or `amount`) | `GET /api/objects/search` | read |
| `object_links` | `ref`, `from`, `dir?` (`to`, the default, or `from`) | `GET /api/objects/links` | read |
| `object_kinds` | `from` | `GET /api/objects/kinds` | read |
| `object_format` | none | `GET /api/objects/format/schema` | read |
| `resolve_objects` | `refs` (1 to 50), `from` | `POST /api/objects/resolve` | read |
| `list_members` | `space` | `GET /api/spaces/:id/members` | read; needs `agentMembers` |
| `list_actions` | `space` | `GET /api/spaces/:id/actions` | read |
| `ask_for_change` | `space`, `action`, `input?` | `POST /api/spaces/:id/action` | write; done at once, or refused with the reason |
| `request_status` | `space`, `request` (a whole number) | `GET /api/spaces/:id/action/:requestId` | read |
| `ask_to_delete` | `space`, `object` (a pointer), `reason?` | `POST /api/spaces/:id/delete-asks` | write; needs **Ask to delete** (`agentDelete`) |
| `ask_status` | `id` | `GET /api/agent/asks/:id` | read |
| `read_chat` | `space`, `before?` | `GET /api/spaces/:id/chat` | read |
| `post_chat` | `space`, `text` | `POST /api/spaces/:id/chat` | write; needs **Post in Chat** |

`read_weather` takes the module whose days they are and names none itself; without a `module` it reads the space's own place and day (the strip's chip): a module without days answers that it has no weather, and `{ configured: false }` means weather is off, not accepted or not chosen. Its errors are the route's own sentences. `ask_to_delete` is annotated destructive, since a person may delete what it names. A set-up agent is shown only its own tools (`me`, `list_templates`, `list_icons`, `list_people`, `make_space`, `change_space`, `ask_owner` and `ask_status`).

`tools/list` gives each tool's `name`, `title`, `description`, `inputSchema` and `annotations` (`readOnlyHint` true for the reads). Each wrapped route answers as in Part 1, with the same narrowing and refusals.

### How a tool call runs

A `tools/call` is run as one request to the wrapped route, sent through the app's own stack in the same process with the agent's `Authorization` header (never a cookie) and the headers that say where it came from, so the gate, the narrowing to the agent's spaces, the limits and the log apply exactly as to a direct call. A wrapped route has 30 seconds.

### Results and errors

A tool's answer is `result.content[0].text`: the route's JSON on success. A route that refuses is `isError: true` with the route's own sentence; a 429 adds ` Try again in N seconds.`. A route's answer over 1 MB is a tool error: `That answer is too big to send. Ask for less: one key, a prefix or an older page.` Arguments that don't fit the schema are an `isError` result with one sentence (`space is needed.`, `key is not an argument of this tool.`).

| HTTP | Code | Message | When |
|---|---|---|---|
| 400 | -32700 | `That is not JSON.` | The body can't be read as JSON. |
| 400 | -32700 | `Send one JSON-RPC message as application/json.` | The content type is not JSON. |
| 400 | -32600 | `Send one message at a time.` | The body is an array (a batch). |
| 400 | -32600 | `That is not a JSON-RPC 2.0 message.` | Not an object with `jsonrpc: "2.0"`, or a message with neither method nor result. |
| 400 | -32600 | `id is a number, or text of at most 200 characters.` | The `id` is another type or too long. |
| 400 | -32600 | `This server speaks MCP 2025-11-25, 2025-06-18 or 2025-03-26.` | An unsupported `MCP-Protocol-Version`. |
| 413 | -32600 | `The message is over 64 KB.` | The body is too large. |
| 403 | none (`{ "error" }`) | `This request came from another site, so it was refused.` | A foreign `Origin`. |
| 200 | -32601 | `There is no such method.` | An unknown method. |
| 200 | -32602 | `There is no tool named <name>.` | An unknown tool. |
| 200 | -32603 | `server error` | The wrapped route threw or did not answer in 30 seconds. |

### Limits and log

A tool call costs one read or one write, as its tool column says, counted and logged by the gate as the wrapped route (so a log line reads `/api/spaces/:id/chat`, not `/mcp`). The `tools/call` message itself is let on uncounted, so a call is never counted twice. Every other message on `/mcp` costs one read and is logged with route `/mcp`: `initialize`, `ping`, `tools/list`, a notification, an unknown tool, arguments that don't fit, bad JSON and `GET /mcp`. The limits are those of Part 1.

## Checked

`tools/check-agent-tokens.mjs`, `tools/check-agent-asker.mjs`, `tools/check-agent-pages.mjs`, `tools/check-agent-chat.mjs` and `tools/check-agent-chat-page.mjs`, and for Part 4 `tools/check-mcp.mjs` (see [the architecture](../architecture/architecture-agent-access.md), "Checks"). The Chat section was written from `server/index.js`, `server/chat-history.js` and `server/agent-log.js` on `4fb7b467`, read as code; the Chat checks did not run in the container used (the server would not start there: a template names Font Awesome icons that the installed set lacks), so none of it is seen to pass here. The earlier parts were checked on `67998604` (`check-agent-tokens`, 33 passed; `check-agent-asker`, 12 passed); `check-agent-pages` did not run to the end then either. A real call from a cloud session through a proxy to a hosted server was not tried, and the plan says so too.

Part 4 was written from `server/mcp.js` and the header of `tools/check-mcp.mjs`, read as code. `check-mcp` was not run for this page. No real MCP client (Claude Code or an app) was connected to a server.

The server-carried actions, delete asks, `read_weather` and the new tools were written on `fa5ea4bd` from the code's own comments and the descriptions of the pull requests that built them (#1065 to #1116), read as code. They are covered by `tools/check-module-actions.mjs`, `tools/check-agent-delete-asks.mjs`, `tools/check-agent-review.mjs`, `tools/check-weather.mjs` and `tools/check-mcp.mjs`, which the builders reported passing; none was run for this page. Not verified by anyone: a real MCP client, a hosted server with two environments, limits under real concurrent load, and a real Docker container's sandbox.

The changes of step 11d (uploaded modules carried on the server, `may` and `why`, no wait route, `read_weather` taking a `module`) were written from `server/index.js`, `server/mcp.js` and the plan's progress notes, read as code. The tools that cover them (`tools/check-module-actions.mjs`, `tools/check-mcp.mjs`, `tools/check-agent-tokens.mjs`, `tools/check-weather.mjs`) were not run for this page.
