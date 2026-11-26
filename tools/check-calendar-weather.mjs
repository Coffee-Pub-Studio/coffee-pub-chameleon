#!/usr/bin/env node
/*
 * check-calendar-weather.mjs -- the weather on the Calendar's days as a person meets it (plan-weather-users.md, step 4), in a
 * headless browser against a throwaway server whose weather service and place search are stand-ins on this machine (no network).
 * The Weather module is on with the stand-in service chosen and its terms accepted; the space's place is the Itinerary's destination.
 *   - a space's Calendar draws the weather (the SDK's day button, host.ui.dayWeather) in the week, day, month and agenda views;
 *   - the month draws the short form (the icon and the high; no low) and not at a narrow width, where the agenda carries it;
 *   - pressing a day's weather opens its menu and does not select the day or open the editor;
 *   - nothing is drawn with no place, with the Weather module off, or in the environment's own Calendar;
 *   - nothing sent to the weather service but a rounded position and days, and one ask per draw.
 *   - at 390 px nothing scrolls sideways.
 *   node tools/check-calendar-weather.mjs         (no Chromium: SKIPPED, exit 0; that is a skip, never a pass)
 * CALWX_SHOTS=<folder> keeps a picture of each view; CALWX_SIZES=1280,390 and CALWX_MODES=light,dark choose the cases.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { findBrowser, launch, freePort, stopServer, bootSeeded, Tab, sleep, driveScreen } from './shots.mjs';

const say = (...a) => console.log('check-calendar-weather:', ...a);
const failures = [];
const expect = (ok, text) => { if (!ok) { failures.push(text); say('FAIL', text); } };

const daysBetween = (a, b) => { const out = []; for (let t = Date.parse(`${a}T00:00:00Z`); t <= Date.parse(`${b}T00:00:00Z`); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10)); return out; };
const json = (body) => (req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

async function main() {
  const bin = findBrowser();
  if (!bin) { say('SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); return 0; }
  const wxSeen = [];
  const wx = http.createServer((req, res) => {
    wxSeen.push(req.url);
    const q = new URL(req.url, 'http://x').searchParams;
    const codes = ['clear', 'partly', 'cloudy', 'rain', 'drizzle', 'snow', 'fog', 'storm'];
    json({ days: daysBetween(q.get('from'), q.get('to')).map((day, i) => ({ day, code: codes[i % codes.length], high: 14 + (i % 6), low: 6 + (i % 4), rain: 10 * (i % 7) })) })(req, res);
  });
  const geo = http.createServer((req, res) => {
    const q = new URL(req.url, 'http://x').searchParams.get('q') || '';
    json({ features: /lisbon/i.test(q) ? [{ geometry: { type: 'Point', coordinates: [-9.139337, 38.722252] }, properties: { name: 'Lisbon', country: 'Portugal', osm_type: 'R', osm_id: 5400890 } }] : [] })(req, res);
  });
  for (const sv of [wx, geo]) await new Promise((r) => sv.listen(0, '127.0.0.1', r));
  const WX = `http://127.0.0.1:${wx.address().port}/v1/forecast`;
  const GEO = `http://127.0.0.1:${geo.address().port}/api`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calwx-live-'));
  const sizes = (process.env.CALWX_SIZES || '1280,390').split(',').map(Number);
  const modes = (process.env.CALWX_MODES || 'light,dark').split(',');
  const shots = process.env.CALWX_SHOTS || '';
  let server = null; let browser = null;
  try {
    const boot = await bootSeeded('travel', dataDir, await freePort(), { env: { WEATHER_TEST_STANDIN: WX } });
    server = boot.server;
    const S = { base: server.base, ctx: boot.ctx, cookies: boot.cookies };
    const admin = S.cookies.admin.map((c) => `${c.name}=${c.value}`).join('; ');
    const api = async (method, url, body) => {
      const r = await fetch(S.base + url, { method, headers: { cookie: admin, 'content-type': 'application/json', origin: S.base }, body: body === undefined ? undefined : JSON.stringify(body) });
      return r.status;
    };
    const setup = async (what, status) => expect((await what) === status, `setup: expected ${status}`);
    // The Weather module on, the stand-in chosen and its terms accepted; the place search is the stand-in; the trip's destination.
    await api('POST', '/api/modules/bundled/weather/install', {});
    await api('PATCH', '/api/modules/weather', { enabled: true });
    await setup(api('PUT', '/api/modules/weather/settings/environment', { values: { service: 'standin' } }), 200);
    await setup(api('PUT', '/api/weather/terms/standin', { accept: true }), 200);
    await setup(api('PUT', '/api/modules/maps/settings/environment', { values: { searchProvider: 'custom', search: GEO } }), 200);
    const trip = (destination) => api('PUT', `/api/modules/travel/data/${encodeURIComponent('trip:main')}?scope=space&space=${S.ctx.trip}`, { value: { title: 'Lisbon in autumn', destination, start: '2026-10-25', end: '2026-11-03', by: S.ctx.mia, v: 2 } });
    await setup(trip('Lisbon'), 200);

    browser = await launch(bin);
    const snap = async (tab, name) => { if (shots) fs.writeFileSync(path.join(shots, `calendar-weather-${name}.png`), await tab.shoot(false)); };

    const MAINR = '#dest-main .dest-part-root';
    const PANELR = '#dest-panel-calendar .dest-part-root';
    const view = (tab, id) => tab.eval(`(() => { const e = document.querySelector('[data-key="switch:dest-view:${id}"]'); if (!e) return false; e.click(); return true; })()`);
    const probeIn = (tab, root) => tab.eval(`(() => {
      const host = document.querySelector(${JSON.stringify(root)});
      const r = host && host.shadowRoot;
      if (!r) return null;
      const shown = (e) => Boolean(e.getClientRects().length);
      const all = [...r.querySelectorAll('.sdk-day-weather')].filter(shown);
      const slots = r.querySelectorAll('.cal-wx[data-wx]').length;
      const lows = all.filter((b) => { const l = b.querySelector('.sdk-day-weather-low'); return l && shown(l) && l.getBoundingClientRect().width > 2; }).length;
      const sel = r.querySelector('.sdk-cal-cell.is-selected');
      return { slots, buttons: all.length, lows, selected: sel ? sel.dataset.day : null, editor: Boolean(r.querySelector('dialog[open]')), open: all.filter((b) => b.getAttribute('aria-expanded') === 'true').length,
        heads: r.querySelectorAll('.group-head').length, headsWithWx: [...r.querySelectorAll('.group-head')].filter((g) => g.querySelector('.sdk-day-weather')).length,
        grid: r.querySelector('.sdk-cal-week') ? 'week' : r.querySelector('.sdk-cal-grid') ? 'month' : r.querySelector('.dayview') ? 'day' : 'other',
        sideways: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
    })()`);
    const until = async (fn, ok, ms = 9000) => { const end = Date.now() + ms; let p = null; while (Date.now() < end) { p = await fn(); if (p && ok(p)) return p; await sleep(250); } return p; };
    const openTab = async (size, mode, url, wait) => {
      const tab = new Tab(browser.cdp, S.ctx);
      await tab.open(size, mode, false);
      const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
      await driveScreen(tab, { as: 'admin', url, wait }, S.base, S.cookies, S.ctx);
      return tab;
    };
    const SPACE = '/calendar?space={trip}';
    const GRID = `${MAINR} >>> #body > *`; // the calendar's body, whichever view it opens on (a phone opens on the day)

    // 1. The views, in each size and mode.
    for (const size of sizes) for (const mode of modes) {
      const tag = `${size} ${mode}`;
      const phone = size <= 480;
      const tab = await openTab(size, mode, SPACE, GRID);
      try {
        expect(await view(tab, 'month'), `${tag}: the month view is switchable`);
        const month = await until(() => probeIn(tab, MAINR), (p) => p.grid === 'month' && (p.buttons > 0 || phone));
        if (phone) await sleep(2000);
        if (phone) expect((await probeIn(tab, MAINR)).buttons === 0, `${tag}: the month at phone width draws none (the cells are 7 dots wide; the agenda carries it): ${JSON.stringify(month)}`);
        else {
          expect(month.grid === 'month' && month.buttons >= 20, `${tag}: the month draws weather on its days: ${JSON.stringify(month)}`);
          expect(month.lows === 0, `${tag}: the month shows the short form (no low)`);
        }
        await snap(tab, `${size}-${mode}-month`);
        // A press on a day's weather opens its menu; it does not select the day or open an editor.
        if (!phone) {
          const before = await probeIn(tab, MAINR);
          await tab.eval(`(() => { const r = document.querySelector(${JSON.stringify(MAINR)}).shadowRoot; r.querySelector('.cal-wx .sdk-day-weather').click(); return 1; })()`);
          await sleep(400);
          const after = await probeIn(tab, MAINR);
          expect(after.open === 1, `${tag}: pressing a day's weather opens its menu`);
          expect(after.selected === before.selected && !after.editor, `${tag}: and does not select the day or open the editor`);
          await snap(tab, `${size}-${mode}-month-menu`);
          await tab.key('Escape');
        }
        // The Agenda (the panel's list): a heading has the weather beside it. At phone width the panel is behind its switch.
        if (!phone) {
          const a = await until(() => probeIn(tab, PANELR), (x) => x.headsWithWx > 0);
          expect(a && a.heads > 0 && a.headsWithWx > 0, `${tag}: the agenda's headings draw weather: ${JSON.stringify(a)}`);
        }
        for (const id of ['week', 'day']) {
          expect(await view(tab, id), `${tag}: the ${id} view is switchable`);
          const p = await until(() => probeIn(tab, MAINR), (x) => x.grid === id && x.buttons > 0);
          expect(p.grid === id && p.buttons >= (id === 'week' ? 7 : 1) && (phone ? p.lows === 0 : p.lows === p.buttons), `${tag}: the ${id} view draws weather (the high and the low; on a phone the SDK keeps the high and the icon): ${JSON.stringify(p)}`);
          if (phone) expect(!p.sideways, `${tag}: ${id}: nothing scrolls sideways`);
          await snap(tab, `${size}-${mode}-${id}`);
        }
        expect(wxSeen.length > 0 && wxSeen.every((u) => { const q = new URL(u, 'http://x').searchParams; return [...q.keys()].sort().join() === 'from,lat,lon,to' && q.get('lat') === '38.72' && q.get('lon') === '-9.14'; }), `${tag}: the service saw only a rounded position and days: ${wxSeen.slice(0, 2)}`);
      } finally { await tab.close(); }
    }

    // 2. The agenda at phone width: the panel's switch, then its headings.
    if (sizes.includes(390)) {
      const tab = await openTab(390, modes[0], SPACE, GRID);
      try {
        await view(tab, 'month'); // a phone opens on the day, whose agenda has nothing; the month's has the month's days
        await sleep(500);
        await tab.click('#dest-tabs button', 'Agenda');
        const a = await until(() => probeIn(tab, PANELR), (x) => x.headsWithWx > 0);
        expect(a && a.headsWithWx > 0 && !a.sideways, `390: the agenda carries the weather: ${JSON.stringify(a)}`);
        await snap(tab, `390-${modes[0]}-agenda`);
      } finally { await tab.close(); }
    }

    // 3. Nothing drawn: no place, the Weather module off, the environment's own Calendar.
    const none = async (name, url, wait) => {
      const tab = await openTab(1280, 'light', url, wait);
      try {
        await sleep(2500);
        const p = await probeIn(tab, MAINR);
        expect(p && p.buttons === 0, `${name}: no weather is drawn: ${JSON.stringify(p)}`);
        return p;
      } finally { await tab.close(); }
    };
    await setup(trip(''), 200);
    const noPlace = await none('no place', SPACE, GRID);
    expect(noPlace.slots > 0, 'no place: the days are still there, with empty slots');
    await setup(trip('Lisbon'), 200);
    await api('PATCH', '/api/modules/weather', { enabled: false });
    await none('Weather off', SPACE, GRID);
    await api('PATCH', '/api/modules/weather', { enabled: true });
    const envCal = await none("the environment's Calendar", '/calendar', GRID);
    expect(envCal.slots === 0, "the environment's Calendar has no slots at all");
    // And back on: it draws again.
    const again = await openTab(1280, 'light', SPACE, GRID);
    try { const p = await until(() => probeIn(again, MAINR), (x) => x.buttons > 0); expect(p.buttons > 0, 'switched back on: the weather returns'); } finally { await again.close(); }
  } finally {
    if (browser) { try { browser.child.kill(); } catch { /* gone */ } }
    await stopServer(server);
    for (const sv of [wx, geo]) sv.close();
  }
  if (failures.length) { say(`${failures.length} failed`); return 1; }
  say('OK');
  return 0;
}
main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
