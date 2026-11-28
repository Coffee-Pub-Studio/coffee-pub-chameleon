#!/usr/bin/env node
/*
 * check-schedule-actions.mjs -- Planner - Projects' actions on an entry that is there, setDone and updateEntry, and who an
 * action-added entry is recorded as added by (modules/schedule/src/schedule-lib.js: scSetDone, scUpdate, scAddedBy; the wiring in
 * src/schedule.js; the manifest's declarations). A milestone's tick and work's done, a partial patch, every refusal with the
 * editor's own sentence, the plan's "Dates are needed" on and off, the `by` key. No page, no host, no network.
 * Usage: node modules/schedule/test/check-schedule-actions.mjs. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const code = fs.readFileSync(path.join(dir, 'src', 'schedule-lib.js'), 'utf8');
const page = fs.readFileSync(path.join(dir, 'src', 'schedule.js'), 'utf8');
const L = new Function(`${code}\nreturn { scClean, scValue, scProblem, scSetDone, scUpdate, scAddedBy, scFromAction, scMilestoneChanges };`)();
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'module.json'), 'utf8'));

let passed = 0;
const fails = [];
function test(name, fn) { try { fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }

const on = { datesRequired: true };
const off = { datesRequired: false };
const ms = () => L.scClean('m1', { kind: 'milestone', title: 'Launch', start: '2026-12-01', notes: 'Keep calm', phase: 'build', parent: 'p1', order: 'a1', by: 'u1', waitsOn: ['w1'], tags: ['t1'] });
const wk = () => L.scClean('w1', { kind: 'work', title: 'Write docs', start: '2026-11-01', end: '2026-11-10', owners: ['u2'], by: 'u1' });
const nt = () => L.scClean('n1', { kind: 'note', title: 'Idea', notes: 'x' });
const upd = (e, input, o = on) => L.scUpdate(e, input, o);
const refused = (e, input, sentence, o = on) => { const r = upd(e, input, o); assert.equal(r.entry, null); assert.equal(r.problem, sentence); };

test('setDone ticks a milestone as the page does: ticked and done', () => {
  const r = L.scSetDone(ms(), true);
  assert.equal(r.problem, '');
  assert.equal(r.entry.ticked, true);
  assert.equal(r.entry.done, true);
  const back = L.scSetDone(r.entry, false);
  assert.equal(back.entry.ticked, false);
  assert.equal(back.entry.done, false);
  assert.deepEqual({ ...L.scValue(back.entry), done: undefined }, { ...L.scValue(ms()), done: undefined });
});

test('setDone marks work done and not done; ticked stays off', () => {
  const r = L.scSetDone(wk(), true);
  assert.equal(r.entry.done, true);
  assert.equal(r.entry.ticked, false);
  assert.equal(L.scSetDone(r.entry, false).entry.done, false);
});

test('a milestone whose entries are all done is settled back to done after an untick, as the page does', () => {
  const m = L.scClean('m1', { kind: 'milestone', title: 'L', start: '2026-12-01', done: true, progress: 100 });
  const un = L.scSetDone(m, false).entry;
  assert.equal(un.done, false);
  const under = L.scClean('w1', { kind: 'work', title: 'a', start: '2026-12-01', parent: 'm1', done: true });
  assert.deepEqual(L.scMilestoneChanges([un, under], { m1: { done: 1, total: 1 } }), [{ id: 'm1', done: true, progress: 100 }]);
});

test('setDone refuses a note and a non-boolean', () => {
  assert.equal(L.scSetDone(nt(), true).problem, 'A note has nothing to tick off.');
  assert.equal(L.scSetDone(ms(), 'yes').problem, 'Say whether it is done: true or false.');
  assert.equal(L.scSetDone(ms(), undefined).entry, null);
  const label = (k) => (k === 'note' ? 'memo' : k);
  assert.equal(L.scSetDone(nt(), true, { label }).problem, 'A memo has nothing to tick off.');
});

test('updateEntry changes only the fields given', () => {
  const m = ms();
  const r = upd(m, { title: '  Big   launch ' });
  assert.equal(r.problem, '');
  assert.equal(r.entry.title, 'Big launch');
  assert.deepEqual({ ...L.scValue(r.entry), title: '' }, { ...L.scValue(m), title: '' });
  const d = upd(m, { date: '2027-01-05' }).entry;
  assert.equal(d.start, '2027-01-05');
  assert.equal(d.title, 'Launch');
  assert.equal(d.notes, 'Keep calm');
  assert.equal(d.parent, 'p1');
  assert.deepEqual(d.waitsOn, ['w1']);
  assert.equal(d.by, 'u1');
  const w = upd(wk(), { end: '2026-11-20' }).entry;
  assert.deepEqual([w.start, w.end, w.title, w.owners], ['2026-11-01', '2026-11-20', 'Write docs', ['u2']]);
  const s = upd(wk(), { start: '2026-11-05', notes: 'Chapter one' }).entry;
  assert.deepEqual([s.start, s.end, s.notes], ['2026-11-05', '2026-11-10', 'Chapter one']);
  assert.equal(upd(nt(), { title: 'Better idea' }).entry.notes, 'x');
});

test('null is the same as not given; an empty notes clears the notes', () => {
  const r = upd(ms(), { title: 'New', date: null, notes: null });
  assert.equal(r.entry.start, '2026-12-01');
  assert.equal(r.entry.notes, 'Keep calm');
  assert.equal(upd(ms(), { notes: '  ' }).entry.notes, '');
  assert.equal('notes' in L.scValue(upd(ms(), { notes: '' }).entry), false);
});

test('refuses with the editor\'s sentences', () => {
  refused(ms(), { title: '   ' }, 'Give it a title.');
  const start = 'The start is a day from 1900 to 2200, such as 2026-10-14.';
  refused(ms(), { date: '2026-02-30' }, start);
  refused(ms(), { date: '1899-12-31' }, start);
  refused(ms(), { date: '2201-01-01' }, start);
  refused(ms(), { date: 'soon' }, start);
  refused(wk(), { start: '2026-13-01' }, start);
  refused(wk(), { end: '2026-11-31' }, 'The end is a day from 1900 to 2200, such as 2026-10-14.');
  refused(wk(), { end: '2026-10-31' }, 'The end is before the start.');
  refused(wk(), { start: '2026-11-11' }, 'The end is before the start.');
  refused(wk(), { start: '2026-12-01', end: '2026-11-30' }, 'The end is before the start.');
});

test('refuses text past its length, after trimming', () => {
  assert.equal(upd(ms(), { title: ` ${'a'.repeat(120)} ` }).problem, '');
  refused(ms(), { title: 'a'.repeat(121) }, 'The title is at most 120 characters.');
  assert.equal(upd(ms(), { notes: `  ${'b'.repeat(2000)}  ` }).problem, '');
  refused(ms(), { notes: 'b'.repeat(2001) }, 'The notes are at most 2000 characters.');
  refused(ms(), { title: 5 }, 'The title must be text.');
});

test('refuses the wrong field for the kind', () => {
  refused(wk(), { date: '2026-12-01' }, 'The work has a start and an end, not a day.');
  refused(ms(), { start: '2026-12-01' }, 'The milestone has a day, not a start and an end.');
  refused(ms(), { end: '2026-12-01' }, 'The milestone has a day, not a start and an end.');
  refused(nt(), { date: '2026-12-01' }, 'A note has no day.');
  refused(nt(), { title: 'x', start: '2026-12-01' }, 'A note has no day.');
});

test('progress is not a field: it follows what is under a milestone', () => {
  assert.ok(!/progress/.test(JSON.stringify(manifest.actions.provides.find((a) => a.name === 'updateEntry').input)));
  refused(ms(), { progress: 50 }, 'Say what to change: a title, a day, notes.');
  assert.equal(upd(ms(), { title: 'New', progress: 50 }).entry.progress, null);
});

test('nothing given is refused', () => {
  refused(ms(), {}, 'Say what to change: a title, a day, notes.');
  refused(ms(), { title: null }, 'Say what to change: a title, a day, notes.');
  assert.equal(upd(null, { title: 'x' }).entry, null);
});

test('Dates are needed: on refuses clearing a day, off allows it', () => {
  refused(ms(), { date: '' }, 'This plan needs dates: give the milestone a day.');
  refused(wk(), { start: '', end: '' }, 'This plan needs dates: give the work a start and an end.');
  const m = upd(ms(), { date: '' }, off);
  assert.equal(m.problem, '');
  assert.equal(m.entry.start, '');
  assert.equal('start' in L.scValue(m.entry), false);
  const w = upd(wk(), { start: '', end: '' }, off);
  assert.deepEqual([w.entry.start, w.entry.end], ['', '']);
  // an entry with no day may be retitled with dates off, and is refused with them on, as the editor's Save does
  const undated = L.scClean('m2', { kind: 'milestone', title: 'Someday' });
  assert.equal(upd(undated, { title: 'Later' }, off).problem, '');
  refused(undated, { title: 'Later' }, 'This plan needs dates: give the milestone a day.');
  assert.equal(upd(undated, { date: '2027-02-01' }).entry.start, '2027-02-01');
  const one = upd(L.scClean('w2', { kind: 'work', title: 'x' }), { start: '2026-11-03' }, off).entry;
  assert.deepEqual([one.start, one.end], ['2026-11-03', '2026-11-03']);
});

// Pulled work's description and the milestone it is part of (plan-github-full-sync.md, section 8).
const pulled = () => L.scClean('gh-7', { kind: 'work', title: 'Bug', start: '2026-11-01', end: '2026-11-02', description: 'Old text', parent: 'ghm-1', order: 'b', source: { from: 'github', repo: 'o/r', number: 7, updated: '2026-11-01T00:00:00Z' } });
const outline = [L.scClean('ghm-1', { kind: 'milestone', title: 'One', start: '2026-12-01' }), L.scClean('ghm-2', { kind: 'milestone', title: 'Two', start: '2026-12-02' }), pulled()];
test('updateEntry replaces an issue\'s description whole; only an issue has one', () => {
  const r = upd(pulled(), { description: '  New\r\ntext  ' });
  assert.equal(r.problem, '');
  assert.equal(L.scValue(r.entry).description, 'New\ntext');
  assert.deepEqual(L.scValue(r.entry).source, L.scValue(pulled()).source, 'where it came from is kept');
  refused(wk(), { description: 'x' }, 'Only an issue has a description. Change the notes instead.');
  refused(ms(), { description: 'x' }, 'Only an issue has a description. Change the notes instead.');
  refused(pulled(), { description: '   ' }, 'Give the description some words.');
  refused(pulled(), { description: 'd'.repeat(2001) }, 'The description is at most 2000 characters here.');
  assert.equal(upd(pulled(), { description: 'd'.repeat(2000) }).problem, '');
  refused(pulled(), { description: 3 }, 'The description must be text.');
});
test('updateEntry\'s parent is checked as the editor\'s Part of: a milestone, never itself or one under it', () => {
  const words = (k, x) => (x && x.a ? `a ${k}` : k);
  const o = { ...on, label: words, entries: outline, orderAtEnd: () => 'zz' };
  const moved = upd(pulled(), { parent: 'ghm-2' }, o);
  assert.deepEqual([moved.problem, moved.entry.parent, moved.entry.order], ['', 'ghm-2', 'b'], 'pulled work keeps its order');
  const none = upd(pulled(), { parent: '' }, o);
  assert.equal('parent' in L.scValue(none.entry), false, 'empty: at the top');
  refused(pulled(), { parent: 'gh-7' }, 'That is not a milestone it can be part of.', o);
  refused(pulled(), { parent: 'nowhere' }, 'That is not a milestone it can be part of.', o);
  // An entry of the plan's own goes to the end of its new place, as the editor's save puts it.
  const top = L.scClean('m0', { kind: 'milestone', title: 'Top', start: '2026-12-01', order: 'a' });
  const under = L.scClean('m9', { kind: 'milestone', title: 'Under', start: '2026-12-01', parent: 'm0', order: 'a' });
  const own = L.scClean('w5', { kind: 'work', title: 'Own', start: '2026-11-01', end: '2026-11-02', order: 'c' });
  const o2 = { ...on, label: words, entries: [top, under, own], orderAtEnd: (p) => (p === 'm0' ? 'b' : 'q') };
  assert.deepEqual([upd(own, { parent: 'm0' }, o2).entry.parent, upd(own, { parent: 'm0' }, o2).entry.order], ['m0', 'b']);
  refused(top, { parent: 'm9' }, 'That is not a milestone it can be part of.', o2);
  assert.equal(upd(own, { parent: '' }, o2).entry.order, 'c', 'no move, no new order');
});

test('the plan\'s own words are used in the sentences', () => {
  const label = (k) => ({ milestone: 'checkpoint', work: 'task', note: 'memo' }[k] || k);
  assert.equal(L.scUpdate(ms(), { date: '' }, { datesRequired: true, label }).problem, 'This plan needs dates: give the checkpoint a day.');
  assert.equal(L.scUpdate(wk(), { date: '2026-12-01' }, { label }).problem, 'The task has a start and an end, not a day.');
});

test('who added it: the asker\'s key, else the signed-in person\'s key', () => {
  assert.equal(L.scAddedBy({ from: 'todo', by: 'Claude', byKey: 'agent-key' }, 'me'), 'agent-key');
  assert.equal(L.scAddedBy({ from: 'todo', by: 'Guest', byKey: null }, 'me'), 'me');
  assert.equal(L.scAddedBy({}, 'me'), 'me');
  assert.equal(L.scAddedBy(undefined, 'me'), 'me');
  assert.equal(L.scAddedBy({ byKey: '  ' }, 'me'), 'me');
  assert.equal(L.scAddedBy({ byKey: 'x'.repeat(201) }, 'me'), 'me');
  const e = L.scFromAction('milestone', { title: 'Ship', date: '2026-12-01' }, L.scAddedBy({ byKey: 'agent-key' }, 'me'));
  assert.equal(e.by, 'agent-key');
  assert.equal(L.scValue(e).by, 'agent-key');
  assert.equal(upd(e, { title: 'Ship it' }).entry.by, 'agent-key');
});

test('the page carries the actions library: the edit right checked, the same handlers the server runs', () => {
  // The handlers are in src/schedule-lib-actions.js (plan-agent-edit-delete.md, step 2); modules/schedule/test/
  // check-schedule-lib-actions.mjs runs them both ways. The page runs them through host.actions.fromLibrary, as they are: the
  // settings, words, order keys and phases come from the SDK's ctx, and the milestones and the link are in the answer.
  const actions = fs.readFileSync(path.join(dir, 'src', 'schedule-lib-actions.js'), 'utf8');
  assert.ok(/const by = scAddedBy\(ctx, ctx\.credit && ctx\.credit\.key\);/.test(actions), 'an add stores the asker\'s key');
  assert.ok(!/ctx\.by\b/.test(actions) && !/ctx\.by\b/.test(page), 'the asker\'s name is never stored as the person');
  assert.ok(/scSetDone\(e, input\.done/.test(actions) && /scUpdate\(e, input,/.test(actions));
  assert.ok(/host\.actions\.fromLibrary\(ACTION_HANDLERS, \{ after: afterAction \}\)/.test(page), 'the library is carried here as it is');
  assert.ok(/if \(!canEdit\) throw new Error\(name\.startsWith\('add'\) \? REFUSED : CHANGE_REFUSED\)/.test(page), 'the edit right is checked');
  assert.ok(/scMilestoneChanges\(next, ctx\.util\.rollup\(/.test(actions), 'the milestones follow, in the answer');
});

test('the manifest declares both, as writes that name a plan entry', () => {
  const { cleanManifest } = require(path.join(dir, '..', '..', 'server', 'modules.js'));
  const files = new Set(['module.json', 'page.html', 'canvas.html']);
  const m = cleanManifest(JSON.parse(JSON.stringify(manifest)), files);
  const by = Object.fromEntries(m.actions.provides.map((a) => [a.name, a]));
  for (const n of ['setDone', 'updateEntry', 'setColumn']) {
    assert.equal(by[n].effect, 'write', n);
    assert.ok(by[n].description && by[n].description.endsWith('.'), n);
    assert.ok(!by[n].takes || !by[n].takes.length, `${n} makes no object`);
    assert.ok(!by[n].local && !by[n].askerOnly && by[n].ai !== false, n);
  }
  assert.deepEqual(by.setDone.input, { ref: 'ref:schedule:plan', done: 'boolean' });
  assert.deepEqual(by.updateEntry.input, { ref: 'ref:schedule:plan', title: 'string?', date: 'date?', start: 'date?', end: 'date?', owners: 'text?', fields: 'text?', notes: 'text?', description: 'text?', parent: 'string?' });
  assert.deepEqual(by.updateEntry.clears, ['date', 'start', 'end', 'owners', 'fields', 'notes', 'parent'], 'an empty description never empties an issue');
  // addComment (plan-github-full-sync.md, section 8): one comment on an issue's work, a write an agent may ask for.
  assert.deepEqual([by.addComment.effect, by.addComment.input], ['write', { ref: 'ref:schedule:plan', text: 'text' }]);
  assert.ok(!by.addComment.local && !by.addComment.askerOnly && by.addComment.ai !== false && (!by.addComment.takes || !by.addComment.takes.length));
  assert.ok(['addMilestone', 'addWork', 'addNote'].every((n) => by[n]), 'the adds are still there');
  assert.equal(by.setColumn.effect, 'write');
  assert.deepEqual(by.setColumn.input, { ref: 'ref:schedule:plan', column: 'string', before: 'string?' });
  assert.ok(!by.setColumn.takes || !by.setColumn.takes.length, 'it makes no object');
  assert.ok(by.setColumn.inputHints.column.includes('column id'));
  const cols = m.settings.find((s) => s.key === 'boardColumns');
  assert.deepEqual([cols.type, cols.scope, cols.template, cols.default], ['choice', 'space', 'default', 'stages']);
  assert.deepEqual(cols.options.map((o) => o.value), ['stages', 'priority']);
  const perm = m.permissions.find((p) => p.key === 'columns');
  assert.deepEqual([perm.label, perm.default.moderator, perm.default.member, perm.default.guest], ["Change the board's columns and fields", true, false, false]);
});

test('an added note keeps the line breaks of the notes an agent sent', () => {
  const notes = 'First paragraph.\n\nSecond paragraph.\nThird line.';
  const r = L.scFromAction('note', { title: 'Idea', notes }, 'u1');
  const e = r.entry || r;
  assert.equal(L.scValue(L.scClean('n2', e)).notes, notes);
});

if (fails.length) { console.error(`check-schedule-actions: ${fails.length} failed\n${fails.join('\n')}`); process.exit(1); }
console.log(`check-schedule-actions: OK (${passed} checks)`);
