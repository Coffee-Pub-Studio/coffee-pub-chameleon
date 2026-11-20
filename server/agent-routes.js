'use strict';
// Every route an agent may ever reach, and the permission each needs (documentation/plans/plan-agent-matrix.md, "One list").
//
// The code holds what is possible; the Roles grid's Agent column chooses within it. A route not on this list is never
// reachable by an agent's token, whatever any column says (the gate answers 403 "An agent can't do that."). A route on it
// is let on only when its place check passes and what it `needs` holds:
//   - a permission key (a row of the Roles grid): it must be ticked in the agent's column;
//   - `module`: the module's own permission, which the route itself checks against the agent's column once the request
//     names the module (module data, objects, the actions list and the action route);
//   - `always`: nothing to tick (the agent's own `me`, the kinds of object, its own request's status, the MCP door, whose
//     tool calls come back through the gate as the route they wrap and need what that route needs).
//
// Each entry: { kind, method, path, counts, place, needs }.
//   kind:   `agent`, the ordinary agent. (The set-up agent of plan-admin-agent joins this list as `setup`.)
//   method: the Express method, lower case (get, post).
//   path:   the route as the app registers it.
//   counts: what a call costs against the agent's limits: `read`, `write`, or `mcp` (POST /mcp, see server/index.js).
//   place:  the gate's check of the place a call names (agentAt in server/index.js): none, spaceParam, spaceScope, linkRef,
//           resolveRefs.
//   needs:  a permission key, `module` or `always`. An entry without one stops the server at start.
//
// Not on it: GET /api/spaces/:id (Set up's read, which answers a member "owners only"), and every other chat route (the
// live stream, deleting, hiding or changing a message, pictures, Keep, link previews, private messages, commands and /ai).

const AGENT_ROUTES = Object.freeze([
  { kind: 'agent', method: 'get', path: '/api/agent/me', counts: 'read', place: 'none', needs: 'always' },
  { kind: 'agent', method: 'get', path: '/api/modules/:id/context', counts: 'read', place: 'spaceScope', needs: 'module' },
  { kind: 'agent', method: 'get', path: '/api/modules/:id/data', counts: 'read', place: 'spaceScope', needs: 'module' },
  { kind: 'agent', method: 'get', path: '/api/modules/:id/data/:key', counts: 'read', place: 'spaceScope', needs: 'module' },
  { kind: 'agent', method: 'get', path: '/api/objects/search', counts: 'read', place: 'spaceScope', needs: 'module' },
  { kind: 'agent', method: 'get', path: '/api/objects/links', counts: 'read', place: 'linkRef', needs: 'module' },
  { kind: 'agent', method: 'get', path: '/api/objects/kinds', counts: 'read', place: 'none', needs: 'always' },
  { kind: 'agent', method: 'post', path: '/api/objects/resolve', counts: 'read', place: 'resolveRefs', needs: 'module' },
  { kind: 'agent', method: 'get', path: '/api/spaces/:id/members', counts: 'read', place: 'spaceParam', needs: 'agentMembers' },
  { kind: 'agent', method: 'get', path: '/api/spaces/:id/actions', counts: 'read', place: 'spaceParam', needs: 'module' },
  { kind: 'agent', method: 'post', path: '/api/spaces/:id/action', counts: 'write', place: 'spaceParam', needs: 'module' },
  { kind: 'agent', method: 'get', path: '/api/spaces/:id/action/:requestId', counts: 'read', place: 'spaceParam', needs: 'always' },
  { kind: 'agent', method: 'get', path: '/api/spaces/:id/chat', counts: 'read', place: 'spaceParam', needs: 'chatRead' },
  { kind: 'agent', method: 'post', path: '/api/spaces/:id/chat', counts: 'write', place: 'spaceParam', needs: 'chat' },
  { kind: 'agent', method: 'post', path: '/mcp', counts: 'mcp', place: 'none', needs: 'always' },
  { kind: 'agent', method: 'get', path: '/mcp', counts: 'read', place: 'none', needs: 'always' },
].map((entry) => Object.freeze(entry)));

// The rows of the Roles grid only an agent column has (the "Agents" group); people's columns show no box on them.
const AGENT_ONLY_PERMISSIONS = Object.freeze([
  Object.freeze({ key: 'agentMembers', label: 'See who is in {a space}', group: 'Agents', agentOnly: true }),
]);

// The built-in rows the Agent column may ever tick. Every other built-in row is never an agent's (the call, pictures,
// reactions, screen share, asides, private calls, mute, kick, guest links, tags, AI, the images). Module rows are worked
// out from the manifests (agentModuleKeys).
const AGENT_BUILT_IN = Object.freeze(['chatRead', 'chat', 'agentMembers']);

// The Agent column as agents work today (decision 5): read Chat and see members on, Send chat messages off. Module rows
// start at their member default (store.roleSetRaw).
const AGENT_DEFAULTS = Object.freeze({ chatRead: true, chat: false, agentMembers: true });

const KINDS = ['agent'];
const METHODS = ['get', 'post'];
const COUNTS = ['read', 'write', 'mcp'];
const PLACES = ['none', 'spaceParam', 'spaceScope', 'linkRef', 'resolveRefs'];

// What an agent may ask a module for through the action route (plan-agent-access.md, decision 5): a `write`, never local,
// asker-only, destructive, without an effect, or kept from AI (`ai: false`). The actions list shows an agent only these.
const agentMayAsk = (def) => Boolean(def) && !def.local && !def.askerOnly && def.effect === 'write' && def.ai !== false;

// The module rows an agent column may tick for one manifest: those that guard something an agent can reach. Its data's
// read and write guards (access.read, access.write; never personWrite, since an agent reads and asks only in a space), and
// a permission named by the `takes` of an action an agent may ask for. Never a library's "See every file" (see_all).
function agentModuleKeys(manifest) {
  if (!manifest || typeof manifest !== 'object') return [];
  const own = new Set();
  for (const need of ['read', 'write']) {
    const guard = manifest.access?.[need];
    if (typeof guard === 'string' && guard) own.add(guard);
  }
  for (const def of manifest.actions?.provides || []) {
    if (!agentMayAsk(def)) continue;
    for (const e of def.takes || []) if (e && typeof e.permission === 'string' && e.permission) own.add(e.permission);
  }
  if (manifest.library) own.delete('see_all');
  const declared = new Set((manifest.permissions || []).map((p) => p.key));
  return [...own].filter((k) => declared.has(k)).map((k) => `module.${manifest.id}.${k}`);
}

// The problems with a list, one sentence each (empty when it is sound). Used at start (assertAgentRoutes) and by
// tools/check-agent-matrix.mjs.
function agentRouteProblems(list = AGENT_ROUTES) {
  const problems = [];
  const seen = new Set();
  for (const [i, e] of list.entries()) {
    const name = e && typeof e === 'object' ? `${String(e.method || '?').toUpperCase()} ${e.path || '?'}` : `entry ${i}`;
    if (!e || typeof e !== 'object') { problems.push(`${name} is not an entry`); continue; }
    if (!KINDS.includes(e.kind)) problems.push(`${name} has no kind (agent)`);
    if (!METHODS.includes(e.method)) problems.push(`${name} has a method other than get or post`);
    if (typeof e.path !== 'string' || !e.path.startsWith('/')) problems.push(`${name} has no path`);
    if (!COUNTS.includes(e.counts)) problems.push(`${name} has no counts (read, write or mcp)`);
    if (!PLACES.includes(e.place)) problems.push(`${name} has no place check`);
    if (e.needs === undefined || e.needs === null || e.needs === '') problems.push(`${name} has no needs`);
    else if (e.needs !== 'module' && e.needs !== 'always' && !AGENT_BUILT_IN.includes(e.needs)) problems.push(`${name} needs "${e.needs}", which is not a row the agent column may tick`);
    const id = `${e.kind} ${e.method} ${e.path}`;
    if (seen.has(id)) problems.push(`${name} is on the list twice`);
    seen.add(id);
  }
  return problems;
}

// Stops the server at start when the list is not sound, saying which entry and why.
function assertAgentRoutes(list = AGENT_ROUTES) {
  const problems = agentRouteProblems(list);
  if (problems.length) throw new Error(`The agents' route list is wrong: ${problems.join('; ')}.`);
}

assertAgentRoutes();

module.exports = { AGENT_ROUTES, AGENT_ONLY_PERMISSIONS, AGENT_BUILT_IN, AGENT_DEFAULTS, agentMayAsk, agentModuleKeys, agentRouteProblems, assertAgentRoutes };
