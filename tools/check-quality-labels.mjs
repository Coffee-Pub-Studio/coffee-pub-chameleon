#!/usr/bin/env node
/* check-quality-labels.mjs -- the three video quality selects and the two screen share selects (space.html #quality, profile.html #cp-quality, admin.html
 * #set-max-quality) carry the values of QUALITY_OPTIONS (server/store.js) and the same words, decided by Thomas 2026-11-19. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { QUALITY_OPTIONS, SCREEN_QUALITY_OPTIONS } = createRequire(import.meta.url)('../server/store.js');
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

// The two screen share selects (space.html #screen-quality, profile.html #cp-screen-quality) carry SCREEN_QUALITY_OPTIONS and the same words.
const SCREEN_WORDS = { '720p5': '720p, 5 fps (Weak network)', '720p15': '720p, 15 fps (Slow network)', '1080p15': '1080p, 15 fps (Normal network - Recommended)', '1080p30': '1080p, 30 fps (Fast network)' };
for (const [file, id] of [['space.html', 'screen-quality'], ['profile.html', 'cp-screen-quality']]) {
  const html = fs.readFileSync(path.join(ROOT, 'public', file), 'utf8');
  const m = html.match(new RegExp(`<select id="${id}">(.*?)</select>`, 's'));
  assert.ok(m, `${file}: #${id} exists`);
  const opts = [...m[1].matchAll(/<option value="([^"]+)"[^>]*>([^<]*)<\/option>/g)].map((o) => [o[1], o[2]]);
  assert.deepEqual(opts.map((o) => o[0]), SCREEN_QUALITY_OPTIONS, `${file}: values match SCREEN_QUALITY_OPTIONS`);
  for (const [v, text] of opts) assert.equal(text, SCREEN_WORDS[v], `${file}: label for ${v}`);
}
// space.js asks for each option something.
const js = fs.readFileSync(path.join(ROOT, 'public', 'space.js'), 'utf8');
for (const v of SCREEN_QUALITY_OPTIONS) assert.ok(js.includes(`'${v}': {`), `space.js: SCREEN_QUALITIES has ${v}`);
console.log('check-quality-labels: 3 video selects and 2 screen share selects ok');
