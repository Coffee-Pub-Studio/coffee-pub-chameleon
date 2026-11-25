'use strict';
// The module check (documentation/plans/plan-agent-server-actions.md, section 9; decision 4): one function that decides what an
// installed module is refused for and what the admin is shown. The server's install calls it for every install, upload and
// bundled alike; tools/validate-module.mjs (a later step) calls it on an author's own machine; nothing else decides.
//
//   checkModule(files) -> { id, version, refused, findings, library, asks, manifest }
//
// `files` is the map readZip answers (name to bytes), with or without a wrapper folder. `refused` is the sentence of the first
// `refuse` finding, or null. Each finding is { check, grade, file?, line?, text }, `grade` 'refuse' or 'advise'. `library` is the
// SHA-256 of the exact text the server's runner would load (server/module-build.js libraryFrom) when the manifest declares
// actions.server, else null. `asks` is the listing of what the module will ask an owner and the admin to approve, in words (the
// `permissions` check's listing; not findings). `manifest` is the cleaned manifest, or null when it was refused.
//
// Pure: no DATA_DIR, no environment, no environment's words (the sentences use the default words), no network, and it never runs a
// module's code (a library is parsed with vm.Script, never run). The checks, in the order they print:
//   manifest, permissions, colours, words, host reuse, action library.
// `refuse` grades are what cleanManifest and the action library refuse; every other check only advises, so a module with a fixed
// colour installs, and its author and the admin both see the line. Whatever a repository's own checks allow-list stays in those
// checks (tools/check-*): this check has no allow-list.
const vm = require('vm');
const { coloursInFile } = require('./colour-rule');
const { LEVELS, split, oldNameHits, vocabularyScan, manifestVocabularyScan } = require('./words-rule');
const { scanBuiltPage, describe } = require('./module-layout');
const { libraryFrom, libraryHash } = require('./module-build');
const WORDS = require('./words');

// The order the checks print in, for a caller that lists them all (the validator).
const CHECKS = ['manifest', 'permissions', 'colours', 'words', 'host reuse', 'action library'];

// What the runner does not give a library (server/module-actions-worker.js: no require, process, module, timers, network or
// console; no code from strings; no dynamic import). Early help for an honest author, never the boundary: the boundary is the
// worker. Names are read in code, outside strings, comments and after a dot; `.constructor` is read with its dot.
const LIBRARY_FORBIDDEN = ['require', 'import', 'process', 'eval', 'Function', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator', 'Worker', 'WebAssembly', 'globalThis'];
const FORBIDDEN_RE = new RegExp(`(?<![\\w$.])(${LIBRARY_FORBIDDEN.join('|')})(?![\\w$])(?!\\s*:(?!:))`, 'g');
const CONSTRUCTOR_RE = /\.\s*constructor(?![\w$])/g;

const say = (text) => WORDS.fill(text, WORDS.resolve(null, null));
const TEXT_FILE = /\.(?:html?|js|css)$/i;
// A third party's file kept whole (a minified or vendored bundle) is not the author's own markup, colours or words.
const VENDORED = /(?:\.min\.|[/-]vendor[/.-]|maplibre|pdfjs|prosemirror)/i;

const bytesText = (data) => (Buffer.isBuffer(data) ? data.toString('utf8') : String(data));

// A zip with everything under one folder, as install reads it: that folder taken off.
function unwrap(files) {
  if (files.has('module.json')) return files;
  const roots = new Set([...files.keys()].map((n) => n.split('/')[0]));
  if (roots.size !== 1) return files;
  const [root] = roots;
  if (!files.has(`${root}/module.json`)) return files;
  return new Map([...files].map(([n, data]) => [n.slice(root.length + 1), data]));
}

// Blank the inside of every string and template piece (and the comments, as split already does), keeping every position, so a
// name inside a sentence or a key is not read as code.
function codeOutsideStrings(text) {
  const pieces = [];
  const parts = split('x.js', text, (piece) => pieces.push(piece));
  let out = parts.code;
  for (const piece of pieces) out = out.slice(0, piece.at) + piece.body.replace(/[^\n]/g, ' ') + out.slice(piece.at + piece.body.length);
  return out;
}

function lineOfIndex(text, index) {
  let n = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) n += 1;
  return n;
}

// The line a vm.Script SyntaxError names (its stack starts with "<file>:<line>"), or 0.
function syntaxLine(err, filename) {
  const m = new RegExp(`${filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+)`).exec(String(err && err.stack || ''));
  return m ? Number(m[1]) : 0;
}

// `o.via`: 'upload' (the default: what the validator checks) or 'bundled' (a module that ships with the server), which is not
// held to the upload-only refusals (section 8, above the checks). `o.ownCode` (the server's own bundled install, never an
// upload): leave out the list of names a library may not use. A bundled
// library is this repository's code, held by tools/check-modules.mjs, which runs every one through this check without the option;
// the option is for the repository's own hostile test library (tools/fixtures/module-actions), which names every one of them on
// purpose to prove the worker refuses it. Parsing, the declared file and the library set are still checked.
function checkModule(given, o = {}) {
  const files = unwrap(given instanceof Map ? given : new Map(Object.entries(given || {})));
  const findings = [];
  const add = (check, grade, text, where = {}) => findings.push({ check, grade, ...(where.file ? { file: where.file } : {}), ...(where.line ? { line: where.line } : {}), text });
  const result = { id: null, version: null, refused: null, findings, library: null, asks: [], manifest: null };

  // --- 1. manifest -----------------------------------------------------------------------------------------------
  let raw = null;
  const manifestFile = files.get('module.json');
  if (!manifestFile) {
    add('manifest', 'refuse', 'module.json is missing from the zip', { file: 'module.json' });
  } else {
    try {
      raw = JSON.parse(bytesText(manifestFile));
    } catch {
      add('manifest', 'refuse', "module.json isn't valid JSON", { file: 'module.json' });
    }
  }
  let manifest = null;
  if (raw !== null) {
    // Required lazily: modules.js calls this check from its install, so it is not loaded until a check runs.
    const { cleanManifest } = require('./modules');
    try {
      manifest = cleanManifest(raw, files);
    } catch (err) {
      add('manifest', 'refuse', err && err.message ? err.message : "module.json can't be read", { file: 'module.json' });
    }
  }
  // What only a module that ships with the server may ask of it (plan-agent-server-actions.md, section 8): a place search before
  // an action runs (`lookups`, and `skipLookupWhen` with it) and moving the main phase's end (`phaseEnd`). An upload declaring
  // any is refused, each with its own sentence; the server's runner refuses them for an uploaded module too, whatever its
  // manifest says (server/index.js carryOnServer).
  if (manifest && o.via !== 'bundled') {
    for (const a of manifest.actions.provides) {
      if (a.lookups) add('manifest', 'refuse', say(`module.json: action "${a.name}" asks the server to search places, which only a {module} that ships with the server may do`), { file: 'module.json' });
      if (a.skipLookupWhen) add('manifest', 'refuse', say(`module.json: action "${a.name}" says when to skip a place search, which only a {module} that ships with the server may ask for`), { file: 'module.json' });
      if (a.phaseEnd) add('manifest', 'refuse', say(`module.json: action "${a.name}" asks to move the main phase's end, which only a {module} that ships with the server may do`), { file: 'module.json' });
    }
  }
  if (manifest) {
    result.id = manifest.id;
    result.version = manifest.version;
    result.manifest = manifest;
  } else if (raw && typeof raw === 'object') {
    result.id = typeof raw.id === 'string' ? raw.id : null;
    result.version = typeof raw.version === 'string' ? raw.version : null;
  }

  // --- 2. permissions: what an owner and the admin will be asked to approve --------------------------------------------
  if (manifest) {
    const asks = result.asks;
    for (const p of manifest.permissions) {
      const roles = ['moderator', 'member', 'guest'].filter((r) => p.default && p.default[r]);
      asks.push(`${p.label}: on by default for ${roles.length ? roles.map((r) => WORDS.DEFAULTS[r].many).join(', ') : say('nobody but {owners}')}.`);
      const writes = !/^(?:view|see|read|list)(?:$|[_-])/i.test(p.key) && !/^(?:see|view|read|look)\b/i.test(p.label || '');
      if (writes && p.default && p.default.guest) add('permissions', 'advise', say(`{Guests} can change this {module}'s data unless an {owner} turns it off ("${p.key}").`), { file: 'module.json' });
    }
    for (const h of Object.keys(manifest.hooks || {}).filter((k) => manifest.hooks[k])) asks.push(`It asks for the "${h}" hook.`);
    if (manifest.uploads) asks.push('It asks to keep uploaded files.');
    for (const c of manifest.refs.consumes) asks.push(say(`It reads ${c} {objects} from other {modules}.`));
    for (const e of manifest.events.subscribes) asks.push(`It listens for the "${e}" event.`);
    for (const u of manifest.actions.uses) asks.push(`It asks other ${say('{modules}')} for "${u}" actions.`);
    if (manifest.actions.server) asks.push(`It carries out agents' requests on the server (${manifest.actions.server}).`);
  }

  // --- the text files of the zip, for the checks that read them -------------------------------------------------------
  const texts = [...files].filter(([name]) => TEXT_FILE.test(name) && !VENDORED.test(name)).map(([name, data]) => ({ name, text: bytesText(data) }));
  const kindOf = (name) => (/\.css$/i.test(name) ? 'css' : /\.html?$/i.test(name) ? 'html' : 'js');

  // --- 3. colours (advise) ---------------------------------------------------------------------------------------------
  for (const f of texts) {
    for (const c of coloursInFile({ name: f.name, kind: kindOf(f.name), text: f.text })) {
      if (c.kind === 'shadow-scrim') continue; // pure black or white as a shadow or scrim is allowed
      add('colours', 'advise', `${c.text} is a fixed colour; use a theme token (var(--...)) so the colours follow the theme`, { file: f.name, line: c.line });
    }
  }

  // --- 4. words (advise) -----------------------------------------------------------------------------------------------
  // The levels' old names as words (not the object level: "item" and "card" are plain English a module uses for things that are
  // not objects, which only a reader can tell), and the changeable words typed into what a person reads.
  const oldLevels = LEVELS.filter((l) => l.words && l.id !== 'object').map((l) => l.id);
  const wordHit = (f, token, line, why) => add('words', 'advise', `"${token}" ${why}`, { file: f, line });
  for (const f of texts.filter((t) => /\.(?:html?|js)$/i.test(t.name))) {
    for (const h of oldNameHits(f.name, f.text, 'words', oldLevels) || []) wordHit(f.name, h.token, h.line, 'is an old name; use the current names');
    const { hits } = vocabularyScan(f.name, f.text);
    for (const h of hits) wordHit(f.name, h.token, h.line, say("is typed where a person reads it; take it from the SDK (host.util.word, data-word or a {space}-style placeholder) so it follows the {environment}'s words"));
  }
  if (manifestFile && raw !== null) {
    const { manifestTexts } = require('./modules');
    const { hits } = manifestVocabularyScan(bytesText(manifestFile), manifestTexts);
    for (const h of hits) wordHit('module.json', h.token, h.line, 'is typed in module.json text; write a {space}-style placeholder so it follows the environment\'s words');
    for (const h of oldNameHits('module.json', bytesText(manifestFile), 'words', oldLevels) || []) wordHit('module.json', h.token, h.line, 'is an old name; use the current names');
  }

  // --- 5. host reuse (advise): the layout rules of server/module-layout.js ------------------------------------------------------------
  const layout = [];
  for (const f of texts.filter((t) => /\.html?$/i.test(t.name))) layout.push(...scanBuiltPage(f.name, f.text));
  for (const line of describe(layout)) {
    const at = /\[(.+):(\d+)\]$/.exec(line);
    add('host reuse', 'advise', at ? line.slice(0, at.index).trim() : line, at ? { file: at[1], line: Number(at[2]) } : {});
  }

  // --- 6. action library (refuse; only with actions.server) ------------------------------------------------------------
  if (manifest && manifest.actions.server) {
    const refuse = (text, where) => add('action library', 'refuse', text, where);
    const names = [...files.keys()].filter((n) => /^src\/[^/]+$/.test(n)).map((n) => n.slice(4));
    const pageOnly = Array.isArray(manifest.actions.pageOnly) ? manifest.actions.pageOnly : [];
    const read = (name) => bytesText(files.get(`src/${name}`));
    let lib = null;
    try {
      lib = libraryFrom(names, manifest.id, read, { leaveOut: pageOnly });
    } catch (err) {
      refuse(`module.json: the library for actions.server can't be read: ${err.message}`);
    }
    if (lib) {
      if (!lib.files.includes(manifest.actions.server)) {
        refuse(`module.json: actions.server names "${manifest.actions.server}", but that file is not in the zip (the zip needs the module's library files under src/)`, { file: 'module.json' });
      } else {
        for (const file of lib.files) {
          const text = bytesText(files.get(file));
          try {
            new vm.Script(text, { filename: file }); // parsed, never run
          } catch (err) {
            refuse(`${file}: ${err.message}`, { file, line: syntaxLine(err, file) });
            continue;
          }
          if (o.ownCode) continue;
          const code = codeOutsideStrings(text);
          for (const m of code.matchAll(FORBIDDEN_RE)) refuse(say(`${file}: "${m[1]}" is not given to a {module}'s actions on the server (they run with no network, files or settings)`), { file, line: lineOfIndex(code, m.index) });
          for (const m of code.matchAll(CONSTRUCTOR_RE)) refuse(say(`${file}: ".constructor" is not allowed in a {module}'s actions on the server`), { file, line: lineOfIndex(code, m.index) });
        }
        if (!findings.some((f) => f.check === 'action library')) {
          try {
            new vm.Script(lib.js, { filename: 'library' }); // the files together, as the runner compiles them
          } catch (err) {
            refuse(`the library's files don't work together: ${err.message}`);
          }
        }
        result.library = libraryHash(lib.js);
      }
    }
  }

  const first = findings.find((f) => f.grade === 'refuse');
  result.refused = first ? first.text : null;
  return result;
}

// What the install keeps with a version: the advise findings, at most 50, each at most 200 characters.
const KEPT_FINDINGS = 50;
const KEPT_LENGTH = 200;
function keptFindings(findings) {
  return findings.filter((f) => f.grade === 'advise').slice(0, KEPT_FINDINGS).map((f) => ({
    check: f.check,
    ...(f.file ? { file: f.file } : {}),
    ...(f.line ? { line: f.line } : {}),
    text: f.text.length > KEPT_LENGTH ? `${f.text.slice(0, KEPT_LENGTH - 1)}…` : f.text,
  }));
}

module.exports = { checkModule, keptFindings, CHECKS, LIBRARY_FORBIDDEN, KEPT_FINDINGS, KEPT_LENGTH };
