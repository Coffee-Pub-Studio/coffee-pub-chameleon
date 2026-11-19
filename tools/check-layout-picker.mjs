#!/usr/bin/env node
/*
 * check-layout-picker.mjs -- the layout picker (public/layout-picker.js; documentation/plans/plan-layout-picker.md, step 4).
 *
 *   1. In Node: the picker's pure parts. carryAreas keeps a module in its area where it may stay, moves the rest into a free
 *      area that may hold them (swapping a Calendar into area 1), keeps a module once, and says what it dropped and why;
 *      putInArea moves a module rather than doubling it; droppedNote and refusedNote say it in one sentence; partsFor reads
 *      composites.js. What areaChoices offers agrees with cleanShape() (server/layout-shapes.js) for every shape, area and
 *      module, with the Calendar on and off, so the picker never offers what the server refuses; ids the server refuses
 *      (MODULE_ID) are never offered, and a module listed twice is offered once. Odd input throws nowhere. noticeWords
 *      says the maker's notice for one role, several (moderator, member, guest, by the environment's words), a module
 *      that is off, the host console's "by default" form, and nothing for a module not in cantOpen; it is drawn as text.
 *  1b. In Node: a template's layout in its editor (public/template-layout.js, step 5): only a whole record is sent, the areas
 *      offer the template's canvas modules (never the chat or the call), what is no longer ticked is found in area order and
 *      said in plain words before saving, a template with no layout is said plainly, and Manage's notice says "environment".
 *      layoutRecord takes exactly what the server's cleanShape takes, for every shape and arrangement, Calendar on and off;
 *      a tick that moves modules says what moved (movedNote), and none of these lines carries a direction character.
 *   2. In Chromium (skipped, said so, when there is none), with real keys over the DevTools protocol, at 1280 and 390, light
 *      and dark: six shapes drawn in two rows of three, each with its number of areas at the shape's percentages; picking a
 *      shape carries the areas sensibly and a shape change never loses the list it carries from; the area menu offers Empty
 *      first, then what the area may hold (no Calendar or Maps in a stacked area, no To-do there while the Calendar is on,
 *      To-do there when it is off); a module chosen in a second area leaves the first; the keyboard (arrows on the shapes,
 *      Enter on, Tab through the areas in order, the menu by Enter); the names a screen reader hears (each shape's name is
 *      its label alone; each area is heard with its notice); the notice under each area from cantOpen, in the muted
 *      colour with its warning icon; no id twice in the picker; after Save the keyboard is on Close; Save hands back
 *      exactly { shape, areas }, and every record handed back passes cleanShape(); Escape with changes asks first; at 390
 *      step 2 is one row per area, each at least 44px tall, its chevron at the end of its first line above a notice, the
 *      two steps on one line, and the drawing is not shown.
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
const T = await import(pathToFileURL(path.join(tmp, 'template-layout.js')).href);
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
// Ids the server refuses are never offered, and a module listed twice is offered once.
{
  const odd = ['__proto__', 'Goals', 'a'.repeat(33), 'with.dot', '1abc', 'dest:calendar', 'dest:map', '', 'goals', 'goals', 'vault'];
  const mods = odd.map((id) => ({ id }));
  for (const s of SHAPES) {
    for (let a = 1; a <= s.areas; a += 1) {
      const offered = P.areaChoices(s, a, mods, { parts: [] }).map((m) => m.id);
      eq(offered, ['goals', 'vault'], `${s.id} area ${a}: offered from odd ids`);
      for (const id of offered) ok(!cleanShape({ shape: s.id, areas: Array.from({ length: s.areas }, (_, i) => (i === a - 1 ? id : null)) }, { modules: odd.filter(Boolean) }).error, `${s.id} area ${a}: ${id} offered and refused`);
    }
  }
  eq(P.cleanModules([{ id: 'goals' }, { id: 'goals', name: 'Again' }, null, { id: 'x.y' }]).map((m) => m.id), ['goals'], 'cleanModules');
}
// Odd input: nothing throws, nothing is written where it should not be.
{
  const tall = shapeById('tall-split');
  const threw = (fn) => { try { fn(); return false; } catch { return true; } };
  ok(!threw(() => P.carryAreas(['goals'], null, () => true)), 'carryAreas with no shape throws');
  eq(P.carryAreas(['goals'], null, () => true), { areas: [], dropped: [] }, 'carryAreas with no shape');
  eq(P.carryAreas(['goals'], tall, null), { areas: [], dropped: [] }, 'carryAreas with no rule');
  ok(!threw(() => P.refusedNote(null, tall)) && P.refusedNote(null, tall) === '', 'refusedNote(null) throws or says something');
  eq(P.refusedNote(['Calendar'], { id: 'x', areas: 2, stacked: [1, 2] }), '', 'refusedNote with every area stacked');
  eq(P.refusedNote(['Calendar'], null), '', 'refusedNote with no shape');
  eq(P.putInArea(['goals', null], 0, 'vault'), { areas: ['goals', null], from: 0 }, 'putInArea at area 0');
  eq(P.putInArea(['goals', null], 9, 'vault'), { areas: ['goals', null], from: 0 }, 'putInArea past the end');
  eq(P.putInArea(null, 1, 'vault'), { areas: [], from: 0 }, 'putInArea with no list');
  eq(P.droppedNote([{ why: 'stack' }, null, { id: '', why: 'full' }]), '', 'droppedNote with entries that name nothing');
  eq(P.areaChoices(tall, 0, [{ id: 'goals' }]), [], 'areaChoices at area 0');
  eq(P.areaChoices(null, 1, [{ id: 'goals' }]), [], 'areaChoices with no shape');
}
// A shape claiming more areas than any shape has is not drawn or counted (it once ran Node out of memory); ids the
// server's rule refuses never reach an area; names lose control and direction characters.
{
  const huge = { id: 'huge', areas: 1e7, columns: [100], stacked: [2] };
  const t = Date.now();
  eq(P.refusedNote(['A'], huge), '', 'refusedNote with a huge area count');
  eq(P.carryAreas(['goals'], huge, () => true), { areas: [], dropped: [] }, 'carryAreas with a huge area count');
  eq(P.areaChoices(huge, 5, [{ id: 'goals' }]), [], 'areaChoices with a huge area count');
  ok(Date.now() - t < 500, 'a huge area count took too long');
  ok(P.MAX_AREAS === Math.max(...SHAPES.map((x) => x.areas)), 'MAX_AREAS is the largest shape');
  const three = shapeById('three-equal');
  eq(P.carryAreas(['__proto__', 'Goals', 'goals', 'dest:calendar', 'a'.repeat(33), 'with.dot'], three, () => true), { areas: [null, null, 'goals'], dropped: [] }, 'carryAreas drops ids the server refuses, unnamed');
  eq(P.cleanText('\u202Egnp.exe\u202C Docs\u200F\n'), 'gnp.exe Docs', 'cleanText strips direction and control characters');
  eq(P.cleanModules([{ id: 'goals', name: '\u202EslaoG' }, { id: 'vault', name: '\u0007' }]).map((m) => m.name), ['slaoG', 'vault'], 'cleanModules cleans names, the id when none is left');
}
// The maker's notice (plan, "The maker's notice"; decisions 17 and 19), by the environment's words for the roles.
{
  eq(P.noticeWords({ roles: ['guest'] }), "Guests can't open this. For them, this area closes up.", 'notice, one role');
  eq(P.noticeWords({ roles: ['guest', 'member'] }), "Members and guests can't open this. For them, this area closes up.", 'notice, two roles, in the order moderator, member, guest');
  eq(P.noticeWords({ roles: ['guest', 'moderator', 'member'] }), "Moderators, members and guests can't open this. For them, this area closes up.", 'notice, three roles');
  eq(P.noticeWords({ off: true }), 'Off in this space. This area closes up for everyone.', 'notice, off in the space');
  eq(P.noticeWords({ roles: ['guest'] }, { byDefault: true }), "Guests can't open this by default.", 'notice, by default');
  eq(P.noticeWords({ roles: ['member', 'guest'] }, { byDefault: true }), "Members and guests can't open this by default.", 'notice, two roles by default');
  eq(P.noticeWords(undefined), '', 'notice, a module not in cantOpen');
  eq(P.noticeWords({ roles: [] }), '', 'notice, no roles');
  eq(P.noticeWords({ roles: ['owner', 'admin'] }), '', 'notice, roles never listed');
  const students = (key, o) => ({ member: o && o.many ? 'students' : 'student', guest: o && o.many ? 'guests' : 'guest', moderator: 'moderators' }[key]);
  eq(P.noticeWords({ roles: ['member'] }, { wordOf: students }), "Students can't open this. For them, this area closes up.", 'notice, the environment\'s word for members');
  // The notice is text: nothing in it goes through innerHTML.
  const src = fs.readFileSync(path.join(ROOT, 'public/layout-picker.js'), 'utf8');
  const fn = src.slice(src.indexOf('function noticeEl('), src.indexOf('function areaContent('));
  ok(fn.length > 50 && !/innerHTML|insertAdjacentHTML/.test(fn) && /textContent = text/.test(fn), 'the notice is not drawn as text only');
  // Manage's template pages: a module off in the environment (offIn), and the default stays the space.
  eq(P.noticeWords({ off: true }, { offIn: 'environment' }), 'Off in this environment. This area closes up for everyone.', 'notice, off in the environment');
  eq(P.noticeWords({ off: true }, { offIn: 'environment', byDefault: true }), 'Not installed. This area closes up for everyone.', 'notice, by default wins over offIn');
}

// ---- 1b. A template's layout in its editor (public/template-layout.js; plan step 5) ----
{
  // What is sent: only a whole record the shape check can take.
  eq(T.layoutRecord({ shape: 'wide-narrow', areas: ['travel', 'vault'] }), { shape: 'wide-narrow', areas: ['travel', 'vault'] }, 'a valid record is sent');
  eq(T.layoutRecord({ shape: 'one', areas: [null] }), { shape: 'one', areas: [null] }, 'an empty area is a valid record');
  for (const [bad, why] of [[null, 'none'], [{ shape: 'nine', areas: [null] }, 'unknown shape'], [{ shape: 'one', areas: [] }, 'too few areas'], [{ shape: 'one', areas: [null, null] }, 'too many areas'], [{ shape: 'two-equal', areas: ['goals', 'goals'] }, 'a module twice'], [{ shape: 'one', areas: ['Goals'] }, 'a capital'], [{ shape: 'one', areas: ['__proto__'] }, '__proto__'], [{ shape: 'one', areas: [7] }, 'a number'], [{ shape: 'one' }, 'no areas']]) eq(T.layoutRecord(bad), null, `not sent: ${why}`);
  const rec = { shape: 'two-equal', areas: ['goals', null] };
  const back = T.layoutRecord(rec);
  back.areas.push('x');
  eq(rec.areas, ['goals', null], 'the record sent is a copy');
  // What an area offers: the template's modules with a place on the canvas, never the chat or the call, each once.
  const names = { goals: 'Learning plan', documents: 'Documents', assistant: 'AI Assistant' };
  eq(T.templateLayoutModules(['chat', 'conference', 'goals', 'assistant', 'documents', 'goals', 'Bad', 7], { isCanvas: (id) => id !== 'assistant', nameOf: (id) => names[id], iconOf: () => 'star' }),
    [{ id: 'goals', name: 'Learning plan', icon: 'star' }, { id: 'documents', name: 'Documents', icon: 'star' }], 'the template\'s canvas modules, once, in order');
  eq(T.templateLayoutModules(undefined), [], 'no modules');
  // What the layout uses that is no longer ticked, in area order, and the two lines saying so before saving.
  eq(T.layoutMissing({ shape: 'tall-split', areas: ['whiteboard', 'goals', 'documents'] }, ['documents', 'chat']), ['whiteboard', 'goals'], 'the unticked ones, in area order');
  eq(T.layoutMissing({ shape: 'one', areas: [null] }, []), [], 'an empty area is never missing');
  eq(T.layoutMissing(null, []), [], 'no layout, nothing missing');
  eq(T.missingNote(['Whiteboard'], { where: 'Modules' }), 'The layout uses Whiteboard, which is not ticked under Modules. Tick it again, or take it out of the layout.', 'beside the picker, one');
  eq(T.missingNote(['Whiteboard', 'Goals'], { where: 'Modules' }), 'The layout uses Whiteboard and Goals, which are not ticked under Modules. Tick them again, or take them out of the layout.', 'beside the picker, two');
  eq(T.missingNote([]), '', 'nothing to say');
  eq(T.usesNote(['Vault']), 'The layout on the Default Workspace tab uses Vault. Tick it again, or take it out of the layout there.', 'under Modules, one');
  eq(T.usesNote(['Vault', 'Polls']), 'The layout on the Default Workspace tab uses Vault and Polls. Tick them again, or take them out of the layout there.', 'under Modules, two');
  eq(T.noLayoutWords((k) => k), 'No layout. A new space opens the chat and every module that is on.', 'no layout, in plain words');
  // layoutRecord takes exactly what cleanShape takes (the form, the chat and the call, the stacked areas), for every shape
  // and every arrangement of these ids, with the Calendar on and off (`parts` as the editor gives it: partsFor of the
  // template's modules). Whether a module is the template's is the server's alone, so the ids are the template's here.
  {
    let compared = 0;
    const wrong = [];
    for (const calendar of [true, false]) {
      const mods = ['calendar', 'todo', 'maps', 'goals', 'documents', 'chat', 'conference'].filter((x) => calendar || x !== 'calendar');
      const parts = P.partsFor(mods);
      const ids = [...mods, null];
      const combos = (n) => (n === 0 ? [[]] : combos(n - 1).flatMap((c) => ids.map((id) => [...c, id])));
      for (const sh of SHAPES) for (const areas of combos(sh.areas)) {
        const rec = { shape: sh.id, areas };
        const mine = Boolean(T.layoutRecord(rec, { parts }));
        const theirs = !cleanShape(rec, { modules: mods, on: mods }).error;
        compared += 1;
        if (mine !== theirs) wrong.push(`${JSON.stringify(rec)} calendar ${calendar ? 'on' : 'off'}: page ${mine}, server ${theirs}`);
      }
    }
    ok(compared > 1000 && !wrong.length, `layoutRecord and cleanShape disagree on ${wrong.length} of ${compared}: ${wrong.slice(0, 3).join('; ')}`);
    eq(T.layoutRecord({ shape: 'tall-split', areas: ['goals', 'todo', null] }), null, 'told nothing, To-do in a stacked area is refused (as the server reads it)');
    eq(T.layoutRecord({ shape: 'tall-split', areas: ['goals', 'todo', null] }, { parts: [] }), { shape: 'tall-split', areas: ['goals', 'todo', null] }, 'with the Calendar off, To-do may share a column');
    eq(T.layoutRecord({ shape: 'one', areas: ['chat'] }, { parts: [] }), null, 'the chat is never in an area');
  }
  // What moved when the Calendar was ticked under a stacked To-do (decision 25), and nothing when it was unticked again.
  {
    const def = shapeById('tall-split');
    const names = { todo: 'To-do', travel: 'Itinerary', vault: 'Vault', calendar: 'Calendar' };
    const on = ['todo'];
    const before = { shape: 'tall-split', areas: ['travel', 'vault', 'todo'] };
    const carried = P.carryAreas(before.areas, def, (area, id) => areaMayHold(def, area, id, { parts: on }));
    eq(carried.areas, ['todo', 'vault', 'travel'], 'the Calendar on: To-do swaps into area 1');
    eq(T.movedNote(before, { shape: 'tall-split', areas: carried.areas }, { nameOf: (id) => names[id], parts: on, mayHold: (area, id) => areaMayHold(def, area, id, { parts: on }) }),
      "To-do moved to area 1: while Calendar is on, it can't share a column. Itinerary moved to area 3 to free area 1.", 'what moved, said');
    const back = P.carryAreas(before.areas, def, (area, id) => areaMayHold(def, area, id, { parts: [] }));
    eq(back.areas, before.areas, 'the Calendar off again: from the person\'s arrangement, it is back as it was');
    eq(T.movedNote(before, { shape: 'tall-split', areas: back.areas }, { parts: [] }), '', 'nothing moved, nothing said');
    eq(T.movedNote(null, before), '', 'no arrangement, nothing said');
  }
  // No control or direction character (U+202A to U+202E, U+2066 to U+2069, and the rest) reaches a line from a typed name.
  {
    const bidi = /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/;
    const typed = ['Go\u202Eals', '\u2066Vault\u2069', '\u202Ax\u202C', '\u2067\u2068'];
    const lines = [T.missingNote(typed, { where: 'Modules' }), T.usesNote(typed), T.movedNote({ shape: 'two-equal', areas: ['goals', 'vault'] }, { shape: 'two-equal', areas: ['vault', 'goals'] }, { nameOf: (id) => (id === 'goals' ? typed[0] : typed[1]) })];
    ok(lines.every((l) => l && !bidi.test(l)), `a direction character reached a line: ${JSON.stringify(lines)}`);
    eq(T.missingNote(['Go\u202Eals', '\u2067\u2068'], { where: 'Modules' }), 'The layout uses Goals, which is not ticked under Modules. Tick it again, or take it out of the layout.', 'a name left empty is not said');
    eq(T.usesNote(['\u2066Vault\u2069']), 'The layout on the Default Workspace tab uses Vault. Tick it again, or take it out of the layout there.', 'usesNote cleans the name');
  }
  // Every record the picker can be left holding passes the server's check against the template's modules.
  const mods = ['whiteboard', 'goals', 'documents', 'todo', 'calendar'];
  for (const s of SHAPES) {
    const areas = mods.slice(0, s.areas);
    const r = T.layoutRecord({ shape: s.id, areas: areas.map((id, i) => (i === 0 ? id : null)) });
    ok(r && !cleanShape(r, { modules: mods, on: mods }).error, `${s.id}: a record sent passes cleanShape`);
  }
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
    // The names and descriptions a screen reader gets, from the browser's own accessibility tree.
    const ax = async (role) => {
      const { nodes } = await s('Accessibility.getFullAXTree');
      return nodes.filter((n) => !n.ignored && n.role && n.role.value === role).map((n) => ({ name: n.name ? n.name.value : '', description: (n.description && n.description.value) || '' }));
    };
    const dupIds = () => ev("(() => { const ids = [...document.querySelectorAll('.layout-picker [id]')].map((x) => x.id); return ids.filter((x, i) => ids.indexOf(x) !== i); })()");
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
      eq((await ax('radio')).map((r) => r.name), ['One', 'Two equal', 'Large and narrow', 'Three equal', 'Two, right split', 'Large, right split'], `${mode}: each shape's name is its label alone`);
      ok((await ax('radio')).every((r) => /^(One|Two|A|Three)\b.*\.$/.test(r.description)), `${mode}: a shape's description is missing`);
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
      await wait(50);
      ok((await ev("(() => { const a = document.activeElement; return a && a.classList.contains('action-bar-cancel') ? a.textContent.trim() : (a ? a.tagName : 'none'); })()")) === 'Close', `${mode}: after Save the keyboard should be on Close`);

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

      // --- the maker's notice from cantOpen: one role, several, off, none; read with its area ---
      const cant = { documents: { roles: ['guest'] }, goals: { roles: ['guest', 'member'] }, vault: { off: true } };
      await open({ width: 1280, mode, opts: { record: { shape: 'three-equal', areas: ['goals', 'documents', 'vault'] }, cantOpen: cant } });
      const notices = await ev(`[1, 2, 3].map((a) => { const b = document.querySelector('.layout-picker-board [data-area="' + a + '"]'); const d = document.getElementById(b.getAttribute('aria-describedby') || 'x'); return d ? d.textContent : ''; })`);
      eq(notices, ["Members and guests can't open this. For them, this area closes up.", "Guests can't open this. For them, this area closes up.", 'Off in this space. This area closes up for everyone.'], `${mode}: the notices under the areas`);
      const areaAx = (await ax('button')).filter((b) => /^Area \d of 3/.test(b.name));
      ok(areaAx.some((b) => b.name === 'Area 2 of 3: Documents' && b.description === "Guests can't open this. For them, this area closes up."), `${mode}: a screen reader does not hear the notice with its area: ${JSON.stringify(areaAx)}`);
      ok(await ev("(() => { const probe = document.createElement('span'); probe.style.color = 'var(--text-dim)'; document.body.append(probe); const want = getComputedStyle(probe).color; probe.remove(); return getComputedStyle(document.querySelector('.layout-picker-notice')).color === want; })()") && await ev("Boolean(document.querySelector('.layout-picker-notice .fa-triangle-exclamation[aria-hidden=\"true\"]'))"), `${mode}: the notice is not in the muted text colour with a warning icon`);
      eq(await dupIds(), [], `${mode}: duplicate ids in the picker`);
      // A module not in cantOpen has no notice; a new choice gets its notice at once.
      await ev("document.querySelector('.layout-picker-board [data-area=\"3\"]').click()");
      await ev("[...document.querySelectorAll('body > .host-menu .host-menu-item')].find((b) => b.textContent.startsWith('Whiteboard')).click()");
      ok(await ev("!document.querySelector('.layout-picker-board [data-area=\"3\"]').hasAttribute('aria-describedby') && !document.querySelector('.layout-picker-board [data-area=\"3\"] .layout-picker-notice')"), `${mode}: a module not in cantOpen has a notice`);
      await ev("document.querySelector('.layout-picker-board [data-area=\"3\"]').click()");
      await ev("[...document.querySelectorAll('body > .host-menu .host-menu-item')].find((b) => b.textContent.startsWith('Vault')).click()");
      ok((await ev("document.querySelector('.layout-picker-board [data-area=\"3\"] .layout-picker-notice')?.textContent || ''")) === 'Off in this space. This area closes up for everyone.', `${mode}: a module chosen does not get its notice at once`);
      await ev("window.__p.setCantOpen({ goals: { roles: ['member'] } })");
      eq(await ev("[...document.querySelectorAll('.layout-picker-board .layout-picker-notice')].map((x) => x.textContent)"), ["Members can't open this. For them, this area closes up."], `${mode}: setCantOpen redraws the notices`);
      // The host console's template editor: by default.
      await open({ width: 1280, mode, opts: { record: { shape: 'two-equal', areas: ['goals', 'documents'] }, cantOpen: { documents: { roles: ['guest'] } }, byDefault: true } });
      eq(await ev("[...document.querySelectorAll('.layout-picker-board .layout-picker-notice')].map((x) => x.textContent)"), ["Guests can't open this by default."], `${mode}: the by-default notice`);

      // --- read only ---
      await open({ width: 1280, mode, opts: { record: { shape: 'wide-narrow', areas: ['schedule', 'todo'] }, readOnly: true } });
      ok(await ev("document.querySelectorAll('.layout-picker-board button[data-area]').length === 0 && document.querySelector('.layout-picker-steps').hidden && document.querySelector('.action-bar-save').hidden && !document.querySelector('.layout-picker-nav')"), `${mode}: read only should press nothing and offer only Close`);

      // --- the chosen shape is a fill, not a border or a ring; the keyboard's focus ring still shows ---
      await open({ width: 1280, mode, opts: { record: { shape: 'two-equal', areas: [null, null] }, step: 1 } });
      const look = await ev(`(() => { const on = document.querySelector('.layout-picker-shape.selected'); const off = document.querySelector('.layout-picker-shape:not(.selected)'); const a = getComputedStyle(on); const b = getComputedStyle(off);
        return { border: a.borderTopColor === b.borderTopColor, ring: a.boxShadow, fill: a.backgroundColor !== b.backgroundColor, check: getComputedStyle(on.querySelector('.layout-picker-shape-check')).visibility }; })()`);
      ok(look.border && look.ring === 'none' && look.fill && look.check === 'visible', `${mode}: the chosen shape should be a fill with its check mark, its edge as the others': ${JSON.stringify(look)}`);
      await ev("document.querySelector('.layout-picker-shape.selected').focus()");
      await key('ArrowRight'); await key('ArrowLeft');
      const ring = await ev("(() => { const a = document.activeElement; const c = getComputedStyle(a); return { sel: a.classList.contains('selected'), outline: c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0 }; })()");
      ok(ring.sel && ring.outline, `${mode}: the keyboard's focus ring does not show on the chosen shape: ${JSON.stringify(ring)}`);

      // --- a record naming ids the server refuses: nothing drawn, nothing handed back; names drawn without direction marks ---
      await open({ width: 1280, mode, mods: [...MODS, { id: 'polls', name: '\u202Esllop\u202C Polls' }], opts: { record: { shape: 'three-equal', areas: ['__proto__', 'Goals', 'polls'] } } });
      eq(await value(), { shape: 'three-equal', areas: [null, null, 'polls'] }, `${mode}: ids the server refuses are kept out of the record`);
      const drawnText = await ev("document.querySelector('.layout-picker-board').textContent + '|' + [...document.querySelectorAll('.layout-picker [aria-label]')].map((x) => x.getAttribute('aria-label')).join('|')");
      const firstTwo = await ev("[1, 2].map((a) => document.querySelector('.layout-picker-board [data-area=\"' + a + '\"]').getAttribute('aria-label'))");
      ok(!/__proto__/.test(drawnText) && firstTwo.join('|') === 'Area 1 of 3: Empty|Area 2 of 3: Empty', `${mode}: a refused id is drawn: ${firstTwo.join('|')} ${drawnText}`);
      ok(!/[\u202A-\u202E\u2066-\u2069]/.test(drawnText) && /sllop Polls/.test(drawnText), `${mode}: a name is drawn with its direction characters: ${JSON.stringify(drawnText)}`);
      await ev("document.querySelector('.layout-picker-board [data-area=\"1\"]').click()");
      ok(!(await menuLabels()).some((l) => /[\u202A-\u202E]/.test(l)), `${mode}: the menu draws a name with its direction characters`);
      await key('Escape');

      // --- a phone: two rows of three; step 2 one row per area, 44px and more ---
      await open({ width: 390, mode, opts: { record: { shape: 'wide-split', areas: ['calendar', 'goals', null] }, cantOpen: { goals: { roles: ['member', 'guest'] } } } });
      const row2 = await ev(`(() => { const b = document.querySelector('.layout-picker-row-main[data-area="2"]'); const r = b.getBoundingClientRect(); const c = b.querySelector('.layout-picker-area-caret').getBoundingClientRect(); const n = b.querySelector('.layout-picker-notice').getBoundingClientRect(); const w = b.querySelector('.layout-picker-area-what').getBoundingClientRect();
        return { caretRight: r.right - c.right, caretAbove: c.bottom <= n.top + 1, caretBesideName: c.top < w.bottom && c.bottom > w.top }; })()`);
      ok(row2.caretRight < 24 && row2.caretAbove && row2.caretBesideName, `${mode} 390: a row's chevron is not at the end of its first line: ${JSON.stringify(row2)}`);
      eq(await dupIds(), [], `${mode} 390: duplicate ids in the picker`);
      const steps = await ev("[...document.querySelectorAll('.layout-picker-step')].map((b) => { const r = b.getBoundingClientRect(); return { top: Math.round(r.top), right: r.right, h: r.height }; })");
      ok(steps[0].top === steps[1].top && steps[1].right <= 390 && steps.every((x) => x.h >= 44), `${mode} 390: the two steps are not on one line, inside the screen, 44px tall: ${JSON.stringify(steps)}`);
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
    // The Design System page shows each notice form: its layout-picker entries, run here as the page runs them.
    {
      const vm = await import('node:vm');
      const ctx = { window: {} };
      ctx.window.window = ctx.window;
      ctx.window.DSH = { fa: () => '' };
      vm.createContext(ctx);
      vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/design-system/components-3.js'), 'utf8'), ctx);
      const specs = (ctx.window.DS_LIVE || []).filter((x) => /^live-layout-picker/.test(x.id));
      const seen = [];
      for (const spec of specs) {
        await open({ width: 1280, mode: 'light', opts: {} });
        await ev(`(async () => { document.getElementById('here').innerHTML = ${JSON.stringify(spec.body)}; await (async function () { ${spec.script} })(); return true; })()`);
        await wait(80);
        seen.push(...(await ev("[...document.querySelectorAll('.layout-picker-board .layout-picker-notice')].map((x) => x.textContent)")));
      }
      for (const want of ["Guests can't open this. For them, this area closes up.", "Members and guests can't open this. For them, this area closes up.", 'Off in this space. This area closes up for everyone.', "Guests can't open this by default.", "Members and guests can't open this by default.", 'Not installed. This area closes up for everyone.']) {
        ok(seen.includes(want), `the Design System page does not show the notice "${want}" (it shows ${JSON.stringify(seen)})`);
      }
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
