// The layout picker (documentation/plans/plan-layout-picker.md, step 4; "The picker"): one page piece, drawn the same
// wherever a layout is set (a template's Default Workspace, step 5; a space's Layouts, step 6). Two steps:
//   1. Pick a shape: the six shapes of public/layout-shapes.js drawn small, two rows of three, each beside the narrow
//      chat and call column (a tinted band, decision 1), its areas numbered at the shape's own percentages. A radio
//      group: one Tab stop, the arrow keys move and pick (primary-nav.js's gridStep), Home and End; Enter or a click
//      picks and goes on to step 2.
//   2. Choose modules: the chosen shape drawn large, each area a button ("Area 2 of 3: To-do") that opens the page's
//      shared menu (host-menu.js, openHostMenu) with Empty first, then what that area may hold. What an area may hold
//      is layouts.js's areaMayHold, the one rule the canvas's chooser uses too: never the chat or the call, and in a
//      stacked area no composite (Calendar and Maps: `parts`, decision 8). A module
//      already in another area moves, emptying its old area, so a module is never in two areas. An area may stay empty
//      (decision 3). In a narrow place (a phone, a narrow editor) step 2 is a list, one row per area.
// The bar is the shared action bar (action-bar.js): Save and Cancel, with Back (or Choose modules) beside them.
//
// What it gives back is the stored shape, { shape, areas }, the record server/layout-shapes.js's cleanShape() checks
// (tools/check-layout-picker.mjs runs the picker's records through it). It holds no widths (decisions 7 and 11).
//
//   const picker = createLayoutPicker({ record, modules, onSave, onCancel });
//   container.append(picker.el);
//
// Options:
//   record     { shape, areas } to start from, or null for a new layout (step 1 first; with a record, step 2).
//   modules    [{ id, name, icon, tint? }]: what an area may name (a template's modules, or the ones on in a space),
//              in the order the menu lists them. `icon` is a Font Awesome name or a whole class list; `tint` one of the
//              eight tint names. The chat and the call may be in it; no area offers them. The caller leaves out what
//              can't be a column.
//   others     [{ id, name, icon, tint? }]: modules an area may still show by name and icon but is never offered (a
//              template's module that is no longer ticked, while the layout still names it; template-layout.js).
//   parts      the ids that read as a composite where the layout is used (composites.js's aliasesFor; canvas.js's
//              compositePartsHere). Left out, it is worked out from `modules` (partsFor), as the shape check reads a
//              template: the Calendar counts while it is among them.
//   cantOpen   { <module id>: { roles: ['moderator' | 'member' | 'guest', ...] } | { off: true } }: who can't open each
//              module (server/layout-shapes.js's whoCantOpen; plan, "Telling the maker"). An area whose module is in it
//              gets the maker's notice under it, in noticeWords' words, read with the area. A module not in it gets none.
//   byDefault  true in the host console's template editor, where the roles are the manifests' defaults ("Guests can't
//              open this by default.").
//   offIn      'environment' on Manage's template pages, where a module in cantOpen as off is off in the environment
//              ("Off in this environment."); 'space' (the default) in a space.
//   readOnly   drawn read only (a shipped template): step 2, the areas not pressable, the bar's Close only.
//   bar        false to draw no bar (a surface with a Save of its own); `onChange(record)` then hears each change.
//   onSave(record)   does the save; false, or a throw with the refusal in its message, keeps the picker open and
//              shows the refusal under the shape in one line (the server's own words). Anything else is saved.
//   onCancel() closes the surface, edits dropped (the bar asks first when something changed).
// Returns { el, value, set, setStep, step, refuse, setCantOpen, bar, destroy }.
import { SHAPES, shapeById } from '/layout-shapes.js';
import { areaMayHold, shapeColumns, COLUMN_IDS } from '/layouts.js';
import { aliasesFor } from '/composites.js';
import { openHostMenu, closeHostMenu } from '/host-menu.js';
import { actionBar } from '/action-bar.js';
import { gridStep } from '/primary-nav.js';
import { fill, word } from '/words.js';

// The words a person reads for each shape (the plan's suggestions; open question 3).
export const SHAPE_LABELS = Object.freeze({
  one: 'One',
  'two-equal': 'Two equal',
  'wide-narrow': 'Large and narrow',
  'three-equal': 'Three equal',
  'tall-split': 'Two, right split',
  'wide-split': 'Large, right split',
});
// What a screen reader hears after a shape's label.
export const SHAPE_ABOUT = Object.freeze({
  one: 'One area fills the view.',
  'two-equal': 'Two areas side by side, the same width.',
  'wide-narrow': 'A large area, with a narrow one beside it.',
  'three-equal': 'Three areas side by side, the same width.',
  'tall-split': 'One area on the left; two above each other on the right.',
  'wide-split': 'A large area; two above each other, narrow, beside it.',
});

// --- the pure parts (tools/check-layout-picker.mjs runs them in node) ----------------------------------------------------

// A module id an area may name: the stored shape's rule (MODULE_ID in server/layout-shapes.js), so the picker never offers
// what cleanShape() refuses (a `dest:*` composite, a capital, a dot, a 33rd character, `__proto__`).
export const MODULE_ID = /^[a-z][a-z0-9-]{0,31}$/;
const isModuleId = (id) => typeof id === 'string' && MODULE_ID.test(id) && id !== '__proto__';
// The most areas a shape has (public/layout-shapes.js): a shape claiming more is not one of ours, and nothing is drawn
// or counted for it.
export const MAX_AREAS = Math.max(...SHAPES.map((x) => x.areas));
const shapeAreas = (shape) => (shape && Number.isInteger(shape.areas) && shape.areas >= 1 && shape.areas <= MAX_AREAS ? shape.areas : 0);
// A name as the picker draws it: the caller's words without control or direction characters (U+202E and the like, which
// would turn the text around it), trimmed and at most 60 characters.
const DIRECTION_OR_CONTROL = /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g;
export function cleanText(text) {
  return typeof text === 'string' ? text.replace(DIRECTION_OR_CONTROL, '').trim().slice(0, 60) : '';
}
// An area number of `shape` (from 1), or 0.
const areaOf = (shape, area) => (Number.isInteger(area) && area >= 1 && area <= shapeAreas(shape) ? area : 0);

// The ids that read as a composite given the ids on (composites.js's aliasesFor): the Calendar while it
// is among them (To-do is always its own module); Maps only where the Map answered (`shown`), though areaMayHold refuses Maps in a stacked area anyway.
export function partsFor(ids, shown = []) {
  const aliases = aliasesFor(Array.isArray(ids) ? ids : [], Array.isArray(shown) ? shown : []);
  return Object.keys(aliases).filter((id) => typeof aliases[id] === 'string' && aliases[id].startsWith('dest:'));
}

// The modules as the menus list them: each a well-formed module id (MODULE_ID), each once, in the order given, its name
// as the picker draws it (cleanText; the id when it has none left).
export function cleanModules(modules) {
  const seen = new Set();
  const out = [];
  for (const m of Array.isArray(modules) ? modules : []) {
    if (!m || typeof m !== 'object' || !isModuleId(m.id) || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push({ ...m, name: cleanText(m.name) || m.id });
  }
  return out;
}

// What area `area` (from 1) of `shape` offers: the modules it may hold (areaMayHold, the canvas chooser's rule, on
// well-formed ids only), each once, in the order given.
export function areaChoices(shape, area, modules, { parts = [] } = {}) {
  if (!areaOf(shape, area)) return [];
  return cleanModules(modules).filter((m) => areaMayHold(shape, area, m.id, { parts: Array.isArray(parts) ? parts : [] }));
}

// The modules an area refuses because they can't share a column (a stacked area): named in the menu's note so nobody
// wonders where the Calendar went. The chat and the call are not named: they are never in an area.
export function areaRefused(shape, area, modules, { parts = [] } = {}) {
  if (!areaOf(shape, area)) return [];
  return cleanModules(modules).filter((m) => !COLUMN_IDS.includes(m.id) && !areaMayHold(shape, area, m.id, { parts: Array.isArray(parts) ? parts : [] }));
}

// The areas of `shape` filled from `list` (the areas as they were, in area order, null for an empty one) when the shape
// changes or a record is read. Nothing the shape can hold is lost: each module stays in its area where that area is still
// there and may hold it; the rest go, in order, into the first empty area that may hold them, moving another module to an
// empty area that may hold it when that frees an area for it (a Calendar from a stacked area into area 1, its module down
// into the stack). This goes further than the plan's "keeps the modules in order and empties areas that no longer exist":
// a module from an area that went moves into a free one rather than being dropped. A module named twice counts once.
// What can't be placed is dropped: { id, why } with `why` 'stack' (it can't share a column, and no area that is not
// stacked is free), 'full' (no area left for it) or 'column' (the chat or the call, never in an area). `mayHold(area, id)`.
// Answers { areas, dropped }; with no shape, no areas and nothing dropped.
export function carryAreas(list, shape, mayHold) {
  const n = shapeAreas(shape);
  if (!n || typeof mayHold !== 'function') return { areas: [], dropped: [] };
  const out = Array.from({ length: n }, () => null);
  const seen = new Set();
  const rest = [];
  (Array.isArray(list) ? list : []).forEach((id, i) => {
    // An id the server's rule refuses (MODULE_ID: a capital, a dot, `__proto__`, a `dest:*` composite) is never drawn or
    // handed back, and is not named: it is not a module.
    if (!isModuleId(id) || seen.has(id)) return;
    seen.add(id);
    if (i < n && mayHold(i + 1, id)) out[i] = id; else rest.push(id);
  });
  const dropped = [];
  const freeFor = (id) => out.findIndex((x, i) => x === null && mayHold(i + 1, id));
  const stacked = Array.isArray(shape.stacked) ? shape.stacked : [];
  for (const id of rest) {
    let at = freeFor(id);
    for (let a = 0; at < 0 && a < n; a += 1) {
      const there = out[a];
      if (there === null || !mayHold(a + 1, id)) continue;
      const b = out.findIndex((x, i) => i !== a && x === null && mayHold(i + 1, there));
      if (b >= 0) { out[b] = there; out[a] = null; at = a; }
    }
    if (at >= 0) { out[at] = id; continue; }
    const why = COLUMN_IDS.includes(id) ? 'column' : stacked.length && stacked.every((a) => !mayHold(a, id)) ? 'stack' : 'full';
    dropped.push({ id, why });
  }
  return { areas: out, dropped };
}

// `areas` with module `id` (or null) put in area `area` (from 1, within the list). A module already in another area
// leaves it, empty. Answers { areas, from }: the new list and the area it came from (0 when none). An area outside the
// list changes nothing.
export function putInArea(areas, area, id) {
  const out = Array.isArray(areas) ? areas.slice() : [];
  if (!Number.isInteger(area) || area < 1 || area > out.length) return { areas: out, from: 0 };
  let from = 0;
  const put = typeof id === 'string' && id ? id : null;
  if (put) {
    const was = out.indexOf(put);
    if (was >= 0 && was !== area - 1) { out[was] = null; from = was + 1; }
  }
  out[area - 1] = put;
  return { areas: out, from };
}

const andList = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || '');
const upFirst = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

// The one line saying what a shape change (or a record read) left out, by the modules' names; '' when nothing was.
// "Calendar can't share a column, so it was taken out." "There is no area left for Polls and Vault, so they were taken out."
export function droppedNote(dropped, nameOf = (id) => id) {
  const list = (Array.isArray(dropped) ? dropped : []).filter((d) => d && typeof d.id === 'string' && d.id);
  const named = (id) => { const n = typeof nameOf === 'function' ? nameOf(id) : ''; return typeof n === 'string' && n ? n : id; };
  const of = (why) => list.filter((d) => d.why === why).map((d) => named(d.id));
  const lines = [];
  const stack = of('stack');
  if (stack.length) lines.push(`${andList(stack)} can't share a column, so ${stack.length > 1 ? 'they were' : 'it was'} taken out.`);
  const full = of('full');
  if (full.length) lines.push(`There is no area left for ${andList(full)}, so ${full.length > 1 ? 'they were' : 'it was'} taken out.`);
  if (of('column').length) lines.push('The chat and the call keep their column on the left, so they are not in an area.');
  return lines.join(' ');
}

// What a screen reader hears for an area: "Area 2 of 3: To-do", "Area 1 of 1: Empty".
export const areaName = (area, count, name) => `Area ${area} of ${count}: ${name || 'Empty'}`;

// The menu's note in an area that refuses some modules: "Calendar and Maps can't share a column; they can go in area 1."
// '' when nothing is refused, or when every area of the shape is stacked (there is nowhere to send them).
export function refusedNote(names, shape) {
  const list = (Array.isArray(names) ? names : []).filter((x) => typeof x === 'string' && x);
  const n = shapeAreas(shape);
  if (!list.length || !n) return '';
  const stacked = Array.isArray(shape.stacked) ? shape.stacked : [];
  const open = Array.from({ length: n }, (_, i) => i + 1).filter((a) => !stacked.includes(a));
  if (!open.length) return '';
  const where = open.length > 1 ? `areas ${andList(open.map(String))}` : `area ${open[0]}`;
  return `${andList(list)} can't share a column; ${list.length > 1 ? 'they' : 'it'} can go in ${where}.`;
}

// The maker's notice (decisions 17 and 19; plan, "The maker's notice"): the one line under an area whose module someone
// can't open, from its `cantOpen` entry ({ roles: ['moderator' | 'member' | 'guest', ...] } or { off: true }; a module
// not in `cantOpen` has none). The roles are named in the order moderator, member, guest, each by this environment's
// word for it, plural (words.js's word(), so a template that calls members "students" says "Students"):
//   "Guests can't open this. For them, this area closes up."
//   "Members and guests can't open this. For them, this area closes up."
//   "Off in this space. This area closes up for everyone."
// `byDefault` (the host console's template editor, where the roles are the manifests' defaults): "Guests can't open this
// by default." `offIn`: where a module is off, 'space' (a space's layout) or 'environment' (a template in Manage, where
// a module is off or not installed in the environment): "Off in this environment. ..." `wordOf(key, opts)` is word()
// unless given. '' when there is nothing to say.
export const NOTICE_ROLES = Object.freeze(['moderator', 'member', 'guest']);
export function noticeWords(entry, { byDefault = false, offIn = 'space', wordOf = word } = {}) {
  if (!entry || typeof entry !== 'object') return '';
  if (entry.off === true) return byDefault ? 'Not installed. This area closes up for everyone.' : `Off in this ${wordOf(offIn === 'environment' ? 'environment' : 'space')}. This area closes up for everyone.`;
  const given = Array.isArray(entry.roles) ? entry.roles : [];
  const roles = NOTICE_ROLES.filter((r) => given.includes(r));
  if (!roles.length) return '';
  const who = upFirst(andList(roles.map((r) => wordOf(r, { many: true }))));
  return byDefault ? `${who} can't open this by default.` : `${who} can't open this. For them, this area closes up.`;
}

// --- the piece -----------------------------------------------------------------------------------------------------------

const ICON_CLASS = (icon) => (String(icon).includes(' ') ? `${icon} fa-fw` : `fa-solid fa-${icon} fa-fw`);
const TINT = /^(gold|blue|green|teal|purple|red|orange|pink)$/;
let made = 0;

export function createLayoutPicker({
  doc = document,
  record = null,
  modules = [],
  others = [],
  parts = null,
  cantOpen = null,
  byDefault = false,
  offIn = 'space',
  readOnly = false,
  bar: withBar = true,
  step: startStep = 0,
  label = 'Layout',
  onSave = null,
  onCancel = null,
  onChange = null,
} = {}) {
  const uid = `layout-picker-${++made}`;
  const list = cleanModules(modules);
  const byId = new Map([...cleanModules(others), ...list].map((m) => [m.id, m])); // what is offered wins over `others`
  let cantMap = cantOpen && typeof cantOpen === 'object' ? cantOpen : null; // who can't open each module (step 6's cantOpen)
  const compositeParts = Array.isArray(parts) ? parts : partsFor(list.map((m) => m.id));
  const nameOf = (id) => (byId.get(id) && byId.get(id).name) || id; // names are cleanText'd in cleanModules
  const mayHoldIn = (def) => (area, id) => isModuleId(id) && areaMayHold(def, area, id, { parts: compositeParts });

  // The state: the shape chosen, its areas, the list a shape change carries from (the areas as step 2 last left them),
  // the step shown, the line about what a change left out, the refusal from a save.
  const state = { shape: null, areas: [], base: [], step: 1, note: '', refusal: '' };
  let kept = null; // the record as it was opened or last saved: what Cancel would keep
  const valueOf = () => (state.shape ? { shape: state.shape.id, areas: state.areas.slice() } : null);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const el = doc.createElement('div');
  el.className = 'layout-picker action-surface';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', label);
  if (readOnly) el.classList.add('layout-picker-readonly');
  el.innerHTML = `
    <div class="layout-picker-body action-content">
      <ol class="layout-picker-steps" aria-label="Steps">
        <li><button type="button" class="layout-picker-step" data-step="1"><span class="layout-picker-step-n" aria-hidden="true">1</span><span class="layout-picker-step-word">Pick a shape</span></button></li>
        <li class="layout-picker-step-sep" aria-hidden="true"><i class="fa-solid fa-chevron-right fa-fw"></i></li>
        <li><button type="button" class="layout-picker-step" data-step="2"><span class="layout-picker-step-n" aria-hidden="true">2</span><span class="layout-picker-step-word"></span></button></li>
      </ol>
      <section class="layout-picker-part" data-part="1" aria-labelledby="${uid}-h1">
        <h3 class="layout-picker-title" id="${uid}-h1" tabindex="-1">Pick a shape</h3>
        <p class="layout-picker-lead">The chat and the call keep their column on the left. Pick how the areas beside it are laid out.</p>
        <div class="layout-picker-shapes" role="radiogroup" aria-labelledby="${uid}-h1"></div>
      </section>
      <section class="layout-picker-part" data-part="2" aria-labelledby="${uid}-h2">
        <div class="layout-picker-head">
          <span class="layout-picker-mini" aria-hidden="true"></span>
          <div class="layout-picker-head-words">
            <h3 class="layout-picker-title" id="${uid}-h2" tabindex="-1"></h3>
            <p class="layout-picker-lead"></p>
          </div>
        </div>
        <div class="layout-picker-board"></div>
        <ul class="layout-picker-list" aria-labelledby="${uid}-h2"></ul>
      </section>
      <p class="layout-picker-note" role="status" aria-live="polite"></p>
      <p class="layout-picker-error" role="alert"></p>
    </div>`;
  const body = el.querySelector('.layout-picker-body');
  const stepsEl = el.querySelector('.layout-picker-steps');
  const stepButtons = [...el.querySelectorAll('.layout-picker-step')];
  const part1 = el.querySelector('[data-part="1"]');
  const part2 = el.querySelector('[data-part="2"]');
  const shapesEl = el.querySelector('.layout-picker-shapes');
  const title2 = el.querySelector(`#${uid}-h2`);
  const lead2 = part2.querySelector('.layout-picker-lead');
  const mini = el.querySelector('.layout-picker-mini');
  const board = el.querySelector('.layout-picker-board');
  const rows = el.querySelector('.layout-picker-list');
  const noteEl = el.querySelector('.layout-picker-note');
  const errorEl = el.querySelector('.layout-picker-error');
  stepButtons[1].querySelector('.layout-picker-step-word').textContent = fill('Choose {modules}');
  title2.textContent = readOnly ? 'Areas' : fill('Choose {modules}');
  lead2.textContent = readOnly ? 'What opens in each area.' : 'Press an area to choose what opens in it. An area left empty lets each person choose.';
  if (readOnly) stepsEl.hidden = true;

  // --- drawing a shape ---
  // The band (the chat and call column) and the view beside it: a column per shape column at its percentage (as flex
  // grow, so the gaps never upset the shares), a stacked column's areas above each other, each half its height.
  // `picture`: a drawing only (a shape's radio, the small one beside step 2's heading), hidden from a screen reader.
  function drawShape(def, makeArea, { picture = false } = {}) {
    const frame = doc.createElement('span');
    frame.className = 'layout-picker-drawing';
    frame.dataset.shape = def.id;
    if (picture) frame.setAttribute('aria-hidden', 'true');
    const band = doc.createElement('span');
    band.className = 'layout-picker-band';
    band.innerHTML = '<i class="fa-solid fa-video fa-fw" aria-hidden="true"></i><i class="fa-solid fa-comments fa-fw" aria-hidden="true"></i>';
    const view = doc.createElement('span');
    view.className = 'layout-picker-view';
    shapeColumns(def).forEach((areas, i) => {
      const col = doc.createElement('span');
      col.className = 'layout-picker-col';
      col.style.flexGrow = String(def.columns[i]);
      col.dataset.pct = String(Math.round(def.columns[i] * 100) / 100);
      if (areas.length > 1) col.classList.add('layout-picker-col-stack');
      for (const a of areas) col.appendChild(makeArea(a));
      view.appendChild(col);
    });
    frame.append(band, view);
    return frame;
  }
  const smallArea = (a) => {
    const s = doc.createElement('span');
    s.className = 'layout-picker-cell';
    s.dataset.area = String(a);
    s.textContent = String(a);
    return s;
  };

  // --- step 1: the six shapes ---
  function drawShapes() {
    shapesEl.replaceChildren();
    for (const def of SHAPES) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'layout-picker-shape';
      b.dataset.shape = def.id;
      b.setAttribute('role', 'radio');
      const about = doc.createElement('span');
      about.className = 'visually-hidden';
      about.id = `${uid}-about-${def.id}`;
      about.textContent = SHAPE_ABOUT[def.id] || '';
      b.setAttribute('aria-describedby', about.id);
      // Its name is its label alone ("Two, right split"); what it looks like is its description.
      const lab = doc.createElement('span');
      lab.className = 'layout-picker-shape-word';
      lab.id = `${uid}-shape-${def.id}`;
      lab.textContent = SHAPE_LABELS[def.id] || def.id;
      b.setAttribute('aria-labelledby', lab.id);
      const check = doc.createElement('i');
      check.className = 'fa-solid fa-circle-check fa-fw layout-picker-shape-check';
      check.setAttribute('aria-hidden', 'true');
      const foot = doc.createElement('span');
      foot.className = 'layout-picker-shape-foot';
      foot.append(lab, check);
      b.append(drawShape(def, smallArea, { picture: true }), foot, about);
      shapesEl.appendChild(b);
    }
    markShapes();
  }
  const shapeButtons = () => [...shapesEl.querySelectorAll('.layout-picker-shape')];
  function markShapes() {
    const all = shapeButtons();
    const stop = all.find((b) => state.shape && b.dataset.shape === state.shape.id) || all[0];
    for (const b of all) {
      const on = Boolean(state.shape) && b.dataset.shape === state.shape.id;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.classList.toggle('selected', on);
      b.tabIndex = b === stop ? 0 : -1;
    }
  }
  // A shape picked: its areas filled from the list as step 2 last left it (carryAreas), what didn't fit said in one line.
  function pickShape(id) {
    const def = shapeById(id);
    if (!def || readOnly) return;
    if (state.shape && state.shape.id === def.id) return;
    const carried = carryAreas(state.base, def, mayHoldIn(def));
    state.shape = def;
    state.areas = carried.areas;
    state.note = droppedNote(carried.dropped, nameOf);
    state.refusal = '';
    markShapes();
    changed();
  }
  shapesEl.addEventListener('click', (event) => {
    const b = event.target.closest('.layout-picker-shape');
    if (!b || readOnly) return;
    pickShape(b.dataset.shape);
    // A click picks and goes on; Space only picks (a keyboard press of Space is a click with no pointer).
    if (event.detail > 0) setStep(2, { focus: true });
  });
  shapesEl.addEventListener('keydown', (event) => {
    const all = shapeButtons();
    const at = all.indexOf(event.target.closest('.layout-picker-shape'));
    if (at < 0) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      pickShape(all[at].dataset.shape);
      setStep(2, { focus: true });
      return;
    }
    const columns = all.filter((b) => b.offsetTop === all[0].offsetTop).length || 3;
    const next = gridStep(at, event.key, all.length, columns);
    if (next < 0) return;
    event.preventDefault();
    pickShape(all[next].dataset.shape);
    all[next].focus();
  });

  // --- step 2: the areas ---
  const iconFor = (m) => {
    const i = doc.createElement('i');
    i.className = `${ICON_CLASS(m && m.icon ? m.icon : 'puzzle-piece')} layout-picker-area-icon`;
    i.setAttribute('aria-hidden', 'true');
    if (m && TINT.test(m.tint || '')) i.dataset.tint = m.tint;
    return i;
  };
  // The maker's notice under an area (decisions 17 and 19): its module's `cantOpen` entry in words (noticeWords), read
  // with the area (aria-describedby). Its id names where it is drawn (`where`: the board or the list), so the two never
  // share one. Text only: nothing in it goes through innerHTML.
  const hasOwn = (o, k) => Boolean(o) && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
  function noticeEl(a, id, where) {
    const text = id && hasOwn(cantMap, id) ? noticeWords(cantMap[id], { byDefault, offIn }) : '';
    if (!text) return null;
    const p = doc.createElement('span');
    p.className = 'layout-picker-notice';
    p.id = `${uid}-notice-${where}-${a}`;
    const icon = doc.createElement('i');
    icon.className = 'fa-solid fa-triangle-exclamation fa-fw';
    icon.setAttribute('aria-hidden', 'true');
    const words = doc.createElement('span');
    words.textContent = text;
    p.append(icon, words);
    return p;
  }
  function areaContent(holder, a) {
    const id = state.areas[a - 1];
    const m = id ? byId.get(id) || { id, name: id } : null;
    const n = doc.createElement('span');
    n.className = 'layout-picker-area-n';
    n.setAttribute('aria-hidden', 'true');
    n.textContent = String(a);
    const what = doc.createElement('span');
    what.className = 'layout-picker-area-what';
    const named = doc.createElement('span');
    named.className = 'layout-picker-area-label';
    named.setAttribute('aria-hidden', 'true');
    named.textContent = `Area ${a}`;
    if (m) {
      const name = doc.createElement('span');
      name.className = 'layout-picker-area-name';
      name.textContent = nameOf(id);
      what.append(iconFor(m), named, name);
    } else {
      const plus = doc.createElement('i');
      plus.className = 'fa-solid fa-plus fa-fw layout-picker-area-icon';
      plus.setAttribute('aria-hidden', 'true');
      const name = doc.createElement('span');
      name.className = 'layout-picker-area-name';
      name.textContent = 'Empty';
      what.append(...(readOnly ? [] : [plus]), named, name);
    }
    holder.append(n, what);
  }
  function areaControl(a, { row = false } = {}) {
    const count = state.shape.areas;
    const id = state.areas[a - 1];
    const spoken = areaName(a, count, id ? nameOf(id) : '');
    const box = doc.createElement(readOnly ? 'div' : 'button');
    box.className = row ? 'layout-picker-row-main' : 'layout-picker-area';
    box.dataset.area = String(a);
    if (!id) box.classList.add('empty');
    if (readOnly) { box.setAttribute('role', 'group'); box.setAttribute('aria-label', spoken); } else {
      box.type = 'button';
      box.setAttribute('aria-haspopup', 'menu');
      box.setAttribute('aria-expanded', 'false');
      box.setAttribute('aria-label', spoken);
      box.addEventListener('click', () => openArea(box, a));
    }
    areaContent(box, a);
    // The chevron before the notice, so in a row it stays at the end of the first line and the notice takes a line of its own.
    if (!readOnly) {
      const caret = doc.createElement('i');
      caret.className = 'fa-solid fa-chevron-down fa-fw layout-picker-area-caret';
      caret.setAttribute('aria-hidden', 'true');
      box.appendChild(caret);
    }
    const notice = noticeEl(a, id, row ? 'row' : 'board');
    if (notice) { box.appendChild(notice); box.setAttribute('aria-describedby', notice.id); box.classList.add('has-notice'); }
    return box;
  }
  function drawAreas() {
    board.replaceChildren();
    rows.replaceChildren();
    mini.replaceChildren();
    if (!state.shape) return;
    board.appendChild(drawShape(state.shape, (a) => areaControl(a)));
    mini.appendChild(drawShape(state.shape, smallArea, { picture: true }));
    for (let a = 1; a <= state.shape.areas; a += 1) {
      const li = doc.createElement('li');
      li.className = 'layout-picker-row';
      li.appendChild(areaControl(a, { row: true }));
      rows.appendChild(li);
    }
  }
  // The area's control as drawn now (the board, or the list in a narrow place).
  const shownControl = (a) => [...el.querySelectorAll(`[data-part="2"] [data-area="${a}"]:is(button, [role="group"])`)].find((x) => x.getClientRects().length) || null;

  // The menu for area `a`: Empty first, then what it may hold, the one in it now marked; a module in another area says
  // so and moves. A stacked area says in one line which modules can't go there and where they can.
  function menuFor(a) {
    const def = state.shape;
    const cur = state.areas[a - 1] || null;
    const pick = (id) => () => setArea(a, id);
    const entries = [
      { heading: `Area ${a} of ${def.areas}` },
      { label: 'Empty', icon: 'border-none', radio: true, checked: cur === null, onPick: pick(null) },
      { divider: true },
    ];
    const choices = areaChoices(def, a, list, { parts: compositeParts });
    for (const m of choices) {
      const other = state.areas.indexOf(m.id);
      const elsewhere = other >= 0 && other !== a - 1;
      entries.push({
        label: m.name || m.id,
        icon: m.icon || 'puzzle-piece',
        tint: m.tint,
        radio: true,
        checked: cur === m.id,
        ...(elsewhere ? { hint: `In area ${other + 1} now. It moves here.` } : {}),
        onPick: pick(m.id),
      });
    }
    if (!choices.length) entries.push({ label: fill('No {module} can go here.'), disabled: true });
    const refused = refusedNote(areaRefused(def, a, list, { parts: compositeParts }).map((m) => m.name || m.id), def);
    if (refused) {
      const p = doc.createElement('p');
      p.className = 'layout-picker-menu-note';
      p.textContent = refused;
      entries.push({ divider: true }, { element: p });
    }
    return entries;
  }
  function openArea(trigger, a) {
    if (readOnly || !state.shape) return;
    openHostMenu(trigger, menuFor(a));
  }
  // A choice made for area `a`: the module goes there (leaving any other area), the list a later shape change carries
  // from follows, and the keyboard stays on the area.
  function setArea(a, id) {
    if (!state.shape || readOnly) return;
    if (id && !areaMayHold(state.shape, a, id, { parts: compositeParts })) return;
    const { areas } = putInArea(state.areas, a, id);
    state.areas = areas;
    state.base = areas.slice();
    state.note = '';
    state.refusal = '';
    changed();
    const back = shownControl(a);
    if (back) back.focus();
  }

  // --- the steps ---
  let navButton = null;
  function setStep(n, { focus = false } = {}) {
    const want = n === 2 && state.shape ? 2 : 1;
    if (state.step === 1 && want === 2) state.base = state.areas.slice();
    state.step = readOnly ? 2 : want;
    draw();
    if (!focus) return;
    if (state.step === 2) (shownControl(1) || title2).focus();
    else (shapeButtons().find((b) => b.tabIndex === 0) || shapesEl).focus();
  }
  stepButtons.forEach((b) => b.addEventListener('click', () => setStep(Number(b.dataset.step), { focus: true })));

  function draw() {
    part1.hidden = state.step !== 1;
    part2.hidden = state.step !== 2;
    el.dataset.step = String(state.step);
    stepButtons.forEach((b) => {
      const n = Number(b.dataset.step);
      if (n === state.step) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
      b.disabled = n === 2 && !state.shape;
    });
    if (state.step === 2) drawAreas();
    noteEl.textContent = state.note;
    errorEl.textContent = state.refusal;
    errorEl.hidden = !state.refusal;
    if (navButton) {
      const back = state.step === 2;
      const arrow = doc.createElement('i');
      arrow.className = `fa-solid fa-arrow-${back ? 'left' : 'right'} fa-fw`;
      arrow.setAttribute('aria-hidden', 'true');
      const words = doc.createElement('span');
      words.textContent = back ? 'Back' : fill('Choose {modules}');
      navButton.replaceChildren(...(back ? [arrow, words] : [words, arrow]));
      navButton.disabled = !back && !state.shape;
    }
  }
  function changed() {
    draw();
    if (bar) bar.refresh();
    if (typeof onChange === 'function') onChange(valueOf());
  }

  // --- the bar ---
  let bar = null;
  if (withBar) {
    bar = actionBar({
      onSave: async () => {
        const record = valueOf();
        if (!record) return false;
        let result;
        try { result = typeof onSave === 'function' ? await onSave(record) : true; } catch (err) { refuse((err && err.message) || 'It was not saved.'); return false; }
        if (result === false) return false;
        kept = record;
        state.refusal = '';
        draw();
        // Save turns itself off once saved, which would leave the keyboard nowhere: it goes to the bar's Close.
        setTimeout(() => { const at = doc.activeElement; if (bar && (!at || at === doc.body || at === bar.saveButton || !el.contains(at))) bar.cancelButton.focus(); }, 0);
        return true;
      },
      onCancel: () => { closeHostMenu(); if (typeof onCancel === 'function') onCancel(); },
      dirty: () => !readOnly && Boolean(valueOf()) && !same(valueOf(), kept),
      readOnly,
      label: 'Layout actions',
      doc,
    });
    el.appendChild(bar.el);
    bar.bindEscape(el);
    if (!readOnly) {
      navButton = doc.createElement('button');
      navButton.type = 'button';
      navButton.className = 'btn btn-small layout-picker-nav';
      navButton.addEventListener('click', () => setStep(state.step === 2 ? 1 : 2, { focus: true }));
      bar.el.insertBefore(navButton, bar.el.firstChild);
    }
  }

  // A refusal (the server's own words) under the shape, in one line.
  function refuse(text) {
    state.refusal = String(text || '');
    draw();
  }

  // Start from `rec` ({ shape, areas } or null): its areas read as a shape change would read them, so an area naming
  // what it may not hold is emptied and said in one line, and a module named twice is kept once.
  function set(rec, { step: at = 0 } = {}) {
    const def = rec && typeof rec === 'object' ? shapeById(rec.shape) : null;
    state.refusal = '';
    if (def) {
      const carried = carryAreas(Array.isArray(rec.areas) ? rec.areas : [], def, mayHoldIn(def));
      state.shape = def;
      state.areas = carried.areas;
      state.note = droppedNote(carried.dropped, nameOf);
    } else {
      state.shape = null;
      state.areas = [];
      state.note = '';
    }
    state.base = state.areas.slice();
    kept = valueOf();
    state.step = readOnly ? 2 : at === 1 || at === 2 ? at : def ? 2 : 1;
    if (state.step === 2 && !def) state.step = 1;
    markShapes();
    draw();
    if (bar) bar.refresh();
  }

  drawShapes();
  set(record, { step: startStep });
  body.addEventListener('scroll', () => closeHostMenu(), { passive: true });

  return {
    el,
    value: valueOf,
    set,
    setStep: (n) => setStep(n, { focus: false }),
    step: () => state.step,
    refuse,
    // Who can't open each module, when it arrives after the picker was drawn (step 6's GET .../layouts answers it).
    setCantOpen: (map) => { cantMap = map && typeof map === 'object' ? map : null; draw(); },
    bar,
    destroy: () => { closeHostMenu(); el.remove(); },
  };
}
