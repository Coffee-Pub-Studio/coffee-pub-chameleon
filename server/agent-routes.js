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
//   kind:   `agent`, the ordinary agent, or `setup`, the set-up agent (documentation/plans/plan-admin-agent.md). A token
//           reaches only its own kind's entries: each kind gets 403 on the other's routes.
//   method: the Express method, lower case (get, post, patch).
//   path:   the route as the app registers it.
//   counts: what a call costs against the agent's limits: `read`, `write`, or `mcp` (POST /mcp, see server/index.js).
//   place:  the gate's check of the place a call names (agentAt in server/index.js): none, spaceParam, spaceScope, linkRef,
//           resolveRefs, madeParam (a space the set-up agent made, plan-admin-agent decision 3).
//   needs:  a permission key, `module` or `always`. An entry without one stops the server at start.
//
// Not on it: GET /api/spaces/:id (Set up's read, which answers a member "owners only"), and every other chat route (the
// live stream, deleting, hiding or changing a message, pictures, Keep, link previews, private messages, commands and /ai).

const AGENT_ROUTES = Object.freeze([
  { kind: 'agent', method: 'get', path: '/api/agent/me', counts: 'read', place: 'none', needs: 'always' },
  { kind: 'agent', method: 'get', path: '/api/modules/:id/context', counts: 'read', place: 'spaceScope', needs: 'module' },
  { kind: 'agent', method: 'get', path: '/api/modules/:id/data', counts: 'read', place: 'spaceScope', needs: 'module' },
  { kind: 'agent', method: 'get', path: '/api/modules/:id/data/:key', counts: 'read', place: 'spaceScope', needs: 'module' },
  // A day's weather, from a module that declares `weather` (plan-itinerary-weather.md, step 5; MCP read_weather).
  { kind: 'agent', method: 'get', path: '/api/modules/:id/weather', counts: 'read', place: 'spaceScope', needs: 'module' },
  { kind: 'agent', method: 'get', path: '/api/objects/search', counts: 'read', place: 'spaceScope', needs: 'module' },
  { kind: 'agent', method: 'get', path: '/api/objects/links', counts: 'read', place: 'linkRef', needs: 'module' },
  { kind: 'agent', method: 'get', path: '/api/objects/kinds', counts: 'read', place: 'none', needs: 'always' },
  // The objects format's JSON Schema: every kind and its typed details (plan-agent-edit-delete.md, "The contract", 5; MCP
  // object_format).
  { kind: 'agent', method: 'get', path: '/api/objects/format/schema', counts: 'read', place: 'none', needs: 'always' },
  { kind: 'agent', method: 'post', path: '/api/objects/resolve', counts: 'read', place: 'resolveRefs', needs: 'module' },
  { kind: 'agent', method: 'get', path: '/api/spaces/:id/members', counts: 'read', place: 'spaceParam', needs: 'agentMembers' },
  { kind: 'agent', method: 'get', path: '/api/spaces/:id/actions', counts: 'read', place: 'spaceParam', needs: 'module' },
  { kind: 'agent', method: 'post', path: '/api/spaces/:id/action', counts: 'write', place: 'spaceParam', needs: 'module' },
  { kind: 'agent', method: 'get', path: '/api/spaces/:id/action/:requestId', counts: 'read', place: 'spaceParam', needs: 'always' },
  // Asking a person to delete one object (plan-agent-edit-delete.md, decision 2 and "The contract", 3): the ask changes
  // nothing; a person approves or declines it through their own routes, which are never on this list. And its own ask's
  // state (MCP ask_to_delete, ask_status).
  { kind: 'agent', method: 'post', path: '/api/spaces/:id/delete-asks', counts: 'write', place: 'spaceParam', needs: 'agentDelete' },
  { kind: 'agent', method: 'get', path: '/api/agent/asks/:id', counts: 'read', place: 'none', needs: 'always' },
  { kind: 'agent', method: 'get', path: '/api/spaces/:id/chat', counts: 'read', place: 'spaceParam', needs: 'chatRead' },
  { kind: 'agent', method: 'post', path: '/api/spaces/:id/chat', counts: 'write', place: 'spaceParam', needs: 'chat' },
  { kind: 'agent', method: 'post', path: '/mcp', counts: 'mcp', place: 'none', needs: 'always' },
  { kind: 'agent', method: 'get', path: '/mcp', counts: 'read', place: 'none', needs: 'always' },
  // The set-up agent (plan-admin-agent.md, steps 1 and 2): its own reads, making and changing the spaces it made, the
  // environment's members, and asking an owner about people in a space it made. It reads no module data and no Chat, and
  // nothing in a space. Each route is its own (never PATCH /api/spaces/:id opened to an agent) and takes a fixed body.
  // Anything about people waits for an owner's yes whatever the column says: the box lets it ask, never do. Its MCP door
  // (that plan's step 3) is the same /mcp, which lists it only its own tools (server/mcp.js, SETUP_TOOLS); each tool call
  // comes back through the gate as one of the routes above.
  { kind: 'setup', method: 'get', path: '/api/agent/me', counts: 'read', place: 'none', needs: 'always' },
  { kind: 'setup', method: 'get', path: '/api/agent/templates', counts: 'read', place: 'none', needs: 'always' },
  { kind: 'setup', method: 'get', path: '/api/agent/icons', counts: 'read', place: 'none', needs: 'always' },
  { kind: 'setup', method: 'post', path: '/api/agent/spaces', counts: 'write', place: 'none', needs: 'agentMakeSpaces' },
  { kind: 'setup', method: 'patch', path: '/api/agent/spaces/:id', counts: 'write', place: 'madeParam', needs: 'agentChangeSpaces' },
  { kind: 'setup', method: 'get', path: '/api/agent/people', counts: 'read', place: 'none', needs: 'agentAskPeople' },
  { kind: 'setup', method: 'post', path: '/api/agent/spaces/:id/asks', counts: 'write', place: 'madeParam', needs: 'agentAskPeople' },
  { kind: 'setup', method: 'get', path: '/api/agent/asks/:id', counts: 'read', place: 'none', needs: 'always' },
  { kind: 'setup', method: 'post', path: '/mcp', counts: 'mcp', place: 'none', needs: 'always' },
  { kind: 'setup', method: 'get', path: '/mcp', counts: 'read', place: 'none', needs: 'always' },
].map((entry) => Object.freeze(entry)));

// The rows of the Roles grid only an agent column has (the "Agents" group); people's columns show no box on them, and
// `column` names the one agent column that has a box on it.
const AGENT_ONLY_PERMISSIONS = Object.freeze([
  Object.freeze({ key: 'agentMembers', label: 'See who is in {a space}', group: 'Agents', agentOnly: true, column: 'agent' }),
  // Off by default; with it an agent may ask, never delete: a person approves each ask (plan-agent-edit-delete.md, decision 2).
  Object.freeze({ key: 'agentDelete', label: 'Ask to delete {objects}', group: 'Agents', agentOnly: true, column: 'agent' }),
  Object.freeze({ key: 'agentMakeSpaces', label: 'Make {spaces}', group: 'Agents', agentOnly: true, column: 'setup' }),
  Object.freeze({ key: 'agentChangeSpaces', label: 'Rename and change {spaces}', group: 'Agents', agentOnly: true, column: 'setup' }),
  Object.freeze({ key: 'agentAskPeople', label: 'Ask to add people', group: 'Agents', agentOnly: true, column: 'setup' }),
]);

// The built-in rows the Agent column may ever tick. Every other built-in row is never an agent's (the call, pictures,
// reactions, screen share, asides, private calls, mute, kick, guest links, tags, AI, the images). Module rows are worked
// out from the manifests (agentModuleKeys).
const AGENT_BUILT_IN = Object.freeze(['chatRead', 'chat', 'agentMembers', 'agentDelete']);

// The Agent column as agents work today (decision 5): read Chat and see members on, Send chat messages and Ask to delete off. Module rows
// start at their member default (store.roleSetRaw).
const AGENT_DEFAULTS = Object.freeze({ chatRead: true, chat: false, agentMembers: true, agentDelete: false });

// The rows the set-up agent's column may ever tick: only its own. Every other row, built-in or a module's, is never the
// set-up agent's (it reads nothing in a space). They start off (plan-agent-matrix.md, decision 5): nothing it can do
// until an owner ticks something.
const SETUP_BUILT_IN = Object.freeze(['agentMakeSpaces', 'agentChangeSpaces', 'agentAskPeople']);
const SETUP_DEFAULTS = Object.freeze({ agentMakeSpaces: false, agentChangeSpaces: false, agentAskPeople: false });

// What a set-up agent may do in a day, on top of the agent limits (plan-admin-agent.md, "Limits"): spaces made, and changes
// to the spaces it made (a rename, a description, an icon; one call is one change), and its asks waiting at once.
const SETUP_LIMITS = Object.freeze({ made: 5, changes: 30, waiting: 10 });

// What a set-up agent may ask an owner about a person in a space it made (plan-admin-agent.md, "What it may do"): add them,
// take them off, tick or untick them as the space's moderator. An ask (either kind of agent's) waits AGENT_ASK_DAYS for an
// answer, then expires; a person may undo an agent's direct change (a set-up agent's making, renaming, a description, an
// icon; an ordinary agent's added, edited or deleted object) for AGENT_UNDO_DAYS (plan-agent-edit-delete.md, question 4:
// one number for both kinds).
const SETUP_ASKS = Object.freeze(['add', 'remove', 'moderator']);
// An ordinary agent's delete asks (plan-agent-edit-delete.md, "The contract", 3): at most `waiting` at once and `perDay` in
// 24 hours for each agent, and after a person declines one the same object can't be asked about for `cooldownDays`.
const DELETE_ASK_LIMITS = Object.freeze({ waiting: 10, perDay: 30, cooldownDays: 7 });
const AGENT_ASK_DAYS = 7;
const AGENT_UNDO_DAYS = 7;

// The words a log line keeps for a set-up change (server/agent-log.js `change`): never a name or a description. An ask is
// `ask:<what>`, alone on its line.
const SETUP_CHANGES = Object.freeze(['made', 'renamed', 'described', 'icon']);
const SETUP_ASK_CHANGES = Object.freeze(SETUP_ASKS.map((a) => `ask:${a}`));
// An ordinary agent's delete ask on its log line: never the object, its title or the reason.
const DELETE_ASK_CHANGE = 'ask:delete';

const KINDS = ['agent', 'setup'];
const METHODS = ['get', 'post', 'patch'];
const COUNTS = ['read', 'write', 'mcp'];
const PLACES = ['none', 'spaceParam', 'spaceScope', 'linkRef', 'resolveRefs', 'madeParam'];
// The built-in rows each kind's column may tick.
const TICKABLE = Object.freeze({ agent: AGENT_BUILT_IN, setup: SETUP_BUILT_IN });

// What an agent may ask a module for through the action route (plan-agent-access.md, decision 5): a `write`, never local,
// asker-only, destructive, a delete, without an effect, or kept from AI (`ai: false`). A delete action is asked for through
// its own route and waits for a person (isDeleteAction, below).
const agentMayAsk = (def) => Boolean(def) && !def.local && !def.askerOnly && def.effect === 'write' && def.ai !== false;

// A delete action: declared `effect: "delete"` (server/modules.js holds it to one required pointer to the module's own kind).
const isDeleteAction = (def) => Boolean(def) && def.effect === 'delete';
// The kind a delete action deletes ("ref:travel:plan" -> "plan").
const deleteKindOf = (def) => (isDeleteAction(def) ? String(Object.values(def.input || {})[0] || '').replace(/\?$/, '').split(':')[2] || null : null);
// The module's delete action for `kind`, or null: a kind without one is never deletable by an agent.
const deleteActionFor = (manifest, kind) => (manifest?.actions?.provides || []).find((a) => deleteKindOf(a) === kind && typeof kind === 'string') || null;

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
    if (!KINDS.includes(e.kind)) problems.push(`${name} has no kind (agent or setup)`);
    if (!METHODS.includes(e.method)) problems.push(`${name} has a method other than get, post or patch`);
    if (typeof e.path !== 'string' || !e.path.startsWith('/')) problems.push(`${name} has no path`);
    if (!COUNTS.includes(e.counts)) problems.push(`${name} has no counts (read, write or mcp)`);
    if (!PLACES.includes(e.place)) problems.push(`${name} has no place check`);
    if (e.needs === undefined || e.needs === null || e.needs === '') problems.push(`${name} has no needs`);
    else if (e.needs !== 'module' && e.needs !== 'always' && !(TICKABLE[e.kind] || []).includes(e.needs)) problems.push(`${name} needs "${e.needs}", which is not a row the ${e.kind === 'setup' ? 'set-up agent' : 'agent'} column may tick`);
    // The set-up agent reads no module data: a `module` entry is never its own.
    if (e.kind === 'setup' && e.needs === 'module') problems.push(`${name} needs ${JSON.stringify(e.needs)}, which the set-up agent never has`);
    // madeParam is the set-up agent's alone; the ordinary agent sets up nothing.
    if (e.kind !== 'setup' && e.place === 'madeParam') problems.push(`${name} checks for a space the agent made, which only a set-up agent does`);
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

module.exports = { AGENT_ROUTES, AGENT_ONLY_PERMISSIONS, AGENT_BUILT_IN, AGENT_DEFAULTS, SETUP_BUILT_IN, SETUP_DEFAULTS, SETUP_LIMITS, SETUP_CHANGES, SETUP_ASK_CHANGES, SETUP_ASKS, DELETE_ASK_LIMITS, DELETE_ASK_CHANGE, AGENT_ASK_DAYS, AGENT_UNDO_DAYS, agentMayAsk, isDeleteAction, deleteKindOf, deleteActionFor, agentModuleKeys, agentRouteProblems, assertAgentRoutes };
