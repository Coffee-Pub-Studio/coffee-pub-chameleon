#!/usr/bin/env node
/*
 * check-stream-lifecycle.mjs -- the pages' live streams and the browser's back-forward cache (GitHub #911), live in headless
 * Chromium against a throwaway server. Over HTTP/1.1 a browser holds six connections to one site; a page left by navigation
 * and kept in the back-forward cache must not keep its event streams, or the next page's own requests queue behind them.
 *
 * An init script wraps EventSource and records every open and close (and the page's pagehide and pageshow, first in line).
 * Chromium runs with BackForwardCache on. Asserted, for the admin page (the notifications stream) and for a space page
 * (that, the space's live stream and the modules' stream):
 *   - going to another page and back restores the first from the cache (pageshow persisted: true);
 *   - at that pageshow none of its streams is open (all closed at pagehide), and after it each is open again exactly once,
 *     the same count as the page's first load; at no time are more open than that count;
 *   - after six page hops in one tab, Manage > Users draws its list within 5 seconds.
 * Before the browser part, the same pieces run in Node against a stand-in EventSource and clock: the modules' hub
 * (createStreamHub) and the space's live stream (openLiveStream) suspend, resume, and cancel their timers. No page in the
 * browser part mounts a module, so the hub is judged by these cases only. A lint: every `new EventSource(` in public/ sits
 * in a file that also registers a `pagehide` handler.
 * Run it under the browser lock: flock /tmp/browser-checks.lock node tools/check-stream-lifecycle.mjs
 * With no Chromium it says SKIPPED (not a pass).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stopBrowser } from './browser-launch.mjs';
import { findBrowser, launch, freePort, startServer, stopServer, Tab, sleep } from './shots.mjs';
import { PASSWORD } from './shots-seed.mjs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const say = (...a) => console.log('check-stream-lifecycle:', ...a);
const failures = [];
const expect = (ok, text) => { if (!ok) failures.push(text); };

// Runs before the page's own scripts, in every document.
const INIT = `(() => {
  const log = (window.__es = { live: 0, max: 0, opened: 0, events: [], liveAtShow: null, persisted: null, opensAfterShow: 0 });
  const Real = window.EventSource;
  window.EventSource = class extends Real {
    constructor(url, opts) {
      super(url, opts);
      let open = true;
      log.live += 1; log.opened += 1; log.max = Math.max(log.max, log.live);
      if (log.persisted) log.opensAfterShow += 1;
      log.events.push('open ' + String(url).split('?')[0]);
      const close = this.close.bind(this);
      this.close = () => { if (open) { open = false; log.live -= 1; log.events.push('close ' + String(url).split('?')[0]); } close(); };
    }
  };
  addEventListener('pagehide', () => { log.events.push('pagehide'); });
  addEventListener('pageshow', (e) => { if (e.persisted) { log.persisted = true; log.liveAtShow = log.live; log.events.push('pageshow-persisted'); } });
})();`;

// A stand-in EventSource and clock.
function stand() {
  const sources = [];
  class FakeES {
    constructor(url) { this.url = url; this.closed = false; this.l = {}; this.readyState = 1; sources.push(this); }
    addEventListener(t, fn) { (this.l[t] ||= []).push(fn); }
    close() { this.closed = true; this.readyState = 2; }
    fire(t, data) { for (const fn of this.l[t] || []) fn({ data: data === undefined ? '' : JSON.stringify(data), lastEventId: '' }); }
  }
  const timers = new Map(); let n = 0;
  const schedule = (fn, ms) => { n += 1; timers.set(n, fn); return n; };
  const cancel = (t) => { timers.delete(t); };
  const run = () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } };
  return { sources, FakeES, schedule, cancel, run, timers, open: () => sources.filter((x) => !x.closed) };
}

async function units() {
  const { createStreamHub } = await import(pathToFileURL(path.join(root, 'public', 'module-stream.js')).href);
  const { openLiveStream } = await import(pathToFileURL(path.join(root, 'public', 'space-live.js')).href);
  // The hub.
  {
    const t = stand();
    const hub = createStreamHub({ EventSourceImpl: t.FakeES, schedule: t.schedule, cancel: t.cancel });
    const heard = [];
    hub.join('sp1', null, (type) => heard.push(type));
    t.run();
    expect(hub.connections().length === 1, `hub: a join opens one connection (${hub.connections().length})`);
    const es = t.open()[0];
    es.fire('open'); es.fire('ready', { stream: 'st1' });
    hub.suspend();
    expect(hub.connections().length === 0 && t.open().length === 0, 'hub: suspend closes every connection');
    expect(!heard.includes('lost'), 'hub: no `lost` is sent at suspend (a module\'s own pagehide still needs its stream id)');
    hub.join('sp2', null, () => {});
    t.run();
    expect(t.open().length === 0, 'hub: a join while suspended opens nothing');
    hub.resume();
    expect(heard.filter((x) => x === 'lost').length === 1, `hub: resume sends \`lost\` once to the space that had a ready (${heard.filter((x) => x === 'lost').length})`);
    t.run();
    expect(t.open().length === hub.connections().length && t.open().length >= 1, `hub: resume reopens (${t.open().length} open)`);
    const after = t.sources.length;
    hub.resume(); t.run();
    expect(t.sources.length === after && heard.filter((x) => x === 'lost').length === 1, 'hub: a second resume does nothing');
  }
  // The live stream.
  {
    const t = stand();
    const s = openLiveStream({ url: '/x', EventSourceImpl: t.FakeES, schedule: t.schedule, cancel: t.cancel, probe: async () => 0 });
    expect(t.open().length === 1, 'live: opens one source');
    s.suspend();
    expect(t.open().length === 0, 'live: suspend closes it');
    s.resume();
    expect(t.open().length === 1, 'live: resume opens one');
    s.resume();
    expect(t.open().length === 1, 'live: a second resume does nothing');
    // A pending retry is cancelled by suspend.
    t.open()[0].fire('error');
    await sleep(5);
    expect(t.timers.size === 1, `live: a drop schedules one retry (${t.timers.size})`);
    s.suspend();
    expect(t.timers.size === 0, 'live: suspend cancels a pending retry');
    s.close();
    s.resume();
    expect(t.open().length === 0, 'live: resume after close opens nothing');
  }
  // A probe in flight across suspend and resume must not open a second source.
  {
    const t = stand();
    let answer;
    const s = openLiveStream({ url: '/x', EventSourceImpl: t.FakeES, schedule: t.schedule, cancel: t.cancel, probe: () => new Promise((r) => { answer = r; }) });
    t.open()[0].fire('error'); // never opened: the probe is asked
    await sleep(5);
    s.suspend(); s.resume();
    answer(0); await sleep(5);
    t.run();
    expect(t.open().length === 1, `live: a probe answered after suspend and resume leaves ${t.open().length} source(s) open, expected 1 (${t.sources.length} made)`);
    s.close();
  }
  // Lint: a file that opens an EventSource also closes it as the page goes.
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'lib' || e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
  for (const f of walk(path.join(root, 'public'))) {
    const src = fs.readFileSync(f, 'utf8');
    if (/new EventSource\(/.test(src) && !/['"]pagehide['"]/.test(src)) failures.push(`lint: ${path.relative(root, f)} opens an EventSource and has no pagehide handler`);
  }
}

async function main() {
  await units();
  const real = findBrowser();
  if (!real) { say('SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); return 0; }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-life-data-'));
  // The same browser with the back-forward cache on (headless builds differ in their default).
  const wrapDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stream-life-bin-'));
  const wrapper = path.join(wrapDir, 'chrome');
  fs.writeFileSync(wrapper, `#!/bin/sh\nexec "${real}" --enable-features=BackForwardCache --disable-features=BackForwardCacheMemoryControls "$@"\n`, { mode: 0o755 });
  let server = null; let browser = null;
  try {
    server = await startServer(dataDir, await freePort(), 'first');
    const call = async (cookies, method, url, body) => {
      const headers = { 'content-type': 'application/json', accept: 'application/json', origin: server.base };
      if (cookies) headers.cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
      const res = await fetch(server.base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      let json = null; try { json = await res.json(); } catch { /* none */ }
      return { status: res.status, json, res };
    };
    const login = await call(null, 'POST', '/api/login', { login: 'admin', password: PASSWORD });
    expect(login.status === 200, `cannot sign in: ${login.status}`);
    const jar = login.res.headers.getSetCookie().map((c) => { const [nv] = c.split(';'); const i = nv.indexOf('='); return { name: nv.slice(0, i), value: nv.slice(i + 1) }; });
    await call(jar, 'POST', '/api/users', { login: 'mia', displayName: 'Mia', role: 'member', password: PASSWORD });
    const made = await call(jar, 'POST', '/api/spaces', { name: 'Camp' });
    const spaceId = made.json?.space?.id;
    expect(Boolean(spaceId), `no space made: ${made.status}`);

    process.env.CHROME_PATH = wrapper;
    browser = await launch(wrapper);
    const tab = new Tab(browser.cdp, {});
    await tab.open(1280, 'light', false);
    for (const c of jar) await tab.cdp.send('Network.setCookie', { name: c.name, value: c.value, url: server.base, httpOnly: true }, tab.sid);
    await tab.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: INIT }, tab.sid);
    const problems = [];
    tab.cdp.listeners.push((m) => { if (m.sessionId === tab.sid && m.method === 'Runtime.exceptionThrown') problems.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
    const notUsed = [];
    tab.cdp.listeners.push((m) => { if (m.sessionId === tab.sid && m.method === 'Page.backForwardCacheNotUsed') notUsed.push(JSON.stringify(m.params.notRestoredExplanations?.map((x) => x.reason))); });
    const go = async (url) => { await tab.cdp.send('Page.navigate', { url: server.base + url }, tab.sid); await sleep(600); await tab.settle(); };
    const history = async (delta) => { await tab.eval(`history.go(${delta})`); await sleep(800); };
    const es = () => tab.eval(`window.__es ? JSON.parse(JSON.stringify(window.__es)) : null`);

    // One page and a page to go to and come back from.
    await go('/admin'); await go('/'); // a first visit settles the page's service worker (a claim keeps a page out of the cache)
    for (const [name, url, wait] of [['admin page', '/admin#users', '#users'], ['space page', `/#join=${spaceId}`, '#chat-note-item']]) {
      await go(url);
      await tab.waitFor(wait).catch(() => {});
      await sleep(2500); // the streams open once the page has drawn
      const first = await es();
      expect(first && first.live >= 1, `${name}: no stream open after load (${JSON.stringify(first)})`);
      const normal = first.live;
      say(`${name}: ${normal} stream(s) open on load: ${first.events.join(', ')}`);
      // Leaves it for another site (localhost, not 127.0.0.1): the browser swaps its process and keeps this page in the cache.
      await tab.cdp.send('Page.navigate', { url: server.base.replace('127.0.0.1', 'localhost') + '/login' }, tab.sid);
      await sleep(1500);
      await sleep(500);
      await history(-1);
      await sleep(3500);
      const back = await es();
      expect(back && back.persisted === true, `${name}: the page was not restored from the back-forward cache (persisted ${back && back.persisted}; browser says ${notUsed.join(' | ') || 'nothing'}); the check cannot judge it`);
      if (back && back.persisted) {
        expect(back.liveAtShow === 0, `${name}: ${back.liveAtShow} stream(s) still open when the cached page came back (not closed at pagehide)`);
        expect(back.live === normal, `${name}: ${back.live} stream(s) open after the cached page came back, expected ${normal}: ${back.events.join(', ')}`);
        expect(back.opensAfterShow === normal, `${name}: ${back.opensAfterShow} stream(s) opened after pageshow, expected exactly ${normal}`);
        expect(back.max <= normal, `${name}: at most ${back.max} streams were open at once, more than the normal ${normal}`);
      }
    }

    // Six page hops in this tab, then Manage > Users.
    const hops = ['/', '/profile.html', '/admin#environment', '/', '/admin#spaces', '/profile.html'];
    for (const h of hops) { await go(h); await sleep(300); }
    await tab.cdp.send('Page.navigate', { url: server.base + '/admin#users' }, tab.sid);
    const t0 = Date.now();
    let drawn = false;
    while (Date.now() - t0 < 5000) {
      if (await tab.eval(`document.querySelectorAll('#users > *').length >= 2`).catch(() => false)) { drawn = true; break; }
      await sleep(100);
    }
    expect(drawn, `Manage > Users did not draw its list within 5 seconds after six page hops`);
    say(`Manage > Users drawn after ${Date.now() - t0} ms`);
    expect(problems.length === 0, `uncaught: ${problems.join('; ')}`);
    await tab.close();
  } finally {
    if (browser) await stopBrowser(browser.child, browser.dir);
    if (server) await stopServer(server);
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(wrapDir, { recursive: true, force: true });
  }
  if (failures.length) { for (const f of failures) console.error('check-stream-lifecycle: FAIL ' + f); return 1; }
  say('ok');
  return 0;
}
main().then((c) => process.exit(c), (e) => { console.error('check-stream-lifecycle: ERROR ' + (e.stack || e)); process.exit(1); });
