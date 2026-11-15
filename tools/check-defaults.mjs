#!/usr/bin/env node
/*
 * check-defaults.mjs -- the fixed core reactions and icons (GitHub #169, server/default-lists.js; plan-templates-redesign.md,
 * decision 12): the curated sets themselves; a fresh store's own lists are empty (the core is never stored: lookOf reads it);
 * a stored list that repeats the core is trimmed to the owner's own additions, single and hosted alike; a template only adds;
 * and every default icon draws from the Font Awesome Free this server ships. check-reactions-icons.mjs covers the routes.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
process.env.PRODUCT_NAME = 'Testname';
const lists = require('../server/default-lists.js');
const { Store, cleanReactions } = require('../server/store.js');
const { buildEnvironment } = require('../server/environment.js');
const templates = require('../server/templates.js');
const { bundledModules } = require('../server/module-build.js');

const { DEFAULT_REACTION_LIST, DEFAULT_ICON_LIST } = lists;
const FA = path.dirname(require.resolve('@fortawesome/fontawesome-free/package.json'));
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-defaults-'));
let n = 0;
let failed = 0;
const test = (name, fn) => {
  try { fn(); n += 1; } catch (err) { failed += 1; console.error(`check-defaults: ${name}: ${err.stack || err.message}`); }
};
const quiet = () => {};
let dirs = 0;
// An environment folder holding `settings` (and nothing else of note) as an app.json.
function oldEnvironment(settings) {
  const dir = path.join(base, `env-${(dirs += 1)}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'app.json'), JSON.stringify({ settings: { iconsSeeded: true, ...settings } }));
  return dir;
}
const stored = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8')).settings;
const clone = (v) => structuredClone(v);

test('the curated lists themselves', () => {
  assert.equal(DEFAULT_REACTION_LIST.length, 105, '105 reactions');
  assert.equal(DEFAULT_ICON_LIST.length, 113, '113 icons');
  assert.deepEqual(DEFAULT_REACTION_LIST.slice(0, 6).map((r) => r.label), ['Heart', 'Black Heart', '100%', 'Hi', 'Thumbs up', 'Thumbs down'], 'the 1-6 shortcuts');
  const byId = Object.fromEntries(DEFAULT_REACTION_LIST.map((r) => [r.id, r.label]));
  assert.deepEqual([byId.alligator, byId.avocado, byId['santa-claus'], byId['mrs-claus'], byId.hen, byId.rooster, byId.chicken],
    ['Alligator', 'Avocado', 'Santa Claus', 'Mrs. Claus', 'Hen', 'Rooster', 'Chicken'], 'the spellings and the two chickens');
  for (const r of DEFAULT_REACTION_LIST) assert.ok(!/^r[a-z0-9]{6}$/.test(r.id) || r.id === 'rooster', `no made-up id: ${r.id}`);
  assert.equal(new Set(DEFAULT_REACTION_LIST.map((r) => r.id)).size, 105, 'reaction ids are unique');
  assert.equal(new Set(DEFAULT_ICON_LIST.map((i) => i.id)).size, 113, 'icon ids are unique (no repeats)');
  // Each survives the store's own cleaning unchanged: the field shapes and id rules hold.
  assert.deepEqual(cleanReactions(clone(DEFAULT_REACTION_LIST)), DEFAULT_REACTION_LIST, 'cleanReactions keeps every reaction as it is');
  const dice = DEFAULT_ICON_LIST.find((i) => i.id === 'dice-d20');
  assert.deepEqual(dice, { id: 'dice-d20', classes: 'fa-solid fa-dice-d20', label: 'dice d20' }, 'an icon entry');
  assert.deepEqual(DEFAULT_ICON_LIST.find((i) => i.id === 'xbox'), { id: 'xbox', classes: 'fa-brands fa-xbox', label: 'xbox' }, 'a brands entry');
});

test('every default icon draws from the bundled Font Awesome Free', () => {
  const css = fs.readFileSync(path.join(FA, 'css', 'all.css'), 'utf8');
  for (const icon of DEFAULT_ICON_LIST) {
    const [style, name] = icon.classes.split(' ').map((c) => c.slice(3));
    assert.ok(['solid', 'brands'].includes(style), `${icon.id}: solid or brands`);
    assert.ok(fs.existsSync(path.join(FA, 'svgs', style, `${name}.svg`)), `${icon.id}: svgs/${style}/${name}.svg ships`);
    assert.ok(css.includes(`.fa-${name} {`), `${icon.id}: all.css draws .fa-${name}`);
  }
});

test('a fresh store keeps none of the core in its settings; lookOf reads all of it', () => {
  const dir = path.join(base, 'fresh');
  const store = new Store(dir);
  assert.deepEqual([store.settings.reactions, store.settings.icons], [[], []], 'the owner\'s own additions: none yet');
  const look = store.lookOf(null);
  assert.deepEqual(look.reactions, DEFAULT_REACTION_LIST);
  assert.deepEqual(look.icons, DEFAULT_ICON_LIST);
  const s = stored(dir);
  assert.deepEqual([s.reactions, s.icons], [[], []], 'and saved so');
  assert.equal(s.reactionsCuratedSeeded, undefined, 'no once-only flags: nothing is moved from an older list');
});

test('a stored list that repeats the core is trimmed to the owner\'s own additions', () => {
  const dir = oldEnvironment({
    reactions: [...clone(DEFAULT_REACTION_LIST), { id: 'yes', glyph: '✅', label: 'Yes' }, { id: 'again', glyph: DEFAULT_REACTION_LIST[0].glyph, label: 'Heart twice' }],
    icons: [...clone(DEFAULT_ICON_LIST), { id: 'dragon-x', classes: 'fa-solid fa-dragon', label: 'dragon x' }],
  });
  const store = new Store(dir);
  assert.deepEqual(store.settings.reactions, [{ id: 'yes', glyph: '✅', label: 'Yes' }]);
  assert.deepEqual(store.settings.icons, [{ id: 'dragon-x', classes: 'fa-solid fa-dragon', label: 'dragon x' }]);
  assert.deepEqual(stored(dir).reactions, [{ id: 'yes', glyph: '✅', label: 'Yes' }], 'saved trimmed');
  const look = store.lookOf(null);
  assert.deepEqual(look.reactions.slice(0, 105), DEFAULT_REACTION_LIST, 'the core first, whole');
  assert.deepEqual(look.reactions.slice(105).map((r) => r.id), ['yes']);
  // An owner's save that leaves the core out, or repeats it, changes none of it.
  store.updateSettings({ reactions: [], icons: clone(DEFAULT_ICON_LIST.slice(0, 3)) });
  assert.deepEqual([store.settings.reactions, store.settings.icons], [[], []]);
  assert.equal(store.lookOf(null).reactions.length, 105);
  assert.equal(store.lookOf(null).icons.length, 113);
});

test('a hosted install: each environment\'s store keeps its own additions', () => {
  const a = buildEnvironment(oldEnvironment({ reactions: [{ id: 'yes', glyph: '✅', label: 'Yes' }] }), { slug: 'one', log: quiet });
  const b = buildEnvironment(oldEnvironment({}), { slug: 'two', log: quiet });
  try {
    assert.deepEqual(a.store.lookOf(null).reactions.map((r) => r.id).slice(-1), ['yes']);
    assert.equal(b.store.lookOf(null).reactions.length, 105, 'the other environment never reads them');
  } finally {
    for (const env of [a, b]) env.close?.();
  }
});

// plan-templates-redesign.md, decision 12: the core reactions and icons are fixed; a template only adds to them.
test('a template only adds reactions and icons: a repeat of the core set is refused', () => {
  const travel = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'travel.json'), 'utf8'));
  const problems = (patch) => templates.problemsOf({ ...travel, ...patch }, { file: 'travel.json' });
  const core = clone(DEFAULT_REACTION_LIST).slice(0, 2);
  assert.deepEqual(problems({ reactions: core }), core.map((r, i) => `reactions[${i}]: ${r.glyph} is in the core set already; a template only adds.`));
  const solid = DEFAULT_ICON_LIST.filter((i) => i.classes.startsWith('fa-solid ')).map((i) => i.id).slice(0, 1);
  assert.deepEqual(problems({ iconSet: solid }), [`iconSet: "${solid[0]}" is in the core set already; a template only adds.`]);
  assert.deepEqual(problems({ reactions: [{ id: 'die', glyph: '\u{1f3b2}', label: 'Die' }] }), [], 'an addition is accepted');
});

fs.rmSync(base, { recursive: true, force: true });
if (failed) {
  console.error(`check-defaults: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-defaults: ${n} passed`);
