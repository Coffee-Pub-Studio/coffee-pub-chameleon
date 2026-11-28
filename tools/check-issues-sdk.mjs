#!/usr/bin/env node
/*
 * check-issues-sdk.mjs -- host.issues.open, describe, comment, editComment and deleteComment reach the right route.
 *
 * Runs on its own, no browser and no server: it slices the SDK's `issues` object and the bridge's handlers out of
 * public/sdk/host.js and public/module-host.js and runs them against stand-ins for call, api and fetch. What it holds:
 *   - each SDK call sends the bridge method it should, with its arguments;
 *   - each bridge handler uses the route and method the server has (GET, PUT .../description, POST, PATCH and DELETE .../comments);
 *   - a 409 on describe throws with status 409 and the service's description and base (also err.current); a 429 keeps retryAfter;
 *   - outside a space, for a keyed page and for a bad number nothing is asked;
 *   - the bridge hands description and base to the frame, and the SDK puts them back on the error.
 *
 *   node tools/check-issues-sdk.mjs
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const rd = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const slice = (src, from, to) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + from.length);
  if (a === -1 || b === -1) { console.error(`check-issues-sdk: could not find "${from}" ... "${to}"`); process.exit(1); }
  return src.slice(a, b);
};
const sdk = rd('public/sdk/host.js');
const bridge = rd('public/module-host.js');

const sdkSrc = slice(sdk, "      open: (number) => call('issues.open'", '    },\n\n    // Set up for the space.');
const handlerSrc = slice(bridge, "    async 'issues.open'", '    // Set up for this space (space-setup.js)');
const pathSrc = slice(bridge, '  const issuePath = ', '  const handlers = {');

let failed = 0;
const pending = [];
const test = (name, fn) => pending.push(Promise.resolve().then(fn).catch((err) => { failed += 1; console.error(`check-issues-sdk: ${name}: ${err.stack || err.message}`); }));

// The SDK half.
const calls = [];
const call = (method, params) => { calls.push([method, params]); return Promise.resolve(params); };
const issues = new Function('call', `return { ${sdkSrc} };`)(call);
test('the SDK sends each call to the bridge', async () => {
  await issues.open(7);
  await issues.describe(7, { text: 'a', base: 'b' });
  await issues.comment(7, 'hi');
  await issues.editComment(7, 99, 'yo');
  await issues.deleteComment(7, 99);
  assert.deepEqual(calls, [
    ['issues.open', { number: 7 }],
    ['issues.describe', { number: 7, text: 'a', base: 'b' }],
    ['issues.comment', { number: 7, text: 'hi' }],
    ['issues.editComment', { number: 7, commentId: 99, text: 'yo' }],
    ['issues.deleteComment', { number: 7, commentId: 99 }],
  ]);
});

// The bridge half.
const make = ({ scope = 'space', spaceId = 'sp1', keyed = false, guestToken = '', respond }) => {
  const seen = [];
  const api = async (method, url, body) => { seen.push({ method, url, body }); return respond ? respond(method, url) : { comment: { id: 1 }, item: {} }; };
  const fetch = async (url, init) => { seen.push({ method: init.method, url, body: JSON.parse(init.body) }); return fakeRes; };
  let fakeRes = null;
  const accessKeyHeaders = () => ({});
  const word = () => 'a space';
  const h = new Function('scope', 'spaceId', 'keyed', 'guestToken', 'api', 'fetch', 'accessKeyHeaders', 'word',
    `${pathSrc}\n return { ${handlerSrc} };`)(scope, spaceId, keyed, guestToken, api, fetch, accessKeyHeaders, word);
  return { h, seen, reply: (status, data, headers = {}) => { fakeRes = { ok: status < 400, status, json: async () => data, headers: { get: (k) => headers[k] ?? null } }; } };
};

test('the bridge asks the server\'s routes', async () => {
  const { h, seen, reply } = make({ guestToken: 'g t' });
  await h['issues.open']({ number: 7 });
  reply(200, { item: { key: 'k' }, description: 'now', base: 'nb' });
  const saved = await h['issues.describe']({ number: 7, text: 'a', base: 'b' });
  await h['issues.comment']({ number: 7, text: 'hi' });
  await h['issues.editComment']({ number: 7, commentId: 99, text: 'yo' });
  await h['issues.deleteComment']({ number: 7, commentId: 99 });
  assert.deepEqual(saved, { item: { key: 'k' }, description: 'now', base: 'nb' });
  assert.deepEqual(seen.map((s) => [s.method, s.url]), [
    ['GET', '/api/spaces/sp1/issues/7?guest=g%20t'],
    ['PUT', '/api/spaces/sp1/issues/7/description'],
    ['POST', '/api/spaces/sp1/issues/7/comments'],
    ['PATCH', '/api/spaces/sp1/issues/7/comments/99'],
    ['DELETE', '/api/spaces/sp1/issues/7/comments/99'],
  ]);
  assert.deepEqual(seen[1].body, { text: 'a', base: 'b' });
  assert.deepEqual(seen[2].body, { text: 'hi' });
  assert.deepEqual(seen[3].body, { text: 'yo' });
});

test('a 409 on describe carries the service\'s text and base', async () => {
  const { h, reply } = make({});
  reply(409, { error: 'Changed.', description: 'theirs', base: 'a'.repeat(32) });
  await assert.rejects(h['issues.describe']({ number: 7, text: 'x', base: 'b' }), (err) => err.status === 409 && err.description === 'theirs' && err.base === 'a'.repeat(32) && err.current.description === 'theirs' && err.message === 'Changed.');
});

test('a 429 on describe keeps its wait', async () => {
  const { h, reply } = make({});
  reply(429, { error: 'Wait.' }, { 'Retry-After': '12' });
  await assert.rejects(h['issues.describe']({ number: 7, text: 'x', base: 'b' }), (err) => err.status === 429 && err.retryAfter === 12);
});

test('nothing is asked outside a space, on a keyed page or for a bad number', async () => {
  for (const o of [{ scope: 'environment' }, { spaceId: '' }, { keyed: true }]) {
    const { h, seen } = make(o);
    await assert.rejects(h['issues.open']({ number: 7 }), (err) => err.status === 400);
    assert.equal(seen.length, 0);
  }
  const { h, seen } = make({});
  for (const number of [0, -1, 1.5, 'x', undefined]) await assert.rejects(h['issues.comment']({ number, text: 'a' }), (err) => err.status === 400);
  assert.equal(seen.length, 0);
});

test('the error crosses the frame with description and base', () => {
  assert.match(bridge, /reply\(m\.id, \{ error: \{[^}]*description: err\.description, base: err\.base/);
  assert.match(sdk, /err\.description = m\.error\.description;\s*err\.base = m\.error\.base/);
});

await Promise.all(pending);
if (failed) { console.error(`check-issues-sdk: ${failed} failed`); process.exit(1); }
console.log('check-issues-sdk: ok');
