'use strict';

// Starter content and starter spaces (documentation/plans/plan-templates-redesign.md, "Starter spaces and starter
// content"; decisions 17 and 41).
//
// Starter content is a template's `modules.<id>.starter`: a module's own data keys and values, written by the server
// once, when a space is made, into that space only, as the person who made it, through the data route's own checks
// (PUT /api/modules/:id/data/:key at space scope: the module on in the space, the creator's permission, the module's
// guards, the key rule and the size caps). Only a module whose installed manifest says `"starter": true` receives any.
// A write never replaces anything (it expects no value there). The space records `starterDone: true` before the first
// write, so nothing writes it twice, whether or not every write passed; a write that fails is skipped and logged and
// the space is still made. Never on a change of template, a restore or a demo load: the only callers are the making
// of a space (POST /api/spaces) and of an environment's starter spaces.
//
// Starter spaces are a template's `starterSpaces`, made once when an environment is made from that template (never on
// a switch), each recorded as using that template and then given its starter content as any new space is.
//
// This file holds what can be said without the server: which blocks a template's starter content gives, checked again
// (a template may have been stored before a module changed, or edited by hand), and who makes the starter spaces. The
// writes themselves are the server's (server/index.js, fillStarter), on the data route's own path.

const { MAX_STARTER_KEYS, MAX_STARTER_BYTES, MAX_STARTER_SPACES } = require('./templates');

// Keys that reach an object's prototype in code that reads them: never a module id or a data key here.
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// A module's id, as the catalog has them.
const MODULE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
// Text from a template, made safe for a log line: cut short, and any control character (a newline) shown as a space.
const shown = (v) => String(v).slice(0, 40).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ');

// The starter content `template` gives, as blocks to write: { blocks: [{ module, entries: [[key, value]] }], skipped:
// [{ module, key?, why }] }. `optedIn(id)`: whether that module, as installed now, takes starter content. A module is
// left out whole when it takes none, is not a module id, holds more than MAX_STARTER_KEYS keys, or would take the
// template past MAX_STARTER_BYTES; a key no module may hold (a prototype key) is left out alone. Each value is a copy.
function starterBlocks(template, { optedIn = () => false } = {}) {
  const blocks = [];
  const skipped = [];
  if (!template || !isObject(template.modules)) return { blocks, skipped };
  let bytes = 0;
  for (const id of Object.keys(template.modules)) {
    const entry = template.modules[id];
    if (!isObject(entry) || entry.starter === undefined) continue;
    if (FORBIDDEN_KEYS.has(id) || !MODULE_ID_RE.test(id)) { skipped.push({ module: shown(id), why: 'is not an id' }); continue; }
    if (!optedIn(id)) { skipped.push({ module: shown(id), why: 'takes no starter content' }); continue; }
    if (!isObject(entry.starter)) { skipped.push({ module: shown(id), why: 'its starter content is not data by key' }); continue; }
    const keys = Object.keys(entry.starter);
    if (keys.length > MAX_STARTER_KEYS) { skipped.push({ module: shown(id), why: `its starter content has more than ${MAX_STARTER_KEYS} keys` }); continue; }
    let size;
    try { size = Buffer.byteLength(JSON.stringify(entry.starter)); } catch { skipped.push({ module: shown(id), why: 'its starter content is not plain JSON' }); continue; }
    if (bytes + size > MAX_STARTER_BYTES) { skipped.push({ module: shown(id), why: `the template's starter content is over ${MAX_STARTER_BYTES / 1024} KB` }); continue; }
    bytes += size;
    const entries = [];
    for (const key of keys) {
      if (FORBIDDEN_KEYS.has(key)) { skipped.push({ module: shown(id), key: shown(key), why: 'is not a key anything may hold' }); continue; }
      entries.push([key, structuredClone(entry.starter[key])]);
    }
    if (entries.length) blocks.push({ module: id, entries });
  }
  return { blocks, skipped };
}

// A starter value as the person who made the space wrote it, now (decision 41: "as the person who made it"). A template
// file can't know who that is or when, so an authored record's own author and time fields are filled in here, on a
// copy. A record is authored when it has any of `by`, `editedBy` or `editedByName` (whatever their values); then `by`
// and `editedBy` become the creator's key, `editedByName` their name (display name, else login), and `at` and
// `editedAt` the time given (Documents' doc record: { by, at, editedBy, editedByName, editedAt }; the Schedule
// outline's entries carry `by`). Only fields the record already has are set, none is added; nothing else in it, and no
// record with none of the three, is changed, so an authored record never names anyone else as its author. The copy is
// made by own keys (CreateDataProperty), so a key such as "__proto__" stays the record's own data key. The module's
// guards still run on the result (an owner field set to the writer).
const AUTHOR_KEYS = ['by', 'editedBy'];
const AUTHOR_NAMES = ['editedByName'];
const AUTHOR_TIMES = ['at', 'editedAt'];
const AUTHOR_FIELDS = [...AUTHOR_KEYS, ...AUTHOR_NAMES];
function asCreator(value, creator, at) {
  if (!isObject(value) || !AUTHOR_FIELDS.some((k) => Object.hasOwn(value, k)) || !creator || typeof creator.key !== 'string') return value;
  const out = {};
  for (const k of Object.keys(value)) Object.defineProperty(out, k, { value: value[k], enumerable: true, writable: true, configurable: true });
  const set = (k, v) => Object.defineProperty(out, k, { value: v, enumerable: true, writable: true, configurable: true });
  for (const k of AUTHOR_KEYS) if (Object.hasOwn(out, k)) set(k, creator.key);
  for (const k of AUTHOR_NAMES) if (Object.hasOwn(out, k)) set(k, [creator.displayName, creator.login].find((v) => typeof v === 'string' && v) || out[k]);
  for (const k of AUTHOR_TIMES) if (Object.hasOwn(out, k)) set(k, at);
  return out;
}

// The starter spaces `template` makes (at most MAX_STARTER_SPACES, each { name, description }), or [].
function starterSpacesOf(template) {
  const list = template && Array.isArray(template.starterSpaces) ? template.starterSpaces : [];
  return list
    .slice(0, MAX_STARTER_SPACES)
    .filter((sp) => isObject(sp) && typeof sp.name === 'string' && sp.name.trim())
    .map((sp) => ({ name: sp.name.trim(), description: typeof sp.description === 'string' ? sp.description.trim() : '' }));
}

// Who makes an environment's starter spaces, so their starter content is written as a person with the rights to make a
// space: the environment's first owner, else its admin (a single install's), else the host admin's stand-in, else null
// (the spaces are still made; their starter content is skipped).
function starterSpaceCreator(users) {
  const list = Array.isArray(users) ? users : [];
  return list.find((u) => u.role === 'owner') || list.find((u) => u.role === 'admin' && !u.hostAdmin) || list.find((u) => u.role === 'admin') || null;
}

module.exports = { shown, starterBlocks, starterSpacesOf, starterSpaceCreator, asCreator, FORBIDDEN_KEYS };
