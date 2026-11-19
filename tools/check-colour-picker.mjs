#!/usr/bin/env node
/*
 * check-colour-picker.mjs -- the colour picker's pure parts and its contrast helper (documentation/plans/plan-colour-picker.md,
 * "The default palette (proposed)", "The contract", "The contrast helper"; GitHub #933).
 *
 *   1. Node only: the pure parts, sliced out of public/sdk/host.js between its "colour:start" and "colour:end" markers.
 *      colourClean: a hex in any case, with or without "#", with spaces round it, becomes "#rrggbb" in lower case; anything else
 *      (short, long, a word, url(), three digits, empty, null, a number) is null. colourToHsv and colourFromHsv: every palette
 *      colour, black, white and a grid of colours go to hue, saturation and brightness (in range) and back to the same hex; a bad
 *      hex throws. COLOUR_PALETTE: exactly the plan's three groups of eight (names and colours), unique names and colours, frozen
 *      all the way down, and its contrast figures (dark words #1c2024 on each Light colour, light words #eceff3 on each Dark colour,
 *      each Dark colour as words on white, white words on each Strong colour, all at 4.5:1 or more; each Strong colour at 3:1 or
 *      more against white and against the dark ground #0e1a2b). colourPaletteCheck: takes the default and a small module palette
 *      (answering a cleaned copy) and refuses each bad shape with its one sentence. colourOpacity and colourAnswer: the edges.
 *      colourPaletteCheck also: holes (new Array(1), new Array(6), [g, , g], colours [ , ] and new Array(3)) are refused, and an
 *      own `map` on the palette or on a colours list is never what is answered (the checked copy, or the refusal); headings and
 *      names of only zero-width characters, or holding a direction mark, soft hyphen, override or isolate, U+2028 or U+2029, a
 *      delete or U+0085 control, a lone surrogate, or no letter or digit at all, are refused, while "Black & white", Rot "dunkel",
 *      Café and Ébène 2 are kept. colourContrast and colourReadableOn are strict (no "2f6cbf", "#2F6CBF", spaces or "#fff").
 *      colourFromHsv always answers #rrggbb (empty, NaN, Infinity, null) and wraps hue (-60, 360, 720) and clamps saturation and
 *      brightness. The plan's palette figures hold as lower bounds (12.8, 10.3, 11.9, 4.8 and 3.2).
 *      colourContrast and colourReadableOn: equal to contrast() and pickOn() in public/theme-colour.js on every palette colour and
 *      the grid, and refusing what is not a colour with their sentences. The block reaches nothing outside itself (it is run again
 *      in an empty context with no window, document, require or process). Read as code: host.util names contrast and readableOn
 *      as colourContrast and colourReadableOn, and host.js creates no <input type="color"> (comments are left out of that search,
 *      since colorField is documented as taking one a module already has).
 *   2. Chromium (step 2; SKIPPED, said so, when there is none: that is not a pass). One throwaway server (tools/shots.mjs startServer,
 *      no seed), signed in as admin, in light and dark, at 1280 and at a 390 touch screen. In a module running in the page (a shadow
 *      root made with createHost on the admin page, in a box of its own): the refusals and their sentences; the picker under an anchor,
 *      flipped above one at the box's foot, at a point, at { x: 100000, y: 4 } and { x: 50, y: 4 }, always inside the box, and the same
 *      call again closing it (both null); a swatch (pressed, or Enter) answers and closes; Tab order (the area, Hue, Opacity, Hex, Pick
 *      from the screen when shown, the palette, Recent, round again) and each control's keys; a typed hex taken in any case and a bad
 *      one marked aria-invalid with its line, the colour unchanged; Escape answers null and puts focus back; a drag (a touch drag at
 *      390) sends onInput and a press outside answers once; opacity: false shows 100, aria-disabled, described by "Opacity isn't kept
 *      here.", moves by nothing, and answers 100; a module palette in place of the default; Recent, newest first, named by colour name
 *      or hex; colorField (the trigger's name, input then change then onChange, Escape sends nothing, the toggle, set(), disabled,
 *      destroy) and the page's own hostColour.field; 44px targets and 16px hex text at 390; Hex, the typed hex, a heading, the note
 *      and the error line at 4.5:1 on the picker; the stronger edge exactly on the swatches under 3:1 against the menu's surface
 *      (White in light, Black in dark); the accessibility tree names the dialog, the area, the sliders, Hex, the radio groups and each
 *      radio (aria-valuetext is read from the element: this Chromium's DevTools tree leaves it empty even on a plain slider). In an
 *      uploaded module in its sandboxed frame (built here at run time): its toolbar button opens the picker at { x, y: 4 } inside the
 *      frame, Escape answers null and focus goes back to the toolbar button, the button pressed again closes it, and a colorField in
 *      its form sets the input. The popover's background in a frame is not asserted (a separate fix in public/module-host.js).
 *      Every answer seen is { color: #rrggbb, opacity: a whole number from 0 to 100 }. CHROME_PATH names the browser.
 * Usage: node tools/check-colour-picker.mjs. Exits 0 when every check passes, 1 with a line per failure.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { findBrowser, launch, freePort, startServer, stopServer, Tab, sleep } from './shots.mjs';
import { stopBrowser } from './browser-launch.mjs';
import { PASSWORD } from './shots-seed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const say = (...a) => console.log('check-colour-picker:', ...a);
let n = 0;
const problems = [];
const ok = (cond, msg) => { n += 1; if (!cond) problems.push(msg); };
const same = (a, b, msg) => { n += 1; try { assert.deepEqual(a, b); } catch { problems.push(`${msg}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); } };
// Throws at all (any error), or throws a TypeError with exactly `sentence`.
const throws = (fn, msg, sentence) => {
  n += 1;
  try { fn(); problems.push(`${msg}: did not throw`); } catch (e) {
    if (sentence === undefined) return;
    if (!(e instanceof TypeError)) problems.push(`${msg}: threw ${e && e.name}, wanted a TypeError`);
    else if (e.message !== sentence) problems.push(`${msg}: said "${e.message}", wanted "${sentence}"`);
  }
};
// One part of the check; an error it did not expect is one failure, and the rest still run.
const section = (name, fn) => { try { fn(); } catch (e) { n += 1; problems.push(`${name}: threw ${e && e.message}`); } };
const finish = () => {
  if (problems.length) {
    console.error(`check-colour-picker: ${problems.length} problem(s):`);
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  say(`OK (${n} checks)`);
};

const sdk = read('public/sdk/host.js');
const TC = createRequire(import.meta.url)(path.join(ROOT, 'public/theme-colour.js'));
ok(typeof TC.contrast === 'function' && typeof TC.pickOn === 'function', 'public/theme-colour.js exports contrast and pickOn');

// === 1. Node =============================================================================================================
const from = sdk.indexOf('// colour:start');
const to = sdk.indexOf('// colour:end');
ok(from > 0 && to > from, 'public/sdk/host.js has its colour:start and colour:end markers');
if (!(from > 0 && to > from)) finish();
const block = sdk.slice(from, to);
const NAMES = 'COLOUR_HEX, colourClean, colourToHsv, colourFromHsv, COLOUR_PALETTE, colourPaletteCheck, colourOpacity, colourAnswer, colourContrast, colourReadableOn';
let P;
try {
  P = new Function(`${block}\n; return { ${NAMES} };`)();
} catch (e) {
  problems.push(`the colour block does not evaluate on its own: ${e && e.message}`);
  finish();
}
for (const k of NAMES.split(', ')) ok(P[k] !== undefined, `the colour block defines ${k}`);
if (problems.length) finish();

const PALETTE = [
  ['Light', [['White', '#ffffff'], ['Cream', '#f5eedb'], ['Light grey', '#e4e6ea'], ['Light blue', '#dce9f6'], ['Light green', '#ddeedd'], ['Light yellow', '#fbf4c8'], ['Light pink', '#f8e0e9'], ['Light purple', '#e8e0f5']]],
  ['Dark', [['Black', '#000000'], ['Slate', '#2b3440'], ['Dark grey', '#34373c'], ['Navy', '#14274b'], ['Forest', '#163a2b'], ['Wine', '#4a1b2b'], ['Plum', '#2f2050'], ['Brown', '#3d2b1f']]],
  ['Strong', [['Red', '#c0392b'], ['Orange', '#b8560f'], ['Gold', '#8a6a00'], ['Green', '#2e7d32'], ['Teal', '#00796b'], ['Blue', '#2f6cbf'], ['Purple', '#7c55c8'], ['Pink', '#b23f7f']]],
].map(([heading, list]) => ({ heading, colours: list.map(([name, color]) => ({ name, color })) }));
const group = (h) => PALETTE.find((g) => g.heading === h).colours.map((c) => c.color);
const GRID = [];
for (let r = 0; r <= 255; r += 15) for (let g = 0; g <= 255; g += 15) for (let b = 0; b <= 255; b += 15) {
  GRID.push(`#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`);
}
const ALL = [...new Set([...PALETTE.flatMap((g) => g.colours.map((c) => c.color)), '#000000', '#ffffff', ...GRID])];

section('the hex pattern and cleaning', () => {
  // --- the hex pattern and cleaning ---
  ok(P.COLOUR_HEX instanceof RegExp && P.COLOUR_HEX.test('#2f6cbf') && !P.COLOUR_HEX.test('#2F6CBF') && !P.COLOUR_HEX.test('#2f6cbf0') && !P.COLOUR_HEX.test('x#2f6cbf'),
    'COLOUR_HEX is #rrggbb in lower case, whole');
  for (const v of ['#2F6CBF', '2f6cbf', ' #2f6cbf ', '2F6cBf', '\t#2f6cbf\n']) same(P.colourClean(v), '#2f6cbf', `colourClean(${JSON.stringify(v)})`);
  for (const v of ['#2f6cb', '#2f6cbfff', 'red', 'url(x)', '#fff', '', '   ', '#', '##2f6cbf', '#2f 6cbf', '#2g6cbf', 'rgb(1,2,3)', null, undefined, 123, 0x2f6cbf, {}, ['#2f6cbf']]) {
    same(P.colourClean(v), null, `colourClean(${typeof v === 'string' ? JSON.stringify(v) : String(v)}) is refused`);
  }
});

section('hue, saturation and brightness, and back', () => {
  // --- hue, saturation and brightness, and back ---
  const bad = [];
  const range = [];
  for (const hex of ALL) {
    let hsv; let back;
    try { hsv = P.colourToHsv(hex); back = P.colourFromHsv(hsv); } catch (e) { bad.push(`${hex} threw ${e && e.message}`); continue; }
    if (back !== hex) bad.push(`${hex} -> ${JSON.stringify(hsv)} -> ${back}`);
    if (!(hsv && hsv.h >= 0 && hsv.h < 360 && hsv.s >= 0 && hsv.s <= 100 && hsv.v >= 0 && hsv.v <= 100)) range.push(`${hex} -> ${JSON.stringify(hsv)}`);
  }
  same(bad.slice(0, 5), [], `every palette colour, black, white and the grid (${ALL.length} colours) round-trip exactly`);
  same(range.slice(0, 5), [], 'hue is 0 to under 360, saturation and brightness 0 to 100');
  same(P.colourToHsv('#ffffff').s, 0, 'white has no saturation');
  same(P.colourToHsv('#ffffff').v, 100, 'white is full brightness');
  same(P.colourToHsv('#000000').v, 0, 'black has no brightness');
  ok(Math.abs(P.colourToHsv('#ff0000').h) < 1e-9 && Math.abs(P.colourToHsv('#00ff00').h - 120) < 1e-9 && Math.abs(P.colourToHsv('#0000ff').h - 240) < 1e-9, 'red, green and blue sit at 0, 120 and 240');
  same(P.colourFromHsv({ h: 0, s: 100, v: 100 }), '#ff0000', 'colourFromHsv answers #rrggbb in lower case');
  for (const v of ['red', '#fff', '', null, '#2F6CBF0']) throws(() => P.colourToHsv(v), `colourToHsv(${JSON.stringify(v)}) throws`);
});

section('the default palette', () => {
  // --- the default palette ---
  const D = P.COLOUR_PALETTE;
  same(JSON.parse(JSON.stringify(D)), PALETTE, 'the default palette is the plan\'s three groups of eight, in order');
  ok(Array.isArray(D) && D.length === 3 && D.every((g) => g.colours.length === 8), 'the default palette is 3 groups of 8');
  const names = D.flatMap((g) => g.colours.map((c) => c.name));
  const colours = D.flatMap((g) => g.colours.map((c) => c.color));
  same(new Set(names).size, names.length, 'the default palette\'s names are unique');
  same(new Set(colours).size, colours.length, 'the default palette\'s colours are unique');
  ok(colours.every((c) => P.COLOUR_HEX.test(c)), 'every default colour is #rrggbb in lower case');
  ok(Object.isFrozen(D) && D.every((g) => Object.isFrozen(g) && Object.isFrozen(g.colours) && g.colours.every((c) => Object.isFrozen(c))),
    'the default palette is frozen all the way down (the list, each group, each group\'s colours and each colour)');

  // Its figures, worked out with public/theme-colour.js's own maths (independent of the block).
  const below = (list, other, min, how) => list.filter((c) => !(TC.contrast(c, other) >= min)).map((c) => `${c} ${how} ${TC.contrast(c, other).toFixed(2)}`);
  same(below(group('Light'), '#1c2024', 4.5, 'with #1c2024'), [], 'dark words #1c2024 on each Light colour reach 4.5:1');
  same(below(group('Dark'), '#eceff3', 4.5, 'with #eceff3'), [], 'light words #eceff3 on each Dark colour reach 4.5:1');
  same(below(group('Dark'), '#ffffff', 4.5, 'on white'), [], 'each Dark colour as words on white reaches 4.5:1');
  same(below(group('Strong'), '#ffffff', 4.5, 'with white'), [], 'white words on each Strong colour reach 4.5:1');
  same(below(group('Strong'), '#ffffff', 3, 'against white'), [], 'each Strong colour reaches 3:1 against white');
  same(below(group('Strong'), '#0e1a2b', 3, 'against #0e1a2b'), [], 'each Strong colour reaches 3:1 against the dark ground #0e1a2b');
});

section('the palette check', () => {
  // --- the palette check ---
  const SENTENCE = 'host.ui.colorPicker: a palette colour needs a name and a #rrggbb colour';
  let got;
  try { got = P.colourPaletteCheck(P.COLOUR_PALETTE); } catch (e) { got = `threw ${e && e.message}`; }
  same(JSON.parse(JSON.stringify(got)), PALETTE, 'colourPaletteCheck takes the default palette as it is');
  const mine = [{ heading: 'Inks', colours: [{ name: 'Ink', color: '#1A2B3C' }, { name: 'Paper', color: 'F5EEDB' }, { name: 'Rust', color: ' #b8560f ' }] }];
  try { got = P.colourPaletteCheck(mine); } catch (e) { got = `threw ${e && e.message}`; }
  same(JSON.parse(JSON.stringify(got)), [{ heading: 'Inks', colours: [{ name: 'Ink', color: '#1a2b3c' }, { name: 'Paper', color: '#f5eedb' }, { name: 'Rust', color: '#b8560f' }] }],
    'colourPaletteCheck takes a small module palette and answers its colours cleaned, in lower case');
  ok(got !== mine && mine[0].colours[0].color === '#1A2B3C', 'colourPaletteCheck answers a copy and leaves the module\'s palette alone');
  const c = (k) => ({ name: `C${k}`, color: `#${k.toString(16).padStart(6, '0')}` });
  const groups = (sizes) => sizes.map((size, i) => ({ heading: `G${i}`, colours: Array.from({ length: size }, (_, j) => c(i * 100 + j)) }));
  for (const [what, pal] of [['6 groups of 8 (48 colours)', groups([8, 8, 8, 8, 8, 8])], ['a heading and a name of 40 characters', [{ heading: 'h'.repeat(40), colours: [{ name: 'n'.repeat(40), color: '#000000' }] }]]]) {
    let fine = true;
    try { P.colourPaletteCheck(pal); } catch { fine = false; }
    ok(fine, `colourPaletteCheck takes ${what}`);
  }
  const good = () => ({ heading: 'Inks', colours: [{ name: 'Ink', color: '#1a2b3c' }] });
  const withGroup = (patch) => [{ ...good(), ...patch }];
  const withColour = (patch) => [{ heading: 'Inks', colours: [{ name: 'Ink', color: '#1a2b3c', ...patch }] }];
  const bad = [
    ['not an array (an object)', { heading: 'Inks', colours: [] }],
    ['not an array (a string)', '#1a2b3c'],
    ['not an array (null)', null],
    ['not an array (nothing)', undefined],
    ['an empty list', []],
    ['7 groups', groups([1, 1, 1, 1, 1, 1, 1])],
    ['49 colours', groups([8, 8, 8, 8, 8, 9])],
    ['a group that is not an object', [null]],
    ['a group with no colours', withGroup({ colours: [] })],
    ['a group whose colours are not a list', withGroup({ colours: { name: 'Ink', color: '#1a2b3c' } })],
    ['a group with no heading', [{ colours: [{ name: 'Ink', color: '#1a2b3c' }] }]],
    ['an empty heading', withGroup({ heading: '' })],
    ['a heading of spaces', withGroup({ heading: '   ' })],
    ['a heading of 41 characters', withGroup({ heading: 'h'.repeat(41) })],
    ['a heading with <', withGroup({ heading: 'a<b' })],
    ['a heading with >', withGroup({ heading: 'a>b' })],
    ['a heading with a control character', withGroup({ heading: 'a\nb' })],
    ['a heading that is a number', withGroup({ heading: 12 })],
    ['a colour that is not an object', withGroup({ colours: ['#1a2b3c'] })],
    ['a colour with no name', withColour({ name: undefined })],
    ['an empty name', withColour({ name: '' })],
    ['a name of spaces', withColour({ name: '  ' })],
    ['a name of 41 characters', withColour({ name: 'n'.repeat(41) })],
    ['a name with <', withColour({ name: '<b>Ink</b>' })],
    ['a name with >', withColour({ name: 'Ink>' })],
    ['a name with a control character', withColour({ name: 'In\u0007k' })],
    ['a name that is a number', withColour({ name: 7 })],
    ['a colour word', withColour({ color: 'red' })],
    ['a three-digit hex', withColour({ color: '#fff' })],
    ['an eight-digit hex', withColour({ color: '#1a2b3cff' })],
    ['url()', withColour({ color: 'url(x)' })],
    ['no colour', withColour({ color: undefined })],
    ['a colour that is a number', withColour({ color: 0x1a2b3c })],
  ];
  for (const [what, pal] of bad) throws(() => P.colourPaletteCheck(pal), `colourPaletteCheck refuses ${what}`, SENTENCE);
});

section('the opacity and the answer', () => {
  // --- the opacity and the answer ---
  for (const [v, want] of [[-5, 0], [0, 0], [37, 37], [100, 100], [100.4, 100], [49.5, 50], [49.4, 49], [250, 100], ['x', 100], [NaN, 100], [Infinity, 100], [-Infinity, 100], [undefined, 100]]) {
    same(P.colourOpacity(v), want, `colourOpacity(${typeof v === 'string' ? JSON.stringify(v) : String(v)})`);
  }
  same(P.colourAnswer('#2F6CBF', 40), { color: '#2f6cbf', opacity: 40 }, 'colourAnswer cleans the colour and keeps the opacity');
  same(P.colourAnswer('#2f6cbf', 40, true), { color: '#2f6cbf', opacity: 40 }, 'colourAnswer with the opacity kept');
  same(P.colourAnswer('#2f6cbf', 40, false), { color: '#2f6cbf', opacity: 100 }, 'colourAnswer where the opacity is not kept is always 100');
  same(P.colourAnswer('#2f6cbf', 0, false), { color: '#2f6cbf', opacity: 100 }, 'colourAnswer where the opacity is not kept is 100 even at 0');
  same(P.colourAnswer('2f6cbf', -5), { color: '#2f6cbf', opacity: 0 }, 'colourAnswer clamps the opacity');
  same(P.colourAnswer('#2f6cbf', 49.5), { color: '#2f6cbf', opacity: 50 }, 'colourAnswer rounds the opacity');
  same(P.colourAnswer('#2f6cbf'), { color: '#2f6cbf', opacity: 100 }, 'colourAnswer with no opacity is 100');
  for (const v of ['red', '#fff', '', null]) throws(() => P.colourAnswer(v, 50), `colourAnswer(${JSON.stringify(v)}) throws`);
});

section('the contrast helper, held equal to public/theme-colour.js', () => {
  // --- the contrast helper, held equal to public/theme-colour.js ---
  const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 1e-9;
  const diff = [];
  for (const hex of ALL) {
    for (const other of ['#ffffff', '#000000', '#0e1a2b', '#1c2024', hex]) {
      const a = P.colourContrast(hex, other);
      if (!near(a, TC.contrast(hex, other))) diff.push(`contrast(${hex}, ${other}) ${a} vs ${TC.contrast(hex, other)}`);
    }
    const r = P.colourReadableOn(hex);
    const t = TC.pickOn(hex);
    if (!(r && r.color === t.hex && near(r.ratio, t.ratio) && r.ok === t.ok)) diff.push(`readableOn(${hex}) ${JSON.stringify(r)} vs pickOn ${JSON.stringify(t)}`);
    else if (Object.keys(r).sort().join() !== 'color,ok,ratio') diff.push(`readableOn(${hex}) answers ${Object.keys(r).join(', ')}`);
  }
  same(diff.slice(0, 5), [], `colourContrast and colourReadableOn equal contrast() and pickOn() on every palette colour and the grid (${ALL.length} colours)`);
  ok(near(P.colourContrast('#000000', '#ffffff'), 21) && near(P.colourContrast('#2f6cbf', '#2f6cbf'), 1), 'black on white is 21:1 and a colour on itself 1:1');
  same(P.colourReadableOn('#ffffff').color, '#0a0a0a', 'readableOn white is near-black');
  same(P.colourReadableOn('#000000').color, '#ffffff', 'readableOn black is white');
  const C = 'host.util.contrast takes two #rrggbb colours';
  for (const [a, b] of [['#ffffff', 'red'], ['red', '#ffffff'], ['#fff', '#000000'], ['#ffffff'], [null, '#ffffff'], ['#ffffff', 123], ['url(x)', '#000000']]) {
    throws(() => P.colourContrast(a, b), `colourContrast(${JSON.stringify(a)}, ${JSON.stringify(b)}) is refused`, C);
  }
  const R = 'host.util.readableOn takes a #rrggbb colour';
  for (const v of ['red', '#fff', '', null, undefined, 123, '#ffffff00']) throws(() => P.colourReadableOn(v), `colourReadableOn(${JSON.stringify(v)}) is refused`, R);
});

section('the palette check: holes and an overridden map', () => {
  const SENTENCE = 'host.ui.colorPicker: a palette colour needs a name and a #rrggbb colour';
  const g = { name: 'Ink', color: '#1a2b3c' };
  const WANT = [{ heading: 'H', colours: [{ name: 'Ink', color: '#1a2b3c' }] }];
  const holes = [
    ['new Array(1)', new Array(1)],
    ['new Array(6)', new Array(6)],
    ['[g, , g] as the palette', [{ heading: 'H', colours: [g] }, , { heading: 'H2', colours: [g] }]],
    ['a hole in the middle of a group (colours [g, , g])', [{ heading: 'H', colours: [g, , g] }]],
    ['colours [ , ]', [{ heading: 'H', colours: [, ,] }]],
    ['colours new Array(3)', [{ heading: 'H', colours: new Array(3) }]],
  ];
  for (const [what, pal] of holes) throws(() => P.colourPaletteCheck(pal), `colourPaletteCheck refuses ${what}`, SENTENCE);
  // An own `map` is never called: the answer is the checked copy, or a refusal, never what map returns.
  const viaMap = (what, pal) => {
    let got; let refused = null;
    try { got = P.colourPaletteCheck(pal); } catch (e) { refused = e; }
    if (refused) {
      ok(refused instanceof TypeError && refused.message === SENTENCE, `${what}: refused with "${refused && refused.message}", wanted a TypeError saying "${SENTENCE}"`);
    } else {
      same(JSON.parse(JSON.stringify(got)), WANT, `${what}: the answer is the checked copy`);
      ok(!JSON.stringify(got).includes('script'), `${what}: the answer is not what map returned`);
    }
  };
  const a = [{ heading: 'H', colours: [g] }];
  a.map = () => ['<script>'];
  viaMap('a palette array with its own map', a);
  const b = [g];
  b.map = () => ['<script>'];
  viaMap('a colours array with its own map', [{ heading: 'H', colours: b }]);
  const c2 = [g];
  c2.map = () => { throw new Error('map was called'); };
  viaMap('a colours array whose map throws', [{ heading: 'H', colours: c2 }]);
});

section('the palette check: headings and names', () => {
  const SENTENCE = 'host.ui.colorPicker: a palette colour needs a name and a #rrggbb colour';
  const asHeading = (s) => [{ heading: s, colours: [{ name: 'Ink', color: '#1a2b3c' }] }];
  const asName = (s) => [{ heading: 'Inks', colours: [{ name: s, color: '#1a2b3c' }] }];
  const refused = [
    ['only a zero-width space', '​'],
    ['only two zero-width joiners', '‍‍'],
    ['a left-to-right mark', 'a‎b'],
    ['a soft hyphen', 'a­b'],
    ['a right-to-left override', 'a‮b'],
    ['a right-to-left isolate', 'a⁧b'],
    ['a line separator (U+2028)', 'a b'],
    ['a paragraph separator (U+2029)', 'a b'],
    ['a delete character', 'a\u007fb'],
    ['a next-line control (U+0085)', 'a\u0085b'],
    ['a lone surrogate', '\ud800'],
    ['a lone surrogate among letters', 'ab\ud800c'],
    ['no letter or digit (---)', '---'],
  ];
  for (const [what, s] of refused) {
    throws(() => P.colourPaletteCheck(asHeading(s)), `colourPaletteCheck refuses a heading with ${what}`, SENTENCE);
    throws(() => P.colourPaletteCheck(asName(s)), `colourPaletteCheck refuses a name with ${what}`, SENTENCE);
  }
  for (const s of ['Black & white', 'Rot "dunkel"', 'Café', 'Ébène 2']) {
    for (const [where, pal, pick] of [['heading', asHeading(s), (r) => r[0].heading], ['name', asName(s), (r) => r[0].colours[0].name]]) {
      let got; let err = null;
      try { got = P.colourPaletteCheck(pal); } catch (e) { err = e; }
      ok(!err, `colourPaletteCheck takes the ${where} ${JSON.stringify(s)}${err ? ` (said "${err.message}")` : ''}`);
      if (!err) same(pick(got), s, `colourPaletteCheck keeps the ${where} ${JSON.stringify(s)} as it is`);
    }
  }
});

section('the contrast helper is strict', () => {
  const C = 'host.util.contrast takes two #rrggbb colours';
  const R = 'host.util.readableOn takes a #rrggbb colour';
  for (const v of ['2f6cbf', '#2F6CBF', ' #2f6cbf ', '#fff']) {
    throws(() => P.colourContrast(v, '#ffffff'), `colourContrast(${JSON.stringify(v)}, white) is refused`, C);
    throws(() => P.colourContrast('#ffffff', v), `colourContrast(white, ${JSON.stringify(v)}) is refused`, C);
    throws(() => P.colourReadableOn(v), `colourReadableOn(${JSON.stringify(v)}) is refused`, R);
  }
  let fine = true;
  try { P.colourContrast('#2f6cbf', '#ffffff'); P.colourContrast('#ffffff', '#2f6cbf'); P.colourReadableOn('#2f6cbf'); } catch { fine = false; }
  ok(fine, 'colourContrast and colourReadableOn accept #2f6cbf');
});

section('colourFromHsv always answers a colour', () => {
  for (const [what, v] of [['{}', {}], ['NaN everywhere', { h: NaN, s: NaN, v: NaN }], ['{ h: Infinity }', { h: Infinity }], ['{ h: -Infinity, s: Infinity, v: -Infinity }', { h: -Infinity, s: Infinity, v: -Infinity }], ['null', null], ['undefined', undefined]]) {
    let got; let err = null;
    try { got = P.colourFromHsv(v); } catch (e) { err = e; }
    ok(!err && typeof got === 'string' && P.COLOUR_HEX.test(got), `colourFromHsv(${what}) answers #rrggbb, got ${err ? `a throw "${err.message}"` : JSON.stringify(got)}`);
  }
  same(P.colourFromHsv({ h: -60, s: 100, v: 100 }), '#ff00ff', 'colourFromHsv: hue -60 wraps to magenta');
  same(P.colourFromHsv({ h: 360, s: 100, v: 100 }), '#ff0000', 'colourFromHsv: hue 360 wraps to red');
  same(P.colourFromHsv({ h: 720, s: 100, v: 100 }), '#ff0000', 'colourFromHsv: hue 720 wraps to red');
  same(P.colourFromHsv({ h: 200, s: 150, v: 150 }), P.colourFromHsv({ h: 200, s: 100, v: 100 }), 'colourFromHsv clamps saturation and brightness above 100');
  same(P.colourFromHsv({ h: 200, s: -5, v: 50 }), P.colourFromHsv({ h: 200, s: 0, v: 50 }), 'colourFromHsv clamps saturation below 0');
  same(P.colourFromHsv({ h: 200, s: 50, v: -5 }), P.colourFromHsv({ h: 200, s: 50, v: 0 }), 'colourFromHsv clamps brightness below 0');
});

section('the default palette: the plan\'s figures as lower bounds', () => {
  const least = (list, other) => Math.min(...list.map((c) => TC.contrast(c, other)));
  // The plan states these to one decimal, rounded (Orange on white is 4.7988, stated as 4.8), so the least is compared at 2 decimals.
  const bound = (what, got, min) => ok(Math.round(got * 100) / 100 >= min, `${what}: the least is ${got.toFixed(4)}, wanted ${min} or more`);
  bound('dark words #1c2024 on Light', least(group('Light'), '#1c2024'), 12.8);
  bound('light words #eceff3 on Dark', least(group('Dark'), '#eceff3'), 10.3);
  bound('Dark as words on white', least(group('Dark'), '#ffffff'), 11.9);
  bound('white words on Strong', least(group('Strong'), '#ffffff'), 4.8);
  bound('Strong against #0e1a2b', least(group('Strong'), '#0e1a2b'), 3.2);
});

section('the block reaches nothing outside itself', () => {
  // --- the block reaches nothing outside itself: run it again in an empty context (no window, document, require, process, console) ---
  let out;
  try {
    out = vm.runInNewContext(`(function () {\n      const P = (function () {\n${block}\n; return { ${NAMES} }; })();
      const pal = P.colourPaletteCheck(P.COLOUR_PALETTE);
      const hex = P.colourFromHsv(P.colourToHsv(P.colourClean(' #2F6CBF ')));
      const a = P.colourAnswer(hex, 49.5, true);
      return JSON.stringify([pal.length, hex, a, P.colourOpacity('x'), P.colourContrast(hex, '#ffffff'), P.colourReadableOn(hex)]);
    })()`, Object.create(null), { timeout: 5000 });
  } catch (e) { out = `threw ${e && e.message}`; }
  same(out, JSON.stringify([3, '#2f6cbf', { color: '#2f6cbf', opacity: 50 }, 100, TC.contrast('#2f6cbf', '#ffffff'), P.colourReadableOn('#2f6cbf')]),
    'the colour block runs in an empty context (it uses nothing outside itself)');
  const code = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
  const reach = code.match(/\b(window|document|globalThis|self|localStorage|sessionStorage|postMessage|fetch|require|process|env)\b/g);
  same(reach, null, 'the colour block names no window, document, storage, messages, fetch or env');
});

section('read as code', () => {
  // --- read as code: the public object, and no native colour input ---
  const u = sdk.indexOf('\n    util: {');
  const end = u < 0 ? -1 : sdk.indexOf('\n    },', u);
  const util = u > 0 && end > u ? sdk.slice(u, end) : '';
  ok(util !== '', 'host.js has the host.util object');
  ok(/\bcontrast:\s*colourContrast\b/.test(util), 'host.util.contrast is colourContrast');
  ok(/\breadableOn:\s*colourReadableOn\b/.test(util), 'host.util.readableOn is colourReadableOn');
  const code = sdk.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
  const native = [
    /<input\b[^>]*\btype\s*=\s*["']?color\b/i,
    /\.type\s*=\s*['"`]color['"`]/,
    /setAttribute\(\s*['"`]type['"`]\s*,\s*['"`]color['"`]\s*\)/,
    /\btype\s*:\s*['"`]color['"`]/,
  ].filter((re) => re.test(code)).map(String);
  same(native, [], 'public/sdk/host.js creates no <input type="color"> (decision 6)');
});

say(`Node: ${n} checks${problems.length ? `, ${problems.length} failed` : ' passed'}`);

// ---- 2. Chromium (step 2) ----
// Headless Chromium on a throwaway server (one per run, stopped at the end; only what this check started is stopped), as the header
// says. In light and dark, at 1280 and at a 390 touch screen:
//   - in a module running in the page (a shadow root made with createHost on the admin page, in a box of its own): the refusals; the
//     popover opened under an anchor, flipped above an anchor at the box's foot, at a point, at { x: 100000, y: 4 } and { x: 50, y: 4 },
//     always inside the box, and the same call again closing it; a swatch answers and closes; the keyboard order and each control's
//     keys; a typed hex taken and a bad one marked; Escape; dragging (a touch drag at 390) with onInput and one answer; opacity: false
//     (decision 11); a module palette; colorField (its trigger's name, input then change, onChange, the toggle, disabled, set, destroy);
//     the page's own hostColour.field; 44px targets and 16px hex text at 390; the picker's words at 4.5:1 on its surface; the stronger
//     edge on White in light and Black in dark; the accessibility tree (the dialog, the area, the sliders, Hex, each radio);
//   - in an uploaded module in its sandboxed frame (built here at run time): the toolbar button opens the picker at { x, y: 4 } inside
//     the frame, the same button closes it, Escape gives focus back to the toolbar button, and a colorField in a form sets its input.
//     The popover's background in a frame is not asserted (a separate fix in module-host.js).
//   Every answer seen is { color: #rrggbb, opacity: a whole number 0 to 100 }.
// The ratio of an element's words to what is behind it (the backgrounds laid over each other up the tree, through a shadow root's host).
const CONTRAST_JS = `window.__contrast = (el) => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const g = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (c) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = c; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (top, under) => top[3] >= 1 ? top : [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3])).concat([1]);
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const layers = []; for (let n = el; n; n = n.parentElement || (n.getRootNode() && n.getRootNode().host)) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 1) break; }
  let bg = [255, 255, 255, 1]; for (const l of layers.reverse()) bg = over(l, bg);
  const fg = over(rgba(getComputedStyle(el).color), bg);
  const a = lum(fg), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}`;
const bin = findBrowser();
if (!bin) {
  say('Chromium: SKIPPED, no Chromium found (set CHROME_PATH). The browser half did not run; this is not a pass.');
} else {
  const started = Date.now();
  const before = { n, failed: problems.length };
  try {
    await browserHalf(bin);
  } catch (e) {
    n += 1;
    problems.push(`browser half: ${e && (e.stack || e.message)}`);
  }
  say(`Chromium: ${n - before.n} checks${problems.length > before.failed ? `, ${problems.length - before.failed} failed` : ' passed'} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
finish();

async function browserHalf(chrome) {
  const { buildModule } = createRequire(import.meta.url)(path.join(ROOT, 'server/module-build.js'));
  const NAMES_ALL = PALETTE.flatMap((g) => g.colours.map((c) => c.name));
  const HINT = 'Type six hex digits, like #2f6cbf';
  const NOTE = 'Opacity isn\'t kept here.';
  const answers = []; // every answer seen, for the shape check at the end
  const note = []; // what is worth saying that is not a failure

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'colour-picker-'));
  let server = null;
  let browser = null;
  let cdp = null;
  let systemCss = '';
  try {
    server = await startServer(dataDir, await freePort(), 'colour-picker');
    const login = await fetch(`${server.base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'admin', password: PASSWORD }) });
    if (login.status !== 200) throw new Error(`cannot sign in as admin: ${login.status}`);
    const cookies = login.headers.getSetCookie().map((c) => { const [nv] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1) }; });
    const jar = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

    // The uploaded test module: a toolbar button that opens the picker at { x, y: 4 }, and a colour field in a form.
    const modDir = path.join(dataDir, 'cpcheck-src');
    fs.mkdirSync(path.join(modDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(modDir, 'module.json'), JSON.stringify({ id: 'cpcheck', name: 'Colour check', version: '0.0.1', icon: 'palette', scope: ['environment'], surfaces: { page: { entry: 'cpcheck.html' } } }));
    fs.writeFileSync(path.join(modDir, 'src', 'cpcheck.html'), '<!doctype html><html><head><meta charset="utf-8"><style>/*__CSS__*/</style></head><body><form id="form"><label for="fld">Fill</label> <input id="fld" type="text" value="#2f6cbf"></form><script>/*__JS__*/</script></body></html>');
    fs.writeFileSync(path.join(modDir, 'src', 'cpcheck.css'), 'form { padding: 80px 16px; }');
    fs.writeFileSync(path.join(modDir, 'src', 'cpcheck.js'), `const host = window.host; window.__answers = []; window.__events = [];
host.ready().then(() => {
  const fld = host.root.getElementById('fld');
  fld.addEventListener('input', () => window.__events.push('input'));
  fld.addEventListener('change', () => window.__events.push('change'));
  window.__field = host.ui.colorField(fld, { onChange: (a) => window.__events.push(a) });
  host.ui.toolbarButton({ id: 'colour', label: 'Colour', icon: 'palette', onClick: (e) => {
    window.__tbx = e.x;
    host.ui.colorPicker({ at: { x: Number.isFinite(e.x) ? e.x : 100000, y: 4 }, value: '#c0392b' }).then((a) => window.__answers.push(a));
  } });
  window.__ready = true;
});`);
    const up = await fetch(`${server.base}/api/modules`, { method: 'POST', headers: { 'content-type': 'application/zip', cookie: jar }, body: buildModule(modDir).zip });
    ok(up.status === 201, `the test module was not uploaded: ${up.status} ${(await up.text()).slice(0, 200)}`);
    const en = await fetch(`${server.base}/api/modules/cpcheck`, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: jar }, body: JSON.stringify({ enabled: true, allSpaces: true }) });
    ok(en.status === 200, `the test module could not be turned on: ${en.status}`);
    systemCss = await (await fetch(`${server.base}/sdk/system.css`)).text();

    browser = await launch(chrome);
    ({ cdp } = browser);

    for (const [size, mode] of [[1280, 'light'], [1280, 'dark'], [390, 'light'], [390, 'dark']]) {
      const coarse = size === 390;
      const label = `${size}px ${mode}`;
      const tab = new Tab(cdp, {});
      await tab.open(size, mode, false);
      const send = (m, p) => cdp.send(m, p, tab.sid);
      const height = coarse ? 844 : 900;
      if (coarse) {
        await send('Emulation.setDeviceMetricsOverride', { width: size, height, deviceScaleFactor: 1, mobile: true });
        await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      }
      for (const c of cookies) await send('Network.setCookie', { ...c, url: server.base });
      try {
        await pageCases({ tab, send, label, coarse, size, mode, height });
        await frameCases({ tab, send, label, coarse });
      } catch (e) {
        n += 1;
        problems.push(`${label}: stopped: ${e && (e.stack || e.message)}`);
      }
      await tab.close();
    }

    // Every answer seen: a colour and a percent, nothing else.
    const badShape = answers.filter((a) => a !== null && !(a && Object.keys(a).sort().join() === 'color,opacity' && /^#[0-9a-f]{6}$/.test(a.color) && Number.isInteger(a.opacity) && a.opacity >= 0 && a.opacity <= 100));
    same(badShape, [], `every answer (${answers.filter(Boolean).length} of them) is { color: #rrggbb, opacity: 0 to 100 }`);
    for (const line of [...new Set(note)]) say(`note: ${line}`);
    ok(answers.filter(Boolean).length >= 20, `the browser half saw ${answers.filter(Boolean).length} answers; it should see many more`);
  } finally {
    if (browser) await stopBrowser(browser.child, browser.dir);
    if (server) await stopServer(server);
    try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 }); } catch { /* still closing */ }
  }

  // ---- the keys, the pointer and the finger ----
  async function key(send, k, { shift = false } = {}) {
    const codes = { Escape: 27, Enter: 13, Tab: 9, ' ': 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, PageUp: 33, PageDown: 34 };
    const code = k === ' ' ? 'Space' : k;
    const base = { key: k, code, windowsVirtualKeyCode: codes[k], modifiers: shift ? 8 : 0 };
    if (k === 'Enter' || k === ' ') await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: k === 'Enter' ? '\r' : ' ' });
    else await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }
  async function press(send, coarse, x, y) {
    if (coarse) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
    }
    await sleep(60);
  }
  async function drag(send, coarse, pts) {
    const [x0, y0] = pts[0];
    if (coarse) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
      for (const [x, y] of pts.slice(1)) await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0, button: 'none' });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 });
      for (const [x, y] of pts.slice(1)) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
      const [x1, y1] = pts[pts.length - 1];
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', buttons: 0, clickCount: 1 });
    }
    await sleep(60);
  }

  // ---- a module in the page ----
  async function pageCases({ tab, send, label, coarse, size, mode, height }) {
    await send('Page.navigate', { url: `${server.base}/admin.html` });
    let ready = false;
    for (let i = 0; i < 100 && !ready; i += 1) { ready = await tab.eval(`document.readyState === 'complete' && typeof window.hostColour === 'object' && typeof window.createHost === 'function'`).catch(() => false); if (!ready) await sleep(100); }
    if (!ready) throw new Error('the admin page did not load the SDK (window.hostColour, createHost)');
    await sleep(300);
    // The module: a shadow root in a box of its own (its rootElement), on top of the page, with the SDK's styles; the box is filled
    // by a plain area so a press in the box outside the picker is a press in the module.
    const box = coarse ? { L: 0, T: 40, W: size, H: height - 60 } : { L: 120, T: 90, W: 560, H: 720 };
    await tab.eval(`(async () => {
      const css = ${JSON.stringify(systemCss)}.replace(/:root\\s*\\{[^}]*\\}/g, '');
      const c = document.createElement('div');
      c.id = 'cp-box';
      c.style.cssText = 'position:fixed;left:${box.L}px;top:${box.T}px;width:${box.W}px;height:${box.H}px;overflow:hidden;z-index:2147480000';
      document.body.appendChild(c);
      const R = c.attachShadow({ mode: 'open' });
      R.innerHTML = '<style>' + css + '</style><style>.fill{position:absolute;inset:0;background:var(--surface-page)}#a{position:absolute;left:12px;top:12px}#low{position:absolute;left:12px;bottom:12px}#fl{position:absolute;right:12px;top:12px;display:flex;gap:8px;align-items:center}</style>'
        + '<div class="fill"></div><button id="a" class="btn" type="button">Anchor</button><button id="low" class="btn" type="button">Low</button>'
        + '<label id="fl">Row <input id="fld" type="text" value="#c0392b" aria-label="Row colour"></label>';
      const h = createHost({ call: (m) => (m === 'hello' ? Promise.resolve({ module: { id: 'cpcheck' } }) : Promise.reject(new Error('not here'))), root: R, rootElement: c, elementAt: (p) => document.elementFromPoint(p.x, p.y), applyTheme: () => {} }).host;
      await h.ready().catch(() => {});
      window.__h = h; window.__R = R; window.__box = c;
      window.__inputs = []; window.__answers = [];
      // Opens the picker with an anchor given by its id; every answer is kept.
      window.__pick = (o) => {
        const opt = { ...o };
        if (typeof opt.anchor === 'string') opt.anchor = R.getElementById(opt.anchor);
        window.__inputs = [];
        window.__last = undefined;
        const p = h.ui.colorPicker({ ...opt, onInput: (a) => window.__inputs.push(a) });
        p.then((a) => { window.__answers.push(a); window.__last = a; });
        return 1;
      };
      window.__cp = () => R.querySelector('.sdk-cp') || document.querySelector('.sdk-cp');
      window.__in = (sel) => (window.__cp() ? window.__cp().querySelector(sel) : null);
      window.__focus = () => { const a = R.activeElement || document.activeElement; return a ? (a.getAttribute('aria-label') || (a.id ? '#' + a.id : '') || a.className) : ''; };
      window.__rect = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
      return 1;
    })()`);
    // Every step answers within 8s, or the case stops and says which step it was.
    const ev = (expr) => Promise.race([tab.eval(expr), sleep(8000).then(() => { throw new Error(`no answer in 8s from: ${expr.slice(0, 160)}`); })]).catch((e) => { throw new Error(`${e.message.slice(0, 300)} (at: ${expr.slice(0, 160)})`); });
    const tick = () => sleep(30);
    const open = () => ev(`Boolean(window.__cp())`);
    const pick = async (o) => { await ev(`window.__pick(${o})`); await tick(); };
    const last = async () => { await tick(); return ev('window.__last'); };
    const pressOn = async (expr) => { const r = await ev(`window.__rect(${expr})`); await press(send, coarse, r.x, r.y); };
    const swatch = (name, group = 'Colours') => `window.__cp().querySelector('[aria-label=${JSON.stringify(group)}] .sdk-swatch[aria-label=${JSON.stringify(name)}]')`;
    const boxRect = await ev(`window.__rect(window.__box)`);
    const inside = async (what) => {
      const r = await ev(`window.__rect(window.__cp())`);
      ok(r.l >= boxRect.l - 0.5 && r.t >= boxRect.t - 0.5 && r.r <= boxRect.r + 0.5 && r.b <= boxRect.b + 0.5, `${label}: ${what}: the picker (${Math.round(r.l)},${Math.round(r.t)} to ${Math.round(r.r)},${Math.round(r.b)}) is not inside the module's box (${boxRect.l},${boxRect.t} to ${boxRect.r},${boxRect.b})`);
      return r;
    };
    const escape = async (what) => { await key(send, 'Escape'); const a = await last(); ok(a === null && !(await open()), `${label}: ${what}: Escape answered ${JSON.stringify(a)} and the picker is ${(await open()) ? 'still open' : 'closed'}; wanted null and closed`); answers.push(a); };

    // --- the refusals ---
    const refusal = (expr) => ev(`(() => { try { ${expr}; return 'no throw'; } catch (e) { return e.name + ': ' + e.message; } })()`);
    same(await refusal(`__h.ui.colorPicker({})`), 'Error: host.ui.colorPicker needs an anchor or a point', `${label}: colorPicker with no anchor and no point`);
    same(await refusal(`__h.ui.colorPicker()`), 'Error: host.ui.colorPicker needs an anchor or a point', `${label}: colorPicker with nothing`);
    same(await refusal(`__h.ui.colorPicker({ at: { x: NaN, y: 4 } })`), 'Error: host.ui.colorPicker needs an anchor or a point', `${label}: colorPicker at a point that is not a number`);
    same(await refusal(`__h.ui.colorPicker({ anchor: 'a' })`), 'Error: host.ui.colorPicker needs an anchor or a point', `${label}: colorPicker with an anchor that is not an element`);
    same(await refusal(`__h.ui.colorPicker({ at: { x: 1, y: 1 }, palette: [{ heading: 'Inks', colours: [{ name: 'Ink', color: 'red' }] }] })`), 'TypeError: host.ui.colorPicker: a palette colour needs a name and a #rrggbb colour', `${label}: colorPicker with a bad palette`);
    same(await refusal(`__h.ui.colorPicker({ at: { x: 1, y: 1 }, palette: [] })`), 'TypeError: host.ui.colorPicker: a palette colour needs a name and a #rrggbb colour', `${label}: colorPicker with an empty palette`);
    same(await refusal(`__h.ui.colorField(document.body)`), 'Error: host.ui.colorField needs an <input>', `${label}: colorField on something that is not an input`);
    same(await refusal(`__h.ui.colorField(null)`), 'Error: host.ui.colorField needs an <input>', `${label}: colorField on nothing`);
    same(await refusal(`__h.ui.colorField(__R.getElementById('fld'), { palette: [{ heading: 'x', colours: [{ name: '<b>', color: '#000000' }] }] })`), 'TypeError: host.ui.colorPicker: a palette colour needs a name and a #rrggbb colour', `${label}: colorField with a bad palette`);
    ok(!(await open()) && (await ev(`!__R.querySelector('.sdk-picker')`)), `${label}: a refused call left a picker or a trigger behind`);

    // --- where it opens ---
    const anchorRect = await ev(`window.__rect(__R.getElementById('a'))`);
    await pick(`{ anchor: 'a', value: '#2f6cbf' }`);
    let r = await inside('under the anchor');
    ok(Math.abs(r.t - (anchorRect.b + 4)) <= 1 && Math.abs(r.l - Math.max(boxRect.l + 4, anchorRect.l)) <= 1, `${label}: under the anchor the picker is at ${Math.round(r.l)},${Math.round(r.t)}; wanted ${Math.round(anchorRect.l)},${Math.round(anchorRect.b + 4)} (4px under it)`);
    same(await ev(`[window.__cp().getAttribute('role'), window.__cp().getAttribute('aria-label')]`), ['dialog', 'Colour'], `${label}: the picker is a dialog called "Colour" when no label is given`);
    await escape('under the anchor');
    const lowRect = await ev(`window.__rect(__R.getElementById('low'))`);
    await pick(`{ anchor: 'low' }`);
    r = await inside('at an anchor at the foot of the box');
    ok(r.b <= lowRect.t - 3, `${label}: at an anchor at the foot of the box the picker (bottom ${Math.round(r.b)}) is not flipped above it (top ${Math.round(lowRect.t)})`);
    await escape('flipped above');
    await pick(`{ at: { x: 40, y: 30 } }`);
    r = await inside('at a point');
    ok(Math.abs(r.l - Math.min(boxRect.l + 40, boxRect.r - 4 - r.w)) <= 1 && Math.abs(r.t - (boxRect.t + 30)) <= 1, `${label}: at { x: 40, y: 30 } the picker is at ${Math.round(r.l - boxRect.l)},${Math.round(r.t - boxRect.t)} in the box (clamped where it does not fit)`);
    await escape('at a point');
    await pick(`{ at: { x: 100000, y: 4 } }`);
    r = await inside('at { x: 100000, y: 4 }');
    ok(Math.abs(r.r - (boxRect.r - 4)) <= 1 && Math.abs(r.t - (boxRect.t + 4)) <= 1, `${label}: at { x: 100000, y: 4 } the picker is not at the box's top right (right ${Math.round(boxRect.r - r.r)}px in, top ${Math.round(r.t - boxRect.t)}px down; wanted 4 and 4)`);
    await escape('at the top right');
    await pick(`{ at: { x: 50, y: 4 } }`);
    r = await inside('at { x: 50, y: 4 }');
    const wantL = Math.min(boxRect.l + 50, boxRect.r - 4 - r.w);
    ok(Math.abs(r.l - wantL) <= 1 && Math.abs(r.t - (boxRect.t + 4)) <= 1, `${label}: at { x: 50, y: 4 } the picker is at ${Math.round(r.l - boxRect.l)},${Math.round(r.t - boxRect.t)} in the box; wanted ${Math.round(wantL - boxRect.l)},4`);
    const scroll = await ev(`(() => { const p = window.__cp(); return { sw: p.scrollWidth, cw: p.clientWidth }; })()`);
    ok(scroll.sw <= scroll.cw + 1, `${label}: the picker scrolls sideways (${scroll.sw} in ${scroll.cw})`);
    await escape('at { x: 50, y: 4 }');
    // The same call again while it is open closes it, and both answer null (a toggle).
    same(await ev(`(async () => { const a = __h.ui.colorPicker({ at: { x: 10, y: 4 } }); const b = __h.ui.colorPicker({ at: { x: 10, y: 4 } }); return [await a, await b, !window.__cp()]; })()`), [null, null, true], `${label}: the same call again while it is open closes it, both answering null`);

    // --- a swatch answers and closes ---
    await pick(`{ anchor: 'a', value: '#2f6cbf', opacity: 80 }`);
    same(await ev('window.__focus()'), 'Blue', `${label}: focus starts on the chosen swatch`);
    await pressOn(swatch('Teal'));
    const teal = await last();
    answers.push(teal);
    same(teal, { color: '#00796b', opacity: 80 }, `${label}: a swatch answers its colour with the opacity it started at`);
    ok(!(await open()), `${label}: a swatch did not close the picker`);
    same(await ev('window.__answers.length'), 6, `${label}: the answers so far (5 Escapes and the swatch) each came once`);
    // Enter on a swatch answers too.
    await pick(`{ anchor: 'a', value: '#00796b' }`);
    await key(send, 'ArrowRight');
    same(await ev('window.__focus()'), 'Blue', `${label}: Right moves from Teal to Blue in the palette`);
    await key(send, 'Enter');
    const blue = await last();
    answers.push(blue);
    same(blue, { color: '#2f6cbf', opacity: 100 }, `${label}: Enter on a swatch answers its colour`);
    same(await ev('window.__focus()'), '#a', `${label}: after a swatch, focus is back on the anchor`);

    // --- the keyboard, the names and the words ---
    await pick(`{ anchor: 'a', value: '#2F6CBF', opacity: 50, label: 'Fill colour' }`);
    same(await ev('window.__focus()'), 'Blue', `${label}: a value in capitals starts on its swatch`);
    same(await ev(`window.__cp().getAttribute('aria-label')`), 'Fill colour', `${label}: the dialog is named by its label`);
    const recentNames = await ev(`[...window.__cp().querySelectorAll('[aria-label="Recent"] .sdk-swatch')].map((b) => b.getAttribute('aria-label'))`);
    same(recentNames, ['Blue', 'Teal'], `${label}: Recent holds the colours chosen, newest first, named by their colour names`);
    const dropper = await ev(`!window.__in('.sdk-cp-dropper').hidden`);
    const order = ['Saturation and brightness', 'Hue', 'Opacity', 'sdk-cp-hexin', ...(dropper ? ['Pick from the screen'] : []), 'Blue', 'Blue'];
    const seen = [];
    await key(send, 'Tab'); // from the palette to Recent
    seen.push(await ev(`window.__focus() + '@' + (((__R.activeElement || document.activeElement).closest('[role=radiogroup]') || { getAttribute: () => '' }).getAttribute('aria-label'))`));
    for (let i = 0; i < order.length - 1; i += 1) { await key(send, 'Tab'); seen.push(await ev('window.__focus()')); }
    same(seen, ['Blue@Recent', ...order.slice(0, -1)], `${label}: Tab goes from the palette to Recent, then round to the area, Hue, Opacity, Hex${dropper ? ', Pick from the screen' : ''} and the palette`);
    await key(send, 'Tab', { shift: true });
    same(await ev('window.__focus()'), dropper ? 'Pick from the screen' : 'sdk-cp-hexin', `${label}: Shift+Tab goes back`);

    // The area: Left and Right saturation, Up and Down brightness, by 1 and with Shift by 10; Home and End the ends of saturation.
    const area = async () => { const t = await ev(`window.__in('.sdk-cp-area').getAttribute('aria-valuetext')`); const m = /^Saturation (\d+) percent, brightness (\d+) percent$/.exec(t); return m ? [Number(m[1]), Number(m[2])] : t; };
    await ev(`window.__in('.sdk-cp-area').focus()`);
    const a0 = await area();
    ok(Array.isArray(a0), `${label}: the area's aria-valuetext reads ${JSON.stringify(a0)}`);
    const hex0 = await ev(`window.__in('.sdk-cp-hexin').value`);
    const steps = [[['ArrowRight'], [1, 0]], [['ArrowRight', true], [10, 0]], [['ArrowLeft'], [-1, 0]], [['ArrowDown'], [0, -1]], [['ArrowDown', true], [0, -10]], [['ArrowUp'], [0, 1]]];
    let at = a0;
    for (const [[k, shift], [ds, dv]] of steps) {
      await key(send, k, { shift });
      const now = await area();
      same(now, [at[0] + ds, at[1] + dv], `${label}: ${shift ? 'Shift+' : ''}${k} on the area`);
      at = now;
    }
    ok((await ev(`window.__in('.sdk-cp-hexin').value`)) !== hex0, `${label}: the area's keys did not change the colour`);
    await key(send, 'Home');
    same((await area())[0], 0, `${label}: Home on the area is no saturation`);
    await key(send, 'End');
    same((await area())[0], 100, `${label}: End on the area is full saturation`);
    // Hue: arrows by 1, Shift by 10, Page Up and Page Down by 10, Home and End the ends.
    await ev(`window.__in('.sdk-cp-hue').focus()`);
    const hueText = () => ev(`window.__in('.sdk-cp-hue').getAttribute('aria-valuetext')`);
    for (const [k, shift, want] of [['Home', false, 0], ['ArrowRight', false, 1], ['ArrowRight', true, 11], ['PageUp', false, 21], ['ArrowUp', false, 22], ['PageDown', false, 12], ['ArrowLeft', true, 2], ['ArrowDown', false, 1], ['End', false, 359]]) {
      await key(send, k, { shift });
      same(await hueText(), `Hue ${want} degrees`, `${label}: ${shift ? 'Shift+' : ''}${k} on Hue`);
    }
    // Opacity: the same keys.
    await ev(`window.__in('.sdk-cp-alpha').focus()`);
    const opText = () => ev(`window.__in('.sdk-cp-alpha').getAttribute('aria-valuetext')`);
    for (const [k, shift, want] of [['ArrowLeft', false, 49], ['ArrowLeft', true, 39], ['PageUp', false, 49], ['PageDown', false, 39], ['Home', false, 0], ['End', false, 100], ['ArrowDown', false, 99]]) {
      await key(send, k, { shift });
      same(await opText(), `Opacity ${want} percent`, `${label}: ${shift ? 'Shift+' : ''}${k} on Opacity`);
    }
    same(await ev(`[window.__in('.sdk-cp-alpha').getAttribute('aria-valuenow'), window.__in('.sdk-cp-alpha').getAttribute('aria-disabled')]`), ['99', null], `${label}: Opacity is shown, on, at 99`);
    const inputsSoFar = await ev('window.__inputs.length');
    ok(inputsSoFar >= 15, `${label}: onInput fired ${inputsSoFar} times for the keys; it should fire on each change`);
    ok(await open() && (await ev('window.__last')) === undefined, `${label}: the picker answered while it was being changed`);
    // The palette: arrows inside it, Up and Down by rows, Home and End.
    const blueSel = swatch('Blue');
    await ev(`${blueSel}.focus()`);
    for (const [k, want] of [['ArrowRight', 'Purple'], ['ArrowLeft', 'Blue'], ['Home', 'White'], ['ArrowDown', 'Black'], ['ArrowDown', 'Red'], ['ArrowUp', 'Black'], ['End', 'Pink']]) {
      await key(send, k);
      same(await ev('window.__focus()'), want, `${label}: ${k} in the palette`);
    }
    // Recent: its own Tab stop, arrows inside.
    await key(send, 'Tab');
    same(await ev('window.__focus()'), 'Blue', `${label}: Tab from the palette goes to Recent`);
    await key(send, 'ArrowRight');
    same(await ev('window.__focus()'), 'Teal', `${label}: Right inside Recent`);

    // The accessibility tree: the dialog, the area, the sliders, the Hex field and each radio, by name.
    await send('Accessibility.enable');
    const ax = (await send('Accessibility.getFullAXTree', {})).nodes.filter((x) => !x.ignored);
    const named = (role, name) => ax.some((x) => x.role && x.role.value === role && x.name && x.name.value === name);
    for (const [role, name] of [['dialog', 'Fill colour'], ['slider', 'Saturation and brightness'], ['slider', 'Hue'], ['slider', 'Opacity'], ['textbox', 'Hex'], ['radiogroup', 'Colours'], ['radiogroup', 'Recent'], ...NAMES_ALL.map((x) => ['radio', x])]) {
      ok(named(role, name), `${label}: the accessibility tree has no ${role} named "${name}"`);
    }
    // (Hue's aria-valuetext is read from the element above: this Chromium's DevTools tree leaves valuetext empty even on a plain slider.)
    const checked = ax.filter((x) => x.role && x.role.value === 'radio' && (x.properties || []).some((p) => p.name === 'checked' && p.value.value === 'true'));
    ok(checked.length === 0 || checked.every((x) => x.name), `${label}: a checked radio has no name`);

    // The words, on the picker's surface: Hex, the typed hex, a group's heading (4.5:1 or more).
    await tab.eval(CONTRAST_JS);
    const ratio = (expr) => ev(`window.__contrast(${expr})`);
    for (const [what, expr] of [['the word Hex', `window.__in('.sdk-cp-hex-word')`], ['the hex in its field', `window.__in('.sdk-cp-hexin')`], ['a group heading', `window.__in('.sdk-cp-head')`]]) {
      const v = await ratio(expr);
      ok(v >= 4.5, `${label}: ${what} is ${v.toFixed(2)}:1 on the picker; wanted 4.5:1`);
    }
    // White on a light menu and Black on a dark one get the stronger edge; the opposite end does not. The faint ones are exactly the
    // swatches under 3:1 against the menu's own surface, worked out here from the drawn surface with theme-colour.js's maths.
    const faint = await ev(`[...window.__cp().querySelectorAll('[aria-label="Colours"] .sdk-cp-faint')].map((b) => b.getAttribute('aria-label'))`);
    const surface = await ev(`(() => { const cv = document.createElement('canvas'); cv.width = cv.height = 1; const g = cv.getContext('2d', { willReadFrequently: true }); g.fillStyle = getComputedStyle(window.__cp()).backgroundColor; g.fillRect(0, 0, 1, 1); return '#' + [...g.getImageData(0, 0, 1, 1).data].slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join(''); })()`);
    const under3 = PALETTE.flatMap((g) => g.colours).filter((c) => TC.contrast(c.color, surface) < 3).map((c) => c.name);
    const wantFaint = mode === 'light' ? 'White' : 'Black';
    const notFaint = mode === 'light' ? 'Black' : 'White';
    ok(faint.includes(wantFaint) && !faint.includes(notFaint), `${label}: the swatches with the stronger edge are ${JSON.stringify(faint)}; wanted ${wantFaint} among them and not ${notFaint}`);
    same(faint, under3, `${label}: the swatches with the stronger edge are those under 3:1 against the menu's surface (${surface})`);
    const edges = await ev(`[${swatch(wantFaint)}, ${swatch(notFaint)}].map((b) => getComputedStyle(b, '::before').borderTopColor)`);
    ok(edges[0] !== edges[1], `${label}: ${wantFaint}'s stronger edge is drawn the same as ${notFaint}'s (${edges[0]})`);
    if (faint.length > 2) note.push(`${label}: ${faint.length} of 24 swatches take the stronger edge on a ${surface} menu (${faint.join(', ')})`);

    // At 390 on a touch screen: 44px targets and 16px hex text.
    if (coarse) {
      ok(await ev(`matchMedia('(pointer: coarse)').matches`), `${label}: the page is not a touch screen`);
      const sz = await ev(`(() => { const s = (sel) => { const e = window.__in(sel); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }; return { swatch: s('.sdk-swatch'), hue: s('.sdk-cp-hue'), alpha: s('.sdk-cp-alpha'), hex: s('.sdk-cp-hexin'), dropper: s('.sdk-cp-dropper'), area: s('.sdk-cp-area'), font: parseFloat(getComputedStyle(window.__in('.sdk-cp-hexin')).fontSize) }; })()`);
      ok(sz.swatch[0] >= 44 && sz.swatch[1] >= 44, `${label}: a swatch is ${sz.swatch.join('x')}; wanted 44px`);
      ok(sz.hue[1] >= 44 && sz.alpha[1] >= 44, `${label}: Hue is ${sz.hue[1]}px and Opacity ${sz.alpha[1]}px tall; wanted 44px`);
      ok(sz.hex[1] >= 44, `${label}: the Hex field is ${sz.hex[1]}px tall; wanted 44px`);
      ok(!sz.dropper || (sz.dropper[0] >= 44 && sz.dropper[1] >= 44), `${label}: Pick from the screen is ${sz.dropper && sz.dropper.join('x')}; wanted 44px`);
      ok(sz.area[1] >= 150, `${label}: the area is ${sz.area[1]}px tall; wanted about 160px`);
      ok(sz.font >= 16, `${label}: the hex text is ${sz.font}px; wanted 16px so the phone does not zoom`);
    }

    // --- a typed hex: taken, or marked with its line ---
    const typeHex = async (text) => { await ev(`(() => { const i = window.__in('.sdk-cp-hexin'); i.focus(); i.select(); return 1; })()`); await send('Input.insertText', { text }); await tick(); };
    await typeHex('ABCDEF');
    same(await ev('window.__inputs.at(-1)'), { color: '#abcdef', opacity: 99 }, `${label}: a whole hex typed in capitals without # shows at once`);
    await key(send, 'Tab');
    same(await ev(`[window.__in('.sdk-cp-hexin').value, window.__in('.sdk-cp-hexin').getAttribute('aria-invalid'), window.__in('.sdk-cp-error').textContent]`), ['#abcdef', null, ''], `${label}: a good hex is taken and shown in lower case, with no error`);
    await typeHex('#2f6cb');
    await key(send, 'Tab');
    const bad = await ev(`(() => { const i = window.__in('.sdk-cp-hexin'); const d = i.getAttribute('aria-describedby'); return [i.getAttribute('aria-invalid'), d ? (__R.getElementById(d) || document.getElementById(d)).textContent : null, getComputedStyle(window.__cp()).getPropertyValue('--cp-color').trim(), window.__inputs.at(-1).color]; })()`);
    same(bad, ['true', HINT, '#abcdef', '#abcdef'], `${label}: a bad hex is marked aria-invalid, described by its line, and the colour does not change`);
    const errRatio = await ratio(`window.__in('.sdk-cp-error')`);
    ok(errRatio >= 4.5, `${label}: the hex error line (${await ev(`getComputedStyle(window.__in('.sdk-cp-error')).color`)}) is ${errRatio.toFixed(2)}:1 on the picker (${await ev(`getComputedStyle(window.__cp()).backgroundColor`)}); wanted 4.5:1`);
    await typeHex('2F6CBF');
    same(await ev(`window.__in('.sdk-cp-hexin').getAttribute('aria-invalid')`), null, `${label}: a good hex typed after a bad one clears the mark`);
    await key(send, 'Enter');
    const typed = await last();
    answers.push(typed);
    same(typed, { color: '#2f6cbf', opacity: 99 }, `${label}: Enter in Hex answers the typed colour and the opacity`);
    ok(!(await open()) && (await ev('window.__focus()')) === '#a', `${label}: after Enter in Hex the picker is closed and focus is on the anchor (${await ev('window.__focus()')})`);

    // --- Escape: null, and focus back ---
    await pick(`{ anchor: 'a', value: '#c0392b' }`);
    await ev(`window.__in('.sdk-cp-hue').focus()`);
    await key(send, 'ArrowRight');
    ok((await ev('window.__inputs.length')) === 1, `${label}: one key on Hue sent ${await ev('window.__inputs.length')} onInput`);
    await escape('after a change');
    same(await ev('window.__focus()'), '#a', `${label}: Escape puts focus back on the anchor`);

    // --- dragging: onInput while it changes, the answer once (a press in the module outside the picker) ---
    await pick(`{ at: { x: 20, y: 60 }, value: '#2f6cbf', opacity: 70 }`);
    const ar = await ev(`window.__rect(window.__in('.sdk-cp-area'))`);
    const pts = [];
    for (let i = 0; i <= 8; i += 1) pts.push([ar.l + 10 + i * (ar.w - 20) / 8, ar.t + 10 + i * (ar.h - 20) / 8]);
    await drag(send, coarse, pts);
    const dragged = await ev('window.__inputs.length');
    ok(dragged >= 5, `${label}: ${coarse ? 'a touch drag' : 'a drag'} on the area sent ${dragged} onInput; wanted one for each step`);
    ok(await open() && (await ev('window.__last')) === undefined, `${label}: dragging answered or closed the picker`);
    const hr = await ev(`window.__rect(window.__in('.sdk-cp-hue'))`);
    await drag(send, coarse, [[hr.l + 10, hr.y], [hr.l + hr.w / 3, hr.y], [hr.l + hr.w / 2, hr.y]]);
    ok((await ev('window.__inputs.length')) > dragged, `${label}: dragging Hue sent no onInput`);
    const scrolled = await ev(`document.scrollingElement.scrollTop + window.__box.scrollTop`);
    same(scrolled, 0, `${label}: dragging scrolled the page`);
    await sleep(50);
    const said = await ev(`window.__in('.sdk-cp-live').textContent`);
    ok(/^(.+, )?#[0-9a-f]{6}$/.test(said), `${label}: the live line says ${JSON.stringify(said)} once the drag ends`);
    const lastInput = await ev('window.__inputs.at(-1)');
    const nAnswers = await ev('window.__answers.length');
    const cpR = await ev(`window.__rect(window.__cp())`);
    const outX = cpR.r + 20 < boxRect.r ? cpR.r + 10 : boxRect.l + 6;
    const outY = cpR.b + 20 < boxRect.b ? cpR.b + 10 : boxRect.b - 6;
    await press(send, coarse, outX, outY);
    const dropped = await last();
    answers.push(dropped);
    same(dropped, lastInput, `${label}: a press outside answers what is showing (the last onInput)`);
    same(await ev('window.__answers.length'), nAnswers + 1, `${label}: the answer came once`);
    ok(dropped && dropped.opacity === 70, `${label}: the answer kept the opacity it started at (${dropped && dropped.opacity})`);

    // --- opacity: false (decision 11) ---
    await pick(`{ at: { x: 20, y: 60 }, value: '#c0392b', opacity: false, label: 'Row colour' }`);
    const off = await ev(`(() => { const o = window.__in('.sdk-cp-alpha'); const d = o.getAttribute('aria-describedby'); const note = d ? (__R.getElementById(d) || document.getElementById(d)) : null; return [o.getAttribute('aria-disabled'), o.getAttribute('aria-valuenow'), o.getAttribute('aria-valuetext'), o.tabIndex, note ? note.textContent : null, note ? note.getClientRects().length > 0 : false]; })()`);
    same(off, ['true', '100', 'Opacity 100 percent', 0, NOTE, true], `${label}: with opacity: false the slider shows 100, is aria-disabled, stays in the Tab order and is described by its line`);
    await ev(`window.__in('.sdk-cp-alpha').focus()`);
    for (const k of ['Home', 'ArrowLeft', 'PageDown']) await key(send, k);
    const opr = await ev(`window.__rect(window.__in('.sdk-cp-alpha'))`);
    await drag(send, coarse, [[opr.l + opr.w / 2, opr.y], [opr.l + 4, opr.y]]);
    same(await ev(`window.__in('.sdk-cp-alpha').getAttribute('aria-valuenow')`), '100', `${label}: the switched-off slider does not move by keys or by dragging`);
    await ev(`window.__in('.sdk-cp-hue').focus()`);
    await key(send, 'ArrowRight');
    ok((await ev('window.__inputs')).every((a) => a.opacity === 100), `${label}: with opacity: false every onInput has opacity 100`);
    const noteRatio = await ratio(`window.__in('.sdk-cp-note')`);
    ok(noteRatio >= 4.5, `${label}: "${NOTE}" is ${noteRatio.toFixed(2)}:1 on the picker; wanted 4.5:1`);
    const ax2 = (await send('Accessibility.getFullAXTree', {})).nodes.filter((x) => !x.ignored);
    const opNode = ax2.find((x) => x.role && x.role.value === 'slider' && x.name && x.name.value === 'Opacity');
    ok(opNode && (opNode.properties || []).some((p) => p.name === 'disabled' && p.value.value === true) && opNode.description && opNode.description.value === NOTE, `${label}: the accessibility tree does not read the switched-off Opacity as disabled and described by "${NOTE}"`);
    ok(ax2.some((x) => x.role && x.role.value === 'dialog' && x.name && x.name.value === 'Row colour'), `${label}: the accessibility tree has no dialog named "Row colour"`);
    await pressOn(swatch('Gold'));
    const gold = await last();
    answers.push(gold);
    same(gold, { color: '#8a6a00', opacity: 100 }, `${label}: with opacity: false the answer's opacity is 100`);
    await pick(`{ at: { x: 20, y: 60 }, value: '#c0392b', opacity: 0 }`);
    await key(send, 'Escape');
    await last();
    await pick(`{ at: { x: 20, y: 60 }, value: '#c0392b', opacity: 37 }`);
    await pressOn(swatch('Red'));
    const kept = await last();
    answers.push(kept);
    same(kept, { color: '#c0392b', opacity: 37 }, `${label}: where opacity is kept the answer carries the percent`);

    // --- a module palette ---
    await pick(`{ at: { x: 20, y: 60 }, recent: false, palette: [{ heading: 'Inks', colours: [{ name: 'Ink', color: '#1A2B3C' }, { name: 'Paper', color: 'f5eedb' }] }] }`);
    same(await ev(`[...window.__cp().querySelectorAll('.sdk-swatch')].map((b) => b.getAttribute('aria-label'))`), ['Ink', 'Paper'], `${label}: a module palette is drawn in place of the default, and recent: false leaves Recent out`);
    same(await ev(`[...window.__cp().querySelectorAll('.sdk-cp-head')].map((h) => h.textContent)`), ['Inks'], `${label}: the module palette's heading is drawn`);
    same(await ev(`window.__in('.sdk-cp-hexin').value`), '#1a2b3c', `${label}: with no value the picker starts at the palette's first colour`);
    await pressOn(swatch('Ink'));
    const ink = await last();
    answers.push(ink);
    same(ink, { color: '#1a2b3c', opacity: 100 }, `${label}: a module palette's swatch answers its colour`);
    await pick(`{ at: { x: 20, y: 60 }, value: 'red', palette: [{ heading: 'Inks', colours: [{ name: 'Ink', color: '#1a2b3c' }] }] }`);
    same(await ev(`[[...window.__cp().querySelectorAll('[aria-label="Recent"] .sdk-swatch')].map((b) => b.getAttribute('aria-label')).slice(0, 2), window.__in('.sdk-cp-hexin').value, window.__focus()]`), [['#c0392b', '#8a6a00'], '#1a2b3c', 'Ink'], `${label}: a value that is not #rrggbb is ignored (it starts at the palette's first colour), and Recent, newest first, names a colour the palette does not have by its hex (the answer from recent: false is not kept)`);
    await key(send, 'Escape');
    answers.push(await last());

    // --- colorField ---
    await ev(`(() => { const i = __R.getElementById('fld'); window.__ev = []; i.addEventListener('input', () => __ev.push('input')); i.addEventListener('change', () => __ev.push('change')); window.__f = __h.ui.colorField(i, { opacity: false, onChange: (a) => __ev.push(a) }); window.__trig = () => __R.querySelector('.sdk-picker'); return 1; })()`);
    const trig = () => ev(`(() => { const t = window.__trig(); return t ? [t.getAttribute('aria-label'), t.getAttribute('aria-haspopup'), t.getAttribute('aria-expanded'), t.disabled, __R.getElementById('fld').hidden] : null; })()`);
    same(await trig(), ['Row colour, Red, #c0392b. Change it', 'dialog', 'false', false, true], `${label}: the colour field's trigger is named "<label>, <name>, <hex>. Change it", has a dialog popup, and hides the input`);
    same(await ev('window.__f.value'), '#c0392b', `${label}: the field's value`);
    await pressOn('window.__trig()');
    same(await ev(`[window.__trig().getAttribute('aria-expanded'), window.__cp() && window.__cp().getAttribute('aria-label'), window.__in('.sdk-cp-alpha').getAttribute('aria-disabled')]`), ['true', 'Row colour', 'true'], `${label}: the field opens its picker named by the field, with Opacity switched off`);
    await inside('from the colour field');
    await pressOn(swatch('Teal'));
    same(await ev(`[__R.getElementById('fld').value, window.__ev, window.__f.value, window.__trig().getAttribute('aria-expanded'), window.__trig().getAttribute('aria-label'), window.__focus()]`),
      ['#00796b', ['input', 'change', { color: '#00796b', opacity: 100 }], '#00796b', 'false', 'Row colour, Teal, #00796b. Change it', 'Row colour, Teal, #00796b. Change it'],
      `${label}: a choice in the field sets the input, sends input then change, then onChange once, and focus goes back to the trigger`);
    answers.push(...(await ev('window.__ev.filter((x) => typeof x === "object")')));
    // Opened and closed again with nothing chosen: nothing is sent, and the trigger shows the stored colour.
    await pressOn('window.__trig()');
    await ev(`window.__in('.sdk-cp-hue').focus()`);
    await key(send, 'ArrowRight');
    await key(send, 'Escape');
    await tick();
    same(await ev(`[window.__ev.length, window.__trig().getAttribute('aria-label'), Boolean(window.__cp())]`), [3, 'Row colour, Teal, #00796b. Change it', false], `${label}: Escape in the field sends nothing and puts the trigger back`);
    // The trigger again while it is open closes it (a toggle).
    await pressOn('window.__trig()');
    await pressOn('window.__trig()');
    same(await ev(`[Boolean(window.__cp()), window.__trig().getAttribute('aria-expanded'), window.__ev.length]`), [false, 'false', 3], `${label}: the field's trigger pressed again closes its picker and sends nothing`);
    same(await ev(`[window.__f.set('#ABCDEF'), window.__f.set('red'), window.__f.value, __R.getElementById('fld').value, window.__ev.length]`), [true, false, '#abcdef', '#abcdef', 3], `${label}: set() takes a hex quietly and ignores anything else`);
    await ev(`(__R.getElementById('fld').disabled = true, 1)`);
    await tick();
    same(await ev(`window.__trig().disabled`), true, `${label}: the trigger follows a disabled input`);
    same(await ev(`(async () => [await window.__f.open(), Boolean(window.__cp())])()`), [null, false], `${label}: a disabled field does not open`);
    await ev(`(__R.getElementById('fld').disabled = false, 1)`);
    await tick();
    same(await ev(`window.__trig().disabled`), false, `${label}: the trigger follows the input back on`);
    await ev('(window.__f.open(), 1)');
    await tick();
    await ev('window.__f.destroy()');
    await tick();
    same(await ev(`[Boolean(window.__trig()), __R.getElementById('fld').hidden, __R.getElementById('fld').hasAttribute('tabindex'), Boolean(window.__cp())]`), [false, false, false, false], `${label}: destroy() closes the picker, takes the trigger away and puts the input back as it was`);
    if (coarse) {
      await ev(`(window.__f2 = __h.ui.colorField(__R.getElementById('fld')), 1)`);
      const th = await ev(`Math.round(window.__trig().getBoundingClientRect().height)`);
      ok(th >= 44, `${label}: the colour field's trigger is ${th}px tall; wanted 44px`);
      await ev('window.__f2.destroy()');
    }

    answers.push(...(await ev('window.__answers')));
    await ev(`(document.getElementById('cp-box').remove(), 1)`);

    // --- the page's own field (hostColour, for the host's pages) ---
    await ev(`(() => { const i = document.createElement('input'); i.type = 'color'; i.id = 'cp-page'; i.value = '#2f6cbf'; i.setAttribute('aria-label', 'Accent'); i.style.cssText = 'position:fixed;left:8px;top:8px'; document.body.appendChild(i); window.__pev = []; i.addEventListener('change', () => __pev.push(i.value)); window.__pf = hostColour.field(i, { onChange: (a) => __pev.push(a) }); return 1; })()`);
    same(await ev(`document.getElementById('cp-page').previousElementSibling.getAttribute('aria-label')`), 'Accent, Blue, #2f6cbf. Change it', `${label}: hostColour.field puts the same trigger on a page's input`);
    await ev(`document.getElementById('cp-page').previousElementSibling.click()`);
    await tick();
    ok(await ev(`Boolean(document.querySelector('.sdk-cp'))`), `${label}: hostColour.field's trigger opened no picker in the page`);
    await pressOn(`document.querySelector('.sdk-cp .sdk-swatch[aria-label="Gold"]')`);
    same(await ev('window.__pev'), ['#8a6a00', { color: '#8a6a00', opacity: 100 }], `${label}: hostColour.field sets the page's input and answers`);
    answers.push(...(await ev('window.__pev.filter((x) => typeof x === "object")')));
    await ev(`(window.__pf.destroy(), document.getElementById('cp-page').remove(), 1)`);
  }

  // ---- an uploaded module in its sandboxed frame ----
  async function frameCases({ tab, send, label, coarse }) {
    const attached = [];
    const hook = (m) => { if (m.method === 'Target.attachedToTarget' && m.sessionId === tab.sid && m.params.targetInfo.type === 'iframe') attached.push(m.params.sessionId); };
    cdp.listeners.push(hook);
    try {
      await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
      await send('Page.navigate', { url: `${server.base}/modules/cpcheck` });
      // The module's frame: in its own process (a sandboxed frame), or in the page's; either way it is evaluated in its own world.
      const frameEval = async (sid, expr) => {
        const r = await cdp.send('Runtime.evaluate', { expression: `(async () => (${expr}))()`, returnByValue: true, awaitPromise: true }, sid);
        if (r.exceptionDetails) throw new Error(`frame error: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
        return r.result.value;
      };
      let sid = null;
      for (let i = 0; i < 150 && !sid; i += 1) {
        for (const s of attached) if (await frameEval(s, 'window.__ready === true').catch(() => false)) sid = s;
        if (!sid) await sleep(100);
      }
      if (!sid) {
        // In the page's process: the frame's own context.
        const ctxs = cdp.events.filter((e) => e.method === 'Runtime.executionContextCreated' && e.sessionId === tab.sid).map((e) => e.params.context.id);
        for (const id of ctxs) {
          const r = await send('Runtime.evaluate', { expression: 'window.__ready === true', contextId: id, returnByValue: true }).catch(() => null);
          if (r && r.result && r.result.value === true) { sid = { context: id }; break; }
        }
      }
      if (!sid) { ok(false, `${label}: the uploaded module's frame did not start`); return; }
      const fev = typeof sid === 'string' ? (expr) => frameEval(sid, expr) : async (expr) => { const r = await send('Runtime.evaluate', { expression: `(async () => (${expr}))()`, contextId: sid.context, returnByValue: true, awaitPromise: true }); return r.result.value; };
      if (typeof sid === 'string') await cdp.send('Runtime.enable', {}, sid).catch(() => {});
      // Waits (up to 4s) for something in the frame to be true: the toolbar's press reaches the module by a message.
      const until = async (expr) => { for (let i = 0; i < 40; i += 1) { if (await fev(expr).catch(() => false)) return true; await sleep(100); } return false; };
      const PICKER = 'Boolean(document.querySelector(".sdk-cp"))';
      const NO_PICKER = '!document.querySelector(".sdk-cp")';
      ok(await fev(`(() => { try { return window.origin === 'null' && window.parent !== window; } catch (e) { return false; } })()`), `${label}: the module's frame is not sandboxed (its origin is not opaque)`);
      // The frame's place in the page, and the toolbar button.
      const frameBox = await tab.eval(`(() => { const f = [...document.querySelectorAll('iframe')].find((x) => x.getClientRects().length && x.getBoundingClientRect().width > 100); const r = f.getBoundingClientRect(); return { l: r.left + f.clientLeft, t: r.top + f.clientTop, w: f.clientWidth, h: f.clientHeight }; })()`);
      let btn = null;
      for (let i = 0; i < 50 && !btn; i += 1) {
        btn = await tab.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getClientRects().length && ((x.getAttribute('aria-label') || '').trim() === 'Colour' || x.textContent.trim() === 'Colour')); if (!b) return null; b.setAttribute('data-cp-check', '1'); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, l: r.left, r: r.right }; })()`);
        if (!btn) await sleep(100);
      }
      if (!btn) { ok(false, `${label}: the module's toolbar button "Colour" is not on the page`); return; }
      await press(send, coarse, btn.x, btn.y);
      await until(PICKER);
      const pos = await fev(`(() => { const p = document.querySelector('.sdk-cp'); if (!p) return null; const r = p.getBoundingClientRect(); const a = document.activeElement; return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight, x: window.__tbx, focus: a && a.getAttribute('aria-label') }; })()`);
      ok(Boolean(pos), `${label}: the toolbar button opened no picker in the module's frame`);
      if (pos) {
        ok(pos.l >= 3.5 && pos.t >= 3.5 && pos.r <= pos.vw + 0.5 && pos.b <= pos.vh + 0.5, `${label}: from the toolbar the picker (${Math.round(pos.l)},${Math.round(pos.t)} to ${Math.round(pos.r)},${Math.round(pos.b)}) is not inside the frame (${pos.vw}x${pos.vh})`);
        ok(Math.abs(pos.t - 4) <= 1, `${label}: from the toolbar the picker's top is ${Math.round(pos.t)}px into the frame; wanted 4`);
        const wantL = Number.isFinite(pos.x) ? Math.max(4, Math.min(pos.x, pos.vw - pos.w - 4)) : pos.vw - pos.w - 4;
        ok(Math.abs(pos.l - wantL) <= 1, `${label}: from the toolbar the picker is at x ${Math.round(pos.l)}; wanted ${Math.round(wantL)} (the button's x ${pos.x}, clamped)`);
        ok(Number.isFinite(pos.x), `${label}: the toolbar event gave no x`);
        same(pos.focus, 'Red', `${label}: in the frame focus starts on the chosen swatch`);
        // Escape: null, and focus goes back to the toolbar button through the host.
        await key(send, 'Escape');
        await until('window.__answers.length === 1');
        await sleep(150);
        same(await fev('[window.__answers.at(-1), Boolean(document.querySelector(".sdk-cp"))]'), [null, false], `${label}: Escape in the frame answers null and closes`);
        answers.push(null);
        same(await tab.eval(`document.activeElement && document.activeElement.getAttribute('data-cp-check')`), '1', `${label}: after Escape in the frame, focus is not back on the toolbar button`);
        // The same toolbar button twice: the second press closes it.
        await press(send, coarse, btn.x, btn.y);
        ok(await until(PICKER), `${label}: the toolbar button did not open the picker again`);
        await press(send, coarse, btn.x, btn.y);
        await until('window.__answers.length === 3');
        same(await fev('[Boolean(document.querySelector(".sdk-cp")), window.__answers.slice(-2)]'), [false, [null, null]], `${label}: the toolbar button pressed again closes the picker (both answers null)`);
      }
      // A colour field in the module's form.
      const tr = await fev(`(() => { const t = document.querySelector('.sdk-picker'); const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, name: t.getAttribute('aria-label') }; })()`);
      same(tr.name, 'Fill, Blue, #2f6cbf. Change it', `${label}: in the frame the field's trigger is named by its <label>`);
      await press(send, coarse, frameBox.l + tr.x, frameBox.t + tr.y);
      await until(PICKER);
      const sw = await fev(`(() => { const b = document.querySelector('.sdk-cp .sdk-swatch[aria-label="Gold"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      ok(Boolean(sw), `${label}: the field's trigger opened no picker in the frame`);
      if (sw) {
        await press(send, coarse, frameBox.l + sw.x, frameBox.t + sw.y);
        await until(NO_PICKER);
        await until('window.__events.length === 3');
        same(await fev(`[document.getElementById('fld').value, window.__events]`), ['#8a6a00', ['input', 'change', { color: '#8a6a00', opacity: 100 }]], `${label}: in the frame a choice sets the field's input, sends input then change, and onChange`);
        answers.push({ color: '#8a6a00', opacity: 100 });
      }
      answers.push(...(await fev('window.__answers')));
    } finally {
      cdp.listeners = cdp.listeners.filter((f) => f !== hook);
    }
  }
}

