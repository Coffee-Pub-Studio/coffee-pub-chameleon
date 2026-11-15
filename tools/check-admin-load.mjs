#!/usr/bin/env node
/*
 * check-admin-load.mjs -- the Manage page (and the other pages' main scripts) load and draw, in a headless browser against a
 * throwaway seeded server, at 1280 and 390. Why: a script that throws while it loads (for example a `let` read before its line
 * runs: "Cannot access 'x' before initialization") leaves a page blank, and no other check fails on it by name.
 *   - /admin, signed in as the owner: every top-level tab (Environment and its three parts, Template, Theme, the spaces tab,
 *     Roles, Users, Modules and each module's tab inside it, AI Assistant's among them, About) is opened;
 *   - the Name field holds the environment's name, the Template switch has choices, and the Theme swatches are not all black;
 *   - the Template tab's pages (plan-templates-redesign.md, step 11a), each opened by its button and by its address, with its data
 *     drawn and no sideways scroll: the short Template page (the switch has no "none", the Default template among the choices,
 *     the switch for a space's own template), Environment Basics and Experience Labels for the Default template (read only),
 *     a shipped one (read only, Copy to change it) and an owner's own (fields, Save), the list of templates (Default first, the
 *     shipped ones, the owner's own with Delete), and the Default Workspace, Phases, Additional Reactions and Icons and Modules pages (step 11b);
 *   - each tab's main data is there (the template switch; the theme list; the spaces, the roles,
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

    // One template of the owner's own, copied from the Default template, so the pages show an editable one too.
    const asAdmin = { cookie: S.cookies.admin.map((c) => `${c.name}=${c.value}`).join('; '), 'content-type': 'application/json', origin: S.base };
    const copy = await fetch(`${S.base}/api/environment/templates`, { method: 'POST', headers: asAdmin, body: JSON.stringify({ from: 'default', id: 'mine', name: 'Mine' }) });
    expect(copy.status === 201, `could not copy the Default template: ${copy.status}`);

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
        })`);
        expect(loaded.name === envName, `${size}: the Name field is "${loaded.name}", not "${envName}"`);
        expect(loaded.templates > 0, `${size}: the Template switch has no choices`);
        const seen = (what) => { const n = w.problems.length; return () => w.problems.slice(n).forEach(at(what)); };

        // The Template tab's pages, by their buttons and by their addresses. Each draws its data and does not scroll sideways.
        const sideways = async (what) => { const w2 = await tab.eval(`document.documentElement.scrollWidth - document.documentElement.clientWidth`); expect(w2 <= 1, `${size}: ${what} scrolls sideways by ${w2} px`); };
        // A row of a page's tabs (Manage's Environment and Template rows): every tab inside the window, nothing scrolling sideways.
        // On a phone the row wraps and each tab's hit area (its box or its ::after) is 44 px tall; wider, it stays one line.
        const rowFits = async (id, what) => {
          const r = await tab.eval(`(() => { const v = innerWidth; const tabs = [...document.querySelectorAll('#${id} .subtab')].filter((b) => b.getClientRects().length);
            return { v, tabs: tabs.map((b) => { const a = getComputedStyle(b, '::after'); const q = b.getBoundingClientRect(); return { t: b.textContent.trim(), l: q.left, r: q.right, top: Math.round(q.top), h: Math.max(q.height, a.content !== 'none' && a.position === 'absolute' ? parseFloat(a.height) || 0 : 0) }; }) }; })()`);
          expect(r.tabs.length > 1, `${size}: ${what}: the row has no tabs drawn`);
          for (const t of r.tabs) {
            expect(t.l >= -0.5 && t.r <= r.v + 0.5, `${size}: ${what}: "${t.t}" is not inside the window (${Math.round(t.l)} to ${Math.round(t.r)} of ${r.v})`);
            if (size <= 640) expect(t.h >= 43.5, `${size}: ${what}: "${t.t}" is ${Math.round(t.h)} px tall (44 is the least)`);
          }
          if (size > 640) expect(new Set(r.tabs.map((t) => t.top)).size === 1, `${size}: ${what}: the row wraps on a wide screen`);
          await sideways(what);
        };
        const pages = async (sz, finish) => {
          const open2 = async (hash, ready, what) => {
            const left = seen(what);
            await tab.eval(`location.hash = ${JSON.stringify(hash)}`); await sleep(1200);
            expect(await tab.eval(ready), `${sz}: ${what} is not drawn (${hash})`);
            await sideways(what);
            left();
          };
          const box = (id, sel) => `document.querySelectorAll('#${id} ${sel}').length`;
          // Environment Basics: the Default template is read only, a shipped one read only with Copy, the owner's own has fields and Save.
          await open2('template/default/basics', `${box('tpl-basics-box', '.tf-line')} === 4 && ${box('tpl-basics-box', 'input')} === 0 && !!document.querySelector('#tpl-basics-card [data-tpl-copy]') && document.querySelector('#tpl-basics-card [data-tpl-save]').hidden`, 'Environment Basics of the Default template');
          await open2('template/travel/basics', `${box('tpl-basics-box', '.tf-line')} === 4 && document.querySelector('#tpl-basics-box dd').textContent.trim() === 'Travel'`, 'Environment Basics of a shipped template');
          await open2('template/mine/basics', `${box('tpl-basics-box', 'input[data-tf=name]')} === 1 && document.querySelector('#tpl-basics-box [data-tf=name]').value === 'Mine' && ${box('tpl-basics-box', '.icon-grid button')} > 5 && !document.querySelector('#tpl-basics-card [data-tpl-save]').hidden && ${box('tpl-basics-box', 'select[data-tf=profile]')} === 1`, 'Environment Basics of an owner\'s own template');
          // Experience Labels: the editable words, the locked words read only with a reason, no verbs.
          await open2('template/default/labels', `${box('tpl-labels-box', '.tf-line')} === 10 && ${box('tpl-labels-box', '.tf-locked-list .tf-line')} === 8 && ${box('tpl-labels-box', '.tf-locked .hint')} === 1 && !/enter|layout/i.test(document.querySelector('.tf-locked-list').textContent) && ${box('tpl-labels-box', 'input')} === 0`, 'Experience Labels of the Default template');
          // The environment's own template (travel here) also has the Home page's word and the Lobby's name and description.
          await open2('template/travel/labels', `${box('tpl-labels-box', '.tf-line')} === 13 && ${box('tpl-labels-box', '.tf-locked-list .tf-line')} === 8`, 'Experience Labels of the environment\'s own template');
          await open2('template/mine/labels', `${box('tpl-labels-box', '[data-tf-word]')} === 2 && ${box('tpl-labels-box', 'input[data-tf=lobby-name]')} === 0 && ${box('tpl-labels-box', '.tf-locked-list .tf-line')} === 8`, 'Experience Labels of an owner\'s own template');
          await open2('template/list', `${box('tpl-list', 'li')} >= 4 && document.querySelector('#tpl-list li').dataset.tpl === 'default' && !document.querySelector('#tpl-list li:first-child [data-tpl-action=delete]') && !!document.querySelector('#tpl-list li[data-tpl=mine] [data-tpl-action=delete]') && !!document.querySelector('#template-import')`, 'the list of templates');
          // The pages of step 11b: the Default Workspace, Phases, Additional Reactions and Icons (the core set and the template's; the owner's own are on the Environment tab), Modules.
          await open2('template/mine/workspace', `${box('tpl-workspace-box', '[data-tw-show]')} === 5 && !document.querySelector('#tpl-workspace-card [data-tpl-save]').hidden`, 'the Default Workspace of an owner\'s own template');
          await open2('template/mine/phases', `${box('tpl-phases-box', '[data-tp-measure]')} === 1`, 'the Phases of an owner\'s own template');
          await open2('template/default/phases', `${box('tpl-phases-box', 'input')} === 0 && ${box('tpl-phases-box', '.tf-line')} === 1`, 'the Phases of the Default template');
          await open2('template/travel/reactions', `${box('tpl-reactions-box', '.tp-chip')} > 20 && !document.getElementById('tpl-own-additions')`, 'the Additional Reactions and Icons of the environment\'s template');
          await open2('reactions', `!document.getElementById('env-part-reactions').hidden && document.getElementById('reactions-fixed').textContent.length > 0 && document.getElementById('icons-fixed').textContent.length > 0 && !!document.getElementById('reactions-list') && !!document.getElementById('icons-list')`, 'the Environment tab\'s Reactions and Icons');
          await open2('template/travel/modules', `${box('tpl-modules-box', '.tp-module')} > 3 && document.getElementById('module-names').children.length > 0 && !document.getElementById('module-names-section').hidden`, 'the Modules of the environment\'s template, with the module names');
          await open2('template/default/modules', `${box('tpl-modules-box', '.tp-module')} > 3 && ${box('tpl-modules-box', 'input')} === 0`, 'the Modules of the Default template');
          // The buttons of the strip reach the same pages.
          for (const part of await tab.eval(`[...document.querySelectorAll('#tpl-subtabs .subtab')].map((b) => b.dataset.tplPart)`)) {
            await click(`#tpl-subtabs .subtab[data-tpl-part="${part}"]`);
            expect(await tab.eval(`!document.getElementById('tpl-part-${part}').hidden`), `${sz}: the ${part} page of Template did not open`);
            await sideways(`the ${part} page of Template`);
          }
          await rowFits('tpl-subtabs', 'the Template row of tabs');
          // A copy through the page: the form takes a name and makes the template; Delete asks first and names what moves.
          await open2('template/list', `${box('tpl-list', 'li')} >= 4`, 'the list again');
          await tab.eval(`document.querySelector('#tpl-list li[data-tpl=travel] [data-tpl-action=copy]').click()`); await sleep(500);
          expect(await tab.eval(`!document.getElementById('tpl-copy-form').hidden && document.getElementById('tpl-copy-id').value.startsWith('travel-copy')`), `${sz}: Copy did not open its form with an id`);
          await tab.eval(`document.getElementById('tpl-copy-cancel').click()`);
          await tab.eval(`location.hash = 'template'`); await sleep(500);
          finish();
        };

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
            await rowFits('env-subtabs', 'the Environment row of tabs');
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
            template: `document.getElementById('template-select').options.length`,
            theme: `document.getElementById('theme-select').options.length`,
            spaces: `document.querySelectorAll('#spaces > *').length`,
            roles: `document.querySelectorAll('#roles-table tr').length`,
            users: `document.querySelectorAll('#users > *').length`,
            modules: `document.querySelectorAll('#modules-list > *').length`,
            about: `document.querySelectorAll('#credits-list .credit').length`,
          }[t];
          if (data) expect(await tab.eval(data) > 0, `${size}: the ${t} tab has none of its main data`);
          if (t === 'template') {
            // The short page: no "none", Default among the choices and the chosen one, the switch for a space's own template.
            const main = await tab.eval(`({ values: [...document.getElementById('template-select').options].map((o) => o.value), chosen: document.getElementById('template-select').value, own: !!document.getElementById('set-space-templates'), made: document.getElementById('template-made').textContent })`);
            expect(!main.values.includes('none') && main.values.includes('default') && main.values.includes('travel') && main.values.includes('mine'), `${size}: the Template switch lists ${main.values.join(', ')}`);
            expect(main.own && /Uses the .+ template/.test(main.made), `${size}: the short Template page is not drawn (${JSON.stringify(main)})`);
            await pages(size, () => {});
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
        say(`${size}: /admin loads, ${tabs.length} tabs open, ${loaded.templates} templates, name "${loaded.name}"`);
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
