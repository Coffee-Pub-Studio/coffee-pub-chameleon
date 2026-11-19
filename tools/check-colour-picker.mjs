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
 *   2. Chromium: added with step 2 of the plan (the picker itself).
 * Usage: node tools/check-colour-picker.mjs. Exits 0 when every check passes, 1 with a line per failure.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

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
// The browser half (the popover, its placing, keys, phone sizes, colorField) is added here with step 2 of the plan.

finish();
