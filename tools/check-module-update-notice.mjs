#!/usr/bin/env node
/*
 * check-module-update-notice.mjs -- Manage > Modules says so when an installed module is older than the copy this server ships.
 *   - compareVersions compares by number (0.16.9 is older than 0.16.13), never as text;
 *   - against a throwaway server: an older copy of a bundled module is installed, and the Modules page (1280 and 390) shows,
 *     on its row, "Newer version available: <shipped>. You have <installed>." and an Update button; one line above the
 *     filters says "1 module has a newer version."; an up to date module's row shows nothing;
 *   - pressing Update installs the shipped version by the same route Install uses (POST /api/modules/bundled/:id/install),
 *     the notice goes and the line above the filters goes with it.
 *
 *   node tools/check-module-update-notice.mjs        (no Chromium: only the comparison runs, and it says so)
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
const { compareVersions } = require('../server/modules.js');
const { buildModule } = require('../server/module-build.js');
const say = (...a) => console.log('check-module-update-notice:', ...a);
const failures = [];
const expect = (ok, text) => { if (!ok) failures.push(text); };

expect(compareVersions('0.16.9', '0.16.13') < 0, '0.16.9 is not older than 0.16.13');
expect(compareVersions('0.16.13', '0.16.9') > 0, '0.16.13 is not newer than 0.16.9');
expect(compareVersions('0.16.13', '0.16.13') === 0, 'equal versions do not compare equal');
expect(compareVersions('1.2.0', '0.99.99') > 0, '1.2.0 is not newer than 0.99.99');

async function main() {
  const bin = findBrowser();
  if (!bin) { say('no Chromium (set CHROME_PATH): only the comparison ran, the page was not looked at.'); return 0; }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-notice-data-'));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'update-notice-mod-'));
  let server = null; let browser = null;
  try {
    const boot = await bootSeeded('travel', dataDir, await freePort());
    server = boot.server;
    const S = { base: server.base, ctx: boot.ctx, cookies: boot.cookies };
    const headers = { cookie: S.cookies.admin.map((c) => `${c.name}=${c.value}`).join('; '), origin: S.base };
    const call = async (method, url, body, type = 'application/json') => {
      const r = await fetch(S.base + url, { method, headers: { ...headers, 'content-type': type }, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
      return { status: r.status, json: await r.json().catch(() => ({})) };
    };
    // "stale" is installed from an older build of its own folder; "fresh" from the shipped copy.
    const state = async () => (await call('GET', '/api/modules')).json;
    const version = async (id) => (await state()).modules.find((x) => x.id === id)?.version;
    // Two modules the seed did not install (an installed one will not take an older copy over it).
    const [stale, fresh] = (await call('GET', '/api/modules')).json.bundled.filter((b) => !b.installed && !b.notInPlan && !(b.requires || []).length).map((b) => b.id);
    expect(Boolean(stale && fresh), 'the throwaway environment has no two modules left to install');
    const shipped = JSON.parse(fs.readFileSync(path.join(root, 'modules', stale, 'module.json'), 'utf8')).version;
    fs.cpSync(path.join(root, 'modules', stale), path.join(scratch, stale), { recursive: true });
    const manifest = path.join(scratch, stale, 'module.json');
    const m = JSON.parse(fs.readFileSync(manifest, 'utf8')); m.version = '0.0.9'; fs.writeFileSync(manifest, JSON.stringify(m));
    const up = await call('POST', '/api/modules', buildModule(path.join(scratch, stale)).zip, 'application/zip');
    expect(up.status === 201, `could not install the older copy: ${up.status} ${up.json.error || ''}`);
    expect((await call('POST', `/api/modules/bundled/${fresh}/install`)).status === 201, 'could not install the shipped copy of the second module');
    expect(await version(stale) === '0.0.9', 'the older copy is not the installed one');

    browser = await launch(bin);
    for (const size of [1280, 390]) {
      const tab = new Tab(browser.cdp, S.ctx);
      await tab.open(size, 'dark', false);
      try {
        await driveScreen(tab, { as: 'admin', url: '/admin#modules', wait: '#set-environment-name' }, S.base, S.cookies, S.ctx);
        await sleep(2000);
        const look = () => tab.eval(`(() => { const line = document.getElementById('modules-newer'); const row = (id) => document.querySelector('#modules-list .module-card[data-id="' + id + '"] .module-update');
          const r = row(${JSON.stringify(stale)}); const b = r && r.querySelector('button');
          return { line: line.hidden ? '' : line.textContent, stale: r ? r.textContent.replace(/\\s+/g, ' ').trim() : null, button: b ? b.textContent.trim() : null, fresh: !!row(${JSON.stringify(fresh)}), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }; })()`);
        let seen = await look();
        expect(seen.line === '1 module has a newer version.', `${size}: the line above the filters is "${seen.line}"`);
        expect(seen.stale && seen.stale.includes(`Newer version available: ${shipped}. You have 0.0.9.`), `${size}: the row says "${seen.stale}"`);
        expect(seen.button === 'Update', `${size}: the button is "${seen.button}"`);
        expect(!seen.fresh, `${size}: an up to date module shows a notice`);
        expect(seen.overflow <= 1, `${size}: the page scrolls sideways by ${seen.overflow} px`);
        if (process.env.SHOT) await tab.eval(`document.querySelector('#modules-list .module-update').scrollIntoView({ block: 'center' })`);
        if (process.env.SHOT) fs.writeFileSync(`${process.env.SHOT}-${size}.png`, Buffer.from((await tab.cdp.send('Page.captureScreenshot', { format: 'png' }, tab.sid)).data, 'base64'));
        if (size === 390) {
          await tab.eval(`document.querySelector('#modules-list .module-card[data-id="${stale}"] .module-update button').click()`);
          await sleep(3000);
          expect(await version(stale) === shipped, `Update did not install ${shipped} (installed: ${await version(stale)})`);
          seen = await look();
          expect(seen.line === '' && seen.stale === null, `after Update the notice stays (${JSON.stringify(seen)})`);
        }
      } finally { await tab.close(); }
    }
  } finally {
    if (browser) { browser.cdp.ws.close(); await stopBrowser(browser.child, browser.dir); }
    if (server) await stopServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  if (failures.length) { for (const f of [...new Set(failures)]) console.error('check-module-update-notice: FAIL ' + f); return 1; }
  say('OK');
  return 0;
}
main().then((c) => process.exit(c), (err) => { console.error(err); process.exit(1); });
