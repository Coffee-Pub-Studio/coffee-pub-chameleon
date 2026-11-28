#!/usr/bin/env node
/*
 * check-schedule-conflict.mjs -- a pulled issue's window after GitHub changed the issue since the window was opened (found live: the
 * server answered 409 and the page stored GitHub's version, but the window kept the title the person typed, so pressing Save again
 * would have sent it over a rename they never saw):
 *   - sendPulled says a refusal was a conflict (`conflict: true` for a 409 only);
 *   - on a conflict savePulled shows GitHub's title, Done and tags in the window (conflictForm, run as written against a fake page),
 *     says so in the server's own words, and gives back what was typed so it can be copied;
 *   - any other refusal leaves the window as it was, with its reason.
 * Usage: node modules/schedule/test/check-schedule-conflict.mjs. Exits 1 on failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(path.join(dir, 'src', 'schedule.js'), 'utf8');

let n = 0;
const test = async (name, fn) => { try { await fn(); n += 1; } catch (e) { process.exitCode = 1; console.error(`FAIL ${name}\n${e.stack || e}`); } };
const grab = (re) => { const m = page.match(re); assert.ok(m, `found ${re}`); return m[0]; };

const src = grab(/function conflictForm\(ed, typed\) \{[\s\S]*?\n  \}\n/);
function world(stored, name = 'GitHub') {
  const els = {};
  const tags = ['bug', 'ux'].map((value) => ({ value, checked: false }));
  const $ = (id) => (id === 'f-tags' ? { querySelectorAll: () => tags } : (els[id] = els[id] || { value: '', checked: false }));
  const state = { editing: { opened: 'before' }, pull: { name } };
  const errors = [];
  const make = new Function('$', 'state', 'entry', 'formSnapshot', 'editorError', `${src}\nreturn conflictForm;`);
  const conflictForm = make($, state, (id) => (id === 'gh-2' ? stored : null), () => 'snapshot-after', (t) => errors.push(t));
  return { $, state, tags, errors, conflictForm };
}

await test('sendPulled says a 409 was a conflict, and nothing else', () => {
  assert.match(page, /return \{ ok: false, error, conflict: Boolean\(err && err\.status === 409\) \};/);
  assert.match(page, /else if \(r\.conflict && !ed\.fieldsOnly\) conflictForm\(ed, title\);\n\s*else editorError\(r\.error\);/, 'a conflict refreshes the window; any other refusal only says why');
});
await test('a conflict shows GitHub\'s title, Done and tags and gives back what was typed', () => {
  const w = world({ title: 'Server: renamed on GitHub', done: true, tags: ['ux'] });
  w.$('f-title').value = 'Server: my own new title';
  w.conflictForm({ id: 'gh-2' }, 'Server: my own new title');
  assert.equal(w.$('f-title').value, 'Server: renamed on GitHub');
  assert.equal(w.$('f-done').checked, true);
  assert.deepEqual(w.tags.map((t) => t.checked), [false, true]);
  assert.deepEqual(w.errors, ['This changed on GitHub a moment ago. It now shows GitHub\'s version. Your title was "Server: my own new title".']);
  assert.equal(w.state.editing.opened, 'snapshot-after', 'closing the window does not ask about changes it just refreshed');
});
await test('when the typed title is the one GitHub holds, nothing is quoted back; the service\'s own name is used', () => {
  const w = world({ title: 'Same', done: false, tags: [] }, 'Test stand-in');
  w.conflictForm({ id: 'gh-2' }, 'Same');
  assert.deepEqual(w.errors, ['This changed on Test stand-in a moment ago. It now shows Test stand-in\'s version.']);
});
await test('an issue that is no longer in the plan changes nothing', () => {
  const w = world(null);
  w.$('f-title').value = 'kept';
  w.conflictForm({ id: 'gh-9' }, 'x');
  assert.equal(w.$('f-title').value, 'kept');
  assert.deepEqual(w.errors, []);
});

console.log(`check-schedule-conflict: ${n} tests pass`);
