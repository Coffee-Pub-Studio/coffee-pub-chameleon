#!/usr/bin/env node
/*
 * check-reactions-icons.mjs -- the environment's own reactions and icons and a template's additions
 * (plan-templates-redesign.md, decision 12 as corrected 2026-11-16, steps 18 and 19), on a real server with a throwaway
 * DATA_DIR:
 *   - a new environment's lists are the built-in 105 reactions and 113 icons, in order: /api/branding, a space's /look,
 *     the owner's settings (ownReactions, ownIcons) and what is stored (with builtinListsSeeded); the owner's settings
 *     also answer the built-in lists (`builtIn`), which /api/branding never carries;
 *   - an owner's save that removes a built-in reaction and a built-in icon, reorders and adds is read back exactly, in
 *     /api/branding, a space's /look, the owner's settings and the file; a repeat inside the list is dropped; the first
 *     six of the new order are the call's keys 1 to 6; an empty reaction list is kept;
 *   - refusals (400, one sentence each): a list that is not a list, a list over its cap (300 reactions, 400 icons),
 *     resetLists that is not true, resetLists with the lists; a member and a signed-out caller cannot write the lists
 *     (403, 401), and a space save that carries reactions or icons changes neither list;
 *   - both lists at their caps go in one PATCH (that route reads up to 256 KB; every other keeps 64 KB); an id given is
 *     kept next to an earlier entry without one; < >, controls, text-direction and zero-width characters are taken out
 *     (an emoji's joiner stays); an icon whose classes name no icon is refused (400);
 *   - Start again from the built-in set (PATCH /api/settings { resetLists: true }) restores the 105 and 113;
 *   - a template's additions come after the environment's list: an addition that repeats an entry in it (a reaction by id
 *     or by glyph, an icon by id) is dropped there, and the template's save is not refused for it; they show only while
 *     the template is read, and a switch never copies them into, or changes, the environment's lists;
 *   - an icon the owner adds may be the home icon; a removed built-in one may not (400);
 *   - a removed icon still in use (the home icon, a space's link icon, a module's display icon, a saved layout's icon, a
 *     system layout's icon) is drawn from `inUseIcons`, never offered in `icons`, the module keeps its display icon, and a
 *     new pick of it is refused (400) while sending back the one a record has already is taken;
 *   - the lists survive a restart as saved (they are filled once, never again);
 *   - icons in use after a template switch, the bound of 200 on them, stored ids that are no Font Awesome icon, a space on
 *     its own template, and a picker never offering what the save refuses (as before the correction);
 *   - hosted: GET /api/host/settings answers `builtIn` to the host admin only (not signed out, an owner or a member);
 *   - hosted: a second environment's lists start from the built-in set and stay its own; an icon in use in one
 *     environment never shows in another's inUseIcons.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.PRODUCT_NAME = 'Testname';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { DEFAULT_REACTION_LIST, DEFAULT_ICON_LIST } = require('../server/default-lists.js');

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-reactions-icons-'));
const templatesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-reactions-icons-t-'));
const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
  cwd: ROOT,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, PRODUCT_NAME: 'Testname', ADMIN_PASSWORD: 'testpass1234' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { out += d; });
const port = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 20000);
  const onData = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
});
let token = '';
async function call(method, urlPath, body) {
  const headers = { accept: 'application/json', ...(token ? { cookie: `app_session=${token}` } : {}) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
const ids = (list) => list.map((x) => x.id);
const LINK_REFUSED = 'That icon is not one this environment offers.';
const { Store } = require('../server/store.js');
const templates = require('../server/templates.js');

try {
  token = (await call('POST', '/api/login', { login: 'admin', password: 'testpass1234' })).json.token;
  const space = (await call('POST', '/api/spaces', { name: 'Trip' })).json.space.id;
  const branding = async () => (await call('GET', '/api/branding')).json;
  const look = async () => (await call('GET', `/api/spaces/${space}/look`)).json.look;

  const settings = async () => (await call('GET', '/api/settings')).json.settings;
  const storedSettings = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'app.json'), 'utf8')).settings;
  const clone = (x) => JSON.parse(JSON.stringify(x));

  await test('a new environment\'s lists are the built-in 105 reactions and 113 icons, in order, everywhere they are read', async () => {
    for (const read of [branding, look]) {
      const got = await read();
      assert.deepEqual(got.reactions, DEFAULT_REACTION_LIST);
      assert.deepEqual(got.icons, DEFAULT_ICON_LIST);
    }
    const s = await settings();
    assert.deepEqual([s.ownReactions, s.ownIcons], [DEFAULT_REACTION_LIST, DEFAULT_ICON_LIST], 'the owner\'s settings answer the whole lists');
    assert.deepEqual(s.builtIn, { reactions: DEFAULT_REACTION_LIST, icons: DEFAULT_ICON_LIST }, 'and the built-in lists, for Start again');
    const stored = storedSettings();
    assert.deepEqual([stored.reactions, stored.icons, stored.builtinListsSeeded], [DEFAULT_REACTION_LIST, DEFAULT_ICON_LIST, true], 'stored, and marked filled');
    const signedOut = await fetch(`http://127.0.0.1:${port}/api/branding`).then((r) => r.json());
    assert.equal('builtIn' in signedOut, false, '/api/branding never carries the built-in lists');
  });

  // The environment's edited lists, as an owner's page would send them: Heart and dragon removed, Laugh moved first, an
  // addition in the middle of each, and a repeat inside each list (dropped).
  const yes = { id: 'yes', glyph: '✅', label: 'Yes' };
  const myCat = { id: 'my-cat', classes: 'fa-solid fa-cat', label: 'cat' };
  const editedReactions = (() => {
    const list = clone(DEFAULT_REACTION_LIST).filter((r) => r.id !== 'heart');
    const laugh = list.splice(list.findIndex((r) => r.id === 'laugh'), 1)[0];
    list.unshift(laugh);
    list.splice(3, 0, yes);
    return list;
  })();
  const editedIcons = (() => {
    const list = clone(DEFAULT_ICON_LIST).filter((i) => i.id !== 'dragon');
    list.splice(2, 0, myCat);
    return list;
  })();
  const saveEdited = () => call('PATCH', '/api/settings', { reactions: [...editedReactions, { id: 'yes-again', glyph: '✅', label: 'Twice' }, { id: 'laugh', glyph: '🙂', label: 'Laugh again' }], icons: [...editedIcons, { id: 'my-cat', classes: 'fa-solid fa-dog', label: 'dog' }] });

  await test('an owner removes a built-in reaction and icon, reorders and adds: read back exactly; the first six are the keys', async () => {
    const saved = await saveEdited();
    assert.equal(saved.status, 200, saved.text);
    assert.deepEqual([saved.json.settings.ownReactions, saved.json.settings.ownIcons], [editedReactions, editedIcons], 'a repeat inside a list is dropped');
    for (const [label, got] of [['branding', await branding()], ['a space\'s look', await look()], ['the owner\'s settings', await settings()]]) {
      assert.deepEqual(got.reactions, editedReactions, `${label}: reactions`);
      assert.deepEqual(got.icons, editedIcons, `${label}: icons`);
      assert.deepEqual(ids(got.reactions).slice(0, 6), ['laugh', 'black-heart', '100', 'yes', 'hi', 'up'], `${label}: the call's keys 1 to 6`);
      assert.equal(ids(got.reactions).includes('heart') || ids(got.icons).includes('dragon'), false, `${label}: removed ones are gone`);
    }
    const stored = storedSettings();
    assert.deepEqual([stored.reactions, stored.icons], [editedReactions, editedIcons], 'stored as saved');
  });

  await test('an empty reaction list is kept; allowReactions stays the switch', async () => {
    const r = await call('PATCH', '/api/settings', { reactions: [] });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.json.settings.ownReactions, (await branding()).reactions, (await look()).reactions, storedSettings().reactions], [[], [], [], []]);
    assert.equal((await branding()).allowReactions, true, 'the switch is its own');
    assert.equal((await saveEdited()).status, 200);
  });

  await test('refusals: a list that is not one, a list over its cap, a bad resetLists; only an owner writes the lists', async () => {
    const tooMany = (n, make) => Array.from({ length: n }, (_, i) => make(i));
    for (const [body, sentence] of [
      [{ reactions: 'heart' }, 'reactions is a list of reactions.'],
      [{ icons: { id: 'x' } }, 'icons is a list of icons.'],
      [{ reactions: tooMany(301, (i) => ({ id: `r${i}`, glyph: `${i}`, label: `R ${i}` })) }, 'The reaction list holds at most 300 reactions.'],
      [{ icons: tooMany(401, (i) => ({ id: `i${i}`, classes: 'fa-solid fa-cat', label: `I ${i}` })) }, 'The icon list holds at most 400 icons.'],
      [{ resetLists: 'yes' }, 'resetLists is true, or left out.'],
      [{ resetLists: true, reactions: [] }, 'Send resetLists or the lists, not both.'],
    ]) {
      const r = await call('PATCH', '/api/settings', body);
      assert.deepEqual([r.status, r.json?.error], [400, sentence], JSON.stringify(body).slice(0, 60));
    }
    assert.deepEqual([(await settings()).ownReactions, (await settings()).ownIcons], [editedReactions, editedIcons], 'nothing refused was saved');
    const made = await call('POST', '/api/users', { login: 'nell', displayName: 'Nell', role: 'member', password: 'nell-password-1' });
    assert.equal(made.status, 201, made.text);
    const admin = token;
    try {
      token = (await call('POST', '/api/login', { login: 'nell', password: 'nell-password-1' })).json.token;
      assert.ok(token, 'the member signed in');
      for (const body of [{ reactions: [] }, { icons: [] }, { resetLists: true }]) assert.equal((await call('PATCH', '/api/settings', body)).status, 403, `a member: ${Object.keys(body)[0]}`);
      assert.equal((await call('GET', '/api/settings')).status, 403, 'nor reads the owner\'s settings');
      token = '';
      assert.equal((await call('PATCH', '/api/settings', { resetLists: true })).status, 401, 'signed out');
    } finally {
      token = admin;
    }
    assert.deepEqual([(await settings()).ownReactions, (await settings()).ownIcons], [editedReactions, editedIcons], 'unchanged');
  });

  await test('both lists at their caps (300 reactions, 400 icons, full-length ids and labels) go in one PATCH', async () => {
    const pad = (text, n) => text.padEnd(n, 'x').slice(0, n);
    const solid = fs.readdirSync(path.join(ROOT, 'node_modules', '@fortawesome', 'fontawesome-free', 'svgs', 'solid')).map((f) => f.slice(0, -4));
    const reactions = Array.from({ length: 300 }, (_, i) => ({ id: pad(`r${i}-`, 24), glyph: pad(`${i}`, 8), label: pad(`Reaction ${i} `, 40) }));
    const icons = Array.from({ length: 400 }, (_, i) => ({ id: pad(`i${i}-`, 40), classes: `fa-solid fa-${solid[i]}`, label: pad(`Icon ${i} `, 40) }));
    const body = JSON.stringify({ reactions, icons });
    assert.ok(Buffer.byteLength(body) > 64 * 1024, `over the 64 KB every other JSON body is held to: ${Buffer.byteLength(body)}`);
    const r = await call('PATCH', '/api/settings', { reactions, icons });
    assert.equal(r.status, 200, r.text.slice(0, 200));
    assert.deepEqual([r.json.settings.ownReactions, r.json.settings.ownIcons], [reactions, icons]);
    const huge = await call('PATCH', '/api/settings', { reactions, icons, loginText: 'x'.repeat(300 * 1024) });
    assert.deepEqual([huge.status, huge.json?.error], [413, 'that request is over 256 KB'], 'and no more than 256 KB');
    const other = await call('PATCH', `/api/spaces/${space}`, { description: 'x'.repeat(70 * 1024) });
    assert.equal(other.status, 413, 'every other route keeps its 64 KB');
    assert.equal((await saveEdited()).status, 200);
  });

  await test('an id given is kept next to an earlier entry without one; a made-up id never takes it', async () => {
    const r = await call('PATCH', '/api/settings', { reactions: [{ glyph: 'A', label: 'fire' }, { id: 'fire', glyph: 'B', label: 'Fire' }], icons: [{ classes: 'fa-solid fa-star' }, { id: 'star', classes: 'fa-solid fa-moon', label: 'moon' }] });
    assert.equal(r.status, 200, r.text);
    const [first, second] = r.json.settings.ownReactions;
    assert.equal(second.id, 'fire', 'the id given wins');
    assert.notEqual(first.id, 'fire');
    assert.deepEqual([first.glyph, first.label], ['A', 'fire']);
    const [star, moon] = r.json.settings.ownIcons;
    assert.deepEqual(moon, { id: 'star', classes: 'fa-solid fa-moon', label: 'moon' }, 'the icon\'s id given wins');
    assert.notEqual(star.id, 'star');
    assert.equal(star.classes, 'fa-solid fa-star');
    assert.equal((await saveEdited()).status, 200);
  });

  await test('the lists hold plain text: < and >, controls, text-direction and zero-width characters are taken out; an emoji\'s joiner stays', async () => {
    const r = await call('PATCH', '/api/settings', {
      reactions: [
        { id: 'a', glyph: '<b>\u202e!', label: '<img src=x>\u2066Hi\u2069\u200b\u0007' },
        { id: 'b', glyph: '\u{1F9D9}\u200d♂️', label: 'Wiz\u200dard\u200e' },
        { id: 'c', glyph: '\u200b\u202e', label: 'Nothing left' },
      ],
      icons: [{ id: 'd', classes: 'fa-solid fa-cat', label: '<cat>\u202e\ufeff' }],
    });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.settings.ownReactions, [{ id: 'a', glyph: 'b!', label: 'img src=xHi' }, { id: 'b', glyph: '\u{1F9D9}\u200d♂️', label: 'Wizard' }], 'a reaction with no glyph left is dropped');
    assert.deepEqual(r.json.settings.ownIcons, [{ id: 'd', classes: 'fa-solid fa-cat', label: 'cat' }]);
    const signedOut = await fetch(`http://127.0.0.1:${port}/api/branding`).then((x) => x.text());
    assert.equal(/[<>\u202a-\u202e\u2066-\u2069\u200b\ufeff]/.test(JSON.parse(signedOut).reactions.map((x) => x.glyph + x.label).join('')), false, 'nothing of it published');
    assert.equal((await saveEdited()).status, 200);
  });

  await test('a list of which nothing can be read is refused, never stored as empty; [] is the owner\'s to send; a mixed reaction list keeps its good entries', async () => {
    for (const [body, sentence] of [[{ reactions: [null, 1, 'a'] }, 'None of those reactions could be read.'], [{ icons: [null, 1, 'a'] }, 'None of those icons could be read.'], [{ reactions: [{ glyph: '​' }, {}] }, 'None of those reactions could be read.']]) {
      const r = await call('PATCH', '/api/settings', body);
      assert.deepEqual([r.status, r.json?.error], [400, sentence], JSON.stringify(body));
    }
    assert.deepEqual([(await settings()).ownReactions, (await settings()).ownIcons], [editedReactions, editedIcons], 'nothing refused was saved');
    const empty = await call('PATCH', '/api/settings', { reactions: [], icons: [] });
    assert.equal(empty.status, 200, empty.text);
    assert.deepEqual([empty.json.settings.ownReactions, empty.json.settings.ownIcons], [[], []], 'an empty list is kept');
    const mixed = await call('PATCH', '/api/settings', { reactions: [null, { id: 'yes', glyph: '✅', label: 'Yes' }, 1, 'a', { id: 'up', glyph: '\u{1F44D}', label: 'Up' }] });
    assert.equal(mixed.status, 200, mixed.text);
    assert.deepEqual(mixed.json.settings.ownReactions, [{ id: 'yes', glyph: '✅', label: 'Yes' }, { id: 'up', glyph: '\u{1F44D}', label: 'Up' }], 'the good entries kept, in order');
    assert.equal((await saveEdited()).status, 200);
  });

  await test('an icon that names no Font Awesome icon is refused', async () => {
    for (const icon of [{ id: 'proto', classes: 'fa-solid' }, { id: 'odd', classes: 'spin evil' }, { id: 'none' }]) {
      const r = await call('PATCH', '/api/settings', { icons: [...editedIcons, icon] });
      assert.deepEqual([r.status, r.json?.error], [400, `Icon ${editedIcons.length + 1} names no Font Awesome icon; give its classes, such as fa-solid fa-star.`], JSON.stringify(icon));
    }
    assert.deepEqual((await settings()).ownIcons, editedIcons, 'nothing refused was saved');
  });

  await test('an icon\'s name is its last class that is not a style, size or utility; with none left it is refused', async () => {
    // The list of utility classes matches the Font Awesome Free this server ships: every class its css draws that names no svg.
    const FA = path.join(ROOT, 'node_modules', '@fortawesome', 'fontawesome-free');
    const svgs = new Set(['solid', 'regular', 'brands'].flatMap((style) => fs.readdirSync(path.join(FA, 'svgs', style)).map((f) => f.slice(0, -4))));
    const cssClasses = new Set([...fs.readFileSync(path.join(FA, 'css', 'all.css'), 'utf8').matchAll(/\.fa-([a-z0-9-]+)/g)].map((m) => m[1]));
    const { FA_UTILITY } = require('../server/fa-solid.js');
    const missing = [...cssClasses].filter((c) => !svgs.has(c) && !FA_UTILITY.has(c));
    assert.deepEqual(missing, [], 'every utility class of the css is known');
    assert.deepEqual([...FA_UTILITY].filter((c) => svgs.has(c)), [], 'and none of them is an icon');
    const r = await call('PATCH', '/api/settings', { icons: [
      { classes: 'fa-solid fa-dragon fa-spin' }, { classes: 'fa-solid fa-dice fa-xl' }, { classes: 'fa-solid fa-star fa-rotate-90' },
      { classes: 'fa-solid fa-rotate-left fa-flip-horizontal fa-2x fa-fw' }, { classes: 'fa-brands fa-xbox fa-beat-fade' },
    ] });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.settings.ownIcons.map((i) => [i.id, i.label]), [['dragon', 'dragon'], ['dice', 'dice'], ['star', 'star'], ['rotate-left', 'rotate left'], ['xbox', 'xbox']]);
    for (const classes of ['fa-solid fa-spin', 'fa-solid fa-xl', 'fa-solid fa-rotate-90 fa-pulse', 'fa-brands fa-sr-only', 'fa-solid fa-stack-2x', 'fa-solid fa-layers-counter']) {
      const bad = await call('PATCH', '/api/settings', { icons: [{ id: 'x', classes }] });
      assert.deepEqual([bad.status, bad.json?.error], [400, 'Icon 1 names no Font Awesome icon; give its classes, such as fa-solid fa-star.'], classes);
    }
    assert.equal((await saveEdited()).status, 200);
  });

  await test('the soft hyphen goes too; a template reaction that repeats an environment\'s glyph shows once', async () => {
    const r = await call('PATCH', '/api/settings', { reactions: [...editedReactions.filter((x) => x.id !== 'up'), { id: 'thumb', glyph: '\u{1F44D}­', label: 'Thu­mb' }] });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json.settings.ownReactions.at(-1), { id: 'thumb', glyph: '\u{1F44D}', label: 'Thumb' });
    const hidden = await call('POST', '/api/environment/templates', { from: 'project', id: 'hidden', name: 'Hidden' });
    assert.equal(hidden.status, 201, hidden.text);
    const refused = await call('PATCH', '/api/environment/templates/hidden', { reactions: [{ id: 'up2', glyph: '\u{1F44D}​', label: 'Up' }] });
    assert.equal(refused.status, 400, `a template glyph with a zero-width space is refused: ${refused.text}`);
    assert.equal((await call('PATCH', '/api/environment/templates/hidden', { reactions: [{ id: 'up2', glyph: '\u{1F44D}', label: 'Up' }] })).status, 200);
    assert.equal((await call('PATCH', '/api/settings', { template: 'hidden' })).status, 200);
    const b = await branding();
    assert.equal(b.reactions.filter((x) => x.glyph === '\u{1F44D}').length, 1, 'shown once');
    assert.equal((await call('PATCH', '/api/settings', { template: 'default' })).status, 200);
    assert.equal((await call('DELETE', '/api/environment/templates/hidden')).status < 300, true);
    assert.equal((await saveEdited()).status, 200);
  });

  await test('Manage reads and posts the environment\'s lists, so what a template adds never becomes the environment\'s', async () => {
    const src = fs.readFileSync(path.join(ROOT, 'public', 'admin.js'), 'utf8');
    assert.ok(/renderReactionRows\(settings\.ownReactions\)/.test(src) && /renderIconRows\(settings\.ownIcons\)/.test(src), 'the rows are filled from ownReactions and ownIcons');
    assert.equal(/render(Reaction|Icon)Rows\(settings\.(reactions|icons)\)/.test(src), false, 'never from the resolved lists');
    // What Manage does: read the settings, post the rows back as they are (the glyph, label and id of each, the icon's classes).
    const got = await settings();
    const posted = await call('PATCH', '/api/settings', { reactions: got.ownReactions.map((r) => ({ id: r.id, glyph: r.glyph, label: r.label })), icons: got.ownIcons.map((i) => ({ id: i.id, classes: i.classes, label: i.label })) });
    assert.equal(posted.status, 200, posted.text);
    assert.deepEqual([posted.json.settings.ownReactions, posted.json.settings.ownIcons], [got.ownReactions, got.ownIcons], 'a round trip changes nothing');
  });

  await test('an icon the owner adds, and a built-in one still listed, may be the home icon; a removed one and one nobody has may not', async () => {
    assert.equal((await call('PATCH', '/api/settings', { homeIcon: 'my-cat' })).status, 200);
    assert.equal((await call('PATCH', '/api/settings', { homeIcon: 'ghost' })).status, 200, 'a built-in one');
    for (const bad of ['dragon', 'not-an-icon']) {
      const r = await call('PATCH', '/api/settings', { homeIcon: bad });
      assert.equal(r.status, 400, `${bad}: ${r.text}`);
    }
    assert.equal((await call('PATCH', '/api/settings', { homeIcon: null })).status, 200);
  });

  await test('a space has none of its own: a space save with reactions or icons changes neither list', async () => {
    const before = [await look(), await branding()].map((x) => [x.reactions, x.icons]);
    const r = await call('PATCH', `/api/spaces/${space}`, { reactions: [{ id: 'boat', glyph: '⛵', label: 'Boat' }], icons: [{ id: 'boat', classes: 'fa-solid fa-ship', label: 'ship' }], iconSet: ['ship'] });
    assert.equal(r.status, 200, r.text);
    for (const key of ['reactions', 'icons', 'iconSet']) assert.equal(key in r.json.space, false, `the space does not keep ${key}`);
    assert.deepEqual([await look(), await branding()].map((x) => [x.reactions, x.icons]), before);
    const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'app.json'), 'utf8'));
    assert.equal(JSON.stringify(stored.spaces).includes('boat'), false);
  });

  await test('a template\'s additions come after the environment\'s list; one that repeats an entry in it is dropped, and the save is not refused; a switch copies nothing', async () => {
    const own = async () => { const s = await settings(); return { ownReactions: s.ownReactions, ownIcons: s.ownIcons }; };
    const stored = () => { const s = storedSettings(); return { reactions: s.reactions, icons: s.icons }; };
    const before = await own();
    const storedBefore = stored();
    assert.deepEqual(before, { ownReactions: editedReactions, ownIcons: editedIcons });
    const copy = await call('POST', '/api/environment/templates', { from: 'project', id: 'myproject', name: 'My project' });
    assert.equal(copy.status, 201, copy.text);
    const tpl = (await call('GET', '/api/environment/templates/myproject')).json.template;
    // Laugh (by id, another glyph), a glyph the environment has under another id, and an icon it has: each repeats.
    const tplReactions = [{ id: 'laugh', glyph: '\u{1F639}', label: 'Cat laugh' }, { id: 'tick', glyph: '✅', label: 'Tick' }, { id: 'ship', glyph: '\u{1F680}', label: 'Ship it' }];
    const edit = await call('PATCH', '/api/environment/templates/myproject', { modules: { ...tpl.modules, todo: { ...(tpl.modules.todo || {}), icon: 'list-check' } }, reactions: tplReactions, iconSet: ['ghost', 'anchor'] });
    assert.equal(edit.status, 200, `a repeat of the environment's list is not refused: ${edit.text}`);
    // Removing Heart from the template's own view is no business of the template's: a built-in the environment removed
    // may be a template's addition, and then it shows there.
    const heartBack = await call('PATCH', '/api/environment/templates/myproject', { reactions: [...tplReactions, { id: 'heart', glyph: '❤️', label: 'Heart' }], iconSet: ['ghost', 'anchor', 'dragon'] });
    assert.equal(heartBack.status, 200, heartBack.text);
    const added = ['diagram-project', 'list-check', 'anchor', 'dragon']; // its home icon, a module's icon, its iconSet: none of them the environment's now
    for (const id of added) assert.equal(editedIcons.some((i) => i.id === id), false, `${id} is not the environment's`);
    for (const [step, body] of [['switch to the copy', { template: 'myproject' }], ['confirm its offer', null], ['switch back to Default', { template: 'default' }], ['switch to Project', { template: 'project' }], ['and back again', { template: 'default' }]]) {
      const offer = body ? null : (await call('GET', '/api/environment/template')).json.offer;
      const r = body ? await call('PATCH', '/api/settings', body) : await call('POST', '/api/environment/template/apply', { modules: [], lobby: true, spaceDefaults: true, offerId: offer?.offerId, version: offer?.version });
      assert.equal(r.status, 200, `${step}: ${r.text}`);
      assert.deepEqual(await own(), before, `${step}: ownReactions and ownIcons unchanged`);
      assert.deepEqual(stored(), storedBefore, `${step}: and so is what is stored`);
      const b = await branding();
      const on = (await settings()).template?.id;
      if (on === 'myproject') {
        assert.deepEqual(b.reactions, [...editedReactions, tplReactions[2], { id: 'heart', glyph: '❤️', label: 'Heart' }], `${step}: the environment's list, then the additions; a repeat by id or glyph dropped`);
        assert.deepEqual(ids(b.icons).slice(0, editedIcons.length), ids(editedIcons), `${step}: the environment's icons first, in order`);
        assert.equal(ids(b.icons).filter((id) => id === 'ghost').length, 1, `${step}: an icon the environment has is not listed twice`);
        for (const id of added) assert.ok(ids(b.icons).includes(id), `${step}: ${id} is offered while the template is read`);
        assert.equal((await call('PATCH', '/api/settings', { homeIcon: 'list-check' })).status, 200, 'a template\'s icon may be picked while it is read');
        assert.equal((await call('PATCH', '/api/settings', { homeIcon: null })).status, 200);
        assert.deepEqual(await own(), before, 'picking one copies nothing');
      } else if (on === 'project') {
        assert.ok(ids(b.icons).includes('diagram-project'), `${step}: Project's home icon is offered`);
        assert.equal(ids(b.icons).includes('list-check'), false);
      } else {
        for (const id of added) assert.equal(ids(b.icons).includes(id), false, `${step}: ${id} goes with the template`);
        assert.equal(ids(b.reactions).includes('ship'), false);
        assert.deepEqual([b.reactions, b.icons], [editedReactions, editedIcons], `${step}: the environment's own lists`);
      }
    }
  });

  await test('a removed icon still in use is drawn from inUseIcons, never offered, and a new pick of it is refused', async () => {
    const removed = { home: 'ghost', link: 'dungeon', display: 'ring', layout: 'puzzle-piece', system: 'wand-sparkles' };
    for (const id of Object.values(removed)) assert.ok(ids(editedIcons).includes(id), `${id} is offered before`);
    const sp = (await call('POST', '/api/spaces', { name: 'In use', linkIcon: removed.link })).json.space.id;
    assert.equal((await call('PATCH', '/api/settings', { homeIcon: removed.home })).status, 200);
    assert.equal((await call('PATCH', '/api/modules/chat', { displayIcon: removed.display })).status, 200);
    const made = await call('POST', `/api/spaces/${sp}/layouts`, { name: 'Kept', shared: true, shape: 'one', areas: [null], icon: removed.layout });
    assert.equal(made.status, 201, made.text);
    assert.equal((await call('PATCH', `/api/spaces/${sp}/layouts/system/workspace`, { icon: removed.system })).status, 200);
    const fewer = editedIcons.filter((i) => !Object.values(removed).includes(i.id));
    const saved = await call('PATCH', '/api/settings', { icons: fewer });
    assert.equal(saved.status, 200, saved.text);
    for (const [label, got] of [['branding', await branding()], ['a space\'s look', (await call('GET', `/api/spaces/${sp}/look`)).json.look]]) {
      assert.deepEqual(got.icons, fewer, `${label}: not offered`);
      for (const id of Object.values(removed)) assert.ok(got.inUseIcons.some((i) => i.id === id && i.classes === `fa-solid fa-${id}`), `${label}: ${id} drawn from inUseIcons`);
    }
    assert.equal((await branding()).homeIcon, removed.home, 'the home icon is kept');
    const chat = (await call('GET', '/api/modules')).json.builtin.find((m) => m.id === 'chat');
    assert.deepEqual([chat.displayIcon, chat.ownDisplayIcon], [removed.display, removed.display], 'the module keeps its display icon');
    // Sent back unchanged: taken. A new pick: refused, each with its sentence.
    assert.equal((await call('PATCH', '/api/settings', { homeIcon: removed.home })).status, 200);
    assert.equal((await call('PATCH', '/api/modules/chat', { displayIcon: removed.display })).status, 200);
    assert.equal((await call('PATCH', `/api/spaces/${sp}`, { linkIcon: removed.link })).status, 200);
    for (const [label, r, sentence] of [
      ['home icon', await call('PATCH', '/api/settings', { homeIcon: removed.link }), 'unknown home icon'],
      ['link icon', await call('PATCH', `/api/spaces/${space}`, { linkIcon: removed.link }), LINK_REFUSED],
      ['display icon', await call('PATCH', '/api/modules/chat', { displayIcon: removed.home }), `There is no icon called ${removed.home} in this environment's icons.`],
      ['saved layout', await call('POST', `/api/spaces/${sp}/layouts`, { name: 'New', shared: true, shape: 'one', areas: [null], icon: removed.layout }), 'Pick an icon from the list.'],
      ['system layout', await call('PATCH', `/api/spaces/${space}/layouts/system/workspace`, { icon: removed.system }), 'Pick an icon from the list.'],
    ]) assert.deepEqual([r.status, r.json?.error], [400, sentence], label);
    // Tidy: the built-in set again (Start again), and nothing in use.
    assert.equal((await call('PATCH', '/api/settings', { homeIcon: null })).status, 200);
    assert.equal((await call('PATCH', '/api/modules/chat', { displayIcon: null })).status, 200);
    assert.equal((await call('PATCH', `/api/spaces/${sp}/layouts/system/workspace`, { icon: null })).status, 200);
    assert.equal((await call('DELETE', `/api/spaces/${sp}`)).status, 200);
    assert.deepEqual((await branding()).inUseIcons, [], 'once unused, drawn no more');
  });

  await test('Start again from the built-in set restores the 105 and 113, everywhere they are read', async () => {
    const r = await call('PATCH', '/api/settings', { resetLists: true });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.json.settings.ownReactions, r.json.settings.ownIcons], [DEFAULT_REACTION_LIST, DEFAULT_ICON_LIST]);
    for (const got of [await branding(), await look()]) assert.deepEqual([got.reactions, got.icons], [DEFAULT_REACTION_LIST, DEFAULT_ICON_LIST]);
    assert.deepEqual([storedSettings().reactions, storedSettings().icons], [DEFAULT_REACTION_LIST, DEFAULT_ICON_LIST]);
  });

  // Every icon a picker shows is one the save takes (Thomas: a picker never offers what the save refuses). The pickers
  // read /api/branding's `icons` (public/brand.js getIcons): Home's home icon, a module's display icon (its solid ones),
  // a space's link icon and its layouts' icons; a space's /look lists its own. Each is tried against every save.
  const pickerEqualsSave = async (sp, label) => {
    const b = await branding();
    const lk = (await call('GET', `/api/spaces/${sp}/look`)).json.look;
    const env = ids(b.icons);
    const both = [...new Set([...env, ...ids(lk.icons)])];
    for (const got of [b, lk]) {
      assert.ok(Array.isArray(got.inUseIcons), `${label}: inUseIcons is a list`);
      for (const i of got.inUseIcons) assert.equal(ids(got.icons).includes(i.id), false, `${label}: an icon in use is listed apart from the offered ones (${i.id})`);
    }
    const homeBefore = (await call('GET', '/api/settings')).json.settings.homeIcon ?? null;
    const linkBefore = (await call('GET', `/api/spaces/${sp}`)).json.space.linkIcon;
    const made = await call('POST', `/api/spaces/${sp}/layouts`, { name: 'Picker', shared: true, shape: 'one', areas: [null] });
    assert.equal(made.status, 201, made.text);
    const refused = [];
    for (const id of env) {
      const r = await call('PATCH', '/api/settings', { homeIcon: id });
      if (r.status !== 200) refused.push(`homeIcon ${id}: ${r.status} ${r.text}`);
      const solid = b.icons.find((i) => i.id === id).classes === `fa-solid fa-${id}`;
      if (solid) {
        const d = await call('PATCH', '/api/modules/chat', { displayIcon: id });
        if (d.status !== 200) refused.push(`displayIcon ${id}: ${d.status} ${d.text}`);
      }
    }
    for (const id of both) {
      const l = await call('PATCH', `/api/spaces/${sp}`, { linkIcon: id });
      if (l.status !== 200) refused.push(`linkIcon ${id}: ${l.status} ${l.text}`);
      const u = await call('PUT', `/api/spaces/${sp}/layouts/${made.json.layout.id}`, { icon: id });
      if (u.status !== 200) refused.push(`layout icon ${id}: ${u.status} ${u.text}`);
      const y = await call('PATCH', `/api/spaces/${sp}/layouts/system/workspace`, { icon: id });
      if (y.status !== 200) refused.push(`system layout icon ${id}: ${y.status} ${y.text}`);
    }
    assert.deepEqual(refused, [], `${label}: a picker offered what the save refused`);
    // Back as it was; a home icon only in use (not offered now) can't be picked again, so it goes back to the template's.
    assert.equal((await call('PATCH', '/api/settings', { homeIcon: homeBefore === null || env.includes(homeBefore) ? homeBefore : null })).status, 200);
    assert.equal((await call('PATCH', `/api/spaces/${sp}`, { linkIcon: linkBefore })).status, 200);
    assert.equal((await call('PATCH', '/api/modules/chat', { displayIcon: null })).status, 200);
    assert.equal((await call('PATCH', `/api/spaces/${sp}/layouts/system/workspace`, { icon: null })).status, 200);
    assert.ok([200, 204].includes((await call('DELETE', `/api/spaces/${sp}/layouts/${made.json.layout.id}`)).status));
  };

  await test('icons in use stay drawable after the template that offered them is gone, apart from the offered list; new saves are checked against what is offered now', async () => {
    const before = (await call('GET', '/api/settings')).json.settings;
    assert.equal((await call('PATCH', '/api/settings', { template: 'project' })).status, 200);
    assert.equal((await call('PATCH', '/api/settings', { homeIcon: 'diagram-project' })).status, 200, 'Project offers its home icon');
    const linked = await call('PATCH', `/api/spaces/${space}`, { linkIcon: 'diagram-project' });
    assert.equal(linked.status, 200, linked.text);
    assert.equal((await call('PATCH', '/api/settings', { template: 'default' })).status, 200);
    const b = await branding();
    assert.equal(b.homeIcon, 'diagram-project', 'the owner\'s home icon is kept');
    for (const [label, got] of [['branding', b], ['a space\'s look', await look()]]) {
      assert.equal(ids(got.icons).includes('diagram-project'), false, `${label}: not offered (no picker shows it)`);
      assert.deepEqual(got.inUseIcons, [{ id: 'diagram-project', classes: 'fa-solid fa-diagram-project' }], `${label}: drawn from the icons in use`);
    }
    const after = (await call('GET', '/api/settings')).json.settings;
    assert.deepEqual([after.ownIcons, after.ownReactions], [before.ownIcons, before.ownReactions], 'nothing copied into the owner\'s own lists');
    // Sending it back unchanged is taken; anywhere else it is checked against what is offered now: Default does not offer it.
    assert.equal((await call('PATCH', '/api/settings', { homeIcon: 'diagram-project' })).status, 200, 'the home icon it has already');
    const other = (await call('POST', '/api/spaces', { name: 'Other' })).json.space.id;
    assert.deepEqual(await call('PATCH', `/api/spaces/${other}`, { linkIcon: 'diagram-project' }).then((r) => [r.status, r.json?.error]), [400, LINK_REFUSED]);
    assert.deepEqual(await call('POST', '/api/spaces', { name: 'Third', linkIcon: 'diagram-project' }).then((r) => [r.status, r.json?.error]), [400, LINK_REFUSED], 'nor when a space is made');
    await pickerEqualsSave(other, 'an icon in use no template offers');
    // Once nothing uses it, it is drawn no more.
    assert.equal((await call('PATCH', '/api/settings', { homeIcon: null })).status, 200);
    assert.equal((await call('PATCH', `/api/spaces/${space}`, { linkIcon: 'link' })).status, 200);
    assert.deepEqual((await branding()).inUseIcons, []);
    assert.equal((await call('DELETE', `/api/spaces/${other}`)).status, 200);
  });

  await test('a save that sends back the icon it has already is taken, though only in use now; a changed one is checked', async () => {
    assert.equal((await call('PATCH', '/api/settings', { template: 'project' })).status, 200);
    const sp = (await call('POST', '/api/spaces', { name: 'Kept' })).json.space.id;
    const dp = 'diagram-project';
    assert.equal((await call('PATCH', '/api/settings', { homeIcon: dp })).status, 200);
    assert.equal((await call('PATCH', `/api/spaces/${sp}`, { linkIcon: dp })).status, 200);
    assert.equal((await call('PATCH', '/api/modules/chat', { displayIcon: dp })).status, 200);
    const made = await call('POST', `/api/spaces/${sp}/layouts`, { name: 'Mine', shared: true, shape: 'one', areas: [null], icon: dp });
    assert.equal(made.status, 201, made.text);
    const lid = made.json.layout.id;
    assert.equal((await call('PATCH', `/api/spaces/${sp}/layouts/system/workspace`, { icon: dp })).status, 200);
    assert.equal((await call('PATCH', '/api/settings', { template: 'default' })).status, 200);
    assert.equal(ids((await branding()).icons).includes(dp), false, 'no longer offered');
    // Unchanged: each save is taken, as a page that sends the whole record does.
    for (const [label, r] of [
      ['home icon', await call('PATCH', '/api/settings', { homeIcon: dp })],
      ['link icon', await call('PATCH', `/api/spaces/${sp}`, { linkIcon: dp, name: 'Kept again' })],
      ['display icon', await call('PATCH', '/api/modules/chat', { displayIcon: dp })],
      ['saved layout', await call('PUT', `/api/spaces/${sp}/layouts/${lid}`, { name: 'Mine again', icon: dp })],
      ['system layout', await call('PATCH', `/api/spaces/${sp}/layouts/system/workspace`, { icon: dp, name: 'Desk' })],
    ]) assert.equal(r.status, 200, `${label}, unchanged: ${r.text}`);
    // Changed to an icon nothing offers: refused, each with its sentence.
    for (const [label, r, sentence] of [
      ['home icon', await call('PATCH', '/api/settings', { homeIcon: 'hippo' }), 'unknown home icon'],
      ['link icon', await call('PATCH', `/api/spaces/${sp}`, { linkIcon: 'hippo' }), LINK_REFUSED],
      ['display icon', await call('PATCH', '/api/modules/chat', { displayIcon: 'hippo' }), "There is no icon called hippo in this environment's icons."],
      ['saved layout', await call('PUT', `/api/spaces/${sp}/layouts/${lid}`, { icon: 'hippo' }), 'Pick an icon from the list.'],
      ['system layout', await call('PATCH', `/api/spaces/${sp}/layouts/system/workspace`, { icon: 'hippo' }), 'Pick an icon from the list.'],
    ]) assert.deepEqual([r.status, r.json?.error], [400, sentence], label);
    // Another layout or space can't borrow the icon only this one keeps.
    const other = await call('POST', `/api/spaces/${sp}/layouts`, { name: 'Other', shared: true, shape: 'one', areas: [null], icon: dp });
    assert.deepEqual([other.status, other.json?.error], [400, 'Pick an icon from the list.']);
    const otherSpace = (await call('POST', '/api/spaces', { name: 'Other space' })).json.space.id;
    assert.deepEqual(await call('PATCH', `/api/spaces/${otherSpace}`, { linkIcon: dp }).then((r) => [r.status, r.json?.error]), [400, LINK_REFUSED]);
    assert.deepEqual(await call('PATCH', `/api/spaces/${otherSpace}/layouts/system/workspace`, { icon: dp }).then((r) => [r.status, r.json?.error]), [400, 'Pick an icon from the list.'], 'another space\'s system layout');
    // Tidy.
    assert.equal((await call('PATCH', '/api/settings', { homeIcon: null })).status, 200);
    assert.equal((await call('PATCH', '/api/modules/chat', { displayIcon: null })).status, 200);
    for (const id of [sp, otherSpace]) assert.equal((await call('DELETE', `/api/spaces/${id}`)).status, 200);
  });

  await test('the icon only one entry keeps is that entry\'s: another layout, or another person\'s system layout, can\'t take it', async () => {
    assert.equal((await call('PATCH', '/api/settings', { template: 'project' })).status, 200);
    const sp = (await call('POST', '/api/spaces', { name: 'Shared' })).json.space.id;
    const dp = 'diagram-project';
    const a = await call('POST', `/api/spaces/${sp}/layouts`, { name: 'A', shared: true, shape: 'one', areas: [null], icon: dp });
    const b = await call('POST', `/api/spaces/${sp}/layouts`, { name: 'B', shared: true, shape: 'one', areas: [null] });
    assert.deepEqual([a.status, b.status], [201, 201], `${a.text} ${b.text}`);
    assert.equal((await call('PATCH', `/api/spaces/${sp}/layouts/system/workspace`, { icon: dp })).status, 200, 'the admin\'s own system layout entry');
    const made = await call('POST', '/api/users', { login: 'mel', displayName: 'Mel', role: 'member', password: 'mel-password-1' });
    assert.equal(made.status, 201, made.text);
    assert.equal((await call('PATCH', `/api/spaces/${sp}`, { members: [made.json.user.key] })).status, 200);
    assert.equal((await call('PATCH', '/api/settings', { template: 'default' })).status, 200);
    const pb = await call('PUT', `/api/spaces/${sp}/layouts/${b.json.layout.id}`, { name: 'B', icon: dp });
    assert.deepEqual([pb.status, pb.json?.error], [400, 'Pick an icon from the list.'], 'a layout PUT with an icon only another layout in the space holds');
    assert.equal((await call('PUT', `/api/spaces/${sp}/layouts/${a.json.layout.id}`, { name: 'A', icon: dp })).status, 200, 'the layout that holds it, unchanged');
    const admin = token;
    try {
      token = (await call('POST', '/api/login', { login: 'mel', password: 'mel-password-1' })).json.token;
      assert.ok(token, 'the member signed in');
      const sys = await call('PATCH', `/api/spaces/${sp}/layouts/system/workspace`, { icon: dp });
      assert.deepEqual([sys.status, sys.json?.error], [400, 'Pick an icon from the list.'], 'a member\'s system layout: the admin\'s entry holds it, not theirs');
      assert.equal((await call('PATCH', `/api/spaces/${sp}/layouts/system/workspace`, { icon: 'dragon' })).status, 200, 'an offered one');
    } finally {
      token = admin;
    }
    assert.equal((await call('DELETE', `/api/spaces/${sp}`)).status, 200);
  });

  await test('a stored or imported link icon that is no Font Awesome icon is never published; a new space\'s link icon is checked', async () => {
    for (const bad of ['spin', 'fw', 'not-an-icon-at-all']) {
      assert.deepEqual(await call('POST', '/api/spaces', { name: 'Odd', linkIcon: bad }).then((r) => [r.status, r.json?.error]), [400, LINK_REFUSED], bad);
    }
    const ok = await call('POST', '/api/spaces', { name: 'Fine', linkIcon: 'dragon' });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.space?.linkIcon, 'dragon', ok.text);
    // As an import or a hand edit would leave it: stored, but neither offered nor drawn from the icons in use.
    const { Store: S } = require('../server/store.js');
    const dir = fs.mkdtempSync(path.join(templatesDir, 'inuse-'));
    const st = new S(dir);
    st.data.settings.homeIcon = 'spin';
    for (const linkIcon of ['spin', 'pulse', 'beat', 'diagram-project', 'diagram-project']) st.data.spaces.push({ ...st.sanitizeSpace({ id: 'abcd1234', name: 'X' }), id: `x${st.data.spaces.length}`, linkIcon });
    const used = st.inUseIconIds();
    assert.deepEqual(['spin', 'pulse', 'beat'].filter((id) => used.includes(id)), [], 'never a utility class or anything with no Font Awesome svg');
    assert.deepEqual(used.filter((id) => id === 'diagram-project'), ['diagram-project'], 'a real Font Awesome Free solid icon, once');
    assert.deepEqual(st.lookOf(null).inUseIcons, [{ id: 'diagram-project', classes: 'fa-solid fa-diagram-project' }]);
    for (let i = 0; i < 300; i += 1) st.data.spaces.push({ ...st.sanitizeSpace({ id: 'abcd1234', name: 'Y' }), id: `y${i}`, linkIcon: DEFAULT_ICON_LIST[i % DEFAULT_ICON_LIST.length].id });
    assert.equal(new Set(DEFAULT_ICON_LIST.map((i) => i.id)).size > 100, true);
    for (let i = 0; i < 300; i += 1) st.data.spaces.push({ ...st.sanitizeSpace({ id: 'abcd1234', name: 'Z' }), id: `z${i}`, linkIcon: fs.readdirSync(path.join(ROOT, 'node_modules', '@fortawesome', 'fontawesome-free', 'svgs', 'solid'))[i].slice(0, -4) });
    assert.equal(st.inUseIconIds().length, 200, 'bounded at 200');
    // More than 200 offered icons in use, and one that is not offered: the offered ones are taken out before the cap.
    const st2 = new S(fs.mkdtempSync(path.join(templatesDir, 'cap-')));
    const solid = fs.readdirSync(path.join(ROOT, 'node_modules', '@fortawesome', 'fontawesome-free', 'svgs', 'solid')).map((f) => f.slice(0, -4)).filter((id) => !DEFAULT_ICON_LIST.some((c) => c.id === id) && id !== 'hippo');
    st2.updateSettings({ icons: [...DEFAULT_ICON_LIST, ...solid.slice(0, 150).map((id) => ({ id, classes: `fa-solid fa-${id}`, label: id }))] });
    const offered = ids(st2.lookOf(null).icons);
    assert.ok(offered.length > 200, `more than 200 offered: ${offered.length}`);
    for (const [i, id] of offered.entries()) st2.data.spaces.push({ ...st2.sanitizeSpace({ id: 'abcd1234', name: 'O' }), id: `o${i}`, linkIcon: id });
    st2.data.spaces.push({ ...st2.sanitizeSpace({ id: 'abcd1234', name: 'H' }), id: 'hippo1', linkIcon: 'hippo' });
    assert.deepEqual(st2.lookOf(null).inUseIcons, [{ id: 'hippo', classes: 'fa-solid fa-hippo' }], 'the one not offered is still drawn');
    assert.equal((await call('DELETE', `/api/spaces/${ok.json.space.id}`)).status, 200);
  });

  await test('a space on its own template: its link icon and layout icons take what its look lists and what the environment offers, nothing else', async () => {
    assert.equal((await call('PATCH', '/api/settings', { template: 'travel' })).status, 200); // offers suitcase-rolling (its home icon)
    const own = (await call('POST', '/api/spaces', { name: 'Own', template: 'myproject' })).json.space.id; // offers anchor (iconSet) and list-check
    const lookOwn = ids((await call('GET', `/api/spaces/${own}/look`)).json.look.icons);
    assert.ok(lookOwn.includes('anchor') && !lookOwn.includes('suitcase-rolling'), 'its look lists its own template\'s icons, not the environment\'s');
    assert.equal((await call('PATCH', `/api/spaces/${own}`, { linkIcon: 'anchor' })).status, 200, 'an icon its look lists');
    assert.equal((await call('PATCH', `/api/spaces/${own}`, { linkIcon: 'suitcase-rolling' })).status, 200, 'one the environment offers (Home\'s and Set up\'s pickers show it)');
    assert.equal(DEFAULT_ICON_LIST.some((i) => i.id === 'hippo'), false);
    assert.deepEqual(await call('PATCH', `/api/spaces/${own}`, { linkIcon: 'hippo' }).then((r) => [r.status, r.json?.error]), [400, LINK_REFUSED], 'one neither offers');
    assert.deepEqual(await call('PATCH', `/api/spaces/${space}`, { linkIcon: 'anchor' }).then((r) => [r.status, r.json?.error]), [400, LINK_REFUSED], 'a space on the environment\'s template: not another template\'s');
    // In the same save, the template the space is moved to decides; a new space's too.
    assert.equal((await call('PATCH', `/api/spaces/${space}`, { template: 'myproject', linkIcon: 'anchor' })).status, 200);
    assert.equal((await call('PATCH', `/api/spaces/${space}`, { template: null, linkIcon: 'link' })).status, 200);
    const madeWith = await call('POST', '/api/spaces', { name: 'Made', template: 'myproject', linkIcon: 'anchor' });
    assert.equal(madeWith.status, 200, madeWith.text);
    assert.deepEqual(await call('POST', '/api/spaces', { name: 'Not made', linkIcon: 'anchor' }).then((r) => [r.status, r.json?.error]), [400, LINK_REFUSED]);
    assert.equal((await call('DELETE', `/api/spaces/${madeWith.json.space.id}`)).status, 200);
    const layout = (sp, icon) => call('POST', `/api/spaces/${sp}/layouts`, { name: `L ${icon}`, shared: true, shape: 'one', areas: [null], icon });
    for (const [sp, icon, status] of [[own, 'anchor', 201], [own, 'suitcase-rolling', 201], [own, 'hippo', 400], [space, 'suitcase-rolling', 201], [space, 'anchor', 400]]) {
      const r = await layout(sp, icon);
      assert.equal(r.status, status, `${icon}: ${r.text}`);
      if (status === 400) assert.equal(r.json?.error, 'Pick an icon from the list.');
      else assert.ok([200, 204].includes((await call('DELETE', `/api/spaces/${sp}/layouts/${r.json.layout.id}`)).status));
    }
    const sys = await call('PATCH', `/api/spaces/${own}/layouts/system/workspace`, { icon: 'hippo' });
    assert.deepEqual([sys.status, sys.json?.error], [400, 'Pick an icon from the list.'], 'a system layout\'s icon too');
    assert.equal((await call('PATCH', `/api/spaces/${own}/layouts/system/workspace`, { icon: 'anchor' })).status, 200);
    await pickerEqualsSave(own, 'a space on its own template');
    await pickerEqualsSave(space, 'a space on the environment\'s template');
    // The environment on Learning, a space on Travel.
    assert.equal((await call('PATCH', '/api/settings', { template: 'learning' })).status, 200);
    const trip = (await call('POST', '/api/spaces', { name: 'Trip', template: 'travel', linkIcon: 'suitcase-rolling' }));
    assert.equal(trip.status, 200, trip.text);
    await pickerEqualsSave(trip.json.space.id, 'Learning with a space on Travel');
    await pickerEqualsSave(space, 'Learning, a space on it');
    assert.equal((await call('PATCH', '/api/settings', { template: 'default' })).status, 200);
  });
} catch (err) {
  failed += 1;
  console.error(err.stack || err);
} finally {
  child.kill();
}
await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r)));

// A server on `dir` (with `env`), and a request to it as `host` (an environment's slug on a hosted server, else none).
function startServer(dir, env = {}) {
  const c = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dir, PRODUCT_NAME: 'Testname', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let text = '';
  c.stdout.on('data', (d) => { text += d; });
  c.stderr.on('data', (d) => { text += d; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { c.kill(); reject(new Error(`the server did not start in time:\n${text}`)); }, 20000);
    const onData = () => { const m = /listening on :(\d+)/.exec(text); if (m) { clearTimeout(timer); resolve({ port: Number(m[1]), stop: () => new Promise((r) => { if (c.exitCode !== null) return r(); c.once('exit', r); c.kill(); }) }); } };
    c.stdout.on('data', onData);
    c.stderr.on('data', onData);
    c.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${text}`)); });
  });
}
function hcall(server, host, method, urlPath, { body, cookie } = {}) {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const name = host ? `${host}.localhost:${server.port}` : `127.0.0.1:${server.port}`;
  const headers = { host: name, accept: 'application/json', origin: `http://${name}` };
  if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = payload.length; }
  if (cookie) headers.cookie = cookie;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.port, method, path: urlPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ } resolve({ status: res.statusCode, json, text, headers: res.headers }); });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const cookieOf = (res) => [].concat(res.headers?.['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');

await test('a stored home icon or link icon that is no Font Awesome icon (an import, a hand edit) is never published, signed out', async () => {
  const file = path.join(dataDir, 'app.json');
  const app = JSON.parse(fs.readFileSync(file, 'utf8'));
  // The environment's lists, edited, as a restart must keep them: filled once, never again.
  app.settings.reactions = app.settings.reactions.filter((r) => r.id !== 'heart').reverse();
  app.settings.icons = app.settings.icons.filter((i) => i.id !== 'dragon').reverse();
  const keptLists = { reactions: app.settings.reactions, icons: app.settings.icons };
  const odd = ['fw', '10x', 'rotate-180', 'flip-both', 'sr-only', 'stack', '../evil', 'spin'];
  app.settings.homeIcon = 'sr-only';
  const base = app.spaces.find((r) => r.id !== 'lobby');
  odd.forEach((linkIcon, i) => app.spaces.push({ ...base, id: `odd${String(i).padStart(5, '0')}`, name: `Odd ${i}`, linkIcon, members: [] }));
  app.spaces.push({ ...base, id: 'oddhippo', name: 'Hippo', linkIcon: 'hippo', members: [] });
  fs.writeFileSync(file, JSON.stringify(app));
  const again = await startServer(dataDir, { ADMIN_PASSWORD: 'testpass1234' });
  try {
    const b = await hcall(again, null, 'GET', '/api/branding');
    assert.equal(b.status, 200, b.text);
    const shown = [...ids(b.json.icons), ...ids(b.json.inUseIcons)];
    for (const id of odd) assert.equal(shown.includes(id), false, `${id} is not published`);
    for (const id of odd) assert.equal([...b.json.icons, ...b.json.inUseIcons].some((i) => String(i.classes).includes(`fa-${id}`)), false, `no class fa-${id}`);
    assert.ok(b.json.inUseIcons.some((i) => i.id === 'hippo' && i.classes === 'fa-solid fa-hippo'), 'a real icon in use is');
    for (const i of b.json.inUseIcons) assert.equal(i.classes, `fa-solid fa-${i.id}`);
    assert.deepEqual([b.json.reactions, b.json.icons], [keptLists.reactions, keptLists.icons], 'the lists survive a restart as saved');
    // Signed out, the icons in use are icons and nothing else: Font Awesome Free solid ids, at most 200, each { id, classes },
    // never a layout's name, a person's key or a space's id.
    const { isSolidIcon } = require('../server/fa-solid.js');
    assert.ok(b.json.inUseIcons.length <= 200);
    for (const i of b.json.inUseIcons) {
      assert.deepEqual(Object.keys(i).sort(), ['classes', 'id']);
      assert.ok(isSolidIcon(i.id), i.id);
    }
    const layoutsFile = path.join(dataDir, 'layouts.json');
    const stored = fs.existsSync(layoutsFile) ? JSON.parse(fs.readFileSync(layoutsFile, 'utf8')).spaces : {};
    const names = Object.values(stored).flatMap((e) => [...(e.shared || []), ...Object.values(e.people || {}).flat()].map((l) => l.name));
    const private_ = new Set([...app.spaces.map((x) => x.id), ...app.users.map((u) => u.key), ...names].filter((x) => typeof x === 'string' && x.length > 3));
    for (const i of b.json.inUseIcons) assert.equal(private_.has(i.id), false, `${i.id} is not a space, a person or a layout name`);
  } finally {
    await again.stop();
  }
});

await test('hosted: an icon in use in one environment is never in another\'s inUseIcons', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-reactions-icons-hosted-'));
  const hs = await startServer(dir, { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'boss', ADMIN_PASSWORD: 'host-password-1' });
  try {
    const hostCookie = cookieOf(await hcall(hs, 'admin', 'POST', '/api/host/login', { body: { login: 'boss', password: 'host-password-1' } }));
    const host = (method, url, body) => hcall(hs, 'admin', method, url, { cookie: hostCookie, body });
    for (const [slug, template] of [['aaa', 'project'], ['bbb', 'default']]) {
      const r = await host('POST', '/api/host/environments', { slug, name: slug.toUpperCase(), template, owner: { login: `owner-${slug}`, password: `owner-${slug}-password-1` } });
      assert.equal(r.status, 201, r.text);
    }
    const c = cookieOf(await hcall(hs, 'aaa', 'POST', '/api/login', { body: { login: 'owner-aaa', password: 'owner-aaa-password-1' } }));
    const set = await hcall(hs, 'aaa', 'PATCH', '/api/settings', { cookie: c, body: { homeIcon: 'diagram-project' } });
    assert.equal(set.status, 200, set.text);
    assert.equal((await host('PATCH', '/api/host/environments/aaa', { template: 'default' })).status, 200);
    const a = (await hcall(hs, 'aaa', 'GET', '/api/branding')).json;
    const b = (await hcall(hs, 'bbb', 'GET', '/api/branding')).json;
    assert.deepEqual(a.inUseIcons, [{ id: 'diagram-project', classes: 'fa-solid fa-diagram-project' }], 'A draws its own');
    assert.deepEqual(b.inUseIcons, [], 'B never sees A\'s');
    assert.equal(ids(b.icons).includes('diagram-project'), false);
    // Each environment's lists start from the built-in set and stay its own.
    assert.deepEqual([b.reactions, b.icons], [DEFAULT_REACTION_LIST, DEFAULT_ICON_LIST], 'B starts from the built-in set');
    const cut = await hcall(hs, 'aaa', 'PATCH', '/api/settings', { cookie: c, body: { reactions: DEFAULT_REACTION_LIST.slice(1, 4), icons: DEFAULT_ICON_LIST.slice(5, 7) } });
    assert.equal(cut.status, 200, cut.text);
    assert.deepEqual([cut.json.settings.ownReactions, cut.json.settings.ownIcons], [DEFAULT_REACTION_LIST.slice(1, 4), DEFAULT_ICON_LIST.slice(5, 7)]);
    const b2 = (await hcall(hs, 'bbb', 'GET', '/api/branding')).json;
    assert.deepEqual([b2.reactions, b2.icons], [DEFAULT_REACTION_LIST, DEFAULT_ICON_LIST], 'A\'s edit leaves B\'s lists as they were');
    // The host console's template editor reads the built-in lists from GET /api/host/settings: the host admin only.
    const hostSettings = await host('GET', '/api/host/settings');
    assert.equal(hostSettings.status, 200, hostSettings.text);
    assert.deepEqual(hostSettings.json.builtIn, { reactions: DEFAULT_REACTION_LIST, icons: DEFAULT_ICON_LIST }, 'the host admin gets the built-in lists');
    const member = await hcall(hs, 'aaa', 'POST', '/api/users', { cookie: c, body: { login: 'mo', displayName: 'Mo', role: 'member', password: 'mo-password-1' } });
    assert.equal(member.status, 201, member.text);
    const mo = cookieOf(await hcall(hs, 'aaa', 'POST', '/api/login', { body: { login: 'mo', password: 'mo-password-1' } }));
    assert.ok(mo, 'the member signed in');
    for (const [who, place, cookie] of [['signed out', 'admin', undefined], ['an environment\'s owner', 'admin', c], ['a member', 'admin', mo], ['a member, at their environment', 'aaa', mo], ['the owner, at their environment', 'aaa', c]]) {
      const r = await hcall(hs, place, 'GET', '/api/host/settings', { cookie });
      assert.ok([401, 403, 404].includes(r.status), `${who}: ${r.status} ${r.text.slice(0, 120)}`);
      assert.equal(r.text.includes('builtIn'), false, `${who}: no built-in lists`);
    }
    for (const place of ['admin', 'aaa']) assert.equal((await hcall(hs, place, 'GET', '/api/branding')).text.includes('builtIn'), false, `${place}: /api/branding never carries them`);
    const reset = await hcall(hs, 'aaa', 'PATCH', '/api/settings', { cookie: c, body: { resetLists: true } });
    assert.deepEqual([reset.status, reset.json?.settings?.ownReactions?.length, reset.json?.settings?.ownIcons?.length], [200, 105, 113], 'A starts again from the built-in set');
  } finally {
    await hs.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await test('a template\'s additions: after the environment\'s list, a repeat of it dropped, once each, only where the template is read, never copied', () => {
  const dir = fs.mkdtempSync(path.join(templatesDir, 'store-'));
  const store = new Store(dir);
  assert.deepEqual([store.settings.reactions, store.settings.icons], [DEFAULT_REACTION_LIST, DEFAULT_ICON_LIST], 'a new store\'s lists are the built-in set');
  const project = templates.cleanTemplate({ id: 'project', name: 'Project', description: 'x', modules: { chat: {} }, reactions: [{ id: 'ship', glyph: '\u{1F680}', label: 'Ship it' }, { id: 'yes2', glyph: '✅', label: 'Twice' }, { id: 'up', glyph: '\u{1F44D}\u{1F3FD}', label: 'Up again' }], iconSet: ['diagram-project', 'cat', 'dragon'] });
  store.templateById = (id) => (id === 'project' ? project : templates.get(id) || null);
  store.catalogModuleIds = () => ['chat'];
  const envReactions = [{ id: 'yes', glyph: '✅', label: 'Yes' }, ...DEFAULT_REACTION_LIST];
  const envIcons = [{ id: 'cat', classes: 'fa-solid fa-cat', label: 'cat' }, ...DEFAULT_ICON_LIST.filter((i) => i.id !== 'dragon')];
  store.updateSettings({ reactions: envReactions, icons: envIcons });
  const space = store.addSpace({ name: 'Bridge', template: 'project' });
  const plain = store.addSpace({ name: 'Plain' });
  const mine = store.lookOf(space.id);
  assert.deepEqual(mine.reactions.slice(0, 106), envReactions, 'the environment\'s list first, whole and in order');
  assert.deepEqual(ids(mine.reactions).slice(106), ['ship'], 'then the template\'s; a glyph or an id the environment has already is dropped');
  assert.deepEqual(ids(mine.icons).slice(0, 113), ids(envIcons));
  assert.deepEqual(ids(mine.icons).slice(113), ['diagram-project', 'dragon'], 'the same for icons: cat is the environment\'s already; dragon, removed there, is the template\'s addition');
  assert.deepEqual(store.lookOf(plain.id).reactions, envReactions, 'a space on no template of its own reads the environment\'s, not project\'s');
  assert.deepEqual(store.lookOf(null).icons, envIcons);
  assert.deepEqual([store.settings.reactions, store.settings.icons], [envReactions, envIcons], 'nothing of the template is copied into the settings');
  assert.equal(store.iconIds().includes('diagram-project'), false, 'a template only a space reads is not the environment\'s');
  templates.useLive(store, project);
  assert.equal(store.iconIds().includes('diagram-project'), true, 'the environment\'s own template\'s icons are the environment\'s: its pickers and checks know them');
  assert.deepEqual(ids(store.lookOf(plain.id).reactions).slice(106), ['ship'], 'and a space reading it');
  // A reader that changes its answer changes nothing stored, and nothing of the built-in lists.
  mine.reactions[1].glyph = 'x';
  mine.icons[1].classes = 'fa-solid fa-x';
  assert.equal(store.lookOf(space.id).reactions[1].glyph, DEFAULT_REACTION_LIST[0].glyph);
  assert.equal(store.settings.icons[1].classes, DEFAULT_ICON_LIST[0].classes);
  assert.equal(DEFAULT_REACTION_LIST[0].glyph, '❤️');
});

fs.rmSync(dataDir, { recursive: true, force: true });
fs.rmSync(templatesDir, { recursive: true, force: true });
if (failed) {
  console.error(`check-reactions-icons: ${failed} failed`);
  process.exit(1);
}
console.log(`check-reactions-icons: ${n} groups ok`);
