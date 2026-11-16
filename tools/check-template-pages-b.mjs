#!/usr/bin/env node
/*
 * check-template-pages-b.mjs -- the rest of the template pages (documentation/plans/plan-templates-redesign.md, step 11b):
 * Manage > Template's Default Workspace, Phases, Additional Reactions and Icons and Modules pages, how a module setting's mark
 * (driven, default) and a template's words read in the module forms, the phases' measure where a space shows phases (Set up's
 * Done switch and the chip), and Profile's theme.
 *
 * Part 1, in node, no browser: the pages' markup builders (public/template-pages.js, run with a stand-in for its one import) draw
 * the fields of an editable template and plain lines for a read-only one, mark every driven and default setting, group the
 * planners under "Plans", and read nothing but plain words; the page files hold the parts, the strip, the 44 px rules for a
 * phone and the marks in the form code.
 *
 * Part 2, a browser under a throwaway seeded server (skipped, never passed, with no Chromium), at 1280 and 390: a test module
 * with driven and default settings and a renameable word is uploaded; an owner's template offers it, drives its unit, sets a
 * word and has phases measured by progress; each page opens by its address and its button with its data drawn, no sideways
 * scroll, no console error and no failed /api request; the editable pages save and the server holds what was saved; the
 * Modules page marks and the module form (Manage > Modules and Set up) read driven settings as read only with the template's
 * name; Set up's Done switch moves and the chip reads "<phase> · 1 of 3"; Profile's Theme saves and clears; 44 px targets at 390.
 *
 *   node tools/check-template-pages-b.mjs        (the browser part is run under the browser lock, one browser at a time)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stopBrowser } from './browser-launch.mjs';
import { findBrowser, launch, freePort, stopServer, bootSeeded, Tab, sleep, driveScreen } from './shots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let n = 0;
const failures = [];
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failures.push(`${name}: ${err.stack || err.message}`); }
};
const say = (...a) => console.log('check-template-pages-b:', ...a);

// --- part 1: markup and files -----------------------------------------------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-template-pages-b-'));
const stand = path.join(tmp, 'template-pages.mjs');
const escapeStand = "const escapeHtml = (s) => String(s ?? '').replace(/[&<>\"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', \"'\": '&#39;' }[c]));";
fs.writeFileSync(path.join(tmp, 'list-rows.mjs'), read('public/list-rows.js').replace(/^import \{ escapeHtml \} from '\/brand\.js';/m, escapeStand).replace(/^import \{ upgradeColourInputs \} from '\/colour-pick\.js';/m, 'const upgradeColourInputs = () => {};'));
fs.writeFileSync(stand, read('public/template-pages.js').replace(/^import \{ escapeHtml \} from '\/brand\.js';/m, escapeStand).replace(/^import \{ upgradeColourInputs \} from '\/colour-pick\.js';/m, 'const upgradeColourInputs = () => {};').replace("from '/list-rows.js'", "from './list-rows.mjs'"));
const P = await import(pathToFileURL(stand).href);
const word = (key, o = {}) => ({ space: 'space', module: o.many ? 'modules' : 'module', environment: 'environment' }[key] || key);
const catalog = [
  { id: 'chat', name: 'Chat', icon: 'message', settings: [], labels: {} },
  { id: 'marks', name: 'Marks', icon: 'star', settings: [{ key: 'unit', label: 'Counts', type: 'choice', scope: 'space', template: 'driven', default: 'money', options: [{ value: 'money', label: 'Money' }, { value: 'hours', label: 'Hours' }] }, { key: 'split', label: 'Who owes whom', type: 'boolean', scope: 'space', template: 'default', default: true }, { key: 'own', label: 'Own', type: 'boolean', scope: 'space', default: false }, { key: 'tags', label: 'Tags', type: 'list', scope: 'environment', template: 'default', fixed: ['other'], maxLength: 30, default: [{ id: 'other', label: 'Other', icon: 'flag', color: '#888888' }, { id: 'a', label: 'Alpha', icon: 'star', color: '#4f8fdd' }] }], labels: { event: { one: 'event', many: 'events' } }, starter: true },
  { id: 'travel', name: 'Planner - Travel', icon: 'route', settings: [], labels: {} },
];
const tpl = { id: 't', name: 'T', modules: { chat: {}, marks: { name: 'Timesheet', settings: { unit: 'hours' }, labels: { event: { one: 'meeting', many: 'meetings' } }, starter: { 'k:a': { x: 1 } } } }, workspace: { opensWith: ['chat'], show: ['calendar'], opensFirst: 'calendar' }, phases: [{ id: 'a', label: 'Start', main: true }, { id: 'b', label: 'End' }], phaseMeasure: 'goals', reactions: [{ id: 'ship', glyph: '🚀', label: 'Ship' }], iconSet: ['rocket'] };

await test('A template change names the modules that turn off and on, and says their data is kept (switch and a space\'s change)', async () => {
  const C = await import(pathToFileURL(path.join(ROOT, 'public/template-choice.js')).href);
  const cat = [{ id: 'chat', name: 'Chat' }, { id: 'travel', name: 'Planner - Travel' }, { id: 'goals', name: 'Goals' }, { id: 'schedule', name: 'Schedule' }];
  const project = { id: 'p', modules: { chat: {}, schedule: { name: 'Project plan' }, goals: {} } };
  const shift = C.moduleShift({ id: 'default', modules: '*' }, project, cat);
  assert.deepEqual(shift, { off: ['Planner - Travel'], on: [] });
  assert.deepEqual(C.moduleShift(project, { modules: { chat: {}, travel: {}, schedule: {} } }, cat), { off: ['Goals'], on: ['Planner - Travel'] });
  assert.equal(C.moduleShift({ modules: '*' }, project), null, 'a * with no catalog cannot be told');
  const asked = C.changeQuestion('Project', word, C.moduleShift(project, { modules: { chat: {} } }, cat));
  assert.match(asked.message, /In this space, Project plan and Goals turn off\. Their data is kept\./);
  assert.match(asked.message, /Nothing is deleted\./);
  assert.doesNotMatch(asked.message, /Nothing is removed/);
  assert.match(C.changeQuestion('X', word, { off: [], on: ['Goals'] }).message, /In this space, Goals turns on\./);
  assert.match(C.changeQuestion('X', word, { off: [], on: [] }).message, /the same modules stay on/);
  assert.match(C.changeQuestion('X', word, null).message, /keeps its data/);
  const offer = read('public/template-offer.js');
  assert.ok(!/Nothing is turned off or removed/.test(offer) && /shiftSentences\(shift, where, word\)/.test(offer), 'the switch question names the modules');
  for (const f of ['public/admin.js', 'public/host.js']) assert.match(read(f), /switchConfirm\([^)]*, shift\)/, `${f} passes the shift`);
  assert.match(read('public/space-setup.js'), /changeQuestion\([^)]*, word, shift\)/);
});

await test('Modules: editable rows with marks, words, the starter and the Plans group; no own setting', () => {
  const html = P.modulesHtml(tpl, { editable: true, catalog, word });
  assert.equal((html.match(/<details class="tp-module"/g) || []).length, 3);
  assert.match(html, /<h3>Plans<\/h3>/);
  assert.ok(html.indexOf('Plans') > html.indexOf('data-tm="marks"'), 'the planners come after the modules');
  assert.match(html, /data-ts="unit"[^]*?Driven/);
  assert.match(html, /data-ts="split"[^]*?Default/);
  assert.doesNotMatch(html, /data-ts="own"/, 'an own setting is not the template\'s');
  assert.doesNotMatch(html, /data-tm-label/, 'the words moved to Experience Labels');
  assert.match(html, /Keep the starter content \(1 object/);
  assert.match(html, /data-tm-offer checked disabled/, 'Chat can not be left out');
});
await test('Modules: a list setting is edited as rows (add, rename, reorder, remove), kept as the template has it, off until the template sets it', () => {
  const html = P.modulesHtml(tpl, { editable: true, catalog, word });
  assert.match(html, /data-ts="tags"[^]*?data-list-setting/, 'a list is rows, not a count');
  assert.doesNotMatch(html, /kept as it is/);
  assert.match(html, /<div class="tp-list" inert>/, 'not set by the template: the default rows are shown, off');
  assert.equal((html.match(/class="sdk-row list-row"/g) || []).length, 2, 'the default rows are drawn');
  const set = P.modulesHtml({ ...tpl, modules: { ...tpl.modules, marks: { ...tpl.modules.marks, settings: { tags: [{ id: 'z', label: 'Zed', icon: 'star', color: '#112233' }] } } } }, { editable: true, catalog, word });
  assert.match(set, /<div class="tp-list">[^]*?value="Zed"/, 'the template\'s own rows are drawn, on');
  assert.match(set, /data-def="[^"]*&quot;fixed&quot;:\[&quot;other&quot;\]/, 'the fixed rows travel with the list');
  const ro = P.modulesHtml({ ...tpl, modules: { ...tpl.modules, marks: { ...tpl.modules.marks, settings: { tags: [{ id: 'z', label: 'Zed', icon: 'star', color: '#112233' }] } } } }, { editable: false, catalog, word });
  assert.match(ro, /1 in the list: Zed/, 'read only says the labels');
});
await test('Experience Labels: each offered module\'s words under its name; read only draws lines; saving keeps the module\'s other parts', () => {
  const html = P.moduleLabelsHtml(tpl, { editable: true, catalog, word });
  assert.match(html, /data-tml="marks"[^]*?<h4>[^]*?Timesheet[^]*?data-tm-label="event"/, 'under the module\'s name (as the template shows it)');
  assert.doesNotMatch(html, /data-tml="chat"|data-tml="travel"/, 'a module with no words has no group; one the template does not offer has none');
  assert.match(html, /value="meeting"/);
  assert.equal(P.moduleLabelsHtml({ id: 't', modules: { chat: {} } }, { editable: true, catalog, word }), '');
  const all = P.moduleLabelsHtml({ id: 'default', modules: '*' }, { editable: false, catalog, word });
  assert.doesNotMatch(all, /<input/);
  assert.match(all, /event[^]*?events, the usual/);
  // Reading it back: a stand-in for the page's fields.
  const field = (value) => ({ value });
  const group = { dataset: { tml: 'marks' }, querySelectorAll: () => [{ dataset: { tmLabel: 'event' }, querySelector: (q) => field(q.includes('one') ? 'session' : 'sessions') }] };
  const out = P.readModuleLabels({ querySelectorAll: () => [group] }, tpl);
  assert.deepEqual(out.modules.marks.labels.event, { one: 'session', many: 'sessions' });
  assert.deepEqual(out.modules.marks.settings, { unit: 'hours' }, 'the settings stay');
  assert.deepEqual(out.modules.marks.starter, tpl.modules.marks.starter, 'the starter stays');
  assert.equal(out.modules.marks.name, 'Timesheet');
  assert.deepEqual(out.modules.chat, {}, 'a module the page did not draw stays');
  const blank = { dataset: { tml: 'marks' }, querySelectorAll: () => [{ dataset: { tmLabel: 'event' }, querySelector: () => field('') }] };
  assert.equal(Object.hasOwn(P.readModuleLabels({ querySelectorAll: () => [blank] }, tpl).modules.marks, 'labels'), false, 'blank words are the usual ones');
  assert.deepEqual(P.readModuleLabels({ querySelectorAll: () => [] }, tpl), {}, 'no group drawn, nothing sent');
});
await test('Modules: read only draws lines, no fields; the Default template offers every module', () => {
  const html = P.modulesHtml({ id: 'default', modules: '*' }, { editable: false, catalog, word });
  assert.doesNotMatch(html, /<input|<select|<textarea/);
  assert.match(html, /offers every module/);
  assert.match(html, /Offered/);
  assert.match(html, /Its own/);
});
await test('Workspace, Phases, Additions: fields when editable, lines when not, the pin rule said', () => {
  const ws = P.workspaceHtml(tpl, { editable: true, catalog, word });
  assert.equal((ws.match(/data-tw-show=/g) || []).length, 5);
  assert.match(ws, /nobody can hide it/);
  assert.doesNotMatch(P.workspaceHtml(tpl, { editable: false, catalog, word }), /<input|<select/);
  const ph = P.phasesHtml(tpl, { editable: true, word });
  assert.equal((ph.match(/data-tp-phase=/g) || []).length, 2);
  assert.match(ph, /<option value="goals" selected>/);
  assert.match(P.phasesHtml(tpl, { editable: false, word }), /Measured by[^]*Goals/);
  const core = { reactions: [{ glyph: '❤️', label: 'Heart' }], icons: [{ id: 'star', classes: 'fa-solid fa-star', label: 'star' }] };
  const ad = P.additionsHtml(tpl, { editable: true, core });
  assert.match(ad, /The core set/);
  assert.match(ad, /data-tr-id="ship"/);
  assert.match(ad, /value="rocket"/);
  assert.doesNotMatch(P.additionsHtml(tpl, { editable: false, core }), /<input/);
});
await test('the pages, the strip, the 44 px rules and the marks are in the files', () => {
  const html = read('public/admin.html');
  for (const part of ['workspace', 'phases', 'reactions', 'modules']) {
    assert.match(html, new RegExp(`data-tpl-part="${part}" hidden`), `${part} page`);
    assert.match(html, new RegExp(`<button class="subtab" type="button" data-tpl-part="${part}"`), `${part} in the strip`);
  }
  assert.doesNotMatch(html, /data-tpl-part="more"/, 'the stop-gap page is gone');
  assert.match(read('public/admin.js'), /TPL_PARTS = \['main', 'basics', 'labels', 'workspace', 'phases', 'reactions', 'modules', 'list'\]/);
  const css = read('public/style.css');
  const phone = css.slice(css.indexOf('.tp-phase { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }') - 60);
  assert.match(phone, /\.tp-actions \.btn[^{]*\{ --btn-h: 44px; \}/);
  assert.match(phone, /\.tp-phase \.tp-main, \.tp-module-head \{ min-height: 44px; \}/);
  const form = read('public/module-settings.js');
  assert.match(form, /function markLine/);
  assert.match(form, /if \(def\.locked\) continue/, 'a driven setting is never sent');
  assert.match(form, /data-use-template/);
  assert.match(read('public/space-setup.js'), /\/phases\/\$\{encodeURIComponent\(box\.dataset\.phaseDone\)\}\/done/);
  assert.match(read('public/space.js'), /function measuredStory/);
  assert.match(read('public/profile.js'), /'\/api\/me\/themes'/);
});

// --- part 2: the pages in a browser -----------------------------------------------------------------------------------------
const bin = findBrowser();
if (!bin) say('The browser part was SKIPPED: no Chromium found (set CHROME_PATH). That is not a pass; nothing of it was measured.');
else await live();

async function live() {
  const SHOT_DIR = process.env.TEMPLATE_PAGES_SHOTS || '';
  if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'template-pages-b-data-'));
  let server = null; let browser = null;
  try {
    const boot = await bootSeeded('travel', dataDir, await freePort());
    server = boot.server;
    const S = { base: server.base, ctx: boot.ctx, cookies: boot.cookies };
    const cookie = S.cookies.admin.map((c) => `${c.name}=${c.value}`).join('; ');
    const api = async (method, url, body, zip) => {
      const headers = { cookie, origin: S.base, accept: 'application/json' };
      if (zip) headers['content-type'] = 'application/zip'; else if (body !== undefined) headers['content-type'] = 'application/json';
      const r = await fetch(S.base + url, { method, headers, body: zip || (body === undefined ? undefined : JSON.stringify(body)) });
      let json = null; try { json = await r.json(); } catch { /* none */ }
      return { status: r.status, json };
    };
    await api('PUT', '/api/ai', { provider: 'none', model: '', clearKey: true, source: 'custom', monthlyTokens: 0 });

    // A module with a driven and a default setting in each scope that matters, one renameable word and starter content.
    const { zipFiles } = require('../server/module-build.js');
    const page = Buffer.from('<!doctype html><html><head><meta charset="utf-8"></head><body><script src="/sdk/host.js"></script></body></html>');
    const manifest = {
      id: 'marks', name: 'Marks', version: '1.0.0', scope: ['environment', 'space'],
      surfaces: { page: { entry: 'page.html' }, canvas: { entry: 'canvas.html' } },
      settings: [
        { key: 'unit', label: 'Counts', type: 'choice', scope: 'space', template: 'driven', default: 'money', options: [{ value: 'money', label: 'Money' }, { value: 'hours', label: 'Hours' }] },
        { key: 'split', label: 'Who owes whom', type: 'boolean', scope: 'space', template: 'default', default: true },
        { key: 'mode', label: 'Strict mode', type: 'boolean', scope: 'environment', template: 'driven', default: false },
        { key: 'title', label: 'Title', type: 'text', scope: 'environment', template: 'default', default: 'Plan' },
        { key: 'tags', label: 'Tags', type: 'list', scope: 'environment', template: 'default', maxLength: 30, fixed: ['other'], default: [{ id: 'other', label: 'Other', icon: 'flag', color: '#888888' }, { id: 'alpha', label: 'Alpha', icon: 'star', color: '#4f8fdd' }] },
        { key: 'palette', label: 'Palette', type: 'list', scope: 'environment', template: 'driven', maxLength: 30, default: [{ id: 'red', label: 'Red', icon: 'heart', color: '#d9534f' }] },
        { key: 'own', label: 'Own switch', type: 'boolean', scope: 'space', default: false },
      ],
      labels: { event: { one: 'event', many: 'events' } },
      starter: true,
    };
    const up = await api('POST', '/api/modules', undefined, zipFiles([['module.json', Buffer.from(JSON.stringify(manifest))], ['page.html', page], ['canvas.html', page]]));
    assert.equal(up.status, 201, JSON.stringify(up.json));
    if (up.json?.module?.needsApproval) await api('POST', '/api/modules/marks/approve', {});
    assert.equal((await api('PATCH', '/api/modules/marks', { enabled: true })).status, 200);

    // Two templates of the owner's own: "mine" (the environment's, with a driven environment setting) and "hours" (a space's).
    assert.equal((await api('POST', '/api/environment/templates', { from: 'default', id: 'mine', name: 'Mine' })).status, 201);
    assert.equal((await api('POST', '/api/environment/templates', { from: 'default', id: 'hours', name: 'Hours' })).status, 201);
    const mods = (extra) => ({ chat: {}, conference: {}, marks: extra });
    const phases3 = [{ id: 'start', label: 'Start' }, { id: 'build', label: 'Build', main: true }, { id: 'wrap', label: 'Wrap up' }];
    // The same start for each size: both templates as first written, and no phase done.
    const reset = async () => {
      const mine = await api('PATCH', '/api/environment/templates/mine', {
        modules: mods({ name: 'Timesheet', settings: { mode: true, title: 'Our plan', palette: [{ id: 'red', label: 'Red', icon: 'heart', color: '#d9534f' }, { id: 'blue', label: 'Blue', icon: 'water', color: '#4f8fdd' }] }, labels: { event: { one: 'meeting', many: 'meetings' } }, starter: { 'k:one': { a: 1 } } }),
        workspace: { opensWith: ['chat', 'marks'], show: ['calendar'] },
        phases: phases3, phaseMeasure: 'dates',
        reactions: [{ id: 'ship', glyph: '\u{1F680}', label: 'Ship it' }], iconSet: ['rocket'],
      });
      assert.equal(mine.status, 200, JSON.stringify(mine.json));
      const hours = await api('PATCH', '/api/environment/templates/hours', { modules: mods({ settings: { unit: 'hours', split: false } }), phases: phases3, phaseMeasure: 'progress' });
      assert.equal(hours.status, 200, JSON.stringify(hours.json));
      assert.equal((await api('PUT', '/api/modules/marks/settings/environment', { values: { title: null, tags: null } })).status, 200);
      for (const p of phases3) await api('PUT', `/api/spaces/${spaceId}/phases/${p.id}/done`, { done: false });
    };
    const space = await api('POST', '/api/spaces', { name: 'Ledger', template: 'hours' });
    assert.equal(space.status, 200, JSON.stringify(space.json));
    const spaceId = space.json.space.id;
    // The environment reads "mine".
    const switched = await api('PATCH', '/api/settings', { template: 'mine' });
    assert.equal(switched.status, 200, JSON.stringify(switched.json));
    await reset();
    const themeList = await api('GET', '/api/me/themes');
    assert.equal(themeList.status, 200);

    browser = await launch(bin);
    const problemsOf = (tab) => {
      const problems = [];
      const listener = (m) => {
        if (m.sessionId !== tab.sid) return;
        if (m.method === 'Runtime.exceptionThrown') problems.push('uncaught: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
        if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
        if (m.method === 'Network.responseReceived' && m.params.response.status >= 400 && new URL(m.params.response.url).pathname.startsWith('/api/')) problems.push(`HTTP ${m.params.response.status} from ${new URL(m.params.response.url).pathname}`);
      };
      tab.cdp.listeners.push(listener);
      return problems;
    };
    const shot = async (tab, name) => {
      if (!SHOT_DIR) return;
      const r = await tab.cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, tab.sid);
      fs.writeFileSync(path.join(SHOT_DIR, `${name}.png`), Buffer.from(r.data, 'base64'));
    };

    for (const size of process.env.TEMPLATE_PAGES_SIZE ? [Number(process.env.TEMPLATE_PAGES_SIZE)] : [1280, 390]) {
      const tab = new Tab(browser.cdp, S.ctx);
      await tab.open(size, 'dark', false);
      const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
      await reset();
      const problems = problemsOf(tab);
      const phone = size < 640;
      const sideways = () => tab.eval('document.documentElement.scrollWidth - document.documentElement.clientWidth');
      const at = (what) => `${size}: ${what}`;
      try {
        await driveScreen(tab, { as: 'admin', url: '/admin', wait: '#set-environment-name' }, S.base, S.cookies, S.ctx);
        await sleep(1500);
        const open = async (hash, ready, what) => {
          await tab.eval(`location.hash = ${JSON.stringify(hash)}`);
          await sleep(1300);
          assert.ok(await tab.eval(ready), at(`${what} is not drawn (${hash})`));
          assert.ok(await sideways() <= 1, at(`${what} scrolls sideways`));
        };
        const count = (sel) => `document.querySelectorAll(${JSON.stringify(sel)}).length`;

        await test(at('Default Workspace: fields for an own template, lines for the Default'), async () => {
          await open('template/mine/workspace', `${count('#tpl-workspace-box [data-tw-open]')} >= 3 && ${count('#tpl-workspace-box [data-tw-show]')} === 5 && document.querySelector('#tpl-workspace-box [data-tw-open="marks"]').checked && document.querySelector('#tpl-workspace-box [data-tw-show="calendar"]').checked`, 'the Default Workspace page');
          await open('template/default/workspace', `${count('#tpl-workspace-box .tf-line')} === 3 && ${count('#tpl-workspace-box input')} === 0 && !!document.querySelector('#tpl-workspace-card [data-tpl-copy]')`, 'the Default Workspace of the Default template');
          await shot(tab, `${size}-workspace-default`);
        });
        await test(at('Default Workspace saves'), async () => {
          await open('template/mine/workspace', `${count('#tpl-workspace-box [data-tw-show]')} === 5`, 'the Default Workspace page');
          await shot(tab, `${size}-workspace`);
          await tab.eval(`(() => { document.querySelector('#tpl-workspace-box [data-tw-show="map"]').click(); document.querySelector('#tpl-workspace-card [data-tpl-save-button]').click(); return true; })()`);
          await sleep(1200);
          const t = (await api('GET', '/api/environment/templates/mine')).json.template;
          assert.deepEqual(t.workspace.show.slice().sort(), ['calendar', 'map']);
          assert.deepEqual(t.workspace.opensWith, ['chat', 'marks']);
        });
        await test(at('Phases: the list and the measure; an edit saves'), async () => {
          await open('template/mine/phases', `${count('#tpl-phases-box [data-tp-phase]')} === 3 && document.querySelector('#tpl-phases-box [data-tp-measure]').value === 'dates' && document.querySelector('#tpl-phases-box [data-tp-main]:checked') !== null`, 'the Phases page');
          await shot(tab, `${size}-phases`);
          await tab.eval(`(() => { const m = document.querySelector('#tpl-phases-box [data-tp-measure]'); m.value = 'goals'; m.dispatchEvent(new Event('change', { bubbles: true })); document.querySelector('#tpl-phases-box [data-tp-add]').click(); const rows = document.querySelectorAll('#tpl-phases-box [data-tp-label]'); rows[rows.length - 1].value = 'Review'; document.querySelector('#tpl-phases-card [data-tpl-save-button]').click(); return true; })()`);
          await sleep(1300);
          const t = (await api('GET', '/api/environment/templates/mine')).json.template;
          assert.equal(t.phaseMeasure, 'goals');
          assert.deepEqual(t.phases.map((p) => p.label), ['Start', 'Build', 'Wrap up', 'Review']);
          assert.equal(t.phases.find((p) => p.main).id, 'build');
          await open('template/default/phases', `${count('#tpl-phases-box input')} === 0 && /Dates/.test(document.querySelector('#tpl-phases-box').textContent)`, 'the Phases of the Default template');
        });
        await test(at('Additional Reactions and Icons: core and the template\'s; your own are on the Environment tab'), async () => {
          await open('template/mine/reactions', `${count('#tpl-reactions-box .tp-chip')} > 20 && ${count('#tpl-reactions-box .tp-reaction')} === 1 && ${count('#tpl-reactions-box [data-ti-name]')} === 1 && !document.getElementById('tpl-own-additions') && !document.querySelector('#tpl-part-reactions #reactions-list') && ${count('#env-part-reactions #reactions-list')} === 1 && ${count('#env-part-reactions #icons-list')} === 1`, 'the Additional Reactions and Icons page');
          await shot(tab, `${size}-reactions`);
          await open('reactions', `${count('#env-part-reactions #reactions-list')} === 1 && document.getElementById('reactions-fixed').textContent.length > 0`, 'the Environment tab\'s Reactions and Icons');
          await shot(tab, `${size}-env-reactions`);
          await open('template/mine/reactions', `${count('#tpl-reactions-box .tp-chip')} > 20`, 'back to the template page');
          await tab.eval(`(() => { document.querySelector('#tpl-reactions-box [data-tr-add]').click(); const rows = document.querySelectorAll('#tpl-reactions-box .tp-reaction'); const last = rows[rows.length - 1]; last.querySelector('.reaction-glyph').value = '\\u{1F389}'; last.querySelector('.reaction-label').value = 'Party'; document.querySelector('#tpl-reactions-card [data-tpl-save-button]').click(); return true; })()`);
          await sleep(1300);
          const t = (await api('GET', '/api/environment/templates/mine')).json.template;
          assert.deepEqual(t.reactions.map((r) => r.label), ['Ship it', 'Party']);
          assert.deepEqual(t.iconSet, ['rocket']);
          await open('template/hours/reactions', `!document.getElementById('tpl-own-additions') && ${count('#tpl-reactions-box .tp-chip')} > 20`, 'another template\'s page has no own additions either');
          await open('template/default/reactions', `${count('#tpl-reactions-box .tp-chip')} > 20 && ${count('#tpl-reactions-box input')} === 0`, 'the Default template\'s page');
        });
        await test(at('Modules: marks, words, the starter, Plans; an edit saves'), async () => {
          await open('template/mine/modules', `${count('#tpl-modules-box .tp-module')} >= 4 && !!document.querySelector('#tpl-modules-box [data-tm="marks"]') && !document.getElementById('module-names-section').hidden`, 'the Modules page');
          await tab.eval(`document.querySelector('#tpl-modules-box [data-tm="marks"]').open = true`);
          const row = await tab.eval(`(() => { const r = document.querySelector('#tpl-modules-box [data-tm="marks"]'); return { driven: r.querySelectorAll('[data-mark="driven"]').length, def: r.querySelectorAll('[data-mark="default"]').length, own: !!r.querySelector('[data-ts="own"]'), label: !!r.querySelector('[data-tm-label]'), lists: r.querySelectorAll('[data-list-setting]').length, starter: !!r.querySelector('[data-tm-starter]:checked'), plans: [...document.querySelectorAll('#tpl-modules-box h3')].map((h) => h.textContent) }; })()`);
          assert.deepEqual([row.driven, row.def, row.own, row.label, row.lists, row.starter], [3, 3, false, false, 2, true], JSON.stringify(row));
          assert.ok(row.plans.includes('Plans'), `the planners sit under Plans (${row.plans})`);
          await shot(tab, `${size}-modules`);
          // A list setting: rows, off until the template sets it; add, rename, move, remove; a driven list is editable here; a fixed row stays.
          const L = await tab.eval(`(() => { const r = document.querySelector('#tpl-modules-box [data-tm="marks"]'); const t = r.querySelector('[data-ts="tags"]'); const p = r.querySelector('[data-ts="palette"]'); return { tagsOff: t.querySelector('.tp-list').inert === true, tagsSet: t.querySelector('[data-ts-set]').checked, tagRows: t.querySelectorAll('.list-row').length, otherRemovable: !!t.querySelector('.list-row[data-id="other"] [data-list="remove"]'), paletteOn: p.querySelector('.tp-list').inert !== true && p.querySelector('[data-ts-set]').checked, paletteRows: [...p.querySelectorAll('[data-f="label"]')].map((i) => i.value), paletteDisabled: [...p.querySelectorAll('input, button')].filter((i) => i.disabled).length }; })()`);
          assert.deepEqual(L, { tagsOff: true, tagsSet: false, tagRows: 2, otherRemovable: false, paletteOn: true, paletteRows: ['Red', 'Blue'], paletteDisabled: 0 }, JSON.stringify(L));
          await tab.eval(`(() => { const t = document.querySelector('#tpl-modules-box [data-tm="marks"] [data-ts="tags"]'); t.querySelector('[data-ts-set]').click(); const add = () => t.querySelector('[data-list="add"]').click(); add(); let rows = t.querySelectorAll('.list-row'); rows[2].querySelector('[data-f="label"]').value = 'Gamma'; add(); rows = t.querySelectorAll('.list-row'); rows[3].querySelector('[data-f="label"]').value = 'Temp'; t.querySelector('.list-row[data-id="alpha"] [data-f="label"]').value = 'Alpha two'; return true; })()`);
          assert.ok(await tab.eval(`document.querySelector('#tpl-modules-box [data-tm="marks"] [data-ts="tags"] .tp-list').inert !== true`), at('ticking "This template sets" turns the list on'));
          if (phone) {
            const small = await tab.eval(`(() => [...document.querySelectorAll('#tpl-modules-box [data-tm="marks"] [data-ts="tags"] .list-row .btn, #tpl-modules-box [data-tm="marks"] [data-ts="tags"] .list-row input[type="text"], #tpl-modules-box [data-tm="marks"] [data-ts="tags"] .list-row .icon-pick summary, #tpl-modules-box [data-tm="marks"] [data-ts="tags"] > .tp-setting-value .list-setting > .btn')].map((el) => { const b = el.getBoundingClientRect(); return b.width < 43.5 || b.height < 43.5 ? el.className + ' ' + Math.round(b.width) + 'x' + Math.round(b.height) : ''; }).filter(Boolean))()`);
            assert.deepEqual(small, [], at('list targets are under 44 px: ' + small.join('; ')));
          }
          assert.ok(await sideways() <= 1, at('the open list scrolls sideways'));
          await shot(tab, `${size}-modules-lists`);
          await tab.eval(`(() => { const t = document.querySelector('#tpl-modules-box [data-tm="marks"] [data-ts="tags"]'); t.querySelector('.list-row:last-child [data-list="remove"]').click(); t.querySelector('.list-row:last-child [data-list="up"]').click(); return true; })()`);
          await tab.eval(`(() => { const r = document.querySelector('#tpl-modules-box [data-tm="marks"]'); const s = r.querySelector('[data-ts="split"] [data-ts-set]'); s.click(); document.querySelector('#tpl-modules-card [data-tpl-save-button]').click(); return true; })()`);
          await sleep(1300);
          const t = (await api('GET', '/api/environment/templates/mine')).json.template;
          assert.deepEqual(t.modules.marks.labels.event, { one: 'meeting', many: 'meetings' }, 'the words are kept by a save on this page');
          assert.equal(t.modules.marks.settings.split, true);
          assert.deepEqual(t.modules.marks.settings.tags.map((r) => r.label), ['Other', 'Gamma', 'Alpha two'], 'the list: renamed, added, moved up, one removed');
          assert.equal(t.modules.marks.settings.palette.length, 2, 'a list that was not touched stays');
          assert.equal(t.modules.marks.settings.mode, true, 'a setting not touched stays');
          assert.ok(t.modules.marks.starter && t.modules.marks.starter['k:one'], 'the starter content is kept');
          await open('template/default/modules', `${count('#tpl-modules-box .tp-module')} >= 4 && ${count('#tpl-modules-box input')} === 0 && /offers every/.test(document.getElementById('tpl-modules-box').textContent)`, 'the Modules of the Default template');
        });
        await test(at('Experience Labels: the module words are here, under each module\'s name; the locked words stay read only; an edit saves'), async () => {
          await open('template/mine/labels', `${count('#tpl-labels-box [data-tml="marks"] [data-tm-label="event"]')} === 1 && ${count('#tpl-labels-box .tf-locked-list .tf-line')} === 8`, 'the Experience Labels page');
          const g = await tab.eval(`(() => { const g = document.querySelector('#tpl-labels-box [data-tml="marks"]'); return { head: g.querySelector('h4').textContent.trim(), one: g.querySelector('[data-tm-part="one"]').value, chat: !!document.querySelector('#tpl-labels-box [data-tml="chat"]'), lockedInputs: document.querySelectorAll('#tpl-labels-box .tf-locked input').length, after: !!(g.compareDocumentPosition(document.querySelector('#tpl-labels-box .tf-locked')) & Node.DOCUMENT_POSITION_FOLLOWING) }; })()`);
          assert.deepEqual(g, { head: 'Timesheet', one: 'meeting', chat: false, lockedInputs: 0, after: true }, JSON.stringify(g));
          if (phone) {
            const small = await tab.eval(`(() => [...document.querySelectorAll('#tpl-labels-box input[type="text"], #words-panel .btn')].map((el) => { const b = el.getBoundingClientRect(); return b.height > 0 && b.height < 43.5 ? el.name + ' ' + Math.round(b.height) : ''; }).filter(Boolean))()`);
            assert.deepEqual(small, [], at('label fields are under 44 px: ' + small.join('; ')));
          }
          await shot(tab, `${size}-labels`);
          await tab.eval(`(() => { const l = document.querySelector('#tpl-labels-box [data-tml="marks"] [data-tm-label="event"]'); l.querySelector('[data-tm-part="one"]').value = 'session'; l.querySelector('[data-tm-part="many"]').value = 'sessions'; document.querySelector('#words-panel [data-tpl-save-button]').click(); return true; })()`);
          await sleep(1300);
          const t = (await api('GET', '/api/environment/templates/mine')).json.template;
          assert.deepEqual(t.modules.marks.labels.event, { one: 'session', many: 'sessions' });
          assert.equal(t.modules.marks.name, 'Timesheet', 'the module\'s name stays');
          assert.equal(t.modules.marks.settings.mode, true, 'its settings stay');
          assert.ok(t.modules.marks.starter && t.modules.marks.starter['k:one'], 'its starter content stays');
          assert.deepEqual(t.modules.marks.settings.palette.map((r) => r.label), ['Red', 'Blue']);
          await open('template/default/labels', `${count('#tpl-labels-box [data-tml="marks"]')} === 1 && ${count('#tpl-labels-box input')} === 0 && ${count('#tpl-labels-box .tf-locked-list .tf-line')} === 8`, 'the Experience Labels of the Default template');
          await shot(tab, `${size}-labels-default`);
        });
        await test(at('every page opens from the strip and the strip scrolls to it'), async () => {
          for (const part of ['workspace', 'phases', 'reactions', 'modules']) {
            await tab.eval(`document.querySelector('#tpl-subtabs .subtab[data-tpl-part="${part}"]').click()`);
            await sleep(900);
            assert.ok(await tab.eval(`!document.getElementById('tpl-part-${part}').hidden && location.hash.endsWith('/${part}')`), at(`${part} did not open from the strip (${await tab.eval('location.hash')})`));
            assert.ok(await sideways() <= 1, at(`${part} scrolls sideways`));
          }
        });

        // Manage > Modules: the module's own tab reads the environment's template (mine): driven read only, default seeded.
        await test(at('Manage > Modules: a driven setting is read only and says whose; a default one is the template\'s until changed'), async () => {
          await tab.eval(`location.hash = 'modules/marks'`); await sleep(1500);
          const f = await tab.eval(`(() => { const card = document.querySelector('.module-settings-card[data-module="marks"]'); if (!card) return null; const rows = [...card.querySelectorAll('.module-setting')]; const by = (k) => rows.find((r) => r.querySelector('[data-key="' + k + '"]')); const mode = by('mode'); const title = by('title'); return { mode: mode && { locked: mode.hasAttribute('data-locked'), disabled: mode.querySelector('input').disabled, mark: mode.querySelector('.setting-mark')?.textContent.replace(/\\s+/g, ' ').trim() }, title: title && { disabled: title.querySelector('input').disabled, value: title.querySelector('input').value, mark: title.querySelector('.setting-mark')?.textContent.replace(/\\s+/g, ' ').trim() } }; })()`);
          assert.ok(f, 'the module has a settings card in Manage');
          assert.ok(f.mode.locked && f.mode.disabled && /Driven.*Set by the Mine template: On/.test(f.mode.mark), JSON.stringify(f.mode));
          assert.ok(!f.title.disabled && f.title.value === 'Our plan' && /Default.*From the Mine template/.test(f.title.mark), JSON.stringify(f.title));
          await shot(tab, `${size}-manage-module`);
          // Saving without changing the default leaves it the template's; changing it keeps the owner's own, and "Use the template's" drops it.
          await tab.eval(`document.querySelector('.module-settings-card[data-module="marks"] [data-save]').click()`); await sleep(900);
          let stored = (await api('GET', '/api/module-settings/environment')).json.modules.find((m) => m.id === 'marks').settings.find((d) => d.key === 'title');
          assert.equal(stored.stored, false, 'a save with the default as shown does not keep it');
          await tab.eval(`(() => { const i = document.querySelector('.module-settings-card[data-module="marks"] [data-key="title"]'); i.value = 'Mine alone'; document.querySelector('.module-settings-card[data-module="marks"] [data-save]').click(); return true; })()`); await sleep(900);
          stored = (await api('GET', '/api/module-settings/environment')).json.modules.find((m) => m.id === 'marks').settings.find((d) => d.key === 'title');
          assert.deepEqual([stored.stored, stored.value], [true, 'Mine alone']);
          assert.ok(await tab.eval(`!!document.querySelector('.module-settings-card[data-module="marks"] [data-use-template="title"]')`), 'Use the template\'s is offered');
          await tab.eval(`document.querySelector('.module-settings-card[data-module="marks"] [data-use-template="title"]').click()`); await sleep(1200);
          stored = (await api('GET', '/api/module-settings/environment')).json.modules.find((m) => m.id === 'marks').settings.find((d) => d.key === 'title');
          assert.deepEqual([stored.stored, stored.value], [false, 'Our plan']);
          // The lists on the same card: the default one is rows to edit (seeded by the template's own value or the module's), the driven one is read only.
          const lists = await tab.eval(`(() => { const card = document.querySelector('.module-settings-card[data-module="marks"]'); const by = (k) => card.querySelector('[data-list-setting][data-key="' + k + '"]'); const t = by('tags'); const p = by('palette'); return { tagRows: t.querySelectorAll('.list-row').length, tagsInert: t.inert === true, tagsEnabled: [...t.querySelectorAll('input, button')].every((i) => !i.disabled), paletteRows: [...p.querySelectorAll('[data-f="label"]')].map((i) => i.value), paletteInert: p.inert === true, paletteAllOff: [...p.querySelectorAll('input, button')].every((i) => i.disabled), driven: /Driven[^]*?Set by the Mine template: 2 in the list: Red, Blue/.test(p.closest('.module-setting').textContent) }; })()`);
          assert.deepEqual(lists, { tagRows: 3, tagsInert: false, tagsEnabled: true, paletteRows: ['Red', 'Blue'], paletteInert: true, paletteAllOff: true, driven: true }, JSON.stringify(lists));
          await shot(tab, `${size}-manage-module-lists`);
          await tab.eval(`(() => { const card = document.querySelector('.module-settings-card[data-module="marks"]'); const t = card.querySelector('[data-list-setting][data-key="tags"]'); t.querySelector('[data-list="add"]').click(); t.querySelector('.list-row:last-child [data-f="label"]').value = 'Delta'; card.querySelector('[data-save]').click(); return true; })()`); await sleep(1100);
          stored = (await api('GET', '/api/module-settings/environment')).json.modules.find((m) => m.id === 'marks').settings.find((d) => d.key === 'tags');
          assert.deepEqual([stored.stored, stored.value.map((r) => r.label)], [true, ['Other', 'Gamma', 'Alpha two', 'Delta']]);
          const sent = (await api('PUT', '/api/modules/marks/settings/environment', { values: { palette: [] } })).json;
          assert.ok(sent && sent.error, 'a driven list is refused by the server too');
        });
        await test(at('no page error, no failed request on the way'), () => assert.deepEqual(problems, []));
      } catch (err) {
        failures.push(`${size}: ${err.stack || err.message}`);
      } finally {
        await tab.close().catch(() => {});
      }
    }

    // Set up (the driven setting read only in a space) and the chip, Done and Profile's theme, at both sizes.
    for (const size of process.env.TEMPLATE_PAGES_SIZE ? [Number(process.env.TEMPLATE_PAGES_SIZE)] : [1280, 390]) {
      const tab = new Tab(browser.cdp, S.ctx);
      await tab.open(size, 'dark', false);
      const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
      await reset();
      const problems = problemsOf(tab);
      const at = (what) => `${size}: ${what}`;
      try {
        await driveScreen(tab, { as: 'admin', url: `/#join=${spaceId}`, wait: '#setup' }, S.base, S.cookies, S.ctx);
        await sleep(1800);
        await test(at('the chip under progress reads the phase and how far'), async () => {
          const chip = await tab.eval(`document.querySelector('#phase-chip .sdk-strip-sentence')?.textContent || ''`);
          assert.match(chip, /^Start · 0 of 3$/, `the chip says "${chip}"`);
          await shot(tab, `${size}-space-chip`);
        });
        await test(at('Set up: Done switches move the phase, the chip follows; a driven setting is read only'), async () => {
          await tab.eval(`document.getElementById('setup').click()`); await sleep(1200);
          await tab.eval(`document.getElementById('setup-tab-phases')?.click()`); await sleep(900);
          assert.ok(await tab.eval(`document.querySelectorAll('#setup-phase-list [data-phase-done]').length === 3 && !document.getElementById('setup-phases-measure').hidden`), 'three Done switches and the measure said');
          await shot(tab, `${size}-setup-phases`);
          await tab.eval(`document.querySelector('#setup-phase-list [data-phase-done="start"]').click()`); await sleep(1200);
          assert.equal((await api('GET', `/api/spaces/${spaceId}/phases`)).json.phases.find((p) => p.id === 'start').done, true);
          assert.match(await tab.eval(`document.querySelector('#phase-chip .sdk-strip-sentence').textContent`), /^Build · 1 of 3$/);
          await tab.eval(`document.getElementById('setup-tab-modules')?.click()`); await sleep(1500);
          const f = await tab.eval(`(() => { const card = document.querySelector('#setup-module-settings .module-settings-card[data-module="marks"]'); if (!card) return null; const row = (k) => card.querySelector('[data-key="' + k + '"]').closest('.module-setting'); return { unit: { disabled: row('unit').querySelector('select').disabled, mark: row('unit').querySelector('.setting-mark')?.textContent.replace(/\\s+/g, ' ').trim() }, split: { disabled: row('split').querySelector('input').disabled, checked: row('split').querySelector('input').checked, mark: row('split').querySelector('.setting-mark')?.textContent.replace(/\\s+/g, ' ').trim() } }; })()`);
          assert.ok(f, 'the module has a card in Set up');
          assert.ok(f.unit.disabled && /Driven.*Set by the Hours template: Hours/.test(f.unit.mark), JSON.stringify(f.unit));
          assert.ok(!f.split.disabled && f.split.checked === false && /Default.*From the Hours template/.test(f.split.mark), JSON.stringify(f.split));
          await shot(tab, `${size}-setup-modules`);
        });
        await test(at('no page error on the space or in Set up'), () => assert.deepEqual(problems, []));
      } catch (err) {
        failures.push(`${size}: the space: ${err.stack || err.message}`);
      } finally {
        await tab.close().catch(() => {});
      }

      const prof = new Tab(browser.cdp, S.ctx);
      await prof.open(size, 'dark', false);
      const pp = problemsOf(prof);
      try {
        await driveScreen(prof, { as: 'admin', url: '/profile', wait: '#name' }, S.base, S.cookies, S.ctx);
        await sleep(1500);
        await test(at('Profile: the theme choice saves and clears'), async () => {
          const themes = (await api('GET', '/api/me/themes')).json.themes;
          assert.ok(themes.length >= 1, 'the environment has a theme to choose');
          assert.ok(await prof.eval(`!document.getElementById('section-theme').hidden && document.getElementById('theme-pick').options.length === ${themes.length + 1}`), 'the Theme panel lists the usual and every theme');
          await shot(prof, `${size}-profile-theme`);
          await prof.eval(`(() => { const p = document.getElementById('theme-pick'); p.value = ${JSON.stringify(themes[0].id)}; p.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`); await sleep(1200);
          assert.equal((await api('GET', '/api/me/themes')).json.theme, themes[0].id);
          await prof.eval(`(() => { const p = document.getElementById('theme-pick'); p.value = ''; p.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`); await sleep(1200);
          assert.equal((await api('GET', '/api/me/themes')).json.theme, null);
          if (size < 640) assert.ok(await prof.eval(`document.getElementById('theme-pick').getBoundingClientRect().height >= 44`), 'the picker is 44 px tall on a phone');
        });
        await test(at('no page error on Profile'), () => assert.deepEqual(pp, []));
      } catch (err) {
        failures.push(`${size}: profile: ${err.stack || err.message}`);
      } finally {
        await prof.close().catch(() => {});
      }
    }

    // 44 px targets on the phone, on the pages this adds.
    {
      const tab = new Tab(browser.cdp, S.ctx);
      await tab.open(390, 'dark', false);
      const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
      try {
        await driveScreen(tab, { as: 'admin', url: '/admin', wait: '#set-environment-name' }, S.base, S.cookies, S.ctx);
        await sleep(1200);
        await test('390: every button, switch and field on the new pages is at least 44 px tall', async () => {
          const small = [];
          for (const part of ['workspace', 'phases', 'reactions', 'modules', 'labels']) {
            await tab.eval(`location.hash = 'template/mine/${part}'`); await sleep(1300);
            if (part === 'modules') await tab.eval(`document.querySelector('#tpl-modules-box [data-tm="marks"]').open = true`);
            const found = await tab.eval(`[...document.querySelectorAll('#tpl-part-${part} button, #tpl-part-${part} select, #tpl-part-${part} input:not([type=hidden]), #tpl-part-${part} summary')].filter((e) => e.getClientRects().length && !e.closest('[hidden]') && (e.tagName === 'SUMMARY' || !e.closest('details.icon-pick:not([open])'))).map((e) => { const el = e.type === 'checkbox' || e.type === 'radio' ? (e.closest('label') || e) : e; const r = el.getBoundingClientRect(); return { part: '${part}', what: (e.getAttribute('aria-label') || e.textContent || e.name || e.dataset.tpl || e.tagName).trim().slice(0, 30), h: Math.round(r.height) }; }).filter((x) => x.h < 44)`);
            small.push(...found);
          }
          assert.deepEqual(small, [], `smaller than 44 px: ${JSON.stringify(small)}`);
        });
      } catch (err) {
        failures.push(`390 targets: ${err.stack || err.message}`);
      } finally {
        await tab.close().catch(() => {});
      }
    }
  } catch (err) {
    failures.push(`the browser part: ${err.stack || err.message}`);
  } finally {
    if (browser) { browser.cdp.ws.close(); await stopBrowser(browser.child, browser.dir).catch(() => {}); }
    if (server) await stopServer(server).catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

if (failures.length) {
  for (const f of failures) console.error(`check-template-pages-b: FAIL ${f}`);
  console.error(`check-template-pages-b: ${failures.length} failed, ${n} passed`);
  process.exit(1);
}
say(`${n} checks passed`);
