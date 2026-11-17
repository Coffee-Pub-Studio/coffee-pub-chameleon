# Module Agents Plan

**Audience:** Thomas, deciding whether each bundled module gets its own agent and how far it may go; and, once he decides, the sessions that build the agent definition, the fence check and the charters (server-development for the check, the project manager for the rest).

**Status:** draft 2026-11-17, approved in direction by Thomas the same day (see "Thomas's answers so far"); nothing built, nothing created. It comes from Thomas's idea of 2026-11-17: "I feel like a module should get its own agent and be able to do focused work on that module, talk to me, and then push an update for the module when ready. Our current process seems incredibly slow and nested. Of course they would not be allowed to change core UI and code." The shape below is the project manager's proposal, turned into options. Where this plan says "suggestion", it is a lean, not a decision; the four answers below are the only decisions.

## Why

The example of today's cost: flipping Documents' `coediting` default to on (2026-11-17, [plan-documents-coediting](plan-documents-coediting.md) decision 9) took five agent runs: a builder (the manifest and one script), a content writer (guide, architecture, known issues, CHANGELOG), the planner twice (the plan's decision and then its status), and the project manager. The change was one line of data and one line of code, inside `modules/documents/`.

## How it works today, and where the time goes

- A subagent cannot talk to Thomas. Every question goes builder -> project manager -> Thomas and back ([project-manager.md](../../.claude/agents/project-manager.md), "Planning is a conversation with Thomas, and an agent you call can't talk to him").
- Writing is split by owner. Only product-planner edits plans (`CLAUDE.md`, Agents); only content-manager edits `documentation/`, `CHANGELOG.md` and the README, and keeps a plan's status current. Builders "describe their changes in their reports" and do not edit documents. So one module change that needs a guide line, a known-issue line and a CHANGELOG line needs at least a builder and a content-manager, and a plan line needs a planner as well.
- The project manager never edits files and commits itself, so it is always the last hop, even for a one-line change.
- A try build skips the documents and QA on purpose (one builder, one pass, a patch bump), so the slow path is the feedback and production kinds, and any change whose decision must be written down.
- The module lane already exists and is cheap. A change confined to `modules/<id>/` runs `npm run check:module -- <id>` ([check-module.mjs](../../tools/check-module.mjs): 14 core lint checks, the module's own `test/*.mjs`, its `tools/check-<id>*.mjs` files) with no independent review. The time is not in the checks. It is in the hand-offs.

## Options

### 1. A per-module agent, run as the main session

One agent definition used for every module, started as `/module <id> <task>`, run as the main session so it can ask Thomas directly.

- **Who does what:** the module agent builds, tests, writes the module's own words and opens a draft pull request from its own branch. Thomas answers questions in the same conversation and merges. The project manager is not in the loop for a module-lane change.
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

A module agent may open a draft pull request only when each of these is true, and a check or a field in the pull request says so:

1. The code change, with the module version bumped and `node tools/check-module-versions.mjs` printing OK.
2. `npm run check:module -- <id>` passes, and the module's tests cover the change or the report says why not.
3. The module's user guide matches (checked by `npm run check:docs` and a read).
4. A known issue is added or removed if the change touches one.
5. One CHANGELOG line, with what was verified and how ("verified live", "checked by a tool", "read as code only").
6. The fence check passes.
7. A comment on the GitHub issue, if there is one.

Checks can enforce 1, 2, 3 and 6; 4, 5 and 7 are on the agent's honesty, and a short pull request checklist makes them visible. Nothing here can verify a real LiveKit call; the pull request says so.

## Talking to a module agent

- **Thomas types** `/module <id> <task>` in a session opened in this repository (a skill, like `/manage`). A terminal form, `claude --agent module-agent`, would take the module from the first message.
- **The agent can ask** him anything, in the conversation: what he meant, which of two behaviours, whether a change belongs in this module or a neighbour. It must ask rather than guess when the charter says "Thomas's".
- **A session ends** when the draft pull request is open and the agent has reported in a few lines: what changed, what was verified and how, what was not, and any question left. It leaves a branch `module/<id>/<short-name>`, a draft pull request, the issue comment and nothing else; no commit to `main`.
- **Merging:** Thomas merges the pilot's pull request. The target is auto-merge of patch-level pull requests once the checks pass (Thomas, answer 4), after the steps listed above exist.

## How it fits the three kinds of build and the project manager

- **Try build:** the module agent does the same one pass, a patch bump and its own checks, but pushes a branch and a draft pull request instead of working through the manager. The no-QA, no-docs rule would be a choice for each task.
- **Feedback build:** the module agent, then one short QA pass by the quality-assurance agent called by the project manager, or by Thomas reading the pull request.
- **Production build:** the full flow, with the project manager. The module agent is one of its builders.
- **The project manager keeps:** everything in core, every cross-module question, the plans that cover more than one module, release prep, `npm run check`, and the merge routine.

## What the build would take, in order

Each is a small job. Nothing is built; `.claude/agents/` and `CLAUDE.md` are Thomas's to approve.

| Step | Piece | Who builds | Size |
|---|---|---|---|
| 1 | The Documents charter (what it is for and not for, its neighbours) | product-planner with Thomas | small |
| 2 | The module agent definition (one file, takes the module id) in `.claude/agents/` | project manager drafts; Thomas approves | small |
| 3 | The `/module` skill in `.claude/skills/` | project manager drafts; Thomas approves | small |
| 4 | A line in the project manager's instructions saying module agents bypass it for module-lane changes; and the `CLAUDE.md` exception for the ownership rules inside the fence | project manager drafts; Thomas approves | small |
| 5 | The fence check (`tools/check-module-fence.mjs`: diff against `main`, manifest key by key, allow-list) and its own test | server-development | medium |
| 6 | The pull request workflow running the fence check and `check:module` for the changed module | server-development | small |
| 7 | Pilot run on Documents: a draft pull request that Thomas merges | the module agent | one task |
| 8 | After the pilot: branch protection, auto-merge on, the shared-file rule, the patch-level rule in the check | Thomas (settings); server-development (check) | small |

Steps 1 to 4 let the pilot start with the fence as a reading rule only. Steps 5 and 6 should land before the pilot's pull request is merged, so the pilot also tests them.

**Pilot: Documents** (Thomas's answer). It is the case that started this, it declares no `refs`, `actions`, `hooks` or `uploads`, so the fence has the least to guard, and it has the most module tests (about 19 under `modules/documents/test/`). Its `live` key and its dependence on core sync are the one thing to watch. Whiteboard stays the second choice for later.

## Risks

- **Drift between modules.** Each agent sees one module. The charter and the project manager's cross-module role are the defence; they do not remove it.
- **Documentation ownership relaxed.** The rule that only content-manager edits documents exists so one writer keeps the documents consistent. The fence limits the exception to one module's guide and issue lines, but architecture and API documents then lag until a content writer pass (Thomas, answer 3).
- **A manifest change slipping through.** The fence reads the manifest key by key. A new manifest key the fence does not know must count as forbidden by default (an allow-list, not a block-list).
- **One conversation per module.** Fourteen modules means fourteen possible sessions, each with its own context cost; a module not touched for weeks costs nothing.
- **Merge conflicts.** `tools/module-versions.json` is one file for all modules, and `--update` rewrites every entry, so two module branches conflict, as do two CHANGELOG lines at the same spot. The agent should rebase and re-run the update, and the check should compare that module's entry only. Two agents on one module at once is not allowed.
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
6. **QA.** For a feedback build, who runs the short QA pass, with no project manager in the loop?
7. **Sessions.** One long-lived session per module, or a fresh one per task?
