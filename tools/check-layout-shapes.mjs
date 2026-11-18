#!/usr/bin/env node
/*
 * check-layout-shapes.mjs -- Layout picker, step 1 (documentation/plans/plan-layout-picker.md): the shape list
 * (server/layout-shapes.js), the page's copy (public/layout-shapes.js), cleanShape() and whoCantOpen().
 *   1. The list. Six shapes, in order. Every share is on the grid (100, 50, two-thirds, one-third), each shape's columns
 *      add up to 100, and its area count matches its columns and stacks. The page's copy equals the server's. The server's
 *      list of what can't share a column agrees with public/composites.js and with NEVER_STACKED in server/layouts.js.
 *   2. cleanShape(). Each shape is accepted with modules and with nulls; an unknown shape, a wrong length, an extra key
 *      (a width), a module twice, chat or conference, an unknown module, and Calendar, To-do, Maps or a composite id in
 *      a stacked area are each refused with one sentence. The same ids are fine in area 1.
 *   3. whoCantOpen(). Roles from manifest defaults and from a changed set, never owner or admin, a module off or not
 *      installed marked off, a module with no read guard left out.
 * All in-process: nothing here starts a server.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const server = require('../server/layout-shapes.js');
const { cleanShape, whoCantOpen, SHAPES, GRID, COMPOSITE_PARTS } = server;
// The plan's table, written out here and read from nowhere (plan-layout-picker.md, "The six shapes").
const T = 100 / 3;
const PLAN = [
  { id: 'one', areas: 1, columns: [100], stacked: [] },
  { id: 'two-equal', areas: 2, columns: [50, 50], stacked: [] },
  { id: 'wide-narrow', areas: 2, columns: [200 / 3, T], stacked: [] },
  { id: 'three-equal', areas: 3, columns: [T, T, T], stacked: [] },
  { id: 'tall-split', areas: 3, columns: [50, 50], stacked: [2, 3] },
  { id: 'wide-split', areas: 3, columns: [200 / 3, T], stacked: [2, 3] },
];
const PLAN_GRID = [100, 50, 200 / 3, 100 / 3];

let n = 0;
const ok = (cond, label) => { assert.ok(cond, label); n += 1; };
const same = (got, want, label) => { assert.deepEqual(got, want, label); n += 1; };
const near = (a, b) => Math.abs(a - b) < 1e-9;

// The page's copy is an ES module with a .js name; load it from a temporary .mjs.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-shapes-'));
fs.copyFileSync(path.join(ROOT, 'public/layout-shapes.js'), path.join(dir, 'shapes.mjs'));
fs.copyFileSync(path.join(ROOT, 'public/composites.js'), path.join(dir, 'composites.mjs'));
const page = await import(pathToFileURL(path.join(dir, 'shapes.mjs')).href);
const { COMPOSITES, aliasesFor } = await import(pathToFileURL(path.join(dir, 'composites.mjs')).href);
fs.rmSync(dir, { recursive: true, force: true });

// 1. The list.
const plain = (v) => JSON.parse(JSON.stringify(v));
same(plain(SHAPES), plain(PLAN), 'the server list is the plan table');
same(plain(page.SHAPES), plain(PLAN), 'the page list is the plan table');
same(plain(GRID), plain(PLAN_GRID), 'the grid is full, halves and thirds');
ok(SHAPES.every((s, i) => s.columns.every((c, j) => c === PLAN[i].columns[j])), 'the shares match the plan to the last digit');
same(SHAPES.map((s) => s.id), ['one', 'two-equal', 'wide-narrow', 'three-equal', 'tall-split', 'wide-split'], 'the six shapes of the sketch, in order');
same(SHAPES.map((s) => s.areas), [1, 2, 2, 3, 3, 3], 'areas per shape');
for (const s of SHAPES) {
  ok(s.columns.every((c) => GRID.some((g) => near(g, c))), `${s.id}: every share is on the grid`);
  ok(near(s.columns.reduce((a, b) => a + b, 0), 100), `${s.id}: columns add up to 100`);
  const expect = s.areas - s.stacked.length + (s.stacked.length ? 1 : 0);
  ok(s.columns.length === expect, `${s.id}: ${s.columns.length} columns for ${s.areas} areas with ${s.stacked.length} stacked`);
  ok(s.stacked.every((a) => Number.isInteger(a) && a >= 1 && a <= s.areas), `${s.id}: stacked areas are real area numbers`);
  ok(s.stacked.length === 0 || s.stacked.length === 2, `${s.id}: a stack is two areas`);
}
same(SHAPES.find((s) => s.id === 'tall-split').columns, [50, 50], 'tall-split: two equal columns');
ok(near(SHAPES.find((s) => s.id === 'wide-split').columns[0], 200 / 3) && near(SHAPES.find((s) => s.id === 'wide-split').columns[1], 100 / 3), 'wide-split: two-thirds and one-third');
same(JSON.parse(JSON.stringify(page.SHAPES)), JSON.parse(JSON.stringify(SHAPES)), 'the page copy equals the server list');
ok(page.SHAPES.every((s, i) => s.columns.every((c, j) => c === SHAPES[i].columns[j])), 'the page copy has the same shares to the last digit');
ok(page.shapeById('one') && page.shapeById('nope') === null, "the page's shapeById");
ok(Object.isFrozen(SHAPES) && SHAPES.every((s) => Object.isFrozen(s) && Object.isFrozen(s.columns) && Object.isFrozen(s.stacked)), 'the list is frozen');
const parts = [...new Set(COMPOSITES.flatMap((c) => c.parts))].sort();
same([...COMPOSITE_PARTS].sort(), parts, 'the modules that read as a composite agree with public/composites.js');
const stackedRule = fs.readFileSync(path.join(ROOT, 'server/layouts.js'), 'utf8').match(/NEVER_STACKED = Object\.freeze\((\[[^\]]*\])\)/);
ok(stackedRule, 'server/layouts.js still names NEVER_STACKED');
const NEVER_STACKED = JSON.parse(stackedRule[1].replace(/'/g, '"'));
ok(NEVER_STACKED.every((id) => cleanShape({ shape: 'tall-split', areas: [null, id, null] }).error), 'what server/layouts.js never stacks is refused in a stacked area here');

// 2. cleanShape().
const MODS = ['todo', 'calendar', 'maps', 'documents', 'goals', 'schedule'];
const good = (input, label, opts) => { const r = cleanShape(input, opts); ok(r.shape && !r.error, `${label}: ${r.error || ''}`); return r.shape; };
const bad = (input, sentence, label, opts) => { const r = cleanShape(input, opts); ok(r.error && !r.shape, `${label}: refused`); if (sentence) ok(r.error === sentence, `${label}: ${r.error}`); ok(!/\n/.test(r.error) && r.error.endsWith('.'), `${label}: one sentence`); };
good({ shape: 'one', areas: ['documents'] }, 'one');
good({ shape: 'one', areas: [null] }, 'one, empty');
good({ shape: 'two-equal', areas: ['documents', null] }, 'two-equal');
good({ shape: 'wide-narrow', areas: ['calendar', 'documents'] }, 'wide-narrow with Calendar');
good({ shape: 'three-equal', areas: ['maps', 'calendar', 'documents'] }, 'three-equal puts composites anywhere');
good({ shape: 'tall-split', areas: ['calendar', 'documents', 'goals'] }, 'tall-split, Calendar in area 1');
good({ shape: 'wide-split', areas: ['maps', null, 'goals'] }, 'wide-split, Maps in area 1');
good({ shape: 'wide-split', areas: [null, null, null] }, 'wide-split, all empty');
same(good({ shape: 'wide-split', areas: ['documents', 'goals', null] }, 'the answer', { modules: MODS }), { shape: 'wide-split', areas: ['documents', 'goals', null] }, 'the cleaned shape');
bad(undefined, null, 'nothing');
bad([], null, 'a list');
bad({ areas: [null] }, 'Pick a shape from the list.', 'no shape');
bad({ shape: 'seven', areas: [null] }, 'Pick a shape from the list.', 'unknown shape');
bad({ shape: 7, areas: [null] }, 'Pick a shape from the list.', 'shape not text');
bad({ shape: 'three-equal', areas: ['documents', null] }, 'This shape has 3 areas.', 'too few');
bad({ shape: 'one', areas: ['documents', null] }, 'This shape has 1 area.', 'too many');
bad({ shape: 'one' }, 'This shape has 1 area.', 'areas missing');
bad({ shape: 'one', areas: 'documents' }, 'This shape has 1 area.', 'areas not a list');
bad({ shape: 'one', areas: [null], widths: [100] }, null, 'a width');
bad({ shape: 'two-equal', areas: ['todo', 'todo'] }, null, 'a module twice');
ok(cleanShape({ shape: 'two-equal', areas: ['todo', 'todo'] }).error.includes('two areas'), 'twice: says so');
bad({ shape: 'two-equal', areas: ['chat', null] }, "The chat and the call are in the column on the left; they can't go in an area.", 'chat');
bad({ shape: 'two-equal', areas: [null, 'conference'] }, "The chat and the call are in the column on the left; they can't go in an area.", 'conference');
bad({ shape: 'one', areas: [3] }, null, 'a number');
bad({ shape: 'one', areas: ['Bad Id'] }, null, 'a bad id');
bad({ shape: 'one', areas: ['dest:calendar'] }, null, 'a composite id outside a stack still is not a module id');
bad({ shape: 'two-equal', areas: ['unknown', null] }, null, 'a module outside the list', { modules: MODS });
good({ shape: 'two-equal', areas: ['unknown', null] }, 'no list given: any well-formed id passes');
for (const shape of ['tall-split', 'wide-split']) {
  for (const id of ['calendar', 'todo', 'maps']) {
    for (const at of [1, 2]) {
      const areas = [null, null, null];
      areas[at] = id;
      bad({ shape, areas }, `${id === 'todo' ? 'To-do' : id[0].toUpperCase() + id.slice(1)} can't share a column; put it in area 1.`, `${shape}: ${id} in area ${at + 1}`);
    }
  }
}
bad({ shape: 'tall-split', areas: [null, 'chat', null] }, "The chat and the call are in the column on the left; they can't go in an area.", 'chat in a stack says the chat sentence');
good({ shape: 'tall-split', areas: ['documents', 'goals', 'schedule'] }, 'ordinary modules stack');

bad({ shape: 'tall-split', areas: [null, 'dest:calendar', null] }, '"dest:calendar" is not a module you can use here.', 'a composite id is not a module id');
bad({ shape: 'tall-split', areas: [null, 'calendar', null] }, "Chameleon Calendar can't share a column; put it in area 1.", 'the module name as a person reads it', { names: { calendar: 'Chameleon Calendar' } });
bad({ shape: 'tall-split', areas: [null, 'calendar', null] }, '"calendar" is not a module you can use here.', 'a module not allowed here gets that sentence, not the stack one', { modules: ['documents'] });
bad({ shape: 'tall-split', areas: [null, 'todo', null] }, "To-do can't share a column; put it in area 1.", 'To-do reads To-do when no names map is passed');
bad({ shape: 'one', areas: [null], ['x'.repeat(80)]: 1 }, null, 'a long unknown key');
ok(!cleanShape({ shape: 'one', areas: [null], ['x'.repeat(80)]: 1 }).error.includes('x'.repeat(41)), 'an unknown key is cut to 40 characters');
for (const options of [null, undefined, 5, 'x', [], {}]) { let r; try { r = cleanShape({ shape: 'one', areas: ['documents'] }, options); } catch (e) { r = { threw: e.message }; } ok(r.shape && !r.threw, `cleanShape takes options ${JSON.stringify(options)}`); }
for (const modules of ['documents', 5, {}, true]) bad({ shape: 'one', areas: ['documents'] }, null, `modules ${JSON.stringify(modules)} that is not a list is refused`, { modules });
good({ shape: 'one', areas: ['documents'] }, 'modules null means any', { modules: null });
bad({ shape: 'one', areas: ['documents'] }, null, 'an empty modules list allows none', { modules: [] });
ok(cleanShape({ shape: 'one', areas: [null] }, { modules: [], names: null }).shape, 'an empty area needs no module');

// To-do and Calendar read as a composite only where the Calendar is on. Checked against the real aliasesFor() of
// public/composites.js, not assumed: an id is refused in a stacked area exactly when the page folds it into a dest:*
// composite (Maps with the Map answering, as the server cannot know that it does not).
const ALL = ['calendar', 'todo', 'maps', 'documents', 'goals', 'whiteboard', 'travel', 'vault', 'schedule'];
for (const [label, on] of [['Calendar on', ALL], ['Calendar off', ALL.filter((id) => id !== 'calendar')]]) {
  const alias = aliasesFor(on, ['map']);
  for (const id of on) {
    const folded = typeof alias[id] === 'string' && alias[id].startsWith('dest:');
    const r = cleanShape({ shape: 'tall-split', areas: [null, id, null] }, { on, modules: on });
    ok(Boolean(r.error) === folded, `${label}: ${id} ${folded ? 'folds into a composite and is refused' : 'is an ordinary module and stacks'} (${r.error || 'accepted'})`);
  }
}
ok(cleanShape({ shape: 'tall-split', areas: [null, 'maps', null] }, { on: ['documents', 'maps'], modules: ['documents', 'maps'] }).error, 'Maps is refused in a stack whatever is on');
const ON = ['calendar', 'goals', 'todo', 'documents', 'whiteboard', 'travel', 'vault'];
const OFF = ON.filter((id) => id !== 'calendar');
for (const areas of [['goals', 'todo', 'documents'], ['documents', 'todo', 'goals'], ['travel', 'vault', 'todo']]) {
  const withCalendar = cleanShape({ shape: 'tall-split', areas }, { modules: ON });
  ok(withCalendar.error === "To-do can't share a column; put it in area 1.", `${areas}: refused with the Calendar on (${withCalendar.error})`);
  ok(cleanShape({ shape: 'tall-split', areas }, { modules: OFF }).shape, `${areas}: accepted with the Calendar off`);
  ok(cleanShape({ shape: 'tall-split', areas }, { modules: OFF, on: ON }).error, `${areas}: \`on\` wins over \`modules\``);
  ok(cleanShape({ shape: 'tall-split', areas }, { modules: ON, on: OFF }).shape, `${areas}: \`on\` wins over \`modules\`, off`);
}
good({ shape: 'tall-split', areas: ['whiteboard', 'goals', 'documents'] }, 'whiteboard, goals, documents stack with the Calendar on', { modules: ON });
good({ shape: 'tall-split', areas: ['whiteboard', 'goals', 'documents'] }, 'and with it off', { modules: OFF });
good({ shape: 'tall-split', areas: ['todo', 'goals', 'documents'] }, 'To-do in area 1 with the Calendar on', { modules: ON });
bad({ shape: 'tall-split', areas: ['goals', 'calendar', 'documents'] }, "Calendar can't share a column; put it in area 1.", 'Calendar in a stack', { modules: ON });

// 3. whoCantOpen().
const manifests = {
  todo: { id: 'todo', access: { read: 'read' } },
  goals: { id: 'goals', access: { read: 'view' } },
  documents: { id: 'documents', access: {} },
  polls: { id: 'polls' },
};
const defaults = { moderator: { 'module.todo.read': true, 'module.goals.view': true }, member: { 'module.todo.read': true, 'module.goals.view': true }, guest: { 'module.todo.read': false, 'module.goals.view': true } };
same(whoCantOpen(['todo', 'goals', 'documents', 'polls'], { manifests, rolePermissions: defaults }), { todo: { roles: ['guest'] } }, 'guests lack To-do by default; nothing else is listed');
const changed = { ...defaults, member: { ...defaults.member, 'module.todo.read': false }, moderator: {} };
same(whoCantOpen(['todo', 'goals'], { manifests, rolePermissions: changed }), { todo: { roles: ['moderator', 'member', 'guest'] }, goals: { roles: ['moderator'] } }, 'a changed set, in the order moderator, member, guest');
same(whoCantOpen(['todo'], { manifests, rolePermissions: {} }), { todo: { roles: ['moderator', 'member', 'guest'] } }, 'a role left out has none');
ok(!JSON.stringify(whoCantOpen(['todo', 'goals'], { manifests, rolePermissions: {} })).match(/owner|admin/), 'never the owner or the admin');
same(whoCantOpen(['todo', 'missing'], { manifests, rolePermissions: defaults, off: ['todo'] }), { todo: { off: true }, missing: { off: true } }, 'off in the place, and not installed');
same(whoCantOpen([], { manifests }), {}, 'no modules');
same(whoCantOpen(undefined), {}, 'no list');

// whoCantOpen() with odd input.
for (const o of [null, undefined, 5, 'x', []]) { let r; try { r = whoCantOpen(['todo'], o); } catch (e) { r = { threw: e.message }; } ok(!r.threw && r.todo && r.todo.off === true, `whoCantOpen takes options ${JSON.stringify(o)}`); }
same(whoCantOpen(['todo'], { manifests: null, rolePermissions: null, off: null }), { todo: { off: true } }, 'null parts read as empty');
same(whoCantOpen(['constructor', '__proto__', 'toString', 'hasOwnProperty'], { manifests }), { constructor: { off: true }, ['__proto__']: { off: true }, toString: { off: true }, hasOwnProperty: { off: true } }, 'names on Object.prototype are not installed modules');
same(whoCantOpen(['goals'], { manifests, rolePermissions: { moderator: 'yes', member: null, guest: [] }, off: 'goals' }), { goals: { roles: ['moderator', 'member', 'guest'] } }, 'a string off is not matched with includes; odd role sets read as having none');
same(whoCantOpen(['goals', 5, null], { manifests, rolePermissions: defaults }), { 5: { off: true }, null: { off: true } }, 'an id that is not text is off');
console.log(`check-layout-shapes: ${n} checks passed`);
