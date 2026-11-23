#!/usr/bin/env node
/*
 * check-colour-picker.mjs -- the colour picker's pure parts and its contrast helper (documentation/plans/plan-colour-picker.md,
 * "The default palette (proposed)", "The contract", "The contrast helper"; GitHub #933).
 *
 *   1. Node only: the pure parts, sliced out of public/sdk/host.js between its "colour:start" and "colour:end" markers.
 *      colourClean: a hex in any case, with or without "#", with spaces round it, becomes "#rrggbb" in lower case; anything else
 *      (short, long, a word, url(), three digits, empty, null, a number) is null. colourToHsv and colourFromHsv: every palette
 *      colour, black, white and a grid of colours go to hue, saturation and brightness (in range) and back to the same hex; a bad
 *      hex throws. COLOUR_GRID_START: exactly the plan's 24 starting colours ("The starting grid (proposed)": names, colours, all at
 *      opacity 100, in that order), unique, frozen all the way down, and already in the grid's order. The grid's pure parts (step 7):
 *      colourGridClean takes a good list (a copy) and refuses each bad one (49 entries, upper case, three digits, a string, 1.5, 101 or
 *      -1 opacity, an extra or a missing key, a duplicate, a hole); colourGridOrder sorts a set of added colours by the plan's rule
 *      (neutrals light to dark, then hue bands of 30 degrees from red, lighter first, ties as stored); colourGridName and
 *      colourGridLabel name a starting colour, and a colour a person added by its hex ("#hex, N percent" below 100); colourGridAdd
 *      answers added, there (the same colour and opacity) or full (48); colourGridRemove. newRowColours (public/colour-field.js) on the
 *      starting colours: the 13 that are neither neutral nor light, from Red. colourPaletteCheck: takes a small module palette
 *      (answering a cleaned copy) and refuses each bad shape with its one sentence. colourOpacity and colourAnswer: the edges.
 *      colourPaletteCheck also: holes (new Array(1), new Array(6), [g, , g], colours [ , ] and new Array(3)) are refused, and an
 *      own `map` on the palette or on a colours list is never what is answered (the checked copy, or the refusal); headings and
 *      names of only zero-width characters, or holding a direction mark, soft hyphen, override or isolate, U+2028 or U+2029, a
 *      delete or U+0085 control, a lone surrogate, or no letter or digit at all, are refused, while "Black & white", Rot "dunkel",
 *      Café and Ébène 2 are kept. colourContrast and colourReadableOn are strict (no "2f6cbf", "#2F6CBF", spaces or "#fff").
 *      colourFromHsv always answers #rrggbb (empty, NaN, Infinity, null) and wraps hue (-60, 360, 720) and clamps saturation and
 *      brightness.
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
 *      390) sends onInput and a press outside answers once; opacity: false draws no Opacity slider (not in the DOM, the accessibility
 *      tree or the Tab order: the area, Hue, Hex, Pick from the screen, the palette) and answers 100; a module palette in place of the default; Recent, newest first, named by colour name
 *      or hex (from a stand-in for the page's side); colorField (the trigger's name, input then change then onChange, Escape sends nothing, the toggle, set(), disabled,
 *      destroy) and the page's own hostColour.field; 44px targets and 16px hex text at 390; Hex, the typed hex, a heading
 *      and the error line at 4.5:1 on the picker; the stronger edge exactly on the swatches under 3:1 against the menu's surface
 *      (White in light, Black in dark); the accessibility tree names the dialog, the area, the sliders, Hex, the radio groups and each
 *      radio (aria-valuetext is read from the element: this Chromium's DevTools tree leaves it empty even on a plain slider). In an
 *      uploaded module in its sandboxed frame (built here at run time): its toolbar button opens the picker at { x, y: 4 } inside the
 *      frame, Escape answers null and focus goes back to the toolbar button, the button pressed again closes it, and a colorField in
 *      its form sets the input. The popover's background in a frame is not asserted (a separate fix in public/module-host.js).
 *      Every answer seen is { color: #rrggbb, opacity: a whole number from 0 to 100 }. CHROME_PATH names the browser.
 *   3. Chromium, the person's grid (step 7), at 1280 light once the rest has run, through the real route on this check's own server:
 *      the grid has no heading and is the 24 starting colours before any edit; in the module running in the page "+" adds the colour
 *      showing at 60 percent (named "#hex, 60 percent", drawn over the checked ground), a second "+" adds nothing and says so, a
 *      right-click on a swatch opens the Remove menu and Remove takes it out, Delete on a focused swatch takes another, none of these
 *      answers or closes the picker, and each is on the server (GET /api/me/color-grid); after a reload the same grid shows, and a drag
 *      of the colour showing onto the grid adds it (Input.setInterceptDrags, a real drag); a module's own palette there has no "+", no
 *      drag and no Remove; an uploaded module in its sandboxed frame (decision 28) shows the same grid read-only (no "+", no drag, no
 *      Remove, Delete and a drop change nothing), and the module's own code sending ui.colorGrid and ui.colorRecent itself is answered
 *      editable: false while ui.colorGrid.set and ui.colorRecent.set are refused, the server's lists unchanged; the page's own picker
 *      (hostColour) shows the same grid; a save the page refuses puts the grid back and shows the sentence under it; at 48 there is no "+".
 *   4. Chromium, Recent (decision 27), after the grid, through the real route (GET/PUT /api/me/color-recent): not shown while empty; two
 *      choices in the module in the page are on the server newest first with their opacity; a Recent colour chosen again moves to the
 *      front once; a reload keeps it; with 8 kept a new choice keeps the newest 8; the sandboxed frame shows the same list read-only (no
 *      "+", no Remove) and a choice there answers normally, shows no error and leaves Recent unchanged; the page's own picker
 *      (hostColour) shows the same list; a guest (403) and no session (401) see no Recent and send none. In the module running in the
 *      page (case 2) the page's side is a stand-in that keeps the list in the page: each list sent is whole, newest first, at most 8,
 *      no pair twice, and a list that is not clean is not drawn. The Node part checks colourRecentClean and colourRecentAdd.
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
  process.exit(0); // the DevTools helper's request timers would otherwise hold the process for 30s
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
const NAMES = 'COLOUR_HEX, colourClean, colourToHsv, colourFromHsv, COLOUR_GRID_MAX, COLOUR_GRID_START, colourGridClean, colourGridOrder, colourGridName, colourGridLabel, colourGridFind, colourGridAdd, colourGridRemove, COLOUR_RECENT_MAX, colourRecentClean, colourRecentAdd, colourPaletteCheck, colourOpacity, colourAnswer, colourContrast, colourReadableOn';
let P;
try {
  P = new Function(`${block}\n; return { ${NAMES} };`)();
} catch (e) {
  problems.push(`the colour block does not evaluate on its own: ${e && e.message}`);
  finish();
}
for (const k of NAMES.split(', ')) ok(P[k] !== undefined, `the colour block defines ${k}`);
if (problems.length) finish();

// The plan's 24 starting colours ("The starting grid (proposed)"), in the grid's order, all at opacity 100.
const START = [
  ['White', '#ffffff'], ['Light grey', '#c0c0c0'], ['Grey', '#808080'], ['Dark grey', '#404040'], ['Black', '#000000'], ['Light red', '#f28b82'],
  ['Red', '#d62828'], ['Dark red', '#8b1a1a'], ['Light brown', '#d2b48c'], ['Orange', '#f28c28'], ['Brown', '#8b5a2b'], ['Yellow', '#ffe135'],
  ['Light green', '#90ee90'], ['Green', '#2e9e3e'], ['Dark green', '#1b5e20'], ['Cyan', '#00bcd4'], ['Teal', '#008080'], ['Light blue', '#87ceeb'],
  ['Blue', '#1e5fd0'], ['Dark blue', '#1a237e'], ['Light purple', '#c3a6e8'], ['Purple', '#7b3fb5'], ['Pink', '#f48fb1'], ['Magenta', '#d81b9c'],
].map(([name, color]) => ({ name, color, opacity: 100 }));
const HEX = Object.fromEntries(START.map((c) => [c.name, c.color]));
const GRID = [];
for (let r = 0; r <= 255; r += 15) for (let g = 0; g <= 255; g += 15) for (let b = 0; b <= 255; b += 15) {
  GRID.push(`#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`);
}
const ALL = [...new Set([...START.map((c) => c.color), '#000000', '#ffffff', ...GRID])];

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

section('the starting grid', () => {
  const D = P.COLOUR_GRID_START;
  same(JSON.parse(JSON.stringify(D)), START, 'the starting grid is the plan\'s 24 colours, names and colours, all at opacity 100, in its order');
  same(P.COLOUR_GRID_MAX, 48, 'the grid holds at most 48');
  same(new Set(D.map((c) => c.name)).size, 24, 'the starting colours\' names are unique');
  same(new Set(D.map((c) => c.color)).size, 24, 'the starting colours are unique');
  ok(Object.isFrozen(D) && D.every((c) => Object.isFrozen(c)), 'the starting grid is frozen all the way down (the list and each colour)');
  same(P.colourGridOrder(D.map((c) => ({ color: c.color, opacity: c.opacity }))).map((c) => c.color), START.map((c) => c.color), 'the starting colours are already in the grid\'s order');
  same(P.colourGridOrder([...D].reverse().map((c) => ({ color: c.color, opacity: 100 }))).map((c) => c.color), START.map((c) => c.color), 'the starting colours in reverse sort back to the plan\'s order');
});

section('the grid: clean, order, names, add and remove', () => {
  const e = (color, opacity = 100) => ({ color, opacity });
  const good = [e('#d62828'), e('#1e5fd0', 60), e('#1e5fd0', 100)];
  const got = P.colourGridClean(good);
  same(got, good, 'colourGridClean takes a good list (the same colour at two opacities too)');
  ok(got !== good && got[0] !== good[0], 'colourGridClean answers a copy');
  same(P.colourGridClean([]), [], 'colourGridClean takes an empty list');
  same((P.colourGridClean(Array.from({ length: 48 }, (_, i) => e(`#0000${i.toString(16).padStart(2, '0')}`))) || []).length, 48, 'colourGridClean takes 48');
  const bad = [
    ['49 entries', Array.from({ length: 49 }, (_, i) => e(`#0000${i.toString(16).padStart(2, '0')}`))],
    ['not a list', { colors: [] }], ['null', null], ['upper case', [e('#D62828')]], ['three digits', [e('#fff')]], ['eight digits', [e('#d62828ff')]],
    ['a name', [e('red')]], ['url(x)', [e('url(x)')]], ['a string opacity', [{ color: '#d62828', opacity: '100' }]], ['opacity 1.5', [e('#d62828', 1.5)]],
    ['opacity 101', [e('#d62828', 101)]], ['opacity -1', [e('#d62828', -1)]], ['an extra key', [{ color: '#d62828', opacity: 100, name: 'Red' }]],
    ['a missing key', [{ color: '#d62828' }]], ['a duplicate', [e('#d62828'), e('#d62828')]], ['a hole', [e('#d62828'), , e('#1e5fd0')]],
    ['a null entry', [null]], ['an array entry', [['#d62828', 100]]],
  ];
  for (const [what, list] of bad) same(P.colourGridClean(list), null, `colourGridClean refuses ${what}`);
  // The order rule on a set of added colours: neutrals light to dark, then by hue band from red, lighter first, ties as stored.
  const added = [e('#1e5fd0', 60), e('#000000'), e('#d62828'), e('#ff3355'), e('#808080', 40), e('#ffffff'), e('#f28b82'), e('#1e5fd0'), e('#2e9e3e'), e('#d81b9c')];
  same(P.colourGridOrder(added).map((c) => `${c.color}/${c.opacity}`), ['#ffffff/100', '#808080/40', '#000000/100', '#f28b82/100', '#ff3355/100', '#d62828/100', '#2e9e3e/100', '#1e5fd0/60', '#1e5fd0/100', '#d81b9c/100'],
    'colourGridOrder: neutrals light to dark, then hue bands from red (a hue of 350 is red), lighter first, a tie as stored');
  same(P.colourGridOrder([e('#1e5fd0'), e('#1e5fd0', 60)]).map((c) => c.opacity), [100, 60], 'colourGridOrder keeps a tie as stored');
  ok(P.colourGridOrder(added) !== added && added[0].color === '#1e5fd0', 'colourGridOrder answers a copy and leaves the list alone');
  same([P.colourGridName(e('#d62828')), P.colourGridName(e('#d62828', 60)), P.colourGridName(e('#123456'))], ['Red', '', ''], 'colourGridName names a starting colour at 100 only');
  same([P.colourGridLabel(e('#d62828')), P.colourGridLabel(e('#d62828', 60)), P.colourGridLabel(e('#123456')), P.colourGridLabel(e('#123456', 0))], ['Red', '#d62828, 60 percent', '#123456', '#123456, 0 percent'], 'colourGridLabel: the name, else the hex, with the percent below 100');
  const one = [e('#d62828')];
  same(P.colourGridAdd(one, e('#1e5fd0', 60)), { list: [e('#d62828'), e('#1e5fd0', 60)], how: 'added' }, 'colourGridAdd adds a new colour with its opacity');
  same(P.colourGridAdd(one, e('#d62828', 60)).how, 'added', 'colourGridAdd adds the same colour at another opacity');
  const there = P.colourGridAdd(one, e('#d62828'));
  ok(there.how === 'there' && there.list === one, 'colourGridAdd does not add the same colour and opacity again');
  const full = Array.from({ length: 48 }, (_, i) => e(`#0000${i.toString(16).padStart(2, '0')}`));
  const f = P.colourGridAdd(full, e('#d62828'));
  ok(f.how === 'full' && f.list === full, 'colourGridAdd adds nothing at 48');
  same(P.colourGridRemove([e('#d62828'), e('#1e5fd0', 60)], e('#1e5fd0', 60)), [e('#d62828')], 'colourGridRemove takes a colour out');
  ok(P.colourGridRemove(one, e('#1e5fd0')) === one, 'colourGridRemove leaves a list without the colour as it is');
  same(P.colourGridFind([e('#d62828'), e('#d62828', 60)], e('#d62828', 60)), 1, 'colourGridFind finds a colour at its opacity');
});

section('Recent: clean and add', () => {
  const e = (color, opacity = 100) => ({ color, opacity });
  same(P.COLOUR_RECENT_MAX, 8, 'Recent holds at most 8');
  const eight = Array.from({ length: 8 }, (_, i) => e(`#0000${i.toString(16).padStart(2, '0')}`));
  same(P.colourRecentClean(eight), eight, 'colourRecentClean takes 8');
  for (const [what, list] of [['9 entries', [...eight, e('#ffffff')]], ['upper case', [e('#D62828')]], ['a duplicate', [e('#d62828'), e('#d62828')]], ['a bare hex', ['#d62828']], ['a string opacity', [{ color: '#d62828', opacity: '60' }]], ['null', null]]) {
    same(P.colourRecentClean(list), null, `colourRecentClean refuses ${what}`);
  }
  same(P.colourRecentAdd(null, e('#d62828')), [e('#d62828')], 'colourRecentAdd starts a list where there is none');
  const two = [e('#1e5fd0', 60), e('#d62828')];
  same(P.colourRecentAdd(two, e('#008080')), [e('#008080'), e('#1e5fd0', 60), e('#d62828')], 'colourRecentAdd puts a choice at the front');
  same(P.colourRecentAdd(two, e('#d62828')), [e('#d62828'), e('#1e5fd0', 60)], 'colourRecentAdd moves a colour chosen again to the front, once');
  same(P.colourRecentAdd(two, e('#1e5fd0')), [e('#1e5fd0'), e('#1e5fd0', 60), e('#d62828')], 'colourRecentAdd keeps the same colour at another opacity');
  same(P.colourRecentAdd(eight, e('#ffffff')), [e('#ffffff'), ...eight.slice(0, 7)], 'colourRecentAdd keeps the newest 8, the oldest dropped');
  same(P.colourRecentAdd(eight, eight[7]), [eight[7], ...eight.slice(0, 7)], 'colourRecentAdd at 8 with a colour already there keeps all 8');
  ok(two.length === 2 && two[0].color === '#1e5fd0', 'colourRecentAdd leaves the list it was given alone');
});

section('new list rows take the starting colours from Red, not the neutral or light ones', () => {
  const src = read('public/colour-field.js');
  const at = src.indexOf('export function newRowColours()');
  ok(at > 0, 'public/colour-field.js has newRowColours');
  const fn = new Function('window', `${src.slice(at).replace('export ', '')}\n; return newRowColours;`)({ hostColour: { palette: P.COLOUR_GRID_START } });
  same(fn(), ['Red', 'Dark red', 'Orange', 'Brown', 'Yellow', 'Green', 'Dark green', 'Cyan', 'Teal', 'Blue', 'Dark blue', 'Purple', 'Magenta'].map((n) => HEX[n]), 'newRowColours: Red, Dark red, Orange, Brown, Yellow, Green, Dark green, Cyan, Teal, Blue, Dark blue, Purple, Magenta');
  same(new Function('window', `${src.slice(at).replace('export ', '')}\n; return newRowColours;`)({})(), [], 'newRowColours with no SDK on the page is empty');
});

section('the palette check', () => {
  // --- the palette check ---
  const SENTENCE = 'host.ui.colorPicker: a palette colour needs a name and a #rrggbb colour';
  let got;
  const asGroups = [{ heading: 'Start', colours: START.slice(0, 8).map(({ name, color }) => ({ name, color })) }, { heading: 'More', colours: START.slice(8).map(({ name, color }) => ({ name, color })) }];
  try { got = P.colourPaletteCheck(asGroups); } catch (e) { got = `threw ${e && e.message}`; }
  same(JSON.parse(JSON.stringify(got)), asGroups, 'colourPaletteCheck takes two named groups of the starting colours as they are');
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

section('the block reaches nothing outside itself', () => {
  // --- the block reaches nothing outside itself: run it again in an empty context (no window, document, require, process, console) ---
  let out;
  try {
    out = vm.runInNewContext(`(function () {\n      const P = (function () {\n${block}\n; return { ${NAMES} }; })();
      const pal = P.colourGridOrder(P.colourGridClean(P.COLOUR_GRID_START.map((c) => ({ color: c.color, opacity: c.opacity }))));
      const hex = P.colourFromHsv(P.colourToHsv(P.colourClean(' #2F6CBF ')));
      const a = P.colourAnswer(hex, 49.5, true);
      return JSON.stringify([pal.length, hex, a, P.colourOpacity('x'), P.colourContrast(hex, '#ffffff'), P.colourReadableOn(hex)]);
    })()`, Object.create(null), { timeout: 5000 });
  } catch (e) { out = `threw ${e && e.message}`; }
  same(out, JSON.stringify([24, '#2f6cbf', { color: '#2f6cbf', opacity: 50 }, 100, TC.contrast('#2f6cbf', '#ffffff'), P.colourReadableOn('#2f6cbf')]),
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

section('the Design System keeps the same starting colours and icons as host.js', () => {
  // components.js carries a copy of COLOUR_GRID_START (as CP_GRID) and of the three icons (CP_CHECK, CP_DROPPER, CP_PLUS) so the
  // specimens draw without the SDK. Only the literals are read: each is cut out of its file and evaluated alone, never the whole file.
  const ds = read('public/design-system/components.js');
  const cut = (src, start, end, what) => {
    const a = src.indexOf(start);
    const b = a < 0 ? -1 : src.indexOf(end, a + start.length);
    if (a < 0 || b < 0) { ok(false, `could not find ${what} to compare`); return null; }
    return src.slice(a + start.length, b);
  };
  const arr = (text) => (text === null ? null : new Function(`return [${text}]`)());
  const hostPal = arr(cut(sdk, 'const COLOUR_GRID_START = Object.freeze([', '\n  ].map(', 'COLOUR_GRID_START in public/sdk/host.js'));
  const dsPal = arr(cut(ds, 'const CP_GRID = [', '\n  ];', 'CP_GRID in public/design-system/components.js'));
  if (hostPal && dsPal) {
    ok(hostPal.length === 24, `COLOUR_GRID_START in host.js reads as ${hostPal.length} colours; wanted 24`);
    same(dsPal, hostPal, 'CP_GRID in public/design-system/components.js holds the same names and colours, in the same order, as COLOUR_GRID_START in public/sdk/host.js');
  }
  ok(!/CP_PALETTE|'Light', \[|'Strong', \[/.test(ds), 'components.js has no copy of the old three groups (Light, Dark, Strong)');
  const icon = (src, re, what) => { const m = src.match(re); if (!m) { ok(false, `could not find ${what} to compare`); return null; } return m[1]; };
  for (const [key, cp] of [['check', 'CP_CHECK'], ['dropper', 'CP_DROPPER'], ['plus', 'CP_PLUS']]) {
    const a = icon(sdk, new RegExp(`\\n\\s+${key}: '([^'\\n]+)',?\\n`), `COLOUR_ICONS.${key} in host.js`);
    const b = icon(ds, new RegExp(`const ${cp} = '([^'\\n]+)';`), `${cp} in components.js`);
    ok(Boolean(a) && a === b, `${cp} in components.js is not the same string as COLOUR_ICONS.${key} in host.js`);
  }
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
  const NAMES_ALL = START.map((c) => c.name);
  const HINT = 'Type six hex digits, like #2f6cbf';
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
    // Two uploaded test modules, the same but for where they run: cpcheck in its sandboxed frame, cppage in the page (runMode
    // 'page', which the admin of a single-environment install may choose). Each has a toolbar button that opens the picker at
    // { x, y: 4 }, and a colour field in a form.
    const upload = async (id, runMode) => {
      const modDir = path.join(dataDir, `${id}-src`);
      fs.mkdirSync(path.join(modDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(modDir, 'module.json'), JSON.stringify({ id, name: `Colour check ${id}`, version: '0.0.1', icon: 'palette', scope: ['environment'], surfaces: { page: { entry: `${id}.html` } } }));
      fs.writeFileSync(path.join(modDir, 'src', `${id}.html`), '<!doctype html><html><head><meta charset="utf-8"><style>/*__CSS__*/</style></head><body><form id="form"><label for="fld">Fill</label> <input id="fld" type="text" value="#1e5fd0"></form><script>/*__JS__*/</script></body></html>');
      fs.writeFileSync(path.join(modDir, 'src', `${id}.css`), 'form { padding: 80px 16px; }');
      fs.writeFileSync(path.join(modDir, 'src', `${id}.js`), `const host = (document.currentScript && document.currentScript.host) || window.host; window.__answers = []; window.__events = [];
host.ready().then(() => {
  const fld = host.root.getElementById('fld');
  fld.addEventListener('input', () => window.__events.push('input'));
  fld.addEventListener('change', () => window.__events.push('change'));
  window.__field = host.ui.colorField(fld, { onChange: (a) => window.__events.push(a) });
  window.__clicks = 0;
  host.ui.toolbarButton({ id: 'colour', label: 'Colour', icon: 'palette', onClick: (e) => {
    window.__clicks += 1;
    window.__tbx = e.x;
    host.ui.colorPicker({ at: { x: Number.isFinite(e.x) ? e.x : 100000, y: 4 }, value: '#d62828' }).then((a) => window.__answers.push(a));
  } });
  host.ui.toolbarButton({ id: 'shade', label: 'Shade', icon: 'palette', onClick: (e) => {
    window.__clicks2 = (window.__clicks2 || 0) + 1;
    host.ui.colorPicker({ at: { x: Number.isFinite(e.x) ? e.x : 100000, y: 4 }, value: '#008080', label: 'Shade' }).then((a) => window.__answers.push(a));
  } });
  window.__host = host;
  window.__ready = true;
});`);
      const up = await fetch(`${server.base}/api/modules`, { method: 'POST', headers: { 'content-type': 'application/zip', cookie: jar }, body: buildModule(modDir).zip });
      ok(up.status === 201, `the test module ${id} was not uploaded: ${up.status} ${(await up.text()).slice(0, 200)}`);
      const en = await fetch(`${server.base}/api/modules/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: jar }, body: JSON.stringify({ enabled: true, ...(runMode ? { runMode, acceptRisk: true } : {}) }) });
      ok(en.status === 200, `the test module ${id} could not be turned on${runMode ? ` to run in the ${runMode}` : ''}: ${en.status} ${(await en.text()).slice(0, 200)}`);
    };
    await upload('cpcheck');
    await upload('cppage', 'page');
    // A third uploaded module for the scrolled-frame case: sandboxed, with a tall document and a button far down it, and `tags` on so
    // host.tags.picker may open.
    {
      const id = 'cpscroll';
      const modDir = path.join(dataDir, `${id}-src`);
      fs.mkdirSync(path.join(modDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(modDir, 'module.json'), JSON.stringify({ id, name: 'Colour check scrolled', version: '0.0.1', icon: 'palette', scope: ['environment'], tags: true, surfaces: { page: { entry: `${id}.html` } } }));
      fs.writeFileSync(path.join(modDir, 'src', `${id}.html`), '<!doctype html><html><head><meta charset="utf-8"><style>/*__CSS__*/</style></head><body><div id="tall"><button id="sb" type="button">Far down</button></div><script>/*__JS__*/</script></body></html>');
      fs.writeFileSync(path.join(modDir, 'src', `${id}.css`), 'body { margin: 0; } #tall { position: relative; height: 3200px; } #sb { position: absolute; left: 40px; top: 1300px; }');
      fs.writeFileSync(path.join(modDir, 'src', `${id}.js`), `const host = (document.currentScript && document.currentScript.host) || window.host;
host.ready().then(() => { window.__host = host; window.__ready = true; });`);
      const up = await fetch(`${server.base}/api/modules`, { method: 'POST', headers: { 'content-type': 'application/zip', cookie: jar }, body: buildModule(modDir).zip });
      ok(up.status === 201, `the test module ${id} was not uploaded: ${up.status} ${(await up.text()).slice(0, 200)}`);
      const en = await fetch(`${server.base}/api/modules/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: jar }, body: JSON.stringify({ enabled: true }) });
      ok(en.status === 200, `the test module ${id} could not be turned on: ${en.status} ${(await en.text()).slice(0, 200)}`);
    }
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
        await inPageToolbar({ tab, send, label, coarse });
        if (size === 1280 && mode === 'light') await scrolledFrame({ tab, send, label });
      } catch (e) {
        n += 1;
        problems.push(`${label}: stopped: ${e && (e.stack || e.message)}`);
      }
      await tab.close();
    }
    // The phone widths (360, 375, 390): no sideways scroll, and at 375 the targets; at 360 a browser with no eyedropper.
    for (const width of [360, 375, 390]) {
      const tab = new Tab(cdp, {});
      await tab.open(width, 'light', false);
      const send = (m, p) => cdp.send(m, p, tab.sid);
      await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      if (width === 360) await send('Page.addScriptToEvaluateOnNewDocument', { source: 'delete window.EyeDropper;' });
      for (const c of cookies) await send('Network.setCookie', { ...c, url: server.base });
      try {
        await phoneCases({ tab, send, width });
      } catch (e) {
        n += 1;
        problems.push(`${width}px phone: stopped: ${e && (e.stack || e.message)}`);
      }
      await tab.close();
    }

    // The person's grid (step 7), once the rest has run (it edits the admin's grid on this server, which the cases above read).
    {
      const tab = new Tab(cdp, {});
      await tab.open(1280, 'light', false);
      const send = (m, p) => cdp.send(m, p, tab.sid);
      for (const c of cookies) await send('Network.setCookie', { ...c, url: server.base });
      try {
        await gridCases({ tab, send, jar });
      } catch (e) {
        n += 1;
        problems.push(`the grid: stopped: ${e && (e.stack || e.message)}`);
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
    const codes = { Escape: 27, Enter: 13, Tab: 9, ' ': 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, PageUp: 33, PageDown: 34, Delete: 46, Backspace: 8, F10: 121 };
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
        + '<label id="fl">Row <input id="fld" type="text" value="#d62828" aria-label="Row colour"></label>';
      // The page's side of Recent (ui.colorRecent, ui.colorRecent.set) as module-host.js answers it, kept here in window.__recent so
      // these cases start empty each time; the real route is checked in recentCases below.
      window.__recent = null;
      window.__recentSent = [];
      const pageCall = (m, p) => (m === 'hello' ? Promise.resolve({ module: { id: 'cpcheck' } })
        : m === 'ui.colorRecent' ? Promise.resolve({ colors: window.__recent && JSON.parse(JSON.stringify(window.__recent)), editable: true })
        : m === 'ui.colorRecent.set' ? (window.__recentSent.push(p.colors), window.__recent = p.colors, Promise.resolve(p.colors))
        : Promise.reject(new Error('not here')));
      const h = createHost({ call: pageCall, root: R, rootElement: c, elementAt: (p) => document.elementFromPoint(p.x, p.y), applyTheme: () => {} }).host;
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
    await pick(`{ anchor: 'a', value: '#1e5fd0', opacity: 80 }`);
    same(await ev('window.__focus()'), 'Blue', `${label}: focus starts on the chosen swatch`);
    // The person's grid: one group, no heading, the 24 starting colours (this module's page answers no grid: not editable, no "+").
    same(await ev(`[window.__cp().querySelectorAll('[aria-label="Colours"] .sdk-cp-head').length, [...window.__cp().querySelectorAll('[aria-label="Colours"] .sdk-swatch')].map((b) => b.getAttribute('aria-label'))]`), [0, NAMES_ALL], `${label}: the grid has no heading and is the 24 starting colours in order`);
    same(await ev(`[Boolean(window.__in('.sdk-cp-add')), window.__in('.sdk-cp-current').draggable]`), [false, false], `${label}: where the grid can't be edited there is no "+" and the colour showing can't be dragged`);
    await pressOn(swatch('Teal'));
    const teal = await last();
    answers.push(teal);
    same(teal, { color: '#008080', opacity: 100 }, `${label}: a grid swatch answers its colour and its own opacity`);
    ok(!(await open()), `${label}: a swatch did not close the picker`);
    same(await ev('window.__answers.length'), 6, `${label}: the answers so far (5 Escapes and the swatch) each came once`);
    // Enter on a swatch answers too.
    await pick(`{ anchor: 'a', value: '#008080' }`);
    await key(send, 'ArrowRight');
    same(await ev('window.__focus()'), 'Light blue', `${label}: Right moves from Teal to Light blue in the grid`);
    await key(send, 'Enter');
    const blue = await last();
    answers.push(blue);
    same(blue, { color: '#87ceeb', opacity: 100 }, `${label}: Enter on a swatch answers its colour`);
    same(await ev('window.__focus()'), '#a', `${label}: after a swatch, focus is back on the anchor`);

    // --- the keyboard, the names and the words ---
    await pick(`{ anchor: 'a', value: '#87CEEB', opacity: 50, label: 'Fill colour' }`);
    same(await ev('window.__focus()'), 'Light blue', `${label}: a value in capitals starts on its swatch`);
    same(await ev(`window.__cp().getAttribute('aria-label')`), 'Fill colour', `${label}: the dialog is named by its label`);
    const recentNames = await ev(`[...window.__cp().querySelectorAll('[aria-label="Recent"] .sdk-swatch')].map((b) => b.getAttribute('aria-label'))`);
    same(recentNames, ['Light blue', 'Teal'], `${label}: Recent holds the colours chosen, newest first, named by their colour names`);
    const dropper = await ev(`!window.__in('.sdk-cp-dropper').hidden`);
    const order = ['Saturation and brightness', 'Hue', 'Opacity', 'sdk-cp-hexin', ...(dropper ? ['Pick from the screen'] : []), 'Light blue', 'Light blue'];
    const seen = [];
    await key(send, 'Tab'); // from the palette to Recent
    seen.push(await ev(`window.__focus() + '@' + (((__R.activeElement || document.activeElement).closest('[role=radiogroup]') || { getAttribute: () => '' }).getAttribute('aria-label'))`));
    for (let i = 0; i < order.length - 1; i += 1) { await key(send, 'Tab'); seen.push(await ev('window.__focus()')); }
    same(seen, ['Light blue@Recent', ...order.slice(0, -1)], `${label}: Tab goes from the palette to Recent, then round to the area, Hue, Opacity, Hex${dropper ? ', Pick from the screen' : ''} and the palette`);
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
    const blueSel = swatch('Light blue');
    await ev(`${blueSel}.focus()`);
    for (const [k, want] of [['ArrowRight', 'Blue'], ['ArrowLeft', 'Light blue'], ['Home', 'White'], ['ArrowDown', 'Light brown'], ['ArrowDown', 'Teal'], ['ArrowUp', 'Light brown'], ['End', 'Magenta']]) {
      await key(send, k);
      same(await ev('window.__focus()'), want, `${label}: ${k} in the palette`);
    }
    // Recent: its own Tab stop, arrows inside.
    await key(send, 'Tab');
    same(await ev('window.__focus()'), 'Light blue', `${label}: Tab from the palette goes to Recent`);
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
    for (const [what, expr] of [['the word Hex', `window.__in('.sdk-cp-hex-word')`], ['the hex in its field', `window.__in('.sdk-cp-hexin')`], ['the Recent heading', `window.__in('.sdk-cp-head')`]]) {
      const v = await ratio(expr);
      ok(v >= 4.5, `${label}: ${what} is ${v.toFixed(2)}:1 on the picker; wanted 4.5:1`);
    }
    // White on a light menu and Black on a dark one get the stronger edge; the opposite end does not. The faint ones are exactly the
    // swatches under 3:1 against the menu's own surface, worked out here from the drawn surface with theme-colour.js's maths.
    const faint = await ev(`[...window.__cp().querySelectorAll('[aria-label="Colours"] .sdk-cp-faint')].map((b) => b.getAttribute('aria-label'))`);
    const surface = await ev(`(() => { const cv = document.createElement('canvas'); cv.width = cv.height = 1; const g = cv.getContext('2d', { willReadFrequently: true }); g.fillStyle = getComputedStyle(window.__cp()).backgroundColor; g.fillRect(0, 0, 1, 1); return '#' + [...g.getImageData(0, 0, 1, 1).data].slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join(''); })()`);
    const under3 = START.filter((c) => TC.contrast(c.color, surface) < 3).map((c) => c.name);
    const wantFaint = mode === 'light' ? 'White' : 'Black';
    const notFaint = mode === 'light' ? 'Black' : 'White';
    ok(faint.includes(wantFaint) && !faint.includes(notFaint), `${label}: the swatches with the stronger edge are ${JSON.stringify(faint)}; wanted ${wantFaint} among them and not ${notFaint}`);
    same(faint, under3, `${label}: the swatches with the stronger edge are those under 3:1 against the menu's surface (${surface})`);
    const edges = await ev(`[${swatch(wantFaint)}, ${swatch(notFaint)}].map((b) => getComputedStyle(b, '::before').borderTopColor)`);
    ok(edges[0] !== edges[1], `${label}: ${wantFaint}'s stronger edge is drawn the same as ${notFaint}'s (${edges[0]})`);
    if (faint.length > 6) note.push(`${label}: ${faint.length} of 24 swatches take the stronger edge on a ${surface} menu (${faint.join(', ')})`);

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
    await pick(`{ at: { x: 20, y: 60 }, value: '#d62828', opacity: false, label: 'Row colour' }`);
    const off = await ev(`(() => { const p = window.__cp(); return [Boolean(window.__in('.sdk-cp-alpha')), [...p.querySelectorAll('[role=slider]')].map((x) => x.getAttribute('aria-label')), /opacity/i.test(p.textContent), p.classList.contains('sdk-cp-solid')]; })()`);
    same(off, [false, ['Saturation and brightness', 'Hue'], false, true], `${label}: with opacity: false there is no Opacity slider and no line about it; the sliders are the area and Hue`);
    // The Tab order skips it: the area, Hue, Hex, Pick from the screen when shown, the palette; Shift+Tab from Hue goes to the area.
    const offDropper = await ev(`!window.__in('.sdk-cp-dropper').hidden`);
    const offOrder = ['Hue', 'sdk-cp-hexin', ...(offDropper ? ['Pick from the screen'] : []), 'Red'];
    await ev(`window.__in('.sdk-cp-area').focus()`);
    const offSeen = [];
    for (let i = 0; i < offOrder.length; i += 1) { await key(send, 'Tab'); offSeen.push(await ev('window.__focus()')); }
    same(offSeen, offOrder, `${label}: with opacity: false Tab goes from the area to Hue, Hex${offDropper ? ', Pick from the screen' : ''} and the palette, with no Opacity`);
    await ev(`window.__in('.sdk-cp-hue').focus()`);
    await key(send, 'Tab', { shift: true });
    same(await ev('window.__focus()'), 'Saturation and brightness', `${label}: with opacity: false Shift+Tab from Hue goes back to the area`);
    await ev(`window.__in('.sdk-cp-hue').focus()`);
    await key(send, 'ArrowRight');
    ok((await ev('window.__inputs')).every((a) => a.opacity === 100), `${label}: with opacity: false every onInput has opacity 100`);
    const ax2 = (await send('Accessibility.getFullAXTree', {})).nodes.filter((x) => !x.ignored);
    ok(!ax2.some((x) => x.name && /opacity/i.test(String(x.name.value || ''))), `${label}: with opacity: false the accessibility tree has nothing named Opacity`);
    ok(ax2.some((x) => x.role && x.role.value === 'dialog' && x.name && x.name.value === 'Row colour'), `${label}: the accessibility tree has no dialog named "Row colour"`);
    await pressOn(swatch('Orange'));
    const gold = await last();
    answers.push(gold);
    same(gold, { color: '#f28c28', opacity: 100 }, `${label}: with opacity: false the answer's opacity is 100`);
    await pick(`{ at: { x: 20, y: 60 }, value: '#d62828', opacity: 0 }`);
    await key(send, 'Escape');
    await last();
    await pick(`{ at: { x: 20, y: 60 }, value: '#d62828', opacity: 37 }`);
    await pressOn(swatch('Red'));
    const kept = await last();
    answers.push(kept);
    same(kept, { color: '#d62828', opacity: 100 }, `${label}: a grid colour answers its own opacity (100), not the slider's`);

    // --- a module palette ---
    await pick(`{ at: { x: 20, y: 60 }, recent: false, palette: [{ heading: 'Inks', colours: [{ name: 'Ink', color: '#1A2B3C' }, { name: 'Paper', color: 'f5eedb' }] }] }`);
    same(await ev(`[Boolean(window.__in('.sdk-cp-add')), window.__in('.sdk-cp-current').draggable, Boolean(window.__in('.sdk-cp-grid-error'))]`), [false, false, false], `${label}: a module palette has no "+", no drag and no grid line`);
    same(await ev(`[...window.__cp().querySelectorAll('.sdk-swatch')].map((b) => b.getAttribute('aria-label'))`), ['Ink', 'Paper'], `${label}: a module palette is drawn in place of the default, and recent: false leaves Recent out`);
    same(await ev(`[...window.__cp().querySelectorAll('.sdk-cp-head')].map((h) => h.textContent)`), ['Inks'], `${label}: the module palette's heading is drawn`);
    same(await ev(`window.__in('.sdk-cp-hexin').value`), '#1a2b3c', `${label}: with no value the picker starts at the palette's first colour`);
    await pressOn(swatch('Ink'));
    const ink = await last();
    answers.push(ink);
    same(ink, { color: '#1a2b3c', opacity: 100 }, `${label}: a module palette's swatch answers its colour`);
    await pick(`{ at: { x: 20, y: 60 }, value: 'red', palette: [{ heading: 'Inks', colours: [{ name: 'Ink', color: '#1a2b3c' }] }] }`);
    await tick();
    same(await ev(`[[...window.__cp().querySelectorAll('[aria-label="Recent"] .sdk-swatch')].map((b) => b.getAttribute('aria-label')).slice(0, 2), window.__in('.sdk-cp-hexin').value, window.__focus()]`), [['#d62828', '#f28c28'], '#1a2b3c', 'Ink'], `${label}: a value that is not #rrggbb is ignored (it starts at the palette's first colour), and Recent, newest first, names a colour the palette does not have by its hex (the answer from recent: false is not kept)`);
    // What the picker sent the page each time: the whole list, newest first, each { color, opacity }, no pair twice, at most 8.
    const sent = await ev('window.__recentSent');
    ok(sent.length >= 3 && sent.every((l) => Array.isArray(l) && l.length <= 8 && l.every((e) => Object.keys(e).sort().join() === 'color,opacity' && /^#[0-9a-f]{6}$/.test(e.color) && Number.isInteger(e.opacity)) && new Set(l.map((e) => `${e.color}/${e.opacity}`)).size === l.length),
      `${label}: each Recent list sent to the page is whole, at most 8 { color, opacity } with no pair twice: ${JSON.stringify(sent).slice(0, 300)}`);
    same(sent.slice(0, 2), [[{ color: '#008080', opacity: 100 }], [{ color: '#87ceeb', opacity: 100 }, { color: '#008080', opacity: 100 }]], `${label}: the first two choices were sent newest first`);
    await key(send, 'Escape');
    answers.push(await last());

    // --- colorField ---
    await ev(`(() => { const i = __R.getElementById('fld'); window.__ev = []; i.addEventListener('input', () => __ev.push('input')); i.addEventListener('change', () => __ev.push('change')); window.__live = []; window.__f = __h.ui.colorField(i, { opacity: false, onChange: (a) => __ev.push(a), onInput: (a) => __live.push(a) }); window.__trig = () => __R.querySelector('.sdk-picker'); return 1; })()`);
    const trig = () => ev(`(() => { const t = window.__trig(); return t ? [t.getAttribute('aria-label'), t.getAttribute('aria-haspopup'), t.getAttribute('aria-expanded'), t.disabled, __R.getElementById('fld').hidden] : null; })()`);
    same(await trig(), ['Row colour, Red, #d62828. Change it', 'dialog', 'false', false, true], `${label}: the colour field's trigger is named "<label>, <name>, <hex>. Change it", has a dialog popup, and hides the input`);
    same(await ev('window.__f.value'), '#d62828', `${label}: the field's value`);
    await pressOn('window.__trig()');
    same(await ev(`[window.__trig().getAttribute('aria-expanded'), window.__cp() && window.__cp().getAttribute('aria-label'), Boolean(window.__in('.sdk-cp-alpha'))]`), ['true', 'Row colour', false], `${label}: the field opens its picker named by the field, with no Opacity`);
    await inside('from the colour field');
    await pressOn(swatch('Teal'));
    same(await ev(`[__R.getElementById('fld').value, window.__ev, window.__f.value, window.__trig().getAttribute('aria-expanded'), window.__trig().getAttribute('aria-label'), window.__focus()]`),
      ['#008080', ['input', 'change', { color: '#008080', opacity: 100 }], '#008080', 'false', 'Row colour, Teal, #008080. Change it', 'Row colour, Teal, #008080. Change it'],
      `${label}: a choice in the field sets the input, sends input then change, then onChange once, and focus goes back to the trigger`);
    answers.push(...(await ev('window.__ev.filter((x) => typeof x === "object")')));
    // Opened and closed again with nothing chosen: nothing is sent, and the trigger shows the stored colour.
    await pressOn('window.__trig()');
    await ev(`window.__in('.sdk-cp-hue').focus()`);
    await key(send, 'ArrowRight');
    await key(send, 'Escape');
    await tick();
    same(await ev(`[window.__ev.length, window.__trig().getAttribute('aria-label'), Boolean(window.__cp())]`), [3, 'Row colour, Teal, #008080. Change it', false], `${label}: Escape in the field sends nothing and puts the trigger back`);
    // onInput (for showing live): the hue moved once, so it ran with that colour; Escape then runs it once more with the field's own colour.
    same(await ev(`(() => { const l = window.__live; return [l.length >= 2, l.some((x) => x.color !== '#008080'), l.length ? l[l.length - 1] : null, __R.getElementById('fld').value]; })()`), [true, true, { color: '#008080', opacity: 100 }, '#008080'],
      `${label}: the field's onInput shows each change live and, on Escape, the field's own colour again, and the input is not changed`);
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

    // ==== The cases from step 2's independent read (QA). Each line says "read case N" so a failure can be traced to it. ====
    // Read case 1: an empty text input. Choosing the colour the picker shows at first (the palette's first) still sets the input and
    // sends input, change and onChange: by a swatch, and by Enter in Hex.
    for (const how of ['a swatch', 'Enter in Hex']) {
      await ev(`(() => { const i = document.createElement('input'); i.type = 'text'; i.id = 'empty'; i.value = ''; i.setAttribute('aria-label', 'Empty'); i.style.cssText = 'position:absolute;left:12px;top:70px'; __R.appendChild(i); window.__e1 = []; i.addEventListener('input', () => __e1.push('input')); i.addEventListener('change', () => __e1.push('change')); window.__ef = __h.ui.colorField(i, { onChange: (a) => __e1.push(a) }); return 1; })()`);
      await ev('(window.__ef.open(), 1)');
      await tick();
      if (how === 'a swatch') await pressOn(swatch('White'));
      else { await ev(`window.__in('.sdk-cp-hexin').focus()`); await key(send, 'Enter'); }
      await tick();
      same(await ev(`[__R.getElementById('empty').value, window.__e1]`), ['#ffffff', ['input', 'change', { color: '#ffffff', opacity: 100 }]], `${label}: read case 1: an empty input, the shown colour chosen by ${how}, sets the input and sends input, change and onChange`);
      await ev(`(window.__ef.destroy(), __R.getElementById('empty').remove(), 1)`);
      if (await open()) { await key(send, 'Escape'); await tick(); }
    }

    // Read case 2: two `at` opens at different points (two toolbar buttons): the second is open. The same point twice: both null.
    same(await ev(`(async () => { const a = __h.ui.colorPicker({ at: { x: 30, y: 4 }, label: 'Fill' }); const b = __h.ui.colorPicker({ at: { x: 200, y: 4 }, label: 'Line' }); window.__two = b; const p = window.__cp(); return [await a, p ? p.getAttribute('aria-label') : 'none open']; })()`), [null, 'Line'], `${label}: read case 2: a second picker opened at another point while one is open is open (the first answers null)`);
    if (await open()) await key(send, 'Escape');
    answers.push(await ev('window.__two'));
    same(await ev(`(async () => { const a = __h.ui.colorPicker({ at: { x: 30, y: 4 } }); const b = __h.ui.colorPicker({ at: { x: 30, y: 4 } }); return [await a, await b, Boolean(window.__cp())]; })()`), [null, null, false], `${label}: read case 2: the same point twice toggles, both null`);

    // Read case 3: a module that opens another picker from onInput during a swatch's press: the new one stays open.
    await ev(`(() => { window.__nest = null; window.__p3 = __h.ui.colorPicker({ anchor: __R.getElementById('a'), value: '#2f6cbf', onInput: () => { if (!window.__nest) window.__nest = __h.ui.colorPicker({ at: { x: 30, y: 30 }, label: 'Second' }); } }); return 1; })()`);
    await tick();
    await pressOn(swatch('Teal'));
    await tick();
    same(await ev(`(() => { const p = window.__cp(); return p ? p.getAttribute('aria-label') : 'none open'; })()`), 'Second', `${label}: read case 3: a picker opened from onInput during a swatch's press stays open`);
    if (await open()) await key(send, 'Escape');
    await tick();

    // Read case 4: the picker's words at 4.5:1 (Hex, the typed hex, a heading and the error line with its text showing are
    // above); here also the Recent heading and the colour field's hex.
    await pick(`{ anchor: 'a', value: '#2f6cbf' }`);
    const recentHead = await ev(`(() => { const g = window.__cp().querySelector('[aria-label="Recent"] .sdk-cp-head'); return g ? window.__contrast(g) : null; })()`);
    ok(recentHead === null || recentHead >= 4.5, `${label}: read case 4: the Recent heading is ${recentHead && recentHead.toFixed(2)}:1 on the picker; wanted 4.5:1`);
    await key(send, 'Escape');
    answers.push(await last());
    await ev(`(window.__f3 = __h.ui.colorField(__R.getElementById('fld')), 1)`);
    // The colour field is a colour chip: a square button holding only the swatch (no hex words, no chevron), the hex its tooltip,
    // never stretched across its line; and the swatch draws exactly its colour, disabled too (nothing on it or round it fades it).
    const chip = async () => ev(`(() => { const t = __R.querySelector('.sdk-picker'); const sw = t.querySelector('.sdk-picker-sw'); const r = t.getBoundingClientRect(); let fade = []; for (let e = sw; e && e.nodeType === 1; e = e.parentElement || (e.getRootNode() && e.getRootNode().host)) { const c = getComputedStyle(e); if (c.opacity !== '1' || c.filter !== 'none' || c.mixBlendMode !== 'normal') fade.push(e.tagName + ' ' + c.opacity + ' ' + c.filter + ' ' + c.mixBlendMode); } return { kids: t.children.length, words: t.textContent.trim(), title: t.title, square: Math.abs(r.width - r.height) < 0.5, h: Math.round(r.height), bg: getComputedStyle(sw).backgroundColor, img: getComputedStyle(sw).backgroundImage, fade }; })()`);
    await ev(`(window.__f3.set('#1e5fd0'), 1)`);
    const c1 = await chip();
    same([c1.kids, c1.words, c1.title, c1.square, c1.bg, c1.img, c1.fade], [1, '', '#1e5fd0', true, 'rgb(30, 95, 208)', 'none', []], `${label}: the colour field is a square chip with the swatch only, the hex as its tooltip, the swatch exactly #1e5fd0 with nothing fading it`);
    ok(c1.h >= (coarse ? 44 : 30), `${label}: the colour chip is ${c1.h}px high; wanted ${coarse ? 44 : 30} or more`);
    await ev(`(__R.getElementById('fld').disabled = true, 1)`);
    await tick();
    const c2 = await chip();
    same([c2.bg, c2.fade], ['rgb(30, 95, 208)', []], `${label}: a disabled colour chip still draws exactly its colour (no half strength on the swatch)`);
    await ev(`(__R.getElementById('fld').disabled = false, 1)`);
    await tick();
    await ev('(window.__f3.destroy(), 1)');

    // ==== The cases from step 2's second independent read. ====
    const closeIfOpen = async () => { if (await open()) { await key(send, 'Escape'); await tick(); } };
    // A point in the module's box that is outside the picker (the picker may fill most of a phone's width).
    const outsidePoint = async () => {
      const c = await ev(`window.__rect(window.__cp())`);
      const spots = [[boxRect.r - 6, boxRect.b - 6], [boxRect.l + 6, boxRect.b - 6], [boxRect.l + 6, boxRect.t + 6], [boxRect.r - 6, boxRect.t + 6], [c.r + 10, c.b + 10]];
      return spots.find(([x, y]) => x >= boxRect.l && x <= boxRect.r && y >= boxRect.t && y <= boxRect.b && !(x >= c.l - 2 && x <= c.r + 2 && y >= c.t - 2 && y <= c.b + 2)) || spots[0];
    };

    // Label move: two <label for> on one input both point at the trigger; an id that needs escaping works; destroy() puts every `for`
    // back; an element already holding "<id>-colour" makes the trigger take a different, unique id and the label still opens the field.
    await ev(`(() => { const b = document.createElement('div'); b.id = 'lm-box'; b.style.cssText = 'position:absolute;left:12px;top:70px'; b.innerHTML = '<label id="lm-l1" for="a b.c#d">One</label> <label id="lm-l2" for="a b.c#d">Two</label> <input type="text" id="a b.c#d" value="#2f6cbf">'; __R.appendChild(b); window.__lmf = __h.ui.colorField(__R.getElementById('a b.c#d')); return 1; })()`);
    const lm = await ev(`(() => { const t = __R.querySelector('#lm-box .sdk-picker'); const l1 = __R.getElementById('lm-l1'), l2 = __R.getElementById('lm-l2'); return { id: t.id, f1: l1.htmlFor, f2: l2.htmlFor, c1: l1.control === t, c2: l2.control === t, labels: t.labels.length, unique: [...__R.querySelectorAll('[id]')].filter((e) => e.id === t.id).length }; })()`);
    same(lm, { id: 'a b.c#d-colour', f1: 'a b.c#d-colour', f2: 'a b.c#d-colour', c1: true, c2: true, labels: 2, unique: 1 }, `${label}: label move: two <label for> on an input whose id needs escaping (a b.c#d) both point at the trigger`);
    await pressOn(`__R.getElementById('lm-l2')`);
    await tick();
    same(await ev(`[Boolean(window.__cp()), __R.querySelector('#lm-box .sdk-picker').getAttribute('aria-expanded')]`), [true, 'true'], `${label}: label move: pressing the second label opened the picker`);
    await closeIfOpen();
    await ev(`(window.__lmf.destroy(), 1)`);
    same(await ev(`[__R.getElementById('lm-l1').htmlFor, __R.getElementById('lm-l2').htmlFor, __R.getElementById('lm-l1').control === __R.getElementById('a b.c#d'), Boolean(__R.querySelector('#lm-box .sdk-picker'))]`), ['a b.c#d', 'a b.c#d', true, false], `${label}: label move: destroy() puts every label's for back on the input`);
    await ev(`(__R.getElementById('lm-box').remove(), 1)`);
    await ev(`(() => { const x = document.createElement('div'); x.id = 'lm2-colour'; x.setAttribute('data-taken', '1'); __R.appendChild(x); const b = document.createElement('div'); b.id = 'lm2-box'; b.style.cssText = 'position:absolute;left:12px;top:70px'; b.innerHTML = '<label id="lm2-l" for="lm2">Shade</label> <input type="text" id="lm2" value="#2f6cbf">'; __R.appendChild(b); window.__lm2f = __h.ui.colorField(__R.getElementById('lm2')); return 1; })()`);
    const lm2 = await ev(`(() => { const t = __R.querySelector('#lm2-box .sdk-picker'); const l = __R.getElementById('lm2-l'); return { differs: Boolean(t.id) && t.id !== 'lm2-colour', unique: [...__R.querySelectorAll('[id]')].filter((e) => e.id === t.id).length, forIsTrigger: l.htmlFor === t.id, control: l.control === t, takenKept: __R.getElementById('lm2-colour').getAttribute('data-taken') }; })()`);
    same(lm2, { differs: true, unique: 1, forIsTrigger: true, control: true, takenKept: '1' }, `${label}: label move: where "<id>-colour" is taken the trigger gets another, unique id, the label points at it, and the other element is left alone`);
    await pressOn(`__R.getElementById('lm2-l')`);
    await tick();
    same(await ev(`Boolean(window.__cp())`), true, `${label}: label move: where "<id>-colour" is taken the label still opens the field`);
    await closeIfOpen();
    await ev(`(window.__lm2f.destroy(), 1)`);
    same(await ev(`[__R.getElementById('lm2-l').htmlFor, Boolean(__R.querySelector('#lm2-box .sdk-picker'))]`), ['lm2', false], `${label}: label move: destroy() puts the label's for back where "<id>-colour" was taken`);
    await ev(`(__R.getElementById('lm2-box').remove(), __R.getElementById('lm2-colour').remove(), 1)`);

    // Hue at the top: #ff0001 reads 359 and "Hue 359 degrees"; ArrowRight from there does not change the colour.
    await pick(`{ at: { x: 20, y: 60 }, value: '#ff0001' }`);
    same(await ev(`[window.__in('.sdk-cp-hue').getAttribute('aria-valuenow'), window.__in('.sdk-cp-hue').getAttribute('aria-valuetext')]`), ['359', 'Hue 359 degrees'], `${label}: hue at the top: #ff0001 reads 359 and "Hue 359 degrees"`);
    await ev(`window.__in('.sdk-cp-hue').focus()`);
    await key(send, 'ArrowRight');
    same(await ev(`[window.__in('.sdk-cp-hexin').value, window.__in('.sdk-cp-hue').getAttribute('aria-valuenow'), window.__inputs.length ? window.__inputs.at(-1).color : null]`), ['#ff0001', '359', null], `${label}: hue at the top: ArrowRight from 359 changes nothing (Hex, Hue and onInput)`);
    await escape('hue at the top');

    // Tooltip: none shows when the picker opens, by a press (the pointer is over the trigger) or by Enter (the trigger has focus).
    await ev(`(window.__tf = __h.ui.colorField(__R.getElementById('fld')), 1)`);
    const tipShown = () => ev(`Boolean(document.querySelector('.sdk-tooltip[data-show], #sdk-tip[data-show]'))`);
    await pressOn('window.__trig()');
    await sleep(800); // the tooltip's hover delay is 500 ms
    same([await open(), await tipShown()], [true, false], `${label}: tooltip: after a press opens the picker, wanted [picker open, tooltip showing] to be this`);
    await closeIfOpen();
    await ev(`(window.__trig().focus(), 1)`);
    await key(send, 'Enter');
    await sleep(300);
    same([await open(), await tipShown()], [true, false], `${label}: tooltip: after Enter opens the picker, wanted [picker open, tooltip showing] to be this`);
    await closeIfOpen();
    await sleep(300);
    await ev(`(window.__tf.destroy(), 1)`);

    // Press outside. An empty field: nothing changed answers null and writes nothing; a swatch on the shown colour writes it. A filled
    // field: a press outside after a drag answers the dragged colour.
    const mkField = (id, value) => ev(`(() => { const i = document.createElement('input'); i.type = 'text'; i.id = '${id}'; i.value = '${value}'; i.setAttribute('aria-label', 'Outside'); i.style.cssText = 'position:absolute;left:12px;top:70px'; __R.appendChild(i); window.__po = []; window.__poa = 'pending'; i.addEventListener('input', () => __po.push('input')); i.addEventListener('change', () => __po.push('change')); window.__pof = __h.ui.colorField(i, { onChange: (a) => __po.push(a) }); window.__pof.open().then((a) => { window.__poa = a; }); return 1; })()`);
    const rmField = () => ev(`(window.__pof.destroy(), __R.getElementById('po-in').remove(), 1)`);
    await mkField('po-in', '');
    await tick();
    const [ox, oy] = await outsidePoint();
    await press(send, coarse, ox, oy);
    await tick();
    same(await ev(`[window.__poa, __R.getElementById('po-in').value, window.__po, Boolean(window.__cp())]`), [null, '', [], false], `${label}: press outside: on an empty field a press outside with nothing changed answers null, writes nothing and sends nothing`);
    await rmField();
    await mkField('po-in', '');
    await tick();
    await pressOn(swatch('White'));
    await tick();
    same(await ev(`[__R.getElementById('po-in').value, window.__po]`), ['#ffffff', ['input', 'change', { color: '#ffffff', opacity: 100 }]], `${label}: press outside: on an empty field a swatch press on the shown colour writes it`);
    await rmField();
    await mkField('po-in', '#c0392b');
    await tick();
    const area2 = await ev(`window.__rect(window.__in('.sdk-cp-area'))`);
    const pts2 = [];
    for (let i = 0; i <= 6; i += 1) pts2.push([area2.l + 10 + i * (area2.w - 20) / 6, area2.t + 10 + i * (area2.h - 20) / 6]);
    await drag(send, coarse, pts2);
    const draggedHex = await ev(`window.__in('.sdk-cp-hexin').value`);
    ok(draggedHex !== '#c0392b', `${label}: press outside: the drag did not change the colour (${draggedHex})`);
    const [px, py] = await outsidePoint();
    await press(send, coarse, px, py);
    await tick();
    same(await ev(`[window.__poa && window.__poa.color, __R.getElementById('po-in').value, window.__po, Boolean(window.__cp())]`), [draggedHex, draggedHex, ['input', 'change', { color: draggedHex, opacity: 100 }], false], `${label}: press outside: on a filled field a press outside after a drag answers the dragged colour and writes it`);
    await rmField();
    await closeIfOpen();

    // Read case 6: no listener left on the document, the window or the module's root after 50 opens and closes (Escape, a swatch, a
    // press outside, in turn), and no picker left in the page.
    const listeners = async () => {
      const out = {};
      for (const expr of ['document', 'window', 'window.__R']) {
        const { result } = await send('Runtime.evaluate', { expression: expr });
        out[expr] = (await send('DOMDebugger.getEventListeners', { objectId: result.objectId })).listeners.length;
      }
      return out;
    };
    const cycle = (k) => `(async () => { for (let i = 0; i < ${k}; i += 1) { const p = __h.ui.colorPicker({ anchor: __R.getElementById('a'), value: '#2f6cbf', onInput: () => {} }); const pop = window.__cp(); if (i % 3 === 0) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); else if (i % 3 === 1) pop.querySelector('.sdk-swatch').click(); else __R.querySelector('.fill').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true })); await p; } return 1; })()`;
    await ev(cycle(3));
    const lBefore = await listeners();
    await ev(cycle(50));
    const lAfter = await listeners();
    same(lAfter, lBefore, `${label}: read case 6: the listeners on the document, the window and the module's root after 50 opens and closes`);
    same(await ev(`__R.querySelectorAll('.sdk-cp, [id^="sdk-cp-"]').length + document.querySelectorAll('.sdk-cp, [id^="sdk-cp-"]').length`), 0, `${label}: read case 6: no picker left in the page after 50 opens and closes`);

    // Read case 8: every way it closes settles the Promise exactly once: Escape, a press outside, a swatch, Enter in Hex, the same
    // call again (both), and a new picker (the first).
    await ev(`(() => { window.__settled = {}; window.__track = (name, p) => { __settled[name] = 0; p.then(() => { __settled[name] += 1; }, () => { __settled[name] += 100; }); }; return 1; })()`);
    const track = (name, o) => ev(`(__track(${JSON.stringify(name)}, __h.ui.colorPicker(${o})), 1)`);
    await track('Escape', `{ anchor: __R.getElementById('a') }`);
    await key(send, 'Escape');
    await track('a press outside', `{ at: { x: 20, y: 60 } }`);
    await tick();
    await press(send, coarse, boxRect.r - 6, boxRect.b - 6);
    await track('a swatch', `{ anchor: __R.getElementById('a') }`);
    await tick();
    await pressOn(swatch('Orange'));
    await track('Enter in Hex', `{ anchor: __R.getElementById('a') }`);
    await ev(`window.__in('.sdk-cp-hexin').focus()`);
    await key(send, 'Enter');
    await track('the same call again (first)', `{ anchor: __R.getElementById('a') }`);
    await track('the same call again (second)', `{ anchor: __R.getElementById('a') }`);
    await track('a new picker (first)', `{ anchor: __R.getElementById('a') }`);
    await track('a new picker (second)', `{ anchor: __R.getElementById('low') }`);
    await key(send, 'Escape');
    await sleep(100);
    if (await open()) { await key(send, 'Escape'); await tick(); }
    const settled = await ev('window.__settled');
    same(Object.entries(settled).filter(([, v]) => v !== 1).map(([k, v]) => `${k}: ${v}`), [], `${label}: read case 8: each way of closing settles its Promise exactly once`);

    // Read case 9: a palette name or heading with each refused kind of character is refused with the sentence; a tampered Recent in
    // storage shows only clean hexes.
    const REFUSE = 'TypeError: host.ui.colorPicker: a palette colour needs a name and a #rrggbb colour';
    const refusedNames = await ev(`(() => { const out = []; for (const [what, s] of ${JSON.stringify([['a zero-width space', 'a​b'], ['only zero-width joiners', '‍‍'], ['a left-to-right mark', 'a‎b'], ['a soft hyphen', 'a­b'], ['a right-to-left override', 'a‮b'], ['a right-to-left isolate', 'a⁧b'], ['U+2028', 'a b'], ['U+2029', 'a b'], ['a delete character', 'a\u007fb'], ['U+0085', 'a\u0085b'], ['a lone surrogate', 'ab\ud800c'], ['no letter or digit', '---'], ['<', 'a<b'], ['>', 'a>b'], ['a control character', 'a\nb'], ['41 characters', 'n'.repeat(41)]])}) { for (const where of ['name', 'heading']) { const pal = where === 'name' ? [{ heading: 'Inks', colours: [{ name: s, color: '#1a2b3c' }] }] : [{ heading: s, colours: [{ name: 'Ink', color: '#1a2b3c' }] }]; let got; try { __h.ui.colorPicker({ at: { x: 1, y: 1 }, palette: pal }); got = 'opened'; document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (e) { got = e.name + ': ' + e.message; } out.push([where + ' with ' + what, got]); } } return out; })()`);
    same(refusedNames.filter(([, got]) => got !== REFUSE).map(([what, got]) => `${what}: ${got}`), [], `${label}: read case 9: a palette name or heading with each refused kind of character is refused with the sentence`);
    await tick();
    // A Recent list the page answers that is not clean (a word, url(), upper case, a string opacity, a pair twice, 9 colours) is not
    // drawn at all: the picker shows no Recent, and nothing of it reaches a style.
    const tamperedLists = [
      ['url(x)', 'a', [{ color: 'url(x)', opacity: 100 }]], ['a style string', 'b', [{ color: '#000000;background:red', opacity: 100 }]], ['upper case', 'c', [{ color: '#ABCDEF', opacity: 100 }]],
      ['a string opacity', 'd', [{ color: '#abcdef', opacity: '100' }]], ['a pair twice', 'e', [{ color: '#abcdef', opacity: 100 }, { color: '#abcdef', opacity: 100 }]],
      ['9 colours', 'f', Array.from({ length: 9 }, (_, i) => ({ color: `#0000${i.toString(16).padStart(2, '0')}`, opacity: 100 }))], ['a bare hex', 'g', ['#abcdef']],
    ];
    const tampered = [];
    for (const [what, , list] of tamperedLists) {
      await ev(`(window.__recent = ${JSON.stringify(list)}, __h.ui.colorPicker({ at: { x: 10, y: 10 } }), 1)`);
      await sleep(80);
      tampered.push([what, await ev(`(() => { const g = window.__cp().querySelector('[aria-label="Recent"]'); return g && !g.hidden ? g.querySelectorAll('.sdk-swatch').length : 0; })()`)]);
      await ev(`(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 1)`);
      await tick();
    }
    same(tampered.filter(([, k]) => k !== 0), [], `${label}: read case 9: a Recent list from the page that is not clean shows no Recent`);
    await ev('(window.__recent = null, 1)');
    await tick();

    // Read case 10 (no eyedropper in the browser) is tried on the 360px phone below, with window.EyeDropper deleted before the page loads.

    answers.push(...(await ev('window.__answers')));
    await ev(`(document.getElementById('cp-box').remove(), 1)`);

    // --- the page's own field (hostColour, for the host's pages) ---
    await ev(`(() => { const i = document.createElement('input'); i.type = 'color'; i.id = 'cp-page'; i.value = '#1e5fd0'; i.setAttribute('aria-label', 'Accent'); i.style.cssText = 'position:fixed;left:8px;top:8px'; document.body.appendChild(i); window.__pev = []; i.addEventListener('change', () => __pev.push(i.value)); window.__pf = hostColour.field(i, { onChange: (a) => __pev.push(a) }); return 1; })()`);
    same(await ev(`document.getElementById('cp-page').previousElementSibling.getAttribute('aria-label')`), 'Accent, Blue, #1e5fd0. Change it', `${label}: hostColour.field puts the same trigger on a page's input`);
    await ev(`document.getElementById('cp-page').previousElementSibling.click()`);
    await tick();
    ok(await ev(`Boolean(document.querySelector('.sdk-cp'))`), `${label}: hostColour.field's trigger opened no picker in the page`);
    await sleep(200); // the page's own grid arrives from the route
    await pressOn(`document.querySelector('.sdk-cp .sdk-swatch[aria-label="Orange"]')`);
    same(await ev('window.__pev'), ['#f28c28', { color: '#f28c28', opacity: 100 }], `${label}: hostColour.field sets the page's input and answers`);
    answers.push(...(await ev('window.__pev.filter((x) => typeof x === "object")')));
    await ev(`(window.__pf.destroy(), document.getElementById('cp-page').remove(), 1)`);
  }

  // ---- read case 7: a module running in the page, opened from its toolbar ----
  // Escape gives focus back somewhere useful (the toolbar button), not to the page's body. If this cannot be done in the picker it
  // becomes a known gap: the failure line names it "read case 7 (in-page toolbar focus)" so it can be marked as such.
  async function inPageToolbar({ tab, send, label, coarse }) {
    await send('Page.navigate', { url: `${server.base}/modules/cppage` });
    let ready = false;
    for (let i = 0; i < 150 && !ready; i += 1) { ready = await tab.eval('window.__ready === true').catch(() => false); if (!ready) await sleep(100); }
    if (!ready) { ok(false, `${label}: read case 7: the in-page test module did not start`); return; }
    const DEEP_CP = `(() => { let found = null; const walk = (r) => { for (const e of r.querySelectorAll('.sdk-cp')) found = found || e; for (const e of r.querySelectorAll('*')) if (e.shadowRoot) walk(e.shadowRoot); }; walk(document); return found; })()`;
    ok(await tab.eval(`(() => { const p = [...document.querySelectorAll('*')].find((e) => e.shadowRoot && e.shadowRoot.getElementById('fld')); return Boolean(p) && !document.querySelector('iframe[src*="cppage"]'); })()`), `${label}: read case 7: the test module does not run in the page (no shadow root holds its field)`);
    let btn = null;
    for (let i = 0; i < 50 && !btn; i += 1) {
      btn = await tab.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getClientRects().length && ((x.getAttribute('aria-label') || '').trim() === 'Colour' || x.textContent.trim() === 'Colour')); if (!b) return null; b.setAttribute('data-cp-check', '1'); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      if (!btn) await sleep(100);
    }
    if (!btn) { ok(false, `${label}: read case 7: the in-page module's toolbar button "Colour" is not on the page`); return; }
    await press(send, coarse, btn.x, btn.y);
    let opened = false;
    for (let i = 0; i < 40 && !opened; i += 1) { opened = await tab.eval(`Boolean(${DEEP_CP})`); if (!opened) await sleep(100); }
    ok(opened, `${label}: read case 7: the in-page module's toolbar button opened no picker`);
    if (!opened) return;
    const pos = await tab.eval(`(() => { const p = ${DEEP_CP}; const box = p.getRootNode().host; const r = p.getBoundingClientRect(); const b = box.getBoundingClientRect(); return { inside: r.left >= b.left - 0.5 && r.right <= b.right + 0.5 && r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5, top: r.top - b.top }; })()`);
    ok(pos.inside && Math.abs(pos.top - 4) <= 1, `${label}: read case 7: from the in-page toolbar the picker is not inside the module's box at y 4 (${JSON.stringify(pos)})`);
    const onButton = () => tab.eval(`(() => { const a = document.activeElement; return a ? a.tagName.toLowerCase() + (a.getAttribute('data-cp-check') ? ' (the toolbar button)' : '') : 'nothing'; })()`);
    const pickerOpen = () => tab.eval(`Boolean(${DEEP_CP})`);
    const waitOpen = async () => { let o = false; for (let i = 0; i < 40 && !o; i += 1) { o = await pickerOpen(); if (!o) await sleep(100); } return o; };
    await key(send, 'Escape');
    await sleep(200);
    same(await tab.eval('window.__answers'), [null], `${label}: read case 7: Escape from the in-page toolbar answers null`);
    same(await onButton(), 'button (the toolbar button)', `${label}: read case 7 (in-page toolbar focus): after a mouse press and Escape, focus is not back on the module's own button`);
    answers.push(null);
    // After Enter on the button: the same point, Escape, and focus on the button again.
    await tab.eval(`(document.querySelector('[data-cp-check]').focus(), 1)`);
    await key(send, 'Enter');
    ok(await waitOpen(), `${label}: in-page button: Enter on the module's own button opened no picker`);
    await key(send, 'Escape');
    await sleep(200);
    same(await tab.eval('window.__answers'), [null, null], `${label}: in-page button: Escape after Enter answers null`);
    same(await onButton(), 'button (the toolbar button)', `${label}: in-page button: after Enter and Escape, focus is not back on the module's own button`);
    ok(!(await pickerOpen()), `${label}: in-page button: the picker is still open after Escape`);
    answers.push(null);
    // A press on a host-page input outside the module closes the picker.
    await press(send, coarse, btn.x, btn.y);
    ok(await waitOpen(), `${label}: in-page click outside: the button did not open the picker`);
    const host = await tab.eval(`(() => { const i = document.createElement('input'); i.id = 'cp-host-in'; i.type = 'text'; i.setAttribute('aria-label', 'Host page input'); i.style.cssText = 'position:fixed;left:2px;top:' + Math.max(0, innerHeight - 56) + 'px;width:120px;height:40px;z-index:2147483647'; document.body.appendChild(i); const r = i.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const p = ${DEEP_CP}; const pr = p ? p.getBoundingClientRect() : null; return { x, y, hit: document.elementFromPoint(x, y) === i, clear: !pr || pr.bottom < r.top }; })()`);
    if (!host.hit || !host.clear) ok(false, `${label}: in-page click outside: the host-page input is covered (on top ${host.hit}, clear of the picker ${host.clear}); the case cannot press it`);
    else {
      await press(send, coarse, host.x, host.y);
      await sleep(250);
      ok(!(await pickerOpen()), `${label}: in-page click outside: a press on a host-page input outside the module left the picker open`);
      same(await tab.eval('window.__answers.length'), 3, `${label}: in-page click outside: the picker was not answered once when a host-page input was pressed`);
      answers.push(await tab.eval('window.__answers.at(-1)'));
    }
    await tab.eval(`(document.getElementById('cp-host-in').remove(), 1)`);

    // S1: a picker is open; a press on the page's top bar (outside the module) closes it; within 600ms a press on an anchored
    // colorField trigger opens its picker (the outside press must not swallow the next open).
    // S2: open the picker from a button, press a part of it that takes no focus (the colour showing), then Escape: focus is back on the button.
    const TRIGGER = `(() => { let found = null; const walk = (r) => { for (const e of r.querySelectorAll('.sdk-picker')) found = found || e; for (const e of r.querySelectorAll('*')) if (e.shadowRoot) walk(e.shadowRoot); }; walk(document); return found; })()`;
    const trig = await tab.eval(`(() => { const t = ${TRIGGER}; if (!t) return null; const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, bottom: r.bottom }; })()`);
    const bar = await tab.eval(`(() => { const h = document.querySelector('header.topbar'); if (!h) return null; const r = h.getBoundingClientRect(); for (let x = r.left + 4; x < r.right - 4; x += 6) { const y = r.top + r.height / 2; const e = document.elementFromPoint(x, y); if (e === h) return { x, y }; } return null; })()`);
    if (!trig) ok(false, `${label}: S1: the in-page module's colour field trigger is not on the page`);
    else if (!bar) ok(false, `${label}: S1: found no bare spot on the page's top bar to press`);
    else {
      await press(send, coarse, trig.x, trig.y);
      ok(await waitOpen(), `${label}: S1: the field's trigger opened no picker`);
      await press(send, coarse, bar.x, bar.y); // press() waits 60ms
      ok(!(await pickerOpen()), `${label}: S1: a press on the page's top bar left the picker open`);
      await press(send, coarse, trig.x, trig.y); // within 600ms of the bar press
      await sleep(100);
      const under = await tab.eval(`(() => { const p = ${DEEP_CP}; if (!p) return null; const t = ${TRIGGER}.getBoundingClientRect(); const r = p.getBoundingClientRect(); return Math.abs(r.top - (t.bottom + 4)) <= 8 || Math.abs(t.top - r.bottom) <= 8; })()`);
      ok(under !== null, `${label}: S1 (the page's top bar, then the field's trigger within 600ms): the trigger's press opened no picker`);
      ok(under !== false, `${label}: S1: the picker did not open under the trigger`);
      await key(send, 'Escape');
      await sleep(150);
    }
    // S2 from the toolbar button.
    await tab.eval(`(document.querySelector('[data-cp-check]').focus(), 1)`);
    if (await pickerOpen()) { await key(send, 'Escape'); await sleep(100); }
    await press(send, coarse, btn.x, btn.y);
    if (!(await waitOpen())) ok(false, `${label}: S2: the button opened no picker`);
    else {
      const head = await tab.eval(`(() => { const p = ${DEEP_CP}; const h = p.querySelector('.sdk-cp-current'); if (!h) return null; const r = h.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      if (!head) ok(false, `${label}: S2: the picker has no colour showing`);
      else {
        await press(send, coarse, head.x, head.y);
        ok(await pickerOpen(), `${label}: S2: a press on the colour showing closed the picker`);
        await key(send, 'Escape');
        await sleep(200);
        ok(!(await pickerOpen()), `${label}: S2: the picker is still open after Escape`);
        same(await onButton(), 'button (the toolbar button)', `${label}: S2: after a press on the colour showing and Escape, focus is not back on the button`);
      }
    }
  }

  // ---- a scrolled frame: popovers open at their anchor ----
  // The module's document is taller than its frame and is scrolled past 1000px; the anchor button is in view, near the top of the frame.
  // Each popover (a menu, its flyout, the tag picker, an anchored colour picker) must open within 4px of where the anchor is on screen:
  // its top 4px under the anchor's foot (or its foot 4px over the anchor's top, when it flips), measured in the frame's own viewport.
  async function scrolledFrame({ tab, send, label }) {
    const attached = [];
    const hook = (m) => { if (m.method === 'Target.attachedToTarget' && m.sessionId === tab.sid && m.params.targetInfo.type === 'iframe') attached.push(m.params.sessionId); };
    cdp.listeners.push(hook);
    try {
      await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
      await send('Page.navigate', { url: `${server.base}/modules/cpscroll` });
      let sid = null;
      for (let i = 0; i < 150 && !sid; i += 1) {
        for (const s of attached) {
          const r = await cdp.send('Runtime.evaluate', { expression: 'window.__ready === true', returnByValue: true }, s).catch(() => null);
          if (r && r.result && r.result.value === true) sid = s;
        }
        if (!sid) await sleep(100);
      }
      if (!sid) { ok(false, `${label}: scrolled frame: the module's frame did not start in its own process`); return; }
      await cdp.send('Runtime.enable', {}, sid).catch(() => {});
      const fev = async (expr) => {
        const r = await cdp.send('Runtime.evaluate', { expression: `(async () => (${expr}))()`, returnByValue: true, awaitPromise: true }, sid);
        if (r.exceptionDetails) throw new Error(`frame error: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
        return r.result.value;
      };
      const until = async (expr) => { for (let i = 0; i < 40; i += 1) { if (await fev(expr).catch(() => false)) return true; await sleep(100); } return false; };
      await fev(`(window.scrollTo(0, 1100), 1)`);
      await sleep(200);
      const y = await fev('window.scrollY');
      ok(y > 1000, `${label}: scrolled frame: the frame's document is at ${y}; wanted more than 1000`);
      // Where the popover is against the anchor (both in the frame's viewport).
      const gap = (sel, anchorSel = '#sb') => fev(`(() => { const a = document.querySelector(${JSON.stringify(anchorSel)}).getBoundingClientRect(); const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const m = e.getBoundingClientRect(); return { anchorTop: Math.round(a.top), anchorBottom: Math.round(a.bottom), top: Math.round(m.top), bottom: Math.round(m.bottom), below: Math.round(m.top - a.bottom), above: Math.round(a.top - m.bottom) }; })()`);
      const fits = (g) => g && (Math.abs(g.below - 4) <= 4 || Math.abs(g.above - 4) <= 4);
      const say2 = (g) => JSON.stringify(g);

      // host.menu.show, and its flyout
      await fev(`(window.__host.menu.show({ id: 'sc-menu', anchor: document.getElementById('sb'), items: [{ id: 'a', label: 'Alpha' }, { id: 'c', label: 'Category', items: [{ id: 'x', label: 'Inner' }, { id: 'y', label: 'Inner two' }] }] }), 1)`);
      await until(`Boolean(document.querySelector('.sdk-menu'))`);
      let g = await gap('.sdk-menu:not(.sdk-menu-flyout)');
      ok(fits(g), `${label}: scrolled frame: host.menu.show opened away from its anchor (scrollY ${y}): ${say2(g)}; wanted its top 4px (within 4) under the anchor`);
      await fev(`(document.querySelector('.sdk-menu-category').click(), 1)`);
      const flew = await until(`Boolean(document.querySelector('.sdk-menu-flyout'))`);
      if (!flew) ok(false, `${label}: scrolled frame: the menu's category opened no flyout`);
      else {
        const f = await fev(`(() => { const r = document.querySelector('.sdk-menu-category').getBoundingClientRect(); const m = document.querySelector('.sdk-menu-flyout').getBoundingClientRect(); return { rowTop: Math.round(r.top), flyTop: Math.round(m.top), flyBottom: Math.round(m.bottom) }; })()`);
        ok(f.flyBottom > 0 && f.flyTop >= 0 && Math.abs(f.flyTop - f.rowTop) <= 8, `${label}: scrolled frame: the flyout opened away from its category (scrollY ${y}): ${say2(f)}; wanted its top within 8px of the row's (a flyout lines up with its row, less the menu's padding)`);
      }
      await fev(`(window.__host.menu.close(), 1)`);

      // host.tags.picker
      await fev(`(window.__tp = window.__host.tags.picker(document.getElementById('sb'), {}), 1)`);
      await until(`Boolean(document.querySelector('.sdk-tag-picker'))`);
      g = await gap('.sdk-tag-picker');
      ok(fits(g), `${label}: scrolled frame: host.tags.picker opened away from its anchor (scrollY ${y}): ${say2(g)}; wanted its top 4px (within 4) under the anchor`);
      await fev(`(window.__tp.close(), 1)`);

      // an anchored colour picker
      await fev(`(window.__cpp = window.__host.ui.colorPicker({ anchor: document.getElementById('sb'), value: '#2f6cbf' }), 1)`);
      await until(`Boolean(document.querySelector('.sdk-cp'))`);
      g = await gap('.sdk-cp');
      ok(fits(g), `${label}: scrolled frame: an anchored host.ui.colorPicker opened away from its anchor (scrollY ${y}): ${say2(g)}; wanted its top 4px (within 4) under the anchor`);
      await fev(`(window.__host.ui.colorPicker({ anchor: document.getElementById('sb'), value: '#2f6cbf' }), 1)`); // the same anchor again closes it
      answers.push(await fev('window.__cpp'));
    } finally {
      cdp.listeners = cdp.listeners.filter((f) => f !== hook);
    }
  }

  // ---- read cases 5, 10 and 11: the phone widths ----
  async function phoneCases({ tab, send, width }) {
    const label = `${width}px phone`;
    await send('Page.navigate', { url: `${server.base}/admin.html` });
    let ready = false;
    for (let i = 0; i < 100 && !ready; i += 1) { ready = await tab.eval(`document.readyState === 'complete' && typeof window.hostColour === 'object'`).catch(() => false); if (!ready) await sleep(100); }
    if (!ready) throw new Error('the admin page did not load the SDK');
    await sleep(200);
    await tab.eval(`(() => { const box = document.createElement('div'); box.id = 'cp-phone'; box.style.cssText = 'position:fixed;left:8px;top:8px;z-index:2147480000'; box.innerHTML = '<label>Fill <input id="cp-ph" type="text" value="#2f6cbf"></label>'; document.body.appendChild(box); window.__pf = hostColour.field(document.getElementById('cp-ph')); return 1; })()`);
    for (const [how, o] of [['at { x: 0, y: 4 }', `{ at: { x: 0, y: 4 } }`], ['at { x: 100000, y: 4 }', `{ at: { x: 100000, y: 4 } }`], ['under the field', `{ anchor: document.querySelector('#cp-phone .sdk-picker') }`]]) {
      const m = await tab.eval(`(() => { window.__pp = hostColour.picker(${o}); const p = document.querySelector('.sdk-cp'); const r = p.getBoundingClientRect(); const out = { sw: p.scrollWidth, cw: p.clientWidth, l: r.left, r: r.right, vw: document.documentElement.clientWidth }; return out; })()`);
      ok(m.sw <= m.cw, `${label}: read case 5: ${how} the picker scrolls sideways (scrollWidth ${m.sw}, clientWidth ${m.cw})`);
      ok(m.l >= 0 && m.r <= m.vw + 0.5, `${label}: read case 5: ${how} the picker (${Math.round(m.l)} to ${Math.round(m.r)}) is not inside the ${m.vw}px screen`);
      await key(send, 'Escape');
      answers.push(await tab.eval('window.__pp'));
    }
    if (width !== 375) {
      // Red and Teal chosen (the chosen swatch carries a ring): the popover has no sideways scroll, at the top left, the top right and under the field.
      for (const [name, value] of [['Red', '#d62828'], ['Teal', '#008080']]) {
        for (const [how, o] of [['at { x: 0, y: 4 }', `{ at: { x: 0, y: 4 }, value: '${value}' }`], ['at { x: 100000, y: 4 }', `{ at: { x: 100000, y: 4 }, value: '${value}' }`], ['under the field', `{ anchor: document.querySelector('#cp-phone .sdk-picker'), value: '${value}' }`]]) {
          const m = await tab.eval(`(() => { window.__pp = hostColour.picker(${o}); const p = document.querySelector('.sdk-cp'); return { sw: p.scrollWidth, cw: p.clientWidth, chosen: p.querySelectorAll('.sdk-swatch[aria-checked="true"]').length }; })()`);
          ok(m.sw <= m.cw, `${label}: no sideways scroll: with ${name} chosen ${how} the picker scrolls sideways (scrollWidth ${m.sw}, clientWidth ${m.cw})`);
          await key(send, 'Escape');
          answers.push(await tab.eval('window.__pp'));
        }
      }
    }
    await tab.eval(`(window.__pp = hostColour.picker({ at: { x: 0, y: 4 } }), 1)`);
    if (width === 360) {
      // Read case 10: no eyedropper in this browser (window.EyeDropper deleted before the page loaded): no button, and Tab skips it.
      const d = await tab.eval(`(() => { const b = document.querySelector('.sdk-cp-dropper'); document.querySelector('.sdk-cp-hexin').focus(); return [typeof window.EyeDropper, b.hidden, b.getClientRects().length]; })()`);
      await key(send, 'Tab');
      d.push(await tab.eval(`document.activeElement.getAttribute('role')`));
      same(d, ['undefined', true, 0, 'radio'], `${label}: read case 10: with no window.EyeDropper the button is hidden and Tab goes from Hex to the palette`);
    }
    if (width === 375) {
      // Read case 11: check-phone-targets does not open the picker, so its targets are measured here.
      const sz = await tab.eval(`(() => { const p = document.querySelector('.sdk-cp'); const s = (sel) => { const e = p.querySelector(sel); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }; const t = document.querySelector('#cp-phone .sdk-picker').getBoundingClientRect(); return { swatches: [...p.querySelectorAll('.sdk-swatch')].map((b) => { const r = b.getBoundingClientRect(); return Math.min(Math.round(r.width), Math.round(r.height)); }), hue: s('.sdk-cp-hue'), alpha: s('.sdk-cp-alpha'), hex: s('.sdk-cp-hexin'), dropper: s('.sdk-cp-dropper'), font: parseFloat(getComputedStyle(p.querySelector('.sdk-cp-hexin')).fontSize), trigger: Math.round(t.height) }; })()`);
      ok(Math.min(...sz.swatches) >= 44, `${label}: read case 11: the smallest swatch is ${Math.min(...sz.swatches)}px; wanted 44px`);
      ok(sz.hue[1] >= 44 && sz.alpha[1] >= 44 && sz.hex[1] >= 44, `${label}: read case 11: Hue ${sz.hue[1]}px, Opacity ${sz.alpha[1]}px and Hex ${sz.hex[1]}px tall; wanted 44px`);
      ok(!sz.dropper || (sz.dropper[0] >= 44 && sz.dropper[1] >= 44), `${label}: read case 11: Pick from the screen is ${sz.dropper && sz.dropper.join('x')}; wanted 44px`);
      ok(sz.font >= 16, `${label}: read case 11: the hex text is ${sz.font}px; wanted 16px`);
      ok(sz.trigger >= 44, `${label}: read case 11: the colour field's trigger is ${sz.trigger}px tall; wanted 44px`);
    }
    await key(send, 'Escape');
    answers.push(await tab.eval('window.__pp'));
  }

  // ---- the person's grid (step 7): through the real route, in a sandboxed frame, a module in the page and the page's own picker ----
  async function gridCases({ tab, send, jar }) {
    const label = 'the grid';
    const server_ = async (method, body) => {
      const r = await fetch(`${server.base}/api/me/color-grid`, { method, headers: { cookie: jar, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    const stored = async () => (await server_('GET')).body.colors;
    const named = (list) => list.map((c) => START.find((x) => x.color === c.color && c.opacity === 100)?.name || (c.opacity < 100 ? `${c.color}, ${c.opacity} percent` : c.color));
    same(await stored(), null, `${label}: before any edit the server holds no grid (colors: null)`);
    const mouse = async (x, y, button = 'left') => {
      const b = button === 'right' ? 2 : 1;
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: b, clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 });
      await sleep(80);
    };
    // The frame of the sandboxed test module, and its toolbar button.
    const openFrame = async () => {
      const attached = [];
      const hook = (m) => { if (m.method === 'Target.attachedToTarget' && m.sessionId === tab.sid && m.params.targetInfo.type === 'iframe') attached.push(m.params.sessionId); };
      cdp.listeners.push(hook);
      try {
        await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
        await send('Page.navigate', { url: `${server.base}/modules/cpcheck` });
        const frameEval = async (sid, expr) => {
          const r = await cdp.send('Runtime.evaluate', { expression: `(async () => (${expr}))()`, returnByValue: true, awaitPromise: true }, sid);
          if (r.exceptionDetails) throw new Error(`frame error: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
          return r.result.value;
        };
        let sid = null;
        for (let i = 0; i < 150 && !sid; i += 1) {
          for (const s of [...attached].reverse()) if (await frameEval(s, 'window.__ready === true').catch(() => false)) { sid = s; break; }
          if (!sid) await sleep(100);
        }
        if (!sid) throw new Error('the sandboxed test module\'s frame did not start in its own process');
        const fev = (expr) => frameEval(sid, expr);
        let btn = null;
        for (let i = 0; i < 50 && !btn; i += 1) {
          btn = await tab.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getClientRects().length && ((x.getAttribute('aria-label') || '').trim() === 'Colour' || x.textContent.trim() === 'Colour')); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
          if (!btn) await sleep(100);
        }
        if (!btn) throw new Error('the frame module\'s toolbar button "Colour" is not on the page');
        // The toolbar row arrives after the frame is drawn and pushes it down. Headless Chromium draws only on demand, so until the
        // page draws again it still sends a press at these points to the frame where it was (a press on "Colour" landed in the
        // module's form). Two animation frames make it draw; a person only presses what is on the screen.
        await tab.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))');
        const box = await tab.eval(`(() => { const f = [...document.querySelectorAll('iframe')].find((x) => x.getClientRects().length && x.getBoundingClientRect().width > 100); const r = f.getBoundingClientRect(); return { l: r.left + f.clientLeft, t: r.top + f.clientTop }; })()`);
        return { fev, box, btn };
      } finally {
        cdp.listeners = cdp.listeners.filter((f) => f !== hook);
      }
    };
    // Opens the frame's picker with one press of its toolbar button.
    const openIn = async (Fr) => {
      await mouse(Fr.btn.x, Fr.btn.y);
      return until(() => Fr.fev(`Boolean(document.querySelector('.sdk-cp'))`), (v) => v === true, 30);
    };
    const until = async (get, test, tries = 60) => { let v; for (let i = 0; i < tries; i += 1) { v = await get().catch(() => undefined); if (test(v)) return v; await sleep(100); } return v; };
    const LABELS = `[...document.querySelectorAll('.sdk-cp [aria-label="Colours"] .sdk-swatch')].map((b) => b.getAttribute('aria-label'))`;
    const at = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`;
    // The module running in the page (cppage), shaped like openFrame's answer: its expressions run in the page with `document` standing
    // for the module's shadow root (then the page's own document, for anything drawn outside it), so the same expressions serve both.
    const openPage = async () => {
      await send('Page.navigate', { url: `${server.base}/modules/cppage` });
      ok(await until(() => tab.eval('window.__ready === true'), (v) => v === true, 150), `${label}: the in-page test module did not start`);
      const btn = await until(() => tab.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getClientRects().length && ((x.getAttribute('aria-label') || '').trim() === 'Colour' || x.textContent.trim() === 'Colour')); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`), (v) => Boolean(v));
      if (!btn) throw new Error('the in-page module\'s toolbar button "Colour" is not on the page');
      await tab.eval('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(1))))');
      const fev = (expr) => tab.eval(`(() => {
        const D = window.document;
        const R = [...D.querySelectorAll('*')].find((e) => e.shadowRoot && e.shadowRoot.getElementById('fld')).shadowRoot;
        const document = { querySelector: (q) => R.querySelector(q) || D.querySelector(q), querySelectorAll: (q) => [...R.querySelectorAll(q), ...D.querySelectorAll(q)], getElementById: (i) => R.getElementById(i), get activeElement() { return R.activeElement || D.activeElement; } };
        return (${expr});
      })()`);
      return { fev, box: { l: 0, t: 0 }, btn };
    };

    // --- in the module running in the page: the 24, "+", a duplicate, the Remove menu, Delete ---
    let P = await openPage();
    await openIn(P);
    const editableNow = await until(() => P.fev(`Boolean(document.querySelector('.sdk-cp .sdk-cp-add'))`), (v) => v === true);
    ok(editableNow, `${label}: in the module in the page the grid shows no "+" (the page did not answer it as editable)`);
    same(await P.fev(`[document.querySelectorAll('.sdk-cp [aria-label="Colours"] .sdk-cp-head').length, ${LABELS}, document.querySelector('.sdk-cp-add').getAttribute('aria-label'), document.querySelector('.sdk-cp-current').draggable]`), [0, NAMES_ALL, 'Add this colour', true],
      `${label}: in the module in the page, before any edit, the grid is the 24 starting colours with no heading, then "+" ("Add this colour"), and the colour showing can be dragged`);
    await P.fev(`(document.querySelector('.sdk-cp-alpha').focus(), 1)`);
    await key(send, 'Home');
    for (let i = 0; i < 6; i += 1) await key(send, 'PageUp');
    same(await P.fev(`document.querySelector('.sdk-cp-alpha').getAttribute('aria-valuenow')`), '60', `${label}: the opacity is set to 60 by its keys`);
    const answersBefore = await P.fev('window.__answers.length');
    let plus = await P.fev(at('.sdk-cp-add'));
    await mouse(P.box.l + plus.x, P.box.t + plus.y);
    const want1 = [...NAMES_ALL.slice(0, 7), '#d62828, 60 percent', ...NAMES_ALL.slice(7)];
    same(await until(() => P.fev(LABELS), (v) => v && v.length === 25), want1, `${label}: "+" adds the colour showing at 60 percent, in its place by the grid's order (after Red)`);
    same(await P.fev(`[Boolean(document.querySelector('.sdk-cp')), window.__answers.length, document.querySelector('.sdk-cp-live').textContent, document.activeElement && document.activeElement.getAttribute('aria-label')]`), [true, answersBefore, 'Added #d62828, 60 percent', 'Add this colour'],
      `${label}: "+" keeps the picker open, picks nothing, says what it added, and keeps the focus on "+"`);
    const see = await P.fev(`(() => { const b = document.querySelector('.sdk-cp .sdk-swatch[aria-label="#d62828, 60 percent"]'); return [b.classList.contains('sdk-cp-see'), /conic-gradient/.test(getComputedStyle(b, '::before').backgroundImage)]; })()`);
    same(see, [true, true], `${label}: a colour below opacity 100 is drawn over the checked ground`);
    same(named(await until(stored, (v) => Array.isArray(v) && v.length === 25)).sort(), [...want1].sort(), `${label}: the add is on the server, the starting colours with it`);
    plus = await P.fev(at('.sdk-cp-add')); // "+" moved along by one
    await mouse(P.box.l + plus.x, P.box.t + plus.y);
    await sleep(200);
    same(await P.fev(`[${LABELS}.length, document.querySelector('.sdk-cp-live').textContent, document.activeElement && document.activeElement.getAttribute('aria-label')]`), [25, 'Already in your colours', '#d62828, 60 percent'],
      `${label}: "+" again does not add the same colour and opacity twice, says so, and puts the focus on it`);
    same((await stored()).length, 25, `${label}: the duplicate is not on the server`);
    // A right-click on Teal: the Remove menu; Remove takes it out.
    const teal = await P.fev(at('.sdk-cp .sdk-swatch[aria-label="Teal"]'));
    await mouse(P.box.l + teal.x, P.box.t + teal.y, 'right');
    const menu = await until(() => P.fev(`[...document.querySelectorAll('.sdk-menu .sdk-menu-item')].map((b) => b.textContent.trim())`), (v) => Array.isArray(v) && v.length > 0);
    same(menu, ['Remove'], `${label}: a right-click on a swatch opens a menu with one row, Remove`);
    ok(await P.fev(`Boolean(document.querySelector('.sdk-cp'))`), `${label}: the Remove menu closed the picker`);
    const rm = await P.fev(at('.sdk-menu .sdk-menu-item'));
    await mouse(P.box.l + rm.x, P.box.t + rm.y);
    const want2 = want1.filter((x) => x !== 'Teal');
    same(await until(() => P.fev(LABELS), (v) => v && v.length === 24), want2, `${label}: Remove takes Teal out`);
    await sleep(100);
    same(await P.fev(`[Boolean(document.querySelector('.sdk-cp')), Boolean(document.querySelector('.sdk-menu')), window.__answers.length, document.querySelector('.sdk-cp-live').textContent]`), [true, false, answersBefore, 'Removed Teal'],
      `${label}: after Remove the menu is gone, the picker is open, nothing was picked, and it says what it removed`);
    same(named(await until(stored, (v) => Array.isArray(v) && v.length === 24)).sort(), [...want2].sort(), `${label}: the remove is on the server`);
    // Shift+F10 on a focused swatch: the Remove menu; Escape closes the menu only, back to the swatch.
    await P.fev(`(document.querySelector('.sdk-cp .sdk-swatch[aria-label="Grey"]').focus(), 1)`);
    await key(send, 'F10', { shift: true });
    const menu2 = await until(() => P.fev(`Boolean(document.querySelector('.sdk-menu'))`), (v) => v === true, 20);
    ok(menu2, `${label}: Shift+F10 on a swatch opened no Remove menu`);
    await key(send, 'Escape');
    await sleep(150);
    same(await P.fev(`[Boolean(document.querySelector('.sdk-menu')), Boolean(document.querySelector('.sdk-cp')), document.activeElement && document.activeElement.getAttribute('aria-label'), ${LABELS}.length]`), [false, true, 'Grey', 24],
      `${label}: Escape in the Remove menu closes the menu only, the focus back on the swatch, nothing removed`);
    // Delete on a focused swatch removes it; the focus goes to the next one.
    await P.fev(`(document.querySelector('.sdk-cp .sdk-swatch[aria-label="Pink"]').focus(), 1)`);
    await key(send, 'Delete');
    const want3 = want2.filter((x) => x !== 'Pink');
    same(await until(() => P.fev(LABELS), (v) => v && v.length === 23), want3, `${label}: Delete takes Pink out`);
    same(await P.fev(`[document.activeElement && document.activeElement.getAttribute('aria-label'), document.querySelector('.sdk-cp-live').textContent, window.__answers.length]`), ['Magenta', 'Removed Pink', answersBefore], `${label}: after Delete the focus is on the next swatch, it says what it removed, and nothing was picked`);
    // Backspace too.
    await P.fev(`(document.querySelector('.sdk-cp .sdk-swatch[aria-label="Grey"]').focus(), 1)`);
    await key(send, 'Backspace');
    const want4 = want3.filter((x) => x !== 'Grey');
    same(await until(() => P.fev(LABELS), (v) => v && v.length === 22), want4, `${label}: Backspace takes Grey out`);
    same(named(await until(stored, (v) => Array.isArray(v) && v.length === 22)).sort(), [...want4].sort(), `${label}: Delete and Backspace are on the server`);
    await key(send, 'Escape');
    same(await until(() => P.fev('window.__answers.at(-1)'), (v) => v === null), null, `${label}: Escape after the edits answers null (the edits stay)`);
    answers.push(null);

    // --- a reload keeps it, and a drag of the colour showing onto the grid adds to it ---
    await send('Page.navigate', { url: `${server.base}/modules/cppage` });
    const ready = await until(() => tab.eval('window.__ready === true'), (v) => v === true, 150);
    ok(ready, `${label}: the in-page test module did not start`);
    const DEEP = (sel) => `(() => { const out = []; const walk = (r) => { for (const e of r.querySelectorAll(${JSON.stringify(sel)})) out.push(e); for (const e of r.querySelectorAll('*')) if (e.shadowRoot) walk(e.shadowRoot); }; walk(document); return out; })()`;
    const DLABELS = `${DEEP('.sdk-cp [aria-label="Colours"] .sdk-swatch')}.map((b) => b.getAttribute('aria-label'))`;
    const dat = (sel) => `(() => { const e = ${DEEP(sel)}[0]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`;
    const pbtn = await until(() => tab.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getClientRects().length && ((x.getAttribute('aria-label') || '').trim() === 'Colour' || x.textContent.trim() === 'Colour')); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`), (v) => Boolean(v));
    await mouse(pbtn.x, pbtn.y);
    same(await until(() => tab.eval(DLABELS), (v) => v && v.length === 22), want4, `${label}: after a reload the module in the page shows the grid as kept`);
    await until(() => tab.eval(`${DEEP('.sdk-cp-add')}.length`), (v) => v === 1);
    await tab.eval(`(() => { const i = ${DEEP('.sdk-cp-hexin')}[0]; i.focus(); i.select(); return 1; })()`);
    await send('Input.insertText', { text: '#123456' });
    await sleep(60);
    const from = await tab.eval(dat('.sdk-cp-current'));
    const to = await tab.eval(dat('.sdk-cp [aria-label="Colours"] .sdk-swatch'));
    let how = 'a real drag (Input.setInterceptDrags)';
    let intercepted = null;
    const dragHook = (m) => { if (m.method === 'Input.dragIntercepted' && m.sessionId === tab.sid) intercepted = m.params.data; };
    cdp.listeners.push(dragHook);
    try {
      await send('Input.setInterceptDrags', { enabled: true });
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
      for (let i = 1; i <= 6; i += 1) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + (to.x - from.x) * i / 6, y: from.y + (to.y - from.y) * i / 6, button: 'left', buttons: 1 });
      for (let i = 0; i < 20 && !intercepted; i += 1) await sleep(50);
      if (intercepted) {
        for (const type of ['dragEnter', 'dragOver', 'drop']) await send('Input.dispatchDragEvent', { type, x: to.x, y: to.y, data: intercepted });
      }
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
      await send('Input.setInterceptDrags', { enabled: false });
    } finally {
      cdp.listeners = cdp.listeners.filter((f) => f !== dragHook);
    }
    if (!intercepted) {
      how = 'drag events made in the page (this Chromium gave no real drag)';
      await tab.eval(`(() => { const c = ${DEEP('.sdk-cp-current')}[0]; const g = ${DEEP('.sdk-cp [aria-label="Colours"]')}[0]; const dt = new DataTransfer(); c.dispatchEvent(new DragEvent('dragstart', { bubbles: true, composed: true, dataTransfer: dt })); for (const t of ['dragenter', 'dragover', 'drop']) g.dispatchEvent(new DragEvent(t, { bubbles: true, composed: true, cancelable: true, dataTransfer: dt })); c.dispatchEvent(new DragEvent('dragend', { bubbles: true, composed: true, dataTransfer: dt })); return 1; })()`);
    }
    note.push(`the grid: the drag onto the grid was ${how}`);
    const want5 = [...want4.slice(0, 19), '#123456', ...want4.slice(19)];
    const afterDrag = await until(() => tab.eval(DLABELS), (v) => v && v.length === 23);
    same(afterDrag && [...afterDrag].sort(), [...want4, '#123456'].sort(), `${label}: a drag of the colour showing onto the grid adds it (${how})`);
    same(await tab.eval(`[${DEEP('.sdk-cp')}.length, window.__answers.length, ${DEEP('.sdk-cp-drop')}.length]`), [1, 0, 0], `${label}: the drop keeps the picker open, picks nothing and leaves no drop mark`);
    same(named(await until(stored, (v) => Array.isArray(v) && v.length === 23)).sort(), [...want4, '#123456'].sort(), `${label}: the drop is on the server`);
    const order5 = afterDrag || [];
    await key(send, 'Escape');
    await sleep(150);
    // A module's own palette: not editable (no "+", no drag, no Remove menu, Delete does nothing).
    await tab.eval(`(window.__mp = window.__host.ui.colorPicker({ at: { x: 10, y: 10 }, palette: [{ heading: 'Inks', colours: [{ name: 'Ink', color: '#1a2b3c' }, { name: 'Paper', color: '#f5eedb' }] }] }), 1)`);
    await sleep(150);
    const mp = await tab.eval(`(() => { const add = ${DEEP('.sdk-cp-add')}.length; const cur = ${DEEP('.sdk-cp-current')}[0].draggable; const b = ${DEEP('.sdk-cp .sdk-swatch')}[0]; b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, composed: true, cancelable: true })); const menu = ${DEEP('.sdk-menu')}.length; b.focus(); b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, composed: true, cancelable: true })); return [add, cur, menu, ${DEEP('.sdk-cp [aria-label="Colours"] .sdk-swatch')}.length]; })()`);
    same(mp, [0, false, 0, 2], `${label}: a module's own palette has no "+", no drag, no Remove menu, and Delete removes nothing`);
    await key(send, 'Escape');
    answers.push(await tab.eval('window.__mp'));

    // --- an uploaded module in its sandboxed frame (decision 28): the same grid, read-only ---
    const gridKept = await stored();
    const recentKept = async () => (await (await fetch(`${server.base}/api/me/color-recent`, { headers: { cookie: jar } })).json()).colors;
    const recentBefore = await recentKept();
    const F = await openFrame();
    await openIn(F);
    same(await until(() => F.fev(LABELS), (v) => v && v.length === 23), order5, `${label}: the sandboxed frame shows the same grid`);
    await sleep(300); // the page's answer is in
    const ro = await F.fev(`(() => {
      const add = Boolean(document.querySelector('.sdk-cp-add'));
      const cur = document.querySelector('.sdk-cp-current');
      const g = document.querySelector('.sdk-cp [aria-label="Colours"]');
      const b = g.querySelector('.sdk-swatch');
      b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      const menu = Boolean(document.querySelector('.sdk-menu'));
      b.focus();
      b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
      const dt = new DataTransfer();
      cur.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      for (const t of ['dragenter', 'dragover', 'drop']) g.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
      cur.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
      return [add, cur.draggable, menu, g.querySelectorAll('.sdk-swatch').length, Boolean(document.querySelector('.sdk-cp'))];
    })()`);
    same(ro, [false, false, false, 23, true], `${label}: in the sandboxed frame the grid has no "+", no drag, no Remove menu, Delete removes nothing and a drop adds nothing`);
    await sleep(200);
    await key(send, 'Escape');
    answers.push(null);
    // The module's own code sending the host calls itself, as the SDK would (the secret is in its frame's address): it reads both lists,
    // answered not editable, and both saves are refused, with nothing sent to the server.
    const RAW = (method, params) => `new Promise((res) => {
      const tk = new URLSearchParams(location.search).get('tk');
      const id = 1000000 + Math.floor(Math.random() * 1000000);
      const on = (e) => { const m = e.data; if (!m || m.host !== 1 || m.id !== id) return; removeEventListener('message', on); res(m.error ? { error: m.error.message, status: m.error.status } : { result: m.result }); };
      addEventListener('message', on);
      parent.postMessage({ host: 1, tk, id, method: ${JSON.stringify(method)}, params: ${JSON.stringify(params)} }, '*');
      setTimeout(() => res('no answer'), 4000);
    })`;
    const g1 = await F.fev(RAW('ui.colorGrid', {}));
    same([g1 && g1.result && g1.result.editable, g1 && g1.result && Array.isArray(g1.result.colors) && g1.result.colors.length], [false, 23], `${label}: from a sandboxed frame ui.colorGrid reads the grid and answers editable: false`);
    const r1 = await F.fev(RAW('ui.colorRecent', {}));
    same(r1 && r1.result && r1.result.editable, false, `${label}: from a sandboxed frame ui.colorRecent answers editable: false`);
    const junk = [{ color: '#010203', opacity: 100 }];
    const gs = await F.fev(RAW('ui.colorGrid.set', { colors: junk }));
    same(gs, { error: "You can't keep your own colours here.", status: 403 }, `${label}: a sandboxed frame's own ui.colorGrid.set is refused`);
    const rs = await F.fev(RAW('ui.colorRecent.set', { colors: junk }));
    same(rs, { error: "You can't keep your own colours here.", status: 403 }, `${label}: a sandboxed frame's own ui.colorRecent.set is refused`);
    await sleep(200);
    same([await stored(), await recentKept()], [gridKept, recentBefore], `${label}: the server's grid and Recent are unchanged by the sandboxed frame`);

    // --- the page's own picker (hostColour, Manage's colour fields): the same grid ---
    await send('Page.navigate', { url: `${server.base}/admin.html` });
    await until(() => tab.eval(`document.readyState === 'complete' && typeof window.hostColour === 'object' && typeof window.createHost === 'function'`), (v) => v === true, 100);
    await sleep(200);
    await tab.eval(`(window.__pp = hostColour.picker({ at: { x: 0, y: 4 } }), 1)`);
    same(await until(() => tab.eval(LABELS), (v) => v && v.length === 23), order5, `${label}: the page's own picker (hostColour, as Manage's colour fields use it) shows the same grid`);
    await key(send, 'Escape');
    answers.push(await tab.eval('window.__pp'));
    // A save the page refuses: the grid goes back and the sentence shows under it (a page host that answers a grid and refuses to save).
    const refused = await tab.eval(`(async () => {
      const h = createHost({ call: (m) => (m === 'hello' ? Promise.resolve({}) : m === 'ui.colorGrid' ? Promise.resolve({ colors: null, editable: true }) : m === 'ui.colorGrid.set' ? Promise.reject(new Error('The grid holds at most 48 colours.')) : Promise.reject(new Error('not here'))), root: document, rootElement: document.documentElement, elementAt: (p) => document.elementFromPoint(p.x, p.y), applyTheme: () => {} }).host;
      await h.ready().catch(() => {});
      window.__rp = h.ui.colorPicker({ at: { x: 0, y: 4 }, value: '#abcdef' });
      for (let i = 0; i < 40 && !document.querySelector('.sdk-cp-add'); i += 1) await new Promise((r) => setTimeout(r, 50));
      document.querySelector('.sdk-cp-add').click();
      const mid = document.querySelectorAll('.sdk-cp [aria-label="Colours"] .sdk-swatch').length;
      await new Promise((r) => setTimeout(r, 200));
      return [mid, document.querySelectorAll('.sdk-cp [aria-label="Colours"] .sdk-swatch').length, document.querySelector('.sdk-cp-grid-error').textContent, Boolean(document.querySelector('.sdk-cp'))];
    })()`);
    same(refused, [25, 24, 'The grid holds at most 48 colours.', true], `${label}: a refused save puts the grid back and shows the sentence under it, the picker open`);
    await key(send, 'Escape');
    answers.push(await tab.eval('window.__rp'));

    // --- at 48 there is no "+" ---
    const full = Array.from({ length: 48 }, (_, i) => ({ color: `#20${(i * 5).toString(16).padStart(2, '0')}40`, opacity: 100 }));
    same((await server_('PUT', { colors: full })).status, 200, `${label}: 48 colours are kept`);
    P = await openPage();
    await openIn(P);
    same(await until(() => P.fev(`[${LABELS}.length, Boolean(document.querySelector('.sdk-cp-add'))]`), (v) => v && v[0] === 48), [48, false], `${label}: at 48 there is no "+"`);
    await key(send, 'Escape');
    answers.push(null);

    // ---- Recent (decision 27): kept on the account through the real route, one list for every module and page ----
    {
      const label = 'Recent';
      const route = async (method, body, { guest = null, cookie = jar } = {}) => {
        const r = await fetch(`${server.base}/api/me/color-recent${guest ? `?guest=${guest}` : ''}`, { method, headers: { ...(cookie ? { cookie } : {}), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: r.status, body: await r.json().catch(() => null) };
      };
      const kept = async () => (await route('GET')).body.colors;
      const e = (color, opacity = 100) => ({ color, opacity });
      const RSEL = (root) => `(() => { if (!${root}.querySelector('.sdk-cp')) return 'no picker open'; const g = ${root}.querySelector('.sdk-cp [aria-label="Recent"]'); return g && !g.hidden ? [...g.querySelectorAll('.sdk-swatch')].map((b) => b.getAttribute('aria-label')) : []; })()`;
      const RLABELS = RSEL('document');
      const shown = (list) => list.map((c) => (c.opacity === 100 && START.find((x) => x.color === c.color)?.name) || (c.opacity < 100 ? `${c.color}, ${c.opacity} percent` : c.color));
      // Choose a colour in a module's picker (the module in the page, or a frame) by typing its hex (and its opacity by the slider's keys), then Enter in the hex field.
      const chooseIn = async (Fr, hex, opacity = 100) => {
        await openIn(Fr);
        await sleep(150);
        if (opacity !== 100) {
          await Fr.fev(`(document.querySelector('.sdk-cp-alpha').focus(), 1)`);
          await key(send, 'Home');
          for (let i = 0; i < opacity / 10; i += 1) await key(send, 'PageUp');
        }
        await Fr.fev(`(() => { const i = document.querySelector('.sdk-cp-hexin'); i.focus(); i.select(); return 1; })()`);
        await send('Input.insertText', { text: hex });
        await sleep(60);
        await key(send, 'Enter');
        const a = await until(() => Fr.fev('window.__answers.at(-1)'), (v) => v && v.color === hex && v.opacity === opacity);
        answers.push(a);
        return a;
      };

      same((await route('PUT', { colors: [] })).status, 200, `${label}: the list is emptied through the route before these cases`);
      P = await openPage();
      await openIn(P);
      await sleep(300);
      same(await P.fev(`[${RLABELS}, Boolean(document.querySelector('.sdk-cp [aria-label="Recent"]')?.hidden)]`), [[], true], `${label}: while it is empty, Recent is not shown`);
      await key(send, 'Escape');
      answers.push(null);
      // Two choices in the module in the page: on the server, newest first, each with its opacity.
      await chooseIn(P, '#d62828');
      same(await until(kept, (v) => Array.isArray(v) && v.length === 1), [e('#d62828')], `${label}: a choice in the module in the page is on the server`);
      await chooseIn(P, '#1e5fd0', 60);
      same(await until(kept, (v) => Array.isArray(v) && v.length === 2), [e('#1e5fd0', 60), e('#d62828')], `${label}: a second choice goes to the front, with its opacity`);
      await openIn(P);
      same(await until(() => P.fev(RLABELS), (v) => v && v.length === 2), ['#1e5fd0, 60 percent', 'Red'], `${label}: the picker shows Recent newest first, named by colour name or hex and percent`);
      // Red again, from Recent itself: to the front, once, at its own opacity.
      const red = await P.fev(`(() => { const b = document.querySelector('.sdk-cp [aria-label="Recent"] .sdk-swatch[aria-label="Red"]'); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await mouse(P.box.l + red.x, P.box.t + red.y);
      same(await until(() => P.fev('window.__answers.at(-1)'), (v) => v && v.color === '#d62828'), e('#d62828'), `${label}: a Recent colour answers its colour and its own opacity`);
      answers.push(e('#d62828'));
      same(await until(kept, (v) => Array.isArray(v) && v[0] && v[0].color === '#d62828'), [e('#d62828'), e('#1e5fd0', 60)], `${label}: a colour chosen again moves to the front and is not there twice`);

      // A reload keeps it.
      P = await openPage();
      await openIn(P);
      same(await until(() => P.fev(RLABELS), (v) => v && v.length === 2), ['Red', '#1e5fd0, 60 percent'], `${label}: after a reload the module in the page shows Recent as kept`);
      await key(send, 'Escape');
      answers.push(null);

      // At most 8: eight on the server, a new choice keeps the newest 8.
      const eight = Array.from({ length: 8 }, (_, i) => e(`#40${(i * 16).toString(16).padStart(2, '0')}20`));
      same((await route('PUT', { colors: eight })).status, 200, `${label}: 8 colours are kept`);
      P = await openPage();
      await openIn(P);
      same(await until(() => P.fev(RLABELS), (v) => v && v.length === 8), shown(eight), `${label}: the module in the page shows all 8`);
      await key(send, 'Escape');
      answers.push(null);
      await chooseIn(P, '#123456');
      const capped = await until(kept, (v) => Array.isArray(v) && v[0] && v[0].color === '#123456');
      same(capped, [e('#123456'), ...eight.slice(0, 7)], `${label}: a ninth choice keeps the newest 8, the oldest dropped`);

      // An uploaded module in its sandboxed frame (decision 28) and the page's own picker (hostColour, as Manage's colour fields use
      // it): the same Recent. In the frame it is read-only: no "+" in the picker, no Remove menu on a Recent colour, and a choice there
      // answers normally but does not change Recent.
      const want = shown(capped || []);
      const Fm = await openFrame();
      await openIn(Fm);
      same(await until(() => Fm.fev(RLABELS), (v) => v && v.length === 8), want, `${label}: the sandboxed frame shows the same Recent`);
      await sleep(200);
      const rro = await Fm.fev(`(() => {
        const b = document.querySelector('.sdk-cp [aria-label="Recent"] .sdk-swatch');
        b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        const menu = Boolean(document.querySelector('.sdk-menu'));
        b.focus();
        b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
        return [Boolean(document.querySelector('.sdk-cp-add')), menu, document.querySelectorAll('.sdk-cp [aria-label="Recent"] .sdk-swatch').length];
      })()`);
      same(rro, [false, false, 8], `${label}: in the sandboxed frame the picker has no "+", and Recent no Remove menu, and Delete removes nothing`);
      await key(send, 'Escape');
      answers.push(null);
      await chooseIn(Fm, '#abcdef');
      await sleep(500);
      same(await kept(), capped, `${label}: a choice in the sandboxed frame answers normally and does not change Recent on the server`);
      same(await Fm.fev(`[...document.querySelectorAll('.sdk-error')].map((x) => x.textContent).filter(Boolean)`), [], `${label}: the choice in the sandboxed frame shows no error`);
      await openIn(Fm);
      same(await until(() => Fm.fev(RLABELS), (v) => v && v.length === 8), want, `${label}: the sandboxed frame's next picker shows Recent unchanged`);
      await key(send, 'Escape');
      answers.push(null);
      await send('Page.navigate', { url: `${server.base}/admin.html` });
      await until(() => tab.eval(`document.readyState === 'complete' && typeof window.hostColour === 'object'`), (v) => v === true, 100);
      await sleep(200);
      await tab.eval(`(window.__pp = hostColour.picker({ at: { x: 0, y: 4 } }), 1)`);
      same(await until(() => tab.eval(RLABELS), (v) => v && v.length === 8), want, `${label}: the page's own picker (hostColour) shows the same Recent`);
      await key(send, 'Escape');
      answers.push(await tab.eval('window.__pp'));

      // A guest and no session: the real route refuses (403, 401), and the page's picker shows no Recent and sends nothing.
      const sp = await fetch(`${server.base}/api/spaces`, { method: 'POST', headers: { cookie: jar, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Recent door' }) }).then((r) => r.json());
      const link = (await fetch(`${server.base}/api/spaces/${sp.space.id}/guest-link`, { method: 'POST', headers: { cookie: jar, 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json())).space.guestToken;
      same([(await route('GET', undefined, { guest: link, cookie: null })).status, (await route('GET', undefined, { cookie: null })).status], [403, 401], `${label}: the route refuses a guest (403) and no session (401)`);
      for (const [who, swap] of [['a guest', `'/api/me/color-recent?guest=${link}'`], ['no session', `'/api/me/color-recent'`]]) {
        await send('Page.navigate', { url: `${server.base}/admin.html` });
        await until(() => tab.eval(`document.readyState === 'complete' && typeof window.hostColour === 'object'`), (v) => v === true, 100);
        await sleep(200);
        // This page's own fetch of the route goes as that person: no cookie, and the guest link's token for a guest.
        await tab.eval(`(() => { const f = window.fetch; window.__rsent = 0; window.fetch = (u, o = {}) => String(u).startsWith('/api/me/color-recent') ? (o.method === 'PUT' && (window.__rsent += 1), f(${swap}, { ...o, credentials: 'omit' })) : f(u, o); return 1; })()`);
        await tab.eval(`(window.__pp = hostColour.picker({ at: { x: 0, y: 4 }, value: '#abcdef' }), 1)`);
        await sleep(400);
        same(await tab.eval(`[${RLABELS}, Boolean(document.querySelector('.sdk-cp'))]`), [[], true], `${label}: ${who} sees no Recent`);
        await key(send, 'Enter');
        await sleep(300);
        answers.push(await tab.eval('window.__pp'));
        same(await tab.eval('window.__rsent'), 0, `${label}: ${who}'s choice sends no Recent`);
      }
      same(await kept(), capped, `${label}: the account's list is unchanged by them`);
    }
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
      const until = async (expr, tries = 40) => { for (let i = 0; i < tries; i += 1) { if (await fev(expr).catch(() => false)) return true; await sleep(100); } return false; };
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
      // The first press can be lost under load (the page or the frame is still settling). Wait up to 8s for the picker; if the module
      // never saw the press (its click count did not move), press once more and wait 8s again. A press the module did see is not
      // repeated (a second one would close the picker). The failure line says what happened.
      const under = async () => tab.eval(`(() => { const e = document.elementFromPoint(${btn.x}, ${btn.y}); return e ? e.tagName.toLowerCase() + '.' + String(e.className).slice(0, 60) + ' "' + (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30) + '"' : 'nothing'; })()`).catch(() => 'unreadable');
      const story = [];
      let opened = false;
      for (let attempt = 1; attempt <= 2 && !opened; attempt += 1) {
        const clicksBefore = await fev('window.__clicks').catch(() => null);
        const landed = await under();
        await press(send, coarse, btn.x, btn.y);
        opened = await until(PICKER, 80);
        const clicksAfter = await fev('window.__clicks').catch(() => null);
        story.push(`press ${attempt} at ${Math.round(btn.x)},${Math.round(btn.y)} landed on ${landed}; the module counted ${clicksAfter} click(s) (${clicksBefore} before); picker ${opened ? 'open' : 'not open'} after 8s`);
        if (!opened && clicksAfter !== null && clicksAfter !== clicksBefore) break; // the module saw it: pressing again would only toggle
      }
      const pos = await fev(`(() => { const p = document.querySelector('.sdk-cp'); if (!p) return null; const r = p.getBoundingClientRect(); const a = document.activeElement; return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight, x: window.__tbx, focus: a && a.getAttribute('aria-label') }; })()`).catch(() => null);
      if (!pos) {
        ok(false, `${label}: the toolbar button opened no picker in the module's frame: ${story.join('; ')}; the module's last x was ${JSON.stringify(await fev('window.__tbx').catch(() => 'unreadable'))}`);
      }
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
      // Two toolbar buttons: the first opens its picker, the second then opens its own; the new one has keyboard focus and Escape closes it.
      if (pos) {
        const btn2 = await (async () => {
          for (let i = 0; i < 30; i += 1) {
            const b = await tab.eval(`(() => { const b = [...document.querySelectorAll('button')].find((x) => x.getClientRects().length && ((x.getAttribute('aria-label') || '').trim() === 'Shade' || x.textContent.trim() === 'Shade')); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
            if (b) return b;
            await sleep(100);
          }
          return null;
        })();
        if (!btn2) ok(false, `${label}: two toolbar buttons: the module's second button "Shade" is not on the page`);
        else {
          const picked = () => fev(`(() => { const all = document.querySelectorAll('.sdk-cp'); const p = all[0]; if (!p) return null; const a = document.activeElement; return { count: all.length, name: p.getAttribute('aria-label'), focusInside: p.contains(a), focus: a ? (a.getAttribute('aria-label') || a.className || a.tagName) : 'nothing' }; })()`).catch(() => null);
          const nBefore = await fev('window.__answers.length');
          await press(send, coarse, btn.x, btn.y);
          const first = await until('document.querySelector(".sdk-cp") && document.querySelector(".sdk-cp").getAttribute("aria-label") === "Colour"', 80);
          ok(first, `${label}: two toolbar buttons: button 1 opened no picker (${JSON.stringify(await picked())})`);
          await press(send, coarse, btn2.x, btn2.y);
          await until('document.querySelector(".sdk-cp") && document.querySelector(".sdk-cp").getAttribute("aria-label") === "Shade"', 80);
          await sleep(150);
          const second = await picked();
          same(second, second ? { count: 1, name: 'Shade', focusInside: true, focus: second.focus } : 'an open picker', `${label}: two toolbar buttons: after button 1 then button 2, one picker is open, it is the second's ("Shade"), and keyboard focus is inside it (got ${JSON.stringify(second)})`);
          await key(send, 'Escape');
          await until('!document.querySelector(".sdk-cp")', 30);
          await sleep(100);
          same(await fev('[Boolean(document.querySelector(".sdk-cp")), window.__answers.length - ' + nBefore + ', window.__answers.at(-1)]'), [false, 2, null], `${label}: two toolbar buttons: Escape closes the second picker (answers: the first closed with null, then the second with null)`);
          answers.push(null);
        }
      }
      // A colour field in the module's form.
      const tr = await fev(`(() => { const t = document.querySelector('.sdk-picker'); const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, name: t.getAttribute('aria-label') }; })()`);
      same(tr.name, 'Fill, Blue, #1e5fd0. Change it', `${label}: in the frame the field's trigger is named by its <label>`);
      await press(send, coarse, frameBox.l + tr.x, frameBox.t + tr.y);
      await until(PICKER);
      await sleep(200); // the grid as the page has it
      const sw = await fev(`(() => { const b = document.querySelector('.sdk-cp .sdk-swatch[aria-label="Orange"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      ok(Boolean(sw), `${label}: the field's trigger opened no picker in the frame`);
      if (sw) {
        await press(send, coarse, frameBox.l + sw.x, frameBox.t + sw.y);
        await until(NO_PICKER);
        await until('window.__events.length === 3');
        same(await fev(`[document.getElementById('fld').value, window.__events]`), ['#f28c28', ['input', 'change', { color: '#f28c28', opacity: 100 }]], `${label}: in the frame a choice sets the field's input, sends input then change, and onChange`);
        answers.push({ color: '#f28c28', opacity: 100 });
      }
      answers.push(...(await fev('window.__answers')));
    } finally {
      cdp.listeners = cdp.listeners.filter((f) => f !== hook);
    }
  }
}

