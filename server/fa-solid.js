'use strict';

// Font Awesome Free's own solid icons, as this server ships them: the folder of their svgs (what a template's icons must
// be, server/templates.js) and whether an id is one of them (server/store.js: the icons in use it publishes). Read once.

const fs = require('fs');
const path = require('path');

const FA_FREE_SOLID = path.join(__dirname, '..', 'node_modules', '@fortawesome', 'fontawesome-free', 'svgs', 'solid');

let solid = null;
// Whether `id` is a Font Awesome Free solid icon (its svg is there). Without the folder, none is.
function isSolidIcon(id) {
  if (typeof id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(id)) return false;
  if (!solid) {
    try { solid = new Set(fs.readdirSync(FA_FREE_SOLID).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4))); } catch { solid = new Set(); }
  }
  return solid.has(id);
}

// The Font Awesome classes that are not an icon: the styles (Free's and Pro's), the sizes, fixed width, lists, borders and
// pulls, the animations, rotation and flipping, stacks and layers, and the screen-reader helpers. Free 7.3.1's own are
// every class in its css/all.css that names no svg (tools/check-reactions-icons.mjs keeps this list matched to the
// version installed). An icon's name is its last fa- class that is none of these (server/store.js iconName).
const FA_UTILITY = new Set([
  'solid', 'regular', 'brands', 'classic', 'light', 'thin', 'duotone', 'sharp', 'sharp-duotone',
  '2xs', 'xs', 'sm', 'lg', 'xl', '2xl', '1x', '2x', '3x', '4x', '5x', '6x', '7x', '8x', '9x', '10x',
  'fw', 'width-auto', 'width-fixed', 'ul', 'li', 'border', 'inverse', 'pull-left', 'pull-right', 'pull-start', 'pull-end',
  'beat', 'beat-fade', 'bounce', 'fade', 'flip', 'flip-360', 'shake', 'spin', 'spin-pulse', 'spin-reverse', 'spin-snap',
  'spin-snap-4', 'spin-snap-8', 'pulse', 'buzz', 'float', 'jello', 'swing', 'wag',
  'rotate-90', 'rotate-180', 'rotate-270', 'rotate-by', 'flip-horizontal', 'flip-vertical', 'flip-both',
  'stack', 'stack-1x', 'stack-2x', 'layers', 'layers-text', 'layers-counter', 'layers-top-left', 'layers-top-right',
  'layers-bottom-left', 'layers-bottom-right', 'canvas-roomy', 'canvas-square', 'sr-only', 'sr-only-focusable', 'swap-opacity',
]);
// Whether the class `fa-<name>` (given as `name`) is one of those rather than an icon.
const isIconUtility = (name) => FA_UTILITY.has(name);

module.exports = { FA_FREE_SOLID, isSolidIcon, FA_UTILITY, isIconUtility };
