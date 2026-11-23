#!/usr/bin/env node
/*
 * check-members-make-spaces.mjs -- who may make a space (Thomas, 2026-11-23: "Members and moderators, always"), against a throwaway
 * seeded server (the travel seed: the admin; Mia, a member ticked moderator of Lisbon; Sam and Lee, members), with Agents on. No
 * LiveKit. Covers:
 *   - POST /api/spaces: the owner (here the admin) makes one as before, owner-only fields and all; a member makes one with a name,
 *     description, people and a template, and is its moderator and one of its members; a moderator makes one; a guest (403), an
 *     agent (403), and nobody signed in (401) cannot; a member's request carrying an owner-only field (starter: false, link, profile,
 *     linkIcon) or an agent among the people is refused with one sentence and makes nothing; the space's own limits still apply
 *     (the name's 40 characters, the description's 300, a template the environment does not offer, the Space templates switch)
 *   - what the new moderator may do there: Set up's read and a moderator's fields, never the owners' (the name)
 *   - GET /api/environment/space-templates: open to every account, read-only, names and descriptions only; signed out 401, an
 *     agent 403; GET /api/environment/template stays the owners'
 *   - mayMakeSpace (primary-nav.js) and addBody (space-add.js), as pure functions
 *   - in a real Chromium page at 1280 and 390: "+ New <trip>" shows for a member (the switcher; the phone menu) and opens the one
 *     Add form, which makes a space that is in their switcher; a guest has no "+ New"; Manage's Add (the admin) and Home's Add card
 *     (a member) open the same form
 * Without a Chromium the browser part says SKIPPED (set CHROME_PATH); the rest still runs. MMS_SHOTS=<dir> writes the pictures.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { bootSeeded, stopServer, freePort, findBrowser, launch, Tab, sleep } = await import('./shots.mjs');

let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try { await fn(); n += 1; } catch (err) { failed += 1; console.error(`FAIL ${name}\n${err.stack || err}`); }
};

// The pure parts, copied as .mjs so node reads them as modules whatever package.json says.
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'check-members-make-spaces-'));
const copy = (name) => { const to = path.join(work, name.replace(/\.js$/, '.mjs')); fs.writeFileSync(to, fs.readFileSync(path.join(ROOT, 'public', name), 'utf8').replace(/from '\/([a-z-]+)\.js'/g, "from './$1.mjs'")); return to; };
copy('template-choice.js');
const { mayMakeSpace } = await import(pathToFileURL(copy('primary-nav.js')).href);
const { addBody } = await import(pathToFileURL(copy('space-add.js')).href);

await test('mayMakeSpace: members, owners and the admin; nobody else', async () => {
  for (const role of ['member', 'owner', 'admin']) assert.equal(mayMakeSpace(role), true, role);
  for (const role of ['guest', 'moderator', 'agent', '', undefined, null]) assert.equal(mayMakeSpace(role), false, String(role));
});
await test('addBody: trimmed text, the people ticked, a template only when one is chosen', async () => {
  assert.deepEqual(addBody({ name: '  Porto ', description: ' x ', members: ['a'], template: '' }), { name: 'Porto', description: 'x', members: ['a'] });
  assert.deepEqual(addBody({ name: 'P', template: 'games' }), { name: 'P', description: '', members: [], template: 'games' });
});

const SHOTS = process.env.MMS_SHOTS || '';
const dataDir = path.join(work, 'data');
let server;
let browser;
const tabs = [];
try {
  const port = await freePort();
  const boot = await bootSeeded('travel', dataDir, port, { env: { AGENT_TOKENS: 'true' } });
  server = boot.server;
  const { ctx, cookies } = boot;
  const jar = (as) => (cookies[as] || []).map((c) => `${c.name}=${c.value}`).join('; ');
  const api = async (method, url, body, as = 'admin', headers = {}) => {
    const r = await fetch(server.base + url, { method, headers: { 'content-type': 'application/json', ...(as ? { cookie: jar(as) } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch { /* none */ }
    return { status: r.status, json };
  };
  const count = async () => (await api('GET', '/api/spaces')).json.spaces.length;
  const me = async (as) => (await api('GET', '/api/me', undefined, as)).json.user;
  const refused = (r, status, re, what) => { assert.equal(r.status, status, `${what}: ${JSON.stringify(r.json)}`); if (re) assert.match(r.json.error, re, what); };

  // An agent with a token, and a guest link into Lisbon.
  assert.equal((await api('PATCH', '/api/settings', { agents: true })).status, 200);
  const agent = (await api('POST', '/api/users', { agent: true, displayName: 'Helper' })).json.user;
  const token = (await api('POST', `/api/users/${agent.key}/token`)).json.token;
  assert.ok(token, 'an agent token');
  const guestLink = (await api('POST', `/api/spaces/${ctx.trip}/guest-link`, {})).json.space.guestToken;
  assert.ok(guestLink, 'a guest link');

  await test('the owner (the admin) makes a space as before, owner-only fields and all', async () => {
    const before = await count();
    const r = await api('POST', '/api/spaces', { name: 'Owner trip', description: 'd', members: [ctx.sam], starter: false, link: 'https://example.com/x', profile: 'characters' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.space.name, 'Owner trip');
    assert.equal(r.json.space.profile, 'characters');
    assert.ok(r.json.space.members.includes(ctx.sam));
    assert.equal(await count(), before + 1);
  });

  await test('a member makes one with a name, description, people and a template, and is its moderator and a member', async () => {
    const r = await api('POST', '/api/spaces', { name: 'Porto', description: 'A long weekend.', members: [ctx.lee], template: 'games' }, 'sam');
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const s = r.json.space;
    assert.equal(s.name, 'Porto');
    assert.equal(s.description, 'A long weekend.');
    assert.equal(s.template, 'games');
    assert.deepEqual([...s.members].sort(), [ctx.lee, ctx.sam].sort());
    const sam = await me('sam');
    assert.equal(sam.role, 'member', 'still a member of the environment');
    assert.equal(sam.spaces[s.id].permissions.moderator, true, 'its moderator');
    const lee = await me('lee');
    assert.equal(Boolean(lee.spaces[s.id]?.permissions?.moderator), false, 'the people added are not');
    // As its moderator: Set up's read and a moderator's fields; the name stays the owners'.
    assert.equal((await api('GET', `/api/spaces/${s.id}`, undefined, 'sam')).status, 200);
    assert.equal((await api('PATCH', `/api/spaces/${s.id}`, { closed: true }, 'sam')).status, 200);
    assert.equal((await api('PATCH', `/api/spaces/${s.id}`, { closed: false }, 'sam')).status, 200);
    refused(await api('PATCH', `/api/spaces/${s.id}`, { name: 'Elsewhere' }, 'sam'), 403, /^owners only$/, 'a rename');
    refused(await api('DELETE', `/api/spaces/${s.id}`, undefined, 'sam'), 403, /^owners only$/, 'a delete');
    // In their switcher (GET /api/presence, theirs).
    const listed = (await api('GET', '/api/presence', undefined, 'sam')).json.spaces.find((x) => x.id === s.id);
    assert.equal(listed?.mine, true, 'in their list');
  });

  await test('a member\'s space gets its template\'s starter content as an owner\'s does', async () => {
    const had = await api('POST', '/api/modules/bundled/documents/install');
    assert.ok(had.status < 300 || /already installed/.test(JSON.stringify(had.json)), JSON.stringify(had.json));
    assert.equal((await api('PATCH', '/api/modules/documents', { enabled: true })).status, 200);
    const theirs = (await api('POST', '/api/spaces', { name: 'Starter sam', template: 'games' }, 'sam')).json.space.id;
    const owners = (await api('POST', '/api/spaces', { name: 'Starter owner', template: 'games' })).json.space.id;
    const keys = async (id, as) => {
      const r = await api('GET', `/api/modules/documents/data?scope=space&space=${id}`, undefined, as);
      return r.status === 200 ? r.json.items.map((i) => i.key).sort() : `status ${r.status}`;
    };
    const mine = await keys(theirs, 'sam');
    assert.deepEqual(mine, await keys(owners, 'admin'));
    assert.ok(Array.isArray(mine) && mine.length > 0, `some starter content: ${JSON.stringify(mine)}`);
  });

  await test('a moderator (Mia, of Lisbon) makes one and is its moderator; nothing else of hers changes', async () => {
    const r = await api('POST', '/api/spaces', { name: 'Seville', description: '', members: [] }, 'mia');
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const mia = await me('mia');
    assert.equal(mia.role, 'member');
    assert.equal(mia.spaces[r.json.space.id].permissions.moderator, true);
    assert.equal(mia.spaces[ctx.trip].permissions.moderator, true, 'still Lisbon\'s');
    assert.equal(Boolean(mia.spaces[ctx.second]?.permissions?.moderator), false, 'and not Kyoto\'s');
    refused(await api('GET', '/api/users', undefined, 'mia'), 403, /^owners only$/, 'no environment-wide reads');
    refused(await api('PATCH', '/api/settings', { spaceTemplates: false }, 'mia'), 403, null, 'no environment settings');
  });

  await test('a guest, an agent and nobody signed in cannot; nothing is made', async () => {
    const before = await count();
    refused(await api('POST', `/api/spaces?guest=${encodeURIComponent(guestLink)}`, { name: 'G' }, null), 403, /^A guest can't make a trip\.$/, 'a guest');
    refused(await api('POST', '/api/spaces', { name: 'A' }, null, { authorization: `Bearer ${token}` }), 403, /^An agent can't do that\.$/, 'an agent');
    refused(await api('POST', '/api/spaces', { name: 'N' }, null), 401, /^sign in first$/, 'signed out');
    assert.equal(await count(), before);
  });

  await test('a member\'s owner-only fields and agents are refused with one sentence; nothing is made', async () => {
    const before = await count();
    for (const extra of [{ starter: false }, { starter: true }, { link: 'https://example.com' }, { profile: 'characters' }, { linkIcon: 'link' }, { madeBy: 'abcd' }]) {
      refused(await api('POST', '/api/spaces', { name: 'X', ...extra }, 'sam'), 403, /^Only owners can set that for a new trip\.$/, JSON.stringify(extra));
    }
    refused(await api('POST', '/api/spaces', { name: 'X', members: [agent.key] }, 'sam'), 403, /^Only owners can add an agent to a trip\.$/, 'an agent among the people');
    assert.equal(await count(), before);
    // The owner may still add an agent when making one.
    assert.equal((await api('POST', '/api/spaces', { name: 'With helper', members: [agent.key] })).status, 200);
  });

  await test('the space\'s own limits still apply to a member', async () => {
    const long = await api('POST', '/api/spaces', { name: 'N'.repeat(80), description: 'D'.repeat(900) }, 'sam');
    assert.equal(long.status, 200);
    assert.equal(long.json.space.name.length, 40, 'the name\'s 40 characters');
    assert.equal(long.json.space.description.length, 300, 'the description\'s 300');
    refused(await api('POST', '/api/spaces', { name: 'X', template: 'no-such' }, 'sam'), 400, /^There is no template called no-such\.$/, 'a template not offered');
    assert.equal((await api('PATCH', '/api/settings', { spaceTemplates: false })).status, 200);
    refused(await api('POST', '/api/spaces', { name: 'X', template: 'games' }, 'sam'), 409, /can't use its own template while that is turned off/, 'the switch off');
    assert.equal((await api('PATCH', '/api/settings', { spaceTemplates: true })).status, 200);
  });

  await test('GET /api/environment/space-templates: every account, names only; the owners\' own read stays theirs', async () => {
    const r = await api('GET', '/api/environment/space-templates', undefined, 'sam');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.json).sort(), ['choices', 'environment', 'on']);
    assert.equal(r.json.on, true);
    assert.ok(r.json.choices.some((c) => c.id === 'games'));
    for (const c of r.json.choices) assert.deepEqual(Object.keys(c).sort(), ['description', 'id', 'name']);
    const owners = (await api('GET', '/api/environment/template')).json.choices.filter((c) => !c.hidden).map((c) => c.id);
    assert.deepEqual(r.json.choices.map((c) => c.id), owners, 'the same templates the owner\'s list offers');
    refused(await api('GET', '/api/environment/space-templates', undefined, null), 401, null, 'signed out');
    refused(await api('GET', '/api/environment/space-templates', undefined, null, { authorization: `Bearer ${token}` }), 403, null, 'an agent');
    refused(await api('GET', '/api/environment/template', undefined, 'sam'), 403, /^owners only$/, 'the owners\' read');
    assert.equal((await api('PATCH', '/api/settings', { spaceTemplates: false })).status, 200);
    assert.deepEqual((await api('GET', '/api/environment/space-templates', undefined, 'sam')).json.choices, [], 'none while the switch is off');
    assert.equal((await api('PATCH', '/api/settings', { spaceTemplates: true })).status, 200);
  });

  const bin = findBrowser();
  if (!bin) {
    console.log('check-members-make-spaces: browser part SKIPPED. No Chromium found (set CHROME_PATH). This is not a pass for the pages.');
  } else {
    browser = await launch(bin);
    const open = async (url, as, width, mode = 'light') => {
      const tab = new Tab(browser.cdp, ctx);
      await tab.open(width, mode);
      tabs.push(tab);
      for (const c of cookies[as] || []) await tab.cdp.send('Network.setCookie', { name: c.name, value: c.value, url: server.base, httpOnly: true }, tab.sid);
      await tab.cdp.send('Page.navigate', { url: server.base + url }, tab.sid);
      return tab;
    };
    const shot = async (tab, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, `${name}.png`), await tab.shoot()); } };
    const noOverflow = (tab) => tab.eval(`(() => { const r = document.querySelector('dialog.space-add').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1; })()`);
    // "+ New <trip>": the switcher's last entry wider than a phone, the phone menu's entry on one.
    const openNew = async (tab, width) => {
      if (width > 640) {
        await tab.waitFor('#spaces-switch');
        await sleep(800);
        await tab.click('#spaces-switch');
        await tab.waitFor('.host-menu-item', 'New trip');
        await tab.click('.host-menu-item', 'New trip');
      } else {
        await tab.waitFor('#nav-toggle');
        await sleep(800);
        await tab.click('#nav-toggle');
        await tab.waitFor('#menu-new-space');
        await sleep(500); // the menu settles before the tap
        await tab.click('#menu-new-space');
      }
      await tab.waitFor('dialog.space-add[open] #space-add-name');
    };
    const menuHasNew = async (tab, width) => {
      if (width > 640) {
        await tab.click('#spaces-switch');
        await sleep(700);
        const has = await tab.eval(`[...document.querySelectorAll('.host-menu-item')].some((b) => /New trip/.test(b.textContent))`);
        await tab.key('Escape');
        return has;
      }
      await tab.click('#nav-toggle');
      await sleep(700);
      return tab.eval(`(() => { const e = document.getElementById('menu-new-space'); return Boolean(e && e.getClientRects().length); })()`);
    };

    for (const width of [1280, 390]) {
      for (const mode of ['light', 'dark']) {
        await test(`a member at ${width} (${mode}): "+ New trip" opens the Add form; it makes a space that is in their switcher`, async () => {
          const tab = await open('/', 'sam', width, mode);
          await openNew(tab, width);
          const d = await tab.eval(`(() => {
            const dlg = document.querySelector('dialog.space-add');
            return {
              title: document.getElementById('space-add-title').textContent,
              focus: document.activeElement === document.getElementById('space-add-name'),
              template: Boolean(document.getElementById('space-add-template')),
              people: [...dlg.querySelectorAll('input[data-member]')].map((b) => b.closest('label').textContent.trim()),
              yours: (document.getElementById('space-add-yours') || {}).textContent || '',
              ok: dlg.querySelector('[data-ok]').textContent,
            };
          })()`);
          assert.equal(d.title, 'Add Trip');
          assert.equal(d.focus, true, 'the keyboard starts on the name');
          assert.equal(d.template, true, 'the Template choice');
          assert.ok(d.people.length >= 2 && !d.people.includes('Helper'), `the environment's people, never an agent: ${d.people}`);
          assert.equal(d.yours, "You'll be its moderator.");
          assert.equal(d.ok, 'Add');
          assert.equal(await noOverflow(tab), true, 'the form fits the screen');
          if (width < 640) {
            // A phone's tap targets: the fields, the people's rows and the two buttons are 44 px tall.
            const low = await tab.eval(`[...document.querySelectorAll('dialog.space-add :is(#space-add-name, #space-add-template, .sdk-choice-row, .sdk-dialog-foot .btn)')].map((e) => [e.id || e.className, Math.round(e.getBoundingClientRect().height)]).filter(([, h]) => h < 44)`);
            assert.deepEqual(low, [], 'every target 44 px tall on a phone');
          }
          const name = `Mine ${width} ${mode}`;
          await tab.eval(`(() => { const i = document.getElementById('space-add-name'); i.value = ${JSON.stringify(name)}; const b = document.querySelector('dialog.space-add input[data-member]'); b.checked = true; })()`);
          await shot(tab, `member-form-${width}-${mode}`);
          await tab.eval(`document.querySelector('dialog.space-add [data-ok]').click()`);
          await tab.waitFor('body.in-space', undefined, 20000);
          await sleep(1500);
          const made = (await api('GET', '/api/presence', undefined, 'sam')).json.spaces.find((x) => x.name === name);
          assert.ok(made && made.mine, 'made, and theirs');
          assert.equal((await me('sam')).spaces[made.id].permissions.moderator, true, 'its moderator');
          assert.equal(await tab.eval(`document.body.classList.contains('setting-up')`), true, 'Set up opens on the new space');
          await shot(tab, `member-made-${width}-${mode}`);
          await tab.close();
          // In the switcher, on the next page.
          if (width > 640) {
            const again = await open('/', 'sam', width, mode);
            await again.waitFor('#spaces-switch');
            await sleep(900);
            await again.click('#spaces-switch');
            await again.waitFor('.host-menu-item', name);
            await again.close();
          }
        });
      }
    }

    for (const width of [1280, 390]) {
      await test(`at ${width}: a refusal reads in the form and nothing is made; Cancel makes nothing`, async () => {
        const tab = await open('/', 'sam', width);
        await openNew(tab, width);
        const before = await count();
        await tab.eval(`(() => { const s = document.getElementById('space-add-template'); s.value = 'games'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await api('PATCH', '/api/settings', { spaceTemplates: false });
        await tab.eval(`document.querySelector('dialog.space-add [data-ok]').click()`);
        await sleep(1200);
        assert.match(await tab.eval(`document.querySelector('dialog.space-add [data-error]').textContent`), /can't use its own template while that is turned off/);
        assert.equal(await tab.eval(`document.querySelector('dialog.space-add [data-ok]').disabled`), false, 'Add can be pressed again');
        await api('PATCH', '/api/settings', { spaceTemplates: true });
        await tab.eval(`document.querySelector('dialog.space-add .sdk-dialog-foot [data-close]').click()`);
        await sleep(500);
        assert.equal(await tab.eval(`Boolean(document.querySelector('dialog.space-add'))`), false, 'closed');
        assert.equal(await count(), before, 'nothing made');
        await tab.close();
      });

      await test(`at ${width}: a moderator has "+ New trip"; a guest has none`, async () => {
        const mod = await open('/', 'mia', width);
        await (width > 640 ? mod.waitFor('#spaces-switch') : mod.waitFor('#nav-toggle'));
        await sleep(900);
        assert.equal(await menuHasNew(mod, width), true, 'a moderator');
        await mod.close();
        const guest = await open(`/guest/${guestLink}`, null, width);
        await sleep(2500);
        assert.equal(await guest.eval(`Boolean(document.getElementById('menu-new-space') && document.getElementById('menu-new-space').getClientRects().length) || [...document.querySelectorAll('.host-menu-item')].some((b) => /New trip/.test(b.textContent)) || Boolean(document.getElementById('spaces-switch') && document.getElementById('spaces-switch').getClientRects().length)`), false, 'a guest');
        await guest.close();
      });

      await test(`at ${width}: Home's Add card (a member) and Manage's Add (the admin) open the same form`, async () => {
        const home = await open('/', 'lee', width);
        await home.waitFor('#home-add-space:not([hidden])');
        await sleep(700);
        await home.eval(`document.getElementById('home-add-space').click()`);
        await home.waitFor('dialog.space-add[open] #space-add-name');
        await home.close();
        const manage = await open('/admin#spaces', 'admin', width);
        await manage.waitFor('#add-space');
        await sleep(900);
        await manage.eval(`document.getElementById('add-space').click()`);
        await manage.waitFor('dialog.space-add[open] #space-add-name');
        assert.equal(await manage.eval(`Boolean(document.getElementById('space-add-yours'))`), false, 'no moderator line for the owner');
        await shot(manage, `manage-form-${width}`);
        await manage.close();
      });
    }
  }
} finally {
  for (const t of tabs) await t.close().catch(() => {});
  if (browser) {
    try { browser.cdp.ws.close(); } catch { /* gone */ }
    try { browser.child.kill(); } catch { /* gone */ }
    try { fs.rmSync(browser.dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  if (server) await stopServer(server);
  fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(failed ? `check-members-make-spaces: ${failed} FAILED, ${n} passed` : `check-members-make-spaces: OK (${n} tests)`);
process.exit(failed ? 1 : 0);
