# Settings Reference

**Audience:** the person running the server, who wants to change a setting that is not in `docker-compose.yml`.

The compose file holds only the settings most servers must set. Everything here is optional: add a line under the
app's `environment:` (the `chameleon` service), recreate the container, and it takes effect. A setting left out uses
its default. The default is what the code uses today, checked against the server's source. To set up the server
first, see [Getting Started](userguide-getting-started.md). Put no real password or key in any file you share.

A number that is missing, not a number, or zero or less uses the default. Settings marked "in the file" are already in
the compose file.

## Environments and domains

| Setting | Default | What it does |
|---|---|---|
| `BASE_DOMAIN` | unset (one environment) | Several environments on one server, at `<slug>.<base domain>`. A commented example in the file. See [Getting Started](userguide-getting-started.md), "Environments: one server, several groups". |
| `PRODUCT_DOMAIN` | unset | Puts the start page and sign-up on a host of their own, so their name can change without touching any environment's address. A host name only: no `https://`, no port. It needs its own DNS record, an ordinary certificate and a proxy host to port 3000; the base domain keeps the wildcard. The console stays at `admin.<base domain>`. Ignored without `BASE_DOMAIN`. A commented example in the file. |
| `PRODUCT_SITE_URL` | unset; for example `https://www.example.com/chameleon` | The address of the product's page on your website. When it is set, the start page shows the studio's parts (the header's **Support** and **Find Out More**, **Request an Invite**, the **Ways to use** cards and the footer); every link is built from this address's origin. A full `http://` or `https://` address. Unset means no link. A value that is not a web address stops the start with one line naming it. Only for a server with `BASE_DOMAIN`. A commented example in the file. |
| `MIGRATE_ENVIRONMENT_SLUG` | unset | For one start only: the environment that the data already here becomes, when you turn a single-environment install into several. Remove it afterwards. |
| `PREVIOUS_BASE_DOMAINS` | empty | Old base domains whose links redirect to the new one while you move a server's addresses ("Moving a server's addresses" in the guide). |
| `RESERVED_SLUGS` | empty; for example `studio,shop` | Names no new environment may take, on top of the built-in list (`www`, `api`, `admin`, `mail`, `livekit` and others). Comma separated. An environment that already has one keeps working. |
| `TEMPLATE` | unset; for example `travel` | One environment set up for one use, from a template in `templates/`: its words, icons, modules and Lobby (unset, the environment uses the **Default** template). Only on a fresh data folder, and only without `BASE_DOMAIN` (with it, the host console and sign-up pick a template for each new environment). Ignored, with a line in the log, on data that already exists. |
| `SIGNUP` | off | `on` turns on the server's sign-up route for a free environment. The start page has no sign-up form now, so nothing a person sees uses it yet. Needs `BASE_DOMAIN`. |
| `CONTACT_EMAIL` | unset | Where the sign-up answer sends someone to write when sign-up is off. A commented example in the file. |

## AI

Keys, providers and models are not set here. A host's keys are set on the host console's **AI** tab, and a single server's AI on the AI configuration page, so there is nothing to put in the file. The old variables (`AI_OPENAI_KEY`, `AI_ANTHROPIC_KEY`, `AI_ANTHROPIC_WORKSPACE`, `AI_KEY`, `TAVERN_AI_KEY`, `AI_PROVIDER`, `AI_ADDRESS` and `AI_MODEL`) are removed; if still set, they are ignored.

| Setting | Default | What it does |
|---|---|---|
| `AI_ALLOW_HTTP` | unset | With `BASE_DOMAIN`, the AI address an environment's owner types must be https and never a private, loopback or link-local address. `1` allows plain http. For a developer running the host on one machine only. |
| `AI_ALLOW_PRIVATE_ADDRESSES` | unset | The same guard: `1` allows private addresses. For a developer running the host on one machine only. |

## Sign-in and limits

| Setting | Default | What it does |
|---|---|---|
| `ENABLE_MFA` | `true` (in the file) | Whether the server offers two-step sign-in (a code from an authenticator app). Each environment's owner then chooses whether to require it, and each person chooses whether to use it. |
| `ADMIN_MFA_LOCKOUT_BYPASS` | `false` (in the file) | If an owner or admin is locked out: set `true`, recreate, sign in, reset the factor on the profile, then set it back to `false`. |
| `HOST_MFA_REQUIRED` | `false` | With environments: `true` makes two-step sign-in mandatory for every host admin. |
| `TRUST_PROXY_HOPS` | `1` | How many reverse proxies stand in front of the container (`1` is the Nginx Proxy Manager). Sign-in and guest limits count by the address the nearest proxy saw, so nobody can pick their own. Two in a row (say Cloudflare, then Nginx Proxy Manager): `2`. Reached directly with no proxy: `0`. A value that is not a whole number logs a line and uses `1`. |
| `REQUEST_BODY_SECONDS` | `300` | How long the body of any other request may take to arrive. Vault uploads are exempt. |
| `CLEAR_UNDO_SECONDS` | `30` | How long a Clear can be undone. A whole number from 1 to 600. |
| `PORT` | `3000` (in the file) | The port the app listens on. |

## Chat and streams

The defaults are usually right. A live stream is one per open browser tab: it carries who is here and the chat.

| Setting | Default | What it does |
|---|---|---|
| `LIVE_STREAMS_PER_PERSON` | `50` | Streams one signed-in person may hold open. |
| `LIVE_STREAMS_PER_GUEST_LINK` | `25` | Streams one guest link may hold open. One address gets 40% of it. |
| `GUEST_CHAT_POSTS_PER_MINUTE` | `20` | Messages one guest link may post a minute. One address gets half. |
| `CHAT_PICTURE_MAX_MB` | `3` | The most a picture in the chat may weigh. It is held in memory and never stored. |
| `CHAT_PICTURE_KEEP_MINUTES` | `15` | How long a chat picture is held for its readers to fetch. |
| `CHAT_PICTURE_SPACE_MB` | `30` | MB of chat pictures held per space. Past it, the oldest go. |
| `CHAT_PICTURE_ENVIRONMENT_MB` | `100` | The same, per environment. |
| `CHAT_PICTURE_SERVER_MB` | `200` | The same, for the whole server. |
| `CHAT_PICTURE_MB_PER_MINUTE` | `20` | MB of pictures one person, or one guest link, may send a minute. |
| `LIVE_STREAM_BUFFER_MB` | `8` | How far a reader may fall behind before its stream is dropped. It reconnects. |
| `PRESENCE_CHANGES_PER_MINUTE` | `60` | Times a minute one person may switch away, or onto the call, in a space. |
| `MAP_IMAGE_MAX_MB` | `100` | The most a picture-map file (an invented world, as PMTiles picture tiles) may weigh. |

Each held total is never below one picture of the largest size.

## Vault

The Vault's files live in their own folder, not in the data folder, so the in-app backups stay small. Back that
folder up with the data folder: a restore of the data without it shows those files as "File missing". These limits are
the server's defaults; an owner may set lower ones. See [Vault](userguide-vault.md).

| Setting | Default | What it does |
|---|---|---|
| `VAULT_DIR` | `/app/vault` (in the file, with its own volume line) | The folder that holds the Vault's files. Without it the files go in a `vault` folder inside the data folder. |
| `VAULT_MAX_GB` | `20` | The most the whole folder may hold. |
| `VAULT_SPACE_MAX_GB` | `5` | The most one space may hold. |
| `VAULT_PERSON_MAX_GB` | `2` | The most one person may have added across an environment. |
| `VAULT_MB_PER_MINUTE` | `500` | MB one person may send a minute. |
| `VAULT_MIN_KB_PER_SECOND` | `16` | The slowest an upload may arrive, after its first minute. |
| `VAULT_SLOW_CUTOFFS` | `3` | How many slow cut-offs, within `VAULT_SLOW_MINUTES`, make a person's new uploads wait. |
| `VAULT_SLOW_MINUTES` | `10` | The window for the count above. |
| `VAULT_SCAN_SECONDS` | `5` | The most the check of one file may take. |
| `VAULT_SWEEP_SECONDS` | `10` | The most the tidy-up on start may take (bytes with no record, leftovers). |

## Agreements, guests and entering

These settings are the server's, not an environment's. A value that is not a whole number above zero uses the default. How it works is in [Access architecture](../architecture/architecture-access.md).

| Setting | Default | What it does |
|---|---|---|
| `TERMS_FILE` | unset | The path of a text file (plain or Markdown, UTF-8, at most 256 KB) with the terms of service. Everyone, in every environment, must agree to it before entering, once for each version of the text. Changing the file asks everyone again. A file that is missing, empty or too big, or a setting left blank, stops the server from starting. A commented example is in the file. |
| `NDA_FILE` | unset | The same for a beta NDA. With neither file set, nobody is asked. |
| `ENABLE_GUEST_DOOR` | `false` | On a single-environment install, whether the guest door is offered. Owners then open individual spaces to guests (**Visiting guests** in a space's Set up); there is no owner switch for the door. On a server with environments this is the host console's checkbox for each environment. |
| `GUEST_SESSION_HOURS` | `24` | How long a guest from the door stays in. |
| `GUEST_DOOR_PER_ADDRESS` | `5` | New guest sessions one address may open in 15 minutes. |
| `GUESTS_PER_SPACE` | `10` | Guests from the door who may be in one space at once. |
| `GUESTS_PER_ENVIRONMENT` | `50` | Guests from the door who may be in one environment at once. |
| `ACCESS_REQUESTS_PER_DAY` | `5` | Requests to enter a space that one person may make in 24 hours. |
| `ACCESS_REQUESTS_PER_ADDRESS` | `20` | Requests that one address may make in 24 hours. |
| `ACCESS_REQUESTS_PENDING_PER_SPACE` | `50` | People with an account who may be waiting to enter one space. |
| `ACCESS_REQUESTS_PENDING_GUESTS_PER_SPACE` | `20` | Guests who may be waiting to enter one space, counted apart. |
| `ACCESS_REQUEST_DAYS` | `7` | How long a request waits before it ends. |

## Agents

An agent is an account for an assistant such as Claude, with a token instead of a password ([Agents](userguide-agents.md)). It is off on every server until you turn it on here.

| Setting | Default | What it does |
|---|---|---|
| `AGENT_TOKENS` | unset (off); a commented line in the file | `true` lets each environment's owner turn on **Agents** in Manage, then make agents and tokens. Anything else is off: no agent can be made, and a token already made answers as an unknown value. A value that is neither `true` nor `false` is off and logs a warning. Changing it needs the container recreated. |

## Modules that act for agents

Modules that come with Chameleon carry out an agent's requests in a process with no network. For a module you uploaded, that happens only behind a kernel network wall and after the admin approves it ([Getting Started](userguide-getting-started.md), "Let uploaded modules act for agents (optional)").

| Setting | Default | What it does |
|---|---|---|
| `ACTION_RUNNER_NETWORK` | unset; `namespace` in `docker-compose.yml` | `namespace` lets an uploaded module's actions run, and only inside a network namespace the server made when it started. Bundled modules use a namespace where there is one and the process's lockdown alone where there is not, whatever the value. Unset or `auto`: an uploaded module's actions never run. The start-up log says which of the three cases holds. |

Beside it in the file, a commented `security_opt` line names the seccomp profile `deploy/seccomp-action-runner.json` that lets a Docker container make that namespace. The image installs `util-linux-misc` for `unshare`. Do not mount `docker.sock` into the container.

## Following a GitHub repository

A space can follow a GitHub repository's issues in Planner - Projects ([Planner - Projects](userguide-planner-projects.md), "Follow a GitHub repository"), and can change them on GitHub ("Turn on writing to GitHub"). The server connects through one GitHub App that you register once (below). Reading a public repository with no app needs nothing here: the owner can follow it read only, and GitHub allows 60 such requests an hour for the whole server.

| Setting | Default | What it does |
|---|---|---|
| `ISSUES_GITHUB_APP_CLIENT_ID` | unset | The app's client ID, from its page on GitHub. It is not a secret. |
| `ISSUES_GITHUB_APP_CLIENT_SECRET` | unset | The app's client secret. The server uses it only to finish an owner's sign-in while connecting a repository, and to let that sign-in go again. Without it the app is off. |
| `ISSUES_GITHUB_APP_KEY_FILE` | unset | The path, inside the container, of the app's private key (the `.pem` file GitHub gives). Use this one: a key runs over several lines. Set exactly one of this and `ISSUES_GITHUB_APP_KEY`. |
| `ISSUES_GITHUB_APP_KEY` | unset | The key's text itself, with `\n` for each line break. Only if you cannot mount a file. Exactly one of the two. |

All four are read once, at start, so changing one needs the container recreated. None is in `docker-compose.yml`; add them under `environment:`. They are the host's: on a server with several environments one app serves every environment. The key and the secret are never written to a log, a page, a space's data or an answer, and the key is not kept as text after it is read.

With none of the four set, the app is off, nothing is logged, and **Service terms** says "GitHub app: not set up." With some set, the start-up log says what is wrong, and the app stays off:

| Log line | Why |
|---|---|
| `The GitHub app needs ISSUES_GITHUB_APP_CLIENT_ID, ISSUES_GITHUB_APP_CLIENT_SECRET and one of ISSUES_GITHUB_APP_KEY_FILE or ISSUES_GITHUB_APP_KEY. The GitHub app is off.` | At least one is set but the client ID, the secret or a key is missing. |
| `Set only one of ISSUES_GITHUB_APP_KEY_FILE and ISSUES_GITHUB_APP_KEY. The GitHub app is off.` | Both key variables are set. |
| `The GitHub app's private key could not be read. The GitHub app is off.` | The file is missing or not readable, or the text is not an RSA private key. Nothing of it is logged. |

A value that is set and complete but wrong shows later. If GitHub refuses the key (a wrong client ID, or a key that was deleted), **Service terms** says "GitHub app: not working. Check its settings on the server.", spaces linked through the app are read as public repositories with no changes sent, and an owner pressing **Connect to GitHub** reads "The GitHub app on this server is not working. The administrator checks its settings." The server asks GitHub again after 5 minutes. A wrong client secret is seen only when someone connects a repository: GitHub does not finish the sign-in and the owner reads "GitHub did not finish connecting. Go back and press Connect to GitHub again."

A space's own switch, **Changes here go to GitHub**, is the owner's and is off to start. It can be turned on only for a repository connected through the app by someone who could change it on GitHub.

### Register the GitHub app

You do this once per server, on GitHub, as the person who will own the app. It costs nothing. An app is never shared between servers: each server registers its own. The steps assume you have never opened GitHub's developer settings. The labels in the form's **Identifying and authorizing users**, **Post installation** and **Webhook** sections were confirmed against a live GitHub session on 2026-11-27. The rest were written from memory of GitHub's pages and were not checked: the **Permissions** section, the **Where can this GitHub App be installed?** choice, and the **Install App**, key and secret buttons. If a label on your screen differs, report it so this page can be corrected.

#### One app per server, one connection per space

The server has one GitHub app. Its identity (client ID, client secret and private key) lives in the compose file, set once by the administrator, and nobody else ever sees it. A self-hosted server registers one app. A host with environments registers one app for the whole host, and its Redirect URI and Setup URL are the one address on the product host, the same for every environment.

A space stores only which installation and which repository it follows, never a secret. So space A can follow a repository in one GitHub account and space B a repository in another, all through the same app.

When an owner of a space wants to follow a repository, they do this themselves:

1. Open **Set up**, then **Modules**, then **Follows GitHub**, and choose **Connect to GitHub**.
2. Sign in to GitHub as themselves. GitHub asks them once to authorize the app.
3. If the app is not yet installed on the account or organization that holds the repository, install it there on GitHub. The owner needs the right to install apps in that account or organization.
4. Back in Chameleon, pick the repository and choose **Follow**.

For this to work, other people must be able to install your app. Register it for **Any account** (step 7 of part 2).

There are six parts: get the address from Chameleon, register the app, collect three values, give them to Chameleon, install the app on a repository, and connect a space.

#### 1. Get the address from Chameleon

1. Sign in to Chameleon as the administrator.
2. Open **Manage**, then **Modules**, and find **Service terms**. On a server with several environments, use the host console's **Server** page instead.
3. Find the line "On GitHub, enter this address as both the Redirect URI and the Setup URL:". Under it is one address: `<your server's address>/api/issues-link/back`, or `https://<the product host>/api/issues-link/back` on a host with environments.
4. Choose **Copy**. Keep this address on your clipboard, or come back to it: you paste it twice in part 2, once as GitHub's **Redirect URI** and once as its **Setup URL**. It is the same for every environment, because GitHub matches it exactly.

#### 2. Register the app on GitHub

The app is made in your account's own settings, not in a repository's settings. A repository's **Settings**, then **Integrations**, then **GitHub Apps** page only lists apps already installed on that repository and has no button to add one. If that is where you are, you are in the wrong place. To go straight to the right page, open `https://github.com/settings/apps/new`. For an organization, open `https://github.com/organizations/<organization>/settings/apps/new` instead, with the organization's name in place of `<organization>`.

To reach it by clicking:

1. Sign in to GitHub. Choose your profile picture at the top right.
2. Choose **Settings** in the menu that opens. This is your account's settings, not a repository's.
3. In the left sidebar, scroll to the bottom and choose **Developer settings**.
4. In the left sidebar, choose **GitHub Apps**.
5. Choose **New GitHub App**.

Fill in the form:

1. **GitHub App name**: a name that no one else on GitHub has used. This is the name people see. Every change made from Chameleon shows on GitHub as the app's short name followed by `[bot]` (for an app whose address is `github.com/apps/chameleon-example`, the author is `chameleon-example[bot]`), with the app's picture. At most 34 characters.
2. **Homepage URL**: your Chameleon address.
3. Section **Identifying and authorizing users**:
   - **Redirect URI**: choose **Add redirect URI** if no row is showing, and paste the address you copied in part 1. GitHub takes up to 10; use only this one. Leave **Allow wildcard matching** unticked. If an empty second row appears, ignore it or choose **Delete** beside it.
   - **Expire user authorization tokens**: leave it ticked.
   - **Request user authorization (OAuth) during installation**: leave it unticked. Ticking it takes away the **Setup URL**.
   - **Enable Device Flow**: leave it unticked.
4. Section **Post installation**:
   - **Setup URL (optional)**: paste the same address again, the one you used as the **Redirect URI**.
   - **Redirect on update**: leave it unticked.
5. Section **Webhook**: untick **Active**. Leave **Webhook URL** and **Secret** empty. Chameleon does not use webhooks. It pulls every 10 minutes, and **Pull now** is there for sooner.
6. **Permissions**: open **Repository permissions**. Set **Issues** to **Read and write**. **Metadata** is **Read-only**, which GitHub sets for you. Leave everything else at **No access**, including every account and organization permission. Asking for more later makes every installer approve it again.
7. **Where can this GitHub App be installed?**: choose **Any account**. Choose it on every server where anyone other than the app's owner will connect a repository, which is the purpose of the app: each space's owner connects their own repository, in their own GitHub account or organization. With **Only on this account**, nobody but the app's owner can install the app, so no one else can connect. Choose **Only on this account** only on a server where every connected repository belongs to the app's owner. Either way an owner is offered only the repositories the app is installed on that they can reach on GitHub themselves.

   If you registered the app as private, open its page on GitHub (your profile picture, **Settings**, **Developer settings**, **GitHub Apps**, **Edit**), scroll to the bottom and, under the danger zone, choose **Make public**. This label is written from memory and was not confirmed on GitHub; if you do not find it, look for the same choice by another name.
8. Choose **Create GitHub App**.

#### 3. Collect the three values

GitHub now shows the app's page. To reach it again later, go to your profile picture, **Settings**, **Developer settings**, **GitHub Apps**, and choose **Edit** beside the app.

1. **Client ID**: near the top of the page, under **About**. It starts with `Iv`. Do not use the **App ID**, which is a plain number.
2. **Client secret**: under **Client secrets**, choose **Generate a new client secret**. GitHub shows it once. Copy it at once and keep it somewhere private.
3. **Private key**: under **Private keys**, choose **Generate a private key**. A `.pem` file downloads to your computer.

Never type a key or secret into a chat, an issue, a document or a command you will share.

#### 4. Give the three values to Chameleon

1. Put the `.pem` file on the server, outside the project folder, so it can never be committed or shared.
2. In the compose file, mount it read-only and set the three variables under the `chameleon` service. The values below are placeholders:

   ```yaml
   services:
     chameleon:
       volumes:
         - /path/on/your/server/chameleon-app.pem:/run/secrets/github-app.pem:ro
       environment:
         ISSUES_GITHUB_APP_CLIENT_ID: "Iv_PLACEHOLDER_CLIENT_ID"
         ISSUES_GITHUB_APP_CLIENT_SECRET: "PLACEHOLDER_CLIENT_SECRET"
         ISSUES_GITHUB_APP_KEY_FILE: "/run/secrets/github-app.pem"
   ```

3. Recreate the container so it reads them. The start-up log should show none of the lines in the table above ("The GitHub app needs ...", "Set only one of ...", "The GitHub app's private key could not be read ...").
4. Open **Manage**, then **Modules**, then **Service terms**. The GitHub line reads "GitHub app: <name>, working." once the server has asked GitHub about the app, or "GitHub app: set up, not checked yet." before that. If it reads anything else, see "If something goes wrong".
5. Under **Service terms**, accept GitHub's terms if you have not.

#### 5. Install the app on a repository

The repository's owner, or an administrator of its organization, does this. The app can be installed on a repository without Chameleon knowing.

1. Open the app's page (see part 3).
2. In the left sidebar, choose **Install App**.
3. Choose **Install** next to the account that owns the repository.
4. Choose **Only select repositories**.
5. Pick the repository from the list.
6. Choose **Install**.

Once installed, the app appears in the repository's **Settings**, then **Integrations**, then **GitHub Apps** list. That is where to check it is there, or to remove it.

#### 6. Connect a space

1. An owner opens the space's **Set up**, then **Modules**, and finds **Follows GitHub** in Planner - Projects' section.
2. Choose **Connect to GitHub**. GitHub opens in the same tab. Sign in if asked; this happens once, and later it sends you straight back.
3. Back in **Set up**, a list shows the repositories the app is installed on that you can reach. Choose **Follow** next to the repository.

The space must have an empty plan, or one that holds only this repository's own pulled work. If not, the page says "Clear the plan first (in Planner - Projects, Export and import, then Clear), or use a new space." (with the space word of your environment). Clear the plan or make a new space, then choose **Follow** again. More on this step is in [Planner - Projects](userguide-planner-projects.md), "Follow a GitHub repository".

#### If something goes wrong

| What you see | Who sees it | What to do |
|---|---|---|
| "GitHub app: not set up." or "This server has no GitHub app." | Administrator, owner | Do parts 3 and 4. The owner asks the administrator. |
| "GitHub app: not working. Check its settings on the server." or "The GitHub app on this server is not working. The administrator checks its settings." | Administrator, owner | Check the client ID is the one starting with `Iv`, and that the key is the app's current one (a deleted key stops working). Fix the variables, recreate the container, and wait 5 minutes for the server to ask GitHub again. |
| "GitHub did not finish connecting. Go back and press Connect to GitHub again." | Owner | Press **Connect to GitHub** again. If it repeats, the administrator checks the client secret: a wrong one is seen only here. |
| "This link has run out. Go back and press Connect to GitHub again." | Owner | Press **Connect to GitHub** again and pick the repository within 15 minutes. |
| "The GitHub app is no longer installed on owner/name. Install it again and press Connect to GitHub, or stop following." | Owner | Install the app on the repository again (part 5), then press **Connect to GitHub**. |
| "The GitHub app is paused for owner/name on GitHub." | Owner, administrator | The repository's owner resumes the app on GitHub, under the app's installation settings. |
| GitHub refuses the sign-in when you press **Connect to GitHub** | Administrator | The **Redirect URI** on the app must be identical to the address on the **Service terms** line, character for character (scheme, host, path, no trailing slash added). Correct it on the app's page on GitHub. |
| "That repository is not in your list. Press Connect to GitHub again." | Owner | Install the app on the repository (part 5) and make sure you can see it on GitHub, then press **Connect to GitHub** again. |
| "You can read this repository on GitHub but not change it, so changes stay read only here." or "The GitHub app may not change this repository." | Owner | Someone who can write to the repository on GitHub connects it, or accept read-only following. |

To rotate the key or the secret, make a new one on the app's page, change the variables and recreate the container.

## Other

`SHARE_UNLOCKS_PER_MINUTE` (default `60`) caps how many share-link password checks an environment does a minute. It is
described in [Getting Started](userguide-getting-started.md), "Environments: one server, several groups".

The About page's studio card is set with `STUDIO_NAME` (default "Coffee Pub Studio"), `STUDIO_LOGO_FILE` and `STUDIO_LOGO_DARK_FILE` (a picture file on the server; with only one, it is used for both), and `STUDIO_URL`, `STUDIO_PRODUCT_URL`, `STUDIO_CONTACT_URL` and `STUDIO_SUPPORT_URL` (web addresses, and `STUDIO_CONTACT_URL` may be a `mailto:` address; an empty link is not shown and one that is not valid is dropped with a warning). They are read once at start.
