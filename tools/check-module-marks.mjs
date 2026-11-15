#!/usr/bin/env node
/*
 * check-module-marks.mjs -- the manifest marks and labels (documentation/plans/plan-templates-redesign.md, "The module
 * manifest"; step 3 of "Left to build", the server half).
 *
 * Part 1, in node:
 *   - cleanManifest: a setting's `template` mark ("driven", "default"; absent is the module's own) on every type a template
 *     may set, in every scope it may; each refusal, with its sentence: a secret, file, files, url or note marked either
 *     way, a person's setting driven, an unknown mark; `labels` (declared words, held to the word rules: no markup, no
 *     prototype key, no 10 KB word, at most 20) and `starter` (true or false, only with the "space" scope); a stored
 *     manifest edited by hand reads its labels and starter no further than the rules allow.
 *   - The settings layer (ModuleSettings with the store's own resolver): driven, given by the template, reads the
 *     template's value whatever is stored and refuses a different write (409, the sentence) at the environment's and a
 *     space's scope; the same value is left out; driven, not given, behaves as the module's own; default reads the
 *     stored value, else the template's, else the manifest's, and the owner's environment value wins in every space
 *     (decision 35); a person's default setting only seeds; null resets a default one; a hostile template (an unmarked
 *     key, a secret, a bad value, a prototype key) sets nothing; marks() says how each stands.
 *   - Labels: the template's word where the manifest declares it, else the manifest's; nothing undeclared, no markup.
 *   - The SDK, run in a node vm: host.util.label and host.locale().labels from a hello's locale.
 *
 * Part 2, the routes on a throwaway server (PORT=0, DATA_DIR under the system tmpdir, stopped by its pid; no TEMPLATE): a
 * test module uploaded as a zip, a template of the owner's that sets its marked settings and renames a label, a space
 * on it and a space on the Default template. GET /api/module-settings/:scope answers the marks (templateName only to
 * those who may change the scope); a driven write refused for the admin, an owner and a moderator (409) and a member
 * (403) through PUT /api/modules/:id/settings/:scope, nothing stored; the owner's environment value wins in every
 * space; Reset; a person's seeded value; GET /api/modules/:id/settings/values; the module context's locale.labels, fed to
 * the SDK; no template id or name reaching a module; hostile manifests refused at upload with their sentences.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

process.env.TZ = 'UTC';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { cleanManifest, ModuleError, ModuleManager } = require('../server/modules.js');
const { ModuleSettings, templateValuesFor } = require('../server/module-settings.js');
const { effectiveLabels } = require('../server/module-labels.js');
const { Store } = require('../server/store.js');
const { zipFiles } = require('../server/module-build.js');
const templates = require('../server/templates.js');

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`check-module-marks: ${name}: ${err.stack || err.message}`); }
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-module-marks-'));

// The test module: every kind of mark, an own setting and a secret, two labels, starter content.
const FILES = new Set(['module.json', 'page.html', 'canvas.html']);
const MARKS_RAW = {
  id: 'marks', name: 'Marks', version: '1.0.0', scope: ['environment', 'space'],
  surfaces: { page: { entry: 'page.html' }, canvas: { entry: 'canvas.html' } },
  settings: [
    { key: 'unit', label: 'Counts', type: 'choice', scope: 'space', template: 'driven', default: 'money', options: [{ value: 'money', label: 'Money' }, { value: 'hours', label: 'Hours' }, { value: 'effort', label: 'Effort points' }] },
    { key: 'split', label: 'Who owes whom', type: 'boolean', scope: 'space', template: 'default', default: true },
    { key: 'mode', label: 'Strict mode', type: 'boolean', scope: 'environment', template: 'driven', default: false },
    { key: 'tint', label: 'Tint', type: 'color', scope: 'environment', template: 'default', default: '#112233' },
    { key: 'cats', label: 'Categories', type: 'list', scope: 'environment', template: 'default', default: [] },
    { key: 'title', label: 'Title', type: 'text', scope: 'space', template: 'default', default: 'Plan' },
    { key: 'limit', label: 'Limit', type: 'number', scope: 'space', template: 'driven', default: 5, min: 1, max: 10 },
    { key: 'view', label: 'View', type: 'choice', scope: 'person', template: 'default', default: 'list', options: [{ value: 'list', label: 'List' }, { value: 'grid', label: 'Grid' }] },
    { key: 'own', label: 'Own switch', type: 'boolean', scope: 'space', default: false },
    { key: 'apiKey', label: 'Key', type: 'secret' },
  ],
  labels: { event: { one: 'event', many: 'events' }, step: { one: 'step', many: 'steps', a: 'a step' } },
  starter: true,
};
const manifestWith = (patch) => ({ ...structuredClone(MARKS_RAW), ...patch });
const settingWith = (def) => manifestWith({ settings: [def] });
const refused = (raw, sentence, files = FILES) => assert.throws(() => cleanManifest(raw, files), (err) => err instanceof ModuleError && err.message === sentence, `refused with: ${sentence}`);

// --- part 1: the manifest -----------------------------------------------------------------------------------------------

await test('the marks a manifest may carry, on every type a template may set, kept as written; no mark is the module\'s own', () => {
  const m = cleanManifest(structuredClone(MARKS_RAW), FILES);
  const mark = Object.fromEntries(m.settings.map((d) => [d.key, d.template ?? null]));
  assert.deepEqual(mark, { unit: 'driven', split: 'default', mode: 'driven', tint: 'default', cats: 'default', title: 'default', limit: 'driven', view: 'default', own: null, apiKey: null });
  assert.deepEqual(m.labels, { event: { one: 'event', many: 'events' }, step: { one: 'step', many: 'steps', a: 'a step' } });
  assert.equal(m.starter, true);
  const bare = cleanManifest({ ...structuredClone(MARKS_RAW), labels: undefined, starter: undefined }, FILES);
  assert.deepEqual([bare.labels, bare.starter], [{}, false], 'none declared: no labels, no starter');
});

await test('refused marks, each with its sentence', () => {
  for (const [type, extra] of [['secret', {}], ['file', { folder: 'tiles' }], ['files', { folder: 'tiles' }], ['url', {}], ['note', {}]]) {
    for (const mark of ['driven', 'default']) {
      refused(settingWith({ key: 'thing', label: 'Thing', type, ...extra, template: mark }), `module.json: setting "thing" is a ${type}, so a template can't set it.`);
    }
  }
  refused(settingWith({ key: 'view', label: 'View', type: 'boolean', scope: 'person', template: 'driven' }), 'module.json: setting "view" is each person\'s own, so a template can only seed it ("template": "default").');
  for (const bad of ['locked', 'own', true, 1, null, ['driven'], { driven: true }]) {
    refused(settingWith({ key: 'odd', label: 'Odd', type: 'boolean', template: bad }), 'module.json: setting "odd" template must be "driven" or "default"');
  }
});

await test('labels and starter: declared words only, held to the word rules; each refusal with its sentence', () => {
  // JSON.parse makes "__proto__" an own key, as a hostile module.json would.
  refused(JSON.parse(JSON.stringify(manifestWith({ labels: null })).replace('"labels":null', '"labels":{"__proto__":{"one":"x","many":"xs"}}')), 'module.json: label "__proto__" must be lowercase letters, digits and dashes, starting with a letter, up to 30 characters');
  refused(manifestWith({ labels: { constructor: { one: 'x', many: 'xs' }, Event: { one: 'x', many: 'xs' } } }), 'module.json: label "Event" must be lowercase letters, digits and dashes, starting with a letter, up to 30 characters');
  refused(manifestWith({ labels: { event: { one: 'x'.repeat(10240), many: 'xs' } } }), 'module.json: labels: The word for event can be at most 30 characters.');
  refused(manifestWith({ labels: { event: { one: '<b>x</b>', many: 'xs' } } }), 'module.json: labels: The word for event can use only letters, spaces, hyphens and apostrophes.');
  refused(manifestWith({ labels: { event: { one: 'x', many: 'xs', html: '<i>' } } }), 'module.json: labels: The word for event takes only one, many and a.');
  refused(manifestWith({ labels: { event: 'meeting' } }), 'module.json: labels: The word for event must be its singular and plural, or null to use the default.');
  refused(manifestWith({ labels: [{ one: 'x', many: 'xs' }] }), 'module.json: labels must be an object of words by key, such as { "event": { "one": "event", "many": "events" } }');
  refused(manifestWith({ labels: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`w${i}`, { one: 'x', many: 'xs' }])) }), 'module.json: labels can list at most 20 words');
  refused(manifestWith({ starter: 'yes' }), 'module.json: starter must be true or false');
  refused({ ...manifestWith({ scope: ['environment'], surfaces: { page: { entry: 'page.html' } } }), settings: [] }, 'module.json: starter needs the "space" scope, since starter content is written into a new space');
  // "constructor" is a fine label key by the rule; it stays a plain own key of the answer.
  const ok = cleanManifest(manifestWith({ labels: { constructor: { one: 'builder', many: 'builders' } } }), FILES);
  assert.deepEqual(Object.keys(ok.labels), ['constructor']);
  assert.equal(Object.getPrototypeOf(ok.labels), Object.prototype, 'the prototype is untouched');
});

await test('a stored manifest edited by hand reads its marks, labels and starter no further than the rules allow', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'stored-'));
  const d = path.join(dir, 'modules', 'marks', 'versions', '1.0.0');
  fs.mkdirSync(d, { recursive: true });
  const write = (m) => fs.writeFileSync(path.join(d, 'module.json'), JSON.stringify(m));
  write({ ...MARKS_RAW, scope: ['environment'], labels: { event: { one: '<script>', many: 'x' } } });
  let mm = new ModuleManager(dir);
  let m = mm.storedManifestOf('marks', '1.0.0');
  assert.deepEqual([m.labels, m.starter], [{}, false], 'bad labels rename nothing; no starter without the space scope');
  assert.equal(m.settings.find((x) => x.key === 'unit').template, 'driven');
  write({ ...MARKS_RAW, settings: [{ key: 'apiKey', label: 'Key', type: 'secret', template: 'driven' }] });
  mm = new ModuleManager(dir);
  m = mm.storedManifestOf('marks', '1.0.0');
  assert.deepEqual(m.settings, [], 'a secret marked for a template: no settings read at all');
});

// --- part 1: the settings layer --------------------------------------------------------------------------------------------

const MARKS = cleanManifest(structuredClone(MARKS_RAW), FILES);
const catalogWith = new Map([...templates.bundledManifests(), ['marks', MARKS]]);
function made(raw) {
  const problems = templates.problemsOf(raw, { manifests: catalogWith });
  assert.deepEqual(problems, [], `${raw.id} is a valid template`);
  return templates.cleanTemplate(raw, { manifests: catalogWith });
}
const HOURS = made({ id: 'hours', name: 'Hours', description: 'Time.', modules: { marks: { settings: { unit: 'hours', split: false, mode: true, tint: '#445566', title: 'Timesheet', view: 'grid', limit: 7 }, labels: { event: { one: 'meeting', many: 'meetings' } } }, chat: {} } });
const BARE = made({ id: 'bare', name: 'Bare', description: 'Nothing set.', modules: { marks: {}, chat: {} } });
function fresh(name, env = null) {
  const store = new Store(fs.mkdtempSync(path.join(tmp, `${name}-`)));
  const known = { hours: HOURS, bare: BARE };
  store.templateById = (id) => known[id] || templates.get(id) || null;
  store.catalogModuleIds = () => [...catalogWith.keys(), ...templates.BUILTIN_MODULE_IDS];
  if (env) templates.useLive(store, store.templateById(env));
  const settings = new ModuleSettings(fs.mkdtempSync(path.join(tmp, `${name}-m-`)));
  settings.lens = (moduleId, place) => store.moduleLens(place, moduleId);
  return { store, settings };
}
const sentence = (label, template) => `Marks's ${label} is set by the ${template} template; ask an owner to copy the template to change it.`;
const status = (fn) => { try { fn(); return 200; } catch (err) { return err.status; } };

await test('driven: the template\'s value whatever is stored; a different write refused (409) at a space\'s and the environment\'s scope; the same value left out', () => {
  const { store, settings } = fresh('driven', 'hours');
  const h = store.addSpace({ name: 'H', template: 'hours' });
  const b = store.addSpace({ name: 'B', template: 'bare' });
  const e = settings.effective(MARKS, { spaceId: h.id, userKey: 'u1' });
  assert.deepEqual([e.unit, e.limit, e.mode], ['hours', 7, true]);
  assert.throws(() => settings.set(MARKS, 'space', { spaceId: h.id }, { unit: 'money' }, 'u1'), (err) => err.status === 409 && err.message === sentence('Counts', 'Hours'));
  assert.throws(() => settings.set(MARKS, 'environment', {}, { mode: false }, 'u1'), (err) => err.status === 409 && err.message === sentence('Strict mode', 'Hours'), "the environment's own template drives it");
  assert.throws(() => settings.set(MARKS, 'space', { spaceId: h.id }, { split: false, unit: 'effort' }, 'u1'), (err) => err.status === 409, 'a save of several refused whole');
  assert.equal(settings.values(MARKS, 'space', { spaceId: h.id }).split, false, "nothing of it stored: split still the template's");
  assert.equal(settings.marks(MARKS, 'space', { spaceId: h.id }).split.stored, false);
  // The same value is left out: never stored, so it can't surface later.
  settings.set(MARKS, 'space', { spaceId: h.id }, { unit: 'hours', own: true }, 'u1');
  assert.equal(Object.hasOwn(settings.bucket('marks', 'space', { spaceId: h.id }), 'unit'), false);
  assert.equal(settings.values(MARKS, 'space', { spaceId: h.id }).own, true, 'the rest of the save kept');
  // A bad value of a driven setting is refused as driven, not as a bad value.
  assert.equal(status(() => settings.set(MARKS, 'space', { spaceId: h.id }, { limit: 99 }, 'u1')), 409);
  // Driven, not given (the bare template): the module's own, writable.
  assert.equal(settings.effective(MARKS, { spaceId: b.id }).unit, 'money');
  settings.set(MARKS, 'space', { spaceId: b.id }, { unit: 'effort' }, 'u1');
  assert.equal(settings.effective(MARKS, { spaceId: b.id }).unit, 'effort');
  // A stored value under a template that later drives it reads the template's, and is kept for when it stops.
  settings.data.spaces[h.id].marks.unit = 'effort';
  assert.equal(settings.effective(MARKS, { spaceId: h.id }).unit, 'hours');
  const m = settings.marks(MARKS, 'space', { spaceId: h.id });
  assert.deepEqual(m.unit, { template: 'driven', given: true, templateValue: 'hours', locked: true, stored: true });
  assert.deepEqual(m.own, { template: null, given: false, locked: false, stored: true });
  assert.deepEqual(settings.marks(MARKS, 'space', { spaceId: b.id }).unit, { template: 'driven', given: false, locked: false, stored: true });
});

await test('default: stored, else the template\'s, else the manifest\'s; the owner\'s environment value wins in every space; Reset; a person\'s only seeded', () => {
  const { store, settings } = fresh('default', 'bare');
  const h = store.addSpace({ name: 'H', template: 'hours' });
  const b = store.addSpace({ name: 'B' }); // the environment's: bare, which sets nothing
  assert.deepEqual([settings.effective(MARKS, { spaceId: h.id }).tint, settings.effective(MARKS, { spaceId: b.id }).tint], ['#445566', '#112233']);
  assert.equal(settings.values(MARKS, 'environment', {}).tint, '#112233', "Home reads the environment's template (bare): the manifest's");
  assert.equal(settings.marks(MARKS, 'environment', {}).tint.given, false);
  settings.set(MARKS, 'environment', {}, { tint: '#abcdef' }, 'owner');
  assert.deepEqual([settings.effective(MARKS, { spaceId: h.id }).tint, settings.effective(MARKS, { spaceId: b.id }).tint], ['#abcdef', '#abcdef'], "the owner's value wins everywhere (decision 35)");
  settings.set(MARKS, 'environment', {}, { tint: null }, 'owner');
  assert.equal(settings.effective(MARKS, { spaceId: h.id }).tint, '#445566', "Reset: the template's again");
  assert.equal(Object.hasOwn(settings.bucket('marks', 'environment', {}), 'tint'), false);
  // A space's own value wins in that space only.
  assert.deepEqual([settings.effective(MARKS, { spaceId: h.id }).split, settings.effective(MARKS, { spaceId: b.id }).split], [false, true]);
  settings.set(MARKS, 'space', { spaceId: h.id }, { split: true, title: 'Mine' }, 'mo');
  assert.deepEqual([settings.effective(MARKS, { spaceId: h.id }).split, settings.effective(MARKS, { spaceId: h.id }).title], [true, 'Mine']);
  // null is only a Reset for a default setting; an own one still takes only its own values.
  assert.equal(status(() => settings.set(MARKS, 'space', { spaceId: h.id }, { own: null }, 'mo')), 400);
  // A person's: the template seeds it, their own choice wins once made, and it is theirs alone.
  assert.equal(settings.effective(MARKS, { spaceId: h.id, userKey: 'p1' }).view, 'grid');
  assert.equal(settings.effective(MARKS, { spaceId: b.id, userKey: 'p1' }).view, 'list');
  assert.equal(settings.effective(MARKS, { spaceId: h.id }).view, 'grid', 'no one signed in: the seed');
  settings.set(MARKS, 'person', { userKey: 'p1' }, { view: 'list' }, 'p1');
  assert.equal(settings.effective(MARKS, { spaceId: h.id, userKey: 'p1' }).view, 'list');
  assert.equal(settings.effective(MARKS, { spaceId: h.id, userKey: 'p2' }).view, 'grid');
  assert.equal(Object.hasOwn(settings.bucket('marks', 'person', { userKey: 'p2' }), 'view'), false, 'a seed is never stored');
});

await test('a hostile template sets nothing a manifest does not let it: unmarked, secret, bad values, prototype keys', () => {
  const vals = templateValuesFor(MARKS, JSON.parse('{"own":true,"apiKey":"sk-123","unit":"gold","limit":99,"tint":"red","__proto__":{"polluted":1},"constructor":1,"split":false,"view":"grid"}'));
  assert.deepEqual({ ...vals }, { split: false, view: 'grid' });
  assert.equal(Object.getPrototypeOf(vals), null);
  assert.equal({}.polluted, undefined);
  // A template held before its module changed (a mark dropped, a person driven by a hand-edited manifest) still sets nothing it may not.
  const handEdited = { ...MARKS, settings: MARKS.settings.map((d) => (d.key === 'view' ? { ...d, template: 'driven' } : d.key === 'apiKey' ? { ...d, template: 'driven' } : d)) };
  assert.deepEqual({ ...templateValuesFor(handEdited, { view: 'grid', apiKey: 'x' }) }, {});
  // A secret is never read through the layer, whatever the template holds.
  const { store, settings } = fresh('hostile');
  const s = store.addSpace({ name: 'S' });
  settings.lens = () => ({ settings: { apiKey: 'stolen', own: true, unit: 'hours' }, template: 'Evil', module: 'Marks' });
  const e = settings.effective(MARKS, { spaceId: s.id });
  assert.deepEqual([e.apiKey, e.own, e.unit], [{ set: false }, false, 'hours']);
  // A lens that throws reads as no template, never as an error.
  settings.lens = () => { throw new Error('boom'); };
  const warned = [];
  const warn = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  try {
    assert.equal(settings.effective(MARKS, { spaceId: s.id }).unit, 'money');
    assert.equal(settings.effective(MARKS, { spaceId: s.id }).unit, 'money');
    settings.set(MARKS, 'space', { spaceId: s.id }, { own: true }, 'u1');
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(warned, ["The template's settings for the marks module could not be read, so none apply: boom"], 'said once for the module, however often it is read');
});

await test('labels: the template\'s word where the manifest declares it, else the manifest\'s; nothing undeclared, no markup', () => {
  assert.deepEqual(effectiveLabels(MARKS, { event: { one: 'meeting', many: 'meetings' } }), { event: { one: 'meeting', many: 'meetings', a: 'a meeting' }, step: { one: 'step', many: 'steps', a: 'a step' } });
  const hostile = JSON.parse('{"event":{"one":"<img src=x onerror=alert(1)>","many":"x"},"step":{"one":"milestone","many":"milestones","a":"a milestone"},"extra":{"one":"x","many":"y"},"__proto__":{"one":"p","many":"q"}}');
  assert.deepEqual(effectiveLabels(MARKS, hostile), { event: { one: 'event', many: 'events', a: 'an event' }, step: { one: 'milestone', many: 'milestones', a: 'a milestone' } });
  assert.deepEqual(effectiveLabels({ labels: {} }, { event: { one: 'x', many: 'y' } }), {});
  const { store } = fresh('labels', 'bare');
  const h = store.addSpace({ name: 'H', template: 'hours' });
  assert.deepEqual(store.moduleLens(h.id, 'marks').labels, { event: { one: 'meeting', many: 'meetings' } });
  assert.deepEqual(store.moduleLens(null, 'marks'), { settings: null, labels: null, template: 'Bare', module: null });
  assert.equal(store.moduleLens(h.id, '__proto__').settings, null);
});

// The SDK in a node vm: enough of a window to build a host in the page and answer its hello.
function sdkWith(hello) {
  const stub = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : stub()), apply: () => stub(), construct: () => stub() });
  const window = { Phases: {}, location: { href: 'http://x/' }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  window.parent = window;
  window.window = window;
  const document = { currentScript: null, addEventListener() {}, createElement: () => stub(), head: stub(), documentElement: stub(), querySelector: () => null, querySelectorAll: () => [] };
  const ctx = vm.createContext({ window, document, console, setTimeout, clearTimeout, URL, navigator: { userAgent: '' }, MutationObserver: function () { return { observe() {} }; }, ResizeObserver: function () { return { observe() {} }; }, getComputedStyle: () => stub(), requestAnimationFrame: (f) => setTimeout(f, 0), CSS: { escape: (s) => s } });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'sdk', 'host.js'), 'utf8'), ctx);
  return window.createHost({ call: (m) => Promise.resolve(m === 'hello' ? hello : {}), root: document, rootElement: stub() }).host;
}

await test('the SDK: host.util.label and host.locale().labels', async () => {
  const host = sdkWith({ locale: { language: 'en', clock: '12', currency: 'USD', labels: { event: { one: 'meeting', many: 'meetings', a: 'a meeting' }, step: { one: 'step', many: 'steps', a: 'a step' } } } });
  assert.equal(host.util.label('event'), 'event', 'before ready: the key');
  assert.equal(host.util.label('event', { fallback: 'Event' }), 'Event');
  await host.ready();
  assert.deepEqual([host.util.label('event'), host.util.label('event', { many: true }), host.util.label('event', { many: true, cap: true }), host.util.label('event', { a: true, cap: true })], ['meeting', 'meetings', 'Meetings', 'A meeting']);
  assert.equal(host.util.label('unknown', { fallback: 'thing' }), 'thing');
  assert.equal(host.util.label('toString'), 'toString', 'a prototype name is no label');
  assert.deepEqual(JSON.parse(JSON.stringify(host.locale().labels)).step, { one: 'step', many: 'steps', a: 'a step' });
});

// --- part 2: the routes -------------------------------------------------------------------------------------------------

function startServer(dataDir, env = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, TZ: 'UTC', PRODUCT_NAME: 'Testname', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 20000);
    const onData = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve({ port: Number(m[1]), output: () => out, stop: () => new Promise((r) => { if (child.exitCode !== null) return r(); child.once('exit', r); child.kill('SIGTERM'); }) }); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
}
function call(server, method, urlPath, { body, cookie, zip } = {}) {
  const payload = zip || (body === undefined ? null : Buffer.from(JSON.stringify(body)));
  const headers = { host: `127.0.0.1:${server.port}`, accept: 'application/json', origin: `http://127.0.0.1:${server.port}` };
  if (payload) { headers['content-type'] = zip ? 'application/zip' : 'application/json'; headers['content-length'] = payload.length; }
  if (cookie) headers.cookie = cookie;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.port, method, path: urlPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const cookieOf = (res) => [].concat(res.headers?.['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
const page = Buffer.from('<!doctype html><html><head><meta charset="utf-8"></head><body><script src="/sdk/host.js"></script></body></html>');
const zipOf = (manifest) => zipFiles([['module.json', Buffer.from(JSON.stringify(manifest))], ['page.html', page], ['canvas.html', page]]);

const servers = [];
try {
  const server = await startServer(path.join(tmp, 'single'), { ADMIN_PASSWORD: 'admin-password-1' });
  servers.push(server);
  const login = async (who, password) => {
    const r = await new Promise((resolve, reject) => {
      const body = Buffer.from(JSON.stringify({ login: who, password }));
      const req = http.request({ host: '127.0.0.1', port: server.port, method: 'POST', path: '/api/login', headers: { host: `127.0.0.1:${server.port}`, 'content-type': 'application/json', 'content-length': body.length } }, (res) => { res.resume(); res.on('end', () => resolve(res)); });
      req.on('error', reject);
      req.end(body);
    });
    const cookie = cookieOf(r);
    return (method, url, body, zip) => call(server, method, url, { cookie, body, zip });
  };
  const admin = await login('admin', 'admin-password-1');

  await test('hostile manifests are refused at upload, each with its sentence', async () => {
    for (const [raw, said] of [
      [manifestWith({ settings: [{ key: 'apiKey', label: 'Key', type: 'secret', template: 'driven' }] }), 'module.json: setting "apiKey" is a secret, so a template can\'t set it.'],
      [manifestWith({ settings: [{ key: 'view', label: 'View', type: 'boolean', scope: 'person', template: 'driven' }] }), 'module.json: setting "view" is each person\'s own, so a template can only seed it ("template": "default").'],
      [manifestWith({ settings: [{ key: 'odd', label: 'Odd', type: 'boolean', template: 'locked' }] }), 'module.json: setting "odd" template must be "driven" or "default"'],
      [manifestWith({ labels: { event: { one: 'x'.repeat(10240), many: 'xs' } } }), 'module.json: labels: The word for event can be at most 30 characters.'],
    ]) {
      const r = await admin('POST', '/api/modules', undefined, zipOf(raw));
      assert.deepEqual([r.status, r.json?.error], [400, said]);
    }
    const proto = Buffer.from(JSON.stringify(manifestWith({ labels: null })).replace('"labels":null', '"labels":{"__proto__":{"one":"x","many":"xs"}}'));
    const r = await admin('POST', '/api/modules', undefined, zipFiles([['module.json', proto], ['page.html', page], ['canvas.html', page]]));
    assert.equal(r.status, 400);
    assert.match(r.json.error, /label "__proto__" must be lowercase letters/);
    assert.equal((await admin('GET', '/api/modules')).json.modules.some((m) => m.id === 'marks'), false, 'nothing installed');
  });

  const up = await admin('POST', '/api/modules', undefined, zipOf(MARKS_RAW));
  assert.equal(up.status, 201, up.text);
  if (up.json?.module?.needsApproval) await admin('POST', '/api/modules/marks/approve', {});
  const on = await admin('PATCH', '/api/modules/marks', { enabled: true });
  assert.equal(on.status, 200, on.text);
  const makeUser = async (who, role = 'member') => {
    const r = await admin('POST', '/api/users', { login: who, displayName: who, role, password: `${who}-password-1` });
    assert.equal(r.status, 201, r.text);
    return { key: r.json.user.key, as: await login(who, `${who}-password-1`) };
  };
  const owner = await makeUser('olive', 'owner');
  const mo = await makeUser('mo');
  const mia = await makeUser('mia');
  assert.equal((await owner.as('POST', '/api/environment/templates', { from: 'default', id: 'hours', name: 'Hours' })).status, 201);
  const edit = await owner.as('PATCH', '/api/environment/templates/hours', { modules: { marks: { name: 'Timesheet', settings: { unit: 'hours', split: false, tint: '#445566', view: 'grid', limit: 7 }, labels: { event: { one: 'meeting', many: 'meetings' } } }, chat: {}, conference: {} } });
  assert.equal(edit.status, 200, edit.text);
  const hostileEdit = await owner.as('PATCH', '/api/environment/templates/hours', { modules: { marks: { settings: { own: true } }, chat: {} } });
  assert.deepEqual([hostileEdit.status, hostileEdit.json?.error], [400, 'modules.marks.settings: "own" is not a setting the Marks module lets a template set.'], 'an own setting is no template\'s');
  const h = (await admin('POST', '/api/spaces', { name: 'Ledger', members: [mo.key, mia.key], template: 'hours' })).json.space;
  const plain = (await admin('POST', '/api/spaces', { name: 'Plain', members: [mo.key, mia.key] })).json.space;
  assert.equal((await admin('PATCH', `/api/users/${mo.key}/spaces/${h.id}`, { permissions: { moderator: true } })).status, 200);
  const valuesOf = async (who, sp) => (await who('GET', `/api/modules/marks/settings/values?scope=space&space=${sp}`)).json.values;
  const form = async (who, scope, sp) => {
    const r = await who('GET', `/api/module-settings/${scope}${sp ? `?space=${sp}` : ''}`);
    assert.equal(r.status, 200, r.text);
    return Object.fromEntries(r.json.modules.find((m) => m.id === 'marks').settings.map((d) => [d.key, d]));
  };

  await test('the forms\' answer: each setting\'s mark, the template\'s value, locked, stored; the template\'s name only to those who may change it', async () => {
    const sp = await form(mo.as, 'space', h.id);
    assert.deepEqual([sp.unit.template, sp.unit.templateValue, sp.unit.locked, sp.unit.stored, sp.unit.value, sp.unit.templateName], ['driven', 'hours', true, false, 'hours', 'Hours']);
    assert.deepEqual([sp.split.template, sp.split.templateValue, sp.split.locked, sp.split.value], ['default', false, false, false]);
    assert.deepEqual([sp.own.template, 'templateValue' in sp.own, sp.own.locked], [null, false, false]);
    const pl = await form(mo.as, 'space', plain.id).catch(() => null);
    assert.equal(pl, null, 'mo is no moderator of Plain');
    const plainForm = await form(owner.as, 'space', plain.id);
    assert.deepEqual([plainForm.unit.template, plainForm.unit.locked, 'templateName' in plainForm.unit, plainForm.unit.value], ['driven', false, false, 'money'], 'the Default template gives nothing: own');
    const env = await form(owner.as, 'environment');
    assert.deepEqual([env.tint.template, env.tint.value, 'templateValue' in env.tint], ['default', '#112233', false], "the environment's template (Default) seeds nothing");
    const person = await form(mia.as, 'person');
    assert.deepEqual([person.view.template, 'templateName' in person.view], ['default', false], 'no template name on a person\'s settings');
    assert.equal((await mia.as('GET', `/api/module-settings/space?space=${h.id}`)).status, 403, 'a member reads no space settings form');
  });

  await test('a driven write is refused for the admin, an owner and a moderator (409) and a member (403); nothing is stored', async () => {
    const said = "Timesheet's Counts is set by the Hours template; ask an owner to copy the template to change it.";
    for (const who of [admin, owner.as, mo.as]) {
      const r = await who('PUT', `/api/modules/marks/settings/space?space=${h.id}`, { values: { unit: 'money' } });
      assert.deepEqual([r.status, r.json.error], [409, said]);
      const many = await who('PUT', `/api/modules/marks/settings/space?space=${h.id}`, { values: { split: true, limit: 3 } });
      assert.deepEqual([many.status, many.json.error], [409, "Timesheet's Limit is set by the Hours template; ask an owner to copy the template to change it."]);
    }
    const member = await mia.as('PUT', `/api/modules/marks/settings/space?space=${h.id}`, { values: { unit: 'money' } });
    assert.equal(member.status, 403);
    const same = await mo.as('PUT', `/api/modules/marks/settings/space?space=${h.id}`, { values: { unit: 'hours', own: true } });
    assert.equal(same.status, 200, same.text);
    const after = await form(mo.as, 'space', h.id);
    assert.deepEqual([after.unit.stored, after.unit.value, after.split.stored, after.split.value, after.own.value], [false, 'hours', false, false, true]);
    assert.equal((await valuesOf(mia.as, h.id)).unit, 'hours');
    // In the Default template's space the same setting is the module's own.
    assert.equal((await owner.as('PUT', `/api/modules/marks/settings/space?space=${plain.id}`, { values: { unit: 'effort' } })).status, 200);
    assert.equal((await valuesOf(mia.as, plain.id)).unit, 'effort');
  });

  await test('default: the template seeds, the owner\'s environment value wins in every space, Reset, a person\'s seed', async () => {
    assert.deepEqual([(await valuesOf(mia.as, h.id)).tint, (await valuesOf(mia.as, plain.id)).tint], ['#445566', '#112233']);
    assert.equal((await owner.as('PUT', '/api/modules/marks/settings/environment', { values: { tint: '#abcdef' } })).status, 200);
    assert.deepEqual([(await valuesOf(mia.as, h.id)).tint, (await valuesOf(mia.as, plain.id)).tint], ['#abcdef', '#abcdef']);
    assert.equal((await owner.as('PUT', '/api/modules/marks/settings/environment', { values: { tint: null } })).status, 200);
    assert.equal((await valuesOf(mia.as, h.id)).tint, '#445566', "Reset: the template's again");
    assert.equal((await mo.as('PUT', `/api/modules/marks/settings/space?space=${h.id}`, { values: { split: true } })).status, 200);
    assert.equal((await valuesOf(mia.as, h.id)).split, true, "the space's own value wins there");
    assert.equal((await mo.as('PUT', `/api/modules/marks/settings/space?space=${h.id}`, { values: { split: null } })).status, 200);
    assert.equal((await valuesOf(mia.as, h.id)).split, false);
    assert.deepEqual([(await valuesOf(mia.as, h.id)).view, (await valuesOf(mia.as, plain.id)).view], ['grid', 'list'], "a person's seed follows the space's template");
    assert.equal((await mia.as('PUT', '/api/modules/marks/settings/person', { values: { view: 'list' } })).status, 200);
    assert.equal((await valuesOf(mia.as, h.id)).view, 'list', 'their own choice wins once made');
    assert.equal((await valuesOf(mo.as, h.id)).view, 'grid', "and is theirs alone");
  });

  await test('labels reach the module context and the SDK; no template id or name reaches a module', async () => {
    const ctx = await mia.as('GET', `/api/modules/marks/context?scope=space&space=${h.id}`);
    assert.equal(ctx.status, 200, ctx.text);
    assert.deepEqual(ctx.json.locale.labels, { event: { one: 'meeting', many: 'meetings', a: 'a meeting' }, step: { one: 'step', many: 'steps', a: 'a step' } });
    assert.equal(/"template"|Hours/.test(ctx.text), false, 'no template id or name in the context');
    const plainCtx = await mia.as('GET', `/api/modules/marks/context?scope=space&space=${plain.id}`);
    assert.deepEqual(plainCtx.json.locale.labels.event, { one: 'event', many: 'events', a: 'an event' });
    const envCtx = await owner.as('GET', '/api/modules/marks/context');
    assert.equal(envCtx.json.locale.labels.event.one, 'event', "the environment's page: the environment's template");
    const values = await mia.as('GET', `/api/modules/marks/settings/values?scope=space&space=${h.id}`);
    assert.equal(/Hours|"template"|templateValue|locked/.test(values.text), false, 'host.settings.get() keeps its shape');
    // module-host.js hands the context's locale to the SDK's hello as it is.
    assert.match(fs.readFileSync(path.join(ROOT, 'public', 'module-host.js'), 'utf8'), /locale: contextInfo\.locale \|\|/);
    const host = sdkWith({ locale: ctx.json.locale });
    await host.ready();
    assert.equal(host.util.label('event', { many: true, cap: true }), 'Meetings');
  });
} finally {
  for (const s of servers) await s.stop().catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failed ? `check-module-marks: ${failed} failed` : `check-module-marks: ${n} checks passed`);
process.exit(failed ? 1 : 0);
