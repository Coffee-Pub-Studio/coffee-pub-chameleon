#!/usr/bin/env node
/*
 * check-module-load.mjs -- every bundled module loads and draws, in a headless browser against a throwaway seeded server, at 1280 and 390.
 * Why: a script that throws while a module loads leaves its page or window blank, and a check that only reads files does not see it
 * (the same reason as tools/check-admin-load.mjs, which guards Manage).
 *   - every module in modules/ is installed and enabled on the throwaway server (what tools/shots-seed.mjs does for most of them);
 *   - for each surface a module's manifest declares, it is opened where a person opens it and must show something of its own:
 *       page    /modules/<id> as the owner (the module's own page, or the destination page it is a part of);
 *       canvas  /modules/<id>?space=<space>&popout=1 (the module's window in a space, the same frame the canvas docks);
 *       widget  the tile on the home page (/);
 *   - from the first byte of each page to the end: no uncaught error, no console.error and no /api or /m/<id> (the module's own files) answer of 400 or more, and the watch goes on for 3.5 s after the text appears, in the
 *     page and in every frame inside it (a module may run in a sandboxed frame, a process of its own, as well as in the page);
 *   - not opened directly, and so not checked here: the keyed viewer page (stream's view.html, which needs the stream key) and each
 *     `destination` entry on its own (a part's page that leads to a destination, the Calendar's and the Map's, is opened and checked);
 *   - a module with no surface (the AI Assistant) must install and enable, and appear nowhere: not in the lists the page, the canvas and
 *     the home page are drawn from, not as a tile, and its own address answers "not available" with no error;
 *   - a module with no line in EXPECT below fails the check, so a new module cannot go unchecked.
 *
 *   node tools/check-module-load.mjs        (no Chromium: SKIPPED, exit 0; that is a skip, never a pass)
 *   MODULE_LOAD_SIZE=390 node tools/check-module-load.mjs     one width only
 *   MODULE_LOAD_DUMP=1 node tools/check-module-load.mjs       also print what each surface showed
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopBrowser } from './browser-launch.mjs';
import { findBrowser, launch, freePort, stopServer, bootSeeded, Tab, sleep } from './shots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const say = (...a) => console.log('check-module-load:', ...a);
const failures = [];
const expect = (ok, text) => { if (!ok) failures.push(text); };

// What each surface must show: a word or two of its own, found in the text on screen (heading, tab, button, empty sentence).
// At 1280 the Calendar is a month with its panels; at 390 it is one day's hours (the To-do panel is not on that screen).
const CALENDAR = /(Sun Mon Tue Wed Thu Fri Sat.*Weekly planning call|All day 12:00 AM.*11:00 PM)/;
const TODO_IN_CALENDAR = /(Book the Sintra train|All day 12:00 AM.*11:00 PM)/;
const EXPECT = {
  assistant: {}, // no surface: nothing to open (see the check below)
  budget: { canvas: /Add a cost.*(Spent|Overview)/ },
  calendar: { page: CALENDAR, canvas: CALENDAR, widget: /Coming up.*October 2026/ },
  documents: { canvas: /Search documents.*No documents yet/ },
  goals: { canvas: /No goals yet/ }, // not in the Travel template: opened in a space on the Default template
  maps: { page: /Add a place.*(No map yet|Places)/, canvas: /Add a place.*Filter places/ },
  polls: { page: /New poll.*Where do we eat on the first night/, canvas: /New poll.*Where do we eat on the first night/, widget: /Need your vote.*Where do we eat on the first night/ },
  research: { canvas: /Search research/ },
  schedule: { page: /works inside a/, canvas: /No plan yet.*Add a milestone/ }, // not in the Travel template: opened in a space on the Default template
  stream: { page: /Access key/ },
  todo: { page: TODO_IN_CALENDAR, canvas: TODO_IN_CALENDAR, widget: /Due soon.*Book the Sintra train/ }, // the page and the window are the Calendar's To-do panel while the Calendar is on
  travel: { page: /Itinerary works inside a/, canvas: /Add.*Days.*Bookings/ },
  vault: { canvas: /Add files.*Search files/ },
  whiteboard: { canvas: /Boards:.*Pen.*Eraser/ },
};
const LATE = 3500; // ms to keep watching after the expected text is on screen
const AREA = '#module-main, main'; // a module's window, or the destination page a part of it leads to
const failed = /could not start|went wrong|is not available/i; // what module.js and the host say when a module did not come up

// Everything a page and its frames do wrong from now on. `tab.sid` is the page's session; every frame that is a target of its own
// (a sandboxed frame runs in its own process) is attached to, held at its first line until it is listened to, and resumed.
function watch(tab) {
  const problems = [];
  const sessions = new Set([tab.sid]);
  const contexts = new Map(); // `${session}:${id}` -> { session, id, default }
  const listener = (m) => {
    if (m.method === 'Target.attachedToTarget' && sessions.has(m.sessionId)) {
      const sid = m.params.sessionId;
      sessions.add(sid);
      const s = (method, params) => tab.cdp.send(method, params, sid).catch(() => {});
      (async () => {
        await s('Runtime.enable'); await s('Network.enable');
        await s('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
        await s('Runtime.runIfWaitingForDebugger');
      })();
      return;
    }
    if (!sessions.has(m.sessionId)) return;
    const k = (id) => `${m.sessionId}:${id}`;
    if (m.method === 'Runtime.executionContextCreated') { const c = m.params.context; contexts.set(k(c.id), { session: m.sessionId, id: c.id, isDefault: Boolean(c.auxData?.isDefault) }); }
    if (m.method === 'Runtime.executionContextDestroyed') contexts.delete(k(m.params.executionContextId));
    if (m.method === 'Runtime.executionContextsCleared') for (const key of [...contexts.keys()]) if (key.startsWith(m.sessionId + ':')) contexts.delete(key);
    if (m.method === 'Runtime.exceptionThrown') problems.push('uncaught: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') problems.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    if (m.method === 'Network.responseReceived') {
      const { url, status } = m.params.response;
      let p = ''; try { p = new URL(url).pathname; } catch { /* not a url */ }
      // Two answers are asked for on purpose and are a plain 404: whether a part of a composite has a destination for this space
      // (module.js), and whether the Planner's keys were moved (the Planner's own start). Nothing else is let through.
      const asked = status === 404 && (p === '/api/destinations/map' || p === '/api/modules/travel/data/_moved:plan-keys' || p === '/api/modules/travel/data/_moved%3Aplan-keys');
      // A module's own files (/m/<id>/...) count too: a missing script or style is a failed load.
      if (status >= 400 && (p.startsWith('/api/') || p.startsWith('/m/')) && !asked) problems.push(`HTTP ${status} from ${p}`);
    }
  };
  tab.cdp.listeners.push(listener);
  return {
    problems,
    // The text on screen: the page (from `root`, if it is there) and every frame inside it, shadow roots included.
    async text(root) {
      const expr = `(() => { const top = window.top === window; const start = top && ${JSON.stringify(root)} ? document.querySelector(${JSON.stringify(root)}) : document.body; if (!start) return ''; const out = []; const walk = (n) => { if (n.nodeType === 3) { out.push(n.nodeValue); return; } if (n.nodeType !== 1 && n.nodeType !== 11) return; if (n.nodeType === 1 && /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(n.tagName)) return; if (n.nodeType === 1 && n.getAttribute('aria-label')) out.push(n.getAttribute('aria-label')); if (n.nodeType === 1 && n.hidden) return; if (n.shadowRoot) walk(n.shadowRoot); for (const c of n.childNodes) walk(c); }; walk(start); return out.join(' ').replace(/\\s+/g, ' ').trim(); })()`;
      const parts = [];
      for (const c of [...contexts.values()]) {
        if (!c.isDefault) continue;
        const r = await tab.cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, contextId: c.id }, c.session).catch(() => null);
        if (r?.result?.value) parts.push(r.result.value);
      }
      return parts.join(' | ');
    },
    stop: () => { tab.cdp.listeners = tab.cdp.listeners.filter((f) => f !== listener); },
  };
}

async function main() {
  const bin = findBrowser();
  if (!bin) { say('SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); return 0; }
  const bundled = fs.readdirSync(path.join(ROOT, 'modules'), { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(ROOT, 'modules', d.name, 'module.json')))
    .map((d) => JSON.parse(fs.readFileSync(path.join(ROOT, 'modules', d.name, 'module.json'), 'utf8')));
  for (const m of bundled) expect(m.id in EXPECT, `modules/${m.id} has no line in EXPECT (tools/check-module-load.mjs): say what its surfaces show`);

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'module-load-data-'));
  let server = null; let browser = null;
  try {
    const boot = await bootSeeded('travel', dataDir, await freePort());
    server = boot.server;
    const S = { base: server.base, ctx: boot.ctx, cookies: boot.cookies };
    const cookie = S.cookies.admin.map((c) => `${c.name}=${c.value}`).join('; ');
    const api = async (method, url, body) => {
      const r = await fetch(S.base + url, { method, headers: { cookie, 'content-type': 'application/json', origin: S.base }, body: body === undefined ? undefined : JSON.stringify(body) });
      let json = null; try { json = await r.json(); } catch { /* none */ }
      return { status: r.status, json };
    };
    // No company and no key, so nothing asks anybody outside (there is no network here).
    await api('PUT', '/api/ai', { provider: 'none', model: '', clearKey: true, source: 'custom', monthlyTokens: 0 });

    // Every bundled module installed and enabled (the seed did most of them; "already installed" is fine).
    for (const m of bundled) {
      const had = await api('POST', `/api/modules/bundled/${m.id}/install`);
      expect(had.status < 300 || /already installed/.test(JSON.stringify(had.json)), `installing ${m.id} answered ${had.status}: ${JSON.stringify(had.json)}`);
      const on = await api('PATCH', `/api/modules/${m.id}`, { enabled: true });
      expect(on.status < 300, `enabling ${m.id} answered ${on.status}: ${JSON.stringify(on.json)}`);
    }
    const installed = (await api('GET', '/api/modules')).json?.modules || [];
    for (const m of bundled) expect(installed.some((x) => x.id === m.id && x.enabled !== false), `${m.id} is not installed and enabled`);
    const nav = (await api('GET', '/api/modules/nav')).json?.modules || [];
    const forSpace = (await api('GET', `/api/modules/for-space?space=${S.ctx.trip}`)).json?.modules || [];
    // The seeded trip is on the Travel template: every module that template lists must be on there, as before. Only a module the
    // Travel template does not list (templates/travel.json) is opened in a space on the Default template, which lists every module
    // (plan-templates-redesign.md decision 33), so it too opens in a space whose template lists it.
    const travelListed = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'travel.json'), 'utf8')).modules || {}));
    const made = await api('POST', '/api/spaces', { name: 'Every module', template: 'default' });
    expect(made.status < 300 && made.json?.space?.id, `making a space on the Default template answered ${made.status}: ${JSON.stringify(made.json)}`);
    const everySpace = made.json?.space?.id || S.ctx.trip;
    const forEvery = (await api('GET', `/api/modules/for-space?space=${everySpace}`)).json?.modules || [];
    const spaceOf = {};
    const tiles = (await api('GET', '/api/modules/widgets')).json?.widgets || [];

    // What each module's manifest says it has, against what the server lists for it.
    const plan = [];
    for (const m of bundled) {
      const s = m.surfaces || {};
      const at = { id: m.id, name: m.name, page: false, canvas: false, widget: false };
      if (s.page && (m.scope || ['environment']).includes('environment') && nav.some((x) => x.id === m.id)) at.page = true;
      if (s.canvas) {
        at.canvas = true;
        if (travelListed.has(m.id)) {
          spaceOf[m.id] = S.ctx.trip;
          expect(forSpace.some((x) => x.id === m.id), `${m.id} declares a canvas and the Travel template lists it, but the trip's list has none for it`);
        } else {
          spaceOf[m.id] = everySpace;
          expect(forEvery.some((x) => x.id === m.id), `${m.id} declares a canvas but the Default template space's list has none for it`);
        }
      }
      if (s.widget) { at.widget = true; expect(tiles.some((x) => x.id === m.id), `${m.id} declares a widget but the home page's list has none for it`); }
      const none = !s.page && !s.canvas && !s.widget && !s.destination && !s.keyed;
      at.none = none;
      plan.push(at);
    }

    // The module with no surface: nowhere in the lists the pages are drawn from.
    for (const at of plan.filter((p) => p.none)) {
      expect(!nav.some((x) => x.id === at.id), `${at.id} has no surface but is in the page list`);
      expect(!forSpace.some((x) => x.id === at.id), `${at.id} has no surface but is in the space's list`);
      expect(!tiles.some((x) => x.id === at.id), `${at.id} has no surface but has a tile on the home page`);
    }

    browser = await launch(bin);
    const open = async (size) => {
      const tab = new Tab(browser.cdp, S.ctx);
      await tab.open(size, 'dark', false);
      await tab.cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, tab.sid);
      for (const c of S.cookies.admin) await tab.cdp.send('Network.setCookie', { name: c.name, value: c.value, url: S.base, httpOnly: true }, tab.sid);
      return tab;
    };
    // One address opened in a tab of its own, watched from before it starts; waits for `want` in the text of `root`.
    const visit = async (size, label, url, root, want, missing = false) => {
      const tab = await open(size);
      const w = watch(tab);
      const t0 = Date.now();
      try {
        await tab.cdp.send('Page.navigate', { url: S.base + url }, tab.sid);
        let text = '';
        const end = Date.now() + 15000;
        while (Date.now() < end) { await sleep(300); text = await w.text(root); if (want.test(text) && (missing || !failed.test(text))) break; }
        await sleep(LATE); // a late error, a late request
        text = await w.text(root);
        if (process.env.MODULE_LOAD_DUMP) say(`  [${size}] ${label}: ${text.slice(0, 160)}`);

        expect(want.test(text), `${size}, ${label}: nothing of its own on screen (wanted ${want}; saw "${text.slice(0, 160)}")`);
        expect(missing || !failed.test(text), `${size}, ${label}: the page says it failed ("${text.slice(0, 160)}")`);
        for (const p of new Set(w.problems)) expect(false, `${size}, ${label}: ${p}`);
        say(`${size}: ${label} ${w.problems.length ? 'PROBLEM' : 'loads'} (${Date.now() - t0} ms)`);
        return text;
      } finally { w.stop(); await tab.close(); }
    };

    for (const size of process.env.MODULE_LOAD_SIZE ? [Number(process.env.MODULE_LOAD_SIZE)] : [1280, 390]) {
      for (const at of plan) {
        const want = EXPECT[at.id];
        if (at.none) {
          // Nothing to open: its own address answers that it is not there, with no error, and the home page has no tile of it.
          await visit(size, `/modules/${at.id} (no surface)`, `/modules/${at.id}`, '#module-main', /not available/i, true);
          await visit(size, `/modules/${at.id}?space (no surface)`, `/modules/${at.id}?space=${S.ctx.trip}&popout=1`, '#module-main', /not available/i, true);
          continue;
        }
        if (!want) continue; // already failed above, by name
        for (const kind of ['page', 'canvas', 'widget']) if (at[kind]) expect(want[kind] instanceof RegExp, `${at.id} has a ${kind} but EXPECT has no regex for it (tools/check-module-load.mjs)`);
        if (at.page && want.page) await visit(size, `${at.id} page`, `/modules/${at.id}`, AREA, want.page);
        if (at.canvas && want.canvas) await visit(size, `${at.id} canvas`, `/modules/${at.id}?space=${spaceOf[at.id]}&popout=1`, AREA, want.canvas);
      }
      // The widgets: the home page, once, each tile by itself.
      const tab = await open(size);
      const w = watch(tab);
      try {
        await tab.cdp.send('Page.navigate', { url: S.base + '/' }, tab.sid);
        for (const at of plan.filter((p) => p.widget)) {
          const want = EXPECT[at.id]?.widget;
          if (!want) { expect(false, `${at.id} has a widget but EXPECT has no regex for it (tools/check-module-load.mjs)`); continue; }
          const root = `#dashboard [data-widget="${at.id}"]`;
          let text = '';
          const end = Date.now() + 15000;
          while (Date.now() < end) { await sleep(300); text = await w.text(root); if (want.test(text)) break; }
          if (process.env.MODULE_LOAD_DUMP) say(`  [${size}] ${at.id} widget: ${text.slice(0, 160)}`);
          expect(want.test(text), `${size}, ${at.id} widget: nothing of its own on screen (wanted ${want}; saw "${text.slice(0, 160)}")`);
        }
        await sleep(LATE); // after the last tile matched: a late error in any of them
        for (const at of plan.filter((p) => p.none)) {
          const there = await tab.eval(`!!document.querySelector('[data-widget="${at.id}"], [data-module="${at.id}"]')`);
          expect(!there, `${size}, the home page shows ${at.id}, which has no surface`);
        }
        for (const p of new Set(w.problems)) expect(false, `${size}, home (the widgets): ${p}`);
        say(`${size}: home with ${plan.filter((p) => p.widget).length} widgets ${w.problems.length ? 'PROBLEM' : 'loads'}`);
      } finally { w.stop(); await tab.close(); }
    }
  } finally {
    if (browser) { browser.cdp.ws.close(); await stopBrowser(browser.child, browser.dir); }
    if (server) await stopServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  if (failures.length) { for (const f of [...new Set(failures)].filter(Boolean)) console.error('check-module-load: FAIL ' + f); return 1; }
  say('OK');
  return 0;
}

main().then((c) => process.exit(c), (err) => { console.error(err); process.exit(1); });
