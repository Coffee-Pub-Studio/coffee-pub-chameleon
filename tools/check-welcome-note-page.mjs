#!/usr/bin/env node
/*
 * check-welcome-note-page.mjs -- the welcome note's pages (GitHub #870), live in headless Chromium against a throwaway server:
 *   - Manage > Environment > Welcome note: the owner (the admin's stand-in on a single install) types a note, sees the count,
 *     saves it (the box then holds the server's cleaned text), and Remove clears it; a member has no Manage page;
 *   - a member signing in sees the note once in the SDK's dialog (hostText.markdown only: a script in the text is text, a
 *     mailto link is a link), "Got it" is kept on the server (a reload shows nothing), the Welcome entry in the account menu
 *     opens it again and Escape closes it; with no note there is no Welcome entry;
 *   - at 390 wide: Got it is at least 44px tall, nothing scrolls sideways, and Welcome is in the header's menu;
 *   - a signed-out caller is refused (401). A guest's sessionStorage mark is NOT driven here (read as code only);
 *   - the Markdown reader links mailto: and still turns javascript: into plain words.
 * `--shots=<dir>`: also writes pictures (the Manage section, the dialog light and dark, the Welcome entry) at 1280 and 390.
 * With no Chromium it says SKIPPED (not a pass).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stopBrowser } from './browser-launch.mjs';
import { findBrowser, launch, freePort, startServer, stopServer, Tab, sleep } from './shots.mjs';
import { PASSWORD } from './shots-seed.mjs';

const say = (...a) => console.log('check-welcome-note-page:', ...a);
const failures = [];
const expect = (ok, text) => { if (!ok) failures.push(text); };
const shotsArg = process.argv.find((a) => a.startsWith('--shots='));
const SHOTS = shotsArg ? path.resolve(shotsArg.slice('--shots='.length)) : '';
const NOTE = 'Welcome to the **campaign**. <script>window.__pwn = 1</script>\n\n- bring dice\n- be kind\n\nWrite to [the owner](mailto:owner@example.com) or read [the rules](https://example.com/rules).';

async function main() {
  const bin = findBrowser();
  if (!bin) { say('SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); return 0; }
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'welcome-page-data-'));
  let server = null; let browser = null;
  try {
    server = await startServer(dataDir, await freePort(), 'first');
    const jars = {};
    const call = async (as, method, url, body) => {
      const headers = { 'content-type': 'application/json', accept: 'application/json', origin: server.base };
      if (jars[as]) headers.cookie = jars[as].map((c) => `${c.name}=${c.value}`).join('; ');
      const res = await fetch(server.base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      let json = null; try { json = await res.json(); } catch { /* none */ }
      return { status: res.status, json, res };
    };
    const signIn = async (login) => {
      const r = await call('__none', 'POST', '/api/login', { login, password: PASSWORD });
      expect(r.status === 200, `cannot sign in as ${login}: ${r.status}`);
      jars[login] = r.res.headers.getSetCookie().map((c) => { const [nv] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1) }; });
    };
    await signIn('admin');
    expect((await call('admin', 'POST', '/api/users', { login: 'mia', displayName: 'Mia', role: 'member', password: PASSWORD })).status === 201, 'could not make the member');
    await signIn('mia');

    browser = await launch(bin);
    const open = async (size, mode, as) => {
      const tab = new Tab(browser.cdp, {});
      await tab.open(size, mode, false);
      for (const c of jars[as] || []) await tab.cdp.send('Network.setCookie', { name: c.name, value: c.value, url: server.base, httpOnly: true }, tab.sid);
      const problems = [];
      tab.cdp.listeners.push((m) => {
        if (m.sessionId !== tab.sid) return;
        if (m.method === 'Runtime.exceptionThrown') problems.push('uncaught: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
      });
      tab.problems = problems;
      return tab;
    };
    const go = async (tab, url) => { await tab.cdp.send('Page.navigate', { url: server.base + url }, tab.sid); await sleep(300); await tab.settle(); };
    const shot = async (tab, name) => { if (SHOTS) fs.writeFileSync(path.join(SHOTS, `${name}.png`), await tab.shoot(false)); };
    const dialogOpen = (tab) => tab.eval(`!!document.querySelector('dialog.sdk-dialog-confirm[open]')`);
    const waitDialog = async (tab, on, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await dialogOpen(tab) === on) return true; await sleep(100); } return false; };

    // The owner, before any note: Manage > Environment > Welcome note.
    for (const size of [1280, 390]) {
      const tab = await open(size, 'dark', 'admin');
      await go(tab, '/admin#welcome');
      await tab.waitFor('#set-welcome').catch(async (e) => { throw new Error(e.message + ' at ' + await tab.eval('location.href + " " + document.title + " " + document.body.innerText.slice(0,200) + " " + document.querySelectorAll("textarea").length') + ' ' + tab.problems.join(';')); });
      expect(await tab.eval(`!document.getElementById('env-part-welcome').hidden && document.querySelector('#env-subtabs .subtab.active').dataset.envPart === 'welcome'`), `${size}: the Welcome note part did not open by its address`);
      expect(await tab.eval(`document.getElementById('remove-welcome').hidden`), `${size}: Remove shows with no note`);
      if (size === 1280) await shot(tab, 'manage-welcome-empty-1280-dark');
      await tab.typeInto('#set-welcome', 'Hello');
      expect(/^5 of 4000 characters$/.test(await tab.eval(`document.getElementById('welcome-count').textContent`)), `${size}: the count is not "5 of 4000 characters"`);
      await tab.eval(`(() => { const t = document.getElementById('set-welcome'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await tab.eval(`(() => { const t = document.getElementById('set-welcome'); t.value = ${JSON.stringify(NOTE)}; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await tab.click('#save-welcome');
      await tab.waitFor('#remove-welcome:not([hidden])');
      const kept = await tab.eval(`document.getElementById('set-welcome').value`);
      expect(!kept.includes('<script>') && kept.includes('**campaign**'), `${size}: the box does not show the server's cleaned text (${kept.slice(0, 60)})`);
      expect(await tab.eval(`document.getElementById('welcome-status').textContent`) === 'saved', `${size}: no "saved" after Save`);
      await shot(tab, `manage-welcome-${size}-dark`);
      // Over the length: the count turns to the error and Save is off.
      await tab.eval(`(() => { const t = document.getElementById('set-welcome'); t.value = 'x'.repeat(4001); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      expect(await tab.eval(`document.getElementById('save-welcome').disabled && document.getElementById('welcome-count').classList.contains('error')`), `${size}: over the length, Save is not off`);
      expect(await tab.eval(`document.documentElement.scrollWidth - document.documentElement.clientWidth`) <= 1, `${size}: Manage scrolls sideways`);
      await tab.click('#remove-welcome');
      await sleep(600);
      expect(await tab.eval(`document.getElementById('remove-welcome').hidden && document.getElementById('set-welcome').value === ''`), `${size}: Remove did not clear the note`);
      expect((await call('admin', 'GET', '/api/environment/welcome')).json.note === null, `${size}: Remove did not remove the note on the server`);
      expect(tab.problems.length === 0, `${size}: Manage: ${tab.problems.join('; ')}`);
      await tab.close();
    }

    // A member: no Manage page, no way to save, and the note once.
    expect((await call('mia', 'PUT', '/api/environment/welcome', { text: 'x' })).status === 403, 'a member could save the note');
    for (const size of [1280, 390]) {
      await call('admin', 'PUT', '/api/environment/welcome', { text: NOTE });
      await call('admin', 'POST', '/api/users', { login: `m${size}`, displayName: `M${size}`, role: 'member', password: PASSWORD });
      await signIn(`m${size}`);
      const tab = await open(size, 'dark', `m${size}`);
      await go(tab, '/');
      expect(await waitDialog(tab, true), `${size}: the member's first sign-in showed no note`);
      const d = await tab.eval(`(() => { const dlg = document.querySelector('dialog.sdk-dialog-confirm[open]'); const b = dlg.querySelector('[data-ok]'); const r = b.getBoundingClientRect(); return { title: dlg.querySelector('.sdk-dialog-title').textContent, text: dlg.querySelector('.sdk-welcome').textContent, scripts: dlg.querySelectorAll('script').length, strong: dlg.querySelectorAll('strong').length, items: dlg.querySelectorAll('li').length, mailto: [...dlg.querySelectorAll('a')].map((a) => a.getAttribute('href')), ok: b.textContent, h: r.height, cancel: !!dlg.querySelector('.sdk-dialog-foot .btn:not([data-ok])'), focused: document.activeElement === b, pwn: window.__pwn || 0, wide: document.documentElement.scrollWidth - document.documentElement.clientWidth }; })()`);
      expect(d.title === 'Welcome' && d.ok === 'Got it' && !d.cancel, `${size}: the dialog is not "Welcome" with only "Got it" (${d.title}, ${d.ok})`);
      expect(d.strong === 1 && d.items === 2 && d.mailto.includes('mailto:owner@example.com') && d.mailto.includes('https://example.com/rules'), `${size}: the note is not drawn as Markdown (${JSON.stringify(d)})`);
      expect(d.scripts === 0 && d.pwn === 0, `${size}: a script in the note ran or was added`);
      expect(d.focused, `${size}: focus is not on Got it`);
      if (size === 390) expect(d.h >= 43.5, `${size}: Got it is ${d.h} px tall (44 is the least)`);
      expect(d.wide <= 1, `${size}: the dialog's page scrolls sideways`);
      await shot(tab, `dialog-${size}-dark`);
      await tab.switchMode('light'); await tab.settle();
      await shot(tab, `dialog-${size}-light`);
      await tab.click('[data-ok]');
      expect(await waitDialog(tab, false), `${size}: Got it did not close the dialog`);
      await sleep(400);
      expect((await call(`m${size}`, 'GET', '/api/environment/welcome')).json.seen === true, `${size}: Got it was not kept on the server`);
      await go(tab, '/');
      await sleep(1500);
      expect(!(await dialogOpen(tab)), `${size}: the note came back after a reload`);
      // The Welcome entry.
      if (size === 1280) {
        await tab.click('#whoami-link');
        await tab.waitFor('.host-menu [role=menuitem]', 'Welcome');
        expect(await tab.eval(`!!document.querySelector('#nav-toggle') && true`) !== null, 'sanity');
        await shot(tab, 'welcome-entry-1280-dark');
        await tab.click('.host-menu [role=menuitem]', 'Welcome');
      } else {
        await tab.click('#nav-toggle');
        await tab.waitFor('#account-welcome');
        expect(await tab.eval(`document.querySelector('#account-welcome').getBoundingClientRect().height`) >= 43.5, `${size}: the Welcome entry is under 44 px tall`);
        await shot(tab, 'welcome-entry-390-dark');
        await tab.click('#account-welcome');
      }
      expect(await waitDialog(tab, true), `${size}: the Welcome entry did not open the note`);
      await tab.key('Escape');
      expect(await waitDialog(tab, false), `${size}: Escape did not close the note`);
      expect(await tab.eval(`document.querySelectorAll('dialog.sdk-dialog-confirm').length`) === 0, `${size}: a dialog is left in the page`);
      // A member has no Manage.
      await go(tab, '/admin');
      await sleep(800);
      expect(await tab.eval(`!document.getElementById('set-welcome') && !document.getElementById('env-subtabs')`), `${size}: a member is given the Manage page`);
      expect(tab.problems.length === 0, `${size}: ${tab.problems.join('; ')}`);
      await tab.close();
    }

    // The reader: mailto links, javascript: stays words, a script is text.
    {
      const tab = await open(1280, 'dark', 'mia');
      await go(tab, '/');
      const r = await tab.eval(`({ a: hostText.markdown('[mail](mailto:a@b.co?subject=x)'), b: hostText.markdown('[x](javascript:alert(1))'), c: hostText.markdown('<img src=x onerror=alert(1)> "q"') })`);
      expect(/<a href="mailto:a@b\.co\?subject=x"/.test(r.a), `a mailto link is not linked: ${r.a}`);
      expect(!/<a /.test(r.b) && !/<img/.test(r.c) && r.c.includes('&lt;img'), `the reader let a bad link or tag through: ${r.b} ${r.c}`);
      await tab.close();
    }

    // No note: no Welcome entry and no dialog.
    {
      await call('admin', 'PUT', '/api/environment/welcome', { text: '' });
      const tab = await open(1280, 'dark', 'mia');
      await go(tab, '/');
      await sleep(1500);
      expect(!(await dialogOpen(tab)), 'a dialog shows with no note');
      await tab.click('#whoami-link');
      await tab.waitFor('.host-menu [role=menuitem]');
      expect(!(await tab.eval(`[...document.querySelectorAll('.host-menu [role=menuitem]')].some((e) => /Welcome/.test(e.textContent))`)), 'a Welcome entry shows with no note');
      await shot(tab, 'no-welcome-entry-1280-dark');
      await tab.close();
    }

    // A signed-out caller.
    {
      await call('admin', 'PUT', '/api/environment/welcome', { text: NOTE });
      const guest = await call('__none', 'GET', '/api/environment/welcome');
      expect(guest.status === 401, `a signed-out caller was answered ${guest.status}`);
    }
  } finally {
    if (browser) await stopBrowser(browser.child, browser.dir);
    await stopServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  if (failures.length) { for (const f of failures) console.error('check-welcome-note-page: ' + f); return 1; }
  say('ok');
  return 0;
}
process.exitCode = await main();
