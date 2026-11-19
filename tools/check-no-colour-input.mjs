// Plan Verify step 3 (colour picker, #933): no file in public/ draws <input type="color"> for a person to use,
// except the theme editor's (public/admin.html, public/admin.js). Everything else uses the SDK's colour picker.
// Design System pages show the native input only as a specimen of the global form rule, so they are allowed too.
// CSS selectors (input[type="color"] in a .css file, or inside a string of selectors) are not markup and are not counted.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'public');
const allowed = (rel) => rel === 'admin.html' || rel === 'admin.js' || rel.startsWith('design-system/');
// Markup: an <input ...> tag whose attributes hold type="color"; code: type: 'color' or .type = 'color' or setAttribute('type','color').
const markup = /<input\b[^>]*\btype\s*=\s*["']?color\b/i;
const code = /\btype\s*:\s*['"]color['"]|\.type\s*=\s*['"]color['"]|setAttribute\(\s*['"]type['"]\s*,\s*['"]color['"]/;

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
  if (allowed(rel)) continue;
  fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (markup.test(line) || code.test(line)) bad.push(`public/${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
}
if (bad.length) {
  console.error('FAIL: a native colour input outside the theme editor (use host.ui.colorPicker / colorField):\n' + bad.join('\n'));
  process.exit(1);
}
console.log(`ok: no native colour input in ${files.length} public files (admin and Design System specimens allowed)`);
