// Layouts for everyone (documentation/plans/plan-saved-layouts.md, step 1; plan-layout-picker.md, decision 5): a space's
// shared layouts, kept on the server so they reach everyone in it. One file per environment, DATA_DIR/layouts.json (so the
// environment's export and the host console's backup, which zip the whole data folder, carry it):
//
//   { "spaces": { "<space id>": { "shared": [layout],
//                                  "last": { "<user key>": { "layout": "<layout id>", "at": <ms> } } } } }
//
// A person's own layouts and favorites are gone (plan-workspaces.md, decision 44): a person adds a workspace instead
// (server/workspaces.js), which is a tab. A person's own name, icon and tab for a system layout are gone too (issue #1091:
// nobody renames or re-icons the owner's tabs). A file's old `people`, `favorites` and `system` keys are dropped on read.
//
// The system layouts `workspace`, `calendar`, `map`, `conference`, `whiteboard`, `documents` and `schedule` are never
// stored; server/index.js makes them per space from what is on, with their own names and icons.
// last (documentation/plans/plan-workspaces.md, decision 20, step 11): the layout each signed-in person last used in a
// space, so entering the space can open it: "last": { "<user key>": { "layout": "<layout id>", "at": <ms> } }. One entry per
// person per space, about 100 bytes, no history; the server writes `at`. `layout` is a system id or a saved layout the
// person can see, or a workspace the person added (`w` and six characters; whether it is still there is the route's,
// server/workspaces.js). remove() clears the entries that name a deleted layout; forgetPerson() and forgetSpace() clear the rest;
// the key is left out of a space's entry while nobody there has one. A guest has none. It is personal state, so an owner's
// environment copy leaves it out (server/environment-export.js).
// A user layout may carry an `icon`; one stored without reads as kind `user` with the default icon.
//
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
});
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
const TOP_KEYS = ['name', 'shared', 'shape', 'areas', 'icon'];
// The canvas's own words for an arrangement, which a layout for everyone never takes (a stored entry with one is dropped on read).
const FREE_FORM_KEYS = ['modules', 'snap', 'arrange'];
// POST takes only a layout for everyone (plan-workspaces.md, decision 44).
const OWN_LAYOUT_SENTENCE = 'A layout of your own is a workspace now: add one with New workspace, in the tabs\' menu.';
const LAST_ID_MAX = 64; // a layout id as `last` keeps it
const ADDED_WORKSPACE_ID = /^w[a-z0-9]{6}$/; // a workspace a person added (server/workspaces.js), as `last` may name
const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const many = (key) => words.word(key, { many: true });

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

// The one layout check, pure. `input` is what a request sends: a layout for everyone, { name, shared: true, shape, areas,
// icon? }, a shape and its areas, checked by cleanShape against `shapeOptions` ({ modules, on, names }; see checkShape)
// (plan-layout-picker.md, decisions 5 and 15). A person's own layout is a workspace (plan-workspaces.md, decision 44), so
// `shared` must be true, and the free-form keys of the canvas's own arrangement (modules, snap, arrange) are refused. With
// `partial` (a PUT) name and shape with areas may be left out and `shared` is not taken. `icons`, when given, is the list
// of icon ids an `icon` must come from. Returns { layout } with only the fields given, cleaned, or { error, problems,
// parts } with one sentence saying what is wrong (`problems` all the sentences, `parts` the field each is about, as a
// template's refusal); anything wrong refuses the whole layout.
function cleanLayout(input, { partial = false, icons = null, shapeOptions = null } = {}) {
  const out = cleanLayoutParts(input, { partial, icons, shapeOptions });
  if (out.layout) return out;
  const problems = out.problems || [out.error];
  return { error: problems[0], problems, parts: out.parts || [out.part ?? null] };
}
function cleanLayoutParts(input, { partial, icons, shapeOptions }) {
  const no = (error, part = null) => ({ error, part });
  if (!isObject(input)) return no('Send the layout as JSON: a name, a shape and its areas.');
  const free = FREE_FORM_KEYS.find((k) => input[k] !== undefined);
  if (free) return no('A layout for everyone is a shape; pick one with the picker.', 'shape');
  const allowed = partial ? TOP_KEYS.filter((k) => k !== 'shared') : TOP_KEYS;
  const extra = Object.keys(input).find((k) => !allowed.includes(k));
  if (extra) return no(partial && extra === 'shared' ? 'A layout for everyone stays one; save a workspace instead.' : `A layout does not take ${JSON.stringify(plainId(extra))}.`, null);
  if (!partial && input.shared !== true) return no(OWN_LAYOUT_SENTENCE, 'shared');
  const out = {};

  if (!partial || input.name !== undefined) {
    if (input.name !== undefined && typeof input.name !== 'string') return no('A layout\'s name must be text.', 'name');
    const name = cleanName(input.name);
    if (!name) return no('Give the layout a name.', 'name');
    if ([...name].length > LAYOUT_LIMITS.name) return no(`A layout's name can be at most ${LAYOUT_LIMITS.name} characters.`, 'name');
    out.name = name;
  }
  if (!partial) out.shared = true;

  if (!partial || input.shape !== undefined || input.areas !== undefined) {
    const checked = checkShape(input, shapeOptions);
    if (!checked.shape) return { error: checked.problems[0], problems: checked.problems, parts: checked.parts };
    out.shape = checked.shape.shape;
    out.areas = checked.shape.areas;
  }

  if (input.icon !== undefined) {
    const bad = typeof input.icon !== 'string' || !ICON_RE.test(input.icon) || (Array.isArray(icons) && !icons.includes(input.icon));
    if (bad) return no('Pick an icon from the list.', 'icon');
    out.icon = input.icon;
  }
  return { layout: out };
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
      // Each person's last layout: one { layout, at } per person, kept only while it names a fixed layout, a shared layout
      // or a workspace id (a gone one, a malformed one or a hand-edited one is dropped), the id at most 64 characters.
      const last = {};
      for (const [key, record] of Object.entries(isObject(entry.last) ? entry.last : {})) {
        if (key === '__proto__' || !isObject(record)) continue;
        const { layout, at } = record;
        if (typeof layout !== 'string' || !layout || layout.length > LAST_ID_MAX || typeof at !== 'number' || !Number.isFinite(at)) continue;
        if (SYSTEM_IDS.includes(layout) || sharedIds.has(layout) || ADDED_WORKSPACE_ID.test(layout)) last[key] = { layout, at };
      }
      if (shared.length || Object.keys(last).length) {
        this.spaces[spaceId] = { shared, ...(Object.keys(last).length ? { last } : {}) };
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
    if (entry.last && !Object.keys(entry.last).length) delete entry.last;
    if (!entry.shared.length && !entry.last) delete this.spaces[spaceId];
  }

  // { shared } in a space. Each is a copy with `kind: 'user'` and its `icon` (the default one when none was stored);
  // nothing stored is changed.
  list(spaceId) {
    const shown = (l) => ({ ...copy(l), kind: 'user', icon: typeof l.icon === 'string' && l.icon ? l.icon : USER_ICON });
    return { shared: this.sharedOf(spaceId).map(shown) };
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

  // Every icon id a stored layout names, in every space: the shared layouts' icons. Read by Store#inUseIconIds, so an icon the owner removes from the environment's
  // list still draws where it is used. Ids only, each once; nothing is changed. Remembered until the next change
  // (mustWrite, save): signed-out /api/branding reads it on every call, and a big file takes milliseconds to walk.
  iconIds() {
    if (this.iconCache) return [...this.iconCache];
    const ids = new Set();
    for (const entry of Object.values(this.spaces)) {
      for (const l of entry.shared || []) if (typeof l.icon === 'string') ids.add(l.icon);
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

  // A removed person takes their last layout in every space. Shared layouts they saved stay: they
  // are the space's.
  forgetPerson(userKey) {
    if (this.unreadable) return;
    let changed = false;
    for (const spaceId of Object.keys(this.spaces)) {
      const entry = this.spaces[spaceId];
      if (entry.last?.[userKey]) {
        delete entry.last[userKey];
        this.tidy(spaceId);
        changed = true;
      }
    }
    if (changed) this.save();
  }
}

module.exports = { Layouts, LayoutError, cleanLayout, cleanTabs, tabsOf, LAYOUT_LIMITS, SYSTEM_IDS, SYSTEM_ICONS, USER_ICON };
