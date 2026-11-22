// The host's own colour fields (a module's `color` setting, a list row's colour): the SDK's colour picker on each, through the page
// global /sdk/host.js sets (window.hostColour; plan-colour-picker.md, step 3), so a page and a module get the very same picker.
// The page draws a text input marked data-colour-field that holds '#rrggbb'; colourFields(root) puts the picker's trigger on each one
// not done yet, and the input stays, hidden, keeping the value the page reads and saves. These keep the colour only, so the picker
// shows no Opacity slider (decision 11). Without the SDK on the page the input is left as it is: a text field with the hex.
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

// The colours a new list row starts with, one after another (plan-colour-picker.md, open question 9, a try-build lean): the 24
// starting colours (window.hostColour.palette) in order, from Red, leaving out white, the greys and black (HSL saturation under 10
// percent) and the light ones (HSL lightness 65 percent or more). That is Red, Dark red, Orange, Brown, Yellow, Green, Dark green, Cyan,
// Teal, Blue, Dark blue, Purple and Magenta. Fixed, not the person's own grid, so a list looks the same for everyone.
export function newRowColours() {
  const start = window.hostColour && Array.isArray(window.hostColour.palette) ? window.hostColour.palette : [];
  return start.map((c) => c && c.color).filter((hex) => {
    if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/.test(hex)) return false;
    const n = parseInt(hex.slice(1), 16);
    const v = [n >> 16, (n >> 8) & 255, n & 255].map((x) => x / 255);
    const max = Math.max(...v);
    const min = Math.min(...v);
    const l = (max + min) / 2;
    const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
    return s >= 0.1 && l < 0.65;
  });
}
