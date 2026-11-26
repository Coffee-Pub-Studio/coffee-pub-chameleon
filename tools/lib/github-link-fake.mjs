/*
 * The sign-in and list half of a fake GitHub, for the checks that link a space through the app
 * (documentation/plans/plan-github-app.md, step 2): check-issues.mjs and check-schedule-fields.mjs. It serves, on the check's fake
 * origin (the test stand-in's `origin` and `webOrigin` are the same):
 *
 *   GET    /login/oauth/authorize              answers a 302 to `redirect_uri` with a fresh `code` and the `state` it was given (or
 *                                              `error=access_denied` when `state.deny` is set): the person's click on GitHub
 *   POST   /login/oauth/access_token           checks the client id, the client secret, the code (once), the redirect address and the
 *                                              PKCE verifier against the challenge; answers an expiring user token and a refresh token
 *   GET    /user/installations                 with the user token, until revoked: the installations `state.person` reaches
 *   GET    /user/installations/:id/repositories  the repositories in one, each with the person's `permissions`
 *   DELETE /applications/:client_id/token      Basic auth with the client id and secret, the token in the body: revokes it (204)
 *
 * `state.person.installations` is what the signed-in GitHub account reaches: [{ id, suspended_at?, repositories: [{ id, full_name,
 * private, permissions, created_at }] }]. Every request is kept in `state.requests` (the bearer or basic credential is kept apart in
 * `secrets`, so a check can look for each in the outputs). Nothing here is written to disk and the secrets are the check's own.
 */
import crypto from 'node:crypto';

export function linkFake({ clientId, clientSecret }) {
  const state = {
    person: { installations: [] },
    deny: false, // the person refuses on GitHub
    breakLists: false, // the installations list answers 500
    verifiers: [], // every PKCE verifier an exchange carried
    requests: [], // { method, path, query, body } for each
    revoked: [], // user tokens revoked, in order
    tokens: new Map(), // user token -> { revoked }
    codes: new Map(), // code -> { challenge, redirectUri, used }
    issuedCodes: [], issuedTokens: [], refreshTokens: [],
    authorizes: [], // what each authorize request carried: { clientId, state, challenge, method, redirectUri }
    exchanges: [], // what each exchange carried, with the secret masked: { clientId, secretOk, verifierOk, redirectUri }
  };
  const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const bearer = (req) => (/^Bearer (.+)$/.exec(req.headers.authorization || '') || [])[1] || '';
  const page = (list, u) => { const per = Number(u.searchParams.get('per_page') || 30); const n = Number(u.searchParams.get('page') || 1); return list.slice((n - 1) * per, n * per); };
  const MINE = /^\/(login\/oauth\/(authorize|access_token)|user\/installations(\/\d+\/repositories)?|applications\/[^/]+\/token)$/;

  // Answers true when the request is one of the sign-in's, and then answers it (after reading its body).
  function handle(req, res) {
    const u = new URL(req.url, 'http://x');
    if (!MINE.test(u.pathname)) return false;
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = null;
      try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null; } catch { body = '(not json)'; }
      state.requests.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body });
      respond(req, res, u, body);
    });
    return true;
  }

  function respond(req, res, u, body) {
    if (req.method === 'GET' && u.pathname === '/login/oauth/authorize') {
      const q = u.searchParams;
      const redirectUri = q.get('redirect_uri') || '';
      state.authorizes.push({ clientId: q.get('client_id'), state: q.get('state'), challenge: q.get('code_challenge'), method: q.get('code_challenge_method'), redirectUri });
      if (q.get('client_id') !== clientId || !redirectUri) return json(res, 404, { message: 'Not Found' });
      const back = new URL(redirectUri);
      if (state.deny) { back.searchParams.set('error', 'access_denied'); back.searchParams.set('state', q.get('state') || ''); }
      else {
        const code = crypto.randomBytes(10).toString('hex');
        state.issuedCodes.push(code);
        state.codes.set(code, { challenge: q.get('code_challenge'), redirectUri, used: false });
        back.searchParams.set('code', code);
        back.searchParams.set('state', q.get('state') || '');
      }
      res.writeHead(302, { location: back.href });
      return res.end();
    }
    if (req.method === 'POST' && u.pathname === '/login/oauth/access_token') {
      const b = body && typeof body === 'object' ? body : {};
      const c = state.codes.get(b.code);
      const verifierOk = Boolean(c && typeof b.code_verifier === 'string' && crypto.createHash('sha256').update(b.code_verifier).digest('base64url') === c.challenge);
      if (typeof b.code_verifier === 'string') state.verifiers.push(b.code_verifier);
      state.exchanges.push({ clientId: b.client_id, secretOk: b.client_secret === clientSecret, verifierOk, redirectUri: b.redirect_uri, hadCode: Boolean(c) });
      if (b.client_id !== clientId || b.client_secret !== clientSecret) return json(res, 200, { error: 'incorrect_client_credentials' });
      if (!c || c.used) return json(res, 200, { error: 'bad_verification_code' });
      if (b.redirect_uri !== c.redirectUri) return json(res, 200, { error: 'redirect_uri_mismatch' });
      if (!verifierOk) return json(res, 200, { error: 'bad_verification_code' });
      c.used = true;
      const token = `ghu_${crypto.randomBytes(18).toString('hex')}`;
      const refresh = `ghr_${crypto.randomBytes(18).toString('hex')}`;
      state.tokens.set(token, { revoked: false });
      state.issuedTokens.push(token);
      state.refreshTokens.push(refresh);
      return json(res, 200, { access_token: token, expires_in: 28800, refresh_token: refresh, refresh_token_expires_in: 15897600, token_type: 'bearer', scope: '' });
    }
    if (req.method === 'DELETE') {
      const m = /^\/applications\/([^/]+)\/token$/.exec(u.pathname);
      const basic = (/^Basic (.+)$/.exec(req.headers.authorization || '') || [])[1] || '';
      if (!m || Buffer.from(basic, 'base64').toString('utf8') !== `${clientId}:${clientSecret}` || decodeURIComponent(m[1]) !== clientId) return json(res, 401, { message: 'Bad credentials' });
      const t = body && typeof body === 'object' ? state.tokens.get(body.access_token) : null;
      if (!t) return json(res, 404, { message: 'Not Found' });
      t.revoked = true;
      state.revoked.push(body.access_token);
      res.writeHead(204);
      return res.end();
    }
    const t = state.tokens.get(bearer(req));
    if (req.method !== 'GET' || !t || t.revoked) return json(res, 401, { message: 'Bad credentials' });
    if (u.pathname === '/user/installations') {
      if (state.breakLists) return json(res, 500, { message: 'Server Error' });
      const all = state.person.installations.map((i) => ({ id: i.id, suspended_at: i.suspended_at || null, account: { login: 'someone' } }));
      return json(res, 200, { total_count: all.length, installations: page(all, u) });
    }
    const m = /^\/user\/installations\/(\d+)\/repositories$/.exec(u.pathname);
    const inst = m ? state.person.installations.find((i) => i.id === Number(m[1])) : null;
    if (!inst) return json(res, 404, { message: 'Not Found' });
    return json(res, 200, { total_count: inst.repositories.length, repository_selection: 'selected', repositories: page(inst.repositories, u) });
  }

  // The secrets a check looks for in every answer, log and file (the credentials of what happened so far).
  const secrets = () => ({ 'the client secret': clientSecret, ...Object.fromEntries(state.issuedTokens.map((t, i) => [`a user token (${i})`, t])), ...Object.fromEntries(state.refreshTokens.map((t, i) => [`a refresh token (${i})`, t])), ...Object.fromEntries(state.issuedCodes.map((t, i) => [`a code (${i})`, t])), ...Object.fromEntries(state.verifiers.map((t, i) => [`a verifier (${i})`, t])) });
  return { handle, state, secrets };
}

// One whole link through the real routes, as a person and GitHub would do it. `call(method, path, body)` is the signed-in owner's
// request; the GitHub steps are plain requests (no session). Answers { start } and, as far as it got, { authorize, back, link, list }.
export async function linkThrough({ call, space, provider = 'issues-standin', before = {} }) {
  const out = { start: await call('POST', `/api/spaces/${space}/issues-link`, { provider }) };
  if (out.start.status !== 200) return out;
  out.authorizeUrl = out.start.json.url;
  out.authorize = await fetch(out.authorizeUrl, { redirect: 'manual' }); // GitHub: the person authorizes and is sent back
  await out.authorize.arrayBuffer();
  out.backUrl = out.authorize.headers.get('location');
  if (!out.backUrl) return out;
  out.back = await fetch(out.backUrl, { redirect: 'manual', ...before });
  out.backText = await out.back.text();
  const to = out.back.headers.get('location');
  out.to = to ? new URL(to, out.backUrl) : null;
  out.link = out.to ? out.to.searchParams.get('link') : null;
  out.done = out.to ? out.to.searchParams.get('done') : null; // the completion secret: in the redirect to this browser only
  if (!out.link) return out;
  doneOf.set(out.link, out.done);
  out.list = await call('GET', `/api/spaces/${space}/issues-link?link=${encodeURIComponent(out.link)}&done=${encodeURIComponent(out.done)}`);
  return out;
}

// The completion secret each link was returned with (what the browser that came back from GitHub holds), by link id.
export const doneOf = new Map();
// Follows one repository of a link's list: PUT /api/spaces/:id/issues-pull with { on: true, link, done, repositoryId }. `done` is the
// link's own completion secret unless given (null leaves it out).
export const followFrom = ({ call, space, provider = 'issues-standin', link, done = doneOf.get(link), repositoryId, extra = {} }) =>
  call('PUT', `/api/spaces/${space}/issues-pull`, { on: true, provider, link, ...(done === null ? {} : { done }), repositoryId, ...extra });
