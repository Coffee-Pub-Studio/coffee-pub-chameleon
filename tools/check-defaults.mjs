#!/usr/bin/env node
/*
 * check-defaults.mjs -- the built-in reactions and icons (GitHub #169, server/default-lists.js; plan-templates-redesign.md,
 * decision 12 as corrected 2026-11-16): the curated sets themselves, as starting content only. A fresh store's lists are
 * filled from them once (builtinListsSeeded) and are its own from then on; an environment stored before the correction
 * (its lists never filled) gets the built-in lists once, its old additions not carried over; a filled list is kept as
 * stored (a built-in removed stays removed, a repeat inside it is dropped) and survives a reload; an owner's save may
 * remove any entry, and resetLists puts the built-in set back; single and hosted alike; a template's repeat of the
 * built-in set is no longer refused; and every built-in icon draws from the Font Awesome Free this server ships.
 * check-reactions-icons.mjs covers the routes.
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

test('a fresh store\'s lists are the built-in set, filled once and marked; lookOf reads them', () => {
  const dir = path.join(base, 'fresh');
  const store = new Store(dir);
  assert.deepEqual([store.settings.reactions, store.settings.icons], [DEFAULT_REACTION_LIST, DEFAULT_ICON_LIST], 'the environment\'s whole lists');
  const look = store.lookOf(null);
  assert.deepEqual(look.reactions, DEFAULT_REACTION_LIST);
  assert.deepEqual(look.icons, DEFAULT_ICON_LIST);
  const s = stored(dir);
  assert.deepEqual([s.reactions, s.icons, s.builtinListsSeeded], [DEFAULT_REACTION_LIST, DEFAULT_ICON_LIST, true], 'and saved so');
  // Copies: changing the store's lists changes nothing of the built-in ones (they are frozen as well).
  store.settings.reactions[0].glyph = 'x';
  assert.equal(DEFAULT_REACTION_LIST[0].glyph, '❤️');
});

test('an environment stored before the correction gets the built-in lists once; its old additions are not carried over', () => {
  const dir = oldEnvironment({
    reactions: [{ id: 'yes', glyph: '✅', label: 'Yes' }],
    icons: [{ id: 'dragon-x', classes: 'fa-solid fa-dragon', label: 'dragon x' }],
  });
  const store = new Store(dir);
  assert.deepEqual([store.settings.reactions, store.settings.icons], [DEFAULT_REACTION_LIST, DEFAULT_ICON_LIST]);
  assert.deepEqual([stored(dir).reactions, stored(dir).icons, stored(dir).builtinListsSeeded], [DEFAULT_REACTION_LIST, DEFAULT_ICON_LIST, true], 'saved filled and marked');
  // From then on the lists are the environment's: an owner's save that removes built-in ones stays as saved, after a reload too.
  store.updateSettings({ reactions: [{ id: 'yes', glyph: '✅', label: 'Yes' }, ...clone(DEFAULT_REACTION_LIST.slice(4))], icons: [] });
  const again = new Store(dir);
  assert.deepEqual(again.settings.reactions.map((r) => r.id).slice(0, 3), ['yes', 'up', 'down'], 'not filled again');
  assert.deepEqual(again.settings.icons, [], 'an empty list is kept');
  assert.equal(again.lookOf(null).reactions.length, 102);
});

test('a filled list is kept as stored: cleaned for shape, a repeat inside it dropped, a built-in removed stays removed', () => {
  const dir = oldEnvironment({
    builtinListsSeeded: true,
    reactions: [{ id: 'yes', glyph: '✅', label: 'Yes' }, { id: 'again', glyph: '✅', label: 'Tick twice' }, { id: 'yes', glyph: '\u{1F197}', label: 'Yes twice' }, clone(DEFAULT_REACTION_LIST[3]), { glyph: '' }],
    icons: [{ id: 'dragon-x', classes: 'fa-solid fa-dragon', label: 'dragon x' }, { id: 'dragon-x', classes: 'fa-solid fa-cat', label: 'cat' }, { id: 'bad', classes: 'spin evil' }],
  });
  const store = new Store(dir);
  assert.deepEqual(store.settings.reactions, [{ id: 'yes', glyph: '✅', label: 'Yes' }, DEFAULT_REACTION_LIST[3]]);
  assert.deepEqual(store.settings.icons, [{ id: 'dragon-x', classes: 'fa-solid fa-dragon', label: 'dragon x' }]);
  assert.deepEqual(stored(dir).reactions, store.settings.reactions, 'saved cleaned');
  assert.deepEqual(store.lookOf(null).reactions.map((r) => r.id), ['yes', 'hi'], 'nothing of the built-in set comes back');
  // resetLists: the built-in set again.
  store.updateSettings({ resetLists: true });
  assert.deepEqual([store.settings.reactions, store.settings.icons], [DEFAULT_REACTION_LIST, DEFAULT_ICON_LIST]);
});

test('a hosted install: each environment\'s store keeps its own lists', () => {
  const a = buildEnvironment(oldEnvironment({ builtinListsSeeded: true, reactions: [{ id: 'yes', glyph: '✅', label: 'Yes' }] }), { slug: 'one', log: quiet });
  const b = buildEnvironment(oldEnvironment({}), { slug: 'two', log: quiet });
  try {
    assert.deepEqual(a.store.lookOf(null).reactions.map((r) => r.id), ['yes']);
    assert.deepEqual(b.store.lookOf(null).reactions, DEFAULT_REACTION_LIST, 'the other environment starts from the built-in set');
  } finally {
    for (const env of [a, b]) env.close?.();
  }
});

// plan-templates-redesign.md, decision 12 as corrected: a template only adds, and a repeat of an environment's entry is
// dropped where the lists are joined, never refused (a template does not know which environment reads it).
test('a template\'s additions that repeat the built-in set are not refused', () => {
  const travel = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'travel.json'), 'utf8'));
  const problems = (patch) => templates.problemsOf({ ...travel, ...patch }, { file: 'travel.json' });
  assert.deepEqual(problems({ reactions: clone(DEFAULT_REACTION_LIST).slice(0, 2) }), []);
  const solid = DEFAULT_ICON_LIST.filter((i) => i.classes.startsWith('fa-solid ')).map((i) => i.id).slice(0, 1);
  assert.deepEqual(problems({ iconSet: solid }), []);
  assert.deepEqual(problems({ reactions: [{ id: 'die', glyph: '\u{1f3b2}', label: 'Die' }] }), [], 'an addition is accepted');
});

fs.rmSync(base, { recursive: true, force: true });
if (failed) {
  console.error(`check-defaults: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-defaults: ${n} passed`);
