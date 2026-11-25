#!/usr/bin/env node
/*
 * check-maps-find-position.mjs -- a saved place with an address and no position (Maps issue 1077): the "Find on map" control,
 * the agent's findPlace action (src/maps-lib-actions.js; its runs both ways are in check-maps-actions.mjs) and the quiet search when the list opens. Runs the list model (src/maps-lib-f-list-model.js) on
 * its own, reads the page's wiring (src/maps-lib-g-list-view.js), the markup and the manifest. No page, no host, no network.
 * Usage: node modules/maps/test/check-maps-find-position.mjs. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const geo = {
  oneLine: (t, n) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, n),
  inRange: (a, b) => Math.abs(a) <= 90 && Math.abs(b) <= 180,
  round6: (x) => Math.round(x * 1e6) / 1e6,
};
const L = new Function('geo', 'LIB_TYPES', 'word', `${read('src/maps-lib-f-list-model.js')}\nreturn listModel(geo, LIB_TYPES, word);`)(geo, JSON.parse(read('src/maps-lib-types.json')), (k) => k);
const manifest = JSON.parse(read('module.json'));
const view = read('src/maps-lib-g-list-view.js');
const html = read('src/maps.html');

let passed = 0;
const fails = [];
function test(name, fn) { try { fn(); passed += 1; } catch (err) { fails.push(`${name}: ${err.message}`); } }

const hit = (name, address, lat, lng) => ({ name, address, lat, lng });

test('findNote: nothing found says so, with what was asked', () => {
  assert.equal(L.findNote('1575 park crest', []), 'Found nothing for "1575 park crest".');
});
test('findNote: each match has a name, an address and a position, in order', () => {
  const note = L.findNote('q', [hit('Park Crest Court 1575', 'San Jose, California', 37.2810, -121.8899), hit('Park Crest', 'Austin, Texas', 30.1, -97.7)]);
  assert.equal(note, '1. Park Crest Court 1575, San Jose, California: 37.281, -121.8899 2. Park Crest, Austin, Texas: 30.1, -97.7');
});
test('findNote: fits what request_status keeps (300), dropping whole matches but never the first', () => {
  const long = (i) => hit(`A long place name number ${i} that goes on`, 'A long street address, a city, a region, a country, and more', 12.345678, -123.456789);
  const note = L.findNote('q', [long(1), long(2), long(3), long(4), long(5)]);
  assert.ok(note.length <= 300, `${note.length} long`);
  assert.ok(note.startsWith('1. ') && !note.includes('5. '), note);
  const huge = L.findNote('q', [hit('x'.repeat(400), '', 1, 2)]);
  assert.equal(huge.length, 300);
});
test('oneClear: one result, or results within 60 m of the first, are one match; far ones are not', () => {
  assert.deepEqual(L.oneClear([{ lat: 37.2810, lng: -121.8899 }]), { lat: 37.2810, lng: -121.8899 });
  assert.ok(L.oneClear([{ lat: 37.2810, lng: -121.8899 }, { lat: 37.28105, lng: -121.88995 }]));
  assert.equal(L.oneClear([{ lat: 37.2810, lng: -121.8899 }, { lat: 37.30, lng: -121.9 }]), null);
  assert.equal(L.oneClear([]), null);
});

test('the manifest declares findPlace for an agent: a write, not local, one input q, with a hint', () => {
  const a = manifest.actions.provides.find((x) => x.name === 'findPlace');
  assert.ok(a, 'findPlace is declared');
  assert.ok(!a.local && !a.askerOnly && a.ai !== false && a.effect === 'write' && a.description, 'the agent gate lets it through');
  assert.deepEqual(Object.keys(a.input), ['q']);
  assert.equal(a.input.q, 'string');
  assert.ok(a.inputHints.q);
  assert.ok(a.description.length <= 200);
});
test('findPlace is the actions library\'s, its search the server\'s before the run (lookups), and the page carries it through the same library', () => {
  const a = manifest.actions.provides.find((x) => x.name === 'findPlace');
  assert.deepEqual(a.lookups, { q: 'geocode' }, 'the server searches q before the handler');
  const lib = read('src/maps-lib-actions.js');
  const body = lib.slice(lib.indexOf('  findPlace(input, ctx) {'));
  assert.ok(body.indexOf('mapsActionSearchOn(') < body.indexOf('ctx.lookups'), 'the check that search is off comes first');
  assert.ok(body.includes('M.findNote('), 'the matches come as the note an agent reads');
  assert.ok(view.includes("...library(['findPlace'])"), 'the page carries it through the library, in a space or not');
  assert.ok(!view.includes('findPlace: async'), 'no second copy on the page');
});

test('the row offers Find on map only for an address with no position, where search is on and the person may change it', () => {
  assert.ok(html.includes('data-action="find-on-map"'), 'the button is in the place template');
  assert.ok(/data-slot="find-on-map"[^>]*hidden/.test(html), 'hidden until the script shows it');
  assert.ok(view.includes("hide(slot(el, 'find-on-map'), !(w !== 'saved' && !p.point && p.address && state.search && writable(w)))"));
});
test('Find on map lists the matches and the person picks one: nothing is set on its own', () => {
  const find = view.slice(view.indexOf('function findOnMap('), view.indexOf('async function usePosition('));
  assert.ok(find.includes('showFound(q, promise, { w, id })') && !find.includes('setPoint'), 'it only shows the matches');
  const use = view.slice(view.indexOf('async function usePosition('), view.indexOf('const TRIED_KEY'));
  assert.ok(use.includes('stores[w].setPoint(id, { lat: h.lat, lng: h.lng })'), 'the picked match sets the position');
  assert.ok(view.includes("$('found').dataset.for && ev.target.closest('[data-action=\"save-found\"]')) usePosition("), 'the result button picks, it does not save a new place');
  assert.ok(view.includes("'Use this position'"));
});

test('the quiet search: once, a few at most, one clear match only, every outcome remembered, never on a picture map', () => {
  const auto = view.slice(view.indexOf('async function autoFind('), view.indexOf('// A click on a result shows it on the map'));
  assert.ok(auto.includes('if (!state.search || state.autoDone) return;') && auto.includes('state.autoDone = true;'), 'once, only with search on');
  assert.ok(auto.includes('AUTO_MAX') && auto.includes('setTimeout(r, 1500)'), 'a few, a moment apart');
  assert.ok(auto.includes('!e.p.point && e.p.address && tried[`${e.w}/${e.p.id}`] !== e.p.address'), 'a remembered address is not searched again');
  assert.ok(auto.indexOf('rememberTried(tried)') < auto.indexOf('await searchFor('), 'the miss is remembered before the search can fail');
  assert.ok(auto.includes('oneClear(found)') && auto.includes('if (!first) continue;'), 'several matches are left alone');
  assert.ok(auto.includes('writable(e.w)'), 'only where the person may change places');
  assert.ok(view.includes('state.search = searchOn(v) && !onPicture()'), 'a picture map has no outside search');
  assert.ok(view.includes('setTimeout(() => autoFind().catch(() => {}), 2500)'), 'started after the list is drawn');
});

if (fails.length) {
  console.error(`check-maps-find-position: ${fails.length} failed\n${fails.map((f) => `  ${f}`).join('\n')}`);
  process.exit(1);
}
console.log(`check-maps-find-position: ${passed} ok`);
