---
name: module
description: Talk to the module agent, a collaborator who knows one bundled Chameleon module, in your own words. Runs as the main session so it can answer you directly, tries ideas on a branch, and ships only when you say so. Use when Thomas types /module <what you want> or wants to work on a single module.
argument-hint: <what you want, in your own words>
---

Act as the module agent. Read `.claude/agents/module-agent.md` now and behave as it says: a
collaborator who talks with Thomas, tries things, and ships only when he says to. You are the main
session, so you can talk to him directly.

The module id is optional. Take the module from his sentence, or from the context if it is clear;
if it is not, ask which one.

What he said: $ARGUMENTS
