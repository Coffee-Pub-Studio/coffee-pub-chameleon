#!/usr/bin/env node
/*
 * check-bring-everyone.mjs -- Bring everyone here (documentation/plans/plan-workspaces.md, decisions 36 and 48): a
 * moderator moves everyone to a fixed tab, after a 5-second warning each person may decline.
 *   - the page's pure decisions (space-live.js): bringAction (warn, or ignore: another space, an aside, the tab they are
 *     on, a tab they can't open, a malformed message) and stayedCount (who chose to stay, for the mover)
 *   - POST /api/spaces/:id/bring-everyone { layout } and DELETE (stop it): only owners, the admin and the space's
 *     moderators (never a member, a guest, an agent, someone outside, nor a closed space's member); only a fixed layout
 *     other than the Workspace that is on here; the live event fans out to everyone else with a stream open there, never
 *     to the mover, another space or a stream that was not open (nothing is held); one at a time per space (429 while a
 *     warning runs, free again after a stop or after it ends); nothing is stored and nobody's last layout is written
 *   - in a real browser (tools/shots.mjs; SKIPPED with no Chromium, which is not a pass): the moderator's caret menu on a
 *     fixed tab; the warning names who and where, with Stay here; one person stays, another is moved and Go back returns
 *     them; the move writes no last layout; the mover is told how many stayed; Cancel stops it for everyone
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, startServer, client, seedSpace, quiet } from './presence-harness.mjs';

let n = 0;
let failed = 0;
const ok = (cond, label) => { assert.ok(cond, label); n += 1; };
const same = (got, want, label) => { assert.deepEqual(got, want, label); n += 1; };

// --- the page's pure decisions -------------------------------------------------------------------------------------------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-bring-everyone-'));
  fs.copyFileSync(path.join(ROOT, 'public/space-live.js'), path.join(dir, 'space-live.mjs'));
  const { bringAction, stayedCount, BRING_NUDGES } = await import(pathToFileURL(path.join(dir, 'space-live.mjs')).href);
  fs.rmSync(dir, { recursive: true, force: true });
  const data = { type: 'layout-bring', spaceId: 's1', bring: 'b1', layout: 'calendar', by: 'Mona', seconds: 5 };
  const base = { data, spaceId: 's1', aside: false, current: 'workspace', canOpen: true };
  same(bringAction(base), 'warn', 'in the space, on another tab, able to open it: warned');
  for (const [label, change] of [
    ['another space', { spaceId: 's2' }], ['an aside (only the call is there)', { aside: true }], ['no space', { spaceId: null }],
    ['already on that tab', { current: 'calendar' }], ['a tab they can\'t open (a guest, a module off for them)', { canOpen: false }],
    ['a cancel is not a bring', { data: { ...data, type: 'layout-bring-cancel' } }], ['no layout', { data: { ...data, layout: undefined } }],
    ['no bring id', { data: { ...data, bring: 7 } }], ['nothing', { data: null }],
  ]) same(bringAction({ ...base, ...change }), 'ignore', `ignored: ${label}`);
  same(BRING_NUDGES, ['layout-bring', 'layout-bring-cancel'], 'the stream passes on both');
  const people = [{ key: 'me', you: true, layout: 'workspace' }, { key: 'a', layout: 'calendar' }, { key: 'b', layout: 'workspace' }, { key: 'c', layout: 'personal' }, { key: 'g', layout: null }];
  same(stayedCount(people, 'calendar'), 2, 'stayed: the others on another tab; you and the silent (a guest) are not counted');
  same(stayedCount([], 'calendar'), 0, 'nobody');
}

// --- the page, as source ---------------------------------------------------------------------------------------------------
{
  const space = fs.readFileSync(path.join(ROOT, 'public/space.js'), 'utf8');
  const live = fs.readFileSync(path.join(ROOT, 'public/space-live.js'), 'utf8');
  const brand = fs.readFileSync(path.join(ROOT, 'public/brand.js'), 'utf8');
  ok(/onBring: bringNudge,/.test(space) && /else if \(BRING_NUDGES\.includes\(data\.type\)\)/.test(live), 'the live stream hands both events to bringNudge');
  ok(/pressLayoutTab\(bring\.layout, null, \{ remember: false \}\)/.test(space), 'being moved writes no last layout');
  ok(/actions: \[\{ id: 'stay', label: 'Stay here', primary: true \}\]/.test(space) && /actions: \[\{ id: 'back', label: 'Go back' \}\]/.test(space) && /actions: \[\{ id: 'cancel', label: 'Cancel' \}\]/.test(space), 'Stay here, Go back and Cancel');
  ok(/export function actionToast\(/.test(brand) && /pushToast\(\{/.test(brand.slice(brand.indexOf('export function actionToast('))), 'the warning is the shared toast stack\'s');
  ok(/label: 'Bring everyone here'/.test(space) && /if \(mayBring\(\) && bringable\(id\)\)/.test(space), 'offered on a fixed tab\'s menu, to those who may');
  ok(/function bringable\(id\) \{ return id !== 'workspace' && Boolean\(findSystemLayout\(id\)\); \}/.test(space), 'never the Workspace');
  ok(/if \(layoutSpaceId\(\) !== space \|\| inAside\(\) \|\| currentLayoutTab === bring\.layout/.test(space), 'nobody is moved after entering an aside or leaving the space');
}

// --- the routes, against a throwaway server --------------------------------------------------------------------------------
const server = await startServer('check-bring-everyone');
const open = [];
try {
  const { call, openStream } = client(server.port);
  const { T, keys, A, B, link, pass, expect } = await seedSpace(call, () => { n += 1; });
  const BR = (id = A) => `/api/spaces/${id}/bring-everyone`;
  const live = async (who, id = A) => { const s = await openStream(`/api/live?space=${id}`, who); open.push(s); return s; };
  const sentence = (r, label) => { assert.match(r.json?.error || '', /^[A-Z"][^\n]*\.$/, `${label}: one plain sentence (${r.text})`); n += 1; };
  const stop = (who = T.admin) => call('DELETE', BR(), { who });
  const layoutsFile = path.join(server.dir, 'layouts.json');
  const stored = () => (fs.existsSync(layoutsFile) ? fs.readFileSync(layoutsFile, 'utf8') : '');

  const s = { mod: await live(T.mod), member: await live(T.member), member2: await live(T.member2), owner: await live(T.owner) };
  const guest = await openStream(`/api/live?space=${A}&guest=${encodeURIComponent(link)}&pass=${encodeURIComponent(pass)}`, null);
  open.push(guest);
  const elsewhere = await live(T.modB, B); // a page in Beta (a person is in the space of their latest page, so another person's)
  await expect('the member\'s last layout', 200, 'PUT', `/api/spaces/${A}/last-layout`, { who: T.member, body: { layout: 'workspace' } });
  const before = stored();

  // Who may: the moderator, the owner, the admin. The event reaches the others with a stream open, never the mover.
  const r = await expect('the moderator brings everyone to Calendar', 200, 'POST', BR(), { who: T.mod, body: { layout: 'calendar' } });
  same(Object.keys(r.json).sort(), ['bring', 'layout', 'seconds', 'told'], '{ bring, layout, seconds, told }');
  same([r.json.layout, r.json.seconds, r.json.told], ['calendar', 5, 4], 'five seconds; told: the member, the second member, the owner and the guest');
  const isBring = (e) => e.type === 'layout-bring' && e.bring === r.json.bring;
  for (const who of ['member', 'member2', 'owner']) {
    const e = await s[who].until(isBring);
    same([e.spaceId, e.layout, e.by, e.seconds], [A, 'calendar', 'Mona', 5], `${who}: told who and where, by the name on the account`);
  }
  await guest.until(isBring);
  n += 1; // a guest is told too; their page ignores what it can't open
  await quiet(300);
  ok(!s.mod.events.some(isBring), 'not the mover');
  ok(!elsewhere.events.some((e) => e.type === 'layout-bring'), 'not a page in another space');
  // One at a time: 429 while the warning runs.
  const busy = await call('POST', BR(), { who: T.owner, body: { layout: 'documents' } });
  same(busy.status, 429, 'a second bring while the first warns: 429');
  ok(Number(busy.retryAfter) >= 1 && Number(busy.retryAfter) <= 5, 'with Retry-After');
  same(busy.json.error, 'Wait a few seconds, then try again.', 'the sentence');
  // Stop it: the others are told; then a new one may go at once.
  const st = await expect('the owner stops it', 200, 'DELETE', BR(), { who: T.owner });
  same(st.json, { bring: r.json.bring }, '200 { bring }');
  for (const who of ['member', 'mod']) {
    const e = await s[who].until((x) => x.type === 'layout-bring-cancel');
    same([e.bring, e.by, e.spaceId], [r.json.bring, 'Olive', A], `${who}: told it stopped, and by whom`);
  }
  ok(!s.owner.events.some((x) => x.type === 'layout-bring-cancel'), 'not the one who stopped it');
  const nothing = await call('DELETE', BR(), { who: T.owner });
  same(nothing.status, 409, 'nothing left to stop: 409');
  sentence(nothing, '409');
  const second = await expect('the admin may bring at once after a stop', 200, 'POST', BR(), { who: T.admin, body: { layout: 'documents' } });
  same(second.json.told, 5, 'told: everyone else (the moderator now too)');
  await s.mod.until((e) => e.type === 'layout-bring' && e.bring === second.json.bring);
  n += 1;

  // Not held: a page that was closed while it went out does not get it when it comes back.
  s.member2.close();
  await quiet(200);
  await new Promise((res) => setTimeout(res, 5200)); // the admin's warning ends by itself
  const third = await expect('after the warning ends, another may go', 200, 'POST', BR(), { who: T.owner, body: { layout: 'conference' } });
  s.member2 = await live(T.member2);
  await quiet(500);
  ok(!s.member2.events.some((e) => e.type === 'layout-bring'), 'a page that was not open is not told later (nothing is held)');
  await stop(T.owner);

  // Who may not.
  for (const [label, who, status] of [['a member', T.member, 403], ['someone outside', T.other, 403], ['another space\'s moderator', T.modB, 403], ['nobody signed in', null, 401]]) {
    const x = await call('POST', BR(), { who, body: { layout: 'calendar' } });
    same(x.status, status, `${label}: ${status}`);
    sentence(x, label);
    same((await call('DELETE', BR(), { who })).status, status, `${label} can't stop one either`);
  }
  const memberSaid = await call('POST', BR(), { who: T.member, body: { layout: 'calendar' } });
  same(memberSaid.json.error, 'Only owners, the admin and moderators can bring everyone here.', 'the member is told who can');
  const g = await call('POST', `${BR()}?guest=${encodeURIComponent(link)}`, { body: { layout: 'calendar' } });
  same(g.status, 403, 'a guest link: 403');
  const ag = await call('POST', BR(), { who: T.agent, body: { layout: 'calendar' } });
  same([ag.status, ag.json?.error], [403, "An agent can't do that."], 'an agent, a member of the space: 403');
  same((await call('POST', BR('zzzz9999'), { who: T.admin, body: { layout: 'calendar' } })).status, 404, 'an Aside id or no such space: 404');
  same((await call('POST', BR(B), { who: T.mod, body: { layout: 'calendar' } })).status, 404, 'a moderator of Alpha in Beta: not there for them');

  // What may be brought: a fixed layout other than the Workspace, on here.
  const shared = (await expect('the owner shares a layout', 201, 'POST', `/api/spaces/${A}/layouts`, { who: T.owner, body: { name: 'Everyone', shape: 'one', areas: [null], shared: true } })).json.layout;
  for (const [label, body, said] of [
    ['the Workspace (each person\'s own)', { layout: 'workspace' }, 'Only the fixed workspaces can be shown to everyone.'],
    ['a saved layout', { layout: shared.id }, 'Only the fixed workspaces can be shown to everyone.'],
    ['an unknown id', { layout: 'nosuch' }, 'Only the fixed workspaces can be shown to everyone.'],
    ['no layout', {}, 'Only the fixed workspaces can be shown to everyone.'],
    ['a number', { layout: 7 }, 'Only the fixed workspaces can be shown to everyone.'],
    ['Map, with Maps not on', { layout: 'map' }, 'That workspace is not on here.'],
  ]) {
    const x = await call('POST', BR(), { who: T.mod, body });
    same([x.status, x.json?.error], [400, said], `${label}: 400`);
  }

  // A closed space: its moderator still may; its member is refused as for a space that is not there to them.
  await expect('close Alpha', 200, 'PATCH', `/api/spaces/${A}`, { who: T.mod, body: { closed: true } });
  const cm = await call('POST', BR(), { who: T.member, body: { layout: 'calendar' } });
  ok(cm.status === 403 || cm.status === 404, `a closed space's member: refused (${cm.status})`);
  await expect('its moderator still may', 200, 'POST', BR(), { who: T.mod, body: { layout: 'calendar' } });
  await stop(T.mod);
  await expect('reopen', 200, 'PATCH', `/api/spaces/${A}`, { who: T.mod, body: { closed: false } });

  // Nothing stored: layouts.json changed only by the shared layout made above; nobody's last layout moved.
  ok(!/bring/i.test(stored()), 'nothing about a bring is stored');
  ok(stored().length > before.length && JSON.parse(stored()).spaces[A].last[keys.member].layout === 'workspace', 'the member\'s last layout is as it was');
} catch (err) {
  failed += 1;
  console.error(`FAIL the routes\n${err.stack || err}`);
} finally {
  for (const s of open) s.close?.();
  await server.stop();
}

// --- in a real browser -----------------------------------------------------------------------------------------------------
const { bootSeeded, stopServer, freePort, findBrowser, launch, Tab, sleep } = await import('./shots.mjs');
const { stopBrowser } = await import('./browser-launch.mjs');
const bin = findBrowser();
if (!bin) {
  console.log(`check-bring-everyone: SKIPPED the browser part. No Chromium found (set CHROME_PATH). This is not a pass; ${n} checks ran.`);
  process.exit(failed ? 1 : 0);
}
// tools/shots.mjs holds the clock, the toast timers and who is here still for pictures; this check needs them live, so
// each page puts them back before its own scripts run.
const LIVE_AGAIN = `(() => {
  if (Object.getPrototypeOf(window.Date) !== Function.prototype) window.Date = Object.getPrototypeOf(window.Date);
  const si = window.setInterval; window.setTimeout = function (fn, d, ...a) { if (typeof fn !== 'function') return 0; const id = si(() => { clearInterval(id); fn(...a); }, d || 0); return id; };
  if (window.EventSource && Object.getPrototypeOf(window.EventSource) !== EventTarget) window.EventSource = Object.getPrototypeOf(window.EventSource);
})()`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-bring-everyone-data-'));
let seeded;
let browser;
try {
  const port = await freePort();
  seeded = await bootSeeded('travel', dataDir, port);
  const { server: srv, ctx, cookies } = seeded;
  browser = await launch(bin);
  const open = async (as) => {
    const tab = new Tab(browser.cdp, ctx);
    await tab.open(1280, 'light');
    for (const c of cookies[as]) await tab.cdp.send('Network.setCookie', { name: c.name, value: c.value, url: srv.base, httpOnly: true }, tab.sid);
    await tab.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: LIVE_AGAIN }, tab.sid);
    await tab.cdp.send('Page.navigate', { url: `${srv.base}/#join=${ctx.trip}` }, tab.sid);
    await tab.waitFor('#layout-tabs [data-layout-tab]');
    return tab;
  };
  const toasts = (tab) => tab.eval(`document.getElementById('toast-layer')?.innerText.replace(/\\s+/g, ' ').trim() || ''`);
  const shown = (tab) => tab.eval(`document.querySelector('#layout-tabs [aria-current=page]')?.dataset.layoutTab || null`);
  const lastOf = async (as) => (await (await fetch(`${srv.base}/api/spaces/${ctx.trip}/layouts`, { headers: { cookie: cookies[as].map((c) => `${c.name}=${c.value}`).join('; ') } })).json()).last;
  const waitText = async (tab, re, ms = 9000) => { const end = Date.now() + ms; let t = ''; while (Date.now() < end) { t = await toasts(tab); if (re.test(t)) return t; await sleep(200); } throw new Error(`no toast matching ${re}; it said "${t}"`); };
  const admin = await open('admin');
  const mia = await open('mia');
  const sam = await open('sam');
  await sleep(2500);
  const miaLast = await lastOf('mia');
  // The faces: the Workspace tab wears everyone's; Who is here is not in the desktop bar.
  const faces = await admin.eval(`document.querySelector('#layout-tabs > .layout-tab-side[data-tab-side="workspace"]')?.getAttribute('aria-label')`);
  ok(/^On Workspace: /.test(faces || '') && /Mia/.test(faces) && /Sam/.test(faces), `the Workspace tab's faces name who is on it (${faces})`);
  same(await admin.eval(`Boolean(document.querySelector('#who-here-toggle')?.getClientRects().length)`), false, 'Who is here is not in the desktop bar');
  // The moderator's caret menu on Calendar.
  await admin.click('#layout-tabs > .layout-tab-side[data-tab-side="calendar"]');
  await admin.click('.host-menu [role=menuitem]', 'Bring everyone here');
  const warned = await waitText(mia, /is bringing everyone to Calendar/);
  ok(/^admin is bringing everyone to Calendar Moving you in [1-5] seconds?\. Stay here/.test(warned), `the warning says who, where and when, with Stay here (${warned})`);
  ok(/Bringing everyone to Calendar In [1-5] seconds?\. Cancel/.test(await toasts(admin)), 'the mover sees the countdown with Cancel');
  same(await shown(admin), 'calendar', 'the mover is on that tab at once');
  await waitText(sam, /Stay here/);
  await sam.click('.sdk-toast [data-toast-action="stay"]');
  await sleep(6000);
  same(await shown(sam), 'workspace', 'Stay here: not moved');
  same(await shown(mia), 'calendar', 'the other is moved after the warning');
  ok(/admin brought everyone to Calendar Go back/.test(await toasts(mia)), 'then told, with Go back');
  ok(/1 person stayed where they were\./.test(await waitText(admin, /stayed where they were|Everyone is on/)), 'the mover is told how many stayed');
  same(await lastOf('mia'), miaLast, 'being moved wrote no last layout');
  await mia.click('.sdk-toast [data-toast-action="back"]');
  await sleep(600);
  same(await shown(mia), 'workspace', 'Go back returns to the tab they were on');
  // Cancel stops it for everyone. (On Calendar again: the Conference tab can sit in the "...", and its button with it.)
  await sleep(1000);
  await admin.click('#layout-tabs > .layout-tab-side[data-tab-side="calendar"]');
  await admin.click('.host-menu [role=menuitem]', 'Bring everyone here');
  await waitText(mia, /is bringing everyone to Calendar/);
  await admin.click('.sdk-toast [data-toast-action="cancel"]');
  ok(/admin stopped it\. You stay here\./.test(await waitText(mia, /stopped it/)), 'the others are told it stopped');
  await sleep(5500);
  same(await shown(mia), 'workspace', 'and nobody is moved');
  for (const t of [admin, mia, sam]) await t.close();
} catch (err) {
  failed += 1;
  console.error(`FAIL the browser part\n${err.stack || err}`);
} finally {
  if (browser) await stopBrowser(browser.child, browser.dir);
  if (seeded) await stopServer(seeded.server);
  fs.rmSync(dataDir, { recursive: true, force: true });
}
if (failed) { console.error(`check-bring-everyone: ${failed} failed (${n} passed)`); process.exit(1); }
console.log(`check-bring-everyone: OK (${n} checks)`);
process.exit(0);
