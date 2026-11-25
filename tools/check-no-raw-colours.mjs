#!/usr/bin/env node
// Drift guard: colours come from tokens (documentation/plans/plan-design-system.md, (e)).
// A hard-coded colour is a #hex, an rgb()/rgba()/hsl()/hsla()/hwb()/lab()/lch()/oklab()/oklch() with no var() inside, or a
// named colour (red, gold ...; not transparent, currentColor or inherit; named colours are only read in colour
// properties and in custom properties). A raw colour is an offender wherever it sits except in a token definition: the
// `:root` blocks, and the `:root[data-theme-mode=...]` / `:root[data-mode-shown=...]` blocks, of public/style.css,
// public/sdk/host.css and public/sdk/system.css (the server's theme code lives in server/ and is not read).
//
// Black and white used as a shadow or a scrim are counted apart, under the key "shadow-scrim", and are allowed for now:
// pure black or white (#000, #fff, rgba(0,0,0,.5), black, white) in a shadow or filter property, or with an alpha below
// 1, or as the mixing colour inside color-mix(). Anything else, including an opaque black or white text colour, is "raw".
//
// It reads public/*.css, public/sdk/*.css, modules/*/src/*.css and the CSS inside the .js files of public and
// modules/*/src (style strings, el.style.color, { background: '#fff' }, fill="#fff" attributes); not public/design-system
// or MapLibre. A colour a script keeps as plain data (a palette array) is not in a declaration and is not read.
// One narrow exemption: in modules/whiteboard/src/ only, a name from the Whiteboard's own palette table (WB_PALETTE, read from that
// module at check time) that is the whole quoted value of an object property ({ fill: 'gold' }) is not read. Anywhere else, and for any
// other name, a hex, rgb(), assignment (el.style.fill = 'gold') or attribute (fill="gold"), it is read like any colour.
//
// The admin theme editor's colour fields (public/admin.html, the inputs id="theme-*", with the SDK's colour picker on each) hold a colour the person picks and the code draws none, so there is nothing to read there.
// One page has a palette of its own: the start page (public/start.css), whose :root blocks are token definitions like the theme files' (the studio's colours, light and dark); outside those blocks it is read like any file. @font-face blocks are not read.
// Today's offenders are recorded per file and kind in tools/check-no-raw-colours-allow.json. The check passes while no
// count is higher, fails on a higher count or a new file, and says when a count has dropped.
//   node tools/check-no-raw-colours.mjs                 the check
//   node tools/check-no-raw-colours.mjs --list          also print every hit, file:line
//   node tools/check-no-raw-colours.mjs --update        lower the allow-list to today's counts (never raises)
//   node tools/check-no-raw-colours.mjs --update --force-raise   also allow raising (how it was first made)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, collectFiles, Tally, runRatchet, summary } from './lib/drift.mjs';

// The colour rule itself (what is a hard-coded colour, what is a shadow or scrim) is server/colour-rule.js, shared with the module check.
const { coloursInFile } = createRequire(import.meta.url)('../server/colour-rule.js');

// The Whiteboard stores a block's palette name as data ({ fill: 'gold' }) and draws it through its own palette table (WB_PALETTE),
// never as a colour. So in the Whiteboard's own source, and only there, a name from that table is not a raw colour.
// The names are read from the module's WB_PALETTE constant; if the module is present and the constant is not, the check fails.
const WB_DIR = 'modules/whiteboard/src/';
function whiteboardPalette(root) {
  const dir = path.join(root, WB_DIR);
  if (!fs.existsSync(dir)) return new Set();
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const m = /\bconst WB_PALETTE\s*=\s*\[([\s\S]*?)\n\s*\];/.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (m) {
      const ids = [...m[1].matchAll(/\bid:\s*'([a-z]+)'/g)].map((x) => x[1]);
      if (ids.length) return new Set(ids);
    }
  }
  console.error(`check-no-raw-colours: FAILED. ${WB_DIR} has no WB_PALETTE constant with ids, so the Whiteboard's palette names cannot be read.`);
  process.exit(1);
}
const WB_NAMES = whiteboardPalette(process.env.DRIFT_ROOT || ROOT);

const TOKEN_FILES = new Set(['public/style.css', 'public/sdk/host.css', 'public/sdk/system.css', 'public/start.css']); // public/start.css: only its :root blocks, the start page's own palette (the studio's design system)
// :root, optionally with attribute and :not() parts, and nothing else (no descendant): a token definition.
const TOKEN_SELECTOR = /^:root(?:\[[^\]]*\]|:not\((?:[^()]|\([^()]*\))*\))*$/;

// { fill: 'gold' } in the Whiteboard's source with 'gold' in its palette table: a name kept as data. The quote must follow `key:`
// (the text keeps its positions in declarations(), so d.index is just inside the quote), not `=` (an assignment or attribute).
function inWhiteboardData(file, d, c, value) {
  return file.kind === 'js' && file.rel.startsWith(WB_DIR) && c.kind === 'named' && value.trim() === c.text && WB_NAMES.has(c.text)
    && /[A-Za-z]\s*:\s*['"`]$/.test(file.text.slice(0, d.index));
}

const LIST = process.argv.includes("--list"); // print every hit, file:line
const tally = new Tally();
const files = collectFiles();
for (const file of files) {
  const found = coloursInFile(file, {
    // A token definition is not a use of a colour.
    skipDeclaration: (d) => file.kind === 'css' && TOKEN_FILES.has(file.rel) && d.selector.split(',').every((s) => TOKEN_SELECTOR.test(s.trim())),
    skip: (f, d, c, value) => inWhiteboardData(file, d, c, value),
  });
  for (const c of found) {
    if (LIST) console.log(`${file.rel}:${c.line}  ${c.kind}  ${c.prop}: ${c.text}`);
    tally.add(file.rel, c.kind, c.line);
  }
}

const by = tally.byKey();
runRatchet({
  name: 'check-no-raw-colours',
  allowFile: 'check-no-raw-colours-allow.json',
  about: 'check-no-raw-colours: today\'s hard-coded colours outside the token blocks, per file. "raw" is a real colour to move onto a token; "shadow-scrim" is pure black or white used as a shadow or scrim (allowed for now). Counts may only fall; lower them with: node tools/check-no-raw-colours.mjs --update',
  tally,
  unit: 'hard-coded colours',
  extraReport: [`  raw: ${by.get('raw') || 0}, shadow-scrim: ${by.get('shadow-scrim') || 0}`, ...summary(tally, 'kind')],
});
