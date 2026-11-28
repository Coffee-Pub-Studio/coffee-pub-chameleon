// The one place the checks start a headless Chrome from, so one that is killed never leaves a browser behind.
//   startBrowser(bin, args, dir)  starts it in a process group of its own and returns the child process
//   launchBrowser(bin, flags, prefix)  starts it, waits up to 60 s for its DevTools address, retries the start once; returns { child, dir, url }
//   stopBrowser(child, dir)       closes the browser (the whole group) and deletes its profile folder `dir`
// What this guarantees (see tools/check-browser-orphans.mjs):
//   - normal end, uncaught error: an 'exit' handler kills every browser this process started
//   - SIGTERM, SIGINT, SIGHUP: the same, then the process exits with the signal's code
//   - SIGKILL of the check (nothing can run): a small watchdog process (tools/browser-watchdog.mjs), started beside the browser,
//     sees the check is gone and kills that browser's group within about a second. Linux only (it reads /proc).
// Only the group this helper started is ever killed: its leader is the browser child, and the kill is by that group id.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

export { BROWSER_PROFILE_PREFIXES } from './browser-profiles.mjs';

const live = new Map(); // key -> { pid, dir }: the browsers this process started and has not seen end (pid is 0 when it never started)
const WATCHDOG = path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'browser-watchdog.mjs');

function killGroup(pid, signal) {
  try { process.kill(-pid, signal); return true; } catch { return false; } // false: no such group
}
function rm(dir) { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* a temp folder left behind is harmless */ } }

function cleanupNow() {
  for (const { pid, dir } of live.values()) { if (pid) killGroup(pid, 'SIGKILL'); rm(dir); }
  live.clear();
}
process.on('exit', cleanupNow);
for (const [sig, code] of [['SIGTERM', 143], ['SIGINT', 130], ['SIGHUP', 129]]) {
  process.on(sig, () => { try { cleanupNow(); } finally { process.exit(code); } });
}

export const liveBrowsers = () => live.size; // for tools/check-browser-orphans.mjs

export function startBrowser(bin, args, dir) {
  const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], detached: true }); // detached: its own process group
  const key = Symbol('browser');
  live.set(key, { pid: child.pid || 0, dir }); // registered even when it did not start, so its folder is still removed
  child.on('error', () => { /* the caller's 'exit' or timeout handling reports it */ });
  child.once('exit', () => { // renderers left in the group go with it; then the entry is gone, so nothing later signals a stale group
    if (child.pid) killGroup(child.pid, 'SIGKILL');
    live.delete(key);
    rm(dir);
  });
  if (!child.pid) return child;
  if (fs.existsSync('/proc/self/stat')) {
    const dog = spawn(process.execPath, [WATCHDOG, String(process.pid), String(child.pid), dir], { stdio: 'ignore', detached: true });
    dog.on('error', () => { /* no watchdog: the in-process handlers still run */ });
    dog.unref();
  }
  return child;
}

export async function stopBrowser(child, dir) {
  if (!child) return;
  const exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise((r) => child.once('exit', r));
  if (child.pid) {
    killGroup(child.pid, 'SIGTERM');
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    killGroup(child.pid, 'SIGKILL'); // whatever is still in the group
  }
  if (dir) { await new Promise((r) => setTimeout(r, 100)); rm(dir); }
}

// The flags every check's browser needs on a CI runner: headless, no sandbox (a container runs as root), no GPU, /tmp not /dev/shm for
// shared memory (a runner's /dev/shm is small), no first-run work, a DevTools port chosen by the browser.
export const CI_FLAGS = ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars', '--no-first-run', '--remote-debugging-port=0'];

// Start the browser and wait for its "DevTools listening on ws://..." line. A runner can be slow to start it (the first start after
// a cold cache took over 20 s), so the wait is 60 s, and a start that fails or times out is tried once more with a fresh profile.
// `flags` are the extra flags beyond CI_FLAGS; `prefix` names the profile folder under os.tmpdir() (listed in browser-profiles.mjs).
// On Windows Edge needs --edge-skip-compat-layer-relaunch (else it relaunches itself and the child we hold ends), and its DevTools
// address is read from the DevToolsActivePort file in the profile folder (line 1: the port, line 2: the path) instead of stderr.
export const WINDOWS_FLAGS = ['--edge-skip-compat-layer-relaunch'];

// The ws:// address from the DevToolsActivePort file in `dir`, or '' while it is not there or not complete yet.
export function readDevToolsActivePort(dir) {
  try {
    const [port, wsPath] = fs.readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split(/\r?\n/);
    return /^\d+$/.test(port) && wsPath ? `ws://127.0.0.1:${port}${wsPath}` : '';
  } catch { return ''; }
}

export async function launchBrowser(bin, flags, prefix, { timeoutMs = 60000, attempts = 2 } = {}) {
  let last;
  for (let i = 1; i <= attempts; i += 1) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const win = process.platform === 'win32';
    const child = startBrowser(bin, [...CI_FLAGS, ...(win ? WINDOWS_FLAGS : []), ...flags, `--user-data-dir=${dir}`, 'about:blank'], dir);
    try {
      const url = await new Promise((resolve, reject) => {
        let buf = '';
        let poll;
        const t = setTimeout(() => { clearInterval(poll); reject(new Error(`the browser did not start in ${timeoutMs / 1000} s: ` + buf.slice(-300))); }, timeoutMs);
        if (win) {
          poll = setInterval(() => { const u = readDevToolsActivePort(dir); if (u) { clearTimeout(t); clearInterval(poll); resolve(u); } }, 100);
          child.stderr.on('data', (d) => { buf += d; }); // kept only for the error message
        } else {
          child.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(t); resolve(m[1]); } });
        }
        child.on('exit', (c) => { clearTimeout(t); clearInterval(poll); reject(new Error('the browser exited (' + c + '): ' + buf.slice(-300))); });
      });
      return { child, dir, url };
    } catch (e) {
      last = e;
      await stopBrowser(child, dir); // a browser that did not start is not left running
    }
  }
  throw last;
}
