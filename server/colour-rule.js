'use strict';
// The colour rule (documentation/plans/plan-design-system.md, (e); plan-agent-server-actions.md, section 9): colours come from
// tokens. A hard-coded colour is a #hex, an rgb()/rgba()/hsl()/hsla()/hwb()/lab()/lch()/oklab()/oklch() with no var() inside,
// or a named colour (red, gold ...; not transparent, currentColor or inherit; named colours are only read in colour
// properties and in custom properties). Pure: a declaration in, the colours it hard-codes out. Black and white used as a
// shadow or a scrim are told apart ("shadow-scrim"): pure black or white in a shadow or filter property, or with an alpha below
// 1, or as the mixing colour inside color-mix(). Anything else, including an opaque black or white text colour, is "raw".
// The module check (server/module-check.js) and tools/check-no-raw-colours.mjs both use it; what each leaves out (token
// blocks, allow-lists, one module's own palette) is the caller's.
const { declarations } = require('./css-reading');

const NAMED = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen').split(' '));
const COLOUR_PROP = /^(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-color)?|outline(?:-color)?|box-shadow|text-shadow|text-decoration(?:-color)?|text-emphasis(?:-color)?|-webkit-text-stroke(?:-color)?|-webkit-text-fill-color|-webkit-tap-highlight-color|fill|stroke|stop-color|flood-color|lighting-color|caret-color|accent-color|column-rule(?:-color)?|scrollbar-color|filter|backdrop-filter|mask-image)$/;
const COLOUR_CUSTOM = /colou?r|bg|background|fill|stroke|border|shadow|accent|text|ink|tint|surface|scrim|overlay|glow|edge|line|dot/i;
const FUNC = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/gi;

// Take url(...) and quoted strings out of a value (kept the same length), so a "#fff" in a data URI or a content string is not read.
function plain(value) {
  return value
    .replace(/url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\)/gi, (m) => ' '.repeat(m.length))
    .replace(/(["'])(?:(?!\1).)*\1/g, (m) => ' '.repeat(m.length));
}

// Index of the ")" that closes the "(" at `open`, or -1.
function closeOf(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i += 1) {
    if (s[i] === '(') depth += 1;
    else if (s[i] === ')' && (depth -= 1) === 0) return i;
  }
  return -1;
}

// The colours in a value: [{ text, index, kind: 'hex' | 'func' | 'named' }].
function coloursIn(value, named) {
  const out = [];
  for (const m of value.matchAll(/(?<![\w&#/])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![\w-])/gi)) out.push({ text: m[0], index: m.index, kind: 'hex' });
  for (const m of value.matchAll(FUNC)) {
    const open = m.index + m[0].length - 1;
    const close = closeOf(value, open);
    if (close === -1) continue;
    const text = value.slice(m.index, close + 1);
    if (/\bvar\(/.test(text)) continue; // built from a token
    out.push({ text, index: m.index, kind: 'func' });
  }
  if (named) {
    for (const m of value.matchAll(/(?<![\w-])[a-z]+(?![\w-])/gi)) {
      if (NAMED.has(m[0].toLowerCase())) out.push({ text: m[0], index: m.index, kind: 'named' });
    }
  }
  return out;
}

// Pure black or white, with its alpha: { alpha } or null.
function blackOrWhite(c) {
  const t = c.text.toLowerCase().replace(/\s+/g, '');
  if (c.kind === 'named') return t === 'black' || t === 'white' ? { alpha: 1 } : null;
  if (c.kind === 'hex') {
    const h = t.slice(1);
    const full = h.length <= 4 ? [...h].map((x) => x + x).join('') : h;
    const rgb = full.slice(0, 6);
    if (rgb !== '000000' && rgb !== 'ffffff') return null;
    return { alpha: full.length === 8 ? parseInt(full.slice(6), 16) / 255 : 1 };
  }
  const m = /^(?:rgba?)\((\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)(?:[ ,/]+(\d*\.?\d+)(%?))?\)$/.exec(t);
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map(Number);
  if (!((r === 0 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 255))) return null;
  return { alpha: m[4] === undefined ? 1 : Number(m[4]) / (m[5] ? 100 : 1) };
}

// The hard-coded colours of one declaration { prop, value }: [{ text, index, kind: 'raw' | 'shadow-scrim' (the rest as coloursIn) }].
// `skip(colour, value)`, when given, says a colour is not read (the caller's own exemption).
function coloursOfDeclaration(d, skip = null) {
  const out = [];
  if (d.prop === 'value' || d.prop === 'css-text') return out; // an input's value; cssText is read as the declarations inside it
  const value = plain(d.value);
  const named = COLOUR_PROP.test(d.prop) || (d.prop.startsWith('--') && COLOUR_CUSTOM.test(d.prop));
  // Spans of color-mix(...) so the white or black it mixes toward can be told.
  const mixes = [];
  for (const m of value.matchAll(/color-mix\(/gi)) mixes.push([m.index, closeOf(value, m.index + m[0].length - 1)]);
  for (const c of coloursIn(value, named)) {
    if (skip && skip(c, value)) continue;
    const bw = blackOrWhite(c);
    const inMix = mixes.some(([a, b]) => c.index > a && c.index < b);
    const shadowProp = /shadow|filter/.test(d.prop);
    const scrim = bw && (shadowProp || bw.alpha < 1 || inMix);
    out.push({ text: c.text, index: c.index, colour: c.kind, kind: scrim ? 'shadow-scrim' : 'raw' });
  }
  return out;
}

// The hard-coded colours of a file { kind: 'css' | 'js' | 'html', text } as css-reading reads it (an html page is read as a
// script is: every `prop: value` and `prop="value"` in it): [{ line, text, kind, prop }]. `o.skipDeclaration(d)` leaves a
// declaration out; `o.skip(file, d, colour, value)` leaves one colour out.
function coloursInFile(file, o = {}) {
  const out = [];
  for (const d of declarations(file)) {
    if (o.skipDeclaration && o.skipDeclaration(d)) continue;
    for (const c of coloursOfDeclaration(d, o.skip ? (col, value) => o.skip(file, d, col, value) : null)) out.push({ line: d.line, text: c.text, kind: c.kind, prop: d.prop });
  }
  return out;
}

module.exports = { coloursOfDeclaration, coloursInFile, plain, closeOf, coloursIn, blackOrWhite };
