#!/usr/bin/env node
/*
 * check-research-actions.mjs -- Research's actions library (src/research-lib-actions.js, ACTION_HANDLERS), run the two ways it is
 * carried out (plan-agent-server-actions.md, step 7): through the server's runner (its worker process and vm, then its outcomeOf
 * check, with carrier 'server') and through the SDK's page adapter (host.actions.fromLibrary) on a stand-in host, both from
 * tools/module-actions-harness.mjs, expecting the same writes, pointer, note, links and refusals. saveNote and saveLink (credited to
 * the asker; one made about another object answers its link), updateNote and updateLink (only the fields given, "" clearing the
 * title, the text or the tags, the editor's sentences, a pointer that is not this space's refused). The place helpers are
 * ctx.util.geo both ways. Exits 1 on failure.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onPage, onRunner, library } from '../../../tools/module-actions-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules/research/module.json'), 'utf8'));

let n = 0;
const test = async (name, fn) => { try { await fn(); n += 1; } catch (e) { process.exitCode = 1; console.error(`FAIL ${name}\n${e.stack || e}`); } };
// A write's `at` is the time of the run, which differs between the two.
const timeless = (writes) => (writes || []).slice().sort((a, b) => (a.key < b.key ? -1 : 1)).map((w) => ({ key: w.key, value: { ...w.value, at: typeof w.value.at } }));
// Both ways, the runner as the server's own (carrier 'server'): the same answer, else the test fails. The page's answer is returned.
async function page(action, input, world) {
  const r = { page: await onPage('research', action, input, world, { name: 'Research' }), runner: await onRunner('research', action, input, world, { kinds: ['note', 'link', 'photo', 'answer'], carrier: 'server' }) };
  assert.ok(!r.runner.fault && !r.page.fault, `${action}: a fault (${r.runner.fault || r.page.fault})`);
  if (r.page.refused !== undefined || r.runner.refused !== undefined) {
    assert.equal(r.runner.refused, r.page.refused, `${action}: the same refusal`);
    return r.page;
  }
  assert.deepEqual(timeless(r.runner.writes), timeless(r.page.writes), `${action}: the same writes`);
  assert.deepEqual(r.runner.ref, r.page.ref, `${action}: the same pointer`);
  assert.deepEqual(r.runner.data, r.page.data, `${action}: the same note`);
  assert.deepEqual(r.runner.effects, r.page.effects, `${action}: the same links`);
  return r.page;
}
const refuses = async (action, input, world, words) => assert.equal((await page(action, input, world)).refused, words);
const written = (r, key) => (r.writes.find((w) => w.key === key) || {}).value;
const SPACE = { id: 's1', name: 'Lisbon 2027' };
const world = (rows = {}) => ({ space: SPACE, rows });
const ref = (kind, id) => ({ module: 'research', kind, id, scope: 'space', space: 's1' });
const NOTE = { kind: 'note', title: 'Pasteis', tags: ['food'], date: '', by: 'Ann', at: '2026-11-01T10:00:00.000Z', text: 'Belem, before 10', sub: '', body: 'Belem, before 10', icon: 'utensils' };
const LINK = { kind: 'link', title: 'Time Out', tags: ['food'], date: '', by: 'Ann', at: '2026-11-01T10:00:00.000Z', text: 'Nata', sub: 'timeout.com', url: 'https://timeout.com/lisbon', excerpt: 'Nata' };
const rows = () => ({ 'note:a': NOTE, 'link:b': LINK });

await test('the manifest: carried by the server, updateNote and updateLink as the plan has them, one sentence each', () => {
  const a = (name) => manifest.actions.provides.find((x) => x.name === name);
  assert.equal(manifest.actions.server, 'src/research-lib-actions.js');
  assert.deepEqual(a('updateNote').input, { note: 'ref:research:note', title: 'string?', body: 'text?', tags: 'string?', icon: 'string?', kind: 'string?' });
  assert.deepEqual(a('updateLink').input, { link: 'ref:research:link', title: 'string?', excerpt: 'text?', tags: 'string?' });
  assert.deepEqual(a('updateNote').clears, ['title', 'body', 'tags']);
  assert.deepEqual(a('updateLink').clears, ['title', 'excerpt', 'tags']);
  for (const x of manifest.actions.provides.filter((p) => !p.local && !p.askerOnly)) {
    assert.match(x.description, /^[^.!?]+\.$/, `${x.name}: one sentence`);
    for (const h of Object.values(x.inputHints || {})) assert.ok(h.length <= 200, `${x.name}: a hint of at most 200`);
  }
});

await test('saveNote and saveLink: as the store saved them, credited to the asker', async () => {
  const r = await page('saveNote', { title: 'From elsewhere', body: 'text', tags: '#Hotel, Lisbon', kind: 'flight' }, world());
  const v = written(r, 'note:n1');
  assert.deepEqual({ ...v, at: '' }, { kind: 'note', title: 'From elsewhere', tags: ['hotel', 'lisbon'], date: '', by: 'Claude (agent)', at: '', text: 'text', sub: '', body: 'text', icon: 'plane' });
  assert.deepEqual(r.ref, ref('note', 'n1'));
  const l = await page('saveLink', { url: 'https://example.org/a', excerpt: 'because' }, world());
  assert.deepEqual([written(l, 'link:n1').url, written(l, 'link:n1').title, written(l, 'link:n1').excerpt], ['https://example.org/a', 'example.org', 'because']);
  await refuses('saveNote', { title: ' ' }, world(), 'a note needs a title');
  await refuses('saveLink', { url: 'ftp://x' }, world(), 'that is not a web address');
});

await test('updateNote changes only the fields given', async () => {
  const t = await page('updateNote', { note: ref('note', 'a'), title: 'Pasteis de Belem' }, world(rows()));
  assert.deepEqual(written(t, 'note:a'), { ...NOTE, title: 'Pasteis de Belem' });
  const body = await page('updateNote', { note: ref('note', 'a'), body: 'Go early' }, world(rows()));
  assert.deepEqual(written(body, 'note:a'), { ...NOTE, body: 'Go early', text: 'Go early' });
  const tags = await page('updateNote', { note: ref('note', 'a'), tags: 'Sweet, Lisbon' }, world(rows()));
  assert.deepEqual(written(tags, 'note:a').tags, ['sweet', 'lisbon']);
  const type = await page('updateNote', { note: ref('note', 'a'), kind: 'museum' }, world(rows()));
  assert.equal(written(type, 'note:a').icon, 'landmark');
  const same = await page('updateNote', { note: ref('note', 'a'), title: 'Pasteis' }, world(rows()));
  assert.deepEqual([same.writes, same.data.note], [[], 'That is already so; nothing changed.']);
});

await test('updateNote: "" clears, and the editor\'s sentences', async () => {
  const cleared = await page('updateNote', { note: ref('note', 'a'), title: '', tags: '' }, world(rows()));
  assert.deepEqual([written(cleared, 'note:a').title, written(cleared, 'note:a').tags], ['Belem, before 10', []], 'named by its first line, as the editor does');
  const noBody = await page('updateNote', { note: ref('note', 'a'), body: '' }, world(rows()));
  assert.deepEqual([written(noBody, 'note:a').body, written(noBody, 'note:a').title], ['', 'Pasteis']);
  await refuses('updateNote', { note: ref('note', 'a'), title: '', body: '' }, world(rows()), 'Give it a title, or write something in it.');
  await refuses('updateNote', { note: ref('note', 'a') }, world(rows()), 'Say what to change: a title, the text, the tags or its type. Send "" to clear the title, the text or the tags.');
  await refuses('updateNote', { note: ref('note', 'a'), title: 'x'.repeat(121) }, world(rows()), 'The title is at most 120 characters.');
  await refuses('updateNote', { note: ref('note', 'zz'), title: 'x' }, world(rows()), "That note isn't in this research.");
  await refuses('updateNote', { note: { ...ref('note', 'a'), space: 's2' }, title: 'x' }, world(rows()), "That note isn't in this research.");
  await refuses('updateNote', { note: ref('link', 'b'), title: 'x' }, world(rows()), "That note isn't in this research.");
});

await test('updateLink changes the title, the excerpt and the tags, only those given', async () => {
  const t = await page('updateLink', { link: ref('link', 'b'), title: 'Time Out Lisbon' }, world(rows()));
  assert.deepEqual(written(t, 'link:b'), { ...LINK, title: 'Time Out Lisbon' });
  const ex = await page('updateLink', { link: ref('link', 'b'), excerpt: '' }, world(rows()));
  assert.deepEqual(written(ex, 'link:b'), { ...LINK, excerpt: '', text: '' });
  const untitled = await page('updateLink', { link: ref('link', 'b'), title: '' }, world(rows()));
  assert.equal(written(untitled, 'link:b').title, 'timeout.com', 'a link with no title is named by its site');
  await refuses('updateLink', { link: ref('link', 'b') }, world(rows()), 'Say what to change: a title, what to remember from it or the tags. Send "" to clear one.');
  await refuses('updateLink', { link: ref('link', 'b'), excerpt: 'x'.repeat(2001) }, world(rows()), 'The text is at most 2000 characters.');
  await refuses('updateLink', { link: ref('link', 'zz'), title: 'x' }, world(rows()), "That link isn't in this research.");
});

await test('a note or link made about another object answers its link; Research keeps no pointer', async () => {
  const about = { module: 'todo', kind: 'task', id: 't1', scope: 'space', space: 's1' };
  const r = await page('saveNote', { title: 'About the task', ref: about }, world());
  assert.deepEqual(r.effects.links, [{ op: 'add', from: ref('note', 'n1'), to: about }]);
  assert.equal(written(r, 'note:n1').ref, undefined, 'not stored on the note');
  const l = await page('saveLink', { url: 'https://example.org/a', ref: about }, world());
  assert.deepEqual(l.effects.links, [{ op: 'add', from: ref('link', 'n1'), to: about }]);
  const o = await page('saveNote', { title: 'x', object: { kind: 'note', title: 'From an object' }, ref: about }, world());
  assert.deepEqual(o.effects.links, [{ op: 'add', from: ref('note', 'n1'), to: about }]);
  const plain = await page('saveNote', { title: 'Alone' }, world());
  assert.deepEqual(plain.effects.links, []);
  const upd = await page('updateNote', { note: ref('note', 'a'), title: 'Pasteis 2' }, world(rows()));
  assert.deepEqual(upd.effects.links, [], 'a change makes no link');
});

await test('nothing is left for a page: the library reads no carrier, and the page links nothing after a request', () => {
  const lib = fs.readFileSync(path.join(ROOT, 'modules/research/src/research-lib-actions.js'), 'utf8');
  assert.ok(!/ctx\.carrier/.test(lib));
  const model = fs.readFileSync(path.join(ROOT, 'modules/research/src/research-lib.js'), 'utf8');
  const after = model.slice(model.indexOf('const after = async'), model.indexOf('host.actions.provide({'));
  assert.ok(after && !/setLinks/.test(after), 'the page\'s after hook only shows the writes');
  assert.ok(library('research').js.includes('ACTION_HANDLERS'));
});

if (process.exitCode) { console.error(`check-research-actions: failed (${n} passed)`); process.exit(1); }
console.log(`check-research-actions: OK (${n} checks)`);
