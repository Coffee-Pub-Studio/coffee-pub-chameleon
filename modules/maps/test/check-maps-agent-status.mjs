#!/usr/bin/env node
/*
 * check-maps-agent-status.mjs -- what an agent can say about a place when it adds one: type, status (want, booked, visited,
 * favorite) and owners (by key or by name). Runs the list model (src/maps-lib-f-list-model.js) on its own, reads the page's
 * wiring (src/maps-lib-g-list-view.js) and the manifest's inputs and inputHints. No page, no host, no network.
 * Usage: node modules/maps/test/check-maps-agent-status.mjs. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const types = JSON.parse(read('src/maps-lib-types.json'));
// The model uses `geo` only for oneLine, inRange and round6: small stand-ins.
const geo = {
  oneLine: (t, n) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, n),
  inRange: (a, b) => Math.abs(a) <= 90 && Math.abs(b) <= 180,
  round6: (x) => Math.round(x * 1e6) / 1e6,
};
const L = new Function('geo', 'LIB_TYPES', 'word', `${read('src/maps-lib-f-list-model.js')}\nreturn listModel(geo, LIB_TYPES, word);`)(geo, types, (k) => (k === 'space' ? 'trip' : k));
const manifest = JSON.parse(read('module.json'));
const view = read('src/maps-lib-g-list-view.js');

let passed = 0;
const fails = [];
function test(name, fn) { try { fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }

const people = [
  { key: 'u-ana', name: 'Ana Reyes' },
  { key: 'u-bo', name: 'Bo Chen' },
  { key: 'u-sam1', name: 'Sam' },
  { key: 'u-sam2', name: 'sam' },
];
const add = (extra) => L.placeFromRequest({ title: 'Cafe Luz', ...extra }, 'agent', people);
const kept = (p) => L.cleanPlace('x', L.placeValue(p));

// type
test('type is accepted and stored, and gives the category', () => {
  const p = add({ type: 'museum' });
  assert.equal(p.type, 'museum');
  assert.equal(p.category, types.find((t) => t.id === 'museum').category);
  assert.equal(kept(p).type, 'museum');
});
test('a type in another case, or by its name, is found', () => {
  assert.equal(add({ type: 'CAFE' }).type, 'cafe');
  assert.equal(add({ type: 'Restaurant' }).type, 'restaurant');
});
test('a category given wins over the type\'s', () => assert.equal(add({ type: 'cafe', category: 'stay' }).category, 'stay'));
test('an unknown type is refused with a sentence, not dropped', () => assert.throws(() => add({ type: 'nope' }), /That type is not in the list\. Use a type id such as cafe, museum or hotel\./));

// status
test('every status is accepted and stored', () => {
  for (const s of ['want', 'booked', 'visited', 'favorite']) assert.equal(kept(add({ status: s })).status, s);
});
test('a status by its words or in another case', () => {
  assert.equal(add({ status: 'Want to go' }).status, 'want');
  assert.equal(add({ status: ' VISITED ' }).status, 'visited');
});
test('no status is none, and stores none', () => {
  const p = add({});
  assert.equal(p.status, '');
  assert.ok(!('status' in L.placeValue(p)));
});
test('a bad status is refused with a plain sentence', () => {
  assert.throws(() => add({ status: 'someday' }), /The status is want, booked, visited or favorite; leave it out for none\./);
  assert.throws(() => add({ status: 5 }), /The status is/);
});

// owners
test('owners: by key, by name, any case, comma text or array, once each', () => {
  assert.deepEqual(add({ owners: 'u-ana' }).owners, ['u-ana']);
  assert.deepEqual(add({ owners: '  ana REYES ' }).owners, ['u-ana']);
  assert.deepEqual(add({ owners: 'U-BO' }).owners, ['u-bo']);
  assert.deepEqual(add({ owners: 'u-ana, bo chen' }).owners, ['u-ana', 'u-bo']);
  assert.deepEqual(add({ owners: ['Bo Chen', 'u-ana'] }).owners, ['u-bo', 'u-ana']);
  assert.deepEqual(add({ owners: 'u-ana, Ana Reyes, ana reyes' }).owners, ['u-ana']);
  assert.deepEqual(kept(add({ owners: 'Ana Reyes' })).owners, ['u-ana']);
});
test('owners: none given is nobody; empty is nobody', () => {
  assert.deepEqual(add({}).owners, []);
  assert.deepEqual(add({ owners: '' }).owners, []);
});
test('owners: an unknown person is refused, with the space word', () => assert.throws(() => add({ owners: 'u-ana, Zed' }), /^Error: That person is not in this trip\. Use list_members to see who is\.$/));
test('owners: an ambiguous name is refused, the key works', () => {
  assert.throws(() => add({ owners: 'Sam' }), /Two people are called Sam; use the key\./);
  assert.deepEqual(add({ owners: 'u-sam1' }).owners, ['u-sam1']);
});
test('owners: not text or a list is refused', () => {
  assert.throws(() => add({ owners: 5 }), /Name the people as a list/);
  assert.throws(() => add({ owners: [1] }), /Name the people as a list/);
});

test('the page passes the space\'s people to addPlace', () => assert.match(view, /placeFromRequest\(input, me, state\.people\)/));

const acts = Object.fromEntries(manifest.actions.provides.map((a) => [a.name, a]));
test('manifest: addPlace declares type, status and owners, each with a hint', () => {
  assert.equal(acts.addPlace.input.type, 'string?');
  assert.equal(acts.addPlace.input.status, 'string?');
  assert.equal(acts.addPlace.input.owners, 'text?');
  for (const k of ['type', 'status', 'owners', 'category']) assert.ok(acts.addPlace.inputHints[k], k);
});
test('manifest: hints name real inputs, 200 characters or fewer; descriptions are one sentence', () => {
  for (const a of manifest.actions.provides) {
    for (const [k, v] of Object.entries(a.inputHints || {})) {
      assert.ok(k in a.input, `${a.name}.${k} is not an input`);
      assert.ok(typeof v === 'string' && v.length > 0 && v.length <= 200, `${a.name}.${k} length`);
    }
    if (a.description) assert.match(a.description, /^[^.]*\.$/, `${a.name} description`);
  }
});
test('manifest: the module keeps to 10 actions (server/modules.js reads only the first 10)', () => assert.ok(manifest.actions.provides.length <= 10));

if (fails.length) { for (const f of fails) console.error(`check-maps-agent-status: ${f}`); process.exit(1); }
console.log(`check-maps-agent-status: ${passed} passed`);
