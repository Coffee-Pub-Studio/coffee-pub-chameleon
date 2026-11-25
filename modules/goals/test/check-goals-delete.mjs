#!/usr/bin/env node
/*
 * check-goals-delete.mjs -- the delete action(s) goals declares (plan-agent-edit-delete.md, step 8): accepted by the manifest
 * validator, one a kind, the shape the server reads, an agent's `effect: "delete"` / `approval: "each"` entry (asked through
 * ask_to_delete) and never in a person's list or the in-app AI's catalog. See tools/module-delete-check.mjs.
 */
import { checkDeleteAction } from '../../../tools/module-delete-check.mjs';

checkDeleteAction('goals', 'deleteEntry', 'plan', 'entry');
console.log('check-goals-delete: OK (1 delete action)');
