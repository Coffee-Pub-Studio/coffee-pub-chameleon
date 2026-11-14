#!/usr/bin/env node
/*
 * check-ai-manage-tab.mjs -- AI Assistant's Manage tab (#modules/assistant), run in a headless browser against a throwaway server,
 * at 1280 and 390 (plan-ai-assistant.md, J4; the key is the one security-sensitive field on the page):
 *   - the tab is the AI Assistant module's own (its card, then the setup, the month's use and What AI may see); there is no
 *     separate "AI service" tab or entry;
 *   - it saves a company, a model, an allowance and a fake key (sk-test-FAKE) through the form;
 *   - after the save the key is nowhere in the page: not in its source (the HTML the server sent, nor the DOM now), not in any
 *     field's value, not in storage, not in the address, and not in any response the page received after the save
 *     (every one read through the browser's network record, the page's own HTML included);
 *   - the field shows "Set" and nothing else; a reload shows the same; the key box is a password box that tells a password
 *     manager to leave it alone;
 *   - the key is not on disk in the clear (the whole data folder is searched);
 *   - a member and a signed-out visitor are refused by GET and PUT /api/ai (so the tab draws nothing for them);
 *   - the use bar draws, and nothing scrolls sideways at 390.
 *
 *   node tools/check-ai-manage-tab.mjs        (no Chromium: SKIPPED, exit 0; that is a skip, never a pass)
 *   AI_MANAGE_SHOTS=<folder> keeps a screenshot of each width.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stopBrowser } from './browser-launch.mjs';
import { findBrowser, launch, freePort, stopServer, bootSeeded, Tab, sleep, driveScreen } from './shots.mjs';

const say = (...a) => console.log('check-ai-manage-tab:', ...a);
const failures = [];
const expect = (ok, text) => { if (!ok) failures.push(text); };
const KEY = 'sk-test-FAKE';

// Every file under a folder that holds the text, as a list of paths.
function filesHolding(dir, text) {
  const out = [];
  const walk = (p) => {
    let st;
    try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) { for (const f of fs.readdirSync(p)) walk(path.join(p, f)); return; }
    if (st.size < 50 * 1024 * 1024 && fs.readFileSync(p).includes(text)) out.push(path.relative(dir, p));
  };
  walk(dir);
  return out;
}

// Reads every response a tab receives (its body too) from now on, through the browser's network record.
function recordResponses(tab) {
  const urls = new Map();
  const bodies = [];
  const pending = [];
  const listener = (m) => {
    if (m.sessionId !== tab.sid) return;
    if (m.method === 'Network.responseReceived') urls.set(m.params.requestId, m.params.response.url);
    if (m.method === 'Network.loadingFinished' && urls.has(m.params.requestId)) {
      const url = urls.get(m.params.requestId);
      pending.push(tab.cdp.send('Network.getResponseBody', { requestId: m.params.requestId }, tab.sid)
        .then((r) => bodies.push({ url, body: r.base64Encoded ? Buffer.from(r.body, 'base64').toString('latin1') : r.body }))
        .catch(() => bodies.push({ url, body: '' })));
    }
  };
  tab.cdp.listeners.push(listener);
  return {
    async done() { await sleep(500); await Promise.all(pending); tab.cdp.listeners = tab.cdp.listeners.filter((f) => f !== listener); return bodies; },
  };
}

const DOM_HOLDS_KEY = `(() => {
  const found = [];
  if (document.documentElement.outerHTML.includes(${JSON.stringify(KEY)})) found.push('the DOM');
  for (const el of document.querySelectorAll('input, textarea, select')) if (String(el.value).includes(${JSON.stringify(KEY)})) found.push('the value of #' + el.id);
  for (const s of [localStorage, sessionStorage]) for (let i = 0; i < s.length; i += 1) if ((s.key(i) + s.getItem(s.key(i))).includes(${JSON.stringify(KEY)})) found.push('storage');
  if ((location.href + document.title).includes(${JSON.stringify(KEY)})) found.push('the address');
  return found;
})()`;

async function main() {
  const bin = findBrowser();
  if (!bin) { say('SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); return 0; }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-manage-data-'));
  let server = null; let browser = null;
  try {
    const boot = await bootSeeded('travel', dataDir, await freePort());
    server = boot.server;
    const S = { base: server.base, ctx: boot.ctx, cookies: boot.cookies };
    const jar = (who) => (S.cookies[who] || []).map((c) => `${c.name}=${c.value}`).join('; ');
    const call = (who, method, url, body) => fetch(`${S.base}${url}`, { method, headers: { cookie: jar(who), 'content-type': 'application/json', origin: S.base }, ...(body ? { body: JSON.stringify(body) } : {}) });

    // The people who must not reach the setup: a member, a signed-out visitor. Read and write, both refused, with no key in the answer.
    for (const who of ['sam', 'none']) {
      for (const [method, url, body] of [['GET', '/api/ai'], ['PUT', '/api/ai', { provider: 'openai', key: KEY }], ['GET', '/api/ai/usage'], ['POST', '/api/ai/models', { provider: 'openai', key: KEY }]]) {
        const r = await call(who, method, url, body);
        const text = await r.text();
        expect(r.status === 401 || r.status === 403, `${who} was not refused ${method} ${url} (${r.status})`);
        expect(!text.includes(KEY), `${who}'s refusal of ${method} ${url} holds the key`);
      }
    }
    say('a member and a signed-out visitor are refused GET and PUT /api/ai');

    browser = await launch(bin);
    const open = async (size) => {
      const tab = new Tab(browser.cdp, S.ctx);
      await tab.open(size, 'dark', false);
      const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
      await driveScreen(tab, { as: 'admin', url: '/admin#modules/assistant', wait: '#ai-sees-box' }, S.base, S.cookies, S.ctx);
      return tab;
    };

    const sizes = process.env.AI_MANAGE_SIZE ? [Number(process.env.AI_MANAGE_SIZE)] : [1280, 390];
    for (const size of sizes) {
      // Each width starts from no key and no company, so the save is a first one.
      await call('admin', 'PUT', '/api/ai', { provider: 'none', model: '', clearKey: true, source: 'custom', monthlyTokens: 0 });
      const t = await open(size);
      try {
        await sleep(1500);
        // The tab: the module's own, the card above the setup; no AI service entry anywhere.
        const shape = await t.eval(`({
          tab: [...document.querySelectorAll('#module-subtabs .subtab')].map((b) => b.dataset.modulePart + '=' + b.textContent.trim()),
          card: /AI Assistant/.test(document.getElementById('module-tab-card').textContent),
          setup: document.getElementById('ai-provider').getClientRects().length > 0,
          stale: !!document.getElementById('ai-row') || !!document.querySelector('[data-ai-toggle]') || !!document.getElementById('ai-tab-card'),
        })`);
        expect(shape.tab.includes('assistant=AI Assistant') && !shape.tab.some((x) => /^ai=/.test(x)), `the tab strip is not the module's (${JSON.stringify(shape.tab)})`);
        expect(shape.card && shape.setup && !shape.stale, `AI Assistant's tab does not show its card and its setup (${JSON.stringify(shape)})`);
        // Before anything is saved: not set, the key box closed.
        expect(await t.eval(`document.getElementById('ai-key-state').textContent`) === 'Not set', 'the key does not start as Not set');

        // The form, by hand.
        await t.eval(`(() => { const p = document.getElementById('ai-provider'); p.value = 'openai'; p.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await sleep(300);
        await t.click('#ai-key-replace');
        const box = await t.eval(`(() => { const k = document.getElementById('ai-key'); return { type: k.type, shown: k.getClientRects().length > 0, auto: k.autocomplete, hint: k.dataset.lpignore + '/' + k.hasAttribute('data-1p-ignore'), spell: k.spellcheck, name: k.name, label: k.getAttribute('aria-label') }; })()`);
        expect(box.type === 'password' && box.shown && box.auto === 'new-password' && box.hint === 'true/true' && box.spell === false && box.label, `the key box is not a guarded password box (${JSON.stringify(box)})`);
        await t.typeInto('#ai-key', KEY);
        await t.eval(`document.getElementById('ai-key').dispatchEvent(new Event('change', { bubbles: true }))`);
        await sleep(2500); // the list of models is asked for with the typed key; with no network it fails and offers typing the name
        await t.eval(`(() => { const b = document.getElementById('ai-model-manual'); if (!b.hidden) b.click(); })()`);
        await t.typeInto('#ai-model', 'test-model');
        await t.eval(`(() => { const c = document.getElementById('ai-cap'); c.value = '100000'; })()`);
        const net = recordResponses(t);
        await t.click('#ai-save');
        let status = '';
        for (let i = 0; i < 40 && status !== 'saved'; i += 1) { await sleep(250); status = await t.eval(`document.getElementById('ai-status').textContent`); }
        expect(status === 'saved', `the save did not say saved ("${status}")`);
        await sleep(1500); // the tab loads its use and What AI may see after the save
        const afterSave = await net.done();

        // After the save: the field, the page, every response.
        const state = await t.eval(`({ state: document.getElementById('ai-key-state').textContent, box: document.getElementById('ai-key').value, hidden: document.getElementById('ai-key').hidden, provider: document.getElementById('ai-provider').value })`);
        expect(state.state === 'Set' && state.box === '' && state.hidden && state.provider === 'openai', `after the save the field is not just "Set" (${JSON.stringify(state)})`);
        const inPage = await t.eval(DOM_HOLDS_KEY);
        expect(inPage.length === 0, `the key is in ${inPage.join(', ')} after the save`);
        const holders = afterSave.filter((r) => r.body.includes(KEY)).map((r) => r.url);
        expect(holders.length === 0, `the key is in a response after the save: ${holders.join(', ')}`);
        expect(afterSave.some((r) => /\/api\/ai$/.test(r.url)) && afterSave.length >= 3, `too few responses were read to mean anything (${afterSave.length})`);
        const stored = (await (await call('admin', 'GET', '/api/ai')).json()).ai;
        expect(stored.keySet === true && stored.provider === 'openai' && stored.model === 'test-model' && !JSON.stringify(stored).includes(KEY), `GET /api/ai after the save is not provider + keySet only (${JSON.stringify(stored)})`);
        say(`${size}: saved; the key is not in the DOM, any field, storage, the address or any of ${afterSave.length} responses; the field says "${state.state}"`);

        // The use bar and What AI may see.
        const use = await t.eval(`(() => { const m = document.getElementById('ai-meter'); const u = document.getElementById('ai-usage'); return { usage: u.getClientRects().length > 0, meter: m.getClientRects().length > 0 && m.getBoundingClientRect().width > 40, text: document.getElementById('ai-usage-text').textContent, box: document.getElementById('ai-use-box').textContent.trim().length > 0, sees: document.querySelectorAll('#ai-sees-box input[role=switch][data-sees]').length }; })()`);
        expect(use.usage && use.meter && /tokens/.test(use.text) && use.box, `the use bar does not draw (${JSON.stringify(use)})`);
        expect(use.sees > 0, 'What AI may see is not drawn');
        expect(await t.eval(`document.documentElement.scrollWidth <= ${size} + 1`), `the tab scrolls sideways at ${size}`);
        if (size <= 480) {
          const small = await t.eval(`['ai-save', 'ai-key-replace', 'ai-key-clear', 'ai-sees-save'].map((id) => { const b = document.getElementById(id); const r = b.getBoundingClientRect(); return b.getClientRects().length ? id + '=' + Math.round(r.height) : ''; }).filter(Boolean)`);
          expect(small.every((x) => Number(x.split('=')[1]) >= 44), `a target is under 44 px high at ${size} (${small.join(', ')})`);
        }
        await t.eval(`document.getElementById('ai-provider').scrollIntoView()`);
        if (process.env.AI_MANAGE_SHOTS) fs.writeFileSync(path.join(process.env.AI_MANAGE_SHOTS, `manage-ai-${size}.png`), Buffer.from((await t.cdp.send('Page.captureScreenshot', { format: 'png' }, t.sid)).data, 'base64'));

        // A reload (the page and its source drawn again from the server): still just "Set".
        const again = recordResponses(t);
        await t.cdp.send('Page.reload', {}, t.sid);
        await t.waitFor('#ai-sees-box');
        await sleep(2500);
        const reloaded = await again.done();
        expect(await t.eval(`document.getElementById('ai-key-state').textContent`) === 'Set', 'after a reload the field does not say Set');
        expect((await t.eval(DOM_HOLDS_KEY)).length === 0, 'the key is in the page after a reload');
        expect(reloaded.every((r) => !r.body.includes(KEY)) && reloaded.some((r) => /\/admin(\?|$)/.test(r.url)), 'the key is in a response after a reload, or the page source was not read');
        say(`${size}: after a reload the field says Set and ${reloaded.length} responses (the page's source included) hold no key; the use bar draws`);
      } finally { await t.close(); }
    }

    // View-source, plainly: the HTML the server sends for the page holds no key either, and the data folder holds it only sealed.
    const html = await (await call('admin', 'GET', '/admin')).text();
    expect(!html.includes(KEY), 'the key is in the page source from the server');
    const onDisk = filesHolding(dataDir, KEY);
    expect(onDisk.length === 0, `the key is on disk in the clear: ${onDisk.join(', ')}`);
    say('the page source and the whole data folder hold no key in the clear');
  } finally {
    if (browser) { browser.cdp.ws.close(); await stopBrowser(browser.child, browser.dir); }
    if (server) await stopServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  if (failures.length) { for (const f of failures) console.error('check-ai-manage-tab: FAIL ' + f); return 1; }
  say('OK');
  return 0;
}

main().then((c) => process.exit(c), (err) => { console.error(err); process.exit(1); });
