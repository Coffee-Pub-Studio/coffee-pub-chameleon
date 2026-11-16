#!/usr/bin/env node
/*
 * check-reactions-icons.mjs -- the fixed core reactions and icons, the owner's own additions and a template's additions
 * (plan-templates-redesign.md, decision 12), on a real server with a throwaway DATA_DIR:
 *   - /api/branding and a space's /look read the core first, whole and in order (105 reactions, 113 icons), then the
 *     owner's own additions, then the template's, each once;
 *   - nothing removes or changes a core entry: an owner's save that leaves them out, repeats them (by id or by glyph) or
 *     relabels them changes none of it, and what the settings keep is only the owner's own additions;
 *   - a space has none of its own: a space save that carries reactions or icons changes neither list;
 *   - a template's additions (a host template with `reactions` and `iconSet`) show at once in an environment that reads it,
 *     in a space on it and in /look, and never in one that reads another template; a switch offers none of them (they are
 *     not copied), and the owner's own additions stay when the template changes;
 *   - an icon the owner adds draws wherever icons are validated (the home icon), and a core one always does;
 *   - a switch of the environment's template (to an owner's copy of Project, its offer confirmed, back to Default, to
 *     Project and back) leaves ownReactions and ownIcons, and the stored lists, exactly as they were: the template's home
 *     icon, module icons and iconSet are offered (and pickable) only while it is read, never copied (decision 12);
 *   - an icon in use (the home icon, a space's link icon) whose template is gone is drawn from `inUseIcons` (branding and
 *     /look), never in `icons` (what every picker reads), and a new pick of it is refused (400); once unused it goes;
 *     only a real Font Awesome Free solid icon is ever published there (a stored "spin" is not), at most 200;
 *   - a new space's link icon is checked as an edit's is (400 "unknown link icon");
 *   - a save that sends back the icon it has already (home icon, link icon, a module's display icon, a saved layout's
 *     and a system layout's) is taken though it is only in use after a switch; a changed one is checked (400);
 *   - a space's link icon, saved layouts' icons and system layouts' icons take what the environment offers and what the
 *     space's own template offers (its /look), nothing else;
 *   - a picker never offers what the save refuses: every id in /api/branding's and a space's /look's icons is taken by
 *     the home icon, a module's display icon (the solid ones), the link icon, a layout's and a system layout's icon,
 *     with an icon in use no template offers, a space on its own template, and Learning with a space on Travel.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
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
const { Store } = require('../server/store.js');
const templates = require('../server/templates.js');

try {
  token = (await call('POST', '/api/login', { login: 'admin', password: 'testpass1234' })).json.token;
  const space = (await call('POST', '/api/spaces', { name: 'Trip' })).json.space.id;
  const branding = async () => (await call('GET', '/api/branding')).json;
  const look = async () => (await call('GET', `/api/spaces/${space}/look`)).json.look;

  await test('the core first, whole and in order, in branding and in a space\'s look', async () => {
    for (const read of [branding, look]) {
      const got = await read();
      assert.deepEqual(got.reactions, DEFAULT_REACTION_LIST);
      assert.deepEqual(got.icons, DEFAULT_ICON_LIST);
    }
  });

  await test('the owner\'s own additions come after the core; the core can\'t be left out, repeated or changed', async () => {
    const mine = [{ id: 'yes', glyph: '✅', label: 'Yes' }];
    const myIcons = [{ id: 'my-cat', classes: 'fa-solid fa-cat', label: 'cat' }];
    const saved = await call('PATCH', '/api/settings', { reactions: [...mine, { id: 'heart', glyph: 'x', label: 'Changed' }, { id: 'again', glyph: DEFAULT_REACTION_LIST[0].glyph, label: 'Twice' }], icons: [...myIcons, { ...DEFAULT_ICON_LIST[0], label: 'Changed' }] });
    assert.equal(saved.status, 200, saved.text);
    assert.deepEqual(saved.json.settings.ownReactions, mine, 'the settings keep only what the owner added');
    assert.deepEqual(saved.json.settings.ownIcons, myIcons);
    assert.equal(saved.json.settings.reactions.length, 106, 'and `reactions` is what the call reads: the core and the additions');
    for (const read of [branding, look]) {
      const got = await read();
      assert.deepEqual(got.reactions.slice(0, 105), DEFAULT_REACTION_LIST, 'the core, as it was');
      assert.deepEqual(ids(got.reactions).slice(105), ['yes']);
      assert.deepEqual(got.icons.slice(0, 113), DEFAULT_ICON_LIST);
      assert.deepEqual(ids(got.icons).slice(113), ['my-cat']);
    }
    // Leaving them all out (what a page that lists only the additions, or an empty list, sends) takes none of the core.
    assert.equal((await call('PATCH', '/api/settings', { reactions: [], icons: [] })).status, 200);
    assert.equal((await branding()).reactions.length, 105);
    assert.equal((await branding()).icons.length, 113);
    await call('PATCH', '/api/settings', { reactions: mine, icons: myIcons });
  });

  await test('Manage reads and posts the owner\'s OWN lists, so what a template adds never becomes the owner\'s', async () => {
    const src = fs.readFileSync(path.join(ROOT, 'public', 'admin.js'), 'utf8');
    assert.ok(/renderReactionRows\(settings\.ownReactions\)/.test(src) && /renderIconRows\(settings\.ownIcons\)/.test(src), 'the rows are filled from ownReactions and ownIcons');
    assert.equal(/render(Reaction|Icon)Rows\(settings\.(reactions|icons)\)/.test(src), false, 'never from the resolved lists');
    // What Manage does: read the settings, post the rows back as they are (the glyph, label and id of each, the icon's classes).
    const got = (await call('GET', '/api/settings')).json.settings;
    const posted = await call('PATCH', '/api/settings', { reactions: got.ownReactions.map((r) => ({ id: r.id, glyph: r.glyph, label: r.label })), icons: got.ownIcons.map((i) => ({ id: i.id, classes: i.classes, label: i.label })) });
    assert.equal(posted.status, 200, posted.text);
    assert.deepEqual([posted.json.settings.ownReactions, posted.json.settings.ownIcons], [got.ownReactions, got.ownIcons], 'a round trip changes nothing');
    // The stored lists hold none of the resolved lists' extra entries: with a template's additions the page would have saved them.
    const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'app.json'), 'utf8')).settings;
    assert.deepEqual([stored.reactions.length, stored.icons.length], [got.ownReactions.length, got.ownIcons.length]);
  });

  await test('an icon the owner adds, and every core icon, may be the home icon; one nobody has may not', async () => {
    assert.equal((await call('PATCH', '/api/settings', { homeIcon: 'my-cat' })).status, 200);
    assert.equal((await call('PATCH', '/api/settings', { homeIcon: 'dragon' })).status, 200, 'a core one');
    const bad = await call('PATCH', '/api/settings', { homeIcon: 'not-an-icon' });
    assert.equal(bad.status, 400, bad.text);
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

  await test('a template switch, to a copy of Project and back, leaves the owner\'s own reactions and icons as they were; the template\'s icons are read live', async () => {
    const own = async () => { const s = (await call('GET', '/api/settings')).json.settings; return { ownReactions: s.ownReactions, ownIcons: s.ownIcons }; };
    const stored = () => { const s = JSON.parse(fs.readFileSync(path.join(dataDir, 'app.json'), 'utf8')).settings; return { reactions: s.reactions, icons: s.icons }; };
    const before = await own();
    const storedBefore = stored();
    assert.deepEqual(before.ownIcons.map((i) => i.id), ['my-cat'], 'the owner has their own');
    const copy = await call('POST', '/api/environment/templates', { from: 'project', id: 'myproject', name: 'My project' });
    assert.equal(copy.status, 201, copy.text);
    const tpl = (await call('GET', '/api/environment/templates/myproject')).json.template;
    const edit = await call('PATCH', '/api/environment/templates/myproject', { modules: { ...tpl.modules, todo: { ...(tpl.modules.todo || {}), icon: 'list-check' } }, reactions: [{ id: 'ship', glyph: '\u{1F680}', label: 'Ship it' }], iconSet: ['anchor'] });
    assert.equal(edit.status, 200, edit.text);
    const added = ['diagram-project', 'list-check', 'anchor']; // its home icon, a module's icon, its iconSet: none of them core
    for (const id of added) assert.equal(DEFAULT_ICON_LIST.some((i) => i.id === id), false, `${id} is not core`);
    for (const [step, body] of [['switch to the copy', { template: 'myproject' }], ['confirm its offer', null], ['switch back to Default', { template: 'default' }], ['switch to Project', { template: 'project' }], ['and back again', { template: 'default' }]]) {
      const r = body ? await call('PATCH', '/api/settings', body) : await call('POST', '/api/environment/template/apply', { modules: [], lobby: true, spaceDefaults: true });
      assert.equal(r.status, 200, `${step}: ${r.text}`);
      assert.deepEqual(await own(), before, `${step}: ownReactions and ownIcons unchanged`);
      assert.deepEqual(stored(), storedBefore, `${step}: and so is what is stored`);
      const b = await branding();
      const on = (await call('GET', '/api/settings')).json.settings.template?.id;
      if (on === 'myproject') {
        for (const id of added) assert.ok(ids(b.icons).includes(id), `${step}: ${id} is offered while the template is read`);
        assert.ok(ids(b.reactions).includes('ship'), `${step}: its reaction too`);
        assert.equal((await call('PATCH', '/api/settings', { homeIcon: 'list-check' })).status, 200, 'a template\'s icon may be picked while it is read');
        assert.equal((await call('PATCH', '/api/settings', { homeIcon: null })).status, 200);
        assert.deepEqual(await own(), before, 'picking one copies nothing');
      } else if (on === 'project') {
        assert.ok(ids(b.icons).includes('diagram-project'), `${step}: Project's home icon is offered`);
        assert.equal(ids(b.icons).includes('list-check'), false);
      } else {
        for (const id of added) assert.equal(ids(b.icons).includes(id), false, `${step}: ${id} goes with the template`);
        assert.equal(ids(b.reactions).includes('ship'), false);
        assert.deepEqual(ids(b.icons).slice(113), ['my-cat'], `${step}: the core and the owner's own`);
      }
    }
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
    const made = await call('POST', `/api/spaces/${sp}/layouts`, { name: 'Picker', modules: [] });
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
    assert.deepEqual(await call('PATCH', `/api/spaces/${other}`, { linkIcon: 'diagram-project' }).then((r) => [r.status, r.json?.error]), [400, 'unknown link icon']);
    assert.deepEqual(await call('POST', '/api/spaces', { name: 'Third', linkIcon: 'diagram-project' }).then((r) => [r.status, r.json?.error]), [400, 'unknown link icon'], 'nor when a space is made');
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
    const made = await call('POST', `/api/spaces/${sp}/layouts`, { name: 'Mine', modules: [], icon: dp });
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
      ['link icon', await call('PATCH', `/api/spaces/${sp}`, { linkIcon: 'hippo' }), 'unknown link icon'],
      ['display icon', await call('PATCH', '/api/modules/chat', { displayIcon: 'hippo' }), "There is no icon called hippo in this environment's icons."],
      ['saved layout', await call('PUT', `/api/spaces/${sp}/layouts/${lid}`, { icon: 'hippo' }), 'Pick an icon from the list.'],
      ['system layout', await call('PATCH', `/api/spaces/${sp}/layouts/system/workspace`, { icon: 'hippo' }), 'Pick an icon from the list.'],
    ]) assert.deepEqual([r.status, r.json?.error], [400, sentence], label);
    // Another layout or space can't borrow the icon only this one keeps.
    const other = await call('POST', `/api/spaces/${sp}/layouts`, { name: 'Other', modules: [], icon: dp });
    assert.deepEqual([other.status, other.json?.error], [400, 'Pick an icon from the list.']);
    const otherSpace = (await call('POST', '/api/spaces', { name: 'Other space' })).json.space.id;
    assert.deepEqual(await call('PATCH', `/api/spaces/${otherSpace}`, { linkIcon: dp }).then((r) => [r.status, r.json?.error]), [400, 'unknown link icon']);
    assert.deepEqual(await call('PATCH', `/api/spaces/${otherSpace}/layouts/system/workspace`, { icon: dp }).then((r) => [r.status, r.json?.error]), [400, 'Pick an icon from the list.'], 'another space\'s system layout');
    // Tidy.
    assert.equal((await call('PATCH', '/api/settings', { homeIcon: null })).status, 200);
    assert.equal((await call('PATCH', '/api/modules/chat', { displayIcon: null })).status, 200);
    for (const id of [sp, otherSpace]) assert.equal((await call('DELETE', `/api/spaces/${id}`)).status, 200);
  });

  await test('a stored or imported link icon that is no Font Awesome icon is never published; a new space\'s link icon is checked', async () => {
    for (const bad of ['spin', 'fw', 'not-an-icon-at-all']) {
      assert.deepEqual(await call('POST', '/api/spaces', { name: 'Odd', linkIcon: bad }).then((r) => [r.status, r.json?.error]), [400, 'unknown link icon'], bad);
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
    assert.deepEqual(await call('PATCH', `/api/spaces/${own}`, { linkIcon: 'hippo' }).then((r) => [r.status, r.json?.error]), [400, 'unknown link icon'], 'one neither offers');
    assert.deepEqual(await call('PATCH', `/api/spaces/${space}`, { linkIcon: 'anchor' }).then((r) => [r.status, r.json?.error]), [400, 'unknown link icon'], 'a space on the environment\'s template: not another template\'s');
    // In the same save, the template the space is moved to decides; a new space's too.
    assert.equal((await call('PATCH', `/api/spaces/${space}`, { template: 'myproject', linkIcon: 'anchor' })).status, 200);
    assert.equal((await call('PATCH', `/api/spaces/${space}`, { template: null, linkIcon: 'link' })).status, 200);
    const madeWith = await call('POST', '/api/spaces', { name: 'Made', template: 'myproject', linkIcon: 'anchor' });
    assert.equal(madeWith.status, 200, madeWith.text);
    assert.deepEqual(await call('POST', '/api/spaces', { name: 'Not made', linkIcon: 'anchor' }).then((r) => [r.status, r.json?.error]), [400, 'unknown link icon']);
    assert.equal((await call('DELETE', `/api/spaces/${madeWith.json.space.id}`)).status, 200);
    const layout = (sp, icon) => call('POST', `/api/spaces/${sp}/layouts`, { name: `L ${icon}`, modules: [], icon });
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

await test('a template\'s additions: after the core and the owner\'s own, once each, only where the template is read, never copied or offered', () => {
  const dir = fs.mkdtempSync(path.join(templatesDir, 'store-'));
  const store = new Store(dir);
  const project = templates.cleanTemplate({ id: 'project', name: 'Project', description: 'x', modules: { chat: {} }, reactions: [{ id: 'ship', glyph: '\u{1F680}', label: 'Ship it' }, { id: 'yes2', glyph: '✅', label: 'Twice' }], iconSet: ['diagram-project', 'cat'] });
  store.templateById = (id) => (id === 'project' ? project : templates.get(id) || null);
  store.catalogModuleIds = () => ['chat'];
  store.updateSettings({ reactions: [{ id: 'yes', glyph: '✅', label: 'Yes' }], icons: [{ id: 'cat', classes: 'fa-solid fa-cat', label: 'cat' }] });
  const space = store.addSpace({ name: 'Bridge', template: 'project' });
  const plain = store.addSpace({ name: 'Plain' });
  const mine = store.lookOf(space.id);
  assert.deepEqual(mine.reactions.slice(0, 105), DEFAULT_REACTION_LIST);
  assert.deepEqual(ids(mine.reactions).slice(105), ['yes', 'ship'], 'the owner\'s own, then the template\'s; a glyph the owner has already is not listed twice');
  assert.deepEqual(ids(mine.icons).slice(113), ['cat', 'diagram-project'], 'the same for icons');
  assert.deepEqual(ids(store.lookOf(plain.id).reactions).slice(105), ['yes'], 'a space on no template of its own reads the environment\'s, not project\'s');
  assert.deepEqual(ids(store.lookOf(null).icons).slice(113), ['cat']);
  assert.deepEqual([store.settings.reactions.map((r) => r.id), store.settings.icons.map((i) => i.id)], [['yes'], ['cat']], 'nothing of the template is copied into the settings');
  assert.equal(store.iconIds().includes('diagram-project'), false, 'a template only a space reads is not the environment\'s');
  templates.useLive(store, project);
  assert.equal(store.iconIds().includes('diagram-project'), true, 'the environment\'s own template\'s icons are the environment\'s: its pickers and checks know them');
  assert.deepEqual(ids(store.lookOf(plain.id).reactions).slice(105), ['yes', 'ship'], 'and a space reading it');
  // The core is the same object for no reader: a reader that changes its answer changes nothing.
  mine.reactions[0].glyph = 'x';
  assert.equal(store.lookOf(space.id).reactions[0].glyph, DEFAULT_REACTION_LIST[0].glyph);
  assert.equal(DEFAULT_REACTION_LIST[0].glyph, '❤️');
});

fs.rmSync(dataDir, { recursive: true, force: true });
fs.rmSync(templatesDir, { recursive: true, force: true });
if (failed) {
  console.error(`check-reactions-icons: ${failed} failed`);
  process.exit(1);
}
console.log(`check-reactions-icons: ${n} groups ok`);
