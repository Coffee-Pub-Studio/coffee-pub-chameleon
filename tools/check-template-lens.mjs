#!/usr/bin/env node
/*
 * check-template-lens.mjs -- the resolver per space (documentation/plans/plan-templates-redesign.md, "Resolution per space";
 * step 2 of "Left to build").
 *
 * Part 1, the store and the module manager in node: which template a place reads (a space's own, else the environment's,
 * else the Default template; the Lobby, Home and an unknown id the environment's; an aside its origin's), never two
 * templates mixed; the words (only space and member move, every locked word reads the default); the module set ("*" the
 * whole catalog; a list only its own) and ModuleManager#onInSpace following it (enabled, offered, the Lobby's rule); module
 * names and icons; labels and settings carried as stored, ready for the manifest marks of step 3; reactions and icons
 * (the fixed core set, then the template's additions, nothing removed); phases, the measure, the call and the workspace
 * as stored; a template id that no longer exists reading the environment's; the off switch; prototype keys; and the memo
 * of templates by id never outliving an edit (a save, the host's templates, the installed modules, a new lookup).
 *
 * Part 2, the routes on a throwaway server (PORT=0, DATA_DIR under the system tmpdir, stopped by its pid; no TEMPLATE, so
 * the environment reads the Default template): two spaces on different templates list different modules, names and
 * icons (GET /api/modules/for-space, the module context), and read different reactions and icons (GET /api/spaces/:id/look);
 * a module the template leaves out answers there as a module that is not on (its data and context refused); a member, a
 * moderator, the owner, a link guest, a door guest and an outsider (who reads what an unknown id reads); the Default
 * template offering every module; Home (nav, widgets) following the environment's template; the AI refused in a space
 * whose template leaves out the AI Assistant; an edit of a template read at once; a deleted template falling back.
 *
 * Part 3, hosted (BASE_DOMAIN): one environment's own template is never read, offered or named by another.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

process.env.TZ = 'UTC';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { Store } = require('../server/store.js');
const { ModuleManager } = require('../server/modules.js');
const templates = require('../server/templates.js');
const { DEFAULT_REACTION_LIST, DEFAULT_ICON_LIST } = require('../server/default-lists.js');
const CORE_ICONS = DEFAULT_ICON_LIST.map((i) => i.id);

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`check-template-lens: ${name}: ${err.stack || err.message}`); }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-template-lens-'));
const manifests = templates.bundledManifests();
const CATALOG = [...manifests.keys(), ...templates.BUILTIN_MODULE_IDS];

// A template checked and cleaned as every template is (problemsOf must answer []), against `with` (extra manifests by id).
function made(raw, withManifests = null) {
  const all = new Map([...manifests, ...(withManifests || [])]);
  const problems = templates.problemsOf(raw, { manifests: all });
  assert.deepEqual(problems, [], `${raw.id} is a valid template`);
  return templates.cleanTemplate(raw, { manifests: all });
}
// Two templates of our own, beside the bundled ones: one with additions, one lean (no AI Assistant, no Maps).
const PROJECT_RAW = {
  id: 'project', name: 'Project', description: 'A project.',
  words: { space: { one: 'project', many: 'projects' } },
  modules: { travel: { name: 'Project plan', icon: 'diagram-project' }, maps: {}, budget: { name: 'Effort' }, assistant: {}, chat: {}, conference: {} },
  call: { joinOnEntry: false, position: 'left', layout: 'strip' },
  workspace: { opensWith: ['travel', 'chat'], show: ['calendar'], opensFirst: 'workspace' },
  phases: [{ id: 'start', label: 'Start' }, { id: 'build', label: 'Build', main: true }],
  phaseMeasure: 'progress',
  reactions: [{ id: 'ship', glyph: '\u{1F680}', label: 'Ship it' }],
  iconSet: ['diagram-project'],
};
const PROJECT = made(PROJECT_RAW);
const LEAN = made({ id: 'lean', name: 'Lean', description: 'Only the plan.', modules: { travel: { name: 'Plan' }, chat: {} } });

const fresh = (name, { env = 'default', extra = {} } = {}) => {
  const store = new Store(fs.mkdtempSync(path.join(tmp, `${name}-`)));
  const known = { project: PROJECT, lean: LEAN, ...extra };
  store.templateById = (id) => known[id] || templates.get(id) || null;
  store.catalogModuleIds = () => [...CATALOG];
  if (env) templates.useLive(store, store.templateById(env));
  return store;
};

// --- part 1: the store ---------------------------------------------------------------------------------------------------

await test('the Default template: every module in the catalog, the core reactions and icons, nothing added, as before', () => {
  const store = fresh('default');
  const a = store.addSpace({ name: 'A' });
  const look = store.lookOf(a.id);
  assert.equal(look.template, null);
  assert.deepEqual(look.modules, CATALOG, '"*" reads as the whole catalog');
  for (const id of [...CATALOG, 'anything-installed-later']) assert.equal(store.moduleOffered(a.id, id), true, id);
  assert.deepEqual(look.reactions, DEFAULT_REACTION_LIST);
  assert.deepEqual(look.icons, DEFAULT_ICON_LIST);
  assert.deepEqual([look.phases, look.phaseMeasure, look.call, look.labels, look.settings], [[], 'dates', { joinOnEntry: false, position: 'top', layout: 'grid' }, {}, {}]);
  assert.deepEqual(look.words, store.resolvedWords());
  // A Store with no template at all (useLive never run) reads the same: every module offered.
  const bare = fresh('bare', { env: null });
  const b = bare.addSpace({ name: 'B' });
  assert.equal(bare.moduleOffered(b.id, 'maps'), true);
  assert.deepEqual(bare.lookOf(b.id).modules, CATALOG);
});

await test('two spaces on two templates: different module sets, names, icons, reactions and icons; nothing mixed from the environment', () => {
  const store = fresh('two', { env: 'games' });
  const p = store.addSpace({ name: 'Bridge', template: 'project' });
  const g = store.addSpace({ name: 'Plain' }); // reads the environment's: games
  const lp = store.lookOf(p.id);
  const lg = store.lookOf(g.id);
  assert.equal(lp.template, 'project');
  assert.equal(lg.template, null);
  assert.deepEqual(lp.modules, ['travel', 'maps', 'budget', 'assistant', 'chat', 'conference'], "the project template's own, in its order");
  assert.deepEqual(lg.modules, Object.keys(templates.get('games').modules), "games' own");
  assert.equal(store.moduleOffered(p.id, 'maps'), true);
  assert.equal(store.moduleOffered(g.id, 'whiteboard'), false, 'games leaves the Whiteboard out');
  assert.equal(store.moduleOffered(p.id, 'calendar'), false, 'the project template leaves Calendar out, though games has it');
  assert.deepEqual(lp.names.travel, { name: 'Project plan', icon: 'diagram-project' });
  assert.deepEqual(lg.names.schedule, { name: 'Campaign', icon: lg.names.schedule.icon });
  assert.deepEqual(lp.names.budget, { name: 'Effort', icon: null });
  assert.deepEqual(lp.names.maps, { name: null, icon: null }, "unnamed: the manifest's own, never the environment template's");
  assert.equal('calendar' in lp.names, false, 'only modules the template offers are named');
  assert.equal(lp.words.space.one, 'project');
  assert.equal(lp.words.member.one, 'member', "the project template has no member word: the default, not games' player");
  assert.equal(lg.words.member.one, 'player');
  assert.deepEqual(lp.reactions.slice(0, DEFAULT_REACTION_LIST.length), DEFAULT_REACTION_LIST, 'the core set first, whole');
  assert.deepEqual(lp.reactions.slice(DEFAULT_REACTION_LIST.length), [{ id: 'ship', glyph: '\u{1F680}', label: 'Ship it' }]);
  assert.deepEqual(lg.reactions, DEFAULT_REACTION_LIST, 'games adds none');
  assert.deepEqual(lp.icons.at(-1), { id: 'diagram-project', classes: 'fa-solid fa-diagram-project', label: 'diagram project' });
  assert.equal(lp.icons.length, CORE_ICONS.length + 1);
  assert.equal(lg.icons.length, CORE_ICONS.length);
  assert.deepEqual(lp.phases.map((x) => x.id), ['start', 'build']);
  assert.equal(lp.phaseMeasure, 'progress');
  assert.deepEqual(lp.call, { joinOnEntry: false, position: 'left', layout: 'strip' }, 'the call as stored');
  assert.deepEqual(lp.workspace, { opensWith: ['travel', 'chat'], show: ['calendar'], opensFirst: 'workspace' }, 'the workspace as stored');
  assert.deepEqual([lg.call, lg.workspace.opensWith], [{ joinOnEntry: false, position: 'top', layout: 'grid' }, ['chat', 'calendar']]);
  // The answer is the reader's own: changing it changes nothing stored or read again.
  lp.modules.push('calendar');
  lp.names.travel.name = 'Changed';
  lp.reactions.length = 0;
  assert.equal(store.lookOf(p.id).modules.includes('calendar'), false);
  assert.equal(store.lookOf(p.id).names.travel.name, 'Project plan');
  assert.equal(store.lookOf(p.id).reactions.length, DEFAULT_REACTION_LIST.length + 1);
  assert.equal(PROJECT.reactions.length, 1);
});

await test('labels and settings are carried as the template stores them, ready for the manifest marks (step 3)', () => {
  const extra = new Map([['notes', { id: 'notes', name: 'Notes', version: '1.0.0', scope: ['space'], labels: { note: { one: 'note', many: 'notes' } }, settings: [{ key: 'tone', label: 'Tone', type: 'choice', scope: 'space', template: 'driven', default: 'calm', options: [{ value: 'calm', label: 'Calm' }, { value: 'loud', label: 'Loud' }] }] }]]);
  const marked = made({ id: 'marked', name: 'Marked', description: 'Labels.', modules: { notes: { labels: { note: { one: 'memo', many: 'memos' } }, settings: { tone: 'loud' } }, chat: {} } }, extra);
  const store = fresh('marked', { extra: { marked } });
  store.catalogModuleIds = () => [...CATALOG, 'notes'];
  const s = store.addSpace({ name: 'M', template: 'marked' });
  const look = store.lookOf(s.id);
  assert.deepEqual(look.labels, { notes: { note: { one: 'memo', many: 'memos' } } });
  assert.deepEqual(look.settings, { notes: { tone: 'loud' } });
  // Today no bundled manifest declares any, so a bundled template carries none.
  assert.deepEqual([store.lookOf(store.addSpace({ name: 'P', template: 'project' }).id).labels, store.lookOf(null).settings], [{}, {}]);
  // A module the catalog does not have is not listed, and has no labels or settings in the answer.
  store.catalogModuleIds = () => [...CATALOG];
  assert.deepEqual(store.lookOf(s.id).modules, ['chat']);
  assert.deepEqual([store.lookOf(s.id).labels, store.lookOf(s.id).settings], [{}, {}]);
});

await test('locked words read the defaults in every space; Home, the Lobby, no space and an unknown id read the environment', () => {
  const store = fresh('words', { env: 'games' });
  const p = store.addSpace({ name: 'P', template: 'project' });
  const look = store.lookOf(p.id);
  for (const k of ['environment', 'aside', 'canvas', 'module', 'object', 'owner', 'moderator', 'guest', 'host', 'admin']) {
    assert.equal(look.words[k].one, k, `${k} is locked`);
  }
  assert.equal(look.words.home.many, 'Campaigns', 'home is the environment\'s');
  assert.deepEqual(look.verbs, { enter: 'Enter', layout: 'Layout' });
  for (const id of [null, 'lobby', 'nosuchspace', '__proto__', 'constructor', '']) {
    const l = store.lookOf(id);
    assert.equal(l.template, null, String(id));
    assert.deepEqual(l.modules, Object.keys(templates.get('games').modules), String(id));
    assert.equal(l.words.space.one, 'campaign', String(id));
  }
  store.data.spaces.find((r) => r.id === 'lobby').template = 'project';
  assert.equal(store.moduleOffered('lobby', 'whiteboard'), false, 'the Lobby never reads a template of its own');
  assert.equal(store.moduleOffered(null, 'whiteboard'), false, "Home reads the environment's (games has no Whiteboard)");
});

await test('a template id that no longer exists, the off switch, and an aside', () => {
  const store = fresh('fallback', { env: 'lean' });
  const p = store.addSpace({ name: 'P', template: 'project' });
  assert.equal(store.moduleOffered(p.id, 'maps'), true);
  const warned = [];
  const was = console.warn;
  console.warn = (m) => warned.push(String(m));
  try {
    store.data.spaces.find((r) => r.id === p.id).template = 'gone';
    assert.equal(store.moduleOffered(p.id, 'maps'), false, "a deleted template: the environment's (lean)");
    assert.deepEqual(store.lookOf(p.id).modules, ['travel', 'chat']);
    assert.equal(store.lookOf(p.id).template, null);
    assert.equal(store.lookOf(p.id).names.travel.name, 'Plan');
  } finally { console.warn = was; }
  assert.equal(warned.filter((m) => m.includes('"gone"')).length, 1);
  store.data.spaces.find((r) => r.id === p.id).template = 'project';
  store.updateSettings({ spaceTemplates: false });
  assert.equal(store.moduleOffered(p.id, 'maps'), false, "the switch off: the environment's");
  assert.equal(store.lookOf(p.id).template, null);
  store.updateSettings({ spaceTemplates: true });
  assert.equal(store.moduleOffered(p.id, 'maps'), true);
  // An aside reads its origin space's template, words and names; its phases stay the environment's (it has none).
  const aside = store.addAside([], p.id);
  const la = store.lookOf(aside.id);
  assert.deepEqual([la.template, la.words.space.one, la.modules.includes('maps'), la.names.travel.name], ['project', 'project', true, 'Project plan']);
  assert.deepEqual(la.phases, store.templatePhases ?? []);
  assert.equal(la.reactions.at(-1).id, 'ship', "the origin's additions");
  const orphan = store.addAside([], 'gone1234');
  assert.deepEqual(store.lookOf(orphan.id).modules, ['travel', 'chat'], 'its origin gone: the environment');
  // Another store's space id is no space here.
  const other = fresh('other');
  const o = other.addSpace({ name: 'O', template: 'project' });
  assert.equal(store.moduleOffered(o.id, 'maps'), false, "another environment's space id reads this environment's template");
});

await test('prototype keys and odd values never reach a prototype or count as a module', () => {
  const store = fresh('proto', { env: 'lean' });
  const p = store.addSpace({ name: 'P', template: 'project' });
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', '', null, undefined, 7, {}, []]) {
    assert.equal(store.moduleOffered(p.id, id), false, `module ${String(id)}`);
    assert.equal(store.moduleOffered(null, id), false, `module ${String(id)}, Home`);
  }
  for (const id of ['__proto__', 'constructor', 'toString']) {
    const d = store.moduleDisplay(id, p.id);
    assert.deepEqual([d.name, d.icon, d.templateName], [null, null, null], id);
  }
  // A Default environment offers any real module id, but still never a non-string.
  const def = fresh('proto-default');
  assert.equal(def.moduleOffered(null, '__proto__'), true, 'under "*" any id is offered; the catalog decides it exists');
  assert.equal(def.moduleOffered(null, {}), false);
  const look = store.lookOf(p.id);
  for (const k of ['names', 'labels', 'settings']) assert.equal(Object.hasOwn(look[k], '__proto__'), false, k);
  // A catalog with a key that is no module id (a hand-edited registry): never a key of the answer.
  def.catalogModuleIds = () => [...CATALOG, '__proto__', 'constructor ', 'A'];
  const odd = def.lookOf(null);
  assert.deepEqual(odd.modules, CATALOG);
  assert.equal(Object.getPrototypeOf(odd.names), Object.prototype, "the answer's prototype is untouched");
  // The phases handed out are a copy: changing them changes no template.
  const ph = store.lookOf(p.id).phases;
  ph.push({ id: 'x', label: 'X' });
  ph[0].label = 'Changed';
  assert.deepEqual(PROJECT.phases.map((x) => x.label), ['Start', 'Build']);
  assert.equal({}.polluted, undefined);
});

await test('the memo of templates by id never outlives an edit: a save, the host\'s templates, the modules, a new lookup', () => {
  const live = new Map([['project', PROJECT]]);
  const store = fresh('memo', { env: 'lean' });
  store.templateById = (id) => live.get(id) || null;
  let host = 0;
  store.lensStamp = () => `h${host}`;
  const p = store.addSpace({ name: 'P', template: 'project' });
  let asked = 0;
  const counting = store.templateById;
  store.templateById = (id) => { asked += 1; return counting(id); };
  for (let i = 0; i < 50; i += 1) store.moduleOffered(p.id, 'maps');
  assert.equal(asked, 1, 'fifty asks, one lookup');
  // An edit through the host's templates (lensStamp): read on the very next ask.
  live.set('project', made({ ...PROJECT_RAW, modules: { travel: {}, chat: {} }, workspace: undefined }));
  assert.equal(store.moduleOffered(p.id, 'maps'), true, 'not yet told');
  host += 1;
  assert.equal(store.moduleOffered(p.id, 'maps'), false, 'told: read at once');
  // An edit saved in this environment (an owner's own template): every save is a new read.
  live.set('project', PROJECT);
  store.updateSettings({ allowReactions: true });
  assert.equal(store.moduleOffered(p.id, 'maps'), true, 'after a save');
  // A new lookup altogether.
  store.templateById = () => LEAN;
  assert.equal(store.moduleOffered(p.id, 'maps'), false, 'a new lookup is read at once');
});

await test("the environment's own template is read live from the catalog too, not only from the last useLive", () => {
  const live = new Map([['project', PROJECT]]);
  const store = fresh('env-live', { env: null });
  store.templateById = (id) => live.get(id) || null;
  let host = 0;
  store.lensStamp = () => `h${host}`;
  store.recordTemplate({ id: 'project', appliedAt: null, skipped: [] });
  templates.useLive(store, PROJECT);
  assert.equal(store.moduleOffered(null, 'maps'), true);
  live.set('project', made({ ...PROJECT_RAW, modules: { travel: {}, chat: {} }, workspace: undefined }));
  host += 1; // the host's templates changed; nothing called useLive
  assert.equal(store.moduleOffered(null, 'maps'), false, 'the edit is read at once');
  assert.equal(store.moduleOffered('lobby', 'maps'), false);
  live.delete('project');
  host += 1;
  assert.equal(store.moduleOffered(null, 'maps'), true, 'gone from the catalog: the last live template (here the project as it was)');
  templates.useLive(store, templates.defaultTemplate());
  assert.equal(store.moduleOffered(null, 'calendar'), true, 'the Default template, as useTemplate sets it for a missing one');
});

await test('ModuleManager#onInSpace: enabled, offered by the template the space reads, and the Lobby\'s rule; the one check', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'mm-'));
  const put = (id, lobby) => {
    const d = path.join(dir, 'modules', id, 'versions', '1.0.0');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'module.json'), JSON.stringify({ id, name: id, version: '1.0.0', scope: ['space'], surfaces: { canvas: { entry: 'canvas.html', ...(lobby ? { lobby: true } : {}) } } }));
  };
  put('travel', false);
  put('maps', false);
  put('calendar', true);
  const entry = (id, enabled = true) => ({ id, versions: ['1.0.0'], version: '1.0.0', enabled, approved: { permissions: [], hooks: [], refs: [], events: [], actions: [] }, source: 'upload' });
  fs.writeFileSync(path.join(dir, 'modules', 'registry.json'), JSON.stringify({ modules: { travel: entry('travel'), maps: entry('maps'), calendar: entry('calendar', false) }, autoInstalled: [] }));
  const mm = new ModuleManager(dir);
  const store = fresh('mm', { env: 'lean' });
  const p = store.addSpace({ name: 'P', template: 'project' });
  const q = store.addSpace({ name: 'Q' });
  assert.deepEqual(['travel', 'maps', 'calendar'].filter((id) => mm.isOnIn(id, q.id)), ['travel', 'maps'], 'no offeredIn: every enabled module, as before');
  mm.offeredIn = (id, spaceId) => store.moduleOffered(spaceId, id);
  const on = (spaceId) => ['travel', 'maps', 'calendar'].filter((id) => mm.isOnIn(id, spaceId));
  assert.deepEqual(on(p.id), ['travel', 'maps'], 'project offers both');
  assert.deepEqual(on(q.id), ['travel'], 'lean leaves Maps out');
  assert.deepEqual(on('lobby'), [], "the Lobby: lean's set and the Lobby's rule");
  assert.deepEqual(on(null), ['travel'], "no space: the environment's");
  assert.equal(mm.isOnIn('__proto__', p.id), false);
  assert.equal(mm.isOnIn('constructor', p.id), false);
  assert.equal(mm.onInSpace(mm.registry.modules.maps, mm.manifestOf('maps', '1.0.0'), q.id), false, 'the same answer asked by entry');
  assert.equal(typeof ModuleManager.onInSpace, 'undefined', 'no second, template-blind check');
  // The data stays: nothing about a module being off in a space touches its files.
  assert.ok(fs.existsSync(path.join(dir, 'modules', 'maps', 'versions', '1.0.0', 'module.json')));
  const before = mm.revision;
  mm.save();
  assert.equal(mm.revision, before + 1, 'a save of the registry is a new revision');
});

await test('every reason the AI policy gives has a plain phrase on the owner\'s usage list (public/ai-use.js reasonWord)', () => {
  const { sentences } = require('../server/ai-policy.js');
  const reasons = Object.keys(sentences((k) => k));
  assert.ok(reasons.includes('not-here'));
  const src = fs.readFileSync(path.join(ROOT, 'public', 'ai-use.js'), 'utf8');
  const body = /export function reasonWord\(reason\) \{\s*const map = \{([\s\S]*?)\n  \};/.exec(src);
  assert.ok(body, 'reasonWord and its map are found');
  const keys = [...body[1].matchAll(/^\s*'?([a-z][a-z-]*)'?:/gm)].map((m) => m[1]);
  assert.deepEqual(reasons.filter((r) => !keys.includes(r)), [], 'a reason with no phrase');
});

// --- part 2: the routes ----------------------------------------------------------------------------------------------------

const PRODUCT = 'Testname';
function startServer(dataDir, env = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, TZ: 'UTC', PRODUCT_NAME: PRODUCT, ENABLE_GUEST_DOOR: 'true', LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ...env },
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
function call(server, host, method, urlPath, { body, cookie } = {}) {
  const payload = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const headers = { host: host ? `${host}.localhost:${server.port}` : `127.0.0.1:${server.port}`, accept: 'application/json' };
  if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = payload.length; }
  if (cookie) headers.cookie = cookie;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.port, method, path: urlPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, json, text, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const cookieOf = (res) => [].concat(res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
const ids = (r) => (r.json?.modules || []).map((m) => m.id).sort();

const servers = [];
try {
  const single = path.join(tmp, 'single');
  const server = await startServer(single, { ADMIN_PASSWORD: 'admin-password-1' });
  servers.push(server);
  const api = (cookie) => (method, url, body) => call(server, '', method, url, { cookie, body });
  const admin = api(cookieOf(await call(server, '', 'POST', '/api/login', { body: { login: 'admin', password: 'admin-password-1' } })));
  const installed = [];
  for (const id of ['travel', 'schedule', 'maps', 'budget', 'calendar', 'polls', 'todo', 'documents', 'whiteboard', 'assistant']) {
    const r = await admin('POST', `/api/modules/bundled/${id}/install`);
    assert.ok([200, 201].includes(r.status), `install ${id}: ${r.text}`);
    if (r.json?.module?.needsApproval) await admin('POST', `/api/modules/${id}/approve`, {});
    const on = await admin('PATCH', `/api/modules/${id}`, { enabled: true });
    if (on.status === 200) installed.push(id);
  }
  for (const id of ['travel', 'maps', 'budget', 'calendar']) assert.ok(installed.includes(id), `${id} is on: ${installed}`);
  const makeUser = async (login, role = 'member') => {
    const r = await admin('POST', '/api/users', { login, displayName: login, role, password: `${login}-password-1` });
    assert.equal(r.status, 201, r.text);
    return { key: r.json.user.key, as: api(cookieOf(await call(server, '', 'POST', '/api/login', { body: { login, password: `${login}-password-1` } }))) };
  };
  const owner = await makeUser('olive', 'owner');
  const mia = await makeUser('mia');
  const mo = await makeUser('mo');
  const out = await makeUser('ola');
  // The owner's own templates: a project (from travel, with additions) and a lean one (no AI Assistant, no Maps).
  assert.equal((await owner.as('POST', '/api/environment/templates', { from: 'travel', id: 'harbor', name: 'Harbor' })).status, 201);
  const projectEdit = await owner.as('PATCH', '/api/environment/templates/harbor', { words: { space: { one: 'project', many: 'projects' } }, modules: { travel: { name: 'Project plan', icon: 'diagram-project' }, maps: {}, budget: { name: 'Effort' }, assistant: {}, documents: {}, chat: {}, conference: {} }, reactions: [{ id: 'ship', glyph: '\u{1F680}', label: 'Ship it' }], iconSet: ['diagram-project'] });
  assert.equal(projectEdit.status, 200, projectEdit.text);
  assert.equal((await owner.as('POST', '/api/environment/templates', { from: 'default', id: 'lean', name: 'Lean' })).status, 201);
  assert.equal((await owner.as('PATCH', '/api/environment/templates/lean', { modules: { travel: { name: 'Plan' }, calendar: {}, chat: {}, conference: {} } })).status, 200);
  const bridge = (await admin('POST', '/api/spaces', { name: 'Bridge', members: [mia.key, mo.key], template: 'harbor' })).json.space;
  const camp = (await admin('POST', '/api/spaces', { name: 'Dragon', members: [mia.key, mo.key], template: 'games' })).json.space;
  const plain = (await admin('POST', '/api/spaces', { name: 'Plain', members: [mia.key] })).json.space;
  const leanSpace = (await admin('POST', '/api/spaces', { name: 'Lean', members: [mia.key], template: 'lean' })).json.space;
  assert.equal((await admin('PATCH', `/api/users/${mo.key}/spaces/${bridge.id}`, { permissions: { moderator: true } })).status, 200);
  const forSpace = (who, id) => who('GET', `/api/modules/for-space?space=${id}`);

  await test('two spaces on two templates list different modules, names and icons; the Default template offers every module', async () => {
    const b = await forSpace(mia.as, bridge.id);
    const c = await forSpace(mia.as, camp.id);
    const p = await forSpace(mia.as, plain.id);
    assert.equal(b.status, 200, b.text);
    const canvasOn = installed.filter((id) => manifests.get(id)?.surfaces?.canvas && manifests.get(id).scope.includes('space'));
    assert.deepEqual(ids(p), [...canvasOn].sort(), 'the Default template (no TEMPLATE): every module that is on');
    assert.deepEqual(ids(b), canvasOn.filter((id) => ['travel', 'maps', 'budget', 'assistant', 'documents'].includes(id)).sort());
    assert.deepEqual(ids(c), canvasOn.filter((id) => Object.hasOwn(templates.get('games').modules, id)).sort());
    assert.equal(ids(c).includes('whiteboard'), false, 'games leaves the Whiteboard out');
    assert.equal(ids(b).includes('calendar'), false, 'the project leaves Calendar out');
    const named = (r, id) => r.json.modules.find((m) => m.id === id);
    assert.deepEqual([named(b, 'travel').name, named(b, 'travel').icon], ['Project plan', 'diagram-project']);
    assert.equal(named(c, 'schedule').name, 'Campaign');
    assert.deepEqual([named(p, 'travel').name, named(p, 'travel').icon], [manifests.get('travel').name, manifests.get('travel').icon], "the Default names none: the manifest's");
    assert.equal(named(b, 'budget').name, 'Effort');
    const ctx = (who, id, sp) => who('GET', `/api/modules/${id}/context?scope=space&space=${sp}`);
    assert.equal((await ctx(mia.as, 'travel', bridge.id)).json.module.name, 'Project plan');
    assert.equal((await ctx(mia.as, 'schedule', camp.id)).json.module.name, 'Campaign');
    assert.equal((await ctx(mia.as, 'travel', bridge.id)).json.locale.words.space.one, 'project');
    assert.equal(/"template"/.test((await ctx(mia.as, 'travel', bridge.id)).text), false, 'no template id reaches a module');
  });

  await test('reactions and icons per space: the core set, then the template\'s additions', async () => {
    const look = async (who, id) => (await who('GET', `/api/spaces/${id}/look`)).json.look;
    const b = await look(mia.as, bridge.id);
    const c = await look(mia.as, camp.id);
    assert.deepEqual(b.reactions.slice(0, DEFAULT_REACTION_LIST.length), DEFAULT_REACTION_LIST);
    assert.deepEqual(b.reactions.slice(DEFAULT_REACTION_LIST.length), [{ id: 'ship', glyph: '\u{1F680}', label: 'Ship it' }]);
    assert.deepEqual(c.reactions, DEFAULT_REACTION_LIST);
    assert.deepEqual(b.icons.map((i) => i.id), [...CORE_ICONS, 'diagram-project']);
    assert.deepEqual(c.icons.map((i) => i.id), CORE_ICONS);
    assert.deepEqual([b.phaseMeasure, c.phaseMeasure], ['dates', 'dates']);
    assert.equal(/"(project|Project|games|Games)"|"template"/.test(JSON.stringify({ ...b, words: null })), false, 'no template id or name in the look');
  });

  await test('a module the template leaves out answers there as a module that is not on; its data stays', async () => {
    const off = `this module is not available in that space for you`;
    for (const [method, url, body] of [
      ['GET', `/api/modules/whiteboard/context?scope=space&space=${camp.id}`],
      ['GET', `/api/modules/whiteboard/data?scope=space&space=${camp.id}`],
      ['PUT', `/api/modules/whiteboard/data/place:x?scope=space&space=${camp.id}`, { value: { name: 'x' } }],
      ['GET', `/api/modules/whiteboard/settings/values?scope=space&space=${camp.id}`],
    ]) {
      const r = await mia.as(method, url, body);
      assert.deepEqual([r.status, r.json?.error], [403, off], `${method} ${url}: ${r.text}`);
    }
    // The same module answers in a space whose template offers it, and its data written there survives a change of template.
    const put = await mia.as('PUT', `/api/modules/maps/data/place:kept?scope=space&space=${bridge.id}`, { value: { name: 'Kept' } });
    assert.ok([200, 201].includes(put.status), put.text);
    assert.equal((await admin('PATCH', `/api/spaces/${bridge.id}`, { template: 'lean' })).status, 200);
    assert.equal((await mia.as('GET', `/api/modules/maps/data?scope=space&space=${bridge.id}`)).status, 403, 'off under a template that leaves Maps out');
    assert.equal((await admin('PATCH', `/api/spaces/${bridge.id}`, { template: 'harbor' })).status, 200);
    const back = await mia.as('GET', `/api/modules/maps/data?scope=space&space=${bridge.id}`);
    assert.equal(back.status, 200, back.text);
    assert.ok(JSON.stringify(back.json).includes('Kept'), 'back with its data');
  });

  await test('who sees what: the owner, a moderator and a member see one set; guests a part of it; an outsider an unknown id', async () => {
    const base = ids(await forSpace(mia.as, bridge.id));
    assert.deepEqual(ids(await forSpace(mo.as, bridge.id)), base, 'a moderator');
    assert.deepEqual(ids(await forSpace(owner.as, bridge.id)), base, 'the owner');
    assert.deepEqual(ids(await forSpace(admin, bridge.id)), base, 'the admin');
    const unknown = await out.as('GET', '/api/modules/for-space?space=zzzzzzzz');
    const outsider = await forSpace(out.as, bridge.id);
    assert.deepEqual([outsider.status, outsider.json], [unknown.status, unknown.json], 'an outsider reads what an unknown id reads');
    assert.equal(/Project plan|Effort/.test(outsider.text), false);
    const outLook = await out.as('GET', `/api/spaces/${bridge.id}/look`);
    assert.deepEqual([outLook.status, outLook.json], [404, (await out.as('GET', '/api/spaces/zzzzzzzz/look')).json], 'nor its look');
    // A link guest of the campaign: never a module games leaves out, and never another space's.
    const link = (await admin('POST', `/api/spaces/${camp.id}/guest-link`, {})).json.space.guestToken;
    const joined = await call(server, '', 'POST', '/api/guest-join', { body: { token: link, name: 'Gus' } });
    assert.equal(joined.status, 200, joined.text);
    // A link guest is named by the link on every request (?guest=).
    const gus = (method, url, body) => call(server, '', method, `${url}${url.includes('?') ? '&' : '?'}guest=${encodeURIComponent(link)}`, { body });
    const gusSet = ids(await forSpace(gus, camp.id));
    const campSet = ids(await forSpace(mia.as, camp.id));
    assert.ok(gusSet.every((id) => campSet.includes(id)), `a link guest sees a part of the member's set: ${gusSet} of ${campSet}`);
    assert.ok(gusSet.length > 0, 'a link guest sees some modules');
    assert.equal(gusSet.includes('whiteboard'), false);
    const gusMaps = await gus('GET', `/api/modules/whiteboard/data?scope=space&space=${camp.id}`);
    assert.deepEqual([gusMaps.status, gusMaps.json?.error], [403, 'this module is not available in that space for you'], 'Maps is off there for a guest too');
    const gusOther = await forSpace(gus, bridge.id);
    const gusUnknown = await gus('GET', '/api/modules/for-space?space=zzzzzzzz');
    assert.deepEqual([gusOther.status, gusOther.json], [gusUnknown.status, gusUnknown.json], 'a link guest on another space reads what an unknown id reads');
    assert.equal(gusOther.status, 404);
    assert.equal(/Project plan|Effort/.test(gusOther.text), false);
    // A door guest in a space open to guests: the same rule.
    assert.equal((await admin('PATCH', `/api/spaces/${bridge.id}`, { entry: 'guests' })).status, 200);
    const door = await call(server, '', 'POST', '/api/guest-door', { body: { name: 'Dora' } });
    assert.equal(door.status, 201, door.text);
    const dora = api(cookieOf(door));
    const doraSet = ids(await forSpace(dora, bridge.id));
    assert.ok(doraSet.every((id) => base.includes(id)), `a door guest sees a part of the member's set: ${doraSet}`);
    assert.ok(doraSet.length > 0, 'a door guest sees some modules');
    assert.equal(doraSet.includes('calendar'), false, 'never a module the project leaves out');
    const doraCamp = await forSpace(dora, camp.id);
    assert.ok([401, 403, 404].includes(doraCamp.status), `a space not open to guests: ${doraCamp.status}`);
    assert.equal(/Campaign planner/.test(doraCamp.text), false);
    assert.equal((await admin('PATCH', `/api/spaces/${bridge.id}`, { entry: 'invited' })).status, 200);
  });

  await test('settings: a module the space\'s template leaves out takes no settings there (space, and person through a space); a disabled one is 404', async () => {
    assert.ok(installed.includes('polls') && installed.includes('calendar'), `polls and calendar are on: ${installed}`);
    const off = 'this module is not available in that space for you';
    const stored = () => JSON.stringify(fs.existsSync(path.join(single, 'modules', 'polls')) ? fs.readdirSync(path.join(single, 'modules', 'polls'), { recursive: true }) : []);
    const before = stored();
    for (const [who, label] of [[admin, 'the admin'], [owner.as, 'an owner'], [mo.as, 'its moderator']]) {
      const r = await who('PUT', `/api/modules/polls/settings/space?space=${bridge.id}`, { values: { addableByDefault: true } });
      assert.deepEqual([r.status, r.json?.error], [403, off], `${label}: ${r.text}`);
    }
    assert.equal(stored(), before, 'nothing saved by a refusal');
    const read = await mia.as('GET', `/api/modules/polls/settings/values?scope=space&space=${bridge.id}`);
    assert.deepEqual([read.status, read.json?.error], [403, off], 'and every read agrees');
    // Where the template offers it, the same write goes through.
    assert.equal((await admin('PUT', `/api/modules/polls/settings/space?space=${plain.id}`, { values: { addableByDefault: true } })).status, 200);
    // A person's own setting, asked through a space whose template leaves the module out; with no space it is theirs as ever.
    const viaSpace = await mia.as('PUT', `/api/modules/calendar/settings/person?space=${bridge.id}`, { values: { defaultView: 'week' } });
    assert.deepEqual([viaSpace.status, viaSpace.json?.error], [403, off], viaSpace.text);
    assert.equal((await mia.as('PUT', '/api/modules/calendar/settings/person', { values: { defaultView: 'week' } })).status, 200);
    assert.equal((await mia.as('PUT', `/api/modules/calendar/settings/person?space=${plain.id}`, { values: { defaultView: 'day' } })).status, 200);
    // A module that is not installed or not on is still no module at all.
    for (const id of ['nosuch', '__proto__']) {
      const r = await admin('PUT', `/api/modules/${id}/settings/space?space=${bridge.id}`, { values: {} });
      assert.equal(r.status, 404, `${id}: ${r.text}`);
    }
  });

  await test('a link guest asking about another space reads the same 403 whether or not that space\'s template offers the module', async () => {
    const link = (await admin('POST', `/api/spaces/${camp.id}/guest-link`, {})).json.space.guestToken;
    const gus = (url) => call(server, '', 'GET', `${url}&guest=${encodeURIComponent(link)}`);
    const answers = [];
    for (const [id, sp, label] of [['maps', bridge.id, 'offered there'], ['polls', bridge.id, 'left out there'], ['maps', plain.id, 'the Default there']]) {
      for (const route of ['data', 'context', 'settings/values']) {
        const r = await gus(`/api/modules/${id}/${route}?scope=space&space=${sp}`);
        answers.push([route, r.status, r.json?.error]);
        assert.equal(r.status, 403, `${id} ${route}, ${label}: ${r.text}`);
      }
    }
    assert.equal(new Set(answers.map(([, st, e]) => `${st}|${e}`)).size, 1, `one answer for all: ${JSON.stringify(answers)}`);
  });

  await test('Home and the Lobby read the environment\'s template: nav, widgets and the Lobby follow a switch', async () => {
    const nav = async () => (await mia.as('GET', '/api/modules/nav')).json.modules.map((m) => m.id).sort();
    const widgets = async () => (await mia.as('GET', '/api/modules/widgets')).json.widgets.map((m) => m.id).sort();
    const navAll = await nav();
    const widgetsAll = await widgets();
    assert.ok(navAll.includes('maps') && navAll.includes('travel'), `the Default template: every page (${navAll})`);
    assert.ok(widgetsAll.includes('todo') || widgetsAll.includes('calendar'), `and every widget (${widgetsAll})`);
    const sw = await owner.as('PATCH', '/api/settings', { template: 'lean' });
    assert.equal(sw.status, 200, sw.text);
    const navLean = await nav();
    assert.equal(navLean.includes('maps'), false, 'lean leaves Maps off Home');
    assert.ok(navLean.includes('travel'));
    for (const id of navAll.filter((m) => !manifests.get(m)?.scope.includes('space'))) assert.ok(navLean.includes(id), `${id} has no space scope: never a template's to hide`);
    assert.deepEqual(await widgets(), widgetsAll.filter((id) => ['travel', 'calendar', 'chat'].includes(id)), 'widgets too');
    // A space with no template of its own reads lean now; the Lobby too.
    assert.deepEqual(ids(await forSpace(mia.as, plain.id)), ['calendar', 'travel'].filter((id) => installed.includes(id)).sort());
    const lobby = ids(await forSpace(mia.as, 'lobby'));
    assert.ok(lobby.every((id) => ['calendar', 'travel'].includes(id) && manifests.get(id).surfaces.canvas.lobby === true), `the Lobby: lean's set and its own rule (${lobby})`);
    // A space with its own template is untouched by the environment's.
    assert.ok(ids(await forSpace(mia.as, bridge.id)).includes('maps'));
    assert.equal((await owner.as('PATCH', '/api/settings', { template: 'default' })).status, 200);
    assert.deepEqual(await nav(), navAll, 'back to the Default template: every page again');
  });

  await test('the AI: refused in a space whose template leaves the AI Assistant out, with its own reason; not there otherwise', async () => {
    const lean = await mia.as('GET', `/api/spaces/${leanSpace.id}/ai`);
    assert.equal(lean.status, 200, lean.text);
    assert.deepEqual([lean.json.available, lean.json.reason, lean.json.why], [false, 'not-here', "AI Assistant is not one of this space's modules."]);
    const ask = await mia.as('POST', `/api/spaces/${leanSpace.id}/ai`, { question: 'What is next?' });
    assert.deepEqual([ask.status, ask.json.error], [403, "AI Assistant is not one of this space's modules."]);
    const bridgeAi = await mia.as('GET', `/api/spaces/${bridge.id}/ai`);
    assert.notEqual(bridgeAi.json.reason, 'not-here', 'the project offers it');
    const outsider = await out.as('GET', `/api/spaces/${leanSpace.id}/ai`);
    assert.equal(/not one of this/.test(outsider.text), false, "an outsider is told nothing of the space's modules");
  });

  await test('an edit of a template is read at once; a deleted template falls back to the environment\'s', async () => {
    const before = await forSpace(mia.as, bridge.id);
    assert.ok(ids(before).includes('budget'));
    const edit = await owner.as('PATCH', '/api/environment/templates/harbor', { modules: { travel: { name: 'Roadmap' }, maps: {}, assistant: {}, documents: {}, chat: {}, conference: {} } });
    assert.equal(edit.status, 200, edit.text);
    const after = await forSpace(mia.as, bridge.id);
    assert.equal(ids(after).includes('budget'), false, 'Budget off at once');
    assert.equal(after.json.modules.find((m) => m.id === 'travel').name, 'Roadmap', 'the new name at once');
    assert.equal((await mia.as('GET', `/api/modules/budget/data?scope=space&space=${bridge.id}`)).status, 403);
    const gone = await owner.as('DELETE', '/api/environment/templates/harbor');
    assert.deepEqual([gone.status, gone.json], [200, { spaces: ['Bridge'], environment: false }]);
    assert.deepEqual(ids(await forSpace(mia.as, bridge.id)), ids(await forSpace(mia.as, plain.id)), "the environment's (Default) set");
    assert.equal((await forSpace(mia.as, bridge.id)).json.modules.find((m) => m.id === 'travel').name, manifests.get('travel').name);
  });
  await server.stop();

  // --- part 3: hosted ------------------------------------------------------------------------------------------------------
  const hosted = path.join(tmp, 'hosted');
  const hs = await startServer(hosted, { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'boss', ADMIN_PASSWORD: 'host-password-1' });
  servers.push(hs);
  const hostCookie = cookieOf(await call(hs, 'admin', 'POST', '/api/host/login', { body: { login: 'boss', password: 'host-password-1' } }));
  const console_ = (method, url, body) => call(hs, 'admin', method, url, { cookie: hostCookie, body });

  await test('hosted: one environment\'s own template is never read, offered or named by another', async () => {
    for (const slug of ['one', 'two']) {
      const r = await console_('POST', '/api/host/environments', { slug, name: slug.toUpperCase(), template: 'default', owner: { login: `owner-${slug}`, password: `owner-${slug}-password-1` } });
      assert.equal(r.status, 201, r.text);
    }
    const as = async (slug) => {
      const c = cookieOf(await call(hs, slug, 'POST', '/api/login', { body: { login: `owner-${slug}`, password: `owner-${slug}-password-1` } }));
      return (method, url, body) => call(hs, slug, method, url, { cookie: c, body });
    };
    const one = await as('one');
    const two = await as('two');
    for (const who of [one, two]) {
      const r = await who('POST', '/api/modules/bundled/travel/install');
      assert.ok([200, 201].includes(r.status), r.text);
      assert.equal((await who('PATCH', '/api/modules/travel', { enabled: true })).status, 200);
    }
    assert.equal((await one('POST', '/api/environment/templates', { from: 'default', id: 'secret-lens', name: 'Secret lens' })).status, 201);
    assert.equal((await one('PATCH', '/api/environment/templates/secret-lens', { modules: { travel: { name: 'Hidden name' }, chat: {} } })).status, 200);
    const s1 = (await one('POST', '/api/spaces', { name: 'S1', template: 'secret-lens' })).json.space;
    assert.equal((await one('GET', `/api/modules/for-space?space=${s1.id}`)).json.modules.find((m) => m.id === 'travel').name, 'Hidden name');
    const refused = await two('POST', '/api/spaces', { name: 'S2', template: 'secret-lens' });
    assert.deepEqual([refused.status, refused.json.error], [400, 'There is no template called secret-lens.']);
    const s2 = (await two('POST', '/api/spaces', { name: 'S2' })).json.space;
    const r2 = await two('GET', `/api/modules/for-space?space=${s2.id}`);
    assert.equal(r2.text.includes('Hidden name'), false);
    assert.equal(r2.json.modules.find((m) => m.id === 'travel').name, manifests.get('travel').name);
    // The first environment's space id, asked in the second, is no space there.
    const cross = await two('GET', `/api/modules/for-space?space=${s1.id}`);
    assert.equal(cross.status, 404);
    assert.equal(cross.text.includes('Hidden name'), false);
    assert.equal((await two('GET', '/api/environment/templates')).json.templates.some((t) => t.id === 'secret-lens'), false);
  });
} finally {
  for (const s of servers) await s.stop().catch(() => {});
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failed ? `check-template-lens: ${failed} failed` : `check-template-lens: ${n} checks passed`);
process.exit(failed ? 1 : 0);
