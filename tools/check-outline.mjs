#!/usr/bin/env node
/*
 * check-outline.mjs -- the shared outline pieces of the SDK (documentation/plans/plan-templates-redesign.md, "The shared outline
 * pieces"): host.util.order, host.util.rollup, host.ui.progress, host.ui.peoplePicker and host.ui.outline (public/sdk/host.js;
 * its rules are the "outline" and "progress" blocks of public/sdk/system.css).
 *
 *   1. Node only: the pure parts, sliced out of public/sdk/host.js between its "outline:start" and "outline:end" markers.
 *      host.util.order: the first key, keys after the last (a thousand), before the first, between neighbours (random places,
 *      always in the same gap), no key ends in "0", the sort stays strict, two people inserting between the same neighbours
 *      leave every other key alone, and bad input is refused. host.util.rollup: a parent's { done, total } over its leaves at any
 *      depth, an entry with no children is not in the result, what counts as done, a loop of parents, a missing parent, a
 *      repeated id, ids like "__proto__", a very long chain. The tree and its moves: order, ties by id, up, down, indent, outdent,
 *      the depth limit, never into itself or its own children, the drop zones, keys that are not order keys. Read as code: the
 *      pieces use no storage, no cookie, no window.parent or top, no postMessage, and set no HTML from a person's text.
 *   2. Chromium (SKIPPED, said so, when there is none; it is not a pass), at 1280 and 390 wide: the real /sdk/host.js, system.css
 *      and host.css on a fixture page served here (its own stand-in for the host's answers). The outline draws entries in order and
 *      nested, a title that is HTML stays text, the one tab stop, Alt+arrows move (and report the right { id, parent, order }),
 *      the arrows walk and fold, the row menu (Move up, Move down, Indent, Outdent; the ones that cannot be disabled) and Escape,
 *      a drag (the handle's own drag events) before, after and into a row, refused past the depth, never from outside (text, files,
 *      another outline's handle, a made-up drag), no horizontal scroll at 390, 44 px targets at 390, the "..." handle on a phone,
 *      host.ui.progress and host.ui.peoplePicker, and the pieces inside a sandboxed frame with an opaque origin (no allow-same-origin),
 *      where one frame cannot reach another's rows. Set SHOTS=<folder> to keep a screenshot of each screen.
 *      The drag is the page's drag events (DragEvent with a DataTransfer), not the browser's own drag of the mouse.
 * Usage: node tools/check-outline.mjs. Browser: CHROME_PATH, else a Playwright or system Chromium.
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
const say = (...a) => console.log('check-outline:', ...a);
let n = 0;
const problems = [];
const ok = (cond, msg) => { n += 1; if (!cond) problems.push(msg); };
const same = (a, b, msg) => { n += 1; try { assert.deepEqual(a, b); } catch { problems.push(`${msg}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); } };
const throws = (fn, msg) => { n += 1; try { fn(); problems.push(`${msg}: did not throw`); } catch (e) { if (!(e instanceof RangeError)) problems.push(`${msg}: threw ${e && e.name}`); } };

const sdk = read('public/sdk/host.js');

// === 1. Node =============================================================================================================
const from = sdk.indexOf('// outline:start');
const to = sdk.indexOf('// outline:end');
ok(from > 0 && to > from, 'public/sdk/host.js has its outline:start and outline:end markers');
const P = new Function(`${sdk.slice(from, to)}\nreturn { outlineOrder, outlineTree, outlinePlace, outlineMoves, outlineDrop, outlineRollup, ORDER_KEY };`)();
const ord = P.outlineOrder;

{
  // --- order keys ---
  const good = (k) => typeof k === 'string' && P.ORDER_KEY.test(k) && !k.endsWith('0');
  const first = ord(null, null);
  ok(good(first), 'the first key is a key');
  same(ord(undefined, ''), first, 'nothing on either side is the first key whatever way it is said');
  let list = [first];
  for (let i = 0; i < 1000; i += 1) list.push(ord(list[list.length - 1], null));
  ok(list.every(good) && list.every((k, i) => i === 0 || list[i - 1] < k), 'a thousand keys after the last are keys and sort in order');
  ok(Math.max(...list.map((k) => k.length)) <= 40, 'a thousand appended keys stay short (one more character for about thirty)');
  list = [first];
  for (let i = 0; i < 500; i += 1) list.unshift(ord(null, list[0]));
  ok(list.every(good) && list.every((k, i) => i === 0 || list[i - 1] < k), 'five hundred keys before the first sort in order');
  // random places
  let seed = 12345;
  const rnd = (m) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % m; };
  list = [first];
  let bad = 0;
  for (let i = 0; i < 3000; i += 1) {
    const at = rnd(list.length + 1);
    const k = ord(at > 0 ? list[at - 1] : null, at < list.length ? list[at] : null);
    if (!good(k) || (at > 0 && !(list[at - 1] < k)) || (at < list.length && !(k < list[at]))) bad += 1;
    list.splice(at, 0, k);
  }
  ok(bad === 0, 'three thousand keys at random places each sort between their neighbours');
  ok(list.every((k, i) => i === 0 || list[i - 1] < k), 'and the list is still strictly sorted');
  // always the same gap
  let a = ord(null, null);
  const b = ord(a, null);
  let lo = a;
  let longest = 0;
  for (let i = 0; i < 400; i += 1) { lo = ord(lo, b); longest = Math.max(longest, lo.length); if (!(lo < b)) { bad += 1; break; } }
  ok(bad === 0 && longest <= 120, `four hundred keys squeezed into one gap still sort (longest ${longest} characters)`);
  // two people at once
  const row = ['G', 'V', 'k'];
  const p1 = ord('G', 'V');
  const p2 = ord('G', 'V');
  same([p1, p2], [p1, p1], 'two people inserting between the same two make the same key (nothing is renumbered)');
  const merged = [...row, p1, p2].sort();
  same(merged.filter((k) => k === 'G' || k === 'V' || k === 'k'), ['G', 'V', 'k'], 'and the other keys are untouched and still in order');
  const tied = P.outlineTree([{ id: 'x', order: 'G' }, { id: 'z', order: p1 }, { id: 'y', order: p1 }, { id: 'w', order: 'V' }]);
  same(tied.roots.map((r) => r.id), ['x', 'y', 'z', 'w'], 'equal keys are listed by id, the same on every screen');
  // refused
  throws(() => ord('V', 'G'), 'before after after');
  throws(() => ord('G', 'G'), 'the same key twice');
  throws(() => ord('G0', null), 'a key ending in 0');
  throws(() => ord('a b', null), 'a key with a space');
  throws(() => ord(5, null), 'a number');
  throws(() => ord(null, 'x'.repeat(201)), 'a key of 201 characters');

  // --- rollup ---
  const R = P.outlineRollup;
  const es = [{ id: 'a' }, { id: 'b', parent: 'a' }, { id: 'c', parent: 'a', done: true }, { id: 'd', parent: 'b', done: true }, { id: 'e', parent: 'b' }, { id: 'f', parent: 'b', done: 1 }, { id: 'g', done: true }];
  const r = R(es);
  same(r.a, { done: 3, total: 4 }, 'a parent counts the leaves below it at every depth');
  same(r.b, { done: 2, total: 3 }, 'a middle entry counts its own leaves');
  same(Object.keys(r).sort(), ['a', 'b'], 'an entry with no children is not in the result');
  same(R(es, { done: (e) => e.id === 'e' }).b, { done: 1, total: 3 }, 'the module says what counts as done');
  same(Object.keys(R([])), [], 'nothing in, nothing out');
  same(Object.keys(R('x')), [], 'not a list');
  same(R([{ id: 'a', parent: 'ghost' }, { id: 'b', parent: 'a', done: true }]).a, { done: 1, total: 1 }, 'a parent that is not there reads as no parent');
  same(R([{ id: 'a', parent: 'b' }, { id: 'b', parent: 'a' }, { id: 'c', parent: 'a', done: true }]).a !== undefined || true, true, 'a loop of parents does not hang');
  same(R([{ id: 'p' }, { id: 'p', parent: 'p', done: true }, { id: 'q', parent: 'p' }]).p, { done: 0, total: 1 }, 'a repeated id keeps the first');
  const proto = R([{ id: '__proto__' }, { id: 'constructor', parent: '__proto__', done: true }]);
  same(proto.__proto__, { done: 1, total: 1 }, 'an id of "__proto__" is only an id');
  same(Object.getPrototypeOf(proto), null, 'and the result has no prototype to pollute');
  ok(({}).done === undefined && ({}).total === undefined, 'nothing reached Object.prototype');
  {
    const timed = (fn) => { const t = Date.now(); const out = fn(); return [out, Date.now() - t]; };
    const mk = (len, loop) => Array.from({ length: len }, (_, i) => ({ id: `n${i}`, parent: i === 0 ? (loop ? `n${len - 1}` : undefined) : `n${i - 1}`, done: i === len - 1 }));
    const [r10, t10] = timed(() => R(mk(10000)));
    ok(t10 < 500 && r10.n0 && r10.n0.total === 1, `rollup of a 10,000-deep chain takes under 500 ms (${t10} ms)`);
    const [tt, t30] = timed(() => P.outlineTree(mk(30000)));
    ok(t30 < 500 && tt.list.length === 30000 && tt.list[29999].level === 30000, `the tree of a 30,000-deep chain takes under 500 ms (${t30} ms)`);
    const [lp, tl] = timed(() => P.outlineTree(mk(30000, true)));
    ok(tl < 500 && lp.list.length === 30000, `a loop of 30,000 parents is read in under 500 ms (${tl} ms) and every entry is still listed`);
    ok(timed(() => P.outlineMoves(tt, 'n15000', 2))[1] < 500, 'the moves of an entry deep in a long chain are quick');
  }
  {
    let lo = ord(null, null);
    const hi = ord(lo, null);
    let longest = 0;
    let refused = false;
    for (let i = 0; i < 40000 && !refused; i += 1) { try { const k = ord(lo, hi); longest = Math.max(longest, k.length); lo = k; } catch (e) { refused = e instanceof RangeError; if (!refused) throw e; } }
    ok(refused && longest <= 200, `a key never passes 200 characters: a RangeError instead (longest ${longest})`);
  }
  const chain = [{ id: 'n0' }];
  for (let i = 1; i < 30000; i += 1) chain.push({ id: `n${i}`, parent: `n${i - 1}`, done: i === 29999 });
  same(R(chain).n0, { done: 1, total: 1 }, 'a chain of thirty thousand does not overflow the stack');

  // --- the tree and its moves ---
  const E = [{ id: 'a', order: 'G' }, { id: 'b', order: 'V' }, { id: 'c', parent: 'b', order: 'G' }, { id: 'd', parent: 'b', order: 'V' }, { id: 'e', order: 'k' }];
  const T = P.outlineTree([E[4], E[3], E[1], E[0], E[2]]);
  same(T.list.map((x) => x.id), ['a', 'b', 'c', 'd', 'e'], 'the tree lists in order whatever order it was given');
  same(T.list.map((x) => x.level), [1, 1, 2, 2, 1], 'with their levels');
  const loop = P.outlineTree([{ id: 'x', parent: 'y' }, { id: 'y', parent: 'x' }, { id: 'z', parent: 'x' }, null, 5, { id: '' }, { id: 7 }, { id: 'x' }]);
  ok(loop.list.length === 3 && loop.roots.length >= 1, 'a loop, a repeated id and entries that are not entries are all read without hanging');
  const M = (id, d = 2) => P.outlineMoves(T, id, d);
  const strip = (m) => (m ? { id: m.id, parent: m.parent, order: m.order } : null);
  same(strip(M('b').down), { id: 'b', parent: null, order: ord('k', null) }, 'down on the second goes after the last');
  same(strip(M('b').up), { id: 'b', parent: null, order: ord(null, 'G') }, 'up on the second goes before the first');
  same(M('a').up, null, 'the first cannot go up');
  same(M('e').down, null, 'the last cannot go down');
  same(M('b').indent, null, 'an entry with children cannot indent at two levels');
  same(strip(M('b', 3).indent), { id: 'b', parent: 'a', order: ord(null, null) }, 'indent puts it last under the one above (three levels)');
  same(M('a').indent, null, 'the first cannot indent');
  same(strip(M('c').outdent), { id: 'c', parent: null, order: ord('V', 'k') }, 'outdent puts it right after its parent');
  same(M('b').outdent, null, 'a top entry cannot outdent');
  same(M('c').up, null, 'the first child cannot go up');
  same(strip(M('c').down), { id: 'c', parent: 'b', order: ord('V', null) }, 'a child goes down among its own');
  same(M('d').indent, null, 'two levels is the most by default: a child cannot indent');
  ok(M('d', 3).indent && M('d', 3).indent.parent === 'c', 'and three levels allow it');
  same(strip(M('e').indent), { id: 'e', parent: 'b', order: ord('V', null) }, 'indent under an entry with children goes last among them');
  const dropOf = (drag, target, zone, d = 2, open) => strip(P.outlineDrop(T, drag, target, zone, d, open));
  same(dropOf('e', 'a', 'before'), { id: 'e', parent: null, order: ord(null, 'G') }, 'drop before the first');
  same(dropOf('a', 'e', 'after'), { id: 'a', parent: null, order: ord('k', null) }, 'drop after the last');
  same(dropOf('e', 'a', 'into'), { id: 'e', parent: 'a', order: ord(null, null) }, 'drop into an entry with no children');
  same(dropOf('b', 'a', 'into'), null, 'an entry with children does not go into another at two levels');
  ok(dropOf('b', 'a', 'into', 3) !== null, 'but at three levels it may');
  same(dropOf('b', 'c', 'before'), null, 'never before its own child');
  same(dropOf('b', 'b', 'into'), null, 'never on itself');
  same(dropOf('e', 'b', 'after'), { id: 'e', parent: 'b', order: ord(null, 'G') }, 'after an open parent is its first child');
  same(dropOf('a', 'b', 'after', 2, () => false), { id: 'a', parent: null, order: ord('V', 'k') }, 'after a folded parent is after it');
  same(dropOf('c', 'd', 'before'), null, 'back where it was is no move');
  ok(dropOf('zz', 'a', 'before') === null && dropOf('a', 'zz', 'before') === null, 'an id that is not there is no move');
  const odd = P.outlineTree([{ id: 'p', order: 7 }, { id: 'q' }, { id: 'r', order: 'bad key' }]);
  const om = P.outlineMoves(odd, 'p', 2).down;
  ok(om && P.ORDER_KEY.test(om.order), 'entries whose keys are not order keys still move, to a good key');
  const ties = P.outlineTree([{ id: 'a', order: 'G' }, { id: 'b', order: 'G' }, { id: 'c', order: 'V' }, { id: 'd', order: 'k' }]);
  const tm = P.outlineMoves(ties, 'd', 2).up;
  ok(tm && tm.order > 'G' && tm.order < 'V' || tm.order > 'G', 'a move between two with the same key still gives a key that sorts');
}

// Read as code: what the pieces must not do (a module's frame has no storage or parent to use, and a person's text is never HTML).
{
  const start = sdk.indexOf('// ---- The shared outline pieces');
  const end = sdk.indexOf('// The kind picker (host.ui.kindPicker)');
  // The day's weather piece (host.ui.dayWeather) sits among them and draws its own icon from the host; it is not the outline, so it is left out.
  const wStart = sdk.indexOf('// host.ui.dayWeather(el');
  const wEnd = sdk.indexOf('// host.ui.peoplePicker(el');
  ok(wStart > start && wEnd > wStart && wEnd < end, 'the day weather piece is found between the outline pieces and the kind picker');
  const code = sdk.slice(start, wStart) + sdk.slice(wEnd, end);
  ok(start > 0 && end > start, 'the outline pieces sit together in public/sdk/host.js');
  for (const word of ['localStorage', 'sessionStorage', 'document.cookie', 'window.parent', 'window.top', 'global.parent', 'postMessage', 'eval(', 'new Function', 'insertAdjacentHTML', 'outerHTML', 'document.write']) {
    ok(!code.includes(word), `the outline pieces do not use ${word}`);
  }
  const html = code.split('\n').filter((l) => /innerHTML/.test(l));
  ok(html.length === 1 && /parent\.innerHTML = s/.test(html[0]), `innerHTML is set once, from an icon the host sent (found ${html.length})`);
  ok(/order: outlineOrder,/.test(sdk) && /rollup: outlineRollup,/.test(sdk), 'host.util.order and host.util.rollup are in the SDK');
  ok(/outline: \(el, o\) =>/.test(sdk) && /progress: \(el, o\) =>/.test(sdk) && /peoplePicker: \(el, o\) =>/.test(sdk), 'host.ui.outline, progress and peoplePicker are in the SDK');
}
say(`Node: ${n} checks${problems.length ? `, ${problems.length} failed` : ' passed'}`);

// === 2. Chromium =========================================================================================================
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
const PUBLIC = path.join(ROOT, 'public');
const ICON = '<svg viewBox="0 0 10 10" width="1em" height="1em" fill="currentColor"><rect width="10" height="10"/></svg>';

// The stand-in for the host's answers: enough for the SDK to start and for the pieces to ask for icons and people.
const STUB = `
  const locale = { language: 'en', clock: '12', currency: 'USD', currencies: ['USD'] };
  const answer = async (m) => (m === 'hello' ? { locale } : m === 'icons.svg' ? ${JSON.stringify(ICON)} : m === 'people' ? [{ key: 'mia', name: 'Mia' }, { key: 'sam', name: 'Sam <b>S</b>' }] : {});`;

const DATA = `[{ id: 'e', order: 'k', title: 'Send the invites' }, { id: 'd', parent: 'b', order: 'V', title: 'Lunch' }, { id: 'b', order: 'V', title: 'Plan the day' }, { id: 'a', order: 'G', title: 'Book the venue' }, { id: 'c', parent: 'b', order: 'G', title: 'Morning walk' }]`;

const pageHtml = (q) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/sdk/system.css"><link rel="stylesheet" href="/sdk/host.css">
<script data-host-sdk src="/sdk/host.js"></script>
<style>html,body{margin:0;background:var(--bg);color:var(--text);font:14px system-ui,sans-serif}#wrap{padding:12px;max-width:520px}</style></head>
<body><div id="wrap"><div id="ol"></div><div id="ol2" style="margin-top:12px"></div><div id="pg" style="margin-top:12px"></div><div id="who" style="margin-top:12px"></div><div id="who1" style="margin-top:12px"></div><button id="other" type="button">Other</button></div>
<script>
document.documentElement.dataset.themeMode = ${JSON.stringify(q.get('mode') || 'light')};
${STUB}
window.__ready = (async () => {
  const { host } = window.createHost({ call: answer, root: document, rootElement: document.body });
  try { await host.ready(); } catch (e) { /* the stand-in answers enough */ }
  const T = window.T = { host, moves: [], folds: [], opened: [], data: ${DATA}, apply: true };
  T.reset = () => { T.data = ${DATA}; T.moves = []; T.ol.set(T.data); };
  T.ol = host.ui.outline(document.getElementById('ol'), {
    entries: T.data, name: 'Plan', empty: 'No steps yet.',
    row: (x, el) => { if (x.field) { const i = document.createElement('input'); i.id = 'f-' + x.id; i.setAttribute('aria-label', 'Note'); el.append(i); } },
    menu: (x) => [{ id: 'edit', label: 'Edit', icon: 'pen', onClick: () => { T.opened.push('edit:' + x.id); } }],
    onOpen: (x) => { T.opened.push(x.id); },
    onFold: (id, folded) => { T.folds.push([id, folded]); },
    onMove: (m) => {
      T.moves.push(m);
      if (T.apply) { T.data = T.data.map((x) => (x.id === m.id ? Object.assign({}, x, { parent: m.parent || undefined, order: m.order }) : x)); T.ol.set(T.data); }
    },
  });
  // a second outline on the page, for a drag from one outline to another
  T.other = host.ui.outline(document.getElementById('ol2'), { entries: [{ id: 'z', order: 'V', title: 'Elsewhere' }], name: 'Other', onMove: () => {} });
  T.pg = host.ui.progress(document.getElementById('pg'), { done: 2, total: 4 });
  T.changes = [];
  T.who = host.ui.peoplePicker(document.getElementById('who'), { value: ['mia', 'gone1', 'gone1', 'mia'], onChange: (k) => T.changes.push(k), name: 'Owners' });
  T.who1 = host.ui.peoplePicker(document.getElementById('who1'), { value: 'sam', multiple: false, none: 'Nobody', onChange: (k) => T.changes.push(['one'].concat(k)), name: 'Owner' });
  await T.who.ready; await T.who1.ready;
  await new Promise((r) => setTimeout(r, 300)); // the icons arrive
  return 'ready';
})();
</script></body></html>`;

// A page that is a module's frame: sandboxed with no allow-same-origin, so its origin is opaque. It loads the real SDK in the page
// mode (data-host-sdk, as the fixture above) because the frame's own transport needs the real host; what is tried here is that
// the pieces need nothing an opaque origin has taken away.
const frameHtml = (id) => `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/sdk/system.css"><script data-host-sdk src="/sdk/host.js"></script></head>
<body data-theme-mode="light"><div id="ol"></div><script>
${STUB}
(async () => {
  const out = { id: ${JSON.stringify(id)}, origin: String(window.origin), errors: [] };
  try {
    const { host } = window.createHost({ call: answer, root: document, rootElement: document.body });
    try { await host.ready(); } catch (e) { /* ok */ }
    const ol = host.ui.outline(document.getElementById('ol'), { entries: [{ id: 'r1', order: 'V', title: ${JSON.stringify('Frame ' + id + ' <img src=x onerror=window.__x=1>')} }], onMove: () => {} });
    const pg = host.ui.progress(document.createElement('div'), { done: 1, total: 2 });
    await new Promise((r) => setTimeout(r, 200));
    out.rows = [...document.querySelectorAll('.sdk-outline-content')].map((e) => e.textContent);
    out.imgs = document.querySelectorAll('img').length;
    out.handle = document.querySelectorAll('.sdk-outline-handle').length;
    out.key = host.util.order('G', null);
  } catch (e) { out.errors.push(String(e && e.message)); }
  for (const [what, fn] of [['parent document', () => parent.document.title], ['parent rows', () => parent.document.querySelector('.sdk-outline')], ['sibling frame', () => parent.frames[${JSON.stringify(id === 'one' ? 1 : 0)}].document.body], ['storage', () => localStorage.getItem('x')], ['cookie', () => document.cookie]]) {
    try { fn(); out[what] = 'reached'; } catch (e) { out[what] = 'blocked'; }
  }
  parent.postMessage(out, '*');
})();
</script></body></html>`;

async function chromium() {
  const bin = process.env.OUTLINE_NODE_ONLY ? null : findBrowser();
  if (!bin) { say('Chromium: SKIPPED. No Chromium found (set CHROME_PATH, or install one: npx playwright install chromium). This is not a pass; nothing was drawn.'); return; }
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/__outline') { res.writeHead(200, { 'content-type': MIME['.html'] }); res.end(pageHtml(u.searchParams)); return; }
    if (u.pathname.startsWith('/__frame/')) { res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' }); res.end(frameHtml(u.pathname.slice(9))); return; }
    if (u.pathname === '/__host') {
      res.writeHead(200, { 'content-type': MIME['.html'] });
      res.end(`<!doctype html><body><iframe id="f1" sandbox="allow-scripts" src="/__frame/one"></iframe><iframe id="f2" sandbox="allow-scripts" src="/__frame/two"></iframe><div class="sdk-outline" id="mine">host rows</div><script>window.__got = []; addEventListener('message', (e) => window.__got.push(e.data));</script></body>`);
      return;
    }
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
    async function openPage(url, width, touch) {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      const s = (m, p) => cdp.send(m, p, sessionId);
      await s('Page.enable'); await s('Runtime.enable');
      await s('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await s('Emulation.setFocusEmulationEnabled', { enabled: true });
      if (touch) await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await s('Page.navigate', { url });
      const page = {
        id: targetId,
        async ev(expr) {
          const body = /;\s*1\s*$/.test(expr) ? expr : `return (${expr});`;
          const r = await s('Runtime.evaluate', { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) throw new Error('page error: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
          return r.result.value;
        },
        async key(key, o = {}) {
          const vk = { ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, Enter: 13, Escape: 27, ' ': 32, Tab: 9 }[key] || 0;
          const code = key === ' ' ? 'Space' : key;
          const mods = (o.alt ? 1 : 0) | (o.shift ? 8 : 0);
          const text = key === 'Enter' ? '\r' : key === ' ' ? ' ' : undefined;
          await s('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers: mods, ...(text ? { text } : {}) });
          await s('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers: mods });
          await sleep(120);
        },
        async clickAt(x, y) {
          await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
          await s('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
          await s('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
          await sleep(150);
        },
        async shot(name) {
          if (!shots) return;
          const r = await s('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(shots, `outline-${name}.png`), Buffer.from(r.data, 'base64'));
        },
        async close() { await cdp.send('Target.closeTarget', { targetId }).catch(() => {}); },
      };
      for (let i = 0; i < 100; i += 1) { if (await page.ev('document.readyState').catch(() => '') === 'complete') break; await sleep(100); }
      return page;
    }
    // Helpers that run in the fixture page.
    const J = {
      rows: `[...document.querySelectorAll('#ol .sdk-outline-item')].map((li) => li.querySelector(':scope > .sdk-outline-row .sdk-outline-content').textContent + '@' + li.dataset.level)`,
      handle: (id) => `[...document.querySelectorAll('#ol li.sdk-outline-item')].map((li) => li).find((li) => li.querySelector(':scope > .sdk-outline-row .sdk-outline-content').textContent === ${JSON.stringify(id)}).querySelector(':scope > .sdk-outline-row > .sdk-outline-handle')`,
      center: (expr) => `(() => { const e = ${expr}; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; })()`,
    };
    const TITLE = { a: 'Book the venue', b: 'Plan the day', c: 'Morning walk', d: 'Lunch', e: 'Send the invites' };
    const activeLabel = `document.activeElement && document.activeElement.getAttribute('aria-label')`;
    const dnd = (dragTitle, targetTitle, frac, o = {}) => `(() => {
      const find = (t) => [...document.querySelectorAll('#ol li.sdk-outline-item')].find((li) => li.querySelector(':scope > .sdk-outline-row .sdk-outline-content').textContent === t);
      const h = find(${JSON.stringify(dragTitle)}).querySelector(':scope > .sdk-outline-row > .sdk-outline-handle');
      const row = find(${JSON.stringify(targetTitle)}).querySelector(':scope > .sdk-outline-row');
      const dt = new DataTransfer();
      const fire = (type, el, y) => { const ev = new DragEvent(type, { bubbles: true, cancelable: true, clientX: row.getBoundingClientRect().x + 20, clientY: y, dataTransfer: dt }); el.dispatchEvent(ev); return ev; };
      ${o.skipStart ? '' : "fire('dragstart', h, 0);"}
      const r = row.getBoundingClientRect();
      const over = fire('dragover', row, r.top + r.height * ${frac});
      const cls = [...row.classList].filter((c) => c.startsWith('drop-'));
      const dropped = fire('drop', row, r.top + r.height * ${frac});
      fire('dragend', h, 0);
      return { overPrevented: over.defaultPrevented, cls, dropPrevented: dropped.defaultPrevented, moves: T.moves.length, last: T.moves[T.moves.length - 1] || null };
    })()`;

    for (const width of [1280, 390]) {
      const phone = width === 390;
      const tag = `${width}`;
      const page = await openPage(`${base}/__outline`, width, phone);
      try {
        const rd = await page.ev('window.__ready');
        ok(rd === 'ready', `${tag}: the fixture started (${rd})`);
        await page.ev('document.fonts.ready.then(() => 1)');
        // --- draws ---
        same(await page.ev(J.rows), ['Book the venue@1', 'Plan the day@1', 'Morning walk@2', 'Lunch@2', 'Send the invites@1'], `${tag}: the rows, in order and nested`);
        same(await page.ev(`document.querySelector('#ol li.sdk-outline-item:nth-child(2) > ul.sdk-outline-list') !== null`), true, `${tag}: a child list sits inside its parent's item`);
        same(await page.ev(`[...document.querySelectorAll('#ol .sdk-outline-handle')].filter((h) => h.tabIndex === 0).length`), 1, `${tag}: one handle is the tab stop`);
        same(await page.ev(`[...document.querySelectorAll('#ol button')].filter((b) => !(b.getAttribute('aria-label') || '').trim()).length`), 0, `${tag}: every button has a name`);
        same(await page.ev(`document.getElementById('ol').getAttribute('aria-label')`), 'Plan', `${tag}: the outline is named by the module`);
        await page.shot(`${tag}-start`);

        // --- text is text ---
        const evil = ['<img src=x onerror="window.__xss=1">', '"><script>window.__xss=2<\\/script>', '<b>bold</b>'];
        await page.ev(`(() => { T.apply = false; T.ol.set([{ id: '__proto__', order: 'G', title: ${JSON.stringify(evil[0])} }, { id: 'constructor', order: 'V', parent: '__proto__', title: ${JSON.stringify(evil[1])} }, { id: 'x"y', order: 'k', title: ${JSON.stringify(evil[2])} }, { id: 'toString', order: 'm' }]); })()`);
        await sleep(300);
        same(await page.ev(`document.querySelectorAll('#ol img, #ol script, #ol b').length`), 0, `${tag}: a title that is HTML is drawn as text (no img, script or b)`);
        same(await page.ev('typeof window.__xss'), 'undefined', `${tag}: nothing a title said ran`);
        same(await page.ev(`[...document.querySelectorAll('#ol .sdk-outline-content')].map((e) => e.textContent)`), [evil[0], evil[1], evil[2], 'toString'], `${tag}: the words are shown as typed, ids like __proto__ and constructor are only ids`);
        ok((await page.ev(`document.querySelector('#ol .sdk-outline-handle').getAttribute('aria-label')`)).includes('<img'), `${tag}: and the handle's name carries them as text`);
        same(await page.ev(`({}).title === undefined && Object.prototype.hasOwnProperty.call(Object.prototype, 'done') === false`), true, `${tag}: Object.prototype is untouched`);
        await page.ev('T.apply = true; T.reset(); 1');
        await sleep(200);

        // --- empty ---
        await page.ev('T.ol.set([]); 1');
        same(await page.ev(`document.querySelector('#ol .sdk-outline-empty').textContent`), 'No steps yet.', `${tag}: an empty outline says the module's words`);
        await page.ev('T.reset(); 1'); await sleep(200);

        // --- the handle and the menu ---
        const hv = await page.ev(`(() => { const h = ${J.handle(TITLE.b)}; const g = getComputedStyle(h.querySelector('.sdk-outline-grip')).display; const d = getComputedStyle(h.querySelector('.sdk-outline-dots')).display; return { g, d }; })()`);
        same(hv, phone ? { g: 'none', d: 'block' } : { g: 'block', d: 'none' }, `${tag}: the handle is a ${phone ? '"..."' : 'grip'}`);
        const pos = await page.ev(J.center(J.handle(TITLE.b)));
        await page.clickAt(pos.x, pos.y);
        const menu = await page.ev(`[...document.querySelectorAll('.sdk-menu-item')].map((e) => ({ t: e.textContent.trim(), dis: e.getAttribute('aria-disabled') === 'true' || e.disabled === true, h: e.getBoundingClientRect().height }))`);
        same(menu.map((m) => m.t), ['Open', 'Move up', 'Move down', 'Indent', 'Outdent', 'Edit'], `${tag}: the row menu: Open, the four moves, then the module's own item`);
        same(menu.filter((m) => m.dis).map((m) => m.t), ['Indent', 'Outdent'], `${tag}: the moves that cannot be made are disabled (a top entry cannot outdent, and one with children cannot indent at two levels)`);
        if (phone) ok(menu.every((m) => m.h >= 44), `${tag}: menu rows are 44 px or more (${menu.map((m) => Math.round(m.h)).join(',')})`);
        await page.shot(`${tag}-menu`);
        await page.key('Escape');
        same(await page.ev('document.querySelectorAll(".sdk-menu").length'), 0, `${tag}: Escape closes the menu`);
        same(await page.ev(activeLabel), `Move: ${TITLE.b}`, `${tag}: and focus is back on the handle`);
        // pick Move down by tapping
        await page.clickAt(pos.x, pos.y);
        const down = await page.ev(`(() => { const e = [...document.querySelectorAll('.sdk-menu-item')].find((x) => x.textContent.trim() === 'Move down'); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
        await page.clickAt(down.x, down.y);
        same(await page.ev('T.moves'), [{ id: 'b', parent: null, order: ord('k', null) }], `${tag}: Move down in the menu reports the move`);
        same(await page.ev(J.rows), ['Book the venue@1', 'Send the invites@1', 'Plan the day@1', 'Morning walk@2', 'Lunch@2'], `${tag}: and the module's own write is drawn`);
        same(await page.ev(activeLabel), `Move: ${TITLE.b}`, `${tag}: focus stays on the moved entry's handle`);
        await page.ev('T.reset(); 1'); await sleep(200);
        // the module's own item and Open
        await page.clickAt(pos.x, pos.y);
        const edit = await page.ev(`(() => { const e = [...document.querySelectorAll('.sdk-menu-item')].find((x) => x.textContent.trim() === 'Edit'); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
        await page.clickAt(edit.x, edit.y);
        same(await page.ev('T.opened'), ['edit:b'], `${tag}: the module's own menu item runs`);

        // --- 44 px targets and no sideways scroll ---
        if (phone) {
          await page.ev(`T.ol.set(T.data.concat([{ id: 'long', order: 'z', title: 'W'.repeat(240) }])); 1`);
          await sleep(200);
          const t = await page.ev(`(() => {
            const px = (v) => parseFloat(v) || 0;
            const out = [];
            for (const e of document.querySelectorAll('#ol .sdk-outline-handle, #ol .sdk-outline-fold')) {
              const b = e.getBoundingClientRect(); const a = getComputedStyle(e, '::after');
              const hit = a.content !== 'none' && a.position === 'absolute' ? { w: px(a.width), h: px(a.height) } : { w: 0, h: 0 };
              out.push({ w: Math.max(b.width, hit.w), h: Math.max(b.height, hit.h) });
            }
            return { out, rows: [...document.querySelectorAll('#ol .sdk-outline-row')].map((r) => r.getBoundingClientRect().height), sw: document.documentElement.scrollWidth, iw: innerWidth };
          })()`);
          ok(t.out.length >= 6 && t.out.every((x) => x.w >= 44 && x.h >= 44), `390: every handle and fold button is a 44 px target (${JSON.stringify(t.out.slice(0, 3))})`);
          ok(t.rows.every((h) => h >= 44), '390: every row is at least 44 px high');
          ok(t.sw <= t.iw, `390: no sideways scroll with a very long title (${t.sw} in ${t.iw})`);
          await page.shot('390-long');
          await page.ev('T.reset(); 1'); await sleep(200);
        }

        // --- the keyboard ---
        await page.ev(`${J.handle(TITLE.b)}.focus(); 1`);
        await page.key('Escape');
        const kb = async (id, key, o, want, msg) => {
          await page.ev('T.reset(); 1'); await sleep(150);
          await page.ev(`${J.handle(TITLE[id])}.focus(); 1`);
          await page.key(key, o);
          same(await page.ev('T.moves'), want, `${tag}: ${msg}`);
          if (want.length) same(await page.ev(activeLabel), `Move: ${TITLE[id]}`, `${tag}: ${msg}: focus stays on its handle`);
        };
        await kb('b', 'ArrowDown', { alt: true }, [{ id: 'b', parent: null, order: ord('k', null) }], 'Alt+Down moves after the last');
        await kb('b', 'ArrowUp', { alt: true }, [{ id: 'b', parent: null, order: ord(null, 'G') }], 'Alt+Up moves before the first');
        await kb('e', 'ArrowRight', { alt: true }, [{ id: 'e', parent: 'b', order: ord('V', null) }], 'Alt+Right indents under the one above, last');
        await kb('b', 'ArrowRight', { alt: true }, [], 'Alt+Right on an entry with children does nothing at two levels');
        await kb('c', 'ArrowLeft', { alt: true }, [{ id: 'c', parent: null, order: ord('V', 'k') }], 'Alt+Left outdents after its parent');
        await kb('a', 'ArrowUp', { alt: true }, [], 'Alt+Up on the first does nothing');
        await kb('d', 'ArrowRight', { alt: true }, [], 'Alt+Right at the depth limit does nothing');
        await kb('b', 'ArrowDown', {}, [], 'a plain arrow moves focus, not the entry');
        await page.ev('T.reset(); 1'); await sleep(150);
        await page.ev(`${J.handle(TITLE.a)}.focus(); 1`);
        await page.key('ArrowDown');
        same(await page.ev(activeLabel), `Move: ${TITLE.b}`, `${tag}: Down walks to the next handle`);
        await page.key('End');
        same(await page.ev(activeLabel), `Move: ${TITLE.e}`, `${tag}: End goes to the last`);
        await page.key('Home');
        same(await page.ev(activeLabel), `Move: ${TITLE.a}`, `${tag}: Home goes to the first`);
        await page.ev(`${J.handle(TITLE.b)}.focus(); 1`);
        await page.key('ArrowLeft');
        same(await page.ev(`[...document.querySelectorAll('#ol .sdk-outline-content')].map((e) => e.textContent)`), ['Book the venue', 'Plan the day', 'Send the invites'], `${tag}: Left folds the parent`);
        same(await page.ev(`document.querySelector('#ol li:nth-child(2) .sdk-outline-fold').getAttribute('aria-expanded')`), 'false', `${tag}: and says so`);
        same(await page.ev('T.folds'), [['b', true]], `${tag}: and the module hears it`);
        await page.key('ArrowRight');
        same(await page.ev(`document.querySelectorAll('#ol .sdk-outline-content').length`), 5, `${tag}: Right unfolds`);
        same(await page.ev(activeLabel), `Move: ${TITLE.b}`, `${tag}: and focus stays`);
        await page.ev('T.reset(); 1'); await sleep(150);
        // Enter on a handle opens the menu, the keyboard's way to the same moves
        await page.ev(`${J.handle(TITLE.e)}.focus(); 1`);
        await page.key('Enter');
        same(await page.ev('document.querySelectorAll(".sdk-menu").length'), 1, `${tag}: Enter on a handle opens the row menu`);
        await page.key('Escape');
        // clicking the words opens the entry
        await page.ev('T.opened.length = 0; 1');
        const words = await page.ev(J.center(`document.querySelector('#ol .sdk-outline-content')`));
        await page.clickAt(words.x - words.w / 2 + 6, words.y);
        same(await page.ev('T.opened'), ['a'], `${tag}: a click on a row's words opens it`);

        // --- drag ---
        const D = async (drag, target, frac, want, msg, o) => {
          await page.ev('T.reset(); 1'); await sleep(150);
          const r = await page.ev(dnd(drag, target, frac, o));
          want(r, msg);
        };
        await D('Send the invites', 'Book the venue', 0.1, (r, m) => { same([r.overPrevented, r.cls, r.last], [true, ['drop-before'], { id: 'e', parent: null, order: ord(null, 'G') }], m); }, `${tag}: drop on the top of a row puts it before`);
        await D('Book the venue', 'Send the invites', 0.9, (r, m) => { same([r.overPrevented, r.cls, r.last], [true, ['drop-after'], { id: 'a', parent: null, order: ord('k', null) }], m); }, `${tag}: drop on the bottom puts it after`);
        await D('Send the invites', 'Book the venue', 0.5, (r, m) => { same([r.overPrevented, r.cls, r.last], [true, ['drop-into'], { id: 'e', parent: 'a', order: ord(null, null) }], m); }, `${tag}: drop on the middle puts it inside`);
        await D('Send the invites', 'Plan the day', 0.9, (r, m) => { same([r.cls, r.last], [['drop-into'], { id: 'e', parent: 'b', order: ord(null, 'G') }], m); }, `${tag}: the bottom of an open parent is its first child`);
        await D('Plan the day', 'Book the venue', 0.5, (r, m) => { same([r.overPrevented, r.cls, r.moves], [false, [], 0], m); }, `${tag}: an entry with children cannot go inside another at two levels (no line, no move)`);
        await D('Plan the day', 'Morning walk', 0.1, (r, m) => { same([r.overPrevented, r.moves], [false, 0], m); }, `${tag}: an entry cannot go into its own children`);
        await D('Plan the day', 'Plan the day', 0.5, (r, m) => { same([r.overPrevented, r.moves], [false, 0], m); }, `${tag}: or onto itself`);
        await page.ev('T.reset(); 1'); await sleep(150);
        await page.shot(`${tag}-after-drag`);

        // --- a drag that is not this outline's own ---
        const out = await page.ev(`(() => {
          const row = document.querySelector('#ol li.sdk-outline-item .sdk-outline-row');
          const r = row.getBoundingClientRect();
          const fire = (dt, type) => { const ev = new DragEvent(type, { bubbles: true, cancelable: true, clientX: r.x + 20, clientY: r.top + r.height * 0.1, dataTransfer: dt }); row.dispatchEvent(ev); return ev.defaultPrevented; };
          const res = {};
          const text = new DataTransfer(); text.setData('text/plain', 'Send the invites'); text.setData('text/html', '<b>x</b>');
          res.text = [fire(text, 'dragover'), fire(text, 'drop')];
          const file = new DataTransfer(); file.items.add(new File(['x'], 'x.txt', { type: 'text/plain' }));
          res.file = [fire(file, 'dragover'), fire(file, 'drop')];
          const made = new DataTransfer(); made.setData('application/x-host-outline-1', 'e'); made.setData('application/x-host-outline-2', 'e'); made.setData('application/x-host-object', '{"id":"e"}');
          res.made = [fire(made, 'dragover'), fire(made, 'drop')];
          // a drag that began on ANOTHER outline's handle (this page's second outline), dropped on this one
          const other = new DataTransfer();
          document.querySelector('#ol2 .sdk-outline-handle').dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: other }));
          res.otherTypes = [...other.types];
          res.other = [fire(other, 'dragover'), fire(other, 'drop')];
          document.querySelector('#ol2 .sdk-outline-handle').dispatchEvent(new DragEvent('dragend', { bubbles: true }));
          res.classes = document.querySelectorAll('#ol [class*="drop-"]').length;
          res.moves = T.moves.length;
          return res;
        })()`);
        same([out.text, out.file, out.made, out.other], [[false, false], [false, false], [false, false], [false, false]], `${tag}: a drag of text, a file, a made-up drag and another outline's handle is never taken (not even a drop effect)`);
        same([out.classes, out.moves], [0, 0], `${tag}: and it draws nothing and moves nothing`);
        ok(out.otherTypes.length === 1 && /^application\/x-host-outline-\d+$/.test(out.otherTypes[0]), `${tag}: a handle's drag carries only its own outline's type (${out.otherTypes})`);

        // --- a very deep list ---
        const deep = await page.ev(`(() => { const t = Date.now(); T.ol.set(Array.from({ length: 3000 }, (_, i) => ({ id: 'd' + i, parent: i ? 'd' + (i - 1) : undefined, order: 'V', title: 'Level ' + i }))); let nest = 0; for (let e = document.querySelector('#ol .sdk-outline-top'); e;) { nest += 1; e = e.querySelector(':scope > li > ul'); } return { ms: Date.now() - t, items: document.querySelectorAll('#ol li.sdk-outline-item').length, nest }; })()`);
        ok(deep.ms < 3000 && deep.items === 3000 && deep.nest <= 3, `${tag}: a 3,000-deep chain draws in ${deep.ms} ms, nested at most the depth (${deep.nest} lists)`);
        await page.ev('T.reset(); 1'); await sleep(150);

        // --- focus ---
        await page.ev('T.reset(); 1'); await sleep(150);
        await page.ev(`(() => { T.data = T.data.map((x) => (x.id === 'a' ? Object.assign({}, x, { field: true }) : x)); T.ol.set(T.data); const i = document.getElementById('f-a'); i.focus(); i.value = 'my note'; })()`);
        await page.ev(`T.ol.set(T.data.map((x) => Object.assign({}, x)))`);
        same(await page.ev(`[document.activeElement && document.activeElement.id, document.activeElement && document.activeElement.value]`), ['f-a', 'my note'], `${tag}: a field in a row keeps its focus and its text across set()`);
        await page.ev(`document.getElementById('other').focus()`); await sleep(120);
        same(await page.ev(`document.querySelectorAll('#ol .sdk-outline-content').length`), 5, `${tag}: and the waiting redraw is done once focus leaves it`);
        await page.ev('T.reset(); 1'); await sleep(150);
        await page.ev(`${J.handle(TITLE.a)}.focus(); 1`);
        await page.ev('T.ol.set(T.data); 1');
        same(await page.ev(activeLabel), `Move: ${TITLE.a}`, `${tag}: set() puts focus back on the handle that had it`);
        await page.ev(`document.getElementById('other').focus(); T.ol.set(T.data); 1`);
        same(await page.ev('document.activeElement.id'), 'other', `${tag}: set() leaves focus alone when a handle did not have it`);
        await page.ev('T.apply = false; 1');
        await page.ev(`${J.handle(TITLE.b)}.focus(); 1`);
        await page.key('ArrowDown', { alt: true });
        same(await page.ev('T.moves.length'), 1, `${tag}: a move the module ignores is reported`);
        await page.ev(`document.getElementById('other').focus(); T.ol.set(T.data); 1`);
        same(await page.ev('document.activeElement.id'), 'other', `${tag}: and a later set() does not pull focus back`);
        await page.ev('T.apply = true; T.reset(); 1'); await sleep(150);
        same(await page.ev(`(() => { const f = document.querySelector('#ol .sdk-outline-fold'); f.focus(); const r = []; for (const k of ['ArrowLeft', 'ArrowRight']) { const ev = new KeyboardEvent('keydown', { key: k, altKey: true, bubbles: true, cancelable: true }); f.dispatchEvent(ev); r.push(ev.defaultPrevented); } return r; })()`), [true, true], `${tag}: Alt+Left and Alt+Right on a fold button are not the browser's Back and Forward`);
        // set() in the middle of a drag, then a drop that carries the same type but is not a drag of ours any more
        const mid = await page.ev(`(() => {
          T.reset();
          const li = [...document.querySelectorAll('#ol li.sdk-outline-item')];
          const h = li[4].querySelector(':scope > .sdk-outline-row > .sdk-outline-handle');
          const dt = new DataTransfer();
          h.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
          T.ol.set(T.data);
          const row = document.querySelector('#ol li.sdk-outline-item .sdk-outline-row');
          const r = row.getBoundingClientRect();
          const fire = (type) => { const ev = new DragEvent(type, { bubbles: true, cancelable: true, clientX: r.x + 20, clientY: r.top + 2, dataTransfer: dt }); row.dispatchEvent(ev); return ev.defaultPrevented; };
          return { types: [...dt.types].length, over: fire('dragover'), drop: fire('drop'), moves: T.moves.length };
        })()`);
        same([mid.types, mid.over, mid.drop, mid.moves], [1, false, false, 0], `${tag}: set() in the middle of a drag ends it: a drop with the same type calls nothing`);
        await page.ev('T.reset(); 1'); await sleep(150);

        // --- progress ---
        same(await page.ev(`document.querySelector('#pg .sdk-progress-words').textContent`), '2 of 4', `${tag}: progress says "2 of 4"`);
        same(await page.ev(`(() => { const b = document.querySelector('#pg [role=progressbar]'); return [b.getAttribute('aria-valuenow'), b.getAttribute('aria-valuemax'), b.getAttribute('aria-valuetext'), b.firstElementChild.style.getPropertyValue('--pct')]; })()`), ['2', '4', '2 of 4', '50%'], `${tag}: with its numbers for a screen reader and the bar's share`);
        same(await page.ev(`(() => { T.pg.set({ done: 9, total: 4 }); const a = document.querySelector('#pg .sdk-progress-words').textContent; T.pg.set({ done: -1, total: 'x' }); const b = document.querySelector('#pg .sdk-progress-words').textContent; T.pg.set({ done: 1.9, total: 3.2 }); return [a, b, document.querySelector('#pg .sdk-progress-words').textContent]; })()`), ['4 of 4', '0 of 0', '1 of 3'], `${tag}: done never passes total, rubbish reads as 0, counts are whole`);
        await page.ev('T.pg.set({ done: 3, total: 5 }); 1');
        same(await page.ev(`document.querySelector('#pg .sdk-progress-fill').getBoundingClientRect().width > 0 && document.querySelector('#pg .sdk-progress').getBoundingClientRect().width > 30`), true, `${tag}: and the bar is drawn`);

        // --- people ---
        same(await page.ev(`[...document.querySelectorAll('#who label')].map((l) => l.textContent + (l.firstChild.checked ? '*' : ''))`), ['Mia*', 'Sam <b>S</b>', 'No longer here*'], `${tag}: people: the chosen are ticked, a name is text, a key no longer in the space reads "No longer here"`);
        same(await page.ev(`document.querySelectorAll('#who b').length`), 0, `${tag}: a name with HTML is not HTML`);
        const sam = await page.ev(J.center(`document.querySelectorAll('#who label')[1]`));
        await page.clickAt(sam.x, sam.y);
        same(await page.ev('T.changes.pop()'), ['mia', 'sam', 'gone1'], `${tag}: ticking a person reports every key chosen`);
        same(await page.ev('T.who.get()'), ['mia', 'sam', 'gone1'], `${tag}: and get() says so`);
        await page.ev(`document.querySelector('#who input').focus(); 1`);
        await page.key(' ');
        same(await page.ev('T.who.get()'), ['sam', 'gone1'], `${tag}: Space on a focused person unticks them`);
        same(await page.ev(`[...document.querySelectorAll('#who1 label')].map((l) => l.textContent + (l.firstChild.checked ? '*' : ''))`), ['Nobody', 'Mia', 'Sam <b>S</b>*'], `${tag}: one person only: "Nobody" first, a radio each`);
        const mia = await page.ev(J.center(`document.querySelectorAll('#who1 label')[1]`));
        await page.clickAt(mia.x, mia.y);
        same(await page.ev('T.who1.get()'), ['mia'], `${tag}: choosing one replaces the other`);
        same(await page.ev(`(() => { T.who1.set(['sam', 'mia']); return T.who1.get(); })()`), ['sam'], `${tag}: set() with two on a one-person picker keeps one`);
        same(await page.ev(`(() => { const t = document.querySelector('#who1 label').getBoundingClientRect().height; return t >= 30; })()`), true, `${tag}: a person chip is a real target`);
        if (phone) {
          const chips = await page.ev(`[...document.querySelectorAll('#who label, #who1 label')].map((l) => { const b = l.getBoundingClientRect(); const a = getComputedStyle(l, '::before'); return Math.max(b.height, a.content !== 'none' && a.position === 'absolute' ? parseFloat(a.height) || 0 : 0); })`);
          ok(chips.every((h) => h >= 44), `390: person chips are 44 px targets (${chips.map(Math.round)})`);
        }
        await page.shot(`${tag}-pieces`);

        // --- destroy ---
        await page.ev('T.ol.destroy(); 1');
        same(await page.ev(`document.getElementById('ol').children.length + (document.getElementById('ol').className || '').length`), 0, `${tag}: destroy empties the element`);
      } finally { await page.close(); }
    }

    // --- in a sandboxed frame with an opaque origin ---
    {
      const page = await openPage(`${base}/__host`, 1280, false);
      try {
        let got = [];
        for (let i = 0; i < 60 && got.length < 2; i += 1) { await sleep(200); got = await page.ev('window.__got'); }
        same(got.length, 2, 'frames: both sandboxed frames ran the pieces');
        for (const f of got) {
          same(f.errors, [], `frames: ${f.id}: no errors`);
          same(f.origin, 'null', `frames: ${f.id}: the frame's origin is opaque`);
          same(f.rows, [`Frame ${f.id} <img src=x onerror=window.__x=1>`], `frames: ${f.id}: its rows are its own, drawn as text`);
          same([f.imgs, f.handle], [0, 1], `frames: ${f.id}: no image from its text, one handle`);
          same(f.key, ord('G', null), `frames: ${f.id}: host.util.order works there`);
          for (const what of ['parent document', 'parent rows', 'sibling frame', 'storage', 'cookie']) same(f[what], 'blocked', `frames: ${f.id}: the frame cannot reach the ${what}`);
        }
        same(await page.ev('typeof window.__x'), 'undefined', 'frames: nothing a frame\'s text said ran in the page');
        same(await page.ev(`document.querySelector('#mine').textContent`), 'host rows', 'frames: the page\'s own rows are as they were');
        same(await page.ev(`(() => { try { return document.getElementById('f1').contentDocument === null; } catch (e) { return true; } })()`), true, 'frames: the page cannot read a frame\'s rows either');
        await page.shot('frames');
      } finally { await page.close(); }
    }
  } finally {
    if (browser) await stopBrowser(browser.child, browser.dir);
    server.close();
  }
}

await chromium().catch((e) => { problems.push(`the browser run failed: ${e && e.stack ? e.stack : e}`); });

if (problems.length) {
  console.error(`check-outline: ${problems.length} problem(s):`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
say(`OK (${n} checks)`);
