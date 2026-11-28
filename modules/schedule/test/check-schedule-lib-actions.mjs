#!/usr/bin/env node
/*
 * check-schedule-lib-actions.mjs -- Planner - Projects' actions library (src/schedule-lib-actions.js, ACTION_HANDLERS), run the two
 * ways it is carried out (plan-agent-server-actions.md, step 7): through the server's runner (its worker process and vm, then its
 * outcomeOf check, with carrier 'server') and through the SDK's page adapter (host.actions.fromLibrary) on a stand-in host, both
 * from tools/module-actions-harness.mjs, expecting the same writes, pointer, note, links and refusals. Both give the handler the
 * same facts (ctx.settings, ctx.util.label, order and rollup, ctx.space.phases with their names). addMilestone, addWork and addNote
 * (the plan's "Dates are needed", owners by name, an object's parent and phase by name, the order key at the end, the link to what
 * it was made from), setDone and updateEntry (only the fields given, "" clearing a day, the owners or the notes), each with the
 * editor's sentence, and the milestones' done and progress written in the same answer, as the page's save settles them.
 * Exits 1 on failure.
 */
import assert from 'node:assert/strict';
import { onPage, onRunner, handlersOf } from '../../../tools/module-actions-harness.mjs';

let n = 0;
const test = async (name, fn) => { try { await fn(); n += 1; } catch (e) { process.exitCode = 1; console.error(`FAIL ${name}\n${e.stack || e}`); } };
const sorted = (writes) => (writes || []).slice().sort((a, b) => (a.key < b.key ? -1 : 1));
// Both ways, the runner as the server's own (carrier 'server'): the same answer, else the test fails.
async function same(action, input, world) {
  const r = { page: await onPage('schedule', action, input, world, { name: 'Planner - Projects' }), runner: await onRunner('schedule', action, input, world, { kinds: ['plan'], carrier: 'server' }) };
  assert.ok(!r.runner.fault, `${action}: the runner faulted (${r.runner.fault})`);
  if (r.page.refused !== undefined || r.runner.refused !== undefined) {
    assert.equal(r.runner.refused, r.page.refused, `${action}: the same refusal`);
    return r.page;
  }
  assert.deepEqual(sorted(r.runner.writes), sorted(r.page.writes), `${action}: the same writes`);
  assert.deepEqual(r.runner.ref, r.page.ref, `${action}: the same pointer`);
  assert.deepEqual(r.runner.data, r.page.data, `${action}: the same note`);
  assert.deepEqual(r.runner.effects, r.page.effects, `${action}: the same links`);
  return r.page;
}
const refuses = async (action, input, world, words) => assert.equal((await same(action, input, world)).refused, words);
const written = (r, key) => (r.writes.find((w) => w.key === key) || {}).value;
const SPACE = { id: 's1', name: 'Launch' };
const PEOPLE = [{ key: 'u-ana', name: 'Ana' }, { key: 'u-bo', name: 'Bo' }];
const world = (rows = {}, settings = { datesRequired: true }, phases = []) => ({ space: SPACE, rows, people: PEOPLE, settings, phases });
const ref = (id) => ({ module: 'schedule', kind: 'plan', id, scope: 'space', space: 's1' });
const MS = { kind: 'milestone', title: 'Ship', start: '2026-12-01', done: false, order: 'm', by: 'u-ana' };
const WK = { kind: 'work', title: 'Write docs', start: '2026-11-01', end: '2026-11-10', owners: ['u-bo'], done: false, notes: 'Keep it short', parent: 'ms', order: 'm', by: 'u-ana' };
const NT = { kind: 'note', title: 'Idea', notes: 'x', order: 'mz', by: 'u-ana' };
const rows = () => ({ 'plan:ms': MS, 'plan:wk': WK, 'plan:nt': NT });

await test('the adds: the editor\'s rules, the asker\'s key, the order at the end', async () => {
  const m = await same('addMilestone', { title: 'Beta', date: '2026-11-20', notes: 'a\nb' }, world(rows()));
  assert.deepEqual(written(m, 'plan:n1'), { kind: 'milestone', title: 'Beta', start: '2026-11-20', done: false, notes: 'a\nb', order: 'n', by: 'agent1' });
  assert.deepEqual(m.ref, ref('n1'));
  const w = await same('addWork', { title: 'Test', start: '2026-11-02', owners: 'Ana, u-bo' }, world(rows()));
  assert.deepEqual(written(w, 'plan:n1'), { kind: 'work', title: 'Test', start: '2026-11-02', end: '2026-11-02', owners: ['u-ana', 'u-bo'], done: false, order: 'n', by: 'agent1' });
  const note = await same('addNote', { title: 'Thought' }, world());
  assert.deepEqual(written(note, 'plan:n1'), { kind: 'note', title: 'Thought', order: 'V', by: 'agent1' });
  await refuses('addMilestone', { title: 'Beta' }, world(), 'The milestone needs a day.');
  await refuses('addWork', { title: 'Test' }, world(), 'The piece of work needs a start and an end.');
  await refuses('addMilestone', { title: ' ' }, world(), 'The milestone needs a title.');
  await refuses('addMilestone', { title: 'Beta', date: '2301-01-01' }, world(), 'A day must be from 1900 to 2200, written like 2026-10-14.');
  await refuses('addWork', { title: 'Test', start: '2026-11-02', owners: 'Zed' }, world(), 'That person is not in this space. Use list_members to see who is.');
  const undated = await same('addMilestone', { title: 'Someday' }, world({}, { datesRequired: false }));
  assert.equal(written(undated, 'plan:n1').start, undefined, 'dates off: an undated milestone');
});

await test('an object\'s parent and phase by name, its done ticked', async () => {
  const object = { kind: 'work', title: 'Polish', details: { start: '2026-11-03', end: '2026-11-04', under: 'Ship', phase: 'Build it', done: true } };
  const r = await same('addWork', { title: 'Polish', object }, world(rows(), { datesRequired: true }, [{ id: 'build', label: 'Build it' }]));
  const v = written(r, 'plan:n1');
  assert.deepEqual([v.parent, v.phase, v.done, v.start, v.end, v.order], ['ms', 'build', true, '2026-11-03', '2026-11-04', 'n']);
});

await test('setDone ticks a milestone and marks work done; a note has nothing to tick', async () => {
  const m = await same('setDone', { ref: ref('ms'), done: true }, world(rows()));
  assert.deepEqual(written(m, 'plan:ms'), { ...MS, ticked: true, done: true, progress: 0 }, 'its progress follows what is under it, in the same write');
  const w = await same('setDone', { ref: ref('wk'), done: true }, world(rows()));
  assert.match(written(w, 'plan:wk').doneOn, /^\d{4}-\d{2}-\d{2}$/, 'and carries the day it became done');
  assert.deepEqual(written(w, 'plan:wk'), { ...WK, done: true, column: 'done', doneOn: written(w, 'plan:wk').doneOn }, 'ticked work moves to the done column');
  await refuses('setDone', { ref: ref('nt'), done: true }, world(rows()), 'A note has nothing to tick off.');
  await refuses('setDone', { ref: ref('zz'), done: true }, world(rows()), 'That is not on the plan.');
  await refuses('setDone', { ref: ref('ms'), done: 'yes' }, world(rows()), 'Say whether it is done: true or false.');
});

await test('updateEntry changes only the fields given; "" clears a day, the owners and the notes', async () => {
  const t = await same('updateEntry', { ref: ref('wk'), title: 'Write the docs' }, world(rows()));
  assert.deepEqual(written(t, 'plan:wk'), { ...WK, title: 'Write the docs' });
  const cleared = await same('updateEntry', { ref: ref('wk'), owners: '', notes: '' }, world(rows()));
  const { owners, notes, ...rest } = WK;
  assert.deepEqual(written(cleared, 'plan:wk'), rest);
  const day = await same('updateEntry', { ref: ref('ms'), date: '' }, world(rows(), { datesRequired: false }));
  assert.equal(written(day, 'plan:ms').start, undefined);
  await refuses('updateEntry', { ref: ref('ms'), date: '' }, world(rows()), 'This plan needs dates: give the milestone a day.');
  await refuses('updateEntry', { ref: ref('wk'), end: '2026-10-01' }, world(rows()), 'The end is before the start.');
  await refuses('updateEntry', { ref: ref('ms'), start: '2026-11-01' }, world(rows()), 'The milestone has a day, not a start and an end.');
  await refuses('updateEntry', { ref: ref('ms'), owners: 'Ana' }, world(rows()), 'Only piece of work says who is doing it.');
  await refuses('updateEntry', { ref: ref('nt'), date: '2026-11-01' }, world(rows()), 'A note has no day.');
  await refuses('updateEntry', { ref: ref('wk') }, world(rows()), 'Say what to change: a title, a day, notes.');
  await refuses('updateEntry', { ref: { ...ref('wk'), space: 's2' }, title: 'x' }, world(rows()), 'That is not on the plan.');
});


await test('the milestones\' done and progress are written in the same answer, as the page\'s save settles them', async () => {
  const w = await same('setDone', { ref: ref('wk'), done: true }, world(rows()));
  assert.deepEqual(w.writes.map((x) => x.key).sort(), ['plan:ms', 'plan:wk']);
  assert.deepEqual(written(w, 'plan:ms'), { ...MS, done: true, progress: 100 }, 'everything under it is done');
  const back = await same('setDone', { ref: ref('wk'), done: false }, world({ ...rows(), 'plan:wk': { ...WK, done: true }, 'plan:ms': { ...MS, done: true, progress: 100 } }));
  assert.deepEqual(written(back, 'plan:ms'), { ...MS, done: false, progress: 0 });
  const more = await same('addWork', { title: 'Review', start: '2026-11-11', object: { kind: 'work', title: 'Review', details: { start: '2026-11-11', end: '2026-11-12', under: 'Ship' } } }, world({ ...rows(), 'plan:wk': { ...WK, done: true }, 'plan:ms': { ...MS, done: true, progress: 100 } }));
  assert.deepEqual(written(more, 'plan:ms'), { ...MS, done: false, progress: 50 }, 'new work under a done milestone');
  const title = await same('updateEntry', { ref: ref('wk'), title: 'Docs' }, world({ ...rows(), 'plan:ms': { ...MS, progress: 0 } }));
  assert.deepEqual(title.writes.map((x) => x.key), ['plan:wk'], 'nothing else to settle');
});

await test('an entry made from another object answers its link, as a diff', async () => {
  const from = { module: 'todo', kind: 'task', id: 't1', scope: 'space', space: 's1' };
  const r = await same('addMilestone', { title: 'Beta', date: '2026-11-20', ref: from }, world(rows()));
  assert.deepEqual(written(r, 'plan:n1').ref, from, 'kept on the entry, as the editor keeps it');
  assert.deepEqual(r.effects.links, [{ op: 'add', from: ref('n1'), to: from }]);
  const kept = await same('updateEntry', { ref: ref('lk'), title: 'Beta 2' }, world({ ...rows(), 'plan:lk': { ...MS, ref: from } }));
  assert.deepEqual(kept.effects.links, [], 'a change that keeps what it was made from changes no link');
  const none = await same('addNote', { title: 'Thought' }, world());
  assert.deepEqual(none.effects.links, []);
});

await test('the template\'s words reach the sentences (ctx.util.label), on a page that renames them', async () => {
  const WORDS = { plan: 'project', milestone: 'checkpoint', work: 'job' };
  const handlers = Object.fromEntries(Object.entries(handlersOf('schedule')).map(([k, fn]) => [k, (input, ctx) => fn(input, { ...ctx, util: Object.freeze({ ...ctx.util, label: (w) => WORDS[w] || w }) })]));
  const r = await onPage('schedule', 'addMilestone', { title: 'Beta' }, world(), { handlers, name: 'Planner - Projects' });
  assert.equal(r.refused, 'The checkpoint needs a day.');
  const p = await onPage('schedule', 'setDone', { ref: ref('zz'), done: true }, world(rows()), { handlers, name: 'Planner - Projects' });
  assert.equal(p.refused, 'That is not on the project.');
});

const rowsOn = (extra = {}, ws = {}) => ({ 'plan:ms': MS, 'plan:wk': { ...WK, ...ws }, 'plan:nt': NT, ...extra });

await test('setColumn moves work, done follows the column, the same on the page and the server', async () => {
  const stages = world(rowsOn());
  const doing = await same('setColumn', { ref: ref('wk'), column: 'doing' }, stages);
  assert.deepEqual(written(doing, 'plan:wk'), { ...WK, column: 'doing', done: false, rank: 'V' });
  assert.deepEqual(written(doing, 'plan:ms'), { ...MS, progress: 0 }, 'the milestone\'s progress is settled in the same answer');
  const fin = await same('setColumn', { ref: ref('wk'), column: 'done' }, stages);
  assert.deepEqual(written(fin, 'plan:wk'), { ...WK, column: 'done', done: true, rank: 'V', doneOn: written(fin, 'plan:wk').doneOn });
  assert.deepEqual(written(fin, 'plan:ms'), { ...MS, done: true, progress: 100 }, 'the milestone follows in the same answer');
  const back = await same('setColumn', { ref: ref('wk'), column: 'todo' }, world(rowsOn({ 'plan:ms': { ...MS, done: true, progress: 100 } }, { done: true, column: 'done' })));
  assert.deepEqual(written(back, 'plan:wk'), { ...WK, column: 'todo', done: false, rank: 'V' });
  assert.deepEqual(written(back, 'plan:ms'), { ...MS, done: false, progress: 0 });
  await refuses('setColumn', { ref: ref('wk'), column: 'nowhere' }, stages, 'There is no column called nowhere.');
  await refuses('setColumn', { ref: ref('ms'), column: 'done' }, stages, 'Only work moves on the board.');
  await refuses('setColumn', { ref: ref('nt'), column: 'done' }, stages, 'Only work moves on the board.');
  await refuses('setColumn', { ref: ref('zz'), column: 'done' }, stages, 'That is not on the plan.');
});

await test('the board is the template\'s default until one is stored, then the stored one wins', async () => {
  const gaming = world(rowsOn(), { datesRequired: true, boardColumns: 'priority' });
  const now = await same('setColumn', { ref: ref('wk'), column: 'now' }, gaming);
  assert.equal(written(now, 'plan:wk').column, 'now');
  await refuses('setColumn', { ref: ref('wk'), column: 'doing' }, gaming, 'There is no column called doing.');
  const own = { id: 'main', name: 'Mine', field: 'column', columns: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', done: true }] };
  const stored = world(rowsOn({ 'board:main': own }), { datesRequired: true, boardColumns: 'priority' });
  assert.equal(written(await same('setColumn', { ref: ref('wk'), column: 'b' }, stored), 'plan:wk').done, true);
  await refuses('setColumn', { ref: ref('wk'), column: 'now' }, stored, 'There is no column called now.');
  const broken = world(rowsOn({ 'board:main': { columns: [] } }), { datesRequired: true });
  assert.equal(written(await same('setColumn', { ref: ref('wk'), column: 'doing' }, broken), 'plan:wk').column, 'doing', 'a stored board that does not read gives way to the default');
});

await test('setDone follows the tick rule: ticked into the first done column, unticked into the first without the flag', async () => {
  const gaming = { datesRequired: true, boardColumns: 'priority' };
  const up = await same('setDone', { ref: ref('wk'), done: true }, world(rowsOn({}, { column: 'now' }), gaming));
  assert.deepEqual([written(up, 'plan:wk').column, written(up, 'plan:wk').done], ['done', true]);
  const down = await same('setDone', { ref: ref('wk'), done: false }, world(rowsOn({}, { column: 'done', done: true }), gaming));
  assert.deepEqual([written(down, 'plan:wk').column, written(down, 'plan:wk').done], ['inbox', false]);
  const noColumn = await same('setDone', { ref: ref('wk'), done: false }, world(rowsOn({}, { done: true }), gaming));
  assert.equal(written(noColumn, 'plan:wk').column, 'inbox', 'work with no column that was done');
  const m = await same('setDone', { ref: ref('ms'), done: true }, world(rowsOn(), gaming));
  assert.equal('column' in written(m, 'plan:ms'), false, 'a milestone\'s tick is unchanged');
});

await test('an agent\'s move is one whole write, so its Undo puts column and done back together', async () => {
  const before = rowsOn({}, { column: 'doing' });
  const r = await same('setColumn', { ref: ref('wk'), column: 'done' }, world(before));
  const w = r.writes.find((x) => x.key === 'plan:wk');
  assert.deepEqual(Object.keys(w.value).filter((k) => ['column', 'done'].includes(k)).sort(), ['column', 'done'], 'both fields in the one value');
  // The server holds the whole stored value before an edit (server/delete-path.js) and Undo writes it back whole.
  const held = JSON.parse(JSON.stringify(before['plan:wk']));
  const restored = { ...held };
  assert.deepEqual([restored.column, restored.done], ['doing', false]);
  assert.notDeepEqual([w.value.column, w.value.done], [restored.column, restored.done]);
});

// Pulled work (plan-github-full-sync.md, section 8): updateEntry's description and parent, and addComment.
const GH = { kind: 'work', title: 'Bug', start: '2026-11-01', end: '2026-11-02', description: 'Old text', done: false, order: 'p', by: 'system:issues', source: { from: 'github', repo: 'o/r', number: 7, updated: '2026-11-01T00:00:00Z' } };
const GHM = { kind: 'milestone', title: 'v1', start: '2026-12-01', done: false, order: 'q', by: 'system:issues', source: { from: 'github', repo: 'o/r', milestone: 1 } };
const ghRows = () => ({ ...rows(), 'plan:gh-7': GH, 'plan:ghm-1': GHM });
await test('updateEntry takes an issue\'s description and the milestone it is part of, both ways', async () => {
  const d = await same('updateEntry', { ref: ref('gh-7'), description: 'New text' }, world(ghRows()));
  assert.deepEqual(written(d, 'plan:gh-7'), { ...GH, description: 'New text' });
  const p = await same('updateEntry', { ref: ref('gh-7'), parent: 'ghm-1' }, world(ghRows()));
  assert.equal(written(p, 'plan:gh-7').parent, 'ghm-1');
  assert.equal(written(p, 'plan:gh-7').order, 'p', 'pulled work keeps its order');
  const own = await same('updateEntry', { ref: ref('wk'), parent: '' }, world(ghRows()));
  assert.equal('parent' in written(own, 'plan:wk'), false, 'empty: at the top');
  assert.notEqual(written(own, 'plan:wk').order, 'm', 'an entry of the plan\'s own goes to the end of its new place');
  await refuses('updateEntry', { ref: ref('gh-7'), parent: 'wk' }, world(ghRows()), 'That is not a milestone it can be part of.');
  await refuses('updateEntry', { ref: ref('wk'), description: 'x' }, world(ghRows()), 'Only an issue has a description. Change the notes instead.');
});
await test('addComment: checked by the handler, posted by the server only, nothing written', async () => {
  const w = world(ghRows());
  const r = await onRunner('schedule', 'addComment', { ref: ref('gh-7'), text: 'Seen it.' }, w, { kinds: ['plan'], carrier: 'server' });
  assert.deepEqual([r.fault, r.refused, r.writes, r.ref], [undefined, undefined, [], ref('gh-7')]);
  const page = await onPage('schedule', 'addComment', { ref: ref('gh-7'), text: 'Seen it.' }, w, { name: 'Planner - Projects' });
  assert.equal(page.refused, 'Add a comment in the issue view.');
  for (const [input, words] of [[{ ref: ref('wk'), text: 'x' }, 'Only an issue takes a comment.'], [{ ref: ref('gh-7'), text: '  ' }, 'Write a comment first.'], [{ ref: ref('gh-7'), text: 'c'.repeat(65537) }, 'GitHub holds at most 65,536 characters.'], [{ ref: ref('nope'), text: 'x' }, 'That is not on the plan.']]) {
    const x = await onRunner('schedule', 'addComment', input, w, { kinds: ['plan'], carrier: 'server' });
    assert.equal(x.refused, words);
  }
});

await test('setColumn is a library handler the manifest names', async () => {
  const fs = await import('node:fs');
  const manifest = JSON.parse(fs.readFileSync(new URL('../module.json', import.meta.url), 'utf8'));
  const a = manifest.actions.provides.find((x) => x.name === 'setColumn');
  assert.deepEqual([a.effect, a.label, a.input], ['write', 'Move it on the plan\'s board', { ref: 'ref:schedule:plan', column: 'string', before: 'string?' }]);
  assert.ok(Object.keys(handlersOf('schedule')).includes('setColumn'));
});

await test('carried by the server: the manifest says so, and nothing is left for a page', async () => {
  const fs = await import('node:fs');
  const lib = fs.readFileSync(new URL('../src/schedule-lib-actions.js', import.meta.url), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(new URL('../module.json', import.meta.url), 'utf8'));
  assert.equal(manifest.actions.server, 'src/schedule-lib-actions.js');
  // The one use of the carrier: addComment is posted by the server alone (it reaches GitHub), so a page refuses it at once.
  assert.deepEqual(lib.match(/ctx\.carrier[^;]*;/g), ["ctx.carrier !== 'server') throw new Error('Add a comment in the issue view.');"], 'the carrier is read once, by addComment');
  assert.ok(!/page open|ctx\.(label|order|phases)\b/.test(lib), 'no page-only facts and no wait for a page');
  const page = fs.readFileSync(new URL('../src/schedule.js', import.meta.url), 'utf8');
  const after = page.slice(page.indexOf('async function afterAction'), page.indexOf('async function afterAction') + 400);
  assert.ok(!/setLinks|settleMilestones/.test(after), 'the page does no link or settling of its own after a request');
});

if (process.exitCode) { console.error(`check-schedule-lib-actions: failed (${n} passed)`); process.exit(1); }
console.log(`check-schedule-lib-actions: OK (${n} checks)`);
