#!/usr/bin/env node
/*
 * check-strip-weather.mjs -- the story strip's weather chip (documentation/plans/plan-weather-users.md, step 2), in a real
 * browser against a throwaway seeded server: the Weather module on with the test stand-in service (WEATHER_TEST_STANDIN),
 * its terms accepted by the admin, and a place for the space (the Itinerary's main text found through a stand-in place
 * search), as tools/check-weather.mjs sets it up. No LiveKit. Covers:
 *   - the chip on the strip ("12° Lisbon" for today, "Fri 12° Lisbon" for a later day), drawn from the SDK's own look
 *     (window.hostWeather is host.ui.dayWeather's WEATHER_LOOK and dayWeatherFacts, not a copy);
 *   - a press opens the shared menu: the day, the words, the high and low, the chance of rain, the credit, Open Itinerary;
 *   - it is a fact like the others: counted in the three, and the first to give way when the line is crowded;
 *   - 760px and below and 390: no chip in the bar, one row in the phase sheet, the same menu from it;
 *   - weather off, no terms accepted, no place, a refused or failed ask (429, 502): nothing drawn and no word about it;
 *   - one ask when the space loads and none on later focus or reads (it is not polled), and only the space's own route;
 *   - 1280 and 390, light and dark; no horizontal overflow.
 * With no Chromium it says SKIPPED (set CHROME_PATH); that is not a pass. Set SHOTS_DIR to keep the screenshots.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';

const { bootSeeded, stopServer, freePort, findBrowser, launch, Tab, sleep } = await import('./shots.mjs');

const bin = findBrowser();
if (!bin) {
  console.log('check-strip-weather: SKIPPED. No Chromium found (set CHROME_PATH, or install one: npx playwright install chromium). This is not a pass; nothing was measured.');
  process.exit(0);
}

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};
const shotsDir = process.env.SHOTS_DIR || '';
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });
const keep = async (tab, name) => { if (shotsDir) fs.writeFileSync(path.join(shotsDir, `${name}.png`), await tab.shoot()); };

// The stand-ins: the weather service (every day asked is rain, 12.4 over 5.2, 40 percent) and a Photon-shaped place search.
const wxSeen = [];
const geoSeen = [];
const listen = async (fn) => { const s = http.createServer(fn); await new Promise((r) => s.listen(0, '127.0.0.1', r)); return s; };
const wx = await listen((req, res) => {
  wxSeen.push(req.url);
  const q = new URL(req.url, 'http://x').searchParams;
  const days = [];
  for (let t = Date.parse(`${q.get('from')}T00:00:00Z`); t <= Date.parse(`${q.get('to')}T00:00:00Z`); t += 86400000) days.push({ day: new Date(t).toISOString().slice(0, 10), code: 'rain', high: 12.4, low: 5.2, rain: 40 });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ days }));
});
const geo = await listen((req, res) => {
  geoSeen.push(req.url);
  const q = new URL(req.url, 'http://x').searchParams.get('q') || '';
  const features = /lisbon/i.test(q) ? [{ geometry: { type: 'Point', coordinates: [-9.139337, 38.722252] }, properties: { name: 'Lisbon', country: 'Portugal', osm_type: 'R', osm_id: 5400890 } }] : [];
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ features }));
});
const lk = await listen((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"participants":[]}'); }); });
const port80 = (s) => s.address().port;

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-strip-weather-'));
let server;
let browser;
const tabs = [];
try {
  const boot = await bootSeeded('travel', dataDir, await freePort(), { env: { WEATHER_TEST_STANDIN: `http://127.0.0.1:${port80(wx)}/v1/forecast`, LIVEKIT_API_URL: `http://127.0.0.1:${port80(lk)}` } });
  server = boot.server;
  const { ctx, cookies } = boot;
  const jar = (as) => cookies[as].map((c) => `${c.name}=${c.value}`).join('; ');
  const api = async (method, url, body, as = 'admin') => {
    const r = await fetch(server.base + url, { method, headers: { 'content-type': 'application/json', cookie: jar(as) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch { /* none */ }
    return { status: r.status, json };
  };
  const must = async (what, p, status = 200) => { const r = await p; assert.equal(r.status, status, `${what}: ${r.status} ${JSON.stringify(r.json)}`); return r; };
  for (const id of ['maps', 'travel', 'weather', 'todo', 'polls']) {
    const had = await api('POST', `/api/modules/bundled/${id}/install`, {});
    assert.ok(had.status < 300 || /already installed/.test(JSON.stringify(had.json)), `${id} installs: ${JSON.stringify(had.json)}`);
    await must(`${id} on`, api('PATCH', `/api/modules/${id}`, { enabled: true, allSpaces: true }));
  }
  await must('the place search', api('PUT', '/api/modules/maps/settings/environment', { values: { searchProvider: 'custom', search: `http://127.0.0.1:${port80(geo)}/api` } }));
  const putTrip = (value) => must('the trip', api('PUT', `/api/modules/travel/data/${encodeURIComponent('trip:main')}?scope=space&space=${ctx.trip}`, { value }));
  const day = (k) => new Date(Date.parse('2026-10-15T00:00:00Z') + k * 86400000).toISOString().slice(0, 10); // the throwaway clock's day (tools/shots.mjs)
  const trip = (o) => putTrip({ title: 'Lisbon in autumn', destination: 'Lisbon', start: day(2), end: day(9), notes: '', currency: 'EUR', by: '', v: 2, ...o });
  const setService = (service) => must('the service', api('PUT', '/api/modules/weather/settings/environment', { values: { service } }));
  await setService('standin');
  await must('terms', api('PUT', '/api/weather/terms/standin', { accept: true }));
  await trip({});
  const route = (await must('the space route', api('GET', `/api/spaces/${ctx.trip}/weather`))).json;
  assert.equal(route.configured, true, JSON.stringify(route));
  assert.deepEqual(route.place, { module: 'travel', name: 'Lisbon' });
  assert.equal(route.day, day(10), "before the main phase, its first day");
  const fact = (id, text, icon = 'circle-info') => ({ id, icon, text });
  const report = (module, facts) => (facts.length ? must(`${module} reports`, api('PUT', `/api/spaces/${ctx.trip}/facts/${module}`, { facts })) : api('DELETE', `/api/spaces/${ctx.trip}/facts/${module}`));

  browser = await launch(bin);
  // The page's own fetch of the weather route is counted, and a test may make it fail (window.__wx.mode: '429', '502', 'drop').
  // `credit` is added to the answer, since the stand-in service has none to show.
  const WRAP = `(() => { const f = window.fetch; window.__wx = { calls: 0, mode: '', credit: 'Weather: a stand-in service, for tests only.' };
    window.fetch = function (input, init) { const url = String((input && input.url) || input);
      if (!/\\/api\\/spaces\\/[^/]+\\/weather(\\?|$)/.test(url)) return f.apply(this, arguments);
      window.__wx.calls += 1;
      if (window.__wx.mode === 'drop') return Promise.reject(new TypeError('offline'));
      if (/^\\d+$/.test(window.__wx.mode)) return Promise.resolve(new Response('{"error":"No."}', { status: Number(window.__wx.mode), headers: { 'content-type': 'application/json' } }));
      return f.apply(this, arguments).then(async (r) => { const j = await r.clone().json().catch(() => null); if (!j || !j.configured) return r; j.credit = window.__wx.credit; return new Response(JSON.stringify(j), { status: r.status, headers: { 'content-type': 'application/json' } }); }); }; })()`;
  const open = async (width, mode = 'light', { before = '' } = {}) => {
    const tab = new Tab(browser.cdp, ctx);
    await tab.open(width, mode);
    tabs.push(tab);
    for (const c of cookies.admin) await tab.cdp.send('Network.setCookie', { name: c.name, value: c.value, url: server.base, httpOnly: true }, tab.sid);
    await tab.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `${WRAP};${before}` }, tab.sid);
    await tab.cdp.send('Page.navigate', { url: `${server.base}/#join=${ctx.trip}` }, tab.sid);
    await tab.waitFor('body.in-space');
    await sleep(1500);
    return tab;
  };
  // The Itinerary reports its next journey as a fact when its page is open: open the space once, so what the seed reports is kept.
  await (await open(1280)).close();
  const others = (await must('the facts', api('GET', `/api/spaces/${ctx.trip}/facts`))).json.modules.reduce((k, m) => k + m.facts.length, 0);
  assert.ok(others >= 1 && others <= 2, `the seed reports ${others} facts`);
  const mainPhase = (span) => async () => {
    const main = (await (await fetch(`${server.base}/api/branding`)).json()).phases.find((p) => p.main).id;
    const was = (await must('the space', api('GET', `/api/spaces/${ctx.trip}`))).json.space.phases;
    await must('the main phase', api('PATCH', `/api/spaces/${ctx.trip}`, { phases: { ...was, [main]: span } }));
    return () => must('the phases again', api('PATCH', `/api/spaces/${ctx.trip}`, { phases: was }));
  };
  const resize = async (tab, width) => { await tab.cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }, tab.sid); await sleep(500); };
  const chips = (tab) => tab.eval(`[...document.querySelectorAll('#status-strip .sdk-strip-fact')].map((e) => ({ text: e.textContent.trim(), weather: 'weather' in e.dataset, shown: !e.hidden && e.getClientRects().length > 0, icon: (e.querySelector('i') || {}).className || '' }))`);
  const overflow = (tab) => tab.eval('document.documentElement.scrollWidth > innerWidth + 1');
  const menuText = (tab) => tab.eval(`(document.querySelector('.host-menu') || { textContent: '' }).textContent.replace(/\\s+/g, ' ').trim()`);
  const strip = (tab) => tab.eval(`(document.getElementById('status-strip') || { textContent: '' }).textContent`);

  for (const mode of ['light', 'dark']) {
    await test(`1280 ${mode}: the chip, drawn from the SDK's own look, and its menu`, async () => {
      const tab = await open(1280, mode);
      assert.equal(await tab.eval('Boolean(window.hostWeather && window.hostWeather.look && window.hostWeather.facts)'), true, 'the SDK exposes its look');
      const list = (await chips(tab)).filter((c) => c.weather);
      assert.equal(list.length, 1, JSON.stringify(list));
      assert.equal(list[0].weather, true);
      assert.equal(list[0].shown, true);
      assert.match(list[0].text, /^\w{3} 12° Lisbon$/, 'a later day names its weekday');
      assert.match(list[0].icon, /fa-cloud-showers-heavy/, 'the SDK look for rain');
      assert.equal(await tab.eval('window.__wx.calls'), 1, 'asked once when the space loaded');
      assert.equal(await overflow(tab), false);
      await keep(tab, `chip-1280-${mode}`);
      await tab.click('#status-strip .sdk-strip-fact[data-weather]');
      await tab.waitFor('.host-menu');
      const text = await menuText(tab);
      assert.match(text, /^Forecast for (Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day \d+ \w+/, text);
      assert.match(text, /Rain · High 12°C, low 5°C/, text);
      assert.match(text, /40% chance of rain/, text);
      assert.match(text, /Weather: a stand-in service, for tests only\./, 'the credit');
      assert.match(text, /Open Itinerary/, text);
      await keep(tab, `menu-1280-${mode}`);
      await tab.key('Escape');
      await sleep(300);
      assert.equal(await tab.eval(`document.activeElement && document.activeElement.dataset && 'weather' in document.activeElement.dataset`), true, 'the keyboard goes back to the chip');
      // Later reads (focus, visibility, the facts) do not ask again inside 30 minutes.
      await tab.eval(`(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); return 1; })()`);
      await sleep(1200);
      assert.equal(await tab.eval('window.__wx.calls'), 1, 'not asked again: the route is not polled');
      assert.equal(await tab.eval(`document.querySelector('#status-strip .sdk-strip-fact[data-weather]').getAttribute('aria-live')`), null, 'not in a live region');
      await tab.close();
    });
  }

  await test('today: no weekday', async () => {
    const main = (await (await fetch(`${server.base}/api/branding`)).json()).phases.find((p) => p.main).id;
    const was = (await must('the space', api('GET', `/api/spaces/${ctx.trip}`))).json.space.phases;
    await must('the main phase under way', api('PATCH', `/api/spaces/${ctx.trip}`, { phases: { ...was, [main]: { start: day(-1), end: day(6) } } }));
    const tab = await open(1280);
    const list = (await chips(tab)).filter((c) => c.weather);
    assert.equal(list.length, 1, JSON.stringify(list));
    assert.equal(list[0].text, '12° Lisbon');
    await tab.close();
    await must('the phases again', api('PATCH', `/api/spaces/${ctx.trip}`, { phases: was }));
  });

  await test('only the space route is asked, and what leaves is a rounded position and days', async () => {
    assert.ok(wxSeen.length > 0, 'the stand-in service was asked');
    for (const u of wxSeen) {
      const q = Object.keys(Object.fromEntries(new URL(u, 'http://x').searchParams)).sort().join(',');
      assert.equal(q, 'from,lat,lon,to', u);
      assert.ok(!u.includes(ctx.trip), 'not the space');
    }
    for (const u of geoSeen) assert.equal(Object.keys(Object.fromEntries(new URL(u, 'http://x').searchParams)).sort().join(','), 'limit,q', u);
  });

  await test('the third place: counted in the three, and the first to give way', async () => {
    const more = (k) => Array.from({ length: k }, (_, i) => fact(`f${i}`, `${i + 2} open`, 'list-check'));
    await report('todo', more(3 - others)); // the modules' facts fill the three: the weather is the fourth and is left out
    const tab = await open(1280);
    let list = await chips(tab);
    assert.equal(list.length, 3, JSON.stringify(list));
    assert.ok(list.every((c) => !c.weather), `three, the weather left out: ${JSON.stringify(list)}`);
    await tab.close();
    await report('todo', more(2 - others));
    const again = await open(1280);
    list = await chips(again);
    assert.deepEqual(list.map((c) => c.weather), [...Array(2).fill(false), true], `the weather after the modules' facts: ${JSON.stringify(list)}`);
    assert.ok(list.every((c) => c.shown));
    // Narrowing the line: whatever is hidden is hidden from the end, so the weather goes first, before any module's fact.
    let sawWeatherGone = false;
    for (let w = 1280; w >= 780; w -= 10) {
      await resize(again, w);
      const now = await chips(again);
      const hidden = now.map((c) => !c.shown);
      for (let i = 1; i < hidden.length; i += 1) assert.ok(!(hidden[i - 1] && !hidden[i]), `at ${w}: a chip gave way before the one after it: ${JSON.stringify(now)}`);
      if (hidden[2] && !hidden[0] && !hidden[1]) sawWeatherGone = true;
    }
    assert.equal(sawWeatherGone, true, 'there is a width where only the weather has given way');
    await again.close();
    await report('todo', []);
  });

  for (const mode of ['light', 'dark']) {
    await test(`390 ${mode}: no chip in the bar, one row in the phase sheet, the same menu from it`, async () => {
      const tab = await open(390, mode);
      const list = await chips(tab);
      assert.ok(list.every((c) => !c.shown), `no chip in the bar: ${JSON.stringify(list)}`);
      assert.equal(await overflow(tab), false);
      await tab.click('#phase-chip');
      await tab.waitFor('.phase-sheet-fact');
      const row = await tab.eval(`[...document.querySelectorAll('.phase-sheet-fact')].map((e) => e.textContent.replace(/\\s+/g, ' ').trim())`);
      const mine = row.filter((r) => /Weather$/.test(r));
      assert.equal(mine.length, 1, JSON.stringify(row));
      assert.match(mine[0], /^\w{3} 12° Lisbon · Rain/, mine[0]);
      await keep(tab, `sheet-390-${mode}`);
      await tab.click('.phase-sheet-fact', '° Lisbon');
      await sleep(600);
      if (process.env.DEBUG_WX) console.error(await tab.eval(`JSON.stringify({ menu: !!document.querySelector('.host-menu'), dlg: !!document.querySelector('dialog[open]'), chip: (() => { const r = document.getElementById('phase-chip').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })() })`));
      await tab.waitFor('.host-menu');
      const text = await menuText(tab);
      assert.match(text, /^Forecast for /, text);
      assert.match(text, /Weather: a stand-in service/, text);
      assert.equal(await overflow(tab), false);
      await keep(tab, `menu-390-${mode}`);
      await tab.close();
    });
  }

  await test('a refused or failed ask draws nothing, and says nothing', async () => {
    for (const mode of ['429', '502', 'drop']) {
      const tab = await open(1280, 'light', { before: `window.__wx.mode = ${JSON.stringify(mode)};` });
      assert.deepEqual((await chips(tab)).filter((c) => c.weather), [], mode);
      assert.doesNotMatch(await strip(tab), /weather|forecast|unavailable|error/i, `${mode}: no word about it`);
      assert.equal(await tab.eval('window.__wx.calls'), 1, `${mode}: asked once, not again at once`);
      await tab.eval(`(() => { window.dispatchEvent(new Event('focus')); return 1; })()`);
      await sleep(1000);
      assert.equal(await tab.eval('window.__wx.calls'), 1, `${mode}: it waits a minute before it asks again`);
      await tab.close();
    }
  });

  let restore = null;
  for (const [name, off, on] of [
    ['weather off', () => must('off', api('PATCH', '/api/modules/weather', { enabled: false })), () => must('on', api('PATCH', '/api/modules/weather', { enabled: true }))],
    ['no service chosen', () => setService('none'), () => setService('standin')],
    ['terms not accepted', () => must('withdraw', api('DELETE', '/api/weather/terms/standin')), () => must('accept', api('PUT', '/api/weather/terms/standin', { accept: true }))],
    ['no place', () => trip({ destination: '' }), () => trip({})],
    ['a place nobody can find', () => trip({ destination: 'Atlantis' }), () => trip({})],
    ['the main phase is over', async () => { restore = await mainPhase({ start: day(-1), end: day(-1) })(); }, () => restore()],
  ]) {
    for (const width of [1280, 390]) {
      await test(`${name} at ${width}: nothing drawn, no hint`, async () => {
        await off();
        try {
          const tab = await open(width);
          assert.deepEqual((await chips(tab)).filter((c) => c.weather), [], 'no chip');
          if (width === 390) {
            await tab.click('#phase-chip');
            await tab.waitFor('.phase-sheet');
            assert.equal(await tab.eval(`[...document.querySelectorAll('.phase-sheet-fact')].filter((e) => /Weather$/.test(e.textContent.trim())).length`), 0, 'no row in the sheet');
            assert.doesNotMatch(await tab.eval(`document.querySelector('.phase-sheet').textContent`), /weather|forecast|°/i, 'no word about it');
          } else assert.doesNotMatch(await strip(tab), /weather|forecast/i, 'no word about it');
          await tab.close();
        } finally { await on(); }
      });
    }
  }
} catch (err) {
  failed += 1;
  console.error(`check-strip-weather: ${err.stack || err}`);
} finally {
  for (const t of tabs) await t.close().catch(() => {});
  if (browser) { try { browser.child.kill(); } catch { /* gone */ } }
  await stopServer(server);
  for (const s of [wx, geo, lk]) s.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
if (failed) { console.error(`check-strip-weather: ${failed} failed, ${n} passed`); process.exit(1); }
console.log(`check-strip-weather: ${n} checks passed`);
process.exit(0);
