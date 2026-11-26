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
const P = new Function(`${sdk.slice(from, to)}\nreturn { boardColumns, boardGroup, boardStep, boardNearest };`)();
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

const pageHtml = (q) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/sdk/system.css"><link rel="stylesheet" href="/sdk/host.css">
<script data-host-sdk src="/sdk/host.js"></script>
<style>html,body{margin:0;background:var(--bg);color:var(--text);font:14px system-ui,sans-serif}#wrap{padding:12px}</style></head>
<body><div id="wrap"><div id="bd"></div><div id="bd2" style="margin-top:12px"></div><button id="other" type="button">Other</button></div>
<script>
document.documentElement.dataset.themeMode = ${JSON.stringify(q.get('mode') || 'light')};
${STUB}
window.__ready = (async () => {
  const { host } = window.createHost({ call: answer, root: document, rootElement: document.body });
  try { await host.ready(); } catch (e) { /* the stand-in answers enough */ }
  const T = window.T = { host, moves: [], adds: [], opened: [], folds: [], data: ${DATA}, columns: ${COLUMNS}, apply: true, can: true };
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
      if (T.apply) { T.data = T.data.map((x) => (x.id === m.id ? Object.assign({}, x, { column: m.column }) : x)); T.board.set(T.data); }
    },
  });
  T.other = host.ui.board(document.getElementById('bd2'), { columns: [{ id: 'z', label: 'Elsewhere' }], cards: [{ id: 'z1', column: 'z', title: 'Other card' }], name: 'Other', onMove: () => {} });
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
    const shape = `[...document.querySelectorAll('#bd .sdk-board-col')].map((c) => c.dataset.col + ':' + [...c.querySelectorAll('.sdk-board-card .sdk-board-content > div')].map((x) => x.textContent).join('|'))`;
    const activeTitle = `(() => { const a = document.activeElement; const c = a && a.closest && a.closest('.sdk-board-card'); const t = c && c.querySelector('.sdk-board-content > div'); return t ? t.textContent : (a && a.className) || ''; })()`;
    const menuItems = `[...document.querySelectorAll('.sdk-menu-item')].map((e) => e.textContent.trim())`;
    const pick = async (page, label) => {
      const at = await page.ev(`(() => { const e = [...document.querySelectorAll('.sdk-menu-item')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
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

    for (const mode of ['dark']) for (const width of [1280, 390]) {
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
        same(await page.ev(`document.querySelectorAll('#bd [draggable="true"]').length`), phone ? 0 : 4, `${tag}: ${phone ? 'nothing drags on a phone' : 'every card drags'}`);
        same(await page.ev(`getComputedStyle(${colEl('inbox')}).flexDirection + ':' + (document.documentElement.scrollWidth <= innerWidth)`), 'column:true', `${tag}: no sideways scroll of the page`);
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
        same(await page.ev(menuItems), ['Open', 'Move to Doing', 'Move to Later', 'Move to Done', 'Edit'], `${tag}: the card menu: Open, a move to each other column, then the module's own`);
        if (phone) ok((await page.ev(`[...document.querySelectorAll('.sdk-menu-item')].map((e) => e.getBoundingClientRect().height)`)).every((h) => h >= 44), `${tag}: menu rows are 44 px or more`);
        await page.shot(`${width}-${mode}-card-menu`);
        await page.key('Escape');
        same(await page.ev(activeTitle), 'Write the brief', `${tag}: Escape puts focus back on the card`);
        await page.clickAt(more.x, more.y);
        await pick(page, 'Move to Doing');
        same(await page.ev('T.moves'), [{ id: 'a', column: 'doing' }], `${tag}: Move to reports { id, column }`);
        same((await page.ev(shape))[1], 'doing:Write the brief|Plan the day', `${tag}: and the module's own write is drawn`);
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
          same((await page.ev(shape))[0], 'inbox:Write the brief|Book the venue', `${tag}: to where it was`);
          await page.key('ArrowLeft', { alt: true });
          same(await page.ev('T.moves.length'), 2, `${tag}: Alt+Left in the first column does nothing`);
          await page.key('Enter');
          same(await page.ev('T.opened'), ['a'], `${tag}: Enter opens the card`);
          await page.key(' ');
          same(await page.ev(menuItems), ['Open', 'Move to Doing', 'Move to Later', 'Move to Done', 'Edit'], `${tag}: Space opens the card menu`);
          await page.key('Escape');
          same(await page.ev(activeTitle), 'Write the brief', `${tag}: and Escape comes back to the card`);
          await page.ev(`T.reset(); document.querySelector('#bd .sdk-board-card').focus(); 1`);
          await page.key('Tab');
          same(await page.ev(`!document.getElementById('bd').contains(document.activeElement) && document.getElementById('bd2').contains(document.activeElement)`), true, `${tag}: Tab leaves the whole board in one step (to the next board's one stop)`);
          await page.key('Tab', { shift: true });
          same(await page.ev(activeTitle), 'Write the brief', `${tag}: and Shift+Tab comes back to the card it left`);
          await page.ev('T.reset(); 1'); await sleep(150);

          // --- drag ---
          let r = await page.ev(dnd('Write the brief', 'doing'));
          same([r.overPrevented, r.cls, r.dropPrevented, r.last], [true, true, true, { id: 'a', column: 'doing' }], `${tag}: dragging a card over another column shows where it lands and drops there`);
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
