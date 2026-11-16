#!/usr/bin/env node
/*
 * check-starter-offer-pages.mjs -- the pages' half of the starter-space offer (documentation/plans/plan-templates-redesign.md,
 * "starter spaces are offered, unticked, on a switch"): Manage > Template's offer panel and the host console's Review.
 *
 * Part 1, in node: the confirm body carries offerId and version as the offer gave them and starterSpaces (the ticked indexes);
 * the group is drawn only when the offer has starter spaces, unticked, one 44 px row each; a refusal (409) re-reads the offer.
 *
 * Part 2, a browser under throwaway servers (skipped, never passed, with no Chromium), at 1280 and 390 for the owner's page and
 * at 1280 for the console: an owner's template with 3 starter spaces; switching to it shows the group unticked; confirming with
 * none ticked makes no space; away and back, one ticked makes exactly that one, once, and the status line names it; a stale
 * confirm (the template's version bumped by the API between open and confirm) shows the server's refusal in the panel, makes
 * nothing and reads the offer again (the new offer id and version); the console's Review shows the same group. The owner here
 * is the environment's admin account (the seeded one), who has the owner's rights.
 *
 *   node tools/check-starter-offer-pages.mjs     (the browser part runs under the browser lock, one browser at a time)
 *   STARTER_PAGES_SHOTS=<dir>  also writes a picture of the offer at each width
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopBrowser } from './browser-launch.mjs';
import { findBrowser, launch, freePort, stopServer, bootSeeded, Tab, sleep, driveScreen } from './shots.mjs';
import * as hostSeed from './host-console-seed.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let n = 0;
const failures = [];
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failures.push(`${name}: ${err.stack || err.message}`); }
};
const say = (...a) => console.log('check-starter-offer-pages:', ...a);
const SHOT_DIR = process.env.STARTER_PAGES_SHOTS || '';
if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true });
const STARTERS = [{ name: 'Kickoff', description: 'Where the project begins.' }, { name: 'Planning' }, { name: 'Retro', description: 'Look back.' }];

// --- part 1: the files ---------------------------------------------------------------------------------------------------
await test('the confirm sends offerId, version and the ticked starter indexes; the group is drawn only with starter spaces', () => {
  const offer = read('public/template-offer.js');
  assert.match(offer, /offerId: offer && offer\.offerId/);
  assert.match(offer, /version: offer && offer\.version/);
  assert.match(offer, /starterSpaces: \[\.\.\.box\.querySelectorAll\('\[data-offer-starter\]:checked'\)\]\.map\(\(i\) => Number\(i\.dataset\.offerStarter\)\)/);
  assert.match(offer, /starters\.length \? `<div class="offer-group" data-offer-starters>/);
  assert.doesNotMatch(offer, /data-offer-starter[^>]*checked>/, 'nothing is ticked by default');
  assert.match(offer, /to start with/);
  assert.match(offer, /Tick the ones to make now\. They are made once; each starts with what the template gives it\./);
  for (const f of ['public/admin.js', 'public/host.js']) {
    const src = read(f);
    assert.match(src, /err\.status !== 409/, `${f} handles a refusal`);
    assert.match(src, /madeSentence\(/, `${f} says what was made`);
  }
  assert.match(read('public/style.css'), /\.tp-checks \.sdk-choice-row, \.template-offer \.sdk-choice-row,/, '44 px rows on a phone');
});

// --- part 2: a browser ---------------------------------------------------------------------------------------------------
const bin = findBrowser();
if (!bin) say('The browser part was SKIPPED: no Chromium found (set CHROME_PATH). That is not a pass; nothing of it was measured.');
else { await owner(); await host(); }

async function shotOf(cdp, sid, name) {
  if (!SHOT_DIR) return;
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sid);
  fs.writeFileSync(path.join(SHOT_DIR, `${name}.png`), Buffer.from(r.data, 'base64'));
}

async function owner() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starter-pages-data-'));
  let server = null; let browser = null;
  try {
    const boot = await bootSeeded('travel', dataDir, await freePort());
    server = boot.server;
    const S = { base: server.base, ctx: boot.ctx, cookies: boot.cookies };
    const cookie = S.cookies.admin.map((c) => `${c.name}=${c.value}`).join('; ');
    const api = async (method, url, body) => {
      const r = await fetch(S.base + url, { method, headers: { cookie, origin: S.base, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
      let json = null; try { json = await r.json(); } catch { /* none */ }
      return { status: r.status, json };
    };
    await api('PUT', '/api/ai', { provider: 'none', model: '', clearKey: true, source: 'custom', monthlyTokens: 0 });
    assert.equal((await api('POST', '/api/environment/templates', { from: 'default', id: 'startr', name: 'Startr' })).status, 201);
    const set = await api('PATCH', '/api/environment/templates/startr', { starterSpaces: STARTERS });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    const MARKUP = '&lt;img src=x onerror=1&gt;';
    assert.equal((await api('POST', '/api/environment/templates', { from: 'default', id: 'markup', name: 'Markup' })).status, 201);
    assert.equal((await api('PATCH', '/api/environment/templates/markup', { starterSpaces: [{ name: MARKUP, description: '&lt;b&gt;bold&lt;/b&gt;' }] })).status, 200);
    const spaceNames = async () => (await api('GET', '/api/spaces')).json.spaces.map((s) => s.name);

    browser = await launch(bin);
    for (const size of [1280, 390]) {
      const tab = new Tab(browser.cdp, S.ctx);
      await tab.open(size, 'dark', false);
      const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
      const problems = [];
      tab.cdp.listeners.push((m) => {
        if (m.sessionId !== tab.sid) return;
        if (m.method === 'Runtime.exceptionThrown') problems.push('uncaught: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
        if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
      });
      const before = (await spaceNames()).length;
      const planningBefore = (await spaceNames()).filter((x) => x === 'Planning').length;
      const posts = [];
      tab.cdp.listeners.push((m) => { if (m.sessionId === tab.sid && m.method === 'Network.requestWillBeSent' && m.params.request.method === 'POST' && /template\/apply$/.test(m.params.request.url)) posts.push(m.params.request.url); });
      const at = (what) => `${size}: ${what}`;
      const ev = (expr) => tab.eval(expr);
      const waitFor = async (expr, what, ms = 15000) => {
        const end = Date.now() + ms;
        while (!(await ev(expr).catch(() => false))) { if (Date.now() > end) throw new Error(`timed out: ${what}`); await sleep(100); }
      };
      const switchTo = async (id) => {
        await ev(`(() => { const s = document.getElementById('template-select'); s.value = ${JSON.stringify(id)}; s.dispatchEvent(new Event('change')); document.getElementById('template-switch').click(); return true; })()`);
        await waitFor("Boolean(document.querySelector('dialog.sdk-dialog-confirm'))", 'the switch question');
        await ev("document.querySelector('dialog.sdk-dialog-confirm [data-ok]').click()");
        await waitFor(`document.getElementById('template-status').textContent.startsWith('Switched to ')`, `switched to ${id}`);
      };
      const rows = () => ev("[...document.querySelectorAll('#template-offer [data-offer-starter]')].map((i) => ({ index: i.dataset.offerStarter, checked: i.checked, name: i.closest('label').querySelector('strong').textContent, hint: i.closest('label').querySelector('.hint')?.textContent || '', h: Math.round(i.closest('label').getBoundingClientRect().height) }))");
      try {
        await driveScreen(tab, { as: 'admin', url: '/admin', wait: '#set-environment-name' }, S.base, S.cookies, S.ctx);
        await sleep(1200);
        await ev("location.hash = 'template'"); await sleep(1000);
        await test(at('switching to a template with starter spaces offers them, unticked'), async () => {
          await switchTo('startr');
          await waitFor("document.querySelectorAll('#template-offer [data-offer-starter]').length === 3", 'the starter rows');
          const r = await rows();
          assert.deepEqual(r.map((x) => [x.name, x.checked]), [['Kickoff', false], ['Planning', false], ['Retro', false]]);
          assert.equal(r[0].hint, 'Where the project begins.');
          assert.match(await ev("document.querySelector('#template-offer [data-offer-starters] .field-label').textContent"), /^Spaces to start with$/);
          assert.match(await ev("document.querySelector('#template-offer [data-offer-starters] > .hint').textContent"), /^Tick the ones to make now\./);
          if (size < 640) for (const x of r) assert.ok(x.h >= 44, `a row is ${x.h}px tall`);
          assert.ok(await ev('document.documentElement.scrollWidth - document.documentElement.clientWidth') <= 1, 'no sideways scroll');
          await ev("document.getElementById('template-offer').scrollIntoView()");
          await shotOf(tab.cdp, tab.sid, `${size}-offer-with-starters`);
        });
        await test(at('confirming with none ticked makes no space'), async () => {
          await ev("document.querySelector('#template-offer [data-offer-apply]').click()");
          await waitFor("document.getElementById('template-status').textContent.startsWith('Applied')", 'applied');
          assert.doesNotMatch(await ev("document.getElementById('template-status').textContent"), /Made/);
          assert.equal((await spaceNames()).length, before);
        });
        await test(at('away and back, one ticked: exactly that space is made, once, and the line says so'), async () => {
          await switchTo('default');
          await switchTo('startr');
          await waitFor("document.querySelectorAll('#template-offer [data-offer-starter]').length === 3", 'the starter rows again');
          assert.ok((await rows()).every((x) => !x.checked), 'unticked again');
          await ev("document.querySelector('#template-offer [data-offer-starter=\"1\"]').click()");
          await ev("document.querySelector('#template-offer [data-offer-apply]').click()");
          await waitFor("/Made 1 /.test(document.getElementById('template-status').textContent)", 'the made line');
          const line = await ev("document.getElementById('template-status').textContent");
          assert.match(line, /Made 1 space: Planning\./);
          const now = await spaceNames();
          assert.equal(now.filter((x) => x === 'Planning').length, planningBefore + 1);
          assert.equal(now.length, before + 1);
          // the Spaces list on the page follows
          assert.ok(await ev("document.body.textContent.includes('Planning')"), 'the page lists it');
          await ev("document.getElementById('template-select').focus()");
        });
        await test(at('a stale confirm shows the refusal in the panel, makes nothing and reads the offer again'), async () => {
          await switchTo('default');
          await switchTo('startr');
          await waitFor("document.querySelectorAll('#template-offer [data-offer-starter]').length === 3", 'the starter rows');
          const was = (await api('GET', '/api/environment/template')).json.offer;
          const bump = await api('PATCH', '/api/environment/templates/startr', { description: `Changed at ${size}.` });
          assert.equal(bump.status, 200, JSON.stringify(bump.json));
          const nowOffer = (await api('GET', '/api/environment/template')).json.offer;
          assert.ok(nowOffer.version !== was.version || nowOffer.offerId !== was.offerId, 'the offer changed under the open panel');
          const count = (await spaceNames()).length;
          await ev("document.querySelector('#template-offer [data-offer-starter=\"0\"]').click()");
          await ev("document.querySelector('#template-offer [data-offer-apply]').click()");
          await waitFor("/changed since it was offered/.test(document.querySelector('#template-offer [data-offer-status]')?.textContent || '')", 'the refusal in the panel');
          assert.equal(await ev("document.querySelector('#template-offer [data-offer-status]').classList.contains('error')"), true);
          assert.equal((await spaceNames()).length, count, 'nothing was made');
          assert.equal((await rows()).filter((x) => x.checked).length, 0, 'the offer is drawn again, unticked');
          assert.ok(await ev("document.getElementById('template-offer').contains(document.activeElement)"), 'focus is inside the redrawn panel');
          // and the redrawn offer confirms with the new id
          await ev("document.querySelector('#template-offer [data-offer-starter=\"0\"]').click()");
          await ev("document.querySelector('#template-offer [data-offer-apply]').click()");
          await waitFor("/Made 1 space: Kickoff\\./.test(document.getElementById('template-status').textContent)", 'the made line after the second try');
        });
        await test(at('a starter name of escaped markup is literal text; a double click on Apply sends one POST'), async () => {
          await switchTo('default');
          await switchTo('markup');
          await waitFor("document.querySelectorAll('#template-offer [data-offer-starter]').length === 1", 'the markup row');
          const row = await ev("(() => { const l = document.querySelector('#template-offer [data-offer-starter]').closest('label'); return { name: l.querySelector('strong').textContent, hint: l.querySelector('.hint').textContent, img: l.querySelectorAll('img, b').length }; })()");
          assert.deepEqual(row, { name: MARKUP, hint: '&lt;b&gt;bold&lt;/b&gt;', img: 0 });
          posts.length = 0;
          await ev("document.querySelector('#template-offer [data-offer-starter]').click()");
          await ev("(() => { const b = document.querySelector('#template-offer [data-offer-apply]'); b.click(); b.click(); return true; })()");
          await waitFor("/^Applied/.test(document.getElementById('template-status').textContent)", 'applied');
          assert.equal(posts.length, 1, `one POST, not ${posts.length}`);
          const line = await ev("document.getElementById('template-status').textContent");
          assert.ok(line.includes(`Made 1 space: ${MARKUP}.`), line);
          assert.equal(await ev("document.getElementById('template-status').querySelectorAll('img, b').length"), 0);
        });
        await test(at('a confirm after the offer was already applied closes the panel and focuses the chooser'), async () => {
          await switchTo('default');
          await switchTo('startr');
          await waitFor("document.querySelectorAll('#template-offer [data-offer-starter]').length === 3", 'the starter rows');
          const o = (await api('GET', '/api/environment/template')).json.offer;
          assert.equal((await api('POST', '/api/environment/template/apply', { offerId: o.offerId, version: o.version })).status, 200);
          await ev("document.querySelector('#template-offer [data-offer-apply]').click()");
          await waitFor("/already been applied/.test(document.getElementById('template-status').textContent)", 'the sentence');
          await waitFor("document.getElementById('template-offer').hidden", 'the panel closed');
          assert.equal(await ev('document.activeElement.id'), 'template-select');
        });
        await test(at('no page error'), () => assert.deepEqual(problems, []));
      } catch (err) {
        failures.push(`${size}: ${err.stack || err.message}`);
      } finally {
        await tab.close().catch(() => {});
      }
      // The next width starts from the same state: a new owner template cannot be re-offered at the same switch, so remake it.
      await api('PATCH', '/api/settings', { template: 'default' });
    }
  } finally {
    if (browser) { browser.cdp.ws.close(); await stopBrowser(browser.child, browser.dir).catch(() => {}); }
    if (server) await stopServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function host() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starter-pages-host-'));
  let b = null; let browser = null;
  try {
    const port = await freePort();
    const { child, cookie } = await hostSeed.seed({ count: 6, port, dataDir, env: {} });
    b = child;
    const console_ = (m, p, body) => hostSeed.call(port, m, 'admin', p, body, { cookie });
    const t = await console_('POST', '/api/host/templates', { id: 'starts', name: 'Starts', description: 'With spaces.', modules: { chat: {} }, starterSpaces: STARTERS });
    assert.equal(t.status, 201, t.text);
    const list = (await console_('GET', '/api/host/environments')).json.environments;
    const env = list.find((e) => !e.status || e.status === 'active') || list[0];
    browser = await launch(bin);
    const size = 1280;
    const { browserContextId } = await browser.cdp.send('Target.createBrowserContext');
    const { targetId } = await browser.cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await browser.cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const s = (m, p) => browser.cdp.send(m, p, sessionId);
    await s('Page.enable'); await s('Runtime.enable'); await s('Network.enable');
    await s('Emulation.setDeviceMetricsOverride', { width: size, height: 900, deviceScaleFactor: 1, mobile: false });
    await s('Emulation.setFocusEmulationEnabled', { enabled: true });
    const [cn, cv] = cookie.split('=');
    await s('Network.setCookie', { name: cn, value: cv, domain: 'admin.localhost', path: '/' });
    const ev = async (expr) => {
      const r = await s('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
      if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
      return r.result.value;
    };
    const waitFor = async (expr, what, ms = 20000) => {
      const end = Date.now() + ms;
      while (!(await ev(expr).catch(() => false))) { if (Date.now() > end) throw new Error(`timed out: ${what}`); await sleep(100); }
    };
    await test('1280: the console\'s Review shows the starter spaces unticked; a confirm with one ticked makes it and says so', async () => {
      await s('Page.navigate', { url: `http://admin.localhost:${port}/#environments/${env.slug}/template` });
      await waitFor("Boolean(document.getElementById('env-template-select')) && document.getElementById('env-template-select').getClientRects().length > 0 && document.getElementById('env-template-select').options.length > 1", 'the template chooser');
      await ev(`(() => { const sel = document.getElementById('env-template-select'); sel.value = 'starts'; sel.dispatchEvent(new Event('change')); document.getElementById('env-template-switch-btn').click(); return true; })()`);
      await waitFor("Boolean(document.querySelector('dialog.sdk-dialog-confirm'))", 'the switch question');
      await ev("document.querySelector('dialog.sdk-dialog-confirm [data-ok]').click()");
      await waitFor("document.getElementById('env-template-status').textContent.startsWith('Switched to ')", 'switched');
      await waitFor("document.querySelectorAll('#env-offer [data-offer-starter]').length === 3", 'the starter rows on the switch');
      await s('Page.reload', {});
      await waitFor("document.getElementById('env-offer-review') && document.getElementById('env-offer-review').getClientRects().length > 0", 'Review after a reload');
      await ev("document.getElementById('env-offer-review').click()");
      await waitFor("document.querySelectorAll('#env-offer [data-offer-starter]').length === 3", 'the starter rows in Review');
      const rows = await ev("[...document.querySelectorAll('#env-offer [data-offer-starter]')].map((i) => [i.closest('label').querySelector('strong').textContent, i.checked])");
      assert.deepEqual(rows, [['Kickoff', false], ['Planning', false], ['Retro', false]]);
      assert.match(await ev("document.querySelector('#env-offer [data-offer-starters] .field-label').textContent"), /^Spaces to start with$/);
      await ev("document.getElementById('env-offer').scrollIntoView()");
      await shotOf(browser.cdp, sessionId, '1280-console-review-with-starters');
      await ev("document.querySelector('#env-offer [data-offer-starter=\"2\"]').click()");
      await ev("document.querySelector('#env-offer [data-offer-apply]').click()");
      await waitFor("/Made 1 space: Retro\\./.test(document.getElementById('env-template-status').textContent)", 'the made line');
      const login = await hostSeed.call(port, 'POST', env.slug, '/api/login', { login: `own-${env.slug}`, password: 'owner-password-1' });
      assert.equal(login.status, 200, login.text);
      const spaces = await hostSeed.call(port, 'GET', env.slug, '/api/spaces', undefined, { cookie: login.cookies.join('; ') });
      assert.equal(spaces.status, 200, spaces.text);
      assert.equal(spaces.json.spaces.filter((x) => x.name === 'Retro').length, 1);
    });
    await test('1280: a stale confirm in the console shows the refusal in the redrawn panel, with focus inside it', async () => {
      await ev("document.getElementById('env-template-status').textContent = ''");
      for (const id of ['default', 'starts']) {
        await ev(`(() => { const sel = document.getElementById('env-template-select'); sel.value = ${JSON.stringify(id)}; sel.dispatchEvent(new Event('change')); document.getElementById('env-template-switch-btn').click(); return true; })()`);
        await waitFor("Boolean(document.querySelector('dialog.sdk-dialog-confirm'))", 'the switch question');
        await ev("document.querySelector('dialog.sdk-dialog-confirm [data-ok]').click()");
        await waitFor(`document.getElementById('env-template-status').textContent.startsWith('Switched to ') && (${JSON.stringify(id)} === 'default' || document.querySelectorAll('#env-offer [data-offer-starter]').length === 3)`, `switched to ${id}`);
        if (id === 'default') await ev("document.getElementById('env-template-status').textContent = ''");
      }
      assert.equal((await console_('PATCH', '/api/host/templates/starts', { description: 'Edited under the open offer.' })).status, 200);
      await ev("document.querySelector('#env-offer [data-offer-starter=\"0\"]').click()");
      await ev("document.querySelector('#env-offer [data-offer-apply]').click()");
      await waitFor("/changed since it was offered/.test(document.querySelector('#env-offer [data-offer-status]')?.textContent || '')", 'the refusal in the panel');
      assert.ok(await ev("document.getElementById('env-offer').contains(document.activeElement)"), 'focus is inside the redrawn panel');
      assert.equal(await ev("[...document.querySelectorAll('#env-offer [data-offer-starter]')].filter((i) => i.checked).length"), 0);
    });
  } finally {
    if (browser) { browser.cdp.ws.close(); await stopBrowser(browser.child, browser.dir).catch(() => {}); }
    if (b) await hostSeed.stopServer(b);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

if (failures.length) {
  for (const f of failures) console.error(`check-starter-offer-pages: FAIL ${f}`);
  console.error(`check-starter-offer-pages: ${failures.length} failed, ${n} passed`);
  process.exit(1);
}
say(`${n} checks passed`);
