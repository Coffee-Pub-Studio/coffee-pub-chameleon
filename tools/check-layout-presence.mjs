#!/usr/bin/env node
/*
 * check-layout-presence.mjs -- presence on tabs (documentation/plans/plan-workspaces.md, decision 47): each person's tab
 * is part of their live stream's state, and the tabs wear the faces of who is on them.
 *   - the register (server/live.js): `layout` per stream, null until said; the latest said wins across a person's
 *     streams; it goes with its stream, stays through the grace; people() and placeOf() carry it
 *   - PUT /api/spaces/:id/where { layout, stream? }: who may (members, owners, the admin, the space's moderators; never a
 *     guest, an agent, someone outside or a closed space's member), what it takes (a fixed layout on here for them, a saved
 *     layout they can see), 409 with no stream, 429 past PRESENCE_CHANGES_PER_MINUTE, and the presence event carrying it
 *     (a person's own saved layout reads as 'personal')
 *   - the page (read as source, and the pure parts run): peopleFromPresence keeps `layout`, facesOnTab orders and caps
 *     the faces, the shared face stack draws them, the page says its tab on every change and every `ready`, and Who is
 *     here leaves the desktop bar where the tabs show their faces (a phone keeps Online)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { ROOT, startServer, client, seedSpace, quiet } from './presence-harness.mjs';

const require = createRequire(import.meta.url);
const { LiveRegister } = require('../server/live.js');
let n = 0;
const ok = (cond, label) => { assert.ok(cond, label); n += 1; };
const same = (got, want, label) => { assert.deepEqual(got, want, label); n += 1; };

// --- the register ----------------------------------------------------------------------------------------------------
{
  let now = 1000;
  let id = 0;
  const reg = new LiveRegister({ now: () => now, makeId: () => `s${++id}` });
  const a1 = reg.open({ who: 'al', name: 'Al', space: 'keep' });
  same(reg.people('keep')[0].layout, null, 'null until the page says');
  same(reg.setLayout('al', 'keep', 'calendar', a1), true, 'said: a change');
  same(reg.setLayout('al', 'keep', 'calendar', a1), false, 'the same again: no change');
  same(reg.people('keep')[0].layout, 'calendar', 'people() carries it');
  same(reg.placeOf('al').layout, 'calendar', 'placeOf() too');
  const a2 = reg.open({ who: 'al', name: 'Al', space: 'keep' });
  same(reg.layoutOf('al', 'keep'), 'calendar', 'a second page that has not said leaves the first one\'s');
  same(reg.setLayout('al', 'keep', 'map', a2), true, 'the second page says Map');
  same(reg.layoutOf('al', 'keep'), 'map', 'the latest said wins');
  same(reg.setLayout('al', 'keep', 'workspace', a1), true, 'the first page says the Workspace');
  same(reg.layoutOf('al', 'keep'), 'workspace', 'again the latest');
  same(reg.setLayout('al', 'keep', 'calendar', 'nosuch'), null, 'a stream that is not theirs: null');
  same(reg.setLayout('bo', 'keep', 'calendar'), null, 'nobody there: null');
  same(reg.setLayout('al', 'other', 'calendar', a1), null, 'another space: null');
  reg.close(a1);
  same(reg.layoutOf('al', 'keep'), 'map', 'a closed page\'s word goes with it');
  reg.close(a2);
  same(reg.layoutOf('al', 'keep'), 'map', 'the grace keeps the last one');
  now += 20000;
  same(reg.people('keep'), [], 'gone after the grace');
  const b = reg.open({ who: 'bo', name: 'Bo', guest: true, space: 'keep' });
  same(reg.people('keep')[0], { key: 'bo', name: 'Bo', guest: true, onCall: false, away: false, awayMessage: '', layout: null }, 'a guest: null');
  reg.setLayout('bo', 'keep', '', b);
  same(reg.layoutOf('bo', 'keep'), null, 'an empty word is null');
}

// --- the page's pure parts ---------------------------------------------------------------------------------------------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-layout-presence-'));
  fs.copyFileSync(path.join(ROOT, 'public/space-live.js'), path.join(dir, 'space-live.mjs'));
  const { peopleFromPresence, facesOnTab } = await import(pathToFileURL(path.join(dir, 'space-live.mjs')).href);
  fs.rmSync(dir, { recursive: true, force: true });
  const list = [{ key: 'z', name: 'Zoe', layout: 'calendar' }, { key: 'a', name: 'Al', layout: 'calendar' }, { key: 'me', name: 'Me', layout: 'map' }, { key: 'b', name: 'Bea', layout: 'calendar' }, { key: 'c', name: 'Cy', layout: 'calendar' }, { key: 'g', name: 'Gil', layout: 7 }];
  const people = peopleFromPresence(list, { you: 'me', meLayout: 'calendar' });
  same(people.map((p) => [p.key, p.layout]), [['me', 'calendar'], ['a', 'calendar'], ['b', 'calendar'], ['c', 'calendar'], ['g', null], ['z', 'calendar']], 'layout kept, a bad one is null, my own is the page\'s');
  same(peopleFromPresence(list, { you: 'me' })[0].layout, 'map', 'with no word of the page\'s, the server\'s');
  const faces = facesOnTab(people, 'calendar', 3);
  same([faces.shown.map((p) => p.key), faces.more, faces.all.length], [['me', 'a', 'b'], 2, 5], 'you first, three faces, +2');
  same(facesOnTab(people, 'map', 3), { all: [], shown: [], more: 0 }, 'nobody on it');
  same(facesOnTab(people, 'calendar', 0).more, 5, 'no room: all counted');
}

// --- the page, as source ---------------------------------------------------------------------------------------------------
{
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  const peopleJs = fs.readFileSync(path.join(ROOT, 'public/space-people.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  const press = space.slice(space.indexOf('function pressLayoutTab('), space.indexOf('// Modified (Thomas'));
  ok((press.match(/\n {2,4}sayWhere\(\);/g) || []).length === 2, 'every tab shown is said (the Workspace and the rest), remembered or not');
  ok(/if \(spaceId\) sayWhere\(\); \/\/ a new stream starts with no tab said/.test(space), 'said again on every ready');
  ok(/api\('PUT', `\/api\/spaces\/\$\{encodeURIComponent\(space\)\}\/where`, \{ layout, stream: ready\.stream \}\)/.test(space), 'PUT .../where, naming the stream');
  ok(/err\.status === 429\) \{ clearTimeout\(whereTimer\); whereTimer = setTimeout\(sendWhere/.test(space), 'a 429 is said again when the server allows');
  ok(/const whoHereTopWanted = \(\) => [^\n]*&& !tabFacesShown\(\);/.test(space) && /\ntabFacesShown = layoutTabsWanted;/.test(space), 'Who is here leaves the desktop bar where the tabs show their faces');
  ok(/const whoHereBar = nav\.get\('who-here'\);/.test(space) && /const people = wide \? whoHereTop : whoHereBar;/.test(space), 'a phone keeps its Online item');
  ok(/createFaceStack\(\{ doc, portraitUrl: spacePortraitUrl/.test(space) && /facesOnTab\(people, id, TAB_FACES\)/.test(space), 'the tabs draw the shared face stack, three and +N');
  ok(/export const TAB_FACES = 3;/.test(peopleJs) && /export function makePortrait\(/.test(peopleJs) && /const entry = \{ src, node: makePortrait\(/.test(peopleJs), 'one portrait piece for Who is here and the tabs');
  ok(/className = 'sdk-avatar-stack tab-faces'/.test(peopleJs), 'the SDK\'s avatar stack');
  ok(/openHostMenu\(side, \(\) => \{/.test(space), 'who is where opens on the shared menu');
  ok(/tabOf: \(p\) => \(p\.layout \? tabLabelOf\(p\.layout\) : ''\)/.test(space), 'Online\'s list says each person\'s tab (a phone reads it there)');
  const block = css.slice(css.indexOf('.layout-tabs > .layout-tab-side {'), css.indexOf('.who-here-tab {') + 300);
  ok(block.length > 300 && !/#[0-9a-f]{3,8}\b|rgba?\(/i.test(block), 'the faces\' styles use the theme tokens, no raw colours');
  ok(/\.layout-tabs > \.layout-tab-side\[hidden\],\n\.layout-tabs > \.layout-tab-side\.layout-tab-out \{ display: none; \}/.test(css), 'an empty tab shows no faces, nor does a tab in the "..."');
  ok(/\.tab-faces > \.sdk-avatar \{ --av: 22px;/.test(css) && /--av-overlap: calc\(var\(--space-2\) \* -1\)/.test(fs.readFileSync(path.join(ROOT, 'public/sdk/system.css'), 'utf8')), 'faces are 22px, overlapping 8px, inside the tab\'s pill');
  ok(/personTint\(person\.key\)/.test(peopleJs) && /fallback=none/.test(peopleJs), 'no picture: the first letter on the person\'s own tint, never the server plate');
}

// --- the route, against a throwaway server ------------------------------------------------------------------------------
const server = await startServer('check-layout-presence', { PRESENCE_CHANGES_PER_MINUTE: '12' });
const open = [];
try {
  const { call, openStream } = client(server.port);
  const { T, keys, A, B, link, pass, expect } = await seedSpace(call, () => { n += 1; });
  const W = (id = A) => `/api/spaces/${id}/where`;
  const live = async (who, id = A) => { const s = await openStream(`/api/live?space=${id}`, who); open.push(s); return s; };
  const sentence = (r, label) => { assert.match(r.json?.error || '', /^[A-Z"][^\n]*\.$/, `${label}: one plain sentence (${r.text})`); n += 1; };
  const refuse = async (label, status, opts, id = A) => { const r = await expect(label, status, 'PUT', W(id), opts); sentence(r, label); return r; };

  // Every kind of viewer, each with a stream open.
  const watch = await live(T.member2);
  const streams = {};
  for (const who of ['admin', 'owner', 'mod', 'member']) streams[who] = await live(T[who]);
  for (const [who, layout] of [['admin', 'calendar'], ['owner', 'documents'], ['mod', 'conference'], ['member', 'workspace']]) {
    const r = await expect(`${who} says their tab`, 200, 'PUT', W(), { who: T[who], body: { layout, stream: streams[who].ready.stream } });
    same(r.json, { layout }, `${who}: 200 { layout }`);
  }
  const memberKey = keys.member;
  const said = await watch.until((e) => e.type === 'presence' && e.people.find((p) => p.key === keys.mod)?.layout === 'conference' && e.people.find((p) => p.key === keys.member)?.layout === 'workspace');
  same(said.people.find((p) => p.key === memberKey).layout, 'workspace', 'another page reads each person\'s tab on the presence event');
  same(said.people.find((p) => p.key === keys.member2).layout, null, 'one that has said nothing reads null');
  // With no `stream`, every stream of theirs there.
  await expect('the member, no stream named', 200, 'PUT', W(), { who: T.member, body: { layout: 'calendar' } });
  await watch.until((e) => e.type === 'presence' && e.people.find((p) => p.key === memberKey)?.layout === 'calendar');
  // The same tab again sends nothing new.
  const before = watch.events.length;
  await expect('the same again', 200, 'PUT', W(), { who: T.member, body: { layout: 'calendar' } });
  await quiet(300);
  same(watch.events.slice(before).filter((e) => e.type === 'presence').length, 0, 'the same tab again tells nobody');

  // What it takes.
  const NONE = 'There is no such layout here.';
  for (const [label, body] of [['no body', undefined], ['an empty object', {}], ['null', { layout: null }], ['a number', { layout: 7 }], ['a list', { layout: ['map'] }], ['an empty id', { layout: '' }], ['an unknown id', { layout: 'nosuch' }], ['a different case', { layout: 'Calendar' }], ['__proto__', { layout: '__proto__' }], ['Map, with Maps not on', { layout: 'map' }], ['a long id', { layout: 'x'.repeat(5000) }]]) {
    const r = await refuse(label, 400, { who: T.member, body });
    same(r.json.error, NONE, `${label}: the sentence`);
  }
  await refuse('a stream that is not text', 400, { who: T.member, body: { layout: 'calendar', stream: 7 } });
  // Saved layouts: one they can see; another person's own never; a person's own reads as 'personal' to the others.
  const shared = (await expect('the owner shares one', 201, 'POST', `/api/spaces/${A}/layouts`, { who: T.owner, body: { name: 'Everyone', shape: 'one', areas: [null], shared: true } })).json.layout;
  const mine = (await expect('the member saves one', 201, 'POST', `/api/spaces/${A}/layouts`, { who: T.member, body: { name: 'Mine', modules: [] } })).json.layout;
  await expect('a shared layout', 200, 'PUT', W(), { who: T.mod, body: { layout: shared.id } });
  await watch.until((e) => e.type === 'presence' && e.people.find((p) => p.key === keys.mod)?.layout === shared.id);
  n += 1;
  await expect('their own layout', 200, 'PUT', W(), { who: T.member, body: { layout: mine.id } });
  const personal = await watch.until((e) => e.type === 'presence' && e.people.find((p) => p.key === memberKey)?.layout === 'personal');
  ok(!JSON.stringify(personal).includes(mine.id), 'a person\'s own layout reads as personal; its id is never sent');
  const r1 = await refuse('another person\'s own layout', 400, { who: T.mod, body: { layout: mine.id } });
  same(r1.json.error, NONE, 'it does not say the layout exists');
  await refuse('a shared layout of this space, in another space', 400, { who: T.member, body: { layout: shared.id } }, B);

  // Who may not.
  await refuse('nobody signed in', 401, { body: { layout: 'workspace' } });
  await refuse('someone outside the space', 403, { who: T.other, body: { layout: 'workspace' } });
  await refuse('the moderator of another space', 403, { who: T.modB, body: { layout: 'workspace' } });
  const gl = await call('PUT', `${W()}?guest=${encodeURIComponent(link)}`, { body: { layout: 'workspace' } });
  same(gl.status, 403, 'a guest link: 403');
  sentence(gl, 'a guest link');
  const g = await openStream(`/api/live?space=${A}&guest=${encodeURIComponent(link)}&pass=${encodeURIComponent(pass)}`, null);
  open.push(g);
  const gr = await call('PUT', `${W()}?guest=${encodeURIComponent(link)}`, { body: { layout: 'workspace', stream: g.ready.stream } });
  same(gr.status, 403, 'a guest with a stream open: 403 (no tabs)');
  const agentAnswer = await call('PUT', W(), { who: T.agent, body: { layout: 'workspace' } });
  same([agentAnswer.status, agentAnswer.json?.error], [403, "An agent can't do that."], 'an agent: 403');
  await refuse('an Aside id or no such space', 404, { who: T.admin, body: { layout: 'workspace' } }, 'zzzz9999');
  // No stream of theirs there (Beta's moderator, in Beta): 409.
  const noStream = await call('PUT', W(B), { who: T.modB, body: { layout: 'workspace' } });
  same(noStream.status, 409, 'no live stream of theirs there: 409');
  sentence(noStream, '409');
  const otherStream = await call('PUT', W(), { who: T.member, body: { layout: 'workspace', stream: streams.mod.ready.stream } });
  same(otherStream.status, 409, 'naming another person\'s stream: 409, nothing changed');

  // A closed space: its members are refused; its moderator, the owners and the admin are not.
  await expect('close Alpha', 200, 'PATCH', `/api/spaces/${A}`, { who: T.mod, body: { closed: true } });
  const closed = await call('PUT', W(), { who: T.member, body: { layout: 'workspace' } });
  ok(closed.status === 403 || closed.status === 404, `a closed space's member: refused (${closed.status})`);
  await expect('the moderator still may', 200, 'PUT', W(), { who: T.mod, body: { layout: 'workspace' } });
  await expect('reopen', 200, 'PATCH', `/api/spaces/${A}`, { who: T.mod, body: { closed: false } });

  // The limit: PRESENCE_CHANGES_PER_MINUTE (12 here) tab changes a minute, then 429 with Retry-After.
  const fresh = await live(T.owner);
  let got = null;
  for (let i = 0; i < 20 && !got; i += 1) {
    const r = await call('PUT', W(), { who: T.owner, body: { layout: i % 2 ? 'calendar' : 'workspace', stream: fresh.ready.stream } });
    if (r.status === 429) got = r;
  }
  ok(got && Number(got.retryAfter) >= 1, 'past the minute\'s changes: 429 with Retry-After');
  sentence(got, '429');
  const away = await call('PATCH', `/api/spaces/${A}/presence`, { who: T.owner, body: { away: true } });
  same(away.status, 200, 'away is counted apart: still allowed');

  // Nothing is stored.
  ok(!fs.readFileSync(path.join(server.dir, 'layouts.json'), 'utf8').includes('"where"'), 'nothing about tabs in layouts.json');
  console.log(`check-layout-presence: OK (${n} checks)`);
} finally {
  for (const s of open) s.close?.();
  await server.stop();
}
