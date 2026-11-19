// Plan Verify step 3 (colour picker, #933): no file in public/ draws <input type="color"> for a person to use.
// Everything uses the SDK's colour picker (host.ui.colorPicker / colorField), except:
//   - public/admin.html's theme editor: an <input type="color"> whose id starts with "theme-" (any other colour input there fails);
//   - public/design-system/: the Design System pages show the native input only as a specimen of the global form rule.
// public/admin.js has no colour input and is not allowed one.
// CSS selectors (input[type="color"] in a .css file, or inside a string of selectors) are not markup and are not counted (only .js and .html are read).
//
// What is flagged, in .js and .html files:
//   - an <input ...> tag (also split over lines) whose attributes hold type=color, with or without quotes;
//   - .type = 'color', ["type"] = "color" and setAttribute("type", "color"), in any of ' " or ` quotes.
//   - { type: 'color' } as an object literal, ONLY in a file that creates elements (createElement, innerHTML, insertAdjacentHTML,
//     or an <input tag). Module settings declare a colour as { type: 'color' } in plain data (a settings definition), which draws
//     nothing by itself; a file that builds elements could pass that object to something that draws the native input, so it is held to the rule.
// The rule is by file because a definition and the element that draws it are not told apart by reading one line.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'public');
const Q = '[\'"`]';
const THEME_ID = /^theme-/;
const tagColour = new RegExp(`\\btype\\s*=\\s*${Q}?color\\b`, 'i');
const code = [
  new RegExp(`\\.type\\s*=\\s*${Q}color${Q}`),
  new RegExp(`\\[\\s*${Q}type${Q}\\s*\\]\\s*=\\s*${Q}color${Q}`),
  new RegExp(`setAttribute\\(\\s*${Q}type${Q}\\s*,\\s*${Q}color${Q}`),
];
const literal = new RegExp(`\\btype\\s*:\\s*${Q}color${Q}`);
const createsElements = /createElement\s*\(|\.innerHTML\b|insertAdjacentHTML\s*\(|<input\b/;

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.(js|html)$/.test(e.name)) files.push(f);
  }
})(root);

const bad = [];
for (const f of files) {
  const rel = path.relative(root, f).split(path.sep).join('/');
  if (rel.startsWith('design-system/')) continue; // specimens
  const src = fs.readFileSync(f, 'utf8');
  const lineOf = (i) => src.slice(0, i).split('\n').length;
  const flag = (i, text) => bad.push(`public/${rel}:${lineOf(i)}: ${text.replace(/\s+/g, ' ').trim().slice(0, 120)}`);
  for (const m of src.matchAll(/<input\b[^>]*>/gi)) {
    if (!tagColour.test(m[0])) continue;
    const id = (m[0].match(/\bid\s*=\s*["']?([^\s"'>]+)/i) || [])[1] || '';
    if (rel === 'admin.html' && THEME_ID.test(id)) continue;
    flag(m.index, m[0]);
  }
  for (const re of code) for (const m of src.matchAll(new RegExp(re.source, 'g'))) flag(m.index, src.slice(m.index, m.index + 80));
  if (createsElements.test(src)) for (const m of src.matchAll(new RegExp(literal.source, 'g'))) flag(m.index, src.slice(m.index, m.index + 80));
}
if (bad.length) {
  console.error('FAIL: a native colour input outside the theme editor (use host.ui.colorPicker / colorField):\n' + bad.join('\n'));
  process.exit(1);
}
console.log(`ok: no native colour input in ${files.length} public files (only admin.html's theme-* inputs and the Design System specimens)`);
