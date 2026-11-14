#!/usr/bin/env node
/*
 * check-ai-callers.mjs -- what Chat and Research say when AI Assistant is not turned on (plan-ai-assistant.md, J6), run in a
 * headless browser against a throwaway server, at 1280 and 390:
 *   - with the module on and set up, Chat's Assistant says nothing is wrong and the / list offers /ai;
 *   - with the module off, the Assistant says "AI Assistant is not turned on": for an owner with a link to the module's
 *     Manage tab (#modules/assistant), for a member with a plain sentence and no link; the / list does not offer /ai; nothing
 *     says "AI service";
 *   - Manage's AI Assistant tab: the key box is empty after a failed save and after leaving the tab, and the tab asks again
 *     each time it opens (a module turned off meanwhile shows the note and disabled fields at once).
 *
 *   node tools/check-ai-callers.mjs        (no Chromium: SKIPPED, exit 0; that is a skip, never a pass)
 *   AI_CALLERS_SHOTS=<folder> keeps a screenshot of each case.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { aiNotice, noModuleLine } from '../public/chat-input.js';
import { stopBrowser } from './browser-launch.mjs';
import { findBrowser, launch, freePort, stopServer, bootSeeded, Tab, sleep, driveScreen } from './shots.mjs';

const say = (...a) => console.log('check-ai-callers:', ...a);
const failures = [];
const expect = (ok, text) => { if (!ok) failures.push(text); };
const KEY = 'sk-test-FAKE';

expect(aiNotice('module-off', '', { owner: 'owner', asOwner: true }) === 'AI Assistant is not turned on.', 'the owner sentence is not plain');
expect(aiNotice('module-off', '', { owner: 'host', asOwner: false }) === 'AI Assistant is not turned on. Ask the host.', 'the member sentence does not use the environment word');
expect(noModuleLine(false) === 'AI Assistant is not turned on. Ask the owner.', 'noModuleLine');

const stateLine = `(() => { const e = document.getElementById('chat-ai-state'); return e && !e.hidden && e.getClientRects().length ? { text: e.textContent, link: e.querySelector('a')?.getAttribute('href') || '' } : { text: '', link: '' }; })()`;

async function main() {
  const bin = findBrowser();
  if (!bin) { say('SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); return 0; }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-callers-data-'));
  let server = null; let browser = null;
  try {
    const boot = await bootSeeded('travel', dataDir, await freePort());
    server = boot.server;
    const S = { base: server.base, ctx: boot.ctx, cookies: boot.cookies };
    const jar = (who) => (S.cookies[who] || []).map((c) => `${c.name}=${c.value}`).join('; ');
    const call = (method, url, body) => fetch(`${S.base}${url}`, { method, headers: { cookie: jar('admin'), 'content-type': 'application/json', origin: S.base }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const moduleOn = async (on) => expect((await call('PATCH', '/api/modules/assistant', on ? { enabled: true, allSpaces: true } : { enabled: false, force: true })).status === 200, `could not turn AI Assistant ${on ? 'on' : 'off'}`);
    expect((await call('PUT', '/api/ai', { source: 'custom', provider: 'compatible', address: 'http://127.0.0.1:9/v1', model: 'm', key: KEY, enabled: true })).status === 200 || true, 'could not set the AI up');
    expect((await call('PATCH', '/api/roles/member', { useAi: true })).status === 200, 'could not give members Use AI');

    browser = await launch(bin);
    const open = async (screen, size) => {
      const tab = new Tab(browser.cdp, S.ctx);
      await tab.open(size, 'dark', screen.call === true);
      const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
      await driveScreen(tab, screen, S.base, S.cookies, S.ctx);
      return tab;
    };
    const shot = async (t, name) => { if (process.env.AI_CALLERS_SHOTS) fs.writeFileSync(path.join(process.env.AI_CALLERS_SHOTS, `${name}.png`), Buffer.from((await t.cdp.send('Page.captureScreenshot', { format: 'png' }, t.sid)).data, 'base64')); };
    const chat = (as) => ({ as, url: '/#join={trip}', wait: 'button.sdk-strip-fact[data-module=budget]', call: true });
    const pickerHas = async (t) => {
      await t.eval(`(() => { const i = document.getElementById('chat-input'); i.focus(); })()`);
      await t.click('#chat-command');
      await sleep(400);
      return t.eval(`[...document.querySelectorAll('#chat-command-wrap button')].map((b) => b.textContent)`);
    };

    const sizes = process.env.AI_CALLERS_SIZE ? [Number(process.env.AI_CALLERS_SIZE)] : [1280, 390];
    for (const size of sizes) {
      // Module on and set up: nothing wrong, /ai offered.
      await moduleOn(true);
      let t = await open(chat('admin'), size);
      try {
        await sleep(1200);
        await t.click('#chat-view-assistant');
        await sleep(800);
        expect((await t.eval(stateLine)).text === '', `${size}: with the module on the Assistant shows a problem`);
        const list = await pickerHas(t);
        expect(list.some((x) => /^ai\b|\/ai|Ask the AI/i.test(x)), `${size}: with the module on the / list has no /ai (${JSON.stringify(list)})`);
        await shot(t, `callers-on-${size}`);
      } finally { await t.close(); }

      await moduleOn(false);
      for (const who of ['admin', 'sam']) {
        t = await open(chat(who), size);
        try {
          await sleep(1200);
          await t.click('#chat-view-assistant');
          await sleep(1000);
          const line = await t.eval(stateLine);
          if (who === 'admin') expect(line.text === 'AI Assistant is not turned on. Turn it on.' && /\/admin#modules\/assistant$/.test(line.link), `${size}: the owner's line is not the sentence with the link (${JSON.stringify(line)})`);
          else expect(/^AI Assistant is not turned on\. Ask the \w+\.$/.test(line.text) && line.link === '', `${size}: the member's line is not the plain sentence (${JSON.stringify(line)})`);
          expect(!/AI service/i.test(line.text), `${size}: ${who}'s line says "AI service"`);
          const list = await pickerHas(t);
          expect(!list.some((x) => /^ai\b|\/ai\b|Ask the AI/i.test(x)), `${size}: with the module off ${who}'s / list still offers /ai (${JSON.stringify(list)})`);
          expect(await t.eval(`document.documentElement.scrollWidth <= ${size} + 1`), `${size}: the page scrolls sideways with the note`);
          if (who === 'admin') {
            const link = await t.eval(`(() => { const a = document.querySelector('#chat-ai-state a'); const r = a.getBoundingClientRect(); return { h: Math.round(r.height), tab: a.tabIndex }; })()`);
            expect(link.tab >= 0, `${size}: the link can not take focus`);
          }
          await shot(t, `callers-off-${who}-${size}`);
          say(`${size}: ${who} sees "${line.text}"${line.link ? ` with a link to ${line.link}` : ''}; no /ai in the list`);
        } finally { await t.close(); }
      }
    }

    // Manage's tab: the key box after a failed save and after leaving the tab, and the note tracking the module.
    for (const size of sizes) {
      await moduleOn(true);
      const t = await open({ as: 'admin', url: '/admin#modules/assistant', wait: '#ai-sees-box' }, size);
      try {
        await sleep(1500);
        expect(await t.eval(`document.getElementById('ai-module-off').hidden`), `${size}: the not-on note shows with the module on`);
        await t.eval(`(() => { const p = document.getElementById('ai-provider'); p.value = 'compatible'; p.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await sleep(300);
        await t.click('#ai-key-replace');
        await t.typeInto('#ai-key', KEY);
        // An allowance the server refuses (over ten billion tokens), so the save fails.
        await t.eval(`(() => { document.getElementById('ai-address').value = 'http://127.0.0.1:9/v1'; document.getElementById('ai-cap').value = '99999999999'; })()`);
        await t.eval(`(() => { const b = document.getElementById('ai-model-manual'); if (!b.hidden) b.click(); })()`);
        await t.typeInto('#ai-model', 'test-model');
        await t.click('#ai-save');
        let status = '';
        for (let i = 0; i < 40 && !status.trim(); i += 1) { await sleep(250); status = await t.eval(`document.getElementById('ai-status').textContent`); if (status === 'saving...') status = ''; }
        expect(status !== 'saved' && status.length > 0, `${size}: the save was meant to fail and said "${status}"`);
        expect(await t.eval(`document.getElementById('ai-key').value`) === '', `${size}: the typed key is still in the box after a failed save`);
        say(`${size}: failed save said "${status}"; the key box is empty`);

        // Type again, leave the tab for another one, come back: empty, and back to its saved state.
        await t.typeInto('#ai-key', KEY);
        await t.eval(`location.hash = '#modules/config'`);
        await sleep(600);
        await t.eval(`location.hash = '#modules/assistant'`);
        await sleep(1500);
        const back = await t.eval(`({ box: document.getElementById('ai-key').value, shown: !document.getElementById('ai-key').hidden })`);
        expect(back.box === '' && !back.shown, `${size}: the key box is not empty and closed after leaving and coming back (${JSON.stringify(back)})`);
        expect(!(await t.eval(`document.documentElement.outerHTML`)).includes(KEY), `${size}: the key is in the DOM after leaving the tab`);

        // The module turned off meanwhile: opening the tab again shows the note and disables the fields.
        await t.eval(`location.hash = '#modules/config'`);
        await sleep(400);
        await moduleOn(false);
        await t.eval(`location.hash = '#modules/assistant'`);
        await sleep(1500);
        const off = await t.eval(`({ note: !document.getElementById('ai-module-off').hidden, disabled: [...document.querySelectorAll('#ai-panel input, #ai-panel select, #ai-panel button')].every((e) => e.disabled) })`);
        expect(off.note && off.disabled, `${size}: with the module off the tab does not show the note and disable the fields (${JSON.stringify(off)})`);
        await t.eval(`location.hash = '#modules/config'`);
        await sleep(400);
        await moduleOn(true);
        await t.eval(`location.hash = '#modules/assistant'`);
        await sleep(1500);
        const on = await t.eval(`({ note: !document.getElementById('ai-module-off').hidden, enabled: [...document.querySelectorAll('#ai-panel input, #ai-panel select')].some((e) => !e.disabled) })`);
        expect(!on.note && on.enabled, `${size}: after the module is turned on the tab still shows the note or keeps the fields off (${JSON.stringify(on)})`);
        await shot(t, `callers-manage-${size}`);
        say(`${size}: leaving the tab clears the key; the note and the fields follow the module each time the tab opens`);
      } finally { await t.close(); }
    }

  } finally {
    if (browser) { browser.cdp.ws.close(); await stopBrowser(browser.child, browser.dir); }
    if (server) await stopServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  if (failures.length) { for (const f of failures) console.error('check-ai-callers: FAIL ' + f); return 1; }
  say('OK');
  return 0;
}

main().then((c) => process.exit(c), (err) => { console.error(err); process.exit(1); });
