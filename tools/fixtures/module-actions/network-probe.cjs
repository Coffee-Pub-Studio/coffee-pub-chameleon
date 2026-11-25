'use strict';
// A hostile script for tools/check-module-actions.mjs: run in a process started with the runner's flags (server/
// module-actions.js MODULE_ACTION_RUN_FLAGS), outside any vm context, it tries every way Node has to a socket, against a
// real server listening on 127.0.0.1 (argv[2], its port) and a real unix socket (argv[3], its path). It prints one JSON
// line: each way's outcome, "CONNECTED ..." when something got through, else how it was stopped.
const PORT = Number(process.argv[2]);
const SOCK = process.argv[3];
const out = {};
let current = null;
process.on('uncaughtException', (e) => { if (current) current(`stopped:${(e && (e.code || e.message)) || e}`); });
process.on('unhandledRejection', (e) => { if (current) current(`stopped:${(e && (e.code || e.message)) || e}`); });
const attempt = (name, fn) => new Promise((resolve) => {
  let done = false;
  const end = (v) => { if (!done) { done = true; out[name] = String(v); resolve(); } };
  current = end;
  setTimeout(() => end('stopped:timeout'), 1500);
  try { Promise.resolve(fn(end)).catch((e) => end(`stopped:${(e && (e.code || (e.cause && e.cause.code) || e.message)) || e}`)); } catch (e) { end(`stopped:${e.code || e.message}`); }
});
const socket = (end, s, event = 'connect') => { s.on(event, () => end('CONNECTED')); s.on('error', (e) => end(`stopped:${e.code || e.message}`)); };
(async () => {
  await attempt('tcp', (end) => socket(end, require('node:net').connect(PORT, '127.0.0.1')));
  await attempt('unix', (end) => socket(end, require('node:net').connect(SOCK)));
  await attempt('listen', (end) => { const s = require('node:net').createServer(); s.on('error', (e) => end(`stopped:${e.code}`)); s.listen(0, '127.0.0.1', () => end(`CONNECTED listening on ${s.address().port}`)); });
  await attempt('http', (end) => { const r = require('node:http').get({ host: '127.0.0.1', port: PORT, path: '/' }, (res) => end(`CONNECTED ${res.statusCode}`)); r.on('error', (e) => end(`stopped:${e.code || e.message}`)); });
  await attempt('fetch', async (end) => { const r = await fetch(`http://127.0.0.1:${PORT}/`); end(`CONNECTED ${r.status}`); });
  await attempt('websocket', (end) => { if (typeof WebSocket !== 'function') return end('stopped:none'); const w = new WebSocket(`ws://127.0.0.1:${PORT}/`); w.onopen = () => end('CONNECTED'); w.onerror = () => end('stopped:error'); });
  await attempt('tls', (end) => socket(end, require('node:tls').connect({ port: PORT, host: '127.0.0.1', rejectUnauthorized: false }), 'secureConnect'));
  await attempt('http2', (end) => socket(end, require('node:http2').connect(`http://127.0.0.1:${PORT}`)));
  await attempt('udp', (end) => { const s = require('node:dgram').createSocket('udp4'); s.on('error', (e) => end(`stopped:${e.code}`)); s.send('x', PORT, '127.0.0.1', (e) => end(e ? `stopped:${e.code}` : 'CONNECTED sent')); });
  await attempt('udpBind', (end) => { const s = require('node:dgram').createSocket('udp4'); s.on('error', (e) => end(`stopped:${e.code}`)); s.bind(0, '127.0.0.1', () => end('CONNECTED bound')); });
  await attempt('lookup', (end) => { require('node:dns').lookup('localhost', (e, a) => end(e ? `stopped:${e.code}` : `CONNECTED ${a}`)); });
  await attempt('lookupPromise', async (end) => { const a = await require('node:dns').promises.lookup('localhost'); end(`CONNECTED ${a.address}`); });
  await attempt('resolver', (end) => { const r = new (require('node:dns').Resolver)(); r.setServers([`127.0.0.1:${PORT}`]); r.resolve4('example.com', (e) => end(`CONNECTED asked (${e && e.code})`)); });
  await attempt('inspector', (end) => { const i = require('node:inspector'); i.open(0, '127.0.0.1'); end(`CONNECTED ${i.url()}`); });
  await attempt('signal', (end) => { process.kill(process.pid, 'SIGUSR1'); setTimeout(() => { const url = require('node:inspector').url(); end(url ? `CONNECTED ${url}` : 'stopped:nothing listens'); }, 300); });
  await attempt('binding', (end) => { const b = process.binding('tcp_wrap'); end(`CONNECTED ${typeof b.TCP}`); });
  await attempt('worker', (end) => { new (require('node:worker_threads').Worker)('1', { eval: true }); end('CONNECTED a worker'); });
  await attempt('child', (end) => { require('node:child_process').execFileSync(process.execPath, ['-e', '1']); end('CONNECTED a process'); });
  await attempt('descriptor', (end) => { const s = new (require('node:net').Socket)({ fd: 0 }); end(`CONNECTED opened ${typeof s}`); });
  await attempt('restore', (end) => {
    // Putting a taken-away call back: the prototype's own property can't be written, deleted or redefined.
    const s = new (require('node:net').Socket)();
    s.on('error', () => {});
    try { s.connect(PORT, '127.0.0.1'); } catch (e) { /* its handle is what is wanted */ }
    const proto = s._handle ? Object.getPrototypeOf(s._handle) : null;
    if (!proto) return end('stopped:no handle');
    let changed = false;
    try { proto.connect = () => 0; changed = proto.connect.name !== 'refused'; } catch (e) { /* not writable */ }
    try { delete proto.connect; changed = changed || !Object.prototype.hasOwnProperty.call(proto, 'connect'); } catch (e) { /* not configurable */ }
    try { Object.defineProperty(proto, 'connect', { value: () => 0 }); changed = true; } catch (e) { /* fixed */ }
    end(changed ? 'CONNECTED put back' : 'stopped:fixed');
  });
  current = null;
  process.stdout.write(`${JSON.stringify(out)}\n`, () => process.exit(0));
})();
