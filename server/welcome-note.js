'use strict';

// The welcome note (GitHub #870): one short text an environment's owner writes for people to read at their first sign-in.
// What is stored is the text as the page's one Markdown reader (hostText.markdown, public/sdk/host.js) will draw it, cut
// down to the subset the note allows: paragraphs, **bold**, *italic*, "- " bullet lists and [text](address) links to an
// http, https or mailto address. Everything else is made plain text here, so what is stored can never be a heading, a
// quote, a code block, a numbered list or a link to anything else. Hidden characters and tags go as in object-format.js.

const { plain } = require('./object-format');

const MAX_NOTE = 4000; // characters, as written
const MAX_LINK = 500; // characters in one link's address

class NoteError extends Error {}

const MAX_LABEL = 200; // characters in one link's words
// What public/sdk/host.js markdown() would make a link of: [label](address) with the address running to the FIRST ")". The
// optional second ")" is the one left over when an address held a "(" ("[x](javascript:alert(1))"): it goes with the link.
const LINK = /\[([^\]\n]+)\]\(([^\s)]*)\)(\))?/g;
const BARE = /https?:\/\/\S+/gi; // markdown() links a bare address too
const CREDENTIALS = /^(https?:\/\/)[^\s/?#]*@/i;
const HOLD = '\uE000'; // stands for a "<" that opens no tag while the shared plain() runs

// An address the note may link to (http, https or mailto), or ''.
function allowedAddress(address) {
  if (address.length > MAX_LINK || /[()\s]/.test(address) || !/^(?:https?:\/\/|mailto:)/i.test(address)) return ''; // brackets: markdown() would cut the address short
  let u;
  try { u = new URL(address); } catch { return ''; }
  if (u.protocol === 'mailto:') return u.pathname && !address.includes('?') ? address : ''; // an address, no ?subject= or ?cc=
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || !u.hostname) return '';
  return address;
}

// A "<" that cannot open a tag (not followed by a letter, "/", "!" or "?") is kept as text: the shared plain() would take
// everything from it to the next ">" away ("x < y and z > w"). Every "<" is held first so that plain() removes the hidden
// characters (which may sit between a "<" and a letter) before the decision; then the ones that can open a tag go through
// plain() again as "<", and the rest stay held.
function cleanTags(text) {
  const hiddenGone = plain(text.replace(/\uE000/g, '').replace(/</g, HOLD), MAX_NOTE, true);
  const stripped = plain(hiddenGone.replace(/\uE000(?=[A-Za-z/!?])/g, '<'), MAX_NOTE, true);
  return stripped.replace(/<+/g, '').replace(/\uE000/g, '<'); // a "<" still there had no ">" to close it
}
// No "<" is left before a letter, "/", "!" or "?" (later steps, as taking out a backtick, may bring one next to a letter).
function noTagOpeners(text) {
  let out = text;
  for (let prev = null; prev !== out;) { prev = out; out = out.replace(/<(?=[A-Za-z/!?])/g, ''); }
  return out;
}

// One [label](address) as the note keeps it: the link when both are allowed, else its label (when the address held a "(" the
// closing ")" that went with it goes too).
function keepLink(_all, label, address, extra) {
  if (label.length <= MAX_LABEL && allowedAddress(address)) return `[${label}](${address})${extra || ''}`;
  return address.includes('(') ? label : label + (extra || '');
}

// The note text as it is stored: the one hidden-character and tag clean-up (plain, keeping line breaks), then the marks the
// note does not allow taken out. A link with an address that is not allowed (or a label or address too long) keeps only its
// words. Throws NoteError over the length or for a value that is not text; '' (or null) is no note.
function clean(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') throw new NoteError('The welcome note is text.');
  if (value.length > MAX_NOTE) throw new NoteError(`The welcome note is at most ${MAX_NOTE} characters.`);
  const text = cleanTags(value.replace(/\r\n?/g, '\n'));
  const lines = [];
  for (const raw of text.split('\n')) {
    if (/^\s*```/.test(raw)) continue; // a code fence is not allowed
    const line = raw
      .replace(/`/g, '') // no code
      .replace(/[ \t]{2,}/g, ' ') // a backtick between two spaces leaves one
      .replace(LINK, keepLink)
      .replace(BARE, (address) => (address.length > MAX_LINK + 1 ? '(address too long)' : address.replace(CREDENTIALS, '$1')))
      .replace(/^\s*(?:(?:#+(?=\s|$)|>+)\s*)+/, '') // no headings, no quotes, however many marks
      .replace(/^(\s*\d+)[.)]\s+/, '$1: ') // no numbered lists
      .replace(/^\s*[-*]\s*$/, ''); // a bullet with nothing after it
    lines.push(line.trimEnd());
  }
  return noTagOpeners(lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()).trim();
}

// A note as read back from storage (app.json, or a restored copy): { text, updatedAt, by } with the text cleaned again, or
// null. Anything not text, an empty note, and one over the length are dropped (a stored note was always within it).
function cleanStored(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.text !== 'string') return null;
  let text;
  try { text = clean(raw.text); } catch { return null; }
  if (!text) return null;
  const at = typeof raw.updatedAt === 'string' && !Number.isNaN(Date.parse(raw.updatedAt)) ? new Date(raw.updatedAt).toISOString() : null;
  return { text, updatedAt: at, by: typeof raw.by === 'string' ? raw.by.slice(0, 100) : null };
}

module.exports = { MAX_NOTE, NoteError, clean, cleanStored };
