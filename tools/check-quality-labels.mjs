#!/usr/bin/env node
/* check-quality-labels.mjs -- the three video quality selects (space.html #quality, profile.html #cp-quality, admin.html
 * #set-max-quality) carry the values of QUALITY_OPTIONS (server/store.js) and the same words, decided by Thomas 2026-11-19. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { QUALITY_OPTIONS } = createRequire(import.meta.url)('../server/store.js');
const WORDS = { 360: '360p (Weak network)', 540: '540p (Slow network)', 720: '720p (Normal network - Recommended)', 1080: '1080p (Fast network)' };
const SELECTS = [['space.html', 'quality'], ['profile.html', 'cp-quality'], ['admin.html', 'set-max-quality']];
for (const [file, id] of SELECTS) {
  const html = fs.readFileSync(path.join(ROOT, 'public', file), 'utf8');
  const m = html.match(new RegExp(`<select id="${id}">(.*?)</select>`, 's'));
  assert.ok(m, `${file}: #${id} exists`);
  const opts = [...m[1].matchAll(/<option value="(\d+)"[^>]*>([^<]*)<\/option>/g)].map((o) => [Number(o[1]), o[2]]);
  assert.deepEqual(opts.map((o) => o[0]), QUALITY_OPTIONS, `${file}: values match QUALITY_OPTIONS`);
  for (const [v, text] of opts) assert.equal(text, WORDS[v], `${file}: label for ${v}`);
}
console.log('check-quality-labels: 3 selects ok');
