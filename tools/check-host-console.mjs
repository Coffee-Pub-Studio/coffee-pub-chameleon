#!/usr/bin/env node
/*
 * check-host-console.mjs -- the host console (plan-host-console.md, slices 3 to 6), live in headless Chromium over the
 * DevTools protocol (tools/shots.mjs) against throwaway hosted servers (tools/host-console-seed.mjs: BASE_DOMAIN=localhost)
 * holding 30 invented environments in every state, then 6, then none:
 *   - the door: anonymous and a signed-in environment owner get 401 from the console's routes, a wrong password 401
 *     "wrong username or password", and the page shows the sign-in; the host admin signs in through the form;
 *   - the left navigation's five sections, each named after the # (a reload comes back to it); at 390 wide it is one
 *     strip of tabs in a row, at 1280 a column; no section scrolls the page sideways at either width, every table sits
 *     in its own scrolling box, and at 390 every control in the section shown is a 44px target;
 *   - Environments: the rows (30, 6, or the empty state), the needs-attention counts, search with a match and with none,
 *     a kind pressed in the strip as a filter (and Clear), Comfortable | Compact (one bar, the others in the tooltip
 *     and read out; at 390 under the name), the row's More menu from the keyboard (focus on Open, arrows, Escape back to
 *     More), Suspend and Resume asked first, Delete asking for the address typed out before it turns on;
 *   - an environment's page and its tabs (arrow keys move between them), and Switch template;
 *   - Plans and Modules are read only: no field and no button in them;
 *   - Templates: Used by names link to the environments' pages; the editor's jump list;
 *   - names with markup (an environment's, its owner's, a template's, a plan's) are shown as text and never run;
 *   - an address that is not valid percent-encoding falls back to Environments, on load and as a later change;
 *     #templates/. and #templates/.. go back to the list and ask no route;
 *   - a first-password link and a typed owner password are dropped on leaving their view and on signing out.
 * The console is drawn in dark only: /theme.css answers 404 on the console's host, so the light set is not there to
 * show (a server change; see the report of this build). `--shots=<dir>` also writes a picture of each screen and state.
 * With no Chromium it says SKIPPED (not a pass).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { findBrowser, launch, freePort, sleep } from './shots.mjs';
import { seed, stopServer, call, HOST_LOGIN, HOST_PASSWORD } from './host-console-seed.mjs';

const shotsArg = process.argv.find((a) => a.startsWith('--shots='));
const SHOTS = shotsArg ? path.resolve(shotsArg.slice('--shots='.length)) : '';
const MODES = ['dark']; // light needs /theme.css on the console's host (see above)
let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`check-host-console: ${name}: ${err.stack || err.message}`); }
};

const bin = findBrowser();
if (!bin) {
  console.log('check-host-console: SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.');
  process.exit(0);
}

let browser = null;
// A tab of its own (cookies, storage), signed in with `cookie` when given, `width` wide.
async function openTab(port, { width = 1280, mode = 'dark', cookie = '' } = {}) {
  const { browserContextId } = await browser.cdp.send('Target.createBrowserContext');
  const { targetId } = await browser.cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await browser.cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => browser.cdp.send(m, p, sessionId);
  const problems = [];
  const listener = (m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push(`console: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    else if (m.method === 'Runtime.exceptionThrown') problems.push(`exception: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
  };
  browser.cdp.listeners.push(listener);
  await s('Page.enable');
  await s('Runtime.enable');
  await s('Network.enable');
  await s('Emulation.setDeviceMetricsOverride', { width, height: width <= 640 ? 844 : 900, deviceScaleFactor: 1, mobile: width <= 640 });
  await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await s('Emulation.setFocusEmulationEnabled', { enabled: true });
  if (cookie) { const [name, value] = cookie.split('='); await s('Network.setCookie', { name, value, domain: 'admin.localhost', path: '/' }); }
  const evaluate = async (expr) => {
    const r = await s('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  };
  const waitFor = async (expr, what, ms = 20000) => {
    const end = Date.now() + ms;
    while (!(await evaluate(expr).catch(() => false))) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what} (at ${await evaluate('location.href').catch(() => '?')})`);
      await sleep(80);
    }
  };
  const visible = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); return Boolean(el) && !el.closest('[hidden]') && el.getClientRects().length > 0; })()`;
  const go = async (hash) => {
    await s('Page.navigate', { url: `http://admin.localhost:${port}/${hash}` });
    await waitFor(`document.readyState === 'complete' && (${visible('#host-main')} || ${visible('#host-login')})`, 'the console');
  };
  const key = async (k, code, keyCode, mods = 0) => {
    await s('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: keyCode, modifiers: mods, ...(k === 'Enter' ? { text: '\r' } : {}) });
    await s('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: keyCode, modifiers: mods });
  };
  const type = async (selector, text) => {
    await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.select?.(); })()`);
    await s('Input.insertText', { text });
  };
  const shot = async (name) => {
    if (!SHOTS) return;
    await sleep(300);
    for (let tries = 0; tries < 3; tries += 1) {
      try {
        const { data } = await s('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(SHOTS, `${name}-${width}-${mode}.png`), Buffer.from(data, 'base64'));
        return;
      } catch { await sleep(1000); } // a loaded machine: the picture is not the check
    }
  };
  // Sideways scroll of the page; a table not in its own scrolling box; at 640 and under, any control in the shown
  // section under 44px with no 44px hit area (a small button's hit area grows past its box, system.css).
  const layoutProblems = () => evaluate(`(() => {
    const out = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) out.push('sideways scroll: ' + doc.scrollWidth + ' > ' + doc.clientWidth);
    for (const t of document.querySelectorAll('.hc-main table')) {
      if (t.closest('[hidden]')) continue;
      const wrap = t.closest('.sdk-table-wrap');
      if (!wrap || getComputedStyle(wrap).overflowX !== 'auto') out.push('a table outside a scrolling box: ' + t.getAttribute('aria-label'));
    }
    if (innerWidth <= 640) {
      for (const el of document.querySelectorAll('.hc-main button, .hc-main a[href], .hc-main input:not([type=hidden]):not([type=file]), .hc-main select, #hc-nav button')) {
        if (el.closest('[hidden]') || !el.getClientRects().length || el.disabled) continue;
        const r = el.getBoundingClientRect();
        if (r.top < 22 || r.bottom > innerHeight - 22 || r.right < 0 || r.left > innerWidth) continue; // measured where the whole 44px fits on the screen
        if (r.height >= 44 - 0.5) continue;
        const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2));
        const y = r.top + r.height / 2;
        const hits = [y - 21, y + 21].every((yy) => { const at = document.elementFromPoint(x, yy); const row = el.closest('label'); return at === el || el.contains(at) || (row && row.contains(at)); });
        if (!hits) out.push((el.getAttribute('aria-label') || el.dataset.action || el.id || el.textContent.trim().slice(0, 30) || el.tagName) + ' is ' + Math.round(r.height) + 'px tall, with no 44px hit area');
      }
    }
    return out;
  })()`).then((found) => [...found, ...problems]);
  const close = async () => {
    browser.cdp.listeners = browser.cdp.listeners.filter((f) => f !== listener);
    await browser.cdp.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
  };
  return { s, evaluate, waitFor, visible, go, key, type, shot, layoutProblems, problems, close, width, mode };
}

const rows = (tab) => tab.evaluate("[...document.querySelectorAll('#env-rows tr[data-slug]')].map((r) => r.dataset.slug)");
const count = (tab) => tab.evaluate("document.getElementById('env-count').textContent");
const strip = (tab) => tab.evaluate("Object.fromEntries([...document.querySelectorAll('#attention [data-kind]:not([data-kind=all])')].map((b) => [b.dataset.kind, Number(b.querySelector('b').textContent)]))");
const menuItems = (tab) => tab.evaluate("[...document.querySelectorAll('.host-menu [role=menuitem], [role=menu] [role=menuitem]')].filter((e) => e.getClientRects().length).map((e) => e.textContent.trim())");
const dialog = (tab) => tab.evaluate("(() => { const d = document.querySelector('dialog.sdk-dialog-confirm'); if (!d) return null; return { title: d.querySelector('.sdk-dialog-title').textContent, kind: d.dataset.kind, typed: Boolean(d.querySelector('input')), okDisabled: d.querySelector('[data-ok]').disabled, focus: document.activeElement.textContent.trim() || document.activeElement.tagName }; })()");

async function boot(count, env = {}) {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-host-console-'));
  const { child, cookie } = await seed({ count, port, dataDir, env });
  return { port, dataDir, child, cookie };
}
async function shutdown(b) {
  if (!b) return;
  await stopServer(b.child);
  fs.rmSync(b.dataDir, { recursive: true, force: true });
}

let srv = null;
try {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  browser = await launch(bin);

  // ======== 30 environments ========
  srv = await boot(30);
  const { port, cookie } = srv;

  await test('the door: anonymous and an environment owner are refused as before; a wrong password is refused', async () => {
    for (const p of ['/api/host/me', '/api/host/environments', '/api/host/settings', '/api/host/templates']) {
      const res = await call(port, 'GET', 'admin', p);
      assert.equal(res.status, 401, `${p} anonymous`);
      assert.equal(res.json.error, 'sign in first');
    }
    for (const [m, p] of [['PATCH', '/api/host/environments/harbour-club'], ['DELETE', '/api/host/environments/harbour-club'], ['POST', '/api/host/environments/harbour-club/backup']]) {
      assert.equal((await call(port, m, 'admin', p, {})).status, 401, `${m} ${p} anonymous`);
    }
    const wrong = await call(port, 'POST', 'admin', '/api/host/login', { login: HOST_LOGIN, password: 'not-the-password' });
    assert.deepEqual([wrong.status, wrong.json.error], [401, 'wrong username or password']);
    // An owner signed in to their own environment: that session is not the console's.
    const owner = await call(port, 'POST', 'harbour-club', '/api/login', { login: 'own-harbour-club', password: 'owner-password-1' });
    assert.equal(owner.status, 200, owner.text);
    const ownerCookie = owner.cookies.join('; ');
    for (const p of ['/api/host/me', '/api/host/environments']) assert.equal((await call(port, 'GET', 'admin', p, undefined, { cookie: ownerCookie })).status, 401, `${p} as an owner`);
    assert.equal((await call(port, 'DELETE', 'admin', '/api/host/environments/harbour-club', undefined, { cookie: ownerCookie })).status, 401, 'Delete as an owner');
    const tab = await openTab(port);
    try {
      await tab.go('');
      assert.ok(await tab.evaluate(tab.visible('#host-login')), 'the sign-in shows');
      assert.equal(await tab.evaluate(tab.visible('#host-main')), false, 'the console does not');
      await tab.shot('sign-in');
      await tab.type('#login-name', HOST_LOGIN);
      await tab.type('#login-password', HOST_PASSWORD);
      await tab.evaluate("document.querySelector('#login-form button[type=submit]').click()");
      await tab.waitFor(`${tab.visible('#env-list')} && document.querySelectorAll('#env-rows tr[data-slug]').length === 30`, 'the table after signing in');
    } finally { await tab.close(); }
  });

  for (const mode of MODES) {
    for (const width of [1280, 390]) {
      await test(`${width} ${mode}: the five sections, the navigation, the layout`, async () => {
        const tab = await openTab(port, { width, mode, cookie });
        try {
          for (const section of ['environments', 'templates', 'modules', 'plans', 'server']) {
            await tab.go(`#${section}`);
            await tab.waitFor(`${tab.visible(`#section-${section}`)} && document.querySelector('#hc-nav [aria-current=page]')?.dataset.section === ${JSON.stringify(section)}`, `${section} shown`);
            if (section === 'environments') await tab.waitFor("document.querySelectorAll('#env-rows tr[data-slug]').length === 30", 'rows');
            assert.equal(await tab.evaluate("[...document.querySelectorAll('.hc-section[data-section]')].filter((e) => !e.hidden).length"), 1, 'one section at a time');
            assert.equal(await tab.evaluate("getComputedStyle(document.getElementById('hc-nav')).flexDirection"), width <= 640 ? 'row' : 'column', 'the navigation: a strip on a phone, a column wider');
            await sleep(400);
            assert.deepEqual(await tab.layoutProblems(), [], `${section}`);
            await tab.shot(`section-${section}`);
          }
          // A reload comes back to the section.
          await tab.s('Page.reload', {});
          await tab.waitFor(`${tab.visible('#section-server')}`, 'Server again after a reload');
          if (width <= 640) {
            await tab.go('#environments');
            await tab.waitFor("document.querySelectorAll('#env-rows tr[data-slug]').length === 30", 'rows');
            assert.equal(await tab.evaluate("(() => { const w = document.querySelector('#env-list').closest('.sdk-table-wrap'); return w.scrollWidth > w.clientWidth; })()"), true, 'the table scrolls inside its box');
            assert.equal(await tab.evaluate(tab.visible('#environments-list .hc-swipe')), true, 'with the cue');
          }
        } finally { await tab.close(); }
      });
    }
  }

  await test('Environments: rows, the attention counts, search, the filter', async () => {
    const tab = await openTab(port, { cookie });
    try {
      await tab.go('#environments');
      await tab.waitFor("document.querySelectorAll('#env-rows tr[data-slug]').length === 30", 'rows');
      assert.equal(await count(tab), '30 of 30 environments');
      assert.deepEqual(await strip(tab), { pastDue: 2, suspended: 2, refused: 1, deletion: 2, atCap: 1, nearCap: 1, degraded: 1 });
      const order = await rows(tab);
      const firstFine = order.findIndex((slug) => !['northside-writers', 'oakridge-hikers', 'old-book-club', 'summer-camp-2025-for-the-whole', 'greenway-co-op', 'tiny-trips', 'test-environment', 'the-long-bench', 'lisbon-in-may', 'riverside-chess'].includes(slug));
      assert.equal(firstFine, 10, `the ten that need attention come first: ${order.slice(0, 11).join(', ')}`);
      await tab.type('#env-search', 'long');
      await tab.waitFor("document.getElementById('env-count').textContent.startsWith('1 of 30')", 'one match');
      assert.deepEqual(await rows(tab), ['the-long-bench']);
      await tab.shot('search-match');
      await tab.type('#env-search', 'zebra');
      await tab.waitFor("document.getElementById('env-count').textContent.startsWith('0 of 30')", 'no match');
      assert.equal(await tab.evaluate("document.querySelector('#env-rows .sdk-table-empty').textContent"), 'No environment matches. Clear the search or the filter.');
      await tab.shot('search-none');
      await tab.type('#env-search', ' ');
      await tab.evaluate("document.getElementById('env-search').value = ''; document.getElementById('env-search').dispatchEvent(new Event('input'))");
      await tab.evaluate("document.querySelector('#attention [data-kind=pastDue]').click()");
      await tab.waitFor("document.getElementById('env-count').textContent.startsWith('2 of 30')", 'the past-due filter');
      assert.equal(await tab.evaluate("document.querySelector('#attention [data-kind=pastDue]').getAttribute('aria-pressed')"), 'true');
      assert.equal(await tab.evaluate("document.getElementById('env-filter').value"), 'pastDue', 'the status filter matches');
      assert.deepEqual((await rows(tab)).sort(), ['northside-writers', 'oakridge-hikers']);
      assert.ok(await tab.evaluate(tab.visible('#attention [data-kind=all]')), 'Clear shows');
      // keyboard focus on the table: the first row's name link
      await tab.evaluate("document.querySelector('#env-rows tr[data-slug] a').focus()");
      assert.equal(await tab.evaluate("document.activeElement.matches('#env-rows a.hc-link:focus-visible')"), true, 'the name link takes the keyboard focus');
      await tab.shot('filter-and-focus');
      await tab.evaluate("document.querySelector('#attention [data-kind=all]').click()");
      await tab.waitFor("document.getElementById('env-count').textContent.startsWith('30 of 30')", 'Clear');
      await tab.evaluate("{ const f = document.getElementById('env-filter'); f.value = 'nearCap'; f.dispatchEvent(new Event('change')); }");
      assert.deepEqual(await rows(tab), ['lisbon-in-may'], 'near a cap');
      await tab.evaluate("{ const f = document.getElementById('env-filter'); f.value = 'all'; f.dispatchEvent(new Event('change')); }");
      assert.deepEqual(await tab.layoutProblems(), []);
    } finally { await tab.close(); }
  });

  for (const width of [1280, 390]) {
    await test(`${width}: Comfortable | Compact`, async () => {
      const tab = await openTab(port, { width, cookie });
      try {
        await tab.go('#environments');
        await tab.waitFor("document.querySelectorAll('#env-rows tr[data-slug]').length === 30", 'rows');
        assert.equal(await tab.evaluate("document.querySelector('#env-rows tr[data-slug=\"lisbon-in-may\"] td.hc-use-cell').querySelectorAll('.hc-use-row').length"), 3, 'comfortable: three uses');
        await tab.evaluate("document.querySelector('#env-density [data-density=comfortable]').focus()");
        await tab.key('ArrowRight', 'ArrowRight', 39);
        await tab.waitFor("document.getElementById('env-list').dataset.density === 'compact'", 'compact by the arrow key');
        assert.equal(await tab.evaluate("document.activeElement.dataset.density"), 'compact', 'the focus follows');
        const one = await tab.evaluate(`(() => {
          const row = document.querySelector('#env-rows tr[data-slug="lisbon-in-may"]');
          const cell = row.querySelector(${JSON.stringify(width <= 640 ? '.hc-use-in-name' : 'td.hc-use-cell')});
          const box = cell.querySelector('.hc-use-one');
          return { shown: cell.getClientRects().length > 0 && getComputedStyle(cell).display !== 'none', bars: cell.querySelectorAll('.hc-use-row').length, key: cell.querySelector('.hc-use-key').textContent, title: box.title, said: box.querySelector('.visually-hidden').textContent, column: getComputedStyle(row.querySelector('td.hc-use-cell')).display };
        })()`);
        assert.deepEqual([one.shown, one.bars, one.key], [true, 1, 'AI'], 'one bar, the use closest to its cap');
        assert.equal(one.title, 'Members 1 / 10, AI calls this month 45 / 50, Calls at once 0 / 2', 'the others in the tooltip');
        assert.equal(one.said, `All uses: ${one.title}`, 'and read out');
        if (width <= 640) assert.equal(one.column, 'none', 'on a phone the Use column goes; the bar is under the name');
        assert.deepEqual(await tab.layoutProblems(), []);
        await tab.shot('compact');
        await tab.s('Page.reload', {});
        await tab.waitFor("document.getElementById('env-list')?.dataset.density === 'compact'", 'kept after a reload');
        await tab.evaluate("document.querySelector('#env-density [data-density=comfortable]').click()");
      } finally { await tab.close(); }
    });
  }

  await test('the row menu from the keyboard; Suspend, Resume and Delete ask first', async () => {
    const tab = await openTab(port, { cookie });
    try {
      await tab.go('#environments');
      await tab.waitFor("document.querySelectorAll('#env-rows tr[data-slug]').length === 30", 'rows');
      const more = "#env-rows tr[data-slug=\"harbour-club\"] [data-action=row-menu]";
      await tab.evaluate(`document.querySelector(${JSON.stringify(more)}).focus()`);
      await tab.key('Enter', 'Enter', 13);
      await tab.waitFor("document.activeElement.getAttribute('role') === 'menuitem'", 'the menu, focus in it');
      assert.deepEqual(await menuItems(tab), ['Open', 'Back up', 'Suspend', 'Delete']);
      assert.equal(await tab.evaluate('document.activeElement.textContent.trim()'), 'Open', 'focus on the first entry');
      await tab.shot('row-menu');
      await tab.key('ArrowDown', 'ArrowDown', 40);
      assert.equal(await tab.evaluate('document.activeElement.textContent.trim()'), 'Back up', 'the arrow moves down');
      await tab.key('Escape', 'Escape', 27);
      await tab.waitFor(`document.activeElement === document.querySelector(${JSON.stringify(more)})`, 'Escape: focus back on More');

      // Suspend: asked first, Cancel focused; then Resume, the plain question.
      const pick = async (word) => {
        await tab.evaluate(`document.querySelector(${JSON.stringify(more)}).click()`);
        await tab.waitFor("document.querySelectorAll('[role=menuitem]').length > 0", 'the menu');
        await tab.evaluate(`[...document.querySelectorAll('[role=menuitem]')].find((e) => e.textContent.trim() === ${JSON.stringify(word)}).click()`);
        await tab.waitFor("Boolean(document.querySelector('dialog.sdk-dialog-confirm'))", `the ${word} dialog`);
      };
      await pick('Suspend');
      assert.deepEqual(await dialog(tab), { title: 'Suspend Harbour Club?', kind: 'destructive', typed: false, okDisabled: false, focus: 'Cancel' });
      await tab.shot('suspend-dialog');
      await tab.evaluate("document.querySelector('dialog.sdk-dialog-confirm [data-ok]').click()");
      await tab.waitFor("document.querySelector('#env-rows tr[data-slug=\"harbour-club\"] .hc-status-cell').textContent.includes('Suspended')", 'suspended');
      await pick('Resume');
      assert.deepEqual(await dialog(tab), { title: 'Resume Harbour Club?', kind: 'plain', typed: false, okDisabled: false, focus: 'Resume' });
      await tab.shot('resume-dialog');
      await tab.evaluate("document.querySelector('dialog.sdk-dialog-confirm [data-ok]').click()");
      await tab.waitFor("document.querySelector('#env-rows tr[data-slug=\"harbour-club\"] .hc-status-cell').textContent.includes('Active')", 'active again');

      // Delete: the address typed out before Delete turns on.
      await pick('Delete');
      let d = await dialog(tab);
      assert.deepEqual([d.title, d.kind, d.typed, d.okDisabled], ['Delete Harbour Club?', 'final', true, true]);
      await tab.s('Input.insertText', { text: 'harbour' });
      assert.equal((await dialog(tab)).okDisabled, true, 'part of the address is not enough');
      await tab.shot('delete-dialog');
      await tab.s('Input.insertText', { text: '-club' });
      d = await dialog(tab);
      assert.equal(d.okDisabled, false, 'the whole address turns Delete on');
      await tab.evaluate("document.querySelector('dialog.sdk-dialog-confirm [data-ok]').click()");
      await tab.waitFor("document.querySelectorAll('#env-rows tr[data-slug]').length === 29", 'one fewer row');
      assert.equal(await tab.evaluate("document.getElementById('environments-status').textContent"), 'Harbour Club was deleted (moved aside).');
      assert.equal((await call(port, 'GET', 'admin', '/api/host/environments', undefined, { cookie })).json.environments.some((e) => e.slug === 'harbour-club'), false, 'gone from the server');
      assert.deepEqual(tab.problems, []);
    } finally { await tab.close(); }
  });

  for (const width of [1280, 390]) {
    await test(`${width}: an environment's page, its tabs, Switch template`, async () => {
      const tab = await openTab(port, { width, cookie });
      try {
        await tab.go('#environments');
        await tab.waitFor("document.querySelectorAll('#env-rows tr[data-slug]').length >= 29", 'rows');
        await tab.evaluate("document.querySelector('#env-rows tr[data-slug=\"northside-writers\"] a').click()");
        await tab.waitFor(`${tab.visible('#environment-page')} && document.getElementById('env-title').textContent === 'Northside Writers'`, 'the page');
        assert.equal(await tab.evaluate('location.hash'), '#environments/northside-writers');
        assert.match(await tab.evaluate("document.getElementById('env-banners').textContent"), /^Past due since .+\. It goes back to the Free plan on .+\.$/);
        await tab.shot('page-overview');
        await tab.evaluate("document.getElementById('env-tab-overview').focus()");
        for (const tabId of ['plan', 'template', 'owners', 'backups', 'danger']) {
          await tab.key('ArrowRight', 'ArrowRight', 39);
          await tab.waitFor(`${tab.visible(`#env-sheet-${tabId}`)} && document.activeElement.id === 'env-tab-${tabId}'`, `the ${tabId} tab by the arrow key`);
          assert.equal(await tab.evaluate('location.hash'), `#environments/northside-writers/${tabId}`);
          assert.deepEqual(await tab.layoutProblems(), [], tabId);
          await tab.shot(`page-${tabId}`);
        }
        assert.equal(await tab.evaluate("document.getElementById('env-tab-domain').disabled"), true, 'Domain is drawn for later');
        // Switch template, asked first; the offer's Review shows when the template offers more.
        if (width === 1280) {
          await tab.go('#environments/lisbon-in-may/template');
          await tab.waitFor(tab.visible('#env-template-select'), 'the template chooser');
          const other = await tab.evaluate("[...document.getElementById('env-template-select').options].map((o) => o.value).find((v) => v !== document.getElementById('env-template-select').value && v !== 'none')");
          await tab.evaluate(`{ const s = document.getElementById('env-template-select'); s.value = ${JSON.stringify(other)}; s.dispatchEvent(new Event('change')); }`);
          await tab.evaluate("document.getElementById('env-template-switch-btn').click()");
          await tab.waitFor("Boolean(document.querySelector('dialog.sdk-dialog-confirm'))", 'the switch dialog');
          await tab.evaluate("document.querySelector('dialog.sdk-dialog-confirm [data-ok]').click()");
          await tab.waitFor("document.getElementById('env-template-status').textContent.startsWith('Switched to ')", 'switched');
          await sleep(500);
          await tab.shot('page-template-switched');
          // The offer left open is offered again by Review after a reload.
          await tab.s('Page.reload', {});
          await tab.waitFor(tab.visible('#env-sheet-template'), 'the Template tab again');
          if (await tab.evaluate(tab.visible('#env-offer-note'))) {
            await tab.shot('page-template-offer');
            await tab.evaluate("document.getElementById('env-offer-review').click()");
            await tab.waitFor(tab.visible('#env-offer'), 'the offer after Review');
            await tab.shot('page-template-review');
          }
        }
      } finally { await tab.close(); }
    });
  }

  // The Demo space part of the Template tab: the select of demos, the sentences the server gives, focus back on Add.
  for (const width of [1280, 390]) {
    await test(`${width}: Demo space picks a demo, shows the server's sentences, and returns focus to Add`, async () => {
      const slug = width === 1280 ? 'lisbon-in-may' : 'northside-writers';
      const tab = await openTab(port, { width, cookie });
      try {
        const ownTemplate = (((await call(port, 'GET', 'admin', '/api/host/environments', undefined, { cookie })).json.environments.find((e) => e.slug === slug) || {}).template || {}).id || '';
        await tab.go(`#environments/${slug}/template`);
        await tab.waitFor(tab.visible('#env-demo-select') && "document.getElementById('env-demo-select').options.length === 5", 'the demo select');
        assert.deepEqual(await tab.evaluate("[...document.getElementById('env-demo-select').options].map((o) => o.textContent)"), ['Games demo', 'Learning demo', 'Mentoring demo', 'Project demo', 'Travel demo']);
        const ids = await tab.evaluate("[...document.getElementById('env-demo-select').options].map((o) => o.value)");
        assert.equal(await tab.evaluate("document.getElementById('env-demo-select').value"), ids.includes(ownTemplate) ? ownTemplate : 'travel', 'the environment\'s own template first, else travel');
        assert.deepEqual(await tab.layoutProblems(), [], 'demo section');
        await tab.shot(`demo-section-${width}`);
        const pickDemo = (id) => tab.evaluate(`{ const s = document.getElementById('env-demo-select'); s.value = ${JSON.stringify(id)}; s.dispatchEvent(new Event('change')); }`);
        const add = async () => {
          await tab.evaluate("document.getElementById('env-demo-select').focus()");
          await tab.evaluate("document.getElementById('env-demo-add').click()");
          await tab.waitFor("!document.getElementById('env-demo-add').disabled && document.getElementById('env-demo-status').textContent.length > 0 && !document.getElementById('env-demo-status').textContent.startsWith('Adding')", 'an answer');
          assert.equal(await tab.evaluate('document.activeElement.id'), 'env-demo-add', 'focus returns to Add');
          return tab.evaluate("document.getElementById('env-demo-status').textContent");
        };
        await pickDemo('games');
        assert.equal(await add(), 'Added the Games demo.');
        const lines = await tab.evaluate("[...document.querySelectorAll('#env-demo-report > p')].map((p) => p.textContent)");
        assert.ok(lines.some((l) => l.startsWith('Space: Demo: The Salt Crown')), lines.join(' | '));
        assert.ok(!lines.some((l) => l.startsWith('Skipped ')), 'a skipped sentence stands alone, with no prefix');
        assert.ok(await tab.evaluate(`document.getElementById('env-demo-report').textContent.includes('shown once')`), 'the one-time passwords report is shown');
        await tab.shot(`demo-added-${width}`);
        // The second time: the server's sentence as given.
        assert.match(await add(), /^The Games demo is already there\. Delete its \w+, then add it again\.$/);
        assert.deepEqual(await tab.layoutProblems(), [], 'demo section after');
        await tab.shot(`demo-repeat-${width}`);
      } finally { await tab.close(); }
    });
  }
  await test('Demo space: a refused load shows the account sentence', async () => {
    const slug = 'lisbon-in-may';
    const ownerLogin = await call(port, 'POST', slug, '/api/login', { login: 'own-lisbon-in-may', password: 'owner-password-1' });
    { const mk = await call(port, 'POST', slug, '/api/users', { login: 'noa', displayName: 'Noa Brandt', role: 'owner', password: 'owner-password-1234' }, { cookie: ownerLogin.cookies.join('; ') }); assert.ok(mk.status < 300, mk.text); }
    const tab = await openTab(port, { cookie });
    try {
      await tab.go(`#environments/${slug}/template`);
      await tab.waitFor("document.getElementById('env-demo-select') && document.getElementById('env-demo-select').options.length === 5", 'the demo select');
      await tab.evaluate("{ const s = document.getElementById('env-demo-select'); s.value = 'project'; s.dispatchEvent(new Event('change')); }");
      await tab.evaluate("document.getElementById('env-demo-add').click()");
      await tab.waitFor("!document.getElementById('env-demo-add').disabled && /already exists/.test(document.getElementById('env-demo-status').textContent)", 'the refusal');
      assert.equal(await tab.evaluate("document.getElementById('env-demo-status').textContent"), 'An account called "noa" already exists and was not made by a demo, so it is left alone. Rename or remove it first.');
      assert.equal(await tab.evaluate('document.activeElement.id'), 'env-demo-add', 'focus returns to Add');
      await tab.shot('demo-refused');
    } finally { await tab.close(); }
  });

  await test('Plans and Modules are read only; Templates link to the environments; the jump list', async () => {
    const tab = await openTab(port, { cookie });
    try {
      for (const section of ['plans', 'modules']) {
        await tab.go(`#${section}`);
        await tab.waitFor(`document.querySelectorAll('#section-${section} tbody tr').length > 0`, section);
        assert.equal(await tab.evaluate(`document.querySelectorAll('#section-${section} :is(input, select, textarea, button)').length`), 0, `no field or button in ${section}`);
        assert.match(await tab.evaluate(`document.querySelector('#section-${section} .sdk-hint').textContent`), /Read only: (changing plans comes|installing and updating come) later\./);
      }
      assert.equal(await tab.evaluate("document.querySelector('#plan-rows tr').lastElementChild.textContent"), '20', 'Free: 20 environments');
      await tab.go('#templates');
      await tab.waitFor("document.querySelectorAll('#template-list tr[data-id]').length > 0", 'the templates');
      const link = await tab.evaluate("(() => { const a = document.querySelector('#template-list .hc-used a'); return [a.textContent, a.getAttribute('href')]; })()");
      assert.match(link[1], /^#environments\/[a-z0-9-]+$/, 'Used by links to the page');
      await tab.evaluate("document.querySelector('#template-list .hc-used a').click()");
      await tab.waitFor(`document.getElementById('env-title').textContent === ${JSON.stringify(link[0])}`, 'the environment from Used by');
      await tab.go('#templates/travel');
      await tab.waitFor(`${tab.visible('#template-editor-view')} && document.getElementById('template-editor-title').textContent.startsWith('Edit ')`, 'the editor');
      // The editor's parts hold the template's data (the new shape: words, Home page, modules, workspace, call, phases).
      const got = await tab.evaluate(`({ name: document.querySelector('#te-basics [data-tf=name]').value, words: document.querySelectorAll('#te-labels [data-tf-word]').length, locked: document.querySelectorAll('#te-labels .tf-locked-list .tf-line').length, modules: document.querySelectorAll('#te-modules [data-module]:checked').length, call: document.getElementById('te-call-position').options.length, measure: document.getElementById('te-measure').value, phases: document.getElementById('te-phases').children.length, parts: [...document.querySelectorAll('#te-jump [data-part]')].map((b) => b.textContent) })`);
      assert.equal(got.name, 'Travel');
      assert.deepEqual([got.words, got.locked], [3, 8], 'Space, Member and the Home page, and eight locked words');
      assert.ok(got.modules >= 3 && got.call === 7 && got.measure === 'dates' && got.phases > 0, JSON.stringify(got));
      assert.ok(!got.parts.some((p) => /verb|theme/i.test(p)), 'no verbs or theme part');
      // The Default Workspace's layout (plan-layout-picker.md, step 5): the layout picker, opened on the template's areas, with
      // the maker's notice "by default" (Vault's guests, from the manifest's defaults), Remove the layout, no Opens with list.
      await tab.go('#templates/travel/workspace');
      await tab.waitFor(tab.visible('#te-layout .layout-picker-board .layout-picker-area'), 'the layout picker in the editor');
      assert.deepEqual(await tab.evaluate(`({ areas: [...document.querySelectorAll('#te-layout .layout-picker-board .layout-picker-area')].map((a) => a.getAttribute('aria-label')), notices: [...document.querySelectorAll('#te-layout .layout-picker-board .layout-picker-notice')].map((n) => n.textContent), bar: document.querySelectorAll('#te-layout .action-bar').length, remove: Boolean(document.querySelector('#te-layout [data-layout-remove]')), held: document.getElementById('te-layout').dataset.twLayout, list: document.querySelectorAll('#te-part-workspace .opens-row, #te-part-workspace [data-opens]').length })`),
        { areas: ['Area 1 of 2: Itinerary', 'Area 2 of 2: Vault'], notices: ["Guests can't open this by default."], bar: 0, remove: true, held: '{"shape":"wide-narrow","areas":["travel","vault"]}', list: 0 }, 'the picker, with the notice by default and no bar of its own');
      await tab.go('#templates/default/workspace');
      await tab.waitFor(`${tab.visible('#template-editor-view')} && document.getElementById('template-editor-title').textContent === 'The Default template'`, 'the Default template, read only');
      assert.equal(await tab.evaluate(`document.getElementById('te-save').hidden && document.querySelectorAll('#template-editor .hc-part input:not(:disabled)').length === 0`), true, 'the Default template shows no way to save');
      await tab.waitFor(tab.visible('#te-layout .layout-picker'), 'the Default template\'s layout');
      assert.deepEqual(await tab.evaluate(`({ readOnly: document.querySelector('#te-layout .layout-picker').classList.contains('layout-picker-readonly'), areas: [...document.querySelectorAll('#te-layout .layout-picker-board [data-area]')].filter((a) => a.getClientRects().length).map((a) => [a.tagName, a.getAttribute('aria-label')]), controls: document.querySelectorAll('#te-layout [data-layout-remove], #te-layout [data-layout-add], #te-layout .layout-picker-board button').length })`),
        { readOnly: true, areas: [['DIV', 'Area 1 of 1: Empty']], controls: 0 }, 'the Default template\'s layout is read only: one empty area, nothing to press');
      await tab.go('#templates/travel');
      await tab.waitFor(`${tab.visible('#template-editor-view')} && document.getElementById('template-editor-title').textContent.startsWith('Edit ')`, 'the editor again');
      // The parts are tabs (decision 52): one part on the screen, its own address, the typed values kept between them.
      const tabState = () => tab.evaluate(`({ selected: [...document.querySelectorAll('#te-jump [role=tab]')].filter((b) => b.getAttribute('aria-selected') === 'true').map((b) => b.dataset.part), shown: [...document.querySelectorAll('#template-editor .hc-part')].filter((p) => !p.hidden).map((p) => p.id), tabbable: [...document.querySelectorAll('#te-jump [role=tab]')].filter((b) => b.tabIndex === 0).length, hash: location.hash, active: document.activeElement.id })`);
      let st = await tabState();
      assert.deepEqual([st.selected, st.shown, st.tabbable], [['te-part-basics'], ['te-part-basics'], 1], 'a template with no part opens Environment Basics');
      assert.equal(await tab.evaluate("document.getElementById('te-jump').getAttribute('role')"), 'tablist');
      await tab.evaluate("document.querySelector('#te-jump [data-part=te-part-icons]').click()");
      await tab.waitFor("location.hash === '#templates/travel/icons'", 'the Icons address');
      st = await tabState();
      assert.deepEqual([st.selected, st.shown, st.active], [['te-part-icons'], ['te-part-icons'], 'te-tab-icons'], 'Icons alone is shown and its tab has the focus');
      assert.equal(await tab.evaluate("document.querySelectorAll('#te-icons-set details, #te-icons-set .set-fold, #te-icons-set > *').length > 0"), true, 'the built-in Icons list is in the Icons tab');
      await tab.evaluate("{ const t = document.getElementById('te-icon-set'); t.value = 'dice compass'; t.dispatchEvent(new Event('input')); }");
      await tab.key('ArrowRight', 'ArrowRight', 39);
      await tab.waitFor("location.hash === '#templates/travel/starter'", 'ArrowRight to Starter spaces');
      await tab.key('ArrowRight', 'ArrowRight', 39);
      await tab.waitFor("location.hash === '#templates/travel'", 'ArrowRight wraps to Environment Basics');
      await tab.key('End', 'End', 35);
      await tab.waitFor("location.hash === '#templates/travel/starter'", 'End');
      await tab.key('Home', 'Home', 36);
      await tab.waitFor("location.hash === '#templates/travel'", 'Home');
      await tab.evaluate('history.back()');
      await tab.waitFor("location.hash === '#templates/travel/starter' && !document.getElementById('te-part-starter').hidden && document.getElementById('te-part-basics').hidden", 'back moves to the last tab');
      assert.equal(await tab.evaluate("document.getElementById('te-icon-set').value"), 'dice compass', 'switching tabs keeps what was typed');
      await tab.go('#templates/travel/reactions');
      await tab.waitFor(`${tab.visible('#te-part-reactions')} && document.querySelectorAll('#template-editor .hc-part:not([hidden])').length === 1`, 'the address opens its part');
      assert.equal(await tab.evaluate("document.getElementById('te-reactions-set').textContent.includes('An environment') || document.getElementById('te-reactions-set').children.length > 0"), true, 'the built-in Reactions list is in the Reactions tab');
      // A problem on a tab not shown: marked on its tab, counted in the status line, with Save from another tab.
      { const mk = await call(port, 'POST', 'admin', '/api/host/templates/travel/duplicate', { id: 'tabs-copy', name: 'Tabs copy' }, { cookie }); assert.ok(mk.status < 300, mk.text); }
      await tab.go('#templates/tabs-copy');
      await tab.waitFor(`${tab.visible('#te-part-basics')} && document.querySelectorAll('#te-phases .phase-row').length > 0`, 'the editor on Basics');
      await tab.evaluate("{ document.querySelector('#te-phases [data-phase-id]').value = 'Bad Id!'; const t = document.getElementById('te-icon-set'); t.value = Array.from({ length: 70 }, (_, i) => 'icon' + i).join(' '); }");
      await tab.evaluate("document.getElementById('te-save').click()");
      await tab.waitFor("document.getElementById('te-status').classList.contains('error') && /problems/.test(document.getElementById('te-status').textContent)", 'the problems');
      assert.match(await tab.evaluate("document.getElementById('te-status').textContent"), /^2 parts have problems/);
      assert.deepEqual(await tab.evaluate("[...document.querySelectorAll('#te-jump [data-part]')].filter((b) => !b.querySelector('[data-problems]').hidden).map((b) => b.dataset.part)"), ['te-part-phases', 'te-part-icons'], 'only the tabs with problems are marked');
      assert.equal(await tab.evaluate("document.querySelector('#te-jump [data-part=te-part-basics]').querySelector('[data-problems]').hidden"), true);
      assert.equal(await tab.evaluate("location.hash"), '#templates/tabs-copy', 'a refused save leaves the shown tab');
      assert.equal(await tab.evaluate("document.getElementById('te-part-phases').querySelectorAll('.problems li').length > 0"), true, 'the problem is in its part list');
      await tab.evaluate("document.querySelector('#te-jump [data-part=te-part-phases]').click()");
      await tab.waitFor(tab.visible('#te-part-phases .problems li'), 'the problem on its tab');
      await tab.evaluate("{ document.querySelector('#te-phases [data-phase-id]').value = 'planning'; document.getElementById('te-icon-set').value = 'dice compass'; }");
      await tab.evaluate("document.getElementById('te-save').click()");
      await tab.waitFor("/^Saved /.test(document.getElementById('templates-status').textContent)", 'a save from the Phases tab saves every part');
      await tab.go('#templates/tabs-copy/icons');
      await tab.waitFor(`${tab.visible('#te-part-icons')} && document.getElementById('te-icon-set').value === 'dice compass'`, 'the Icons part was saved from another tab');
      // Add a reaction in the editor: a new row is sent with an id the server accepts, and after the save the focus is on the saved template's link.
      await tab.go('#templates/tabs-copy/reactions');
      await tab.waitFor(tab.visible('#te-part-reactions'), 'the Reactions tab of the copy');
      await tab.evaluate("{ document.getElementById('te-reaction-add').click(); const row = document.getElementById('te-reactions').lastElementChild; row.querySelector('.reaction-glyph').value = '\\u{1F389}'; row.querySelector('.reaction-label').value = 'Party Time'; }");
      await tab.evaluate("document.getElementById('te-save').click()");
      await tab.waitFor("/^Saved /.test(document.getElementById('templates-status').textContent)", 'Add a reaction and Save template is accepted');
      await tab.waitFor("document.activeElement && document.activeElement.closest('#template-list [data-id=\"tabs-copy\"]') !== null", 'after a save the focus is on the saved template in the list');
      { const got = await call(port, 'GET', 'admin', '/api/host/templates/tabs-copy', undefined, { cookie }); assert.deepEqual(got.json.template.reactions.map((r) => [r.id, r.glyph, r.label]), [['party-time', '\u{1F389}', 'Party Time']], got.text); assert.deepEqual(got.json.template.workspace.layout, { shape: 'wide-narrow', areas: ['travel', 'vault'] }, 'saving never loses the layout'); }
      // A layout changed in the picker (step 5): another shape, Vault moved into area 1, saved with the form's Save and read
      // back from the server and in the editor.
      await tab.go('#templates/tabs-copy/workspace');
      await tab.waitFor(tab.visible('#te-layout .layout-picker-board .layout-picker-area'), 'the copy\'s layout');
      await tab.evaluate("document.querySelector('#te-layout .layout-picker-step[data-step=\"1\"]').click()");
      await tab.evaluate("document.querySelector('#te-layout .layout-picker-shape[data-shape=\"two-equal\"]').click()");
      await tab.evaluate("document.querySelector('#te-layout .layout-picker-step[data-step=\"2\"]').click()");
      await tab.waitFor(tab.visible('#te-layout .layout-picker-board .layout-picker-area[data-area=\"1\"]'), 'step 2 of the new shape');
      await tab.evaluate("document.querySelector('#te-layout .layout-picker-board .layout-picker-area[data-area=\"1\"]').click()");
      await tab.waitFor("[...document.querySelectorAll('.host-menu-item')].some((b) => b.querySelector('.host-menu-label').textContent.trim() === 'Vault')", 'the area\'s menu');
      assert.deepEqual(await tab.evaluate("[...document.querySelectorAll('.host-menu-item')].map((b) => b.querySelector('.host-menu-label').textContent.trim()).filter((t) => /^(Chat|Conference|Empty)$/.test(t))"), ['Empty'], 'Empty first; never the chat or the call');
      await tab.evaluate("[...document.querySelectorAll('.host-menu-item')].find((b) => b.querySelector('.host-menu-label').textContent.trim() === 'Vault').click()");
      await tab.waitFor("document.getElementById('te-layout').dataset.twLayout === '{\"shape\":\"two-equal\",\"areas\":[\"vault\",null]}'", 'Vault moved to area 1');
      await tab.evaluate("document.getElementById('te-save').click()");
      await tab.waitFor("/^Saved /.test(document.getElementById('templates-status').textContent) && document.activeElement && document.activeElement.closest('#template-list [data-id=\"tabs-copy\"]') !== null", 'the layout saved');
      { const got = await call(port, 'GET', 'admin', '/api/host/templates/tabs-copy', undefined, { cookie }); assert.deepEqual(got.json.template.workspace.layout, { shape: 'two-equal', areas: ['vault', null] }, 'the layout as the picker held it'); }
      await tab.go('#templates/tabs-copy/workspace');
      await tab.waitFor(tab.visible('#te-layout .layout-picker-board .layout-picker-area'), 'the copy reopened');
      assert.deepEqual(await tab.evaluate("[...document.querySelectorAll('#te-layout .layout-picker-board .layout-picker-area')].map((a) => a.getAttribute('aria-label'))"), ['Area 1 of 2: Vault', 'Area 2 of 2: Empty'], 'reopened as saved');
      // A layout refusal (plan-layout-picker.md, step 3): untick a module the layout uses and save. Before saving, the
      // Modules tab and the picker both say so (step 5); the Vault area keeps its name and Vault is no longer offered.
      // sentence with `parts: ['workspace']`, so it lands once in the Default Workspace part and badges that tab alone; the
      // status line says where, never the sentence again.
      await tab.go('#templates/tabs-copy/modules');
      await tab.waitFor(tab.visible('#te-part-modules'), 'the Modules tab of the copy');
      await tab.evaluate("document.querySelector('#te-modules [data-module=vault]').click()");
      assert.equal(await tab.evaluate("document.getElementById('te-modules-layout').textContent"), 'The layout on the Default Workspace tab uses Vault. Tick it again, or take it out of the layout there.', 'said under Modules before saving');
      assert.equal(await tab.evaluate("document.querySelector('#te-layout .tp-layout-missing').textContent"), 'The layout uses Vault, which is not ticked under Modules. Tick it again, or take it out of the layout.', 'said beside the picker before saving');
      assert.equal(await tab.evaluate("document.querySelector('#te-layout .layout-picker-board .layout-picker-area[data-area=\"1\"]').getAttribute('aria-label')"), 'Area 1 of 2: Vault', 'the area keeps its module, by name');
      await tab.evaluate("document.querySelector('#te-layout .layout-picker-board .layout-picker-area[data-area=\"2\"]').click()");
      await tab.waitFor("document.querySelectorAll('.host-menu-item').length > 0", 'the menu of area 2');
      assert.equal(await tab.evaluate("[...document.querySelectorAll('.host-menu-item')].some((b) => b.querySelector('.host-menu-label').textContent.trim() === 'Vault')"), false, 'an unticked module is not offered');
      await tab.key('Escape', 'Escape', 27);
      await tab.evaluate("document.getElementById('te-save').click()");
      await tab.waitFor("document.getElementById('te-status').classList.contains('error')", 'the layout refusal');
      {
        const got = await tab.evaluate("({ part: [...document.querySelectorAll('#te-part-workspace .problems li')].map((li) => li.textContent), top: [...document.querySelectorAll('#tp-problems li')].map((li) => li.textContent), all: [...document.querySelectorAll('#template-editor .problems li')].map((li) => li.textContent), status: document.getElementById('te-status').textContent, badged: [...document.querySelectorAll('#te-jump [data-part]')].filter((b) => !b.querySelector('[data-problems]').hidden).map((b) => b.dataset.part) })");
        assert.equal(got.part.length, 1, JSON.stringify(got));
        assert.match(got.part[0], /^The layout uses .*Vault/, 'the layout sentence, in the Default Workspace part');
        assert.deepEqual(got.top, [], 'not in the list at the top');
        assert.equal(got.all.filter((t) => t === got.part[0]).length, 1, 'once');
        assert.deepEqual(got.badged, ['te-part-workspace'], 'its tab badged, no other');
        assert.equal(got.status, '1 part has problems, marked on its tab.', 'the status line says where, not the sentence');
      }
      await tab.evaluate("document.querySelector('#te-modules [data-module=vault]').click()"); // ticked again: nothing changed on the server
      assert.equal(await tab.evaluate("document.getElementById('te-modules-layout').textContent + document.querySelector('#te-layout .tp-layout-missing').textContent"), '', 'ticked again: the lines go');
      // Remove the layout: a line in plain words and Pick a shape; saved, the template has no layout.
      await tab.go('#templates/tabs-copy/workspace');
      await tab.evaluate("document.querySelector('#te-layout [data-layout-remove]').click()");
      assert.deepEqual(await tab.evaluate("({ words: document.querySelector('#te-layout .tp-layout-words').textContent, add: document.activeElement.matches('#te-layout [data-layout-add]'), held: document.getElementById('te-layout').dataset.twLayout })"),
        { words: 'No layout. A new space opens the chat and every module that is on.', add: true, held: '' }, 'no layout: said plainly, the focus on Pick a shape');
      await tab.evaluate("document.getElementById('te-save').click()");
      await tab.waitFor("/^Saved /.test(document.getElementById('templates-status').textContent) && document.activeElement && document.activeElement.closest('#template-list [data-id=\"tabs-copy\"]') !== null", 'saved with no layout');
      { const got = await call(port, 'GET', 'admin', '/api/host/templates/tabs-copy', undefined, { cookie }); assert.equal(got.json.template.workspace?.layout, undefined, 'no layout sent, none kept'); }
      await tab.go('#templates/tabs-copy/workspace');
      await tab.waitFor(tab.visible('#te-layout [data-layout-add]'), 'Pick a shape');
      await tab.evaluate("document.querySelector('#te-layout [data-layout-add]').click()");
      assert.equal(await tab.evaluate("document.activeElement.matches('#te-layout .layout-picker-shape') && document.getElementById('te-layout').dataset.twLayout === ''"), true, 'Pick a shape opens step 1 on the first shape; nothing to send until one is picked');
      { const rm = await call(port, 'DELETE', 'admin', '/api/host/templates/tabs-copy', undefined, { cookie }); assert.ok(rm.status < 300, rm.text); }
      await tab.go('#templates/travel');
      await tab.waitFor(tab.visible('#te-part-basics'), 'the editor again');
      assert.deepEqual(await tab.layoutProblems(), []);
      await tab.shot('template-editor');
    } finally { await tab.close(); }
  });
  await test('Template editor tabs at 390: a strip that scrolls inside itself, every part reachable, no sideways page scroll', async () => {
    const tab = await openTab(port, { cookie, width: 390 });
    try {
      for (const part of ['basics', 'words', 'modules', 'workspace', 'call', 'phases', 'reactions', 'icons', 'starter']) {
        await tab.go(`#templates/travel${part === 'basics' ? '' : `/${part}`}`);
        await tab.waitFor(`${tab.visible(`#te-part-${part}`)} && document.querySelectorAll('#template-editor .hc-part:not([hidden])').length === 1`, `${part} at 390`);
        assert.deepEqual(await tab.layoutProblems(), [], `${part} at 390`);
      }
      // The layout at 390: the picker's list, one row per area, each at least 44px tall.
      await tab.go('#templates/travel/workspace');
      await tab.waitFor(tab.visible('#te-layout .layout-picker-row-main'), 'the layout list at 390');
      assert.deepEqual(await tab.evaluate("({ board: [...document.querySelectorAll('#te-layout .layout-picker-board .layout-picker-area')].filter((a) => a.getClientRects().length).length, rows: [...document.querySelectorAll('#te-layout .layout-picker-row-main')].filter((r) => r.getClientRects().length).map((r) => [r.getAttribute('aria-label'), r.getBoundingClientRect().height >= 44]) })"),
        { board: 0, rows: [['Area 1 of 2: Itinerary', true], ['Area 2 of 2: Vault', true]] }, 'one row per area at 390');
      assert.equal(await tab.evaluate("(() => { const s = document.getElementById('te-jump'); return s.scrollWidth > s.clientWidth && getComputedStyle(s).overflowX === 'auto'; })()"), true, 'the strip scrolls inside itself');
      await tab.shot('template-editor');
    } finally { await tab.close(); }
  });
  await shutdown(srv);
  srv = null;

  // ======== names with markup, odd addresses, what is left behind ========
  srv = await boot(0, { SIGNUP: 'on' });
  {
    const { port: p2, cookie: c2 } = srv;
    const MARK = '<img src=x onerror=__xss=1>';
    const as = (method, u, body) => call(p2, method, 'admin', u, body, { cookie: c2 });
    let r = await as('PUT', '/api/host/plans', { free: { name: 'Free', caps: {} }, mark: { name: MARK, caps: { modules: 'all', members: 5 } } });
    assert.equal(r.status, 200, r.text);
    // A template's name and description are plain text (plan-templates-redesign.md, step 1): markup is refused at the door.
    r = await as('POST', '/api/host/templates', { id: 'marked', name: MARK, description: `${MARK}<script>__xss=1</script>`, modules: { chat: {}, conference: {} } });
    assert.deepEqual([r.status, r.json.problems], [400, ['"name" must be plain text of 1 to 40 characters.', '"description" must be plain text of 1 to 200 characters.']], r.text);
    r = await as('POST', '/api/host/templates', { id: 'marked', name: 'Marked', description: 'Marked.', modules: { chat: {}, conference: {} } });
    assert.equal(r.status, 201, r.text);
    r = await as('POST', '/api/host/environments', { slug: 'marked', name: `${MARK}<script>__xss=1</script>`, plan: { name: 'mark', modules: 'all', members: 5 }, template: 'marked', owner: { login: 'own-marked', displayName: MARK, password: 'owner-password-1' } });
    assert.equal(r.status, 201, r.text);
    // An owner with no password yet (sign-up), for the first-password link.
    r = await call(p2, 'POST', '', '/api/product/signup', { slug: 'waiting', name: MARK, owner: { login: 'ownwaiting', displayName: MARK } });
    assert.equal(r.status, 201, r.text);
    const noScript = async (tab, where) => {
      await sleep(300);
      const found = await tab.evaluate("({ ran: typeof window.__xss !== 'undefined', imgs: document.querySelectorAll('img[src=\"x\"], script:not([src])').length })");
      assert.deepEqual(found, { ran: false, imgs: 0 }, `markup ran or was drawn as markup: ${where}`);
    };

    await test('names with markup are shown as text and never run', async () => {
      const tab = await openTab(p2, { cookie: c2 });
      try {
        for (const hash of ['#environments', '#environments/marked', '#environments/marked/plan', '#environments/marked/template', '#environments/marked/owners', '#environments/marked/backups', '#environments/marked/danger', '#environments/waiting/owners', '#templates', '#templates/marked', '#plans', '#modules', '#server']) {
          await tab.go(hash);
          await tab.waitFor(`${tab.visible('#host-main')} && document.querySelector('#hc-nav [aria-current=page]')`, hash);
          await sleep(500);
          await noScript(tab, hash);
        }
        await tab.go('#environments/marked');
        await tab.waitFor(`document.getElementById('env-title').textContent.length > 0`, 'the title');
        assert.equal(await tab.evaluate("document.getElementById('env-title').textContent"), `${MARK}<script>__xss=1</script>`, 'the name, as text');
        await tab.go('#environments');
        await tab.waitFor("document.querySelectorAll('#env-rows tr[data-slug]').length === 2", 'rows');
        await tab.evaluate("document.querySelector('#env-rows tr[data-slug=\"marked\"] [data-action=row-menu]').click()");
        await tab.waitFor("document.querySelectorAll('[role=menuitem]').length > 0", 'the menu');
        await tab.evaluate("[...document.querySelectorAll('[role=menuitem]')].find((e) => e.textContent.trim() === 'Delete').click()");
        await tab.waitFor("Boolean(document.querySelector('dialog.sdk-dialog-confirm'))", 'the Delete dialog');
        await noScript(tab, 'the Delete dialog');
        assert.equal(await tab.evaluate("document.querySelector('dialog.sdk-dialog-confirm .sdk-dialog-title').textContent"), `Delete ${MARK}<script>__xss=1</script>?`);
        assert.deepEqual(tab.problems, []);
      } finally { await tab.close(); }
    });

    await test('an address that is not valid percent-encoding falls back to Environments, on load and later', async () => {
      const tab = await openTab(p2, { cookie: c2 });
      try {
        for (const hash of ['#environments/%E0', '#templates/%E0']) {
          await tab.s('Page.navigate', { url: 'about:blank' }); // a fresh load, not a change of the hash
          await sleep(200);
          await tab.go(hash);
          await tab.waitFor(`${tab.visible('#env-list')} && location.hash === '#environments'`, `${hash} on load`);
        }
        await tab.go('#server');
        await tab.waitFor(tab.visible('#section-server'), 'Server');
        for (const hash of ['#environments/%E0', '#templates/%E0']) {
          await tab.go('#server');
          await tab.waitFor(tab.visible('#section-server'), 'Server');
          await tab.evaluate(`location.hash = ${JSON.stringify(hash)}`);
          await tab.waitFor(`${tab.visible('#env-list')} && location.hash === '#environments'`, `${hash} as a later change`);
        }
        assert.deepEqual(tab.problems, [], 'no error thrown');
      } finally { await tab.close(); }
    });

    await test('#templates/. and #templates/.. go back to the list and ask no route', async () => {
      const tab = await openTab(p2, { cookie: c2 });
      try {
        await tab.go('#templates');
        await tab.waitFor("document.querySelectorAll('#template-list tr[data-id]').length > 0", 'the templates');
        await tab.evaluate("window.__urls = []; { const f = window.fetch; window.fetch = (u, ...a) => { window.__urls.push(String(u)); return f(u, ...a); }; }");
        for (const id of ['.', '..']) {
          await tab.evaluate(`location.hash = ${JSON.stringify(`#templates/${id}`)}`);
          await tab.waitFor(`${tab.visible('#templates-list-view')} && location.hash === '#templates' && document.getElementById('templates-status').textContent === ${JSON.stringify(`There is no template called ${id}.`)}`, `#templates/${id}`);
          assert.equal(await tab.evaluate(tab.visible('#template-editor-view')), false, 'no editor');
        }
        // A fresh load too.
        await tab.s('Page.navigate', { url: 'about:blank' });
        await sleep(200);
        await tab.go('#templates/..');
        await tab.waitFor(`${tab.visible('#templates-list-view')} && location.hash === '#templates'`, '#templates/.. on load');
        await tab.evaluate("window.__urls = []; { const f = window.fetch; window.fetch = (u, ...a) => { window.__urls.push(String(u)); return f(u, ...a); }; }");
        await tab.evaluate("location.hash = '#templates/.'");
        await tab.waitFor("location.hash === '#templates'", 'back to the list');
        assert.deepEqual(await tab.evaluate("window.__urls.filter((u) => /\\/templates\\/\\.|\\/api\\/host\\/?$|\\/api\\/?$/.test(u))"), [], 'no request outside a template id');
        assert.deepEqual(tab.problems, []);
      } finally { await tab.close(); }
    });

    await test('a first-password link and a typed owner password are not kept after leaving or signing out', async () => {
      const tab = await openTab(p2, { cookie: c2 });
      const link = "document.querySelector('#environment-page [data-slot=\"first-password-url\"]')";
      const makeLink = async () => {
        await tab.go('#environments/waiting/owners');
        await tab.waitFor(tab.visible('#environment-page [data-action="first-password"]'), 'the first-password button');
        await tab.evaluate("document.querySelector('#environment-page [data-action=\"first-password\"]').click()");
        await tab.waitFor(`${link}.value.includes('first-password') || ${link}.value.length > 20`, 'the link shown');
      };
      try {
        await makeLink();
        await tab.evaluate("location.hash = '#environments'");
        await tab.waitFor(tab.visible('#env-list'), 'the list');
        assert.deepEqual(await tab.evaluate(`[${link}.value, ${link}.closest('[data-slot="first-password-made"]').hidden]`), ['', true], 'leaving the page drops the link');
        await makeLink();
        await tab.evaluate("location.hash = '#server'");
        await tab.waitFor(tab.visible('#section-server'), 'Server');
        assert.equal(await tab.evaluate(`${link}.value`), '', 'another section drops it too');
        // New environment: a typed owner password goes when the view is left.
        await tab.evaluate("location.hash = '#environments/new'");
        await tab.waitFor(tab.visible('#new-owner-password'), 'New environment');
        await tab.type('#new-owner-password', 'secret-password-1');
        await tab.evaluate("location.hash = '#plans'");
        await tab.waitFor(tab.visible('#section-plans'), 'Plans');
        assert.equal(await tab.evaluate("document.getElementById('new-owner-password').value"), '', 'the password is not kept in the hidden form');
        // Signing out drops both.
        await makeLink();
        await tab.evaluate("location.hash = '#environments/new'");
        await tab.waitFor(tab.visible('#new-owner-password'), 'New environment');
        await tab.type('#new-owner-password', 'secret-password-2');
        await tab.evaluate("location.hash = '#server'");
        await tab.waitFor(tab.visible('#host-logout'), 'Sign out');
        await makeLink();
        await tab.evaluate("location.hash = '#server'");
        await tab.waitFor(tab.visible('#host-logout'), 'Sign out');
        await tab.evaluate("document.getElementById('host-logout').click()");
        await tab.waitFor(tab.visible('#host-login'), 'the sign-in');
        assert.deepEqual(await tab.evaluate(`[${link}.value, document.getElementById('new-owner-password').value]`), ['', ''], 'nothing left after signing out');
        assert.deepEqual(tab.problems, []);
      } finally { await tab.close(); }
    });
  }
  await shutdown(srv);
  srv = null;

  // ======== 6, then none ========
  for (const [howMany, expect] of [[6, { pastDue: 2, deletion: 1, atCap: 1, nearCap: 1 }], [0, null]]) {
    srv = await boot(howMany);
    await test(`${howMany} environments`, async () => {
      for (const width of [1280, 390]) {
        const tab = await openTab(srv.port, { width, cookie: srv.cookie });
        try {
          await tab.go('#environments');
          if (howMany) {
            await tab.waitFor(`document.querySelectorAll('#env-rows tr[data-slug]').length === ${howMany}`, 'rows');
            assert.equal(await count(tab), `${howMany} of ${howMany} environments`);
            assert.deepEqual(await strip(tab), expect);
          } else {
            await tab.waitFor(tab.visible('#environments-empty'), 'the empty state');
            assert.equal(await tab.evaluate(tab.visible('#env-list')), false, 'no table');
          }
          assert.deepEqual(await tab.layoutProblems(), []);
          await tab.shot(`environments-${howMany}`);
        } finally { await tab.close(); }
      }
    });
    await shutdown(srv);
    srv = null;
  }
} catch (err) {
  failed += 1;
  console.error(`check-host-console: ${err.stack || err.message}`);
} finally {
  if (browser) {
    const done = new Promise((r) => browser.child.once('exit', r));
    browser.child.kill('SIGTERM'); // this browser only
    await Promise.race([done, sleep(5000)]);
    try { fs.rmSync(browser.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a browser still closing may hold its profile a moment longer */ }
  }
  await shutdown(srv);
}

// Restore: the "host backup" box is off by default and adds ?backup=1 to the restore request.
{
  const html = fs.readFileSync(new URL('../public/host.html', import.meta.url), 'utf8');
  const js = fs.readFileSync(new URL('../public/host.js', import.meta.url), 'utf8');
  assert.match(html, /<input id="env-restore-backup" type="checkbox">/);
  assert.ok(!/id="env-restore-backup"[^>]*checked/.test(html));
  assert.match(js, /\/restore\$\{\$\('env-restore-backup'\)\.checked \? '\?backup=1' : ''\}/);
  assert.match(js, /\$\('env-restore-backup'\)\.checked = false/);
  n++;
}

if (failed) {
  console.error(`check-host-console: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-host-console: ${n} OK${SHOTS ? ` (pictures in ${SHOTS})` : ''}`);
