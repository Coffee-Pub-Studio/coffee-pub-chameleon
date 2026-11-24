#!/usr/bin/env node
/*
 * check-module-update-keeps.mjs -- updating a module never switches it off, and never grants what its new version newly asks
 * for until an owner approves it (Thomas, 2026-11-23: "When a user updates a module, we should not make them also re-enable
 * it if it were already enabled prior to the update.").
 *
 * Against a throwaway seeded server (the travel seed): a module that ships here and is not installed is uploaded in an older
 * copy, turned on, given data in a space and placed in a saved layout there; then
 *   - an uploaded newer version that asks for nothing new: still on, still on in the space, data and layout as they were,
 *     its permission still in Roles with the member's tick as it was;
 *   - an uploaded newer version that asks for a new permission (on for members by default) and a new hook (schedule): still
 *     on, Needs approval with exactly those two pending; the new permission is in nobody's Roles (owners included) and the
 *     hook is refused with the not-approved sentence; the old permission still holds; data and layout as they were;
 *   - Switch to this version (rollback) to the older one and back: still on each time;
 *   - Approve (PATCH enabled: true while on): the new permission joins Roles and the hook works;
 *   - Update to the copy this server ships (Manage > Modules' Update, POST /api/modules/bundled/:id/install): still on, data
 *     and layout as they were.
 * ModuleManager on its own: install and rollback leave `enabled` and `approved` as they were, and permissionList lists only
 * approved permissions.
 *
 *   node tools/check-module-update-keeps.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { freePort, stopServer, bootSeeded } from './shots.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { ModuleManager } = require('../server/modules.js');
const { buildModule } = require('../server/module-build.js');

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

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'update-keeps-'));
// A copy of modules/<id> at `version`, with `change` applied to its manifest, as a zip.
const copyOf = (id, version, change = () => {}) => {
  const dir = path.join(scratch, `${id}-${version}`);
  fs.cpSync(path.join(root, 'modules', id), dir, { recursive: true });
  const file = path.join(dir, 'module.json');
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  m.version = version;
  if (m.actions) delete m.actions.server; // an upload may not declare it (server/module-actions.js)
  change(m);
  fs.writeFileSync(file, JSON.stringify(m));
  return buildModule(dir).zip;
};
const NEW_PERMISSION = { key: 'update_keeps_extra', label: 'Something new', default: { member: true, guest: false, moderator: true } };

// --- ModuleManager on its own ---------------------------------------------------------------------------------------
await test('unit: install and rollback keep a module on with what was approved before; permissionList lists only approved', async () => {
  const mm = new ModuleManager(path.join(scratch, 'unit'));
  const id = 'todo';
  await mm.install(copyOf(id, '0.0.1'));
  mm.update(id, { enabled: true });
  const approved = structuredClone(mm.registry.modules[id].approved);
  const before = mm.permissionList().map((p) => p.key);
  assert.ok(before.length > 0, 'the module has permissions to list');
  const v2 = await mm.install(copyOf(id, '0.0.2', (m) => { m.permissions.push(NEW_PERMISSION); m.hooks = { ...(m.hooks || {}), schedule: true }; }));
  assert.equal(v2.enabled, true, 'an update that asks for something new keeps it on');
  assert.equal(v2.needsApproval, true);
  assert.deepEqual(v2.pending.permissions, [NEW_PERMISSION.key]);
  assert.deepEqual(mm.registry.modules[id].approved, approved, 'the approvals are what they were');
  assert.deepEqual(mm.permissionList().map((p) => p.key), before, 'the new permission is not listed until approved');
  assert.equal(mm.rollback(id, '0.0.1').enabled, true, 'switching back keeps it on');
  assert.equal(mm.rollback(id, '0.0.2').enabled, true, 'and switching forward again');
  mm.update(id, { enabled: true });
  assert.ok(mm.permissionList().some((p) => p.key === `module.${id}.${NEW_PERMISSION.key}`), 'approved, it is listed');
  assert.equal(mm.view(id).needsApproval, false);
});

// --- a real server --------------------------------------------------------------------------------------------------
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-keeps-data-'));
let server = null;
try {
  const boot = await bootSeeded('travel', dataDir, await freePort());
  server = boot.server;
  const { ctx, cookies } = boot;
  const jar = (as) => cookies[as].map((c) => `${c.name}=${c.value}`).join('; ');
  const call = async (method, url, body, as = 'admin') => {
    const zip = Buffer.isBuffer(body);
    const headers = { 'content-type': zip ? 'application/zip' : 'application/json', accept: 'application/json', cookie: jar(as), origin: server.base };
    const r = await fetch(server.base + url, { method, headers, body: body === undefined ? undefined : zip ? body : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch { /* none */ }
    return { status: r.status, json };
  };
  const T = ctx.trip;
  const listed = (await call('GET', '/api/modules')).json;
  // A module that ships here, is not installed, needs nothing else, shows on a space's canvas and has permissions.
  const pick = listed.bundled.find((b) => {
    if (b.installed || b.notInPlan || (b.requires || []).length) return false;
    const m = JSON.parse(fs.readFileSync(path.join(root, 'modules', b.id, 'module.json'), 'utf8'));
    return (m.scope || []).includes('space') && m.surfaces?.canvas && (m.permissions || []).length > 0;
  });
  assert.ok(pick, 'the seeded environment has a module left to install');
  const id = pick.id;
  const shipped = JSON.parse(fs.readFileSync(path.join(root, 'modules', id, 'module.json'), 'utf8'));
  const firstKey = `module.${id}.${shipped.permissions[0].key}`;
  const newKey = `module.${id}.${NEW_PERMISSION.key}`;
  const view = async () => (await call('GET', '/api/modules')).json.modules.find((m) => m.id === id);
  const onInSpace = async () => Boolean((await call('GET', `/api/modules/for-space?space=${T}`)).json?.modules?.some((m) => m.id === id));
  const roles = async () => (await call('GET', '/api/roles')).json;
  const dataUrl = `/api/modules/${id}/data/update-keeps?scope=space&space=${T}`;
  const layouts = async () => (await call('GET', `/api/spaces/${T}/layouts`)).json;
  const savedLayout = async (lid) => {
    const l = await layouts();
    return (l.shared || []).find((x) => x.id === lid);
  };

  let layoutId = null;
  let dataBefore = null;
  let layoutBefore = null;
  let memberTick = null;
  // What every update must leave as it was.
  const unchanged = async (label) => {
    const v = await view();
    assert.equal(v.enabled, true, `${label}: still on`);
    assert.equal(await onInSpace(), true, `${label}: still on in the space`);
    assert.deepEqual((await call('GET', dataUrl)).json, dataBefore, `${label}: its data as it was`);
    assert.deepEqual(await savedLayout(layoutId), layoutBefore, `${label}: the saved layout as it was`);
    const r = await roles();
    assert.equal(r.roles.member[firstKey], memberTick, `${label}: the member's tick for its permission as it was`);
    assert.equal(r.roles.owner[firstKey], true, `${label}: owners still hold its permission`);
  };

  await test('live: set up -- an older copy uploaded, turned on, given data and a saved layout in a space', async () => {
    const up = await call('POST', '/api/modules', copyOf(id, '0.0.1'));
    assert.equal(up.status, 201, JSON.stringify(up.json));
    assert.equal((await call('PATCH', `/api/modules/${id}`, { enabled: true })).status, 200);
    // The member's tick differs from the default, so an update resetting it would show.
    memberTick = !(await roles()).roles.member[firstKey];
    assert.equal((await call('PATCH', '/api/roles/member', { [firstKey]: memberTick })).status, 200);
    assert.equal((await call('PUT', dataUrl, { value: { title: 'kept across updates' } })).status, 200);
    dataBefore = (await call('GET', dataUrl)).json;
    const saved = await call('POST', `/api/spaces/${T}/layouts`, { name: 'Update keeps', shared: true, shape: 'one', areas: [id] });
    assert.equal(saved.status, 201, JSON.stringify(saved.json));
    layoutId = saved.json.layout.id;
    layoutBefore = await savedLayout(layoutId);
    assert.ok(layoutBefore, 'the saved layout is listed');
    await unchanged('before any update');
  });

  await test('live: an uploaded update that asks for nothing new keeps it on, with its data, layout and Roles', async () => {
    const up = await call('POST', '/api/modules', copyOf(id, '0.0.2'));
    assert.equal(up.status, 201, JSON.stringify(up.json));
    assert.deepEqual([up.json.module.enabled, up.json.module.needsApproval], [true, false]);
    await unchanged('0.0.2');
  });

  await test('live: an uploaded update that asks for a new permission and hook keeps it on with the old approvals; the new ones are not granted', async () => {
    const up = await call('POST', '/api/modules', copyOf(id, '0.0.3', (m) => { m.permissions.push(NEW_PERMISSION); m.hooks = { ...(m.hooks || {}), schedule: true }; }));
    assert.equal(up.status, 201, JSON.stringify(up.json));
    assert.deepEqual([up.json.module.enabled, up.json.module.needsApproval], [true, true], 'on, and waiting for approval');
    assert.deepEqual(up.json.module.pending.permissions, [NEW_PERMISSION.key]);
    assert.deepEqual(up.json.module.pending.hooks, ['schedule']);
    await unchanged('0.0.3');
    const r = await roles();
    assert.ok(!r.permissions.some((p) => p.key === newKey), 'the new permission is not in the Roles grid');
    for (const role of Object.keys(r.roles)) assert.ok(!r.roles[role][newKey], `${role} does not hold the new permission`);
    const sched = await call('POST', `/api/modules/${id}/schedule?scope=space&space=${T}`, { key: 'k', at: Date.now() + 3600e3 });
    assert.equal(sched.status, 403, JSON.stringify(sched.json));
    assert.match(sched.json.error, /is not approved for the schedule hook yet/);
  });

  await test('live: switching versions keeps it on', async () => {
    const back = await call('POST', `/api/modules/${id}/rollback`, { version: '0.0.2' });
    assert.equal(back.status, 200, JSON.stringify(back.json));
    await unchanged('switched to 0.0.2');
    const again = await call('POST', `/api/modules/${id}/rollback`, { version: '0.0.3' });
    assert.equal(again.status, 200, JSON.stringify(again.json));
    assert.deepEqual([again.json.module.enabled, again.json.module.needsApproval], [true, true]);
    await unchanged('switched back to 0.0.3');
  });

  await test('live: Approve grants the new permission and hook', async () => {
    const ok = await call('PATCH', `/api/modules/${id}`, { enabled: true });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.deepEqual([ok.json.module.enabled, ok.json.module.needsApproval], [true, false]);
    const r = await roles();
    assert.ok(r.permissions.some((p) => p.key === newKey), 'the new permission is in the Roles grid');
    assert.equal(r.roles.owner[newKey], true, 'owners hold it');
    assert.equal(r.roles.member[newKey], true, 'members hold it by its default');
    const sched = await call('POST', `/api/modules/${id}/schedule?scope=space&space=${T}`, { key: 'k', at: Date.now() + 3600e3 });
    assert.equal(sched.status, 200, JSON.stringify(sched.json));
    await unchanged('approved');
  });

  await test('live: Update to the copy this server ships (Manage > Modules) keeps it on, with its data and layout', async () => {
    const up = await call('POST', `/api/modules/bundled/${id}/install`);
    assert.equal(up.status, 201, JSON.stringify(up.json));
    assert.equal(up.json.module.version, shipped.version);
    assert.equal(up.json.module.enabled, true);
    await unchanged(`the shipped ${shipped.version}`);
  });
} catch (err) {
  failed += 1;
  console.error(`FAIL live: the seeded server\n${err.stack || err}`);
} finally {
  if (server) await stopServer(server);
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  fs.rmSync(scratch, { recursive: true, force: true });
}

if (failed) {
  console.error(`check-module-update-keeps: ${failed} failed, ${n} passed`);
  process.exit(1);
}
console.log(`check-module-update-keeps: OK (${n} checks)`);
