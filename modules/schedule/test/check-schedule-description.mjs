#!/usr/bin/env node
/*
 * check-schedule-description.mjs -- the editable Description of a pulled issue (plan-github-full-sync.md, section 1; #1259), the module's
 * half. The block in src/schedule.js between "the issue's description (begin)" and "(end)" is run as written against a fake page and a
 * fake `host.issues` (the host's `open` and `describe` do not exist yet, so nothing here has met a real server):
 *   - with no `host.issues.open` the stored copy stays, read only; with it the whole text is read when the window opens;
 *   - someone with `write_out` in a space that writes back gets a box and **Save description**, anyone else the text read only;
 *   - GitHub not answering says so and keeps the stored copy; a window closed or reopened before the answer comes ignores it;
 *   - Save sends the text and the `base` it was read with, and only when the text changed; a refused save for any other reason says why;
 *   - a conflict (409) shows GitHub's version in the box and keeps the person's own text in a read-only box, and sends nothing more;
 *   - the main Save saves a changed description first and stops, with the reason, if GitHub refuses it;
 *   - the text is only ever set as text or as a box's value, never as markup.
 * Usage: node modules/schedule/test/check-schedule-description.mjs. Exits 1 on failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(path.join(dir, 'src', 'schedule.js'), 'utf8');
const lib = fs.readFileSync(path.join(dir, 'src', 'schedule-lib.js'), 'utf8');
const html = fs.readFileSync(path.join(dir, 'src', 'schedule.html'), 'utf8');

let n = 0;
const test = async (name, fn) => { try { await fn(); n += 1; } catch (e) { process.exitCode = 1; console.error(`FAIL ${name}\n${e.stack || e}`); } };

const block = page.slice(page.indexOf('// ---- the issue\'s description (begin) ----'), page.indexOf('// ---- the issue\'s comments (end) ----'));
assert.ok(block.length > 500, 'the block is there');
const { scConflictOf, scCommentView } = new Function(`${lib}\nreturn { scConflictOf, scCommentView };`)();

// A fake page: every element the block touches is a plain object; `host.issues` is whatever the test gives.
function world({ issues, through = true, name = 'GitHub' } = {}) {
  const els = {};
  const $ = (id) => (els[id] = els[id] || { id, hidden: false, value: '', textContent: '', disabled: false, children: [], listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, replaceChildren(...k) { this.children = k; }, append(...k) { this.children.push(...k); } });
  const remembered = []; let rendered = 0;
  const state = { editing: { id: 'gh-7' }, pull: { name } };
  const host = { issues };
  const hide = (el, yes) => { if (el) el.hidden = Boolean(yes); };
  const make = new Function('$', 'state', 'host', 'hide', 'through', 'remember', 'render', 'scConflictOf', 'scCommentView', 'nameOf', 'document', 'SC_PREFIX', `${block}\nreturn { descReset, descLoad, descSave, descDirty, descEditable, descCan, descShowText, tokenNow: () => descToken };`);
  const doc = { createElement: () => ({ append() {}, replaceChildren() {}, addEventListener() {}, setAttribute() {}, focus() {} }) };
  const api = make($, state, host, hide, () => through, (...a) => remembered.push(a), () => { rendered += 1; }, scConflictOf, scCommentView, (k) => k, doc, 'plan:');
  return { $, state, host, api, remembered, renders: () => rendered };
}
const issue = (o = {}) => ({ id: 'gh-7', source: { number: 7 }, description: 'stored copy…', ...o });

await test('with no host.issues.open the stored copy stays and nothing is read', async () => {
  const w = world({ issues: { create() {} } });
  assert.equal(w.api.descCan(), false);
  w.api.descReset();
  await w.api.descLoad(issue());
  assert.equal(w.state.desc, null);
  assert.equal(w.$('f-desc-edit').hidden, true);
});
await test('the whole text is read on open and edited by someone who may change GitHub', async () => {
  const asked = [];
  const w = world({ issues: { open: async (num) => { asked.push(num); return { description: 'the whole text', base: 'h1' }; }, describe: async () => ({}) } });
  w.api.descReset();
  await w.api.descLoad(issue());
  assert.deepEqual(asked, [7]);
  assert.deepEqual(w.state.desc, { id: 'gh-7', number: 7, base: 'h1', opened: 'the whole text' });
  assert.equal(w.$('f-desc-edit').value, 'the whole text');
  assert.equal(w.$('f-desc-edit').hidden, false);
  assert.equal(w.$('f-desc-actions').hidden, false);
  assert.equal(w.$('f-desc').hidden, true);
  assert.equal(w.$('f-desc-field').hidden, false);
});
await test('someone without write_out (or a plan that does not write back) reads the whole text, read only', async () => {
  const w = world({ through: false, issues: { open: async () => ({ description: 'the whole text', base: 'h1' }), describe: async () => ({}) } });
  w.api.descReset();
  await w.api.descLoad(issue());
  assert.equal(w.$('f-desc').textContent, 'the whole text');
  assert.equal(w.$('f-desc-edit').hidden, true);
  assert.equal(w.$('f-desc-actions').hidden, true);
  const none = world({ through: false, issues: { open: async () => ({ description: '', base: 'h' }) } });
  none.api.descReset();
  await none.api.descLoad(issue());
  assert.equal(none.$('f-desc-field').hidden, true, 'no text and nothing to write: nothing shown');
  const empty = world({ issues: { open: async () => ({ description: '', base: 'h' }), describe: async () => ({}) } });
  empty.api.descReset();
  await empty.api.descLoad(issue({ description: '' }));
  assert.equal(empty.$('f-desc-field').hidden, false, 'an issue with no text can be given one');
  assert.equal(empty.$('f-desc-edit').hidden, false);
});
await test('GitHub not answering keeps the stored copy and says so; a closed or reopened window ignores a late answer', async () => {
  const w = world({ name: 'GitHub', issues: { open: async () => { throw new Error('x'); } } });
  w.api.descReset();
  await w.api.descLoad(issue());
  assert.equal(w.$('f-desc-note').textContent, "GitHub did not answer, so this can't be changed now. Try again.");
  assert.equal(w.state.desc, null);
  let release;
  const late = world({ issues: { open: () => new Promise((r) => { release = r; }), describe: async () => ({}) } });
  late.api.descReset();
  const pending = late.api.descLoad(issue());
  late.api.descReset(); // the window was closed, or another issue opened
  release({ description: 'late', base: 'h' });
  await pending;
  assert.equal(late.state.desc, null);
  assert.equal(late.$('f-desc-edit').hidden, true);
  const other = world({ issues: { open: async () => ({ description: 'x', base: 'h' }), describe: async () => ({}) } });
  other.api.descReset();
  other.state.editing = { id: 'gh-9' };
  await other.api.descLoad(issue());
  assert.equal(other.state.desc, null, 'the window now holds another issue');
});
await test('Save sends the text and its base, only when the text changed, and the work it answers is kept', async () => {
  const sent = [];
  const w = world({ issues: { open: async () => ({ description: 'before', base: 'h1' }), describe: async (num, o) => { sent.push([num, o]); return { item: { key: 'plan:gh-7', value: { kind: 'work', title: 'T', description: 'after…' }, version: 3 }, description: 'after', base: 'h2' }; } } });
  w.api.descReset();
  await w.api.descLoad(issue());
  assert.deepEqual(await w.api.descSave(), { ok: true, error: '' });
  assert.equal(sent.length, 0, 'unchanged: nothing is sent');
  assert.equal(w.api.descDirty(), false);
  w.$('f-desc-edit').value = 'after';
  assert.equal(w.api.descDirty(), true);
  const r = await w.api.descSave();
  assert.deepEqual(r, { ok: true, error: '' });
  assert.deepEqual(sent, [[7, { text: 'after', base: 'h1' }]]);
  assert.deepEqual(w.remembered, [['gh-7', { kind: 'work', title: 'T', description: 'after…' }, 3]]);
  assert.equal(w.state.desc.base, 'h2', 'the new base for the next change');
  assert.equal(w.state.desc.opened, 'after');
  assert.equal(w.api.descDirty(), false);
  assert.equal(w.$('f-desc-note').textContent, 'The description is saved on GitHub.');
  assert.equal(w.$('f-desc-save').disabled, false);
  assert.ok(w.renders() >= 1);
});
await test('without a new base in the answer the issue is read again for it', async () => {
  let opens = 0;
  const w = world({ issues: { open: async () => { opens += 1; return { description: opens === 1 ? 'before' : 'after', base: `h${opens}` }; }, describe: async () => ({}) } });
  w.api.descReset();
  await w.api.descLoad(issue());
  w.$('f-desc-edit').value = 'after';
  await w.api.descSave();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(opens, 2);
  assert.equal(w.state.desc.base, 'h2');
});
await test('a refused save says why and keeps what was typed', async () => {
  const w = world({ issues: { open: async () => ({ description: 'before', base: 'h1' }), describe: async () => { throw Object.assign(new Error('GitHub refused the change: nope.'), { status: 502 }); } } });
  w.api.descReset();
  await w.api.descLoad(issue());
  w.$('f-desc-edit').value = 'after';
  const r = await w.api.descSave();
  assert.deepEqual(r, { ok: false, error: 'GitHub refused the change: nope.' });
  assert.equal(w.$('f-desc-edit').value, 'after');
  assert.equal(w.api.descDirty(), true, 'still unsaved');
  assert.equal(w.$('f-desc-kept-field').hidden, true, 'no conflict box for another kind of refusal');
  assert.equal(w.$('f-desc-save').disabled, false);
});
await test('a conflict shows GitHub\'s version, keeps the person\'s own text below, and sends nothing more', async () => {
  let sends = 0;
  const w = world({ issues: { open: async () => ({ description: 'before', base: 'h1' }), describe: async () => { sends += 1; throw Object.assign(new Error('changed'), { status: 409, current: { description: 'GitHub now says this', base: 'h9' } }); } } });
  w.api.descReset();
  await w.api.descLoad(issue());
  w.$('f-desc-edit').value = 'my edit';
  const r = await w.api.descSave();
  assert.equal(r.ok, false);
  assert.equal(r.error, "This changed on GitHub a moment ago. It now shows GitHub's version. Your text is kept below; copy what you need.");
  assert.equal(w.$('f-desc-edit').value, 'GitHub now says this');
  assert.equal(w.$('f-desc-kept').value, 'my edit');
  assert.equal(w.$('f-desc-kept-field').hidden, false);
  assert.deepEqual([w.state.desc.base, w.state.desc.opened], ['h9', 'GitHub now says this']);
  assert.equal(w.api.descDirty(), false, 'the box now holds GitHub\'s text, so closing loses nothing that is not kept below');
  assert.equal(sends, 1);
  w.api.descReset();
  assert.equal(w.$('f-desc-kept').value, '', 'the kept text goes when the window closes');
  assert.equal(w.$('f-desc-kept-field').hidden, true);
});
await test('a conflict with no text in the answer reads the issue again', async () => {
  let opens = 0;
  const w = world({ issues: { open: async () => { opens += 1; return { description: opens === 1 ? 'before' : 'fresh', base: `h${opens}` }; }, describe: async () => { throw Object.assign(new Error('changed'), { status: 409 }); } } });
  w.api.descReset();
  await w.api.descLoad(issue());
  w.$('f-desc-edit').value = 'mine';
  await w.api.descSave();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(opens, 2);
  assert.equal(w.$('f-desc-kept').value, 'mine');
});
await test('scConflictOf reads a 409 and nothing else', () => {
  assert.equal(scConflictOf(null), null);
  assert.equal(scConflictOf(Object.assign(new Error('x'), { status: 502 })), null);
  assert.deepEqual(scConflictOf(Object.assign(new Error('x'), { status: 409, current: { description: 'g', base: 'b' } })), { description: 'g', base: 'b' });
  assert.deepEqual(scConflictOf(Object.assign(new Error('x'), { status: 409, data: { description: 'g' } })), { description: 'g', base: '' });
  assert.deepEqual(scConflictOf(Object.assign(new Error('x'), { status: 409, description: 'g', base: 'b' })), { description: 'g', base: 'b' });
  assert.deepEqual(scConflictOf(Object.assign(new Error('x'), { status: 409 })), { description: null, base: '' });
});
await test('the wiring: Save description in the window, the main Save saves it first, dirty counts it, closing resets it, text only', () => {
  assert.match(html, /<textarea id="f-desc-edit" class="desc-edit" name="description" rows="8" maxlength="65536"/, 'GitHub\'s own limit');
  assert.match(html, /id="f-desc-save">Save description<\/button>/);
  assert.match(html, /<textarea id="f-desc-kept" class="desc-edit" rows="6" readonly/, 'the kept text can be copied but not saved');
  assert.match(page, /const d = await descSave\(\);\n\s*if \(!d\.ok\) \{ editorError\(d\.error\); return; \}\n\s*const r = await sendPulled\(ed\.id,/, 'a changed description goes first and stops the save when refused');
  assert.match(page, /\|\| descDirty\(\)\)\);/, 'unsaved description text counts as unsaved changes');
  assert.match(page, /state\.editing = null;\n\s*descReset\(\);/, 'closing the window drops the kept text');
  assert.match(page, /if \(on\) descLoad\(shown\);/);
  assert.doesNotMatch(block, /innerHTML|insertAdjacentHTML/, 'never markup');
  assert.doesNotMatch(block, /host\.issues\.[a-z]+\([^)]*\b(owners|end|fields|target)\b/, 'only the description goes');
});

console.log(`check-schedule-description: ${n} tests pass`);
