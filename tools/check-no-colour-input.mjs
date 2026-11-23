// Plan Verify step 3 (colour picker, #933; Thomas, 2026-11-22: the picker is the only way a colour is set, everywhere): no file in
// public/ or in a bundled module (modules/<id>/) draws <input type="color"> for a person to use. Everything uses the SDK's colour
// picker (host.ui.colorPicker / colorField, or window.hostColour on the host's own pages). The Manage theme editor is no exception:
// its colours are colour fields too. One folder is left out:
//   - public/design-system/: the Design System pages show the native input only as a specimen of the global form rule.
// CSS selectors (input[type="color"] in a .css file, or inside a string of selectors) are not markup and are not counted (only .js and
// .html are read). A module's test/ folder is not module code (not in the zip) and is not read; nor is modules/dist/ (built zips).
//
// What is flagged, in .js and .html files:
//   - an <input ...> tag (also split over lines) whose attributes hold type=color, with or without quotes;
//   - .type = 'color', ["type"] = "color" and setAttribute("type", "color"), in any of ' " or ` quotes.
//   - { type: 'color' } as an object literal, ONLY in a file that creates elements (createElement, innerHTML, insertAdjacentHTML,
//     or an <input tag). Module settings declare a colour as { type: 'color' } in plain data (a settings definition), which draws
//     nothing by itself; a file that builds elements could pass that object to something that draws the native input, so it is held to the rule.
//     One shape of it is not a field and is not flagged: a MapLibre style-specification property, an object that opens with
//     type: "color" and whose own keys (at its top level) include "property-type" or transition. That is MapLibre's description of a
//     style value's type (modules/maps/src/maps-lib-a-maplibre.js: "fill-color": { type: "color", default: "#000000", transition: true,
//     "property-type": "data-driven" }); MapLibre draws no input from it. A { type: 'color' } with neither key is still flagged.
// The rule is by file because a definition and the element that draws it are not told apart by reading one line.
import fs from 'node:fs';
import path from 'node:path';

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const Q = '[\'"`]';
const tagColour = new RegExp(`\\btype\\s*=\\s*${Q}?color\\b`, 'i');
const code = [
  new RegExp(`\\.type\\s*=\\s*${Q}color${Q}`),
  new RegExp(`\\[\\s*${Q}type${Q}\\s*\\]\\s*=\\s*${Q}color${Q}`),
  new RegExp(`setAttribute\\(\\s*${Q}type${Q}\\s*,\\s*${Q}color${Q}`),
];
const literal = new RegExp(`\\btype\\s*:\\s*${Q}color${Q}`);
const createsElements = /createElement\s*\(|\.innerHTML\b|insertAdjacentHTML\s*\(|<input\b/;

// The object literal a `type: "color"` at `at` opens, when `type` is its first key: its text, or '' when it is not one. Brackets inside
// strings are skipped; the object ends at its own closing brace.
function objectAt(src, at) {
  const open = src.lastIndexOf('{', at);
  if (open < 0 || src.slice(open + 1, at).trim() !== '') return '';
  let depth = 0;
  let quote = '';
  for (let i = open; i < src.length && i < open + 4000; i += 1) {
    const c = src[i];
    if (quote) { if (c === '\\') i += 1; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{' || c === '[' || c === '(') depth += 1;
    else if (c === '}' || c === ']' || c === ')') { depth -= 1; if (depth === 0) return src.slice(open, i + 1); }
  }
  return '';
}
// The keys at the top level of an object literal's text (nested objects, arrays and strings left out).
function topKeys(obj) {
  const keys = [];
  let depth = 0;
  let quote = '';
  let token = '';
  for (let i = 0; i < obj.length; i += 1) {
    const c = obj[i];
    if (quote) {
      if (c === '\\') { i += 1; continue; }
      if (c === quote) { quote = ''; if (depth === 1) token += c; continue; }
      if (depth === 1) token += c;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; if (depth === 1) token += c; continue; }
    if (c === '{' || c === '[' || c === '(') { depth += 1; continue; }
    if (c === '}' || c === ']' || c === ')') { depth -= 1; continue; }
    if (depth !== 1) continue;
    if (c === ':') { keys.push(token.trim().replace(/^['"`]|['"`]$/g, '')); token = ''; continue; }
    if (c === ',') { token = ''; continue; }
    token += c;
  }
  return keys;
}
const styleSpec = (src, at) => {
  const obj = objectAt(src, at);
  if (!obj) return false;
  const keys = topKeys(obj);
  return keys[0] === 'type' && (keys.includes('property-type') || keys.includes('transition'));
};

const files = [];
function walk(d, skip) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) { if (!skip(f)) walk(f, skip); } else if (/\.(js|html)$/.test(e.name)) files.push(f);
  }
}
walk(path.join(repo, 'public'), (f) => path.relative(repo, f).split(path.sep).join('/') === 'public/design-system'); // specimens
const modulesDir = path.join(repo, 'modules');
for (const e of fs.readdirSync(modulesDir, { withFileTypes: true })) {
  if (!e.isDirectory() || e.name === 'dist' || e.name.startsWith('.')) continue;
  walk(path.join(modulesDir, e.name), (f) => ['test', 'node_modules'].includes(path.basename(f)));
}

const bad = [];
let spec = 0;
for (const f of files) {
  const rel = path.relative(repo, f).split(path.sep).join('/');
  const src = fs.readFileSync(f, 'utf8');
  const lineOf = (i) => src.slice(0, i).split('\n').length;
  const flag = (i, text) => bad.push(`${rel}:${lineOf(i)}: ${text.replace(/\s+/g, ' ').trim().slice(0, 120)}`);
  for (const m of src.matchAll(/<input\b[^>]*>/gi)) if (tagColour.test(m[0])) flag(m.index, m[0]);
  for (const re of code) for (const m of src.matchAll(new RegExp(re.source, 'g'))) flag(m.index, src.slice(m.index, m.index + 80));
  if (createsElements.test(src)) {
    for (const m of src.matchAll(new RegExp(literal.source, 'g'))) {
      if (styleSpec(src, m.index)) { spec += 1; continue; }
      flag(m.index, src.slice(m.index, m.index + 80));
    }
  }
}
if (bad.length) {
  console.error('FAIL: a native colour input (use host.ui.colorPicker / colorField, or window.hostColour on a host page):\n' + bad.join('\n'));
  process.exit(1);
}
console.log(`ok: no native colour input in ${files.length} files of public/ and modules/ (the Design System specimens left out; ${spec} MapLibre style-spec colour properties are not fields)`);
