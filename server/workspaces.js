// Personal workspaces (documentation/plans/plan-workspaces.md, decisions 39 and 49): each signed-in person's own
// workspaces in a space, and the arrangement of modules each one keeps. One file per environment,
// DATA_DIR/workspaces.json, personal state, so it is never in an owner's copy (server/environment-export.js):
//
//   { "spaces": { "<space id>": { "<user key>": [workspace] } } }
//
// A workspace, in the person's order:
//   { id: 'workspace', at, arrangement }                    the space's Workspace, as this person has arranged it. It has
//                                                           no name or shape of its own (the space's), and is kept only
//                                                           once the person has arranged it.
//   { id: 'w' + 6 characters, name, shape, at, arrangement } one the person added: a name, a shape ({ shape, areas }, as
//                                                           a layout for everyone, or null for a free canvas) and its own
//                                                           arrangement (null until arranged).
// `at` is when it was last written, by the server. Others never see a person's workspaces (decision 39).
//
// An arrangement is what a workspace remembers of its canvas, as the page keeps it (public/canvas.js):
//   { open: [module id], placed: bool, mode: 'panel' | 'window', snap: { all, pitch }, stacks: [stack],
//     modules: { <module id>: record } }
//   open     the modules open, in column order
//   placed   whether the person ever put a module of their own here (else the template's layout comes back)
//   mode     Panel Mode or Window Mode
//   snap     the canvas-level grid: all (every floating module snaps), pitch (50 to 320 px)
//   stacks   the stacks Window Mode put away: { ids: [2 or 3 ids], width, h: [share|null], folded: [bool], ownW: [px|null] }
//   modules  each module's own record, open or not: { mode, dockW, box, cell, placed, layout, stack, at, h, folded, ownW, win }
// Every key is optional. Known keys only, each of its type; anything else refuses the whole arrangement with one sentence.
// Workspaces.cleanArrangement is the one check, pure; the class keeps the lists, their limits and the clean-up when a
// space or a person is removed (server/store.js). mountWorkspaces adds the routes (one part with a contract, as
// mountVaultShares is: it takes the app and what it needs, and reads per-environment services through `deps`).

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { cleanShape } = require('./layout-shapes');

const WORKSPACE_LIMITS = Object.freeze({
  added: 10, // workspaces a person may add per space, besides the Workspace
  name: 40, // characters, after trimming
  open: 40, // ids in an arrangement's `open`
  modules: 60, // records in an arrangement's `modules`
  stacks: 20, // stacks Window Mode put away
  bytes: 16384, // an arrangement, as JSON
  pixels: 100000, // the largest pixel value a box, width or window size may hold
  cells: 1000, // the largest grid cell number
  pitchMin: 50,
  pitchMax: 320,
});
const WORKSPACE_ID = 'workspace'; // the space's own Workspace
const ADDED_ID = /^w[a-z0-9]{6}$/;
const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
// A module id as the canvas keeps it: a module's (as a template's) or a composite's (`dest:calendar`).
const MODULE_ID = /^(dest:)?[a-z][a-z0-9-]{0,31}$/;
const STACK_ID = /^[a-z0-9]{1,32}$/;
const TOP_KEYS = ['open', 'placed', 'mode', 'snap', 'stacks', 'modules'];
const RECORD_KEYS = ['mode', 'dockW', 'box', 'cell', 'placed', 'layout', 'stack', 'at', 'h', 'folded', 'ownW', 'win'];
const MODES = ['dock', 'float', 'window', 'column'];

class WorkspaceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const pixel = (v) => isNum(v) && Math.abs(v) <= WORKSPACE_LIMITS.pixels;
const share = (v) => isNum(v) && v >= 0 && v <= 1;
const cleanName = (v) => (typeof v === 'string' ? v.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim() : '');
const plain = (k) => [...String(k)].map((c) => (/[\x20-\x7e]/.test(c) ? c : '?')).join('').slice(0, 40);

// { x, y, w, h } of pixels (a box, a placed box) or { w, h } (a window's size): every key there, a number in bounds.
function pixels(v, keys) {
  return isObject(v) && Object.keys(v).length === keys.length && keys.every((k) => pixel(v[k]));
}
const cell = (v) => isObject(v) && Object.keys(v).length === 4 && ['col', 'row', 'cols', 'rows'].every((k) => Number.isInteger(v[k]) && v[k] >= 0 && v[k] <= WORKSPACE_LIMITS.cells);

// One module's record: the error sentence, or null.
function recordProblem(id, rec) {
  if (!isObject(rec)) return `The record for ${plain(id)} must be an object.`;
  const extra = Object.keys(rec).find((k) => !RECORD_KEYS.includes(k));
  if (extra) return `A module's record does not take "${plain(extra)}".`;
  const bad = (k) => `The record for ${plain(id)} has a bad "${k}".`;
  if ('mode' in rec && !MODES.includes(rec.mode)) return bad('mode');
  if ('dockW' in rec && !(pixel(rec.dockW) && rec.dockW >= 0)) return bad('dockW');
  if ('ownW' in rec && !(pixel(rec.ownW) && rec.ownW >= 0)) return bad('ownW');
  if ('box' in rec && !pixels(rec.box, ['x', 'y', 'w', 'h'])) return bad('box');
  if ('placed' in rec && !pixels(rec.placed, ['x', 'y', 'w', 'h'])) return bad('placed');
  if ('win' in rec && !pixels(rec.win, ['w', 'h'])) return bad('win');
  if ('cell' in rec && !cell(rec.cell)) return bad('cell');
  if ('layout' in rec && !['user', 'auto'].includes(rec.layout)) return bad('layout');
  if ('stack' in rec && !(typeof rec.stack === 'string' && STACK_ID.test(rec.stack))) return bad('stack');
  if ('at' in rec && !(Number.isInteger(rec.at) && rec.at >= 0 && rec.at <= 2)) return bad('at');
  if ('h' in rec && !share(rec.h)) return bad('h');
  if ('folded' in rec && typeof rec.folded !== 'boolean') return bad('folded');
  return null;
}

function stackProblem(st) {
  const msg = 'Each kept stack is { ids, width, h, folded, ownW } of two or three modules.';
  if (!isObject(st) || Object.keys(st).some((k) => !['ids', 'width', 'h', 'folded', 'ownW'].includes(k))) return msg;
  if (!Array.isArray(st.ids) || st.ids.length < 2 || st.ids.length > 3 || !st.ids.every((id) => typeof id === 'string' && MODULE_ID.test(id))) return msg;
  const n = st.ids.length;
  if ('width' in st && !(st.width === null || (pixel(st.width) && st.width >= 0))) return msg;
  if ('h' in st && !(Array.isArray(st.h) && st.h.length === n && st.h.every((v) => v === null || share(v)))) return msg;
  if ('folded' in st && !(Array.isArray(st.folded) && st.folded.length === n && st.folded.every((v) => typeof v === 'boolean'))) return msg;
  if ('ownW' in st && !(Array.isArray(st.ownW) && st.ownW.length === n && st.ownW.every((v) => v === null || (pixel(v) && v >= 0)))) return msg;
  return null;
}

// The one arrangement check, pure. Answers { arrangement } (a copy of what was sent, null for null) or { error }.
function cleanArrangement(input) {
  if (input === null) return { arrangement: null };
  if (!isObject(input)) return { error: 'Send the arrangement as an object.' };
  let size = 0;
  try { size = Buffer.byteLength(JSON.stringify(input)); } catch { return { error: 'Send the arrangement as JSON.' }; }
  if (size > WORKSPACE_LIMITS.bytes) return { error: `The arrangement is too large; it can be at most ${WORKSPACE_LIMITS.bytes / 1024} KB.` };
  const extra = Object.keys(input).find((k) => !TOP_KEYS.includes(k));
  if (extra) return { error: `An arrangement does not take "${plain(extra)}".` };
  if ('open' in input) {
    if (!Array.isArray(input.open) || !input.open.every((id) => typeof id === 'string' && MODULE_ID.test(id))) return { error: 'The open modules must be a list of module ids.' };
    if (input.open.length > WORKSPACE_LIMITS.open) return { error: `At most ${WORKSPACE_LIMITS.open} modules can be open in a workspace.` };
  }
  if ('placed' in input && typeof input.placed !== 'boolean') return { error: '"placed" must be true or false.' };
  if ('mode' in input && !['panel', 'window'].includes(input.mode)) return { error: 'The mode must be panel or window.' };
  if ('snap' in input) {
    const s = input.snap;
    if (!isObject(s) || Object.keys(s).some((k) => !['all', 'pitch'].includes(k))) return { error: 'The grid must be { all, pitch }.' };
    if ('all' in s && typeof s.all !== 'boolean') return { error: 'The grid must be { all, pitch }.' };
    if ('pitch' in s && !(isNum(s.pitch) && s.pitch >= WORKSPACE_LIMITS.pitchMin && s.pitch <= WORKSPACE_LIMITS.pitchMax)) return { error: `The grid's pitch must be ${WORKSPACE_LIMITS.pitchMin} to ${WORKSPACE_LIMITS.pitchMax} pixels.` };
  }
  if ('stacks' in input) {
    if (!Array.isArray(input.stacks)) return { error: 'The kept stacks must be a list.' };
    if (input.stacks.length > WORKSPACE_LIMITS.stacks) return { error: `At most ${WORKSPACE_LIMITS.stacks} stacks can be kept.` };
    for (const st of input.stacks) { const p = stackProblem(st); if (p) return { error: p }; }
  }
  if ('modules' in input) {
    if (!isObject(input.modules)) return { error: "The modules' records must be an object by module id." };
    const ids = Object.keys(input.modules);
    if (ids.length > WORKSPACE_LIMITS.modules) return { error: `At most ${WORKSPACE_LIMITS.modules} module records can be kept.` };
    for (const id of ids) {
      if (!MODULE_ID.test(id)) return { error: `"${plain(id)}" is not a module id.` };
      const p = recordProblem(id, input.modules[id]);
      if (p) return { error: p };
    }
  }
  return { arrangement: structuredClone(input) };
}

// A workspace's name, cleaned: { name } or { error }.
function cleanWorkspaceName(value) {
  const name = cleanName(value);
  if (!name) return { error: 'Give the workspace a name.' };
  if (name.length > WORKSPACE_LIMITS.name) return { error: `A workspace's name can be at most ${WORKSPACE_LIMITS.name} characters.` };
  return { name };
}

// A stored workspace as it is read back; null for one that is not well formed (dropped, never repaired).
function storedWorkspace(w) {
  if (!isObject(w) || typeof w.id !== 'string') return null;
  const at = isNum(w.at) ? w.at : 0;
  const arr = cleanArrangement(w.arrangement === undefined ? null : w.arrangement);
  if (arr.error) return null;
  if (w.id === WORKSPACE_ID) return { id: WORKSPACE_ID, at, arrangement: arr.arrangement };
  if (!ADDED_ID.test(w.id)) return null;
  const name = cleanWorkspaceName(w.name);
  if (name.error) return null;
  const shape = w.shape === null || w.shape === undefined ? null : cleanShape(w.shape, {});
  if (shape && shape.error) return null;
  return { id: w.id, name: name.name, shape: shape ? shape.shape : null, at, arrangement: arr.arrangement };
}

class Workspaces {
  constructor(dataDir) {
    this.dir = dataDir;
    this.file = path.join(dataDir, 'workspaces.json');
    this.spaces = Object.create(null); // by space id, then by user key: never an Object property, whatever a key is named
    // None yet is the usual case. One that is there but cannot be read is never written over: every list reads as
    // empty and every change is refused, until the file is fixed or restored and the server started again.
    this.unreadable = false;
    let raw = null;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') this.unreadable = true;
    }
    for (const [spaceId, people] of Object.entries(isObject(raw?.spaces) ? raw.spaces : {})) {
      if (!isObject(people)) continue;
      for (const [key, list] of Object.entries(people)) {
        if (!Array.isArray(list)) continue;
        const seen = new Set();
        const kept = list.map(storedWorkspace).filter((w) => w && !seen.has(w.id) && seen.add(w.id));
        const added = kept.filter((w) => w.id !== WORKSPACE_ID).slice(0, WORKSPACE_LIMITS.added);
        const own = kept.find((w) => w.id === WORKSPACE_ID);
        const out = own ? [own, ...added] : added;
        if (out.length) this.peopleIn(spaceId, true)[key] = out;
      }
    }
  }

  save() {
    if (this.unreadable) throw new WorkspaceError('The workspaces file could not be read, so nothing can be changed until it is fixed.', 500);
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ spaces: this.spaces }, null, 2)}\n`);
    fs.renameSync(tmp, this.file);
  }

  // The person's workspaces in a space, in their order, the Workspace first (with a null arrangement when they have not
  // arranged it). Copies.
  list(spaceId, userKey) {
    const own = this.listFor(spaceId, userKey, false);
    const workspace = own.find((w) => w.id === WORKSPACE_ID) || { id: WORKSPACE_ID, at: 0, arrangement: null };
    return structuredClone([workspace, ...own.filter((w) => w.id !== WORKSPACE_ID)]);
  }

  find(spaceId, userKey, id) {
    return this.list(spaceId, userKey).find((w) => w.id === id) || null;
  }

  peopleIn(spaceId, create) {
    if (!Object.hasOwn(this.spaces, spaceId)) {
      if (!create) return null;
      this.spaces[spaceId] = Object.create(null);
    }
    return this.spaces[spaceId];
  }

  listFor(spaceId, userKey, create) {
    const people = this.peopleIn(spaceId, create);
    if (!people) return [];
    if (!Object.hasOwn(people, userKey)) {
      if (!create) return [];
      people[userKey] = [];
    }
    return people[userKey];
  }

  tidy(spaceId, userKey) {
    const people = this.peopleIn(spaceId, false);
    if (!people) return;
    if (Object.hasOwn(people, userKey) && !people[userKey].length) delete people[userKey];
    if (!Object.keys(people).length) delete this.spaces[spaceId];
  }

  newId(taken) {
    for (;;) {
      let id = 'w';
      for (const b of crypto.randomBytes(6)) id += ID_ALPHABET[b % ID_ALPHABET.length];
      if (!taken.has(id)) return id;
    }
  }

  // Adds one: { name, shape } already cleaned. 409 past the limit or for a name the person already uses here.
  add(spaceId, userKey, { name, shape = null }) {
    if (this.unreadable) this.save();
    const list = this.listFor(spaceId, userKey, false);
    const added = list.filter((w) => w.id !== WORKSPACE_ID);
    if (added.length >= WORKSPACE_LIMITS.added) throw new WorkspaceError(`You can add at most ${WORKSPACE_LIMITS.added} workspaces here; delete one first.`, 409);
    if (added.some((w) => w.name.toLowerCase() === name.toLowerCase())) throw new WorkspaceError('You already have a workspace with that name here.', 409);
    const w = { id: this.newId(new Set(list.map((x) => x.id))), name, shape, at: Date.now(), arrangement: null };
    this.listFor(spaceId, userKey, true).push(w);
    this.save();
    return structuredClone(w);
  }

  // Renames one the person added, or gives it another shape: { name?, shape? } already cleaned.
  change(spaceId, userKey, id, patch) {
    if (this.unreadable) this.save();
    const w = this.listFor(spaceId, userKey, false).find((x) => x.id === id && x.id !== WORKSPACE_ID);
    if (!w) throw new WorkspaceError('There is no such workspace here.', 404);
    if ('name' in patch && patch.name.toLowerCase() !== w.name.toLowerCase() && this.listFor(spaceId, userKey, false).some((x) => x.id !== id && x.id !== WORKSPACE_ID && x.name.toLowerCase() === patch.name.toLowerCase())) {
      throw new WorkspaceError('You already have a workspace with that name here.', 409);
    }
    if ('name' in patch) w.name = patch.name;
    if ('shape' in patch) w.shape = patch.shape;
    w.at = Date.now();
    this.save();
    return structuredClone(w);
  }

  remove(spaceId, userKey, id) {
    if (this.unreadable) this.save();
    const list = this.listFor(spaceId, userKey, false);
    const i = list.findIndex((x) => x.id === id && x.id !== WORKSPACE_ID);
    if (i < 0) throw new WorkspaceError('There is no such workspace here.', 404);
    list.splice(i, 1);
    this.tidy(spaceId, userKey);
    this.save();
  }

  // Puts the workspaces the person added in a new order (Manage tabs, plan-workspaces.md decision 43): `ids` is every id
  // they added here, each once, already checked for its type. 409 when it names a different set (the list changed since it
  // was read). The Workspace's own record is not a tab of theirs and stays where it is. Returns the list, as list().
  reorder(spaceId, userKey, ids) {
    if (this.unreadable) this.save();
    const list = this.listFor(spaceId, userKey, false);
    const added = list.filter((w) => w.id !== WORKSPACE_ID);
    const byId = new Map(added.map((w) => [w.id, w]));
    if (ids.length !== added.length || new Set(ids).size !== ids.length || !ids.every((id) => byId.has(id))) throw new WorkspaceError('Your workspaces here have changed. Open Manage tabs again and try once more.', 409);
    if (added.length) {
      const own = list.filter((w) => w.id === WORKSPACE_ID);
      list.splice(0, list.length, ...own, ...ids.map((id) => byId.get(id)));
      this.save();
    }
    return this.list(spaceId, userKey);
  }

  // Writes a workspace's arrangement (already cleaned; null forgets it). The Workspace's record is made on its first write
  // and dropped again when its arrangement is forgotten. 404 for an id the person has not added.
  arrange(spaceId, userKey, id, arrangement) {
    if (this.unreadable) this.save();
    let w = this.listFor(spaceId, userKey, false).find((x) => x.id === id);
    if (!w && id !== WORKSPACE_ID) throw new WorkspaceError('There is no such workspace here.', 404);
    if (!w) {
      if (arrangement === null) return { id, at: 0, arrangement: null };
      w = { id: WORKSPACE_ID, at: 0, arrangement: null };
      this.listFor(spaceId, userKey, true).unshift(w);
    }
    w.arrangement = arrangement;
    w.at = Date.now();
    if (id === WORKSPACE_ID && arrangement === null) {
      const list = this.listFor(spaceId, userKey, false);
      list.splice(list.indexOf(w), 1);
      this.tidy(spaceId, userKey);
    }
    this.save();
    return { id, at: w.at, arrangement: structuredClone(arrangement) };
  }

  forgetSpace(spaceId) {
    if (this.unreadable || !Object.hasOwn(this.spaces, spaceId)) return;
    delete this.spaces[spaceId];
    this.save();
  }

  forgetPerson(userKey) {
    if (this.unreadable) return;
    let changed = false;
    for (const spaceId of Object.keys(this.spaces)) {
      if (Object.hasOwn(this.spaces[spaceId], userKey)) { delete this.spaces[spaceId][userKey]; this.tidy(spaceId, userKey); changed = true; }
    }
    if (changed) this.save();
  }
}

// The routes: a person's own workspaces in a space. `deps`:
//   store()       the environment's store (store.workspaces is this class), read on every request
//   spaceFor(req, res)   the layouts routes' finder: { who, space } for a signed-in person or a guest who may be in the
//                 space, or null with the refusal already sent (401 not signed in, 404 an aside or no such space or one
//                 closed to them, 403 a space they are not in)
//   shapeOptions(space)  what an area may name in the space ({ modules, on, names }), as for a layout for everyone
//   word(key, opts)      the environment's words
// Each answer is JSON; every refusal is { error } with one sentence.
function mountWorkspaces(app, deps) {
  const { store, spaceFor, shapeOptions, word } = deps;
  const base = '/api/spaces/:id/workspaces';
  // The person whose workspaces these are, or null with the refusal sent. A guest and an agent keep none (403).
  function personIn(req, res) {
    const found = spaceFor(req, res);
    if (!found) return null;
    if (!found.who.user) return void res.status(403).json({ error: `${word('guest', { many: true, cap: true })} don't keep workspaces of their own.` });
    if (found.who.user.agent) return void res.status(403).json({ error: "Agents don't keep workspaces of their own." });
    return { space: found.space, me: found.who.user.key };
  }
  const body = (req) => (isObject(req.body) ? req.body : null);
  const fail = (err, res) => {
    if (err instanceof WorkspaceError) return res.status(err.status).json({ error: err.message });
    throw err;
  };
  // A shape as sent ({ shape, areas } or null), checked against what is on in the space: { shape } or { error }.
  const shapeOf = (space, value) => {
    if (value === null) return { shape: null };
    const out = cleanShape(value, shapeOptions(space));
    return out.error ? { error: out.error } : { shape: out.shape };
  };

  // GET: { workspaces: [the Workspace, then those added], limits }.
  app.get(base, (req, res) => {
    const p = personIn(req, res);
    if (!p) return;
    res.json({ workspaces: store().workspaces.list(p.space.id, p.me), limits: { added: WORKSPACE_LIMITS.added, name: WORKSPACE_LIMITS.name } });
  });

  // POST { name, shape? }: 201 { workspace }.
  app.post(base, (req, res) => {
    const p = personIn(req, res);
    if (!p) return;
    const b = body(req);
    if (!b) return res.status(400).json({ error: 'Send the workspace as JSON: a name, and a shape if it has one.' });
    const extra = Object.keys(b).find((k) => !['name', 'shape'].includes(k));
    if (extra) return res.status(400).json({ error: `A workspace does not take "${plain(extra)}".` });
    const name = cleanWorkspaceName(b.name);
    if (name.error) return res.status(400).json({ error: name.error });
    const shape = shapeOf(p.space, b.shape === undefined ? null : b.shape);
    if (shape.error) return res.status(400).json({ error: shape.error });
    try {
      res.status(201).json({ workspace: store().workspaces.add(p.space.id, p.me, { name: name.name, shape: shape.shape }) });
    } catch (err) { fail(err, res); }
  });

  // PUT { ids } (Manage tabs, decision 43): every workspace the person added here, each once, in their new order. 200
  // { workspaces } as GET lists them. 400 for anything but { ids } as a list of distinct ids, or for the Workspace in it (the
  // owner's tabs keep the owner's order); 409 when the ids are not exactly the ones the person added here.
  app.put(`${base}/order`, (req, res) => {
    const p = personIn(req, res);
    if (!p) return;
    const b = body(req);
    if (!b || !Array.isArray(b.ids) || Object.keys(b).length !== 1) return res.status(400).json({ error: 'Send { ids }: the workspaces you added, in their new order.' });
    if (b.ids.length > WORKSPACE_LIMITS.added || !b.ids.every((id) => typeof id === 'string')) return res.status(400).json({ error: 'Each id is the id of a workspace you added.' });
    if (b.ids.includes(WORKSPACE_ID)) return res.status(400).json({ error: `The Workspace is the ${word('space')}'s, so it stays where the ${word('owner')} put it.` });
    if (new Set(b.ids).size !== b.ids.length) return res.status(400).json({ error: 'Name each workspace once.' });
    try {
      res.json({ workspaces: store().workspaces.reorder(p.space.id, p.me, b.ids) });
    } catch (err) { fail(err, res); }
  });

  // PATCH { name?, shape? } of one the person added: 200 { workspace }. The Workspace is the space's: 403.
  app.patch(`${base}/:workspaceId`, (req, res) => {
    const p = personIn(req, res);
    if (!p) return;
    if (req.params.workspaceId === WORKSPACE_ID) return res.status(403).json({ error: `The Workspace is the ${word('space')}'s, so only its arrangement is yours to change.` });
    const b = body(req);
    if (!b || !Object.keys(b).length) return res.status(400).json({ error: 'Send a new name or a new shape.' });
    const extra = Object.keys(b).find((k) => !['name', 'shape'].includes(k));
    if (extra) return res.status(400).json({ error: `A workspace does not take "${plain(extra)}".` });
    const patch = {};
    if ('name' in b) { const n = cleanWorkspaceName(b.name); if (n.error) return res.status(400).json({ error: n.error }); patch.name = n.name; }
    if ('shape' in b) { const s = shapeOf(p.space, b.shape); if (s.error) return res.status(400).json({ error: s.error }); patch.shape = s.shape; }
    try {
      res.json({ workspace: store().workspaces.change(p.space.id, p.me, req.params.workspaceId, patch) });
    } catch (err) { fail(err, res); }
  });

  // DELETE one the person added: 204. The Workspace can't be: 403.
  app.delete(`${base}/:workspaceId`, (req, res) => {
    const p = personIn(req, res);
    if (!p) return;
    if (req.params.workspaceId === WORKSPACE_ID) return res.status(403).json({ error: `The Workspace is the ${word('space')}'s, so it can't be deleted.` });
    try {
      store().workspaces.remove(p.space.id, p.me, req.params.workspaceId);
      res.status(204).end();
    } catch (err) { fail(err, res); }
  });

  // PUT { arrangement } (an arrangement, or null to forget it): 200 { id, at, arrangement }.
  app.put(`${base}/:workspaceId/arrangement`, (req, res) => {
    const p = personIn(req, res);
    if (!p) return;
    const b = body(req);
    if (!b || !('arrangement' in b) || Object.keys(b).length !== 1) return res.status(400).json({ error: 'Send { arrangement }: the arrangement, or null to forget it.' });
    const out = cleanArrangement(b.arrangement);
    if (out.error) return res.status(400).json({ error: out.error });
    try {
      res.json(store().workspaces.arrange(p.space.id, p.me, req.params.workspaceId, out.arrangement));
    } catch (err) { fail(err, res); }
  });
}

module.exports = { Workspaces, WorkspaceError, cleanArrangement, cleanWorkspaceName, mountWorkspaces, WORKSPACE_LIMITS, WORKSPACE_ID };
