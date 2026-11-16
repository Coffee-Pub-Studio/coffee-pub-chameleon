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

A write is `POST /api/spaces/:id/action`. Every other call on the list is a read, and so is a call the gate refuses, so hammering a closed route is bounded too. A 429 counts against nothing. The day's counts survive a restart. Each module's own per-person limits (`overLimit`) apply as well, and the action route's `too many requests in a minute, slow down` (429).

### `GET /api/agent/me`

For an agent's token only (a person's session answers 403 `This is for an agent's token only.`; no sign-in 401).

```json
{
  "agent": { "key": "k3m9x2", "name": "Claude" },
  "expiresAt": "2026-12-16T10:00:00.000Z",
  "spaces": [{ "id": "a1b2c3d4", "name": "Moving house" }],
  "limits": {
    "reads": { "perMinute": 60, "perDay": 3000, "usedToday": 12 },
    "writes": { "perMinute": 20, "perDay": 300, "usedToday": 3 }
  }
}
```

`spaces` are the spaces the agent is a member of and may enter, never the Lobby. `GET /api/spaces/:id` is not on the list (it answers a member "owners only"); this is how an agent learns its spaces. `name` is the agent's display name as typed, without "(agent)".

### Reading

All of these are `GET` and `POST` routes that exist for modules, with the same answers a member gets, narrowed to the agent's spaces. Their parameters and answers are in [Modules API](api-modules.md); what an agent adds is the narrowing.

| Route | Narrowing for an agent |
|---|---|
| `GET /api/modules/:id/context` | `scope=space&space=<id>` required, a space of the agent's. |
| `GET /api/modules/:id/data` and `/data/:key` | The same. A module's stored values in that space, for the module's `read` permission. |
| `GET /api/objects/search` | The same. Summaries of the objects the asking module `from` may link to. |
| `GET /api/objects/links` | The `ref` (a JSON pointer) must be into one of its spaces (403 `An agent can't do that.` for a pointer with another scope, 404 for a space it is not in). Links that go outside its spaces are left out of the answer. |
| `GET /api/objects/kinds` | None; the kinds of object the modules declare. |
| `POST /api/objects/resolve` | Every pointer in `refs` (the first 50 are read) must be into one of its spaces. |
| `GET /api/spaces/:id/actions` | Lists only the actions an agent may ask for (below). Needs the member role's `chatRead` (403 `your role cannot do that` without it). |

A scope of `environment`, `spaces` or `person`, or none, is 403 `An agent can't do that.`. Other modules' data, a person's own data, the environment's, and any space the agent is not in, are out of reach. There is no `PUT`, `DELETE`, Clear, restore or upload.

### Asking a module to do something

**`POST /api/spaces/:id/action`** with `{ "action": "<module>:<name>", "input": { ... } }`. For example `{ "action": "schedule:setDone", "input": { "ref": { ... }, "done": true } }`. It answers `{ "id": <request id>, "status": "pending" }`.

The request waits on the server until a person who may change that module has it open in that space; that person's page carries it out under the module's own rules and says how it went. Modules run no server code, so nothing is written until then (up to seven days). The agent reads the outcome with the next route.

What an agent may ask for is an action that is `effect: "write"` in its module's manifest and is not `local`, not `askerOnly`, not `ai: false`. It checks, in this order:

| Status | Error | When |
|---|---|---|
| 400 | `that <module word> does not offer that action` | `action` is not `<module>:<name>`. |
| 404 | `that <module word> does not offer that action` | The module has no such action. |
| 403, 404 | the place check's sentence | The module is not on in this space, or the agent's role may not read it there. |
| 403 | `An agent can't ask for that.` | The action is `local`, `askerOnly`, destructive, has no `effect` or is kept from AI. |
| 403 | `An agent can't do that.` | A pointer in `input` is not into one of the agent's own spaces. |
| 403 | the module's own refusal | The agent's member role may not change that module in this space. |
| 403 | `your role cannot do that` | The member role lacks **Send chat messages** (`chat`) in this space: the action route checks it, so taking it from members stops an agent's requests too. |
| 400, 403 | the module's sentence | `input` fails the action's declared shape (a field missing, an object of the wrong kind). |
| 429 | `too many requests in a minute, slow down` | The action route's own limit. |

The bundled actions an agent can use today are those marked `write` in `modules/*/module.json`; the Planner - Projects ones are `addMilestone`, `addWork`, `addNote`, `setDone` and `updateEntry` (below).

**`GET /api/spaces/:id/action/:requestId`** tells the agent how its own request went, for ten minutes after it finished:

```json
{ "id": 41, "status": "done", "ok": true, "note": "Added." }
```

`status` is `pending` (waiting for a page), `claimed` (a page has taken it), `done` or `expired` (nobody took it in time). When `done`: `ok` is true or false; `error` is the module's one-line sentence when it failed; `note` is a short line the module may send back. Both are at most 300 characters and one line. It needs the member role's `chatRead` too. The request is read only by the agent that asked (anyone else's, an unknown one or one from another place is 404 `no such request`); `requestId` is a whole number (400 otherwise).

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
| `method`, `route` | `GET`, `/api/spaces/:id/action`: the route pattern, never the path asked for. `(refused)` for a route the gate does not allow. |
| `space` | The space's id, only when it is one of the agent's own. |
| `action` | `<module>:<name>` for an action request. |
| `request` | The request's id for an action request. |
| `message` | Reserved for Chat (not built); always `null`. |
| `status` | The HTTP status the call got. |
| `address` | An IP address, or `null`. |
| `kind` | `read` or `write`; `null` for a note (a 429, or a 401 for a token that is the agent's but no longer good: written at most once a minute for each). |

A line never holds a request body, an object's content or a token. Lines are kept 30 days.

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

## Checked

`tools/check-agent-tokens.mjs`, `tools/check-agent-asker.mjs` and `tools/check-agent-pages.mjs` (see [the architecture](../architecture/architecture-agent-access.md), "Checks"). This documentation pass read the routes in `server/index.js` and ran the first two checks (`check-agent-tokens`, 33 passed; `check-agent-asker`, 12 passed); `check-agent-pages` did not run to the end in the cloud container used. A real call from a cloud session through a proxy to a hosted server was not tried, and the plan says so too.
