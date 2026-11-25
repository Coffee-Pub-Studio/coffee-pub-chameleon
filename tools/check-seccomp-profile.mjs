#!/usr/bin/env node
/**
 * check-seccomp-profile.mjs -- the deploy's seccomp profile (documentation/plans/plan-agent-server-actions.md, decision 3,
 * section 10, step 11a).
 *
 * `deploy/seccomp-action-runner.json` lets the action runner make its network namespace (`unshare -rn`) in a Docker
 * container. It must be Docker's default profile, taken whole from a named moby release (kept beside this check in
 * tools/fixtures/seccomp/, pinned by its SHA-256 here), plus exactly one rule: `unshare` allowed only when its flags hold
 * nothing but CLONE_NEWUSER and CLONE_NEWNET. This check fails when:
 *   - the profile does not parse, or the recorded moby copy is not the pinned one;
 *   - the profile is anything but the moby default plus that one rule (every other key and rule equal, in order);
 *   - the added rule allows a flag other than CLONE_NEWUSER and CLONE_NEWNET, names another call, or holds a condition
 *     (capability, architecture) that narrows or widens it;
 *   - docker-compose.yml does not set ACTION_RUNNER_NETWORK to namespace, does not point at this very file in its
 *     commented security_opt block, or offers `seccomp=unconfined`, `privileged` or `SYS_ADMIN`;
 *   - the Dockerfile does not install `unshare` (util-linux-misc).
 * It then proves itself on hostile profiles. Nothing is fetched and no container is started.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOBY_TAG = 'v28.3.3'; // profiles/seccomp/default.json of github.com/moby/moby at this tag
const MOBY_SHA256 = '01536f1d1df938ae611eba20d6349e0de7a99b6ecdee1549427a0b01b8301e28';
const MOBY_FILE = 'tools/fixtures/seccomp/moby-v28.3.3-default.json';
const PROFILE_FILE = 'deploy/seccomp-action-runner.json';
const CLONE_NEWUSER = 0x10000000;
const CLONE_NEWNET = 0x40000000;
const ALLOWED = CLONE_NEWUSER | CLONE_NEWNET;
const ALL32 = 0xffffffff;

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// The problems of one profile against the moby default: [] when it is the default plus the one rule.
function profileProblems(profile, moby) {
  const out = [];
  if (!profile || typeof profile !== 'object' || !Array.isArray(profile.syscalls)) return ['the profile has no syscalls list'];
  for (const k of new Set([...Object.keys(moby), ...Object.keys(profile)])) {
    if (k === 'syscalls') continue;
    if (JSON.stringify(profile[k]) !== JSON.stringify(moby[k])) out.push(`"${k}" differs from the moby ${MOBY_TAG} default`);
  }
  const base = moby.syscalls;
  if (profile.syscalls.length !== base.length + 1) out.push(`the profile has ${profile.syscalls.length} rules; the moby default's ${base.length} plus one is ${base.length + 1}`);
  const own = profile.syscalls.slice(0, base.length);
  if (JSON.stringify(own) !== JSON.stringify(base)) out.push(`the first ${base.length} rules are not the moby ${MOBY_TAG} default's, unchanged and in order`);
  const rule = profile.syscalls[base.length];
  if (!rule) return out;
  const keys = Object.keys(rule).filter((k) => k !== 'comment').sort().join(',');
  if (keys !== 'action,args,names') out.push(`the added rule has ${keys} (expected action, args and names only: no includes or excludes)`);
  if (JSON.stringify(rule.names) !== '["unshare"]') out.push('the added rule must name unshare and nothing else');
  if (rule.action !== 'SCMP_ACT_ALLOW') out.push('the added rule must allow');
  const a = Array.isArray(rule.args) && rule.args.length === 1 ? rule.args[0] : null;
  if (!a) out.push('the added rule must hold exactly one condition on the flags');
  else if (a.index !== 0 || a.op !== 'SCMP_CMP_MASKED_EQ' || a.valueTwo !== 0) out.push('the condition must be argument 0, SCMP_CMP_MASKED_EQ, valueTwo 0 (flags & mask == 0)');
  else if (!Number.isInteger(a.value) || a.value < 0 || a.value > ALL32) out.push('the mask is not a 32-bit number');
  else {
    // Flags pass when (flags & mask) == 0, so the flags that pass are the zero bits of the mask: they must be exactly the two.
    const passes = (~a.value >>> 0);
    if ((passes & ~ALLOWED) !== 0) out.push(`the mask lets a flag other than CLONE_NEWUSER and CLONE_NEWNET through (0x${(passes & ~ALLOWED).toString(16)})`);
    if (passes !== ALLOWED) out.push('the mask must let CLONE_NEWUSER and CLONE_NEWNET both through');
  }
  return out;
}

function composeProblems(text, dockerfile) {
  const out = [];
  if (!/^ {6}ACTION_RUNNER_NETWORK: "namespace"\s*$/m.test(text)) out.push('docker-compose.yml must set ACTION_RUNNER_NETWORK: "namespace" (uncommented)');
  if (!text.includes(PROFILE_FILE)) out.push(`docker-compose.yml must name ${PROFILE_FILE}, the file to copy`);
  if (!/^ {4}# {2}security_opt: \["seccomp=\/share\/appdata\/coffee-pub-chameleon-seccomp\.json"\]\s*$/m.test(text)) out.push('docker-compose.yml must hold the commented security_opt line for the copied profile');
  const live = text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  if (/seccomp[=:]\s*unconfined/i.test(text)) out.push('docker-compose.yml must not offer seccomp=unconfined');
  if (/SYS_ADMIN|privileged\s*:\s*true/i.test(live)) out.push('docker-compose.yml must not add SYS_ADMIN or run privileged');
  if (/security_opt/.test(live)) out.push('security_opt must stay commented: a profile file that is not on the host stops the container from starting');
  if (!/util-linux-misc/.test(dockerfile) || !/apk add/.test(dockerfile)) out.push('the Dockerfile must install util-linux-misc (unshare)');
  return out;
}

const moby = JSON.parse(read(MOBY_FILE));
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, MOBY_FILE))).digest('hex'), MOBY_SHA256, `${MOBY_FILE} is not the recorded moby ${MOBY_TAG} default`);
let profile;
try { profile = JSON.parse(read(PROFILE_FILE)); } catch (e) { console.error(`check-seccomp-profile: ${PROFILE_FILE} does not parse: ${e.message}`); process.exit(1); }
const compose = read('docker-compose.yml');
const dockerfile = read('Dockerfile');

// --- hostile profiles: the verifier must refuse each -----------------------------------------------------------------
const added = () => structuredClone(profile);
const last = (p) => p.syscalls[p.syscalls.length - 1];
const bad = (name, edit) => { const p = added(); edit(p); assert.notDeepEqual(profileProblems(p, moby), [], `${name} is caught`); };
assert.deepEqual(profileProblems(profile, moby), [], 'the shipped profile is the default plus the one rule');
bad('an unconfined mask (any flag)', (p) => { last(p).args[0].value = 0; });
bad('CLONE_NEWNS also allowed', (p) => { last(p).args[0].value = (~(ALLOWED | 0x00020000) >>> 0); });
bad('only CLONE_NEWNET allowed', (p) => { last(p).args[0].value = (~CLONE_NEWNET >>> 0); });
bad('the wrong op', (p) => { last(p).args[0].op = 'SCMP_CMP_EQ'; });
bad('clone added', (p) => { last(p).names.push('clone'); });
bad('setns added', (p) => { last(p).names = ['setns']; });
bad('no condition', (p) => { delete last(p).args; });
bad('a capability gate added', (p) => { last(p).includes = { caps: ['CAP_SYS_ADMIN'] }; });
bad('a second added rule', (p) => { p.syscalls.push(structuredClone(last(p))); });
bad('a moby rule changed', (p) => { p.syscalls[0].names.push('reboot'); });
bad('a moby rule removed', (p) => { p.syscalls.splice(1, 1); });
bad('the default action changed', (p) => { p.defaultAction = 'SCMP_ACT_ALLOW'; });
bad('the added rule missing', (p) => { p.syscalls.pop(); });
assert.deepEqual(composeProblems(compose, dockerfile), [], 'the compose file and Dockerfile match the profile');
for (const [name, text] of [
  ['namespace commented out', compose.replace(/^( {6})ACTION_RUNNER_NETWORK:/m, '$1# ACTION_RUNNER_NETWORK:')],
  ['another file named', compose.split(PROFILE_FILE).join('deploy/other.json')],
  ['security_opt switched on', compose.replace(/^( {4})# {2}security_opt:/m, '$1  security_opt:')],
  ['unconfined offered', compose.replace(/^( {4})# {2}security_opt:.*$/m, '$1  security_opt: ["seccomp=unconfined"]')],
  ['SYS_ADMIN added', compose.replace(/^( {4})ports:/m, '$1cap_add: ["SYS_ADMIN"]\n$1ports:')],
]) assert.notDeepEqual(composeProblems(text, dockerfile), [], `${name} is caught`);
assert.notDeepEqual(composeProblems(compose, dockerfile.replace('util-linux-misc', '')), [], 'a Dockerfile without unshare is caught');

console.log('check-seccomp-profile: OK (profile = moby ' + MOBY_TAG + ' default + one unshare rule for CLONE_NEWUSER and CLONE_NEWNET; compose and Dockerfile agree).');
