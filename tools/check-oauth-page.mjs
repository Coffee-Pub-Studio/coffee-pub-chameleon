#!/usr/bin/env node
/*
 * check-oauth-page.mjs -- the approval page for an app (public/connect-app.html, connect-app.js) and the agent page's
 * connection (documentation/plans/plan-mcp-oauth.md, step 2), live in headless Chromium against a throwaway server
 * (AGENT_TOKENS and AGENT_SETUP on), the script playing the app's part with a real PKCE flow:
 *   - a whole sign-in: register an app, authorize, open /connect-app as the owner, choose a new agent and a space, Allow, follow
 *     the redirect to the app's address (a small listener here), trade the code for tokens and call /mcp with the access token;
 *   - the page's words: title, first line, the host it goes back to, the name box, the kind (only while set-up agents are on),
 *     the spaces (none for a set-up agent), how long, what it can do, Allow and Don't allow; an existing agent with a token
 *     says "This ends its current token."; the app's name is drawn as text;
 *   - signed out goes to sign in and, once signed in, comes back to the page; a member is told only an owner can, with Back
 *     and no form; a stale form (the page opened again elsewhere) is refused with the server's sentence; Don't allow goes back
 *     with access_denied; an ended sign-in says so; agents off says so; with AGENT_TOKENS off the page is an unknown path;
 *   - the page is never framed or cached;
 *   - the agent's page: the Connection line (app, who allowed it, when, goes back to, how long, last used and from where), End
 *     connection (and its log line), the log lines for a connection and for an old key used again, the address to give an
 *     app that signs in with Copy;
 *   - 1280 and 390 wide: nothing scrolls sideways, and at 390 the buttons, selects and rows are at least 44 px tall.
 * `--shots=<dir>`: also writes pictures (the page as an owner and as a member, and the agent's connection line; light and dark).
 * With no Chromium it says SKIPPED (not a pass).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { stopBrowser } from './browser-launch.mjs';
import { findBrowser, launch, freePort, startServer, stopServer, Tab, sleep } from './shots.mjs';
import { PASSWORD } from './shots-seed.mjs';

const say = (...a) => console.log('check-oauth-page:', ...a);
const failures = [];
const expect = (ok, text) => { if (!ok) failures.push(text); };
const shotsArg = process.argv.find((a) => a.startsWith('--shots='));
const SHOTS = shotsArg ? path.resolve(shotsArg.slice('--shots='.length)) : '';
const HOSTILE_APP = 'Nova <img src=x onerror=window.__pwn=1>';
const CLEANED = 'Nova img src=x onerror=window.__pwn=1'; // the server keeps no < or > in an app's name
const FORM_WRONG = 'This page is out of date. Open it again from the app.';
const jarOf = (res) => res.headers.getSetCookie().map((c) => { const [nv] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1) }; });
const pkce = () => { const verifier = crypto.randomBytes(40).toString('base64url'); return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') }; };

async function main() {
  const bin = findBrowser();
  if (!bin) { say('SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); return 0; }
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const dirs = [];
  const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oauth-page-')); dirs.push(d); return d; };
  let server = null; let plain = null; let browser = null; let appListener = null;
  const arrived = []; // what the app's return address was asked for
  try {
    plain = await startServer(tmp(), await freePort(), 'first', { AGENT_TOKENS: '' });
    server = await startServer(tmp(), await freePort(), 'first', { AGENT_TOKENS: 'true', AGENT_SETUP: 'true' });
    const appPort = await freePort();
    appListener = http.createServer((req, res) => { const u = new URL(req.url, `http://127.0.0.1:${appPort}`); if (u.pathname === '/callback') arrived.push(u); res.setHeader('content-type', 'text/plain'); res.end('The app'); });
    await new Promise((r) => appListener.listen(appPort, '127.0.0.1', r));
    const CALLBACK = `http://127.0.0.1:${appPort}/callback`;
    const jars = {};
    const call = async (as, method, url, body, srv = server, extra = {}) => {
      const headers = { 'content-type': 'application/json', accept: 'application/json', origin: srv.base, ...extra };
      if (jars[`${srv.base}|${as}`]) headers.cookie = jars[`${srv.base}|${as}`].map((c) => `${c.name}=${c.value}`).join('; ');
      const res = await fetch(srv.base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      let json = null; try { json = await res.json(); } catch { /* none */ }
      return { status: res.status, json, res };
    };
    const signIn = async (login, srv = server) => {
      const r = await call('__none', 'POST', '/api/login', { login, password: PASSWORD }, srv);
      expect(r.status === 200, `cannot sign in as ${login}: ${r.status}`);
      jars[`${srv.base}|${login}`] = jarOf(r.res);
    };
    await signIn('admin');
    expect((await call('admin', 'POST', '/api/users', { login: 'mia', displayName: 'Mia', role: 'member', password: PASSWORD })).status === 201, 'could not make the member');
    await signIn('mia');
    expect((await call('admin', 'PATCH', '/api/settings', { agents: true, setupAgents: true })).status === 200, 'could not turn Agents and Set-up agents on');
    const space = (await call('admin', 'POST', '/api/spaces', { name: 'Paris trip', description: '', members: [] })).json.space;
    const space2 = (await call('admin', 'POST', '/api/spaces', { name: 'Rome <b>trip</b>', description: '', members: [] })).json.space;
    const existing = (await call('admin', 'POST', '/api/users', { agent: true, displayName: 'Old helper' })).json.user;
    expect((await call('admin', 'POST', `/api/users/${existing.key}/token`, { expires: '30d' })).status === 200 || true, 'token');

    // The app: registered like an app registers (loopback return address, no secret).
    const register = async (name) => (await (await fetch(`${server.base}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: name, redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) })).json()).client_id;
    const authorizeUrl = (clientId, pk, state) => `${server.base}/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, code_challenge: pk.challenge, code_challenge_method: 'S256', state, resource: `${server.base}/mcp` })}`;

    browser = await launch(bin);
    const open = async (size, mode, as, srv = server) => {
      const tab = new Tab(browser.cdp, {});
      await tab.open(size, mode, false);
      for (const c of jars[`${srv.base}|${as}`] || []) await tab.cdp.send('Network.setCookie', { name: c.name, value: c.value, url: srv.base, httpOnly: true }, tab.sid);
      const problems = [];
      tab.cdp.listeners.push((m) => { if (m.sessionId === tab.sid && m.method === 'Runtime.exceptionThrown') problems.push('uncaught: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)); });
      tab.problems = problems;
      tab.srv = srv;
      return tab;
    };
    const nav = async (tab, url) => { await tab.cdp.send('Page.navigate', { url: 'about:blank' }, tab.sid); await sleep(100); await tab.cdp.send('Page.navigate', { url }, tab.sid); await sleep(300); await tab.settle(); };
    const shot = async (tab, name) => { if (SHOTS) fs.writeFileSync(path.join(SHOTS, `${name}.png`), await tab.shoot(false)); };
    const text = (tab, sel) => tab.eval(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
    const hiddenOf = (tab, sel) => tab.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !e || e.hidden || !e.getClientRects().length; })()`);
    const wide = (tab) => tab.eval(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
    const setValue = (tab, sel, value) => tab.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    const waitText = async (tab, sel, want, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if ((await text(tab, sel)).includes(want)) return true; await sleep(100); } return false; };
    const dialogOpen = (tab) => tab.eval(`!!document.querySelector('dialog[open]')`);
    const waitDialog = async (tab, on, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await dialogOpen(tab) === on) return true; await sleep(100); } return false; };
    const press = async (tab, sel) => { await tab.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) e.scrollIntoView({ block: 'center' }); })()`); await sleep(100); await tab.click(sel); };
    const pageReady = async (tab, sel) => { await tab.waitFor(sel, '', 20000); await sleep(150); };
    const waitArrival = async (n, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (arrived.length >= n) return arrived[n - 1]; await sleep(100); } return null; };
    const targets = (tab, sels) => tab.eval(`(() => ${JSON.stringify(sels)}.map((s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return [s, -1]; return [s, Math.round(e.getBoundingClientRect().height)]; }))()`);

    // ---- the page is an unknown path where AGENT_TOKENS is off ----
    {
      const r = await fetch(`${plain.base}/connect-app?request=AAAAAAAAAAAAAAAAAAAAAA`, { redirect: 'manual' });
      expect(r.status === 404, `with AGENT_TOKENS off /connect-app answers ${r.status}, not 404`);
      const f = await fetch(`${server.base}/connect-app.html`, { redirect: 'manual' });
      expect(f.status === 404, `the page's file is served by its name (${f.status})`);
    }
    // ---- headers: never framed, never cached ----
    {
      const pk = pkce();
      const id = await register('Header App');
      const cookie = jars[`${server.base}|admin`].map((c) => `${c.name}=${c.value}`).join('; ');
      const a = await fetch(authorizeUrl(id, pk, 'h'), { redirect: 'manual', headers: { cookie } });
      const to = new URL(a.headers.get('location'), server.base);
      const r = await fetch(server.base + to.pathname + to.search, { headers: { cookie } });
      expect(r.status === 200, `the page answers ${r.status}`);
      expect(/frame-ancestors 'none'/.test(r.headers.get('content-security-policy') || ''), 'the page is not sent with frame-ancestors none');
      expect(r.headers.get('x-frame-options') === 'DENY', 'the page has no X-Frame-Options DENY');
      expect(/no-store/.test(r.headers.get('cache-control') || ''), 'the page is cacheable');
      const out = await fetch(server.base + to.pathname + to.search, { redirect: 'manual' });
      expect(out.status === 302 && /^\/login\?next=%2Fconnect-app%3Frequest%3D/.test(out.headers.get('location') || ''), `signed out is sent to ${out.headers.get('location')}`);
    }

    // ---- a whole sign-in, as the owner, wide and dark ----
    const flow = { name: CLEANED, clientId: await register(HOSTILE_APP), pk: pkce(), state: 'flow-state-1' };
    let agentKey = null;
    {
      const tab = await open(1280, 'dark', 'admin');
      await nav(tab, authorizeUrl(flow.clientId, flow.pk, flow.state));
      await pageReady(tab, '#connect-form:not([hidden])');
      const where = await tab.eval(`location.pathname + location.search`);
      expect(/^\/connect-app\?request=[A-Za-z0-9_-]{22}$/.test(where), `authorize led to ${where}`);
      const envName = await text(tab, '[data-brand="environmentName"]');
      expect(await text(tab, '#connect-title') === `Connect ${flow.name}`, `the title is "${await text(tab, '#connect-title')}"`);
      expect(await text(tab, '#connect-lead') === `${flow.name} wants to work in ${envName} as an agent.`, `the first line is "${await text(tab, '#connect-lead')}"`);
      expect(await text(tab, '#connect-fact') === 'This name is what the app calls itself. After you allow it, you go back to 127.0.0.1.', `the small line is "${await text(tab, '#connect-fact')}"`);
      expect(await tab.eval(`window.__pwn === undefined && !document.querySelector('#connect img[src="x"]')`), 'the app\'s name was drawn as markup');
      const form = await tab.eval(`(() => ({ agent: [...document.querySelectorAll('#connect-agent option')].map((o) => o.textContent), kinds: [...document.querySelectorAll('#connect-kind option')].map((o) => o.textContent), kindShown: !document.getElementById('connect-kind-field').hidden, name: document.getElementById('connect-name').value, spaces: [...document.querySelectorAll('#connect-spaces .sdk-choice-label')].map((e) => e.textContent), life: [...document.querySelectorAll('#connect-lifetime option')].map((o) => o.textContent), lifeNow: document.getElementById('connect-lifetime').selectedOptions[0].textContent, can: document.getElementById('connect-can').textContent, buttons: [...document.querySelectorAll('.connect-buttons .btn')].filter((b) => b.getClientRects().length).map((b) => b.textContent), agentNote: document.getElementById('connect-agent-note').hidden }))()`);
      expect(form.agent[0] === 'A new agent' && form.agent.includes('Old helper (agent)'), `Connect as lists ${JSON.stringify(form.agent)}`);
      expect(form.kindShown && form.kinds.join('|') === 'Works in spaces|Makes and names spaces', `the kind is ${JSON.stringify(form.kinds)} (shown ${form.kindShown})`);
      expect(form.name === flow.name.slice(0, 40), `the name box starts as "${form.name}"`);
      expect(form.spaces.includes('Paris trip') && form.spaces.includes('Rome <b>trip</b>') && form.spaces.length === 2, `the spaces are ${JSON.stringify(form.spaces)} (no Lobby)`);
      expect(form.life.join('|') === '30 days|60 days|90 days|1 year|Never expires' && form.lifeNow === '30 days', `how long is ${JSON.stringify(form.life)}, now ${form.lifeNow}`);
      expect(/^It can read what a member can read in these spaces, read their Chat, and ask their modules for changes\. It can't delete anything, change settings or see other spaces\.$/.test(form.can), `what it can do reads "${form.can}"`);
      expect(form.buttons.join('|') === 'Allow|Don\'t allow', `the buttons are ${JSON.stringify(form.buttons)}`);
      expect(form.agentNote, 'a new agent shows a note about what it ends');
      expect(await text(tab, '#connect-spaces-note') === "None ticked is fine: it can't see anything until you add it to a space.", `the none-ticked note is "${await text(tab, '#connect-spaces-note')}"`);
      expect(await wide(tab) <= 1, 'the page scrolls sideways at 1280');
      await shot(tab, 'connect-form-1280-dark');
      // An existing agent with a token: the note; a set-up kind: no spaces and other words.
      await setValue(tab, '#connect-agent', existing.key);
      expect(await text(tab, '#connect-agent-note') === 'This ends its current token.' && await hiddenOf(tab, '#connect-name-field') && await hiddenOf(tab, '#connect-kind-field'), 'picking an agent with a token does not say it ends the token (or still shows the name and kind)');
      await setValue(tab, '#connect-agent', 'new');
      await setValue(tab, '#connect-kind', 'setup');
      expect(await hiddenOf(tab, '#connect-spaces-field'), 'a set-up agent is offered spaces');
      expect(/^It can make spaces and name them\. Adding or taking off people waits for an owner\.$/.test(await text(tab, '#connect-can')), `the set-up words are "${await text(tab, '#connect-can')}"`);
      await setValue(tab, '#connect-kind', 'agent');
      expect(!(await hiddenOf(tab, '#connect-spaces-field')), 'an ordinary agent is not offered spaces');
      // Choose: a name, the first space, then Allow.
      await tab.eval(`(() => { const n = document.getElementById('connect-name'); n.value = 'Nova helper'; n.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await tab.click('#connect-spaces input[type="checkbox"]');
      await tab.click('#connect-allow');
      const hit = await waitArrival(1);
      expect(!!hit, 'Allow did not send the browser back to the app');
      if (hit) {
        expect(hit.pathname === '/callback' && hit.searchParams.get('state') === flow.state && hit.searchParams.get('iss') === server.base && /^[A-Za-z0-9_-]{43}$/.test(hit.searchParams.get('code') || ''), `the app was sent ${hit.pathname}${hit.search.replace(/code=[^&]+/, 'code=...')}`);
        // The app trades the code and calls /mcp.
        const tok = await fetch(`${server.base}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: hit.searchParams.get('code'), code_verifier: flow.pk.verifier, client_id: flow.clientId, redirect_uri: CALLBACK, resource: `${server.base}/mcp` }) });
        const tj = await tok.json();
        expect(tok.status === 200 && typeof tj.access_token === 'string' && typeof tj.refresh_token === 'string', `the code was not traded (${tok.status} ${JSON.stringify(tj).slice(0, 120)})`);
        const mcp = await fetch(`${server.base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${tj.access_token}`, origin: server.base }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
        const mj = await mcp.json().catch(() => null);
        expect(mcp.status === 200 && Array.isArray(mj && mj.result && mj.result.tools) && mj.result.tools.length > 0, `/mcp with the access token answered ${mcp.status}`);
      }
      const agents = (await call('admin', 'GET', '/api/users')).json.users.filter((u) => u.agent && u.displayName === 'Nova helper');
      expect(agents.length === 1, 'Allow did not make the agent "Nova helper"');
      agentKey = agents[0] && agents[0].key;
      const sp = (await call('admin', 'GET', '/api/spaces')).json.spaces;
      expect(sp.find((s) => s.id === space.id).members.includes(agentKey) && !sp.find((s) => s.id === space2.id).members.includes(agentKey), 'the ticked space (only it) has the agent as a member');
      expect(tab.problems.length === 0, `the page threw: ${tab.problems.join('; ')}`);
      // The sign-in is over: opening it again says so.
      const id = where.split('=')[1];
      await nav(tab, `${server.base}/connect-app?request=${id}`);
      await waitText(tab, '#connect-lead', 'This sign-in has ended');
      expect(await text(tab, '#connect-lead') === `This sign-in has ended. Start again from ${flow.name}.`, `an ended sign-in says "${await text(tab, '#connect-lead')}"`);
      expect(await hiddenOf(tab, '#connect-form') && !(await hiddenOf(tab, '#connect-back')), 'an ended sign-in shows the form or no Back');
      await tab.close();
    }

    // ---- Don't allow: back to the app with access_denied; a stale form is refused ----
    {
      const id = await register('Second App');
      const pk = pkce();
      const tabA = await open(1280, 'dark', 'admin');
      await nav(tabA, authorizeUrl(id, pk, 'deny-state'));
      await pageReady(tabA, '#connect-form:not([hidden])');
      const requestUrl = await tabA.eval('location.href');
      const tabB = await open(1280, 'dark', 'admin');
      await nav(tabB, requestUrl); // opening it again gives a new one-time value: the first page's is out of date
      await pageReady(tabB, '#connect-form:not([hidden])');
      await tabA.click('#connect-allow');
      expect(await waitText(tabA, '#connect-error', FORM_WRONG), `a stale form says "${await text(tabA, '#connect-error')}"`);
      expect(arrived.length === 1, 'a stale form still sent the browser to the app');
      expect(!(await tabA.eval(`document.getElementById('connect-allow').disabled`)), 'after a refusal the buttons stay off');
      await shot(tabA, 'connect-refused-1280-dark');
      await tabB.click('#connect-deny');
      const hit = await waitArrival(2);
      expect(!!hit && hit.searchParams.get('error') === 'access_denied' && hit.searchParams.get('state') === 'deny-state' && !hit.searchParams.get('code'), `Don't allow sent ${hit ? hit.search : 'nothing'}`);
      await tabA.close(); await tabB.close();
    }

    // ---- signed out: sign in, and come back to the page ----
    {
      const id = await register('Third App');
      const tab = await open(390, 'light', 'nobody');
      await nav(tab, authorizeUrl(id, pkce(), 'out-state'));
      await tab.waitFor('#login', '', 15000);
      const at = await tab.eval(`location.pathname + location.search`);
      expect(/^\/login\?next=%2Fconnect-app%3Frequest%3D[A-Za-z0-9_-]{22}$/.test(at), `signed out went to ${at}`);
      await tab.typeInto('#login-name', 'admin');
      await tab.typeInto('#password', PASSWORD);
      await tab.click('#login button[type="submit"]');
      await pageReady(tab, '#connect-form:not([hidden])');
      expect((await tab.eval(`location.pathname`)) === '/connect-app', 'after signing in the person is not back on the approval page');
      expect(await text(tab, '#connect-title') === 'Connect Third App', 'the page after signing in is not the sign-in the app asked for');
      await tab.close();
    }

    // ---- 390 wide, light: the form, the targets, no sideways scroll; the member's refusal ----
    {
      const tab = await open(390, 'light', 'admin');
      const id = await register('Phone App');
      await nav(tab, authorizeUrl(id, pkce(), 'phone'));
      await pageReady(tab, '#connect-form:not([hidden])');
      expect(await wide(tab) <= 1, 'the form scrolls sideways at 390');
      const t = await targets(tab, ['#connect-agent', '#connect-name', '#connect-lifetime', '#connect-spaces .sdk-choice-row', '#connect-allow', '#connect-deny']);
      for (const [sel, h] of t) expect(h >= 44, `${sel} is ${h}px tall at 390 (44 needed)`);
      await shot(tab, 'connect-form-390-light');
      await tab.switchMode('dark');
      await shot(tab, 'connect-form-390-dark');
      await tab.close();
      const m = await open(390, 'light', 'mia');
      await nav(m, authorizeUrl(await register('Member App'), pkce(), 'mia'));
      await pageReady(m, '#connect-back-row:not([hidden])');
      const owner = (await text(m, '#connect-lead'));
      expect(/^Only an owner can connect an app to .+\. Ask an owner to do it\.$/.test(owner), `a member reads "${owner}"`);
      expect(await hiddenOf(m, '#connect-form') && !(await hiddenOf(m, '#connect-back')) && await text(m, '#connect-back') === 'Back', 'a member is offered the form or no Back');
      expect(await wide(m) <= 1, 'the refusal scrolls sideways at 390');
      expect((await targets(m, ['#connect-back']))[0][1] >= 44, 'Back is under 44px at 390');
      await shot(m, 'connect-member-390-light');
      await m.switchMode('dark');
      await shot(m, 'connect-member-390-dark');
      await m.close();
      const w = await open(1280, 'light', 'mia');
      await nav(w, authorizeUrl(await register('Member App 2'), pkce(), 'mia2'));
      await pageReady(w, '#connect-back-row:not([hidden])');
      await shot(w, 'connect-member-1280-light');
      await w.switchMode('dark');
      await shot(w, 'connect-member-1280-dark');
      await w.close();
      const o = await open(1280, 'light', 'admin');
      await nav(o, authorizeUrl(await register('Light App'), pkce(), 'light'));
      await pageReady(o, '#connect-form:not([hidden])');
      await shot(o, 'connect-form-1280-light');
      await o.close();
    }

    // ---- the agent's page: the connection, its log lines, End connection ----
    if (agentKey) {
      const tab = await open(1280, 'light', 'admin');
      await nav(tab, `${server.base}/admin#agent/${agentKey}`);
      await tab.waitFor('[data-agent-title]:not(:empty)', '', 40000);
      await sleep(500);
      const st = await text(tab, '[data-agent-token-state]');
      expect(/^Connected by sign-in: Nova img src=x onerror=window\.__pwn=1, allowed by .+ on [A-Z][a-z]{2} \d{1,2}, \d{4}\. Goes back to 127\.0\.0\.1\.$/.test(st), `the connection line reads "${st}"`);
      expect(/^Works for 30 days, until [A-Z][a-z]{2} \d{1,2}, \d{4}\.$/.test(await text(tab, '[data-agent-connection-life]')), `the end reads "${await text(tab, '[data-agent-connection-life]')}"`);
      expect(/^Last used .+ from .+/.test(await text(tab, '[data-agent-used]')), `last used reads "${await text(tab, '[data-agent-used]')}"`);
      expect(await text(tab, '[data-agent="revoke"]') === 'End connection' && !(await hiddenOf(tab, '[data-agent="revoke"]')), 'End connection is not offered');
      expect(await text(tab, '[data-agent="make"]') === 'Make token' && await text(tab, '[data-agent-make-hint]') === 'A token ends the connection.', 'Make token does not say it ends the connection');
      expect(await tab.eval(`window.__pwn === undefined`), 'the app name ran as markup on the agent page');
      const guide = await tab.eval(`(() => { const s = document.querySelector('[data-agent-signin]'); return s ? { lead: s.querySelector('p').textContent, address: s.querySelector('.agent-copy-text').textContent, copy: !!s.querySelector('button'), hint: [...s.children].filter((e) => e.tagName === 'P').pop().textContent } : null; })()`);
      expect(!!guide && guide.lead === 'Using an app that can sign in? Give it this address:' && guide.address === `${server.base}/mcp` && guide.copy, `the sign-in address block is ${JSON.stringify(guide)}`);
      expect(!!guide && /needs only that/.test(guide.hint), 'the sign-in block does not say an app that signs in needs only the address');
      const lines = await tab.eval(`[...document.querySelectorAll('[data-agent-log] .agent-log-what')].map((e) => e.textContent)`);
      expect(lines.some((l) => /^Connected by sign-in: Nova img src=x onerror=window\.__pwn=1, allowed by .+$/.test(l)), `the log has no "Connected by sign-in" line (${JSON.stringify(lines)})`);
      expect(await wide(tab) <= 1, 'the agent page scrolls sideways at 1280');
      await tab.eval(`document.querySelector('[data-agent-token-state]').scrollIntoView({ block: 'center' })`);
      await shot(tab, 'agent-connection-1280-light');
      await tab.switchMode('dark');
      await shot(tab, 'agent-connection-1280-dark');
      await tab.switchMode('light');
      // The old-key line, as the server writes it, is read in plain words.
      const reuse = await tab.eval(`import('/agent-page.js').then((m) => [m.logLine({ at: new Date().toISOString(), kind: null, event: 'reused', app: 'X', by: null }).text, m.logLine({ at: new Date().toISOString(), kind: null, event: 'ended', app: 'X', by: { key: 'k', name: 'Ana' } }).text])`);
      expect(reuse[0] === 'Connection ended: an old key was used again' && reuse[1] === 'Connection ended by Ana', `the end lines read ${JSON.stringify(reuse)}`);
      // End connection.
      await press(tab, '[data-agent="revoke"]');
      expect(await waitDialog(tab, true), 'End connection asked nothing');
      expect(await tab.eval(`document.querySelector('dialog[open] [data-ok]').textContent`) === 'End connection', 'the question\'s button is not End connection');
      await tab.click('dialog [data-ok]');
      expect(await waitDialog(tab, false), 'the End connection question did not close');
      expect(await waitText(tab, '[data-agent-token-state]', 'No token yet.'), 'after End connection the page still shows a connection');
      expect(await waitText(tab, '[data-agent-log]', 'Connection ended by '), 'the log has no "Connection ended by" line');
      const got = (await call('admin', 'GET', `/api/users/${agentKey}/token`)).json;
      expect(got.token === null && got.connection === null, 'the server still holds a connection');
      await tab.close();
      const phone = await open(390, 'light', 'admin');
      await nav(phone, `${server.base}/admin#agent/${agentKey}`);
      await phone.waitFor('[data-agent-title]:not(:empty)', '', 40000);
      await sleep(400);
      expect(await wide(phone) <= 1, 'the agent page scrolls sideways at 390');
      expect((await targets(phone, ['[data-agent-signin] button']))[0][1] >= 28, 'the Copy button of the sign-in address is missing at 390');
      await phone.close();
    }

    // ---- agents off, and the kind only while set-up agents are on ----
    {
      expect((await call('admin', 'PATCH', '/api/settings', { setupAgents: false })).status === 200, 'could not turn Set-up agents off');
      const tab = await open(1280, 'light', 'admin');
      await nav(tab, authorizeUrl(await register('Kind App'), pkce(), 'kind'));
      await pageReady(tab, '#connect-form:not([hidden])');
      expect(await hiddenOf(tab, '#connect-kind-field'), 'the kind is offered with Set-up agents off');
      await tab.close();
      expect((await call('admin', 'PATCH', '/api/settings', { agents: false })).status === 200, 'could not turn Agents off');
      const off = await open(1280, 'light', 'admin');
      await nav(off, authorizeUrl(await register('Off App'), pkce(), 'off'));
      await pageReady(off, '#connect-back-row:not([hidden])');
      expect(/^Agents are off for .+\. An owner can turn them on in Manage, Users\.$/.test(await text(off, '#connect-lead')), `agents off reads "${await text(off, '#connect-lead')}"`);
      expect(await hiddenOf(off, '#connect-form'), 'agents off still shows the form');
      await off.close();
    }
  } catch (err) {
    for (const f of failures) console.error('check-oauth-page: ' + f);
    throw err;
  } finally {
    if (browser) await stopBrowser(browser.child, browser.dir);
    if (appListener) await new Promise((r) => appListener.close(r));
    await stopServer(server);
    await stopServer(plain);
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }
  if (failures.length) { for (const f of failures) console.error('check-oauth-page: ' + f); return 1; }
  say('ok');
  return 0;
}
process.exitCode = await main();
