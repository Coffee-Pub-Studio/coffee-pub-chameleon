#!/usr/bin/env node
/*
 * check-whiteboard-markup.mjs -- the Whiteboard's words as markup (whiteboard-lib-j-markup.js: what the formatting bar does
 * to the words being edited) and the text size and alignment of notes, text and shapes (lib-a, lib-e-*).
 * Guards: bold, italic and code go on and come off again (the selection, a caret between an empty pair, several lines),
 * lists and the heading cycle, a link's address made safe (only http and https; brackets escaped) and put round the
 * words, which words count as markup, and that size and alignment are a closed list each type cleans to (a note, a text
 * block and a shape take them; a line does not). It runs the module's own libs in one scope as the page has them. No
 * network, no browser.
 * Usage: node modules/whiteboard/test/check-whiteboard-markup.mjs [path to the module's src folder]. Exits 1 on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = path.resolve(process.argv[2] || path.join(root, 'modules/whiteboard/src'));
const NAMES = ['blockTypes', 'wbClean', 'wbPlain', 'wbToggleMark', 'wbFormatAll', 'wbFormatOn', 'wbToggleList', 'wbCycleHeading', 'wbHeadingOf', 'wbLinkAddress', 'wbLinkMarkup', 'wbHasMarkup', 'WB_SIZES', 'WB_ALIGNS'];

let passed = 0;
const fails = [];
const check = (ok, what) => { if (ok) passed += 1; else fails.push(what); };

let lib = {};
try {
  const parts = fs.readdirSync(src).filter((f) => /^whiteboard-lib-[a-z]-.*\.js$/.test(f)).sort().map((f) => fs.readFileSync(path.join(src, f), 'utf8'));
  const grab = NAMES.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ');
  lib = new Function('window', 'document', `${parts.join('\n')}\nreturn { ${grab} };`)({ devicePixelRatio: 1 }, undefined);
} catch (err) {
  fails.push(`the libs do not load: ${err.message}`);
}
const need = (...names) => { const missing = names.filter((n) => typeof lib[n] === 'undefined'); if (missing.length) throw new Error(`the libs have no ${missing.join(', ')}`); };
const show = (r) => JSON.stringify(r);
// The words with the selection marked: "a [b] c".
const sel = (r) => `${r.value.slice(0, r.start)}[${r.value.slice(r.start, r.end)}]${r.value.slice(r.end)}`;

const cases = {
  'bold, italic and code go on and come off'() {
    need('wbToggleMark');
    const on = lib.wbToggleMark('Plan bold now', 5, 9, 'bold');
    check(sel(on) === 'Plan **[bold]** now', `bold on: ${sel(on)}`);
    const off = lib.wbToggleMark(on.value, on.start, on.end, 'bold');
    check(sel(off) === 'Plan [bold] now', `bold off again: ${sel(off)}`);
    const it = lib.wbToggleMark('a word', 2, 6, 'italic');
    check(sel(it) === 'a *[word]*', `italic: ${sel(it)}`);
    const code = lib.wbToggleMark('run it', 4, 6, 'code');
    check(sel(code) === 'run `[it]`', `code: ${sel(code)}`);
    const caret = lib.wbToggleMark('ab', 1, 1, 'bold');
    check(sel(caret) === 'a**[]**b', `a caret: an empty pair round it: ${sel(caret)}`);
    const gone = lib.wbToggleMark(caret.value, caret.start, caret.end, 'bold');
    check(gone.value === 'ab', `an empty pair taken away: ${show(gone)}`);
    const lines = lib.wbToggleMark('one\ntwo', 0, 7, 'bold');
    check(lines.value === '**one**\n**two**', `several lines: each marked: ${JSON.stringify(lines.value)}`);
  },
  'lists and the heading cycle'() {
    need('wbToggleList', 'wbCycleHeading', 'wbHeadingOf');
    const ul = lib.wbToggleList('eggs\nmilk', 0, 9, 'ul');
    check(ul.value === '- eggs\n- milk', `a bulleted list: ${JSON.stringify(ul.value)}`);
    check(lib.wbToggleList(ul.value, 0, ul.value.length, 'ul').value === 'eggs\nmilk', 'and off again');
    const ol = lib.wbToggleList('eggs\nmilk', 0, 9, 'ol');
    check(ol.value === '1. eggs\n2. milk', `a numbered list: ${JSON.stringify(ol.value)}`);
    let h = { value: 'Title', start: 0, end: 0 };
    const seen = [];
    for (let i = 0; i < 4; i += 1) { h = lib.wbCycleHeading(h.value, h.start, h.end); seen.push(lib.wbHeadingOf(h.value, h.start, h.end)); }
    check(show(seen) === show([1, 2, 3, 0]), `heading: large, middle, small, none (${show(seen)})`);
    const fromList = lib.wbCycleHeading('- item', 0, 0);
    check(fromList.value === '# item', `a list mark goes when the line becomes a heading: ${JSON.stringify(fromList.value)}`);
  },
  'a link: only http and https, made safe'() {
    need('wbLinkAddress', 'wbLinkMarkup');
    check(/^https:\/\/example\.com\/?$/.test(lib.wbLinkAddress('example.com') || ''), `no scheme: https (${lib.wbLinkAddress('example.com')})`);
    check(lib.wbLinkAddress('http://a.test/x') === 'http://a.test/x', 'http kept');
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', '', '   ', 'two words']) check(lib.wbLinkAddress(bad) === null, `refused: ${JSON.stringify(bad)}`);
    const br = lib.wbLinkAddress('https://a.test/(x)');
    check(br && !/[()]/.test(br) && /%28x%29/.test(br), `brackets escaped: ${br}`);
    const l = lib.wbLinkMarkup('see site', 4, 8, 'https://example.com');
    check(l.value === 'see [site](https://example.com)' && l.value.slice(l.start, l.end) === 'site', `round the words, which stay selected: ${show(l)}`);
  },
  'which words are markup'() {
    need('wbHasMarkup');
    for (const t of ['**b**', '*i*', '`c`', '- a', '1. a', '# h', '[a](https://x.test)']) check(lib.wbHasMarkup(t), `markup: ${t}`);
    for (const t of ['plain words', 'a - b', '']) check(!lib.wbHasMarkup(t), `plain: ${JSON.stringify(t)}`);
  },
  'size and alignment are a closed list each words block cleans to'() {
    need('wbClean', 'WB_SIZES', 'WB_ALIGNS');
    for (const type of ['note', 'text', 'rect', 'rounded']) {
      const ok = lib.wbClean({ id: 'b', type, x: 0, y: 0, z: 1, text: 'hi', size: 'huge', align: 'right' });
      check(ok && ok.size === 'huge' && ok.align === 'right', `${type}: keeps a size and an alignment (${show(ok && [ok.size, ok.align])})`);
      const bad = lib.wbClean({ id: 'b', type, x: 0, y: 0, z: 1, text: 'hi', size: '99px', align: 'justify' });
      check(bad && bad.size !== '99px' && bad.align !== 'justify', `${type}: an unknown size or alignment is not kept (${show(bad && [bad.size, bad.align])})`);
    }
    const line = lib.wbClean({ id: 'l', type: 'line', x: 0, y: 0, z: 1, dx: 10, dy: 0, size: 'huge', align: 'right' });
    check(line && line.size === undefined && line.align === undefined, 'a line takes neither');
  },
};

for (const [name, run] of Object.entries(cases)) {
  try { await run(); } catch (err) { fails.push(`${name}: ${err.message}`); }
}
// The strip's formatting of ALL the words of a picked block (wbFormatAll), and when a button is pressed (wbFormatOn).
if (lib.wbFormatAll) {
  const all = lib.wbFormatAll;
  const on = lib.wbFormatOn;
  check(all('Hello there', 'bold') === '**Hello there**', 'Bold on the whole words wraps them');
  check(all('**Hello there**', 'bold') === 'Hello there', 'Bold on bold words takes it off again');
  check(all('Hello there', 'italic') === '*Hello there*' && all('Hello there', 'code') === '`Hello there`', 'Italic and Code wrap the whole words');
  check(all('one\ntwo', 'bold') === '**one**\n**two**', 'Bold on several lines marks each line');
  check(all('**one**\ntwo', 'bold') === '**one**\n**two**', 'Bold with only some lines bold makes them all bold');
  check(all('one\ntwo', 'ul') === '- one\n- two' && all('one\ntwo', 'ol') === '1. one\n2. two', 'the lists go on every line');
  check(all('- one\n- two', 'ul') === 'one\ntwo', 'a bulleted list comes off again');
  check(all('Title', 'heading') === '# Title' && all('# Title', 'heading') === '## Title' && all('### Title', 'heading') === 'Title', 'Heading goes round: large, medium, small, none');
  check(all('Words', 'link', 'example.com') === '[Words](https://example.com/)', 'Link puts the address round all the words');
  check(all('Words', 'link', 'javascript:alert(1)') === null && all('Words', 'link', '') === null && all('Words', 'link') === null, 'a link with no good address changes nothing');
  check(all('', 'bold') === null && all('   \n ', 'ul') === null && all(undefined, 'bold') === null, 'words with nothing in them change nothing (no empty pair of marks)');
  check(all('Words', 'underline') === null && all(null, 'heading') === null, 'an action that does not exist changes nothing');
  check(on('**Hello**', 'bold') && !on('Hello', 'bold') && !on('', 'bold'), 'Bold is on for bold words, off for plain ones and for none');
  check(on('*a*\n*b*', 'italic') && !on('*a*\nb', 'italic'), 'Italic is on only when every line has it');
  check(on('- a\n- b', 'ul') && !on('- a\nb', 'ul') && on('1. a\n2. b', 'ol') && !on('- a', 'ol'), 'a list is on when every line is one of that kind');
  check(on('## Title', 'heading') && !on('Title', 'heading') && !on('Title', 'link'), 'Heading is on for a heading; Link is never "on"');
  let t = all('Hello there', 'bold');
  t = all(t, 'italic');
  check(t === '***Hello there***' && on(t, 'bold') && on(t, 'italic'), `bold and italic stack on the same words, and both read as on (${t})`);
  check(all(t, 'italic') === '**Hello there**' && all(all(t, 'bold'), 'italic') !== null, 'and each comes off on its own');
  // Known limit (also the bar's): Code outermost hides bold and italic from the functions, so they read as off and a press adds marks.
  const codeOut = all(t, 'code');
  check(codeOut === '`***Hello there***`' && !on(codeOut, 'bold'), 'with Code outermost, Bold reads as off (a known limit)');
}

if (fails.length) {
  for (const f of fails) console.error(`FAIL ${f}`);
  console.error(`check-whiteboard-markup: ${fails.length} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`check-whiteboard-markup: OK, ${passed} cases`);
