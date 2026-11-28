#!/usr/bin/env node
/*
 * check-schedule-pacing.mjs -- a big import and its Undo wait out the host's write limit instead of stopping half way (found when the
 * real roadmap import was tried live: the host lets a module save about 240 times a minute for one person, so importing 139 entries and
 * undoing them at once needed 278; 38 stayed changed and the notice promised "it will carry on" when nothing did):
 *   - `paced` as written: a write refused with 429 waits the time it is told (at least 1 second, at most 65) and tries again, says how
 *     long on the bar, gives up after PACE_WAITS_MAX waits, and lets any other error through at once;
 *   - putBack goes on past a failure, one write at a time, and answers { total, failed, rest } where `rest` is the plan for what is left;
 *   - Undo keeps itself for that rest ("Undo again for the rest") and says how many were put back;
 *   - an import that fails says "Nothing was imported" only when everything written was put back, else how many entries keep the
 *     imported values;
 *   - the bar shows progress ("Importing: 98 of 136.") only for a run long enough to matter.
 * No page is run: the live part is a scratch run of the real roadmap import (see the pull request). Usage:
 * node modules/schedule/test/check-schedule-pacing.mjs. Exits 1 on failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = fs.readFileSync(path.join(dir, 'src', 'schedule.js'), 'utf8');

let n = 0;
const test = async (name, fn) => { try { await fn(); n += 1; } catch (e) { process.exitCode = 1; console.error(`FAIL ${name}\n${e.stack || e}`); } };
const grab = (re) => { const m = page.match(re); assert.ok(m, `found ${re}`); return m[0]; };

// `paced` and its constant, run as written with the page's other pieces stubbed (no waiting: sleepMs is recorded and returns at once).
const pacedSource = `${grab(/const PACE_WAITS_MAX = \d+;[^\n]*\n/)}${grab(/async function paced\(fn, progress\) \{[\s\S]*?\n  \}\n/)}`;
const make = () => {
  const shown = []; const slept = [];
  const factory = new Function('showProgress', 'sleepMs', 'label', `${pacedSource}\nreturn { paced, PACE_WAITS_MAX };`);
  const api = factory((t) => shown.push(t), (ms) => { slept.push(ms); return Promise.resolve(); }, () => 'plan');
  return { ...api, shown, slept };
};
const refused = (secs) => Object.assign(new Error('busy'), { status: 429, retryAfter: secs });

await test('a write refused with 429 waits as told and carries on', async () => {
  const { paced, shown, slept } = make();
  let calls = 0;
  const out = await paced(async () => { calls += 1; if (calls <= 2) throw refused(3); return 'saved'; }, () => 'Putting it back: 98 of 136.');
  assert.equal(out, 'saved');
  assert.equal(calls, 3, 'two refusals, then the write');
  assert.equal(slept.length, 6, 'three seconds, twice, a second at a time');
  assert.ok(slept.every((ms) => ms === 1000));
  assert.equal(shown[0], 'Putting it back: 98 of 136. Waiting 3 seconds for the plan to catch up.');
  assert.equal(shown[2], 'Putting it back: 98 of 136. Waiting 1 second for the plan to catch up.');
});
await test('the wait is at least a second and at most 65, and a missing wait is a few seconds', async () => {
  for (const [told, waited] of [[0, 5], [undefined, 5], [0.2, 1], [30, 30], [500, 65], ['9', 9]]) {
    const { paced, slept } = make();
    let calls = 0;
    await paced(async () => { calls += 1; if (calls === 1) throw refused(told); return 1; });
    assert.equal(slept.length, waited, `told ${told}: waits ${waited}`);
  }
});
await test('any other error goes through at once, and a refusal that never clears gives up', async () => {
  const a = make();
  let calls = 0;
  await assert.rejects(a.paced(async () => { calls += 1; throw Object.assign(new Error('conflict'), { status: 409 }); }), /conflict/);
  assert.equal(calls, 1, 'no second try for a conflict');
  assert.equal(a.slept.length, 0);
  const b = make();
  calls = 0;
  await assert.rejects(b.paced(async () => { calls += 1; throw refused(1); }), /busy/);
  assert.equal(calls, b.PACE_WAITS_MAX + 1, 'tried, waited, and gave up after the most waits');
  assert.equal(b.slept.length, b.PACE_WAITS_MAX);
});
await test('without a progress line it waits and says nothing', async () => {
  const { paced, shown, slept } = make();
  let calls = 0;
  await paced(async () => { calls += 1; if (calls === 1) throw refused(2); });
  assert.equal(shown.length, 0);
  assert.equal(slept.length, 2);
});
await test('putBack carries on past a failure, one write at a time, and answers what is left', () => {
  const put = grab(/async function putBack\(plan, verb\) \{[\s\S]*?\n  \}\n/);
  assert.match(put, /const rest = \{ created: \[\], was: \[\], fields: \[\] \};/);
  assert.match(put, /paced\(\(\) => host\.storage\.set\(SC_PREFIX \+ w\.id, w\.value, x \? \{ version: x\.version \} : \{\}\), progress\)/, 'each entry waits out the limit');
  assert.match(put, /\} catch \(err\) \{ rest\.was\.push\(w\); fail\(err\); \}/, 'a failure is kept, not thrown');
  assert.match(put, /return \{ total: things, failed: rest\.created\.length \+ rest\.was\.length \+ rest\.fields\.length, rest \};/);
  assert.doesNotMatch(put, /throw /, 'it does not stop at the first');
  assert.match(put, /if \(things >= PACE_SHOW_FROM\) showProgress\(progress\(\)\)/, 'progress only for a long run');
});
await test('Undo says how many were put back and keeps itself for the rest', () => {
  const undo = grab(/\$\('undo-btn'\)\.addEventListener\('click', async \(\) => \{[\s\S]*?\n  \}\);\n/);
  assert.match(undo, /importing = true;/, 'nothing else is imported while it runs');
  assert.match(undo, /Put back \$\{r\.total - r\.failed\} of \$\{r\.total\}\./);
  assert.match(undo, /Undo again for the rest\./);
  assert.match(undo, /offerUndo\(r\.rest, /);
  assert.match(undo, /finally \{ importing = false; if \(!undoPlan\) endProgress\(\); \}/);
  assert.match(page, /\$\('undo-btn'\)\.hidden = false;\n\s*\$\('undo'\)\.hidden = false;\n\s*undoTimer = setTimeout/, 'offerUndo shows the button again');
});
await test('an import waits out the limit, shows its progress, and says only what is true when it fails', () => {
  const apply = grab(/async function applyImport\(entries, mode, newBoard, newFields\) \{[\s\S]*?\n    return plan;\n  \}\n/);
  assert.match(apply, /const progress = \(\) => `Importing: \$\{done\} of \$\{total\}\.`;/);
  assert.match(apply, /await paced\(\(\) => write\(e, \(storedNow\(e\.id\) \|\| \{\}\)\.version\), progress\);/);
  assert.match(apply, /await paced\(\(\) => writeField\(f\.id, scFieldValue\(f\)\), progress\)/);
  assert.match(apply, /if \(left\) err\.notPutBack = left;/);
  assert.match(apply, /finally \{ importing = false; endProgress\(\); \}/);
  const say = page.match(/const importFailure = \(err\) => \{[\s\S]*?\n  \};\n/)[0];
  const f = new Function(`${say}\nreturn importFailure;`)();
  assert.equal(f(new Error('It broke.')), 'Nothing was imported. It broke.');
  assert.equal(f(Object.assign(new Error('x'), { status: 409 })), 'Someone else changed the plan just now. Nothing was imported. Try again.');
  assert.equal(f(Object.assign(new Error('busy'), { notPutBack: 38 })), 'busy Stopped part way: 38 entries keep the imported values.');
  assert.equal(f(Object.assign(new Error('busy'), { notPutBack: 1 })), 'busy Stopped part way: 1 entry keeps the imported values.');
  assert.equal((page.match(/say\(importFailure\(err\), 'danger'\);/g) || []).length, 2, 'Import and Update by id say it the same way');
  assert.doesNotMatch(page, /Nothing was imported\. Try again\.' : `Nothing was imported/, 'the old inline sentence is gone');
});

console.log(`check-schedule-pacing: ${n} tests pass`);
