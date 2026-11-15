#!/usr/bin/env node
/*
 * check-copy-rights.mjs -- a copy of another module's dated object (plan-plan-calendar-sync.md: the Itinerary's entries on the
 * Calendar) follows its original's rights (GitHub #857, Thomas 2026-11-15, "Check rights, hide copies"):
 *   - Changing a copy (a write, which writes back to the original; a delete, which hides it for good; a clear of the module
 *     that holds it) needs the write permission of the original's module in that space. Without it: 403 with one sentence,
 *     and neither the copy nor the original changes. With it: as before.
 *   - A copy whose original's module the person may not read there (their role's view off, or the module off for the
 *     space's template) is not there for them: not in the module's data (list, one key, the spaces read), not resolved, not
 *     searched, not on their live stream, not in their calendar feed.
 *   - A copy they may read and not change resolves with `readOnly: true`.
 *   - A moderator, an owner and the admin keep what their rights give; a space's guest link is held the same way.
 * Against the bundled Planner (travel) and Calendar on a throwaway server. No network beyond localhost, no LiveKit.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASSWORD = 'copy-rights-pass-1';

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`check-copy-rights: ${name}: ${err.stack || err.message}`); }
};

function startServer(dataDir) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, TZ: 'UTC', ADMIN_PASSWORD: PASSWORD, CLEAR_UNDO_SECONDS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 30000);
    const onData = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  }).then((port) => ({ port, log: () => out, stop: () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); }) }));
}

function request(server, method, urlPath, { body, type, cookie } = {}) {
  const payload = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  const headers = { host: `127.0.0.1:${server.port}`, accept: 'application/json' };
  if (payload) { headers['content-type'] = type || 'application/json'; headers['content-length'] = payload.length; }
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

// The module stream of one space as `cookie` (or a guest link's `guest` token), keeping each change and changes event.
function openStream(server, { cookie, guest }, space) {
  const events = [];
  let buf = '';
  let res = null;
  const q = `space=${encodeURIComponent(space)}${guest ? `&guest=${encodeURIComponent(guest)}` : ''}`;
  const req = http.request({
    host: '127.0.0.1', port: server.port, path: `/api/modules/stream?${q}`,
    headers: { host: `127.0.0.1:${server.port}`, accept: 'text/event-stream', ...(cookie ? { cookie } : {}) },
  }, (response) => {
    res = response;
    response.on('data', (c) => {
      buf += c.toString('utf8');
      const parts = buf.split(/\n\n/);
      buf = parts.pop();
      for (const part of parts) {
        let event = 'message';
        let data = '';
        for (const line of part.split(/\n/)) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (!data) continue;
        try { events.push({ event, data: JSON.parse(data) }); } catch { /* a comment or a ping */ }
      }
    });
  });
  req.end();
  return { events, close: () => { req.destroy(); if (res) res.destroy(); } };
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-copy-rights-'));
const dataDir = path.join(base, 'data');
let server = null;
const streams = [];
try {
  server = await startServer(dataDir);
  const login = async (who) => cookieOf(await request(server, 'POST', '/api/login', { body: { login: who, password: PASSWORD } }));
  const cookies = { admin: await login('admin') };
  const call = (method, url, body, as = 'admin') => request(server, method, url, { cookie: cookies[as], body });
  const ok = async (method, url, body, as = 'admin') => {
    const r = await call(method, url, body, as);
    assert.ok(r.status < 300, `${method} ${url} as ${as} answered ${r.status}: ${r.text}`);
    return r.json;
  };

  // The Planner, the Calendar and To-do (which links to anything, for search), on; three people and a space.
  for (const id of ['travel', 'calendar', 'todo']) {
    const had = await call('POST', `/api/modules/bundled/${id}/install`);
    assert.ok(had.status < 300 || /already installed/.test(had.text), `install ${id}: ${had.status} ${had.text}`);
    await ok('PATCH', `/api/modules/${id}`, { enabled: true });
  }
  const users = {};
  for (const [name, role] of [['sam', 'member'], ['mia', 'member'], ['olga', 'owner']]) {
    const made = await call('POST', '/api/users', { login: name, displayName: name, role, password: PASSWORD });
    assert.equal(made.status < 300, true, `user ${name}: ${made.text}`);
    users[name] = made.json.user.key;
    cookies[name] = await login(name);
  }
  const S = (await ok('POST', '/api/spaces', { name: 'Lisbon', starter: false, members: [users.sam, users.mia, users.olga] })).space.id;
  await ok('PATCH', `/api/users/${users.mia}/spaces/${S}`, { permissions: { moderator: true } });
  const guestToken = (await call('POST', `/api/spaces/${S}/guest-link`)).json?.space?.guestToken || (await call('GET', `/api/spaces/${S}`)).json?.space?.guestToken;
  assert.ok(guestToken, 'the space has a guest link');
  const asGuest = (method, url, body) => request(server, method, `${url}${url.includes('?') ? '&' : '?'}guest=${encodeURIComponent(guestToken)}`, { body });
  const roles = (role, patch) => ok('PATCH', `/api/roles/${role}`, patch);

  const at = `scope=space&space=${S}`;
  const planUrl = `/api/modules/travel/data/plan:w1?${at}`;
  await ok('PUT', planUrl, { value: { id: 'w1', title: 'Walk', date: '2027-06-15', time: '09:30' }, tz: 'UTC' });
  const links = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'modules', 'links.json'), 'utf8'));
  const pair = () => links().find((l) => l.pair && l.from.module === 'travel' && l.from.id === 'w1');
  assert.ok(pair() && pair().pair === 'active', 'plan:w1 has its Calendar copy');
  const copyId = pair().to.id;
  const copyUrl = `/api/modules/calendar/data/event:${copyId}?${at}`;
  const copyRef = { module: 'calendar', kind: 'event', id: copyId, scope: 'space', space: S };
  const plan = async () => (await call('GET', planUrl)).json.item.value;
  const copy = async () => (await call('GET', copyUrl)).json.item;
  // A Calendar event of the space's own, never a copy: its rights are the Calendar's alone.
  await ok('PUT', `/api/modules/calendar/data/event:own1?${at}`, { value: { id: 'own1', title: 'Dinner', start: '2027-06-16', allDay: true, end: null, desc: '', remind: null, repeat: null, by: 'admin' } });
  const editCopy = async (as, title) => {
    const item = await copy();
    return call('PUT', copyUrl, { value: { ...item.value, title }, version: item.version, tz: 'UTC' }, as);
  };
  const listed = async (as) => {
    const r = await call('GET', `/api/modules/calendar/data?${at}`, undefined, as);
    assert.equal(r.status, 200, r.text);
    return r.json.items.map((i) => i.key);
  };

  await test('with the original\'s edit, a member changes the copy and the original follows', async () => {
    const r = await editCopy('sam', 'Long walk');
    assert.equal(r.status, 200, r.text);
    assert.equal((await plan()).title, 'Long walk');
  });

  await roles('member', { 'module.travel.edit': false });
  const refusal = /^This is a copy of an? .+ in .+, and you can't change .+ in this .+, so you can't change the copy\.$/;

  await test('without the original\'s edit, a change to the copy is refused with a sentence and nothing changes', async () => {
    const before = await copy();
    const r = await editCopy('sam', 'Sneaky');
    assert.equal(r.status, 403, r.text);
    assert.match(r.json.error, refusal);
    assert.equal((await plan()).title, 'Long walk', 'the planner entry is unchanged');
    const after = await copy();
    assert.equal(after.value.title, 'Long walk', 'the copy is unchanged');
    assert.equal(after.version, before.version);
  });

  await test('without the original\'s edit, the copy is not deleted, and a Clear takes the Calendar\'s own events and leaves the copy', async () => {
    const del = await call('DELETE', copyUrl, undefined, 'sam');
    assert.equal(del.status, 403, del.text);
    assert.match(del.json.error, refusal);
    assert.equal(pair().pair, 'active', 'the pair is still active');
    const clear = await call('DELETE', `/api/modules/calendar/data?${at}`, undefined, 'sam');
    assert.equal(clear.status, 200, clear.text);
    assert.equal(clear.json.cleared, 1, 'the Calendar\'s own event only');
    const keys = await listed('admin');
    assert.ok(keys.includes(`event:${copyId}`), 'the copy stays');
    assert.ok(!keys.includes('event:own1'));
    assert.equal(pair().pair, 'active');
    const back = await call('POST', `/api/modules/calendar/data/restore?${at}`, { restoreToken: clear.json.restoreToken }, 'sam');
    assert.equal(back.status, 200, back.text);
    assert.equal(back.json.restored, 1);
    assert.ok((await listed('admin')).includes('event:own1'));
  });

  await test('without the original\'s edit, the copy is still read, and resolves read-only; the Calendar\'s own event is changed as before', async () => {
    assert.ok((await listed('sam')).includes(`event:${copyId}`));
    const one = await call('GET', copyUrl, undefined, 'sam');
    assert.equal(one.status, 200, one.text);
    const sum = await call('POST', '/api/objects/resolve', { from: 'todo', refs: [copyRef] }, 'sam');
    assert.equal(sum.status, 200, sum.text);
    assert.equal(sum.json.summaries[0].copy, true, JSON.stringify(sum.json));
    assert.equal(sum.json.summaries[0].readOnly, true);
    const mine = await call('GET', `/api/modules/calendar/data/event:own1?${at}`, undefined, 'sam');
    const put = await call('PUT', `/api/modules/calendar/data/event:own1?${at}`, { value: { ...mine.json.item.value, title: 'Late dinner' } }, 'sam');
    assert.equal(put.status, 200, put.text);
    const adminSum = await call('POST', '/api/objects/resolve', { from: 'todo', refs: [copyRef] });
    assert.equal(adminSum.json.summaries[0].readOnly, undefined, 'the admin may change it');
  });

  await test('a moderator of the space, an owner and the admin still change the copy', async () => {
    for (const [as, title] of [['mia', 'Walk by mia'], ['olga', 'Walk by olga'], ['admin', 'Walk']]) {
      const r = await editCopy(as, title);
      assert.equal(r.status, 200, `${as}: ${r.text}`);
      assert.equal((await plan()).title, title, as);
    }
  });

  // Streams open now: the admin's, and sam's once the original is out of his sight.
  await roles('member', { 'module.travel.view': false });
  const adminStream = openStream(server, { cookie: cookies.admin }, S);
  const samStream = openStream(server, { cookie: cookies.sam }, S);
  streams.push(adminStream, samStream);
  await pause(300);

  await test('without the original\'s view, the copy is not in the data, one key, the spaces read, resolve or search', async () => {
    const keys = await listed('sam');
    assert.ok(!keys.includes(`event:${copyId}`), 'not listed');
    assert.ok(keys.includes('event:own1'), 'the Calendar\'s own event is still listed');
    const one = await call('GET', copyUrl, undefined, 'sam');
    assert.equal(one.status, 404, one.text);
    // A write or delete of a hidden copy answers as for a key that is not there, and changes nothing.
    const missingUrl = `/api/modules/calendar/data/event:nothinghere?${at}`;
    for (const body of [{ value: { title: 'Blind', start: '2027-06-20', allDay: true }, version: 5 }]) {
      const hidden = await call('PUT', copyUrl, body, 'sam');
      const missing = await call('PUT', missingUrl, body, 'sam');
      assert.deepEqual([hidden.status, hidden.json], [missing.status, missing.json], 'PUT with a version');
      assert.equal(hidden.status, 409);
    }
    const blind = await call('PUT', copyUrl, { value: { title: 'Blind', start: '2027-06-20', allDay: true } }, 'sam');
    assert.deepEqual([blind.status, blind.json], [409, { error: 'someone changed this since you read it', current: null }]);
    assert.equal((await plan()).title, 'Walk');
    const hiddenDel = await call('DELETE', copyUrl, undefined, 'sam');
    const missingDel = await call('DELETE', `/api/modules/calendar/data/event:nothinghere?${at}&version=3`, undefined, 'sam');
    assert.deepEqual([hiddenDel.status, hiddenDel.json], [200, { key: `event:${copyId}`, deleted: true, version: 0 }]);
    assert.deepEqual([missingDel.status, missingDel.json], [200, { key: 'event:nothinghere', deleted: true, version: 0 }]);
    assert.equal(pair().pair, 'active', 'the hidden copy is still there');
    assert.equal((await copy()).value.title, 'Walk');
    const spaces = await call('GET', '/api/modules/calendar/spaces-data', undefined, 'sam');
    assert.equal(spaces.status, 200, spaces.text);
    assert.ok(!spaces.json.items.some((i) => i.key === `event:${copyId}`), 'not in the spaces read');
    assert.ok(spaces.json.items.some((i) => i.key === 'event:own1'));
    const sum = await call('POST', '/api/objects/resolve', { from: 'todo', refs: [copyRef] }, 'sam');
    assert.equal(sum.json.summaries[0].state, 'hidden', JSON.stringify(sum.json));
    const one2 = await call('GET', `/api/modules/calendar/objects/event/${copyId}?${at}&from=todo`, undefined, 'sam');
    assert.equal(one2.status, 403, one2.text);
    const search = await call('GET', `/api/objects/search?from=todo&${at}&q=walk`, undefined, 'sam');
    assert.equal(search.status, 200, search.text);
    assert.equal(search.json.summaries.filter((s) => s.ref.module === 'calendar').length, 0, JSON.stringify(search.json));
    const adminSearch = await call('GET', `/api/objects/search?from=todo&${at}&q=walk`);
    assert.ok(adminSearch.json.summaries.some((s) => s.ref.module === 'travel'), 'the admin finds the original');
  });

  await test('without the original\'s view, the copy\'s changes do not reach the live stream', async () => {
    await ok('PUT', planUrl, { value: { ...(await plan()), title: 'Walk again' }, tz: 'UTC' });
    await pause(400);
    const heard = (s) => s.events.filter((e) => e.event === 'change' && e.data.module === 'calendar' && e.data.key === `event:${copyId}`);
    assert.ok(heard(adminStream).length >= 1, 'the admin hears the copy change');
    assert.equal(heard(samStream).length, 0, 'sam hears nothing of it');
    assert.equal((await copy()).value.title, 'Walk again');
  });


  await test('without the original\'s view, a bus event about the copy reaches neither the stream nor the missed events', async () => {
    const published = await call('POST', '/api/bus/publish', { module: 'calendar', name: 'ended', ref: copyRef, data: { summary: 'Secret Walk, Jun 15' }, scope: 'space', space: S });
    assert.equal(published.status, 200, published.text);
    await call('POST', '/api/bus/publish', { module: 'calendar', name: 'ended', ref: { ...copyRef, id: 'own1' }, data: { summary: 'Dinner, Jun 16' }, scope: 'space', space: S });
    await pause(400);
    const busOf = (s) => s.events.filter((e) => e.event === 'bus').map((e) => e.data.data?.summary);
    assert.ok(busOf(adminStream).includes('Secret Walk, Jun 15'), 'the admin hears it');
    assert.ok(!busOf(samStream).includes('Secret Walk, Jun 15'), 'sam hears nothing of it');
    assert.ok(busOf(samStream).includes('Dinner, Jun 16'), 'sam hears of the Calendar\'s own event');
    const missed = async (as) => (await call('GET', `/api/bus/events?module=todo&scope=space&space=${S}&after=0`, undefined, as)).json.events.map((e) => e.data?.summary);
    assert.ok((await missed('admin')).includes('Secret Walk, Jun 15'));
    const sams = await missed('sam');
    assert.ok(!sams.includes('Secret Walk, Jun 15'), JSON.stringify(sams));
    assert.ok(sams.includes('Dinner, Jun 16'));
  });

  await test('without the original\'s view, a new copy\'s links event does not reach the stream', async () => {
    await ok('PUT', `/api/modules/travel/data/plan:w2?${at}`, { value: { id: 'w2', title: 'Tram', date: '2027-06-18' }, tz: 'UTC' });
    await pause(400);
    const second = links().find((l) => l.pair && l.from.id === 'w2');
    assert.ok(second, 'plan:w2 has a copy');
    const linksOf = (s) => s.events.filter((e) => e.event === 'links' && e.data.ref.module === 'calendar' && e.data.ref.id === second.to.id);
    assert.ok(linksOf(adminStream).length >= 1, 'the admin hears it');
    assert.equal(linksOf(samStream).length, 0, 'sam hears nothing of it');
  });

  await test('a reminder of a copy reaches only those who may read the original, and its firing too', async () => {
    const sched = (as, body) => call('POST', `/api/modules/calendar/schedule?${at}`, body, as);
    const bad = await sched('admin', { key: 'remind:bad', at: Date.now() + 60000, ref: { ...copyRef, module: 'travel' } });
    assert.equal(bad.status, 400, bad.text);
    assert.match(bad.json.error, /^a schedule can only be about one of its .+'s own .+, in the same place$/);
    const blind = await sched('sam', { key: `remind:${copyId}`, at: Date.now() + 60000, ref: copyRef, notify: { title: 'Secret Walk' } });
    assert.equal(blind.status, 404, blind.text);
    const set = await sched('admin', { key: `remind:${copyId}`, at: Date.now() + 300, payload: { id: copyId }, ref: copyRef, notify: { title: 'Secret Walk', body: 'Starting now' } });
    assert.equal(set.status, 200, set.text);
    const titles = async (as) => (await call('GET', '/api/notifications', undefined, as)).json.notifications.map((x) => x.title);
    for (let i = 0; i < 60 && !(await titles('mia')).includes('Secret Walk'); i += 1) await pause(250);
    assert.ok((await titles('mia')).includes('Secret Walk'), 'the moderator, who may read the Planner, is told');
    assert.ok(!(await titles('sam')).includes('Secret Walk'), 'sam is not');
    const fired = (s) => s.events.filter((e) => e.event === 'schedule' && e.data.key === `remind:${copyId}`);
    assert.ok(fired(adminStream).length >= 1, 'the admin\'s stream hears it fire');
    assert.equal(fired(samStream).length, 0, 'sam\'s does not');
  });

  await test('without the original\'s view, the copy is not in the person\'s calendar feed', async () => {
    await ok('PATCH', '/api/settings', { calendarFeeds: true });
    const feedText = async (as) => {
      const made = await call('POST', '/api/me/feed', undefined, as);
      assert.equal(made.status, 201, made.text);
      const r = await request(server, 'GET', new URL(made.json.url).pathname);
      assert.equal(r.status, 200, r.text);
      return r.text;
    };
    const sams = await feedText('sam');
    assert.ok(!sams.includes('Walk again'), 'sam\'s feed has no copy');
    assert.ok(sams.includes('Late dinner'), 'sam\'s feed has the Calendar\'s own event');
    assert.ok((await feedText('admin')).includes('Walk again'), 'the admin\'s feed has the copy');
  });

  await test('a guest link sees the copy while guests may view the original, and is held to its edit', async () => {
    const list = async () => (await asGuest('GET', `/api/modules/calendar/data?${at}`)).json.items.map((i) => i.key);
    assert.ok((await list()).includes(`event:${copyId}`), 'guests view the Planner by default');
    await roles('guest', { 'module.calendar.edit': true });
    const item = await copy();
    const r = await asGuest('PUT', copyUrl, { value: { ...item.value, title: 'Guest walk' }, version: item.version, tz: 'UTC' });
    assert.equal(r.status, 403, r.text);
    assert.match(r.json.error, refusal);
    assert.equal((await plan()).title, 'Walk again');
    await roles('guest', { 'module.travel.view': false });
    assert.ok(!(await list()).includes(`event:${copyId}`), 'hidden once guests may not view the Planner');
    assert.ok((await list()).includes('event:own1'));
    await roles('guest', { 'module.travel.view': true, 'module.calendar.edit': false });
  });

  await test('with the view and edit back, the member changes the copy as before', async () => {
    await roles('member', { 'module.travel.view': true, 'module.travel.edit': true });
    assert.ok((await listed('sam')).includes(`event:${copyId}`));
    const r = await editCopy('sam', 'Back again');
    assert.equal(r.status, 200, r.text);
    assert.equal((await plan()).title, 'Back again');
  });

  await test('the original\'s module off for the space\'s template hides the copy from everyone, the admin too', async () => {
    const switched = await call('PATCH', `/api/spaces/${S}`, { template: 'project' });
    assert.equal(switched.status, 200, switched.text);
    for (const as of ['admin', 'sam']) {
      const keys = await listed(as);
      assert.ok(!keys.includes(`event:${copyId}`), `${as}: not listed`);
      assert.ok(keys.includes('event:own1'), `${as}: the Calendar's own event stays`);
      assert.equal((await call('GET', copyUrl, undefined, as)).status, 404, as);
    }
    // Clear: offered while the Calendar's own events are there, and it takes only those; then neither offered nor refused.
    const clearOffered = async () => {
      const r = await call('GET', `/api/modules/for-space?space=${S}`);
      assert.equal(r.status, 200, r.text);
      return r.json.modules.find((m) => m.id === 'calendar').clear;
    };
    assert.equal(await clearOffered(), true);
    const clear = await call('DELETE', `/api/modules/calendar/data?${at}`);
    assert.equal(clear.status, 200, clear.text);
    assert.equal(clear.json.cleared, 1, 'the Calendar\'s own event; the copies stay');
    assert.equal(await clearOffered(), false, 'only copies nobody may change are left: Clear is not offered');
    for (let i = 0; i < 40 && (await call('DELETE', `/api/modules/calendar/data?${at}`)).status === 409; i += 1) await pause(250);
    const again = await call('DELETE', `/api/modules/calendar/data?${at}`);
    assert.deepEqual([again.status, again.json], [200, { cleared: 0 }], 'and it is not refused either');
    await ok('PATCH', `/api/spaces/${S}`, { template: null });
    assert.ok((await listed('sam')).includes(`event:${copyId}`), 'back once the template offers the Planner again');
    assert.equal(pair().pair, 'active');
  });

  await test('the Calendar page announces an ended event only where it may change it, and its reminders name their event', () => {
    // Read from the page's source (no browser here): announceEnded skips a copy this person may not change, and one not yet
    // known to be a copy or not; applyReminder sends the event's reference with its schedule.
    const src = fs.readFileSync(path.join(ROOT, 'modules', 'calendar', 'src', 'calendar.js'), 'utf8');
    const announce = src.slice(src.indexOf('async function announceEnded'), src.indexOf('announceEnded();'));
    assert.match(announce, /\(canHaveCopy\(x\) && !pairInfo\.has\(x\.key\)\) \|\| !writable\(x\)/);
    assert.match(src, /const writable = \(x\) => !\(pairInfo\.get\(x\.key\) && pairInfo\.get\(x\.key\)\.readOnly\)/);
    const reminder = src.slice(src.indexOf('async function applyReminder'), src.indexOf('async function save'));
    assert.match(reminder, /ref: host\.objects\.make\('event', id, where\)/);
  });

  // The reader's second round (#857): a Clear's hold never turns a copy into a plain event; links, notifications, the bus and
  // schedules by key follow the copy rules.
  const lee = await call('POST', '/api/users', { login: 'lee', displayName: 'lee', role: 'member', password: PASSWORD });
  assert.ok(lee.status < 300, lee.text);
  users.lee = lee.json.user.key;
  cookies.lee = await login('lee'); // a member who is not in the space
  await roles('member', { 'module.travel.view': false, 'module.travel.edit': false });

  await test('a Clear, then an edit of the original, then Undo: the copy comes back as a copy, up to date, still hidden from members', async () => {
    await ok('PUT', `/api/modules/travel/data/plan:w3?${at}`, { value: { id: 'w3', title: 'Ferry', date: '2027-06-19' }, tz: 'UTC' });
    const w3 = () => links().find((l) => l.pair && l.from.id === 'w3');
    const w3Copy = w3().to.id;
    for (let i = 0; i < 40 && (await call('GET', `/api/modules/calendar/data?${at}`)).json.items.length === 0; i += 1) await pause(100);
    let clear;
    for (let i = 0; i < 40; i += 1) {
      clear = await call('DELETE', `/api/modules/calendar/data?${at}`, undefined, 'mia');
      if (clear.status !== 409) break;
      await pause(250);
    }
    assert.equal(clear.status, 200, clear.text);
    assert.ok(clear.json.cleared >= 2, 'the moderator, who may change the Planner, clears the copies too');
    await ok('PUT', planUrl, { value: { ...(await plan()), title: 'Edited while held' }, tz: 'UTC' });
    await ok('PUT', `/api/modules/travel/data/plan:w3?${at}`, { value: { id: 'w3', title: 'Ferry' }, tz: 'UTC' }); // its date cleared
    assert.equal(pair().pair, 'active', 'an edit of the original does not detach a held copy');
    const back = await call('POST', `/api/modules/calendar/data/restore?${at}`, { restoreToken: clear.json.restoreToken }, 'mia');
    assert.equal(back.status, 200, back.text);
    assert.equal(pair().pair, 'active', 'the pair is active again');
    assert.equal((await copy()).value.title, 'Edited while held', 'the copy follows the original');
    assert.ok(!(await listed('sam')).includes(`event:${copyId}`), 'sam does not see it as a plain event');
    assert.equal(w3(), undefined, 'the undated original has no pair');
    assert.ok(!(await listed('admin')).includes(`event:${w3Copy}`), 'and its copy did not come back as a plain event');
    await ok('PUT', planUrl, { value: { ...(await plan()), title: 'After undo' }, tz: 'UTC' });
    assert.equal((await copy()).value.title, 'After undo', 'the pair follows the original again');
  });

  await test('the links of a copy change only for whoever may change its original', async () => {
    await ok('PUT', `/api/modules/calendar/data/event:own2?${at}`, { value: { id: 'own2', title: 'Lunch', start: '2027-06-17', allDay: true, end: null, desc: '', remind: null, repeat: null, by: 'admin' } });
    const own = { module: 'calendar', kind: 'event', id: 'own2', scope: 'space', space: S };
    const linksFrom = () => links().filter((l) => !l.pair && l.from.module === 'calendar' && l.from.id === copyId);
    const hidden = await call('POST', '/api/objects/links', { module: 'calendar', from: copyRef, to: [own] }, 'sam');
    assert.equal(hidden.status, 200, hidden.text);
    assert.equal(linksFrom().length, 0, 'nothing is kept for a copy sam may not see');
    await roles('member', { 'module.travel.view': true });
    for (const body of [{ to: [own] }, { to: [own], kind: 'event', op: 'add' }]) {
      const r = await call('POST', '/api/objects/links', { module: 'calendar', from: copyRef, ...body }, 'sam');
      assert.equal(r.status, 403, r.text);
      assert.match(r.json.error, refusal);
    }
    assert.equal(linksFrom().length, 0);
    const r = await call('POST', '/api/objects/links', { module: 'calendar', from: copyRef, to: [own] }, 'mia');
    assert.equal(r.status, 200, r.text);
    assert.equal(linksFrom().length, 1, 'the moderator may');
    await roles('member', { 'module.travel.view': false });
  });

  await test('a copy\'s notification never reaches someone outside its space, and the bus and schedules by key keep to the copy rules', async () => {
    await roles('member', { 'module.travel.view': true });
    const sched = (as, body) => call('POST', `/api/modules/calendar/schedule?${at}`, body, as);
    const titles = async (as) => (await call('GET', '/api/notifications', undefined, as)).json.notifications.map((x) => x.title);
    assert.equal((await sched('admin', { key: 'remind:lee', at: Date.now() + 300, ref: copyRef, notify: { to: users.lee, title: 'For lee' } })).status, 200);
    assert.equal((await sched('admin', { key: 'remind:own-lee', at: Date.now() + 300, notify: { to: users.lee, title: 'Own for lee' } })).status, 200);
    for (let i = 0; i < 60 && !(await titles('lee')).includes('Own for lee'); i += 1) await pause(250);
    assert.ok((await titles('lee')).includes('Own for lee'), 'lee hears of what is not a copy');
    assert.ok(!(await titles('lee')).includes('For lee'), 'nothing about a copy reaches someone outside its space');
    await roles('member', { 'module.travel.view': false });
    const pub = await call('POST', '/api/bus/publish', { module: 'calendar', name: 'ended', ref: copyRef, data: { summary: 'x' }, scope: 'space', space: S }, 'sam');
    assert.equal(pub.status, 404, pub.text);
    assert.equal((await sched('admin', { key: `remind:${copyId}`, at: Date.now() + 3600000, ref: copyRef, notify: { title: 'Later' } })).status, 200);
    const over = await sched('sam', { key: `remind:${copyId}`, at: Date.now() + 3600000, notify: { title: 'Mine now' } });
    assert.equal(over.status, 404, over.text);
    const cancel = await call('DELETE', `/api/modules/calendar/schedule/${encodeURIComponent(`remind:${copyId}`)}?${at}`, undefined, 'sam');
    assert.deepEqual([cancel.status, cancel.json], [200, { key: `remind:${copyId}`, cancelled: false }]);
    const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'modules', 'schedules.json'), 'utf8')).find((x) => x.key === `remind:${copyId}`);
    assert.equal(stored.notify.title, 'Later', 'the schedule is as the admin set it');
  });

  await test('a due schedule about a copy, written before the server starts, reaches only those who may see the original', async () => {
    for (const st of streams) st.close();
    streams.length = 0;
    await server.stop();
    const file = path.join(dataDir, 'modules', 'schedules.json');
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    list.push({ id: `calendar|space:${S}|remind:boot`, module: 'calendar', scopeKey: `space:${S}`, spaceId: S, key: 'remind:boot', at: Date.now() - 60000, payload: { id: copyId }, notify: { to: 'space', title: 'Boot walk', body: '' }, repeat: null, by: 'admin', ref: copyRef });
    fs.writeFileSync(file, JSON.stringify(list));
    server = await startServer(dataDir);
    for (const who of ['admin', 'sam', 'mia']) cookies[who] = await login(who);
    const titles = async (as) => (await call('GET', '/api/notifications', undefined, as)).json.notifications.map((x) => x.title);
    for (let i = 0; i < 60 && !(await titles('mia')).includes('Boot walk'); i += 1) await pause(250);
    assert.ok((await titles('mia')).includes('Boot walk'), 'the moderator is told');
    assert.ok(!(await titles('sam')).includes('Boot walk'), 'sam is not');
  });
} finally {
  for (const s of streams) s.close();
  if (server) await server.stop();
  fs.rmSync(base, { recursive: true, force: true });
}
if (failed) {
  console.error(`check-copy-rights: ${failed} failed`);
  process.exit(1);
}
console.log(`check-copy-rights: OK (${n})`);
process.exit(0);
