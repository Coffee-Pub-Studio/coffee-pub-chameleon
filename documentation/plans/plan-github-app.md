# GitHub App Plan

**Audience:** Thomas decides how a space connects to a GitHub repository through a GitHub App, and the few foundational choices in "For Thomas". server-development builds the app's credentials, the installation tokens, the link flow and the checks; experience-design builds the follow control and the Service terms line; content-manager documents what lands. Thomas alone registers the app on GitHub and sets its environment variables.

**Status:** Draft, 2026-11-26; one decision made, nothing built. Thomas's point, as relayed on 2026-11-26: the one server-wide token and allow list (`ISSUES_GITHUB_TOKEN`, `ISSUES_GITHUB_WRITE`, from [plan-github-two-way](plan-github-two-way.md)) only suits one person; ten people with their own GitHub repositories could not each set up a two-way sync for their own space. He decided, by a clickable answer, to use a GitHub App (Decisions, below). This plan replaces the two-way plan's decision 2 ("Thomas's own fine-grained token now, a GitHub App later") once Thomas approves it. Read against `main` at `db558457` as code and documentation only: `server/issues.js`, `server/issue-providers/` (`index.js`, `github.js`, `test-standin.js`), the issue pull and the write-through in `server/index.js` (from "the issue pull", about line 13876, to `POST /api/spaces/:id/issues-pull/now`), `wireFollows` and the `follows: "issues"` control in `public/module-settings.js`, the door and `PRODUCT_HOST_PATHS` in `server/index.js` and [architecture-environments](../architecture/architecture-environments.md). Nothing was run. GitHub's pages were read on 2026-11-26 at docs.github.com (listed under "GitHub's terms and the app's rules, as read"); no request was made to GitHub's API and no app was registered or installed.

## What it is today

- **The pull** (`server/issues.js`, `server/issue-providers/github.js`, `server/index.js` "the issue pull"). An environment's owner names a repository (`owner/name`) for a space and turns the pull on (`PUT /api/spaces/:id/issues-pull`, refused for anyone but an owner and for agents); every 10 minutes the server reads `GET /repos/{owner}/{repo}/issues` with `since` and the last etag, once a day every page. The record per environment is `issues.json` (`{ spaces: { <spaceId>: { provider, repo, on, since, etag, last, ..., write, writeBy, writeAt } } }`, `cleanRecord`), never a token.
- **The token.** `issueToken(adapter)` reads `process.env.ISSUES_GITHUB_TOKEN` (the adapter's `tokenEnv`) on every call; it goes only in the `Authorization` header to `https://api.github.com`. Without it, reads go without a token: 60 requests an hour for the whole server's address, and a 304 still counts.
- **Writing back** (two-way steps 1, 2, 4 and 5 built). With `write` on, a change to pulled work goes to GitHub first (`issueWriteThrough`; `POST /api/spaces/:id/issues` for a new issue), one at a time in a write lane, as the token's owner. Turning writing on is refused unless `ISSUES_GITHUB_WRITE` names the repository (`writeAllowed`: `owner/name`, or `<environment slug>:owner/name` on a host with environments) and a token is set (`SAY.noWrite`, `SAY.noToken`). The module permission `write_out` ("Change it on GitHub") gates who in the space may write through.
- **The follow control** (`control` with `follows: "issues"`, `wireFollows`). A text box for `owner/name` or a pasted address (`repoFrom`), one button **Follow this repository** or **Stop following**, a status line, and under it a switch **Changes here go to GitHub** with the line "Moves, closes, titles and tags made here change the issues on GitHub, as the account that owns this server's token." or "This server is not set up to change GitHub for this repository."
- **The outside calls** are made by the core only, through `getter`: one origin per adapter (`https://api.github.com`), 6 seconds, 2 MB, a redirect followed only on that origin and never for a write. No module code can reach the network.
- **Hosts with environments.** With `BASE_DOMAIN`, each environment is `<slug>.<base>`, the console `admin.<base>`, and the product host (`PRODUCT_DOMAIN`, else the bare base) serves only `PRODUCT_HOST_PATHS`. Environment variables are the host's, shared by every environment.

## Decisions

1. **A GitHub App** (Thomas, 2026-11-26, a clickable answer). Chameleon is registered once as a GitHub App; each repository's owner installs it on their repository on GitHub (no token to copy) and picks that repository in their space; changes show on GitHub as the app; nobody pastes a secret; the server holds one app key. Reason: one server-wide token and allow list serves one person; an app lets every owner on a server connect their own repository. This replaces the two-way plan's decision 2 and its section 3 ("The token").

Thomas's standing rules bind every option: "we NEVER use paid services. EVER." (and never a free tier that forbids commercial use, its terms read first, Thomas, 2026-11-25); configuration in environment variables, never in code; a secret never in chat, a log, an answer, a page or a space's data; the product is unreleased, so no compatibility layers, aliases or data migrations; the Names in CLAUDE.md. The two-way plan's other decisions stand: what flows back (decision 3), writes at once with GitHub winning a conflict (decision 4), and what is sent (its section 13).

## GitHub's terms and the app's rules, as read

Read on 2026-11-26 at docs.github.com (the pages' Markdown, through `docs.github.com/api/article/body`), by the planner:

- **GitHub Terms of Service** (effective 2026-04-27), section H, API Terms: unchanged from what the pull plan read. Using the API means agreeing to the Terms and section H; abuse may suspend API access; "You may not share API tokens to exceed GitHub's rate limitations"; nothing collected for spam or sold; GitHub "may offer subscription-based access" only for high throughput or resale. Section L (Payment) bills only paid plans and paid features beyond a plan. **GitHub Additional Product Terms**: sections for Actions, Codespaces, Copilot, Packages, Pages, Sponsors and others; none for GitHub Apps.
- **About creating GitHub Apps**, **Registering a GitHub App**: any personal account or organization may register up to 100 apps, with no limit on installations; no fee is named anywhere in the flow. **About GitHub Marketplace for apps**: "Anyone can share their apps with other users for free"; only selling an app needs an organization and publisher verification. Chameleon's app is never listed or sold.
- **So the app passes Thomas's rule.** Registering, installing and calling the API as an app cost nothing, and nothing forbids commercial use. Nothing in this plan may use a paid service: no Marketplace paid plan, no GitHub Enterprise Cloud (which raises limits), no key vault service (GitHub suggests Azure Key Vault for the private key; it is a paid service and is not used), and no webhook relay service (GitHub names Smee for development; not used).
- **Installation tokens** ("Generating an installation access token", the REST page "Create an installation access token for an app"): `POST /app/installations/{installation_id}/access_tokens` with a JWT; the token lasts one hour; `repositories` or `repository_ids` narrow it to some repositories and `permissions` to some permissions; the answer carries the token, its expiry, its permissions and the repositories it reaches; 201, 401, 403, 404, 422. Since 2026-04-27 new tokens are being moved to a longer format (`ghs_APPID_JWT`), so nothing may assume a token's length.
- **The JWT** ("Generating a JSON Web Token"): RS256, claims `iat` (60 seconds in the past), `exp` (at most 10 minutes ahead) and `iss` (the client ID, recommended, or the app ID), sent as `Authorization: Bearer`. Node's own `crypto` signs RS256, so no new dependency.
- **The private key** ("Managing private keys"): PEM (PKCS#1), never expires, up to 25 per app for rotation, deleted by hand on GitHub. "Alternatively, you can store the key as an environment variable", weaker than a key vault; never in code.
- **Rate limits** ("Rate limits for the REST API"): an installation has 5,000 requests an hour (more past 20 repositories or 20 organization users, at most 12,500); a person's user token shares that person's own 5,000; no more than 2,000 token requests an hour for an app. Without any token: 60 an hour per address.
- **The setup URL** ("About the setup URL"): after an install GitHub sends the person to it with `installation_id`, and warns: "Bad actors can hit this URL with a spoofed `installation_id`... you should generate a user access token for the user who installed the GitHub App and then check that the installation is associated with that user." With **Request user authorization (OAuth) during installation** ticked, the setup URL cannot be set, GitHub sends the person to `login/oauth/authorize?client_id=...` with no `state`, and the first callback URL is used.
- **User access tokens** ("Generating a user access token", web application flow): `https://github.com/login/oauth/authorize` with `client_id`, `state` (random, checked on return), `redirect_uri` (must match a registered callback URL exactly) and PKCE (`code_challenge`, `S256`); the `code` is exchanged at `https://github.com/login/oauth/access_token` with the client ID, **the client secret**, the code, `redirect_uri` and `code_verifier`. Expiring tokens last 8 hours. Up to 10 callback URLs; wildcard matching is discouraged. `GET /user/installations` lists the installations "that the authenticated user has explicit permission (:read, :write, or :admin) to access" and `GET /user/installations/{installation_id}/repositories` the repositories in one; "explicit" means owned, a collaborator, or through an organization.
- **Best practices**: an installation token attributes activity to the app; "if your GitHub App takes an action on behalf of a user, it should always use a user access token instead of an installation access token. Otherwise, your app might allow a user to see or do things that they shouldn't be able to see or do." Cache tokens until they expire. Revoke tokens no longer needed (`DELETE /installation/token`, `DELETE /applications/{client_id}/token`).
- **Installing** ("Installing a GitHub App from a third party", "Making a GitHub App public or private"): the install address is `https://github.com/apps/<app-slug>/installations/new`; the installer picks an account and **All repositories** or **Only select repositories**, and sees the permissions asked for. A private app installs only on the account that owns it; a public one on any account. An organization member who may not install sees **Request**, and GitHub asks the organization's owner. A repository administrator may install an app on their own repositories in an organization unless the organization forbids it.
- **Suspending**: the app's owner (through the API) or the installing account (on GitHub) can suspend an installation; the app then reaches nothing of that account.
- **Webhooks** ("Using webhooks with GitHub Apps"): optional; unticking **Active** needs no webhook URL.
- **Manifests** ("Registering a GitHub App from a manifest"): a page can send a person to GitHub with the app's settings filled in; GitHub answers with a code that the server exchanges within an hour (`POST /app-manifests/{code}/conversions`) for the app's ID, private key, client ID and client secret.
- **REST**: `GET /app` (JWT) answers the app's own name and slug; `GET /repos/{owner}/{repo}/installation` (JWT) answers a repository's installation, 404 when none, 301 when the repository moved.

Not re-read, and to be checked by server-development before step 2: whether `state` given on the install address comes back on the setup URL (recalled as yes); the exact shape of a repository's `permissions` in `GET /user/installations/{id}/repositories`; the API version to send (`github.js` sends `X-GitHub-Api-Version: 2022-11-28`; the pages read today show `2026-03-10`).

## The shape, with the leans

Each lean is a suggestion. Those marked "taken" are small and written down under Thomas's standing rule (CLAUDE.md, "Decisions stick"); those in "For Thomas" are his.

### 1. What the app asks for

Taken: **Issues: read and write** and **Metadata: read** (GitHub adds Metadata to every app), nothing else: no Contents, no Pull requests, no Projects, no organization or account permissions, no events. Labels are part of Issues. The installation token is narrowed further on each mint (section 4). Asking for more later would make every installer approve it again by e-mail, so nothing is asked "in case".

### 2. Proving the person may use an installation

The setup URL's `installation_id` can be forged (GitHub's warning above). On a host where the app is public and installed by many people, any owner who can type a number could otherwise link a space to someone else's repository and write to its issues as the app.

- **(a) A GitHub sign-in during linking** (lean, For Thomas 1). The owner presses **Connect to GitHub**; GitHub asks them once to authorize the app (a click on GitHub, nothing pasted; on later links GitHub sends them straight back). The server exchanges the code for a user token with the client secret and PKCE, reads `GET /user/installations` and each installation's repositories, **revokes the user token at once**, and keeps only the list (installation ids, repository ids and names, private or public, and the person's permission on each) in memory for 15 minutes for that person and that space. Nothing of the user token is stored. Cost: a second secret on the server (the client secret), one more GitHub page in the flow, and GitHub learns which GitHub account linked (it does anyway, as the installer).
- **(b) Trust the setup URL inside a short window.** Accept an `installation_id` that comes back with a `state` Chameleon issued in the last 10 minutes and whose installation was made or changed in that window (`GET /app/installations/{id}` with the JWT). No client secret. It narrows the forgery but does not close it (an installation changed by its owner in the same minutes can be claimed), it breaks for a repository already installed (nothing new is made), and it cannot tell what the person may do on GitHub.
- **(c) A private app only.** Register the app "Only on this account", so its installations are all the app owner's own; any owner on that server may then link any of them. Safe only on a server where every owner is trusted with every repository of that account, which is exactly not the ten-people case.

Lean: (a). It is the only option GitHub calls correct, it makes the repository list possible (section 6), and the user token lives for seconds.

### 3. Who may turn writing on

- **(a) The linking person's own GitHub right decides** (lean, For Thomas 2). Writing (`write: true`) may be turned on only when the person who linked has write access on GitHub to that repository (the repository's `permissions` in the list from section 2: `push`, or `triage`, which also allows labels and closing; server-development confirms the field names). Read-only linking needs only explicit read access. Otherwise a GitHub reader with an owner's rights in Chameleon could write to the issues through the app, the escalation GitHub's best practices warn about. Checked once, at linking; if their GitHub access changes later, it holds until the space is linked again.
- **(b) The installation alone decides.** Anyone whose installation list contains the repository may turn writing on. Simpler; lets a GitHub reader write through the app.

Lean: (a). In the space, who may write through stays `write_out` as built (owners always, moderators by default).

### 4. Installation tokens

Taken:

- **Used for reading and writing** whenever the space is linked through the app: the pull's `list`, the conditional `get` before a write, the writes and `hasLabel`. A linked space has the installation's 5,000 an hour (a 304 on an authorized request costs nothing), not the server's shared 60.
- **Minted on demand and cached in memory**, keyed by installation and repository id, narrowed to that one repository (`repository_ids: [<id>]`) and to `{ issues: "write", metadata: "read" }` (`issues: "read"` when the space does not write). Reused until 5 minutes before its `expires_at`, then minted again; dropped on a 401. Never on disk, never in `issues.json`, never logged, never answered; the cache is emptied on restart. One mint per repository an hour is far under GitHub's 2,000.
- **The JWT** is signed per mint (10 minutes, `iat` 60 seconds back, `iss` the client ID) and never kept.
- **The mint's answer names the repository** as GitHub has it now; the space's `repo` is updated from it, which is how a rename is followed (section 9).
- **One shared rest.** An installation's limit is shared by every space and environment linked to it; a 403 or 429 rests every space following that repository, in every environment on the host (today `issueRest` rests one environment's).

### 5. The server configuration

Environment variables, read at start, the host's on a server with environments. Taken, except where For Thomas says:

- `ISSUES_GITHUB_APP_CLIENT_ID`: the app's client ID (the JWT's `iss`, and the OAuth `client_id`). No app ID variable: the client ID serves both, as GitHub recommends.
- `ISSUES_GITHUB_APP_CLIENT_SECRET`: needed only for section 2 (a). Without it, the app is off and the line on Service terms says so.
- `ISSUES_GITHUB_APP_KEY_FILE`: the path of the private key's `.pem` file (a Docker secret or a mounted file; the lean, because a PEM spans lines). Or `ISSUES_GITHUB_APP_KEY`: the PEM itself, `\n` accepted for line breaks. Exactly one of the two; both set is a start line and the app off. The key is read once into a `crypto` key object, never kept as text, never logged (a key that cannot be read logs "The GitHub app's private key could not be read." and nothing of it).
- No variable for the app's slug or name: `GET /app` with the JWT answers both at the first use, cached in memory; they build the install address and the words "changes show as ...".
- The app is **on** when the client ID, the client secret and a readable key are set and `GET /app` answers. With none of them set, everything behaves as on a server without the app (section 7). A single-environment install without these variables behaves as before, minus the removed token (section 7).
- Never in a log line, an answer, a page, a space's data, `issues.json`, an export or the stand-in's record: the key, the client secret, a JWT, an installation token or a user token. `tools/check-issues.mjs` holds this.

**Registering the app** (Thomas's, once per server; content-manager writes it as a short checklist in the setup guide):

- Name it (34 characters at most, unique on GitHub; the name a person sees on every change), homepage the server's address or the repository.
- Callback URL: the server's link address (section 6), exactly one, wildcard off. Setup URL: the same address. **Request user authorization (OAuth) during installation**: off (it drops `state` and the setup URL). **Expire user authorization tokens**: on. **Enable Device Flow**: off. Webhook **Active**: off.
- Permissions: Issues read and write; Metadata read (GitHub's). Nothing else.
- Where it can be installed: **Any account** when other people's repositories will connect (a host with environments, or a server whose owners use their own GitHub accounts); **Only on this account** when every repository is the app owner's own.
- Generate a private key and a client secret; set the three variables; restart.

*A manifest to fill the form* (not leaned): a **Register the GitHub app** button on the host console could send the administrator to GitHub with every field above already set, and GitHub would hand the key and secret back to the server. Saves typing, but the server would then have to store the key itself (in `DATA_DIR`, sealed), against the rule that configuration lives in environment variables. Lean: not built; the checklist instead.

**A host with environments shares one app.** The host's administrator registers it as **Any account**; its callback is on the product host (section 6); every environment's owners link through it. No administrator allow list (taken): the installation is the repository owner's consent, linking is owner-only and checked against GitHub, and GitHub's terms are accepted for the host as today. If a host later wants to keep some environments out, that is a variable to add then, not now.

**Separate servers never share an app.** A self-hoster registers their own; sharing one app's key between servers would be sharing a credential, and GitHub's terms forbid sharing tokens to pass the limits.

### 6. The link flow

One flow, for every case. Taken, except the parts named in For Thomas.

1. In the space's Planner - Projects settings, an owner presses **Connect to GitHub**. The server (`POST /api/spaces/:id/issues-link`) makes a link record in memory: a random `state`, a PKCE verifier, the environment, the space, the person, and when it ends (15 minutes); it answers GitHub's authorize address (`client_id`, `state`, `code_challenge`, `S256`, `redirect_uri`). The page goes there in the same tab.
2. GitHub asks the person to authorize the app (the first time only) and sends them to the link address with `code` and `state`.
3. **The link address**: `GET /api/issues-link/back`. On a single-environment server it is on the server's own address. On a host with environments it is on the product host (added to `PRODUCT_HOST_PATHS`), because a callback must match exactly and an app has at most 10. It finds the link record by `state` (else "This link has run out. Go back and press Connect to GitHub again."), exchanges the code, reads the installations and their repositories (at most 20 installations and 300 repositories in all, enough for a person; past that the list says so), revokes the user token, keeps the list on the link record, and sends the person to their environment's own address, back to the space's settings, with the link's id. It never sets a cookie and never names the space to GitHub.
4. The settings page asks for the list (`GET /api/spaces/:id/issues-link?link=<id>`), answered only to the same person, in the same environment and space, inside the 15 minutes. It shows the repositories the person can reach through the app, newest first, each with its name, **Private** when it is, and **Follow**.
5. **Not in the list?** Under it: "Is your repository not here? Install the app on it on GitHub, then come back." with **Install on GitHub** (`https://github.com/apps/<slug>/installations/new?state=<state>`). After the install GitHub sends the person to the setup URL (the same link address), which, holding no code, sends them straight on to step 1's authorize address with the same link record, and so back to a fresh list. The `installation_id` GitHub adds is ignored: only the list from the person's own token counts.
6. **A repository they do not own.** If the repository belongs to someone else, the page says: "Only the repository's owner, or an administrator of its organization, can install the app on it. Send them this address: <install address>. Once it is installed and you can see the repository on GitHub, press Connect to GitHub again." For an organization repository, GitHub's own **Request** asks the organization's owner. A Chameleon owner who is not on the repository at all on GitHub never sees it in the list, so cannot link it.
7. **Follow** sends `PUT /api/spaces/:id/issues-pull` with `{ on: true, link, repositoryId }`. The server takes the installation, the repository and the person's permission from the link record (never from the page), writes the space's record, and pulls at once, as today.

Agents never link: the route refuses agents and anyone but an owner, as `PUT .../issues-pull` does now.

### 7. A public repository with no app, and the old token

- **Reading a public repository without the app still works** (taken): the owner may follow any public repository read only, with no install and no token, as today. Reads then go without a token, at 60 an hour for the server's whole address, which at one read every 10 minutes is about ten such spaces per server. Writing needs the app.
- **`ISSUES_GITHUB_TOKEN` and `ISSUES_GITHUB_WRITE`** (For Thomas 3):
  - **(a) Remove both** (lean). The app replaces the token for every linked space; the installation and the linking check replace the allow list. Nothing reads either variable; `tokenEnv` leaves the adapter contract; `SAY.noToken`, `writeListOf`, `writeAllowed` and `issueMayWrite` go; `tools/issues-to-plan.mjs` and its check go too (the pull plan already said to remove the stopgap once the pull existed). A space linked today by the token (Bug Squash) keeps pulling as a public repository without a token and refuses writes ("Connect this repository through the GitHub app to change it from here.") until its owner presses **Connect to GitHub**. No migration: the record simply has no installation.
  - **(b) Keep the token as a read-only convenience**: `ISSUES_GITHUB_TOKEN` used only to read public repositories not linked through the app, for 5,000 an hour instead of 60; `ISSUES_GITHUB_WRITE` removed. Costs one more path to keep and check, and GitHub's terms forbid sharing a token to pass the limits, which one person's token used for every environment on a host comes close to.
  - Lean: (a), by the no-compatibility rule and because a server with the app has a better answer for every case the token served.

### 8. The per-space record

Taken. `issues.json` (`cleanRecord`) gains, per space:

- `via`: `"app"` (linked through the app) or `"public"` (read only, no token).
- `installation`: the installation's id (a number); `repositoryId`: the repository's id (a number, stable across renames); `repo` stays the `owner/name` shown, refreshed from GitHub.
- `writeOk`: whether the linking person had write access on GitHub (section 3); `write` stays the owner's switch and can be on only with `via: "app"` and `writeOk`.
- `linkBy` and `linkAt`: who linked it and when (Chameleon's own key, never a GitHub login).
- `appError`: the last trouble with the app, as one sentence or `''` (section 9).

Never a token, a code, a secret or the person's GitHub login. The installation id is not a secret (it only works with the app's key). `write`, `writeBy` and `writeAt` stay as built.

### 9. When the app goes away

Taken. What the server learns from a mint, and what the space shows in the follow control's line and the plan's status bar:

| What happened | How the server learns it | What it does | What the owner reads |
|---|---|---|---|
| The app was uninstalled, or the repository taken out of it | the mint answers 404, or 422 for the repository | `appError` set; writing refused; reads go on without a token if the repository is public, else the pull stops | "The GitHub app is no longer installed on owner/name. Install it again and press Connect to GitHub, or stop following." |
| The installation was suspended (by the repository's owner or by the app's owner) | the mint answers 403 naming suspension (`suspended_at` on `GET /app/installations/{id}`) | as above | "The GitHub app is paused for owner/name on GitHub." |
| The repository was renamed or moved | the mint's answer names it differently; a write answers 301 | `repo` updated from the mint; a write that met a 301 is retried once after a fresh mint | "Following new-owner/new-name." (the line just shows the new name) |
| The app's key or client secret is wrong or revoked | the JWT is refused (401 on `GET /app` or a mint) | the app counts as off on the whole server; Service terms says so; every linked space reads as public, writes refused | "The GitHub app on this server is not working. The administrator checks its settings." |

A reinstall makes a new installation id, so the owner links again (one **Connect to GitHub**); the server does not relink by itself. Stopping following, or moving to another repository, drops `installation`, `repositoryId`, `writeOk` and `write`. Chameleon never uninstalls the app; uninstalling is the repository owner's, on GitHub.

### 10. Who GitHub shows, and what reaches it

- **The author on GitHub** (taken): every label change, close, reopen, title change and new issue shows as the app, `<app-slug>[bot]`, with the app's mark, never as a person. Chameleon keeps its own record of who did it (`by` on the work, the agent's review list), as today.
- **No author in the issue text** (taken): a new issue's body stays empty, as the two-way plan's section 13 says; neither the member's name nor the space's or environment's name is written into GitHub. Adding "Opened from <space> by <name>" would put a member's name and a space's name into a repository that may be public; if wanted later it is an owner's switch, off by default.
- **What reaches GitHub** stays the two-way plan's section 13 for issue calls. The link flow adds only: the client ID, a random `state`, a PKCE challenge and verifier, the link address and the one-time code, to `github.com`; the JWT and the repository id to `api.github.com`. Never a member's name, the space's or environment's name, or anything of the plan.
- **A private repository** (taken): the app can read one, which the token-less pull could not. Following it shows, beside **Follow** in the list and in the follow control: "This repository is private. Everyone who can see this plan will see its issue titles and labels." The owner chooses.

### 11. Webhooks

Skipped (taken), as in the pull and two-way plans: they need an address GitHub can reach, which many self-hosted servers lack, and a relay service is out (paid or insecure). The app is registered with webhooks off; the 10-minute pull and **Pull now** stay. If Thomas later wants them on his own server, they are an addition (an `issues` event pulling one issue at once), not a change to this plan.

### 12. Inside Chameleon: who may do what

Taken, all as built unless said:

- **Link, relink and stop following**: the environment's owner only; never a moderator, member, guest or agent.
- **Turn writing on**: the owner, only when `via` is `"app"` and `writeOk` (section 3).
- **Write through**: anyone with `write_out` in the space, owners always; agents with `write_out` and the action allowed in their gate. Their writes go as the app.
- **Pull now**: anyone with Projects' `edit`, as today.
- **The administrator** accepts GitHub's terms under Service terms (as today) and sets up the app; sees on Service terms whether the app works and its name, never a key.

### 13. Agents

Taken. Nothing new for agents: they read and write through as built, now as the app. The refusals they can meet change two sentences: "No token is set on this server." becomes "Connect this repository through the GitHub app to change it from here." (409), and "This server may not change GitHub for this repository." becomes "The GitHub app may not change this repository." (403, when `writeOk` is false or the installation lacks Issues write). An agent cannot connect a repository.

### 14. The follow control

Today's box, button and switch are replaced (core, `public/module-settings.js`). Thomas found the earlier flow unclear, so the control shows one thing to do at a time. Taken:

- **Not following, the app set up**: one line, "Follow a GitHub repository: its issues become this plan.", and **Connect to GitHub** (primary). After it, the list of section 6 with **Follow** on each row, the install line, and a quieter line at the end: "Or follow any public repository read only, with no app:" with the `owner/name` box and **Follow read only**.
- **Not following, no app on the server**: the box and **Follow read only**, with "This server has no GitHub app, so it can follow public repositories read only."
- **Following through the app**: "Following owner/name, last pulled 14:20." **Stop following**. Under it the switch **Changes here go to GitHub**, enabled when `writeOk`, and its line "Moves, closes, titles and tags made here change the issues on GitHub. GitHub shows them as <app-slug>[bot]." or, without write access, "You can read this repository on GitHub but not change it, so changes stay read only here." Any `appError` in the line, as an error.
- **Following read only**: "Following owner/name read only, last pulled 14:20." **Connect to GitHub** (to link it through the app and allow changes) and **Stop following**.
- Every button acts at once, outside **Save**, and the server's record is the truth, as built. A refusal is the server's sentence in the line.

### 15. Service terms

Taken. Under GitHub in the **Service terms** section (`public/service-terms.js`, the administrator's): one line, "GitHub app: <name>, working." or "GitHub app: not set up. Spaces can follow public repositories read only." or the failing sentence of section 9, and the two addresses to enter on GitHub when registering (the callback and setup URL, the same address). Never the key, the secret or a token.

## The contract

### Server (server-development)

- **`server/issue-app.js`** (new, core): reads the three variables at start; loads the key into a `crypto` key object; signs a JWT; `GET /app` once (name, slug); mints and caches installation tokens by installation and repository id; the link records (state, PKCE verifier, environment, space, person, list, end) in memory with their 15 minutes; the code exchange, the installation and repository lists and the revoke. Every call through the core's `getter`, now allowed two origins for the GitHub adapter: `https://api.github.com` and, for the code exchange only, `https://github.com`; 6 seconds, 2 MB, no redirect for a POST.
- **The adapter** (`github.js`, `issue-providers/index.js`): `tokenEnv` and `ISSUES_GITHUB_TOKEN` removed; the adapter takes the token per call from the core as now (`token` argument), so `list`, `get` and the writes are unchanged; new members for the app's calls (`appInfo`, `mintToken`, `exchangeCode`, `userInstallations`, `userRepositories`, `revokeUserToken`), each answering `{ status, ... }` as the writes do; `webOrigin` (`https://github.com`) for the authorize and install addresses and the exchange.
- **The stand-in** (`test-standin.js`, only under `ISSUES_TEST_STANDIN`) serves the app endpoints on its fake origin(s): `GET /app`, `POST /app/installations/{id}/access_tokens` (checking the JWT against a public key the check made at run time; answering 404, 403 suspended, 422, a renamed repository), `POST /login/oauth/access_token` (checking the client secret and the PKCE verifier), `GET /user/installations`, `GET /user/installations/{id}/repositories`, `DELETE /applications/{client_id}/token`, and a 301 on a write. It records every request, the `Authorization` header masked. The check's key pair is made with `crypto.generateKeyPairSync` at run time and never written to the repository.
- **The record** (`issues.js`, `cleanRecord`): `via`, `installation`, `repositoryId`, `writeOk`, `linkBy`, `linkAt`, `appError` (section 8). `writeListOf`, `writeAllowed`, `SAY.noToken` removed; the sentences of sections 9 and 13 added.
- **Routes**:
  - `POST /api/spaces/:id/issues-link` (the environment's owner, not an agent): `{ url }`, GitHub's authorize address. 409 "This server has no GitHub app." when it is off; 409 with today's terms sentence when GitHub's terms are not accepted; 403 for anyone else.
  - `GET /api/issues-link/back?code&state` and `?state&installation_id&setup_action` (no session needed; on the product host on a server with environments): as section 6, steps 3 and 5; a 302 to the environment's own address, never to an address from the query. An unknown or ended `state`: a plain page with the sentence and a link to the environment's home.
  - `GET /api/spaces/:id/issues-link?link=<id>` (the same person who started it, the same environment and space, inside 15 minutes; else 404): `{ repositories: [{ repositoryId, repo, private, installation, canWrite }], more, installUrl }`. `canWrite` is the person's GitHub write access; nothing else of their GitHub account.
  - `PUT /api/spaces/:id/issues-pull`: `{ on: true, link, repositoryId }` follows through the app (400 for a repository not in that link's list; 404 for an ended link); `{ on: true, repo }` follows a public repository read only, as today; `{ write: true }` only with `via: "app"` and `writeOk` (403 "The GitHub app may not change this repository."); `{ on: false }` as today, also dropping the app fields.
  - `GET /api/spaces/:id/issues-pull` gains `via`, `app` (`{ name, slug }` or null: whether the server has a working app), `private`, `writeOk` and `appError`; `canWrite` becomes `via === "app" && writeOk`. Never a token or an id of the person's GitHub account.
  - The write-through, `POST /api/spaces/:id/issues` and the agent runner: unchanged, except that the token is the installation's (section 4) and the refusals' sentences (section 13).
  - Service terms' answer gains the app's state for the administrator (section 15).
- **What leaves the server**: the two-way plan's section 13, plus section 10's link calls. Held by `tools/check-issues.mjs`.

### Pages (experience-design)

- **The follow control** (`control` and `wireFollows` in `public/module-settings.js`, core): the states of section 14; **Connect to GitHub** goes to the address the server answers; on return the page finds the link id, asks for the list and draws it (a list of rows with the repository's name, **Private**, **Follow**; the install line and its address; the read-only box last). Phone: the rows stack, one button a row. The words of sections 6, 9, 10 and 14.
- **Service terms** (`public/service-terms.js`, core): the app line and the two addresses (section 15).
- **Planner - Projects**: no module change beyond the status bar showing `appError` the way it shows `error` today; if that needs the module's code, a patch bump.

## Left to build, in order

Each a try build that leaves `main` green, unless Thomas names another kind. Steps 1 to 3 are core and security-relevant (a key that can write to other people's repositories).

1. **The app's credentials and installation tokens** (server-development, core, medium). `server/issue-app.js` without the link flow: the variables, the key, the JWT, `GET /app`, the mint and its cache, the record's new fields, reads and writes with the installation token for a space whose record has `via: "app"`, section 9's handling, the shared rest; `ISSUES_GITHUB_TOKEN`, `ISSUES_GITHUB_WRITE`, `tokenEnv`, `writeAllowed` and `tools/issues-to-plan.mjs` with its check removed (if For Thomas 3 is (a)); the stand-in's app endpoints; `tools/check-issues.mjs` extended. The check writes a linked record into `issues.json` before the server starts, since the link routes come in step 2.
2. **The link flow** (server-development, core, medium). The link records, `POST` and `GET /api/spaces/:id/issues-link`, `GET /api/issues-link/back` (and `PRODUCT_HOST_PATHS`), the code exchange with PKCE, the lists, the revoke, `PUT .../issues-pull` with `link` and `repositoryId`, `writeOk`, the Service terms answer.
3. **The follow control and Service terms** (experience-design, core, small to medium). Section 14 and section 15.
4. **Thomas sets up his server** (no build). Register the app (the checklist in section 5), generate the key and the client secret, set the three variables, restart, check Service terms says the app works, install the app on `Drowbe/coffee-pub-chameleon`, press **Connect to GitHub** in Bug Squash, follow the repository, turn **Changes here go to GitHub** on, and remove `ISSUES_GITHUB_TOKEN` and `ISSUES_GITHUB_WRITE` from the server and revoke the fine-grained token on GitHub.
5. **Documentation** (content-manager): the setup checklist, the environment variables, the user guide's follow section, the API pages for the routes; [plan-github-two-way](plan-github-two-way.md) and [plan-github-pull](plan-github-pull.md) status lines.

The two-way plan's own steps (3, the board sync's schedule; 6 to 9, the roadmap fields, the import and removing the board) do not wait on this plan, except that Thomas turns writing on for Bug Squash through the app (step 4 here) rather than the token.

## Verify

- **Step 1**, checked by a tool (`node tools/check-issues.mjs`, against the stand-in; also `node tools/check-route-table.mjs`): a JWT signed with the run's key is accepted and one with another key refused; a mint is narrowed to the one repository and the issues and metadata permissions; a second call within the hour reuses the token (one mint seen), a call 5 minutes before expiry mints again, a 401 drops it; reads and writes of a linked space carry the installation token and an unlinked public space none; 404 and 422 on a mint set `appError` and refuse writes while a public repository still reads; 403 suspended gives its sentence; a renamed repository's new name is stored from the mint and a write that met a 301 is retried once; a 403 or 429 rests every space on that repository in every environment; neither the key, the client secret, a JWT nor a token appears in any answer, log line, `issues.json` or recorded request body; nothing reads `ISSUES_GITHUB_TOKEN` or `ISSUES_GITHUB_WRITE` (a search of `server/` and `tools/`); the key read from a file and from the variable; both set, or an unreadable key, leave the app off with one line.
- **Step 2**, checked by a tool (the same check): the authorize address carries the client ID, a fresh `state`, an S256 challenge and the link address; the exchange sends the verifier and the secret; an unknown, ended or reused `state` is refused; the list goes only to the person who started the link, in that environment and space, within 15 minutes; the user token is revoked before the list is answered and is never stored; a repository not in the list cannot be followed whatever the page sends; a forged `installation_id` on the setup URL changes nothing; `writeOk` follows the person's permission and `write: true` is refused without it; on a host with environments the link address answers on the product host and sends the person back only to their environment's own address; an agent and a moderator are refused.
- **Step 3**: live on a local server in headless Chromium at 1280 and 390, light and dark, fed by the stand-in: each state of section 14, a link that returns with a list, the install line, a refusal's sentence; Service terms' line.
- **Not checked here.** No GitHub App can be registered or installed from this session, and no request may be made to GitHub from this work's sessions: the stand-in serving the app endpoints is the test seam. Only on Thomas's server, after step 4: GitHub's real authorize page and its return, whether the install address's `state` comes back, the real mint and its narrowed permissions, a change on GitHub showing as `<app-slug>[bot]`, a suspended or uninstalled app's real answers, a renamed repository, and the installation's real rate limit. The board inside a call is not checkable here (no LiveKit server locally).
- **Only Thomas can**: register the app on GitHub, generate its private key and client secret, set `ISSUES_GITHUB_APP_CLIENT_ID`, `ISSUES_GITHUB_APP_CLIENT_SECRET` and `ISSUES_GITHUB_APP_KEY_FILE` (or `ISSUES_GITHUB_APP_KEY`) on his server, install the app on his repository, and revoke the old token.

## For Thomas

Three foundational choices, each with the planner's lean. Everything else is taken on a lean and marked; any of it may be overturned.

1. **A GitHub sign-in while linking** (section 2). Each owner authorizes the app once on GitHub (a click, nothing pasted) so the server can see which installations they really reach; the user token is used for seconds and revoked. It needs the app's client secret on the server as well as the key. Without it, any owner on a server could link any repository the app is installed on. Lean: yes.
2. **Writing needs the linking person's own write access on GitHub** (section 3), so a GitHub reader cannot write to issues through the app. Lean: yes.
3. **Remove `ISSUES_GITHUB_TOKEN` and `ISSUES_GITHUB_WRITE`** (section 7): public repositories with no app are read without a token (about ten such spaces a server at the 60-an-hour limit); everything else goes through the app; Bug Squash keeps pulling and is relinked through the app for writing. Or keep the token for reading public repositories only. Lean: remove both.

## Open questions

None block step 1 if For Thomas 3 is answered; For Thomas 1 and 2 block step 2.

- Whether the install address's `state` comes back on the setup URL (recalled as yes; without it, the setup URL starts a fresh link, which costs the person one more press of **Connect to GitHub**). Checked by server-development on GitHub's page before step 2.
- Which API version to send: today's `2022-11-28`, or `2026-03-10` as GitHub's pages now show. server-development reads GitHub's versioning page before step 1; not changed unasked.
- Whether a host should ever keep some environments from using the app. Lean: not now (section 5).
