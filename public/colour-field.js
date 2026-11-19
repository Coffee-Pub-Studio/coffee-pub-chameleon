// The host's own colour fields (a module's `color` setting, a list row's colour): the SDK's colour picker on each, through the page
// global /sdk/host.js sets (window.hostColour; plan-colour-picker.md, step 3), so a page and a module get the very same picker.
// The page draws a text input marked data-colour-field that holds '#rrggbb'; colourFields(root) puts the picker's trigger on each one
// not done yet, and the input stays, hidden, keeping the value the page reads and saves. These keep the colour only, so the Opacity
// slider is shown switched off (decision 11). Without the SDK on the page the input is left as it is: a text field with the hex.
import { closeHostMenu } from '/host-menu.js';

// The field's own name, for the trigger's accessible name: its aria-label, else its <label>'s first words.
function nameOf(input) {
  const own = input.getAttribute('aria-label');
  if (own) return own;
  const label = input.closest('label');
  const first = label && label.firstChild && label.firstChild.nodeType === 3 ? label.firstChild.textContent.trim() : '';
  return first || 'Colour';
}

export function colourFields(root) {
  const page = window.hostColour;
  if (!page || !root) return;
  for (const input of root.querySelectorAll('input[data-colour-field]:not([data-colour-ready])')) {
    input.dataset.colourReady = '';
    page.field(input, { opacity: false, label: nameOf(input) });
    // The page's own menu (host-menu.js) closes before the picker opens, so the two are never open together. A capture listener
    // on the trigger runs before the field's own click.
    const trigger = input.previousElementSibling;
    if (trigger && trigger.classList.contains('sdk-picker')) trigger.addEventListener('click', () => closeHostMenu(), true);
  }
}

// The colours a new list row starts with, one after another: the default palette's Strong group (window.hostColour.palette).
export function newRowColours() {
  const palette = window.hostColour && Array.isArray(window.hostColour.palette) ? window.hostColour.palette : [];
  const strong = palette.find((g) => g.heading === 'Strong') || palette[palette.length - 1];
  return strong ? strong.colours.map((c) => c.color) : [];
}
