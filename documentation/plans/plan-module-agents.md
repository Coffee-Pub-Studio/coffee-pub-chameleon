# Module Agents Plan

**Audience:** Thomas, deciding whether each bundled module gets its own agent and how far it may go; and, once he decides, the sessions that build the agent definition, the fence check and the charters (server-development for the check, the project manager for the rest).

**Status:** draft 2026-11-17, approved in direction by Thomas the same day (see "Thomas's answers so far"); nothing built, nothing created (the agent and skill drafts are on a branch, not agreed). It comes from Thomas's idea of 2026-11-17: "I feel like a module should get its own agent and be able to do focused work on that module, talk to me, and then push an update for the module when ready. Our current process seems incredibly slow and nested. Of course they would not be allowed to change core UI and code." Thomas then said how he wants to use it: "Hey agent, I was using whiteboard and I think we need to toy with a floating toolbar", and named two worries: "this will be such a formal process I will be back to slow, methodic changes" and "I will not be able to communicate with the agent directly". The agent is shaped by those two. The shape below is the project manager's proposal, turned into options. Where this plan says "suggestion", it is a lean, not a decision; the four answers below are the only decisions.

## Why

The example of today's cost: flipping Documents' `coediting` default to on (2026-11-17, [plan-documents-coediting](plan-documents-coediting.md) decision 9) took five agent runs: a builder (the manifest and one script), a content writer (guide, architecture, known issues, CHANGELOG), the planner twice (the plan's decision and then its status), and the project manager. The change was one line of data and one line of code, inside `modules/documents/`.

Two concerns of Thomas's give the shape (2026-11-17). **Speed:** "this will be such a formal process I will be back to slow, methodic changes". So the agent has no checklist, no plan and no issue while he is trying things; nothing is formal until he says to ship. **Direct conversation:** "I will not be able to communicate with the agent directly". So it runs as the main session and he talks to it in his own words, like a colleague, and the module agent is not another hop behind the project manager.

## How it works today, and where the time goes

- A subagent cannot talk to Thomas. Every question goes builder -> project manager -> Thomas and back ([project-manager.md](../../.claude/agents/project-manager.md), "Planning is a conversation with Thomas, and an agent you call can't talk to him").
- Writing is split by owner. Only product-planner edits plans (`CLAUDE.md`, Agents); only content-manager edits `documentation/`, `CHANGELOG.md` and the README, and keeps a plan's status current. Builders "describe their changes in their reports" and do not edit documents. So one module change that needs a guide line, a known-issue line and a CHANGELOG line needs at least a builder and a content-manager, and a plan line needs a planner as well.
- The project manager never edits files and commits itself, so it is always the last hop, even for a one-line change.
- A try build skips the documents and QA on purpose (one builder, one pass, a patch bump), so the slow path is the feedback and production kinds, and any change whose decision must be written down.
- The module lane already exists and is cheap. A change confined to `modules/<id>/` runs `npm run check:module -- <id>` ([check-module.mjs](../../tools/check-module.mjs): 14 core lint checks, the module's own `test/*.mjs`, its `tools/check-<id>*.mjs` files) with no independent review. The time is not in the checks. It is in the hand-offs.

## Options

### 1. A per-module agent, run as the main session

One agent definition used for every module, started as `/module <what you want, in your own words>` (the module id is optional; the agent takes it from his sentence), run as the main session so it can talk to Thomas directly.

- **Who does what:** the module agent reads the module, answers briefly, tries things on a branch he can see, and changes them as he reacts. Only when he says to ship does it run the checks, bump the patch version and open a draft pull request. Thomas merges. The project manager is not in the loop for a module-lane change.
- **Allowed to change:** only the paths in the fence below.
- **Cost:** one new agent file, one skill, one fence check, one charter per module, a pull request workflow. The agent files are Thomas's, so he writes or approves them.
- **Risks:** it relaxes the rule that only content-manager edits documents, for module paths only; module drift, because each agent knows only its module; one conversation per module; merge conflicts (see Risks).
- **Rules out:** nothing; the old flow stays for core.

### 2. A lighter version: relax the ownership rules only

No new agents. A builder editing `modules/<id>/` may also edit that module's user guide, its known-issues lines, its plan's status lines and one CHANGELOG line. The project manager still runs it, so a builder still cannot ask Thomas directly.

- **Saves:** the content-manager and planner runs, so the example drops from five runs to about two.
- **Does not save:** the question hop through the project manager, and nothing fences the paths. The rule would live only in prose.
- **Cost:** a few lines in `CLAUDE.md` and the builder agent files.

### 3. Leave it

Keep the flow. Costs nothing to build. The five-run cost stays for every module change that needs a written record. A try build already avoids it, by skipping the record.

Thomas chose option 1 after a pilot (see above). If the pilot disappoints, option 2 alone is what remains.

## Thomas's answers so far (2026-11-17)

Answered by clickable box. These are decisions; everything else in this plan is still a proposal.

1. **Approach: option 1, after a pilot.** Per-module agents run as the main session. Keep or change it from what the pilot teaches.
2. **Pilot: Documents.**
3. **Beyond the module folder, a module agent may edit** that module's user guide, that module's known-issues entries, that module's plan status lines and one CHANGELOG line. The architecture and API pages for the module lag until the content writer does a pass.
4. **Merging: auto-merge patch-level module pull requests once the fence and the module checks pass.** Thomas's option also said it needs the new pull request check workflow first and "not before the pilot has run". This is recorded as the target.

### What must exist before auto-merge can work

Nothing below changes Thomas's answer. It is the order of building. Until all of it exists, the pilot's pull request is a draft that Thomas merges himself.

- **A pull request check workflow.** Today only the design check runs on pull requests; [image.yml](../../.github/workflows/image.yml) runs only on `main` and tags. A new workflow runs the fence check and `npm run check:module -- <id>` for the changed module.
- **The fence check as a required check.** It exists only as a plan until it is built.
- **Branch protection on `main`** requiring those checks, and **auto-merge switched on** in the repository's settings. Both are GitHub settings only Thomas can change; no agent can.
- **A rule for the two shared files.** `tools/module-versions.json` is rewritten whole by `--update`, and the single `[Unreleased]` in `CHANGELOG.md` takes every branch's line at the same spot. Without a rule, two merged module pull requests conflict and auto-merge stalls. The suggestion: the check compares only that module's entry, and the agent rebases and re-runs the update before the pull request leaves draft. How the CHANGELOG line avoids the same conflict is open question 1.
- **"Patch-level" in a way a check can decide.** Suggestion: the module's version differs from `main` by a patch bump only (same major and minor); the manifest changes only in `version`, `description`, `labels` and a setting's `label`, `help` or `default`; any manifest key the fence does not know counts as forbidden; and no path outside the fence's allowed list changed. Anything else is not patch-level and waits for Thomas.

## The fence

What a module agent may change, as paths. A check compares the branch to `main` and fails the pull request on any other path.

| Path | Module agent |
|---|---|
| `modules/<id>/` (`src/`, `test/`, `design/`, notes) | allowed (its own module only) |
| `modules/<id>/module.json`: `version`, `description`, `labels`, a setting's `label`, `help` and `default` | allowed |
| `modules/<id>/module.json`: `permissions`, `uploads`, `refs`, `access`, `scope`, `surfaces`, `requires`, `hooks`, `actions`, `events`, `commands`, `guards`, `live`, `budget`, `storage`, `install` | forbidden: Thomas decides |
| `tools/module-versions.json`, that module's entry only | allowed |
| `documentation/userguides/userguide-<module>.md` | allowed |
| `documentation/known-issues.md`, that module's section | allowed |
| `documentation/plans/` status lines of that module's plans | allowed; never a decision or an option |
| `CHANGELOG.md` | one line under `[Unreleased]` |
| `documentation/architecture/`, `documentation/api/` | forbidden until the content writer does a pass (Thomas, answer 3) |
| `public/`, `server/`, `public/sdk/`, `public/module-host.js`, `public/module-frame.js`, `templates/`, the rest of `tools/`, `.claude/`, `CLAUDE.md`, `.github/` | forbidden: core |
| another module's folder | forbidden |

**What a module change can still do to core.** A module reaches core only through its manifest and the SDK. Of 14 manifests today: 13 declare `access`, 11 `refs`, 10 `actions`, 5 `hooks`, 2 `uploads`, 2 `live`. The fence handles each:

- **Manifest keys** are the real door. `CLAUDE.md` names only permissions, uploads and refs, but a module's `actions`, `hooks`, `events`, `commands`, `guards`, `live` and `budget` also change what other modules and the server do. The check reads the manifest as data and compares it to `main`, key by key, so it fails on any change to a forbidden key, not on the file.
- **The SDK** (`host.*`) is used by a module's own scripts. A module can call it in new ways but cannot change it. The check cannot judge a new call; the module's tests and `check-module-guards` (which starts a throwaway server and checks guards and permissions against the real routes) are what catch it.
- **Cross-module behaviour** (actions and refs other modules call) is in `actions`, so it is fenced. A module's own `src/` can still change what an action does. This is the one gap the fence does not close.
- **The version fingerprint** covers `module.json` and `src/` but not `test/` or `design/`, so editing only those needs no bump. The agent does not need to know this; `check-module-versions` tells it.

Today nothing runs on a pull request except the design check: [image.yml](../../.github/workflows/image.yml) runs on `main` and tags only. So the fence check and a `check:module` run for the changed module need a new workflow (the build, below).

## The module charter

A short file per module that Thomas owns, so cross-module questions are not decided per module. The usability audit found four places for a note and three planners. A module agent reads its charter first and stops to ask when a task touches a neighbour.

Template, one page at most:

- **For:** what the module is for, in two sentences.
- **Not for:** what it must not become.
- **Used by:** which roles, in which spaces.
- **Neighbours it must not duplicate:** each named, with the line between them.
- **Questions that are Thomas's:** what it must ask before doing.

Where modules overlap today (from `modules/`):

- **Notes and writing:** documents, research, vault (storage and files), whiteboard.
- **Planners:** schedule, goals, travel, and beside them calendar and todo.
- **Places and maps:** maps, with travel.
- **Assistant and stream:** assistant (the AI) touches every module through `hooks.ai`; stream is its own corner.

The charters would be written by product-planner with Thomas, one at a time, starting with the pilot's module and its neighbours. Where they live is open question 2.

## Definition of done

There is no checklist while he is trying things. Shipping, which only happens when he says so ("keep it", "ship it", "make it a PR"), means:

1. The module's checks pass (`npm run check:module -- <id>`), with tests added or changed where they cover the change.
2. A patch bump, recorded with `node tools/check-module-versions.mjs --update`, which then prints OK. Only this module's entry stays in the diff.
3. A draft pull request, rebased on `main`, with a three-line description: what changed, how it was checked, what was not.
4. The guide, a known-issues entry and one CHANGELOG line, only when a user would notice the change or he asks. When the agent skips them it says why in one line.
5. A comment on the GitHub issue, if there is one.

What protects something holds before the draft opens: the checks pass, the version is bumped, nothing outside the fence changed, and what the agent says about verification is true ("seen live", "checked by a tool", "read as code only" are different claims). Nothing here can verify a real LiveKit call; the pull request says so. There is no pull request checklist. He can also walk away: the branch stays, the agent says where it is in one line, and no pull request is opened.

## Talking to a module agent

- **Thomas types** `/module <what you want, in your own words>` in a session opened in this repository, for example "Hey agent, I was using whiteboard and I think we need to toy with a floating toolbar". The module id is optional. The agent works out the module from the sentence and asks in one line only when it cannot.
- **The first reply** is a few lines: what it understood, what it could try, and at once whether the idea stays inside the module or needs core (naming the core piece: an SDK call, a host contract, a manifest key, a template) and what a module-only version could be. It asks at most two questions, and tries something without waiting for the answer where it can. The fence is told to him early, not met at the end.
- **The loop:** the agent works on a branch `module/<id>/<short-name>` in small commits, runs the module on a throwaway server, shows him, takes his reaction in conversation and changes it. It shows two or three variants when the choice is taste.
- **Seeing a change** is limited in a cloud session (see Risks): screenshots, the exact steps to run the branch on his own copy, and a link to the commit.
- **A session ends** in one of two ways. He says ship, and the agent leaves a draft pull request and a short report (the checks and their result, the new version, the link, what it wrote and what it skipped). Or he drops the idea, and it leaves the branch, one line saying where, and no pull request. Never a commit to `main`.
- **Merging:** Thomas merges the pilot's pull request. The target is auto-merge of patch-level pull requests once the checks pass (Thomas, answer 4), after the steps listed above exist.

## How it fits the three kinds of build and the project manager

- **The module agent no longer names a build kind.** It is a conversation that ends in either nothing or a shipped pull request, not a try, feedback or production build. A try build's rules (one pass, a patch bump, no QA) are close to what shipping does; a feedback or production build still goes through the project manager.
- **Review:** in the module lane there is no independent review (`CLAUDE.md`). Thomas reading the draft pull request and seeing the change himself is the review; if he wants a regression pass he asks the project manager for one.
- **The project manager keeps:** everything in core, every cross-module question, the plans that cover more than one module, release prep, `npm run check`, and the merge routine. Its instructions get one line saying module agents bypass it.

## What the build would take, in order

Each is a small job. Nothing is built; `.claude/agents/` and `CLAUDE.md` are Thomas's to approve.

| Step | Piece | Who builds | Size |
|---|---|---|---|
| 1 | The Documents charter (what it is for and not for, its neighbours) | product-planner with Thomas | small |
| 2 | The module agent definition (one file; the module comes from his sentence) in `.claude/agents/` | project manager drafts; Thomas approves | small |
| 3 | The `/module` skill in `.claude/skills/` (takes his words, module id optional) | project manager drafts; Thomas approves | small |
| 4 | A line in the project manager's instructions saying module agents bypass it for module-lane changes; and the `CLAUDE.md` exception for the ownership rules inside the fence | project manager drafts; Thomas approves | small |
| 5 | The fence check (`tools/check-module-fence.mjs`: diff against `main`, manifest key by key, allow-list) and its own test | server-development | medium |
| 6 | The pull request workflow running the fence check and `check:module` for the changed module | server-development | small |
| 7 | Pilot run on Documents: a draft pull request that Thomas merges | the module agent | one task |
| 8 | After the pilot: branch protection, auto-merge on, the shared-file rule, the patch-level rule in the check | Thomas (settings); server-development (check) | small |

Steps 1 to 4 let the pilot start with the fence as a reading rule only: the agent is told the fence and tells him early, and nothing checks it. The fence check does not exist yet. Steps 5 and 6 should land before the pilot's pull request is merged, so the pilot also tests them.

**Pilot: Documents** (Thomas's answer). It is the case that started this, it declares no `refs`, `actions`, `hooks` or `uploads`, so the fence has the least to guard, and it has the most module tests (about 19 under `modules/documents/test/`). Its `live` key and its dependence on core sync are the one thing to watch. Whiteboard stays the second choice for later.

## Risks

- **Drift between modules.** Each agent sees one module. The charter and the project manager's cross-module role are the defence; they do not remove it.
- **Documentation ownership relaxed.** The rule that only content-manager edits documents exists so one writer keeps the documents consistent. The fence limits the exception to one module's guide and issue lines, but architecture and API documents then lag until a content writer pass (Thomas, answer 3).
- **A manifest change slipping through.** The fence reads the manifest key by key. A new manifest key the fence does not know must count as forbidden by default (an allow-list, not a block-list).
- **One conversation per module.** Fourteen modules means fourteen possible sessions, each with its own context cost; a module not touched for weeks costs nothing.
- **Merge conflicts.** `tools/module-versions.json` is one file for all modules, and `--update` rewrites every entry, so two module branches conflict, as do two CHANGELOG lines at the same spot. The agent should rebase and re-run the update, and the check should compare that module's entry only. Two agents on one module at once is not allowed.
- **A push may be refused.** A cloud session is usually given one branch to push to (a name like `claude/...`), and the permission system may refuse a push to `module/<id>/<short-name>`. The agent does not work around it: it pushes to the given branch or leaves the work local, and says so in one line.
- **He cannot open the agent's server.** A throwaway server in the build container is not reachable from Thomas's browser. Seeing a change means screenshots, the exact steps to run the branch on his own copy (`git fetch`, check out the branch, `npm run dev`, which page to open) and a link to the commit. For a visual experiment that is slower than looking at it. See open question 8.
- **No independent review in the module lane** (`CLAUDE.md`). With the pull request, Thomas is the review; he reads a diff in one module.

## Contradictions found in the repository

- `CLAUDE.md` names only permissions, uploads and refs as core in a manifest. Other manifest keys (`actions`, `hooks`, `live`, `budget`, `guards`) also reach beyond the module. The fence treats them as forbidden; that is stricter than the written rule.
- Flipping the Documents default, the example case, was itself a manifest `settings` default change. The fence has to allow it, or the example would not fit.
- `check-module-versions` fingerprints `module.json` and `src/` only, and `--update` rewrites the whole file, not one entry.
- There is no pull request check for modules today (see the fence section), so "a check fails the PR" needs the workflow.
- `/manage` and the project manager's instructions assume every build goes through the project manager; a module agent bypasses that on purpose, so the manager's text needs a line saying so.

## Open questions

1. **CHANGELOG conflicts.** One line per pull request at the top of `[Unreleased]` will conflict. Does the module agent rebase before leaving draft (suggestion), or does the CHANGELOG line move out of the fence?
2. **Charters.** Where do they live (`modules/<id>/CHARTER.md`, which a module agent can read but the fence would forbid it to edit, or in `documentation/`)? Does Thomas write them or approve a planner's draft?
3. **Which manifest keys** may a module agent change: only the list in the fence table, or also `settings` beyond defaults and `labels`?
4. **Plans.** May a module agent write a plan for a module-only feature, or only update status lines? Decisions stay Thomas's either way.
5. **Issues.** Must every module change reference a GitHub issue?
6. **QA.** Is Thomas reading the draft pull request and seeing the change enough, or may he ask the project manager for a regression pass when a change is risky?
7. **Sessions.** One long-lived session per module, or a fresh one per task?
8. **Seeing a visual experiment.** How does Thomas want to see one in practice: screenshots and steps to run it on his own copy, a preview link if the session offers one, or something else?
