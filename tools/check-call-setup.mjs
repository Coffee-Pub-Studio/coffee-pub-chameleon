#!/usr/bin/env node
/*
 * check-call-setup.mjs -- the page half of the core call settings (documentation/plans/plan-templates-redesign.md, step 4;
 * decisions 16 and 37), in a real browser against a throwaway seeded server (Lisbon: Mia moderates it; Kyoto reads an owner's own
 * template that sets the call's position, layout and joining on entry). Covers, at 1280 and 390 px:
 *   - Set up shows Join on entry, Position and Layout (each with "Same as the template") to the admin on the Space tab and to a
 *     moderator on the Settings tab, and a plain member has no Set up; each control is 44 px tall on a phone; no sideways scroll
 *   - Save sends the call as its own PATCH holding only `call` (a changed name goes in another request); "Same as the template"
 *     sends null for that key; the stored space follows
 *   - a space whose template's call sets position left and layout strip starts so for a person with no choice, the start is never
 *     written to the browser's record, and a person's own stored choice wins
 *   - Manage no longer has "Join the call when someone enters": no element, no word, and /api/branding and /api/settings have no key
 *   - joining on entry: where the browser needs a tap the page shows Join the call and says why once, joins with no microphone asked
 *     for on that tap; where it does not, entering joins at once with no microphone asked for
 * Not here: a real call. No LiveKit server runs here, so the call's client library is replaced by tools/shots-livekit-stub.mjs
 * (nothing is received or published); the browser's real tap rule (a reloaded page on an iPhone or iPad) is stood in for by a page
 * with no press yet (navigator.userActivation.hasBeenActive is false). With no Chromium it says SKIPPED; that is not a pass.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const { bootSeeded, stopServer, freePort, findBrowser, launch, Tab, sleep } = await import('./shots.mjs');

const bin = findBrowser();
if (!bin) {
  console.log('check-call-setup: SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.');
  process.exit(0);
}

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};
const SHOTS = process.env.CALL_SETUP_SHOTS || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-call-setup-'));
let server;
let browser;
const tabs = [];
try {
  const port = await freePort();
  const boot = await bootSeeded('travel', dataDir, port);
  server = boot.server;
  const { ctx, cookies } = boot;
  const jar = (as) => cookies[as].map((c) => `${c.name}=${c.value}`).join('; ');
  const api = async (method, url, body, as = 'admin') => {
    const r = await fetch(server.base + url, { method, headers: { 'content-type': 'application/json', cookie: jar(as) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch { /* none */ }
    return { status: r.status, json };
  };
  // Kyoto reads an owner's own template: its call sits left, as a strip, and joins on entry.
  const file = (await api('GET', '/api/templates/games/export')).json;
  file.call = { joinOnEntry: true, position: 'left', layout: 'strip' };
  const imp = await fetch(`${server.base}/api/templates/import?id=mine`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: jar('admin') }, body: JSON.stringify(file) });
  assert.equal(imp.status, 201, await imp.text());
  assert.equal((await api('PATCH', `/api/spaces/${ctx.second}`, { template: 'mine' })).status, 200);
  const lookKyoto = (await api('GET', `/api/spaces/${ctx.second}`)).json.look.call;
  assert.deepEqual(lookKyoto, { joinOnEntry: true, position: 'left', layout: 'strip' });
  const stored = (id) => JSON.parse(fs.readFileSync(path.join(dataDir, 'app.json'), 'utf8')).spaces.find((s) => s.id === id);

  browser = await launch(bin);
  // A page: the signed-in person's cookies; a scripted start (before the page's own scripts) when asked.
  const open = async (url, as, width, { stub = false, init = '' } = {}) => {
    const tab = new Tab(browser.cdp, ctx);
    await tab.open(width, 'light', stub);
    tabs.push(tab);
    if (as) for (const c of cookies[as]) await tab.cdp.send('Network.setCookie', { name: c.name, value: c.value, url: server.base, httpOnly: true }, tab.sid);
    if (init) await tab.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: init }, tab.sid);
    await tab.cdp.send('Page.navigate', { url: server.base + url }, tab.sid);
    return tab;
  };
  const inSpace = async (tab) => { await tab.waitFor('body.in-space'); await sleep(900); };
  const overflow = (tab) => tab.eval('document.documentElement.scrollWidth > innerWidth + 1');
  // Every PATCH to a space the page sends from now on, with its body.
  const spy = (tab) => tab.eval(`(() => { window.__patches = []; const f = window.fetch; window.fetch = function (url, init) { if (init && init.method === 'PATCH' && /\\/api\\/spaces\\//.test(String(url))) window.__patches.push({ url: String(url), body: JSON.parse(init.body) }); return f.apply(this, arguments); }; return true; })()`);
  const patches = (tab) => tab.eval('window.__patches');
  const shot = async (tab, name) => {
    if (!SHOTS) return;
    await tab.eval(`(() => { document.querySelector('[data-section="call"]').scrollIntoView({ block: 'center' }); return true; })()`);
    await sleep(300);
    fs.writeFileSync(path.join(SHOTS, name), await tab.shoot(false));
  };
  const openSetup = async (tab, id, hash) => {
    await tab.eval(`(() => { history.replaceState(null, '', '/?setup=${id}${hash}'); return true; })()`);
    await tab.eval(`location.reload()`).catch(() => {});
  };
  const callControls = (tab) => tab.eval(`(() => {
    const out = {};
    for (const id of ['join', 'position', 'layout']) {
      const s = document.getElementById('setup-call-' + id);
      const r = s ? s.getBoundingClientRect() : null;
      out[id] = s ? { options: [...s.options].map((o) => o.textContent), value: s.value, height: Math.round(r.height), shown: r.width > 0 } : null;
    }
    return out;
  })()`);
  const pick = (tab, id, value) => tab.eval(`(() => { const s = document.getElementById('setup-call-${id}'); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);

  for (const width of [1280, 390]) {
    await test(`the admin in Lisbon at ${width}: the Space tab has Join on entry, Position and Layout; Save sends the call as its own PATCH`, async () => {
      const tab = await open(`/?setup=${ctx.trip}#space`, 'admin', width);
      await tab.waitFor('#setup-call-join');
      await sleep(1200);
      const c = await callControls(tab);
      assert.deepEqual(c.join.options, ['Same as the template', 'Join the call on entry', 'Do not join on entry']);
      assert.equal(c.position.options.length, 8, '"Same as the template" and the seven');
      assert.equal(c.layout.options.length, 5, '"Same as the template" and the four');
      assert.deepEqual([c.join.value, c.position.value, c.layout.value], ['', '', ''], 'nothing set: all follow the template');
      assert.ok(await tab.eval(`document.getElementById('setup-content-space').contains(document.getElementById('setup-call-join'))`), 'on the Space tab');
      if (width === 390) for (const k of ['join', 'position', 'layout']) assert.ok(c[k].height >= 44, `${k} is ${c[k].height}px tall`);
      assert.equal(await overflow(tab), false, 'no sideways scroll');
      assert.match(await tab.eval(`document.querySelector('[data-section="call"]').textContent`), /Now: .*(Top of the column|Grid|does not join)/, 'what the template gives, said');
      await shot(tab, `admin-${width}.png`);
      // A name and a position together: two requests, the call alone in its own.
      await spy(tab);
      await tab.eval(`(() => { const f = document.getElementById('setup-name'); f.value = 'Lisbon again'; f.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      await pick(tab, 'position', 'bottom');
      await pick(tab, 'join', 'true');
      await tab.click('#setup-save');
      await sleep(1500);
      const sent = await patches(tab);
      assert.equal(sent.length, 2, JSON.stringify(sent));
      assert.deepEqual(sent.map((p) => Object.keys(p.body)), [['name'], ['call']], 'the call is a request of its own');
      assert.deepEqual(sent[1].body, { call: { joinOnEntry: true, position: 'bottom' } }, 'only what changed');
      assert.deepEqual(stored(ctx.trip).call, { joinOnEntry: true, position: 'bottom' });
      await tab.close();
      // And back to the template's, one key at a time: null for that key.
      const again = await open(`/?setup=${ctx.trip}#space`, 'admin', width);
      await again.waitFor('#setup-call-join');
      await sleep(1200);
      const c2 = await callControls(again);
      assert.deepEqual([c2.join.value, c2.position.value, c2.layout.value], ['true', 'bottom', ''], 'what the space holds is shown');
      await spy(again);
      await pick(again, 'position', '');
      await again.click('#setup-save');
      await sleep(1200);
      const sent2 = await patches(again);
      assert.deepEqual(sent2.map((p) => p.body), [{ call: { position: null } }]);
      assert.deepEqual(stored(ctx.trip).call, { joinOnEntry: true });
      await again.close();
      assert.equal((await api('PATCH', `/api/spaces/${ctx.trip}`, { name: 'Lisbon', call: null })).status, 200);
    });

    await test(`a moderator (Mia, Lisbon) at ${width}: the controls are on the Settings tab; Save sends the call only`, async () => {
      const tab = await open(`/?setup=${ctx.trip}#modules`, 'mia', width);
      await tab.waitFor('#setup-call-layout');
      await sleep(1200);
      const c = await callControls(tab);
      assert.equal(c.layout.options.length, 5);
      assert.ok(await tab.eval(`document.getElementById('setup-content-modules').contains(document.getElementById('setup-call-layout'))`), 'a moderator has no Space tab: the Settings tab');
      assert.equal(await tab.eval(`!!document.getElementById('setup-tab-space')`), false);
      if (width === 390) for (const k of ['join', 'position', 'layout']) assert.ok(c[k].height >= 44, `${k} is ${c[k].height}px tall`);
      assert.equal(await overflow(tab), false);
      await shot(tab, `moderator-${width}.png`);
      await spy(tab);
      await pick(tab, 'layout', 'spotlight');
      await tab.click('#setup-save');
      await sleep(1500);
      const sent = await patches(tab);
      assert.deepEqual(sent.map((p) => p.body), [{ call: { layout: 'spotlight' } }]);
      assert.deepEqual(stored(ctx.trip).call, { layout: 'spotlight' });
      assert.equal(await tab.eval(`document.getElementById('space-setup') ? !!document.getElementById('space-setup').hidden : true`), true, 'the panel closed after a whole save');
      await tab.close();
      assert.equal((await api('PATCH', `/api/spaces/${ctx.trip}`, { call: null })).status, 200);
    });
  }

  await test('a plain member has no Set up and no call controls; the Lobby has none either', async () => {
    const tab = await open(`/?setup=${ctx.second}`, 'mia', 1280);
    await sleep(2500);
    assert.equal(await tab.eval(`!!document.getElementById('setup-call-join')`), false);
    assert.equal(await tab.eval(`(() => { const p = document.getElementById('space-setup'); return !p || p.hidden; })()`), true, 'no panel for a member');
    await tab.close();
    const admin = await open('/?setup=lobby', 'admin', 1280);
    await sleep(2500);
    assert.equal(await admin.eval(`!!document.getElementById('setup-call-join')`), false, 'the Lobby follows the template');
    await admin.close();
  });

  for (const width of [1280, 390]) {
    await test(`Manage at ${width} has no "Join the call when someone enters", and the server has no such setting`, async () => {
      const tab = await open('/admin', 'admin', width);
      await tab.waitFor('#save-features');
      await sleep(800);
      assert.equal(await tab.eval(`!!document.getElementById('set-auto-join-call')`), false);
      assert.equal(await tab.eval(`/Join the call when someone enters/i.test(document.body.textContent)`), false);
      assert.equal(await overflow(tab), false);
      await tab.close();
      assert.equal('autoJoinCall' in (await api('GET', '/api/settings')).json.settings, false);
      assert.equal('autoJoinCall' in (await (await fetch(`${server.base}/api/branding`)).json()), false);
    });
  }

  // The template's start: Kyoto's call sits left as a strip for a person with no choice; the person's own choice wins. The column
  // is made wide enough for Left (560 px) by the person's own saved call preferences.
  const wide = `try { if (!localStorage.getItem('app.call')) localStorage.setItem('app.call', JSON.stringify({ chatWidth: 700 })); } catch (e) {}`;
  const shown = (tab) => tab.eval(`(() => { const c = document.getElementById('side-column'); return { left: c.classList.contains('call-left'), bottom: c.classList.contains('call-bottom'), layout: document.getElementById('grid').dataset.layout, record: localStorage.getItem('app.column.${ctx.second}') }; })()`);
  await test('Kyoto, 1280: the template\'s call starts left as a strip for a person with no choice; the start is not kept; their own choice wins', async () => {
    const tab = await open(`/#join=${ctx.second}`, 'admin', 1280, { init: wide });
    await inSpace(tab);
    let s = await shown(tab);
    assert.equal(s.left, true, JSON.stringify(s));
    assert.equal(s.layout, 'strip', JSON.stringify(s));
    assert.equal(s.record === null || !/callPosition|callFloat|callLayout/.test(s.record), true, `the start is not written down: ${s.record}`);
    // The column folded and opened (a record is written): still no position or layout in it, so still the template's.
    await tab.click('#side-column-rail-chat').catch(() => {});
    await sleep(300);
    s = await shown(tab);
    assert.equal(s.record === null || !/callPosition|callLayout/.test(s.record), true, `still not a choice: ${s.record}`);
    // Their own choice, kept in this browser for the space, wins over the template's.
    await tab.eval(`(() => { localStorage.setItem('app.column.${ctx.second}', JSON.stringify({ collapsed: false, callPosition: 'bottom', callLayout: 'grid' })); location.reload(); return true; })()`);
    await sleep(500);
    await inSpace(tab);
    s = await shown(tab);
    assert.equal(s.bottom, true, `their own position wins: ${JSON.stringify(s)}`);
    assert.equal(s.left, false);
    assert.equal(s.layout, 'grid', 'their own layout wins');
    await tab.close();
  });
  await test('Lisbon (no call of its own), 1280: the template\'s start is the top and a grid', async () => {
    const tab = await open(`/#join=${ctx.trip}`, 'admin', 1280, { init: wide });
    await inSpace(tab);
    const s = await tab.eval(`(() => { const c = document.getElementById('side-column'); return { left: c.classList.contains('call-left'), bottom: c.classList.contains('call-bottom'), layout: document.getElementById('grid').dataset.layout }; })()`);
    assert.deepEqual(s, { left: false, bottom: false, layout: 'grid' });
    await tab.close();
  });

  // Joining on entry (a stand-in call: no microphone is ever asked for; getUserMedia is counted).
  const gum = `window.__gum = 0; try { const md = navigator.mediaDevices; if (md) md.getUserMedia = async () => { window.__gum++; throw new DOMException('none here', 'NotFoundError'); }; } catch (e) {}`;
  const inCall = (tab) => tab.eval(`(() => ({ gum: window.__gum, on: document.getElementById('hangup').classList.contains('danger'), micOff: document.getElementById('mic').classList.contains('off'), asked: /needs a tap/.test(document.body.textContent), tapBtn: (() => { const b = document.getElementById('join-call'); return b && b.getClientRects().length ? b.textContent.replace(/\\s+/g, ' ').trim() : ''; })() }))()`);
  await test('joining on entry where the browser needs a tap: Join the call shows, the reason is said once, one tap joins with no microphone asked for', async () => {
    const tab = await open(`/#join=${ctx.second}`, 'admin', 1280, { stub: true, init: gum });
    await inSpace(tab);
    let s = await inCall(tab);
    assert.equal(await tab.eval('navigator.userActivation.hasBeenActive'), false, 'a page nobody has pressed yet: the browser would not start sound');
    assert.equal(s.on, false, 'not joined without a tap');
    assert.match(s.tapBtn, /Join call/, JSON.stringify(s));
    assert.equal(s.asked, true, 'the reason is said: ' + JSON.stringify(s));
    assert.equal(s.gum, 0);
    await tab.click('#join-call');
    await sleep(1500);
    s = await inCall(tab);
    assert.equal(s.on, true, 'in the call after the tap: ' + JSON.stringify(s));
    assert.equal(s.gum, 0, 'no microphone asked for');
    assert.equal(s.micOff, true);
    await tab.close();
  });
  await test('joining on entry where no tap is needed: entering joins at once, microphone and camera off, nothing asked for', async () => {
    const tab = await open('/', 'admin', 1280, { stub: true, init: gum });
    await tab.waitFor(`[data-space="${ctx.second}"] [data-join]`);
    await sleep(600);
    await tab.click(`[data-space="${ctx.second}"] [data-join]`); // a real press: the page has been tapped
    await inSpace(tab);
    await sleep(1200);
    const s = await inCall(tab);
    assert.equal(s.on, true, JSON.stringify(s));
    assert.equal(s.gum, 0, 'no microphone asked for');
    assert.equal(s.micOff, true);
    assert.equal(s.asked, false);
    await tab.close();
  });
  await test('a space that does not join on entry, and a person who left the call: entering does not join', async () => {
    const tab = await open('/', 'admin', 1280, { stub: true, init: gum });
    await tab.waitFor(`[data-space="${ctx.trip}"] [data-join]`);
    await sleep(600);
    await tab.click(`[data-space="${ctx.trip}"] [data-join]`);
    await inSpace(tab);
    await sleep(800);
    const s = await inCall(tab);
    assert.equal(s.on, false);
    assert.equal(s.asked, false);
    await tab.close();
  });
} finally {
  for (const t of tabs) await t.close().catch(() => {});
  if (browser) await browser.close?.().catch?.(() => {});
  if (server) await stopServer(server);
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(failed ? `check-call-setup: ${failed} FAILED, ${n} passed` : `check-call-setup: OK (${n} tests)`);
process.exit(failed ? 1 : 0);
