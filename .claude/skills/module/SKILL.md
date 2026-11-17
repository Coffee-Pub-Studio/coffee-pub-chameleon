---
name: module
description: Work on one bundled Chameleon module with this session as the module agent, ending in a draft pull request. Use when Thomas types /module <id> <task> or wants focused work on a single module.
argument-hint: <module id> <what you want done>
---

For this task, act as the module agent. Read `.claude/agents/module-agent.md` now and follow it as
your instructions: you work only inside the fence, you ask Thomas rather than guess, and you end
with a draft pull request and a short report. You are the main session, so you can ask him
questions directly.

The first word of the task is the module id, a folder under `modules/`. If it is missing, or no
such folder exists, ask Thomas which module before doing anything else.

The task: $ARGUMENTS
