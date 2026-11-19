#!/usr/bin/env node
/*
 * check-layout-picker.mjs -- the layout picker (public/layout-picker.js; documentation/plans/plan-layout-picker.md, step 4).
 *
 *   1. In Node: the picker's pure parts. carryAreas keeps a module in its area where it may stay, moves the rest into a free
 *      area that may hold them (swapping a Calendar into area 1), keeps a module once, and says what it dropped and why;
 *      putInArea moves a module rather than doubling it; droppedNote and refusedNote say it in one sentence; partsFor reads
 *      composites.js. What areaChoices offers agrees with cleanShape() (server/layout-shapes.js) for every shape, area and
 *      module, with the Calendar on and off, so the picker never offers what the server refuses.
 *   2. In Chromium (skipped, said so, when there is none), with real keys over the DevTools protocol, at 1280 and 390, light
 *      and dark: six shapes drawn in two rows of three, each with its number of areas at the shape's percentages; picking a
 *      shape carries the areas sensibly and a shape change never loses the list it carries from; the area menu offers Empty
 *      first, then what the area may hold (no Calendar or Maps in a stacked area, no To-do there while the Calendar is on,
 *      To-do there when it is off); a module chosen in a second area leaves the first; the keyboard (arrows on the shapes,
 *      Enter on, Tab through the areas in order, the menu by Enter); the names a screen reader hears; Save hands back
 *      exactly { shape, areas }, and every record handed back passes cleanShape(); Escape with changes asks first; at 390
 *      step 2 is one row per area, each at least 44px tall, and the drawing is not shown.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startBrowser, stopBrowser } from './browser-launch.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { cleanShape, SHAPES: SERVER_SHAPES } = require(path.join(ROOT, 'server/layout-shapes.js'));
const failures = [];
let passed = 0;
const fail = (m) => failures.push(m);
const ok = (cond, m) => { if (cond) passed += 1; else fail(m); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

// ---- 1. Node ----
// The page's scripts import each other by root paths (/layouts.js); a copy of public/*.js with those made relative loads in Node.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-layout-picker-'));
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
for (const f of fs.readdirSync(path.join(ROOT, 'public')).filter((x) => x.endsWith('.js'))) {
  fs.writeFileSync(path.join(tmp, f), fs.readFileSync(path.join(ROOT, 'public', f), 'utf8').replace(/from '\/([\w-]+\.js)'/g, "from './$1'").replace(/import '\/([\w-]+\.js)'/g, "import './$1'"));
}
const P = await import(pathToFileURL(path.join(tmp, 'layout-picker.js')).href);
const { SHAPES, shapeById } = await import(pathToFileURL(path.join(tmp, 'layout-shapes.js')).href);
const { areaMayHold } = await import(pathToFileURL(path.join(tmp, 'layouts.js')).href);
fs.rmSync(tmp, { recursive: true, force: true });

eq(SHAPES.map((s) => s.id), SERVER_SHAPES.map((s) => s.id), 'the page and the server list the same shapes');
for (const s of SHAPES) ok(P.SHAPE_LABELS[s.id] && P.SHAPE_ABOUT[s.id], `${s.id}: no label or description`);
eq(P.partsFor(['calendar', 'todo', 'goals']).sort(), ['calendar', 'todo'], 'partsFor with the Calendar on');
eq(P.partsFor(['todo', 'goals', 'maps']), [], 'partsFor with the Calendar off (and no Map answered)');
eq(P.partsFor(['maps'], ['map']), ['maps'], 'partsFor with the Map shown');

const IDS = ['whiteboard', 'goals', 'documents', 'todo', 'calendar', 'maps', 'vault', 'polls', 'chat', 'conference'];
const holder = (shape, parts) => (a, id) => areaMayHold(shape, a, id, { parts });
{
  const tall = shapeById('tall-split');
  const withCal = holder(tall, P.partsFor(IDS));
  eq(P.carryAreas(['goals', 'calendar', 'documents'], tall, withCal), { areas: ['calendar', 'goals', 'documents'], dropped: [] }, 'carryAreas swaps a Calendar from a stacked area into area 1');
  eq(P.carryAreas(['calendar', 'maps', 'todo'], tall, withCal), { areas: ['calendar', null, null], dropped: [{ id: 'maps', why: 'stack' }, { id: 'todo', why: 'stack' }] }, 'carryAreas drops what can\'t share a column when area 1 is taken');
  const noCal = holder(tall, P.partsFor(IDS.filter((x) => x !== 'calendar')));
  eq(P.carryAreas(['goals', 'todo', null], tall, noCal).areas, ['goals', 'todo', null], 'carryAreas keeps To-do in a stacked area while the Calendar is off');
  const two = shapeById('two-equal');
  eq(P.carryAreas(['goals', null, 'documents'], two, holder(two, [])), { areas: ['goals', 'documents'], dropped: [] }, 'carryAreas moves a module whose area went into a free one');
  eq(P.carryAreas(['goals', 'vault', 'documents'], shapeById('one'), holder(shapeById('one'), [])), { areas: ['goals'], dropped: [{ id: 'vault', why: 'full' }, { id: 'documents', why: 'full' }] }, 'carryAreas drops what has no area left');
  eq(P.carryAreas(['goals', 'goals', 'chat'], shapeById('three-equal'), holder(shapeById('three-equal'), [])), { areas: ['goals', null, null], dropped: [{ id: 'chat', why: 'column' }] }, 'carryAreas keeps a module once and never puts the chat in an area');
  eq(P.putInArea(['goals', null, 'vault'], 2, 'vault'), { areas: ['goals', 'vault', null], from: 3 }, 'putInArea moves a module, emptying its old area');
  eq(P.putInArea(['goals', null], 1, null), { areas: [null, null], from: 0 }, 'putInArea empties an area');
  const name = (id) => ({ todo: 'To-do', maps: 'Maps', vault: 'Vault', documents: 'Documents' }[id] || id);
  eq(P.droppedNote([{ id: 'todo', why: 'stack' }], name), "To-do can't share a column, so it was taken out.", 'droppedNote, one');
  eq(P.droppedNote([{ id: 'vault', why: 'full' }, { id: 'documents', why: 'full' }], name), 'There is no area left for Vault and Documents, so they were taken out.', 'droppedNote, two');
  eq(P.droppedNote([], name), '', 'droppedNote, none');
  eq(P.refusedNote(['Calendar', 'Maps'], tall), "Calendar and Maps can't share a column; they can go in area 1.", 'refusedNote');
  eq(P.areaName(2, 3, 'To-do'), 'Area 2 of 3: To-do', 'areaName');
  eq(P.areaName(1, 1, ''), 'Area 1 of 1: Empty', 'areaName, empty');
}
// The chooser and the server's check agree, everywhere.
{
  let n = 0;
  for (const s of SHAPES) {
    for (const on of [IDS, IDS.filter((x) => x !== 'calendar')]) {
      const parts = P.partsFor(on);
      const mods = on.map((id) => ({ id }));
      for (let a = 1; a <= s.areas; a += 1) {
        const offered = new Set(P.areaChoices(s, a, mods, { parts }).map((m) => m.id));
        for (const id of on) {
          const areas = Array.from({ length: s.areas }, (_, i) => (i === a - 1 ? id : null));
          const server = !cleanShape({ shape: s.id, areas }, { modules: on }).error;
          n += 1;
          if (offered.has(id) !== server) fail(`${s.id} area ${a}, ${id} (Calendar ${on.includes('calendar') ? 'on' : 'off'}): the picker ${offered.has(id) ? 'offers' : 'leaves out'} it, the server ${server ? 'accepts' : 'refuses'} it`);
        }
      }
    }
  }
  ok(n > 200, `the agreement ran on ${n} cases`);
}

// ---- 2. the browser ----
function findBrowser() {
  const cands = [process.env.CHROME_PATH];
  const pw = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(pw)) for (const d of fs.readdirSync(pw).sort().reverse()) cands.push(path.join(pw, d, 'chrome-linux', 'chrome'), path.join(pw, d, 'chrome-linux', 'headless_shell'));
  cands.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  return cands.find((c) => c && fs.existsSync(c)) || null;
}
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' };
const page = (mode) => `<!doctype html><html data-theme-mode="${mode}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/sdk/system.css">
<style>html,body{height:100%;margin:0} #here{height:100%}</style></head><body><div id="here"></div></body></html>`;
function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/t.html') { res.setHeader('content-type', 'text/html'); res.end(page(url.searchParams.get('mode') || 'dark')); return; }
    const file = path.join(ROOT, 'public', path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end(); return; }
    res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}
class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } }); }
  send(method, params = {}, sessionId) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params, sessionId })); return new Promise((res, rej) => this.pending.set(id, { res, rej })); }
}
async function launch(bin) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-layout-picker-chrome-'));
  const child = startBrowser(bin, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank'], dir);
  const url = await new Promise((resolve, reject) => {
    let buf = ''; const t = setTimeout(() => reject(new Error('the browser did not start: ' + buf.slice(-300))), 20000);
    child.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(t); resolve(m[1]); } });
    child.on('exit', (c) => { clearTimeout(t); reject(new Error('the browser exited (' + c + ')')); });
  }).catch(async (e) => { await stopBrowser(child, dir); throw e; });
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('cannot reach the browser'))); });
  return { cdp: new Cdp(ws), child, dir, ws };
}

const MODS = [
  { id: 'whiteboard', name: 'Whiteboard', icon: 'chalkboard', tint: 'teal' }, { id: 'goals', name: 'Goals', icon: 'bullseye', tint: 'green' },
  { id: 'documents', name: 'Documents', icon: 'file-lines', tint: 'orange' }, { id: 'todo', name: 'To-do', icon: 'list-check', tint: 'green' },
  { id: 'calendar', name: 'Calendar', icon: 'calendar-days', tint: 'red' }, { id: 'maps', name: 'Maps', icon: 'map-location-dot', tint: 'pink' },
  { id: 'vault', name: 'Vault', icon: 'vault', tint: 'blue' }, { id: 'chat', name: 'Chat', icon: 'comments' },
];
const records = []; // every record Save handed back, with the module ids it was made from: checked by cleanShape below

let note = '';
const bin = findBrowser();
if (!bin) note = ' (browser part SKIPPED: no Chromium found; set CHROME_PATH. This is not a pass)';
else {
  const { server, base } = await serve();
  const { cdp, child, dir, ws } = await launch(bin);
  try {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const s = (m, p) => cdp.send(m, p, sessionId);
    await s('Page.enable');
    const errors = [];
    await s('Runtime.enable');
    cdp.ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || 'an error'); });
    const ev = async (expression) => {
      const r = await s('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const CODES = { Escape: 27, Tab: 9, Enter: 13, ArrowRight: 39, ArrowLeft: 37, ArrowDown: 40, ArrowUp: 38, Home: 36, End: 35, ' ': 32 };
    const key = async (k, mods = 0) => {
      const b = { key: k, code: k === ' ' ? 'Space' : k, windowsVirtualKeyCode: CODES[k], modifiers: mods };
      await s('Input.dispatchKeyEvent', k === 'Enter' ? { type: 'keyDown', ...b, text: '\r' } : k === ' ' ? { type: 'keyDown', ...b, text: ' ' } : { type: 'rawKeyDown', ...b });
      await s('Input.dispatchKeyEvent', { type: 'keyUp', ...b });
      await wait(40);
    };
    const open = async ({ width, mode, opts, mods = MODS }) => {
      await s('Emulation.setDeviceMetricsOverride', { width, height: width < 500 ? 844 : 800, deviceScaleFactor: 1, mobile: width < 500 });
      await s('Page.navigate', { url: `${base}/t.html?mode=${mode}` });
      for (let i = 0; i < 100 && !(await ev("document.readyState === 'complete'").catch(() => false)); i += 1) await wait(50);
      await ev(`import('/layout-picker.js').then((m) => { window.__saved = []; window.__mods = ${JSON.stringify(mods)};
        const p = m.createLayoutPicker(Object.assign({ modules: window.__mods, onSave: (r) => { window.__saved.push(r); }, onCancel: () => { window.__cancelled = true; } }, ${JSON.stringify(opts || {})}));
        p.el.style.height = '100%'; document.getElementById('here').append(p.el); window.__p = p; return true; })`);
      await wait(80);
    };
    const value = () => ev('JSON.stringify(window.__p.value())').then(JSON.parse);
    const active = () => ev(`(() => { const a = document.activeElement; return a ? (a.getAttribute('aria-label') || a.dataset.shape || a.textContent.trim()) : null; })()`);
    const menuLabels = () => ev(`[...document.querySelectorAll('body > .host-menu .host-menu-item')].map((b) => b.querySelector('.host-menu-label').textContent)`);
    const save = async (ids) => { await ev("document.querySelector('.action-bar-save').click()"); await wait(80); const r = await ev('JSON.stringify(window.__saved[window.__saved.length - 1] || null)').then(JSON.parse); records.push({ r, ids }); return r; };

    for (const mode of ['dark', 'light']) {
      // --- the six shapes, at 1280 ---
      await open({ width: 1280, mode, opts: {} });
      const drawn = await ev(`[...document.querySelectorAll('.layout-picker-shape')].map((b) => { const r = b.getBoundingClientRect(); const view = b.querySelector('.layout-picker-view').getBoundingClientRect();
        const cols = [...b.querySelectorAll('.layout-picker-col')]; const gaps = (cols.length - 1) * parseFloat(getComputedStyle(b.querySelector('.layout-picker-view')).columnGap || 0);
        return { id: b.dataset.shape, role: b.getAttribute('role'), checked: b.getAttribute('aria-checked'), tab: b.tabIndex, top: Math.round(r.top), cells: b.querySelectorAll('.layout-picker-cell').length,
          band: b.querySelector('.layout-picker-band').getBoundingClientRect().width / b.querySelector('.layout-picker-drawing').getBoundingClientRect().width,
          shares: cols.map((c) => 100 * c.getBoundingClientRect().width / (view.width - gaps)), stacked: cols.map((c) => c.querySelectorAll('.layout-picker-cell').length) }; })`);
      ok(drawn.length === 6, `${mode}: ${drawn.length} shapes drawn, wanted 6`);
      ok(new Set(drawn.map((d) => d.top)).size === 2 && drawn.slice(0, 3).every((d) => d.top === drawn[0].top), `${mode}: the shapes are not two rows of three`);
      ok(await ev("document.querySelector('.layout-picker-shapes').getAttribute('role') === 'radiogroup' && Boolean(document.querySelector('.layout-picker-shapes').getAttribute('aria-labelledby'))"), `${mode}: the shapes are not a named radio group`);
      ok(drawn.every((d) => d.role === 'radio' && d.checked === 'false') && drawn.filter((d) => d.tab === 0).length === 1, `${mode}: a new layout should have six radios, none checked, one Tab stop`);
      for (const d of drawn) {
        const def = shapeById(d.id);
        ok(d.cells === def.areas, `${mode} ${d.id}: ${d.cells} areas drawn, wanted ${def.areas}`);
        ok(d.shares.length === def.columns.length && d.shares.every((x, i) => Math.abs(x - def.columns[i]) < 1.5), `${mode} ${d.id}: the columns are ${d.shares.map((x) => x.toFixed(1)).join(', ')} percent, wanted ${def.columns.map((x) => x.toFixed(1)).join(', ')}`);
        ok(d.stacked.reduce((a, x) => a + x, 0) === def.areas && d.stacked.filter((x) => x === 2).length === (def.stacked.length ? 1 : 0), `${mode} ${d.id}: the stacked areas are not drawn in one column`);
        ok(d.band > 0.08 && d.band < 0.2, `${mode} ${d.id}: the chat and call band is ${(d.band * 100).toFixed(0)}% of the drawing; it should be a narrow band`);
      }
      ok(await ev("document.querySelector('[data-step=\"2\"]').disabled"), `${mode}: step 2 is reachable before a shape is picked`);
      ok(await ev("document.querySelector('.action-bar-save').disabled"), `${mode}: Save is on before anything is picked`);

      // --- the keyboard on the shapes ---
      await ev("document.querySelector('.layout-picker-shape[tabindex=\"0\"]').focus()");
      await key('ArrowRight');
      eq(await value(), { shape: 'two-equal', areas: [null, null] }, `${mode}: ArrowRight picks the next shape`);
      ok((await active()) === 'two-equal', `${mode}: the keyboard did not move to the shape it picked`);
      await key('ArrowDown');
      eq((await value()).shape, 'tall-split', `${mode}: ArrowDown picks the shape below`);
      await key('End');
      eq((await value()).shape, 'wide-split', `${mode}: End picks the last shape`);
      await key('Home');
      eq((await value()).shape, 'one', `${mode}: Home picks the first shape`);
      await key('ArrowLeft');
      eq((await value()).shape, 'wide-split', `${mode}: ArrowLeft wraps round`);
      ok(await ev("document.querySelectorAll('.layout-picker-shape[aria-checked=\"true\"]').length === 1 && document.querySelector('.layout-picker-shape[aria-checked=\"true\"]').tabIndex === 0"), `${mode}: one shape checked and it is the Tab stop`);
      await key('Enter');
      ok((await ev('window.__p.step()')) === 2, `${mode}: Enter on a shape did not go on to step 2`);
      ok((await active()) === 'Area 1 of 3: Empty', `${mode}: after Enter the keyboard should be on area 1 (it is on ${await active()})`);
      await key('Tab');
      ok((await active()) === 'Area 2 of 3: Empty', `${mode}: Tab from area 1 should reach area 2 (${await active()})`);
      await key('Tab');
      ok((await active()) === 'Area 3 of 3: Empty', `${mode}: Tab from area 2 should reach area 3 (${await active()})`);

      // --- the menu: what each area offers (Calendar on: To-do refused in the stack) ---
      await key('Enter');
      let labels = await menuLabels();
      ok(labels[0] === 'Empty', `${mode}: the menu should start with Empty (${labels.join(', ')})`);
      eq(labels.slice(1), ['Whiteboard', 'Goals', 'Documents', 'Vault'], `${mode}: a stacked area with the Calendar on offers`);
      ok(/can't share a column; they can go in area 1\./.test(await ev("document.querySelector('.layout-picker-menu-note')?.textContent || ''")), `${mode}: the stacked area's menu does not say what can't go there`);
      ok(await ev("document.querySelector('body > .host-menu').getAttribute('role') === 'menu' && document.querySelectorAll('body > .host-menu [role=\"menuitemradio\"]').length === 5"), `${mode}: the menu is not a menu of radio rows`);
      await key('ArrowDown'); await key('ArrowDown'); await key('Enter'); // Goals
      eq(await value(), { shape: 'wide-split', areas: [null, null, 'goals'] }, `${mode}: a pick by the keyboard`);
      ok((await active()) === 'Area 3 of 3: Goals', `${mode}: after a pick the keyboard should stay on the area (${await active()})`);
      await ev("document.querySelector('.layout-picker-board [data-area=\"1\"]').click()");
      labels = await menuLabels();
      eq(labels.slice(1), ['Whiteboard', 'Goals', 'Documents', 'To-do', 'Calendar', 'Maps', 'Vault'], `${mode}: area 1 offers (never the chat)`);
      ok(/In area 3 now/.test(await ev("[...document.querySelectorAll('body > .host-menu .host-menu-item')].find((b) => b.textContent.includes('Goals')).textContent")), `${mode}: a module in another area does not say so`);
      await ev("[...document.querySelectorAll('body > .host-menu .host-menu-item')].find((b) => b.textContent.startsWith('Calendar')).click()");
      await ev("document.querySelector('.layout-picker-board [data-area=\"2\"]').click()");
      await ev("[...document.querySelectorAll('body > .host-menu .host-menu-item')].find((b) => b.textContent.startsWith('Goals')).click()");
      eq(await value(), { shape: 'wide-split', areas: ['calendar', 'goals', null] }, `${mode}: a module chosen in a second area leaves the first`);
      ok(await ev("document.querySelector('.layout-picker-board [data-area=\"3\"]').classList.contains('empty')"), `${mode}: the emptied area is not drawn empty`);
      ok(!(await ev("document.querySelector('.action-bar-save').disabled")), `${mode}: Save is off after a change`);
      eq(await save(MODS.map((m) => m.id)), { shape: 'wide-split', areas: ['calendar', 'goals', null] }, `${mode}: Save hands back the record`);
      ok(await ev("document.querySelector('.action-bar-save').disabled"), `${mode}: Save is still on after saving`);

      // --- a shape change carries the areas, and never loses the list it carries from ---
      await open({ width: 1280, mode, opts: { record: { shape: 'three-equal', areas: ['goals', 'calendar', 'documents'] } } });
      ok((await ev('window.__p.step()')) === 2, `${mode}: a picker opened on a record should start at step 2`);
      await ev("document.querySelector('.layout-picker-nav').click()");
      ok((await ev('window.__p.step()')) === 1 && (await active()) === 'three-equal', `${mode}: Back did not go to the shapes with the keyboard on the chosen one`);
      await ev("(() => { const b = document.querySelector('.layout-picker-shape[data-shape=\"tall-split\"]'); b.focus(); b.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })); })()");
      eq(await value(), { shape: 'tall-split', areas: ['calendar', 'goals', 'documents'] }, `${mode}: three-equal to tall-split moves the Calendar into area 1`);
      ok((await ev('window.__p.step()')) === 1, `${mode}: Space (a click with no pointer) should pick without going on`);
      await key('Home');
      eq(await value(), { shape: 'one', areas: ['goals'] }, `${mode}: to one keeps the first module`);
      ok(/There is no area left for Calendar and Documents/.test(await ev("document.querySelector('.layout-picker-note').textContent")), `${mode}: what a change took out is not said`);
      await ev("(() => { const b = document.querySelector('.layout-picker-shape[data-shape=\"three-equal\"]'); b.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })); })()");
      eq(await value(), { shape: 'three-equal', areas: ['goals', 'calendar', 'documents'] }, `${mode}: back to three-equal the modules come back (the change carries from step 2's list)`);
      ok((await ev('window.__p.step()')) === 2, `${mode}: a click on a shape should go on to step 2`);
      ok((await ev("document.querySelector('.layout-picker-note').textContent")) === '', `${mode}: the note stayed after nothing was taken out`);

      // --- a refusal, Escape and Cancel ---
      await ev("window.__p.refuse('\"vault\" is not a module you can use here.')");
      ok(await ev("(() => { const e = document.querySelector('.layout-picker-error'); return !e.hidden && e.getAttribute('role') === 'alert' && e.textContent.includes('vault'); })()"), `${mode}: a refusal is not shown under the shape`);
      await ev("document.querySelector('.layout-picker-board [data-area=\"3\"]').click()");
      await ev("[...document.querySelectorAll('body > .host-menu .host-menu-item')].find((b) => b.textContent.startsWith('Empty')).click()");
      await ev("document.querySelector('.layout-picker-board [data-area=\"1\"]').focus()");
      await key('Escape');
      ok(await ev("!document.querySelector('.action-bar-ask').hidden && !window.__cancelled"), `${mode}: Escape with a change should ask first`);
      await ev("document.querySelector('.action-bar-discard').click()");
      ok(await ev('window.__cancelled === true'), `${mode}: Discard did not cancel`);

      // --- To-do in a stacked area where the Calendar is off ---
      const noCal = MODS.filter((m) => m.id !== 'calendar');
      await open({ width: 1280, mode, mods: noCal, opts: { record: { shape: 'tall-split', areas: ['whiteboard', null, null] } } });
      await ev("document.querySelector('.layout-picker-board [data-area=\"2\"]').click()");
      labels = await menuLabels();
      eq(labels.slice(1), ['Whiteboard', 'Goals', 'Documents', 'To-do', 'Vault'], `${mode}: a stacked area with the Calendar off offers To-do, never Maps`);
      await ev("[...document.querySelectorAll('body > .host-menu .host-menu-item')].find((b) => b.textContent.startsWith('To-do')).click()");
      eq(await save(noCal.map((m) => m.id)), { shape: 'tall-split', areas: ['whiteboard', 'todo', null] }, `${mode}: To-do saved in a stacked area while the Calendar is off`);

      // --- a record that names what an area may not hold: emptied, said in one line ---
      await open({ width: 1280, mode, opts: { record: { shape: 'tall-split', areas: ['calendar', 'maps', 'goals'] } } });
      eq(await value(), { shape: 'tall-split', areas: ['calendar', null, 'goals'] }, `${mode}: Maps in a stacked area is taken out`);
      ok((await ev("document.querySelector('.layout-picker-note').textContent")) === "Maps can't share a column, so it was taken out.", `${mode}: the refused module is not named in one sentence`);
      ok(await ev("!document.querySelector('.layout-picker-notice')"), `${mode}: a notice is drawn with no noticeFor`);

      // --- the maker's notice place, read with its area ---
      await open({ width: 1280, mode, opts: { record: { shape: 'two-equal', areas: ['goals', 'todo'] }, noticeFor: null } });
      await ev(`(async () => { const m = await import('/layout-picker.js'); document.getElementById('here').replaceChildren(); const p = m.createLayoutPicker({ modules: window.__mods, record: { shape: 'two-equal', areas: ['goals', 'todo'] }, noticeFor: (id) => (id === 'todo' ? 'Guests can\\'t open this.' : '') }); p.el.style.height = '100%'; document.getElementById('here').append(p.el); return true; })()`);
      ok(await ev("(() => { const b = document.querySelector('.layout-picker-board [data-area=\"2\"]'); const d = document.getElementById(b.getAttribute('aria-describedby') || 'x'); return Boolean(d) && d.textContent.includes('Guests') && !document.querySelector('.layout-picker-board [data-area=\"1\"]').hasAttribute('aria-describedby'); })()"), `${mode}: the notice is not read with its area`);

      // --- read only ---
      await open({ width: 1280, mode, opts: { record: { shape: 'wide-narrow', areas: ['schedule', 'todo'] }, readOnly: true } });
      ok(await ev("document.querySelectorAll('.layout-picker-board button[data-area]').length === 0 && document.querySelector('.layout-picker-steps').hidden && document.querySelector('.action-bar-save').hidden && !document.querySelector('.layout-picker-nav')"), `${mode}: read only should press nothing and offer only Close`);

      // --- a phone: two rows of three; step 2 one row per area, 44px and more ---
      await open({ width: 390, mode, opts: { record: { shape: 'wide-split', areas: ['calendar', 'goals', null] } } });
      const phone = await ev(`(() => { const rows = [...document.querySelectorAll('.layout-picker-row-main')].filter((b) => b.getClientRects().length);
        return { board: document.querySelector('.layout-picker-board').getClientRects().length, rows: rows.map((b) => ({ h: b.getBoundingClientRect().height, w: b.getBoundingClientRect().width, name: b.getAttribute('aria-label') })),
          overflow: document.documentElement.scrollWidth > innerWidth, bar: [...document.querySelectorAll('.action-bar button')].filter((b) => b.getClientRects().length).map((b) => { const h = b.getBoundingClientRect().height; const a = getComputedStyle(b, '::after'); return Math.round(a.content !== 'none' && a.position === 'absolute' ? h - 2 * parseFloat(a.top) : h); }) }; })()`);
      ok(phone.board === 0, '390: the large drawing should not show on a phone');
      eq(phone.rows.map((r) => r.name), ['Area 1 of 3: Calendar', 'Area 2 of 3: Goals', 'Area 3 of 3: Empty'], `${mode} 390: one row per area`);
      ok(phone.rows.every((r) => r.h >= 44 && r.w > 300), `${mode} 390: a row is under 44px tall or narrow: ${JSON.stringify(phone.rows)}`);
      ok(phone.bar.every((h) => h >= 44), `${mode} 390: a bar button's target (its box, or a small button's hit area) is under 44px: ${phone.bar}`);
      ok(!phone.overflow, `${mode} 390: the page scrolls sideways`);
      await ev("document.querySelector('.layout-picker-row-main[data-area=\"3\"]').focus()");
      await key('Enter');
      eq((await menuLabels()).slice(1), ['Whiteboard', 'Goals', 'Documents', 'Vault'], `${mode} 390: a row's menu offers what its area may hold`);
      await key('ArrowDown'); await key('Enter');
      eq(await save(MODS.map((m) => m.id)), { shape: 'wide-split', areas: ['calendar', 'goals', 'whiteboard'] }, `${mode} 390: a row's pick is saved`);
      await ev("document.querySelector('.layout-picker-nav').click()");
      const shapes = await ev("[...document.querySelectorAll('.layout-picker-shape')].map((b) => { const r = b.getBoundingClientRect(); return { top: Math.round(r.top), h: r.height, right: r.right }; })");
      ok(new Set(shapes.map((x) => x.top)).size === 2 && shapes.every((x) => x.h >= 44 && x.right <= 390), `${mode} 390: the shapes are not two rows of three inside the screen: ${JSON.stringify(shapes)}`);
    }
    ok(!errors.length, `the page threw: ${errors.join(' | ')}`);
  } catch (err) {
    fail(`browser part: ${err.message}`);
  } finally {
    try { ws.close(); } catch { /* closing */ }
    server.close();
    await stopBrowser(child, dir);
  }
  // Every record Save handed back passes the server's own check.
  ok(records.length >= 6, `only ${records.length} records were saved`);
  for (const { r, ids } of records) {
    ok(r && Object.keys(r).join() === 'shape,areas', `a saved record has other keys: ${JSON.stringify(r)}`);
    const c = cleanShape(r, { modules: ids });
    ok(!c.error && JSON.stringify(c.shape) === JSON.stringify(r), `cleanShape refuses a record the picker saved: ${JSON.stringify(r)}: ${c.error}`);
  }
}

if (failures.length) {
  console.error(`check-layout-picker: ${failures.length} problem(s):\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(`check-layout-picker: ${passed} checks passed${note}.`);
