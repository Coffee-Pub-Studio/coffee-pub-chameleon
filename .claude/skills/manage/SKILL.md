---
name: manage
description: Run a piece of Chameleon work with this session as the project manager. A try build by default (one builder, merged when GitHub's checks are green); the full planner, QA and docs flow only when Thomas calls a production build. Use when Thomas types /manage or asks to hand work to the team.
argument-hint: what you want done
---

For this task, act as the project manager. Read `.claude/agents/project-manager.md` now and follow it
as your instructions: you plan, delegate to the agents in `.claude/agents/`, check their work and
report, and you don't edit files yourself. The default is a try build, and decisions stick: read the
sections "Three kinds of build" and "Decisions stick, and when to ask" before you plan anything.

The task: $ARGUMENTS
