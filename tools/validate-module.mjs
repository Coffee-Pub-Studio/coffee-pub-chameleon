#!/usr/bin/env node
/*
 * validate-module.mjs -- would this module be accepted on upload? For authors of modules outside this repository.
 *
 *   node tools/validate-module.mjs <module.zip | module folder> [--json]
 *
 * It is the server's own module check (server/module-check.js, the one install runs), run on your machine with no server, no
 * DATA_DIR and no settings. A .zip is read as install reads it (the same limits and file types). A folder with module.json
 * and src/<id>.html is built the way Manage > Modules and tools/build-module.mjs build a module (page, styles and script
 * inlined; the server actions library carried under src/), then read the same way. Any other folder is zipped as it is.
 *
 * Output: one line for the module, `pass  <check>` or `fail  <check>` for each check with each finding under it as
 * `<file>:<line> <text>`, then the verdict. An advising check prints `fail` and the module is still accepted: the upload
 * accepts it and shows the admin the same lines. --json prints the result object instead.
 * Exit: 0 accepted, 1 would be refused, 2 the input can't be read.
 *
 * What it needs: this repository's server/ folder (it loads server/module-check.js and the files that one requires), the
 * package.json dependencies those use (yauzl and the rest of `npm install`), and Node 22. It needs nothing else from the
 * repository: no check, no module, no data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server');
const { checkModule, CHECKS } = require(path.join(SERVER, 'module-check.js'));
const { readZip } = require(path.join(SERVER, 'modules.js'));
const { buildModule, zipFiles } = require(path.join(SERVER, 'module-build.js'));

class Unreadable extends Error {}

// Every file under `dir` as [zip name, bytes], the way a folder zipped as it is would carry them.
function walk(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(dir, base), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(dir, rel));
    else if (entry.isFile()) out.push([rel, fs.readFileSync(path.join(dir, rel))]);
  }
  return out;
}

// The bytes an upload of `input` would carry.
function zipOf(input) {
  let stat;
  try {
    stat = fs.statSync(input);
  } catch {
    throw new Unreadable(`${input} can't be read`);
  }
  if (stat.isFile()) return fs.readFileSync(input);
  if (!stat.isDirectory()) throw new Unreadable(`${input} is not a zip or a folder`);
  let id = null;
  try {
    id = JSON.parse(fs.readFileSync(path.join(input, 'module.json'), 'utf8')).id;
  } catch {
    // no readable module.json: zipped as it is, and the check says what is wrong
  }
  if (typeof id === 'string' && fs.existsSync(path.join(input, 'src', `${id}.html`))) {
    try {
      return buildModule(input).zip;
    } catch (err) {
      throw new Unreadable(`${input} can't be built: ${err.message}`);
    }
  }
  return zipFiles(walk(input));
}

// { code, result, lines } for the zip or folder at `input`. `result` is checkModule's answer (null when refused before the check).
export async function validate(input) {
  let files;
  try {
    files = await readZip(zipOf(input));
  } catch (err) {
    if (err instanceof Unreadable || err.message === "that isn't a readable zip file") return { code: 2, result: null, lines: [`Can't read ${input}: ${err.message}`] };
    return { code: 1, result: null, lines: [`Upload would be refused: ${err.message}`] }; // the limits and file types of an upload
  }
  const result = checkModule(files);
  const refused = result.findings.filter((f) => f.grade === 'refuse');
  const lines = [`${result.id || '(no id)'} ${result.version || '(no version)'}`];
  for (const check of CHECKS) {
    if (check === 'action library' && !(result.manifest && result.manifest.actions.server) && !result.findings.some((f) => f.check === check)) continue;
    const found = result.findings.filter((f) => f.check === check);
    lines.push(`${found.length ? 'fail' : 'pass'}  ${check}`);
    if (check === 'permissions') for (const ask of result.asks) lines.push(`  asks: ${ask}`);
    for (const f of found) lines.push(`  ${f.file ? `${f.file}${f.line ? `:${f.line}` : ''} ` : ''}${f.text}`);
  }
  if (refused.length) {
    lines.push(`Upload would be refused: ${refused.length} problem(s).`);
  } else {
    const advice = result.findings.length;
    lines.push(`Upload would be accepted. The admin will see ${advice} finding(s).`);
    if (result.library) lines.push(`Its server actions need the admin's approval of this exact library (sha256 ${result.library.slice(0, 12)}) and a server with the network wall.`);
  }
  return { code: refused.length ? 1 : 0, result, lines };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const input = args.find((a) => !a.startsWith('--'));
  if (!input) {
    console.error('usage: node tools/validate-module.mjs <module.zip or module folder> [--json]');
    process.exit(2);
  }
  const { code, result, lines } = await validate(input);
  if (json) {
    console.log(JSON.stringify({ verdict: code === 0 ? 'accepted' : code === 1 ? 'refused' : 'unreadable', ...(result || { message: lines[0] }) }, null, 2));
  } else {
    console.log(lines.join('\n'));
  }
  process.exit(code);
}
