#!/usr/bin/env node
/*
 * check-reaction-tray.mjs -- the call's reactions are the resolved list of the space I am in (plan-templates-redesign.md,
 * "The correction of 2026-11-16": the environment's list, then the template's additions; the first six are keys 1 to 6).
 * In a real browser against a throwaway seeded server with two spaces: Lisbon (the environment's template) and Kyoto
 * (a copy of Games that adds one reaction):
 *   - Kyoto's reaction tray and chat emoji list hold the template's addition; Lisbon's do not; going Kyoto -> Home ->
 *     Lisbon leaves none of Kyoto's behind, and the first six of the tray are the first six of the list;
 *   - with the environment's list empty: Lisbon's reaction button, tray and chat emoji button are hidden and the R key
 *     opens nothing; Kyoto, whose template still adds one, keeps its button and its tray holds just that one;
 *   - source: showReaction and sendReaction look an id up among their own reactions only (an id such as "toString" is none).
 * A real call (a reaction over the data channel, keys 1 to 6 sending one) needs LiveKit and is not checked here.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { bootSeeded, stopServer, freePort, findBrowser, launch, Tab, sleep } = await import('./shots.mjs');

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};

const source = fs.readFileSync(path.join(ROOT, 'public', 'space.js'), 'utf8');
await test('a reaction id is looked up among own properties only (source)', () => {
  assert.doesNotMatch(source, /REACTIONS\[id\]/, 'REACTIONS[id] finds toString on a plain object');
  assert.match(source, /REACTIONS = new Map\(/, 'REACTIONS is a Map');
});

const bin = findBrowser();
if (!bin) {
  console.log('check-reaction-tray: SKIPPED the page part. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured there.');
  console.log(failed ? `check-reaction-tray: ${failed} FAILED, ${n} passed` : `check-reaction-tray: source part OK (${n} tests)`);
  process.exit(failed ? 1 : 0);
}

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-reaction-tray-'));
let server;
let browser;
const tabs = [];
try {
  const port = await freePort();
  const boot = await bootSeeded('travel', dataDir, port, {});
  server = boot.server;
  const { ctx, cookies } = boot;
  const jar = (as) => cookies[as].map((c) => `${c.name}=${c.value}`).join('; ');
  const api = async (method, url, body, as = 'admin') => {
    const r = await fetch(server.base + url, { method, headers: { 'content-type': 'application/json', cookie: jar(as) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch { /* none */ }
    return { status: r.status, json };
  };
  const made = await api('POST', '/api/environment/templates', { from: 'games', id: 'extra', name: 'Extra' });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const edit = await api('PATCH', '/api/environment/templates/extra', { reactions: [{ id: 'unicorn-x', glyph: '\u{1F984}', label: 'Unicorn' }] });
  assert.equal(edit.status, 200, JSON.stringify(edit.json));
  assert.equal((await api('PATCH', `/api/spaces/${ctx.second}`, { template: 'extra' })).status, 200);
  const envList = (await (await fetch(`${server.base}/api/branding`)).json()).reactions;
  const kyotoList = (await api('GET', `/api/spaces/${ctx.second}/look`)).json.look.reactions;
  assert.equal(kyotoList.at(-1).id, 'unicorn-x', 'the server resolves the addition for Kyoto');
  assert.equal(envList.some((r) => r.id === 'unicorn-x'), false);

  browser = await launch(bin);
  const open = async (url) => {
    const tab = new Tab(browser.cdp, ctx);
    await tab.open(1280, 'light');
    tabs.push(tab);
    for (const c of cookies.admin) await tab.cdp.send('Network.setCookie', { name: c.name, value: c.value, url: server.base, httpOnly: true }, tab.sid);
    await tab.cdp.send('Page.navigate', { url: server.base + url }, tab.sid);
    await tab.waitFor('body.in-space');
    await sleep(1200);
    return tab;
  };
  const read = (tab) => tab.eval(`(() => ({
    tray: [...document.querySelectorAll('#react-tray [data-reaction]')].map((b) => b.dataset.reaction),
    emoji: document.querySelectorAll('#chat-emoji-popup .chat-emoji-btn').length,
    toggleHidden: document.getElementById('react-toggle').hidden,
    emojiHidden: document.getElementById('chat-emoji').hidden,
  }))()`);
  const pressR = async (tab) => {
    await tab.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }))`);
    await sleep(200);
    return tab.eval(`!document.getElementById('react-tray').hidden`);
  };

  await test('a space on a template that adds a reaction shows it in the tray and the chat list; another space does not', async () => {
    const kyoto = await open(`/#join=${ctx.second}`);
    let s = await read(kyoto);
    assert.deepEqual(s.tray, kyotoList.map((r) => r.id), 'Kyoto: the resolved list, in order (the first six are keys 1 to 6)');
    assert.equal(s.emoji, kyotoList.length);
    await kyoto.eval(`document.getElementById('spaces-link').click()`);
    await sleep(700);
    await kyoto.eval(`document.querySelector('[data-space="${ctx.trip}"] [data-join]').click()`);
    await kyoto.waitFor('body.in-space');
    await sleep(1200);
    s = await read(kyoto);
    assert.deepEqual(s.tray, envList.map((r) => r.id), 'Lisbon after Kyoto: the environment\'s list, none of Kyoto\'s');
    await kyoto.close();
  });

  await test('an empty environment list: no button, no tray, no chat button where nothing is added; the addition alone where one is', async () => {
    assert.equal((await api('PATCH', '/api/settings', { reactions: [] })).status, 200);
    const lisbon = await open(`/#join=${ctx.trip}`);
    let s = await read(lisbon);
    assert.deepEqual([s.tray, s.toggleHidden, s.emojiHidden], [[], true, true]);
    assert.equal(await pressR(lisbon), false, 'R opens no empty tray');
    await lisbon.close();
    const kyoto = await open(`/#join=${ctx.second}`);
    s = await read(kyoto);
    assert.deepEqual([s.tray, s.toggleHidden, s.emojiHidden], [['unicorn-x'], false, false]);
    assert.equal(await pressR(kyoto), true);
    await kyoto.close();
  });
} finally {
  for (const t of tabs) await t.close().catch(() => {});
  if (browser) await browser.close?.().catch?.(() => {});
  if (server) await stopServer(server);
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(failed ? `check-reaction-tray: ${failed} FAILED, ${n} passed` : `check-reaction-tray: OK (${n} tests)`);
process.exit(failed ? 1 : 0);
