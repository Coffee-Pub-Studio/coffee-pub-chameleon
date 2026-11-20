// A template's layout in its editor (plan-layout-picker.md, step 5): the Default Workspace part of the host console's
// template editor (host-templates.js) and of Manage's own-template page (admin.js, template-pages.js) draw the layout
// picker (layout-picker.js) in place of the plain line. The editor's own Save carries the layout, so the picker has no
// bar of its own (`bar: false`) and this piece keeps what it holds:
//   - a layout: the picker, opened on its areas, and "Remove the layout";
//   - no layout (Gaming, or one removed): a line saying so in plain words, and "Pick a shape" to add one;
//   - read only (a shipped template in Manage, the Default template in the console): the picker read only, with its
//     notices, and nothing to press.
// The areas offer the template's own modules that have a place on the canvas (the server's rule: surfaces.canvas; never
// the chat or the call), and the Calendar rule reads the template's modules (`parts`, as the server's `on`). The maker's
// notice comes from the editor route's `cantOpen` ("by default" in the host console). A module the layout uses that is no
// longer ticked is still drawn by name, never offered, and a line beside the picker says so before saving.
//
//   const part = mountTemplateLayout(holder, { record, modules, parts, cantOpen, byDefault, readOnly, word });
//   part.value()   -> { shape, areas } when it is a valid record, else null (nothing to send)
//   part.update({ modules, others, parts, ticked })   the template's modules changed (the picker is drawn again from the
//                  arrangement the person made, and a line says what moved)
//
// The holder keeps the valid record as JSON in `data-tw-layout` (template-pages.js's readWorkspace reads it there).
import { createLayoutPicker, partsFor, cleanText, MODULE_ID } from '/layout-picker.js';
import { shapeById } from '/layout-shapes.js';
import { COLUMN_IDS, areaMayHold } from '/layouts.js';

// --- the pure parts (tools/check-layout-picker.mjs runs them in node) ----------------------------------------------------

// `value` as a shape and its areas, or null: a known shape, as many areas as it has, each a module id (MODULE_ID) or
// null, no module twice. What an area may hold is not asked: this is the arrangement as the person made it.
function areasOf(value) {
  if (!value || typeof value !== 'object') return null;
  const def = shapeById(value.shape);
  if (!def || !Array.isArray(value.areas) || value.areas.length !== def.areas) return null;
  const seen = new Set();
  for (const id of value.areas) {
    if (id === null) continue;
    if (typeof id !== 'string' || !MODULE_ID.test(id) || id === '__proto__' || seen.has(id)) return null;
    seen.add(id);
  }
  return { shape: def.id, areas: value.areas.slice() };
}

// `value` as a record the server's shape check takes, or null. Saving sends `workspace.layout` only when this is not
// null. Besides the form (areasOf), each area must be able to hold its module by the picker's own rule (layouts.js's
// areaMayHold, the one the canvas uses): never the chat or the call, and in a stacked area no Calendar or Maps, nor an
// id in `parts` (To-do while the Calendar is on: partsFor of the template's modules, as the server's `on`). Without
// `parts`, the Calendar counts as a composite, as the server reads a layout it is not told about. Whether a module is
// one of the template's is left to the server (it says so in one sentence, and the page says it first: missingNote).
export function layoutRecord(value, { parts = ['todo'] } = {}) {
  const r = areasOf(value);
  if (!r) return null;
  const def = shapeById(r.shape);
  const list = Array.isArray(parts) ? parts : [];
  return r.areas.every((id, i) => id === null || areaMayHold(def, i + 1, id, { parts: list })) ? r : null;
}

// The modules a template's areas may offer, [{ id, name, icon }] in the order given: each of `ids` (the template's
// modules; every catalog module for the Default template's "*") that has a place on the canvas (`isCanvas(id)`), never
// the chat or the call, each once.
export function templateLayoutModules(ids, { isCanvas = () => true, nameOf = (id) => id, iconOf = () => 'puzzle-piece' } = {}) {
  const seen = new Set();
  const out = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    if (typeof id !== 'string' || !MODULE_ID.test(id) || COLUMN_IDS.includes(id) || seen.has(id) || !isCanvas(id)) continue;
    seen.add(id);
    out.push({ id, name: nameOf(id) || id, icon: iconOf(id) || 'puzzle-piece' });
  }
  return out;
}

// The modules `record` puts in an area that are not among `ids` (the modules ticked now), in area order.
export function layoutMissing(record, ids) {
  const r = areasOf(record);
  if (!r) return [];
  const have = new Set(Array.isArray(ids) ? ids : []);
  return r.areas.filter((id) => id && !have.has(id));
}

const andList = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || '');
// The names a line says, as the picker draws them (cleanText: no control or direction characters, at most 60), each a word.
const namesIn = (names) => (Array.isArray(names) ? names : []).map(cleanText).filter(Boolean);

// The line beside the picker for modules the layout uses that are no longer ticked: what the server would refuse, said
// before saving. `where` names the part they are ticked in (the environment's word for modules, plural, capitalised: the
// Modules part). '' when there are none.
//   "The layout uses Goals, which is not ticked under Modules. Tick it again, or take it out of the layout."
export function missingNote(names, { where = '' } = {}) {
  const list = namesIn(names);
  if (!list.length) return '';
  const many = list.length > 1;
  return `The layout uses ${andList(list)}, which ${many ? 'are' : 'is'} not ticked under ${where}. Tick ${many ? 'them' : 'it'} again, or take ${many ? 'them' : 'it'} out of the layout.`;
}

// The same, said where the modules are ticked (the host console's Modules tab), naming where the layout is:
//   "The layout on the Default Workspace tab uses Goals. Tick it again, or take it out of the layout there."
export function usesNote(names, { where = 'the Default Workspace tab' } = {}) {
  const list = namesIn(names);
  if (!list.length) return '';
  const many = list.length > 1;
  return `The layout on ${where} uses ${andList(list)}. Tick ${many ? 'them' : 'it'} again, or take ${many ? 'them' : 'it'} out of the layout there.`;
}

// What moved when the template's modules changed under the layout (plan decision 25: modules move, they are not dropped,
// and a short line says what moved): `before` is the arrangement the person made, `after` the one the picker now holds.
// A module that could no longer stay in its area says why; one moved out of the way says which area it freed.
//   "Maps moved to area 1: it can't share a column. Itinerary moved to area 3 to free area 1."
// `mayHold(area, id)` is the rule now. '' when nothing moved.
export function movedNote(before, after, { nameOf = (id) => id, mayHold = () => true } = {}) {
  const b = areasOf(before);
  const a = areasOf(after);
  if (!b || !a) return '';
  const name = (id) => cleanText(nameOf(id)) || id;
  const pushed = [];
  const shifted = [];
  a.areas.forEach((id, i) => {
    const was = id ? b.areas.indexOf(id) : -1;
    if (was < 0 || was === i) return;
    if (!mayHold(was + 1, id)) pushed.push(`${name(id)} moved to area ${i + 1}: it can't share a column.`);
    else shifted.push(`${name(id)} moved to area ${i + 1} to free area ${was + 1}.`);
  });
  return [...pushed, ...shifted].join(' ');
}

// The line for a template with no layout.
export const noLayoutWords = (word) => `No layout. A new ${word('space')} opens the chat and every ${word('module')} that is on.`;

// --- the piece -------------------------------------------------------------------------------------------------------------

export function mountTemplateLayout(holder, {
  record = null,
  modules = [],
  others = [],
  parts = null,
  cantOpen = null,
  byDefault = false,
  offIn = 'space',
  readOnly = false,
  ticked = null,
  where = '',
  word = (key) => key,
  nameOf = (id) => id,
  onChange = null,
} = {}) {
  const doc = holder.ownerDocument;
  const opts = { modules, others, parts, ticked };
  const partsNow = () => (Array.isArray(opts.parts) ? opts.parts : partsFor(opts.modules.map((m) => m.id)));
  let picker = null;
  // The arrangement the person made (or the one read in): what a change of the template's modules is worked out from
  // again, so ticking the Calendar and unticking it again gives the person's arrangement back.
  let base = areasOf(record);
  let current = layoutRecord(base, { parts: partsNow() });
  let moved = ''; // what the last change of the template's modules moved (movedNote), until the person changes something
  let started = Boolean(base); // a picker is shown (a layout, or "Pick a shape" pressed)

  const keep = () => {
    holder.dataset.twLayout = current ? JSON.stringify(current) : '';
    holder.classList.toggle('tp-layout-none', !started);
  };
  const partName = where || word('module', { many: true, cap: true });
  const missingText = () => (Array.isArray(opts.ticked) ? missingNote(layoutMissing(current, opts.ticked).map(nameOf), { where: partName }) : '');

  let noteEl = null;
  function drawNote() {
    if (!noteEl) return;
    const text = [moved, missingText()].filter(Boolean).join(' ');
    noteEl.textContent = text; // an empty live region stays in place (no height), so the line is heard when it comes
  }

  function makePicker(rec, step) {
    if (picker) picker.destroy();
    picker = createLayoutPicker({
      doc,
      record: rec,
      modules: opts.modules,
      others: opts.others,
      parts: partsNow(),
      cantOpen,
      byDefault,
      offIn,
      readOnly,
      bar: false,
      step,
      label: 'Layout',
      onChange: (v) => {
        base = areasOf(v);
        current = layoutRecord(v, { parts: partsNow() });
        moved = '';
        keep();
        drawNote();
        if (typeof onChange === 'function') onChange(current);
      },
    });
    // A record read in may lose what the shape can't hold (the picker says so): what it holds now is what is kept.
    current = layoutRecord(picker.value(), { parts: partsNow() });
    return picker;
  }

  function draw({ focus = '' } = {}) {
    if (picker) { picker.destroy(); picker = null; }
    holder.replaceChildren();
    noteEl = null;
    if (!started) {
      const p = doc.createElement('p');
      p.className = 'tp-layout-words';
      p.textContent = noLayoutWords(word);
      holder.append(p);
      if (!readOnly) {
        const add = doc.createElement('button');
        add.type = 'button';
        add.className = 'btn btn-small tp-layout-button';
        add.dataset.layoutAdd = '';
        add.innerHTML = '<i class="fa-solid fa-table-columns fa-fw" aria-hidden="true"></i><span>Pick a shape</span>';
        add.addEventListener('click', () => {
          started = true;
          base = null;
          moved = '';
          draw({ focus: 'shape' });
          if (typeof onChange === 'function') onChange(current);
        });
        holder.append(add);
        if (focus === 'add') add.focus();
      }
      keep();
      return;
    }
    // From the arrangement the person made or read in (as update() does), not from the checked record: a record the page's
    // rule refuses (To-do stacked while the Calendar is on) is read by the picker, which moves or says what it can't hold,
    // so the arrangement is never dropped. The server checks it again on Save.
    makePicker(base, base ? 2 : 1);
    // The line about modules no longer ticked goes above the picker, where it is seen before the areas and before Save.
    noteEl = doc.createElement('p');
    noteEl.className = 'tp-layout-missing';
    noteEl.setAttribute('role', 'status');
    holder.append(noteEl, picker.el);
    drawNote();
    if (!readOnly) {
      const remove = doc.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-small tp-layout-button';
      remove.dataset.layoutRemove = '';
      remove.innerHTML = '<i class="fa-solid fa-xmark fa-fw" aria-hidden="true"></i><span>Remove the layout</span>';
      remove.addEventListener('click', () => {
        started = false;
        current = null;
        base = null;
        moved = '';
        draw({ focus: 'add' });
        if (typeof onChange === 'function') onChange(current);
      });
      const row = doc.createElement('div');
      row.className = 'tp-layout-actions';
      row.append(remove);
      holder.append(row);
    }
    keep();
    if (focus === 'shape') (picker.el.querySelector('.layout-picker-shape[tabindex="0"]') || picker.el).focus();
  }

  draw();

  return {
    value: () => current,
    // The arrangement the person made, which a change of the template's modules is worked out from ({ shape, areas } or null).
    arrangement: () => (base ? { shape: base.shape, areas: base.areas.slice() } : null),
    // The template's modules changed: the picker is drawn again, at the step it was on, from the arrangement the person
    // made (not from what the last change left), and a line says what that moved.
    update(next = {}) {
      for (const k of ['modules', 'others', 'parts', 'ticked']) if (Object.prototype.hasOwnProperty.call(next, k)) opts[k] = next[k];
      if (!started) { drawNote(); return; }
      const step = picker ? picker.step() : (base ? 2 : 1);
      const had = picker && picker.el.contains(doc.activeElement);
      if (picker) picker.destroy();
      picker = null;
      const fresh = makePicker(base, step);
      const def = base ? shapeById(base.shape) : null;
      moved = def ? movedNote(base, fresh.value(), { nameOf, mayHold: (area, id) => areaMayHold(def, area, id, { parts: partsNow() }) }) : '';
      holder.insertBefore(fresh.el, noteEl.nextSibling);
      keep();
      drawNote();
      if (had) (fresh.el.querySelector('.layout-picker-area, .layout-picker-shape[tabindex="0"]') || fresh.el).focus();
    },
    missing: () => missingText(),
    // The modules the layout uses that are not ticked now, in area order (none when the ticks are not known here).
    missingIds: () => (Array.isArray(opts.ticked) ? layoutMissing(current, opts.ticked) : []),
    destroy: () => { if (picker) picker.destroy(); holder.replaceChildren(); },
  };
}
