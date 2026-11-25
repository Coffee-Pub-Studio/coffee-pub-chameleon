'use strict';
// Loaded before anything else in a run's process (server/module-actions.js runFlags: --require), so whatever script then
// runs there, the worker or a library that got out of its vm context, finds no way to open a socket through Node itself
// (GitHub #1100: Node 22's permission model covers files, child processes, workers and addons, but not sockets).
//
// It takes the socket calls off the handle classes every network API in Node ends at (net, tls, http, http2, fetch and
// WebSocket all open a TCP or Pipe handle; dgram a UDP one; the resolver a channel of its own), replacing each with a
// function that throws, fixed so it can't be put back, and takes away the few other ways to a socket: the name lookups
// that go straight to the system's resolver, the inspector (which listens on a port), signals to itself (SIGUSR1 starts
// the inspector), the old process.binding, and V8 flags set at run time. The originals are held nowhere afterwards.
//
// What this is and is not. It is Node's own surface closed from the inside: JavaScript running anywhere in this process
// has no function left that connects, listens, sends or looks a name up. It is not a kernel boundary: a flaw in Node or
// V8 that runs machine code, or a way to a fresh internal binding this file does not know of, is not held by it. That is
// what the network namespace is for, where the kernel allows one (server/module-actions.js networkSeal).
const net = require('node:net');
const dgram = require('node:dgram');
const dns = require('node:dns');

const denied = (what) => function refused() {
  const err = new Error(`No network here: ${what} is not allowed in this process.`);
  err.code = 'ERR_ACCESS_DENIED';
  throw err;
};
const fix = (target, name, value) => {
  try { Object.defineProperty(target, name, { value, writable: false, configurable: false, enumerable: true }); return true; } catch { return false; }
};
// Every function a handle class answers to, on the class's own prototype (never the shared stream base under it, which
// stdin and stdout still read and write through).
const sealPrototype = (handle, what, keep = []) => {
  const proto = handle ? Object.getPrototypeOf(handle) : null;
  if (!proto || proto === Object.prototype) return false;
  let all = true;
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === 'constructor' || keep.includes(name)) continue;
    let own;
    try { own = Object.getOwnPropertyDescriptor(proto, name); } catch { own = null; }
    if (own && typeof own.value === 'function' && !fix(proto, name, denied(what))) all = false;
  }
  return all;
};

const sealed = { tcp: false, pipe: false, udp: false, resolver: false };

// stdin and stdout are pipes from the parent, opened through the Pipe class: opened now, before `open` is taken away.
try { void process.stdin; } catch { /* no stdin */ }
try { void process.stdout; } catch { /* no stdout */ }
try { void process.stderr; } catch { /* no stderr */ }

// A TCP handle: a socket makes its handle as soon as it is asked to connect and only connects a tick later, so it is
// destroyed before it ever does.
try {
  const s = new net.Socket();
  s.on('error', () => {});
  try { s.connect({ host: '127.0.0.1', port: 9 }); } catch { /* the handle is what matters */ }
  const handle = s._handle;
  sealed.tcp = sealPrototype(handle, 'a TCP socket', ['close']);
  s.destroy();
} catch { /* reported below */ }
// A Pipe handle (a unix socket, as Docker's own is): the same way, asked for a path that is not there.
try {
  const s = new net.Socket();
  s.on('error', () => {});
  try { s.connect({ path: '/nonexistent/no-socket-here' }); } catch { /* the handle is what matters */ }
  const handle = s._handle;
  sealed.pipe = sealPrototype(handle, 'a unix socket', ['close']);
  s.destroy();
} catch { /* reported below */ }
// A UDP handle: a datagram socket holds one from the start, unbound.
try {
  const s = dgram.createSocket('udp4');
  s.on('error', () => {});
  const state = Object.getOwnPropertySymbols(s).map((k) => s[k]).find((v) => v && typeof v === 'object' && v.handle);
  sealed.udp = sealPrototype(state && state.handle, 'a UDP socket', ['close']);
  try { s.close(); } catch { /* never bound */ }
} catch { /* reported below */ }
// The resolver's channel (its own sockets, not the classes above).
try {
  const r = new dns.Resolver();
  sealed.resolver = sealPrototype(r._handle, 'a name lookup', ['cancel']);
  try { r.cancel(); } catch { /* nothing asked */ }
} catch { /* reported below */ }

// The lookups that go to the system's resolver (getaddrinfo, getnameinfo), which no class above stands in front of.
for (const target of [dns, dns.promises]) {
  for (const name of ['lookup', 'lookupService']) fix(target, name, denied('a name lookup'));
}
// The inspector listens on a port; a signal to itself (SIGUSR1) starts it where --disable-sigusr1 is not there.
try {
  const inspector = require('node:inspector');
  for (const name of ['open', 'waitForDebugger']) fix(inspector, name, denied('the inspector'));
} catch { /* built without one */ }
for (const name of ['kill', '_kill', '_debugProcess', '_debugEnd', '_startProfilerIdleNotifier', 'binding', '_linkedBinding', 'dlopen']) {
  if (name in process) fix(process, name, denied(`process.${name}`));
}
try { fix(require('node:v8'), 'setFlagsFromString', denied('a V8 flag')); } catch { /* not there */ }

// Nothing half-closed is ever run in: a process that could not close all four says so and ends.
if (!sealed.tcp || !sealed.pipe || !sealed.udp || !sealed.resolver) {
  try { process.stdout.write(`${JSON.stringify({ fault: 'network' })}\n`); } catch { /* nowhere to say it */ }
  process.exit(70);
}
