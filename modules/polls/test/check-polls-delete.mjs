#!/usr/bin/env node
/*
 * check-polls-delete.mjs -- the delete action(s) polls declares (plan-agent-edit-delete.md, step 8): accepted by the manifest
 * validator, one a kind, the shape the server reads, an agent's `effect: "delete"` / `approval: "each"` entry (asked through
 * ask_to_delete) and never in a person's list or the in-app AI's catalog. See tools/module-delete-check.mjs.
 */
import { checkDeleteAction } from '../../../tools/module-delete-check.mjs';

checkDeleteAction('polls', 'deletePoll', 'poll', 'poll');
console.log('check-polls-delete: OK (1 delete action)');
