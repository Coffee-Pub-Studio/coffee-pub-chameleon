/*
 * check-maps-find.mjs -- what an agent can find a saved place by (Thomas, 2026-11-21): the place kind's summary names the
 * stored fields an agent's search reads (title, address, category, type, status as `visit`, and `spaces`, the marks that say
 * which spaces an everyone place shows in). The search itself is checked live in tools/check-mcp.mjs.
 *
 * Usage: node modules/maps/test/check-maps-find.mjs. Exits 1 on any failure.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const manifest = JSON.parse(fs.readFileSync(new URL('../module.json', import.meta.url), 'utf8'));
const place = manifest.refs.produces.find((p) => p.kind === 'place');
try {
  assert.ok(place, 'Maps shares places');
  assert.equal(place.key, 'place:{id}');
  assert.deepEqual(
    ['title', 'subtitle', 'category', 'type', 'visit', 'spaces'].map((f) => place.summary[f]),
    ['title', 'address', 'category', 'type', 'status', 'spaces'],
    'the summary reads the stored fields an agent searches by',
  );
  assert.ok(manifest.actions.provides.find((a) => a.name === 'updatePlace').input.place === 'ref:maps:place', 'updatePlace takes the place pointer');
} catch (err) {
  console.error(`check-maps-find: ${err.message}`);
  process.exit(1);
}
console.log('check-maps-find: ok');
