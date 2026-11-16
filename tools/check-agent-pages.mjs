#!/usr/bin/env node
/*
 * check-agent-pages.mjs -- the agent pages (documentation/plans/plan-agent-access.md, step 2), live in headless Chromium against
 * throwaway servers (AGENT_TOKENS=true, and one without it):
 *   - Manage > Users, the Agents section: with the server variable off it says so and offers no switch and no "Add an agent";
 *     with it on, the owner turns the switch on (saved on the server), and "Add an agent" appears;
 *   - Add an agent (name box, default Claude) opens the agent's page; its row in the list reads "<name> (agent)", has Open
 *     and none of Mute, Kick, two-step, calendar feed or an Edit profile link, and Open goes to the page;
 *   - the agent's page: rename, Make token (the token is in a dialog once, with the plain warning and Copy; after Done and after
 *     a reload it is on no page, and the server never tells it again), Revoke, Turn off and Turn on (a token can't be made while it
 *     is off, the server's sentence is read), Delete (typed confirm) and What it did (the log in plain words, notes for a line over
 *     its limit or a refused token, paged with Show older);
 *   - a member has no Manage page and the server refuses them the agent's token and log (403);
 *   - a script-looking name, route, action, address, message and space name is drawn as text: no element is made, nothing runs;
 *   - a space's Set up, Members: the agent is there as "<name> (agent)" with no moderator tick, and adds like a member;
 *   - at 390 wide: nothing scrolls sideways and the buttons on the agent's page and in the token dialog are at least 44 px tall
 *     (by their box or a hit area), and the page reads the same way.
 * `--shots=<dir>`: also writes pictures (the Users tab, the agent's page, the token dialog; dark, and light for the page and the dialog).
 * With no Chromium it says SKIPPED (not a pass).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stopBrowser } from './browser-launch.mjs';
import { findBrowser, launch, freePort, startServer, stopServer, Tab, sleep } from './shots.mjs';
import { PASSWORD } from './shots-seed.mjs';

const say = (...a) => console.log('check-agent-pages:', ...a);
const failures = [];
const expect = (ok, text) => { if (!ok) failures.push(text); };
const shotsArg = process.argv.find((a) => a.startsWith('--shots='));
const SHOTS = shotsArg ? path.resolve(shotsArg.slice('--shots='.length)) : '';
const HOSTILE = '<img src=x onerror=window.__pwn=1>';
const WARNING = 'This is shown once. If you lose it, make a new one; the old one then stops working.';
const SPACE_NAME = 'Paris <b>trip</b>';

const jarOf = (res) => res.headers.getSetCookie().map((c) => { const [nv] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1) }; });

async function main() {
  const bin = findBrowser();
  if (!bin) { say('SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); return 0; }
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const dirs = [];
  const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pages-')); dirs.push(d); return d; };
  let server = null; let plain = null; let browser = null;
  try {
    plain = await startServer(tmp(), await freePort(), 'first', { AGENT_TOKENS: '' });
    const dataDir = tmp();
    server = await startServer(dataDir, await freePort(), 'first', { AGENT_TOKENS: 'true' });
    const jars = {};
    const call = async (as, method, url, body, srv = server, bearer = null) => {
      const headers = { 'content-type': 'application/json', accept: 'application/json', origin: srv.base };
      if (bearer) headers.authorization = `Bearer ${bearer}`;
      else if (jars[`${srv.base}|${as}`]) headers.cookie = jars[`${srv.base}|${as}`].map((c) => `${c.name}=${c.value}`).join('; ');
      const res = await fetch(srv.base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      let json = null; try { json = await res.json(); } catch { /* none */ }
      return { status: res.status, json, res };
    };
    const signIn = async (login, srv = server) => {
      const r = await call('__none', 'POST', '/api/login', { login, password: PASSWORD }, srv);
      expect(r.status === 200, `cannot sign in as ${login}: ${r.status}`);
      jars[`${srv.base}|${login}`] = jarOf(r.res);
    };
    await signIn('admin'); await signIn('admin', plain);
    expect((await call('admin', 'POST', '/api/users', { login: 'mia', displayName: 'Mia', role: 'member', password: PASSWORD })).status === 201, 'could not make the member');
    await signIn('mia');
    const space = (await call('admin', 'POST', '/api/spaces', { name: SPACE_NAME, description: '', members: [] })).json.space;

    browser = await launch(bin);
    const open = async (size, mode, as, srv = server) => {
      const tab = new Tab(browser.cdp, {});
      await tab.open(size, mode, false);
      for (const c of jars[`${srv.base}|${as}`] || []) await tab.cdp.send('Network.setCookie', { name: c.name, value: c.value, url: srv.base, httpOnly: true }, tab.sid);
      const problems = [];
      tab.cdp.listeners.push((m) => {
        if (m.sessionId !== tab.sid) return;
        if (m.method === 'Runtime.exceptionThrown') problems.push('uncaught: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
      });
      tab.problems = problems;
      tab.srv = srv;
      return tab;
    };
    // Through a blank page first, so an address that differs only by its #part is a real load, as a reload is.
    const go = async (tab, url) => { await tab.cdp.send('Page.navigate', { url: 'about:blank' }, tab.sid); await sleep(100); await tab.cdp.send('Page.navigate', { url: tab.srv.base + url }, tab.sid); await sleep(300); await tab.settle(); };
    const shot = async (tab, name, full = true) => { if (SHOTS) fs.writeFileSync(path.join(SHOTS, `${name}.png`), await tab.shoot(full)); };
    const text = (tab, sel) => tab.eval(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
    const hiddenOf = (tab, sel) => tab.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !e || e.hidden || !e.getClientRects().length; })()`);
    const waitText = async (tab, sel, want, ms = 8000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) { if ((await text(tab, sel)).includes(want)) return true; await sleep(100); }
      return false;
    };
    const dialogOpen = (tab) => tab.eval(`!!document.querySelector('dialog[open]')`);
    const waitDialog = async (tab, on, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await dialogOpen(tab) === on) return true; await sleep(100); } return false; };
    const wide = (tab) => tab.eval(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
    // The tallest of a control's box and its enlarged hit area (a transparent ::after), as check-phone-targets measures it.
    const hit = (tab, sel) => tab.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return 0; const b = e.getBoundingClientRect(); const a = getComputedStyle(e, '::after'); const h = a.content !== 'none' && a.position === 'absolute' ? parseFloat(a.height) || 0 : 0; return Math.max(b.height, h); })()`);
    // A click after the control is brought to the middle of the window: nearest would leave it under the top bar's tabs.
    const press = async (tab, sel) => { await tab.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) e.scrollIntoView({ block: 'center' }); })()`); await sleep(100); await tab.click(sel); };
    const pwn = (tab) => tab.eval(`window.__pwn === undefined ? 0 : 1`);

    // ---- the server's variable off: the section says so, nothing to switch or add ----
    {
      const tab = await open(1280, 'dark', 'admin', plain);
      await go(tab, '/admin#users');
      await tab.waitFor('#agents-off-server:not([hidden])').catch(() => {});
      expect(!(await hiddenOf(tab, '#agents-off-server')), 'the server variable is off and the page does not say so');
      expect((await text(tab, '#agents-off-server')) === 'Agents are off on this server. The person who runs the server turns them on.', `the off-server sentence is "${await text(tab, '#agents-off-server')}"`);
      expect(await hiddenOf(tab, '#agents-on-server') && await hiddenOf(tab, '#add-agent-toggle'), 'the server variable is off and the page still offers the switch or "Add an agent"');
      expect(tab.problems.length === 0, `server variable off: ${tab.problems.join('; ')}`);
      await tab.close();
    }

    // ---- the owner: the switch, add an agent, the row ----
    const tab = await open(1280, 'dark', 'admin');
    await go(tab, '/admin#users');
    await tab.waitFor('#agents-on-server:not([hidden])');
    expect(await tab.eval(`!document.getElementById('set-agents').checked`) && await hiddenOf(tab, '#add-agent-toggle'), 'before the switch is on, the page offers "Add an agent"');
    if (SHOTS) await shot(tab, 'users-before-switch-1280-dark');
    await tab.click('#set-agents');
    await tab.waitFor('#add-agent-toggle:not([hidden])');
    await sleep(300);
    expect((await call('admin', 'GET', '/api/settings')).json.settings.agents === true, 'the switch did not turn Agents on on the server');
    await tab.click('#add-agent-toggle');
    await tab.waitFor('#new-agent-name');
    expect(await tab.eval(`document.getElementById('new-agent-name').value`) === 'Claude', 'the name box does not start as Claude');
    await tab.eval(`(() => { const i = document.getElementById('new-agent-name'); i.value = ${JSON.stringify(HOSTILE)}; })()`);
    await tab.click('#add-agent button[type="submit"]');
    await tab.waitFor('#agent-page:not([hidden])');
    await sleep(300);
    const agents = (await call('admin', 'GET', '/api/users')).json.users.filter((u) => u.agent);
    expect(agents.length === 1 && agents[0].displayName === HOSTILE, 'Add an agent did not make one agent with the typed name');
    const agent = agents[0];
    expect(await tab.eval(`location.hash`) === `#agent/${agent.key}`, `the address after Add is ${await tab.eval('location.hash')}`);
    expect((await text(tab, '[data-agent-title]')) === `${HOSTILE} (agent)`, 'a script-looking name is not drawn as text in the title');
    expect(await tab.eval(`document.querySelectorAll('#agent-page img, #agent-page script').length`) === 0 && !(await pwn(tab)), 'a script-looking name made an element or ran');
    expect(await tab.eval(`document.getElementById('users-main').hidden`), 'the list shows beside the agent page');

    // The name, renamed to Claude.
    await tab.eval(`(() => { const i = document.querySelector('[data-agent-name]'); i.value = 'Claude'; })()`);
    await press(tab, '[data-agent="rename"]');
    expect(await waitText(tab, '[data-agent-title]', 'Claude (agent)'), 'Save name did not change the title');
    expect((await call('admin', 'GET', `/api/users/${agent.key}`)).json.user.displayName === 'Claude', 'Save name did not save on the server');

    // The row in the list.
    await press(tab, '[data-agent="back"]');
    await tab.waitFor('#users-main:not([hidden])');
    const row = await tab.eval(`(() => { const c = document.querySelector('#users .user-card[data-key="${agent.key}"]'); if (!c) return null; const vis = (s) => { const e = c.querySelector(s); return !!e && !e.hidden && e.getClientRects().length > 0; }; const open = c.querySelector('[data-action="edit"]'); return { name: c.querySelector('[data-name]').textContent, mute: vis('[data-action="mute"]'), kick: vis('[data-action="kick"]'), mfa: vis('[data-mfa]'), feed: vis('[data-feed]'), feedOff: vis('[data-action="feed-off"]'), open: open.textContent, href: open.getAttribute('href'), text: c.textContent }; })()`);
    expect(row && row.name === 'Claude (agent)', `the agent's row reads "${row && row.name}"`);
    expect(row && !row.mute && !row.kick && !row.mfa && !row.feed && !row.feedOff, 'the agent row has a call, two-step or feed control');
    expect(row && row.open === 'Open' && row.href === `#agent/${agent.key}`, `the agent row's link is "${row && row.open}" to ${row && row.href}, not Open to its page`);
    expect(row && !/password|personal link|moderator/i.test(row.text), 'the agent row mentions a password, a personal link or a moderator');
    expect(await tab.eval(`document.querySelectorAll('#users .user-card:not([data-key="${agent.key}"]) [data-action="edit"]')[0].textContent`) === 'Edit profile', 'a person\'s row no longer says Edit profile');
    await shot(tab, 'users-1280-dark');
    await tab.click(`#users .user-card[data-key="${agent.key}"] [data-action="edit"]`);
    await tab.waitFor('#agent-page:not([hidden])');
    expect(await tab.eval(`location.hash`) === `#agent/${agent.key}`, 'Open did not go to the agent page');

    // Seed the log: a space it works in, and older lines (a previous day), some of them hostile.
    expect((await call('admin', 'PATCH', `/api/spaces/${space.id}`, { members: ['mia', agent.key] })).status === 200, 'could not add the agent to the space');
    const logDir = path.join(dataDir, 'agent-log', agent.key);
    fs.mkdirSync(logDir, { recursive: true });
    const lines = [];
    const at = (n) => new Date(Date.UTC(2026, 9, 14, 8, 0, 0) + n * 1000).toISOString();
    for (let i = 0; i < 120; i++) lines.push({ at: at(i), agent: agent.key, token: 'tok1', method: 'GET', route: '/api/modules/:id/data', space: space.id, action: null, request: null, message: null, status: 200, address: '203.0.113.9', kind: 'read' });
    lines.push({ at: at(200), agent: agent.key, token: 'tok1', method: 'POST', route: '/api/spaces/:id/action', space: space.id, action: 'schedule:addMilestone', request: 7, message: null, status: 202, address: '203.0.113.9', kind: 'write' });
    lines.push({ at: at(201), agent: agent.key, token: 'tok1', method: 'GET', route: HOSTILE, space: space.id, action: HOSTILE, request: null, message: '<b>hi</b>', status: 200, address: HOSTILE, kind: 'read' });
    lines.push({ at: at(202), agent: agent.key, token: 'tok1', method: 'POST', route: '/api/spaces/:id/action', space: space.id, action: `x:${HOSTILE}`, request: 8, message: null, status: 202, address: '<script>window.__pwn=1</script>', kind: 'write' });
    lines.push({ at: at(203), agent: agent.key, token: 'tok1', method: 'GET', route: '(refused)', space: null, action: null, request: null, message: null, status: 403, address: '203.0.113.9', kind: 'read' });
    lines.push({ at: at(204), agent: agent.key, token: 'tok1', method: 'GET', route: '(refused)', space: null, action: null, request: null, message: null, status: 401, address: '203.0.113.9', kind: null });
    fs.writeFileSync(path.join(logDir, '2026-10-14.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');

    // The token: made, shown once.
    await go(tab, `/admin#agent/${agent.key}`);
    await tab.waitFor('[data-agent="make"]');
    expect(await text(tab, '[data-agent-token-state]') === 'No token yet.', `with no token the page says "${await text(tab, '[data-agent-token-state]')}"`);
    expect(await text(tab, '[data-agent="make"]') === 'Make token' && await hiddenOf(tab, '[data-agent="revoke"]'), 'Make token / Revoke are not as they are before a token');
    await shot(tab, 'agent-page-empty-1280-dark');
    await press(tab, '[data-agent="make"]');
    expect(await waitDialog(tab, true), 'Make token showed no dialog');
    const made = await tab.eval(`(() => { const d = document.querySelector('dialog.agent-token-dialog[open]'); if (!d) return null; return { token: d.querySelector('.agent-token-value').textContent, warning: d.querySelector('.agent-token-warning').textContent, copy: !!d.querySelector('[data-agent="copy"]'), title: d.querySelector('.sdk-dialog-title').textContent, focus: document.activeElement && document.activeElement.textContent }; })()`);
    expect(made && /^agt_[A-Za-z0-9_-]{43}$/.test(made.token), 'the dialog does not show a token');
    expect(made && made.warning === WARNING, `the warning reads "${made && made.warning}"`);
    expect(made && made.copy && made.title === 'Token for Claude (agent)', `the dialog's title is "${made && made.title}" or Copy is missing`);
    const token = made ? made.token : '';
    expect((await call('x', 'GET', '/api/agent/me', undefined, server, token)).status === 200, 'the token shown does not work');
    await shot(tab, 'token-dialog-1280-dark', false);
    await tab.switchMode('light'); await tab.settle();
    await shot(tab, 'token-dialog-1280-light', false);
    await tab.switchMode('dark'); await tab.settle();
    await press(tab, '[data-agent="token-done"]');
    expect(await waitDialog(tab, false), 'Done did not close the token dialog');
    expect(!(await tab.eval(`document.documentElement.outerHTML.includes(${JSON.stringify(token)}) || document.body.innerText.includes(${JSON.stringify(token)})`)), 'the token is still on the page after Done');
    expect(await text(tab, '[data-agent="make"]') === 'Make a new token' && !(await hiddenOf(tab, '[data-agent="revoke"]')), 'after a token is made the page does not offer a new one and Revoke');
    expect(/^The token works until /.test(await text(tab, '[data-agent-token-state]')), `the token state reads "${await text(tab, '[data-agent-token-state]')}"`);
    await go(tab, `/admin#agent/${agent.key}`);
    await tab.waitFor('[data-agent="make"]');
    expect(!(await tab.eval(`document.documentElement.outerHTML.includes(${JSON.stringify(token)}) || document.body.innerText.includes(${JSON.stringify(token)})`)), 'the token is on the page after a reload');
    const again = await call('admin', 'GET', `/api/users/${agent.key}/token`);
    expect(again.status === 200 && !JSON.stringify(again.json).includes(token) && again.json.token && !('token' in again.json.token), 'the server told the token again');

    // The log: the agent's own calls, then over its limit.
    for (let i = 0; i < 62; i++) await call('x', 'GET', '/api/agent/me', undefined, server, token);
    expect((await call('x', 'GET', '/api/agent/me', undefined, server, token)).status === 429, 'the agent was not over its limit after 62 reads');
    await go(tab, `/admin#agent/${agent.key}`);
    await tab.waitFor('[data-agent-log] li');
    await tab.waitFor('[data-agent="older"]:not([hidden])').catch(() => {});
    const log = await tab.eval(`(() => { const items = [...document.querySelectorAll('[data-agent-log] li')]; return { whats: items.map((l) => l.querySelector('.agent-log-what').textContent), details: items.map((l) => l.textContent), count: items.length, older: !document.querySelector('[data-agent="older"]').hidden, markup: document.querySelectorAll('[data-agent-log] img, [data-agent-log] script, [data-agent-log] b').length, notes: document.querySelectorAll('[data-agent-log] .is-note').length }; })()`);
    expect(log.whats.includes('Looked at its own limits'), 'the log has no "Looked at its own limits" line');
    expect(log.whats.includes('Over its limit') && log.notes >= 1, 'the log has no "Over its limit" note');
    expect(log.whats[0] === 'Over its limit' || log.whats.slice(0, 3).includes('Over its limit'), `the newest lines are not the newest first (${log.whats.slice(0, 3).join(' | ')})`);
    expect(log.count === 100 && log.older, `the first page is ${log.count} lines with Show older ${log.older ? 'shown' : 'hidden'}, not 100 with it shown`);
    expect(log.whats.includes('Ask for add milestone in ' + SPACE_NAME), `no "Ask for add milestone in ${SPACE_NAME}" line (${log.whats.filter((w) => /Ask/.test(w)).join(' | ')})`);
    expect(log.whats.includes('Refused: GET request'), 'no "Refused: GET request" line');
    expect(log.whats.includes('Token refused'), 'no "Token refused" note for a kind-null 401 line');
    expect(log.whats.includes(`Called GET ${HOSTILE} in ${SPACE_NAME}`), 'a script-looking route is not read out as text');
    expect(log.whats.some((w) => w === `Ask for ${('x:' + HOSTILE).split(':').pop().replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()} in ${SPACE_NAME}`), 'a script-looking action is not read out as text');
    expect(log.details.some((d) => d.includes(HOSTILE)) && log.details.some((d) => d.includes('<script>window.__pwn=1</script>')) && log.details.some((d) => d.includes('<b>hi</b>')), 'a script-looking address or message is not shown as text');
    expect(log.markup === 0 && !(await pwn(tab)), 'a value in the log made an element or ran');
    await shot(tab, 'agent-page-1280-dark');
    await tab.switchMode('light'); await tab.settle();
    await shot(tab, 'agent-page-1280-light');
    await tab.switchMode('dark'); await tab.settle();
    await press(tab, '[data-agent="older"]');
    await sleep(800);
    expect(await tab.eval(`document.querySelectorAll('[data-agent-log] li').length`) > 100, 'Show older did not add older lines');
    expect(await tab.eval(`(() => { const items = [...document.querySelectorAll('[data-agent-log] li .agent-log-what')].map((e) => e.textContent); return items.filter((w) => w === 'Read data in ${SPACE_NAME}').length; })()`) >= 20, 'the older page is not the older lines');
    expect(await hiddenOf(tab, '[data-agent="older"]'), 'Show older stays after the last page');

    // Revoke.
    await press(tab, '[data-agent="revoke"]');
    expect(await waitDialog(tab, true), 'Revoke asked nothing');
    await tab.click('dialog [data-ok]');
    expect(await waitDialog(tab, false), 'the Revoke question did not close');
    expect(await waitText(tab, '[data-agent-token-state]', 'No token yet.'), 'after Revoke the page still shows a token');
    expect((await call('x', 'GET', '/api/agent/me', undefined, server, token)).status === 401, 'a revoked token still works');
    expect((await call('admin', 'GET', `/api/users/${agent.key}/token`)).json.token === null, 'the server still holds the revoked token');

    // Turn off and on: a token can't be made while it is off.
    await press(tab, '[data-agent="off"]');
    expect(await waitText(tab, '[data-agent="off"]', 'Turn on'), 'Turn off did not change the button to Turn on');
    expect(await text(tab, '[data-agent-state]') === 'Off', 'the state is not Off');
    expect((await call('admin', 'GET', `/api/users/${agent.key}`)).json.user.off === true, 'Turn off did not turn the agent off on the server');
    await press(tab, '[data-agent="make"]');
    expect(await waitText(tab, '[data-agent-status]', 'This agent is turned off. Turn it on first.'), `Make token while off said "${await text(tab, '[data-agent-status]')}"`);
    expect(!(await dialogOpen(tab)), 'a dialog opened while the agent is off');
    await press(tab, '[data-agent="back"]');
    await tab.waitFor('#users-main:not([hidden])');
    expect(!(await hiddenOf(tab, `#users .user-card[data-key="${agent.key}"] [data-off]`)), 'the row does not say the agent is off');
    await tab.click(`#users .user-card[data-key="${agent.key}"] [data-action="edit"]`);
    await tab.waitFor('#agent-page:not([hidden])');
    await press(tab, '[data-agent="off"]');
    expect(await waitText(tab, '[data-agent="off"]', 'Turn off') && await text(tab, '[data-agent-state]') === 'On', 'Turn on did not turn it on');
    expect((await call('admin', 'GET', `/api/users/${agent.key}`)).json.user.off === false, 'Turn on did not turn the agent on on the server');

    // Set up, Members (before the delete): "(agent)", no moderator tick, adds like a member.
    {
      const t = await open(1280, 'dark', 'admin');
      await go(t, `/?setup=${encodeURIComponent(space.id)}#members`);
      await t.waitFor(`[data-member="${agent.key}"]`);
      const m = await t.eval(`(() => { const sw = document.querySelector('[data-member="${agent.key}"]'); const row = sw.closest('label'); return { label: row.querySelector('.sdk-choice-label').textContent, on: sw.checked, moderator: /moderator/i.test(document.querySelector('#setup-members').textContent), ticks: document.querySelectorAll('#setup-members input:not([data-member])').length }; })()`);
      expect(m.label === 'Claude (agent)', `the member row reads "${m.label}"`);
      expect(m.on && !m.moderator && m.ticks === 0, 'the agent row has a moderator tick, or is not on as the server has it');
      await t.click(`[data-member="${agent.key}"]`);
      await t.click('#setup-save');
      await sleep(1200);
      const members = (await call('admin', 'GET', `/api/spaces/${space.id}`)).json.space.members || [];
      expect(!members.includes(agent.key), 'switching the agent off in Set up and saving did not take it out of the space');
      await shot(t, 'setup-members-1280-dark', false);
      expect(t.problems.length === 0, `Set up: ${t.problems.join('; ')}`);
      await t.close();
    }

    // A member: no Manage page, no agent controls, the server refuses.
    {
      const t = await open(1280, 'dark', 'mia');
      await go(t, '/admin#users');
      await sleep(1500);
      expect(await t.eval(`document.getElementById('agents-section') === null || document.getElementById('agents-section').getClientRects().length === 0`) && /Owners only/.test(await t.eval(`document.body.innerText`)), 'a member is shown the Manage page, or its agent controls');
      await t.close();
      expect((await call('mia', 'GET', `/api/users/${agent.key}/token`)).status === 403, 'a member could read the agent\'s token record');
      expect((await call('mia', 'POST', `/api/users/${agent.key}/token`)).status === 403, 'a member could make a token');
      expect((await call('mia', 'GET', `/api/users/${agent.key}/agent-log`)).status === 403, 'a member could read the agent\'s log');
      expect((await call('mia', 'POST', '/api/users', { agent: true })).status === 403, 'a member could add an agent');
      expect((await call('mia', 'PATCH', '/api/settings', { agents: false })).status === 403, 'a member could turn Agents off');
    }

    // 390 wide: the agent's page and the token dialog.
    {
      const t = await open(390, 'dark', 'admin');
      await go(t, `/admin#agent/${agent.key}`);
      await t.waitFor('[data-agent="make"]');
      await sleep(400);
      expect(await wide(t) <= 1, '390: the agent page scrolls sideways');
      for (const sel of ['[data-agent="make"]', '[data-agent="off"]', '[data-agent="delete"]', '[data-agent="rename"]']) expect(await hit(t, sel) >= 43.5, `390: ${sel} is ${await hit(t, sel)} px tall (44 is the least)`);
      await shot(t, 'agent-page-390-dark');
      await t.switchMode('light'); await t.settle();
      await shot(t, 'agent-page-390-light');
      await t.switchMode('dark'); await t.settle();
      await press(t, '[data-agent="make"]');
      expect(await waitDialog(t, true), '390: Make token showed no dialog');
      expect(await wide(t) <= 1, '390: the token dialog makes the page scroll sideways');
      const tokenWide = await t.eval(`(() => { const d = document.querySelector('dialog.agent-token-dialog'); const r = d.getBoundingClientRect(); const k = d.querySelector('.agent-token-value').getBoundingClientRect(); return { left: r.left, right: r.right, kLeft: k.left, kRight: k.right, width: window.innerWidth }; })()`);
      expect(tokenWide.left >= 0 && tokenWide.right <= tokenWide.width && tokenWide.kLeft >= tokenWide.left && tokenWide.kRight <= tokenWide.right + 1, `390: the token box is outside the dialog or the window (${JSON.stringify(tokenWide)})`);
      for (const sel of ['dialog [data-agent="copy"]', 'dialog [data-agent="token-done"]']) expect(await hit(t, sel) >= 43.5, `390: ${sel} is ${await hit(t, sel)} px tall (44 is the least)`);
      await shot(t, 'token-dialog-390-dark', false);
      await t.switchMode('light'); await t.settle();
      await shot(t, 'token-dialog-390-light', false);
      await t.switchMode('dark'); await t.settle();
      await t.key('Escape');
      expect(await waitDialog(t, false), '390: Escape did not close the token dialog');
      await go(t, '/admin#users');
      await t.waitFor(`#users .user-card[data-key="${agent.key}"]`);
      expect(await wide(t) <= 1, '390: the Users tab scrolls sideways');
      expect(await hit(t, `#users .user-card[data-key="${agent.key}"] [data-action="edit"]`) >= 43.5, '390: the agent row\'s Open is under 44 px tall');
      expect(await hit(t, '#add-agent-toggle') >= 43.5, '390: Add an agent is under 44 px tall');
      await shot(t, 'users-390-dark');
      expect(t.problems.length === 0, `390: ${t.problems.join('; ')}`);
      await t.close();
    }

    // Delete: a typed confirm, then the list without it.
    await go(tab, `/admin#agent/${agent.key}`);
    await tab.waitFor('[data-agent="delete"]');
    await press(tab, '[data-agent="delete"]');
    expect(await waitDialog(tab, true), 'Delete asked nothing');
    expect(await tab.eval(`document.querySelector('dialog [data-ok]').disabled`), 'Delete is on before the name is typed');
    await tab.typeInto('dialog input', 'Claude');
    await tab.click('dialog [data-ok]');
    expect(await waitDialog(tab, false), 'the Delete question did not close');
    await tab.waitFor('#users-main:not([hidden])');
    expect(await tab.eval(`location.hash`) === '#users', `after Delete the address is ${await tab.eval('location.hash')}`);
    expect(await tab.eval(`!document.querySelector('#users .user-card[data-key="${agent.key}"]')`), 'the deleted agent is still in the list');
    expect((await call('admin', 'GET', `/api/users/${agent.key}`)).status === 404, 'Delete did not delete the agent on the server');
    expect(tab.problems.length === 0, `Manage: ${tab.problems.join('; ')}`);
    await tab.close();
    // An address that names no agent opens the list.
    {
      const t = await open(1280, 'dark', 'admin');
      await go(t, '/admin#agent/nobody');
      await t.waitFor('#users-main:not([hidden])');
      expect(await hiddenOf(t, '#agent-page') && await t.eval(`location.hash`) === '#users', 'an address with no such agent shows the agent page');
      await t.close();
    }
  } catch (err) {
    for (const f of failures) console.error('check-agent-pages: ' + f); // what failed before it stopped
    throw err;
  } finally {
    if (browser) await stopBrowser(browser.child, browser.dir);
    await stopServer(server);
    await stopServer(plain);
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  }
  if (failures.length) { for (const f of failures) console.error('check-agent-pages: ' + f); return 1; }
  say('ok');
  return 0;
}
process.exitCode = await main();
