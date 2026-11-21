#!/usr/bin/env node
/*
 * check-ai-read.mjs -- the Assistant's "Read it as bookings" (plan-assistant-reboot.md, step 5), as a person meets it: run in
 * headless Chromium against a throwaway server whose AI service is the stand-in model (tools/fake-model.mjs, scripted `json`
 * answers). No network. It cannot say how well a real model reads a booking.
 *   - The pure parts (longPaste, readRows, readChosen, readSummary) run as code.
 *   - A 3,000-character paste in the Assistant is not cut (the box holds all of it, no maxlength), shows the notice, the count
 *     "N of 30,000" and the button, and nothing is sent to ask; a short question shows none of it and goes to ask as before;
 *     over 30,000 turns the count red and turns the button off.
 *   - Read it as bookings shows a progress line with Cancel, then the preview (rows with icon, title, when, route, reference, cost,
 *     travellers, notes, ticks; the unread lines above) and writes nothing; Add to the trip sends only the ticked rows through
 *     the existing Keep path (POST /api/spaces/:id/action), the box is then emptied.
 *   - A 422 and a 503 show the server's sentence and keep the text in the box.
 *   - No sideways scroll at 390 wide. CHECK_AI_READ_SHOTS=<folder> keeps pictures; CHECK_AI_READ_MODE=light, _SIZE=390.
 *
 *   node tools/check-ai-read.mjs        (no Chromium: SKIPPED, exit 0; that is a skip, never a pass)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startFakeModel } from './fake-model.mjs';
import { findBrowser, launch, freePort, stopServer, bootSeeded, Tab, sleep, driveScreen } from './shots.mjs';

const say = (...a) => console.log('check-ai-read:', ...a);
const failures = [];
const expect = (ok, text) => { if (!ok) failures.push(text); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-read-lib-'));
fs.copyFileSync(new URL('../public/chat-input.js', import.meta.url), path.join(tmp, 'chat-input.mjs'));
const { longPaste, readRows, readChosen, readSummary, READ_MAX } = await import(pathToFileURL(path.join(tmp, 'chat-input.mjs')).href);
fs.rmSync(tmp, { recursive: true, force: true });

const SIZE = Number(process.env.CHECK_AI_READ_SIZE) || 1280;
const MODE = process.env.CHECK_AI_READ_MODE === 'light' ? 'light' : 'dark';
const shots = process.env.CHECK_AI_READ_SHOTS || '';
const snap = async (t, name) => { if (shots) fs.writeFileSync(path.join(shots, `${name}-${SIZE}-${MODE}.png`), Buffer.from((await t.cdp.send('Page.captureScreenshot', { format: 'png' }, t.sid)).data, 'base64')); };

const BOOKINGS = 'Your booking QX7RTB is confirmed.\nTAP Air Portugal TP 1350, Lisbon (LIS) 07:05 to London Heathrow (LHR) 09:50, 14 Mar 2027.\nPassenger: Ana Silva. Total 412.80 EUR.\n\nHotel Marlow, 14 to 18 Mar 2027, confirmation HM-55021. Total 560.00 GBP. Guest: Ana Silva.\n\nA car hire is mentioned without a date.\n';
const FILLER = 'This message is sent from an automated address, please do not reply. Terms and conditions apply to every booking. '.repeat(40);
const PASTE = `${BOOKINGS}\n${FILLER}`.slice(0, 2999) + '.';
const flight = { icon: 'plane', kind: 'flight', title: 'TP 1350 Lisbon to London', date: '2027-03-14', details: { airline: 'TAP Air Portugal', number: 'TP 1350', from: { code: 'LIS', name: 'Lisbon' }, to: { code: 'LHR', name: 'London Heathrow' }, departs: '2027-03-14T07:05', arrives: '2027-03-14T09:50', reference: 'QX7RTB', cost: 412.8, currency: 'EUR', travellers: ['Ana Silva'] } };
const hotel = { icon: 'bed', kind: 'hotel', title: 'Hotel Marlow', date: '2027-03-14', details: { checkIn: '2027-03-14', checkOut: '2027-03-18', reference: 'HM-55021', cost: 560, currency: 'GBP', travellers: ['Ana Silva'] } };

function unitChecks() {
  expect(READ_MAX === 30000, 'the limit is not 30,000');
  const q = (n) => 'x'.repeat(n);
  expect(!longPaste(q(1000), 'assistant').show && longPaste(q(1001), 'assistant').show, 'the notice does not start above 1,000');
  expect(!longPaste(q(1500), 'discussion').show, 'the notice shows in the Discussion');
  expect(!longPaste(`/ai ${q(500)}`, 'assistant').show && longPaste(`/ai ${q(1500)}`, 'assistant').show, 'a typed /ai is counted by its words');
  expect(!longPaste(`{"title":"x","kind":"note","content":"${q(1500)}"}`, 'assistant').show, 'a pasted import answer is offered as bookings');
  const over = longPaste(q(30001), 'assistant');
  expect(over.over && over.count === '30,001 of 30,000' && !longPaste(q(30000), 'assistant').over, `the count reads "${over.count}"`);
  const fmt = { day: (d) => d, time: (t) => t, money: (n, c) => `${n.toFixed(2)} ${c}` };
  const rows = readRows({ objects: [flight, hotel], notes: [['Seat not given.'], []], unread: [] }, fmt);
  expect(rows.length === 2 && rows[0].route && rows[0].route.from === 'Lisbon (LIS)' && rows[0].cost === '412.80 EUR' && rows[0].travellers === 'Ana Silva' && rows[0].reference === 'QX7RTB' && rows[0].notes[0] === 'Seat not given.', `the flight row is ${JSON.stringify(rows[0])}`);
  expect(rows[1].kind === 'Stay' && rows[1].icon === 'bed' && rows[1].when === '2027-03-14 to 2027-03-18' && !rows[1].route, `the stay row is ${JSON.stringify(rows[1])}`);
  rows[1].checked = false;
  expect(readChosen(rows).length === 1, 'readChosen does not drop an unticked row');
  expect(/^2 bookings found\. 1 ticked\. Nothing is added until you press Add to the trip\./.test(readSummary(rows)), `the summary reads "${readSummary(rows)}"`);
  expect(readRows(null, fmt).length === 0 && readRows({ objects: [null, 4] }, fmt).length === 2, 'odd answers are not tolerated');
  say('helpers: the notice, the count and the rows read as they should');
}

async function main() {
  unitChecks();
  const bin = findBrowser();
  if (!bin) { say('SKIPPED the browser half. No Chromium found (set CHROME_PATH). This is not a pass.'); return failures.length ? 1 : 0; }
  const fake = await startFakeModel({});
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-read-data-'));
  let server = null; let browser = null;
  try {
    const boot = await bootSeeded('travel', dataDir, await freePort());
    server = boot.server;
    const S = { base: server.base, ctx: boot.ctx, cookies: boot.cookies };
    browser = await launch(bin);
    const admin = S.cookies.admin.map((c) => `${c.name}=${c.value}`).join('; ');
    const put = (body) => fetch(`${S.base}/api/ai`, { method: 'PUT', headers: { cookie: admin, 'content-type': 'application/json', origin: S.base }, body: JSON.stringify(body) });
    expect((await put({ source: 'custom', provider: 'compatible', address: `${fake.url}/v1`, model: 'stub-model', key: 'sk-test', enabled: true })).status === 200, 'could not point the AI at the stand-in');
    expect((await fetch(`${S.base}/api/roles/member`, { method: 'PATCH', headers: { cookie: admin, 'content-type': 'application/json', origin: S.base }, body: JSON.stringify({ useAi: true }) })).status === 200, 'could not give members Use AI');
    const tab = new Tab(browser.cdp, S.ctx);
    await tab.open(SIZE, MODE, SIZE >= 700);
    const settle = tab.settle.bind(tab); tab.settle = () => Promise.race([settle(), sleep(3000)]);
    await driveScreen(tab, { as: 'mia', url: '/#join={trip}', wait: '[data-layout-tab="workspace"]', call: SIZE >= 700 }, S.base, S.cookies, S.ctx);
    const t = tab;
    await sleep(1500);
    await t.eval(`(() => { window.__calls = []; const of = window.fetch; window.fetch = function (u, o) { const m = /\\/api\\/spaces\\/[^/]+\\/(ai\\/extract|ai|action)$/.exec(String(u)); if (m && o && o.method === 'POST') window.__calls.push({ route: m[1], body: o.body }); return of.apply(this, arguments); }; })()`);
    if (SIZE < 700) {
      // A phone shows one thing at a time: Chat is a tab in the bar at the foot.
      await t.eval(`[...document.querySelectorAll('button')].find((e) => e.textContent.trim() === 'Chat' && e.getClientRects().length).click()`);
      await sleep(1200);
    }
    await t.click('#chat-view-assistant');
    await sleep(800);
    const calls = (route) => t.eval(`window.__calls.filter((c) => c.route === ${JSON.stringify(route)}).map((c) => JSON.parse(c.body))`);
    const setBox = (v) => t.eval(`(() => { const i = document.getElementById('chat-input'); i.focus(); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const long = `(() => { const e = document.getElementById('chat-long'); return { shown: !e.hidden && e.getClientRects().length > 0, text: document.getElementById('chat-long-text').textContent, count: document.getElementById('chat-long-count').textContent, red: document.getElementById('chat-long-count').classList.contains('error'), off: document.getElementById('chat-long-read').disabled, button: document.getElementById('chat-long-read').textContent, len: document.getElementById('chat-input').value.length, max: document.getElementById('chat-input').maxLength }; })()`;
    const sideways = `document.documentElement.scrollWidth - document.documentElement.clientWidth`;

    // A short question: no notice, and it goes to ask as before.
    await setBox('what is a good first meal');
    expect(!(await t.eval(long)).shown, 'a short question shows the long notice');
    fake.next({ json: { answer: 'A plain stub answer.', objects: [], used: [] } });
    await t.key('Enter');
    await sleep(2500);
    expect((await calls('ai')).length === 1 && (await calls('ai/extract')).length === 0, 'a short question did not go to ask alone');

    // A 3,000 character paste: not cut, the notice, the count and the button; nothing sent.
    await setBox(PASTE);
    let l = await t.eval(long);
    expect(PASTE.length === 3000 && l.len === 3000 && l.max === -1, `the paste was cut or the box still has a limit (${l.len}, maxlength ${l.max})`);
    expect(l.shown && l.text === 'This is long. Read it as bookings, or shorten it to ask a question.' && l.count === '3,000 of 30,000' && l.button === 'Read it as bookings' && !l.off && !l.red, `the notice is ${JSON.stringify(l)}`);
    expect((await calls('ai')).length === 1, 'the paste was sent to ask');
    await snap(t, 'long-notice');
    expect(await t.eval(sideways) <= 0, `sideways scroll with the notice: ${await t.eval(sideways)}`);

    // Over 30,000: red, and the button is off.
    await setBox('y'.repeat(30001));
    l = await t.eval(long);
    expect(l.shown && l.red && l.off && l.count === '30,001 of 30,000', `over 30,000 is ${JSON.stringify(l)}`);
    await snap(t, 'long-over');
    await setBox(PASTE);

    // Read it: a progress line with Cancel; Cancel keeps the text.
    fake.next({ delayMs: 4000, json: { objects: [flight], unread: [] } });
    await t.click('#chat-long-read');
    await sleep(700);
    const wait = await t.eval(`(() => { const w = document.querySelector('.chat-read-wait'); return w ? { text: w.textContent.trim(), cancel: [...w.querySelectorAll('button')].map((b) => b.textContent), off: document.getElementById('chat-long-read').disabled } : null; })()`);
    expect(wait && /Reading for bookings/.test(wait.text) && wait.cancel.join() === 'Cancel' && wait.off, `the progress state is ${JSON.stringify(wait)}`);
    await snap(t, 'reading');
    await t.eval(`document.querySelector('.chat-read-wait button').click()`);
    await sleep(500);
    expect(!(await t.eval(`document.querySelector('.chat-read-wait, .chat-read')`)) && (await t.eval(long)).len === 3000, 'Cancel did not stop the read and keep the text');
    expect(/Cancelled/.test(await t.eval(`document.getElementById('chat-note').textContent`)), 'Cancel did not say so');
    await sleep(4500); // the cancelled call's answer is not used

    // 422: the server's sentence, the text kept.
    fake.next({ json: { objects: [], unread: [] } });
    await t.click('#chat-long-read');
    await sleep(2500);
    let prob = await t.eval(`(() => { const p = document.querySelector('.chat-read-problem'); return p ? p.textContent.replace(/\\s+/g, ' ').trim() : null; })()`);
    expect(prob && /There is no booking in this text\./.test(prob) && /still in the box/.test(prob), `the 422 shows "${prob}"`);
    expect((await t.eval(long)).len === 3000, 'a 422 lost the text');
    await snap(t, 'problem-422');
    await t.eval(`document.querySelector('.chat-read-problem button').click()`);

    // 503: the AI is switched off for the space's environment.
    expect((await put({ provider: 'none' })).status === 200, 'could not take the AI away');
    await t.click('#chat-long-read');
    await sleep(2000);
    prob = await t.eval(`(() => { const p = document.querySelector('.chat-read-problem'); return p ? p.textContent.replace(/\\s+/g, ' ').trim() : null; })()`);
    expect(prob && prob.length > 20 && /still in the box/.test(prob) && !/HTTP \\d+/.test(prob), `the 503 shows "${prob}"`);
    expect((await t.eval(long)).len === 3000, 'a 503 lost the text');
    await t.eval(`document.querySelector('.chat-read-problem button').click()`);
    expect((await put({ source: 'custom', provider: 'compatible', address: `${fake.url}/v1`, model: 'stub-model', key: 'sk-test', enabled: true })).status === 200, 'could not bring the AI back');

    // Read: the preview, with the unread lines above, and nothing written.
    fake.next({ json: { objects: [flight, hotel], unread: ['A car hire could not be read.'] } });
    const actionsBefore = (await calls('action')).length;
    await t.click('#chat-long-read');
    await sleep(2500);
    const body = (await calls('ai/extract')).pop();
    expect(body && body.text.length === 3000 && body.from === undefined && !('from' in body), `the read sent ${JSON.stringify(body && Object.keys(body))}`);
    const pv = await t.eval(`(() => { const c = document.querySelector('.chat-read'); if (!c) return null; const kids = [...c.children].map((e) => e.className); return { kids, summary: c.querySelector('.chat-read-summary').textContent, unread: [...c.querySelectorAll('.chat-read-unread li')].map((e) => e.textContent), rows: [...c.querySelectorAll('.chat-read-row')].map((r) => ({ icon: r.querySelector('.chat-read-icon').className, text: r.querySelector('.chat-read-main').innerText.replace(/\\s+/g, ' '), ticked: r.querySelector('input').checked, h: r.querySelector('label').getBoundingClientRect().height })), go: c.querySelector('.btn-primary').textContent }; })()`);
    expect(pv && pv.rows.length === 2 && pv.go === 'Add to the trip', `the preview is ${JSON.stringify(pv)}`);
    if (pv) {
      expect(/Flight: TP 1350 Lisbon to London/.test(pv.rows[0].text) && /Lisbon \(LIS\) to London Heathrow \(LHR\)/.test(pv.rows[0].text) && /Reference QX7RTB/.test(pv.rows[0].text) && /412\.80/.test(pv.rows[0].text) && /For Ana Silva/.test(pv.rows[0].text) && /7:05 AM/.test(pv.rows[0].text), `the flight row reads "${pv.rows[0].text}"`);
      expect(/plane/.test(pv.rows[0].icon) && /Stay: Hotel Marlow/.test(pv.rows[1].text) && /bed/.test(pv.rows[1].icon) && /560/.test(pv.rows[1].text), `the stay row reads "${pv.rows[1].text}"`);
      expect(pv.unread.join() === 'A car hire could not be read.' && pv.kids.indexOf('chat-read-head') < pv.kids.indexOf('chat-read-rows') && pv.kids.indexOf('chat-read-lines chat-read-unread') < pv.kids.indexOf('chat-read-rows'), `the unread lines are not above the rows (${pv.kids})`);
      expect(pv.rows.every((r) => r.ticked && r.h >= 44), `rows are not all ticked and 44px tall (${JSON.stringify(pv.rows.map((r) => [r.ticked, r.h]))})`);
      expect(/^2 bookings found\. 2 ticked\. Nothing is added until you press Add to the trip\./.test(pv.summary), `summary "${pv.summary}"`);
    }
    expect((await calls('action')).length === actionsBefore, 'the preview wrote something');
    await snap(t, 'preview');
    expect(await t.eval(sideways) <= 0, `sideways scroll with the preview: ${await t.eval(sideways)}`);

    // Add only the ticked rows: untick the stay.
    await t.eval(`document.querySelectorAll('.chat-read-row input')[1].click()`);
    expect(/1 ticked/.test(await t.eval(`document.querySelector('.chat-read-summary').textContent`)), 'unticking did not change the count');
    await t.eval(`[...document.querySelectorAll('.chat-read .btn-primary')].pop().click()`);
    await sleep(3500);
    const sent = (await calls('action')).slice(actionsBefore);
    const inputs = sent.map((s) => JSON.stringify(s.input || s));
    expect(sent.length === 1 && /TP 1350/.test(inputs[0]) && !/Hotel Marlow/.test(inputs.join()), `the add sent ${sent.length} (${inputs.join(' | ').slice(0, 300)})`);
    const after = await t.eval(`({ states: [...document.querySelectorAll('.chat-read-state')].map((e) => e.textContent), box: document.getElementById('chat-input').value.length, notice: document.getElementById('chat-long').hidden, note: document.getElementById('chat-note').textContent, imports: document.querySelectorAll('.chat-import-msg').length })`);
    expect(after.states[0] === 'Added' && after.states[1] === '' && after.box === 0 && after.notice, `after the add: ${JSON.stringify(after)}`);
    await snap(t, 'added');
    say(`ok so far: ${JSON.stringify({ sent: sent.length, after })}`);
    await t.close();
  } catch (err) {
    failures.push(`stopped: ${err.message}`);
  } finally {
    if (browser) { browser.cdp.ws.close(); browser.child.kill(); }
    if (server) await stopServer(server);
    await fake.close?.();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  if (failures.length) { for (const f of failures) console.error(`check-ai-read: ${f}`); return 1; }
  say('ok');
  return 0;
}
process.exit(await main());
