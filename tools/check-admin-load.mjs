#!/usr/bin/env node
/*
 * check-admin-load.mjs -- the Manage page (and the other pages' main scripts) load and draw, in a headless browser against a
 * throwaway seeded server, at 1280 and 390. Why: a script that throws while it loads (for example a `let` read before its line
 * runs: "Cannot access 'x' before initialization") leaves a page blank, and no other check fails on it by name.
 *   - /admin, signed in as the owner: every top-level tab (Environment and its three parts, Template, Theme, the spaces tab,
 *     Roles, Users, Modules and each module's tab inside it, AI Assistant's among them, About) is opened;
 *   - the Name field holds the environment's name, the Template switch has choices, the Words section has rows, and the Theme
 *     swatches are not all black;
 *   - each tab's main data is there (the template's words, module names, reactions and icons; the theme list; the spaces, the roles,
 *     the users, the modules; About's libraries with LiveKit and Node.js, a Licence text control, the version line and the Troubleshooting links);
 *   - for every page: no uncaught error, no console.error, no failed request to /api (status 400 or more) from load to the end;
 *   - the other pages' main scripts, each loaded with no uncaught error: the home and the space, a module's page, the sign-in
 *     page, the guest landing, the shared-file page, the host console's page, the product start page and the registration page (there only an
 *     uncaught error or a console.error counts, not a 404 the page asks for on purpose).
 *
 *   node tools/check-admin-load.mjs        (no Chromium: SKIPPED, exit 0; that is a skip, never a pass)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stopBrowser } from './browser-launch.mjs';
import { findBrowser, launch, freePort, stopServer, bootSeeded, Tab, sleep, driveScreen } from './shots.mjs';

const say = (...a) => console.log('check-admin-load:', ...a);
const failures = [];
const expect = (ok, text) => { if (!ok) failures.push(text); };

// Everything the page does wrong from now on: uncaught errors, console.error, and answers of 400 or more from /api.
function watch(tab) {
  const problems = [];
  const urls = new Map();
  const listener = (m) => {
    if (m.sessionId !== tab.sid) return;
    if (m.method === 'Runtime.exceptionThrown') problems.push('uncaught: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    if (m.method === 'Network.responseReceived') {
      const { url, status } = m.params.response;
      if (status >= 400 && new URL(url).pathname.startsWith('/api/')) problems.push(`HTTP ${status} from ${new URL(url).pathname}`);
      urls.set(m.params.requestId, url);
    }
  };
  tab.cdp.listeners.push(listener);
  return { problems, stop: () => { tab.cdp.listeners = tab.cdp.listeners.filter((f) => f !== listener); } };
}

async function main() {
  const bin = findBrowser();
  if (!bin) { say('SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); return 0; }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-load-data-'));
  let server = null; let browser = null;
  try {
    const boot = await bootSeeded('travel', dataDir, await freePort());
    server = boot.server;
    const S = { base: server.base, ctx: boot.ctx, cookies: boot.cookies };
    const settings = await (await fetch(`${S.base}/api/settings`, { headers: { cookie: S.cookies.admin.map((c) => `${c.name}=${c.value}`).join('; ') } })).json();
    const envName = settings.settings.environmentName;
    expect(Boolean(envName), 'the throwaway environment has no name to compare with');

    // No company and no key, so the AI tab asks nobody outside (there is no network here) for a list of models.
    await fetch(`${S.base}/api/ai`, { method: 'PUT', headers: { cookie: S.cookies.admin.map((c) => `${c.name}=${c.value}`).join('; '), 'content-type': 'application/json', origin: S.base }, body: JSON.stringify({ provider: 'none', model: '', clearKey: true, source: 'custom', monthlyTokens: 0 }) });

    browser = await launch(bin);
    const open = async (size) => {
      const tab = new Tab(browser.cdp, S.ctx);
      await tab.open(size, 'dark', false);
      const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
      return tab;
    };

    for (const size of process.env.ADMIN_LOAD_SIZE ? [Number(process.env.ADMIN_LOAD_SIZE)] : [1280, 390]) {
      const tab = await open(size);
      const w = watch(tab);
      const at = (what) => (text) => expect(false, `${size}, ${what}: ${text}`);
      try {
        // Watching starts before the page does, so a script that throws on load is seen.
        await driveScreen(tab, { as: 'admin', url: '/admin', wait: '#set-environment-name' }, S.base, S.cookies, S.ctx);
        await sleep(2000);
        const loaded = await tab.eval(`({
          name: document.getElementById('set-environment-name').value,
          templates: document.getElementById('template-select').options.length,
          words: document.querySelectorAll('#words-list > *').length,
        })`);
        expect(loaded.name === envName, `${size}: the Name field is "${loaded.name}", not "${envName}"`);
        expect(loaded.templates > 0, `${size}: the Template switch has no choices`);
        expect(loaded.words > 0, `${size}: the Words section has no rows`);
        const seen = (what) => { const n = w.problems.length; return () => w.problems.slice(n).forEach(at(what)); };

        // Every top-level tab by its own button, and the parts inside Environment and Modules.
        const tabs = await tab.eval(`[...document.querySelectorAll('#subtabs .subtab')].map((b) => b.dataset.tab)`);
        for (const want of ['environment', 'template', 'theme', 'spaces', 'roles', 'users', 'modules', 'about']) expect(tabs.includes(want), `${size}: no ${want} tab`);
        const click = async (sel) => { await tab.eval(`document.querySelector(${JSON.stringify(sel)}).click()`); await sleep(700); };
        for (const t of tabs) {
          const done = seen(`the ${t} tab`);
          await click(`#subtabs .subtab[data-tab="${t}"]`);
          expect(await tab.eval(`!document.getElementById('tab-${t}').hidden`), `${size}: the ${t} tab did not open`);
          if (t === 'environment') {
            for (const p of await tab.eval(`[...document.querySelectorAll('#env-subtabs .subtab')].map((b) => b.dataset.envPart)`)) {
              await click(`#env-subtabs .subtab[data-env-part="${p}"]`);
              expect(await tab.eval(`!document.getElementById('env-part-${p}').hidden`), `${size}: the ${p} part of Environment did not open`);
            }
            await click('#env-subtabs .subtab[data-env-part="general"]');
          }
          if (t === 'theme') {
            const sw = await tab.eval(`[...document.querySelectorAll('#tab-theme input[type=color]')].map((i) => i.value)`);
            expect(sw.length > 5 && sw.some((v) => v !== '#000000'), `${size}: the Theme swatches are all black (${sw.length} of them)`);
          }
          if (t === 'modules') {
            for (const p of await tab.eval(`[...document.querySelectorAll('#module-subtabs .subtab')].map((b) => b.dataset.modulePart)`)) {
              await click(`#module-subtabs .subtab[data-module-part="${p}"]`);
              await sleep(500);
            }
            expect(await tab.eval(`[...document.querySelectorAll('#module-subtabs .subtab')].some((b) => b.dataset.modulePart === 'assistant')`), `${size}: no AI Assistant tab`);
            await click('#module-subtabs .subtab[data-module-part="config"]');
          }
          // The tab's main data is drawn, not only free of errors.
          const data = {
            environment: `document.getElementById('set-environment-name').value.length`,
            template: `document.getElementById('template-select').options.length + document.querySelectorAll('#words-list > *').length + document.querySelectorAll('#module-names > *').length + document.querySelectorAll('#reactions-list > *').length + document.querySelectorAll('#icons-list > *').length`,
            theme: `document.getElementById('theme-select').options.length`,
            spaces: `document.querySelectorAll('#spaces > *').length`,
            roles: `document.querySelectorAll('#roles-table tr').length`,
            users: `document.querySelectorAll('#users > *').length`,
            modules: `document.querySelectorAll('#modules-list > *').length`,
            about: `document.querySelectorAll('#credits-list .credit').length`,
          }[t];
          if (data) expect(await tab.eval(data) > 0, `${size}: the ${t} tab has none of its main data`);
          if (t === 'template') {
            for (const [id, what] of [['words-list', 'words'], ['module-names', 'module names'], ['reactions-list', 'reactions'], ['icons-list', 'icons']]) expect(await tab.eval(`document.getElementById('${id}').children.length`) > 0, `${size}: the Template tab shows no ${what}`);
          }
          if (t === 'about') {
            await sleep(800);
            const about = await tab.eval(`(() => { const rows = [...document.querySelectorAll('#credits-list .credit')]; const names = rows.map((r) => r.querySelector('strong')?.textContent || ''); return { rows: rows.length, livekit: names.some((n) => /livekit/i.test(n)), node: !!document.querySelector('#credits-section a[href*="nodejs.org"]'), licence: [...document.querySelectorAll('#credits-list summary')].filter((x) => x.textContent === 'Licence text').length, version: document.querySelector('#tab-about [data-brand=version]').textContent.trim(), trouble: [...document.querySelectorAll('#tab-about a[href*="diag.html"], #tab-about a[href*="layout=1"]')].length, status: document.getElementById('credits-status').textContent }; })()`);
            expect(about.rows > 5 && about.livekit && about.node, `${size}: About lists too few libraries, or not LiveKit (a row) and Node.js (the intro's link) (${JSON.stringify(about)})`);
            expect(about.licence > 0, `${size}: About has no "Licence text" control`);
            expect(about.version.length > 0, `${size}: About has no version line`);
            expect(about.trouble >= 3, `${size}: About's Troubleshooting links are missing (${about.trouble})`);
          }
          done();
        }
        // The tabs again by address, as a link opens them (the AI tab among them).
        for (const hash of ['environment', 'template', 'theme', 'spaces', 'roles', 'users', 'modules/assistant', 'about', 'general']) {
          const done = seen(`#${hash}`);
          await tab.eval(`location.hash = ${JSON.stringify(hash)}`); await sleep(700);
          done();
        }
        // The page's own load, reload and all, with nothing wrong anywhere.
        const done = seen('the reload');
        await tab.cdp.send('Page.reload', {}, tab.sid);
        await tab.waitFor('#set-environment-name'); await sleep(1500);
        expect(await tab.eval(`document.getElementById('set-environment-name').value`) === envName, `${size}: after a reload the Name field is not "${envName}"`);
        done();
        for (const p of w.problems) if (!failures.some((f) => f.includes(p))) expect(false, `${size}, /admin: ${p}`);
        say(`${size}: /admin loads, ${tabs.length} tabs open, ${loaded.words} words, ${loaded.templates} templates, name "${loaded.name}"`);
      } finally { w.stop(); await tab.close(); }

      // The other pages, one by one.
      const pages = [
        ['admin', '/'], ['admin', `/modules/travel?space=${S.ctx.trip}`], ['admin', `/?setup=${S.ctx.trip}`], ['mia', '/'],
        ['none', '/login'], ['none', '/guest'], ['none', '/shared/not-a-real-token'], ['none', '/host.html'], ['none', '/start.html'], ['none', '/register.html'],
      ];
      for (const [as, url] of pages) {
        const t = await open(size);
        const pw = watch(t);
        try {
          for (const c of S.cookies[as] || []) await t.cdp.send('Network.setCookie', { name: c.name, value: c.value, url: S.base, httpOnly: true }, t.sid);
          await t.cdp.send('Page.navigate', { url: S.base + url }, t.sid);
          await sleep(2500);
          // These pages ask for things that may not exist (a host console on a one-environment install has no /api/host; a module
          // looks for a map or a moved key), so a 404 from /api is not a fault here; an uncaught error or a console.error is.
          const bad = pw.problems.filter((p) => !/^HTTP /.test(p));
          for (const p of bad) expect(false, `${size}, ${url} as ${as}: ${p}`);
          say(`${size}: ${url} (${as}) ${bad.length ? 'PROBLEM' : 'loads'}`);
        } finally { pw.stop(); await t.close(); }
      }
    }
  } finally {
    if (browser) { browser.cdp.ws.close(); await stopBrowser(browser.child, browser.dir); }
    if (server) await stopServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  if (failures.length) { for (const f of [...new Set(failures)]) console.error('check-admin-load: FAIL ' + f); return 1; }
  say('OK');
  return 0;
}

main().then((c) => process.exit(c), (err) => { console.error(err); process.exit(1); });
