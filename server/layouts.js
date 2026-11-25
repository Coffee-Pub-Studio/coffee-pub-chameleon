// Layouts for everyone (documentation/plans/plan-saved-layouts.md, step 1; plan-layout-picker.md, decision 5): a space's
// shared layouts, kept on the server so they reach everyone in it. One file per environment, DATA_DIR/layouts.json (so the
// environment's export and the host console's backup, which zip the whole data folder, carry it):
//
//   { "spaces": { "<space id>": { "shared": [layout],
//                                  "system": { "<user key>": { ... } },
//                                  "last": { "<user key>": { "layout": "<layout id>", "at": <ms> } } } } }
//
// A person's own layouts and favorites are gone (plan-workspaces.md, decision 44): a person adds a workspace instead
// (server/workspaces.js), which is a tab. A file's old `people` and `favorites` keys are dropped on read.
//
// system (documentation/plans/plan-layout-views.md, step 1): the system layouts `workspace`, `calendar`, `map`,
// `conference`, `whiteboard`, `documents` and `schedule` are never stored; server/index.js makes them per space from what is on. What is stored is each person's own choices for
// them, per space: "system": { "<user key>": { "<system id>": { "name"?, "icon"?, "tab"?: false } } }.
// last (documentation/plans/plan-workspaces.md, decision 20, step 11): the layout each signed-in person last used in a
// space, so entering the space can open it: "last": { "<user key>": { "layout": "<layout id>", "at": <ms> } }. One entry per
// person per space, about 100 bytes, no history; the server writes `at`. `layout` is a system id or a saved layout the
// person can see, or a workspace the person added (`w` and six characters; whether it is still there is the route's,
// server/workspaces.js). remove() clears the entries that name a deleted layout; forgetPerson() and forgetSpace() clear the rest;
// the key is left out of a space's entry while nobody there has one. A guest has none. It is personal state, so an owner's
// environment copy leaves it out (server/environment-export.js).
// A user layout may carry an `icon`; one stored without reads as kind `user` with the default icon.
//
// cleanLayout() still reads a free-form layout ({ name, modules, snap?, arrange? }: the canvas's own words for an
// arrangement, which the stack rules are written against); a route takes only a shared one (POST answers 400 otherwise).
// A shared layout (for everyone in a space) is a shape and its areas, { id, name, by, at, shape, areas, icon? }
// (documentation/plans/plan-layout-picker.md, decision 5): it has no modules, snap or arrange, and a stored shared entry
// that is not a valid shape is dropped on read (nothing is converted or rewritten until the next save). cleanLayout()
// is the one shape check, pure; the Layouts class keeps the lists, their limits and the clean-up when a space or a
// person is removed (server/store.js calls forgetSpace and forgetPerson). Each workspace's remembered arrangement is
// server/workspaces.js's, separate from these. An aside has no layouts: index.js only finds spaces.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const words = require('./words');
const { cleanShape, COLUMN_IDS } = require('./layout-shapes');

const LAYOUT_LIMITS = Object.freeze({
  shared: 10, // per space
  name: 40, // characters, after trimming
  modules: 20, // entries in a layout's modules, the most a layout holds
  dockWMin: 160,
  dockWMax: 2000,
  pitchMin: 50, // the snap grid's pitch in pixels, as the canvas's SNAP_PITCH
  pitchMax: 320,
  stackMax: 3, // modules in one stack (plan-panel-stacking.md decision 3)
  stackHMin: 0.1, // a section's share of its column's height
  stackHMax: 0.9,
  stackHSum: 0.01, // the shares must add up to 1, within this
});
// Never stacked (plan-panel-stacking.md decision 2): the conference, Chat and the composites (dest:*; their ':' fails
// MODULE_ID, so they never reach a layout, but the rule is kept here in words).
const NEVER_STACKED = Object.freeze(['conference', 'chat']);
const stackable = (id) => !NEVER_STACKED.includes(id) && !id.startsWith('dest:');
const STACK_ID = /^[a-z0-9]{1,32}$/;
// The system layouts' stable ids (a user layout's is `l` and six characters, so they never collide) and their default
// icons; a user layout's default icon is the Layout button's.
// The fixed set, in the default order (documentation/plans/plan-workspaces.md, "The fixed set"); Conference, Whiteboards and
// Documents come after the three that were there, and Projects (the `schedule` module, Planner - Projects, opened large; Thomas,
// 2026-11-23, over decision 19) after them. Icons: each module's own, a video glyph for Conference (decision 23).
const SYSTEM_IDS = Object.freeze(['workspace', 'calendar', 'map', 'conference', 'whiteboard', 'documents', 'schedule']);
const SYSTEM_ICONS = Object.freeze({ workspace: 'columns', calendar: 'calendar-days', map: 'map-location-dot', conference: 'video', whiteboard: 'chalkboard', documents: 'file-lines', schedule: 'diagram-project' });
const USER_ICON = 'object-group';
const ICON_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
// A module id: the same rule as a template's module ids (server/layout-shapes.js).
const MODULE_ID = /^[a-z][a-z0-9-]{0,31}$/;
const MODES = ['dock', 'float'];
const TOP_KEYS = ['name', 'shared', 'modules', 'snap', 'icon', 'arrange'];
// A shared layout is a shape and its areas; these are the keys only a free-form (personal) layout takes, and the two only a shape takes.
const FREE_FORM_KEYS = ['modules', 'snap', 'arrange'];
const SHAPE_KEYS = ['shape', 'areas'];
const ARRANGES = ['dock', 'window'];
const MODULE_KEYS = ['id', 'mode', 'dockW', 'box', 'snap', 'stack', 'at', 'h', 'folded'];
const BOX_KEYS = ['x', 'y', 'w', 'h'];
const SNAP_KEYS = ['all', 'pitch'];
const LAST_ID_MAX = 64; // a layout id as `last` keeps it
const ADDED_WORKSPACE_ID = /^w[a-z0-9]{6}$/; // a workspace a person added (server/workspaces.js), as `last` may name
const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isFraction = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const many = (key) => words.word(key, { many: true });

// A stack (plan-panel-stacking.md, decision 4): a column of the canvas holding 2 or 3 docked modules one above the
// other. It is carried on the members' own entries in `modules`, with four optional keys:
//   stack   the stack's id, 1 to 32 characters of [a-z0-9]; members with the same id share one column
//   at      the member's place in the stack, 0 (top) to 2
//   h       the member's share of the column's height, 0.1 to 0.9; the members' shares add up to 1 (within 0.01)
//   folded  true when the member is collapsed
// A stack's width is the `dockW` of its members as for any docked module. An entry with none of the four is an
// ordinary column, so layouts saved before stacks are unchanged. Stack keys are cleaned, never refused (cleanStacks):
// a stack key on a float, the conference, Chat or a composite is dropped; a stack of one member, and members past the
// third, become ordinary columns; members are put in `at` order (list order where `at` is missing or repeats), kept
// together at the place of the stack's first member, and renumbered 0, 1, 2; `h` is kept (clamped to 0.1 to 0.9, rounded
// to 4 places) only when every member has one and they add up to 1 within 0.01, else all are dropped (equal heights);
// `folded` is kept only as true or false. The 20 entry limit counts every member (Opens with names every module too);
// the server knows no column limit, so a stack being one column against the docked limit is the page's.
function cleanStacks(entries) {
  const groups = new Map();
  entries.forEach((e, i) => {
    const { stack } = e.raw;
    if (e.kept.mode !== 'dock' || !stackable(e.kept.id) || typeof stack !== 'string' || !STACK_ID.test(stack)) return;
    if (!groups.has(stack)) groups.set(stack, []);
    groups.get(stack).push(i);
  });
  const placed = new Map(); // index of a stack's first member -> its cleaned, ordered members
  const inStack = new Set();
  for (const idx of groups.values()) {
    const stack = entries[idx[0]].raw.stack;
    const atOf = (i) => { const a = entries[i].raw.at; return Number.isInteger(a) && a >= 0 && a < LAYOUT_LIMITS.stackMax ? a : Infinity; };
    const order = idx.map((i, n) => ({ i, n, at: atOf(i) }));
    order.sort((a, b) => (a.at === b.at ? a.n - b.n : a.at - b.at));
    const members = order.slice(0, LAYOUT_LIMITS.stackMax).map((o) => o.i);
    if (members.length < 2) continue;
    const hs = members.map((i) => entries[i].raw.h);
    // Kept only when the members' own values add up to 1, checked before they are clamped.
    const sound = hs.every((h) => typeof h === 'number' && Number.isFinite(h)) && Math.abs(hs.reduce((a, b) => a + b, 0) - 1) <= LAYOUT_LIMITS.stackHSum + 1e-9;
    const heights = sound ? hs.map((h) => Math.round(Math.min(LAYOUT_LIMITS.stackHMax, Math.max(LAYOUT_LIMITS.stackHMin, h)) * 10000) / 10000) : null;
    members.forEach((i, at) => {
      const k = entries[i].kept;
      k.stack = stack;
      k.at = at;
      if (sound) k.h = heights[at];
      if (typeof entries[i].raw.folded === 'boolean') k.folded = entries[i].raw.folded;
      inStack.add(i);
    });
    placed.set(Math.min(...members), members);
  }
  const out = [];
  entries.forEach((e, i) => {
    if (placed.has(i)) placed.get(i).forEach((m) => out.push(entries[m].kept));
    else if (!inStack.has(i)) out.push(e.kept); // an entry cut from a stack stays, an ordinary column
  });
  return out;
}

// A layout's name as it is kept: control characters out, whitespace collapsed, trimmed.
function cleanName(value) {
  return typeof value === 'string' ? value.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim() : '';
}

// The text of a module id as a sentence may show it: printable ASCII, short.
// Each character that is not printable ASCII shows as ?, so an id is never shown as another id; one with nothing printable
// in it has no text to show (hasText false).
const plainId = (id) => [...String(id)].map((c) => (/[\x20-\x7e]/.test(c) ? c : '?')).join('').slice(0, 40);
const hasText = (id) => /[\x20-\x7e]/.test(String(id));
const notAModule = (id) => (hasText(id) ? `"${plainId(id)}" is not ${words.word('module', { a: true })} you can use here.` : `That id is not ${words.word('module', { a: true })} you can use here.`);

// The check of a shared layout's shape (decision 5), pure: `input` is { shape, areas } as a request sends them. `options`
// is { modules, on, names }: the ids an area may name (the modules on in the space with a place on the canvas), the ids
// that are on (decides whether the Calendar reads as a composite; layout-shapes.js), and { <id>: <name as the space
// shows it> } for every module installed. Left out, any well-formed id passes. Answers { shape: { shape, areas } }, or
// { problems: [sentence...], parts: ['shape' | 'areas', ...] }, one plain sentence each: an id that is not text-safe is
// quoted plain and short, a module is named as the space shows it, and a module listed twice is named once.
function checkShape(input, options) {
  const { modules = null, on = null, names = null, noArea = null } = isObject(options) ? options : {};
  const shown = Object.assign(Object.create(null), isObject(names) ? names : {});
  const nameOf = (id) => (typeof shown[id] === 'string' && shown[id].trim() ? shown[id].replace(/\p{Cc}/gu, ' ').trim().slice(0, 40) : plainId(id));
  const areas = isObject(input) && Array.isArray(input.areas) ? input.areas : [];
  const strings = areas.filter((id) => typeof id === 'string' && !COLUMN_IDS.includes(id));
  const problems = [];
  const parts = [];
  const say = (text, part) => { problems.push(text); parts.push(part); };
  if (Array.isArray(modules)) {
    for (const id of new Set(strings.filter((i) => !MODULE_ID.test(i) || !modules.includes(i)))) {
      if (!MODULE_ID.test(id) || typeof shown[id] !== 'string') say(notAModule(id), 'areas');
      else if (Array.isArray(noArea) && noArea.includes(id)) say(`${nameOf(id)} can't go in an area.`, 'areas');
      else say(`${nameOf(id)} is not available in this ${words.word('space')}.`, 'areas');
    }
  }
  const twice = [...new Set(strings.filter((id, i) => MODULE_ID.test(id) && strings.indexOf(id) !== i && (!Array.isArray(modules) || modules.includes(id))))];
  for (const id of twice) say(`${nameOf(id)} is in two areas; ${words.word('module', { a: true })} can be in one area only.`, 'areas');
  if (problems.length) return { problems, parts };
  const out = cleanShape({ shape: isObject(input) ? input.shape : undefined, areas: isObject(input) ? input.areas : undefined }, { modules, on, names: shown });
  if (out.error) return { problems: [out.error], parts: [/^(Pick a shape|A shape does not take|Send the layout)/.test(out.error) ? 'shape' : 'areas'] };
  return { shape: out.shape };
}

// The one shape check, pure. `input` is what a request sends. A personal layout: { name, shared?, modules, snap?, icon?,
// arrange? }. A layout for everyone (`shared: true`): { name, shared: true, shape, areas, icon? }, a shape and its areas,
// checked by cleanShape against `shapeOptions` ({ modules, on, names }; see checkShape); it takes no modules, snap or
// arrange, and a personal layout takes no shape or areas (plan-layout-picker.md, decisions 5 and 15). With `partial` (a
// PUT) any of name, modules (personal), shape with areas (shared) and snap may be left out, `shared` is not taken and
// the option `shared` says which kind the layout being changed is. `icons`, when given, is the list of icon ids an
// `icon` must come from. Returns { layout } with only the fields given, cleaned (numbers of pixels rounded), or
// { error, problems, parts } with one sentence saying what is wrong (`problems` all the sentences, `parts` the field
// each is about, as a template's refusal); anything wrong refuses the whole layout.
function cleanLayout(input, { partial = false, icons = null, shared: sharedKind = false, shapeOptions = null } = {}) {
  const out = cleanLayoutParts(input, { partial, icons, sharedKind, shapeOptions });
  if (out.layout) return out;
  const problems = out.problems || [out.error];
  return { error: problems[0], problems, parts: out.parts || [out.part ?? null] };
}
function cleanLayoutParts(input, { partial, icons, sharedKind, shapeOptions }) {
  const no = (error, part = null) => ({ error, part });
  if (!isObject(input)) return no(`Send the layout as JSON: a name and the ${many('module')} it opens.`);
  const allowed = [...(partial ? TOP_KEYS.filter((k) => k !== 'shared') : TOP_KEYS), ...SHAPE_KEYS];
  const extra = Object.keys(input).find((k) => !allowed.includes(k));
  if (extra) return no(partial && extra === 'shared' ? 'A saved layout cannot be moved between your own and the shared ones; save it again instead.' : `A layout does not take ${JSON.stringify(plainId(extra))}.`, null);
  const out = {};

  if (!partial || input.name !== undefined) {
    if (input.name !== undefined && typeof input.name !== 'string') return no('A layout\'s name must be text.', 'name');
    const name = cleanName(input.name);
    if (!name) return no('Give the layout a name.', 'name');
    if ([...name].length > LAYOUT_LIMITS.name) return no(`A layout's name can be at most ${LAYOUT_LIMITS.name} characters.`, 'name');
    out.name = name;
  }

  if (!partial && input.shared !== undefined) {
    if (typeof input.shared !== 'boolean') return no('Say whether the layout is shared with true or false.', 'shared');
    out.shared = input.shared;
  }
  const shared = partial ? Boolean(sharedKind) : input.shared === true;

  if (shared) {
    const free = FREE_FORM_KEYS.find((k) => input[k] !== undefined);
    if (free) return no('A layout for everyone is a shape; pick one with the picker.', 'shape');
    if (!partial || input.shape !== undefined || input.areas !== undefined) {
      const checked = checkShape(input, shapeOptions);
      if (!checked.shape) return { error: checked.problems[0], problems: checked.problems, parts: checked.parts };
      out.shape = checked.shape.shape;
      out.areas = checked.shape.areas;
    }
  } else {
    const shapeKey = SHAPE_KEYS.find((k) => input[k] !== undefined);
    if (shapeKey) return no(`Only a layout for everyone is a shape; a layout of your own is saved as it is on the ${words.word('canvas')}.`, 'shape');
  }

  if (!shared && (!partial || input.modules !== undefined)) {
    if (!Array.isArray(input.modules)) return no(`List the ${many('module')} the layout opens (an empty list is a blank layout).`, 'modules');
    if (input.modules.length > LAYOUT_LIMITS.modules) return no(`A layout can hold at most ${LAYOUT_LIMITS.modules} ${many('module')}.`, 'modules');
    const seen = new Set();
    const entries = [];
    for (const entry of input.modules) {
      if (!isObject(entry)) return no(`Each ${words.word('module')} in a layout needs an id and a mode.`, 'modules');
      const id = entry.id;
      if (typeof id !== 'string' || !MODULE_ID.test(id)) return no(`${JSON.stringify(typeof id === 'string' ? plainId(id) : id ?? null)} is not ${words.word('module', { a: true })} id.`, 'modules');
      if (seen.has(id)) return no(`"${id}" is listed twice in the layout.`, 'modules');
      seen.add(id);
      const unknown = Object.keys(entry).find((k) => !MODULE_KEYS.includes(k));
      if (unknown) return no(`"${id}": a layout does not keep ${JSON.stringify(plainId(unknown))}.`, 'modules');
      if (!MODES.includes(entry.mode)) return no(`"${id}": mode must be dock or float.`, 'modules');
      const kept = { id, mode: entry.mode };
      if (entry.dockW !== undefined) {
        const w = entry.dockW;
        if (typeof w !== 'number' || !Number.isFinite(w) || w < LAYOUT_LIMITS.dockWMin || w > LAYOUT_LIMITS.dockWMax) {
          return no(`"${id}": dockW must be a width in pixels from ${LAYOUT_LIMITS.dockWMin} to ${LAYOUT_LIMITS.dockWMax}.`, 'modules');
        }
        kept.dockW = Math.round(w);
      }
      if (entry.box !== undefined) {
        const b = entry.box;
        const bad = !isObject(b) || Object.keys(b).some((k) => !BOX_KEYS.includes(k)) || !BOX_KEYS.every((k) => isFraction(b[k])) || b.w === 0 || b.h === 0;
        if (bad) return no(`"${id}": box must be { x, y, w, h }, each a fraction of the ${words.word('canvas')} from 0 to 1, with w and h above 0.`, 'modules');
        kept.box = { x: b.x, y: b.y, w: b.w, h: b.h };
      }
      if (entry.snap !== undefined) {
        if (typeof entry.snap !== 'boolean') return no(`"${id}": snap must be true or false.`, 'modules');
        kept.snap = entry.snap;
      }
      entries.push({ kept, raw: entry });
    }
    out.modules = cleanStacks(entries);
  }

  if (input.arrange !== undefined) {
    if (!ARRANGES.includes(input.arrange)) return no('Arrange must be dock or window.', 'arrange');
    out.arrange = input.arrange;
  }

  if (input.icon !== undefined) {
    const bad = typeof input.icon !== 'string' || !ICON_RE.test(input.icon) || (Array.isArray(icons) && !icons.includes(input.icon));
    if (bad) return no('Pick an icon from the list.', 'icon');
    out.icon = input.icon;
  }

  if (input.snap !== undefined) {
    const s = input.snap;
    const pitch = s?.pitch;
    const bad = !isObject(s) || Object.keys(s).some((k) => !SNAP_KEYS.includes(k)) || typeof s.all !== 'boolean'
      || typeof pitch !== 'number' || !Number.isFinite(pitch) || pitch < LAYOUT_LIMITS.pitchMin || pitch > LAYOUT_LIMITS.pitchMax;
    if (bad) return no(`A layout's snap must be { all, pitch }, with all true or false and pitch from ${LAYOUT_LIMITS.pitchMin} to ${LAYOUT_LIMITS.pitchMax} pixels.`, 'snap');
    out.snap = { all: s.all, pitch: Math.round(pitch) };
  }
  return { layout: out };
}

// A person's change to a system layout, pure: { name?, icon?, tab? }. `name` and `icon` null go back to the default;
// `tab` is true or false. Returns { patch } cleaned or { error } with one sentence. Whether `tab: false` is allowed
// for that layout (never for the Workspace) is the route's.
function cleanSystemPatch(input, { icons = null } = {}) {
  if (!isObject(input)) return { error: 'Send the change as JSON: a name, an icon or whether it is a tab.' };
  const extra = Object.keys(input).find((k) => !['name', 'icon', 'tab'].includes(k));
  if (extra) return { error: `A system layout does not take "${extra}".` };
  const patch = {};
  if (input.name !== undefined) {
    if (input.name === null) patch.name = null;
    else {
      if (typeof input.name !== 'string') return { error: 'A layout\'s name must be text.' };
      const name = cleanName(input.name);
      if (!name) return { error: 'Give the layout a name.' };
      if ([...name].length > LAYOUT_LIMITS.name) return { error: `A layout's name can be at most ${LAYOUT_LIMITS.name} characters.` };
      patch.name = name;
    }
  }
  if (input.icon !== undefined) {
    if (input.icon === null) patch.icon = null;
    else if (typeof input.icon !== 'string' || !ICON_RE.test(input.icon) || (Array.isArray(icons) && !icons.includes(input.icon))) return { error: 'Pick an icon from the list.' };
    else patch.icon = input.icon;
  }
  if (input.tab !== undefined) {
    if (typeof input.tab !== 'boolean') return { error: 'Say whether the layout is a tab with true or false.' };
    patch.tab = input.tab;
  }
  if (!Object.keys(patch).length) return { error: 'Send a new name, an icon, or whether it is a tab.' };
  return { patch };
}

// The owner's tabs on a space record (plan-workspaces.md, "Data"): { order?: [ids], hide?: [ids] }, ids from SYSTEM_IDS.
// `order` is the owner's order (every known id left out is added at the end in the default order; stored whole, and only
// when it differs from the default); `hide` is the ids not in the bar for anyone (never `workspace`; kept in the default
// order; left out while empty). Nothing set (or equal to the defaults) is null. Pure.
//   strict (a PATCH): anything wrong is refused with { error } -- one sentence: not an object, a key other than order and
//     hide, not a list, more ids than there are layouts, an unknown id, an id listed twice, `workspace` in hide.
//   lenient (what is read from the file or an import): wrong keys, unknown ids, repeats and `workspace` in hide are dropped.
// Answers { tabs } (an object or null) or { error }.
const TABS_KEYS = ['order', 'hide'];
function cleanTabs(input, { strict = false } = {}) {
  if (input === null || input === undefined) return { tabs: null };
  if (!isObject(input)) return strict ? { error: 'Send the tabs as { order, hide }, each a list of layout ids.' } : { tabs: null };
  if (strict) {
    const extra = Object.keys(input).find((k) => !TABS_KEYS.includes(k));
    if (extra) return { error: `The tabs do not take "${extra}".` };
  }
  const lists = {};
  for (const key of TABS_KEYS) {
    const raw = input[key];
    if (raw === undefined || raw === null) { lists[key] = []; continue; }
    if (!Array.isArray(raw)) {
      if (strict) return { error: `The ${key} must be a list of layout ids.` };
      lists[key] = [];
      continue;
    }
    if (strict && raw.length > SYSTEM_IDS.length) return { error: `The ${key} can name each layout once, at most ${SYSTEM_IDS.length}.` };
    const kept = [];
    for (const id of raw) {
      if (typeof id !== 'string' || !SYSTEM_IDS.includes(id)) {
        if (strict) return { error: 'There is no such layout here.' };
        continue;
      }
      if (key === 'hide' && id === 'workspace') {
        if (strict) return { error: 'The Workspace is always shown.' };
        continue;
      }
      if (kept.includes(id)) {
        if (strict) return { error: `"${id}" is listed twice.` };
        continue;
      }
      kept.push(id);
    }
    lists[key] = kept;
  }
  const order = [...lists.order, ...SYSTEM_IDS.filter((id) => !lists.order.includes(id))];
  const hide = SYSTEM_IDS.filter((id) => lists.hide.includes(id));
  const out = {};
  if (order.some((id, i) => id !== SYSTEM_IDS[i])) out.order = order;
  if (hide.length) out.hide = hide;
  return { tabs: Object.keys(out).length ? out : null };
}
// A space's tabs whole, for the owner's controls and for ordering: { order: [every id], hide: [ids] }; unset reads as the defaults.
function tabsOf(stored) {
  const { tabs } = cleanTabs(stored);
  return { order: tabs?.order ? [...tabs.order] : [...SYSTEM_IDS], hide: tabs?.hide ? [...tabs.hide] : [] };
}

// One person's stored choices for the system layouts, as read from the file: only what this version knows, cleaned.
function storedSystem(raw) {
  const out = {};
  if (!isObject(raw)) return out;
  for (const id of SYSTEM_IDS) {
    const r = raw[id];
    if (!isObject(r)) continue;
    const kept = {};
    const name = typeof r.name === 'string' ? cleanName(r.name) : '';
    if (name && [...name].length <= LAYOUT_LIMITS.name) kept.name = name;
    if (typeof r.icon === 'string' && ICON_RE.test(r.icon)) kept.icon = r.icon;
    if (r.tab === false && id !== 'workspace') kept.tab = false;
    if (Object.keys(kept).length) out[id] = kept;
  }
  return out;
}

class LayoutError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// A shared layout as read from the file: a valid shape and its areas (cleanShape with no module list; `on: []` so the shape rules read nothing as a composite). A free-form one (modules, from before shared layouts were
// shapes) is dropped, as is anything else that is not a shape; the file is not rewritten until the next save.
// Any free-form key present (modules, snap, arrange, whatever its value) drops the entry, and only the shape's own fields are kept.
const storedShared = (l) => isObject(l) && typeof l.id === 'string' && l.id && typeof l.name === 'string' && !FREE_FORM_KEYS.some((k) => k in l)
  && Boolean(cleanShape({ shape: l.shape, areas: l.areas }, { on: [] }).shape);
const SHARED_FIELDS = ['id', 'name', 'by', 'at', 'shape', 'areas', 'icon'];
const storedSharedList = (list) => (Array.isArray(list) ? list.filter(storedShared).map((l) => Object.fromEntries(SHARED_FIELDS.filter((k) => k in l).map((k) => [k, l[k]]))) : []);
const copy = (l) => structuredClone(l);

class Layouts {
  constructor(dataDir) {
    this.dir = dataDir;
    this.file = path.join(dataDir, 'layouts.json');
    this.spaces = {};
    // None yet is the usual case. One that is there but cannot be read is never written over: the lists read as
    // empty and every change is refused, until the file is fixed or restored and the server started again.
    this.unreadable = false;
    let raw = null;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') this.unreadable = true;
    }
    for (const [spaceId, entry] of Object.entries(isObject(raw?.spaces) ? raw.spaces : {})) {
      if (!isObject(entry)) continue;
      const shared = storedSharedList(entry.shared);
      const sharedIds = new Set(shared.map((l) => l.id));
      const system = {};
      for (const [key, record] of Object.entries(isObject(entry.system) ? entry.system : {})) {
        const kept = storedSystem(record);
        if (Object.keys(kept).length) system[key] = kept;
      }
      // Each person's last layout: one { layout, at } per person, kept only while it names a fixed layout, a shared layout
      // or a workspace id (a gone one, a malformed one or a hand-edited one is dropped), the id at most 64 characters.
      const last = {};
      for (const [key, record] of Object.entries(isObject(entry.last) ? entry.last : {})) {
        if (key === '__proto__' || !isObject(record)) continue;
        const { layout, at } = record;
        if (typeof layout !== 'string' || !layout || layout.length > LAST_ID_MAX || typeof at !== 'number' || !Number.isFinite(at)) continue;
        if (SYSTEM_IDS.includes(layout) || sharedIds.has(layout) || ADDED_WORKSPACE_ID.test(layout)) last[key] = { layout, at };
      }
      if (shared.length || Object.keys(system).length || Object.keys(last).length) {
        this.spaces[spaceId] = { shared, ...(Object.keys(system).length ? { system } : {}), ...(Object.keys(last).length ? { last } : {}) };
      }
    }
  }

  // Before any change: refused whole while layouts.json cannot be read.
  mustWrite() {
    this.iconCache = null; // a change may follow: iconIds() is read again
    if (this.unreadable) throw new LayoutError('The saved layouts file cannot be read, so nothing can be saved until it is fixed.', 500);
  }

  save() {
    this.iconCache = null;
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ spaces: this.spaces }, null, 2)}\n`);
    fs.renameSync(tmp, this.file);
  }

  // The space's shared list. Made when `create`.
  sharedOf(spaceId, create = false) {
    let entry = this.spaces[spaceId];
    if (!entry) {
      if (!create) return [];
      entry = this.spaces[spaceId] = { shared: [] };
    }
    return entry.shared;
  }

  // Drops empty lists and spaces, so the file holds only what someone saved.
  tidy(spaceId) {
    const entry = this.spaces[spaceId];
    if (!entry) return;
    if (entry.system) {
      for (const [key, record] of Object.entries(entry.system)) if (!Object.keys(record).length) delete entry.system[key];
      if (!Object.keys(entry.system).length) delete entry.system;
    }
    if (entry.last && !Object.keys(entry.last).length) delete entry.last;
    if (!entry.shared.length && !entry.system && !entry.last) delete this.spaces[spaceId];
  }

  // { shared } in a space. Each is a copy with `kind: 'user'` and its `icon` (the default one when none was stored);
  // nothing stored is changed.
  list(spaceId) {
    const shown = (l) => ({ ...copy(l), kind: 'user', icon: typeof l.icon === 'string' && l.icon ? l.icon : USER_ICON });
    return { shared: this.sharedOf(spaceId).map(shown) };
  }

  // `userKey`'s own choices for the system layouts in a space: { <system id>: { name?, icon?, tab? } }, only what they
  // changed. A guest (`userKey` null) has none.
  systemOf(spaceId, userKey) {
    return userKey ? structuredClone(this.spaces[spaceId]?.system?.[userKey] || {}) : {};
  }

  // Sets or clears (`null`) a person's name or icon for one system layout, or its tab (`false` stored; `true` clears it).
  // `patch` is cleanSystemPatch's answer; the caller has checked the id and that the Workspace keeps its tab. Returns
  // that layout's choices after, as systemOf().
  setSystem(spaceId, userKey, systemId, patch) {
    this.mustWrite();
    const now = this.systemOf(spaceId, userKey)[systemId] || {};
    const next = { ...now };
    for (const key of ['name', 'icon']) {
      if (patch[key] === undefined) continue;
      if (patch[key] === null) delete next[key]; else next[key] = patch[key];
    }
    if (patch.tab === false) next.tab = false;
    else if (patch.tab === true) delete next.tab;
    if (JSON.stringify(next) === JSON.stringify(now)) return next;
    const entry = this.spaces[spaceId] || (this.spaces[spaceId] = { shared: [] });
    entry.system = entry.system || {};
    entry.system[userKey] = { ...(entry.system[userKey] || {}) };
    if (Object.keys(next).length) entry.system[userKey][systemId] = next; else delete entry.system[userKey][systemId];
    this.tidy(spaceId);
    this.save();
    return next;
  }

  // The layout id `userKey` last used in a space, as stored (null for a guest, or when there is none). Whether it is still
  // available is the route's (a fixed layout may be off, or hidden by the owner): the record is not rewritten for that.
  lastOf(spaceId, userKey) {
    return userKey ? this.spaces[spaceId]?.last?.[userKey]?.layout || null : null;
  }

  // Whether `layoutId` can be a person's last layout: a fixed layout's id, a shared layout, or one of `ownIds` (the
  // workspaces the person added, server/workspaces.js). The caller decides whether a fixed one is on here.
  knows(spaceId, layoutId, ownIds = []) {
    return typeof layoutId === 'string' && layoutId.length > 0 && layoutId.length <= LAST_ID_MAX
      && (SYSTEM_IDS.includes(layoutId) || Boolean(this.find(spaceId, layoutId)) || (ADDED_WORKSPACE_ID.test(layoutId) && ownIds.includes(layoutId)));
  }

  // Sets `userKey`'s last layout in a space; the server writes `at`. The same layout again changes nothing (no write).
  // The caller has checked the id (knows(), and that a fixed one is on) and that this is a signed-in person.
  setLast(spaceId, userKey, layoutId) {
    this.mustWrite();
    if (this.lastOf(spaceId, userKey) === layoutId) return layoutId;
    const entry = this.spaces[spaceId] || (this.spaces[spaceId] = { shared: [] });
    entry.last = entry.last || {};
    entry.last[userKey] = { layout: layoutId, at: Date.now() };
    this.save();
    return layoutId;
  }

  // A shared layout by id in a space. { layout, shared: true } or null.
  find(spaceId, layoutId) {
    const shared = this.sharedOf(spaceId).find((l) => l.id === layoutId);
    return shared ? { layout: copy(shared), shared: true } : null;
  }

  newId(spaceId) {
    const entry = this.spaces[spaceId];
    const taken = new Set(entry ? entry.shared.map((l) => l.id) : []);
    let id;
    do id = `l${Array.from({ length: 6 }, () => ID_ALPHABET[crypto.randomInt(ID_ALPHABET.length)]).join('')}`;
    while (taken.has(id));
    return id;
  }

  // Saves a new layout for everyone, already cleaned by cleanLayout (a shape and its areas). Throws a LayoutError (409)
  // when the name is taken (with the id of the one that has it) or the list is full.
  add(spaceId, by, { name, shape, areas, icon }) {
    this.mustWrite();
    const current = this.sharedOf(spaceId);
    const same = current.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (same) throw new LayoutError(`There is already a layout called ${same.name}.`, 409, { id: same.id });
    const cap = LAYOUT_LIMITS.shared;
    if (current.length >= cap) throw new LayoutError(`This ${words.word('space')} has ${cap} shared layouts. Delete one first.`, 409);
    const layout = { id: this.newId(spaceId), name, by, at: new Date().toISOString(), shape, areas, ...(icon ? { icon } : {}) };
    this.sharedOf(spaceId, true).push(layout);
    this.save();
    return copy(layout);
  }

  // Renames or replaces a shared layout (found by find()); `patch` is cleanLayout's partial answer. The caller has
  // already decided whether this person may change it. `at` moves to now; `by` stays who first saved it.
  update(spaceId, layoutId, patch) {
    this.mustWrite();
    const found = this.find(spaceId, layoutId);
    if (!found) return null;
    const list = this.sharedOf(spaceId);
    const layout = list.find((l) => l.id === layoutId);
    if (patch.name !== undefined) {
      const same = list.find((l) => l.id !== layoutId && l.name.toLowerCase() === patch.name.toLowerCase());
      if (same) throw new LayoutError(`There is already a layout called ${same.name}.`, 409, { id: same.id });
      layout.name = patch.name;
    }
    if (patch.shape !== undefined) { layout.shape = patch.shape; layout.areas = patch.areas; }
    if (patch.icon !== undefined) layout.icon = patch.icon;
    layout.at = new Date().toISOString();
    this.save();
    return copy(layout);
  }

  // Deletes a shared layout, and takes it out of every person's last layout in the space. true when there was one.
  remove(spaceId, layoutId) {
    this.mustWrite();
    if (!this.find(spaceId, layoutId)) return false;
    const list = this.sharedOf(spaceId);
    list.splice(list.findIndex((l) => l.id === layoutId), 1);
    const last = this.spaces[spaceId].last || {};
    for (const key of Object.keys(last)) if (last[key].layout === layoutId) delete last[key];
    this.tidy(spaceId);
    this.save();
    return true;
  }

  // Every icon id a stored layout choice names, in every space: saved layouts' icons (shared and each person's) and each
  // person's icon for a system layout. Read by Store#inUseIconIds, so an icon the owner removes from the environment's
  // list still draws where it is used. Ids only, each once; nothing is changed. Remembered until the next change
  // (mustWrite, save): signed-out /api/branding reads it on every call, and a big file takes milliseconds to walk.
  iconIds() {
    if (this.iconCache) return [...this.iconCache];
    const ids = new Set();
    for (const entry of Object.values(this.spaces)) {
      for (const l of entry.shared || []) if (typeof l.icon === 'string') ids.add(l.icon);
      for (const record of Object.values(entry.system || {})) {
        for (const choice of Object.values(record)) if (typeof choice.icon === 'string') ids.add(choice.icon);
      }
    }
    this.iconCache = ids;
    return [...ids];
  }

  // A removed space takes its layouts.
  forgetSpace(spaceId) {
    if (this.unreadable || !this.spaces[spaceId]) return;
    delete this.spaces[spaceId];
    this.save();
  }

  // A removed person takes their own choices and their last layout in every space. Shared layouts they saved stay: they
  // are the space's.
  forgetPerson(userKey) {
    if (this.unreadable) return;
    let changed = false;
    for (const spaceId of Object.keys(this.spaces)) {
      const entry = this.spaces[spaceId];
      if (entry.system?.[userKey] || entry.last?.[userKey]) {
        if (entry.last) delete entry.last[userKey];
        if (entry.system) delete entry.system[userKey];
        this.tidy(spaceId);
        changed = true;
      }
    }
    if (changed) this.save();
  }
}

module.exports = { Layouts, LayoutError, cleanLayout, cleanSystemPatch, cleanTabs, tabsOf, LAYOUT_LIMITS, SYSTEM_IDS, SYSTEM_ICONS, USER_ICON };
