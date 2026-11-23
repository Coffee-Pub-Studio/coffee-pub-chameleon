// The mark on a space a set-up agent made, and its Keep button (plan-admin-agent.md, "Marked"). One piece for Manage's spaces list
// and Home, so it reads and behaves the same in both. The mark shows while the space carries `madeBy` and goes when an owner
// chooses Keep (PATCH /api/spaces/:id { madeBy: null }, owners and the admin only). Text only.
import { confirmDialog } from '/confirm.js';

export const MADE_BY = 'Made by Claude (set-up agent)';

// Draws the mark into `box` (emptied first). `space`: a space as the server lists it. `show` is false for anyone who can't choose Keep
// (a member sees no mark). `api(method, url, body)` is the page's own; `word(w, opts)` its words; `onKept(space)` is told after the
// server has cleared the mark; `onError(text)` gets a refusal's sentence.
export function drawMadeMark(box, space, { show = true, api, word, onKept = () => {}, onError = () => {} }) {
  const on = Boolean(show && space && typeof space.madeBy === 'string' && space.madeBy);
  const stamp = on ? `${space.id}|${space.name}` : '';
  if (box.dataset.drawn === stamp && box.hidden === !on) return; // a list that draws again every few seconds leaves it, and its focus, alone
  box.dataset.drawn = stamp;
  box.replaceChildren();
  box.hidden = !on;
  if (!on) return;
  const chip = document.createElement('span');
  chip.className = 'sdk-status made-mark';
  chip.textContent = MADE_BY;
  const keep = document.createElement('button');
  keep.type = 'button';
  keep.className = 'btn btn-small made-keep';
  keep.dataset.madeKeep = space.id;
  keep.textContent = 'Keep';
  keep.addEventListener('click', async (event) => {
    event.stopPropagation(); // a card enters its space on a click; this is not that
    const ok = await confirmDialog({
      title: `Keep ${space.name ? `"${space.name}"` : `this ${word('space')}`}?`,
      message: `It stays as it is, and the set-up agent can no longer change it.`,
      action: 'Keep',
    });
    if (!ok) return;
    keep.disabled = true;
    try {
      await api('PATCH', `/api/spaces/${encodeURIComponent(space.id)}`, { madeBy: null });
      onKept(space);
    } catch (err) {
      keep.disabled = false;
      onError(err.message);
    }
  });
  box.append(chip, keep);
}
