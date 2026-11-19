'use strict';

// The demo loader (documentation/plans/plan-demo-space.md, slice 1). One generic loader fills ONE marked space, and its
// own marked demo people, from the demo data file of an environment's template: templates/demo/<template id>.json.
//
// It reaches the product the way a browser does: requests to the server's own address (`base`), each as a signed-in
// person, so every module's real rules, permissions and validation run. It calls no function of a route directly.
//
// It NEVER changes an environment-wide setting on its own: it installs or turns on no module by itself, sets no calendar or map
// option, no place search, no template. A module in the file that the environment does not already have on is skipped, and the
// report names it. The one exception is a module the caller NAMES (`turnOn`: the host ticked it in the console, plan decision 1:
// the offer is the console's, the host ticks); the loader asks the caller's own `turnOnModules` to turn exactly those on (the
// console's own path, templates.turnOnModules), only after every refusal below has passed, and the report says which came on. It touches only the space whose description starts with MARKER and the people whose login AND display
// name are the file's; a space or an account that merely has the same name is refused and left alone.
// The demo's space reads the demo's own template (the space's `template`, its own record) when the environment's is another,
// so any demo may be added to an environment of any template; a module that template offers but the environment does not
// have on is skipped like any other. One demo per file, by its space's name: several demos may sit side by side.
//
// THE DATA FILE (read by readDemoFile). One JSON object; a key that starts with "_" (`_about`) is a note and is ignored.
//   template, label (the plain name a list shows: "Travel demo"), name, description, anchor (days after today that the story's
//   first day, "start", falls on), tz,
//   guestLink (make the guest link), budget ({ amount, currency }), phases ({ "<phase id>": { start, end } }),
//   people ([{ login, displayName, role, moderator }]), modules ({ "<module id>": block }).
// A module block is { as?, tz?, what?, count?: [key prefixes], steps: [{ as?, data: { "<key>": <value> } }] } (or
// { as?, data } for one step); the values are in that module's own format, and each step is written in order by the
// person it names (`as`, else the block's, else the first moderator). The built-in "chat" block is { messages: [{ as,
// text }] }. `count` names the key prefixes the report counts (default: every key written); `what` is the plural noun
// in the "skipped" sentence ("costs").
//
// DATES ARE OFFSETS, never absolute, so the same file is right on any day. A string that is exactly:
//   today+N / today-N     N days from the day the loader is run            -> "YYYY-MM-DD"
//   start+N / start-N     N days from the story's first day (today + anchor) -> "YYYY-MM-DD"
//   ...T09:30             a time of day after it                            -> "YYYY-MM-DDT09:30"
//   ...T09:30Z            and a trailing Z gives a full timestamp           -> "YYYY-MM-DDT09:30:00.000Z"
//   ms:today+2T10:00      "ms:" in front gives milliseconds since 1970 (a number); "ms:now" is the time of the run.
// A base the loader does not know ("tomorrow+1") refuses the whole file, naming where it is, before anything is made.
// Other markers, anywhere in a string: "@login" (the whole string, or one part of a key) is that person's key; "{space}"
// and "{base}" are the space's id and the server address. Phases are named by their id in the template, never by position.
//
// THE API: loadDemo({ base, publicBase?, templateId, today, session, headers?, say?, fetchImpl? }) -> report (below). `publicBase`
// is the address people use, for {base} in the file and the guest link (default: `base`). `session` is an
// owner's or admin's { cookie } (the request's own, when called from inside the server) or { login, password }.
// `headers` are added to every request (a hosted environment's Host header). The passwords of the demo people are random
// on every run and are only returned (report.people), never stored or printed here.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { word: defaultWord, format } = require('./words');

const DEMO_DIR = path.join(__dirname, '..', 'templates', 'demo');
// The first line of the demo space's description: how the loader knows a space is its own.
const MARKER = 'A demo with made-up people.';
const TEMPLATE_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
const MODULE_ID_RE = /^[a-z0-9-]+$/;
const TOP_KEYS = ['template', 'label', 'name', 'description', 'anchor', 'tz', 'guestLink', 'budget', 'phases', 'people', 'modules', 'files'];

class DemoError extends Error {}
// The first `n` characters of a text, never cutting a character in two (an emoji is one).
const clip = (t, n) => Array.from(String(t)).slice(0, n).join('');

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const dayPlus = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const { makeAsset, thumbOf } = require('./demo-assets');
const password = () => crypto.randomBytes(12).toString('base64url');

// --- the file --------------------------------------------------------------------------------------------------------
function problemsOf(raw, templateId, word = defaultWord) {
  const out = [];
  if (!isObject(raw)) return ['the file must be a JSON map'];
  for (const k of Object.keys(raw)) if (!k.startsWith('_') && !TOP_KEYS.includes(k)) out.push(`"${k}" is not a field of a demo file`);
  if (raw.template !== templateId) out.push(`"template" must be "${templateId}"`);
  if (typeof raw.name !== 'string' || !raw.name.trim()) out.push('"name" must be text');
  if (raw.label !== undefined && (typeof raw.label !== 'string' || !raw.label.trim() || raw.label.length > 40)) out.push('"label" must be text of 40 characters or fewer');
  if (typeof raw.description !== 'string') out.push('"description" must be text');
  if (!Number.isInteger(raw.anchor) || raw.anchor < 0) out.push('"anchor" must be a whole number of days, 0 or more');
  if (!Array.isArray(raw.people) || !raw.people.length) out.push('"people" must be a list of people');
  else {
    raw.people.forEach((p, i) => { if (!isObject(p) || typeof p.login !== 'string' || typeof p.displayName !== 'string') out.push(`people[${i}] needs a login and a displayName`); });
    if (new Set(raw.people.map((p) => p && p.login)).size !== raw.people.length) out.push('"people" has the same login twice');
  }
  if (raw.files !== undefined) {
    if (!Array.isArray(raw.files)) out.push('"files" must be a list');
    else raw.files.forEach((f, i) => { if (!isObject(f) || typeof f.name !== 'string' || typeof f.as !== 'string' || typeof f.art !== 'string') out.push(`files[${i}] needs a name, an art and an "as"`); });
  }
  if (Array.isArray(raw.people)) raw.people.forEach((p, i) => { if (isObject(p) && p.images !== undefined && !isObject(p.images)) out.push(`people[${i}].images must be a map from image slot to its art`); });
  if (!isObject(raw.modules)) out.push(`the ${word('module', { many: true })} part must be a map from ${word('module')} id to what it holds`);
  else {
    for (const [id, b] of Object.entries(raw.modules)) {
      if (!MODULE_ID_RE.test(id)) { out.push(`modules.${id} is not a ${word('module')} id (lower-case letters, digits and hyphens)`); continue; }
      if (!isObject(b)) { out.push(`modules.${id} must be a map`); continue; }
      if (id === 'chat') { if (!Array.isArray(b.messages)) out.push('modules.chat needs a list of messages'); continue; }
      const steps = b.steps || (b.data ? [b] : null);
      if (!Array.isArray(steps) || !steps.length || steps.some((s) => !isObject(s) || !isObject(s.data))) out.push(`modules.${id} needs steps, each with data`);
    }
  }
  return out;
}

// The demo file of a template, parsed and checked; null when the template has none (or its id cannot name a file).
function readDemoFile(templateId, { dir = DEMO_DIR, words = defaultWord } = {}) {
  if (typeof templateId !== 'string' || !TEMPLATE_ID_RE.test(templateId)) return null;
  const file = path.join(dir, `${templateId}.json`);
  if (!fs.existsSync(file)) return null;
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new DemoError(`The demo file for ${templateId} is not valid JSON (${e.message}).`); }
  const problems = problemsOf(raw, templateId, words);
  if (problems.length) throw new DemoError(`The demo file for ${templateId} is not valid: ${problems.join('; ')}.`);
  return raw;
}
const hasDemo = (templateId, opts) => Boolean(readDemoFile(templateId, opts));
// The modules a demo file needs, by id, in the file's order: every module block but the built-in chat.
// The modules a demo writes into: the ones holding objects, and the Vault when the demo has files.
const neededModules = (file) => [...Object.keys(file.modules).filter((id) => id !== 'chat'), ...(Array.isArray(file.files) && file.files.length ? ['vault'] : [])];
// Every demo there is, by its template's id: [{ id, label, name, modules: [ids it needs] }], in the order of their ids. A file that is not valid is
// left out (readDemoFile throws for it; the checks name it).
function listDemos({ dir = DEMO_DIR } = {}) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const f of names.filter((n) => n.endsWith('.json')).sort()) {
    const id = f.slice(0, -5);
    let file = null;
    try { file = readDemoFile(id, { dir }); } catch { file = null; }
    if (file) out.push({ id, label: file.label || `${id[0].toUpperCase()}${id.slice(1)} demo`, name: file.name, modules: neededModules(file) });
  }
  return out;
}

// --- offsets ---------------------------------------------------------------------------------------------------------
const OFFSET_RE = /^(ms:)?([a-z]+)([+-])(\d+)(?:T(\d\d):(\d\d))?(Z)?$/;
// `ctx`: { today, start, keys: { login: key }, space, base, now }. `where` names the place for a refusal.
function resolveString(s, ctx, where) {
  if (s === 'ms:now') return ctx.now;
  const m = OFFSET_RE.exec(s);
  if (m) {
    const [, ms, word, sign, digits, hh, mm, z] = m;
    const baseDay = word === 'today' ? ctx.today : word === 'start' ? ctx.start : null;
    if (!baseDay) throw new DemoError(`The demo file has a date the loader does not know ("${s}" at ${where}); a date is today+N or start+N.`);
    const day = dayPlus(baseDay, (sign === '-' ? -1 : 1) * Number(digits));
    const time = hh === undefined ? null : `${hh}:${mm}`;
    if (ms) return Date.parse(`${day}T${time || '00:00'}:00Z`);
    if (z) return `${day}T${time || '00:00'}:00.000Z`;
    return time ? `${day}T${time}` : day;
  }
  if (/^@[a-z0-9_.-]+$/i.test(s) && ctx.keys[s.slice(1)]) return ctx.keys[s.slice(1)];
  return s.split('{space}').join(ctx.space).split('{base}').join(ctx.base);
}
function resolveValue(v, ctx, where) {
  if (typeof v === 'string') return resolveString(v, ctx, where);
  if (Array.isArray(v)) return v.map((x, i) => resolveValue(x, ctx, `${where}[${i}]`));
  if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [resolveKey(k, ctx), resolveValue(x, ctx, `${where}.${k}`)]));
  return v;
}
// A key may hold "@login" as one of its ":" parts ("vote:q1:@mia").
const resolveKey = (key, ctx) => key.split(':').map((part) => (part.startsWith('@') && ctx.keys[part.slice(1)] ? ctx.keys[part.slice(1)] : part)).join(':');

// Every module block as a list of steps.
const stepsOf = (block) => block.steps || [block];

// --- the run ---------------------------------------------------------------------------------------------------------
// Answers the report:
//   { demo: true, space: { id, name, members }, start, created: { <module>: n }, skipped: [{ module, why }],
//     refused: [{ module, key, why }], people: [{ login, displayName, password }], guestUrl, turnedOn: [{ id, name }] (the
//     modules this run turned on: the ticked ones and what they need) }
// or, for a template with no demo file, { demo: false, message, created: {}, skipped: [], refused: [], people: [] } and
// nothing is made. Throws a DemoError (one plain sentence) when it cannot start or must not touch what it found.
async function loadDemo(args) {
  // What a run changed before it stopped, so a refusal after the modules came on can say so.
  const state = { turnedOn: [] };
  try { return await runDemo(args, state); } catch (err) {
    if (err instanceof DemoError && state.turnedOn.length) {
      err.turnedOn = state.turnedOn;
      err.message = `${err.message} Turned on before it stopped: ${state.turnedOn.map((m) => m.name).join(', ')}.`;
    }
    throw err;
  }
}
async function runDemo({ base, publicBase = '', templateId, today, session = {}, headers = {}, say = () => {}, fetchImpl = fetch, dir = DEMO_DIR, now = Date.now(), words = null, turnOn = [], turnOnModules = null, moderatesOf = null, beforeChanges = null }, state) {
  base = String(base || '').replace(/\/+$/, '');
  // The address people use (the environment's own), for the links the demo writes ({base}) and the guest link; `base` is
  // only where the loader's own requests go (the loopback, when the server calls itself). The same when none is given.
  const shown = String(publicBase || base).replace(/\/+$/, '');
  // The words every sentence below uses: the caller's (inside the server, its word()), else the environment's own as its
  // /api/branding answers them, else the product's defaults (before that answer is read).
  let word = words || defaultWord;
  const file = readDemoFile(templateId, { dir, words: (...a) => word(...a) });
  if (!file) return { demo: false, message: 'There is no demo for this template.', created: {}, skipped: [], refused: [], people: [] };
  if (!isDay(today)) throw new DemoError('The day must be given as YYYY-MM-DD.');
  const start = dayPlus(today, file.anchor);
  // The modules the caller asks to turn on: each must be one this demo names (never the built-in chat, never another), once.
  const needed = new Set(neededModules(file));
  if (!Array.isArray(turnOn) || turnOn.some((id) => typeof id !== 'string')) throw new DemoError(`Name the ${defaultWord('module', { many: true })} to turn on as a list of their ids.`);
  const ticked = [...new Set(turnOn)];
  for (const id of ticked) {
    if (id === 'chat') throw new DemoError('Chat is always on, so it is not turned on here.');
    if (!needed.has(id)) throw new DemoError(`This demo does not use "${clip(id, 40)}", so it was not turned on.`);
  }
  if (ticked.length && typeof turnOnModules !== 'function') throw new DemoError(`There is no way to turn ${defaultWord('module', { many: true })} on here.`);
  const logins = file.people.map((p) => p.login);
  // The whole file is read once, with stand-in keys, so a bad date stops the run before anything is made.
  const trial = { today, start, keys: Object.fromEntries(logins.map((l) => [l, l])), space: 'space', base: shown, now };
  for (const [id, b] of Object.entries(file.modules)) {
    if (id === 'chat') b.messages.forEach((m, i) => resolveValue(m, trial, `modules.chat.messages[${i}]`));
    else stepsOf(b).forEach((s, i) => resolveValue(s.data, trial, `modules.${id}.steps[${i}]`));
  }
  resolveValue(file.phases || {}, trial, 'phases');
  // Every writer the file names is one of its people: checked here, so a bad file stops before anything is made.
  for (const [id, b] of Object.entries(file.modules)) {
    const named = id === 'chat' ? b.messages.map((m) => m.as) : [b.as, ...stepsOf(b).map((x) => x.as)];
    for (const as of named) if (as !== undefined && !logins.includes(as)) throw new DemoError(`The demo file names "${as}" as a writer, who is not one of its people.`);
  }

  const jars = {};
  const call = async (as, method, url, body) => {
    const h = { accept: 'application/json', ...headers };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (jars[as]) h.cookie = jars[as];
    // A module may be asked for 240 writes a minute by one person (server/module-limits.js): when told to wait, wait as told
    // (a minute at most) and ask again, a few times, so two runs close together still finish.
    for (let attempt = 0; ; attempt += 1) {
      let r;
      try { r = await fetchImpl(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }); } catch { throw new DemoError(`No server answered at ${base}.`); }
      let json = null; try { json = await r.json(); } catch { /* none */ }
      if (r.status === 429 && attempt < 4) {
        const told = Number(r.headers.get('retry-after')) || Number(/Wait (\d+) second/.exec((json && json.error) || '')?.[1]) || 5;
        await new Promise((done) => setTimeout(done, Math.min(61, told + 1) * 1000));
        continue;
      }
      return { status: r.status, json, res: r };
    }
  };
  const ok = async (as, method, url, body) => {
    const r = await call(as, method, url, body);
    // The server's own sentence, in a plain frame; the request is named only when it gave none.
    if (r.status >= 300) throw new DemoError(r.json && r.json.error ? `The demo stopped: ${r.json.error}` : `${method} ${url} answered ${r.status}.`);
    return r.json;
  };
  const cookieOf = (res) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const signIn = async (as, login, pass) => {
    const r = await call(as, 'POST', '/api/login', { login, password: pass });
    if (r.status !== 200 || !r.json || !r.json.user) throw new DemoError(`Could not sign in as ${login} (${r.status}${r.json && r.json.error ? `: ${r.json.error}` : ''}).`);
    jars[as] = cookieOf(r.res);
    return r.json.user;
  };

  // --- the environment's words (the branding answers without a sign-in) ---
  if (!words) {
    const b = await call('caller', 'GET', '/api/branding');
    if (b.status === 200 && b.json && b.json.words) word = (key, opts) => format(b.json.words, key, opts);
  }

  // --- who is calling: an owner or admin ---
  if (session.cookie) jars.caller = session.cookie;
  else if (session.login && session.password) await signIn('caller', session.login, session.password);
  else throw new DemoError(`The loader needs the ${word('owner')}'s or ${word('admin')}'s session or sign-in.`);
  const me = await call('caller', 'GET', '/api/me');
  if (me.status !== 200 || !me.json || !me.json.user) throw new DemoError('The session is not signed in.');
  const callerKey = me.json.user.key;
  const branding = await ok('caller', 'GET', '/api/branding');
  // The demo's space reads the demo's own template (a space's own template, plan-space-templates.md) when the environment's
  // default is another one, so a games demo in a travel environment still reads as a campaign. That is the space's own
  // record, never an environment-wide setting. Off (settings.spaceTemplates), it reads the environment's, and the report says so.
  const envTemplate = (((await ok('caller', 'GET', '/api/settings')).settings || {}).template || {}).id || null;
  const ownTemplate = file.template !== envTemplate ? file.template : null;

  // --- what is already there, and what must be left alone: all checked before anything is changed ---
  const existing = (await ok('caller', 'GET', '/api/users')).users || [];
  // Only an account a demo load made (`demo: true`, set when it was made), with the file's name and role, is a demo person and
  // may be given a new password. A real person who happens to have the same login and name is never taken over.
  for (const p of file.people) {
    const found = existing.find((u) => u.login === p.login);
    if (!found) continue;
    if (found.displayName !== p.displayName) throw new DemoError(`An account called "${p.login}" already exists and is not a demo person (its name is not ${p.displayName}), so it is left alone. Rename or remove it first.`);
    if (found.demo !== true || found.hostAdmin) throw new DemoError(`An account called "${p.login}" already exists and was not made by a demo, so it is left alone. Rename or remove it first.`);
    if (found.role !== (p.role || 'member')) throw new DemoError(`An account called "${p.login}" is ${word(found.role, { a: true })} here, not a demo ${word(p.role || 'member')}, so it is left alone. Rename or remove it first.`);
    // The loader signs in as each demo person with a password only: with two-step sign-in on, it could not, and would stop
    // after the passwords were changed. So it is refused here, before anything is.
    if (found.mfaEnrolled) throw new DemoError(`The demo person "${p.login}" has two-step sign-in on, so the demo can't sign in as them. Turn it off or remove the account first.`);
  }
  const old = [];
  const allSpaces = (await ok('caller', 'GET', '/api/spaces')).spaces || [];
  // Reads the moderator tick per space (GET /api/users: users[].spaces[<space id>].permissions.moderator, the stored tick of a
  // space the person belongs to) of each demo login that already exists. A space made by a demo load is one whose description
  // starts with MARKER; any other space is a real one. A demo person who moderates a real space would be given a new password
  // and a place in the demo, so it is refused here, before anything is changed.
  const descriptionOf = new Map();
  const isDemoSpace = async (id) => {
    if (!descriptionOf.has(id)) descriptionOf.set(id, String(((await ok('caller', 'GET', `/api/spaces/${encodeURIComponent(id)}`)).space || {}).description || ''));
    return descriptionOf.get(id).startsWith(MARKER);
  };
  for (const p of file.people) {
    const found = existing.find((u) => u.login === p.login);
    if (!found || !isObject(found.spaces)) continue;
    for (const sp of allSpaces) {
      const entry = Object.prototype.hasOwnProperty.call(found.spaces, sp.id) ? found.spaces[sp.id] : null;
      if (!entry || !isObject(entry.permissions) || entry.permissions.moderator !== true) continue;
      if (!(await isDemoSpace(sp.id))) throw new DemoError(`The demo person "${p.login}" is ${word('moderator', { a: true })} of "${String(sp.name).slice(0, 60)}", a real ${word('space')}, so the demo is not loaded. Take away their ${word('moderator')} tick there, or remove the account first.`);
    }
  }
  // The stored ticks, by the caller's own dependency (inside the server: the store's space prefs). GET /api/users above lists
  // only spaces a person belongs to NOW, but a tick stays when a person is taken out of a space and counts again if they join
  // it, so a demo person with a tick on any space that is not a demo space is refused, member or not.
  if (typeof moderatesOf === 'function') {
    for (const p of file.people) {
      for (const m of (await moderatesOf(p.login)) || []) {
        if (String(m.description || '').startsWith(MARKER)) continue;
        throw new DemoError(`The demo person "${p.login}" ${m.member ? 'is' : 'was'} ${word('moderator', { a: true })} of "${clip(m.name, 60)}", a real ${word('space')}, so the demo is not loaded. Take away their ${word('moderator')} tick there, or remove the account first.`);
      }
    }
  }
  for (const sp of allSpaces) {
    if (sp.name !== file.name) continue;
    const full = (await ok('caller', 'GET', `/api/spaces/${sp.id}`)).space;
    if (!String(full.description || '').startsWith(MARKER)) throw new DemoError(`A ${word('space')} called "${file.name}" exists but is not the demo (its description lacks the marker), so it is left alone.`);
    old.push(sp.id);
  }

  // The caller's last checks (a plan's member limit), still before anything is changed.
  if (typeof beforeChanges === 'function') await beforeChanges({ newLogins: file.people.filter((p) => !existing.some((u) => u.login === p.login)).map((p) => p.login) });

  // --- the modules the host ticked, turned on through the caller's own path; then which modules are on ---
  const skipped = []; const refused = []; const created = {};
  let listed = await ok('caller', 'GET', '/api/modules');
  const wasOn = new Set((listed.modules || []).filter((m) => m.enabled).map((m) => m.id));
  let turnedOn = [];
  const missedIds = new Set();
  if (ticked.length) {
    const missed = await turnOnModules(ticked);
    listed = await ok('caller', 'GET', '/api/modules');
    for (const miss of missed || []) {
      if (skipped.some((x) => x.module === miss.id)) continue;
      missedIds.add(miss.id);
      skipped.push({ module: miss.id, why: `${miss.name || (listed.modules || []).find((m) => m.id === miss.id)?.displayName || miss.id} could not be turned on (${miss.why}).` });
    }
    turnedOn = (listed.modules || []).filter((m) => m.enabled && !wasOn.has(m.id)).map((m) => ({ id: m.id, name: m.displayName || m.name || m.id }));
    state.turnedOn = turnedOn;
  }
  const installed = new Map((listed.modules || []).map((m) => [m.id, m]));
  const bundled = new Map((listed.bundled || []).map((m) => [m.id, m]));
  const nameOf = (id) => { const m = installed.get(id) || bundled.get(id); return (m && (m.displayName || m.name)) || id; };
  const countOf = (id, b) => {
    const prefixes = b.count || null;
    const keys = id === 'chat' ? b.messages : stepsOf(b).flatMap((s) => Object.keys(s.data));
    return prefixes ? keys.filter((k) => prefixes.some((pre) => String(k).startsWith(pre))).length : keys.length;
  };
  const off = new Set();
  for (const [id, b] of Object.entries(file.modules)) {
    if (id === 'chat') continue;
    const m = installed.get(id);
    if (!m || !m.enabled) {
      off.add(id);
      if (!missedIds.has(id)) skipped.push({ module: id, why: `${nameOf(id)} is off in this ${word('environment')}, so the ${countOf(id, b)} demo ${b.what || word('object', { many: true })} were not made.` });
    }
  }
  for (const [id, b] of Object.entries(file.modules)) {
    if (id === 'chat' || off.has(id)) continue;
    const needs = ((installed.get(id) || {}).requires || []).filter((r) => !(installed.get(r) || {}).enabled);
    if (needs.length) { off.add(id); if (!missedIds.has(id)) skipped.push({ module: id, why: `${nameOf(id)} needs ${needs.map(nameOf).join(' and ')}, which ${needs.length === 1 ? 'is' : 'are'} off in this ${word('environment')}, so the ${countOf(id, b)} demo ${b.what || word('object', { many: true })} were not made.` }); }
  }

  // --- the demo people ---
  const keys = {}; const pass = {}; const people = [];
  for (const p of file.people) {
    pass[p.login] = password();
    const found = existing.find((u) => u.login === p.login);
    if (found) { await ok('caller', 'PATCH', `/api/users/${found.key}`, { password: pass[p.login] }); keys[p.login] = found.key; }
    else keys[p.login] = (await ok('caller', 'POST', '/api/users', { login: p.login, displayName: p.displayName, role: p.role || 'member', password: pass[p.login], demo: true })).user.key;
    people.push({ login: p.login, displayName: p.displayName, key: keys[p.login], password: pass[p.login] });
  }
  for (const p of file.people) await signIn(p.login, p.login, pass[p.login]);
  const moderator = (file.people.find((p) => p.moderator) || file.people[0]).login;

  // --- reset only the demo space, then make it ---
  for (const id of old) { await ok('caller', 'DELETE', `/api/spaces/${id}`); say(`Removed the old demo ${word('space')}.`); }
  const members = [...new Set([...logins.map((l) => keys[l]), callerKey].filter(Boolean))];
  const description = `${MARKER} ${file.description}`.trim();
  let space = null;
  if (ownTemplate && branding.spaceTemplates !== false) {
    const r = await call('caller', 'POST', '/api/spaces', { name: file.name, description, members, starter: false, template: ownTemplate });
    if (r.status < 300 && r.json && r.json.space) space = r.json.space;
    else skipped.push({ module: 'template', why: `The demo ${word('space')} could not use the ${file.template} template (${(r.json && r.json.error) || `answered ${r.status}`}), so it reads this ${word('environment')}'s own.` });
  } else if (ownTemplate) {
    skipped.push({ module: 'template', why: `This ${word('environment')} does not let a ${word('space')} use its own template, so the demo ${word('space')} reads the ${word('environment')}'s own and not the ${file.template} template.` });
  }
  // starter: false: a demo load writes its own data, never the template's starter content.
  if (!space) space = (await ok('caller', 'POST', '/api/spaces', { name: file.name, description, members, starter: false })).space;
  for (const p of file.people.filter((x) => x.moderator)) await ok('caller', 'PATCH', `/api/users/${keys[p.login]}/spaces/${space.id}`, { permissions: { moderator: true } });
  const ctx = { today, start, keys, space: space.id, base: shown, now };

  // What this space reads: its phases (its template's) and the modules on in it (enabled here AND offered by its template).
  const look = (await ok('caller', 'GET', `/api/spaces/${space.id}/look`)).look || {};
  const phaseIds = new Set((Array.isArray(look.phases) ? look.phases : []).map((p) => p.id));
  const here = await call('caller', 'GET', `/api/modules/for-space?space=${encodeURIComponent(space.id)}`);
  const onHere = new Set(here.status === 200 && here.json && Array.isArray(here.json.modules) ? here.json.modules.map((m) => m.id) : []);
  if (here.status === 200 && here.json && Array.isArray(here.json.modules)) {
    for (const [id, b] of Object.entries(file.modules)) {
      if (id === 'chat' || off.has(id) || onHere.has(id)) continue;
      off.add(id);
      skipped.push({ module: id, why: `${nameOf(id)} is not part of the template this demo ${word('space')} reads, so the ${countOf(id, b)} demo ${b.what || word('object', { many: true })} were not made.` });
    }
  }

  const patch = {};
  if (file.phases) {
    const dates = {};
    for (const [id, range] of Object.entries(file.phases)) {
      if (phaseIds.has(id)) dates[id] = resolveValue(range, ctx, `phases.${id}`);
      else skipped.push({ module: 'phases', why: `This ${word('environment')}'s template has no phase "${id}", so its dates were not set.` });
    }
    if (Object.keys(dates).length) patch.phases = dates;
  }
  if (file.budget) patch.budget = file.budget;
  if (Object.keys(patch).length) await ok('caller', 'PATCH', `/api/spaces/${space.id}`, patch);

  // --- the pictures and files the demo draws for itself (server/demo-assets.js), each sent through the real route as its owner ---
  const send = async (as, method, url, asset) => {
    const r = await fetchImpl(base + url, { method, headers: { ...headers, cookie: jars[as], 'content-type': asset.type, accept: 'application/json' }, body: asset.bytes });
    let json = null; try { json = await r.json(); } catch { /* none */ }
    return { status: r.status, json };
  };
  for (const p of file.people) {
    for (const [slot, spec] of Object.entries(p.images || {})) {
      const r = await send(p.login, 'PUT', `/api/me/images/${encodeURIComponent(slot)}`, makeAsset(spec));
      if (r.status >= 300) refused.push({ module: 'profile', key: `${p.login}:${slot}`, why: (r.json && r.json.error) || `answered ${r.status}` });
    }
  }
  if (Array.isArray(file.files) && file.files.length) {
    if (!onHere.has('vault')) skipped.push({ module: 'vault', why: `The Vault is not part of the template this demo ${word('space')} reads, so its ${file.files.length} demo files were not made.` });
    else {
      created.vault = 0;
      for (const f of file.files) {
        if (!jars[f.as]) throw new DemoError(`The demo file names "${f.as}" as a writer, who is not one of its people.`);
        const r = await send(f.as, 'POST', `/api/modules/vault/library?space=${encodeURIComponent(space.id)}&name=${encodeURIComponent(f.name)}`, makeAsset(f));
        if (r.status >= 300 || !r.json || !r.json.file) { refused.push({ module: 'vault', key: f.name, why: (r.json && r.json.error) || `answered ${r.status}` }); continue; }
        created.vault += 1;
        if (f.thumb) await send(f.as, 'PUT', `/api/modules/vault/library/${r.json.file.id}/thumb?space=${encodeURIComponent(space.id)}`, { type: 'image/png', bytes: thumbOf(f.thumb).bytes });
      }
    }
  }

  // --- the objects, each written as the person who owns it, through the module's own route ---
  const written = {};
  for (const [id, block] of Object.entries(file.modules)) {
    if (id === 'chat' || off.has(id)) continue;
    written[id] = 0;
    for (const [n, step] of stepsOf(block).entries()) {
      const as = step.as || block.as || moderator;
      if (!jars[as]) throw new DemoError(`The demo file names "${as}" as a writer, who is not one of its people.`);
      for (const [rawKey, rawValue] of Object.entries(step.data)) {
        const key = resolveKey(rawKey, ctx);
        const value = resolveValue(rawValue, ctx, `modules.${id}.steps[${n}].${rawKey}`);
        if (isObject(value) && typeof value.phase === 'string' && !phaseIds.has(value.phase)) {
          refused.push({ module: id, key, why: `This ${word('environment')}'s template has no phase "${value.phase}", so the ${word('object')} was left out.` });
          continue;
        }
        const r = await call(as, 'PUT', `/api/modules/${encodeURIComponent(id)}/data/${encodeURIComponent(key)}?scope=space&space=${space.id}`, { value, tz: step.tz || block.tz || file.tz });
        if (r.status >= 300) refused.push({ module: id, key, why: (r.json && r.json.error) || `answered ${r.status}` });
        else written[id] += 1;
      }
    }
  }

  // --- the chat, each message from its own session ---
  const chat = file.modules.chat;
  if (chat) {
    created.chat = 0;
    for (const [n, m] of chat.messages.entries()) {
      const as = m.as || moderator;
      if (!jars[as]) throw new DemoError(`The demo file names "${as}" as a writer, who is not one of its people.`);
      const r = await call(as, 'POST', `/api/spaces/${space.id}/chat`, { text: resolveString(m.text, ctx, `modules.chat.messages[${n}]`) });
      if (r.status >= 300) refused.push({ module: 'chat', key: String(n + 1), why: (r.json && r.json.error) || `answered ${r.status}` });
      else created.chat += 1;
    }
  }

  // --- the guest link, then what each module now holds (the server adds some objects of its own: the Calendar's twins) ---
  let guestUrl = '';
  if (file.guestLink) {
    const g = await call('caller', 'POST', `/api/spaces/${space.id}/guest-link`, {});
    if (g.status < 300 && g.json) guestUrl = g.json.guestUrl || '';
    else refused.push({ module: 'guest-link', key: '', why: (g.json && g.json.error) || `answered ${g.status}` });
    // The server names the guest link from the address it was asked on: put the environment's own in front of it.
    if (guestUrl && shown !== base) { try { const u = new URL(guestUrl); guestUrl = `${shown}${u.pathname}${u.search}${u.hash}`; } catch { /* left as it is */ } }
  }
  for (const [id, block] of Object.entries(file.modules)) {
    if (id === 'chat' || off.has(id)) continue;
    const prefixes = block.count || [''];
    let total = 0;
    for (const pre of prefixes) total += (((await ok('caller', 'GET', `/api/modules/${encodeURIComponent(id)}/data?scope=space&space=${space.id}&prefix=${encodeURIComponent(pre)}`)).items) || []).length;
    created[id] = total;
  }
  return { demo: true, space, start, created, skipped, refused, people, guestUrl, turnedOn };
}

module.exports = { loadDemo, neededModules, readDemoFile, hasDemo, listDemos, problemsOf, resolveString, resolveValue, DemoError, MARKER, DEMO_DIR, dayPlus };
