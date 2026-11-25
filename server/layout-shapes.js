// The layout shapes (documentation/plans/plan-layout-picker.md, step 1; plan-workspaces.md, decision 42): the nine
// arrangements a template's Workspace, a layout shared with everyone in a space or a person's own workspace can take,
// the one check of a stored shape, and the pure answer to "who can't open this module".
//
// A shape is { id, areas, columns, stacked }. `columns` are the widths of the columns beside the chat and call column,
// left to right, as percentages of the view and on the grid of full, halves and thirds (decision 11). `stacked` lists
// the area numbers (counted from 1, left to right, then top to bottom) that share a column, in pairs: each two in turn
// are one column, each half its height (a stack is two areas; Quarters has two such columns). Every area outside
// `stacked` is a column of its own, so columns.length is areas - stacked.length / 2. The shares are fixed here and
// nowhere else (decision 7): a stored shape holds no widths.
//
// The page has its own copy, public/layout-shapes.js; tools/check-layout-shapes.mjs fails when the two differ, when a
// share is off the grid, and when a shape's columns do not add up to 100.
//
// The stored shape, the same in a template and in a shared layout: { shape: "<id>", areas: ["<module id>" | null, ...] }.
// cleanShape() is the one check, pure; cleanLayout() (server/layouts.js) wraps it for a layout for everyone.
'use strict';

const words = require('./words');

const THIRD = 100 / 3;
const TWO_THIRDS = 200 / 3;
// The grid every share is on: full, halves and thirds.
const GRID = Object.freeze([100, 50, TWO_THIRDS, THIRD]);

const SHAPES = Object.freeze([
  Object.freeze({ id: 'one', areas: 1, columns: Object.freeze([100]), stacked: Object.freeze([]) }),
  Object.freeze({ id: 'two-equal', areas: 2, columns: Object.freeze([50, 50]), stacked: Object.freeze([]) }),
  Object.freeze({ id: 'wide-narrow', areas: 2, columns: Object.freeze([TWO_THIRDS, THIRD]), stacked: Object.freeze([]) }),
  Object.freeze({ id: 'three-equal', areas: 3, columns: Object.freeze([THIRD, THIRD, THIRD]), stacked: Object.freeze([]) }),
  Object.freeze({ id: 'tall-split', areas: 3, columns: Object.freeze([50, 50]), stacked: Object.freeze([2, 3]) }),
  Object.freeze({ id: 'wide-split', areas: 3, columns: Object.freeze([TWO_THIRDS, THIRD]), stacked: Object.freeze([2, 3]) }),
  // For wide monitors (plan-workspaces.md, decision 42): two full-height areas and a stack of two, on thirds, either way
  // round; and four areas, two stacks of two side by side.
  Object.freeze({ id: 'two-large-right-split', areas: 4, columns: Object.freeze([THIRD, THIRD, THIRD]), stacked: Object.freeze([3, 4]) }),
  Object.freeze({ id: 'two-large-left-split', areas: 4, columns: Object.freeze([THIRD, THIRD, THIRD]), stacked: Object.freeze([1, 2]) }),
  Object.freeze({ id: 'quarters', areas: 4, columns: Object.freeze([50, 50]), stacked: Object.freeze([1, 2, 3, 4]) }),
]);
const SHAPE_IDS = Object.freeze(SHAPES.map((s) => s.id));
const shapeById = (id) => SHAPES.find((s) => s.id === id) || null;

// A module id: the same rule as a template's modules and a layout's entries (server/layouts.js).
const MODULE_ID = /^[a-z][a-z0-9-]{0,31}$/;
// The chat and the call are the column on the left; they can't be in an area (decision 1).
const COLUMN_IDS = Object.freeze(['chat', 'conference']);
// What can't share a column in a stacked area: the composites (public/composites.js) and what stands in for them.
// The conference and Chat never stack either: they are the column (COLUMN_IDS), refused in any area. A shape names modules,
// and a module reads as a composite while the composite is on:
//   calendar        folds into dest:calendar only where the Calendar is on. To-do is always an ordinary module with its own
//                   window (plan-todo-list.md); the Calendar's To-do panel is the `inCalendar` setting, not a fold.
//   maps            is a composite only where the Map answered (`ask: true` there: it needs a map file), which the server
//                   does not know here, so Maps is always refused in a stacked area.
// The Calendar's own id is always refused: naming it means it is on. `on` (cleanShape) says which modules are on.
// tools/check-layout-shapes.mjs checks this against aliasesFor() in public/composites.js.
const COMPOSITE_PARTS = Object.freeze(['calendar', 'maps']);
const ALWAYS_COMPOSITE = Object.freeze(['calendar', 'maps']);
// The name a person reads when the caller passes none; a module's own name (its manifest's) is better.
const FALLBACK_NAMES = Object.freeze({ todo: 'To-do' });
// Whether `id` reads as a composite given `on`, the ids of the modules on (null: not known, so the parts all count).
const readsAsComposite = (id, on) => id.startsWith('dest:') || ALWAYS_COMPOSITE.includes(id) || (COMPOSITE_PARTS.includes(id) && (!on || on.includes('calendar')));

// The sentence for a module that can't share a column in a stacked area: where it can go in this shape instead.
function stackedRefusal(name, def) {
  const open = [];
  for (let a = 1; a <= def.areas; a += 1) if (!def.stacked.includes(a)) open.push(a);
  if (!open.length) return `${name} can't share a column, and every area of this shape does; pick another shape.`;
  return `${name} can't share a column; put it in area ${open.length > 1 ? `${open.slice(0, -1).join(', ')} or ${open[open.length - 1]}` : open[0]}.`;
}

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const SHAPE_KEYS = ['shape', 'areas'];
const quote = (id) => `"${String(id).slice(0, 40)}"`;

// The one shape check. `input` is { shape, areas }; `modules` is the list of module ids an area may name (a template's
// own, or the ones on in a space); leave it out (or null) and any well-formed id passes; anything else that is not a
// list is refused. `names` is { <id>: <name as a person reads it> } for the sentences; an id without one is shown with
// a capital letter (To-do for `todo`). Returns { shape: { shape, areas } }, or { error } with one sentence saying what is wrong. Anything
// wrong refuses the whole shape. `on` is the ids of the modules on where the shape will be used; it decides whether
// Calendar and To-do read as a composite (see above). Left out, it is `modules`; with neither, they all count.
function cleanShape(input, options) {
  const { modules = null, names = null, on: onGiven = null } = isObject(options) ? options : {};
  const on = Array.isArray(onGiven) ? onGiven : modules;
  if (modules !== null && !Array.isArray(modules)) return { error: `Send the ${words.word('module', { many: true })} an area may hold as a list.` };
  const nameOf = (id) => {
    const given = isObject(names) && Object.hasOwn(names, id) && typeof names[id] === 'string' ? names[id].trim() : '';
    return (given || FALLBACK_NAMES[id] || id.charAt(0).toUpperCase() + id.slice(1)).slice(0, 40);
  };
  if (!isObject(input)) return { error: 'Send the layout as a shape and its areas.' };
  const extra = Object.keys(input).find((k) => !SHAPE_KEYS.includes(k));
  if (extra) return { error: `A shape does not take ${quote(extra)}; it is a shape and its areas.` };
  const def = typeof input.shape === 'string' ? shapeById(input.shape) : null;
  if (!def) return { error: 'Pick a shape from the list.' };
  if (!Array.isArray(input.areas) || input.areas.length !== def.areas) return { error: `This shape has ${def.areas} ${def.areas === 1 ? 'area' : 'areas'}.` };
  const seen = new Set();
  const areas = [];
  for (let i = 0; i < input.areas.length; i += 1) {
    const id = input.areas[i];
    if (id === null) { areas.push(null); continue; }
    if (typeof id !== 'string') return { error: `Area ${i + 1} takes ${words.word('module', { a: true })} or nothing.` };
    if (COLUMN_IDS.includes(id)) return { error: "The chat and the call are in the column on the left; they can't go in an area." };
    if (!MODULE_ID.test(id) || (modules && !modules.includes(id))) return { error: `${quote(id)} is not ${words.word('module', { a: true })} you can use here.` };
    if (def.stacked.includes(i + 1) && readsAsComposite(id, on)) return { error: stackedRefusal(nameOf(id), def) };
    if (seen.has(id)) return { error: `${quote(id)} is in two areas; ${words.word('module', { a: true })} can be in one area only.` };
    seen.add(id);
    areas.push(id);
  }
  return { shape: { shape: def.id, areas } };
}

// The composites (public/composites.js COMPOSITES, which tools/check-layout-shapes.mjs checks this against with aliasesFor):
// while a composite's `main` is on, each of its other `parts` opens as the composite, which is the main's page. So a layout
// naming `calendar` opens the Calendar. To-do has no composite: it opens as itself under its own read permission. The Map's composite has only its main, so it changes nothing here.
const COMPOSITES = Object.freeze([
  Object.freeze({ main: 'calendar', parts: Object.freeze(['calendar']) }),
  Object.freeze({ main: 'maps', parts: Object.freeze(['maps']) }),
]);
// The main module `id` folds into while it is on, or null. `on` lists the ids on in the place (not known: nothing folds).
const foldsInto = (id, on) => COMPOSITES.find((c) => c.main !== id && c.parts.includes(id) && Array.isArray(on) && on.includes(c.main))?.main || null;

// Whether someone whose permissions are `permissions` (keyed `module.<id>.<key>`) opens the area that names `id`, pure,
// as the page does: through the composite's main when `id` folds into it and they can read the main, else as the module
// itself when it is on and they can read it. `manifests` is { <id>: manifest } for the ones installed; `on` the ids on in
// the place and `off` the ids that are off there (a module not installed is off).
function canOpenArea(id, { manifests, permissions, on = null, off = [] } = {}) {
  const mans = isObject(manifests) ? manifests : {};
  const perms = isObject(permissions) ? permissions : {};
  const own = (x) => (typeof x === 'string' && Object.hasOwn(mans, x) && isObject(mans[x]) ? mans[x] : null);
  const reads = (x) => {
    const m = own(x);
    if (!m) return false;
    const guard = isObject(m.access) ? m.access.read : null;
    return !guard || Boolean(perms[`module.${x}.${guard}`]);
  };
  const gone = (x) => !own(x) || (Array.isArray(off) && off.includes(x));
  const main = foldsInto(id, on);
  if (main && !gone(main) && reads(main)) return true;
  return !gone(id) && reads(id);
}

// Who can't open each module (decision 17), pure. `moduleIds` are the modules to answer for; `manifests` is { <id>:
// manifest } for the ones installed; `rolePermissions` is { moderator, member, guest }, each a set of permissions keyed
// `module.<id>.<key>` as the Roles grid holds them (a role left out reads as having none); `off` lists the ids that
// are off in the place asked about; `on` the ids that are on there (it decides which modules fold into a composite, see
// canOpenArea; left out, none do). A module everyone can open is not in the answer. A module that is off or not
// installed, and not opened through a composite by anyone, answers { off: true }. Otherwise { roles: [...] }, the roles
// that can't open it, in the order moderator, member, guest. What a role opens is what the page opens for it: the Calendar's rights are the Calendar's. An owner and the admin open everything, so they are never
// listed. A moderator's own grant for one space only adds to a role's permissions (store.spacePermissions merges in the
// Moderator role's ticks that are on), so it can never take a read away; there is no list of people.
const ROLES_LISTED = Object.freeze(['moderator', 'member', 'guest']);
function whoCantOpen(moduleIds, options) {
  const o = isObject(options) ? options : {};
  const manifests = isObject(o.manifests) ? o.manifests : {};
  const rolePermissions = isObject(o.rolePermissions) ? o.rolePermissions : {};
  const off = Array.isArray(o.off) ? o.off : [];
  const on = Array.isArray(o.on) ? o.on : null;
  const out = {};
  // defineProperty, so an id such as __proto__ is an entry and not the answer's prototype.
  const put = (id, value) => Object.defineProperty(out, id, { value, enumerable: true, writable: true, configurable: true });
  for (const id of Array.isArray(moduleIds) ? moduleIds : []) {
    const manifest = typeof id === 'string' && Object.hasOwn(manifests, id) ? manifests[id] : null;
    const gone = !isObject(manifest) || off.includes(id);
    const main = foldsInto(id, on);
    const mainThere = Boolean(main) && Object.hasOwn(manifests, main) && !off.includes(main);
    if (gone && !mainThere) { put(id, { off: true }); continue; }
    const roles = ROLES_LISTED.filter((r) => !canOpenArea(id, { manifests, permissions: isObject(rolePermissions[r]) ? rolePermissions[r] : {}, on, off }));
    if (roles.length) put(id, { roles });
  }
  return out;
}

module.exports = { COMPOSITES, foldsInto, canOpenArea, SHAPES, SHAPE_IDS, GRID, COLUMN_IDS, COMPOSITE_PARTS, shapeById, cleanShape, whoCantOpen };
