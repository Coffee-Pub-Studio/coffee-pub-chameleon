'use strict';
// Reading declarations out of CSS, and out of CSS written inside JavaScript strings, line for line. One reader for the
// colour rule (server/colour-rule.js, which the module check and tools/check-no-raw-colours.mjs share) and the other drift
// guards (tools/lib/drift.mjs re-exports it). Pure: text in, declarations out.

// Blank out comments and `${...}` placeholders, keeping every other character in place so line numbers stay right.
const blank = (s) => s.replace(/[^\n]/g, ' ');
function clean(text, kind) {
  let t = text.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (kind === 'js') {
    t = t.replace(/(^|\s)\/\/[^\n]*/g, (m, lead) => lead + blank(m.slice(lead.length)));
    t = t.replace(/\$\{[^{}\n]*\}/g, (m) => '_'.repeat(m.length));
  }
  return t;
}

// The line (from 1) an index falls on; the line starts of the last text asked about are kept so a big file is not re-read.
let lineText = null;
let lineStarts = [];
function lineOf(text, index) {
  if (text !== lineText) {
    lineText = text;
    lineStarts = [0];
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lineStarts.push(i + 1);
  }
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= index) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}
const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

// Every declaration in a file: { prop, value, index, selector, line }. In CSS the selector is the rule's own; in JS it is
// '' (a style string has none that can be told apart reliably). JS gets three shapes: `prop: value;` inside a string,
// `{ camelProp: 'value' }`, and `el.style.camelProp = 'value'` or a `prop="value"` attribute.
function declarations(file) {
  const text = clean(file.text, file.kind);
  const out = [];
  const seen = new Set();
  const add = (prop, value, index, selector) => {
    if (seen.has(index)) return;
    seen.add(index);
    out.push({ prop: prop.toLowerCase(), value, index, selector, line: lineOf(text, index) });
  };
  if (file.kind === 'css') {
    for (const rule of text.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const selector = rule[1].trim();
      // An @font-face block describes a font file (its weight is a range such as 100 900), not a style used anywhere.
      if (/@font-face$/i.test(selector)) continue;
      const bodyStart = rule.index + rule[0].indexOf('{') + 1;
      for (const d of rule[2].matchAll(/(--[\w-]+|-?[a-zA-Z][\w-]*)\s*:\s*([^;]*)/g)) {
        add(d[1], d[2], bodyStart + d.index + d[0].indexOf(d[2]), selector);
      }
    }
    return out;
  }
  for (const d of text.matchAll(/(--[\w-]+|-?[a-zA-Z][\w-]*)\s*:\s*([^;{}\n'"`]*)/g)) add(d[1], d[2], d.index + d[0].indexOf(d[2]), '');
  for (const d of text.matchAll(/\b([a-z]+(?:[A-Z][a-z0-9]*)*)\s*[=:]\s*(['"`])([^'"`\n]*)\2/g)) {
    add(kebab(d[1]), d[3], d.index + d[0].indexOf(d[2]) + 1, '');
  }
  return out;
}

module.exports = { clean, lineOf, declarations };
