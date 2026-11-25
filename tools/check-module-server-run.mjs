#!/usr/bin/env node
/*
 * check-module-server-run.mjs -- the Modules page, on an uploaded module's card: the module check's findings and the admin's approval
 * to run its actions for agents on the server (plan-agent-server-actions.md, step 11e).
 *   - pure: findings come grouped by check name, the first 12 shown and the rest under "Show all";
 *   - against a throwaway server (1280 and 390, light and dark): the fixture upload (tools/fixtures/module-actions/fixture-upload)
 *     installed, then as the admin its card shows the first 12 characters of the library hash, the warning and the approve
 *     button; approving (through the confirm dialog) shows "Approved to run on the server" and Withdraw; Withdraw takes it back;
 *     as an owner the card shows "Waiting for the admin to approve running it on the server." and no control; where this
 *     server has no wall, the card says why; a 409 says "This version changed since you looked at it; look at it again."
 *     and reloads; and the page never scrolls sideways.
 *   Set SHOT=<folder> to keep screenshots. Without Chromium only the pure part runs, and it says so.
 *
 *   node tools/check-module-server-run.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { stopBrowser } from './browser-launch.mjs';
import { findBrowser, launch, freePort, stopServer, bootSeeded, Tab, sleep, driveScreen } from './shots.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { buildModule } = require('../server/module-build.js');
const say = (...a) => console.log('check-module-server-run:', ...a);
const failures = [];
const expect = (ok, text) => { if (!ok) failures.push(text); };

// The page's own words, read as code: one place each.
const page = fs.readFileSync(path.join(root, 'public', 'admin.js'), 'utf8');
for (const text of ['Waiting for the admin to approve running it on the server.', 'This version changed since you looked at it; look at it again.', 'Withdraw', "'s actions on the server"]) {
  expect(page.includes(text), `public/admin.js does not say "${text}"`);
}

async function main() {
  const bin = findBrowser();
  if (!bin) { say('no Chromium (set CHROME_PATH): only the words were read, the page was not looked at.'); return 0; }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-run-data-'));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'server-run-mod-'));
  const shots = process.env.SHOT || '';
  if (shots) fs.mkdirSync(shots, { recursive: true });
  let server = null; let browser = null;
  try {
    const boot = await bootSeeded('travel', dataDir, await freePort(), { env: { ACTION_RUNNER_NETWORK: process.env.ACTION_RUNNER_NETWORK || 'namespace' } });
    server = boot.server;
    const base = server.base;
    const jar = (cookies) => cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const call = async (method, url, body, as = 'admin', type = 'application/json') => {
      const r = await fetch(base + url, { method, headers: { cookie: jar(boot.cookies[as]), origin: base, 'content-type': type }, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
      return { status: r.status, json: await r.json().catch(() => ({})), res: r };
    };
    // An owner who is not the admin.
    const made = await call('POST', '/api/users', { login: 'olga', password: 'olga-password-1', displayName: 'Olga', role: 'owner' });
    expect(made.status === 201, `could not make an owner: ${made.status}`);
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'olga', password: 'olga-password-1' }) });
    boot.cookies.olga = login.headers.getSetCookie().map((c) => { const [nv] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1) }; });
    // The fixture, with a dozen advice lines' worth of colour so "Show all" has something to hide.
    const dir = path.join(scratch, 'fixture-upload');
    fs.cpSync(path.join(root, 'tools', 'fixtures', 'module-actions', 'fixture-upload'), dir, { recursive: true });
    const css = Array.from({ length: 14 }, (_, i) => `.c${i} { color: #${(100000 + i * 7919).toString(16).slice(0, 6).padEnd(6, '0')}; }`).join('\n');
    const cssFile = path.join(dir, 'src', 'fixture-upload.css');
    fs.appendFileSync(cssFile, `\n${css}\n`);
    const up = await call('POST', '/api/modules', buildModule(dir).zip, 'admin', 'application/zip');
    expect(up.status === 201, `could not install the fixture: ${up.status} ${up.json.error || ''}`);
    const mod = () => call('GET', '/api/modules').then((r) => r.json.modules.find((x) => x.id === 'fixture-upload'));
    const before = await mod();
    expect(before && before.serverRun && !before.serverRun.approved, 'the fixture has no serverRun, or it is already approved');
    const wall = Boolean(before.serverRun.wall);
    say(wall ? 'this server has the wall (a network namespace)' : `this server has no wall: ${before.serverRun.why}`);
    const findings = (before.findings || []).length;
    say(`${findings} findings on the fixture`);

    browser = await launch(bin);
    const look = (tab) => tab.eval(`(() => { const c = document.querySelector('#modules-list .module-card[data-id="fixture-upload"]'); if (!c) return null;
      const t = (s) => { const e = c.querySelector(s); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; };
      return { approve: !!c.querySelector('[data-module-action="server-run-approve"]'), withdraw: !!c.querySelector('[data-module-action="server-run-withdraw"]'), waiting: t('.module-waiting'), why: t('.module-why'),
        hash: t('.module-hash'), status: t('.module-serverrun .sdk-status'), warn: t('.module-warning'), groups: c.querySelectorAll('.module-finding-group').length,
        shown: c.querySelectorAll('.module-findings > .module-finding-group li').length, more: t('.module-findings-more summary'),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }; })()`);
    const shoot = async (tab, name) => {
      if (!shots) return;
      await tab.eval(`document.querySelector('#modules-list .module-card[data-id="fixture-upload"]').scrollIntoView({ block: 'start' })`);
      fs.writeFileSync(path.join(shots, `${name}.png`), Buffer.from((await tab.cdp.send('Page.captureScreenshot', { format: 'png' }, tab.sid)).data, 'base64'));
    };
    const open = async (tab, as) => { await driveScreen(tab, { as, url: '/admin#modules', wait: '#modules-list .module-card[data-id="fixture-upload"]' }, base, boot.cookies, boot.ctx); await sleep(800); };
    const press = async (tab, action) => { await tab.eval(`document.querySelector('[data-module-action="${action}"]').click()`); };
    const confirm = async (tab) => { await tab.waitFor('dialog.sdk-dialog-confirm[open] .btn-primary'); await tab.eval(`document.querySelector('dialog.sdk-dialog-confirm .btn-primary').click()`); await sleep(1200); };

    for (const size of [1280, 390]) {
      for (const mode of ['light', 'dark']) {
        const tag = `${size}-${mode}`;
        // Start every pass with no approval.
        await call('DELETE', '/api/modules/fixture-upload/server-run');
        const tab = new Tab(browser.cdp, boot.ctx);
        await tab.open(size, mode, false);
        try {
          await open(tab, 'admin');
          let s = await look(tab);
          expect(s && s.approve && !s.withdraw, `${tag}: the admin's card has no approve button (${JSON.stringify(s)})`);
          expect(s && s.hash && /^[0-9a-f]{12}$/.test(s.hash), `${tag}: the hash shown is "${s && s.hash}"`);
          expect(s && s.hash && s.hash === before.serverRun.sha256.slice(0, 12), `${tag}: the hash is not the library's first 12 characters`);
          expect(s && /inside the sandbox/.test(s.warn || '') && /this library hash/.test(s.warn || ''), `${tag}: the warning is "${s && s.warn}"`);
          expect(s && Boolean(s.why) === !wall, `${tag}: the wall sentence ${s && s.why ? 'shows' : 'is missing'} though the wall is ${wall ? 'up' : 'down'}`);
          if (findings > 12) expect(s && s.shown === 12 && /^Show all/.test(s.more || ''), `${tag}: ${findings} findings but ${s && s.shown} shown and "${s && s.more}"`);
          if (findings) expect(s && s.groups >= 1, `${tag}: no finding groups`);
          expect(s && s.overflow <= 1, `${tag}: the page scrolls sideways by ${s && s.overflow} px`);
          await shoot(tab, `admin-${tag}`);
          await press(tab, 'server-run-approve');
          await confirm(tab);
          s = await look(tab);
          expect(s && s.withdraw && !s.approve && /Approved/.test(s.status || ''), `${tag}: after approving, the card says ${JSON.stringify(s)}`);
          expect((await mod()).serverRun.approved === true, `${tag}: the server does not hold the approval`);
          await shoot(tab, `approved-${tag}`);
          await press(tab, 'server-run-withdraw');
          await sleep(1200);
          s = await look(tab);
          expect(s && s.approve && !s.withdraw, `${tag}: after Withdraw, the card says ${JSON.stringify(s)}`);
          expect((await mod()).serverRun.approved === false, `${tag}: the server still holds the approval`);
          // A version that changed since the admin looked: 409 and the words.
          await tab.eval(`(() => { const c = document.querySelector('#modules-list .module-card[data-id="fixture-upload"] .module-serverrun'); c.dataset.hash = '0'.repeat(64); })()`);
          await press(tab, 'server-run-approve');
          await confirm(tab);
          const said = await tab.eval(`document.getElementById('modules-status') ? document.getElementById('modules-status').textContent : [...document.querySelectorAll('[role=status]')].map((e) => e.textContent).join(' ')`);
          expect(/This version changed since you looked at it; look at it again\./.test(said || ''), `${tag}: the 409 said "${said}"`);
          expect((await mod()).serverRun.approved === false, `${tag}: a stale hash was approved`);
        } finally { await tab.close(); }
        // An owner who is not the admin: the waiting sentence and no control.
        const own = new Tab(browser.cdp, boot.ctx);
        await own.open(size, mode, false);
        try {
          await open(own, 'olga');
          const s = await look(own);
          expect(s && s.waiting === 'Waiting for the admin to approve running it on the server.', `${tag}: the owner's card says "${s && s.waiting}"`);
          expect(s && !s.approve && !s.withdraw, `${tag}: the owner has a control`);
          expect(s && s.overflow <= 1, `${tag}: the owner's page scrolls sideways by ${s && s.overflow} px`);
          await shoot(own, `owner-${tag}`);
        } finally { await own.close(); }
      }
    }
  } finally {
    if (browser) { browser.cdp.ws.close(); await stopBrowser(browser.child, browser.dir); }
    if (server) await stopServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  if (failures.length) { for (const f of [...new Set(failures)]) console.error('check-module-server-run: FAIL ' + f); return 1; }
  say('OK');
  return 0;
}
main().then((c) => process.exit(c), (err) => { console.error(err); process.exit(1); });
