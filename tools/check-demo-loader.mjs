#!/usr/bin/env node
/*
 * check-demo-loader.mjs -- the generic demo loader (server/demo-loader.js) and the demo files, one per shipped template
 * (templates/demo/<template id>.json; documentation/plans/plan-demo-space.md, slices 1 and 3).
 * Boots throwaway servers and calls the loader directly (not through tools/seed-demo.mjs) and asserts:
 *  (a) on a travel environment with every module on it makes the seeder's counts: Itinerary 76, Places 37, Calendar 77, To-do 16,
 *      Polls 3, Budget 18, Research 4, Documents 2, Chat 25, with nothing refused or skipped, and random passwords that differ on
 *      every run;
 *  (b) with Budget turned off it skips Budget, says so in one plain sentence, does not turn it on, and makes everything else;
 *  (c) it changes no environment-wide setting: the settings, the modules list, the place search and the template are
 *      identical before and after a run;
 *  (d) a space with the demo's name and no marker, or a person with a demo login and another name, is refused in one sentence,
 *      and nothing at all is made or changed before the refusal;
 *  (e) a second run resets only the demo space and the demo people (another space, its data and another account stay; the
 *      old passwords stop working);
 *  (f) every date in the data file is an offset (no absolute date, no epoch number), a file with an unknown base is refused
 *      before anything is made, and the demo stays ahead of a faked "today" and moves with it;
 *  (h) every sentence reads in the environment's own words (a `words` function renaming space and environment shows in a
 *      refusal and a skip), and a module id outside [a-z0-9-] refuses the file before anything is made;
 *  (i) the last writer of every object is pinned per module (a demo person, never the admin);
 *  (g) a template with no demo file reports "There is no demo for this template." and creates nothing; the data file's
 *      folder does not stop the server (the server started, so templates/ read fine) and every file in it names a bundled
 *      template; every shipped template but Default has one, each with its plain label ("Games demo"); no file holds a password;
 *  (j) each of the other demos (games, project, learning, mentoring) loaded into one travel environment with every bundled
 *      module on: its exact counts, nothing skipped or refused; a second load adds nothing (one space, the same counts); the
 *      space reads the demo's own template: its words, its planner and modules by the template's names, and the phases'
 *      answer from GET /api/spaces/:id/phases (games none; project by dates; learning and mentoring by goals, with the first
 *      phase done and the main one current); with the planner not installed it is skipped in a sentence and not turned on;
 *      with a space's own template turned off the space reads the environment's and the report says so;
 *  (k) a real account is never taken over: one with a demo person's login and name that a demo load did not make (an owner,
 *      or a member) is refused in one sentence before anything is made, its password and role untouched; a demo person
 *      (marked `demo: true` when the load made it, kept in the stored record) that was later made an owner is refused too; a
 *      second load still resets the marked people; `publicBase` is the address the chat links and the guest link use.
 * No LiveKit and no browser are needed.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const loaderPath = process.env.DEMO_LOADER_UNDER_TEST ? path.resolve(process.env.DEMO_LOADER_UNDER_TEST) : path.join(ROOT, 'server', 'demo-loader.js');
const WORDS = require(path.join(ROOT, 'server', 'words.js'));
const { loadDemo, readDemoFile, listDemos, DemoError, MARKER, dayPlus } = require(loaderPath);
const PASSWORD = 'testpass1234';
const ALL = ['travel', 'maps', 'todo', 'polls', 'calendar', 'budget', 'research', 'documents', 'whiteboard', 'vault'];
const WANT = { travel: 76, maps: 37, calendar: 77, todo: 16, polls: 3, budget: 18, research: 4, whiteboard: 15, documents: 2, chat: 25, vault: 8 };
// The other demos' counts (the Calendar's include the copies of dated planner entries, To-do tasks are not copied).
const OTHERS = {
  games: { want: { schedule: 26, research: 8, documents: 3, todo: 9, calendar: 13, budget: 8, polls: 2, chat: 17 }, space: 'campaign', planner: ['schedule', 'Campaign'], names: { calendar: 'Sessions', todo: 'Quests', research: 'Lore', budget: 'Costs' }, measure: 'dates', phases: [] },
  project: { want: { schedule: 21, todo: 11, calendar: 25, budget: 9, research: 6, documents: 2, polls: 1, chat: 15 }, space: 'project', planner: ['schedule', 'Project plan'], names: { budget: 'Effort' }, measure: 'dates', phases: [['start'], ['build'], ['wrap']] },
  learning: { want: { goals: 27, todo: 10, calendar: 14, research: 6, documents: 2, chat: 14 }, space: 'course', planner: ['goals', 'Learning plan'], names: { todo: 'Exercises', research: 'Reading', calendar: 'Sessions' }, measure: 'goals', phases: [['explore', true, 2, 2], ['practice', false, 1, 3, true], ['review', false, 0, 1]] },
  mentoring: { want: { goals: 21, todo: 8, calendar: 10, research: 4, documents: 1, chat: 13 }, space: 'mentorship', planner: ['goals', 'Development plan'], names: { todo: 'Next steps', calendar: 'Check-ins' }, measure: 'goals', phases: [['start', true, 1, 1], ['grow', false, 1, 3, true], ['review', false, 0, 1]] },
};
const TODAY = '2031-03-01';
// Who last wrote each object, per module (the item's `by`, as a demo login): the demo people, never the admin who ran the loader.
const WRITERS = { travel: { mia: 77 }, maps: { mia: 37 }, calendar: { mia: 77 }, todo: { mia: 16 }, polls: { lee: 4, mia: 3, sam: 4 }, budget: { mia: 18 }, research: { mia: 4 }, documents: { mia: 4 } };

const free = () => new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
const servers = [];
async function boot(extraEnv = {}) {
  const port = await free();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-loader-'));
  const child = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), DATA_DIR: dataDir, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ADMIN_PASSWORD: PASSWORD, ...extraEnv } });
  const s = { child, dataDir, log: '', base: `http://127.0.0.1:${port}` };
  child.stdout.on('data', (d) => { s.log += d; }); child.stderr.on('data', (d) => { s.log += d; });
  servers.push(s);
  for (let i = 0; i < 150; i += 1) {
    try { if ((await fetch(`${s.base}/healthz`)).ok) break; } catch { /* not up yet */ }
    if (child.exitCode !== null) throw new Error(`a throwaway server did not start: ${s.log.slice(-400)}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  const jar = {};
  s.api = async (method, url, body) => {
    const r = await fetch(s.base + url, { method, headers: { 'content-type': 'application/json', ...(jar.c ? { cookie: jar.c } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (url === '/api/login') jar.c = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  await s.api('POST', '/api/login', { login: 'admin', password: PASSWORD });
  s.run = (extra = {}) => loadDemo({ base: s.base, templateId: 'travel', today: TODAY, session: { login: 'admin', password: PASSWORD }, ...extra });
  return s;
}
const stopAll = async () => {
  for (const s of servers) {
    if (s.child.exitCode === null) { const gone = new Promise((r) => s.child.once('exit', r)); s.child.kill('SIGTERM'); await Promise.race([gone, new Promise((r) => setTimeout(r, 8000))]); }
    fs.rmSync(s.dataDir, { recursive: true, force: true });
  }
};
const modulesOn = async (s, ids) => { for (const id of ids) { await s.api('POST', `/api/modules/bundled/${id}/install`); await s.api('PATCH', `/api/modules/${id}`, { enabled: true }); } };
// Everything environment-wide a person could set: the settings (template included), the modules and the place search.
const snapshot = async (s) => JSON.stringify({
  settings: (await s.api('GET', '/api/settings')).json.settings,
  modules: (await s.api('GET', '/api/modules')).json.modules.map((m) => ({ id: m.id, enabled: m.enabled, version: m.version })),
  moduleSettings: (await s.api('GET', '/api/module-settings/environment')).json,
});
const rejects = async (p, re, why) => { try { await p; } catch (e) { assert.ok(e instanceof DemoError, `${why}: a DemoError (${e && e.message})`); assert.match(e.message, re, why); return e; } assert.fail(`${why}: it should have been refused`); };

let n = 0; let failed = null;
const step = async (name, fn) => { try { await fn(); n += 1; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };

try {
  // ---- (f) the data file itself: only offsets ----
  for (const demo of ['travel', ...Object.keys(OTHERS)]) await step(`(f) the ${demo} data file holds only date offsets`, async () => {
    const file = readDemoFile(demo);
    const strings = []; const numbers = [];
    const walk = (v) => { if (typeof v === 'string') strings.push(v); else if (typeof v === 'number') numbers.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { strings.push(k); walk(x); }); };
    walk(file);
    const text = fs.readFileSync(path.join(ROOT, 'templates', 'demo', `${demo}.json`), 'utf8');
    assert.ok(!/\b(19|20|21)\d\d-\d\d-\d\d\b/.test(text), 'no YYYY-MM-DD anywhere in the file');
    assert.ok(!/\b(19|20|21)\d\d-\d\d\b/.test(text.replace(/"_about"[^\n]*/, '')), 'no year and month either');
    assert.deepEqual(numbers.filter((x) => x > 1e9), [], 'no epoch number (a number of seconds or milliseconds) in the file');
    assert.deepEqual(strings.filter((s) => /^\d{4}-\d{2}/.test(s) || /^\d{4}-\d{2}-\d{2}T/.test(s)), [], 'no string starts like an absolute date');
    const offsets = strings.filter((s) => /^(ms:)?[a-z]+[+-]\d+(T\d\d:\d\d)?Z?$/.test(s) && !s.startsWith('@'));
    assert.ok(offsets.length > (demo === 'travel' ? 150 : 25), `the file has many date offsets (${offsets.length})`);
    for (const o of offsets) assert.match(o, /^(ms:)?(today|start)[+-]\d+(T\d\d:\d\d)?Z?$/, `${o} is an offset from today or start`);
    assert.ok(strings.includes('ms:now'), 'a time of the run is written ms:now');
    assert.ok(file.anchor >= 1, 'the story\'s first day is after today');
  });

  // ---- (g) a folder of data files, every one a bundled template; no password in any ----
  await step('(g) every demo file names a bundled template and holds no password', async () => {
    const dir = path.join(ROOT, 'templates', 'demo');
    const files = fs.readdirSync(dir);
    assert.ok(files.includes('travel.json'));
    for (const f of files) {
      assert.ok(f.endsWith('.json') && fs.existsSync(path.join(ROOT, 'templates', f)), `${f} is named like a bundled template`);
      const raw = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.ok(!/"password"|"pass"|passwd/i.test(raw), `${f} holds no password`);
      assert.ok(readDemoFile(f.slice(0, -5)), `${f} is a valid demo file`);
    }
    const shipped = fs.readdirSync(path.join(ROOT, 'templates')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((id) => id !== 'default').sort();
    assert.deepEqual(files.map((f) => f.slice(0, -5)).sort(), shipped, 'every shipped template but Default has a demo');
    assert.deepEqual(listDemos().map((d) => [d.id, d.label]), [['games', 'Games demo'], ['learning', 'Learning demo'], ['mentoring', 'Mentoring demo'], ['project', 'Project demo'], ['travel', 'Travel demo']], 'each demo has its plain name');
    const names = listDemos().map((d) => d.name);
    assert.equal(new Set(names).size, names.length, 'each demo space has a name of its own');
    for (const n of names) assert.ok(n.startsWith('Demo: ') && n.length <= 40, `${n} is a demo name of 40 characters or fewer`);
    const logins = listDemos().flatMap((d) => readDemoFile(d.id).people.map((x) => `${x.login}|${x.displayName}`));
    assert.equal(new Set(logins.map((l) => l.split('|')[0])).size, logins.length, 'no two demos share a login (each may sit beside the others)');
    assert.equal(readDemoFile('default'), null, 'the Default template has no demo');
    assert.equal(readDemoFile('../server/index'), null, 'an id cannot reach another folder');
  });

  // A travel environment with every module on (each case that runs the loader more than once or twice gets its own, so
  // the per-minute write budget of a module (240 a person) is never what is being tested).
  const travelServer = async () => {
    const s = await boot();
    await s.api('PATCH', '/api/settings', { template: 'travel' });
    await s.api('PATCH', '/api/settings', { showCalendar: true, showMap: true });
    await modulesOn(s, ALL);
    return s;
  };

  // ---- (a), (c), (e): a travel environment with every module on ----
  const A = await travelServer();
  const kim = (await A.api('POST', '/api/users', { login: 'kim', displayName: 'Kim Other', role: 'member', password: 'kim-password-1' })).json.user;
  const other = (await A.api('POST', '/api/spaces', { name: 'Other trip', description: 'Mine.', members: [kim.key] })).json.space;
  assert.equal((await A.api('PUT', `/api/modules/todo/data/task:keep?scope=space&space=${other.id}`, { value: { id: 'keep', title: 'Keep me', notes: '', due: null, done: false, remind: false, doneAt: null, createdAt: 1, by: 'Kim', links: [] } })).status, 200);

  let first;
  await step('(a) the loader makes the seeder\'s counts', async () => {
    const before = await snapshot(A); // (c) the snapshot is taken before the first run
    A.before = before;
    first = await A.run();
    assert.equal(first.demo, true);
    assert.deepEqual(first.created, WANT, 'Planner 76, Places 37, Calendar 77, To-do 16, Polls 3, Budget 18, Research 4, Chat 25');
    assert.deepEqual(first.refused, [], 'nothing refused');
    assert.deepEqual(first.skipped, [], 'nothing skipped');
    assert.deepEqual(first.people.map((p) => p.login), ['mia', 'lee', 'sam']);
    assert.ok(first.people.every((p) => p.password && p.password.length >= 12 && p.password !== PASSWORD), 'a random password each');
    assert.equal(new Set(first.people.map((p) => p.password)).size, 3);
    assert.ok(first.guestUrl && /\/guest\//.test(first.guestUrl));
    assert.equal(first.start, dayPlus(TODAY, 45));
    assert.ok(first.space.members.length >= 4);
    const space = (await A.api('GET', `/api/spaces/${first.space.id}`)).json.space;
    assert.ok(space.description.startsWith(MARKER), 'the space carries the marker');
    assert.equal(space.phases.trip.start, first.start);
    assert.deepEqual(space.budget, { amount: 6500, currency: 'EUR' });
    const polls = (await A.api('GET', `/api/modules/polls/data?scope=space&space=${first.space.id}&prefix=vote:`)).json.items;
    assert.equal(polls.length, 8, 'the votes were cast, each by its own voter');
    const chat = (await A.api('GET', `/api/spaces/${first.space.id}/chat`)).json.messages;
    assert.ok(chat.some((m) => m.text.includes(`${A.base}/modules/travel?space=${first.space.id}`)), 'the chat link holds this server and this space');
  });
  await step('(a) each module\'s last writer is a demo person, never the admin who ran the loader', async () => {
    const login = Object.fromEntries(first.people.map((p) => [p.key, p.login]));
    const tally = {};
    for (const id of ['travel', 'maps', 'calendar', 'todo', 'polls', 'budget', 'research', 'documents']) {
      const items = (await A.api('GET', `/api/modules/${id}/data?scope=space&space=${first.space.id}&prefix=`)).json.items;
      const by = {};
      for (const it of items) { const who = login[it.by] || `other:${it.by}`; by[who] = (by[who] || 0) + 1; }
      tally[id] = by;
    }
    assert.deepEqual(tally, WRITERS, 'the last writer of every object, per module');
  });
  await step('(c) it changed no environment-wide setting', async () => {
    assert.equal(await snapshot(A), A.before, 'settings, modules, place search and template are identical after the run');
  });

  await step('(f) the demo stays ahead of today, and moves with it', async () => {
    const F = await travelServer();
    const first = await F.run();
    const read = async (id, mod, prefix) => (await F.api('GET', `/api/modules/${mod}/data?scope=space&space=${id}&prefix=${prefix}`)).json.items.map((i) => i.value);
    const id1 = first.space.id;
    const trip = (await F.api('GET', `/api/modules/travel/data/trip:main?scope=space&space=${id1}`)).json.item.value;
    assert.ok(trip.start > TODAY && trip.end > trip.start);
    const dated = async (id) => {
      const plan = await read(id, 'travel', 'plan:'); const tasks = await read(id, 'todo', 'task:'); const events = (await read(id, 'calendar', 'event:')).map((e) => String(e.start).slice(0, 10));
      return { plan: plan.map((p) => p.date).filter(Boolean), tasks: tasks.map((t) => t.due), events, budget: (await read(id, 'budget', 'cost:')).map((c) => c.date).filter(Boolean) };
    };
    const d1 = await dated(id1);
    for (const [what, list] of Object.entries(d1)) assert.ok(list.length > 0 && list.every((d) => d >= TODAY), `every ${what} date is on or after today`);
    // A later day moves every date by the same number of days.
    const LATER = '2035-07-04';
    const second = await F.run({ today: LATER });
    const d2 = await dated(second.space.id);
    const shift = (Date.parse(`${LATER}T00:00:00Z`) - Date.parse(`${TODAY}T00:00:00Z`)) / 86400000;
    for (const k of Object.keys(d1)) assert.deepEqual(d2[k].slice().sort(), d1[k].map((d) => dayPlus(d, shift)).sort(), `every ${k} date moved by ${shift} days`);
    assert.ok(second.start > LATER);
  });

  await step('(e) a rerun resets only the demo space and the demo people', async () => {
    const oldPass = first.people.find((p) => p.login === 'mia').password;
    const again = await A.run();
    assert.notEqual(again.space.id, first.space.id, 'a new space');
    assert.deepEqual(again.created, WANT, 'the same counts');
    assert.notEqual(again.people.find((p) => p.login === 'mia').password, oldPass, 'a new password');
    const old = await fetch(`${A.base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'mia', password: oldPass }) });
    assert.equal(old.status === 200, false, 'the old password no longer signs in');
    const spaces = (await A.api('GET', '/api/spaces')).json.spaces;
    assert.equal(spaces.filter((s) => s.name === 'Demo: Portugal').length, 1, 'exactly one demo space');
    assert.ok(spaces.some((s) => s.id === other.id), 'the other space is still there');
    assert.equal((await A.api('GET', `/api/modules/todo/data/task:keep?scope=space&space=${other.id}`)).json.item.value.title, 'Keep me', 'and its data');
    const users = (await A.api('GET', '/api/users')).json.users;
    assert.ok(users.some((u) => u.login === 'kim' && u.displayName === 'Kim Other'), 'the other account is untouched');
    for (const l of ['mia', 'lee', 'sam']) assert.equal(users.filter((u) => u.login === l).length, 1, `one ${l}`);
  });

  const B = await travelServer();
  await step('(c) the same, run again with the owner\'s own cookie', async () => {
    const login = await fetch(`${B.base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'admin', password: PASSWORD }) });
    const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const before = await snapshot(B);
    const r = await B.run({ session: { cookie } });
    assert.deepEqual(r.created, WANT);
    assert.equal(await snapshot(B), before);
  });

  // ---- (b) a module that is off is skipped, said so, and not turned on ----
  await step('(b) Budget off: skipped, reported, not turned on', async () => {
    assert.equal((await B.api('PATCH', '/api/modules/budget', { enabled: false })).status, 200);
    const before = await snapshot(B);
    const r = await B.run();
    assert.equal(r.skipped.length, 1, JSON.stringify(r.skipped));
    assert.equal(r.skipped[0].module, 'budget');
    assert.match(r.skipped[0].why, /^Budget is off in this environment, so the 18 demo costs were not made\.$/);
    assert.equal(r.created.budget, undefined, 'no costs were made');
    const { budget: _off, ...rest } = WANT;
    assert.deepEqual(r.created, rest, 'everything else was made');
    assert.deepEqual(r.refused, []);
    assert.equal(await snapshot(B), before, 'and Budget is still off');
    const mods = (await B.api('GET', '/api/modules')).json.modules;
    assert.equal(mods.find((m) => m.id === 'budget').enabled, false);
    await B.api('PATCH', '/api/modules/budget', { enabled: true });
  });

  // ---- a file with an unknown base or a phase the template lacks ----
  const E = await travelServer();
  await step('(f) an unknown date base is refused before anything is made; a missing phase is reported', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-files-'));
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'demo', 'travel.json'), 'utf8'));
      const bad = structuredClone(raw); bad.modules.todo.steps[0].data['task:dm01'].due = 'tomorrow+1';
      fs.writeFileSync(path.join(dir, 'travel.json'), JSON.stringify(bad));
      const spacesBefore = (await E.api('GET', '/api/spaces')).json.spaces.map((s) => s.id).join();
      await rejects(E.run({ dir }), /a date the loader does not know \("tomorrow\+1" at modules\.todo\.steps\[0\]\.task:dm01\.due\)/, 'the unknown base');
      assert.equal((await E.api('GET', '/api/spaces')).json.spaces.map((s) => s.id).join(), spacesBefore, 'nothing was made or removed');
      const evil = structuredClone(raw); evil.modules['../settings'] = evil.modules.todo;
      fs.writeFileSync(path.join(dir, 'travel.json'), JSON.stringify(evil));
      await rejects(E.run({ dir }), /modules\.\.\.\/settings is not a module id/, 'a module id outside [a-z0-9-]');
      assert.equal((await E.api('GET', '/api/spaces')).json.spaces.map((s) => s.id).join(), spacesBefore, 'nothing was made or removed for a bad module id');
      const odd = structuredClone(raw); odd.phases.voyage = { start: 'today+1' }; odd.modules.todo.steps[0].data['task:dm01'].phase = 'voyage';
      fs.writeFileSync(path.join(dir, 'travel.json'), JSON.stringify(odd));
      const r = await E.run({ dir });
      assert.ok(r.skipped.some((s) => s.module === 'phases' && /no phase "voyage"/.test(s.why)));
      assert.ok(r.refused.some((x) => x.module === 'todo' && x.key === 'task:dm01' && /no phase "voyage"/.test(x.why)));
      assert.equal(r.created.todo, 15, 'the object that needs the missing phase is left out');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await step('(h) the sentences use the words function: a skip and a refusal read the environment\'s own words', async () => {
    // The environment word is locked (plan-templates-redesign.md, decision 5), so a words function of its own stands in
    // for one that reads otherwise: what is checked is that the sentences go through the function they are given.
    const set = WORDS.resolve({ space: { one: 'quest', many: 'quests' } }, null);
    const words = (key, opts) => (key === 'environment' ? WORDS.format({ ...set, environment: { one: 'campaign', many: 'campaigns', a: 'a campaign' } }, key, opts) : WORDS.format(set, key, opts));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-files-'));
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'demo', 'travel.json'), 'utf8'));
      raw.modules = { budget: raw.modules.budget }; raw.phases = { voyage: { start: 'today+1' } };
      fs.writeFileSync(path.join(dir, 'travel.json'), JSON.stringify(raw));
      assert.equal((await E.api('PATCH', '/api/modules/budget', { enabled: false })).status, 200);
      const r = await E.run({ dir, words });
      assert.match(r.skipped.find((x) => x.module === 'budget').why, /^Budget is off in this campaign, so the 18 demo costs were not made\.$/);
      assert.match(r.skipped.find((x) => x.module === 'phases').why, /^This campaign's template has no phase "voyage"/);
      const plain = await E.run({ dir });
      assert.match(plain.skipped.find((x) => x.module === 'budget').why, /^Budget is off in this environment,/, 'the default words without the option');
      await E.api('PATCH', '/api/modules/budget', { enabled: true });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // ---- (j) the other demos, each in a travel environment with every bundled module on ----
  const J = await travelServer();
  const bundled = (await J.api('GET', '/api/modules')).json.bundled.map((b) => b.id);
  await modulesOn(J, bundled);
  const look = async (srv, id) => (await srv.api('GET', `/api/spaces/${id}/look`)).json.look;
  for (const [demo, o] of Object.entries(OTHERS)) {
    await step(`(j) the ${demo} demo loads once, reads its own template and answers its phases`, async () => {
      const before = await snapshot(J);
      const r = await J.run({ templateId: demo });
      assert.equal(r.demo, true);
      assert.deepEqual(r.skipped, [], 'nothing skipped');
      assert.deepEqual(r.refused, [], 'nothing refused');
      assert.deepEqual(r.created, o.want, `the ${demo} counts`);
      const file = readDemoFile(demo);
      assert.deepEqual(r.people.map((p) => p.login), file.people.map((p) => p.login));
      const again = await J.run({ templateId: demo });
      assert.deepEqual(again.created, o.want, 'a second load gives the same counts');
      assert.notEqual(again.space.id, r.space.id, 'and a new space');
      const spaces = (await J.api('GET', '/api/spaces')).json.spaces;
      assert.equal(spaces.filter((x) => x.name === file.name).length, 1, 'a second load adds nothing: one demo space');
      const users = (await J.api('GET', '/api/users')).json.users;
      for (const p of file.people) assert.equal(users.filter((u) => u.login === p.login).length, 1, `one ${p.login}`);
      assert.equal(await snapshot(J), before, 'no environment-wide setting changed');
      const id = again.space.id;
      const space = (await J.api('GET', `/api/spaces/${id}`)).json.space;
      assert.equal(space.template, demo, 'the space reads the demo\'s own template');
      assert.ok(space.description.startsWith(MARKER), 'and carries the marker');
      const l = await look(J, id);
      assert.equal(l.words.space.one, o.space, `a ${demo} space reads as a ${o.space}`);
      const mods = (await J.api('GET', `/api/modules/for-space?space=${id}`)).json.modules;
      const nameOf = (m) => mods.find((x) => x.id === m)?.displayName || mods.find((x) => x.id === m)?.name;
      assert.equal(nameOf(o.planner[0]), o.planner[1], `the planner shows as ${o.planner[1]}`);
      for (const [m, n] of Object.entries(o.names)) assert.equal(nameOf(m), n, `${m} shows as ${n}`);
      assert.ok(!mods.some((m) => m.id === 'travel'), 'the Itinerary is not on in it');
      const ph = (await J.api('GET', `/api/spaces/${id}/phases`)).json;
      assert.equal(ph.measure, o.measure, `phases measured by ${o.measure}`);
      assert.deepEqual(ph.phases.map((x) => x.id), o.phases.map((x) => x[0]), 'the template\'s phases');
      for (const [pid, done, d, t, current] of o.phases) {
        const got = ph.phases.find((x) => x.id === pid);
        if (o.measure !== 'goals') { assert.equal(got.done, undefined); continue; }
        assert.equal(got.done, done, `${pid} done is ${done}`);
        assert.deepEqual(got.goals, { done: d, total: t }, `${pid} counts ${d} of ${t} goals`);
        assert.equal(Boolean(got.current), Boolean(current), `${pid} is ${current ? '' : 'not '}the current phase`);
      }
      if (o.measure === 'dates' && o.phases.length) assert.ok(space.phases.build && space.phases.build.start, 'the phases have their dates');
      const chat = (await J.api('GET', `/api/spaces/${id}/chat`)).json.messages;
      assert.ok(chat.some((m) => m.text.includes(`${J.base}/modules/${o.planner[0]}?space=${id}`)), 'a chat link to the planner, with this server and space');
    });
  }
  await step('(j) a demo whose planner is not installed: skipped in a sentence, nothing turned on', async () => {
    const K = await travelServer(); // the travel modules only: no Planner - Projects
    const before = await snapshot(K);
    const r = await K.run({ templateId: 'games' });
    const sk = r.skipped.find((x) => x.module === 'schedule');
    assert.ok(sk, JSON.stringify(r.skipped));
    assert.match(sk.why, /^Planner - Projects is off in this environment, so the 26 demo campaign entries were not made\.$/);
    assert.equal(r.created.schedule, undefined);
    assert.ok(r.created.todo === 9 && r.created.chat === 17, 'the rest is made');
    assert.equal(await snapshot(K), before, 'and nothing was installed or turned on');
    // A space's own template turned off: the space reads the environment's, and the report says so.
    assert.equal((await K.api('PATCH', '/api/settings', { spaceTemplates: false })).status, 200);
    const off = await K.run({ templateId: 'mentoring' });
    assert.ok(off.skipped.some((x) => x.module === 'template' && /does not let a trip use its own template, so the demo trip reads the environment's own and not the mentoring template\./.test(x.why)), JSON.stringify(off.skipped));
    assert.equal((await K.api('GET', `/api/spaces/${off.space.id}`)).json.space.template, null, 'no template of its own');
  });

  // ---- (k) a real account is never taken over; the address people use ----
  await step('(k) a real person with a demo login and name is refused; a marked demo person who became an owner too', async () => {
    const K = await travelServer();
    await modulesOn(K, (await K.api('GET', '/api/modules')).json.bundled.map((b) => b.id));
    const noa = (await K.api('POST', '/api/users', { login: 'noa', displayName: 'Noa Brandt', role: 'owner', password: 'noa-password-12' })).json.user;
    const state = async () => JSON.stringify([(await K.api('GET', '/api/spaces')).json.spaces.map((x) => x.id), (await K.api('GET', '/api/users')).json.users.map((u) => [u.login, u.role])]);
    const before = await state();
    await rejects(K.run({ templateId: 'project' }), /^An account called "noa" already exists and was not made by a demo, so it is left alone\. Rename or remove it first\.$/, 'a real owner named like a demo person');
    assert.equal(await state(), before, 'nothing was made or changed');
    const signIn = async (login, password) => (await fetch(`${K.base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password }) })).status;
    assert.equal(await signIn('noa', 'noa-password-12'), 200, 'her password still works');
    assert.equal((await K.api('GET', '/api/users')).json.users.find((u) => u.key === noa.key).role, 'owner', 'and she is still an owner');
    assert.equal((await K.api('POST', '/api/users', { login: 'ren', displayName: 'Ren Calloway', role: 'member', password: 'ren-password-12' })).status, 201);
    await rejects(K.run({ templateId: 'games' }), /^An account called "ren" already exists and was not made by a demo/, 'a real member named like a demo person');
    assert.equal(await signIn('ren', 'ren-password-12'), 200, 'his password still works');
    // A demo load marks the people it makes, the mark is kept, and a second load resets only them.
    const first = await K.run({ templateId: 'learning' });
    const users = (await K.api('GET', '/api/users')).json.users;
    for (const p of first.people) assert.equal(users.find((u) => u.login === p.login).demo, true, `${p.login} is marked as a demo person`);
    assert.ok(!users.find((u) => u.login === 'noa').demo && !users.find((u) => u.login === 'admin').demo, 'nobody else is');
    const records = fs.readdirSync(K.dataDir, { recursive: true }).filter((f) => f.endsWith('.json')).flatMap((f) => { try { const j = JSON.parse(fs.readFileSync(path.join(K.dataDir, f), 'utf8')); return Array.isArray(j.users) ? j.users : []; } catch { return []; } });
    assert.equal(records.find((u) => u.login === 'marta')?.demo, true, 'the mark is in the stored record');
    assert.equal(records.find((u) => u.login === 'noa')?.demo, undefined, 'and not on the real account');
    const again = await K.run({ templateId: 'learning' });
    assert.notEqual(again.people[0].password, first.people[0].password, 'a marked demo person is given a new password');
    assert.equal(await signIn('marta', first.people[0].password) === 200, false, 'the old one stops working');
    // A marked demo person later made an owner is no longer the demo's to reset.
    const marta = (await K.api('GET', '/api/users')).json.users.find((u) => u.login === 'marta');
    assert.equal((await K.api('PATCH', `/api/users/${marta.key}`, { role: 'owner' })).status, 200);
    await rejects(K.run({ templateId: 'learning' }), /^An account called "marta" is an owner here, not a demo member, so it is left alone\. Rename or remove it first\.$/, 'a demo person made an owner');
    assert.equal(await signIn('marta', again.people[0].password), 200, 'her password was not changed');
    // The mark is never changed afterwards: PATCH with `demo` answers 400 and leaves it.
    for (const v of [false, true]) {
      const r = await K.api('PATCH', `/api/users/${marta.key}`, { demo: v });
      assert.equal(r.status, 400, `PATCH demo ${v}`);
      assert.equal(r.json.error, "demo can't be changed here");
    }
    assert.equal((await K.api('GET', '/api/users')).json.users.find((u) => u.key === marta.key).demo, true, 'the mark is unchanged');
    // `demo` on POST /api/users is true or false only.
    assert.equal((await K.api('POST', '/api/users', { login: 'odd', displayName: 'Odd', password: 'odd-password-12', demo: 'yes' })).status, 400);
  });
  await step('(k) a demo person with two-step sign-in on is refused before any password changes', async () => {
    const auth = require(path.join(ROOT, 'server', 'auth.js'));
    const M = await travelServer();
    const first = await M.run();
    const pw = Object.fromEntries(first.people.map((p) => [p.login, p.password]));
    const signIn = async (login, password) => {
      const r = await fetch(`${M.base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password }) });
      return { status: r.status, cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') };
    };
    const lee = await signIn('lee', pw.lee);
    assert.equal(lee.status, 200);
    const started = await fetch(`${M.base}/api/me/mfa/start`, { method: 'POST', headers: { cookie: lee.cookie, 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json());
    const on = await fetch(`${M.base}/api/me/mfa/enable`, { method: 'POST', headers: { cookie: lee.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ code: auth.totpCode(started.secret) }) });
    assert.equal(on.status, 200, 'lee turned two-step sign-in on');
    await M.api('DELETE', `/api/spaces/${first.space.id}`);
    const state = async () => JSON.stringify([(await M.api('GET', '/api/spaces')).json.spaces.map((x) => x.id), (await M.api('GET', '/api/users')).json.users.map((u) => [u.login, u.role])]);
    const before = await state();
    await rejects(M.run(), /^The demo person "lee" has two-step sign-in on, so the demo can't sign in as them\. Turn it off or remove the account first\.$/, 'two-step sign-in on');
    assert.equal(await state(), before, 'nothing was made or changed');
    for (const l of ['mia', 'sam']) assert.equal((await signIn(l, pw[l])).status, 200, `${l}'s old password still works`);
  });
  await step('(k) a file naming a writer who is not one of its people is refused before anything is made', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-files-'));
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'demo', 'travel.json'), 'utf8'));
      raw.modules.chat.messages[3].as = 'nobody';
      fs.writeFileSync(path.join(dir, 'travel.json'), JSON.stringify(raw));
      const before = JSON.stringify((await E.api('GET', '/api/users')).json.users.map((u) => u.login));
      await rejects(E.run({ dir }), /^The demo file names "nobody" as a writer, who is not one of its people\.$/, 'an unknown writer');
      assert.equal(JSON.stringify((await E.api('GET', '/api/users')).json.users.map((u) => u.login)), before, 'no person was made');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  await step('(k) publicBase: the chat links and the guest link use the address people use, never the loopback', async () => {
    const P = await travelServer();
    await modulesOn(P, (await P.api('GET', '/api/modules')).json.bundled.map((b) => b.id));
    const r = await P.run({ templateId: 'mentoring', publicBase: 'https://team.example.test/' });
    const chat = (await P.api('GET', `/api/spaces/${r.space.id}/chat`)).json.messages;
    assert.ok(chat.some((m) => m.text.includes(`https://team.example.test/modules/goals?space=${r.space.id}`)), 'the link uses the public address');
    assert.ok(!chat.some((m) => /127\.0\.0\.1|localhost/.test(m.text)), 'no loopback address in the chat');
    const g = await P.run({ templateId: 'games', publicBase: 'https://team.example.test' });
    assert.ok(g.guestUrl.startsWith('https://team.example.test/guest/'), `the guest link uses it too (${g.guestUrl.replace(/\/guest\/.*/, '/guest/...')})`);
  });

  // ---- (d) names without the marker ----
  const D = await boot();
  await D.api('PATCH', '/api/settings', { template: 'travel' });
  await modulesOn(D, ALL);
  await step('(d) a space with the demo\'s name and no marker is refused', async () => {
    const mine = (await D.api('POST', '/api/spaces', { name: 'Demo: Portugal', description: 'My own trip.', members: [] })).json.space;
    const usersBefore = JSON.stringify((await D.api('GET', '/api/users')).json.users.map((u) => u.login));
    const spacesBefore = (await D.api('GET', '/api/spaces')).json.spaces.map((s) => s.id);
    await rejects(D.run(), /A trip called "Demo: Portugal" exists but is not the demo \(its description lacks the marker\), so it is left alone\./, 'no marker (the travel environment\'s own word for a space)');
    const spaces = (await D.api('GET', '/api/spaces')).json.spaces;
    assert.deepEqual(spaces.map((s) => s.id), spacesBefore, 'nothing was made or removed');
    assert.ok(spaces.some((s) => s.id === mine.id), 'the space is still there');
    assert.equal(JSON.stringify((await D.api('GET', '/api/users')).json.users.map((u) => u.login)), usersBefore, 'and no person was made or changed');
    await rejects(D.run({ words: (key, opts) => WORDS.format(WORDS.resolve({ space: { one: 'journey', many: 'journeys' } }, null), key, opts) }), /^A journey called "Demo: Portugal" exists but is not the demo/, 'the refusal uses the words function');
    await D.api('DELETE', `/api/spaces/${mine.id}`);
  });
  await step('(d) a person with a demo login and another name is refused', async () => {
    const lee = (await D.api('POST', '/api/users', { login: 'lee', displayName: 'Lee Somebody Else', role: 'member', password: 'lee-password-1' })).json.user;
    const spacesBefore = (await D.api('GET', '/api/spaces')).json.spaces.length;
    await rejects(D.run(), /An account called "lee" already exists and is not a demo person \(its name is not Lee Chen\), so it is left alone\. Rename or remove it first\./, 'another name');
    const users = (await D.api('GET', '/api/users')).json.users;
    assert.ok(users.some((u) => u.key === lee.key && u.displayName === 'Lee Somebody Else'), 'the account is as it was');
    assert.ok(!users.some((u) => u.login === 'mia' || u.login === 'sam'), 'no demo person was made before the refusal');
    assert.equal((await D.api('GET', '/api/spaces')).json.spaces.length, spacesBefore, 'no space was made');
    // Her own password still works: it was not changed.
    const r = await fetch(`${D.base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'lee', password: 'lee-password-1' }) });
    assert.equal(r.status, 200, 'its password was not changed');
  });

  // ---- (g) a template with no demo ----
  const G = await boot();
  await step('(g) a template with no demo creates nothing', async () => {
    const tpl = ((await G.api('GET', '/api/settings')).json.settings.template || {}).id;
    assert.equal(tpl, 'default', 'the Default environment is up');
    // The environment is still setting itself up from its template for a moment; wait until it stops changing.
    const state = async () => JSON.stringify([(await G.api('GET', '/api/spaces')).json.spaces.map((x) => x.id), (await G.api('GET', '/api/users')).json.users.map((u) => u.login), await snapshot(G)]);
    let before = await state();
    for (let i = 0; i < 20; i += 1) { await new Promise((r) => setTimeout(r, 300)); const now = await state(); if (now === before) break; before = now; }
    const r = await G.run({ templateId: tpl });
    assert.deepEqual(r, { demo: false, message: 'There is no demo for this template.', created: {}, skipped: [], refused: [], people: [] });
    assert.equal(await state(), before, 'nothing was made');
    for (const id of [null, undefined, '', 'nope', '../x']) assert.equal((await G.run({ templateId: id })).demo, false, `no demo for ${JSON.stringify(id)}`);
  });
} catch (e) { failed = e; } finally { await stopAll(); }
if (failed) { console.error(failed.stack || failed); console.error(servers.map((s) => s.log.slice(-300)).join('\n---\n')); process.exit(1); }
console.log(`check-demo-loader: ${n} groups OK`);
