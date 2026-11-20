#!/usr/bin/env node
/*
 * check-agent-chat-page.mjs -- an agent's post in Chat, as the page draws it (documentation/plans/plan-agent-access.md, step 5,
 * page half), live in headless Chromium against a throwaway server (AGENT_TOKENS=true):
 *   - a message the server marks `agent: true` shows the account's name and an "agent" mark (the history, and the live event);
 *   - a person named like the agent shows no mark; a message whose `agent` is the string 'true' (a history reply rewritten in the
 *     browser: the server never sends one) shows none, so the page tests `=== true` and nothing else;
 *   - script-looking text is drawn as text (no element, nothing runs);
 *   - the mark is a word ("agent") a screen reader reads, not only a colour;
 *   - at 390 wide Chat does not scroll the page sideways.
 * `--shots=<dir>`: also writes pictures (Chat with an agent message, 1280 and 390, dark and light).
 * Run it under the browser lock: flock /tmp/browser-checks.lock node tools/check-agent-chat-page.mjs
 * With no Chromium it says SKIPPED (not a pass).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stopBrowser } from './browser-launch.mjs';
import { findBrowser, launch, freePort, startServer, stopServer, Tab, sleep } from './shots.mjs';
import { PASSWORD } from './shots-seed.mjs';

const say = (...a) => console.log('check-agent-chat-page:', ...a);
const failures = [];
const expect = (ok, text) => { if (!ok) failures.push(text); };
const shotsArg = process.argv.find((a) => a.startsWith('--shots='));
const SHOTS = shotsArg ? path.resolve(shotsArg.slice('--shots='.length)) : '';
const HOSTILE = '<img src=x onerror=window.__pwn=1>';
const jarOf = (res) => res.headers.getSetCookie().map((c) => { const [nv] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1) }; });

async function main() {
  const bin = findBrowser();
  if (!bin) { say('SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); return 0; }
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const dirs = [];
  let server = null; let browser = null;
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-chat-page-')); dirs.push(dir);
    server = await startServer(dir, await freePort(), 'first', { AGENT_TOKENS: 'true' });
    const jars = {};
    const call = async (as, method, url, body, bearer = null) => {
      const headers = { 'content-type': 'application/json', accept: 'application/json', origin: server.base };
      if (bearer) headers.authorization = `Bearer ${bearer}`;
      else if (jars[as]) headers.cookie = jars[as].map((c) => `${c.name}=${c.value}`).join('; ');
      const res = await fetch(server.base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      let json = null; try { json = await res.json(); } catch { /* none */ }
      return { status: res.status, json, res };
    };
    const signIn = async (login) => {
      const r = await call('__none', 'POST', '/api/login', { login, password: PASSWORD });
      expect(r.status === 200, `cannot sign in as ${login}: ${r.status}`);
      jars[login] = jarOf(r.res);
    };
    await signIn('admin');
    expect((await call('admin', 'PATCH', '/api/settings', { agents: true })).status === 200, 'could not turn Agents on');
    const claude = await call('admin', 'POST', '/api/users', { login: 'claude', displayName: 'Claude', role: 'member', password: PASSWORD });
    expect(claude.status === 201, 'could not make the person named Claude');
    const agent = (await call('admin', 'POST', '/api/users', { agent: true, displayName: 'Claude' })).json.user;
    expect((await call('admin', 'PATCH', '/api/roles/agent', { chat: true })).status === 200, 'could not let agents post');
    const space = (await call('admin', 'POST', '/api/spaces', { name: 'Camp', description: '', members: [claude.json.user.key, agent.key] })).json.space;
    const token = (await call('admin', 'POST', `/api/users/${agent.key}/token`)).json.token;
    await signIn('claude');
    const chat = `/api/spaces/${space.id}/chat`;
    const post = (as, text, bearer) => call(as, 'POST', chat, { text }, bearer);
    const first = await post(null, 'Milestone added: Pack the tent', token);
    expect(first.status === 200 && first.json.message.agent === true, `the agent could not post (${first.status})`);
    const hostile = await post(null, `<script>window.__pwn=1</script> ${HOSTILE}`, token);
    expect(hostile.status === 200, 'the agent could not post script-looking text');
    const person = await post('claude', 'I am a person named Claude');
    expect(person.status === 200 && !('agent' in person.json.message), 'the person named Claude was labelled by the server');
    const rewritten = await post('claude', 'String flag message');
    const rewriteId = rewritten.json.message.id;

    browser = await launch(bin);
    const open = async (size, mode) => {
      const tab = new Tab(browser.cdp, {});
      await tab.open(size, mode, false);
      for (const c of jars.claude) await tab.cdp.send('Network.setCookie', { name: c.name, value: c.value, url: server.base, httpOnly: true }, tab.sid);
      tab.problems = [];
      tab.cdp.listeners.push((m) => {
        if (m.sessionId !== tab.sid) return;
        if (m.method === 'Runtime.exceptionThrown') tab.problems.push('uncaught: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
        // The history reply with one message's `agent` made the string 'true' (the server never sends that).
        if (m.method === 'Fetch.requestPaused') {
          const { requestId } = m.params;
          tab.cdp.send('Fetch.getResponseBody', { requestId }, tab.sid).then((b) => {
            const json = JSON.parse(b.base64Encoded ? Buffer.from(b.body, 'base64').toString() : b.body);
            for (const x of json.messages || []) if (x.id === rewriteId) x.agent = 'true';
            return tab.cdp.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(json)).toString('base64') }, tab.sid);
          }).catch(() => tab.cdp.send('Fetch.continueRequest', { requestId }, tab.sid).catch(() => {}));
        }
      });
      await tab.cdp.send('Fetch.enable', { patterns: [{ urlPattern: `*${chat}`, requestStage: 'Response' }] }, tab.sid);
      await tab.cdp.send('Page.navigate', { url: `${server.base}/#join=${space.id}` }, tab.sid);
      await sleep(400);
      await tab.waitFor('#messages .message');
      await sleep(600);
      await tab.settle();
      return tab;
    };
    const rows = (tab) => tab.eval(`[...document.querySelectorAll('#messages .message')].map((m) => ({ name: m.querySelector('.message-name').textContent, marks: [...m.querySelectorAll('.activity-agent')].map((e) => e.textContent), text: m.querySelector('.message-body').textContent, markup: m.querySelectorAll('.message-body img, .message-body script').length }))`);
    const shot = async (tab, name) => { if (SHOTS) fs.writeFileSync(path.join(SHOTS, `${name}.png`), await tab.shoot(false)); };
    const pwn = (tab) => tab.eval(`window.__pwn === undefined ? 0 : 1`);
    const byText = (list, t) => list.find((r) => r.text.includes(t));

    for (const size of [1280, 390]) {
      const tab = await open(size, 'dark');
      const list = await rows(tab);
      const a = byText(list, 'Pack the tent');
      expect(a && a.name === 'Claude' && a.marks.length === 1 && a.marks[0] === 'agent', `${size}: the agent's message (history) shows ${JSON.stringify(a)}, not "Claude" with one "agent" mark`);
      const h = byText(list, 'window.__pwn');
      expect(h && h.marks.length === 1 && h.markup === 0, `${size}: the script-looking text is not drawn as text (${JSON.stringify(h)})`);
      const p = byText(list, 'I am a person named Claude');
      expect(p && p.name === 'Claude' && p.marks.length === 0, `${size}: a person named Claude shows ${JSON.stringify(p)}, not no mark`);
      const s = byText(list, 'String flag message');
      expect(s && s.marks.length === 0, `${size}: a string 'true' flag shows a mark (${JSON.stringify(s)})`);
      expect(await tab.eval(`(() => { const e = document.querySelector('#messages .activity-agent'); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== 'none'; })()`), `${size}: the agent mark is not visible`);
      expect(!(await pwn(tab)), `${size}: script text ran`);
      // The live event: the agent speaks while the page is open; so does the person named Claude.
      expect((await post(null, 'Live from the agent', token)).status === 200, 'the live post failed');
      expect((await post('claude', 'Live from the person')).status === 200, 'the live person post failed');
      await tab.waitFor('#messages .message', 'Live from the person');
      const live = await rows(tab);
      const la = byText(live, 'Live from the agent'); const lp = byText(live, 'Live from the person');
      expect(la && la.name === 'Claude' && la.marks.join() === 'agent', `${size}: the live agent message shows ${JSON.stringify(la)}`);
      expect(lp && lp.marks.length === 0, `${size}: the live message of a person named Claude shows a mark`);
      expect(await tab.eval(`document.documentElement.scrollWidth - document.documentElement.clientWidth`) <= 1, `${size}: Chat scrolls sideways`);
      if (SHOTS) {
        await tab.eval(`(() => { const m = document.getElementById('messages'); m.scrollTop = m.scrollHeight; })()`);
        await shot(tab, `chat-agent-${size}-dark`);
        await tab.switchMode('light'); await tab.settle();
        await shot(tab, `chat-agent-${size}-light`);
      }
      expect(tab.problems.length === 0, `${size}: ${tab.problems.join('; ')}`);
      await tab.close();
    }
  } catch (err) {
    for (const f of failures) console.error('check-agent-chat-page: ' + f);
    throw err;
  } finally {
    if (browser) await stopBrowser(browser.child, browser.dir);
    await stopServer(server);
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }
  if (failures.length) { for (const f of failures) console.error('check-agent-chat-page: ' + f); return 1; }
  say('ok');
  return 0;
}
process.exitCode = await main();
