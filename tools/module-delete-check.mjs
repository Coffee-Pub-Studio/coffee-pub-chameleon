/*
 * module-delete-check.mjs -- what a module's own test asks of its delete action (plan-agent-edit-delete.md, step 8): the
 * bundled manifest is accepted by the manifest validator, the module declares exactly one delete action for the kind, it is
 * the shape the server reads (`effect: "delete"`, one required pointer to the module's own kind, nothing else), it is never
 * asked through the action route (so it is an agent's `effect: "delete"`, `approval: "each"` entry and never in a person's list),
 * and the in-app AI's catalog leaves it out. The live list (agent shown it, person not) is checked by tools/check-agent-delete-asks.mjs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

export function checkDeleteAction(moduleId, actionName, kind, input) {
  const { cleanManifest } = require(path.join(ROOT, 'server', 'modules.js'));
  const { agentMayAsk, isDeleteAction, deleteKindOf, deleteActionFor } = require(path.join(ROOT, 'server', 'agent-routes.js'));
  const { buildCatalog } = require(path.join(ROOT, 'server', 'action-catalog.js'));
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', moduleId, 'module.json'), 'utf8'));
  const m = cleanManifest(raw, { has: () => true });
  const deletes = m.actions.provides.filter(isDeleteAction);
  assert.equal(deletes.filter((a) => deleteKindOf(a) === kind).length, 1, `exactly one delete action for ${kind}`);
  const def = deleteActionFor(m, kind);
  assert.equal(def.name, actionName);
  assert.equal(def.effect, 'delete');
  assert.deepEqual(def.input, { [input]: `ref:${moduleId}:${kind}` }, 'one required pointer to its own kind');
  assert.ok(m.refs.produces.some((p) => p.kind === kind), `${moduleId} produces ${kind}`);
  assert.ok(def.label && def.description, 'a label and a description');
  assert.equal(agentMayAsk(def), false, 'never asked through the action route, so never in a person\'s list');
  assert.ok(!buildCatalog([m]).tools.some((t) => t.action === actionName), 'the in-app AI never sees it');
  return def;
}
