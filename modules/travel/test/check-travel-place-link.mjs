#!/usr/bin/env node
/*
 * check-travel-place-link.mjs -- an agent puts a stop at a saved Maps place: addStop and acceptSuggestion's `placeRef`, and
 * setStopPlace for a stop already on the plan, against the plan with a small stand-in for the SDK. The stop then holds the
 * pointer, the place's title and its address (as the editor's Pick from Maps sets them), and tells the host what it points at
 * (setLinks, which is what the Maps side reads as "used by"). Exits 1 on any failure.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const src = new URL('../src/', import.meta.url);
const read = (n) => fs.readFileSync(new URL(n, src), 'utf8');
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const lib = new Function('ymd', 'parseYmd', `${read('travel-lib.js')}\n${read('travel-lib-actions.js')}\n${read('travel-lib-object.js')}\n${read('travel-lib-plan.js')}\nreturn { createPlan };`)(ymd, parseYmd);
// The SDK's page adapter for an actions library (host.actions.fromLibrary), which the stand-in host hands the plan.
let sdkActions;
const hostText = (() => {
  const win = { addEventListener() {}, location: { search: '' } };
  win.parent = win;
  new Function('window', 'document', fs.readFileSync(new URL('../../../public/sdk/host.js', import.meta.url), 'utf8'))(win, { createElement: (tag) => ({ tag }) });
  sdkActions = win.hostActions;
  return win.hostText;
})();

const place = (id, scope = 'environment') => ({ module: 'maps', kind: 'place', id, scope });
// The places this person may see, by id; any other does not resolve (as a place an agent may not see does not).
const SEEN = { winery: { title: 'Castello Winery', subtitle: '4045 St Helena Hwy, Calistoga' }, cafe: { title: 'Oakville Grocery', subtitle: '' } };

const store = new Map();
const links = new Map();
const provided = {};
let clock = 0;
const objectKey = (r) => [r.module, r.kind, r.id, r.scope, r.space || ''].join('|');
const host = {
  user: { key: 'u1', name: 'Ann' },
  phases: () => [],
  space: () => null,
  phasesCover: async () => null,
  util: { id: () => 'id' + (++clock), objectKey, ymd, parseYmd, word: (k) => k, plain: hostText.plain, localWhen: hostText.localWhen, phaseTimeline: () => [], phaseWords: () => '' },
  storage: {
    get: async (key) => (store.has(key) ? { key, ...store.get(key) } : null),
    list: async (prefix) => [...store].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, ...v })),
    set: async (key, value) => { const version = (store.has(key) ? store.get(key).version : 0) + 1; store.set(key, { value, version }); return { key, value, version }; },
    delete: async (key) => { store.delete(key); },
  },
  on() {},
  objects: {
    resolve: async (refs) => refs.map((r) => (r.module === 'maps' && SEEN[r.id] ? { ref: r, ...SEEN[r.id] } : { error: 'unavailable' })),
    search: async () => [],
    make: (kind, id) => ({ module: 'travel', kind, id, scope: 'space' }),
    setLinks: async (from, to) => { links.set(from.id, to.map(objectKey)); },
  },
  files: { link: async () => {}, unlink: async () => {} },
  ui: { toast() {} },
  actions: {
      // As the SDK: provide hands each handler who asked (here the page's own person) and fromLibrary is the real adapter.
      provide: (h) => { for (const [k, fn] of Object.entries(h)) provided[k] = (input, c) => fn(input, c || { from: 'test', by: 'Ann', byKey: 'u1', credit: { name: 'Ann', key: 'u1' } }); },
      fromLibrary: (h, o) => sdkActions.fromLibrary(host, h, { ...o, module: () => ({ id: 'travel', name: 'Planner - Itinerary' }) }),
    },
};

const plan = lib.createPlan(host);
await plan.load();
await plan.saveTrip({ title: 'Napa', start: '2026-10-01', end: '2026-10-03' });
plan.provide();
const { addStop, acceptSuggestion, setStopPlace } = provided;
const find = (title) => plan.list().find((i) => i.title === title);
const refused = (fn, words) => assert.rejects(fn, (e) => new RegExp(words, 'i').test(e.message));
const tick = () => new Promise((r) => setTimeout(r, 0));

// addStop with a place: pointer, title and address as the picker sets them, and the host told
await addStop({ title: 'Tasting', date: '2026-10-01', placeRef: place('winery') });
{
  const s = find('Tasting');
  assert.equal(s.kind, 'stop');
  assert.equal(objectKey(s.placeRef), objectKey(place('winery')));
  assert.equal(s.place, 'Castello Winery');
  assert.equal(s.address, '4045 St Helena Hwy, Calistoga');
  await tick();
  assert.deepEqual(links.get(s.id), [objectKey(place('winery'))], 'the plan told the host what the stop points at (the place shows it)');
  // read back: the plan's own list carries the stop with its place
  assert.ok(plan.list().some((i) => i.id === s.id && i.placeRef && i.place === 'Castello Winery'));
}
// the stop's own address stays; a place with no address leaves it empty
await addStop({ title: 'Lunch', date: '2026-10-01', placeRef: place('cafe') });
assert.equal(find('Lunch').address, ''); assert.equal(find('Lunch').place, 'Oakville Grocery');
await acceptSuggestion({ title: 'Dinner', kind: 'restaurant', date: '2026-10-01', place: 'typed name', placeRef: place('winery') });
assert.equal(find('Dinner').type, 'restaurant'); assert.equal(find('Dinner').place, 'Castello Winery', "the place's title replaces a typed name, as the picker does");
await acceptSuggestion({ object: { kind: 'restaurant', title: 'Brunch', date: '2026-10-02', content: 'x' }, title: 'Brunch', placeRef: place('cafe') });
assert.equal(objectKey(find('Brunch').placeRef), objectKey(place('cafe')), 'an object handed in can be at a place too');
// no place given: as before
await addStop({ title: 'Plain', date: '2026-10-01' });
assert.equal(find('Plain').placeRef, null);

// refusals add nothing
const before = plan.list().length;
await refused(() => addStop({ title: 'x', placeRef: { module: 'todo', kind: 'task', id: 't1', scope: 'space', space: 's' } }), 'not a place saved in Maps');
await refused(() => addStop({ title: 'x', placeRef: place('secret') }), "can't be found, or you can't see it");
await refused(() => addStop({ title: 'x', placeRef: place('winery', 'person') }), 'private to one person');
await refused(() => addStop({ title: 'x', ref: place('winery'), placeRef: place('winery') }), 'not both');
await refused(() => acceptSuggestion({ title: 'x', kind: 'hotel', placeRef: place('winery') }), 'Only a stop');
await refused(() => acceptSuggestion({ title: 'x', kind: 'flight', placeRef: place('winery') }), 'Only a stop');
assert.equal(plan.list().length, before);

// setStopPlace: a stop already on the plan
const stop = find('Plain');
const stopRef = { module: 'travel', kind: 'plan', id: stop.id, scope: 'space' };
await setStopPlace({ stop: stopRef, placeRef: place('winery') });
assert.equal(objectKey(find('Plain').placeRef), objectKey(place('winery')));
assert.equal(find('Plain').place, 'Castello Winery'); assert.equal(find('Plain').address, '4045 St Helena Hwy, Calistoga');
await tick();
assert.deepEqual(links.get(stop.id), [objectKey(place('winery'))]);
// another place replaces it; an address already there stays
await plan.updateItem(stop.id, { address: 'My own address' });
await setStopPlace({ stop: stopRef, placeRef: place('cafe') });
assert.equal(find('Plain').place, 'Oakville Grocery'); assert.equal(find('Plain').address, 'My own address');
await tick();
assert.deepEqual(links.get(stop.id), [objectKey(place('cafe'))]);
// cleared: the pointer goes, the name stays, the host is told
await setStopPlace({ stop: stopRef });
assert.equal(find('Plain').placeRef, null); assert.equal(find('Plain').place, 'Oakville Grocery');
await tick();
assert.deepEqual(links.get(stop.id), []);
// refusals
await refused(() => setStopPlace({ stop: stopRef, placeRef: place('secret') }), "can't be found, or you can't see it");
await refused(() => setStopPlace({ stop: stopRef, placeRef: { module: 'travel', kind: 'plan', id: 'x', scope: 'space' } }), 'not a place saved in Maps');
await refused(() => setStopPlace({ stop: { ...stopRef, id: 'nope' }, placeRef: place('winery') }), "isn't on the itinerary");
const flight = await acceptSuggestion({ title: 'Fly', kind: 'flight', date: '2026-10-01' });
await refused(() => setStopPlace({ stop: flight.ref ? { ...stopRef, id: flight.ref.id } : stopRef, placeRef: place('winery') }), 'Only a stop');
assert.equal(find('Plain').placeRef, null, 'a refused change leaves the stop as it was');

// the manifest: the inputs are Maps place pointers, hints are short, the action count is within the limit
{
  const m = JSON.parse(fs.readFileSync(new URL('../module.json', import.meta.url), 'utf8'));
  const act = (n) => m.actions.provides.find((a) => a.name === n);
  assert.equal(act('addStop').input.placeRef, 'ref:maps:place?');
  assert.equal(act('acceptSuggestion').input.placeRef, 'ref:maps:place?');
  assert.deepEqual(act('setStopPlace').input, { stop: 'ref:travel:plan', placeRef: 'ref:maps:place?' });
  for (const n of ['addStop', 'acceptSuggestion', 'setStopPlace']) for (const [k, h] of Object.entries(act(n).inputHints || {})) assert.ok(h.length <= 200, `${n}.${k} hint is ${h.length}`);
  assert.ok(m.actions.provides.length <= 16);
}

console.log('check-travel-place-link: ok');
