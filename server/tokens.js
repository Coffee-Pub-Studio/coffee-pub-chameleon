// Long-lived tokens (documentation/plans/plan-agent-access.md, "The token"): one environment's own, in its own
// DATA_DIR/tokens.json, so a token made in one environment is never found in another. The file and this module are
// general, by `kind`:
//   agent       an agent account's pasted token (agt_), the owner's chosen lifetime;
//   connection  an app's sign-in connection for an agent (documentation/plans/plan-mcp-oauth.md): no secret of its own,
//               the grant an owner allowed, with the owner's chosen lifetime; its tokens are the next two kinds;
//   access      a connection's access token (oat_), one hour at most, never past its connection's end;
//   refresh     a connection's refresh token (ort_), the connection's life; rotated on each use, the ended ones kept (a
//               few) only so a second use of one can be told and end the whole connection.
// plan-ai-integration's personal tokens may reuse the file later as another kind.
//
// A token is its kind's prefix and 32 random bytes in base64url, given out once and never kept: only its SHA-256 is
// stored (a token this random gains nothing from a slow hash). An agent record is
// { id, kind, user, hash, createdAt, lifetime, expiresAt, lastUsedAt, lastAddress }; `lifetime` is the owner's choice (a
// key of LIFETIMES) and `expiresAt` its end, null for "never"; `id` is random and names the token in the agent's log,
// never the token itself. A connection is { id, kind, user, client, app, returnsTo, resource, scope, allowedBy, createdAt,
// lifetime, expiresAt, lastUsedAt, lastAddress }; its id names it in the log. An access or refresh record is
// { id, kind, user, connection, client, resource, hash, createdAt, expiresAt } (and `endedAt` for a refresh token).
// One way in per agent (plan-mcp-oauth.md, decision 5): a pasted token or one connection, each ending the other.
// The file is never in an owner's copy of the environment (server/environment-export.js), so a restore of one leaves
// every agent without a token or a connection.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');

const TOKEN_DAYS = 30;
// How long an owner may let a token last, by the word they choose: days, or null for no end. 30d is the default.
const LIFETIMES = Object.freeze({ '30d': 30, '60d': 60, '90d': 90, '1y': 365, never: null });
const DEFAULT_LIFETIME = '30d';
// Each kind's prefix. Anything after it is exactly 43 base64url characters (32 bytes), checked before it is hashed.
const PREFIXES = Object.freeze({ agent: 'agt_', access: 'oat_', refresh: 'ort_' });
const SECRET_KINDS = Object.keys(PREFIXES);
const KINDS = [...SECRET_KINDS, 'connection'];
const TOKEN_SHAPES = Object.freeze(Object.fromEntries(Object.entries(PREFIXES).map(([k, p]) => [k, new RegExp(`^${p}[A-Za-z0-9_-]{43}$`)])));
// An access token lives an hour at most (plan-mcp-oauth.md, decision 4).
const ACCESS_MS = 60 * 60 * 1000;
// The ended refresh tokens kept per connection, to tell a second use of one (which ends the connection).
const ENDED_REFRESH_KEPT = 20;
const CLIENT_RE = /^[A-Za-z0-9_-]{8,64}$/;
const shortText = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
// How often a token's last use is written down: at most once a minute, whatever the address. Between writes the newest
// use and address are kept in memory (and shown), and written when the minute is up.
const TOUCH_MS = 60 * 1000;
// An address is kept only when it is one (net.isIP): never the free text a client may send in X-Forwarded-For.
const addressOf = (v) => (typeof v === 'string' && net.isIP(v) ? v : null);
const KEY_RE = /^[a-z0-9]{4,16}$/;
const ID_RE = /^[A-Za-z0-9_-]{8,32}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const isTime = (v) => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));

const hashOf = (token) => crypto.createHash('sha256').update(token).digest('hex');

// What an owner is told of a token: never the token or its hash.
function tokenView(record) {
  if (!record) return null;
  return { id: record.id, createdAt: record.createdAt, lifetime: record.lifetime, expiresAt: record.expiresAt, lastUsedAt: record.lastUsedAt || null, lastAddress: record.lastAddress || null };
}

class Tokens {
  constructor(dataDir, { now = Date.now } = {}) {
    this.file = path.join(dataDir, 'tokens.json');
    this.now = now;
    this.list = this.load();
    this.touchedAt = 0; // when a use was last written
    this.touchTimer = null;
  }

  load() {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return []; // none yet, or unreadable: no token is accepted, and the next one made writes the file again
    }
    const list = Array.isArray(raw?.tokens) ? raw.tokens : [];
    const ways = []; // agent tokens and connections: one way in per agent
    const secrets = []; // access and refresh tokens, read once the connections are known
    for (const t of list) {
      if (!t || typeof t !== 'object' || !KINDS.includes(t.kind) || !ID_RE.test(String(t.id)) || !KEY_RE.test(String(t.user)) || !isTime(t.createdAt)) continue;
      if (Date.parse(t.createdAt) > this.now() + 5 * 60000) continue; // not made in the future: a hand-made record
      if (t.kind === 'access' || t.kind === 'refresh') {
        if (!HASH_RE.test(String(t.hash)) || !ID_RE.test(String(t.connection)) || !CLIENT_RE.test(String(t.client)) || !shortText(t.resource, 300)) continue;
        if (t.expiresAt !== null && !isTime(t.expiresAt)) continue;
        if (t.kind === 'access' && (t.expiresAt === null || Date.parse(t.expiresAt) - Date.parse(t.createdAt) > ACCESS_MS)) continue;
        if (t.kind === 'refresh' && t.endedAt !== undefined && t.endedAt !== null && !isTime(t.endedAt)) continue;
        secrets.push({ id: t.id, kind: t.kind, user: t.user, connection: t.connection, client: t.client, resource: t.resource, hash: t.hash, createdAt: t.createdAt, expiresAt: t.expiresAt, ...(t.kind === 'refresh' ? { endedAt: t.endedAt || null } : {}) });
        continue;
      }
      if (t.kind === 'agent' && !HASH_RE.test(String(t.hash))) continue;
      if (t.kind === 'connection' && (!CLIENT_RE.test(String(t.client)) || !shortText(t.app, 60) || !shortText(t.returnsTo, 2000) || !shortText(t.resource, 300) || !shortText(t.scope, 100) || !KEY_RE.test(String(t.allowedBy)))) continue;
      // A record from before the owner could choose has no lifetime: it was made for 30 days.
      const lifetime = t.lifetime === undefined ? DEFAULT_LIFETIME : t.lifetime;
      if (typeof lifetime !== 'string' || !Object.hasOwn(LIFETIMES, lifetime)) continue;
      const days = LIFETIMES[lifetime];
      // A token lives its chosen lifetime at most from when it was made: a record that says otherwise was not written
      // here (a hand-made file) and is not read. "never" has no end, so no expiresAt at all.
      if (days === null) {
        if (t.expiresAt !== null) continue;
      } else {
        if (!isTime(t.expiresAt)) continue;
        const life = Date.parse(t.expiresAt) - Date.parse(t.createdAt);
        if (!(life > 0 && life <= days * 86400000)) continue;
      }
      const common = { id: t.id, kind: t.kind, user: t.user, createdAt: t.createdAt, lifetime, expiresAt: t.expiresAt, lastUsedAt: isTime(t.lastUsedAt) ? t.lastUsedAt : null, lastAddress: addressOf(t.lastAddress) };
      ways.push(t.kind === 'agent'
        ? { ...common, hash: t.hash }
        : { ...common, client: t.client, app: t.app, returnsTo: t.returnsTo, resource: t.resource, scope: t.scope, allowedBy: t.allowedBy });
    }
    // One way in per agent, whatever the file says: the newest of its token and connection.
    const newest = new Map();
    for (const w of ways) {
      const had = newest.get(w.user);
      if (!had || Date.parse(w.createdAt) > Date.parse(had.createdAt)) newest.set(w.user, w);
    }
    const out = [...newest.values()];
    const connections = new Map(out.filter((w) => w.kind === 'connection').map((c) => [c.id, c]));
    // A connection's tokens only with their connection, its agent and its client; one live access and one live refresh each.
    const liveOne = new Set();
    for (const t of secrets) {
      const c = connections.get(t.connection);
      if (!c || c.user !== t.user || c.client !== t.client) continue;
      if (t.expiresAt !== null && c.expiresAt !== null && Date.parse(t.expiresAt) > Date.parse(c.expiresAt)) continue;
      if (t.kind === 'refresh' && t.endedAt) { out.push(t); continue; }
      const one = `${t.kind}|${t.connection}`;
      if (liveOne.has(one)) continue;
      liveOne.add(one);
      out.push(t);
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
  // `lifetime` is a key of LIFETIMES (the route checks the owner's word first).
  // Making one ends the agent's connection too (one way in per agent).
  make(user, kind = 'agent', lifetime = DEFAULT_LIFETIME) {
    if (!Object.hasOwn(LIFETIMES, lifetime)) throw new Error(`unknown token lifetime ${lifetime}`);
    if (kind !== 'agent') throw new Error(`unknown token kind ${kind}`);
    if (!KEY_RE.test(String(user))) throw new Error('a token is made for an account key');
    const token = `${PREFIXES[kind]}${crypto.randomBytes(32).toString('base64url')}`;
    const at = this.now();
    const record = {
      id: crypto.randomBytes(9).toString('base64url'),
      kind,
      user,
      hash: hashOf(token),
      createdAt: new Date(at).toISOString(),
      lifetime,
      expiresAt: LIFETIMES[lifetime] === null ? null : new Date(at + LIFETIMES[lifetime] * 86400000).toISOString(),
      lastUsedAt: null,
      lastAddress: null,
    };
    this.list = [...this.list.filter((t) => t.user !== user), record];
    this.save();
    return { token, record };
  }

  // A new sign-in connection for agent `user` (plan-mcp-oauth.md), ending its pasted token and any earlier connection:
  // the connection record. It holds no token yet: the app's code is exchanged for its first pair (issue).
  connect(user, { client, app, returnsTo, resource, scope, allowedBy, lifetime = DEFAULT_LIFETIME }) {
    if (!Object.hasOwn(LIFETIMES, lifetime)) throw new Error(`unknown token lifetime ${lifetime}`);
    if (!KEY_RE.test(String(user)) || !KEY_RE.test(String(allowedBy))) throw new Error('a connection is made for an account key');
    if (!CLIENT_RE.test(String(client)) || !shortText(app, 60) || !shortText(returnsTo, 2000) || !shortText(resource, 300) || !shortText(scope, 100)) throw new Error('a connection needs its client, app, return address, resource and scope');
    const at = this.now();
    const record = {
      id: crypto.randomBytes(9).toString('base64url'),
      kind: 'connection',
      user,
      client,
      app,
      returnsTo,
      resource,
      scope,
      allowedBy,
      createdAt: new Date(at).toISOString(),
      lifetime,
      expiresAt: LIFETIMES[lifetime] === null ? null : new Date(at + LIFETIMES[lifetime] * 86400000).toISOString(),
      lastUsedAt: null,
      lastAddress: null,
    };
    this.list = [...this.list.filter((t) => t.user !== user), record];
    this.save();
    return record;
  }

  // A new access and refresh token for a live connection, ending its earlier access token and its live refresh token
  // (kept, marked ended, so a second use of it can be told): { access, refresh, expiresIn }. The tokens are in the answer only.
  issue(connection) {
    if (!connection || connection.kind !== 'connection' || !this.list.includes(connection) || !this.live(connection)) throw new Error('no such live connection');
    const at = this.now();
    const end = connection.expiresAt === null ? null : Date.parse(connection.expiresAt);
    const accessEnd = end === null ? at + ACCESS_MS : Math.min(at + ACCESS_MS, end);
    const secret = (kind, expires) => {
      const token = `${PREFIXES[kind]}${crypto.randomBytes(32).toString('base64url')}`;
      return {
        token,
        record: {
          id: crypto.randomBytes(9).toString('base64url'), kind, user: connection.user, connection: connection.id, client: connection.client, resource: connection.resource,
          hash: hashOf(token), createdAt: new Date(at).toISOString(), expiresAt: expires === null ? null : new Date(expires).toISOString(), ...(kind === 'refresh' ? { endedAt: null } : {}),
        },
      };
    };
    const access = secret('access', accessEnd);
    const refresh = secret('refresh', end);
    const endedAt = new Date(at).toISOString();
    let ended = this.list.filter((t) => t.kind === 'refresh' && t.connection === connection.id).map((t) => (t.endedAt ? t : { ...t, endedAt }));
    ended = ended.sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt)).slice(0, ENDED_REFRESH_KEPT - 1);
    this.list = [...this.list.filter((t) => !((t.kind === 'access' || t.kind === 'refresh') && t.connection === connection.id)), ...ended, access.record, refresh.record];
    this.save();
    return { access: access.token, refresh: refresh.token, expiresIn: Math.max(1, Math.round((accessEnd - at) / 1000)) };
  }

  // The connection a record of a connection's token stands for, or null when it has ended.
  connectionOf(record) {
    if (!record) return null;
    return this.list.find((t) => t.kind === 'connection' && t.id === record.connection && t.user === record.user) || null;
  }

  // A connection by its id (live or past its end), or null.
  connectionById(id) {
    return this.list.find((t) => t.kind === 'connection' && t.id === id) || null;
  }

  // Ends one connection and every token of it: the ended connection, or null when there was none.
  endConnection(id) {
    const c = this.list.find((t) => t.kind === 'connection' && t.id === id);
    if (!c) return null;
    this.list = this.list.filter((t) => t !== c && t.connection !== id);
    this.save();
    return c;
  }

  // The agent's one way in, live or past its end: its pasted token's record or its connection, else null.
  wayInOf(user) {
    return this.list.find((t) => (t.kind === 'agent' || t.kind === 'connection') && t.user === user) || null;
  }

  // The connections of one client (live or past their end).
  connectionsOfClient(client) {
    return this.list.filter((t) => t.kind === 'connection' && t.client === client);
  }

  // The live record a token stands for, or null: the wrong shape, unknown, or past its end (with `evenExpired`, a record
  // past its end too, for the caller to tell apart). Every record's hash is compared in constant time and all of them are
  // compared, so how long this takes says nothing about which matched.
  find(token, kind = 'agent', { evenExpired = false } = {}) {
    const shape = TOKEN_SHAPES[kind];
    if (typeof token !== 'string' || !shape || !shape.test(token)) return null;
    const wanted = Buffer.from(hashOf(token), 'hex');
    let found = null;
    for (const t of this.list) {
      if (!t.hash) continue; // a connection holds no secret of its own
      const same = crypto.timingSafeEqual(Buffer.from(t.hash, 'hex'), wanted);
      if (same && t.kind === kind && !found) found = t;
    }
    if (!found || (!evenExpired && !this.live(found))) return null;
    return found;
  }

  // Whether a record has not reached its end: one with no end (expiresAt null) never does; an ended refresh token never is.
  live(record) {
    if (record.kind === 'refresh' && record.endedAt) return false;
    return record.expiresAt === null || Date.parse(record.expiresAt) > this.now();
  }

  // The token `user` holds of `kind` (live or past its end), or null.
  of(user, kind = 'agent') {
    return this.list.find((t) => t.kind === kind && t.user === user) || null;
  }

  // Ends every way in `user` has: its pasted token, its connection and the connection's tokens. True when there was one.
  revoke(user) {
    const had = Boolean(this.wayInOf(user));
    const before = this.list.length;
    this.list = this.list.filter((t) => t.user !== user);
    if (this.list.length === before) return false;
    this.save();
    return had;
  }

  // Notes a use: when and from which address (an IP address, else none). Kept at once in memory; written to the file at
  // most once a minute, the newest use going in when the minute is up.
  touch(record, address) {
    const at = this.now();
    record.lastUsedAt = new Date(at).toISOString();
    record.lastAddress = addressOf(address);
    if (at - this.touchedAt >= TOUCH_MS) return this.writeUses();
    if (!this.touchTimer) {
      this.touchTimer = setTimeout(() => this.writeUses(), Math.max(0, this.touchedAt + TOUCH_MS - at));
      if (this.touchTimer.unref) this.touchTimer.unref();
    }
    return undefined;
  }

  writeUses() {
    if (this.touchTimer) clearTimeout(this.touchTimer);
    this.touchTimer = null;
    this.touchedAt = this.now();
    try { this.save(); } catch (err) { console.error(`A token's last use could not be written: ${err.message}`); }
  }
}

module.exports = { Tokens, tokenView, TOKEN_DAYS, LIFETIMES, DEFAULT_LIFETIME, PREFIXES, ACCESS_MS };
