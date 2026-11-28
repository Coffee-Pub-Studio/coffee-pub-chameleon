#!/usr/bin/env node
/*
 * check-burndown.mjs -- the shared burndown piece of the SDK (documentation/plans/plan-projects-sizing-burndown.md, "The shared piece"):
 * host.ui.burndown (public/sdk/host.js; its rules are the "burndown" block of public/sdk/system.css).
 *
 *   1. Node only: the pure parts, sliced out of public/sdk/host.js between its "burndown:start" and "burndown:end" markers: a day as a
 *      number, the options made safe (nothing to draw is null; from after to is refused; a left above the total is the total; points
 *      before from are carried to it and points after to are not drawn; bands clipped to the range, one outside it not drawn), and the
 *      layout at a width (the day scale, the step points of a line, one point, a line that never reaches 0, a chart under 0, the dots,
 *      Today, the heights). Read as code: the piece sets no HTML, writes nothing, and its styles hold no colour literal.
 *   2. Chromium (SKIPPED, said so, when there is none; it is not a pass), at 1280 and 390 wide, light and dark: the real /sdk/host.js,
 *      system.css and host.css on a fixture page served here. The chart draws its two lines, the bands, Today and the legend; the words
 *      are the chart's accessible name (read from the browser's accessibility tree) and are heard once; both lines are the theme's accent
 *      token and are told apart by their dash and weight; it draws again at a new width; no sideways scroll; set() with nothing to draw
 *      shows the empty line; from after to is refused and leaves the chart as it was; destroy() stops its observer and takes out what it
 *      drew. Set SHOTS=<folder> to keep a screenshot of each screen.
 * Usage: node tools/check-burndown.mjs. Browser: CHROME_PATH, else a Playwright or system Chromium.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBrowser, launch } from './shots.mjs';
import { stopBrowser } from './browser-launch.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const say = (...a) => console.log('check-burndown:', ...a);
let n = 0;
const problems = [];
const ok = (cond, msg) => { n += 1; if (!cond) problems.push(msg); };
const same = (a, b, msg) => { n += 1; try { assert.deepEqual(a, b); } catch { problems.push(`${msg}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); } };
const near = (a, b, msg) => { n += 1; if (!(Math.abs(a - b) < 1e-6)) problems.push(`${msg}: got ${a}, wanted ${b}`); };

const sdk = read('public/sdk/host.js');
const css = read('public/sdk/system.css');

// === 1. Node =============================================================================================================
const from = sdk.indexOf('// burndown:start');
const to = sdk.indexOf('// burndown:end');
ok(from > 0 && to > from, 'public/sdk/host.js has its burndown:start and burndown:end markers');
const P = new Function(`${sdk.slice(from, to)}\nreturn { burndownDayNum, burndownDayWords, burndownData, burndownLayout };`)();
const nums = (d) => d.split(' ').filter((t) => /^-?[\d.]+$/.test(t)).map(Number);
{
  // a day as a number
  same([P.burndownDayNum('2026-02-30'), P.burndownDayNum('2026-1-01'), P.burndownDayNum(''), P.burndownDayNum(null)].map(Number.isNaN), [true, true, true, true], 'a day that is not real is NaN');
  same(P.burndownDayNum('2026-03-01') - P.burndownDayNum('2026-02-28'), 1, 'days count across a month end');
  same(P.burndownDayNum('2026-03-30') - P.burndownDayNum('2026-03-28'), 2, 'days count across a clock change');
  ok(/Nov/.test(P.burndownDayWords('2026-11-03', 2026)) && !/2026/.test(P.burndownDayWords('2026-11-03', 2026)) && /2025/.test(P.burndownDayWords('2025-11-03', 2026)), 'a day in words has the year only when it is not this year');

  const base = { total: 100, from: '2026-11-01', to: '2026-11-11' };
  const one = (points, extra) => P.burndownData({ ...base, series: [{ id: 'a', label: 'A', points }], ...extra });
  // nothing to draw
  same(P.burndownData(null), null, 'no options is nothing to draw');
  same(P.burndownData({ ...base, total: 0, series: [{ id: 'a', points: [{ day: '2026-11-01', left: 1 }] }] }), null, 'a total of 0 is nothing to draw');
  same(P.burndownData({ ...base, total: '100', series: [{ id: 'a', points: [{ day: '2026-11-01', left: 1 }] }] }), null, 'a total that is not a number is nothing to draw');
  same(P.burndownData({ ...base, from: undefined, series: [{ id: 'a', points: [{ day: '2026-11-01', left: 1 }] }] }), null, 'no from is nothing to draw');
  same(P.burndownData({ ...base, series: [] }), null, 'no series is nothing to draw');
  same(P.burndownData({ ...base }), null, 'series missing is nothing to draw');
  same(one([]), null, 'a series with no points is nothing to draw');
  same(one([{ day: '2026-11-20', left: 50 }]), null, 'a series whose points are all after to is nothing to draw');
  same(one([{ day: '2026-11-02', left: '5' }, { day: 'soon', left: 5 }, null]), null, 'points with no number or no real day are dropped');
  // from after to
  let threw = null;
  try { P.burndownData({ ...base, from: '2026-11-12', to: '2026-11-11' }); } catch (err) { threw = err; }
  ok(threw instanceof RangeError, 'from after to is refused with a RangeError');
  ok(P.burndownData({ ...base, from: '2026-11-11', series: [{ id: 'a', points: [{ day: '2026-11-11', left: 3 }] }] }) !== null, 'from on the same day as to draws');
  // series made safe
  {
    const d = P.burndownData({ ...base, series: [{ id: 'a', label: ' Done ', points: [{ day: '2026-11-01', left: 100 }] }, { id: 'a', points: [{ day: '2026-11-01', left: 1 }] }, { id: '', points: [{ day: '2026-11-01', left: 1 }] }, { id: 'b', kind: 'dotted', points: [{ day: '2026-11-01', left: 1 }] }, { id: 'c', kind: 'dashed', label: '  ', points: [{ day: '2026-11-01', left: 1 }] }] });
    same(d.series.map((s) => [s.id, s.label, s.kind]), [['a', 'Done', 'solid'], ['b', 'b', 'solid'], ['c', 'c', 'dashed']], 'series: a repeated or empty id is dropped, a label falls back to the id, a kind is solid unless dashed');
  }
  // clipping and clamping
  {
    const d = one([{ day: '2026-11-05', left: 60 }, { day: '2026-10-20', left: 120 }, { day: '2026-10-25', left: 90 }, { day: '2026-11-15', left: 0 }]);
    same(d.series[0].points.map((p) => [p.day, p.left]), [['2026-11-01', 90], ['2026-11-05', 60]], 'points before from are carried to from as the last of them, points after to are not drawn, and points are sorted by day');
    const d2 = one([{ day: '2026-10-25', left: 90 }, { day: '2026-11-01', left: 80 }]);
    same(d2.series[0].points.map((p) => [p.day, p.left]), [['2026-11-01', 80]], 'a point on from wins over the points before it');
    const d3 = one([{ day: '2026-11-01', left: 250 }, { day: '2026-11-03', left: 140 }, { day: '2026-11-04', left: 70 }]);
    same(d3.series[0].points.map((p) => p.left), [100, 100, 70], 'a left above the total is drawn at the total');
    same(d3.low, 0, 'a chart that stays above 0 has 0 as its floor');
    const d4 = one([{ day: '2026-11-01', left: 100 }, { day: '2026-11-04', left: -25 }]);
    same(d4.low, -25, 'a left under 0 lowers the floor');
  }
  // bands
  {
    const bands = [
      { label: 'Before', color: '#112233', start: '2026-10-01', end: '2026-10-20', dated: true },
      { label: 'Over the start', color: '#112233', start: '2026-10-25', end: '2026-11-03', dated: true },
      { label: 'Inside', color: 'red', start: '2026-11-04', end: '2026-11-06', dated: true },
      { label: 'No end', color: '#abcdef', start: '2026-11-07', dated: true },
      { label: 'After', color: '#112233', start: '2026-11-12', end: '2026-11-20', dated: true },
      { label: 'Undated', color: '#112233', start: '2026-11-02', end: '2026-11-03', dated: false },
      { label: 'No start', color: '#112233', end: '2026-11-03', dated: true },
      null,
    ];
    const d = one([{ day: '2026-11-01', left: 100 }], { bands });
    same(d.bands.map((b) => [b.label, b.color, b.n1 - b.n0]), [['Over the start', '#112233', 2], ['Inside', '', 2], ['No end', '#abcdef', 4]], 'bands: one outside the range or not dated is not drawn, one over an edge is clipped, no end runs to to, a colour that is not #rrggbb is none');
    same(d.bands[0].n0, P.burndownDayNum('2026-11-01'), 'a band over the start begins at from');
  }
  // the layout: W 1068 gives a plot 1000 wide (56 left, 12 right), so a day is 100 px; 230 tall gives 192 for 100
  {
    const d = one([{ day: '2026-11-01', left: 100 }, { day: '2026-11-03', left: 60 }, { day: '2026-11-06', left: 20 }], { bands: [{ label: 'Go', color: '#112233', start: '2026-11-02', end: '2026-11-04', dated: true }, { label: 'A long phase name', start: '2026-11-08', end: '2026-11-08', dated: true }] });
    const L = P.burndownLayout(d, 1068, P.burndownDayNum('2026-11-04'));
    same([L.W, L.H, L.left, L.right, L.top, L.bottom], [1068, 230, 56, 1056, 12, 204], 'the frame at 1068 wide');
    const y = (v) => 12 + ((100 - v) / 100) * 192;
    const want = [56, y(100), 256, y(60), 556, y(20), 1056];
    const got = nums(L.lines[0].d);
    same(got.length, want.length, 'a step line has a point for each step');
    want.forEach((w, i) => near(got[i], w, `step point ${i}`));
    ok(/^M [\d.]+ [\d.]+ H [\d.]+ V [\d.]+ H [\d.]+ V [\d.]+ H [\d.]+$/.test(L.lines[0].d), `a step line is flat, then straight down, and flat to the right edge (${L.lines[0].d})`);
    same(L.lines[0].dots.map((p) => [Math.round(p.cx), p.day, p.left]), [[256, '2026-11-03', 60], [556, '2026-11-06', 20]], 'a solid line has a dot on each step after its first point');
    same(L.marks.map((m) => [m.v, m.zero]), [[100, false], [50, false], [0, false]], 'the guides are the total, its half and 0');
    near(L.marks[1].y, 108, 'the half guide is in the middle');
    near(L.today.x, 356, 'Today is on its day');
    same([Math.round(L.bands[0].x), Math.round(L.bands[0].w), L.bands[0].showLabel], [156, 200, true], 'a band spans its days, and its label shows when it fits');
    same([Math.round(L.bands[1].w), L.bands[1].showLabel], [2, false], 'a one-day band is at least 2 px, with no label when it does not fit');
    same(P.burndownLayout(d, 1068, P.burndownDayNum('2026-11-01')).today, null, 'Today on from is not drawn');
    same(P.burndownLayout(d, 1068, P.burndownDayNum('2026-12-01')).today, null, 'Today after to is not drawn');
    same(P.burndownLayout(d, 1068, NaN).today, null, 'no today draws no Today');
    same([P.burndownLayout(d, 399, NaN).H, P.burndownLayout(d, 400, NaN).H, P.burndownLayout(d, 100, NaN).W, P.burndownLayout(d, 0, NaN).W], [190, 230, 240, 320], 'under 400 px it is 190 tall; never under 240 wide; a box with no width draws at 320');
    const dash = P.burndownLayout(P.burndownData({ ...base, series: [{ id: 'p', kind: 'dashed', points: [{ day: '2026-11-01', left: 100 }, { day: '2026-11-05', left: 10 }] }] }), 1068, NaN);
    same(dash.lines[0].dots, [], 'a dashed line has no dots');
  }
  {
    const L = P.burndownLayout(one([{ day: '2026-11-04', left: 40 }]), 1068, NaN);
    const got = nums(L.lines[0].d);
    same(got.length, 3, 'one point is a move and a flat line');
    near(got[0], 356, 'one point starts on its day');
    near(got[2], 1056, 'one point runs flat to the right edge');
  }
  {
    const L = P.burndownLayout(one([{ day: '2026-11-01', left: 100 }, { day: '2026-11-05', left: 30 }]), 1068, NaN);
    near(nums(L.lines[0].d).pop(), 1056, 'a line that never reaches 0 runs flat at what is left to the right edge');
    near(nums(L.lines[0].d)[3], 12 + 0.7 * 192, 'and stays above the 0 guide');
  }
  {
    const L = P.burndownLayout(one([{ day: '2026-11-01', left: 100 }, { day: '2026-11-04', left: -25 }]), 1068, NaN);
    same(L.marks.map((m) => [m.v, m.zero]), [[100, false], [50, false], [0, true], [-25, false]], 'under 0: the 0 guide is the zero line and the lowest point is a guide');
    near(L.marks[3].y, 204, 'the lowest point is the bottom of the plot');
  }
  // read as code
  const piece = sdk.slice(sdk.indexOf('// ---- host.ui.burndown'), sdk.indexOf('// env: { call(method'));
  ok(piece.length > 1000, 'the burndown piece is found in host.js');
  ok(!/innerHTML|insertAdjacentHTML|outerHTML|document\.write/.test(piece), 'the burndown sets no HTML');
  ok(!/\.(storage|actions|call)\b|host\.call|fetch\(|postMessage|window\.parent|window\.top/.test(piece), 'the burndown writes nothing and asks the host for nothing');
  ok(!/#[0-9a-fA-F]{3,8}\b(?!['"]?\)?\.test)|rgba?\(|hsla?\(/.test(piece.replace(/\/\^#\[0-9a-fA-F\]\{6\}\$\//g, '')), 'the burndown script holds no colour literal');
  ok(/burndown: \(el, o\) => createBurndown\(el, o\)/.test(sdk), 'host.ui.burndown is registered');
  const block = css.slice(css.indexOf('/* burndown:start */'), css.indexOf('/* burndown:end */'));
  ok(block.length > 200, 'system.css has its burndown block');
  ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(block), 'the burndown styles hold no colour literal');
  for (const cls of ['band', 'grid', 'zero', 'axis', 'today', 'line', 'dot', 'legend', 'key', 'swatch', 'words', 'chart']) ok(block.includes(`.sdk-burndown-${cls}`), `the burndown styles have .sdk-burndown-${cls}`);
}

// === 2. Chromium =========================================================================================================
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
const PUBLIC = path.join(ROOT, 'public');
const WORDS = 'Left, from three weeks ago to three weeks ahead. 40 to start; 22 left after what is done.';
const pageHtml = (q) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/design-system/themes/chameleon.css"><link rel="stylesheet" href="/sdk/system.css"><link rel="stylesheet" href="/sdk/host.css">
<script data-host-sdk src="/sdk/host.js"></script>
<style>html,body{margin:0;background:var(--surface-page);color:var(--text-primary);font:14px system-ui,sans-serif}#wrap{padding:12px}</style></head>
<body><div id="wrap"><div id="bn"></div><span id="probe" style="color:var(--accent-fill)">x</span></div>
<script>
document.documentElement.dataset.themeMode = ${JSON.stringify(q.get('mode') || 'light')};
const answer = async (m) => (m === 'hello' ? { locale: { language: 'en', clock: '12', currency: 'USD', currencies: ['USD'] } } : {});
// count the observers the piece makes and lets go of
const RO = window.ResizeObserver;
window.__ro = { made: 0, gone: 0 };
window.ResizeObserver = class extends RO { constructor(f) { super(f); window.__ro.made += 1; } disconnect() { window.__ro.gone += 1; super.disconnect(); } };
const dayOf = (k) => { const d = new Date(); d.setDate(d.getDate() + k); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
window.__ready = (async () => {
  const { host } = window.createHost({ call: answer, root: document, rootElement: document.body });
  try { await host.ready(); } catch (e) { /* the stand-in answers enough */ }
  const T = window.T = { host };
  T.opts = {
    total: 40, from: dayOf(-21), to: dayOf(21), format: (n) => n + ' pts',
    series: [
      { id: 'done', label: 'Done', kind: 'solid', points: [{ day: dayOf(-21), left: 40 }, { day: dayOf(-14), left: 34 }, { day: dayOf(-9), left: 27 }, { day: dayOf(-3), left: 22 }] },
      { id: 'planned', label: 'Planned', kind: 'dashed', points: [{ day: dayOf(-21), left: 40 }, { day: dayOf(-12), left: 30 }, { day: dayOf(0), left: 21 }, { day: dayOf(10), left: 8 }] }],
    bands: [
      { label: 'Planning', color: '#4f7cc4', start: dayOf(-30), end: dayOf(-8), dated: true },
      { label: 'Building', color: '#3f9a6b', start: dayOf(-7), end: dayOf(12), dated: true },
      { label: 'Launch', start: dayOf(13), dated: true },
      { label: 'Later', color: '#c4734f', start: dayOf(40), dated: true }],
    words: ${JSON.stringify(WORDS)}, empty: 'Nothing to count down yet.' };
  T.chart = host.ui.burndown(document.getElementById('bn'), T.opts);
  return 'ready';
})();
</script></body></html>`;

async function chromium() {
  const bin = process.env.BURNDOWN_NODE_ONLY ? null : findBrowser();
  if (!bin) { say('Chromium: SKIPPED. No Chromium found (set CHROME_PATH, or install one: npx playwright install chromium). This is not a pass; nothing was drawn.'); return; }
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/__burndown') { res.writeHead(200, { 'content-type': MIME['.html'] }); res.end(pageHtml(u.searchParams)); return; }
    const file = path.normalize(path.join(PUBLIC, decodeURIComponent(u.pathname)));
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser = null;
  const shots = process.env.SHOTS;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  try {
    browser = await launch(bin);
    const { cdp } = browser;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const accents = [];
    for (const mode of ['light', 'dark']) for (const width of [1280, 390]) {
      const tag = `${width} ${mode}`;
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      const s = (m, p) => cdp.send(m, p, sessionId);
      const errors = [];
      try {
        await s('Page.enable'); await s('Runtime.enable'); await s('Accessibility.enable');
        const onError = (m) => { if (m.method === 'Runtime.exceptionThrown' && m.sessionId === sessionId) errors.push(m.params?.exceptionDetails?.exception?.description || 'an error'); };
        cdp.listeners.push(onError);
        await s('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
        await s('Page.navigate', { url: `${base}/__burndown?mode=${mode}` });
        const ev = async (expr) => {
          const r = await s('Runtime.evaluate', { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) throw new Error('page error: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
          return r.result.value;
        };
        for (let i = 0; i < 100; i += 1) { if (await ev('document.readyState').catch(() => '') === 'complete') break; await sleep(100); }
        same(await ev('window.__ready'), 'ready', `${tag}: the fixture started`);
        await ev('document.fonts.ready.then(() => 1)');
        await sleep(150);
        // --- draws ---
        const shape = await ev(`(() => {
          const el = document.getElementById('bn'); const svg = el.querySelector('svg');
          return { cls: el.classList.contains('sdk-burndown'), svgs: el.querySelectorAll('svg').length, role: svg && svg.getAttribute('role'),
            w: svg && Number(svg.getAttribute('width')), h: svg && Number(svg.getAttribute('height')), box: Math.floor(el.clientWidth), shown: svg && Math.round(svg.getBoundingClientRect().width),
            lines: [...el.querySelectorAll('.sdk-burndown-line')].map((p) => p.dataset.series + ':' + p.getAttribute('class')),
            dots: el.querySelectorAll('.sdk-burndown-dot').length, bands: [...el.querySelectorAll('.sdk-burndown-band')].map((r) => r.style.fill ? 'own' : 'accent'),
            today: el.querySelectorAll('.sdk-burndown-today').length, texts: [...el.querySelectorAll('svg text')].map((t) => t.textContent),
            legend: [...el.querySelectorAll('.sdk-burndown-key')].map((k) => k.className + ':' + k.textContent), legendHidden: el.querySelector('.sdk-burndown-legend').getAttribute('aria-hidden'),
            words: el.querySelector('.sdk-burndown-words').textContent };
        })()`);
        ok(shape.cls && shape.svgs === 1 && shape.role === 'img', `${tag}: one chart, role="img" (${JSON.stringify([shape.cls, shape.svgs, shape.role])})`);
        same([shape.w, shape.shown], [shape.box, shape.box], `${tag}: the chart is drawn at its box's width`);
        same(shape.h, shape.box < 400 ? 190 : 230, `${tag}: its height for that width`);
        same(shape.lines, ['planned:sdk-burndown-line is-dashed', 'done:sdk-burndown-line is-solid'], `${tag}: the dashed line is drawn under the solid one`);
        same(shape.dots, 3, `${tag}: a dot on each step of the solid line`);
        same(shape.bands, ['own', 'own', 'accent'], `${tag}: the three bands in range in their own colours (the accent with none), the one after the range not drawn`);
        same(shape.today, 1, `${tag}: a Today line`);
        ok(shape.texts.includes('Today') && shape.texts.includes('40 pts') && shape.texts.includes('20 pts') && shape.texts.includes('0 pts'), `${tag}: Today and the guides' numbers through format (${shape.texts.join(' | ')})`);
        same(shape.legend, ['sdk-burndown-key is-solid:Done', 'sdk-burndown-key is-dashed:Planned'], `${tag}: the legend names each line`);
        same(shape.legendHidden, 'true', `${tag}: the legend is not read out (the words say it)`);
        same(shape.words, WORDS, `${tag}: the words are under the chart`);
        // --- the accessible text, from the browser's own tree ---
        const ax = await s('Accessibility.getFullAXTree', {});
        const images = ax.nodes.filter((x) => !x.ignored && x.role && x.role.value === 'image');
        same(images.map((x) => x.name && x.name.value), [WORDS], `${tag}: the chart is one image named by the words`);
        const heard = ax.nodes.filter((x) => !x.ignored && x.role && ['StaticText', 'paragraph'].includes(x.role.value) && x.name && x.name.value === WORDS);
        same(heard.length, 0, `${tag}: the words are heard once, as the chart's name`);
        // --- colours: both lines the accent token, told apart by dash and weight ---
        const paint = await ev(`(() => {
          const g = (sel) => getComputedStyle(document.querySelector('#bn ' + sel));
          const solid = g('.sdk-burndown-line.is-solid'); const dashed = g('.sdk-burndown-line.is-dashed');
          return { accent: getComputedStyle(document.getElementById('probe')).color, solid: solid.stroke, dashed: dashed.stroke, sd: solid.strokeDasharray, dd: dashed.strokeDasharray,
            sw: solid.strokeWidth, dw: dashed.strokeWidth, so: solid.opacity, dop: dashed.opacity, dot: g('.sdk-burndown-dot').fill, grid: g('.sdk-burndown-grid').stroke,
            today: g('.sdk-burndown-today').stroke, text: g('svg text').fill, muted: (() => { const p = document.createElement('span'); p.style.color = 'var(--text-muted)'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; })(),
            bg: getComputedStyle(document.body).backgroundColor };
        })()`);
        accents.push(paint.accent);
        ok(/^rgb/.test(paint.accent) && paint.solid === paint.accent && paint.dashed === paint.accent && paint.dot === paint.accent, `${tag}: both lines and the dots are the accent token (${JSON.stringify([paint.accent, paint.solid, paint.dashed, paint.dot])})`);
        ok(paint.sd === 'none' && paint.dd !== 'none' && paint.sw !== paint.dw && paint.so !== paint.dop, `${tag}: the two lines are told apart by dash, weight and strength (${JSON.stringify([paint.sd, paint.dd, paint.sw, paint.dw, paint.so, paint.dop])})`);
        ok(paint.today === paint.muted && paint.text === paint.muted, `${tag}: Today and the words on the chart are the muted text token`);
        ok(/^(rgba?|color)\(/.test(paint.grid) && paint.grid !== paint.bg, `${tag}: the guides are drawn (${paint.grid})`);
        // --- no sideways scroll ---
        same(await ev('document.scrollingElement.scrollWidth <= window.innerWidth'), true, `${tag}: no sideways scroll`);
        if (shots) { const r = await s('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(shots, `burndown-${width}-${mode}.png`), Buffer.from(r.data, 'base64')); }
        // --- resized with its box ---
        await ev(`(document.getElementById('bn').style.width = '300px', 1)`);
        await sleep(250);
        same(await ev(`[Number(document.querySelector('#bn svg').getAttribute('width')), Number(document.querySelector('#bn svg').getAttribute('height'))]`), [300, 190], `${tag}: at 300 px it draws again, 300 wide and 190 tall`);
        await ev(`(document.getElementById('bn').style.width = '', 1)`);
        await sleep(250);
        same(await ev(`Number(document.querySelector('#bn svg').getAttribute('width')) === Math.floor(document.getElementById('bn').clientWidth)`), true, `${tag}: back at its width it draws again`);
        // --- from after to is refused and leaves it as it was ---
        same(await ev(`(() => { try { T.chart.set(Object.assign({}, T.opts, { from: T.opts.to, to: T.opts.from })); return 'drew'; } catch (e) { return e.name; } })()`), 'RangeError', `${tag}: from after to is refused`);
        same(await ev(`document.querySelectorAll('#bn .sdk-burndown-line').length + ':' + document.querySelector('#bn .sdk-burndown-words').textContent`), `2:${WORDS}`, `${tag}: a refused set leaves the chart as it was`);
        // --- nothing to draw ---
        await ev(`(T.chart.set(Object.assign({}, T.opts, { series: [] })), 1)`);
        same(await ev(`(() => { const el = document.getElementById('bn'); const w = el.querySelector('.sdk-burndown-words'); return [el.querySelectorAll('svg').length, el.querySelectorAll('.sdk-burndown-key').length, w.textContent, w.getAttribute('aria-hidden'), getComputedStyle(el.querySelector('.sdk-burndown-chart')).display, getComputedStyle(w).display !== 'none']; })()`),
          [0, 0, 'Nothing to count down yet.', null, 'none', true], `${tag}: with nothing to draw it says the empty line alone, and it is read`);
        await ev(`(T.chart.set(T.opts), 1)`);
        same(await ev(`document.querySelectorAll('#bn svg').length`), 1, `${tag}: set() with something to draw draws again`);
        // --- destroy ---
        await ev(`(T.chart.destroy(), 1)`);
        same(await ev(`(() => { const el = document.getElementById('bn'); return [el.childNodes.length, el.className, window.__ro.made, window.__ro.gone]; })()`), [0, '', 1, 1], `${tag}: destroy takes out what it drew and lets go of its observer`);
        await ev(`(document.getElementById('bn').style.width = '200px', 1)`);
        await sleep(200);
        same(await ev(`document.getElementById('bn').childNodes.length`), 0, `${tag}: after destroy a new width draws nothing`);
        same(errors, [], `${tag}: no script errors`);
      } finally {
        cdp.listeners = cdp.listeners.filter((f) => f.name !== 'onError');
        await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
      }
    }
    ok(accents.length === 4 && accents[0] !== accents[2], `the light and dark themes were both drawn (the accent ${accents.join(', ')})`);
  } finally {
    if (browser) await stopBrowser(browser.child, browser.dir);
    server.close();
  }
}

await chromium().catch((e) => { problems.push(`the browser run failed: ${e && e.stack ? e.stack : e}`); });

if (problems.length) {
  console.error(`check-burndown: ${problems.length} problem(s):`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
say(`OK (${n} checks)`);
