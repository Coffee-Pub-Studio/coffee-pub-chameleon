# Admin Agent Plan

**Audience:** Thomas decided what the set-up agent is, what it may do to a space and what waits for a person
(Decisions). server-development builds the account kind, the gate's rows, the routes, the waiting list, the MCP tools
and the checks (`server/`, `tools/`); experience-design builds the pages (Manage > Users, the agent's page, the mark on
a space); quality-assurance reads the server half as a security change; content-manager documents.

**Status:** approved, 2026-11-20. Nothing is built. Thomas, 2026-11-20: "I think we need to add 'Creating and Managing'
spaces to an admin agent (does not exist yet)." Then, on the seven open questions: "take the leans". The decisions are
below; the contract follows them. This makes the set-up agent an exception to [plan-agent-access](plan-agent-access.md)
decisions 4 and 5 (a dated note is on both). Thomas names the kind of build.

## Decisions

Thomas, 2026-11-20, taking the product-planner's leans on all seven questions the draft held.

1. **A second kind of agent, not a switch on the existing one.** An agent record gets `kind: "setup"` beside
   `agent: true`; the kind is chosen when it is made and never changes. Reason: one token that reads Chat (open to
   steering by anyone in a space) must not also add people. The set-up agent reads nothing in a space.
2. **The word: "set-up agent", code `setup`, shown "Claude (set-up agent)".** Reason: "admin" is a role name in
   CLAUDE.md and this agent is not an admin. The word is added to CLAUDE.md's Names. ("Admin agent" below, in
   Thomas's request and in the file's name, is the working name.)
3. **It may change only spaces it made.** Reason: the smallest reach that still lets it do the work; a space a person
   made is never touched.
4. **It may see the names and keys of the environment's members, never guests, agents, owners or the admin.** Reason:
   adding a person needs their key. This widens decision 20 of plan-agent-access (names and keys in its own spaces) to
   the environment's member accounts, and no further.
5. **Anything about people waits for an owner's yes; making and naming spaces does not.** Adding, taking off and the
   moderator tick wait. Making a space, renaming it, its description and its icon do not. Reason: a new space holds
   nothing yet and harms nobody, and the daily cap and the mark bound it.
6. **Archive is left out.** There is none today, for people either; it is a space feature for people first and gets
   its own plan later.
7. **A server variable of its own: `AGENT_SETUP`, off by default, on top of `AGENT_TOKENS`.** Reason: a server can
   allow agents without allowing this.

## What it is today

From [plan-agent-access](plan-agent-access.md), [architecture-agent-access](../architecture/architecture-agent-access.md),
[api-agents](../api/api-agents.md) and `server/index.js`, read as code.

- **An agent** is a user record with `agent: true`, role `member`, no sign-in, shown as "Claude (agent)". It is made on
  Manage > Users by an owner or the admin and works only in the spaces it is added to (decisions 1 to 4, 16). Every
  route that would make it a moderator, owner or admin answers 400 "An agent can't be that." (`AGENT_CANT_BE`).
- **What it may do** is the gate's list, `AGENT_ROUTES`: reads in its own spaces, module actions that are `write` (not
  `destructive`, `local` or `askerOnly`), its requests' status, Chat (read; post only with **Post in Chat**), and
  `GET /api/spaces/:id/members` (names and keys of its own spaces, decision 20). Everything else is 403 "An agent can't
  do that." It never deletes (decision 7).
- **Its limits:** 60 reads and 20 writes a minute, 3,000 and 300 a day. **Its log:** one line a call, no content, 30
  days. **Its switches:** `AGENT_TOKENS` on the server, **Agents** per environment, and per agent **Revoke**, **Turn
  off**, **Post in Chat**.
- **MCP:** `POST /mcp` (`server/mcp.js`) gives the gate's routes as 13 tools (`me`, `read_data`, `list_actions`,
  `ask_for_change`, `list_members` and so on). `list_actions` lists module actions on the bus; space set up is not a
  module action, so it is not reachable through `list_actions`.
- **Spaces, as a person sets them up** (all `requireOwner`, owners and the admin):
  - `POST /api/spaces` `{ name, description, members, template, linkIcon, link, profile, starter }` makes a space. Its
    template decides which modules are on there (an enabled module is on in every space its template offers it);
    `fillStarter` writes the template's starter content as the maker. The maker joins its members; who made it is not
    stored.
  - `PATCH /api/spaces/:id` changes `name`, `description`, `linkIcon`, `members`, `closed`, `template`, guests, AI and
    calendar switches, and more. A moderator may send only `MODERATOR_SPACE_FIELDS`.
  - `PUT /api/spaces/:id/image` (an upload), `DELETE /api/spaces/:id/members/:key`, and the moderator tick through
    `PATCH /api/users/:key/spaces/:spaceId`.
  - `DELETE /api/spaces/:id` erases the space and everything kept for it (`server/space-erase.js`).
  - **There is no archive.** The nearest thing is `closed` (closed for set up), which keeps members out.
- **Parts:** [plan-core-parts](plan-core-parts.md) is a draft; `server/parts/` does not exist yet, so all of this is
  core. `tools/check-route-table.mjs` and `tools/route-table.json` exist.

## The tension, plainly

Decision 4 says an agent is "never a moderator, owner or admin", decision 5 that it changes things through module
actions only, and decision 7 that it never deletes. Making and changing spaces is owner-only today. A set-up agent
therefore does owner-only things, which decisions 4 and 5 rule out for agents. This plan keeps the agent's role
`member` and keeps decision 7 whole (it never deletes, erases or clears), and adds a short, fixed list of owner-only
set-up actions behind its own gate, its own switch and, for anything about people, a person's yes. Thomas agreed
(2026-11-20): decisions 4 and 5 of plan-agent-access carry a dated note saying the set-up agent is the exception, and
CLAUDE.md's Names has the new word (decision 2 above).

## What a set-up agent is

- **A second kind of agent, not a switch on the existing one** (decision 1). An agent record gets `kind: "setup"`
  beside `agent: true`; an agent made today is `kind` absent, the ordinary agent. The kind is chosen when it is made and
  never changes. Its own token, its own log, its own limits.
- **It reads no module data and no Chat.** Its gate is set up only. This is the main reason for a separate kind: an
  agent that reads Chat can be steered by what anyone in a space writes there (plan-agent-access, "Reading Chat"); an
  agent that can add people must not read that text. Claude holds two tokens when it needs both.
- **Who makes one:** owners and the admin, on Manage > Users, as for any agent (decision 2). Never a moderator. On a
  hosted server the host admin's stand-in may, as an environment's admin does; the host console shows nothing.
- **How it shows:** "Claude (admin agent)" was Thomas's working name. Decided: "Claude (set-up agent)", code `setup`,
  since "admin" is a role name in CLAUDE.md and this agent is not an admin (decision 2).

## What it may do

Only in a space it may set up (decision 3: only spaces it made).

| Action | How | Waits for a person |
|---|---|---|
| Make a space from a template, with a name, a description and an icon | `template` must be one the environment offers; the template decides its modules; starter content as usual | No |
| Rename it, change its description, change its icon (`linkIcon`, one the environment offers) | Only these three fields | No |
| Add a person as a member | An existing member account of the environment; never a guest, another agent, an owner or the admin | Yes |
| Take a person off | Never the owner who made the agent, never itself | Yes |
| Tick or untick a person as the space's moderator | Only a member of that space | Yes |

**Never, whatever the space:** delete or erase a space, Clear or restore, close or open it for set up, change its
template after it is made, upload a picture, change guest, AI, calendar or call switches, make or approve a guest link,
change anyone's role, touch tokens or other agents (its own included), environment settings, the Modules page, plans
and billing, the host console, or approve anything. Archive: not in this plan (decision 6).

## How it fits the gate

- **The gate's list is chosen by kind.** `AGENT_ROUTES` stays the ordinary agent's list; a new `SETUP_ROUTES` is the
  set-up agent's. Each kind gets 403 "An agent can't do that." on the other's routes. Both share the token check, the
  log, the 401 sentence and the kill switches.
- **New agent-only routes**, as `GET /api/spaces/:id/members` is today, not the owner routes opened to an agent. Each
  takes a fixed body and refuses any other key, so a field added to `PATCH /api/spaces/:id` later can never reach an
  agent by accident.

| Method | Route | Counts as | What |
|---|---|---|---|
| GET | `/api/agent/me` | read | Adds `kind`, and for the set-up agent its spaces and its waiting asks |
| GET | `/api/agent/templates` | read | `{ templates: [{ id, name }] }`, the ones the environment offers |
| GET | `/api/agent/icons` | read | The icon ids a space may have |
| GET | `/api/agent/people` | read | `{ people: [{ key, name }] }`, the environment's member accounts, nothing else (decision 4) |
| POST | `/api/agent/spaces` | write | `{ name, template, description?, icon? }`; 200 `{ space: { id, name } }` |
| PATCH | `/api/agent/spaces/:id` | write | `{ name?, description?, icon? }` |
| POST | `/api/agent/spaces/:id/asks` | write | `{ ask: "add" \| "remove" \| "moderator", person, on? }`; 202 `{ ask: { id, state: "waiting" } }` |
| GET | `/api/agent/asks/:id` | read | `waiting`, `approved`, `declined` or `expired` |

- **Marked.** A space it makes stores `madeBy` (the agent's key). Manage's spaces list and Home show "Made by Claude
  (set-up agent)" on it until an owner opens it and chooses **Keep**, which clears the mark. The agent joins its members
  so it can be found; an ordinary agent is not added.
- **Limits**, on top of the agent limits and counted as writes: 5 spaces made a day, 30 set-up changes a day, 10 asks
  waiting at once. Over: 429 with the existing sentence.
- **The log:** one line a call as today, with `space` and the kind of change (`made`, `renamed`, `ask:add`), never a
  name or a description.
- **Switches:** a new server variable `AGENT_SETUP` (default off; needs `AGENT_TOKENS` on too) and an owner's switch
  **Set-up agents** on Manage > Users. A server without it behaves exactly as before (decision 7).
- **MCP:** new tools, listed only for the set-up agent's token: `list_templates`, `list_icons`, `list_people`,
  `make_space`, `change_space`, `ask_owner` (add, remove, moderator) and `ask_status`, plus `me`. The ordinary agent's
  tools are not listed for it. Not through `list_actions`, which stays module actions on the bus.

## The safety model

- **A person's yes for anything about people.** Adding, taking off and the moderator tick wait on the agent's page under
  **Waiting for you**, with **Approve** and **Decline**, and the owners get one bell line. Only an owner or the admin
  approves; nothing an agent sends counts as a yes. An ask not answered in 7 days expires. Approving runs the same store
  call a person's Set up runs, as that owner.
- **No yes for making and naming,** because a new space holds nothing yet and harms nobody, and the daily cap and the
  mark bound it.
- **Undo, by a person.** Each direct change keeps the fields' earlier values for 7 days in an undo record (in the
  environment's data, not the log, since the log holds no content). The agent's page shows **Undo** on each. Undo of a
  made space erases it, only while nobody but the agent has written in it, and only by an owner: the agent itself never
  deletes (decision 7).
- **Kill switches**, smallest first: **Turn off** or **Revoke** the agent, **Set-up agents** off, `AGENT_SETUP` off.
  Turning one off expires its waiting asks.
- **A leaked token** can make up to 5 empty spaces a day with names it chose, rename or re-describe those, and ask to add
  people, which nobody need approve. It cannot read anything in a space, add anyone without a yes, or delete.

## What a person reads

- Manage > Users: **Add an agent** offers "Works in spaces" (the ordinary agent) and "Sets up spaces" (the set-up agent).
- The agent's row and page: "Claude (set-up agent)". **Waiting for you:** "Claude (set-up agent) asks to add Ana to
  Lisbon 2027." with **Approve** and **Decline**.
- **What it did:** "Made the space Lisbon 2027", "Renamed a space", "Asked to add a person to Lisbon 2027, approved".
- On a space it made: "Made by Claude (set-up agent)" and **Keep**.
- Refusals: "An agent can't do that.", "That template is not one this environment offers.", "An agent can only ask to
  add a member of this environment.", "This agent has made as many spaces as it may today."
- The word for space comes from the environment's template, as everywhere.

## Left to build, in order

All core: the gate, `server/index.js`, `server/store.js` and `server/mcp.js` are core, and `server/parts/` does not exist
yet. If plan-core-parts' `agents` part (its row 20) is cut first, the new routes live there, but the gate stays in the
base, so these steps stay core. Thomas names the kind of build.

1. **The account kind and the direct changes** (server-development, larger model; security). `kind: "setup"`,
   `AGENT_SETUP`, **Set-up agents**, `SETUP_ROUTES`, the reads, `POST` and `PATCH /api/agent/spaces`, `madeBy`, the
   limits, the log lines. `tools/check-agent-setup.mjs`; `tools/route-table.json` updated in the same change.
2. **Asks and undo** (server-development). The asks routes, the owner's approve and decline routes, expiry, the bell
   line, the undo records. Cases added to `check-agent-setup`.
3. **The MCP tools** (server-development). Tools by kind in `server/mcp.js`; cases in `tools/check-mcp.mjs`.
4. **The pages** (experience-design). Add an agent's two kinds, **Waiting for you**, **Undo**, **Keep** and the mark;
   cases in `tools/check-agent-pages.mjs`.
5. **Documentation** (content-manager). The agents guide, api-agents, architecture-agent-access, the Names line.

## Verify

Checked by a tool on throwaway servers (`tools/check-agent-setup.mjs`, single and hosted):

- `AGENT_SETUP` off, or **Set-up agents** off: the set-up agent's token is 401; an ordinary agent is unchanged.
- The gate walked from the router: the set-up agent reaches only `SETUP_ROUTES`; the ordinary agent gets 403 on every one
  of them; the set-up agent gets 403 on Chat, data, actions and `/api/spaces/:id/members`.
- Bodies: any key outside the list is 400; an unknown template or icon is 400; the space made has `madeBy` and the
  agent as a member.
- Spaces it did not make answer 404; the Lobby is never one.
- Asks: they change nothing until an owner approves; the agent can't approve; a guest, an agent, an owner or the admin
  as the person is refused; expiry after 7 days; Turn off expires them.
- Undo restores the earlier values; undo of a made space refuses once someone else has written there.
- The daily caps and the waiting cap give 429; the counts survive a restart.
- No name or description in any log line; a token of environment A is 401 at B.
- Neighbours: `check-space-create`, `check-space-erase`, `check-agent-tokens`, `check-mcp`, `check-route-table`.

Not checkable here: a real Claude client choosing to call these tools and how it weighs what it is told; the bell line
seen by a person. No step needs a LiveKit call (a made space's call is the existing one, untouched).

## What is not decided

Nothing blocks step 1. The seven questions the draft held are Decisions 1 to 7.

Also to note: had Thomas not wanted this built, the smaller path is for the ordinary agent to
post in Chat what it would set up, and a person makes the space. That needs nothing new.
