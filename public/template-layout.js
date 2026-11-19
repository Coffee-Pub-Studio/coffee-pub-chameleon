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
//   part.update({ modules, others, parts, ticked })   the template's modules changed (the picker is drawn again)
//
// The holder keeps the valid record as JSON in `data-tw-layout` (template-pages.js's readWorkspace reads it there).
import { createLayoutPicker, partsFor, MODULE_ID } from '/layout-picker.js';
import { shapeById } from '/layout-shapes.js';
import { COLUMN_IDS } from '/layouts.js';

// --- the pure parts (tools/check-layout-picker.mjs runs them in node) ----------------------------------------------------

// `value` as a record the server's shape check can take, or null: a known shape, as many areas as it has, each a
// module id (MODULE_ID) or null, no module twice. Saving sends `workspace.layout` only when this is not null.
export function layoutRecord(value) {
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
  const r = layoutRecord(record);
  if (!r) return [];
  const have = new Set(Array.isArray(ids) ? ids : []);
  return r.areas.filter((id) => id && !have.has(id));
}

const andList = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || '');

// The line beside the picker for modules the layout uses that are no longer ticked: what the server would refuse, said
// before saving. `where` names the part they are ticked in (the environment's word for modules, plural, capitalised: the
// Modules part). '' when there are none.
//   "The layout uses Goals, which is not ticked under Modules. Tick it again, or take it out of the layout."
export function missingNote(names, { where = '' } = {}) {
  const list = (Array.isArray(names) ? names : []).filter((x) => typeof x === 'string' && x);
  if (!list.length) return '';
  const many = list.length > 1;
  return `The layout uses ${andList(list)}, which ${many ? 'are' : 'is'} not ticked under ${where}. Tick ${many ? 'them' : 'it'} again, or take ${many ? 'them' : 'it'} out of the layout.`;
}

// The same, said where the modules are ticked (the host console's Modules tab), naming where the layout is:
//   "The layout on the Default Workspace tab uses Goals. Tick it again, or take it out of the layout there."
export function usesNote(names, { where = 'the Default Workspace tab' } = {}) {
  const list = (Array.isArray(names) ? names : []).filter((x) => typeof x === 'string' && x);
  if (!list.length) return '';
  const many = list.length > 1;
  return `The layout on ${where} uses ${andList(list)}. Tick ${many ? 'them' : 'it'} again, or take ${many ? 'them' : 'it'} out of the layout there.`;
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
  let picker = null;
  let current = layoutRecord(record);
  let started = Boolean(current); // a picker is shown (a layout, or "Pick a shape" pressed)

  const keep = () => {
    holder.dataset.twLayout = current ? JSON.stringify(current) : '';
    holder.classList.toggle('tp-layout-none', !started);
  };
  const partName = where || word('module', { many: true, cap: true });
  const missingText = () => (Array.isArray(opts.ticked) ? missingNote(layoutMissing(current, opts.ticked).map(nameOf), { where: partName }) : '');

  let noteEl = null;
  function drawNote() {
    if (!noteEl) return;
    const text = missingText();
    noteEl.textContent = text; // an empty live region stays in place (no height), so the line is heard when it comes
  }

  function makePicker(rec, step) {
    if (picker) picker.destroy();
    picker = createLayoutPicker({
      doc,
      record: rec,
      modules: opts.modules,
      others: opts.others,
      parts: Array.isArray(opts.parts) ? opts.parts : partsFor(opts.modules.map((m) => m.id)),
      cantOpen,
      byDefault,
      offIn,
      readOnly,
      bar: false,
      step,
      label: 'Layout',
      onChange: (v) => {
        current = layoutRecord(v);
        keep();
        drawNote();
        if (typeof onChange === 'function') onChange(current);
      },
    });
    // A record read in may lose what the shape can't hold (the picker says so): what it holds now is what is kept.
    current = layoutRecord(picker.value());
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
          draw({ focus: 'shape' });
          if (typeof onChange === 'function') onChange(current);
        });
        holder.append(add);
        if (focus === 'add') add.focus();
      }
      keep();
      return;
    }
    makePicker(current, current ? 2 : 1);
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
    // The template's modules changed: the picker is drawn again on what it holds, at the step it was on.
    update(next = {}) {
      for (const k of ['modules', 'others', 'parts', 'ticked']) if (Object.prototype.hasOwnProperty.call(next, k)) opts[k] = next[k];
      if (!started) { drawNote(); return; }
      const step = picker ? picker.step() : (current ? 2 : 1);
      const had = picker && picker.el.contains(doc.activeElement);
      const wasAt = picker ? picker.value() : current;
      picker.destroy();
      picker = null;
      const fresh = makePicker(wasAt, step);
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
