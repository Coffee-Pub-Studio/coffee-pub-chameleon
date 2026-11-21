#!/usr/bin/env node
/*
 * check-travel-paste-live.mjs -- the Itinerary's "Paste a booking" sheet as a person meets it (plan-assistant-reboot.md, step 4),
 * in a headless browser against a throwaway server whose AI service is the stand-in model (tools/fake-model.mjs, a scripted
 * answer per request; no network). Not part of npm run check: it needs Chromium.
 *   - Add > Paste a booking opens the sheet: its label, the live count, the privacy line, Read it off until there is text;
 *   - no booking in the text: the server's sentence and its unread lines in the sheet, the text still in the box;
 *   - no AI service chosen: the server's sentence, the text still in the box;
 *   - a read with three bookings: the preview (kind icon, title, when, route, reference, cost, travellers, a row's note, the
 *     unread lines above), every row ticked, nothing on the trip yet;
 *   - Edit opens the Itinerary's own form filled in, and saving it marks the row Added; unticking a row leaves it out;
 *     Add to the trip adds only the ticked rows, says how many, and See them goes to the first one added;
 *   - at 390 px the targets are 44 px and nothing scrolls sideways.
 *   node tools/check-travel-paste-live.mjs        (no Chromium: SKIPPED, exit 0; that is a skip, never a pass)
 * PASTE_SHOTS=<folder> keeps a picture at each state; PASTE_MODE=light and PASTE_SIZE=390 look at the other cases.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFakeModel } from './fake-model.mjs';
import { findBrowser, launch, freePort, stopServer, bootSeeded, Tab, sleep, driveScreen } from './shots.mjs';

const say = (...a) => console.log('check-travel-paste-live:', ...a);
const failures = [];
const expect = (ok, text) => { if (!ok) failures.push(text); };

// The seeded trip runs 2026-10-25 to 2026-11-03 (tools/shots-seed.mjs, on the runs' fixed clock).
const TEXT = 'Your booking QX7RTB is confirmed.\nTAP Air Portugal TP 1350, Lisbon (LIS) 07:05 to Porto (OPO) 08:00, 26 Oct 2026. Passenger: Ana Silva. Total 112.80 EUR.\nHotel: The Zetter Townhouse, check in 26 Oct from 15:00, check out 29 Oct 11:00, double room, 2 guests, USD 540.\nDinner at Padella, 27 Oct 19:30, table for 2 under Silva.\nEarn points with our card!';
const ANSWER = {
  objects: [
    { icon: 'plane', kind: 'flight', title: 'TP 1350 Lisbon to Porto', date: '2026-10-26', details: { airline: 'TAP Air Portugal', number: 'TP 1350', from: { code: 'LIS', name: 'Lisbon' }, to: { code: 'OPO', name: 'Porto' }, departs: '2026-10-26T07:05', arrives: '2026-10-26T08:00', reference: 'QX7RTB', cost: 112.8, currency: 'EUR', travellers: ['Ana Silva'] } },
    // The reference is not in the text: the server blanks it and says so on the row.
    { icon: 'bed', kind: 'hotel', title: 'The Zetter Townhouse', date: '2026-10-26', details: { address: '49 Bayswater Road, London', checkIn: '2026-10-26T15:00', checkOut: '2026-10-29T11:00', roomType: 'Double', guests: 2, reference: 'ZZ9999', cost: 540, currency: 'USD' } },
    { icon: 'utensils', kind: 'restaurant', title: 'Dinner at Padella', date: '2026-10-27', details: { starts: '2026-10-27T19:30', partySize: 2, name: 'Silva' } },
  ],
  unread: ['Earn points with our card! is not a booking.'],
};

const ROOTS = `const roots = []; (function walk(r) { roots.push(r); for (const x of r.querySelectorAll('*')) if (x.shadowRoot) walk(x.shadowRoot); })(document);`;
const SHEET = `(() => { ${ROOTS} for (const r of roots) { const d = r.getElementById && r.getElementById('paste-dialog'); if (d) return d; } return null; })()`;
const state = (t) => t.eval(`(() => { const d = ${SHEET}; if (!d || !d.open) return null; const q = (s) => d.querySelector(s); const shown = (e) => Boolean(e && e.getClientRects().length); const box = (e) => { if (!shown(e)) return null; const b = e.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; }; return {
  phase: q('#paste-form').dataset.state, title: q('#paste-title').textContent, label: q('label[for="paste-text"]') && q('label[for="paste-text"]').textContent, value: q('#paste-text').value.length, count: q('#paste-count').textContent,
  privacy: shown(q('#paste-privacy')) ? q('#paste-privacy').textContent : '', goText: q('#paste-go').textContent, goShown: shown(q('#paste-go')), goDisabled: q('#paste-go').disabled, cancel: q('#paste-cancel').textContent,
  reading: shown(q('#paste-reading')), error: shown(q('#paste-problem')) ? q('#paste-error').textContent : '', errorUnread: [...q('#paste-error-unread').children].map((l) => l.textContent), unread: shown(q('#paste-unread')) ? [...q('#paste-unread').children].map((l) => l.textContent) : [],
  summary: shown(q('#paste-summary')) ? q('#paste-summary').textContent : '', done: shown(q('#paste-done')) ? q('#paste-done').textContent : '', see: shown(q('#paste-see')),
  rows: [...q('#paste-rows').children].map((li) => ({ title: li.querySelector('[data-slot="title"]').textContent, kind: li.querySelector('[data-slot="kind"]').textContent, icon: Boolean(li.querySelector('.paste-icon svg')), when: li.querySelector('[data-slot="when"]').textContent, route: li.querySelector('[data-slot="route"]').hidden ? '' : li.querySelector('[data-slot="route"]').textContent, reference: li.querySelector('[data-slot="reference"]').hidden ? '' : li.querySelector('[data-slot="reference"]').textContent, cost: li.querySelector('[data-slot="cost"]').hidden ? '' : li.querySelector('[data-slot="cost"]').textContent, travellers: li.querySelector('[data-slot="travellers"]').hidden ? '' : li.querySelector('[data-slot="travellers"]').textContent, notes: li.querySelector('[data-slot="notes"]').hidden ? '' : li.querySelector('[data-slot="notes"]').textContent, ticked: li.querySelector('input').checked, added: !li.querySelector('[data-slot="added"]').hidden, clipped: li.querySelector('.paste-pick').scrollHeight > li.querySelector('.paste-pick').clientHeight + 1 || li.getBoundingClientRect().height < li.querySelector('.paste-main').getBoundingClientRect().height, pick: box(li.querySelector('.paste-pick')), edit: box(li.querySelector('[data-action="paste-edit"]')), tick: box(li.querySelector('input')) })),
  size: box(d), sideways: d.scrollWidth > d.clientWidth + 1, buttons: [...d.querySelectorAll('.sdk-editor-actions button')].filter(shown).map((b) => ({ text: b.textContent, h: Math.round(b.getBoundingClientRect().height) })) }; })()`);
const planTitles = (t) => t.eval(`(() => { ${ROOTS} const out = new Set(); for (const r of roots) for (const e of r.querySelectorAll('.sdk-card-title, .sdk-row-title')) if (!e.closest('dialog')) out.add(e.textContent.trim()); return [...out]; })()`);

async function main() {
  const bin = findBrowser();
  if (!bin) { say('SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass; nothing was measured.'); return 0; }
  const fake = await startFakeModel();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paste-live-'));
  let server = null; let browser = null;
  const size = Number(process.env.PASTE_SIZE) || 1280;
  const mode = process.env.PASTE_MODE === 'light' ? 'light' : 'dark';
  const phone = size <= 480;
  try {
    const boot = await bootSeeded('travel', dataDir, await freePort());
    server = boot.server;
    const S = { base: server.base, ctx: boot.ctx, cookies: boot.cookies };
    const admin = S.cookies.admin.map((c) => `${c.name}=${c.value}`).join('; ');
    const put = (body) => fetch(`${S.base}/api/ai`, { method: 'PUT', headers: { cookie: admin, 'content-type': 'application/json', origin: S.base }, body: JSON.stringify(body) });
    const point = { source: 'custom', provider: 'compatible', address: `${fake.url || `http://127.0.0.1:${fake.port}`}/v1`, model: 'fake-1', key: 'sk-test', enabled: true };
    expect((await put(point)).status === 200, 'could not point the AI at the stand-in');
    browser = await launch(bin);
    const tab = new Tab(browser.cdp, S.ctx);
    await tab.open(size, mode, false);
    const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
    await driveScreen(tab, { as: 'admin', url: '/modules/travel?space={trip}', wait: '#module-frame >>> .day-add' }, S.base, S.cookies, S.ctx);
    const snap = async (name) => { if (process.env.PASTE_SHOTS) fs.writeFileSync(path.join(process.env.PASTE_SHOTS, `paste-${name}-${size}-${mode}.png`), Buffer.from((await tab.cdp.send('Page.captureScreenshot', { format: 'png' }, tab.sid)).data, 'base64')); };
    const setText = (value) => tab.eval(`(() => { const d = ${SHEET}; const t = d.querySelector('#paste-text'); t.value = ${JSON.stringify(value)}; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const waitPhase = async (phase, ms = 20000) => { const end = Date.now() + ms; let s = null; while (Date.now() < end) { s = await state(tab); if (s && s.phase === phase) return s; await sleep(150); } throw new Error(`the sheet never reached ${phase} (${JSON.stringify(s && { phase: s.phase, error: s.error })})`); };
    await sleep(1500);

    // The entry in the Add menu opens the sheet, empty.
    const before = await planTitles(tab);
    await tab.click('#module-frame >>> .day-add');
    await tab.click('#module-frame >>> .sdk-menu-item', 'Paste a booking');
    let s = await waitPhase('input');
    expect(s.title === 'Paste a booking' && s.label === 'Paste a confirmation email or booking details', `the sheet's words are "${s.title}" / "${s.label}"`);
    expect(s.count === '0 of 30,000' && s.goText === 'Read it' && s.goDisabled, `empty: count "${s.count}", button ${s.goText} disabled ${s.goDisabled}`);
    expect(/^The text goes only to the .* set up\. It is not kept\.$/.test(s.privacy) && !/\{|owner\}/.test(s.privacy), `the privacy line reads "${s.privacy}"`);
    await snap('empty');
    say(`empty sheet: "${s.label}", ${s.count}, "${s.privacy}"`);

    // The count is live; over the limit the button is off and nothing is cut.
    await setText('a'.repeat(30001));
    s = await state(tab);
    expect(s.value === 30001 && /^30,001 of 30,000: too long/.test(s.count) && s.goDisabled, `30,001 characters: value ${s.value}, count "${s.count}", disabled ${s.goDisabled}`);
    await setText('Just an advert, 20% off hotels.');
    s = await state(tab);
    expect(s.count === '31 of 30,000' && !s.goDisabled, `a short text: "${s.count}" disabled ${s.goDisabled}`);

    // No booking in the text: 422, the server's sentence and its unread lines, the text kept.
    fake.next({ json: { objects: [], unread: ['That is an advert.'] } });
    await tab.eval(`(() => { const d = ${SHEET}; d.querySelector('#paste-go').click(); })()`);
    s = await waitPhase('input').then(async (x) => { for (let i = 0; i < 60 && !x.error; i += 1) { await sleep(150); x = await state(tab); } return x; });
    expect(s.error === 'There is no booking in this text.' && s.errorUnread.includes('That is an advert.'), `no booking: "${s.error}" ${JSON.stringify(s.errorUnread)}`);
    expect(s.value === 31, `the text was lost on an error (${s.value})`);
    await snap('error-none');
    say(`no booking: "${s.error}" with ${JSON.stringify(s.errorUnread)}, text kept (${s.value})`);

    // No AI service chosen: 503, the server's words, the text kept.
    expect((await put({ provider: 'none' })).status === 200, 'could not take the AI away');
    await tab.eval(`(() => { const d = ${SHEET}; d.querySelector('#paste-go').click(); })()`);
    for (let i = 0; i < 60; i += 1) { s = await state(tab); if (/No AI service/.test(s.error)) break; await sleep(150); }
    expect(/^No AI service is chosen for this environment/.test(s.error) && s.phase === 'input' && s.value === 31, `not set up: "${s.error}" phase ${s.phase} text ${s.value}`);
    say(`not set up: "${s.error}", text kept`);
    expect((await put(point)).status === 200, 'could not point the AI at the stand-in again');

    // A read with three bookings: the preview.
    await setText(TEXT);
    fake.next({ json: ANSWER });
    await tab.eval(`(() => { const d = ${SHEET}; d.querySelector('#paste-go').click(); })()`);
    s = await waitPhase('preview');
    expect(s.rows.length === 3 && s.rows.every((r) => r.ticked && r.icon && !r.added), `three ticked rows with icons (${JSON.stringify(s.rows.map((r) => [r.title, r.ticked, r.icon]))})`);
    expect(s.rows[0].kind === 'Flight' && s.rows[0].route === 'Lisbon (LIS) to Porto (OPO)' && s.rows[0].reference === 'QX7RTB' && /112\.80/.test(s.rows[0].cost) && /EUR|€/.test(s.rows[0].cost) && s.rows[0].travellers === 'For Ana Silva' && /7:05/.test(s.rows[0].when), `row 1: ${JSON.stringify(s.rows[0])}`);
    expect(s.rows[1].kind === 'Stay' && /540/.test(s.rows[1].cost) && /not in the text/.test(s.rows[1].notes), `row 2 says what was left blank and why: ${JSON.stringify(s.rows[1])}`);
    expect(s.rows[2].kind === 'Restaurant' && s.rows[2].notes === '' && /7:30/.test(s.rows[2].when), `row 3: ${JSON.stringify(s.rows[2])}`);
    expect(s.unread.some((u) => /not a booking/.test(u)), `the unread lines are above the list (${JSON.stringify(s.unread)})`);
    expect(s.goText === 'Add to the trip' && !s.goDisabled && /3 bookings found/.test(s.summary), `Add to the trip: "${s.goText}", summary "${s.summary}"`);
    expect(JSON.stringify(await planTitles(tab)) === JSON.stringify(before), 'something was written before Add to the trip');
    const req = fake.seen.filter((x) => /chat\/completions|messages/.test(x.url)).pop();
    expect(req && JSON.stringify(req.body).includes('Earn points with our card'), 'the pasted text did not reach the stand-in');
    await snap('preview');
    say(`preview: ${s.rows.map((r) => `${r.kind} "${r.title}" ${r.when}${r.notes ? ` [${r.notes}]` : ''}`).join(' | ')}; unread ${JSON.stringify(s.unread)}`);
    if (phone) {
      for (const r of s.rows) expect(r.pick.h >= 44 && r.edit.h >= 44 && r.tick.h >= 16, `a row's targets are ${JSON.stringify([r.pick, r.edit])} at ${size}`);
      expect(s.buttons.every((b) => b.h >= 44), `the buttons are ${JSON.stringify(s.buttons)}`);
    }
    expect(s.rows.every((r) => !r.clipped), `a row is cut off at ${size} (${JSON.stringify(s.rows.map((r) => [r.clipped, r.pick]))})`);
    expect(!s.sideways, `the sheet scrolls sideways at ${size}`);

    // Edit: the Itinerary's own form, filled in; Save marks the row Added.
    await tab.eval(`(() => { const d = ${SHEET}; d.querySelectorAll('.paste-row')[2].querySelector('[data-action="paste-edit"]').click(); })()`);
    await tab.waitFor('#module-frame >>> #f-title');
    const form = await tab.eval(`(() => { ${ROOTS} for (const r of roots) { const t = r.getElementById && r.getElementById('f-title'); if (t && t.getClientRects().length) return { title: t.value, notes: r.getElementById('f-notes').value, heading: r.getElementById('editor-title').textContent, del: !r.getElementById('f-delete').hidden }; } return null; })()`);
    expect(form && form.title === 'Dinner at Padella' && form.heading === 'Add to the plan' && !form.del, `the form was not filled in as a new object (${JSON.stringify(form)})`);
    await snap('edit');
    await tab.click('#module-frame >>> #f-save');
    for (let i = 0; i < 60; i += 1) { s = await state(tab); if (s && s.rows[2].added) break; await sleep(150); }
    expect(s && s.rows[2].added && !s.rows[2].ticked && s.rows[0].ticked, `Save in the form did not mark the row Added (${JSON.stringify(s && s.rows.map((r) => [r.added, r.ticked]))})`);
    expect((await planTitles(tab)).includes('Dinner at Padella'), 'the edited booking is not on the trip');
    say('edit: the form held the booking, Save added it and marked the row Added');

    // Untick the stay; Add to the trip adds only the flight.
    await tab.eval(`(() => { const d = ${SHEET}; d.querySelectorAll('.paste-row')[1].querySelector('input').click(); })()`);
    s = await state(tab);
    expect(!s.rows[1].ticked, 'the stay could not be unticked');
    await tab.eval(`(() => { const d = ${SHEET}; d.querySelector('#paste-go').click(); })()`);
    s = await waitPhase('done');
    expect(s.done === '1 booking added.' && s.see && s.cancel === 'Close', `after adding: "${s.done}" see ${s.see} cancel "${s.cancel}"`);
    await snap('done');
    const titles = await planTitles(tab);
    expect(titles.some((x) => /TP 1350/.test(x)) && !titles.some((x) => /Zetter/.test(x)), `the trip holds ${JSON.stringify(titles)}`);
    say(`added: "${s.done}"; on the trip: ${JSON.stringify(titles.filter((x) => !before.includes(x)))}`);
    await tab.eval(`(() => { const d = ${SHEET}; d.querySelector('#paste-see').click(); })()`);
    await sleep(800);
    expect(!(await state(tab)), 'See them did not close the sheet');
    const seen = await tab.eval(`(() => { ${ROOTS} for (const r of roots) { const a = r.activeElement; if (a && a.closest && a.closest('.row[data-id]')) return a.closest('.row').textContent.replace(/\\s+/g, ' ').slice(0, 80); } return ''; })()`);
    expect(/Dinner at Padella/.test(seen), `See them did not go to the first one added (focus: "${seen}")`);
    say(`See them: focus on "${seen}"`);
  } catch (err) {
    failures.push(err.stack || err.message);
  } finally {
    if (browser) { browser.cdp.ws.close(); browser.child.kill(); }
    if (server) await stopServer(server);
    await fake.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  if (failures.length) { console.error('check-travel-paste-live: FAILED\n  ' + failures.join('\n  ')); return 1; }
  say(`OK at ${size} ${mode}`);
  return 0;
}
process.exit(await main());
