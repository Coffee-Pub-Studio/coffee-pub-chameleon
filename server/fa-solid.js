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

module.exports = { FA_FREE_SOLID, isSolidIcon };
