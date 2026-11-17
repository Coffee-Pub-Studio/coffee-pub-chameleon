# Module Agents Plan

**Audience:** Thomas, deciding whether each bundled module gets its own agent and how far it may go; and, once he decides, the sessions that build the agent definition, the fence check and the charters (server-development for the check, the project manager for the rest).

**Status:** draft 2026-11-17, not decided. Nothing in this plan is decided or created. It comes from Thomas's idea of 2026-11-17: "I feel like a module should get its own agent and be able to do focused work on that module, talk to me, and then push an update for the module when ready. Our current process seems incredibly slow and nested. Of course they would not be allowed to change core UI and code." The shape below is the project manager's proposal, turned into options. Where this plan says "suggestion", it is a lean, not a decision.

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

**Suggestion (a lean, not a decision):** option 1 for the module lane, piloted on one module first, with option 2's ownership change applying only inside the fence. If the pilot disappoints, option 2 alone is what remains.

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
| `documentation/architecture/`, `documentation/api/` | forbidden (see open question 5) |
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

The charters would be written by product-planner with Thomas, one at a time, starting with the pilot's module and its neighbours. Where they live is open question 4.

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
- **Merging** stays with Thomas. Whether patch-level module pull requests may merge by themselves once every check is green is open question 2.

## How it fits the three kinds of build and the project manager

- **Try build:** the module agent does the same one pass, a patch bump and its own checks, but pushes a branch and a draft pull request instead of working through the manager. The no-QA, no-docs rule would be a choice for each task.
- **Feedback build:** the module agent, then one short QA pass by the quality-assurance agent called by the project manager, or by Thomas reading the pull request.
- **Production build:** the full flow, with the project manager. The module agent is one of its builders.
- **The project manager keeps:** everything in core, every cross-module question, the plans that cover more than one module, release prep, `npm run check`, and the merge routine.

## What the build would take

Each is a small job.

| Piece | Who builds | Size |
|---|---|---|
| The module agent definition (one file, takes the module id) | Thomas approves; project manager drafts | small |
| The `/module` skill | project manager | small |
| The fence check (`tools/check-module-fence.mjs`: diff against `main`, manifest key by key) and its own test | server-development | medium |
| A pull request workflow that runs the fence check and `check:module` for the changed module | server-development | small |
| `CLAUDE.md` rule changes (the ownership exception inside the fence) | Thomas | small |
| Charters, one per module, the pilot's first | product-planner with Thomas | small each |

**Pilot (suggestion):** Documents. It is the case that started this, it declares no `refs`, `actions`, `hooks` or `uploads`, so the fence has the least to guard, and it has the most module tests (about 19 under `modules/documents/test/`). Whiteboard is the second choice: also no `refs` or `actions`, a guide, an architecture document and a known-issues section of its own, but it declares `uploads` and has 3 tests. Documents' `live` key and its dependence on core sync are the one thing to watch.

## Risks

- **Drift between modules.** Each agent sees one module. The charter and the project manager's cross-module role are the defence; they do not remove it.
- **Documentation ownership relaxed.** The rule that only content-manager edits documents exists so one writer keeps the documents consistent. The fence limits the exception to one module's guide and issue lines, but architecture and API documents then lag. Open question 5.
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

1. **Option.** Option 1, 2 or 3? And is a pilot first acceptable?
2. **Merging.** Thomas merges every module pull request, or may a patch-level one merge by itself once every check is green (never a feature, never a manifest change)?
3. **Pilot module.** Documents or Whiteboard?
4. **Charters.** Where do they live (`modules/<id>/CHARTER.md`, which a module agent can read but the fence would forbid it to edit, or in `documentation/`)? And does Thomas write them or approve a planner's draft?
5. **Architecture and API documents.** Stay forbidden to a module agent (they may lag), or allowed for that module's own architecture document?
6. **Which manifest keys** may a module agent change: only the list in the fence table, or also `settings` beyond defaults and `labels`?
7. **Plans.** May a module agent write a plan for a module-only feature, or only update status lines? Decisions stay Thomas's either way.
8. **Issues.** Must every module change reference a GitHub issue?
9. **QA.** For a feedback build, who runs the short QA pass, with no project manager in the loop?
10. **Sessions.** One long-lived session per module, or a fresh one per task?
