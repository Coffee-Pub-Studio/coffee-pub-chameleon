// Who accepted an outside service's terms (documentation/plans/plan-weather-part.md, step 1; plan-github-pull.md, "Credentials and
// terms"): one record for every outside service the server may ask, the weather services (server/weather-providers/) and the issue
// services (server/issue-providers/) alike. A service's terms are accepted by a person in authority, once for the whole server,
// never by software: the server's administrator, signed in, on a single install; the host's administrator, on the host console,
// on a hosted one. Module settings are never the host's, so this is the one small host-level file: DATA_DIR/service-terms.json,
// beside weather.json and never in an environment's copy.
//
//   { services: { <adapter id>: { terms: the address of the terms accepted, by: who (a login), at: when (ISO) } } }
//
// An acceptance counts only for the terms' address it was given for: if an adapter's terms move, it must be accepted again.
// Adapter ids are one namespace across both kinds of service (each folder's index.js refuses a clash at start).
'use strict';

const fs = require('fs');
const path = require('path');

const FILE_NAME = 'service-terms.json';
// The file's name before the record was shared (it held only weather services). On the first start that finds it and no
// service-terms.json, it is renamed, once, so terms an administrator already accepted still count (plan-github-pull.md, the
// rename of weather-terms.json). Nothing reads it after that.
const RENAMED_FROM = 'weather-terms.json';
const ID = /^[a-z][a-z0-9-]{0,23}$/;

class ServiceTerms {
  constructor(dataDir) {
    this.file = path.join(dataDir, FILE_NAME);
    this.services = null;
    const before = path.join(dataDir, RENAMED_FROM);
    try {
      if (!fs.existsSync(this.file) && fs.existsSync(before)) fs.renameSync(before, this.file);
    } catch (err) {
      console.error(`could not rename ${RENAMED_FROM} to ${FILE_NAME}; its terms must be accepted again:`, err.message);
    }
  }

  all() {
    if (this.services) return this.services;
    this.services = {};
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [id, r] of Object.entries(raw && raw.services && typeof raw.services === 'object' ? raw.services : {})) {
        if (ID.test(id) && r && typeof r.terms === 'string' && typeof r.by === 'string' && typeof r.at === 'string') this.services[id] = { terms: r.terms, by: r.by.slice(0, 80), at: r.at.slice(0, 40) };
      }
    } catch (err) {
      if (err && err.code !== 'ENOENT') console.error(`could not read ${FILE_NAME}; no service's terms are accepted:`, err.message);
    }
    return this.services;
  }

  // The acceptance of this adapter's current terms, or null.
  of(adapter) {
    const r = this.all()[adapter.id];
    return r && r.terms === (adapter.terms || '') ? r : null;
  }

  accepted(adapter) {
    return Boolean(this.of(adapter));
  }

  accept(adapter, by, now = new Date()) {
    this.all()[adapter.id] = { terms: adapter.terms || '', by: String(by || '').slice(0, 80), at: now.toISOString() };
    this.save();
    return this.all()[adapter.id];
  }

  withdraw(adapter) {
    const had = Object.hasOwn(this.all(), adapter.id);
    delete this.all()[adapter.id];
    if (had) this.save();
    return had;
  }

  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ services: this.all() }, null, 2));
    fs.renameSync(tmp, this.file);
  }

  // What a page shows: every registered service with its kind ('weather' or 'issues'), terms address, credit and whether (and
  // by whom) it is accepted. `adapters` are [{ kind, adapter }].
  view(adapters) {
    return adapters.map(({ kind, adapter: a }) => {
      const r = this.of(a);
      return { id: a.id, kind, name: a.name, credit: a.credit || '', terms: a.terms || '', accepted: Boolean(r), ...(r ? { by: r.by, at: r.at } : {}) };
    });
  }
}

module.exports = { ServiceTerms, FILE_NAME, RENAMED_FROM };
