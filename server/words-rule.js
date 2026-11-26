'use strict';
// The words rule and the old-names rule (documentation/plans/plan-names.md; plan-environment-templates.md, "check-names --words";
// plan-agent-server-actions.md, section 9). Pure: a file's text in, its hits out; no allow-list, no files read. Two things are
// read, in what a person reads:
//   - the vocabulary rule: a level or role word an owner or a template can change (server/words.js), typed into a sentence
//     instead of coming from word() / fill() / data-word / host.util.word / a {space}-style placeholder;
//   - the old names (the LEVELS below: tenant, table, room, stage, pane ...), as words and, with `mode: 'code'`, as code.
// tools/check-names.mjs holds the repository to it (with its allow-list and its reach over the whole repository); the module
// check (server/module-check.js) reads an uploaded module with it and only advises.

const VOCABULARY_LEVEL = 'word';
// The levels (step by step, plan-names.md). `code` and `words` are each report or enforce; the check decides what failing means.
// The levels, top down, then the roles, then the rest of the plan's renames. `code` and `words` are each
// 'report' or 'enforce' (null: that mode has no pattern for this level). `step` is the plan's step that
// switches the level to enforce. `enforceIn`, when given, keeps an enforced level to those folders for now: a hit
// anywhere else is only reported, until the step that renames it there. (The space level used it through step 5:
// server/ and tools/ from 5a, public/ from 5b, and everywhere from 5c.)
const LEVELS = [
  { id: 'environment', step: '2', code: 'enforce', words: 'enforce', codePatterns: [/tenant/gi], wordPatterns: [/\btenants?\b/gi] },
  {
    id: 'table', step: '3', code: 'enforce', words: 'enforce',
    codePatterns: [/(?<![A-Za-z])table|(?<=[a-z])Table|TABLE/g],
    wordPatterns: [/\btables?\b/gi],
  },
  // The roles: `user` (now `member`) as a role value, the old role routes and names. `admin` is not searched for: it is
  // a real role (the server's admin, and the host admin's stand-in; plan-names decision 7, amended), so neither code
  // comparing with it nor a sentence saying it can be told from an old name by pattern. No words pattern, for the same
  // reason: "admin" in a sentence is mostly the server's admin now.
  {
    id: 'role', step: '4', code: 'enforce', words: null,
    codePatterns: [
      /\brole\s*[!=]==?\s*['"]user['"]/g, /['"]user['"]\s*[!=]==?\s*[\w.?]*\brole\b/g,
      /\brole:\s*['"]user['"]/g, /\bROLES\s*=\s*\[[^\]]*['"]user['"]/g, /\broles\.user\b/g,
      /\/api\/roles\/user\b/g, /\brequireAdmin\b/g, /\badminCount\b/g,
    ],
  },
  {
    id: 'space', step: '5', code: 'enforce', words: 'enforce',
    codePatterns: [/room/gi, /\bserverName\b/g, /\bscope\s*(:|[!=]==?)\s*['"]server['"]/g, /['"]server['"]\s*[!=]==?\s*[\w.?]*\bscope\b/g, /\bscope:\s*\[[^\]]*['"](room|server)['"]/g],
    wordPatterns: [/\brooms?\b/gi],
  },
  // Step 6: the canvas was the `stage`, and a module on it a `pane` or (in a manifest and the floating box's classes) a
  // `panel`. /pane/ covers panel too; "panel" meaning a panel of a page that is not a module (the .panel card and
  // the ids named after one) is allowed in tools/check-names-allow.json by meaning. A person never reads "pane".
  { id: 'canvas', step: '6', code: 'enforce', words: 'enforce', codePatterns: [/stage/gi], wordPatterns: [/\bstages?\b/gi] },
  { id: 'module', step: '6', code: 'enforce', words: 'enforce', codePatterns: [/pane/gi], wordPatterns: [/\bpanes?\b/gi] },
  // Step 7: an object's summary was its `card`, `host.objects` was `host.refs` (with `refKey`, the drag's REF_MIME and the
  // /api/refs routes), and the AI's `objects` its `items`: enforced everywhere. Menu and toolbar items and card-shaped
  // styles (the --bg-card token, a module's own card templates) are not objects; they are allowed by meaning.
  {
    id: 'object', step: '7', code: 'enforce', words: 'enforce',
    // In what a person reads: "item" and "card" for an object (a task, a note, a place). Menu items, a list's items and
    // card-shaped parts of a page are not objects; they are allowed by meaning in tools/check-names-allow.json.
    // Only where a person reads it (not the tools' own messages), and never as part of a class or property name.
    wordPatterns: [/(?<![\w-])(items?|cards?)(?![\w-])/gi], wordsIn: ['server/', 'public/', 'modules/'],
    codePatterns: [
      // The old names of the SDK's drag and open messages and the drag's data type, and the AI's old marker.
      /refsdrag/gi, /refopen/gi, /application\/x-host-ref\b/g, /\{\{card:/g,
      /\bhost\.refs\b/g, /\brefs\.(make|resolve|kinds|open|onOpen|setLinks|linksTo|linksFrom|search|drag|draggable|dropTarget|fillFor|offersFor|dropMenu|accepts|parse|trace|elementAt)\b/g,
      /\brefKey\b/g, /\bREF_MIME\b/g, /\/api\/refs\b/g, /\/refs\//g, /\bcards\b/g, /["']card["']\s*:|\bcard\s*:\s/g,
      // The AI's `items` (pointers it is asked about), in the object sense only: not menu or toolbar items.
      /\bask\(\s*\{[^}]*\bitems\b/g, /\bitems:\s*o\s*&&\s*o\.items\b/g, /\breq\.body\??\.items\b/g,
    ],
  },
  // Step 8: an aside stopped being an `ephemeral` row among the spaces (addAsideRoom, pruneAsideRooms becoming
  // pruneAsides, the pages' asideRoom): it is its own record, `asides`. The data topics before step 3 (pull-aside,
  // recall, return-to-table) are kept as a guard: step 3 removed them everywhere with no overlap, so any hit is one
  // coming back.
  {
    id: 'aside', step: '8', code: 'enforce', words: null,
    codePatterns: [/ephemeral/gi, /\b(addAsideRoom|pruneAsideRooms|asideRoom)\b/g, /['"`](pull-aside|return-to-table|recall)['"`]/g],
  },
];

// --- splitting a file into code and words --------------------------------------------------------------------
// Two copies of the text, the same length, with newlines kept (so a hit's line is its line in the file): `code`
// with comments and sentences blanked, `words` with everything but sentences blanked.
const blank = (s) => s.replace(/[^\n]/g, ' ');
const isSentence = (s) => /\S\s+\S/.test(s);
// A string handed to something that takes class names, ids or selectors, by what comes right before its quote.
const SELECTOR_CONTEXT = /(?:\.className\s*\+?=\s*|\bclass(?:Name)?\s*:\s*|\bclassList\.(?:add|remove|toggle|contains|replace)\(\s*(?:[^()]*,\s*)?|\.(?:querySelector(?:All)?|closest|matches|getElementById|getElementsByClassName)\(\s*|\bsetAttribute\(\s*['"](?:class|id)['"]\s*,\s*)$/;
// A string a person reads whatever its shape: an error's message, or what a JSON answer sends back.
const SENTENCE_CONTEXT = /(?:\berror\s*:\s*|\bthrow\s+new\s+\w*Error\(\s*|\bnew\s+\w*Error\(\s*|\.json\(\s*)$/;
// Or by its shape: a selector list ('.a, .b > #c'), or a class list (lower-case names, at least one hyphenated).
const SELECTOR_PART = /^(?:[>+~*]|[\w-]*(?:[.#][\w-]+|\[[^\]]*\]|::?[\w-]+(?:\([^)]*\))?)+)$/;
const CLASS_PART = /^-?[a-z][a-z0-9_]*(?:-[a-z0-9_]+)*-?$/;
function isNameList(body) {
  const parts = body.trim().split(/\s*,\s*|\s+/).filter(Boolean);
  if (!parts.length) return false;
  if (parts.every((p) => SELECTOR_PART.test(p) || CLASS_PART.test(p)) && parts.some((p) => /^[\w-]*[.#]/.test(p))) return true;
  return parts.every((p) => CLASS_PART.test(p)) && parts.some((p) => p.includes('-'));
}

// JavaScript (and JSON, which it reads the same way): strings, template literals (with ${} inside), regular
// expression literals and comments, by a small scanner rather than a full parser.
// `onString`, when given, hears every string and template piece as it is read, for the vocabulary rule: { at (its
// offset in the file, from `offset`), body, handed ('code', 'words' or null), before (up to 80 characters before its
// quote or backtick), after (up to 40 after its closing quote, or the ${ or backtick after the piece), template (a
// number for each template literal, shared by its pieces; null for a quoted string), first (the template's first
// piece), inside (the template whose ${} it is in, or null) }.
function splitJs(text, onString = null, offset = 0) {
  let code = '';
  let words = '';
  const emit = (s, kind) => {
    if (kind === 'code') { code += s; words += blank(s); } else if (kind === 'words') { code += blank(s); words += s; } else { code += blank(s); words += blank(s); }
  };
  let i = 0;
  let lastSignificant = '';
  const braces = []; // for each open ${ in a template: the brace depth inside it
  const templates = []; // for each open template: 'code' or 'words' by where it was handed, or null (by its shape)
  const templateInfo = []; // for each open template: { id, before, pieces } for onString
  let templateCount = 0;
  const codeContext = (at) => SELECTOR_CONTEXT.test(text.slice(Math.max(0, at - 80), at));
  const sentenceContext = (at) => SENTENCE_CONTEXT.test(text.slice(Math.max(0, at - 80), at));
  const handedTo = (at) => (sentenceContext(at) ? 'words' : codeContext(at) ? 'code' : null);
  // A string or template chunk with a space: code or words, by where it was handed first and its shape second.
  const kindOf = (body, handed) => {
    if (!isSentence(body)) return 'code';
    if (handed) return handed;
    return isNameList(body) ? 'code' : 'words';
  };
  const regexAllowed = () => !lastSignificant || /[(,=:[!&|?{};+\-*%<>~^]$/.test(lastSignificant) || /\b(return|typeof|case|in|of|delete|void|throw|new)$/.test(lastSignificant);
  const readString = (quote, start) => {
    let j = start + 1;
    while (j < text.length && text[j] !== quote && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
    return Math.min(j + 1, text.length);
  };
  // A template literal from `from` (just past a backtick or a closing }) to its end or its next ${.
  const readTemplate = (from) => {
    let j = from;
    while (j < text.length && text[j] !== '`' && !(text[j] === '$' && text[j + 1] === '{')) j += text[j] === '\\' ? 2 : 1;
    return j;
  };
  const templateChunk = (from) => {
    const end = readTemplate(from);
    const body = text.slice(from, end);
    emit(body, kindOf(body, templates[templates.length - 1]));
    const info = templateInfo[templateInfo.length - 1];
    if (onString && info) {
      onString({ at: offset + from, body, handed: templates[templates.length - 1], before: info.before, after: text.slice(end, end + 40), template: info.id, first: info.pieces === 0, inside: info.inside });
      info.pieces += 1;
    }
    if (text[end] === '`') { emit('`', 'code'); i = end + 1; lastSignificant = '`'; templates.pop(); templateInfo.pop(); } else if (end < text.length) { emit('${', 'code'); i = end + 2; braces.push(0); lastSignificant = '{'; } else { i = end; templates.pop(); templateInfo.pop(); }
  };
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      emit(text.slice(i, stop), 'none');
      i = stop;
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      emit(text.slice(i, stop), 'none');
      i = stop;
    } else if (c === '"' || c === "'") {
      const stop = readString(c, i);
      const body = text.slice(i + 1, stop - 1);
      emit(c, 'code');
      emit(body, kindOf(body, handedTo(i)));
      if (onString) onString({ at: offset + i + 1, body, handed: handedTo(i), before: text.slice(Math.max(0, i - 80), i), after: text.slice(stop, stop + 40), template: null, first: true, inside: templateInfo.length ? templateInfo[templateInfo.length - 1].id : null });
      emit(text.slice(stop - 1, stop), 'code');
      i = stop;
      lastSignificant = c;
    } else if (c === '`') {
      // A template that is a script's own source (it says 'use strict', as the action runner's RUN does) is code: its
      // comments and its strings are the script's, not sentences.
      templates.push(handedTo(i) || (/['"]use strict['"]/.test(text.slice(i + 1, readTemplate(i + 1))) ? 'code' : null));
      templateInfo.push({ id: (templateCount += 1), before: text.slice(Math.max(0, i - 80), i), pieces: 0, inside: templateInfo.length ? templateInfo[templateInfo.length - 1].id : null });
      emit('`', 'code');
      templateChunk(i + 1);
    } else if (c === '}' && braces.length && braces[braces.length - 1] === 0) {
      braces.pop();
      emit('}', 'code');
      templateChunk(i + 1);
    } else if (c === '/' && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      while (j < text.length && text[j] !== '\n' && (inClass || text[j] !== '/')) {
        if (text[j] === '\\') j += 1;
        else if (text[j] === '[') inClass = true;
        else if (text[j] === ']') inClass = false;
        j += 1;
      }
      while (j + 1 < text.length && /[a-z]/.test(text[j + 1])) j += 1;
      emit(text.slice(i, j + 1), 'code');
      i = j + 1;
      lastSignificant = '/';
    } else {
      if (c === '{' && braces.length) braces[braces.length - 1] += 1;
      if (c === '}' && braces.length) braces[braces.length - 1] -= 1;
      emit(c, 'code');
      // The last word or mark before this point, for telling a regular expression from a division.
      if (!/\s/.test(c)) lastSignificant = (/[\w$]/.test(c) && /[\w$]/.test(text[i - 1] || '') ? lastSignificant + c : c).slice(-12);
      i += 1;
    }
  }
  return { code, words };
}

function splitCss(text) {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, blank);
  return { code, words: blank(text) };
}

// HTML: comments dropped; <script> and <style> read as JavaScript and CSS; a tag's own attributes are code except
// the ones a person reads; text between tags is words.
const READ_ATTRS = /\b(title|placeholder|aria-label|alt)\s*=\s*("[^"]*"|'[^']*')/gi;
function splitHtml(text, onString = null) {
  let code = '';
  let words = '';
  const add = (part) => { code += part.code; words += part.words; };
  const re = /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<[^>]*>/gi;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const between = text.slice(last, m.index);
    add({ code: blank(between), words: between });
    const tag = m[0];
    if (tag.startsWith('<!--')) add({ code: blank(tag), words: blank(tag) });
    else if (/^<script\b/i.test(tag) || /^<style\b/i.test(tag)) {
      const open = tag.indexOf('>') + 1;
      const close = tag.lastIndexOf('</');
      add({ code: tag.slice(0, open), words: blank(tag.slice(0, open)) });
      add(/^<script\b/i.test(tag) ? splitJs(tag.slice(open, close), onString, m.index + open) : splitCss(tag.slice(open, close)));
      add({ code: tag.slice(close), words: blank(tag.slice(close)) });
    } else {
      let tagCode = tag;
      let tagWords = blank(tag);
      for (const a of tag.matchAll(READ_ATTRS)) {
        const at = a.index + a[0].length - a[2].length + 1;
        const len = a[2].length - 2;
        tagCode = tagCode.slice(0, at) + blank(tag.slice(at, at + len)) + tagCode.slice(at + len);
        tagWords = tagWords.slice(0, at) + tag.slice(at, at + len) + tagWords.slice(at + len);
      }
      add({ code: tagCode, words: tagWords });
    }
    last = m.index + tag.length;
  }
  const rest = text.slice(last);
  add({ code: blank(rest), words: rest });
  return { code, words };
}

function split(file, text, onString = null) {
  if (/\.html$/.test(file)) return splitHtml(text, onString);
  if (/\.css$/.test(file)) return splitCss(text);
  return splitJs(text, onString);
}

// The colour roles Thomas approved (public/sdk/system.css, documentation/designsystem/design-theme.md, server/store.js
// THEME_BASE). Their names are fixed and never renamed; the only one that holds a fenced word is surface-panel ("panel",
// a part of a page, not a module). A hit whose whole token is exactly one of these (the `--` before it is not part of
// the token) is the role's name, not an old name. Only the exact token: surface-panel-x, module-panel or a bare
// "panel" are still hits. The same holds for sdk-panel, the Cards family's approved panel class, and the Tables family's sdk-table names (public/sdk/system.css).
const APPROVED_ROLE_TOKENS = new Set(['surface-panel', 'sdk-panel',
  // The Tables family's class names (public/sdk/system.css): "table" is the data table here, not a space.
  'sdk-table', 'sdk-table-wrap', 'sdk-table-group', 'sdk-table-check', 'sdk-table-sub', 'sdk-table-dim', 'sdk-table-count', 'sdk-table-empty']);

const WORDS = require('./words.js');
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Every word but the host's own: the changeable ones and the locked ones (plan-templates-redesign.md, decisions 5 and 32)
// alike, so a page or a sentence reads each through word() and never types it.
const VOCABULARY_KEYS = WORDS.KEYS.filter((k) => !WORDS.FIXED.includes(k));
const vocabularyForms = () => VOCABULARY_KEYS.flatMap((k) => [WORDS.DEFAULTS[k].one, WORDS.DEFAULTS[k].many]);
// A form as a word of its own: not part of a name (module.json, module-settings, spaceId), a path, or a {space}
// placeholder for fill().
const VOCABULARY_WORD = new RegExp(`(?<![\\w.\\-/{$=])(?<!\\{[aA] )(?<!\\{[aA]n )(?:${vocabularyForms().map(escapeRe).join('|')})(?![\\w\\-/}]|\\.\\w)`, 'gi');
const MANY_FORMS = new Set(VOCABULARY_KEYS.concat(WORDS.FIXED).map((k) => WORDS.DEFAULTS[k].many));
const ALL_FORMS = new Set(WORDS.KEYS.flatMap((k) => [WORDS.DEFAULTS[k].one, WORDS.DEFAULTS[k].many]));
// A placeholder with an article ({a space}): fill() fills it only for a singular form it knows.
const ARTICLE_PLACEHOLDER = /\{(?:a|an|A|An) ([A-Za-z]+)\}/g;
// A string handed to a log call (the host operator's, in the host's words): console.log('...') or log(`...`).
const LOG_CALL = /(?:\bconsole\.(?:log|warn|error|info|debug)|(?:^|[^\w.$])log|\b(?:warnings|lines)\.push)\(\s*$/;
// A string a person reads whatever its shape: assigned to a title, placeholder, aria-label, alt or text, or given as
// an object's label, title, text or placeholder.
const READ_CONTEXT = /(?:\.(?:title|placeholder|textContent|innerText|ariaLabel|alt|label)\s*=\s*|\bsetAttribute\(\s*['"](?:title|aria-label|placeholder|alt)['"]\s*,\s*|(?:^|[\s{,(])['"]?(?:title|placeholder|ariaLabel|aria-label|alt|text|label)['"]?\s*:\s*)$/;
// The keys a page, the SDK, a module or the server names: word('space'...), util.word('space'...), data-word="space".
const WORD_KEY_USE = /(?:\bword\(\s*|\bdata-word=\s*|\bdataset\.word\s*=\s*)(['"`])([^'"`]*)\1/g;

// Whether a form found at `index` of `text` names something other than the level: a field or value named in double quotes
// ("objects", as a JSON answer's field), a field in a shape written in braces ({ object, reason }, { module, kind, id }), or
// JavaScript's and JSON's type ("one JSON object", and "is not an object", "must be an object", "as an object" with nothing
// after it but a mark or by, with or of). A value after "=" (scope=space) is left out by VOCABULARY_WORD itself.
const SHAPE_FIELD = /^(?:"[\w?.]+"|[\w?.]+)(?:\s*:\s*(?:"[^"]*"|'[^']*'|[\w.]+|\[\.\.\.\]))?$/;
function notTheLevel(text, index, token) {
  const end = index + token.length;
  if (text[index - 1] === '"' && text[end] === '"') return true;
  const before = text.slice(0, index);
  if (/^objects?$/i.test(token) && /\bJSON $/.test(before)) return true;
  if (token === 'object' && /\b(?:be|is|not|as) an $/i.test(before) && /^(?:$|[.,;:)]|\s+(?:by|with|of)\b)/.test(text.slice(end))) return true;
  const open = text.lastIndexOf('{', index);
  const close = text.indexOf('}', end);
  if (open !== -1 && close !== -1 && text.lastIndexOf('}', index) < open && (text.indexOf('{', end) === -1 || text.indexOf('{', end) > close)) {
    const inside = text.slice(open + 1, close);
    if (/[,:]/.test(inside) && inside.split(',').every((part) => SHAPE_FIELD.test(part.trim()))) return true;
  }
  return false;
}

// Whether one form found in a string (or template piece) is a word a person reads, from the string's shape and where
// it was handed. A string that is only the form in lower case ('space', 'guests') is a key, unless it is handed to
// something a person reads or joined to other text with +; ids, CSS classes and keys never have a space, a capital or
// punctuation beside the form.
function readAsWord(piece, m) {
  const { body, before, after } = piece;
  const token = m[0];
  const next = body.slice(m.index + token.length);
  const prev = body.slice(0, m.index);
  if (piece.handed === 'code') return false; // a class name, id or selector
  if (notTheLevel(body, m.index, token)) return false;
  // The last of a word's own three forms in a module's table of them ([one, many, 'a one'], as a module's fallback labels
  // are written): the module's own word, read through its labels, not the level's.
  if (piece.template === null && next === '' && new RegExp(`\\[\\s*'${escapeRe(token)}',\\s*'[^']*',\\s*$`).test(before) && /^an? $/i.test(prev)) return false;
  if (token !== token.toLowerCase()) return true; // 'Spaces', 'SPACES', 'Space:'
  if (/\s/.test(body) && !isNameList(body)) return true; // a sentence, "Your ", " spaces", "Space: "
  if (/^[,;!?)]/.test(next) || /^:(\s|$)/.test(next) && next.length > 1 || /\($/.test(prev)) return true;
  if (body === token) {
    if (READ_CONTEXT.test(before)) return true; // el.title = 'owner'
    if (piece.template === null && (/['"`]\s*\+\s*$/.test(before) || /^\s*\+\s*['"`]/.test(after))) return true; // 'Delete ' + 'space'
    if (piece.template !== null && piece.first && after.startsWith('${')) return true; // `space${n === 1 ? '' : 's'}`
  }
  return false;
}


const TOKEN_CHAR = /[\w$\-./:]/;
function tokenAt(line, start, end) {
  let a = start;
  let b = end;
  while (a > 0 && TOKEN_CHAR.test(line[a - 1])) a -= 1;
  while (b < line.length && TOKEN_CHAR.test(line[b])) b += 1;
  return line.slice(a, b).replace(/^[./:-]+|[./:-]+$/g, '');
}

// One level's old-name hits in one file, raw (no allow-list): [{ level, line, token, lineText }]. `mode` is 'code' (identifiers,
// keys, routes, class names, ids and file names) or 'words' (sentences). `levels` limits it to those level ids. A hit's `line` is
// 0 for the file's own name. Answers null when the scanner lost its place (the split is not the length of the text).
function oldNameHits(file, text, mode, levels = null) {
  const parts = split(file, text);
  if (parts.code.length !== text.length || parts.words.length !== text.length) return null;
  const lines = (mode === 'code' ? parts.code : parts.words).split('\n');
  const original = text.split('\n');
  const out = [];
  for (const level of LEVELS) {
    if (levels && !levels.includes(level.id)) continue;
    const patterns = mode === 'code' ? level.codePatterns : level.wordPatterns;
    if (!patterns || !level[mode]) continue;
    if (mode === 'words' && level.wordsIn && !level.wordsIn.some((dir) => file.startsWith(dir))) continue;
    const add = (line, token, lineText) => { if (!APPROVED_ROLE_TOKENS.has(token)) out.push({ level: level.id, line, token, lineText }); };
    if (mode === 'code') {
      const base = file.split('/').pop();
      for (const re of patterns) {
        re.lastIndex = 0;
        if (re.test(base)) add(0, base, file);
        re.lastIndex = 0;
      }
    }
    lines.forEach((line, n) => {
      for (const re of patterns) {
        re.lastIndex = 0;
        for (const m of line.matchAll(re)) add(n + 1, tokenAt(line, m.index, m.index + m[0].length) || m[0], original[n] || '');
      }
    });
  }
  return out;
}

// The level or role words typed into what a person reads in a script or a page: { hits: [{ line, token, at, lineText }], keys:
// [{ line, key }] } (`keys` are the vocabulary keys a word() call or data-word names).
function vocabularyScan(file, text) {
  const pieces = [];
  const parts = split(file, text, (piece) => pieces.push(piece));
  const original = text.split('\n');
  const lineStarts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (at) => { let lo = 0; let hi = lineStarts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= at) lo = mid; else hi = mid - 1; } return lo + 1; };
  const hits = [];
  const record = (at, token) => { const line = lineOf(at); hits.push({ line, token, at, lineText: original[line - 1] || '' }); };
  const placeholders = (body, at) => {
    for (const m of body.matchAll(ARTICLE_PLACEHOLDER)) {
      const name = m[1].toLowerCase();
      if (MANY_FORMS.has(name) || !ALL_FORMS.has(name)) record(at + m.index, m[0]); // {a spaces}, {a trip}: never filled
    }
  };
  // A template is skipped whole when it is handed to a log call or any piece of it is about module.json, and so is
  // everything inside its ${}.
  const skipTemplate = new Set();
  const parentOf = new Map();
  for (const piece of pieces) if (piece.template !== null) parentOf.set(piece.template, piece.inside);
  for (const piece of pieces) if (piece.template !== null && (LOG_CALL.test(piece.before) || piece.body.includes('module.json'))) skipTemplate.add(piece.template);
  const skippedWithin = (id) => { for (let t = id; t !== null && t !== undefined; t = parentOf.get(t)) if (skipTemplate.has(t)) return true; return false; };
  for (const piece of pieces) {
    if (skippedWithin(piece.template !== null ? piece.template : piece.inside)) continue;
    if (piece.template === null && (LOG_CALL.test(piece.before) || piece.body.includes('module.json'))) continue;
    for (const m of piece.body.matchAll(VOCABULARY_WORD)) if (readAsWord(piece, m)) record(piece.at + m.index, m[0]);
    placeholders(piece.body, piece.at);
  }
  // HTML: its text and the attributes a person reads (the words channel), outside the scripts' strings, read above.
  if (/\.html$/.test(file)) {
    const inString = new Uint8Array(text.length);
    for (const piece of pieces) inString.fill(1, piece.at, piece.at + piece.body.length);
    for (const m of parts.words.matchAll(VOCABULARY_WORD)) if (!inString[m.index]) record(m.index, m[0]);
    for (const m of parts.words.matchAll(ARTICLE_PLACEHOLDER)) if (!inString[m.index]) placeholders(m[0], m.index);
  }
  hits.sort((x, y) => x.at - y.at);
  const keys = [];
  parts.code.split('\n').forEach((line, n) => { for (const m of line.matchAll(WORD_KEY_USE)) keys.push({ line: n + 1, key: m[2] }); });
  return { hits, keys };
}

// A module's manifest: the text a person reads from it (manifestTexts: the same fields the server fills), where every form is a
// word, never a key. `manifestTexts` is handed in (server/modules.js holds it). Answers { hits: [{ line, token, lineText }] }, or
// { error } when the text is not JSON.
function manifestVocabularyScan(text, manifestTexts) {
  const lines = text.split('\n');
  const hits = [];
  let manifest;
  try { manifest = JSON.parse(text); } catch (err) { return { hits, error: err.message }; }
  for (const [obj, key] of manifestTexts(manifest)) {
    const value = obj[key];
    const quoted = JSON.stringify(value).slice(1, -1);
    const line = Math.max(1, lines.findIndex((l) => l.includes(quoted.slice(0, 60))) + 1);
    const record = (token) => hits.push({ line, token, lineText: lines[line - 1] || '' });
    for (const m of value.matchAll(VOCABULARY_WORD)) if (!notTheLevel(value, m.index, m[0])) record(m[0]);
    for (const m of value.matchAll(ARTICLE_PLACEHOLDER)) {
      const name = m[1].toLowerCase();
      if (MANY_FORMS.has(name) || !ALL_FORMS.has(name)) record(m[0]);
    }
  }
  return { hits };
}

module.exports = { LEVELS, WORDS, VOCABULARY_LEVEL, VOCABULARY_WORD, split, isNameList, oldNameHits, vocabularyScan, manifestVocabularyScan, APPROVED_ROLE_TOKENS };
