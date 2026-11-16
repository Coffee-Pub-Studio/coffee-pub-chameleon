'use strict';

// Long-lived tokens (documentation/plans/plan-agent-access.md, "The token"): one environment's own, in its own
// DATA_DIR/tokens.json, so a token made in one environment is never found in another. The file and this module are
// general, by `kind`; the first kind is `agent` (an agent account's token). plan-ai-integration's personal tokens may
// reuse them later as another kind.
//
// A token is its kind's prefix and 32 random bytes in base64url, given out once (make) and never kept: only its SHA-256
// is stored (a token this random gains nothing from a slow hash). A record is
// { id, kind, user, hash, createdAt, expiresAt, lastUsedAt, lastAddress }; `id` is random and names the token in the
// agent's log, never the token itself. One live token per person and kind: making a new one ends the old.
// The file is never in an owner's copy of the environment (server/environment-export.js), so a restore of one leaves
// every agent without a token.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOKEN_DAYS = 30;
// Each kind's prefix. Anything after it is exactly 43 base64url characters (32 bytes), checked before it is hashed.
const PREFIXES = Object.freeze({ agent: 'agt_' });
const KINDS = Object.keys(PREFIXES);
const TOKEN_SHAPES = Object.freeze({ agent: /^agt_[A-Za-z0-9_-]{43}$/ });
// How often a token's last use is written down: at most once a minute per token, or at once when the address changes.
const TOUCH_MS = 60 * 1000;
const KEY_RE = /^[a-z0-9]{4,16}$/;
const ID_RE = /^[A-Za-z0-9_-]{8,32}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const isTime = (v) => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));

const hashOf = (token) => crypto.createHash('sha256').update(token).digest('hex');

// What an owner is told of a token: never the token or its hash.
function tokenView(record) {
  if (!record) return null;
  return { id: record.id, createdAt: record.createdAt, expiresAt: record.expiresAt, lastUsedAt: record.lastUsedAt || null, lastAddress: record.lastAddress || null };
}

class Tokens {
  constructor(dataDir, { now = Date.now } = {}) {
    this.file = path.join(dataDir, 'tokens.json');
    this.now = now;
    this.list = this.load();
  }

  load() {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return []; // none yet, or unreadable: no token is accepted, and the next one made writes the file again
    }
    const list = Array.isArray(raw?.tokens) ? raw.tokens : [];
    const seen = new Set();
    const out = [];
    for (const t of list) {
      if (!t || typeof t !== 'object' || !KINDS.includes(t.kind) || !ID_RE.test(String(t.id)) || !KEY_RE.test(String(t.user)) || !HASH_RE.test(String(t.hash))) continue;
      if (!isTime(t.createdAt) || !isTime(t.expiresAt)) continue;
      const one = `${t.kind}|${t.user}`;
      if (seen.has(one)) continue; // one live token per person and kind, whatever the file says
      seen.add(one);
      out.push({
        id: t.id, kind: t.kind, user: t.user, hash: t.hash, createdAt: t.createdAt, expiresAt: t.expiresAt,
        lastUsedAt: isTime(t.lastUsedAt) ? t.lastUsedAt : null,
        lastAddress: typeof t.lastAddress === 'string' && t.lastAddress.length <= 64 ? t.lastAddress : null,
      });
    }
    return out;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    // Private to the server's own user, as app.json is: the hashes are not secrets, but nobody else needs them.
    fs.writeFileSync(tmp, `${JSON.stringify({ tokens: this.list }, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, this.file);
  }

  // A new token for `user` of `kind`, ending any earlier one: { token, record }. The token is in the answer only.
  make(user, kind = 'agent') {
    if (!KINDS.includes(kind)) throw new Error(`unknown token kind ${kind}`);
    if (!KEY_RE.test(String(user))) throw new Error('a token is made for an account key');
    const token = `${PREFIXES[kind]}${crypto.randomBytes(32).toString('base64url')}`;
    const at = this.now();
    const record = {
      id: crypto.randomBytes(9).toString('base64url'),
      kind,
      user,
      hash: hashOf(token),
      createdAt: new Date(at).toISOString(),
      expiresAt: new Date(at + TOKEN_DAYS * 86400000).toISOString(),
      lastUsedAt: null,
      lastAddress: null,
    };
    this.list = [...this.list.filter((t) => !(t.kind === kind && t.user === user)), record];
    this.save();
    return { token, record };
  }

  // The live record a token stands for, or null: the wrong shape, unknown, or past its end. Every record's hash is
  // compared in constant time and all of them are compared, so how long this takes says nothing about which matched.
  find(token, kind = 'agent') {
    const shape = TOKEN_SHAPES[kind];
    if (typeof token !== 'string' || !shape || !shape.test(token)) return null;
    const wanted = Buffer.from(hashOf(token), 'hex');
    let found = null;
    for (const t of this.list) {
      const same = crypto.timingSafeEqual(Buffer.from(t.hash, 'hex'), wanted);
      if (same && t.kind === kind && !found) found = t;
    }
    if (!found || !(Date.parse(found.expiresAt) > this.now())) return null;
    return found;
  }

  // The token `user` holds of `kind` (live or past its end), or null.
  of(user, kind = 'agent') {
    return this.list.find((t) => t.kind === kind && t.user === user) || null;
  }

  // Ends the token `user` holds of `kind`: true when there was one.
  revoke(user, kind = 'agent') {
    const before = this.list.length;
    this.list = this.list.filter((t) => !(t.kind === kind && t.user === user));
    if (this.list.length === before) return false;
    this.save();
    return true;
  }

  // Notes a use: when and from which address, written at most once a minute unless the address changed.
  touch(record, address) {
    const at = this.now();
    const where = typeof address === 'string' ? address.slice(0, 64) : null;
    if (record.lastUsedAt && at - Date.parse(record.lastUsedAt) < TOUCH_MS && record.lastAddress === where) return;
    record.lastUsedAt = new Date(at).toISOString();
    record.lastAddress = where;
    try { this.save(); } catch (err) { console.error(`A token's last use could not be written: ${err.message}`); }
  }
}

module.exports = { Tokens, tokenView, TOKEN_DAYS, PREFIXES };
