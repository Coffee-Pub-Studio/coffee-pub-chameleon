#!/usr/bin/env node
/*
 * check-eval-extract.mjs -- tools/eval-extract.mjs (plan-assistant-reboot.md, step 3), offline, against the stand-in model
 * (tools/fake-model.mjs). It never reaches a real service; what a real model scores is for Thomas to run.
 *
 *   - The scorer, on a fixed fixture with known scores: a perfect answer, a blank one, an invented one, a wrong one, a day where a
 *     time was expected, an extra booking, a booking expected and not found, and a sample that expects no booking.
 *   - The golden set through the stand-in model: every sample with a stand-in answer scores in full, and the others score what a
 *     blank answer scores; `written` and `real-anonymised` samples are reported apart.
 *   - Real samples (EVAL_REAL_DIR, a private folder outside the repo): unset means written only and a plain note; a folder is read
 *     and scored apart; a folder inside the repo is refused; a malformed file is named and skipped; and no file but .gitignore is
 *     tracked under tools/golden/extract/real/.
 *   - The spending cap: the run stops before the sample that would pass it, and says so.
 *   - The command: no key printed anywhere (output, report file); no call at all without EVAL_AI_PROVIDER (or without prices);
 *     a report written to the path given.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startFakeModel } from './fake-model.mjs';
import { scoreObjects, evaluate, loadSamples, makeAi, report, summarise, main, FIELDS } from './eval-extract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
let count = 0;
const test = async (name, fn) => {
  try { await fn(); count += 1; } catch (err) { failures.push(`${name}: ${err.stack || err.message}`); }
};
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `check-eval-extract-${name}-`));

const EXPECTED = { kind: 'hotel', title: 'Hotel Marlow', date: '2027-03-14', details: { checkIn: '2027-03-14T15:00', reference: '88412093', cost: 100, currency: 'GBP' } };
const POSSIBLE = 7; // kind, title, date, times, reference, cost, currency
const given = (over = {}, detailsOver = {}) => ({ ...EXPECTED, ...over, details: { ...EXPECTED.details, ...detailsOver } });

await test('the scorer: perfect, blank, invented, wrong, with known scores', () => {
  let s = scoreObjects([EXPECTED], [given()]);
  assert.deepEqual([s.points, s.possible], [7, POSSIBLE]);
  // The same value written another way still matches (case, spaces, a decimal as a string is not a number so left out).
  s = scoreObjects([EXPECTED], [given({ title: 'the HOTEL  marlow, London' }, { reference: '8841 2093', currency: 'gbp' })]);
  assert.deepEqual([s.points, s.possible], [7, POSSIBLE], 'a title holding every word, a reference with a space, a currency in lower case');
  // Blank: nothing returned counts 0 for every field, and one booking missing.
  s = scoreObjects([EXPECTED], []);
  assert.deepEqual([s.points, s.possible, s.missing, s.extra], [0, POSSIBLE, 1, 0]);
  // A blank where a value is expected counts 0, not -1.
  s = scoreObjects([EXPECTED], [given({}, { cost: undefined, reference: undefined })]);
  assert.deepEqual([s.points, s.possible], [5, POSSIBLE]);
  // Invented: a wrong reference (-1), travellers where none are expected (-1), a cost left blank (0); the rest right.
  s = scoreObjects([EXPECTED], [given({}, { reference: 'ZZ9ZZZ', travellers: ['Bob Roe'], cost: undefined })]);
  assert.deepEqual([s.points, s.possible], [3, POSSIBLE]);
  assert.deepEqual([s.fields.reference.points, s.fields.travellers.points, s.fields.travellers.possible, s.fields.cost.points], [-1, -1, 0, 0]);
  // Wrong: the kind is right and everything else is not: title 0 (never -1), the other five -1 each, kind +1.
  s = scoreObjects([EXPECTED], [given({ title: 'Somewhere else', date: '2027-03-15' }, { checkIn: '2027-03-15T15:00', reference: 'X1', cost: 200, currency: 'EUR' })]);
  assert.deepEqual([s.points, s.possible], [-4, POSSIBLE]);
  assert.equal(s.fields.reference.wrong, 1);
});

await test('the scorer: a day where a time was expected is blank; extras, misses and a sample that expects nothing', () => {
  let s = scoreObjects([EXPECTED], [given({}, { checkIn: '2027-03-14' })]);
  assert.deepEqual([s.fields.times.points, s.points], [0, 6]);
  // A booking that was not expected: -1 under kind.
  s = scoreObjects([EXPECTED], [given(), given({ title: 'Hotel Other', kind: 'restaurant' }, { reference: 'Q1' })]);
  assert.deepEqual([s.points, s.possible, s.extra], [6, POSSIBLE, 1]);
  // Two expected, one found: the other counts 0 for each of its fields.
  const second = { kind: 'restaurant', title: 'Casa Lume', date: '2027-03-15', details: { starts: '2027-03-15T20:00' } };
  s = scoreObjects([EXPECTED, second], [given()]);
  assert.deepEqual([s.points, s.possible, s.missing], [7, POSSIBLE + 4, 1]);
  // Two of one kind are paired by what they hold, not by order.
  s = scoreObjects([EXPECTED, { ...EXPECTED, title: 'Hotel Two', date: '2027-03-20', details: { reference: 'ABC987' } }], [given({ title: 'Hotel Two', date: '2027-03-20' }, { reference: 'ABC987', checkIn: undefined, cost: undefined, currency: undefined }), given()]);
  assert.equal(s.points, s.possible);
  // Nothing expected: nothing returned is 1; a booking returned is -1.
  assert.deepEqual([scoreObjects([], []).points, scoreObjects([], []).possible], [1, 1]);
  assert.deepEqual([scoreObjects([], [given()]).points, scoreObjects([], [given()]).possible], [-1, 1]);
  // Places and names: a code or a name that holds the other; names as a set with titles ignored; a cost to the cent.
  const trip = { kind: 'flight', title: 'AU 1 A to B', details: { from: { code: 'MAN', name: 'Manchester' }, to: { name: 'Lisbon Airport' }, travellers: ['Tomas Hargreave', 'Elena Hargreave'], cost: 486.2 } };
  s = scoreObjects([trip], [{ kind: 'flight', title: 'AU 1 A to B', details: { from: { code: 'man' }, to: { name: 'Lisbon' }, travellers: ['MRS ELENA HARGREAVE', 'Mr Tomas Hargreave'], cost: 486.2 } }]);
  assert.equal(s.points, s.possible);
});

const fake = await startFakeModel();
try {
  const dir = tmp('run');
  const { ai } = makeAi({ provider: 'compatible', key: '', model: 'stand-in', address: `${fake.url}/v1` }, dir);
  const answerFor = (s) => s.standIn || { objects: [], unread: [] };
  const script = (s) => { fake.clear(); fake.next({ json: answerFor(s), tokens: [2000, 100] }); };

  await test('the golden set through the stand-in model: a sample with a stand-in answer scores in full, the others what a blank one scores', async () => {
    const samples = loadSamples();
    assert.equal(samples.length >= 24, true, 'at least 24 samples');
    assert.ok(samples.filter((s) => s.mark === 'written').length >= 24);
    const run = await evaluate({ ai, samples, script });
    assert.equal(run.results.length, samples.length);
    assert.equal(run.stopped, '');
    for (const r of run.results) {
      if (r.sample.standIn) assert.equal(r.score.points, r.score.possible, `${r.sample.file}: a stand-in answer scores in full (${r.score.points}/${r.score.possible})`);
      else if ((r.sample.expected || []).length) assert.equal(r.score.points, 0, `${r.sample.file}: a blank answer scores 0`);
      assert.ok(!r.error, `${r.sample.file}: ${r.error}`);
    }
    assert.ok(run.results.filter((r) => r.sample.standIn).length >= 12, 'a good part of the set has a stand-in answer');
    const none = run.results.find((r) => r.sample.expected.length === 0);
    assert.ok(none && none.score.points === 1, 'the sample with no booking scores 1 for returning none');
    const text = report({ run, label: 'stand-in', dry: true, cap: 5, prices: { in: 0, out: 0 } });
    for (const f of FIELDS) assert.ok(text.includes(f), `the report names ${f}`);
    assert.ok(text.includes('Per sample') && text.includes('By kind') && text.includes('By field') && text.includes('All samples together'));
    assert.ok(/Samples marked written \(\d+ samples\)/.test(text) && text.includes('Samples marked real-anonymised: none (no real samples: set EVAL_REAL_DIR).'));
  });

  await test('written and real-anonymised samples are reported apart', async () => {
    const g = tmp('golden');
    const priv = tmp('private');
    const a = loadSamples().find((s) => s.standIn);
    const { file, ...bare } = a;
    fs.writeFileSync(path.join(g, 'a.json'), JSON.stringify(bare));
    fs.writeFileSync(path.join(priv, 'b.json'), JSON.stringify({ ...bare, mark: 'real-anonymised' }));
    const samples = loadSamples(g, priv);
    assert.deepEqual(samples.map((s) => `${s.file}:${s.mark}`), ['a.json:written', path.join('real', 'b.json') + ':real-anonymised']);
    const run = await evaluate({ ai, samples, script });
    const s = summarise(run.results);
    assert.deepEqual([s.byMark.written.overall.samples, s.byMark['real-anonymised'].overall.samples], [1, 1]);
    const text = report({ run, label: 'x', dry: true, cap: 5, prices: { in: 0, out: 0 } });
    assert.ok(text.includes('Samples marked written (1 samples)') && text.includes('Samples marked real-anonymised (1 samples)'));
    fs.writeFileSync(path.join(g, 'c.json'), JSON.stringify({ ...bare, mark: 'guessed' }));
    assert.throws(() => loadSamples(g), /mark must be written or real-anonymised/);
  });

  const capture = () => { const r = { out: '', err: '' }; return [r, { out: (t) => { r.out += t; }, err: (t) => { r.err += t; } }]; };

  await test('EVAL_REAL_DIR unset: written samples only, and the report says so plainly', async () => {
    const [r, io] = capture();
    assert.equal(await main(['--dry-run'], {}, io), 0);
    assert.ok(r.out.includes('no real samples: set EVAL_REAL_DIR'));
    assert.ok(!/real\//.test(r.out.split('Samples marked')[0]), 'no real sample in the per-sample list');
  });

  await test('EVAL_REAL_DIR with a fake real sample: it is read and scored apart from the written ones', async () => {
    const priv = tmp('private');
    const a = loadSamples().find((s) => s.standIn);
    const { file, ...bare } = a;
    fs.writeFileSync(path.join(priv, 'fake.json'), JSON.stringify({ ...bare, mark: 'real-anonymised' }));
    const [r, io] = capture();
    assert.equal(await main(['--dry-run'], { EVAL_REAL_DIR: priv }, io), 0);
    assert.ok(/Samples marked real-anonymised \(1 samples\)/.test(r.out) && /Samples marked written \(\d+ samples\)/.test(r.out));
    assert.ok(r.out.includes(path.join('real', 'fake.json')) && !r.out.includes('no real samples'));
  });

  await test('a directory inside the repo is refused, with a plain sentence', async () => {
    for (const bad of [path.join(ROOT, 'tools', 'golden', 'extract', 'real'), ROOT, path.join(ROOT, 'tools')]) {
      const [r, io] = capture();
      assert.equal(await main(['--dry-run'], { EVAL_REAL_DIR: bad }, io), 2);
      assert.ok(r.err.includes('Keep real samples outside the repo.') && !r.out, bad);
    }
    assert.throws(() => loadSamples(undefined, ROOT), /Keep real samples outside the repo\./);
  });

  await test('a malformed sample in the folder is named and skipped; the rest still run', async () => {
    const priv = tmp('private');
    const a = loadSamples().find((s) => s.standIn);
    const { file, ...bare } = a;
    fs.writeFileSync(path.join(priv, 'good.json'), JSON.stringify({ ...bare, mark: 'real-anonymised' }));
    fs.writeFileSync(path.join(priv, 'broken.json'), '{ not json');
    fs.writeFileSync(path.join(priv, 'nomark.json'), JSON.stringify({ ...bare, mark: 'guessed' }));
    const [r, io] = capture();
    assert.equal(await main(['--dry-run'], { EVAL_REAL_DIR: priv }, io), 0);
    assert.ok(r.err.includes('Skipped real/broken.json: it could not be read (not valid JSON).'), r.err);
    assert.ok(r.err.includes('Skipped real/nomark.json') && r.out.includes('Skipped real/broken.json'));
    assert.ok(/Samples marked real-anonymised \(1 samples\)/.test(r.out));
  });

  await test('no real sample is tracked by git: only .gitignore under tools/golden/extract/real/', async () => {
    const { execFileSync } = await import('node:child_process');
    let tracked;
    try { tracked = execFileSync('git', ['ls-files', 'tools/golden/extract/real'], { cwd: ROOT, encoding: 'utf8' }); } catch { return; } // not a git checkout
    const extra = tracked.split('\n').filter(Boolean).filter((f) => f !== 'tools/golden/extract/real/.gitignore');
    assert.deepEqual(extra, [], 'real samples must never be committed (this repository is public)');
    assert.equal(fs.readFileSync(path.join(ROOT, 'tools', 'golden', 'extract', 'real', '.gitignore'), 'utf8'), '*\n!.gitignore\n');
  });

  await test('the spending cap: it stops before the sample that would pass it, and says so', async () => {
    const samples = loadSamples();
    // Each sample is about 2,100 tokens: at US$1000 per million tokens that is about US$2.1 each; a cap of US$5 allows two.
    const run = await evaluate({ ai, samples, script, prices: { in: 1000, out: 100 }, cap: 5 });
    assert.equal(run.results.length, 2);
    assert.ok(run.spent <= 5 && run.spent > 3.5, `spent ${run.spent}`);
    assert.match(run.stopped, /^Stopped before sample 3 of 24: spending US\$[\d.]+ would pass the cap of US\$5\.$/);
    assert.equal(run.notRun.length, samples.length - 2);
    const text = report({ run, label: 'x', dry: false, cap: 5, prices: { in: 1000, out: 100 } });
    assert.ok(text.includes('Stopped before sample 3 of 24') && text.includes('Not run: '));
    // The first sample alone would pass a tiny cap: nothing is sent.
    fake.clear();
    const none = await evaluate({ ai, samples, script, prices: { in: 1000, out: 1000 }, cap: 0.01 });
    assert.deepEqual([none.results.length, fake.seen.length], [0, 0]);
    // Three failed answers in a row stop the run.
    const failing = await evaluate({ ai, samples, script: () => { fake.clear(); fake.next({ status: 500 }); } });
    assert.equal(failing.results.length, 3);
    assert.equal(failing.stopped, 'Stopped: three answers in a row failed.');
  });

  // --- the command -----------------------------------------------------------------------------------------------------------
  const run = (args, env) => new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'tools', 'eval-extract.mjs'), ...args], { env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', (code) => resolve({ code, out, err }));
  });
  const SECRET = 'sk-test-SECRETKEY-0123456789';
  const service = { EVAL_AI_PROVIDER: 'compatible', EVAL_AI_ADDRESS: `${fake.url}/v1`, EVAL_AI_KEY: SECRET, EVAL_AI_MODEL: 'fake-1', EVAL_PRICE_IN: '0.5', EVAL_PRICE_OUT: '1.5' };

  await test('no call without the provider variable, or without prices; each says what to set', async () => {
    fake.clear();
    let r = await run([], { EVAL_AI_ADDRESS: service.EVAL_AI_ADDRESS, EVAL_AI_KEY: SECRET });
    assert.equal(r.code, 2);
    assert.match(r.err, /^Set EVAL_AI_PROVIDER /);
    r = await run([], { ...service, EVAL_PRICE_IN: undefined, EVAL_PRICE_OUT: undefined });
    assert.equal(r.code, 2);
    assert.match(r.err, /Set EVAL_PRICE_IN and EVAL_PRICE_OUT/);
    r = await run([], { ...service, EVAL_AI_PROVIDER: 'openai', EVAL_AI_KEY: '' });
    assert.match(r.err, /Set EVAL_AI_KEY/);
    r = await run([], { ...service, EVAL_SPEND_CAP: '0' });
    assert.match(r.err, /EVAL_SPEND_CAP must be a number above 0/);
    assert.equal(fake.seen.length, 0, 'nothing was sent');
    assert.ok(!r.err.includes(SECRET));
  });

  await test('a run against a service: the key is sent, never printed; the report goes to the path given; the cap is read from the environment', async () => {
    fake.clear();
    const file = path.join(tmp('report'), 'report.txt');
    const r = await run(['--report', file, '--only', '20-no-booking'], service);
    assert.equal(r.code, 0, r.err);
    assert.ok(fake.seen.length >= 1 && fake.seen[0].auth === `Bearer ${SECRET}`, 'the key was read from the environment and used');
    const report = fs.readFileSync(file, 'utf8');
    assert.ok(report.includes('compatible, model fake-1') && report.includes('Estimated cost: US$'));
    for (const [what, text] of [['stdout', r.out], ['stderr', r.err], ['report', report]]) assert.ok(!text.includes(SECRET), `the key is not in the ${what}`);
    assert.equal(r.out, '', 'with a report path, nothing goes to stdout');
    // Default: the report on stdout.
    const out = await run(['--only', '20-no-booking'], service);
    assert.ok(out.out.includes('Booking extraction evaluation') && !out.out.includes(SECRET) && !out.err.includes(SECRET));
    // A cap too small for the first sample: nothing more is sent.
    fake.clear();
    const capped = await run(['--only', '20-no-booking'], { ...service, EVAL_SPEND_CAP: '0.0000001' });
    assert.ok(capped.out.includes('Stopped before sample 1 of 1'), capped.out);
    assert.equal(fake.seen.length, 0);
    // No file in the project or the run's folder holds the key (a failed run too).
    fake.clear();
    fake.next({ status: 401 });
    const bad = await run(['--only', '20-no-booking'], service);
    assert.ok(!bad.out.includes(SECRET) && !bad.err.includes(SECRET));
  });

  await test('--dry-run needs no variable and sends nothing outside; the key text is taken out of an error', async () => {
    fake.clear();
    const r = await run(['--dry-run', '--only', '0'], {});
    assert.equal(r.code, 0, r.err);
    assert.equal(fake.seen.length, 0, 'the stand-in model is its own, not this one');
    assert.ok(r.out.includes('stand-in model: nothing real was asked'));
    const lines = [];
    assert.equal(await main(['--dry-run', '--only', '20-no-booking'], {}, { out: (t) => lines.push(t), err: () => {} }), 0);
    assert.ok(lines.join('').includes('All samples together'));
    assert.equal(await main(['--only', 'nosuchsample'], { EVAL_AI_PROVIDER: 'compatible', EVAL_AI_ADDRESS: 'http://127.0.0.1:1/v1', EVAL_PRICE_IN: '1', EVAL_PRICE_OUT: '1' }, { out: () => {}, err: (t) => lines.push(t) }), 2);
    assert.ok(lines.join('').includes('No samples to run.'));
  });
} finally {
  await fake.close();
}

const script = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
await test('eval-extract is not part of npm run check; check-eval-extract is, after check-ai-extract', () => {
  const check = JSON.parse(script).scripts.check;
  assert.ok(!/tools\/eval-extract\.mjs/.test(check), 'the real-model run is never in the check');
  assert.ok(check.indexOf('check-ai-extract.mjs') >= 0 && check.indexOf('check-eval-extract.mjs') > check.indexOf('check-ai-extract.mjs'));
});

if (failures.length) {
  console.error(`check-eval-extract: ${failures.length} failed`);
  for (const f of failures) console.error(f);
  process.exit(1);
}
console.log(`check-eval-extract: OK (${count} groups)`);
process.exit(0);
