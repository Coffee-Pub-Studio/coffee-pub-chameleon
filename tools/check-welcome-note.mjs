#!/usr/bin/env node
/*
 * check-welcome-note.mjs -- the welcome note (GitHub #870), on throwaway servers:
 *   - the owner saves it, a member and a signed-out caller cannot (403, 401); a member and the owner read it;
 *   - cleaning: script tags, javascript:/data: links, headings/quotes/code/numbered lists, hidden characters, over-length,
 *     a non-text value, hostile keys, and a long run of "[" that must not take long; allowed marks and links stay;
 *   - the seen mark is per person and survives a restart; saving a new note does not clear it;
 *   - two environments (BASE_DOMAIN=localhost) keep their own note and marks; a single install (no BASE_DOMAIN) works alike.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let n = 0;
let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    n += 1;
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}\n${err.stack || err}`);
  }
};

async function startServer(dataDir, env = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: '0', DATA_DIR: dataDir, LIVEKIT_API_KEY: 'devkey', LIVEKIT_API_SECRET: 'devsecretdevsecret', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`the server did not start in time:\n${out}`)); }, 20000);
    const onData = () => { const m = /listening on :(\d+)/.exec(out); if (m) { clearTimeout(timer); resolve(Number(m[1])); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`the server stopped (${code}):\n${out}`)); });
  });
  return { port, stop: () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill('SIGTERM'); }) };
}

// host: an environment's slug on a hosted server, or null on a single install.
function call(server, host, method, urlPath, { body, cookie, raw } = {}) {
  const payload = raw !== undefined ? Buffer.from(raw) : body === undefined ? null : Buffer.from(JSON.stringify(body));
  const headers = { host: host ? `${host}.localhost:${server.port}` : `localhost:${server.port}`, accept: 'application/json' };
  if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = payload.length; }
  if (cookie) headers.cookie = cookie;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.port, method, path: urlPath, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, json, text, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const cookieOf = (res) => [].concat(res.headers?.['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
async function signIn(server, host, login, password) {
  const r = await call(server, host, 'POST', host === 'admin' ? '/api/host/login' : '/api/login', { body: { login, password } });
  assert.equal(r.status, 200, `${host} sign-in: ${r.text}`);
  return cookieOf(r);
}
async function addMember(server, host, owner, login) {
  const r = await call(server, host, 'POST', '/api/users', { cookie: owner, body: { login, displayName: login, role: 'member', password: 'member-password-1' } });
  assert.equal(r.status, 201, r.text);
  return signIn(server, host, login, 'member-password-1');
}

const URL_ = '/api/environment/welcome';
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'check-welcome-note-'));
let server = null;
let single = null;
try {
  await test('the cleaner: allowed marks stay, everything else is text', () => {
    const { clean, MAX_NOTE, NoteError } = require(path.join(ROOT, 'server', 'welcome-note.js'));
    const keep = 'Welcome to **our table**.\n\n- *bring* a headset\n- read [the guide](https://example.com/guide?a=1)\n\nMail [us](mailto:hi@example.com).';
    assert.equal(clean(keep), keep);
    assert.equal(clean('<script>alert(1)</script>Hi <b>there</b>').includes('<'), false);
    assert.equal(clean('[x](javascript:alert(1))'), 'x', 'the label stays; the address is gone, and no stray bracket');
    assert.equal(clean('[x](JaVaScRiPt:alert(1))'), 'x');
    // however many marks, no line starts a heading, a quote or a numbered list
    assert.equal(clean('## # x'), 'x');
    assert.equal(clean('> > q'), 'q');
    assert.equal(clean('>#x'), '#x');
    assert.equal(clean('[# h](javascript:x)'), 'h');
    assert.equal(clean('`# h`'), 'h');
    const nasty = ['## # x', '> > q', '>#x', '>  # > 1. a', '# 1) b', '[1. z](bad)', '`> q`', '   ## x', '# ', '>', '1.  a\n2) b\n10. c', '>>> # > 3. d'].join('\n');
    for (const line of clean(nasty).split('\n')) assert.ok(!/^(#{1,3})\s+/.test(line) && !/^\s*>/.test(line) && !/^\s*\d+[.)]\s/.test(line), `a line starts a mark: ${JSON.stringify(line)}`);
    // what markdown() would link but the note does not allow: it is reduced to its words
    const longLabel = 'L'.repeat(201);
    assert.equal(clean(`[${longLabel}](https://example.com/)`), longLabel);
    assert.ok(!clean(`[ok](https://example.com/${'a'.repeat(600)})`).includes('http'), 'a 600-character address is dropped');
    assert.equal(clean(`[ok](https://example.com/${'a'.repeat(600)})`), 'ok');
    assert.ok(!/user:pw/.test(clean('see https://user:pw@evil.com/x now')), 'no credentials in a bare address');
    assert.equal(clean('see https://user:pw@evil.com/x now'), 'see https://evil.com/x now');
    assert.ok(!clean(`go https://example.com/${'b'.repeat(600)}`).includes('http'), 'a very long bare address is not left to be linked');
    assert.equal(clean('[a](https://example.com/x(1))'), 'a', 'an address with a bracket is not a link (markdown() would cut it at the first ")")');
    assert.equal(clean(`[${'L'.repeat(300)}](https://x.com/()`), 'L'.repeat(300), 'an unbalanced bracket: the label only');
    assert.equal(clean('[a](mailto:hi@example.com?subject=x)'), 'a', 'mailto with a ? part is not kept');
    assert.equal(clean('[a](mailto:hi@example.com)'), '[a](mailto:hi@example.com)');
    assert.equal(clean('[a](mailto:)'), 'a');
    // ordinary text with < and > keeps them; real tags still go
    assert.equal(clean('x < y and z > w'), 'x < y and z > w');
    assert.equal(clean('I <3 you'), 'I <3 you');
    assert.equal(clean('a <b>bold</b> <img src=x onerror=alert(1)> c').includes('<'), false);
    assert.equal(clean('a\uE000b'), 'ab', 'the private stand-in character cannot be planted');
    assert.equal(clean('[x](data:text/html;base64,AAAA)'), 'x');
    assert.ok(!/\]\(javascript:/i.test(clean('[x](java\tscript:alert(1))')), 'a tab in the scheme does not make it javascript:');
    assert.equal(clean('[x](//evil.example/a)'), 'x');
    assert.equal(clean('[x](https://user:pw@example.com/)'), 'x');
    assert.equal(clean('# Title\n> quoted\n1. one\n```\ncode `x`\n```'), 'Title\nquoted\n1: one\ncode x');
    assert.equal(clean('a​b‮c﻿d'), 'abcd', 'hidden characters go');
    assert.equal(clean('a\r\nb'), 'a\nb');
    assert.equal(clean('  \n\n '), '');
    assert.equal(clean(null), '');
    assert.throws(() => clean('x'.repeat(MAX_NOTE + 1)), NoteError);
    assert.equal(clean('x'.repeat(MAX_NOTE)).length, MAX_NOTE);
    assert.throws(() => clean({ text: 'x' }), NoteError);
    assert.throws(() => clean(['x']), NoteError);
    const t = Date.now();
    clean('['.repeat(3900) + '](' + 'a'.repeat(50));
    clean('[a](' .repeat(900));
    clean('<'.repeat(MAX_NOTE));
    assert.ok(Date.now() - t < 1500, 'crafted text is cleaned quickly');
  });

  // Inputs for the next two tests.
  const HIDDEN = ['​', '­', '⁠', '﻿'];
  const cases = [
    '<script>alert(1)</script>Hi <b>there</b>', '<​script>alert(1)</​script>', '<­img src=x onerror=alert(1)>',
    ...HIDDEN.map((h) => `<${h}script>alert(1)`), ...HIDDEN.map((h) => `a <${h}img src=x onerror=alert(1)> b`),
    ...HIDDEN.map((h) => `<${h}/b>`), ...HIDDEN.map((h) => `<${h}!--x`), ...HIDDEN.map((h) => `<${h}?x`),
    '<​­⁠﻿a', '<<a', '<<​a', '< a', 'x < y and z > w', 'I <3 you', '<`a', '<[a](bad)', 'a <b',
    '<'.repeat(50) + 'a', '[a](https://example.com/x(1))', `[${'L'.repeat(300)}](https://x.com/()`, '[a](https://example.com/)',
    '[a](mailto:hi@example.com)', '[a](mailto:hi@example.com?subject=x)', '[a](mailto:hi@example.com?cc=b@c.d)', '[a](mailto:)', '[a](mailto:a b@c.d)',
    '[x](javascript:alert(1))', '[x](https://user:pw@example.com/)', '[x](https://example.com/a b)', '[x](https://example.com/a))', '[x](https://example.com/a)) b',
    '[x]((https://example.com/a))', '[x](https://example.com/a(b)c)', 'see https://example.com/x(1) now', '(https://example.com/a)', '[`a`](https://example.com/)',
    '[a](https://example.com/​)', '[a](https://exa​mple.com/)', '[a](ht​tps://example.com/)', '[**b**](https://example.com/_x_)', '- [a](https://example.com/)\n- [b](mailto:x@y.z)',
    'https://example.com/path?q=1&r="2"', 'a ```\nb\n```', '#​# x', '>​> q',
  ];
  // The same small alphabet, a fixed pseudo-random order.
  const pieces = ['<', '>', 'a', 'b', '/', '!', '?', ...HIDDEN, '`', '[', ']', '(', ')', ' ', '\n', '#', 'h', 'ttp', ':', '//', '.', 'mailto:', 'https://', '@', '*', '-', '1.', '"', '&', 'x'];
  let seed = 12345;
  const rand = (m) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % m; };
  for (let i = 0; i < 4000; i += 1) cases.push(Array.from({ length: 1 + rand(14) }, () => pieces[rand(pieces.length)]).join(''));

  await test('the cleaner is idempotent and leaves no "<" that could open a tag', () => {
    const { clean } = require(path.join(ROOT, 'server', 'welcome-note.js'));
    assert.equal(clean('<​script>alert(1)</​script>').includes('<'), false);
    assert.equal(clean('<­img src=x onerror=alert(1)>').includes('<'), false);
    for (const x of cases) {
      const once = clean(x);
      assert.equal(clean(once), once, `not idempotent for ${JSON.stringify(x)}: ${JSON.stringify(once)} then ${JSON.stringify(clean(once))}`);
      assert.ok(!/<[A-Za-z/!?]/.test(once), `a tag opener is left for ${JSON.stringify(x)}: ${JSON.stringify(once)}`);
    }
    for (const h of HIDDEN) assert.ok(!/<[A-Za-z/!?]/.test(clean(`<${h}a <${h}/b <${h}!c <${h}?d`)), `hidden U+${h.charCodeAt(0).toString(16)} after "<"`);
  });

  await test('every link markdown() draws from a cleaned note is one the cleaner kept', () => {
    const { clean } = require(path.join(ROOT, 'server', 'welcome-note.js'));
    const src = fs.readFileSync(path.join(ROOT, 'public', 'sdk', 'host.js'), 'utf8');
    const win = { addEventListener() {}, location: { search: "" } };
    win.parent = win;
    new Function('window', 'document', src)(win, { createElement: (tag) => ({ tag }) });
    const markdown = win.hostText.markdown;
    const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    let links = 0;
    for (const x of cases) {
      const text = clean(x);
      const kept = [...text.matchAll(/\[([^\]\n]+)\]\(([^\s)]*)\)/g)].filter((m) => m[1].length <= 200 && m[2].length <= 500 && !/[()]/.test(m[2])).map((m) => [m[1], m[2]]);
      for (const m of markdown(text).matchAll(/<a href="([^"]*)"[^>]*>(.*?)<\/a>/g)) {
        const href = unesc(m[1]);
        links += 1;
        assert.ok(href.length <= 500, `a link of ${href.length} characters for ${JSON.stringify(x)}`);
        assert.ok(!/^https?:\/\/[^\s/?#]*@/i.test(href), `credentials in ${href}`);
        assert.ok(/^(?:https?:\/\/|mailto:[^\s?]+$)/.test(href), `an address that is not allowed: ${href}`);
        // a link the cleaner kept as [label](address), or a bare address in the text (its own words, held to the same limits above)
        const bare = unesc(m[2]) === href;
        assert.ok(bare || kept.some(([label, address]) => address === href && label.length <= 200), `markdown() linked ${href} for ${JSON.stringify(x)}; the cleaner kept ${JSON.stringify(text)}`);
      }
    }
    assert.ok(links > 10, 'the list draws some links');
  });

  await test('the defaults are untouched and carry no note', () => {
    const store = require(path.join(ROOT, 'server', 'store.js'));
    assert.equal(store.DEFAULT_SETTINGS.welcomeNote, null);
    assert.throws(() => { store.DEFAULT_SETTINGS.welcomeNote = {}; }, TypeError);
  });

  const hostEnv = { BASE_DOMAIN: 'localhost', ADMIN_LOGIN: 'boss', ADMIN_PASSWORD: 'host-password-1' };
  const dataDir = path.join(base, 'hosted');
  server = await startServer(dataDir, hostEnv);
  const host = await signIn(server, 'admin', 'boss', 'host-password-1');
  for (const slug of ['acme', 'beta']) {
    const made = await call(server, 'admin', 'POST', '/api/host/environments', { cookie: host, body: { slug, name: slug, owner: { login: 'owner', password: 'owner-password-1' } } });
    assert.equal(made.status, 201, made.text);
  }
  let acmeOwner = await signIn(server, 'acme', 'owner', 'owner-password-1');
  let betaOwner = await signIn(server, 'beta', 'owner', 'owner-password-1');
  let ann = await addMember(server, 'acme', acmeOwner, 'ann');
  let bob = await addMember(server, 'acme', acmeOwner, 'bob');
  let bea = await addMember(server, 'beta', betaOwner, 'ann'); // the same login in another environment

  await test('no note yet: read as { note: null, seen: false }', async () => {
    const r = await call(server, 'acme', 'GET', URL_, { cookie: ann });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, { note: null, seen: false, guest: false, maxLength: 4000 });
  });

  await test('signed out: 401 on all three', async () => {
    assert.equal((await call(server, 'acme', 'GET', URL_)).status, 401);
    assert.equal((await call(server, 'acme', 'PUT', URL_, { body: { text: 'x' } })).status, 401);
    assert.equal((await call(server, 'acme', 'POST', `${URL_}/seen`)).status, 401);
  });

  await test('a member cannot save; the note stays unwritten', async () => {
    const r = await call(server, 'acme', 'PUT', URL_, { cookie: ann, body: { text: 'Hello' } });
    assert.equal(r.status, 403, r.text);
    assert.equal(typeof r.json.error, 'string');
    assert.equal((await call(server, 'acme', 'GET', URL_, { cookie: bob })).json.note, null);
  });

  await test('the owner saves; a member reads it; the answer is cleaned', async () => {
    const text = 'Welcome!\n\n- **Chat** is on the left\n- [Guide](https://example.com/g)\n\n<script>alert(1)</script>[bad](javascript:alert(1))';
    const r = await call(server, 'acme', 'PUT', URL_, { cookie: acmeOwner, body: { text } });
    assert.equal(r.status, 200, r.text);
    assert.ok(!r.json.note.text.includes('<'));
    assert.ok(!r.json.note.text.includes('](javascript'));
    assert.ok(r.json.note.text.includes('- **Chat** is on the left'));
    assert.ok(r.json.note.text.includes('[Guide](https://example.com/g)'));
    assert.equal(r.json.seen, false);
    const read = await call(server, 'acme', 'GET', URL_, { cookie: ann });
    assert.deepEqual(read.json.note, r.json.note);
    assert.equal(read.headers['cache-control'], 'no-store');
  });

  await test('refusals: over-length 400, not text 400, no text field 400, with one sentence', async () => {
    const long = await call(server, 'acme', 'PUT', URL_, { cookie: acmeOwner, body: { text: 'x'.repeat(4001) } });
    assert.deepEqual([long.status, long.json], [400, { error: 'The welcome note is at most 4000 characters.' }]);
    const num = await call(server, 'acme', 'PUT', URL_, { cookie: acmeOwner, body: { text: 5 } });
    assert.deepEqual([num.status, num.json], [400, { error: 'The welcome note is text.' }]);
    const none = await call(server, 'acme', 'PUT', URL_, { cookie: acmeOwner, body: { other: 1 } });
    assert.equal(none.status, 400);
    const hostile = await call(server, 'acme', 'PUT', URL_, { cookie: acmeOwner, raw: '{"__proto__":{"admin":true},"constructor":{"x":1},"text":"kept"}' });
    assert.equal(hostile.status, 200, hostile.text);
    assert.equal(hostile.json.note.text, 'kept');
    assert.equal({}.admin, undefined);
    const again = await call(server, 'acme', 'GET', URL_, { cookie: ann });
    assert.equal(again.json.note.text, 'kept', 'a refused save leaves the note as it was');
    const refused = await call(server, 'acme', 'PUT', URL_, { cookie: acmeOwner, body: { text: 'y'.repeat(5000) } });
    assert.equal(refused.status, 400);
    assert.equal((await call(server, 'acme', 'GET', URL_, { cookie: ann })).json.note.text, 'kept');
  });

  await test('the seen mark is per person', async () => {
    assert.equal((await call(server, 'acme', 'GET', URL_, { cookie: ann })).json.seen, false);
    const mark = await call(server, 'acme', 'POST', `${URL_}/seen`, { cookie: ann });
    assert.equal(mark.status, 200, mark.text);
    assert.equal(mark.json.seen, true);
    assert.equal((await call(server, 'acme', 'GET', URL_, { cookie: ann })).json.seen, true);
    assert.equal((await call(server, 'acme', 'GET', URL_, { cookie: bob })).json.seen, false, 'bob has not read it');
    assert.equal((await call(server, 'acme', 'GET', URL_, { cookie: acmeOwner })).json.seen, false);
    assert.equal((await call(server, 'acme', 'POST', `${URL_}/seen`, { cookie: ann })).status, 200, 'marking twice is fine');
  });

  await test('a new text does not ask anyone again', async () => {
    assert.equal((await call(server, 'acme', 'PUT', URL_, { cookie: acmeOwner, body: { text: 'Second' } })).status, 200);
    assert.equal((await call(server, 'acme', 'GET', URL_, { cookie: ann })).json.seen, true);
  });

  await test('another environment never sees the note or the mark', async () => {
    const r = await call(server, 'beta', 'GET', URL_, { cookie: bea });
    assert.deepEqual(r.json, { note: null, seen: false, guest: false, maxLength: 4000 });
    assert.equal((await call(server, 'beta', 'GET', URL_, { cookie: betaOwner })).json.note, null);
    // an acme session means nothing in beta
    assert.equal((await call(server, 'beta', 'GET', URL_, { cookie: ann })).status, 401);
    assert.equal((await call(server, 'beta', 'PUT', URL_, { cookie: acmeOwner, body: { text: 'from acme' } })).status, 401);
    assert.equal((await call(server, 'beta', 'PUT', URL_, { cookie: betaOwner, body: { text: 'Beta only' } })).status, 200);
    assert.equal((await call(server, 'acme', 'GET', URL_, { cookie: bob })).json.note.text, 'Second');
    assert.equal((await call(server, 'beta', 'GET', URL_, { cookie: bea })).json.seen, false, 'beta\'s ann is not acme\'s ann');
    assert.equal((await call(server, 'beta', 'POST', `${URL_}/seen`, { cookie: bea })).status, 200);
    assert.equal((await call(server, 'acme', 'GET', URL_, { cookie: bob })).json.seen, false);
  });

  await test('the owner may remove the note', async () => {
    assert.equal((await call(server, 'beta', 'PUT', URL_, { cookie: betaOwner, body: { text: '   ' } })).json.note, null);
    assert.equal((await call(server, 'beta', 'GET', URL_, { cookie: bea })).json.note, null);
  });

  await test('the note and the marks survive a restart, each environment its own', async () => {
    await server.stop();
    server = await startServer(dataDir, hostEnv);
    acmeOwner = await signIn(server, 'acme', 'owner', 'owner-password-1');
    ann = await signIn(server, 'acme', 'ann', 'member-password-1');
    bob = await signIn(server, 'acme', 'bob', 'member-password-1');
    bea = await signIn(server, 'beta', 'ann', 'member-password-1');
    assert.equal((await call(server, 'acme', 'GET', URL_, { cookie: ann })).json.note.text, 'Second');
    assert.equal((await call(server, 'acme', 'GET', URL_, { cookie: ann })).json.seen, true);
    assert.equal((await call(server, 'acme', 'GET', URL_, { cookie: bob })).json.seen, false);
    assert.equal((await call(server, 'beta', 'GET', URL_, { cookie: bea })).json.note, null);
    assert.equal((await call(server, 'beta', 'GET', URL_, { cookie: bea })).json.seen, true);
    // a third environment starts clean
    const made = await call(server, 'admin', 'POST', '/api/host/environments', { cookie: await signIn(server, 'admin', 'boss', 'host-password-1'), body: { slug: 'gamma', name: 'gamma', owner: { login: 'owner', password: 'owner-password-1' } } });
    assert.equal(made.status, 201, made.text);
    const g = await signIn(server, 'gamma', 'owner', 'owner-password-1');
    assert.deepEqual((await call(server, 'gamma', 'GET', URL_, { cookie: g })).json, { note: null, seen: false, guest: false, maxLength: 4000 });
  });

  // A single install: no BASE_DOMAIN.
  single = await startServer(path.join(base, 'single'), { ADMIN_PASSWORD: 'testpass1234', ENABLE_GUEST_DOOR: 'true' });
  await test('a single install: owner saves, member reads and marks, a door guest reads and is not stored', async () => {
    const owner = await signIn(single, null, 'admin', 'testpass1234');
    const mem = await addMember(single, null, owner, 'sam');
    assert.equal((await call(single, null, 'PUT', URL_, { cookie: mem, body: { text: 'no' } })).status, 403);
    assert.equal((await call(single, null, 'PUT', URL_, { cookie: owner, body: { text: 'Hi **all**' } })).status, 200);
    assert.deepEqual((await call(single, null, 'GET', URL_, { cookie: mem })).json.note.text, 'Hi **all**');
    assert.equal((await call(single, null, 'POST', `${URL_}/seen`, { cookie: mem })).json.seen, true);
    assert.equal((await call(single, null, 'GET', URL_, { cookie: mem })).json.seen, true);
    const door = await call(single, null, 'POST', '/api/guest-door', { body: { name: 'Dora' } });
    assert.equal(door.status, 201, `the guest door is on: ${door.text}`);
    const g = cookieOf(door);
    const read = await call(single, null, 'GET', URL_, { cookie: g });
    assert.equal(read.status, 200, read.text);
    assert.deepEqual([read.json.note.text, read.json.seen, read.json.guest], ['Hi **all**', false, true]);
    assert.equal((await call(single, null, 'PUT', URL_, { cookie: g, body: { text: 'x' } })).status, 401, 'a guest may not write');
    const gs = await call(single, null, 'POST', `${URL_}/seen`, { cookie: g });
    assert.equal(gs.status, 200, gs.text);
    assert.deepEqual([gs.json.seen, gs.json.guest], [true, true]);
    assert.equal((await call(single, null, 'GET', URL_, { cookie: g })).json.seen, false, 'a guest\'s mark is not stored');
    assert.equal((await call(single, null, 'GET', URL_)).status, 401, 'nobody is refused');
  });

  await test('a stored note is cleaned on load: markup, oversize and wrong types never reach a reader', async () => {
    await single.stop();
    const file = path.join(base, 'single', 'app.json');
    const app = JSON.parse(fs.readFileSync(file, 'utf8'));
    app.settings.welcomeNote = { text: `<img src=x onerror=alert(1)>\n# H\n[j](javascript:alert(1))${'z'.repeat(20000)}`, updatedAt: { evil: 1 }, by: ['x'] };
    fs.writeFileSync(file, JSON.stringify(app));
    single = await startServer(path.join(base, 'single'), { ADMIN_PASSWORD: 'testpass1234', ENABLE_GUEST_DOOR: 'true' });
    let owner = await signIn(single, null, 'admin', 'testpass1234');
    let r = await call(single, null, 'GET', URL_, { cookie: owner });
    assert.deepEqual(r.json.note, null, 'an oversize stored note is dropped');
    await single.stop();
    app.settings.welcomeNote = { text: `<img src=x onerror=alert(1)>\n# H\n[j](javascript:alert(1)) ${'z'.repeat(20)}`, updatedAt: { evil: 1 }, by: ['x'] };
    fs.writeFileSync(file, JSON.stringify(app));
    single = await startServer(path.join(base, 'single'), { ADMIN_PASSWORD: 'testpass1234', ENABLE_GUEST_DOOR: 'true' });
    owner = await signIn(single, null, 'admin', 'testpass1234');
    r = await call(single, null, 'GET', URL_, { cookie: owner });
    assert.deepEqual(r.json.note, { text: `H\nj ${'z'.repeat(20)}`, updatedAt: null });
    app.settings.welcomeNote = 'not an object';
    await single.stop();
    fs.writeFileSync(file, JSON.stringify(app));
    single = await startServer(path.join(base, 'single'), { ADMIN_PASSWORD: 'testpass1234', ENABLE_GUEST_DOOR: 'true' });
    owner = await signIn(single, null, 'admin', 'testpass1234');
    assert.equal((await call(single, null, 'GET', URL_, { cookie: owner })).json.note, null);
  });
} catch (err) {
  failed += 1;
  console.error(`FAIL setting up\n${err.stack || err}`);
} finally {
  if (server) await server.stop();
  if (single) await single.stop();
  fs.rmSync(base, { recursive: true, force: true });
}

if (failed) {
  console.error(`check-welcome-note: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-welcome-note: ${n} passed`);
