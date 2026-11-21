# MCP Sign-in Plan

**Audience:** Thomas decides how an app such as ChatGPT, the Claude apps or Codex connects to Chameleon without a
pasted token (Open questions). server-development builds the sign-in server half (`server/`, `tools/`, larger model,
security); experience-design builds the approval page and the agent page changes; quality-assurance reads the server
half as a security change; content-manager documents.

**Status:** draft, 2026-11-21, for Thomas to decide; nothing decided, nothing built. Thomas, 2026-11-21, after setting
up the Codex app (a form with the address, "Bearer token env var" and Headers) and ChatGPT: a pasted token is too hard
for most users ("the variable route will not work for most users"; earlier, "this is going to be too hard for users").
ChatGPT's own custom servers (Settings, Plugins) offer sign-in or none, and no token header as far as he knows
(unverified). This reopens [plan-agent-access](plan-agent-access.md), "The MCP server", which said on 2026-11-20 that
OAuth "is not needed for the apps and stays unbuilt", and step 18 of [plan-ai-integration](plan-ai-integration.md)
(OAuth for connectors), which assumed a person's own token rather than an agent.

## Why

Today an app connects only with a pasted token: an owner makes an agent, adds it to a space, makes a token and types
`Authorization: Bearer agt_...` into the app's form or a terminal. That works in Claude Code and the Claude apps
(proven 2026-11-20), but it is six steps, a secret copied by hand, and a header form most people have never seen.
ChatGPT, if Thomas is right, has no header field at all, so it can't connect today.

Sign-in is the way these apps expect: the person types the server's address, the app opens a Chameleon page, the
person approves, and the app holds a token it never shows. No token, no terminal.

## What it is today

Read as code on `44aea11b` (origin/main, 2026-11-21).

- **The MCP door.** `POST /mcp` (`server/mcp.js`) is stateless Streamable HTTP, protocol versions 2025-11-25,
  2025-06-18 and 2025-03-26. Its only credential is the agent's token, read by `agentGate` (`server/index.js`, about
  line 3781). A tool call is sent back through the app as one request to the route it wraps, carrying the same
  `Authorization` header, so the gate, the limits and the log apply. A foreign `Origin` is 403 (`headerProblem`).
- **The 401.** No token, or a bad one, answers 401 with `WWW-Authenticate: Bearer` and nothing more (`refuseNonAgent`
  in `server/mcp.js`, the gate in `server/index.js`). There is no `resource_metadata`, no `/.well-known/` document and
  no authorization server. The Claude app's form still marks "Sign in now" as "Detected" from that header, and the guide
  tells people not to choose it (`userguide-connecting-claude.md`).
- **The token.** `server/tokens.js`: `agt_` and 32 random bytes, SHA-256 at rest in each environment's
  `tokens.json`, one live token per agent and kind, compared in constant time. The owner chooses its life when making it
  (`LIFETIMES`: 30, 60 or 90 days, a year, or never; 30 days by default; `POST /api/users/:key/token { expires }`).
  `agentBearer` reads only the `Authorization` header and only an `agt_` value.
- **The agent model** (plan-agent-access, decisions 1 to 20; [plan-agent-matrix](plan-agent-matrix.md);
  [plan-admin-agent](plan-admin-agent.md)): an agent is a member account with `agent: true`, made by an owner or the
  admin on Manage > Users, working only in spaces it is added to, narrowed by the gate's list and the Agent column of
  the Roles grid. Switches: `AGENT_TOKENS` on the server, the owner's **Agents** switch, and per agent **Revoke** and
  **Turn off**. The set-up agent (`kind: "setup"`) makes and names spaces, behind `AGENT_SETUP` and the owner's
  **Set-up agents** switch. Limits 60 reads and 20 writes a minute, 3,000 and 300 a day. A log line per call, no
  content, 30 days.
- **The address.** `baseUrl(req)` builds the server's address from the request's `Host` or `X-Forwarded-Host`. On a
  hosted server (`BASE_DOMAIN`) each environment is `<slug>.<BASE_DOMAIN>` with its own data folder, so its own
  `tokens.json`. There is no configured public address for a single install.
- **Sessions.** A person's session is the `app_session` cookie, `SameSite=Lax`; writes from a page go through
  `sameOriginOnly`.

## The idea in one paragraph

Each environment becomes its own small OAuth authorization server, for agents only. An app finds it from the 401 on
`/mcp`, registers itself, and sends the person's browser to an **approval page** on the environment's own address. An
owner (or the admin) signs in if they are not already, sees which app is asking and where it will send them back, picks
the agent it will be and the spaces it works in, and approves. The app gets a short-lived access token and a refresh
token, both bound to that agent and to this environment's `/mcp`. Everything after that is today's agent: the same
gate, Agent column, limits, log, **Revoke** and **Turn off**. Pasted `agt_` tokens stay for Claude Code, the Agent SDK,
the Claude API and scripts.

## What a person does

1. **In the app:** add a custom server (a connector, a plugin) with the address `https://<their server>/mcp`, and
   choose sign-in (the app's word: "OAuth", "Sign in now").
2. **The app opens a Chameleon page.** If they are not signed in, they sign in as usual (two-step sign-in included),
   and come back to it.
3. **On the page:** it says which app is asking and that the app will act as an agent. They choose a new agent (named
   after the app) or an existing one, tick the spaces it works in, choose how long it lasts, and choose **Allow**.
4. **Done.** The browser goes back to the app, which is connected.

What still has to be true first: the server runs with `AGENT_TOKENS=true` (the person who runs the server), and the
environment's **Agents** switch is on (an owner). The page says so in plain words when either is off. The server must be
public on port 443, since the apps call it from their own cloud.

## How it fits the agent model

The draft keeps every agent decision as it is. Sign-in is a new way to hand an agent its credential, not a new kind of
account.

- **Who the app is: an agent account** (decision 1). The approving person is never the identity; the app never has an
  owner's or a member's own rights. Whether the page makes a new agent, picks an existing one, or both, is open
  question 1.
- **Who may approve: owners and the admin** (decision 2), and the host admin's stand-in on a hosted server, as for
  making an agent. A member, a moderator, a guest and an agent can't: the page says "Only an owner can connect an app to
  <environment>." and offers nothing to approve. A member can't authorize anything, not even for their own spaces.
- **Spaces** (decision 3): the spaces ticked on the page are added to the agent's members, as Set up does; never the
  Lobby. For a set-up agent there are none to tick: it works only in spaces it makes.
- **Rights** (decisions 4, 5, 7, 13, 17 to 20): unchanged. The Agent column and the gate decide; sign-in adds no route
  and no right. Post in Chat follows the Agent column.
- **The kind.** When `AGENT_SETUP` and **Set-up agents** are on, the page offers the kind for a new agent: "Works in
  spaces" or "Makes and names spaces" (a set-up agent). Otherwise only the first. One app connection is one kind,
  as one token is today.
- **How long** (decision 10, and the owner's lifetime choice now built): the page offers the same choice as **Make
  token**, 30 days by default. That is the life of the connection (the grant). Access tokens are short (1 hour) and
  are renewed with the refresh token until the connection ends (open question 4).
- **One way in per agent** (decision 10, "one live token per agent"): an agent has either a pasted token or one
  sign-in connection. Approving a connection for an agent ends its pasted token and any earlier connection; making a
  pasted token ends its connection (open question 5).
- **Revoke and Turn off** end the connection at once: every access and refresh token is looked up on every call, so
  nothing lives on in the app. **Agents** off, `AGENT_TOKENS` off and, for a set-up agent, `AGENT_SETUP` or **Set-up
  agents** off, stop it as they stop a pasted token.
- **The log** (decision 12): the same line per call, with the token id being the connection's id. New lines:
  "Connected by sign-in: <app name>, allowed by <person>", "Connection ended by <person>", and "Connection ended: an
  old key was used again" (refresh token reuse, below). Never a token, a code or a body.
- **Limits** (decision 15): the agent's, unchanged. The sign-in routes have their own, per address (Security).
- **The agreement gate:** the approving person passes it as any signed-in person does. The connection records who
  allowed it (`allowedBy`), which is the `madeBy` of plan-agent-access's "smaller fix" if that is ever built.

## Which OAuth pieces the MCP spec asks for

MCP's authorization section (2025-06-18, and 2025-11-25) makes the MCP server an OAuth 2.1 resource server and leaves
the authorization server to the implementer. Here they are the same server. Read from the spec as known in 2026; to be
checked against the spec when built.

| Piece | Spec | First build |
|---|---|---|
| Protected resource metadata (RFC 9728) at `/.well-known/oauth-protected-resource/mcp` (and the root form), and `resource_metadata` in the 401's `WWW-Authenticate` | Must | Yes |
| Authorization server metadata (RFC 8414) at `/.well-known/oauth-authorization-server`, with `code_challenge_methods_supported: ["S256"]` (2025-11-25 clients refuse a server without it) | Must (or OpenID discovery) | Yes |
| Authorization code flow with PKCE, S256 only | Must | Yes |
| Resource indicators (RFC 8707): `resource` on the authorize and token requests, the token bound to it | Clients must send; server must check the audience | Yes. A request without `resource` is read as this environment's `/mcp`, the only resource there is |
| Dynamic client registration (RFC 7591) | 2025-06-18 should; 2025-11-25 may, as the fallback | Yes: the way Claude and ChatGPT have registered so far (unverified for today) |
| Client ID metadata documents (the client's `client_id` is an https address of its own description) | 2025-11-25 should, the new default | No, a later step (open question 7) |
| Refresh tokens, rotated on each use | OAuth 2.1: rotated or bound for a public client | Yes (open question 4) |
| `iss` on the redirect back (RFC 9207) | Recommended | Yes, cheap |
| Token revocation endpoint (RFC 7009), introspection, OpenID Connect, scopes for step-up | Optional | No |
| CORS for browser clients | Not for the cloud apps | No |

## The contract

### Server (server-development)

**Where it lives.** A new `server/oauth.js` shaped as a part (plan-core-parts): `createOauth(base)` and `mount()`, as
`server/mcp.js` is. Per environment, in the environment's data folder: `oauth-clients.json` (registered apps) and the
connections and refresh tokens in `tokens.json` as new kinds. Authorization requests and codes are in memory only
(a restart ends a sign-in in progress; the app starts again). Never in an owner's copy, as `tokens.json` is not.

**When it is on.** Only where an agent token works today: `AGENT_TOKENS` on and an environment (never the product host
or the host console). Off, every route below is 404 and the 401 on `/mcp` is as today. Whether it also needs its own
variable is open question 2. The **Agents** switch off: the metadata still answers, the approval page says agents are
off, and no token is issued.

**The address.** The issuer is the environment's own origin, `https://<slug>.<BASE_DOMAIN>` on a hosted server; the
resource is that origin plus `/mcp`. On a single install, the address is open question 3.

**Routes.**

| Method | Route | What |
|---|---|---|
| GET | `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-protected-resource` | `{ resource, authorization_servers: [issuer], bearer_methods_supported: ["header"], scopes_supported: ["agent"] }` |
| GET | `/.well-known/oauth-authorization-server` | `{ issuer, authorization_endpoint, token_endpoint, registration_endpoint, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"], scopes_supported: ["agent"], authorization_response_iss_parameter_supported: true }` |
| POST | `/oauth/register` | RFC 7591. Takes `client_name`, `redirect_uris`, `token_endpoint_auth_method`, `grant_types`, `response_types`, and ignores the rest. Answers 201 `{ client_id, client_name, redirect_uris, ... }`, with a `client_secret` only when a secret method was asked for (stored hashed) |
| GET | `/oauth/authorize` | Checks the request (below), keeps it in memory under a random id for 10 minutes, and redirects to the approval page `/connect-app?request=<id>`. A bad `client_id` or `redirect_uri` shows an error page and never redirects to the app |
| GET | `/api/oauth/requests/:id` | For the signed-in person: what the page shows: `{ app: { name, returnsTo }, environment, mayApprove, agentsOn, kinds, agents: [{ key, name, kind, hasToken, connected }], spaces: [{ id, name }], lifetimes }`. `mayApprove` false for anyone but an owner, the admin or the stand-in |
| POST | `/api/oauth/requests/:id/allow` | `{ agent: "new" \| <key>, name?, kind?, spaces: [ids], expires }`, same origin and the page's one-time `form` value. Makes or picks the agent, adds the spaces, makes the connection, answers `{ redirect }` (the app's `redirect_uri` with `code`, `state` and `iss`) |
| POST | `/api/oauth/requests/:id/deny` | Answers `{ redirect }` with `error=access_denied` and `state` |
| POST | `/oauth/token` | `grant_type=authorization_code` (`code`, `redirect_uri`, `client_id`, `code_verifier`, `resource`) or `refresh_token` (`refresh_token`, `client_id`, `resource`). Answers `{ access_token, token_type: "Bearer", expires_in: 3600, refresh_token, scope: "agent" }` with `Cache-Control: no-store`. Errors are RFC 6749's (`invalid_grant`, `invalid_client`, `invalid_request`, `unsupported_grant_type`) |

The approval page's own path, `/connect-app`, and the route names are the planner's draft; experience-design and
server-development may name them.

**The authorize check.** `response_type=code`; a known `client_id`; `redirect_uri` exactly one of the client's
(string match); `code_challenge` present and `code_challenge_method=S256` (`plain` refused); `state` passed back as
given; `scope` absent or `agent`; `resource` absent or this environment's `/mcp`. Anything else, once the client and
redirect are known good, goes back to the app as `error=invalid_request`.

**The code.** 32 random bytes, kept hashed, one use, 60 seconds, bound to the client, the redirect, the challenge, the
resource and the connection. A second use of a code ends the connection it made.

**Tokens.** Two new kinds in `server/tokens.js`, each with its own prefix and shape, SHA-256 at rest, compared in
constant time as `agent` is: an access token (draft prefix `oat_`, 1 hour) and a refresh token (draft prefix `ort_`,
the connection's life). Each record carries the connection id, the agent, the client and the resource. A refresh
answers a new pair and ends the old refresh token; an ended refresh token used again ends the whole connection and
leaves a log line.

**The gate.** `agentBearer` also reads an access token. Its checks are the agent token's (the agent exists, is an
agent, is not off, **Agents** and the kind's switches on) plus: the connection is live, and the token's resource is
this environment's `/mcp`. An access token is accepted only on `/mcp` and on the requests `server/mcp.js` itself sends
back through the app for a tool call (marked in process, never by a header a client can send); on any other route it is
401 `That agent token is not valid.` so its audience holds. Every failure is that same sentence.

**The 401 on `/mcp`.** `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/mcp",
scope="agent"` from both `refuseNonAgent` and the gate's refusal on `/mcp`. A pasted token is unaffected.

**What the agent page reads.** `GET /api/users/:key/token` adds `connection: { id, app, returnsTo, allowedBy,
allowedAt, lifetime, expiresAt, lastUsedAt, lastAddress }` or `null`. `DELETE /api/users/:key/token` ends whichever
the agent has.

**Registered apps.** At most 200 per environment; one that never got a connection is dropped after a day, one whose
connections have all ended after 30 days. `client_name` is cleaned to plain text, at most 60 characters. `redirect_uris`:
1 to 5, each `https` with no fragment, or a loopback address for an app on the person's own computer
(`http://127.0.0.1:<port>/...` or `http://localhost:<port>/...`, any port at use, RFC 8252), never `http` elsewhere,
never a custom scheme in the first build.

### Pages (experience-design)

**The approval page** (`/connect-app`), drawn from the shared pieces. Exact words, with `<app>` the name the app gave
and `<environment>` the environment's name:

- Title: "Connect <app>"
- First line: "<app> wants to work in <environment> as an agent."
- Under it, small: "This name is what the app calls itself. After you allow it, you go back to <host>." (`<host>` is
  the redirect's host, the one fact the page can stand behind.)
- **Connect as:** "A new agent" with a name box (default `<app>`), or one of the environment's agents by name. Picking
  one with a token: "This ends its current token."
- **Kind** (only when set-up agents are on): "Works in spaces" or "Makes and names spaces".
- **Spaces:** a tick list of the environment's spaces under "Works in" (not shown for a set-up agent). None ticked is
  allowed: "It can't see anything until you add it to a space."
- **How long:** the agent page's choice, 30 days first. Never: the agent page's own warning.
- **What it can do:** "It can read what a member can read in these spaces, read their Chat, and ask their modules for
  changes. It can't delete anything, change settings or see other spaces." For a set-up agent: "It can make spaces and
  name them. Adding or taking off people waits for an owner."
- Buttons: **Allow** and **Don't allow**.
- A member, moderator or guest: "Only an owner can connect an app to <environment>. Ask an owner to do it." and a
  **Back** button.
- **Agents** off: "Agents are off for <environment>. An owner can turn them on in Manage, Users." `AGENT_TOKENS` off:
  the page is never reached (404).
- An expired or used request: "This sign-in has ended. Start again from <app>."
- The page sets `frame-ancestors 'none'` and is never cached.

**The agent page** (Manage > Users > an agent): under **Token**, when connected by sign-in: "Connected by sign-in:
<app>, allowed by <person> on <date>. Goes back to <host>." with the existing lifetime line, "Last used ..." and
**Revoke** (which ends the connection). **What it did** reads the three new lines above. The **Connect Claude** panel
gains one line before its steps: "Using an app that can sign in? Give it this address: <origin>/mcp" with **Copy**.

## Per environment

Each environment is its own issuer, its own registered apps, codes and tokens, in its own folder. An app registered at
one environment is unknown at another; a token from one is 401 at another, as a pasted token is. The product host and
the host console have no metadata and no sign-in (404). A person signed in to two environments approves in the one whose
address the app was given, since the approval page is on that environment's host and reads that environment's session.

## The apps, and what can be checked

- **Claude apps (web, desktop, phone).** Connectors call from Anthropic's cloud: `/mcp`, `/oauth/register` and
  `/oauth/token` must be reachable from the internet on 443; only `/oauth/authorize` and the approval page are opened in
  the person's browser. Anthropic's documented redirect was `https://claude.ai/api/mcp/auth_callback`, with
  `https://claude.com/api/mcp/auth_callback` also named; the form also has an advanced field for a client id and
  secret. Remembered from Anthropic's documentation, to be checked when built.
- **Claude Code.** Supports sign-in for a remote server (`/mcp` in Claude Code, "Authenticate"), with a loopback
  redirect. Pasted headers stay its first way.
- **ChatGPT.** OpenAI's Apps SDK documentation described OAuth 2.1 with PKCE and dynamic registration, the redirect
  `https://chatgpt.com/connector_platform_oauth_redirect`, and later client ID metadata documents. Thomas's report
  that its form has no header field is unverified. Remembered from OpenAI's documentation, to be checked when built.
- **Codex.** Its form offers "Bearer token env var" and headers; the Codex command line was documented with
  `codex mcp login` for servers that sign in, with a loopback redirect. Unverified.

None of these can be checked from here: the cloud apps need a public HTTPS server, and the check scripts can only play
the app's part.

## Security

- **Consent text** names the app as self-described and the return host as fact (above). The spaces and kind are chosen
  by the person, never by the app's request.
- **Who approves:** owners, the admin and the host admin's stand-in, signed in, past the agreement gate and two-step
  sign-in as they are anywhere. An agent's own token never reaches the page (the gate refuses it).
- **CSRF and clickjacking:** **Allow** and **Don't allow** need the same origin (`sameOriginOnly`) and the request's
  one-time `form` value, which is tied to the session that opened the page; `frame-ancestors 'none'`. `state` is the
  app's own defence and is passed back unchanged.
- **Redirects:** exact match only, `https` or loopback, never sent anywhere before the client and redirect are known
  good (no open redirect). The approval answer gives the page the address to go to; the server never redirects there
  from a GET.
- **Binding:** codes are bound to client, redirect, challenge and resource; tokens to connection, agent, client and
  resource, and to this environment by being stored only there. An access token works only at `/mcp`.
- **Nothing secret in an address or a log:** access and refresh tokens go only in the token answer and the
  `Authorization` header; never a query string, a cookie or a form field. The code is in the redirect by the protocol;
  it is one use, 60 seconds and useless without the verifier. No token, code, verifier, secret or request body goes in
  the agent log, the server's log or an error.
- **Limits per address:** registration 10 an hour; authorize 30 a minute; token 60 a minute and, for failures, the
  sign-in limiter's rule (five wrong in a row blocks the address for a while). Over: 429 with `Retry-After`.
- **Refresh theft:** rotation, and reuse ends the connection.
- **What a stolen connection can do:** exactly what a leaked agent token can (plan-agent-access, "What a leaked token can
  do"), until it ends.

## What stays

Pasted `agt_` tokens, **Make token**, the **Connect Claude** panel and its command, for Claude Code, the Agent SDK, the
Claude API, scripts and anyone who prefers them. Personal tokens for people (plan-ai-integration step 15) are not this
plan.

## Left to build, in order

Each step is core except where said. Thomas names the kind of build.

1. **The sign-in server (server-development, larger model; security).** `server/oauth.js`, the two token kinds, the
   metadata, register, authorize, the request routes, token, the gate and the 401 change, the agent page's
   `connection`, the log lines, `tools/route-table.json`, and `tools/check-oauth.mjs`. quality-assurance reads it as a
   security change.
2. **The approval page and the agent page (experience-design).** `/connect-app`, its states, the agent page's
   connection line, **What it did**, the panel's address line, and `tools/check-oauth-page.mjs`.
3. **Live trial (Thomas).** The Claude app, ChatGPT, Claude Code and Codex against a public server (Verify). What they
   actually send decides any change before the documentation.
4. **Documentation (content-manager).** Connecting Claude (sign-in first, the token as the other way), a new page for
   ChatGPT and Codex, Agents API, architecture-agent-access, the settings reference, and the known-issues entry.
5. **Later, if an app needs it:** client ID metadata documents (server-development), fetched with the existing safe
   fetcher.

## Verify

**Checked by a tool** (`tools/check-oauth.mjs`, on throwaway servers, single and hosted, the script playing the app):

- `AGENT_TOKENS` unset: every new route 404, and `/mcp`'s 401 header unchanged.
- The metadata's fields, issuer and resource per environment; the 401's `resource_metadata`.
- Registration: limits, the redirect rules, a cleaned name, a secret only when asked and stored hashed.
- Authorize: a bad client or redirect shows the error page and never redirects; no PKCE, `plain`, a foreign `resource`
  or scope go back as errors.
- The request routes as owner, admin, member, moderator, guest, signed out and an agent token: only the first two may
  allow. Without same origin or the `form` value: refused.
- The code: once, 60 seconds, wrong verifier, wrong redirect, wrong client; a second use ends the connection.
- Tokens: an access token works at `/mcp`, and its tool calls run through the gate; the same token on a REST route is
  401. Refresh rotates; reuse ends the connection. Revoke and Turn off end it on the next call. Lifetime ends it.
- One way in: allowing ends a pasted token; making a token ends a connection.
- Hosted: an app and a token of environment A are unknown at B.
- Nothing in the clear: a search of `DATA_DIR` and the logs for every token, code and verifier finds none.
- The existing checks still pass with a pasted token: `check-agent-tokens`, `check-mcp`.

**Checked in a browser** (`tools/check-oauth-page.mjs`): the page's words and states, wide and phone, framing refused.

**Not checkable here:** a real Claude app, ChatGPT, Claude Code or Codex completing sign-in; which registration and
token methods they use, whether they send `resource`, how they refresh; their redirect addresses; whether ChatGPT's
form takes a header; a cloud app reaching a home server through its proxy. No step needs a LiveKit call.

## Open questions

1. **Who the app becomes.** (a) The page makes a new agent, named after the app; (b) the page picks an agent the owner
   made first; (c) both, new by default; (d) the approving person (a personal token). Lean: (c). It is one screen for
   a new user and keeps the existing agent for someone who set one up; (d) gives an app a person's whole rights, which
   decision 1 and plan-ai-integration's open questions 4 and 5 rule against. Blocks step 1.
2. **Its switch.** (a) On wherever agents are on (`AGENT_TOKENS` and **Agents**); (b) its own server variable on top.
   Lean: (a). The registration route is harmless until an owner allows, and one more variable is one more step, which is
   what this plan removes. Blocks step 1.
3. **A single install's address.** (a) The request's address, as the Connect Claude panel uses today; (b) a new
   `PUBLIC_URL` variable, sign-in off without it. Lean: (a), with tokens bound to the address they were issued at, so a
   token issued at one name is refused at another. (b) is safer against a misconfigured proxy but adds a step. Small;
   blocks step 1 only as a choice of code.
4. **Refresh tokens.** (a) 1-hour access tokens and rotated refresh tokens; (b) one access token for the whole chosen
   life, no refresh. Lean: (a): the apps expect it, and a token copied out of an app's logs lasts an hour. (b) is less to
   build and is what the pasted token already is.
5. **One way in per agent.** (a) A pasted token or one connection, each ending the other; (b) both at once. Lean: (a),
   decision 10 as it stands. (b) needs decision 10 changed.
6. **Which return addresses.** (a) Any `https` address and loopback, shown on the page; (b) a server variable listing
   allowed hosts. Lean: (a), since the person sees the host before allowing. (b) could be added later without changing
   anything else.
7. **Client ID metadata documents in the first build.** Lean: no, dynamic registration first, since the apps used it;
   added as step 5 when an app needs it.
8. **Turning Agents on from the approval page.** Lean: no. The page says how; the switch stays a deliberate act in
   Manage.

When Thomas decides, [plan-agent-access](plan-agent-access.md) "The MCP server" and decision 10, and plan-ai-integration
step 18 and open question 3, need a dated note pointing here, and the plan goes into `TODO.md` under Planned.
