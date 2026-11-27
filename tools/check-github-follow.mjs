#!/usr/bin/env node
/*
 * check-github-follow.mjs -- the follow control and the Service terms line, live (documentation/plans/plan-github-app.md, build order
 * step 3: sections 14 and 15).
 *
 * Throwaway servers (their own DATA_DIR and port, stopped at the end) and headless Chromium. No request is made to GitHub: the
 * stand-in is a local server (tools/lib/github-link-fake.mjs, ISSUES_TEST_STANDIN). The page sends no provider, so the check puts the
 * stand-in's name on the two calls that carry one (a fetch wrapper added to the page; nothing in the product does this).
 *   Server A has the app. At 1280 wide, light, in the Set up panel's Modules tab: not following (one line, Connect to GitHub, the
 *   public box folded); Connect goes to the stand-in's authorize page and back; the page takes `space`, `link` and `done` off the
 *   address and keeps `done` nowhere (no storage, no cookie), and shows the list (a private repository with its label, one the
 *   person cannot write to with its note, the install help); Follow; the state line, Stop following and the switch (its words name
 *   the app, never "the account that owns this server's token"); the switch on, and a change reaching the stand-in as the installation
 *   token; a reload keeps the state; Stop following; a public repository read only (the quiet box); a spent link says so and offers
 *   Connect again. Then 390 wide, light and dark (the page's own switch): the idle state and the list fit without sideways scroll,
 *   every control 44 px high. Service terms on the admin page: the app's line and the one address, with Copy, and no secret.
 *   Server B has no app: Connect says so, offers no Connect, and the public box stays.
 * With no Chromium it says SKIPPED and exits 0 (a skip, never a pass). SHOTS=<folder> keeps a screenshot of each state.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { launch, Tab, startServer, stopServer, freePort, findBrowser, sleep } from './shots.mjs';
import { stopBrowser } from './browser-launch.mjs';
import { linkFake } from './lib/github-link-fake.mjs';

const say = (...a) => console.log('check-github-follow:', ...a);
let n = 0;
const problems = [];
const ok = (cond, msg) => { n += 1; if (!cond) problems.push(msg); };
const same = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`);

const bin = findBrowser();
if (!bin) { say('SKIPPED: no Chromium (set CHROME_PATH). This is a skip, not a pass.'); process.exit(0); }
const SHOTS = process.env.SHOTS ? path.resolve(process.env.SHOTS) : '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const PASSWORD = 'testpass1234';
const CLIENT_ID = 'Iv1.follow';
const CLIENT_SECRET = 'followsecret0123456789';
const PEM = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
const INSTALLATION_TOKEN = 'ghs_checkfollowinstallation0123456789';
const links = linkFake({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
links.state.person.installations = [{ id: 5, repositories: [
  { id: 55, full_name: 'o/r', private: false, permissions: { push: true, pull: true }, created_at: '2026-02-01T00:00:00Z' },
  { id: 56, full_name: 'o/secret', private: true, permissions: { pull: true }, created_at: '2026-01-01T00:00:00Z' },
] }];

const seen = [];
const issue = (number, title) => ({ number, title, state: 'open', labels: [], created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-03T00:00:00Z', closed_at: null, milestone: null, body: '', user: { login: 'someone' }, assignees: [], html_url: `https://github.com/o/r/issues/${number}` });
const fake = http.createServer((req, res) => {
  if (links.handle(req, res)) return;
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.url === '/app') return res.end(JSON.stringify({ slug: 'follow-check', name: 'Follow check' }));
    if (/^\/app\/installations\/\d+\/access_tokens$/.test(req.url)) {
      res.statusCode = 201;
      return res.end(JSON.stringify({ token: INSTALLATION_TOKEN, expires_at: new Date(Date.now() + 3600000).toISOString(), repositories: [{ id: 55, full_name: 'o/r' }] }));
    }
    seen.push({ method: req.method, url: req.url, auth: String(req.headers.authorization || '') });
    if (req.method === 'POST' && /\/issues$/.test(req.url)) { res.statusCode = 201; return res.end(JSON.stringify(issue(9, 'From the check'))); }
    if (/\/labels\//.test(req.url)) return res.end('{}');
    res.end(/\/issues(\?|$)/.test(req.url) ? JSON.stringify([issue(1, 'Server: slow start'), issue(2, 'Chat: no sound')]) : '[]');
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const STANDIN = `http://127.0.0.1:${fake.address().port}`;

const dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'check-github-follow-a-'));
const dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'check-github-follow-b-'));
const serverA = await startServer(dirA, await freePort(), 'first', { ISSUES_TEST_STANDIN: STANDIN, ISSUES_GITHUB_APP_CLIENT_ID: CLIENT_ID, ISSUES_GITHUB_APP_CLIENT_SECRET: CLIENT_SECRET, ISSUES_GITHUB_APP_KEY: PEM.replace(/\n/g, '\\n'), ISSUES_TEST_GAP_MS: '300' });
const serverB = await startServer(dirB, await freePort(), 'first', { ISSUES_TEST_STANDIN: STANDIN });

function api(server) {
  const jar = {};
  const call = async (method, url, body) => {
    const headers = { 'content-type': 'application/json', accept: 'application/json' };
    if (jar.admin) headers.cookie = jar.admin;
    const r = await fetch(server.base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null;
    try { json = await r.json(); } catch { /* none */ }
    return { status: r.status, json, res: r };
  };
  const login = async () => { const r = await call('POST', '/api/login', { login: 'admin', password: PASSWORD }); if (r.status !== 200) throw new Error('cannot sign in'); jar.admin = r.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '); };
  const must = (r, what) => { if (r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.json)}`); return r.json; };
  return { call, login, must, jar };
}
// The page sends no provider (GitHub is the default); the stand-in is the only service here, so its name goes on the two calls that carry one.
const SHIM = `(() => { const f = window.fetch; window.fetch = function (url, init) { try { if (init && typeof init.body === 'string' && /\\/issues-(link|pull)/.test(String(url)) && (init.method === 'POST' || init.method === 'PUT') && !/"write":/.test(init.body) && !/"on":false/.test(init.body)) { const b = JSON.parse(init.body); b.provider = 'issues-standin'; init = { ...init, body: JSON.stringify(b) }; } } catch (e) {} return f.call(this, url, init); }; })();`;

let browser = null;
let tab = null;
try {
  const A = api(serverA);
  const B = api(serverB);
  await A.login();
  await B.login();
  const setup = async (X, name) => {
    const inst = await X.call('POST', '/api/modules/bundled/schedule/install');
    if (inst.status >= 300 && !/already installed/.test(JSON.stringify(inst.json))) throw new Error(`install: ${JSON.stringify(inst.json)}`);
    X.must(await X.call('PATCH', '/api/modules/schedule', { enabled: true, allSpaces: true }), 'enable');
    X.must(await X.call('PUT', '/api/weather/terms/issues-standin', { accept: true }), 'terms');
    return X.must(await X.call('POST', '/api/spaces', { name, starter: false }), 'space').space.id;
  };
  const SA = await setup(A, 'Bug Squash');
  const SN = await setup(B, 'No App');
  const pullA = async () => (await A.call('GET', `/api/spaces/${SA}/issues-pull`)).json;

  const b = await launch(bin);
  browser = b;
  const frames = [];
  b.cdp.listeners.push((m) => { if (m.method === 'Page.frameNavigated' && m.params && m.params.frame && /done=/.test(m.params.frame.url || '')) frames.push(m.params.frame.url); });
  const shot = async (t, name) => { if (!SHOTS) return; fs.writeFileSync(path.join(SHOTS, `${name}.png`), await t.shoot()); };
  const open = async (server, X, width, mode, url) => {
    const t = new Tab(b.cdp, null);
    await t.open(width, mode);
    for (const pair of X.jar.admin.split('; ')) { const i = pair.indexOf('='); await t.cdp.send('Network.setCookie', { name: pair.slice(0, i), value: pair.slice(i + 1), url: server.base, httpOnly: true }, t.sid); }
    await t.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: SHIM }, t.sid);
    await t.cdp.send('Page.navigate', { url: server.base + url }, t.sid);
    await t.settle();
    await t.forceMode();
    return t;
  };
  const body = (t) => t.eval(`(() => { const e = __all('[data-follows-body]')[0]; return e ? e.innerText : null; })()`);
  const exists = (t, sel) => t.eval(`!!__all(${JSON.stringify(sel)})[0]`);
  const waitFor = async (t, sel, msg, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await exists(t, sel).catch(() => false)) return true; await sleep(150); } ok(false, `${msg} (nothing matches ${sel}; the control says ${JSON.stringify(await body(t).catch(() => null))})`); return false; };
  const press = (t, sel, text) => t.eval(`(() => { const e = __all(${JSON.stringify(sel)}).find((x) => !${JSON.stringify(text || '')} || x.textContent.trim() === ${JSON.stringify(text || '')}); if (!e) return false; e.click(); return true; })()`);
  const fit = async (t, label) => {
    const r = await t.eval(`(() => { const w = innerWidth; const box = __all('.follows-pull')[0]; if (!box) return { missing: true }; const small = __all('.follows-pull button, .follows-pull summary, .follows-pull a.btn, .follows-pull input[type=text]').filter((e) => e.getClientRects().length && e.getBoundingClientRect().height < 43.5).map((e) => (e.textContent || e.placeholder || e.tagName).trim().slice(0, 30)); const wide = __all('.follows-pull, .follows-pull *').filter((e) => e.getBoundingClientRect().right > w + 1).length; const page = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - w; return { small, wide, page }; })()`);
    ok(!r.missing, `${label}: the control is drawn`);
    if (r.missing) return;
    same(r.small, [], `${label}: every control is 44 px high`);
    same(r.wide, 0, `${label}: nothing past the right edge`);
    ok(r.page <= 1, `${label}: no sideways scroll on the page (${r.page})`);
  };

  // ======== server A, 1280 light ========
  tab = await open(serverA, A, 1280, 'light', `/?setup=${SA}#modules`);
  await waitFor(tab, '[data-follows-connect]', 'not following: Connect to GitHub');
  let text = await body(tab);
  ok(/Follow a GitHub repository: its issues become this plan\./.test(text), `the one line: ${text}`);
  ok(/Connect to GitHub/.test(text), 'Connect to GitHub');
  ok(/Follow a public repository \(read only\)/.test(text), 'the public box is there, as a quiet fold');
  same(await tab.eval(`__all('[data-follows-public]')[0].open`), false, 'the public box is closed');
  ok(!await exists(tab, '[data-follows-write]'), 'no switch while not following');
  ok(!/server's token/.test(text), 'nothing says the account that owns the server\'s token');
  await shot(tab, 'follow-1280-light-idle');

  await tab.eval(`__all('[data-follows-connect]')[0].click()`);
  await waitFor(tab, '[data-follows-pick]', 'back from GitHub: the list');
  const url = await tab.eval('location.href');
  ok(!/[?&](done|link|space)=/.test(url), `the address holds no space, link or done after the return: ${url}`);
  ok(frames.length >= 1, 'the return did carry done (the check saw it)');
  const done = frames.length ? new URL(frames[frames.length - 1]).searchParams.get('done') : '';
  ok(done.length > 10, 'done is a long secret');
  const kept = await tab.eval(`JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage), document.cookie])`);
  ok(done && !kept.includes(done), 'done is in no storage and no cookie');
  text = await body(tab);
  ok(/o\/r/.test(text) && /o\/secret/.test(text), `both repositories are listed: ${text}`);
  const rows = await tab.eval(`__all('.follows-repo').map((r) => r.innerText.replace(/\\s+/g, ' ').trim())`);
  ok(rows.some((r) => /^o\/secret Private Follow/.test(r) && /You can read this repository but not change it\./.test(r)), `the private one says Private and that it cannot be changed: ${JSON.stringify(rows)}`);
  ok(rows.some((r) => /^o\/r Follow$/.test(r)), `the writable one has only Follow: ${JSON.stringify(rows)}`);
  ok(/Install on GitHub/.test(await tab.eval(`__all('[data-follows-install]')[0].textContent`)), 'the install help is there');
  ok(await tab.eval(`__all('[data-follows-install] a')[0].href.includes('/apps/follow-check/installations/new')`), 'Install on GitHub goes to the app\'s install address');
  await shot(tab, 'follow-1280-light-list');

  await tab.eval(`__all('[data-follows-pick="55"]')[0].click()`);
  await waitFor(tab, '[data-follows-stop]', 'following: Stop following');
  text = await body(tab);
  ok(/Following o\/r/.test(text) || /Waiting for the first pull/.test(text), `the state line: ${text}`);
  ok(/follow-check\[bot\]/.test(text) && /Follow check/.test(text), `the switch's words name the app: ${text}`);
  ok(!/server's token/.test(text), 'no word of the old token');
  ok(!await exists(tab, '[data-follows-connect]'), 'following through the app: no Connect to GitHub');
  const rec = await pullA();
  same([rec.on, rec.via, rec.repo, rec.canWrite, rec.write], [true, 'app', 'o/r', true, false], 'the record: followed through the app, writable, writing off');
  same(await tab.eval(`[__all('[data-follows-write-input]')[0].checked, __all('[data-follows-write-input]')[0].disabled]`), [false, false], 'the switch is off and can be used');
  await shot(tab, 'follow-1280-light-following');

  await tab.eval(`__all('[data-follows-write-input]')[0].click()`);
  const end = Date.now() + 8000;
  while (Date.now() < end && !(await pullA()).write) await sleep(200);
  same((await pullA()).write, true, 'the switch turns writing on at once');
  same(await tab.eval(`__all('[data-follows-write-input]')[0].checked`), true, 'and stays on');
  const made = await A.call('POST', `/api/spaces/${SA}/issues`, { title: 'From the check', column: 'now' });
  same(made.status, 201, `a new issue is written: ${JSON.stringify(made.json)}`);
  ok(seen.some((r) => r.method === 'POST' && /\/issues$/.test(r.url) && r.auth === `Bearer ${INSTALLATION_TOKEN}`), 'the stand-in saw the change, with the installation token');
  ok(!seen.some((r) => /ghu_|followsecret/.test(r.auth)), 'no user token or secret went with an issue call');

  await tab.cdp.send('Page.navigate', { url: `${serverA.base}/?setup=${SA}#modules` }, tab.sid);
  await tab.settle();
  await waitFor(tab, '[data-follows-stop]', 'a reload keeps following');
  same(await tab.eval(`__all('[data-follows-write-input]')[0].checked`), true, 'a reload keeps the switch on');

  // Stop following (the confirmation, then Connect again).
  await tab.eval(`__all('[data-follows-stop]')[0].click()`);
  await tab.waitFor('[data-ok]');
  await tab.eval(`__all('[data-ok]')[0].click()`);
  await waitFor(tab, '[data-follows-connect]', 'stopped: Connect to GitHub again');
  same((await pullA()).on, false, 'the pull is off');

  // A public repository, read only (the quiet box).
  await tab.eval(`__all('[data-follows-public] summary')[0].click()`);
  await tab.typeInto('[data-follows-input]', 'https://github.com/o/r');
  await press(tab, '[data-follows-public-go]');
  await waitFor(tab, '[data-follows-stop]', 'a public repository followed read only');
  text = await body(tab);
  ok(/Following o\/r read only|Waiting for the first pull/.test(text), `read only line: ${text}`);
  ok(await exists(tab, '[data-follows-connect]'), 'read only: Connect to GitHub is offered, to allow changes');
  ok(!await exists(tab, '[data-follows-write-input]'), 'read only: no switch');
  same((await pullA()).via, 'public', 'the record reads public');
  await shot(tab, 'follow-1280-light-public');
  await A.call('PUT', `/api/spaces/${SA}/issues-pull`, { on: false });

  // A spent link.
  await tab.cdp.send('Page.navigate', { url: `${serverA.base}/?space=${SA}&link=gone&done=gone` }, tab.sid);
  await tab.settle();
  await waitFor(tab, '[data-follows-connect]', 'a spent link: Connect again');
  text = await body(tab);
  ok(/This link has run out\. Go back and press Connect to GitHub again\./.test(text), `the spent link says so: ${text}`);
  await tab.close();
  tab = null;

  // ======== server A, 390, light and dark ========
  tab = await open(serverA, A, 390, 'light', `/?setup=${SA}#modules`);
  await waitFor(tab, '[data-follows-connect]', '390: Connect to GitHub');
  await tab.eval(`__all('[data-follows-public] summary')[0].click()`);
  await fit(tab, '390 light idle');
  await shot(tab, 'follow-390-light-idle');
  await tab.switchMode('dark');
  await fit(tab, '390 dark idle');
  await shot(tab, 'follow-390-dark-idle');
  await tab.eval(`__all('[data-follows-connect]')[0].click()`);
  await waitFor(tab, '[data-follows-pick]', '390: the list');
  await fit(tab, '390 dark list');
  await shot(tab, 'follow-390-dark-list');
  await tab.switchMode('light');
  await fit(tab, '390 light list');
  await shot(tab, 'follow-390-light-list');
  await tab.eval(`__all('[data-follows-pick="55"]')[0].click()`);
  await waitFor(tab, '[data-follows-stop]', '390: following');
  await fit(tab, '390 light following');
  await shot(tab, 'follow-390-light-following');
  await tab.switchMode('dark');
  await shot(tab, 'follow-390-dark-following');
  // Keyboard: the buttons are reached by Tab and pressed with Enter (they are real buttons).
  same(await tab.eval(`__all('[data-follows-stop]')[0].tagName`), 'BUTTON', 'Stop following is a button');
  await tab.close();
  tab = null;

  // ======== Service terms on the admin page ========
  tab = await open(serverA, A, 1280, 'light', '/admin#modules');
  await waitFor(tab, '.weather-terms-app', 'the GitHub app\'s line on Service terms');
  await tab.eval(`__all('#weather-terms-section')[0].scrollIntoView()`);
  const terms = await tab.eval(`(() => { const e = __all('.weather-terms-app')[0]; return e ? e.innerText.replace(/\\s+/g, ' ') : ''; })()`);
  ok(/GitHub app: Follow check, working\./.test(terms), `the app's state: ${terms}`);
  const callback = await tab.eval(`(__all('.weather-terms-callback')[0] || {}).textContent || ''`);
  ok(callback === `${serverA.base}/api/issues-link/back`, `the one address: ${callback}`);
  ok(await tab.eval(`__all('.weather-terms-address button')[0].textContent.trim() === 'Copy'`), 'with a Copy button');
  const page = await tab.eval('document.body.innerText + document.documentElement.innerHTML');
  ok(![CLIENT_SECRET, INSTALLATION_TOKEN, 'PRIVATE KEY'].some((s) => page.includes(s)), 'no secret on the page');
  await shot(tab, 'terms-1280-light');
  await tab.switchMode('dark');
  await shot(tab, 'terms-1280-dark');
  await tab.switchMode('light');
  await tab.close();
  tab = null;

  // ======== server B: no app ========
  tab = await open(serverB, B, 1280, 'light', `/?setup=${SN}#modules`);
  await waitFor(tab, '[data-follows-connect]', 'no app: the page cannot tell until Connect is pressed, so Connect is there first');
  await tab.eval(`__all('[data-follows-connect]')[0].click()`);
  await waitFor(tab, '[data-follows-public][open]', 'no app: the public box opens');
  text = await body(tab);
  ok(/This server has no GitHub app\./.test(text) && /administrator/.test(text), `no app, in plain words: ${text}`);
  ok(!await exists(tab, '[data-follows-connect]'), 'no app: Connect is gone');
  await shot(tab, 'follow-1280-light-noapp');
  await tab.close();
  tab = null;
  const bTerms = (await B.call('GET', '/api/weather/terms')).json;
  same(bTerms.githubApp.state, 'off', 'server B says the app is off');
  tab = await open(serverB, B, 1280, 'light', '/admin');
  await waitFor(tab, '.weather-terms-app', 'the app line when off');
  ok(/GitHub app: not set up\. \w+ can follow public repositories read only\./.test(await tab.eval(`__all('.weather-terms-app')[0].innerText.replace(/\\s+/g, ' ')`)), 'off, in plain words');
  await tab.close();
  tab = null;
} catch (err) {
  problems.push(`the run stopped: ${err.stack || err}`);
} finally {
  if (tab) await tab.close().catch(() => {});
  if (browser) await stopBrowser(browser).catch(() => {});
  await stopServer(serverA);
  await stopServer(serverB);
  fake.closeAllConnections();
  fake.close();
  for (const d of [dirA, dirB]) fs.rmSync(d, { recursive: true, force: true });
}
if (problems.length) {
  console.error(`check-github-follow: ${problems.length} problem(s) in ${n} checks`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
say(`ok: ${n} checks.`);
process.exit(0);
