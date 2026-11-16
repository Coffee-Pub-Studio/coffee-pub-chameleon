// The editor for a list setting (module.json `settings` of type "list"): rows of a label, an icon and a colour, to change, reorder,
// remove and add. Shared by the module settings forms (/module-settings.js) and a template's Modules page (/template-pages.js), so
// a list reads and edits the same wherever it is. Nothing here talks to the server; the page decides what to send.
import { escapeHtml } from '/brand.js';
import { upgradeColourInputs } from '/colour-pick.js';

// A list of things with a label, an icon and a colour each (Planner's marker types): rows to change, reorder, remove and add. The rows the
// module says are fixed (def.fixed: ids) are always there; their label, icon and colour can change but they cannot be removed.
// Icons are picked from a small set of Font Awesome names that suit a plan; the colour is a hex value.
const ICONS = ['flag', 'flag-checkered', 'plane-departure', 'plane-arrival', 'plane', 'train', 'car', 'ship', 'bus', 'bed', 'utensils', 'mug-hot', 'martini-glass', 'camera', 'mountain', 'umbrella-beach', 'person-walking', 'person-hiking', 'ticket', 'bell', 'clock', 'hourglass-half', 'moon', 'sun', 'face-smile', 'heart', 'star', 'users', 'shopping-bag', 'landmark', 'music', 'circle-exclamation', 'triangle-exclamation', 'location-dot', 'suitcase', 'gift', 'wine-glass', 'spa', 'bolt', 'note-sticky', 'city', 'dungeon', 'chess-rook', 'beer-mug-empty', 'skull', 'dragon', 'hat-wizard', 'compass', 'map', 'campground', 'church', 'house', 'store', 'tree', 'water', 'book', 'gem', 'shield-halved', 'fire', 'horse', 'anchor', 'monument', 'building', 'coins', 'scroll', 'khanda', 'tents'];
// The colours a list row stores, as data (the `color` field of an item, a value a person picks, not styling). The first is the
// grey that means "no colour chosen": the manifests store it, and it is what a row without a valid colour shows. The rest are what
// a new row starts with, one after another, so rows added in a run do not all look alike.
const ROW_COLORS = ['#888888', '#4f8fdd', '#e0883a', '#4caf7a', '#b268d8', '#d9534f', '#2fb5b5', '#c9a227', '#7f8fa6'];
const [NO_COLOR, ...NEW_COLORS] = ROW_COLORS;
const ICON_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HEX = /^#[0-9a-f]{6}$/i;
export function listRow(def, r) {
  const fixed = (def.fixed || []).includes(r.id);
  const color = HEX.test(r.color || '') ? r.color : NO_COLOR;
  const icon = ICONS.includes(r.icon) || ICON_RE.test(r.icon || '') ? r.icon : ICONS[0]; // a saved icon outside the picker stays as it is
  return `<li class="sdk-row list-row" data-id="${escapeHtml(r.id || '')}" data-icon="${escapeHtml(icon)}">
    <input type="color" data-f="color" value="${escapeHtml(color)}" aria-label="Colour">
    <details class="icon-pick"><summary aria-label="Icon" title="Icon"><i class="fa-solid fa-${escapeHtml(icon)} fa-fw" aria-hidden="true"></i></summary><div class="icon-grid">${ICONS.map((n) => `<button type="button" data-icon-choice="${n}" data-tip="${n.replace(/-/g, ' ')}" aria-label="${n.replace(/-/g, ' ')}"><i class="fa-solid fa-${n} fa-fw" aria-hidden="true"></i></button>`).join('')}</div></details>
    <input type="text" data-f="label" value="${escapeHtml(r.label || '')}" maxlength="${def.maxLength || 30}" placeholder="Label" aria-label="Label">
    <span class="list-tools"><button type="button" class="btn btn-small" data-list="up" data-tip="Move up" aria-label="Move up"><i class="fa-solid fa-arrow-up" aria-hidden="true"></i></button><button type="button" class="btn btn-small" data-list="down" data-tip="Move down" aria-label="Move down"><i class="fa-solid fa-arrow-down" aria-hidden="true"></i></button>${fixed ? '<span class="sdk-status">Built in</span>' : '<button type="button" class="btn btn-small btn-danger" data-list="remove" data-tip="Remove" aria-label="Remove"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>'}</span>
  </li>`;
}
export function listControl(def) {
  const rows = Array.isArray(def.value) ? def.value : [];
  const own = escapeHtml(JSON.stringify({ fixed: def.fixed || [], maxLength: def.maxLength || 30 }));
  return `<div class="list-setting" data-key="${escapeHtml(def.key)}" data-list-setting data-def="${own}"><div class="hint">${escapeHtml(def.label)}</div><ul class="list-rows">${rows.map((r) => listRow(def, r)).join('')}</ul><button type="button" class="btn btn-small" data-list="add"><i class="fa-solid fa-plus" aria-hidden="true"></i> Add</button></div>`;
}
// What the rows say now: [{ id, label, icon, color }] (a new row has no id: the server makes one from its label).
export function readList(el) {
  return [...el.querySelectorAll('.list-row')].map((li) => ({ id: li.dataset.id || '', label: li.querySelector('[data-f="label"]').value.trim(), icon: li.dataset.icon, color: li.querySelector('[data-f="color"]').value }));
}
// One click inside a list: an icon chosen, a row moved or removed, a row added. The list's own rules (`fixed`, `maxLength`) are in
// its data-def, so one listener on a whole page serves every list on it, drawn again or not.
export function listClick(event) {
  const el = event.target.closest('[data-list-setting]');
  if (!el) return;
  let def = {};
  try { def = JSON.parse(el.dataset.def || '{}'); } catch { def = {}; }
  const choice = event.target.closest('[data-icon-choice]');
  const li = event.target.closest('.list-row');
  if (choice && li) {
    li.dataset.icon = choice.dataset.iconChoice;
    li.querySelector('summary i').className = `fa-solid fa-${choice.dataset.iconChoice} fa-fw`;
    li.querySelector('details').open = false;
    return;
  }
  const b = event.target.closest('[data-list]');
  if (!b) return;
  const list = el.querySelector('.list-rows');
  if (b.dataset.list === 'add') {
    list.insertAdjacentHTML('beforeend', listRow(def, { id: '', label: '', icon: 'flag', color: NEW_COLORS[list.children.length % NEW_COLORS.length] }));
    upgradeColourInputs(list.lastElementChild);
    list.lastElementChild.querySelector('[data-f="label"]').focus();
  } else if (li && b.dataset.list === 'remove') li.remove();
  else if (li && b.dataset.list === 'up' && li.previousElementSibling) li.previousElementSibling.before(li);
  else if (li && b.dataset.list === 'down' && li.nextElementSibling) li.nextElementSibling.after(li);
}
export const wireList = (el) => el.addEventListener('click', listClick);

// A list in a sentence: how many rows and the first few labels ("3 in the list: Travel, Lodging, Food").
export function listWords(v) {
  const rows = Array.isArray(v) ? v : [];
  if (!rows.length) return 'Empty';
  const names = rows.slice(0, 4).map((r) => (r && r.label) || '').filter(Boolean);
  return `${rows.length} in the list: ${names.join(', ')}${rows.length > names.length ? ` and ${rows.length - names.length} more` : ''}`;
}
