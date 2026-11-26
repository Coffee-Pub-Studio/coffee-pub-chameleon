// The GitHub app's credentials and installation tokens (documentation/plans/plan-github-app.md, sections 4 and 5), and the link flow
// (sections 2 and 6: the sign-in while linking, kept in memory for 15 minutes). Chameleon is registered once as a GitHub App; a space linked through it (record `via: 'app'`) is read and written
// with an installation token narrowed to its one repository, instead of any token set on the server.
//
// Configuration, environment variables read once at start (the host's, shared by every environment):
//   ISSUES_GITHUB_APP_CLIENT_ID      the app's client ID: the JWT's `iss`
//   ISSUES_GITHUB_APP_CLIENT_SECRET  the link flow's sign-in (the code exchange and the revoke); without it the app is off
//   ISSUES_GITHUB_APP_KEY_FILE       the path of the private key's .pem file, or
//   ISSUES_GITHUB_APP_KEY            the PEM itself (`\n` accepted for line breaks); exactly one of the two
// The key is read once into a crypto key object and never kept as text. The key, the client secret, a JWT and an installation token
// are never logged, answered, written to a space's data or sent anywhere but GitHub's own origin in the Authorization header.
//
// Installation tokens are kept in memory only, by installation and repository, and reused until 5 minutes before they expire.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const issuesLib = require('./issues');

const { SAY } = issuesLib;
const REFRESH_BEFORE_MS = 5 * 60 * 1000;
const JWT_BACK_S = 60; // iat: GitHub allows for clock drift
const JWT_LIFE_S = 9 * 60; // exp: at most 10 minutes ahead
const BROKEN_MS = 5 * 60 * 1000; // after the app's key was refused, how long before the server asks again
const MAX_CACHED = 500;

const ENV_ID = 'ISSUES_GITHUB_APP_CLIENT_ID';
const ENV_SECRET = 'ISSUES_GITHUB_APP_CLIENT_SECRET';
const ENV_KEY_FILE = 'ISSUES_GITHUB_APP_KEY_FILE';
const ENV_KEY = 'ISSUES_GITHUB_APP_KEY';

// The configuration, from `env`: { set, clientId, clientSecretSet, key, problem }. `set`: any of the four variables is given;
// `problem`: one line for the log (never a value), or ''. `key` is a crypto KeyObject or null; the secret is kept by start() alone and never returned.
function readConfig(env = process.env) {
  const val = (n) => (typeof env[n] === 'string' ? env[n].trim() : '');
  const clientId = val(ENV_ID);
  const secret = val(ENV_SECRET);
  const file = val(ENV_KEY_FILE);
  const inline = val(ENV_KEY);
  const set = Boolean(clientId || secret || file || inline);
  const out = { set, clientId, clientSecretSet: Boolean(secret), key: null, problem: '' };
  if (!set) return out;
  if (file && inline) { out.problem = `Set only one of ${ENV_KEY_FILE} and ${ENV_KEY}. The GitHub app is off.`; return out; }
  if (!clientId || !secret || (!file && !inline)) {
    out.problem = `The GitHub app needs ${ENV_ID}, ${ENV_SECRET} and one of ${ENV_KEY_FILE} or ${ENV_KEY}. The GitHub app is off.`;
    return out;
  }
  try {
    const pem = file ? fs.readFileSync(file, 'utf8') : inline.replace(/\\n/g, '\n');
    const key = crypto.createPrivateKey(pem);
    if (key.asymmetricKeyType !== 'rsa') throw new Error('not rsa');
    out.key = key;
  } catch {
    out.problem = 'The GitHub app\'s private key could not be read. The GitHub app is off.';
  }
  return out;
}

const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
// A JWT for the app, RS256: iat 60 seconds back, exp under 10 minutes ahead, iss the client ID.
function signJwt(key, clientId, nowMs) {
  const now = Math.floor(nowMs / 1000);
  const head = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat: now - JWT_BACK_S, exp: now + JWT_LIFE_S, iss: clientId })}`;
  return `${head}.${crypto.sign('RSA-SHA256', Buffer.from(head), key).toString('base64url')}`;
}

// How long a link, and the list it holds, lives. Only the check's stand-in may shorten it (ISSUES_TEST_LINK_MS), as it does the timers.
const LINK_MS = process.env.ISSUES_TEST_STANDIN && Number(process.env.ISSUES_TEST_LINK_MS) > 0 ? Number(process.env.ISSUES_TEST_LINK_MS) : 15 * 60 * 1000;
const MAX_LINKS = 200;
const MAX_INSTALLATIONS = 20;
const MAX_REPOSITORIES = 300;
const MAX_PAGES = 3;

let config = { set: false, clientId: '', clientSecretSet: false, key: null, problem: '' };
let clientSecret = ''; // read by start() only, from the environment; used for the code exchange and the revoke, never returned
let started = false;
const info = new Map(); // adapter id -> { name, slug }: GET /app, once
const tokens = new Map(); // "<adapter>|<installation>|<repository id>|<r|w>" -> { token, expiresAt, repo }
const minting = new Map(); // the same key -> the mint under way
let brokenUntil = 0;
const rests = new Map(); // "<adapter>|<repository>" -> until (ms): a service rest shared by every environment on the host

// Reads the configuration and logs one line when something is wrong. Called once at start (and by nothing else).
function start(env = process.env, log = console.warn) {
  config = readConfig(env);
  clientSecret = config.key && typeof env[ENV_SECRET] === 'string' ? env[ENV_SECRET].trim() : '';
  started = true;
  linksById.clear(); linksByState.clear(); linksByInstall.clear();
  info.clear(); tokens.clear(); minting.clear(); rests.clear(); brokenUntil = 0;
  if (config.problem) log(config.problem);
  return configured();
}

// Whether the app is set up here (every variable given and the key readable).
const configured = () => Boolean(config.key && config.clientId && config.clientSecretSet);
const appOf = (adapter) => info.get(adapter.id) || null;
const usable = (adapter) => Boolean(adapter && typeof adapter.mintToken === 'function' && typeof adapter.appInfo === 'function');

// The sentence a person reads when the app cannot be used on this server, or '' when it can.
function refusal(now = Date.now()) {
  if (!config.set) return SAY.appOff;
  if (!configured() || now < brokenUntil) return SAY.appBroken;
  return '';
}

const keyOf = (adapter, installation, repositoryId, write) => `${adapter.id}|${installation}|${repositoryId}|${write ? 'w' : 'r'}`;
function dropToken(adapter, installation, repositoryId) {
  for (const w of [true, false]) tokens.delete(keyOf(adapter, installation, repositoryId, w));
}

// GET /app once per adapter: the app's name and slug. { ok, app } or { ok: false, kind, error, restUntil? }.
async function ensureApp(adapter, now, fetchImpl) {
  if (info.has(adapter.id)) return { ok: true, app: info.get(adapter.id) };
  const jwt = signJwt(config.key, config.clientId, now);
  let got;
  try { got = await issuesLib.writeCall(adapter, (ask) => adapter.appInfo({ jwt }, ask), { fetchImpl, now }); } catch { got = null; }
  if (!got) return { ok: false, kind: 'silent', status: 502, error: SAY.writeSilent(adapter.name) };
  if (got.ok) { info.set(adapter.id, { name: got.answer.name, slug: got.answer.slug }); return { ok: true, app: info.get(adapter.id) }; }
  if (got.unauthorized) { brokenUntil = now + BROKEN_MS; return { ok: false, kind: 'broken', status: 409, error: SAY.appBroken }; }
  return { ok: false, kind: got.restUntil ? 'limited' : 'silent', status: got.status, error: got.error, restUntil: got.restUntil };
}

// Whether the installation is suspended, from GET /app/installations/{id} (`suspended_at`).
async function suspended(adapter, installation, now, fetchImpl) {
  if (typeof adapter.installationInfo !== 'function') return false;
  const jwt = signJwt(config.key, config.clientId, now);
  const got = await issuesLib.writeCall(adapter, (ask) => adapter.installationInfo({ jwt, installation }, ask), { fetchImpl, now }).catch(() => null);
  return Boolean(got && got.ok && got.answer.suspended);
}

// An installation token for one repository: { ok: true, token, repo, repositoryId } or { ok: false, kind, status, error, restUntil? }.
// `kind`: off (no app here), broken (the key or secret is refused), gone (the app is not installed on it), paused (suspended),
// limited (GitHub asked to wait), silent (no answer). `write`: the token may change issues; else it only reads them. Reused until
// 5 minutes before it expires; a mint for the same key is shared by callers at once.
async function token(adapter, { installation, repositoryId, write = false }, { now = Date.now(), fetchImpl } = {}) {
  if (!usable(adapter)) return { ok: false, kind: 'off', status: 409, error: SAY.appOff };
  const why = refusal(now);
  if (why) return { ok: false, kind: config.set ? 'broken' : 'off', status: 409, error: why };
  const key = keyOf(adapter, installation, repositoryId, write);
  const have = tokens.get(key);
  if (have && now < have.expiresAt - REFRESH_BEFORE_MS) return { ok: true, token: have.token, repo: have.repo, repositoryId };
  if (minting.has(key)) return minting.get(key);
  const run = (async () => {
    const app = await ensureApp(adapter, now, fetchImpl);
    if (!app.ok) return app;
    const jwt = signJwt(config.key, config.clientId, now);
    const got = await issuesLib.writeCall(adapter, (ask) => adapter.mintToken({ jwt, installation, repositoryId, permissions: { issues: write ? 'write' : 'read' } }, ask), { fetchImpl, now }).catch(() => null);
    if (!got) return { ok: false, kind: 'silent', status: 502, error: SAY.writeSilent(adapter.name) };
    if (got.ok) {
      const a = got.answer;
      if (a.repositoryId !== repositoryId) return { ok: false, kind: 'gone', status: 409, error: '' };
      tokens.set(key, { token: a.token, expiresAt: a.expiresAt, repo: a.repo });
      if (tokens.size > MAX_CACHED) tokens.delete(tokens.keys().next().value);
      return { ok: true, token: a.token, repo: a.repo, repositoryId };
    }
    tokens.delete(key);
    if (got.unauthorized) { brokenUntil = now + BROKEN_MS; return { ok: false, kind: 'broken', status: 409, error: SAY.appBroken }; }
    const seen = got.served ? got.served.status : 0;
    if (seen === 404 || seen === 422) return { ok: false, kind: 'gone', status: 409, error: '' };
    // A 403 that is not a limit: GitHub's own signal for a suspended installation is `suspended_at` on the installation itself.
    if (seen === 403 && await suspended(adapter, installation, now, fetchImpl)) return { ok: false, kind: 'paused', status: 409, error: '' };
    if (got.restUntil) return { ok: false, kind: 'limited', status: got.status, error: got.error, restUntil: got.restUntil };
    return { ok: false, kind: 'silent', status: got.status, error: got.error };
  })().finally(() => minting.delete(key));
  minting.set(key, run);
  return run;
}

// --- the service's rest, shared by every environment ---------------------------------------------------------------------------

const restKey = (rec) => `${rec.provider}|${rec.via === 'app' ? `id:${rec.repositoryId}` : String(rec.repo).toLowerCase()}`;
function restSet(rec, until) {
  rests.set(restKey(rec), until);
  if (rests.size > MAX_CACHED) rests.delete(rests.keys().next().value);
}
// Milliseconds still to wait for the repository `rec` follows (0 when none).
function restLeft(rec, now = Date.now()) {
  const until = rests.get(restKey(rec)) || 0;
  if (until <= now) { rests.delete(restKey(rec)); return 0; }
  return until - now;
}

// --- the link flow (plan-github-app.md, sections 2 and 6) ------------------------------------------------------------------
// A link is made when an owner presses Connect to GitHub and lives 15 minutes, in memory only: its `state` and PKCE verifier (the
// sign-in), the environment, space and person it belongs to, and once GitHub has sent the person back, the list of repositories
// they can reach through the app. A `state` works once. The user token GitHub gives is held in a local variable for the seconds
// the lists take and revoked before the list is answered; it is never kept, logged or answered.
const linksById = new Map(); // link id -> { id, provider, slug, spaceId, person, redirectUri, verifier, state, installState, ends, list }
const linksByState = new Map(); // the sign-in's state -> link id
const linksByInstall = new Map(); // the install address's state -> link id
const random = () => crypto.randomBytes(32).toString('base64url');

function forget(link) {
  linksById.delete(link.id);
  if (link.state) linksByState.delete(link.state);
  if (link.installState) linksByInstall.delete(link.installState);
}
function sweep(now) {
  for (const l of [...linksById.values()]) if (l.ends <= now) forget(l);
  while (linksById.size > MAX_LINKS) forget(linksById.values().next().value);
}
// A fresh sign-in for the link: a new state and verifier; the GitHub authorize address.
function authorizeUrl(adapter, link) {
  if (link.state) linksByState.delete(link.state);
  link.state = random();
  link.verifier = random();
  linksByState.set(link.state, link.id);
  const u = new URL(`${adapter.webOrigin}/login/oauth/authorize`);
  u.searchParams.set('client_id', config.clientId);
  u.searchParams.set('redirect_uri', link.redirectUri);
  u.searchParams.set('state', link.state);
  u.searchParams.set('code_challenge', crypto.createHash('sha256').update(link.verifier).digest('base64url'));
  u.searchParams.set('code_challenge_method', 'S256');
  return u.href;
}

// A new link for this person in this space of this environment (an earlier one of theirs for the space is dropped). Answers the
// GitHub address to send them to.
function begin(adapter, { slug, spaceId, person, redirectUri }, now = Date.now()) {
  sweep(now);
  for (const l of [...linksById.values()]) if (l.slug === slug && l.spaceId === spaceId && l.person === person) forget(l);
  const link = { id: random(), provider: adapter.id, slug, spaceId, person, redirectUri, verifier: '', state: '', installState: '', ends: now + LINK_MS, list: null };
  linksById.set(link.id, link);
  return { url: authorizeUrl(adapter, link), id: link.id };
}
// The sign-in came back with this `state`: the link it belongs to, once (the state is used up), or null when unknown, used or ended.
function claim(state, now = Date.now()) {
  sweep(now);
  const id = typeof state === 'string' ? linksByState.get(state) : null;
  linksByState.delete(state);
  const link = id ? linksById.get(id) : null;
  if (!link) return null;
  link.state = '';
  return link;
}
// The setup address came back (after an install on GitHub) with the install address's `state`: sign the person in again for the same
// link. Answers the GitHub address, or null when the state is unknown, used or ended. The `installation_id` GitHub adds is never read.
function restart(adapterOf, installState, now = Date.now()) {
  sweep(now);
  const id = typeof installState === 'string' ? linksByInstall.get(installState) : null;
  linksByInstall.delete(installState);
  const link = id ? linksById.get(id) : null;
  const adapter = link ? adapterOf(link.provider) : null;
  if (!link || !adapter) return null;
  link.installState = '';
  link.ends = now + LINK_MS;
  return authorizeUrl(adapter, link);
}
const drop = (id) => { const l = linksById.get(id); if (l) forget(l); };

// Exchanges the code, reads the person's installations and the repositories in each, revokes the user token, and keeps the list on
// the link. { ok: true } or { ok: false, error } with a sentence for the person. The user token never leaves this function.
async function complete(adapter, link, code, { now = Date.now(), fetchImpl } = {}) {
  if (!configured() || !clientSecret || typeof adapter.exchangeCode !== 'function') return { ok: false, error: SAY.appBroken };
  const via = (call) => issuesLib.writeCall(adapter, call, { fetchImpl, now }).catch(() => null);
  const failed = { ok: false, error: SAY.linkFailed };
  const got = await via((ask) => adapter.exchangeCode({ clientId: config.clientId, clientSecret, code, redirectUri: link.redirectUri, verifier: link.verifier }, ask));
  if (!got || !got.ok) return failed;
  let userToken = got.answer.userToken;
  try {
    const found = [];
    let more = false;
    const installations = [];
    let raw = 0;
    for (let page = 1; page <= MAX_PAGES && installations.length <= MAX_INSTALLATIONS; page += 1) {
      const r = await via((ask) => adapter.userInstallations({ userToken, page }, ask));
      if (!r || !r.ok) return failed;
      raw += r.answer.installations.length;
      installations.push(...r.answer.installations.filter((i) => !i.suspended));
      if (raw >= r.answer.total || !r.answer.installations.length) break;
      if (page === MAX_PAGES) more = true;
    }
    if (installations.length > MAX_INSTALLATIONS) { installations.length = MAX_INSTALLATIONS; more = true; }
    for (const inst of installations) {
      for (let page = 1; page <= MAX_PAGES && found.length < MAX_REPOSITORIES; page += 1) {
        const r = await via((ask) => adapter.userRepositories({ userToken, installation: inst.id, page }, ask));
        if (!r || !r.ok) return failed;
        for (const repo of r.answer.repositories) if (!found.some((f) => f.repositoryId === repo.id)) found.push({ repositoryId: repo.id, repo: repo.repo, private: repo.private, installation: inst.id, canWrite: repo.canWrite, created: repo.created });
        if ((page - 1) * 100 + r.answer.repositories.length >= r.answer.total || !r.answer.repositories.length) break;
        if (page === MAX_PAGES) more = true;
      }
      if (found.length >= MAX_REPOSITORIES) { found.length = MAX_REPOSITORIES; more = true; break; }
    }
    found.sort((a, b) => (b.created < a.created ? -1 : b.created > a.created ? 1 : b.repositoryId - a.repositoryId));
    link.list = { repositories: found.map(({ created, ...r }) => r), more };
  } finally {
    // The person's own token is no longer needed: revoked whatever happened above, before anything is answered.
    const ask = issuesLib.getter(adapter, { fetchImpl }).ask;
    let revoked = null;
    try { revoked = await adapter.revokeUserToken({ clientId: config.clientId, clientSecret, userToken }, ask); } catch { revoked = null; }
    userToken = '';
    if (!revoked || revoked.status !== 204) console.warn('GitHub did not confirm that a sign-in token was revoked; it expires on its own.');
  }
  link.installState = random();
  linksByInstall.set(link.installState, link.id);
  link.ends = now + LINK_MS;
  return { ok: true };
}
// The link `id` for this person, space and environment, with its list, inside its 15 minutes; else null.
function linkFor(id, { slug, spaceId, person }, now = Date.now()) {
  sweep(now);
  const link = typeof id === 'string' ? linksById.get(id) : null;
  return link && link.list && link.slug === slug && link.spaceId === spaceId && link.person === person ? link : null;
}
// The address to install the app on GitHub, carrying the link's own state (the page shows it beside the list).
const installUrl = (adapter, link) => {
  const a = appOf(adapter);
  return a && link.installState ? `${adapter.webOrigin}/apps/${encodeURIComponent(a.slug)}/installations/new?state=${encodeURIComponent(link.installState)}` : '';
};
// What the Service terms section shows the administrator: { state: 'off' | 'broken' | 'working' | 'unchecked', name, slug }.
function status(adapter) {
  const a = adapter ? appOf(adapter) : null;
  if (!config.set) return { state: 'off', name: '', slug: '' };
  if (refusal()) return { state: 'broken', name: '', slug: '' };
  return a ? { state: 'working', name: a.name, slug: a.slug } : { state: 'unchecked', name: '', slug: '' };
}

module.exports = {
  begin, claim, restart, drop, complete, linkFor, installUrl, status, LINK_MS,
  start, readConfig, signJwt, token, dropToken, refusal, configured, appOf, ensureApp, restSet, restLeft,
  isStarted: () => started, REFRESH_BEFORE_MS,
};
