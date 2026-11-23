// A template's tab list (plan-template-tab-list.md): one row per layout in the order a new space shows them, each with a Show
// check, Move up and Move down. The rows are Set up's Tabs in the bar rows (space-setup.js, the Layout tab: the same classes and markup, without its
// Opens first radio): the first shown row is the one that opens first, so it carries the mark. The list lives in the page: a
// move reorders the rows, and `readTabList` reads them back as the template's `workspace.tabs`, [{ id, show }].
// Both template editors (the host console and Manage) draw and read it through here.
import { escapeHtml } from '/brand.js';

const e = escapeHtml;
export const TAB_IDS = ['workspace', 'calendar', 'map', 'conference', 'whiteboard', 'documents', 'schedule'];
const NAMES = { workspace: 'Workspace', calendar: 'Calendar', map: 'Map', conference: 'Conference', whiteboard: 'Whiteboards', documents: 'Documents', schedule: 'Projects' };
const ICONS = { workspace: 'columns', calendar: 'calendar-days', map: 'map-location-dot', conference: 'video', whiteboard: 'chalkboard', documents: 'file-lines', schedule: 'diagram-project' };
export const tabName = (id) => NAMES[id] || id;

// The rows a list draws, whole: the listed rows in their order, then every layout it leaves out, hidden, in the default
// order (the Workspace is never hidden). No list is today's default: every layout shown, the Workspace first.
export function tabRows(tabs) {
  const seen = new Set();
  const rows = [];
  for (const r of Array.isArray(tabs) ? tabs : []) {
    if (!r || typeof r !== 'object' || !TAB_IDS.includes(r.id) || seen.has(r.id)) continue;
    seen.add(r.id);
    rows.push({ id: r.id, show: r.id === 'workspace' || r.show === true });
  }
  if (!rows.length) return TAB_IDS.map((id) => ({ id, show: true }));
  return [...rows, ...TAB_IDS.filter((id) => !seen.has(id)).map((id) => ({ id, show: id === 'workspace' }))];
}
// The row that opens first: the first one shown.
const firstOf = (rows) => (rows.find((r) => r.show) || {}).id;
const mark = '<span class="sdk-status" data-tone="ok" data-tab-first>Opens first</span>';

// The list as markup. Read only: names in order, hidden ones said, the first one marked, no controls.
export function tabListHtml(tabs, { editable }) {
  const rows = tabRows(tabs);
  const first = firstOf(rows);
  if (!editable) {
    return `<ol class="tp-phase-list" data-tab-read>${rows.map((r) => `<li>${e(tabName(r.id))}${r.show ? '' : ' <span class="hint">(hidden)</span>'}${r.id === first ? ` ${mark}` : ''}</li>`).join('')}</ol>`;
  }
  const items = rows.map((r, i) => {
    const name = e(tabName(r.id));
    const locked = r.id === 'workspace';
    return `<li class="setup-layout-row" data-tab-id="${e(r.id)}">
        <div class="setup-layout-head"><i class="fa-solid fa-${ICONS[r.id]} fa-fw" aria-hidden="true"></i><span class="setup-layout-name" data-tab-name>${name}</span>${r.id === first ? mark : ''}
          <span class="setup-layout-move"><button type="button" class="btn btn-small" data-tab-move="up" aria-label="Move ${name} up"${i === 0 ? ' disabled' : ''}><i class="fa-solid fa-arrow-up" aria-hidden="true"></i> Move up</button><button type="button" class="btn btn-small" data-tab-move="down" aria-label="Move ${name} down"${i === rows.length - 1 ? ' disabled' : ''}><i class="fa-solid fa-arrow-down" aria-hidden="true"></i> Move down</button></span></div>
        <div class="setup-layout-controls">
          <label class="sdk-choice-row setup-layout-show"><span class="sdk-choice-text"><span class="sdk-choice-label">Show in the bar</span>${locked ? '<span class="sdk-choice-desc">The Workspace is always shown.</span>' : ''}</span><input type="checkbox" class="sdk-switch" role="switch" data-tab-show aria-label="Show ${name} in the bar"${r.show ? ' checked' : ''}${locked ? ' disabled' : ''}></label>
        </div></li>`;
  }).join('');
  return `<ul class="setup-layout-rows" data-tab-list>${items}</ul><p class="visually-hidden" data-tab-live role="status" aria-live="polite"></p>`;
}

// What the rows say now, the first shown one marked and the ends' buttons off. Called after every move or Show change.
function settle(list) {
  const items = [...list.querySelectorAll('[data-tab-id]')];
  const first = items.find((li) => li.querySelector('[data-tab-show]').checked);
  items.forEach((li, i) => {
    li.querySelector('[data-tab-move="up"]').disabled = i === 0;
    li.querySelector('[data-tab-move="down"]').disabled = i === items.length - 1;
    const has = li.querySelector('[data-tab-first]');
    if (li === first && !has) li.querySelector('.setup-layout-move').insertAdjacentHTML('beforebegin', mark);
    else if (li !== first && has) has.remove();
  });
}
export const settleTabList = (root) => { const list = root.querySelector('[data-tab-list]'); if (list) settle(list); };

// A press on a Move button anywhere under `root`: the row goes past its neighbour, the live region says where it is now,
// and the focus stays on the pressed button (the other one when that end has no further to go). True when it was one.
export function tabListClick(ev) {
  const button = ev.target.closest ? ev.target.closest('[data-tab-move]') : null;
  if (!button || button.disabled) return false;
  const li = button.closest('[data-tab-id]');
  const list = li.parentElement;
  const down = button.dataset.tabMove === 'down';
  const other = down ? li.nextElementSibling : li.previousElementSibling;
  if (!other) return true;
  if (down) list.insertBefore(other, li);
  else list.insertBefore(li, other);
  settle(list);
  const place = [...list.children].indexOf(li) + 1;
  const live = list.parentElement.querySelector('[data-tab-live]');
  if (live) live.textContent = `${li.querySelector('[data-tab-name]').textContent} moved to position ${place}.`;
  (button.disabled ? li.querySelector('[data-tab-move]:not(:disabled)') : button)?.focus();
  return true;
}
// A change of a Show check anywhere under `root`; True when it was one.
export function tabListChange(ev) {
  if (!ev.target.matches || !ev.target.matches('[data-tab-show]')) return false;
  settle(ev.target.closest('[data-tab-list]'));
  return true;
}

// The rows as the template's `workspace.tabs`, in the order on the page; null while they are the default (every layout shown,
// in the default order), which a template says by leaving the list out. Null too with no list on the page (read only).
export function readTabList(root) {
  const items = [...root.querySelectorAll('[data-tab-id]')];
  if (!items.length) return null;
  const rows = items.map((li) => ({ id: li.dataset.tabId, show: li.querySelector('[data-tab-show]').checked }));
  return rows.every((r, i) => r.show && r.id === TAB_IDS[i]) ? null : rows;
}
