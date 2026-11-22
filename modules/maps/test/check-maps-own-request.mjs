/*
 * check-maps-own-request.mjs -- whether a request is the page person's own (Thomas, 2026-11-22). Maps' list part compares the
 * asker's KEY (ctx.byKey) with the page person's key, never the display name (ctx.by). The real `ownRequest` is cut out of the
 * source and run; the local request in maps.js is read to give the page person's own key.
 *
 * Usage: node modules/maps/test/check-maps-own-request.mjs. Exits 1 on any failure.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = (f) => fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
try {
  const line = src('maps-lib-g-list-view.js').split('\n').find((l) => l.startsWith('  const ownRequest = '));
  assert.ok(line, 'ownRequest found');
  const make = (personal, key) => new Function('personal', 'info', `${line}\nreturn ownRequest;`)(personal, { user: { key } });
  const own = make(true, 'u-ann');
  assert.equal(own({ by: 'Ann', byKey: 'u-ann' }), true, 'a person\'s own request is own');
  assert.equal(own({ by: 'u-ann', byKey: 'u-bob' }), false, 'another person is not own, even when their name looks like a key');
  assert.equal(own({ by: 'Bob', byKey: 'u-bob' }), false, 'another person\'s request is not own');
  assert.equal(own({ by: 'Claude', byKey: 'a-claude' }), false, 'an agent\'s request is not own');
  assert.equal(own({ by: 'Ann', byKey: null }), false, 'an empty byKey is not own');
  assert.equal(own({ by: 'Ann', byKey: '' }), false, 'an empty-string byKey is not own');
  assert.equal(own({ by: 'u-ann' }), false, 'a name equal to the key does not count');
  assert.equal(own(undefined), true, 'a direct call (no context) is own');
  assert.equal(make(false, 'u-ann')({ by: 'Ann', byKey: 'u-ann' }), false, 'no private list on this page: not own');
  const m = src('maps.js');
  assert.match(m, /by: info\.user && info\.user\.name, byKey: \(info\.user && info\.user\.key\) \|\| null/, 'the local request carries the page person\'s name and key');
} catch (err) {
  console.error(`check-maps-own-request: ${err.message}`);
  process.exit(1);
}
console.log('check-maps-own-request: ok');
