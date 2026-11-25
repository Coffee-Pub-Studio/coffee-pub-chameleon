#!/usr/bin/env node
/*
 * check-polls-actions.mjs -- Polls' actions library (src/polls-lib-actions.js, ACTION_HANDLERS), run the two ways it is carried
 * out (plan-agent-edit-delete.md, decision 4, step 2): through the server's runner (its worker process and vm, then its
 * outcomeOf check) and through the SDK's page adapter (host.actions.fromLibrary) on a stand-in host, both from
 * tools/module-actions-harness.mjs, expecting the same answer. Then createPoll as before (the form's limits, the settings a new
 * poll starts from, a closing time on the request's clock) and updatePoll: only the fields given, the form's sentences, the
 * options only added to once anyone has voted, End poll and Reopen poll, "" taking the closing time off. Polls declares
 * actions.server and the runner is run with carrier 'server': the same answer, ending a poll too. Beside the writes, the same
 * closing schedule (`close:<id>`, set, set again or cancelled) and the notice of a poll ended now, both ways
 * (plan-agent-server-actions.md, section 7), so no poll waits for a page to be told closed. Exits 1 on failure.
 */
process.env.TZ = 'America/Chicago';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { onPage, onRunner, handlersOf, library } from '../../../tools/module-actions-harness.mjs';

let n = 0;
const test = async (name, fn) => { try { await fn(); n += 1; } catch (e) { process.exitCode = 1; console.error(`FAIL ${name}\n${e.stack || e}`); } };
// createdAt is the moment each way carried it out: the same field, a moment apart.
const timeless = (writes) => (writes || []).map((w) => ({ key: w.key, value: w.value && typeof w.value === 'object' ? { ...w.value, createdAt: typeof w.value.createdAt } : w.value }));
async function same(action, input, world) {
  // The runner as the server's own: carrier 'server', so a handler that leaves work for a page must say so (none may).
  const r = { page: await onPage('polls', action, input, world, { name: 'Polls', kinds: ['poll'] }), runner: await onRunner('polls', action, input, world, { ...{ name: 'Polls', kinds: ['poll'] }, carrier: 'server' }) };
  assert.ok(!r.runner.fault, `${action}: the runner faulted (${r.runner.fault})`);
  if (r.page.refused !== undefined || r.runner.refused !== undefined) {
    assert.equal(r.runner.refused, r.page.refused, `${action}: the same refusal`);
    return r.page;
  }
  assert.deepEqual(timeless(r.runner.writes), timeless(r.page.writes), `${action}: the same writes`);
  assert.deepEqual(r.runner.ref, r.page.ref, `${action}: the same pointer`);
  assert.deepEqual(r.runner.data, r.page.data, `${action}: the same note`);
  assert.deepEqual(r.runner.effects, r.page.effects, `${action}: the same schedules and notice`);
  return r.page;
}
const refuses = async (action, input, world, words) => assert.equal((await same(action, input, world)).refused, words);
const written = (r, key) => (r.writes.find((w) => w.key === key) || {}).value;
const SPACE = { id: 's1', name: 'Lisbon 2027' };
const world = (rows = {}) => ({ space: SPACE, rows });
const ref = (id) => ({ module: 'polls', kind: 'poll', id, scope: 'space', space: 's1' });
const DAY = 24 * 60 * 60 * 1000;
const future = new Date(Date.now() + 10 * DAY);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const LATER = ymd(future);
const noon = (s) => new Date(`${s}T12:00`).getTime(); // in this process's zone, America/Chicago
const POLL = {
  id: 'p1', question: 'Where to eat?', options: [{ id: 'o1', text: 'Pizza', desc: 'Near the hotel' }, { id: 'o2', text: 'Sushi', date: '2026-12-01' }],
  multi: false, addable: false, closed: false, closesAt: null, createdAt: 1, by: 'Ann', byKey: 'u-ann',
};
const VOTE = { options: ['o1'], name: 'Bo' };

await test('createPoll: the same both ways, credited to the asker, the form\'s options', async () => {
  const r = await same('createPoll', { question: 'Where to eat?', options: 'Pizza, Sushi, Tacos', multiple: true }, world());
  const v = written(r, 'poll:n1');
  assert.equal(typeof v.createdAt, 'number');
  assert.deepEqual({ ...v, createdAt: 0 }, { id: 'n1', question: 'Where to eat?', options: [{ id: 'o1', text: 'Pizza' }, { id: 'o2', text: 'Sushi' }, { id: 'o3', text: 'Tacos' }], multi: true, addable: false, closed: false, closesAt: null, createdAt: 0, by: 'Claude (agent)', byKey: 'agent1' });
  assert.deepEqual(r.ref, ref('n1'));
});
await test('createPoll: a closing day is noon on the request\'s clock (the server reads in its own zone)', async () => {
  const r = await same('createPoll', { question: 'Q', options: 'A, B', closes: LATER }, world());
  assert.equal(written(r, 'poll:n1').closesAt, noon(LATER));
  const t = await same('createPoll', { question: 'Q', options: 'A, B', closes: `${LATER}T18:30` }, world());
  assert.equal(written(t, 'poll:n1').closesAt, new Date(`${LATER}T18:30`).getTime());
  const tokyo = await onRunner('polls', 'createPoll', { question: 'Q', options: 'A, B', closes: '2030-03-10T09:00' }, world(), { tz: 'Asia/Tokyo', kinds: ['poll'] });
  assert.equal(tokyo.writes[0].value.closesAt, Date.parse('2030-03-10T00:00:00Z'));
});
await test('createPoll: the settings a new poll starts from (ctx.settings, which the page hands it)', async () => {
  const withSettings = (s) => Object.fromEntries(Object.entries(handlersOf('polls')).map(([k, f]) => [k, (input, ctx) => f(input, { ...ctx, settings: s })]));
  const r = await onPage('polls', 'createPoll', { question: 'Q', options: 'A, B' }, world(), { handlers: withSettings({ addableByDefault: true, closeAfterDays: 3 }) });
  const v = written(r, 'poll:n1');
  assert.equal(v.addable, true);
  assert.equal(v.closesAt, noon(ymd(new Date(Date.now() + 3 * DAY))), 'closes at noon, three days on');
  const asked = await onPage('polls', 'createPoll', { question: 'Q', options: 'A, B', closes: LATER }, world(), { handlers: withSettings({ closeAfterDays: 3 }) });
  assert.equal(written(asked, 'poll:n1').closesAt, noon(LATER), 'a closing time asked for wins');
  const none = await same('createPoll', { question: 'Q', options: 'A, B' }, world());
  assert.deepEqual([written(none, 'poll:n1').addable, written(none, 'poll:n1').closesAt], [false, null], 'no settings: both off');
});
await test('createPoll: the form\'s refusals, the same both ways', async () => {
  await refuses('createPoll', { question: ' ', options: 'A, B' }, world(), 'A poll needs a question.');
  await refuses('createPoll', { question: 'Q', options: 'A' }, world(), 'Give at least two options.');
  await refuses('createPoll', { question: 'Q', options: 'A, a' }, world(), 'Two options are the same.');
  await refuses('createPoll', { question: 'Q', options: 'A, B', closes: '2020-01-01' }, world(), 'The closing time has to be in the future.');
  await refuses('createPoll', { question: 'Q', options: 'A, B', closes: 'soon' }, world(), 'Closes needs a day, such as 2026-11-30, or a day and time, such as 2026-11-30T18:00.');
});

await test('updatePoll changes only the fields given; the asker is not stamped over who started it', async () => {
  const rows = { 'poll:p1': POLL };
  const r = await same('updatePoll', { poll: ref('p1'), question: 'Where to eat on Friday?' }, world(rows));
  assert.deepEqual(written(r, 'poll:p1'), { ...POLL, question: 'Where to eat on Friday?' });
  assert.deepEqual(r.ref, ref('p1'));
  const closes = await same('updatePoll', { poll: ref('p1'), closes: LATER }, world(rows));
  assert.deepEqual(written(closes, 'poll:p1'), { ...POLL, closesAt: noon(LATER) });
  const multi = await same('updatePoll', { poll: ref('p1'), multiple: true }, world(rows));
  assert.deepEqual(written(multi, 'poll:p1'), { ...POLL, multi: true });
});
await test('updatePoll: before anyone votes, the options are the list given; an option kept by its words keeps its detail', async () => {
  const rows = { 'poll:p1': POLL };
  const r = await same('updatePoll', { poll: ref('p1'), options: 'sushi, Tacos, Pizza' }, world(rows));
  assert.deepEqual(written(r, 'poll:p1').options, [{ id: 'o2', text: 'sushi', date: '2026-12-01' }, { id: 'on1', text: 'Tacos' }, { id: 'o1', text: 'Pizza', desc: 'Near the hotel' }]);
  await refuses('updatePoll', { poll: ref('p1'), options: 'Pizza' }, world(rows), 'Give at least two options.');
  await refuses('updatePoll', { poll: ref('p1'), options: 'Pizza, PIZZA' }, world(rows), 'Two options are the same.');
});
await test('updatePoll: once anyone has voted, options are only added to and the answers allowed stay', async () => {
  const rows = { 'poll:p1': POLL, 'vote:p1:u-bo': VOTE };
  const r = await same('updatePoll', { poll: ref('p1'), options: 'Pizza, Sushi, Tacos' }, world(rows));
  assert.deepEqual(written(r, 'poll:p1').options, [...POLL.options, { id: 'on1', text: 'Tacos' }]);
  const words = 'That poll already has votes, so its options can only be added to: give the ones it has, in order, then the new ones.';
  await refuses('updatePoll', { poll: ref('p1'), options: 'Sushi, Pizza, Tacos' }, world(rows), words);
  await refuses('updatePoll', { poll: ref('p1'), options: 'Pizza, Tacos' }, world(rows), words);
  await refuses('updatePoll', { poll: ref('p1'), multiple: true }, world(rows), 'That poll already has votes, so whether more than one answer is allowed can\'t change.');
  const q = await same('updatePoll', { poll: ref('p1'), question: 'Lunch?' }, world(rows));
  assert.equal(written(q, 'poll:p1').question, 'Lunch?', 'the question may still change');
  const kept = await same('updatePoll', { poll: ref('p1'), options: 'Pizza, Sushi', multiple: false }, world(rows));
  assert.deepEqual([kept.writes, kept.data], [[], { note: 'That is already so; nothing changed.' }], 'the same list and answers: nothing written');
});
await test('updatePoll: End poll and Reopen poll; "" takes the closing time off (the manifest\'s clears)', async () => {
  const timed = { ...POLL, closesAt: noon(LATER) };
  const ended = await same('updatePoll', { poll: ref('p1'), closed: true }, world({ 'poll:p1': timed }));
  assert.deepEqual(written(ended, 'poll:p1'), { ...timed, closed: true }, 'as End poll: closed, its time kept (other modules are told by a page: announced)');
  const closed = { ...timed, closed: true, announced: true };
  const reopened = await same('updatePoll', { poll: ref('p1'), closed: false }, world({ 'poll:p1': closed }));
  assert.deepEqual(written(reopened, 'poll:p1'), { ...timed, closed: false, closesAt: null, announced: false }, 'as Reopen poll: open, no closing time');
  const until = await same('updatePoll', { poll: ref('p1'), closed: false, closes: `${LATER}T09:00` }, world({ 'poll:p1': closed }));
  assert.equal(written(until, 'poll:p1').closesAt, new Date(`${LATER}T09:00`).getTime(), 'open again until a new time');
  const pastDue = { ...POLL, closesAt: Date.now() - DAY, announced: true };
  const later = await same('updatePoll', { poll: ref('p1'), closes: LATER }, world({ 'poll:p1': pastDue }));
  assert.deepEqual([written(later, 'poll:p1').closesAt, written(later, 'poll:p1').announced], [noon(LATER), false], 'closed by its time, open again by a later one');
  const off = await same('updatePoll', { poll: ref('p1'), closes: '' }, world({ 'poll:p1': timed }));
  assert.deepEqual(written(off, 'poll:p1'), { ...POLL, closesAt: null });
  const again = await same('updatePoll', { poll: ref('p1'), closed: true }, world({ 'poll:p1': closed }));
  assert.deepEqual(again.writes, [], 'closed already: nothing written');
  await refuses('updatePoll', { poll: ref('p1'), options: 'Pizza, Sushi, Tacos' }, world({ 'poll:p1': closed }), 'That poll is closed, so its options can\'t change. Open it again first (closed false).');
  const both2 = await same('updatePoll', { poll: ref('p1'), closed: false, options: 'Pizza, Sushi, Tacos' }, world({ 'poll:p1': closed }));
  assert.equal(written(both2, 'poll:p1').options.length, 3, 'opened again in the same request: its options may change');
  await refuses('updatePoll', { poll: ref('p1'), closes: '2020-01-01' }, world({ 'poll:p1': POLL }), 'The closing time has to be in the future.');
});
await test('updatePoll: the refusals', async () => {
  const w = world({ 'poll:p1': POLL });
  await refuses('updatePoll', { poll: ref('zz'), question: 'x' }, w, "That poll isn't here.");
  await refuses('updatePoll', { poll: { ...ref('p1'), space: 's2' }, question: 'x' }, w, "That poll isn't here.");
  await refuses('updatePoll', { poll: { ...ref('p1'), module: 'todo' }, question: 'x' }, w, "That poll isn't here.");
  await refuses('updatePoll', { poll: ref('p1') }, w, 'Say what to change: the question, the options, whether more than one answer is allowed, when it closes, or whether it is closed. Send "" to take the closing time off.');
  await refuses('updatePoll', { poll: ref('p1'), question: 'x'.repeat(201) }, w, 'A question can be 200 letters at most.');
});

await test('on the server: the settings reach createPoll, and ending a poll is done there too', async () => {
  const settings = { addableByDefault: true, closeAfterDays: 3 };
  const w = { ...world(), settings };
  const r = await onRunner('polls', 'createPoll', { question: 'Q', options: 'A, B' }, w, { carrier: 'server', kinds: ['poll'] });
  const v = written(r, 'poll:n1');
  assert.equal(v.addable, true);
  assert.ok(v.closesAt > Date.now() + 2 * DAY, 'it closes after the days the settings say');
  assert.deepEqual(r.effects.schedules.map((s) => [s.op, s.key, s.at]), [['set', 'close:n1', v.closesAt]], 'the settings\' closing is scheduled too');
  const open = world({ 'poll:p1': POLL, 'vote:p1:u-bo': VOTE });
  const end = await same('updatePoll', { poll: ref('p1'), closed: true }, open);
  assert.deepEqual(written(end, 'poll:p1'), { ...POLL, closed: true });
  assert.deepEqual(end.effects, { links: [], schedules: [], notify: [{ title: 'Poll closed', body: 'Where to eat?: Pizza', about: ref('p1') }] }, 'ended now: the notice, how it turned out');
  // Ending one that is closed already, or changing anything else, is the same on the server.
  const closed = { ...POLL, closed: true };
  await same('updatePoll', { poll: ref('p1'), closed: true }, world({ 'poll:p1': closed }));
  await same('updatePoll', { poll: ref('p1'), question: 'Where next?', closes: LATER }, open);
  await same('updatePoll', { poll: ref('p1'), closed: false }, world({ 'poll:p1': closed }));
});

await test('the closing schedule: set with a closing time, set again on a change, cancelled when it goes; no hook asked without one', async () => {
  const at = noon(LATER);
  const setOf = (id, question) => ({ op: 'set', key: `close:${id}`, at, about: ref(id), notify: { title: 'Poll closed', body: question }, payload: { poll: id } });
  const made = await same('createPoll', { question: 'Q', options: 'A, B', closes: LATER }, world());
  assert.deepEqual(made.effects, { links: [], schedules: [setOf('n1', 'Q')], notify: [] }, 'a new poll with a closing time');
  const plain = await same('createPoll', { question: 'Q', options: 'A, B' }, world());
  assert.deepEqual(plain.effects, { links: [], schedules: [], notify: [] }, 'no closing time: nothing beside the write');
  const timed = { ...POLL, closesAt: at };
  const renamed = await same('updatePoll', { poll: ref('p1'), question: 'Lunch?' }, world({ 'poll:p1': timed }));
  assert.deepEqual(renamed.effects.schedules, [setOf('p1', 'Lunch?')], 'set again, with the new question');
  const moved = await same('updatePoll', { poll: ref('p1'), closes: LATER }, world({ 'poll:p1': POLL }));
  assert.deepEqual(moved.effects.schedules, [setOf('p1', POLL.question)], 'a closing time given');
  const off = await same('updatePoll', { poll: ref('p1'), closes: '' }, world({ 'poll:p1': timed }));
  assert.deepEqual(off.effects.schedules, [{ op: 'cancel', key: 'close:p1' }], 'its closing time taken off');
  const ended = await same('updatePoll', { poll: ref('p1'), closed: true }, world({ 'poll:p1': timed }));
  assert.deepEqual([ended.effects.schedules, ended.effects.notify.length], [[{ op: 'cancel', key: 'close:p1' }], 1], 'ended before its time: cancelled, told now');
  const reopened = await same('updatePoll', { poll: ref('p1'), closed: false, closes: LATER }, world({ 'poll:p1': { ...timed, closed: true, announced: true } }));
  assert.deepEqual([reopened.effects.schedules, reopened.effects.notify], [[setOf('p1', POLL.question)], []], 'open again until a time: scheduled again');
  const untimed = await same('updatePoll', { poll: ref('p1'), question: 'Lunch?' }, world({ 'poll:p1': POLL }));
  assert.deepEqual(untimed.effects, { links: [], schedules: [], notify: [] }, 'no closing time before or after: nothing');
  // The page's adapter does them through the host: the schedule about the poll, with its notice.
  const calls = [];
  await onPage('polls', 'createPoll', { question: 'Q', options: 'A, B', closes: LATER }, world(), { name: 'Polls', kinds: ['poll'], calls });
  assert.deepEqual(calls, [{ call: 'schedule', key: 'close:n1', at, ref: ref('n1'), payload: { poll: 'n1' }, notify: { title: 'Poll closed', body: 'Q' } }]);
});

await test('the manifest: updatePoll, its clears and hints; actions.server is the library', async () => {
  const m = JSON.parse(fs.readFileSync(new URL('../module.json', import.meta.url), 'utf8'));
  const act = (name) => m.actions.provides.find((a) => a.name === name);
  const u = act('updatePoll');
  assert.deepEqual(u.input, { poll: 'ref:polls:poll', question: 'string?', options: 'text?', multiple: 'boolean?', closes: 'string?', closed: 'boolean?' });
  assert.deepEqual(u.clears, ['closes']);
  assert.equal(u.effect, 'write');
  assert.match(u.description, /^[^.]+\.$/, 'one sentence');
  for (const [k, v] of Object.entries(u.inputHints)) assert.ok(k in u.input && v.length <= 200, `hint ${k}`);
  assert.equal(m.actions.server, 'src/polls-lib-actions.js', 'carried out on the server too');
  const lib = library('polls').js;
  for (const name of m.actions.provides.filter((a) => !a.local).map((a) => a.name)) assert.match(lib, new RegExp(`\\n    ${name}\\(input, ctx\\) \\{`), `${name} is a handler in the library`);
  const page = fs.readFileSync(new URL('../src/polls.js', import.meta.url), 'utf8');
  assert.match(page, /settings: \{ addableByDefault: Boolean\(prefs\.addableByDefault\), closeAfterDays: Number\(prefs\.closeAfterDays\) \|\| 0 \}/, 'the page hands the settings');
  assert.match(page, /async function afterAction[\s\S]*!w\.before\.closed && w\.value\.closed\) tellOthers\(x\)/, 'a poll a request ended is told to other modules, as End poll tells them');
  assert.deepEqual(m.hooks, { schedule: true, notify: true }, 'the closing schedule and its notice');
  assert.doesNotMatch(page, /announceIfDue/, 'no page waits to announce a poll closed by its time');
  assert.match(page, /closeEffects\(x\.p, p\)/, 'End poll and Reopen poll schedule through the library');
  assert.match(page, /closeEffects\(null, p\)/, 'Start poll schedules through the library');
});

if (!process.exitCode) console.log(`check-polls-actions: OK (${n} tests)`);
