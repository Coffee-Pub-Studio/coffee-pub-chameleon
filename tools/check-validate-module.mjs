#!/usr/bin/env node
/*
 * check-validate-module.mjs -- tools/validate-module.mjs and an upload agree (documentation/plans/plan-agent-server-actions.md,
 * section 9 and step 11c).
 *
 * Small fixture modules (a clean one, a fixed colour, a typed "space", a bar of its own, a bad manifest, a library naming
 * `fetch`, a library that is missing) are made in a temporary folder, in this repository's layout (built as Manage > Modules
 * builds them) and, for one, loose. Each is given to the validator as a zip and as a folder, as a real command, and to
 * ModuleManager.install() on a throwaway DATA_DIR. Verdict, findings and exit must agree:
 *   - refused: the validator's refusal sentence is install's message, and the findings are install's `findings`;
 *   - accepted: the validator's advise findings, as the install keeps them (keptFindings), are what the module's view shows.
 * The library fixtures are compared with an upload (step 11d: an upload may declare actions.server): a library that is
 * missing, one naming `fetch`, one asking for a place search or a phase's end (what only a module that ships with the server
 * may do) are refused alike, and a clean one is accepted with the same library hash install would approve. Every bundled
 * module validates from its folder as accepted, or refused only for what it may ask because it ships with the server.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
const { ModuleManager } = req('../server/modules.js');
const { buildModule, bundledModules, zipFiles } = req('../server/module-build.js');
const { checkModule, keptFindings } = req('../server/module-check.js');
const { readZip } = req('../server/modules.js');
const VALIDATOR = path.join(ROOT, 'tools', 'validate-module.mjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-validate-module-'));
let n = 0;

const manifestOf = (id, extra = {}) => ({ id, name: id, version: '1.0.0', scope: ['space'], surfaces: { canvas: { entry: 'canvas.html', mode: ['dock'] } }, ...extra });
const PAGE = '<!doctype html><html><head><style>\n/*__CSS__*/\n</style></head><body><main id="m"></main><script>\n/*__JS__*/\n</script></body></html>';

// A module folder in this repository's layout.
function make(id, { manifest = manifestOf(id), page = PAGE, css = '.pin { padding: 2px }', js = 'document.getElementById("m").textContent = "hello";', libs = {} } = {}) {
  const dir = path.join(tmp, id);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'module.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(dir, 'src', `${id}.html`), page);
  fs.writeFileSync(path.join(dir, 'src', `${id}.css`), css);
  fs.writeFileSync(path.join(dir, 'src', `${id}.js`), js);
  for (const [name, text] of Object.entries(libs)) fs.writeFileSync(path.join(dir, 'src', name), text);
  return dir;
}

const withLibrary = (id, file) => manifestOf(id, { actions: { server: file } });
const run = (...args) => spawnSync(process.execPath, [VALIDATOR, ...args], { encoding: 'utf8' });
const asJson = (input) => {
  const r = run(input, '--json');
  return { status: r.status, out: JSON.parse(r.stdout) };
};

// What install() says for the zip: { refused: sentence | null, findings } (findings as the install keeps them when accepted).
async function installed(zip, source) {
  const dir = fs.mkdtempSync(path.join(tmp, 'data-'));
  const mm = new ModuleManager(dir);
  try {
    const view = await mm.install(zip, { source });
    return { refused: null, kept: view.findings, sha256: mm.serverLibrary(view.id)?.sha256 || null };
  } catch (err) {
    return { refused: err.message, findings: err.findings || null };
  }
}

// `via`: how install is asked ('upload', 'bundled').
async function agree(name, dir, { via = 'upload', refuses = null, accepts = null } = {}) {
  const zipPath = path.join(tmp, `${name}.zip`);
  const built = buildModule(dir).zip;
  fs.writeFileSync(zipPath, built);
  const results = [asJson(zipPath), asJson(dir)];
  const text = [run(zipPath), run(dir)];
  for (const [i, kind] of ['zip', 'folder'].entries()) {
    const { status, out } = results[i];
    assert.equal(text[i].status, status, `${name} (${kind}): the plain output and --json exit alike`);
    assert.equal(status, out.verdict === 'accepted' ? 0 : 1, `${name} (${kind}): exit from the verdict`);
    assert.deepEqual(out.findings, results[0].out.findings, `${name}: the zip and the folder give the same findings`);
    assert.equal(out.verdict, results[0].out.verdict, `${name}: the zip and the folder give the same verdict`);
    assert.match(text[i].stdout, out.verdict === 'accepted' ? /^Upload would be accepted\. The admin will see \d+ finding\(s\)\.$/m : /^Upload would be refused: \d+ problem\(s\)\.$/m, `${name} (${kind}): the verdict line`);
    for (const f of out.findings) assert.ok(text[i].stdout.includes(f.text), `${name} (${kind}): the finding "${f.text.slice(0, 40)}" is printed`);
  }
  const { status, out } = results[0];
  if (refuses) assert.match(out.refused || '', refuses, `${name}: the refusal`);
  if (accepts) for (const [check, count] of Object.entries(accepts)) assert.equal(out.findings.filter((f) => f.check === check).length >= count, true, `${name}: at least ${count} ${check} finding(s)`);
  const direct = checkModule(await readZip(built));
  assert.deepEqual(out.findings, direct.findings, `${name}: the validator is checkModule`);
  if (via) {
    const up = await installed(built, via);
    if (status === 1) {
      assert.equal(up.refused, out.refused, `${name}: install refuses with the validator's sentence`);
      assert.deepEqual(up.findings, out.findings, `${name}: install's findings are the validator's`);
    } else {
      assert.equal(up.refused, null, `${name}: install accepts what the validator accepts`);
      assert.deepEqual(up.kept, via === 'bundled' ? [] : keptFindings(out.findings), `${name}: install keeps the advise findings the validator printed`);
      if (out.library) assert.equal(up.sha256, out.library, `${name}: the library hash the admin would approve is the validator's`);
    }
  }
  n += 1;
  return out;
}

try {
  // A clean module: accepted with nothing to say.
  const clean = await agree('clean', make('clean'));
  assert.deepEqual(clean.findings, [], 'a clean module has no finding');
  assert.equal(run(path.join(tmp, 'clean.zip')).stdout.split('\n')[0], 'clean 1.0.0');
  assert.match(run(path.join(tmp, 'clean.zip')).stdout, /^pass {2}manifest$/m);

  // Advice: the module is accepted and the lines are shown.
  await agree('colour', make('colour', { css: '.pin { color: #ff0000 }' }), { accepts: { colours: 1 } });
  await agree('typed', make('typed', { page: PAGE.replace('<main id="m">', '<main id="m"><h1>Pick a space</h1>') }), { accepts: { words: 1 } });
  await agree('bar', make('bar', { page: PAGE.replace('<main id="m">', '<header class="bar"></header><main id="m">') }), { accepts: { 'host reuse': 1 } });
  const colourText = run(path.join(tmp, 'colour.zip')).stdout;
  assert.match(colourText, /^fail {2}colours$/m);
  assert.match(colourText, /fixed colour/);

  // A bad manifest is refused with install's sentence.
  await agree('badmanifest', make('badmanifest', { manifest: { id: 'badmanifest', name: 'Bad', version: 'one', scope: ['space'], surfaces: { canvas: { entry: 'canvas.html' } } } }), { refuses: /./ });

  // The action library.
  const file = (id) => `src/${id}-lib-actions.js`;
  await agree('nolib', make('nolib', { manifest: withLibrary('nolib', file('nolib')) }), { refuses: /is not in the zip/ });
  const fetching = await agree('fetching', make('fetching', { manifest: withLibrary('fetching', file('fetching')), libs: { 'fetching-lib-actions.js': 'const a = 1;\nfetch("https://example.com");\n' } }), { refuses: /"fetch" is not given/ });
  assert.equal(fetching.findings.find((f) => f.check === 'action library').line, 2, 'the finding names the line');
  const mover = manifestOf('mover', { actions: { server: file('mover'), provides: [{ name: 'move', label: 'Move', description: 'Move the end.', effect: 'write', input: { title: 'string' }, phaseEnd: true }] } });
  await agree('mover', make('mover', { manifest: mover, libs: { 'mover-lib-actions.js': 'const ACTION_HANDLERS = { move: () => ({}) };\n' } }), { refuses: /^module\.json: action "move" asks to move the main phase's end, which only a module that ships with the server may do$/ });
  const fine = await agree('fine', make('fine', { manifest: withLibrary('fine', file('fine')), libs: { 'fine-lib-actions.js': 'const a = 1;\n' } }));
  assert.equal(fine.verdict, 'accepted');
  assert.match(fine.library, /^[0-9a-f]{64}$/);
  assert.match(run(path.join(tmp, 'fine.zip')).stdout, new RegExp(`sha256 ${fine.library.slice(0, 12)}\\) and a server with the network wall\\.$`, 'm'));

  // A loose folder (not this repository's layout) is zipped as it is; a zip of the same files gives the same answer.
  {
    const dir = path.join(tmp, 'loose');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'module.json'), JSON.stringify(manifestOf('loose')));
    fs.writeFileSync(path.join(dir, 'canvas.html'), '<!doctype html><p style="color: #00ff00">hi</p>');
    const zipPath = path.join(tmp, 'loose.zip');
    fs.writeFileSync(zipPath, zipFiles([['module.json', fs.readFileSync(path.join(dir, 'module.json'))], ['canvas.html', fs.readFileSync(path.join(dir, 'canvas.html'))]]));
    const [a, b] = [asJson(dir), asJson(zipPath)];
    assert.deepEqual([a.status, a.out.findings], [b.status, b.out.findings]);
    assert.ok(a.out.findings.some((f) => f.check === 'colours'), 'the loose folder is read');
    const up = await installed(fs.readFileSync(zipPath), 'upload');
    assert.deepEqual(up.kept, keptFindings(a.out.findings));
    n += 1;
  }

  // Input that can't be read is exit 2; a zip that isn't one is too.
  assert.equal(run(path.join(tmp, 'nothing-here')).status, 2, 'a missing path is exit 2');
  fs.writeFileSync(path.join(tmp, 'junk.zip'), 'not a zip');
  assert.equal(run(path.join(tmp, 'junk.zip')).status, 2, 'a file that is not a zip is exit 2');
  assert.equal(run().status, 2, 'no argument is exit 2');
  n += 1;

  // The validator needs the server's check and what it requires, not the repository's checks.
  const source = fs.readFileSync(VALIDATOR, 'utf8');
  assert.deepEqual([...source.matchAll(/require\(path\.join\(SERVER, '([^']+)'\)\)/g)].map((m) => m[1]), ['module-check.js', 'modules.js', 'module-build.js'], 'it loads only the server files the check needs');
  assert.ok(!/from '\.|require\('\./.test(source), 'it imports nothing else from the repository, no check among them');
  n += 1;

  // Every bundled module, from its folder, validates as accepted, or (as an upload) is refused only for what a module that ships
  // with the server may ask for: a place search (Maps) or a phase's end (the Itinerary), one sentence for each.
  const root = path.join(ROOT, 'modules');
  const shipped = bundledModules(root);
  assert.ok(shipped.length >= 10, 'the bundled modules are found');
  const onlyShipped = /^module\.json: action "[A-Za-z0-9]+" (asks the server to search places|says when to skip a place search|asks to move the main phase's end), which only a module that ships with the server may (do|ask for)$/;
  for (const m of shipped) {
    const r = run(path.join(root, m.id), '--json');
    const out = JSON.parse(r.stdout);
    const refusals = (out.findings || []).filter((f) => f.grade === 'refuse');
    const asks = (m.actions?.provides || []).filter((a) => a.lookups || a.skipLookupWhen || a.phaseEnd === true);
    if (!asks.length) assert.equal(r.status, 0, `${m.id} validates as accepted (${refusals.map((f) => f.text).join('; ')})`);
    else {
      assert.equal(r.status, 1, `${m.id} would be refused as an upload`);
      assert.ok(refusals.length && refusals.every((f) => f.check === 'manifest' && onlyShipped.test(f.text)), `${m.id}: refused only for what ships with the server (${refusals.map((f) => f.text).join('; ')})`);
      assert.equal(refusals.length, asks.reduce((k, a) => k + (a.lookups ? 1 : 0) + (a.skipLookupWhen ? 1 : 0) + (a.phaseEnd === true ? 1 : 0), 0), `${m.id}: one sentence for each`);
    }
    assert.equal(Boolean(out.library), Boolean(m.actions && m.actions.server), `${m.id}: a library hash exactly when it declares actions.server`);
  }
  n += 1;
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`check-validate-module: ${n} groups OK`);
