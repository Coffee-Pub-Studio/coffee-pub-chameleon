'use strict';
// The sign-in server for apps (documentation/plans/plan-mcp-oauth.md, step 1): each environment is its own small OAuth
// 2.1 authorization server, for agents only, on its own address. An app (the Claude apps, ChatGPT, Codex, Claude Code)
// finds it from the 401 on /mcp (resource_metadata), registers itself (RFC 7591), sends the person's browser to the
// approval page, and trades the code it gets back (PKCE, S256 only) for a one-hour access token and a refresh token, both
// bound to one agent's connection and to this environment's /mcp. What the token may do is the agent's: the gate in
// server/index.js reads an access token as it reads an agent's pasted token, on /mcp and on the tool calls server/mcp.js
// sends back through the app, and nowhere else.
//
// Only where an agent token works (AGENT_TOKENS on, an environment; never the product host or the host console): off,
// every route here goes on to whatever answers an unknown path. With the environment's Agents switch off the metadata still
// answers and the approval page is told so; no connection is made and no token issued.
//
// Kept: the registered apps in the environment's oauth-clients.json (a secret only as its SHA-256), the connections and
// their tokens in its tokens.json (server/tokens.js). Sign-ins in progress and codes are in memory only: a restart ends a
// sign-in in progress and the app starts again. No token, code, verifier or secret is ever written to a log or put in an
// address; a code goes in the redirect by the protocol, one use, 60 seconds, useless without its verifier.
//
// Shaped as a part (plan-core-parts.md): createOauth takes what it needs from the base by name; mount() registers the routes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

// The scopes this server knows. `agent` is the only right there is; `offline_access` is accepted and echoed for the apps
// that ask for it to be given a refresh token (one is always given). Any other scope asked for is passed over.
const SCOPES = ['agent', 'offline_access'];
const CODE_MS = 60 * 1000;
const REQUEST_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 500; // sign-ins waiting at once, per environment
const MAX_CLIENTS = 200;
const CLIENT_UNUSED_MS = 86400000; // a registered app that never got a connection: a day
const CLIENT_IDLE_MS = 30 * 86400000; // one whose connections have all ended: 30 days
const NAME_MAX = 60;
const REDIRECTS_MAX = 5;
const REDIRECT_MAX_LENGTH = 2000;
const AUTH_METHODS = ['none', 'client_secret_basic', 'client_secret_post'];
const GRANT_TYPES = ['authorization_code', 'refresh_token'];
const LOOPBACK_HOSTS = ['127.0.0.1', '[::1]', 'localhost'];
// A loopback return address, its port taken out (RFC 8252: an app on the person's own computer picks a port when it runs).
const LOOPBACK = /^(http:\/\/(?:127\.0\.0\.1|\[::1\]|localhost))(?::\d{1,5})?([/?].*)?$/i;
const CODE_RE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{22}$/;
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const ORIGIN_RE = /^https?:\/\/[A-Za-z0-9.:[\]-]{1,300}$/;

// The words of refusals that are not the OAuth protocol's own codes.
const ENDED_UNNAMED = 'This sign-in has ended. Start again from the app.';
const endedFor = (app) => `This sign-in has ended. Start again from ${app}.`;
const FORM_WRONG = 'This page is out of date. Open it again from the app.';
const NOT_REGISTERED = 'This app is not registered here, so the sign-in stops here. Start again from the app.';
const BAD_RETURN = 'This app asked to go back to an address it did not register, so the sign-in stops here.';
const NO_RETURN = 'This app registered more than one return address and did not say which, so the sign-in stops here.';
const TOO_MANY = (s) => `Too many tries from this address. Try again in ${s} second${s === 1 ? '' : 's'}.`;

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const random = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sameText = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
// Plain text a person reads: no control characters, spaces collapsed, at most `max` characters.
// Characters a name never keeps: control characters, the zero-width and direction marks, and the line and paragraph
// separators (by code point, so this file holds none of them).
const HIDDEN = [[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2066, 0x2069]];
const hidden = (ch) => { const c = ch.codePointAt(0); return HIDDEN.some(([a, b]) => c >= a && c <= b) || ch === '<' || ch === '>'; };
const plain = (v, max) => (typeof v === 'string' ? [...v].map((ch) => (hidden(ch) ? ' ' : ch)).join('').replace(/\s+/g, ' ').trim().slice(0, max).trim() : '');

// A return address an app may register: https (no fragment, no user name or password), or http on a loopback address.
// null when it is one, else why not.
function redirectProblem(uri) {
  if (typeof uri !== 'string' || !uri || uri.length > REDIRECT_MAX_LENGTH) return `Each of redirect_uris is an address of at most ${REDIRECT_MAX_LENGTH.toLocaleString('en-US')} characters.`;
  let u;
  try { u = new URL(uri); } catch { return 'Each of redirect_uris is a full address, like https://example.com/callback.'; }
  if (uri.includes('#')) return 'A return address has no #fragment.';
  if (u.username || u.password) return 'A return address has no user name or password in it.';
  if (/[\s\u0000-\u001f\u007f]/.test(uri)) return 'A return address has no blanks or control characters in it.';
  if (u.protocol === 'https:' && u.hostname) return null;
  if (u.protocol === 'http:' && LOOPBACK_HOSTS.includes(u.hostname.toLowerCase())) return null;
  return 'A return address is https, or http on 127.0.0.1, [::1] or localhost.';
}
// Whether `asked` is the registered return address `registered`: the very same text, or, for a loopback address, the same
// text once the port is taken out of both (any port; the path and query exactly).
function sameReturn(registered, asked) {
  if (typeof asked !== 'string') return false;
  if (registered === asked) return true;
  const a = LOOPBACK.exec(registered);
  const b = LOOPBACK.exec(asked);
  return Boolean(a && b) && a[1].toLowerCase() === b[1].toLowerCase() && (a[2] || '/') === (b[2] || '/');
}
const hostOf = (uri) => { try { return new URL(uri).host.replace(/:\d+$/, '') || uri; } catch { return uri; } };
// A resource as it is compared: scheme, host (with a port), path without one trailing slash; null when it is not an address.
function canonicalResource(v) {
  if (typeof v !== 'string' || v.length > 300) return null;
  try {
    const u = new URL(v);
    if (u.hash || u.search || u.username || u.password) return null;
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/$/, '')}`;
  } catch { return null; }
}
// The scopes granted for what an app asked: always `agent`, and `offline_access` when it was asked for.
function grantedScope(asked) {
  const words = typeof asked === 'string' ? asked.split(/\s+/).filter(Boolean) : [];
  return SCOPES.filter((s) => s === 'agent' || words.includes(s)).join(' ');
}

// A count per address in a window: hit() counts and answers 0, or the seconds to wait once `max` is reached.
class Window {
  constructor(max, ms) { this.max = max; this.ms = ms; this.hits = new Map(); }
  entry(key) {
    const now = Date.now();
    let e = this.hits.get(key);
    if (!e || now - e.first >= this.ms) { e = { first: now, count: 0 }; this.hits.delete(key); this.hits.set(key, e); }
    if (this.hits.size > 5000) for (const [k, v] of this.hits) { if (now - v.first >= this.ms || this.hits.size > 5000) this.hits.delete(k); else break; }
    return e;
  }
  wait(key) {
    const e = this.hits.get(key);
    if (!e || Date.now() - e.first >= this.ms || e.count < this.max) return 0;
    return Math.max(1, Math.ceil((e.first + this.ms - Date.now()) / 1000));
  }
  hit(key) {
    const w = this.wait(key);
    if (w) return w;
    this.entry(key).count += 1;
    return 0;
  }
  clear(key) { this.hits.delete(key); }
}

// The registered apps of one environment: oauth-clients.json in its folder. A record is
// { id, name, redirectUris, auth, secretHash, createdAt, lastSeenAt } (lastSeenAt: its last connection or token, else null).
class Clients {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'oauth-clients.json');
    this.list = this.load();
  }
  load() {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return []; }
    const out = [];
    const seen = new Set();
    for (const c of Array.isArray(raw?.clients) ? raw.clients : []) {
      if (!c || typeof c !== 'object' || !CLIENT_ID_RE.test(String(c.id)) || seen.has(c.id)) continue;
      if (typeof c.name !== 'string' || !c.name || c.name.length > NAME_MAX || plain(c.name, NAME_MAX) !== c.name) continue;
      if (!Array.isArray(c.redirectUris) || !c.redirectUris.length || c.redirectUris.length > REDIRECTS_MAX || c.redirectUris.some((u) => redirectProblem(u))) continue;
      if (!AUTH_METHODS.includes(c.auth) || (c.auth === 'none' ? c.secretHash !== null : !/^[0-9a-f]{64}$/.test(String(c.secretHash)))) continue;
      if (!Number.isFinite(Date.parse(c.createdAt))) continue;
      seen.add(c.id);
      out.push({ id: c.id, name: c.name, redirectUris: [...c.redirectUris], auth: c.auth, secretHash: c.secretHash, createdAt: c.createdAt, lastSeenAt: Number.isFinite(Date.parse(c.lastSeenAt)) ? c.lastSeenAt : null });
    }
    return out.slice(0, MAX_CLIENTS);
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify({ clients: this.list }, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, this.file);
  }
  byId(id) { return typeof id === 'string' ? this.list.find((c) => c.id === id) || null : null; }
  // Drops the apps nobody uses (plan-mcp-oauth.md, "Registered apps"); `connected(id)` says whether one has a live connection.
  prune(connected) {
    const now = Date.now();
    const before = this.list.length;
    this.list = this.list.filter((c) => {
      if (connected(c.id)) return true;
      if (!c.lastSeenAt) return now - Date.parse(c.createdAt) < CLIENT_UNUSED_MS;
      return now - Date.parse(c.lastSeenAt) < CLIENT_IDLE_MS;
    });
    if (this.list.length !== before) this.save();
  }
  seen(client) {
    client.lastSeenAt = new Date().toISOString();
    this.save();
  }
}

// createOauth(base): base gives what the sign-in server needs from the server, by name:
//   app                  the Express app
//   enabled              whether agents are on for the server (AGENT_TOKENS); off, every route here is an unknown path
//   envOf()              the request's environment (with dataDir and tokens), or null (the product host, the console)
//   origin(req)          this environment's origin as the request reached it (decision 3: no configured address)
//   personOf(req)        the signed-in person, or null
//   sessionOf(req)       the person's session value, to tie the page's one-time form value to it
//   mayApprove(user)     whether they may connect an app (an owner, the admin, the host admin's stand-in)
//   environmentName()    the environment's name, as people read it
//   onlyOwners(name)     the refusal for someone who may not approve, in the environment's words
//   facts(req, user)     what the approval page offers: { agentsOn, kinds, agents, spaces, lifetimes, defaultLifetime }
//   approve(req, user, body, app)  makes or picks the agent, adds the spaces and makes the connection: { connection }, or
//                        { status, error } (app: { client, name, returnsTo, redirectUri, resource, scope })
//   usable(record)       whether the agent of a connection may work now (exists, an agent, not off, its switches on)
//   reused(connection)   a code or a refresh token was used again: ends the connection and writes the log line
function createOauth(base) {
  const { app, enabled, envOf, origin, personOf, sessionOf, mayApprove, environmentName, facts, approve, usable, reused } = base;
  const states = new WeakMap(); // environment -> its sign-in state
  function stateOf(env) {
    let s = states.get(env);
    if (!s) {
      s = {
        clients: new Clients(env.dataDir),
        requests: new Map(), // id -> a sign-in in progress
        codes: new Map(), // sha256(code) -> what it was given for
        register: new Window(10, 3600000),
        authorize: new Window(30, 60000),
        token: new Window(60, 60000),
        fails: new Window(5, 15 * 60000), // five wrong in a row block the address for a while
      };
      states.set(env, s);
    }
    return s;
  }
  // The request's environment and its sign-in state when the sign-in server works here, else null.
  const here = () => {
    if (!enabled) return null;
    const env = envOf();
    return env ? { env, s: stateOf(env) } : null;
  };
  const addressOf = (req) => req.ip || 'unknown';
  // This environment's issuer and resource, or null when the request's address is not one an issuer can be.
  const issuerOf = (req) => { const o = String(origin(req)); return ORIGIN_RE.test(o) ? o : null; };
  const resourceOf = (req) => { const o = issuerOf(req); return o ? `${o}/mcp` : null; };
  // The WWW-Authenticate value of a 401 on /mcp.
  const challenge = (req) => {
    const o = issuerOf(req);
    return o ? `Bearer resource_metadata="${o}/.well-known/oauth-protected-resource/mcp", scope="agent"` : 'Bearer';
  };

  const tidy = (map, now = Date.now()) => {
    for (const [k, v] of map) if (v.expiresAt + REQUEST_MS < now) map.delete(k);
  };
  const noFrames = (res) => res.set({ 'Cache-Control': 'no-store', 'Content-Security-Policy': "frame-ancestors 'none'", 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
  const oauthError = (res, status, error, description, extra = {}) => res.status(status).set({ 'Cache-Control': 'no-store', Pragma: 'no-cache', ...extra }).json({ error, error_description: description });
  const tooMany = (res, wait) => oauthError(res, 429, 'invalid_request', TOO_MANY(wait), { 'Retry-After': String(wait) });

  // --- metadata (RFC 9728, RFC 8414) ----------------------------------------------------------------------------------
  function resourceMetadata(req, res, next) {
    if (!here()) return next();
    const issuer = issuerOf(req);
    if (!issuer) return res.status(400).json({ error: 'This address can\'t be an issuer.' });
    res.set('Cache-Control', 'no-cache').json({ resource: `${issuer}/mcp`, authorization_servers: [issuer], bearer_methods_supported: ['header'], scopes_supported: SCOPES, resource_name: environmentName() });
  }
  function serverMetadata(req, res, next) {
    if (!here()) return next();
    const issuer = issuerOf(req);
    if (!issuer) return res.status(400).json({ error: 'This address can\'t be an issuer.' });
    // No client_id_metadata_document_supported: client ID metadata documents are a later step (decision 7), so a client that
    // would use one (Codex's "auto") registers instead.
    res.set('Cache-Control', 'no-cache').json({
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: GRANT_TYPES,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: AUTH_METHODS,
      scopes_supported: SCOPES,
      authorization_response_iss_parameter_supported: true,
    });
  }

  // --- registration (RFC 7591) ----------------------------------------------------------------------------------------
  const metadataError = (res, description, error = 'invalid_client_metadata') => oauthError(res, 400, error, description);
  function register(req, res, next) {
    const h = here();
    if (!h) return next();
    const wait = h.s.register.hit(addressOf(req));
    if (wait) return tooMany(res, wait);
    const body = req.body;
    if (!req.is('application/json') || !body || typeof body !== 'object' || Array.isArray(body)) return metadataError(res, 'Send the app\'s details as JSON.');
    const uris = body.redirect_uris;
    if (!Array.isArray(uris) || uris.length < 1 || uris.length > REDIRECTS_MAX) return metadataError(res, `redirect_uris is a list of 1 to ${REDIRECTS_MAX} addresses.`, 'invalid_redirect_uri');
    for (const u of uris) { const problem = redirectProblem(u); if (problem) return metadataError(res, problem, 'invalid_redirect_uri'); }
    // RFC 7591: an app that names no method authenticates with a secret, sent the basic way.
    const auth = body.token_endpoint_auth_method === undefined ? 'client_secret_basic' : body.token_endpoint_auth_method;
    if (!AUTH_METHODS.includes(auth)) return metadataError(res, `token_endpoint_auth_method is one of: ${AUTH_METHODS.join(', ')}.`);
    if (body.grant_types !== undefined && (!Array.isArray(body.grant_types) || !body.grant_types.length || body.grant_types.some((g) => !GRANT_TYPES.includes(g)) || !body.grant_types.includes('authorization_code'))) return metadataError(res, 'grant_types holds authorization_code, and refresh_token if you like; nothing else.');
    if (body.response_types !== undefined && (!Array.isArray(body.response_types) || body.response_types.length !== 1 || body.response_types[0] !== 'code')) return metadataError(res, 'response_types is ["code"].');
    if (body.client_name !== undefined && typeof body.client_name !== 'string') return metadataError(res, 'client_name is text.');
    const { s, env } = h;
    s.clients.prune((id) => env.tokens.connectionsOfClient(id).some((c) => env.tokens.live(c)));
    if (s.clients.list.length >= MAX_CLIENTS) return oauthError(res, 403, 'access_denied', 'This place has as many apps registered as it may. Try again tomorrow.');
    const secret = auth === 'none' ? null : `ocs_${random()}`;
    const client = {
      id: random(18),
      name: plain(body.client_name, NAME_MAX) || 'An app',
      redirectUris: [...new Set(uris)],
      auth,
      secretHash: secret ? sha256(secret) : null,
      createdAt: new Date().toISOString(),
      lastSeenAt: null,
    };
    s.clients.list.push(client);
    s.clients.save();
    res.status(201).set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' }).json({
      client_id: client.id,
      client_id_issued_at: Math.floor(Date.parse(client.createdAt) / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: auth,
      grant_types: GRANT_TYPES,
      response_types: ['code'],
      scope: SCOPES.join(' '),
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    });
  }

  // --- authorize ------------------------------------------------------------------------------------------------------
  // A refusal shown to the person, never sent to the app: the client or its return address is not known good.
  const stopHere = (res, status, sentence) => noFrames(res).status(status).type('text/plain').send(sentence);
  // The app's return address with these parameters added (its own query kept).
  const withParams = (uri, params) => {
    const u = new URL(uri);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, v);
    return u.toString();
  };
  function authorize(req, res, next) {
    const h = here();
    if (!h) return next();
    const { s } = h;
    const wait = s.authorize.hit(addressOf(req));
    if (wait) return noFrames(res).status(429).set('Retry-After', String(wait)).type('text/plain').send(TOO_MANY(wait));
    const q = req.query;
    const one = (k) => (typeof q[k] === 'string' ? q[k] : undefined);
    const client = s.clients.byId(one('client_id'));
    if (!client) return stopHere(res, 400, NOT_REGISTERED);
    let redirectUri = one('redirect_uri');
    if (redirectUri === undefined) {
      if (q.redirect_uri !== undefined || client.redirectUris.length !== 1) return stopHere(res, 400, NO_RETURN);
      redirectUri = client.redirectUris[0];
    } else if (!client.redirectUris.some((r) => sameReturn(r, redirectUri)) || redirectProblem(redirectUri)) return stopHere(res, 400, BAD_RETURN);
    const issuer = issuerOf(req);
    if (!issuer) return stopHere(res, 400, 'This address can\'t be an issuer.');
    // From here the client and its return address are known good: what is wrong goes back to the app.
    const state = one('state');
    const back = (error, description) => noFrames(res).redirect(302, withParams(redirectUri, { error, error_description: description, state, iss: issuer }));
    if (one('response_type') !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported.');
    const challengeValue = one('code_challenge');
    if (!challengeValue) return back('invalid_request', 'A code_challenge is needed (PKCE).');
    if (one('code_challenge_method') !== 'S256') return back('invalid_request', 'code_challenge_method must be S256.');
    if (!CHALLENGE_RE.test(challengeValue)) return back('invalid_request', 'code_challenge is not an S256 challenge.');
    if (q.state !== undefined && state === undefined) return back('invalid_request', 'Send state once.');
    if (state !== undefined && state.length > 2000) return back('invalid_request', 'state is at most 2,000 characters.');
    const resource = resourceOf(req);
    if (q.resource !== undefined && canonicalResource(one('resource')) !== canonicalResource(resource)) return back('invalid_target', `The only resource here is ${resource}.`);
    const now = Date.now();
    tidy(s.requests, now);
    if (s.requests.size >= MAX_REQUESTS) return back('temporarily_unavailable', 'Too many sign-ins are waiting here. Try again in a few minutes.');
    const id = random(16);
    s.requests.set(id, {
      id,
      client: client.id,
      redirectUri,
      redirectGiven: q.redirect_uri !== undefined,
      challenge: challengeValue,
      state,
      scope: grantedScope(one('scope')),
      resource,
      issuer,
      expiresAt: now + REQUEST_MS,
      ended: false,
      form: null,
      session: null,
    });
    return noFrames(res).redirect(302, `/connect-app?request=${id}`);
  }

  // --- the approval page's routes -------------------------------------------------------------------------------------
  // The sign-in a request id names: { r, client } while it can still be allowed; { ended, app } when it has ended (used,
  // denied, expired or its app gone); null when it is unknown.
  function requestOf(s, id) {
    if (typeof id !== 'string' || !REQUEST_ID_RE.test(id)) return null;
    tidy(s.requests);
    const r = s.requests.get(id);
    if (!r) return null;
    const client = s.clients.byId(r.client);
    if (!client) return { ended: true, app: null };
    if (r.ended || r.expiresAt <= Date.now()) return { ended: true, app: client.name };
    return { r, client };
  }
  const endedAnswer = (res, found) => res.status(404).json({ error: found && found.app ? endedFor(found.app) : ENDED_UNNAMED, ended: true });
  const onlyOwners = () => base.onlyOwners(environmentName());
  const sessionHash = (req) => { const v = sessionOf(req); return typeof v === 'string' && v ? sha256(v) : null; };

  function showRequest(req, res, next) {
    const h = here();
    if (!h) return next();
    noFrames(res);
    const user = personOf(req);
    if (!user) return res.status(401).json({ error: 'sign in first' });
    const found = requestOf(h.s, req.params.id);
    if (!found || found.ended) return endedAnswer(res, found);
    const { r, client } = found;
    const view = { app: { name: client.name, returnsTo: hostOf(r.redirectUri) }, environment: environmentName(), mayApprove: mayApprove(user) };
    const offered = facts(req, user);
    view.agentsOn = offered.agentsOn;
    if (!view.mayApprove || !offered.agentsOn) return res.json(view);
    // A fresh one-time value each time the page is opened, tied to this person's session: only it can allow or deny.
    r.form = random();
    r.session = sessionHash(req);
    r.person = user.key;
    return res.json({ ...view, kinds: offered.kinds, agents: offered.agents, spaces: offered.spaces, lifetimes: offered.lifetimes, defaultLifetime: offered.defaultLifetime, form: r.form });
  }
  // The checks Allow and Don't allow share: signed in, a live request, the page's form value from this very session, and
  // someone who may approve. Answers { r, client, user } or null after answering.
  function decided(req, res, h) {
    noFrames(res);
    const user = personOf(req);
    if (!user) return void res.status(401).json({ error: 'sign in first' });
    const found = requestOf(h.s, req.params.id);
    if (!found || found.ended) return void endedAnswer(res, found);
    const { r, client } = found;
    const form = req.body && typeof req.body === 'object' ? req.body.form : undefined;
    const session = sessionHash(req);
    if (!mayApprove(user)) return void res.status(403).json({ error: onlyOwners() });
    if (!r.form || !session || !sameText(String(form ?? ''), r.form) || !sameText(session, r.session) || r.person !== user.key) return void res.status(403).json({ error: FORM_WRONG });
    return { r, client, user };
  }
  function allow(req, res, next) {
    const h = here();
    if (!h) return next();
    const d = decided(req, res, h);
    if (!d) return undefined;
    const { r, client, user } = d;
    const { form: _form, ...body } = req.body || {};
    const made = approve(req, user, body, { client: client.id, name: client.name, returnsTo: r.redirectUri, resource: r.resource, scope: r.scope });
    if (made.error) return res.status(made.status || 400).json({ error: made.error });
    r.ended = true;
    r.form = null;
    const code = random();
    h.s.codes.set(sha256(code), { client: client.id, redirectUri: r.redirectUri, redirectGiven: r.redirectGiven, challenge: r.challenge, resource: r.resource, connection: made.connection.id, expiresAt: Date.now() + CODE_MS, used: false, issued: false });
    tidy(h.s.codes);
    h.s.clients.seen(client);
    return res.json({ redirect: withParams(r.redirectUri, { code, state: r.state, iss: r.issuer }) });
  }
  function deny(req, res, next) {
    const h = here();
    if (!h) return next();
    const d = decided(req, res, h);
    if (!d) return undefined;
    d.r.ended = true;
    d.r.form = null;
    return res.json({ redirect: withParams(d.r.redirectUri, { error: 'access_denied', error_description: 'The person did not allow it.', state: d.r.state, iss: d.r.issuer }) });
  }

  // --- token ----------------------------------------------------------------------------------------------------------
  const formBody = express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 20 });
  // The client a token request is from, by its id and (for one with a secret) its secret: { client } or { error }.
  function clientOf(req, s, body) {
    const header = req.get('authorization') || '';
    let id = typeof body.client_id === 'string' ? body.client_id : undefined;
    let secret;
    let basic = false;
    if (/^basic\s/i.test(header)) {
      basic = true;
      let pair;
      try { pair = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8'); } catch { pair = ''; }
      const at = pair.indexOf(':');
      if (at < 0) return { error: 'The client\'s id and secret could not be read.', basic };
      try {
        const hid = decodeURIComponent(pair.slice(0, at).replace(/\+/g, ' '));
        secret = decodeURIComponent(pair.slice(at + 1).replace(/\+/g, ' '));
        if (id !== undefined && id !== hid) return { error: 'Send one client id.', basic };
        id = hid;
      } catch { return { error: 'The client\'s id and secret could not be read.', basic }; }
    } else if (typeof body.client_secret === 'string') secret = body.client_secret;
    const client = s.clients.byId(id);
    if (!client) return { error: 'This app is not registered here.', basic };
    if (client.auth !== 'none') {
      if (typeof secret !== 'string' || !sameText(sha256(secret), client.secretHash)) return { error: 'The client\'s secret is wrong.', basic };
      if (client.auth === 'client_secret_basic' && !basic) return { error: 'This app sends its secret the basic way (an Authorization header).', basic };
      if (client.auth === 'client_secret_post' && basic) return { error: 'This app sends its secret in the request body.', basic };
    }
    return { client };
  }
  function token(req, res, next) {
    const h = here();
    if (!h) return next();
    return formBody(req, res, (err) => {
      if (err) return oauthError(res, 400, 'invalid_request', 'Send the request as a form (application/x-www-form-urlencoded).');
      return tokenFor(req, res, h);
    });
  }
  function tokenFor(req, res, { env, s }) {
    const ip = addressOf(req);
    const blocked = s.fails.wait(ip);
    if (blocked) return tooMany(res, blocked);
    const wait = s.token.hit(ip);
    if (wait) return tooMany(res, wait);
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const failed = (status, error, description, extra) => { s.fails.hit(ip); return oauthError(res, status, error, description, extra); };
    const who = clientOf(req, s, body);
    if (who.error) return failed(401, 'invalid_client', who.error, who.basic ? { 'WWW-Authenticate': 'Basic realm="token"' } : {});
    const { client } = who;
    const asked = body.resource;
    if (asked !== undefined && typeof asked !== 'string') return failed(400, 'invalid_target', 'Send one resource.');
    const answer = (connection) => {
      if (!usable(connection)) return failed(400, 'invalid_grant', 'This connection can\'t be used now: the agent is off, or agents are off here.');
      const pair = env.tokens.issue(connection);
      s.fails.clear(ip);
      s.clients.seen(client);
      return res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' }).json({ access_token: pair.access, token_type: 'Bearer', expires_in: pair.expiresIn, refresh_token: pair.refresh, scope: connection.scope });
    };
    if (body.grant_type === 'authorization_code') {
      const code = body.code;
      if (typeof code !== 'string' || !CODE_RE.test(code)) return failed(400, 'invalid_grant', 'That code is not one this server gave.');
      tidy(s.codes);
      const c = s.codes.get(sha256(code));
      if (!c) return failed(400, 'invalid_grant', 'That code is not one this server gave, or it has expired.');
      if (c.used) {
        // A second use of a code: the connection it made ends (it may be someone else's copy of it).
        if (c.issued) { const ended = env.tokens.connectionById(c.connection); if (ended) reused(ended); }
        return failed(400, 'invalid_grant', c.issued ? 'That code was used already, so the connection it made has ended.' : 'That code was used already.');
      }
      c.used = true;
      if (c.expiresAt <= Date.now()) return failed(400, 'invalid_grant', 'That code has expired. Start again from the app.');
      if (c.client !== client.id) return failed(400, 'invalid_grant', 'That code was given to another app.');
      if ((c.redirectGiven || body.redirect_uri !== undefined) && body.redirect_uri !== c.redirectUri) return failed(400, 'invalid_grant', 'redirect_uri is not the one the sign-in used.');
      const verifier = body.code_verifier;
      if (typeof verifier !== 'string' || !VERIFIER_RE.test(verifier)) return failed(400, 'invalid_grant', 'A code_verifier of 43 to 128 characters is needed.');
      if (!sameText(crypto.createHash('sha256').update(verifier).digest('base64url'), c.challenge)) return failed(400, 'invalid_grant', 'The code_verifier does not match the code_challenge.');
      if (asked !== undefined && canonicalResource(asked) !== canonicalResource(c.resource)) return failed(400, 'invalid_target', `The code was given for ${c.resource}.`);
      const connection = env.tokens.connectionById(c.connection);
      if (!connection || !env.tokens.live(connection)) return failed(400, 'invalid_grant', 'That connection has ended.');
      c.issued = true;
      return answer(connection);
    }
    if (body.grant_type === 'refresh_token') {
      const record = env.tokens.find(body.refresh_token, 'refresh', { evenExpired: true });
      if (!record) return failed(400, 'invalid_grant', 'That refresh token is not one this server gave, or it has ended.');
      if (record.endedAt) {
        // An old refresh token used again: someone holds a copy, so the whole connection ends (decision 4).
        const ended = env.tokens.connectionOf(record);
        if (ended) reused(ended);
        return failed(400, 'invalid_grant', 'That refresh token was used already, so the connection has ended.');
      }
      if (record.client !== client.id) return failed(400, 'invalid_grant', 'That refresh token was given to another app.');
      if (!env.tokens.live(record)) return failed(400, 'invalid_grant', 'That connection has ended.');
      if (asked !== undefined && canonicalResource(asked) !== canonicalResource(record.resource)) return failed(400, 'invalid_target', `The refresh token was given for ${record.resource}.`);
      const connection = env.tokens.connectionOf(record);
      if (!connection || !env.tokens.live(connection)) return failed(400, 'invalid_grant', 'That connection has ended.');
      return answer(connection);
    }
    return failed(400, body.grant_type === undefined ? 'invalid_request' : 'unsupported_grant_type', 'grant_type is authorization_code or refresh_token.');
  }

  function mount() {
    app.get('/.well-known/oauth-protected-resource/mcp', resourceMetadata);
    app.get('/.well-known/oauth-protected-resource', resourceMetadata);
    app.get('/.well-known/oauth-authorization-server', serverMetadata);
    app.post('/oauth/register', register);
    app.get('/oauth/authorize', authorize);
    app.post('/oauth/token', token);
    app.get('/api/oauth/requests/:id', showRequest);
    app.post('/api/oauth/requests/:id/allow', allow);
    app.post('/api/oauth/requests/:id/deny', deny);
  }

  return { mount, challenge, resourceOf };
}

module.exports = { createOauth, redirectProblem, sameReturn, grantedScope, SCOPES };
