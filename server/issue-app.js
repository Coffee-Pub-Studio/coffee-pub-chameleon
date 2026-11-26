// The GitHub app's credentials and installation tokens (documentation/plans/plan-github-app.md, sections 4 and 5; step 1: no link
// flow yet). Chameleon is registered once as a GitHub App; a space linked through it (record `via: 'app'`) is read and written
// with an installation token narrowed to its one repository, instead of any token set on the server.
//
// Configuration, environment variables read once at start (the host's, shared by every environment):
//   ISSUES_GITHUB_APP_CLIENT_ID      the app's client ID: the JWT's `iss`
//   ISSUES_GITHUB_APP_CLIENT_SECRET  needed for the link flow (step 2); without it the app is off
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
// `problem`: one line for the log (never a value), or ''. `key` is a crypto KeyObject or null; the secret is not kept at all in step 1.
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

let config = { set: false, clientId: '', clientSecretSet: false, key: null, problem: '' };
let started = false;
const info = new Map(); // adapter id -> { name, slug }: GET /app, once
const tokens = new Map(); // "<adapter>|<installation>|<repository id>|<r|w>" -> { token, expiresAt, repo }
const minting = new Map(); // the same key -> the mint under way
let brokenUntil = 0;
const rests = new Map(); // "<adapter>|<repository>" -> until (ms): a service rest shared by every environment on the host

// Reads the configuration and logs one line when something is wrong. Called once at start (and by nothing else).
function start(env = process.env, log = console.warn) {
  config = readConfig(env);
  started = true;
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
    if (got.served && got.served.suspended) return { ok: false, kind: 'paused', status: 409, error: '' };
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

module.exports = {
  start, readConfig, signJwt, token, dropToken, refusal, configured, appOf, ensureApp, restSet, restLeft,
  isStarted: () => started, REFRESH_BEFORE_MS,
};
