#!/usr/bin/env node
/*
 * check-board.mjs -- the shared board piece of the SDK (documentation/plans/plan-projects-kanban.md, "The SDK piece"):
 * host.ui.board (public/sdk/host.js; its rules are the "board" block of public/sdk/system.css).
 *
 *   1. Node only: the pure parts, sliced out of public/sdk/host.js between its "board:start" and "board:end" markers: the columns
 *      made safe (ids, labels, the done flag, a count), the cards grouped under them (an unknown column, a repeated id and ids like
 *      "__proto__" are safe), a step from a column, the nearest card. Read as code: the piece uses no postMessage, no window.parent
 *      or top, sets no HTML from a person's text, and writes nothing (it only calls onMove).
 *   2. Chromium (SKIPPED, said so, when there is none; it is not a pass), at 1280 and 390 wide: the real /sdk/host.js, system.css and
 *      host.css on a fixture page served here. Columns with their counts, one list per column named by heading and count, one tab
 *      stop for the whole board, a card's words drawn as text, the "+", the column menu (Fold and the module's own), the card menu
 *      (Move to each other column, then the module's own) and Escape, a move by menu, by Alt+Left and Alt+Right and by drag (the
 *      page's own drag events), the polite line ('Moved "Write the brief" to Doing.') with focus kept on the card, folding (kept in
 *      the browser), a drag from anywhere else ignored, someone who cannot move seeing no moves, and at 390 the stacked sections with
 *      the done column folded, no drag, 44 px targets and no sideways scroll. Set SHOTS=<folder> to keep a screenshot of each screen.
 *   3. Rows (the `rows` option): the pure parts (rows made safe, a card's row, the rows to draw with the no-row row last and only when it
 *      has cards, an empty row not drawn, the nearest cell) and, in Chromium, a rows board: the column headings once and held while the rows
 *      scroll, a heading and count for each row, a row folded (kept under <foldKey>:rows, a storage failure harmless), a cell's count only when
 *      its column is folded, Up and Down through the row headings, Left and Right inside a row skipping empty cells, a move by menu or Alt keys
 *      changing the column only, a drop on another row refused with the module's own line, and at 390 each row a foldable group.
 * Usage: node tools/check-board.mjs. Browser: CHROME_PATH, else a Playwright or system Chromium.
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
const say = (...a) => console.log('check-board:', ...a);
let n = 0;
const problems = [];
const ok = (cond, msg) => { n += 1; if (!cond) problems.push(msg); };
const same = (a, b, msg) => { n += 1; try { assert.deepEqual(a, b); } catch { problems.push(`${msg}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`); } };

const sdk = read('public/sdk/host.js');
const css = read('public/sdk/system.css');

// === 1. Node =============================================================================================================
const from = sdk.indexOf('// board:start');
const to = sdk.indexOf('// board:end');
ok(from > 0 && to > from, 'public/sdk/host.js has its board:start and board:end markers');
const P = new Function(`${sdk.slice(from, to)}\nreturn { boardColumns, boardGroup, boardStep, boardNearest, boardRows, boardRowOf, boardGroupRows, boardNearestCell, boardMoveTo, boardSlot, boardSlotAt, boardWash };`)();
{
  same(P.boardColumns(null), [], 'no columns is an empty board');
  same(P.boardColumns('x'), [], 'columns that are not a list are an empty board');
  same(P.boardColumns([{ id: 'a', label: ' Now ', done: true, count: 3.7 }, { id: 'a', label: 'again' }, { id: '' }, null, { label: 'no id' }, { id: 'b' }, { id: 'c', label: '  ', done: 'yes', count: -1 }]),
    [{ id: 'a', label: 'Now', done: true, count: 3 }, { id: 'b', label: 'b', done: false, count: null }, { id: 'c', label: 'c', done: false, count: null }], 'columns are made safe: a label falls back to the id, done is only true, a repeat or an empty id is dropped, a count is a whole number');
  const cols = P.boardColumns([{ id: 'inbox' }, { id: 'now' }, { id: '__proto__' }, { id: 'done', done: true }]);
  const g = P.boardGroup(cols, [{ id: '1', column: 'now' }, { id: '2', column: 'inbox' }, { id: '1', column: 'inbox' }, { id: '3', column: 'gone' }, { id: '4', column: '__proto__' }, { id: '', column: 'now' }, null, { id: '5', column: 'now' }, { id: '6' }]);
  same([...g.keys()], ['inbox', 'now', '__proto__', 'done'], 'every column has a list, in order');
  same([...g.values()].map((l) => l.map((k) => k.id)), [['2'], ['1', '5'], ['4'], []], 'cards sit in their column in the order given; a repeated id, an unknown column and a card with no id are not drawn');
  same(P.boardGroup(cols, 'x').get('now'), [], 'cards that are not a list are no cards');
  same([P.boardStep(cols, 'now', 1), P.boardStep(cols, 'now', -1), P.boardStep(cols, 'inbox', -1), P.boardStep(cols, 'done', 1), P.boardStep(cols, 'nope', 1)], ['__proto__', 'inbox', null, null, null], 'a step goes to the next or the previous column, and stops at an edge');
  same([P.boardNearest(0, 2), P.boardNearest(3, 0), P.boardNearest(3, 5), P.boardNearest(3, -2), P.boardNearest(3, 'x')], [-1, 0, 2, 0, 0], 'the nearest card in the next column');
  // colour: a column's own #rrggbb, nothing else; no colour leaves the column as it was
  {
    same(P.boardColumns([{ id: 'a', color: '#2f6cbf' }, { id: 'b', color: '#2F6CBF' }, { id: 'c', color: 'red' }, { id: 'd', color: '#fff' }, { id: 'e', color: 5 }, { id: 'f', color: '' }]).map((c) => c.color), ['#2f6cbf', undefined, undefined, undefined, undefined, undefined], 'a column keeps only a strict lower case #rrggbb as its colour');
    ok(!('color' in P.boardColumns([{ id: 'a' }])[0]), 'a column with no colour has no color key, as before');
    const lum = (hex) => { const n = parseInt(hex.slice(1), 16); const f = (v) => { const q = v / 255; return q <= 0.03928 ? q / 12.92 : ((q + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); };
    const contrast = (a, b) => { const p = lum(a); const q = lum(b); return (Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05); };
    const light = P.boardWash('#2f6cbf', '#f5f5f5', '#1a1a1a', contrast);
    same([light.pct, light.faint], [16, false], 'a mid blue on a light panel keeps the full wash and a plain dot');
    const dark = P.boardWash('#f2d675', '#1c1c1c', '#8a8a8a', contrast);
    ok(dark.pct < 16 && dark.pct > 0, `a pale colour on a dark panel is lowered (${dark.pct}%) until the words read`);
    const grey = P.boardWash('#1c1c1c', '#1c1c1c', '#f0f0f0', contrast);
    ok(grey.faint === true, 'a dot the colour of its surface is faint');
    for (const [c, sf, t] of [['#f2d675', '#1c1c1c', '#f0f0f0'], ['#ff0000', '#ffffff', '#767676'], ['#00ffff', '#222222', '#9a9a9a'], ['#ffffff', '#f5f5f5', '#767676']]) {
      const w = P.boardWash(c, sf, t, contrast);
      const mix = (i, p) => Math.round(parseInt(sf.slice(1 + i * 2, 3 + i * 2), 16) * (1 - p) + parseInt(c.slice(1 + i * 2, 3 + i * 2), 16) * p);
      const bg = `#${[0, 1, 2].map((i) => mix(i, w.pct / 100).toString(16).padStart(2, '0')).join('')}`;
      ok(w.pct === 0 || contrast(t, bg) >= 4.5, `the wash (${w.pct}%) of ${c} on ${sf} leaves ${t} at 4.5:1 or better`);
    }
  }
  // rows
  {
    const cols = P.boardColumns([{ id: 'a' }, { id: 'b' }]);
    const rows = P.boardRows([{ id: 'r1', label: ' One ' }, { id: 'r1' }, { id: '' }, null, { id: 'r2' }, { id: '__proto__', label: 'P' }, { label: 'x' }]);
    same(rows, [{ id: 'r1', label: 'One' }, { id: 'r2', label: 'r2' }, { id: '__proto__', label: 'P' }], 'rows are made safe like columns: a label falls back to the id, a repeat or an empty id is dropped');
    same(P.boardRows('x'), [], 'rows that are not a list are no rows');
    same([P.boardRowOf(rows, { row: 'r2' }), P.boardRowOf(rows, { row: 'gone' }), P.boardRowOf(rows, {}), P.boardRowOf(rows, { row: 5 }), P.boardRowOf(rows, { row: '__proto__' }), P.boardRowOf(rows, { row: 'toString' }), P.boardRowOf(rows, null)], ['r2', '', '', '', '__proto__', '', ''], 'a card is in its row, else in the no-row row');
    const shown = P.boardGroupRows(cols, rows, [{ id: '1', column: 'a', row: 'r2' }, { id: '2', column: 'b', row: 'r2' }, { id: '3', column: 'a', row: 'r1' }, { id: '4', column: 'a' }, { id: '5', column: 'zz', row: 'r1' }, { id: '1', column: 'b', row: 'r1' }, { id: '6', column: 'b', row: 'gone' }], 'No row');
    same(shown.map((r) => [r.id, r.label, r.count]), [['r1', 'One', 1], ['r2', 'r2', 2], ['', 'No row', 2]], 'rows come in the order given, the no-row row last; a row with no shown cards is not drawn; an unknown column and a repeated id are not counted');
    same(shown[1].cells.get('a').map((k) => k.id), ['1'], 'a cell holds its row\'s cards of that column, in the order given');
    same(P.boardGroupRows(cols, rows, [{ id: '1', column: 'a', row: 'r1' }], 'No row').map((r) => r.id), ['r1'], 'the no-row row is not drawn when it has no cards');
    same(P.boardGroupRows(cols, rows, [], 'No row'), [], 'no cards draw no rows');
    same([P.boardNearestCell([0, 0, 0], 1), P.boardNearestCell([1, 0, 1], 1), P.boardNearestCell([0, 0, 2], 0), P.boardNearestCell([3, 0, 0], 2), P.boardNearestCell([], 0)], [-1, 0, 2, 0, -1], 'the nearest cell with a card, the left one on a tie');
  }
  // order inside a column: where a card goes, a drop's slot
  {
    const ids = ['a', 'b', 'c', 'd'];
    same(P.boardMoveTo(ids, 'b', 'up'), { before: 'a', index: 0 }, 'up puts a card in front of the one above');
    same(P.boardMoveTo(ids, 'b', 'down'), { before: 'd', index: 2 }, 'down puts a card in front of the one two below');
    same(P.boardMoveTo(ids, 'c', 'down'), { before: null, index: 3 }, 'down past the second last is the end');
    same(P.boardMoveTo(ids, 'd', 'top'), { before: 'a', index: 0 }, 'top is in front of the first');
    same(P.boardMoveTo(ids, 'a', 'bottom'), { before: null, index: 3 }, 'bottom is the end');
    same([P.boardMoveTo(ids, 'a', 'up'), P.boardMoveTo(ids, 'd', 'down'), P.boardMoveTo(ids, 'a', 'top'), P.boardMoveTo(ids, 'd', 'bottom'), P.boardMoveTo(ids, 'x', 'up'), P.boardMoveTo(ids, 'a', 'sideways'), P.boardMoveTo('x', 'a', 'up'), P.boardMoveTo([], 'a', 'up')], [null, null, null, null, null, null, null, null], 'an edge, a card that is not there and a word that is not one move nothing');
    same([P.boardSlot(ids, 'x', 0), P.boardSlot(ids, 'x', 2), P.boardSlot(ids, 'x', 4), P.boardSlot(ids, 'x', 99), P.boardSlot(ids, 'x', -3), P.boardSlot([], 'x', 1)], [
      { before: 'a', index: 0, same: false }, { before: 'c', index: 2, same: false }, { before: null, index: 4, same: false }, { before: null, index: 4, same: false }, { before: 'a', index: 0, same: false }, { before: null, index: 0, same: false }], 'a drop from another column lands in front of the card at the slot, or at the end');
    same([P.boardSlot(ids, 'b', 1), P.boardSlot(ids, 'b', 2), P.boardSlot(ids, 'b', 0), P.boardSlot(ids, 'b', 3), P.boardSlot(ids, 'b', 4), P.boardSlot(ids, 'd', 4), P.boardSlot(ids, 'a', 0)], [
      { before: 'c', index: 1, same: true }, { before: 'c', index: 1, same: true }, { before: 'a', index: 0, same: false }, { before: 'd', index: 2, same: false }, { before: null, index: 3, same: false }, { before: null, index: 3, same: true }, { before: 'b', index: 0, same: true }], 'a drop inside the column counts the card where it stands: the gaps either side of it leave it as it is');
    same([P.boardSlotAt([10, 30, 50], 5), P.boardSlotAt([10, 30, 50], 31), P.boardSlotAt([10, 30, 50], 99), P.boardSlotAt([], 5), P.boardSlotAt('x', 5)], [0, 2, 3, 0, 0], 'the slot is how many middles are above the pointer');
  }
  const piece = sdk.slice(sdk.indexOf('function createBoard('), sdk.indexOf('function createProgress('));
  ok(!/postMessage|window\.parent|window\.top/.test(piece), 'the board never talks to a parent or posts a message');
  ok(!/innerHTML\s*=\s*(?!\s*s;)/.test(piece) && !/insertAdjacentHTML|outerHTML|document\.write/.test(piece), 'the board sets HTML only from an icon');
  ok(!/\.(storage|actions|call)\b|host\.call|fetch\(/.test(piece), 'the board writes nothing itself and asks the host for nothing but icons and a menu');
  ok(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(css.slice(css.indexOf('/* board:start */'), css.indexOf('/* board:end */'))) === false, 'the board styles hold no colour literal');
}

// === 2. Chromium =========================================================================================================
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
const PUBLIC = path.join(ROOT, 'public');
const ICON = '<svg viewBox="0 0 10 10" width="1em" height="1em" fill="currentColor"><rect width="10" height="10"/></svg>';
const STUB = `
  const locale = { language: 'en', clock: '12', currency: 'USD', currencies: ['USD'] };
  const answer = async (m) => (m === 'hello' ? { locale } : m === 'icons.svg' ? ${JSON.stringify(ICON)} : {});`;
const COLUMNS = `[{ id: 'inbox', label: 'Inbox' }, { id: 'doing', label: 'Doing' }, { id: 'later', label: 'Later' }, { id: 'done', label: 'Done', done: true }]`;
const DATA = `[{ id: 'a', column: 'inbox', title: 'Write the brief', late: true }, { id: 'b', column: 'inbox', title: 'Book the venue' }, { id: 'c', column: 'doing', title: 'Plan the day' }, { id: 'd', column: 'done', title: 'Send the invites' }]`;

const RDATA = `[{ id: 'a', column: 'inbox', row: 'r1', title: 'Write the brief' }, { id: 'b', column: 'inbox', row: 'r1', title: 'Book the venue' }, { id: 'c', column: 'doing', row: 'r2', title: 'Plan the day' }, { id: 'd', column: 'done', row: 'r1', title: 'Send the invites' }, { id: 'e', column: 'later', row: 'r1', title: 'Order food' }, { id: 'f', column: 'doing', title: 'Loose end' }, { id: 'g', column: 'later', row: 'gone', title: 'Lost one' }]`;
const RROWS = `[{ id: 'r1', label: 'Launch' }, { id: 'r2', label: 'Venue' }, { id: 'r3', label: 'Empty' }]`;

const pageHtml = (q) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/sdk/system.css"><link rel="stylesheet" href="/sdk/host.css">
<script data-host-sdk src="/sdk/host.js"></script>
<style>html,body{margin:0;background:var(--bg);color:var(--text);font:14px system-ui,sans-serif}#wrap{padding:12px}</style></head>
<body><div id="wrap"><div id="bd"></div><div id="bd2" style="margin-top:12px"></div><div id="bd3" style="margin-top:12px"></div><button id="other" type="button">Other</button></div>
<script>
document.documentElement.dataset.themeMode = ${JSON.stringify(q.get('mode') || 'light')};
${STUB}
window.__ready = (async () => {
  const { host } = window.createHost({ call: answer, root: document, rootElement: document.body });
  try { await host.ready(); } catch (e) { /* the stand-in answers enough */ }
  const T = window.T = { host, moves: [], adds: [], opened: [], folds: [], data: ${DATA}, columns: ${COLUMNS}, apply: true, can: true };
  // the module's own part: the card takes the column and goes in front of before, else last
  T.place = (list, m) => { const mover = Object.assign({}, list.find((x) => x.id === m.id), { column: m.column }); const rest = list.filter((x) => x.id !== m.id); const at = m.before ? rest.findIndex((x) => x.id === m.before) : -1; rest.splice(at < 0 ? rest.length : at, 0, mover); return rest; };
  T.reset = () => { T.data = ${DATA}; T.moves = []; T.adds = []; T.opened = []; T.board.set(T.data, T.columns); };
  T.board = host.ui.board(document.getElementById('bd'), {
    columns: T.columns, cards: T.data, name: 'Plan board', foldKey: 'board-check', empty: 'No cards.',
    card: (k, el) => {
      const t = document.createElement('div'); t.textContent = k.title; el.append(t);
      const l = document.createElement('a'); l.href = '#x'; l.textContent = 'Who'; el.append(l);
      if (k.late) { const s = document.createElement('span'); s.textContent = 'Late'; el.append(s); }
    },
    menu: (k) => [{ id: 'edit', label: 'Edit', icon: 'pen', onClick: () => { T.opened.push('edit:' + k.id); } }],
    columnMenu: (c) => [{ id: 'rename', label: 'Rename', icon: 'pen', onClick: () => { T.opened.push('rename:' + c.id); } }],
    canMove: () => T.can,
    onOpen: (k) => { T.opened.push(k.id); },
    onAdd: (id) => { T.adds.push(id); },
    onFold: (id, f) => { T.folds.push([id, f]); },
    onMove: (m) => {
      T.moves.push(m);
      if (T.apply) { T.data = T.place(T.data, m); T.board.set(T.data); }
    },
  });
  T.other = host.ui.board(document.getElementById('bd2'), { columns: [{ id: 'z', label: 'Elsewhere' }], cards: [{ id: 'z1', column: 'z', title: 'Other card' }], name: 'Other', onMove: () => {} });
  T.rowData = ${RDATA};
  T.rowList = ${RROWS};
  T.rmoves = []; T.rkeep = false;
  T.reset3 = () => { T.rowData = ${RDATA}; T.rmoves = []; T.rows.set(T.rowData, T.columns, T.rowList); };
  T.rows = host.ui.board(document.getElementById('bd3'), {
    columns: T.columns, cards: T.rowData, rows: T.rowList, name: 'Rows board', foldKey: 'board-rows-check', empty: 'Nothing matches.',
    labels: { noRow: 'No milestone', otherRow: 'Change the milestone in Edit.' },
    card: (k, el) => { const t = document.createElement('div'); t.textContent = k.title; el.append(t); },
    onAdd: () => {},
    onMove: (m) => { T.rmoves.push(m); T.rowData = T.rowData.map((x) => (x.id === m.id ? Object.assign({}, x, { column: m.column }) : x)); T.rows.set(T.rowData); },
  });
  await new Promise((r) => setTimeout(r, 300)); // the icons arrive
  return 'ready';
})();
</script></body></html>`;

async function chromium() {
  const bin = process.env.BOARD_NODE_ONLY ? null : findBrowser();
  if (!bin) { say('Chromium: SKIPPED. No Chromium found (set CHROME_PATH, or install one: npx playwright install chromium). This is not a pass; nothing was drawn.'); return; }
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/__board') { res.writeHead(200, { 'content-type': MIME['.html'] }); res.end(pageHtml(u.searchParams)); return; }
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
          const text = key === 'Enter' ? '\r' : key === ' ' ? ' ' : key === 'Tab' ? '\t' : undefined;
          await s('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers: mods, ...(text ? { text } : {}) });
          await s('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers: mods });
          await sleep(150);
        },
        async clickAt(x, y) {
          await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
          await s('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
          await s('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
          await sleep(200);
        },
        async shot(name) {
          if (!shots) return;
          const r = await s('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(shots, `board-${name}.png`), Buffer.from(r.data, 'base64'));
        },
        async close() { await cdp.send('Target.closeTarget', { targetId }).catch(() => {}); },
      };
      for (let i = 0; i < 100; i += 1) { if (await page.ev('document.readyState').catch(() => '') === 'complete') break; await sleep(100); }
      return page;
    }
    // Helpers that run in the fixture page.
    const card = (title) => `[...document.querySelectorAll('#bd .sdk-board-card')].find((c) => c.querySelector('.sdk-board-content > div').textContent === ${JSON.stringify(title)})`;
    const colEl = (id) => `document.querySelector('#bd .sdk-board-col[data-col="${id}"]')`;
    const center = (expr) => `(() => { const e = ${expr}; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; })()`;
    const vcenter = (expr) => `(() => { const e = ${expr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; })()`;
    const shape = `[...document.querySelectorAll('#bd .sdk-board-col')].map((c) => c.dataset.col + ':' + [...c.querySelectorAll('.sdk-board-card .sdk-board-content > div')].map((x) => x.textContent).join('|'))`;
    const activeTitle = `(() => { const a = document.activeElement; const c = a && a.closest && a.closest('.sdk-board-card'); const t = c && c.querySelector('.sdk-board-content > div'); return t ? t.textContent : (a && a.className) || ''; })()`;
    const menuItems = `[...document.querySelectorAll('.sdk-menu-item')].map((e) => e.textContent.trim())`;
    const pick = async (page, label) => {
      const at = await page.ev(`(() => { const e = [...document.querySelectorAll('.sdk-menu-item')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await page.clickAt(at.x, at.y);
    };
    const live = `document.querySelector('#bd .sdk-board-live').textContent`;
    const dnd = (title, col, o = {}) => `(() => {
      const c = ${card(title)};
      const target = ${colEl(col)};
      const dt = new DataTransfer();
      const fire = (type, el) => { const r = el.getBoundingClientRect(); const ev = new DragEvent(type, { bubbles: true, cancelable: true, clientX: r.x + 20, clientY: r.y + 20, dataTransfer: dt }); el.dispatchEvent(ev); return ev; };
      ${o.foreign ? '' : "fire('dragstart', c);"}
      const over = fire('dragover', target);
      const cls = target.classList.contains('is-drop');
      const dropped = fire('drop', target);
      fire('dragend', c);
      return { overPrevented: over.defaultPrevented, cls, dropPrevented: dropped.defaultPrevented, moves: T.moves.length, last: T.moves[T.moves.length - 1] || null };
    })()`;

    for (const mode of (process.env.BOARD_MODES || 'dark').split(',')) for (const width of [1280, 390]) {
      const phone = width === 390;
      const tag = `${width} ${mode}`;
      const page = await openPage(`${base}/__board?mode=${mode}`, width, phone);
      try {
        const rd = await page.ev('window.__ready');
        ok(rd === 'ready', `${tag}: the fixture started (${rd})`);
        await page.ev('document.fonts.ready.then(() => 1)');
        // --- draws ---
        const wantShape = ['inbox:Write the brief|Book the venue', 'doing:Plan the day', 'later:', 'done:Send the invites'];
        // a done column is folded on a phone, so its cards are not drawn there
        same(await page.ev(shape), phone ? ['inbox:Write the brief|Book the venue', 'doing:Plan the day', 'later:', 'done:'] : wantShape, `${tag}: the columns and their cards, in order`);
        same(await page.ev(`[...document.querySelectorAll('#bd .sdk-board-title')].map((h) => h.textContent)`).then((t) => t.map((x) => x.replace(/Counts as done/, '').trim())), ['Inbox2', 'Doing1', 'Later0', 'Done1'], `${tag}: each heading says its name and its count`);
        same(await page.ev(`[...document.querySelectorAll('#bd .sdk-board-list')].map((l) => l.getAttribute('aria-label'))`), phone ? ['Inbox, 2', 'Doing, 1', 'Later, 0'] : ['Inbox, 2', 'Doing, 1', 'Later, 0', 'Done, 1'], `${tag}: one list per column, named by its heading and count`);
        same(await page.ev(`document.querySelector('#bd .sdk-board-empty').textContent`), 'No cards.', `${tag}: an empty column says the module's words`);
        same(await page.ev(`document.getElementById('bd').getAttribute('aria-label')`), 'Plan board', `${tag}: the board is named by the module`);
        same(await page.ev(`document.querySelectorAll('#bd [tabindex="0"]').length`), 1, `${tag}: one stop is the tab stop of the whole board`);
        same(await page.ev(`[...document.querySelectorAll('#bd button')].filter((b) => !(b.getAttribute('aria-label') || b.textContent || '').trim()).length`), 0, `${tag}: every button has a name`);
        same(await page.ev(`document.querySelectorAll('#bd .sdk-board-content a[tabindex="-1"]').length`), 4 - (phone ? 1 : 0), `${tag}: a link the module drew in a card is not a tab stop`);
        same(await page.ev(`!!document.querySelector('#bd .sdk-board-col.is-done .sdk-board-done')`), true, `${tag}: a done column carries its check and its words, not a colour alone`);
        same(await page.ev(`document.querySelectorAll('#bd [draggable="true"]').length`), phone ? 3 : 4, `${tag}: every card shown drags, stacked or not`);
        same(await page.ev(`getComputedStyle(${colEl('inbox')}).flexDirection + ':' + (document.documentElement.scrollWidth <= innerWidth)`), 'column:true', `${tag}: no sideways scroll of the page`);
        // --- colour: a dot and a wash on the heading, never a coloured border; words at 4.5:1; a column with no colour as before ---
        {
          const r = await page.ev(`(async () => {
            const host = T.host;
            const mount = document.createElement('div'); mount.id = 'bdc'; document.getElementById('wrap').append(mount);
            const b = host.ui.board(mount, { columns: [{ id: 'p', label: 'Pale', color: '#f2d675' }, { id: 'd', label: 'Dark', color: '#1f3a2e' }, { id: 'n', label: 'Plain' }, { id: 'x', label: 'Bad', color: 'red' }], cards: [], name: 'Colour board', onMove: () => {} });
            await new Promise((r) => setTimeout(r, 200));
            const rgb = (css) => { const c = document.createElement('canvas'); c.width = c.height = 1; const g = c.getContext('2d'); g.fillStyle = css; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
            const lum = (c) => { const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
            const ratio = (a, b) => { const p = lum(a); const q = lum(b); return (Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05); };
            const out = [];
            for (const col of mount.querySelectorAll('.sdk-board-col')) {
              const head = col.querySelector('.sdk-board-head');
              const dot = col.querySelector('.sdk-board-dot');
              const cs = getComputedStyle(head);
              const surface = rgb(getComputedStyle(col).backgroundColor);
              const c2 = document.createElement('canvas'); c2.width = c2.height = 1; const g2 = c2.getContext('2d', { willReadFrequently: true });
              g2.fillStyle = getComputedStyle(col).backgroundColor; g2.fillRect(0, 0, 1, 1); g2.fillStyle = cs.backgroundColor; g2.fillRect(0, 0, 1, 1);
              const px = g2.getImageData(0, 0, 1, 1).data; const washed = [px[0], px[1], px[2]];
              out.push({ id: col.dataset.col, dot: Boolean(dot), hasColor: head.classList.contains('has-color'), pct: head.style.getPropertyValue('--board-wash'), words: ratio(rgb(cs.color), washed), border: getComputedStyle(col).borderTopColor, headBorder: cs.borderTopWidth, dotFaint: dot ? dot.classList.contains('is-faint') : null, dotRatio: dot ? ratio(rgb(getComputedStyle(dot).backgroundColor), washed) : 0, dotSize: dot ? dot.getBoundingClientRect().width : 0 });
            }
            const scrollX = document.documentElement.scrollWidth > document.documentElement.clientWidth;
            b.destroy(); mount.remove();
            return { out, scrollX };
          })()`);
          const by = Object.fromEntries(r.out.map((o) => [o.id, o]));
          ok(by.p.dot && by.p.hasColor && by.d.dot && by.d.hasColor, `${tag}: a column with a colour draws a dot and a wash on its heading`);
          ok(!by.n.dot && !by.n.hasColor && by.n.pct === '', `${tag}: a column with no colour draws none`);
          ok(!by.x.dot && !by.x.hasColor, `${tag}: a colour that is not #rrggbb is ignored`);
          ok(by.p.words >= 4.5 && by.d.words >= 4.5, `${tag}: the heading's words read at 4.5:1 or better on a pale and a dark colour (${by.p.words.toFixed(2)}, ${by.d.words.toFixed(2)})`);
          ok(by.p.dotSize === 8 && by.d.dotSize === 8, `${tag}: the dot is 8 px (${by.p.dotSize})`);
          ok(by.p.border === by.n.border && by.d.border === by.n.border && by.p.headBorder === '0px', `${tag}: a coloured column's border is the plain edge, and the heading has none`);
          ok(by.d.dotFaint === (by.d.dotRatio < 3) && by.p.dotFaint === (by.p.dotRatio < 3), `${tag}: a dot under 3:1 against its heading is faint and one above is not (dark green ${by.d.dotRatio.toFixed(2)}, pale ${by.p.dotRatio.toFixed(2)})`);
          ok(!r.scrollX, `${tag}: coloured columns add no sideways scroll`);
        }
        await page.shot(`${width}-${mode}-start`);

        // --- text is text ---
        await page.ev(`(() => { T.apply = false; T.board.set([{ id: '__proto__', column: 'inbox', title: '<img src=x onerror="window.__xss=1">' }, { id: 'x"y', column: 'doing', title: '<b>bold</b>' }, { id: 'constructor', column: '__proto__', title: 'lost' }]); })(); 1`);
        await sleep(200);
        same(await page.ev(`document.querySelectorAll('#bd img, #bd script, #bd b').length`), 0, `${tag}: a title that is HTML is drawn as text`);
        same(await page.ev('typeof window.__xss'), 'undefined', `${tag}: nothing a title said ran`);
        same(await page.ev(`[...document.querySelectorAll('#bd .sdk-board-card .sdk-board-content > div')].map((e) => e.textContent)`), ['<img src=x onerror="window.__xss=1">', '<b>bold</b>'], `${tag}: ids like __proto__ are only ids, and a card in an unknown column is not drawn`);
        await page.ev('T.apply = true; T.reset(); 1'); await sleep(200);

        // --- the plus, and the column menu ---
        const plus = await page.ev(center(`document.querySelector('#bd .sdk-board-col[data-col="doing"] .sdk-board-add')`));
        await page.clickAt(plus.x, plus.y);
        same(await page.ev('T.adds'), ['doing'], `${tag}: the + adds into its column`);
        const cm = await page.ev(center(`document.querySelector('#bd .sdk-board-col[data-col="doing"] .sdk-board-colmore')`));
        await page.clickAt(cm.x, cm.y);
        same(await page.ev(menuItems), ['Fold', 'Rename'], `${tag}: the column menu: Fold, then the module's own`);
        await page.shot(`${width}-${mode}-column-menu`);
        await page.key('Escape');
        same(await page.ev('document.querySelectorAll(".sdk-menu").length'), 0, `${tag}: Escape closes the menu`);
        same(await page.ev('document.activeElement.className.includes("sdk-board-colmore")'), true, `${tag}: and focus is back on the column's "..."`);
        await page.clickAt(cm.x, cm.y);
        await pick(page, 'Rename');
        same(await page.ev('T.opened'), ['rename:doing'], `${tag}: the module's own column item runs`);

        // --- the card menu and a move by it ---
        const more = await page.ev(center(`${card('Write the brief')}.querySelector('.sdk-board-more')`));
        await page.clickAt(more.x, more.y);
        same(await page.ev(menuItems), ['Open', 'Move up', 'Move down', 'Move to top', 'Move to bottom', 'Move to Doing', 'Move to Later', 'Move to Done', 'Edit'], `${tag}: the card menu: Open, a move to each other column, then the module's own`);
        if (phone) ok((await page.ev(`[...document.querySelectorAll('.sdk-menu-item')].map((e) => e.getBoundingClientRect().height)`)).every((h) => h >= 44), `${tag}: menu rows are 44 px or more`);
        await page.shot(`${width}-${mode}-card-menu`);
        await page.key('Escape');
        same(await page.ev(activeTitle), 'Write the brief', `${tag}: Escape puts focus back on the card`);
        await page.clickAt(more.x, more.y);
        await pick(page, 'Move to Doing');
        same(await page.ev('T.moves'), [{ id: 'a', column: 'doing' }], `${tag}: Move to reports { id, column }`);
        same((await page.ev(shape))[1], 'doing:Plan the day|Write the brief', `${tag}: and the module's own write is drawn (at the end of the column)`);
        await sleep(200);
        same(await page.ev(live), 'Moved "Write the brief" to Doing.', `${tag}: the polite line says it`);
        same(await page.ev(activeTitle), 'Write the brief', `${tag}: focus stays on the moved card`);
        same(await page.ev(`document.querySelector('#bd .sdk-board-live').getAttribute('role')`), 'status', `${tag}: the line is a status`);
        await page.ev('T.reset(); 1'); await sleep(200);
        // the module's own item, and Open
        await page.clickAt(more.x, more.y);
        await pick(page, 'Edit');
        same(await page.ev('T.opened'), ['edit:a'], `${tag}: the module's own card item runs`);
        await page.ev('T.reset(); 1'); await sleep(200);

        // --- order inside a column: the card menu (the way on a phone) ---
        const disabledItems = `[...document.querySelectorAll('.sdk-menu-item')].filter((x) => x.disabled || x.getAttribute('aria-disabled') === 'true').map((x) => x.textContent.trim())`;
        await page.clickAt(more.x, more.y);
        same(await page.ev(disabledItems), ['Move up', 'Move to top'], `${tag}: the first card cannot move up or to the top`);
        await pick(page, 'Move down');
        await sleep(250);
        same(await page.ev('T.moves'), [{ id: 'a', column: 'inbox' }], `${tag}: Move down in the last place but one sends the column and no place (the end)`);
        same((await page.ev(shape))[0], 'inbox:Book the venue|Write the brief', `${tag}: and the card is one place down`);
        same(await page.ev(live), 'Moved to position 2 of 2 in Inbox.', `${tag}: the polite line says where it is`);
        same(await page.ev(activeTitle), 'Write the brief', `${tag}: focus stays on the card`);
        const more2 = await page.ev(center(`${card('Write the brief')}.querySelector('.sdk-board-more')`));
        await page.clickAt(more2.x, more2.y);
        same(await page.ev(disabledItems), ['Move down', 'Move to bottom'], `${tag}: the last card cannot move down or to the bottom`);
        await pick(page, 'Move to top');
        await sleep(250);
        same(await page.ev('T.moves.slice(1)'), [{ id: 'a', column: 'inbox', before: 'b' }], `${tag}: Move to top sends the card it lands in front of`);
        same((await page.ev(shape))[0], 'inbox:Write the brief|Book the venue', `${tag}: and the card is first`);
        await page.ev('T.reset(); 1'); await sleep(200);
        await page.clickAt((await page.ev(center(`${card('Plan the day')}.querySelector('.sdk-board-more')`))).x, (await page.ev(center(`${card('Plan the day')}.querySelector('.sdk-board-more')`))).y);
        same(await page.ev(menuItems).then((x) => x.filter((t) => /^Move (up|down|to top|to bottom)$/.test(t))), [], `${tag}: a column of one card has no moves inside it`);
        await page.key('Escape');
        await page.ev('T.reset(); 1'); await sleep(200);

        // --- a move into a folded column opens it; folding ---
        if (phone) {
          same(await page.ev(`[...document.querySelectorAll('#bd .sdk-board-fold')].map((b) => b.getAttribute('aria-expanded'))`), ['true', 'true', 'true', 'false'], '390: the done column starts folded');
          const m2 = await page.ev(center(`${card('Plan the day')}.querySelector('.sdk-board-more')`));
          await page.clickAt(m2.x, m2.y);
          await pick(page, 'Move to Done');
          same(await page.ev(activeTitle), 'Plan the day', '390: moving into the folded done column opens it and focus stays on the card');
          same(await page.ev(live), 'Moved "Plan the day" to Done.', '390: and says it');
          await page.ev('T.reset(); 1'); await sleep(200);
          const f = await page.ev(center(`document.querySelector('#bd .sdk-board-col[data-col="done"] .sdk-board-fold')`));
          await page.clickAt(f.x, f.y);
          same((await page.ev(shape))[3], 'done:', '390: the fold button closes it again');
          const f2 = await page.ev(center(`document.querySelector('#bd .sdk-board-col[data-col="done"] .sdk-board-fold')`));
          await page.clickAt(f2.x, f2.y);
          same((await page.ev(shape))[3], 'done:Send the invites', '390: and opens it');
          same(await page.ev('T.folds'), [['done', true], ['done', false]], '390: and the module is told');
        } else {
          const f = await page.ev(center(`document.querySelector('#bd .sdk-board-col[data-col="later"] .sdk-board-fold')`));
          await page.clickAt(f.x, f.y);
          same(await page.ev(`${colEl('later')}.classList.contains('is-folded') && !${colEl('later')}.querySelector('.sdk-board-list')`), true, `${tag}: Fold closes the column to a strip`);
          const strip = await page.ev(center(colEl('later')));
          ok(strip.w <= 60, `${tag}: the strip is narrow (${Math.round(strip.w)} px)`);
          same(await page.ev(`document.querySelector('#bd .sdk-board-col[data-col="later"] .sdk-board-count').textContent`), '0', `${tag}: and keeps its count`);
          same(await page.ev(`localStorage.getItem('board-check')`), '["later"]', `${tag}: the fold is kept in the browser`);
          same(await page.ev('T.folds'), [['later', true]], `${tag}: and the module is told`);
          await page.shot(`${width}-${mode}-folded`);
          // a move into the folded column opens it
          const m2 = await page.ev(center(`${card('Plan the day')}.querySelector('.sdk-board-more')`));
          await page.clickAt(m2.x, m2.y);
          await pick(page, 'Move to Later');
          same(await page.ev(`!${colEl('later')}.classList.contains('is-folded')`), true, `${tag}: a card moved into a folded column opens it`);
          same(await page.ev(activeTitle), 'Plan the day', `${tag}: and focus is on the card`);
          await page.ev(`localStorage.removeItem('board-check'); T.reset(); 1`);
          await page.ev(`document.querySelector('#bd .sdk-board-col[data-col="later"] .sdk-board-fold').click(); document.querySelector('#bd .sdk-board-col[data-col="later"] .sdk-board-fold').click(); 1`);
          await sleep(100);
        }
        await page.ev('T.reset(); 1'); await sleep(200);

        // --- who cannot move ---
        await page.ev('T.can = false; T.board.set(T.data); 1'); await sleep(150);
        same(await page.ev(`document.querySelectorAll('#bd [draggable="true"]').length`), 0, `${tag}: someone who cannot move cannot drag`);
        const m3 = await page.ev(center(`${card('Write the brief')}.querySelector('.sdk-board-more')`));
        await page.clickAt(m3.x, m3.y);
        same(await page.ev(menuItems), ['Open', 'Edit'], `${tag}: and has no Move to choices`);
        await page.key('Escape');
        await page.ev(`${card('Write the brief')}.focus(); 1`);
        await page.key('ArrowRight', { alt: true });
        same(await page.ev('T.moves'), [], `${tag}: nor does Alt+Right move`);
        await page.ev('T.can = true; T.board.set(T.data); 1'); await sleep(150);

        if (!phone) {
          // --- the keyboard ---
          await page.ev(`${card('Write the brief')}.focus(); 1`);
          await page.key('ArrowDown');
          same(await page.ev(activeTitle), 'Book the venue', `${tag}: Down walks the column`);
          await page.key('ArrowUp'); await page.key('ArrowUp');
          same(await page.ev('document.activeElement.className'), 'sdk-board-fold', `${tag}: Up from the first card reaches the column heading`);
          await page.key('ArrowDown');
          await page.key('ArrowRight');
          same(await page.ev(activeTitle), 'Plan the day', `${tag}: Right goes to the next column's nearest card`);
          await page.key('ArrowRight');
          same(await page.ev('document.activeElement.className'), 'sdk-board-fold', `${tag}: and to the heading when that column has no card`);
          same(await page.ev(`document.querySelectorAll('#bd [tabindex="0"]').length`), 1, `${tag}: still one tab stop while walking`);
          await page.ev(`${card('Write the brief')}.focus(); 1`);
          await page.key('ArrowRight', { alt: true });
          same(await page.ev('T.moves'), [{ id: 'a', column: 'doing' }], `${tag}: Alt+Right moves it one column`);
          same(await page.ev(activeTitle), 'Write the brief', `${tag}: and focus stays on the card`);
          same(await page.ev(live), 'Moved "Write the brief" to Doing.', `${tag}: and the line says it`);
          await page.key('ArrowLeft', { alt: true });
          same(await page.ev('T.moves.length'), 2, `${tag}: Alt+Left moves it back`);
          same((await page.ev(shape))[0], 'inbox:Book the venue|Write the brief', `${tag}: to its column (at the end of it)`);
          await page.key('ArrowLeft', { alt: true });
          same(await page.ev('T.moves.length'), 2, `${tag}: Alt+Left in the first column does nothing`);
          await page.key('Enter');
          same(await page.ev('T.opened'), ['a'], `${tag}: Enter opens the card`);
          await page.key(' ');
          same(await page.ev(menuItems), ['Open', 'Move up', 'Move down', 'Move to top', 'Move to bottom', 'Move to Doing', 'Move to Later', 'Move to Done', 'Edit'], `${tag}: Space opens the card menu`);
          await page.key('Escape');
          same(await page.ev(activeTitle), 'Write the brief', `${tag}: and Escape comes back to the card`);
          await page.ev(`T.reset(); document.querySelector('#bd .sdk-board-card').focus(); 1`);
          await page.key('Tab');
          same(await page.ev(`!document.getElementById('bd').contains(document.activeElement) && document.getElementById('bd2').contains(document.activeElement)`), true, `${tag}: Tab leaves the whole board in one step (to the next board's one stop)`);
          await page.key('Tab', { shift: true });
          same(await page.ev(activeTitle), 'Write the brief', `${tag}: and Shift+Tab comes back to the card it left`);
          await page.ev('T.reset(); 1'); await sleep(150);

          // --- order inside a column: Alt+Up and Alt+Down, and a drop's place ---
          await page.ev(`${card('Write the brief')}.focus(); 1`);
          same(await page.ev(`document.activeElement.getAttribute('aria-keyshortcuts')`), 'Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown', `${tag}: a card names its move keys`);
          same(await page.ev(`getComputedStyle(document.activeElement).outlineStyle + ':' + (parseFloat(getComputedStyle(document.activeElement).outlineWidth) >= 2)`), 'solid:true', `${tag}: a focused card has a visible focus ring`);
          await page.key('ArrowUp', { alt: true });
          await sleep(250);
          same(await page.ev('T.moves'), [], `${tag}: Alt+Up on the first card moves nothing`);
          same(await page.ev(live), 'Already at the top.', `${tag}: and says so`);
          await page.key('ArrowDown', { alt: true });
          await sleep(250);
          same(await page.ev('T.moves'), [{ id: 'a', column: 'inbox' }], `${tag}: Alt+Down moves it one place down`);
          same((await page.ev(shape))[0], 'inbox:Book the venue|Write the brief', `${tag}: and it is drawn there`);
          same(await page.ev(live), 'Moved to position 2 of 2 in Inbox.', `${tag}: the line says where`);
          same(await page.ev(activeTitle), 'Write the brief', `${tag}: and focus stays on the card`);
          await page.key('ArrowDown', { alt: true });
          await sleep(250);
          same([await page.ev('T.moves.length'), await page.ev(live)], [1, 'Already at the bottom.'], `${tag}: Alt+Down on the last card moves nothing and says so`);
          await page.key('ArrowUp', { alt: true });
          await sleep(250);
          same(await page.ev('T.moves.slice(1)'), [{ id: 'a', column: 'inbox', before: 'b' }], `${tag}: Alt+Up sends the card it lands in front of`);
          same(await page.ev(live), 'Moved to position 1 of 2 in Inbox.', `${tag}: and the line says where`);
          await page.ev('T.apply = false; T.reset(); 1'); await sleep(150);
          await page.ev(`document.querySelector('#bd .sdk-board-live').textContent = ''; ${card('Write the brief')}.focus(); 1`);
          await page.key('ArrowDown', { alt: true });
          await sleep(250);
          same(await page.ev(live), '', `${tag}: a move the module does not draw is not announced`);
          await page.ev('T.apply = true; T.reset(); 1'); await sleep(150);
          // a drop inside a column: the pointer's place among the cards (a line before or after one), the same place is no drop
          const slot = (title, over, where) => `(() => {
            const c = ${card(title)};
            const t = ${card(over)};
            const dt = new DataTransfer();
            const fire = (type, el, y) => { const r = el.getBoundingClientRect(); const ev = new DragEvent(type, { bubbles: true, cancelable: true, clientX: r.x + 20, clientY: y === undefined ? r.y + 2 : y, dataTransfer: dt }); el.dispatchEvent(ev); return ev; };
            fire('dragstart', c);
            const r = t.getBoundingClientRect();
            const y = ${where === 'below' ? 'r.y + r.height - 2' : 'r.y + 2'};
            const over = fire('dragover', t, y);
            const li = t.closest('li');
            const mark = li.classList.contains('is-drop-before') ? 'before' : li.classList.contains('is-drop-after') ? 'after' : '';
            const col = t.closest('.sdk-board-col').classList.contains('is-drop');
            const line = getComputedStyle(li.querySelector('.sdk-board-card')).boxShadow !== 'none';
            fire('drop', t, y);
            fire('dragend', c);
            return { over: over.defaultPrevented, effect: dt.dropEffect, mark, col, line, last: T.moves[T.moves.length - 1] || null, moves: T.moves.length };
          })()`;
          let sl = await page.ev(slot('Write the brief', 'Book the venue', 'below'));
          same([sl.over, sl.mark, sl.col, sl.line, sl.last], [true, 'after', false, true, { id: 'a', column: 'inbox' }], `${tag}: a drop on the lower half of the last card puts the dragged one at the end, with a line drawn`);
          await page.ev('T.reset(); 1'); await sleep(150);
          sl = await page.ev(slot('Book the venue', 'Write the brief', 'above'));
          same([sl.over, sl.mark, sl.last], [true, 'before', { id: 'b', column: 'inbox', before: 'a' }], `${tag}: a drop on the upper half of a card goes in front of it`);
          await page.ev('T.reset(); 1'); await sleep(150);
          sl = await page.ev(slot('Write the brief', 'Write the brief', 'above'));
          same([sl.over, sl.mark, sl.moves], [false, '', 0], `${tag}: a drop where the card already is draws no line and moves nothing`);
          sl = await page.ev(slot('Write the brief', 'Plan the day', 'below'));
          same([sl.mark, sl.col, sl.last], ['after', true, { id: 'a', column: 'doing' }], `${tag}: a drop into another column at the end sends no place, and lights the column too`);
          await page.ev('T.reset(); 1'); await sleep(150);
          // --- drag ---
          let r = await page.ev(dnd('Write the brief', 'doing'));
          same([r.overPrevented, r.cls, r.dropPrevented, r.last], [true, true, true, { id: 'a', column: 'doing', before: 'c' }], `${tag}: dragging a card over another column shows where it lands (the column, from its heading: the top) and drops there`);
          await sleep(150);
          same(await page.ev(live), 'Moved "Write the brief" to Doing.', `${tag}: and the line says it`);
          await page.ev('T.reset(); 1'); await sleep(150);
          r = await page.ev(dnd('Write the brief', 'inbox'));
          same([r.overPrevented, r.moves], [false, 0], `${tag}: a drop on its own column does nothing`);
          r = await page.ev(dnd('Write the brief', 'doing', { foreign: true }));
          same([r.overPrevented, r.moves], [false, 0], `${tag}: a drag that is not the board's own (text, a file, another board) is left alone`);
          r = await page.ev(`(() => {
            const dt = new DataTransfer(); const c = document.querySelector('#bd2 .sdk-board-card'); const t = ${colEl('doing')};
            c.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
            const ev = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }); t.dispatchEvent(ev);
            t.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
            return { prevented: ev.defaultPrevented, moves: T.moves.length };
          })()`);
          same([r.prevented, r.moves], [false, 0], `${tag}: a drag from another board is left alone`);
          const hi = await page.ev(`getComputedStyle(${colEl('doing')}).outlineStyle`);
          same(hi, 'none', `${tag}: no drop mark is left behind`);
          // the drop mark, held
          await page.ev(`(() => { const c = ${card('Write the brief')}; const dt = new DataTransfer(); c.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt })); ${colEl('doing')}.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); })(); 1`);
          await page.shot(`${width}-${mode}-drop`);
          same(await page.ev(`getComputedStyle(${colEl('doing')}).outlineStyle`), 'solid', `${tag}: the drop mark is an outline, not a colour alone`);
          await page.ev(`${card('Write the brief')}.dispatchEvent(new DragEvent('dragend', { bubbles: true })); 1`);
          same(await page.ev(`!!document.querySelector('#bd .is-drop, #bd .dragging')`), false, `${tag}: and it is cleared when the drag ends`);
        } else {
          // --- the stacked layout ---
          const b = await page.ev(`(() => { const bd = document.getElementById('bd').getBoundingClientRect(); const cols = [...document.querySelectorAll('#bd .sdk-board-col')].map((c) => { const r = c.getBoundingClientRect(); return { x: r.x, w: r.width, y: r.y }; }); return { bw: bd.width, cols }; })()`);
          ok(b.cols.every((c) => Math.abs(c.w - b.bw) < 2 && Math.abs(c.x - b.cols[0].x) < 1), `390: every column is a section the width of the board (${b.cols.map((c) => Math.round(c.w)).join(',')} in ${Math.round(b.bw)})`);
          ok(b.cols.every((c, i) => i === 0 || c.y > b.cols[i - 1].y), '390: and they follow one another down the page');
          await page.ev(`T.board.set(T.data.concat([{ id: 'long', column: 'doing', title: 'W'.repeat(240) }, { id: 'lg', column: 'doing', title: 'one two three '.repeat(30) }])); 1`);
          await sleep(200);
          const t = await page.ev(`(() => {
            const out = [];
            for (const e of document.querySelectorAll('#bd button')) { const b = e.getBoundingClientRect(); out.push({ w: b.width, h: b.height, c: e.className }); }
            return { out, cards: [...document.querySelectorAll('#bd .sdk-board-card')].map((r) => r.getBoundingClientRect().height), sw: document.documentElement.scrollWidth, iw: innerWidth };
          })()`);
          ok(t.out.length >= 8 && t.out.every((x) => x.w >= 44 && x.h >= 44), `390: every button is a 44 px target (${JSON.stringify(t.out.filter((x) => x.w < 44 || x.h < 44).slice(0, 3))})`);
          ok(t.cards.every((h) => h >= 44), '390: every card is at least 44 px high');
          ok(t.sw <= t.iw, `390: no sideways scroll with a very long title (${t.sw} in ${t.iw})`);
          await page.shot(`${width}-${mode}-long`);
          await page.ev('T.reset(); 1'); await sleep(200);
          // the keys stack too: Down walks from a column's last card to the next column
          await page.ev(`${card('Plan the day')}.focus(); 1`);
          await page.key('ArrowDown');
          same(await page.ev('document.activeElement.className'), 'sdk-board-fold', '390: Down from a column\'s last card reaches the next column\'s heading');
        }

        // --- rows ---
        const R = '#bd3';
        const rcard = (title) => `[...document.querySelectorAll('${R} .sdk-board-card')].find((c) => c.querySelector('.sdk-board-content > div').textContent === ${JSON.stringify(title)})`;
        const rshape = `[...document.querySelectorAll('${R} .sdk-board-row')].map((r) => (r.querySelector('.sdk-board-rowfold .sdk-board-label').textContent) + '=' + [...r.querySelectorAll('.sdk-board-card .sdk-board-content > div')].map((x) => x.textContent).join('|'))`;
        const rlive = `document.querySelector('${R} .sdk-board-live').textContent`;
        const ractive = `(() => { const a = document.activeElement; const c = a && a.closest && a.closest('.sdk-board-card'); const t = c && c.querySelector('.sdk-board-content > div'); return t ? t.textContent : (a && a.classList.contains('sdk-board-rowfold') ? 'row:' + a.querySelector('.sdk-board-label').textContent : (a && a.className) || ''); })()`;
        await page.ev(`localStorage.removeItem('board-rows-check'); localStorage.removeItem('board-rows-check:rows'); T.reset3(); 1`); await sleep(250);
        same(await page.ev(`[...document.querySelectorAll('${R} .sdk-board-rowfold .sdk-board-label')].map((x) => x.textContent)`), ['Launch', 'Venue', 'No milestone'], `${tag}: rows: one band for each row with cards, the empty row not drawn, the no-row row last with the module's words`);
        same(await page.ev(`[...document.querySelectorAll('${R} .sdk-board-rowfold .sdk-board-count')].map((x) => x.textContent)`), ['4', '1', '2'], `${tag}: rows: each row heading counts its cards`);
        same(await page.ev(rshape), phone ? ['Launch=Write the brief|Book the venue|Order food', 'Venue=Plan the day', 'No milestone=Loose end|Lost one'] : ['Launch=Write the brief|Book the venue|Order food|Send the invites', 'Venue=Plan the day', 'No milestone=Loose end|Lost one'], `${tag}: rows: cards sit in their row's cells (a card with an unknown row is in the no-row row)`);
        same(await page.ev(`document.querySelectorAll('${R} [tabindex="0"]').length`), 1, `${tag}: rows: still one tab stop`);
        same(await page.ev(`[...document.querySelectorAll('${R} .sdk-board-rowfold')].map((b) => b.getAttribute('aria-expanded') + ':' + b.getAttribute('aria-label'))`), ['true:Fold: Launch, 4', 'true:Fold: Venue, 1', 'true:Fold: No milestone, 2'], `${tag}: rows: the heading's button says Fold with aria-expanded`);
        same(await page.ev(`[...document.querySelectorAll('${R} .sdk-board-row')].map((r) => r.getAttribute('role') + ':' + r.getAttribute('aria-label'))`), ['group:Launch, 4', 'group:Venue, 1', 'group:No milestone, 2'], `${tag}: rows: each row is a group named by its heading and count`);
        same(await page.ev(`new Set([...document.querySelectorAll('${R} .sdk-board-content')].map((c) => c.id)).size === document.querySelectorAll('${R} .sdk-board-content').length`), true, `${tag}: rows: every card has its own id`);
        same(await page.ev(`document.documentElement.scrollWidth <= innerWidth`), true, `${tag}: rows: no sideways scroll of the page`);
        await page.shot(`${width}-${mode}-rows`);
        if (!phone) {
          same(await page.ev(`document.querySelectorAll('${R} .sdk-board-heads .sdk-board-title').length`), 4, `${tag}: rows: the column headings are drawn once`);
          same(await page.ev(`[...document.querySelectorAll('${R} .sdk-board-heads .sdk-board-count')].map((x) => x.textContent)`), ['2', '2', '2', '1'], `${tag}: rows: a column heading counts its cards across every row`);
          same(await page.ev(`document.querySelectorAll('${R} .sdk-board-cell .sdk-board-count').length`), 0, `${tag}: rows: a cell shows no count while its column is open`);
          same(await page.ev(`[...document.querySelectorAll('${R} .sdk-board-row')][0].querySelectorAll('.sdk-board-cell .sdk-board-list')[1].getAttribute('aria-label')`), 'Doing in Launch, 0', `${tag}: rows: a cell is a list named by its column, row and count`);
          const al = await page.ev(`(() => { const h = document.querySelector('${R} .sdk-board-heads .sdk-board-col[data-col="doing"]').getBoundingClientRect(); return [...document.querySelectorAll('${R} .sdk-board-cell[data-col="doing"]')].map((c) => Math.abs(c.getBoundingClientRect().x - h.x) < 1 && Math.abs(c.getBoundingClientRect().width - h.width) < 1); })()`);
          ok(al.length === 3 && al.every(Boolean), `${tag}: rows: every cell lines up under its column heading (${al})`);
          // the headings are held while the rows scroll
          await page.ev(`(() => { const b = document.querySelector('${R} .sdk-board-body'); b.style.setProperty('--board-max-height', '260px'); b.scrollTop = 120; })(); 1`); await sleep(150);
          const held = await page.ev(`(() => { const b = document.querySelector('${R} .sdk-board-body').getBoundingClientRect(); const h = document.querySelector('${R} .sdk-board-heads').getBoundingClientRect(); return { top: Math.round(h.top - b.top), st: document.querySelector('${R} .sdk-board-body').scrollTop }; })()`);
          ok(held.st > 0 && held.top === 0, `${tag}: rows: the column headings stay at the top while the rows scroll (scrolled ${held.st}, offset ${held.top})`);
          await page.shot(`${width}-${mode}-rows-held`);
          await page.ev(`(() => { const b = document.querySelector('${R} .sdk-board-body'); b.style.removeProperty('--board-max-height'); b.scrollTop = 0; })(); 1`);
          // folding a column: its cell is a strip with its own count
          const fc = await page.ev(vcenter(`document.querySelector('${R} .sdk-board-heads .sdk-board-col[data-col="later"] .sdk-board-fold')`));
          await page.clickAt(fc.x, fc.y);
          same(await page.ev(`[...document.querySelectorAll('${R} .sdk-board-cell[data-col="later"] .sdk-board-count')].map((x) => x.textContent)`), ['1', '0', '1'], `${tag}: rows: a folded column's cell shows its own count`);
          same(await page.ev(`localStorage.getItem('board-rows-check')`), '["later"]', `${tag}: rows: the column fold is kept as it is without rows`);
          await page.shot(`${width}-${mode}-rows-colfold`);
          await page.ev(`document.querySelector('${R} .sdk-board-heads .sdk-board-col[data-col="later"] .sdk-board-fold').click(); 1`); await sleep(100);
        }
        // fold a row: a heading only, kept in the browser
        const rf = await page.ev(vcenter(`document.querySelectorAll('${R} .sdk-board-rowfold')[0]`));
        await page.clickAt(rf.x, rf.y);
        same(await page.ev(`document.querySelectorAll('${R} .sdk-board-row')[0].querySelectorAll('.sdk-board-card').length + ':' + document.querySelectorAll('${R} .sdk-board-rowfold')[0].getAttribute('aria-expanded') + ':' + document.querySelectorAll('${R} .sdk-board-rowfold')[0].getAttribute('aria-label')`), '0:false:Unfold: Launch, 4', `${tag}: rows: Fold leaves the heading only, and the button says Unfold`);
        same(await page.ev(`localStorage.getItem('board-rows-check:rows')`), '["r1"]', `${tag}: rows: the fold is kept under <foldKey>:rows`);
        same(await page.ev(`document.activeElement.classList.contains('sdk-board-rowfold')`), true, `${tag}: rows: and focus stays on the heading`);
        await page.shot(`${width}-${mode}-rows-rowfold`);
        // a kept fold comes back; a storage that fails breaks nothing
        same(await page.ev(`(() => { const d = document.createElement('div'); document.body.append(d); const b = T.host.ui.board(d, { columns: T.columns, cards: T.rowData, rows: T.rowList, foldKey: 'board-rows-check', onMove: () => {} }); const v = d.querySelectorAll('.sdk-board-row')[0].classList.contains('is-folded'); b.destroy(); d.remove(); return v; })()`), true, `${tag}: rows: a new board reads the kept row fold`);
        same(await page.ev(`(() => { const get = Storage.prototype.getItem, set = Storage.prototype.setItem; Storage.prototype.getItem = () => { throw new Error('no'); }; Storage.prototype.setItem = () => { throw new Error('no'); }; try { const d = document.createElement('div'); document.body.append(d); const b = T.host.ui.board(d, { columns: T.columns, cards: T.rowData, rows: T.rowList, foldKey: 'x', onMove: () => {} }); d.querySelectorAll('.sdk-board-rowfold')[1].click(); const v = d.querySelectorAll('.sdk-board-row')[1].classList.contains('is-folded'); b.destroy(); d.remove(); return v; } finally { Storage.prototype.getItem = get; Storage.prototype.setItem = set; } })()`), true, `${tag}: rows: a storage that fails does not break the board or the fold`);
        const rf3 = await page.ev(vcenter(`document.querySelectorAll('${R} .sdk-board-rowfold')[0]`));
        await page.clickAt(rf3.x, rf3.y);
        same(await page.ev(`document.querySelectorAll('${R} .sdk-board-row')[0].querySelectorAll('.sdk-board-card').length > 0`), true, `${tag}: rows: Unfold brings the cards back`);
        same(await page.ev(`localStorage.getItem('board-rows-check:rows')`), '[]', `${tag}: rows: and the kept fold is gone`);

        // a move by menu changes the column only
        const rm = await page.ev(vcenter(`${rcard('Write the brief')}.querySelector('.sdk-board-more')`));
        await page.clickAt(rm.x, rm.y);
        same(await page.ev(menuItems), ['Move up', 'Move down', 'Move to top', 'Move to bottom', 'Move to Doing', 'Move to Later', 'Move to Done'], `${tag}: rows: the card menu moves inside the cell, then between columns`);
        await pick(page, 'Move to Doing');
        same(await page.ev('T.rmoves'), [{ id: 'a', column: 'doing' }], `${tag}: rows: a move reports the column only`);
        await sleep(200);
        same((await page.ev(rshape))[0].startsWith('Launch=') && (await page.ev(rshape))[0].includes('Write the brief'), true, `${tag}: rows: and the card stays in its row`);
        same(await page.ev(rlive), 'Moved "Write the brief" to Doing.', `${tag}: rows: the line says the move`);
        same(await page.ev(ractive), 'Write the brief', `${tag}: rows: focus stays on the card`);
        await page.ev('T.reset3(); 1'); await sleep(200);

        if (!phone) {
          // keys
          await page.ev(`${rcard('Write the brief')}.focus(); 1`);
          await page.key('ArrowRight');
          same(await page.ev(ractive), 'Order food', `${tag}: rows: Right stays in the row and skips the empty cell`);
          await page.key('ArrowRight');
          same(await page.ev(ractive), 'Send the invites', `${tag}: rows: Right goes on along the row`);
          await page.key('ArrowRight');
          same(await page.ev(ractive), 'Send the invites', `${tag}: rows: and stays at the row's end`);
          await page.key('ArrowLeft'); await page.key('ArrowLeft'); await page.key('ArrowLeft');
          same(await page.ev(ractive), 'Write the brief', `${tag}: rows: Left walks back along the row`);
          await page.key('ArrowLeft');
          same(await page.ev(ractive), 'Write the brief', `${tag}: rows: and stays at its start`);
          await page.key('ArrowDown');
          same(await page.ev(ractive), 'Book the venue', `${tag}: rows: Down walks the cell`);
          await page.key('ArrowDown');
          same(await page.ev(ractive), 'row:Venue', `${tag}: rows: Down from the cell's last card reaches the next row's heading`);
          same(await page.ev(`document.querySelectorAll('${R} [tabindex="0"]').length`), 1, `${tag}: rows: one tab stop while walking`);
          await page.key('ArrowDown');
          same(await page.ev(ractive), 'Plan the day', `${tag}: rows: Down from a heading goes to the row's nearest card (here the nearest column with one)`);
          await page.key('ArrowDown');
          same(await page.ev(ractive), 'row:No milestone', `${tag}: rows: Down passes the next heading`);
          await page.key('ArrowDown');
          same(await page.ev(ractive), 'Loose end', `${tag}: rows: and into its card`);
          await page.key('ArrowUp'); await page.key('ArrowUp');
          same(await page.ev(ractive), 'Plan the day', `${tag}: rows: Up goes back through the heading`);
          await page.key('ArrowUp'); await page.key('ArrowUp');
          same(await page.ev(ractive), 'Book the venue', `${tag}: rows: Up through a heading goes into the row above, to its nearest card in the same column`);
          await page.key('ArrowUp'); await page.key('ArrowUp');
          same(await page.ev(ractive), 'row:Launch', `${tag}: rows: Up from a row's first card reaches its heading`);
          await page.key('ArrowLeft');
          same(await page.ev(`document.querySelectorAll('${R} .sdk-board-row')[0].classList.contains('is-folded') + ':' + document.activeElement.classList.contains('sdk-board-rowfold')`), 'true:true', `${tag}: rows: Left on a row heading folds it`);
          await page.key('ArrowRight');
          same(await page.ev(`document.querySelectorAll('${R} .sdk-board-row')[0].classList.contains('is-folded')`), false, `${tag}: rows: Right unfolds it`);
          await page.key('ArrowUp');
          same(await page.ev('document.activeElement.className'), 'sdk-board-fold', `${tag}: rows: Up from the first row heading reaches the column headings`);
          await page.key('ArrowDown');
          same(await page.ev(ractive), 'row:Launch', `${tag}: rows: and Down comes back to the heading`);
          await page.ev(`${rcard('Write the brief')}.focus(); 1`);
          await page.key('ArrowRight', { alt: true });
          same(await page.ev('T.rmoves'), [{ id: 'a', column: 'doing' }], `${tag}: rows: Alt+Right moves the card one column`);
          same(await page.ev(ractive), 'Write the brief', `${tag}: rows: and focus stays on it`);
          await page.ev('T.reset3(); 1'); await sleep(200);

          // drag: only its own row's cells take it
          const rdnd = (title, row, col, act) => `(() => {
            const c = ${rcard(title)}; const target = document.querySelector('${R} .sdk-board-cell[data-row="${row}"][data-col="${col}"]');
            const dt = new DataTransfer();
            const fire = (type, el) => { const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }); el.dispatchEvent(ev); return ev; };
            fire('dragstart', c);
            const over = fire('dragover', target);
            const cls = target.classList.contains('is-drop');
            ${act === 'end' ? "fire('dragend', c);" : "const dropped = fire('drop', target); fire('dragend', c);"}
            return { over: over.defaultPrevented, cls, moves: T.rmoves.length, last: T.rmoves[T.rmoves.length - 1] || null };
          })()`;
          let rr = await page.ev(rdnd('Write the brief', 'r1', 'doing'));
          same([rr.over, rr.cls, rr.last], [true, true, { id: 'a', column: 'doing' }], `${tag}: rows: a card dropped in its own row's cell moves there`);
          await page.ev('T.reset3(); 1'); await sleep(200);
          rr = await page.ev(rdnd('Write the brief', 'r2', 'doing'));
          same([rr.over, rr.cls, rr.moves], [false, false, 0], `${tag}: rows: another row's cell takes no drop and lights up no mark`);
          await sleep(150);
          same(await page.ev(rlive), 'Change the milestone in Edit.', `${tag}: rows: and the line says what the module supplies`);
          await page.ev(`document.querySelector('${R} .sdk-board-live').textContent = ''; 1`);
          rr = await page.ev(rdnd('Write the brief', 'r2', 'doing', 'end'));
          await sleep(150);
          same([rr.moves, await page.ev(rlive)], [0, 'Change the milestone in Edit.'], `${tag}: rows: let go over another row (the browser does not drop there) says the line too`);
          rr = await page.ev(rdnd('Write the brief', '', 'doing'));
          same(rr.moves, 0, `${tag}: rows: the no-row row's cell is another row too`);
          rr = await page.ev(rdnd('Loose end', '', 'later'));
          same(rr.last, { id: 'f', column: 'later', before: 'g' }, `${tag}: rows: a card with no row moves inside the no-row row`);
          await page.ev('T.reset3(); 1'); await sleep(200);
        } else {
          same(await page.ev(`[...document.querySelectorAll('${R} .sdk-board-row')].map((r) => r.querySelectorAll('.sdk-board-col').length)`), [4, 4, 4], '390: rows: each row group holds the columns as the stacked board does');
          same(await page.ev(`[...document.querySelectorAll('${R} .sdk-board-row')[0].querySelectorAll('.sdk-board-fold')].map((b) => b.getAttribute('aria-expanded'))`), ['true', 'true', 'true', 'false'], '390: rows: the done column starts folded in each row');
          same(await page.ev(`document.querySelectorAll('${R} .sdk-board-heads, ${R} .sdk-board-cell').length`), 0, '390: rows: no held headings, no cells');
          same(await page.ev(`[...document.querySelectorAll('${R} .sdk-board-row')[0].querySelectorAll('.sdk-board-list')].map((l) => l.getAttribute('aria-label'))`), ['Inbox in Launch, 2', 'Doing in Launch, 0', 'Later in Launch, 1'], '390: rows: each list is named by column, row and count');
          const rt = await page.ev(`(() => { const out = []; for (const e of document.querySelectorAll('${R} button')) { const b = e.getBoundingClientRect(); out.push({ w: b.width, h: b.height, c: e.className }); } return { out, sw: document.documentElement.scrollWidth, iw: innerWidth }; })()`);
          ok(rt.out.length >= 10 && rt.out.every((x) => x.w >= 44 && x.h >= 44), `390: rows: every button is a 44 px target (${JSON.stringify(rt.out.filter((x) => x.w < 44 || x.h < 44).slice(0, 3))})`);
          ok(rt.sw <= rt.iw, `390: rows: no sideways scroll (${rt.sw} in ${rt.iw})`);
          const rf2 = await page.ev(vcenter(`document.querySelectorAll('${R} .sdk-board-rowfold')[0]`));
          await page.clickAt(rf2.x, rf2.y);
          same(await page.ev(`document.querySelectorAll('${R} .sdk-board-row')[0].querySelectorAll('.sdk-board-col').length`), 0, '390: rows: a row group folds to its heading');
          await page.shot(`${width}-${mode}-rows-rowfold2`);
          await page.clickAt(rf2.x, rf2.y);
          // keys: one line of row headings, column headings and cards
          await page.ev(`${rcard('Book the venue')}.focus(); 1`);
          await page.key('ArrowDown');
          same(await page.ev(`document.activeElement.className + ':' + document.activeElement.closest('.sdk-board-col').dataset.col`), 'sdk-board-fold:doing', '390: rows: Down from a column\'s last card reaches the next column heading in the row');
          await page.key('ArrowUp');
          same(await page.ev(ractive), 'Book the venue', '390: rows: and Up comes back');
          await page.ev(`document.querySelectorAll('${R} .sdk-board-rowfold')[0].focus(); 1`);
          await page.key('ArrowDown');
          same(await page.ev(`document.activeElement.closest('.sdk-board-col').dataset.col`), 'inbox', '390: rows: Down from a row heading enters its columns');
          // a move in a row group
          const pm = await page.ev(vcenter(`${rcard('Write the brief')}.querySelector('.sdk-board-more')`));
          await page.clickAt(pm.x, pm.y);
          await pick(page, 'Move to Doing');
          same(await page.ev(ractive), 'Write the brief', '390: rows: a move keeps focus on the card');
          await page.ev('T.reset3(); 1'); await sleep(200);
        }
        // rows come and go with set(); no rows is the plain board
        await page.ev(`T.rows.set(T.rowData, T.columns, []); 1`); await sleep(200);
        same(await page.ev(`document.querySelectorAll('${R} .sdk-board-row, ${R} .sdk-board-grid, ${R} .sdk-board-cell').length + ':' + document.querySelectorAll('${R} .sdk-board-col').length + ':' + document.querySelector('${R} .sdk-board-body').classList.contains('has-rows')`), '0:4:false', `${tag}: rows: set() with no rows draws the plain columns`);
        await page.ev(`T.rows.set([], T.columns, T.rowList); 1`); await sleep(200);
        same(await page.ev(`document.querySelector('${R} .sdk-board-empty').textContent + ':' + document.querySelectorAll('${R} .sdk-board-row').length`), 'Nothing matches.:0', `${tag}: rows: no cards draws the empty line and no rows`);
        await page.ev('T.reset3(); 1');
      } finally { await page.close(); }
    }
  } finally {
    if (browser) await stopBrowser(browser.child, browser.dir);
    server.close();
  }
}

await chromium().catch((e) => { problems.push(`the browser run failed: ${e && e.stack ? e.stack : e}`); });

if (problems.length) {
  console.error(`check-board: ${problems.length} problem(s):`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
say(`OK (${n} checks)`);
