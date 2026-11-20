#!/usr/bin/env node
/*
 * check-maps-agent-status.mjs -- what an agent can say about a place: type, status (want, booked, visited, favorite) and owners
 * on addPlace, and updatePlace to change them later. Runs the list model (src/maps-lib-f-list-model.js) on its own, reads the
 * page's wiring (src/maps-lib-g-list-view.js) and the manifest's inputs and inputHints. No page, no host, no network.
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
const stored = () => L.cleanPlace('p1', L.placeValue(add({ type: 'cafe', status: 'want', owners: 'u-ana' })));
const change = (input, p) => L.placeChanged(p || stored(), input, 'agent', people);

// type
test('addPlace: type is accepted and stored, and gives the category', () => {
  const p = add({ type: 'museum' });
  assert.equal(p.type, 'museum');
  assert.equal(p.category, types.find((t) => t.id === 'museum').category);
  assert.equal(L.cleanPlace('x', L.placeValue(p)).type, 'museum');
});
test('addPlace: a type in another case, or by its name, is found', () => {
  assert.equal(add({ type: 'CAFE' }).type, 'cafe');
  assert.equal(add({ type: 'Restaurant' }).type, 'restaurant');
});
test('addPlace: a category given wins over the type\'s', () => assert.equal(add({ type: 'cafe', category: 'stay' }).category, 'stay'));
test('addPlace: an unknown type is refused with a sentence, not dropped', () => assert.throws(() => add({ type: 'nope' }), /That type is not in the list\. Use a type id such as cafe, museum or hotel\./));

// status
test('addPlace: every status is accepted and stored', () => {
  for (const s of ['want', 'booked', 'visited', 'favorite']) assert.equal(L.cleanPlace('x', L.placeValue(add({ status: s }))).status, s);
});
test('addPlace: a status by its words or in another case', () => {
  assert.equal(add({ status: 'Want to go' }).status, 'want');
  assert.equal(add({ status: ' VISITED ' }).status, 'visited');
});
test('addPlace: no status is none, and stores none', () => {
  const p = add({});
  assert.equal(p.status, '');
  assert.ok(!('status' in L.placeValue(p)));
});
test('addPlace: a bad status is refused with a plain sentence', () => {
  assert.throws(() => add({ status: 'someday' }), /The status is want, booked, visited or favorite; leave it out for none\./);
  assert.throws(() => add({ status: 5 }), /The status is/);
});

// owners
test('addPlace owners: by key, by name, any case, comma text or array, once each', () => {
  assert.deepEqual(add({ owners: 'u-ana' }).owners, ['u-ana']);
  assert.deepEqual(add({ owners: '  ana REYES ' }).owners, ['u-ana']);
  assert.deepEqual(add({ owners: 'U-BO' }).owners, ['u-bo']);
  assert.deepEqual(add({ owners: 'u-ana, bo chen' }).owners, ['u-ana', 'u-bo']);
  assert.deepEqual(add({ owners: ['Bo Chen', 'u-ana'] }).owners, ['u-bo', 'u-ana']);
  assert.deepEqual(add({ owners: 'u-ana, Ana Reyes, ana reyes' }).owners, ['u-ana']);
});
test('addPlace owners: none given is nobody; empty is nobody', () => {
  assert.deepEqual(add({}).owners, []);
  assert.deepEqual(add({ owners: '' }).owners, []);
});
test('addPlace owners: an unknown person is refused with the space word', () => assert.throws(() => add({ owners: 'u-ana, Zed' }), /^Error: That person is not in this trip\. Use list_members to see who is\.$/));
test('addPlace owners: an ambiguous name is refused, the key works', () => {
  assert.throws(() => add({ owners: 'Sam' }), /Two people are called Sam; use the key\./);
  assert.deepEqual(add({ owners: 'u-sam1' }).owners, ['u-sam1']);
});
test('addPlace owners: not text or a list is refused', () => {
  assert.throws(() => add({ owners: 5 }), /Name the people as a list/);
  assert.throws(() => add({ owners: [1] }), /Name the people as a list/);
});

// updatePlace
test('updatePlace: marks a place visited, the rest stays', () => {
  const p = change({ status: 'visited' });
  assert.equal(p.status, 'visited');
  assert.deepEqual([p.title, p.type, p.owners, p.id], ['Cafe Luz', 'cafe', ['u-ana'], 'p1']);
});
test('updatePlace: an empty status clears it', () => {
  const p = change({ status: '' });
  assert.equal(p.status, '');
  assert.ok(!('status' in L.placeValue(p)));
});
test('updatePlace: a bad status is refused', () => assert.throws(() => change({ status: 'soon' }), /The status is want, booked/));
test('updatePlace: owners replace, by name; empty clears', () => {
  assert.deepEqual(change({ owners: 'Bo Chen' }).owners, ['u-bo']);
  assert.deepEqual(change({ owners: '' }).owners, []);
});
test('updatePlace: unknown and ambiguous people are refused', () => {
  assert.throws(() => change({ owners: 'Zed' }), /That person is not in this trip\./);
  assert.throws(() => change({ owners: 'sam' }), /Two people are called sam; use the key\./);
});
test('updatePlace: a new type moves the category; one given wins', () => {
  const m = types.find((t) => t.id === 'museum');
  const p = change({ type: 'museum' });
  assert.deepEqual([p.type, p.category], ['museum', m.category]);
  assert.equal(change({ type: 'museum', category: 'stay' }).category, 'stay');
  assert.throws(() => change({ type: 'nope' }), /not in the list/);
});
test('updatePlace: title, address and notes change; a blank title is refused', () => {
  const p = change({ title: 'New name', address: 'Rua 2', notes: 'Closed Mondays' });
  assert.deepEqual([p.title, p.address, p.notes], ['New name', 'Rua 2', 'Closed Mondays']);
  assert.throws(() => change({ title: '  ' }), /needs a name/);
});
test('updatePlace: nothing to change is said plainly; position and marks are kept', () => {
  assert.throws(() => change({}), /Say what to change/);
  const base = L.cleanPlace('p1', { title: 'Pier', point: { lat: 1, lng: 2 }, spaces: ['s1'], origin: 'o1', owners: ['u-bo'] });
  const p = change({ status: 'want' }, base);
  assert.deepEqual([p.point, p.spaces, p.origin, p.owners], [{ lat: 1, lng: 2 }, ['s1'], 'o1', ['u-bo']]);
});
test('updatePlace: a place\'s own icon is kept for the page to decide', () => {
  const base = L.cleanPlace('p1', { title: 'Pier', icon: 'anchor', iconOwn: true });
  const p = change({ status: 'want' }, base);
  assert.deepEqual([p.icon, p.iconOwn], ['anchor', true]);
});

test('the page passes people to addPlace and provides updatePlace', () => {
  assert.match(view, /placeFromRequest\(input, me, state\.people\)/);
  assert.match(view, /handlers\.updatePlace = /);
  assert.match(view, /placeChanged\(p, input, [^\n]*state\.people\)/);
});

const acts = Object.fromEntries(manifest.actions.provides.map((a) => [a.name, a]));
test('manifest: addPlace declares type, status and owners', () => {
  assert.equal(acts.addPlace.input.type, 'string?');
  assert.equal(acts.addPlace.input.status, 'string?');
  assert.equal(acts.addPlace.input.owners, 'text?');
});
test('manifest: updatePlace is a write on a place', () => {
  const a = acts.updatePlace;
  assert.equal(a.effect, 'write');
  assert.equal(a.input.place, 'ref:maps:place');
  for (const k of ['title', 'type', 'category', 'status', 'address', 'notes', 'owners']) assert.ok(a.input[k], k);
});
test('manifest: hints name real inputs, 200 characters or fewer; descriptions are one sentence', () => {
  for (const a of manifest.actions.provides) {
    for (const [k, v] of Object.entries(a.inputHints || {})) {
      assert.ok(k in a.input, `${a.name}.${k} is not an input`);
      assert.ok(typeof v === 'string' && v.length > 0 && v.length <= 200, `${a.name}.${k} length`);
    }
    if (a.description) assert.match(a.description, /^[^.]*\.$/, `${a.name} description`);
  }
  for (const [n, k] of [['addPlace', 'type'], ['addPlace', 'status'], ['addPlace', 'owners'], ['updatePlace', 'type'], ['updatePlace', 'status'], ['updatePlace', 'owners']]) assert.ok(acts[n].inputHints[k], `${n}.${k}`);
});

if (fails.length) { for (const f of fails) console.error(`check-maps-agent-status: ${f}`); process.exit(1); }
console.log(`check-maps-agent-status: ${passed} passed`);
