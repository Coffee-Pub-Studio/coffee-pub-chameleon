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

const LINK = /\[([^\]\n]{1,200})\]\(([^\s)]{1,600})\)/g;

// An address the note may link to (http, https or mailto), or ''.
function allowedAddress(address) {
  if (address.length > MAX_LINK || !/^(?:https?:\/\/|mailto:)/i.test(address)) return '';
  let u;
  try { u = new URL(address); } catch { return ''; }
  if (u.protocol === 'mailto:') return u.pathname ? address : '';
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || !u.hostname) return '';
  return address;
}

// The note text as it is stored: the one hidden-character and tag clean-up (plain, keeping line breaks), then the marks the
// note does not allow taken out. A link with an address that is not allowed keeps only its words. Throws NoteError over the
// length or for a value that is not text; '' (or null) is no note.
function clean(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') throw new NoteError('The welcome note is text.');
  if (value.length > MAX_NOTE) throw new NoteError(`The welcome note is at most ${MAX_NOTE} characters.`);
  const text = plain(value.replace(/\r\n?/g, '\n'), MAX_NOTE, true);
  const lines = [];
  for (const raw of text.split('\n')) {
    if (/^\s*```/.test(raw)) continue; // a code fence is not allowed
    const line = raw
      .replace(/^\s*#{1,6}\s*/, '') // no headings
      .replace(/^\s*>+\s?/, '') // no quotes
      .replace(/^(\s*\d+)[.)]\s+/, '$1: ') // no numbered lists
      .replace(/`/g, '') // no code
      .replace(/^\s*[-*]\s*$/, '') // a bullet with nothing after it
      .replace(LINK, (_all, label, address) => (allowedAddress(address) ? `[${label}](${address})` : label));
    lines.push(line.trimEnd());
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { MAX_NOTE, NoteError, clean };
