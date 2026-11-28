#!/usr/bin/env node
/*
 * check-emit-snapshot.mjs -- the SDK delivers an event to the handlers that were there when it began (public/sdk/host.js, emit).
 * A handler added while an event is delivered does not hear that event; a handler removed meanwhile still hears it. Without
 * that, a click handler that destroys and remakes a toolbar button with the same id (host.ui.toolbarButton, host.ui.viewSwitch)
 * gave the new handler the click that made it (a Present that starts and stops at once, a Paste that pastes twice).
 * Run in Node on a stand-in host: the SDK's createHost with a call that answers nothing and a page with no elements.
 * Usage: node tools/check-emit-snapshot.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sdk = fs.readFileSync(path.join(ROOT, 'public/sdk/host.js'), 'utf8');
const win = { addEventListener() {}, location: { search: '' } };
win.parent = win;
const noop = () => {};
const el = () => new Proxy(function () {}, { get: (t, k) => (k === 'style' ? {} : k === 'classList' ? { add: noop, remove: noop } : noop), set: () => true });
const doc = { createElement: el, documentElement: el(), head: el(), body: el(), querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener: noop };
new Function('window', 'document', sdk)(win, doc);
assert.equal(typeof win.createHost, 'function', 'the SDK offers createHost to a page');

let n = 0;
const ok = (cond, label) => { assert.ok(cond, label); n += 1; };
const make = () => win.createHost({ call: () => Promise.resolve(true), root: doc, rootElement: doc.documentElement, elementAt: () => null, applyTheme: noop });

// (a) a handler added during a delivery misses that event and hears the next one.
{
  const { host, emit } = make();
  const heard = [];
  host.on('ping', () => { heard.push('first'); host.on('ping', () => heard.push('late')); });
  emit('ping', {});
  ok(heard.join() === 'first', `(a) a handler added during delivery heard that event: ${heard.join()}`);
  emit('ping', {});
  ok(heard.includes('late'), '(a) the added handler hears the next event');
}

// (b) a toolbar button destroyed and remade with the same id in its own onClick fires once per click.
{
  const { host, emit } = make();
  let clicks = 0;
  let button;
  const make1 = () => host.ui.toolbarButton({ id: 'go', label: 'Go', onClick: () => { clicks += 1; button.destroy(); button = make1(); } });
  button = make1();
  emit('toolbar', { id: 'go' });
  ok(clicks === 1, `(b) one click ran onClick ${clicks} times`);
  emit('toolbar', { id: 'go' });
  ok(clicks === 2, `(b) the second click ran onClick ${clicks - 1} times`);
}

// (c) the same for a view switch and its onChange.
{
  const { host, emit } = make();
  let changes = 0;
  let sw;
  const make1 = () => host.ui.viewSwitch({ id: 'view', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], value: 'a', onChange: () => { changes += 1; sw.destroy(); sw = make1(); } });
  sw = make1();
  emit('toolbar', { id: 'view', value: 'b' });
  ok(changes === 1, `(c) one change ran onChange ${changes} times`);
  emit('toolbar', { id: 'view', value: 'a' });
  ok(changes === 2, `(c) the second change ran onChange ${changes - 1} times`);
}

// (d) a handler removed during a delivery still hears that event, and not the next.
{
  const { host, emit } = make();
  const heard = [];
  let off2;
  host.on('ping', () => { heard.push('one'); off2(); });
  off2 = host.on('ping', () => heard.push('two'));
  emit('ping', {});
  ok(heard.join() === 'one,two', `(d) a handler removed during delivery: heard ${heard.join()}`);
  emit('ping', {});
  ok(heard.join() === 'one,two,one', `(d) the removed handler heard the next event: ${heard.join()}`);
}

console.log(`check-emit-snapshot: ok (${n} checks)`);
