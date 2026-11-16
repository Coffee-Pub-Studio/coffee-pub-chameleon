# The demo seeder and the checks

**Audience:** developers and operators who fill a server with demo data, run a demo site that resets itself, or need to know what the checks added since 0.4 look at.

## Adding the demo space from the host console

The host console can add a demo space to any environment (#552, #553, #884; `POST /api/host/environments/:slug/demo`, host admin only; [plan-demo-space](../plans/plan-demo-space.md)). There are five demos, one for each shipped template that has a file in `templates/demo/`: Travel demo, Games demo, Project demo, Learning demo and Mentoring demo. `GET /api/host/demos` (host admin only) lists them as `{ demos: [{ id, label, name, modules }] }`, `id` being the template's id and `label` the plain name a list shows; `modules` are the modules the demo needs that this server ships, `[{ id, name }]` (never Chat, which is always on). With `?environment=<slug>` (404 `no such environment` for an unknown one) each module also has `on`, whether that environment has it on already, a module the environment's plan leaves out is not listed, and `name` is the environment's own display name for it. The body is `{ demo?, modules? }`, or nothing; with nothing the demo is the environment's template's own, or the travel one when that template has no demo, and the answer says so with `fellBack: true`. A demo of another template may be added to an environment of any template: its space is made with that template as its own (a space's own template, [plan-space-templates](../plans/plan-space-templates.md)), so a Games demo in a Travel environment reads as a campaign, and the environment's template is never changed. If the environment does not let a space use its own template (`settings.spaceTemplates` off), the space reads the environment's and the report says so; a module the demo needs and the environment does not have on is skipped and said, unless the host ticked it (below).

The server runs the loader through loopback requests to its own address with the environment's host name, as a stand-in user. The stand-in has the fixed login `host-demo` and the name **Host (demo)**, is an admin of that environment, has no password and is marked as the host's; it is made for the run and taken away again when the load fails, so a refused load leaves none behind. The session is signed with the environment's own secret and lives for that one run. The route changes no environment-wide setting. It answers 400 for a body that is not an object (`Send the demo to add as { "demo": "<name>" }, or nothing for this template's own.`), an empty name (`Name a demo.`) and a demo that does not exist (`There is no demo called <name>.`), and 409 for a suspended environment, one that will not open, a run already going, the same demo already there (`The <label> is already there. Delete its <space word>, then add it again.`; another demo may sit beside it, since a demo is known by its name and marker) and an existing ordinary account called `host-demo`, and for the loader's own refusals below. A request that stalls ends the run after 180 seconds; `DEMO_REQUEST_TIMEOUT_SECONDS` changes that. The answer is the loader's report with `template`, `usedTemplate` and `fellBack`, and the demo people's one-time passwords shown once and never logged or kept. The links the demo writes into chat and its guest link use the environment's own address as people reach it (`publicBase`: the scheme and port of the console's own request), never the loopback the loader's requests go to.

### Turning modules on with the demo, and who is refused

`modules` is a list of module ids (at most 50, each a string; repeats count once), the ones the host ticked in the console's **Turn these on too**. The loader still turns nothing on by itself ([plan-demo-space](../plans/plan-demo-space.md), decision 1 reads as it did; the host's ticking is the exception, and what that decision must now say is for the planner). A ticked module goes on through the console's own path for modules, `templates.turnOnModules`, one environment at a time, and only after every refusal below has passed. The answer carries `turnedOn: [{ id, name }]`, the modules this run turned on (the ticked ones and what they need), and a module that could not be turned on is in `skipped` with the reason, once. A run that stops after modules came on says so in its sentence (`Turned on before it stopped: <names>.`) and the 409 carries `turnedOn`.

The route checks `modules` before anything is made (400): not a list of text ids, `Name the <module word> to turn on as a list of their ids.`; `Chat is always on, so it is not turned on here.`; `The demo does not use "<id>", so it can't be turned on with it.`; `"<id>" does not ship with this server, so it can't be turned on.`; `<name> is not in this <environment word>'s plan, so it can't be turned on.`

The loader then refuses, with 409 and a plain sentence, before any change, in this order: the caller must be an owner or admin; a person with a demo login who is not marked as a demo person, has another name or role than the file's, or has two-step sign-in on; a demo person who **is or was a moderator of a real space**, which is a space that is not a demo space (its description lacks the marker): by the API's own list of the person's spaces, and by the stored moderator tick on any space there is, a member or not, since a tick stays when a person is taken out of a space and counts again if they join it (`The demo person "<login>" is a moderator of "<space>", a real <space word>, so the demo is not loaded. Take away their <moderator word> tick there, or remove the account first.`, or `was a moderator of` when the person is no longer a member); a space with the demo's name that is not marked (the name clash); the plan's member limit (`This <environment word> is at its limit of <n> <member word>, and the demo adds <m>.`), which counts the accounts the demo would make; then the modules are turned on; then the changes. Before the loader runs, the route has already refused a suspended environment, one that will not open, a run in progress, the same demo already there, and a `host-demo` account that is not the stand-in. With none ticked the run is as it was: it turns nothing on.

The console's **Demo space** part has the picker and, under it, **Turn these on too**: the modules the picked demo needs that the environment has off, unticked, with the environment's own names (`GET /api/host/demos?environment=<slug>`, asked again after every answer, so the boxes follow). **Add demo space** sends `{ demo, modules: [the ticked ids] }`, and the report adds "Turned on: <names>." A body with `demo: null` or no `demo` still means the environment's template's own demo. The seeder is unchanged and turns on every module itself, as before. There is no **Remove demo** (#882): to take a demo away, delete its space and, if wanted, its people. Covered by `tools/check-demo-console.mjs`, `check-demo-loader.mjs`, `check-seed-demo.mjs` and, for the offer, the ticked modules and the moderator refusal, `tools/check-demo-offer.mjs`. Read as code on `4fb7b467`; none of these was run for this page.

## The demo loader and the seeder

Two parts make the demo. They are kept apart on purpose.

- **The loader**, `server/demo-loader.js`, fills one marked demo space and its marked demo people from a data file. It is the part the host console's "Add demo space" calls (slice 1 of [plan-demo-space](../plans/plan-demo-space.md), GitHub #416).
- **The seeder**, `npm run seed:demo` (`tools/seed-demo.mjs`), is a thin command over the loader. It first does the environment-wide setup that a throwaway environment needs, then calls the loader.

### What the loader does

`loadDemo({ base, publicBase, templateId, today, session, headers, words, say, dir })` reads `templates/demo/<template id>.json` and writes it through the server's own address, with loopback HTTP requests. Each request is made as a signed-in demo person, so every module's real rules, permissions and validation run. It calls no route function directly.

- **Only the demo.** It acts on one space and the people the file names (Travel: `mia`, a moderator, and `lee` and `sam`; the other four demos have two to four each), all marked as the demo's. It never changes an environment-wide setting on its own: it does not install a module, set the calendar or map options, choose a place search or switch the template, and it turns on a module only when the caller names it (the host's ticks, above).
- **A module that is off is skipped.** The report says so in plain words, for example that the costs were not added because the Budget is off. The module is not turned on unless the host ticked it.
- **It refuses what it did not make.** A space that has the demo's name but not the marker in its description is refused before anything is changed. A demo person is an account the loader made: it carries `demo: true`, set by `POST /api/users` when the loader makes it (any other caller of `PATCH /api/users/:key` that sends `demo` gets 400 `demo can't be changed here`; the mark is kept in an environment's copy and never on a host admin's stand-in). A later load gives a new password only to such an account. An account with a demo person's login that has another display name, was not made by a demo (`demo` not true) or is a host admin, or has another role than the file's, is refused (409) with a sentence saying so and that it is left alone (`An account called "<login>" already exists and was not made by a demo, so it is left alone. Rename or remove it first.`), and so is a demo person with two-step sign-in on (the loader signs in with a password only): both before anything is changed. A writer the file names who is not one of its people stops the load before anything is made.
- **A rerun resets only the demo.** It removes the marked space and the marked people and builds them again. Every other space, its data and every other account are left alone.
- **Passwords are random on every run.** They are returned to the caller, never stored. The seeder prints them once. It never prints the admin password.
- **Words follow the environment.** Its messages use the environment's own words: the `words` option if given, else the words from the target's `/api/branding`, else the plain defaults. On a travel environment a space reads "trip".
- **A template with no demo file** reports "no demo" and creates nothing.
- **A guest link** that cannot be made is listed in `refused` in the report.

### The data file

There is one file for each demo in `templates/demo/<template id>.json`. Each names its `template`, a plain `label` (up to 40 characters, "Travel demo"), the space's `name`, its `description`, an `anchor` (the story's first day, `start`, falls that many days after the day it is run), its people and a block for each module:

| Demo | Space | People | Modules | Anchor |
|---|---|---|---|---|
| Travel | "Demo: Portugal" (ten days) | `mia` (moderator), `lee`, `sam` | Maps, Calendar, Planner - Itinerary, To-do, Polls, Budget, Research, Documents, Chat | 45 |
| Games | "Demo: The Salt Crown" | `ren` (moderator), `ada`, `tobi`, `ines` | Planner - Projects (the Campaign), Research, Documents, To-do, Calendar, Budget, Polls, Chat | 1 |
| Project | "Demo: Linden Bakery website" | `noa` (moderator), `rosa`, `june`, `kai` | Planner - Projects, To-do, Calendar, Budget, Research, Documents, Polls, Chat | 24 |
| Learning | "Demo: Conversational Spanish" | `marta` (moderator), `dev`, `holly`, `femi` | Planner - Goals, To-do, Calendar, Research, Documents, Chat | 42 |
| Mentoring | "Demo: Zoe and Omar" | `omar` (moderator), `zoe` | Planner - Goals, To-do, Calendar, Research, Documents, Chat | 2 |

The Travel demo is described below as the example. The folder is `templates/demo/`, not `templates/`, because the template loader reads only the `*.json` files directly in `templates/`. A module block is written in that module's own format, in steps, each step by the person it names. Module ids must match `^[a-z0-9-]+$`.

No date in the file is absolute. Each is an offset, so the same file is right on any day and a nightly run keeps the demo ahead of the day. `start` is today plus the file's `anchor` (45 days).

| Written | Gives |
|---|---|
| `today+N`, `today-N` | The day N days from the day of the run, as `YYYY-MM-DD`. |
| `start+N`, `start-N` | The day N days from the trip's first day, as `YYYY-MM-DD`. |
| `start+1T09:30` | That day with a time: `YYYY-MM-DDT09:30`. |
| `start+1T19:00Z` | A trailing `Z` gives a full timestamp. |
| `ms:today+2T10:00` | `ms:` in front gives milliseconds since 1970, as a number. `ms:now` is the time of the run. |
| `@mia` | A person's key, whole or as one part of a key. |
| `{space}`, `{base}` | The space's id and the server's address. |

A base the loader does not know (such as `tomorrow+1`) refuses the whole file before anything is made.

### What the seeder adds

`tools/seed-demo.mjs` keeps the setup that belongs to a throwaway environment and that the loader refuses to do: it switches the environment's template to the demo's (travel when none is asked for) only when the environment is on the Default template and has no space of its own (it refuses, with a sentence, to switch one that already has spaces; any other template is left as it is and the demo's space reads the demo's own template), installs and turns on every bundled module, turns on the calendar and map options, sets the place search and makes the map file. Then it calls the loader. The Travel demo's output and counts are as before (Itinerary 76, Places 37, Calendar 77, To-do 16, Polls 3, Budget 18, Research 4, Chat 25, and Documents). `SEED_DEMO=<id>` (`travel`, `games`, `project`, `learning` or `mentoring`; anything else is refused naming the five) picks the demo; left out, it is the environment's template's own demo, else travel. The two `/ai` questions each demo asks, when an AI service is set up, are in `AI_QUESTIONS` in the seeder; the loader never asks the AI. Another demo prints its own summary (the space, its guest link, the one-time passwords and what was made) and how to reset it by running the same command again.

One difference: the server records who wrote each object, so the `by` on the objects is now the demo person who wrote it (`mia`, or the voter) and not the admin. This includes 61 Calendar copies.

`tools/check-demo-loader.mjs` checks the loader, and `tools/check-compose.mjs` requires that the `Dockerfile` copies the loader and the data file.

**Re-running resets only the demo.** `tools/check-seed-demo.mjs` and `tools/check-demo-loader.mjs` check that other spaces, their data and other accounts are left alone.
### Settings

All are environment variables of the seeder's own window. None is a server setting, and the loader reads none of them: the seeder passes it its options.

| Variable | Default | Meaning |
|---|---|---|
| `SEED_URL` | `http://localhost:<PORT>` | The server to fill. Left out, it uses `PORT` if that is set in this window, else `http://localhost:3000`. |
| `PORT` | | Only used to build the address above, so `PORT=3100 npm run seed:demo` fills a throwaway server on 3100. |
| `ADMIN_LOGIN` | `admin` | The account to sign in as. |
| `ADMIN_PASSWORD` | | Required. Never printed. |
| `SEED_TODAY` | today (UTC) | `YYYY-MM-DD`, to fake the day. Used by the check. |
| `SEED_DEMO` | the environment's template's demo, else `travel` | The demo to make: `travel`, `games`, `project`, `learning` or `mentoring`. |
| `SEED_NO_AI` | | `1` skips the `/ai` exchanges that are otherwise made in the space's chat when an AI service is set up. Each one uses the service and counts toward its allowance. |
| `SEED_MAP` | | `0` skips the map file. Otherwise the seeder also runs `npm run seed:demo-map`. |
| `SEED_SEARCH_URL` | Photon | The address of a Photon-compatible place search, for the Places module's search. |
| `DEMO_MAP_ZOOM` | `12` | The deepest zoom of the map file that `seed:demo-map` cuts. |
| `DEMO_ALLOW_HOSTED` | | `1` lets the seeder run against a host with environments. See below. |
| `DEMO_ENVIRONMENT` | | The id of the one environment to fill, required with `DEMO_ALLOW_HOSTED`. |

### The map file

Unless `SEED_MAP=0`, the seeder makes a small map file of Lisbon, Sintra and Porto and ticks it in the Maps module. `npm run seed:demo-map` (`tools/seed-demo-map.mjs`) does this alone: it reads the newest public Protomaps build with HTTP range requests, keeps the tiles of three small boxes and writes one PMTiles file, `demo-portugal.pmtiles`, to `DATA_DIR/modules/maps/map-tiles/` (`DATA_DIR` from its environment, else the repository's `data` folder: the folder the server uses), then ticks it. The file is a few megabytes at most and is never committed; delete it from **Manage** to remove it. It needs the network; offline, the seeder prints one quiet message and carries on. See [userguide-maps](../userguides/userguide-maps.md) for how Maps reads files.

### A hosted install

On a host with environments (`BASE_DOMAIN` set) the seeder refuses to run, because it would fill whichever environment the address points at. To fill one environment on purpose:

1. Set `DEMO_ALLOW_HOSTED=1` and `DEMO_ENVIRONMENT=<the environment's id>`.
2. Set `SEED_URL` to that environment's own address, `https://<id>.<base domain>`. The seeder refuses any other address, and it talks only to that address, so no other environment is touched.
3. Set `ADMIN_LOGIN` and `ADMIN_PASSWORD` to an **owner** of that environment, not the host's admin.

Hosted, the map files are the host's, so none is made; the host ticks one for the environment.

### A demo site that resets itself

A public demo site is a hosted install with an environment of its own, made for the purpose, with an owner account used only to seed it. The seeder is idempotent, so the reset is just a nightly run of it. Three ways to schedule it follow; each runs the same command. They are recipes, written from how the seeder behaves, and have not been run as given.

Two cautions. The run prints the demo people's new passwords and the guest link, so do not send the output anywhere readable by people who should not have them (a public repository's job log, for one); use a private repository, or discard the output. And use `SEED_NO_AI=1` unless you want a nightly `/ai` exchange paid for.

The seeder uses only Node's own modules, so it needs `node` (22) and a copy of the repository, but no `npm install`.

**cron (Linux, Mac).** Keep the secrets in a file only the job's user can read, `/etc/collaborator-demo.env`:

```
SEED_URL=https://demo.example.com
DEMO_ALLOW_HOSTED=1
DEMO_ENVIRONMENT=demo
ADMIN_LOGIN=demo-owner
ADMIN_PASSWORD=<the owner's password>
SEED_NO_AI=1
```

and in `crontab -e`:

```
0 3 * * * cd /srv/collaborator && set -a && . /etc/collaborator-demo.env && set +a && node tools/seed-demo.mjs > /dev/null 2>> /var/log/collaborator-demo.log
```

The output is discarded; a failure prints one sentence to the error stream, which goes to the log, and the exit status is not zero.

**Task Scheduler (Windows).** Make `C:\collaborator-demo\reset.cmd`, readable only by the account that runs it:

```
@echo off
set SEED_URL=https://demo.example.com
set DEMO_ALLOW_HOSTED=1
set DEMO_ENVIRONMENT=demo
set ADMIN_LOGIN=demo-owner
set ADMIN_PASSWORD=<the owner's password>
set SEED_NO_AI=1
cd /d C:\collaborator
node tools\seed-demo.mjs > nul 2>> C:\collaborator-demo\reset.log
```

then, from a command prompt: `schtasks /Create /SC DAILY /ST 03:00 /TN "Collaborator demo reset" /TR "C:\collaborator-demo\reset.cmd"`.

**GitHub Actions.** Store `DEMO_URL`, `DEMO_OWNER_LOGIN` and `DEMO_OWNER_PASSWORD` as repository secrets (**Settings**, **Secrets and variables**, **Actions**), then add `.github/workflows/demo-reset.yml` to a **private** repository that holds the code:

```yaml
name: Reset the demo
on:
  schedule:
    - cron: '0 3 * * *'
  workflow_dispatch:
jobs:
  reset:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: node tools/seed-demo.mjs > /dev/null
        env:
          SEED_URL: ${{ secrets.DEMO_URL }}
          DEMO_ALLOW_HOSTED: '1'
          DEMO_ENVIRONMENT: demo
          ADMIN_LOGIN: ${{ secrets.DEMO_OWNER_LOGIN }}
          ADMIN_PASSWORD: ${{ secrets.DEMO_OWNER_PASSWORD }}
          SEED_NO_AI: '1'
```

GitHub runs scheduled jobs on UTC and may start them late. A failed run shows in the Actions tab.

## Browser checks leave no orphaned Chrome

The checks that open a headless Chrome (`check-confirm`, `check-prompt`, `check-forms-live`, `check-pdf-viewer`, `check-system-css`, `check-design-system` and `tools/shots.mjs`) start it through one helper, `tools/browser-launch.mjs`, so a check that is killed does not leave a browser running (#807). They are Linux-oriented; the in-process handlers work anywhere, the watchdog needs `/proc`.

- **`startBrowser(bin, args, dir)`** starts the browser in a process group of its own and returns the child; **`stopBrowser(child, dir)`** ends the whole group and deletes its profile folder `dir`. On a normal end or an uncaught error, an `exit` handler kills every browser the process started. On SIGTERM, SIGINT or SIGHUP the same happens and the process exits with the signal's code.
- **The watchdog**, `tools/browser-watchdog.mjs <check pid> <browser pid> <profile dir>`, is started beside each browser. SIGKILL cannot be caught, so the watchdog polls twice a second; when the check is gone it kills that browser's group (within about a second) and deletes the profile folder, and it exits by itself once the browser is gone. It kills only the group whose leader is the browser pid, and only while a member still has `--user-data-dir=<dir>` on its command line, so a reused pid is never touched, and it never matches by name.
- **The reaper**, `node tools/reap-browsers.mjs [--min-age=<seconds, default 300>] [--dry-run] [--only-under=<folder>]`, kills what a dead check left behind anyway. It kills a process only if it is yours, is named like a Chrome (`chrome`, `chromium`, `headless_shell`, `chrome-headless-shell`), has parent pid 1 (its starter is gone), is older than the minimum age, and has `--user-data-dir=` in the temp folder with a prefix from `tools/browser-profiles.mjs`. A browser whose starter is alive, or one started by anything else, is never touched; each pid is killed by itself, never by name or group. `--dry-run` only counts and kills nothing; it prints "reap-browsers: N orphaned browser processes found, none killed (dry run)", or "... N killed". It is safe to run when there are none, and run by hand: nothing runs it for you.
- **The list of profiles**, `tools/browser-profiles.mjs` (`BROWSER_PROFILE_PREFIXES`: `shots-chrome-`, `ds-chrome-`, `sysc-chrome-`, `check-confirm-chrome-`, `check-prompt-chrome-`, `forms-live-chrome-`, `check-pdf-viewer-chrome-`), is what the reaper trusts. A new browser check names its profile folder with a prefix on that list and starts the browser with `startBrowser`.
- **`check-browser-orphans`** (first after `check-syntax` in `npm run check`) fails when a tool or a module test starts a browser by itself or names a profile folder not on the list; it checks that a browser started through the helper is gone after the check ends normally, is terminated, or is killed with SIGKILL; and that the reaper kills only orphans (it uses a copy of `sleep` named `chrome`, so no real browser is touched). The browser part needs a Chromium (`CHROME_PATH` or the usual places) and says SKIPPED, loudly, without one: a skip is not a pass. Read from the code; the check was not rerun for this document.

## The checks added since 0.4

`npm run check` runs them all. Those that open a browser say SKIPPED and exit 0 when there is no Chromium (a skip is never a pass), and fail when `CI` is set.

| Check | What it looks at |
|---|---|
| `check-demo-loader` | The loader against throwaway servers, 14 groups: the same counts as the seeder; a module that is off skipped and not turned on; no environment-wide setting changed (a snapshot before and after); an unmarked same-named space or person refused; a rerun resetting only the demo; every date an offset, with the demo staying ahead of a faked today; a template with no demo file reporting "no demo"; the `words` option; module id checks; each person's last writer. |
| `check-seed-demo` | The seeder against a throwaway server: the trip, the module contents, a second run giving the same counts and a new space, other data untouched, the plain sentences for a wrong password or a missing server, and the hosted refusals. |
| `check-streams` | Without a browser, the stream hub and relay (`public/module-stream.js`) against a stand-in event source and clock, and the server's `?space=&page=1` stream with its event ids. In a browser, that a space's Workspace holds at most three open event streams, that both windows finish loading, and that a change from a second session reaches a window. See [architecture-modules](architecture-modules.md), "Live changes". |
| `check-module-guards` | The rules in `server/module-guards.js` and the data routes, against throwaway servers, with a module made for the purpose and with Research. See [api-modules](../api/api-modules.md), "Data guards". |
| `check-link-preview` | The link preview's blocked ranges, ports and its 10 second limit. |
| `check-calendar-twins` | The Itinerary's copies in the Calendar, with the bundled modules: the pair flagged and offered once, the span and the trip's zone, All day keeping the time, Hide for good. |
| `check-calendar-todo` | The Calendar destination page and its To-do panel in a browser: the toolbar zones at 1280, 520 and 360 pixels, contrast in both modes, the month by keyboard, a copy's zone, and the Undo notice. |
| `check-ai`, `check-ai-prompts`, `check-ai-page` | The AI service, the prompt, who may ask, refunds and the Assistant's page, against a stand-in service. See [architecture-ai](architecture-ai.md). |
| `check-maps`, `check-maps-live` | The Maps style and every shipped theme against the map minimums; the Maps and Places pair in a browser. See [design-theme](../designsystem/design-theme.md), "The map". |
| `check-startup` | The server starts with or without LiveKit, and a taken port prints one plain sentence (below) and exits. |
| `check-prototype-page`, `check-prototype-words`, `check-prototype-parity` | The Prototype page of the design system pages: that it scrolls, that its words follow the names, and that its copies match the real modules. |
| `check-templates`, `check-template-switch` | The template shape and every refusal (the Default template and its `"*"`, module entries limited to five keys, settings only where the manifest marks them, labels only where declared, starter only where a module opts in, the locked words, additions only, `phaseMeasure`, the call, the workspace, starter spaces, a refused `theme`, the sizes and prototype keys), every shipped template against the real manifests, the bundled versions in `tools/template-versions.json`; switching, the offer, host templates, an owner's own (copy, edit, delete with the fallback, import, export). |
| `check-template-lens` | The resolver per space on a store and a module manager in node: which template a place reads, the words, the module set through `onInSpace`, names, labels, settings, reactions and icons, phases and the measure, the call and the workspace, the off switch, prototype keys and the memo of templates never outliving an edit; then a throwaway server (20 checks). |
| `check-module-marks` | The manifest marks, labels and starter at install, each refusal with its sentence; the settings layer (driven, default and own, at the environment's and a space's scope, the 409, `null` forgetting a stored default); the context's labels. |
| `check-starter` | Starter content and starter spaces: only a module that opts in, once only, never on a switch, a restore or a demo load, as the creator through the data route's own checks, the limits, a failed write skipped, `claimStarter`. |
| `check-call-settings`, `check-call-setup` | The core call settings: the rules and the resolver in node, who may change `space.call` and every refusal on a throwaway server (check-call-settings); in a browser, Set up's Call section at 1280 and 390, what Save sends, a template's start never written to the browser's record, no Manage switch, and joining on entry with and without the tap rule (check-call-setup). |
| `check-phase-measure` | The phases' measure: the pure rule, the template's `phaseMeasure` on `/look` and the context, the Done switch's routes and every refusal, a goal-measured phase following its entries, and hostile ids. |
| `check-reactions-icons` | The fixed core set (105 reactions, 113 icons), the owner's additions and a template's, in that order, each once; nothing removes a core entry; a space has none of its own. |
| `check-person-theme` | A person's own theme: `PATCH /api/me { theme }`, `GET /api/me/themes`, `/theme.css` for that person only, hostile bodies, guests, and deleting a theme. |
| `check-pinned-workspaces`, `check-pinned-pages` | The Default Workspace from the template, the pin rule and a new space's tabs (server, 155 checks); Set up's read-only line, the pinned marks and a member's tab bar in a browser, at 1280 and 390. |
| `check-outline` | The shared outline pieces of the SDK: `host.util.order`, `host.util.rollup`, the tree and its moves in node, and `host.ui.outline`, `progress` and `peoplePicker` drawn in a browser. |
| `check-admin-load`, `check-module-load` | Every Manage tab and template page, and every bundled module's page and canvas, open with no page error, no `console.error` and no `/api` answer of 400 or more, at 1280 and 390. See below. |
| `check-template-pages-b` | The later Manage template pages (Default Workspace, Phases, Additional Reactions and Icons, Modules), a module setting's mark in the forms, the phase measure in Set up and the chip, and Profile's theme. Not in `npm run check`; run it by hand. |
| `check-ai-manage-tab`, `check-ai-callers` | The AI Assistant tab (the key is nowhere in the page, its network answers, storage or the data folder in the clear) and what Chat and Research say when AI Assistant is not turned on. |
| `check-catalog` | The AI's catalog of write tools: the manifest fields and their refusals, the schemas, `tools/golden/catalog.json`, and the six bundled tools (`maps__setPlacePoint`, `schedule__setDone`, `schedule__updateEntry`, `todo__linkTask`, `todo__setTaskDue`, `travel__addToDay`). A new qualifying action fails it until it is added to the list and the golden file. See [architecture-ai](architecture-ai.md). |
| `check-welcome-note`, `check-welcome-note-page` | The welcome note: its routes, who may save and read, the cleaner, the seen mark and two environments (on throwaway servers); and its pages in a browser, the Manage part, the dialog, the Welcome entry, a phone width and a guest. See [api-welcome-note](../api/api-welcome-note.md). |
| `check-demo-offer` | The host console's demo offer: the modules a demo needs (with and without an environment, the plan's exclusions, the environment's names), the ticked modules turned on and answered as `turnedOn`, every 400 and 409, the member-limit check before turn-on, and a demo person who moderates a real space (by the API or a stored tick) refused before any change. |
| `check-agent-tokens`, `check-agent-asker`, `check-agent-pages`, `check-agent-chat`, `check-agent-chat-page` | Agent access: the token core and its pen-test list (the gate walked from the app's own router stack), the asker carried through the bus with the Planner and Calendar, the Manage pages in a browser, Chat reading and posting, and the agent mark in Chat. See [architecture-agent-access](architecture-agent-access.md). |
| `check-roadmap-board-sync` | `tools/roadmap-board-sync.mjs` against a stub GraphQL server (below). |

**A port already in use.** If the port is taken, the server prints "Port 3000 is already in use. Another copy of the server may still be running: close its window or stop it, then start this one again.", with the command to find it (`netstat -ano | findstr :3000` then `taskkill /PID <id> /F` on Windows; `lsof -i :3000` then `kill <id>` on Mac or Linux), and exits. A port the account may not use prints "The server may not use port 80. Set PORT to a free port above 1024, then start it again." Any other failure to listen prints one sentence with the system's reason.

## The page-load checks, the roadmap sync and the testing rule

**`tools/check-admin-load.mjs`** (#828) opens, as the owner against a throwaway seeded server, every top-level tab of Manage (Environment and its five parts, Template and each of its pages, Theme, the spaces tab, Roles, Users, Modules and each module's tab, the AI Assistant's among them, About) and the other pages' main scripts at 1280 and 390 pixels, and fails on an uncaught error, a `console.error` or an `/api` answer of 400 or more. It exists because a script that throws while loading (a `let` read before its line runs) leaves a page blank and no other check names it. It runs on any change that touches `public/`. **`tools/check-module-load.mjs`** does the same for every bundled module: it installs and enables each, opens its `page` (`/modules/<id>` as the owner), its `canvas` (`/modules/<id>?space=<space>&popout=1`, the frame the canvas docks) and its `widget` (the home page's tile), at both sizes, and watches the page and every frame inside it for 3.5 seconds after the text appears. A surface that is opened only through another (the keyed viewer, a destination entry on its own) is not opened directly. Both are in `npm run check`, and say SKIPPED, never a pass, with no Chromium.

**The roadmap board.** `.github/roadmap-board.csv` (Issue, URL, Area, Title, Release status, Phase, and the estimated Start and Target dates by Phase) is the data and `tools/roadmap-board-sync.mjs` copies it to the project board; `.github/workflows/project-roadmap-sync.yml` runs it on a push to `main` that changes the CSV, once a day and by hand. It creates a missing field, adds an open issue of this repository that is in the CSV, and sets Area, Release status and Phase (and the two dates where the CSV has one; an empty cell writes nothing) only where the value differs. It never deletes anything, never touches Status or the `priority:` labels, and a field that exists but lacks an option fails the run naming it. It needs a `PROJECT_TOKEN` secret and the variables `PROJECT_OWNER` and `PROJECT_NUMBER`; without them it ends green with a notice. `tools/check-roadmap-board-sync.mjs` runs it against a stub only; it has never been run against the real project. The dates are an estimate by Phase, not a commitment.

**The testing rule** (Thomas, 2026-11-15, `CLAUDE.md`). Run only the checks that cover what a change touches and their direct neighbours (`npm run check:module -- <id>` for a module); never the whole suite for one change, and never in a loop or on a schedule. `npm run check` runs only at release prep, run by the project manager. A check that also fails on a clean `main` is not yours: name it and move on.
