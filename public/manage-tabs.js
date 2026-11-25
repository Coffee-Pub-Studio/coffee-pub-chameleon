// Manage tabs (documentation/plans/plan-workspaces.md, decision 43): the sheet the tab bar's "..." opens. Two lists, drawn
// with Set up's own tab rows (.setup-layout-row, "Tabs in the bar"):
//   From the owner  every tab the owner gives the space, in the owner's order, each locked ("Set by the owner"). A person
//                   can't move, hide, rename or re-icon these (decision 43); the owner changes them in Set up.
//   Yours           the workspaces this person added, after the owner's tabs in the bar, each with Move up, Move down and
//                   Remove. Buttons, not dragging, so the keyboard and a narrow sheet reorder the same way.
// It is an edit surface, so it follows the action-bar rule (public/action-bar.js): the moves and removals are a draft, Save
// sends them, Cancel and Escape drop them (asking first when something changed), and a click outside does nothing.
// The page does the work: `onSave({ order, removed })` gets the ids kept, in their new order, and the ids removed; it
// throws (an Error with the server's sentence) when it did not go through. After a failure the sheet asks `reload()` for
// this person's workspaces as the server has them now ([{ id, name }]), so one Save removed before failing is not listed
// again: what is left of the draft stays as the person left it, against the fresh list. Nothing here talks to the server.
import { escapeHtml } from '/brand.js';
import { actionBar } from '/action-bar.js';

const ICON = /^[a-z0-9][a-z0-9-]{0,39}$/;
const glyph = (icon, fallback) => `<i class="fa-solid fa-${ICON.test(icon || '') ? escapeHtml(icon) : fallback} fa-fw" aria-hidden="true"></i>`;

// `owners`: [{ icon, label }], the owner's tabs as the bar shows them. `own`: [{ id, name }], this person's, in their
// order. `ownerWord` and `spaceWord`: the environment's words. `canSetUp`: the person may change the owner's tabs in Set up.
// `opener`: the control the keyboard goes back to when the sheet closes. `reload`: see above.
export function openManageTabs({ doc = document, owners = [], own = [], ownerWord = 'owner', spaceWord = 'space', canSetUp = false, opener = null, onSave, reload = null }) {
  let kept = own.map((w) => ({ id: w.id, name: w.name }));
  let draft = kept.slice();
  const dlg = doc.createElement('dialog');
  dlg.className = 'layout-sheet manage-tabs-sheet';
  dlg.setAttribute('aria-labelledby', 'manage-tabs-title');
  dlg.innerHTML = `
    <form class="layout-form" novalidate>
      <div class="layout-form-body action-content">
        <h2 class="layout-sheet-title" id="manage-tabs-title">Manage tabs</h2>
        <section class="manage-tabs-section" aria-labelledby="manage-tabs-owner">
          <h3 class="setup-heading" id="manage-tabs-owner">From the ${escapeHtml(ownerWord)}</h3>
          <p class="manage-tabs-line">The ${escapeHtml(ownerWord)} chooses these and their order, for everyone in this ${escapeHtml(spaceWord)}.${canSetUp ? ' Change them in Set up, on the Layout tab.' : ''}</p>
          <ul class="setup-layout-rows" id="manage-tabs-owner-rows">${owners.map((t) => `<li class="setup-layout-row"><div class="setup-layout-head">${glyph(t.icon, 'object-group')}<span class="setup-layout-name">${escapeHtml(t.label)}</span><span class="manage-tabs-locked"><i class="fa-solid fa-lock fa-fw" aria-hidden="true"></i> Set by the ${escapeHtml(ownerWord)}</span></div></li>`).join('')}</ul>
        </section>
        <section class="manage-tabs-section" aria-labelledby="manage-tabs-yours">
          <h3 class="setup-heading" id="manage-tabs-yours">Yours</h3>
          <p class="manage-tabs-line" id="manage-tabs-yours-line"></p>
          <ul class="setup-layout-rows" id="manage-tabs-rows"></ul>
        </section>
        <p class="manage-tabs-live" id="manage-tabs-live" role="status" aria-live="polite"></p>
        <p class="layout-form-error" id="manage-tabs-error" role="alert" hidden></p>
      </div>
    </form>`;
  const form = dlg.querySelector('form');
  const rowsEl = dlg.querySelector('#manage-tabs-rows');
  const live = dlg.querySelector('#manage-tabs-live');
  const errorEl = dlg.querySelector('#manage-tabs-error');
  const removed = () => kept.filter((w) => !draft.some((d) => d.id === w.id));
  const changed = () => draft.length !== kept.length || draft.some((w, i) => w.id !== kept[i].id);

  // The person's rows, from the draft: drawn fresh on each change, the keyboard put back on the row it was on.
  function paint(focus = null) {
    const gone = removed();
    const line = dlg.querySelector('#manage-tabs-yours-line');
    line.textContent = kept.length
      ? `Workspaces you added. Only you see them, after the ${ownerWord}'s tabs.${gone.length ? ` Removed when you save: ${gone.map((w) => w.name).join(', ')}.` : ''}`
      : "You haven't added a workspace here. Add one with New workspace, in the tab bar's ... menu.";
    rowsEl.hidden = !draft.length;
    rowsEl.innerHTML = draft.map((w, i) => {
      const name = escapeHtml(w.name);
      return `<li class="setup-layout-row" data-own="${escapeHtml(w.id)}"><div class="setup-layout-head">${glyph('object-group', 'object-group')}<span class="setup-layout-name">${name}</span>
        <span class="setup-layout-move"><button type="button" class="btn btn-small" data-move="up" aria-label="Move ${name} up"${i === 0 ? ' disabled' : ''}><i class="fa-solid fa-arrow-up" aria-hidden="true"></i> Move up</button><button type="button" class="btn btn-small" data-move="down" aria-label="Move ${name} down"${i === draft.length - 1 ? ' disabled' : ''}><i class="fa-solid fa-arrow-down" aria-hidden="true"></i> Move down</button><button type="button" class="btn btn-small btn-danger" data-move="remove" aria-label="Remove ${name}"><i class="fa-solid fa-trash" aria-hidden="true"></i> Remove</button></span></div></li>`;
    }).join('');
    if (focus) {
      const row = rowsEl.querySelector(`[data-own="${CSS.escape(focus.id)}"]`);
      const target = (row && (row.querySelector(`[data-move="${focus.move}"]:not(:disabled)`) || row.querySelector('[data-move]:not(:disabled)')))
        || rowsEl.querySelector('[data-move]:not(:disabled)') || dlg.querySelector('#manage-tabs-yours');
      if (target && !target.matches('button')) target.tabIndex = -1;
      target?.focus();
    }
  }

  // The server's list after a failed Save: it becomes what Save compares against; the draft keeps its order and removals
  // for what is still there, and anything new there (added in another tab) is added at the end.
  function takeFresh(list) {
    if (!Array.isArray(list)) return;
    const fresh = list.map((w) => ({ id: w.id, name: w.name }));
    const has = (arr, id) => arr.some((w) => w.id === id);
    draft = [...draft.filter((d) => has(fresh, d.id)).map((d) => fresh.find((f) => f.id === d.id)), ...fresh.filter((f) => !has(kept, f.id))];
    kept = fresh;
    paint();
  }

  rowsEl.addEventListener('click', (event) => {
    const b = event.target.closest('[data-move]');
    if (!b || b.disabled) return;
    const id = b.closest('[data-own]').dataset.own;
    const i = draft.findIndex((w) => w.id === id);
    if (i < 0) return;
    const w = draft[i];
    const move = b.dataset.move;
    if (move === 'remove') {
      draft = draft.filter((x) => x.id !== id);
      const next = draft[Math.min(i, draft.length - 1)];
      paint(next ? { id: next.id, move: 'remove' } : { id: '', move: '' });
      live.textContent = `${w.name} will be removed when you save.`;
    } else {
      const to = move === 'up' ? i - 1 : i + 1;
      if (to < 0 || to >= draft.length) return;
      draft = draft.slice();
      draft.splice(i, 1);
      draft.splice(to, 0, w);
      paint({ id, move });
      live.textContent = `${w.name}: ${to + 1} of ${draft.length}.`;
    }
    errorEl.hidden = true;
    bar.refresh();
  });

  const bar = actionBar({
    label: 'Save your tabs',
    doc,
    ids: { save: 'manage-tabs-save', cancel: 'manage-tabs-cancel' },
    dirty: changed,
    onCancel: () => close(),
    onSave: async () => {
      try {
        await onSave({ order: draft.map((w) => w.id), removed: removed().map((w) => w.id) });
      } catch (err) {
        if (reload) {
          try { takeFresh(await reload()); } catch { /* the list stays as it was; the error below still says why */ }
        }
        errorEl.hidden = false;
        errorEl.textContent = err.message || 'That did not work. Try again.';
        return false;
      }
      close();
      return true;
    },
  });
  form.appendChild(bar.el);
  const close = () => { if (dlg.open) dlg.close(); };
  // No click on the backdrop closes it. Escape is Cancel, and asks first when something changed.
  bar.bindEscape(dlg);
  dlg.addEventListener('cancel', (event) => { event.preventDefault(); bar.requestCancel(); });
  form.addEventListener('submit', (event) => { event.preventDefault(); bar.save(); });
  dlg.addEventListener('close', () => {
    dlg.remove();
    if (opener && opener.isConnected && opener.getClientRects().length) opener.focus();
  });
  paint();
  doc.body.appendChild(dlg);
  dlg.showModal();
  (rowsEl.querySelector('[data-move]:not(:disabled)') || dlg.querySelector('#manage-tabs-cancel') || dlg).focus();
  return { close };
}
