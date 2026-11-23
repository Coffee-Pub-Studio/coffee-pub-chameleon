#!/usr/bin/env node
/*
 * check-research-actions.mjs -- Research's actions library (src/research-lib-actions.js, ACTION_HANDLERS) through the SDK's page
 * adapter (host.actions.fromLibrary) on a stand-in host, from tools/module-actions-harness.mjs: saveNote and saveLink as before
 * (credited to the asker), and the new updateNote and updateLink (only the fields given, "" clearing the title, the text or the
 * tags, the editor's sentences, a pointer that is not this space's refused). Then the server's runner on the same library, which
 * cannot carry it yet: the library needs `geo` beside it (host.util.geo), which the runner's context does not give, so the
 * manifest declares no actions.server. Exits 1 on failure.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onPage, onRunner, library } from '../../../tools/module-actions-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'modules/research/module.json'), 'utf8'));
// The SDK's geo helpers, as the page hands the library `geo` (research.js: const geo = host.util.geo).
const win = { addEventListener() {}, removeEventListener() {}, location: { search: '', href: 'http://localhost/' } };
win.parent = win;
new Function('window', 'document', fs.readFileSync(path.join(ROOT, 'public/sdk/host.js'), 'utf8'))(win, { createElement: (tag) => ({ tag }), currentScript: null });
const geo = win.createHost({ call: async () => ({}), root: { appendChild() {} }, rootElement: {} }).host.util.geo;
const handlers = () => new Function('geo', `${library('research').js}\nreturn ACTION_HANDLERS;`)(geo);

let n = 0;
const test = async (name, fn) => { try { await fn(); n += 1; } catch (e) { process.exitCode = 1; console.error(`FAIL ${name}\n${e.stack || e}`); } };
const page = (action, input, world) => onPage('research', action, input, world, { handlers: handlers(), name: 'Research' });
const refuses = async (action, input, world, words) => assert.equal((await page(action, input, world)).refused, words);
const written = (r, key) => (r.writes.find((w) => w.key === key) || {}).value;
const SPACE = { id: 's1', name: 'Lisbon 2027' };
const world = (rows = {}) => ({ space: SPACE, rows });
const ref = (kind, id) => ({ module: 'research', kind, id, scope: 'space', space: 's1' });
const NOTE = { kind: 'note', title: 'Pasteis', tags: ['food'], date: '', by: 'Ann', at: '2026-11-01T10:00:00.000Z', text: 'Belem, before 10', sub: '', body: 'Belem, before 10', icon: 'utensils' };
const LINK = { kind: 'link', title: 'Time Out', tags: ['food'], date: '', by: 'Ann', at: '2026-11-01T10:00:00.000Z', text: 'Nata', sub: 'timeout.com', url: 'https://timeout.com/lisbon', excerpt: 'Nata' };
const rows = () => ({ 'note:a': NOTE, 'link:b': LINK });

await test('the manifest: updateNote and updateLink as the plan has them, one sentence each, no server yet', () => {
  const a = (name) => manifest.actions.provides.find((x) => x.name === name);
  assert.equal(manifest.actions.server, undefined, 'carried by a page: the runner has no geo');
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

await test('the server\'s runner cannot carry it yet: the library needs geo, which its context lacks', async () => {
  const r = await onRunner('research', 'saveNote', { title: 'X' }, world(), { kinds: ['note', 'link'] });
  assert.equal(r.refused, 'geo is not defined');
});

if (process.exitCode) { console.error(`check-research-actions: failed (${n} passed)`); process.exit(1); }
console.log(`check-research-actions: OK (${n} checks)`);
