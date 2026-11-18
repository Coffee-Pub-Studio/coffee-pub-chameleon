// The layout shapes (documentation/plans/plan-layout-picker.md, step 1): the six arrangements an owner can pick for a
// template's Workspace or for a layout shared with everyone in a space, the one check of a stored shape, and the pure
// answer to "who can't open this module". Nothing else reads this file yet.
//
// A shape is { id, areas, columns, stacked }. `columns` are the widths of the columns beside the chat and call column,
// left to right, as percentages of the view and on the grid of full, halves and thirds (decision 11). `stacked` lists
// the area numbers (counted from 1, left to right, then top to bottom) that share one column, each half its height.
// Every area outside `stacked` is a column of its own, so columns.length is areas - stacked.length, plus one when
// anything is stacked. The shares are fixed here and nowhere else (decision 7): a stored shape holds no widths.
//
// The page has its own copy, public/layout-shapes.js; tools/check-layout-shapes.mjs fails when the two differ, when a
// share is off the grid, and when a shape's columns do not add up to 100.
//
// The stored shape, the same in a template and in a shared layout: { shape: "<id>", areas: ["<module id>" | null, ...] }.
// cleanShape() is the one check, pure, as cleanLayout() is for a free-form layout.
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
]);
const SHAPE_IDS = Object.freeze(SHAPES.map((s) => s.id));
const shapeById = (id) => SHAPES.find((s) => s.id === id) || null;

// A module id: the same rule as a template's modules and a layout's entries (server/layouts.js).
const MODULE_ID = /^[a-z][a-z0-9-]{0,31}$/;
// The chat and the call are the column on the left; they can't be in an area (decision 1).
const COLUMN_IDS = Object.freeze(['chat', 'conference']);
// What can't share a column (NEVER_STACKED in server/layouts.js, plan-panel-stacking.md decision 2) and what reads as a
// composite: the composites' own ids (`dest:`) and the modules they stand in for, which public/composites.js lists as
// `parts`. tools/check-layout-shapes.mjs fails when this list and that one disagree.
const COMPOSITE_PARTS = Object.freeze(['calendar', 'todo', 'maps']);
const NEVER_STACKED = Object.freeze([...COLUMN_IDS, ...COMPOSITE_PARTS]);
const cantStack = (id) => NEVER_STACKED.includes(id) || id.startsWith('dest:');

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const SHAPE_KEYS = ['shape', 'areas'];
const quote = (id) => `"${String(id).slice(0, 40)}"`;

// The one shape check. `input` is { shape, areas }; `modules` is the list of module ids an area may name (a template's
// own, or the ones on in a space); leave it out (or null) and any well-formed id passes; anything else that is not a
// list is refused. `names` is { <id>: <name as a person reads it> } for the sentences; an id without one is shown with
// a capital letter. Returns { shape: { shape, areas } }, or { error } with one sentence saying what is wrong. Anything
// wrong refuses the whole shape.
function cleanShape(input, options) {
  const { modules = null, names = null } = isObject(options) ? options : {};
  if (modules !== null && !Array.isArray(modules)) return { error: `Send the ${words.word('module', { many: true })} an area may hold as a list.` };
  const nameOf = (id) => {
    const given = isObject(names) && Object.hasOwn(names, id) && typeof names[id] === 'string' ? names[id].trim() : '';
    return (given || id.charAt(0).toUpperCase() + id.slice(1)).slice(0, 40);
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
    if (def.stacked.includes(i + 1) && cantStack(id)) return { error: `${nameOf(id)} can't share a column; put it in area 1.` };
    if (seen.has(id)) return { error: `${quote(id)} is in two areas; ${words.word('module', { a: true })} can be in one area only.` };
    seen.add(id);
    areas.push(id);
  }
  return { shape: { shape: def.id, areas } };
}

// Who can't open each module (decision 17), pure. `moduleIds` are the modules to answer for; `manifests` is { <id>:
// manifest } for the ones installed; `rolePermissions` is { moderator, member, guest }, each a set of permissions keyed
// `module.<id>.<key>` as the Roles grid holds them (a role left out reads as having none); `off` lists the ids that
// are off in the place asked about. A module everyone can open is not in the answer. A module that is off or not
// installed answers { off: true }. Otherwise { roles: [...] }, the roles whose permissions lack the module's read
// permission, in the order moderator, member, guest. An owner and the admin open everything, so they are never listed.
// A moderator's own grant for one space only adds to a role's permissions (store.spacePermissions merges in the
// Moderator role's ticks that are on), so it can never take a read away; there is no list of people.
const ROLES_LISTED = Object.freeze(['moderator', 'member', 'guest']);
function whoCantOpen(moduleIds, options) {
  const o = isObject(options) ? options : {};
  const manifests = isObject(o.manifests) ? o.manifests : {};
  const rolePermissions = isObject(o.rolePermissions) ? o.rolePermissions : {};
  const off = Array.isArray(o.off) ? o.off : [];
  const out = {};
  // defineProperty, so an id such as __proto__ is an entry and not the answer's prototype.
  const put = (id, value) => Object.defineProperty(out, id, { value, enumerable: true, writable: true, configurable: true });
  for (const id of Array.isArray(moduleIds) ? moduleIds : []) {
    const manifest = typeof id === 'string' && Object.hasOwn(manifests, id) ? manifests[id] : null;
    if (!isObject(manifest) || off.includes(id)) { put(id, { off: true }); continue; }
    const guard = isObject(manifest.access) ? manifest.access.read : null;
    if (!guard) continue;
    const key = `module.${id}.${guard}`;
    const roles = ROLES_LISTED.filter((r) => !(isObject(rolePermissions[r]) && rolePermissions[r][key]));
    if (roles.length) put(id, { roles });
  }
  return out;
}

module.exports = { SHAPES, SHAPE_IDS, GRID, COLUMN_IDS, COMPOSITE_PARTS, shapeById, cleanShape, whoCantOpen };
