#!/usr/bin/env node
/*
 * check-schedule-thread.mjs -- a pulled issue's Comments, Owners and Part of in Planner - Projects (plan-github-full-sync.md, sections 2, 3
 * and 5; #1259), the module's half. The code between "the issue's description (begin)" and "the issue's comments (end)" in src/schedule.js is
 * run as written against a small fake page and a fake `host.issues` shaped as the host's SDK says (open, comment, editComment,
 * deleteComment; a comment is { id, who: { member } | { login }, at, edited, text, mine, canDelete }):
 *   - scCommentView: the author as a member's name or a GitHub login, a bad time dropped, the person's rights kept;
 *   - the thread is drawn oldest first, text as text, who and when, "edited", the line for older comments, and the box to add one only
 *     for someone who may (write_out in a space that writes back, and the host's `comment`);
 *   - Add a comment sends the text and draws the answer, refuses an empty one without a call, and says why a refusal happened, keeping the text;
 *   - Edit works in place (a box, Save, Cancel), is offered only for `mine`, and Delete only for `canDelete`, after asking, and neither is
 *     offered when the host has no such call;
 *   - the wiring, read as source: Owners and Part of show for an issue only when the host can open one, Part of lists the plan's milestones from
 *     GitHub and "No milestone", the logins no member has linked are shown read only, and Save sends Owners and the milestone only when changed.
 * Usage: node modules/schedule/test/check-schedule-thread.mjs. Exits 1 on failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(path.join(dir, 'src', 'schedule.js'), 'utf8');
const lib = fs.readFileSync(path.join(dir, 'src', 'schedule-lib.js'), 'utf8');
const html = fs.readFileSync(path.join(dir, 'src', 'schedule.html'), 'utf8');
const css = fs.readFileSync(path.join(dir, 'src', 'schedule.css'), 'utf8');

let n = 0;
const test = async (name, fn) => { try { await fn(); n += 1; } catch (e) { process.exitCode = 1; console.error(`FAIL ${name}\n${e.stack || e}`); } };

const block = page.slice(page.indexOf('// ---- the issue\'s description (begin) ----'), page.indexOf('// ---- the issue\'s comments (end) ----'));
const { scCommentView, scConflictOf } = new Function(`${lib}\nreturn { scCommentView, scConflictOf };`)();

class Node {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.className = ''; this.textContent = ''; this.hidden = false; this.disabled = false; this.value = ''; this.listeners = {}; this.attrs = {}; }
  append(...k) { this.children.push(...k); }
  replaceChildren(...k) { this.children = k; }
  addEventListener(t, f) { this.listeners[t] = f; }
  setAttribute(k, v) { this.attrs[k] = v; }
  focus() {}
  click() { return this.listeners.click && this.listeners.click(); }
  find(pred, out = []) { for (const c of this.children) { if (pred(c)) out.push(c); c.find && c.find(pred, out); } return out; }
}
const texts = (node) => node.find((c) => c.textContent).map((c) => c.textContent);

function world({ issues, through = true, name = 'GitHub', confirm = async () => true } = {}) {
  const els = {};
  const $ = (id) => (els[id] = els[id] || new Node(id));
  const state = { editing: { id: 'gh-7' }, pull: { name } };
  const host = { issues, ui: { confirm } };
  const hide = (el, yes) => { if (el) el.hidden = Boolean(yes); };
  const asked = [];
  const make = new Function('$', 'state', 'host', 'hide', 'through', 'remember', 'render', 'scConflictOf', 'scCommentView', 'nameOf', 'document', 'SC_PREFIX', `${block}\nreturn { descReset, cmtDraw, cmtRender, cmtSend, cmtReset, cmtAdd };`);
  const doc = { createElement: (t) => new Node(t) };
  const api = make($, state, host, hide, () => through, () => {}, () => {}, scConflictOf, scCommentView, (k) => ({ u1: 'Ana Reyes', u2: 'Bo Chen' }[k]), doc, 'plan:');
  return { $, state, api, asked };
}
const shown = { id: 'gh-7', source: { number: 7 } };
const thread = (more = {}) => ({
  comments: [
    { id: 11, who: { member: 'u1' }, at: '2026-11-20T10:00:00Z', edited: false, text: 'First, from Ana.\nSecond line.', mine: true, canDelete: true },
    { id: 12, who: { login: 'octocat' }, at: '2026-11-21T09:30:00Z', edited: true, text: '<b>not markup</b>', mine: false, canDelete: false },
    { id: 13, who: { member: 'gone' }, at: 'not a time', text: 5, mine: false, canDelete: true },
  ],
  older: 2,
  ...more,
});
const items = (w) => w.$('f-comments').children;

await test('scCommentView names the author, drops a bad time and keeps the rights', () => {
  const nameOf = (k) => ({ u1: 'Ana Reyes' }[k]);
  assert.deepEqual(scCommentView({ id: 1, who: { member: 'u1' }, at: '2026-11-20T10:00:00Z', edited: true, text: 'hi', mine: true, canDelete: true }, nameOf), { id: 1, name: 'Ana Reyes', at: '2026-11-20T10:00:00Z', edited: true, text: 'hi', mine: true, canDelete: true });
  assert.equal(scCommentView({ who: { member: 'gone' } }, nameOf).name, 'Someone who left');
  assert.equal(scCommentView({ who: { login: 'octocat' } }).name, 'octocat');
  assert.equal(scCommentView({ who: {} }).name, 'Someone');
  assert.equal(scCommentView(null).name, 'Someone');
  assert.equal(scCommentView({ at: 'soon' }).at, '');
  assert.equal(scCommentView({ text: 5 }).text, '');
  assert.deepEqual([scCommentView({}).mine, scCommentView({}).canDelete, scCommentView({}).edited], [false, false, false]);
});
await test('the thread is drawn oldest first as text, with who, when and "edited", and the line for older comments', () => {
  const w = world({ issues: { open() {}, comment() {} } });
  w.api.descReset();
  w.api.cmtDraw(shown, thread());
  assert.equal(items(w).length, 3);
  const first = items(w)[0];
  assert.deepEqual(texts(first).slice(0, 1), ['Ana Reyes']);
  assert.ok(texts(first).includes('First, from Ana.\nSecond line.'));
  assert.ok(texts(items(w)[1]).includes('edited'));
  assert.ok(texts(items(w)[1]).includes('<b>not markup</b>'), 'text is text, never markup');
  assert.equal(items(w)[1].find((c) => c.className === 'comment-text')[0].textContent, '<b>not markup</b>');
  assert.deepEqual(texts(items(w)[2]).slice(0, 1), ['Someone who left']);
  assert.equal(items(w)[2].find((c) => c.className === 'comment-text')[0].textContent, '', 'a text that is not text is nothing');
  assert.equal(w.$('f-comments-older').textContent, '2 older comments are on GitHub.');
  assert.equal(w.$('f-comments-field').hidden, false);
});
await test('a thread with no comments and nothing older is not shown unless one can be added', () => {
  const none = world({ through: false, issues: { open() {} } });
  none.api.descReset();
  none.api.cmtDraw(shown, { comments: [], older: 0 });
  assert.equal(none.$('f-comments-field').hidden, true);
  const can = world({ issues: { open() {}, comment() {} } });
  can.api.descReset();
  can.api.cmtDraw(shown, { comments: [], older: 0 });
  assert.equal(can.$('f-comments-field').hidden, false);
  assert.equal(can.$('f-comment-add').hidden, false);
  const one = world({ through: false, issues: { open() {} } });
  one.api.descReset();
  one.api.cmtDraw(shown, { comments: [], older: 1 });
  assert.equal(one.$('f-comments-older').textContent, '1 older comment is on GitHub.');
  const bad = world({ issues: { open() {} } });
  bad.api.descReset();
  bad.api.cmtDraw(shown, {});
  assert.equal(bad.state.thread, null, 'an answer with no thread draws none');
});
await test('the box to add a comment is for someone who may, only when the host has comment()', () => {
  for (const [through, issues, shows] of [[true, { open() {}, comment() {} }, true], [false, { open() {}, comment() {} }, false], [true, { open() {} }, false]]) {
    const w = world({ through, issues });
    w.api.descReset();
    w.api.cmtDraw(shown, thread());
    assert.equal(w.$('f-comment-add').hidden, !shows, `through ${through}, comment ${Boolean(issues.comment)}`);
  }
});
await test('Edit is offered for `mine` and Delete for `canDelete`, and neither when the host has no such call', () => {
  const full = world({ issues: { open() {}, comment() {}, editComment() {}, deleteComment() {} } });
  full.api.descReset();
  full.api.cmtDraw(shown, thread());
  const buttons = (i) => items(full)[i].find((c) => c.tag === 'button').map((b) => b.textContent);
  assert.deepEqual(buttons(0), ['Edit', 'Delete']);
  assert.deepEqual(buttons(1), []);
  assert.deepEqual(buttons(2), ['Delete'], 'an owner may delete a comment made here that is not theirs');
  const bare = world({ issues: { open() {}, comment() {} } });
  bare.api.descReset();
  bare.api.cmtDraw(shown, thread());
  assert.deepEqual(items(bare).map((li) => li.find((c) => c.tag === 'button').length), [0, 0, 0]);
});
await test('Add a comment sends the text, draws the answer, and refuses an empty one without a call', async () => {
  const sent = [];
  const w = world({ issues: { open() {}, comment: async (num, text) => { sent.push([num, text]); return { id: 99, who: { member: 'u2' }, at: '2026-11-22T08:00:00Z', edited: false, text, mine: true, canDelete: true }; } } });
  w.api.descReset();
  w.api.cmtDraw(shown, thread());
  w.$('f-comment-text').value = '   ';
  await w.api.cmtSend();
  assert.equal(sent.length, 0);
  assert.equal(w.$('f-comments-note').textContent, 'Write the comment first.');
  w.$('f-comment-text').value = 'A new comment';
  await w.api.cmtSend();
  assert.deepEqual(sent, [[7, 'A new comment']]);
  assert.equal(items(w).length, 4);
  assert.deepEqual(texts(items(w)[3]).slice(0, 2), ['Bo Chen', texts(items(w)[3])[1]]);
  assert.equal(w.$('f-comment-text').value, '');
  assert.equal(w.$('f-comments-note').textContent, '');
  assert.equal(w.$('f-comment-send').disabled, false);
});
await test('a refused comment says why and keeps what was typed', async () => {
  const w = world({ issues: { open() {}, comment: async () => { throw Object.assign(new Error('GitHub refused the change: nope.'), { status: 502 }); } } });
  w.api.descReset();
  w.api.cmtDraw(shown, thread());
  w.$('f-comment-text').value = 'my words';
  await w.api.cmtSend();
  assert.equal(w.$('f-comments-note').textContent, 'GitHub refused the change: nope.');
  assert.equal(w.$('f-comment-text').value, 'my words');
  assert.equal(items(w).length, 3);
  assert.equal(w.$('f-comment-send').disabled, false);
  const silent = world({ name: 'GitHub', issues: { open() {}, comment: async () => { throw new Error(''); } } });
  silent.api.descReset();
  silent.api.cmtDraw(shown, thread());
  silent.$('f-comment-text').value = 'x';
  await silent.api.cmtSend();
  assert.equal(silent.$('f-comments-note').textContent, 'GitHub did not answer. Nothing was changed; try again.');
});
await test('Edit works in place: a box, Save sends the text, Cancel puts the thread back', async () => {
  const edits = [];
  const w = world({ issues: { open() {}, comment() {}, editComment: async (num, id, text) => { edits.push([num, id, text]); return { id, who: { member: 'u1' }, at: '2026-11-20T10:00:00Z', edited: true, text, mine: true, canDelete: true }; }, deleteComment() {} } });
  w.api.descReset();
  w.api.cmtDraw(shown, thread());
  const editBtn = () => items(w)[0].find((c) => c.tag === 'button' && c.textContent === 'Edit')[0];
  editBtn().click();
  const li = items(w)[0];
  const box = li.find((c) => c.tag === 'textarea')[0];
  assert.equal(box.value, 'First, from Ana.\nSecond line.');
  const buttons = li.find((c) => c.tag === 'button');
  assert.deepEqual(buttons.map((b) => b.textContent), ['Save', 'Cancel']);
  box.value = '  ';
  await buttons[0].click();
  assert.equal(edits.length, 0);
  assert.equal(w.$('f-comments-note').textContent, 'A comment cannot be empty. Delete it instead.');
  buttons[1].click();
  assert.ok(items(w)[0].find((c) => c.tag === 'textarea').length === 0, 'Cancel puts the comment back');
  editBtn().click();
  const box2 = items(w)[0].find((c) => c.tag === 'textarea')[0];
  box2.value = 'Changed text';
  await items(w)[0].find((c) => c.tag === 'button')[0].click();
  assert.deepEqual(edits, [[7, 11, 'Changed text']]);
  assert.ok(texts(items(w)[0]).includes('Changed text'));
  assert.ok(texts(items(w)[0]).includes('edited'));
});
await test('Delete asks first, and only a yes deletes', async () => {
  const gone = [];
  const mk = (answer) => world({ confirm: async () => answer, issues: { open() {}, comment() {}, editComment() {}, deleteComment: async (num, id) => { gone.push([num, id]); return { deleted: true }; } } });
  const no = mk(false);
  no.api.descReset();
  no.api.cmtDraw(shown, thread());
  await items(no)[0].find((c) => c.tag === 'button' && c.textContent === 'Delete')[0].click();
  assert.equal(gone.length, 0);
  assert.equal(items(no).length, 3);
  const yes = mk(true);
  yes.api.descReset();
  yes.api.cmtDraw(shown, thread());
  await items(yes)[0].find((c) => c.tag === 'button' && c.textContent === 'Delete')[0].click();
  assert.deepEqual(gone, [[7, 11]]);
  assert.equal(items(yes).length, 2);
  const fail = world({ issues: { open() {}, comment() {}, deleteComment: async () => { throw new Error('GitHub refused the change: nope.'); } } });
  fail.api.descReset();
  fail.api.cmtDraw(shown, thread());
  await items(fail)[0].find((c) => c.tag === 'button' && c.textContent === 'Delete')[0].click();
  assert.equal(items(fail).length, 3, 'a refused delete keeps the comment');
  assert.equal(fail.$('f-comments-note').textContent, 'GitHub refused the change: nope.');
});
await test('Owners and Part of: shown for an issue only when the host can open one; the milestones from GitHub; logins read only; Save sends changes only', () => {
  assert.match(page, /const sync = on && descCan\(\);/);
  assert.match(page, /\$\('f-assignees'\)\.textContent = sync && shown\.assignees && shown\.assignees\.length \? `Also assigned on \$\{state\.pull\.name \|\| 'GitHub'\}: \$\{shown\.assignees\.join\(', '\)\}\.` : '';/);
  assert.match(page, /if \(on\) hide\(\$\('f-owners-field'\), !sync\);/);
  assert.match(page, /list\(\)\.filter\(\(x\) => x\.kind === 'milestone' && x\.source && x\.source\.milestone\)/, 'only the milestones that come from GitHub');
  assert.match(page, /\{ id: '', title: 'No milestone' \}/);
  assert.match(page, /hide\(\$\('f-parent-field'\), !sync \|\| \(!ms\.length && !shown\.parent\)\);/);
  assert.match(page, /\['f-dates', 'f-waits-field', 'f-phase-field'\]\) hide\(\$\(id\), true\)/, 'the days, Waits on and Phase stay hidden');
  assert.match(page, /descCan\(\) && \(\$\('f-owners-field'\)\.contains\(el\) \|\| \(!fieldsOnly && \$\('f-parent-field'\)\.contains\(el\)\)\)/, 'Owners for anyone who may edit, the milestone only for someone who may change GitHub');
  assert.match(page, /const owned = ownersNow && !sameSet\(ownersNow, e\.owners \|\| \[\]\) \? \{ owners: ownersNow \} : \{\};/);
  assert.match(page, /const placed = parentNow !== undefined && \(parentNow \|\| null\) !== \(e\.parent \|\| null\) \? \{ parent: parentNow \} : \{\};/);
  assert.match(page, /if \(ed\.fieldsOnly\) return \{ \.\.\.e, fields: fieldsFromForm\(e\.fields\), end: endOf\(e\), \.\.\.owned \};/, 'someone who may not change GitHub still sets Owners (the linked ones are refused by the server with its sentence)');
  assert.match(html, /id="f-assignees"/);
  assert.match(html, /id="f-comment-send">Add a comment<\/button>/);
  assert.match(html, /<ul class="comments" id="f-comments"/);
  assert.doesNotMatch(block, /innerHTML|insertAdjacentHTML/, 'never markup');
  assert.match(css, /\.comment-text \{[^}]*white-space: pre-wrap;[^}]*overflow-wrap: anywhere;/);
  assert.doesNotMatch(css.slice(css.indexOf('.comments {'), css.indexOf('.desc-actions {')), /#[0-9a-f]{3,6}\b|rgb\(/i, 'no colour of its own');
});

console.log(`check-schedule-thread: ${n} tests pass`);
