#!/usr/bin/env node
/*
 * check-maps-actions.mjs -- Maps' actions library (src/maps-lib-actions.js; plan-agent-server-actions.md, step 10) run the two
 * ways it is carried out (tools/module-actions-harness.mjs): through the server's runner, as for an agent, and through the SDK's
 * page adapter, as for anyone else. Both must give the same answer. Checked: addPlace by address with the place search the
 * server does first (ctx.lookups): one clear match sets the position, several leave it without one and list them, none says
 * so, the search off says so; where it is kept (`in`), an environment place always marked for this space; a place for the
 * person refused for an agent with the server's sentence, and made on the page only for the person's own request;
 * updatePlace and setPlacePoint on this space's places and on the environment's marked for it, with its other marks kept; a
 * place not marked here is not there; a link to what it was made from; findPlace's note; nothing left for a page.
 * Usage: node modules/maps/test/check-maps-actions.mjs. Exits 1 on any failure.
 */
import assert from 'node:assert/strict';
import { both, onPage } from '../../../tools/module-actions-harness.mjs';

let passed = 0;
const fails = [];
async function test(name, fn) { try { await fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }

const SPACE = 's1';
const world = (extra = {}) => ({ space: { id: SPACE, name: 'Camp' }, people: [{ key: 'agent1', name: 'Claude (agent)' }, { key: 'u-ann', name: 'Ann' }], settings: { searchProvider: 'photon', categories: [] }, rows: {}, ...extra });
const hit = (title, sub, lat, lng, key) => ({ title, sub, lat, lng, key });
// Both ways, the same answer, as the server carries it (carrier 'server').
async function same(action, input, w, o = {}) {
  const r = await both('maps', action, input, w, { name: 'Maps', kinds: ['place'], carrier: 'server', ...o });
  assert.deepEqual(r.page, r.runner, `${action}: the page and the server agree`);
  return r.runner;
}
const place = (title, extra = {}) => ({ title, category: 'food', address: '', notes: '', owners: [], by: 'u-ann', ...extra });
const envRef = (id) => ({ module: 'maps', kind: 'place', id, scope: 'environment' });
const spaceRef = (id) => ({ module: 'maps', kind: 'place', id, scope: 'space', space: SPACE });

await test('addPlace by address: one clear match (all within 60 m of the first) sets the position, everyone\'s and marked here', async () => {
  const r = await same('addPlace', { title: 'Cafe', address: 'Rua Augusta 1, Lisboa' }, world({ geocode: [hit('Cafe A', 'Lisboa', 38.71, -9.13, 'osm:1'), hit('Cafe A', 'Lisboa', 38.71003, -9.13003, 'osm:2')] }));
  assert.equal(r.writes.length, 1);
  const w = r.writes[0];
  assert.equal(w.scope, 'environment');
  assert.deepEqual(w.value.point, { lat: 38.71, lng: -9.13 });
  assert.deepEqual(w.value.spaces, [SPACE], 'marked for the request\'s space');
  assert.equal(w.value.origin, 'osm:1');
  assert.deepEqual(r.ref, envRef(w.key.slice('place:'.length)));
  assert.match(r.data.note, /^Placed at Cafe A, Lisboa: 38\.71, -9\.13\.$/);
});
await test('addPlace by address: several matches leave it without a position, and the note and data list them', async () => {
  const r = await same('addPlace', { title: 'Cafe', address: 'Main Street 1' }, world({ geocode: [hit('Main Street 1', 'Springfield, Ohio', 39.9, -83.8, 'a'), hit('Main Street 1', 'Springfield, Illinois', 39.8, -89.6, 'b')] }));
  assert.equal(r.writes[0].value.point, undefined, 'no position');
  assert.match(r.data.note, /^Saved without a position: the address matches more than one place\. Give one with setPlacePoint\. 1\. Main Street 1, Springfield, Ohio: 39\.9, -83\.8 2\. /);
  assert.equal(r.data.results.length, 2);
});
await test('addPlace by address: no match leaves it without a pin and says so; the search off says so', async () => {
  const none = await same('addPlace', { title: 'Cafe', address: 'Nowhere 9' }, world({ geocode: [] }));
  assert.equal(none.writes[0].value.point, undefined);
  assert.equal(none.data.note, 'Saved without a position: found nothing for "Nowhere 9". Give one with setPlacePoint.');
  const off = await same('addPlace', { title: 'Cafe', address: 'Nowhere 9' }, world({ settings: { searchProvider: 'none' }, geocode: [hit('Never', '', 1, 2, 'x')] }));
  assert.equal(off.writes[0].value.point, undefined, 'nothing is taken from a search that is off');
  assert.equal(off.data.note, 'Saved without a position, since place search is off. An admin chooses one in the Maps settings.');
  const picture = await same('addPlace', { title: 'Cafe', address: 'Nowhere 9' }, world({ settings: { searchProvider: 'photon', imageMap: 'world.pmtiles' }, geocode: [hit('Never', '', 1, 2, 'x')] }));
  assert.equal(picture.writes[0].value.point, undefined, 'a picture map has no outside search');
});
await test('addPlace with a position takes it, whatever the search says', async () => {
  const r = await same('addPlace', { title: 'Cafe', lat: 10, lng: 20, address: 'Main Street 1' }, world({ geocode: [hit('Elsewhere', '', 1, 2, 'x')] }));
  assert.deepEqual(r.writes[0].value.point, { lat: 10, lng: 20 });
  assert.equal(r.data, undefined, 'no note');
});
await test('addPlace `in`: space keeps it in this space; environment is marked here; two spaces are refused', async () => {
  const sp = await same('addPlace', { title: 'Here', in: 'space' }, world());
  assert.equal(sp.writes[0].scope, undefined, 'a space write');
  assert.equal(sp.writes[0].value.spaces, undefined, 'no marks on a space\'s place');
  assert.deepEqual(sp.ref, spaceRef('n1'));
  const env = await same('addPlace', { title: 'All', in: 'environment' }, world());
  assert.deepEqual(env.writes[0].value.spaces, [SPACE], 'an environment place made here shows here');
  const bad = await same('addPlace', { title: 'X', in: 'nowhere' }, world());
  assert.match(bad.refused, /^in takes environment, space or person/);
});
await test('a place for the person: refused for an agent with the server\'s sentence, both ways; made on the page for the person\'s own', async () => {
  const sentence = 'An agent has no places of its own; save it for this space or for everyone.';
  for (const where of ['person', 'environment person', 'space person']) {
    const r = await both('maps', 'addPlace', { title: 'Mine', in: where }, world(), { name: 'Maps', kinds: ['place'], carrier: 'server' });
    assert.deepEqual(r.page, { refused: sentence, status: 403 }, `page, in: ${where}`);
    assert.deepEqual(r.runner, { refused: sentence, status: 403 }, `server, in: ${where}`);
  }
  const own = await onPage('maps', 'addPlace', { title: 'Mine', in: 'environment person' }, world(), { name: 'Maps', asker: 'self' });
  assert.deepEqual(own.writes.map((w) => [w.scope, w.key]), [['environment', 'place:n1'], ['person', 'saved:e:n1']], 'the place, and the bookmark in the person\'s own list');
  const mine = await onPage('maps', 'addPlace', { title: 'Mine', in: 'person' }, world(), { name: 'Maps', asker: 'self' });
  assert.deepEqual(mine.ref, { module: 'maps', kind: 'place', id: 'n1', scope: 'person' });
});
await test('updatePlace and setPlacePoint: the environment\'s place marked here, its other marks kept; one not marked here is not there', async () => {
  const shared = { 'place:p1': place('Shared', { spaces: [SPACE, 's2'] }), 'place:p2': place('Elsewhere', { spaces: ['s2'] }) };
  const up = await same('updatePlace', { place: envRef('p1'), title: 'Renamed', status: 'want' }, world({ shared }));
  assert.equal(up.writes[0].scope, 'environment');
  assert.equal(up.writes[0].value.title, 'Renamed');
  assert.deepEqual(up.writes[0].value.spaces, [SPACE, 's2'], 'the other space\'s mark is kept');
  assert.equal(up.writes[0].value.by, 'agent1', 'the asker changed it');
  const pt = await same('setPlacePoint', { place: envRef('p1'), lat: 1.1234567, lng: 2 }, world({ shared }));
  assert.deepEqual(pt.writes[0].value.point, { lat: 1.123457, lng: 2 });
  const gone = await same('updatePlace', { place: envRef('p2'), title: 'No' }, world({ shared }));
  assert.equal(gone.refused, 'there is no such place, or it is no longer shared here');
  const space = await same('setPlacePoint', { place: spaceRef('q1'), lat: 5, lng: 6 }, world({ rows: { 'place:q1': place('Ours') } }));
  assert.equal(space.writes[0].scope, undefined);
  assert.deepEqual(space.ref, spaceRef('q1'));
  const far = await same('setPlacePoint', { place: spaceRef('q1'), lat: 95, lng: 6 }, world({ rows: { 'place:q1': place('Ours') } }));
  assert.equal(far.refused, 'the coordinates are out of range');
});
await test('a forward is followed to where the place is now', async () => {
  const r = await same('updatePlace', { place: spaceRef('m1'), notes: 'moved' }, world({ rows: { 'place:m1': { title: 'Moved', movedTo: { scope: 'environment' } } }, shared: { 'place:m1': place('Moved', { spaces: [SPACE] }) } }));
  assert.equal(r.writes[0].scope, 'environment');
  assert.deepEqual(r.ref, envRef('m1'));
});
await test('what it was made from: linked for this space\'s place; an environment place says it is not linked', async () => {
  const from = { module: 'calendar', kind: 'event', id: 'e1', scope: 'space', space: SPACE };
  const sp = await same('addPlace', { title: 'Dinner', in: 'space', ref: from }, world());
  assert.deepEqual(sp.effects.links, [{ op: 'add', from: spaceRef('n1'), to: from }]);
  const env = await same('addPlace', { title: 'Dinner', ref: from }, world());
  assert.deepEqual(env.effects.links, []);
  assert.equal(env.data.note, 'It is not linked to what it was made from, since it is kept for everyone.');
});
await test('findPlace: the matches as the note, nothing written; the search off refuses and nothing is taken', async () => {
  const r = await same('findPlace', { q: 'Rua Augusta' }, world({ geocode: [hit('Cafe A', 'Lisboa', 38.71, -9.13, 'k')] }));
  assert.deepEqual(r.writes, []);
  assert.equal(r.data.note, '1. Cafe A, Lisboa: 38.71, -9.13');
  const off = await same('findPlace', { q: 'Rua Augusta' }, world({ settings: { searchProvider: 'none' }, geocode: [hit('Cafe A', 'Lisboa', 38.71, -9.13, 'k')] }));
  assert.equal(off.refused, 'Place search is off. An admin chooses one in the Maps settings.');
  const short = await same('findPlace', { q: 'R' }, world());
  assert.equal(short.refused, 'nothing to look for');
});
await test('nothing is left for a page: no answer of the server\'s says it waits', async () => {
  const r = await same('addPlace', { title: 'Cafe', address: 'Main Street 1' }, world({ geocode: [hit('A', '', 1, 2, 'a')] }));
  assert.ok(!/page|open the|waits/i.test(JSON.stringify(r.data || {})), JSON.stringify(r.data));
});

if (fails.length) {
  console.error(`check-maps-actions: ${fails.length} failed\n${fails.map((f) => `  ${f}`).join('\n')}`);
  process.exit(1);
}
console.log(`check-maps-actions: ${passed} ok`);
