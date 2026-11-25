#!/usr/bin/env node
/*
 * check-layouts.mjs -- layouts for everyone (documentation/plans/plan-saved-layouts.md, GitHub #161; plan-layout-picker.md,
 * decision 5): the pure shape check cleanLayout(), the limit, DATA_DIR/layouts.json (shared per space), the clean-up when a
 * space or a person is removed, and the four routes under /api/spaces/:id/layouts with their codes for an owner, a
 * moderator, a member, someone not in the space, a guest and nobody signed in. A person's own layouts and favorites are
 * gone (plan-workspaces.md, decision 44): POST takes only a layout for everyone, a file's `people` and `favorites` are
 * dropped on read, and there is no .../favorite route. Step 4: a space's defaultLayout (owners, the admin and
 * moderators), cleared when its layout is deleted, carried by GET /api/modules/for-space. Layout views, step 1
 * (documentation/plans/plan-layout-views.md): layouts gain kind and icon; the system layouts are made per space from what
 * is on and never stored, with their own names and icons (a person's own name, icon and tab for them are gone, issue
 * #1091, and a file's old `system` key is dropped on read). Step 5 (the first visit as one choice): defaultLayout also takes calendar and map while
 * they are on in the space, it and the template's layout are independent, and GET .../layouts and
 * GET /api/modules/for-space carry the resolved `firstVisit`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { Layouts, LayoutError, cleanLayout, LAYOUT_LIMITS, SYSTEM_IDS } = require('../server/layouts.js');
import { pathToFileURL } from 'node:url';
const { Store } = require('../server/store.js');
const SHB = { shape: 'one', areas: [null] }; // a shared layout's body: a shape and its areas
const ONE = { shape: 'one', areas: [null] }; // the Default template's layout, which a space with no template of its own starts with

let n = 0;
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `check-layouts-${name}-`));
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const SH = { shape: 'two-equal', areas: ['calendar', 'notes'] };
const G = () => ({ name: 'Game night', shared: true, ...SH }); // a layout for everyone, as POST takes it
// A free-form layout (the canvas's own arrangement), which only the page's layoutOf() and placeLayout() read now; the
// server refuses it (a person's own layout is a workspace).
const good = () => ({
  name: 'Game night',
  modules: [
    { id: 'conference', mode: 'dock' },
    { id: 'chat', mode: 'float', box: { x: 0.7, y: 0.05, w: 0.27, h: 0.6 }, snap: false },
    { id: 'calendar', mode: 'dock', dockW: 360 },
  ],
  snap: { all: false, pitch: 130 },
});
const refused = (input, pattern, label, options) => {
  const out = cleanLayout(input, options);
  assert.ok(out.error && !out.layout, `${label}: refused (${JSON.stringify(out)})`);
  if (pattern) assert.match(out.error, pattern, label);
  assert.match(out.error, /^[^\n]+\.$/, `${label}: one sentence`);
  n += 1;
};

// --- the conference and the chat in a layout (plan-one-bar.md, step 6) ------------------------------------------
// They live in the always-on column, so the page's layoutOf() never saves them and placeLayout() leaves them alone.
{
  const dir = tmp('column');
  fs.copyFileSync(path.join(ROOT, 'public/snap-grid.js'), path.join(dir, 'snap-grid.mjs'));
  const src = fs.readFileSync(path.join(ROOT, 'public/layouts.js'), 'utf8');
  fs.writeFileSync(path.join(dir, 'layouts.mjs'), src.replace("from '/snap-grid.js'", "from './snap-grid.mjs'"));
  const { layoutOf, placeLayout, COLUMN_IDS } = await import(pathToFileURL(path.join(dir, 'layouts.mjs')).href);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual([...COLUMN_IDS], ['conference', 'chat'], 'the column holds the conference and the chat');
  const area = { x: 0, y: 0, w: 1200, h: 800 };
  const saved = layoutOf([{ id: 'conference', mode: 'dock', order: -1, flex: true }, { id: 'chat', mode: 'dock', order: 0, width: 320 }, { id: 'calendar', mode: 'dock', order: 1, width: 360 }], area);
  assert.deepEqual(saved.modules.map((m) => m.id), ['calendar'], 'layoutOf() leaves the two out');
  const placed = placeLayout(good(), area);
  assert.deepEqual(placed.modules.map((m) => m.id), ['calendar'], 'placeLayout() places neither');
  assert.deepEqual(placed.left, [], 'and names neither as left out');
  n += 1;
  // The composite (plan-calendar-todo.md, step 3; public/composites.js's aliasesFor): a stored `calendar` is placed as
  // `dest:calendar`, once, with its mode and places; the layout itself is not rewritten, and where the Calendar is off a
  // stored `dest:calendar` places nothing. To-do is never part of it: it places as its own module. The page saves a
  // composite under its main module's id, so the server's store (module ids only) takes it.
  const on = { calendar: 'dest:calendar' };
  const old = { modules: [{ id: 'todo', mode: 'float', box: { x: 0.1, y: 0.1, w: 0.4, h: 0.5 } }, { id: 'notes', mode: 'dock', dockW: 300 }, { id: 'calendar', mode: 'dock', dockW: 360 }], snap: { all: false, pitch: 130 } };
  const before = JSON.stringify(old);
  const read = placeLayout(old, area, () => true, on);
  assert.deepEqual(read.modules.map((m) => [m.id, m.mode]), [['todo', 'float'], ['notes', 'dock'], ['dest:calendar', 'dock']], 'placeLayout() places the To-do as itself and the Calendar as the composite');
  assert.deepEqual(read.left, [], 'and leaves nothing out');
  assert.equal(JSON.stringify(old), before, 'the stored layout is not rewritten');
  const off = placeLayout(old, area, (id) => id !== 'calendar', { 'dest:calendar': [] });
  assert.deepEqual([off.modules.map((m) => m.id), off.left], [['todo', 'notes'], ['calendar']], 'with the Calendar off the To-do still places, canOpen deciding');
  const none = placeLayout({ modules: [{ id: 'dest:calendar', mode: 'dock' }] }, area, () => true, { 'dest:calendar': [] });
  assert.deepEqual([none.modules, none.left], [[], []], 'and nothing, not left out, where the Calendar is off');
  const saved2 = layoutOf([{ id: 'calendar', mode: 'dock', order: 1, width: 360 }, { id: 'todo', mode: 'float', order: 2, box: { x: 10, y: 10, w: 300, h: 300 } }], area, {}, on);
  assert.deepEqual(saved2.modules.map((m) => m.id), ['dest:calendar', 'todo'], 'layoutOf() through the aliases saves the composite once and the To-do as itself');
  // The Map (plan-map-places.md, step 3): a stored `maps` places `dest:map` once while the space's Map is
  // shown; with no map file (no aliases for it) it places as itself, and a stored `dest:map` places Maps.
  const mapOn = { maps: 'dest:map' };
  const oldMap = { modules: [{ id: 'maps', mode: 'dock', dockW: 300 }, { id: 'travel', mode: 'dock', dockW: 360 }], snap: { all: false, pitch: 130 } };
  const beforeMap = JSON.stringify(oldMap);
  const readMap = placeLayout(oldMap, area, () => true, mapOn);
  assert.deepEqual(readMap.modules.map((m) => [m.id, m.mode]), [['dest:map', 'dock'], ['travel', 'dock']], 'placeLayout() reads maps as the Map, with its mode');
  assert.equal(JSON.stringify(oldMap), beforeMap, 'the stored layout is not rewritten');
  assert.deepEqual(placeLayout(oldMap, area, () => true, {}).modules.map((m) => m.id), ['maps', 'travel'], 'with no map file Maps places as itself');
  assert.deepEqual(placeLayout({ modules: [{ id: 'dest:map', mode: 'dock' }] }, area, () => true, { 'dest:map': ['maps'] }).modules.map((m) => m.id), ['maps'], 'a stored dest:map places Maps where there is no map file');
  assert.deepEqual(layoutOf([{ id: 'maps', mode: 'dock', order: 1, width: 360 }], area, {}, mapOn).modules.map((m) => m.id), ['dest:map'], 'layoutOf() through the aliases saves the Map once');
  // A module's own snap (Thomas, 2026-10-13: the canvas-level switch is the only one): an older stored layout with one
  // still places, the field ignored; the page never saves it.
  const oldSnap = { name: 'Old', modules: [{ id: 'todo', mode: 'float', box: { x: 0.1, y: 0.1, w: 0.4, h: 0.5 }, snap: true }], snap: { all: false, pitch: 130 } };
  const oldPlaced = placeLayout(oldSnap, area);
  assert.deepEqual(oldPlaced.modules.map((m) => [m.id, m.snap, Boolean(m.cell)]), [['todo', false, false]], 'a module\'s own stored snap is ignored');
  assert.ok(placeLayout({ ...oldSnap, snap: { all: true, pitch: 130 } }, area).modules[0].cell, 'the canvas-level snap still snaps it');
  assert.ok(!('snap' in layoutOf([{ id: 'todo', mode: 'float', order: 1, box: { x: 10, y: 10, w: 300, h: 300 }, snap: true }], area).modules[0]), 'layoutOf() never saves a module\'s own snap');
  n += 1;
}

// --- cleanLayout: the name, the kind and a PUT ---------------------------------------------------------------------
// A layout for everyone is the only kind (plan-workspaces.md, decision 44); the free-form keys of the canvas's own
// arrangement (modules, snap, arrange) are refused whatever their value, and so is a layout that is not `shared: true`.

{
  assert.deepEqual(cleanLayout(G()).layout, G(), 'a good layout comes back as sent');
  assert.equal(cleanLayout({ ...G(), name: '  Game \t night  ' }).layout.name, 'Game night', 'the name is trimmed, its whitespace collapsed');
  assert.equal(cleanLayout({ ...G(), name: '\u00e9'.repeat(LAYOUT_LIMITS.name) }).layout.name.length, 40, '40 characters is allowed');
  assert.deepEqual(Object.keys(LAYOUT_LIMITS).sort(), ['name', 'shared'], 'the server keeps only the limits of a layout for everyone');
  n += 1;

  refused(null, /JSON/, 'not an object');
  refused([], /JSON/, 'a list');
  refused({ ...G(), extra: 1 }, /"extra"/, 'an unknown top-level field');
  refused({ ...G(), name: undefined }, /name/, 'no name');
  refused({ ...G(), name: '   ' }, /name/, 'a blank name');
  refused({ ...G(), name: 7 }, /text/, 'a name that is not text');
  refused({ ...G(), name: 'x'.repeat(41) }, /40 characters/, 'a name of 41 characters');
  for (const shared of [undefined, false, 'yes']) refused({ ...G(), shared }, /^A layout of your own is a workspace now/, `shared ${JSON.stringify(shared)}`);
  for (const [key, value] of [['modules', []], ['modules', null], ['snap', { all: true, pitch: 100 }], ['arrange', 'window']]) {
    refused({ ...G(), [key]: value }, /^A layout for everyone is a shape; pick one with the picker\.$/, `${key} ${JSON.stringify(value)}`);
  }
  refused({ name: 'Mine', modules: [{ id: 'calendar', mode: 'dock' }] }, /^A layout for everyone is a shape/, 'a free-form layout');

  // A PUT: name, or shape with areas; never shared.
  assert.deepEqual(cleanLayout({ name: 'Planning' }, { partial: true }).layout, { name: 'Planning' });
  assert.deepEqual(cleanLayout({}, { partial: true }).layout, {});
  refused({ shared: true }, /^A layout for everyone stays one/, 'a PUT cannot change the kind', { partial: true });
  refused({ name: '' }, /name/, 'a PUT with a blank name', { partial: true });
  refused({ modules: [] }, /^A layout for everyone is a shape/, 'a PUT with modules', { partial: true });
}

// --- cleanLayout: a layout for everyone is a shape (plan-layout-picker.md, step 6; decision 5) -----------------------
{
  const opts = { shapeOptions: { modules: ['calendar', 'polls', 'todo', 'notes'], on: ['calendar', 'polls', 'todo', 'notes'], names: { calendar: 'Calendar', polls: 'Votes', todo: 'To-do', notes: 'Notes', vault: 'Vault' } } };
  const offCalendar = { shapeOptions: { modules: ['polls', 'todo', 'notes'], on: ['polls', 'todo', 'notes'], names: { polls: 'Votes', todo: 'To-do', notes: 'Notes' } } };
  const sh = (shape, areas, more = {}) => ({ name: 'For all', shared: true, shape, areas, ...more });
  const sharedRefused = (input, pattern, label, options = opts) => {
    const out = cleanLayout(input, options);
    assert.ok(out.error && !out.layout, `${label}: refused (${JSON.stringify(out)})`);
    assert.match(out.error, pattern, label);
    assert.match(out.error, /^[^\n]+\.$/, `${label}: one sentence`);
    assert.ok(Array.isArray(out.problems) && out.problems[0] === out.error && out.parts.length === out.problems.length, `${label}: problems and parts`);
    n += 1;
    return out;
  };
  // Each shape is accepted with modules and with empty areas, and comes back as a shape and its areas, no free-form keys.
  for (const [shape, areas] of [['one', ['calendar']], ['one', [null]], ['two-equal', ['calendar', null]], ['wide-narrow', ['polls', 'calendar']], ['three-equal', ['calendar', 'polls', 'todo']], ['tall-split', ['calendar', 'polls', null]], ['wide-split', ['calendar', null, 'notes']]]) {
    assert.deepEqual(cleanLayout(sh(shape, areas), opts).layout, { name: 'For all', shared: true, shape, areas }, `${shape} ${JSON.stringify(areas)}`);
  }
  n += 1;
  assert.equal(cleanLayout(sh('one', [null], { name: '  Our \t day ', icon: 'couch' }), { ...opts, icons: ['couch'] }).layout.name, 'Our day');
  assert.equal(cleanLayout(sh('one', [null], { icon: 'couch' }), opts).layout.icon, 'couch', 'a shared shape takes an icon');
  // With no list of modules, any well-formed id passes (the pure check alone).
  assert.ok(cleanLayout(sh('two-equal', ['anything', null])).layout, 'with no module list given');
  // The shape rules reach the layout: To-do stacks while the Calendar is off in the space, and not once it is on.
  assert.ok(cleanLayout(sh('tall-split', ['polls', 'todo', 'notes']), offCalendar).layout, 'To-do in a stacked area where the Calendar is off');
  assert.ok(cleanLayout(sh('tall-split', ['polls', 'todo', 'notes']), opts).layout, 'To-do in a stacked area where the Calendar is on: it has its own window');
  sharedRefused(sh('wide-split', ['polls', 'calendar', null]), /^Calendar can't share a column; put it in area 1\.$/, 'Calendar in a stacked area');
  sharedRefused(sh('nine', [null]), /^Pick a shape from the list\.$/, 'an unknown shape');
  sharedRefused({ name: 'x', shared: true, areas: [null] }, /^Pick a shape from the list\.$/, 'no shape');
  sharedRefused(sh('two-equal', [null]), /^This shape has 2 areas\.$/, 'the wrong area count');
  sharedRefused(sh('one', 'calendar'), /^This shape has 1 area\.$/, 'areas not a list');
  sharedRefused(sh('two-equal', ['chat', null]), /column on the left/, 'the chat');
  sharedRefused(sh('two-equal', [null, 'conference']), /column on the left/, 'the call');
  sharedRefused(sh('two-equal', ['polls', 'polls']), /^Votes is in two areas; a module can be in one area only\.$/, 'a module twice, named as the space shows it');
  sharedRefused(sh('two-equal', ['vault', null]), /^Vault is not available in this space\.$/, 'a module that is not on in the space');
  sharedRefused(sh('one', [7]), /^Area 1 takes a module or nothing\.$/, 'an area that is not text');
  const two = sharedRefused(sh('three-equal', ['vault', 'polls', 'polls']), /./, 'two problems');
  assert.deepEqual([two.problems.length, two.parts], [2, ['areas', 'areas']], 'every sentence, with its part');
  for (const key of ['modules', 'snap', 'arrange']) sharedRefused(sh('one', [null], { [key]: key === 'snap' ? { all: true, pitch: 100 } : key === 'arrange' ? 'dock' : [] }), /^A layout for everyone is a shape; pick one with the picker\.$/, `${key} on a shared layout`);
  sharedRefused(sh('one', [null], { widths: [100] }), /does not take "widths"/, 'a width');
  // Hostile ids and names: one short plain line, the id quoted without anything but printable ASCII, a name cleaned.
  for (const id of ['__proto__', 'constructor', 'a\nb', '‮evil', '<img src=x onerror=1>', 'x'.repeat(80), '', 'Polls']) {
    const out = sharedRefused(sh('one', [id]), /./, `hostile id ${JSON.stringify(id).slice(0, 20)}`);
    assert.match(out.error, /^("[ -~]{0,40}"|That id) is not a module you can use here\.$/, out.error);
  }
  // A character that is not printable shows as ?, so no id reads as another one; an id with nothing printable has no text.
  for (const [id, want] of [['to\ndo', '"to?do" is not a module you can use here.'], ['\u202etodo', '"?todo" is not a module you can use here.'], ['', 'That id is not a module you can use here.'], ['\u00e9'.repeat(300), 'That id is not a module you can use here.'], ['t\u00e9st', '"t?st" is not a module you can use here.']]) {
    assert.equal(sharedRefused(sh('one', [id]), /./, `an id with unprintable characters ${JSON.stringify(id).slice(0, 12)}`).error, want);
  }
  // A module on in the space with no place on the canvas: it can't go in an area, named as the space shows it.
  const noArea = sharedRefused(sh('one', ['assistant']), /./, 'a module with no canvas place', { shapeOptions: { modules: ['notes'], names: { assistant: 'AI Assistant', notes: 'Notes' }, noArea: ['assistant'] } });
  assert.equal(noArea.error, "AI Assistant can't go in an area.");
  assert.equal(sharedRefused(sh('one', ['vault']), /./, 'a module not on at all', { shapeOptions: { modules: ['notes'], names: { vault: 'Vault' }, noArea: ['assistant'] } }).error, 'Vault is not available in this space.');
  const hostileName = cleanLayout(sh('one', ['notes']), { shapeOptions: { modules: ['notes'], names: { notes: '<b>x\nyz</b>'.repeat(10) } } });
  assert.ok(hostileName.layout, 'a hostile name only matters in a sentence');
  const dup = cleanLayout(sh('two-equal', ['notes', 'notes']), { shapeOptions: { modules: ['notes'], names: { notes: 'a\nb'.repeat(30) } } });
  assert.ok(!dup.error.includes('\n') && dup.error.length < 120, 'a name with a line break in a sentence is cleaned and cut');
  // A PUT: a shape and its areas, or a name.
  const asShared = { partial: true, ...opts };
  assert.deepEqual(cleanLayout({ name: 'Renamed' }, asShared).layout, { name: 'Renamed' }, 'a rename of a shape');
  assert.deepEqual(cleanLayout({ shape: 'two-equal', areas: ['polls', null] }, asShared).layout, { shape: 'two-equal', areas: ['polls', null] }, 'a replace');
  assert.deepEqual(cleanLayout({}, asShared).layout, {}, 'nothing to change is the route\'s to refuse');
  refused({ shape: 'two-equal' }, /^This shape has 2 areas\.$/, 'a shape with no areas', asShared);
  refused({ areas: [null] }, /^Pick a shape from the list\.$/, 'areas with no shape', asShared);
  refused({ modules: [] }, /^A layout for everyone is a shape/, 'modules on a shared PUT', asShared);
  n += 1;
}

// --- the file: free-form shared layouts are dropped on read (plan-layout-picker.md, decision 5) ------------------------
{
  const dir = tmp('dropped');
  const file = path.join(dir, 'layouts.json');
  const entry = (id, more) => ({ id, name: `Layout ${id}`, by: 'x', at: '2026-11-01T00:00:00.000Z', ...more });
  const own = entry('lown001', { modules: [{ id: 'chat', mode: 'dock' }] });
  fs.writeFileSync(file, JSON.stringify({ spaces: {
    s1: {
      shared: [
        entry('lfree01', { modules: [{ id: 'calendar', mode: 'dock', dockW: 360 }], snap: { all: false, pitch: 130 } }),
        entry('lshape1', { shape: 'tall-split', areas: ['calendar', 'polls', null] }),
        entry('lnoshap', { areas: [null] }),
        entry('lbadshp', { shape: 'nine', areas: [null] }),
        entry('lbadlen', { shape: 'two-equal', areas: [null] }),
        entry('lboth01', { shape: 'one', areas: [null], modules: [] }),
        entry('lnullmd', { shape: 'one', areas: [null], modules: null }),
        entry('lstrmod', { shape: 'one', areas: [null], modules: 'x' }),
        entry('lsnap01', { shape: 'one', areas: [null], snap: { all: true, pitch: 100 } }),
        entry('larrng1', { shape: 'one', areas: [null], arrange: 'dock' }),
        entry('lunk001', { shape: 'one', areas: [null], icon: 'couch', evil: '<img onerror=alert(1)>' }),
        entry('lcal001', { shape: 'tall-split', areas: ['polls', 'calendar', null] }),
        entry('ltodo01', { shape: 'tall-split', areas: ['polls', 'todo', null] }),
      ],
      people: { pat: [own] },
      favorites: { pat: ['lfree01', 'lshape1', 'lown001'] },
      last: { pat: { layout: 'lfree01', at: 5 }, sam: { layout: 'lshape1', at: 6 } },
    },
    s2: { shared: [entry('lfree02', { modules: [] })], people: {} },
  } }));
  const read = new Layouts(dir);
  assert.deepEqual(read.sharedOf('s1').map((l) => l.id), ['lshape1', 'lunk001', 'ltodo01'], 'only the valid shapes stay (any modules, snap or arrange key drops an entry, null or text too; an unknown key is cut but the entry stays): a free-form one, a bad or missing shape, a wrong count and one with modules are dropped; a Calendar in a stacked area too, a To-do there is kept (the Calendar may be off)');
  assert.deepEqual(Object.keys(read.sharedOf('s1').find((l) => l.id === 'lunk001')).sort(), ['areas', 'at', 'by', 'icon', 'id', 'name', 'shape'], 'only the shape fields are kept: an unknown key never reaches an answer');
  assert.ok(!('people' in read.spaces.s1) && !('favorites' in read.spaces.s1), 'a file\'s own layouts and favorites are dropped on read (plan-workspaces.md, decision 44)');
  assert.equal(read.lastOf('s1', 'pat'), null, 'and so is a last layout');
  assert.equal(read.lastOf('s1', 'sam'), 'lshape1', 'one that names a shape stays');
  assert.equal(read.find('s1', 'lfree01'), null, 'a dropped one is not found');
  assert.ok(!read.spaces.s2, 'a space left with nothing is dropped');
  assert.equal(readJson(file).spaces.s1.shared.length, 13, 'reading rewrites nothing');
  read.add('s1', 'pat', { name: 'Later', shared: true, shape: 'one', areas: [null] });
  assert.deepEqual(readJson(file).spaces.s1.shared.map((l) => l.id).slice(0, 3), ['lshape1', 'lunk001', 'ltodo01'], 'the dropped ones leave the file at the next save');
  assert.ok(!('people' in readJson(file).spaces.s1), 'and a person\'s own with them');
  assert.ok(!('s2' in readJson(file).spaces), 'and their space with them');
  // The limit counts the shapes that are left, and a layout of the same name as a dropped one can be saved.
  assert.doesNotThrow(() => read.add('s1', 'pat', { name: 'Layout lfree01', shared: true, shape: 'one', areas: [null] }), 'the name of a dropped layout is free');
  fs.rmSync(dir, { recursive: true, force: true });
  n += 1;

  // A space's defaultLayout that names a dropped layout reads as none, and a first visit opens the Workspace.
  const dir2 = tmp('dropped-default');
  const store = new Store(dir2);
  const pat = store.addUser({ login: 'pat', displayName: 'Pat', role: 'member', passwordHash: 'x' });
  const a = store.addSpace({ name: 'A', members: [pat.key] });
  const kept = store.layouts.add(a.id, pat.key, { name: 'Kept', shared: true, ...SHB });
  store.updateSpace(a.id, { defaultLayout: kept.id });
  const raw = readJson(path.join(dir2, 'app.json'));
  raw.spaces.find((r) => r.id === a.id).defaultLayout = 'lfree01';
  fs.writeFileSync(path.join(dir2, 'app.json'), JSON.stringify(raw));
  const again = new Store(dir2);
  assert.equal(again.defaultLayoutOf(a.id), null, 'a default that names a dropped layout reads as none');
  assert.equal(again.defaultLayoutOf(a.id) === null && again.layouts.find(a.id, 'lfree01'), null);
  assert.throws(() => again.updateSpace(a.id, { defaultLayout: 'lfree01' }), (e) => e.status === 404, 'and cannot be set again');
  fs.rmSync(dir2, { recursive: true, force: true });
  n += 1;
}

// --- the file: lists, limits, names, clean-up --------------------------------------------------------------------

{
  const dir = tmp('file');
  const layouts = new Layouts(dir);
  assert.ok(!fs.existsSync(path.join(dir, 'layouts.json')), 'nothing written until something is saved');
  const g = cleanLayout(G()).layout;
  const shared = layouts.add('s1', 'pat', { ...g, ...SH, shared: true });
  assert.match(shared.id, /^l[a-z0-9]{6}$/);
  assert.equal(shared.by, 'pat');
  assert.ok(!Number.isNaN(Date.parse(shared.at)));
  assert.ok(!('shared' in shared), 'shared is where it is kept, not a field');
  const onDisk = readJson(path.join(dir, 'layouts.json'));
  assert.deepEqual(Object.keys(onDisk), ['spaces']);
  assert.equal(onDisk.spaces.s1.shared[0].id, shared.id);
  assert.deepEqual(new Layouts(dir).list('s1'), layouts.list('s1'), 'read back as written');
  assert.deepEqual(Object.keys(layouts.list('s1')), ['shared'], 'only the layouts for everyone: a person\'s own is a workspace (plan-workspaces.md, decision 44)');

  // Names unique, regardless of case: 409 with the id of the one that has it.
  assert.throws(() => layouts.add('s1', 'sam', { ...g, ...SH, shared: true, name: 'GAME night' }), (e) => e instanceof LayoutError && e.status === 409 && e.extra.id === shared.id && e.message === 'There is already a layout called Game night.');
  assert.equal(layouts.add('s2', 'pat', { ...g, ...SH, shared: true }).name, 'Game night', 'the same name in another space is fine');

  // 10 shared per space.
  for (let i = 1; i < 10; i += 1) layouts.add('s1', 'sam', { ...g, ...SH, shared: true, name: `Shared ${i}` });
  assert.throws(() => layouts.add('s1', 'pat', { ...g, ...SH, shared: true, name: 'Eleventh shared' }), (e) => e.status === 409 && e.message === 'This space has 10 shared layouts. Delete one first.');

  // Rename and replace; a rename onto a taken name is a 409.
  assert.equal(layouts.update('s1', shared.id, { name: 'Game Night' }).name, 'Game Night');
  assert.throws(() => layouts.update('s1', shared.id, { name: 'shared 1' }), (e) => e.status === 409);
  const replaced = layouts.update('s1', shared.id, { shape: 'one', areas: ['notes'] });
  assert.deepEqual([replaced.shape, replaced.areas, 'modules' in replaced], ['one', ['notes'], false], 'a shared layout is replaced with a shape');
  assert.equal(replaced.by, 'pat', 'by stays who saved it first');
  assert.equal(layouts.update('s1', 'lnosuch', { name: 'Taken' }), null, 'nothing to change');
  const extra = layouts.list('s1').shared.find((l) => l.name === 'Shared 9');
  assert.equal(layouts.remove('s1', 'lnosuch'), false);
  assert.equal(layouts.remove('s1', extra.id), true);
  assert.equal(layouts.find('s1', extra.id), null);

  // A removed space takes its layouts; a removed person's shared ones stay (they are the space's).
  layouts.forgetPerson('pat');
  const after = readJson(path.join(dir, 'layouts.json'));
  assert.ok(after.spaces.s1.shared.some((l) => l.id === shared.id), 'the shared one pat saved stays');
  layouts.forgetSpace('s1');
  layouts.forgetSpace('s2');
  assert.deepEqual(readJson(path.join(dir, 'layouts.json')), { spaces: {} });
  n += 1;

  // A later version's extra fields survive a read and a write here; malformed entries are dropped.
  const dir2 = tmp('extra');
  fs.writeFileSync(path.join(dir2, 'layouts.json'), JSON.stringify({ spaces: { s1: { shared: [{ id: 'lfuture', name: 'Future', by: 'x', at: 'now', shape: 'one', areas: ['notes'], later: true }, { id: 'lold', name: 'Free-form', by: 'x', at: 'now', modules: [{ id: 'chat', mode: 'dock' }] }, 'junk', { id: 7 }], people: { pat: 'junk' } } } }));
  const kept = new Layouts(dir2);
  kept.add('s1', 'pat', { ...g, ...SH, shared: true });
  const back = readJson(path.join(dir2, 'layouts.json')).spaces.s1;
  assert.equal(back.shared.length, 2, 'the free-form shared layout is dropped on read, and the shape stays (beside the new one)');
  assert.ok(!('later' in back.shared[0]), 'a shared layout keeps only the shape fields, so a field this version does not know is cut');
  n += 1;

  // A file that is there but cannot be read is never written over: lists read empty, every change refused with a 500.
  const dir3 = tmp('broken');
  fs.writeFileSync(path.join(dir3, 'layouts.json'), '{ not json');
  const broken = new Layouts(dir3);
  assert.deepEqual(broken.list('s1'), { shared: [] });
  assert.throws(() => broken.add('s1', 'pat', { ...g, ...SH, shared: true }), (e) => e.status === 500 && /cannot be read/.test(e.message));
  broken.forgetSpace('s1');
  broken.forgetPerson('pat');
  assert.equal(fs.readFileSync(path.join(dir3, 'layouts.json'), 'utf8'), '{ not json', 'left exactly as it was');
  n += 1;
  for (const d of [dir, dir2, dir3]) fs.rmSync(d, { recursive: true, force: true });
}

// --- layout views, step 1: kind and icon; the system layouts store nothing per person -----------------------------------

{
  assert.deepEqual([...SYSTEM_IDS], ['workspace', 'calendar', 'map', 'conference', 'whiteboard', 'documents', 'schedule']);
  // cleanLayout takes an icon (an id from the list it is given); the rest is as before.
  assert.equal(cleanLayout({ ...G(), icon: 'couch' }, { icons: ['couch', 'columns'] }).layout.icon, 'couch', 'an icon from the list');
  assert.equal(cleanLayout({ ...G(), icon: 'couch' }).layout.icon, 'couch', 'any well-formed id when no list is given');
  refused({ ...G(), icon: 'sofa' }, /^Pick an icon from the list\.$/, 'an icon not in the list', { icons: ['couch'] });
  refused({ ...G(), icon: 7 }, /Pick an icon/, 'an icon that is not text');
  refused({ ...G(), icon: 'Bad Icon!' }, /Pick an icon/, 'a malformed icon id');
  assert.equal(cleanLayout({ icon: 'couch' }, { partial: true, icons: ['couch'] }).layout.icon, 'couch', 'a PUT may change only the icon');

  // Stored layouts have no kind or icon; the list reads them as kind user with the default icon, the file untouched.
  const dir = tmp('system');
  const file = path.join(dir, 'layouts.json');
  const layouts = new Layouts(dir);
  const g = cleanLayout(G()).layout;
  const plain = layouts.add('s1', 'pat', { ...g, ...SH, shared: true });
  const iconed = layouts.add('s1', 'pat', { ...g, ...SH, shared: true, name: 'Iconed', icon: 'couch' });
  assert.ok(!('kind' in readJson(file).spaces.s1.shared[0]) && !('icon' in readJson(file).spaces.s1.shared[0]), 'nothing is rewritten with a kind or an icon');
  const listed = layouts.list('s1');
  assert.deepEqual(listed.shared.map((l) => [l.kind, l.icon]), [['user', 'object-group'], ['user', 'couch']], 'kind user, the default icon, or the stored one');
  assert.equal(layouts.update('s1', iconed.id, { icon: 'star' }).icon, 'star', 'a PUT changes a layout\'s icon');
  layouts.remove('s1', plain.id);
  layouts.remove('s1', iconed.id);
  assert.deepEqual(readJson(file), { spaces: {} });

  // A person's own name, icon and tab for a system layout are gone (issue #1091): a file's old `system` key is dropped on
  // read, with `people` and `favorites`, and nothing is written for it. Each person's `last` stays.
  const dir2 = tmp('system-gone');
  fs.writeFileSync(path.join(dir2, 'layouts.json'), JSON.stringify({ spaces: {
    s1: { shared: [], people: {}, favorites: {}, system: { pat: { workspace: { name: 'Desk', icon: 'couch' }, map: { tab: false } } } },
    s2: { shared: [], system: { pat: { calendar: { name: 'Plans' } } }, last: { pat: { layout: 'calendar', at: 1 } } },
  } }));
  const gone = new Layouts(dir2);
  assert.deepEqual(gone.spaces, { s2: { shared: [], last: { pat: { layout: 'calendar', at: 1 } } } }, 'the old system key is dropped on read');
  assert.ok(!('systemOf' in gone) && !('setSystem' in gone), 'and nothing reads or writes it');
  assert.deepEqual(gone.iconIds(), [], 'an old system icon is not counted as in use');
  gone.setLast('s2', 'pat', 'map');
  assert.ok(!('system' in readJson(path.join(dir2, 'layouts.json')).spaces.s2), 'the next save leaves it out');
  assert.throws(() => { fs.writeFileSync(path.join(dir2, 'layouts.json'), '{ not json'); new Layouts(dir2).setLast('s1', 'pat', 'map'); }, (e) => e.status === 500, 'an unreadable file is never written over');
  n += 1;
  for (const d of [dir, dir2]) fs.rmSync(d, { recursive: true, force: true });
}

// --- the store: removeSpace and removeUser take their layouts ---------------------------------------------------

{
  const dir = tmp('store');
  const store = new Store(dir);
  const pat = store.addUser({ login: 'pat', displayName: 'Pat', role: 'member', passwordHash: 'x' });
  const sam = store.addUser({ login: 'sam', displayName: 'Sam', role: 'member', passwordHash: 'x' });
  const a = store.addSpace({ name: 'A', members: [pat.key, sam.key] });
  const b = store.addSpace({ name: 'B', members: [pat.key, sam.key] });
  const g = cleanLayout(G()).layout;
  store.layouts.add(a.id, sam.key, { ...g, ...SH, shared: true });
  store.layouts.add(b.id, pat.key, { ...g, ...SH, shared: true });
  store.layouts.setLast(b.id, pat.key, 'workspace');
  store.layouts.setLast(b.id, sam.key, 'workspace');
  store.removeSpace(a.id);
  let file = readJson(path.join(dir, 'layouts.json'));
  assert.ok(!file.spaces[a.id], 'a removed space takes its layouts');
  store.removeUser(pat.key);
  file = readJson(path.join(dir, 'layouts.json'));
  assert.deepEqual(Object.keys(file.spaces[b.id].last), [sam.key], 'a removed person takes their last layout');
  assert.equal(file.spaces[b.id].shared.length, 1, 'and the shared layout they saved stays');
  assert.equal(path.dirname(store.layouts.file), dir, "layouts.json is in the environment's data folder, which its export and backup zip whole");
  fs.rmSync(dir, { recursive: true, force: true });
  n += 1;
}

// --- stacks, the page's half (plan-panel-stacking.md, step 6): public/layouts.js --------------------------------------
// layoutOf() saves a stack top first where its column is, with an id of its own in the layout; placeLayout() reads it
// back, closing a stack up where a module is left out (one left is a column of its own) and taking equal heights where
// there are no shares. The server keeps no free-form layout any more (a workspace's arrangement is server/workspaces.js's).
{
  const dir = tmp('stack-page');
  fs.copyFileSync(path.join(ROOT, 'public/snap-grid.js'), path.join(dir, 'snap-grid.mjs'));
  fs.writeFileSync(path.join(dir, 'layouts.mjs'), fs.readFileSync(path.join(ROOT, 'public/layouts.js'), 'utf8').replace("from '/snap-grid.js'", "from './snap-grid.mjs'"));
  const page = await import(pathToFileURL(path.join(dir, 'layouts.mjs')).href);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const k of ['shared', 'name']) assert.equal(page.LAYOUT_LIMITS[k], LAYOUT_LIMITS[k], `the page's LAYOUT_LIMITS.${k} is the server's`);
  const area = { x: 0, y: 0, w: 1200, h: 800 };
  const open = [
    { id: 'travel', mode: 'dock', order: 1, width: 400 },
    { id: 'polls', mode: 'dock', order: 3, width: 300, stack: 'k2x9', at: 1, h: 0.3 },
    { id: 'todo', mode: 'dock', order: 2, width: 300, stack: 'k2x9', at: 0, h: 0.7, folded: true },
    { id: 'notes', mode: 'float', order: 4, box: { x: 10, y: 10, w: 300, h: 300 }, stack: 'k2x9', at: 2 },
  ];
  const saved = page.layoutOf(open, area);
  assert.deepEqual(saved.modules.map((m) => [m.id, m.stack, m.at, m.h, m.folded]), [['travel', undefined, undefined, undefined, undefined], ['todo', 's1', 0, 0.7, true], ['polls', 's1', 1, 0.3, false], ['notes', undefined, undefined, undefined, undefined]], 'layoutOf() saves the stack top first where its column is, and never a floating module in it');
  const kept = { name: 'Stacked', ...saved };
  const back = page.placeLayout(kept, area);
  assert.deepEqual(back.modules.filter((m) => m.stack).map((m) => [m.id, m.at, m.h, m.folded]), [['todo', 0, 0.7, true], ['polls', 1, 0.3, false]], 'placeLayout() reads the stack back');
  const one = page.placeLayout(kept, area, (id) => id !== 'polls');
  assert.ok(!one.modules.some((m) => 'stack' in m) && one.left.includes('polls'), 'a stack left with one module is an ordinary column');
  const three = page.placeLayout({ modules: [{ id: 'a', mode: 'dock', stack: 'q', at: 0, h: 0.2 }, { id: 'b', mode: 'dock', stack: 'q', at: 1, h: 0.3 }, { id: 'c', mode: 'dock', stack: 'q', at: 2, h: 0.5 }] }, area, (id) => id !== 'b');
  assert.deepEqual(three.modules.map((m) => [m.id, m.at, m.h]), [['a', 0, 0.2857], ['c', 1, 0.7143]], 'one left out of three: the other two close up, their shares made whole');
  const unshared = { name: 'x', modules: [{ id: 'a', mode: 'dock', stack: 'q', at: 0 }, { id: 'b', mode: 'dock', stack: 'q', at: 1 }] };
  assert.deepEqual(page.placeLayout(unshared, area).modules.map((m) => m.h), [0.5, 0.5], 'a stack with no shares is equal heights');
  const twenty = page.layoutOf(Array.from({ length: 21 }, (_, i) => ({ id: `m${i}`, mode: 'dock', order: i, ...(i >= 19 ? { stack: 'z', at: i - 19 } : {}) })), area);
  assert.ok(twenty.modules.length === 20 && !twenty.modules.some((m) => 'stack' in m), 'a stack cut by the 20 module limit is no stack');
  n += 8;
}

// --- the store: a space's default layout (step 4) -----------------------------------------------------------------

{
  const dir = tmp('default');
  const store = new Store(dir);
  const pat = store.addUser({ login: 'pat', displayName: 'Pat', role: 'member', passwordHash: 'x' });
  const a = store.addSpace({ name: 'A', members: [pat.key] });
  const g = cleanLayout(G()).layout;
  assert.ok(!('defaultLayout' in store.spaceById(a.id)), 'absent while not set');
  const shared = store.layouts.add(a.id, pat.key, { ...g, ...SH, shared: true });

  // Setting it leaves the record's other fields alone; refusals change nothing. A space keeps no Opens with of its own
  // (the template decides, plan-templates-redesign.md, decision 8): asking to set one is refused and changes nothing.
  let space = store.updateSpace(a.id, { defaultLayout: shared.id });
  assert.equal(space.defaultLayout, shared.id);
  assert.ok(!('opensWith' in space) && !('layout' in space), 'the record keeps no layout of its own');
  assert.deepEqual(store.defaultLayoutOf(a.id), store.layouts.find(a.id, shared.id).layout, 'the whole layout');
  const storeRefused = (patch, status, pattern, label) => {
    const before = JSON.stringify(store.spaceById(a.id));
    assert.throws(() => store.updateSpace(a.id, { name: 'Renamed', ...patch }), (e) => e.status === status && pattern.test(e.message) && /^[A-Z][^\n]*\.$/.test(e.message), label);
    assert.equal(JSON.stringify(store.spaceById(a.id)), before, `${label}: nothing changed`);
    n += 1;
  };
  storeRefused({ defaultLayout: 'lnosuch' }, 404, /no shared layout/, 'no such layout');
  storeRefused({ defaultLayout: 7 }, 400, /shared layout's id/, 'not an id');
  storeRefused({ defaultLayout: 'calendar' }, 400, /Calendar is not on in this space/, 'Calendar with no way to tell it is on');
  store.systemLayoutOn = (spaceId, id) => spaceId === a.id && id === 'calendar';
  storeRefused({ defaultLayout: 'map' }, 400, /Map is not on in this space/, 'Map while it is off');
  space = store.updateSpace(a.id, { defaultLayout: 'calendar' });
  assert.equal(space.defaultLayout, 'calendar', 'a system id is kept as it is');
  assert.equal(store.defaultLayoutOf(a.id), null, 'defaultLayoutOf is a shared layout only');
  store.syncDefaultLayout(a.id);
  assert.equal(store.spaceById(a.id).defaultLayout, 'calendar', 'a system id is not cleared by a layout clean-up');
  space = store.updateSpace(a.id, { defaultLayout: 'workspace' });
  assert.ok(!('defaultLayout' in space), 'workspace is the same as none');
  space = store.updateSpace(a.id, { defaultLayout: shared.id });
  assert.equal(space.defaultLayout, shared.id);

  // Replacing its modules leaves the default; a rename does not touch it.
  store.layouts.update(a.id, shared.id, { shape: 'one', areas: ['notes'] });
  store.syncDefaultLayout(a.id);
  assert.equal(store.spaceById(a.id).defaultLayout, shared.id);

  // Kept across a restart.
  assert.equal(new Store(dir).spaceById(a.id).defaultLayout, shared.id, 'read back as written');
  store.updateSpace(a.id, { defaultLayout: 'calendar' });
  assert.equal(new Store(dir).spaceById(a.id).defaultLayout, 'calendar', 'a system id is read back as written');
  store.updateSpace(a.id, { defaultLayout: shared.id });

  space = store.updateSpace(a.id, { defaultLayout: null });
  assert.ok(!('defaultLayout' in space), 'null clears it');
  assert.equal(store.defaultLayoutOf(a.id), null);

  // Deleting it clears the default; deleting another changes nothing.
  store.updateSpace(a.id, { defaultLayout: shared.id });
  const other = store.layouts.add(a.id, pat.key, { ...g, ...SH, name: 'Other', shared: true });
  store.layouts.remove(a.id, other.id);
  store.syncDefaultLayout(a.id);
  assert.equal(store.spaceById(a.id).defaultLayout, shared.id, 'deleting another shared layout keeps the default');
  store.layouts.remove(a.id, shared.id);
  store.syncDefaultLayout(a.id);
  assert.ok(!('defaultLayout' in store.spaceById(a.id)), 'deleting the default layout clears it');
  n += 1;

  // Nothing stored breaks: a space from before this step (no defaultLayout) reads and writes as it did; a stored id
  // whose layout is gone reads as no default; a stored value that is not an id is dropped.
  const appFile = path.join(dir, 'app.json');
  const b = store.addSpace({ name: 'B', members: [] });
  const c = store.addSpace({ name: 'C', members: [] });
  const rawNow = readJson(appFile);
  const before = rawNow.spaces.find((r) => r.id === b.id);
  assert.ok(!('defaultLayout' in before), 'a new space has no defaultLayout key');
  rawNow.spaces.find((r) => r.id === a.id).defaultLayout = 'lgone12';
  rawNow.spaces.find((r) => r.id === c.id).defaultLayout = 'Not an id!';
  fs.writeFileSync(appFile, JSON.stringify(rawNow));
  const again = new Store(dir);
  assert.deepEqual(again.spaceById(b.id), store.spaceById(b.id), 'a space without a default reads exactly as before');
  assert.equal(again.spaceById(a.id).defaultLayout, 'lgone12', 'a stored id is kept as it is');
  assert.equal(again.defaultLayoutOf(a.id), null, 'and reads as no default while its layout is gone');
  assert.ok(!('defaultLayout' in again.spaceById(c.id)), 'a stored value that is not an id is dropped');
  fs.rmSync(dir, { recursive: true, force: true });
  n += 1;
}

// --- the routes, against a throwaway server -----------------------------------------------------------------------

const dataDir = tmp('server');
let child = null;
let port = 0;
let serverOut = '';
async function startServer() {
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir,
      ADMIN_PASSWORD: 'testpass1234',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverOut = '';
  child.stdout.on('data', (d) => { serverOut += d; });
  child.stderr.on('data', (d) => { serverOut += d; });
  port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${serverOut}`)); }, 25000);
    const onData = () => { const m = /listening on :(\d+)/.exec(serverOut); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${serverOut}`)); });
  });
}
const stopServer = () => new Promise((resolve) => { if (!child || child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); });

async function call(method, urlPath, { body, cookie } = {}) {
  const headers = { accept: 'application/json' };
  if (cookie) headers.cookie = `app_session=${cookie}`;
  let payload;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
const expect = async (label, status, method, urlPath, options) => {
  const r = await call(method, urlPath, options);
  assert.equal(r.status, status, `${label}: ${method} ${urlPath} answered ${r.status} ${r.text}`);
  if (status >= 400) assert.match(r.json?.error || '', /^[A-Z"].*\.$/, `${label}: one plain sentence (${r.text})`);
  return r;
};

await startServer();
try {
  const login = async (name, password) => {
    const r = await call('POST', '/api/login', { body: { login: name, password } });
    assert.equal(r.status, 200, `${name} signs in: ${r.text}`);
    return r.json.token;
  };
  const owner = await login('admin', 'testpass1234');
  const mk = async (name) => (await call('POST', '/api/users', { cookie: owner, body: { login: name, displayName: name, role: 'member', password: 'memberpass1234' } })).json.user;
  const patUser = await mk('pat');
  const samUser = await mk('sam');
  const outUser = await mk('out');
  const space = (await call('POST', '/api/spaces', { cookie: owner, body: { name: 'Trip', members: [patUser.key, samUser.key] } })).json.space;
  const S = space.id;
  const L = `/api/spaces/${S}/layouts`;
  await expect('sam made moderator', 200, 'PATCH', `/api/users/${samUser.key}/spaces/${S}`, { cookie: owner, body: { permissions: { moderator: true } } });
  const pat = await login('pat', 'memberpass1234');
  const sam = await login('sam', 'memberpass1234');
  const out = await login('out', 'memberpass1234');
  await expect('guests allowed', 200, 'PATCH', `/api/spaces/${S}`, { cookie: owner, body: { allowGuests: true } });
  const guestToken = (await expect('guest link', 200, 'POST', `/api/spaces/${S}/guest-link`, { cookie: owner, body: {} })).json.space.guestToken;
  const asGuest = `?guest=${encodeURIComponent(guestToken)}`;

  // Who may read.
  // The system layouts (plan-layout-views.md, step 1): with no Calendar or Map on, only the Workspace; a guest has none.
  // No `mine` and no `favorites` (plan-workspaces.md, decision 44): a person's own is a workspace (server/workspaces.js).
  const workspace = { id: 'workspace', kind: 'system', name: 'Workspace', icon: 'columns', tab: true, shown: true, pinned: true, defaultName: 'Workspace', defaultIcon: 'columns', modules: [] };
  const empty = await expect('member reads', 200, 'GET', L, { cookie: pat });
  assert.deepEqual(empty.json, { shared: [], system: [workspace], defaultLayout: null, firstVisit: { layout: 'workspace', shape: ONE }, canShare: false, canSetDefault: false });
  assert.deepEqual((await expect('moderator reads', 200, 'GET', L, { cookie: sam })).json, { shared: [], system: [workspace], defaultLayout: null, firstVisit: { layout: 'workspace', shape: ONE }, canShare: true, canSetDefault: true, cantOpen: {}, names: {}, tabs: { order: [...SYSTEM_IDS], hide: [] } }, 'the moderator sets the tabs too');
  assert.deepEqual((await expect('owner reads', 200, 'GET', L, { cookie: owner })).json, { shared: [], system: [workspace], defaultLayout: null, firstVisit: { layout: 'workspace', shape: ONE }, canShare: true, canSetDefault: true, cantOpen: {}, names: {}, tabs: { order: [...SYSTEM_IDS], hide: [] } });
  assert.deepEqual((await expect('guest reads', 200, 'GET', `${L}${asGuest}`)).json, { shared: [], system: [], defaultLayout: null, firstVisit: { layout: 'workspace', shape: ONE }, canShare: false, canSetDefault: false });
  await expect('nobody signed in', 401, 'GET', L);
  await expect('a member of another space', 404, 'GET', L, { cookie: out });
  await expect('no such space', 404, 'GET', '/api/spaces/nosuchsp/layouts', { cookie: pat });
  await expect('a guest of this space reading another', 403, 'GET', `/api/spaces/${(await call('GET', '/api/spaces', { cookie: owner })).json.spaces.find((s) => s.isLobby).id}/layouts${asGuest}`);
  n += 1;

  // Saving: only a layout for everyone, by owners, the admin and the space's moderators; never a member's own (a
  // workspace now), never a guest.
  const own = await expect('a member\'s own is refused', 400, 'POST', L, { cookie: pat, body: good() });
  assert.equal(own.json.error, 'A layout of your own is a workspace now: add one with New workspace, in the tabs\' menu.');
  await expect('so is a moderator\'s own', 400, 'POST', L, { cookie: sam, body: { name: 'Blank one', modules: [] } });
  const refusal = await expect('member saves shared', 403, 'POST', L, { cookie: pat, body: { ...SHB, name: 'Game night', shared: true } });
  assert.equal(refusal.json.error, "Only owners, the admin and this space's moderators can change shared layouts.");
  await expect('guest saves', 403, 'POST', `${L}${asGuest}`, { body: good() });
  await expect('guest saves shared', 403, 'POST', `${L}${asGuest}`, { body: { ...SHB, name: 'Game night', shared: true } });
  await expect('outsider saves', 404, 'POST', L, { cookie: out, body: good() });
  const samShared = await expect('moderator saves shared', 201, 'POST', L, { cookie: sam, body: { ...SHB, name: 'Planning', shared: true } });
  const ownerShared = await expect('owner saves shared', 201, 'POST', L, { cookie: owner, body: { ...SHB, name: 'Game night', shared: true } });
  const takenShared = await expect('name taken in shared list', 409, 'POST', L, { cookie: sam, body: { ...SHB, name: 'planning', shared: true } });
  assert.equal(takenShared.json.id, samShared.json.layout.id, 'the 409 names the one with that name');
  assert.equal(takenShared.json.error, 'There is already a layout called Planning.');
  n += 1;

  // Reading back: the shared ones for everyone.
  const patList = (await call('GET', L, { cookie: pat })).json;
  assert.ok(!('mine' in patList) && !('favorites' in patList), 'no layouts or favorites of one\'s own');
  assert.deepEqual(patList.shared.map((l) => l.id), [samShared.json.layout.id, ownerShared.json.layout.id]);
  const guestList = (await call('GET', `${L}${asGuest}`)).json;
  assert.equal(guestList.shared.length, 2, 'a guest reads the shared ones');
  assert.deepEqual(guestList.shared.map((l) => l.id), patList.shared.map((l) => l.id), 'the same shared layouts a member reads');
  assert.deepEqual(guestList.system, [], 'a guest has no system layouts of their own');
  // Another space (B), with its own guest link: a guest reads only their own space's layouts, and every write is a 403.
  const spaceB = (await call('POST', '/api/spaces', { cookie: owner, body: { name: 'Other', members: [] } })).json.space;
  await expect('B allows guests', 200, 'PATCH', `/api/spaces/${spaceB.id}`, { cookie: owner, body: { allowGuests: true } });
  const guestB = `?guest=${encodeURIComponent((await expect('B guest link', 200, 'POST', `/api/spaces/${spaceB.id}/guest-link`, { cookie: owner, body: {} })).json.space.guestToken)}`;
  await expect('B owner saves shared', 201, 'POST', `/api/spaces/${spaceB.id}/layouts`, { cookie: owner, body: { ...SHB, name: 'Only B', shared: true } });
  assert.deepEqual((await expect('guest of B reads B', 200, 'GET', `/api/spaces/${spaceB.id}/layouts${guestB}`)).json.shared.map((l) => l.name), ['Only B']);
  await expect('guest of A reads B', 403, 'GET', `/api/spaces/${spaceB.id}/layouts${asGuest}`);
  await expect('guest of B reads A', 403, 'GET', `${L}${guestB}`);
  assert.match((await expect('guest of A saves', 403, 'POST', `${L}${asGuest}`, { body: good() })).json.error, /load shared layouts but not save or change them/, 'a clear refusal');
  await expect('guest of A writes to B', 403, 'POST', `/api/spaces/${spaceB.id}/layouts${asGuest}`, { body: good() });
  const onlyB = (await call('GET', `/api/spaces/${spaceB.id}/layouts`, { cookie: owner })).json.shared[0].id;
  await expect('B layout removed again', 204, 'DELETE', `/api/spaces/${spaceB.id}/layouts/${onlyB}`, { cookie: owner });
  n += 1;

  // Changing: by anyone who may share; members and guests never.
  const samPath = `${L}/${samShared.json.layout.id}`;
  await expect('member renames shared', 403, 'PUT', samPath, { cookie: pat, body: { name: 'Mine now' } });
  await expect('member deletes shared', 403, 'DELETE', samPath, { cookie: pat });
  await expect('guest renames shared', 403, 'PUT', `${samPath}${asGuest}`, { body: { name: 'Guest' } });
  await expect('guest deletes shared', 403, 'DELETE', `${samPath}${asGuest}`);
  await expect('owner renames the moderator\'s shared', 200, 'PUT', samPath, { cookie: owner, body: { name: 'Planning day' } });
  await expect('rename onto a taken shared name', 409, 'PUT', samPath, { cookie: sam, body: { name: 'game night' } });
  await expect('a PUT with nothing', 400, 'PUT', samPath, { cookie: sam, body: {} });
  await expect('a PUT moving lists', 400, 'PUT', samPath, { cookie: sam, body: { shared: false } });
  await expect('a PUT with a bad shape', 400, 'PUT', samPath, { cookie: sam, body: { snap: { all: true, pitch: 10 } } });
  await expect('no such layout', 404, 'PUT', `${L}/lnosuch`, { cookie: sam, body: { name: 'x' } });
  await expect('no such layout', 404, 'DELETE', `${L}/lnosuch`, { cookie: sam });
  await expect('moderator deletes the owner\'s shared', 204, 'DELETE', `${L}/${ownerShared.json.layout.id}`, { cookie: sam });
  assert.deepEqual((await call('GET', L, { cookie: pat })).json.shared.map((l) => l.name), ['Planning day']);
  n += 1;

  // The limit through the routes; the favorite routes are gone.
  for (let i = 1; i < 10; i += 1) await expect(`shared #${i + 1}`, 201, 'POST', L, { cookie: owner, body: { ...SHB, name: `Shared ${i}`, shared: true } });
  const fullShared = await expect('the eleventh shared', 409, 'POST', L, { cookie: sam, body: { ...SHB, name: 'Eleventh', shared: true } });
  assert.equal(fullShared.json.error, 'This space has 10 shared layouts. Delete one first.');
  const sharedIds = (await call('GET', L, { cookie: pat })).json.shared.map((l) => l.id);
  for (const method of ['PUT', 'DELETE']) assert.equal((await call(method, `${L}/${sharedIds[0]}/favorite`, { cookie: pat })).status, 404, `no ${method} .../favorite`);
  let r;
  n += 1;

  // Kept across a restart, in DATA_DIR/layouts.json, with no people or favorites in it.
  await stopServer();
  const file = readJson(path.join(dataDir, 'layouts.json'));
  assert.equal(file.spaces[S].shared.length, 10);
  assert.ok(!('people' in file.spaces[S]) && !('favorites' in file.spaces[S]));
  await startServer();
  const pat2 = await login('pat', 'memberpass1234');
  assert.equal((await call('GET', L, { cookie: pat2 })).json.shared.length, 10, 'read back after a restart');
  n += 1;

  // The default layout (step 4), in a space of its own: owners only, Opens with in step both ways, cleared by a delete.
  const owner2 = await login('admin', 'testpass1234');
  const sam2 = await login('sam', 'memberpass1234');
  const camp = (await call('POST', '/api/spaces', { cookie: owner2, body: { name: 'Camp', members: [patUser.key, samUser.key] } })).json.space;
  assert.ok(!('defaultLayout' in camp), 'a new space has none');
  const C = `/api/spaces/${camp.id}`;
  await expect('sam made moderator of Camp', 200, 'PATCH', `/api/users/${samUser.key}/spaces/${camp.id}`, { cookie: owner2, body: { permissions: { moderator: true } } });
  const night = (await expect('moderator saves shared in Camp', 201, 'POST', `${C}/layouts`, { cookie: sam2, body: { ...SHB, name: 'Game night', shared: true } })).json.layout;
  const plan = (await expect('owner saves shared in Camp', 201, 'POST', `${C}/layouts`, { cookie: owner2, body: { ...SHB, name: 'Planning', shared: true } })).json.layout;
  const ownCamp = (await expect('owner adds a workspace of their own in Camp', 201, 'POST', `${C}/workspaces`, { cookie: owner2, body: { name: 'Mine' } })).json.workspace;
  const forSpace = async (cookie, query = '') => (await expect('for-space', 200, 'GET', `/api/modules/for-space?space=${camp.id}${query}`, { cookie })).json;
  assert.equal((await forSpace(pat2)).defaultLayout, null, 'for-space: null while none is set');
  assert.equal((await call('GET', `${C}/layouts`, { cookie: pat2 })).json.defaultLayout, null);

  // Owners, the admin and the space's moderators (plan-one-bar.md step 4): a member and a guest are refused, and
  // nothing changes. The moderator's set is undone so the owner's below starts from none.
  const memberSets = await call('PATCH', C, { cookie: pat2, body: { defaultLayout: night.id } });
  assert.equal(memberSets.status, 403, `member sets the default: ${memberSets.text}`);
  assert.equal((await call('PATCH', C, { body: { defaultLayout: night.id } })).status, 401, 'nobody signed in');
  assert.equal((await call('GET', `${C}/layouts`, { cookie: owner2 })).json.defaultLayout, null, 'refusals changed nothing');
  await expect('moderator sets the default', 200, 'PATCH', C, { cookie: sam2, body: { defaultLayout: night.id } });
  assert.equal((await call('GET', `${C}/layouts`, { cookie: pat2 })).json.defaultLayout, night.id, 'a moderator set it');
  await expect('moderator stops using it', 200, 'PATCH', C, { cookie: sam2, body: { defaultLayout: null } });
  assert.equal((await call('GET', `${C}/layouts`, { cookie: owner2 })).json.defaultLayout, null);
  await expect("a person's own workspace", 404, 'PATCH', C, { cookie: owner2, body: { defaultLayout: ownCamp.id } });
  await expect('no such layout', 404, 'PATCH', C, { cookie: owner2, body: { defaultLayout: 'lnosuch' } });
  await expect('not an id', 400, 'PATCH', C, { cookie: owner2, body: { defaultLayout: 12 } });
  await expect('a layout of another space', 404, 'PATCH', C, { cookie: owner2, body: { defaultLayout: samShared.json.layout.id } });
  n += 1;

  // The starting layout is the template's (this environment's is the Default's, one empty area): every reader sees the
  // saved layout and the resolved first visit.
  let set = await expect('owner sets the default', 200, 'PATCH', C, { cookie: owner2, body: { defaultLayout: night.id } });
  assert.equal(set.json.space.defaultLayout, night.id);
  assert.ok(!('opensWith' in set.json.space) && !('layout' in set.json.space), 'the space carries no layout of its own');
  for (const [label, cookie] of [['owner', owner2], ['moderator', sam2], ['member', pat2]]) {
    const got = (await call('GET', `${C}/layouts`, { cookie })).json;
    assert.equal(got.defaultLayout, night.id, `${label} reads the default's id`);
    assert.deepEqual(got.firstVisit, { layout: night.id, shape: ONE }, `${label}: the resolved first visit`);
    const fs1 = await forSpace(cookie);
    assert.deepEqual(fs1.defaultLayout, night, `${label}: for-space carries the whole layout`);
    assert.deepEqual(fs1.layout, ONE, `${label}: for-space's layout is the template's (the Default's here)`);
    assert.deepEqual(fs1.firstVisit, got.firstVisit, `${label}: for-space says the same first visit`);
  }
  await expect('guests allowed in Camp', 200, 'PATCH', C, { cookie: owner2, body: { allowGuests: true } });
  const campGuest = `?guest=${encodeURIComponent((await expect('Camp guest link', 200, 'POST', `${C}/guest-link`, { cookie: owner2, body: {} })).json.space.guestToken)}`;
  assert.equal((await call('GET', `${C}/layouts${campGuest}`)).json.defaultLayout, night.id, 'a guest reads the default too');
  assert.deepEqual((await call('GET', `/api/modules/for-space?space=${camp.id}&guest=${campGuest.slice(7)}`)).json.defaultLayout, night, 'and gets it from for-space');
  assert.equal((await call('PATCH', `${C}${campGuest}`, { body: { defaultLayout: null } })).status, 401, 'a guest cannot clear it');

  // Replacing the default's modules, renaming it or replacing another layout leaves the starting layout alone.
  await expect('moderator replaces the default', 200, 'PUT', `${C}/layouts/${night.id}`, { cookie: sam2, body: { shape: 'two-equal', areas: [null, null] } });
  assert.deepEqual((await forSpace(pat2)).layout, ONE, 'the starting layout does not follow a replace');
  await expect('rename the default', 200, 'PUT', `${C}/layouts/${night.id}`, { cookie: sam2, body: { name: 'Late night' } });
  await expect('replace another', 200, 'PUT', `${C}/layouts/${plan.id}`, { cookie: owner2, body: { shape: 'one', areas: [null] } });
  let fs2 = await forSpace(pat2);
  assert.deepEqual(fs2.layout, ONE);
  assert.equal(fs2.defaultLayout.name, 'Late night');

  assert.deepEqual((await forSpace(pat2)).firstVisit, { layout: night.id, shape: ONE });

  // null stops using it: the first visit is Workspace.
  await expect('set another', 200, 'PATCH', C, { cookie: owner2, body: { defaultLayout: plan.id } });
  set = await expect('stop using it', 200, 'PATCH', C, { cookie: owner2, body: { defaultLayout: null } });
  assert.ok(!('defaultLayout' in set.json.space));
  assert.deepEqual((await forSpace(pat2)).firstVisit, { layout: 'workspace', shape: ONE });

  // Deleting the default clears it and keeps the template's layout; deleting another keeps it.
  await expect('set the default', 200, 'PATCH', C, { cookie: owner2, body: { defaultLayout: night.id } });
  await expect('delete another', 204, 'DELETE', `${C}/layouts/${plan.id}`, { cookie: owner2 });
  assert.equal((await call('GET', `${C}/layouts`, { cookie: pat2 })).json.defaultLayout, night.id, 'deleting another keeps the default');
  await expect('delete the default', 204, 'DELETE', `${C}/layouts/${night.id}`, { cookie: sam2 });
  assert.equal((await call('GET', `${C}/layouts`, { cookie: pat2 })).json.defaultLayout, null, 'deleting the default clears it');
  fs2 = await forSpace(pat2);
  assert.equal(fs2.defaultLayout, null);
  assert.deepEqual(fs2.firstVisit, { layout: 'workspace', shape: ONE });
  const campRecord = (await call('GET', C, { cookie: owner2 })).json.space;
  assert.ok(!('defaultLayout' in campRecord), 'the key is gone from the record');
  n += 1;

  // System layouts through the routes (plan-layout-views.md, step 1). First with the Calendar off: only the Workspace.
  // A person's own rename, re-icon and tab for them are gone (issue #1091): there is no PATCH .../layouts/system/:id.
  const pat3 = await login('pat', 'memberpass1234');
  const SYS = `${L}/system`;
  const noRoute = async (label, url, body, cookie = pat3) => {
    const r = await call('PATCH', url, { cookie, body });
    assert.equal(r.status, 404, `${label}: there is no such route (${r.status})`);
    n += 1;
  };
  const idsOf = async (cookie) => (await call('GET', L, { cookie })).json.system.map((l) => l.id);
  assert.deepEqual(await idsOf(pat3), ['workspace'], 'no Calendar layout while the Calendar is off in the space');

  // The first visit cannot be Calendar or Map while it is not on in the space (step 5): one plain sentence, 404.
  r = await expect('Calendar as the default, off', 400, 'PATCH', `/api/spaces/${S}`, { cookie: owner2, body: { defaultLayout: 'calendar' } });
  assert.equal(r.json.error, "Calendar is not on in this space, so it can't be the first visit.");
  assert.ok(!('defaultLayout' in (await call('GET', `/api/spaces/${S}`, { cookie: owner2 })).json.space), 'nothing was stored');

  // Turn the Calendar on (installed, enabled, in every space): the system layout appears for everyone in the space.
  await expect('install the Calendar', 201, 'POST', '/api/modules/bundled/calendar/install', { cookie: owner2 });
  await expect('enable the Calendar', 200, 'PATCH', '/api/modules/calendar', { cookie: owner2, body: { enabled: true, allSpaces: true } });
  const calendar = { id: 'calendar', kind: 'system', name: 'Calendar', icon: 'calendar-days', tab: true, shown: true, pinned: true, defaultName: 'Calendar', defaultIcon: 'calendar-days', modules: [{ id: 'calendar', mode: 'dock' }], settings: [] };
  assert.deepEqual((await call('GET', L, { cookie: pat3 })).json.system, [workspace, calendar], 'Workspace then Calendar; Calendar is a tab from the start');
  assert.deepEqual(await idsOf(sam2), ['workspace', 'calendar'], 'everyone in the space');
  assert.deepEqual((await call('GET', `${L}${asGuest}`)).json.system, [], 'a guest still has none');
  assert.deepEqual(await idsOf(pat3), ['workspace', 'calendar']);

  // Nobody renames, re-icons or hides a system layout for themselves: the route is gone, and nothing is stored for it.
  for (const [label, body] of [['rename', { name: 'Our plans' }], ['re-icon', { icon: 'couch' }], ['hide', { tab: false }], ['back to the default', { name: null, icon: null }]]) {
    await noRoute(`${label} Calendar`, `${SYS}/calendar`, body);
  }
  await noRoute('rename Workspace', `${SYS}/workspace`, { name: 'Desk' });
  assert.deepEqual((await call('GET', L, { cookie: pat3 })).json.system, [workspace, calendar], 'each with its own name and icon');
  assert.ok(!('system' in (readJson(path.join(dataDir, 'layouts.json')).spaces[S] || {})), 'nothing stored per person for them');

  // Deleting, replacing and making a system layout the default are refused; the sentence names it.
  assert.equal((await expect('delete Workspace', 400, 'DELETE', `${L}/workspace`, { cookie: pat3 })).json.error, "Workspace can't be deleted.");
  assert.equal((await expect('delete Calendar', 400, 'DELETE', `${L}/calendar`, { cookie: pat3 })).json.error, "Calendar can't be deleted.");
  assert.equal((await expect('replace Calendar', 400, 'PUT', `${L}/calendar`, { cookie: pat3, body: { name: 'x' } })).json.error, "Calendar can't be replaced.");
  await expect('delete Map while off', 400, 'DELETE', `${L}/map`, { cookie: pat3 });
  await expect('guest deletes a system layout', 403, 'DELETE', `${L}/workspace${asGuest}`);
  assert.equal((await call('GET', L, { cookie: pat3 })).json.system.length, 2, 'still there');

  // Calendar as the first visit (plan-layout-views.md, step 5): accepted now it is on, nothing else moves, the first
  // visit says so (with the viewer's own view: a guest has no system layouts, so Workspace), and Map is still refused.
  const firstVisitOf = async (cookie, query = '') => (await expect('first visit', 200, 'GET', `${L}${query}`, { cookie })).json.firstVisit;
  set = await expect('Calendar as the default layout', 200, 'PATCH', `/api/spaces/${S}`, { cookie: owner2, body: { defaultLayout: 'calendar' } });
  assert.equal(set.json.space.defaultLayout, 'calendar');
  assert.deepEqual(await firstVisitOf(pat3), { layout: 'calendar', shape: ONE });
  assert.deepEqual(await firstVisitOf(null, asGuest), { layout: 'workspace', shape: ONE }, 'a guest has no system layouts');
  assert.equal((await call('GET', L, { cookie: pat3 })).json.defaultLayout, null, "GET's defaultLayout stays a shared layout's id or null");
  assert.deepEqual((await call('GET', `/api/modules/for-space?space=${S}`, { cookie: pat3 })).json.firstVisit, { layout: 'calendar', shape: ONE }, 'for-space carries it too');
  await expect('Map while Maps is not on', 400, 'PATCH', `/api/spaces/${S}`, { cookie: owner2, body: { defaultLayout: 'map' } });
  assert.equal((await call('PATCH', `/api/spaces/${S}`, { cookie: pat3, body: { defaultLayout: 'calendar' } })).status, 403, 'a member sets Calendar');
  // Calendar goes off: the stored value stays, the first visit falls back to Workspace.
  await expect('disable the Calendar', 200, 'PATCH', '/api/modules/calendar', { cookie: owner2, body: { enabled: false } });
  assert.deepEqual(await firstVisitOf(pat3), { layout: 'workspace', shape: ONE }, 'Calendar off: the Workspace with the template\'s layout');
  assert.equal((await call('GET', `/api/spaces/${S}`, { cookie: owner2 })).json.space.defaultLayout, 'calendar', 'nothing is deleted');
  await expect('Calendar refused while off', 400, 'PATCH', `/api/spaces/${S}`, { cookie: owner2, body: { defaultLayout: 'calendar' } });
  await expect('enable the Calendar again', 200, 'PATCH', '/api/modules/calendar', { cookie: owner2, body: { enabled: true, allSpaces: true } });
  assert.equal((await firstVisitOf(pat3)).layout, 'calendar', 'and back on, Calendar again');
  await expect('null back to Workspace', 200, 'PATCH', `/api/spaces/${S}`, { cookie: owner2, body: { defaultLayout: null } });
  assert.deepEqual(await firstVisitOf(pat3), { layout: 'workspace', shape: ONE });

  // A Fixed Workspace the owner shows is pinned (plan-templates-redesign.md, decision 9): nobody takes its tab off for
  // themselves; the favorite routes are gone (plan-workspaces.md, decision 44).
  assert.equal((await call('GET', L, { cookie: pat3 })).json.system[1].pinned, true, 'pinned');
  assert.equal((await call('DELETE', `${L}/calendar/favorite`, { cookie: pat3 })).status, 404, 'no favorite route');

  // Layouts carry kind and icon; an icon is checked against the icon list.
  r = await expect('change a layout\'s icon', 200, 'PUT', `${L}/${sharedIds[1]}`, { cookie: sam2, body: { icon: 'couch' } });
  assert.equal(r.json.layout.icon, 'couch');
  await expect('a bad icon', 400, 'PUT', `${L}/${sharedIds[1]}`, { cookie: sam2, body: { icon: 'no-such-icon-here' } });
  const listedNow = (await call('GET', L, { cookie: sam2 })).json;
  assert.ok(listedNow.shared.every((l) => l.kind === 'user' && typeof l.icon === 'string'), 'each shared one has kind user and an icon');

  // Turning the Calendar off takes the layout away; back on, it is there again.
  await expect('Calendar off', 200, 'PATCH', '/api/modules/calendar', { cookie: owner2, body: { enabled: false } });
  assert.deepEqual(await idsOf(pat3), ['workspace'], 'the Calendar layout goes with the Calendar');
  await expect('Calendar on again', 200, 'PATCH', '/api/modules/calendar', { cookie: owner2, body: { enabled: true } });
  assert.equal((await call('GET', L, { cookie: pat3 })).json.system[1].name, 'Calendar', 'and comes back');
  n += 1;

  // Shared layouts are shapes (plan-layout-picker.md, step 6, decision 5): a layout for everyone is { shape, areas }, checked
  // against the modules on in the space, with no modules, snap or arrange; a personal one is a workspace.
  for (const id of ['polls', 'todo']) {
    await expect(`install ${id}`, 201, 'POST', `/api/modules/bundled/${id}/install`, { cookie: owner2 });
    await expect(`enable ${id}`, 200, 'PATCH', `/api/modules/${id}`, { cookie: owner2, body: { enabled: true, allSpaces: true } });
  }
  await expect('Calendar on in every space', 200, 'PATCH', '/api/modules/calendar', { cookie: owner2, body: { enabled: true, allSpaces: true } });
  const LC = `${C}/layouts`;
  const sharedOf = async (cookie) => (await call('GET', LC, { cookie })).json;
  const refusedShape = async (label, body, sentence, cookie = owner2) => {
    const r = await expect(label, 400, 'POST', LC, { cookie, body: { name: 'Refused', shared: true, ...body } });
    if (sentence instanceof RegExp) assert.match(r.json.error, sentence, label); else if (sentence) assert.equal(r.json.error, sentence, label);
    assert.ok(!/[\n\r]/.test(r.json.error) && r.json.error.length <= 160, `${label}: one short line`);
    assert.ok(Array.isArray(r.json.problems) && r.json.problems[0] === r.json.error && Array.isArray(r.json.parts) && r.json.parts.length === r.json.problems.length, `${label}: problems and parts, as a template's refusal`);
    return r.json;
  };
  const duo = (await expect('owner saves a shape', 201, 'POST', LC, { cookie: owner2, body: { name: 'Duo', shape: 'two-equal', areas: ['calendar', 'polls'], shared: true } })).json.layout;
  assert.deepEqual([duo.shape, duo.areas, 'modules' in duo, 'snap' in duo, 'arrange' in duo], ['two-equal', ['calendar', 'polls'], false, false, false], 'a shape and its areas, nothing free-form');
  const split = (await expect('moderator saves a shape with an empty area', 201, 'POST', LC, { cookie: sam2, body: { name: 'Split', shape: 'wide-split', areas: ['calendar', 'polls', null], icon: 'couch', shared: true } })).json.layout;
  assert.deepEqual([split.shape, split.areas, split.icon, split.by], ['wide-split', ['calendar', 'polls', null], 'couch', samUser.key]);
  assert.deepEqual(readJson(path.join(dataDir, 'layouts.json')).spaces[camp.id].shared.find((l) => l.id === split.id), split, 'stored as answered');
  // To-do stacks whether the Calendar is on or off: it has its own window. The Calendar never stacks.
  await expect('To-do in a stacked area, Calendar on', 201, 'POST', LC, { cookie: owner2, body: { name: 'Todo stacked', shape: 'tall-split', areas: ['polls', 'todo', null], shared: true } });
  await refusedShape('Calendar in a stacked area', { shape: 'tall-split', areas: ['polls', 'calendar', null] }, "Calendar can't share a column; put it in area 1.");
  await expect('To-do in area 1 beside the Calendar', 201, 'POST', LC, { cookie: owner2, body: { name: 'Todo one', shape: 'two-equal', areas: ['todo', 'calendar'], shared: true } });
  // The refusals, each one plain sentence, 400.
  await refusedShape('free-form modules for a shared layout', { modules: [{ id: 'calendar', mode: 'dock' }] }, 'A layout for everyone is a shape; pick one with the picker.');
  await refusedShape('snap for a shared layout', { ...SHB, snap: { all: true, pitch: 100 } }, 'A layout for everyone is a shape; pick one with the picker.');
  await refusedShape('arrange for a shared layout', { ...SHB, arrange: 'dock' }, 'A layout for everyone is a shape; pick one with the picker.');
  await refusedShape('modules with a shape', { ...SHB, modules: [] }, 'A layout for everyone is a shape; pick one with the picker.');
  await refusedShape('no shape', { areas: [null] }, 'Pick a shape from the list.');
  await refusedShape('an unknown shape', { shape: 'nine', areas: [null] }, 'Pick a shape from the list.');
  await refusedShape('a shape that is not text', { shape: 5, areas: [null] }, 'Pick a shape from the list.');
  await refusedShape('too few areas', { shape: 'three-equal', areas: [null, null] }, 'This shape has 3 areas.');
  await refusedShape('too many areas', { shape: 'one', areas: [null, null] }, 'This shape has 1 area.');
  await refusedShape('areas not a list', { shape: 'one', areas: 'polls' }, 'This shape has 1 area.');
  await refusedShape('a width', { shape: 'one', areas: [null], widths: [100] }, /does not take "widths"/);
  await refusedShape('the chat in an area', { shape: 'two-equal', areas: ['chat', null] }, "The chat and the call are in the column on the left; they can't go in an area.");
  await refusedShape('the conference in an area', { shape: 'two-equal', areas: [null, 'conference'] }, "The chat and the call are in the column on the left; they can't go in an area.");
  await refusedShape('a module that is not installed here', { shape: 'one', areas: ['vault'] }, /^Vault is not available in this space\.$/);
  await refusedShape('an area that is not text', { shape: 'one', areas: [5] }, /^Area 1 takes a module or nothing\.$/);
  const twice = await refusedShape('a module twice', { shape: 'two-equal', areas: ['polls', 'polls'] }, 'Polls is in two areas; a module can be in one area only.');
  assert.deepEqual(twice.parts, ['areas']);
  const both = await refusedShape('two problems at once', { shape: 'three-equal', areas: ['vault', 'polls', 'polls'] });
  assert.equal(both.problems.length, 2, 'every sentence, not only the first');
  assert.deepEqual(both.parts, ['areas', 'areas']);
  // Hostile ids and names: never echoed raw, never a line break, never longer than a short line.
  for (const bad of ['__proto__', 'a\nb', '<img src=x onerror=alert(1)>', 'x'.repeat(300), 'Polls', '\u202egnp', 'a b', '']) {
    const hostile = await refusedShape(`hostile id ${JSON.stringify(bad).slice(0, 24)}`, { shape: 'one', areas: [bad] });
    assert.ok(/^"[ -~]{0,40}" is not a module you can use here\.$/.test(hostile.error) || hostile.error === 'That id is not a module you can use here.', `a quoted, plain, short id: ${hostile.error}`);
  }
  await refusedShape('a hostile id twice', { shape: 'two-equal', areas: ['a\nb', 'a\nb'] });
  await refusedShape('an object as an area', { shape: 'one', areas: [{}] }, /^Area 1 takes a module or nothing\.$/);
  // A layout of one's own is a workspace now (plan-workspaces.md, decision 44): refused with or without a shape.
  const personalShape = await expect('a personal layout with a shape', 400, 'POST', LC, { cookie: pat3, body: { name: 'Mine shaped', ...SHB } });
  assert.equal(personalShape.json.error, 'A layout of your own is a workspace now: add one with New workspace, in the tabs\' menu.');
  await expect('a personal layout with modules too', 400, 'POST', LC, { cookie: pat3, body: { name: 'Mine free', modules: [{ id: 'polls', mode: 'float', box: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 } }] } });
  // Who may: a member and a guest are refused (403) before anything is read, so they learn nothing about the space.
  assert.equal((await expect('member saves a shape', 403, 'POST', LC, { cookie: pat3, body: { name: 'Nope', shared: true, shape: 'nine', areas: 7 } })).json.error, "Only owners, the admin and this space's moderators can change shared layouts.");
  await expect('guest saves a shape', 403, 'POST', `${LC}${campGuest.replace('?', '?')}`, { body: { name: 'Nope', shared: true, ...SHB } });
  // A replace and a rename.
  const duoPath = `${LC}/${duo.id}`;
  let put = await expect('moderator replaces the shape', 200, 'PUT', duoPath, { cookie: sam2, body: { shape: 'three-equal', areas: ['calendar', null, 'polls'] } });
  assert.deepEqual([put.json.layout.shape, put.json.layout.areas, put.json.layout.by, 'modules' in put.json.layout], ['three-equal', ['calendar', null, 'polls'], duo.by, false], 'by stays who first saved it');
  put = await expect('rename a shape', 200, 'PUT', duoPath, { cookie: owner2, body: { name: 'Three' } });
  assert.deepEqual([put.json.layout.name, put.json.layout.shape], ['Three', 'three-equal'], 'a rename keeps the shape');
  assert.equal((await expect('modules on a shared PUT', 400, 'PUT', duoPath, { cookie: sam2, body: { modules: [] } })).json.error, 'A layout for everyone is a shape; pick one with the picker.');
  await expect('a shape with no areas on a PUT', 400, 'PUT', duoPath, { cookie: sam2, body: { shape: 'two-equal' } });
  await expect('areas with no shape on a PUT', 400, 'PUT', duoPath, { cookie: sam2, body: { areas: [null] } });
  await expect('a refused replace changes nothing', 400, 'PUT', duoPath, { cookie: sam2, body: { shape: 'wide-split', areas: ['polls', 'calendar', null] } });
  assert.deepEqual((await sharedOf(pat3)).shared.find((l) => l.id === duo.id).areas, ['calendar', null, 'polls'], 'the refused replace left it as it was');
  await expect('member replaces a shape', 403, 'PUT', duoPath, { cookie: pat3, body: { shape: 'one', areas: [null] } });
  assert.equal((await expect('a PUT with nothing', 400, 'PUT', duoPath, { cookie: sam2, body: {} })).json.error, 'Send a new name, or a shape and its areas to replace the layout with.');

  // cantOpen: answered to the owner, the admin and the space's moderators, whether or not they saved the layout; never to a
  // member or a guest. Every module on in the space is in it, and a module a layout names that is off.
  const guestsOff = async (id, on) => expect(`guests ${on ? 'may' : 'may not'} see ${id}`, 200, 'PATCH', '/api/roles/guest', { cookie: owner2, body: { [`module.${id}.view`]: on } });
  const membersOff = async (id, on) => expect(`members ${on ? 'may' : 'may not'} see ${id}`, 200, 'PATCH', '/api/roles/member', { cookie: owner2, body: { [`module.${id}.view`]: on } });
  let seen2 = await sharedOf(owner2);
  assert.deepEqual(seen2.cantOpen, {}, 'everyone can open everything by default');
  await guestsOff('todo', false);
  await guestsOff('polls', false);
  await membersOff('polls', false);
  for (const [label, cookie] of [['owner', owner2], ['moderator', sam2]]) {
    seen2 = await sharedOf(cookie);
    assert.deepEqual(seen2.cantOpen.todo, { roles: ['guest'] }, `${label}: with the Calendar on To-do is still its own module, so guests who can't read it are listed`);
    assert.deepEqual(seen2.cantOpen.polls, { roles: ['member', 'guest'] }, `${label}: Polls closes for members and guests, in role order`);
    assert.ok(!('calendar' in seen2.cantOpen), `${label}: a module everyone can open is not listed`);
    assert.ok(Object.values(seen2.cantOpen).every((v) => (v.roles && !v.roles.includes('owner') && !v.roles.includes('admin')) || v.off === true), `${label}: only roles that can lack it, or off`);
  }
  for (const [label, got] of [['member', await sharedOf(pat3)], ['guest', (await call('GET', `${LC}${campGuest}`)).json]]) {
    assert.ok(!('cantOpen' in got) && !('names' in got), `${label} is not told which modules others can't open, or any module's name`);
    assert.ok(!JSON.stringify(got).includes('"roles"'), `${label}: nothing of it anywhere in the answer`);
  }
  // What each person sees for a To-do area, a module they can't read and a module that is off (the four cases):
  //   guests read the Calendar but not To-do, Calendar on or off: To-do is its own module. Makers are told guests can't open it;
  //   a guest's To-do area reads empty, a member's keeps the id.
  //   a module a guest can't read (Polls): a guest's area reads empty, a member's answer keeps the id, makers see the roles.
  //   a module off: makers see { off: true }; a guest's area reads empty, a member's keeps the id.
  const todoOne = (await sharedOf(owner2)).shared.find((l) => l.name === 'Todo one');
  const guestAreas = async (l) => (await call('GET', `${LC}${campGuest}`)).json.shared.find((x) => x.id === l.id).areas;
  assert.deepEqual(await guestAreas(todoOne), [null, 'calendar'], 'Calendar on: a guest who reads the Calendar but not To-do has an empty To-do area');
  assert.deepEqual(await guestAreas(duo), ['calendar', null, null], 'Polls unreadable for guests: a guest is not told its id');
  assert.deepEqual((await sharedOf(pat3)).shared.find((x) => x.id === duo.id).areas, ['calendar', null, 'polls'], 'a member keeps the id (unchanged)');
  await expect('Calendar off', 200, 'PATCH', '/api/modules/calendar', { cookie: owner2, body: { enabled: false } });
  seen2 = await sharedOf(sam2);
  assert.deepEqual(seen2.cantOpen.todo, { roles: ['guest'] }, 'Calendar off: To-do is its own and guests can\'t open it');
  assert.deepEqual(seen2.cantOpen.calendar, { off: true }, 'and the Calendar is off');
  assert.deepEqual(await guestAreas(todoOne), [null, null], 'Calendar off: a guest\'s To-do area reads empty');
  assert.deepEqual((await sharedOf(pat3)).shared.find((x) => x.id === todoOne.id).areas, ['todo', 'calendar'], 'and a member keeps the ids');
  await expect('Calendar on again', 200, 'PATCH', '/api/modules/calendar', { cookie: owner2, body: { enabled: true, allSpaces: true } });
  assert.deepEqual((await sharedOf(sam2)).cantOpen.todo, { roles: ['guest'] }, 'back on, To-do is still its own');
  // A module a layout names that is off: still listed, unchanged, and marked off for those who may edit; a guest's area reads empty.
  await expect('turn Polls off', 200, 'PATCH', '/api/modules/polls', { cookie: owner2, body: { enabled: false } });
  seen2 = await sharedOf(owner2);
  assert.deepEqual(seen2.cantOpen.polls, { off: true }, 'Polls is off, whatever the roles say');
  assert.deepEqual(seen2.shared.find((l) => l.id === duo.id).areas, ['calendar', null, 'polls'], 'the layout is answered as it was saved');
  assert.deepEqual((await sharedOf(pat3)).shared.find((l) => l.id === duo.id).areas, ['calendar', null, 'polls'], 'a member still gets the layout whole; the page closes the area');
  assert.deepEqual((await call('GET', `${LC}${campGuest}`)).json.shared.find((l) => l.id === duo.id).areas, ['calendar', null, null], 'a guest is shown only what is on in the space');
  await refusedShape('a module that is off cannot be saved into a new layout', { shape: 'one', areas: ['polls'] }, /^Polls is not available in this space\.$/);
  // for-space tells a guest what GET .../layouts does: an area whose module is off reads empty.
  await expect('Duo is the default while Polls is off', 200, 'PATCH', C, { cookie: owner2, body: { defaultLayout: duo.id } });
  const guestFor = (await expect('for-space as a guest', 200, 'GET', `/api/modules/for-space?space=${camp.id}&guest=${campGuest.slice(7)}`)).json;
  assert.deepEqual(guestFor.defaultLayout.areas, ['calendar', null, null], 'a guest is not told the id of a module that is off, or one they can\'t read');
  assert.deepEqual((await forSpace(pat3)).defaultLayout.areas, ['calendar', null, 'polls'], 'a member is');
  await expect('turn Polls on again', 200, 'PATCH', '/api/modules/polls', { cookie: owner2, body: { enabled: true, allSpaces: true } });
  await guestsOff('todo', true);
  await guestsOff('polls', true);
  await membersOff('polls', true);
  assert.deepEqual((await sharedOf(owner2)).cantOpen, {}, 'and nothing is left once the roles are back');

  // The limit of 10 shared layouts, and the default layout.
  const have = (await sharedOf(owner2)).shared.length;
  for (let i = have; i < 10; i += 1) await expect(`shape #${i + 1}`, 201, 'POST', LC, { cookie: owner2, body: { name: `Fill ${i}`, ...SHB, shared: true } });
  const nameClash = await expect('a taken name', 409, 'POST', LC, { cookie: sam2, body: { name: 'Three', ...SHB, shared: true } });
  assert.deepEqual([nameClash.json.problems, nameClash.json.parts, typeof nameClash.json.id], [[nameClash.json.error], [null], 'string'], 'a 409 for a taken name: { error, problems, parts, id }');
  const fullBody = (await expect('the eleventh shape, whole answer', 409, 'POST', LC, { cookie: sam2, body: { name: 'Eleventh body', ...SHB, shared: true } })).json;
  assert.deepEqual(fullBody, { error: 'This space has 10 shared layouts. Delete one first.', problems: ['This space has 10 shared layouts. Delete one first.'], parts: [null] }, 'a 409 for a full list: { error, problems, parts }');
  assert.equal((await expect('the eleventh shape', 409, 'POST', LC, { cookie: sam2, body: { name: 'Eleventh shape', ...SHB, shared: true } })).json.error, 'This space has 10 shared layouts. Delete one first.');
  await expect('moderator sets a shape as the default', 200, 'PATCH', C, { cookie: sam2, body: { defaultLayout: duo.id } });
  assert.equal((await sharedOf(pat3)).defaultLayout, duo.id, 'a shape can be the default');
  assert.equal((await call('PATCH', C, { cookie: pat3, body: { defaultLayout: duo.id } })).status, 403, 'member sets the default');
  assert.equal((await call('PATCH', C, { cookie: pat3, body: { name: 'Mine' } })).status, 403, 'member sets an owner-only key');
  assert.equal((await call('PATCH', C, { cookie: sam2, body: { name: 'Mine' } })).status, 403, 'moderator sets an owner-only key');
  for (const l of (await sharedOf(owner2)).shared.filter((x) => x.name.startsWith('Fill'))) await expect('clear a filler', 204, 'DELETE', `${LC}/${l.id}`, { cookie: owner2 });
  await expect('stop using the default', 200, 'PATCH', C, { cookie: sam2, body: { defaultLayout: null } });
  n += 1;

  // Stacks through the routes (plan-panel-stacking.md, decision 4): a shared layout, a person's own, the space's default
  // layout and a replace all keep a stack; a malformed one is cleaned on the way in.
  const st = (id, extra) => ({ id, mode: 'dock', dockW: 320, ...extra });
  const stackBody = [st('calendar'), st('todo', { stack: 's1', at: 0, h: 0.5 }), st('polls', { stack: 's1', at: 1, h: 0.5 })];
  const stackedShared = (await expect('owner saves a shared layout', 201, 'POST', `${C}/layouts`, { cookie: owner2, body: { name: 'Stacked', shape: 'tall-split', areas: ['calendar', 'polls', null], shared: true } })).json.layout;
  assert.deepEqual([stackedShared.shape, stackedShared.areas, 'modules' in stackedShared], ['tall-split', ['calendar', 'polls', null], false], 'the shared layout answers with its shape and areas, no modules');
  await expect('the shared shape is the default', 200, 'PATCH', C, { cookie: owner2, body: { defaultLayout: stackedShared.id } });
  const listed = (await call('GET', `${C}/layouts`, { cookie: pat3 })).json;
  assert.deepEqual(listed.shared.find((l) => l.id === stackedShared.id).areas, ['calendar', 'polls', null], 'a member reads the shape');
  assert.equal(listed.defaultLayout, stackedShared.id, 'as the default layout');
  assert.deepEqual(listed.firstVisit.layout, stackedShared.id, 'and a first visit opens it');
  // A person's own stacks are kept in their workspace's arrangement (server/workspaces.js, check-workspaces), not here.
  await expect('a person\'s own layout with a stack is refused', 400, 'POST', `${C}/layouts`, { cookie: pat3, body: { name: 'Mine stacked', modules: stackBody } });
  n += 1;

  // A data folder that holds a free-form shared layout (from before shared layouts were shapes): it is not listed, a space's
  // default that named it falls back to the Workspace, last layouts that named it are gone, and the shapes stay.
  await stopServer();
  const oldFile = readJson(path.join(dataDir, 'layouts.json'));
  const campEntry = oldFile.spaces[camp.id];
  const keptShapes = campEntry.shared.map((l) => l.id);
  keptShapes.push('lvault01');
  campEntry.shared.push({ id: 'lvault01', name: 'Names one', by: samUser.key, at: '2026-10-02T00:00:00.000Z', shape: 'two-equal', areas: ['vault', 'ghostmod'] });
  campEntry.shared.unshift({ id: 'lfreefm', name: 'Old free-form', by: samUser.key, at: '2026-10-01T00:00:00.000Z', modules: [{ id: 'calendar', mode: 'dock', dockW: 360 }], snap: { all: false, pitch: 130 } });
  campEntry.last = { ...(campEntry.last || {}), [patUser.key]: { layout: 'lfreefm', at: 1 } };
  fs.writeFileSync(path.join(dataDir, 'layouts.json'), JSON.stringify(oldFile));
  const appPath = path.join(dataDir, 'app.json');
  const appFile = readJson(appPath);
  appFile.spaces.find((r) => r.id === camp.id).defaultLayout = 'lfreefm';
  fs.writeFileSync(appPath, JSON.stringify(appFile));
  await startServer();
  const pat4 = await login('pat', 'memberpass1234');
  const sam4 = await login('sam', 'memberpass1234');
  const oldRead = (await expect('read a space with a dropped free-form layout', 200, 'GET', `${C}/layouts`, { cookie: pat4 })).json;
  assert.deepEqual(oldRead.shared.map((l) => l.id), keptShapes, 'the free-form shared layout is not listed; the shapes are');
  assert.ok(oldRead.shared.every((l) => typeof l.shape === 'string' && Array.isArray(l.areas) && !('modules' in l)), 'every shared layout is a shape');
  assert.equal(oldRead.defaultLayout, null, 'a default that named it reads as none');
  assert.deepEqual(oldRead.firstVisit, { layout: 'workspace', shape: ONE }, 'the first visit falls back to the Workspace');
  assert.ok(oldRead.last !== 'lfreefm', 'no last layout names it');
  assert.equal((await forSpace(pat4)).defaultLayout, null, 'for-space carries no default either');
  assert.equal((await call('GET', `${C}/layouts${campGuest}`)).json.defaultLayout, null, 'nor for a guest');
  await expect('the dropped layout is not there', 404, 'PUT', `${C}/layouts/lfreefm`, { cookie: sam4, body: { name: 'Back' } });
  await expect('and cannot be made the default', 404, 'PATCH', C, { cookie: sam4, body: { defaultLayout: 'lfreefm' } });
  assert.ok(!('modules' in ((await sharedOf(sam4)).shared[0])), 'a moderator reads shapes too');
  n += 1;

  // Module names for the makers (owner, admin, moderator): every module a shared layout names and every one in cantOpen, as
  // the space shows it; a module not installed here (Vault) and a module the server has no manifest for (ghostmod) too: the
  // first has its manifest's name, the second none. Nobody else is sent a name, or the key.
  for (const [label, cookie] of [['owner', owner2], ['moderator', sam4]]) {
    const got = await sharedOf(cookie);
    assert.equal(got.names.vault, 'Vault', `${label}: a module that is not installed here is named`);
    assert.ok(!('ghostmod' in got.names), `${label}: a module with no manifest has no name`);
    assert.ok(got.names.calendar && got.names.polls, `${label}: modules a layout names are named`);
    assert.deepEqual(got.cantOpen.vault, { off: true }, `${label}: and shown as off`);
    assert.ok(Object.values(got.names).every((v) => typeof v === 'string' && v.length < 60), `${label}: names only`);
  }
  for (const [label, got] of [['member', await call('GET', `${C}/layouts`, { cookie: pat4 })], ['guest', await call('GET', `${C}/layouts${campGuest}`)]]) {
    assert.ok(!('names' in got.json) && !('cantOpen' in got.json), `${label}: no names key`);
    assert.ok(!got.text.includes('Vault') && !got.text.includes('"names"'), `${label}: no module name anywhere in the answer`);
  }
  // A template's layout, as a guest is shown it: a space on the Project template opens Project plan (schedule) and To-do. A
  // guest who can't read the Plan gets null for it in `layout` and `firstVisit.shape` of for-space, in the space's look, and
  // in GET .../layouts; a member gets the id.
  await expect('install the Plan', 201, 'POST', '/api/modules/bundled/schedule/install', { cookie: owner2 });
  await expect('enable the Plan', 200, 'PATCH', '/api/modules/schedule', { cookie: owner2, body: { enabled: true, allSpaces: true } });
  await expect('spaces may have their own template', 200, 'PATCH', '/api/settings', { cookie: owner2, body: { spaceTemplates: true } });
  const proj = (await expect('a space on the Project template', 200, 'POST', '/api/spaces', { cookie: owner2, body: { name: 'Proj', template: 'project', members: [patUser.key] } })).json.space;
  await expect('guests allowed on Proj', 200, 'PATCH', `/api/spaces/${proj.id}`, { cookie: owner2, body: { allowGuests: true } });
  const projGuest = (await expect('Proj guest link', 200, 'POST', `/api/spaces/${proj.id}/guest-link`, { cookie: owner2, body: {} })).json.space.guestToken;
  const gq = `guest=${encodeURIComponent(projGuest)}`;
  const shapeOf = (r) => [r.json.layout?.areas, r.json.firstVisit?.shape?.areas];
  assert.deepEqual(shapeOf(await call('GET', `/api/modules/for-space?space=${proj.id}&${gq}`)), [['schedule', 'todo'], ['schedule', 'todo']], 'guests read the Plan: the ids');
  await expect('guests lose the Plan', 200, 'PATCH', '/api/roles/guest', { cookie: owner2, body: { 'module.schedule.view': false } });
  const forGuest = await call('GET', `/api/modules/for-space?space=${proj.id}&${gq}`);
  assert.equal(forGuest.json.layout.areas[0], null, 'for-space: a guest gets null for a module they cannot read');
  assert.equal(forGuest.json.firstVisit.shape.areas[0], null, 'and in firstVisit.shape');
  assert.equal((await call('GET', `/api/spaces/${proj.id}/layouts?${gq}`)).json.firstVisit.shape.areas[0], null, 'GET .../layouts: firstVisit.shape too');
  assert.equal((await call('GET', `/api/guest-link/${encodeURIComponent(projGuest)}`)).json.look.workspace.layout.areas[0], null, 'the guest link\'s look');
  const forMember = await call('GET', `/api/modules/for-space?space=${proj.id}`, { cookie: pat4 });
  assert.deepEqual(shapeOf(forMember), [['schedule', 'todo'], ['schedule', 'todo']], 'a member keeps the id (unchanged)');
  assert.equal((await call('GET', `/api/spaces/${proj.id}/look`, { cookie: pat4 })).json.look.workspace.layout.areas[0], 'schedule', 'and in the look');
  // The template's Fixed Workspaces (`tabs`) are not a guest's: they have none, so their look lists the Workspace alone. A member's and a maker's look keep what the template says.
  const memberLook = (await call('GET', `/api/spaces/${proj.id}/look`, { cookie: pat4 })).json.look.workspace;
  // The Projects template's list: Projects (`schedule`) second, as the file writes it.
  const projectTabs = ['workspace', 'schedule', 'calendar', 'map', 'conference', 'whiteboard', 'documents'].map((id) => ({ id, show: ['workspace', 'schedule', 'calendar', 'conference', 'documents'].includes(id) }));
  assert.deepEqual(memberLook.tabs, projectTabs, 'a member: as the template says');
  assert.deepEqual((await call('GET', `/api/spaces/${proj.id}/look`, { cookie: owner2 })).json.look.workspace.tabs, projectTabs, 'a maker: as the template says');
  const linkLook = (await call('GET', `/api/guest-link/${encodeURIComponent(projGuest)}`)).json.look.workspace;
  assert.deepEqual(linkLook.tabs, [{ id: 'workspace', show: true }], 'the guest link: no Fixed Workspace');
  const guestLook = (await call('GET', `/api/spaces/${proj.id}/look?${gq}`)).json.look.workspace;
  assert.deepEqual(guestLook.tabs, [{ id: 'workspace', show: true }], 'a guest\'s look: no Fixed Workspace');
  assert.deepEqual(guestLook.layout.areas, linkLook.layout.areas, 'and the same shape');
  await expect('guests read the Plan again', 200, 'PATCH', '/api/roles/guest', { cookie: owner2, body: { 'module.schedule.view': true } });
  n += 1;

  // A removed person takes their own choices; a removed space takes all of its layouts.
  await expect('remove Camp', 200, 'DELETE', C, { cookie: owner2 });
  await expect('remove pat', 200, 'DELETE', `/api/users/${patUser.key}`, { cookie: owner2 });
  assert.ok(!readJson(path.join(dataDir, 'layouts.json')).spaces[S].system?.[patUser.key], "pat's system choices are gone");
  assert.equal(readJson(path.join(dataDir, 'layouts.json')).spaces[S].shared.length, 10, 'the shared ones stay');
  await expect('remove the space', 200, 'DELETE', `/api/spaces/${S}`, { cookie: owner2 });
  assert.deepEqual(readJson(path.join(dataDir, 'layouts.json')), { spaces: {} }, "the space's layouts are gone");
  await expect('its layouts route', 404, 'GET', L, { cookie: owner2 });
  n += 1;
} finally {
  await stopServer();
  fs.rmSync(dataDir, { recursive: true, force: true });
}

console.log(`check-layouts: OK (${n} checks)`);
