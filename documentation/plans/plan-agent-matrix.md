# Agent Matrix Plan

**Audience:** Thomas decided how the Roles matrix shows and sets what an agent may do (Decisions). server-development builds the gate's list, the Agent column's permissions and the checks (`server/`,
`tools/`); experience-design builds the Roles grid's new columns and the change to the agent's page; quality-assurance
reads the server half as a security change; content-manager documents.

**Status:** approved, 2026-11-20. Nothing is built. Thomas, 2026-11-20: the Roles matrix gets an Agent column, "a far more
transparent way to see access rights", and he asked: "Is there any way the matrix could drive the fixed list? Would
that be better?" This plan answers that. He then answered the four open questions by clickable options and said "take
the leans", so each is recorded below as a decision. Thomas names the kind of build. It changes decisions 4, 13 and 17 of
[plan-agent-access](plan-agent-access.md) (dated notes added there) and adds to [plan-admin-agent](plan-admin-agent.md)
(approved, not built).

## What it is today

Read as code, from `server/index.js`, `server/store.js`, `public/admin.js` and
[architecture-agent-access](../architecture/architecture-agent-access.md).

- **The gate's list** is `AGENT_ROUTES` (`server/index.js`, about line 3666): 16 rows of method, route, what it counts as
  (`read`, `write`, `mcp`) and its place check (`none`, `spaceParam`, `spaceScope`, `linkRef`, `resolveRefs`). A route
  not on it is 403 "An agent can't do that." The list is fixed in code; nothing a person sets changes it.
- **The Roles grid** (Manage > Roles, `renderRoles` in `public/admin.js`) has four columns, `owner`, `moderator`, `member`,
  `guest`. Its rows are `store.allPermissions()`: the built-in `ROLE_PERMISSIONS` (`conference`, `chatRead`, `chat`,
  `react` and so on, in groups) and then each enabled module's own, `module.<id>.<key>`
  (`ModuleManager.permissionList`). `GET /api/roles` answers `{ permissions, roles }`; `PATCH /api/roles/:role` saves
  one tick, stored in `settings.roles[role]`. The Owner column is all ticked and greyed; a guest's AI and a library's
  "See every file" are greyed for guests with a reason.
- **An agent's rights are the member column's.** An agent is a user with `agent: true` and role `member`, so
  `store.spacePermissions` gives it `roleSet('member')`, with no moderator tick ever (`spaceFlags`). Every route's own
  check then reads that: Chat read asks `chatRead`, Chat post asks `chat`, module data and the action route ask the
  module's guard (`moduleCan`, `busPlace`), and, for anyone, **the action route asks `chat` and the actions list and a
  request's status ask `chatRead`**.
- **Post in Chat** is a field on each agent, `chatPost` (off for a new agent; `PATCH /api/users/:key { chatPost }`,
  the switch on the agent's page, `publicUser`, `GET /api/agent/me`, an owner's copy). A post needs both `chat` from
  the member column and `chatPost`.
- **The agent's page** keeps its own copy of the list's methods and reads (`ROUTE_METHODS`, `READS` in
  `public/agent-page.js`) to word its log.

So today there are three places that say what an agent may do (the gate's list, the member column, `chatPost`), and the
member column, which a person reads as being about people, quietly governs the agent too.

## Can the matrix drive the fixed list?

Partly, and that part is better. The matrix can switch an agent's routes off, never add one. Each route the gate lets
through needs code a tick cannot write: its place check (only the agent's own spaces), a fixed body, and its log line. So:

- **The code holds what is possible:** one list of every route an agent may ever reach, each naming the permission it
  needs. That is the ceiling.
- **The matrix chooses within it:** the Agent column ticks which of those permissions this environment gives its agents.
- **Both are drawn from the same source,** so the grid cannot show a right the gate does not grant, or the reverse, and a
  check proves it.

Three corrections to the shape first proposed, found in the code:

1. **The ceiling belongs to a row, not a route.** A route not on the list is already never reachable, so a per-route
   `ceiling` adds nothing. What needs the mark is a permission: which rows the Agent column may ever tick. Delete, roles,
   tokens and the rest are not routes on the list and not rows in the grid at all.
2. **A route cannot always name one key.** `GET /api/modules/:id/data` serves every module; the permission it needs is
   that module's own (`module.<id>.<guard>`), known only once the request names the module. The route already checks it.
   So a route names a key, or `module` (the module's own, checked by the route), or `always` (nothing to tick:
   `/api/agent/me`, the agent's own request's status).
3. **"Send chat messages" cannot simply replace Post in Chat** while the action route asks `chat`: unticking it would stop
   every action, and decision 18 of plan-agent-access says Post in Chat stops posting only. For an agent the action route
   and the actions list must ask the module's own permission and not `chat` or `chatRead` (people are unchanged).

## Decisions

1. **The Roles matrix gets an Agent column** (Thomas, 2026-11-20), "a far more transparent way to see access rights". The
   matrix chooses within a ceiling the code holds: it can switch an agent's routes off and never add one (see "Can the
   matrix drive the fixed list?"). Reason: each route needs code a tick cannot write (its place check, fixed body and log
   line), and one source for both the grid and the gate means the grid cannot show a right the gate does not grant.
2. **Post in Chat becomes one choice for all the environment's agents** (Thomas, 2026-11-20). It is a
   row in the Agent column, worded **Send chat messages**. `chatPost` per agent is removed. Turn off and Revoke stay per
   agent. Reason: agents are few, and one place to look is the point of the column.
3. **The set-up agent gets its own column, shown only when `AGENT_SETUP` is on** (Thomas, 2026-11-20).
   Reason: the two kinds share no tickable row (the set-up agent reads nothing in a space; the ordinary agent sets up
   nothing), so one column would be mostly empty boxes meaning different things for each kind.
4. **What an agent can never do appears as one plain sentence under the grid, not as greyed rows** (Thomas, 2026-11-20). This replaces the earlier idea of greyed ceiling cells. Delete, roles, tokens, billing and the rest
   of the ceiling are not permissions anyone ticks, and rows for them would show a member as unable to delete their own
   work. The sentence is under the grid, once.
   Note (2026-11-23): Changed by [plan-agent-edit-delete](plan-agent-edit-delete.md), decision 2: delete is no longer
   in the never sentence; the Agent column gets an "Ask to delete {objects}" row (`agentDelete`), off by default, and each
   delete waits for a person's approval.
5. **Defaults are as agents work today** (Thomas, 2026-11-20): read Chat on, see members on, each module
   row at its member default, **Send chat messages** off, the set-up rows off. Reason: nothing an agent can do changes
   until an owner ticks something, and no agent already working stops.

Small choices taken at the planner's lean, as the rule for small choices allows (Thomas can change them):

6. **A row an agent can never have shows no box in its column** (for example the call, pictures, mute, kick, AI), and
   `PATCH` on it is refused. Reason: decision 4 drops greyed cells, and a blank cell is the least to draw.
7. **The ceiling belongs to a row, not a route.** A route not on the list is already never reachable. What needs the mark
   is a permission: which rows the Agent column may ever tick.
8. **A route names a key, `module` or `always`.** `GET /api/modules/:id/data` serves every module, so the permission it
   needs is that module's own, known only once the request names the module.
9. **For an agent, the action route and the actions list ask the module's own permission, not `chat` or `chatRead`**
   (people are unchanged). Reason: **Send chat messages** must stop posting only, as decision 18 of plan-agent-access says.

## The contract

### One list (server)

- `AGENT_ROUTES` moves to its own file, `server/agent-routes.js`, as one list of entries
  `{ kind, method, path, counts, place, needs }`:
  - `kind`: `agent` (the ordinary agent) or `setup` (the set-up agent of plan-admin-agent, whose `SETUP_ROUTES` join this
    list rather than being a second one).
  - `counts` and `place`: as today.
  - `needs`: a permission key (a row of the grid), `module`, or `always`. An entry without one is refused at start (the
    server says which and stops) and fails the new check.
- **The gate** lets a request on only if its route is on the list for the token's kind, its place check passes, and its
  `needs` holds: a key must be ticked in that kind's column; `module` is left to the route's own check, which now reads
  the agent's column; `always` passes. Otherwise 403 "An agent can't do that.", as today.
- What the routes need:

| Route | `needs` |
|---|---|
| `GET /api/agent/me`, `GET /api/spaces/:id/action/:requestId`, `GET /api/objects/kinds`, `GET` and `POST /mcp` | `always` (an MCP tool call comes back through the gate as the route it wraps and needs what that route needs) |
| `GET /api/modules/:id/context`, `/data`, `/data/:key`, `GET /api/objects/search`, `/links`, `POST /api/objects/resolve` | `module` (each module's read, as the routes check it now) |
| `GET /api/spaces/:id/actions`, `POST /api/spaces/:id/action` | `module` (read to list, write to ask; for an agent no longer `chat` or `chatRead`) |
| `GET /api/spaces/:id/chat` | `chatRead` |
| `POST /api/spaces/:id/chat` | `chat` |
| `GET /api/spaces/:id/members` | `agentMembers` (new row) |
| Set-up agent: `POST /api/agent/spaces` | `agentMakeSpaces` (new row) |
| Set-up agent: `PATCH /api/agent/spaces/:id` | `agentChangeSpaces` (new row) |
| Set-up agent: `GET /api/agent/people`, `POST /api/agent/spaces/:id/asks` | `agentAskPeople` (new row) |
| Set-up agent: `GET /api/agent/templates`, `/icons`, `/asks/:id`, `/me` | `always` |

### The columns (server)

- **Two new columns, `agent` and `setup`** (decision 3), stored as `settings.roles.agent` and
  `settings.roles.setup` like the others. `store.spacePermissions` gives an agent its kind's column instead of the
  member column, with no moderator overlay, the same in every one of its spaces. The account stays role `member`; nothing
  else about it changes.
- **Which rows each column may tick.** Each built-in row says whether an agent may ever have it. For `agent`: `chatRead`
  and `chat`, the new `agentMembers`, and module rows that guard something an agent can reach (a module's `access.read`
  or `access.write` guard, or a permission an action's `takes` names), worked out from the manifests. Every other row is
  never: the call, pictures, reactions, screen share, asides, private calls, mute, kick, guest links, tags, AI, the
  images, and a library's "See every file". For `setup`: only the three set-up rows. The never cells are refused on
  `PATCH` (400 "An agent can never have "<label>".") and show no box on the page (decision 6).
- **Agent-only rows**, in a group "Agents": "See who is in {a space}" (`agentMembers`), and for the set-up agent "Make
  {spaces}" (`agentMakeSpaces`), "Rename and change {spaces}" (`agentChangeSpaces`), "Ask to add people"
  (`agentAskPeople`). People's columns show no box on them. A yes from an owner is still needed for every ask about
  people, whatever the box says (plan-admin-agent, decision 5). (Changed by plan-agent-edit-delete.md, decision 2: an
  `agentDelete` row joins the group, with a box in the Agent column only.)
- **Defaults** (decision 5): the Agent column starts as an agent is today. `chatRead` on, `chat` off (Post in
  Chat is off for a new agent today; the row reads **Send chat messages**), `agentMembers` on, each module row its member default. The three set-up rows start
  off. Nothing an agent can do changes until an owner ticks something.
- (Changed by plan-agent-edit-delete.md, decision 2: `agentDelete` joins the rows the `agent` column may tick, so it is
  not in its `never` list; it stays in the `setup` column's `never` list.)
- **`GET /api/roles`** gains `columns` (the four, then `agent` when `AGENT_TOKENS` is on, then `setup` when `AGENT_SETUP` is
  on) and `never: { guest: [keys], agent: [keys], setup: [keys] }`. Rows carry `agentOnly: true` for the new group.
  `PATCH /api/roles/agent` or `/setup` while that column is not shown is 404 "no such role". A server without
  `AGENT_TOKENS` answers exactly as now plus `columns` and `never`.
- **Post in Chat goes** (no compatibility layer): `chatPost` leaves the account record, `publicUser`,
  `store.setAgentChatPost`, `PATCH /api/users/:key`, `GET /api/agent/me` and an owner's copy's allowed fields, and
  `agentChatText` stops asking for it. A stored `chatPost` is dropped when the record is next read. Revoke and Turn off
  stay on each agent.
- **`GET /api/agent/me`** gains `permissions`: the ticked keys of its column that a route needs (not the module ones,
  which `list_actions` already reports as `may`). MCP's `me` returns it; `post_chat`'s description says it works when
  `permissions` includes `chat`.

### The pages (experience-design)

- **Manage > Roles:** the columns `GET /api/roles` names, headed by the environment's words for agent and set-up agent. A
  row the column can never have shows no box (decision 6); the Owner's and guest's greyed cells are unchanged. The
  agent column's `chat` row reads **Send chat messages**. The "Agents" group's rows have boxes only under the agent
  columns. Beneath the grid, one plain sentence of what an agent never does
  (decision 4): "An agent never deletes or clears anything, changes roles, makes tokens or other agents,
  changes this {environment}'s settings, plans or billing, works outside its own {spaces}, goes past its limits, or
  becomes a {moderator}, {owner} or admin." At 390 wide the grid scrolls inside its own box; the page does not.
  (Changed by plan-agent-edit-delete.md, decision 2: the sentence no longer says an agent never deletes; it says it never
  deletes without a person's approval.)
- **The agent's page:** the Post in Chat switch goes; in its place, "What agents may do is set on Roles." with a link to
  Manage > Roles. What it did is unchanged.

## Left to build, in order

All core (`server/`, `public/admin.js`, `public/agent-page.js`, `tools/`). Thomas names the kind of build.

1. **The list and the columns** (server-development, larger model; security). `server/agent-routes.js` with `needs`; the
   gate's `needs` test; the `agent` column, its never set and defaults; `spacePermissions` by kind; `GET` and
   `PATCH /api/roles`; the action route and actions list asking the module for an agent; Post in Chat removed; `me`'s
   `permissions`; MCP descriptions. New `tools/check-agent-matrix.mjs`; `check-agent-chat`, `check-mcp`,
   `check-environment-export` and `check-agent-tokens` updated.
2. **The grid and the agent's page** (experience-design). The columns, the boxless never cells, the "Agents" group, the sentence, the
   page's change; `tools/check-agent-pages.mjs` updated.
3. **The set-up column**, built inside plan-admin-agent's step 1 (server-development), so `SETUP_ROUTES` are born as
   entries of this list with their `needs`. If that step lands before this one, step 1 here moves them in.
4. **Documentation** (content-manager). architecture-agent-access, api-agents, the roles guide, and dated notes on
   plan-agent-access decisions 4, 13 and 17.

## Verify

Checked by a tool on throwaway servers:

- **`tools/check-agent-matrix.mjs`** (new). Without a browser: every list entry has `kind`, `counts`, `place` and a
  `needs` of a key, `module` or `always`; every key is a row its kind's column may tick; every row an agent column may
  tick is needed by at least one entry (module rows by a `module` entry); every entry's method and path is in
  `tools/route-table.json`; `ROUTE_METHODS` and `READS` in `public/agent-page.js` agree with the list. Live: a never key
  on `PATCH` is 400; the agent column is absent and 404 with `AGENT_TOKENS` off; unticking `chat` makes a post 403 and
  leaves actions working; unticking `chatRead` makes a Chat read 403; unticking a module's read row hides its data and
  actions; unticking `agentMembers` makes the members read 403; the defaults give today's behaviour; a member's column
  changing no longer changes the agent's.
- **`check-agent-chat`:** the Post in Chat cases become the column's `chat` row; `chatPost` sent to `PATCH /api/users`
  does nothing.
- **`check-mcp`:** `me` carries `permissions` and no `chatPost`; a tool whose route needs an unticked row returns the
  gate's 403 as a tool error.
- **`check-environment-export`:** no `chatPost` in a copy; the agent column in `settings.roles` survives a copy and restore.
- **`check-agent-pages`** (headless Chromium): the columns shown and hidden with the server variable, boxless never cells, a tick saved and kept after a reload, the sentence, the agent's page without the switch, 390 wide.
- **`check-route-table`:** run as a neighbour; no route is added or removed here, so `tools/route-table.json` does not
  change (plan-admin-agent's routes change it in its own step).

Not checkable here: a real Claude client reading `me`'s `permissions` and choosing not to call what it lacks. No step needs
a LiveKit call: agents never join the call, and the conference row is never theirs.

## What is not decided

Nothing blocks the build. Thomas names the kind of build (try, feedback or production). Not decided: the Send chat messages
row's exact words in the environment templates, and how the set-up column is headed (the template's word for the set-up
agent); both follow the existing agent words unless Thomas says otherwise.
