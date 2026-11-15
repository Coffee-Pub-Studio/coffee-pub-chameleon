// The settings a module declares (module.json `settings`) and the values people choose for them. A setting has a
// scope that says who chooses it and where it is kept: the whole `environment` (an owner), one `space` (an owner or
// that space's moderators), or each `person` (themselves). The host draws the forms and keeps the values; a module only
// reads them. Values are plain data (a yes/no, a choice, a number or a short text). The one exception is the `secret` type,
// whose value is write-only and kept elsewhere (server/module-secrets.js): it never enters this class's own data, `values`,
// `effective` or a change event; they say only { set: true|false }. Persists to DATA_DIR/modules/settings.json.

'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const SCOPES = ['environment', 'space', 'person'];
const { cleanRows } = require('./setting-list');
const { ModuleSecrets } = require('./module-secrets');
const TYPES = ['boolean', 'choice', 'number', 'text', 'url', 'file', 'files', 'list', 'color', 'note', 'secret'];
const COLOR_RE = /^#[0-9a-f]{6}$/i;
// A setting's `template` mark (module.json; documentation/plans/plan-templates-redesign.md, "The module manifest"):
// "driven", the place's template sets it and nobody else can while it does; "default", the template seeds it and a stored
// value wins. No mark: the module's own, which a template never touches. A key, a file or an outside address is never a
// template's to set (decision 15).
const TEMPLATE_MARKS = ['driven', 'default'];
const REFUSED_TEMPLATE_TYPES = ['secret', 'file', 'files', 'url', 'note'];
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
// Whether a template may give this setting a value: marked, of a type a template may set, and never a person's own driven.
const templateMay = (def) => TEMPLATE_MARKS.includes(def.template) && !REFUSED_TEMPLATE_TYPES.includes(def.type) && !(def.scope === 'person' && def.template === 'driven');

class SettingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// One value made to fit its definition, or a SettingError saying why not.
function cleanValue(def, raw) {
  if (def.type === 'secret') {
    // '' clears it. Nothing here repeats the value: not in a sentence, not anywhere.
    if (typeof raw !== 'string') throw new SettingError(`${def.label} must be text`);
    const t = raw.trim();
    if (t.length > def.maxLength) throw new SettingError(`${def.label} is too long`, 413);
    if (/\p{Cc}/u.test(t)) throw new SettingError(`${def.label} must not have line breaks or control characters`);
    return t;
  }
  if (def.type === 'boolean') {
    if (typeof raw !== 'boolean') throw new SettingError(`${def.label} must be on or off`);
    return raw;
  }
  if (def.type === 'choice') {
    if (!def.options.some((o) => o.value === raw)) throw new SettingError(`${def.label} must be one of its choices`);
    return raw;
  }
  if (def.type === 'number') {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new SettingError(`${def.label} must be a number`);
    if ((def.min !== undefined && raw < def.min) || (def.max !== undefined && raw > def.max)) throw new SettingError(`${def.label} must be between ${def.min ?? 'any'} and ${def.max ?? 'any'}`);
    return raw;
  }
  if (def.type === 'url') {
    if (typeof raw !== 'string') throw new SettingError(`${def.label} must be an address`);
    const t = raw.trim();
    if (!t) return '';
    let u;
    try { u = new URL(t); } catch { throw new SettingError(`${def.label} must be a web address`); }
    if (!/^https?:$/.test(u.protocol) || t.length > 500) throw new SettingError(`${def.label} must be an http or https address`);
    if (u.username || u.password) throw new SettingError(`${def.label} must not contain a user name or password`);
    if (def.httpsOnly && u.protocol !== 'https:') throw new SettingError(`${def.label} must be an https address`);
    if (def.pathEnds && !u.pathname.toLowerCase().endsWith(def.pathEnds.toLowerCase())) throw new SettingError(`${def.label} must be the address of a ${def.pathEnds} file`);
    return t;
  }
  if (def.type === 'color') {
    if (typeof raw !== 'string' || !COLOR_RE.test(raw.trim())) throw new SettingError(`${def.label} must be a color, like #336699`);
    return raw.trim().toLowerCase();
  }
  if (def.type === 'list') {
    try {
      return cleanRows(raw, def);
    } catch (err) {
      throw new SettingError(`${def.label} ${err.message}`);
    }
  }
  if (def.type === 'files') {
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (list.length > 20 || list.some((n) => typeof n !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(n))) throw new SettingError(`${def.label} must be a list of file names`);
    return [...new Set(list)];
  }
  if (def.type === 'file') {
    if (typeof raw !== 'string' || (raw !== '' && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(raw))) throw new SettingError(`${def.label} must be the name of a file`);
    return raw;
  }
  if (typeof raw !== 'string') throw new SettingError(`${def.label} must be text`);
  const text = raw.replace(/\p{Cc}/gu, ' ').trim();
  if (text.length > def.maxLength) throw new SettingError(`${def.label} is too long`);
  return text;
}

// The values a template gives one module, as this module's manifest lets it: only keys the manifest marks, each made to
// fit by the setting's own rules; anything else (an unmarked key, a refused type, a value it does not take) is left out.
// A null-prototype object, so no key a template holds can reach a prototype.
function templateValuesFor(manifest, raw) {
  const out = Object.create(null);
  if (!isObject(raw)) return out;
  for (const def of (manifest && manifest.settings) || []) {
    if (!templateMay(def) || !Object.hasOwn(raw, def.key)) continue;
    try { out[def.key] = cleanValue(def, raw[def.key]); } catch { /* not a value this setting takes: the template gives none */ }
  }
  return out;
}

class ModuleSettings extends EventEmitter {
  // `secretsKey`: a function giving the 32-byte key that seals `secret` settings (index.js's secretsKeyBuf); without it none can be kept.
  constructor(modulesDir, secretsKey = null) {
    super();
    this.secrets = new ModuleSecrets(modulesDir, secretsKey);
    this.setMaxListeners(0);
    this.file = path.join(modulesDir, 'settings.json');
    // The template layer: (moduleId, place) -> { settings, template, module } for the template the place reads (a space id,
    // or null for the environment's own), set by server/environment.js from store.moduleLens. `settings` is the template's
    // own values for the module, unchecked (templateValuesFor checks them against the manifest), `template` its name and
    // `module` what the place calls the module. Without one, no template sets anything.
    this.lens = null;
    this.data = { environment: {}, spaces: {}, people: {} };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && typeof raw === 'object') this.data = { environment: raw.environment || {}, spaces: raw.spaces || {}, people: raw.people || {} };
    } catch {
      // nothing yet
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  // Where a scope's values for one module are kept.
  bucket(moduleId, scope, ctx, create = false) {
    let holder;
    if (scope === 'environment') holder = this.data.environment;
    else if (scope === 'space') holder = (this.data.spaces[ctx.spaceId] ||= {});
    else holder = (this.data.people[ctx.userKey] ||= {});
    if (!holder[moduleId] && create) holder[moduleId] = {};
    return holder[moduleId] || {};
  }

  // The template layer for one module at one place (a space id, or null for the environment's own): { values, template,
  // module }. `values` holds only what the manifest lets a template set (templateValuesFor).
  layerOf(manifest, place = null) {
    let got = null;
    try { got = typeof this.lens === 'function' ? this.lens(manifest.id, typeof place === 'string' && place ? place : null) : null; } catch { got = null; }
    return {
      values: templateValuesFor(manifest, got && got.settings),
      template: got && typeof got.template === 'string' && got.template ? got.template : null,
      module: (got && typeof got.module === 'string' && got.module) || manifest.name,
    };
  }

  // How each setting of a scope stands with the template at a place: { <key>: { template: 'driven' | 'default' | null,
  // given: whether the template gives it a value, templateValue, locked: whether nobody may write it (driven and given),
  // stored: whether a value is kept at this scope } }.
  marks(manifest, scope, ctx, place = ctx && ctx.spaceId) {
    const stored = this.bucket(manifest.id, scope, ctx || {});
    const layer = this.layerOf(manifest, place);
    const out = {};
    for (const def of manifest.settings || []) {
      if (def.scope !== scope) continue;
      const mark = templateMay(def) ? def.template : null;
      const given = Boolean(mark) && def.key in layer.values;
      out[def.key] = { template: mark, given, ...(given ? { templateValue: layer.values[def.key] } : {}), locked: given && mark === 'driven', stored: Object.hasOwn(stored, def.key) };
    }
    return out;
  }

  // What is chosen for a scope, and the default for what is not: { key: value } for the settings of that scope. With the
  // template layer of `place` (the space the values are read in; null, the environment's own): a driven setting the
  // template gives reads the template's value; a default one reads the stored value, else the template's, else the
  // manifest's default. The owner's environment value therefore wins in every space (decision 35), a space's stored
  // value in that space, and a person's own once they chose one (a person's setting is only ever seeded).
  values(manifest, scope, ctx, place = ctx && ctx.spaceId) {
    const stored = this.bucket(manifest.id, scope, ctx);
    const out = {};
    // A note carries no value at all -- left out of `out` entirely, so it answers with no `value` wherever
    // this feeds a page (the def itself still comes through separately, for the label and the hint).
    for (const def of manifest.settings || []) if (def.scope === scope && def.type !== 'note' && def.type !== 'secret') out[def.key] = def.key in stored ? stored[def.key] : def.default;
    // A secret is only ever { set } (see server/module-secrets.js), for every viewer.
    for (const def of manifest.settings || []) if (def.scope === scope && def.type === 'secret') out[def.key] = this.secrets.state(manifest.id, def.key);
    const dif = new Set();
    for (const def of manifest.settings || []) {
      // A choice that grew out of another setting starts as the option that keeps what was already set.
      const d = def.scope === scope && def.type === 'choice' && def.defaultIfSet;
      if (d && !(def.key in stored) && typeof stored[d.key] === 'string' && stored[d.key]) { out[def.key] = d.value; dif.add(def.key); }
    }
    for (const def of manifest.settings || []) if (def.scope === scope && def.type === 'files' && typeof out[def.key] === 'string') out[def.key] = out[def.key] ? [out[def.key]] : []; // from when it was one file
    return this.withTemplate(manifest, scope, out, (key) => key in stored || dif.has(key), place);
  }

  // `out` (a scope's values) with the template layer of `place` over it; `kept(key)` says whether a value of the place's
  // own stands for that key.
  withTemplate(manifest, scope, out, kept, place) {
    const marked = (manifest.settings || []).filter((d) => d.scope === scope && templateMay(d));
    if (!marked.length) return out;
    const layer = this.layerOf(manifest, place);
    for (const def of marked) {
      if (!(def.key in layer.values)) continue;
      if (def.template === 'driven' || !kept(def.key)) out[def.key] = structuredClone(layer.values[def.key]);
    }
    return out;
  }

  // A scope's values with nothing stored: the defaults, under the template layer of `place`.
  defaults(manifest, scope, place) {
    const out = Object.fromEntries((manifest.settings || []).filter((d) => d.scope === scope).map((d) => [d.key, d.default]));
    return this.withTemplate(manifest, scope, out, () => false, place);
  }

  // Everything a module sees for this viewer: environment, space and person values together, each under the template
  // layer of the space it is read in (the environment's own template with no space).
  effective(manifest, { spaceId, userKey }) {
    const place = spaceId || null;
    return {
      ...this.values(manifest, 'environment', {}, place),
      ...(spaceId ? this.values(manifest, 'space', { spaceId }) : this.defaults(manifest, 'space', null)),
      ...(userKey ? this.values(manifest, 'person', { userKey }, place) : this.defaults(manifest, 'person', place)),
    };
  }

  // Set some values of one scope. Only keys the module declares for that scope are taken; the rest are refused.
  // A setting the place's template drives (it gives a value) is nobody's to write, whoever asks and by whatever route:
  // a different value is refused (409) and the same value is left out, so a form saving several settings together still
  // saves the rest. null for a setting the template seeds ("default") forgets the stored value, so the template's applies
  // again (the forms' Reset). The template layer is the place's: the space for a space setting, the environment's own
  // template for an environment one.
  set(manifest, scope, ctx, values, by) {
    if (!SCOPES.includes(scope)) throw new SettingError('no such kind of setting');
    const defs = (manifest.settings || []).filter((d) => d.scope === scope);
    const clean = {};
    const forget = [];
    const layer = defs.some(templateMay) ? this.layerOf(manifest, scope === 'space' ? ctx.spaceId : null) : null;
    for (const [key, raw] of Object.entries(values && typeof values === 'object' ? values : {})) {
      const def = defs.find((d) => d.key === key);
      if (!def) throw new SettingError(`${manifest.name} has no ${scope} setting "${String(key).slice(0, 40)}"`);
      if (def.type === 'note') continue; // carries no value -- nothing to validate or store
      if (layer && templateMay(def) && def.template === 'driven' && def.key in layer.values) {
        let same = false;
        try { same = JSON.stringify(cleanValue(def, raw)) === JSON.stringify(layer.values[def.key]); } catch { /* not even a value it takes */ }
        if (same) continue;
        throw new SettingError(`${layer.module}'s ${def.label} is set by ${layer.template ? `the ${layer.template} template` : 'its template'}; to change it, copy the template.`, 409);
      }
      if (raw === null && templateMay(def) && def.template === 'default') { forget.push(key); continue; }
      clean[key] = cleanValue(def, raw);
    }
    // A secret goes to its own sealed store, never into this class's data; only its name is reported as changed.
    const secretKeys = Object.keys(clean).filter((k) => defs.find((d) => d.key === k).type === 'secret');
    if (secretKeys.length && !this.secrets.canKeep()) throw new SettingError('A key cannot be kept on this server.', 503);
    const sealedChanged = [];
    for (const k of secretKeys) {
      const value = clean[k];
      delete clean[k];
      if (this.secrets.put(manifest.id, k, value)) sealedChanged.push(k);
    }
    const bucket = this.bucket(manifest.id, scope, ctx, true);
    const changed = Object.keys(clean).filter((k) => JSON.stringify(bucket[k]) !== JSON.stringify(clean[k])).concat(sealedChanged);
    for (const k of forget) if (Object.hasOwn(bucket, k)) { delete bucket[k]; changed.push(k); }
    Object.assign(bucket, clean);
    if (changed.length) {
      this.save();
      this.emit('change', { module: manifest.id, scope, spaceId: ctx.spaceId || null, userKey: ctx.userKey || null, keys: changed, by: by || null });
    }
    return { values: this.values(manifest, scope, ctx), changed };
  }

  // For server code that USES a secret (never a route, never a page): the value of a `secret` setting this module declares, or null
  // when none is kept, it cannot be opened, or the module does not declare that key as a secret.
  secret(manifest, key) {
    if (!(manifest.settings || []).some((d) => d.key === key && d.type === 'secret')) return null;
    return this.secrets.get(manifest.id, key);
  }

  forgetModule(moduleId) {
    this.secrets.forgetModule(moduleId);
    delete this.data.environment[moduleId];
    for (const r of Object.values(this.data.spaces)) delete r[moduleId];
    for (const p of Object.values(this.data.people)) delete p[moduleId];
    this.save();
  }

  forgetSpace(spaceId) {
    if (this.data.spaces[spaceId]) {
      delete this.data.spaces[spaceId];
      this.save();
    }
  }
}

module.exports = { ModuleSettings, SettingError, cleanValue, templateValuesFor, SETTING_SCOPES: SCOPES, SETTING_TYPES: TYPES, TEMPLATE_MARKS, REFUSED_TEMPLATE_TYPES };
